// EloWard Background Service Worker
import { RiotAuth } from './js/riotAuth.js';
import { TwitchAuth } from './js/twitchAuth.js';
import { PersistentStorage } from './js/persistentStorage.js';

// Constants
const BADGE_REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutes
const API_BASE_URL = 'https://eloward-riotrso.unleashai-inquiries.workers.dev'; // Updated to use deployed worker
const SUBSCRIPTION_API_URL = 'https://eloward-subscription-api.unleashai-inquiries.workers.dev'; // Subscription API worker
const TWITCH_REDIRECT_URL = 'https://www.eloward.com/ext/twitch/auth/redirect'; // Extension-specific Twitch redirect URI
const SUBSCRIPTION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache for subscription status

// Platform routing values for Riot API
const PLATFORM_ROUTING = {
  'na1': { region: 'americas', name: 'North America' },
  'euw1': { region: 'europe', name: 'EU West' },
  'eun1': { region: 'europe', name: 'EU Nordic & East' },
  'kr': { region: 'asia', name: 'Korea' },
  'br1': { region: 'americas', name: 'Brazil' },
  'jp1': { region: 'asia', name: 'Japan' },
  'la1': { region: 'americas', name: 'LAN' },
  'la2': { region: 'americas', name: 'LAS' },
  'oc1': { region: 'sea', name: 'Oceania' },
  'ru': { region: 'europe', name: 'Russia' },
  'tr1': { region: 'europe', name: 'Turkey' },
  'ph2': { region: 'sea', name: 'Philippines' },
  'sg2': { region: 'sea', name: 'Singapore' },
  'th2': { region: 'sea', name: 'Thailand' },
  'tw2': { region: 'sea', name: 'Taiwan' },
  'vn2': { region: 'sea', name: 'Vietnam' }
};

// Caches to improve performance and reduce API calls
let cachedRankResponses = {};
let previousSubscriptionStatus = {}; // Only kept for logging status changes
let subscriptionCache = {}; // Cache for subscription status

/* Track any open auth windows */
let authWindows = {};

/* Handle auth callbacks */
function handleAuthCallback(params) {
  // Only log basic info, not complete params
  console.log('Auth callback received');
  
  if (!params || !params.code) {
    console.error('Invalid auth callback data');
    return;
  }
  
  // Store the auth callback data
  const promiseStorage = new Promise(resolve => {
    chrome.storage.local.set({
      'auth_callback': params,
      'eloward_auth_callback': params
    }, resolve);
  });
  
  // Determine if this is a Twitch callback or a Riot callback
  const isTwitchCallback = params.service === 'twitch';
  
  if (isTwitchCallback) {
    console.log('Processing Twitch auth');
    chrome.storage.local.set({
      'twitch_auth_callback': params
    }, () => {
      initiateTokenExchange(params, 'twitch');
    });
  } else {
    console.log('Processing Riot auth');
    chrome.storage.local.set({
      'riot_auth_callback': params
    }, () => {
      initiateTokenExchange(params, 'riot');
    });
  }
  
  // Send message to any open popups
  chrome.runtime.sendMessage({
    type: 'auth_callback',
    params: params
  });
}

/**
 * Exchange authorization code for tokens
 * @param {Object} authData - The authorization data with code
 * @param {string} service - The service ('riot' or 'twitch')
 */
async function initiateTokenExchange(authData, service = 'riot') {
  try {
    console.log(`Initiating ${service} token exchange`);
    
    if (!authData || !authData.code) {
      throw new Error('Invalid auth data for token exchange');
    }
    
    if (service === 'twitch') {
      // Exchange code for Twitch tokens
      const tokenData = await TwitchAuth.exchangeCodeForTokens(authData.code);
      console.log('Twitch token exchange successful');
      
      // Get user info
      const userInfo = await TwitchAuth.getUserInfo();
      console.log('Retrieved Twitch user info');
      
      // Store in persistent storage with indefinite retention
      await PersistentStorage.storeTwitchUserData(userInfo);
      await PersistentStorage.updateConnectedState('twitch', true);
      
      return userInfo;
    } else {
      // Exchange code for Riot tokens
      const tokenData = await RiotAuth.exchangeCodeForTokens(authData.code);
      console.log('Riot token exchange successful');
      
      // Get user data
      const userData = await RiotAuth.getUserData();
      console.log('Retrieved Riot user data');
      
      // Store in persistent storage with indefinite retention
      await PersistentStorage.storeRiotUserData(userData);
      await PersistentStorage.updateConnectedState('riot', true);
      
      return userData;
    }
  } catch (error) {
    console.error(`Error during ${service} token exchange:`, error);
    throw error;
  }
}

