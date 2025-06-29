// Extension state management
const extensionState = {
  isChannelSubscribed: false,
  channelName: '',
  currentGame: null,
  currentUser: null,
  observerInitialized: false,
  lastSubscriptionCheck: null,
  initializationInProgress: false,
  currentInitializationId: null
};

// Channel state tracking
const channelState = {
  activeChannels: new Set(),
  subscribedChannels: new Set(),
  currentChannel: null,
  activeAbortController: null
};

// Processing state
let processedMessages = new Set();
let tooltipElement = null;

// Supported games
const SUPPORTED_GAMES = {
  'League of Legends': true
};

// Tooltip delay
let tooltipShowTimeout = null;

// Initialize extension
initializeStorage();

// Always setup URL observer first, regardless of current page
setupUrlChangeObserver();

// Then initialize if on a channel page
initializeExtension();

// Handle SPA navigation
window.addEventListener('popstate', function() {
  if (!extensionState.initializationInProgress) {
    initializeExtension();
  }
});

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
  if (extensionState.channelName) {
    cleanupChannel(extensionState.channelName);
  }
  clearRankCache();
});

/**
 * Clear rank cache and processed messages
 */
function clearRankCache() {
  chrome.runtime.sendMessage({ action: 'clear_rank_cache' });
  processedMessages.clear();
}

/**
 * Clean up state when leaving a channel
 */
function cleanupChannel(channelName) {
  if (!channelName) return;
  
  const normalizedChannel = channelName.toLowerCase();
  
  if (channelState.activeAbortController) {
    channelState.activeAbortController.abort();
    channelState.activeAbortController = null;
  }
  
  channelState.activeChannels.delete(normalizedChannel);
  channelState.subscribedChannels.delete(normalizedChannel);
  processedMessages.clear();
  
  if (window._eloward_chat_observer) {
    window._eloward_chat_observer.disconnect();
    window._eloward_chat_observer = null;
  }
  
  if (window._eloward_game_observer) {
    window._eloward_game_observer.disconnect();
    window._eloward_game_observer = null;
  }
  
  // Reset state for fresh detection
  extensionState.observerInitialized = false;
  extensionState.isChannelSubscribed = false;
  extensionState.lastSubscriptionCheck = null;
  extensionState.initializationInProgress = false;
  extensionState.currentInitializationId = null;
  extensionState.currentGame = null;
}

/**
 * Initialize channel and check subscription
 */
async function initializeChannel(channelName, initializationId) {
  if (!channelName) return false;
  
  const normalizedChannel = channelName.toLowerCase();
  const abortController = new AbortController();
  channelState.activeAbortController = abortController;
  
  try {
    if (extensionState.currentInitializationId !== initializationId) {
      return false;
    }
    
    channelState.activeChannels.add(normalizedChannel);
    channelState.currentChannel = normalizedChannel;
    
    const isSubscribed = await checkChannelSubscription(channelName, true, abortController.signal);
    
    if (extensionState.currentInitializationId !== initializationId || abortController.signal.aborted) {
      return false;
    }
    
    if (isSubscribed) {
      channelState.subscribedChannels.add(normalizedChannel);
      extensionState.isChannelSubscribed = true;
      console.log(`EloWard: ${channelName} - Subscribed ✅`);
    } else {
      channelState.subscribedChannels.delete(normalizedChannel);
      extensionState.isChannelSubscribed = false;
      console.log(`EloWard: ${channelName} - Not Subscribed ❌`);
    }
    
    return isSubscribed;
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error(`EloWard: Error initializing channel ${channelName}:`, error);
    }
    return false;
  }
}

// Initialize storage and load user data (preserved across sessions)
function initializeStorage() {
  chrome.storage.local.get(null, (allData) => {
    extensionState.currentUser = findCurrentUser(allData);
    
    if (extensionState.currentUser) {
      chrome.runtime.sendMessage({
        action: 'set_current_user',
        username: extensionState.currentUser
      });
      console.log(`EloWard: Current user identified as ${extensionState.currentUser} (from persistent storage)`);
    }
  });
}

// Find current Twitch user from storage (prioritizes persistent storage)
function findCurrentUser(allData) {
  // Check persistent storage first (preserved even when tokens expire)
  if (allData.eloward_persistent_twitch_user_data?.login) {
    return allData.eloward_persistent_twitch_user_data.login.toLowerCase();
  } 
  
  // Fallback to legacy storage keys
  if (allData.twitchUsername) {
    return allData.twitchUsername.toLowerCase();
  }
  
  return null;
}

