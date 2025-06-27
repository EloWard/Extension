// EloWard Riot RSO Authentication
import { EloWardConfig } from './config.js';
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

// Safe storage utilities for Chrome extension
const safeStorage = {
  getItem: (key) => {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key] || null);
      });
    });
  },
  setItem: (key, value) => {
    return new Promise((resolve) => {
      const data = {};
      data[key] = value;
      chrome.storage.local.set(data, () => {
        resolve(true);
      });
    });
  },
  removeItem: (key) => {
    return new Promise((resolve) => {
      chrome.storage.local.remove([key], () => {
        resolve(true);
      });
    });
  }
};

// Set default configuration if not provided
const defaultConfig = {
  proxyBaseUrl: 'https://eloward-riotrso.unleashai.workers.dev',
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
   * Initialize RiotAuth with optional custom configuration
   * @param {Object} customConfig - Optional custom configuration
   */
  init(customConfig = {}) {
    // Merge custom config with default config
    if (customConfig) {
      console.log('Initializing RiotAuth with custom config:', Object.keys(customConfig));
      
      // Merge top-level properties
      for (const key in customConfig) {
        if (key !== 'endpoints' && key !== 'storageKeys') {
          this.config[key] = customConfig[key];
        }
      }
      
      // Merge endpoints if provided
      if (customConfig.endpoints) {
        this.config.endpoints = { 
          ...this.config.endpoints, 
          ...customConfig.endpoints 
        };
      }
      
      // Merge storage keys if provided
      if (customConfig.storageKeys) {
        this.config.storageKeys = { 
          ...this.config.storageKeys, 
          ...customConfig.storageKeys 
        };
      }
    }
    
    console.log('RiotAuth initialized with config:', {
      proxyBaseUrl: this.config.proxyBaseUrl,
      redirectUri: this.config.redirectUri,
      endpoints: Object.keys(this.config.endpoints),
      storageKeys: Object.keys(this.config.storageKeys)
    });
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
      
      // Clear any previous auth states
      console.log('Clearing any previous auth states');
      await chrome.storage.local.remove([this.config.storageKeys.authState]);
      
      // Generate a unique state
      const state = this._generateRandomState();
      console.log(`Generated auth state: ${state}`);
      
      // Store the state in both chrome.storage and localStorage for redundancy
      await this._storeAuthState(state);
      
      // Get authentication URL from backend
      const authUrl = await this._getAuthUrl(region, state);
      
      // Clear any existing callbacks before opening the window
      console.log('Clearing any existing auth callbacks');
      try {
        await new Promise(resolve => {
          chrome.storage.local.remove(['auth_callback', 'riot_auth_callback', 'eloward_auth_callback'], resolve);
        });
        console.log('Auth callback data cleared from storage');
      } catch (e) {
        console.warn('Error clearing auth callbacks:', e);
        // Non-fatal error, continue with authentication
      }
      
      // Open the auth window
      this._openAuthWindow(authUrl);
      
      // Wait for the authentication callback
      const authResult = await this._waitForAuthCallback();
      
      if (!authResult || !authResult.code) {
        throw new Error('Authentication cancelled or failed');
      }
      
      console.log('Auth callback received with state:', authResult.state);
      console.log('Expected state from storage:', state);
      
      // Verify the state parameter to prevent CSRF attacks
      if (authResult.state !== state) {
        console.error('State mismatch during authentication:', {
          receivedState: authResult.state ? `${authResult.state.substring(0, 8)}...` : 'undefined',
          expectedState: state ? `${state.substring(0, 8)}...` : 'undefined'
        });
        
        // Try fallback state check using storage
        const storedState = await this._getStoredAuthState();
        console.log('Retrieved stored state for fallback check:', 
                    storedState ? `${storedState.substring(0, 8)}...` : 'null');
        
        if (authResult.state !== storedState) {
          console.error('State verification failed using both methods:', {
            receivedState: authResult.state ? `${authResult.state.substring(0, 8)}...` : 'undefined',
            originalState: state ? `${state.substring(0, 8)}...` : 'undefined',
            storedState: storedState ? `${storedState.substring(0, 8)}...` : 'null'
          });
          
          // Security failure - state mismatch indicates potential CSRF attack
          throw new Error('Security verification failed: state parameter mismatch. Please try again.');
        } else {
          console.log('State verified using fallback stored state');
        }
      } else {
        console.log('State verification passed using primary check');
      }
      
      console.log('Proceeding with token exchange for code:', {
        codeLength: authResult.code.length,
        codePrefix: authResult.code.substring(0, 8) + '...'
      });
      
      // Exchange code for tokens
      const tokenData = await this.exchangeCodeForTokens(authResult.code);
      
      // Get user data
      const userData = await this.getUserData();
      
      // Store the user data in persistent storage
      await PersistentStorage.storeRiotUserData(userData);
      
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
    await new Promise(resolve => {
      chrome.storage.local.set({
        [this.config.storageKeys.authState]: state
      }, resolve);
    });
    console.log(`Stored auth state in chrome.storage: ${state}`);
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
      // Try to open directly with window.open
      this.authWindow = window.open(authUrl, 'riotAuthWindow', 'width=500,height=700');
      
      if (this.authWindow) {
        console.log('Auth window opened with window.open');
      } else {
        // If window.open failed (likely due to popup blocker), try using the background script
        console.log('window.open failed, trying chrome.runtime.sendMessage');
        chrome.runtime.sendMessage({
          type: 'open_auth_window',
          url: authUrl,
          state: this._getStoredAuthState()
        }, response => {
          if (chrome.runtime.lastError) {
            console.error('Failed to open auth window via background script:', chrome.runtime.lastError);
            throw new Error('Failed to open authentication window - popup may be blocked');
          } else if (response && response.success) {
            console.log('Auth window opened via background script');
          } else {
            console.error('Unknown error opening auth window via background script');
            throw new Error('Failed to open authentication window - unknown error');
          }
        });
      }
    } catch (e) {
      console.error('Error opening auth window:', e);
      throw new Error('Failed to open authentication window - ' + e.message);
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
      let intervalId; // Declare intervalId variable here
      
      // Function to check for auth callback data
      const checkForCallback = async () => {
        // Check chrome.storage for callback data
        const data = await new Promise(r => {
          chrome.storage.local.get(['auth_callback', 'eloward_auth_callback'], r);
        });
        
        const callback = data.auth_callback || data.eloward_auth_callback;
        
        if (callback && callback.code) {
          console.log('Auth callback found in chrome.storage:', {
            hasCode: !!callback.code,
            codeLength: callback.code ? callback.code.length : 0,
            hasState: !!callback.state
          });
          clearInterval(intervalId);
          
          // Clear the callback data from storage to prevent reuse
          try {
            chrome.storage.local.remove(['auth_callback', 'eloward_auth_callback'], () => {
              console.log('Auth callback cleared from chrome.storage after use');
            });
          } catch (e) {
            console.warn('Error clearing auth callback after use:', e);
          }
          
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
          intervalId = setInterval(checkForCallback, checkInterval);
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
   * @returns {Promise<Object>} - The token response object
   */
  async exchangeCodeForTokens(code) {
    try {
      console.log('Exchanging authorization code for tokens');
      
      if (!code) {
        throw new Error('No authorization code provided');
      }
      
      // Exchange the code for tokens
      const requestUrl = `${this.config.proxyBaseUrl}/auth/token`;
      console.log(`Sending token exchange request to: ${requestUrl}`);
      
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
      
      console.log('Received tokens with expiry in', actualTokenData.expires_in, 'seconds');
      
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
      
      console.log('Storing tokens with standard keys for compatibility');
      await new Promise(resolve => {
        chrome.storage.local.set(storageData, resolve);
      });
      
      // Also decode and store the ID token if present
      if (tokens.id_token) {
        try {
          await this._processIdToken(tokens.id_token);
        } catch (idTokenError) {
          console.error('Error processing ID token:', idTokenError);
          // Continue even if ID token processing fails
        }
      }
      
      return tokens;
    } catch (error) {
      console.error('Error exchanging code for tokens:', error);
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
      console.log('Storing token data with fields:', Object.keys(tokenData).join(', '));
      
      // Validate required token fields
      if (!tokenData.access_token || typeof tokenData.access_token !== 'string') {
        throw new Error('Missing or invalid access_token in token data');
      }
      
      // Validate access token format
      if (tokenData.access_token.length < 20) {
        throw new Error(`Access token appears to be invalid (length: ${tokenData.access_token.length})`);
      }
      
      // Calculate expiry time - ensure it's a numeric value
      const expiresIn = parseInt(tokenData.expires_in, 10) || 300; // Default to 5 minutes if invalid
      if (isNaN(expiresIn)) {
        console.warn('Invalid expires_in value:', tokenData.expires_in, 'using default of 300 seconds');
      }
      
      // Calculate expiry timestamp as milliseconds since epoch
      const tokenExpiry = Date.now() + (expiresIn * 1000);
      console.log(`Token will expire at: ${new Date(tokenExpiry).toISOString()} (${expiresIn} seconds from now)`);
      
      // Create structured data to store
      const storageData = {
        [this.config.storageKeys.accessToken]: tokenData.access_token,
        [this.config.storageKeys.tokenExpiry]: tokenExpiry, // Store as numeric timestamp
        [this.config.storageKeys.tokens]: {
          ...tokenData,
          stored_at: Date.now(), // Add timestamp for debugging
        }
      };
      
      // Optional: refreshToken (only if provided and valid)
      if (tokenData.refresh_token && typeof tokenData.refresh_token === 'string' && tokenData.refresh_token.length > 20) {
        storageData[this.config.storageKeys.refreshToken] = tokenData.refresh_token;
        console.log('Valid refresh token included in storage data');
      } else {
        console.warn('No valid refresh token available to store');
      }
      
      // If we have user info from the token, store that too
      if (tokenData.user_info && typeof tokenData.user_info === 'object') {
        storageData[this.config.storageKeys.accountInfo] = tokenData.user_info;
        console.log('User info from token stored:', Object.keys(tokenData.user_info).join(', '));
      } else if (tokenData.id_token && typeof tokenData.id_token === 'string') {
        // Try to extract user info from ID token if available
        try {
          const idTokenParts = tokenData.id_token.split('.');
          if (idTokenParts.length === 3) {
            const idTokenPayload = JSON.parse(atob(idTokenParts[1]));
            console.log('Extracted user info from ID token:', Object.keys(idTokenPayload).join(', '));
            
            // Create a user info object matching the expected structure
            const userInfo = {
              puuid: idTokenPayload.sub,
              gameName: idTokenPayload.game_name || idTokenPayload.gameName,
              tagLine: idTokenPayload.tag_line || idTokenPayload.tagLine
            };
            
            if (userInfo.puuid) {
              storageData[this.config.storageKeys.accountInfo] = userInfo;
              console.log('User info extracted from ID token and stored');
            } else {
              console.warn('Extracted user info missing puuid, not storing');
            }
          }
        } catch (e) {
          console.error('Failed to extract user info from ID token:', e);
        }
      }
      
      // Store in chrome.storage.local
      console.log('Storing tokens in chrome.storage with keys:', Object.keys(storageData).join(', '));
      await new Promise(resolve => {
        chrome.storage.local.set(storageData, resolve);
      });
      console.log('Tokens stored in chrome.storage successfully');
    } catch (error) {
      console.error('Error storing tokens:', error);
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
        console.log('User is authenticated according to persistent storage');
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
        console.warn('Error getting valid token (ignored):', e);
      }
      
      return hasValidToken;
    } catch (error) {
      console.error('Error checking authentication status:', error);
      return false;
    }
  },
  
  /**
   * Get a valid token or throw an error if none is available
   * @returns {Promise<string>} - The access token
   */
  async getValidToken(ignoreNoTokenError = false) {
    try {
      console.log('Getting valid token');
      
      // Try to get token from all possible storage keys
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
      
      // Try standard keys first
      let accessToken = tokenData[this.config.storageKeys.accessToken];
      let refreshToken = tokenData[this.config.storageKeys.refreshToken];
      let tokenExpiry = tokenData[this.config.storageKeys.tokenExpiry];
      
      // If not found, try the eloward_riot_* format (from background.js)
      if (!accessToken && tokenData.eloward_riot_access_token) {
        accessToken = tokenData.eloward_riot_access_token;
        console.log('Found access token in eloward_riot_access_token');
      }
      
      if (!refreshToken && tokenData.eloward_riot_refresh_token) {
        refreshToken = tokenData.eloward_riot_refresh_token;
        console.log('Found refresh token in eloward_riot_refresh_token');
      }
      
      if (!tokenExpiry && tokenData.eloward_riot_token_expiry) {
        tokenExpiry = tokenData.eloward_riot_token_expiry;
        console.log('Found token expiry in eloward_riot_token_expiry');
      }
      
      // Last resort: try the riotAuth object
      if (!accessToken && tokenData.riotAuth && tokenData.riotAuth.access_token) {
        accessToken = tokenData.riotAuth.access_token;
        console.log('Found access token in riotAuth object');
        
        if (!refreshToken && tokenData.riotAuth.refresh_token) {
          refreshToken = tokenData.riotAuth.refresh_token;
          console.log('Found refresh token in riotAuth object');
        }
        
        if (!tokenExpiry) {
          if (tokenData.riotAuth.expires_at) {
            tokenExpiry = tokenData.riotAuth.expires_at;
            console.log('Found token expiry (expires_at) in riotAuth object');
          } else if (tokenData.riotAuth.issued_at && tokenData.riotAuth.expires_in) {
            tokenExpiry = tokenData.riotAuth.issued_at + (tokenData.riotAuth.expires_in * 1000);
            console.log('Calculated token expiry from issued_at and expires_in in riotAuth object');
          }
        }
      }
      
      console.log('Token check results:', {
        hasAccessToken: !!accessToken,
        accessTokenLength: accessToken ? accessToken.length : 0,
        hasRefreshToken: !!refreshToken,
        refreshTokenLength: refreshToken ? refreshToken.length : 0,
        hasExpiryTimestamp: !!tokenExpiry,
        expiryTimeISO: tokenExpiry ? new Date(parseInt(tokenExpiry)).toISOString() : 'undefined'
      });
      
      // If no access token is found, return null - do not auto-authenticate
      if (!accessToken) {
        console.log('No access token found in storage');
        return null;
      }
      
      // Check if token is expired or will expire soon
      const now = Date.now();
      const tokenExpiryMs = typeof tokenExpiry === 'string' ? parseInt(tokenExpiry) : tokenExpiry;
      
      if (isNaN(tokenExpiryMs)) {
        console.error('Invalid token expiry timestamp:', tokenExpiry);
        
        // If we have a refresh token, try to use it instead of failing
        if (refreshToken) {
          console.log('Invalid expiry but refresh token available, attempting refresh');
          const refreshResult = await this.refreshToken();
          
          // If refresh returns null (no error but no token), return null
          if (refreshResult === null) {
            console.log('Token refresh returned null, no valid token available');
            return null;
          }
          
          return refreshResult.access_token;
        }
        
        // If no refresh token or refresh fails, return null
        return null;
      }
      
      const expiresInMs = tokenExpiryMs - now;
      const fiveMinutesInMs = 5 * 60 * 1000;
      
      // Log expiry details
      const expiresInMinutes = Math.round(expiresInMs / 60000);
      console.log(`Token expires in ${expiresInMinutes} minutes (${expiresInMs} ms)`);
      
      // If token expires in less than 5 minutes, refresh it
      if (expiresInMs < fiveMinutesInMs) {
        console.log('Token expires soon, attempting refresh');
        
        if (!refreshToken) {
          console.error('Access token expired and no refresh token available');
          return null;
        }
        
        // Refresh the token
        console.log('Refreshing access token using refresh token');
        try {
          const refreshResult = await this.refreshToken();
          
          // If refresh returns null (no error but no token), return null
          if (refreshResult === null) {
            console.log('Token refresh returned null, no valid token available');
            return null;
          }
          
          console.log('Token refresh successful');
          return refreshResult.access_token;
        } catch (refreshError) {
          console.error('Error refreshing token:', refreshError);
          return null;
        }
      }
      
      // Token is valid
      console.log('Using existing valid access token');
      return accessToken;
    } catch (error) {
      console.error('Error getting valid token:', error);
      return null;
    }
  },
  
  // Helper method for token handling - now just returns null instead of auto-authenticating
  async _initiateAuthFlowForNewToken() {
    console.log('Auto-authentication disabled, returning null instead of initiating auth flow');
    return null;
  },
  
  /**
   * Get value from chrome.storage.local
   * @param {string} key - The key to retrieve
   * @returns {Promise<any>} The stored value
   * @private
   */
  async _getStoredValue(key) {
    try {
      if (!key) throw new Error('No storage key provided');
      
      console.log(`Getting stored value for key: ${key}`);
      
      // Get only from chrome.storage.local for consistency
      return new Promise((resolve) => {
        chrome.storage.local.get([key], (result) => {
          const error = chrome.runtime.lastError;
          if (error) {
            console.error(`Error retrieving value for key ${key}:`, error);
            resolve(null);
          } else {
            console.log(`Successfully retrieved value for key: ${key}, exists: ${!!result[key]}`);
            resolve(result[key]);
          }
        });
      });
    } catch (error) {
      console.error(`Error in _getStoredValue for key: ${key}`, error);
      return null;
    }
  },
  
  /**
   * Refresh the access token using a refresh token
   * @returns {Promise<Object>} - The refreshed token data or null if refresh fails
   */
  async refreshToken() {
    console.log('Attempting to refresh access token');
    
    // Retrieve stored tokens directly using the internal helper
    const storedData = await this._getStoredValue('riotAuth'); 
    const refreshToken = storedData?.refresh_token; // Get refresh token from stored data

    if (!refreshToken) {
      console.warn('No refresh token found in storage. Cannot refresh.');
      await this.logout(false); // Use logout to clear data consistently
      throw new ReAuthenticationRequiredError("No refresh token available for refresh.");
    }

    try {
      const refreshTokenPayload = {
        grant_type: 'refresh_token',
        refresh_token: refreshToken // Use the retrieved refresh token
      };
      
      console.log('Refreshing access token via worker...');
      const tokenUrl = `${EloWardConfig.riotRSOWorkerUrl}/auth/token`; 
      console.log('Making token refresh request to:', tokenUrl);

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(refreshTokenPayload),
      });

      if (!response.ok) {
        console.warn(`Token refresh failed with status ${response.status}. User needs to re-authenticate.`);
        await this.logout(false); // Clear potentially stale/invalid tokens
        throw new ReAuthenticationRequiredError(`Token refresh failed with status ${response.status}`);
      }

      const newTokens = await response.json();
      console.log('Token refresh successful, received new tokens:', newTokens);

      // Prepare data for storage, ensuring expiry is calculated
      const tokensToStore = {
        access_token: newTokens.access_token,
        id_token: newTokens.id_token || storedData?.id_token, // Keep old id_token if not refreshed
        refresh_token: newTokens.refresh_token || refreshToken, // IMPORTANT: Use the new refresh token if provided
        expires_at: Date.now() + (newTokens.expires_in * 1000), // Calculate new expiry time
        // Add other relevant fields if necessary, e.g., scope, token_type
        scope: newTokens.scope || storedData?.scope,
        token_type: newTokens.token_type || storedData?.token_type,
        // Keep issued_at if it exists and wasn't part of the refresh response
        issued_at: storedData?.issued_at 
      };

      // Use the internal _storeTokens method to update storage
      await this._storeTokens(tokensToStore); 
      console.log('Updated tokens stored after refresh using _storeTokens');
      
      // Return only the necessary parts (like access token) or the whole new object as needed
      // Returning the full stored object might be useful for consistency elsewhere
      return tokensToStore; 

    } catch (error) {
      console.error('Error during token refresh:', error);
      // If it's our specific re-auth error, re-throw it
      if (error instanceof ReAuthenticationRequiredError) {
        throw error;
      }
      // For other errors, log and return null or throw a generic error
      // Depending on desired behavior, returning null might allow fallback logic
      // Throwing ensures the failure is propagated
      await this.logout(false); // Clear data on unexpected errors too
      throw new Error(`Unexpected error during token refresh: ${error.message}`); // Throw a generic error for unexpected issues
    }
  },
  
  /**
   * Logout from Riot - clear tokens and user data
   * @param {boolean} forceReload - Whether to reload the extension after logout
   * @returns {Promise<boolean>} - Whether logout was successful
   */
  async logout(forceReload = true) {
    try {
      console.log('Logging out of Riot account');
      
      // The most important part - clear the persistent user data first
      // This ensures the user appears logged out even if token clearing fails
      await PersistentStorage.clearServiceData('riot');
      console.log('Cleared persistent Riot user data');
      
      // Now clear all the tokens and related data
      let keysToRemove = [
        this.config.storageKeys.accessToken,
        this.config.storageKeys.refreshToken,
        this.config.storageKeys.tokenExpiry,
        this.config.storageKeys.tokens,
        this.config.storageKeys.idToken,
        this.config.storageKeys.accountInfo,
        this.config.storageKeys.rankInfo,
        this.config.storageKeys.authState,
        'riotAuth', // Add the main riotAuth object to be cleared
        'riot_auth_callback', // Also clear any auth callbacks
        'eloward_auth_callback' // Clear common auth callback key
      ];
      
      // Clear from chrome.storage
      await chrome.storage.local.remove(keysToRemove);
      console.log('Cleared Riot tokens from chrome.storage');
      
      if (forceReload) {
        console.log('Reloading extension after Riot logout');
        setTimeout(() => {
          chrome.runtime.reload();
        }, 500);
      }
      
      console.log('Riot logout completed successfully');
      return true;
    } catch (error) {
      console.error('Error during Riot logout:', error);
      return false;
    }
  },
  
  /**
   * Generate a cryptographically secure random state parameter for CSRF protection
   * @returns {string} - A random state string
   * @private
   */
  _generateRandomState() {
    // Generate 32 bytes (256 bits) of random data
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    
    // Convert to hex string
    const hexString = Array.from(randomBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    console.log(`Generated secure random state (${hexString.length} chars):`, 
                hexString.substring(0, 6) + '...' + hexString.substring(hexString.length - 6));
    
    return hexString;
  },
  
  /**
   * Get Riot account information
   * @returns {Promise<Object>} - Account info object
   */
  async getAccountInfo() {
    try {
      // Get access token for API request
      const accessToken = await this.getValidToken();
      
      console.log('Retrieved valid access token for API request (token length: ' + accessToken.length + ')');
      console.log('Token prefix: ' + accessToken.substring(0, 8) + '...');
      
      // Determine regional route based on platform/region
      const storedRegion = await this._getStoredValue('selectedRegion');
      const platform = storedRegion || 'na1';
      const regionalRoute = this._getRegionalRouteFromPlatform(platform);
      
      console.log(`Using regional route: ${regionalRoute} for platform: ${platform}`);
      
      // We'll try multiple endpoints to get account info
      let accountInfo = null;
      let error = null;
      
      // Try the actual Cloudflare Worker endpoint first
      try {
        const requestUrl = `${this.config.proxyBaseUrl}${this.config.endpoints.accountInfo}/${regionalRoute}`;
        console.log(`Making account info request to: ${requestUrl}`);
        
        const response = await fetch(requestUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        });
        
        console.log('Account info response status:', response.status, response.statusText);
        
        if (response.ok) {
          accountInfo = await response.json();
          console.log('Successfully retrieved account info from Riot Account API');
        } else {
          // Store error but continue to fallback methods
          const errorData = await response.json().catch(() => ({}));
          error = new Error(`Failed to get account info from primary endpoint: ${response.status} ${errorData.error_description || errorData.message || response.statusText}`);
          console.warn(error.message);
        }
      } catch (accountError) {
        // Store error but continue to fallback methods
        error = accountError;
        console.warn('Error with primary account endpoint:', accountError);
      }
      
      // If primary endpoint failed, try fallback to ID token info
      if (!accountInfo) {
        console.log('Primary endpoint failed, checking ID token for account info');
        
        // Try to get account info from ID token (which may be stored separately)
        const idToken = await this._getStoredValue(this.config.storageKeys.idToken);
        
        if (idToken) {
          try {
            console.log('Found ID token, attempting to extract account info');
            const idTokenPayload = await this._decodeIdToken(idToken);
            
            if (idTokenPayload && idTokenPayload.sub) {
              accountInfo = {
                puuid: idTokenPayload.sub,
                gameName: idTokenPayload.game_name || null,
                tagLine: idTokenPayload.tag_line || null
              };
              console.log('Extracted account info from ID token');
            }
          } catch (tokenError) {
            console.warn('Error extracting account info from ID token:', tokenError);
          }
        }
      }
      
      // If we still don't have account info, try fallback legacy endpoint from logs
      if (!accountInfo) {
        try {
          const altRequestUrl = `${this.config.proxyBaseUrl}/riot/account?region=${regionalRoute}`;
          console.log(`Making fallback account info request to: ${altRequestUrl}`);
          
          const response = await fetch(altRequestUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${accessToken}`
            }
          });
          
          if (response.ok) {
            accountInfo = await response.json();
            console.log('Successfully retrieved account info from fallback endpoint');
          } else {
            // If this also fails, we're out of options
            const errorData = await response.json().catch(() => ({}));
            console.error('Fallback endpoint also failed:', errorData);
          }
        } catch (fallbackError) {
          console.error('Error with fallback account endpoint:', fallbackError);
        }
      }
      
      // If we still don't have account info after all attempts, we fail
      if (!accountInfo || !accountInfo.puuid) {
        throw error || new Error('Failed to get account info from all available sources');
      }
      
      // Ensure we have the most complete account info possible
      // Don't overwrite existing values with default/generic ones
      const storedAccountInfo = await this._getStoredValue(this.config.storageKeys.accountInfo) || {};
      
      // If the API response doesn't have game name/tag line but we have them stored, use the stored values
      if (!accountInfo.gameName && storedAccountInfo.gameName && storedAccountInfo.gameName !== 'Summoner') {
        accountInfo.gameName = storedAccountInfo.gameName;
      }
      
      if (!accountInfo.tagLine && storedAccountInfo.tagLine && storedAccountInfo.tagLine !== 'Unknown') {
        accountInfo.tagLine = storedAccountInfo.tagLine;
      }
      
      // Only use default values if we don't have anything
      if (!accountInfo.gameName) {
        accountInfo.gameName = 'Summoner';
        console.log('Using fallback gameName:', accountInfo.gameName);
      }
      
      if (!accountInfo.tagLine) {
        accountInfo.tagLine = platform.toUpperCase();
        console.log('Using region as tagLine:', accountInfo.tagLine);
      }
      
      // Store account info in storage
      await this._storeAccountInfo(accountInfo);
      
      console.log('Using account info:', {
        puuid: accountInfo.puuid ? accountInfo.puuid.substring(0, 8) + '...' : null,
        gameName: accountInfo.gameName,
        tagLine: accountInfo.tagLine
      });
      
      return accountInfo;
    } catch (error) {
      console.error('Error fetching account info:', error);
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
      console.error('Error decoding ID token:', error);
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
      console.log('Account info stored in chrome.storage.local');
    } catch (e) {
      console.error('Failed to store account info:', e);
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
      console.log(`Getting rank info for PUUID: ${puuid.substring(0, 8)}...`);
      
      if (!puuid) {
        throw new Error('No PUUID provided');
      }
      
      // Get the region from storage
      const region = await this._getStoredValue('selectedRegion') || 'na1';
      console.log(`Using region: ${region} for rank lookup`);
      
      // Get access token
      const accessToken = await this.getValidToken();
      if (!accessToken) {
        throw new Error('No valid access token available');
      }
      
      // Construct the URL for the league entries endpoint using PUUID
      const requestUrl = `${this.config.proxyBaseUrl}/riot/league/entries?region=${region}&puuid=${puuid}`;
      console.log(`Fetching rank data from: ${requestUrl}`);
      
      // Make the request with the access token
      const response = await fetch(requestUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        console.error(`League API request failed: ${response.status} ${response.statusText}`);
        
        try {
          const errorData = await response.json();
          console.error('Error response:', errorData);
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
        console.log(`Received ${rankEntries.length} rank entries directly`);
      } else if (rankData.entries && Array.isArray(rankData.entries)) {
        // Nested entries array
        rankEntries = rankData.entries;
        console.log(`Received ${rankEntries.length} rank entries from nested structure`);
      } else if (rankData.rank && rankData.tier) {
        // Single entry object
        rankEntries = [rankData];
        console.log('Received single rank entry object');
      } else if (rankData.status && rankData.status.status_code) {
        // Error response
        console.error('League API error response:', rankData);
        throw new Error(`League API error: ${rankData.status.message}`);
      } else {
        // Empty or unknown format
        console.log('Received empty or unknown rank data format', rankData);
        rankEntries = [];
      }
      
      // Log the retrieved rank data summary
      console.log(`Retrieved ${rankEntries.length} rank entries`);
      
      // Store the rank data for future reference
      await this._storeRankInfo(rankEntries);
      
      // Find the solo queue rank entry
      const soloQueueEntry = rankEntries.find(entry => entry.queueType === 'RANKED_SOLO_5x5');
      if (soloQueueEntry) {
        console.log(`Solo queue rank: ${soloQueueEntry.tier || 'UNRANKED'} ${soloQueueEntry.rank || ''} (${soloQueueEntry.leaguePoints || 0} LP)`);
      } else {
        console.log('No ranked data found, player is unranked');
      }
      
      return rankEntries;
    } catch (error) {
      console.error('Error getting rank info:', error);
      console.log('Unable to retrieve rank data, assuming unranked');
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
      console.log('Rank info stored in chrome.storage.local');
    } catch (e) {
      console.error('Failed to store rank info:', e);
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
      console.log('Getting user data');
      
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
        console.log('Using Riot user data from persistent storage');
        return persistentData;
      }
      
      // If no persistent data, proceed with API calls
      console.log('No persistent data found, fetching from API...');
      
      // Get account info
      console.log('Getting account info...');
      const accountInfo = await this.getAccountInfo();
      
      if (!accountInfo || !accountInfo.puuid) {
        throw new Error('Failed to retrieve account info');
      }
      
      console.log(`Account info retrieved for ${accountInfo.gameName}#${accountInfo.tagLine}`);
      
      // Summoner info no longer needed - using Riot ID for display and PUUID for ranks
      console.log('Skipping summoner info fetch - using Riot ID and PUUID directly');
      
      // Get rank info using the PUUID
      console.log('Getting rank info...');
      let rankInfo = [];
      
      try {
        rankInfo = await this.getRankInfo(accountInfo.puuid);
        console.log(`Rank info retrieved, found ${rankInfo.length} entries`);
      } catch (rankError) {
        console.error('Error retrieving rank info:', rankError);
        console.log('Continuing without rank data');
        rankInfo = [];
      }
      
      // Combine all data
      const userData = {
        ...accountInfo,
        ranks: rankInfo || [],
        // Find and extract solo queue rank data
        soloQueueRank: rankInfo && rankInfo.length ? 
          rankInfo.find(entry => entry.queueType === 'RANKED_SOLO_5x5') || null : null
      };
      
      // Log the final data structure
      console.log('User data retrieved successfully:', {
        gameName: userData.gameName,
        tagLine: userData.tagLine,
        puuid: userData.puuid ? `${userData.puuid.substring(0, 8)}...` : null,
        rankEntriesCount: userData.ranks.length,
        hasSoloQueueRank: !!userData.soloQueueRank,
        soloQueueTier: userData.soloQueueRank?.tier,
        soloQueueDivision: userData.soloQueueRank?.rank
      });
      
      // Store in persistent storage for future use
      await PersistentStorage.storeRiotUserData(userData);
      
      // ADDED: Upload rank data to the database
      try {
        // Get current Twitch username from storage
        const twitchData = await new Promise(resolve => {
          chrome.storage.local.get(['eloward_persistent_twitch_user_data', 'twitchUsername'], resolve);
        });
        
        const twitchUsername = twitchData.eloward_persistent_twitch_user_data?.login || twitchData.twitchUsername;
        
        if (twitchUsername && userData.soloQueueRank) {
          console.log('Uploading rank data to database for:', twitchUsername);
          
          // Import RankAPI dynamically to avoid circular dependencies
          const { RankAPI } = await import('./rankAPI.js');
          
          // Format rank data for upload
          const rankData = {
            puuid: userData.puuid,
            gameName: userData.gameName,
            tagLine: userData.tagLine,
            tier: userData.soloQueueRank.tier,
            rank: userData.soloQueueRank.rank,
            leaguePoints: userData.soloQueueRank.leaguePoints
          };
          
          // Upload rank to database
          await RankAPI.uploadRank(twitchUsername, rankData);
          console.log('Rank data uploaded successfully');
        }
      } catch (uploadError) {
        console.error('Error uploading rank data to database:', uploadError);
        // Don't fail the entire operation if upload fails
      }
      
      return userData;
    } catch (error) {
      console.error('Error getting user data:', error);
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
      console.error('No ID token provided to _processIdToken');
      throw new Error('No ID token provided');
    }
    
    console.log('Processing ID token');
    
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
      
      console.log('Successfully decoded ID token payload, claims:', Object.keys(decodedPayload).join(', '));
      
      // Log just the keys of the decoded payload for security
      console.debug('ID token payload keys:', Object.keys(decodedPayload));
      
      // Extract account info from the ID token
      // Note: Riot may include game_name and tag_line in newer ID tokens
      // If they're not present, we'll handle that in the account info fetch
      const accountInfo = {
        puuid: decodedPayload.sub, // In Riot's case, 'sub' is the PUUID
        gameName: decodedPayload.game_name || null,
        tagLine: decodedPayload.tag_line || null
      };
      
      // Store this partial account info
      await this._storeValue(this.config.storageKeys.accountInfo, accountInfo);
      
      // Log the extracted info (without revealing the full PUUID)
      console.log('Extracted account info from ID token:', {
        puuid: accountInfo.puuid ? accountInfo.puuid.substring(0, 8) + '...' : null,
        gameName: accountInfo.gameName,
        tagLine: accountInfo.tagLine
      });
      
      return accountInfo;
    } catch (error) {
      console.error('Error processing ID token:', error);
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
      
      // Log the operation (without revealing sensitive data)
      const valueType = typeof value;
      const logValue = valueType === 'object' 
        ? `object with keys: ${value ? Object.keys(value).join(', ') : 'null'}`
        : (valueType === 'string' && value.length > 20 
            ? `string (length ${value.length})`
            : String(value));
      
      console.log(`Storing value for key: ${key}, type: ${valueType}, value: ${logValue}`);
      
      // Store in chrome.storage.local
      return new Promise((resolve, reject) => {
        chrome.storage.local.set({ [key]: value }, () => {
          const error = chrome.runtime.lastError;
          if (error) {
            console.error(`Error storing value for key ${key}:`, error);
            reject(error);
          } else {
            console.log(`Successfully stored value for key: ${key}`);
            resolve();
          }
        });
      });
    } catch (error) {
      console.error(`Error in _storeValue for key ${key}:`, error);
      throw error;
    }
  },
  
  /**
   * Get user data from persistent storage
   * @returns {Promise<Object>} - The stored user data
   */
  async getUserDataFromStorage() {
    try {
      console.log('Getting Riot user data from persistent storage');
      
      // Try to get user data from persistent storage
      const userData = await PersistentStorage.getRiotUserData();
      
      if (userData) {
        console.log('Found stored Riot user data:', {
          gameName: userData.gameName,
          tagLine: userData.tagLine,
          hasRankInfo: !!userData.rankInfo
        });
        
        // Create an object structure similar to what getUserData() would return
        const formattedUserData = {
          ...userData,
          soloQueueRank: userData.rankInfo
        };
        
        return formattedUserData;
      }
      
      console.log('No stored Riot user data found');
      return null;
    } catch (error) {
      console.error('Error getting user data from storage:', error);
      return null;
    }
  },
  
  /**
   * Check for auth callback data in various storage mechanisms
   * @returns {Promise<Object|null>} - The auth callback data or null if not found
   * @private
   */
  async _checkForAuthCallback() {
    // Check chrome.storage.local
    const chromeData = await new Promise(resolve => {
      chrome.storage.local.get(['auth_callback', 'eloward_auth_callback'], resolve);
    });
    
    if (chromeData.auth_callback || chromeData.eloward_auth_callback) {
      const callback = chromeData.auth_callback || chromeData.eloward_auth_callback;
      console.log('Riot auth callback found in chrome.storage', callback);
      
      // Clean up the storage
      await new Promise(resolve => {
        chrome.storage.local.remove(['auth_callback', 'eloward_auth_callback'], resolve);
      });
      
      return callback;
    }
    
    return null;
  },
  
  // Additional methods and helper functions can be added here
};