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
    // Log all messages for debugging
    console.log('Popup received window message:', event.data);
    
    // Handle auth callback messages
    if (event.data && event.data.type === 'auth_callback' && event.data.params) {
      console.log('Received auth callback via window message');
      processAuthCallback(event.data.params);
    }
    
    // Handle retry authentication
    if (event.data && event.data.type === 'eloward_auth_retry') {
      console.log('Retrying authentication...');
      connectRiotAccount();
    }
  });
  
  // Listen for messages from the background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Popup received message:', message);
    
    // Handle auth callback messages
    if (message.type === 'auth_callback' && message.params) {
      console.log('Received auth callback via chrome message');
      processAuthCallback(message.params);
      sendResponse({ success: true });
    }
    
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
      localStorage.removeItem('eloward_user_data');
      
      console.log('Cleared Riot auth data from localStorage');
      sendResponse({ success: true });
    }
    
    return true; // Keep the message channel open for async response
  });

  // Process auth callback from various sources
  async function processAuthCallback(params) {
    try {
      console.log('Processing auth callback with params:', params);
      
      // Store the callback in chrome.storage for RiotAuth to use
      chrome.storage.local.set({
        'auth_callback': params,
        'eloward_auth_callback': params
      }, async () => {
        console.log('Stored auth callback in chrome.storage, completing auth flow');
        
        try {
          // Complete the authentication flow
          const userData = await RiotAuth.getUserData();
          
          // Update UI
          updateUserInterface(userData);
        } catch (error) {
          console.error('Error completing auth after callback:', error);
          showAuthError('Auth Processing Failed');
        }
      });
    } catch (error) {
      console.error('Error processing auth callback:', error);
    }
  }

  // Update UI based on user data
  function updateUserInterface(userData) {
    try {
      console.log('Updating UI with user data:', userData);
      
      if (userData && userData.gameName) {
        // Show Riot ID
        const riotId = `${userData.gameName}#${userData.tagLine}`;
        riotConnectionStatus.textContent = riotId;
        riotConnectionStatus.classList.add('connected');
        riotConnectionStatus.classList.remove('error');
        connectRiotBtn.textContent = 'Disconnect';
        connectRiotBtn.disabled = false;
        
        // Show rank if available
        if (userData.rankInfo) {
          displayRank(userData.rankInfo);
        }
      } else {
        riotConnectionStatus.textContent = 'Not Connected';
        riotConnectionStatus.classList.remove('connected');
        connectRiotBtn.textContent = 'Connect';
        connectRiotBtn.disabled = false;
      }
    } catch (error) {
      console.error('Error updating user interface:', error);
    }
  }

  // Show authentication error
  function showAuthError(message) {
    riotConnectionStatus.textContent = message || 'Authentication Failed';
    riotConnectionStatus.classList.add('error');
    connectRiotBtn.textContent = 'Connect';
    connectRiotBtn.disabled = false;
    
    // Reset error state after 5 seconds
    setTimeout(() => {
      riotConnectionStatus.textContent = 'Not Connected';
      riotConnectionStatus.classList.remove('error');
    }, 5000);
  }

  // Functions
  async function checkAuthStatus() {
    try {
      // First try to get data from RiotAuth module
      const isAuthenticated = await RiotAuth.isAuthenticated();
      
      if (isAuthenticated) {
        console.log('User is authenticated according to RiotAuth module');
        
        try {
          // Get all user data
          const userData = await RiotAuth.getUserData();
          updateUserInterface(userData);
        } catch (error) {
          console.error('Error getting user data from RiotAuth:', error);
          
          // Fallback to chrome.storage
          chrome.storage.local.get(['riotAuth', 'userRank', 'selectedRegion'], (result) => {
            if (result.riotAuth && result.riotAuth.gameName) {
              updateUserInterface(result.riotAuth);
            } else {
              riotConnectionStatus.textContent = 'Not Connected';
              connectRiotBtn.textContent = 'Connect';
            }
            
            // Set selected region if available
            if (result.selectedRegion) {
              regionSelect.value = result.selectedRegion;
            }
          });
        }
      } else {
        // Not authenticated, check storage anyway
        chrome.storage.local.get(['riotAuth', 'userRank', 'selectedRegion'], (result) => {
          if (result.riotAuth && result.riotAuth.gameName) {
            updateUserInterface(result.riotAuth);
          } else {
            riotConnectionStatus.textContent = 'Not Connected';
            connectRiotBtn.textContent = 'Connect';
          }
          
          // Set selected region if available
          if (result.selectedRegion) {
            regionSelect.value = result.selectedRegion;
          }
        });
      }
    } catch (error) {
      console.error('Error checking auth status:', error);
      
      // Fallback UI state
      riotConnectionStatus.textContent = 'Not Connected';
      connectRiotBtn.textContent = 'Connect';
    }
  }

  async function connectRiotAccount() {
    // Check if we need to authenticate or disconnect
    chrome.storage.local.get('riotAuth', async (result) => {
      if (result.riotAuth && result.riotAuth.gameName) {
        // Disconnect flow
        try {
          // Show loading state
          connectRiotBtn.textContent = 'Disconnecting...';
          connectRiotBtn.disabled = true;
          
          // Log out via RiotAuth
          await RiotAuth.logout();
          
          // Update UI
          riotConnectionStatus.textContent = 'Not Connected';
          riotConnectionStatus.classList.remove('connected');
          connectRiotBtn.textContent = 'Connect';
          connectRiotBtn.disabled = false;
          
          // Reset rank display
          currentRank.textContent = 'Unknown';
          rankBadgePreview.style.backgroundImage = 'none';
        } catch (error) {
          console.error('Logout error:', error);
          connectRiotBtn.textContent = 'Disconnect';
          connectRiotBtn.disabled = false;
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
          
          // Update UI with the user data
          updateUserInterface(userData);
        } catch (error) {
          console.error('Authentication error:', error);
          
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
          
          showAuthError(errorMessage);
          
          // Display more error details in console
          console.error('Detailed error:', error.message);
        }
      }
    });
  }

  function handleRegionChange() {
    const selectedRegion = regionSelect.value;
    chrome.storage.local.set({ selectedRegion });
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
      rankText += ` ${rankData.division}`;
    }
    
    currentRank.textContent = rankText;
    
    // Determine the rank badge image path
    let rankImageFileName = rankData.tier.toLowerCase();
    
    // Set the rank badge image
    rankBadgePreview.style.backgroundImage = `url('../images/ranks/${rankImageFileName}.png')`;
    
    // Apply different positioning based on rank
    const higherRanks = ['master', 'grandmaster', 'challenger'];
    if (higherRanks.includes(rankImageFileName)) {
      rankBadgePreview.style.transform = 'translateY(0)';
    } else {
      rankBadgePreview.style.transform = 'translateY(-3px)';
    }
  }
}); 