/* Listen for messages from content scripts, popup, and other extension components */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Skip logging for frequent message types to reduce console spam
  const frequentActions = ['fetch_rank_for_username', 'check_streamer_subscription'];
  if (!frequentActions.includes(message.action)) {
    if (message?.type) {
      console.log('Message received:', message.type, message?.action || '');
    } else {
      console.log('Message received:', message.action || 'unknown');
    }
  }
  
  // TWITCH AUTH CALLBACK HANDLING
  if (message.type === 'twitch_auth_callback' || (message.type === 'auth_callback' && message.service === 'twitch')) {
    console.log('Received Twitch auth callback');
    
    try {
      // Extract params depending on message format
      const params = message.params || {
        code: message.code,
        state: message.state,
        service: 'twitch',
        source: 'twitch_auth_callback'
      };
      
      if (!params.code) {
        console.error('Missing required code in Twitch auth callback');
        sendResponse({ 
          success: false, 
          error: 'Missing required authorization code' 
        });
        return true;
      }
      
      // Process the auth data with enhanced metadata
      handleAuthCallback({
        ...params,
        source: 'twitch_auth_callback',
        received_at: Date.now(),
        sender_info: {
          id: sender.id || 'unknown',
          url: sender.url || 'unknown'
        }
      });
      
      // Send success response immediately and don't wait for async operations
      sendResponse({ 
        success: true, 
        message: 'Twitch auth callback received and processing',
      });
      
      // Notify any listeners that we received a Twitch auth callback
      setTimeout(() => {
        chrome.runtime.sendMessage({
          type: 'twitch_auth_processed',
          success: true,
          timestamp: Date.now()
        }).catch(() => {/* Ignore errors; popup might not be open */});
      }, 500);
      
      return true; // Keep the message channel open for the async response
    } catch (error) {
      console.error('Error handling Twitch auth callback:', error);
      sendResponse({ 
        success: false, 
        error: error.message || 'Unknown error processing Twitch auth callback'
      });
      return true;
    }
  }
  
  // AUTH RELATED MESSAGES
  if (message.type === 'get_auth_callback') {
    console.log('Handling get_auth_callback request');
    // Also check for Twitch-specific callback
    chrome.storage.local.get(['authCallback', 'auth_callback', 'eloward_auth_callback', 'twitch_auth_callback'], (data) => {
      // Try to find the callback data in any of the possible storage keys
      const callback = data.twitch_auth_callback || data.authCallback || data.auth_callback || data.eloward_auth_callback;
      
      if (callback) {
        console.log('Found auth callback data to return', {
          keys: Object.keys(callback),
          service: callback.service || callback.source
        });
      } else {
        console.log('No auth callback data found');
      }
      
      sendResponse({ data: callback });
    });
    return true; // Required for async sendResponse
  }
  
  if (message.type === 'auth_callback' && message.code) {
    console.log('Auth callback from redirect page');
    
    // Store the auth callback result for later retrieval
    chrome.storage.local.set({
      eloward_auth_callback_result: {
        code: message.code,
        state: message.state
      }
    });
    
    // Close any auth windows we might be tracking
    cleanupAuthWindows();
    
    sendResponse({ success: true });
    return true;
  }
  
  if (message.type === 'auth_callback') {
    handleAuthCallback(message.params);
    sendResponse({ success: true });
    return true;
  }
  
  // WINDOW MANAGEMENT
  if (message.type === 'open_auth_window') {
    if (message.url) {
      // Generate a unique ID for this auth window
      const windowId = Date.now().toString();
      
      // Open the auth window
      chrome.windows.create({
        url: message.url,
        type: 'popup',
        width: 500,
        height: 700
      }, (window) => {
        // Track this window
        authWindows[windowId] = {
          window,
          state: message.state,
          createdAt: Date.now()
        };
        
        console.log(`Opened auth window with ID ${windowId}`, window);
        sendResponse({ success: true, windowId });
      });
    } else {
      sendResponse({ success: false, error: 'No URL provided' });
    }
    return true; // Required for async sendResponse
  }
  
  // TOKEN MANAGEMENT
  if (message.type === 'check_auth_tokens') {
    chrome.storage.local.get([
      'eloward_riot_access_token',
      'eloward_riot_refresh_token',
      'eloward_riot_token_expiry',
      'eloward_riot_tokens',
      'riotAuth'
    ], (data) => {
      console.log('Auth token check results:', data);
      sendResponse({ data });
    });
    return true; // Required for async sendResponse
  }
  
  if (message.type === 'store_tokens') {
    if (message.tokens) {
      chrome.storage.local.set({
        'eloward_riot_access_token': message.tokens.access_token,
        'eloward_riot_refresh_token': message.tokens.refresh_token,
        'eloward_riot_token_expiry': message.tokens.expires_at || (Date.now() + (message.tokens.expires_in * 1000)),
        'eloward_riot_tokens': message.tokens,
        'riotAuth': {
          ...message.tokens,
          issued_at: Date.now()
        }
      }, () => {
        console.log('Stored auth tokens');
        sendResponse({ success: true });
      });
    } else {
      sendResponse({ success: false, error: 'No tokens provided' });
    }
    return true; // Required for async sendResponse
  }
  
  // RIOT AUTH HANDLING
  if (message.action === 'initiate_riot_auth') {
    console.log('Handling initiate_riot_auth request for region:', message.region);
    
    // Use the provided state or generate a new one for CSRF protection
    const state = message.state || Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    // Store state for verification after callback
    chrome.storage.local.set({
      'eloward_auth_state': state,
      [RiotAuth.config.storageKeys.authState]: state, // Also store using the standard key
      'selectedRegion': message.region || 'na1'
    });
    
    // Request auth URL from our backend
    const region = message.region || 'na1';
    const url = `${API_BASE_URL}/auth/init?state=${state}&region=${region}`;
    
    fetch(url)
      .then(response => {
        if (!response.ok) {
          throw new Error(`Auth URL request failed: ${response.status} ${response.statusText}`);
        }
        return response.json();
      })
      .then(data => {
        if (!data.authorizationUrl) {
          throw new Error('No authorization URL returned');
        }
        
        // Return the auth URL to the caller
        sendResponse({
          success: true,
          authUrl: data.authorizationUrl
        });
      })
      .catch(error => {
        console.error('Auth URL request error:', error);
        sendResponse({
          success: false,
          error: error.message || 'Failed to obtain authorization URL'
        });
      });
    
    return true; // Indicate async response
  }
  
  if (message.action === 'handle_auth_callback') {
    // This message comes from the callback.html page
    handleAuthCallbackFromRedirect(message.code, message.state)
      .then(result => {
        sendResponse(result);
      })
      .catch(error => {
        console.error('Error handling auth callback:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Indicate async response
  }
  
  if (message.action === 'sign_out') {
    signOutUser()
      .then(() => {
        sendResponse({ success: true });
      })
      .catch(error => {
        console.error('Error signing out:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Indicate async response
  }
  
  // USER PROFILE
  if (message.action === 'get_user_profile') {
    getUserProfile()
      .then(profile => {
        sendResponse(profile);
      })
      .catch(error => {
        console.error('Error getting user profile:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Indicate async response
  }
  
  // UI ACTIONS
  if (message.action === 'open_popup') {
    // Open the extension popup
    chrome.action.openPopup();
    sendResponse({ success: true });
    return true;
  }
  
  if (message.action === 'get_rank_icon_url') {
    const iconUrl = getRankIconUrl(message.tier);
    sendResponse({ iconUrl: iconUrl });
    return true;
  }
  
  // RANK DATA HANDLING
  if (message.action === 'get_rank_for_user') {
    // Legacy method - kept for backward compatibility
    fetchRankFromBackend(message.username, message.platform)
      .then(rankData => {
        sendResponse({ rank: rankData });
      })
      .catch(error => {
        console.error('Error fetching rank:', error);
        sendResponse({ error: error.message });
      });
    return true;
  }
  
  if (message.action === 'get_rank_for_twitch_user') {
    // New optimized method that uses Twitch username directly
    fetchRankByTwitchUsername(message.twitchUsername, message.platform)
      .then(rankData => {
        sendResponse({ rank: rankData });
      })
      .catch(error => {
        console.error('Error fetching rank by Twitch username:', error);
        sendResponse({ error: error.message });
      });
    return true;
  }
  
  // Handle rank fetch requests from content script
  if (message.action === 'fetch_rank_for_username') {
    const username = message.username;
    const channel = message.channel;
    
    // Only log occasionally to reduce console spam - reduced to 1% of requests
    if (Math.random() < 0.01) { // Only log ~1% of requests
      console.log(`Rank request: ${username} in ${channel}`);
    }
    
    // Ensure username is always lowercase for consistency
    const normalizedUsername = username.toLowerCase();
    const normalizedChannel = channel.toLowerCase();
    
    // Check if we have a cached response
    if (cachedRankResponses && cachedRankResponses[normalizedUsername]) {
      sendResponse({
        success: true,
        rankData: cachedRankResponses[normalizedUsername],
        source: 'cache'
      });
      return true; // Keep the message channel open for async response
    }
    
    // Use cached subscription status if available and valid
    // This helps avoid making subscription API calls for every username
    const checkSubscription = () => {
      // Never skip cache for rank-related subscription checks
      return checkStreamerSubscription(channel, false);
    };
    
    checkSubscription()
      .then(isSubscribed => {
        // If the channel is not subscribed, return early
        if (!isSubscribed) {
          // No need to log every failed request
          sendResponse({ 
            success: false, 
            error: 'Channel not subscribed' 
          });
          return;
        }
        
        // Get the user's selected region from storage
        chrome.storage.local.get(['selectedRegion', 'linkedAccounts'], (data) => {
          const selectedRegion = data.selectedRegion || 'na1';
          
          // Try to find a linked account for this username
          const linkedAccounts = data.linkedAccounts || {};
          
          // Check if we have this Twitch username mapped to a Riot ID
          if (linkedAccounts[normalizedUsername]) {
            const linkedAccount = linkedAccounts[normalizedUsername];
            
            // Get rank for the linked account
            fetchRankForLinkedAccount(linkedAccount, selectedRegion).then(rankData => {
              // Cache the response
              if (!cachedRankResponses) cachedRankResponses = {};
              cachedRankResponses[normalizedUsername] = rankData;
              
              sendResponse({
                success: true,
                rankData: rankData,
                source: 'linked_account'
              });
            }).catch(error => {
              // Only log occasional errors to reduce spam
              if (Math.random() < 0.1) {
                console.error(`Error fetching rank for ${normalizedUsername}:`, error);
              }
              sendResponse({
                success: false,
                error: error.message
              });
            });
          } else {
            // Only log no-linked-account messages occasionally to reduce spam
            if (Math.random() < 0.01) {
              console.log(`No linked account: ${normalizedUsername}`);
            }
            
            // No linked account found, return not found response
            sendResponse({
              success: false,
              error: 'No linked account found'
            });
          }
        });
      })
      .catch(error => {
        console.error(`Error checking subscription for ${channel}:`, error);
        sendResponse({
          success: false,
          error: 'Error checking channel subscription'
        });
      });
    
    return true; // Keep the message channel open for the async response
  }
  
  if (message.action === 'get_user_rank_by_puuid') {
    const { puuid, summonerId, region } = message;
    
    // Check if we have a valid token
    RiotAuth.getValidToken()
      .then(token => {
        // Get rank data using the League V4 API via backend
        getRankBySummonerId(token, summonerId, region)
          .then(rankData => {
            sendResponse({ rank: rankData });
          })
          .catch(error => {
            console.error('Error getting rank data:', error);
            sendResponse({ error: error.message });
          });
      })
      .catch(error => {
        console.error('Error getting valid token:', error);
        sendResponse({ error: error.message });
      });
    
    return true; // Keep the message channel open for async response
  }
  
  // SUBSCRIPTION CHECKING
  if (message.action === 'check_streamer_subscription') {
    const streamer = message.streamer;
    const skipCache = !!message.skipCache; // Default to using cache
    
    // Log only for direct check requests from content script (not rank fetches)
    if (skipCache) {
      console.log(`Received subscription check for ${streamer}${skipCache ? ' (bypass cache)' : ''}`);
    }
    
    checkStreamerSubscription(streamer, skipCache)
      .then(subscribed => {
        // Only log the response for direct checks
        if (skipCache) {
          console.log(`Sending subscription result for ${streamer}: ${subscribed ? 'ACTIVE ✅' : 'NOT ACTIVE ❌'}`);
        }
        sendResponse({ subscribed: subscribed });
      })
      .catch(error => {
        console.error('Error checking streamer subscription:', error);
        sendResponse({ subscribed: false, error: error.message });
      });
    return true;
  }
  
  // AUTH STATUS
  if (message.action === 'check_auth_status') {
    checkRiotAuthStatus()
      .then(status => {
        sendResponse(status);
      })
      .catch(error => {
        console.error('Error checking auth status:', error);
        sendResponse({ authenticated: false, error: error.message });
      });
    return true; // Indicate async response
  }
  
  // LINKED ACCOUNTS
  if (message.action === 'refresh_linked_accounts') {
    preloadLinkedAccounts();
    sendResponse({ success: true });
    return true;
  }
  
  // DEPRECATED ACTIONS
  if (message.action === 'clear_local_storage') {
    // Deprecated: This message is no longer needed as we only use chrome.storage.local
    return true;
  }
  
  // If no handlers matched, send an error response
  sendResponse({ error: 'Unknown action', action: message.action });
  return true;
});

/* Clean up old auth windows periodically */
setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes
  
  Object.keys(authWindows).forEach(id => {
    const windowData = authWindows[id];
    if (now - windowData.createdAt > maxAge) {
      console.log(`Cleaning up old auth window ${id}`);
      delete authWindows[id];
    }
  });
}, 5 * 60 * 1000); // Run every 5 minutes

// Listen for window messages (for callback.html communication)
self.addEventListener('message', (event) => {
  console.log('Background script received window message:', event.data);
  
  // Check if it's an auth callback message
  if (event.data && event.data.type === 'auth_callback') {
    handleAuthCallback(event.data.params);
  }
});

// Initialize
chrome.runtime.onInstalled.addListener((details) => {
  console.log('EloWard extension installed or updated');
  
  // Clear all stored data to force a fresh start
  clearAllStoredData();
  
  // Initialize storage
  chrome.storage.local.set({
    lastRankUpdate: 0,
    selectedRegion: 'na1' // Default region
  });
  
  // Set icon badge to show it's active
  chrome.action.setBadgeText({ text: 'ON' });
  chrome.action.setBadgeBackgroundColor({ color: '#DC2123' });
  
  // Clear badge after 5 seconds
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '' });
  }, 5000);
  
  // Initialize the linkedAccounts storage
  chrome.storage.local.get('linkedAccounts', (data) => {
    if (!data.linkedAccounts) {
      chrome.storage.local.set({ linkedAccounts: {} });
    }
  });
  
  // Load any saved configuration
  loadConfiguration();
});

// Also clear subscription cache on browser startup
chrome.runtime.onStartup.addListener(() => {
  console.log('EloWard extension starting up, clearing subscription data');
  // Reset subscription-related state
  previousSubscriptionStatus = {};
  subscriptionCache = {};
});

/**
 * Clear all stored authentication and user data
 */
function clearAllStoredData() {
  return new Promise((resolve) => {
    try {
      console.log('Clearing stored data');
      
      // Define the keys to remove from chrome.storage
      const keysToRemove = [
        // Riot auth keys
        'eloward_riot_access_token',
        'eloward_riot_refresh_token',
        'eloward_riot_token_expiry',
        'eloward_riot_tokens',
        'eloward_riot_account_info',
        'eloward_riot_summoner_info',
        'eloward_riot_rank_info',
        'eloward_auth_state',
        'eloward_riot_id_token',
        
        // Twitch auth keys
        'eloward_twitch_access_token',
        'eloward_twitch_refresh_token',
        'eloward_twitch_token_expiry',
        'eloward_twitch_tokens',
        'eloward_twitch_user_info',
        'eloward_twitch_auth_state',
        
        // Callback data
        'auth_callback',
        'eloward_auth_callback',
        'twitch_auth_callback',
        'riot_auth_callback',
        'authCallbackProcessed'
      ];
      
      // Clear from chrome.storage
      chrome.storage.local.remove(keysToRemove, () => {
        console.log('Cleared auth data');
        
        // Clear persistent storage
        PersistentStorage.clearAllData()
          .then(() => {
            console.log('Cleared persistent storage');
            
            // Initialize persistent storage to reset persistence flag
            PersistentStorage.init();
            
            resolve();
          })
          .catch(error => {
            console.error('Error clearing persistent storage:', error);
            resolve(); // Still resolve to continue cleanup
          });
      });
    } catch (error) {
      console.error('Error clearing stored data:', error);
      resolve(); // Still resolve to continue cleanup
    }
  });
}

// Helper functions

/**
 * Check if a streamer has an active subscription to the extension
 * Uses caching to reduce API calls for the same channel
 * 
 * @param {string} channelName - Twitch channel name to check
 * @param {boolean} skipCache - Whether to bypass cache and force a fresh check
 * @returns {Promise<boolean>} - Whether the streamer has an active subscription
 */
function checkStreamerSubscription(channelName, skipCache = false) {
  if (!channelName) {
    return Promise.resolve(false);
  }
  
  // Skip validation for obviously non-channel paths
  if (channelName === 'oauth2' || 
      channelName === 'oauth' || 
      channelName === 'authorize' || 
      channelName.includes('auth/callback') ||
      channelName.includes('auth/redirect')) {
    return Promise.resolve(false);
  }
  
  // Normalize the channel name to lowercase for consistency
  const normalizedName = channelName.toLowerCase();
  
  // Check if we have a valid cached result
  if (!skipCache && subscriptionCache[normalizedName]) {
    const cachedResult = subscriptionCache[normalizedName];
    // Check if the cache entry is still valid
    if (Date.now() - cachedResult.timestamp < SUBSCRIPTION_CACHE_TTL) {
      // Only log if explicitly requested to skip cache (important checks)
      if (skipCache) {
        console.log(`Using cached subscription status for ${normalizedName}: ${cachedResult.subscribed ? 'ACTIVE ✅' : 'NOT ACTIVE ❌'}`);
      }
      
      // Record this access to track active channels
      recordCacheAccess(normalizedName);
      
      return Promise.resolve(cachedResult.subscribed);
    }
  }
  
  // Only log API calls for explicit checks (not background rank fetches)
  if (skipCache) {
    console.log(`Performing subscription check API call for ${normalizedName}`);
  }
  
  // Call the subscription API to check subscription status
  return fetch(`${SUBSCRIPTION_API_URL}/subscription/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ channel_name: normalizedName })
  })
  .then(response => {
    if (!response.ok) {
      throw new Error(`Subscription API returned ${response.status}`);
    }
    return response.json();
  })
  .then(data => {
    // Get the boolean subscription status
    const isSubscribed = !!data.subscribed;
    
    // Only log the result for explicit checks
    if (skipCache) {
      console.log(`Subscription API result for ${channelName}: ${isSubscribed ? 'ACTIVE ✅' : 'NOT ACTIVE ❌'}`);
    }
    
    // Store in cache
    subscriptionCache[normalizedName] = {
      subscribed: isSubscribed,
      timestamp: Date.now(),
      lastAccessed: Date.now()
    };
    
    // Only log status changes (important diagnostic information)
    if (previousSubscriptionStatus[normalizedName] !== isSubscribed) {
      console.log(`Subscription status CHANGED for ${channelName}: ${isSubscribed ? 'Active' : 'Inactive'}`);
    }
    previousSubscriptionStatus[normalizedName] = isSubscribed;
    
    return isSubscribed;
  })
  .catch(error => {
    // Only log errors for explicit checks
    if (skipCache) {
      console.error(`Error checking subscription for ${channelName}:`, error);
      console.log(`Error in subscription check, defaulting ${channelName} to not subscribed`);
    }
    return false;
  });
}

/**
 * Fetches rank data from the backend
 * @param {string} username - The username to fetch rank for
 * @param {string} platform - The platform code
 * @returns {Promise} - Resolves with the rank data
 */
function fetchRankFromBackend(username, platform) {
  return new Promise((resolve, reject) => {
    // First, check if we have a linked account for this user
    getUserLinkedAccount(username)
      .then(linkedAccount => {
        if (linkedAccount) {
          // We have a linked account, get real rank data
          getRankForLinkedAccount(linkedAccount, platform)
            .then(resolve)
            .catch(error => {
              console.error('Error getting rank for linked account:', error);
              reject(new Error('Could not retrieve rank data for linked account'));
            });
        } else {
          // No linked account found
          reject(new Error('No linked account found'));
        }
      });
  });
}

/**
 * Gets rank data for a summoner using the League V4 API via backend
 * @param {string} token - The access token
 * @param {string} summonerId - The encrypted summoner ID
 * @param {string} platform - The platform code (e.g., 'na1')
 * @returns {Promise} - Resolves with the rank data
 */
function getRankBySummonerId(token, summonerId, platform) {
  return new Promise((resolve, reject) => {
    fetch(`${API_BASE_URL}/riot/league/entries?platform=${platform}&summonerId=${summonerId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
    .then(response => {
      if (!response.ok) {
        throw new Error(`League request failed: ${response.status} ${response.statusText}`);
      }
      return response.json();
    })
    .then(leagueEntries => {
      // Find the Solo/Duo queue entry
      const soloQueueEntry = leagueEntries.find(entry => entry.queueType === 'RANKED_SOLO_5x5');
      
      if (soloQueueEntry) {
        // Format the rank data
        const rankData = {
          tier: soloQueueEntry.tier,
          division: soloQueueEntry.rank,
          leaguePoints: soloQueueEntry.leaguePoints,
          wins: soloQueueEntry.wins,
          losses: soloQueueEntry.losses
        };
        
        resolve(rankData);
      } else {
        // No ranked data found
        resolve(null);
      }
    })
    .catch(error => {
      reject(error);
    });
  });
}

// Generate mock rank data for testing
function generateMockRankData(username, region) {
  console.log(`Background: Generating mock rank data for ${username} in ${region}`);
  
  // For MVP, we'll generate consistent mock data based on username
  // In a real implementation, this would call the Riot API
  
  // Use username to deterministically generate a rank
  const hash = Array.from(username).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  
  const tiers = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Emerald', 'Diamond', 'Master', 'Grandmaster', 'Challenger'];
  const divisions = ['IV', 'III', 'II', 'I'];
  
  // Determine tier based on hash
  let tierIndex = hash % tiers.length;
  
  // Determine division for tiers that have divisions
  let division = null;
  if (tierIndex < 7) { // Iron through Diamond have divisions
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
    losses: 50 + (hash % 150),
    summonerName: username + '_LoL' // Add a mock summoner name
  };
  
  console.log(`Background: Generated mock rank: ${rankData.tier} ${rankData.division || ''} ${rankData.leaguePoints} LP`);
  
  return rankData;
}

// Helper function to get rank icon URL
function getRankIconUrl(tier) {
  if (!tier) return chrome.runtime.getURL('images/ranks/unranked.png');
  
  // Convert tier to lowercase for case-insensitive match
  const tierLower = tier.toLowerCase();
  
  // Map of tier to icon filenames
  const tierIcons = {
    'iron': 'iron.png',
    'bronze': 'bronze.png',
    'silver': 'silver.png',
    'gold': 'gold.png',
    'platinum': 'platinum.png',
    'emerald': 'emerald.png',
    'diamond': 'diamond.png',
    'master': 'master.png',
    'grandmaster': 'grandmaster.png',
    'challenger': 'challenger.png',
    'unranked': 'unranked.png'
  };
  
  // Get the correct icon or use unranked as fallback
  const iconFile = tierIcons[tierLower] || 'unranked.png';
  
  return chrome.runtime.getURL(`images/ranks/${iconFile}`);
}

// Check if user is authenticated with Riot
async function checkRiotAuthStatus() {
  try {
    // Get auth data from storage
    const authData = await chrome.storage.local.get(['riotAuth']);
    
    // Check if auth data exists and token is not expired
    if (authData.riotAuth && authData.riotAuth.access_token) {
      const now = Date.now();
      const expiresAt = authData.riotAuth.issued_at + (authData.riotAuth.expires_in * 1000);
      
      if (now < expiresAt) {
        // Token is still valid
        return { authenticated: true };
      } else {
        // Token expired, try to refresh it
        try {
          await refreshAccessToken(authData.riotAuth.refresh_token);
          return { authenticated: true };
        } catch (error) {
          console.error('Error refreshing token:', error);
          // If refresh failed, clear auth data
          await chrome.storage.local.remove(['riotAuth']);
          return { authenticated: false, error: 'Token expired and refresh failed' };
        }
      }
    }
    
    // No auth data or no token
    return { authenticated: false };
  } catch (error) {
    console.error('Error checking auth status:', error);
    return { authenticated: false, error: error.message };
  }
}

/**
 * Initiate Riot authentication
 * @param {string} region - The region code (e.g., 'na1', 'euw1')
 * @returns {Promise<object>} - Resolves with result of auth initialization
 */
async function initiateRiotAuth(region) {
  try {
    // Generate a random state for CSRF protection
    const state = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    // Store state and region for verification after callback
    await chrome.storage.local.set({
      authState: state,
      selectedRegion: region,
      authInProgress: true // Add flag to detect when auth flow starts
    });
    
    console.log('Initiating Riot authentication for region:', region);
    
    // Request auth URL from our backend proxy
    const response = await fetch(`${API_BASE_URL}/auth/init?state=${state}&region=${region}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API Error: ${errorData.message || response.statusText}`);
    }
    
    const data = await response.json();
    
    // Open the authorization URL in a new window/tab
    console.log('Opening auth URL:', data.authorizationUrl);
    chrome.windows.create({
      url: data.authorizationUrl,
      type: 'popup',
      width: 800,
      height: 600
    }, (createdWindow) => {
      // Track this window so we can close it later if needed
      trackAuthWindow(createdWindow);
    });
    
    return { success: true };
  } catch (error) {
    console.error('Error initiating auth:', error);
    return { success: false, error: error.message };
  }
}

