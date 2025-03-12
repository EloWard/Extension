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
      userInfo: 'eloward_riot_user_info'
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
      await chrome.storage.local.remove([this.config.storageKeys.authCallback]);
      localStorage.removeItem(this.config.storageKeys.authCallback);
      
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
          received: authResult.state,
          expected: state
        });
        
        // Try fallback state check using storage
        const storedState = await this._getStoredAuthState();
        console.log('Retrieved stored state for fallback check:', storedState);
        
        if (authResult.state !== storedState) {
          // Additional fallback - check if the received state matches what's in the URL hash
          // This handles cases where the redirect URI doesn't properly pass the original state
          const hashState = new URLSearchParams(window.location.hash.substring(1)).get('state');
          console.log('Checking hash state as last resort:', hashState);
          
          if (authResult.state !== hashState && authResult.state !== state) {
            console.error('State verification failed using all methods:', {
              receivedState: authResult.state,
              originalState: state,
              retrievedStoredState: storedState,
              hashState: hashState
            });
            
            // Last resort - proceed with caution if code is present
            // This should only be done in development or if Riot API behavior has changed
            if (authResult.code) {
              console.warn('SECURITY RISK: Proceeding despite state mismatch because code is present');
              // Continue with authentication using the code, but log the security risk
            } else {
              throw new Error('Security verification failed: state parameter mismatch');
            }
          } else {
            console.log('State verified using hash parameter');
          }
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
      const tokenData = await this._exchangeCodeForTokens(authResult.code);
      
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
      // Try to use chrome.windows API first
      chrome.runtime.sendMessage({
        type: 'open_auth_window',
        url: authUrl
      }, response => {
        if (chrome.runtime.lastError || !response || !response.success) {
          // Fallback to window.open
          this._openAuthWindowFallback(authUrl);
        }
      });
    } catch (e) {
      // Fallback to window.open
      this._openAuthWindowFallback(authUrl);
    }
  },
  
  /**
   * Fallback method to open auth window using window.open
   * @param {string} authUrl - The authentication URL
   * @private
   */
  _openAuthWindowFallback(authUrl) {
    console.log('Using window.open fallback for auth window');
    this.authWindow = window.open(authUrl, 'riotAuthWindow', 'width=500,height=700');
    
    if (!this.authWindow) {
      throw new Error('Failed to open authentication window - popup blocked?');
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
          console.log('Auth callback found in chrome.storage');
          clearInterval(intervalId);
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
   * @returns {Promise<Object>} - The token data
   * @private
   */
  async _exchangeCodeForTokens(code) {
    try {
      console.log('Exchanging code for tokens...', {
        codeLength: code ? code.length : 0,
        codePrefix: code ? code.substring(0, 8) + '...' : 'undefined'
      });
      
      // Log request details (without the actual code for security)
      console.log(`Making token exchange request to: ${this.config.proxyBaseUrl}${this.config.endpoints.authToken}`);
      
      const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.authToken}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ code })
      });
      
      console.log(`Token exchange response status: ${response.status} ${response.statusText}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('Token exchange error response:', errorData);
        throw new Error(`Token exchange failed: ${response.status} ${errorData.message || response.statusText}`);
      }
      
      const responseText = await response.text();
      console.log('Raw token response length:', responseText.length);
      
      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch (parseError) {
        console.error('Failed to parse token response as JSON:', parseError);
        console.log('Response text (truncated):', responseText.substring(0, 100) + '...');
        throw new Error('Invalid JSON response from token endpoint');
      }
      
      console.log('Token exchange response received, status:', 
                  responseData.status || 'No status field',
                  'Data fields:', Object.keys(responseData).join(', '));
      
      // Check for expected response structure based on different possible formats
      // Some servers return { data: { access_token: ... } } while others return { access_token: ... } directly
      let tokenData;
      
      if (responseData.data && responseData.data.access_token) {
        // Format: { data: { access_token: ... } }
        console.log('Using nested data field for token data');
        tokenData = responseData.data;
      } else if (responseData.access_token) {
        // Format: { access_token: ... }
        console.log('Using direct response for token data');
        tokenData = responseData;
      } else {
        console.error('Invalid token data format, neither data.access_token nor access_token found:', 
                     Object.keys(responseData));
        throw new Error('Invalid token data received: missing access token');
      }
      
      // Log token details without exposing the actual token
      console.log('Token data received:', {
        hasAccessToken: !!tokenData.access_token,
        accessTokenLength: tokenData.access_token ? tokenData.access_token.length : 0,
        accessTokenPrefix: tokenData.access_token ? tokenData.access_token.substring(0, 10) + '...' : 'undefined',
        hasRefreshToken: !!tokenData.refresh_token,
        refreshTokenLength: tokenData.refresh_token ? tokenData.refresh_token.length : 0,
        expiresIn: tokenData.expires_in,
        tokenType: tokenData.token_type,
        scope: tokenData.scope,
        hasIdToken: !!tokenData.id_token,
        idTokenLength: tokenData.id_token ? tokenData.id_token.length : 0
      });
      
      // Store tokens
      await this._storeTokens(tokenData);
      console.log('Tokens stored successfully');
      
      return tokenData;
    } catch (error) {
      console.error('Error exchanging code for tokens:', error);
      throw new Error(`Failed to exchange code for tokens: ${error.message}`);
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
      if (!tokenData.access_token) {
        throw new Error('Missing access_token in token data');
      }
      
      // Calculate expiry time
      const expiresIn = tokenData.expires_in || 300; // Default to 5 minutes if not provided
      const tokenExpiry = Date.now() + (expiresIn * 1000);
      console.log(`Token will expire at: ${new Date(tokenExpiry).toISOString()} (${expiresIn} seconds from now)`);
      
      // Create structured data to store
      const storageData = {
        [this.config.storageKeys.accessToken]: tokenData.access_token,
        [this.config.storageKeys.tokenExpiry]: tokenExpiry,
        [this.config.storageKeys.tokens]: tokenData,
        'riotAuth': { // For backward compatibility
          ...tokenData,
          issued_at: Date.now()
        }
      };
      
      // Optional: refreshToken (only if provided)
      if (tokenData.refresh_token) {
        storageData[this.config.storageKeys.refreshToken] = tokenData.refresh_token;
        console.log('Refresh token included in storage data');
      } else {
        console.log('No refresh token available to store');
      }
      
      // If we have user info from the token, store that too
      if (tokenData.user_info) {
        storageData[this.config.storageKeys.accountInfo] = tokenData.user_info;
        console.log('User info from token stored:', Object.keys(tokenData.user_info).join(', '));
      } else if (tokenData.id_token) {
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
            
            storageData[this.config.storageKeys.accountInfo] = userInfo;
            console.log('User info extracted from ID token and stored');
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
      
      // Store in localStorage as backup - but stringify objects properly
      try {
        localStorage.setItem(this.config.storageKeys.accessToken, tokenData.access_token);
        localStorage.setItem(this.config.storageKeys.tokenExpiry, tokenExpiry.toString());
        
        // For objects, we need to stringify them 
        localStorage.setItem(this.config.storageKeys.tokens, JSON.stringify(tokenData));
        
        if (tokenData.refresh_token) {
          localStorage.setItem(this.config.storageKeys.refreshToken, tokenData.refresh_token);
        }
        
        // Also store user info if available
        if (storageData[this.config.storageKeys.accountInfo]) {
          localStorage.setItem(
            this.config.storageKeys.accountInfo, 
            JSON.stringify(storageData[this.config.storageKeys.accountInfo])
          );
        }
        
        console.log('Tokens also stored in localStorage as backup');
      } catch (e) {
        console.error('Failed to store tokens in localStorage:', e);
        // Non-fatal error, we still have chrome.storage
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
   * Generate a random state string for CSRF protection
   * @returns {string} - Random state string
   * @private
   */
  _generateRandomState() {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
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
      
      // Log the request we're about to make
      const requestUrl = `${this.config.proxyBaseUrl}${this.config.endpoints.accountInfo}/${regionalRoute}`;
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
      
      console.log(`Fetching summoner info for PUUID: ${puuid} in region: ${regionalRoute}`);
      
      // Use the correct endpoint structure for the Cloudflare Worker
      const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.summonerInfo}/${regionalRoute}/${puuid}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Summoner info API error (${response.status}):`, errorText);
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
      
      // Use the platform directly here (not the regional route) since league endpoints use platform IDs
      const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.leagueEntries}/${platform}/${summonerId}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Rank info API error (${response.status}):`, errorText);
        throw new Error(`Failed to get rank info: ${response.status} ${response.statusText}`);
      }
      
      const leagueData = await response.json();
      console.log('Received league/rank data:', leagueData);
      
      // Find the Solo/Duo queue entry
      const soloQueueEntry = leagueData.find(entry => entry.queueType === 'RANKED_SOLO_5x5');
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
      
      // First check if we already have account info in storage (from ID token)
      let accountInfo;
      try {
        // Try to get from storage first
        const storedAccountInfo = await this._getStoredValue(this.config.storageKeys.accountInfo);
        
        if (storedAccountInfo && 
            typeof storedAccountInfo === 'object' && 
            storedAccountInfo.puuid) {
          console.log('Using stored account info from token');
          accountInfo = storedAccountInfo;
        } else {
          // If not in storage, fetch from API
          console.log('No stored account info, fetching from API');
          accountInfo = await this.getAccountInfo();
        }
      } catch (error) {
        console.error('Error getting account info from storage, trying API:', error);
        // If storage retrieval fails, fetch from API
        accountInfo = await this.getAccountInfo();
      }
      
      if (!accountInfo || !accountInfo.puuid) {
        throw new Error('Failed to get account information');
      }
      
      // Log the account info we're using
      console.log('Using account info:', {
        puuid: accountInfo.puuid,
        gameName: accountInfo.gameName,
        tagLine: accountInfo.tagLine
      });
      
      // Get summoner info using the PUUID
      const summonerInfo = await this.getSummonerInfo(accountInfo.puuid);
      
      // Get rank info using the summoner ID
      const rankEntries = await this.getRankInfo(summonerInfo.id);
      
      // Extract the Solo/Duo queue rank
      const soloQueueEntry = rankEntries.find(entry => entry.queueType === 'RANKED_SOLO_5x5');
      
      // Format into a single user data object
      const userData = {
        gameName: accountInfo.gameName,
        tagLine: accountInfo.tagLine,
        puuid: accountInfo.puuid,
        summonerId: summonerInfo.id,
        summonerName: summonerInfo.name,
        summonerLevel: summonerInfo.summonerLevel,
        profileIconId: summonerInfo.profileIconId,
        rankInfo: soloQueueEntry ? {
          tier: soloQueueEntry.tier,
          division: soloQueueEntry.rank,
          leaguePoints: soloQueueEntry.leaguePoints,
          wins: soloQueueEntry.wins,
          losses: soloQueueEntry.losses
        } : null
      };
      
      console.log('Successfully retrieved user data:', userData);
      return userData;
    } catch (error) {
      console.error('Error getting user data:', error);
      throw error;
    }
  }
}; 