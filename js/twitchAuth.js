// EloWard Twitch Authentication
console.log('Loading TwitchAuth module...');

import { EloWardConfig } from './config.js';
import { PersistentStorage } from './persistentStorage.js';

/**
 * Twitch Authentication Module
 * This module handles the authentication flow with Twitch API
 * using the OAuth 2.0 protocol via a secure backend proxy.
 */

// Set default configuration if not provided
const defaultConfig = {
  // Make sure this URL is correct and matches a deployed instance
  proxyBaseUrl: 'https://eloward-twitchrso.unleashai-inquiries.workers.dev',
  // Use an extension-specific redirect URI that's registered with Twitch
  redirectUri: 'https://www.eloward.xyz/ext/twitch/auth/redirect',
  // Make sure scopes match what's in the twitchRSO implementation
  scopes: 'user:read:email',
  endpoints: {
    // These endpoints should match exactly what's in twitchRSO/src/index.ts
    authInit: '/auth/twitch/init',
    authToken: '/auth/twitch/token',
    authRefresh: '/auth/twitch/token/refresh',
    validate: '/auth/twitch/validate',
    userInfo: '/auth/twitch/user'
  },
  storageKeys: {
    accessToken: 'eloward_twitch_access_token',
    refreshToken: 'eloward_twitch_refresh_token',
    tokenExpiry: 'eloward_twitch_token_expiry',
    tokens: 'eloward_twitch_tokens',
    userInfo: 'eloward_twitch_user_info',
    authState: 'eloward_twitch_auth_state',
    authCallback: 'eloward_auth_callback'
  }
};

console.log('TwitchAuth initialized with URL:', defaultConfig.proxyBaseUrl);

