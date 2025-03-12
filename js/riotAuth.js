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

// Set default configuration if not provided
const defaultConfig = {
  proxyBaseUrl: 'https://eloward-riotrso.unleashai-inquiries.workers.dev',
  clientId: '38a4b902-7186-44ac-8183-89ba1ac56cf3',
  redirectUri: 'https://www.eloward.xyz/auth/redirect',
  endpoints: {
    authInit: '/auth/init',
    authToken: '/auth/token',
    authRefresh: '/auth/token/refresh',
    accountInfo: '/riot/account/v1/accounts/me',
    summonerInfo: '/riot/summoner',
    leagueEntries: '/riot/league/entries'
  },
  storageKeys: {
    accessToken: 'eloward_riot_access_token',
    refreshToken: 'eloward_riot_refresh_token',
    tokenExpiry: 'eloward_riot_token_expiry',
    tokens: 'eloward_riot_tokens',
    accountInfo: 'eloward_riot_account_info',
    summonerInfo: 'eloward_riot_summoner_info',
    rankInfo: 'eloward_riot_rank_info',
    authState: 'eloward_auth_state',
    authCallback: 'authCallback',
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
      localStorage.removeItem(this.config.storageKeys.authState);
      
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
          chrome.storage.local.remove(['auth_callback', 'eloward_auth_callback'], resolve);
        });
        localStorage.removeItem('eloward_auth_callback_data');
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
    // Store in chrome.storage.local
    await new Promise(resolve => {
      chrome.storage.local.set({
        [this.config.storageKeys.authState]: state
      }, resolve);
    });
    console.log(`Stored auth state in chrome.storage: ${state}`);
    
    // Also store in localStorage as backup
    try {
      localStorage.setItem(this.config.storageKeys.authState, state);
      console.log(`Stored auth state in localStorage: ${state}`);
    } catch (e) {
      console.error('Failed to store auth state in localStorage:', e);
    }
  },
  
  /**
   * Get stored authentication state from storage
   * @returns {Promise<string|null>} - The stored state or null if not found
   * @private
   */
  async _getStoredAuthState() {
    // Try chrome.storage.local first
    const chromeData = await new Promise(resolve => {
      chrome.storage.local.get([this.config.storageKeys.authState], resolve);
    });
    
    const chromeState = chromeData[this.config.storageKeys.authState];
    if (chromeState) {
      return chromeState;
    }
    
    // Try localStorage as fallback
    try {
      const localState = localStorage.getItem(this.config.storageKeys.authState);
      if (localState) {
        return localState;
      }
    } catch (e) {
      console.error('Error retrieving state from localStorage:', e);
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
        
        // Check localStorage as fallback
        try {
          const localStorageData = localStorage.getItem('eloward_auth_callback_data');
          if (localStorageData) {
            try {
              const parsedData = JSON.parse(localStorageData);
              if (parsedData && parsedData.code) {
                console.log('Auth callback found in localStorage');
                clearInterval(intervalId);
                
                // Clear the callback data
                localStorage.removeItem('eloward_auth_callback_data');
                
                resolve(parsedData);
                return true;
              }
            } catch (e) {
              console.warn('Error parsing auth callback from localStorage:', e);
            }
          }
        } catch (e) {
          console.warn('Error accessing localStorage for auth callback:', e);
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
      
      if (!tokenData.access_token) {
        throw new Error('Invalid token response: Missing access token');
      }
      
      console.log('Received tokens with expiry in', tokenData.expires_in, 'seconds');
      
      // Calculate token expiry timestamp
      const expiresAt = Date.now() + (tokenData.expires_in * 1000);
      
      // Update token data with expiry timestamp
      const tokens = {
        ...tokenData,
        expires_at: expiresAt
      };
      
      // Store tokens in storage
      await this._storeTokens(tokens);
      
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
      
      // Also store in localStorage as backup
      try {
        // Store each item individually - more resilient than storing everything at once
        localStorage.setItem(this.config.storageKeys.accessToken, tokenData.access_token);
        localStorage.setItem(this.config.storageKeys.tokenExpiry, tokenExpiry.toString());
        
        if (tokenData.refresh_token) {
          localStorage.setItem(this.config.storageKeys.refreshToken, tokenData.refresh_token);
        }
        
        localStorage.setItem(this.config.storageKeys.tokens, JSON.stringify({
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_in: expiresIn,
          token_type: tokenData.token_type,
          stored_at: Date.now()
        }));
        
        console.log('Token data also stored in localStorage for redundancy');
      } catch (e) {
        console.error('Failed to store token data in localStorage:', e);
        // Non-fatal error, we still have the data in chrome.storage
      }
    } catch (error) {
      console.error('Error storing tokens:', error);
      throw error;
    }
  },
  
  /**
   * Check if user is authenticated
   * @returns {Promise<boolean>} - True if authenticated
   */
  async isAuthenticated() {
    try {
      await this.getValidToken();
      return true;
    } catch (error) {
      return false;
    }
  },
  
  /**
   * Get a valid access token, refreshing if necessary
   * @returns {Promise<string>} - The valid access token
   */
  async getValidToken() {
    try {
      console.log('Getting valid access token...');
      
      // Try to get tokens from storage
      const accessToken = await this._getStoredValue(this.config.storageKeys.accessToken);
      const refreshToken = await this._getStoredValue(this.config.storageKeys.refreshToken);
      const tokenExpiry = await this._getStoredValue(this.config.storageKeys.tokenExpiry);
      
      // Log token availability (without exposing actual tokens)
      console.log('Token status:', {
        hasAccessToken: !!accessToken,
        accessTokenLength: accessToken ? accessToken.length : 0,
        accessTokenPrefix: accessToken ? accessToken.substring(0, 8) + '...' : 'undefined',
        hasRefreshToken: !!refreshToken,
        refreshTokenLength: refreshToken ? refreshToken.length : 0,
        hasExpiryTimestamp: !!tokenExpiry,
        expiryTimeISO: tokenExpiry ? new Date(parseInt(tokenExpiry)).toISOString() : 'undefined'
      });
      
      if (!accessToken) {
        console.error('No access token found in storage');
        throw new Error('No access token found');
      }
      
      // Check if token is expired or will expire soon
      const now = Date.now();
      const tokenExpiryMs = typeof tokenExpiry === 'string' ? parseInt(tokenExpiry) : tokenExpiry;
      
      if (isNaN(tokenExpiryMs)) {
        console.error('Invalid token expiry timestamp:', tokenExpiry);
        
        // If we have a refresh token, try to use it instead of failing
        if (refreshToken) {
          console.log('Invalid expiry but refresh token available, attempting refresh');
          const newAccessToken = await this.refreshToken(refreshToken);
          return newAccessToken;
        }
        
        throw new Error('Invalid token expiry timestamp');
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
          throw new Error('Access token expired and no refresh token available');
        }
        
        // Refresh the token
        console.log('Refreshing access token using refresh token');
        const newAccessToken = await this.refreshToken(refreshToken);
        console.log('Token refresh successful');
        return newAccessToken;
      }
      
      // Token is valid
      console.log('Using existing valid access token');
      return accessToken;
    } catch (error) {
      console.error('Error getting valid token:', error);
      throw new Error('No access token available. Please authenticate first.');
    }
  },
  
  /**
   * Get a value from storage, trying both chrome.storage and localStorage
   * @param {string} key - The key to get
   * @returns {Promise<string|null>} - The stored value or null
   * @private
   */
  async _getStoredValue(key) {
    try {
      console.log(`Retrieving stored value for key: ${key}`);
      
      // Try chrome.storage first
      const chromeData = await new Promise(resolve => {
        chrome.storage.local.get([key], resolve);
      });
      
      if (chromeData[key] !== undefined) {
        console.log(`Found value in chrome.storage for key: ${key}`, 
                   typeof chromeData[key] === 'object' ? 'Type: object' : 
                   `Type: ${typeof chromeData[key]}`);
        return chromeData[key];
      }
      
      // Try localStorage as fallback
      try {
        const localValue = localStorage.getItem(key);
        if (localValue !== null) {
          console.log(`Found value in localStorage for key: ${key}`);
          
          // For objects stored in localStorage, we need to parse the JSON
          if (localValue.startsWith('{') || localValue.startsWith('[')) {
            try {
              const parsedValue = JSON.parse(localValue);
              console.log(`Parsed JSON for key: ${key}`);
              return parsedValue;
            } catch (parseError) {
              console.warn(`Failed to parse JSON for key: ${key}, using raw value`);
              return localValue;
            }
          }
          
          return localValue;
        }
      } catch (e) {
        console.error(`Error accessing localStorage for key: ${key}`, e);
      }
      
      console.log(`No stored value found for key: ${key}`);
      return null;
    } catch (error) {
      console.error(`Error in _getStoredValue for key: ${key}`, error);
      return null;
    }
  },
  
  /**
   * Refresh the access token using a refresh token
   * @param {string} refreshToken - The refresh token
   * @returns {Promise<Object>} - The refreshed token data
   */
  async refreshToken(refreshToken) {
    try {
      console.log('Refreshing access token...');
      
      if (!refreshToken) {
        throw new Error('No refresh token provided');
      }
      
      // Use the correct token refresh endpoint
      const requestUrl = `${this.config.proxyBaseUrl}${this.config.endpoints.authRefresh}`;
      console.log(`Making token refresh request to: ${requestUrl}`);
      
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          refresh_token: refreshToken
        })
      });
      
      if (!response.ok) {
        // Try to parse error response
        const errorData = await response.json().catch(() => ({}));
        console.error('Token refresh error:', errorData);
        throw new Error(`Token refresh failed: ${response.status} ${errorData.error_description || errorData.message || response.statusText}`);
      }
      
      // Parse the refresh response
      const refreshData = await response.json();
      
      if (!refreshData.access_token) {
        throw new Error('Invalid token refresh response: Missing access token');
      }
      
      console.log('Successfully refreshed access token, expires in', refreshData.expires_in, 'seconds');
      
      // Calculate token expiry timestamp
      const expiresAt = Date.now() + (refreshData.expires_in * 1000);
      
      // Update token data with expiry timestamp
      const tokens = {
        ...refreshData,
        expires_at: expiresAt
      };
      
      // Store the refreshed tokens
      await this._storeTokens(tokens);
      
      return tokens;
    } catch (error) {
      console.error('Error refreshing token:', error);
      throw new Error(`Failed to refresh access token: ${error.message}`);
    }
  },
  
  /**
   * Logout the user
   * @returns {Promise<void>}
   */
  async logout() {
    // Clear tokens from chrome.storage
    await new Promise(resolve => {
      chrome.storage.local.remove([
        this.config.storageKeys.accessToken,
        this.config.storageKeys.refreshToken,
        this.config.storageKeys.tokenExpiry,
        this.config.storageKeys.tokens,
        this.config.storageKeys.accountInfo,
        this.config.storageKeys.summonerInfo,
        this.config.storageKeys.rankInfo,
        this.config.storageKeys.authState,
        'riotAuth',
        'auth_callback',
        'eloward_auth_callback'
      ], resolve);
    });
    
    // Clear tokens from localStorage
    try {
      localStorage.removeItem(this.config.storageKeys.accessToken);
      localStorage.removeItem(this.config.storageKeys.refreshToken);
      localStorage.removeItem(this.config.storageKeys.tokenExpiry);
      localStorage.removeItem(this.config.storageKeys.tokens);
      localStorage.removeItem(this.config.storageKeys.accountInfo);
      localStorage.removeItem(this.config.storageKeys.summonerInfo);
      localStorage.removeItem(this.config.storageKeys.rankInfo);
      localStorage.removeItem(this.config.storageKeys.authState);
      localStorage.removeItem('eloward_auth_callback_data');
    } catch (e) {
      console.error('Error clearing localStorage:', e);
    }
    
    console.log('Logged out successfully');
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
      
      // First try the Riot Account v1 API endpoint
      try {
        const requestUrl = `${this.config.proxyBaseUrl}${this.config.endpoints.accountInfo}?region=${regionalRoute}`;
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
                gameName: idTokenPayload.game_name || 'Summoner',
                tagLine: idTokenPayload.tag_line || 'Unknown'
              };
              console.log('Extracted account info from ID token');
            }
          } catch (tokenError) {
            console.warn('Error extracting account info from ID token:', tokenError);
          }
        }
      }
      
      // If we still don't have account info, try third fallback option
      if (!accountInfo) {
        // Try alternative API endpoint
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
      
      // Ensure we have gameName and tagLine (some endpoints might not provide these)
      if (!accountInfo.gameName) {
        accountInfo.gameName = 'Summoner';
        console.log('Using default gameName: Summoner');
      }
      
      if (!accountInfo.tagLine) {
        accountInfo.tagLine = 'NA1';
        console.log('Using default tagLine: NA1');
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
    await new Promise(resolve => {
      chrome.storage.local.set({
        [this.config.storageKeys.accountInfo]: accountInfo
      }, resolve);
    });
    
    try {
      localStorage.setItem(this.config.storageKeys.accountInfo, JSON.stringify(accountInfo));
    } catch (e) {
      console.error('Failed to store account info in localStorage:', e);
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
   * Get summoner info using PUUID
   * @param {string} puuid - The player's PUUID
   * @returns {Promise<Object>} - Summoner info object
   */
  async getSummonerInfo(puuid) {
    try {
      if (!puuid) {
        throw new Error('PUUID is required to get summoner info');
      }
      
      console.log('Fetching summoner info for PUUID:', puuid.substring(0, 8) + '...');
      
      // Get access token
      const token = await this.getValidToken();
      
      // Get selected region or default to NA1
      const platform = await this._getStoredValue('selectedRegion') || 'na1';
      
      // Convert platform to region (e.g., na1 -> americas)
      const region = this._getRegionalRouteFromPlatform(platform);
      
      let summonerInfo = null;
      let error = null;
      
      // Try primary endpoint first
      try {
        // Try the endpoint with region and puuid as query parameters
        const requestUrl = `${this.config.proxyBaseUrl}${this.config.endpoints.summonerInfo}?region=${platform}&puuid=${puuid}`;
        console.log('Making summoner info request to:', requestUrl);
        
        const response = await fetch(requestUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        console.log('Summoner info response status:', response.status, response.statusText);
        
        if (response.ok) {
          summonerInfo = await response.json();
          console.log('Successfully retrieved summoner info from primary endpoint');
        } else {
          // Store error but try fallback
          const errorData = await response.json().catch(() => ({}));
          error = new Error(`Failed to get summoner info from primary endpoint: ${response.status} ${errorData.error_description || errorData.message || response.statusText}`);
          console.warn(error.message);
        }
      } catch (primaryError) {
        error = primaryError;
        console.warn('Error with primary summoner endpoint:', primaryError);
      }
      
      // Try fallback endpoint if primary failed
      if (!summonerInfo) {
        try {
          // Try alternative endpoint structure with puuid in path
          const fallbackUrl = `${this.config.proxyBaseUrl}/riot/summoner/by-puuid/${puuid}?region=${platform}`;
          console.log('Making fallback summoner info request to:', fallbackUrl);
          
          const response = await fetch(fallbackUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
          
          if (response.ok) {
            summonerInfo = await response.json();
            console.log('Successfully retrieved summoner info from fallback endpoint');
          } else {
            // If this also fails, log but continue
            const errorData = await response.json().catch(() => ({}));
            console.error('Fallback summoner endpoint also failed:', errorData);
          }
        } catch (fallbackError) {
          console.error('Error with fallback summoner endpoint:', fallbackError);
        }
      }
      
      // If we have no summoner info after all attempts, create a minimal one
      if (!summonerInfo) {
        // If we can't get summoner info, create a minimal one with just the PUUID
        // This allows us to continue and at least show some user data
        console.warn('Unable to retrieve summoner info, creating minimal record');
        summonerInfo = {
          id: puuid.substring(0, 16),  // Use part of PUUID as ID
          puuid: puuid,
          name: 'Unknown Summoner',
          summonerLevel: 0,
          profileIconId: 1
        };
      }
      
      // Ensure we have required fields
      if (!summonerInfo.id) {
        summonerInfo.id = puuid.substring(0, 16);
      }
      
      // Store summoner info
      await this._storeSummonerInfo(summonerInfo);
      
      console.log('Using summoner info:', {
        id: summonerInfo.id.substring(0, 8) + '...',
        name: summonerInfo.name,
        level: summonerInfo.summonerLevel
      });
      
      return summonerInfo;
    } catch (error) {
      console.error('Error getting summoner info:', error);
      throw error;
    }
  },
  
  /**
   * Store summoner info in storage
   * @param {Object} summonerInfo - Summoner info to store
   * @private
   */
  async _storeSummonerInfo(summonerInfo) {
    await new Promise(resolve => {
      chrome.storage.local.set({
        [this.config.storageKeys.summonerInfo]: summonerInfo
      }, resolve);
    });
    
    try {
      localStorage.setItem(this.config.storageKeys.summonerInfo, JSON.stringify(summonerInfo));
    } catch (e) {
      console.error('Failed to store summoner info in localStorage:', e);
    }
  },
  
  /**
   * Get player's rank information
   * @param {string} summonerId - The encrypted summoner ID
   * @returns {Promise<Array>} - Array of league entries for the player
   */
  async getRankInfo(summonerId) {
    try {
      if (!summonerId) {
        throw new Error('Summoner ID is required to get rank info');
      }
      
      console.log(`Fetching rank info for summoner ID: ${summonerId.substring(0, 8)}...`);
      
      // Get access token
      const token = await this.getValidToken();
      
      // Get selected platform/region or default to NA1
      const platform = await this._getStoredValue('selectedRegion') || 'na1';
      
      let rankData = null;
      let error = null;
      
      // Try primary endpoint first
      try {
        const requestUrl = `${this.config.proxyBaseUrl}${this.config.endpoints.leagueEntries}?region=${platform}&summonerId=${summonerId}`;
        console.log('Making rank info request to:', requestUrl);
        
        const response = await fetch(requestUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        console.log('Rank info response status:', response.status, response.statusText);
        
        if (response.ok) {
          rankData = await response.json();
          console.log('Successfully retrieved rank info from primary endpoint');
        } else {
          // Store error but try fallback
          const errorData = await response.json().catch(() => ({}));
          error = new Error(`Failed to get rank info from primary endpoint: ${response.status} ${errorData.error_description || errorData.message || response.statusText}`);
          console.warn(error.message);
        }
      } catch (primaryError) {
        error = primaryError;
        console.warn('Error with primary rank endpoint:', primaryError);
      }
      
      // Try fallback endpoint if primary failed
      if (!rankData) {
        try {
          // Try alternative endpoint structure
          const fallbackUrl = `${this.config.proxyBaseUrl}/riot/league/entries/by-summoner/${summonerId}?region=${platform}`;
          console.log('Making fallback rank info request to:', fallbackUrl);
          
          const response = await fetch(fallbackUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
          
          if (response.ok) {
            rankData = await response.json();
            console.log('Successfully retrieved rank info from fallback endpoint');
          } else {
            // If this also fails, log but continue
            const errorData = await response.json().catch(() => ({}));
            console.error('Fallback rank endpoint also failed:', errorData);
          }
        } catch (fallbackError) {
          console.error('Error with fallback rank endpoint:', fallbackError);
        }
      }
      
      // If we couldn't get rank data, return empty array to indicate unranked
      if (!rankData) {
        console.warn('Unable to retrieve rank data, assuming unranked');
        rankData = [];
      }
      
      // Ensure rankData is an array
      if (!Array.isArray(rankData)) {
        if (rankData && typeof rankData === 'object') {
          // If it's an object but not an array, wrap it
          rankData = [rankData];
        } else {
          // If it's anything else, use empty array
          rankData = [];
        }
      }
      
      // Store rank info
      await this._storeRankInfo(rankData);
      
      if (rankData.length > 0) {
        console.log(`Successfully retrieved ${rankData.length} league entries`);
        
        // Log the Solo/Duo queue rank if available
        const soloQueueEntry = rankData.find(entry => entry.queueType === 'RANKED_SOLO_5x5');
        if (soloQueueEntry) {
          console.log('Solo/Duo rank:', {
            tier: soloQueueEntry.tier,
            rank: soloQueueEntry.rank,
            lp: soloQueueEntry.leaguePoints,
            wins: soloQueueEntry.wins,
            losses: soloQueueEntry.losses
          });
        } else {
          console.log('No Solo/Duo queue rank found');
        }
      } else {
        console.log('No ranked data found, player is unranked');
      }
      
      return rankData;
    } catch (error) {
      console.error('Error getting rank info:', error);
      throw error;
    }
  },
  
  /**
   * Store rank info in storage
   * @param {Object} rankInfo - Rank info to store
   * @private
   */
  async _storeRankInfo(rankInfo) {
    await new Promise(resolve => {
      chrome.storage.local.set({
        [this.config.storageKeys.rankInfo]: rankInfo
      }, resolve);
    });
    
    try {
      localStorage.setItem(this.config.storageKeys.rankInfo, JSON.stringify(rankInfo));
    } catch (e) {
      console.error('Failed to store rank info in localStorage:', e);
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
   * Get comprehensive user data from Riot API
   * @returns {Promise<Object>} - User data
   */
  async getUserData() {
    try {
      console.log('Getting comprehensive user data...');
      
      if (!await this.isAuthenticated()) {
        throw new Error('Not authenticated. Please connect your Riot account first.');
      }
      
      // First check if we already have complete account and summoner info in storage
      try {
        const storedAccountInfo = await this._getStoredValue(this.config.storageKeys.accountInfo);
        const storedSummonerInfo = await this._getStoredValue(this.config.storageKeys.summonerInfo);
        const storedRankInfo = await this._getStoredValue(this.config.storageKeys.rankInfo);
        
        console.log('Checking stored data:', { 
          hasAccountInfo: !!storedAccountInfo, 
          hasSummonerInfo: !!storedSummonerInfo,
          hasRankInfo: !!storedRankInfo
        });
        
        // If we have valid complete data, use it without making new API calls
        if (storedAccountInfo && 
            typeof storedAccountInfo === 'object' && 
            storedAccountInfo.puuid &&
            storedAccountInfo.gameName && 
            storedAccountInfo.tagLine &&
            storedSummonerInfo &&
            typeof storedSummonerInfo === 'object' &&
            storedSummonerInfo.id) {
          
          console.log('Using complete stored user data');
          
          // Format into a single user data object
          const userData = {
            gameName: storedAccountInfo.gameName,
            tagLine: storedAccountInfo.tagLine,
            puuid: storedAccountInfo.puuid,
            summonerId: storedSummonerInfo.id,
            summonerName: storedSummonerInfo.name,
            summonerLevel: storedSummonerInfo.summonerLevel,
            profileIconId: storedSummonerInfo.profileIconId,
            rankInfo: storedRankInfo && Array.isArray(storedRankInfo) ? 
                      storedRankInfo.find(entry => entry.queueType === 'RANKED_SOLO_5x5') : 
                      (storedRankInfo && storedRankInfo.queueType === 'RANKED_SOLO_5x5' ? storedRankInfo : null)
          };
          
          console.log('Successfully retrieved user data from storage:', userData);
          return userData;
        }
      } catch (error) {
        console.warn('Error checking stored user data, will fetch from API:', error);
        // Continue with API calls if storage retrieval fails
      }
      
      // Get fresh account info from API
      console.log('Fetching fresh account info from API');
      const accountInfo = await this.getAccountInfo();
      
      if (!accountInfo || !accountInfo.puuid) {
        throw new Error('Failed to get account information');
      }
      
      // Check if we have gameName and tagLine - these are sometimes missing from the ID token
      // If missing, we might need to get them from a different source or construct placeholders
      if (!accountInfo.gameName || !accountInfo.tagLine) {
        console.warn('Account info missing gameName or tagLine:', accountInfo);
        
        // Try to extract from ID token if available
        const tokens = await this._getStoredValue(this.config.storageKeys.tokens);
        if (tokens && tokens.id_token) {
          try {
            console.log('Attempting to extract user info from ID token');
            const idTokenParts = tokens.id_token.split('.');
            if (idTokenParts.length === 3) {
              const idTokenPayload = JSON.parse(atob(idTokenParts[1]));
              
              // Update account info with data from ID token
              if (idTokenPayload.game_name) accountInfo.gameName = idTokenPayload.game_name;
              if (idTokenPayload.tag_line) accountInfo.tagLine = idTokenPayload.tag_line;
              
              console.log('Updated account info from ID token:', { 
                gameName: accountInfo.gameName, 
                tagLine: accountInfo.tagLine 
              });
            }
          } catch (e) {
            console.error('Failed to extract user info from ID token:', e);
          }
        }
        
        // If still missing, set placeholder values
        if (!accountInfo.gameName) accountInfo.gameName = 'Summoner';
        if (!accountInfo.tagLine) accountInfo.tagLine = 'Unknown';
      }
      
      // Log the account info we're using
      console.log('Using account info:', {
        puuid: accountInfo.puuid ? accountInfo.puuid.substring(0, 8) + '...' : null,
        gameName: accountInfo.gameName,
        tagLine: accountInfo.tagLine
      });
      
      try {
        // Get summoner info using the PUUID
        console.log('Fetching summoner info');
        const summonerInfo = await this.getSummonerInfo(accountInfo.puuid);
        
        try {
          // Get rank info using the summoner ID
          console.log('Fetching rank info');
          const rankEntries = await this.getRankInfo(summonerInfo.id);
          
          // Extract the Solo/Duo queue rank
          const soloQueueEntry = Array.isArray(rankEntries) ?
            rankEntries.find(entry => entry.queueType === 'RANKED_SOLO_5x5') :
            (rankEntries && rankEntries.queueType === 'RANKED_SOLO_5x5' ? rankEntries : null);
          
          // Format into a single user data object
          const userData = {
            gameName: accountInfo.gameName,
            tagLine: accountInfo.tagLine,
            puuid: accountInfo.puuid,
            summonerId: summonerInfo.id,
            summonerName: summonerInfo.name,
            summonerLevel: summonerInfo.summonerLevel,
            profileIconId: summonerInfo.profileIconId,
            rankInfo: soloQueueEntry
          };
          
          console.log('Successfully retrieved complete user data:', userData);
          return userData;
        } catch (rankError) {
          console.error('Error getting rank info:', rankError);
          
          // Return user data without rank info
          const userData = {
            gameName: accountInfo.gameName,
            tagLine: accountInfo.tagLine,
            puuid: accountInfo.puuid,
            summonerId: summonerInfo.id,
            summonerName: summonerInfo.name,
            summonerLevel: summonerInfo.summonerLevel,
            profileIconId: summonerInfo.profileIconId,
            rankInfo: null
          };
          
          console.log('Returning user data without rank info:', userData);
          return userData;
        }
      } catch (summonerError) {
        console.error('Error getting summoner info:', summonerError);
        
        // Return partial user data with just account info
        const userData = {
          gameName: accountInfo.gameName,
          tagLine: accountInfo.tagLine,
          puuid: accountInfo.puuid,
          summonerId: null,
          summonerName: null,
          summonerLevel: null,
          profileIconId: null,
          rankInfo: null
        };
        
        console.log('Returning partial user data (account info only):', userData);
        return userData;
      }
    } catch (error) {
      console.error('Error getting user data:', error);
      throw error;
    }
  },
  
  /**
   * Process and store ID token data
   * @param {string} idToken - The ID token to process
   * @returns {Promise<Object>} - The decoded ID token payload
   * @private
   */
  async _processIdToken(idToken) {
    try {
      if (!idToken) {
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
        
        // Extract account info from the ID token
        const accountInfo = {
          sub: decodedPayload.sub,
          puuid: decodedPayload.sub, // In Riot's case, 'sub' is the PUUID
          acct: decodedPayload.acct,
          game_name: decodedPayload.game_name,
          tag_line: decodedPayload.tag_line
        };
        
        // Convert to camelCase for consistency in our app
        const formattedAccountInfo = {
          puuid: accountInfo.puuid,
          accountId: accountInfo.acct,
          gameName: accountInfo.game_name,
          tagLine: accountInfo.tag_line
        };
        
        // Log the extracted info (without revealing the full PUUID)
        console.log('Extracted account info from ID token:', {
          puuid: formattedAccountInfo.puuid ? formattedAccountInfo.puuid.substring(0, 8) + '...' : null,
          accountId: formattedAccountInfo.accountId ? formattedAccountInfo.accountId.substring(0, 8) + '...' : null,
          gameName: formattedAccountInfo.gameName,
          tagLine: formattedAccountInfo.tagLine
        });
        
        // Store the account info directly with chrome.storage
        await new Promise(resolve => {
          chrome.storage.local.set({ [this.config.storageKeys.accountInfo]: formattedAccountInfo }, resolve);
        });
        
        return decodedPayload;
      } catch (decodeError) {
        console.error('Error decoding ID token payload:', decodeError);
        throw new Error('Failed to decode ID token payload');
      }
    } catch (error) {
      console.error('Error processing ID token:', error);
      throw error;
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
  }
}; 