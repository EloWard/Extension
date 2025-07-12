// IMMEDIATE Chrome Extension Detection - Must be FIRST
// This marks the Chrome extension as active so FFZ addon can detect it and disable itself
document.body.setAttribute('data-eloward-chrome-ext', 'active');
document.documentElement.setAttribute('data-eloward-chrome-ext', 'active');

// Extension state management
const extensionState = {
  isChannelActive: false,
  channelName: '',
  currentGame: null,
  currentUser: null,
  observerInitialized: false,
  lastChannelActiveCheck: null,
  initializationInProgress: false,
  currentInitializationId: null
};

// Channel state tracking
  const channelState = {
    activeChannels: new Set(),
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
          extensionState.isChannelActive = false;
      extensionState.lastChannelActiveCheck = null;
  extensionState.initializationInProgress = false;
  extensionState.currentInitializationId = null;
  extensionState.currentGame = null;
}

/**
 * Initialize channel and check channel_active status
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
    
    const isActive = await checkChannelActive(channelName, true, abortController.signal);
    
    if (extensionState.currentInitializationId !== initializationId || abortController.signal.aborted) {
      return false;
    }
    
    if (isActive) {
      channelState.activeChannels.add(normalizedChannel);
      extensionState.isChannelActive = true;
    } else {
      channelState.activeChannels.delete(normalizedChannel);
      extensionState.isChannelActive = false;
    }
    
    return isActive;
  } catch (error) {
    if (error.name !== 'AbortError') {
      // Non-abort error occurred
    }
    return false;
  }
}

function initializeStorage() {
  chrome.storage.local.get(null, (allData) => {
    extensionState.currentUser = findCurrentUser(allData);
    
    if (extensionState.currentUser) {
      chrome.runtime.sendMessage({
        action: 'set_current_user',
        username: extensionState.currentUser
      });
    }
  });
}

function findCurrentUser(allData) {
  if (allData.eloward_persistent_twitch_user_data?.login) {
    return allData.eloward_persistent_twitch_user_data.login.toLowerCase();
  } 
  
  if (allData.twitchUsername) {
    return allData.twitchUsername.toLowerCase();
  }
  
  return null;
}

/**
 * Check if channel is active with caching
 */
