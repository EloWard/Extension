// EloWard Content Script
// This script runs on Twitch pages and adds rank badges to chat messages
import { EloWardConfig } from './js/config.js';

// Global state
let isChannelSubscribed = false;
let channelName = '';
let processedMessages = new Set();
let observerInitialized = false;
let cachedUserMap = {}; // Cache for mapping Twitch usernames to Riot IDs
let tooltipElement = null; // Global tooltip element

// Initialize when the page is loaded
initializeExtension();
// Also set a delayed initialization to catch slow-loading pages
setTimeout(initializeExtension, 3000);

function initializeExtension() {
  console.log('EloWard: Starting initialization');
  
  // Extract channel name from URL
  channelName = window.location.pathname.split('/')[1];
  if (!channelName) {
    console.log('EloWard: No channel name found in URL');
    return;
  }
  
  console.log(`EloWard: Initializing on channel ${channelName}`);
  
  // Pre-check if extension CSS has been added
  if (!document.querySelector('#eloward-extension-styles')) {
    addExtensionStyles();
  }
  
  // Check if this streamer has a subscription
  chrome.runtime.sendMessage(
    { action: 'check_streamer_subscription', streamer: channelName },
    (response) => {
      console.log(`EloWard: Streamer subscription check response:`, response);
      
      if (response && response.subscribed) {
        isChannelSubscribed = true;
        console.log(`EloWard: Channel ${channelName} is subscribed`);
        
        // Inject the style needed for badges if it doesn't exist
        if (!document.querySelector('#eloward-extension-styles')) {
          addExtensionStyles();
        }
        
        // Initialize the observer for chat messages
        initializeObserver();
        
        // Show a subtle notification that EloWard is active
        showActivationNotification();
        
        // Force refresh linked accounts from the background script
        chrome.runtime.sendMessage({ action: 'refresh_linked_accounts' });
      } else {
        console.log(`EloWard: Channel ${channelName} is not subscribed`);
      }
    }
  );
  
  // Listen for URL changes (when user navigates to a different channel)
  if (!window.elowardUrlChangeObserver) {
    window.elowardUrlChangeObserver = true;
    let lastUrl = window.location.href;
    
    console.log('EloWard: Setting up URL change observer');
    new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        console.log(`EloWard: URL changed from ${lastUrl} to ${window.location.href}`);
        lastUrl = window.location.href;
        
        // Reset state
        isChannelSubscribed = false;
        channelName = window.location.pathname.split('/')[1];
        processedMessages.clear();
        cachedUserMap = {}; // Clear the cache when changing channels
        
        // Remove any existing notification
        removeActivationNotification();
        
        // Check if the new channel is subscribed
        if (channelName) {
          console.log(`EloWard: Checking if new channel ${channelName} is subscribed`);
          chrome.runtime.sendMessage(
            { action: 'check_streamer_subscription', streamer: channelName },
            (response) => {
              if (response && response.subscribed) {
                isChannelSubscribed = true;
                console.log(`EloWard: Channel ${channelName} is subscribed`);
                
                // Force refresh of linked accounts
                chrome.runtime.sendMessage({ action: 'refresh_linked_accounts' });
                
                // Re-initialize the observer for chat messages
                observerInitialized = false; // Reset the observer flag
                initializeObserver();
                
                // Show a subtle notification that EloWard is active
                showActivationNotification();
              }
            }
          );
        }
      }
    }).observe(document, { subtree: true, childList: true });
  }
}

