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
      
      // Generate a random state for CSRF protection
      const state = this._generateRandomState();
      localStorage.setItem('eloward_auth_state', state);
      
      // Get the extension ID for the redirect URI
      const extensionId = chrome.runtime.id;
      
      // Use Chrome's recommended redirect URI format for OAuth in extensions
      const redirectUri = `https://${extensionId}.chromiumapp.org/`;
      
      console.log('Getting Riot authorization URL...');
      // Get the authorization URL from our backend
      const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.authInit}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          region: apiRegion,
          state,
          redirectUri
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to get auth URL:', response.status, errorText);
        throw new Error(`Failed to initialize authentication: ${response.status} - ${errorText}`);
      }
      
      const data = await response.json();
      if (!data.authUrl) {
        throw new Error('Invalid response from auth server - no auth URL provided');
      }
      
      console.log('Auth URL received, launching Chrome Identity flow...');
      
      // Use Chrome's identity API to handle the OAuth flow
      const authResponse = await this._launchChromeAuthFlow(data.authUrl);
      console.log('Auth response received:', authResponse ? 'success' : 'failed');
      
      if (!authResponse) {
        throw new Error('Authentication was canceled or failed');
      }
      
      // Parse the response URL to get the authorization code
      const responseUrl = new URL(authResponse);
      const code = responseUrl.searchParams.get('code');
      const returnedState = responseUrl.searchParams.get('state');
      
      if (!code) {
        console.error('No code in response:', responseUrl.toString());
        throw new Error('No authorization code received from Riot');
      }
      
      // Verify the state to prevent CSRF attacks
      const storedState = localStorage.getItem('eloward_auth_state');
      if (returnedState !== storedState) {
        console.error('State mismatch:', { returned: returnedState, stored: storedState });
        throw new Error('State parameter mismatch - possible CSRF attack');
      }
      
      // Exchange the code for tokens
      console.log('Exchanging code for tokens...');
      const tokenResponse = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.authToken}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          code,
          redirectUri
        })
      });
      
      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('Token exchange failed:', tokenResponse.status, errorText);
        throw new Error(`Failed to exchange code for token: ${tokenResponse.status}`);
      }
      
      const tokenData = await tokenResponse.json();
      console.log('Token exchange successful');
      
      // Store the tokens
      localStorage.setItem(this.config.storageKeys.accessToken, tokenData.access_token);
      
      if (tokenData.refresh_token) {
        localStorage.setItem(this.config.storageKeys.refreshToken, tokenData.refresh_token);
      }
      
      // Set token expiry
      const expiryTime = Date.now() + ((tokenData.expires_in || 3600) * 1000);
      localStorage.setItem(this.config.storageKeys.tokenExpiry, expiryTime.toString());
      
      // Clean up state
      localStorage.removeItem('eloward_auth_state');
      
      // Get account info
      console.log('Fetching account info...');
      const accountInfo = await this.fetchAccountInfo();
      console.log('Account info received:', accountInfo ? 'success' : 'failed');
      
      if (!accountInfo || !accountInfo.puuid) {
        throw new Error('Failed to retrieve account information');
      }
      
      // Try to get summoner info (non-fatal if it fails)
      let summonerInfo;
      try {
        summonerInfo = await this.fetchSummonerInfo(accountInfo.puuid);
        console.log('Summoner info received:', summonerInfo ? 'success' : 'not available');
      } catch (err) {
        console.warn('Failed to fetch summoner info (non-fatal):', err);
      }
      
      // Prepare user data for returning
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
      
      // Save to chrome.storage.local for popup access
      chrome.storage.local.set({ riotAuth: userData });
      
      return userData;
    } catch (error) {
      console.error('Authentication error:', error);
      throw error;
    }
  },
  
  /**
   * Launch Chrome's identity API authentication flow
   * @param {string} authUrl - The authorization URL to navigate to
   * @returns {Promise<string>} - The response URL containing the authorization code
   */
  _launchChromeAuthFlow(authUrl) {
    return new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow({
        url: authUrl,
        interactive: true
      }, (responseUrl) => {
        if (chrome.runtime.lastError) {
          console.error('Chrome auth flow error:', chrome.runtime.lastError);
          resolve(null); // The user either canceled or there was an error
        } else {
          resolve(responseUrl);
        }
      });
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