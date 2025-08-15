/* Copyright 2024 EloWard - Apache 2.0 + Commons Clause License */

// Import webextension-polyfill for cross-browser compatibility
import '../../vendor/browser-polyfill.js';

import { PersistentStorage } from '../core/persistentStorage.js';

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
  forcePromptLogin: true,
  endpoints: {
    authInit: '/auth/init',
    authToken: '/auth/token',
    accountInfo: '/riot/account'
  },
  storageKeys: {
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
      if (region) {
        await browser.storage.local.set({ selectedRegion: region });
      }
      
      // Clear any previous auth states
      await browser.storage.local.remove([this.config.storageKeys.authState]);
      
      // Generate a unique state
      const state = this._generateRandomState();
      
      // Store the state
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
      
      // Update the authWindow reference
      if (openedAuthWindow) {
        this.authWindow = openedAuthWindow;
      }
      
      // Wait for the callback to be processed
      const authResult = await authResultPromise;
      console.log('[RiotAuth] auth result obtained', { hasCode: !!authResult?.code });
      
      if (!authResult?.code) {
        throw new Error('No authorization code received from Riot authentication');
      }
      
      // Exchange code for user data (no token storage)
      console.log('[RiotAuth] exchanging code for user data');
      const userData = await this.exchangeCodeForUserData(authResult.code);
      console.log('[RiotAuth] user data obtained');
      
      // Store user data in persistent storage
      await PersistentStorage.storeRiotUserData(userData);
      await PersistentStorage.updateConnectedState('riot', true);
      
      return userData;
    } catch (error) {
      console.error('[RiotAuth] authenticate() error:', error);
      throw error;
    } finally {
      // Clean up auth state
      try {
        await browser.storage.local.remove(['eloward_popup_auth_active']);
      } catch (_) {}
    }
  },

  async _storeAuthState(state) {
    await browser.storage.local.set({ [this.config.storageKeys.authState]: state });
  },

  async _getStoredAuthState() {
    try {
      const result = await browser.storage.local.get([this.config.storageKeys.authState]);
      return result[this.config.storageKeys.authState] || null;
    } catch (error) {
      return null;
    }
  },

  async _getAuthUrl(region, state) {
    const response = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.authInit}?state=${state}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get auth URL: ${errorText}`);
    }
    
    const data = await response.json();
    
    if (!data.authorizationUrl) {
      throw new Error('No authorization URL returned from server');
    }
    
    return data.authorizationUrl;
  },

  async _waitForAuthCallback() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Authentication timeout after 5 minutes'));
      }, 5 * 60 * 1000);
      
      const checkForCallback = async () => {
        try {
          const callbackData = await this._getCallbackData();
          if (callbackData?.code) {
            clearTimeout(timeout);
            resolve(callbackData);
            return;
          }
        } catch (error) {
          // Continue checking
        }
        
        // Check again in 500ms
        setTimeout(checkForCallback, 500);
      };
      
      checkForCallback();
    });
  },

  async exchangeCodeForUserData(code) {
    try {
      console.log('[RiotAuth] exchanging code for user data');
      
      // Exchange code for tokens (but don't store them)
      const tokenResponse = await fetch(`${this.config.proxyBaseUrl}${this.config.endpoints.authToken}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ code })
      });
      
      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(`Token exchange failed: ${errorText}`);
      }
      
      const tokenData = await tokenResponse.json();
      if (!tokenData.access_token) {
        throw new Error('No access token received');
      }
      
      console.log('[RiotAuth] temporary tokens obtained, getting account info');
      
      // Get account info using the temporary token
      const accountData = await this.getAccountInfo(tokenData.access_token);
      
      // Get rank data using PUUID
      const rankData = await this.getRankInfo(accountData.puuid);
      
      // Return user data with rank info
      const userData = {
        puuid: accountData.puuid,
        riotId: `${accountData.gameName}#${accountData.tagLine}`,
        soloQueueRank: rankData
      };
      
      return userData;
    } catch (error) {
      console.error('[RiotAuth] exchangeCodeForUserData error:', error);
      throw error;
    }
  },

  async isAuthenticated(ignoreInitialErrors = false) {
    try {
      // Check persistent storage only - no token validation needed
      const isConnectedInPersistentStorage = await PersistentStorage.isServiceConnected('riot');
      return isConnectedInPersistentStorage;
    } catch (error) {
      return false;
    }
  },
  
  async getAccountInfo(accessToken) {
    try {
      // Always use Americas region for account info
      const accountUrl = `${this.config.proxyBaseUrl}${this.config.endpoints.accountInfo}`;
      const accountResponse = await fetch(accountUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
      
      if (!accountResponse.ok) {
        const errorText = await accountResponse.text();
        throw new Error(`Account info request failed: ${errorText}`);
      }
      
      const accountData = await accountResponse.json();
      
      if (!accountData.puuid) {
        throw new Error('No PUUID found in account data');
      }
      
      return accountData;
    } catch (error) {
      throw error;
    }
  },

  async getRankInfo(puuid) {
    try {
      const region = (await this._getStoredValue('selectedRegion')) || 'na1';
      
      // Use the new simplified rank refresh endpoint
      const resp = await fetch(`${this.config.proxyBaseUrl}/riot/refreshrank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ puuid, region })
      });

      if (!resp.ok) {
        // Return null for rank if can't fetch
        return null;
      }

      const data = await resp.json();
      const rank = data?.rank || null;
      
      if (!rank) return null;

      return {
        tier: String(rank.tier || 'UNRANKED').toUpperCase(),
        rank: rank.division || '',
        leaguePoints: rank.leaguePoints ?? null
      };
    } catch (error) {
      // Return null for rank if error occurs
      return null;
    }
  },

  async disconnect() {
    try {
      console.log('[RiotAuth] disconnecting');
      
      // Get PUUID for backend cleanup
      const userData = await PersistentStorage.getRiotUserData();
      const puuid = userData?.puuid;
      
      // Call simplified disconnect endpoint if we have PUUID
      if (puuid) {
        try {
          const response = await fetch(`${this.config.proxyBaseUrl}/riot/disconnect`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ puuid })
          });
          
          // Continue with local cleanup regardless of backend result
          if (!response.ok) {
            console.warn('[RiotAuth] backend disconnect failed, continuing with local cleanup');
          }
        } catch (backendError) {
          console.warn('[RiotAuth] backend disconnect error:', backendError);
          // Continue with local cleanup
        }
      }

      // Clear persistent user data
      await PersistentStorage.clearServiceData('riot');
      
      // Update connected state
      await PersistentStorage.updateConnectedState('riot', false);
      
      console.log('[RiotAuth] disconnect completed');
      return true;
    } catch (error) {
      console.error('[RiotAuth] disconnect error:', error);
      throw error;
    }
  },

  async getUserData(skipAuthCheck = false) {
    try {
      // Get data from persistent storage
      const userData = await PersistentStorage.getRiotUserData();
      
      if (userData) {
        return userData;
      }
      
      if (!skipAuthCheck) {
        throw new ReAuthenticationRequiredError('No user data found in storage');
      }
      
      return null;
    } catch (error) {
      throw error;
    }
  },

  async _getStoredValue(key) {
    if (!key) return null;
    
    try {
      const result = await browser.storage.local.get([key]);
      return result[key] || null;
    } catch (error) {
      return null;
    }
  },

  async getUserDataFromStorage() {
    try {
      return await PersistentStorage.getRiotUserData();
    } catch (error) {
      return null;
    }
  },

  async _getCallbackData() {
    try {
      const result = await browser.storage.local.get([this.config.storageKeys.authCallback]);
      return result[this.config.storageKeys.authCallback] || null;
    } catch (error) {
      return null;
    }
  },

  async _openAuthWindow(authUrl) {
    return new Promise((resolve, reject) => {
      try {
        browser.windows.create({
          url: authUrl,
          type: 'popup',
          width: 500,
          height: 700
        }).then((window) => {
          resolve(window);
        }).catch(reject);
      } catch (error) {
        reject(error);
      }
    });
  },

  _generateRandomState() {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  },
};