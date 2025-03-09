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
    
    // API endpoints
    endpoints: {
      // Backend proxy endpoints
      authInit: '/auth/init',
      authToken: '/auth/token',
      tokenRefresh: '/auth/token/refresh',
      accountInfo: '/riot/account/me',
      summonerInfo: '/riot/summoner/me',
      leagueEntries: '/riot/league/entries'
    },
    
    // Storage keys
    storageKeys: {
      accessToken: 'eloward_riot_access_token',
      refreshToken: 'eloward_riot_refresh_token',
      tokenExpiry: 'eloward_riot_token_expiry',
      accountInfo: 'eloward_riot_account_info',
      summonerInfo: 'eloward_riot_summoner_info',
      rankInfo: 'eloward_riot_rank_info',
      authState: 'eloward_auth_state'
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
      // Check if already authenticated
      const isAlreadyAuthenticated = await this.isAuthenticated();
      if (isAlreadyAuthenticated) {
        console.log('User is already authenticated, retrieving existing data');
        
        // Get account info
        const accountInfo = await this.getAccountInfo();
        
        if (accountInfo) {
          // Return existing user data
          const userData = {
            puuid: accountInfo.puuid,
            riotId: `${accountInfo.gameName}#${accountInfo.tagLine}`,
            summonerId: (await this.getSummonerInfo())?.id,
            region: region,
            platform: EloWardConfig.riot.platformRouting[region]?.platform
          };
          
          return userData;
        }
      }
      
      // Not authenticated or missing data, start new auth flow
      console.log('Starting new authentication flow for region:', region);
      
      // Initialize the authentication flow
      const authSuccess = await this.initAuth(region);
      
      if (!authSuccess) {
        console.log('Authentication was cancelled or failed');
        return null;
      }
      
      console.log('Authentication successful, fetching user data');
      
      // Fetch account info
      const accountInfo = await this.fetchAccountInfo();
      
      if (!accountInfo) {
        console.error('Failed to fetch account info after authentication');
        return null;
      }
      
      // Fetch summoner info
      const summonerInfo = await this.fetchSummonerInfo(accountInfo.puuid);
      
      // Return user data
      const userData = {
        puuid: accountInfo.puuid,
        riotId: `${accountInfo.gameName}#${accountInfo.tagLine}`,
        summonerId: summonerInfo?.id,
        region: region,
        platform: EloWardConfig.riot.platformRouting[region]?.platform
      };
      
      return userData;
    } catch (error) {
      console.error('Authentication failed:', error);
      throw error;
    }
  },
  
  /**
   * Opens a popup window for authentication and returns the result
   * @param {string} authUrl - The authorization URL
   * @returns {Promise<object>} - The response data containing code and state
   */
  _openAuthWindow(authUrl) {
    console.log('Opening auth window with URL:', authUrl);
    
    return new Promise((resolve, reject) => {
      try {
        // Set up callback result polling
        const authResultPollId = this._setupAuthResultPolling(resolve, reject);
        
        // For Chrome extensions, use launchWebAuthFlow
        if (chrome && chrome.identity && chrome.identity.launchWebAuthFlow) {
          // Use the chrome.identity API to handle the authentication flow
          const windowFeatures = `width=600,height=700,left=${window.screen.width/2 - 300},top=${window.screen.height/2 - 350},resizable=yes,scrollbars=yes,status=yes`;
          console.log('Window features:', windowFeatures);
          
          console.log('Using chrome.identity.launchWebAuthFlow for authentication');
          
          chrome.identity.launchWebAuthFlow({
            url: authUrl,
            interactive: true
          }, (responseUrl) => {
            if (chrome.runtime.lastError) {
              console.error('Auth flow error:', chrome.runtime.lastError);
              clearInterval(authResultPollId);
              reject(new Error(`Auth flow error: ${chrome.runtime.lastError.message}`));
              return;
            }
            
            if (!responseUrl) {
              console.error('No response URL from auth flow');
              clearInterval(authResultPollId);
              reject(new Error('Authentication was cancelled or failed'));
              return;
            }
            
            console.log('Received response URL from auth flow');
            
            // Parse the URL to get the authorization code
            const parsedUrl = new URL(responseUrl);
            const code = parsedUrl.searchParams.get('code');
            
            if (!code) {
              const error = parsedUrl.searchParams.get('error');
              const errorDesc = parsedUrl.searchParams.get('error_description');
              console.error('Auth failed:', error, errorDesc);
              clearInterval(authResultPollId);
              reject(new Error(`Authentication failed: ${error} - ${errorDesc || 'No description'}`));
              return;
            }
            
            // Clear the polling interval since we got the code
            clearInterval(authResultPollId);
            resolve(code);
          });
        } else {
          // Fallback for Chrome without identity API or other browsers
          console.log('Falling back to window.open for authentication');
          
          const extensionId = chrome.runtime.id;
          const extensionOrigin = `chrome-extension://${extensionId}`;
          
          // Open a popup window for auth
          const width = 600;
          const height = 700;
          const left = (window.screen.width/2) - (width/2);
          const top = (window.screen.height/2) - (height/2);
          const windowFeatures = `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=yes`;
          
          const authWindow = window.open(authUrl, 'riotAuthWindow', windowFeatures);
          
          if (!authWindow) {
            console.error('Failed to open auth window. Popup might be blocked.');
            clearInterval(authResultPollId);
            reject(new Error('Failed to open authentication window. Please allow popups for this site.'));
            return;
          }
          
          // This would only work if the redirect URI is back to our extension
          // which won't be the case with the new redirect URI
          console.log('Fallback method may not work with external redirect URI');
        }
      } catch (error) {
        console.error('Error opening auth window:', error);
        reject(error);
      }
    });
  },
  
  /**
   * Sets up polling to check for auth result from external redirect URI
   * @param {Function} resolve - Promise resolve function
   * @param {Function} reject - Promise reject function
   * @returns {number} - Interval ID for the polling
   * @private
   */
  _setupAuthResultPolling(resolve, reject) {
    const maxAttempts = 120; // 2 minutes (120 * 1 second)
    let attempts = 0;
    
    console.log('Setting up auth result polling');
    
    // Check localStorage for auth result every second
    return setInterval(async () => {
      attempts++;
      
      try {
        // Try to get the authentication result from chrome.storage
        const result = await new Promise(r => {
          chrome.storage.local.get(['eloward_auth_callback_result'], r);
        });
        
        const authResult = result.eloward_auth_callback_result;
        
        if (authResult) {
          console.log('Auth result found:', { 
            hasCode: !!authResult.code,
            hasError: !!authResult.error
          });
          
          // Clear the result so we don't use it again
          chrome.storage.local.remove(['eloward_auth_callback_result']);
          
          if (authResult.error) {
            reject(new Error(`Authentication error: ${authResult.error}`));
          } else if (authResult.code) {
            resolve(authResult.code);
          } else {
            reject(new Error('Invalid authentication result'));
          }
          
          // Clear the interval
          clearInterval(this._authPollId);
          this._authPollId = null;
          return;
        }
        
        // Give up after max attempts
        if (attempts >= maxAttempts) {
          console.error('Auth result polling timed out after', attempts, 'attempts');
          clearInterval(this._authPollId);
          this._authPollId = null;
          reject(new Error('Authentication timed out. Please try again.'));
        }
      } catch (err) {
        console.error('Error polling for auth result:', err);
      }
    }, 1000);
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
   * Initializes the authentication flow
   * Gets the authorization URL from the backend and opens an auth window
   * @param {string} region - The Riot region (e.g., 'na1', 'euw1')
   * @returns {Promise<void>} - Resolves once authentication is complete
   */
  async initAuth(region = 'na1') {
    try {
      // Generate a random state for security
      const state = this._generateRandomState();
      
      // Store the state in storage for verification later
      const stateStored = safeStorage.setItem(this.config.storageKeys.authState, state);
      
      // If localStorage is not available, also store in chrome.storage
      if (!stateStored) {
        await new Promise((resolve) => {
          chrome.storage.local.set({ [this.config.storageKeys.authState]: state }, resolve);
        });
        console.log('Stored auth state in chrome.storage.local');
      }
      
      // Use Vercel app as redirect URI instead of chrome-extension
      const redirectUri = `https://eloward.vercel.app/`;
      
      console.log('Initializing Riot RSO auth with:', {
        region,
        state,
        redirectUri,
        extensionId: chrome.runtime.id
      });
      
      // Request authorization URL from the backend using GET with query parameters
      const url = new URL(`${this.config.proxyBaseUrl}${this.config.endpoints.authInit}`);
      url.searchParams.append('redirect_uri', redirectUri);
      url.searchParams.append('state', state);
      
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Auth initialization failed:', response.status, errorText);
        throw new Error(`Failed to initialize authentication: ${response.status} - ${errorText}`);
      }
      
      const data = await response.json();
      
      // Verify the authUrl is properly formed
      if (!data.authUrl || !data.authUrl.includes('auth.riotgames.com')) {
        console.error('Invalid auth URL received:', data);
        throw new Error('Invalid authentication URL received from server');
      }
      
      // Log the full URL for debugging
      console.log('Auth URL received:', data.authUrl);
      
      // Ensure the URL has all required parameters
      const authUrlObj = new URL(data.authUrl);
      const requiredParams = ['client_id', 'redirect_uri', 'response_type', 'scope', 'state'];
      const missingParams = requiredParams.filter(param => !authUrlObj.searchParams.has(param));
      
      if (missingParams.length > 0) {
        console.error('Auth URL is missing required parameters:', missingParams);
        console.error('Current params:', Object.fromEntries(authUrlObj.searchParams.entries()));
        
        // Try to fix the URL if possible
        if (!authUrlObj.searchParams.has('response_type')) {
          authUrlObj.searchParams.append('response_type', 'code');
        }
        if (!authUrlObj.searchParams.has('scope')) {
          authUrlObj.searchParams.append('scope', 'openid offline_access lol-account cpid');
        }
        if (!authUrlObj.searchParams.has('state') && state) {
          authUrlObj.searchParams.append('state', state);
        }
      }
      
      // Open the auth window and wait for the response
      const authWindowResult = await this._openAuthWindow(data.authUrl);
      
      // If we got a code, exchange it for tokens
      if (authWindowResult) {
        console.log('Auth code received, proceeding to token exchange');
        return await this.completeAuth(authWindowResult, state);
      } else {
        console.log('No auth code received, authentication cancelled');
        return false;
      }
    } catch (error) {
      console.error('Authentication initialization failed:', error);
      throw error;
    }
  },
  
  /**
   * Complete the authentication flow by exchanging the code for tokens
   * @param {string} code - The authorization code from the callback
   * @param {string} state - The state parameter from the callback
   * @returns {Promise<boolean>} - Whether authentication was successful
   */
  async completeAuth(code, state) {
    try {
      // Verify the state parameter
      let storedState = safeStorage.getItem(this.config.storageKeys.authState);
      
      // If not found in localStorage, try chrome.storage
      if (!storedState) {
        const data = await new Promise((resolve) => {
          chrome.storage.local.get([this.config.storageKeys.authState], resolve);
        });
        storedState = data[this.config.storageKeys.authState];
        console.log('Retrieved auth state from chrome.storage.local');
      }
      
      if (state !== storedState) {
        console.error('State mismatch', { received: state, stored: storedState });
        throw new Error('State mismatch. Possible CSRF attack.');
      }
      
      // Use Vercel app as redirect URI
      const redirectUri = `https://eloward.vercel.app/`;
      
      console.log('Completing Riot RSO auth with:', {
        codeLength: code ? code.length : 0,
        state,
        redirectUri
      });
      
      // Exchange the code for tokens
      const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.authToken}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          code,
          redirect_uri: redirectUri
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Token exchange failed:', response.status, errorText);
        throw new Error(`Failed to exchange token: ${response.status} - ${errorText}`);
      }
      
      const tokens = await response.json();
      console.log('Tokens received successfully', { 
        hasAccessToken: !!tokens.access_token,
        hasRefreshToken: !!tokens.refresh_token,
        expiresIn: tokens.expires_in
      });
      
      // Store tokens in both localStorage (if available) and chrome.storage
      const accessTokenStored = safeStorage.setItem(this.config.storageKeys.accessToken, tokens.access_token);
      const refreshTokenStored = safeStorage.setItem(this.config.storageKeys.refreshToken, tokens.refresh_token);
      
      // If localStorage failed, store in chrome.storage
      if (!accessTokenStored || !refreshTokenStored) {
        await new Promise((resolve) => {
          chrome.storage.local.set({
            [this.config.storageKeys.accessToken]: tokens.access_token,
            [this.config.storageKeys.refreshToken]: tokens.refresh_token
          }, resolve);
        });
        console.log('Stored tokens in chrome.storage.local');
      }
      
      // Calculate and store the expiry time (current time + expires_in - 5 minute buffer)
      const expiryTime = Date.now() + ((tokens.expires_in - 300) * 1000);
      safeStorage.setItem(this.config.storageKeys.tokenExpiry, expiryTime.toString());
      
      // Also store in chrome.storage
      await new Promise((resolve) => {
        chrome.storage.local.set({
          [this.config.storageKeys.tokenExpiry]: expiryTime.toString()
        }, resolve);
      });
      
      console.log('Authentication completed successfully');
      return true;
    } catch (error) {
      console.error('Error completing authentication:', error);
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
      // Check if we have a token
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
        
        accessToken = data[this.config.storageKeys.accessToken];
        tokenExpiry = data[this.config.storageKeys.tokenExpiry];
        
        if (accessToken) {
          console.log('Retrieved token from chrome.storage.local');
        }
      }
      
      if (!accessToken) {
        throw new Error('No access token found. Please authenticate first.');
      }
      
      // Check if token is expired
      const now = Date.now();
      const expiryTime = parseInt(tokenExpiry, 10);
      
      // If token is expired or will expire in the next 5 minutes, refresh it
      if (now >= expiryTime - 5 * 60 * 1000) {
        console.log('Token expired or will expire soon. Refreshing...');
        return await this.refreshToken();
      }
      
      return accessToken;
    } catch (error) {
      console.error('Error getting valid token:', error);
      throw error;
    }
  },
  
  /**
   * Refreshes the access token using the refresh token
   * @returns {Promise<string>} - The new access token
   */
  async refreshToken() {
    try {
      // Get the refresh token
      let refreshToken = safeStorage.getItem(this.config.storageKeys.refreshToken);
      
      // If not found in localStorage, try chrome.storage
      if (!refreshToken) {
        const data = await new Promise((resolve) => {
          chrome.storage.local.get([this.config.storageKeys.refreshToken], resolve);
        });
        
        refreshToken = data[this.config.storageKeys.refreshToken];
        
        if (refreshToken) {
          console.log('Retrieved refresh token from chrome.storage.local');
        }
      }
      
      if (!refreshToken) {
        throw new Error('No refresh token found. Please authenticate first.');
      }
      
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
      
      // Store the new tokens
      const accessTokenStored = safeStorage.setItem(this.config.storageKeys.accessToken, tokens.access_token);
      
      // Store the new refresh token if provided
      if (tokens.refresh_token) {
        const refreshTokenStored = safeStorage.setItem(this.config.storageKeys.refreshToken, tokens.refresh_token);
      }
      
      // Calculate and store the new expiry time
      const expiryTime = Date.now() + (tokens.expires_in * 1000);
      const expiryStored = safeStorage.setItem(this.config.storageKeys.tokenExpiry, expiryTime.toString());
      
      // If any localStorage operations failed, store in chrome.storage
      await new Promise((resolve) => {
        chrome.storage.local.set({
          [this.config.storageKeys.accessToken]: tokens.access_token,
          ...(tokens.refresh_token && { [this.config.storageKeys.refreshToken]: tokens.refresh_token }),
          [this.config.storageKeys.tokenExpiry]: expiryTime.toString()
        }, resolve);
      });
      
      return tokens.access_token;
    } catch (error) {
      console.error('Error refreshing token:', error);
      throw error;
    }
  }
}; 