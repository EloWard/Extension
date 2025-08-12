/* Copyright 2024 EloWard - Apache 2.0 + Commons Clause License */

// Reduce verbose logging in production

// Import webextension-polyfill for cross-browser compatibility
import '../../vendor/browser-polyfill.js';

import { RiotAuth } from '../auth/riotAuth.js';
import { TwitchAuth } from '../auth/twitchAuth.js';
import { PersistentStorage } from '../core/persistentStorage.js';

const RIOT_AUTH_URL = 'https://eloward-riotauth.unleashai.workers.dev';
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

    if (this.currentUser && currentUserEntry) {
      this.cache.set(this.currentUser, currentUserEntry);
    }

    maybePersistRankCache(this).catch(() => {});
  }

  evictLFU() {
    let lowestFrequency = Infinity;
    let userToEvict = null;

    for (const [key, entry] of this.cache.entries()) {
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

  const isTwitchCallback = params.service === 'twitch';

  // If popup-driven Riot auth flow is active, let the popup handle token exchange to avoid duplication
  if (!isTwitchCallback) {
    try {
      const { eloward_popup_auth_active } = await browser.storage.local.get(['eloward_popup_auth_active']);
      if (eloward_popup_auth_active) {
        // Popup flow will perform the token exchange; skip background exchange.
        return;
      }
    } catch (_) {
      // If we can't read the flag, continue safely.
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
      const tokenData = await TwitchAuth.exchangeCodeForTokens(authData.code);
      const userInfo = await TwitchAuth.getUserInfo();

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
      const tokenData = await RiotAuth.exchangeCodeForTokens(authData.code);
      const userData = await RiotAuth.getUserData();

      // Ensure all storage operations complete in sequence
      await PersistentStorage.storeRiotUserData(userData);
      await PersistentStorage.updateConnectedState('riot', true);

      // Only notify popup after ALL data is successfully stored (ignore if no listeners)
      try {
        await browser.runtime.sendMessage({
          type: 'auth_completed',
          service: 'riot'
        });
      } catch (_) {}

      return userData;
    }
  } catch (error) {
    throw error;
  }
}

// Add comprehensive logging at the very start
console.log('[EloWard Background] Background script loaded and ready');
console.log('[EloWard Background] Setting up message listeners...');

// Ensure persistence flag exists and restore rank cache mirror on startup
(async () => {
  try {
    await PersistentStorage.init();
    await restoreRankCacheFromStorage(userRankCache);
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
      
      return true;
    } catch (error) {
      sendResponse({ 
        success: false, 
        error: error.message || 'Unknown error processing Twitch auth callback'
      });
      return true;
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
    return true;
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
    
      const url = `${RIOT_AUTH_URL}/auth/init?state=${state}`;
    
    fetch(url)
      .then(response => {
        if (!response.ok) {
          throw new Error(`Auth URL request failed: ${response.status} ${response.statusText}`);
        }
        return response.json();
      })
      .then(data => {
        if (!data.authorizationUrl) {
          throw new Error('No authorization URL returned');
        }
        
        sendResponse({
          success: true,
          authUrl: data.authorizationUrl
        });
      })
      .catch(error => {
        sendResponse({
          success: false,
          error: error.message || 'Failed to obtain authorization URL'
        });
      });
    
    return true;
  }
  
  // Removed legacy handle_auth_callback action (unused)
  
  if (message.action === 'get_rank_icon_url') {
    const iconUrl = getRankIconUrl(message.tier);
    sendResponse({ iconUrl: iconUrl });
    return true;
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
    
    // Use the user's selectedRegion (platform routing value) instead of hard-coding NA1
    browser.storage.local.get(['selectedRegion']).then((data) => {
      const platform = data?.selectedRegion || 'na1';
      return fetchRankByTwitchUsername(username, platform)
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
    });
    
    return true;
  }
  
  if (message.action === 'get_user_rank_by_puuid') {
    const { puuid, region } = message;
    
    RiotAuth.getValidToken()
      .then(token => {
        getRankByPuuid(token, puuid, region)
          .then(rankData => {
            sendResponse({ rank: rankData });
          })
          .catch(error => {
            sendResponse({ error: error.message });
          });
      })
      .catch(error => {
        sendResponse({ error: error.message });
      });
    
    return true;
  }
  
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
    return true;
  }
  
  if (message.action === 'clear_rank_cache') {
    userRankCache.clear();
    sendResponse({ success: true });
    return true;
  }
  
  if (message.action === 'get_all_cached_ranks') {
    const allRanks = {};
    for (const [username, entry] of userRankCache.cache.entries()) {
      allRanks[username] = entry.rankData;
    }
    sendResponse({ ranks: allRanks });
    return true;
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
          console.log('[EloWard Background] Auto rank refresh: starting');
          try {
            const accountInfo = await RiotAuth.getAccountInfo();
            if (!accountInfo || !accountInfo.puuid) throw new Error('Missing account info');

            await RiotAuth.getRankInfo(accountInfo.puuid);
            const userData = await RiotAuth.getUserData(true);
            await PersistentStorage.storeRiotUserData(userData);

            // Update background cache entry for local user (if we know Twitch username)
            try {
              const twitchData = await PersistentStorage.getTwitchUserData();
              const twitchUsername = twitchData?.login?.toLowerCase();
              const { selectedRegion } = await browser.storage.local.get(['selectedRegion']);
              const region = selectedRegion || 'na1';
              if (twitchUsername && userData) {
                const solo = userData.soloQueueRank || null;
                const rankData = solo ? {
                  tier: solo.tier,
                  division: solo.rank,
                  leaguePoints: solo.leaguePoints,
                  summonerName: userData.riotId,
                  region
                } : {
                  tier: 'UNRANKED',
                  division: '',
                  leaguePoints: null,
                  summonerName: userData.riotId,
                  region
                };
                userRankCache.set(twitchUsername, rankData);
              }
            } catch (_) { /* ignore cache update errors */ }

            await browser.storage.local.set({ eloward_last_rank_refresh_at: now });
            console.log('[EloWard Background] Auto rank refresh: completed');
            sendResponse({ success: true, refreshed: true });
          } catch (e) {
            console.log('[EloWard Background] Auto rank refresh: failed', e?.message || e);
            sendResponse({ success: false, refreshed: false, error: e?.message || 'refresh failed' });
          }
        } else {
          // Non-intrusive reason logging to help diagnose skips
          try {
            console.log('[EloWard Background] Auto rank refresh: skipped', {
              shouldRefresh,
              canRefresh,
              hasStoredRiot,
              minutesSinceLast: lastRefreshAt ? Math.round((now - Number(lastRefreshAt)) / 60000) : null
            });
          } catch (_) { /* ignore logging errors */ }
          sendResponse({ success: true, refreshed: false });
        }
      } catch (e) {
        sendResponse({ success: false, refreshed: false, error: e?.message || 'unexpected' });
      }
    })();
    return true;
  }

  if (message.action === 'set_rank_data') {
    if (message.username && message.rankData) {
      userRankCache.set(message.username, message.rankData);
      // Broadcast update so content scripts can immediately apply badges
      try {
        browser.runtime.sendMessage({
          type: 'rank_data_updated',
          username: message.username.toLowerCase(),
          rankData: message.rankData
        }).catch(() => {});
      } catch (_) {}
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'Missing username or rank data' });
    }
    return true;
  }
  
  if (message.action === 'channel_switched') {
    handleChannelSwitch(message.oldChannel, message.newChannel);
    sendResponse({ success: true });
    return true;
  }
  
  sendResponse({ error: 'Unknown action', action: message.action });
  return true;
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
  // Do NOT clear tokens or persistent user data on update; only remove ephemeral/legacy keys
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
        'twitch_auth'
      ]);
    } catch (_) {}
  };

  if (details.reason === 'install') {
    // Fresh install: clear ephemeral/legacy keys (no tokens yet anyway)
    clearEphemeralAndLegacyKeys();
    
    // Ensure defaults
    browser.storage.local.set({ selectedRegion: 'na1' });
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
  
  browser.storage.local.get('linkedAccounts').then((data) => {
    if (!data.linkedAccounts) {
      browser.storage.local.set({ linkedAccounts: {} });
    }
  });
  
  loadConfiguration();
});