function initializeObserver() {
  if (observerInitialized) return;
  
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
      '.chat-shell'
    ];
    
    for (const selector of chatContainerSelectors) {
      const container = document.querySelector(selector);
      if (container) {
        console.log(`EloWard: Found chat container with selector: ${selector}`);
        return container;
      }
    }
    
    // If all selectors fail, try a more general approach:
    // Look for elements that might contain chat messages
    const potentialContainers = document.querySelectorAll('[class*="chat"], [class*="message"]');
    for (const container of potentialContainers) {
      // Check if this element contains chat messages (has children with usernames)
      if (container.querySelectorAll('.chat-author__display-name, [data-a-target="chat-message-username"]').length > 0) {
        console.log('EloWard: Found chat container using fallback method');
        return container;
      }
    }
    
    console.log('EloWard: Could not find chat container with any selector');
    return null;
  }
  
  // Try to find the chat container
  let chatContainer = findChatContainer();
  
  if (chatContainer) {
    // Chat container found, set up the observer
    setupChatObserver(chatContainer);
    observerInitialized = true;
    
    // Also set up a fallback observer for the whole chat area in case messages appear in a different container
    const chatArea = document.querySelector('.chat-room, .right-column, [data-test-selector="chat-room"]');
    if (chatArea && chatArea !== chatContainer) {
      console.log('EloWard: Setting up fallback observer for entire chat area');
      setupChatObserver(chatArea, true);
    }
  } else {
    // Chat container not found yet, wait and try again
    console.log('EloWard: Chat container not found, waiting...');
    setTimeout(() => {
      chatContainer = findChatContainer();
      if (chatContainer) {
        setupChatObserver(chatContainer);
        observerInitialized = true;
        
        // Also set up a fallback observer
        const chatArea = document.querySelector('.chat-room, .right-column, [data-test-selector="chat-room"]');
        if (chatArea && chatArea !== chatContainer) {
          setupChatObserver(chatArea, true);
        }
      } else {
        console.log('EloWard: Chat container still not found after delay');
        
        // Last resort: observe the whole right column where chat usually is
        const rightColumn = document.querySelector('.right-column, [data-test-selector="right-column"]');
        if (rightColumn) {
          console.log('EloWard: Setting up observer on right column as last resort');
          setupChatObserver(rightColumn, true);
          observerInitialized = true;
        }
      }
    }, 2000);
  }
}