// Handle the authorization callback (called from callback.html)
async function handleAuthCallbackFromRedirect(code, state) {
  try {
    // Verify state parameter to prevent CSRF attacks
    let stateValid = authState && authState === state;
    
    // Log state verification status
    console.log('State verification result:', stateValid ? 'valid' : 'invalid');
    console.log('Expected state:', authState);
    console.log('Received state:', state);
    
    if (!stateValid) {
      throw new Error('Security verification failed: state parameter mismatch');
    }
    
    console.log('State validated, exchanging code for tokens');
    
    // Exchange code for tokens via our backend proxy
    const response = await fetch(`${API_BASE_URL}/auth/riot/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        code: code
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API Error: ${errorData.message || response.statusText}`);
    }
    
    const tokenData = await response.json();
    console.log('Token exchange successful');
    
    // Store the auth data in chrome.storage.local with issued timestamp
    const tokenExpiry = Date.now() + (tokenData.data.expires_in * 1000);
    
    await chrome.storage.local.set({
      // Use the standardized storage keys from the technical documentation
      eloward_riot_access_token: tokenData.data.access_token,
      eloward_riot_refresh_token: tokenData.data.refresh_token,
      eloward_riot_token_expiry: tokenExpiry,
      
      // Keep the original structure for backward compatibility
      riotAuth: {
        ...tokenData.data,
        issued_at: Date.now()
      },
      authInProgress: false // Auth flow is complete
    });
    
    // Clear the auth state since we don't need it anymore
    await chrome.storage.local.remove(['authState']);
    
    // Notify popup if it's open
    try {
      chrome.runtime.sendMessage({
        action: 'auth_completed',
        success: true
      });
    } catch (e) {
      // Popup might not be open, that's okay
      console.log('Could not notify popup of auth completion');
    }
    
    return { success: true, username: tokenData.data.user_info?.game_name };
  } catch (error) {
    console.error('Error handling auth callback:', error);
    
    // Clear the auth in progress flag
    await chrome.storage.local.set({
      authInProgress: false
    });
    
    return { success: false, error: error.message };
  }
}

