// EloWard Content Script
// This script runs on Twitch pages and adds rank badges to chat messages

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

// Add keyboard shortcut for debug overlay (Ctrl+Shift+E)
document.addEventListener('keydown', function(event) {
  // Removed debug shortcut functionality
});

function initializeExtension() {
  // Extract channel name from URL
  channelName = window.location.pathname.split('/')[1];
  if (!channelName) {
    return;
  }
  
  // Pre-check if extension CSS has been added
  if (!document.querySelector('#eloward-extension-styles')) {
    addExtensionStyles();
  }
  
  // Check if this streamer has a subscription
  chrome.runtime.sendMessage(
    { action: 'check_streamer_subscription', streamer: channelName },
    (response) => {
      if (response && response.subscribed) {
        isChannelSubscribed = true;
        
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
        isChannelSubscribed = false;
      }
    }
  );
  
  // Listen for URL changes (when user navigates to a different channel)
  if (!window.elowardUrlChangeObserver) {
    window.elowardUrlChangeObserver = true;
    let lastUrl = window.location.href;
    
    new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
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
          chrome.runtime.sendMessage(
            { action: 'check_streamer_subscription', streamer: channelName },
            (response) => {
              if (response && response.subscribed) {
                isChannelSubscribed = true;
                
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
  if (observerInitialized) {
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
      '.chat-shell'
    ];
    
    for (const selector of chatContainerSelectors) {
      const container = document.querySelector(selector);
      if (container) {
        return container;
      }
    }
    
    // If all selectors fail, try a more general approach:
    // Look for elements that might contain chat messages
    const potentialContainers = document.querySelectorAll('[class*="chat"], [class*="message"]');
    for (const container of potentialContainers) {
      // Check if this element contains chat messages (has children with usernames)
      if (container.querySelectorAll('.chat-author__display-name, [data-a-target="chat-message-username"]').length > 0) {
        return container;
      }
    }
    
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
      setupChatObserver(chatArea, true);
    }
  } else {
    // Chat container not found yet, wait and try again
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
        // Last resort: observe the whole right column where chat usually is
        const rightColumn = document.querySelector('.right-column, [data-test-selector="right-column"]');
        if (rightColumn) {
          setupChatObserver(rightColumn, true);
          observerInitialized = true;
        }
      }
    }, 2000);
  }
}

function setupChatObserver(chatContainer, isFallbackObserver = false) {
  // Create a MutationObserver to watch for new chat messages
  const chatObserver = new MutationObserver((mutations) => {
    if (!isChannelSubscribed) return;
    
    let newMessagesProcessed = 0;
    
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
    
  for (const message of existingMessages) {
    processNewMessage(message);
  }
}

function processNewMessage(messageNode) {
  // Skip if we've already processed this message
  if (processedMessages.has(messageNode) || processedMessages.size > 1000) {
    // If we have too many processed messages, clear the set to prevent memory issues
    if (processedMessages.size > 1000) {
      processedMessages.clear();
    }
    return;
  }
  
  // Mark this message as processed
  processedMessages.add(messageNode);
  
  // Find the username element in the message
  const usernameElement = messageNode.querySelector('.chat-author__display-name, [data-a-target="chat-message-username"]');
  if (!usernameElement) {
    return;
  }
  
  // Always use lowercase for username lookups to handle display name case sensitivity
  const username = usernameElement.textContent.trim().toLowerCase();
  
  // Check if this user has a cached rank
  if (cachedUserMap[username]) {
    addBadgeToMessage(usernameElement, cachedUserMap[username]);
    return;
  }
  
  // If we don't have the rank data, fetch it from the background script
  chrome.runtime.sendMessage(
    { 
      action: 'fetch_rank_for_username',
      username: username,
      channel: channelName
    },
    response => {
      if (response && response.success && response.rankData) {
        // Cache the response
        cachedUserMap[username] = response.rankData;
        
        // Add the badge to the message
        addBadgeToMessage(usernameElement, response.rankData);
      }
    }
  );
}

function addBadgeToMessage(usernameElement, rankData) {
  // Skip if no rank data
  if (!rankData || !rankData.tier) {
    return;
  }
  
  // Check if badge already exists to avoid duplicates
  const messageContainer = findMessageContainer(usernameElement);
  if (!messageContainer) {
    return;
  }
  
  // Check if this username already has a badge in this message
  const existingBadge = messageContainer.querySelector('.eloward-rank-badge');
  if (existingBadge) {
    return;
  }
  
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
  rankImg.width = 18;
  rankImg.height = 18;
  
  // Set image source based on rank tier
  const tier = rankData.tier.toLowerCase();
  rankImg.src = chrome.runtime.getURL(`images/ranks/${tier}18.png`);
  
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
  
  // Insert the badge after the username element
  // Default to 'before-username' if config is not available
  const position = 'before-username';
  
  if (position === 'before-username') {
    // Insert before username
    usernameElement.parentNode.insertBefore(badgeContainer, usernameElement);
  } else {
    // Insert after username (default)
    if (usernameElement.nextSibling) {
      usernameElement.parentNode.insertBefore(badgeContainer, usernameElement.nextSibling);
    } else {
      usernameElement.parentNode.appendChild(badgeContainer);
    }
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