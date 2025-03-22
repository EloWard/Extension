// DIRECT TEST LOG - This should always appear
console.log("🛡️ EloWard Extension Active");

// Debug storage access immediately
chrome.storage.local.get(null, (allData) => {
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
  
  // Check linked accounts
  console.log("🔎 STORAGE DEBUG - Linked accounts:", allData.linkedAccounts || 'not found');
});

// Inject a visible indicator to show the extension is running
injectVisibleDebugIndicator();

// For testing purposes, force enable all channels
const TESTING_MODE = true; // Set to false for production

// Set up a failsafe to ensure something happens even if normal init fails
setTimeout(() => {
  directBadgeInsertionTest();
  
  // Also add a click handler to the debug indicator for manual testing
  const indicator = document.getElementById('eloward-debug-indicator');
  if (indicator) {
    indicator.innerHTML = 'EloWard Active (Click to Test)';
    indicator.style.cursor = 'pointer';
    indicator.onclick = () => {
      directBadgeInsertionTest();
    };
  }
}, 10000);

// EloWard Content Script
// This script runs on Twitch pages and adds rank badges to chat messages

// Global state
let isChannelSubscribed = TESTING_MODE; // Default to true in testing mode
let channelName = '';
let processedMessages = new Set();
let observerInitialized = false;
let cachedUserMap = {}; // Cache for mapping Twitch usernames to Riot IDs
let tooltipElement = null; // Global tooltip element
let currentUser = null; // Current user's Twitch username

// Enable debug logging for username matching issues
const DEBUG = true;
function debugLog(...args) {
  if (DEBUG) {
    console.log("EloWard:", ...args);
  }
}

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
});

// Load user data from storage
async function loadUserDataFromStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (allData) => {
      console.log("🔎 STORAGE DEBUG - Full storage contents:", allData);
      
      // Try to find Twitch username in all storage formats
      let foundTwitchData = null;
      
      // First check the PersistentStorage format (production)
      if (allData.eloward_persistent_twitch_user_data) {
        const twitchData = allData.eloward_persistent_twitch_user_data;
        if (twitchData.login) {
          currentUser = twitchData.login.toLowerCase();
          console.log(`🔎 Found current user from persistent storage: ${currentUser} (display name: ${twitchData.display_name})`);
          foundTwitchData = true;
        }
      } 
      // Then check the direct twitchUsername key (might be used in older versions)
      else if (allData.twitchUsername) {
        currentUser = allData.twitchUsername.toLowerCase();
        console.log(`🔎 Found current user from direct 'twitchUsername' key: ${currentUser}`);
        foundTwitchData = true;
      }
      // Then check the Twitch API user info format
      else if (allData.eloward_twitch_user_info) {
        const twitchInfo = allData.eloward_twitch_user_info;
        if (twitchInfo.login) {
          currentUser = twitchInfo.login.toLowerCase();
          console.log(`🔎 Found current user from Twitch API info: ${currentUser} (display name: ${twitchInfo.display_name})`);
          foundTwitchData = true;
        }
      }
      
      // If not found yet, search through all keys for possible Twitch data
      if (!foundTwitchData) {
        for (const key in allData) {
          if (key.toLowerCase().includes('twitch')) {
            console.log(`🔎 Found potential Twitch data in key "${key}":`, allData[key]);
            
            // Try to extract username from this data
            const data = allData[key];
            if (data && typeof data === 'object') {
              if (data.login || data.display_name) {
                currentUser = (data.login || data.display_name).toLowerCase();
                console.log(`🔎 Extracted username from "${key}": ${currentUser}`);
                foundTwitchData = true;
                break;
              }
            }
          }
        }
        
        if (!foundTwitchData) {
          console.log('🔎 No Twitch user data found in any storage format');
        }
      }
      
      if (allData.linkedAccounts) {
        // Convert linkedAccounts to our cached user map format
        Object.keys(allData.linkedAccounts).forEach(username => {
          const account = allData.linkedAccounts[username];
          if (account && account.rankData) {
            const lowerUsername = username.toLowerCase();
            cachedUserMap[lowerUsername] = account.rankData;
            console.log(`Loaded rank data for ${lowerUsername} from storage (original: ${username})`);
          }
        });
        
        // Also add entry for current user if not present
        if (currentUser && !cachedUserMap[currentUser]) {
          console.log(`Current user ${currentUser} not found in linkedAccounts, creating default entry`);
          
          // Try to find the current user in any case variation
          const foundKey = Object.keys(allData.linkedAccounts).find(
            key => key.toLowerCase() === currentUser.toLowerCase()
          );
          
          if (foundKey) {
            console.log(`Found current user with different case: ${foundKey}`);
            cachedUserMap[currentUser] = allData.linkedAccounts[foundKey].rankData;
          }
        }
        
        // Debug output for cached usernames
        console.log("Available usernames in cache:", Object.keys(cachedUserMap));
      } else {
        console.log('No linked accounts found in storage');
      }
      
      resolve({
        currentUser,
        linkedAccounts: allData.linkedAccounts || {}
      });
    });
  });
}