/**
 * Check if channel is subscribed with caching
 */
async function checkChannelSubscription(channelName, forceCheck = false, signal = null) {
  if (!channelName) return false;
  
  if (signal?.aborted) {
    throw new DOMException('Operation aborted', 'AbortError');
  }
  
  // Use cache unless forced to check
  const now = Date.now();
  if (!forceCheck && 
      extensionState.lastSubscriptionCheck && 
      extensionState.channelName === channelName && 
      (now - extensionState.lastSubscriptionCheck) < 30000) {
    return extensionState.isChannelSubscribed;
  }
  
  try {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Operation aborted', 'AbortError'));
        return;
      }
      
      const abortListener = () => {
        reject(new DOMException('Operation aborted', 'AbortError'));
      };
      
      if (signal) {
        signal.addEventListener('abort', abortListener, { once: true });
      }
      
      chrome.runtime.sendMessage(
        { 
          action: 'check_streamer_subscription', 
          streamer: channelName,
          skipCache: true
        },
        (response) => {
          if (signal) {
            signal.removeEventListener('abort', abortListener);
          }
          
          if (signal?.aborted) {
            reject(new DOMException('Operation aborted', 'AbortError'));
            return;
          }
          
          if (chrome.runtime.lastError) {
            resolve(false);
            return;
          }
          
          const isSubscribed = response && response.subscribed === true;
          
          if (!signal?.aborted) {
            extensionState.lastSubscriptionCheck = now;
          }
          
          resolve(isSubscribed);
        }
      );
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw error;
    }
    return false;
  }
}

/**
 * Get current channel name from URL
 */
function getCurrentChannelName() {
  const pathSegments = window.location.pathname.split('/');
  
  // Handle moderator view
  if (pathSegments[1] === 'moderator' && pathSegments.length > 2) {
    return pathSegments[2].toLowerCase();
  }
  
  // Regular channel URL
  if (pathSegments[1] && 
      pathSegments[1] !== 'oauth2' && 
      !pathSegments[1].includes('auth')) {
    return pathSegments[1].toLowerCase();
  }
  
  return null;
}

/**
 * Get current game being streamed
 */
function getCurrentGame() {
  try {
    const gameElement = document.querySelector('a[data-a-target="stream-game-link"]');
    if (gameElement) {
      const gameName = gameElement.textContent?.trim();
      if (gameName && gameName !== 'Just Chatting') {
        return gameName;
      }
    }
    return null;
  } catch (error) {
    console.error('EloWard: Error detecting game:', error);
    return null;
  }
}

/**
 * Check if game is supported
 */
function isGameSupported(game) {
  if (!game) return false;
  
  // Direct match
  if (SUPPORTED_GAMES[game] === true) {
    return true;
  }
  
  // Case-insensitive match
  const gameLower = game.toLowerCase();
  for (const supportedGame of Object.keys(SUPPORTED_GAMES)) {
    if (supportedGame.toLowerCase() === gameLower) {
      return true;
    }
  }
  
  return false;
}

/**
 * Setup game change observer to detect mid-stream game switches
 */
function setupGameChangeObserver() {
  if (window._eloward_game_observer) {
    window._eloward_game_observer.disconnect();
    window._eloward_game_observer = null;
  }
  
  let gameCheckTimeout = null;
  
  function checkGameChange() {
    if (gameCheckTimeout) {
      clearTimeout(gameCheckTimeout);
    }
    
    gameCheckTimeout = setTimeout(() => {
      const newGame = getCurrentGame();
      
      if (newGame !== extensionState.currentGame) {
        const oldGame = extensionState.currentGame;
        extensionState.currentGame = newGame;
        
        console.log(`EloWard: Game detected - ${newGame || 'none'}`);
        
        if (!isGameSupported(extensionState.currentGame)) {
          // Clean up for unsupported game
          if (window._eloward_chat_observer) {
            window._eloward_chat_observer.disconnect();
            window._eloward_chat_observer = null;
          }
          extensionState.observerInitialized = false;
          extensionState.isChannelSubscribed = false;
        } else if (isGameSupported(extensionState.currentGame) && !isGameSupported(oldGame)) {
          // Reinitialize for supported game
          if (extensionState.channelName && !extensionState.initializationInProgress) {
            initializeExtension();
          }
        }
      }
    }, 1000);
  }
  
  const gameObserver = new MutationObserver(checkGameChange);
  const streamInfoTarget = document.querySelector('[data-a-target="stream-info-card"]');
  
  if (streamInfoTarget) {
    gameObserver.observe(streamInfoTarget, { 
      subtree: true, 
      childList: true,
      attributes: true,
      attributeFilter: ['data-a-target']
    });
    
    window._eloward_game_observer = gameObserver;
  }
}