// Sign out the user
async function signOutUser() {
  try {
    // Remove auth data from all storage keys
    await chrome.storage.local.remove([
      'riotAuth',
      'eloward_riot_access_token',
      'eloward_riot_refresh_token',
      'eloward_riot_token_expiry',
      'eloward_riot_account_info',
      'eloward_riot_rank_info'
    ]);
    
    // Clear tokens from storage
    chrome.storage.local.remove([
      'authState',
      'eloward_riot_access_token',
      'eloward_riot_refresh_token'
    ], function() {
      console.log('Cleared Riot auth tokens from chrome.storage');
    });
    
    return { success: true };
  } catch (error) {
    console.error('Error signing out:', error);
    return { success: false, error: error.message };
  }
}

// Get user profile and rank data
async function getUserProfile() {
  try {
    // Check if user is authenticated
    const authStatus = await checkRiotAuthStatus();
    if (!authStatus.authenticated) {
      return { success: false, error: 'User not authenticated' };
    }
    
    // Get auth data and region from storage
    const data = await chrome.storage.local.get(['riotAuth', 'selectedRegion']);
    
    if (!data.riotAuth || !data.riotAuth.access_token) {
      return { success: false, error: 'Auth data not found' };
    }
    
    const region = data.selectedRegion || 'na1';
    const accessToken = data.riotAuth.access_token;
    
    // Get account info from Riot API
    const accountInfo = await fetchRiotAccountInfo(accessToken, region);
    if (!accountInfo.success) {
      return accountInfo;
    }
    
    // Get summoner info using PUUID
    const summonerInfo = await fetchSummonerInfo(accountInfo.puuid, PLATFORM_ROUTING[region].region);
    if (!summonerInfo.success) {
      return summonerInfo;
    }
    
    // Get rank info using summoner ID
    const rankInfo = await fetchRankInfo(summonerInfo.summonerId, region);
    
    // Return combined profile data
    return {
      success: true,
      accountInfo: {
        gameName: accountInfo.gameName,
        tagLine: accountInfo.tagLine,
        puuid: accountInfo.puuid
      },
      summonerInfo: {
        id: summonerInfo.summonerId,
        name: summonerInfo.name,
        profileIconId: summonerInfo.profileIconId,
        summonerLevel: summonerInfo.summonerLevel
      },
      rankInfo: rankInfo.entries || []
    };
  } catch (error) {
    console.error('Error getting user profile:', error);
    return { success: false, error: error.message };
  }
}

