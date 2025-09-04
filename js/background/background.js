/* Copyright 2024 EloWard - Apache 2.0 + Commons Clause License */

// Reduce verbose logging in production

// Import webextension-polyfill for cross-browser compatibility
import '../../vendor/browser-polyfill.js';

import { RiotAuth } from '../auth/riotAuth.js';
import { TwitchAuth } from '../auth/twitchAuth.js';
import { PersistentStorage } from '../core/persistentStorage.js';

// Removed RIOT_AUTH_URL constant - no longer needed with server-side auth
const RANK_WORKER_API_URL = 'https://eloward-ranks.unleashai.workers.dev';
const STATUS_API_URL = 'https://eloward-users.unleashai.workers.dev';
const MAX_RANK_CACHE_SIZE = 1000;
const RANK_CACHE_STORAGE_KEY = 'eloward_rank_cache';
const RANK_CACHE_UPDATED_AT_KEY = 'eloward_rank_cache_last_updated';
const RANK_CACHE_EXPIRY = 60 * 60 * 1000;
const RANK_REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

 

class UserRankCache {
  constructor(maxSize = MAX_RANK_CACHE_SIZE) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.currentUser = null;
  }

  setCurrentUser(username) {
    if (username) {
      this.currentUser = username.toLowerCase();
    }
  }

  get(username) {
    if (!username) return null;
    const normalizedUsername = username.toLowerCase();
    const entry = this.cache.get(normalizedUsername);

    if (entry) {
      if (entry.timestamp && (Date.now() - entry.timestamp > RANK_CACHE_EXPIRY)) {
        this.cache.delete(normalizedUsername);
        return null;
      }

      entry.frequency = (entry.frequency || 0) + 1;
      return entry.rankData;
    }

    return null;
  }

  set(username, rankData) {
    if (!username || !rankData) return;

    const normalizedUsername = username.toLowerCase();
    let entry = this.cache.get(normalizedUsername);

    if (entry) {
      entry.rankData = rankData;
      entry.frequency = (entry.frequency || 0) + 1;
      entry.timestamp = Date.now();
    } else {
      entry = { 
        rankData, 
        frequency: 1,
        timestamp: Date.now()
      };
      this.cache.set(normalizedUsername, entry);

      if (this.cache.size > this.maxSize) {
        this.evictLFU();
      }
    }

    maybePersistRankCache(this).catch(() => {});
  }

  clear() {
    const currentUserEntry = this.currentUser ? this.cache.get(this.currentUser) : null;
    this.cache.clear();

    // Preserve current user entry to prevent loss of local user data
    if (this.currentUser && currentUserEntry) {
      this.cache.set(this.currentUser, currentUserEntry);
    }

    maybePersistRankCache(this).catch(() => {});
  }

  evictLFU() {
    let lowestFrequency = Infinity;
    let userToEvict = null;

    for (const [key, entry] of this.cache.entries()) {
      // Never evict current user
      if (key === this.currentUser) {
        continue;
      }

      if (entry.timestamp && (Date.now() - entry.timestamp > RANK_CACHE_EXPIRY)) {
        this.cache.delete(key);
        return;
      }

      if (entry.frequency < lowestFrequency) {
        lowestFrequency = entry.frequency;
        userToEvict = key;
      }
    }

    if (userToEvict) {
      this.cache.delete(userToEvict);
    }

    // Persist after eviction to keep storage mirror in sync
    maybePersistRankCache(this).catch(() => {});
  }

  has(username) {
    if (!username) return false;
    const normalizedUsername = username.toLowerCase();

    const entry = this.cache.get(normalizedUsername);
    if (entry && entry.timestamp && (Date.now() - entry.timestamp > RANK_CACHE_EXPIRY)) {
      this.cache.delete(normalizedUsername);
      return false;
    }

    return this.cache.has(normalizedUsername);
  }

  get size() {
    return this.cache.size;
  }
}

const userRankCache = new UserRankCache();
let authWindows = {};
const processedAuthStates = new Set();

