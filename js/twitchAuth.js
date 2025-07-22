// EloWard Twitch Authentication


import { PersistentStorage } from './persistentStorage.js';

/**
 * Twitch Authentication Module
 * This module handles the authentication flow with Twitch API
 * using the OAuth 2.0 protocol via a secure backend proxy.
 */

// Set default configuration if not provided
const defaultConfig = {
  // Make sure this URL is correct and matches a deployed instance
  proxyBaseUrl: 'https://eloward-twitchauth.unleashai.workers.dev',
  // Use an extension-specific redirect URI that's registered with Twitch
  redirectUri: 'https://www.eloward.com/ext/twitch/auth/redirect',
  // Make sure scopes match what's in the twitchRSO implementation
  scopes: 'user:read:email',
  endpoints: {
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

export const TwitchAuth = {
  // Twitch Configuration
  config: defaultConfig,
  
  // Reference to the auth window if opened
  authWindow: null,
  
  /**
   * Start the Twitch authentication flow
   */
  async authenticate() {
    try {
      
      // Clear any previous auth states
      await chrome.storage.local.remove([this.config.storageKeys.authState]);
      
      // Generate a unique state value for CSRF protection
      const state = this._generateRandomState();
      
      // Store the state for verification when the user returns
      await this._storeAuthState(state);
      
      // Get authentication URL from the backend proxy
      const authUrl = await this._getAuthUrl(state);
      
      // Clear any existing callbacks before opening the window
      try {
        await new Promise(resolve => {
          chrome.storage.local.remove(['auth_callback', 'twitch_auth_callback'], resolve);
        });
      } catch (e) {
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
        
        // Try fallback state verification
        const storedState = await this._getStoredAuthState();
        if (authResult.state !== storedState) {
          throw new Error('Security verification failed: state mismatch in Twitch auth');
        }
      }
      
      // Exchange the authorization code for tokens
      try {
        await this.exchangeCodeForTokens(authResult.code);
        
        // Even if getting user info fails, authentication is still considered successful
        // because we have valid tokens
        
        try {
          // Get user info (this already includes database registration)
          const userInfo = await this.getUserInfo();
          
          // Store the user info in persistent storage
          await PersistentStorage.storeTwitchUserData(userInfo);
          
          return userInfo;
                  } catch (userInfoError) {
            // Ensure we still consider the user authenticated
            await PersistentStorage.updateConnectedState('twitch', true);
            
            // Return minimal user object if full info unavailable
            return { authenticated: true };
          }
      } catch (tokenError) {
        // Make sure the authentication state is cleared on token exchange failure
        await PersistentStorage.updateConnectedState('twitch', false);
        throw tokenError;
      }
    } catch (error) {
      // Ensure the connected state is reset on any error
      try {
        await PersistentStorage.updateConnectedState('twitch', false);
      } catch (storageError) {
      }
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
      
      
      if (!response.ok) {
        await response.text();
        throw new Error(`Failed to get Twitch auth URL: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (!data || !data.authUrl) {
        throw new Error('Auth URL not found in response');
      }
      
      return data.authUrl;
    } catch (error) {
      throw error;
    }
  },
  
  /**
   * Open authentication window
   * @param {string} authUrl - The URL to open
   * @private
   */
  _openAuthWindow(authUrl) {
    
    try {
      // Close any existing auth window
      if (this.authWindow && !this.authWindow.closed) {
        this.authWindow.close();
      }
      
      // Try to open directly with window.open
      this.authWindow = window.open(authUrl, 'twitchAuthWindow', 'width=500,height=700');
      
      if (this.authWindow) {
        
        // Try to focus the window
        if (this.authWindow.focus) {
          this.authWindow.focus();
        }
      } else {
        // If window.open failed (likely due to popup blocker), try using the background script
        chrome.runtime.sendMessage({
          type: 'open_auth_window',
          url: authUrl,
          service: 'twitch'
        }, response => {
          if (chrome.runtime.lastError) {
            throw new Error('Failed to open authentication window - popup may be blocked');
          } else if (response && response.success) {
          } else {
            throw new Error('Failed to open authentication window - unknown error');
          }
        });
      }
    } catch (error) {
      throw error;
    }
  },
  
  /**
   * Wait for authentication callback from the auth window
   * @returns {Promise<Object>} The authorization code and state
   * @private
   */
  async _waitForAuthCallback() {
    
    return new Promise(resolve => {
      const maxWaitTime = 300000; // 5 minutes
      const checkInterval = 1000; // 1 second
      let elapsedTime = 0;
      let intervalId;
      
      // Function to check for auth callback data
      const checkForCallback = async () => {
        // Check chrome.storage for callback data
        const data = await new Promise(r => {
          chrome.storage.local.get(['auth_callback', 'twitch_auth_callback', this.config.storageKeys.authCallback], r);
        });
        
        // Check in multiple possible storage locations
        const callback = data.auth_callback || 
                         data.twitch_auth_callback || 
                         data[this.config.storageKeys.authCallback];
        
        if (callback) {
          
          // Check for error in the callback
          if (callback.error) {
          }
          
          // Stop the interval
          clearInterval(intervalId);
          
          // Clear the callback data from storage to prevent reuse
          try {
            chrome.storage.local.remove(
              ['auth_callback', 'twitch_auth_callback', this.config.storageKeys.authCallback], 
              () => {
              }
            );
          } catch (e) {
          }
          
          // Only resolve with the callback if it contains a code
          if (callback.code) {
            resolve(callback);
            return true;
          } else if (callback.error) {
            // Resolve with null if there's an error to signal cancellation
            resolve(null);
            return true;
          }
        }
        
        // Check if auth window was closed by user
        if (this.authWindow && this.authWindow.closed) {
          clearInterval(intervalId);
          
          // Try to check storage for any last-moment callbacks that might have been missed
          chrome.storage.local.get(['auth_callback', 'twitch_auth_callback', this.config.storageKeys.authCallback], 
            lastCheck => {
              const lastCallback = lastCheck.auth_callback || 
                                  lastCheck.twitch_auth_callback || 
                                  lastCheck[this.config.storageKeys.authCallback];
                                  
              if (lastCallback && lastCallback.code) {
                resolve(lastCallback);
              } else {
                resolve(null); // User cancelled
              }
              
              // Clear any callback data
              chrome.storage.local.remove(
                ['auth_callback', 'twitch_auth_callback', this.config.storageKeys.authCallback]
              );
            }
          );
          return true;
        }
        
        // Check if we've waited too long
        elapsedTime += checkInterval;
        if (elapsedTime >= maxWaitTime) {
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
        // Look for different variations of auth callback data formats
        if (event.data && 
            ((event.data.type === 'auth_callback' && event.data.code) || 
             (event.data.source === 'eloward_auth' && event.data.code) ||
             (event.data.service === 'twitch' && event.data.code) ||
             (event.data.code && (event.data.state || event.data.scope || event.data.token_type)))) {
          
          window.removeEventListener('message', messageListener);
          
          // Store in chrome.storage for consistency
          const callbackData = {
            ...event.data,
            timestamp: Date.now()
          };
          
          chrome.storage.local.set({
            'auth_callback': callbackData,
            'twitch_auth_callback': callbackData,
            [this.config.storageKeys.authCallback]: callbackData
          });
          
          resolve(event.data);
        } else if (event.data && event.data.error) {
          // Handle error messages
          window.removeEventListener('message', messageListener);
          resolve(null); // Treat as cancellation
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
      
      
      // Store the tokens
      await this._storeTokens(tokenData);
      
      // Immediately update the persistent storage connected state to prevent auth errors
      // This ensures the user is considered authenticated even before getting user info
      await PersistentStorage.updateConnectedState('twitch', true);
      
      return tokenData;
    } catch (error) {
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
      
    } catch (error) {
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
        return true;
      }
      
      // Fall back to token validation if not in persistent storage
      let hasValidToken = false;
      try {
        const token = await this.getValidToken();
        hasValidToken = !!token;
      } catch (e) {
      }
      
      return hasValidToken;
    } catch (error) {
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
      
      
      // Store the new tokens
      await this._storeTokens(tokenData);
      
      return tokenData;
    } catch (error) {
      throw error;
    }
  },
  
  /**
   * Completely disconnect and clear all Twitch data including persistent storage
   * @returns {Promise<boolean>} - Whether disconnect was successful
   */
  async disconnect() {
    try {
      
      // Clear persistent user data
      await PersistentStorage.clearServiceData('twitch');
      
      // Clear auth data from chrome.storage
      let keysToRemove = [
        this.config.storageKeys.accessToken,
        this.config.storageKeys.refreshToken,
        this.config.storageKeys.tokenExpiry,
        this.config.storageKeys.authState,
        'twitch_auth',
        'twitch_auth_callback',
        'eloward_auth_callback'
      ];
      
      await chrome.storage.local.remove(keysToRemove);
      
      return true;
    } catch (error) {
      return false;
    }
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
      
      // First try to get from persistent storage
      const storedUserInfo = await this.getUserInfoFromStorage();
      if (storedUserInfo) {
        return storedUserInfo;
      }
      
      // If not in storage, get fresh data via secure backend
      
      // Get a valid access token
      const accessToken = await this.getValidToken();
      
      if (!accessToken) {
        throw new Error('No valid access token for Twitch API');
      }
      
      // Call the secure backend endpoint to fetch and store user data
      const response = await fetch('https://eloward-twitchauth.unleashai.workers.dev/store-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          twitch_token: accessToken
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Backend error: ${response.status} ${errorData.error || response.statusText}`);
      }
      
      const result = await response.json();
      
      if (!result.success || !result.user_data) {
        throw new Error('Backend did not return valid user data');
      }
      
      const userInfo = result.user_data;
      
      // Store the user info locally for future use
      await this._storeUserInfo(userInfo);
      
      // Also store in persistent storage
      await PersistentStorage.storeTwitchUserData(userInfo);
      
      return userInfo;
    } catch (error) {
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
    } catch (error) {
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
          reject(error);
        } else {
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
      const userInfo = await PersistentStorage.getTwitchUserData();
      
      if (userInfo) {
        return userInfo;
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }
};