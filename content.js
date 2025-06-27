// Centralized extension state
const extensionState = {
  isChannelSubscribed: false,
  channelName: '',
  currentGame: null,
  currentUser: null,
  observerInitialized: false,
  lastSubscriptionCheck: null, // Track last subscription check time
  initializationInProgress: false // Prevent concurrent initializations
};

// Channel state tracking similar to FFZ addon
const channelState = {
  activeChannels: new Set(), // Track active channels
  subscribedChannels: new Set(), // Track subscribed channels
  currentChannel: null // Track current active channel
};

// Processing state
let processedMessages = new Set();
let tooltipElement = null; // Global tooltip element

// Supported games configuration - simplified structure
const SUPPORTED_GAMES = {
  'League of Legends': true
  // Example of how to add more games in the future:
  // 'Valorant': true
};

// Add a small delay before showing the tooltip to avoid flickering
let tooltipShowTimeout = null;

// Initialize storage data once at startup
initializeStorage();

// Single initialization with fallback delay
initializeExtension();
setTimeout(() => {
  if (!extensionState.observerInitialized) {
  initializeExtension();
  }
}, 3000);

// Listen for URL changes only (for SPA navigation)
window.addEventListener('popstate', function() {
  // Only reinitialize if we're not already in progress
  if (!extensionState.initializationInProgress) {
  initializeExtension();
  }
});

// Clear rank cache when user closes tab or navigates away from Twitch
window.addEventListener('beforeunload', function() {
  console.log('👋 UserRankCache: Cleared on page unload/navigation');
  
  // Clean up current channel if active
  if (extensionState.channelName) {
    cleanupChannel(extensionState.channelName);
  }
  
  clearRankCache();
});

/**
 * Clear the rank cache but preserve the current user's rank data
 * Called when switching streams/channels
 */
function clearRankCache() {
  // Ask background script to clear the cache
  chrome.runtime.sendMessage({
    action: 'clear_rank_cache'
  });
  
  // Also clear the processed messages set to prevent memory buildup
  processedMessages.clear();
}

/**
 * Clean up state when leaving a channel (similar to FFZ addon's onRoomRemove)
 * @param {string} channelName - The channel being left
 */
function cleanupChannel(channelName) {
  if (!channelName) return;
  
  const normalizedChannel = channelName.toLowerCase();
  
  // Remove from active and subscribed channels
  channelState.activeChannels.delete(normalizedChannel);
  channelState.subscribedChannels.delete(normalizedChannel);
  
  // Clear processed messages for this channel
  processedMessages.clear();
  
  // Disconnect observers
  if (window._eloward_chat_observer) {
    window._eloward_chat_observer.disconnect();
    window._eloward_chat_observer = null;
  }
  
  if (window._eloward_game_observer) {
    window._eloward_game_observer.disconnect();
    window._eloward_game_observer = null;
  }
  
  // Reset extension state
  extensionState.observerInitialized = false;
  extensionState.isChannelSubscribed = false;
  extensionState.lastSubscriptionCheck = null;
  
  console.log(`EloWard: Cleaned up channel ${channelName}`);
}

/**
 * Initialize a channel (similar to FFZ addon's onRoomAdd)
 * @param {string} channelName - The channel being entered
 */
async function initializeChannel(channelName) {
  if (!channelName) return;
  
  const normalizedChannel = channelName.toLowerCase();
  
  // Add to active channels
  channelState.activeChannels.add(normalizedChannel);
  channelState.currentChannel = normalizedChannel;
  
  // Always force check subscription status to ensure fresh data
  // This handles cases where subscription status might have changed
  const isSubscribed = await checkChannelSubscription(channelName, true);
  
  if (isSubscribed) {
    channelState.subscribedChannels.add(normalizedChannel);
    extensionState.isChannelSubscribed = true;
    console.log(`EloWard: Initialized channel ${channelName} (subscribed)`);
  } else {
    // Remove from subscribed channels if not subscribed
    channelState.subscribedChannels.delete(normalizedChannel);
    extensionState.isChannelSubscribed = false;
    console.log(`EloWard: Initialized channel ${channelName} (not subscribed)`);
  }
  
  return isSubscribed;
}

// Initialize storage and load user data
function initializeStorage() {
  chrome.storage.local.get(null, (allData) => {
    // Find current user in storage using consolidated logic
    extensionState.currentUser = findCurrentUser(allData);
    
    // Send current user to background script to protect from cache eviction
    if (extensionState.currentUser) {
      chrome.runtime.sendMessage({
        action: 'set_current_user',
        username: extensionState.currentUser
      });
    }
  });
}

