/* Copyright 2024 EloWard - Apache 2.0 + Commons Clause License */

// Import webextension-polyfill for cross-browser compatibility
import '../browser-polyfill.js';

import { PersistentStorage } from './persistentStorage.js';
import { TwitchAuth } from './twitchAuth.js';

class ReAuthenticationRequiredError extends Error {
  constructor(message = "User re-authentication is required.") {
    super(message);
    this.name = "ReAuthenticationRequiredError";
  }
}


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
  config: defaultConfig,
  authWindow: null,
  
  async authenticate(region) {
    try {
      
      // Clear any previous auth states
      await browser.storage.local.remove([this.config.storageKeys.authState]);
      
      // Generate a unique state
      const state = this._generateRandomState();
      
      // Store the state in both browser.storage and localStorage for redundancy
      await this._storeAuthState(state);
      
      // Get authentication URL from backend
      const authUrl = await this._getAuthUrl(region, state);
      
      // Clear any existing callbacks before opening the window
      try {
        await browser.storage.local.remove(['auth_callback', 'riot_auth_callback', 'eloward_auth_callback']);
      } catch (e) {
        // Non-fatal error, continue with authentication
      }
      
      // Set up callback listener BEFORE opening the auth window
      const authResultPromise = this._waitForAuthCallback();
      
      // Mark that we're handling auth to prevent extensionBridge interference  
      await browser.storage.local.set({ 'eloward_popup_auth_active': true });
      
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
      

      if (authResult.state !== state) {

        const storedState = await this._getStoredAuthState();
        
        if (authResult.state !== storedState) {
          throw new Error('Security verification failed: state parameter mismatch. Please try again.');
        }
      }
      
      // Exchange code for tokens
      await this.exchangeCodeForTokens(authResult.code);
      

      const userData = await this.getUserData();
      

      await PersistentStorage.storeRiotUserData(userData);
      
      return userData;
    } catch (error) {
      throw error;
    } finally {
      // Clear the popup auth flag
      await browser.storage.local.remove('eloward_popup_auth_active');
    }
  },
  
  async _storeAuthState(state) {
    await browser.storage.local.set({
      [this.config.storageKeys.authState]: state
    });
  },
  
  async _getStoredAuthState() {
    const browserData = await browser.storage.local.get([this.config.storageKeys.authState]);
    
    const state = browserData[this.config.storageKeys.authState];
    if (state) {
      return state;
    }
    
    return null;
  },
  
  async _getAuthUrl(region, state) {
    try {
      const url = `${this.config.proxyBaseUrl}${this.config.endpoints.authInit}?state=${state}`;
      
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
  
  _openAuthWindow(authUrl) {
    return new Promise((resolve, reject) => {
      try {

        this.authWindow = window.open(authUrl, 'riotAuthWindow', 'width=500,height=700');
        
        if (this.authWindow && !this.authWindow.closed) {

          if (this.authWindow.focus) {
            this.authWindow.focus();
          }
          resolve(this.authWindow);
        } else {
          // If window.open failed (likely due to popup blocker), use background script
          this.authWindow = null; // Ensure it's null
          
          // Get the stored state asynchronously and then send message
          this._getStoredAuthState().then(storedState => {
            browser.runtime.sendMessage({
              type: 'open_auth_window',
              url: authUrl,
              state: storedState
            }).then(response => {
              if (response && response.success) {
                // When using background script, we don't have a direct window reference
                // But the auth data will be sent directly to background script via browser.runtime
                resolve(null); // No direct window reference, but window was opened
              } else {
                reject(new Error('Failed to open authentication window - unknown error'));
              }
            }).catch(error => {
              reject(new Error('Failed to open authentication window - popup may be blocked'));
            });
          }).catch(error => {
            reject(new Error('Failed to get authentication state'));
          });
        }
      } catch (e) {
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
      
      await browser.storage.local.set(storageData);
      
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
      
      // Store in browser.storage.local
      await browser.storage.local.set(storageData);

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
    const tokenData = await browser.storage.local.get([
      this.config.storageKeys.accessToken,
      this.config.storageKeys.refreshToken,
      this.config.storageKeys.tokenExpiry
    ]);
    
    return {
      accessToken: tokenData[this.config.storageKeys.accessToken],
      refreshToken: tokenData[this.config.storageKeys.refreshToken],
      tokenExpiry: tokenData[this.config.storageKeys.tokenExpiry]
    };
  },
  
  /**
   * Get value from browser.storage.local
   * @param {string} key - The key to retrieve
   * @returns {Promise<any>} The stored value
   * @private
   */
  async _getStoredValue(key) {
    if (!key) return null;
    
    try {
      const result = await browser.storage.local.get([key]);
      return result[key] || null;
    } catch (error) {
      return null;
    }
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
      await browser.storage.local.remove(['auth_callback', 'riot_auth_callback', 'eloward_auth_callback']);
      
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
          const storageData = await browser.storage.local.get(['eloward_persistent_twitch_user_data', 'twitchUsername']);
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
      
      // Clear from browser.storage
      await browser.storage.local.remove(keysToRemove);
      
      // Clear Riot browser session with logout window
      try {
        const logoutWindow = window.open(
          'https://auth.riotgames.com/logout', 
          'riotLogout', 
          'width=300,height=420'
        );
        if (logoutWindow) {
          // Poll to detect when logout completes
          const checkLogoutComplete = () => {
            try {
              // Try to access the window's location
              const currentUrl = logoutWindow.location.href;
              
              // If we can access it and it's changed from logout URL, logout is complete
              if (currentUrl && !currentUrl.includes('auth.riotgames.com/logout')) {
                setTimeout(() => {
                  try { 
                    if (logoutWindow && !logoutWindow.closed) {
                      logoutWindow.close(); 
                    }
                  } catch (e) {}
                }, 1000);
                return;
              }
            } catch (e) {
              // Cross-origin error usually means we've navigated away from Riot's domain
              // This indicates logout is complete
              setTimeout(() => {
                try { 
                  if (logoutWindow && !logoutWindow.closed) {
                    logoutWindow.close(); 
                  }
                } catch (e) {}
              }, 1000);
              return;
            }
            
            // Check again if window is still open
            if (logoutWindow && !logoutWindow.closed) {
              setTimeout(checkLogoutComplete, 1000);
            }
          };
          
          // Start checking after initial delay
          setTimeout(checkLogoutComplete, 2000);
        }
      } catch (logoutError) {
        // Non-critical error, continue with disconnect
      }
      
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
      await browser.storage.local.set({
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
      await browser.storage.local.set({
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
      
      // Always attempt to store rank data in backend, regardless of persistent data
      let userData;
      
      if (persistentData) {
        userData = persistentData;
      } else {
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
        userData = {
          riotId: accountInfo.tagLine ? `${accountInfo.gameName}#${accountInfo.tagLine}` : accountInfo.gameName,
          puuid: accountInfo.puuid,
          ranks: rankInfo || [],
          soloQueueRank: rankInfo && rankInfo.length ? 
            rankInfo.find(entry => entry.queueType === 'RANKED_SOLO_5x5') || null : null
        };
        
        await PersistentStorage.storeRiotUserData(userData);
      }
      
      // ALWAYS store rank data securely via backend for any successful auth
      try {
        // Get current Twitch username and token from storage
        const twitchData = await browser.storage.local.get(['eloward_persistent_twitch_user_data', 'twitchUsername']);
        
        const twitchUsername = twitchData.eloward_persistent_twitch_user_data?.login || twitchData.twitchUsername;
        
        if (twitchUsername) {
          // Get current access token and region
          const accessToken = await this.getValidToken();
          const region = await this._getStoredValue('selectedRegion') || 'na1';
          
          // Get Twitch token for verification (using static import)
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
    
    
    // Store the raw ID token directly using browser.storage
    await browser.storage.local.set({ [this.config.storageKeys.idToken]: idToken });
    
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
   * Store a value in browser.storage.local
   * @param {string} key - The key to store the value under
   * @param {any} value - The value to store
   * @returns {Promise<void>}
   * @private
   */
  async _storeValue(key, value) {
    try {
      if (!key) throw new Error('No storage key provided');
      
      try {
        await browser.storage.local.set({ [key]: value });
      } catch (error) {
        throw error;
      }
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
  }
  
  /**
   * Update the window reference (useful when window is opened after AuthCallbackWatcher creation)
   * @param {Window} newWindow - The new window reference
   */
  updateWindow(newWindow) {
    this.authWindow = newWindow;
  }
  
  /**
   * Start the callback watching process
   */
  start() {
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
      // Final desperate check for callback data before giving up
      const finalCallbackCheck = await this._getCallbackData();
      if (finalCallbackCheck) {
        this._resolveWith(finalCallbackCheck);
        return true;
      }
      this._resolveWith(null);
      return true;
    }
    
    return false;
  }
  
  /**
   * Get callback data from browser.storage.local
   * @returns {Promise<Object|null>} - Callback data or null
   * @private
   */
  async _getCallbackData() {
    try {
      const data = await browser.storage.local.get(this.config.callbackKeys);
      // Check all possible callback keys
      for (const key of this.config.callbackKeys) {
        const callback = data[key];
        if (callback && callback.code) {
          return callback;
        }
      }
      return null;
    } catch (error) {
      return null;
    }
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
      return false;
    }
    
    // Check if window has been closed long enough to be considered truly closed
    const closedDuration = now - this.state.windowClosedTime;
    if (closedDuration >= this.config.windowStabilityDelay) {
      // Final check for late-arriving callback data
      const lateCallback = await this._getCallbackData();
      if (lateCallback) {
        this._resolveWith(lateCallback);
        return true;
      }
      
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
      browser.storage.local.remove(this.config.callbackKeys);
    }
    
    // Resolve the promise
    this.resolveCallback(result);
  }
}