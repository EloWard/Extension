// EloWard Popup Script
import { EloWardConfig } from './config.js';
import { RiotAuth } from './riotAuth.js';
import { TwitchAuth } from './twitchAuth.js';
import { PersistentStorage } from './persistentStorage.js';

document.addEventListener('DOMContentLoaded', () => {
  // DOM elements
  const connectRiotBtn = document.getElementById('connect-riot');
  const riotConnectionStatus = document.getElementById('riot-connection-status');
  const currentRank = document.getElementById('current-rank');
  const rankBadgePreview = document.getElementById('rank-badge-preview');
  const regionSelect = document.getElementById('region');
  const refreshRankBtn = document.getElementById('refresh-rank');
  const streamerHeader = document.getElementById('streamer-header');
  const streamerContent = document.getElementById('streamer-content');
  const dropdownArrow = streamerHeader.querySelector('.dropdown-arrow');
  const connectTwitchBtn = document.getElementById('connect-twitch');
  const twitchConnectionStatus = document.getElementById('twitch-connection-status');
  
  console.log('TwitchAuth module loaded:', typeof TwitchAuth !== 'undefined');
  console.log('Element check - connect-twitch button exists:', !!connectTwitchBtn);

  // Initialize persistent storage
  PersistentStorage.init();
  console.log('Persistent storage initialized');

  // Initialize the streamer dropdown with proper styling 
  streamerContent.style.display = 'none';
  dropdownArrow.textContent = '▼';

  // Check authentication status
  checkAuthStatus();

  // Event Listeners
  connectRiotBtn.addEventListener('click', connectRiotAccount);
  regionSelect.addEventListener('change', handleRegionChange);
  refreshRankBtn.addEventListener('click', refreshRank);
  
  // Add event listener for Twitch connect button
  if (connectTwitchBtn) {
    console.log('Adding click event listener to Twitch connect button');
    connectTwitchBtn.addEventListener('click', connectTwitchAccount);
  } else {
    console.error('Could not find connect-twitch button');
  }
  
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
    
    // Handle clear_local_storage message (kept for backward compatibility)
    if (message.action === 'clear_local_storage') {
      console.log('Received clear_local_storage message (deprecated)');
      // No action needed as we only use chrome.storage.local now
      sendResponse({ success: true });
    }
    
    return true; // Keep the message channel open for async response
  });

  // Process auth callback from various sources
  async function processAuthCallback(params) {
    try {
      console.log('Processing auth callback with params:', params);
      
      // Store the auth callback data in chrome.storage for processing by authenticator
      await new Promise(resolve => {
        chrome.storage.local.set({ 'auth_callback': { code: params.code, state: params.state } }, resolve);
        chrome.storage.local.set({ 'eloward_auth_callback': { code: params.code, state: params.state } }, resolve);
      });
      
      console.log('Stored auth callback in chrome.storage, completing auth flow');
      
      // Attempt to retrieve user data, but don't show errors to the user during this process
      try {
        const userData = await RiotAuth.getUserData(true);
        await updateUserInterface(userData);
      } catch (error) {
        console.log('Error completing auth after callback:', error);
        // Don't display this error to the user - we'll rely on the main authentication flow to handle it
      }
    } catch (error) {
      console.error('Error processing auth callback:', error);
      // Only show error if the connection button isn't in a "connecting" state
      if (!riotConnectionStatus.classList.contains('connecting')) {
        showAuthError(error.message || 'Failed to process authentication');
      }
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
      console.log('Checking auth status...');
      
      // First check persistent storage for connected states
      const persistentConnectedState = await PersistentStorage.getConnectedState();
      console.log('Persistent connected state:', persistentConnectedState);
      
      // If Riot is connected in persistent storage, display that data immediately
      if (persistentConnectedState.riot) {
        const storedRiotData = await PersistentStorage.getRiotUserData();
        if (storedRiotData) {
          console.log('Using Riot data from persistent storage for initial UI display');
          // Adapt stored data to match the format expected by updateUserInterface
          const userData = {
            gameName: storedRiotData.gameName,
            tagLine: storedRiotData.tagLine,
            puuid: storedRiotData.puuid,
            soloQueueRank: storedRiotData.rankInfo
          };
          updateUserInterface(userData);
        }
      }
      
      // If Twitch is connected in persistent storage, display that data immediately
      if (persistentConnectedState.twitch) {
        const storedTwitchData = await PersistentStorage.getTwitchUserData();
        if (storedTwitchData) {
          console.log('Using Twitch data from persistent storage for initial UI display');
          twitchConnectionStatus.textContent = storedTwitchData.display_name || storedTwitchData.login;
          twitchConnectionStatus.classList.add('connected');
          connectTwitchBtn.textContent = 'Disconnect';
        }
      }
      
      // Now perform standard authentication checks to validate tokens
      // This ensures we verify that the stored tokens are still valid
      
      // Check if user is authenticated with Riot
      const isAuthenticated = await RiotAuth.isAuthenticated();
      
      if (isAuthenticated) {
        console.log('User is authenticated according to RiotAuth module');
        
        try {
          // Get all user data
          const userData = await RiotAuth.getUserData();
          updateUserInterface(userData);
          
          // Update persistent storage with latest data
          await PersistentStorage.storeRiotUserData(userData);
        } catch (error) {
          console.error('Error getting user data from RiotAuth:', error);
          
          // If we already displayed data from persistent storage, keep it
          if (!persistentConnectedState.riot) {
            // Fallback to chrome.storage only if no persistent data was shown
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
        }
      } else if (!persistentConnectedState.riot) {
        // Only show not connected UI if we haven't already displayed data from persistent storage
        showNotConnectedUI();
        
        // Set region from storage if available
        chrome.storage.local.get(['selectedRegion'], (result) => {
          if (result.selectedRegion) {
            regionSelect.value = result.selectedRegion;
          }
        });
      }
      
      // Check Twitch authentication status
      try {
        console.log('Checking Twitch authentication status...');
        const isTwitchAuthenticated = await TwitchAuth.isAuthenticated();
        console.log('Twitch auth status:', isTwitchAuthenticated);
        
        if (isTwitchAuthenticated) {
          // User is authenticated with Twitch, update UI
          const userData = await TwitchAuth.getUserInfo();
          const displayName = userData?.display_name || userData?.login || 'Connected';
          twitchConnectionStatus.textContent = displayName;
          twitchConnectionStatus.classList.add('connected');
          twitchConnectionStatus.classList.remove('connecting', 'disconnecting', 'error');
          connectTwitchBtn.textContent = 'Disconnect';
          
          // Update persistent storage with latest data if available
          try {
            if (userData) {
              await PersistentStorage.storeTwitchUserData(userData);
            }
          } catch (error) {
            console.warn('Could not get Twitch user info for storage:', error);
          }
        } else if (!persistentConnectedState.twitch) {
          // Only update UI if we haven't already displayed data from persistent storage
          twitchConnectionStatus.textContent = 'Not Connected';
          twitchConnectionStatus.classList.remove('connected', 'connecting', 'disconnecting', 'error');
          connectTwitchBtn.textContent = 'Connect';
        }
      } catch (twitchError) {
        console.error('Error checking Twitch auth status:', twitchError);
        if (!persistentConnectedState.twitch) {
          // Only update UI if we haven't already displayed data from persistent storage
          twitchConnectionStatus.textContent = 'Not Connected';
          twitchConnectionStatus.classList.remove('connected', 'connecting', 'disconnecting', 'error');
          connectTwitchBtn.textContent = 'Connect';
        }
      }
      
    } catch (error) {
      console.error('Error checking auth status:', error);
      showNotConnectedUI();
    }
  }

  // Helper function to show the not connected UI state
  function showNotConnectedUI() {
    // Reset Riot connection UI
    riotConnectionStatus.textContent = 'Not Connected';
    riotConnectionStatus.classList.remove('connected', 'connecting', 'disconnecting', 'error');
    connectRiotBtn.textContent = 'Connect';
    connectRiotBtn.disabled = false;
    
    // Reset Twitch connection UI
    twitchConnectionStatus.textContent = 'Not Connected';
    twitchConnectionStatus.classList.remove('connected', 'connecting', 'disconnecting', 'error');
    connectTwitchBtn.textContent = 'Connect';
    connectTwitchBtn.disabled = false;
    
    // Reset rank display and show unranked graphic
    currentRank.textContent = 'Unranked';
    rankBadgePreview.style.backgroundImage = `url('../images/ranks/unranked.png')`;
    rankBadgePreview.style.transform = 'translateY(-3px)';
  }

  async function connectRiotAccount() {
    // Disable button during operation
    connectRiotBtn.disabled = true;
    
    try {
      // Store current UI state to determine actual intent
      const isCurrentlyConnected = riotConnectionStatus.classList.contains('connected');
      
      // Only check authentication if we think we're connected
      // This prevents the disconnect flow from running when already disconnected
      if (isCurrentlyConnected) {
        // Check if we need to authenticate or disconnect using the proper auth check
        const isAuthenticated = await RiotAuth.isAuthenticated(true);
        
        if (isAuthenticated) {
          // Disconnect flow
          // Show loading state
          connectRiotBtn.textContent = 'Disconnecting...';
          riotConnectionStatus.textContent = 'Disconnecting...';
          riotConnectionStatus.classList.add('disconnecting');
          
          try {
            // Clear persistent storage data for Riot before logout
            await PersistentStorage.clearServiceData('riot');
            console.log('Cleared Riot persistent storage data during disconnect');
            
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
          return; // Exit the function after disconnect flow
        }
      }
      
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
        
        // Store user data in persistent storage
        await PersistentStorage.storeRiotUserData(userData);
        console.log('Stored Riot user data in persistent storage during connect');
        
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

  // Refresh rank function to update player rank information
  async function refreshRank() {
    try {
      console.log('Refreshing rank information...');
      
      // First check if the user is authenticated
      const isAuthenticated = await RiotAuth.isAuthenticated();
      if (!isAuthenticated) {
        console.log('User is not authenticated, cannot refresh rank');
        showAuthError('Please connect your account first');
        return;
      }
      
      // Show a loading state on the button (add a rotating animation class)
      refreshRankBtn.classList.add('refreshing');
      
      // Get stored account/summoner info first
      const accountInfo = await RiotAuth.getAccountInfo();
      
      if (!accountInfo || !accountInfo.puuid) {
        throw new Error('Account information not available');
      }
      
      // Get summoner info using the puuid
      const summonerInfo = await RiotAuth.getSummonerInfo(accountInfo.puuid);
      
      if (!summonerInfo || !summonerInfo.id) {
        throw new Error('Summoner information not available');
      }
      
      // Force a fresh rank lookup by explicitly calling getRankInfo
      const rankEntries = await RiotAuth.getRankInfo(summonerInfo.id);
      
      // Get the freshly updated user data
      const userData = await RiotAuth.getUserData(true);
      
      // Update the UI with the fresh data
      updateUserInterface(userData);
      
      // Update persistent storage with the fresh user data including new rank
      await PersistentStorage.storeRiotUserData(userData);
      console.log('Updated persistent storage with refreshed rank information');
      
      console.log('Rank information successfully refreshed');
    } catch (error) {
      console.error('Error refreshing rank:', error);
      
      // Show error briefly on the rank text
      const originalText = currentRank.textContent;
      currentRank.textContent = 'Refresh failed';
      
      // Reset to original text after a short delay
      setTimeout(() => {
        currentRank.textContent = originalText;
      }, 3000);
    } finally {
      // Remove the loading state
      refreshRankBtn.classList.remove('refreshing');
    }
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
  
  // Function to handle Twitch account connection and disconnection
  async function connectTwitchAccount() {
    console.log('connectTwitchAccount function called');
    
    // Check if TwitchAuth is available
    if (typeof TwitchAuth === 'undefined') {
      console.error('TwitchAuth module is not loaded properly');
      twitchConnectionStatus.textContent = 'Error: Module not loaded';
      twitchConnectionStatus.classList.add('error');
      return;
    }
    
    console.log('TwitchAuth object:', Object.keys(TwitchAuth));
    
    try {
      // Check if user is already authenticated
      const isAuthenticated = await TwitchAuth.isAuthenticated();
      console.log('Twitch auth status:', isAuthenticated);
      
      if (isAuthenticated) {
        // Disconnect flow
        twitchConnectionStatus.textContent = 'Disconnecting...';
        twitchConnectionStatus.classList.add('disconnecting');
        twitchConnectionStatus.classList.remove('connected', 'connecting', 'error');
        connectTwitchBtn.textContent = 'Disconnecting...';
        connectTwitchBtn.disabled = true;
        
        // Clear persistent storage data for Twitch before logout
        await PersistentStorage.clearServiceData('twitch');
        console.log('Cleared Twitch persistent storage data during disconnect');
        
        await TwitchAuth.logout();
        
        // Update UI after logout
        twitchConnectionStatus.textContent = 'Not Connected';
        connectTwitchBtn.textContent = 'Connect';
        twitchConnectionStatus.classList.remove('connected', 'connecting', 'disconnecting');
      } else {
        // Connect flow
        twitchConnectionStatus.textContent = 'Connecting...';
        twitchConnectionStatus.classList.add('connecting');
        twitchConnectionStatus.classList.remove('connected', 'disconnecting', 'error');
        connectTwitchBtn.textContent = 'Connecting...';
        connectTwitchBtn.disabled = true;
        
        try {
          const userData = await TwitchAuth.authenticate();
          console.log('Twitch authentication successful:', userData);
          
          // Store user data in persistent storage
          await PersistentStorage.storeTwitchUserData(userData);
          console.log('Stored Twitch user data in persistent storage during connect');
          
          // Update UI with user data
          if (userData && (userData.display_name || userData.login)) {
            twitchConnectionStatus.textContent = userData.display_name || userData.login;
            twitchConnectionStatus.classList.add('connected');
            twitchConnectionStatus.classList.remove('connecting');
            connectTwitchBtn.textContent = 'Disconnect';
          } else {
            throw new Error('Invalid user data received');
          }
        } catch (authError) {
          console.error('Twitch authentication error:', authError);
          twitchConnectionStatus.textContent = authError.message || 'Authentication Failed';
          twitchConnectionStatus.classList.add('error');
          twitchConnectionStatus.classList.remove('connecting');
          connectTwitchBtn.textContent = 'Connect';
          
          // Reset error after 5 seconds
          setTimeout(() => {
            if (twitchConnectionStatus.classList.contains('error')) {
              twitchConnectionStatus.textContent = 'Not Connected';
              twitchConnectionStatus.classList.remove('error');
            }
          }, 5000);
        }
      }
    } catch (error) {
      console.error('Error in connectTwitchAccount:', error);
      twitchConnectionStatus.textContent = error.message || 'Error';
      twitchConnectionStatus.classList.add('error');
      twitchConnectionStatus.classList.remove('connecting', 'disconnecting');
    } finally {
      connectTwitchBtn.disabled = false;
    }
  }
}); 