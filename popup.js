// EloWard Popup Script
document.addEventListener('DOMContentLoaded', async function() {
  // UI Elements
  const connectRiotBtn = document.getElementById('connect-riot');
  const riotConnectionStatus = document.getElementById('riot-connection-status');
  const rankBadgePreview = document.getElementById('rank-badge-preview');
  const currentRank = document.getElementById('current-rank');
  const regionSelect = document.getElementById('region');
  
  // Check authentication status on load
  checkAuthStatus();
  
  // Add event listeners
  connectRiotBtn.addEventListener('click', handleRiotConnect);
  regionSelect.addEventListener('change', handleRegionChange);
  
  // Initialize region from storage
  chrome.storage.local.get('selectedRegion', (data) => {
    if (data.selectedRegion) {
      regionSelect.value = data.selectedRegion;
    }
  });
  
  /**
   * Check if the user is authenticated with Riot
   */
  async function checkAuthStatus() {
    try {
      // Show loading state
      riotConnectionStatus.textContent = 'Checking...';
      riotConnectionStatus.classList.add('status-loading');
      
      // Ask background script for auth status
      const response = await chrome.runtime.sendMessage({ action: 'check_auth_status' });
      
      if (response.authenticated) {
        // User is authenticated, update UI
        riotConnectionStatus.textContent = 'Connected';
        riotConnectionStatus.classList.remove('status-loading');
        riotConnectionStatus.classList.add('status-connected');
        
        // Change button to disconnect
        connectRiotBtn.textContent = 'Disconnect';
        connectRiotBtn.classList.add('btn-disconnect');
        
        // Load and display user profile
        loadUserProfile();
      } else {
        // User is not authenticated, update UI
        riotConnectionStatus.textContent = 'Not Connected';
        riotConnectionStatus.classList.remove('status-loading');
        riotConnectionStatus.classList.remove('status-connected');
        
        // Reset button
        connectRiotBtn.textContent = 'Connect';
        connectRiotBtn.classList.remove('btn-disconnect');
        
        // Clear profile display
        rankBadgePreview.style.backgroundImage = '';
        currentRank.textContent = 'Unknown';
      }
    } catch (error) {
      console.error('Error checking auth status:', error);
      riotConnectionStatus.textContent = 'Error';
      riotConnectionStatus.classList.remove('status-loading');
    }
  }
  
  /**
   * Handle Riot connect/disconnect button click
   */
  async function handleRiotConnect() {
    // Check if already connected
    if (connectRiotBtn.classList.contains('btn-disconnect')) {
      // User wants to disconnect
      try {
        await chrome.runtime.sendMessage({ action: 'sign_out' });
        checkAuthStatus(); // Refresh UI
      } catch (error) {
        console.error('Error signing out:', error);
      }
    } else {
      // User wants to connect
      try {
        const region = regionSelect.value;
        await chrome.runtime.sendMessage({ 
          action: 'initiate_riot_auth',
          region: region
        });
        
        // The auth flow will continue in the new tab that opens
        // We'll update the UI when the user returns to the popup
      } catch (error) {
        console.error('Error initiating auth:', error);
      }
    }
  }
  
  /**
   * Handle region change
   */
  async function handleRegionChange() {
    const region = regionSelect.value;
    
    try {
      await chrome.runtime.sendMessage({ 
        action: 'update_region',
        region: region
      });
      
      // Refresh profile if user is authenticated
      if (riotConnectionStatus.classList.contains('status-connected')) {
        loadUserProfile();
      }
    } catch (error) {
      console.error('Error updating region:', error);
    }
  }
  
  /**
   * Load and display user profile
   */
  async function loadUserProfile() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'get_user_profile' });
      
      if (response.success && response.profile) {
        const { account, summoner, rank, region } = response.profile;
        
        // Display summoner name if available
        if (summoner && summoner.name) {
          // Check if the element exists before setting the text content
          const summonerNameElement = document.getElementById('summoner-name');
          if (summonerNameElement) {
            summonerNameElement.textContent = summoner.name;
          }
        }
        
        // Display rank if available
        if (rank && rank.soloQueueEntry) {
          const rankEntry = rank.soloQueueEntry;
          const tierString = rankEntry.tier || 'Unranked';
          const divisionString = rankEntry.rank || '';
          const lpString = rankEntry.leaguePoints !== undefined ? ` ${rankEntry.leaguePoints} LP` : '';
          
          // Set rank text
          currentRank.textContent = divisionString 
            ? `${tierString} ${divisionString}${lpString}` 
            : `${tierString}${lpString}`;
          
          // Set rank badge image
          updateRankBadge(rankEntry.tier, rankEntry.rank);
        } else {
          currentRank.textContent = 'Unranked';
          updateRankBadge(null, null);
        }
      } else {
        console.error('Failed to load profile:', response.error);
      }
    } catch (error) {
      console.error('Error loading user profile:', error);
    }
  }
  
  /**
   * Update the rank badge image
   */
  function updateRankBadge(tier, division) {
    if (!tier) {
      // Unranked or no data
      rankBadgePreview.style.backgroundImage = `url(${chrome.runtime.getURL('images/ranks/unranked.png')})`;
      return;
    }
    
    tier = tier.toLowerCase();
    
    // For master+ tiers, there's no division
    if (['master', 'grandmaster', 'challenger'].includes(tier)) {
      rankBadgePreview.style.backgroundImage = `url(${chrome.runtime.getURL(`images/ranks/${tier}.png`)})`;
    } else {
      // For other tiers, include the division
      rankBadgePreview.style.backgroundImage = `url(${chrome.runtime.getURL(`images/ranks/${tier}_${division.toLowerCase()}.png`)})`;
    }
  }
});