function setupChatObserver(chatContainer, isFallbackObserver = false) {
  console.log(`EloWard: Setting up chat observer for container:`, chatContainer);
  
  // Create a MutationObserver to watch for new chat messages
  const chatObserver = new MutationObserver((mutations) => {
    if (!isChannelSubscribed) return;
    
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if this is a chat message or might contain chat messages
            if (node.classList && (
                node.classList.contains('chat-line__message') || 
                node.classList.contains('chat-line') ||
                node.querySelector('.chat-author__display-name, [data-a-target="chat-message-username"]')
              )) {
              // This is a chat message
              processNewMessage(node);
            } else if (isFallbackObserver) {
              // For fallback observers, look deeper for chat messages
              const messages = node.querySelectorAll('[data-a-target="chat-line-message"], .chat-line__message, .chat-line');
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
    subtree: isFallbackObserver // Use subtree for fallback observers to catch messages deeper in the DOM
  });
  
  // Also process any existing messages
  const existingMessages = isFallbackObserver ? 
    chatContainer.querySelectorAll('[data-a-target="chat-line-message"], .chat-line__message, .chat-line') : 
    chatContainer.children;
    
  console.log(`EloWard: Processing ${existingMessages.length} existing messages`);
  for (const message of existingMessages) {
    processNewMessage(message);
  }
}

function processNewMessage(messageNode) {
  // Skip if we've already processed this message
  if (processedMessages.has(messageNode.id) || processedMessages.size > 1000) {
    // If we have too many processed messages, clear the set to prevent memory issues
    if (processedMessages.size > 1000) {
      processedMessages.clear();
    }
    return;
  }
  
  // Mark this message as processed
  if (messageNode.id) {
    processedMessages.add(messageNode.id);
  }
  
  // Find the username element in the message
  const usernameElement = messageNode.querySelector('.chat-author__display-name');
  if (!usernameElement) {
    // Try alternative Twitch selectors if the primary one fails
    const alternativeSelectors = [
      '[data-a-target="chat-message-username"]',
      '.chat-line__username',
      '.chat-author__display-name'
    ];
    
    for (const selector of alternativeSelectors) {
      const altElement = messageNode.querySelector(selector);
      if (altElement) {
        console.log(`EloWard: Found username using alternative selector: ${selector}`);
        usernameElement = altElement;
        break;
      }
    }
    
    // If still not found, skip this message
    if (!usernameElement) {
      console.log('EloWard: Could not find username element for message:', messageNode);
      return;
    }
  }
  
  // Get the Twitch username
  const twitchUsername = usernameElement.textContent.trim();
  console.log(`EloWard: Processing message from ${twitchUsername}`);
  
  // Check if we already have rank data for this user in the cache
  if (cachedUserMap.hasOwnProperty(twitchUsername.toLowerCase())) {
    console.log(`EloWard: Found cached rank data for ${twitchUsername}`);
    // Only display badge if valid rank data exists (not null or undefined)
    if (cachedUserMap[twitchUsername.toLowerCase()] !== null) {
      addBadgeToMessage(usernameElement, cachedUserMap[twitchUsername.toLowerCase()]);
    } else {
      console.log(`EloWard: Cached rank data is null for ${twitchUsername}`);
    }
    return;
  }
  
  // Get the user's selected region from storage
  chrome.storage.local.get(['selectedRegion', 'linkedAccounts'], (data) => {
    const selectedRegion = data.selectedRegion || 'na1';
    const platformRegion = EloWardConfig.riot.platformRouting[selectedRegion].region;
    
    // Log linked accounts for debugging
    console.log('EloWard: Available linked accounts:', data.linkedAccounts || {});
    
    // Request rank data for the Twitch username from the background script
    chrome.runtime.sendMessage({
      action: 'get_rank_for_twitch_user',
      twitchUsername: twitchUsername,
      platform: platformRegion
    }, (response) => {
      console.log(`EloWard: Rank response for ${twitchUsername}:`, response);
      
      if (response && response.rank) {
        // Cache the rank data (including null values to avoid repeated lookups)
        cachedUserMap[twitchUsername.toLowerCase()] = response.rank;
        
        // Only add the badge if valid rank data exists
        if (response.rank !== null) {
          addBadgeToMessage(usernameElement, response.rank);
        }
      } else {
        // If no response or no rank data, cache as null to avoid repeated lookups
        cachedUserMap[twitchUsername.toLowerCase()] = null;
        console.log(`EloWard: No rank data found for ${twitchUsername}`);
      }
    });
  });
}

function addBadgeToMessage(usernameElement, rankData) {
  // Check if badge already exists to avoid duplicates
  const messageContainer = findMessageContainer(usernameElement);
  if (!messageContainer) {
    console.log('EloWard: Could not find message container for adding badge');
    return;
  }
  
  if (messageContainer.querySelector('.eloward-rank-badge')) {
    console.log('EloWard: Badge already exists for this message');
    return;
  }
  
  // Create the badge element
  const badgeElement = document.createElement('div');
  badgeElement.className = 'eloward-rank-badge';
  
  // Set the background image to the rank icon
  const rankTier = rankData ? rankData.tier.toLowerCase() : 'unranked';
  const badgeUrl = chrome.runtime.getURL(`images/ranks/${rankTier}.png`);
  badgeElement.style.backgroundImage = `url(${badgeUrl})`;
  console.log(`EloWard: Creating badge with tier ${rankTier} and URL ${badgeUrl}`);
  
  // Add tooltip with rank information
  const tooltipText = formatRankText(rankData);
  badgeElement.setAttribute('data-tooltip', tooltipText);
  
  // Add inline styles to ensure badge is visible
  badgeElement.style.display = 'inline-block';
  badgeElement.style.width = '18px';
  badgeElement.style.height = '18px';
  badgeElement.style.backgroundSize = 'cover';
  badgeElement.style.backgroundRepeat = 'no-repeat';
  badgeElement.style.verticalAlign = 'middle';
  badgeElement.style.marginLeft = '4px';
  badgeElement.style.position = 'relative';
  
  // Try different insertion strategies to find the most reliable one
  let inserted = false;
  
  // Strategy 1: Insert after the username element
  try {
    if (usernameElement.nextSibling) {
      usernameElement.parentNode.insertBefore(badgeElement, usernameElement.nextSibling);
      inserted = true;
      console.log('EloWard: Badge inserted using strategy 1 (after username)');
    }
  } catch (e) {
    console.error('EloWard: Error with insertion strategy 1:', e);
  }
  
  // Strategy 2: Insert into badge container if it exists
  if (!inserted) {
    try {
      const badgeContainer = messageContainer.querySelector('.chat-line__message--badges, .chat-line__username-container');
      if (badgeContainer) {
        badgeContainer.appendChild(badgeElement);
        inserted = true;
        console.log('EloWard: Badge inserted using strategy 2 (badge container)');
      }
    } catch (e) {
      console.error('EloWard: Error with insertion strategy 2:', e);
    }
  }
  
  // Strategy 3: Insert as a sibling to the username container
  if (!inserted) {
    try {
      const usernameContainer = usernameElement.closest('.chat-line__username-container, .chat-author');
      if (usernameContainer && usernameContainer.parentNode) {
        usernameContainer.parentNode.insertBefore(badgeElement, usernameContainer.nextSibling);
        inserted = true;
        console.log('EloWard: Badge inserted using strategy 3 (next to username container)');
      }
    } catch (e) {
      console.error('EloWard: Error with insertion strategy 3:', e);
    }
  }
  
  // Strategy 4: Last resort - append to the message container
  if (!inserted) {
    try {
      messageContainer.appendChild(badgeElement);
      inserted = true;
      console.log('EloWard: Badge inserted using strategy 4 (appended to message)');
    } catch (e) {
      console.error('EloWard: Error with insertion strategy 4:', e);
    }
  }
  
  if (inserted) {
    // Add event listeners for tooltip
    badgeElement.addEventListener('mouseenter', showTooltip);
    badgeElement.addEventListener('mouseleave', hideTooltip);
    console.log(`EloWard: Successfully added ${rankTier} badge for user with tooltip: ${tooltipText}`);
  } else {
    console.error('EloWard: Could not insert badge with any strategy');
  }
}

// Helper function to find the message container from a username element
function findMessageContainer(usernameElement) {
  // Try various common parent selectors to find the message container
  const messageSelectors = [
    '.chat-line__message',
    '.chat-line',
    '[data-a-target="chat-line-message"]',
    '.message-container',
    '.chat-message'
  ];
  
  // First try to find a parent with one of the known message container classes
  for (const selector of messageSelectors) {
    const container = usernameElement.closest(selector);
    if (container) {
      return container;
    }
  }
  
  // If that fails, go up 3 levels from the username element as a fallback
  let current = usernameElement;
  for (let i = 0; i < 3; i++) {
    if (current.parentElement) {
      current = current.parentElement;
    } else {
      break;
    }
  }
  
  return current;
}

function formatRankText(rankData) {
  if (!rankData) return 'Unranked';
  
  let rankText = rankData.tier;
  if (rankData.division && rankData.tier !== 'Master' && 
      rankData.tier !== 'Grandmaster' && rankData.tier !== 'Challenger') {
    rankText += ' ' + rankData.division;
  }
  
  if (rankData.leaguePoints !== undefined) {
    rankText += ` (${rankData.leaguePoints} LP)`;
  }
  
  if (rankData.wins !== undefined && rankData.losses !== undefined) {
    const winRate = Math.round((rankData.wins / (rankData.wins + rankData.losses)) * 100);
    rankText += ` | ${rankData.wins}W ${rankData.losses}L (${winRate}%)`;
  }
  
  return rankText;
}

function showActivationNotification() {
  // Check if notification already exists
  if (document.querySelector('.eloward-notification')) return;
  
  // Create notification element
  const notification = document.createElement('div');
  notification.className = 'eloward-notification';
  
  // Create logo element
  const logo = document.createElement('img');
  logo.src = chrome.runtime.getURL('images/logo/icon48.png');
  logo.alt = 'EloWard';
  logo.className = 'eloward-notification-logo';
  
  // Create text element
  const text = document.createElement('span');
  text.textContent = 'EloWard Active';
  text.className = 'eloward-notification-text';
  
  // Add elements to notification
  notification.appendChild(logo);
  notification.appendChild(text);
  
  // Add notification to the page
  document.body.appendChild(notification);
  
  // Show the notification
  setTimeout(() => {
    notification.classList.add('visible');
    
    // Hide the notification after 5 seconds
    setTimeout(() => {
      notification.classList.remove('visible');
      
      // Remove the notification after the fade-out animation
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 500);
    }, 5000);
  }, 100);
}

