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
    proxyBaseUrl: 'https://api.eloward.xyz', // Replace with your actual backend URL
    
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
      
      // Request authorization URL from the backend
      const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.authInit}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          region,
          state,
          redirectUri
        })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to initialize authentication: ${response.status}`);
      }
      
      const data = await response.json();
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
      if (state !== storedState) {
        throw new Error('State mismatch. Possible CSRF attack.');
      }
      
      // Get the extension ID for the redirect URI
      const extensionId = chrome.runtime.id;
      const redirectUri = `chrome-extension://${extensionId}/callback.html`;
      
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
        throw new Error(`Failed to exchange code for token: ${response.status}`);
      }
      
      const tokenData = await response.json();
      
      // Store the tokens in local storage
      localStorage.setItem(this.config.storageKeys.accessToken, tokenData.access_token);
      localStorage.setItem(this.config.storageKeys.refreshToken, tokenData.refresh_token);
      
      // Calculate and store the expiry time
      const expiryTime = Date.now() + (tokenData.expires_in * 1000);
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