// EloWard Background Service Worker
import './js/config.js';
import { RiotAuth } from './js/riotAuth.js';

// Constants
const BADGE_REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutes
const API_BASE_URL = 'https://eloward-riotrso.unleashai-inquiries.workers.dev'; // Updated to use deployed worker
const RIOT_RSO_CLIENT_ID = '38a4b902-7186-44ac-8183-89ba1ac56cf3'; // From wrangler.toml - matches the Cloudflare Worker config

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

// Mock active streamers (would be fetched from backend in real implementation)
const ACTIVE_STREAMERS = [
  'riotgames',
  'lcs',
  'faker',
  'doublelift',
  'tyler1',
  'humzh',
  'PantsAreDragon'
];

// Define the standard redirect URI to use throughout the app
const STANDARD_REDIRECT_URI = "https://www.eloward.xyz/auth/redirect?service=riot";

/* Track any open auth windows */
let authWindows = {};

/* Handle auth callbacks */
function handleAuthCallback(params) {
  console.log('Handling auth callback in background script', params);
  
  // Determine the service type (riot or twitch)
  const serviceType = params.service || 'riot'; // Default to riot for backward compatibility
  console.log(`Handling ${serviceType} authentication callback`);
  
  // Add the auth data to chrome.storage.local under multiple keys for compatibility
  chrome.storage.local.set({
    'authCallback': params,
    'auth_callback': params,
    'eloward_auth_callback': params,
    // Add a service-specific storage key
    [`${serviceType}_auth_callback`]: params
  }, () => {
    console.log(`Stored ${serviceType} auth callback data in chrome.storage.local`);
    
    // Only initiate token exchange for Riot auth
    if (serviceType === 'riot') {
      initiateTokenExchange(params);
    } else if (serviceType === 'twitch') {
      // For Twitch auth we might want to do something different
      console.log('Twitch auth callback received, no token exchange needed in extension');
    }
  });
}

/* Initiate token exchange with Riot RSO */
async function initiateTokenExchange(authData) {
  if (!authData || !authData.code) {
    console.error('Cannot exchange tokens: Missing auth code');
    return;
  }
  
  try {
    console.log('Initiating token exchange with code');
    
    // Create RiotAuth instance
    const riotAuth = new RiotAuth({
      proxyBaseUrl: API_BASE_URL,
      clientId: RIOT_RSO_CLIENT_ID,
      redirectUri: STANDARD_REDIRECT_URI,
      storageKeys: {
        tokens: 'riotTokens',
        idToken: 'riotIdToken',
        accountInfo: 'riotAccountInfo',
        summonerInfo: 'riotSummonerInfo',
        rankInfo: 'riotRankInfo',
        authState: 'riotAuthState',
        authCallback: 'authCallback'
      }
    });
    
    // Exchange code for tokens
    const tokens = await riotAuth.exchangeCodeForTokens(authData.code);
    
    if (!tokens || !tokens.access_token) {
      throw new Error('Token exchange failed: No tokens returned');
    }
    
    console.log('Successfully exchanged code for tokens');
    
    // Fetch and store account info
    try {
      await riotAuth.getUserData();
      console.log('Successfully retrieved and stored user data');
    } catch (userDataError) {
      console.error('Error getting user data after token exchange:', userDataError);
      // Continue anyway as we at least have the tokens
    }
    
    // Notify any listeners that auth is complete
    chrome.runtime.sendMessage({
      type: 'auth_complete',
      success: true
    });
    
  } catch (error) {
    console.error('Token exchange error:', error);
    
    // Notify any listeners that auth failed
    chrome.runtime.sendMessage({
      type: 'auth_complete',
      success: false,
      error: error.message || 'Token exchange failed'
    });
  } finally {
    // Clean up the auth callback processing flag after 10 seconds
    // This allows time for other components to process the callback if needed
    setTimeout(() => {
      chrome.storage.local.remove('authCallbackProcessed', () => {
        console.log('Cleaned up auth callback processed flag');
      });
    }, 10000);
  }
}

