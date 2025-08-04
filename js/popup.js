/*
 * Copyright 2024 EloWard
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * "Commons Clause" License Condition v1.0
 * The Software is provided to you by the Licensor under the License, as defined below, 
 * subject to the following condition. Without limiting other conditions in the License, 
 * the grant of rights under the License will not include, and the License does not grant 
 * to you, the right to Sell the Software.
 */

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
  const accountHeader = document.getElementById('account-header');
  const accountContent = document.getElementById('account-content');
  const accountDropdownArrow = accountHeader.querySelector('.dropdown-arrow');
  


  // Helper function to disable/enable Riot controls
  function setRiotControlsDisabled(isDisabled) {
    connectRiotBtn.disabled = isDisabled;
    regionSelect.disabled = isDisabled;
    
    if (isDisabled) {
      connectRiotBtn.setAttribute('data-tooltip', 'Connect Twitch account first');
      connectRiotBtn.classList.add('has-tooltip');
    } else {
      connectRiotBtn.removeAttribute('data-tooltip');
      connectRiotBtn.classList.remove('has-tooltip');
    }
  }

  // Update Riot controls based on current Twitch connection status
  function updateRiotControlsBasedOnTwitchStatus() {
    const isTwitchConnected = twitchConnectionStatus.classList.contains('connected') && 
                              twitchConnectionStatus.textContent !== 'Not Connected' &&
                              twitchConnectionStatus.textContent !== 'Connecting...' &&
                              twitchConnectionStatus.textContent !== 'Disconnecting...';
    
    setRiotControlsDisabled(!isTwitchConnected);
  }

  // Helper function to update button text and styling
  function updateRiotButtonText(text) {
    connectRiotBtn.textContent = text;
    
    // Apply red styling for "Sign In" button
    if (text === 'Sign In') {
      connectRiotBtn.classList.add('btn-signin');
    } else {
      connectRiotBtn.classList.remove('btn-signin');
    }
  }

  // Helper function to check if this is a first-time user (no stored Riot data)
  async function isFirstTimeUser() {
    try {
      const persistentData = await PersistentStorage.getRiotUserData();
      if (persistentData) return false;
      
      const storageData = await new Promise(resolve => {
        chrome.storage.local.get([
          'eloward_riot_access_token',
          'eloward_riot_refresh_token', 
          'eloward_riot_account_info',
          'riotAuth',
          'eloward_signin_attempted'
        ], resolve);
      });
      
      // If sign-in has been attempted, no longer consider them a first-time user
      if (storageData.eloward_signin_attempted) return false;
      
      return !storageData.eloward_riot_access_token && 
             !storageData.eloward_riot_refresh_token && 
             !storageData.eloward_riot_account_info && 
             !storageData.riotAuth;
    } catch (error) {
      return true; // Assume first time on error
    }
  }

  // Initialize persistent storage
  PersistentStorage.init();
  

  // Initialize the streamer dropdown with proper styling 
  streamerContent.style.display = 'none';

  // Initialize the account dropdown state from storage (default to open on first install)
  initializeAccountSectionState();

  // Disable Riot controls initially (will be updated after auth status check)
  setRiotControlsDisabled(true);

  // Check authentication status
  checkAuthStatus();

  // Event Listeners
  connectRiotBtn.addEventListener('click', connectRiotAccount);
  regionSelect.addEventListener('change', handleRegionChange);
  refreshRankBtn.addEventListener('click', refreshRank);
  
  // Add event listener for Twitch connect button
  if (connectTwitchBtn) {
    connectTwitchBtn.addEventListener('click', connectTwitchAccount);
  }
  
  // Tooltip functionality for disabled buttons
  let tooltipElement = null;
  let tooltipTimeout = null;
  
  // Create tooltip element
  function createTooltip() {
    if (tooltipElement) return tooltipElement;
    
    tooltipElement = document.createElement('div');
    tooltipElement.className = 'custom-tooltip';
    document.body.appendChild(tooltipElement);
    return tooltipElement;
  }
  
  // Show tooltip
  function showTooltip(event) {
    const target = event.target;
    const tooltipText = target.getAttribute('data-tooltip');
    
    if (!tooltipText || !target.disabled) return;
    
    clearTimeout(tooltipTimeout);
    
    const tooltip = createTooltip();
    tooltip.textContent = tooltipText;
    tooltip.style.visibility = 'hidden';
    tooltip.style.display = 'block';
    
    // Position tooltip
    const rect = target.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    
    tooltip.style.left = `${rect.left + (rect.width - tooltipRect.width) / 2 - 40}px`;
    tooltip.style.top = `${rect.top - tooltipRect.height - 8}px`;
    
    // Show tooltip with delay
    tooltipTimeout = setTimeout(() => {
      tooltip.style.visibility = 'visible';
      tooltip.style.opacity = '1';
    }, 0);
  }
  
  // Hide tooltip
  function hideTooltip() {
    clearTimeout(tooltipTimeout);
    if (tooltipElement) {
      tooltipElement.style.opacity = '0';
      tooltipElement.style.visibility = 'hidden';
    }
  }
  
  // Add tooltip event listeners to connect button
  connectRiotBtn.addEventListener('mouseenter', showTooltip);
  connectRiotBtn.addEventListener('mouseleave', hideTooltip);
  
  // Add toggle functionality for the streamer section
  streamerHeader.addEventListener('click', () => {
    const isHidden = streamerContent.style.display === 'none';
    
    // Toggle the display of the content
    if (isHidden) {
      streamerContent.style.display = 'block';
      dropdownArrow.classList.add('rotated');
    } else {
      streamerContent.style.display = 'none';
      dropdownArrow.classList.remove('rotated');
    }
  });
  
  // Add toggle functionality for the account section
  accountHeader.addEventListener('click', () => {
    const isHidden = accountContent.style.display === 'none';
    
    // Toggle the display of the content
    if (isHidden) {
      accountContent.style.display = 'block';
      accountDropdownArrow.classList.add('rotated');
    } else {
      accountContent.style.display = 'none';
      accountDropdownArrow.classList.remove('rotated');
    }
    
    // Save the collapse state to chrome storage
    chrome.storage.local.set({ 'accountSectionCollapsed': !isHidden });
  });

  // Initialize account section state from storage
  async function initializeAccountSectionState() {
    try {
      const result = await chrome.storage.local.get(['accountSectionCollapsed']);
      const isCollapsed = result.accountSectionCollapsed;
      
      // Default to open (not collapsed) on first install
      if (isCollapsed === undefined || isCollapsed === false) {
        accountContent.style.display = 'block';
        accountDropdownArrow.classList.add('rotated');
      } else {
        accountContent.style.display = 'none';
        accountDropdownArrow.classList.remove('rotated');
      }
    } catch (error) {
      // Default to open on error
      accountContent.style.display = 'block';
      accountDropdownArrow.classList.add('rotated');
    }
  }
  
  
  // Listen for messages from the background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Handle auth callback messages
    if (message.type === 'auth_callback' && message.params) {
      processAuthCallback(message.params);
      sendResponse({ success: true });
    }
    
    // Handle auth completion notification to refresh popup
    if (message.type === 'auth_completed') {
      // Automatically refresh auth status when auth completes
      checkAuthStatus();
      sendResponse({ success: true });
    }
    
    // Handle clear_local_storage message (kept for backward compatibility)
    if (message.action === 'clear_local_storage') {
      // No action needed as we only use chrome.storage.local now
      sendResponse({ success: true });
    }
    
    return true; // Keep the message channel open for async response
  });

  // Process auth callback from various sources
  async function processAuthCallback(params) {
    try {
      // Store the auth callback data in chrome.storage for processing by authenticator
      await new Promise(resolve => {
        chrome.storage.local.set({ 'auth_callback': { code: params.code, state: params.state } }, resolve);
        chrome.storage.local.set({ 'eloward_auth_callback': { code: params.code, state: params.state } }, resolve);
        resolve();
      });
      
    } catch (error) {
      // Only show error if the connection button isn't in a "connecting" state
      if (!riotConnectionStatus.classList.contains('connecting')) {
        showAuthError(error.message || 'Failed to process authentication');
      }
    }
  }

  // Update UI based on user data
  function updateUserInterface(userData) {
    try {
      if (userData && userData.riotId) {
        riotConnectionStatus.textContent = userData.riotId;
        riotConnectionStatus.classList.add('connected');
        riotConnectionStatus.classList.remove('error', 'connecting');
        updateRiotButtonText('Disconnect');
        connectRiotBtn.disabled = false;
        refreshRankBtn.classList.remove('hidden'); // Show refresh button
        
        let rankInfo = null;
        
        // Extract rank info from various data formats
        if (userData.soloQueueRank) {
          rankInfo = {
            tier: userData.soloQueueRank.tier.charAt(0) + userData.soloQueueRank.tier.slice(1).toLowerCase(),
            division: userData.soloQueueRank.rank,
            leaguePoints: userData.soloQueueRank.leaguePoints
          };
        } else if (userData.ranks && userData.ranks.length > 0) {
          const soloQueueEntry = userData.ranks.find(entry => entry.queueType === 'RANKED_SOLO_5x5');
          if (soloQueueEntry) {
            rankInfo = {
              tier: soloQueueEntry.tier.charAt(0) + soloQueueEntry.tier.slice(1).toLowerCase(),
              division: soloQueueEntry.rank,
              leaguePoints: soloQueueEntry.leaguePoints
            };
          }
        } else if (userData.rankInfo) {
          rankInfo = userData.rankInfo;
        }
        

        
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
      // Fallback to not connected UI on error
      showNotConnectedUI();
    }
  }

  // Handle authentication errors gracefully
  async function showAuthError(message) {
    riotConnectionStatus.textContent = 'Not Connected';
    riotConnectionStatus.classList.remove('error', 'connecting', 'connected');
    
    const firstTime = await isFirstTimeUser();
    updateRiotButtonText(firstTime ? 'Sign In' : 'Connect');
    connectRiotBtn.disabled = false;
  }


  // Functions
  async function checkAuthStatus() {
    try {
      // First check persistent storage for connected states
      const persistentConnectedState = await PersistentStorage.getConnectedState();
      
      // Check persistent storage for user data (even if not "connected" due to expired tokens)
      const storedRiotData = await PersistentStorage.getRiotUserData();
      if (storedRiotData) {
        const userData = {
          riotId: storedRiotData.riotId,
          puuid: storedRiotData.puuid,
          soloQueueRank: storedRiotData.rankInfo
        };
        
        if (persistentConnectedState.riot) {
          // User is actively connected with valid tokens
          updateUserInterface(userData);
          refreshRankBtn.classList.remove('hidden'); // Show refresh button
        } else {
          // User has stored data but tokens may be expired
          updateUserInterface(userData);
          // Still show refresh button - it will handle re-authentication if needed
          refreshRankBtn.classList.remove('hidden');
          
          riotConnectionStatus.textContent = userData.riotId;
          riotConnectionStatus.classList.add('connected');
          updateRiotButtonText('Disconnect');
        }
        
        // Get the connected region from storage and update the selector
        chrome.storage.local.get(['selectedRegion'], (result) => {
          if (result.selectedRegion) {
            regionSelect.value = result.selectedRegion;
          }
        });
      } else {
        // Show not connected UI for Riot
        riotConnectionStatus.textContent = 'Not Connected';
        riotConnectionStatus.classList.remove('connected', 'connecting', 'disconnecting', 'error');
        
        // Check if first-time user to determine button text
        const firstTime = await isFirstTimeUser();
        updateRiotButtonText(firstTime ? 'Sign In' : 'Connect');
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
      
      // Check persistent storage for Twitch data (even if not "connected" due to expired tokens)
      const storedTwitchData = await PersistentStorage.getTwitchUserData();
      if (storedTwitchData) {
        // Show user data regardless of connection status (data preserved)
        twitchConnectionStatus.textContent = storedTwitchData.display_name || storedTwitchData.login;
        twitchConnectionStatus.classList.add('connected');
        connectTwitchBtn.textContent = 'Disconnect';
      }
      
      // Check Twitch authentication status
      try {
        const isTwitchAuthenticated = await TwitchAuth.isAuthenticated();
        
        let isTwitchConnected = false;
        if (isTwitchAuthenticated) {
          // User is authenticated with Twitch, update UI
          const userData = await TwitchAuth.getUserInfo();
          const displayName = userData?.display_name || userData?.login || 'Connected';
          twitchConnectionStatus.textContent = displayName;
          twitchConnectionStatus.classList.add('connected');
          twitchConnectionStatus.classList.remove('connecting', 'disconnecting', 'error');
          connectTwitchBtn.textContent = 'Disconnect';
          
                  // Update persistent storage with latest data
        try {
          if (userData) {
            await PersistentStorage.storeTwitchUserData(userData);
          }
        } catch (error) {
          // Storage update failed
        }
          isTwitchConnected = true; // Mark as connected based on live check
        } else if (!persistentConnectedState.twitch) {
          // Only update UI if we haven't already displayed data from persistent storage
          twitchConnectionStatus.textContent = 'Not Connected';
          twitchConnectionStatus.classList.remove('connected', 'connecting', 'disconnecting', 'error');
          connectTwitchBtn.textContent = 'Connect';
          isTwitchConnected = false; // Mark as not connected based on live check failure
        }
        
        // Enable/disable Riot controls based on actual Twitch UI status
        updateRiotControlsBasedOnTwitchStatus();
        
              } catch (twitchError) {
          if (!persistentConnectedState.twitch) {
            // Only update UI if we haven't already displayed data from persistent storage
            twitchConnectionStatus.textContent = 'Not Connected';
            twitchConnectionStatus.classList.remove('connected', 'connecting', 'disconnecting', 'error');
            connectTwitchBtn.textContent = 'Connect';
            // Update Riot controls based on the new Twitch status
            updateRiotControlsBasedOnTwitchStatus();
          }
        }
      
    } catch (error) {
      showNotConnectedUI();
    }
    
    // Ensure Riot controls are properly set based on final Twitch status
    updateRiotControlsBasedOnTwitchStatus();
  }

  // Helper function to show the not connected UI state
  async function showNotConnectedUI() {
    // Check if first-time user to determine status text and button text
    const firstTime = await isFirstTimeUser();
    
    // Reset Riot connection UI
    riotConnectionStatus.textContent = firstTime ? 'Please Sign In' : 'Not Connected';
    riotConnectionStatus.classList.remove('connected', 'error', 'connecting');
    
    updateRiotButtonText(firstTime ? 'Sign In' : 'Connect');
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
    
    // Update Riot controls based on current Twitch status
    updateRiotControlsBasedOnTwitchStatus();
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
          updateRiotButtonText('Disconnecting...');
          riotConnectionStatus.textContent = 'Disconnecting...';
          riotConnectionStatus.classList.add('disconnecting');
          
          try {
            // Use disconnect method to clear both tokens and persistent data
            await RiotAuth.disconnect();
            
            // Update UI manually
            riotConnectionStatus.textContent = 'Not Connected';
            riotConnectionStatus.classList.remove('connected', 'disconnecting');
            updateRiotButtonText('Connect');
            
            // Show unranked rank display
            currentRank.textContent = 'Unranked';
            rankBadgePreview.style.backgroundImage = `url('https://eloward-cdn.unleashai.workers.dev/lol/unranked.png')`;
            rankBadgePreview.style.transform = 'translateY(-3px)';
            refreshRankBtn.classList.add('hidden'); // Hide refresh button on disconnect
          } catch (error) {
            
            // Show normal not connected state instead of error
            updateRiotButtonText('Connect');
            riotConnectionStatus.textContent = 'Not Connected';
            riotConnectionStatus.classList.remove('error', 'disconnecting', 'connected');
          } finally {
            // Re-enable button
            connectRiotBtn.disabled = false;
          }
          return; // Exit the function after disconnect flow
        }
      }
      
      // Connect flow - check if first time to determine UI behavior
      const isFirstTime = await isFirstTimeUser();
      
      if (isFirstTime) {
        // First time - just change button text, don't show connecting state
        updateRiotButtonText('Signing In...');
        // Keep status as "Please Sign In" for first time
        
        // Mark that sign-in button has been pressed so we switch to normal state afterwards
        await chrome.storage.local.set({ 'eloward_signin_attempted': true });
      } else {
        // Returning user - show normal connecting state
        updateRiotButtonText('Connecting...');
        riotConnectionStatus.textContent = 'Connecting...';
        riotConnectionStatus.classList.remove('error');
        riotConnectionStatus.classList.add('connecting');
      }
      
      // Get selected region
      const region = regionSelect.value;
      
      try {
        // Use the Riot RSO authentication module
        const userData = await RiotAuth.authenticate(region);
        
        // Store user data in persistent storage
        await PersistentStorage.storeRiotUserData(userData);
        
        // Update UI with the user data
        updateUserInterface(userData);
        
        // Store the connected region in storage and ensure the region selector reflects the current region
        await chrome.storage.local.set({ selectedRegion: region });
              } catch (error) {
          
          // Show normal not connected state instead of error
          // After first sign-in attempt, always show normal state
          const firstTime = await isFirstTimeUser();
          updateRiotButtonText(firstTime ? 'Sign In' : 'Connect');
          riotConnectionStatus.textContent = firstTime ? 'Please Sign In' : 'Not Connected';
          riotConnectionStatus.classList.remove('error', 'connecting', 'connected');
        } finally {
          // Remove connecting class if still present and not connected
          if (!riotConnectionStatus.classList.contains('connected')) {
            riotConnectionStatus.classList.remove('connecting');
          }
          
          // Re-enable button
          connectRiotBtn.disabled = false;
        }
    } catch (error) {
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
      // First check if the user is authenticated
      const isAuthenticated = await RiotAuth.isAuthenticated();
      if (!isAuthenticated) {
        showAuthError('Please connect your account first');
        return;
      }
      
      // Show a loading state on the button (add a rotating animation class)
      refreshRankBtn.classList.add('refreshing');
      refreshRankBtn.disabled = true; // Disable button while refreshing
      
      // Attempt to refresh rank data
      await performRankRefresh();
      
    } catch (error) {
      // Check if it's the specific re-authentication error
      if (error.name === "ReAuthenticationRequiredError") {
        try {
          // Perform silent re-authentication to get fresh tokens
          const region = regionSelect.value;
          await RiotAuth.performSilentReauth(region);
          
          // After successful silent re-auth, automatically retry the rank refresh
          await performRankRefresh();
        } catch (authError) {
          // If silent re-auth fails, show error but don't break connection
          showAuthError('Authentication failed. Please try refreshing again.');
        }
        return; // Exit the catch block
      }
      
      // Handle other errors (e.g., network issues, data not found)
      
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
        // For other errors, don't show error to user - keep original text
        // Keep the original rank text, no user-visible error
      }
    } finally {
      // Remove loading state
      if (refreshRankBtn.classList.contains('refreshing')) {
        refreshRankBtn.classList.remove('refreshing');
        refreshRankBtn.disabled = false;
      }
    }
  }

  // Perform the actual rank refresh operation
  async function performRankRefresh() {
    const accountInfo = await RiotAuth.getAccountInfo();
    
    if (!accountInfo || !accountInfo.puuid) {
      throw new Error('Account information not available');
    }
    
    const selectedRegion = regionSelect.value;
    const rankEntries = await RiotAuth.getRankInfo(accountInfo.puuid);
    const userData = await RiotAuth.getUserData(true);
    
    updateUserInterface(userData);
    await PersistentStorage.storeRiotUserData(userData);
    
    // Update rank in the database via secure backend
    try {
      // Get current Twitch username
      const twitchData = await new Promise(resolve => {
        chrome.storage.local.get(['eloward_persistent_twitch_user_data', 'twitchUsername'], resolve);
      });
      
      const twitchUsername = twitchData.eloward_persistent_twitch_user_data?.login || twitchData.twitchUsername;
      
      if (twitchUsername) {
        // Get current access token and region
        const accessToken = await RiotAuth.getValidToken();
        const region = regionSelect.value;
        
        // Get Twitch token for verification
        const twitchToken = await TwitchAuth.getValidToken();
        
        if (accessToken && twitchToken) {
          // Call the secure backend endpoint
          const response = await fetch(`https://eloward-riotauth.unleashai.workers.dev/store-rank`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              twitch_token: twitchToken,
              riot_token: accessToken,
              region: region,
              twitch_username: twitchUsername
            })
          });
          
          if (response.ok) {
            const result = await response.json();
          } else {
            const errorData = await response.json();
          }
        } else {
        }
      }
    } catch (dbError) {
      // Don't fail the entire operation if database update fails
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
    let rankImageFileName = formattedTier.toLowerCase();
    
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
    // Check if TwitchAuth is available
    if (typeof TwitchAuth === 'undefined') {
      twitchConnectionStatus.textContent = 'Not Connected';
      twitchConnectionStatus.classList.remove('error', 'connecting', 'disconnecting', 'connected');
      return;
    }
    
    try {
      // Check if user is already authenticated
      const isAuthenticated = await TwitchAuth.isAuthenticated();
      
      if (isAuthenticated) {
        // Disconnect flow
        twitchConnectionStatus.textContent = 'Disconnecting...';
        twitchConnectionStatus.classList.add('disconnecting');
        twitchConnectionStatus.classList.remove('connected', 'connecting', 'error');
        connectTwitchBtn.textContent = 'Disconnecting...';
        connectTwitchBtn.disabled = true;
        
        // Use disconnect method to clear both tokens and persistent data
        await TwitchAuth.disconnect();
        
        // Update UI after logout
        twitchConnectionStatus.textContent = 'Not Connected';
        connectTwitchBtn.textContent = 'Connect';
        twitchConnectionStatus.classList.remove('connected', 'connecting', 'disconnecting');
        
        // Update Riot controls based on disconnected status
        updateRiotControlsBasedOnTwitchStatus();
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
          
          // Try to get user info but don't fail if this part has issues
          try {
            const userData = await TwitchAuth.getUserInfo();
            
            // Store user data in persistent storage
            if (userData) {
              await PersistentStorage.storeTwitchUserData(userData);
              
              // Update UI with user data
              twitchConnectionStatus.textContent = userData.display_name || userData.login;
              
                          // Only mark as connected if we have valid user data
            twitchConnectionStatus.classList.add('connected');
            twitchConnectionStatus.classList.remove('connecting');
            connectTwitchBtn.textContent = 'Disconnect';
            
            // Update Riot controls based on successful connection
            updateRiotControlsBasedOnTwitchStatus();
            } else {
              // Authentication succeeded but no user data
              throw new Error('Failed to retrieve user info');
            }
          } catch (userInfoError) {
            // User info failed - show not connected state
            twitchConnectionStatus.textContent = 'Not Connected';
            twitchConnectionStatus.classList.remove('error', 'connecting', 'connected');
            connectTwitchBtn.textContent = 'Connect';
            
            // Update Riot controls based on failed connection
            updateRiotControlsBasedOnTwitchStatus();
          }
          
        } catch (authError) {
          twitchConnectionStatus.textContent = 'Not Connected';
          twitchConnectionStatus.classList.remove('error', 'connecting', 'connected');
          connectTwitchBtn.textContent = 'Connect';
          
          // Update Riot controls based on failed authentication
          updateRiotControlsBasedOnTwitchStatus();
          
          // Ensure the connected state is properly reset in case of error
          await PersistentStorage.updateConnectedState('twitch', false);
        }
      }
    } catch (error) {
      twitchConnectionStatus.textContent = 'Not Connected';
      twitchConnectionStatus.classList.remove('error', 'connecting', 'disconnecting', 'connected');
      
      // Ensure connected state is reset on error
      await PersistentStorage.updateConnectedState('twitch', false);
      
      // Update Riot controls based on error state
      updateRiotControlsBasedOnTwitchStatus();
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