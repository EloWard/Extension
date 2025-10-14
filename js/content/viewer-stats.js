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
   */
  function getChannelFromUrl() {
    const match = window.location.pathname.match(/^\/([^\/]+)$/);
    const channel = match ? match[1].toLowerCase() : null;
    logDebug('Extracted channel from URL', { pathname: window.location.pathname, channel });
    return channel;
  }

  /**
   * Load viewer's PUUID from extension storage or API
   */
  async function loadViewerPuuid() {
    logDebug('Loading viewer PUUID from extension storage');
    try {
      // Use chrome.storage.local to get Riot user data (same as content.js)
      return new Promise((resolve) => {
        chrome.storage.local.get(['eloward_persistent_riot_user_data'], (data) => {
          const riotData = data?.eloward_persistent_riot_user_data;
          if (riotData?.puuid) {
            logInfo('Found PUUID in extension storage', { puuid: riotData.puuid.substring(0, 8) + '...' });
            resolve(riotData.puuid);
          } else {
            logWarn('No PUUID found in extension storage', { 
              hasData: !!data,
              hasRiotData: !!riotData,
              riotDataKeys: riotData ? Object.keys(riotData) : []
            });
            resolve(null);
          }
        });
      });
    } catch (error) {
      logError('Failed to load PUUID from extension storage', error);
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
    
    logInfo('Sending viewer qualification', { 
      channel: currentChannel, 
      window: payload.stat_date,
      puuid: riotPuuid.substring(0, 8) + '...',
      playTimeSeconds 
    });
    
    try {
      // Try sendBeacon first for reliability
      if (navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        const sent = navigator.sendBeacon(`${BACKEND_URL}/view/qualify`, blob);
        if (sent) {
          qualificationSent.add(qualKey);
          logInfo('Viewer qualification sent via beacon', { qualKey });
          return;
        } else {
          logWarn('sendBeacon failed, trying fetch fallback');
        }
      }
      
      // Fallback to fetch
      logDebug('Using fetch fallback for qualification');
      const response = await fetch(`${BACKEND_URL}/view/qualify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Add auth headers if available from extension
        },
        body: JSON.stringify(payload)
      });
      
      if (response.ok) {
        qualificationSent.add(qualKey);
        logInfo('Viewer qualification sent via fetch', { status: response.status, qualKey });
      } else {
        logError('Failed to send qualification', { status: response.status, statusText: response.statusText });
      }
    } catch (error) {
      logError('Failed to send qualification', error);
    }
  }

  /**
   * Update play time tracking
   */
  function updatePlayTime() {
    if (!isTracking || !lastUpdateTime) {
      return; // Silent return - no need to log this constantly
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
    
    // Log progress every 60 seconds
    if (Math.floor(playTimeSeconds) % 60 === 0 && playTimeSeconds > 0) {
      logDebug('Play time progress', { seconds: Math.floor(playTimeSeconds), threshold: QUALIFY_THRESHOLD_SECONDS });
    }
    
    // Check if we've hit the threshold
    if (playTimeSeconds >= QUALIFY_THRESHOLD_SECONDS && !isAlreadyQualified()) {
      logInfo('Qualification threshold reached!', { 
        playTimeSeconds: Math.floor(playTimeSeconds), 
        threshold: QUALIFY_THRESHOLD_SECONDS,
        channel: currentChannel 
      });
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
    logDebug('Looking for video element');
    // Look for main Twitch video player
    const video = document.querySelector('video[src*="twitch.tv"], video.video-player__video, video');
    
    if (!video) {
      logDebug('Video element not found, will retry');
      // Retry after a delay if not found
      setTimeout(findVideoElement, 1000);
      return null;
    }
    
    logInfo('Found video element', { 
      src: video.src ? video.src.substring(0, 50) + '...' : 'no src',
      paused: video.paused,
      ended: video.ended,
      duration: video.duration || 'unknown'
    });
    return video;
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
      return;
    }
    
    logInfo('Starting video tracking', { channel: currentChannel, puuid: riotPuuid.substring(0, 8) + '...' });
    
    // Load saved play time
    playTimeSeconds = loadPlayTime();
    
    // Check if already qualified
    if (isAlreadyQualified()) {
      logInfo('Already qualified for this window, skipping tracking');
      return;
    }
    
    // Start tracking immediately - don't wait for play/pause events
    // This allows tracking even when tab is not in focus
    isTracking = true;
    lastUpdateTime = Date.now();
    logInfo('Started continuous tracking (tab-based, not video-based)');
    
    // Optional: Still listen for video events for logging purposes
    video.addEventListener('play', () => {
      logDebug('Video resumed playing');
    });
    
    video.addEventListener('pause', () => {
      logDebug('Video paused (but tracking continues)');
    });
    
    video.addEventListener('ended', () => {
      logDebug('Video ended (but tracking continues)');
    });
    
    // Update play time every second
    setInterval(updatePlayTime, 1000);
    logDebug('Set up 1-second interval for play time updates');
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
    if (playTimeSeconds >= QUALIFY_THRESHOLD_SECONDS && !isAlreadyQualified()) {
      logInfo('Sending final qualification on page unload');
      // Use sendBeacon for reliability on page unload
      if (navigator.sendBeacon && currentChannel && riotPuuid) {
        const payload = JSON.stringify({
          stat_date: getCurrentWindow(),
          channel_twitch_id: currentChannel,
          riot_puuid: riotPuuid
        });
        const blob = new Blob([payload], { type: 'application/json' });
        const sent = navigator.sendBeacon(`${BACKEND_URL}/view/qualify`, blob);
        logInfo('Final qualification beacon sent', { sent, playTimeSeconds: Math.floor(playTimeSeconds) });
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
      logInfo('Not on a channel page, skipping viewer tracking', { pathname: window.location.pathname });
      return;
    }
    
    // Load viewer PUUID
    riotPuuid = await loadViewerPuuid();
    if (!riotPuuid) {
      logWarn('No PUUID available, skipping viewer tracking', { 
        channel: currentChannel,
        localStorageKeys: Object.keys(localStorage).filter(k => k.includes('eloward'))
      });
      return;
    }
    
    logInfo('Viewer tracking initialized successfully', { 
      channel: currentChannel,
      puuid: riotPuuid.substring(0, 8) + '...',
      window: getCurrentWindow(),
      threshold: QUALIFY_THRESHOLD_SECONDS
    });
    
    // Find and start monitoring video
    const video = findVideoElement();
    if (video) {
      startTracking(video);
    }
    
    // Set up unload handlers
    window.addEventListener('pagehide', handleUnload);
    window.addEventListener('beforeunload', handleUnload);
    logDebug('Set up page unload handlers');
    
    // Handle navigation changes (for SPA navigation)
    let lastPath = window.location.pathname;
    setInterval(() => {
      if (window.location.pathname !== lastPath) {
        lastPath = window.location.pathname;
        const newChannel = getChannelFromUrl();
        if (newChannel !== currentChannel) {
          logInfo('Channel changed, resetting tracking', { 
            oldChannel: currentChannel, 
            newChannel: newChannel 
          });
          // Channel changed, reset tracking
          if (isTracking) {
            updatePlayTime();
            savePlayTime();
          }
          currentChannel = newChannel;
          playTimeSeconds = 0;
          isTracking = false;
          qualificationSent.clear();
          
          if (currentChannel) {
            const video = findVideoElement();
            if (video) {
              startTracking(video);
            }
          }
        }
      }
    }, 1000);
    logDebug('Set up navigation change monitoring');
  }

  // Start when DOM is ready
  logInfo('EloWard viewer tracking script loaded');
  
  if (document.readyState === 'loading') {
    logDebug('DOM still loading, waiting for DOMContentLoaded');
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    logDebug('DOM already ready, initializing immediately');
    initialize();
  }
})();