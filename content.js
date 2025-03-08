// EloWard Content Script
// This script runs on Twitch pages and adds rank badges to chat messages

// Global state
let isChannelSubscribed = false;
let channelName = '';
let processedMessages = new Set();
let observerInitialized = false;
let cachedUserMap = {}; // Cache for mapping Twitch usernames to Riot IDs
let rankCache = {}; // Cache for rank data
const RANK_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

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
      
      // Check if the new channel is subscribed
      if (channelName) {
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

function initializeObserver() {
  if (observerInitialized) return;
  
  function findChatContainer() {
    // Try to find the chat container
    // Twitch's DOM structure can change, so we need to be flexible
    const chatContainerSelectors = [
      '.chat-scrollable-area__message-container',
      '.chat-list--default',
      '.chat-list',
      '[data-test-selector="chat-scrollable-area-container"]'
    ];
    
    for (const selector of chatContainerSelectors) {
      const container = document.querySelector(selector);
      if (container) return container;
    }
    
    return null;
  }
  
  // Try to find the chat container
  let chatContainer = findChatContainer();
  
  if (chatContainer) {
    console.log('EloWard: Found chat container, setting up observer');
    setupChatObserver(chatContainer);
    observerInitialized = true;
  } else {
    console.log('EloWard: Chat container not found, retrying in 2 seconds');
    // Retry after a delay
    setTimeout(() => {
      let chatContainer = findChatContainer();
      if (chatContainer) {
        setupChatObserver(chatContainer);
        observerInitialized = true;
      } else {
        console.log('EloWard: Chat container still not found, giving up');
      }
    }, 2000);
  }
}

function setupChatObserver(chatContainer) {
  // Process existing messages
  const existingMessages = chatContainer.querySelectorAll('.chat-line__message');
  existingMessages.forEach(processNewMessage);
  
  // Create an observer to watch for new messages
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE && 
              (node.classList.contains('chat-line__message') || 
               node.querySelector('.chat-line__message'))) {
            if (node.classList.contains('chat-line__message')) {
              processNewMessage(node);
            } else {
              const messages = node.querySelectorAll('.chat-line__message');
              messages.forEach(processNewMessage);
            }
          }
        });
      }
    });
  });
  
  // Start observing
  observer.observe(chatContainer, { childList: true, subtree: true });
}

function processNewMessage(messageNode) {
  if (!isChannelSubscribed || !messageNode) return;
  
  // Generate a unique ID for the message to avoid processing it multiple times
  const messageId = messageNode.getAttribute('data-message-id') || 
                    messageNode.getAttribute('id') || 
                    `${Date.now()}-${Math.random()}`;
  
  // Skip if we've already processed this message
  if (processedMessages.has(messageId)) return;
  processedMessages.add(messageId);
  
  // Limit the size of the processedMessages set to avoid memory leaks
  if (processedMessages.size > 1000) {
    // Remove the oldest entries
    const iterator = processedMessages.values();
    for (let i = 0; i < 200; i++) {
      processedMessages.delete(iterator.next().value);
    }
  }
  
  // Extract username
  const usernameElement = messageNode.querySelector('.chat-author__display-name') || 
                          messageNode.querySelector('.chat-line__username');
  
  if (!usernameElement) return;
  
  const username = usernameElement.textContent.trim().toLowerCase();
  
  // Check if we already have cached rank data for this user
  if (rankCache[username] && (Date.now() - rankCache[username].timestamp < RANK_CACHE_DURATION)) {
    // Use cached data
    addBadgeToMessage(usernameElement, rankCache[username].data);
    return;
  }
  
  // Fetch rank data for this user
  fetchUserRank(username)
    .then(rankData => {
      if (rankData) {
        // Cache the rank data
        rankCache[username] = {
          timestamp: Date.now(),
          data: rankData
        };
        
        // Add the badge to the message
        addBadgeToMessage(usernameElement, rankData);
      }
    })
    .catch(error => {
      console.error(`EloWard: Error fetching rank for ${username}:`, error);
    });
}

function fetchUserRank(username) {
  // This is a simple implementation using our existing API endpoint
  // In a production environment, you would want a more robust solution
  return new Promise((resolve, reject) => {
    // For testing, generate mock rank data based on username
    // In production, this would call your backend API
    const hash = Array.from(username).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    
    const tiers = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grandmaster', 'Challenger'];
    const divisions = ['IV', 'III', 'II', 'I'];
    
    // Determine tier based on hash
    let tierIndex = hash % tiers.length;
    
    // Determine division for tiers that have divisions
    let division = null;
    if (tierIndex < 6) { // Iron through Diamond have divisions
      const divisionIndex = Math.floor((hash / 10) % 4);
      division = divisions[divisionIndex];
    }
    
    // Determine LP
    const lp = hash % 100;
    
    // Create rank data object
    const rankData = {
      tier: tiers[tierIndex],
      division: division,
      leaguePoints: lp,
      wins: 100 + (hash % 200),
      losses: 50 + (hash % 150)
    };
    
    // Simulate API delay
    setTimeout(() => {
      resolve(rankData);
    }, 100);
  });
}

