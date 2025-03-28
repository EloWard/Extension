// DIRECT TEST LOG - This should always appear
console.log("🛡️ EloWard Extension Active");

// Add a debug flag at the top of the file
const DEBUG_MODE = false; // Set to true to enable debug logging

// Global state
let isChannelSubscribed = false;
let channelName = '';
let processedMessages = new Set();
let observerInitialized = false;
let cachedUserMap = {}; // Cache for mapping Twitch usernames to Riot IDs
let tooltipElement = null; // Global tooltip element
let currentUser = null; // Current user's Twitch username

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

// Initialize storage and load user data
function initializeStorage() {
  chrome.storage.local.get(null, (allData) => {
    // Find current user in storage using consolidated logic
    currentUser = findCurrentUser(allData);
    
    // Process rank data from linked accounts
    if (allData.linkedAccounts) {
      processLinkedAccounts(allData.linkedAccounts);
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

// Process linked accounts and build rank cache
function processLinkedAccounts(linkedAccounts) {
  Object.keys(linkedAccounts).forEach(username => {
    const account = linkedAccounts[username];
    if (account && account.rankData) {
      const lowerUsername = username.toLowerCase();
      cachedUserMap[lowerUsername] = account.rankData;
    }
  });
  
  // Also add entry for current user if not present through case-insensitive search
  if (currentUser && !cachedUserMap[currentUser]) {
    const foundKey = Object.keys(linkedAccounts).find(
      key => key.toLowerCase() === currentUser.toLowerCase()
    );
    
    if (foundKey) {
      cachedUserMap[currentUser] = linkedAccounts[foundKey].rankData;
    }
  }
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
  
  // Subscription cache is maintained in content script with a 5-minute TTL
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  
  // Check session storage for cached subscription status
  const cacheKey = `eloward_subscription_${normalizedChannel}`;
  const cachedData = sessionStorage.getItem(cacheKey);
  
  // If we have cached data and not forcing a check, use it
  if (!forceCheck && cachedData) {
    try {
      const parsedCache = JSON.parse(cachedData);
      // Check if cache is still valid
      if (Date.now() - parsedCache.timestamp < CACHE_TTL) {
        // Only log when changing channels or force checking
        if (forceCheck) {
          console.log(`EloWard: Using cached subscription for ${channelName}: ${parsedCache.subscribed ? 'Subscribed ✅' : 'Not Subscribed ❌'}`);
        }
        return parsedCache.subscribed;
      }
    } catch (error) {
      // Silent error - no need to log parsing errors
    }
  }
  
  try {
    return new Promise((resolve) => {
      // Send message to background script to check subscription
      chrome.runtime.sendMessage(
        { 
          action: 'check_streamer_subscription', 
          streamer: channelName,
          // Only skip background cache on forced checks
          skipCache: forceCheck 
        },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve(false);
            return;
          }
          
          // Extract the boolean value with casting to ensure it's a boolean
          const isSubscribed = response && response.subscribed === true;
          
          // Log subscription status (only for new checks, not every message)
          console.log(`EloWard: ${channelName} is ${isSubscribed ? 'Subscribed ✅' : 'Not Subscribed ❌'}`);
          
          // Cache the result in session storage
          try {
            sessionStorage.setItem(cacheKey, JSON.stringify({
              subscribed: isSubscribed,
              timestamp: Date.now()
            }));
          } catch (error) {
            // Silent error - no need to log storage errors
          }
          
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
    // Update the channel name
    channelName = newChannelName;
    
    // Reset state when changing channels
    isChannelSubscribed = false;
    observerInitialized = false;
    
    // Only log on channel change
    console.log(`EloWard: Channel changed to ${channelName}`);
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
  
  // Only force check subscription status on channel changes
  // Otherwise use the cached value to reduce API calls
  checkChannelSubscription(channelName, channelChanged)
    .then(subscribed => {
      isChannelSubscribed = subscribed;
      
      if (isChannelSubscribed && !observerInitialized) {
        initializeObserver();
      } else if (!isChannelSubscribed) {
        // Clean up any existing observers
        if (window._eloward_chat_observer) {
          window._eloward_chat_observer.disconnect();
          window._eloward_chat_observer = null;
        }
        observerInitialized = false;
      }
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
      console.log(`EloWard: URL changed from ${channelName} to ${currentChannel}`);
      
      // Reset state
      channelName = currentChannel;
      observerInitialized = false;
      isChannelSubscribed = false;
      
      // Remove any existing observers
      if (window._eloward_chat_observer) {
        window._eloward_chat_observer.disconnect();
        window._eloward_chat_observer = null;
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
  // Common chat container selectors
  const chatContainerSelectors = [
    '.chat-scrollable-area__message-container',
    '.chat-list--default',
    '.chat-list',
    '[data-test-selector="chat-scrollable-area-container"]',
    '[data-a-target="chat-scroller"]',
    '[role="log"]',
    '.chat-room__container',
    '.chat-room',
    '.stream-chat',
    '.chat-shell'
  ];
  
  // Try each selector
  for (const selector of chatContainerSelectors) {
    const container = document.querySelector(selector);
    if (container) {
      return container;
    }
  }
  
  // Fallback: look for elements containing chat messages
  const potentialContainers = document.querySelectorAll('[class*="chat"], [class*="message"]');
  
  for (const container of potentialContainers) {
    const usernameElements = container.querySelectorAll('.chat-author__display-name, [data-a-target="chat-message-username"]');
    if (usernameElements.length > 0) {
      return container;
    }
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
            // Check if this is a chat message
            const isMessage = node.classList && (
              node.classList.contains('chat-line__message') || 
              node.classList.contains('chat-line') ||
              node.querySelector('.chat-author__display-name, [data-a-target="chat-message-username"]')
            );
            
            if (isMessage) {
              processNewMessage(node);
            } else if (isFallbackObserver) {
              // For fallback observers, look deeper for chat messages
              const messages = node.querySelectorAll('[data-a-target="chat-line-message"], .chat-line__message, .chat-line');
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
    subtree: isFallbackObserver // Use subtree for fallback observers
  });
  
  // Also process any existing messages
  const existingMessages = isFallbackObserver ? 
    chatContainer.querySelectorAll('[data-a-target="chat-line-message"], .chat-line__message, .chat-line') : 
    chatContainer.children;
    
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
  
  // Find username element
  let usernameElement = messageNode.querySelector('.chat-author__display-name, [data-a-target="chat-message-username"]');
  
  if (!usernameElement) return;
  
  // Get lowercase username for case-insensitive matching
  const username = usernameElement.textContent.trim().toLowerCase();
  
  // Check if this user has a cached rank
  const cachedUsername = Object.keys(cachedUserMap).find(key => 
    key.toLowerCase() === username
  );
  
  if (cachedUsername) {
    addBadgeToMessage(usernameElement, cachedUserMap[cachedUsername]);
    return;
  }
  
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
        
        // Add to cache and display
        cachedUserMap[username] = userRankData;
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
          // Cache the response
          cachedUserMap[username] = response.rankData;
          
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
  const messageContainer = usernameElement.closest('.chat-line__message') || usernameElement.closest('.chat-line');
  if (messageContainer?.querySelector('.eloward-rank-badge')) return;
  
  // Get the parent container that holds the username
  const usernameContainer = usernameElement.closest('.chat-line__username-container');
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
  
  // Set image source based on rank tier - use 36px images for higher quality
  try {
    const tier = rankData.tier.toLowerCase();
    rankImg.src = chrome.runtime.getURL(`images/ranks/${tier}36.png`);
  } catch (error) {
    console.error("Error setting badge image source:", error);
    // Fallback to 18px if 36px isn't available
    try {
      const tier = rankData.tier.toLowerCase();
      rankImg.src = chrome.runtime.getURL(`images/ranks/${tier}18.png`);
    } catch (fallbackError) {
      console.error("Error setting fallback badge image source:", fallbackError);
      return; // Don't continue if we can't get the image
    }
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
  
  // Insert the badge in the appropriate location
  if (usernameContainer) {
    // Find the username span that follows the badges
    const usernameSpan = usernameContainer.querySelector('.chat-line__username, .chat-author__display-name').closest('span');
    
    // Insert the badge right before the username span (making it the rightmost badge)
    usernameContainer.insertBefore(badgeContainer, usernameSpan);
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
    tooltipElement.textContent = 'UNRANKED';
  } else {
    // For ranked players
    let tooltipText = rankTier;
    
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
  tooltipElement.classList.add('visible');
  
  // Position after a very short delay
  tooltipShowTimeout = setTimeout(() => {
    // Get badge position
    const rect = badge.getBoundingClientRect();
    const badgeCenter = rect.left + (rect.width / 2);
    
    // Position tooltip above the badge with an offset for left-shifted arrow
    tooltipElement.style.left = `${badgeCenter}px`;
    tooltipElement.style.top = `${rect.top - 5}px`;
    
    // Animate in - make it visible first
    tooltipElement.style.visibility = 'visible';
    
    // Trigger animation in the next frame for better performance
    requestAnimationFrame(() => {
      tooltipElement.style.opacity = '1';
      tooltipElement.style.transform = 'translate(-30%, -100%) scale(1)';
    });
  }, 5);
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
    }, 150);
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
      font-family: Inter, Roobert, "Helvetica Neue", Helvetica, Arial, sans-serif !important;
      white-space: nowrap !important;
      padding: 6px 10px !important;
      border-radius: 6px !important; /* Increased corner roundness (was 3px) */
      line-height: 1.2 !important;
      opacity: 0 !important;
      transition: opacity 0.1s ease-out, transform 0.12s ease-out !important;
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