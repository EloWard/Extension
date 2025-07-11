// EloWard Rank API Service
// Handles communication with the Cloudflare worker for rank data

export class RankAPI {
  // Base URL for the rank worker API from Database.txt
  static API_BASE_URL = 'https://eloward-ranks.unleashai.workers.dev/api';
  
  // Local cache of rank data
  static #rankCache = new Map();
  static #pendingRequests = new Map();
  static CACHE_TTL = 15 * 60 * 1000; // 15 minutes
  
  // NOTE: Rank uploading is now handled securely by the backend via /store-rank endpoint
  // in riotauth-worker.ts. This class only handles fetching rank data for display.
  
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