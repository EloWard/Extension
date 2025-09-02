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
  



  function setRiotControlsDisabled(isDisabled, reason = '') {
    connectRiotBtn.disabled = isDisabled;
    // Keep region selector enabled so they can choose
    regionSelect.disabled = false;
    if (isDisabled) {
      const tooltip = reason === 'no_twitch'
        ? 'Connect Twitch account first'
        : reason === 'no_region'
          ? 'Select your region first'
          : 'Complete prerequisites first';
      connectRiotBtn.setAttribute('data-tooltip', tooltip);
      connectRiotBtn.classList.add('has-tooltip');
    } else {
      connectRiotBtn.removeAttribute('data-tooltip');
      connectRiotBtn.classList.remove('has-tooltip');
    }
  }


  function updateRiotControlsBasedOnTwitchStatus() {
    const isTwitchConnected = twitchConnectionStatus.classList.contains('connected') && 
                              twitchConnectionStatus.textContent !== 'Not Connected';
    const hasRegionSelected = !!regionSelect.value;
    if (!isTwitchConnected) {
      setRiotControlsDisabled(true, 'no_twitch');
      return;
    }
    if (!hasRegionSelected) {
      setRiotControlsDisabled(true, 'no_region');
      return;
    }
    setRiotControlsDisabled(false);
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
      const region = selectedRegion || '';

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


  setRiotControlsDisabled(true, 'no_twitch');


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
        // Hide region selector once Riot is connected
        try { regionSelect.classList.add('hidden'); } catch (_) {}
        
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
      // Initialize from persistent storage first - single source of truth
      const [persistentConnectedState, storedRiotData, storedTwitchData, regionData] = await Promise.all([
        PersistentStorage.getConnectedState(),
        PersistentStorage.getRiotUserData(),
        PersistentStorage.getTwitchUserData(),
        browser.storage.local.get(['selectedRegion'])
      ]);
      
      // Handle Riot authentication state
      if (storedRiotData && storedRiotData.riotId && storedRiotData.puuid) {
        const userData = {
          riotId: storedRiotData.riotId,
          puuid: storedRiotData.puuid,
          soloQueueRank: storedRiotData.rankInfo
        };
        
        // Always show user as connected if we have valid stored data
        updateUserInterface(userData);
        refreshRankBtn.classList.remove('hidden');
        riotConnectionStatus.textContent = userData.riotId;
        riotConnectionStatus.classList.add('connected');
        updateRiotButtonText('Disconnect');
        
        // Update background cache for consistency
        await updateBackgroundCacheForLocalUser(userData);
        
        // Set region from stored data
        if (regionData.selectedRegion) {
          regionSelect.value = regionData.selectedRegion;
        }
      } else if (persistentConnectedState.twitch) {
        // Try fallback for existing riot data only if no stored data exists
        try {
          const fallbackResult = await PersistentStorage.tryRiotDataFallback();
          if (fallbackResult.success) {
            // Recursively call checkAuthStatus to handle the newly stored data
            return await checkAuthStatus();
          }
        } catch (error) {
          // Backend fallback failed, continue with not connected UI
        }
        
        // Show not connected UI for Riot
        riotConnectionStatus.textContent = 'Not Connected';
        riotConnectionStatus.classList.remove('connected', 'error');
        updateRiotButtonText('Connect');
        connectRiotBtn.disabled = false;
        currentRank.textContent = 'Unranked';
        rankBadgePreview.style.backgroundImage = `url('https://eloward-cdn.unleashai.workers.dev/lol/unranked.png')`;
        rankBadgePreview.style.transform = 'translateY(-3px)';
        refreshRankBtn.classList.add('hidden');
        
        if (regionData.selectedRegion) {
          regionSelect.value = regionData.selectedRegion;
        }
      } else {
        // No Twitch connection, show not connected UI
        riotConnectionStatus.textContent = 'Not Connected';
        riotConnectionStatus.classList.remove('connected', 'error');
        updateRiotButtonText('Connect');
        currentRank.textContent = 'Unranked';
        rankBadgePreview.style.backgroundImage = `url('https://eloward-cdn.unleashai.workers.dev/lol/unranked.png')`;
        rankBadgePreview.style.transform = 'translateY(-3px)';
        refreshRankBtn.classList.add('hidden');
      }
      
      // Handle Twitch authentication state - prioritize stored data
      if (storedTwitchData && storedTwitchData.id) {
        twitchConnectionStatus.textContent = storedTwitchData.display_name || storedTwitchData.login;
        twitchConnectionStatus.classList.add('connected');
        twitchConnectionStatus.classList.remove('error');
        connectTwitchBtn.textContent = 'Disconnect';
        

      } else {
        twitchConnectionStatus.textContent = 'Not Connected';
        twitchConnectionStatus.classList.remove('connected', 'error');
        connectTwitchBtn.textContent = 'Connect';
      }
      
      // Update controls based on final state
      updateRiotControlsBasedOnTwitchStatus();
      
    } catch (error) {
      showNotConnectedUI();
    }
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
    
    // Show stored Twitch identity if available, else not connected
    try {
      const twitchStored = await PersistentStorage.getTwitchUserData();
      if (twitchStored) {
        twitchConnectionStatus.textContent = twitchStored.display_name || twitchStored.login || 'Connected';
        twitchConnectionStatus.classList.add('connected');
        twitchConnectionStatus.classList.remove('error');
        connectTwitchBtn.textContent = 'Disconnect';
      } else {
        twitchConnectionStatus.textContent = 'Not Connected';
        twitchConnectionStatus.classList.remove('connected', 'error');
        connectTwitchBtn.textContent = 'Connect';
      }
    } catch (_) {
      twitchConnectionStatus.textContent = 'Not Connected';
      twitchConnectionStatus.classList.remove('connected', 'error');
      connectTwitchBtn.textContent = 'Connect';
    }
    connectTwitchBtn.disabled = false;
    
    // Reset rank display and show unranked graphic
    currentRank.textContent = 'Unranked';
    rankBadgePreview.style.backgroundImage = `url('https://eloward-cdn.unleashai.workers.dev/lol/unranked.png')`;
    rankBadgePreview.style.transform = 'translateY(-3px)';
    
    // Ensure region selector is visible when not connected
    try { regionSelect.classList.remove('hidden'); } catch (_) {}

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
            // Show region selector again after disconnect
            try { regionSelect.classList.remove('hidden'); } catch (_) {}
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
      if (!region) {
        updateRiotButtonText('Connect');
        connectRiotBtn.disabled = false;
        setRiotControlsDisabled(true, 'no_region');
        return;
      }
      
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
          // Hide region selector after successful connection
          try { regionSelect.classList.add('hidden'); } catch (_) {}
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
    if (selectedRegion) {
      browser.storage.local.set({ selectedRegion });
    } else {
      browser.storage.local.remove('selectedRegion');
    }
    updateRiotControlsBasedOnTwitchStatus();
  }

  // Refresh rank function to update player rank information
  async function refreshRank() {
    try {
      console.log('[EloWard Popup] Manual rank refresh: requested');
      // Show a loading state on the button (add a rotating animation class)
      refreshRankBtn.classList.add('refreshing');
      refreshRankBtn.disabled = true; // Disable button while refreshing
      
      // Determine region (from selector or storage)
      let region = regionSelect.value;
      if (!region) {
        try {
          const res = await browser.storage.local.get(['selectedRegion']);
          region = res?.selectedRegion || '';
        } catch (_) {}
      }
      if (!region) {
        showAuthError('Select a region to refresh rank.');
        return;
      }
      
      const tryPerform = async () => {
        await performRankRefresh();
        try { await browser.storage.local.set({ eloward_last_rank_refresh_at: Date.now() }); } catch (_) {}
        console.log('[EloWard Popup] Manual rank refresh: successful');
      };
      
      let isAuthenticated = false;
      try { isAuthenticated = await RiotAuth.isAuthenticated(); } catch (_) { isAuthenticated = false; }
      
      if (isAuthenticated) {
        try {
          await tryPerform();
          return;
        } catch (error) {
          if (error?.name !== 'ReAuthenticationRequiredError') {
            throw error;
          }
          // fall through to re-auth flows
        }
      }
      
      // Re-authentication required - prompt user to reconnect
      try {
        await RiotAuth.authenticate(region);
        const userData = await RiotAuth.getUserData();
        try { await PersistentStorage.storeRiotUserData(userData); } catch (_) {}
        updateUserInterface(userData);
        updateBackgroundCacheForLocalUser(userData);
        await tryPerform();
        console.log('[EloWard Popup] Manual rank refresh after interactive re-auth: successful');
        return;
      } catch (interactiveErr) {
        // Silently fail on refresh re-auth errors; keep persistent data and UI intact
        return;
        }
    } catch (error) {
      console.warn('[EloWard Popup] Manual rank refresh: failed', error?.message || error);
      // Silently fail; leave persistent Riot data and current UI state intact
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
    // Get PUUID from persistent storage instead of making token-based API call
    const persistentRiotData = await PersistentStorage.getRiotUserData();
    
    if (!persistentRiotData || !persistentRiotData.puuid) {
      throw new Error('Account information not available. Please reconnect your Riot account.');
    }
    
    // Use simplified PUUID-only refresh
    const refreshedRankData = await RiotAuth.refreshRank(persistentRiotData.puuid);
    
    // Update the persistent data with new rank information
    const updatedUserData = {
      ...persistentRiotData,
      soloQueueRank: {
        tier: refreshedRankData.tier,
        rank: refreshedRankData.rank,
        leaguePoints: refreshedRankData.lp
      }
    };
    
    console.log('[EloWard Popup] rank: refreshed');
    
    updateUserInterface(updatedUserData);
    await PersistentStorage.storeRiotUserData(updatedUserData);
    // Ensure background cache for local user is up-to-date after refresh
    updateBackgroundCacheForLocalUser(updatedUserData);
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
          await TwitchAuth.authenticate();
          // After successful authenticate, the worker registers the user; just read from storage
          const userData = await PersistentStorage.getTwitchUserData();
          if (userData) {
            twitchConnectionStatus.textContent = userData.display_name || userData.login;
            twitchConnectionStatus.classList.add('connected');
            twitchConnectionStatus.classList.remove('error');
            connectTwitchBtn.textContent = 'Disconnect';
            updateRiotControlsBasedOnTwitchStatus();
          } else {
            throw new Error('Failed to retrieve user info');
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
    } else {
      regionSelect.value = '';
    }
    updateRiotControlsBasedOnTwitchStatus();
  });
}); 