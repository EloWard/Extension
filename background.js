// EloWard Background Service Worker

// Constants
const BADGE_REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutes
const RIOT_API_BASE_URL = 'https://{{platform}}.api.riotgames.com/lol/';
const RIOT_REGIONAL_URL = 'https://{{region}}.api.riotgames.com/lol/';

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
chrome.runtime.onInstalled.addListener(() => {
  console.log('EloWard extension installed');
  
  // Initialize storage
  chrome.storage.local.set({
    activeStreamers: ACTIVE_STREAMERS,
    cachedRanks: {},
    lastRankUpdate: 0,
    apiKey: '', // In production, this would be managed securely via backend
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

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message);
  
  if (message.action === 'authenticate_riot') {
    initiateRiotAuth(message.region, sendResponse);
    return true; // Keep the message channel open for async response
  }
  
  if (message.action === 'get_user_rank') {
    getUserRankData(message.username, message.region, (rankData) => {
      sendResponse({ rank: rankData });
    });
    return true; // Keep the message channel open for async response
  }
  
  if (message.action === 'check_streamer_subscription') {
    // In a real implementation, this would check against a backend API
    // For MVP, we'll check against our mock list of subscribed streamers
    const isSubscribed = ACTIVE_STREAMERS.includes(message.streamer.toLowerCase());
    sendResponse({ subscribed: isSubscribed });
    return false; // No async response needed
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
        // Generate mock rank data for MVP
        generateMockRankData(username, platform, (rankData) => {
          // Update cache
          cachedRanks[cacheKey] = {
            timestamp: Date.now(),
            data: rankData
          };
          
          chrome.storage.local.set({ cachedRanks }, () => {
            sendResponse({ rank: rankData });
          });
        });
      }
    });
    
    return true; // Keep the message channel open for async response
  }
});

// Helper functions

// Mock Riot authentication for MVP
// In a real implementation, this would use Riot RSO
function initiateRiotAuth(region, sendResponse) {
  // Use consistent mock values for testing
  const mockGameName = 'RiotUser';
  const mockTagLine = region.toUpperCase().replace('1', '');
  const mockRiotId = `${mockGameName}#${mockTagLine}`;
  
  const mockRiotAuth = {
    accessToken: 'mock_riot_token',
    riotId: mockRiotId, // New Riot ID format (gameName#tagLine)
    summonerName: mockGameName,
    puuid: 'mock-puuid-123456789',
    region: region
  };
  
  chrome.storage.local.set({ 
    riotAuth: mockRiotAuth,
    selectedRegion: region 
  }, () => {
    // Generate mock rank data
    generateMockRankData(mockRiotAuth.riotId, region, (rankData) => {
      chrome.storage.local.set({ userRank: rankData }, () => {
        sendResponse({ 
          success: true,
          auth: mockRiotAuth
        });
      });
    });
  });
}

// Get user rank data (mock implementation for MVP)
function getUserRankData(username, region, callback) {
  generateMockRankData(username, region, callback);
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

// Helper function to get PUUID from Riot ID (mock implementation)
function getPUUIDFromRiotId(gameName, tagLine, region, callback) {
  // In a real implementation, this would call the Riot API
  callback(`mock-puuid-${gameName}-${tagLine}`);
}

// Helper function to get rank from PUUID (mock implementation)
function getRankFromPUUID(puuid, platform, callback) {
  // In a real implementation, this would call the Riot API
  generateMockRankData(puuid, platform, callback);
}

// Helper function to get rank icon URL
function getRankIconUrl(tier) {
  return `../images/ranks/${tier.toLowerCase()}.png`;
} 