/**
 * Main initialization function
 */
function initializeExtension() {
  // Prevent concurrent initializations
  if (extensionState.initializationInProgress) {
    return;
  }
  
  // Get current channel
  const currentChannel = getCurrentChannelName();
  if (!currentChannel) {
    return;
  }
  
  // Generate unique initialization ID
  const initializationId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  extensionState.currentInitializationId = initializationId;
  extensionState.initializationInProgress = true;
  extensionState.channelName = currentChannel;
  
  // Add extension styles
  addExtensionStyles();
  
  // Notify background script of channel change
  chrome.runtime.sendMessage({
    action: 'channel_switched',
    oldChannel: channelState.currentChannel,
    newChannel: currentChannel
  });
  
  // Get current game and initialize
  setTimeout(() => {
    if (extensionState.currentInitializationId !== initializationId) {
      return;
    }
    
    const detectedGame = getCurrentGame();
    extensionState.currentGame = detectedGame;
    
    console.log(`EloWard: Game detected - ${detectedGame || 'none'}`);
    
    // Always setup game observer to monitor for changes
    setupGameChangeObserver();
    
    // Only proceed if game is supported
    if (!isGameSupported(extensionState.currentGame)) {
      extensionState.initializationInProgress = false;
      return;
    }
    
    // Initialize channel
    initializeChannel(extensionState.channelName, initializationId)
      .then(subscribed => {
        if (extensionState.currentInitializationId !== initializationId) {
          return;
        }
        
        if (subscribed) {
          console.log("🛡️ EloWard Extension Active");
          
          if (!extensionState.observerInitialized) {
            initializeObserver();
          }
        }
        
        extensionState.initializationInProgress = false;
      })
      .catch(error => {
        if (error.name !== 'AbortError') {
          console.error('EloWard: Error during channel initialization:', error);
        }
        extensionState.initializationInProgress = false;
      });
  }, 1500);
}

/**
 * Setup URL change observer for SPA navigation
 */
function setupUrlChangeObserver() {
  if (window._eloward_url_observer) return;
  
  const urlObserver = new MutationObserver(function(mutations) {
    const currentChannel = getCurrentChannelName();
    
    // Skip if on auth pages
    if (window.location.pathname.includes('oauth2') || 
        window.location.pathname.includes('auth/') ||
        window.location.href.includes('auth/callback') ||
        window.location.href.includes('auth/redirect')) {
      return;
    }
    
    // Handle channel changes (including from homepage to channel)
    if (currentChannel && currentChannel !== extensionState.channelName) {
      if (extensionState.channelName) {
        cleanupChannel(extensionState.channelName);
      }
      
      extensionState.channelName = currentChannel;
      clearRankCache();
      
      setTimeout(() => {
        const verifyChannel = getCurrentChannelName();
        if (verifyChannel === currentChannel) {
          initializeExtension();
        }
      }, 500);
    }
    // Handle navigation away from channels (e.g., to homepage)
    else if (!currentChannel && extensionState.channelName) {
      cleanupChannel(extensionState.channelName);
      extensionState.channelName = null;
    }
  });
  
  urlObserver.observe(document, { subtree: true, childList: true });
  window._eloward_url_observer = urlObserver;
}

/**
 * Initialize chat observer
 */
function initializeObserver() {
  if (extensionState.observerInitialized) {
    return;
  }
  
  const chatContainer = findChatContainer();
  
  if (chatContainer) {
    setupChatObserver(chatContainer);
    extensionState.observerInitialized = true;
  } else {
    setTimeout(() => {
      const chatContainer = findChatContainer();
      if (chatContainer) {
        setupChatObserver(chatContainer);
        extensionState.observerInitialized = true;
      }
    }, 1000);
  }
}

/**
 * Find Twitch chat container
 */
