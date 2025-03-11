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
      authState: 'eloward_auth_state',
      tokens: 'eloward_riot_tokens'
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
      console.log(`Connecting to Riot with region: ${region}`);
      
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
        const authCode = await this._openAuthWindow(data.authorizationUrl);
        
        if (!authCode) {
          throw new Error('Authentication was cancelled or failed');
        }
        
        // Complete the authentication flow
        await this.completeAuth(authCode, state);
        
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
        
        // Get the window dimensions and position
        const width = 600;
        const height = 700;
        const left = (window.screen.width/2) - (width/2);
        const top = (window.screen.height/2) - (height/2);
        const windowFeatures = `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=yes`;
        
        console.log('Window features:', windowFeatures);
        
        // Register a listener for messages from the redirect page
        // This needs to be done before opening the window
        const messageListener = (request, sender, sendResponse) => {
          if (request.type === 'auth_callback' && request.code) {
            console.log('Received auth callback message with code');
            clearInterval(authResultPollId);
            chrome.runtime.onMessage.removeListener(messageListener);
            resolve(request.code);
            
            // Confirm receipt
            sendResponse({ success: true });
            return true;
          }
        };
        
        chrome.runtime.onMessage.addListener(messageListener);
        
        // Also listen for window messages
        const windowMessageListener = (event) => {
          // Validate the source
          if (event.data && 
              (event.data.source === 'eloward_auth' || event.data.type === 'auth_callback') && 
              event.data.code) {
            console.log('Received auth callback via window message');
            window.removeEventListener('message', windowMessageListener);
            clearInterval(authResultPollId);
            chrome.runtime.onMessage.removeListener(messageListener);
            resolve(event.data.code);
          }
        };
        
        window.addEventListener('message', windowMessageListener);
        
        // Open the authorization page in a new window
        const authWindow = window.open(authUrl, 'riotAuthWindow', windowFeatures);
        
        if (!authWindow) {
          console.error('Failed to open auth window. Popup might be blocked.');
          clearInterval(authResultPollId);
          chrome.runtime.onMessage.removeListener(messageListener);
          window.removeEventListener('message', windowMessageListener);
          reject(new Error('Failed to open authentication window. Please allow popups for this site.'));
          return;
        }
        
        // Store the auth window reference so we can check if it's closed
        this._authWindow = authWindow;
        
        // Also check for window closing
        const checkWindowClosed = setInterval(() => {
          if (this._authWindow && this._authWindow.closed) {
            console.log('Auth window was closed by the user');
            clearInterval(checkWindowClosed);
            clearInterval(authResultPollId);
            chrome.runtime.onMessage.removeListener(messageListener);
            window.removeEventListener('message', windowMessageListener);
            
            // If we haven't received a code by now, check storage once more
            chrome.storage.local.get(['eloward_auth_callback_result'], (result) => {
              if (result.eloward_auth_callback_result?.code) {
                console.log('Found auth code in storage after window close');
                resolve(result.eloward_auth_callback_result.code);
                chrome.storage.local.remove(['eloward_auth_callback_result']);
              } else {
                // If we haven't received a code by now, consider it a cancellation
                reject(new Error('Authentication was cancelled by the user.'));
              }
            });
          }
        }, 500);
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
    
    // Check various sources for auth result every second
    return setInterval(async () => {
      attempts++;
      
      try {
        // Try to get the authentication result from chrome.storage
        const result = await new Promise(r => {
          chrome.storage.local.get(['eloward_auth_callback_result'], r);
        });
        
        const authResult = result.eloward_auth_callback_result;
        
        if (authResult) {
          console.log('Auth result found in chrome.storage:', { 
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
        
        // Also check localStorage as a backup method (added by the redirect page)
        if (typeof localStorage !== 'undefined') {
          try {
            const storedAuthData = localStorage.getItem('eloward_auth_callback_data');
            if (storedAuthData) {
              const authData = JSON.parse(storedAuthData);
              console.log('Auth result found in localStorage');
              
              // Clear the data
              localStorage.removeItem('eloward_auth_callback_data');
              
              if (authData.code) {
                resolve(authData.code);
                
                // Clear the interval
                clearInterval(this._authPollId);
                this._authPollId = null;
                return;
              }
            }
          } catch (e) {
            console.error('Error checking localStorage for auth result:', e);
          }
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
      
      // Store in localStorage if available
      let tokensStored = false;
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(this.config.storageKeys.tokens, JSON.stringify(authData));
          tokensStored = true;
          console.log('Stored auth tokens in localStorage');
        } catch (e) {
          console.error('Failed to store auth tokens in localStorage:', e);
        }
      }
      
      // Also store in chrome.storage
      await new Promise((resolve) => {
        chrome.storage.local.set({ [this.config.storageKeys.tokens]: authData }, resolve);
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