// Find current Twitch user from storage - use most reliable key
function findCurrentUser(allData) {
  // Use the most reliable persistent storage key
  if (allData.eloward_persistent_twitch_user_data?.login) {
    return allData.eloward_persistent_twitch_user_data.login.toLowerCase();
  } 
  
  // Single fallback for backward compatibility
  if (allData.twitchUsername) {
    return allData.twitchUsername.toLowerCase();
  }
  
  return null;
}

/**
 * Optimized function to check if a channel is subscribed
 * Uses local caching to avoid excessive API calls
 * @param {string} channelName - The channel to check
 * @param {boolean} forceCheck - Whether to bypass cache and force a fresh check
 * @returns {Promise<boolean>} - Whether the channel is subscribed
 */
async function checkChannelSubscription(channelName, forceCheck = false) {
  if (!channelName) return false;
  
  // Prevent redundant checks within 30 seconds unless forced
  const now = Date.now();
  if (!forceCheck && 
      extensionState.lastSubscriptionCheck && 
      extensionState.channelName === channelName && 
      (now - extensionState.lastSubscriptionCheck) < 30000) {
    return extensionState.isChannelSubscribed;
  }
  
  // Normalize channel name
  const normalizedChannel = channelName.toLowerCase();
  
  try {
    return new Promise((resolve) => {
      // Send message to background script to check subscription
      chrome.runtime.sendMessage(
        { 
          action: 'check_streamer_subscription', 
          streamer: channelName,
          skipCache: true
        },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve(false);
            return;
          }
          
          // Extract the boolean value with casting to ensure it's a boolean
          const isSubscribed = response && response.subscribed === true;
          
          // Update tracking
          extensionState.lastSubscriptionCheck = now;
          
          // Log subscription status
          console.log(`EloWard: ${channelName} is ${isSubscribed ? 'Subscribed ✅' : 'Not Subscribed ❌'}`);
          
          resolve(isSubscribed);
        }
      );
    });
  } catch (error) {
    return false;
  }
}

/**
 * Get the current channel name using URL parsing (100% reliable on Twitch)
 * @returns {string|null} The current channel name or null if not found
 */
function getCurrentChannelName() {
  const pathSegments = window.location.pathname.split('/');
  
  // Handle moderator view URLs (format: /moderator/channelname)
  if (pathSegments[1] === 'moderator' && pathSegments.length > 2) {
    return pathSegments[2].toLowerCase();
  }
  
  // Regular channel URL (format: /channelname)
  if (pathSegments[1] && 
      pathSegments[1] !== 'oauth2' && 
      !pathSegments[1].includes('auth')) {
    return pathSegments[1].toLowerCase();
  }
  
  return null;
}

/**
 * Get the current game being played by the streamer
 * @returns {string|null} The game name or null if not found
 */
function getCurrentGame() {
  try {
    // Use the most reliable method - direct game link selector
    const gameLink = document.querySelector('a[data-a-target="stream-game-link"]');
    return gameLink?.textContent?.trim() || null;
  } catch (error) {
    console.error(`EloWard: Error detecting game:`, error);
    return null;
  }
}

/**
 * Attempts to get the current game periodically if initial detection fails
 * @param {number} maxAttempts - Maximum number of retry attempts
 * @param {number} interval - Interval between attempts in ms
 * @returns {Promise<string|null>} - Resolves to game name or null if not found
 */
function getGameWithRetries(maxAttempts = 5, interval = 2000) {
  return new Promise((resolve) => {
    let attempts = 0;
    
    function tryGetGame() {
      const game = getCurrentGame();
      if (game) {
        resolve(game);
      } else if (attempts < maxAttempts) {
        attempts++;
        setTimeout(tryGetGame, interval);
      } else {
        resolve(null);
      }
    }
    
    tryGetGame();
  });
}

/**
 * Check if the current game is supported by EloWard
 * @param {string} game - The game name to check
 * @returns {boolean} - Whether the game is supported
 */
function isGameSupported(game) {
  if (!game) return false;
  
  // Direct match check
  if (SUPPORTED_GAMES[game] === true) {
    return true;
  }
  
  // Case-insensitive check
  const gameLower = game.toLowerCase();
  for (const supportedGame of Object.keys(SUPPORTED_GAMES)) {
    if (supportedGame.toLowerCase() === gameLower) {
      return true;
    }
  }
  
  return false;
}

