// EloWard Persistent User Data Storage
// This module handles storing and retrieving user data that persists across sessions
// without requiring re-authentication on every extension popup.

/**
 * PersistentStorage module for the EloWard extension.
 * Handles storing authenticated user data for long-term access without
 * requiring re-authentication every time the extension popup is opened.
 */

// Storage keys
const STORAGE_KEYS = {
  RIOT_USER_DATA: 'eloward_persistent_riot_user_data',
  TWITCH_USER_DATA: 'eloward_persistent_twitch_user_data',
  LAST_UPDATED: 'eloward_persistent_last_updated',
  CONNECTED_STATE: 'eloward_persistent_connected_state', // Tracks if accounts are connected
  DATA_PERSISTENCE_ENABLED: 'eloward_data_persistence_enabled' // Flag to control persistence
};

export const PersistentStorage = {
  /**
   * Initialize persistence
   * Sets up the persistence flag to ensure data doesn't expire
   * User data is preserved across sessions even when tokens expire
   */
  init() {
    chrome.storage.local.set({
      [STORAGE_KEYS.DATA_PERSISTENCE_ENABLED]: true
    });
  },
  
  /**
   * Store Riot user data persistently
   * @param {Object} userData - The Riot user data to store
   * @returns {Promise<void>}
   */
  async storeRiotUserData(userData) {
    if (!userData) return;
    
    // Extract only the necessary data for display
    const persistentData = {
      gameName: userData.gameName,
      tagLine: userData.tagLine,
      puuid: userData.puuid,
      rankInfo: null
    };
    
    // Add rank information if available
    if (userData.soloQueueRank) {
      persistentData.rankInfo = {
        tier: userData.soloQueueRank.tier,
        rank: userData.soloQueueRank.rank,
        leaguePoints: userData.soloQueueRank.leaguePoints,
        wins: userData.soloQueueRank.wins,
        losses: userData.soloQueueRank.losses
      };
    }
    
    // Store the data and set persistence flag
    await chrome.storage.local.set({
      [STORAGE_KEYS.RIOT_USER_DATA]: persistentData,
      [STORAGE_KEYS.LAST_UPDATED]: new Date().toISOString(),
      [STORAGE_KEYS.DATA_PERSISTENCE_ENABLED]: true
    });
    
    // Update connected state
    await this.updateConnectedState('riot', true);
  },
  
  /**
   * Get stored Riot user data
   * @returns {Promise<Object|null>} - The stored Riot user data or null if not found
   */
  async getRiotUserData() {
    const data = await chrome.storage.local.get([STORAGE_KEYS.RIOT_USER_DATA]);
    const userData = data[STORAGE_KEYS.RIOT_USER_DATA];
    
    return userData || null;
  },
  
  /**
   * Store Twitch user data persistently
   * @param {Object} userData - The Twitch user data to store
   * @returns {Promise<void>}
   */
  async storeTwitchUserData(userData) {
    if (!userData) return;
    
    // Extract only the necessary data for display
    const persistentData = {
      id: userData.id,
      login: userData.login,
      display_name: userData.display_name,
      profile_image_url: userData.profile_image_url
    };
    
    // Store the data and set persistence flag
    await chrome.storage.local.set({
      [STORAGE_KEYS.TWITCH_USER_DATA]: persistentData,
      [STORAGE_KEYS.LAST_UPDATED]: new Date().toISOString(),
      [STORAGE_KEYS.DATA_PERSISTENCE_ENABLED]: true
    });
    
    // Update connected state
    await this.updateConnectedState('twitch', true);
  },
  
  /**
   * Get stored Twitch user data
   * @returns {Promise<Object|null>} - The stored Twitch user data or null if not found
   */
  async getTwitchUserData() {
    const data = await chrome.storage.local.get([STORAGE_KEYS.TWITCH_USER_DATA]);
    const userData = data[STORAGE_KEYS.TWITCH_USER_DATA];
    
    return userData || null;
  },
  
  /**
   * Update the connected state for a service
   * @param {string} service - The service name ('riot' or 'twitch')
   * @param {boolean} isConnected - Whether the service is connected
   * @returns {Promise<void>}
   */
  async updateConnectedState(service, isConnected) {
    // Get current state
    const data = await chrome.storage.local.get([STORAGE_KEYS.CONNECTED_STATE]);
    const connectedState = data[STORAGE_KEYS.CONNECTED_STATE] || {};
    
    // Update state for the specific service
    connectedState[service] = isConnected;
    
    // Store updated state
    await chrome.storage.local.set({
      [STORAGE_KEYS.CONNECTED_STATE]: connectedState
    });
  },
  
  /**
   * Get the connected state
   * @returns {Promise<Object>} - Object with connected state for each service
   */
  async getConnectedState() {
    const data = await chrome.storage.local.get([STORAGE_KEYS.CONNECTED_STATE]);
    return data[STORAGE_KEYS.CONNECTED_STATE] || { riot: false, twitch: false };
  },
  
  /**
   * Check if a service is connected
   * @param {string} service - The service name ('riot' or 'twitch')
   * @returns {Promise<boolean>} - Whether the service is connected
   */
  async isServiceConnected(service) {
    const connectedState = await this.getConnectedState();
    return connectedState[service] === true;
  },
  
  /**
   * Clear stored data for a service
   * @param {string} service - The service name ('riot' or 'twitch')
   * @returns {Promise<void>}
   */
  async clearServiceData(service) {
    if (service === 'riot') {
      await chrome.storage.local.remove([STORAGE_KEYS.RIOT_USER_DATA]);
    } else if (service === 'twitch') {
      await chrome.storage.local.remove([STORAGE_KEYS.TWITCH_USER_DATA]);
    }
    
    // Update connected state
    await this.updateConnectedState(service, false);
  },
  
  /**
   * Clear all stored data
   * @returns {Promise<void>}
   */
  async clearAllData() {
    await chrome.storage.local.remove([
      STORAGE_KEYS.RIOT_USER_DATA,
      STORAGE_KEYS.TWITCH_USER_DATA,
      STORAGE_KEYS.LAST_UPDATED,
      STORAGE_KEYS.CONNECTED_STATE
    ]);
  },

  /**
   * Get stored usernames even if not currently connected (for database access)
   * @returns {Promise<Object>} - Object with Twitch and Riot usernames if available
   */
  async getStoredUsernames() {
    try {
      const [twitchData, riotData] = await Promise.all([
        this.getTwitchUserData(),
        this.getRiotUserData()
      ]);

      return {
        twitchUsername: twitchData?.login || null,
        riotUsername: riotData?.gameName && riotData?.tagLine 
          ? `${riotData.gameName}#${riotData.tagLine}` 
          : null,
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

  /**
   * Check if we have stored user data (regardless of connection status)
   * @returns {Promise<Object>} - Object indicating what data is available
   */
  async hasStoredUserData() {
    try {
      const [twitchData, riotData] = await Promise.all([
        this.getTwitchUserData(),
        this.getRiotUserData()
      ]);

      return {
        hasTwitchData: !!twitchData?.login,
        hasRiotData: !!(riotData?.gameName && riotData?.puuid),
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