function addBadgeToMessage(usernameElement, rankData) {
  if (!usernameElement || !rankData) return;
  
  // Check if badge already exists
  if (usernameElement.nextElementSibling && 
      usernameElement.nextElementSibling.classList.contains('eloward-rank-badge')) {
    return;
  }
  
  // Create badge element
  const badgeElement = document.createElement('span');
  badgeElement.className = 'eloward-rank-badge';
  badgeElement.setAttribute('data-tier', rankData.tier.toLowerCase());
  if (rankData.division) {
    badgeElement.setAttribute('data-division', rankData.division.toLowerCase());
  }
  
  // Add tooltip text
  const rankText = formatRankText(rankData);
  badgeElement.setAttribute('data-tooltip', rankText);
  
  // Style the badge
  badgeElement.style.display = 'inline-block';
  badgeElement.style.width = '16px';
  badgeElement.style.height = '16px';
  badgeElement.style.marginLeft = '4px';
  badgeElement.style.backgroundSize = 'contain';
  badgeElement.style.backgroundRepeat = 'no-repeat';
  badgeElement.style.backgroundPosition = 'center';
  badgeElement.style.verticalAlign = 'middle';
  
  // Set background image based on rank
  const tierLower = rankData.tier.toLowerCase();
  if (['master', 'grandmaster', 'challenger'].includes(tierLower)) {
    badgeElement.style.backgroundImage = `url(${chrome.runtime.getURL(`images/ranks/${tierLower}.png`)})`;
  } else if (rankData.division) {
    badgeElement.style.backgroundImage = `url(${chrome.runtime.getURL(`images/ranks/${tierLower}_${rankData.division.toLowerCase()}.png`)})`;
  } else {
    badgeElement.style.backgroundImage = `url(${chrome.runtime.getURL('images/ranks/unranked.png')})`;
  }
  
  // Add event listeners for tooltip
  badgeElement.addEventListener('mouseenter', showTooltip);
  badgeElement.addEventListener('mouseleave', hideTooltip);
  
  // Insert badge after username
  usernameElement.insertAdjacentElement('afterend', badgeElement);
}

function formatRankText(rankData) {
  if (!rankData.tier) return 'Unranked';
  
  let text = rankData.tier;
  
  if (rankData.division && !['Master', 'Grandmaster', 'Challenger'].includes(rankData.tier)) {
    text += ' ' + rankData.division;
  }
  
  if (rankData.leaguePoints !== undefined) {
    text += ` ${rankData.leaguePoints} LP`;
  }
  
  if (rankData.wins !== undefined && rankData.losses !== undefined) {
    const totalGames = rankData.wins + rankData.losses;
    const winRate = Math.round((rankData.wins / totalGames) * 100);
    text += ` | ${winRate}% Win Rate`;
  }
  
  return text;
}

function showActivationNotification() {
  // Remove any existing notification first
  removeActivationNotification();
  
  // Create notification element
  const notification = document.createElement('div');
  notification.id = 'eloward-notification';
  notification.textContent = 'EloWard Rank Badges Enabled';
  
  // Style the notification
  notification.style.position = 'absolute';
  notification.style.top = '0';
  notification.style.right = '0';
  notification.style.background = 'rgba(217, 163, 54, 0.9)';
  notification.style.color = '#000';
  notification.style.padding = '8px 12px';
  notification.style.borderBottomLeftRadius = '4px';
  notification.style.fontSize = '12px';
  notification.style.fontWeight = 'bold';
  notification.style.zIndex = '9999';
  notification.style.transition = 'opacity 0.5s ease-in-out';
  notification.style.opacity = '1';
  
  // Add the logo
  const logo = document.createElement('img');
  logo.src = chrome.runtime.getURL('images/logo/icon32.png');
  logo.style.width = '16px';
  logo.style.height = '16px';
  logo.style.marginRight = '6px';
  logo.style.verticalAlign = 'middle';
  
  notification.prepend(logo);
  
  // Add to the page
  document.body.appendChild(notification);
  
  // Fade out and remove after 5 seconds
  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 500);
  }, 5000);
}

function removeActivationNotification() {
  const existingNotification = document.getElementById('eloward-notification');
  if (existingNotification && existingNotification.parentNode) {
    existingNotification.parentNode.removeChild(existingNotification);
  }
}

function showTooltip(event) {
  const badgeElement = event.currentTarget;
  const tooltipText = badgeElement.getAttribute('data-tooltip');
  
  // Create tooltip element
  const tooltip = document.createElement('div');
  tooltip.className = 'eloward-tooltip';
  tooltip.textContent = tooltipText;
  
  // Style the tooltip
  tooltip.style.position = 'absolute';
  tooltip.style.background = 'rgba(0, 0, 0, 0.9)';
  tooltip.style.color = '#fff';
  tooltip.style.padding = '6px 10px';
  tooltip.style.borderRadius = '4px';
  tooltip.style.fontSize = '12px';
  tooltip.style.zIndex = '9999';
  tooltip.style.pointerEvents = 'none';
  
  // Position the tooltip
  const rect = badgeElement.getBoundingClientRect();
  tooltip.style.left = `${rect.left + rect.width / 2}px`;
  tooltip.style.top = `${rect.top - 30}px`;
  tooltip.style.transform = 'translateX(-50%)';
  
  // Add the tooltip to the page
  document.body.appendChild(tooltip);
  
  // Store reference to the tooltip
  badgeElement.tooltip = tooltip;
}

function hideTooltip(event) {
  const badgeElement = event.currentTarget;
  if (badgeElement.tooltip) {
    badgeElement.tooltip.parentNode.removeChild(badgeElement.tooltip);
    badgeElement.tooltip = null;
  }
} 