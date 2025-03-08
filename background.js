// EloWard Background Service Worker
import './js/config.js';
import './js/riotAuth.js';

// Constants
const BADGE_REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutes
const API_BASE_URL = 'https://eloward-riotrso.unleashai-inquiries.workers.dev'; // Update this with your deployed worker URL
const AUTH_STATE_KEY = 'eloward_auth_state';
const AUTH_REDIRECT_URL = chrome.runtime.getURL('callback.html');

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

// Initialize
chrome.runtime.onInstalled.addListener((details) => {
  console.log('EloWard extension installed or updated', details.reason);
  
  // Initialize storage with default values if this is a fresh install
  if (details.reason === 'install') {
    chrome.storage.local.set({
      selectedRegion: 'na1', // Default region
      authState: null,
      riotAccountInfo: null,
      summonerInfo: null,
      rankInfo: null,
      lastRankUpdate: 0,
      userPreferences: {
        showBadgeInChat: true,
        allowRankLookup: true
      },
      activeStreamers: [] // Will be populated from the backend API
    });
    
    // Set icon badge to show it's active
    chrome.action.setBadgeText({ text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ color: '#DC2123' });
    
    // Clear badge after 5 seconds
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '' });
    }, 5000);
  }
  
  // Set up alarm for periodic refresh of rank data
  chrome.alarms.create('refreshRankData', {
    periodInMinutes: BADGE_REFRESH_INTERVAL / (60 * 1000) // Convert ms to minutes
  });
  
  // Set up alarm for checking active streamers
  chrome.alarms.create('refreshActiveStreamers', {
    periodInMinutes: 60 // Check once per hour
  });
});

// Handle alarms
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refreshRankData') {
    refreshCurrentUserRank();
  } else if (alarm.name === 'refreshActiveStreamers') {
    fetchActiveStreamers();
  }
});

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message);
  
  switch (message.action) {
    case 'initiate_riot_auth':
      initiateRiotAuth(message.region)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // Indicate async response
      
    case 'check_auth_status':
      checkAuthStatus()
        .then(status => sendResponse(status))
        .catch(error => sendResponse({ authenticated: false, error: error.message }));
      return true; // Indicate async response
      
    case 'get_user_profile':
      getUserProfile()
        .then(profile => sendResponse(profile))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // Indicate async response
      
    case 'sign_out':
      signOut()
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // Indicate async response
      
    case 'update_region':
      updateRegion(message.region)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // Indicate async response
      
    case 'check_streamer_subscription':
      checkStreamerSubscription(message.streamer)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ subscribed: false, error: error.message }));
      return true; // Indicate async response
      
    case 'eloward_auth_callback':
      handleAuthCallback(message.code, message.state)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // Indicate async response
  }
});

