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
        // In real implementation, this would involve Riot RSO
        // For MVP, we'll simulate authentication
        
        chrome.runtime.sendMessage({ action: 'authenticate_riot' }, (response) => {
          if (response && response.success) {
            riotConnectionStatus.textContent = 'Connected';
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
    currentRank.textContent = `${rankData.tier} ${rankData.division}`;
    rankBadgePreview.style.backgroundImage = `url('../images/ranks/${rankData.tier.toLowerCase()}.png')`;
  }

  function openSettings(e) {
    e.preventDefault();
    // For MVP, we'll just show an alert
    alert('Settings functionality will be implemented in a future version.');
  }
}); 