/**
 * Setup observer for game changes during stream
 * This detects if a streamer switches games mid-stream
 */
function setupGameChangeObserver() {
  // Only set up once
  if (window._eloward_game_observer) return;
  
  // Create observer instance to monitor the game element
  const gameObserver = new MutationObserver(function() {
    const newGame = getCurrentGame();
    
    // If we can't detect the game, don't do anything
    if (!newGame) return;
    
    // If game changed, reinitialize
    if (newGame !== extensionState.currentGame) {
      const oldGame = extensionState.currentGame;
      extensionState.currentGame = newGame;
      
      console.log(`EloWard: Game changed from ${oldGame || 'unknown'} to ${newGame}`);
      
      // Clean up existing chat observer
      if (window._eloward_chat_observer) {
        window._eloward_chat_observer.disconnect();
        window._eloward_chat_observer = null;
        extensionState.observerInitialized = false;
      }
      
      // Reset extension state based on game support
      if (isGameSupported(newGame)) {
        console.log(`EloWard: Supported game '${newGame}' detected. Activating extension.`);
        
        // Only check subscription if the game is supported
        checkChannelSubscription(extensionState.channelName, false)
          .then(subscribed => {
            extensionState.isChannelSubscribed = subscribed;
            
            if (extensionState.isChannelSubscribed) {
              console.log("🛡️ EloWard Extension Active");
              
              if (!extensionState.observerInitialized) {
                initializeObserver();
              }
            }
          });
      } else {
        // Deactivate extension for unsupported games
        console.log(`EloWard: Game '${newGame}' is not supported. Extension inactive.`);
        extensionState.isChannelSubscribed = false;
        extensionState.observerInitialized = false;
      }
    }
  });
  
  // Find the element containing game information
  const gameContainer = document.querySelector('.channel-info-content, [data-a-target="stream-title-container"]');
  if (gameContainer) {
    gameObserver.observe(gameContainer, { subtree: true, childList: true, characterData: true });
    window._eloward_game_observer = gameObserver;
  } else {
    // Try to find game information in the document body if the specific container isn't found
    gameObserver.observe(document.body, { 
      subtree: true, 
      childList: true,
      attributes: true,
      attributeFilter: ['data-a-target'], 
      characterData: true 
    });
    window._eloward_game_observer = gameObserver;
  }
}

function initializeExtension() {
  // Prevent concurrent initializations
  if (extensionState.initializationInProgress) {
    return;
  }
  extensionState.initializationInProgress = true;
  
  // Signal Chrome extension presence to FFZ addon (as recommended in PR review)
  document.body.setAttribute('data-eloward-chrome-ext', 'active');
  
  // Get channel name using the new reliable method
  const newChannelName = getCurrentChannelName();
  
  // If no channel name or we're on an auth-related path, don't do anything
  if (!newChannelName || 
      window.location.pathname.includes('oauth2') ||
      window.location.pathname.includes('auth/') ||
      window.location.href.includes('auth/callback') ||
      window.location.href.includes('auth/redirect')) {
    extensionState.initializationInProgress = false;
    return;
  }
  
  // Check if we've changed channels
  const channelChanged = newChannelName !== extensionState.channelName;
  if (channelChanged) {
    // Clean up the old channel if it exists
    if (extensionState.channelName) {
      cleanupChannel(extensionState.channelName);
    }
    
    // Notify background about channel switch
    chrome.runtime.sendMessage({
      action: 'channel_switched',
      oldChannel: extensionState.channelName,
      newChannel: newChannelName
    });
    
    // Update the channel name
    extensionState.channelName = newChannelName;
    
    // Clear the rank cache but preserve current user's rank
    clearRankCache();
  }
  
  // Add extension styles if needed
  if (!document.querySelector('#eloward-extension-styles')) {
    addExtensionStyles();
  }
  
  // Disconnect any existing observer when reinitializing
  if (window._eloward_chat_observer) {
    window._eloward_chat_observer.disconnect();
    window._eloward_chat_observer = null;
    extensionState.observerInitialized = false;
  }
  
  // Attempt to detect the game with retries
  getGameWithRetries().then(detectedGame => {
    // Update current game state
    extensionState.currentGame = detectedGame;
    
    // Only proceed if the current game is supported
    if (!isGameSupported(extensionState.currentGame)) {
      console.log(`EloWard: Game '${extensionState.currentGame || 'unknown'}' is not supported. Extension inactive.`);
      extensionState.initializationInProgress = false;
      return;
    }
    
    console.log(`EloWard: Supported game '${extensionState.currentGame}' detected`);
    
    // Setup game change observer to detect mid-stream game switches
    setupGameChangeObserver();
    
    // Initialize the new channel properly
    initializeChannel(extensionState.channelName)
      .then(subscribed => {
        if (subscribed) {
          // Only print the activation message when the channel is subscribed
          console.log("🛡️ EloWard Extension Active");
          
          if (!extensionState.observerInitialized) {
            initializeObserver();
          }
        }
        
        extensionState.initializationInProgress = false;
      });
  }).catch(() => {
    extensionState.initializationInProgress = false;
  });
  
  // Set up navigation observer to detect URL changes
  setupUrlChangeObserver();
}

