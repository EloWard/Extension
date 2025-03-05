// EloWard Configuration

export const EloWardConfig = {
  // API Configuration
  api: {
    baseUrl: 'https://api.eloward.xyz',
    endpoints: {
      checkSubscription: '/subscription/verify',
      fetchRank: '/rank/fetch'
    }
  },
  
  // Badge Configuration
  badges: {
    refreshInterval: 30 * 60 * 1000, // 30 minutes
    cacheExpiry: 24 * 60 * 60 * 1000, // 24 hours
    showUnranked: true,
    defaultSize: 16
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
    summonerV4: {
      baseUrl: 'https://{{platform}}.api.riotgames.com/lol/summoner/v4',
      endpoints: {
        getByPuuid: '/summoners/by-puuid/{{puuid}}'
      }
    },
    leagueV4: {
      baseUrl: 'https://{{platform}}.api.riotgames.com/lol/league/v4',
      endpoints: {
        getEntriesBySummonerId: '/entries/by-summoner/{{encryptedSummonerId}}'
      }
    },
    
    // Platform routing for Riot API
    platformRouting: {
      'na1': { region: 'americas', platform: 'na1' },
      'br1': { region: 'americas', platform: 'br1' },
      'la1': { region: 'americas', platform: 'la1' },
      'la2': { region: 'americas', platform: 'la2' },
      'euw1': { region: 'europe', platform: 'euw1' },
      'eun1': { region: 'europe', platform: 'eun1' },
      'tr1': { region: 'europe', platform: 'tr1' },
      'ru': { region: 'europe', platform: 'ru' },
      'kr': { region: 'asia', platform: 'kr' },
      'jp1': { region: 'asia', platform: 'jp1' },
      'oc1': { region: 'sea', platform: 'oc1' },
      'ph2': { region: 'sea', platform: 'ph2' },
      'sg2': { region: 'sea', platform: 'sg2' },
      'th2': { region: 'sea', platform: 'th2' },
      'tw2': { region: 'sea', platform: 'tw2' },
      'vn2': { region: 'sea', platform: 'vn2' }
    },
    
    // Data Dragon (for assets)
    dataDragon: {
      baseUrl: 'https://ddragon.leagueoflegends.com/cdn',
      versions: 'https://ddragon.leagueoflegends.com/api/versions.json',
      rankIcons: {
        iron: '/images/ranks/iron.png',
        bronze: '/images/ranks/bronze.png',
        silver: '/images/ranks/silver.png',
        gold: '/images/ranks/gold.png',
        platinum: '/images/ranks/platinum.png',
        emerald: '/images/ranks/emerald.png',
        diamond: '/images/ranks/diamond.png',
        master: '/images/ranks/master.png',
        grandmaster: '/images/ranks/grandmaster.png',
        challenger: '/images/ranks/challenger.png'
      }
    }
  },
  
  // Twitch API Configuration
  twitch: {
    baseUrl: 'https://api.twitch.tv/helix',
    oauth: {
      authorizeUrl: 'https://id.twitch.tv/oauth2/authorize',
      tokenUrl: 'https://id.twitch.tv/oauth2/token'
    }
  },
  
  // Extension Configuration
  extension: {
    version: '1.0.0',
    debug: false
  }
};

// In a real implementation, this would be properly exported 