// Fetch account info from Riot API using access token
async function fetchRiotAccountInfo(accessToken, region) {
  try {
    const response = await fetch(`${API_BASE_URL}/riot/account/${region}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API Error: ${errorData.message || response.statusText}`);
    }
    
    const accountData = await response.json();
    
    return {
      success: true,
      gameName: accountData.gameName,
      tagLine: accountData.tagLine,
      puuid: accountData.puuid
    };
  } catch (error) {
    console.error('Error fetching account info:', error);
    return { success: false, error: error.message };
  }
}

// Fetch summoner info from Riot API using PUUID
async function fetchSummonerInfo(puuid, region) {
  try {
    const response = await fetch(`${API_BASE_URL}/riot/summoner/${region}/${puuid}`);
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API Error: ${errorData.message || response.statusText}`);
    }
    
    const summonerData = await response.json();
    
    return {
      success: true,
      summonerId: summonerData.id,
      accountId: summonerData.accountId,
      name: summonerData.name,
      profileIconId: summonerData.profileIconId,
      summonerLevel: summonerData.summonerLevel
    };
  } catch (error) {
    console.error('Error fetching summoner info:', error);
    return { success: false, error: error.message };
  }
}

// Fetch rank info from Riot API using summoner ID
async function fetchRankInfo(summonerId, platform) {
  try {
    const response = await fetch(`${API_BASE_URL}/riot/league/${platform}/${summonerId}`);
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API Error: ${errorData.message || response.statusText}`);
    }
    
    const leagueData = await response.json();
    
    return {
      success: true,
      entries: leagueData
    };
  } catch (error) {
    console.error('Error fetching rank info:', error);
    return { success: false, error: error.message };
  }
}