// Listen for messages from the callback page
window.addEventListener('message', (event) => {
  // Verify sender origin for security
  if (event.data.type === 'eloward_auth_callback') {
    // Forward the message to the background script
    chrome.runtime.sendMessage({
      action: 'eloward_auth_callback',
      code: event.data.code,
      state: event.data.state
    });
  } else if (event.data.type === 'eloward_auth_retry') {
    // Retry authentication
    const regionSelect = document.getElementById('region');
    const region = regionSelect.value;
    chrome.runtime.sendMessage({ 
      action: 'initiate_riot_auth',
      region: region
    });
  }
});

// Refresh UI when popup becomes visible again after auth
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible') {
    // Call the checkAuthStatus function in the popup context
    const checkAuthStatusFn = async function() {
      try {
        // Show loading state
        const riotConnectionStatus = document.getElementById('riot-connection-status');
        if (riotConnectionStatus) {
          riotConnectionStatus.textContent = 'Checking...';
          riotConnectionStatus.classList.add('status-loading');
        }
        
        // Ask background script for auth status
        const response = await chrome.runtime.sendMessage({ action: 'check_auth_status' });
        
        if (response.authenticated) {
          // User is authenticated, update UI
          if (riotConnectionStatus) {
            riotConnectionStatus.textContent = 'Connected';
            riotConnectionStatus.classList.remove('status-loading');
            riotConnectionStatus.classList.add('status-connected');
          }
          
          // Change button to disconnect
          const connectRiotBtn = document.getElementById('connect-riot');
          if (connectRiotBtn) {
            connectRiotBtn.textContent = 'Disconnect';
            connectRiotBtn.classList.add('btn-disconnect');
          }
          
          // Load and display user profile
          const loadUserProfileFn = window.loadUserProfile;
          if (typeof loadUserProfileFn === 'function') {
            loadUserProfileFn();
          }
        } else {
          // User is not authenticated, update UI
          if (riotConnectionStatus) {
            riotConnectionStatus.textContent = 'Not Connected';
            riotConnectionStatus.classList.remove('status-loading');
            riotConnectionStatus.classList.remove('status-connected');
          }
          
          // Reset button
          const connectRiotBtn = document.getElementById('connect-riot');
          if (connectRiotBtn) {
            connectRiotBtn.textContent = 'Connect';
            connectRiotBtn.classList.remove('btn-disconnect');
          }
          
          // Clear profile display
          const rankBadgePreview = document.getElementById('rank-badge-preview');
          const currentRank = document.getElementById('current-rank');
          if (rankBadgePreview) {
            rankBadgePreview.style.backgroundImage = '';
          }
          if (currentRank) {
            currentRank.textContent = 'Unknown';
          }
        }
      } catch (error) {
        console.error('Error checking auth status:', error);
        const riotConnectionStatus = document.getElementById('riot-connection-status');
        if (riotConnectionStatus) {
          riotConnectionStatus.textContent = 'Error';
          riotConnectionStatus.classList.remove('status-loading');
        }
      }
    };
    
    checkAuthStatusFn();
  }
});

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Popup received message:', message);
  
  // Handle clear_local_storage message
  if (message.action === 'clear_local_storage') {
    console.log('Clearing localStorage in popup context');
    
    // Clear Riot auth data from localStorage
    localStorage.removeItem('eloward_riot_access_token');
    localStorage.removeItem('eloward_riot_refresh_token');
    localStorage.removeItem('eloward_riot_token_expiry');
    localStorage.removeItem('eloward_riot_account_info');
    localStorage.removeItem('eloward_riot_summoner_info');
    localStorage.removeItem('eloward_riot_rank_info');
    localStorage.removeItem('eloward_auth_state');
    
    console.log('Cleared Riot auth data from localStorage');
    sendResponse({ success: true });
  }
  
  return true; // Keep the message channel open for async response
}); 