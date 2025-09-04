/* Copyright 2024 EloWard - Apache 2.0 + Commons Clause License */

// EloWard Twitch Authentication

// Import webextension-polyfill for cross-browser compatibility
import '../../vendor/browser-polyfill.js';

import { PersistentStorage } from '../core/persistentStorage.js';

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
  redirectUri: 'https://www.eloward.com/twitch/auth/redirect',
  clientId: 'pml5yi4pqvuo281akjq0q6topaeli3',
  // Make sure scopes match what's in the twitchRSO implementation
  scopes: 'user:read:email',
  // Conditionally force the authorization screen only when switching accounts
  forceVerify: false, // Will be set dynamically based on context
  endpoints: {
    // Consolidated tokenless endpoint (primary)
    authComplete: '/twitch/auth'
  },
  storageKeys: {
    // Token keys retained only for cleanup of legacy clients; no longer used
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
      console.log('[TwitchAuth] Starting authentication flow...');
      
      // Check if user recently disconnected (wants to switch accounts)
      const switchAccountMode = await this._shouldForceReauthorization();
      console.log('[TwitchAuth] Switch account mode:', switchAccountMode);
      
      // Clear any previous auth states
      await browser.storage.local.remove([this.config.storageKeys.authState]);
      
      // Generate a unique state value for CSRF protection and tag as extension flow
      const state = `ext:${this._generateRandomState()}`;
      
      // Store the state for verification when the user returns
      await this._storeAuthState(state);
      
      // Get authentication URL from the backend proxy
      const authUrl = await this._getAuthUrl(state, switchAccountMode);
      
      // Clear any existing callbacks before opening the window
      try {
        await browser.storage.local.remove(['auth_callback', 'twitch_auth_callback']);
      } catch (e) {
        // Non-fatal error, continue with authentication
      }
      
      // Mark that we're handling auth in popup to avoid duplicate background processing
      try { await browser.storage.local.set({ 'eloward_popup_auth_active': true }); } catch (_) {}
      // Small delay to ensure listeners see the flag
      try { await new Promise(r => setTimeout(r, 50)); } catch (_) {}

      // Open the auth window
      this._openAuthWindow(authUrl);
      
      // Wait for the user to complete authentication
      const authResult = await this._waitForAuthCallback();
      
      if (!authResult || !authResult.code) {
        throw new Error('Twitch authentication failed or was cancelled');
      }
      
      // Verify the state to prevent CSRF attacks
      if (authResult.state !== state) {
        console.warn('[TwitchAuth] State mismatch - expected:', state, 'got:', authResult.state);
        
        // Try fallback state verification
        const storedState = await this._getStoredAuthState();
        if (authResult.state !== storedState) {
          throw new Error('Security verification failed: state mismatch in Twitch auth');
        }
      }
      
      console.log('[TwitchAuth] State verification passed');
      
      // Clear any temporary callback keys written by the bridge
      try { await browser.storage.local.remove(['auth_callback','eloward_auth_callback','twitch_auth_callback']); } catch (_) {}

      // Give background a brief chance to complete auth first (prevents double exchange in Firefox)
      console.log('[TwitchAuth] Checking if background completed auth...');
      const bgUser = await this._waitForStoredTwitchUserData(2000);
      if (bgUser) {
        console.log('[TwitchAuth] Background completed auth successfully:', bgUser.login || bgUser.id);
        await PersistentStorage.updateConnectedState('twitch', true);
        return bgUser;
      }

      // Background didn't complete in time: perform tokenless Twitch auth via backend here
      console.log('[TwitchAuth] Background did not complete, performing tokenless auth...');
      const completed = await this.completeAuthentication(authResult.code);
      if (completed && completed.id) {
        console.log('[TwitchAuth] Tokenless auth completed successfully:', completed.login || completed.id);
        await PersistentStorage.storeTwitchUserData(completed);
        await PersistentStorage.updateConnectedState('twitch', true);
        return completed;
      }
      // Fallback minimal success
      console.log('[TwitchAuth] Using fallback minimal success response');
      await PersistentStorage.updateConnectedState('twitch', true);
      return { authenticated: true };
    } catch (error) {
      console.error('[TwitchAuth] Authentication failed:', error.message);
      
      // Check if this might be a 2FA/userscript interference issue
      if (error.message?.includes('400') || error.message?.includes('Bad Request')) {
        console.warn('[TwitchAuth] Possible 2FA or userscript interference detected');
        console.warn('[TwitchAuth] Try disabling Twitch-related browser extensions/userscripts and retry');
      }
      
      // Ensure the connected state is reset on any error
      try {
        await PersistentStorage.updateConnectedState('twitch', false);
      } catch (storageError) {
      }
      throw error;
    } finally {
      // Clear popup auth flag regardless of outcome
      try { await browser.storage.local.remove('eloward_popup_auth_active'); } catch (_) {}
    }
  },

  /**
   * Complete Twitch authentication (tokenless) against backend
   * @param {string} code
   * @returns {Promise<Object>} minimal user data { id, login, display_name, profile_image_url, email? }
   */
  async completeAuthentication(code) {
    const url = `${this.config.proxyBaseUrl}${this.config.endpoints.authComplete}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirect_uri: this.config.redirectUri })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.success || !data?.user_data) {
      const msg = data?.error_description || data?.error || `${response.status}: ${response.statusText}`;
      throw new Error(`Twitch auth failed: ${msg}`);
    }
    return data.user_data;
  },
  
  /**
   * Store authentication state in both storage mechanisms
   * @param {string} state - The state to store
   * @private
   */
  async _storeAuthState(state) {
    await browser.storage.local.set({ [this.config.storageKeys.authState]: state });
  },
  
  /**
   * Retrieve stored authentication state
   * @returns {Promise<string|null>} The stored state or null if not found
   * @private
   */
  async _getStoredAuthState() {
    // Get from browser.storage.local
    const browserData = await browser.storage.local.get([this.config.storageKeys.authState]);
    
    const state = browserData[this.config.storageKeys.authState];
    if (state) {
      return state;
    }
    
    return null;
  },
  
  /**
   * Get authentication URL from backend
   * @param {string} state - A unique state for CSRF protection
   * @param {boolean} forceReauth - Whether to force re-authorization screen
   * @returns {Promise<string>} The authentication URL
   * @private
   */
  async _getAuthUrl(state, forceReauth = false) {
    try {
      const clientId = this.config.clientId && String(this.config.clientId).trim();
      const authUrl = new URL('https://id.twitch.tv/oauth2/authorize');
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('redirect_uri', this.config.redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', this.config.scopes);
      authUrl.searchParams.set('state', state);
      
      // Only show authorization screen when user explicitly wants to switch accounts
      if (forceReauth) {
        console.log('[TwitchAuth] Adding force_verify for account switching');
        authUrl.searchParams.set('force_verify', 'true');
      } else {
        console.log('[TwitchAuth] Using normal auth flow (no force_verify)');
      }
      
      return authUrl.toString();
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
        browser.runtime.sendMessage({
          type: 'open_auth_window',
          url: authUrl,
          service: 'twitch'
        }).then(response => {
          if (response && response.success) {
          } else {
            throw new Error('Failed to open authentication window - unknown error');
          }
        }).catch(error => {
          throw new Error('Failed to open authentication window - popup may be blocked');
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
      const maxWaitTime = 600000; // 10 minutes (extended for 2FA + force_verify flow)
      const checkInterval = 1500; // 1.5 seconds (slightly slower polling to be less aggressive)
      let elapsedTime = 0;
      let intervalId;
      let resolved = false;
      
      const cleanup = () => {
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
        try { window.removeEventListener('message', messageListener); } catch (_) {}
        try { if (onStorageChanged) browser.storage.onChanged.removeListener(onStorageChanged); } catch (_) {}
      };
      
      const resolveOnce = (value) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(value);
      };
      
      // Function to check for auth callback data
      const checkForCallback = async () => {
        const data = await browser.storage.local.get(['auth_callback', 'twitch_auth_callback', this.config.storageKeys.authCallback]);
        const callback = data.auth_callback || data.twitch_auth_callback || data[this.config.storageKeys.authCallback];
        if (callback) {
          try { browser.storage.local.remove(['auth_callback', 'twitch_auth_callback', this.config.storageKeys.authCallback]); } catch (_) {}
          if (callback.code) {
            resolveOnce(callback);
            return true;
          } else if (callback.error) {
            resolveOnce(null);
            return true;
          }
        }
        
        if (this.authWindow && this.authWindow.closed) {
          // Give extra time for callbacks to arrive after window closure (2FA + force_verify can be slower)
          await new Promise(r => setTimeout(r, 2000));
          const lastCheck = await browser.storage.local.get(['auth_callback', 'twitch_auth_callback', this.config.storageKeys.authCallback]);
          const lastCallback = lastCheck.auth_callback || lastCheck.twitch_auth_callback || lastCheck[this.config.storageKeys.authCallback];
          try { browser.storage.local.remove(['auth_callback', 'twitch_auth_callback', this.config.storageKeys.authCallback]); } catch (_) {}
          resolveOnce(lastCallback && lastCallback.code ? lastCallback : null);
          return true;
        }
        
        elapsedTime += checkInterval;
        if (elapsedTime >= maxWaitTime) {
          resolveOnce(null);
          return true;
        }
        return false;
      };
      
      // Immediate check, then poll
      checkForCallback().then(found => {
        if (!found && !resolved) {
          intervalId = setInterval(checkForCallback, checkInterval);
        }
      });
      
      // Listen for direct window messages from the redirect page
      const messageListener = (event) => {
        if (resolved) return;
        if (event.data && ((event.data.type === 'auth_callback' && event.data.code) || (event.data.source === 'eloward_auth' && event.data.code) || (event.data.service === 'twitch' && event.data.code) || (event.data.code && (event.data.state || event.data.scope || event.data.token_type)))) {
          const callbackData = { ...event.data, timestamp: Date.now() };
          try {
            browser.storage.local.set({ 'auth_callback': callbackData, 'twitch_auth_callback': callbackData, [this.config.storageKeys.authCallback]: callbackData });
          } catch (_) {}
          resolveOnce(event.data);
        } else if (event.data && event.data.error) {
          resolveOnce(null);
        }
      };
      window.addEventListener('message', messageListener);
      
      // Also listen for storage changes to resolve faster than polling
      let onStorageChanged = null;
      try {
        onStorageChanged = (changes, area) => {
          if (resolved || area !== 'local') return;
          for (const key of ['auth_callback', 'twitch_auth_callback', this.config.storageKeys.authCallback]) {
            if (Object.prototype.hasOwnProperty.call(changes, key)) {
              const newVal = changes[key]?.newValue;
              if (newVal && newVal.code) {
                resolveOnce(newVal);
                break;
              } else if (newVal && newVal.error) {
                resolveOnce(null);
                break;
              }
            }
          }
        };
        browser.storage.onChanged.addListener(onStorageChanged);
      } catch (_) {}
    });
  },
  
  // exchangeCodeForTokens removed in tokenless flow
  // _storeTokens removed in tokenless flow
  
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
      
      // No client tokens in the new flow; rely on persisted state only
      return false;
    } catch (error) {
      return false;
    }
  },
  
  /**
   * Get a valid access token, refreshing if necessary
   * @returns {Promise<string>} The access token
   */
  // getValidToken removed in tokenless flow
  
  /**
   * Refresh access token using a refresh token
   * @param {string} refreshToken - The refresh token
   * @returns {Promise<Object>} The new tokens
   */
  // refreshToken removed in tokenless flow
  
  /**
   * Completely disconnect and clear all Twitch data including persistent storage
   * @returns {Promise<boolean>} - Whether disconnect was successful
   */
  async disconnect() {
    try {
      // 1) Clear persistent user data and connected state (single source of truth)
      await PersistentStorage.clearServiceData('twitch');

      // 2) Remove any tokens and cached user info so next connect is a full OAuth
      const keysToRemove = [
        this.config.storageKeys.tokens,            // legacy cleanup
        this.config.storageKeys.userInfo,          // legacy cleanup
        this.config.storageKeys.accessToken,       // legacy cleanup
        this.config.storageKeys.refreshToken,      // legacy cleanup
        this.config.storageKeys.tokenExpiry,       // legacy cleanup
        this.config.storageKeys.authState,
        'auth_callback',
        'twitch_auth',
        'twitch_auth_callback',
        'eloward_auth_callback'
      ];

      try {
        await browser.storage.local.remove(keysToRemove);
      } catch (_) {}

      // 3) Explicitly mark service disconnected to avoid isAuthenticated short-circuit
      try { await PersistentStorage.updateConnectedState('twitch', false); } catch (_) {}

      // 4) Set flag to show authorization screen on next connect (for account switching)
      try {
        await browser.storage.local.set({ 
          'eloward_twitch_wants_reauth': true,
          'eloward_twitch_disconnect_timestamp': Date.now()
        });
        console.log('[TwitchAuth] Set reauth flag for account switching');
      } catch (_) {}

      return true;
    } catch (error) {
      return false;
    }
  },
  
  /**
   * Check if we should force re-authorization (user wants to switch accounts)
   * @returns {Promise<boolean>} True if should show authorization screen
   * @private
   */
  async _shouldForceReauthorization() {
    try {
      const { eloward_twitch_wants_reauth: wantsReauth, eloward_twitch_disconnect_timestamp: disconnectTime } = 
        await browser.storage.local.get(['eloward_twitch_wants_reauth', 'eloward_twitch_disconnect_timestamp']);
      
      if (wantsReauth && disconnectTime) {
        // Clear the flag so it's only used once
        await browser.storage.local.remove(['eloward_twitch_wants_reauth', 'eloward_twitch_disconnect_timestamp']);
        
        // Only use force_verify if disconnect was recent (within 10 minutes)
        const tenMinutes = 10 * 60 * 1000;
        const isRecent = (Date.now() - disconnectTime) < tenMinutes;
        
        console.log('[TwitchAuth] Recent disconnect for account switching:', isRecent);
        return isRecent;
      }
      
      return false;
    } catch (error) {
      console.warn('[TwitchAuth] Error checking reauth flag:', error);
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
      // No token-based fallback in the new flow
      throw new Error('No Twitch user data available');
    } catch (error) {
      throw error;
    }
  },
  
  /**
   * Store user information
   * @param {Object} userInfo - The user information to store
   * @private
   */
  // Removed: deprecated local userInfo cache (unused)
  
  /**
   * Store a value in browser.storage.local
   * @param {string} key - The key to store under
   * @param {string} value - The value to store
   * @private
   */
  async _storeValue(key, value) {
    // Store only in browser.storage.local for consistency
    try {
      await browser.storage.local.set({ [key]: value });
    } catch (error) {
      throw error;
    }
  },
  
  /**
   * Get a stored value from browser.storage.local
   * @param {string} key - The key to retrieve
   * @returns {Promise<string|null>} The stored value or null if not found
   * @private
   */
  async _getStoredValue(key) {
    // Tokens no longer used; this is a simple local getter now
    try {
      const result = await browser.storage.local.get([key]);
      return result[key] || null;
    } catch (error) {
      return null;
    }
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

// Helper: wait up to timeoutMs for background to store Twitch user data
TwitchAuth._waitForStoredTwitchUserData = async function(timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const user = await PersistentStorage.getTwitchUserData();
      if (user && user.id) return user;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 100));
  }
  return null;
};