function initializeExtension() {
  // Extract channel name from URL
  channelName = window.location.pathname.split('/')[1];
  if (!channelName) {
    debugLog("No channel name found in URL");
    return;
  }
  
  debugLog(`Initializing for channel: ${channelName}`);
  
  // Pre-check if extension CSS has been added
  if (!document.querySelector('#eloward-extension-styles')) {
    addExtensionStyles();
    debugLog("Added extension styles");
  }
  
  // Load user data from storage
  loadUserDataFromStorage().then(userData => {
    // In testing mode, treat all channels as subscribed
    if (TESTING_MODE) {
      debugLog(`TESTING MODE: Treating channel ${channelName} as subscribed`);
      isChannelSubscribed = true;
      
      // Initialize the observer for chat messages
      debugLog("Initializing chat observer");
      initializeObserver();
      
      // Show a subtle notification that EloWard is active
      showActivationNotification();
      
      // If no cached data loaded, ask the background page for user's current rank
      if (currentUser && Object.keys(cachedUserMap).length === 0) {
        debugLog(`Asking background script for rank data for current user ${currentUser}`);
        try {
          chrome.runtime.sendMessage(
            { action: 'fetch_rank_for_username', username: currentUser },
            (response) => {
              if (chrome.runtime.lastError) {
                console.error("Error fetching user rank:", chrome.runtime.lastError);
                return;
              }
              
              if (response && response.rankData) {
                cachedUserMap[currentUser] = response.rankData;
                debugLog(`Received rank data for current user: ${currentUser}`, response.rankData);
              }
            }
          );
        } catch (error) {
          console.error("Error sending message to background script:", error);
        }
      }
      
      return;
    }
    
    // Normal subscription check path for production
    debugLog(`Checking if ${channelName} has a subscription`);
    
    try {
      chrome.runtime.sendMessage(
        { action: 'check_streamer_subscription', streamer: channelName },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error("Chrome runtime error:", chrome.runtime.lastError);
            if (TESTING_MODE) {
              // Fall back to enabled if in testing mode
              isChannelSubscribed = true;
              initializeObserver();
            }
            return;
          }
          
          debugLog(`Subscription check response for ${channelName}:`, response);
          if (response && response.subscribed) {
            isChannelSubscribed = true;
            debugLog(`Channel ${channelName} is subscribed`);
            
            // Inject the style needed for badges if it doesn't exist
            if (!document.querySelector('#eloward-extension-styles')) {
              addExtensionStyles();
              debugLog("Added extension styles");
            }
            
            // Initialize the observer for chat messages
            debugLog("Initializing chat observer");
            initializeObserver();
            
            // Show a subtle notification that EloWard is active
            showActivationNotification();
            
            // Force refresh linked accounts from the background script
            debugLog("Refreshing linked accounts");
            try {
              chrome.runtime.sendMessage({ action: 'refresh_linked_accounts' });
            } catch (error) {
              console.error("Error refreshing linked accounts:", error);
            }
          } else {
            // Even if not subscribed, still initialize in testing mode
            if (TESTING_MODE) {
              isChannelSubscribed = true;
              debugLog(`TESTING MODE: Overriding subscription check for ${channelName}`);
              initializeObserver();
              showActivationNotification();
            } else {
              isChannelSubscribed = false;
              debugLog(`Channel ${channelName} is NOT subscribed`);
            }
          }
        }
      );
    } catch (error) {
      console.error("Error sending message to background script:", error);
      if (TESTING_MODE) {
        // Fall back to enabled if in testing mode
        isChannelSubscribed = true;
        initializeObserver();
        showActivationNotification();
      }
    }
  });
  
  // Listen for URL changes (when user navigates to a different channel)
  if (!window.elowardUrlChangeObserver) {
    window.elowardUrlChangeObserver = true;
    let lastUrl = window.location.href;
    debugLog("Setting up URL change observer");
    
    new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        debugLog(`URL changed from ${lastUrl} to ${window.location.href}`);
        lastUrl = window.location.href;
        
        // Reset state
        isChannelSubscribed = TESTING_MODE; // Default to true in testing mode
        channelName = window.location.pathname.split('/')[1];
        processedMessages.clear();
        
        // Don't clear the cached user map when changing channels
        // Instead, refresh it from storage
        loadUserDataFromStorage();
        
        debugLog(`Reset state for channel: ${channelName}`);
        
        // Remove any existing notification
        removeActivationNotification();
        
        // In testing mode, skip subscription check
        if (TESTING_MODE) {
          isChannelSubscribed = true;
          debugLog(`TESTING MODE: Treating new channel ${channelName} as subscribed`);
          observerInitialized = false;
          initializeObserver();
          showActivationNotification();
          return;
        }
        
        // Check if the new channel is subscribed
        if (channelName) {
          debugLog(`Checking if new channel ${channelName} is subscribed`);
          chrome.runtime.sendMessage(
            { action: 'check_streamer_subscription', streamer: channelName },
            (response) => {
              debugLog(`New channel subscription check response:`, response);
              if (response && response.subscribed) {
                isChannelSubscribed = true;
                debugLog(`New channel ${channelName} is subscribed`);
                
                // Force refresh of linked accounts
                debugLog("Refreshing linked accounts for new channel");
                chrome.runtime.sendMessage({ action: 'refresh_linked_accounts' });
                
                // Re-initialize the observer for chat messages
                observerInitialized = false; // Reset the observer flag
                debugLog("Re-initializing chat observer for new channel");
                initializeObserver();
                
                // Show a subtle notification that EloWard is active
                showActivationNotification();
              } else {
                if (TESTING_MODE) {
                  isChannelSubscribed = true;
                  debugLog(`TESTING MODE: Overriding subscription check for new channel ${channelName}`);
                  observerInitialized = false;
                  initializeObserver();
                  showActivationNotification();
                } else {
                  isChannelSubscribed = false;
                  debugLog(`New channel ${channelName} is NOT subscribed`);
                }
              }
            }
          );
        }
      }
    }).observe(document, { subtree: true, childList: true });
  }
}