// Initiate Riot OAuth authentication
async function initiateRiotAuth(region) {
  try {
    // Generate a random state for security
    const state = Math.random().toString(36).substring(2, 15);
    
    // Store the state in local storage for verification later
    chrome.storage.local.set({ [AUTH_STATE_KEY]: state });
    
    // Request authentication URL from our proxy service
    const response = await fetch(`${API_BASE_URL}/auth/riot/init`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        region: region || 'na1',
        state: state,
        redirectUri: AUTH_REDIRECT_URL,
        scopes: 'openid offline_access lol account cpid ban profile email'
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Auth initialization failed: ${errorData.error || response.statusText}`);
    }
    
    const data = await response.json();
    
    // Open the authentication URL in a new tab
    chrome.tabs.create({ url: data.authUrl });
    
    return { success: true };
  } catch (error) {
    console.error('Riot auth initialization error:', error);
    return { success: false, error: error.message };
  }
}

// Handle the auth callback with code from Riot
async function handleAuthCallback(code, state) {
  try {
    console.log('Processing auth callback with code');
    
    // Verify the state to prevent CSRF attacks
    const storedState = await new Promise((resolve) => {
      chrome.storage.local.get([AUTH_STATE_KEY], (result) => {
        resolve(result[AUTH_STATE_KEY]);
      });
    });
    
    if (!storedState || state !== storedState) {
      throw new Error('State verification failed');
    }
    
    // Exchange the code for tokens
    const response = await fetch(`${API_BASE_URL}/auth/riot/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        code: code,
        redirectUri: AUTH_REDIRECT_URL
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Token exchange failed: ${errorData.error || response.statusText}`);
    }
    
    const tokenData = await response.json();
    
    // Store auth data
    await chrome.storage.local.set({
      authData: {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        id_token: tokenData.id_token,
        expires_at: Date.now() + (tokenData.expires_in * 1000),
        token_type: tokenData.token_type
      }
    });
    
    // Clear the state now that we've used it
    chrome.storage.local.remove(AUTH_STATE_KEY);
    
    // Fetch user account info
    await fetchUserAccountInfo();
    
    return { success: true };
  } catch (error) {
    console.error('Auth callback error:', error);
    return { success: false, error: error.message };
  }
}

// Fetch user account info from Riot API
async function fetchUserAccountInfo() {
  try {
    const authData = await getAuthData();
    
    if (!authData) {
      throw new Error('Not authenticated');
    }
    
    // Refresh token if needed
    await refreshTokenIfNeeded();
    
    // Get the fresh auth data
    const freshAuthData = await getAuthData();
    
    // Get user account info
    const response = await fetch(`${API_BASE_URL}/riot/account/me`, {
      headers: {
        'Authorization': `Bearer ${freshAuthData.access_token}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch account info: ${response.statusText}`);
    }
    
    const accountInfo = await response.json();
    
    // Store account info
    await chrome.storage.local.set({ riotAccountInfo: accountInfo });
    
    // Now fetch summoner info with the PUUID
    await fetchSummonerInfo(accountInfo.puuid);
    
    return accountInfo;
  } catch (error) {
    console.error('Error fetching user account info:', error);
    throw error;
  }
}

// Fetch summoner info using PUUID
async function fetchSummonerInfo(puuid) {
  try {
    const authData = await getAuthData();
    const { selectedRegion } = await chrome.storage.local.get('selectedRegion');
    
    if (!authData || !puuid) {
      throw new Error('Missing authentication or PUUID');
    }
    
    // Get summoner info
    const response = await fetch(`${API_BASE_URL}/riot/summoner/me?region=${selectedRegion}&puuid=${puuid}`, {
      headers: {
        'Authorization': `Bearer ${authData.access_token}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch summoner info: ${response.statusText}`);
    }
    
    const summonerInfo = await response.json();
    
    // Store summoner info
    await chrome.storage.local.set({ summonerInfo });
    
    // Now fetch rank info with summoner ID
    await fetchRankInfo(summonerInfo.id);
    
    return summonerInfo;
  } catch (error) {
    console.error('Error fetching summoner info:', error);
    throw error;
  }
}

// Fetch rank info using summoner ID
async function fetchRankInfo(summonerId) {
  try {
    const authData = await getAuthData();
    const { selectedRegion } = await chrome.storage.local.get('selectedRegion');
    
    if (!authData || !summonerId) {
      throw new Error('Missing authentication or summoner ID');
    }
    
    // Get rank info
    const response = await fetch(`${API_BASE_URL}/riot/league/entries?region=${selectedRegion}&summonerId=${summonerId}`, {
      headers: {
        'Authorization': `Bearer ${authData.access_token}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch rank info: ${response.statusText}`);
    }
    
    const rankData = await response.json();
    
    // Store rank info and update timestamp
    await chrome.storage.local.set({
      rankInfo: rankData,
      lastRankUpdate: Date.now()
    });
    
    return rankData;
  } catch (error) {
    console.error('Error fetching rank info:', error);
    throw error;
  }
}

// Helper to get auth data from storage
async function getAuthData() {
  return new Promise((resolve) => {
    chrome.storage.local.get('authData', (result) => {
      resolve(result.authData || null);
    });
  });
}

// Check if the user is authenticated
async function checkAuthStatus() {
  try {
    const authData = await getAuthData();
    
    if (!authData) {
      return { authenticated: false };
    }
    
    // Check if token is expired or about to expire (within 5 minutes)
    const isExpired = Date.now() >= (authData.expires_at - (5 * 60 * 1000));
    
    if (isExpired && authData.refresh_token) {
      try {
        // Try to refresh the token
        await refreshToken(authData.refresh_token);
        return { authenticated: true };
      } catch (error) {
        console.error('Token refresh failed:', error);
        return { authenticated: false, error: 'Token refresh failed' };
      }
    }
    
    return { authenticated: true };
  } catch (error) {
    console.error('Error checking auth status:', error);
    return { authenticated: false, error: error.message };
  }
}

// Refresh the access token if it's expired or about to expire
async function refreshTokenIfNeeded() {
  const authData = await getAuthData();
  
  if (!authData) {
    throw new Error('Not authenticated');
  }
  
  // Check if token is expired or about to expire (within 5 minutes)
  const isExpired = Date.now() >= (authData.expires_at - (5 * 60 * 1000));
  
  if (isExpired && authData.refresh_token) {
    await refreshToken(authData.refresh_token);
  }
}

// Refresh the access token using the refresh token
async function refreshToken(refreshToken) {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/riot/token/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        refresh_token: refreshToken
      })
    });
    
    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.statusText}`);
    }
    
    const tokenData = await response.json();
    
    // Update auth data with new tokens
    await chrome.storage.local.set({
      authData: {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        id_token: tokenData.id_token,
        expires_at: Date.now() + (tokenData.expires_in * 1000),
        token_type: tokenData.token_type
      }
    });
    
    return true;
  } catch (error) {
    console.error('Token refresh error:', error);
    throw error;
  }
}

