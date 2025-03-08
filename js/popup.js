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

  // Functions
  function checkAuthStatus() {
    chrome.storage.local.get(['riotAuth', 'userRank', 'selectedRegion'], (result) => {
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
      }
      
      // Set selected region if available
      if (result.selectedRegion) {
        regionSelect.value = result.selectedRegion;
      }
    });
  }

  function connectRiotAccount() {
    chrome.storage.local.get('riotAuth', (result) => {
      if (result.riotAuth) {
        // Disconnect flow
        RiotAuth.logout().then(() => {
          riotConnectionStatus.textContent = 'Not Connected';
          riotConnectionStatus.classList.remove('connected');
          connectRiotBtn.textContent = 'Connect';
          
          // Reset rank display
          currentRank.textContent = 'Unknown';
          rankBadgePreview.style.backgroundImage = 'none';
        }).catch(error => {
          console.error('Logout error:', error);
        });
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
        RiotAuth.authenticate(region)
          .then(userData => {
            console.log('Authentication successful:', userData);
            // Update UI
            riotConnectionStatus.textContent = userData.riotId;
            riotConnectionStatus.classList.add('connected');
            connectRiotBtn.textContent = 'Disconnect';
            connectRiotBtn.disabled = false;
            
            // Fetch and display rank for the authenticated account
            fetchUserRank(userData);
          })
          .catch(error => {
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
          });
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