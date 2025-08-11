/* Copyright 2024 EloWard - Apache 2.0 + Commons Clause License */

import { RiotAuth } from './auth/riotAuth.js';
import { TwitchAuth } from './auth/twitchAuth.js';
import { PersistentStorage } from './core/persistentStorage.js';

document.addEventListener('DOMContentLoaded', () => {

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


  function updateRiotControlsBasedOnTwitchStatus() {
    const isTwitchConnected = twitchConnectionStatus.classList.contains('connected') && 
                              twitchConnectionStatus.textContent !== 'Not Connected';
    
    setRiotControlsDisabled(!isTwitchConnected);
  }


  function updateRiotButtonText(text) {
    connectRiotBtn.textContent = text;
  }

  // Push latest local user's rank into background cache so it's fresh for chat injection
  async function updateBackgroundCacheForLocalUser(userData) {
    try {
      const twitchInfo = await PersistentStorage.getTwitchUserData();
      const twitchUsername = twitchInfo?.login?.toLowerCase();
      if (!twitchUsername || !userData) return;

      // Derive rank data from userData
      let tier = 'UNRANKED';
      let division = '';
      let leaguePoints = null;
      if (userData.soloQueueRank) {
        tier = userData.soloQueueRank.tier?.toUpperCase() || 'UNRANKED';
        division = userData.soloQueueRank.rank || '';
        leaguePoints = userData.soloQueueRank.leaguePoints ?? null;
      } else if (userData.rankInfo) {
        tier = userData.rankInfo.tier?.toUpperCase() || 'UNRANKED';
        division = userData.rankInfo.rank || '';
        leaguePoints = userData.rankInfo.leaguePoints ?? null;
      }

      const { selectedRegion } = await browser.storage.local.get(['selectedRegion']);
      const region = selectedRegion || 'na1';

      const rankData = {
        tier,
        division,
        leaguePoints,
        summonerName: userData.riotId,
        region
      };

      try {
        await browser.runtime.sendMessage({
          action: 'set_rank_data',
          username: twitchUsername,
          rankData
        });
      } catch (_) {}
    } catch (_) {}
  }


  async function isFirstTimeUser() {
    try {
      const persistentData = await PersistentStorage.getRiotUserData();
      return !persistentData;
    } catch (error) {
      return true;
    }
  }


  PersistentStorage.init();
  

 
  streamerContent.style.display = 'none';


  initializeAccountSectionState();


  setRiotControlsDisabled(true);


  checkAuthStatus();


  connectRiotBtn.addEventListener('click', connectRiotAccount);
  regionSelect.addEventListener('change', handleRegionChange);
  refreshRankBtn.addEventListener('click', refreshRank);
  

  if (connectTwitchBtn) {
    connectTwitchBtn.addEventListener('click', connectTwitchAccount);
  }
  

  let tooltipElement = null;
  let tooltipTimeout = null;
  

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
    

    const rect = target.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    
    tooltip.style.left = `${rect.left + (rect.width - tooltipRect.width) / 2 - 40}px`;
    tooltip.style.top = `${rect.top - tooltipRect.height - 8}px`;
    

    tooltipTimeout = setTimeout(() => {
      tooltip.style.visibility = 'visible';
      tooltip.style.opacity = '1';
    }, 0);
  }
  

  function hideTooltip() {
    clearTimeout(tooltipTimeout);
    if (tooltipElement) {
      tooltipElement.style.opacity = '0';
      tooltipElement.style.visibility = 'hidden';
    }
  }
  

  connectRiotBtn.addEventListener('mouseenter', showTooltip);
  connectRiotBtn.addEventListener('mouseleave', hideTooltip);
  

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
    

    browser.storage.local.set({ 'accountSectionCollapsed': !isHidden });
  });


  async function initializeAccountSectionState() {
    try {
      const result = await browser.storage.local.get(['accountSectionCollapsed']);
      const isCollapsed = result.accountSectionCollapsed;
      

      if (isCollapsed === undefined || isCollapsed === false) {
        accountContent.style.display = 'block';
        accountDropdownArrow.classList.add('rotated');
      } else {
        accountContent.style.display = 'none';
        accountDropdownArrow.classList.remove('rotated');
      }
    } catch (error) {

      accountContent.style.display = 'block';
      accountDropdownArrow.classList.add('rotated');
    }
  }
  
  

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {

    if (message.type === 'auth_callback' && message.params) {
      processAuthCallback(message.params);
      sendResponse({ success: true });
    }
    

    if (message.type === 'auth_completed') {

      checkAuthStatus();
      sendResponse({ success: true });
    }
    

    if (message.action === 'clear_local_storage') {

      sendResponse({ success: true });
    }
    
    return true;
  });


  async function processAuthCallback(params) {
    try {

      await browser.storage.local.set({ 
        'auth_callback': { code: params.code, state: params.state },
        'eloward_auth_callback': { code: params.code, state: params.state }
      });
      
    } catch (error) {
      showAuthError(error.message || 'Failed to process authentication');
    }
  }


  function updateUserInterface(userData) {
    try {
      if (userData && userData.riotId) {
        riotConnectionStatus.textContent = userData.riotId;
        riotConnectionStatus.classList.add('connected');
        riotConnectionStatus.classList.remove('error');
        updateRiotButtonText('Disconnect');
        connectRiotBtn.disabled = false;
        refreshRankBtn.classList.remove('hidden'); // Show refresh button
        
        let rankInfo = null;
        

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
        

        

        if (rankInfo) {
          displayRank(rankInfo);
        } else {

          currentRank.textContent = 'Unranked';
          rankBadgePreview.style.backgroundImage = `url('https://eloward-cdn.unleashai.workers.dev/lol/unranked.png')`;
          rankBadgePreview.style.transform = 'translateY(-3px)';
        }
      } else {

        showNotConnectedUI();
      }
    } catch (error) {

      showNotConnectedUI();
    }
  }


  async function showAuthError(message) {
    riotConnectionStatus.textContent = 'Not Connected';
    riotConnectionStatus.classList.remove('error', 'connected');
    
    const firstTime = await isFirstTimeUser();
    updateRiotButtonText('Connect');
    connectRiotBtn.disabled = false;
  }



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
        browser.storage.local.get(['selectedRegion']).then((result) => {
          if (result.selectedRegion) {
            regionSelect.value = result.selectedRegion;
          }
        });
      } else {
        // Show not connected UI for Riot
        riotConnectionStatus.textContent = 'Not Connected';
        riotConnectionStatus.classList.remove('connected', 'error');
        
        // Check if first-time user to determine button text
        const firstTime = await isFirstTimeUser();
        updateRiotButtonText('Connect');
        connectRiotBtn.disabled = false;
        currentRank.textContent = 'Unknown';
        rankBadgePreview.style.backgroundImage = 'none';
        refreshRankBtn.classList.add('hidden'); // Hide refresh button
        
        // Reset rank display and show unranked graphic
        currentRank.textContent = 'Unranked';
        rankBadgePreview.style.backgroundImage = `url('https://eloward-cdn.unleashai.workers.dev/lol/unranked.png')`;
        rankBadgePreview.style.transform = 'translateY(-3px)';
        
        // Set region from storage if available
        browser.storage.local.get(['selectedRegion']).then((result) => {
          if (result.selectedRegion) {
            regionSelect.value = result.selectedRegion;
          }
        });
      }
      
      // Check persistent storage for Twitch data (even if not "connected" due to expired tokens)
      const storedTwitchData = await PersistentStorage.getTwitchUserData();
      const renderedTwitchFromStorage = !!storedTwitchData;
      if (renderedTwitchFromStorage) {
        // Show user data regardless of connection status (data preserved)
        twitchConnectionStatus.textContent = storedTwitchData.display_name || storedTwitchData.login;
        twitchConnectionStatus.classList.add('connected');
        twitchConnectionStatus.classList.remove('error');
        connectTwitchBtn.textContent = 'Disconnect';
      }
      
      // Check Twitch authentication status
      try {
        const isTwitchAuthenticated = await TwitchAuth.isAuthenticated();
        
        if (isTwitchAuthenticated) {
          // If we didn't render from storage yet, populate from storage-first API
          if (!renderedTwitchFromStorage) {
            const userData = await TwitchAuth.getUserInfo(); // storage-first
            const displayName = userData?.display_name || userData?.login || 'Connected';
            twitchConnectionStatus.textContent = displayName;
            twitchConnectionStatus.classList.add('connected');
            twitchConnectionStatus.classList.remove('error');
            connectTwitchBtn.textContent = 'Disconnect';
            try { if (userData) await PersistentStorage.storeTwitchUserData(userData); } catch (_) {}
          }
        } else if (!persistentConnectedState.twitch && !renderedTwitchFromStorage) {
          // Only show Not Connected if we haven't already displayed cached data
          twitchConnectionStatus.textContent = 'Not Connected';
          twitchConnectionStatus.classList.remove('connected', 'error');
          connectTwitchBtn.textContent = 'Connect';
        }
        
        updateRiotControlsBasedOnTwitchStatus();
      } catch (_) {
        if (!persistentConnectedState.twitch && !renderedTwitchFromStorage) {
          twitchConnectionStatus.textContent = 'Not Connected';
          twitchConnectionStatus.classList.remove('connected', 'error');
          connectTwitchBtn.textContent = 'Connect';
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
    // Check if first-time user to determine button text only
    const firstTime = await isFirstTimeUser();
    
    // Reset Riot connection UI - always show "Not Connected" for consistency
    riotConnectionStatus.textContent = 'Not Connected';
    riotConnectionStatus.classList.remove('connected', 'error');
    
    updateRiotButtonText('Connect');
    connectRiotBtn.disabled = false;
    currentRank.textContent = 'Unknown';
    rankBadgePreview.style.backgroundImage = 'none';
    refreshRankBtn.classList.add('hidden'); // Hide refresh button
    
    // Reset Twitch connection UI
    twitchConnectionStatus.textContent = 'Not Connected';
    twitchConnectionStatus.classList.remove('connected', 'error');
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
          updateRiotButtonText('Disconnecting...');
          
          try {
            // Use disconnect method to clear both tokens and persistent data
            await RiotAuth.disconnect();
            
            // Update UI manually
            riotConnectionStatus.textContent = 'Not Connected';
            riotConnectionStatus.classList.remove('connected');
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
            riotConnectionStatus.classList.remove('error', 'connected');
          } finally {
            // Re-enable button
            connectRiotBtn.disabled = false;
          }
          return; // Exit the function after disconnect flow
        }
      }
      
      // Connect flow - check if first time to determine UI behavior
      const isFirstTime = await isFirstTimeUser();
      
      // Show connecting in button only
      updateRiotButtonText('Connecting...');
      
      if (isFirstTime) {
        // Mark that connect button has been pressed so we switch to normal state afterwards
        await browser.storage.local.set({ 'eloward_signin_attempted': true });
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
        
        // Ensure background cache for local user is up-to-date
        updateBackgroundCacheForLocalUser(userData);
        
        // Store the connected region in storage and ensure the region selector reflects the current region
        await browser.storage.local.set({ selectedRegion: region });
              } catch (error) {
          
          // Show normal not connected state
          updateRiotButtonText('Connect');
          riotConnectionStatus.textContent = 'Not Connected';
          riotConnectionStatus.classList.remove('error', 'connected');
        } finally {
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
    browser.storage.local.set({ selectedRegion });
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
      try { await browser.storage.local.set({ eloward_last_rank_refresh_at: Date.now() }); } catch (_) {}
      
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
    // Ensure background cache for local user is up-to-date after refresh
    updateBackgroundCacheForLocalUser(userData);
    
    // Backend storage is now handled by getUserData() - no duplicate call needed
  }

  // Simple cache for the current user's rank badge image by tier, stored as a data URL
  async function getCachedBadgeDataUrl(tierKey) {
    try {
      const key = `eloward_cached_badge_image_${tierKey}`;
      const res = await browser.storage.local.get([key]);
      return res[key] || null;
    } catch (_) {
      return null;
    }
  }

  async function cacheBadgeImage(tierKey, imageUrl) {
    try {
      const response = await fetch(imageUrl, { cache: 'force-cache' });
      if (!response.ok) return;
      const blob = await response.blob();
      // Convert to data URL for instant subsequent loads
      const dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
      const key = `eloward_cached_badge_image_${tierKey}`;
      await browser.storage.local.set({ [key]: dataUrl });
    } catch (_) {
      // ignore cache errors
    }
  }

  async function prefetchAndCacheBadgeImage(tierKey, imageUrl) {
    const existing = await getCachedBadgeDataUrl(tierKey);
    if (!existing) {
      cacheBadgeImage(tierKey, imageUrl);
    }
  }

  async function displayRank(rankData) {
    if (!rankData) {
      currentRank.textContent = 'Unranked';
      const unrankedKey = 'unranked';
      const unrankedUrl = `https://eloward-cdn.unleashai.workers.dev/lol/unranked.png`;
      try {
        const cachedUnranked = await getCachedBadgeDataUrl(unrankedKey);
        if (cachedUnranked) {
          rankBadgePreview.style.backgroundImage = `url('${cachedUnranked}')`;
        } else {
          rankBadgePreview.style.backgroundImage = `url('${unrankedUrl}')`;
          prefetchAndCacheBadgeImage(unrankedKey, unrankedUrl);
        }
      } catch (_) {
        rankBadgePreview.style.backgroundImage = `url('${unrankedUrl}')`;
        prefetchAndCacheBadgeImage(unrankedKey, unrankedUrl);
      }
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
    const rankImageFileName = formattedTier.toLowerCase();
    const imageUrl = `https://eloward-cdn.unleashai.workers.dev/lol/${rankImageFileName}.png`;

    // Try cached image first for instant render; fall back to network and prefetch for next time
    try {
      const cached = await getCachedBadgeDataUrl(rankImageFileName);
      if (cached) {
        rankBadgePreview.style.backgroundImage = `url('${cached}')`;
      } else {
        rankBadgePreview.style.backgroundImage = `url('${imageUrl}')`;
        prefetchAndCacheBadgeImage(rankImageFileName, imageUrl);
      }
    } catch (_) {
      rankBadgePreview.style.backgroundImage = `url('${imageUrl}')`;
      prefetchAndCacheBadgeImage(rankImageFileName, imageUrl);
    }
    
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
      twitchConnectionStatus.classList.remove('error', 'connected');
      return;
    }
    
    try {
      // Check if user is already authenticated
      const isAuthenticated = await TwitchAuth.isAuthenticated();
      
      if (isAuthenticated) {
        // Disconnect flow
        connectTwitchBtn.textContent = 'Disconnecting...';
        connectTwitchBtn.disabled = true;
        
        // Use disconnect method to clear both tokens and persistent data
        await TwitchAuth.disconnect();
        
        // Update UI after logout
        twitchConnectionStatus.textContent = 'Not Connected';
        connectTwitchBtn.textContent = 'Connect';
        twitchConnectionStatus.classList.remove('connected');
        
        // Update Riot controls based on disconnected status
        updateRiotControlsBasedOnTwitchStatus();
      } else {
        // Connect flow
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
            twitchConnectionStatus.classList.remove('error', 'connected');
            connectTwitchBtn.textContent = 'Connect';
            
            // Update Riot controls based on failed connection
            updateRiotControlsBasedOnTwitchStatus();
          }
          
        } catch (authError) {
          twitchConnectionStatus.textContent = 'Not Connected';
          twitchConnectionStatus.classList.remove('error', 'connected');
          connectTwitchBtn.textContent = 'Connect';
          
          // Update Riot controls based on failed authentication
          updateRiotControlsBasedOnTwitchStatus();
          
          // Ensure the connected state is properly reset in case of error
          await PersistentStorage.updateConnectedState('twitch', false);
        }
      }
    } catch (error) {
      twitchConnectionStatus.textContent = 'Not Connected';
      twitchConnectionStatus.classList.remove('error', 'connected');
      
      // Ensure connected state is reset on error
      await PersistentStorage.updateConnectedState('twitch', false);
      
      // Update Riot controls based on error state
      updateRiotControlsBasedOnTwitchStatus();
    } finally {
      connectTwitchBtn.disabled = false;
    }
  }

  // Get references to all stored regions
  browser.storage.local.get(['selectedRegion']).then((result) => {
    // First clean up any old key that might exist
    browser.storage.local.remove('connected_region');
    
    // Set the region selector value
    if (result.selectedRegion) {
      regionSelect.value = result.selectedRegion;
    }
  });
}); 