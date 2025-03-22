// DIRECT TEST LOG - This should always appear
console.log("🛡️ EloWard Extension Active");

// For testing purposes, force enable all channels
const TESTING_MODE = true; // Set to false for production
const DEBUG = true;

// Global state
let isChannelSubscribed = TESTING_MODE;
let channelName = '';
let processedMessages = new Set();
let observerInitialized = false;
let cachedUserMap = {}; // Cache for mapping Twitch usernames to Riot IDs
let tooltipElement = null; // Global tooltip element
let currentUser = null; // Current user's Twitch username

// Simple debug logger
function debugLog(...args) {
  if (DEBUG) {
    console.log("EloWard:", ...args);
  }
}

// Initialize storage data once at startup
initializeStorage();

// Initialize when the page is loaded
initializeExtension();
// Also set a delayed initialization to catch slow-loading pages
setTimeout(initializeExtension, 3000);

// Add a window.onload handler as an additional initialization method
window.addEventListener('load', function() {
  initializeExtension();
  
  // Add a direct test after 5 seconds to bypass all normal extension mechanisms
  setTimeout(() => {
    directBadgeInsertionTest();
  }, 5000);
  
  // Also add a click handler to the debug indicator for manual testing
  setupDebugIndicator();
});

// Initialize storage and load user data
function initializeStorage() {
  chrome.storage.local.get(null, (allData) => {
    if (DEBUG) {
      console.log("🔎 STORAGE DEBUG - All stored data:", allData);
      
      // Specifically check for Twitch username in all possible formats
      const possibleTwitchKeys = [
        'twitchUsername', 
        'twitch_username',
        'eloward_persistent_twitch_user_data',
        'eloward_twitch_user_info'
      ];
      
      console.log("🔎 STORAGE DEBUG - Checking for Twitch username in all possible formats:");
      possibleTwitchKeys.forEach(key => {
        console.log(`  - Key "${key}": ${allData[key] ? JSON.stringify(allData[key]) : 'not found'}`);
      });
    }
    
    // Find current user in storage using consolidated logic
    currentUser = findCurrentUser(allData);
    
    // Process rank data from linked accounts
    if (allData.linkedAccounts) {
      processLinkedAccounts(allData.linkedAccounts);
    }
    
    // If debug mode, show an indicator
    if (DEBUG) {
      injectVisibleDebugIndicator();
    }
  });
}

// Find current Twitch user from various storage formats
function findCurrentUser(allData) {
  // Check storage in order of preference
  if (allData.eloward_persistent_twitch_user_data?.login) {
    const twitchData = allData.eloward_persistent_twitch_user_data;
    debugLog(`Found current user from persistent storage: ${twitchData.login.toLowerCase()} (display name: ${twitchData.display_name})`);
    return twitchData.login.toLowerCase();
  } 
  
  if (allData.twitchUsername) {
    debugLog(`Found current user from direct 'twitchUsername' key: ${allData.twitchUsername.toLowerCase()}`);
    return allData.twitchUsername.toLowerCase();
  }
  
  if (allData.eloward_twitch_user_info?.login) {
    const twitchInfo = allData.eloward_twitch_user_info;
    debugLog(`Found current user from Twitch API info: ${twitchInfo.login.toLowerCase()} (display name: ${twitchInfo.display_name})`);
    return twitchInfo.login.toLowerCase();
  }
  
  // Search through all keys for possible Twitch data as last resort
  for (const key in allData) {
    if (key.toLowerCase().includes('twitch')) {
      const data = allData[key];
      if (data && typeof data === 'object' && (data.login || data.display_name)) {
        const username = (data.login || data.display_name).toLowerCase();
        debugLog(`Extracted username from "${key}": ${username}`);
        return username;
      }
    }
  }
  
  debugLog('No Twitch user data found in any storage format');
  return null;
}