function initializeObserver() {
  if (observerInitialized) {
    debugLog("Observer already initialized, skipping");
    return;
  }
  
  function findChatContainer() {
    // Try to find the chat container
    // Twitch's DOM structure can change, so we need to be flexible
    const chatContainerSelectors = [
      '.chat-scrollable-area__message-container',
      '.chat-list--default',
      '.chat-list',
      '[data-test-selector="chat-scrollable-area-container"]',
      '[data-a-target="chat-scroller"]',
      '[role="log"]', // Twitch often uses this for the chat container
      '.chat-room__container',
      '.chat-room',
      '.stream-chat',
      '.chat-shell',
      '.chat-shell__expanded', // Added from our analysis
      '.Layout-sc-1xcs6mc-0.capulb.chat-scrollable-area__message-container' // Added from our analysis
    ];
    
    debugLog("Searching for chat container...");
    
    for (const selector of chatContainerSelectors) {
      const container = document.querySelector(selector);
      if (container) {
        debugLog(`Chat container found with selector: ${selector}`);
        return container;
      }
    }
    
    // If all selectors fail, try a more general approach:
    // Look for elements that might contain chat messages
    debugLog("Trying general chat container search...");
    const potentialContainers = document.querySelectorAll('[class*="chat"], [class*="message"]');
    debugLog(`Found ${potentialContainers.length} potential chat containers`);
    
    for (const container of potentialContainers) {
      // Check if this element contains chat messages (has children with usernames)
      const usernameElements = container.querySelectorAll('.chat-author__display-name, [data-a-target="chat-message-username"]');
      if (usernameElements.length > 0) {
        debugLog(`Found chat container with ${usernameElements.length} username elements`);
        return container;
      }
    }
    
    debugLog("No chat container found");
    return null;
  }
  
  // Try to find the chat container
  let chatContainer = findChatContainer();
  
  if (chatContainer) {
    // Chat container found, set up the observer
    debugLog("Setting up chat observer for container:", chatContainer);
    setupChatObserver(chatContainer);
    observerInitialized = true;
    
    // Also set up a fallback observer for the whole chat area in case messages appear in a different container
    const chatArea = document.querySelector('.chat-room, .right-column, [data-test-selector="chat-room"]');
    if (chatArea && chatArea !== chatContainer) {
      debugLog("Setting up fallback chat observer for:", chatArea);
      setupChatObserver(chatArea, true);
    }
  } else {
    // Chat container not found yet, wait and try again
    debugLog("Chat container not found, retrying in 2 seconds");
    setTimeout(() => {
      chatContainer = findChatContainer();
      if (chatContainer) {
        debugLog("Chat container found on retry:", chatContainer);
        setupChatObserver(chatContainer);
        observerInitialized = true;
        
        // Also set up a fallback observer
        const chatArea = document.querySelector('.chat-room, .right-column, [data-test-selector="chat-room"]');
        if (chatArea && chatArea !== chatContainer) {
          debugLog("Setting up fallback chat observer on retry for:", chatArea);
          setupChatObserver(chatArea, true);
        }
      } else {
        // Last resort: observe the whole right column where chat usually is
        debugLog("Still no chat container found, using right column as last resort");
        const rightColumn = document.querySelector('.right-column, [data-test-selector="right-column"]');
        if (rightColumn) {
          debugLog("Setting up last resort observer for right column");
          setupChatObserver(rightColumn, true);
          observerInitialized = true;
        } else {
          debugLog("Could not find any container for chat, badge display will not work");
        }
      }
    }, 2000);
  }
}