// Watch for URL changes (channel changes)
function setupUrlChangeObserver() {
  // Only set up once
  if (window._eloward_url_observer) return;
  
  // Create observer instance
  const urlObserver = new MutationObserver(function(mutations) {
    // Get the current channel name using our reliable method
    const currentChannel = getCurrentChannelName();
    
    // Skip if we can't determine the channel or on auth-related paths
    if (!currentChannel || 
        window.location.pathname.includes('oauth2') || 
        window.location.pathname.includes('auth/') ||
        window.location.href.includes('auth/callback') ||
        window.location.href.includes('auth/redirect')) {
      return;
    }
    
    // Only reinitialize if the channel actually changed
    if (currentChannel !== extensionState.channelName) {
      // Clean up the old channel
      if (extensionState.channelName) {
        cleanupChannel(extensionState.channelName);
      }
      
      // Update channel name
      extensionState.channelName = currentChannel;
      
      // Clear rank cache but preserve current user's rank
      clearRankCache();
      
      // Reinitialize with new channel
      initializeExtension();
    }
  });
  
  // Start observing the document for URL changes
  urlObserver.observe(document, { subtree: true, childList: true });
  
  // Store observer for reference
  window._eloward_url_observer = urlObserver;
}

function initializeObserver() {
  if (extensionState.observerInitialized) {
    return;
  }
  
  const chatContainer = findChatContainer();
  
  if (chatContainer) {
    // Chat container found, set up the observer
    setupChatObserver(chatContainer);
    extensionState.observerInitialized = true;
  } else {
    // Single retry after short delay if container not found immediately
    setTimeout(() => {
      const chatContainer = findChatContainer();
      if (chatContainer) {
        setupChatObserver(chatContainer);
        extensionState.observerInitialized = true;
      }
    }, 1000);
  }
}

function findChatContainer() {
  // Use the most reliable standard Twitch selector
  const chatContainer = document.querySelector('.chat-scrollable-area__message-container') ||
                       document.querySelector('[data-a-target="chat-scroller"]');
  
  if (chatContainer) return chatContainer;
  
  // Single fallback: find by existing chat message
  const anyMessage = document.querySelector('.chat-line__message, .chat-line');
  return anyMessage ? anyMessage.closest('[role="log"]') || anyMessage.parentElement : null;
}

function setupChatObserver(chatContainer, isFallbackObserver = false) {
  // Create a MutationObserver to watch for new chat messages
  const chatObserver = new MutationObserver((mutations) => {
    // Process messages only if channel is subscribed
    if (!extensionState.isChannelSubscribed) return;
    
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if this is a standard Twitch chat message
            const isMessage = node.classList && (
              node.classList.contains('chat-line__message') || 
              node.classList.contains('chat-line') ||
              node.querySelector('.chat-author__display-name, [data-a-target="chat-message-username"]')
            );
            
            if (isMessage) {
              processNewMessage(node);
            } else if (isFallbackObserver) {
              // For fallback observers, look for standard Twitch messages
              const messages = node.querySelectorAll('.chat-line__message, .chat-line');
              messages.forEach(message => processNewMessage(message));
            }
          }
        }
      }
    }
  });
  
  // Start observing the chat container
  chatObserver.observe(chatContainer, {
    childList: true,
    subtree: true
  });
  
  // Process any existing standard Twitch messages
  const existingMessages = chatContainer.querySelectorAll('.chat-line__message, .chat-line');
  for (const message of existingMessages) {
    processNewMessage(message);
  }
}