// Process linked accounts and build rank cache
function processLinkedAccounts(linkedAccounts) {
  Object.keys(linkedAccounts).forEach(username => {
    const account = linkedAccounts[username];
    if (account && account.rankData) {
      const lowerUsername = username.toLowerCase();
      cachedUserMap[lowerUsername] = account.rankData;
      debugLog(`Loaded rank data for ${lowerUsername} from storage`);
    }
  });
  
  // Also add entry for current user if not present through case-insensitive search
  if (currentUser && !cachedUserMap[currentUser]) {
    const foundKey = Object.keys(linkedAccounts).find(
      key => key.toLowerCase() === currentUser.toLowerCase()
    );
    
    if (foundKey) {
      debugLog(`Found current user with different case: ${foundKey}`);
      cachedUserMap[currentUser] = linkedAccounts[foundKey].rankData;
    }
  }
  
  debugLog("Available usernames in cache:", Object.keys(cachedUserMap));
}

function initializeExtension() {
  // Extract channel name from URL
  channelName = window.location.pathname.split('/')[1];
  if (!channelName) {
    debugLog("No channel name found in URL");
    return;
  }
  
  debugLog(`Initializing for channel: ${channelName}`);
  
  // Add extension styles if needed
  if (!document.querySelector('#eloward-extension-styles')) {
    addExtensionStyles();
  }
  
  // In testing mode, skip subscription check
  if (TESTING_MODE) {
    debugLog(`TESTING MODE: Treating channel ${channelName} as subscribed`);
    isChannelSubscribed = true;
    initializeObserver();
    return;
  }
  
  // Check subscription status with background script
  try {
    chrome.runtime.sendMessage(
      { action: 'check_streamer_subscription', streamer: channelName },
      (response) => {
        if (chrome.runtime.lastError) {
          debugLog("Chrome runtime error:", chrome.runtime.lastError);
          if (TESTING_MODE) isChannelSubscribed = true;
          return;
        }
        
        if (response && response.subscribed) {
          isChannelSubscribed = true;
          debugLog(`Channel ${channelName} is subscribed`);
          initializeObserver();
          
          // Force refresh linked accounts from the background script
          chrome.runtime.sendMessage({ action: 'refresh_linked_accounts' });
        } else if (TESTING_MODE) {
          isChannelSubscribed = true;
          debugLog(`TESTING MODE: Overriding subscription check for ${channelName}`);
          initializeObserver();
        } else {
          isChannelSubscribed = false;
          debugLog(`Channel ${channelName} is NOT subscribed`);
        }
      }
    );
  } catch (error) {
    console.error("Error sending message to background script:", error);
    if (TESTING_MODE) {
      isChannelSubscribed = true;
      initializeObserver();
    }
  }
  
  // Setup URL change monitoring if not already done
  setupUrlChangeObserver();
}

// Set up observer for URL changes (when user navigates to a different channel)
function setupUrlChangeObserver() {
  if (!window.elowardUrlChangeObserver) {
    window.elowardUrlChangeObserver = true;
    let lastUrl = window.location.href;
    debugLog("Setting up URL change observer");
    
    new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        debugLog(`URL changed from ${lastUrl} to ${window.location.href}`);
        lastUrl = window.location.href;
        
        // Reset state
        isChannelSubscribed = TESTING_MODE;
        channelName = window.location.pathname.split('/')[1];
        processedMessages.clear();
        
        // Re-initialize for the new channel
        initializeExtension();
      }
    }).observe(document, { subtree: true, childList: true });
  }
}

