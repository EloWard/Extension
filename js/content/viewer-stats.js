/**
 * EloWard Viewer Tracking Content Script
 * Tracks tab-based viewing time and qualifies viewers after 5 minutes
 * 
 * This script should be injected into Twitch pages by the extension
 * to track viewer engagement with streams. Tracking continues as long as
 * the tab is open, regardless of whether it's in focus or video is paused.
 * 
 * Multi-tab support: Each Twitch tab tracks independently. Users can have
 * multiple streams open and each will track separately.
 */

(function() {
  'use strict';

  // Configuration
  const QUALIFY_THRESHOLD_SECONDS = 300; // 5 minutes
  const BACKEND_URL = 'https://eloward-users.unleashai.workers.dev';
  const STORAGE_KEY_PREFIX = 'eloward_viewer_';

  // State management
  let currentChannel = null;
  let riotPuuid = null;
  let playTimeSeconds = 0;
  let isTracking = false;
  let lastUpdateTime = null;
  let qualificationSent = new Set(); // Track sent qualifications per session
  let trackingIntervalId = null; // Store interval ID to clear when done

  // Enhanced logging
  function log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logMessage = `[EloWard Viewer Tracking ${timestamp}] ${message}`;
    
    if (data) {
      console[level](logMessage, data);
    } else {
      console[level](logMessage);
    }
  }

  function logInfo(message, data = null) {
    log('info', message, data);
  }

  function logError(message, data = null) {
    log('error', message, data);
  }

  function logWarn(message, data = null) {
    log('warn', message, data);
  }

  function logDebug(message, data = null) {
    log('log', `[DEBUG] ${message}`, data);
  }

  // Debug helper - expose state to console for debugging
  function getDebugState() {
    return {
      currentChannel,
      riotPuuid: riotPuuid ? riotPuuid.substring(0, 8) + '...' : null,
      playTimeSeconds: Math.floor(playTimeSeconds),
      isTracking,
      qualificationSent: Array.from(qualificationSent),
      currentWindow: getCurrentWindow(),
      threshold: QUALIFY_THRESHOLD_SECONDS,
      // Game detection state from content.js
      gameDetection: {
        isChannelActive: window.elowardExtensionState?.isChannelActive || false,
        currentGame: window.elowardExtensionState?.currentGame || 'unknown',
        isLoL: window.elowardExtensionState?.currentGame === 'League of Legends'
      },
      localStorage: Object.keys(localStorage).filter(k => k.includes('eloward')),
      extensionStorage: 'Use chrome.storage.local.get() to check extension data'
    };
  }

  // Debug helper to check extension storage
  function checkExtensionStorage() {
    chrome.storage.local.get(['eloward_persistent_riot_user_data', 'eloward_persistent_connected_state'], (data) => {
      console.log('[EloWard Debug] Extension Storage:', {
        riotData: data.eloward_persistent_riot_user_data,
        connectedState: data.eloward_persistent_connected_state
      });
    });
  }

  // Expose debug functions to global scope for console access
  window.elowardViewerDebug = getDebugState;
  window.elowardCheckStorage = checkExtensionStorage;

  /**
   * Get current viewer window start date (7am UTC reset)
   */
  function getCurrentWindow() {
    const now = new Date();
    const utcHour = now.getUTCHours();
    
    // If before 07:00 UTC, we're still in yesterday's window
    if (utcHour < 7) {
      now.setUTCDate(now.getUTCDate() - 1);
    }
    
    // Format as YYYY-MM-DD
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    
    const window = `${year}-${month}-${day}`;
    return window;
  }

  /**
   * Get channel name from current URL
   * Uses the same robust logic as content.js to handle all Twitch URL patterns
   */
  function getChannelFromUrl() {
    const pathname = window.location.pathname;
    const pathSegments = pathname.split('/');

    // Handle normal channel view: /[channel] or /[channel]/videos etc.
    // Same logic as content.js getCurrentChannelName()
    let channel = null;
    if (pathSegments[1] &&
        pathSegments[1] !== 'oauth2' &&
        !pathSegments[1].includes('auth')) {
      channel = pathSegments[1].toLowerCase();
    }

    return channel;
  }

  /**
   * Load viewer's PUUID from extension storage or API
   */
  async function loadViewerPuuid() {
    try {
      return new Promise((resolve) => {
        chrome.storage.local.get(['eloward_persistent_riot_user_data'], (data) => {
          const riotData = data?.eloward_persistent_riot_user_data;
          if (riotData?.puuid) {
            resolve(riotData.puuid);
          } else {
            logWarn('No Riot account connected - viewer tracking unavailable');
            resolve(null);
          }
        });
      });
    } catch (error) {
      logError('Failed to load PUUID', error);
      return null;
    }
  }

  /**
   * Get storage key for current channel and window
   */
  function getStorageKey() {
    const window = getCurrentWindow();
    return `${STORAGE_KEY_PREFIX}${currentChannel}_${window}`;
  }

  /**
   * Load saved play time from storage
   */
  function loadPlayTime() {
    if (!currentChannel) {
      logDebug('No current channel, returning 0 play time');
      return 0;
    }
    
    try {
      const key = getStorageKey();
      const saved = localStorage.getItem(key);
      if (saved) {
        const data = JSON.parse(saved);
        // Check if this is for the current window
        if (data.window === getCurrentWindow()) {
          logInfo('Loaded saved play time', { seconds: data.seconds, qualified: data.qualified });
          return data.seconds || 0;
        } else {
          logDebug('Saved data is for different window, ignoring', { savedWindow: data.window, currentWindow: getCurrentWindow() });
        }
      } else {
        logDebug('No saved play time found', { key });
      }
    } catch (error) {
      logError('Failed to load play time', error);
    }
    
    return 0;
  }

  /**
   * Save play time to storage
   */
  function savePlayTime() {
    if (!currentChannel) {
      logDebug('No current channel, skipping save');
      return;
    }
    
    try {
      const key = getStorageKey();
      const data = {
        window: getCurrentWindow(),
        seconds: playTimeSeconds,
        qualified: playTimeSeconds >= QUALIFY_THRESHOLD_SECONDS
      };
      localStorage.setItem(key, JSON.stringify(data));
      logDebug('Saved play time', { seconds: playTimeSeconds, qualified: data.qualified });
    } catch (error) {
      logError('Failed to save play time', error);
    }
  }

  /**
   * Check if already qualified for current window
   */
  function isAlreadyQualified() {
    if (!currentChannel || !riotPuuid) {
      logDebug('Cannot check qualification - missing channel or PUUID', { hasChannel: !!currentChannel, hasPuuid: !!riotPuuid });
      return false;
    }
    
    const qualKey = `${currentChannel}_${getCurrentWindow()}_${riotPuuid}`;
    if (qualificationSent.has(qualKey)) {
      logDebug('Already qualified this session', { qualKey });
      return true;
    }
    
    try {
      const key = getStorageKey();
      const saved = localStorage.getItem(key);
      if (saved) {
        const data = JSON.parse(saved);
        const qualified = data.qualified === true;
        logDebug('Checked qualification status', { qualified, savedData: data });
        return qualified;
      }
    } catch (error) {
      logError('Failed to check qualification', error);
    }
    
    return false;
  }

  /**
   * Send qualification to backend
   */
  async function sendQualification() {
    if (!currentChannel || !riotPuuid) {
      logWarn('Cannot send qualification - missing channel or PUUID', { hasChannel: !!currentChannel, hasPuuid: !!riotPuuid });
      return;
    }

    const qualKey = `${currentChannel}_${getCurrentWindow()}_${riotPuuid}`;

    // Don't send if already sent this session
    if (qualificationSent.has(qualKey)) {
      logDebug('Qualification already sent this session', { qualKey });
      return;
    }

    const payload = {
      stat_date: getCurrentWindow(),
      channel_twitch_id: currentChannel,
      riot_puuid: riotPuuid
    };

    logInfo('Sending viewer qualification', { channel: currentChannel });

    try {
      // Use fetch for better error handling and CORS support
      const response = await fetch(`${BACKEND_URL}/view/qualify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const responseData = await response.json();
        qualificationSent.add(qualKey);
        savePlayTime();

        // Stop tracking after successful qualification
        stopTracking();

        logInfo('✅ Viewer qualified successfully', {
          channel: currentChannel,
          window: payload.stat_date
        });
      } else {
        const errorText = await response.text();
        logError('❌ Failed to send qualification - Bad response', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
          payload
        });
      }
    } catch (error) {
      logError('❌ Failed to send qualification - Network error', {
        error: error.message,
        stack: error.stack,
        payload
      });
    }
  }

  /**
   * Update play time tracking
   */
  function updatePlayTime() {
    if (!isTracking || !lastUpdateTime) {
      return; // Silent return - no need to log this constantly
    }

    // Check if League of Legends is still being played
    if (!window.elowardExtensionState?.isChannelActive) {
      logInfo('Game changed, stopping tracking', {
        channel: currentChannel,
        currentGame: window.elowardExtensionState?.currentGame || 'unknown'
      });
      savePlayTime();
      stopTracking();
      return;
    }

    const now = Date.now();
    const deltaSeconds = (now - lastUpdateTime) / 1000;
    lastUpdateTime = now;

    // Check for window rollover
    const currentWindow = getCurrentWindow();
    const savedKey = getStorageKey();
    if (!savedKey.includes(currentWindow)) {
      // Window rolled over, reset tracking
      logInfo('Window rolled over, resetting tracking', { oldKey: savedKey, newWindow: currentWindow });
      playTimeSeconds = 0;
      qualificationSent.clear();
    }

    playTimeSeconds += deltaSeconds;

    // Check if we've hit the threshold
    if (playTimeSeconds >= QUALIFY_THRESHOLD_SECONDS && !isAlreadyQualified()) {
      sendQualification();
    }
    
    // Save progress every 10 seconds
    if (Math.floor(playTimeSeconds) % 10 === 0) {
      savePlayTime();
    }
  }

  /**
   * Find and monitor the video element
   */
  function findVideoElement() {
    const video = document.querySelector('video[src*="twitch.tv"], video.video-player__video, video');

    if (!video) {
      // Retry after a delay if not found
      setTimeout(findVideoElement, 1000);
      return null;
    }

    return video;
  }

  /**
   * Check if we can start tracking (League of Legends is being played)
   */
  function canStartTracking() {
    return window.elowardExtensionState?.isChannelActive === true;
  }

  /**
   * Stop tracking and clean up
   */
  function stopTracking() {
    if (trackingIntervalId) {
      clearInterval(trackingIntervalId);
      trackingIntervalId = null;
    }
    isTracking = false;
    logInfo('Tracking stopped', { channel: currentChannel });
  }

  /**
   * Start tracking video playback
   */
  function startTracking(video) {
    if (!video || !currentChannel || !riotPuuid) {
      logWarn('Cannot start tracking - missing requirements', {
        hasVideo: !!video,
        hasChannel: !!currentChannel,
        hasPuuid: !!riotPuuid
      });
      return false;
    }

    // Check if League of Legends is currently being played
    if (!canStartTracking()) {
      return false;
    }
    
    // Load saved play time
    playTimeSeconds = loadPlayTime();
    
    // Check if already qualified
    if (isAlreadyQualified()) {
      return true; // Already qualified, no need to track
    }

    // Start tracking immediately - tracks even when tab is not in focus
    isTracking = true;
    lastUpdateTime = Date.now();
    logInfo('Viewer tracking started', { channel: currentChannel });

    // Update play time every second and save interval ID
    trackingIntervalId = setInterval(updatePlayTime, 1000);

    return true; // Successfully started tracking
  }

  /**
   * Handle page unload - attempt to send qualification if threshold met
   */
  function handleUnload() {
    logInfo('Page unloading, checking for final qualification');

    if (isTracking) {
      updatePlayTime();
      savePlayTime();
      logDebug('Final play time update on unload', { totalSeconds: Math.floor(playTimeSeconds) });
    }

    // Send qualification if threshold met but not sent
    if (playTimeSeconds >= QUALIFY_THRESHOLD_SECONDS && !isAlreadyQualified() && currentChannel && riotPuuid) {
      logInfo('Sending final qualification on page unload');
      const payload = {
        stat_date: getCurrentWindow(),
        channel_twitch_id: currentChannel,
        riot_puuid: riotPuuid
      };

      // Use sendBeacon for reliability on page unload
      // sendBeacon is synchronous and doesn't get cancelled when page unloads
      if (navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        const sent = navigator.sendBeacon(`${BACKEND_URL}/view/qualify`, blob);
        if (sent) {
          logInfo('Final qualification beacon sent', { playTimeSeconds: Math.floor(playTimeSeconds) });
        } else {
          logWarn('sendBeacon failed on unload');
        }
      }
    }
  }

  /**
   * Initialize viewer tracking
   */
  async function initialize() {
    logInfo('Initializing EloWard viewer tracking');
    
    // Get channel from URL
    currentChannel = getChannelFromUrl();
    if (!currentChannel) {
      return; // Not on a channel page
    }
    
    // Load viewer PUUID
    riotPuuid = await loadViewerPuuid();
    if (!riotPuuid) {
      return; // No PUUID, can't track
    }
    
    // Find and start monitoring video
    const video = findVideoElement();
    if (video) {
      // Try to start tracking immediately
      const started = startTracking(video);

      // If tracking didn't start (game not detected yet), poll until it does
      if (!started) {
        let pollAttempts = 0;
        const maxPollAttempts = 30; // Poll for up to 30 seconds
        const pollInterval = setInterval(() => {
          pollAttempts++;

          if (canStartTracking()) {
            clearInterval(pollInterval);
            startTracking(video);
          } else if (pollAttempts >= maxPollAttempts) {
            clearInterval(pollInterval);
          }
        }, 1000); // Check every second
      }
    }

    // Set up unload handlers
    window.addEventListener('pagehide', handleUnload);
    window.addEventListener('beforeunload', handleUnload);
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }
})();