// Sign out the user
async function signOut() {
  try {
    await chrome.storage.local.remove([
      'authData',
      'riotAccountInfo',
      'summonerInfo',
      'rankInfo'
    ]);
    
    return { success: true };
  } catch (error) {
    console.error('Sign out error:', error);
    return { success: false, error: error.message };
  }
}

// Get the user's profile information
async function getUserProfile() {
  try {
    const data = await chrome.storage.local.get([
      'riotAccountInfo',
      'summonerInfo',
      'rankInfo',
      'selectedRegion',
      'lastRankUpdate'
    ]);
    
    // Check if we need to refresh the rank data
    const shouldRefreshRank = !data.lastRankUpdate || 
      (Date.now() - data.lastRankUpdate) > BADGE_REFRESH_INTERVAL;
    
    if (shouldRefreshRank && data.summonerInfo) {
      try {
        await fetchRankInfo(data.summonerInfo.id);
        // Get fresh data
        const freshData = await chrome.storage.local.get(['rankInfo']);
        data.rankInfo = freshData.rankInfo;
      } catch (error) {
        console.error('Failed to refresh rank data:', error);
      }
    }
    
    return {
      success: true,
      profile: {
        account: data.riotAccountInfo,
        summoner: data.summonerInfo,
        rank: data.rankInfo,
        region: data.selectedRegion || 'na1'
      }
    };
  } catch (error) {
    console.error('Get user profile error:', error);
    return { success: false, error: error.message };
  }
}

// Update the user's selected region
async function updateRegion(region) {
  try {
    if (!region || !PLATFORM_ROUTING[region]) {
      throw new Error('Invalid region');
    }
    
    await chrome.storage.local.set({ selectedRegion: region });
    
    // Refresh user data with new region
    const authStatus = await checkAuthStatus();
    
    if (authStatus.authenticated) {
      const accountInfo = await chrome.storage.local.get('riotAccountInfo');
      
      if (accountInfo && accountInfo.riotAccountInfo) {
        await fetchSummonerInfo(accountInfo.riotAccountInfo.puuid);
      }
    }
    
    return { success: true, region };
  } catch (error) {
    console.error('Update region error:', error);
    return { success: false, error: error.message };
  }
}

// Refresh the current user's rank data
async function refreshCurrentUserRank() {
  try {
    const authStatus = await checkAuthStatus();
    
    if (!authStatus.authenticated) {
      console.log('Cannot refresh rank: User not authenticated');
      return false;
    }
    
    const data = await chrome.storage.local.get(['summonerInfo']);
    
    if (!data.summonerInfo || !data.summonerInfo.id) {
      console.log('Cannot refresh rank: Missing summoner info');
      return false;
    }
    
    await fetchRankInfo(data.summonerInfo.id);
    return true;
  } catch (error) {
    console.error('Refresh rank error:', error);
    return false;
  }
}

// Fetch the list of active streamers from the backend
async function fetchActiveStreamers() {
  try {
    const response = await fetch(`${API_BASE_URL}/streamers/active`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch active streamers: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    await chrome.storage.local.set({ 
      activeStreamers: data.streamers || [],
      lastStreamerUpdate: Date.now()
    });
    
    return data.streamers;
  } catch (error) {
    console.error('Error fetching active streamers:', error);
    
    // If we can't fetch from the backend, use a default list for testing
    const defaultStreamers = [
      'riotgames',
      'lcs',
      'lec',
      'lck',
      'faker',
      'tyler1',
      'doublelift',
      'sneaky',
      'caedrel',
      'meteos'
    ];
    
    await chrome.storage.local.set({ 
      activeStreamers: defaultStreamers,
      lastStreamerUpdate: Date.now()
    });
    
    return defaultStreamers;
  }
}

// Check if a streamer has an active subscription
async function checkStreamerSubscription(streamerName) {
  try {
    if (!streamerName) {
      return { subscribed: false };
    }
    
    // In real implementation, check with the backend API
    // For now, check against local list of active streamers
    const data = await chrome.storage.local.get(['activeStreamers']);
    const activeStreamers = data.activeStreamers || [];
    
    // Case-insensitive check
    const isSubscribed = activeStreamers.some(
      streamer => streamer.toLowerCase() === streamerName.toLowerCase()
    );
    
    return { subscribed: isSubscribed };
  } catch (error) {
    console.error('Check streamer subscription error:', error);
    return { subscribed: false, error: error.message };
  }
}

// Get the URL for a rank icon
function getRankIconUrl(tier, division) {
  if (!tier) {
    return chrome.runtime.getURL('images/ranks/unranked.png');
  }
  
  tier = tier.toLowerCase();
  
  // For master+ tiers, there's no division
  if (['master', 'grandmaster', 'challenger'].includes(tier)) {
    return chrome.runtime.getURL(`images/ranks/${tier}.png`);
  }
  
  // For other tiers, include the division
  return chrome.runtime.getURL(`images/ranks/${tier}_${division}.png`);
} 