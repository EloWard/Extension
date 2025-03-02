// EloWard Popup Script

document.addEventListener('DOMContentLoaded', () => {
  // DOM elements
  const connectTwitchBtn = document.getElementById('connect-twitch');
  const connectRiotBtn = document.getElementById('connect-riot');
  const twitchConnectionStatus = document.getElementById('twitch-connection-status');
  const riotConnectionStatus = document.getElementById('riot-connection-status');
  const currentRank = document.getElementById('current-rank');
  const rankBadgePreview = document.getElementById('rank-badge-preview');
  const settingsLink = document.getElementById('settings-link');

  // Check authentication status
  checkAuthStatus();

  // Event Listeners
  connectTwitchBtn.addEventListener('click', connectTwitchAccount);
  connectRiotBtn.addEventListener('click', connectRiotAccount);
  settingsLink.addEventListener('click', openSettings);

  // Functions
  function checkAuthStatus() {
    chrome.storage.local.get(['twitchAuth', 'riotAuth', 'userRank'], (result) => {
      // Check Twitch auth
      if (result.twitchAuth) {
        twitchConnectionStatus.textContent = 'Connected';
        twitchConnectionStatus.classList.add('connected');
        connectTwitchBtn.textContent = 'Disconnect';
      }

      // Check Riot auth
      if (result.riotAuth) {
        riotConnectionStatus.textContent = 'Connected';
        riotConnectionStatus.classList.add('connected');
        connectRiotBtn.textContent = 'Disconnect';
        
        // Show Riot ID
        if (result.riotAuth.riotId) {
          riotConnectionStatus.textContent = `Connected (${result.riotAuth.riotId})`;
        }
        
        // Show rank if available
        if (result.userRank) {
          displayRank(result.userRank);
        }
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
          connectTwitchBtn.textContent = 'Connect Twitch Account';
        });
      } else {
        // Connect flow
        // In real implementation, this would involve Twitch OAuth
        // For MVP, we'll simulate authentication
        
        chrome.runtime.sendMessage({ action: 'authenticate_twitch' }, (response) => {
          if (response && response.success) {
            twitchConnectionStatus.textContent = 'Connected';
            twitchConnectionStatus.classList.add('connected');
            connectTwitchBtn.textContent = 'Disconnect';
          }
        });
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
          connectRiotBtn.textContent = 'Connect League Account';
          currentRank.textContent = 'Unknown';
          rankBadgePreview.style.backgroundImage = 'none';
        });
      } else {
        // Connect flow
        // In a production extension, we would:
        // 1. Use Riot RSO (Riot Sign On) for authentication
        // 2. Follow the OAuth 2.0 protocol
        // 3. Exchange authorization code for access token
        // 4. Use token to access Riot API
        
        chrome.runtime.sendMessage({ action: 'authenticate_riot' }, (response) => {
          if (response && response.success) {
            riotConnectionStatus.textContent = 'Connected';
            if (response.riotId) {
              riotConnectionStatus.textContent = `Connected (${response.riotId})`;
            }
            
            riotConnectionStatus.classList.add('connected');
            connectRiotBtn.textContent = 'Disconnect';
            
            if (response.rank) {
              displayRank(response.rank);
            }
          }
        });
      }
    });
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

  function openSettings(e) {
    e.preventDefault();
    // For MVP, we'll just show an alert
    alert('Settings functionality will be implemented in a future version.');
  }
}); 