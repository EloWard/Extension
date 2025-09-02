/* Copyright 2024 EloWard - Apache 2.0 + Commons Clause License */

// Import webextension-polyfill for cross-browser compatibility
import '../../vendor/browser-polyfill.js';

const STORAGE_KEYS = {
  RIOT_USER_DATA: 'eloward_persistent_riot_user_data',
  TWITCH_USER_DATA: 'eloward_persistent_twitch_user_data',
  CONNECTED_STATE: 'eloward_persistent_connected_state',
  DATA_PERSISTENCE_ENABLED: 'eloward_data_persistence_enabled'
};

export const PersistentStorage = {
  async init() {
    await browser.storage.local.set({
      [STORAGE_KEYS.DATA_PERSISTENCE_ENABLED]: true
    });
  },
  
  async storeRiotUserData(userData) {
    if (!userData) return;
    
    const currentData = await browser.storage.local.get(['selectedRegion']);
    
    const persistentData = {
      riotId: userData.riotId,
      puuid: userData.puuid,
      region: currentData.selectedRegion,
      rankInfo: null
    };
    
          if (userData.soloQueueRank) {
        persistentData.rankInfo = {
          tier: userData.soloQueueRank.tier,
          rank: userData.soloQueueRank.rank,
          leaguePoints: userData.soloQueueRank.leaguePoints,
          wins: userData.soloQueueRank.wins,
          losses: userData.soloQueueRank.losses
        };
      } else if (userData.rankInfo) {
        // Handle fallback format from backend
        persistentData.rankInfo = {
          tier: userData.rankInfo.tier,
          rank: userData.rankInfo.rank,
          leaguePoints: userData.rankInfo.leaguePoints,
          wins: userData.rankInfo.wins || 0,
          losses: userData.rankInfo.losses || 0
        };
      }
    
    await browser.storage.local.set({
      [STORAGE_KEYS.RIOT_USER_DATA]: persistentData,
      [STORAGE_KEYS.DATA_PERSISTENCE_ENABLED]: true
    });
    
    await this.updateConnectedState('riot', true);
  },
  
  async getRiotUserData() {
    const data = await browser.storage.local.get([STORAGE_KEYS.RIOT_USER_DATA]);
    return data[STORAGE_KEYS.RIOT_USER_DATA] || null;
  },
  
  async storeTwitchUserData(userData) {
    if (!userData) return;
    
    const persistentData = {
      id: userData.id,
      login: userData.login,
      display_name: userData.display_name,
      profile_image_url: userData.profile_image_url
    };
    
    await browser.storage.local.set({
      [STORAGE_KEYS.TWITCH_USER_DATA]: persistentData,
      [STORAGE_KEYS.DATA_PERSISTENCE_ENABLED]: true
    });
    
    await this.updateConnectedState('twitch', true);
  },
  
  async getTwitchUserData() {
    const data = await browser.storage.local.get([STORAGE_KEYS.TWITCH_USER_DATA]);
    return data[STORAGE_KEYS.TWITCH_USER_DATA] || null;
  },
  
  async updateConnectedState(service, isConnected) {
    const data = await browser.storage.local.get([STORAGE_KEYS.CONNECTED_STATE]);
    const connectedState = data[STORAGE_KEYS.CONNECTED_STATE] || {};
    
    connectedState[service] = isConnected;
    
    await browser.storage.local.set({
      [STORAGE_KEYS.CONNECTED_STATE]: connectedState
    });
  },
  
  async getConnectedState() {
    const data = await browser.storage.local.get([STORAGE_KEYS.CONNECTED_STATE]);
    const storedState = data[STORAGE_KEYS.CONNECTED_STATE] || {};
    
    // Always return complete state object with explicit false values
    return {
      riot: storedState.riot === true,
      twitch: storedState.twitch === true
    };
  },
  
  async isServiceConnected(service) {
    const connectedState = await this.getConnectedState();
    return connectedState[service] === true;
  },
  
  async clearServiceData(service) {
    if (service === 'riot') {
      await browser.storage.local.remove([STORAGE_KEYS.RIOT_USER_DATA]);
    } else if (service === 'twitch') {
      await browser.storage.local.remove([STORAGE_KEYS.TWITCH_USER_DATA]);
    }
    
    await this.updateConnectedState(service, false);
  },
  
  async clearAllData() {
    await browser.storage.local.remove([
      STORAGE_KEYS.RIOT_USER_DATA,
      STORAGE_KEYS.TWITCH_USER_DATA,
      STORAGE_KEYS.CONNECTED_STATE
    ]);
  },

  async getStoredUsernames() {
    try {
      const [twitchData, riotData] = await Promise.all([
        this.getTwitchUserData(),
        this.getRiotUserData()
      ]);

      return {
        twitchUsername: twitchData?.login || null,
        riotUsername: riotData?.riotId || null,
        puuid: riotData?.puuid || null
      };
    } catch (error) {
      return {
        twitchUsername: null,
        riotUsername: null,
        puuid: null
      };
    }
  },

  async hasStoredUserData() {
    try {
      const [twitchData, riotData] = await Promise.all([
        this.getTwitchUserData(),
        this.getRiotUserData()
      ]);

      return {
        hasTwitchData: !!twitchData?.login,
        hasRiotData: !!(riotData?.riotId && riotData?.puuid),
        hasRankData: !!riotData?.rankInfo,
        canAccessDatabase: !!(twitchData?.login && riotData?.puuid)
      };
    } catch (error) {
      return {
        hasTwitchData: false,
        hasRiotData: false,
        hasRankData: false,
        canAccessDatabase: false
      };
    }
  },

  async tryRiotDataFallback() {
    try {
      // Get the twitch_id from stored twitch data
      const twitchData = await this.getTwitchUserData();
      if (!twitchData?.id) {
        return { success: false, error: 'No Twitch data available' };
      }

      // Call the backend fallback endpoint
      const response = await fetch('https://eloward-users.unleashai.workers.dev/user/riot-fallback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          twitch_id: twitchData.id
        })
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to fetch riot data' };
      }

      if (!data.success || !data.riot_data) {
        return { success: false, error: 'Invalid response from server' };
      }

      // Store the region first so storeRiotUserData can use it
      if (data.riot_data.region) {
        await browser.storage.local.set({ selectedRegion: data.riot_data.region });
      }

      // Store the riot data using existing method
      await this.storeRiotUserData(data.riot_data);
      
      return { success: true, data: data.riot_data };
    } catch (error) {
      return { success: false, error: error.message || 'Failed to check riot data fallback' };
    }
  }
}; 