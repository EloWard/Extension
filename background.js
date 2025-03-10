// EloWard Background Service Worker
import './js/config.js';
import './js/riotAuth.js';

// Constants
const BADGE_REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutes
const API_BASE_URL = 'https://eloward-riotrso.unleashai-inquiries.workers.dev'; // Updated to use deployed worker
const RIOT_RSO_CLIENT_ID = '38a4b902-7186-44ac-8183-89ba1ac56cf3'; // From wrangler.toml

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
  'tyler1'
];

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
  
  if (message.action === 'check_streamer_subscription') {
    // In a real implementation, this would check against a backend API
    checkStreamerSubscription(message.streamer)
      .then(isSubscribed => {
        sendResponse({ subscribed: isSubscribed });
      })
      .catch(error => {
        console.error('Error checking subscription:', error);
        sendResponse({ subscribed: false, error: error.message });
      });
    return true; // Indicate async response
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
  
  if (message.action === 'initiate_riot_auth') {
    initiateRiotAuth(message.region)
      .then(result => {
        sendResponse(result);
      })
      .catch(error => {
        console.error('Error initiating auth:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Indicate async response
  }
  
  if (message.action === 'handle_auth_callback') {
    // This message comes from the callback.html page
    handleAuthCallback(message.code, message.state)
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
    // Handle requests for rank data
    const { username, platform } = message;
    
    if (!username || !platform) {
      sendResponse({ error: 'Missing username or platform' });
      return true;
    }
    
    // Check if we have a cached rank first
    chrome.storage.local.get('cachedRanks', (data) => {
      const cachedRanks = data.cachedRanks || {};
      const cacheKey = `${username.toLowerCase()}_${platform}`;
      
      if (cachedRanks[cacheKey] && 
          (Date.now() - cachedRanks[cacheKey].timestamp < BADGE_REFRESH_INTERVAL)) {
        // Use cached data if it exists and is not expired
        console.log(`Using cached rank data for ${username}`);
        sendResponse(cachedRanks[cacheKey].data);
      } else {
        // Fetch from backend or generate mock data
        fetchRankFromBackend(username, platform)
          .then(rankData => {
            // Cache the result
            cachedRanks[cacheKey] = {
              timestamp: Date.now(),
              data: rankData
            };
            chrome.storage.local.set({ cachedRanks });
            
            // Send response
            sendResponse(rankData);
          })
          .catch(error => {
            console.error('Error fetching rank:', error);
            
            // If there's an error, try to generate mock data as fallback
            generateMockRankData(username, platform, mockData => {
              sendResponse(mockData);
            });
          });
      }
    });
    
    return true; // Indicate async response
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
    // Since the worker doesn't have a direct rank fetch endpoint yet,
    // we'll use mock data for now until the user links their account
    generateMockRankData(username, platform, (rankData) => {
      resolve(rankData);
    });
    
    // In a real implementation with authenticated users, we would use:
    // fetch(`${API_BASE_URL}/riot/league/entries?platform=${platform}&summonerId=${summonerId}`, {
    //   headers: {
    //     'Authorization': `Bearer ${token}`
    //   }
    // })
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

// Initiate Riot authentication
async function initiateRiotAuth(region) {
  try {
    // Generate a random state value for security
    const state = Math.random().toString(36).substring(2, 15);
    
    // Store state and region for verification after callback
    await chrome.storage.local.set({
      authState: state,
      selectedRegion: region,
      authInProgress: true // Add flag to detect when auth flow starts
    });
    
    // Calculate the redirect URL (the extension's callback page)
    const redirectUri = chrome.runtime.getURL('callback.html');
    console.log('Using redirect URI:', redirectUri);
    
    // Request auth URL from our backend proxy
    const response = await fetch(`${API_BASE_URL}/auth/riot/init`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        redirectUri: redirectUri,
        state: state,
        scopes: 'openid offline_access lol ban cpid profile email'
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API Error: ${errorData.message || response.statusText}`);
    }
    
    const data = await response.json();
    
    // Verify the redirect URI matches what we sent
    if (data.redirectUri !== redirectUri) {
      console.warn('Warning: Redirect URI mismatch', {
        sent: redirectUri,
        received: data.redirectUri
      });
    }
    
    // Open the authorization URL in a new tab
    console.log('Opening auth URL:', data.authorizationUrl);
    chrome.tabs.create({ url: data.authorizationUrl });
    
    return { success: true };
  } catch (error) {
    console.error('Error initiating auth:', error);
    return { success: false, error: error.message };
  }
}

// Handle the authorization callback (called from callback.html)
async function handleAuthCallback(code, state) {
  try {
    // Verify state matches what we stored
    const storedData = await chrome.storage.local.get(['authState']);
    
    if (!storedData.authState || storedData.authState !== state) {
      throw new Error('Security error: State validation failed');
    }
    
    // Calculate the redirect URL (should match what we used in initiateRiotAuth)
    const redirectUri = chrome.runtime.getURL('callback.html');
    console.log('Using callback redirect URI for token exchange:', redirectUri);
    
    // Exchange code for tokens via our backend proxy
    const response = await fetch(`${API_BASE_URL}/auth/riot/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        code: code,
        redirectUri: redirectUri
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API Error: ${errorData.message || response.statusText}`);
    }
    
    const tokenData = await response.json();
    console.log('Token exchange successful');
    
    // Store the auth data in chrome.storage.local with issued timestamp
    await chrome.storage.local.set({
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
    // Remove auth data from storage
    await chrome.storage.local.remove(['riotAuth']);
    
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
window.eloward = {
  handleAuthCallback,
  getRankIconUrl
}; 