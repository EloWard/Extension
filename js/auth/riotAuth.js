/* Copyright 2024 EloWard - Apache 2.0 + Commons Clause License */

// Import webextension-polyfill for cross-browser compatibility
import '../../vendor/browser-polyfill.js';

import { PersistentStorage } from '../core/persistentStorage.js';
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
  // Force the login prompt so we don't silently reuse a prior Riot session
  forcePromptLogin: true,
  endpoints: {
    authComplete: '/auth/complete', // Single-call optimized endpoint
    refreshRank: '/riot/refreshrank',
    disconnect: '/disconnect'
  },
  storageKeys: {
    // Active keys used by auth flow
    authState: 'eloward_auth_state',
    authCallback: 'eloward_auth_callback'
  }
};

export const RiotAuth = {
  config: defaultConfig,
  authWindow: null,
  
  async authenticate(region) {
    try {
      console.log('[RiotAuth] authenticate() start', { region });
      // Persist chosen platform routing value early so subsequent calls use it
      try {
        if (region) {
          await browser.storage.local.set({ selectedRegion: region });
        }
      } catch (_) {}
      
      // Clear any previous auth states
      await browser.storage.local.remove([this.config.storageKeys.authState]);
      
      // Generate a unique state
      const state = this._generateRandomState();
      
      // Store the state in both browser.storage and localStorage for redundancy
      await this._storeAuthState(state);
      console.log('[RiotAuth] stored auth state', state);
      
      // Get authentication URL from backend
      const authUrl = await this._getAuthUrl(region, state);
      console.log('[RiotAuth] obtained authUrl');
      
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
      console.log('[RiotAuth] set eloward_popup_auth_active = true');
      
      // Small delay to ensure listener is set up
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Open the auth window and wait for it to open
      const openedAuthWindow = await this._openAuthWindow(authUrl);
      console.log('[RiotAuth] auth window opened', { hasWindowRef: !!openedAuthWindow });
      
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
      console.log('[RiotAuth] received auth callback', authResult);
      
      if (!authResult || !authResult.code) {
        throw new Error('Authentication cancelled or failed');
      }
      

      // Relaxed, robust state verification for Firefox popup flow
      const expectedState = await this._getStoredAuthState();
      if (expectedState) {
        // If callback includes a state, ensure it matches the expected state
        if (authResult.state && authResult.state !== expectedState) {
          throw new Error('Security verification failed: state parameter mismatch. Please try again.');
        }
        // If callback omitted state, accept based on stored expectedState
      } else {
        // Fallback: if we somehow lack stored state, verify against originally generated one when provided
        if (authResult.state && authResult.state !== state) {
          throw new Error('Security verification failed: state parameter mismatch. Please try again.');
        }
      }
      
      // Clear any temporary callback keys written by the bridge
      try { await browser.storage.local.remove(['auth_callback','eloward_auth_callback','riot_auth_callback']); } catch (_) {}

      // Give background a brief chance to complete auth first to avoid double exchange in Firefox
      const bgUser = await RiotAuth._waitForStoredRiotUserData(2000);
      if (bgUser) {
        console.log('[RiotAuth] background completed auth, using stored data');
        await PersistentStorage.updateConnectedState('riot', true);
        return bgUser;
      }

      // Use optimized single-call auth endpoint
      console.log('[RiotAuth] calling optimized auth complete endpoint');
      const userData = await this.completeAuthentication(authResult.code, region);
      console.log('[RiotAuth] auth complete successful', userData);
      
      
      await PersistentStorage.storeRiotUserData(userData);
      console.log('[RiotAuth] stored user data to persistent storage');
      
      return userData;
    } catch (error) {
      console.error('[RiotAuth] authenticate() error', error?.message || error, error);
      throw error;
    } finally {
      // Clear the popup auth flag
      try {
        await browser.storage.local.remove('eloward_popup_auth_active');
        console.log('[RiotAuth] cleared eloward_popup_auth_active');
      } catch (_) {}
    }
  },
  
  async _storeAuthState(state) {
    await browser.storage.local.set({
      [this.config.storageKeys.authState]: state
    });
  },
  
  async _getStoredAuthState() {
    try {
      const browserData = await browser.storage.local.get([this.config.storageKeys.authState]);
      return browserData[this.config.storageKeys.authState] || null;
    } catch (_) {
      return null;
    }
  },
  
  async _getAuthUrl(region, state) {
    try {
      // Build authorization URL directly without backend call
      // Using minimum required scopes for Riot RSO
      const minimumScopes = 'openid offline_access lol cpid';
      
      const params = new URLSearchParams({
        client_id: this.config.clientId,
        redirect_uri: this.config.redirectUri,
        response_type: 'code',
        scope: minimumScopes,
        state: state
      });
      
      // Add force login parameters if configured
      if (this.config.forcePromptLogin) {
        params.set('prompt', 'login');
        params.set('max_age', '0');
      }
      
      const authUrl = `https://auth.riotgames.com/authorize?${params.toString()}`;
      
      return authUrl;
    } catch (error) {
      throw new Error('Failed to build authorization URL');
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
   * Complete authentication in single optimized call
   * @param {string} code - The authorization code from Riot
   * @param {string} region - The selected region
   * @returns {Promise<Object>} - The complete user data
   */
  async completeAuthentication(code, region) {
    try {
      if (!code || !region) {
        throw new Error('Missing required parameters: code and region');
      }

      // Get Twitch user data to get twitch_id (more secure than username)
      const twitchUserData = await PersistentStorage.getTwitchUserData();
      if (!twitchUserData?.id) {
        throw new Error('Twitch authentication required first. Please connect Twitch.');
      }

      console.log('[RiotAuth] completeAuthentication config check', {
        proxyBaseUrl: this.config.proxyBaseUrl,
        authComplete: this.config.endpoints.authComplete,
        twitchId: twitchUserData.id
      });

      const requestUrl = `${this.config.proxyBaseUrl}${this.config.endpoints.authComplete}`;
      console.log('[RiotAuth] About to make fetch request to:', requestUrl);
      
      if (typeof fetch === 'undefined') {
        throw new Error('fetch is not available in this environment');
      }
      
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          code: code,
          twitch_id: twitchUserData.id,
          region: region
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
        throw new Error(`Authentication failed: ${errorMessage}`);
      }

      const result = await response.json();
      
      if (!result.data || !result.data.puuid) {
        throw new Error('Invalid response: Missing user data');
      }

      return result.data;
    } catch (error) {
      console.error('[RiotAuth] completeAuthentication error:', error);
      throw error;
    }
  },

  
  
  /**
   * Check if user is authenticated
   * @returns {Promise<boolean>} - True if authenticated
   */
  async isAuthenticated() {
    try {
      // Check persistent storage - single source of truth
      return await PersistentStorage.isServiceConnected('riot');
    } catch (error) {
      return false;
    }
  },
  
  
  /**
   * Completely disconnect and clear all Riot data including persistent storage
   * @returns {Promise<boolean>} - Whether disconnect was successful
   */
  async disconnect() {
    try {
      // Attempt backend disconnect first to remove rank data in DB
      try {
        const persistentRiotData = await PersistentStorage.getRiotUserData();
        const puuid = persistentRiotData?.puuid;

        if (puuid) {
          await fetch(`${this.config.proxyBaseUrl}/disconnect`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ puuid })
          });
        }
      } catch (_) {
        // Swallow backend errors; ensure local cleanup still happens
      }

      // Clear persistent user data (single source of truth)
      await PersistentStorage.clearServiceData('riot');

      // Clear only auth-related session data (no tokens needed)
      const keysToRemove = [
        this.config.storageKeys.authState,
        'riot_auth_callback',
        'eloward_auth_callback'
      ];

      await browser.storage.local.remove(keysToRemove);

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
   * Refresh rank data using simplified PUUID-only flow
   * @param {string} puuid - The player's PUUID from persistent storage
   * @returns {Promise<Object>} - Updated rank data or error
   */
  async refreshRank(puuid) {
    try {
      if (!puuid) {
        throw new Error('No PUUID provided');
      }
      
      // Call the simplified refresh endpoint with only PUUID
      const requestUrl = `${this.config.proxyBaseUrl}/riot/refreshrank`;
      
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          puuid: puuid
        })
      });
      
      const responseData = await response.json();
      
      if (!response.ok) {
        // Do not clear any local persistent data on refresh errors; just propagate a descriptive error
        if (response.status === 404) {
          const error = new Error('Account not found.');
          error.status = 404;
          throw error;
        }

        if (responseData && responseData.action === 'clear_persistent_data') {
          const error = new Error('Account disconnected.');
          error.action = 'clear_persistent_data';
          throw error;
        }

        throw new Error((responseData && responseData.message) || 'Failed to refresh rank');
      }
      
      return responseData.data;
    } catch (error) {
      console.error('[RiotAuth] refreshRank error:', error);
      throw error;
    }
  },

  
  /**
   * Get user data from persistent storage
   * @returns {Promise<Object>} - The stored user data
   */
  async getUserDataFromStorage() {
    try {
      const userData = await PersistentStorage.getRiotUserData();
      
      if (userData) {
        return {
          ...userData,
          soloQueueRank: userData.rankInfo
        };
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }
  
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
    this._onStorageChanged = null;
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
    console.log('[RiotAuth] AuthCallbackWatcher.start()', {
      isFirefox: typeof InstallTrigger !== 'undefined'
    });
    
    // Check immediately first
    this._checkForCallback().then(found => {
      if (!found && !this.state.isResolved) {
        // Start interval checking
        this.state.intervalId = setInterval(() => this._checkForCallback(), this.config.checkInterval);
      }
    });
    
    // Firefox may need additional checks due to different timing
    const isFirefox = typeof InstallTrigger !== 'undefined';
    const extraChecks = isFirefox ? [50, 100, 250, 500] : [50];
    
    extraChecks.forEach(delay => {
      setTimeout(() => {
        if (!this.state.isResolved) {
          this._checkForCallback();
        }
      }, delay);
    });

    // Also listen for storage changes so we resolve immediately when callback lands
    try {
      this._onStorageChanged = (changes, area) => {
        if (area !== 'local' || this.state.isResolved) return;
        for (const key of this.config.callbackKeys) {
          if (Object.prototype.hasOwnProperty.call(changes, key)) {
            const newVal = changes[key]?.newValue;
            if (newVal && typeof newVal === 'object' && newVal.code) {
              const callback = { ...newVal };
              if (!callback.state) {
                browser.storage.local.get(['eloward_auth_state']).then(data => {
                  if (data.eloward_auth_state && !callback.state) {
                    callback.state = data.eloward_auth_state;
                  }
                  console.log('[RiotAuth] AuthCallbackWatcher storage event callback', { key, hasCode: !!callback.code, hasState: !!callback.state });
                  this._resolveWith(callback);
                }).catch(() => this._resolveWith(callback));
              } else {
                console.log('[RiotAuth] AuthCallbackWatcher storage event callback', { key, hasCode: !!callback.code, hasState: !!callback.state });
                this._resolveWith(callback);
              }
              break;
            }
          }
        }
      };
      browser.storage.onChanged.addListener(this._onStorageChanged);
    } catch (_) {}
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
          // Ensure state is present by falling back to stored authState if needed
          if (!callback.state) {
            try {
              const stateData = await browser.storage.local.get([RiotAuth.config.storageKeys.authState]);
              const storedState = stateData[RiotAuth.config.storageKeys.authState];
              if (storedState) {
                callback.state = storedState;
              }
            } catch (_) {}
          }
          console.log('[RiotAuth] AuthCallbackWatcher found callback in storage', { 
            key, 
            hasCode: !!callback.code, 
            hasState: !!callback.state,
            isFirefox: typeof InstallTrigger !== 'undefined',
            timestamp: callback.timestamp
          });
          return callback;
        }
      }
      return null;
    } catch (error) {
      console.error('[RiotAuth] AuthCallbackWatcher storage error:', error);
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
    console.log('[RiotAuth] AuthCallbackWatcher.resolve', { hasResult: !!result, hasCode: !!(result && result.code) });
    
    // Clean up interval
    if (this.state.intervalId) {
      clearInterval(this.state.intervalId);
      this.state.intervalId = null;
    }

    // Remove storage listener
    if (this._onStorageChanged) {
      try { browser.storage.onChanged.removeListener(this._onStorageChanged); } catch (_) {}
      this._onStorageChanged = null;
    }
    
    // Clean up callback data from storage if successful
    if (result && result.code) {
      browser.storage.local.remove(this.config.callbackKeys);
    }
    
    // Resolve the promise
    this.resolveCallback(result);
  }
}

// Helper: wait up to timeout for Riot user data written by background
RiotAuth._waitForStoredRiotUserData = async function(timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const userData = await PersistentStorage.getRiotUserData();
      if (userData && userData.puuid) {
        return {
          ...userData,
          soloQueueRank: userData.rankInfo
        };
      }
    } catch (_) {}
    await new Promise(r => setTimeout(r, 100));
  }
  return null;
};