// EloWard Twitch Authentication
console.log('Loading TwitchAuth module...');

import { EloWardConfig } from './config.js';

/**
 * Twitch Authentication Module
 * This module handles the authentication flow with Twitch API
 * using the OAuth 2.0 protocol via a secure backend proxy.
 */

console.log('TwitchAuth module executing...');

// Safe localStorage wrapper to handle cases where localStorage is not available
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

// Set default configuration if not provided
const defaultConfig = {
  // Make sure this URL is correct and matches a deployed instance
  proxyBaseUrl: 'https://eloward-twitchrso.unleashai-inquiries.workers.dev',
  // Make sure this matches the STANDARD_REDIRECT_URI in twitchRSO/src/index.ts
  redirectUri: 'https://www.eloward.xyz/twitch/auth/redirect',
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
    authCallback: 'twitch_auth_callback'
  }
};

console.log('TwitchAuth config initialized with URL:', defaultConfig.proxyBaseUrl);
console.log('TwitchAuth endpoints:', Object.keys(defaultConfig.endpoints).join(', '));

export const TwitchAuth = {
  // Twitch Configuration
  config: defaultConfig,
  
  // Reference to the auth window if opened
  authWindow: null,
  
  /**
   * Run a diagnostic test that can be called from the console
   * Just call: TwitchAuth.runTest() from the console
   */
  async runTest() {
    console.log('🔍 Running TwitchAuth diagnostic test...');
    console.log('📋 Configuration:', {
      proxyBaseUrl: this.config.proxyBaseUrl,
      redirectUri: this.config.redirectUri,
      endpoints: Object.keys(this.config.endpoints)
    });
    
    // Test 1: Check storage access
    console.log('🔍 Test 1: Storage access');
    try {
      const testKey = 'twitch_auth_test';
      const testValue = 'test_' + Date.now();
      
      await this._storeValue(testKey, testValue);
      const retrieved = await this._getStoredValue(testKey);
      
      if (retrieved === testValue) {
        console.log('✅ Storage test passed - value stored and retrieved successfully');
      } else {
        console.warn('⚠️ Storage test failed - retrieved value does not match', {
          stored: testValue,
          retrieved
        });
      }
      
      // Clean up
      await chrome.storage.local.remove([testKey]);
    } catch (storageError) {
      console.error('❌ Storage test error:', storageError);
    }
    
    // Test 2: Check backend connectivity
    console.log('🔍 Test 2: Backend connectivity');
    try {
      const healthResponse = await fetch(`${this.config.proxyBaseUrl}/health`, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-cache'
      });
      
      if (healthResponse.ok) {
        const healthData = await healthResponse.text();
        console.log(`✅ Backend health check passed: ${healthData}`);
      } else {
        console.warn(`⚠️ Backend health check failed with status: ${healthResponse.status}`);
      }
    } catch (healthError) {
      console.error('❌ Backend connectivity test error:', healthError);
    }
    
    // Test 3: Try to generate an auth URL
    console.log('🔍 Test 3: Auth URL generation');
    try {
      const testState = this._generateRandomState();
      console.log('Generated test state:', testState.substring(0, 8) + '...');
      
      const authUrl = await this._getAuthUrl(testState);
      
      if (authUrl) {
        console.log('✅ Auth URL generation test passed:', authUrl.substring(0, 30) + '...');
      } else {
        console.warn('⚠️ Auth URL generation returned empty result');
      }
    } catch (authUrlError) {
      console.error('❌ Auth URL generation test error:', authUrlError);
    }
    
    // Test 4: Check authentication status
    console.log('🔍 Test 4: Current authentication status');
    try {
      const isAuthenticated = await this.isAuthenticated();
      console.log(`Authentication status: ${isAuthenticated ? 'Authenticated ✅' : 'Not authenticated ⚠️'}`);
      
      if (isAuthenticated) {
        const displayName = await this.getUserDisplayName();
        console.log(`Authenticated as: ${displayName || 'Unknown user'}`);
      }
    } catch (authError) {
      console.error('❌ Authentication status test error:', authError);
    }
    
    console.log('🔍 Diagnostic test complete');
  },
  
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
      console.log('Clearing any previous Twitch auth states');
      try {
        await chrome.storage.local.remove([this.config.storageKeys.authState]);
        localStorage.removeItem(this.config.storageKeys.authState);
      } catch (error) {
        console.error('Error clearing previous auth states:', error);
        // Continue despite this error
      }
      
      // Generate a unique state
      const state = this._generateRandomState();
      console.log(`Generated Twitch auth state: ${state}`);
      
      // Store the state in both chrome.storage and localStorage for redundancy
      await this._storeAuthState(state);
      
      console.log('Getting authentication URL from backend');
      
      // Get authentication URL from backend
      const authUrl = await this._getAuthUrl(state);
      console.log('Received auth URL:', authUrl ? 'valid URL' : 'empty or invalid URL');
      
      if (!authUrl) {
        throw new Error('Failed to get a valid authentication URL');
      }
      
      // Clear any existing callbacks before opening the window
      console.log('Clearing any existing Twitch auth callbacks');
      try {
        await new Promise(resolve => {
          chrome.storage.local.remove([this.config.storageKeys.authCallback], resolve);
        });
        localStorage.removeItem('eloward_twitch_auth_callback_data');
        console.log('Twitch auth callback data cleared from storage');
      } catch (e) {
        console.warn('Error clearing Twitch auth callbacks:', e);
        // Non-fatal error, continue with authentication
      }
      
      // Open the auth window
      this._openAuthWindow(authUrl);
      
      // Wait for the authentication callback
      const authResult = await this._waitForAuthCallback();
      
      if (!authResult || !authResult.code) {
        throw new Error('Twitch authentication cancelled or failed');
      }
      
      console.log('Twitch auth callback received with state:', authResult.state);
      
      // Verify the state parameter to prevent CSRF attacks
      if (authResult.state !== state) {
        console.error('State mismatch during Twitch authentication:', {
          receivedState: authResult.state ? `${authResult.state.substring(0, 8)}...` : 'undefined',
          expectedState: state ? `${state.substring(0, 8)}...` : 'undefined'
        });
        
        // Try fallback state check using storage
        const storedState = await this._getStoredAuthState();
        
        if (authResult.state !== storedState) {
          // Security failure - state mismatch indicates potential CSRF attack
          throw new Error('Security verification failed: state parameter mismatch. Please try again.');
        }
      }
      
      console.log('Proceeding with token exchange for code');
      
      // Exchange code for tokens
      const tokenData = await this.exchangeCodeForTokens(authResult.code);
      
      // Get user data
      const userData = await this.getUserInfo();
      
      return userData;
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
    // Store in chrome.storage.local
    await new Promise(resolve => {
      chrome.storage.local.set({ [this.config.storageKeys.authState]: state }, resolve);
    });
    
    // Also try to store in localStorage for redundancy
    safeStorage.setItem(this.config.storageKeys.authState, state);
    
    console.log('Stored Twitch auth state in both storage locations:', {
      state: state.substring(0, 8) + '...'
    });
  },
  
  /**
   * Retrieve stored authentication state
   * @returns {Promise<string|null>} The stored state or null if not found
   * @private
   */
  async _getStoredAuthState() {
    // Try to get from chrome.storage.local first
    const chromeStorage = await new Promise(resolve => {
      chrome.storage.local.get([this.config.storageKeys.authState], result => {
        resolve(result[this.config.storageKeys.authState]);
      });
    });
    
    if (chromeStorage) {
      console.log('Retrieved Twitch auth state from chrome.storage');
      return chromeStorage;
    }
    
    // Fall back to localStorage
    const localStorageState = safeStorage.getItem(this.config.storageKeys.authState);
    
    if (localStorageState) {
      console.log('Retrieved Twitch auth state from localStorage');
      return localStorageState;
    }
    
    console.warn('Could not retrieve Twitch auth state from any storage');
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
      // First, check if the endpoint is reachable with a basic health check
      console.log('Testing TwitchRSO backend reachability...');
      try {
        const healthCheck = await fetch(`${this.config.proxyBaseUrl}/health`, {
          method: 'GET',
          mode: 'cors',
          credentials: 'omit'
        });
        
        if (healthCheck.ok) {
          console.log('✅ TwitchRSO backend is reachable:', await healthCheck.text());
        } else {
          console.warn('⚠️ TwitchRSO backend health check failed:', healthCheck.status);
        }
      } catch (healthError) {
        console.error('❌ TwitchRSO backend unreachable:', healthError);
        // Continue anyway to try the actual request
      }
      
      console.log('Fetching Twitch auth URL from:', `${this.config.proxyBaseUrl}${this.config.endpoints.authInit}`);
      console.log('With payload:', {
        state: state.substring(0, 8) + '...',
        scopes: this.config.scopes,
        redirect_uri: this.config.redirectUri
      });
      
      // Try with plain fetch to see if the request works
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      try {
        const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.authInit}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          mode: 'cors',
          credentials: 'omit',
          body: JSON.stringify({
            state,
            scopes: this.config.scopes,
            redirect_uri: this.config.redirectUri
          }),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        console.log('Auth URL response status:', response.status);
        
        // Check if the response is ok (status in the range 200-299)
        if (!response.ok) {
          const errorText = await response.text();
          console.error('Error response content:', errorText);
          throw new Error(`Failed to get Twitch auth URL: ${response.status} ${response.statusText}`);
        }
        
        let data;
        try {
          data = await response.json();
          console.log('Auth URL response data:', data);
        } catch (jsonError) {
          console.error('Error parsing auth URL JSON response:', jsonError);
          const rawText = await response.text();
          console.log('Raw response text:', rawText);
          throw new Error('Invalid JSON response from auth URL endpoint');
        }
        
        if (!data || !data.authUrl) {
          console.error('Auth URL not found in response data:', data);
          throw new Error('Auth URL not found in response');
        }
        
        console.log('Received Twitch auth URL:', data.authUrl.substring(0, 50) + '...');
        return data.authUrl;
      } catch (fetchError) {
        if (fetchError.name === 'AbortError') {
          console.error('Request timed out');
          throw new Error('Request to get auth URL timed out after 10 seconds');
        }
        throw fetchError;
      }
    } catch (error) {
      console.error('Error getting Twitch auth URL:', error);
      // Make sure we throw an error that will be caught by the authenticate method
      throw error;
    }
  },
  
  /**
   * Open authentication window
   * @param {string} authUrl - The URL to open
   * @private
   */
  _openAuthWindow(authUrl) {
    // Close any existing auth window
    if (this.authWindow && !this.authWindow.closed) {
      this.authWindow.close();
    }
    
    // Calculate center position for the window
    const width = 800;
    const height = 700;
    const left = (window.screen.width / 2) - (width / 2);
    const top = (window.screen.height / 2) - (height / 2);
    
    // Open a new window in the center of the screen
    this.authWindow = window.open(
      authUrl,
      'eloward_twitch_auth',
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=yes`
    );
    
    if (!this.authWindow) {
      throw new Error('Failed to open authentication window. Please allow popups for this site.');
    }
    
    console.log('Opened Twitch auth window');
  },
  
  /**
   * Wait for authentication callback from the auth window
   * @returns {Promise<Object>} The authorization code and state
   * @private
   */
  async _waitForAuthCallback() {
    return new Promise((resolve, reject) => {
      let timeoutId;
      
      const checkForCallback = async () => {
        console.log('Checking for Twitch auth callback');
        
        try {
          // Check chrome.storage.local for auth callback data using multiple possible keys
          const callbackKeys = [
            this.config.storageKeys.authCallback,
            'twitch_auth_callback',
            'auth_callback'
          ];
          
          console.log('Checking for callback in these storage keys:', callbackKeys);
          
          const callbackData = await new Promise(storageResolve => {
            chrome.storage.local.get(callbackKeys, result => {
              // Check each possible key
              for (const key of callbackKeys) {
                if (result[key]) {
                  console.log(`Found callback data in key: ${key}`);
                  return storageResolve(result[key]);
                }
              }
              storageResolve(null);
            });
          });
          
          if (callbackData) {
            console.log('Found Twitch auth callback in chrome.storage:', {
              hasCode: !!callbackData.code,
              hasState: !!callbackData.state
            });
            
            // Clear the timeout
            clearTimeout(timeoutId);
            
            // Clear the interval
            clearInterval(intervalId);
            
            // Clean up the callback data from all possible keys
            chrome.storage.local.remove(callbackKeys);
            
            // Clean up the auth window if it's still open
            if (this.authWindow && !this.authWindow.closed) {
              this.authWindow.close();
              this.authWindow = null;
            }
            
            // Resolve the promise with the callback data
            resolve(callbackData);
            return true;
          }
          
          // Also check localStorage as a fallback
          try {
            const localStorageData = localStorage.getItem('eloward_twitch_auth_callback_data');
            if (localStorageData) {
              const parsedData = JSON.parse(localStorageData);
              console.log('Found callback data in localStorage');
              
              // Clear the interval and timeout
              clearInterval(intervalId);
              clearTimeout(timeoutId);
              
              // Clean up localStorage
              localStorage.removeItem('eloward_twitch_auth_callback_data');
              
              // Clean up the auth window
              if (this.authWindow && !this.authWindow.closed) {
                this.authWindow.close();
                this.authWindow = null;
              }
              
              resolve(parsedData);
              return true;
            }
          } catch (localStorageError) {
            console.warn('Error checking localStorage:', localStorageError);
          }
          
          // Check if auth window is still open
          if (!this.authWindow || this.authWindow.closed) {
            console.warn('Twitch auth window was closed');
            clearInterval(intervalId);
            clearTimeout(timeoutId);
            reject(new Error('Authentication cancelled by user'));
            return true;
          }
          
          return false;
        } catch (error) {
          console.error('Error checking for Twitch auth callback:', error);
          return false;
        }
      };
      
      // Set up an interval to check for the callback
      const intervalId = setInterval(checkForCallback, 1000);
      
      // Set a timeout to reject the promise after 5 minutes
      timeoutId = setTimeout(() => {
        clearInterval(intervalId);
        
        // Clean up the auth window if it's still open
        if (this.authWindow && !this.authWindow.closed) {
          this.authWindow.close();
          this.authWindow = null;
        }
        
        reject(new Error('Authentication timed out after 5 minutes'));
      }, 5 * 60 * 1000);
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
    console.log('Checking if authenticated with Twitch...');
    try {
      // First check if we have tokens in storage
      const accessToken = await this._getStoredValue(this.config.storageKeys.accessToken);
      const refreshToken = await this._getStoredValue(this.config.storageKeys.refreshToken);
      
      console.log('Found Twitch tokens in storage:', {
        hasAccessToken: !!accessToken,
        hasRefreshToken: !!refreshToken
      });
      
      if (!accessToken) {
        console.log('No Twitch access token found, not authenticated');
        return false;
      }
      
      if (!refreshToken) {
        console.log('No Twitch refresh token found, but has access token');
        // We could decide to still consider authenticated with just access token
        // but it's safer to require both
        return false;
      }
      
      try {
        // Try to get a valid token which might refresh if needed
        const token = await this.getValidToken();
        const isValid = !!token;
        console.log('Twitch token validation result:', isValid);
        return isValid;
      } catch (tokenError) {
        console.warn('Error validating Twitch token:', tokenError);
        return false;
      }
    } catch (error) {
      console.log('Error checking Twitch authentication status:', error);
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
        throw new Error('No access token found');
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
   * @returns {Promise<void>}
   */
  async logout() {
    try {
      console.log('Logging out from Twitch');
      
      // Clear all stored token data
      await chrome.storage.local.remove([
        this.config.storageKeys.accessToken,
        this.config.storageKeys.refreshToken,
        this.config.storageKeys.tokenExpiry,
        this.config.storageKeys.tokens,
        this.config.storageKeys.userInfo
      ]);
      
      // Also clear from localStorage for completeness
      localStorage.removeItem(this.config.storageKeys.accessToken);
      localStorage.removeItem(this.config.storageKeys.refreshToken);
      localStorage.removeItem(this.config.storageKeys.tokenExpiry);
      localStorage.removeItem(this.config.storageKeys.tokens);
      localStorage.removeItem(this.config.storageKeys.userInfo);
      
      console.log('Successfully logged out from Twitch');
    } catch (error) {
      console.error('Error logging out from Twitch:', error);
      throw error;
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
      console.log('Getting Twitch user information');
      
      // Check for cached user info first
      const cachedUserInfo = await this._getStoredValue(this.config.storageKeys.userInfo);
      
      if (cachedUserInfo) {
        try {
          const userInfo = JSON.parse(cachedUserInfo);
          console.log('Using cached Twitch user info');
          return userInfo;
        } catch (e) {
          console.warn('Invalid cached Twitch user info, fetching new data');
        }
      }
      
      // Get a valid token
      const token = await this.getValidToken();
      
      // Fetch user info
      const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.userInfo}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to get user info: ${response.status} ${response.statusText}`);
      }
      
      const userInfo = await response.json();
      
      if (!userInfo || !userInfo.id) {
        throw new Error('Invalid user info response');
      }
      
      console.log('Successfully fetched Twitch user info');
      
      // Store the user info
      await this._storeUserInfo(userInfo);
      
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
   * Get user display name if authenticated
   * @returns {Promise<string|null>} The user's display name or null if not authenticated
   */
  async getUserDisplayName() {
    try {
      const userInfo = await this.getUserInfo();
      return userInfo.display_name || userInfo.login || null;
    } catch (error) {
      console.log('Could not get Twitch display name:', error.message);
      return null;
    }
  },
  
  /**
   * Store a value in chrome.storage.local and localStorage
   * @param {string} key - The key to store under
   * @param {string} value - The value to store
   * @private
   */
  async _storeValue(key, value) {
    // Store in chrome.storage.local
    await new Promise(resolve => {
      chrome.storage.local.set({ [key]: value }, resolve);
    });
    
    // Also try to store in localStorage for redundancy
    safeStorage.setItem(key, value);
  },
  
  /**
   * Get a stored value, checking both storage locations
   * @param {string} key - The key to retrieve
   * @returns {Promise<string|null>} The stored value or null if not found
   * @private
   */
  async _getStoredValue(key) {
    // Try to get from chrome.storage.local first
    const chromeStorage = await new Promise(resolve => {
      chrome.storage.local.get([key], result => {
        resolve(result[key]);
      });
    });
    
    if (chromeStorage) {
      return chromeStorage;
    }
    
    // Fall back to localStorage
    return safeStorage.getItem(key);
  }
};

// Initialize with default config
TwitchAuth.init();

// Expose TwitchAuth globally for testing
window.TwitchAuth = TwitchAuth;

// Add a global helper function that can be called from anywhere
window.runTwitchAuthTest = function() {
  console.log("Running TwitchAuth test from global function...");
  TwitchAuth.runTest();
}; 