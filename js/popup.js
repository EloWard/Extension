// EloWard Popup Script
import { EloWardConfig } from './config.js';
import { RiotAuth } from './riotAuth.js';

document.addEventListener('DOMContentLoaded', () => {
  // DOM elements
  const connectRiotBtn = document.getElementById('connect-riot');
  const riotConnectionStatus = document.getElementById('riot-connection-status');
  const currentRank = document.getElementById('current-rank');
  const rankBadgePreview = document.getElementById('rank-badge-preview');
  const regionSelect = document.getElementById('region');

  // Check authentication status
  checkAuthStatus();

  // Event Listeners
  connectRiotBtn.addEventListener('click', connectRiotAccount);
  regionSelect.addEventListener('change', handleRegionChange);
  
  // Listen for messages from the auth window or background script
  window.addEventListener('message', function(event) {
    // Verify origin (from our extension)
    if (event.origin !== `chrome-extension://${chrome.runtime.id}`) {
      return;
    }
    
    const data = event.data;
    console.log('Received message in popup:', data);
    
    // Handle retry authentication
    if (data && data.type === 'eloward_auth_retry') {
      console.log('Retrying authentication...');
      connectRiotAccount();
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

  // Functions
  function checkAuthStatus() {
    chrome.storage.local.get(['riotAuth', 'userRank', 'selectedRegion'], async (result) => {
      // Clear any fake auth state
      if (result.riotAuth && (!result.riotAuth.puuid || !result.riotAuth.riotId)) {
        // This is likely a fake/mock auth state from development
        chrome.storage.local.remove(['riotAuth', 'userRank'], () => {
          console.log('Cleared invalid auth state');
          riotConnectionStatus.textContent = 'Not Connected';
          connectRiotBtn.textContent = 'Connect';
        });
        return;
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
        } else {
          // Fetch rank data if not available
          fetchUserRank(result.riotAuth);
        }
      } else {
        // Check if we have auth data in localStorage via RiotAuth module
        try {
          const isAuthenticated = await RiotAuth.isAuthenticated();
          if (isAuthenticated) {
            console.log('Found authentication in localStorage but not in chrome.storage');
            const accountInfo = await RiotAuth.getAccountInfo();
            if (accountInfo) {
              console.log('Retrieved account info from localStorage');
              riotConnectionStatus.textContent = `${accountInfo.gameName}#${accountInfo.tagLine}`;
              riotConnectionStatus.classList.add('connected');
              connectRiotBtn.textContent = 'Disconnect';
              
              // Try to get rank data
              const rankInfo = await RiotAuth.getRankInfo();
              if (rankInfo) {
                displayRank(rankInfo);
              }
            }
          }
        } catch (error) {
          console.error('Error checking localStorage auth:', error);
        }
      }
      
      // Set selected region if available
      if (result.selectedRegion) {
        regionSelect.value = result.selectedRegion;
      }
    });
  }

  async function connectRiotAccount() {
    chrome.storage.local.get('riotAuth', async (result) => {
      if (result.riotAuth) {
        // Disconnect flow
        try {
          await RiotAuth.logout();
          riotConnectionStatus.textContent = 'Not Connected';
          riotConnectionStatus.classList.remove('connected');
          connectRiotBtn.textContent = 'Connect';
          
          // Reset rank display
          currentRank.textContent = 'Unknown';
          rankBadgePreview.style.backgroundImage = 'none';
        } catch (error) {
          console.error('Logout error:', error);
        }
      } else {
        // Connect flow - show loading state
        connectRiotBtn.textContent = 'Connecting...';
        connectRiotBtn.disabled = true;
        
        // Get selected region
        const region = regionSelect.value;
        
        // Show connecting status
        riotConnectionStatus.textContent = 'Connecting...';
        riotConnectionStatus.classList.remove('error');
        
        console.log('Connecting to Riot with region:', region);
        
        // Use the Riot RSO authentication module
        try {
          const userData = await RiotAuth.authenticate(region);
          console.log('Authentication successful:', userData);
          
          // Update UI
          riotConnectionStatus.textContent = userData.riotId;
          riotConnectionStatus.classList.add('connected');
          connectRiotBtn.textContent = 'Disconnect';
          connectRiotBtn.disabled = false;
          
          // Fetch and display rank for the authenticated account
          fetchUserRank(userData);
        } catch (error) {
          console.error('Authentication error:', error);
          connectRiotBtn.textContent = 'Connect';
          connectRiotBtn.disabled = false;
          
          // Show descriptive error message
          let errorMessage = 'Authentication Failed';
          
          if (error.message.includes('Failed to initialize authentication')) {
            errorMessage = 'Server Connection Error';
          } else if (error.message.includes('Authentication cancelled')) {
            errorMessage = 'Authentication Cancelled';
          } else if (error.message.includes('State mismatch')) {
            errorMessage = 'Security Verification Failed';
          } else if (error.message.includes('Failed to exchange token')) {
            errorMessage = 'Token Exchange Failed';
          }
          
          riotConnectionStatus.textContent = errorMessage;
          riotConnectionStatus.classList.add('error');
          
          // Display more error details in console
          console.error('Detailed error:', error.message);
          
          // Reset error state after 5 seconds
          setTimeout(() => {
            riotConnectionStatus.textContent = 'Not Connected';
            riotConnectionStatus.classList.remove('error');
          }, 5000);
        }
      }
    });
  }

  function handleRegionChange() {
    const selectedRegion = regionSelect.value;
    chrome.storage.local.set({ selectedRegion });
  }

  function fetchUserRank(userData) {
    // Request rank data from background script
    chrome.runtime.sendMessage({
      action: 'get_user_rank_by_puuid',
      puuid: userData.puuid,
      summonerId: userData.summonerId,
      region: userData.platform || userData.region
    }, (response) => {
      if (response && response.rank) {
        // Store rank data
        chrome.storage.local.set({ userRank: response.rank });
        
        // Display rank
        displayRank(response.rank);
      } else if (response && response.error) {
        console.error('Error fetching rank:', response.error);
        
        // Try to get rank from RiotAuth module
        RiotAuth.getRankInfo()
          .then(rankInfo => {
            if (rankInfo) {
              console.log('Retrieved rank info from RiotAuth module');
              displayRank(rankInfo);
            }
          })
          .catch(error => {
            console.error('Error getting rank from RiotAuth module:', error);
          });
      }
    });
  }

  function displayRank(rankData) {
    if (!rankData) {
      currentRank.textContent = 'Unranked';
      // Enhanced image URL path to ensure proper loading with transparent background
      rankBadgePreview.style.backgroundImage = `url('../images/ranks/unranked.png')`;
      // Apply custom positioning for unranked badge
      rankBadgePreview.style.transform = 'translateY(-3px)';
      return;
    }
    
    let rankText = rankData.tier;
    if (rankData.division && rankData.tier !== 'Master' && 
        rankData.tier !== 'Grandmaster' && rankData.tier !== 'Challenger') {
      rankText += ' ' + rankData.division;
    }
    
    currentRank.textContent = rankText;
    
    // Enhanced image path and ensure proper sizing to display transparent PNG
    rankBadgePreview.style.backgroundImage = `url('../images/ranks/${rankData.tier.toLowerCase()}.png')`;
  }
}); 