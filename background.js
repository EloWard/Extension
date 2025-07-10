// EloWard Background Service Worker
import { RiotAuth } from './js/riotAuth.js';
import { TwitchAuth } from './js/twitchAuth.js';
import { PersistentStorage } from './js/persistentStorage.js';

// Constants
const RIOT_AUTH_URL = 'https://eloward-riotauth.unleashai.workers.dev'; // Updated to use deployed worker
const RANK_WORKER_API_URL = 'https://eloward-ranks.unleashai.workers.dev'; // Rank Worker API endpoint
const STATUS_API_URL = 'https://eloward-users.unleashai.workers.dev'; // Users API worker (formerly Channel Status API)
const MAX_RANK_CACHE_SIZE = 500; // Maximum entries in the rank cache
const RANK_CACHE_EXPIRY = 60 * 60 * 1000; // Cache entries expire after 1 hour

// LFU Cache for user ranks - shared implementation with content.js
class UserRankCache {
  constructor(maxSize = MAX_RANK_CACHE_SIZE) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.currentUser = null;
    
    // Store the cache state for debugging
    this._updateStorage();
  }
  
  _updateStorage() {
    // Store a serialized version of the cache in local storage for debugging
    const cacheData = {};
    this.cache.forEach((value, key) => {
      cacheData[key] = value;
    });
    
    chrome.storage.local.set({ 'UserRankCache': cacheData });
  }
  
  // Set current user to protect from eviction
  setCurrentUser(username) {
    if (username) {
      this.currentUser = username.toLowerCase();
    }
    this._updateStorage();
  }
  
  // Get entry from cache
  get(username) {
    if (!username) return null;
    const normalizedUsername = username.toLowerCase();
    const entry = this.cache.get(normalizedUsername);
    
    if (entry) {
      // Check if entry has expired based on timestamp
      // RANK_CACHE_EXPIRY is set to 1 hour in milliseconds
      if (entry.timestamp && (Date.now() - entry.timestamp > RANK_CACHE_EXPIRY)) {
        this.cache.delete(normalizedUsername);
        this._updateStorage();
        return null;
      }
      
      // Increment frequency on access
      entry.frequency = (entry.frequency || 0) + 1;
      this._updateStorage();
      return entry.rankData;
    }
    
    return null;
  }
  
  // Add or update entry in cache
  set(username, rankData) {
    if (!username || !rankData) return;
    
    const normalizedUsername = username.toLowerCase();
    let entry = this.cache.get(normalizedUsername);
    
    if (entry) {
      // Update existing entry
      entry.rankData = rankData;
      entry.frequency = (entry.frequency || 0) + 1;
      entry.timestamp = Date.now();
    } else {
      // Add new entry
      entry = { 
        rankData, 
        frequency: 1,
        timestamp: Date.now()
      };
      this.cache.set(normalizedUsername, entry);
      
      // Check if we need to evict
      if (this.cache.size > this.maxSize) {
        this.evictLFU();
      }
    }
    
    this._updateStorage();
  }
  
  // Clear cache but preserve current user's data
  clear() {
    // Store current user's entry if exists
    const currentUserEntry = this.currentUser ? this.cache.get(this.currentUser) : null;
    const previousSize = this.cache.size;
    
    // Clear the cache
    this.cache.clear();
    
    // Restore current user's entry if it exists
    if (this.currentUser && currentUserEntry) {
      this.cache.set(this.currentUser, currentUserEntry);
      console.log(`UserRankCache: Cleared ${previousSize-1} entries, preserved user: ${this.currentUser}`);
    } else {
      console.log(`UserRankCache: Cleared all ${previousSize} entries`);
    }
    
    this._updateStorage();
  }
  
  // Evict the least frequently used entry (not current user)
  evictLFU() {
    let lowestFrequency = Infinity;
    let userToEvict = null;
    
    for (const [key, entry] of this.cache.entries()) {
      // Skip current user
      if (key === this.currentUser) {
        continue;
      }
      
      // Check for expired entries first (time-based eviction)
      // This ensures time-expired entries are removed before frequency-based eviction
      if (entry.timestamp && (Date.now() - entry.timestamp > RANK_CACHE_EXPIRY)) {
        this.cache.delete(key);
        this._updateStorage();
        return; // Successfully evicted an expired entry
      }
      
      // If no expired entries, use frequency-based eviction
      if (entry.frequency < lowestFrequency) {
        lowestFrequency = entry.frequency;
        userToEvict = key;
      }
    }
    
    // Evict if found
    if (userToEvict) {
      this.cache.delete(userToEvict);
      this._updateStorage();
    }
  }
  
  // Check if cache has a username
  has(username) {
    if (!username) return false;
    const normalizedUsername = username.toLowerCase();
    
    // Check if entry exists and is not expired
    const entry = this.cache.get(normalizedUsername);
    if (entry && entry.timestamp && (Date.now() - entry.timestamp > RANK_CACHE_EXPIRY)) {
      this.cache.delete(normalizedUsername);
      this._updateStorage();
      return false;
    }
    
    return this.cache.has(normalizedUsername);
  }
  
  // Get cache size
  get size() {
    return this.cache.size;
  }
}

