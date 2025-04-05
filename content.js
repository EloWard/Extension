// DIRECT TEST LOG - This should always appear
console.log("🛡️ EloWard Extension Active");

// Add a debug flag at the top of the file
const DEBUG_MODE = false; // Set to true to enable debug logging

// Global state
let isChannelSubscribed = false;
let channelName = '';
let processedMessages = new Set();
let observerInitialized = false;
let cachedUserMap = {}; // Cache for mapping Twitch usernames to Riot IDs
let tooltipElement = null; // Global tooltip element
let currentUser = null; // Current user's Twitch username

// Add cache for viewer ranks fetched in content script
let viewerRankCacheContentScript = {};
const VIEWER_RANK_CACHE_TTL_CS = 5 * 60 * 1000; // 5 minutes cache in content script

// Add a small delay before showing the tooltip to avoid flickering
let tooltipShowTimeout = null;

// Initialize storage data once at startup
initializeStorage();

// Initialize when the page is loaded
initializeExtension();

// Also set a delayed initialization to catch slow-loading pages
setTimeout(initializeExtension, 3000);

// Add a window.onload handler as an additional initialization method
window.addEventListener('load', function() {
  initializeExtension();
});

// Listen for URL changes (for SPA navigation)
window.addEventListener('popstate', function() {
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
 * Optimized function to check if a channel is subscribed
 * Uses local caching to avoid excessive API calls
 * @param {string} channelName - The channel to check
 * @param {boolean} forceCheck - Whether to bypass cache and force a fresh check
 * @returns {Promise<boolean>} - Whether the channel is subscribed
 */
async function checkChannelSubscription(channelName, forceCheck = false) {
  if (!channelName) return false;
  
  // Normalize channel name
  const normalizedChannel = channelName.toLowerCase();
  
  // Subscription cache is maintained in content script with a 5-minute TTL
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  
  // Check session storage for cached subscription status
  const cacheKey = `eloward_subscription_${normalizedChannel}`;
  const cachedData = sessionStorage.getItem(cacheKey);
  
  // If we have cached data and not forcing a check, use it
  if (!forceCheck && cachedData) {
    try {
      const parsedCache = JSON.parse(cachedData);
      // Check if cache is still valid
      if (Date.now() - parsedCache.timestamp < CACHE_TTL) {
        // Only log when changing channels or force checking
        if (forceCheck) {
          console.log(`EloWard: Using cached subscription for ${channelName}: ${parsedCache.subscribed ? 'Subscribed ✅' : 'Not Subscribed ❌'}`);
        }
        return parsedCache.subscribed;
      }
    } catch (error) {
      // Silent error - no need to log parsing errors
    }
  }
  
  try {
    return new Promise((resolve) => {
      // Send message to background script to check subscription
      chrome.runtime.sendMessage(
        { 
          action: 'check_streamer_subscription', 
          streamer: channelName,
          // Only skip background cache on forced checks
          skipCache: forceCheck 
        },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve(false);
            return;
          }
          
          // Extract the boolean value with casting to ensure it's a boolean
          const isSubscribed = response && response.subscribed === true;
          
          // Log subscription status (only for new checks, not every message)
          console.log(`EloWard: ${channelName} is ${isSubscribed ? 'Subscribed ✅' : 'Not Subscribed ❌'}`);
          
          // Cache the result in session storage
          try {
            sessionStorage.setItem(cacheKey, JSON.stringify({
              subscribed: isSubscribed,
              timestamp: Date.now()
            }));
          } catch (error) {
            // Silent error - no need to log storage errors
          }
          
          resolve(isSubscribed);
        }
      );
    });
  } catch (error) {
    return false;
  }
}

/**
 * Get the current channel name using multiple fallback methods
 * 1. Try to find the channel name in Twitch's data elements
 * 2. Parse from URL if data elements aren't available
 * @returns {string|null} The current channel name or null if not found
 */