async function handleAuthCallback(params) {
  if (!params || !params.code) {
    console.log('[EloWard Background] Invalid params or missing code');
    return;
  }

  // Determine service early so we can decide handling strategy
  const isTwitchCallback = params.service === 'twitch';

  // Even if the popup initiated auth, ALWAYS process auth in the background for robustness across browsers.
  // The popup flow will wait briefly to avoid double exchanges.
  try {
    const { eloward_popup_auth_active } = await browser.storage.local.get(['eloward_popup_auth_active']);
    if (eloward_popup_auth_active) {
      console.log('[EloWard Background] Popup is handling auth, continuing background processing for robustness');
    }
  } catch (_) {}

  // De-duplicate by state to avoid double-processing in Firefox
  if (params.state && processedAuthStates.has(params.state)) {
    return;
  }
  if (params.state) {
    processedAuthStates.add(params.state);
  }

  // Store a single ephemeral callback record for debugging/compatibility
  browser.storage.local.set({
    'auth_callback': {
      ...params,
      timestamp: Date.now()
    }
  });

  // isTwitchCallback already determined above

  // Ignore website-initiated Twitch auth callbacks (state not tagged with 'ext:')
  if (isTwitchCallback) {
    const st = String(params.state || '');
    if (!st.startsWith('ext:')) {
      // Store for visibility then skip processing so the website can use the code
      try {
        browser.storage.local.set({ 'auth_callback': { ...params, timestamp: Date.now(), ignored: true } });
      } catch (_) {}
      return;
    }
  }

  // Perform token exchange and ensure we catch errors to avoid uncaught promise rejections
  initiateTokenExchange(params, isTwitchCallback ? 'twitch' : 'riot')
    .then(() => { /* success already notifies popup */ })
    .catch((err) => {
      // Optionally notify popup/UI of failure without throwing
      try {
        browser.runtime.sendMessage({
          type: 'auth_failed',
          service: isTwitchCallback ? 'twitch' : 'riot',
          error: err?.message || 'Authentication failed'
        });
      } catch (_) { /* ignore messaging errors */ }
    });
}

async function initiateTokenExchange(authData, service = 'riot') {
  try {
    if (!authData || !authData.code) {
      throw new Error('Invalid auth data for token exchange');
    }

    if (service === 'twitch') {
      // Tokenless consolidated flow
      const userInfo = await TwitchAuth.completeAuthentication(authData.code);

      // Ensure all storage operations complete before returning
      await PersistentStorage.storeTwitchUserData(userInfo);
      await PersistentStorage.updateConnectedState('twitch', true);

      // Notify popup after all data is successfully stored (ignore if no listeners)
      try {
        await browser.runtime.sendMessage({
          type: 'auth_completed',
          service: 'twitch'
        });
      } catch (_) {}

      return userInfo;
    } else {
      // Riot auth: complete server-side via background for cross-browser robustness
      // Get region that was stored before auth window opened
      let region = 'na1';
      try {
        const data = await browser.storage.local.get(['selectedRegion']);
        if (data && data.selectedRegion) region = data.selectedRegion;
      } catch (_) {}

      // Complete authentication via RiotAuth helper; it validates Twitch linkage inside
      const riotUser = await RiotAuth.completeAuthentication(authData.code, region);

      // Persist Riot user data and mark connected
      await PersistentStorage.storeRiotUserData(riotUser);
      await PersistentStorage.updateConnectedState('riot', true);

      // Notify popup/UI listeners
      try {
        await browser.runtime.sendMessage({
          type: 'auth_completed',
          service: 'riot'
        });
      } catch (_) {}

      return riotUser;
    }
  } catch (error) {
    throw error;
  }
}

// Add comprehensive logging at the very start
console.log('[EloWard Background] Background script loaded and ready');
console.log('[EloWard Background] Setting up message listeners...');

// Initialize storage; do not restore rank cache across sessions
(async () => {
  try {
    await PersistentStorage.init();
    // Do not restore rank cache across sessions; start with a fresh cache each session
  } catch (_) {}
})();

