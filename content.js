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

function initializeExtension() {
  // Extract channel name from URL
  channelName = window.location.pathname.split('/')[1];
  if (!channelName) return;
  
  console.log(`EloWard: Initializing on channel ${channelName}`);
  
  // Check if this streamer has a subscription
  chrome.runtime.sendMessage(
    { action: 'check_streamer_subscription', streamer: channelName },
    (response) => {
      console.log(`EloWard: Subscription check response for ${channelName}:`, response);
      
      if (response && response.subscribed) {
        isChannelSubscribed = true;
        console.log(`EloWard: Channel ${channelName} is subscribed`);
        
        // Initialize the observer for chat messages
        initializeObserver();
        
        // Show a subtle notification that EloWard is active
        showActivationNotification();
      } else {
        console.log(`EloWard: Channel ${channelName} is not subscribed`);
        
        // For development, check if we're a dev user trying to bypass subscription check
        if (channelName.toLowerCase() === 'yomata1' || 
            localStorage.getItem('eloward_dev_mode') === 'true') {
          console.log('EloWard: Development mode enabled, activating anyway');
          isChannelSubscribed = true;
          initializeObserver();
          showActivationNotification();
        }
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
    // Chat container found, set up the observer
    setupChatObserver(chatContainer);
    observerInitialized = true;
  } else {
    // Chat container not found yet, wait and try again
    console.log('EloWard: Chat container not found, waiting...');
    setTimeout(() => {
      chatContainer = findChatContainer();
      if (chatContainer) {
        setupChatObserver(chatContainer);
        observerInitialized = true;
      } else {
        console.log('EloWard: Chat container still not found after delay');
      }
    }, 2000);
  }
}

function setupChatObserver(chatContainer) {
  console.log('EloWard: Setting up chat observer');
  
  // Create a MutationObserver to watch for new chat messages
  const chatObserver = new MutationObserver((mutations) => {
    if (!isChannelSubscribed) return;
    
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Process the new message
            processNewMessage(node);
          }
        }
      }
    }
  });
  
  // Start observing the chat container
  chatObserver.observe(chatContainer, {
    childList: true,
    subtree: false
  });
  
  // Also process any existing messages
  const existingMessages = chatContainer.children;
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
  if (!usernameElement) return;
  
  // Get the Twitch username
  const twitchUsername = usernameElement.textContent.trim();
  console.log(`EloWard: Processing message from ${twitchUsername}`);
  
  // Special handling for your own username - force lookup even if cached as null
  const isOwnUsername = twitchUsername.toLowerCase() === 'yomata1';
  
  // Check if we already have rank data for this user in the cache and it's not a forced lookup
  if (twitchUsername.toLowerCase() in cachedUserMap && !isOwnUsername) {
    console.log(`EloWard: Found cached data for ${twitchUsername}:`, cachedUserMap[twitchUsername.toLowerCase()]);
    
    // Only display badge if valid rank data exists (not null or undefined)
    if (cachedUserMap[twitchUsername.toLowerCase()] !== null) {
      addBadgeToMessage(usernameElement, cachedUserMap[twitchUsername.toLowerCase()]);
    }
    return;
  }
  
  // Get the user's selected region from storage
  chrome.storage.local.get(['selectedRegion', 'linkedAccounts'], (data) => {
    const selectedRegion = data.selectedRegion || 'na1';
    const platformRegion = EloWardConfig.riot.platformRouting[selectedRegion].region;
    
    // Debug: Check if we have linked account info
    console.log(`EloWard: Checking for linked account data for ${twitchUsername}`);
    const linkedAccounts = data.linkedAccounts || {};
    if (linkedAccounts[twitchUsername.toLowerCase()]) {
      console.log(`EloWard: Found locally cached linked account for ${twitchUsername}`);
    }
    
    // Request rank data for the Twitch username from the background script
    console.log(`EloWard: Requesting rank data for ${twitchUsername} on platform ${platformRegion}`);
    chrome.runtime.sendMessage({
      action: 'get_rank_for_twitch_user',
      twitchUsername: twitchUsername,
      platform: platformRegion,
      forceRefresh: isOwnUsername // Force refresh for your own username
    }, (response) => {
      console.log(`EloWard: Got response for ${twitchUsername}:`, response);
      
      if (response && response.rank) {
        // Cache the rank data
        cachedUserMap[twitchUsername.toLowerCase()] = response.rank;
        console.log(`EloWard: Cached rank data for ${twitchUsername}:`, response.rank);
        
        // Add the badge to the message
        addBadgeToMessage(usernameElement, response.rank);
      } else {
        // Cache null to avoid repeated lookups, except for your own username
        if (!isOwnUsername) {
          cachedUserMap[twitchUsername.toLowerCase()] = null;
          console.log(`EloWard: No rank data found for ${twitchUsername}, caching as null`);
        } else {
          console.log(`EloWard: No rank data found for your username ${twitchUsername}, not caching to allow retries`);
        }
      }
    });
  });
}

function addBadgeToMessage(usernameElement, rankData) {
  // Check if badge already exists
  if (usernameElement.parentNode.querySelector('.eloward-rank-badge')) return;
  
  // Create the badge element
  const badgeElement = document.createElement('div');
  badgeElement.className = 'eloward-rank-badge';
  
  // Set the background image to the rank icon
  const rankTier = rankData ? rankData.tier.toLowerCase() : 'unranked';
  badgeElement.style.backgroundImage = `url(${chrome.runtime.getURL(`images/ranks/${rankTier}.png`)})`;
  
  // Add tooltip with rank information
  badgeElement.setAttribute('data-tooltip', formatRankText(rankData));
  
  // Insert the badge after the username
  usernameElement.parentNode.insertBefore(badgeElement, usernameElement.nextSibling);
  
  // Add event listeners for tooltip
  badgeElement.addEventListener('mouseenter', showTooltip);
  badgeElement.addEventListener('mouseleave', hideTooltip);
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