// Refresh the access token using the refresh token
async function refreshAccessToken(refreshToken) {
  try {
    if (!refreshToken) {
      throw new Error('No refresh token provided');
    }
    
    // Use the Riot RSO proxy to refresh the token
    const response = await fetch(`${API_BASE_URL}/auth/riot/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        refresh_token: refreshToken
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API Error: ${errorData.message || response.statusText}`);
    }
    
    const tokenData = await response.json();
    
    // Store the refreshed auth data
    await chrome.storage.local.set({
      riotAuth: {
        ...tokenData.data,
        issued_at: Date.now()
      }
    });
    
    return true;
  } catch (error) {
    console.error('Error refreshing token:', error);
    throw error;
  }
}

// Expose functions to be called from callback.html
self.eloward = {
  handleAuthCallback,
  handleAuthCallbackFromRedirect,
  getRankIconUrl
};

/**
 * Get a user's linked account by Twitch username
 * @param {string} twitchUsername - The Twitch username to look up
 * @returns {Promise} - Resolves with the linked account or null
 */
function getUserLinkedAccount(twitchUsername) {
  return new Promise((resolve) => {
    if (!twitchUsername) {
      console.log('Empty username passed to getUserLinkedAccount');
      resolve(null);
      return;
    }
    
    const normalizedTwitchUsername = twitchUsername.toLowerCase();
    
    // Check our database of linked accounts
    chrome.storage.local.get('linkedAccounts', data => {
      const linkedAccounts = data.linkedAccounts || {};
      
      // First, try direct lookup by Twitch username (most efficient path)
      if (linkedAccounts[normalizedTwitchUsername]) {
        resolve(linkedAccounts[normalizedTwitchUsername]);
        return;
      }
      
      // If the current user is viewing their own account
      chrome.storage.local.get(['twitchUsername', 'riotAccountInfo'], currentUserData => {
        if (currentUserData.twitchUsername && 
            currentUserData.twitchUsername.toLowerCase() === normalizedTwitchUsername &&
            currentUserData.riotAccountInfo) {
          
          // Add the current user to the linkedAccounts cache if not already there
          if (!linkedAccounts[normalizedTwitchUsername]) {
            linkedAccounts[normalizedTwitchUsername] = {
              ...currentUserData.riotAccountInfo,
              twitchUsername: currentUserData.twitchUsername,
              normalizedTwitchUsername: normalizedTwitchUsername,
              linkedAt: Date.now(),
              lastUpdated: Date.now()
            };
            
            chrome.storage.local.set({ linkedAccounts });
          }
          
          resolve(currentUserData.riotAccountInfo);
        } else {
          // No case-sensitive match, try a case-insensitive scan of all accounts
          const keys = Object.keys(linkedAccounts);
          for (const key of keys) {
            const account = linkedAccounts[key];
            // Check all possible variations of the username
            if (account.twitchUsername && 
                (account.twitchUsername.toLowerCase() === normalizedTwitchUsername ||
                 (account.normalizedTwitchUsername && 
                  account.normalizedTwitchUsername === normalizedTwitchUsername))) {
              
              resolve(account);
              return;
            }
          }
          
          // No linked account found after trying all methods
          resolve(null);
        }
      });
    });
  });
}

/**
 * Get rank data for a linked account
 * @param {Object} linkedAccount - The linked account info
 * @param {string} platform - The platform code
 * @returns {Promise} - Resolves with the rank data
 */
function getRankForLinkedAccount(linkedAccount, platform) {
  return new Promise((resolve, reject) => {
    // Check if we need to fetch fresh data or if we have cached data
    if (linkedAccount.rankInfo && linkedAccount.rankUpdatedAt && 
        (Date.now() - linkedAccount.rankUpdatedAt < BADGE_REFRESH_INTERVAL)) {
      // Use cached rank data
      resolve(linkedAccount.rankInfo);
    } else {
      // Fetch fresh rank data
      chrome.storage.local.get('riotAuthToken', data => {
        if (!data.riotAuthToken) {
          reject(new Error('No Riot auth token available'));
          return;
        }
        
        getRankBySummonerId(data.riotAuthToken, linkedAccount.summonerId, platform)
          .then(rankData => {
            // Update cache
            linkedAccount.rankInfo = rankData;
            linkedAccount.rankUpdatedAt = Date.now();
            
            // Store updated data
            chrome.storage.local.get('linkedAccounts', data => {
              const linkedAccounts = data.linkedAccounts || {};
              linkedAccounts[linkedAccount.twitchUsername.toLowerCase()] = linkedAccount;
              chrome.storage.local.set({ linkedAccounts });
            });
            
            resolve(rankData);
          })
          .catch(reject);
      });
    }
  });
}

/**
 * Load the extension configuration from storage
 */
function loadConfiguration() {
  chrome.storage.local.get(['selectedRegion', 'riotAccountInfo', 'twitchUsername'], (data) => {
    // Set defaults if not set
    if (!data.selectedRegion) {
      chrome.storage.local.set({ selectedRegion: 'na1' });
    }
    
    // If the user has already linked their Riot account, add it to linkedAccounts
    if (data.riotAccountInfo && data.twitchUsername) {
      addLinkedAccount(data.twitchUsername, data.riotAccountInfo);
    }
  });
}

