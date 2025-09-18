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
  const optionsHeader = document.getElementById('options-header');
  const optionsContent = document.getElementById('options-content');
  const optionsDropdownArrow = optionsHeader.querySelector('.dropdown-arrow');
  const connectTwitchBtn = document.getElementById('connect-twitch');
  const twitchConnectionStatus = document.getElementById('twitch-connection-status');
  const accountHeader = document.getElementById('account-header');
  const accountContent = document.getElementById('account-content');
  const accountDropdownArrow = accountHeader.querySelector('.dropdown-arrow');
  const premiumStar = document.getElementById('premium-star');
  



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

  // Update premium star visibility based on plus_active status
  function updatePremiumStar(isPremium) {
    if (premiumStar) {
      premiumStar.style.display = isPremium ? 'flex' : 'none';
    }
  }

  // Check if user has plus_active status
  async function checkPlusActiveStatus() {
    try {
      const riotData = await PersistentStorage.getRiotUserData();
      return riotData?.plus_active || false;
    } catch (error) {
      console.warn('[EloWard Popup] Failed to check plus_active status:', error);
      return false;
    }
  }

  // Plus Feature Tooltip System - Leveraging existing tooltip infrastructure
  let currentPlusTooltip = null;
  let plusTooltipTimer = null;

  function createPlusTooltip() {
    const tooltip = document.createElement('div');
    tooltip.className = 'plus-feature-tooltip';
    tooltip.innerHTML = `
      <div class="plus-feature-tooltip-title">EloWard Plus</div>
      <div class="plus-feature-tooltip-description">Unlock premium customizations</div>
      <a href="https://www.eloward.com/dashboard" target="_blank" class="plus-feature-tooltip-link">Subscribe</a>
    `;
    return tooltip;
  }

  function showPlusTooltip(targetElement) {
    clearTimeout(plusTooltipTimer);
    
    if (currentPlusTooltip) return; // Already showing
    
    currentPlusTooltip = createPlusTooltip();
    document.body.appendChild(currentPlusTooltip);
    
    // Position tooltip after it's rendered for accurate dimensions
    requestAnimationFrame(() => {
      if (!currentPlusTooltip) return;
      
      const rect = targetElement.getBoundingClientRect();
      const tooltipRect = currentPlusTooltip.getBoundingClientRect();
      
      // Center horizontally above the target
      const left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
      const top = rect.top - tooltipRect.height - 12;
      
      // Ensure tooltip stays within viewport
      const finalLeft = Math.max(10, Math.min(left, window.innerWidth - tooltipRect.width - 10));
      const finalTop = Math.max(10, top);
      
      currentPlusTooltip.style.left = `${finalLeft}px`;
      currentPlusTooltip.style.top = `${finalTop}px`;
      currentPlusTooltip.classList.add('visible');
    });
    
    // Add interaction listeners for smooth hover behavior
    const hideTooltip = () => {
      plusTooltipTimer = setTimeout(() => {
        if (currentPlusTooltip) {
          currentPlusTooltip.remove();
          currentPlusTooltip = null;
        }
      }, 300);
    };

    currentPlusTooltip.addEventListener('mouseenter', () => clearTimeout(plusTooltipTimer));
    currentPlusTooltip.addEventListener('mouseleave', hideTooltip);
    targetElement.addEventListener('mouseleave', hideTooltip, { once: true });
  }

  function initializePlusFeatures(isPlusActive) {
    const toggles = ['use-peak-rank', 'show-animated-badge'];
    
    toggles.forEach(toggleId => {
      const toggle = document.getElementById(toggleId);
      if (!toggle) return;
      
      const label = toggle.parentElement;
      const isWrapped = label.parentElement.classList.contains('plus-feature-container');
      
      if (isPlusActive && isWrapped) {
        // Remove wrapper for Plus users
        const wrapper = label.parentElement;
        wrapper.parentElement.insertBefore(label, wrapper);
        wrapper.remove();
      } else if (!isPlusActive && !isWrapped) {
        // Add wrapper for non-Plus users
        const wrapper = document.createElement('div');
        wrapper.className = 'plus-feature-container';
        label.parentElement.insertBefore(wrapper, label);
        wrapper.appendChild(label);
        
        // Add hover behavior
        wrapper.addEventListener('mouseenter', () => {
          clearTimeout(plusTooltipTimer);
          plusTooltipTimer = setTimeout(() => showPlusTooltip(wrapper), 150);
        });
        wrapper.addEventListener('mouseleave', () => clearTimeout(plusTooltipTimer));
      }
    });
  }

  // Shared function to fetch and process complete user data from backend
  async function fetchAndProcessUserData(puuid, baseUserData = null) {
    try {
      // Input validation
      if (!puuid || typeof puuid !== 'string' || puuid.length < 10) {
        console.warn('[EloWard Popup] Invalid PUUID provided to fetchAndProcessUserData');
        return baseUserData;
      }

      const response = await browser.runtime.sendMessage({
        action: 'fetch_rank_by_puuid',
        puuid: puuid
      });

      // Validate response structure
      if (!response) {
        throw new Error('No response from background script');
      }
      
      if (response.error) {
        throw new Error(`Background script error: ${response.error}`);
      }

      if (response?.success && response?.rankData) {
        const backendData = response.rankData;
        
        // Create updated user data structure
        const updatedUserData = baseUserData ? {
          ...baseUserData,
          plus_active: backendData.plus_active || false,
          show_peak: backendData.show_peak || false,
          animate_badge: backendData.animate_badge || false,
          soloQueueRank: {
            tier: backendData.rank_tier,
            division: backendData.rank_division,
            leaguePoints: backendData.lp
          }
        } : {
          puuid: puuid,
          riotId: backendData.summonerName,
          region: backendData.region,
          plus_active: backendData.plus_active || false,
          show_peak: backendData.show_peak || false,
          animate_badge: backendData.animate_badge || false,
          soloQueueRank: {
            tier: backendData.rank_tier,
            division: backendData.rank_division,
            leaguePoints: backendData.lp
          }
        };

        // Update local storage with effective options from backend
        await saveOptionsToStorage({
          show_peak: updatedUserData.show_peak,
          animate_badge: updatedUserData.animate_badge,
          plus_active: updatedUserData.plus_active
        });

        return updatedUserData;
      }

      return baseUserData;
    } catch (error) {
      console.warn('[EloWard Popup] Failed to fetch complete user data:', error);
      return baseUserData;
    }
  }

  // Extract rank data for display - simplified since we now use consistent structure
  function extractRankDataForDisplay(userData) {
    if (!userData?.soloQueueRank?.tier) {
      return null;
    }
    
    const rankInfo = {
      tier: userData.soloQueueRank.tier,
      division: userData.soloQueueRank.division,
      leaguePoints: userData.soloQueueRank.leaguePoints
    };
    
    // Ensure tier is properly capitalized
    const tierUpper = rankInfo.tier.toUpperCase();
    rankInfo.tier = tierUpper.charAt(0) + tierUpper.slice(1).toLowerCase();
    
    return rankInfo;
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
  

 

  initializeAccountSectionState();
  initializeOptionsSectionState();

  // Initialize options as disabled until we know connection status
  updateOptionsBasedOnRiotConnection();

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
  

  optionsHeader.addEventListener('click', () => {
    const isHidden = optionsContent.style.display === 'none';
    
    // Toggle the display of the content
    if (isHidden) {
      optionsContent.style.display = 'block';
      optionsDropdownArrow.classList.add('rotated');
    } else {
      optionsContent.style.display = 'none';
      optionsDropdownArrow.classList.remove('rotated');
    }
    
    // Save the collapsed state to storage
    browser.storage.local.set({ 'optionsSectionCollapsed': !isHidden });
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
      // Default to expanded on error
      accountContent.style.display = 'block';
      accountDropdownArrow.classList.add('rotated');
    }
  }

  async function initializeOptionsSectionState() {
    try {
      const result = await browser.storage.local.get(['optionsSectionCollapsed']);
      const isCollapsed = result.optionsSectionCollapsed;
      
      // Default to expanded (false) if not set
      if (isCollapsed === undefined || isCollapsed === false) {
        optionsContent.style.display = 'block';
        optionsDropdownArrow.classList.add('rotated');
      } else {
        optionsContent.style.display = 'none';
        optionsDropdownArrow.classList.remove('rotated');
      }
    } catch (error) {
      // Default to expanded on error
      optionsContent.style.display = 'block';
      optionsDropdownArrow.classList.add('rotated');
    }
  }



  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {

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
        
        // Use standardized rank data extraction
        const rankInfo = extractRankDataForDisplay(userData);

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


  async function showAuthError(_message) {
    riotConnectionStatus.textContent = 'Not Connected';
    riotConnectionStatus.classList.remove('error', 'connected');
    
    // Update options to disabled state since Riot connection failed
    updateOptionsBasedOnRiotConnection();
    
    await isFirstTimeUser(); // Check for side effects but don't use return value
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
      
      // Handle Twitch authentication state FIRST - never block this
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
      
      // Handle Riot authentication state
      if (storedRiotData && storedRiotData.riotId && storedRiotData.puuid) {
        const userData = {
          riotId: storedRiotData.riotId,
          puuid: storedRiotData.puuid,
          soloQueueRank: storedRiotData.soloQueueRank,
          plus_active: storedRiotData.plus_active || false
        };
        
        // Always show user as connected if we have valid stored data
        updateUserInterface(userData);
        refreshRankBtn.classList.remove('hidden');
        riotConnectionStatus.textContent = userData.riotId;
        riotConnectionStatus.classList.add('connected');
        updateRiotButtonText('Disconnect');
        
        // Update options based on new connection state
        updateOptionsBasedOnRiotConnection();
        
        // Initialize user options (loads instantly from cache, syncs in background)
        initializeUserOptions().catch(() => {});
        
        // Set region from stored data
        if (regionData.selectedRegion) {
          regionSelect.value = regionData.selectedRegion;
        }
      } else {
        // Show not connected UI for Riot immediately
        riotConnectionStatus.textContent = 'Not Connected';
        riotConnectionStatus.classList.remove('connected', 'error');
        updateRiotButtonText('Connect');
        connectRiotBtn.disabled = false;
        currentRank.textContent = 'Unranked';
        rankBadgePreview.style.backgroundImage = `url('https://eloward-cdn.unleashai.workers.dev/lol/unranked.png')`;
        rankBadgePreview.style.transform = 'translateY(-3px)';
        refreshRankBtn.classList.add('hidden');
        
        // Update options to disabled state since Riot is not connected
        updateOptionsBasedOnRiotConnection();
        
        if (regionData.selectedRegion) {
          regionSelect.value = regionData.selectedRegion;
        }
        
        // Try fallback asynchronously if Twitch connected (non-blocking)
        if (persistentConnectedState.twitch) {
          PersistentStorage.tryRiotDataFallback()
            .then(async (fallbackResult) => {
              if (fallbackResult.success) {
                const userData = {
                  riotId: fallbackResult.data.riotId,
                  puuid: fallbackResult.data.puuid,
                  soloQueueRank: fallbackResult.data.soloQueueRank,
                  plus_active: fallbackResult.data.plus_active
                };
                
                updateUserInterface(userData);
                riotConnectionStatus.textContent = userData.riotId;
                riotConnectionStatus.classList.add('connected');
                updateRiotButtonText('Disconnect');
                refreshRankBtn.classList.remove('hidden');
                
                // Update options based on new connection state
                updateOptionsBasedOnRiotConnection();
                
                // Store user options from fallback response (no need for separate API call)
                if (fallbackResult.data.show_peak !== undefined || fallbackResult.data.animate_badge !== undefined) {
                  await saveOptionsToStorage({
                    show_peak: Boolean(fallbackResult.data.show_peak),
                    animate_badge: Boolean(fallbackResult.data.animate_badge),
                    plus_active: Boolean(fallbackResult.data.plus_active)
                  });
                }
                
                // Initialize options UI with the data we already have
                await initializeUserOptions();
                
              }
            })
            .catch(() => {
              // Fallback failed, UI already shows not connected
            });
        }
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
    await isFirstTimeUser(); // Check for side effects but don't use return value
    
    // Reset Riot connection UI - always show "Not Connected" for consistency
    riotConnectionStatus.textContent = 'Not Connected';
    riotConnectionStatus.classList.remove('connected', 'error');
    
    updateRiotButtonText('Connect');
    connectRiotBtn.disabled = false;
    currentRank.textContent = 'Unknown';
    
    // Update options to disabled state since Riot is not connected
    updateOptionsBasedOnRiotConnection();
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
            
            // Clear cached options since user is disconnecting
            await clearOptionsFromStorage();
            
            // Update UI manually
            riotConnectionStatus.textContent = 'Not Connected';
            riotConnectionStatus.classList.remove('connected');
            updateRiotButtonText('Connect');
            
            // Update options to disabled state since Riot is disconnected
            updateOptionsBasedOnRiotConnection();
            
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
            
            // Update options to disabled state since Riot connection failed
            updateOptionsBasedOnRiotConnection();
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
        
        // Fetch complete user data from backend using shared function
        const updatedUserData = await fetchAndProcessUserData(userData?.puuid, userData);
        
        // Store user data in persistent storage (with plus_active if fetched)
        await PersistentStorage.storeRiotUserData(updatedUserData);
        
        // Update UI with the user data
        updateUserInterface(updatedUserData);
        
        // Update options based on new connection state and initialize options UI
        updateOptionsBasedOnRiotConnection();
        await initializeUserOptions();
        
        
        // Store the connected region in storage and ensure the region selector reflects the current region
        await browser.storage.local.set({ selectedRegion: region });
          // Hide region selector after successful connection
          try { regionSelect.classList.add('hidden'); } catch (_) {}
              } catch (error) {
          
          // Show normal not connected state
          updateRiotButtonText('Connect');
          riotConnectionStatus.textContent = 'Not Connected';
          riotConnectionStatus.classList.remove('error', 'connected');
          
          // Update options to disabled state since Riot connection failed
          updateOptionsBasedOnRiotConnection();
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
      };
      
      let isAuthenticated = false;
      try { isAuthenticated = await RiotAuth.isAuthenticated(); } catch (_) { isAuthenticated = false; }
      
      if (isAuthenticated) {
        try {
          await tryPerform();
          console.log('[EloWard Popup] Manual rank refresh: completed successfully');
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
        const userData = await RiotAuth.getUserDataFromStorage();
        
        // Fetch complete user data from backend using shared function
        const updatedUserData = await fetchAndProcessUserData(userData?.puuid, userData);
        
        try { await PersistentStorage.storeRiotUserData(updatedUserData); } catch (_) {}
        updateUserInterface(updatedUserData);
        await tryPerform();
        console.log('[EloWard Popup] Manual rank refresh: completed successfully (after re-auth)');
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
    
    // Backend already returns the correct rank (current or peak) based on user's show_peak setting
    // So we use the returned rank data directly instead of overriding it
    const updatedUserData = {
      ...persistentRiotData,
      soloQueueRank: {
        tier: refreshedRankData.rank_tier,
        division: refreshedRankData.rank_division,
        leaguePoints: refreshedRankData.lp
      },
      // Store additional options data that might have been updated
      plus_active: refreshedRankData.plus_active
    };
    
    updateUserInterface(updatedUserData);
    await PersistentStorage.storeRiotUserData(updatedUserData);
  }

  // Badge cache versioning - increment this when badge images are updated on CDN
  const BADGE_CACHE_VERSION = '2';

  // Simple cache for the current user's rank badge image by tier, stored as a data URL
  async function getCachedBadgeDataUrl(tierKey, isAnimated = false) {
    try {
      // Create cache key that distinguishes between animated and static versions
      const suffix = isAnimated ? '_animated' : '_static';
      const key = `eloward_cached_badge_image_${tierKey}${suffix}_v${BADGE_CACHE_VERSION}`;
      const res = await browser.storage.local.get([key]);
      return res[key] || null;
    } catch (_) {
      return null;
    }
  }

  async function cacheBadgeImage(tierKey, imageUrl, isAnimated = false) {
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
      // Create cache key that distinguishes between animated and static versions
      const suffix = isAnimated ? '_animated' : '_static';
      const key = `eloward_cached_badge_image_${tierKey}${suffix}_v${BADGE_CACHE_VERSION}`;
      await browser.storage.local.set({ [key]: dataUrl });
    } catch (_) {
      // ignore cache errors
    }
  }

  async function prefetchAndCacheBadgeImage(tierKey, imageUrl, isAnimated = false) {
    const existing = await getCachedBadgeDataUrl(tierKey, isAnimated);
    if (!existing) {
      cacheBadgeImage(tierKey, imageUrl, isAnimated);
    }
  }

  // Track cleanup completion in memory (more efficient than storage-based tracking)
  let badgeCacheCleanupCompleted = false;

  // Clean up old badge cache entries (removes outdated versions)
  async function cleanupOldBadgeCache() {
    // Skip if already cleaned this session
    if (badgeCacheCleanupCompleted) {
      return;
    }
    
    try {
      // Get all storage data to find badge cache keys  
      const allData = await browser.storage.local.get();
      const keysToRemove = Object.keys(allData).filter(key => 
        key.startsWith('eloward_cached_badge_image_') && 
        !key.includes(`_v${BADGE_CACHE_VERSION}`)
      );
      
      if (keysToRemove.length > 0) {
        await browser.storage.local.remove(keysToRemove);
      }
      
      // Mark cleanup as completed for this session
      badgeCacheCleanupCompleted = true;
    } catch (error) {
      console.warn('[EloWard] Failed to clean up old badge cache:', error);
    }
  }

  async function displayRank(rankData) {
    // Check plus_active status for premium star visibility only
    let hasPlus = rankData?.plus_active || false;
    if (!hasPlus) {
      try {
        const riotData = await PersistentStorage.getRiotUserData();
        hasPlus = riotData?.plus_active || false;
      } catch (_) {
        hasPlus = false;
      }
    }
    
    // Update premium star visibility based on plus_active
    updatePremiumStar(hasPlus);
    
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
    
    // Check if we should use animated badges - simply check local storage
    let useAnimated = false;
    try {
      const userOptions = await loadOptionsFromStorage();
      useAnimated = userOptions?.animate_badge || false;
    } catch (_) {
      useAnimated = false;
    }

    // Determine the rank badge image path with animation support
    const rankImageFileName = formattedTier.toLowerCase();
    const extension = useAnimated ? '.webp' : '.png';
    const suffix = useAnimated ? '_premium' : '';  // animated badges use _premium suffix
    const imageUrl = `https://eloward-cdn.unleashai.workers.dev/lol/${rankImageFileName}${suffix}${extension}`;

    // Try cached image first for instant render; fall back to network and prefetch for next time
    try {
      const cached = await getCachedBadgeDataUrl(rankImageFileName, useAnimated);
      if (cached) {
        rankBadgePreview.style.backgroundImage = `url('${cached}')`;
      } else {
        rankBadgePreview.style.backgroundImage = `url('${imageUrl}')`;
        prefetchAndCacheBadgeImage(rankImageFileName, imageUrl, useAnimated);
      }
    } catch (_) {
      rankBadgePreview.style.backgroundImage = `url('${imageUrl}')`;
      prefetchAndCacheBadgeImage(rankImageFileName, imageUrl, useAnimated);
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
        
        // Clear cached options since user is disconnecting
        await clearOptionsFromStorage();
        
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

  // Fetch fresh rank data from backend when popup opens
  async function refreshLocalUserRankData() {
    try {
      const riotData = await PersistentStorage.getRiotUserData();
      
      // Only refresh if we have a PUUID
      if (!riotData?.puuid) {
        return;
      }
      
      // Fetch complete rank + options data using shared function
      const updatedUserData = await fetchAndProcessUserData(riotData.puuid, riotData);
      
      if (updatedUserData !== riotData) {
        // Store updated riot data
        await PersistentStorage.storeRiotUserData(updatedUserData);
        
        // Batch DOM updates for better performance
        requestAnimationFrame(() => {
          const rankDataForDisplay = extractRankDataForDisplay(updatedUserData);
          if (rankDataForDisplay) {
            displayRank(rankDataForDisplay);
          }
          
          // Update premium star based on fresh plus_active data
          updatePremiumStar(updatedUserData.plus_active || false);
          
          // Update Plus feature wrappers based on fresh plus_active data
          initializePlusFeatures(updatedUserData.plus_active || false);
          
          // Update toggle states to match effective options
          const showPeakToggle = document.getElementById('use-peak-rank');
          const animateBadgeToggle = document.getElementById('show-animated-badge');
          if (showPeakToggle) showPeakToggle.checked = updatedUserData.show_peak;
          if (animateBadgeToggle) animateBadgeToggle.checked = updatedUserData.animate_badge;
        });
      }
    } catch (error) {
      // Silently fail - popup will show existing data
      console.warn('[EloWard Popup] Failed to refresh rank data:', error);
    }
  }

  // Helper function to update user rank cache with new option values
  async function updateLocalUserRankCache(twitchUsername, field, value) {
    try {
      if (!twitchUsername) return;
      
      // Send message to background script to update the cache
      const response = await browser.runtime.sendMessage({
        action: 'update_user_cache_option',
        username: twitchUsername.toLowerCase(),
        field: field,
        value: value
      });
      
      if (response?.success) {
        console.log(`[Popup] Updated user cache ${field} to ${value} for ${twitchUsername}`);
      }
    } catch (error) {
      console.warn(`[Popup] Failed to update user cache for ${field}:`, error);
    }
  }

  async function updateUserOption(field, value) {
    try {
      const [riotData, twitchData] = await Promise.all([
        PersistentStorage.getRiotUserData(),
        PersistentStorage.getTwitchUserData()
      ]);
      
      if (!riotData?.puuid) {
        throw new Error('No PUUID available');
      }
      
      if (!twitchData?.login) {
        throw new Error('No Twitch username available');
      }

      const requestBody = { 
        puuid: riotData.puuid,
        twitch_username: twitchData.login
      };
      requestBody[field] = value;

      const response = await fetch('https://eloward-ranks.unleashai.workers.dev/api/options', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const updatedOptions = await response.json();
      
      // Update only the specific field in local storage to avoid overwriting other preferences
      const currentOptions = await loadOptionsFromStorage() || {};
      currentOptions[field] = value;
      await saveOptionsToStorage(currentOptions);
      
      // Update user rank cache if it exists
      await updateLocalUserRankCache(twitchData.login, field, value);
      
      // If show_peak changed, trigger a rank refresh to get the correct rank data
      if (field === 'show_peak') {
        // Simulate clicking the refresh button - trigger refresh with animation
        await refreshRank();
      }
      
      return updatedOptions;
    } catch (error) {
      console.error('[EloWard Popup] Error updating user option:', error);
      throw error;
    }
  }

  // Load user options from local storage for instant display
  async function loadOptionsFromStorage() {
    try {
      const stored = await browser.storage.local.get(['eloward_user_options']);
      return stored.eloward_user_options || null;
    } catch (error) {
      console.warn('[EloWard Popup] Error loading options from storage:', error);
      return null;
    }
  }

  // Save user options to local storage
  async function saveOptionsToStorage(options) {
    try {
      await browser.storage.local.set({
        eloward_user_options: {
          show_peak: Boolean(options.show_peak),
          animate_badge: Boolean(options.animate_badge),
          plus_active: Boolean(options.plus_active),
          cached_at: Date.now()
        }
      });
    } catch (error) {
      console.warn('[EloWard Popup] Error saving options to storage:', error);
    }
  }

  // Clear user options from local storage (used on disconnect)
  async function clearOptionsFromStorage() {
    try {
      await browser.storage.local.remove(['eloward_user_options']);
    } catch (error) {
      console.warn('[EloWard Popup] Error clearing options from storage:', error);
    }
  }

  function updateOptionsBasedOnRiotConnection() {
    const showPeakToggle = document.getElementById('use-peak-rank');
    const animateBadgeToggle = document.getElementById('show-animated-badge');
    
    if (!showPeakToggle || !animateBadgeToggle) {
      return;
    }

    // Check if Riot is connected by looking at the status element
    const riotConnectionStatus = document.getElementById('riot-connection-status');
    const isRiotConnected = riotConnectionStatus && riotConnectionStatus.classList.contains('connected');
    
    // Get the option item containers
    const showPeakOption = showPeakToggle.closest('.option-item');
    const animateBadgeOption = animateBadgeToggle.closest('.option-item');
    
    if (isRiotConnected) {
      // Enable options when Riot is connected
      if (showPeakOption) showPeakOption.classList.remove('disabled');
      if (animateBadgeOption) animateBadgeOption.classList.remove('disabled');
      showPeakToggle.disabled = false;
      animateBadgeToggle.disabled = false;
    } else {
      // Disable options when Riot is not connected
      if (showPeakOption) showPeakOption.classList.add('disabled');
      if (animateBadgeOption) animateBadgeOption.classList.add('disabled');
      showPeakToggle.disabled = true;
      animateBadgeToggle.disabled = true;
    }
  }

  async function initializeUserOptions() {
    try {
      const showPeakToggle = document.getElementById('use-peak-rank');
      const animateBadgeToggle = document.getElementById('show-animated-badge');
      
      if (!showPeakToggle || !animateBadgeToggle) {
        return;
      }

      // Check Plus status to determine if we need to wrap Plus features
      const hasPlus = await checkPlusActiveStatus();
      
      // Initialize Plus feature wrappers based on current status
      initializePlusFeatures(hasPlus);

      // Update options state based on Riot connection first
      updateOptionsBasedOnRiotConnection();

      // Step 1: Instantly load from local storage (no animation)
      const cachedOptions = await loadOptionsFromStorage();
      if (cachedOptions) {
        // Disable transitions to prevent any visual flicker
        showPeakToggle.parentElement.classList.add('no-transition');
        animateBadgeToggle.parentElement.classList.add('no-transition');
        
        // Set states immediately from cache - no calculations, just display what's stored
        showPeakToggle.checked = cachedOptions.show_peak;
        animateBadgeToggle.checked = cachedOptions.animate_badge;
        
        // Re-enable transitions after immediate setting
        setTimeout(() => {
          showPeakToggle.parentElement.classList.remove('no-transition');
          animateBadgeToggle.parentElement.classList.remove('no-transition');
        }, 10);
      }

      // Step 2: Add event listeners (only add once)
      if (!showPeakToggle.hasAttribute('data-initialized')) {
        showPeakToggle.setAttribute('data-initialized', 'true');
        let isProcessing = false;
        
        showPeakToggle.addEventListener('change', async (e) => {
          // Prevent changes if Riot is not connected
          if (showPeakToggle.disabled) {
            e.preventDefault();
            e.target.checked = !e.target.checked;
            return;
          }
          
          // Prevent concurrent operations
          if (isProcessing) {
            e.preventDefault();
            e.target.checked = !e.target.checked;
            return;
          }
          
          isProcessing = true;
          
          try {
            // Check plus_active status before making backend call
            const hasPlus = await checkPlusActiveStatus();
            if (!hasPlus) {
              e.target.checked = !e.target.checked;
              return;
            }
            
            await updateUserOption('show_peak', e.target.checked);
          } catch (error) {
            // Revert toggle on error
            e.target.checked = !e.target.checked;
            console.error('Failed to update show_peak option:', error);
            
            // For premium features, the hover tooltip already handles messaging
          } finally {
            isProcessing = false;
          }
        });
      }

      if (!animateBadgeToggle.hasAttribute('data-initialized')) {
        animateBadgeToggle.setAttribute('data-initialized', 'true');
        let isProcessing = false;
        
        animateBadgeToggle.addEventListener('change', async (e) => {
          // Prevent changes if Riot is not connected
          if (animateBadgeToggle.disabled) {
            e.preventDefault();
            e.target.checked = !e.target.checked;
            return;
          }
          
          // Prevent concurrent operations
          if (isProcessing) {
            e.preventDefault();
            e.target.checked = !e.target.checked;
            return;
          }
          
          isProcessing = true;
          
          try {
            // Check plus_active status before making backend call
            const hasPlus = await checkPlusActiveStatus();
            if (!hasPlus) {
              e.target.checked = !e.target.checked;
              return;
            }
            
            await updateUserOption('animate_badge', e.target.checked);
            // Refresh the rank display to show the updated badge style
            await refreshLocalUserRankData();
          } catch (error) {
            // Revert toggle on error
            e.target.checked = !e.target.checked;
            console.error('Failed to update animate_badge option:', error);
            
            // For premium features, the hover tooltip already handles messaging
          } finally {
            isProcessing = false;
          }
        });
      }

      // Note: Backend sync is handled by refreshLocalUserRankData() which gets all options + rank data in one call

    } catch (error) {
      console.warn('[EloWard Popup] Error initializing user options:', error);
    }
  }

  // Clean up old cache entries (non-blocking)
  cleanupOldBadgeCache().catch(() => {});

  // Call refresh function after popup loads (non-blocking)
  refreshLocalUserRankData().catch(() => {});
}); 