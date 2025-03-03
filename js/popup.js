// EloWard Popup Script

document.addEventListener('DOMContentLoaded', () => {
  // DOM elements
  const connectTwitchBtn = document.getElementById('connect-twitch');
  const connectRiotBtn = document.getElementById('connect-riot');
  const twitchConnectionStatus = document.getElementById('twitch-connection-status');
  const riotConnectionStatus = document.getElementById('riot-connection-status');
  const currentRank = document.getElementById('current-rank');
  const rankBadgePreview = document.getElementById('rank-badge-preview');
  const regionSelect = document.getElementById('region');

  // Check authentication status
  checkAuthStatus();

  // Event Listeners
  connectTwitchBtn.addEventListener('click', connectTwitchAccount);
  connectRiotBtn.addEventListener('click', connectRiotAccount);
  regionSelect.addEventListener('change', handleRegionChange);

  // Functions
  function checkAuthStatus() {
    chrome.storage.local.get(['twitchAuth', 'riotAuth', 'userRank', 'selectedRegion'], (result) => {
      // Check Twitch auth
      if (result.twitchAuth) {
        // Display Twitch username instead of "Connected"
        twitchConnectionStatus.textContent = result.twitchAuth.username || 'Connected';
        twitchConnectionStatus.classList.add('connected');
        connectTwitchBtn.textContent = 'Disconnect';
      }

      // Check Riot auth
      if (result.riotAuth) {
        // Display Riot ID instead of "Connected"
        if (result.riotAuth.riotId) {
          riotConnectionStatus.textContent = result.riotAuth.riotId;
        } else {
          riotConnectionStatus.textContent = result.riotAuth.summonerName || 'Connected';
        }
        riotConnectionStatus.classList.add('connected');
        connectRiotBtn.textContent = 'Disconnect';
        
        // Show rank if available
        if (result.userRank) {
          displayRank(result.userRank);
        }
      }
      
      // Set selected region if available
      if (result.selectedRegion) {
        regionSelect.value = result.selectedRegion;
      }
    });
  }

  function connectTwitchAccount() {
    chrome.storage.local.get('twitchAuth', (result) => {
      if (result.twitchAuth) {
        // Disconnect flow
        chrome.storage.local.remove('twitchAuth', () => {
          twitchConnectionStatus.textContent = 'Not Connected';
          twitchConnectionStatus.classList.remove('connected');
          connectTwitchBtn.textContent = 'Connect';
        });
      } else {
        // Connect flow - show loading state
        connectTwitchBtn.textContent = 'Connecting...';
        connectTwitchBtn.disabled = true;
        
        // In real implementation, this would involve Twitch OAuth
        // For MVP, we'll simulate authentication with a delay
        setTimeout(() => {
          chrome.runtime.sendMessage({ action: 'authenticate_twitch' }, (response) => {
            connectTwitchBtn.disabled = false;
            
            if (response && response.success) {
              // Always use the username from the auth response, never show "Connected" text
              twitchConnectionStatus.textContent = response.auth.username;
              twitchConnectionStatus.classList.add('connected');
              connectTwitchBtn.textContent = 'Disconnect';
            } else {
              connectTwitchBtn.textContent = 'Connect';
            }
          });
        }, 800); // Simulate network delay
      }
    });
  }

  function connectRiotAccount() {
    chrome.storage.local.get('riotAuth', (result) => {
      if (result.riotAuth) {
        // Disconnect flow
        chrome.storage.local.remove(['riotAuth', 'userRank'], () => {
          riotConnectionStatus.textContent = 'Not Connected';
          riotConnectionStatus.classList.remove('connected');
          connectRiotBtn.textContent = 'Connect';
          
          // Reset rank display
          currentRank.textContent = 'Unknown';
          rankBadgePreview.style.backgroundImage = 'none';
        });
      } else {
        // Connect flow - show loading state
        connectRiotBtn.textContent = 'Connecting...';
        connectRiotBtn.disabled = true;
        
        // Get selected region
        const region = regionSelect.value;
        
        // In real implementation, this would involve Riot RSO
        // For MVP, we'll simulate authentication with a delay
        setTimeout(() => {
          chrome.runtime.sendMessage({ action: 'authenticate_riot', region: region }, (response) => {
            connectRiotBtn.disabled = false;
            
            if (response && response.success) {
              // Always use the Riot ID or summoner name from the auth response
              if (response.auth.riotId) {
                riotConnectionStatus.textContent = response.auth.riotId;
              } else {
                riotConnectionStatus.textContent = response.auth.summonerName;
              }
              riotConnectionStatus.classList.add('connected');
              connectRiotBtn.textContent = 'Disconnect';
              
              // Fetch and display rank for the authenticated account
              chrome.runtime.sendMessage({ 
                action: 'get_user_rank', 
                username: response.auth.riotId || response.auth.summonerName,
                region: region
              }, (rankResponse) => {
                if (rankResponse && rankResponse.rank) {
                  displayRank(rankResponse.rank);
                }
              });
            } else {
              connectRiotBtn.textContent = 'Connect';
            }
          });
        }, 1000); // Simulate network delay
      }
    });
  }

  function handleRegionChange() {
    const selectedRegion = regionSelect.value;
    chrome.storage.local.set({ selectedRegion });
  }

  function displayRank(rankData) {
    // Handle null or undefined rank data
    if (!rankData) {
      currentRank.textContent = 'Unranked';
      rankBadgePreview.style.backgroundImage = 'none';
      return;
    }
    
    // Format the rank text
    let rankText = rankData.tier;
    if (rankData.division && rankData.tier !== 'Master' && 
        rankData.tier !== 'Grandmaster' && rankData.tier !== 'Challenger') {
      rankText += ' ' + rankData.division;
    }
    
    currentRank.textContent = rankText;
    
    // In a production extension, we would use Data Dragon for official rank icons
    // For MVP, we use local images
    rankBadgePreview.style.backgroundImage = `url('../images/ranks/${rankData.tier.toLowerCase()}.png')`;
  }
}); 