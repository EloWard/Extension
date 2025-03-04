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
  chrome.action.setBadgeText({ text: '' });
  chrome.action.setBadgeBackgroundColor({ color: '#DC2123' });
});

// Message handling from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'authenticate_twitch') {
    // Mock Twitch authentication for MVP
    initiateTwitchAuth(sendResponse);
    return true; // Indicate we will respond asynchronously
  }
  
  if (message.action === 'authenticate_riot') {
    // Mock Riot authentication for MVP
    initiateRiotAuth(message.region, sendResponse);
    return true; // Indicate we will respond asynchronously
  }
  
  if (message.action === 'check_channel_active') {
    chrome.storage.local.get('activeStreamers', (data) => {
      const isActive = data.activeStreamers.includes(message.channelName.toLowerCase());
      
      // Update badge when on an active channel
      if (isActive) {
        chrome.action.setBadgeText({ text: '✓' });
      } else {
        chrome.action.setBadgeText({ text: '' });
      }
      
      sendResponse({ isActive });
    });
    
    return true; // Keep the message channel open for async response
  }
  
  if (message.action === 'get_user_rank') {
    // Check if we have rank data cached
    chrome.storage.local.get(['cachedRanks', 'lastRankUpdate', 'selectedRegion'], (data) => {
      const now = Date.now();
      const username = message.username.toLowerCase();
      const region = data.selectedRegion || 'na1';
      
      // Cache key includes region to handle different ranks in different regions
      const cacheKey = `${username}_${region}`;
      
      // If we have recent cached data, use it
      if (data.cachedRanks && data.cachedRanks[cacheKey] && now - data.lastRankUpdate < BADGE_REFRESH_INTERVAL) {
        sendResponse({ rank: data.cachedRanks[cacheKey] });
        return;
      }
      
      // For MVP, we'll use mock data instead of real API calls
      // In a real implementation, we would:
      // 1. Use the Account-V1 API to get PUUID from Riot ID (gameName + tagLine)
      // 2. Use the League-V4 API to get rank data using the PUUID
      // Following the migration from summoner names to Riot IDs
      generateMockRankData(username, region, (rank) => {
        // Cache the rank data
        if (!data.cachedRanks) {
          data.cachedRanks = {};
        }
        
        data.cachedRanks[cacheKey] = rank;
        chrome.storage.local.set({
          cachedRanks: data.cachedRanks,
          lastRankUpdate: now
        });
        
        sendResponse({ rank });
      });
    });
    
    return true; // Keep the message channel open for async response
  }
});

// Helper functions

// Mock Twitch authentication for MVP
function initiateTwitchAuth(sendResponse) {
  // Use a consistent mock username for testing
  const mockTwitchUsername = 'TwitchUser123';
  
  const mockTwitchAuth = {
    accessToken: 'mock_twitch_token',
    userId: 'twitch_user123',
    username: mockTwitchUsername
  };
  
  chrome.storage.local.set({ twitchAuth: mockTwitchAuth }, () => {
    sendResponse({ 
      success: true,
      auth: mockTwitchAuth
    });
  });
}

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

// Retrieve rank data for a user
function getUserRankData(username, region, callback) {
  console.log(`Getting rank data for ${username} in region ${region}`);
  
  // In a real implementation, this would check cached data first,
  // then fetch from Riot API if needed
  chrome.storage.local.get('cachedRanks', (data) => {
    const now = Date.now();
    const cacheKey = `${username}:${region}`;
    
    // Check if we have a recent cached result
    if (data.cachedRanks && data.cachedRanks[cacheKey] && 
        data.cachedRanks[cacheKey].timestamp > now - BADGE_REFRESH_INTERVAL) {
      console.log(`Using cached rank data for ${username}`);
      callback(data.cachedRanks[cacheKey].rank);
      return;
    }
    
    // Otherwise, generate new data
    generateMockRankData(username, region, (rankData) => {
      // Cache the result
      const cachedRanks = data.cachedRanks || {};
      cachedRanks[cacheKey] = {
        rank: rankData,
        timestamp: now
      };
      
      chrome.storage.local.set({ 
        cachedRanks: cachedRanks,
        lastRankUpdate: now
      }, () => {
        callback(rankData);
      });
    });
  });
}

// Generate mock rank data for users
// In a real implementation, this would fetch from Riot API
function generateMockRankData(username, region, callback) {
  // Some predefined mock data
  const MOCK_RANK_DATA = {
    'twitch_user123': { tier: 'Gold', division: 'II' },
    'twitch_user456': { tier: 'Diamond', division: 'IV' },
    'twitch_user789': { tier: 'Iron', division: 'III' },
  };
  
  let rank = MOCK_RANK_DATA[username];
  
  // Generate random rank for users not in our mock data
  if (!rank) {
    const tiers = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Emerald', 'Diamond', 'Master', 'Grandmaster', 'Challenger'];
    const divisions = ['I', 'II', 'III', 'IV'];
    
    // 20% chance of having no rank
    if (Math.random() < 0.2) {
      // Return null explicitly for unranked users
      rank = null;
    } else {
      const randomTier = tiers[Math.floor(Math.random() * tiers.length)];
      let randomDivision = null;
      
      // Only add division for tiers below Master
      if (randomTier !== 'Master' && randomTier !== 'Grandmaster' && randomTier !== 'Challenger') {
        randomDivision = divisions[Math.floor(Math.random() * divisions.length)];
      }
      
      rank = { 
        tier: randomTier,
        division: randomDivision
      };
    }
  }
  
  // Add a small delay to simulate API call
  setTimeout(() => {
    callback(rank);
  }, 100);
}

// In a real implementation, these functions would make actual API calls

// Get PUUID from Riot ID (gameName + tagLine)
function getPUUIDFromRiotId(gameName, tagLine, region, callback) {
  // Would use Account-V1 API: 
  // GET /riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}
  // Example: https://americas.api.riotgames.com/riot/account/v1/accounts/by-riot-id/EloWardUser/NA1
}

// Get League rank data from PUUID
function getRankFromPUUID(puuid, platform, callback) {
  // Would use League-V4 API:
  // GET /lol/league/v4/entries/by-summoner/{encryptedSummonerId}
  // First need to get summonerId from PUUID using Summoner-V4 API
}

// Get assets from Data Dragon
function getRankIconUrl(tier) {
  // Data Dragon would be used for official rank icons
  // Example: https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Aatrox_0.jpg
  
  // For MVP, we'd just return the path to local assets
  return `images/ranks/${tier.toLowerCase()}.png`;
} 