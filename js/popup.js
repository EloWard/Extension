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
  const streamerHeader = document.getElementById('streamer-header');
  const streamerContent = document.getElementById('streamer-content');
  const dropdownArrow = streamerHeader.querySelector('.dropdown-arrow');

  // Initialize the streamer dropdown with proper styling 
  streamerContent.style.display = 'none';
  dropdownArrow.textContent = '▼';

  // Check authentication status
  checkAuthStatus();

  // Event Listeners
  connectRiotBtn.addEventListener('click', connectRiotAccount);
  regionSelect.addEventListener('change', handleRegionChange);
  
  // Add toggle functionality for the streamer section
  streamerHeader.addEventListener('click', () => {
    const isHidden = streamerContent.style.display === 'none';
    
    // Toggle the display of the content
    if (isHidden) {
      streamerContent.style.display = 'block';
      dropdownArrow.textContent = '▲';
    } else {
      streamerContent.style.display = 'none';
      dropdownArrow.textContent = '▼';
    }
  });
  
  // Flag to prevent recursive message handling
  let processingMessage = false;
  
  // Listen for messages from the auth window or background script
  window.addEventListener('message', function(event) {
    // Log all messages for debugging
    console.log('Popup received window message:', event);
    console.log('Popup received window message data:', event.data);
    
    // Handle auth callback messages
    if (!processingMessage && event.data && 
        ((event.data.type === 'auth_callback' && event.data.code) || 
         (event.data.source === 'eloward_auth' && event.data.code))) {
      
      console.log('Received auth callback via window message with code - forwarding to RiotAuth');
      
      // Set flag to prevent recursion
      processingMessage = true;
      
      // Store in chrome.storage for the RiotAuth module to find
      chrome.storage.local.set({
        'auth_callback': event.data,
        'eloward_auth_callback': event.data
      }, () => {
        console.log('Stored auth callback data in chrome.storage from popup');
        
        // Process the auth callback now
        processAuthCallback(event.data);
        
        // Reset flag
        processingMessage = false;
      });
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
        riotConnectionStatus.classList.remove('error', 'connecting');
        connectRiotBtn.textContent = 'Disconnect';
        connectRiotBtn.disabled = false;
        
        // Adapt the new userData format to match what the UI expects
        let rankInfo = null;
        
        // Try to get rank info from soloQueueRank field (new format)
        if (userData.soloQueueRank) {
          rankInfo = {
            tier: userData.soloQueueRank.tier.charAt(0) + userData.soloQueueRank.tier.slice(1).toLowerCase(),
            division: userData.soloQueueRank.rank,
            leaguePoints: userData.soloQueueRank.leaguePoints
          };
        } 
        // Try to find it in ranks array (new format)
        else if (userData.ranks && userData.ranks.length > 0) {
          const soloQueueEntry = userData.ranks.find(entry => entry.queueType === 'RANKED_SOLO_5x5');
          if (soloQueueEntry) {
            rankInfo = {
              tier: soloQueueEntry.tier.charAt(0) + soloQueueEntry.tier.slice(1).toLowerCase(),
              division: soloQueueEntry.rank,
              leaguePoints: soloQueueEntry.leaguePoints
            };
          }
        } 
        // Check for rankInfo directly (old format)
        else if (userData.rankInfo) {
          rankInfo = userData.rankInfo;
        }
        
        console.log('Adapted rank info for display:', rankInfo);
        
        // Show rank if available
        if (rankInfo) {
          displayRank(rankInfo);
        } else {
          // Show unranked if rank info is missing
          currentRank.textContent = 'Unranked';
          rankBadgePreview.style.backgroundImage = `url('../images/ranks/unranked.png')`;
          rankBadgePreview.style.transform = 'translateY(-3px)';
        }
      } else {
        // Not connected or incomplete data
        showNotConnectedUI();
      }
    } catch (error) {
      console.error('Error updating user interface:', error);
      // Fallback to not connected UI on error
      showNotConnectedUI();
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
      // Check if user is authenticated
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
              showNotConnectedUI();
            }
            
            // Set selected region if available
            if (result.selectedRegion) {
              regionSelect.value = result.selectedRegion;
            }
          });
        }
      } else {
        showNotConnectedUI();
        
        // Set region from storage if available
        chrome.storage.local.get(['selectedRegion'], (result) => {
          if (result.selectedRegion) {
            regionSelect.value = result.selectedRegion;
          }
        });
      }
    } catch (error) {
      console.error('Error checking auth status:', error);
      showNotConnectedUI();
    }
  }

  // Helper function to show the not connected UI state
  function showNotConnectedUI() {
    riotConnectionStatus.textContent = 'Not Connected';
    riotConnectionStatus.classList.remove('connected');
    connectRiotBtn.textContent = 'Connect';
    connectRiotBtn.disabled = false;
    
    // Reset rank display and show unranked graphic
    currentRank.textContent = 'Unranked';
    rankBadgePreview.style.backgroundImage = `url('../images/ranks/unranked.png')`;
    rankBadgePreview.style.transform = 'translateY(-3px)';
  }

  async function connectRiotAccount() {
    // Disable button during operation
    connectRiotBtn.disabled = true;
    
    try {
      // Check if we need to authenticate or disconnect using the proper auth check
      const isAuthenticated = await RiotAuth.isAuthenticated();
      
      if (isAuthenticated) {
        // Disconnect flow
        // Show loading state
        connectRiotBtn.textContent = 'Disconnecting...';
        riotConnectionStatus.textContent = 'Disconnecting...';
        riotConnectionStatus.classList.add('disconnecting');
        
        try {
          // Log out via RiotAuth WITHOUT forcing reload (smooth transition)
          await RiotAuth.logout(false);
          
          // Update UI manually instead of relying on page reload
          riotConnectionStatus.textContent = 'Not Connected';
          riotConnectionStatus.classList.remove('connected', 'disconnecting');
          connectRiotBtn.textContent = 'Connect';
          
          // Show unranked rank display
          currentRank.textContent = 'Unranked';
          rankBadgePreview.style.backgroundImage = `url('../images/ranks/unranked.png')`;
          rankBadgePreview.style.transform = 'translateY(-3px)';
          
          console.log('Successfully disconnected from Riot account');
        } catch (error) {
          console.error('Error disconnecting:', error);
          
          // Update UI to show error state
          connectRiotBtn.textContent = 'Disconnect';
          riotConnectionStatus.textContent = error.message || 'Disconnection error';
          riotConnectionStatus.classList.add('error');
          riotConnectionStatus.classList.remove('disconnecting');
        } finally {
          // Re-enable button
          connectRiotBtn.disabled = false;
        }
      } else {
        // Connect flow - show loading state
        connectRiotBtn.textContent = 'Connecting...';
        
        // Get selected region
        const region = regionSelect.value;
        
        // Show connecting status with gold color
        riotConnectionStatus.textContent = 'Connecting...';
        riotConnectionStatus.classList.remove('error');
        riotConnectionStatus.classList.add('connecting');
        
        console.log('Connecting to Riot with region:', region);
        
        try {
          // Use the Riot RSO authentication module
          const userData = await RiotAuth.authenticate(region);
          console.log('Authentication successful:', userData);
          
          // Update UI with the user data
          updateUserInterface(userData);
        } catch (error) {
          console.error('Error in connectRiotAccount:', error);
          
          // Update UI to show error state
          connectRiotBtn.textContent = 'Connect';
          riotConnectionStatus.textContent = error.message || 'Connection error';
          riotConnectionStatus.classList.add('error');
          riotConnectionStatus.classList.remove('connecting');
        } finally {
          // Remove connecting class if still present and not connected
          if (!riotConnectionStatus.classList.contains('connected')) {
            riotConnectionStatus.classList.remove('connecting');
          }
          
          // Re-enable button
          connectRiotBtn.disabled = false;
        }
      }
    } catch (error) {
      console.error('Error checking authentication status:', error);
      // Re-enable button in case of a general error
      connectRiotBtn.disabled = false;
    }
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