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

  // Helper function to disable/enable Riot controls
  function setRiotControlsDisabled(isDisabled) {
    connectRiotBtn.disabled = isDisabled;
    regionSelect.disabled = isDisabled;
  }

  // Initialize persistent storage
  PersistentStorage.init();
  console.log('Persistent storage initialized');

  // Initialize the streamer dropdown with proper styling 
  streamerContent.style.display = 'none';
  dropdownArrow.textContent = '▼';

  // Disable Riot controls initially
  setRiotControlsDisabled(true);

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
        resolve();
      });
      
      console.log('Stored auth callback in chrome.storage, connection flow will handle data retrieval');
      
      // We don't automatically retrieve user data here anymore
      // The connect button flow will handle this when explicitly triggered by the user
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
        refreshRankBtn.classList.remove('hidden'); // Show refresh button
        
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
          rankBadgePreview.style.backgroundImage = `url('https://eloward-cdn.unleashai.workers.dev/lol/unranked.png')`;
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
          refreshRankBtn.classList.remove('hidden'); // Show refresh button
          
          // Get the connected region from storage and update the selector
          chrome.storage.local.get(['selectedRegion'], (result) => {
            if (result.selectedRegion) {
              console.log('Setting region selector to connected region:', result.selectedRegion);
              regionSelect.value = result.selectedRegion;
            }
          });
        }
      } else {
        // Show not connected UI for Riot
        console.log('No Riot data in persistent storage, showing not connected UI');
        riotConnectionStatus.textContent = 'Not Connected';
        riotConnectionStatus.classList.remove('connected', 'connecting', 'disconnecting', 'error');
        connectRiotBtn.textContent = 'Connect';
        connectRiotBtn.disabled = false;
        currentRank.textContent = 'Unknown';
        rankBadgePreview.style.backgroundImage = 'none';
        refreshRankBtn.classList.add('hidden'); // Hide refresh button
        
        // Reset rank display and show unranked graphic
        currentRank.textContent = 'Unranked';
        rankBadgePreview.style.backgroundImage = `url('https://eloward-cdn.unleashai.workers.dev/lol/unranked.png')`;
        rankBadgePreview.style.transform = 'translateY(-3px)';
        
        // Set region from storage if available
        chrome.storage.local.get(['selectedRegion'], (result) => {
          if (result.selectedRegion) {
            regionSelect.value = result.selectedRegion;
          }
        });
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
      
      // Check Twitch authentication status
      try {
        console.log('Checking Twitch authentication status...');
        const isTwitchAuthenticated = await TwitchAuth.isAuthenticated();
        console.log('Twitch auth status:', isTwitchAuthenticated);
        
        let isTwitchConnected = false;
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
          isTwitchConnected = true; // Mark as connected based on live check
        } else if (!persistentConnectedState.twitch) {
          // Only update UI if we haven't already displayed data from persistent storage
          twitchConnectionStatus.textContent = 'Not Connected';
          twitchConnectionStatus.classList.remove('connected', 'connecting', 'disconnecting', 'error');
          connectTwitchBtn.textContent = 'Connect';
          isTwitchConnected = false; // Mark as not connected based on live check failure
        }
        
        // Enable/disable Riot controls based on Twitch status
        setRiotControlsDisabled(!isTwitchConnected);
        
      } catch (twitchError) {
        console.error('Error checking Twitch auth status:', twitchError);
        if (!persistentConnectedState.twitch) {
          // Only update UI if we haven't already displayed data from persistent storage
          twitchConnectionStatus.textContent = 'Not Connected';
          twitchConnectionStatus.classList.remove('connected', 'connecting', 'disconnecting', 'error');
          connectTwitchBtn.textContent = 'Connect';
          isTwitchConnected = false; // Mark as not connected based on live check failure
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
    riotConnectionStatus.classList.remove('connected', 'error', 'connecting');
    connectRiotBtn.textContent = 'Connect';
    connectRiotBtn.disabled = false;
    currentRank.textContent = 'Unknown';
    rankBadgePreview.style.backgroundImage = 'none';
    refreshRankBtn.classList.add('hidden'); // Hide refresh button
    
    // Reset Twitch connection UI
    twitchConnectionStatus.textContent = 'Not Connected';
    twitchConnectionStatus.classList.remove('connected', 'connecting', 'disconnecting', 'error');
    connectTwitchBtn.textContent = 'Connect';
    connectTwitchBtn.disabled = false;
    
    // Reset rank display and show unranked graphic
    currentRank.textContent = 'Unranked';
    rankBadgePreview.style.backgroundImage = `url('https://eloward-cdn.unleashai.workers.dev/lol/unranked.png')`;
    rankBadgePreview.style.transform = 'translateY(-3px)';
    setRiotControlsDisabled(true); // Ensure Riot controls are disabled
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
            rankBadgePreview.style.backgroundImage = `url('https://eloward-cdn.unleashai.workers.dev/lol/unranked.png')`;
            rankBadgePreview.style.transform = 'translateY(-3px)';
            refreshRankBtn.classList.add('hidden'); // Hide refresh button on disconnect
            
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
        
        // Store the connected region in storage and ensure the region selector reflects the current region
        await chrome.storage.local.set({ selectedRegion: region });
        console.log('Stored region in storage:', region);
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
    console.log('Region preference saved:', selectedRegion);
    // Region change should not trigger a refresh - only store the preference for next connection
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
      refreshRankBtn.disabled = true; // Disable button while refreshing
      
      // Get stored account/summoner info first
      const accountInfo = await RiotAuth.getAccountInfo();
      
      if (!accountInfo || !accountInfo.puuid) {
        throw new Error('Account information not available');
      }
      
      // Get the current selected region
      const selectedRegion = regionSelect.value;
      console.log('Using selected region during refresh:', selectedRegion);
      
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
      
      // Update rank in the database
      try {
        // Get current Twitch username
        const twitchData = await new Promise(resolve => {
          chrome.storage.local.get(['eloward_persistent_twitch_user_data', 'twitchUsername'], resolve);
        });
        
        const twitchUsername = twitchData.eloward_persistent_twitch_user_data?.login || twitchData.twitchUsername;
        
        if (twitchUsername && userData.soloQueueRank) {
          console.log('Uploading updated rank data to database for:', twitchUsername);
          
          // Import RankAPI
          const { RankAPI } = await import('./rankAPI.js');
          
          // Format rank data for upload
          const rankData = {
            puuid: userData.puuid,
            gameName: userData.gameName,
            tagLine: userData.tagLine,
            tier: userData.soloQueueRank.tier,
            rank: userData.soloQueueRank.rank,
            leaguePoints: userData.soloQueueRank.leaguePoints
          };
          
          // Upload rank to database
          await RankAPI.uploadRank(twitchUsername, rankData);
          console.log('Rank data updated in database successfully');
        }
      } catch (dbError) {
        console.error('Error updating rank in database:', dbError);
        // Don't fail the entire operation if database update fails
      }
      
      console.log('Rank information successfully refreshed');
    } catch (error) {
      // Check if it's the specific re-authentication error
      if (error.name === "ReAuthenticationRequiredError") {
        console.log('Re-authentication required, initiating auth flow...');
        try {
          // Silently trigger the RSO authentication flow
          await RiotAuth.authenticate(regionSelect.value);
          // Optionally: automatically re-call refreshRank after successful auth?
          // For now, let the user click refresh again after auth completes.
          console.log('Re-authentication flow initiated. User should try refreshing again after completion.');
          // Keep the refreshing state until auth completes or user cancels
          // Do NOT remove refreshing class here, let the finally block handle it only if auth isn't triggered.
        } catch (authError) {
          console.error('Error during re-authentication attempt:', authError);
          // If re-auth fails, stop the spinner and maybe show a generic error
          refreshRankBtn.classList.remove('refreshing');
          refreshRankBtn.disabled = false;
          showAuthError('Re-auth failed');
        }
        // Important: Do not fall through to general error handling if re-auth is triggered
        return; // Exit the catch block
      }
      
      // Handle other errors (e.g., network issues, data not found)
      console.error('Error refreshing rank:', error);
      
      // Show "Unranked" if there's a rank lookup error or no data found for this region
      if (error.message && (
          error.message.includes('not found') || 
          error.message.includes('not available') || 
          error.message.includes('no rank data')
      )) {
        currentRank.textContent = 'Unranked';
        rankBadgePreview.style.backgroundImage = `url('https://eloward-cdn.unleashai.workers.dev/lol/unranked.png')`;
        rankBadgePreview.style.transform = 'translateY(-3px)';
      } else {
        // For other errors, show brief error message
        const originalText = currentRank.textContent;
        currentRank.textContent = 'Refresh failed';
        
        // Reset to original text after a short delay
        setTimeout(() => {
          currentRank.textContent = originalText;
        }, 3000);
      }
    } finally {
      // The spinner is now primarily handled within the catch block
      // Only remove here if the try block completed successfully OR
      // if a non-ReAuthenticationRequiredError occurred and wasn't handled above.
      // Check if the refreshing class is still present before removing/re-enabling.
      if (refreshRankBtn.classList.contains('refreshing')) {
        refreshRankBtn.classList.remove('refreshing');
        refreshRankBtn.disabled = false;
      }
    }
  }

  function displayRank(rankData) {
    if (!rankData) {
      currentRank.textContent = 'Unranked';
      // Enhanced image URL path to ensure proper loading with transparent background
      rankBadgePreview.style.backgroundImage = `url('https://eloward-cdn.unleashai.workers.dev/lol/unranked.png')`;
      // Apply custom positioning for unranked badge
      rankBadgePreview.style.transform = 'translateY(-3px)';
      return;
    }
    
    // Properly capitalize the tier
    let formattedTier = rankData.tier.toLowerCase();
    formattedTier = formattedTier.charAt(0).toUpperCase() + formattedTier.slice(1);
    
    let rankText = formattedTier;
    
    // Add division for ranks that have divisions (not Master, Grandmaster, Challenger)
    if (rankData.division && !['Master', 'Grandmaster', 'Challenger'].includes(formattedTier)) {
      rankText += ` ${rankData.division}`;
    }
    
    // Add LP if available
    if (rankData.leaguePoints !== undefined && rankData.leaguePoints !== null) {
      rankText += ` - ${rankData.leaguePoints} LP`;
    }
    
    currentRank.textContent = rankText;
    
    // Determine the rank badge image path
    let rankImageFileName = formattedTier;
    
    // Set the rank badge image
    rankBadgePreview.style.backgroundImage = `url('https://eloward-cdn.unleashai.workers.dev/lol/${rankImageFileName}.png')`;
    
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
        setRiotControlsDisabled(true); // Disable Riot controls on Twitch disconnect
      } else {
        // Connect flow
        twitchConnectionStatus.textContent = 'Connecting...';
        twitchConnectionStatus.classList.add('connecting');
        twitchConnectionStatus.classList.remove('connected', 'disconnecting', 'error');
        connectTwitchBtn.textContent = 'Connecting...';
        connectTwitchBtn.disabled = true;
        
        try {
          // First authenticate to get tokens - this now also updates persistent storage
          await TwitchAuth.authenticate();
          console.log('Twitch authentication successful');
          
          // Try to get user info but don't fail if this part has issues
          try {
            const userData = await TwitchAuth.getUserInfo();
            console.log('Twitch user info retrieved:', userData);
            
            // Store user data in persistent storage
            if (userData) {
              await PersistentStorage.storeTwitchUserData(userData);
              console.log('Stored Twitch user data in persistent storage during connect');
              
              // Update UI with user data
              twitchConnectionStatus.textContent = userData.display_name || userData.login;
              
              // Only mark as connected if we have valid user data
              twitchConnectionStatus.classList.add('connected');
              twitchConnectionStatus.classList.remove('connecting');
              connectTwitchBtn.textContent = 'Disconnect';
              setRiotControlsDisabled(false); // Enable Riot controls on Twitch connect
            } else {
              // Authentication succeeded but no user data
              throw new Error('Failed to retrieve user info');
            }
          } catch (userInfoError) {
            // User info failed - show error and reset connection state
            console.warn('Could not get user info:', userInfoError);
            twitchConnectionStatus.textContent = 'Authentication Failed';
            twitchConnectionStatus.classList.add('error');
            twitchConnectionStatus.classList.remove('connecting');
            connectTwitchBtn.textContent = 'Connect';
            setRiotControlsDisabled(true); // Ensure Riot controls disabled on error
            
            // Keep the auth token but don't show as connected
            setTimeout(() => {
              if (twitchConnectionStatus.classList.contains('error')) {
                twitchConnectionStatus.textContent = 'Not Connected';
                twitchConnectionStatus.classList.remove('error');
              }
            }, 5000);
          }
          
        } catch (authError) {
          console.error('Twitch authentication error:', authError);
          twitchConnectionStatus.textContent = authError.message || 'Authentication Failed';
          twitchConnectionStatus.classList.add('error');
          twitchConnectionStatus.classList.remove('connecting');
          connectTwitchBtn.textContent = 'Connect';
          setRiotControlsDisabled(true); // Ensure Riot controls disabled on error
          
          // Ensure the connected state is properly reset in case of error
          await PersistentStorage.updateConnectedState('twitch', false);
          
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
      
      // Ensure connected state is reset on error
      await PersistentStorage.updateConnectedState('twitch', false);
      setRiotControlsDisabled(true); // Ensure Riot controls disabled on error
    } finally {
      connectTwitchBtn.disabled = false;
    }
  }

  // Get references to all stored regions
  chrome.storage.local.get(['selectedRegion'], (result) => {
    // First clean up any old key that might exist
    chrome.storage.local.remove('connected_region');
    
    // Set the region selector value
    if (result.selectedRegion) {
      regionSelect.value = result.selectedRegion;
    }
  });
}); 