function removeActivationNotification() {
  const notification = document.querySelector('.eloward-notification');
  if (notification) {
    notification.classList.remove('visible');
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 500);
  }
}

// Tooltip functions
function showTooltip(event) {
  const tooltip = document.createElement('div');
  tooltip.className = 'eloward-tooltip';
  tooltip.textContent = event.target.getAttribute('data-tooltip');
  
  // Position the tooltip
  const rect = event.target.getBoundingClientRect();
  tooltip.style.left = `${rect.left + rect.width / 2}px`;
  tooltip.style.top = `${rect.bottom + 5}px`;
  
  // Add the tooltip to the page
  document.body.appendChild(tooltip);
  
  // Store the tooltip element on the badge
  event.target.tooltip = tooltip;
  
  // Show the tooltip
  setTimeout(() => {
    tooltip.classList.add('visible');
  }, 10);
}

function hideTooltip(event) {
  const tooltip = event.target.tooltip;
  if (tooltip) {
    tooltip.classList.remove('visible');
    setTimeout(() => {
      if (tooltip.parentNode) {
        tooltip.parentNode.removeChild(tooltip);
      }
    }, 200);
  }
}

// Add the CSS needed for badges
function addExtensionStyles() {
  console.log('EloWard: Adding extension styles');
  
  const styleElement = document.createElement('style');
  styleElement.id = 'eloward-extension-styles';
  styleElement.textContent = `
    .eloward-rank-badge {
      display: inline-block;
      width: 18px;
      height: 18px;
      margin-left: 4px;
      vertical-align: middle;
      background-size: cover;
      background-repeat: no-repeat;
      position: relative;
      z-index: 1000;
    }
    
    .eloward-tooltip {
      position: fixed;
      z-index: 99999;
      background-color: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 5px 10px;
      border-radius: 3px;
      font-size: 12px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s;
      transform: translateX(-50%);
      white-space: nowrap;
    }
    
    .eloward-tooltip.visible {
      opacity: 1;
    }
    
    .eloward-notification {
      position: fixed;
      top: 60px;
      right: 20px;
      background-color: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 10px 15px;
      border-radius: 5px;
      display: flex;
      align-items: center;
      z-index: 99999;
      opacity: 0;
      transform: translateY(-10px);
      transition: opacity 0.3s, transform 0.3s;
    }
    
    .eloward-notification.visible {
      opacity: 1;
      transform: translateY(0);
    }
    
    .eloward-notification-logo {
      width: 20px;
      height: 20px;
      margin-right: 8px;
    }
    
    .eloward-notification-text {
      font-size: 14px;
      font-weight: bold;
    }
  `;
  
  document.head.appendChild(styleElement);
} 