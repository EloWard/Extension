const DEBUG_MODE = false; // Set to false for production release

// Global state
let isChannelSubscribed = false;
let channelName = '';
let processedMessages = new Set();
let observerInitialized = false;
let tooltipElement = null; // Global tooltip element
let currentUser = null; // Current user's Twitch username
let currentGame = null; // Current game being streamed

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

// Initialize when the page is loaded
initializeExtension();

// Also set a delayed initialization to catch slow-loading pages
setTimeout(initializeExtension, 3000);

// Add a window.onload handler as an additional initialization method
window.addEventListener('load', function() {
  initializeExtension();
});

// Listen for URL changes (for SPA navigation)
window.addEventListener('popstate', function() {
  initializeExtension();
});

// Clear rank cache when user closes tab or navigates away from Twitch
window.addEventListener('beforeunload', function() {
  console.log('👋 UserRankCache: Cleared on page unload/navigation');
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
  
  if (DEBUG_MODE) {
    console.log(`EloWard: Rank cache cleared (preserved ${currentUser || 'no user'}'s data)`);
  }
}

// Initialize storage and load user data
function initializeStorage() {
  chrome.storage.local.get(null, (allData) => {
    // Find current user in storage using consolidated logic
    currentUser = findCurrentUser(allData);
    
    // Send current user to background script to protect from cache eviction
    if (currentUser) {
      chrome.runtime.sendMessage({
        action: 'set_current_user',
        username: currentUser
      });
    }
  });
}

// Find current Twitch user from various storage formats
function findCurrentUser(allData) {
  // Check storage in order of preference
  if (allData.eloward_persistent_twitch_user_data?.login) {
    const twitchData = allData.eloward_persistent_twitch_user_data;
    return twitchData.login.toLowerCase();
  } 
  
  if (allData.twitchUsername) {
    return allData.twitchUsername.toLowerCase();
  }
  
  if (allData.eloward_twitch_user_info?.login) {
    const twitchInfo = allData.eloward_twitch_user_info;
    return twitchInfo.login.toLowerCase();
  }
  
  // Search through all keys for possible Twitch data as last resort
  for (const key in allData) {
    if (key.toLowerCase().includes('twitch')) {
      const data = allData[key];
      if (data && typeof data === 'object' && (data.login || data.display_name)) {
        return (data.login || data.display_name).toLowerCase();
      }
    }
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
  
  // Normalize channel name
  const normalizedChannel = channelName.toLowerCase();
  
  try {
    return new Promise((resolve) => {
      // Send message to background script to check subscription
      chrome.runtime.sendMessage(
        { 
          action: 'check_streamer_subscription', 
          streamer: channelName,
          // No need for cache at this level since we only check on channel load/change
          skipCache: true
        },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve(false);
            return;
          }
          
          // Extract the boolean value with casting to ensure it's a boolean
          const isSubscribed = response && response.subscribed === true;
          
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
 * Get the current channel name using multiple fallback methods
 * 1. Try to find the channel name in Twitch's data elements
 * 2. Parse from URL if data elements aren't available
 * @returns {string|null} The current channel name or null if not found
 */
function getCurrentChannelName() {
  // Method 1: Try to get from Twitch's channel data in the DOM
  // This is the most reliable method across all viewing modes
  const channelElem = document.querySelector('[data-a-target="channel-display-name"], [data-a-target="user-display-name"]');
  if (channelElem && channelElem.textContent) {
    return channelElem.textContent.trim().toLowerCase();
  }
  
  // Method 2: Try to get from channel header element
  const channelHeader = document.querySelector('.channel-info-content h1, .tw-channel-header h1');
  if (channelHeader && channelHeader.textContent) {
    return channelHeader.textContent.trim().toLowerCase();
  }
  
  // Method 3: Try to extract from the URL
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
  
  // Method 4: Try to find from other Twitch UI elements as last resort
  const channelLink = document.querySelector('a[data-a-target="stream-game-link"]')?.closest('div')?.querySelector('a:not([data-a-target="stream-game-link"])');
  if (channelLink) {
    const channelPath = new URL(channelLink.href).pathname;
    const channelNameFromLink = channelPath.split('/')[1];
    if (channelNameFromLink) {
      return channelNameFromLink.toLowerCase();
    }
  }
  
  // Could not determine channel name
  return null;
}

/**
 * Get the current game being played by the streamer
 * @returns {string|null} The game name or null if not found
 */
function getCurrentGame() {
  try {
    // Method 1: Try to find the game link in the channel info section
    const gameLink = document.querySelector('a[data-a-target="stream-game-link"]');
    if (gameLink && gameLink.textContent) {
      const game = gameLink.textContent.trim();
      if (DEBUG_MODE) console.log(`EloWard: Game detected (Method 1): ${game}`);
      return game;
    }
    
    // Method 2: Alternative selectors - looking for game info in different DOM structures
    const gameLinkAlternative = document.querySelector('.game-hover, .tw-card-title[title], [data-test-selector="game-card-title"]');
    if (gameLinkAlternative && gameLinkAlternative.textContent) {
      const game = gameLinkAlternative.textContent.trim();
      if (DEBUG_MODE) console.log(`EloWard: Game detected (Method 2): ${game}`);
      return game;
    }
    
    // Method 3: Look for game name in meta tags
    const metaGame = document.querySelector('meta[property="og:game"]');
    if (metaGame && metaGame.getAttribute('content')) {
      const game = metaGame.getAttribute('content').trim();
      if (DEBUG_MODE) console.log(`EloWard: Game detected (Method 3): ${game}`);
      return game;
    }
    
    // Method 4: Look for structured data in the page
    const structuredData = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    for (const script of structuredData) {
      try {
        const data = JSON.parse(script.textContent);
        if (data.genre || data.applicationCategory) {
          const game = data.genre || data.applicationCategory;
          if (DEBUG_MODE) console.log(`EloWard: Game detected (Method 4): ${game}`);
          return game;
        }
      } catch (e) {
        // Continue to next script if JSON parsing fails
      }
    }
    
    // Method 5: Parse from the URL if it's a game directory
    if (window.location.pathname.startsWith('/directory/game/') || window.location.pathname.startsWith('/directory/category/')) {
      const pathSegments = window.location.pathname.split('/');
      if (pathSegments.length >= 4) {
        const game = decodeURIComponent(pathSegments[3]);
        if (DEBUG_MODE) console.log(`EloWard: Game detected (Method 5): ${game}`);
        return game;
      }
    }
    
    if (DEBUG_MODE) console.log(`EloWard: No game detected from DOM`);
    return null;
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
        if (DEBUG_MODE) console.log(`EloWard: Retry attempt ${attempts}/${maxAttempts} to detect game`);
        setTimeout(tryGetGame, interval);
      } else {
        if (DEBUG_MODE) console.log(`EloWard: Failed to detect game after ${maxAttempts} attempts`);
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
    if (newGame !== currentGame) {
      const oldGame = currentGame;
      currentGame = newGame;
      
      console.log(`EloWard: Game changed from ${oldGame || 'unknown'} to ${newGame}`);
      
      // Clean up existing chat observer
      if (window._eloward_chat_observer) {
        window._eloward_chat_observer.disconnect();
        window._eloward_chat_observer = null;
        observerInitialized = false;
      }
      
      // Reset extension state based on game support
      if (isGameSupported(newGame)) {
        console.log(`EloWard: Supported game '${newGame}' detected. Activating extension.`);
        
        // Only check subscription if the game is supported
        checkChannelSubscription(channelName, false)
          .then(subscribed => {
            isChannelSubscribed = subscribed;
            
            if (isChannelSubscribed) {
              console.log("🛡️ EloWard Extension Active");
              
              if (!observerInitialized) {
                initializeObserver();
              }
            }
          });
      } else {
        // Deactivate extension for unsupported games
        console.log(`EloWard: Game '${newGame}' is not supported. Extension inactive.`);
        isChannelSubscribed = false;
        observerInitialized = false;
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
  // Get channel name using the new reliable method
  const newChannelName = getCurrentChannelName();
  
  // If no channel name or we're on an auth-related path, don't do anything
  if (!newChannelName || 
      window.location.pathname.includes('oauth2') ||
      window.location.pathname.includes('auth/') ||
      window.location.href.includes('auth/callback') ||
      window.location.href.includes('auth/redirect')) {
    return;
  }
  
  // Check if we've changed channels
  const channelChanged = newChannelName !== channelName;
  if (channelChanged) {
    // Notify background about channel switch
    chrome.runtime.sendMessage({
      action: 'channel_switched',
      oldChannel: channelName,
      newChannel: newChannelName
    });
    
    // Update the channel name
    channelName = newChannelName;
    
    // Reset state when changing channels
    isChannelSubscribed = false;
    observerInitialized = false;
    
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
    observerInitialized = false;
  }
  
  // Attempt to detect the game with retries
  getGameWithRetries().then(detectedGame => {
    // Update current game state
    currentGame = detectedGame;
    
    if (DEBUG_MODE) {
      console.log(`EloWard: Current game is ${currentGame || 'unknown'}`);
    }
    
    // Only proceed if the current game is supported
    if (!isGameSupported(currentGame)) {
      console.log(`EloWard: Game '${currentGame || 'unknown'}' is not supported. Extension inactive.`);
      return;
    }
    
    console.log(`EloWard: Supported game '${currentGame}' detected`);
    
    // Setup game change observer to detect mid-stream game switches
    setupGameChangeObserver();
    
    // Only force check subscription status on channel changes
    // Otherwise use the cached value to reduce API calls
    checkChannelSubscription(channelName, channelChanged)
      .then(subscribed => {
        isChannelSubscribed = subscribed;
        
        if (isChannelSubscribed) {
          // Only print the activation message when the channel is subscribed
          console.log("🛡️ EloWard Extension Active");
          
          if (!observerInitialized) {
            initializeObserver();
          }
        } else if (!isChannelSubscribed) {
          // Clean up any existing observers
          if (window._eloward_chat_observer) {
            window._eloward_chat_observer.disconnect();
            window._eloward_chat_observer = null;
          }
          observerInitialized = false;
        }
      });
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
    if (currentChannel !== channelName) {
      // Reset state
      channelName = currentChannel;
      observerInitialized = false;
      isChannelSubscribed = false;
      
      // Clear rank cache but preserve current user's rank
      clearRankCache();
      
      // Remove any existing observers
      if (window._eloward_chat_observer) {
        window._eloward_chat_observer.disconnect();
        window._eloward_chat_observer = null;
      }
      
      // Check if game observer needs to be reset
      if (window._eloward_game_observer) {
        window._eloward_game_observer.disconnect();
        window._eloward_game_observer = null;
      }
      
      // Reinitialize with new channel
      // This will trigger a fresh subscription check since channel changed
      initializeExtension();
    }
  });
  
  // Start observing the document for URL changes
  urlObserver.observe(document, { subtree: true, childList: true });
  
  // Store observer for reference
  window._eloward_url_observer = urlObserver;
}

function initializeObserver() {
  if (observerInitialized) {
    return;
  }
  
  const chatContainer = findChatContainer();
  
  if (chatContainer) {
    // Chat container found, set up the observer
    setupChatObserver(chatContainer);
    observerInitialized = true;
    
    // Also set up a fallback observer for the whole chat area
    const chatArea = document.querySelector('.chat-room, .right-column, [data-test-selector="chat-room"]');
    if (chatArea && chatArea !== chatContainer) {
      setupChatObserver(chatArea, true);
    }
  } else {
    // Chat container not found yet, wait and try again
    setTimeout(() => {
      const chatContainer = findChatContainer();
      
      if (chatContainer) {
        setupChatObserver(chatContainer);
        observerInitialized = true;
      } else {
        // Last resort: observe the whole right column
        const rightColumn = document.querySelector('.right-column, [data-test-selector="right-column"]');
        if (rightColumn) {
          setupChatObserver(rightColumn, true);
          observerInitialized = true;
        }
      }
    }, 2000);
  }
}

function findChatContainer() {
  // Try to find chat container using multiple selectors
  const potentialContainers = [
    // Standard Twitch chat selectors
    document.querySelector('.chat-scrollable-area__message-container'),
    document.querySelector('[data-a-target="chat-scroller"]'),
    document.querySelector('.chat-list--default, .chat-list'),
    document.querySelector('.chat-list__list'),
    
    // 7TV specific selectors
    document.querySelector('.seventv-chat-list'),
    document.querySelector('main[data-a-target="chat-main-container"]'),
    
    // BetterTTV specific selectors 
    document.querySelector('.chat-list--default, .chat-list--other'),
    document.querySelector('.bttv-chat-container')
  ].filter(Boolean); // Remove null elements
  
  for (const container of potentialContainers) {
    // Look for elements that might contain chat messages
    const usernameElements = container.querySelectorAll(
      '.chat-author__display-name, [data-a-target="chat-message-username"], ' + 
      '.seventv-chat-user, .seventv-chat-author, ' +
      '.chat-line__username'
    );
    
    if (usernameElements.length > 0) {
      return container;
    }
  }
  
  // Ultimate fallback - get the chat container by looking for any chat message
  const anyMessage = document.querySelector(
    '.chat-line__message, .chat-line, .seventv-chat-message'
  );
  
  if (anyMessage) {
    return anyMessage.closest('[role="log"]') || 
           anyMessage.parentElement || 
           anyMessage.closest('div[data-a-target="chat-scroller"]');
  }
  
  return null;
}

function setupChatObserver(chatContainer, isFallbackObserver = false) {
  // Create a MutationObserver to watch for new chat messages
  const chatObserver = new MutationObserver((mutations) => {
    // Process messages only if channel is subscribed
    if (!isChannelSubscribed) return;
    
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if this is a chat message using multiple extension-aware selectors
            const isMessage = node.classList && (
              node.classList.contains('chat-line__message') || 
              node.classList.contains('chat-line') ||
              node.classList.contains('seventv-chat-message') ||
              node.classList.contains('bttv-message') ||
              node.querySelector('.chat-author__display-name, [data-a-target="chat-message-username"], .seventv-chat-user, .seventv-chat-author, .chat-line__username')
            );
            
            if (isMessage) {
              processNewMessage(node);
            } else if (isFallbackObserver) {
              // For fallback observers, look deeper for chat messages from any extension
              const messages = node.querySelectorAll(
                '[data-a-target="chat-line-message"], .chat-line__message, .chat-line, ' +
                '.seventv-chat-message, .seventv-chat-line, ' +
                '.bttv-message, .bttv-chat-line'
              );
              messages.forEach(message => {
                processNewMessage(message);
              });
            }
          }
        }
      }
    }
  });
  
  // Start observing the chat container
  chatObserver.observe(chatContainer, {
    childList: true,
    subtree: true // Always use subtree: true to catch changes made by other extensions
  });
  
  // Also process any existing messages, supporting multiple extensions' formats
  const existingMessages = chatContainer.querySelectorAll(
    '[data-a-target="chat-line-message"], .chat-line__message, .chat-line, ' +
    '.seventv-chat-message, .seventv-chat-line, ' +
    '.bttv-message, .bttv-chat-line'
  );
    
  for (const message of existingMessages) {
    processNewMessage(message);
  }
}

function processNewMessage(messageNode) {
  // Skip if we've already processed this message or too many processed
  if (processedMessages.has(messageNode)) return;
  
  // Memory management - clear if too many messages
  if (processedMessages.size > 1000) {
    processedMessages.clear();
  }
  
  // Mark this message as processed
  processedMessages.add(messageNode);
  
  // Only process messages if the channel is subscribed
  // This relies on the cached subscription status from sessionStorage
  if (!isChannelSubscribed) return;
  
  // Find username element - support various extensions' DOM structures
  let usernameElement = messageNode.querySelector(
    // Standard Twitch selectors
    '.chat-author__display-name, [data-a-target="chat-message-username"], ' +
    // 7TV specific selectors
    '.seventv-chat-user, .seventv-chat-author, ' +
    // BetterTTV specific selectors
    '.chat-line__username'
  );
  
  if (!usernameElement) return;
  
  // Get lowercase username for case-insensitive matching
  const username = usernameElement.textContent.trim().toLowerCase();
  
  // Check if this is the current user
  if (currentUser && username === currentUser.toLowerCase()) {
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
        if (channelName) {
          // Increment db_reads counter
          chrome.runtime.sendMessage({
            action: 'increment_db_reads',
            channel: channelName
          });
          
          // Increment successful_lookups counter
          chrome.runtime.sendMessage({
            action: 'increment_successful_lookups',
            channel: channelName
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
        channel: channelName
      },
      response => {
        if (chrome.runtime.lastError) return;
        
        if (response?.success && response.rankData) {
          // Add the badge to the message
          addBadgeToMessage(usernameElement, response.rankData);
          
          // Log cache hits vs misses for performance monitoring
          if (DEBUG_MODE) {
            const source = response.source || 'unknown';
            console.log(`EloWard: Rank data for ${username} from ${source}`);
          }
        }
      }
    );
  } catch (error) {
    console.error("Error sending rank lookup message:", error);
  }
}

function addBadgeToMessage(usernameElement, rankData) {
  // Skip if no rank data (rankData object itself might be null/undefined)
  if (!rankData?.tier) return; 
  
  // Check if badge already exists in this message
  const messageContainer = usernameElement.closest('.chat-line__message') || usernameElement.closest('.chat-line') || usernameElement.closest('.seventv-chat-message');
  if (messageContainer?.querySelector('.eloward-rank-badge')) return;
  
  // Get the parent container that holds the username
  // Support multiple extension structures - standard Twitch, 7TV, and BetterTTV
  const usernameContainer = usernameElement.closest('.chat-line__username-container') || 
                            usernameElement.closest('.seventv-chat-badges-container')?.parentElement || 
                            usernameElement.closest('[data-test-selector="chat-message-username"]')?.parentElement;
                            
  if (usernameContainer?.querySelector('.eloward-rank-badge')) return;
  
  // Create badge container
  const badgeContainer = document.createElement('div');
  badgeContainer.className = 'eloward-rank-badge';
  
  // Store rank text as a data attribute instead of title to avoid browser tooltip
  badgeContainer.dataset.rankText = formatRankText(rankData);
  
  // Create the rank image
  const rankImg = document.createElement('img');
  rankImg.alt = rankData.tier;
  rankImg.className = 'chat-badge'; // Add Twitch's chat-badge class for better styling
  rankImg.width = 24;
  rankImg.height = 24;
  
  // Set image source based on rank tier - use CDN
  try {
    const tier = rankData.tier.toLowerCase();
    rankImg.src = `https://eloward-cdn.unleashai.workers.dev/lol/${tier}.png`;
  } catch (error) {
    console.error("Error setting badge image source:", error);
    return; // Don't continue if we can't get the image
  }
  
  // Add the image to the badge container
  badgeContainer.appendChild(rankImg);
  
  // Setup tooltip functionality
  badgeContainer.addEventListener('mouseenter', showTooltip);
  badgeContainer.addEventListener('mouseleave', hideTooltip);
  
  // Convert leaguePoints to string to ensure consistent storage
  const lpValue = rankData.leaguePoints !== undefined && rankData.leaguePoints !== null ? 
                 rankData.leaguePoints.toString() : '';
  
  // Store rank data as attributes for tooltip
  badgeContainer.dataset.rank = rankData.tier;
  badgeContainer.dataset.division = rankData.division || '';
  badgeContainer.dataset.lp = lpValue;
  badgeContainer.dataset.username = rankData.summonerName || '';
  
  // Insert the badge in the appropriate location based on the extension environment
  if (usernameContainer) {
    // Check if 7TV is active by looking for its elements
    const isSevenTV = !!document.querySelector('#seventv-extension') || 
                     !!usernameContainer.closest('.seventv-chat-message') || 
                     !!usernameElement.closest('.seventv-chat-badges-container');
                     
    // Check if BetterTTV is active
    const isBTTV = !!document.querySelector('.bttv-tooltip') || 
                  !!usernameContainer.querySelector('.bttv-badge');
    
    if (isSevenTV) {
      // 7TV-specific insertion logic
      const badgesContainer = usernameContainer.querySelector('.seventv-chat-badges-container') || 
                             usernameContainer.querySelector('.chat-badge-container');
      
      if (badgesContainer) {
        // Append to the badge container (makes it rightmost)
        badgesContainer.appendChild(badgeContainer);
      } else {
        // Find the username span and insert before it (typical 7TV structure)
        const usernameSpan = usernameContainer.querySelector('[data-a-target="chat-message-username"], .chat-author__display-name');
        if (usernameSpan) {
          usernameContainer.insertBefore(badgeContainer, usernameSpan);
        } else {
          // Last resort fallback - insert at the end
          usernameContainer.appendChild(badgeContainer);
        }
      }
    } else if (isBTTV) {
      // BetterTTV-specific insertion logic
      const badgesContainer = usernameContainer.querySelector('.chat-badge-container, .bttv-badges-container');
      
      if (badgesContainer) {
        // Add to the end of badges container (makes it rightmost)
        badgesContainer.appendChild(badgeContainer);
      } else {
        // Find the username span that follows the badges 
        const usernameSpan = usernameContainer.querySelector('.chat-line__username, .chat-author__display-name').closest('span');
        // Insert the badge right before the username span (making it the rightmost badge)
        usernameContainer.insertBefore(badgeContainer, usernameSpan);
      }
    } else {
      // Standard Twitch insertion
      const badgesContainer = usernameContainer.querySelector('.chat-badge-container');
      
      if (badgesContainer) {
        // Add to the end of badges container (makes it rightmost)
        badgesContainer.appendChild(badgeContainer);
      } else {
        // Find the username span that follows the badges
        const usernameSpan = usernameContainer.querySelector('.chat-line__username, .chat-author__display-name').closest('span');
        
        // Insert the badge right before the username span (making it the rightmost badge)
        usernameContainer.insertBefore(badgeContainer, usernameSpan);
      }
    }
  } else {
    // Fallback
    usernameElement.parentNode.insertBefore(badgeContainer, usernameElement);
  }
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
    
    // Debug logging if enabled
    if (DEBUG_MODE) {
      console.debug('Tooltip data:', {
        rank: rankTier,
        division: division,
        lp: lp,
        username: username,
        displayText: tooltipText
      });
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