function getCurrentChannelName() {
  // Method 1: Try to get from Twitch's channel data in the DOM
  // This is the most reliable method across all viewing modes
  const channelElem = document.querySelector('[data-a-target="channel-display-name"], [data-a-target="user-display-name"]');
  if (channelElem && channelElem.textContent) {
    return channelElem.textContent.trim().toLowerCase();
  }
  
  // Method 2: Try to get from channel header element
  const channelHeader = document.querySelector('.channel-info-content h1, .tw-channel-header h1');
  if (channelHeader && channelHeader.textContent) {
    return channelHeader.textContent.trim().toLowerCase();
  }
  
  // Method 3: Try to extract from the URL
  const pathSegments = window.location.pathname.split('/');
  
  // Handle moderator view URLs (format: /moderator/channelname)
  if (pathSegments[1] === 'moderator' && pathSegments.length > 2) {
    return pathSegments[2].toLowerCase();
  }
  
  // Regular channel URL (format: /channelname)
  if (pathSegments[1] && 
      pathSegments[1] !== 'oauth2' && 
      !pathSegments[1].includes('auth')) {
    return pathSegments[1].toLowerCase();
  }
  
  // Method 4: Try to find from other Twitch UI elements as last resort
  const channelLink = document.querySelector('a[data-a-target="stream-game-link"]')?.closest('div')?.querySelector('a:not([data-a-target="stream-game-link"])');
  if (channelLink) {
    const channelPath = new URL(channelLink.href).pathname;
    const channelNameFromLink = channelPath.split('/')[1];
    if (channelNameFromLink) {
      return channelNameFromLink.toLowerCase();
    }
  }
  
  // Could not determine channel name
  return null;
}