function processNewMessage(messageNode) {
  // Skip if we've already processed this message
  if (processedMessages.has(messageNode)) return;
  processedMessages.add(messageNode);
  
  // Memory management - clear old entries if too many
  if (processedMessages.size > 500) {
    const toDelete = Array.from(processedMessages).slice(0, 100);
    toDelete.forEach(msg => processedMessages.delete(msg));
  }
  
  // Only process messages if the channel is subscribed
  if (!extensionState.isChannelSubscribed) return;
  
  // Use the most reliable Twitch username selector
  const usernameElement = messageNode.querySelector('.chat-author__display-name') ||
                         messageNode.querySelector('[data-a-target="chat-message-username"]');
  
  if (!usernameElement) return;
  
  // Get lowercase username for case-insensitive matching
  const username = usernameElement.textContent.trim().toLowerCase();
  
  // Check if this is the current user
  if (extensionState.currentUser && username === extensionState.currentUser.toLowerCase()) {
    // Get user's actual rank from Riot data
    chrome.storage.local.get(['eloward_persistent_riot_user_data'], (data) => {
      const riotData = data.eloward_persistent_riot_user_data;
      
      if (riotData?.rankInfo) {
        // Convert the Riot rank format to our format
        const userRankData = {
          tier: riotData.rankInfo.tier,
          division: riotData.rankInfo.rank, // In Riot API, "rank" is the division
          leaguePoints: riotData.rankInfo.leaguePoints,
          summonerName: riotData.gameName
        };
        
        // Update the background cache
        chrome.runtime.sendMessage({
          action: 'set_rank_data',
          username: username,
          rankData: userRankData
        });
        
        // Increment metrics for the current channel
        if (extensionState.channelName) {
          chrome.runtime.sendMessage({
            action: 'increment_db_reads',
            channel: extensionState.channelName
          });
          
          chrome.runtime.sendMessage({
            action: 'increment_successful_lookups',
            channel: extensionState.channelName
          });
        }
        
        // Display the badge immediately
        addBadgeToMessage(usernameElement, userRankData);
      }
    });
    return;
  }
  
  // For other users, fetch rank from background script
  fetchRankFromBackground(username, usernameElement);
}

function fetchRankFromBackground(username, usernameElement) {
  try {
    chrome.runtime.sendMessage(
      { 
        action: 'fetch_rank_for_username',
        username: username,
        channel: extensionState.channelName
      },
      response => {
        if (chrome.runtime.lastError) return;
        
        if (response?.success && response.rankData) {
          // Add the badge to the message
          addBadgeToMessage(usernameElement, response.rankData);
        }
      }
    );
  } catch (error) {
    console.error("Error sending rank lookup message:", error);
  }
}

function addBadgeToMessage(usernameElement, rankData) {
  // Skip if no rank data
  if (!rankData?.tier) return; 
  
  // Check if badge already exists in this message
  const messageContainer = usernameElement.closest('.chat-line__message, .chat-line');
  if (messageContainer?.querySelector('.eloward-rank-badge')) return;
  
  // Create badge container
  const badgeContainer = document.createElement('div');
  badgeContainer.className = 'eloward-rank-badge';
  
  // Store rank text as a data attribute for tooltip
  badgeContainer.dataset.rankText = formatRankText(rankData);
  
  // Create the rank image
  const rankImg = document.createElement('img');
  rankImg.alt = rankData.tier;
  rankImg.className = 'chat-badge';
  rankImg.width = 24;
  rankImg.height = 24;
  
  // Set image source based on rank tier
  try {
    const tier = rankData.tier.toLowerCase();
    rankImg.src = `https://eloward-cdn.unleashai.workers.dev/lol/${tier}.png`;
  } catch (error) {
    console.error("Error setting badge image source:", error);
    return;
  }
  
  // Add the image to the badge container
  badgeContainer.appendChild(rankImg);
  
  // Setup tooltip functionality
  badgeContainer.addEventListener('mouseenter', showTooltip);
  badgeContainer.addEventListener('mouseleave', hideTooltip);
  
  // Store rank data as attributes for tooltip
  badgeContainer.dataset.rank = rankData.tier;
  badgeContainer.dataset.division = rankData.division || '';
  badgeContainer.dataset.lp = rankData.leaguePoints !== undefined && rankData.leaguePoints !== null ? 
                              rankData.leaguePoints.toString() : '';
  badgeContainer.dataset.username = rankData.summonerName || '';
  
  // Insert badge using the most reliable method - before the username element
    usernameElement.parentNode.insertBefore(badgeContainer, usernameElement);
}

