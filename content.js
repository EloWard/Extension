// EloWard Content Script
// This script runs on Twitch pages and adds rank badges to chat messages

// Global state
let isChannelActive = false;
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
  
  // Check if this is an activated channel
  chrome.runtime.sendMessage(
    { action: 'check_channel_active', channelName },
    (response) => {
      if (response && response.isActive) {
        isChannelActive = true;
        console.log(`EloWard: Channel ${channelName} is active`);
        
        // Initialize the observer for chat messages
        initializeObserver();
        
        // Show a subtle notification that EloWard is active
        showActivationNotification();
      } else {
        console.log(`EloWard: Channel ${channelName} is not active`);
      }
    }
  );
  
  // Listen for URL changes (when user navigates to a different channel)
  let lastUrl = window.location.href;
  new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      // Reset state
      isChannelActive = false;
      channelName = window.location.pathname.split('/')[1];
      processedMessages.clear();
      
      // Remove any existing notification
      removeActivationNotification();
      
      // Check if new channel is active
      if (channelName) {
        chrome.runtime.sendMessage(
          { action: 'check_channel_active', channelName },
          (response) => {
            if (response && response.isActive) {
              isChannelActive = true;
              console.log(`EloWard: Channel ${channelName} is active`);
              
              // Initialize the observer for chat messages
              initializeObserver();
              
              // Show activation notification
              showActivationNotification();
            } else {
              console.log(`EloWard: Channel ${channelName} is not active`);
            }
          }
        );
      }
    }
  }).observe(document, { subtree: true, childList: true });
}

function initializeObserver() {
  if (observerInitialized) return;
  
  // Find the chat container
  function findChatContainer() {
    return document.querySelector('[data-test-selector="chat-scrollable-area__message-container"]');
  }
  
  // Try to find the chat container
  let chatContainer = findChatContainer();
  
  // If not found, wait and retry
  if (!chatContainer) {
    console.log('EloWard: Chat container not found, waiting...');
    const checkInterval = setInterval(() => {
      chatContainer = findChatContainer();
      if (chatContainer) {
        clearInterval(checkInterval);
        setupChatObserver(chatContainer);
      }
    }, 1000);
  } else {
    setupChatObserver(chatContainer);
  }
  
  observerInitialized = true;
}

function setupChatObserver(chatContainer) {
  console.log('EloWard: Setting up chat observer');
  
  // Create a mutation observer to watch for new chat messages
  const observer = new MutationObserver((mutations) => {
    if (!isChannelActive) return;
    
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            processNewMessage(node);
          }
        }
      }
    }
  });
  
  // Start observing the chat container
  observer.observe(chatContainer, {
    childList: true,
    subtree: false
  });
  
  // Process existing messages as well
  const existingMessages = chatContainer.querySelectorAll('[data-a-target="chat-line-message"]');
  existingMessages.forEach(processNewMessage);
}

function processNewMessage(messageNode) {
  if (!isChannelActive) return;
  
  // Get a unique ID for this message
  const messageId = messageNode.getAttribute('id');
  if (!messageId || processedMessages.has(messageId)) return;
  
  // Mark this message as processed
  processedMessages.add(messageId);
  
  // Find username element
  const usernameElement = messageNode.querySelector('[data-a-target="chat-message-username"]');
  if (!usernameElement) return;
  
  // Get Twitch username
  const twitchUsername = usernameElement.textContent.trim();
  
  // In a production extension, we would use a backend service to map
  // Twitch usernames to Riot IDs (gameName#tagLine) and then query Riot API
  // For the MVP, we'll use the mock function
  
  // Get rank data for this user
  chrome.runtime.sendMessage(
    { action: 'get_user_rank', username: twitchUsername },
    (response) => {
      if (response && response.rank) {
        addBadgeToMessage(usernameElement, response.rank);
      }
    }
  );
}

function addBadgeToMessage(usernameElement, rankData) {
  // Create badge element
  const badgeElement = document.createElement('span');
  
  // Set classes for styling
  if (!rankData) {
    badgeElement.classList.add('eloward-badge', 'eloward-unranked');
  } else {
    badgeElement.classList.add('eloward-badge', `eloward-${rankData.tier.toLowerCase()}`);
  }
  badgeElement.classList.add('eloward-tooltip', 'eloward-badge-new');
  
  // Set tooltip text
  const rankText = formatRankText(rankData);
  badgeElement.setAttribute('data-rank', rankText);
  
  // Insert badge before the username
  usernameElement.parentNode.insertBefore(badgeElement, usernameElement);
}

// Helper function to format rank text properly
function formatRankText(rankData) {
  if (!rankData) return 'Unranked';
  
  let rankText = rankData.tier;
  if (rankData.division && 
      rankData.tier !== 'Master' && 
      rankData.tier !== 'Grandmaster' && 
      rankData.tier !== 'Challenger') {
    rankText += ' ' + rankData.division;
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
  notification.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background-color: rgba(33, 37, 41, 0.85);
    color: white;
    padding: 12px 16px;
    border-radius: 8px;
    font-size: 14px;
    z-index: 9999;
    display: flex;
    align-items: center;
    gap: 8px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    backdrop-filter: blur(4px);
    transition: opacity 0.3s, transform 0.3s;
    opacity: 0;
    transform: translateY(10px);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;
  
  // Add logo
  const logo = document.createElement('img');
  logo.src = chrome.runtime.getURL('images/logo/icon48.png');
  logo.alt = 'EloWard';
  logo.style.cssText = `
    width: 24px;
    height: 24px;
    border-radius: 4px;
  `;
  
  // Add text
  const text = document.createElement('span');
  text.textContent = 'EloWard Active - LoL ranks enabled in chat';
  
  // Add close button
  const closeBtn = document.createElement('span');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = `
    margin-left: 8px;
    cursor: pointer;
    font-size: 16px;
    opacity: 0.7;
  `;
  closeBtn.addEventListener('click', () => {
    notification.style.opacity = '0';
    notification.style.transform = 'translateY(10px)';
    setTimeout(() => {
      document.body.removeChild(notification);
    }, 300);
  });
  
  // Assemble and add to page
  notification.appendChild(logo);
  notification.appendChild(text);
  notification.appendChild(closeBtn);
  document.body.appendChild(notification);
  
  // Animate in
  setTimeout(() => {
    notification.style.opacity = '1';
    notification.style.transform = 'translateY(0)';
  }, 10);
  
  // Auto-hide after 5 seconds
  setTimeout(() => {
    if (document.body.contains(notification)) {
      notification.style.opacity = '0';
      notification.style.transform = 'translateY(10px)';
      setTimeout(() => {
        if (document.body.contains(notification)) {
          document.body.removeChild(notification);
        }
      }, 300);
    }
  }, 5000);
}

// Remove activation notification if it exists
function removeActivationNotification() {
  const notification = document.getElementById('eloward-notification');
  if (notification && document.body.contains(notification)) {
    notification.style.opacity = '0';
    notification.style.transform = 'translateY(10px)';
    setTimeout(() => {
      if (document.body.contains(notification)) {
        document.body.removeChild(notification);
      }
    }, 300);
  }
} 