function findChatContainer() {
  const chatContainer = document.querySelector('.chat-scrollable-area__message-container') ||
                       document.querySelector('[data-a-target="chat-scroller"]');
  
  if (chatContainer) return chatContainer;
  
  const anyMessage = document.querySelector('.chat-line__message, .chat-line');
  return anyMessage ? anyMessage.closest('[role="log"]') || anyMessage.parentElement : null;
}

/**
 * Setup chat observer to watch for new messages
 */
function setupChatObserver(chatContainer) {
  const chatObserver = new MutationObserver((mutations) => {
    if (!extensionState.isChannelSubscribed) return;
    
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const isMessage = node.classList && (
              node.classList.contains('chat-line__message') || 
              node.classList.contains('chat-line') ||
              node.querySelector('.chat-author__display-name, [data-a-target="chat-message-username"]')
            );
            
            if (isMessage) {
              processNewMessage(node);
            }
          }
        }
      }
    }
  });
  
  chatObserver.observe(chatContainer, {
    childList: true,
    subtree: true
  });
  
  // Process existing messages
  const existingMessages = chatContainer.querySelectorAll('.chat-line__message, .chat-line');
  for (const message of existingMessages) {
    processNewMessage(message);
  }
  
  window._eloward_chat_observer = chatObserver;
}

/**
 * Process new chat message for rank badges
 */
function processNewMessage(messageNode) {
  if (processedMessages.has(messageNode)) return;
  processedMessages.add(messageNode);
  
  // Memory management
  if (processedMessages.size > 500) {
    const toDelete = Array.from(processedMessages).slice(0, 100);
    toDelete.forEach(msg => processedMessages.delete(msg));
  }
  
  if (!extensionState.isChannelSubscribed) return;
  
  const usernameElement = messageNode.querySelector('.chat-author__display-name') ||
                         messageNode.querySelector('[data-a-target="chat-message-username"]');
  
  if (!usernameElement) return;
  
  const username = usernameElement.textContent.trim().toLowerCase();
  
  // Handle current user with stored Riot data (even if tokens expired)
  if (extensionState.currentUser && username === extensionState.currentUser.toLowerCase()) {
    chrome.storage.local.get(['eloward_persistent_riot_user_data'], (data) => {
      const riotData = data.eloward_persistent_riot_user_data;
      
      if (riotData?.rankInfo) {
        const userRankData = {
          tier: riotData.rankInfo.tier,
          division: riotData.rankInfo.rank,
          leaguePoints: riotData.rankInfo.leaguePoints,
          summonerName: riotData.gameName
        };
        
        chrome.runtime.sendMessage({
          action: 'set_rank_data',
          username: username,
          rankData: userRankData
        });
        
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
        
        addBadgeToMessage(usernameElement, userRankData);
      }
    });
    return;
  }
  
  // Fetch rank for other users
  fetchRankFromBackground(username, usernameElement);
}

/**
 * Fetch rank data from background script
 */
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
          addBadgeToMessage(usernameElement, response.rankData);
        }
      }
    );
  } catch (error) {
    console.error("Error sending rank lookup message:", error);
  }
}

/**
 * Add rank badge to chat message
 */
function addBadgeToMessage(usernameElement, rankData) {
  if (!rankData?.tier) return; 
  
  const messageContainer = usernameElement.closest('.chat-line__message, .chat-line');
  if (messageContainer?.querySelector('.eloward-rank-badge')) return;
  
  const badgeContainer = document.createElement('div');
  badgeContainer.className = 'eloward-rank-badge';
  badgeContainer.dataset.rankText = formatRankText(rankData);
  
  const rankImg = document.createElement('img');
  rankImg.alt = rankData.tier;
  rankImg.className = 'chat-badge';
  rankImg.width = 24;
  rankImg.height = 24;
  
  try {
    const tier = rankData.tier.toLowerCase();
    rankImg.src = `https://eloward-cdn.unleashai.workers.dev/lol/${tier}.png`;
  } catch (error) {
    console.error("Error setting badge image source:", error);
    return;
  }
  
  badgeContainer.appendChild(rankImg);
  
  // Setup tooltip
  badgeContainer.addEventListener('mouseenter', showTooltip);
  badgeContainer.addEventListener('mouseleave', hideTooltip);
  
  badgeContainer.dataset.rank = rankData.tier;
  badgeContainer.dataset.division = rankData.division || '';
  badgeContainer.dataset.lp = rankData.leaguePoints !== undefined && rankData.leaguePoints !== null ? 
                              rankData.leaguePoints.toString() : '';
  badgeContainer.dataset.username = rankData.summonerName || '';
  
  usernameElement.parentNode.insertBefore(badgeContainer, usernameElement);
}

