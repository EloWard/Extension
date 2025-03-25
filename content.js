// DIRECT TEST LOG - This should always appear
console.log("🛡️ EloWard Extension Active");

// Global state
let isChannelSubscribed = false;
let channelName = '';
let processedMessages = new Set();
let observerInitialized = false;
let cachedUserMap = {}; // Cache for mapping Twitch usernames to Riot IDs
let tooltipElement = null; // Global tooltip element
let currentUser = null; // Current user's Twitch username

// Initialize storage data once at startup
initializeStorage();

// Initialize when the page is loaded
initializeExtension();

// Also set a delayed initialization to catch slow-loading pages
setTimeout(initializeExtension, 3000);

// Add a window.onload handler as an additional initialization method
window.addEventListener('load', function() {
  console.log('EloWard: Page fully loaded, reinitializing');
  initializeExtension();
});

// Listen for URL changes (for SPA navigation)
window.addEventListener('popstate', function() {
  console.log('EloWard: Navigation detected via popstate');
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
 * Simplified function to check if a channel is subscribed
 * Makes a direct API call to the background script without caching
 * @param {string} channelName - The channel to check
 * @returns {Promise<boolean>} - Whether the channel is subscribed
 */
async function checkChannelSubscription(channelName) {
  if (!channelName) return false;
  
  console.log(`EloWard: Checking subscription for ${channelName}`);
  
  try {
    return new Promise((resolve) => {
      // Always use skipCache=true to ensure fresh check
      chrome.runtime.sendMessage(
        { action: 'check_streamer_subscription', streamer: channelName, skipCache: true },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error('EloWard: Error checking subscription:', chrome.runtime.lastError);
            resolve(false);
            return;
          }
          
          // Extract the boolean value with casting to ensure it's a boolean
          const isSubscribed = response && response.subscribed === true;
          
          if (isSubscribed) {
            console.log(`EloWard: ${channelName} is Subscribed ✅`);
          } else {
            console.log(`EloWard: ${channelName} is Not Subscribed ❌`);
          }
          
          resolve(isSubscribed);
        }
      );
    });
  } catch (error) {
    console.error('EloWard: Error checking subscription:', error);
    return false;
  }
}

function initializeExtension() {
  // Extract channel name from URL
  const pathSegments = window.location.pathname.split('/');
  const newChannelName = pathSegments[1];
  
  // If no channel name or we're on an auth-related path, don't do anything
  if (!newChannelName || 
      newChannelName === 'oauth2' || 
      pathSegments.includes('oauth') || 
      pathSegments.includes('authorize') ||
      window.location.href.includes('auth/callback') ||
      window.location.href.includes('auth/redirect')) {
    return;
  }
  
  // Check if we've changed channels
  if (newChannelName !== channelName) {
    // Update the channel name
    channelName = newChannelName;
    
    // Reset state when changing channels
    isChannelSubscribed = false;
    observerInitialized = false;
    
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
  
  // Always check subscription status directly
  console.log(`EloWard: Checking subscription status for ${channelName}...`);
  
  checkChannelSubscription(channelName)
    .then(subscribed => {
      isChannelSubscribed = subscribed;
      
      console.log(`EloWard: Subscription check result for ${channelName}: ${isChannelSubscribed ? 'Subscribed ✅' : 'Not Subscribed ❌'}`);
      
      if (isChannelSubscribed && !observerInitialized) {
        console.log(`EloWard: Initializing rank display for ${channelName}`);
        initializeObserver();
      } else if (!isChannelSubscribed) {
        console.log(`EloWard: Ranks will not be displayed for ${channelName} (not subscribed)`);
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
    // Check if pathname has changed
    const currentPath = window.location.pathname;
    const pathSegments = currentPath.split('/');
    const currentChannel = pathSegments[1];
    
    // Skip auth-related paths
    if (!currentChannel || 
        currentChannel === 'oauth2' || 
        pathSegments.includes('oauth') || 
        pathSegments.includes('authorize') ||
        window.location.href.includes('auth/callback') ||
        window.location.href.includes('auth/redirect')) {
      return;
    }
    
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
  badgeContainer.title = formatRankText(rankData);
  
  // We'll let the CSS handle the styling now
  
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
  
  // Store rank data as attributes for tooltip
  badgeContainer.dataset.rank = rankData.tier;
  badgeContainer.dataset.division = rankData.division || '';
  badgeContainer.dataset.lp = rankData.leaguePoints || '';
  badgeContainer.dataset.username = rankData.summonerName || '';
  
  // Insert the badge in the appropriate location
  if (usernameContainer) {
    usernameContainer.insertBefore(badgeContainer, usernameContainer.firstChild);
  } else {
    // Fallback
    usernameElement.parentNode.insertBefore(badgeContainer, usernameElement);
  }
}

function formatRankText(rankData) {
  if (!rankData) return 'Unranked';
  
  let rankText = rankData.tier || 'Unranked';
  
  if (rankData.division && !['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(rankData.tier.toUpperCase())) {
    rankText += ' ' + rankData.division;
  }
  
  if (rankData.leaguePoints !== undefined) {
    rankText += ' - ' + rankData.leaguePoints + ' LP';
  }
  
  if (rankData.summonerName) {
    rankText += ` (${rankData.summonerName})`;
  }
  
  return rankText;
}

// Tooltip functions
function showTooltip(event) {
  // Create tooltip element if it doesn't exist globally
  if (!tooltipElement) {
    tooltipElement = document.createElement('div');
    tooltipElement.className = 'eloward-tooltip';
    document.body.appendChild(tooltipElement);
  }
  
  // Get rank data from the badge's dataset
  const badge = event.currentTarget;
  const rankTier = badge.dataset.rank || 'Unranked';
  const division = badge.dataset.division || '';
  const lp = badge.dataset.lp || '';
  const username = badge.dataset.username || '';
  
  // Format the tooltip text
  let tooltipText = rankTier;
  if (division) tooltipText += ' ' + division;
  if (lp) tooltipText += ' - ' + lp + ' LP';
  if (username) tooltipText += ` (${username})`;
  
  // Set the tooltip content and position
  tooltipElement.textContent = tooltipText;
  
  const rect = badge.getBoundingClientRect();
  tooltipElement.style.left = `${rect.left + rect.width / 2}px`;
  tooltipElement.style.top = `${rect.bottom + 5}px`;
  
  // Make the tooltip visible
  tooltipElement.classList.add('visible');
}

function hideTooltip() {
  if (tooltipElement) {
    tooltipElement.classList.remove('visible');
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
      position: absolute;
      z-index: 99999;
      background-color: rgba(34, 34, 34, 0.9);
      color: white;
      padding: 5px 10px;
      border-radius: 4px;
      font-size: 12px;
      pointer-events: none;
      transform: translateX(-50%);
      white-space: nowrap;
      opacity: 0;
      transition: opacity 0.2s ease;
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(200, 170, 110, 0.5);
    }
    
    .eloward-tooltip.visible {
      opacity: 1;
    }
  `;
  
  document.head.appendChild(styleElement);
} 