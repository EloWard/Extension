// EloWard Riot RSO Authentication
import { EloWardConfig } from './config.js';

/**
 * Riot RSO (Riot Sign On) Authentication Module
 * This module handles the authentication flow with Riot Games API
 * using the OAuth 2.0 protocol via a secure backend proxy.
 * 
 * Note: This implementation uses the public client flow which only requires a client ID.
 */

// Safe localStorage wrapper to handle cases where localStorage is not available (service workers)
const safeStorage = {
  getItem: (key) => {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.warn('localStorage not available, falling back to chrome.storage');
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (error) {
      console.warn('localStorage not available, falling back to chrome.storage');
      return false;
    }
  },
  removeItem: (key) => {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (error) {
      console.warn('localStorage not available');
      return false;
    }
  }
};

export const RiotAuth = {
  // Riot RSO Configuration
  config: {
    // Backend proxy endpoints
    proxyBaseUrl: 'https://eloward-riotrso.unleashai-inquiries.workers.dev', // Updated to use deployed worker
    
    // Standard redirect URI
    standardRedirectUri: 'https://www.eloward.xyz/auth/redirect',
    
    // API endpoints
    endpoints: {
      // Backend proxy endpoints
      authInit: '/auth/init',
      authToken: '/auth/token',
      tokenRefresh: '/auth/token/refresh',
      accountInfo: '/riot/account/me',
      summonerInfo: '/riot/summoner/me',
      leagueEntries: '/riot/league/entries',
      userInfo: '/riot/user/info'
    },
    
    // Storage keys
    storageKeys: {
      accessToken: 'eloward_riot_access_token',
      refreshToken: 'eloward_riot_refresh_token',
      tokenExpiry: 'eloward_riot_token_expiry',
      accountInfo: 'eloward_riot_account_info',
      summonerInfo: 'eloward_riot_summoner_info',
      rankInfo: 'eloward_riot_rank_info',
      authState: 'eloward_auth_state',
      tokens: 'eloward_riot_tokens',
      userInfo: 'eloward_riot_user_info'
    }
  },
  
  // Reference to the auth window if opened
  authWindow: null,
  
  /**
   * High-level authentication method for popup.js
   * Initiates the Riot authentication flow and handles the entire process
   * @param {string} region - The Riot region (e.g., 'na1', 'euw1')
   * @returns {Promise<object>} - Resolves with user data on success
   */
  async authenticate(region) {
    try {
      console.log('Starting authentication for region:', region);
      
      // Generate a unique state
      const state = this._generateRandomState();
      
      // Store the state in both chrome.storage and localStorage for redundancy
      await this._storeAuthState(state);
      
      // Get authentication URL from backend
      const authUrl = await this._getAuthUrl(region, state);
      
      // Open the auth window
      this._openAuthWindow(authUrl);
      
      // Wait for the authentication callback
      const authResult = await this._waitForAuthCallback();
      
      if (!authResult || !authResult.code) {
        throw new Error('Authentication cancelled or failed');
      }
      
      // Verify the state parameter to prevent CSRF attacks
      if (authResult.state !== state) {
        console.error('State mismatch:', {
          received: authResult.state,
          expected: state
        });
        
        // Try fallback state check using storage
        const storedState = await this._getStoredAuthState();
        if (authResult.state !== storedState) {
          throw new Error('Security verification failed');
        }
      }
      
      // Exchange code for tokens
      await this._exchangeCodeForTokens(authResult.code);
      
      // Get user data
      const userData = await this.getUserData();
      
      return userData;
    } catch (error) {
      console.error('Authentication error:', error);
      throw error;
    }
  },
  
  /**
   * Store authentication state in both storage mechanisms
   * @param {string} state - The state to store
   * @private
   */
  async _storeAuthState(state) {
    // Store in chrome.storage.local
    await new Promise(resolve => {
      chrome.storage.local.set({
        [this.config.storageKeys.authState]: state
      }, resolve);
    });
    console.log(`Stored auth state in chrome.storage: ${state}`);
    
    // Also store in localStorage as backup
    try {
      localStorage.setItem(this.config.storageKeys.authState, state);
      console.log(`Stored auth state in localStorage: ${state}`);
    } catch (e) {
      console.error('Failed to store auth state in localStorage:', e);
    }
  },
  
  /**
   * Get stored authentication state from storage
   * @returns {Promise<string|null>} - The stored state or null if not found
   * @private
   */
  async _getStoredAuthState() {
    // Try chrome.storage.local first
    const chromeData = await new Promise(resolve => {
      chrome.storage.local.get([this.config.storageKeys.authState], resolve);
    });
    
    const chromeState = chromeData[this.config.storageKeys.authState];
    if (chromeState) {
      return chromeState;
    }
    
    // Try localStorage as fallback
    try {
      const localState = localStorage.getItem(this.config.storageKeys.authState);
      if (localState) {
        return localState;
      }
    } catch (e) {
      console.error('Error retrieving state from localStorage:', e);
    }
    
    return null;
  },
  
  /**
   * Get authentication URL from backend
   * @param {string} region - The Riot region
   * @param {string} state - The state parameter for CSRF protection
   * @returns {Promise<string>} - The authentication URL
   * @private
   */
  async _getAuthUrl(region, state) {
    try {
      const url = `${this.config.proxyBaseUrl}${this.config.endpoints.authInit}?state=${state}&region=${region}`;
      console.log('Requesting auth URL from:', url);
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to get auth URL: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (!data.authorizationUrl) {
        throw new Error('No authorization URL returned from backend');
      }
      
      console.log('Received authorization URL from backend');
      return data.authorizationUrl;
    } catch (error) {
      console.error('Error getting auth URL:', error);
      throw new Error('Failed to initialize authentication');
    }
  },
  
  /**
   * Open authentication window with given URL
   * @param {string} authUrl - The authentication URL
   * @private
   */
  _openAuthWindow(authUrl) {
    console.log('Opening auth window with URL:', authUrl);
    
    try {
      // Try to use chrome.windows API first
      chrome.runtime.sendMessage({
        type: 'open_auth_window',
        url: authUrl
      }, response => {
        if (chrome.runtime.lastError || !response || !response.success) {
          // Fallback to window.open
          this._openAuthWindowFallback(authUrl);
        }
      });
    } catch (e) {
      // Fallback to window.open
      this._openAuthWindowFallback(authUrl);
    }
  },
  
  /**
   * Fallback method to open auth window using window.open
   * @param {string} authUrl - The authentication URL
   * @private
   */
  _openAuthWindowFallback(authUrl) {
    console.log('Using window.open fallback for auth window');
    this.authWindow = window.open(authUrl, 'riotAuthWindow', 'width=500,height=700');
    
    if (!this.authWindow) {
      throw new Error('Failed to open authentication window - popup blocked?');
    }
  },
  
  /**
   * Wait for authentication callback
   * @returns {Promise<Object|null>} - The authentication result or null if cancelled
   * @private
   */
  async _waitForAuthCallback() {
    console.log('Waiting for authentication callback...');
    
    return new Promise(resolve => {
      const maxWaitTime = 300000; // 5 minutes
      const checkInterval = 1000; // 1 second
      let elapsedTime = 0;
      
      // Function to check for auth callback data
      const checkForCallback = async () => {
        // Check chrome.storage for callback data
        const data = await new Promise(r => {
          chrome.storage.local.get(['auth_callback', 'eloward_auth_callback'], r);
        });
        
        const callback = data.auth_callback || data.eloward_auth_callback;
        
        if (callback && callback.code) {
          console.log('Auth callback found in chrome.storage');
          clearInterval(intervalId);
          resolve(callback);
          return true;
        }
        
        // Check if auth window was closed by user
        if (this.authWindow && this.authWindow.closed) {
          console.log('Auth window was closed by user');
          clearInterval(intervalId);
          resolve(null); // User cancelled
          return true;
        }
        
        // Check if we've waited too long
        elapsedTime += checkInterval;
        if (elapsedTime >= maxWaitTime) {
          console.log('Auth callback wait timeout');
          clearInterval(intervalId);
          resolve(null); // Timeout
          return true;
        }
        
        return false;
      };
      
      // Check immediately first
      checkForCallback().then(found => {
        if (!found) {
          // If not found, start interval for checking
          const intervalId = setInterval(checkForCallback, checkInterval);
        }
      });
      
      // Also add a message listener for direct window messages
      const messageListener = event => {
        if (event.data && 
            ((event.data.type === 'auth_callback' && event.data.code) || 
             (event.data.source === 'eloward_auth' && event.data.code))) {
          
          console.log('Auth callback received via window message');
          window.removeEventListener('message', messageListener);
          
          // Store in chrome.storage for consistency
          chrome.storage.local.set({
            'auth_callback': event.data,
            'eloward_auth_callback': event.data
          });
          
          resolve(event.data);
        }
      };
      
      window.addEventListener('message', messageListener);
    });
  },
  
  /**
   * Exchange authorization code for tokens
   * @param {string} code - The authorization code from Riot
   * @returns {Promise<Object>} - The token data
   * @private
   */
  async _exchangeCodeForTokens(code) {
    try {
      console.log('Exchanging code for tokens...');
      
      const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.authToken}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ code })
      });
      
      if (!response.ok) {
        throw new Error(`Token exchange failed: ${response.status} ${response.statusText}`);
      }
      
      const tokenData = await response.json();
      
      if (!tokenData.data || !tokenData.data.access_token) {
        throw new Error('Invalid token data received');
      }
      
      // Store tokens
      await this._storeTokens(tokenData.data);
      
      return tokenData.data;
    } catch (error) {
      console.error('Error exchanging code for tokens:', error);
      throw new Error('Failed to exchange code for tokens');
    }
  },
  
  /**
   * Store tokens in both storage mechanisms
   * @param {Object} tokenData - The token data to store
   * @private
   */
  async _storeTokens(tokenData) {
    const tokenExpiry = Date.now() + (tokenData.expires_in * 1000);
    
    // Store in chrome.storage.local
    await new Promise(resolve => {
      chrome.storage.local.set({
        [this.config.storageKeys.accessToken]: tokenData.access_token,
        [this.config.storageKeys.refreshToken]: tokenData.refresh_token,
        [this.config.storageKeys.tokenExpiry]: tokenExpiry.toString(),
        [this.config.storageKeys.tokens]: tokenData,
        'riotAuth': { // For backward compatibility
          ...tokenData,
          issued_at: Date.now()
        }
      }, resolve);
    });
    console.log('Tokens stored in chrome.storage');
    
    // Store in localStorage as backup
    try {
      localStorage.setItem(this.config.storageKeys.accessToken, tokenData.access_token);
      localStorage.setItem(this.config.storageKeys.refreshToken, tokenData.refresh_token);
      localStorage.setItem(this.config.storageKeys.tokenExpiry, tokenExpiry.toString());
      localStorage.setItem(this.config.storageKeys.tokens, JSON.stringify(tokenData));
      console.log('Tokens stored in localStorage');
    } catch (e) {
      console.error('Failed to store tokens in localStorage:', e);
    }
  },
  
  /**
   * Check if user is authenticated
   * @returns {Promise<boolean>} - True if authenticated
   */
  async isAuthenticated() {
    try {
      await this.getValidToken();
      return true;
    } catch (error) {
      return false;
    }
  },
  
  /**
   * Get a valid access token, refreshing if necessary
   * @returns {Promise<string>} - The valid access token
   */
  async getValidToken() {
    try {
      // Try to get tokens from storage
      const accessToken = await this._getStoredValue(this.config.storageKeys.accessToken);
      const refreshToken = await this._getStoredValue(this.config.storageKeys.refreshToken);
      const tokenExpiryStr = await this._getStoredValue(this.config.storageKeys.tokenExpiry);
      
      if (!accessToken) {
        throw new Error('No access token found');
      }
      
      // Check if token is expired or will expire soon
      const tokenExpiry = tokenExpiryStr ? parseInt(tokenExpiryStr) : 0;
      const now = Date.now();
      const expiresInMs = tokenExpiry - now;
      const fiveMinutesInMs = 5 * 60 * 1000;
      
      // If token expires in less than 5 minutes, refresh it
      if (expiresInMs < fiveMinutesInMs) {
        if (!refreshToken) {
          throw new Error('Access token expired and no refresh token available');
        }
        
        // Refresh the token
        return await this.refreshToken(refreshToken);
      }
      
      // Token is valid
      return accessToken;
    } catch (error) {
      console.error('Error getting valid token:', error);
      throw new Error('No access token available. Please authenticate first.');
    }
  },
  
  /**
   * Get a value from storage, trying both chrome.storage and localStorage
   * @param {string} key - The key to get
   * @returns {Promise<string|null>} - The stored value or null
   * @private
   */
  async _getStoredValue(key) {
    // Try chrome.storage first
    const chromeData = await new Promise(resolve => {
      chrome.storage.local.get([key], resolve);
    });
    
    if (chromeData[key]) {
      return chromeData[key];
    }
    
    // Try localStorage as fallback
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.error(`Error getting ${key} from localStorage:`, e);
    }
    
    return null;
  },
  
  /**
   * Refresh the access token
   * @param {string} refreshToken - The refresh token
   * @returns {Promise<string>} - The new access token
   */
  async refreshToken(refreshToken) {
    try {
      console.log('Refreshing access token...');
      
      const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.tokenRefresh}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ refresh_token: refreshToken })
      });
      
      if (!response.ok) {
        throw new Error(`Token refresh failed: ${response.status} ${response.statusText}`);
      }
      
      const tokenData = await response.json();
      
      if (!tokenData.data || !tokenData.data.access_token) {
        throw new Error('Invalid token data received from refresh');
      }
      
      // Store the new tokens
      await this._storeTokens(tokenData.data);
      
      return tokenData.data.access_token;
    } catch (error) {
      console.error('Error refreshing token:', error);
      throw new Error('Failed to refresh access token');
    }
  },
  
  /**
   * Logout the user
   * @returns {Promise<void>}
   */
  async logout() {
    // Clear tokens from chrome.storage
    await new Promise(resolve => {
      chrome.storage.local.remove([
        this.config.storageKeys.accessToken,
        this.config.storageKeys.refreshToken,
        this.config.storageKeys.tokenExpiry,
        this.config.storageKeys.tokens,
        this.config.storageKeys.accountInfo,
        this.config.storageKeys.summonerInfo,
        this.config.storageKeys.rankInfo,
        this.config.storageKeys.authState,
        'riotAuth',
        'auth_callback',
        'eloward_auth_callback'
      ], resolve);
    });
    
    // Clear tokens from localStorage
    try {
      localStorage.removeItem(this.config.storageKeys.accessToken);
      localStorage.removeItem(this.config.storageKeys.refreshToken);
      localStorage.removeItem(this.config.storageKeys.tokenExpiry);
      localStorage.removeItem(this.config.storageKeys.tokens);
      localStorage.removeItem(this.config.storageKeys.accountInfo);
      localStorage.removeItem(this.config.storageKeys.summonerInfo);
      localStorage.removeItem(this.config.storageKeys.rankInfo);
      localStorage.removeItem(this.config.storageKeys.authState);
      localStorage.removeItem('eloward_auth_callback_data');
    } catch (e) {
      console.error('Error clearing localStorage:', e);
    }
    
    console.log('Logged out successfully');
  },
  
  /**
   * Generate a random state string for CSRF protection
   * @returns {string} - Random state string
   * @private
   */
  _generateRandomState() {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  },
  
  /**
   * Get user account info from Riot API
   * @returns {Promise<Object>} - Account info
   */
  async getAccountInfo() {
    try {
      const token = await this.getValidToken();
      const region = await this._getStoredValue('selectedRegion') || 'na1';
      
      const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.accountInfo}/${region}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to get account info: ${response.status} ${response.statusText}`);
      }
      
      const accountData = await response.json();
      
      // Store for later use
      await this._storeAccountInfo(accountData);
      
      return accountData;
    } catch (error) {
      console.error('Error fetching account info:', error);
      throw error;
    }
  },
  
  /**
   * Store account info in storage
   * @param {Object} accountInfo - Account info to store
   * @private
   */
  async _storeAccountInfo(accountInfo) {
    await new Promise(resolve => {
      chrome.storage.local.set({
        [this.config.storageKeys.accountInfo]: accountInfo
      }, resolve);
    });
    
    try {
      localStorage.setItem(this.config.storageKeys.accountInfo, JSON.stringify(accountInfo));
    } catch (e) {
      console.error('Failed to store account info in localStorage:', e);
    }
  },
  
  /**
   * Get summoner info by PUUID
   * @param {string} puuid - Player PUUID
   * @returns {Promise<Object>} - Summoner info
   */
  async getSummonerInfo(puuid) {
    try {
      const region = await this._getStoredValue('selectedRegion') || 'na1';
      const platformRegion = this._getPlatformRegion(region);
      
      if (!puuid) {
        const accountInfo = await this.getAccountInfo();
        puuid = accountInfo.puuid;
      }
      
      const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.summonerInfo}/${platformRegion}/${puuid}`);
      
      if (!response.ok) {
        throw new Error(`Failed to get summoner info: ${response.status} ${response.statusText}`);
      }
      
      const summonerData = await response.json();
      
      // Store for later use
      await this._storeSummonerInfo(summonerData);
      
      return summonerData;
    } catch (error) {
      console.error('Error fetching summoner info:', error);
      throw error;
    }
  },
  
  /**
   * Store summoner info in storage
   * @param {Object} summonerInfo - Summoner info to store
   * @private
   */
  async _storeSummonerInfo(summonerInfo) {
    await new Promise(resolve => {
      chrome.storage.local.set({
        [this.config.storageKeys.summonerInfo]: summonerInfo
      }, resolve);
    });
    
    try {
      localStorage.setItem(this.config.storageKeys.summonerInfo, JSON.stringify(summonerInfo));
    } catch (e) {
      console.error('Failed to store summoner info in localStorage:', e);
    }
  },
  
  /**
   * Get rank info by summoner ID
   * @param {string} summonerId - Encrypted summoner ID
   * @returns {Promise<Object>} - Rank info
   */
  async getRankInfo(summonerId) {
    try {
      const region = await this._getStoredValue('selectedRegion') || 'na1';
      
      if (!summonerId) {
        const summonerInfo = await this.getSummonerInfo();
        summonerId = summonerInfo.id;
      }
      
      const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.leagueEntries}/${region}/${summonerId}`);
      
      if (!response.ok) {
        throw new Error(`Failed to get rank info: ${response.status} ${response.statusText}`);
      }
      
      const leagueData = await response.json();
      
      // Find the Solo/Duo queue entry
      const soloQueueEntry = leagueData.find(entry => entry.queueType === 'RANKED_SOLO_5x5');
      
      // Store for later use
      await this._storeRankInfo(leagueData);
      
      return leagueData;
    } catch (error) {
      console.error('Error fetching rank info:', error);
      throw error;
    }
  },
  
  /**
   * Store rank info in storage
   * @param {Object} rankInfo - Rank info to store
   * @private
   */
  async _storeRankInfo(rankInfo) {
    await new Promise(resolve => {
      chrome.storage.local.set({
        [this.config.storageKeys.rankInfo]: rankInfo
      }, resolve);
    });
    
    try {
      localStorage.setItem(this.config.storageKeys.rankInfo, JSON.stringify(rankInfo));
    } catch (e) {
      console.error('Failed to store rank info in localStorage:', e);
    }
  },
  
  /**
   * Get platform region from region code
   * @param {string} region - Region code (e.g. 'na1')
   * @returns {string} - Platform region (e.g. 'americas')
   * @private
   */
  _getPlatformRegion(region) {
    const PLATFORM_ROUTING = {
      'na1': 'americas',
      'br1': 'americas',
      'la1': 'americas',
      'la2': 'americas',
      'euw1': 'europe',
      'eun1': 'europe',
      'tr1': 'europe',
      'ru': 'europe',
      'kr': 'asia',
      'jp1': 'asia',
      'oc1': 'sea',
      'ph2': 'sea',
      'sg2': 'sea',
      'th2': 'sea',
      'tw2': 'sea',
      'vn2': 'sea'
    };
    
    return PLATFORM_ROUTING[region] || 'americas';
  },
  
  /**
   * Get comprehensive user data (account, summoner, rank)
   * @returns {Promise<Object>} - User data
   */
  async getUserData() {
    try {
      console.log('Getting comprehensive user data...');
      
      if (!await this.isAuthenticated()) {
        throw new Error('Not authenticated. Please connect your Riot account first.');
      }
      
      // Get account info
      const accountInfo = await this.getAccountInfo();
      
      // Get summoner info
      const summonerInfo = await this.getSummonerInfo(accountInfo.puuid);
      
      // Get rank info
      const rankEntries = await this.getRankInfo(summonerInfo.id);
      
      // Extract the Solo/Duo queue rank
      const soloQueueEntry = rankEntries.find(entry => entry.queueType === 'RANKED_SOLO_5x5');
      
      // Format into a single user data object
      const userData = {
        gameName: accountInfo.gameName,
        tagLine: accountInfo.tagLine,
        puuid: accountInfo.puuid,
        summonerId: summonerInfo.id,
        summonerName: summonerInfo.name,
        summonerLevel: summonerInfo.summonerLevel,
        profileIconId: summonerInfo.profileIconId,
        rankInfo: soloQueueEntry ? {
          tier: soloQueueEntry.tier,
          division: soloQueueEntry.rank,
          leaguePoints: soloQueueEntry.leaguePoints,
          wins: soloQueueEntry.wins,
          losses: soloQueueEntry.losses
        } : null
      };
      
      console.log('Successfully retrieved user data:', userData);
      return userData;
    } catch (error) {
      console.error('Error getting user data:', error);
      throw error;
    }
  }
}; 