function formatRankText(rankData) {
  if (!rankData || !rankData.tier || rankData.tier.toUpperCase() === 'UNRANKED') {
    return 'UNRANKED';
  }
  
  let rankText = rankData.tier;
  
  // Add division for ranks that have divisions (not Master, Grandmaster, Challenger)
  if (rankData.division && !['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(rankData.tier.toUpperCase())) {
    rankText += ' ' + rankData.division;
  }
  
  // Add LP for ranked players (not for Unranked)
  if (rankData.tier.toUpperCase() !== 'UNRANKED' && 
      rankData.leaguePoints !== undefined && 
      rankData.leaguePoints !== null) {
    rankText += ' - ' + rankData.leaguePoints + ' LP';
  }
  
  if (rankData.summonerName) {
    rankText += ` (${rankData.summonerName})`;
  }
  
  return rankText;
}

// Tooltip functions
function showTooltip(event) {
  // Clear any existing timeout
  if (tooltipShowTimeout) {
    clearTimeout(tooltipShowTimeout);
  }

  // Create tooltip element if it doesn't exist globally
  if (!tooltipElement) {
    tooltipElement = document.createElement('div');
    tooltipElement.className = 'eloward-tooltip';
    document.body.appendChild(tooltipElement);
  }
  
  // Get rank data from the badge's dataset
  const badge = event.currentTarget;
  const rankTier = badge.dataset.rank || 'UNRANKED';
  const division = badge.dataset.division || '';
  
  // Ensure LP is properly formatted
  let lp = badge.dataset.lp || '';
  // If LP is a number, make sure it's formatted properly
  if (lp && !isNaN(Number(lp))) {
    lp = Number(lp).toString(); // Convert to clean number string
  }
  
  const username = badge.dataset.username || '';
  
  // Format the tooltip text using same logic as formatRankText
  // Handle unranked case
  if (!rankTier || rankTier.toUpperCase() === 'UNRANKED') {
    tooltipElement.textContent = 'Unranked';
  } else {
    // For ranked players
    // Properly capitalize the rank tier (only first letter uppercase)
    let formattedTier = rankTier.toLowerCase();
    formattedTier = formattedTier.charAt(0).toUpperCase() + formattedTier.slice(1);
    
    let tooltipText = formattedTier;
    
    // Add division for ranks that have divisions
    if (division && !['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(rankTier.toUpperCase())) {
      tooltipText += ' ' + division;
    }
    
    // Always include LP for ranked players
    if (lp !== undefined && lp !== null && lp !== '') {
      tooltipText += ' - ' + lp + ' LP';
    }
    
    // Set the tooltip content
    tooltipElement.textContent = tooltipText;
  }
  
  // First reset the tooltip state and make it invisible
  tooltipElement.style.visibility = 'hidden';
  tooltipElement.style.transform = 'translate(-30%, -100%) scale(0.9)';
  tooltipElement.style.opacity = '0';
  tooltipElement.classList.remove('visible');
  
  // Position after a delay
  tooltipShowTimeout = setTimeout(() => {
    // Get badge position
    const rect = badge.getBoundingClientRect();
    const badgeCenter = rect.left + (rect.width / 2);
    
    // Position tooltip above the badge with an offset for left-shifted arrow
    tooltipElement.style.left = `${badgeCenter}px`;
    tooltipElement.style.top = `${rect.top - 5}px`;
    
    // Make the element visible but with 0 opacity first
    tooltipElement.style.visibility = 'visible';
    
    // Force a reflow to ensure the browser registers the initial state
    tooltipElement.offsetHeight;
    
    // Then add the visible class to trigger the transition
    tooltipElement.classList.add('visible');
  }, 300);
}

function hideTooltip() {
  // Clear any pending show timeout
  if (tooltipShowTimeout) {
    clearTimeout(tooltipShowTimeout);
    tooltipShowTimeout = null;
  }
  
  if (tooltipElement && tooltipElement.classList.contains('visible')) {
    // Animate out - fade and scale down slightly
    tooltipElement.style.opacity = '0';
    tooltipElement.style.transform = 'translate(-30%, -100%) scale(0.9)';
    
    // Remove visible class after animation completes
    setTimeout(() => {
      tooltipElement.classList.remove('visible');
    }, 100);
  }
}

// Add the CSS needed for badges
function addExtensionStyles() {
  if (document.querySelector('#eloward-extension-styles')) return;
  
  const styleElement = document.createElement('style');
  styleElement.id = 'eloward-extension-styles';
  styleElement.textContent = `
    .eloward-rank-badge {
      display: inline-flex !important;
      justify-content: center !important;
      align-items: center !important;
      margin-left: 0px !important;
      margin-right: 0px !important;
      margin-top: -2.5px !important;
      vertical-align: middle !important;
      cursor: pointer !important;
      transform: none !important;
      transition: none !important;
      width: 24px !important;
      height: 24px !important;
      box-sizing: content-box !important;
      -webkit-user-select: none !important;
      user-select: none !important;
      -webkit-touch-callout: none !important;
    }
    
    .eloward-rank-badge:hover {
      transform: none !important;
      scale: 1 !important;
    }
    
    .eloward-rank-badge img {
      display: block !important;
      width: 24px !important;
      height: 24px !important;
      transform: none !important;
      transition: none !important;
      object-fit: contain !important;
    }
    
    .eloward-rank-badge img:hover {
      transform: none !important;
      scale: 1 !important;
    }
    
    /* Chat bubble style tooltip - base styles */
    .eloward-tooltip {
      position: absolute !important;
      z-index: 99999 !important;
      pointer-events: none !important;
      transform: translate(-12%, -100%) scale(0.9) !important; /* Bubble position: adjust -30% to shift left/right */
      font-size: 13px !important;
      font-weight: 600 !important;
      font-family: Roobert, "Helvetica Neue", Helvetica, Arial, sans-serif !important;
      white-space: nowrap !important;
      padding: 4px 6px !important; /* Reduced padding */
      border-radius: 6px !important; /* Increased corner roundness (was 3px) */
      line-height: 1.2 !important;
      opacity: 0 !important;
      transition: opacity 0.07s ease-in-out, transform 0.07s ease-in-out !important;
      text-align: center !important;
      border: none !important;
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.3) !important;
      margin-top: -2px !important; /* Offset to position it nicely */
      will-change: transform, opacity !important; /* Hint for browser to optimize animations */
    }
    
    /* Dark theme Twitch - show light tooltip */
    html.tw-root--theme-dark .eloward-tooltip,
    .tw-root--theme-dark .eloward-tooltip,
    body[data-a-theme="dark"] .eloward-tooltip,
    body.dark-theme .eloward-tooltip {
      color: #0e0e10 !important;
      background-color: white !important;
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.3) !important;
    }
    
    html.tw-root--theme-dark .eloward-tooltip::after,
    .tw-root--theme-dark .eloward-tooltip::after,
    body[data-a-theme="dark"] .eloward-tooltip::after,
    body.dark-theme .eloward-tooltip::after {
      border-color: white transparent transparent transparent !important;
    }
    
    /* Light theme Twitch - show dark tooltip */
    html.tw-root--theme-light .eloward-tooltip,
    .tw-root--theme-light .eloward-tooltip,
    body[data-a-theme="light"] .eloward-tooltip,
    body:not(.dark-theme):not([data-a-theme="dark"]) .eloward-tooltip {
      color: #efeff1 !important;
      background-color: #0e0e10 !important;
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.4) !important;
    }
    
    html.tw-root--theme-light .eloward-tooltip::after,
    .tw-root--theme-light .eloward-tooltip::after,
    body[data-a-theme="light"] .eloward-tooltip::after,
    body:not(.dark-theme):not([data-a-theme="dark"]) .eloward-tooltip::after {
      border-color: #0e0e10 transparent transparent transparent !important;
    }
    
    /* Chat bubble arrow at bottom pointing toward badge, offset to the left */
    .eloward-tooltip::after {
      content: "" !important;
      position: absolute !important;
      bottom: -4px !important; /* Position at bottom */
      left: 10% !important; /* Stem position: adjust this % to move stem left/right */
      margin-left: -4px !important;
      border-width: 4px 4px 0 4px !important; /* Arrow pointing down */
      border-style: solid !important;
    }
    
    .eloward-tooltip.visible {
      opacity: 1 !important;
      transform: translate(-12%, -100%) scale(1) !important; /* Bubble position when visible: must match transform above */
    }
  `;
  
  document.head.appendChild(styleElement);
} 