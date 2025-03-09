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
    
    // Save to storage
    chrome.storage.local.set({ selectedRegion: region });
    
    // If authenticated, refresh profile with new region
    const response = await chrome.runtime.sendMessage({ action: 'check_auth_status' });
    if (response.authenticated) {
      loadUserProfile();
    }
  }
  
  /**
   * Load and display user profile and rank
   */
  async function loadUserProfile() {
    try {
      // Show loading state
      currentRank.textContent = 'Loading...';
      
      // Get user profile from background script
      const profileData = await chrome.runtime.sendMessage({ action: 'get_user_profile' });
      
      if (!profileData.success) {
        throw new Error(profileData.error || 'Failed to load profile');
      }
      
      // Display user info
      const riotId = `${profileData.accountInfo.gameName}#${profileData.accountInfo.tagLine}`;
      document.getElementById('riot-id').textContent = riotId;
      
      // Find the highest ranked queue (Solo/Duo queue is preferred)
      let highestRank = null;
      let highestQueueType = '';
      
      if (profileData.rankInfo && profileData.rankInfo.length > 0) {
        // First look for RANKED_SOLO_5x5 queue
        const soloQueue = profileData.rankInfo.find(entry => entry.queueType === 'RANKED_SOLO_5x5');
        
        if (soloQueue && soloQueue.tier) {
          highestRank = soloQueue;
          highestQueueType = 'Solo/Duo';
        } else {
          // Find any ranked queue
          highestRank = profileData.rankInfo.find(entry => entry.tier);
          
          if (highestRank) {
            // Map queue type to a readable name
            const queueTypeMap = {
              'RANKED_SOLO_5x5': 'Solo/Duo',
              'RANKED_FLEX_SR': 'Flex',
              'RANKED_TFT': 'TFT',
              'RANKED_TFT_TURBO': 'TFT Turbo',
              'RANKED_TFT_PAIRS': 'TFT Pairs'
            };
            
            highestQueueType = queueTypeMap[highestRank.queueType] || highestRank.queueType;
          }
        }
      }
      
      if (highestRank && highestRank.tier) {
        // Format the rank
        const tier = highestRank.tier.charAt(0) + highestRank.tier.slice(1).toLowerCase();
        const rank = highestRank.rank || '';
        const lp = highestRank.leaguePoints !== undefined ? ` ${highestRank.leaguePoints} LP` : '';
        
        // Update rank display
        currentRank.textContent = `${tier} ${rank}${lp} (${highestQueueType})`;
        
        // Update rank badge
        updateRankBadge(tier, rank);
        
        // Show wins/losses if available
        if (highestRank.wins !== undefined && highestRank.losses !== undefined) {
          const winRate = Math.round((highestRank.wins / (highestRank.wins + highestRank.losses)) * 100);
          document.getElementById('win-rate').textContent = 
            `${highestRank.wins}W ${highestRank.losses}L (${winRate}%)`;
        } else {
          document.getElementById('win-rate').textContent = '';
        }
      } else {
        // No rank info found
        currentRank.textContent = 'Unranked';
        updateRankBadge('UNRANKED', '');
        document.getElementById('win-rate').textContent = '';
      }
    } catch (error) {
      console.error('Error loading user profile:', error);
      currentRank.textContent = 'Error loading rank';
    }
  }
  
  /**
   * Update the rank badge image
   */
  function updateRankBadge(tier, division) {
    // Format tier for consistent matching
    const formattedTier = tier.toLowerCase();
    
    // Get rank icon URL from background script
    chrome.runtime.sendMessage({ 
      action: 'get_rank_icon_url', 
      tier: formattedTier 
    }, (response) => {
      if (response && response.iconUrl) {
        // Update badge with the icon URL
        rankBadgePreview.style.backgroundImage = `url(${response.iconUrl})`;
      } else {
        // Use default rank icon as fallback
        rankBadgePreview.style.backgroundImage = `url(chrome-extension://${chrome.runtime.id}/images/ranks/unranked.png)`;
      }
    });
  }
  
  // Check if we just returned from an authentication flow
  chrome.storage.local.get('authInProgress', (data) => {
    if (data.authInProgress) {
      // Clear the flag
      chrome.storage.local.remove('authInProgress');
      
      // Refresh the auth status to update UI
      setTimeout(checkAuthStatus, 500);
    }
  });
  
  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'auth_completed') {
      // Auth flow completed, refresh UI
      checkAuthStatus();
    }
  });
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