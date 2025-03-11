// EloWard Popup Script
import { RiotAuth } from './js/riotAuth.js';

document.addEventListener('DOMContentLoaded', () => {
  // DOM elements
  const connectRiotBtn = document.getElementById('connect-riot');
  const riotConnectionStatus = document.getElementById('riot-connection-status');
  const currentRank = document.getElementById('current-rank');
  const rankBadgePreview = document.getElementById('rank-badge-preview');
  const regionSelect = document.getElementById('region');

  // Flag to prevent recursive message handling
  let processingMessage = false;

  // Check authentication status on load
  checkAuthStatus();

  // Set up event listeners
  connectRiotBtn.addEventListener('click', connectRiotAccount);
  regionSelect.addEventListener('change', handleRegionChange);
  
  // Listen for messages from the auth window or background script
  window.addEventListener('message', (event) => {
    console.log('Popup received window message:', event);
    
    // Only process auth callback messages and avoid processing our own messages
    if (!processingMessage && 
        event.data && 
        ((event.data.type === 'auth_callback' && event.data.code) || 
         (event.data.source === 'eloward_auth' && event.data.code))) {
      
      // Set flag to prevent recursive processing
      processingMessage = true;
      
      console.log('Received auth callback via window message:', {
        hasCode: !!event.data.code,
        hasState: !!event.data.state
      });
      
      // Store in chrome.storage for retrieval by RiotAuth
      chrome.storage.local.set({
        'auth_callback': event.data,
        'eloward_auth_callback': event.data
      }, () => {
        // Process the auth callback now
        processAuthCallback(event.data)
          .finally(() => {
            // Reset flag after processing is complete
            processingMessage = false;
          });
      });
    }
  });
  
  // Listen for messages from the background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Popup received message from runtime:', message);
    
    if (message.type === 'auth_callback' && message.params) {
      // Handle auth callback from background script
      processAuthCallback(message.params);
      sendResponse({ success: true });
    }
    
    if (message.action === 'clear_local_storage') {
      // Clear localStorage for extension
      clearLocalStorage();
      sendResponse({ success: true });
    }
    
    return true; // Keep the channel open for async response
  });

  /**
   * Process authentication callback
   * @param {Object} params - The callback parameters with code and state
   */
  async function processAuthCallback(params) {
    try {
      console.log('Processing auth callback with params:', params);
      
      // Show a connecting message
      riotConnectionStatus.textContent = 'Connecting...';
      connectRiotBtn.disabled = true;
      
      // Complete the authentication flow
      await RiotAuth.authenticate(regionSelect.value);
      
      // Get user data
      const userData = await RiotAuth.getUserData();
      
      // Update UI with user data
      updateUserInterface(userData);
    } catch (error) {
      console.error('Error completing authentication:', error);
      showAuthError(getReadableErrorMessage(error));
    } finally {
      connectRiotBtn.disabled = false;
    }
  }

  /**
   * Get a user-friendly error message from error object
   * @param {Error} error - The error object
   * @returns {string} - A readable error message
   */
  function getReadableErrorMessage(error) {
    const message = error.message || 'Unknown error';
    
    if (message.includes('Security verification failed') || message.includes('State mismatch')) {
      return 'Security Verification Failed';
    } else if (message.includes('Authentication cancelled')) {
      return 'Authentication Cancelled';
    } else if (message.includes('Failed to exchange code')) {
      return 'Token Exchange Failed';
    } else if (message.includes('Failed to get auth URL')) {
      return 'Server Connection Error';
    }
    
    return 'Authentication Failed';
  }

  /**
   * Update the UI based on user data
   * @param {Object} userData - The user data object
   */
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
        
        // Show rank if available
        if (userData.rankInfo) {
          displayRank(userData.rankInfo);
        } else {
          currentRank.textContent = 'Unranked';
          rankBadgePreview.style.backgroundImage = `url('images/ranks/unranked.png')`;
        }
      } else {
        // Not connected
        riotConnectionStatus.textContent = 'Not Connected';
        riotConnectionStatus.classList.remove('connected');
        connectRiotBtn.textContent = 'Connect';
        
        // Reset rank display
        currentRank.textContent = 'Unknown';
        rankBadgePreview.style.backgroundImage = 'none';
      }
    } catch (error) {
      console.error('Error updating user interface:', error);
    }
  }

  /**
   * Show authentication error in the UI
   * @param {string} message - The error message to display
   */
  function showAuthError(message) {
    riotConnectionStatus.textContent = message || 'Authentication Failed';
    riotConnectionStatus.classList.add('error');
    connectRiotBtn.textContent = 'Connect';
    
    // Reset error state after 5 seconds
    setTimeout(() => {
      if (riotConnectionStatus.classList.contains('error')) {
        riotConnectionStatus.textContent = 'Not Connected';
        riotConnectionStatus.classList.remove('error');
      }
    }, 5000);
  }

  /**
   * Check if the user is currently authenticated
   */
  async function checkAuthStatus() {
    try {
      // Show loading state
      riotConnectionStatus.textContent = 'Checking...';
      
      // Check if user is authenticated
      const isAuthenticated = await RiotAuth.isAuthenticated();
      
      if (isAuthenticated) {
        // Get user data and update UI
        const userData = await RiotAuth.getUserData();
        updateUserInterface(userData);
      } else {
        // Not authenticated
        riotConnectionStatus.textContent = 'Not Connected';
        connectRiotBtn.textContent = 'Connect';
      }
      
      // Load saved region
      chrome.storage.local.get('selectedRegion', (result) => {
        if (result.selectedRegion) {
          regionSelect.value = result.selectedRegion;
        }
      });
    } catch (error) {
      console.error('Error checking auth status:', error);
      riotConnectionStatus.textContent = 'Not Connected';
    }
  }

  /**
   * Handle connect/disconnect button click
   */
  async function connectRiotAccount() {
    // Disable button during operation
    connectRiotBtn.disabled = true;
    
    try {
      // Check if we need to authenticate or disconnect
      const isAuthenticated = await RiotAuth.isAuthenticated();
      
      if (isAuthenticated) {
        // Disconnect flow
        connectRiotBtn.textContent = 'Disconnecting...';
        riotConnectionStatus.textContent = 'Disconnecting...';
        
        // Log out
        await RiotAuth.logout();
        
        // Update UI
        riotConnectionStatus.textContent = 'Not Connected';
        riotConnectionStatus.classList.remove('connected');
        connectRiotBtn.textContent = 'Connect';
        
        // Reset rank display
        currentRank.textContent = 'Unknown';
        rankBadgePreview.style.backgroundImage = 'none';
      } else {
        // Connect flow
        connectRiotBtn.textContent = 'Connecting...';
        riotConnectionStatus.textContent = 'Connecting...';
        riotConnectionStatus.classList.remove('error');
        
        // Get selected region
        const region = regionSelect.value;
        console.log('Connecting to Riot with region:', region);
        
        // Start authentication flow
        await RiotAuth.authenticate(region);
        
        // Get user data after authentication
        const userData = await RiotAuth.getUserData();
        
        // Update UI with user data
        updateUserInterface(userData);
      }
    } catch (error) {
      console.error('Authentication error:', error);
      showAuthError(getReadableErrorMessage(error));
    } finally {
      // Re-enable button
      connectRiotBtn.disabled = false;
    }
  }

  /**
   * Handle region selection change
   */
  function handleRegionChange() {
    const selectedRegion = regionSelect.value;
    chrome.storage.local.set({ selectedRegion });
  }

  /**
   * Display rank in the UI
   * @param {Object} rankData - The rank data object
   */
  function displayRank(rankData) {
    if (!rankData || !rankData.tier) {
      currentRank.textContent = 'Unranked';
      rankBadgePreview.style.backgroundImage = `url('images/ranks/unranked.png')`;
      rankBadgePreview.style.transform = 'translateY(-3px)';
      return;
    }
    
    // Format rank text
    let rankText = rankData.tier;
    if (rankData.division && !['Master', 'Grandmaster', 'Challenger'].includes(rankData.tier)) {
      rankText += ` ${rankData.division}`;
    }
    
    // Add LP if available
    if (rankData.leaguePoints !== undefined) {
      rankText += ` (${rankData.leaguePoints} LP)`;
    }
    
    currentRank.textContent = rankText;
    
    // Set rank badge image
    const rankImageFileName = rankData.tier.toLowerCase();
    rankBadgePreview.style.backgroundImage = `url('images/ranks/${rankImageFileName}.png')`;
    
    // Apply positioning based on rank
    const higherRanks = ['master', 'grandmaster', 'challenger'];
    rankBadgePreview.style.transform = higherRanks.includes(rankImageFileName) ? 'translateY(0)' : 'translateY(-3px)';
  }

  /**
   * Clear localStorage data
   */
  function clearLocalStorage() {
    try {
      // Clear Riot auth data
      localStorage.removeItem('eloward_riot_access_token');
      localStorage.removeItem('eloward_riot_refresh_token');
      localStorage.removeItem('eloward_riot_token_expiry');
      localStorage.removeItem('eloward_riot_tokens');
      localStorage.removeItem('eloward_riot_account_info');
      localStorage.removeItem('eloward_riot_summoner_info');
      localStorage.removeItem('eloward_riot_rank_info');
      localStorage.removeItem('eloward_auth_state');
      localStorage.removeItem('eloward_auth_callback_data');
      
      console.log('Cleared auth data from localStorage');
    } catch (e) {
      console.error('Error clearing localStorage:', e);
    }
  }
}); 