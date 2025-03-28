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
  // Only initialize once
  if (observerInitialized) return;
  
  // Make sure styles are added
  addExtensionStyles();
  
  // Detect installed extensions for compatibility
  const is7TVPresent = document.querySelector('#seventv-extension') !== null || document.querySelector('[class*="seventv-"]') !== null;
  const isBTTVPresent = document.querySelector('[class*="bttv-"]') !== null;
  
  if (DEBUG_MODE) {
    console.log(`EloWard: Extension integration - 7TV: ${is7TVPresent ? 'YES' : 'NO'}, BTTV: ${isBTTVPresent ? 'YES' : 'NO'}`);
  }
  
  // Get the current channel name
  const newChannelName = getCurrentChannelName();
  
  // If we've already got a channel and it's the same as the current one, no need to reinitialize
  if (channelName && newChannelName && channelName.toLowerCase() === newChannelName.toLowerCase()) {
    return;
  }
  
  // Update the channel name
  if (newChannelName) {
    channelName = newChannelName;
  }
  
  // Log the channel name for debugging
  if (DEBUG_MODE) {
    console.log("EloWard: Current channel is " + channelName);
  }
  
  // Check if the channel is subscribed
  checkChannelSubscription(channelName)
    .then(subscribed => {
      isChannelSubscribed = subscribed;
      
      // Only initialize chat observer if channel is subscribed
      if (subscribed) {
        // For 7TV and BTTV integration, give their DOM changes time to apply
        const integrationDelay = (is7TVPresent || isBTTVPresent) ? 1000 : 0;
        
        if (integrationDelay > 0 && DEBUG_MODE) {
          console.log(`EloWard: Delaying initialization by ${integrationDelay}ms for extension integration`);
        }
        
        setTimeout(() => {
          initializeObserver();
          
          // Force reconnection of chat observers
          observerInitialized = false;
        }, integrationDelay);
      }
    })
    .catch(error => {
      console.error("Error checking channel subscription:", error);
    });
  
  // Also set up an observer to watch for URL changes (for SPA navigation)
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
  // Try to find the chat containers in order of likelihood
  // Standard Twitch chat container selectors
  const containers = [
    document.querySelector('[data-test-selector="chat-scrollable-area__message-container"]'),
    document.querySelector('.chat-scrollable-area__message-container'),
    document.querySelector('[data-a-target="chat-scroller"]'),
    document.querySelector('[data-a-target="chat-list"]'),
    document.querySelector('.chat-list--default'),
    document.querySelector('.chat-list'),
    document.querySelector('.stream-chat'),
    document.querySelector('[class*="chat-list"]'),
    
    // Check for 7TV or BetterTTV containers
    document.querySelector('[data-seventv-container]'),
    document.querySelector('[class*="seventv-chat-container"]'),
    document.querySelector('[class*="bttv-chat-container"]'),
    document.querySelector('[class*="bttv-"] .chat-list')
  ];
  
  // Return the first match
  for (const container of containers) {
    if (container) return container;
  }
  
  // If still no container found, fallback to body for a global observer
  if (DEBUG_MODE) {
    console.warn("EloWard: Could not find chat container, using body fallback");
  }
  
  return document.body;
}

