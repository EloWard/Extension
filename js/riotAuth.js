// EloWard Riot RSO Authentication
import { EloWardConfig } from './config.js';

/**
 * Riot RSO (Riot Sign On) Authentication Module
 * This module handles the authentication flow with Riot Games API
 * using the OAuth 2.0 protocol via a secure backend proxy.
 * 
 * Note: This implementation uses the public client flow which only requires a client ID.
 */

export const RiotAuth = {
  // Riot RSO Configuration
  config: {
    // Backend proxy endpoints
    proxyBaseUrl: 'https://eloward-riotrso.unleashai-inquiries.workers.dev', // Updated to use deployed worker
    
    // API endpoints
    endpoints: {
      // Backend proxy endpoints
      authInit: '/auth/riot/init',
      authToken: '/auth/riot/token',
      tokenRefresh: '/auth/riot/token/refresh',
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
      rankInfo: 'eloward_riot_rank_info'
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
      
      // Map platform region to API region if needed
      const apiRegion = EloWardConfig.riot.platformRouting[region]?.region || 'americas';
      console.log('Mapped to API region:', apiRegion);
      
      // Start authentication flow
      console.log('Initializing auth flow...');
      const authUrl = await this.initAuth(apiRegion);
      console.log('Auth URL received:', authUrl?.substring(0, 100) + '...');
      
      if (!authUrl) {
        throw new Error('Failed to get authorization URL');
      }
      
      // Open auth window and wait for response
      console.log('Opening auth window...');
      const responseData = await this._openAuthWindow(authUrl);
      console.log('Auth window response:', responseData);
      
      if (!responseData) {
        throw new Error('Authentication window was closed or no response received');
      }
      
      if (!responseData.code || !responseData.state) {
        throw new Error('Invalid response: missing code or state');
      }
      
      // Complete authentication with the received code
      console.log('Completing authentication...');
      const isAuthenticated = await this.completeAuth(responseData.code, responseData.state);
      console.log('Authentication completed:', isAuthenticated);
      
      if (!isAuthenticated) {
        throw new Error('Failed to complete authentication');
      }
      
      // Get account info
      console.log('Fetching account info...');
      const accountInfo = await this.fetchAccountInfo();
      console.log('Account info received:', JSON.stringify(accountInfo));
      
      if (!accountInfo || !accountInfo.puuid) {
        throw new Error('Failed to retrieve account information');
      }
      
      // Get summoner info
      let summonerInfo;
      try {
        summonerInfo = await this.getSummonerInfo();
        console.log('Summoner info received:', summonerInfo ? 'Success' : 'Not available');
      } catch (err) {
        console.warn('Failed to fetch summoner info:', err);
        // Non-fatal, we can continue without summoner info
      }
      
      // Store auth data in chrome.storage for popup access
      const userData = {
        puuid: accountInfo.puuid,
        riotId: accountInfo.gameName && accountInfo.tagLine 
          ? `${accountInfo.gameName}#${accountInfo.tagLine}` 
          : 'Riot Account',
        summonerId: summonerInfo?.id,
        region: region,
        platform: EloWardConfig.riot.platformRouting[region]?.platform
      };
      
      console.log('Setting user data in storage:', userData);
      
      // Save to chrome.storage.local
      chrome.storage.local.set({ riotAuth: userData });
      
      return userData;
    } catch (error) {
      console.error('Authentication error:', error);
      throw error;
    }
  },
  
  /**
   * Opens a popup window for authentication and returns the result
   * @param {string} authUrl - The authorization URL
   * @returns {Promise<object>} - The response data containing code and state
   */
  _openAuthWindow(authUrl) {
    return new Promise((resolve, reject) => {
      // Create a unique message identifier
      const messageId = `eloward_auth_${Date.now()}`;
      
      // Create the authentication window
      const width = 600;
      const height = 700;
      const left = (screen.width - width) / 2;
      const top = (screen.height - height) / 2;
      
      const authWindow = window.open(
        authUrl,
        'EloWard Riot Authentication',
        `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=yes`
      );
      
      if (!authWindow) {
        reject(new Error('Failed to open authentication window. Please allow popups for this site.'));
        return;
      }
      
      // Set up message listener for the callback
      const messageListener = (event) => {
        // Make sure the message is from our callback page
        const extensionId = chrome.runtime.id;
        if (event.origin !== `chrome-extension://${extensionId}`) {
          return;
        }
        
        const data = event.data;
        
        // Check if this is our auth response
        if (data && data.type === 'eloward_auth_callback') {
          // Clean up
          window.removeEventListener('message', messageListener);
          
          // Close the auth window
          if (authWindow) {
            authWindow.close();
          }
          
          // Resolve with the auth data
          resolve({
            code: data.code,
            state: data.state
          });
        }
      };
      
      // Listen for the callback message
      window.addEventListener('message', messageListener);
      
      // Check if window was closed
      const checkClosed = setInterval(() => {
        if (!authWindow || authWindow.closed) {
          clearInterval(checkClosed);
          window.removeEventListener('message', messageListener);
          resolve(null); // User closed the window
        }
      }, 500);
    });
  },
  
  /**
   * Logout method for popup.js
   * Clears all authentication data
   * @returns {Promise<boolean>} - Resolves with true on success
   */
  async logout() {
    try {
      // Clear all stored tokens and user data
      localStorage.removeItem(this.config.storageKeys.accessToken);
      localStorage.removeItem(this.config.storageKeys.refreshToken);
      localStorage.removeItem(this.config.storageKeys.tokenExpiry);
      localStorage.removeItem(this.config.storageKeys.accountInfo);
      localStorage.removeItem(this.config.storageKeys.summonerInfo);
      localStorage.removeItem(this.config.storageKeys.rankInfo);
      
      // Clear chrome.storage data
      await new Promise((resolve) => {
        chrome.storage.local.remove(['riotAuth', 'userRank'], resolve);
      });
      
      return true;
    } catch (error) {
      console.error('Logout error:', error);
      return false;
    }
  },
  
  /**
   * Initialize the authentication flow
   * @param {string} region - The Riot region (e.g., 'na', 'euw')
   * @returns {Promise<string>} - The authorization URL
   */
  async initAuth(region = 'americas') {
    try {
      // Generate a random state for security
      const state = this._generateRandomState();
      
      // Store the state in local storage for verification later
      localStorage.setItem('eloward_auth_state', state);
      
      // Get the extension ID for the redirect URI
      const extensionId = chrome.runtime.id;
      const redirectUri = `chrome-extension://${extensionId}/callback.html`;
      
      // For debugging - log values we're sending
      console.log('Auth Init Request:', {
        region,
        state,
        redirectUri
      });
      
      // Request authorization URL from the backend
      const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.authInit}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          region,
          state,
          redirectUri: encodeURI(redirectUri)
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Auth initialization response error:', response.status, errorText);
        throw new Error(`Failed to initialize authentication: ${response.status} - ${errorText}`);
      }
      
      const data = await response.json();
      console.log('Auth URL received:', data);
      
      return data.authUrl;
    } catch (error) {
      console.error('Error initializing authentication:', error);
      throw error;
    }
  },
  
  /**
   * Complete the authentication flow by exchanging the code for tokens
   * @param {string} code - The authorization code from Riot
   * @param {string} state - The state parameter from the callback
   * @returns {Promise<boolean>} - Whether authentication was successful
   */
  async completeAuth(code, state) {
    try {
      // Verify the state parameter
      const storedState = localStorage.getItem('eloward_auth_state');
      console.log('Verifying state parameter:', { received: state, stored: storedState });
      
      if (state !== storedState) {
        console.error('State mismatch', { received: state, stored: storedState });
        throw new Error('State mismatch. Possible CSRF attack.');
      }
      
      // Get the extension ID for the redirect URI
      const extensionId = chrome.runtime.id;
      const redirectUri = `chrome-extension://${extensionId}/callback.html`;
      
      console.log('Exchanging code for token with parameters:', {
        code: code ? 'present' : 'missing',
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
          redirectUri
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Token exchange failed:', response.status, errorText);
        throw new Error(`Failed to exchange code for token: ${response.status} - ${errorText}`);
      }
      
      const tokenData = await response.json();
      console.log('Token received successfully');
      
      if (!tokenData.access_token) {
        console.error('Invalid token data received:', tokenData);
        throw new Error('Invalid token data received');
      }
      
      // Store the tokens in local storage
      localStorage.setItem(this.config.storageKeys.accessToken, tokenData.access_token);
      
      if (tokenData.refresh_token) {
        localStorage.setItem(this.config.storageKeys.refreshToken, tokenData.refresh_token);
      } else {
        console.warn('No refresh token received');
      }
      
      // Calculate and store the expiry time
      const expiryTime = Date.now() + ((tokenData.expires_in || 3600) * 1000);
      localStorage.setItem(this.config.storageKeys.tokenExpiry, expiryTime.toString());
      
      // Clean up the state
      localStorage.removeItem('eloward_auth_state');
      
      // Fetch account information
      await this.fetchAccountInfo();
      
      return true;
    } catch (error) {
      console.error('Error completing authentication:', error);
      throw error;
    }
  },
  
  /**
   * Check if the user is authenticated
   * @returns {boolean} - Whether the user is authenticated
   */
  isAuthenticated() {
    const accessToken = localStorage.getItem(this.config.storageKeys.accessToken);
    const expiryTime = localStorage.getItem(this.config.storageKeys.tokenExpiry);
    
    if (!accessToken || !expiryTime) {
      return false;
    }
    
    // Check if the token is expired
    const now = Date.now();
    const expiry = parseInt(expiryTime, 10);
    
    return now < expiry;
  },
  
  /**
   * Refresh the access token if it's expired
   * @returns {Promise<boolean>} - Whether the token was refreshed successfully
   */
  async refreshTokenIfNeeded() {
    if (this.isAuthenticated()) {
      return true; // Token is still valid
    }
    
    const refreshToken = localStorage.getItem(this.config.storageKeys.refreshToken);
    if (!refreshToken) {
      return false; // No refresh token available
    }
    
    try {
      const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.tokenRefresh}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          refreshToken
        })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to refresh token: ${response.status}`);
      }
      
      const tokenData = await response.json();
      
      // Store the new tokens
      localStorage.setItem(this.config.storageKeys.accessToken, tokenData.access_token);
      localStorage.setItem(this.config.storageKeys.refreshToken, tokenData.refresh_token);
      
      // Calculate and store the new expiry time
      const expiryTime = Date.now() + (tokenData.expires_in * 1000);
      localStorage.setItem(this.config.storageKeys.tokenExpiry, expiryTime.toString());
      
      return true;
    } catch (error) {
      console.error('Error refreshing token:', error);
      return false;
    }
  },
  
  /**
   * Fetch the user's Riot account information
   * @returns {Promise<object>} - The account information
   */
  async fetchAccountInfo() {
    try {
      // Ensure we have a valid token
      const isValid = await this.refreshTokenIfNeeded();
      if (!isValid) {
        throw new Error('Not authenticated');
      }
      
      const accessToken = localStorage.getItem(this.config.storageKeys.accessToken);
      
      // Fetch account information from Riot API via our backend
      const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.accountInfo}?region=americas`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch account info: ${response.status}`);
      }
      
      const accountInfo = await response.json();
      
      // Store the account information
      localStorage.setItem(this.config.storageKeys.accountInfo, JSON.stringify(accountInfo));
      
      // Fetch summoner information
      await this.fetchSummonerInfo(accountInfo.puuid);
      
      return accountInfo;
    } catch (error) {
      console.error('Error fetching account information:', error);
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
      // Ensure we have a valid token
      const isValid = await this.refreshTokenIfNeeded();
      if (!isValid) {
        throw new Error('Not authenticated');
      }
      
      const accessToken = localStorage.getItem(this.config.storageKeys.accessToken);
      
      // Fetch summoner information from Riot API via our backend
      const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.summonerInfo}?region=na`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch summoner info: ${response.status}`);
      }
      
      const summonerInfo = await response.json();
      
      // Store the summoner information
      localStorage.setItem(this.config.storageKeys.summonerInfo, JSON.stringify(summonerInfo));
      
      // Fetch rank information
      await this.fetchRankInfo(summonerInfo.id);
      
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
      // Ensure we have a valid token
      const isValid = await this.refreshTokenIfNeeded();
      if (!isValid) {
        throw new Error('Not authenticated');
      }
      
      const accessToken = localStorage.getItem(this.config.storageKeys.accessToken);
      
      // Fetch rank information from Riot API via our backend
      const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.leagueEntries}?region=na&summonerId=${summonerId}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch rank info: ${response.status}`);
      }
      
      const rankEntries = await response.json();
      
      // Find the solo queue rank
      const soloQueueRank = rankEntries.find(entry => entry.queueType === 'RANKED_SOLO_5x5') || null;
      
      // Store the rank information
      localStorage.setItem(this.config.storageKeys.rankInfo, JSON.stringify(soloQueueRank));
      
      return soloQueueRank;
    } catch (error) {
      console.error('Error fetching rank information:', error);
      throw error;
    }
  },
  
  /**
   * Get the user's stored account information
   * @returns {object|null} - The account information or null if not available
   */
  getAccountInfo() {
    const accountInfoStr = localStorage.getItem(this.config.storageKeys.accountInfo);
    return accountInfoStr ? JSON.parse(accountInfoStr) : null;
  },
  
  /**
   * Get the user's stored summoner information
   * @returns {object|null} - The summoner information or null if not available
   */
  getSummonerInfo() {
    const summonerInfoStr = localStorage.getItem(this.config.storageKeys.summonerInfo);
    return summonerInfoStr ? JSON.parse(summonerInfoStr) : null;
  },
  
  /**
   * Get the user's stored rank information
   * @returns {object|null} - The rank information or null if not available
   */
  getRankInfo() {
    const rankInfoStr = localStorage.getItem(this.config.storageKeys.rankInfo);
    return rankInfoStr ? JSON.parse(rankInfoStr) : null;
  },
  
  /**
   * Sign out the user
   */
  signOut() {
    // Remove all stored authentication data
    localStorage.removeItem(this.config.storageKeys.accessToken);
    localStorage.removeItem(this.config.storageKeys.refreshToken);
    localStorage.removeItem(this.config.storageKeys.tokenExpiry);
    localStorage.removeItem(this.config.storageKeys.accountInfo);
    localStorage.removeItem(this.config.storageKeys.summonerInfo);
    localStorage.removeItem(this.config.storageKeys.rankInfo);
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
  }
}; 