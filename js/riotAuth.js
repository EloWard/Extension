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
  
  /**
   * High-level authentication method for popup.js
   * Initiates the Riot authentication flow and handles the entire process
   * @param {string} region - The Riot region (e.g., 'na1', 'euw1')
   * @returns {Promise<object>} - Resolves with user data on success
   */
  async authenticate(region) {
    try {
      console.log('Starting authentication for region:', region);
      
      // Initialize authentication
      const authUrl = await this.initAuth(region);
      
      // Open authentication window
      await this.openAuthWindow(authUrl);
      
      // Complete authentication and get tokens
      const authData = await this.completeAuth();
      
      // Get user data using the access token
      const userData = await this.getUserData();
      
      console.log('Authentication and user data retrieval complete', userData);
      return userData;
    } catch (error) {
      console.error('Authentication error:', error);
      throw error;
    }
  },
  
  /**
   * Initializes the authentication flow
   * @param {string} region - The Riot region (e.g., 'na1', 'euw1')
   * @returns {Promise<boolean>} - Resolves with true if authentication was successful
   */
  async initAuth(region = 'na1') {
    try {
      // Generate and store a random state
      const state = this._generateRandomState();
      
      // Store state in localStorage if available
      let stateStored = false;
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(this.config.storageKeys.authState, state);
          stateStored = true;
          console.log('Stored auth state in localStorage');
        } catch (e) {
          console.error('Failed to store auth state in localStorage:', e);
        }
      }
      
      // If localStorage is not available, also store in chrome.storage
      if (!stateStored) {
        await new Promise((resolve) => {
          chrome.storage.local.set({ [this.config.storageKeys.authState]: state }, resolve);
        });
        console.log('Stored auth state in chrome.storage.local');
      }
      
      console.log('Initializing Riot RSO auth with:', {
        region,
        state,
        redirectUri: this.config.standardRedirectUri,
        extensionId: chrome.runtime.id
      });
      
      // Request authorization URL from the backend using GET with query parameters
      const url = new URL(`${this.config.proxyBaseUrl}/auth/init`);
      url.searchParams.append('state', state);
      url.searchParams.append('region', region);
      
      try {
        const response = await fetch(url.toString());
        
        if (!response.ok) {
          throw new Error(`Failed to initialize auth: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (!data.authorizationUrl) {
          throw new Error('No authorization URL returned from backend');
        }
        
        console.log('Received authorization URL from backend');
        
        // Open the authorization URL in a popup window
        await this.openAuthWindow(data.authorizationUrl);
        
        // Wait for auth callback
        console.log('Waiting for auth callback...');
        const authResult = await this.waitForAuthCallback();
        
        if (!authResult || !authResult.code) {
          throw new Error('Authentication was cancelled or failed');
        }
        
        // Complete the authentication flow
        await this.completeAuth(authResult.code, state);
        
        return true;
      } catch (error) {
        console.error('Failed to get auth URL from backend:', error);
        
        // Fallback to direct request to background script
        console.log('Attempting fallback through background script...');
        
        return new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            action: 'initiate_riot_auth',
            region: region
          }, async (response) => {
            if (!response || !response.success) {
              console.error('Background script auth initialization failed:', 
                           response?.error || 'Unknown error');
              reject(new Error(response?.error || 'Failed to initialize authentication'));
              return;
            }
            
            // Now we wait for the auth code to be received
            let codeReceived = false;
            const maxWaitTime = 120000; // 2 minutes
            const pollInterval = 1000; // 1 second
            const startTime = Date.now();
            
            while (!codeReceived && Date.now() - startTime < maxWaitTime) {
              // Check if we've received an auth code
              const result = await new Promise(r => {
                chrome.storage.local.get(['eloward_auth_callback_result'], r);
              });
              
              if (result.eloward_auth_callback_result?.code) {
                codeReceived = true;
                
                // Complete the auth flow with the received code and state
                try {
                  await this.completeAuth(
                    result.eloward_auth_callback_result.code,
                    result.eloward_auth_callback_result.state || state
                  );
                  
                  // Remove the auth result
                  chrome.storage.local.remove(['eloward_auth_callback_result']);
                  
                  resolve(true);
                } catch (error) {
                  reject(error);
                }
                break;
              }
              
              // Wait before checking again
              await new Promise(r => setTimeout(r, pollInterval));
            }
            
            if (!codeReceived) {
              reject(new Error('Timed out waiting for authentication. Please try again.'));
            }
          });
        });
      }
    } catch (error) {
      console.error('Auth initialization failed:', error);
      throw error;
    }
  },
  
  /**
   * Opens the Riot authentication window
   * @param {string} authUrl - The authentication URL
   * @returns {Promise<void>} - Resolves when the window is opened
   */
  async openAuthWindow(authUrl) {
    console.log('Opening auth window with URL:', authUrl);
    
    // Try the chrome.runtime.sendMessage approach first
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'open_auth_window',
          url: authUrl,
          state: safeStorage.getItem(this.config.storageKeys.authState)
        }, resolve);
      });
      
      if (response && response.success) {
        console.log('Auth window opened via background script');
        return;
      }
    } catch (error) {
      console.error('Error opening auth window via background script:', error);
    }
    
    // Fallback to window.open
    try {
      console.log('Using window.open fallback for auth window');
      const authWindow = window.open(authUrl, 'eloward_auth', 'width=500,height=700');
      
      if (!authWindow) {
        throw new Error('Failed to open auth window. Popup blockers enabled?');
      }
      
      // Store reference to the window
      this.authWindow = authWindow;
    } catch (error) {
      console.error('Error opening auth window:', error);
      throw new Error('Failed to open authentication window');
    }
  },
  
  /**
   * Wait for auth callback by polling various storage locations
   * @returns {Promise<Object|null>} - Resolves with the auth callback data or null if timed out
   */
  async waitForAuthCallback() {
    console.log('Waiting for auth callback...');
    
    return new Promise((resolve, reject) => {
      const maxAttempts = 120; // 2 minutes (120 * 1 second)
      let attempts = 0;
      
      // Set up polling interval
      const pollInterval = setInterval(async () => {
        attempts++;
        
        try {
          // Try to get auth callback data from chrome.storage
          const data = await new Promise(r => {
            chrome.storage.local.get(['auth_callback', 'eloward_auth_callback'], r);
          });
          
          const callback = data.auth_callback || data.eloward_auth_callback;
          
          if (callback && callback.code) {
            console.log('Auth callback data found in chrome.storage');
            clearInterval(pollInterval);
            
            // Clear the callback data
            chrome.storage.local.remove(['auth_callback', 'eloward_auth_callback']);
            
            resolve(callback);
            return;
          }
          
          // Try localStorage if available
          if (typeof localStorage !== 'undefined') {
            try {
              // Check if we have auth data in localStorage
              const storedAuthData = localStorage.getItem('eloward_auth_callback_data');
              if (storedAuthData) {
                try {
                  const authData = JSON.parse(storedAuthData);
                  console.log('Auth result found in localStorage');
                  
                  // Clear the data
                  localStorage.removeItem('eloward_auth_callback_data');
                  
                  if (authData.code) {
                    clearInterval(pollInterval);
                    resolve(authData);
                    return;
                  }
                } catch (e) {
                  console.error('Error parsing auth data from localStorage:', e);
                }
              }
            } catch (e) {
              console.error('Error accessing localStorage:', e);
            }
          }
          
          // Check if auth window is closed (user might have cancelled)
          if (this.authWindow && this.authWindow.closed) {
            console.log('Auth window was closed by user');
            clearInterval(pollInterval);
            
            // Make one final check for callback data
            const finalCheck = await new Promise(r => {
              chrome.storage.local.get(['auth_callback', 'eloward_auth_callback'], r);
            });
            
            const finalCallback = finalCheck.auth_callback || finalCheck.eloward_auth_callback;
            
            if (finalCallback && finalCallback.code) {
              resolve(finalCallback);
            } else {
              resolve(null); // Indicate cancellation
            }
            return;
          }
          
          // Give up after max attempts
          if (attempts >= maxAttempts) {
            console.log('Auth callback polling timed out after', maxAttempts, 'attempts');
            clearInterval(pollInterval);
            resolve(null); // Resolve with null instead of rejecting
          }
        } catch (error) {
          console.error('Error polling for auth callback:', error);
          // Continue polling despite errors
        }
      }, 1000);
    });
  },
  
  /**
   * Logout method for popup.js
   * Clears all authentication data
   * @returns {Promise<boolean>} - Resolves with true on success
   */
  async logout() {
    try {
      // Clear all stored tokens and user data from localStorage
      safeStorage.removeItem(this.config.storageKeys.accessToken);
      safeStorage.removeItem(this.config.storageKeys.refreshToken);
      safeStorage.removeItem(this.config.storageKeys.tokenExpiry);
      safeStorage.removeItem(this.config.storageKeys.accountInfo);
      safeStorage.removeItem(this.config.storageKeys.summonerInfo);
      safeStorage.removeItem(this.config.storageKeys.rankInfo);
      safeStorage.removeItem(this.config.storageKeys.authState);
      
      // Clear chrome.storage data
      await new Promise((resolve) => {
        chrome.storage.local.remove([
          'riotAuth',
          'userRank'
        ], resolve);
      });
      
      console.log('Logged out successfully');
      return true;
    } catch (error) {
      console.error('Logout error:', error);
      return false;
    }
  },
  
  /**
   * Completes the authentication flow after receiving the auth code
   * @param {string} code - The authorization code
   * @param {string} state - The state parameter to verify
   * @returns {Promise<void>} - Resolves once authentication is complete
   */
  async completeAuth(code, state) {
    try {
      // Verify that the state matches what we stored
      let storedState = null;
      
      // Check localStorage first
      if (typeof localStorage !== 'undefined') {
        try {
          storedState = localStorage.getItem(this.config.storageKeys.authState);
          if (storedState) {
            console.log('Retrieved auth state from localStorage');
          }
        } catch (e) {
          console.error('Failed to retrieve auth state from localStorage:', e);
        }
      }
      
      // If not found in localStorage, check chrome.storage
      if (!storedState) {
        const data = await new Promise((resolve) => {
          chrome.storage.local.get(this.config.storageKeys.authState, resolve);
        });
        storedState = data[this.config.storageKeys.authState];
        console.log('Retrieved auth state from chrome.storage.local');
      }
      
      if (state !== storedState) {
        console.error('State mismatch', { received: state, stored: storedState });
        throw new Error('State mismatch. Possible CSRF attack.');
      }
      
      console.log('Completing Riot RSO auth with:', {
        codeLength: code ? code.length : 0,
        state
      });
      
      // Exchange the code for tokens
      const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.authToken}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          code
        })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to exchange code for token: ${response.status} ${response.statusText}`);
      }
      
      const tokenData = await response.json();
      
      // Clean up the stored state
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.removeItem(this.config.storageKeys.authState);
        } catch (e) {
          console.error('Failed to remove auth state from localStorage:', e);
        }
      }
      
      // Also clean up chrome.storage
      await new Promise((resolve) => {
        chrome.storage.local.remove(this.config.storageKeys.authState, resolve);
      });
      
      // Store the tokens
      const authData = {
        ...tokenData.data,
        issuedAt: Date.now()
      };
      
      console.log('Received token data, storing tokens');
      
      // Store in localStorage if available - USING INDIVIDUAL KEYS
      let tokensStored = false;
      if (typeof localStorage !== 'undefined') {
        try {
          // Store all tokens and metadata with individual keys
          localStorage.setItem(this.config.storageKeys.accessToken, authData.access_token);
          localStorage.setItem(this.config.storageKeys.refreshToken, authData.refresh_token);
          localStorage.setItem(this.config.storageKeys.tokenExpiry, (Date.now() + (authData.expires_in * 1000)).toString());
          
          // Also store as a combined object for backward compatibility
          localStorage.setItem(this.config.storageKeys.tokens, JSON.stringify(authData));
          
          tokensStored = true;
          console.log('Stored auth tokens in localStorage');
        } catch (e) {
          console.error('Failed to store auth tokens in localStorage:', e);
        }
      }
      
      // Also store in chrome.storage with INDIVIDUAL KEYS
      await new Promise((resolve) => {
        chrome.storage.local.set({
          [this.config.storageKeys.accessToken]: authData.access_token,
          [this.config.storageKeys.refreshToken]: authData.refresh_token,
          [this.config.storageKeys.tokenExpiry]: (Date.now() + (authData.expires_in * 1000)).toString(),
          [this.config.storageKeys.tokens]: authData, // Also keep as combined object
          riotAuth: authData // For backward compatibility with other parts of the app
        }, resolve);
      });
      console.log('Stored auth tokens in chrome.storage.local');
      
      return tokenData;
    } catch (error) {
      console.error('Error completing auth:', error);
      throw error;
    }
  },
  
  /**
   * Check if the user is authenticated
   * @returns {Promise<boolean>} - Whether the user is authenticated
   */
  async isAuthenticated() {
    try {
      // Try to get from localStorage first
      let accessToken = safeStorage.getItem(this.config.storageKeys.accessToken);
      let tokenExpiry = safeStorage.getItem(this.config.storageKeys.tokenExpiry);
      
      // If not found in localStorage, try chrome.storage
      if (!accessToken || !tokenExpiry) {
        const data = await new Promise((resolve) => {
          chrome.storage.local.get([
            this.config.storageKeys.accessToken,
            this.config.storageKeys.tokenExpiry
          ], resolve);
        });
        
        if (data) {
          accessToken = data[this.config.storageKeys.accessToken];
          tokenExpiry = data[this.config.storageKeys.tokenExpiry];
          
          if (accessToken) {
            console.log('Retrieved token from chrome.storage.local for authentication check');
          }
        }
      }
      
      if (!accessToken || !tokenExpiry) {
        return false;
      }
      
      // Check if the token is expired
      const now = Date.now();
      const expiry = parseInt(tokenExpiry, 10);
      
      return now < expiry;
    } catch (error) {
      console.error('Error checking authentication status:', error);
      return false;
    }
  },
  
  /**
   * Refresh the access token if it's expired
   * @returns {Promise<boolean>} - Whether the token was refreshed successfully
   */
  async refreshTokenIfNeeded() {
    try {
      // Try to get a valid token, which will refresh if needed
      await this.getValidToken();
      return true;
    } catch (error) {
      console.error('Error refreshing token if needed:', error);
      return false;
    }
  },
  
  /**
   * Fetches the user's Riot account information
   * @returns {Promise<object>} - The account information
   */
  async fetchAccountInfo() {
    try {
      // Get a valid token
      const token = await this.getValidToken();
      
      // Call the account info endpoint
      const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.accountInfo}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch account info: ${response.status}`);
      }
      
      const accountInfo = await response.json();
      
      // Store the account info
      const infoStored = safeStorage.setItem(this.config.storageKeys.accountInfo, JSON.stringify(accountInfo));
      
      // If localStorage operation failed, store in chrome.storage
      if (!infoStored) {
        await new Promise((resolve) => {
          chrome.storage.local.set({
            [this.config.storageKeys.accountInfo]: JSON.stringify(accountInfo)
          }, resolve);
        });
        console.log('Stored account info in chrome.storage.local');
      }
      
      return accountInfo;
    } catch (error) {
      console.error('Error fetching account info:', error);
      throw error;
    }
  },
  
  /**
   * Fetch the user's summoner information
   * @param {string} puuid - The player's PUUID
   * @returns {Promise<object>} - The summoner information
   */
  async fetchSummonerInfo(puuid) {
    try {
      // Get a valid token
      const token = await this.getValidToken();
      
      // Fetch summoner information from Riot API via our backend
      const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.summonerInfo}?region=na`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch summoner info: ${response.status}`);
      }
      
      const summonerInfo = await response.json();
      
      // Store the summoner info
      const infoStored = safeStorage.setItem(this.config.storageKeys.summonerInfo, JSON.stringify(summonerInfo));
      
      // If localStorage operation failed, store in chrome.storage
      if (!infoStored) {
        await new Promise((resolve) => {
          chrome.storage.local.set({
            [this.config.storageKeys.summonerInfo]: JSON.stringify(summonerInfo)
          }, resolve);
        });
        console.log('Stored summoner info in chrome.storage.local');
      }
      
      return summonerInfo;
    } catch (error) {
      console.error('Error fetching summoner information:', error);
      throw error;
    }
  },
  
  /**
   * Fetch the user's rank information
   * @param {string} summonerId - The summoner ID
   * @returns {Promise<object>} - The rank information
   */
  async fetchRankInfo(summonerId) {
    try {
      // Get a valid token
      const token = await this.getValidToken();
      
      // Fetch rank information from Riot API via our backend
      const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.leagueEntries}?region=na&summonerId=${summonerId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch rank info: ${response.status}`);
      }
      
      const rankEntries = await response.json();
      
      // Find the solo queue rank
      const soloQueueRank = rankEntries.find(entry => entry.queueType === 'RANKED_SOLO_5x5') || null;
      
      // Store the rank info
      const infoStored = safeStorage.setItem(this.config.storageKeys.rankInfo, JSON.stringify(soloQueueRank));
      
      // If localStorage operation failed, store in chrome.storage
      if (!infoStored) {
        await new Promise((resolve) => {
          chrome.storage.local.set({
            [this.config.storageKeys.rankInfo]: JSON.stringify(soloQueueRank)
          }, resolve);
        });
        console.log('Stored rank info in chrome.storage.local');
      }
      
      return soloQueueRank;
    } catch (error) {
      console.error('Error fetching rank information:', error);
      throw error;
    }
  },
  
  /**
   * Gets the stored account information
   * @returns {Promise<object|null>} - The account information or null if not available
   */
  async getAccountInfo() {
    try {
      // Try to get from localStorage first
      let accountInfoStr = safeStorage.getItem(this.config.storageKeys.accountInfo);
      
      // If not found in localStorage, try chrome.storage
      if (!accountInfoStr) {
        const data = await new Promise((resolve) => {
          chrome.storage.local.get([this.config.storageKeys.accountInfo], resolve);
        });
        
        if (data && data[this.config.storageKeys.accountInfo]) {
          accountInfoStr = data[this.config.storageKeys.accountInfo];
          console.log('Retrieved account info from chrome.storage.local');
        }
      }
      
      return accountInfoStr ? JSON.parse(accountInfoStr) : null;
    } catch (error) {
      console.error('Error getting account info:', error);
      return null;
    }
  },
  
  /**
   * Gets the stored summoner information
   * @returns {Promise<object|null>} - The summoner information or null if not available
   */
  async getSummonerInfo() {
    try {
      // Try to get from localStorage first
      let summonerInfoStr = safeStorage.getItem(this.config.storageKeys.summonerInfo);
      
      // If not found in localStorage, try chrome.storage
      if (!summonerInfoStr) {
        const data = await new Promise((resolve) => {
          chrome.storage.local.get([this.config.storageKeys.summonerInfo], resolve);
        });
        
        if (data && data[this.config.storageKeys.summonerInfo]) {
          summonerInfoStr = data[this.config.storageKeys.summonerInfo];
          console.log('Retrieved summoner info from chrome.storage.local');
        }
      }
      
      return summonerInfoStr ? JSON.parse(summonerInfoStr) : null;
    } catch (error) {
      console.error('Error getting summoner info:', error);
      return null;
    }
  },
  
  /**
   * Gets the stored rank information
   * @returns {Promise<object|null>} - The rank information or null if not available
   */
  async getRankInfo() {
    try {
      // Try to get from localStorage first
      let rankInfoStr = safeStorage.getItem(this.config.storageKeys.rankInfo);
      
      // If not found in localStorage, try chrome.storage
      if (!rankInfoStr) {
        const data = await new Promise((resolve) => {
          chrome.storage.local.get([this.config.storageKeys.rankInfo], resolve);
        });
        
        if (data && data[this.config.storageKeys.rankInfo]) {
          rankInfoStr = data[this.config.storageKeys.rankInfo];
          console.log('Retrieved rank info from chrome.storage.local');
        }
      }
      
      return rankInfoStr ? JSON.parse(rankInfoStr) : null;
    } catch (error) {
      console.error('Error getting rank info:', error);
      return null;
    }
  },
  
  /**
   * Sign out the user (alias for logout)
   * @returns {Promise<boolean>} - Resolves with true on success
   */
  async signOut() {
    return await this.logout();
  },
  
  /**
   * Generate a random state string for CSRF protection
   * @returns {string} - A random string
   * @private
   */
  _generateRandomState() {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  },
  
  /**
   * Gets a valid access token, refreshing if necessary
   * @returns {Promise<string>} - The access token
   */
  async getValidToken() {
    try {
      console.log('Getting valid access token');
      
      // Check if we have a token in individual keys
      let accessToken = safeStorage.getItem(this.config.storageKeys.accessToken);
      let tokenExpiry = safeStorage.getItem(this.config.storageKeys.tokenExpiry);
      let refreshToken = safeStorage.getItem(this.config.storageKeys.refreshToken);
      
      // If not found, try to get from combined token object in localStorage
      if (!accessToken) {
        const tokensStr = safeStorage.getItem(this.config.storageKeys.tokens);
        if (tokensStr) {
          try {
            const tokens = JSON.parse(tokensStr);
            accessToken = tokens.access_token;
            refreshToken = tokens.refresh_token;
            
            // Calculate expiry if not already set
            if (!tokenExpiry && tokens.expires_in && tokens.issuedAt) {
              tokenExpiry = (tokens.issuedAt + (tokens.expires_in * 1000)).toString();
            }
            
            console.log('Retrieved tokens from combined tokens object in localStorage');
          } catch (e) {
            console.error('Error parsing tokens from localStorage:', e);
          }
        }
      }
      
      // If still not found in localStorage, try chrome.storage
      if (!accessToken || !tokenExpiry) {
        console.log('Tokens not found in localStorage, checking chrome.storage');
        
        // First try individual keys
        const data = await new Promise(r => {
          chrome.storage.local.get([
            this.config.storageKeys.accessToken,
            this.config.storageKeys.tokenExpiry,
            this.config.storageKeys.refreshToken
          ], r);
        });
        
        accessToken = data[this.config.storageKeys.accessToken];
        tokenExpiry = data[this.config.storageKeys.tokenExpiry];
        refreshToken = data[this.config.storageKeys.refreshToken];
        
        if (accessToken) {
          console.log('Retrieved tokens from individual keys in chrome.storage');
        } else {
          // Then try combined objects
          const tokenData = await new Promise(r => {
            chrome.storage.local.get([
              this.config.storageKeys.tokens,
              'riotAuth'  // Also check legacy key
            ], r);
          });
          
          // Try from tokens object
          if (tokenData[this.config.storageKeys.tokens]) {
            const tokens = tokenData[this.config.storageKeys.tokens];
            accessToken = tokens.access_token;
            refreshToken = tokens.refresh_token;
            
            // Calculate expiry if not set
            if (!tokenExpiry && tokens.expires_in && tokens.issuedAt) {
              tokenExpiry = (tokens.issuedAt + (tokens.expires_in * 1000)).toString();
            }
            
            console.log('Retrieved tokens from combined tokens object in chrome.storage');
          } 
          // Try from riotAuth object (backward compatibility)
          else if (tokenData.riotAuth) {
            const tokens = tokenData.riotAuth;
            accessToken = tokens.access_token;
            refreshToken = tokens.refresh_token;
            
            // Calculate expiry if not set
            if (!tokenExpiry && tokens.expires_in && tokens.issued_at) {
              tokenExpiry = (tokens.issued_at + (tokens.expires_in * 1000)).toString();
            }
            
            console.log('Retrieved tokens from riotAuth object in chrome.storage');
          }
        }
      }
      
      if (!accessToken) {
        throw new Error('No access token found. Please authenticate first.');
      }
      
      // Check if token is expired
      const now = Date.now();
      const expiryTime = parseInt(tokenExpiry, 10) || 0;
      
      console.log('Token expiry check:', {
        now,
        expiryTime,
        diff: expiryTime - now,
        isExpired: now >= expiryTime - 5 * 60 * 1000
      });
      
      // If token is expired or will expire in the next 5 minutes, refresh it
      if (now >= expiryTime - 5 * 60 * 1000) {
        console.log('Token expired or will expire soon. Refreshing...');
        if (!refreshToken) {
          throw new Error('No refresh token available. Please authenticate again.');
        }
        return await this.refreshToken(refreshToken);
      }
      
      return accessToken;
    } catch (error) {
      console.error('Error getting valid token:', error);
      throw error;
    }
  },
  
  /**
   * Refreshes the access token using the refresh token
   * @param {string} [refreshTokenParam] - The refresh token to use (optional, will look up if not provided)
   * @returns {Promise<string>} - The new access token
   */
  async refreshToken(refreshTokenParam) {
    try {
      // Use provided refresh token or look it up
      let refreshToken = refreshTokenParam;
      
      if (!refreshToken) {
        // Get the refresh token if not provided as param
        refreshToken = safeStorage.getItem(this.config.storageKeys.refreshToken);
        
        // If not found in localStorage, try to find in chrome.storage
        if (!refreshToken) {
          // Try to get from individual keys
          const data = await new Promise(r => {
            chrome.storage.local.get([this.config.storageKeys.refreshToken], r);
          });
          
          refreshToken = data[this.config.storageKeys.refreshToken];
          
          // If still not found, try from combined objects
          if (!refreshToken) {
            // Try from tokens object
            const tokenData = await new Promise(r => {
              chrome.storage.local.get([
                this.config.storageKeys.tokens,
                'riotAuth'  // Also check legacy key
              ], r);
            });
            
            if (tokenData[this.config.storageKeys.tokens]) {
              refreshToken = tokenData[this.config.storageKeys.tokens].refresh_token;
            } else if (tokenData.riotAuth) {
              refreshToken = tokenData.riotAuth.refresh_token;
            }
          }
        }
      }
      
      if (!refreshToken) {
        throw new Error('No refresh token found. Please authenticate first.');
      }
      
      console.log('Refreshing token using refresh token');
      
      // Call the token refresh endpoint
      const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.tokenRefresh}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          refresh_token: refreshToken
        })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to refresh token: ${response.status}`);
      }
      
      const tokens = await response.json();
      
      if (!tokens.data || !tokens.data.access_token) {
        throw new Error('Invalid response from token refresh endpoint');
      }
      
      // Extract token data
      const newAccessToken = tokens.data.access_token;
      const newRefreshToken = tokens.data.refresh_token || refreshToken; // Use new refresh token if available, otherwise keep old one
      const expiresIn = tokens.data.expires_in;
      
      // Calculate the new expiry time
      const expiryTime = Date.now() + (expiresIn * 1000);
      
      console.log('Token refreshed successfully, storing new tokens');
      
      // Store the new tokens in localStorage
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(this.config.storageKeys.accessToken, newAccessToken);
          localStorage.setItem(this.config.storageKeys.refreshToken, newRefreshToken);
          localStorage.setItem(this.config.storageKeys.tokenExpiry, expiryTime.toString());
          
          // Also update the combined object
          const tokensStr = safeStorage.getItem(this.config.storageKeys.tokens);
          if (tokensStr) {
            try {
              const tokensObj = JSON.parse(tokensStr);
              tokensObj.access_token = newAccessToken;
              tokensObj.refresh_token = newRefreshToken;
              tokensObj.expires_in = expiresIn;
              tokensObj.issuedAt = Date.now();
              localStorage.setItem(this.config.storageKeys.tokens, JSON.stringify(tokensObj));
            } catch (e) {
              console.error('Error updating combined tokens object:', e);
            }
          }
        } catch (e) {
          console.error('Failed to store refreshed tokens in localStorage:', e);
        }
      }
      
      // Update tokens in chrome.storage
      await new Promise((resolve) => {
        chrome.storage.local.set({
          [this.config.storageKeys.accessToken]: newAccessToken,
          [this.config.storageKeys.refreshToken]: newRefreshToken,
          [this.config.storageKeys.tokenExpiry]: expiryTime.toString(),
          riotAuth: {
            ...tokens.data,
            issued_at: Date.now()
          }
        }, resolve);
      });
      console.log('Stored refreshed tokens in chrome.storage.local');
      
      return newAccessToken;
    } catch (error) {
      console.error('Error refreshing token:', error);
      throw error;
    }
  },
  
  /**
   * Gets the user's account information
   * @returns {Promise<Object>} - The user's account information
   */
  async getUserInfo() {
    try {
      console.log('Getting user info...');
      
      // Get a valid access token
      const accessToken = await this.getValidToken();
      
      if (!accessToken) {
        console.error('No access token available after getValidToken');
        throw new Error('No access token found. Please authenticate first.');
      }
      
      console.log('Using access token to fetch user info');
      
      // Get user account information from Riot
      const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.userInfo}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
      
      if (!response.ok) {
        const error = await response.text();
        console.error('Failed to get user info:', response.status, error);
        
        // If unauthorized, try to refresh the token and retry
        if (response.status === 401) {
          console.log('Unauthorized response, refreshing token and retrying');
          await this.refreshToken();
          return this.getUserInfo(); // Recursive call after token refresh
        }
        
        throw new Error(`Failed to get user info: ${response.status}`);
      }
      
      const userInfo = await response.json();
      console.log('User info retrieved successfully:', userInfo);
      
      // Store the user info
      await this.storeUserInfo(userInfo);
      
      return userInfo;
    } catch (error) {
      console.error('Error getting user info:', error);
      throw error;
    }
  },
  
  /**
   * Stores the user info in localStorage and chrome.storage
   * @param {Object} userInfo - The user info to store
   */
  async storeUserInfo(userInfo) {
    try {
      // Store in localStorage
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(this.config.storageKeys.userInfo, JSON.stringify(userInfo));
        } catch (e) {
          console.error('Failed to store user info in localStorage:', e);
        }
      }
      
      // Store in chrome.storage
      await new Promise((resolve) => {
        chrome.storage.local.set({
          [this.config.storageKeys.userInfo]: userInfo,
          userInfo: userInfo // Also store under a common key for compatibility
        }, resolve);
      });
      
      console.log('User info stored successfully');
    } catch (error) {
      console.error('Error storing user info:', error);
    }
  },
  
  /**
   * Gets all user data in one call - account info, user info, and rank info
   * @returns {Promise<Object>} - Combined user data
   */
  async getUserData() {
    try {
      console.log('Getting comprehensive user data...');
      
      // First check if we are authenticated
      const isAuthed = await this.isAuthenticated();
      if (!isAuthed) {
        console.error('Not authenticated, cannot get user data');
        throw new Error('Not authenticated. Please connect your Riot account first.');
      }
      
      // Get valid access token first
      const accessToken = await this.getValidToken();
      console.log('Got valid access token for user data request');
      
      // Get user info
      let userData = {};
      try {
        const userInfo = await this.getUserInfo();
        userData = { ...userInfo };
        console.log('Retrieved user info successfully');
      } catch (error) {
        console.error('Error getting user info:', error);
        // Continue with other data even if this fails
      }
      
      // Get account info
      try {
        const accountInfo = await this.getAccountInfo();
        userData = {
          ...userData,
          ...accountInfo,
          // Store formatted Riot ID for display
          riotId: accountInfo ? `${accountInfo.gameName}#${accountInfo.tagLine}` : null
        };
        console.log('Retrieved account info successfully');
      } catch (error) {
        console.error('Error getting account info:', error);
        // Continue with other data even if this fails
      }
      
      // Get rank info
      try {
        const rankInfo = await this.getRankInfo();
        if (rankInfo) {
          userData.rankInfo = rankInfo;
          console.log('Retrieved rank info successfully');
        }
      } catch (error) {
        console.error('Error getting rank info:', error);
        // Continue with other data even if this fails
      }
      
      // Store the complete user data
      await this.storeUserData(userData);
      
      return userData;
    } catch (error) {
      console.error('Error getting user data:', error);
      throw error;
    }
  },
  
  /**
   * Stores the complete user data
   * @param {Object} userData - The user data to store
   */
  async storeUserData(userData) {
    try {
      // Store in localStorage
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('eloward_user_data', JSON.stringify(userData));
        } catch (e) {
          console.error('Failed to store user data in localStorage:', e);
        }
      }
      
      // Store in chrome.storage with various keys for compatibility
      await new Promise((resolve) => {
        chrome.storage.local.set({
          'eloward_user_data': userData,
          'userData': userData,
          'riotAuth': {
            ...userData,
            issued_at: Date.now()
          },
          // Store individual pieces for backward compatibility
          'userInfo': userData,
          'accountInfo': userData,
          'userRank': userData.rankInfo
        }, resolve);
      });
      
      console.log('Complete user data stored successfully');
    } catch (error) {
      console.error('Error storing user data:', error);
    }
  }
}; 