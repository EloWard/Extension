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
      accountInfo: '/riot/account',
      summonerInfo: '/riot/summoner/me',
      leagueEntries: '/riot/league/entries',
      userInfo: '/riot/user/info'
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
      tokens: 'eloward_riot_tokens',
      userInfo: 'eloward_riot_user_info',
      authCallback: 'eloward_auth_callback'
    }
  },
  
  // Reference to the auth window if opened
  authWindow: null,
  
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
   * Refresh the access token
   * @param {string} refreshToken - The refresh token
   * @returns {Promise<string>} - The new access token
   */
  async refreshToken(refreshToken) {
    try {
      console.log('Refreshing access token...');
      
      const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.tokenRefresh}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ refresh_token: refreshToken })
      });
      
      if (!response.ok) {
        throw new Error(`Token refresh failed: ${response.status} ${response.statusText}`);
      }
      
      const tokenData = await response.json();
      
      if (!tokenData.data || !tokenData.data.access_token) {
        throw new Error('Invalid token data received from refresh');
      }
      
      // Store the new tokens
      await this._storeTokens(tokenData.data);
      
      return tokenData.data.access_token;
    } catch (error) {
      console.error('Error refreshing token:', error);
      throw new Error('Failed to refresh access token');
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
   * Get user account info from Riot API
   * @returns {Promise<Object>} - Account info
   */
  async getAccountInfo() {
    try {
      // Get a valid token - this might refresh it if expired
      const token = await this.getValidToken();
      console.log(`Retrieved valid access token for API request (token length: ${token.length})`);
      
      // Log token prefix (first 8 chars) to help with debugging
      console.log(`Token prefix: ${token.substring(0, 8)}...`);
      
      const region = await this._getStoredValue('selectedRegion') || 'na1';
      
      // Get the appropriate regional route - 'na1' needs to be converted to 'americas' for API requests
      const regionalRoute = this._getRegionalRouteFromPlatform(region);
      console.log(`Using regional route: ${regionalRoute} for platform: ${region}`);
      
      // Log the request we're about to make - use correct endpoint (with /me)
      const requestUrl = `${this.config.proxyBaseUrl}${this.config.endpoints.accountInfo}/me?region=${regionalRoute}`;
      console.log(`Making account info request to: ${requestUrl}`);
      
      // Use the correct endpoint structure that matches the Cloudflare Worker implementation
      const response = await fetch(requestUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });
      
      // Log response details
      console.log(`Account info response status: ${response.status} ${response.statusText}`);
      
      if (!response.ok) {
        let errorInfo;
        try {
          errorInfo = await response.json();
          console.error(`Account info API error (${response.status}):`, errorInfo);
        } catch (e) {
          const errorText = await response.text();
          console.error(`Account info API error (${response.status}):`, errorText);
          errorInfo = { error: 'parse_error', error_text: errorText };
        }
        
        // If 401 Unauthorized, the token might be invalid - let's log token details
        if (response.status === 401) {
          console.error('Authorization failure - token validation issue', {
            tokenPrefix: token.substring(0, 8) + '...',
            tokenLength: token.length,
            headers: Array.from(response.headers.entries())
          });
          
          // Try to get the full tokens object to examine
          const tokensObj = await this._getStoredValue(this.config.storageKeys.tokens);
          if (tokensObj) {
            console.log('Current tokens object:', {
              fields: Object.keys(tokensObj),
              tokenType: tokensObj.token_type,
              scope: tokensObj.scope,
              expiresIn: tokensObj.expires_in
            });
          }
        }
        
        throw new Error(`Failed to get account info: ${response.status} ${response.statusText}`);
      }
      
      // Get the account data
      let accountData;
      try {
        const responseText = await response.text();
        console.log('Account info response length:', responseText.length);
        accountData = JSON.parse(responseText);
      } catch (parseError) {
        console.error('Error parsing account info response:', parseError);
        throw new Error('Invalid JSON in account info response');
      }
      
      console.log('Account info retrieved successfully:', accountData);
      
      // Store for later use
      await this._storeAccountInfo(accountData);
      
      return accountData;
    } catch (error) {
      console.error('Error fetching account info:', error);
      throw error;
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
   * Get summoner info by PUUID
   * @param {string} puuid - Player PUUID
   * @returns {Promise<Object>} - Summoner info
   */
  async getSummonerInfo(puuid) {
    try {
      const region = await this._getStoredValue('selectedRegion') || 'na1';
      
      // Convert platform ID to regional route (e.g., 'na1' -> 'americas')
      const regionalRoute = this._getRegionalRouteFromPlatform(region);
      
      if (!puuid) {
        console.log('No PUUID provided to getSummonerInfo, fetching account info first');
        const accountInfo = await this.getAccountInfo();
        puuid = accountInfo.puuid;
      }
      
      console.log(`Fetching summoner info for PUUID: ${puuid} in region: ${region} (${regionalRoute})`);
      
      // Use the correct endpoint structure for the Cloudflare Worker
      // The endpoint takes region parameter as a query parameter, not in the path
      const requestUrl = `${this.config.proxyBaseUrl}${this.config.endpoints.summonerInfo}?region=${region}`;
      console.log(`Making summoner info request to: ${requestUrl}`);
      
      // Send the request with proper authorization header
      const token = await this.getValidToken();
      const response = await fetch(requestUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        let errorInfo;
        try {
          errorInfo = await response.json();
          console.error(`Summoner info API error (${response.status}):`, errorInfo);
        } catch (e) {
          const errorText = await response.text();
          console.error(`Summoner info API error (${response.status}):`, errorText);
          errorInfo = { error: 'parse_error', error_text: errorText };
        }
        
        throw new Error(`Failed to get summoner info: ${response.status} ${response.statusText}`);
      }
      
      const summonerData = await response.json();
      console.log('Received summoner data:', summonerData);
      
      // Store for later use
      await this._storeSummonerInfo(summonerData);
      
      return summonerData;
    } catch (error) {
      console.error('Error fetching summoner info:', error);
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
   * Get rank info by summoner ID
   * @param {string} summonerId - Encrypted summoner ID
   * @returns {Promise<Object>} - Rank info
   */
  async getRankInfo(summonerId) {
    try {
      const platform = await this._getStoredValue('selectedRegion') || 'na1';
      
      if (!summonerId) {
        console.log('No summonerId provided to getRankInfo, fetching summoner info first');
        const summonerInfo = await this.getSummonerInfo();
        summonerId = summonerInfo.id;
      }
      
      console.log(`Fetching rank info for summonerId: ${summonerId} on platform: ${platform}`);
      
      // Use the correct endpoint with query parameters
      const requestUrl = `${this.config.proxyBaseUrl}${this.config.endpoints.leagueEntries}?region=${platform}&summonerId=${summonerId}`;
      console.log(`Making rank info request to: ${requestUrl}`);
      
      // Send the request with proper authorization header
      const token = await this.getValidToken();
      const response = await fetch(requestUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        let errorInfo;
        try {
          errorInfo = await response.json();
          console.error(`Rank info API error (${response.status}):`, errorInfo);
        } catch (e) {
          const errorText = await response.text();
          console.error(`Rank info API error (${response.status}):`, errorText);
          errorInfo = { error: 'parse_error', error_text: errorText };
        }
        throw new Error(`Failed to get rank info: ${response.status} ${response.statusText}`);
      }
      
      const leagueData = await response.json();
      console.log('Received league/rank data:', leagueData);
      
      // Find the Solo/Duo queue entry
      const soloQueueEntry = Array.isArray(leagueData) ? 
        leagueData.find(entry => entry.queueType === 'RANKED_SOLO_5x5') :
        leagueData.queueType === 'RANKED_SOLO_5x5' ? leagueData : null;
        
      if (soloQueueEntry) {
        console.log('Found Solo/Duo rank:', `${soloQueueEntry.tier} ${soloQueueEntry.rank}`);
      } else {
        console.log('No Solo/Duo rank found');
      }
      
      // Store for later use
      await this._storeRankInfo(leagueData);
      
      return leagueData;
    } catch (error) {
      console.error('Error fetching rank info:', error);
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
        if (!accountInfo.tagLine) accountInfo.tagLine = 'unknown';
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
      
      // Store the raw ID token
      await this._storeValue(this.config.storageKeys.idToken, idToken);
      
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
        
        // Store the account info
        await this._storeValue(this.config.storageKeys.accountInfo, formattedAccountInfo);
        
        return decodedPayload;
      } catch (decodeError) {
        console.error('Error decoding ID token payload:', decodeError);
        throw new Error('Failed to decode ID token payload');
      }
    } catch (error) {
      console.error('Error processing ID token:', error);
      throw error;
    }
  }
}; 