function setupChatObserver(chatContainer, isFallbackObserver = false) {
  // Create a MutationObserver to watch for new chat messages
  const chatObserver = new MutationObserver((mutations) => {
    // Process messages only if channel is subscribed
    if (!isChannelSubscribed) return;
    
    // Check if 7TV or BTTV is active to adjust how we look for messages
    const is7TVActive = document.querySelector('#seventv-extension') !== null;
    const isBTTVActive = document.querySelector('[class*="bttv-"]') !== null;
    
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if this is a chat message with expanded selectors
            const isMessage = node.classList && (
              node.classList.contains('chat-line__message') || 
              node.classList.contains('chat-line') ||
              node.querySelector('.chat-author__display-name, [data-a-target="chat-message-username"]') ||
              (is7TVActive && (
                node.classList.contains('seventv-chat-message') ||
                node.hasAttribute('data-seventv-message') ||
                node.querySelector('[class*="seventv-chat"]') ||
                node.querySelector('[data-seventv-message]')
              )) ||
              (isBTTVActive && (
                node.classList.contains('bttv-message') ||
                node.querySelector('[class*="bttv-message"]')
              ))
            );
            
            if (isMessage) {
              processNewMessage(node);
            } else if (isFallbackObserver || is7TVActive || isBTTVActive) {
              // For fallback observers or when extensions are active, look deeper for chat messages
              const messages = node.querySelectorAll(
                // Standard Twitch selectors
                '[data-a-target="chat-line-message"], .chat-line__message, .chat-line, ' +
                // 7TV selectors
                '[data-seventv-message], .seventv-chat-message, [class*="seventv-chat-message"], ' +
                // BTTV selectors
                '[class*="bttv-message"], .bttv-message'
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
    subtree: true // Always use subtree to catch deeply nested changes with extensions
  });
  
  // Also process any existing messages with expanded selectors for extensions
  const existingMessages = chatContainer.querySelectorAll(
    // Standard Twitch selectors
    '[data-a-target="chat-line-message"], .chat-line__message, .chat-line, ' +
    // 7TV selectors
    '[data-seventv-message], .seventv-chat-message, [class*="seventv-chat-message"], ' +
    // BTTV selectors
    '[class*="bttv-message"], .bttv-message'
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
  
  // Find username element - expand selectors to include 7TV and BTTV elements
  let usernameElement = 
    messageNode.querySelector('.chat-author__display-name, [data-a-target="chat-message-username"]') ||
    messageNode.querySelector('[class*="seventv-"] [data-a-target="chat-message-username"]') ||
    messageNode.querySelector('[class*="seventv-"] .chat-author__display-name') ||
    messageNode.querySelector('[class*="bttv-"] [data-a-target="chat-message-username"]') ||
    messageNode.querySelector('[class*="bttv-"] .chat-author__display-name') ||
    messageNode.querySelector('[class*="username"]'); // More generic fallback
  
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
    
    // Check if 7TV or BTTV have modified the DOM structure
    const is7TVActive = document.querySelector('#seventv-extension') !== null;
    const isBTTVActive = document.querySelector('[class*="bttv-"]') !== null;
    
    if (usernameSpan) {
      // Standard Twitch or compatible structure
      usernameContainer.insertBefore(badgeContainer, usernameSpan);
    } else {
      // Check for 7TV-specific structure
      if (is7TVActive) {
        // Try different 7TV selectors for the username container
        const seventvBadgeContainer = usernameElement.closest('[data-seventv-container]') || 
                                      usernameElement.closest('.seventv-chat-message-username') ||
                                      usernameElement.closest('[class*="seventv-"]') ||
                                      usernameElement.closest('[class*="7tv-"]');
                                      
        if (seventvBadgeContainer) {
          // For 7TV, we need to insert it in the right location
          // Find if there's a badges container or create one
          let badgesContainer = seventvBadgeContainer.querySelector('.chat-line__message--badges') || 
                                seventvBadgeContainer.querySelector('[class*="badges"]');
                                
          if (badgesContainer) {
            // Add to existing badges container
            badgesContainer.appendChild(badgeContainer);
          } else {
            // Insert before the username element
            seventvBadgeContainer.insertBefore(badgeContainer, usernameElement);
          }
          return;
        }
      }
      
      // Check for BTTV-specific structure
      if (isBTTVActive) {
        const bttvContainer = usernameElement.closest('[class*="bttv-"]') || 
                              messageContainer?.querySelector('[class*="bttv-message-container"]');
                              
        if (bttvContainer) {
          // Try to find the badge container in BTTV
          const bttvBadgeContainer = bttvContainer.querySelector('[class*="bttv-badges"]') || 
                                     bttvContainer.querySelector('.chat-badge-container');
                                    
          if (bttvBadgeContainer) {
            // Add to BTTV badge container
            bttvBadgeContainer.appendChild(badgeContainer);
            return;
          }
        }
      }
      
      // Universal fallback - insert as sibling before username
      usernameElement.parentNode.insertBefore(badgeContainer, usernameElement);
    }
  } else {
    // Final fallback - insert before the username element directly
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
    
    // Add summoner name if available
    if (username) {
      tooltipElement.textContent += ` (${username})`;
    }
  }
  
  // First reset the tooltip state and make it invisible
  tooltipElement.style.visibility = 'hidden';
  tooltipElement.style.transform = 'translate(-50%, -100%) scale(0.9)';
  tooltipElement.style.opacity = '0';
  tooltipElement.classList.remove('visible');
  
  // Clear any existing 7TV or BTTV tooltips that might interfere
  // This helps prevent tooltip collisions between extensions
  const existingTooltips = document.querySelectorAll('[class*="seventv-tooltip"], [class*="bttv-tooltip"], [class*="twitch-tooltip"]');
  existingTooltips.forEach(tooltip => {
    if (tooltip !== tooltipElement) {
      tooltip.style.display = 'none';
      tooltip.style.visibility = 'hidden';
      tooltip.style.opacity = '0';
    }
  });
  
  // Position after a delay
  tooltipShowTimeout = setTimeout(() => {
    // Get badge position
    const rect = badge.getBoundingClientRect();
    
    // Check if we're inside a 7TV or BTTV context to adjust positioning
    const is7TVContext = badge.closest('[data-seventv-container], [class*="seventv-"]') !== null;
    const isBTTVContext = badge.closest('[class*="bttv-"]') !== null;
    
    let badgeCenter = rect.left + (rect.width / 2);
    let badgeTop = rect.top;
    
    // Apply specific positioning adjustments for known extension contexts
    if (is7TVContext) {
      // 7TV-specific tooltip positioning
      badgeTop -= 2; // Slight vertical adjustment for 7TV
    } else if (isBTTVContext) {
      // BTTV-specific tooltip positioning
      badgeTop -= 2; // Slight vertical adjustment for BTTV
    }
    
    // Position tooltip above the badge
    tooltipElement.style.left = `${badgeCenter}px`;
    tooltipElement.style.top = `${badgeTop - 5}px`;
    
    // Make the element visible but with 0 opacity first
    tooltipElement.style.visibility = 'visible';
    
    // Force a reflow to ensure the browser registers the initial state
    tooltipElement.offsetHeight;
    
    // Then add the visible class to trigger the transition
    tooltipElement.classList.add('visible');
  }, 150); // Reduced delay for better responsiveness
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
    tooltipElement.style.transform = 'translate(-50%, -100%) scale(0.9)';
    
    // After the animation completes, hide the tooltip completely
    setTimeout(() => {
      tooltipElement.style.visibility = 'hidden';
      tooltipElement.classList.remove('visible');
    }, 200);
  }
}

// Add the CSS needed for badges
function addExtensionStyles() {
  // Check if our styles have already been added
  if (document.getElementById('eloward-styles')) return;
  
  // Create a style element
  const styleElement = document.createElement('style');
  styleElement.id = 'eloward-styles';
  
  // Add our custom styles
  styleElement.textContent = `
    .eloward-rank-badge {
      display: inline-flex;
      vertical-align: middle;
      margin: 0 2px;
      cursor: pointer;
      position: relative;
    }

    .eloward-rank-badge img {
      transition: transform 0.1s ease-in-out;
    }

    .eloward-rank-badge:hover img {
      transform: scale(1.2);
    }

    .eloward-tooltip {
      position: absolute;
      background-color: rgba(0, 0, 0, 0.9);
      color: white;
      padding: 6px 10px;
      border-radius: 4px;
      font-size: 12px;
      z-index: 10000;
      pointer-events: none;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
      opacity: 0;
      transform: translate(-50%, -100%) scale(0.9);
      transition: opacity 0.2s ease, transform 0.2s ease;
      font-family: 'Inter', 'Roobert', 'Helvetica Neue', Helvetica, Arial, sans-serif;
      text-transform: none;
    }

    .eloward-tooltip.visible {
      opacity: 1;
      transform: translate(-50%, -100%) scale(1);
    }

    .eloward-tooltip::after {
      content: '';
      position: absolute;
      bottom: -4px;
      left: 50%;
      margin-left: -4px;
      width: 0;
      height: 0;
      border-top: 4px solid rgba(0, 0, 0, 0.9);
      border-right: 4px solid transparent;
      border-left: 4px solid transparent;
    }
    
    /* 7TV Compatibility Styles */
    [data-seventv-container] .eloward-rank-badge,
    [class*="seventv-"] .eloward-rank-badge {
      margin: 0 2px;
      display: inline-flex;
      align-items: center;
    }
    
    /* Make sure our badges are properly sized in 7TV context */
    [data-seventv-container] .eloward-rank-badge img,
    [class*="seventv-"] .eloward-rank-badge img {
      width: 18px;
      height: 18px;
      vertical-align: middle;
    }
    
    /* BetterTTV Compatibility Styles */
    [class*="bttv-"] .eloward-rank-badge {
      margin: 0 2px;
      display: inline-flex;
      align-items: center;
    }
    
    /* Handle chat line structure for both extensions */
    .seventv-chat-message .eloward-rank-badge,
    .bttv-message .eloward-rank-badge {
      margin-right: 4px;
      margin-left: 0;
    }
    
    /* Add any specific fixes for message badges area */
    [class*="badges"] .eloward-rank-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    
    /* Ensure proper stacking with other extensions */
    .eloward-rank-badge {
      z-index: 1;
    }
  `;
  
  // Add the style element to the document head
  document.head.appendChild(styleElement);
} 