/* Listen for messages from content scripts, popup, and other extension components */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background script received message:', message);
  
  if (message.type === 'get_auth_callback') {
    chrome.storage.local.get(['authCallback', 'auth_callback', 'eloward_auth_callback'], (data) => {
      const callback = data.authCallback || data.auth_callback || data.eloward_auth_callback;
      sendResponse({ data: callback });
      
      // Don't clear the stored callback as it may be needed by other components
    });
    return true; // Required for async sendResponse
  }
  
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
  
  if (message.type === 'auth_callback') {
    handleAuthCallback(message.params);
    sendResponse({ success: true });
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
        console.log('Stored auth tokens in background script');
        sendResponse({ success: true });
      });
    } else {
      sendResponse({ success: false, error: 'No tokens provided' });
    }
    return true; // Required for async sendResponse
  }
  
  if (message.action === 'initiate_riot_auth') {
    console.log('Background script handling initiate_riot_auth request for region:', message.region);
    
    // Use the provided state or generate a new one for CSRF protection
    const state = message.state || Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    console.log('Using auth state:', state);
    
    // Store state for verification after callback
    chrome.storage.local.set({
      'eloward_auth_state': state,
      [RiotAuth.config.storageKeys.authState]: state, // Also store using the standard key
      'selectedRegion': message.region || 'na1'
    }, () => {
      console.log('Stored auth state in background script:', state);
    });
    
    // Request auth URL from our backend
    const region = message.region || 'na1';
    const url = `${API_BASE_URL}/auth/init?state=${state}&region=${region}`;
    
    console.log('Background script requesting auth URL from:', url);
    
    fetch(url)
      .then(response => {
        if (!response.ok) {
          throw new Error(`Auth URL request failed: ${response.status} ${response.statusText}`);
        }
        return response.json();
      })
      .then(data => {
        console.log('Background script received auth URL:', data.authorizationUrl ? 'Yes (URL hidden for security)' : 'No');
        
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
        console.error('Background script auth URL request error:', error);
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
  
  if (message.action === 'get_rank_for_user') {
    // First check if we have linked account data for the current user
    getUserLinkedAccount(message.username)
      .then(linkedAccount => {
        if (linkedAccount) {
          // We have a linked account, get real rank data
          getRankForLinkedAccount(linkedAccount, message.platform)
            .then(rankData => {
              sendResponse({ rank: rankData });
            })
            .catch(error => {
              console.error('Error getting rank for linked account:', error);
              // Fallback to mock data
              generateMockRankData(message.username, message.platform, mockRank => {
                sendResponse({ rank: mockRank });
              });
            });
        } else {
          // No linked account, check if the current user has their own account linked
          chrome.storage.local.get(['riotAccountInfo', 'summonerInfo'], data => {
            if (data.riotAccountInfo && data.summonerInfo && 
                data.riotAccountInfo.gameName.toLowerCase() === message.username.toLowerCase()) {
              // This is the current user and they have a linked account
              const rankInfo = data.summonerInfo.rankInfo || { tier: 'Unranked' };
              sendResponse({ rank: rankInfo });
            } else {
              // Generate mock data for now
              generateMockRankData(message.username, message.platform, mockRank => {
                sendResponse({ rank: mockRank });
              });
            }
          });
        }
      });
    
    // Return true to indicate we'll respond asynchronously
    return true;
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
  console.log('EloWard extension installed or updated', details.reason);
  
  // Clear all stored data to force a fresh start
  clearAllStoredData();
  
  // Initialize storage
  chrome.storage.local.set({
    activeStreamers: ACTIVE_STREAMERS,
    cachedRanks: {},
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

// Function to clear all stored data
function clearAllStoredData() {
  // Clear chrome.storage.local
  chrome.storage.local.clear(() => {
    console.log('Cleared all chrome.storage.local data');
  });
  
  // Try to send a message to any open extension pages
  // This will fail silently if no receivers exist
  try {
    chrome.runtime.sendMessage({ action: 'clear_local_storage' })
      .catch(error => {
        // It's normal for this to fail if no popup is open to receive the message
        console.log('No receivers for clear_local_storage message (this is normal if popup is closed)');
      });
  } catch (error) {
    console.log('No receivers for clear_local_storage message (this is normal if popup is closed)');
  }
  
  // Note: Service workers don't have access to localStorage
  // We'll handle localStorage clearing in the popup instead
}

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message);
  
  if (message.action === 'clear_local_storage') {
    // This message is meant for extension pages with localStorage access
    // Background service worker doesn't have localStorage
    return;
  }
  
  // Handle auth callback from the redirect page
  if (message.type === 'auth_callback' && message.code) {
    console.log('Received auth callback from redirect page');
    
    // Store the auth callback result for later retrieval
    chrome.storage.local.set({
      eloward_auth_callback_result: {
        code: message.code,
        state: message.state
      }
    }, () => {
      console.log('Stored auth callback result in chrome.storage.local');
    });
    
    // Close any auth windows we might be tracking
    cleanupAuthWindows();
    authWindows.forEach(win => {
      try {
        if (win && !win.closed) win.close();
      } catch (e) {}
    });
    authWindows = {};
    
    sendResponse({ success: true });
    return true;
  }
  
  if (message.action === 'check_streamer_subscription') {
    // Check if this streamer has an active subscription
    const isSubscribed = checkStreamerSubscription(message.streamer);
    sendResponse({ subscribed: isSubscribed });
  }
  
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
  
  // If no handlers matched, send an error response
  sendResponse({ error: 'Unknown action', action: message.action });
  return true;
});

// Helper functions

/**
 * Checks if a streamer has an active subscription
 * @param {string} streamerName - The streamer's Twitch username
 * @returns {Promise<boolean>} - Resolves with subscription status
 */
function checkStreamerSubscription(streamerName) {
  return new Promise((resolve, reject) => {
    // For MVP, check against mock list
    // In production, this would call the backend API
    if (ACTIVE_STREAMERS.includes(streamerName.toLowerCase())) {
      resolve(true);
      return;
    }
    
    // Call backend API to check subscription
    // For now, just use the health endpoint since the worker doesn't have a subscription endpoint yet
    fetch(`${API_BASE_URL}/health`)
      .then(response => {
        if (!response.ok) {
          // If API fails, fall back to mock list
          return { subscribed: ACTIVE_STREAMERS.includes(streamerName.toLowerCase()) };
        }
        return { subscribed: ACTIVE_STREAMERS.includes(streamerName.toLowerCase()) };
      })
      .then(data => {
        resolve(data.subscribed);
      })
      .catch(error => {
        console.error('Error checking subscription:', error);
        // If API fails, fall back to mock list
        resolve(ACTIVE_STREAMERS.includes(streamerName.toLowerCase()));
      });
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
              // Fallback to mock data
              generateMockRankData(username, platform, resolve);
            });
        } else {
          // No linked account, generate mock data for now
          // In production, we would fetch from our database of linked accounts
          generateMockRankData(username, platform, resolve);
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
function generateMockRankData(username, region, callback) {
  // For MVP, we'll generate consistent mock data based on username
  // In a real implementation, this would call the Riot API
  
  // Use username to deterministically generate a rank
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
    callback(rankData);
  }, 300);
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
    // Verify state matches what we stored (checking both storage mechanisms)
    const storedData = await chrome.storage.local.get(['authState']);
    
    // Check chrome.storage first
    let stateValid = storedData.authState && storedData.authState === state;
    
    // If not valid, try localStorage as fallback
    if (!stateValid) {
      try {
        const localStorageState = localStorage.getItem('authState');
        stateValid = localStorageState && localStorageState === state;
      } catch (e) {
        console.warn('Could not access localStorage for state verification fallback');
      }
    }
    
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
    
    // Also try to clear from localStorage if available
    try {
      localStorage.removeItem('authState');
      localStorage.removeItem('eloward_riot_access_token');
      localStorage.removeItem('eloward_riot_refresh_token');
    } catch (e) {
      console.warn('Could not clear localStorage items');
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
 * Check if we have a linked account for a Twitch username
 * @param {string} twitchUsername - The Twitch username to look up
 * @returns {Promise} - Resolves with the linked account or null
 */
function getUserLinkedAccount(twitchUsername) {
  return new Promise((resolve) => {
    // In a production environment, this would query our backend
    // For now, we'll check local storage to see if this is the current user
    chrome.storage.local.get(['twitchUsername', 'riotAccountInfo'], data => {
      if (data.twitchUsername && 
          data.twitchUsername.toLowerCase() === twitchUsername.toLowerCase() &&
          data.riotAccountInfo) {
        resolve(data.riotAccountInfo);
      } else {
        // Check our "database" of linked accounts (would be fetched from backend in prod)
        chrome.storage.local.get('linkedAccounts', data => {
          const linkedAccounts = data.linkedAccounts || {};
          const linkedAccount = linkedAccounts[twitchUsername.toLowerCase()];
          resolve(linkedAccount || null);
        });
      }
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
 * Add a linked account to the storage
 * @param {string} twitchUsername - The Twitch username
 * @param {Object} riotAccountInfo - The Riot account info
 */
function addLinkedAccount(twitchUsername, riotAccountInfo) {
  chrome.storage.local.get('linkedAccounts', (data) => {
    const linkedAccounts = data.linkedAccounts || {};
    
    // Add or update the linked account
    linkedAccounts[twitchUsername.toLowerCase()] = {
      ...riotAccountInfo,
      twitchUsername: twitchUsername,
      linkedAt: Date.now()
    };
    
    // Store the updated linked accounts
    chrome.storage.local.set({ linkedAccounts });
    
    console.log(`Added linked account for ${twitchUsername}`);
  });
}

/**
 * Sync user ranks in the background periodically
 * This helps ensure that ranks are up to date even if not explicitly requested
 */
function syncUserRanks() {
  chrome.storage.local.get(['linkedAccounts', 'selectedRegion'], (data) => {
    const linkedAccounts = data.linkedAccounts || {};
    const selectedRegion = data.selectedRegion || 'na1';
    
    // Skip if no linked accounts
    if (Object.keys(linkedAccounts).length === 0) return;
    
    console.log('Syncing user ranks in the background');
    
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
              });
            })
            .catch(error => {
              console.error('Error syncing rank:', error);
            });
        });
      }
    });
  });
}

// Set up periodic rank syncing
setInterval(syncUserRanks, BADGE_REFRESH_INTERVAL); 