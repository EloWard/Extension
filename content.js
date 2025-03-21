// DIRECT TEST LOG - This should always appear
console.log("🔍 EloWard Extension Loading - Direct Console Test");

// Inject a visible indicator to show the extension is running
injectVisibleDebugIndicator();

// Set up a failsafe to ensure something happens even if normal init fails
setTimeout(() => {
  console.log("🚨 EloWard failsafe triggered after 10 seconds");
  directBadgeInsertionTest();
  
  // Also add a click handler to the debug indicator for manual testing
  const indicator = document.getElementById('eloward-debug-indicator');
  if (indicator) {
    indicator.innerHTML = 'EloWard Active (Click to Test)';
    indicator.style.cursor = 'pointer';
    indicator.onclick = () => {
      console.log("Manual test triggered by clicking debug indicator");
      directBadgeInsertionTest();
    };
  }
}, 10000);

// EloWard Content Script
// This script runs on Twitch pages and adds rank badges to chat messages

// Global state
let isChannelSubscribed = false;
let channelName = '';
let processedMessages = new Set();
let observerInitialized = false;
let cachedUserMap = {}; // Cache for mapping Twitch usernames to Riot IDs
let tooltipElement = null; // Global tooltip element

// Enable debug logging
const DEBUG = true;
function debugLog(...args) {
  if (DEBUG) {
    console.log("EloWard:", ...args);
  }
}

// Always show this log to confirm the extension is running
console.log("🛡️ EloWard Extension Activated 🛡️ - Version 1.0.5");

// Log extension initialization
debugLog("Content script loaded on", window.location.href);

// Initialize when the page is loaded
initializeExtension();
// Also set a delayed initialization to catch slow-loading pages
setTimeout(initializeExtension, 3000);

// Add a window.onload handler as an additional initialization method
window.addEventListener('load', function() {
  console.log("🌐 EloWard: Window fully loaded event triggered");
  initializeExtension();
  
  // Add a direct test after 5 seconds to bypass all normal extension mechanisms
  setTimeout(() => {
    console.log("🧪 Running direct badge insertion test");
    directBadgeInsertionTest();
  }, 5000);
});

// Add keyboard shortcut for debug overlay (Ctrl+Shift+E)
document.addEventListener('keydown', function(event) {
  // Removed debug shortcut functionality
});

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
  
  // Check if this streamer has a subscription
  debugLog(`Checking if ${channelName} has a subscription`);
  
  try {
    chrome.runtime.sendMessage(
      { action: 'check_streamer_subscription', streamer: channelName },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error("Chrome runtime error:", chrome.runtime.lastError);
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
          isChannelSubscribed = false;
          debugLog(`Channel ${channelName} is NOT subscribed`);
        }
      }
    );
  } catch (error) {
    console.error("Error sending message to background script:", error);
  }
  
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
        isChannelSubscribed = false;
        channelName = window.location.pathname.split('/')[1];
        processedMessages.clear();
        cachedUserMap = {}; // Clear the cache when changing channels
        
        debugLog(`Reset state for channel: ${channelName}`);
        
        // Remove any existing notification
        removeActivationNotification();
        
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
                debugLog(`New channel ${channelName} is NOT subscribed`);
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
    if (!isChannelSubscribed) {
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
  
  debugLog(`Processing message from: ${username}`);
  
  // We'll list all usernames we're checking to debug the matching issue
  debugLog(`Known usernames in cache: ${Object.keys(cachedUserMap).join(', ')}`);
  
  // Check if this user has a cached rank
  if (cachedUserMap[username]) {
    debugLog(`Found cached rank for ${username}:`, cachedUserMap[username]);
    addBadgeToMessage(usernameElement, cachedUserMap[username]);
    return;
  }
  
  // If we haven't cached any usernames, add your own username for testing
  // This is just for development/debugging purposes
  if (Object.keys(cachedUserMap).length === 0) {
    debugLog("No usernames in cache, adding test entry");
    // Add the user's actual Twitch username
    cachedUserMap['yomata1'] = {
      tier: 'DIAMOND',
      division: 'IV',
      leaguePoints: 75,
      summonerName: 'TestSummoner'
    };
    
    // Check if the current message is from the test user
    if (username === 'yomata1') {
      debugLog(`Matched test username: ${username}`);
      addBadgeToMessage(usernameElement, cachedUserMap[username]);
      return;
    }
  }
  
  // If we don't have the rank data, fetch it from the background script
  debugLog(`Fetching rank for ${username}`);
  chrome.runtime.sendMessage(
    { 
      action: 'fetch_rank_for_username',
      username: username,
      channel: channelName
    },
    response => {
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
}

function addBadgeToMessage(usernameElement, rankData) {
  // Skip if no rank data
  if (!rankData || !rankData.tier) {
    debugLog("No valid rank data provided for badge");
    return;
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
  console.log("Starting direct badge insertion test");
  
  // Target username - your Twitch username
  const targetUsername = "yomata1";
  
  // Try to find messages in the chat
  const usernameElements = document.querySelectorAll('.chat-author__display-name, [data-a-target="chat-message-username"]');
  console.log(`Found ${usernameElements.length} username elements in chat`);
  
  let badgesAdded = 0;
  usernameElements.forEach(usernameEl => {
    // Check if this username matches our target
    const username = usernameEl.textContent.trim().toLowerCase();
    
    if (username === targetUsername) {
      console.log(`Found message from target user: ${username}`);
      
      // Create a badge
      const badge = document.createElement('img');
      badge.className = 'chat-badge';
      badge.alt = "DIAMOND";
      
      // Try to use chrome.runtime.getURL with error handling
      try {
        const imageURL = chrome.runtime.getURL("images/ranks/diamond18.png");
        console.log("Image URL generated:", imageURL);
        badge.src = imageURL;
      } catch (error) {
        console.error("Error accessing chrome.runtime.getURL:", error);
        // Fallback to a direct URL for testing
        badge.src = "https://raw.githubusercontent.com/lol-tracker/rank-images/main/diamond.png";
      }
      
      badge.width = 18;
      badge.height = 18;
      badge.style.marginRight = '4px';
      
      // Get the parent container that holds the username
      const usernameContainer = usernameEl.closest('.chat-line__username-container');
      
      if (usernameContainer) {
        console.log("Found username container, inserting badge");
        usernameContainer.insertBefore(badge, usernameContainer.firstChild);
        badgesAdded++;
      } else {
        console.log("No username container found, trying parent node");
        usernameEl.parentNode.insertBefore(badge, usernameEl);
        badgesAdded++;
      }
    }
  });
  
  console.log(`Direct test complete. Added ${badgesAdded} badges.`);
}

// Function to inject a visible indicator on the page
function injectVisibleDebugIndicator() {
  console.log("Injecting visible debug indicator");
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
    console.log("Debug indicator added to page");
  } else {
    // Body not available yet, wait for it
    console.log("Body not available, setting up MutationObserver");
    const observer = new MutationObserver(function(mutations) {
      if (document.body) {
        document.body.appendChild(indicator);
        console.log("Debug indicator added to page (delayed)");
        observer.disconnect();
      }
    });
    
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }
} 