export const TwitchAuth = {
  // Twitch Configuration
  config: defaultConfig,
  
  // Reference to the auth window if opened
  authWindow: null,
  
  /**
   * Initialize TwitchAuth with optional custom configuration
   * @param {Object} customConfig - Optional custom configuration
   */
  init(customConfig = {}) {
    // Merge custom config with default config
    if (customConfig) {
      console.log('Initializing TwitchAuth with custom config:', Object.keys(customConfig));
      
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
    
    console.log('TwitchAuth initialized with config:', {
      proxyBaseUrl: this.config.proxyBaseUrl,
      redirectUri: this.config.redirectUri,
      scopes: this.config.scopes
    });
  },
  
  /**
   * Start the Twitch authentication flow
   */
  async authenticate() {
    try {
      console.log('Starting Twitch authentication');
      
      // Clear any previous auth states
      console.log('Clearing any previous auth states');
      await chrome.storage.local.remove([this.config.storageKeys.authState]);
      
      // Generate a unique state value for CSRF protection
      const state = this._generateRandomState();
      console.log('Generated Twitch auth state:', state.substring(0, 8) + '...');
      
      // Store the state for verification when the user returns
      await this._storeAuthState(state);
      
      // Get authentication URL from the backend proxy
      const authUrl = await this._getAuthUrl(state);
      
      // Clear any existing callbacks before opening the window
      console.log('Clearing any existing auth callbacks');
      try {
        await new Promise(resolve => {
          chrome.storage.local.remove(['auth_callback', 'twitch_auth_callback'], resolve);
        });
        console.log('Auth callback data cleared from storage');
      } catch (e) {
        console.warn('Error clearing auth callbacks:', e);
        // Non-fatal error, continue with authentication
      }
      
      // Open the auth window
      this._openAuthWindow(authUrl);
      
      // Wait for the user to complete authentication
      const authResult = await this._waitForAuthCallback();
      
      if (!authResult || !authResult.code) {
        throw new Error('Twitch authentication failed or was cancelled');
      }
      
      // Verify the state to prevent CSRF attacks
      if (authResult.state !== state) {
        console.error('State mismatch in Twitch auth callback:', {
          expected: state.substring(0, 8) + '...',
          received: authResult.state ? authResult.state.substring(0, 8) + '...' : 'undefined'
        });
        
        // Try fallback state verification
        const storedState = await this._getStoredAuthState();
        if (authResult.state !== storedState) {
          throw new Error('Security verification failed: state mismatch in Twitch auth');
        } else {
          console.log('State verified via storage fallback');
        }
      }
      
      // Exchange the authorization code for tokens
      const tokenData = await this.exchangeCodeForTokens(authResult.code);
      console.log('Successfully exchanged code for Twitch tokens');
      
      // Get user info
      const userInfo = await this.getUserInfo();
      console.log('Retrieved Twitch user info for:', userInfo?.display_name || 'unknown user');
      
      // Store the user info in persistent storage
      await PersistentStorage.storeTwitchUserData(userInfo);
      
      return userInfo;
    } catch (error) {
      console.error('Twitch authentication error:', error);
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
      chrome.storage.local.set({ [this.config.storageKeys.authState]: state }, resolve);
    });
    console.log(`Stored Twitch auth state in chrome.storage: ${state}`);
  },
  
  /**
   * Retrieve stored authentication state
   * @returns {Promise<string|null>} The stored state or null if not found
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
   * @param {string} state - A unique state for CSRF protection
   * @returns {Promise<string>} The authentication URL
   * @private
   */
  async _getAuthUrl(state) {
    try {
      console.log('Fetching Twitch auth URL from:', `${this.config.proxyBaseUrl}${this.config.endpoints.authInit}`);
      
      const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.authInit}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        mode: 'cors',
        body: JSON.stringify({
          state,
          scopes: this.config.scopes,
          redirect_uri: this.config.redirectUri
        })
      });
      
      console.log('Auth URL response status:', response.status);
      
      // Check if the response is ok (status in the range 200-299)
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Error response content:', errorText);
        throw new Error(`Failed to get Twitch auth URL: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (!data || !data.authUrl) {
        console.error('Auth URL not found in response data:', data);
        throw new Error('Auth URL not found in response');
      }
      
      console.log('Received Twitch auth URL successfully');
      return data.authUrl;
    } catch (error) {
      console.error('Error getting Twitch auth URL:', error);
      throw error;
    }
  },
  
  /**
   * Open authentication window
   * @param {string} authUrl - The URL to open
   * @private
   */
  _openAuthWindow(authUrl) {
    console.log('Opening Twitch auth window with URL');
    
    try {
      // Close any existing auth window
      if (this.authWindow && !this.authWindow.closed) {
        this.authWindow.close();
      }
      
      // Try to open directly with window.open
      this.authWindow = window.open(authUrl, 'twitchAuthWindow', 'width=500,height=700');
      
      if (this.authWindow) {
        console.log('Twitch auth window opened with window.open');
        
        // Try to focus the window
        if (this.authWindow.focus) {
          this.authWindow.focus();
        }
      } else {
        // If window.open failed (likely due to popup blocker), try using the background script
        console.log('window.open failed, trying chrome.runtime.sendMessage');
        chrome.runtime.sendMessage({
          type: 'open_auth_window',
          url: authUrl,
          service: 'twitch'
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
    } catch (error) {
      console.error('Error opening auth window:', error);
      throw error;
    }
  },
  
  /**
   * Wait for authentication callback from the auth window
   * @returns {Promise<Object>} The authorization code and state
   * @private
   */
  async _waitForAuthCallback() {
    console.log('Waiting for Twitch authentication callback...');
    
    return new Promise(resolve => {
      const maxWaitTime = 300000; // 5 minutes
      const checkInterval = 1000; // 1 second
      let elapsedTime = 0;
      let intervalId;
      
      // Function to check for auth callback data
      const checkForCallback = async () => {
        // Check chrome.storage for callback data
        const data = await new Promise(r => {
          chrome.storage.local.get(['auth_callback', 'twitch_auth_callback'], r);
        });
        
        const callback = data.auth_callback || data.twitch_auth_callback;
        
        if (callback && callback.code) {
          console.log('Auth callback found in chrome.storage:', {
            hasCode: !!callback.code,
            codeLength: callback.code ? callback.code.length : 0,
            hasState: !!callback.state
          });
          clearInterval(intervalId);
          
          // Clear the callback data from storage to prevent reuse
          try {
            chrome.storage.local.remove(['auth_callback', 'twitch_auth_callback'], () => {
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
             (event.data.source === 'eloward_auth' && event.data.code) ||
             (event.data.service === 'twitch' && event.data.code))) {
          
          console.log('Auth callback received via window message');
          window.removeEventListener('message', messageListener);
          
          // Store in chrome.storage for consistency
          chrome.storage.local.set({
            'auth_callback': event.data,
            'twitch_auth_callback': event.data
          });
          
          resolve(event.data);
        }
      };
      
      window.addEventListener('message', messageListener);
    });
  },
  
  /**
   * Exchange authorization code for tokens
   * @param {string} code - The authorization code
   * @returns {Promise<Object>} The tokens
   */
  async exchangeCodeForTokens(code) {
    try {
      console.log('Exchanging code for Twitch tokens');
      
      const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.authToken}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          code,
          redirect_uri: this.config.redirectUri
        })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to exchange code for tokens: ${response.status} ${response.statusText}`);
      }
      
      const tokenData = await response.json();
      
      if (tokenData.error) {
        throw new Error(`Token exchange error: ${tokenData.error} - ${tokenData.error_description || 'No description'}`);
      }
      
      if (!tokenData.access_token) {
        throw new Error('No access token found in response');
      }
      
      console.log('Successfully exchanged code for Twitch tokens');
      
      // Store the tokens
      await this._storeTokens(tokenData);
      
      return tokenData;
    } catch (error) {
      console.error('Error exchanging code for Twitch tokens:', error);
      throw error;
    }
  },
  
  /**
   * Store tokens securely
   * @param {Object} tokenData - The tokens to store
   * @private
   */
  async _storeTokens(tokenData) {
    try {
      console.log('Storing Twitch tokens');
      
      const now = Date.now();
      const expiresAt = now + (tokenData.expires_in * 1000);
      
      // Store individual token components
      await this._storeValue(this.config.storageKeys.accessToken, tokenData.access_token);
      await this._storeValue(this.config.storageKeys.refreshToken, tokenData.refresh_token);
      await this._storeValue(this.config.storageKeys.tokenExpiry, expiresAt.toString());
      
      // Store the complete token data as a backup
      await this._storeValue(this.config.storageKeys.tokens, JSON.stringify({
        ...tokenData,
        stored_at: now,
        expires_at: expiresAt
      }));
      
      console.log('Successfully stored Twitch tokens with expiry:', new Date(expiresAt).toISOString());
    } catch (error) {
      console.error('Error storing Twitch tokens:', error);
      throw error;
    }
  },
  
  /**
   * Check if currently authenticated
   * @returns {Promise<boolean>} True if authenticated
   */
  async isAuthenticated() {
    try {
      // FIRST check persistent storage - this takes priority
      const isConnectedInPersistentStorage = await PersistentStorage.isServiceConnected('twitch');
      
      // If connected in persistent storage, return true immediately
      if (isConnectedInPersistentStorage) {
        console.log('User is authenticated with Twitch according to persistent storage');
        return true;
      }
      
      // Fall back to token validation if not in persistent storage
      let hasValidToken = false;
      try {
        const token = await this.getValidToken();
        hasValidToken = !!token;
      } catch (e) {
        console.warn('Error getting valid Twitch token:', e);
      }
      
      return hasValidToken;
    } catch (error) {
      console.error('Error checking Twitch authentication status:', error);
      return false;
    }
  },
  
  /**
   * Get a valid access token, refreshing if necessary
   * @returns {Promise<string>} The access token
   */
  async getValidToken() {
    try {
      // Get stored token data
      const accessToken = await this._getStoredValue(this.config.storageKeys.accessToken);
      const refreshToken = await this._getStoredValue(this.config.storageKeys.refreshToken);
      const tokenExpiry = await this._getStoredValue(this.config.storageKeys.tokenExpiry);
      
      if (!accessToken) {
        console.log('No Twitch access token found');
        return null;
      }
      
      if (!tokenExpiry) {
        // No expiry time, assume token is still valid
        return accessToken;
      }
      
      const expiryTime = parseInt(tokenExpiry, 10);
      const now = Date.now();
      
      // Check if token is expired or about to expire (within 5 minutes)
      if (now >= expiryTime - (5 * 60 * 1000)) {
        console.log('Twitch token expired or about to expire, refreshing');
        
        if (!refreshToken) {
          throw new Error('No refresh token found for expired access token');
        }
        
        // Refresh the token
        const newTokens = await this.refreshToken(refreshToken);
        return newTokens.access_token;
      }
      
      // Token is still valid
      return accessToken;
    } catch (error) {
      console.error('Error getting valid Twitch token:', error);
      throw error;
    }
  },
  
  /**
   * Refresh access token using a refresh token
   * @param {string} refreshToken - The refresh token
   * @returns {Promise<Object>} The new tokens
   */
  async refreshToken(refreshToken) {
    try {
      console.log('Refreshing Twitch access token');
      
      const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.authRefresh}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          refresh_token: refreshToken
        })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to refresh token: ${response.status} ${response.statusText}`);
      }
      
      const tokenData = await response.json();
      
      if (tokenData.error) {
        throw new Error(`Token refresh error: ${tokenData.error} - ${tokenData.error_description || 'No description'}`);
      }
      
      if (!tokenData.access_token) {
        throw new Error('No access token found in refresh response');
      }
      
      console.log('Successfully refreshed Twitch tokens');
      
      // Store the new tokens
      await this._storeTokens(tokenData);
      
      return tokenData;
    } catch (error) {
      console.error('Error refreshing Twitch token:', error);
      throw error;
    }
  },
  
  /**
   * Logout from Twitch
   * @returns {Promise<boolean>} - Whether logout was successful
   */
  async logout() {
    console.log('Logging out of Twitch');
    
    // Clear auth data from chrome.storage
    await new Promise(resolve => {
      chrome.storage.local.remove([
        this.config.storageKeys.accessToken,
        this.config.storageKeys.refreshToken,
        this.config.storageKeys.tokenExpiry,
        this.config.storageKeys.authState,
        'eloward_auth_callback'
      ], resolve);
    });
    
    return true;
  },
  
  /**
   * Generate a random state for CSRF protection
   * @returns {string} A random state
   * @private
   */
  _generateRandomState() {
    // Generate a random state with 32 characters
    const array = new Uint8Array(24);
    window.crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  },
  
  /**
   * Get user information from Twitch
   * @returns {Promise<Object>} User information
   */
  async getUserInfo() {
    try {
      console.log('Getting Twitch user info');
      
      // First try to get from persistent storage
      const storedUserInfo = await this.getUserInfoFromStorage();
      if (storedUserInfo) {
        console.log('Using Twitch user info from persistent storage');
        return storedUserInfo;
      }
      
      // If not in storage, get fresh data
      console.log('No persistent data found, fetching from API...');
      
      // Get a valid access token
      const accessToken = await this.getValidToken();
      
      if (!accessToken) {
        throw new Error('No valid access token for Twitch API');
      }
      
      // Call the backend proxy to get user info
      const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.userInfo}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ access_token: accessToken })
      });
      
      if (!response.ok) {
        throw new Error(`Error getting Twitch user info: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Twitch API returns an array of users in the "data" field
      if (!data.data || !data.data.length) {
        throw new Error('No user data returned from Twitch API');
      }
      
      // The first (and only) user is the one we're interested in
      const userInfo = data.data[0];
      
      // Store the user info for later use
      await this._storeUserInfo(userInfo);
      
      // Also store in persistent storage
      await PersistentStorage.storeTwitchUserData(userInfo);
      
      return userInfo;
    } catch (error) {
      console.error('Error getting Twitch user info:', error);
      throw error;
    }
  },
  
  /**
   * Store user information
   * @param {Object} userInfo - The user information to store
   * @private
   */
  async _storeUserInfo(userInfo) {
    try {
      await this._storeValue(this.config.storageKeys.userInfo, JSON.stringify(userInfo));
      console.log('Stored Twitch user info');
    } catch (error) {
      console.error('Error storing Twitch user info:', error);
      throw error;
    }
  },
  
  /**
   * Store a value in chrome.storage.local
   * @param {string} key - The key to store under
   * @param {string} value - The value to store
   * @private
   */
  async _storeValue(key, value) {
    // Store only in chrome.storage.local for consistency
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
  },
  
  /**
   * Get a stored value from chrome.storage.local
   * @param {string} key - The key to retrieve
   * @returns {Promise<string|null>} The stored value or null if not found
   * @private
   */
  async _getStoredValue(key) {
    // Get only from chrome.storage.local for consistency
    return new Promise(resolve => {
      chrome.storage.local.get([key], result => {
        resolve(result[key] || null);
      });
    });
  },
  
  /**
   * Get user info from persistent storage
   * @returns {Promise<Object|null>} User information or null if not found
   */
  async getUserInfoFromStorage() {
    try {
      console.log('Getting Twitch user info from persistent storage');
      
      // Try to get user info from persistent storage
      const userInfo = await PersistentStorage.getTwitchUserData();
      
      if (userInfo) {
        console.log('Found stored Twitch user info:', {
          display_name: userInfo.display_name,
          login: userInfo.login
        });
        return userInfo;
      }
      
      console.log('No stored Twitch user info found');
      return null;
    } catch (error) {
      console.error('Error getting Twitch user info from storage:', error);
      return null;
    }
  }
};