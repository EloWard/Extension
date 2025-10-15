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
    if (!userData || !userData.puuid) return;

    const currentData = await browser.storage.local.get(['selectedRegion']);

    // Normalize soloQueueRank structure before storing to ensure consistency
    let normalizedRank = null;
    if (userData.soloQueueRank && typeof userData.soloQueueRank === 'object') {
      const rank = userData.soloQueueRank;
      normalizedRank = {
        tier: rank.tier || rank.rank_tier || null,
        division: rank.division || rank.rank_division || null,
        leaguePoints: rank.leaguePoints !== undefined ? rank.leaguePoints : rank.lp
      };
    }

    const persistentData = {
      riotId: userData.riotId,
      puuid: userData.puuid,
      region: userData.region || currentData.selectedRegion,
      soloQueueRank: normalizedRank,
      plus_active: userData.plus_active,
      show_peak: userData.show_peak,
      animate_badge: userData.animate_badge
    };

    await browser.storage.local.set({
      [STORAGE_KEYS.RIOT_USER_DATA]: persistentData,
      [STORAGE_KEYS.DATA_PERSISTENCE_ENABLED]: true
    });

    await this.updateConnectedState('riot', true);
  },
  
  async getRiotUserData() {
    const data = await browser.storage.local.get([STORAGE_KEYS.RIOT_USER_DATA]);
    const storedData = data[STORAGE_KEYS.RIOT_USER_DATA];

    if (!storedData) return null;

    // Normalize soloQueueRank structure to ensure consistency
    if (storedData.soloQueueRank && typeof storedData.soloQueueRank === 'object') {
      const rank = storedData.soloQueueRank;
      storedData.soloQueueRank = {
        tier: rank.tier || rank.rank_tier || null,
        division: rank.division || rank.rank_division || null,
        leaguePoints: rank.leaguePoints !== undefined ? rank.leaguePoints : rank.lp
      };
    }

    return storedData;
  },
  
  async updateRiotOptionsData(optionsData) {
    if (!optionsData) return;
    
    const existingData = await this.getRiotUserData();
    if (!existingData || !existingData.puuid) {
      console.warn('[PersistentStorage] Cannot update options data: no existing Riot user data');
      return;
    }
    
    const updatedData = {
      ...existingData,
      plus_active: optionsData.plus_active,
      show_peak: optionsData.show_peak,
      animate_badge: optionsData.animate_badge
    };
    
    await browser.storage.local.set({
      [STORAGE_KEYS.RIOT_USER_DATA]: updatedData
    });
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
        hasRankData: !!riotData?.soloQueueRank,
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