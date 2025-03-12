// EloWard Popup Script
import { RiotAuth } from './js/riotAuth.js';

document.addEventListener('DOMContentLoaded', () => {
  // DOM elements
  const connectRiotBtn = document.getElementById('connect-riot');
  const riotConnectionStatus = document.getElementById('riot-connection-status');
  const currentRank = document.getElementById('current-rank');
  const rankBadgePreview = document.getElementById('rank-badge-preview');
  const regionSelect = document.getElementById('region');
  const refreshRankBtn = document.getElementById('refresh-rank');

  // Flag to prevent recursive message handling
  let processingMessage = false;

  // Check authentication status on load
  checkAuthStatus();

  // Set up event listeners
  connectRiotBtn.addEventListener('click', connectRiotAccount);
  regionSelect.addEventListener('change', handleRegionChange);
  refreshRankBtn.addEventListener('click', refreshRank);
  
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
   * Process authentication callback from Riot
   * @param {Object} authData - The authentication data
   * @returns {Promise<void>}
   */
  async function processAuthCallback(authData) {
    try {
      console.log('Processing auth callback with data:', typeof authData === 'object' ? 
        { hasCode: !!authData.code, hasState: !!authData.state } : 
        typeof authData);
        
      // Check if this callback has already been processed
      const alreadyProcessed = await new Promise(resolve => {
        chrome.storage.local.get('authCallbackProcessed', (result) => {
          resolve(result.authCallbackProcessed === true);
        });
      });
      
      if (alreadyProcessed) {
        console.log('Auth callback has already been processed, ignoring duplicate');
        return;
      }
      
      // Mark callback as being processed to prevent duplicates
      await new Promise(resolve => {
        chrome.storage.local.set({ authCallbackProcessed: true }, resolve);
      });
      
      // Add a timeout to clear the processed flag after 5 minutes
      setTimeout(() => {
        chrome.storage.local.remove('authCallbackProcessed', () => {
          console.log('Cleared auth callback processed flag');
        });
      }, 5 * 60 * 1000);
      
      // Validate auth data
      if (!authData || typeof authData !== 'object') {
        showError('Auth data is missing or invalid');
        return;
      }
      
      if (!authData.code) {
        showError('Auth code is missing from the callback');
        return;
      }
      
      // Store the callback data to be processed by background script
      await new Promise(resolve => {
        chrome.storage.local.set({ authCallback: authData }, resolve);
      });
      
      // Show loading state
      document.getElementById('connect-btn').innerHTML = 'Connecting...';
      document.getElementById('connect-btn').disabled = true;
      
      try {
        // Initialize RiotAuth
        const riotAuth = new RiotAuth(riotConfig);
        
        // Wait for token exchange to complete
        await new Promise((resolve, reject) => {
          const checkTokens = async () => {
            try {
              const isAuthenticated = await riotAuth.isAuthenticated();
              if (isAuthenticated) {
                console.log('Successfully authenticated with Riot');
                resolve();
              } else {
                // Check again in a second
                setTimeout(checkTokens, 1000);
              }
            } catch (error) {
              reject(error);
            }
          };
          
          // Start checking
          checkTokens();
          
          // Add a timeout after 20 seconds
          setTimeout(() => {
            reject(new Error('Timed out waiting for token exchange'));
          }, 20000);
        });
        
        // Get user data after successful authentication
        const userData = await riotAuth.getUserData();
        
        console.log('Received user data:', userData);
        
        // Update UI with user data
        document.getElementById('status').classList.remove('hidden');
        document.getElementById('summoner-name').innerText = userData.summonerName || 'Unknown';
        document.getElementById('summoner-level').innerText = userData.summonerLevel || 'N/A';
        
        const rankDisplay = document.getElementById('rank-display');
        rankDisplay.classList.remove('hidden');
        
        if (userData.rankInfo) {
          const { tier, rank: division, leaguePoints } = userData.rankInfo;
          document.getElementById('rank-tier').innerText = tier || 'Unranked';
          document.getElementById('rank-division').innerText = division || '';
          document.getElementById('rank-lp').innerText = leaguePoints !== undefined ? `${leaguePoints} LP` : '';
          
          // Update rank badge image
          const rankBadgePreview = document.getElementById('rankBadgePreview');
          if (rankBadgePreview) {
            const tierLower = tier ? tier.toLowerCase() : 'unranked';
            rankBadgePreview.src = `../images/ranks/${tierLower}.png`;
          }
        } else {
          document.getElementById('rank-tier').innerText = 'Unranked';
          document.getElementById('rank-division').innerText = '';
          document.getElementById('rank-lp').innerText = '';
          
          // Set to unranked image
          const rankBadgePreview = document.getElementById('rankBadgePreview');
          if (rankBadgePreview) {
            rankBadgePreview.src = '../images/ranks/unranked.png';
          }
        }
        
        // Update button state
        document.getElementById('connect-btn').innerHTML = 'Refresh';
        document.getElementById('connect-btn').disabled = false;
        
      } catch (error) {
        console.error('Error processing authentication:', error);
        
        // Show error to user
        showError(getReadableErrorMessage(error));
        
        // Reset button state
        document.getElementById('connect-btn').innerHTML = 'Connect';
        document.getElementById('connect-btn').disabled = false;
        
        // Clean up auth callback processing flag
        chrome.storage.local.remove('authCallbackProcessed');
      }
    } catch (error) {
      console.error('Error in processAuthCallback:', error);
      showError('Failed to process auth callback: ' + getReadableErrorMessage(error));
      
      // Reset button state
      document.getElementById('connect-btn').innerHTML = 'Connect';
      document.getElementById('connect-btn').disabled = false;
      
      // Clean up auth callback processing flag
      chrome.storage.local.remove('authCallbackProcessed');
    }
  }

  /**
   * Get a readable error message from an error object
   * @param {Error|string} error - The error object or string
   * @returns {string} - User-friendly error message
   */
  function getReadableErrorMessage(error) {
    if (!error) return 'Unknown error occurred';
    
    const errorMessage = error.message || (typeof error === 'string' ? error : JSON.stringify(error));
    
    // Common error messages and their user-friendly versions
    const errorMappings = {
      'Failed to fetch': 'Connection error. Please check your internet connection and try again.',
      'NetworkError': 'Network error. Please check your internet connection and try again.',
      'Not Found': 'Resource not found. Please try again later.',
      'No access token': 'Authentication token missing. Please reconnect your Riot account.',
      'state parameter mismatch': 'Security verification failed. Please try again.',
      'popup blocked': 'Authentication popup was blocked. Please allow popups for this site.',
      'code exchange failed': 'Authentication server error. Please try again later.',
      'Invalid token': 'Your authentication has expired. Please reconnect your Riot account.',
      'storage': 'Extension storage error. Please reload the extension.',
      'extension': 'Extension error. Please reload the extension.'
    };
    
    // Check for common error patterns
    for (const [pattern, friendlyMessage] of Object.entries(errorMappings)) {
      if (errorMessage.toLowerCase().includes(pattern.toLowerCase())) {
        return friendlyMessage;
      }
    }
    
    // If the error message is very long, truncate it
    if (errorMessage.length > 150) {
      return `Error: ${errorMessage.substring(0, 147)}...`;
    }
    
    // Default format: "Error: message"
    return `Error: ${errorMessage}`;
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
        
        // Show refresh button
        refreshRankBtn.style.display = 'flex';
      } else {
        // Not connected
        riotConnectionStatus.textContent = 'Not Connected';
        riotConnectionStatus.classList.remove('connected');
        connectRiotBtn.textContent = 'Connect';
        
        // Reset rank display
        currentRank.textContent = 'Unknown';
        rankBadgePreview.style.backgroundImage = 'none';
        
        // Hide refresh button
        refreshRankBtn.style.display = 'none';
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
      
      // Log detailed error message for debugging
      const detailedError = error.message || (typeof error === 'string' ? error : JSON.stringify(error));
      console.log('Detailed error:', detailedError);
      
      // Handle specific error cases
      if (detailedError.includes('storage.remove')) {
        // This is likely the storage API error
        showAuthError('Extension storage error. Please reload the extension and try again.');
      } else if (detailedError.includes('Failed to fetch') || detailedError.includes('NetworkError')) {
        // Network-related errors
        showAuthError('Network error. Please check your internet connection and try again.');
      } else if (detailedError.includes('Authentication cancelled')) {
        // User closed the auth window
        showAuthError('Authentication was cancelled. Please try again.');
      } else if (detailedError.includes('state parameter mismatch')) {
        // CSRF protection triggered
        showAuthError('Security verification failed. Please clear your browsing data and try again.');
      } else {
        // Generic fallback error message
        showAuthError(getReadableErrorMessage(error));
      }
    } finally {
      // Re-enable button
      connectRiotBtn.disabled = false;
      connectRiotBtn.textContent = 'Connect';
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

  /**
   * Refreshes the user's rank by triggering a new rank data fetch
   */
  async function refreshRank() {
    try {
      // Show loading state
      refreshRankBtn.classList.add('loading');
      refreshRankBtn.disabled = true;
      currentRank.textContent = 'Refreshing...';
      
      console.log('Manually refreshing rank data...');
      
      // Get stored summoner info
      const summonerInfo = await new Promise(resolve => {
        chrome.storage.local.get(RiotAuth.config.storageKeys.summonerInfo, (result) => {
          resolve(result[RiotAuth.config.storageKeys.summonerInfo]);
        });
      });
      
      if (!summonerInfo || !summonerInfo.id) {
        throw new Error('Summoner information not found');
      }
      
      // Fetch fresh rank data
      const rankData = await RiotAuth.getRankInfo(summonerInfo.id);
      
      // Process rank data for display
      const processedRankData = processRankData(rankData);
      
      // Update UI with new rank
      displayRank(processedRankData);
      
      console.log('Rank refreshed successfully');
    } catch (error) {
      console.error('Failed to refresh rank:', error);
      currentRank.textContent = 'Refresh failed';
      
      // Reset after 3 seconds
      setTimeout(() => {
        // Restore previous rank display
        checkAuthStatus();
      }, 3000);
    } finally {
      // Remove loading state
      refreshRankBtn.classList.remove('loading');
      refreshRankBtn.disabled = false;
    }
  }

  /**
   * Process rank data to find the Solo/Duo queue rank
   * @param {Array} rankData - Array of league entries
   * @returns {Object|null} - Processed rank data for display
   */
  function processRankData(rankData) {
    if (!rankData || !Array.isArray(rankData) || rankData.length === 0) {
      return null;
    }
    
    // Find Solo/Duo queue rank
    const soloQueueRank = rankData.find(entry => entry.queueType === 'RANKED_SOLO_5x5');
    
    if (soloQueueRank) {
      return {
        tier: soloQueueRank.tier,
        division: soloQueueRank.rank,
        leaguePoints: soloQueueRank.leaguePoints,
        wins: soloQueueRank.wins,
        losses: soloQueueRank.losses
      };
    }
    
    return null;
  }
}); 