/**
 * Add or update a linked account in storage
 * @param {string} twitchUsername - The Twitch username
 * @param {Object} riotAccountInfo - The Riot account info
 */
function addLinkedAccount(twitchUsername, riotAccountInfo) {
  if (!twitchUsername || !riotAccountInfo) {
    console.log('EloWard: Invalid params for adding linked account');
    return;
  }
  
  const normalizedTwitchUsername = twitchUsername.toLowerCase();
  
  chrome.storage.local.get('linkedAccounts', data => {
    const linkedAccounts = data.linkedAccounts || {};
    
    // Always store using the normalized (lowercase) username as the key
    linkedAccounts[normalizedTwitchUsername] = {
      ...riotAccountInfo,
      twitchUsername, // Store the original username for display purposes
      normalizedTwitchUsername, // Store the normalized version for lookups
      linkedAt: Date.now(),
      lastUpdated: Date.now()
    };
    
    chrome.storage.local.set({ linkedAccounts }, () => {
      console.log(`EloWard: Added/updated linked account for ${twitchUsername} (normalized: ${normalizedTwitchUsername})`);
    });
  });
}

/**
 * Sync user ranks in the background periodically
 * This helps ensure that ranks are up to date even if not explicitly requested
 */
function syncUserRanks() {
  chrome.storage.local.get(['linkedAccounts', 'selectedRegion', 'eloward_persistent_twitch_user_data', 'twitchUsername'], (data) => {
    const linkedAccounts = data.linkedAccounts || {};
    const selectedRegion = data.selectedRegion || 'na1';
    const currentTwitchUsername = data.eloward_persistent_twitch_user_data?.login || data.twitchUsername;
    
    // Skip if no linked accounts
    if (Object.keys(linkedAccounts).length === 0) return;
    
    console.log('Syncing user ranks in the background');
    
    // Import RankAPI for database updates
    import('./js/rankAPI.js').then(({ RankAPI }) => {
      // Update ranks for all linked accounts
      Object.values(linkedAccounts).forEach(account => {
        // Skip if updated recently
        if (account.rankUpdatedAt && (Date.now() - account.rankUpdatedAt < BADGE_REFRESH_INTERVAL)) {
          return;
        }
        
        // Fetch fresh rank data
        if (account.summonerId) {
          chrome.storage.local.get('riotAuthToken', (data) => {
            if (!data.riotAuthToken) return;
            
            getRankBySummonerId(data.riotAuthToken, account.summonerId, selectedRegion)
              .then(rankData => {
                // Update the account with the new rank data
                account.rankInfo = rankData;
                account.rankUpdatedAt = Date.now();
                
                // Store the updated account
                chrome.storage.local.get('linkedAccounts', (data) => {
                  const linkedAccounts = data.linkedAccounts || {};
                  linkedAccounts[account.twitchUsername.toLowerCase()] = account;
                  chrome.storage.local.set({ linkedAccounts });
                  
                  // If this is the current user, also update the database
                  if (currentTwitchUsername && 
                      account.twitchUsername.toLowerCase() === currentTwitchUsername.toLowerCase() && 
                      rankData) {
                    
                    // Format rank data for upload
                    const formattedRankData = {
                      puuid: account.puuid,
                      gameName: account.gameName,
                      tagLine: account.tagLine,
                      tier: rankData.tier || 'UNRANKED',
                      rank: rankData.rank || null,
                      leaguePoints: rankData.leaguePoints || 0
                    };
                    
                    // Upload to the database
                    RankAPI.uploadRank(currentTwitchUsername, formattedRankData)
                      .then(() => console.log('Rank data successfully updated in database'))
                      .catch(error => console.error('Error updating rank in database:', error));
                  }
                });
              })
              .catch(error => {
                console.error('Error syncing rank:', error);
              });
          });
        }
      });
    }).catch(error => {
      console.error('Error importing RankAPI:', error);
    });
  });
}

// Set up periodic rank syncing
setInterval(syncUserRanks, BADGE_REFRESH_INTERVAL);

// Set up a tab listener to detect the Twitch redirect and extract auth code
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Skip if the URL didn't change or if there's no URL
  if (!changeInfo.url) return;
  
  // Check if this is our Twitch redirect URL
  if (changeInfo.url.startsWith(TWITCH_REDIRECT_URL)) {
    console.log('Detected Twitch auth redirect:', changeInfo.url.substring(0, 60) + '...');
    
    try {
      // IMMEDIATELY prevent further navigation by updating to the callback page
      chrome.tabs.update(tabId, {
        url: 'https://www.eloward.com/ext/twitch/auth/redirect'
      });
      
      // Extract parameters from the URL
      const url = new URL(changeInfo.url);
      const params = new URLSearchParams(url.search);
      const code = params.get('code');
      const state = params.get('state');
      const error = params.get('error');
      const errorDescription = params.get('error_description');
      
      if (error) {
        console.error('Twitch auth error from redirect:', error, errorDescription);
        
        // Let any listeners know about the error
        chrome.runtime.sendMessage({
          type: 'twitch_auth_error',
          error,
          errorDescription
        });
        
        // Update the callback page with error parameters
        chrome.tabs.update(tabId, {
          url: `https://www.eloward.com/ext/twitch/auth/redirect?error=${error}${errorDescription ? `&error_description=${encodeURIComponent(errorDescription)}` : ''}`
        });
        
        return;
      }
      
      if (code && state) {
        console.log('Extracted Twitch auth code and state');
        
        // Prepare the auth data
        const authData = {
          code,
          state,
          source: 'twitch_auth_callback',
          service: 'twitch',
          timestamp: new Date().toISOString()
        };
        
        // Store in chrome.storage.local
        chrome.storage.local.set({ 'eloward_auth_callback': authData });
        
        // Send a message to notify any listeners
        chrome.runtime.sendMessage({
          type: 'twitch_auth_complete',
          success: true,
          data: authData
        });
        
        // Also try with the other message format
        chrome.runtime.sendMessage({
          type: 'auth_callback',
          service: 'twitch',
          params: authData
        });
        
        // Show success on the callback page
        chrome.tabs.update(tabId, {
          url: `https://www.eloward.com/ext/twitch/auth/redirect?code=${code}&state=${state}`
        });
        
        // Let the callback page handle its own closing with countdown
      } else {
        console.warn('Missing code or state in Twitch redirect URL');
        // Show error on callback page
        chrome.tabs.update(tabId, {
          url: 'https://www.eloward.com/ext/twitch/auth/redirect?error=missing_parameters&error_description=Auth code or state parameter missing in redirect'
        });
      }
    } catch (error) {
      console.error('Error processing Twitch redirect URL:', error);
      // Show generic error on callback page
      chrome.tabs.update(tabId, {
        url: `https://www.eloward.com/ext/twitch/auth/redirect?error=processing_error&error_description=${encodeURIComponent(error.message)}`
      });
    }
  }
});

// Add message listener for extension communications
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background script received message:', request);
  
  // We've already handled these messages in the main message listener above
  // So we'll remove this duplicate handler to avoid conflicts
  return true;
});