async function checkChannelActive(channelName, forceCheck = false, signal = null) {
  if (!channelName) return false;
  
  if (signal?.aborted) {
    throw new DOMException('Operation aborted', 'AbortError');
  }
  
  // Use cache unless forced to check
  const now = Date.now();
  if (!forceCheck && 
      extensionState.lastChannelActiveCheck && 
      extensionState.channelName === channelName && 
      (now - extensionState.lastChannelActiveCheck) < 30000) {
    return extensionState.isChannelActive;
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
          action: 'check_channel_active', 
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
          
          const isActive = response && response.active === true;
          console.log(`🔍 EloWard: Channel ${channelName} active check - ${isActive ? '✅ Active' : '❌ Inactive'}`);
          
          if (!signal?.aborted) {
            extensionState.lastChannelActiveCheck = now;
          }
          
          resolve(isActive);
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
 * Get current game being streamed using Twitch GraphQL API (same method as FFZ addon)
 * This is the most reliable method and matches what the FFZ addon uses
 */
async function getCurrentGame() {
  const channelName = getCurrentChannelName();
  if (!channelName) {
    return null;
  }
  
  try {
    const response = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko'
      },
      body: JSON.stringify({
        query: `
          query {
            user(login: "${channelName}") {
              stream {
                game {
                  id
                  name
                  displayName
                }
              }
            }
          }
        `
      })
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const game = data?.data?.user?.stream?.game;
    
    if (game) {
      const gameName = game.name || game.displayName;
      console.log(`🎮 EloWard: Game detected - ${gameName}`);
      return gameName;
    }
    

    return null;
  } catch (error) {
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
    
    gameCheckTimeout = setTimeout(async () => {
      const newGame = await getCurrentGame();
      
      if (newGame !== extensionState.currentGame) {
        const oldGame = extensionState.currentGame;
        extensionState.currentGame = newGame;
        
        
        if (!isGameSupported(extensionState.currentGame)) {
          // Clean up for unsupported game
          if (window._eloward_chat_observer) {
            window._eloward_chat_observer.disconnect();
            window._eloward_chat_observer = null;
          }
          extensionState.observerInitialized = false;
          extensionState.isChannelActive = false;
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
  setTimeout(async () => {
    if (extensionState.currentInitializationId !== initializationId) {
      return;
    }
    
    const detectedGame = await getCurrentGame();
    extensionState.currentGame = detectedGame;
    
    
    // Always setup game observer to monitor for changes
    setupGameChangeObserver();
    
    // Only proceed if game is supported
    if (!isGameSupported(extensionState.currentGame)) {
      extensionState.initializationInProgress = false;
      return;
    }
    
    // Initialize channel
    initializeChannel(extensionState.channelName, initializationId)
      .then(channelActive => {
        if (extensionState.currentInitializationId !== initializationId) {
          return;
        }
        
        if (channelActive) {
          
          if (!extensionState.observerInitialized) {
            initializeObserver();
          }
        }
        
        extensionState.initializationInProgress = false;
      })
      .catch(error => {
        if (error.name !== 'AbortError') {
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
    console.log(`🚀 EloWard: Extension activated for ${extensionState.channelName}`);
  } else {
    setTimeout(() => {
      const chatContainer = findChatContainer();
      if (chatContainer) {
        setupChatObserver(chatContainer);
        extensionState.observerInitialized = true;
        console.log(`🚀 EloWard: Extension activated for ${extensionState.channelName}`);
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
    if (!extensionState.isChannelActive) return;
    
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
  
  if (!extensionState.isChannelActive) return;
  
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
    // Error fetching rank data
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
  
  // Clear existing content
  tooltipElement.innerHTML = '';
  
  // Create and add larger rank badge image
  const tooltipBadge = document.createElement('img');
  tooltipBadge.className = 'eloward-tooltip-badge';
  
  // Get the rank badge image source from the original badge
  const originalImg = badge.querySelector('img');
  if (originalImg && originalImg.src) {
    tooltipBadge.src = originalImg.src;
    tooltipBadge.alt = 'Rank Badge';
  }
  
  tooltipElement.appendChild(tooltipBadge);
  
  // Create and add rank text
  const tooltipText = document.createElement('div');
  tooltipText.className = 'eloward-tooltip-text';
  
  // Format tooltip text
  if (!rankTier || rankTier.toUpperCase() === 'UNRANKED') {
    tooltipText.textContent = 'Unranked';
  } else {
    let formattedTier = rankTier.toLowerCase();
    formattedTier = formattedTier.charAt(0).toUpperCase() + formattedTier.slice(1);
    
    let rankText = formattedTier;
    
    if (division && !['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(rankTier.toUpperCase())) {
      rankText += ' ' + division;
    }
    
    if (lp !== undefined && lp !== null && lp !== '') {
      rankText += ' - ' + lp + ' LP';
    }
    
    tooltipText.textContent = rankText;
  }
  
  tooltipElement.appendChild(tooltipText);
  
  // Position and show tooltip immediately
  const rect = badge.getBoundingClientRect();
  const badgeCenter = rect.left + (rect.width / 2);
  
  tooltipElement.style.left = `${badgeCenter}px`;
  tooltipElement.style.top = `${rect.top - 5}px`;
  tooltipElement.style.transform = 'translate(-50%, -100%)';
  tooltipElement.style.visibility = 'visible';
  tooltipElement.style.opacity = '1';
  tooltipElement.classList.add('visible');
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
    tooltipElement.style.visibility = 'hidden';
    tooltipElement.classList.remove('visible');
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
      transform: translate(-50%, -100%) !important;
      font-family: Roobert, "Helvetica Neue", Helvetica, Arial, sans-serif !important;
      padding: 8px !important;
      border-radius: 8px !important;
      opacity: 0 !important;
      text-align: center !important;
      border: none !important;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4) !important;
      margin-top: -8px !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      gap: 6px !important;
    }
    
    .eloward-tooltip-badge {
      width: 90px !important;
      height: 90px !important;
      object-fit: contain !important;
      display: block !important;
    }
    
    .eloward-tooltip-text {
      font-size: 13px !important;
      font-weight: 600 !important;
      line-height: 1.2 !important;
      white-space: nowrap !important;
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
      left: 50% !important;
      margin-left: -4px !important;
      border-width: 4px 4px 0 4px !important;
      border-style: solid !important;
    }
    
    .eloward-tooltip.visible {
      opacity: 1 !important;
      transform: translate(-50%, -100%) !important;
    }
  `;
  
  document.head.appendChild(styleElement);
}

 