/*
 * Copyright 2024 EloWard
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * "Commons Clause" License Condition v1.0
 * The Software is provided to you by the Licensor under the License, as defined below, 
 * subject to the following condition. Without limiting other conditions in the License, 
 * the grant of rights under the License will not include, and the License does not grant 
 * to you, the right to Sell the Software.
 */

import { RiotAuth } from './js/riotAuth.js';
import { TwitchAuth } from './js/twitchAuth.js';
import { PersistentStorage } from './js/persistentStorage.js';

const RIOT_AUTH_URL = 'https://eloward-riotauth.unleashai.workers.dev';
const RANK_WORKER_API_URL = 'https://eloward-ranks.unleashai.workers.dev';
const STATUS_API_URL = 'https://eloward-users.unleashai.workers.dev';
const MAX_RANK_CACHE_SIZE = 500;
const RANK_CACHE_EXPIRY = 60 * 60 * 1000;

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
  }

  clear() {
    const currentUserEntry = this.currentUser ? this.cache.get(this.currentUser) : null;
    this.cache.clear();

    if (this.currentUser && currentUserEntry) {
      this.cache.set(this.currentUser, currentUserEntry);
    }
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

function handleAuthCallback(params) {
  if (!params || !params.code) {
    return;
  }

  const promiseStorage = new Promise(resolve => {
    chrome.storage.local.set({
      'auth_callback': params,
      'eloward_auth_callback': params
    }, resolve);
  });

  const isTwitchCallback = params.service === 'twitch';

  if (isTwitchCallback) {
    chrome.storage.local.set({
      'twitch_auth_callback': params
    }, () => {
      initiateTokenExchange(params, 'twitch');
    });
  } else {
    chrome.storage.local.set({
      'riot_auth_callback': params
    }, () => {
      initiateTokenExchange(params, 'riot');
    });
  }

  chrome.runtime.sendMessage({
    type: 'auth_callback',
    params: params
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

      await PersistentStorage.storeTwitchUserData(userInfo);
      await PersistentStorage.updateConnectedState('twitch', true);

      return userInfo;
    } else {
      const tokenData = await RiotAuth.exchangeCodeForTokens(authData.code);
      const userData = await RiotAuth.getUserData();

      await PersistentStorage.storeRiotUserData(userData);
      await PersistentStorage.updateConnectedState('riot', true);

      return userData;
    }
  } catch (error) {
    throw error;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Background] Received internal message:', message, 'from sender:', sender);
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
        chrome.runtime.sendMessage({
          type: 'twitch_auth_processed',
          success: true,
          timestamp: Date.now()
        }).catch(() => {});
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
  
  if (message.type === 'get_auth_callback') {
    chrome.storage.local.get(['authCallback', 'auth_callback', 'eloward_auth_callback', 'twitch_auth_callback'], (data) => {
      const callback = data.twitch_auth_callback || data.authCallback || data.auth_callback || data.eloward_auth_callback;
      sendResponse({ data: callback });
    });
    return true;
  }
  
  if (message.type === 'auth_callback') {
    console.log('[Background] Received auth_callback message:', message);
    
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
      console.log('[Background] No valid auth data in message');
      sendResponse({ success: false, error: 'No auth data' });
      return true;
    }
    
    console.log('[Background] Processing auth callback with params:', params);
    handleAuthCallback(params);
    sendResponse({ success: true });
    return true;
  }
  
  if (message.type === 'open_auth_window') {
    if (message.url) {
      const windowId = Date.now().toString();
      
      chrome.windows.create({
        url: message.url,
        type: 'popup',
        width: 500,
        height: 700
      }, (window) => {
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
  
  if (message.type === 'check_auth_tokens') {
    chrome.storage.local.get([
      'eloward_riot_access_token',
      'eloward_riot_refresh_token',
      'eloward_riot_token_expiry',
      'eloward_riot_tokens',
      'riotAuth'
    ], (data) => {
      sendResponse({ data });
    });
    return true;
  }
  
  if (message.type === 'store_tokens') {
    if (message.tokens) {
      chrome.storage.local.set({
        'eloward_riot_access_token': message.tokens.access_token,
        'eloward_riot_refresh_token': message.tokens.refresh_token,
        'eloward_riot_token_expiry': message.tokens.expires_at || (Date.now() + (message.tokens.expires_in * 1000)),
        'eloward_riot_tokens': message.tokens,
        'riotAuth': {
          ...message.tokens,
          issued_at: Date.now()
        }
      }, () => {
        sendResponse({ success: true });
      });
    } else {
      sendResponse({ success: false, error: 'No tokens provided' });
    }
    return true;
  }
  
  if (message.action === 'initiate_riot_auth') {
    const state = message.state || Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    chrome.storage.local.set({
      'eloward_auth_state': state,
      [RiotAuth.config.storageKeys.authState]: state,
      'selectedRegion': message.region || 'na1'
    });
    
    const region = message.region || 'na1';
    const url = `${RIOT_AUTH_URL}/auth/init?state=${state}&region=${region}`;
    
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
  
  if (message.action === 'handle_auth_callback') {
    handleAuthCallbackFromRedirect(message.code, message.state)
      .then(result => {
        sendResponse(result);
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
  
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
    
    const platform = "na1";
    
    fetchRankByTwitchUsername(username, platform)
      .then(rankData => {
        if (rankData) {
          userRankCache.set(username, rankData);
          
          if (channelName && rankData?.tier) {
            incrementSuccessfulLookupCounter(channelName).catch(() => {});
          }
        }
        
        sendResponse({
          success: true,
          rankData: rankData,
          source: 'api'
        });
      })
      .catch(error => {
        sendResponse({ 
          success: false, 
          error: error.message || 'Error fetching rank data' 
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

  if (message.action === 'set_rank_data') {
    if (message.username && message.rankData) {
      userRankCache.set(message.username, message.rankData);
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

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'auth_callback') {
    handleAuthCallback(event.data.params);
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  clearAllStoredData();
  
  chrome.storage.local.set({
    selectedRegion: 'na1'
  });
  
  chrome.action.setBadgeText({ text: 'ON' });
  chrome.action.setBadgeBackgroundColor({ color: '#DC2123' });
  
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '' });
  }, 5000);
  
  chrome.storage.local.get('linkedAccounts', (data) => {
    if (!data.linkedAccounts) {
      chrome.storage.local.set({ linkedAccounts: {} });
    }
  });
  
  loadConfiguration();
});

function clearAllStoredData() {
  return new Promise((resolve) => {
    try {
      const keysToRemove = [
        'eloward_riot_access_token',
        'eloward_riot_refresh_token',
        'eloward_riot_token_expiry',
        'eloward_riot_tokens',
        'eloward_riot_account_info',
        'eloward_riot_rank_info',
        'eloward_auth_state',
        'eloward_riot_id_token',
        'eloward_twitch_access_token',
        'eloward_twitch_refresh_token',
        'eloward_twitch_token_expiry',
        'eloward_twitch_tokens',
        'eloward_twitch_user_info',
        'eloward_twitch_auth_state',
        'auth_callback',
        'eloward_auth_callback',
        'twitch_auth_callback',
        'riot_auth_callback',
        'authCallbackProcessed'
      ];
      
      chrome.storage.local.remove(keysToRemove, () => {
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
  return new Promise((resolve, reject) => {
    fetch(`${RIOT_AUTH_URL}/riot/league/entries?platform=${platform}&puuid=${puuid}`, {
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
    .then(leagueEntries => {
      const soloQueueEntry = leagueEntries.find(entry => entry.queueType === 'RANKED_SOLO_5x5');
      
      if (soloQueueEntry) {
        const rankData = {
          tier: soloQueueEntry.tier,
          division: soloQueueEntry.rank,
          leaguePoints: soloQueueEntry.leaguePoints,
          wins: soloQueueEntry.wins,
          losses: soloQueueEntry.losses
        };
        
        resolve(rankData);
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

async function handleAuthCallbackFromRedirect(code, state) {
  try {
    const storedData = await chrome.storage.local.get(['authState']);
    const expectedState = storedData.authState;
    
    let stateValid = expectedState && expectedState === state;
    
    
    if (!stateValid) {
      throw new Error('Security verification failed: state parameter mismatch');
    }
    
    
    const response = await fetch(`${RIOT_AUTH_URL}/auth/riot/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        code: code
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API Error: ${errorData.message || response.statusText}`);
    }
    
    const tokenData = await response.json();
    
    const tokenExpiry = Date.now() + (tokenData.data.expires_in * 1000);
    
    await chrome.storage.local.set({
      eloward_riot_access_token: tokenData.data.access_token,
      eloward_riot_refresh_token: tokenData.data.refresh_token,
      eloward_riot_token_expiry: tokenExpiry,
      
      riotAuth: {
        ...tokenData.data,
        issued_at: Date.now()
      },
      authInProgress: false
    });
    
    await chrome.storage.local.remove(['authState']);
    
    try {
      chrome.runtime.sendMessage({
        action: 'auth_completed',
        success: true
      });
    } catch (e) {
      // Ignore messaging errors
    }
    
    return { success: true, username: tokenData.data.user_info?.game_name };
  } catch (error) {
    
    await chrome.storage.local.set({
      authInProgress: false
    });
    
    return { success: false, error: error.message };
  }
}

self.eloward = {
  handleAuthCallback,
  handleAuthCallbackFromRedirect,
  getRankIconUrl
};

function getUserLinkedAccount(twitchUsername) {
  return new Promise((resolve) => {
    if (!twitchUsername) {
      resolve(null);
      return;
    }
    
    const normalizedTwitchUsername = twitchUsername.toLowerCase();
    
    chrome.storage.local.get('linkedAccounts', data => {
      const linkedAccounts = data.linkedAccounts || {};
      
      if (linkedAccounts[normalizedTwitchUsername]) {
        resolve(linkedAccounts[normalizedTwitchUsername]);
        return;
      }
      
      chrome.storage.local.get(['eloward_persistent_twitch_user_data', 'eloward_persistent_riot_user_data'], currentUserData => {
        const currentTwitchData = currentUserData.eloward_persistent_twitch_user_data;
        const currentRiotData = currentUserData.eloward_persistent_riot_user_data;
        
        if (currentTwitchData?.login?.toLowerCase() === normalizedTwitchUsername && currentRiotData) {
          resolve(currentRiotData);
          return;
        }
        
        resolve(null);
      });
    });
  });
}

function getRankForLinkedAccount(linkedAccount, platform) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get('riotAuthToken', data => {
      if (!data.riotAuthToken) {
        reject(new Error('No Riot auth token available'));
        return;
      }
      
      getRankByPuuid(data.riotAuthToken, linkedAccount.puuid, platform)
        .then(rankData => {
          resolve(rankData);
        })
        .catch(reject);
    });
  });
}

function loadConfiguration() {
  chrome.storage.local.get(['selectedRegion', 'riotAccountInfo', 'twitchUsername'], (data) => {
    if (!data.selectedRegion) {
      chrome.storage.local.set({ selectedRegion: 'na1' });
    }
    
    if (data.riotAccountInfo && data.twitchUsername) {
      addLinkedAccount(data.twitchUsername, data.riotAccountInfo);
    }
  });
}

function addLinkedAccount(twitchUsername, riotAccountInfo) {
  if (!twitchUsername || !riotAccountInfo) {
    return;
  }
  
  const normalizedTwitchUsername = twitchUsername.toLowerCase();
  
  chrome.storage.local.get('linkedAccounts', data => {
    const linkedAccounts = data.linkedAccounts || {};
    
    linkedAccounts[normalizedTwitchUsername] = {
      ...riotAccountInfo,
      twitchUsername,
      normalizedTwitchUsername,
      linkedAt: Date.now(),
      lastUpdated: Date.now()
    };
    
    chrome.storage.local.set({ linkedAccounts });
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

function fetchRankByTwitchUsername(twitchUsername, platform) {
  return new Promise((resolve, reject) => {
    
    getUserLinkedAccount(twitchUsername)
      .then(linkedAccount => {
        if (linkedAccount) {
          getRankForLinkedAccount(linkedAccount, platform)
            .then(rankData => {
              resolve(rankData);
            })
            .catch(() => {
              fetchRankFromDatabase(twitchUsername)
                .then(dbRankData => {
                  if (dbRankData) {
                    resolve(dbRankData);
                  } else {
                    resolve(null);
                  }
                })
                .catch(() => resolve(null));
            });
        } else {
          fetchRankFromDatabase(twitchUsername)
            .then(rankData => {
              if (rankData) {
                resolve(rankData);
              } else {
                resolve(null);
              }
            })
            .catch(() => resolve(null));
        }
      });
  });
}

function preloadLinkedAccounts() {
  chrome.storage.local.get('linkedAccounts', (data) => {
    const linkedAccounts = data.linkedAccounts || {};
    
    chrome.storage.local.get(['twitchUsername', 'riotAccountInfo'], (userData) => {
      let updated = false;
      
      if (userData.twitchUsername && userData.riotAccountInfo) {
        const normalizedUsername = userData.twitchUsername.toLowerCase();
        
        if (!linkedAccounts[normalizedUsername] || 
            !linkedAccounts[normalizedUsername].puuid) {
          linkedAccounts[normalizedUsername] = {
            ...userData.riotAccountInfo,
            twitchUsername: userData.twitchUsername,
            normalizedTwitchUsername: normalizedUsername,
            linkedAt: Date.now(),
            lastUpdated: Date.now()
          };
          
          updated = true;
        }
      }
      
      if (updated) {
        chrome.storage.local.set({ linkedAccounts });
      }
    });
  });
}

preloadLinkedAccounts();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (changes.riotAccountInfo || changes.twitchUsername) {
      preloadLinkedAccounts();
    }
  }
});

function handleChannelSwitch(oldChannel, newChannel) {
  userRankCache.clear();
  chrome.storage.local.remove('connected_region');
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

// IMPORTANT: Listen for external messages from the redirect page
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  console.log('[Background] Received EXTERNAL message:', message, 'from sender:', sender);
  
  // Handle auth callbacks from the redirect page
  if (message.type === 'auth_callback') {
    console.log('[Background] Processing external auth_callback:', message);
    
    let params;
    if (message.params) {
      params = message.params;
    } else {
      params = {
        code: message.code,
        state: message.state,
        service: message.service || 'riot'
      };
    }
    
    console.log('[Background] Processing external auth callback with params:', params);
    handleAuthCallback(params);
    sendResponse({ success: true });
    return true;
  }
  
  // Unknown external message
  console.log('[Background] Unknown external message type:', message.type);
  sendResponse({ success: false, error: 'Unknown message type' });
  return true;
}); 