function initializeObserver() {
  if (observerInitialized) {
    debugLog("Observer already initialized, skipping");
    return;
  }
  
  const chatContainer = findChatContainer();
  
  if (chatContainer) {
    // Chat container found, set up the observer
    debugLog("Setting up chat observer for container");
    setupChatObserver(chatContainer);
    observerInitialized = true;
    
    // Also set up a fallback observer for the whole chat area
    const chatArea = document.querySelector('.chat-room, .right-column, [data-test-selector="chat-room"]');
    if (chatArea && chatArea !== chatContainer) {
      debugLog("Setting up fallback chat observer");
      setupChatObserver(chatArea, true);
    }
  } else {
    // Chat container not found yet, wait and try again
    debugLog("Chat container not found, retrying in 2 seconds");
    setTimeout(() => {
      const chatContainer = findChatContainer();
      
      if (chatContainer) {
        debugLog("Chat container found on retry");
        setupChatObserver(chatContainer);
        observerInitialized = true;
      } else {
        // Last resort: observe the whole right column
        const rightColumn = document.querySelector('.right-column, [data-test-selector="right-column"]');
        if (rightColumn) {
          debugLog("Using right column as fallback for chat container");
          setupChatObserver(rightColumn, true);
          observerInitialized = true;
        } else {
          debugLog("Could not find any container for chat");
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
      debugLog(`Chat container found with selector: ${selector}`);
      return container;
    }
  }
  
  // Fallback: look for elements containing chat messages
  const potentialContainers = document.querySelectorAll('[class*="chat"], [class*="message"]');
  
  for (const container of potentialContainers) {
    const usernameElements = container.querySelectorAll('.chat-author__display-name, [data-a-target="chat-message-username"]');
    if (usernameElements.length > 0) {
      debugLog(`Found chat container with ${usernameElements.length} username elements`);
      return container;
    }
  }
  
  return null;
}

function setupChatObserver(chatContainer, isFallbackObserver = false) {
  // Create a MutationObserver to watch for new chat messages
  const chatObserver = new MutationObserver((mutations) => {
    // Process messages even if channel isn't subscribed when in testing mode
    if (!isChannelSubscribed && !TESTING_MODE) return;
    
    let newMessagesProcessed = 0;
    
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
              newMessagesProcessed++;
            } else if (isFallbackObserver) {
              // For fallback observers, look deeper for chat messages
              const messages = node.querySelectorAll('[data-a-target="chat-line-message"], .chat-line__message, .chat-line');
              messages.forEach(message => {
                processNewMessage(message);
                newMessagesProcessed++;
              });
            }
          }
        }
      }
    }
    
    if (newMessagesProcessed > 0) {
      debugLog(`Processed ${newMessagesProcessed} new messages`);
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
    debugLog(`Found cached rank for ${username}`);
    addBadgeToMessage(usernameElement, cachedUserMap[cachedUsername]);
    return;
  }
  
  // For testing mode, check if this is the current user
  if (TESTING_MODE && currentUser && username === currentUser.toLowerCase()) {
    debugLog(`This is the current user, checking for authenticated rank data`);
    
    // Get user's actual rank from Riot data
    chrome.storage.local.get(['eloward_persistent_riot_user_data'], (data) => {
      const riotData = data.eloward_persistent_riot_user_data;
      
      if (riotData?.rankInfo) {
        debugLog(`Found authenticated Riot rank data`);
        
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
  
  // In testing mode, stop here for non-current users
  if (TESTING_MODE) return;
  
  // For production, fetch rank from background script
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
  
  // Apply badge styling
  badgeContainer.style.display = 'inline-block';
  badgeContainer.style.verticalAlign = 'middle';
  badgeContainer.style.marginLeft = '4px';
  badgeContainer.style.marginRight = '4px';
  badgeContainer.style.height = '18px';
  badgeContainer.style.cursor = 'pointer';
  
  // Create the rank image
  const rankImg = document.createElement('img');
  rankImg.alt = rankData.tier;
  rankImg.className = 'chat-badge'; // Add Twitch's chat-badge class for better styling
  rankImg.width = 18;
  rankImg.height = 18;
  
  // Set image source based on rank tier
  try {
    const tier = rankData.tier.toLowerCase();
    rankImg.src = chrome.runtime.getURL(`images/ranks/${tier}18.png`);
  } catch (error) {
    console.error("Error setting badge image source:", error);
    return; // Don't continue if we can't get the image
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
      display: inline-block;
      margin-left: 4px;
      margin-right: 4px;
      vertical-align: middle;
      cursor: pointer;
      transition: transform 0.2s ease;
    }
    
    .eloward-rank-badge:hover {
      transform: scale(1.2);
    }
    
    .eloward-rank-badge img {
      display: inline-block;
      width: 18px;
      height: 18px;
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
    
    .eloward-debug-indicator {
      position: fixed;
      bottom: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.7);
      color: #00ff00;
      padding: 5px 10px;
      border-radius: 5px;
      z-index: 9999999;
      font-size: 12px;
      font-family: Arial, sans-serif;
    }
  `;
  
  document.head.appendChild(styleElement);
  debugLog("Added extension styles");
}

// Direct test function that bypasses normal extension mechanisms
function directBadgeInsertionTest() {
  // Use the cached currentUser
  let targetUsername = currentUser;
  
  if (!targetUsername) {
    // If not cached, try to get from storage
    chrome.storage.local.get(null, (allData) => {
      targetUsername = findCurrentUser(allData);
      
      if (!targetUsername) {
        console.error("No user found in storage, cannot add badges");
        return;
      }
      
      performBadgeInsertion(targetUsername);
    });
  } else {
    performBadgeInsertion(targetUsername);
  }
}

function performBadgeInsertion(targetUsername) {
  // Try to find messages in the chat
  const usernameElements = document.querySelectorAll('.chat-author__display-name, [data-a-target="chat-message-username"]');
  let badgesAdded = 0;
  
  usernameElements.forEach(usernameEl => {
    // Check if this username matches our target (case insensitive)
    const username = usernameEl.textContent.trim().toLowerCase();
    
    if (username === targetUsername.toLowerCase()) {
      // Check for existing badges first
      const parentContainer = usernameEl.closest('.chat-line__username-container');
      if (parentContainer?.querySelector('.eloward-rank-badge, img[class*="badge"]')) return;
      
      // Create a badge if we have rank data
      let rankTier = null;
      if (cachedUserMap[username]?.tier) {
        rankTier = cachedUserMap[username].tier;
      } else {
        // Check storage for Riot rank data
        chrome.storage.local.get(['eloward_persistent_riot_user_data'], (data) => {
          const riotData = data.eloward_persistent_riot_user_data;
          if (riotData?.rankInfo) {
            // Add badge with actual rank data
            const userRankData = {
              tier: riotData.rankInfo.tier,
              division: riotData.rankInfo.rank,
              leaguePoints: riotData.rankInfo.leaguePoints,
              summonerName: riotData.gameName
            };
            addBadgeToMessage(usernameEl, userRankData);
          }
        });
        return;
      }
      
      // If we have rank data in cache, use it
      if (rankTier) {
        addBadgeToMessage(usernameEl, cachedUserMap[username]);
        badgesAdded++;
      }
    }
  });
  
  debugLog(`Direct test complete. Added ${badgesAdded} badges.`);
}

// Function to inject a visible indicator on the page
function injectVisibleDebugIndicator() {
  if (document.getElementById('eloward-debug-indicator')) return;
  
  const indicator = document.createElement('div');
  indicator.id = 'eloward-debug-indicator';
  indicator.className = 'eloward-debug-indicator';
  indicator.innerHTML = 'EloWard Active';
  
  // Add it to the document body if it exists, otherwise wait for it
  if (document.body) {
    document.body.appendChild(indicator);
  } else {
    // Body not available yet, wait for it
    const observer = new MutationObserver(function() {
      if (document.body) {
        document.body.appendChild(indicator);
        observer.disconnect();
      }
    });
    
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }
}

// Setup debug indicator with click handler
function setupDebugIndicator() {
  const indicator = document.getElementById('eloward-debug-indicator');
  if (indicator) {
    indicator.innerHTML = 'EloWard Active (Click to Test)';
    indicator.style.cursor = 'pointer';
    indicator.onclick = directBadgeInsertionTest;
  }
} 