function initializeExtension() {
  // Get channel name using the new reliable method
  const newChannelName = getCurrentChannelName();
  
  // If no channel name or we're on an auth-related path, don't do anything
  if (!newChannelName || 
      window.location.pathname.includes('oauth2') ||
      window.location.pathname.includes('auth/') ||
      window.location.href.includes('auth/callback') ||
      window.location.href.includes('auth/redirect')) {
    return;
  }
  
  // Check if we've changed channels
  const channelChanged = newChannelName !== channelName;
  if (channelChanged) {
    // Update the channel name
    channelName = newChannelName;
    
    // Reset state when changing channels
    isChannelSubscribed = false;
    observerInitialized = false;
    
    // Only log on channel change
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
  
  // Only force check subscription status on channel changes
  // Otherwise use the cached value to reduce API calls
  checkChannelSubscription(channelName, channelChanged)
    .then(subscribed => {
      isChannelSubscribed = subscribed;
      
      if (isChannelSubscribed && !observerInitialized) {
        initializeObserver();
      } else if (!isChannelSubscribed) {
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
    // Get the current channel name using our reliable method
    const currentChannel = getCurrentChannelName();
    
    // Skip if we can't determine the channel or on auth-related paths
    if (!currentChannel || 
        window.location.pathname.includes('oauth2') || 
        window.location.pathname.includes('auth/') ||
        window.location.href.includes('auth/callback') ||
        window.location.href.includes('auth/redirect')) {
      return;
    }
    
    // Only reinitialize if the channel actually changed
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
      // This will trigger a fresh subscription check since channel changed
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
  // Try to find chat container using multiple selectors
  const potentialContainers = [
    // Standard Twitch chat selectors
    document.querySelector('.chat-scrollable-area__message-container'),
    document.querySelector('[data-a-target="chat-scroller"]'),
    document.querySelector('.chat-list--default, .chat-list'),
    document.querySelector('.chat-list__list'),
    
    // 7TV specific selectors
    document.querySelector('.seventv-chat-list'),
    document.querySelector('main[data-a-target="chat-main-container"]'),
    
    // BetterTTV specific selectors 
    document.querySelector('.chat-list--default, .chat-list--other'),
    document.querySelector('.bttv-chat-container')
  ].filter(Boolean); // Remove null elements
  
  for (const container of potentialContainers) {
    // Look for elements that might contain chat messages
    const usernameElements = container.querySelectorAll(
      '.chat-author__display-name, [data-a-target="chat-message-username"], ' + 
      '.seventv-chat-user, .seventv-chat-author, ' +
      '.chat-line__username'
    );
    
    if (usernameElements.length > 0) {
      return container;
    }
  }
  
  // Ultimate fallback - get the chat container by looking for any chat message
  const anyMessage = document.querySelector(
    '.chat-line__message, .chat-line, .seventv-chat-message'
  );
  
  if (anyMessage) {
    return anyMessage.closest('[role="log"]') || 
           anyMessage.parentElement || 
           anyMessage.closest('div[data-a-target="chat-scroller"]');
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
            // Check if this is a chat message using multiple extension-aware selectors
            const isMessage = node.classList && (
              node.classList.contains('chat-line__message') || 
              node.classList.contains('chat-line') ||
              node.classList.contains('seventv-chat-message') ||
              node.classList.contains('bttv-message') ||
              node.querySelector('.chat-author__display-name, [data-a-target="chat-message-username"], .seventv-chat-user, .seventv-chat-author, .chat-line__username')
            );
            
            if (isMessage) {
              processNewMessage(node);
            } else if (isFallbackObserver) {
              // For fallback observers, look deeper for chat messages from any extension
              const messages = node.querySelectorAll(
                '[data-a-target="chat-line-message"], .chat-line__message, .chat-line, ' +
                '.seventv-chat-message, .seventv-chat-line, ' +
                '.bttv-message, .bttv-chat-line'
              );
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
    subtree: true // Always use subtree: true to catch changes made by other extensions
  });
  
  // Also process any existing messages, supporting multiple extensions' formats
  const existingMessages = chatContainer.querySelectorAll(
    '[data-a-target="chat-line-message"], .chat-line__message, .chat-line, ' +
    '.seventv-chat-message, .seventv-chat-line, ' +
    '.bttv-message, .bttv-chat-line'
  );
    
  for (const message of existingMessages) {
    processNewMessage(message);
  }
  
  // Log successful observer setup
  console.log(`🛡️ EloWard chat observer setup completed. Chat messages will be processed for rank display.`);
}

function processNewMessage(messageNode) {
  // Ensure we have the messageNode and it hasn't been processed
  if (!messageNode || processedMessages.has(messageNode)) {
    return;
  }

  // Find the username element within the message
  // Use a selector that captures usernames in chat lines and potentially other areas
  const usernameElement = messageNode.querySelector('[data-a-user], .chat-author__display-name');
  
  if (usernameElement && usernameElement.textContent) {
    const username = usernameElement.textContent.trim().toLowerCase();

    // Check subscription status (async, continues in background)
    // We don't need to wait for this to add the badge
    if (channelName) {
      checkChannelSubscription(channelName);
    }

    // --- NEW LOGIC: Fetch rank for ANY user --- 
    getAndDisplayRank(usernameElement, username, 'lol'); // Currently hardcoded to 'lol'
    // --- END NEW LOGIC ---
  }

  // Mark this message node as processed
  processedMessages.add(messageNode);
}

// --- NEW FUNCTION: Get rank from background/cache and display --- 
async function getAndDisplayRank(usernameElement, username, game) {
  const cacheKey = `${game}:${username}`;
  const now = Date.now();

  // 1. Check content script cache first
  if (viewerRankCacheContentScript[cacheKey] && (now - viewerRankCacheContentScript[cacheKey].timestamp < VIEWER_RANK_CACHE_TTL_CS)) {
    const cachedData = viewerRankCacheContentScript[cacheKey].data;
    // Only add badge if rank data exists (not null or error)
    if (cachedData && !cachedData.error) {
       if (DEBUG_MODE) console.log(`CS Cache hit for ${cacheKey}`);
       addBadgeToMessage(usernameElement, cachedData); 
    }
    return; // Found in cache (or known not to exist/error), exit
  }

  // 2. If not in content script cache, request from background script
  if (DEBUG_MODE) console.log(`CS Cache miss for ${cacheKey}. Requesting from background...`);
  chrome.runtime.sendMessage(
    { action: 'fetch_viewer_rank', username: username, game: game },
    (response) => {
      if (chrome.runtime.lastError) {
        // Handle potential errors like the background script being unavailable
        console.error(`Error sending message to background script for ${username}:`, chrome.runtime.lastError.message);
        // Cache the error temporarily to avoid spamming
        viewerRankCacheContentScript[cacheKey] = { data: { error: 'Background script error' }, timestamp: now };
        return;
      }

      // Cache the response (rank data, null for 404, or error object)
      viewerRankCacheContentScript[cacheKey] = { data: response, timestamp: now };

      // Check if the response contains valid rank data (not null and no error property)
      if (response && !response.error) {
        if (DEBUG_MODE) console.log(`Received rank for ${cacheKey} from background:`, response);
        addBadgeToMessage(usernameElement, response);
      } else if (response && response.error) {
        // Log errors received from the background/API
        console.warn(`Failed to get rank for ${username}: ${response.error}`, response.details || '');
      } else {
        // Response was null (likely a 404 from the API), do nothing visually
        if (DEBUG_MODE) console.log(`No rank found for ${cacheKey} (received null)`);
      }
    }
  );
}
// --- END NEW FUNCTION ---

// Add badge to the specified username element
// Modify this function to handle the data structure from the viewer API
function addBadgeToMessage(usernameElement, rankData) {
  if (!usernameElement || !rankData || typeof rankData !== 'object' || rankData.error) {
    // Don't add if element is missing, data is invalid, or it's an error object
    return;
  }

  // Prevent adding multiple badges to the same element
  if (usernameElement.parentNode.querySelector('.eloward-rank-badge')) {
    return;
  }

  const badge = document.createElement('img');
  badge.classList.add('chat-badge', 'eloward-rank-badge'); // Use Twitch's class + our own
  badge.style.marginLeft = '3px'; // Add some spacing
  badge.style.verticalAlign = 'middle'; // Align with text

  // Determine rank tier and get icon URL (assuming a helper function exists or we create one)
  const tier = rankData.rank_tier ? rankData.rank_tier.toLowerCase() : 'unranked';
  badge.src = getRankIconUrl(tier); // Use existing or create getRankIconUrl
  badge.alt = formatRankText(rankData); // Use rank data for alt text

  // Add tooltip event listeners
  badge.addEventListener('mouseenter', (event) => showTooltip(event, rankData));
  badge.addEventListener('mouseleave', hideTooltip);

  // Insert the badge before the username text within its container
  // Inserting after the existing badges (if any) is usually preferred
  const parent = usernameElement.parentNode;
  if (parent) {
    // Find the last existing badge to insert after, or insert before the username span
    const lastBadge = parent.querySelector('.chat-badge:last-of-type');
    if (lastBadge) {
        lastBadge.insertAdjacentElement('afterend', badge);
    } else {
        // If no other badges, insert directly before the username text container
        usernameElement.insertAdjacentElement('beforebegin', badge); 
    }
  }

  if (DEBUG_MODE) {
    const username = usernameElement.textContent.trim().toLowerCase();
    console.log(`Badge added for ${username}: ${tier}`);
  }
}

// Create or modify getRankIconUrl based on RankDisplay.txt requirements
function getRankIconUrl(tier) {
    tier = tier ? tier.toLowerCase() : 'unranked';
    // Use a consistent naming scheme, e.g., images/ranks/lol/bronze.png
    // TODO: Ensure these images exist in the extension package!
    const basePath = chrome.runtime.getURL('images/ranks/lol'); 
    
    // Map tiers to image filenames (ensure these filenames match your assets)
    const tierImageMap = {
        'iron': 'iron.png',
        'bronze': 'bronze.png',
        'silver': 'silver.png',
        'gold': 'gold.png',
        'platinum': 'platinum.png',
        'emerald': 'emerald.png', // Added Emerald
        'diamond': 'diamond.png',
        'master': 'master.png',
        'grandmaster': 'grandmaster.png',
        'challenger': 'challenger.png',
        'unranked': 'unranked.png' // Default/unranked image
    };

    const imageName = tierImageMap[tier] || 'unranked.png'; // Fallback to unranked
    return `${basePath}/${imageName}`;
}

// Modify formatRankText to use the new data structure
function formatRankText(rankData) {
  if (!rankData || typeof rankData !== 'object') {
    return 'EloWard Rank: Unknown';
  }
  
  // Handle cases where rank might not be fully defined (e.g., unranked)
  const tier = rankData.rank_tier || 'Unranked';
  const division = rankData.rank_division ? ` ${rankData.rank_division}` : ''; // e.g., " IV"
  const lp = (rankData.lp !== null && rankData.lp !== undefined) ? ` ${rankData.lp} LP` : ''; // e.g., " 50 LP"
  const riotId = rankData.riot_id ? ` (${rankData.riot_id})` : ''; // e.g., " (Stealthy#NA1)"
  
  // Capitalize first letter of tier
  const capitalizedTier = tier.charAt(0).toUpperCase() + tier.slice(1).toLowerCase();

  // Construct the rank string
  if (tier.toLowerCase() === 'unranked') {
      return `EloWard: Unranked${riotId}`;
  } else if (['master', 'grandmaster', 'challenger'].includes(tier.toLowerCase())) {
      // These ranks don't have divisions
      return `EloWard: ${capitalizedTier}${lp}${riotId}`;
  } else {
      return `EloWard: ${capitalizedTier}${division}${lp}${riotId}`;
  }
}

// Modify showTooltip to use the new data structure
function showTooltip(event, rankData) {
  // Clear any existing timeout to prevent multiple tooltips
  if (tooltipShowTimeout) {
    clearTimeout(tooltipShowTimeout);
    tooltipShowTimeout = null;
  }

  // Create tooltip if it doesn't exist
  if (!tooltipElement) {
    tooltipElement = document.createElement('div');
    tooltipElement.className = 'eloward-tooltip';
    document.body.appendChild(tooltipElement);
  }

  // Set content using the updated formatRankText
  tooltipElement.textContent = formatRankText(rankData);

  // Small delay before showing
  tooltipShowTimeout = setTimeout(() => {
    const rect = event.target.getBoundingClientRect();
    tooltipElement.style.left = `${rect.left + window.scrollX}px`;
    tooltipElement.style.top = `${rect.bottom + window.scrollY + 5}px`; // Position below badge
    tooltipElement.style.display = 'block';
  }, 150); // 150ms delay
}

function hideTooltip() {
  // Clear any pending show timeout
  if (tooltipShowTimeout) {
    clearTimeout(tooltipShowTimeout);
    tooltipShowTimeout = null;
  }
  
  if (tooltipElement && tooltipElement.classList.contains('visible')) {
    // Animate out - fade and scale down slightly
    tooltipElement.style.opacity = '0';
    tooltipElement.style.transform = 'translate(-30%, -100%) scale(0.9)';
    
    // Remove visible class after animation completes
    setTimeout(() => {
      tooltipElement.classList.remove('visible');
    }, 100);
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
      -webkit-user-select: none !important;
      user-select: none !important;
      -webkit-touch-callout: none !important;
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
    
    /* Chat bubble style tooltip - base styles */
    .eloward-tooltip {
      position: absolute !important;
      z-index: 99999 !important;
      pointer-events: none !important;
      transform: translate(-12%, -100%) scale(0.9) !important; /* Bubble position: adjust -30% to shift left/right */
      font-size: 13px !important;
      font-weight: 600 !important;
      font-family: Roobert, "Helvetica Neue", Helvetica, Arial, sans-serif !important;
      white-space: nowrap !important;
      padding: 4px 6px !important; /* Reduced padding */
      border-radius: 6px !important; /* Increased corner roundness (was 3px) */
      line-height: 1.2 !important;
      opacity: 0 !important;
      transition: opacity 0.07s ease-in-out, transform 0.07s ease-in-out !important;
      text-align: center !important;
      border: none !important;
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.3) !important;
      margin-top: -2px !important; /* Offset to position it nicely */
      will-change: transform, opacity !important; /* Hint for browser to optimize animations */
    }
    
    /* Dark theme Twitch - show light tooltip */
    html.tw-root--theme-dark .eloward-tooltip,
    .tw-root--theme-dark .eloward-tooltip,
    body[data-a-theme="dark"] .eloward-tooltip,
    body.dark-theme .eloward-tooltip {
      color: #0e0e10 !important;
      background-color: white !important;
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.3) !important;
    }
    
    html.tw-root--theme-dark .eloward-tooltip::after,
    .tw-root--theme-dark .eloward-tooltip::after,
    body[data-a-theme="dark"] .eloward-tooltip::after,
    body.dark-theme .eloward-tooltip::after {
      border-color: white transparent transparent transparent !important;
    }
    
    /* Light theme Twitch - show dark tooltip */
    html.tw-root--theme-light .eloward-tooltip,
    .tw-root--theme-light .eloward-tooltip,
    body[data-a-theme="light"] .eloward-tooltip,
    body:not(.dark-theme):not([data-a-theme="dark"]) .eloward-tooltip {
      color: #efeff1 !important;
      background-color: #0e0e10 !important;
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.4) !important;
    }
    
    html.tw-root--theme-light .eloward-tooltip::after,
    .tw-root--theme-light .eloward-tooltip::after,
    body[data-a-theme="light"] .eloward-tooltip::after,
    body:not(.dark-theme):not([data-a-theme="dark"]) .eloward-tooltip::after {
      border-color: #0e0e10 transparent transparent transparent !important;
    }
    
    /* Chat bubble arrow at bottom pointing toward badge, offset to the left */
    .eloward-tooltip::after {
      content: "" !important;
      position: absolute !important;
      bottom: -4px !important; /* Position at bottom */
      left: 10% !important; /* Stem position: adjust this % to move stem left/right */
      margin-left: -4px !important;
      border-width: 4px 4px 0 4px !important; /* Arrow pointing down */
      border-style: solid !important;
    }
    
    .eloward-tooltip.visible {
      opacity: 1 !important;
      transform: translate(-12%, -100%) scale(1) !important; /* Bubble position when visible: must match transform above */
    }
  `;
  
  document.head.appendChild(styleElement);
} 