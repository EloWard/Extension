/**
 * EloWard Rank Service
 * 
 * This module handles syncing user ranks with the EloWard API
 * and provides methods for retrieving ranks of other users.
 */

const RankService = {
  // API base URL - will be the Cloudflare Worker URL
  API_BASE_URL: 'https://eloward-ranks-api.username.workers.dev',
  
  // Local cache for rank data to minimize API calls
  rankCache: {},
  
  // Cache TTL in milliseconds (15 minutes)
  CACHE_TTL: 15 * 60 * 1000,
  
  // Queue for pending username requests
  pendingQueue: new Set(),
  
  // Flag to prevent queue processing while already in progress
  processingQueue: false,
  
  // Timer ID for queue processing
  queueTimer: null,
  
  /**
   * Upload the user's rank to the API
   * 
   * @param {string} twitchUsername - The user's Twitch username
   * @param {Object} rankData - The user's rank data
   * @returns {Promise<Object>} - API response
   */
  async uploadUserRank(twitchUsername, rankData) {
    if (!twitchUsername || !rankData || !rankData.tier) {
      console.error('[RankService] Invalid rank data for upload', { twitchUsername, rankData });
      return { success: false, error: 'Invalid rank data' };
    }
    
    try {
      console.log('[RankService] Uploading rank for', twitchUsername, rankData);
      
      // API payload
      const payload = {
        twitchUsername,
        rankData: {
          tier: rankData.tier,
          division: rankData.division,
          leaguePoints: rankData.leaguePoints
        }
      };
      
      // POST request to the API
      const response = await fetch(`${this.API_BASE_URL}/ranks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      
      const result = await response.json();
      
      // Update local cache with the data we just uploaded
      if (response.ok) {
        this.updateCache(twitchUsername, {
          twitch_username: twitchUsername.toLowerCase(),
          rank_tier: rankData.tier,
          rank_division: rankData.division,
          league_points: rankData.leaguePoints,
          last_updated: new Date().toISOString()
        });
      }
      
      console.log('[RankService] Upload result:', result);
      return result;
    } catch (error) {
      console.error('[RankService] Error uploading rank:', error);
      return { success: false, error: error.message };
    }
  },
  
  /**
   * Get rank for a specific Twitch username
   * 
   * @param {string} twitchUsername - Twitch username to look up
   * @param {boolean} forceRefresh - Force refresh from API, ignore cache
   * @returns {Promise<Object|null>} - Rank data or null if not found
   */
  async getUserRank(twitchUsername, forceRefresh = false) {
    if (!twitchUsername) return null;
    
    const username = twitchUsername.toLowerCase();
    
    // Check cache first if not forcing refresh
    if (!forceRefresh) {
      const cachedRank = this.getCachedRank(username);
      if (cachedRank) {
        console.log('[RankService] Using cached rank for', username);
        return cachedRank;
      }
    }
    
    try {
      console.log('[RankService] Fetching rank for', username);
      
      // GET request to the API
      const response = await fetch(`${this.API_BASE_URL}/ranks/${username}`);
      
      // If not found, return null
      if (response.status === 404) {
        console.log('[RankService] No rank found for', username);
        return null;
      }
      
      // Handle other errors
      if (!response.ok) {
        console.error('[RankService] Error fetching rank:', await response.text());
        return null;
      }
      
      const rankData = await response.json();
      
      // Update cache
      this.updateCache(username, rankData);
      
      return rankData;
    } catch (error) {
      console.error('[RankService] Error getting rank:', error);
      return null;
    }
  },
  
  /**
   * Queue a username for batch retrieval of ranks
   * 
   * @param {string} username - Twitch username to queue
   */
  queueUsername(username) {
    if (!username) return;
    
    const normalizedUsername = username.toLowerCase();
    
    // Check if already in cache and not expired
    if (this.getCachedRank(normalizedUsername)) {
      return;
    }
    
    // Add to pending queue if not already there
    if (!this.pendingQueue.has(normalizedUsername)) {
      this.pendingQueue.add(normalizedUsername);
      console.log('[RankService] Queued username for batch retrieval:', normalizedUsername);
      
      // Start queue processing if not already in progress
      this.scheduleQueueProcessing();
    }
  },
  
  /**
   * Schedule processing of the queue after a short delay
   * This helps batch multiple usernames that come in quickly
   */
  scheduleQueueProcessing() {
    // Clear any existing timer
    if (this.queueTimer) {
      clearTimeout(this.queueTimer);
    }
    
    // Set new timer for 500ms
    this.queueTimer = setTimeout(() => this.processQueue(), 500);
  },
  
  /**
   * Process the queue of pending username lookups
   */
  async processQueue() {
    // If already processing or queue is empty, exit
    if (this.processingQueue || this.pendingQueue.size === 0) {
      return;
    }
    
    this.processingQueue = true;
    
    try {
      // Get usernames from queue (up to 50 at a time)
      const usernames = [...this.pendingQueue].slice(0, 50);
      
      if (usernames.length === 0) {
        this.processingQueue = false;
        return;
      }
      
      console.log('[RankService] Processing batch of', usernames.length, 'usernames');
      
      // Clear processed usernames from queue
      usernames.forEach(username => this.pendingQueue.delete(username));
      
      // Fetch ranks for batch
      const response = await fetch(`${this.API_BASE_URL}/ranks?usernames=${usernames.join(',')}`);
      
      if (!response.ok) {
        console.error('[RankService] Batch fetch error:', await response.text());
        this.processingQueue = false;
        return;
      }
      
      const result = await response.json();
      
      if (result.ranks && Array.isArray(result.ranks)) {
        // Update cache with all received ranks
        result.ranks.forEach(rankData => {
          this.updateCache(rankData.twitch_username, rankData);
        });
        
        console.log('[RankService] Updated cache with', result.ranks.length, 'ranks');
        
        // Dispatch event to notify content script that new ranks are available
        this.dispatchRanksUpdated(result.ranks);
      }
    } catch (error) {
      console.error('[RankService] Error processing queue:', error);
    } finally {
      this.processingQueue = false;
      
      // If there are still items in the queue, process again
      if (this.pendingQueue.size > 0) {
        this.scheduleQueueProcessing();
      }
    }
  },
  
  /**
   * Get a rank from cache if it exists and is not expired
   * 
   * @param {string} username - Twitch username
   * @returns {Object|null} - Cached rank data or null
   */
  getCachedRank(username) {
    const cacheKey = username.toLowerCase();
    const cachedItem = this.rankCache[cacheKey];
    
    if (!cachedItem) return null;
    
    // Check if cache is expired
    const now = Date.now();
    if (now - cachedItem.timestamp > this.CACHE_TTL) {
      // Cache expired, remove it
      delete this.rankCache[cacheKey];
      return null;
    }
    
    return cachedItem.data;
  },
  
  /**
   * Update the rank cache with new data
   * 
   * @param {string} username - Twitch username
   * @param {Object} rankData - Rank data to cache
   */
  updateCache(username, rankData) {
    if (!username || !rankData) return;
    
    const cacheKey = username.toLowerCase();
    
    this.rankCache[cacheKey] = {
      data: rankData,
      timestamp: Date.now()
    };
  },
  
  /**
   * Clear the entire rank cache
   */
  clearCache() {
    this.rankCache = {};
    console.log('[RankService] Rank cache cleared');
  },
  
  /**
   * Dispatch custom event when ranks are updated
   * This allows the content script to react to new rank data
   * 
   * @param {Array} ranks - Array of rank data objects
   */
  dispatchRanksUpdated(ranks) {
    const event = new CustomEvent('eloward_ranks_updated', {
      detail: { ranks }
    });
    
    document.dispatchEvent(event);
    console.log('[RankService] Dispatched ranks updated event with', ranks.length, 'ranks');
  }
};

export { RankService }; 