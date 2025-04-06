// EloWard Rank API Service
// Handles communication with the Cloudflare worker for rank data

export class RankAPI {
  // Base URL for the rank worker API from Database.txt
  static API_BASE_URL = 'https://eloward-viewers-api.unleashai-inquiries.workers.dev/api';
  
  // Local cache of rank data
  static #rankCache = new Map();
  static #pendingRequests = new Map();
  static CACHE_TTL = 15 * 60 * 1000; // 15 minutes
  
  /**
   * Upload the user's rank to the server
   * @param {string} twitchUsername - User's Twitch username
   * @param {Object} rankData - User's rank data
   * @returns {Promise<Object>} Response data
   */
  static async uploadRank(twitchUsername, rankData) {
    if (!twitchUsername || !rankData) {
      throw new Error('Missing required data for rank upload');
    }
    
    // Format the data for the API according to lol_ranks.sql schema
    const payload = {
      twitch_username: twitchUsername,
      riot_puuid: rankData.puuid || null,
      riot_id: rankData.gameName && rankData.tagLine ? `${rankData.gameName}#${rankData.tagLine}` : null,
      rank_tier: rankData.tier || 'UNRANKED',
      rank_division: rankData.division || rankData.rank || null,
      lp: rankData.leaguePoints || 0,
    };
    
    try {
      // Use the POST endpoint from Database.txt
      const response = await fetch(`${this.API_BASE_URL}/ranks/lol`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to upload rank data');
      }
      
      const responseData = await response.json();
      
      // Update the cache with the fresh data
      this.#updateCache(twitchUsername.toLowerCase(), {
        twitch_username: twitchUsername.toLowerCase(),
        riot_id: payload.riot_id,
        rank_tier: payload.rank_tier,
        rank_division: payload.rank_division,
        lp: payload.lp,
        last_updated: responseData.timestamp,
      });
      
      return responseData;
    } catch (error) {
      console.error('Error uploading rank:', error);
      throw error;
    }
  }
  
  /**
   * Get rank data for a single user
   * @param {string} username - Twitch username
   * @returns {Promise<Object>} User's rank data
   */
  static async getRank(username) {
    if (!username) return null;
    
    username = username.toLowerCase();
    
    // Check cache first
    const cachedData = this.#checkCache(username);
    if (cachedData) {
      return cachedData;
    }
    
    // Check if we already have a pending request for this username
    if (this.#pendingRequests.has(username)) {
      return this.#pendingRequests.get(username);
    }
    
    // Create a new promise for this request
    const requestPromise = new Promise(async (resolve, reject) => {
      try {
        // Use the GET endpoint from Database.txt
        const response = await fetch(`${this.API_BASE_URL}/ranks/lol/${username}`);
        
        if (!response.ok) {
          // 404 is expected for users without rank data
          if (response.status === 404) {
            resolve(null);
            return;
          }
          
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to fetch rank data');
        }
        
        const rankData = await response.json();
        this.#updateCache(username, rankData);
        resolve(rankData);
      } catch (error) {
        console.error(`Error fetching rank for ${username}:`, error);
        reject(error);
      } finally {
        // Remove from pending requests
        this.#pendingRequests.delete(username);
      }
    });
    
    // Store the promise in pending requests
    this.#pendingRequests.set(username, requestPromise);
    
    return requestPromise;
  }
  
  /**
   * Get rank data for multiple users in a batch
   * @param {Array<string>} usernames - Array of Twitch usernames
   * @returns {Promise<Array<Object>>} Array of rank data objects
   */
  static async getBatchRanks(usernames) {
    if (!usernames || !usernames.length) return [];
    
    // Normalize usernames
    const normalizedUsernames = usernames.map(name => name.toLowerCase());
    
    // Check which usernames we need to fetch (not in cache)
    const toFetch = [];
    const cachedResults = {};
    
    for (const username of normalizedUsernames) {
      const cachedData = this.#checkCache(username);
      if (cachedData) {
        cachedResults[username] = cachedData;
      } else if (!this.#pendingRequests.has(username)) {
        toFetch.push(username);
      }
    }
    
    // If we have everything in the cache, return it
    if (toFetch.length === 0) {
      return normalizedUsernames.map(username => cachedResults[username] || null);
    }
    
    // Batch fetch for usernames not in cache
    try {
      const queryParams = toFetch.map(username => `username=${encodeURIComponent(username)}`).join('&');
      const response = await fetch(`${this.API_BASE_URL}/ranks?${queryParams}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch batch rank data');
      }
      
      const rankDataArray = await response.json();
      
      // Update cache with the fresh data
      for (const rankData of rankDataArray) {
        const username = rankData.twitch_username.toLowerCase();
        this.#updateCache(username, rankData);
        cachedResults[username] = rankData;
      }
      
      // Return all results in the original order
      return normalizedUsernames.map(username => cachedResults[username] || null);
    } catch (error) {
      console.error('Error fetching batch ranks:', error);
      throw error;
    }
  }
  
  /**
   * Check the cache for rank data
   * @param {string} username - Twitch username
   * @returns {Object|null} Cached rank data or null
   */
  static #checkCache(username) {
    const cacheEntry = this.#rankCache.get(username);
    
    if (!cacheEntry) return null;
    
    // Check if the cache entry is still valid
    const now = Date.now();
    if (now - cacheEntry.cachedAt > this.CACHE_TTL) {
      this.#rankCache.delete(username);
      return null;
    }
    
    return cacheEntry.data;
  }
  
  /**
   * Update the cache with fresh rank data
   * @param {string} username - Twitch username
   * @param {Object} rankData - Rank data to cache
   */
  static #updateCache(username, rankData) {
    this.#rankCache.set(username, {
      data: rankData,
      cachedAt: Date.now()
    });
  }
  
  /**
   * Clear the rank cache
   */
  static clearCache() {
    this.#rankCache.clear();
  }
} 