// Also clear sensitive auth callback data on background startup for temp reloads
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
      "eloward_riot_id_token",
      "eloward_riot_rank_info",
      "eloward_signin_attempted",
      "riot_auth",
      "linkedAccounts"
    ]);
  } catch (_) {}
})();

function clearAllStoredData() {
  return new Promise((resolve) => {
    try {
      const keysToRemove = [
        // Auth tokens (kept for API functionality)
        'eloward_riot_access_token',
        'eloward_riot_refresh_token',
        'eloward_riot_token_expiry',
        'eloward_riot_tokens',
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

function getRankByPuuid(token, puuid, platform) {
  // Use the worker's path-param route: /riot/league/:platform/:puuid
  return new Promise((resolve, reject) => {
    fetch(`${RIOT_AUTH_URL}/riot/league/${platform}/${puuid}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(`League request failed: ${response.status} ${response.statusText}`);
        }
        return response.json();
      })
      .then(leagueEntryOrEntries => {
        // Worker returns either the solo queue entry or the full array
        const entry = Array.isArray(leagueEntryOrEntries)
          ? leagueEntryOrEntries.find(e => e.queueType === 'RANKED_SOLO_5x5')
          : leagueEntryOrEntries;

        if (entry && entry.queueType === 'RANKED_SOLO_5x5') {
          resolve({
            tier: entry.tier,
            division: entry.rank,
            leaguePoints: entry.leaguePoints,
            wins: entry.wins,
            losses: entry.losses
          });
        } else {
          resolve(null);
        }
      })
      .catch(error => {
        reject(error);
      });
  });
}

function getRankIconUrl(tier) {
  if (!tier) return 'https://eloward-cdn.unleashai.workers.dev/lol/unranked.png';
  
  const tierLower = tier.toLowerCase();
  
  const tierIcons = {
    'iron': 'iron.png',
    'bronze': 'bronze.png',
    'silver': 'silver.png',
    'gold': 'gold.png',
    'platinum': 'platinum.png',
    'emerald': 'emerald.png',
    'diamond': 'diamond.png',
    'master': 'master.png',
    'grandmaster': 'grandmaster.png',
    'challenger': 'challenger.png',
    'unranked': 'unranked.png'
  };
  
  const iconFile = tierIcons[tierLower] || 'unranked.png';
  
  return `https://eloward-cdn.unleashai.workers.dev/lol/${iconFile.replace('.png', '')}.png`;
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

async function getRankForLinkedAccount(linkedAccount, platform) {
  try {
    // Get valid token through RiotAuth
    const token = await RiotAuth.getValidToken();
    if (!token) {
      throw new Error('No valid Riot auth token available');
    }
    
    return await getRankByPuuid(token, linkedAccount.puuid, platform);
  } catch (error) {
    throw error;
  }
}

function loadConfiguration() {
  browser.storage.local.get(['selectedRegion']).then((data) => {
    if (!data.selectedRegion) {
      browser.storage.local.set({ selectedRegion: 'na1' });
    }
  });
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
    
    return {
      tier: rankData.rank_tier,
      division: rankData.rank_division,
      leaguePoints: rankData.lp,
      summonerName: rankData.riot_id,
      puuid: rankData.riot_puuid,
      region: rankData.region
    };
  } catch (error) {
    return null;
  }
}

async function fetchRankByTwitchUsername(twitchUsername, platform) {
  try {
    // Try to get linked account data first
    const linkedAccount = await getUserLinkedAccount(twitchUsername);
    
    if (linkedAccount) {
      try {
        const rankData = await getRankForLinkedAccount(linkedAccount, platform);
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



function handleChannelSwitch(oldChannel, newChannel) {
  userRankCache.clear();
  browser.storage.local.remove('connected_region');
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


 