// Persist/restore helpers for the rank cache (optional, gated by persistence flag)
async function maybePersistRankCache(cacheInstance) {
  try {
    const { eloward_data_persistence_enabled: persistenceEnabled } = await browser.storage.local.get(['eloward_data_persistence_enabled']);
    if (!persistenceEnabled) return;

    const payload = {};
    for (const [username, entry] of cacheInstance.cache.entries()) {
      payload[username] = {
        rankData: entry.rankData,
        frequency: entry.frequency || 0,
        timestamp: entry.timestamp || Date.now()
      };
    }
    await browser.storage.local.set({
      [RANK_CACHE_STORAGE_KEY]: payload,
      [RANK_CACHE_UPDATED_AT_KEY]: Date.now()
    });
  } catch (_) { /* ignore */ }
}

async function restoreRankCacheFromStorage(cacheInstance) {
  try {
    const { eloward_data_persistence_enabled: persistenceEnabled } = await browser.storage.local.get(['eloward_data_persistence_enabled']);
    if (!persistenceEnabled) return;

    const data = await browser.storage.local.get([RANK_CACHE_STORAGE_KEY]);
    const stored = data[RANK_CACHE_STORAGE_KEY];
    if (!stored || typeof stored !== 'object') return;

    for (const [username, entry] of Object.entries(stored)) {
      if (entry && entry.rankData) {
        cacheInstance.cache.set(username.toLowerCase(), {
          rankData: entry.rankData,
          frequency: entry.frequency || 1,
          timestamp: entry.timestamp || Date.now()
        });
      }
    }
  } catch (_) { /* ignore */ }
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  
  if (message.action === 'increment_db_reads' && message.channel) {
    incrementDbReadCounter(message.channel)
      .then(success => sendResponse({ success }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (message.action === 'increment_successful_lookups' && message.channel) {
    incrementSuccessfulLookupCounter(message.channel)
      .then(success => sendResponse({ success }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (message.type === 'twitch_auth_callback' || (message.type === 'auth_callback' && message.service === 'twitch')) {
    try {
      const params = message.params || {
        code: message.code,
        state: message.state,
        service: 'twitch',
        source: 'twitch_auth_callback'
      };
      
      if (!params.code) {
        sendResponse({ 
          success: false, 
          error: 'Missing required authorization code' 
        });
        return true;
      }
      
      handleAuthCallback({
        ...params,
        source: 'twitch_auth_callback',
        received_at: Date.now(),
        sender_info: {
          id: sender.id || 'unknown',
          url: sender.url || 'unknown'
        }
      });
      
      sendResponse({ 
        success: true, 
        message: 'Twitch auth callback received and processing',
      });
      
      setTimeout(() => {
        browser.runtime.sendMessage({
          type: 'twitch_auth_processed',
          success: true,
          timestamp: Date.now()
        }).catch(() => {
          // Ignore messaging errors
        });
      }, 500);
      
      return false; // response sent synchronously
    } catch (error) {
      sendResponse({ 
        success: false, 
        error: error.message || 'Unknown error processing Twitch auth callback'
      });
      return false;
    }
  }
  
  // Removed legacy get_auth_callback handler (unused)
  
  if (message.type === 'auth_callback') {
    
    let params;
    if (message.code) {
      // Handle direct code in message
      params = {
        code: message.code,
        state: message.state,
        service: message.service || 'riot'
      };
    } else if (message.params) {
      // Handle params object
      params = message.params;
    } else {
      console.log('[EloWard Background] No auth data in message');
      sendResponse({ success: false, error: 'No auth data' });
      return true;
    }
    
    handleAuthCallback(params);
    sendResponse({ success: true });
    return false; // response sent synchronously
  }
  
  if (message.type === 'open_auth_window') {
    if (message.url) {
      const windowId = Date.now().toString();
      
      browser.windows.create({
        url: message.url,
        type: 'popup',
        width: 500,
        height: 700
      }).then((window) => {
        authWindows[windowId] = {
          window,
          state: message.state,
          createdAt: Date.now()
        };
        
        sendResponse({ success: true, windowId });
      });
    } else {
      sendResponse({ success: false, error: 'No URL provided' });
    }
    return true;
  }
  
  if (message.action === 'initiate_riot_auth') {
    const state = message.state || Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    browser.storage.local.set({
      'eloward_auth_state': state,
      [RiotAuth.config.storageKeys.authState]: state,
      'selectedRegion': message.region || 'na1'
    });
    
    // Build authorization URL directly without backend call
    try {
      const minimumScopes = 'openid offline_access lol cpid';
      const params = new URLSearchParams({
        client_id: RiotAuth.config.clientId,
        redirect_uri: RiotAuth.config.redirectUri,
        response_type: 'code',
        scope: minimumScopes,
        state: state,
        prompt: 'login',
        max_age: '0'
      });
      
      const authUrl = `https://auth.riotgames.com/authorize?${params.toString()}`;
      
      sendResponse({
        success: true,
        authUrl: authUrl
      });
    } catch (error) {
      sendResponse({
        success: false,
        error: error.message || 'Failed to build authorization URL'
      });
    }
    
    return false; // synchronous response
  }
  
  // Removed legacy handle_auth_callback action (unused)
  
  if (message.action === 'get_rank_icon_url') {
    const iconUrl = getRankIconUrl(message.tier, message.isPremium);
    sendResponse({ iconUrl: iconUrl });
    return false; // synchronous response
  }
  
  if (message.action === 'fetch_rank_for_username') {
    const username = message.username;
    const channelName = message.channel;
    
    if (!username) {
      sendResponse({ success: false, error: 'No username provided' });
      return true;
    }
    
    if (channelName) {
      incrementDbReadCounter(channelName).catch(() => {});
    }
    
    const cachedRankData = userRankCache.get(username);
    if (cachedRankData) {
      if (channelName && cachedRankData?.tier) {
        incrementSuccessfulLookupCounter(channelName).catch(() => {});
      }
      
      sendResponse({
        success: true,
        rankData: cachedRankData,
        source: 'cache'
      });
      
      return true;
    }
    
    // Fetch rank data from database (region is already stored there)
    fetchRankByTwitchUsername(username)
      .then(rankData => {
        if (rankData) {
          userRankCache.set(username, rankData);
          if (channelName && rankData?.tier) {
            incrementSuccessfulLookupCounter(channelName).catch(() => {});
          }
        }
        sendResponse({ success: true, rankData, source: 'api' });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message || 'Error fetching rank data' });
      });
    
    return true;
  }
  
  // Removed deprecated get_user_rank_by_puuid action - no longer needed with server-side auth
  
  if (message.action === 'check_channel_active') {
    const streamer = message.streamer;
    const skipCache = !!message.skipCache;
    
    checkChannelActive(streamer, skipCache)
      .then(active => {
        sendResponse({ active: active });
      })
      .catch(error => {
        sendResponse({ active: false, error: error.message });
      });
    return true;
  }
  
  if (message.action === 'set_current_user') {
    userRankCache.setCurrentUser(message.username);
    sendResponse({ success: true });
    return false; // synchronous response
  }
  
  // Enhanced local user rank data caching with persistent storage update
  if (message.action === 'set_rank_data') {
    if (message.username && message.rankData) {
      const normalizedUsername = message.username.toLowerCase();
      
      // Add to cache
      userRankCache.set(normalizedUsername, message.rankData);
      
      // If this is the current user, also update persistent storage
      if (userRankCache.currentUser === normalizedUsername) {
        updatePersistentRiotDataFromRankData(message.rankData).catch(error => {
          console.warn('[Background] Failed to update persistent riot data:', error);
        });
      }
      
      // Broadcast update so content scripts can immediately apply badges
      try {
        browser.runtime.sendMessage({
          type: 'rank_data_updated',
          username: normalizedUsername,
          rankData: message.rankData
        }).catch(() => {});
      } catch (_) {}
      
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'Missing username or rank data' });
    }
    return true;
  }
  
  if (message.action === 'clear_rank_cache') {
    userRankCache.clear();
    sendResponse({ success: true });
    return false; // synchronous response
  }
  
  if (message.action === 'clear_user_rank_cache' && message.username) {
    const username = message.username.toLowerCase();
    if (userRankCache.cache.has(username)) {
      userRankCache.cache.delete(username);
      maybePersistRankCache(userRankCache).catch(() => {});
    }
    sendResponse({ success: true });
    return false; // synchronous response
  }
  
  if (message.action === 'get_all_cached_ranks') {
    const allRanks = {};
    for (const [username, entry] of userRankCache.cache.entries()) {
      allRanks[username] = entry.rankData;
    }
    sendResponse({ ranks: allRanks });
    return false; // synchronous response
  }

  if (message.action === 'prune_unranked_rank_cache') {
    try {
      for (const [username, entry] of Array.from(userRankCache.cache.entries())) {
        const tier = entry?.rankData?.tier;
        if (!tier || String(tier).toUpperCase() === 'UNRANKED') {
          userRankCache.cache.delete(username);
        }
      }
      maybePersistRankCache(userRankCache).catch(() => {});
      sendResponse({ success: true });
    } catch (e) {
      sendResponse({ success: false, error: e?.message || 'prune failed' });
    }
    return false; // synchronous
  }

  if (message.action === 'auto_refresh_rank') {
    (async () => {
      try {
        const now = Date.now();
        const { eloward_last_rank_refresh_at: lastRefreshAt } = await browser.storage.local.get(['eloward_last_rank_refresh_at']);

        const shouldRefresh = !lastRefreshAt || (now - Number(lastRefreshAt) >= RANK_REFRESH_INTERVAL_MS);

        // Verify Riot is authenticated and we have stored riot data before attempting refresh
        let canRefresh = false;
        try { canRefresh = await RiotAuth.isAuthenticated(true); } catch (_) { canRefresh = false; }
        let hasStoredRiot = false;
        try {
          const riotStored = await browser.storage.local.get(['eloward_persistent_riot_user_data']);
          hasStoredRiot = !!riotStored?.eloward_persistent_riot_user_data?.puuid;
        } catch (_) { hasStoredRiot = false; }

        if (shouldRefresh && canRefresh && hasStoredRiot) {
          // Log to page console via content script
          try {
            browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
              if (tabs[0]?.url?.includes('twitch.tv')) {
                browser.tabs.sendMessage(tabs[0].id, { 
                  type: 'console_log', 
                  message: '[EloWard] Auto rank refresh triggered' 
                }).catch(() => {});
              }
            });
          } catch (_) {}
          
          try {
            // Get PUUID from persistent storage instead of making token-based API call
            const persistentRiotData = await PersistentStorage.getRiotUserData();
            if (!persistentRiotData || !persistentRiotData.puuid) {
              throw new Error('Missing PUUID in persistent storage');
            }

            // Use simplified PUUID-only refresh
            const refreshedRankData = await RiotAuth.refreshRank(persistentRiotData.puuid);
            
            // Update the persistent data with new rank information
            const updatedUserData = {
              ...persistentRiotData,
              soloQueueRank: {
                tier: refreshedRankData.tier,
                rank: refreshedRankData.rank,
                leaguePoints: refreshedRankData.lp
              }
            };
            
            await PersistentStorage.storeRiotUserData(updatedUserData);

            // Update background cache entry for local user (if we know Twitch username)
            try {
              const twitchData = await PersistentStorage.getTwitchUserData();
              const twitchUsername = twitchData?.login?.toLowerCase();
              const region = refreshedRankData.region || 'na1';
              if (twitchUsername && updatedUserData) {
                const solo = updatedUserData.soloQueueRank || null;
                const rankData = solo ? {
                  tier: solo.tier,
                  division: solo.rank,
                  leaguePoints: solo.leaguePoints,
                  summonerName: updatedUserData.riotId,
                  region
                } : {
                  tier: 'UNRANKED',
                  division: '',
                  leaguePoints: null,
                  summonerName: updatedUserData.riotId,
                  region
                };
                userRankCache.set(twitchUsername, rankData);
              }
            } catch (_) { /* ignore cache update errors */ }

            await browser.storage.local.set({ eloward_last_rank_refresh_at: now });
            
            // Log completion to page console
            try {
              browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
                if (tabs[0]?.url?.includes('twitch.tv')) {
                  browser.tabs.sendMessage(tabs[0].id, { 
                    type: 'console_log', 
                    message: '[EloWard] Auto rank refresh completed' 
                  }).catch(() => {});
                }
              });
            } catch (_) {}
            
            sendResponse({ success: true, refreshed: true });
          } catch (e) {
            // Log failure to page console
            try {
              browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
                if (tabs[0]?.url?.includes('twitch.tv')) {
                  browser.tabs.sendMessage(tabs[0].id, { 
                    type: 'console_log', 
                    message: `[EloWard] Auto rank refresh failed: ${e?.message || 'unknown error'}` 
                  }).catch(() => {});
                }
              });
            } catch (_) {}
            
            // Auto-refresh failed - skip gracefully without altering stored data or triggering popups
            sendResponse({ success: false, refreshed: false, error: e?.message || 'refresh failed' });
          }
        } else {
          // Simple reason logging for why refresh didn't trigger
          let reason = '';
          if (!shouldRefresh) {
            const minutesSinceLast = lastRefreshAt ? Math.round((now - Number(lastRefreshAt)) / 60000) : 0;
            reason = `too soon (${minutesSinceLast} minutes since last refresh)`;
          } else if (!canRefresh) {
            reason = 'Riot account not authenticated';
          } else if (!hasStoredRiot) {
            reason = 'no Riot account data stored';
          }
          
          // Log to page console
          try {
            browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
              if (tabs[0]?.url?.includes('twitch.tv')) {
                browser.tabs.sendMessage(tabs[0].id, { 
                  type: 'console_log', 
                  message: `[EloWard] Auto rank refresh not triggered: ${reason}` 
                }).catch(() => {});
              }
            });
          } catch (_) {}
          
          sendResponse({ success: true, refreshed: false });
        }
      } catch (e) {
        console.log('[EloWard] Auto rank refresh error:', e?.message || 'unexpected error');
        sendResponse({ success: false, refreshed: false, error: e?.message || 'unexpected' });
      }
    })();
    return true;
  }

  
  sendResponse({ error: 'Unknown action', action: message.action });
  return false; // synchronous response
});

setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000;
  
  Object.keys(authWindows).forEach(id => {
    const windowData = authWindows[id];
    if (now - windowData.createdAt > maxAge) {
      delete authWindows[id];
    }
  });
}, 5 * 60 * 1000);

// ExtensionBridge content script handles all auth redirects via browser.runtime.sendMessage

browser.runtime.onInstalled.addListener((details) => {
  // Do NOT clear Twitch tokens or persistent user data on update; remove ephemeral/legacy keys and unused Riot tokens
  const clearEphemeralAndLegacyKeys = async () => {
    try {
      await browser.storage.local.remove([
        // Ephemeral auth callback/flags
        'auth_callback',
        'eloward_auth_callback',
        'riot_auth_callback',
        'twitch_auth_callback',
        'eloward_popup_auth_active',
        // Legacy/duplicate caches and old keys
        'eloward_twitch_user_info',
        'eloward_riot_account_info',
        'eloward_riot_id_token',
        'eloward_riot_rank_info',
        'eloward_signin_attempted',
        'riot_auth',
        'twitch_auth',
        // Now unused token-based keys (migrated to server-side auth)
        'eloward_riot_access_token',
        'eloward_riot_refresh_token',
        'eloward_riot_token_expiry',
        'eloward_riot_tokens',
        'eloward_twitch_access_token',
        'eloward_twitch_refresh_token',
        'eloward_twitch_token_expiry',
        'eloward_twitch_tokens'
      ]);
    } catch (_) {}
  };

  if (details.reason === 'install') {
    // Fresh install: clear ephemeral/legacy keys (no tokens yet anyway)
    clearEphemeralAndLegacyKeys();
  } else if (details.reason === 'update') {
    // Update: keep tokens and persistent data; just clean ephemera/legacy
    clearEphemeralAndLegacyKeys();
  }

  const actionApi = (browser && (browser.action || browser.browserAction)) || null;
  if (actionApi) {
    try {
      actionApi.setBadgeText({ text: 'ON' });
      actionApi.setBadgeBackgroundColor({ color: '#DC2123' });
    } catch (e) {
      // Ignore if action API is unavailable in this environment
    }
  }
  
  setTimeout(() => {
    if (actionApi) {
      try { actionApi.setBadgeText({ text: '' }); } catch (e) {}
    }
  }, 5000);
  
  // Removed legacy 'linkedAccounts' initialization; linking is derived from persistent storage
  
  // No default region on install/update
});

  // Also clear sensitive auth callback data and unused tokens on background startup for temp reloads
  (async () => {
    try {
      await browser.storage.local.remove([
        'auth_callback',
        'eloward_auth_callback',
        'riot_auth_callback',
        'twitch_auth_callback',
        'eloward_popup_auth_active',
        'eloward_twitch_user_info',
        'eloward_riot_account_info',
        'eloward_riot_id_token',
        'eloward_riot_rank_info',
        'eloward_signin_attempted',
        'riot_auth',
        RANK_CACHE_STORAGE_KEY,
        RANK_CACHE_UPDATED_AT_KEY,
        // Now unused token-based keys (migrated to server-side auth)
        'eloward_riot_access_token',
        'eloward_riot_refresh_token',
        'eloward_riot_token_expiry',
        'eloward_riot_tokens',
        'eloward_twitch_access_token',
        'eloward_twitch_refresh_token',
        'eloward_twitch_token_expiry',
        'eloward_twitch_tokens'
      ]);
    } catch (_) {}
  })();

