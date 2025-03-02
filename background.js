// EloWard Background Service Worker

// Mock data for MVP
const MOCK_RANK_DATA = {
  'twitch_user123': { tier: 'Gold', division: 'II' },
  'twitch_user456': { tier: 'Diamond', division: 'IV' },
  'twitch_user789': { tier: 'Iron', division: 'III' },
};

// Mock active streamers (would be fetched from backend in real implementation)
const ACTIVE_STREAMERS = [
  'riotgames',
  'lcs',
  'faker',
  'doublelift',
  'tyler1'
];

// Constants
const BADGE_REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutes

// Initialize
chrome.runtime.onInstalled.addListener(() => {
  console.log('EloWard extension installed');
  
  // Initialize storage
  chrome.storage.local.set({
    activeStreamers: ACTIVE_STREAMERS,
    cachedRanks: {},
    lastRankUpdate: 0
  });
});

// Message handling from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'authenticate_twitch') {
    // Mock Twitch authentication for MVP
    const mockTwitchAuth = {
      accessToken: 'mock_twitch_token',
      userId: 'twitch_user123',
      username: 'EloWardUser'
    };
    
    chrome.storage.local.set({ twitchAuth: mockTwitchAuth }, () => {
      sendResponse({ success: true });
    });
    
    return true; // Keep the message channel open for async response
  }
  
  if (message.action === 'authenticate_riot') {
    // Mock Riot authentication for MVP
    const mockRiotAuth = {
      accessToken: 'mock_riot_token',
      summonerId: 'summoner123',
      region: 'NA1'
    };
    
    // Mock rank data
    const mockRank = { tier: 'Platinum', division: 'IV' };
    
    chrome.storage.local.set({ 
      riotAuth: mockRiotAuth,
      userRank: mockRank
    }, () => {
      sendResponse({ success: true, rank: mockRank });
    });
    
    return true; // Keep the message channel open for async response
  }
  
  if (message.action === 'check_channel_active') {
    chrome.storage.local.get('activeStreamers', (data) => {
      const isActive = data.activeStreamers.includes(message.channelName.toLowerCase());
      sendResponse({ isActive });
    });
    
    return true; // Keep the message channel open for async response
  }
  
  if (message.action === 'get_user_rank') {
    // Check if we have rank data cached
    chrome.storage.local.get(['cachedRanks', 'lastRankUpdate'], (data) => {
      const now = Date.now();
      const username = message.username.toLowerCase();
      
      // If we have recent cached data, use it
      if (data.cachedRanks[username] && now - data.lastRankUpdate < BADGE_REFRESH_INTERVAL) {
        sendResponse({ rank: data.cachedRanks[username] });
        return;
      }
      
      // Otherwise, get "fresh" data (mock for MVP)
      let rank = MOCK_RANK_DATA[username];
      
      // Generate random rank for users not in our mock data
      if (!rank) {
        const tiers = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Emerald', 'Diamond', 'Master', 'Grandmaster', 'Challenger'];
        const divisions = ['I', 'II', 'III', 'IV'];
        
        // 20% chance of having no rank
        if (Math.random() < 0.2) {
          rank = null;
        } else {
          const tierIndex = Math.floor(Math.random() * tiers.length);
          // Masters+ don't have divisions
          const division = tierIndex < 7 ? divisions[Math.floor(Math.random() * divisions.length)] : '';
          
          rank = {
            tier: tiers[tierIndex],
            division
          };
        }
      }
      
      // Cache the rank data
      data.cachedRanks[username] = rank;
      chrome.storage.local.set({
        cachedRanks: data.cachedRanks,
        lastRankUpdate: now
      });
      
      sendResponse({ rank });
    });
    
    return true; // Keep the message channel open for async response
  }
}); 