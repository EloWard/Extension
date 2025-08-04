/*
 * Copyright 2024 EloWard
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * "Commons Clause" License Condition v1.0
 * The Software is provided to you by the Licensor under the License, as defined below, 
 * subject to the following condition. Without limiting other conditions in the License, 
 * the grant of rights under the License will not include, and the License does not grant 
 * to you, the right to Sell the Software.
 */

// EloWard Riot RSO Authentication
import { PersistentStorage } from './persistentStorage.js';

/**
 * Riot RSO (Riot Sign On) Authentication Module
 * This module handles the authentication flow with Riot Games API
 * using the OAuth 2.0 protocol via a secure backend proxy.
 * 
 * Note: This implementation uses the public client flow which only requires a client ID.
 */

// Custom error for signaling re-authentication need
class ReAuthenticationRequiredError extends Error {
  constructor(message = "User re-authentication is required.") {
    super(message);
    this.name = "ReAuthenticationRequiredError";
  }
}

// Set default configuration if not provided
const defaultConfig = {
  proxyBaseUrl: 'https://eloward-riotauth.unleashai.workers.dev',
  clientId: '38a4b902-7186-44ac-8183-89ba1ac56cf3',
  redirectUri: 'https://www.eloward.com/riot/auth/redirect',
  endpoints: {
    authInit: '/auth/init',
    authToken: '/auth/token',
    authRefresh: '/auth/token/refresh',
    accountInfo: '/riot/account',
    leagueEntries: '/riot/league/entries'
  },
  storageKeys: {
    accessToken: 'eloward_riot_access_token',
    refreshToken: 'eloward_riot_refresh_token',
    tokenExpiry: 'eloward_riot_token_expiry',
    tokens: 'eloward_riot_tokens',
    accountInfo: 'eloward_riot_account_info',
    rankInfo: 'eloward_riot_rank_info',
    authState: 'eloward_auth_state',
    authCallback: 'eloward_auth_callback',
    idToken: 'eloward_riot_id_token'
  }
};

