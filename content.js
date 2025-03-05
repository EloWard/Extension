// EloWard Content Script
// This script runs on Twitch pages and adds rank badges to chat messages

// Global state
let isChannelSubscribed = false;
let channelName = '';
let processedMessages = new Set();
let observerInitialized = false;
let cachedUserMap = {}; // Cache for mapping Twitch usernames to Riot IDs

// Initialize when the page is loaded
initializeExtension();

function initializeExtension() {
  // Extract channel name from URL
  channelName = window.location.pathname.split('/')[1];
  if (!channelName) return;
  
  console.log(`EloWard: Initializing on channel ${channelName}`);
  
  // Check if this streamer has a subscription
  chrome.runtime.sendMessage(
    { action: 'check_streamer_subscription', streamer: channelName },
    (response) => {
      if (response && response.subscribed) {
        isChannelSubscribed = true;
        console.log(`EloWard: Channel ${channelName} is subscribed`);
        
        // Initialize the observer for chat messages
        initializeObserver();
        
        // Show a subtle notification that EloWard is active
        showActivationNotification();
      } else {
        console.log(`EloWard: Channel ${channelName} is not subscribed`);
      }
    }
  );
  
  // Listen for URL changes (when user navigates to a different channel)
  let lastUrl = window.location.href;
  new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      // Reset state
      isChannelSubscribed = false;
      channelName = window.location.pathname.split('/')[1];
      processedMessages.clear();
      
      // Remove any existing notification
      removeActivationNotification();
      
      // Re-initialize for the new channel
      if (channelName) {
        console.log(`EloWard: Channel changed to ${channelName}`);
        chrome.runtime.sendMessage(
          { action: 'check_streamer_subscription', streamer: channelName },
          (response) => {
            if (response && response.subscribed) {
              isChannelSubscribed = true;
              console.log(`EloWard: Channel ${channelName} is subscribed`);
              
              // Initialize the observer for chat messages
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

// Initialize the observer for chat messages
function initializeObserver() {
  if (observerInitialized) return;
  
  // Find the chat container
  function findChatContainer() {
    // Twitch chat container selectors (may need updates if Twitch changes their DOM)
    const selectors = [
      '.chat-scrollable-area__message-container',
      '.chat-list--default',
      '.chat-list__list',
      '[data-test-selector="chat-scrollable-area__message-container"]'
    ];
    
    for (const selector of selectors) {
      const container = document.querySelector(selector);
      if (container) return container;
    }
    
    return null;
  }
  
  // Try to find the chat container
  let chatContainer = findChatContainer();
  
  if (chatContainer) {
    // Chat container found, set up the observer
    setupChatObserver(chatContainer);
    observerInitialized = true;
  } else {
    // Chat container not found yet, retry after a delay
    setTimeout(() => {
      chatContainer = findChatContainer();
      if (chatContainer) {
        setupChatObserver(chatContainer);
        observerInitialized = true;
      }
    }, 2000);
  }
}

// Set up the observer for chat messages
function setupChatObserver(chatContainer) {
  console.log('EloWard: Setting up chat observer');
  
  // Process existing messages
  const existingMessages = chatContainer.querySelectorAll('.chat-line__message');
  existingMessages.forEach(processNewMessage);
  
  // Create an observer for new messages
  const chatObserver = new MutationObserver((mutations) => {
    if (!isChannelSubscribed) return;
    
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        // Check if the node is a chat message
        if (node.classList && node.classList.contains('chat-line__message')) {
          processNewMessage(node);
        }
      });
    });
  });
  
  // Start observing the chat container
  chatObserver.observe(chatContainer, {
    childList: true,
    subtree: false
  });
}

// Process a new chat message
function processNewMessage(messageNode) {
  if (!isChannelSubscribed) return;
  
  // Check if we've already processed this message
  if (processedMessages.has(messageNode)) return;
  
  // Mark as processed
  processedMessages.add(messageNode);
  
  // Find the username element
  const usernameElement = messageNode.querySelector('.chat-author__display-name');
  if (!usernameElement) return;
  
  // Get the username
  const username = usernameElement.textContent.trim();
  
  // Get the platform (region) - for MVP we'll use NA1 as default
  // In a real implementation, we would try to match Twitch usernames to Riot IDs
  const platform = 'na1';
  
  // Request rank data from background script
  chrome.runtime.sendMessage(
    { action: 'get_rank_for_user', username, platform },
    (response) => {
      if (response && response.rank) {
        addBadgeToMessage(usernameElement, response.rank);
      }
    }
  );
}

// Add a rank badge to a chat message
function addBadgeToMessage(usernameElement, rankData) {
  if (!rankData || !rankData.tier) return;
  
  // Check if badge already exists
  if (usernameElement.parentNode.querySelector('.eloward-badge')) return;
  
  // Create badge element
  const badge = document.createElement('div');
  badge.className = 'eloward-badge';
  badge.title = formatRankText(rankData);
  
  // Set badge background image
  badge.style.backgroundImage = `url(${chrome.runtime.getURL(`images/ranks/${rankData.tier.toLowerCase()}.png`)}`;
  
  // Insert badge after username
  usernameElement.parentNode.insertBefore(badge, usernameElement.nextSibling);
  
  // Add a small space after username
  usernameElement.style.marginRight = '4px';
}

// Format rank text for tooltip
function formatRankText(rankData) {
  if (!rankData) return 'Unranked';
  
  let rankText = rankData.tier;
  
  if (rankData.division && 
      rankData.tier !== 'Master' && 
      rankData.tier !== 'Grandmaster' && 
      rankData.tier !== 'Challenger') {
    rankText += ' ' + rankData.division;
  }
  
  if (rankData.leaguePoints !== undefined) {
    rankText += ` (${rankData.leaguePoints} LP)`;
  }
  
  return rankText;
}

// Show a subtle notification that EloWard is active
function showActivationNotification() {
  // Check if notification already exists
  if (document.getElementById('eloward-notification')) return;
  
  // Create notification element
  const notification = document.createElement('div');
  notification.id = 'eloward-notification';
  notification.className = 'eloward-notification';
  
  // Create logo element
  const logo = document.createElement('div');
  logo.className = 'eloward-notification-logo';
  logo.style.backgroundImage = `url(${chrome.runtime.getURL('images/logo/icon48.png')})`;
  
  // Create text element
  const text = document.createElement('div');
  text.className = 'eloward-notification-text';
  text.innerHTML = `
    <span class="eloward-notification-title">EloWard Active</span>
    <span class="eloward-notification-subtitle">This streamer has enabled League rank badges in chat</span>
  `;
  
  // Create close button
  const closeButton = document.createElement('div');
  closeButton.className = 'eloward-notification-close';
  closeButton.innerHTML = '×';
  closeButton.addEventListener('click', () => {
    notification.classList.add('eloward-notification-hiding');
    setTimeout(() => {
      notification.remove();
    }, 300);
  });
  
  // Add elements to notification
  notification.appendChild(logo);
  notification.appendChild(text);
  notification.appendChild(closeButton);
  
  // Add notification to page
  document.body.appendChild(notification);
  
  // Add styles
  const style = document.createElement('style');
  style.textContent = `
    .eloward-badge {
      display: inline-block;
      width: 16px;
      height: 16px;
      background-size: contain;
      background-repeat: no-repeat;
      background-position: center;
      vertical-align: middle;
      margin-left: 4px;
    }
    
    .eloward-notification {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: rgba(28, 30, 48, 0.95);
      border: 1px solid rgba(217, 163, 54, 0.3);
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      padding: 12px 16px;
      display: flex;
      align-items: center;
      z-index: 9999;
      max-width: 300px;
      animation: eloward-notification-enter 0.3s ease-out;
    }
    
    .eloward-notification-hiding {
      animation: eloward-notification-exit 0.3s ease-in forwards;
    }
    
    @keyframes eloward-notification-enter {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    
    @keyframes eloward-notification-exit {
      from { transform: translateY(0); opacity: 1; }
      to { transform: translateY(20px); opacity: 0; }
    }
    
    .eloward-notification-logo {
      width: 32px;
      height: 32px;
      background-size: contain;
      background-repeat: no-repeat;
      background-position: center;
      margin-right: 12px;
    }
    
    .eloward-notification-text {
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    
    .eloward-notification-title {
      font-weight: 600;
      font-size: 14px;
      color: #D9A336;
      margin-bottom: 2px;
    }
    
    .eloward-notification-subtitle {
      font-size: 12px;
      color: #A09B8C;
    }
    
    .eloward-notification-close {
      font-size: 20px;
      color: #A09B8C;
      cursor: pointer;
      margin-left: 12px;
      line-height: 1;
    }
    
    .eloward-notification-close:hover {
      color: #D9A336;
    }
  `;
  
  document.head.appendChild(style);
  
  // Auto-hide notification after 8 seconds
  setTimeout(() => {
    if (document.getElementById('eloward-notification')) {
      notification.classList.add('eloward-notification-hiding');
      setTimeout(() => {
        if (notification.parentNode) {
          notification.remove();
        }
      }, 300);
    }
  }, 8000);
}

// Remove the activation notification
function removeActivationNotification() {
  const notification = document.getElementById('eloward-notification');
  if (notification) {
    notification.remove();
  }
} 