// EloWard Configuration

const EloWardConfig = {
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
    
    // Platform routing values
    platformRouting: {
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
    refreshInterval: 30 * 60 * 1000, // 30 minutes
    version: '0.1.0'
  }
};

// In a real implementation, this would be properly exported 