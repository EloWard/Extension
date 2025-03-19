// EloWard Popup Script
console.log('Popup script starting to load...');

// Import auth modules
import { RiotAuth } from './js/riotAuth.js';
import { TwitchAuth } from './js/twitchAuth.js';
import { PersistentStorage } from './js/persistentStorage.js';

try {
  document.addEventListener('DOMContentLoaded', () => {
    try {
      console.log('DOM content loaded, initializing popup...');
      console.log('TwitchAuth module loaded:', typeof TwitchAuth !== 'undefined');
      
      // Initialize persistent storage first thing
      PersistentStorage.init();
      
      // DOM elements
      const connectRiotBtn = document.getElementById('connect-riot');
      const riotConnectionStatus = document.getElementById('riot-connection-status');
      const currentRank = document.getElementById('current-rank');
      const rankBadgePreview = document.getElementById('rank-badge-preview');
      const regionSelect = document.getElementById('region');
      const refreshRankBtn = document.getElementById('refresh-rank');
      const connectTwitchBtn = document.getElementById('connect-twitch');
      const twitchConnectionStatus = document.getElementById('twitch-connection-status');
      
      // Check if all elements exist
      console.log('Element check - connect-twitch button exists:', !!connectTwitchBtn);
      
      // Flag to prevent recursive message handling
      let processingMessage = false;
      
      // Check authentication status on load
      checkAuthStatus();
      
      // Add direct click handler as a test
      if (connectTwitchBtn) {
        connectTwitchBtn.onclick = function() {
          console.log('Twitch button clicked via onclick property');
          connectTwitchAccount();
        };
      }
      
      // Set up event listeners
      connectRiotBtn.addEventListener('click', connectRiotAccount);
      if (connectTwitchBtn) {
        console.log('Adding click event listener to Twitch button');
        connectTwitchBtn.addEventListener('click', function(e) {
          console.log('Twitch button clicked via addEventListener');
          connectTwitchAccount();
        });
      } else {
        console.error('Could not find connect-twitch button');
      }
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
            hasState: !!event.data.state,
            service: event.data.service || 'riot'
          });
          
          // Determine the service type
          const serviceType = event.data.service || 'riot';
          
          // Create storage object with all needed keys
          const storageData = {
            'auth_callback': event.data,
            'eloward_auth_callback': event.data
          };
          
          // Add service-specific key
          if (serviceType === 'twitch') {
            storageData['twitch_auth_callback'] = event.data;
          } else {
            storageData['riot_auth_callback'] = event.data;
          }
          
          // Store in chrome.storage for retrieval by Auth services
          chrome.storage.local.set(storageData, () => {
            console.log(`Stored ${serviceType} auth callback data with keys:`, Object.keys(storageData));
            
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
       * Process authentication callback from auth services
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
            chrome.storage.local.set({ 'authCallbackProcessed': true }, resolve);
          });
          
          // Clean up after a short delay to allow any parallel processes to see it's been processed
          setTimeout(() => {
            chrome.storage.local.remove('authCallbackProcessed');
          }, 5000);
          
          // Check authentication status to update UI
          await checkAuthStatus();
        } catch (error) {
          console.error('Error processing auth callback:', error);
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
       * Check if the user is authenticated with Riot and Twitch
       * and update the UI accordingly
       */
      async function checkAuthStatus() {
        try {
          console.log('Checking auth status...');
          
          // First prioritize persistent storage for UI updates
          // This ensures immediate display of stored data
          const persistentConnectedState = await PersistentStorage.getConnectedState();
          console.log('Persistent connected state:', persistentConnectedState);
          
          let skipRiotAuthCheck = false;
          let skipTwitchAuthCheck = false;
          
          // Update Riot UI based on persistent storage
          if (persistentConnectedState.riot) {
            const storedRiotData = await PersistentStorage.getRiotUserData();
            if (storedRiotData) {
              console.log('Using stored Riot data for UI update');
              // Format data in the way updateUserInterface expects
              const formattedData = {
                ...storedRiotData,
                soloQueueRank: storedRiotData.rankInfo
              };
              updateUserInterface(formattedData);
              
              // Skip further Riot auth checks if we have persistent data
              // This eliminates unnecessary token validation that might fail
              console.log('Using persistent Riot data, skipping token validation');
              skipRiotAuthCheck = true;
            }
          }
          
          // Update Twitch UI based on persistent storage
          if (persistentConnectedState.twitch) {
            const storedTwitchData = await PersistentStorage.getTwitchUserData();
            if (storedTwitchData) {
              console.log('Using stored Twitch data for UI update');
              twitchConnectionStatus.textContent = `Connected (${storedTwitchData.display_name})`;
              twitchConnectionStatus.classList.add('connected');
              connectTwitchBtn.textContent = 'Disconnect';
              
              // Skip further Twitch auth checks
              console.log('Using persistent Twitch data, skipping token validation');
              skipTwitchAuthCheck = true;
            }
          }
          
          // Only check Riot auth status if no persistent data
          if (!skipRiotAuthCheck) {
            console.log('No persistent Riot data, checking token auth');
            const isRiotAuthenticated = await RiotAuth.isAuthenticated();
            
            if (isRiotAuthenticated) {
              // Update UI to show connected
              riotConnectionStatus.textContent = 'Connected';
              riotConnectionStatus.classList.add('connected');
              connectRiotBtn.textContent = 'Disconnect';
              
              // Get user data
              const userData = await RiotAuth.getUserData();
              
              // Update UI with user data
              updateUserInterface(userData);
            } else {
              // Update UI to show not connected
              riotConnectionStatus.textContent = 'Not Connected';
              riotConnectionStatus.classList.remove('connected');
              connectRiotBtn.textContent = 'Connect';
            }
          }
          
          // Only check Twitch auth status if no persistent data
          if (!skipTwitchAuthCheck) {
            console.log('No persistent Twitch data, checking token auth');
            const isTwitchAuthenticated = await TwitchAuth.isAuthenticated();
            
            if (isTwitchAuthenticated) {
              // Update UI to show connected
              twitchConnectionStatus.textContent = 'Connected';
              twitchConnectionStatus.classList.add('connected');
              connectTwitchBtn.textContent = 'Disconnect';
              
              // Optionally, get user display name
              const userInfo = await TwitchAuth.getUserInfo();
              if (userInfo && userInfo.display_name) {
                twitchConnectionStatus.textContent = `Connected (${userInfo.display_name})`;
              }
            } else {
              // Update UI to show not connected
              twitchConnectionStatus.textContent = 'Not Connected';
              twitchConnectionStatus.classList.remove('connected');
              connectTwitchBtn.textContent = 'Connect';
            }
          }
        } catch (error) {
          console.error('Error checking auth status:', error);
        }
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
            // Check both soloQueueRank (from API) and rankInfo (from storage)
            const rankData = userData.soloQueueRank || userData.rankInfo;
            if (rankData) {
              displayRank(rankData);
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
       * Clear local storage data
       */
      function clearLocalStorage() {
        try {
          console.log('Clearing local storage...');
          
          // Clear auth-related data
          localStorage.removeItem('eloward_auth_callback_data');
          localStorage.removeItem('eloward_riot_tokens');
          localStorage.removeItem('eloward_riot_account_info');
          localStorage.removeItem('eloward_riot_summoner_info');
          localStorage.removeItem('eloward_riot_rank_info');
          localStorage.removeItem('eloward_twitch_tokens');
          localStorage.removeItem('eloward_twitch_user_info');
          
          // Clear persistent storage data
          PersistentStorage.clearAllData();
          
          console.log('Local storage cleared');
        } catch (error) {
          console.error('Error clearing local storage:', error);
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

      /**
       * Connect Twitch account
       */
      async function connectTwitchAccount() {
        console.log('connectTwitchAccount function called');
        
        // Disable button during operation
        if (connectTwitchBtn) connectTwitchBtn.disabled = true;
        
        try {
          console.log('TwitchAuth object:', Object.keys(TwitchAuth));
          
          // Check if we need to authenticate or disconnect
          console.log('Checking if authenticated with Twitch...');
          const isAuthenticated = await TwitchAuth.isAuthenticated();
          console.log('Twitch authenticated:', isAuthenticated);
          
          if (isAuthenticated) {
            // Disconnect flow
            connectTwitchBtn.textContent = 'Disconnecting...';
            twitchConnectionStatus.textContent = 'Disconnecting...';
            
            // Log out
            await TwitchAuth.logout();
            
            // Update UI
            twitchConnectionStatus.textContent = 'Not Connected';
            twitchConnectionStatus.classList.remove('connected');
            connectTwitchBtn.textContent = 'Connect';
          } else {
            // Connect flow
            connectTwitchBtn.textContent = 'Connecting...';
            twitchConnectionStatus.textContent = 'Connecting...';
            twitchConnectionStatus.classList.remove('error');
            
            // Start authentication flow
            const userData = await TwitchAuth.authenticate();
            
            // Update UI
            twitchConnectionStatus.textContent = 'Connected';
            if (userData && userData.display_name) {
              twitchConnectionStatus.textContent = `Connected (${userData.display_name})`;
            }
            twitchConnectionStatus.classList.add('connected');
            connectTwitchBtn.textContent = 'Disconnect';
          }
        } catch (error) {
          console.error('Twitch authentication error:', error);
          console.error('Error stack:', error.stack);
          
          // Show error in UI
          if (twitchConnectionStatus) {
            twitchConnectionStatus.textContent = 'Connection Error';
            twitchConnectionStatus.classList.add('error');
          }
        } finally {
          // Re-enable button
          if (connectTwitchBtn) {
            connectTwitchBtn.disabled = false;
            connectTwitchBtn.textContent = 'Connect';
          }
        }
      }
    } catch (initError) {
      console.error('Error initializing popup:', initError);
      console.error('Error stack:', initError.stack);
    }
  });
} catch (importError) {
  console.error('Error importing modules:', importError);
  console.error('Error stack:', importError.stack);
} 