export const RiotAuth = {
  // Riot RSO Configuration
  config: defaultConfig,
  
  // Reference to the auth window if opened
  authWindow: null,
  
  /**
   * High-level authentication method for popup.js
   * Initiates the Riot authentication flow and handles the entire process
   * @param {string} region - The Riot region (e.g., 'na1', 'euw1')
   * @param {boolean} isSilentReauth - Whether this is a silent re-authentication
   * @returns {Promise<object>} - Resolves with user data on success
   */
  async authenticate(region) {
    try {
      console.log('[RiotAuth] Starting authentication flow for region:', region);
      
      // Clear any previous auth states
      await chrome.storage.local.remove([this.config.storageKeys.authState]);
      
      // Generate a unique state
      const state = this._generateRandomState();
      
      // Store the state in both chrome.storage and localStorage for redundancy
      await this._storeAuthState(state);
      
      // Get authentication URL from backend
      const authUrl = await this._getAuthUrl(region, state);
      
      // Clear any existing callbacks before opening the window
      try {
        await new Promise(resolve => {
          chrome.storage.local.remove(['auth_callback', 'riot_auth_callback', 'eloward_auth_callback'], resolve);
        });
      } catch (e) {
        // Non-fatal error, continue with authentication
      }
      
      // Set up callback listener BEFORE opening the auth window
      const authResultPromise = this._waitForAuthCallback();
      
      // Small delay to ensure listener is set up
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Open the auth window and wait for it to open
      const openedAuthWindow = await this._openAuthWindow(authUrl);
      
      // Update the authWindow reference for the AuthCallbackWatcher
      if (openedAuthWindow) {
        this.authWindow = openedAuthWindow;
        // Also update the current watcher if it exists
        if (this._currentAuthWatcher) {
          this._currentAuthWatcher.updateWindow(openedAuthWindow);
        }
      }
      
      // Wait for the authentication callback
      const authResult = await authResultPromise;
      
      if (!authResult || !authResult.code) {
        throw new Error('Authentication cancelled or failed');
      }
      
      // Verify the state parameter to prevent CSRF attacks
      if (authResult.state !== state) {
        // Try fallback state check using storage
        const storedState = await this._getStoredAuthState();
        
        if (authResult.state !== storedState) {
          throw new Error('Security verification failed: state parameter mismatch. Please try again.');
        }
      }
      
      // Exchange code for tokens
      await this.exchangeCodeForTokens(authResult.code);
      
      // Get user data
      const userData = await this.getUserData();
      
      // Store the user data in persistent storage
      await PersistentStorage.storeRiotUserData(userData);
      console.log('[RiotAuth] Authentication completed successfully');
      
      return userData;
    } catch (error) {
      console.error('[RiotAuth] Authentication error:', error.message);
      throw error;
    }
  },
  
  /**
   * Store authentication state in both storage mechanisms
   * @param {string} state - The state to store
   * @private
   */
  async _storeAuthState(state) {
    await new Promise(resolve => {
      chrome.storage.local.set({
        [this.config.storageKeys.authState]: state
      }, resolve);
    });
  },
  
  /**
   * Get stored authentication state from storage
   * @returns {Promise<string|null>} - The stored state or null if not found
   * @private
   */
  async _getStoredAuthState() {
    // Get from chrome.storage.local
    const chromeData = await new Promise(resolve => {
      chrome.storage.local.get([this.config.storageKeys.authState], resolve);
    });
    
    const chromeState = chromeData[this.config.storageKeys.authState];
    if (chromeState) {
      return chromeState;
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
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to get auth URL: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (!data.authorizationUrl) {
        throw new Error('No authorization URL returned from backend');
      }
      
      return data.authorizationUrl;
    } catch (error) {
      throw new Error('Failed to initialize authentication');
    }
  },
  
  /**
   * Open authentication window with given URL
   * @param {string} authUrl - The authentication URL
   * @private
   */
  _openAuthWindow(authUrl) {
    return new Promise((resolve, reject) => {
      try {
        // Try to open directly with window.open first
        console.log('[RiotAuth] Attempting to open auth window with window.open');
        this.authWindow = window.open(authUrl, 'riotAuthWindow', 'width=500,height=700');
        
        if (this.authWindow && !this.authWindow.closed) {
          console.log('[RiotAuth] Successfully opened window with window.open');
          // Try to focus the window
          if (this.authWindow.focus) {
            this.authWindow.focus();
          }
          resolve(this.authWindow);
        } else {
          console.log('[RiotAuth] window.open failed, falling back to background script');
          // If window.open failed (likely due to popup blocker), use background script
          this.authWindow = null; // Ensure it's null
          
          // Get the stored state asynchronously and then send message
          this._getStoredAuthState().then(storedState => {
            chrome.runtime.sendMessage({
              type: 'open_auth_window',
              url: authUrl,
              state: storedState
            }, response => {
              if (chrome.runtime.lastError) {
                console.error('[RiotAuth] Background script failed:', chrome.runtime.lastError);
                reject(new Error('Failed to open authentication window - popup may be blocked'));
              } else if (response && response.success) {
                console.log('[RiotAuth] Background script opened window successfully');
                // When using background script, we don't have a direct window reference
                // But the auth data will be sent directly to background script via chrome.runtime
                resolve(null); // No direct window reference, but window was opened
              } else {
                console.error('[RiotAuth] Background script response:', response);
                reject(new Error('Failed to open authentication window - unknown error'));
              }
            });
          }).catch(error => {
            console.error('[RiotAuth] Failed to get stored state:', error);
            reject(new Error('Failed to get authentication state'));
          });
        }
      } catch (e) {
        console.error('[RiotAuth] Exception opening window:', e);
        reject(new Error('Failed to open authentication window - ' + e.message));
      }
    });
  },
  
  /**
   * Wait for authentication callback using a robust polling strategy
   * @returns {Promise<Object|null>} - The authentication result or null if cancelled
   * @private
   */
  async _waitForAuthCallback() {
    console.log('[RiotAuth] Starting callback wait mechanism');
    
    return new Promise(resolve => {
      const authCallbackWatcher = new AuthCallbackWatcher(this.authWindow, resolve);
      // Store reference so we can update the window later
      this._currentAuthWatcher = authCallbackWatcher;
      authCallbackWatcher.start();
    });
  },
  
  /**
   * Exchange authorization code for tokens
   * @param {string} code - The authorization code from Riot
   * @returns {Promise<Object>} - The token response object
   */
  async exchangeCodeForTokens(code) {
    try {
      
      if (!code) {
        throw new Error('No authorization code provided');
      }
      
      // Exchange the code for tokens
      const requestUrl = `${this.config.proxyBaseUrl}/auth/token`;
      
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          code: code,
          redirect_uri: this.config.redirectUri
        })
      });
      
      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch (e) {
          errorData = null;
        }
        
        const errorMessage = errorData?.error_description || 
                            errorData?.error || 
                            `${response.status}: ${response.statusText}`;
        throw new Error(`Token exchange failed: ${errorMessage}`);
      }
      
      // Parse the token response
      const tokenData = await response.json();
      
      // For newer Cloudflare Worker integration which uses a nested data structure
      const actualTokenData = tokenData.data || tokenData;
      
      if (!actualTokenData.access_token) {
        throw new Error('Invalid token response: Missing access token');
      }
      
      
      // Calculate token expiry timestamp
      const expiresAt = Date.now() + (actualTokenData.expires_in * 1000);
      
      // Update token data with expiry timestamp
      const tokens = {
        ...actualTokenData,
        expires_at: expiresAt
      };
      
      // Store tokens in storage
      await this._storeTokens(tokens);
      
      // Also directly store in standardized keys for better compatibility
      // with other parts of the extension
      const storageData = {
        'eloward_riot_access_token': tokens.access_token,
        'eloward_riot_refresh_token': tokens.refresh_token,
        'eloward_riot_token_expiry': expiresAt,
        'riotAuth': {
          ...tokens,
          issued_at: Date.now()
        }
      };
      
      await new Promise(resolve => {
        chrome.storage.local.set(storageData, resolve);
      });
      
      // Also decode and store the ID token if present
      if (tokens.id_token) {
        try {
          await this._processIdToken(tokens.id_token);
        } catch (idTokenError) {
          // Continue even if ID token processing fails
        }
      }
      
      return tokens;
    } catch (error) {
      throw error;
    }
  },
  
  /**
   * Store tokens in both storage mechanisms
   * @param {Object} tokenData - The token data to store
   * @private
   */
  async _storeTokens(tokenData) {
    try {
      // Validate required token fields
      if (!tokenData.access_token || typeof tokenData.access_token !== 'string') {
        throw new Error('Missing or invalid access_token in token data');
      }
      
      // Validate access token format
      if (tokenData.access_token.length < 20) {
        throw new Error('Access token appears to be invalid');
      }
      
      // Calculate expiry time - ensure it's a numeric value
      const expiresIn = parseInt(tokenData.expires_in, 10) || 300; // Default to 5 minutes if invalid
      if (isNaN(expiresIn)) {
        // Invalid expires_in value, using default
      }
      
      // Calculate expiry timestamp as milliseconds since epoch
      const tokenExpiry = Date.now() + (expiresIn * 1000);
              // Create structured data to store
        const storageData = {
          [this.config.storageKeys.accessToken]: tokenData.access_token,
          [this.config.storageKeys.tokenExpiry]: tokenExpiry,
          [this.config.storageKeys.tokens]: {
            ...tokenData,
            stored_at: Date.now(),
          }
        };
        
        // Optional: refreshToken (only if provided and valid)
        if (tokenData.refresh_token && typeof tokenData.refresh_token === 'string' && tokenData.refresh_token.length > 20) {
          storageData[this.config.storageKeys.refreshToken] = tokenData.refresh_token;
        }
      
      // If we have user info from the token, store that too
      if (tokenData.user_info && typeof tokenData.user_info === 'object') {
        storageData[this.config.storageKeys.accountInfo] = tokenData.user_info;
      } else if (tokenData.id_token && typeof tokenData.id_token === 'string') {
        // Try to extract user info from ID token if available
        try {
          const idTokenParts = tokenData.id_token.split('.');
          if (idTokenParts.length === 3) {
            const idTokenPayload = JSON.parse(atob(idTokenParts[1]));
            
            // Create a user info object matching the expected structure
            const userInfo = {
              puuid: idTokenPayload.sub,
              gameName: idTokenPayload.game_name || idTokenPayload.gameName,
              tagLine: idTokenPayload.tag_line || idTokenPayload.tagLine
            };
            
            if (userInfo.puuid) {
              storageData[this.config.storageKeys.accountInfo] = userInfo;
            } else {
            }
          }
        } catch (e) {
        }
      }
      
      // Store in chrome.storage.local
      await new Promise(resolve => {
        chrome.storage.local.set(storageData, resolve);
      });

    } catch (error) {
      throw error;
    }
  },
  
  /**
   * Check if user is authenticated
   * @param {boolean} ignoreInitialErrors - Whether to ignore errors during initial auth check
   * @returns {Promise<boolean>} - True if authenticated
   */
  async isAuthenticated(ignoreInitialErrors = false) {
    try {
      // FIRST check persistent storage - this takes priority
      const isConnectedInPersistentStorage = await PersistentStorage.isServiceConnected('riot');
      
      // If connected in persistent storage, return true immediately without token checks
      if (isConnectedInPersistentStorage) {
        return true;
      }
      
      // If not connected in persistent storage, try token validation as fallback
      let hasValidToken = false;
      try {
        const token = await this.getValidToken(ignoreInitialErrors);
        hasValidToken = !!token;
      } catch (e) {
        if (!ignoreInitialErrors) {
          throw e;
        }
      }
      
      return hasValidToken;
    } catch (error) {
      return false;
    }
  },
  
  /**
   * Get a valid token or throw an error if none is available
   * @returns {Promise<string>} - The access token
   */
  async getValidToken() {
    try {
      // Get tokens from storage using centralized method
      const { accessToken, refreshToken, tokenExpiry } = await this._getTokensFromStorage();
      
      if (!accessToken) {
        return null;
      }
      
      // Validate token expiry
      const now = Date.now();
      const tokenExpiryMs = typeof tokenExpiry === 'string' ? parseInt(tokenExpiry) : tokenExpiry;
      
      if (isNaN(tokenExpiryMs)) {
        if (refreshToken) {
          const refreshResult = await this.refreshToken();
          return refreshResult?.access_token || null;
        }
        return null;
      }
      
      const expiresInMs = tokenExpiryMs - now;
      const twoMinutesInMs = 2 * 60 * 1000;
      
      // Use existing token if valid for more than 2 minutes
      if (expiresInMs > twoMinutesInMs) {
        return accessToken;
      }
      
      // Refresh if expires within 2 minutes or already expired
      if (refreshToken) {
        try {
          const refreshResult = await this.refreshToken();
          return refreshResult?.access_token || null;
        } catch (refreshError) {
          throw refreshError;
        }
      }
      
      // No refresh token available
      if (expiresInMs <= 0) {
        throw new ReAuthenticationRequiredError('Token expired and no refresh token available');
      }
      
      return null;
    } catch (error) {
      if (error instanceof ReAuthenticationRequiredError) {
        throw error;
      }
      throw error;
    }
  },
  
  /**
   * Centralized method to get tokens from various storage locations
   * @returns {Promise<Object>} - Object with accessToken, refreshToken, tokenExpiry
   * @private
   */
  async _getTokensFromStorage() {
    const tokenData = await new Promise(resolve => {
      chrome.storage.local.get([
        this.config.storageKeys.accessToken,
        this.config.storageKeys.refreshToken,
        this.config.storageKeys.tokenExpiry,
        'eloward_riot_access_token',
        'eloward_riot_refresh_token',
        'eloward_riot_token_expiry',
        'riotAuth'
      ], resolve);
    });
    
    let accessToken = tokenData[this.config.storageKeys.accessToken] || tokenData.eloward_riot_access_token;
    let refreshToken = tokenData[this.config.storageKeys.refreshToken] || tokenData.eloward_riot_refresh_token;
    let tokenExpiry = tokenData[this.config.storageKeys.tokenExpiry] || tokenData.eloward_riot_token_expiry;
    
    // Fallback to riotAuth object
    if (!accessToken && tokenData.riotAuth) {
      accessToken = tokenData.riotAuth.access_token;
      refreshToken = refreshToken || tokenData.riotAuth.refresh_token;
      
      if (!tokenExpiry) {
        tokenExpiry = tokenData.riotAuth.expires_at || 
          (tokenData.riotAuth.issued_at && tokenData.riotAuth.expires_in ? 
           tokenData.riotAuth.issued_at + (tokenData.riotAuth.expires_in * 1000) : null);
      }
    }
    
    return { accessToken, refreshToken, tokenExpiry };
  },
  
  /**
   * Get value from chrome.storage.local
   * @param {string} key - The key to retrieve
   * @returns {Promise<any>} The stored value
   * @private
   */
  async _getStoredValue(key) {
    if (!key) return null;
    
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        if (chrome.runtime.lastError) {
          resolve(null);
        } else {
          resolve(result[key]);
        }
      });
    });
  },
  
  /**
   * Refresh the access token using a refresh token
   * @returns {Promise<Object>} - The refreshed token data or null if refresh fails
   */
  async refreshToken() {
    const storedData = await this._getStoredValue('riotAuth'); 
    const refreshToken = storedData?.refresh_token;

    if (!refreshToken) {
      throw new ReAuthenticationRequiredError("No refresh token available for refresh.");
    }

    try {
      const response = await fetch(`${this.config.proxyBaseUrl}/auth/riot/token/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: refreshToken
        }),
      });

      if (!response.ok) {
        throw new ReAuthenticationRequiredError(`Token refresh failed with status ${response.status}`);
      }

      const newTokens = await response.json();
      const actualTokenData = newTokens.data || newTokens;

      const tokensToStore = {
        access_token: actualTokenData.access_token,
        id_token: actualTokenData.id_token || storedData?.id_token,
        refresh_token: actualTokenData.refresh_token || refreshToken,
        expires_at: Date.now() + (actualTokenData.expires_in * 1000),
        scope: actualTokenData.scope || storedData?.scope,
        token_type: actualTokenData.token_type || storedData?.token_type,
        issued_at: storedData?.issued_at 
      };

      await this._storeTokens(tokensToStore);
      return tokensToStore; 

    } catch (error) {
      if (error instanceof ReAuthenticationRequiredError) {
        throw error;
      }
      throw new ReAuthenticationRequiredError(`Unexpected error during token refresh: ${error.message}`);
    }
  },
  
  /**
   * Perform silent re-authentication to get fresh tokens
   * @param {string} region - The region for authentication
   * @returns {Promise<Object>} - The new user data
   */
  async performSilentReauth(region) {
    try {
      // Clear any existing callbacks to ensure clean auth flow
      await new Promise(resolve => {
        chrome.storage.local.remove(['auth_callback', 'riot_auth_callback', 'eloward_auth_callback'], resolve);
      });
      
      // Generate a unique state for this silent auth
      const state = this._generateRandomState();
      await this._storeAuthState(state);
      
      // Get authentication URL from backend
      const authUrl = await this._getAuthUrl(region, state);
      
      // Open auth window for silent re-authentication
      this._openAuthWindow(authUrl);
      
      // Wait for the authentication callback
      const authResult = await this._waitForAuthCallback();
      
      if (!authResult || !authResult.code) {
        throw new Error('Silent re-authentication cancelled or failed');
      }
      
      // Verify state
      if (authResult.state !== state) {
        throw new Error('Silent re-authentication security verification failed');
      }
      
      // Exchange code for tokens
      await this.exchangeCodeForTokens(authResult.code);
      
      // Get fresh user data
      const userData = await this.getUserData();
      
      // Update persistent storage
      await PersistentStorage.storeRiotUserData(userData);
      
      return userData;
    } catch (error) {
      throw error;
    }
  },
  
  /**
   * Completely disconnect and clear all Riot data including persistent storage
   * @returns {Promise<boolean>} - Whether disconnect was successful
   */
  async disconnect() {
    try {
      
      // Get Twitch username before clearing data (needed for database deletion)
      let twitchUsername = null;
      try {
        const persistentTwitchData = await PersistentStorage.getTwitchUserData();
        twitchUsername = persistentTwitchData?.login;
        
        // Fallback to other storage locations if not found in persistent storage
        if (!twitchUsername) {
          const storageData = await new Promise(resolve => {
            chrome.storage.local.get(['eloward_persistent_twitch_user_data', 'twitchUsername'], resolve);
          });
          twitchUsername = storageData.eloward_persistent_twitch_user_data?.login || storageData.twitchUsername;
        }
      } catch (error) {
      }
      
      // Delete rank data from database
      try {
        let riotToken = null;
        try {
          riotToken = await this.getValidToken();
        } catch {
          try {
            const refreshResult = await this.refreshToken();
            riotToken = refreshResult?.access_token;
          } catch {}
        }
        
        if (riotToken) {
          const region = await this._getStoredValue('selectedRegion') || 'na1';
          await fetch(`${this.config.proxyBaseUrl}/disconnect`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ riot_token: riotToken, region: region })
          });
        }
      } catch {}
      
      // Clear persistent user data
      await PersistentStorage.clearServiceData('riot');
      
      // Clear all the tokens and session data
      let keysToRemove = [
        this.config.storageKeys.accessToken,
        this.config.storageKeys.refreshToken,
        this.config.storageKeys.tokenExpiry,
        this.config.storageKeys.tokens,
        this.config.storageKeys.idToken,
        this.config.storageKeys.accountInfo,
        this.config.storageKeys.rankInfo,
        this.config.storageKeys.authState,
        'riotAuth',
        'riot_auth_callback',
        'eloward_auth_callback'
      ];
      
      // Clear from chrome.storage
      await chrome.storage.local.remove(keysToRemove);
      
      return true;
    } catch (error) {
      return false;
    }
  },
  
  /**
   * Generate a cryptographically secure random state parameter for CSRF protection
   * @returns {string} - A random state string
   * @private
   */
  _generateRandomState() {
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    
    return Array.from(randomBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  },
  
  /**
   * Get Riot account information
   * @returns {Promise<Object>} - Account info object
   */
  async getAccountInfo() {
    try {
      // Get access token for API request
      const accessToken = await this.getValidToken();
      

      
      // Determine regional route based on platform/region
      const storedRegion = await this._getStoredValue('selectedRegion');
      const platform = storedRegion || 'na1';
      const regionalRoute = this._getRegionalRouteFromPlatform(platform);
      

      
      // We'll try multiple endpoints to get account info
      let accountInfo = null;
      let error = null;
      
      // Try the actual Cloudflare Worker endpoint first
      try {
        const requestUrl = `${this.config.proxyBaseUrl}${this.config.endpoints.accountInfo}/${regionalRoute}`;
        
        const response = await fetch(requestUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        });
        
        if (response.ok) {
          accountInfo = await response.json();
        } else {
          // Store error but continue to fallback methods
          const errorData = await response.json().catch(() => ({}));
          error = new Error(`Failed to get account info from primary endpoint: ${response.status} ${errorData.error_description || errorData.message || response.statusText}`);
        }
      } catch (accountError) {
        // Store error but continue to fallback methods
        error = accountError;
      }
      
      // If primary endpoint failed, try fallback to ID token info
      if (!accountInfo) {
        
        // Try to get account info from ID token (which may be stored separately)
        const idToken = await this._getStoredValue(this.config.storageKeys.idToken);
        
        if (idToken) {
          try {
            const idTokenPayload = await this._decodeIdToken(idToken);
            
            if (idTokenPayload && idTokenPayload.sub) {
              accountInfo = {
                puuid: idTokenPayload.sub,
                gameName: idTokenPayload.game_name || null,
                tagLine: idTokenPayload.tag_line || null
              };
            }
          } catch (tokenError) {
          }
        }
      }
      
              // Try fallback endpoint if primary failed
        if (!accountInfo) {
          try {
            const altRequestUrl = `${this.config.proxyBaseUrl}/riot/account?region=${regionalRoute}`;
            
            const response = await fetch(altRequestUrl, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${accessToken}`
              }
            });
            
            if (response.ok) {
              accountInfo = await response.json();
            }
          } catch (fallbackError) {
            // Fallback also failed
          }
        }
      
      // If we still don't have account info after all attempts, we fail
      if (!accountInfo || !accountInfo.puuid) {
        throw error || new Error('Failed to get account info from all available sources');
      }
      
      // Use fallback values only if API data is missing
      if (!accountInfo.gameName) {
        accountInfo.gameName = 'Summoner';
      }
      
      if (!accountInfo.tagLine) {
        accountInfo.tagLine = platform.toUpperCase();
      }
      
      // Store account info in storage
      await this._storeAccountInfo(accountInfo);
      
      
      return accountInfo;
    } catch (error) {
      throw error;
    }
  },
  
  /**
   * Helper method to decode ID token
   * @param {string} idToken - The ID token to decode
   * @returns {Promise<Object>} - The decoded payload
   * @private
   */
  async _decodeIdToken(idToken) {
    if (!idToken) return null;
    
    try {
      const parts = idToken.split('.');
      if (parts.length !== 3) return null;
      
      // Base64 decode the payload
      let payload = parts[1];
      payload = payload.replace(/-/g, '+').replace(/_/g, '/');
      
      // Add padding if needed
      while (payload.length % 4) {
        payload += '=';
      }
      
      const jsonStr = atob(payload);
      return JSON.parse(jsonStr);
    } catch (error) {
      return null;
    }
  },
  
  /**
   * Store account info in storage
   * @param {Object} accountInfo - Account info to store
   * @private
   */
  async _storeAccountInfo(accountInfo) {
    try {
      await chrome.storage.local.set({
        [this.config.storageKeys.accountInfo]: accountInfo
      });
    } catch (e) {
    }
  },
  
  /**
   * Get the regional route from a platform ID
   * @param {string} platform - Platform ID (e.g., 'na1')
   * @returns {string} - Regional route (e.g., 'americas')
   * @private
   */
  _getRegionalRouteFromPlatform(platform) {
    const platformMap = {
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
    
    return platformMap[platform] || 'americas'; // Default to americas if platform not found
  },
  
  /**
   * Get rank data for the specified PUUID
   * @param {string} puuid - The player's PUUID
   * @returns {Promise<Array>} - Array of league entries
   */
  async getRankInfo(puuid) {
    try {
      
      if (!puuid) {
        throw new Error('No PUUID provided');
      }
      
      // Get the region from storage
      const region = await this._getStoredValue('selectedRegion') || 'na1';
      
      // Get access token
      const accessToken = await this.getValidToken();
      if (!accessToken) {
        throw new Error('No valid access token available');
      }
      
      // Construct the URL for the league entries endpoint using PUUID
      const requestUrl = `${this.config.proxyBaseUrl}/riot/league/entries?region=${region}&puuid=${puuid}`;
      
      // Make the request with the access token
      const response = await fetch(requestUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        
        try {
          const errorData = await response.json();
          throw new Error(`League API error: ${errorData.message || response.statusText}`);
        } catch (e) {
          throw new Error(`League API error: ${response.status} ${response.statusText}`);
        }
      }
      
      const rankData = await response.json();
      
      // Handle different response formats (array or object)
      let rankEntries;
      
      if (Array.isArray(rankData)) {
        // Direct array response
        rankEntries = rankData;
      } else if (rankData.entries && Array.isArray(rankData.entries)) {
        // Nested entries array
        rankEntries = rankData.entries;
      } else if (rankData.rank && rankData.tier) {
        // Single entry object
        rankEntries = [rankData];
      } else if (rankData.status && rankData.status.status_code) {
        // Error response
        throw new Error(`League API error: ${rankData.status.message}`);
      } else {
        // Empty or unknown format
        rankEntries = [];
      }
      
      // Log the retrieved rank data summary
      
      await this._storeRankInfo(rankEntries);
      
      return rankEntries;
    } catch (error) {
      return [];
    }
  },
  
  /**
   * Store rank info in storage
   * @param {Object} rankInfo - Rank info to store
   * @private
   */
  async _storeRankInfo(rankInfo) {
    try {
      await chrome.storage.local.set({
        [this.config.storageKeys.rankInfo]: rankInfo
      });
    } catch (e) {
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
   * Get user's data (account and rank)
   * @param {boolean} skipAuthCheck - Whether to skip authentication check
   * @returns {Promise<Object>} - The user data
   */
  async getUserData(skipAuthCheck = false) {
    try {
      
      // Check if user is authenticated
      if (!skipAuthCheck) {
        const isAuthenticated = await this.isAuthenticated(true);
        if (!isAuthenticated) {
          throw new Error('Not authenticated. Please connect your Riot account first.');
        }
      }
      
      // ADDED: First try to get data from persistent storage
      const persistentData = await this.getUserDataFromStorage();
      if (persistentData) {
        return persistentData;
      }
      
      // If no persistent data, proceed with API calls
      
      // Get account info
      const accountInfo = await this.getAccountInfo();
      
      if (!accountInfo || !accountInfo.puuid) {
        throw new Error('Failed to retrieve account info');
      }
      
      
      // Summoner info no longer needed - using Riot ID for display and PUUID for ranks
      
      // Get rank info using the PUUID
      let rankInfo = [];
      
      try {
        rankInfo = await this.getRankInfo(accountInfo.puuid);
      } catch (rankError) {
        rankInfo = [];
      }
      
      // Combine all data with unified riotId
      const userData = {
        riotId: accountInfo.tagLine ? `${accountInfo.gameName}#${accountInfo.tagLine}` : accountInfo.gameName,
        puuid: accountInfo.puuid,
        ranks: rankInfo || [],
        soloQueueRank: rankInfo && rankInfo.length ? 
          rankInfo.find(entry => entry.queueType === 'RANKED_SOLO_5x5') || null : null
      };
      
      await PersistentStorage.storeRiotUserData(userData);
      
      // ADDED: Store rank data securely via backend
      try {
        // Get current Twitch username and token from storage
        const twitchData = await new Promise(resolve => {
          chrome.storage.local.get(['eloward_persistent_twitch_user_data', 'twitchUsername'], resolve);
        });
        
        const twitchUsername = twitchData.eloward_persistent_twitch_user_data?.login || twitchData.twitchUsername;
        
        if (twitchUsername) {
          
          // Get current access token and region
          const accessToken = await this.getValidToken();
          const region = await this._getStoredValue('selectedRegion') || 'na1';
          
          // Get Twitch token for verification
          const { TwitchAuth } = await import('./twitchAuth.js');
          const twitchToken = await TwitchAuth.getValidToken();
          
          if (accessToken && twitchToken) {
            // Call the secure backend endpoint
            const response = await fetch(`${this.config.proxyBaseUrl}/store-rank`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                twitch_token: twitchToken,
                riot_token: accessToken,
                region: region,
                twitch_username: twitchUsername
              })
            });
            
            if (response.ok) {
              const result = await response.json();
            } else {
              const errorData = await response.json();
            }
          } else {
          }
        }
      } catch (uploadError) {
        // Don't fail the entire operation if upload fails
      }
      
      return userData;
    } catch (error) {
      throw error;
    }
  },
  
  /**
   * Process the ID token, extracting user info
   * @param {string} idToken - The ID token from the authentication flow
   * @returns {Promise<Object>} - The extracted user info
   * @private
   */
  async _processIdToken(idToken) {
    if (!idToken) {
      throw new Error('No ID token provided');
    }
    
    
    // Store the raw ID token directly using chrome.storage
    await new Promise(resolve => {
      chrome.storage.local.set({ [this.config.storageKeys.idToken]: idToken }, resolve);
    });
    
    // Decode the ID token (it's a JWT)
    const parts = idToken.split('.');
    
    if (parts.length !== 3) {
      throw new Error('Invalid ID token format - not a valid JWT');
    }
    
    // Base64 decode the payload (second part)
    try {
      // Replace URL-safe base64 characters and add padding if needed
      let payload = parts[1];
      payload = payload.replace(/-/g, '+').replace(/_/g, '/');
      
      // Add padding if needed
      while (payload.length % 4) {
        payload += '=';
      }
      
      // Decode the base64 string
      const jsonStr = atob(payload);
      const decodedPayload = JSON.parse(jsonStr);
      
      // Extract account info from the ID token
      const accountInfo = {
        puuid: decodedPayload.sub,
        gameName: decodedPayload.game_name || null,
        tagLine: decodedPayload.tag_line || null
      };
      
      await this._storeValue(this.config.storageKeys.accountInfo, accountInfo);
      
      return accountInfo;
    } catch (error) {
      throw new Error(`Failed to process ID token: ${error.message}`);
    }
  },
  
  /**
   * Store a value in chrome.storage.local
   * @param {string} key - The key to store the value under
   * @param {any} value - The value to store
   * @returns {Promise<void>}
   * @private
   */
  async _storeValue(key, value) {
    try {
      if (!key) throw new Error('No storage key provided');
      
      return new Promise((resolve, reject) => {
        chrome.storage.local.set({ [key]: value }, () => {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    } catch (error) {
      throw error;
    }
  },
  
  /**
   * Get user data from persistent storage
   * @returns {Promise<Object>} - The stored user data
   */
  async getUserDataFromStorage() {
    try {
      
      // Try to get user data from persistent storage
      const userData = await PersistentStorage.getRiotUserData();
      
      if (userData) {
        
        // Create an object structure similar to what getUserData() would return
        const formattedUserData = {
          ...userData,
          soloQueueRank: userData.rankInfo
        };
        
        return formattedUserData;
      }
      
      return null;
    } catch (error) {
      return null;
    }
  },
  
  // Additional methods and helper functions can be added here
};

/**
 * Robust authentication callback watcher using OOP principles
 * Handles the complexity of waiting for OAuth callbacks while avoiding false positives
 */
class AuthCallbackWatcher {
  constructor(authWindow, resolveCallback) {
    this.authWindow = authWindow;
    this.resolveCallback = resolveCallback;
    
    // Configuration
    this.config = {
      maxWaitTime: 600000, // 10 minutes total - allow time for complex auth flows
      checkInterval: 500, // Check every 500ms for faster callback detection
      windowStabilityDelay: 10000, // Wait 10 seconds after window appears closed - account for slow redirects
      callbackKeys: ['auth_callback', 'eloward_auth_callback', 'riot_auth_callback']
    };
    
    // State tracking
    this.state = {
      elapsedTime: 0,
      intervalId: null,
      windowClosedTime: null,
      isResolved: false
    };
    
    console.log('[AuthCallbackWatcher] Initialized with window:', !!authWindow);
  }
  
  /**
   * Update the window reference (useful when window is opened after AuthCallbackWatcher creation)
   * @param {Window} newWindow - The new window reference
   */
  updateWindow(newWindow) {
    this.authWindow = newWindow;
    console.log('[AuthCallbackWatcher] Updated window reference:', !!newWindow);
  }
  
  /**
   * Start the callback watching process
   */
  start() {
    console.log('[AuthCallbackWatcher] Starting callback monitoring');
    
    // Check immediately first
    this._checkForCallback().then(found => {
      if (!found && !this.state.isResolved) {
        // Start interval checking
        this.state.intervalId = setInterval(() => this._checkForCallback(), this.config.checkInterval);
      }
    });
    
    // Also immediately check localStorage for any existing data
    // This handles cases where the redirect page already loaded and stored data
    setTimeout(() => {
      if (!this.state.isResolved) {
        this._checkForCallback();
      }
    }, 50);
  }
  
  /**
   * Check for authentication callback data
   * @returns {Promise<boolean>} - True if callback found and resolved
   * @private
   */
  async _checkForCallback() {
    if (this.state.isResolved) {
      return true;
    }
    
    // Priority check: Look for callback data first and always prioritize it
    const callbackData = await this._getCallbackData();
    if (callbackData) {
      console.log('[AuthCallbackWatcher] Callback data found, resolving successfully');
      this._resolveWith(callbackData);
      return true;
    }
    
    // Only check window state if we don't have callback data
    // This prevents premature window closure detection during OAuth redirects
    const windowState = this._getWindowState();
    if (windowState === 'open') {
      // Reset closed timer if window is open
      this.state.windowClosedTime = null;
    } else if (windowState === 'closed') {
      // Only handle window closure if we're really sure it's closed
      return this._handleWindowClosed();
    }
    
    // Check timeout - but give plenty of time for complex auth flows
    this.state.elapsedTime += this.config.checkInterval;
    if (this.state.elapsedTime >= this.config.maxWaitTime) {
      console.log('[AuthCallbackWatcher] Timeout reached after', this.config.maxWaitTime / 1000, 'seconds');
      // Final desperate check for callback data before giving up
      const finalCallbackCheck = await this._getCallbackData();
      if (finalCallbackCheck) {
        console.log('[AuthCallbackWatcher] Found callback data at last second!');
        this._resolveWith(finalCallbackCheck);
        return true;
      }
      console.log('[AuthCallbackWatcher] No callback data found, resolving as cancelled');
      this._resolveWith(null);
      return true;
    }
    
    return false;
  }
  
  /**
   * Get callback data from chrome.storage.local
   * @returns {Promise<Object|null>} - Callback data or null
   * @private
   */
  async _getCallbackData() {
    return new Promise(resolve => {
      chrome.storage.local.get(this.config.callbackKeys, data => {
        // Check all possible callback keys
        for (const key of this.config.callbackKeys) {
          const callback = data[key];
          if (callback && callback.code) {
            console.log(`[AuthCallbackWatcher] Found callback data in chrome.storage key: ${key}`);
            resolve(callback);
            return;
          }
        }
        resolve(null);
      });
    });
  }
  
  /**
   * Get current window state
   * @returns {string} - 'open', 'closed', or 'unknown'
   * @private
   */
  _getWindowState() {
    if (!this.authWindow) {
      // If no window reference, assume window is open (could be opened via background script)
      // We'll rely on callback detection and timeout instead of window state
      return 'open';
    }
    
    try {
      // During OAuth redirects, window.closed can temporarily return true
      // We need to be more intelligent about detecting actual window closure
      if (this.authWindow.closed) {
        // Double-check by trying to access window properties
        // If the window is truly closed, these will throw or be inaccessible
        try {
          // Try to access the location - this will fail if window is actually closed
          const location = this.authWindow.location;
          // If we can access location, window is likely just navigating, not closed
          return 'open';
        } catch (locationError) {
          // If we can't access location due to cross-origin restrictions, 
          // that actually means the window is still open but on a different domain
          if (locationError.name === 'SecurityError' || locationError.message.includes('cross-origin')) {
            return 'open';
          }
          // True closure - we can't access anything
          return 'closed';
        }
      } else {
        return 'open';
      }
    } catch (error) {
      // If we can't access the window object at all, it's truly closed
      console.log('[AuthCallbackWatcher] Window access error, window is closed:', error.message);
      return 'closed';
    }
  }
  
  /**
   * Handle window closed state with stability delay
   * @returns {Promise<boolean>} - True if resolved
   * @private
   */
  async _handleWindowClosed() {
    const now = Date.now();
    
    // Start the closed timer if not already started
    if (!this.state.windowClosedTime) {
      this.state.windowClosedTime = now;
      console.log('[AuthCallbackWatcher] Window appears closed, starting stability delay');
      return false;
    }
    
    // Check if window has been closed long enough to be considered truly closed
    const closedDuration = now - this.state.windowClosedTime;
    if (closedDuration >= this.config.windowStabilityDelay) {
      // Final check for late-arriving callback data
      const lateCallback = await this._getCallbackData();
      if (lateCallback) {
        console.log('[AuthCallbackWatcher] Found late callback data after window closed');
        this._resolveWith(lateCallback);
        return true;
      }
      
      console.log('[AuthCallbackWatcher] Window confirmed closed, resolving as cancelled');
      this._resolveWith(null);
      return true;
    }
    
    return false;
  }
  
  /**
   * Clean up and resolve with the given result
   * @param {Object|null} result - The result to resolve with
   * @private
   */
  _resolveWith(result) {
    if (this.state.isResolved) {
      return;
    }
    
    this.state.isResolved = true;
    
    // Clean up interval
    if (this.state.intervalId) {
      clearInterval(this.state.intervalId);
      this.state.intervalId = null;
    }
    
    // Clean up callback data from storage if successful
    if (result && result.code) {
      chrome.storage.local.remove(this.config.callbackKeys, () => {
        console.log('[AuthCallbackWatcher] Cleaned up callback data from storage');
      });
    }
    
    // Resolve the promise
    this.resolveCallback(result);
  }
}