// Create the global rank cache instance
const userRankCache = new UserRankCache();

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
  
  // METRICS TRACKING
  if (message.action === 'increment_db_reads' && message.channel) {
    incrementDbReadCounter(message.channel)
      .then(success => sendResponse({ success }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep the message channel open for async response
  }
  
  if (message.action === 'increment_successful_lookups' && message.channel) {
    incrementSuccessfulLookupCounter(message.channel)
      .then(success => sendResponse({ success }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep the message channel open for async response
  }
  
  // TWITCH AUTH CALLBACK HANDLING
  if (message.type === 'twitch_auth_callback' || (message.type === 'auth_callback' && message.service === 'twitch')) {
    
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
    // Also check for Twitch-specific callback
    chrome.storage.local.get(['authCallback', 'auth_callback', 'eloward_auth_callback', 'twitch_auth_callback'], (data) => {
      // Try to find the callback data in any of the possible storage keys
      const callback = data.twitch_auth_callback || data.authCallback || data.auth_callback || data.eloward_auth_callback;
      
      sendResponse({ data: callback });
    });
    return true; // Required for async sendResponse
  }
  
  if (message.type === 'auth_callback') {
    if (message.code) {
      // Auth windows are cleaned up automatically by the periodic cleanup
    } else {
      handleAuthCallback(message.params);
    }
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
        sendResponse({ success: true });
      });
    } else {
      sendResponse({ success: false, error: 'No tokens provided' });
    }
    return true; // Required for async sendResponse
  }
  
  // RIOT AUTH HANDLING
  if (message.action === 'initiate_riot_auth') {
    
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
    const url = `${RIOT_AUTH_URL}/auth/init?state=${state}&region=${region}`;
    
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
    const channelName = message.channel;
    
    if (!username) {
      sendResponse({ success: false, error: 'No username provided' });
      return true;
    }
    
    // Increment db_read counter regardless of cache hit/miss
    if (channelName) {
      incrementDbReadCounter(channelName).catch(error => {
          console.error(`Error incrementing db_read for ${channelName}:`, error);
      });
    }
    
    // Check if the rank is in our cache
    const cachedRankData = userRankCache.get(username);
    if (cachedRankData) {
      // If we got a successful result from cache, increment successful_lookups
      if (channelName && cachedRankData?.tier) {
        incrementSuccessfulLookupCounter(channelName).catch(error => {
            console.error(`Error incrementing successful_lookups for ${channelName}:`, error);
        });
      }
      
      sendResponse({
        success: true,
        rankData: cachedRankData,
        source: 'cache'
      });
      
      return true;
    }
    
    // Query the database API for the rank
    const platform = "na1"; // Default platform
    
    fetchRankByTwitchUsername(username, platform)
      .then(rankData => {
        // Store in cache 
        if (rankData) {
          userRankCache.set(username, rankData);
          
          // If we got a successful result from API, increment successful_lookups
          if (channelName && rankData?.tier) {
            incrementSuccessfulLookupCounter(channelName).catch(error => {
                console.error(`Error incrementing successful_lookups for ${channelName}:`, error);
            });
          }
        }
        
        // Send response
        sendResponse({
          success: true,
          rankData: rankData,
          source: 'api'
        });
      })
      .catch(error => {
          console.error(`Error fetching rank for ${username}:`, error);
        sendResponse({ 
          success: false, 
          error: error.message || 'Error fetching rank data' 
        });
      });
    
    return true; // Keep the message channel open for the async response
  }
  
  if (message.action === 'get_user_rank_by_puuid') {
    const { puuid, region } = message;
    
    // Check if we have a valid token
    RiotAuth.getValidToken()
      .then(token => {
        // Get rank data using the League V4 API via backend with PUUID
        getRankByPuuid(token, puuid, region)
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
  
  // CHANNEL ACTIVE CHECKING
  if (message.action === 'check_channel_active') {
    const streamer = message.streamer;
    const skipCache = !!message.skipCache; // Default to using cache
    
    checkChannelActive(streamer, skipCache)
      .then(active => {
        // Only log the response for direct checks
        if (skipCache) {
          console.log(`${streamer}: ${active ? 'ACTIVE ✅' : 'NOT ACTIVE ❌'}`);
        }
        sendResponse({ active: active });
      })
      .catch(error => {
        console.error('Error checking channel active status:', error);
        sendResponse({ active: false, error: error.message });
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
  
  // SET CURRENT USER
  if (message.action === 'set_current_user') {
    userRankCache.setCurrentUser(message.username);
    sendResponse({ success: true });
    return true;
  }
  
  // CLEAR RANK CACHE
  if (message.action === 'clear_rank_cache') {
    userRankCache.clear();
    sendResponse({ success: true });
    return true;
  }
  
  // SET RANK DATA
  if (message.action === 'set_rank_data') {
    if (message.username && message.rankData) {
      userRankCache.set(message.username, message.rankData);
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'Missing username or rank data' });
    }
    return true;
  }
  
  // CHANNEL SWITCHED
  if (message.action === 'channel_switched') {
    handleChannelSwitch(message.oldChannel, message.newChannel);
    sendResponse({ success: true });
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
      delete authWindows[id];
    }
  });
}, 5 * 60 * 1000); // Run every 5 minutes

// Listen for window messages (for callback.html communication)
self.addEventListener('message', (event) => {
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

/**
 * Clear all stored authentication and user data
 */
function clearAllStoredData() {
  return new Promise((resolve) => {
    try {
      
      // Define the keys to remove from chrome.storage
      const keysToRemove = [
        // Riot auth keys
        'eloward_riot_access_token',
        'eloward_riot_refresh_token',
        'eloward_riot_token_expiry',
        'eloward_riot_tokens',
        'eloward_riot_account_info',

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
        // Clear persistent storage
        PersistentStorage.clearAllData()
          .then(() => {
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
 * Check if a channel is active (channel_active = 1 in database)
 * Makes direct API calls without caching since this is only called when switching channels
 * 
 * @param {string} channelName - Twitch channel name to check
 * @param {boolean} skipCache - Parameter kept for backward compatibility but no longer used
 * @returns {Promise<boolean>} - Whether the channel is active
 */
function checkChannelActive(channelName, skipCache = false) {
  if (!channelName) {
    console.error('Cannot check channel status: No channel name provided');
    return Promise.resolve(false);
  }
  
  // Normalize the channel name to lowercase for consistency
  const normalizedName = channelName.toLowerCase();
  
  // Increment db_read counter for channel checks too
  incrementDbReadCounter(normalizedName).catch(error => {
    console.error(`Error incrementing db_read for ${normalizedName} during channel check:`, error);
  });
  
  // Call the channel status API to check if channel is active (channel_active = 1)
  return fetch(`${STATUS_API_URL}/channelstatus/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ channel_name: normalizedName })
  })
  .then(response => {
    if (!response.ok) {
      throw new Error(`Channel API returned ${response.status}`);
    }
    return response.json();
  })
  .then(data => {
    // Get the boolean channel active status
    const isActive = !!data.active;
    
    return isActive;
  })
  .catch(error => {
    console.error(`Error checking channel active status for ${normalizedName}:`, error);
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
 * Gets rank data for a player using the League V4 API via backend with PUUID
 * @param {string} token - The access token
 * @param {string} puuid - The player's PUUID
 * @param {string} platform - The platform code (e.g., 'na1')
 * @returns {Promise} - Resolves with the rank data
 */
function getRankByPuuid(token, puuid, platform) {
  return new Promise((resolve, reject) => {
    fetch(`${RIOT_AUTH_URL}/riot/league/entries?platform=${platform}&puuid=${puuid}`, {
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

// Helper function to get rank icon URL
function getRankIconUrl(tier) {
  if (!tier) return 'https://eloward-cdn.unleashai.workers.dev/lol/unranked.png';
  
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
  
  return `https://eloward-cdn.unleashai.workers.dev/lol/${iconFile.replace('.png', '')}.png`;
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
    const response = await fetch(`${RIOT_AUTH_URL}/auth/init?state=${state}&region=${region}`, {
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
      // Window is tracked automatically via the authWindows object in message handler
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
    // Get stored auth state for verification
    const storedData = await chrome.storage.local.get(['authState']);
    const expectedState = storedData.authState;
    
    // Verify state parameter to prevent CSRF attacks
    let stateValid = expectedState && expectedState === state;
    
    // Log state verification status
    console.log('State verification result:', stateValid ? 'valid' : 'invalid');
    console.log('Expected state:', expectedState);
    console.log('Received state:', state);
    
    if (!stateValid) {
      throw new Error('Security verification failed: state parameter mismatch');
    }
    
    console.log('State validated, exchanging code for tokens');
    
    // Exchange code for tokens via our backend proxy
    const response = await fetch(`${RIOT_AUTH_URL}/auth/riot/token`, {
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
    // Get the current Twitch username before clearing data
    const data = await chrome.storage.local.get(['twitchUsername', 'eloward_persistent_twitch_user_data']);
    const twitchUsername = data.twitchUsername || data.eloward_persistent_twitch_user_data?.login;
    
    // Remove auth data from all storage keys
    await chrome.storage.local.remove([
      'riotAuth',
      'eloward_riot_access_token',
      'eloward_riot_refresh_token',
      'eloward_riot_token_expiry',
      'eloward_riot_account_info',
      'eloward_riot_rank_info',
      'authState'
    ]);
    
    console.log('Cleared Riot auth tokens from chrome.storage');
    
    // If we have a Twitch username, also delete the League account from the database
    if (twitchUsername) {
      try {
        console.log('Deleting League account from database for:', twitchUsername);
        
        const response = await fetch(`https://eloward-ranks.unleashai.workers.dev/api/ranks/lol/${twitchUsername.toLowerCase()}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        if (response.ok) {
          console.log('Successfully deleted League account from database for:', twitchUsername);
        } else {
          console.warn('Failed to delete League account from database:', response.status, response.statusText);
        }
      } catch (dbError) {
        console.error('Error deleting League account from database:', dbError);
        // Don't fail the entire sign out process if database deletion fails
      }
    }
    
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
    
    // Get rank info using PUUID
    const rankInfo = await fetchRankInfo(accountInfo.puuid, region);
    
    // Return combined profile data
    return {
      success: true,
      accountInfo: {
        gameName: accountInfo.gameName,
        tagLine: accountInfo.tagLine,
        puuid: accountInfo.puuid
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
    const response = await fetch(`${RIOT_AUTH_URL}/riot/account/${region}`, {
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

// Fetch rank info from Riot API using PUUID
async function fetchRankInfo(puuid, platform) {
  try {
    const response = await fetch(`${RIOT_AUTH_URL}/riot/league/${platform}/${puuid}`);
    
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
    const response = await fetch(`${RIOT_AUTH_URL}/auth/riot/token/refresh`, {
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
 * Get a user's linked account by Twitch username - simplified approach
 * @param {string} twitchUsername - The Twitch username to look up
 * @returns {Promise} - Resolves with the linked account or null
 */
function getUserLinkedAccount(twitchUsername) {
  return new Promise((resolve) => {
    if (!twitchUsername) {
      resolve(null);
      return;
    }
    
    const normalizedTwitchUsername = twitchUsername.toLowerCase();
    
    // Direct lookup by normalized username (most efficient)
    chrome.storage.local.get('linkedAccounts', data => {
      const linkedAccounts = data.linkedAccounts || {};
      
      // Direct lookup first
      if (linkedAccounts[normalizedTwitchUsername]) {
        resolve(linkedAccounts[normalizedTwitchUsername]);
        return;
      }
      
      // Check persistent storage for user data (even if tokens expired)
      chrome.storage.local.get(['eloward_persistent_twitch_user_data', 'eloward_persistent_riot_user_data'], currentUserData => {
        const currentTwitchData = currentUserData.eloward_persistent_twitch_user_data;
        const currentRiotData = currentUserData.eloward_persistent_riot_user_data;
        
        // Check if this username matches our stored user data
        if (currentTwitchData?.login?.toLowerCase() === normalizedTwitchUsername && currentRiotData) {
          console.log(`Found stored user data for ${normalizedTwitchUsername} (tokens may be expired but data preserved)`);
          resolve(currentRiotData);
          return;
        }
        
        resolve(null);
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
    // Always fetch fresh rank data
    chrome.storage.local.get('riotAuthToken', data => {
      if (!data.riotAuthToken) {
        reject(new Error('No Riot auth token available'));
        return;
      }
      
      getRankByPuuid(data.riotAuthToken, linkedAccount.puuid, platform)
        .then(rankData => {
          resolve(rankData);
        })
        .catch(reject);
    });
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
      console.log(`EloWard: Added/updated linked account for ${twitchUsername}`);
    });
  });
}

/**
 * Fetches rank data directly from the database using the Rank Worker API
 * @param {string} twitchUsername - The Twitch username to look up
 * @returns {Promise<object|null>} - Resolves with rank data or null if not found
 */
async function fetchRankFromDatabase(twitchUsername) {
  if (!twitchUsername) return null;
  
  try {
    console.log(`Fetching rank from database for Twitch user: ${twitchUsername}`);
    const normalizedUsername = twitchUsername.toLowerCase();
    
    // Use the Rank Worker API to fetch the rank directly from database
    const response = await fetch(`${RANK_WORKER_API_URL}/api/ranks/lol/${normalizedUsername}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        console.log(`No rank found in database for ${twitchUsername}`);
        return null;
      }
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }
    
    const rankData = await response.json();
    
    // Convert API response format to the format expected by the content script
    // Note: rankData now includes riot_puuid from the updated schema
    return {
      tier: rankData.rank_tier,
      division: rankData.rank_division,
      leaguePoints: rankData.lp,
      summonerName: rankData.riot_id,
      puuid: rankData.riot_puuid // Include PUUID for completeness
    };
  } catch (error) {
    console.error(`Error fetching rank from database for ${twitchUsername}:`, error);
    return null;
  }
}

/**
 * Fetches rank data for a Twitch username
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
              
              // Try fetching from database as fallback
              fetchRankFromDatabase(twitchUsername)
                .then(dbRankData => {
                  if (dbRankData) {
                    console.log(`Got rank data from database for ${twitchUsername}`);
                    resolve(dbRankData);
                  } else {
                    resolve(null);
                  }
                })
                .catch(() => resolve(null));
            });
        } else {
          // No linked account found, try to fetch directly from database
          console.log(`No linked account found for Twitch user ${twitchUsername}, trying database lookup`);
          
          fetchRankFromDatabase(twitchUsername)
            .then(rankData => {
              if (rankData) {
                console.log(`Got rank data from database for ${twitchUsername}`);
                resolve(rankData);
              } else {
                console.log(`No rank data found in database for ${twitchUsername}`);
                resolve(null);
              }
            })
            .catch(() => resolve(null));
        }
      });
  });
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
            !linkedAccounts[normalizedUsername].puuid) {
          
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

// Listen for storage changes to update linked accounts
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (changes.riotAccountInfo || changes.twitchUsername) {
      // Don't log every automatic update
      preloadLinkedAccounts();
    }
  }
});



// Function to handle when users switch channels
function handleChannelSwitch(oldChannel, newChannel) {
  console.log(`Channel switched from ${oldChannel || 'unknown'} to ${newChannel}`);
  
  // Clear user rank cache when changing channels
  userRankCache.clear();
  
  console.log(`🔄 UserRankCache: Cleared on channel switch from ${oldChannel || 'unknown'} to ${newChannel} (current user preserved)`);
  
  // Remove the redundant legacy region key if it exists
  chrome.storage.local.remove('connected_region');
}

/**
 * Increments the db_read counter for a channel via the subscription API
 * @param {string} channelName - The channel name to increment the counter for
 * @returns {Promise<boolean>} - Whether the operation was successful
 */
async function incrementDbReadCounter(channelName) {
  if (!channelName) {
    console.error('Cannot increment db_read: No channel name provided');
    return false;
  }
  
  try {
    const normalizedName = channelName.toLowerCase();
    
    // Call the status API metrics endpoint
    const response = await fetch(`${STATUS_API_URL}/metrics/db_read`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ channel_name: normalizedName })
    });
    
    if (!response.ok) {
      console.error(`Error incrementing db_read for ${normalizedName}: ${response.status}`);
      return false;
    }
    
    const data = await response.json();
    return !!data.success;
  } catch (error) {
    console.error(`Failed to increment db_read for ${channelName}:`, error);
    return false;
  }
}

/**
 * Increments the successful_lookups counter for a channel via the subscription API
 * @param {string} channelName - The channel name to increment the counter for
 * @returns {Promise<boolean>} - Whether the operation was successful
 */
async function incrementSuccessfulLookupCounter(channelName) {
  if (!channelName) {
    console.error('Cannot increment successful_lookups: No channel name provided');
    return false;
  }
  
  try {
    const normalizedName = channelName.toLowerCase();
    
    // Call the status API metrics endpoint
    const response = await fetch(`${STATUS_API_URL}/metrics/successful_lookup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ channel_name: normalizedName })
    });
    
    if (!response.ok) {
      console.error(`Error incrementing successful_lookups for ${normalizedName}: ${response.status}`);
      return false;
    }
    
    const data = await response.json();
    return !!data.success;
  } catch (error) {
    console.error(`Failed to increment successful_lookups for ${channelName}:`, error);
    return false;
  }
} 