/**
 * Format rank text for display
 */
function formatRankText(rankData) {
  if (!rankData || !rankData.tier || rankData.tier.toUpperCase() === 'UNRANKED') {
    return 'UNRANKED';
  }
  
  let rankText = rankData.tier;
  
  if (rankData.division && !['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(rankData.tier.toUpperCase())) {
    rankText += ' ' + rankData.division;
  }
  
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

/**
 * Show tooltip on badge hover
 */
function showTooltip(event) {
  if (tooltipShowTimeout) {
    clearTimeout(tooltipShowTimeout);
  }

  if (!tooltipElement) {
    tooltipElement = document.createElement('div');
    tooltipElement.className = 'eloward-tooltip';
    document.body.appendChild(tooltipElement);
  }
  
  const badge = event.currentTarget;
  const rankTier = badge.dataset.rank || 'UNRANKED';
  const division = badge.dataset.division || '';
  let lp = badge.dataset.lp || '';
  
  if (lp && !isNaN(Number(lp))) {
    lp = Number(lp).toString();
  }
  
  // Format tooltip text
  if (!rankTier || rankTier.toUpperCase() === 'UNRANKED') {
    tooltipElement.textContent = 'Unranked';
  } else {
    let formattedTier = rankTier.toLowerCase();
    formattedTier = formattedTier.charAt(0).toUpperCase() + formattedTier.slice(1);
    
    let tooltipText = formattedTier;
    
    if (division && !['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(rankTier.toUpperCase())) {
      tooltipText += ' ' + division;
    }
    
    if (lp !== undefined && lp !== null && lp !== '') {
      tooltipText += ' - ' + lp + ' LP';
    }
    
    tooltipElement.textContent = tooltipText;
  }
  
  // Reset and position tooltip
  tooltipElement.style.visibility = 'hidden';
  tooltipElement.style.transform = 'translate(-30%, -100%) scale(0.9)';
  tooltipElement.style.opacity = '0';
  tooltipElement.classList.remove('visible');
  
  tooltipShowTimeout = setTimeout(() => {
    const rect = badge.getBoundingClientRect();
    const badgeCenter = rect.left + (rect.width / 2);
    
    tooltipElement.style.left = `${badgeCenter}px`;
    tooltipElement.style.top = `${rect.top - 5}px`;
    tooltipElement.style.visibility = 'visible';
    
    tooltipElement.offsetHeight;
    tooltipElement.classList.add('visible');
  }, 300);
}

/**
 * Hide tooltip
 */
function hideTooltip() {
  if (tooltipShowTimeout) {
    clearTimeout(tooltipShowTimeout);
    tooltipShowTimeout = null;
  }
  
  if (tooltipElement && tooltipElement.classList.contains('visible')) {
    tooltipElement.style.opacity = '0';
    tooltipElement.style.transform = 'translate(-30%, -100%) scale(0.9)';
    
    setTimeout(() => {
      tooltipElement.classList.remove('visible');
    }, 100);
  }
}

/**
 * Add CSS styles for rank badges and tooltips
 */
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
    
    .eloward-tooltip {
      position: absolute !important;
      z-index: 99999 !important;
      pointer-events: none !important;
      transform: translate(-12%, -100%) scale(0.9) !important;
      font-size: 13px !important;
      font-weight: 600 !important;
      font-family: Roobert, "Helvetica Neue", Helvetica, Arial, sans-serif !important;
      white-space: nowrap !important;
      padding: 4px 6px !important;
      border-radius: 6px !important;
      line-height: 1.2 !important;
      opacity: 0 !important;
      transition: opacity 0.07s ease-in-out, transform 0.07s ease-in-out !important;
      text-align: center !important;
      border: none !important;
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.3) !important;
      margin-top: -2px !important;
      will-change: transform, opacity !important;
    }
    
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
    
    .eloward-tooltip::after {
      content: "" !important;
      position: absolute !important;
      bottom: -4px !important;
      left: 10% !important;
      margin-left: -4px !important;
      border-width: 4px 4px 0 4px !important;
      border-style: solid !important;
    }
    
    .eloward-tooltip.visible {
      opacity: 1 !important;
      transform: translate(-12%, -100%) scale(1) !important;
    }
  `;
  
  document.head.appendChild(styleElement);
} 