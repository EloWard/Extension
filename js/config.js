// EloWard Configuration

export const EloWardConfig = {
  // API Configuration
  api: {
    baseUrl: 'https://eloward-riotrso.unleashai.workers.dev',
    endpoints: {
      checkSubscription: '/subscription/verify',
      fetchRank: '/rank/fetch'
    }
  },
  
  // Badge Configuration
  badges: {
    cacheExpiry: 24 * 60 * 60 * 1000, // 24 hours
    showUnranked: true,
    defaultSize: 16,
    // Chat badge specific configuration
    chat: {
      position: 'before-username', // Can be 'before-username' or 'after-username'
      animationEnabled: true,
      hoverScaleFactor: 1.2,
      tooltipEnabled: true
    }
  },
  
  // Riot API Configuration
  riot: {
    // API endpoints
    accountV1: {
      baseUrl: 'https://{{region}}.api.riotgames.com/riot/account/v1',
      endpoints: {
        getByRiotId: '/accounts/by-riot-id/{{gameName}}/{{tagLine}}',
        getByPuuid: '/accounts/by-puuid/{{puuid}}'
      }
    },
    leagueV4: {
      baseUrl: 'https://{{platform}}.api.riotgames.com/lol/league/v4',
      endpoints: {
        getEntriesByPuuid: '/entries/by-puuid/{{encryptedPUUID}}'
      }
    },
    
    // Platform routing for Riot API
    platformRouting: {
      'na1': { region: 'americas', platform: 'na1', name: 'North America' },
      'br1': { region: 'americas', platform: 'br1', name: 'Brazil' },
      'la1': { region: 'americas', platform: 'la1', name: 'LAN' },
      'la2': { region: 'americas', platform: 'la2', name: 'LAS' },
      'euw1': { region: 'europe', platform: 'euw1', name: 'EU West' },
      'eun1': { region: 'europe', platform: 'eun1', name: 'EU Nordic & East' },
      'tr1': { region: 'europe', platform: 'tr1', name: 'Turkey' },
      'ru': { region: 'europe', platform: 'ru', name: 'Russia' },
      'kr': { region: 'asia', platform: 'kr', name: 'Korea' },
      'jp1': { region: 'asia', platform: 'jp1', name: 'Japan' },
      'oc1': { region: 'sea', platform: 'oc1', name: 'Oceania' },
      'ph2': { region: 'sea', platform: 'ph2', name: 'Philippines' },
      'sg2': { region: 'sea', platform: 'sg2', name: 'Singapore' },
      'th2': { region: 'sea', platform: 'th2', name: 'Thailand' },
      'tw2': { region: 'sea', platform: 'tw2', name: 'Taiwan' },
      'vn2': { region: 'sea', platform: 'vn2', name: 'Vietnam' }
    },
    
    // Data Dragon (for assets)
    dataDragon: {
      baseUrl: 'https://ddragon.leagueoflegends.com/cdn',
      versions: 'https://ddragon.leagueoflegends.com/api/versions.json',
      rankIcons: {
        unranked: 'https://eloward-cdn.unleashai.workers.dev/lol/unranked.png',
        iron: 'https://eloward-cdn.unleashai.workers.dev/lol/iron.png',
        bronze: 'https://eloward-cdn.unleashai.workers.dev/lol/bronze.png',
        silver: 'https://eloward-cdn.unleashai.workers.dev/lol/silver.png',
        gold: 'https://eloward-cdn.unleashai.workers.dev/lol/gold.png',
        platinum: 'https://eloward-cdn.unleashai.workers.dev/lol/platinum.png',
        emerald: 'https://eloward-cdn.unleashai.workers.dev/lol/emerald.png',
        diamond: 'https://eloward-cdn.unleashai.workers.dev/lol/diamond.png',
        master: 'https://eloward-cdn.unleashai.workers.dev/lol/master.png',
        grandmaster: 'https://eloward-cdn.unleashai.workers.dev/lol/grandmaster.png',
        challenger: 'https://eloward-cdn.unleashai.workers.dev/lol/challenger.png'
      }
    }
  },
  
  // Twitch API Configuration
  twitch: {
    baseUrl: 'https://api.twitch.tv/helix',
    oauth: {
      authorizeUrl: 'https://id.twitch.tv/oauth2/authorize',
      tokenUrl: 'https://id.twitch.tv/oauth2/token'
    },
    // Twitch chat badge settings
    chat: {
      badgeSelectors: [
        '.chat-line__message', // Current primary chat message container
        '.chat-author__display-name', // Username element
        '.chat-badge', // Existing badge class for reference
        '.chat-scrollable-area__message-container' // Chat container
      ]
    }
  },
  
  // Extension Configuration
  extension: {
    version: '1.0.0',
    debug: false,
    features: {
      chatBadges: true,
      profileBadges: true,
      rankTooltips: true
    }
  }
};

// In a real implementation, this would be properly exported 