function setupChatObserver(chatContainer, isFallbackObserver = false) {
  debugLog(`Setting up ${isFallbackObserver ? 'fallback' : 'primary'} observer for:`, chatContainer);
  
  // Create a MutationObserver to watch for new chat messages
  const chatObserver = new MutationObserver((mutations) => {
    // Process messages even if channel isn't subscribed when in testing mode
    if (!isChannelSubscribed && !TESTING_MODE) {
      debugLog("Channel not subscribed, ignoring chat messages");
      return;
    }
    
    let newMessagesProcessed = 0;
    
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        debugLog(`Detected ${mutation.addedNodes.length} new nodes in chat`);
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if this is a chat message or might contain chat messages
            if (node.classList && (
                node.classList.contains('chat-line__message') || 
                node.classList.contains('chat-line') ||
                node.querySelector('.chat-author__display-name, [data-a-target="chat-message-username"]')
              )) {
              // This is a chat message
              debugLog("Processing new chat message:", node.textContent?.substring(0, 30));
              processNewMessage(node);
              newMessagesProcessed++;
            } else if (isFallbackObserver) {
              // For fallback observers, look deeper for chat messages
              const messages = node.querySelectorAll('[data-a-target="chat-line-message"], .chat-line__message, .chat-line');
              debugLog(`Fallback observer found ${messages.length} potential messages`);
              messages.forEach(message => {
                debugLog("Processing potential message from fallback:", message.textContent?.substring(0, 30));
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
    subtree: isFallbackObserver // Use subtree for fallback observers to catch messages deeper in the DOM
  });
  
  // Also process any existing messages
  const existingMessages = isFallbackObserver ? 
    chatContainer.querySelectorAll('[data-a-target="chat-line-message"], .chat-line__message, .chat-line') : 
    chatContainer.children;
    
  debugLog(`Processing ${existingMessages.length} existing messages`);
  for (const message of existingMessages) {
    processNewMessage(message);
  }
}

function processNewMessage(messageNode) {
  // Skip if we've already processed this message
  if (processedMessages.has(messageNode) || processedMessages.size > 1000) {
    // If we have too many processed messages, clear the set to prevent memory issues
    if (processedMessages.size > 1000) {
      debugLog("Clearing processed messages cache (exceeded 1000)");
      processedMessages.clear();
    }
    return;
  }
  
  // Mark this message as processed
  processedMessages.add(messageNode);
  
  // Try to find the username element in the message using the most reliable selectors
  let usernameElement = messageNode.querySelector('.chat-author__display-name, [data-a-target="chat-message-username"]');
  
  // If we didn't find a username element directly, try to look deeper
  if (!usernameElement && messageNode.nodeType === Node.ELEMENT_NODE) {
    // Check if this might be a container that contains a chat message
    usernameElement = messageNode.querySelector('.chat-author__display-name, [data-a-target="chat-message-username"]');
  }
  
  if (!usernameElement) {
    return;
  }
  
  // Always use lowercase for username lookups to handle display name case sensitivity
  const username = usernameElement.textContent.trim().toLowerCase();
  console.log(`Processing message from: ${username} (original: ${usernameElement.textContent.trim()})`);
  
  // Debug output to check all cached usernames
  console.log(`Available cached usernames: ${Object.keys(cachedUserMap).join(', ')}`);
  
  // Check if this user has a cached rank (case insensitive)
  const cachedUsername = Object.keys(cachedUserMap).find(key => 
    key.toLowerCase() === username.toLowerCase()
  );
  
  if (cachedUsername) {
    console.log(`Found cached rank for ${username} (matched: ${cachedUsername})`, cachedUserMap[cachedUsername]);
    addBadgeToMessage(usernameElement, cachedUserMap[cachedUsername]);
    return;
  }
  
  console.log(`No cached rank found for ${username}`);
  
  // For testing mode, check if this is the current user
  if (TESTING_MODE && currentUser && username.toLowerCase() === currentUser.toLowerCase()) {
    console.log(`This is the current user, checking for authenticated rank data`);
    
    // Instead of using a hardcoded rank, get the user's actual rank from storage
    chrome.storage.local.get(['eloward_persistent_riot_user_data'], (data) => {
      let userRankData = null;
      
      // Check if we have authenticated Riot rank data
      if (data.eloward_persistent_riot_user_data && data.eloward_persistent_riot_user_data.rankInfo) {
        const riotData = data.eloward_persistent_riot_user_data;
        console.log(`Found authenticated Riot rank data:`, riotData.rankInfo);
        
        // Convert the Riot rank format to our format
        userRankData = {
          tier: riotData.rankInfo.tier,
          division: riotData.rankInfo.rank, // In Riot API, "rank" is the division (I, II, III, IV)
          leaguePoints: riotData.rankInfo.leaguePoints,
          summonerName: riotData.gameName
        };
        
        console.log(`Using authenticated rank: ${userRankData.tier} ${userRankData.division} (${userRankData.leaguePoints} LP)`);
      } else {
        console.log(`No authenticated Riot rank data found. User has connected but may not have ranked data.`);
        // Log this situation but don't add a rank badge when no actual data exists
        return;
      }
      
      // Only proceed if we found actual rank data
      if (userRankData) {
        // Add it to cache
        cachedUserMap[username] = userRankData;
        // Add the badge
        addBadgeToMessage(usernameElement, userRankData);
      }
    });
    return;
  }
  
  // For testing mode, return since we don't have this user in cache
  if (TESTING_MODE) {
    return;
  }
  
  // If we don't have the rank data, fetch it from the background script
  debugLog(`Fetching rank for ${username}`);
  try {
    chrome.runtime.sendMessage(
      { 
        action: 'fetch_rank_for_username',
        username: username,
        channel: channelName
      },
      response => {
        if (chrome.runtime.lastError) {
          console.error("Error fetching rank:", chrome.runtime.lastError);
          return;
        }
        
        debugLog(`Rank lookup response for ${username}:`, response);
        if (response && response.success && response.rankData) {
          debugLog(`Received rank data for ${username}:`, response.rankData);
          // Cache the response
          cachedUserMap[username] = response.rankData;
          
          // Add the badge to the message
          addBadgeToMessage(usernameElement, response.rankData);
        } else {
          debugLog(`No rank data found for ${username}`);
        }
      }
    );
  } catch (error) {
    console.error("Error sending rank lookup message:", error);
  }
}

function addBadgeToMessage(usernameElement, rankData) {
  // Skip if no rank data
  if (!rankData || !rankData.tier) {
    debugLog("No valid rank data provided for badge");
    return;
  }
  
  // Check if this username element already has a badge
  // Look in parent elements up to 3 levels to find any existing badges
  let currentNode = usernameElement;
  let depth = 0;
  while (currentNode && depth < 3) {
    if (currentNode.querySelector('.eloward-rank-badge, [class*="rank-badge"], img[src*="rank"]')) {
      debugLog("Badge already exists for this username element, skipping");
      return;
    }
    currentNode = currentNode.parentElement;
    depth++;
  }
  
  debugLog(`Adding badge for ${rankData.tier} to element:`, usernameElement);
  
  // Get the parent container that holds the username
  const usernameContainer = usernameElement.closest('.chat-line__username-container');
  if (!usernameContainer) {
    debugLog("Could not find username container with .chat-line__username-container, trying fallback");
    // Fallback to the older method if the container can't be found
    const messageContainer = findMessageContainer(usernameElement);
    if (!messageContainer) {
      debugLog("Could not find message container, aborting badge insertion");
      return;
    }
    
    // Check if this username already has a badge in this message
    const existingBadge = messageContainer.querySelector('.eloward-rank-badge');
    if (existingBadge) {
      debugLog("Badge already exists in message container, skipping");
      return;
    }
  } else {
    debugLog("Found username container:", usernameContainer);
    // Check if this username already has a badge in this container
    const existingBadge = usernameContainer.querySelector('.eloward-rank-badge');
    if (existingBadge) {
      debugLog("Badge already exists in username container, skipping");
      return;
    }
  }
  
  // Create badge container
  debugLog("Creating badge for tier:", rankData.tier);
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
  const tier = rankData.tier.toLowerCase();
  const imagePath = `images/ranks/${tier}18.png`;
  rankImg.src = chrome.runtime.getURL(imagePath);
  debugLog("Setting badge image source:", imagePath);
  
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
    // Use the new method: insert before the first child of the username container
    debugLog("Inserting badge into username container before:", usernameContainer.firstChild);
    usernameContainer.insertBefore(badgeContainer, usernameContainer.firstChild);
    debugLog("Badge inserted successfully");
  } else {
    // Fallback to old method
    debugLog("Using fallback method to insert badge before username element");
    usernameElement.parentNode.insertBefore(badgeContainer, usernameElement);
    debugLog("Badge inserted successfully (fallback method)");
  }
}

function findMessageContainer(usernameElement) {
  // Try to find the message container from the username element
  let container = usernameElement;
  let depth = 0;
  const maxDepth = 5; // Prevent infinite loops
  
  // Walk up the DOM until we find a suitable container
  while (container && depth < maxDepth) {
    // Check if this element is a chat message container
    if (
      container.classList && (
        container.classList.contains('chat-line__message') ||
        container.classList.contains('chat-line') ||
        container.classList.contains('message') ||
        container.getAttribute('data-a-target') === 'chat-line-message'
      )
    ) {
      return container;
    }
    
    container = container.parentElement;
    depth++;
  }
  
  // If we couldn't find a good container, just return the parent of the username
  return usernameElement.parentElement;
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

function showActivationNotification() {
  // Check if notification already exists
  if (document.querySelector('.eloward-activation-notification')) {
    return;
  }
  
  // Create notification element
  const notification = document.createElement('div');
  notification.className = 'eloward-activation-notification';
  notification.textContent = 'EloWard rank badges activated';
  
  // Add to page - will auto-hide via CSS animation
  document.body.appendChild(notification);
  
  // Remove after animation completes
  setTimeout(() => {
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification);
    }
  }, 5500); // Slightly longer than the animation duration
}

function removeActivationNotification() {
  // Remove any existing notifications
  const notification = document.querySelector('.eloward-activation-notification');
  if (notification && notification.parentNode) {
    notification.parentNode.removeChild(notification);
  }
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
  
  // Set the tooltip content
  tooltipElement.textContent = tooltipText;
  
  // Position the tooltip
  const rect = badge.getBoundingClientRect();
  tooltipElement.style.left = `${rect.left + rect.width / 2}px`;
  tooltipElement.style.top = `${rect.bottom + 5}px`;
  
  // Make the tooltip visible
  tooltipElement.classList.add('visible');
}

function hideTooltip() {
  // Hide the tooltip if it exists
  if (tooltipElement) {
    tooltipElement.classList.remove('visible');
  }
}

// Add the CSS needed for badges
function addExtensionStyles() {
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
    
    .eloward-activation-notification {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background-color: rgba(34, 34, 34, 0.9);
      color: white;
      padding: 10px 15px;
      border-radius: 4px;
      font-size: 14px;
      z-index: 9999;
      max-width: 300px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(200, 170, 110, 0.5);
      animation: fadeIn 0.3s ease-in-out, fadeOut 0.3s ease-in-out 5s forwards;
    }
    
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    @keyframes fadeOut {
      from { opacity: 1; transform: translateY(0); }
      to { opacity: 0; transform: translateY(20px); }
    }
  `;
  
  document.head.appendChild(styleElement);
}

// Direct test function that bypasses all normal extension mechanisms
function directBadgeInsertionTest() {
  // Try to get the current user's username from storage
  chrome.storage.local.get(null, (allData) => {
    console.log("🔎 DIRECT TEST - All stored data:", allData);
    
    // Try multiple possible storage formats
    let targetUsername = currentUser;
    
    if (!targetUsername) {
      // First try PersistentStorage format (production)
      if (allData.eloward_persistent_twitch_user_data) {
        const twitchData = allData.eloward_persistent_twitch_user_data;
        if (twitchData.login) {
          targetUsername = twitchData.login.toLowerCase();
          console.log(`🔎 DIRECT TEST - Using username from persistent storage: ${targetUsername}`);
        }
      } 
      // Then try direct twitchUsername key (older versions)
      else if (allData.twitchUsername) {
        targetUsername = allData.twitchUsername.toLowerCase();
        console.log(`🔎 DIRECT TEST - Using username from twitchUsername: ${targetUsername}`);
      }
      // Then try Twitch API user info
      else if (allData.eloward_twitch_user_info) {
        const twitchInfo = allData.eloward_twitch_user_info;
        if (twitchInfo.login) {
          targetUsername = twitchInfo.login.toLowerCase();
          console.log(`🔎 DIRECT TEST - Using username from Twitch API info: ${targetUsername}`);
        }
      }
      
      // If still not found, search all keys
      if (!targetUsername) {
        for (const key in allData) {
          if (key.toLowerCase().includes('twitch') && allData[key]) {
            const data = allData[key];
            if (typeof data === 'object' && (data.login || data.display_name)) {
              targetUsername = (data.login || data.display_name).toLowerCase();
              console.log(`🔎 DIRECT TEST - Found username in key "${key}": ${targetUsername}`);
              break;
            }
          }
        }
      }
    }
    
    // If we don't have a target username, we can't add badges
    if (!targetUsername) {
      console.error("No user found in storage, cannot add badges");
      return;
    }
    
    console.log(`Direct test looking for username: ${targetUsername}`);
    
    // Try to find messages in the chat
    const usernameElements = document.querySelectorAll('.chat-author__display-name, [data-a-target="chat-message-username"]');
    console.log(`Found ${usernameElements.length} username elements to check`);
    
    let badgesAdded = 0;
    usernameElements.forEach(usernameEl => {
      // Check if this username matches our target (case insensitive)
      const displayedName = usernameEl.textContent.trim();
      const username = displayedName.toLowerCase();
      
      if (username === targetUsername.toLowerCase()) {
        console.log(`Found match: "${displayedName}" matches target "${targetUsername}"`);
        
        // Check if this username element already has a badge next to it
        // First check the element itself
        if (usernameEl.querySelector('img[class*="badge"]')) {
          console.log(`Element already has a badge, skipping`);
          return;
        }
        
        // Then check the parent containers
        const parentContainer = usernameEl.closest('.chat-line__username-container');
        if (parentContainer && parentContainer.querySelector('img[class*="badge"]')) {
          console.log(`Username container already has a badge, skipping`);
          return;
        }
        
        // Create a badge
        const badge = document.createElement('img');
        badge.className = 'chat-badge';
        
        // Use rank data from cache if available
        let rankTier = null;
        if (cachedUserMap[username] && cachedUserMap[username].tier) {
          rankTier = cachedUserMap[username].tier;
          badge.alt = rankTier;
          console.log(`Using rank tier from cache: ${rankTier}`);
        } else {
          console.log(`No rank in cache for ${username}, cannot add badge`);
          return; // Don't add a badge if we don't have actual rank data
        }
        
        // Try to use chrome.runtime.getURL with error handling
        try {
          const imageURL = chrome.runtime.getURL(`images/ranks/${rankTier.toLowerCase()}18.png`);
          badge.src = imageURL;
          console.log(`Set badge image URL: ${imageURL}`);
        } catch (error) {
          console.error("Error accessing chrome.runtime.getURL:", error);
          return; // Don't continue if we can't get the image URL
        }
        
        badge.width = 18;
        badge.height = 18;
        badge.style.marginRight = '4px';
        
        // Get the parent container that holds the username
        const usernameContainer = usernameEl.closest('.chat-line__username-container');
        
        if (usernameContainer) {
          console.log(`Inserting badge into username container`);
          usernameContainer.insertBefore(badge, usernameContainer.firstChild);
          badgesAdded++;
        } else {
          console.log(`No username container found, inserting before username element`);
          usernameEl.parentNode.insertBefore(badge, usernameEl);
          badgesAdded++;
        }
      } else {
        console.log(`Username "${displayedName}" does not match target "${targetUsername}"`);
      }
    });
    
    console.log(`Direct test complete. Added ${badgesAdded} badges.`);
  });
}

// Function to inject a visible indicator on the page
function injectVisibleDebugIndicator() {
  const indicator = document.createElement('div');
  indicator.id = 'eloward-debug-indicator';
  indicator.innerHTML = 'EloWard Active';
  indicator.style.position = 'fixed';
  indicator.style.bottom = '10px';
  indicator.style.right = '10px';
  indicator.style.background = 'rgba(0, 0, 0, 0.7)';
  indicator.style.color = '#00ff00';
  indicator.style.padding = '5px 10px';
  indicator.style.borderRadius = '5px';
  indicator.style.zIndex = '9999999';
  indicator.style.fontSize = '12px';
  indicator.style.fontFamily = 'Arial, sans-serif';
  
  // Add it to the document body if it exists, otherwise wait for it
  if (document.body) {
    document.body.appendChild(indicator);
  } else {
    // Body not available yet, wait for it
    const observer = new MutationObserver(function(mutations) {
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