function clearAllStoredData() {
  return new Promise((resolve) => {
    try {
      const keysToRemove = [
        // Riot auth tokens (no longer used - migrated to server-side auth)
        'eloward_riot_access_token',
        'eloward_riot_refresh_token',
        'eloward_riot_token_expiry',
        'eloward_riot_tokens',
        // Twitch auth tokens (now unused - tokenless flow)
        'eloward_twitch_access_token',
        'eloward_twitch_refresh_token',
        'eloward_twitch_token_expiry',
        'eloward_twitch_tokens',
        // Auth state and callback handling
        'eloward_auth_state',
        'eloward_twitch_auth_state',
        'auth_callback',
        'eloward_auth_callback',
        'twitch_auth_callback',
        'riot_auth_callback',
        'authCallbackProcessed'
      ];
      
      browser.storage.local.remove(keysToRemove).then(() => {
        PersistentStorage.clearAllData()
          .then(() => {
            PersistentStorage.init();
            resolve();
          })
          .catch(error => {
            resolve();
          });
      });
    } catch (error) {
      resolve();
    }
  });
}

function checkChannelActive(channelName, skipCache = false) {
  if (!channelName) {
    return Promise.resolve(false);
  }
  
  const normalizedName = channelName.toLowerCase();
  
  incrementDbReadCounter(normalizedName).catch(() => {});
  
  return fetch(`${STATUS_API_URL}/channelstatus/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ channel_name: normalizedName })
  })
  .then(response => {
    if (!response.ok) {
      throw new Error(`Channel API returned ${response.status}`);
    }
    return response.json();
  })
  .then(data => {
    return !!data.active;
  })
  .catch(error => {
    return false;
  });
}

// Removed deprecated getRankByPuuid function - no longer needed with server-side auth

function getRankIconUrl(tier, isPremium = false) {
  if (!tier) {
    return isPremium 
      ? 'https://eloward-cdn.unleashai.workers.dev/lol/unranked_premium.webp'
      : 'https://eloward-cdn.unleashai.workers.dev/lol/unranked.png';
  }
  
  const tierLower = tier.toLowerCase();
  
  const tierIcons = {
    'iron': 'iron',
    'bronze': 'bronze',
    'silver': 'silver',
    'gold': 'gold',
    'platinum': 'platinum',
    'emerald': 'emerald',
    'diamond': 'diamond',
    'master': 'master',
    'grandmaster': 'grandmaster',
    'challenger': 'challenger',
    'unranked': 'unranked'
  };
  
  const iconName = tierIcons[tierLower] || 'unranked';
  const extension = isPremium ? '.webp' : '.png';
  const suffix = isPremium ? '_premium' : '';
  
  return `https://eloward-cdn.unleashai.workers.dev/lol/${iconName}${suffix}${extension}`;
}

// Removed unused handleAuthCallbackFromRedirect in favor of storage + message callback flows

self.eloward = {
  handleAuthCallback,
  getRankIconUrl
};

async function getUserLinkedAccount(twitchUsername) {
  if (!twitchUsername) {
    return null;
  }
  
  const normalizedTwitchUsername = twitchUsername.toLowerCase();
  
  // Get current user data from PersistentStorage only
  const twitchData = await PersistentStorage.getTwitchUserData();
  const riotData = await PersistentStorage.getRiotUserData();
  
  if (twitchData?.login?.toLowerCase() === normalizedTwitchUsername && riotData) {
    return riotData;
  }
  
  return null;
}

async function getRankForLinkedAccount() {
  try {
    // Since we now use server-side auth, the linked account's rank is already in the database
    // Get the current user's Twitch username and fetch from database
    const twitchData = await PersistentStorage.getTwitchUserData();
    if (!twitchData?.login) {
      throw new Error('No Twitch user data available');
    }
    
    return await fetchRankFromDatabase(twitchData.login);
  } catch (error) {
    throw error;
  }
}

// Removed unused loadConfiguration function

// Update persistent riot data when local user rank data is cached
async function updatePersistentRiotDataFromRankData(rankData) {
  try {
    // Get existing persistent data
    const existingData = await PersistentStorage.getRiotUserData();
    
    if (existingData && existingData.puuid) {
      // Create updated data with new rank info and plus_active
      const updatedData = {
        ...existingData,
        rankInfo: {
          tier: rankData.tier,
          rank: rankData.division,
          leaguePoints: rankData.leaguePoints,
          wins: existingData.rankInfo?.wins || 0,
          losses: existingData.rankInfo?.losses || 0
        },
        region: rankData.region || existingData.region,
        plus_active: rankData.plus_active || false
      };
      
      // Store updated data
      await PersistentStorage.storeRiotUserData(updatedData);
      
      console.log('[Background] Updated persistent riot data from rank cache');
    }
  } catch (error) {
    console.warn('[Background] Error updating persistent riot data:', error);
  }
}

async function fetchRankFromDatabase(twitchUsername) {
  if (!twitchUsername) return null;
  
  try {
    const normalizedUsername = twitchUsername.toLowerCase();
    
    const response = await fetch(`${RANK_WORKER_API_URL}/api/ranks/lol/${normalizedUsername}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }
    
    const rankData = await response.json();
    // Do not return sensitive identifiers like PUUID to content scripts
    return {
      tier: rankData.rank_tier,
      division: rankData.rank_division,
      leaguePoints: rankData.lp,
      summonerName: rankData.riot_id,
      region: rankData.region,
      plus_active: rankData.plus_active || false
    };
  } catch (error) {
    return null;
  }
}

async function fetchRankByTwitchUsername(twitchUsername) {
  try {
    // Try to get linked account data first
    const linkedAccount = await getUserLinkedAccount(twitchUsername);
    
    if (linkedAccount) {
      try {
        const rankData = await getRankForLinkedAccount();
        return rankData;
      } catch (error) {
        // Fall through to database lookup
      }
    }
    
    // Fall back to database lookup
    const dbRankData = await fetchRankFromDatabase(twitchUsername);
    return dbRankData;
  } catch (error) {
    return null;
  }
}


async function incrementDbReadCounter(channelName) {
  if (!channelName) {
    return false;
  }
  
  try {
    const normalizedName = channelName.toLowerCase();
    
    const response = await fetch(`${STATUS_API_URL}/metrics/db_read`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ channel_name: normalizedName })
    });
    
    if (!response.ok) {
      return false;
    }
    
    const data = await response.json();
    return !!data.success;
  } catch (error) {
    return false;
  }
}

async function incrementSuccessfulLookupCounter(channelName) {
  if (!channelName) {
    return false;
  }
  
  try {
    const normalizedName = channelName.toLowerCase();
    
    const response = await fetch(`${STATUS_API_URL}/metrics/successful_lookup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ channel_name: normalizedName })
    });
    
    if (!response.ok) {
      return false;
    }
    
    const data = await response.json();
    return !!data.success;
  } catch (error) {
    return false;
  }
}


 