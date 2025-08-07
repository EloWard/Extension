/* Copyright 2024 EloWard - Apache 2.0 + Commons Clause License */

// Import webextension-polyfill for cross-browser compatibility
import '../browser-polyfill.js';

const STORAGE_KEYS = {
  RIOT_USER_DATA: 'eloward_persistent_riot_user_data',
  TWITCH_USER_DATA: 'eloward_persistent_twitch_user_data',
  LAST_UPDATED: 'eloward_persistent_last_updated',
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
    }
    
    await browser.storage.local.set({
      [STORAGE_KEYS.RIOT_USER_DATA]: persistentData,
      [STORAGE_KEYS.LAST_UPDATED]: new Date().toISOString(),
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
      [STORAGE_KEYS.LAST_UPDATED]: new Date().toISOString(),
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
    return data[STORAGE_KEYS.CONNECTED_STATE] || { riot: false, twitch: false };
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
      STORAGE_KEYS.LAST_UPDATED,
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
  }
}; 