/**
 * Fetch rank data using Twitch username directly
 * @param {string} twitchUsername - The Twitch username
 * @param {string} platform - The platform code (e.g., 'na1')
 * @returns {Promise} - Resolves with the rank data or null if not found
 */
function fetchRankByTwitchUsername(twitchUsername, platform) {
  return new Promise((resolve, reject) => {
    console.log(`Fetching rank for Twitch user: ${twitchUsername}`);
    
    // Look up the linked account by Twitch username
    getUserLinkedAccount(twitchUsername)
      .then(linkedAccount => {
        if (linkedAccount) {
          console.log(`Found linked account for ${twitchUsername}`);
          
          // We have a linked account, get real rank data
          getRankForLinkedAccount(linkedAccount, platform)
            .then(rankData => {
              console.log(`Got rank data for ${twitchUsername}`);
              resolve(rankData);
            })
            .catch(error => {
              console.error(`Error getting rank for linked account ${twitchUsername}:`, error);
              resolve(null);
            });
        } else {
          // No linked account found
          console.log(`No linked account found for Twitch user ${twitchUsername}`);
          resolve(null);
        }
      });
  });
}

function cleanupAuthWindows() {
  // Implementation of cleanupAuthWindows function
}

function trackAuthWindow(createdWindow) {
  // Implementation of trackAuthWindow function
}

// Add a function to preload and sync all linked accounts
function preloadLinkedAccounts() {
  console.log('Preloading linked accounts');
  
  // First, ensure the linkedAccounts object exists in storage
  chrome.storage.local.get('linkedAccounts', (data) => {
    const linkedAccounts = data.linkedAccounts || {};
    
    // Check if we have the current user's account info
    chrome.storage.local.get(['twitchUsername', 'riotAccountInfo'], (userData) => {
      let updated = false;
      
      // If current user has linked their account, make sure it's in the linkedAccounts
      if (userData.twitchUsername && userData.riotAccountInfo) {
        const normalizedUsername = userData.twitchUsername.toLowerCase();
        
        // Update or add current user's linked account
        if (!linkedAccounts[normalizedUsername] || 
            !linkedAccounts[normalizedUsername].summonerId) {
          
          console.log(`Adding current user's account (${userData.twitchUsername}) to linked accounts`);
          
          linkedAccounts[normalizedUsername] = {
            ...userData.riotAccountInfo,
            twitchUsername: userData.twitchUsername,
            normalizedTwitchUsername: normalizedUsername,
            linkedAt: Date.now(),
            lastUpdated: Date.now()
          };
          
          updated = true;
        }
      }
      
      // Store the updated linkedAccounts if changes were made
      if (updated) {
        chrome.storage.local.set({ linkedAccounts });
      }
      
      // Log only the count of linked accounts to reduce verbosity
      const accountCount = Object.keys(linkedAccounts).length;
      console.log(`${accountCount} linked accounts available`);
    });
  });
}

// Call preload on extension startup
preloadLinkedAccounts();

// Also call it whenever user data changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (changes.riotAccountInfo || changes.twitchUsername) {
      // Don't log every automatic update
      preloadLinkedAccounts();
    }
  }
});

// Listen for storage changes to update linked accounts
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (changes.riotAccountInfo || changes.twitchUsername) {
      // Don't log every automatic update
      preloadLinkedAccounts();
    }
  }
});

// Helper function to fetch rank for a linked account
async function fetchRankForLinkedAccount(linkedAccount, region) {
  // Only log meaningful error cases, not the routine function call
  
  if (!linkedAccount.summonerId || !linkedAccount.platform) {
    console.log('Missing summonerId or platform in linked account');
    return null;
  }
  
  try {
    // Get the user's riot access token
    const tokenData = await RiotAuth.getAccessToken();
    if (!tokenData || !tokenData.access_token) {
      console.error('No valid Riot access token');
      throw new Error('No valid Riot access token');
    }
    
    // Fetch the rank data using the access token
    const rankData = await getRankBySummonerId(
      tokenData.access_token,
      linkedAccount.summonerId,
      linkedAccount.platform || region
    );
    
    return rankData;
  } catch (error) {
    console.error('Error in fetchRankForLinkedAccount:', error);
    return null;
  }
}

// Clean up subscription cache entries that haven't been accessed recently
// This prevents the cache from growing too large with inactive channels
setInterval(() => {
  const now = Date.now();
  const UNUSED_THRESHOLD = 30 * 60 * 1000; // 30 minutes of no access
  let removedCount = 0;
  
  Object.keys(subscriptionCache).forEach(channel => {
    const entry = subscriptionCache[channel];
    // If entry hasn't been accessed recently, remove it
    if (entry.lastAccessed && now - entry.lastAccessed > UNUSED_THRESHOLD) {
      delete subscriptionCache[channel];
      removedCount++;
    }
  });
  
  // Only log if we actually removed something
  if (removedCount > 0) {
    console.log(`Removed ${removedCount} inactive subscription cache entries`);
  }
}, 15 * 60 * 1000); // Check every 15 minutes

// Add a function to periodically clean the subscription cache
setInterval(() => {
  const now = Date.now();
  let expiredCount = 0;
  
  // Check each cache entry
  Object.keys(subscriptionCache).forEach(channel => {
    const entry = subscriptionCache[channel];
    // Remove entries older than the TTL
    if (now - entry.timestamp > SUBSCRIPTION_CACHE_TTL) {
      delete subscriptionCache[channel];
      expiredCount++;
    }
  });
  
  // Only log if we actually removed something
  if (expiredCount > 0) {
    console.log(`Cleaned ${expiredCount} expired subscription cache entries`);
  }
}, SUBSCRIPTION_CACHE_TTL); // Run cleanup at the TTL interval

// Clear the rank cache periodically
setInterval(() => {
  // Reinitialize cache
  cachedRankResponses = {};
  // Only log if development logging is enabled
  console.log('Rank data cache cleared (periodic)');
}, 30 * 60 * 1000); // Every 30 minutes

// Add access timestamps to subscription cache entries
// This helps remove rarely-used channels from the cache
function recordCacheAccess(channelName) {
  if (!channelName) return;
  
  const normalizedName = channelName.toLowerCase();
  if (subscriptionCache[normalizedName]) {
    subscriptionCache[normalizedName].lastAccessed = Date.now();
  }
}

// Clean up subscription cache entries that haven't been accessed recently
// This prevents the cache from growing too large with inactive channels
setInterval(() => {
  const now = Date.now();
  const UNUSED_THRESHOLD = 30 * 60 * 1000; // 30 minutes of no access
  let removedCount = 0;
  
  Object.keys(subscriptionCache).forEach(channel => {
    const entry = subscriptionCache[channel];
    // If entry hasn't been accessed recently, remove it
    if (entry.lastAccessed && now - entry.lastAccessed > UNUSED_THRESHOLD) {
      delete subscriptionCache[channel];
      removedCount++;
    }
  });
  
  // Only log if we actually removed something
  if (removedCount > 0) {
    console.log(`Removed ${removedCount} inactive subscription cache entries`);
  }
}, 15 * 60 * 1000); // Check every 15 minutes 