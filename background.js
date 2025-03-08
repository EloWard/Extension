// EloWard Background Service Worker
import './js/config.js';
import './js/riotAuth.js';

// Constants
const BADGE_REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutes
const API_BASE_URL = 'https://eloward-riotrso.unleashai-inquiries.workers.dev'; // Updated to use deployed worker

// Platform routing values for Riot API
const PLATFORM_ROUTING = {
  'na1': { region: 'americas', name: 'North America' },
  'euw1': { region: 'europe', name: 'EU West' },
  'eun1': { region: 'europe', name: 'EU Nordic & East' },
  'kr': { region: 'asia', name: 'Korea' },
  'br1': { region: 'americas', name: 'Brazil' },
  'jp1': { region: 'asia', name: 'Japan' },
  'la1': { region: 'americas', name: 'LAN' },
  'la2': { region: 'americas', name: 'LAS' },
  'oc1': { region: 'sea', name: 'Oceania' },
  'ru': { region: 'europe', name: 'Russia' },
  'tr1': { region: 'europe', name: 'Turkey' },
  'ph2': { region: 'sea', name: 'Philippines' },
  'sg2': { region: 'sea', name: 'Singapore' },
  'th2': { region: 'sea', name: 'Thailand' },
  'tw2': { region: 'sea', name: 'Taiwan' },
  'vn2': { region: 'sea', name: 'Vietnam' }
};

// Mock active streamers (would be fetched from backend in real implementation)
const ACTIVE_STREAMERS = [
  'riotgames',
  'lcs',
  'faker',
  'doublelift',
  'tyler1'
];

// Initialize
chrome.runtime.onInstalled.addListener((details) => {
  console.log('EloWard extension installed or updated', details.reason);
  
  // Clear all stored data to force a fresh start
  clearAllStoredData();
  
  // Initialize storage
  chrome.storage.local.set({
    activeStreamers: ACTIVE_STREAMERS,
    cachedRanks: {},
    lastRankUpdate: 0,
    selectedRegion: 'na1' // Default region
  });
  
  // Set icon badge to show it's active
  chrome.action.setBadgeText({ text: 'ON' });
  chrome.action.setBadgeBackgroundColor({ color: '#DC2123' });
  
  // Clear badge after 5 seconds
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '' });
  }, 5000);
});

// Function to clear all stored data
function clearAllStoredData() {
  // Clear chrome.storage.local
  chrome.storage.local.clear(() => {
    console.log('Cleared all chrome.storage.local data');
  });
  
  // Try to send a message to any open extension pages
  // This will fail silently if no receivers exist
  try {
    chrome.runtime.sendMessage({ action: 'clear_local_storage' })
      .catch(error => {
        // It's normal for this to fail if no popup is open to receive the message
        console.log('No receivers for clear_local_storage message (this is normal if popup is closed)');
      });
  } catch (error) {
    console.log('No receivers for clear_local_storage message (this is normal if popup is closed)');
  }
  
  // Note: Service workers don't have access to localStorage
  // We'll handle localStorage clearing in the popup instead
}

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message);
  
  if (message.action === 'clear_local_storage') {
    // This message is meant for extension pages with localStorage access
    // Background service worker doesn't have localStorage
    return;
  }
  
  if (message.action === 'check_streamer_subscription') {
    // In a real implementation, this would check against a backend API
    checkStreamerSubscription(message.streamer)
      .then(isSubscribed => {
        sendResponse({ subscribed: isSubscribed });
      })
      .catch(error => {
        console.error('Error checking streamer subscription:', error);
        sendResponse({ subscribed: false, error: error.message });
      });
    
    return true; // Keep the message channel open for async response
  }
  
  if (message.action === 'get_rank_for_user') {
    const { username, platform } = message;
    
    // Check cache first
    chrome.storage.local.get('cachedRanks', (data) => {
      const cachedRanks = data.cachedRanks || {};
      const cacheKey = `${username.toLowerCase()}_${platform}`;
      
      if (cachedRanks[cacheKey] && 
          (Date.now() - cachedRanks[cacheKey].timestamp < BADGE_REFRESH_INTERVAL)) {
        // Use cached data if it's fresh
        sendResponse({ rank: cachedRanks[cacheKey].data });
      } else {
        // Fetch rank data from backend
        fetchRankFromBackend(username, platform)
          .then(rankData => {
            // Update cache
            cachedRanks[cacheKey] = {
              timestamp: Date.now(),
              data: rankData
            };
            
            chrome.storage.local.set({ cachedRanks }, () => {
              sendResponse({ rank: rankData });
            });
          })
          .catch(error => {
            console.error('Error fetching rank data:', error);
            // Fallback to mock data if backend fails
            generateMockRankData(username, platform, (rankData) => {
              sendResponse({ rank: rankData, isMock: true });
            });
          });
      }
    });
    
    return true; // Keep the message channel open for async response
  }
  
  if (message.action === 'get_user_rank_by_puuid') {
    const { puuid, summonerId, region } = message;
    
    // Check if we have a valid token
    RiotAuth.getValidToken()
      .then(token => {
        // Get rank data using the League V4 API via backend
        getRankBySummonerId(token, summonerId, region)
          .then(rankData => {
            sendResponse({ rank: rankData });
          })
          .catch(error => {
            console.error('Error getting rank data:', error);
            sendResponse({ error: error.message });
          });
      })
      .catch(error => {
        console.error('Error getting valid token:', error);
        sendResponse({ error: error.message });
      });
    
    return true; // Keep the message channel open for async response
  }
});

