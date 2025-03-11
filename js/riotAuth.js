// EloWard Riot RSO Authentication
import { EloWardConfig } from './config.js';

/**
 * Riot RSO Authentication Module
 * Handles authentication with Riot Games API
 */
const RiotAuth = {
  config: {
    proxyBaseUrl: 'https://eloward-riotrso.unleashai-inquiries.workers.dev',
    standardRedirectUri: 'https://www.eloward.xyz/auth/redirect',
    endpoints: {
      authInit: '/auth/init',
      authToken: '/auth/riot/token',
      authRefresh: '/auth/riot/refresh',
      riotAccount: '/riot/account',
      riotSummoner: '/riot/summoner',
      riotLeague: '/riot/league'
    },
    storageKeys: {
      accessToken: 'eloward_riot_access_token',
      refreshToken: 'eloward_riot_refresh_token',
      tokenExpiry: 'eloward_riot_token_expiry',
      tokens: 'eloward_riot_tokens',
      authState: 'eloward_auth_state',
      accountInfo: 'eloward_riot_account_info',
      summonerInfo: 'eloward_riot_summoner_info',
      rankInfo: 'eloward_riot_rank_info'
    }
  },
  
  // Track auth window
  authWindow: null,
  
  /**
   * Main authentication method
   * @param {string} region - The region to authenticate with
   * @returns {Promise<Object>} - The user data object
   */
  async authenticate(region = 'na1') {
    try {
      console.log('Starting Riot Authentication for region:', region);
      
      // Get auth URL from background script
      console.log('Requesting auth URL from background script');
      
      // Generate a random state for CSRF protection
      const state = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      console.log('Generated state for auth:', state);
      
      // Store state for verification
      await Promise.all([
        new Promise(resolve => {
          chrome.storage.local.set({ 
            [this.config.storageKeys.authState]: state,
            selectedRegion: region 
          }, resolve);
        }),
        new Promise(resolve => {
          if (typeof localStorage !== 'undefined') {
            try {
              localStorage.setItem(this.config.storageKeys.authState, state);
              localStorage.setItem('selectedRegion', region);
            } catch (e) {
              console.error('Error storing state in localStorage:', e);
            }
            resolve();
          } else {
            resolve();
          }
        })
      ]);
      
      // Request auth URL from background script
      const authUrlResult = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          action: 'initiate_riot_auth',
          region: region,
          state: state
        }, response => {
          if (chrome.runtime.lastError) {
            reject(new Error(`Error getting auth URL: ${chrome.runtime.lastError.message}`));
          } else if (response.success && response.authUrl) {
            resolve(response);
          } else {
            reject(new Error(response.error || 'Failed to get auth URL'));
          }
        });
      });
      
      console.log('Received auth URL from background script');
      
      // Open auth window
      console.log('Opening auth window');
      const authWindowResult = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'open_auth_window',
          url: authUrlResult.authUrl,
          state: state
        }, response => {
          if (chrome.runtime.lastError) {
            reject(new Error(`Error opening auth window: ${chrome.runtime.lastError.message}`));
          } else if (response.success) {
            resolve(response);
          } else {
            reject(new Error(response.error || 'Failed to open auth window'));
          }
        });
      });
      
      console.log('Auth window opened, waiting for callback');
      
      // Wait for callback - poll for it in storage
      const authCallbackResult = await new Promise((resolve, reject) => {
        // Set timeout - don't wait forever
        const timeoutId = setTimeout(() => {
          reject(new Error('Auth timeout - no callback received'));
        }, 5 * 60 * 1000); // 5 minutes timeout
        
        // Function to check for auth callback
        const checkForCallback = () => {
          chrome.storage.local.get(['auth_callback', 'eloward_auth_callback'], data => {
            const callback = data.auth_callback || data.eloward_auth_callback;
            
            if (callback && callback.code) {
              clearTimeout(timeoutId);
              
              // Clear callback from storage
              chrome.storage.local.remove(['auth_callback', 'eloward_auth_callback']);
              
              resolve(callback);
            } else {
              // No callback yet, check again in 1 second
              setTimeout(checkForCallback, 1000);
            }
          });
        };
        
        // Start checking
        checkForCallback();
      });
      
      console.log('Auth callback received:', authCallbackResult ? 'Yes' : 'No');
      
      if (!authCallbackResult || !authCallbackResult.code) {
        throw new Error('Authentication failed - no valid callback received');
      }
      
      // Complete authentication
      console.log('Completing authentication with code');
      await this.completeAuth(authCallbackResult);
      
      // Get user data
      console.log('Getting user data');
      const userData = await this.getUserData();
      console.log('Authentication completed successfully');
      
      return userData;
    } catch (error) {
      console.error('Authentication error:', error);
      throw error;
    }
  },
  
  /**
   * Initializes the authentication flow
   */
  async initAuth(region, state) {
    try {
      console.log('Initializing Riot RSO auth with:', {
        region,
        state,
        redirectUri: this.config.standardRedirectUri,
        extensionId: chrome.runtime.id
      });
      
      // Request authorization URL from the backend using GET with query parameters
      const url = new URL(`${this.config.proxyBaseUrl}${this.config.endpoints.authInit}`);
      url.searchParams.append('state', state);
      url.searchParams.append('region', region);
      
      console.log('Fetching auth URL from:', url.toString());
      const response = await fetch(url.toString());
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Auth URL fetch failed:', response.status, errorText);
        throw new Error(`Failed to initialize auth: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (!data.authorizationUrl) {
        console.error('No authorization URL in response:', data);
        throw new Error('No authorization URL returned from backend');
      }
      
      console.log('Received authorization URL from backend');
      return data.authorizationUrl;
    } catch (error) {
      console.error('Auth initialization failed:', error);
      throw error;
    }
  },
  
  /**
   * Stores authentication state in both Chrome storage and localStorage
   */
  async _storeAuthState(state) {
    // Store in Chrome storage
    await new Promise(resolve => {
      chrome.storage.local.set({
        [this.config.storageKeys.authState]: state
      }, resolve);
    });
    console.log(`Stored auth state in chrome.storage: ${state}`);
    
    // Also store in localStorage as fallback
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(this.config.storageKeys.authState, state);
        console.log(`Stored auth state in localStorage: ${state}`);
      } catch (e) {
        console.error('Failed to store auth state in localStorage:', e);
      }
    }
  },
  
  /**
   * Clears all authentication data
   */
  async clearAuthData() {
    // Clear Chrome storage
    await new Promise(resolve => {
      chrome.storage.local.remove([
        this.config.storageKeys.accessToken,
        this.config.storageKeys.refreshToken,
        this.config.storageKeys.tokenExpiry,
        this.config.storageKeys.tokens,
        this.config.storageKeys.authState,
        'auth_callback',
        'eloward_auth_callback'
      ], resolve);
    });
    
    // Clear localStorage if available
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(this.config.storageKeys.accessToken);
        localStorage.removeItem(this.config.storageKeys.refreshToken);
        localStorage.removeItem(this.config.storageKeys.tokenExpiry);
        localStorage.removeItem(this.config.storageKeys.tokens);
        localStorage.removeItem(this.config.storageKeys.authState);
        localStorage.removeItem('eloward_auth_callback_data');
      } catch (e) {
        console.error('Failed to clear localStorage:', e);
      }
    }
    
    console.log('Cleared all auth data');
  },
  
  /**
   * Opens the authentication window
   */
  async openAuthWindow(authUrl) {
    try {
      console.log('Opening auth window with URL:', authUrl);
      
      // First try using chrome.windows API
      try {
        const result = await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            type: 'open_auth_window',
            url: authUrl,
            state: await this._getStoredState()
          }, (response) => {
            if (chrome.runtime.lastError) {
              console.error('Error opening auth window:', chrome.runtime.lastError);
              resolve({ success: false, error: chrome.runtime.lastError.message });
            } else {
              resolve(response || { success: false });
            }
          });
        });
        
        if (result && result.success) {
          console.log('Auth window opened using chrome.windows');
          return;
        }
      } catch (e) {
        console.error('Failed to open auth window using chrome API:', e);
      }
      
      // Fallback to window.open
      console.log('Using window.open fallback for auth window');
      this.authWindow = window.open(authUrl, 'riotAuthWindow', 'width=500,height=700');
      
      if (!this.authWindow) {
        throw new Error('Failed to open authentication window. Please check popup blocker settings.');
      }
    } catch (error) {
      console.error('Error opening auth window:', error);
      throw error;
    }
  },
  
  /**
   * Retrieves the stored authentication state
   */
  async _getStoredState() {
    // Check Chrome storage first
    const data = await new Promise(resolve => {
      chrome.storage.local.get([this.config.storageKeys.authState], resolve);
    });
    
    let state = data[this.config.storageKeys.authState];
    
    // Fall back to localStorage if not found in Chrome storage
    if (!state && typeof localStorage !== 'undefined') {
      try {
        state = localStorage.getItem(this.config.storageKeys.authState);
      } catch (e) {
        console.error('Failed to retrieve state from localStorage:', e);
      }
    }
    
    return state;
  },
  
  /**
   * Wait for auth callback by polling various storage locations and listening for messages
   */
  async waitForAuthCallback() {
    console.log('Waiting for auth callback...');
    
    return new Promise((resolve, reject) => {
      const maxAttempts = 120; // 2 minutes (120 * 1 second)
      let attempts = 0;
      let messageListener = null;
      
      // Set up direct message listener for window messages
      messageListener = (event) => {
        try {
          console.log('Auth callback received message:', event.data);
          
          // Look for messages with auth callback data
          if (event.data && 
              ((event.data.source === 'eloward_auth' && event.data.code) || 
               (event.data.type === 'auth_callback' && event.data.code))) {
            
            console.log('Valid auth callback message received');
            
            // Clean up listener immediately
            window.removeEventListener('message', messageListener);
            
            // Store in chrome.storage for consistency
            chrome.storage.local.set({
              'auth_callback': event.data
            }, () => {
              console.log('Stored direct auth callback in chrome.storage');
              resolve(event.data);
            });
          }
        } catch (e) {
          console.error('Error processing message event:', e);
        }
      };
      
      // Add the message listener
      window.addEventListener('message', messageListener);
      
      // Set up polling interval to check storage
      const pollInterval = setInterval(async () => {
        attempts++;
        
        try {
          // Check chrome.storage for callback
          const data = await new Promise(resolve => {
            chrome.storage.local.get(['auth_callback', 'eloward_auth_callback'], resolve);
          });
          
          const callback = data.auth_callback || data.eloward_auth_callback;
          
          if (callback && callback.code) {
            console.log('Auth callback found in chrome.storage');
            clearInterval(pollInterval);
            window.removeEventListener('message', messageListener);
            
            // Clear storage to prevent duplicate processing
            chrome.storage.local.remove(['auth_callback', 'eloward_auth_callback']);
            
            resolve(callback);
            return;
          }
          
          // Check localStorage for callback
          if (typeof localStorage !== 'undefined') {
            try {
              const storedData = localStorage.getItem('eloward_auth_callback_data');
              if (storedData) {
                const authData = JSON.parse(storedData);
                if (authData && authData.code) {
                  console.log('Auth callback found in localStorage');
                  clearInterval(pollInterval);
                  window.removeEventListener('message', messageListener);
                  
                  // Clear localStorage to prevent duplicate processing
                  localStorage.removeItem('eloward_auth_callback_data');
                  
                  resolve(authData);
                  return;
                }
              }
            } catch (e) {
              console.error('Error checking localStorage:', e);
            }
          }
          
          // Check if auth window is closed (user might have cancelled)
          if (this.authWindow && this.authWindow.closed) {
            clearInterval(pollInterval);
            window.removeEventListener('message', messageListener);
            console.log('Auth window was closed by user');
            
            // Make one final check for callback data
            const finalCheck = await new Promise(resolve => {
              chrome.storage.local.get(['auth_callback', 'eloward_auth_callback'], resolve);
            });
            
            const finalCallback = finalCheck.auth_callback || finalCheck.eloward_auth_callback;
            
            if (finalCallback && finalCallback.code) {
              console.log('Found callback data after window closed');
              resolve(finalCallback);
            } else {
              resolve(null); // Indicate cancellation
            }
            return;
          }
          
          // Give up after max attempts
          if (attempts >= maxAttempts) {
            console.log('Auth callback polling timed out after', maxAttempts, 'attempts');
            clearInterval(pollInterval);
            window.removeEventListener('message', messageListener);
            resolve(null); // Resolve with null instead of rejecting
          }
        } catch (error) {
          console.error('Error polling for auth callback:', error);
        }
      }, 1000);
    });
  },
  
  /**
   * Completes the authentication flow with the auth code
   */
  async completeAuth(codeParam) {
    try {
      console.log('CompleteAuth called with:', typeof codeParam, codeParam ? codeParam.length : 0);
      
      // Extract code from various formats
      let code = codeParam;
      
      // If codeParam is an object with a code property (from events/messages)
      if (typeof codeParam === 'object' && codeParam !== null) {
        code = codeParam.code || (codeParam.params ? codeParam.params.code : null);
        console.log('Extracted code from object:', code ? code.substring(0, 10) + '...' : 'null');
      }
      
      if (!code) {
        throw new Error('No authorization code provided');
      }
      
      // Get stored state from storage
      const [chromeState, localState] = await Promise.all([
        new Promise(resolve => {
          chrome.storage.local.get(this.config.storageKeys.authState, data => {
            resolve(data[this.config.storageKeys.authState]);
          });
        }),
        new Promise(resolve => {
          if (typeof localStorage !== 'undefined') {
            resolve(localStorage.getItem(this.config.storageKeys.authState));
          } else {
            resolve(null);
          }
        })
      ]);
      
      const storedState = chromeState || localState;
      console.log('Stored state found:', storedState ? 'Yes' : 'No');
      
      // Verify state if it exists in the callback
      if (codeParam.state && storedState && codeParam.state !== storedState) {
        console.error('State mismatch', {received: codeParam.state, stored: storedState});
        throw new Error('State mismatch - security verification failed');
      }
      
      // Exchange code for tokens
      console.log('Exchanging code for tokens');
      const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.authToken}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ code })
      });
      
      if (!response.ok) {
        console.error('Token exchange failed with status:', response.status);
        const errorText = await response.text();
        console.error('Error response:', errorText);
        throw new Error(`Failed to exchange token: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Token exchange successful');
      
      if (!data.data || !data.data.access_token) {
        throw new Error('Invalid response from token exchange endpoint');
      }
      
      // Add issued_at to track token age
      const tokens = {
        ...data.data,
        issued_at: Date.now()
      };
      
      // Store tokens in chrome.storage.local
      await new Promise((resolve) => {
        const tokenData = {
          [this.config.storageKeys.accessToken]: tokens.access_token,
          [this.config.storageKeys.refreshToken]: tokens.refresh_token,
          [this.config.storageKeys.tokenExpiry]: Date.now() + (tokens.expires_in * 1000),
          [this.config.storageKeys.tokens]: tokens,
          'riotAuth': {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_in: tokens.expires_in,
            issued_at: tokens.issued_at
          }
        };
        
        chrome.storage.local.set(tokenData, resolve);
      });
      
      // Also store in localStorage if available
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(this.config.storageKeys.accessToken, tokens.access_token);
          localStorage.setItem(this.config.storageKeys.refreshToken, tokens.refresh_token);
          localStorage.setItem(this.config.storageKeys.tokenExpiry, String(Date.now() + (tokens.expires_in * 1000)));
          localStorage.setItem(this.config.storageKeys.tokens, JSON.stringify(tokens));
        } catch (e) {
          console.error('Error storing tokens in localStorage:', e);
        }
      }
      
      console.log('Tokens stored successfully');
      return tokens.access_token;
    } catch (error) {
      console.error('Error completing authentication:', error);
      throw error;
    }
  },
  
  /**
   * Generates a random state value for CSRF protection
   */
  _generateRandomState() {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  },
  
  /**
   * Gets a valid access token, refreshing if necessary
   */
  async getValidToken() {
    try {
      console.log('Getting valid access token');
      
      // Try to get token from chrome.storage first
      const data = await new Promise(resolve => {
        chrome.storage.local.get([
          this.config.storageKeys.accessToken,
          this.config.storageKeys.tokenExpiry,
          this.config.storageKeys.refreshToken,
          this.config.storageKeys.tokens,
          'riotAuth'
        ], resolve);
      });
      
      // Try each possible storage location
      let accessToken = data[this.config.storageKeys.accessToken];
      let tokenExpiry = data[this.config.storageKeys.tokenExpiry];
      let refreshToken = data[this.config.storageKeys.refreshToken];
      
      // If not found, try combined tokens object
      if (!accessToken && data[this.config.storageKeys.tokens]) {
        const tokens = data[this.config.storageKeys.tokens];
        accessToken = tokens.access_token;
        refreshToken = tokens.refresh_token;
        tokenExpiry = tokens.issued_at + (tokens.expires_in * 1000);
      }
      
      // If still not found, try riotAuth object
      if (!accessToken && data.riotAuth) {
        const tokens = data.riotAuth;
        accessToken = tokens.access_token;
        refreshToken = tokens.refresh_token;
        tokenExpiry = tokens.issued_at + (tokens.expires_in * 1000);
      }
      
      // Try localStorage as fallback
      if (!accessToken && typeof localStorage !== 'undefined') {
        try {
          accessToken = localStorage.getItem(this.config.storageKeys.accessToken);
          tokenExpiry = localStorage.getItem(this.config.storageKeys.tokenExpiry);
          refreshToken = localStorage.getItem(this.config.storageKeys.refreshToken);
          
          // If not found in individual keys, try tokens object
          if (!accessToken) {
            const tokensStr = localStorage.getItem(this.config.storageKeys.tokens);
            if (tokensStr) {
              const tokens = JSON.parse(tokensStr);
              accessToken = tokens.access_token;
              refreshToken = tokens.refresh_token;
              tokenExpiry = tokens.issued_at + (tokens.expires_in * 1000);
            }
          }
        } catch (e) {
          console.error('Error accessing localStorage:', e);
        }
      }
      
      if (!accessToken) {
        throw new Error('No access token found. Please authenticate first.');
      }
      
      // Check if token is expired
      const now = Date.now();
      const expiryTime = Number(tokenExpiry) || 0;
      
      // If token is expired or will expire in the next 5 minutes
      if (now >= expiryTime - 5 * 60 * 1000) {
        console.log('Token expired or will expire soon, refreshing');
        
        if (!refreshToken) {
          throw new Error('No refresh token available. Please authenticate again.');
        }
        
        // Refresh the token
        try {
          console.log('Refreshing access token');
          
          const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.authRefresh}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ refresh_token: refreshToken })
          });
          
          if (!response.ok) {
            throw new Error(`Failed to refresh token: ${response.status}`);
          }
          
          const tokenData = await response.json();
          
          if (!tokenData.data || !tokenData.data.access_token) {
            throw new Error('Invalid response from token refresh endpoint');
          }
          
          const newTokens = {
            ...tokenData.data,
            issued_at: Date.now()
          };
          
          // Store the refreshed tokens
          await new Promise(resolve => {
            chrome.storage.local.set({
              [this.config.storageKeys.accessToken]: newTokens.access_token,
              [this.config.storageKeys.refreshToken]: newTokens.refresh_token || refreshToken,
              [this.config.storageKeys.tokenExpiry]: Date.now() + (newTokens.expires_in * 1000),
              [this.config.storageKeys.tokens]: newTokens,
              'riotAuth': newTokens
            }, resolve);
          });
          
          // Also update localStorage
          if (typeof localStorage !== 'undefined') {
            try {
              localStorage.setItem(this.config.storageKeys.accessToken, newTokens.access_token);
              localStorage.setItem(this.config.storageKeys.refreshToken, newTokens.refresh_token || refreshToken);
              localStorage.setItem(this.config.storageKeys.tokenExpiry, String(Date.now() + (newTokens.expires_in * 1000)));
              localStorage.setItem(this.config.storageKeys.tokens, JSON.stringify(newTokens));
            } catch (e) {
              console.error('Error storing refreshed tokens in localStorage:', e);
            }
          }
          
          console.log('Token refreshed successfully');
          return newTokens.access_token;
        } catch (refreshError) {
          console.error('Error refreshing token:', refreshError);
          throw refreshError;
        }
      }
      
      return accessToken;
    } catch (error) {
      console.error('Error getting valid token:', error);
      throw error;
    }
  },
  
  /**
   * Check if the user is authenticated
   */
  async isAuthenticated() {
    try {
      // Try to get a valid token, which will throw an error if not authenticated
      await this.getValidToken();
      return true;
    } catch (error) {
      console.log('Not authenticated:', error.message);
      return false;
    }
  },
  
  /**
   * Get user data from Riot API
   */
  async getUserData() {
    try {
      console.log('Getting comprehensive user data...');
      
      // Check if we're authenticated first
      const isAuthenticated = await this.isAuthenticated();
      if (!isAuthenticated) {
        throw new Error('Not authenticated. Please connect your Riot account first.');
      }
      
      // Get access token
      const accessToken = await this.getValidToken();
      
      // Fetch account data from Riot API
      console.log('Fetching account data from Riot API');
      const accountResponse = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.riotAccount}/na1`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
      
      if (!accountResponse.ok) {
        throw new Error(`Failed to fetch account data: ${accountResponse.status}`);
      }
      
      const accountData = await accountResponse.json();
      console.log('Account data fetched successfully:', accountData);
      
      // Construct user data object
      const userData = {
        gameName: accountData.gameName,
        tagLine: accountData.tagLine,
        puuid: accountData.puuid
      };
      
      // Store the user data
      await new Promise(resolve => {
        chrome.storage.local.set({
          'riotAuth': {
            ...userData,
            access_token: accessToken,
            issued_at: Date.now()
          }
        }, resolve);
      });
      
      return userData;
    } catch (error) {
      console.error('Error getting user data:', error);
      throw error;
    }
  },
  
  /**
   * Logout method for popup.js
   * Clears all authentication data
   * @returns {Promise<boolean>} - Resolves with true on success
   */
  async logout() {
    try {
      // Just use clearAuthData method
      await this.clearAuthData();
      console.log('Logged out successfully');
      return true;
    } catch (error) {
      console.error('Logout error:', error);
      return false;
    }
  },
}; 