// Helper functions

/**
 * Checks if a streamer has an active subscription
 * @param {string} streamerName - The streamer's Twitch username
 * @returns {Promise<boolean>} - Resolves with subscription status
 */
function checkStreamerSubscription(streamerName) {
  return new Promise((resolve, reject) => {
    // For MVP, check against mock list
    // In production, this would call the backend API
    if (ACTIVE_STREAMERS.includes(streamerName.toLowerCase())) {
      resolve(true);
      return;
    }
    
    // Call backend API to check subscription
    // For now, just use the health endpoint since the worker doesn't have a subscription endpoint yet
    fetch(`${API_BASE_URL}/health`)
      .then(response => {
        if (!response.ok) {
          // If API fails, fall back to mock list
          return { subscribed: ACTIVE_STREAMERS.includes(streamerName.toLowerCase()) };
        }
        return { subscribed: ACTIVE_STREAMERS.includes(streamerName.toLowerCase()) };
      })
      .then(data => {
        resolve(data.subscribed);
      })
      .catch(error => {
        console.error('Error checking subscription:', error);
        // If API fails, fall back to mock list
        resolve(ACTIVE_STREAMERS.includes(streamerName.toLowerCase()));
      });
  });
}

/**
 * Fetches rank data from the backend
 * @param {string} username - The username to fetch rank for
 * @param {string} platform - The platform code
 * @returns {Promise} - Resolves with the rank data
 */
function fetchRankFromBackend(username, platform) {
  return new Promise((resolve, reject) => {
    // Since the worker doesn't have a direct rank fetch endpoint yet,
    // we'll use mock data for now until the user links their account
    generateMockRankData(username, platform, (rankData) => {
      resolve(rankData);
    });
    
    // In a real implementation with authenticated users, we would use:
    // fetch(`${API_BASE_URL}/riot/league/entries?platform=${platform}&summonerId=${summonerId}`, {
    //   headers: {
    //     'Authorization': `Bearer ${token}`
    //   }
    // })
  });
}

/**
 * Gets rank data for a summoner using the League V4 API via backend
 * @param {string} token - The access token
 * @param {string} summonerId - The encrypted summoner ID
 * @param {string} platform - The platform code (e.g., 'na1')
 * @returns {Promise} - Resolves with the rank data
 */
function getRankBySummonerId(token, summonerId, platform) {
  return new Promise((resolve, reject) => {
    fetch(`${API_BASE_URL}/riot/league/entries?platform=${platform}&summonerId=${summonerId}`, {
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
      // Find the Solo/Duo queue entry
      const soloQueueEntry = leagueEntries.find(entry => entry.queueType === 'RANKED_SOLO_5x5');
      
      if (soloQueueEntry) {
        // Format the rank data
        const rankData = {
          tier: soloQueueEntry.tier,
          division: soloQueueEntry.rank,
          leaguePoints: soloQueueEntry.leaguePoints,
          wins: soloQueueEntry.wins,
          losses: soloQueueEntry.losses
        };
        
        resolve(rankData);
      } else {
        // No ranked data found
        resolve(null);
      }
    })
    .catch(error => {
      reject(error);
    });
  });
}

// Generate mock rank data for testing
function generateMockRankData(username, region, callback) {
  // For MVP, we'll generate consistent mock data based on username
  // In a real implementation, this would call the Riot API
  
  // Use username to deterministically generate a rank
  const hash = Array.from(username).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  
  const tiers = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grandmaster', 'Challenger'];
  const divisions = ['IV', 'III', 'II', 'I'];
  
  // Determine tier based on hash
  let tierIndex = hash % tiers.length;
  
  // Determine division for tiers that have divisions
  let division = null;
  if (tierIndex < 6) { // Iron through Diamond have divisions
    const divisionIndex = Math.floor((hash / 10) % 4);
    division = divisions[divisionIndex];
  }
  
  // Determine LP
  const lp = hash % 100;
  
  // Create rank data object
  const rankData = {
    tier: tiers[tierIndex],
    division: division,
    leaguePoints: lp,
    wins: 100 + (hash % 200),
    losses: 50 + (hash % 150)
  };
  
  // Simulate API delay
  setTimeout(() => {
    callback(rankData);
  }, 300);
}

// Helper function to get rank icon URL
function getRankIconUrl(tier) {
  return `../images/ranks/${tier.toLowerCase()}.png`;
} 