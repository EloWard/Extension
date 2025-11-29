/* Copyright 2024 EloWard - Apache 2.0 + Commons Clause License */

document.body.setAttribute('data-eloward-chrome-ext', 'active');
document.documentElement.setAttribute('data-eloward-chrome-ext', 'active');

// Fast badge rendering: preconnect + image cache for all rank badges
const CDN_BASE = 'https://eloward-cdn.unleashai.workers.dev';
const RANK_TIERS = [
  'iron','bronze','silver','gold','platinum','emerald','diamond','master','grandmaster','challenger','unranked'
];

function injectPreconnectLinks() {
  try {
    const head = document.head || document.getElementsByTagName('head')[0];
    if (!head) return;
    const existing = head.querySelector('link[data-eloward-preconnect="cdn"]');
    if (!existing) {
      const dnsPrefetch = document.createElement('link');
      dnsPrefetch.setAttribute('rel', 'dns-prefetch');
      dnsPrefetch.setAttribute('href', CDN_BASE);
      dnsPrefetch.setAttribute('data-eloward-preconnect', 'cdn');
      head.appendChild(dnsPrefetch);

      const preconnect = document.createElement('link');
      preconnect.setAttribute('rel', 'preconnect');
      preconnect.setAttribute('href', CDN_BASE);
      preconnect.setAttribute('crossorigin', 'anonymous');
      preconnect.setAttribute('data-eloward-preconnect', 'cdn');
      head.appendChild(preconnect);
    }
  } catch (_) {}
}

const ImageCache = (() => {
  const tierToBlobUrl = new Map();
  const inFlight = new Map();
  const persistentCache = new Map(); // Store data URLs from persistent storage
  
  // Badge cache versioning - increment when CDN images are updated  
  const BADGE_CACHE_VERSION = '3';

  // Persistent cache functions

  async function setCachedBadgeBlob(tierKey, blob, isAnimated = false) {
    try {
      const suffix = isAnimated ? '_premium' : '';
      const storageKey = `eloward_content_badge_${tierKey}${suffix}_v${BADGE_CACHE_VERSION}`;
      
      // Convert blob to data URL for storage
      const dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
      
      await browser.storage.local.set({
        [storageKey]: {
          dataUrl,
          timestamp: Date.now()
        }
      });
    } catch (_) {
      // Ignore storage errors
    }
  }

  // Clean up old cached badges
  async function cleanupOldContentBadgeCache() {
    try {
      const allData = await browser.storage.local.get();
      const keysToRemove = Object.keys(allData).filter(key => 
        key.startsWith('eloward_content_badge_') && 
        !key.includes(`_v${BADGE_CACHE_VERSION}`)
      );
      
      if (keysToRemove.length > 0) {
        await browser.storage.local.remove(keysToRemove);
      }
    } catch (_) {
      // Ignore cleanup errors
    }
  }

  async function preloadTier(tierLower) {
    const key = String(tierLower || '').toLowerCase();
    if (!key) return null;
    
    // Preload both regular and premium variants
    const regularKey = key;
    const premiumKey = `${key}_premium`;
    
    const promises = [];
    
    // Preload regular variant  
    if (!tierToBlobUrl.has(regularKey) && !inFlight.has(regularKey)) {
      const regularPromise = (async () => {
        try {
          // Check if we have it in persistent cache first
          if (persistentCache.has(regularKey)) {
            const blobUrl = await convertCachedDataUrlToBlobUrl(regularKey);
            if (blobUrl) return blobUrl;
          }
          
          // Not in persistent cache - fetch from CDN
          const regularUrl = `${CDN_BASE}/lol/${key}.png?v=${BADGE_CACHE_VERSION}`;
          const resp = await fetch(regularUrl, { mode: 'cors', cache: 'default', credentials: 'omit' });
          if (!resp.ok) throw new Error(String(resp.status));
          const blob = await resp.blob();
          const blobUrl = URL.createObjectURL(blob);
          
          // Store in both memory and persistent cache
          tierToBlobUrl.set(regularKey, blobUrl);
          setCachedBadgeBlob(key, blob, false).catch(() => {}); // Non-blocking
          
          return blobUrl;
          } catch (_) {
            // Fallback to CDN URL on failure
            const fallbackUrl = `${CDN_BASE}/lol/${key}.png?v=${BADGE_CACHE_VERSION}`;
            tierToBlobUrl.set(regularKey, fallbackUrl);
            return fallbackUrl;
        } finally {
          inFlight.delete(regularKey);
        }
      })();
      inFlight.set(regularKey, regularPromise);
      promises.push(regularPromise);
    }
    
    // Preload premium variant
    if (!tierToBlobUrl.has(premiumKey) && !inFlight.has(premiumKey)) {
      const premiumPromise = (async () => {
        try {
          // Check if we have it in persistent cache first
          if (persistentCache.has(premiumKey)) {
            const blobUrl = await convertCachedDataUrlToBlobUrl(premiumKey);
            if (blobUrl) return blobUrl;
          }
          
          // Not in persistent cache - fetch from CDN
          const premiumUrl = `${CDN_BASE}/lol/${key}_premium.webp?v=${BADGE_CACHE_VERSION}`;
          const resp = await fetch(premiumUrl, { mode: 'cors', cache: 'default', credentials: 'omit' });
          if (!resp.ok) throw new Error(String(resp.status));
          const blob = await resp.blob();
          const blobUrl = URL.createObjectURL(blob);
          
          // Store in both memory and persistent cache
          tierToBlobUrl.set(premiumKey, blobUrl);
          setCachedBadgeBlob(key, blob, true).catch(() => {}); // Non-blocking
          
          return blobUrl;
          } catch (_) {
            // Fallback to CDN URL on failure
            const fallbackUrl = `${CDN_BASE}/lol/${key}_premium.webp?v=${BADGE_CACHE_VERSION}`;
            tierToBlobUrl.set(premiumKey, fallbackUrl);
            return fallbackUrl;
        } finally {
          inFlight.delete(premiumKey);
        }
      })();
      inFlight.set(premiumKey, premiumPromise);
      promises.push(premiumPromise);
    }
    
    // Return promise for regular variant (for backwards compatibility)
    return tierToBlobUrl.get(regularKey) || inFlight.get(regularKey) || promises[0];
  }

  async function init() {
    injectPreconnectLinks();
    
    // Load persistent cache data URLs into memory (fast, non-blocking)
    loadPersistentCacheData().catch(() => {});
    
    // Clean up old badge cache entries (non-blocking)
    cleanupOldContentBadgeCache().catch(() => {});
    
    // Preload common badges (now more efficient since it checks persistent cache first)
    try {
      await Promise.all(RANK_TIERS.map(preloadTier));
    } catch (_) {}
  }
  
  // Load persistent cache data URLs into memory for fast access
  async function loadPersistentCacheData() {
    try {
      const allData = await browser.storage.local.get();
      const cacheKeys = Object.keys(allData).filter(key => 
        key.startsWith('eloward_content_badge_') && 
        key.includes(`_v${BADGE_CACHE_VERSION}`)
      );
      
      for (const storageKey of cacheKeys) {
        const cached = allData[storageKey];
        if (cached && cached.dataUrl) {
          // Extract tier key from storage key format: eloward_content_badge_{tier}_{suffix}_v{version}
          const match = storageKey.match(/^eloward_content_badge_(.+)_v\d+$/);
          if (match) {
            const key = match[1]; // e.g., "gold" or "gold_premium"
            // Store data URL for lazy conversion to blob URL when needed
            persistentCache.set(key, cached.dataUrl);
          }
        }
      }
    } catch (_) {
      // Continue if persistent cache loading fails
    }
  }
  
  // Convert cached data URL to blob URL (lazy conversion)
  async function convertCachedDataUrlToBlobUrl(key) {
    try {
      const dataUrl = persistentCache.get(key);
      if (dataUrl) {
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        tierToBlobUrl.set(key, blobUrl);
        return blobUrl;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  function getSrcSync(tier, isAnimated = false) {
    const tierKey = String(tier || 'unranked').toLowerCase();
    const key = isAnimated ? `${tierKey}_premium` : tierKey;
    const extension = isAnimated ? '.webp' : '.png';
    
    // Check memory cache first (blob URLs - fastest)
    const cachedBlobUrl = tierToBlobUrl.get(key);
    if (cachedBlobUrl) {
      return cachedBlobUrl;
    }
    
    // Check persistent cache (data URLs - fast)  
    if (persistentCache.has(key)) {
      // Convert to blob URL in background for next time
      convertCachedDataUrlToBlobUrl(key).catch(() => {});
      // Return data URL immediately (works for img.src)
      return persistentCache.get(key);
    }
    
    // Cache miss - trigger preloading for future use
    preloadTier(tierKey).catch(() => {});
    
    // Return CDN URL as immediate fallback with cache-busting
    const baseUrl = isAnimated ? `${CDN_BASE}/lol/${tierKey}_premium.webp` : `${CDN_BASE}/lol/${tierKey}.png`;
    return `${baseUrl}?v=${BADGE_CACHE_VERSION}`;
  }

  function revokeAll() {
    try {
      for (const url of tierToBlobUrl.values()) {
        if (url && url.startsWith('blob:')) {
          try { URL.revokeObjectURL(url); } catch (_) {}
        }
      }
      tierToBlobUrl.clear();
      persistentCache.clear(); // Also clear persistent cache data
    } catch (_) {}
  }

  return { init, getSrcSync, preloadTier, revokeAll };
})();

// Kick off preloads immediately
ImageCache.init();

const extensionState = {
  isChannelActive: false,
  channelName: '',
  currentGame: null,
  currentUser: null,
  observerInitialized: false,
  initializationInProgress: false,
  currentInitializationId: null,
  compatibilityMode: false,
  initializationComplete: false,
  lastInitAttempt: 0,
  fallbackInitialized: false,
  chatMode: 'standard',
  isVod: false,
  lastPathname: ''
};

// Expose extensionState globally for debugging and potential future extensions
window.elowardExtensionState = extensionState;

// ============================================================================
// VIEWER TRACKING INTEGRATION
// Triggers whenever channel becomes active (streaming League of Legends)
// ============================================================================

let viewerTrackingState = {
  isTracking: false,
  trackingIntervalId: null,
  playTimeSeconds: 0,
  lastUpdateTime: null,
  qualificationsSentToday: new Set(), // Track by channel_date
  currentTrackingChannel: null
};

const VIEWER_QUALIFY_THRESHOLD = 10; // TESTING: 10 seconds (change to 300 for production)
const VIEWER_BACKEND_URL = 'https://eloward-users.unleashai.workers.dev';

/**
 * Start viewer tracking for current channel
 * Called automatically when extensionState.isChannelActive = true
 */
function startViewerTracking() {
  // Don't track if already tracking the same channel
  if (viewerTrackingState.isTracking &&
      viewerTrackingState.currentTrackingChannel === extensionState.channelName) {
    return;
  }

  // Get viewer's Riot PUUID from storage
  chrome.storage.local.get(['eloward_persistent_riot_user_data'], async (data) => {
    const riotPuuid = data?.eloward_persistent_riot_user_data?.puuid;

    if (!riotPuuid) {
      // No PUUID - user hasn't connected Riot account, skip silently
      return;
    }

    // Check if already qualified today for this channel
    const today = getViewerWindow();
    const qualKey = `${extensionState.channelName}_${today}`;

    if (viewerTrackingState.qualificationsSentToday.has(qualKey)) {
      console.log(`[EloWard Viewer] Already qualified today for ${extensionState.channelName}`);
      return;
    }

    // Start tracking
    stopViewerTracking(); // Stop any previous tracking
    viewerTrackingState.isTracking = true;
    viewerTrackingState.currentTrackingChannel = extensionState.channelName;
    viewerTrackingState.playTimeSeconds = 0;
    viewerTrackingState.lastUpdateTime = Date.now();

    console.log(`[EloWard Viewer] 🚀 Started tracking: ${extensionState.channelName}`);

    // Update every second
    viewerTrackingState.trackingIntervalId = setInterval(() => {
      updateViewerPlayTime(riotPuuid);
    }, 1000);
  });
}

/**
 * Stop viewer tracking and clean up
 */
function stopViewerTracking() {
  if (viewerTrackingState.trackingIntervalId) {
    clearInterval(viewerTrackingState.trackingIntervalId);
    viewerTrackingState.trackingIntervalId = null;
  }
  viewerTrackingState.isTracking = false;
  viewerTrackingState.playTimeSeconds = 0;
  viewerTrackingState.lastUpdateTime = null;
  viewerTrackingState.currentTrackingChannel = null;
}

/**
 * Update play time and check for qualification
 */
function updateViewerPlayTime(riotPuuid) {
  if (!viewerTrackingState.isTracking || !viewerTrackingState.lastUpdateTime) {
    return;
  }

  // Check if still on LoL stream
  if (!extensionState.isChannelActive) {
    console.log('[EloWard Viewer] Game changed, stopping tracking');
    stopViewerTracking();
    return;
  }

  // Check if channel changed
  if (viewerTrackingState.currentTrackingChannel !== extensionState.channelName) {
    console.log('[EloWard Viewer] Channel changed, restarting tracking');
    stopViewerTracking();
    startViewerTracking();
    return;
  }

  const now = Date.now();
  const deltaSeconds = (now - viewerTrackingState.lastUpdateTime) / 1000;
  viewerTrackingState.lastUpdateTime = now;
  viewerTrackingState.playTimeSeconds += deltaSeconds;

  // Log progress every 5 seconds
  if (Math.floor(viewerTrackingState.playTimeSeconds) % 5 === 0 &&
      viewerTrackingState.playTimeSeconds >= 5) {
    console.log(`[EloWard Viewer] ⏱️  ${Math.floor(viewerTrackingState.playTimeSeconds)}s / ${VIEWER_QUALIFY_THRESHOLD}s`);
  }

  // Check if qualified
  if (viewerTrackingState.playTimeSeconds >= VIEWER_QUALIFY_THRESHOLD) {
    sendViewerQualification(riotPuuid);
  }
}

/**
 * Send viewer qualification to backend
 */
async function sendViewerQualification(riotPuuid) {
  const channel = viewerTrackingState.currentTrackingChannel;
  const today = getViewerWindow();
  const qualKey = `${channel}_${today}`;

  // Stop tracking first (we're done)
  stopViewerTracking();

  const payload = {
    stat_date: today,
    channel_twitch_id: channel.toLowerCase(),
    riot_puuid: riotPuuid
  };

  console.log(`[EloWard Viewer] 📤 Sending qualification for ${channel}...`);

  try {
    const response = await fetch(`${VIEWER_BACKEND_URL}/view/qualify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      viewerTrackingState.qualificationsSentToday.add(qualKey);
      console.log(`[EloWard Viewer] ✅ Qualified successfully for ${channel}`);
    } else {
      const error = await response.text();
      console.error(`[EloWard Viewer] ❌ Failed to qualify:`, error);
    }
  } catch (error) {
    console.error(`[EloWard Viewer] ❌ Network error:`, error);
  }
}

/**
 * Get viewer window (07:00 UTC daily reset)
 */
function getViewerWindow() {
  const now = new Date();
  const utcHour = now.getUTCHours();

  // If before 07:00 UTC, use yesterday's date
  if (utcHour < 7) {
    now.setUTCDate(now.getUTCDate() - 1);
  }

  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

const SELECTORS = {
  standard: {
    username: [
      '.chat-author__display-name',
      '[data-a-target="chat-message-username"]',
      '.chat-line__username',
      '.chat-author__intl-login'
    ],
    message: [
      '.chat-line__message',
      '.chat-line',
      '[data-a-target="chat-line-message"]',
      // VOD chat replay fallbacks
      '.video-chat__message',
      '[data-test-selector*="chat-message"]'
    ]
  },
  seventv: {
    username: [
      '.seventv-chat-user-username',
      '.chat-author__display-name',
      '[data-a-target="chat-message-username"]'
    ],
    message: [
      '.seventv-message',
      // 7TV VOD message containers
      '.seventv-user-message',
      '.chat-line__message',
      '.chat-line',
      // VOD chat replay fallbacks
      '.video-chat__message',
      '[data-test-selector*="chat-message"]'
    ]
  },
  ffz: {
    username: [
      '.ffz-message-author',
      '.chat-author__display-name',
      '[data-a-target="chat-message-username"]'
    ],
    message: [
      '.ffz-message-line',
      '.ffz-chat-line',
      '.chat-line__message',
      '.chat-line',
      // VOD chat replay fallbacks
      '.video-chat__message',
      '[data-test-selector*="chat-message"]'
    ]
  }
};
function isVodPage() {
  return /^\/videos\/(\d+)/.test(window.location.pathname);
}

function getVodStreamerLoginFromDom() {
  try {
    // Primary: header h1 link (VOD page header)
    const headerLinkWithTitle = Array.from(document.querySelectorAll('a[href^="/"] h1.tw-title'))
      .map(h1 => h1.closest('a'))
      .find(Boolean);
    if (headerLinkWithTitle) {
      const href = headerLinkWithTitle.getAttribute('href') || '';
      const parts = href.split('/').filter(Boolean);
      if (parts[0]) return parts[0].toLowerCase();
    }

    // Fallback: explicit channel link
    const channelLink = document.querySelector('a[data-test-selector="ChannelLink"], a[data-a-target="preview-card-channel-link"]');
    if (channelLink) {
      const href = channelLink.getAttribute('href') || '';
      const parts = href.split('/').filter(Boolean);
      if (parts[0]) return parts[0].toLowerCase();
      const text = (channelLink.textContent || '').trim();
      if (text) return text.toLowerCase();
    }

    // Fallback: avatar link in metadata area
    const avatarAnchor = document.querySelector('.tw-avatar')?.closest('a[href^="/"]');
    if (avatarAnchor) {
      const href = avatarAnchor.getAttribute('href') || '';
      const parts = href.split('/').filter(Boolean);
      if (parts[0]) return parts[0].toLowerCase();
    }
  } catch (_) {}
  return null;
}

function getVodGameFromDom() {
  try {
    // Primary VOD selector
    const vodGame = document.querySelector('a[data-a-target="video-info-game-boxart-link"] p');
    const text = vodGame?.textContent?.trim();
    if (text) return text;

    // Fallbacks present in carousels or metadata
    const previewGameLink = document.querySelector('a[data-test-selector="preview-card-game-link"], a[data-a-target="preview-card-game-link"]');
    const text2 = previewGameLink?.textContent?.trim();
    if (text2) return text2;
  } catch (_) {}
  return null;
}
// Turn /directory/category/league-of-legends into "League of Legends"
function _eloward_extractGameFromHref(href) {
  try {
    if (!href) return null;
    const m = href.match(/\/directory\/category\/([^\/?#]+)/i);
    if (!m) return null;
    const slug = decodeURIComponent(m[1]).replace(/-/g, ' ').trim();
    // Title-case safely without allocating huge maps
    return slug.split(' ')
      .filter(Boolean)
      .map(s => s.charAt(0).toUpperCase() + s.slice(1))
      .join(' ');
  } catch (_) { return null; }
}

// Crawl the channel header/info areas for a category link or visible text
function getOfflineChannelGameFromDom() {
  try {
    // Priority 1: canonical Twitch selector in channel header
    // e.g. <a data-a-target="stream-game-link" href="/directory/category/league-of-legends"><span>League of Legends</span></a>
    const header = document.querySelector('#live-channel-stream-information, .channel-info-content');
    const link = header?.querySelector('a[data-a-target="stream-game-link"]');
    const text = link?.textContent?.trim();
    if (text) return text;

    // Priority 2: any visible category link in the header/content
    // Works even if Twitch changes data-a-target but keeps directory path
    const anyCat = header?.querySelector('a[href^="/directory/category/"]');
    const text2 = anyCat?.textContent?.trim();
    if (text2) return text2;

    // Priority 3: derive from href slug if text is empty or virtualized
    const byHref = _eloward_extractGameFromHref(link?.getAttribute('href') || anyCat?.getAttribute('href') || '');
    if (byHref) return byHref;

    // Priority 4: broader search (late-loading layouts, experiments)
    const globalCat = document.querySelector('a[data-a-target="stream-game-link"], a[href^="/directory/category/"]');
    const globalText = globalCat?.textContent?.trim();
    if (globalText) return globalText;

    const byHrefGlobal = _eloward_extractGameFromHref(globalCat?.getAttribute('href') || '');
    if (byHrefGlobal) return byHrefGlobal;
  } catch (_) {}
  return null;
}


const SUPPORTED_GAMES = { 'League of Legends': true };

let processedMessages = new Set();
let pendingBadgeTargets = new Map();
let tooltipElement = null;

function findVodUsernameInfo(messageNode) {
  try {
    const container = messageNode.closest('.dtSdDz, .vod-message, li, [class*="vod-message"]') || messageNode.parentElement || messageNode;
    const innerCandidate = container.querySelector(
      'a.video-chat__message-author [data-test-selector="message-username"],\
       a.video-chat__message-author [data-a-target="chat-message-username"],\
       a.video-chat__message-author .chat-author__display-name'
    );
    if (innerCandidate) {
      const name = (innerCandidate.getAttribute && innerCandidate.getAttribute('data-a-user')) || innerCandidate.textContent || '';
      if (name.trim()) return { el: innerCandidate, name: name.trim() };
    }
    const authorAnchor = container.querySelector('a.video-chat__message-author');
    if (authorAnchor) {
      const span = authorAnchor.querySelector('[data-test-selector="message-username"], [data-a-target="chat-message-username"], .chat-author__display-name');
      const el = span || authorAnchor;
      const name = (el.getAttribute && el.getAttribute('data-a-user')) || el.textContent || '';
      if (name.trim()) return { el, name: name.trim() };
    }
    const a = container.querySelector('a[href^="/"]');
    if (a && a.textContent && a.textContent.trim()) {
      return { el: a, name: a.textContent.trim() };
    }
  } catch (_) {}
  return { el: null, name: '' };
}

const REGION_MAPPING = {
  'na1': 'na', 'euw1': 'euw', 'eun1': 'eune', 'kr': 'kr', 'br1': 'br',
  'jp1': 'jp', 'la1': 'lan', 'la2': 'las', 'oc1': 'oce', 'tr1': 'tr',
  'ru': 'ru', 'me1': 'me', 'sg2': 'sea', 'tw2': 'tw', 'vn2': 'vn'
};

// Map API/platform regions to human-readable display short-codes for UI
function getDisplayRegion(regionCode) {
  if (!regionCode) return null;
  const code = String(regionCode).toLowerCase();
  const display = {
    'na1': 'NA', 'br1': 'BR', 'la1': 'LAN', 'la2': 'LAS', 'oc1': 'OCE',
    'euw1': 'EUW', 'eun1': 'EUNE', 'tr1': 'TR', 'ru': 'RU', 'kr': 'KR', 'jp1': 'JP',
    'me1': 'ME', 'ph2': 'PH', 'sg2': 'SG', 'th2': 'TH', 'tw2': 'TW', 'vn2': 'VN',
    'sea': 'SEA',
    // In case we ever get regional routes instead of platforms
    'americas': 'NA', 'europe': 'EU', 'asia': 'ASIA'
  };
  return display[code] || regionCode.toUpperCase();
}

function handleBadgeClick(event) {
  const badge = event.currentTarget;
  const username = badge.dataset.username;
  const badgeRegion = badge.dataset.region;
  

  hideTooltip();
  hideSevenTVTooltip();
  
  if (!username || !badgeRegion) return;
  
  const opGGRegion = REGION_MAPPING[badgeRegion];
  if (!opGGRegion) return;
  
  const encodedName = encodeURIComponent(username.split('#')[0]);
  const tagLine = username.split('#')[1] || badgeRegion.toUpperCase();
  const opGGUrl = `https://op.gg/lol/summoners/${opGGRegion}/${encodedName}-${tagLine}`;
  
  window.open(opGGUrl, '_blank');
}

function createBadgeElement(rankData) {
  const badge = document.createElement('span');
  const isAnimated = rankData.animate_badge || false;
  
  badge.className = 'eloward-rank-badge';
  badge.dataset.rankText = formatRankText(rankData);
  badge.dataset.rank = rankData.tier.toLowerCase();
  badge.dataset.division = rankData.division || '';
  badge.dataset.lp = rankData.leaguePoints !== undefined && rankData.leaguePoints !== null ? 
                     rankData.leaguePoints.toString() : '';
  badge.dataset.username = rankData.summonerName || '';
  badge.dataset.region = rankData.region;
  badge.dataset.isAnimated = isAnimated ? 'true' : 'false';
  
  const img = document.createElement('img');
  img.alt = rankData.tier;
  img.className = 'eloward-badge-img';
  img.width = 24;
  img.height = 24;
  // Use cached blob URL if available; falls back to CDN URL
  img.decoding = 'async';
  try { img.fetchPriority = 'high'; } catch (_) {}
  img.loading = 'eager';
  img.src = ImageCache.getSrcSync(rankData.tier, isAnimated);
  
  badge.appendChild(img);
  badge.addEventListener('mouseenter', showTooltip);
  badge.addEventListener('mouseleave', hideTooltip);
  badge.addEventListener('click', handleBadgeClick);
  badge.style.cursor = 'pointer';
  
  return badge;
}

function detectChatMode() {
  // Comprehensive 7TV detection - if ANY of these indicators are present, 7TV is active
  const has7TVElements = !!(
    // Structural indicators (container, settings button)
    document.querySelector('seventv-container') ||
    document.querySelector('#seventv-settings-button') ||
    // Body class indicators  
    document.body.classList.contains('seventv-transparent') ||
    // CSS custom properties (set when 7TV loads)
    getComputedStyle(document.body).getPropertyValue('--seventv-chat-padding').trim() ||
    getComputedStyle(document.body).getPropertyValue('--seventv-channel-accent').trim() ||
    // Message and element indicators
    document.querySelector('.seventv-message') ||
    document.querySelector('.seventv-chat-user') ||
    document.querySelector('[data-seventv]') ||
    document.querySelector('.seventv-paint')
  );
  
  const hasFFZElements = !!(
    document.querySelector('.ffz-message-line') ||
    document.querySelector('.ffz-chat-line') ||
    document.querySelector('[data-ffz-component]') ||
    document.querySelector('.ffz-addon')
  );
  
  let detectedMode = 'standard';
  if (has7TVElements) {
    detectedMode = 'seventv';
  } else if (hasFFZElements) {
    detectedMode = 'ffz';
  }
  
  const previousMode = extensionState.chatMode;
  extensionState.compatibilityMode = detectedMode !== 'standard';
  extensionState.chatMode = detectedMode;
  
  if (detectedMode !== previousMode && extensionState.initializationComplete) {
    console.log(`🔄 EloWard: Chat mode changed from ${previousMode} to ${detectedMode}`);
    switchChatMode();
  }
  
  return { chatMode: detectedMode };
}

function switchChatMode() {
  if (!extensionState.isChannelActive || !extensionState.observerInitialized) {
    return;
  }

  console.log(`🔄 EloWard: Switching to ${extensionState.chatMode} mode`);
  
  cleanupChatObserver();
  processedMessages.clear();
  
  const chatContainer = findChatContainer();
  if (chatContainer) {
    setupChatObserver(chatContainer);
  }
}

function cleanupChatObserver() {
  if (tooltipElement && tooltipElement.parentNode) {
    tooltipElement.parentNode.removeChild(tooltipElement);
    tooltipElement = null;
  }
  
  hideSevenTVTooltip();
  
  if (window._eloward_chat_observer) {
    window._eloward_chat_observer.disconnect();
    window._eloward_chat_observer = null;
  }
  
  document.querySelectorAll('.eloward-rank-badge').forEach(badge => {
    badge.remove();
  });
}

function setupCompatibilityMonitor() {
  let detectionCount = 0;
  const maxDetections = 15;
  
  const scheduleFollowUpDetection = () => {
    if (detectionCount < maxDetections && extensionState.chatMode === 'standard') {
      setTimeout(() => {
        if (detectionCount < maxDetections) {
          detectionCount++;
          detectChatMode();
        }
      }, 1000);
    }
  };
  
  scheduleFollowUpDetection();
  
  const compatibilityObserver = new MutationObserver((mutations) => {
    if (detectionCount >= maxDetections) {
      compatibilityObserver.disconnect();
      return;
    }
    
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check for 7TV indicators
            const has7TVIndicators = !!(
              node.tagName === 'SEVENTV-CONTAINER' ||
              node.id === 'seventv-settings-button' ||
              node.querySelector && (
                node.querySelector('seventv-container') ||
                node.querySelector('#seventv-settings-button') ||
                node.querySelector('.seventv-message') ||
                node.classList.contains('seventv-paint')
              )
            );
            
            // Check for FFZ indicators
            const hasFFZIndicators = !!(
              node.querySelector && (
                node.querySelector('.ffz-message-line') ||
                node.classList.contains('ffz-addon')
              )
            );
            
            if (has7TVIndicators || hasFFZIndicators) {
              if (detectionCount < maxDetections) {
                detectionCount++;
                detectChatMode();
                return;
              }
            }
          }
        }
      }
      
      // Also check for class changes on body element
      if (mutation.type === 'attributes' && 
          mutation.target === document.body && 
          mutation.attributeName === 'class') {
        if (detectionCount < maxDetections) {
          detectionCount++;
          detectChatMode();
          return;
        }
      }
    }
  });
  
  compatibilityObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style']
  });
  
  setTimeout(() => {
    compatibilityObserver.disconnect();
  }, 15000);
}

function setupFallbackInitialization() {
  setTimeout(() => {
    if (!extensionState.initializationComplete && !extensionState.fallbackInitialized) {
      extensionState.fallbackInitialized = true;
      fallbackInitialization();
    }
  }, 10000);
  
  const fallbackCheckInterval = setInterval(() => {
    const currentChannel = getCurrentChannelName();
    if (currentChannel && 
        !extensionState.initializationComplete && 
        !extensionState.initializationInProgress &&
        !extensionState.fallbackInitialized &&
        (Date.now() - extensionState.lastInitAttempt) > 15000) {
      
      extensionState.fallbackInitialized = true;
      fallbackInitialization();
      clearInterval(fallbackCheckInterval);
    }
  }, 5000);
  
  setTimeout(() => {
    clearInterval(fallbackCheckInterval);
  }, 120000);
}

function fallbackInitialization() {
  const currentChannel = getCurrentChannelName();
  if (!currentChannel) return;
  
  if (!extensionState.compatibilityMode) {
    const hasThirdPartyExtensions = !!(
      document.querySelector('.ffz-addon') ||
      document.querySelector('.seventv-paint') ||
      document.querySelector('[data-ffz-component]') ||
      document.querySelector('[data-seventv]') ||
      window.ffz ||
      window.FrankerFaceZ ||
      window.SevenTV || window.seventv
    );
    
    if (hasThirdPartyExtensions) {
      extensionState.compatibilityMode = true;
    }
  }
  
  let attempts = 0;
  const maxAttempts = 10;
  
  function tryFallbackSetup() {
    const chatContainer = findChatContainer();
    
    if (chatContainer) {
      extensionState.channelName = currentChannel;
      extensionState.currentGame = 'League of Legends';
      extensionState.isChannelActive = true;

      // Start viewer tracking
      startViewerTracking();

      setupChatObserver(chatContainer);
      extensionState.observerInitialized = true;
      extensionState.initializationComplete = true;
    } else {
      attempts++;
      if (attempts < maxAttempts) {
        setTimeout(tryFallbackSetup, attempts * 1000);
      }
    }
  }
  
  tryFallbackSetup();
}


function cleanupChannel(channelName) {
  cleanupChatObserver();
  
  if (window._eloward_game_observer) {
    window._eloward_game_observer.disconnect();
    window._eloward_game_observer = null;
  }
  
  processedMessages.clear();
  
  extensionState.observerInitialized = false;
  extensionState.isChannelActive = false;
  extensionState.currentGame = null;
  extensionState.currentUser = null;
}


function initializeStorage() {
  // Read only the keys we actually need to determine current user
  chrome.storage.local.get(['eloward_persistent_twitch_user_data', 'twitchUsername'], (allData) => {
    extensionState.currentUser = findCurrentUser(allData);
    
    if (extensionState.currentUser) {
      chrome.runtime.sendMessage({
        action: 'set_current_user',
        username: extensionState.currentUser
      });
      
      // Check if local user data is cached and fresh, fetch from backend if needed
      chrome.runtime.sendMessage({
        action: 'get_cached_rank',
        username: extensionState.currentUser
      }, (cachedResponse) => {
        if (!cachedResponse?.rankData) {
          // No cached data, fetch fresh from backend
          chrome.runtime.sendMessage({
            action: 'fetch_rank_for_username',
            username: extensionState.currentUser
          }, (response) => {
            if (response?.success && response?.rankData) {
              chrome.runtime.sendMessage({
                action: 'set_rank_data',
                username: extensionState.currentUser,
                rankData: response.rankData
              });
            }
          });
        }
        
        // Refresh options data for current user to sync options
        chrome.runtime.sendMessage({
          action: 'refresh_options_data'
        });
      });
    }
  });
}

function findCurrentUser(allData) {
  if (allData.eloward_persistent_twitch_user_data?.login) {
    return allData.eloward_persistent_twitch_user_data.login.toLowerCase();
  } 
  
  if (allData.twitchUsername) {
    return allData.twitchUsername.toLowerCase();
  }
  
  return null;
}


function getCurrentChannelName() {
  const pathname = window.location.pathname;
  // VOD: derive streamer login from DOM
  if (isVodPage()) {
    const login = getVodStreamerLoginFromDom();
    if (login) return login;
    // If not yet available, return null so initializer/fallback retries
    return null;
  }
  
  // Handle popout chat: /popout/[channel]/chat
  const popoutMatch = pathname.match(/^\/popout\/([^/]+)\/chat/);
  if (popoutMatch) {
    return popoutMatch[1].toLowerCase();
  }
  
  // Handle dashboard popout: /popout/u/[channel]/stream-manager/chat
  const dashPopoutMatch = pathname.match(/^\/popout\/u\/([^/]+)\/stream-manager\/chat/);
  if (dashPopoutMatch) {
    return dashPopoutMatch[1].toLowerCase();
  }
  
  // Handle embed chat: /embed/[channel]/chat
  const embedMatch = pathname.match(/^\/embed\/([^/]+)\/chat/);
  if (embedMatch) {
    return embedMatch[1].toLowerCase();
  }
  
  // Handle moderator popout: /popout/moderator/[channel]/chat
  const modPopoutMatch = pathname.match(/^\/popout\/moderator\/([^/]+)\/chat/);
  if (modPopoutMatch) {
    return modPopoutMatch[1].toLowerCase();
  }
  
  // Handle moderator view: /moderator/[channel]
  const pathSegments = pathname.split('/');
  if (pathSegments[1] === 'moderator' && pathSegments.length > 2) {
    return pathSegments[2].toLowerCase();
  }
  
  // Handle normal channel view: /[channel]
  if (pathSegments[1] && 
      pathSegments[1] !== 'oauth2' && 
      !pathSegments[1].includes('auth')) {
    return pathSegments[1].toLowerCase();
  }
  
  return null;
}

async function getCurrentGame() {
  const channelName = getCurrentChannelName();
  // For VOD, we scrape from DOM without requiring channelName
  if (isVodPage()) {
    const scraped = getVodGameFromDom();
    if (scraped) return scraped;
  }
  if (!channelName) return null;

  // 1) Try Twitch GQL (works in Chrome; in Firefox we added host permission)
  try {
    const response = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko'
      },
      body: JSON.stringify({
        query: `
          query {
            user(login: "${channelName}") {
              stream {
                game { id name displayName }
              }
            }
          }
        `
      })
    });
    if (response.ok) {
      const data = await response.json();
      const game = data?.data?.user?.stream?.game;
      if (game) {
        const gameName = game.name || game.displayName;
        console.log(`🎮 EloWard: Game category detected - ${gameName}`);
        return gameName;
      }
    }
  } catch (_) {}

  // 2) Fallback: inspect DOM for the category badge (works cross-browser and VOD)
  try {
    const selectors = [
      '[data-a-target="stream-game-link"]', // channel page
      'a[href*="/directory/game/"]',      // generic link
      '[data-test-selector="game-title"]',
      // VOD specific
      'a[data-a-target="video-info-game-boxart-link"] p'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const text = el?.textContent?.trim();
      if (text) {
        console.log(`🎮 EloWard: Game category detected via DOM - ${text}`);
        return text;
      }
    }
  } catch (_) {}

  // 3) NEW: Offline channel header/about panel scan
  // Covers offline channel pages and offline popout when parent DOM is present.
  try {
    const offlineGame = getOfflineChannelGameFromDom();
    if (offlineGame) {
      console.log(`🎮 EloWard: Offline category detected via DOM - ${offlineGame}`);
      return offlineGame;
    }
  } catch (_) {}

  console.log('🎮 EloWard: Game category detected - Not streaming');
  return null;
}

function isGameSupported(game) {
  if (!game) return false;
  
  if (SUPPORTED_GAMES[game] === true) {
    return true;
  }
  
  const gameLower = game.toLowerCase();
  for (const supportedGame of Object.keys(SUPPORTED_GAMES)) {
    if (supportedGame.toLowerCase() === gameLower) {
      return true;
    }
  }
  
  return false;
}

function setupGameChangeObserver() {
  if (window._eloward_game_observer) {
    window._eloward_game_observer.disconnect();
    window._eloward_game_observer = null;
  }
  
  let gameCheckTimeout = null;
  
  function checkGameChange() {
    if (gameCheckTimeout) {
      clearTimeout(gameCheckTimeout);
    }
    
    gameCheckTimeout = setTimeout(async () => {
      const newGame = await getCurrentGame();
      
      if (newGame !== extensionState.currentGame) {
        const oldGame = extensionState.currentGame;
        extensionState.currentGame = newGame;
        
        if (!isGameSupported(extensionState.currentGame)) {
          if (window._eloward_chat_observer) {
            window._eloward_chat_observer.disconnect();
            window._eloward_chat_observer = null;
          }
          extensionState.observerInitialized = false;
          extensionState.isChannelActive = false;
        } else if (isGameSupported(extensionState.currentGame) && !isGameSupported(oldGame)) {
          extensionState.isChannelActive = true;
          startViewerTracking(); // Start viewer tracking when switching TO LoL
          if (!extensionState.initializationInProgress) initializeExtension();
        }
      }
    }, 1000);
  }
  
  const gameObserver = new MutationObserver(checkGameChange);
  const streamInfoTarget = document.querySelector('[data-a-target="stream-info-card"], [data-test-selector="stream-info-card"]');
  
  // NEW: also observe offline channel header section
  const offlineInfoTarget = document.querySelector('#live-channel-stream-information, .channel-info-content');
  
  if (streamInfoTarget) {
    gameObserver.observe(streamInfoTarget, { 
      subtree: true, 
      childList: true,
      attributes: true,
      attributeFilter: ['data-a-target', 'class', 'style']
    });
  }
  if (offlineInfoTarget) {
    gameObserver.observe(offlineInfoTarget, { 
      subtree: true, 
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });
  }
  
  window._eloward_game_observer = gameObserver;
}

function initializeExtension() {
  if (extensionState.initializationInProgress) return;
  
  extensionState.lastInitAttempt = Date.now();
  
  const currentChannel = getCurrentChannelName();
  if (!currentChannel) return;
  
  const initializationId = Date.now().toString() + Math.random().toString(36).substring(2, 11);
  extensionState.currentInitializationId = initializationId;
  extensionState.initializationInProgress = true;
  extensionState.channelName = currentChannel;
  extensionState.isVod = isVodPage();
  extensionState.lastPathname = window.location.pathname;
  
  
  setTimeout(async () => {
    if (extensionState.currentInitializationId !== initializationId) return;
    
    // Always re-detect game/category here (e.g., when transitioning into VOD from a live channel page)
    const detectedGame = await getCurrentGame();
    extensionState.currentGame = detectedGame;
    
    setupGameChangeObserver();
    
    if (!isGameSupported(extensionState.currentGame)) {
      console.log(`🚀 EloWard: Extension not active - unsupported game: ${extensionState.currentGame || 'none'}`);
      extensionState.initializationInProgress = false;
      extensionState.initializationComplete = true;
      return;
    }
    
    if (isGameSupported(extensionState.currentGame)) {
      extensionState.isChannelActive = true;
      console.log(`🚀 EloWard: Active for ${extensionState.channelName} (${extensionState.chatMode} mode)`);

      // Start viewer tracking whenever extension becomes active
      startViewerTracking();

      if (!extensionState.observerInitialized) {
        initializeObserver();
      }
      try {
        chrome.storage.local.get(['eloward_persistent_connected_state','eloward_persistent_riot_user_data'], (data) => {
          const connected = !!data?.eloward_persistent_connected_state?.riot;
          const hasRiotData = !!data?.eloward_persistent_riot_user_data?.puuid;
          if (connected || hasRiotData) {
            chrome.runtime.sendMessage({ action: 'auto_refresh_rank' }, () => {});
          }
        });
      } catch (_) {}
    }
    extensionState.initializationInProgress = false;
    extensionState.initializationComplete = true;
  }, 1500);
}

function setupUrlChangeObserver() {
  if (window._eloward_url_observer) return;
  
  const urlObserver = new MutationObserver(function() {
    const currentChannel = getCurrentChannelName();
    const currentPathname = window.location.pathname;
    
    if (window.location.pathname.includes('oauth2') || 
        window.location.pathname.includes('auth/') ||
        window.location.href.includes('auth/callback') ||
        window.location.href.includes('auth/redirect')) {
      return;
    }
    
    const isVodNow = isVodPage();
    const wasVodBefore = extensionState.isVod;
    const pathChanged = extensionState.lastPathname !== currentPathname;
    
    if (currentChannel && (currentChannel !== extensionState.channelName || isVodNow !== wasVodBefore || pathChanged)) {
      if (extensionState.channelName) {
        cleanupChannel(extensionState.channelName);
      }
      
      extensionState.channelName = currentChannel;
      extensionState.isVod = isVodNow;
      extensionState.lastPathname = currentPathname;
      extensionState.initializationComplete = false;
      
      // On navigation, only prune unranked entries but preserve ranked users (performance optimization)
      try { 
        chrome.runtime.sendMessage({ action: 'prune_unranked_rank_cache' });
      } catch (_) {}
      
      setTimeout(() => {
        const verifyChannel = getCurrentChannelName();
        if (verifyChannel === currentChannel) {
          // If we just entered a VOD page from a channel page, force a fresh init
          initializeExtension();
        }
      }, 750);
    } else if (!currentChannel && extensionState.channelName) {
      cleanupChannel(extensionState.channelName);
      extensionState.channelName = null;
      extensionState.initializationComplete = false;
    }
  });
  
  urlObserver.observe(document, { subtree: true, childList: true });
  window._eloward_url_observer = urlObserver;
}

function findChatContainer() {
  
  const selectors = [
    '.chat-scrollable-area__message-container',
    '[data-a-target="chat-scroller"]',
    '.chat-list--default',
    '.chat-list',
    '.simplebar-content',
    '[data-test-selector="chat-scrollable-area__message-container"]',
    '.chat-room__content .simplebar-content',
    '.ffz-chat-container',
    '.seventv-chat-container',
    // VOD-specific candidates
    '[data-test-selector="video-chat__message-list"]',
    '.video-chat__message-list',
    '.video-chat__message-list-wrapper',
    '[data-a-target="video-chat"] .simplebar-content',
    '[data-a-target="video-chat"] [role="log"]'
  ];
  
  for (const selector of selectors) {
    const container = document.querySelector(selector);
    if (container) return container;
  }
  
  const anyMessage = document.querySelector('.chat-line__message, .chat-line, [data-a-target="chat-line-message"], .video-chat__message, [data-test-selector*="chat-message"]');
  if (anyMessage) {
    const container = anyMessage.closest('[role="log"], [class*="scroll"], [data-a-target="video-chat"]') || anyMessage.parentElement;
    if (container) return container;
  }
  
  
  return null;
}

function initializeObserver() {
  if (extensionState.observerInitialized) return;
  
  let attempts = 0;
  const maxAttempts = 5;
  
  function tryInitialize() {
    const chatContainer = findChatContainer();
    
    if (chatContainer) {
      setupChatObserver(chatContainer);
      extensionState.observerInitialized = true;
    } else {
      attempts++;
      if (attempts < maxAttempts) {
        setTimeout(tryInitialize, attempts * 1000);
      }
    }
  }
  
  tryInitialize();
}

function setupChatObserver(chatContainer) {
  const currentSelectors = SELECTORS[extensionState.chatMode];
  const messageSelectors = currentSelectors.message;
  
  


  processExistingMessages(chatContainer, messageSelectors);
  
  const chatObserver = new MutationObserver((mutations) => {
    if (!extensionState.isChannelActive) return;
    
    try {
      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // VOD chat can render message wrapper (dtSdDz) where the actual message is inside .video-chat__message
              if (isVodPage() && (node.matches && node.matches('.dtSdDz, .vod-message, .seventv-user-message, .seventv-chat-vod-message-patched'))) {
                // Collect inner messages for both standard VOD and 7TV VOD
                const innerMsgs = node.querySelectorAll('.video-chat__message, .seventv-user-message');
                const author = node.querySelector('a.video-chat__message-author');
                if (author || innerMsgs.length) {
                  const messages = innerMsgs.length ? innerMsgs : node.querySelectorAll(messageSelectors.join(', '));
                  if (messages && messages.length) {
                    
                    messages.forEach(m => {
                      // Ensure we re-evaluate username on VOD for wrappers
                      processNewMessage(m);
                    });
                    continue;
                  }
                }
              }
              const isMessage = messageSelectors.some(selector => 
                node.matches && node.matches(selector)
              );
              
              if (isMessage) {
                
                processNewMessage(node);
              } else {
                const messages = node.querySelectorAll(messageSelectors.join(', '));
                
                for (const message of messages) {
                  
                  processNewMessage(message);
                }
              }
            }
          }
        }
      }
    } catch (error) {}
  });
  
  chatObserver.observe(chatContainer, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style']
  });
  
  window._eloward_chat_observer = chatObserver;
  
  setTimeout(() => {
    try {
      processExistingMessages(chatContainer, messageSelectors);
    } catch (error) {
      // Silent error handling for production
    }
  }, 3000);
}

function processExistingMessages(chatContainer, messageSelectors) {
  try {
  const existingMessages = chatContainer.querySelectorAll(messageSelectors.join(', '));
    const currentSelectors = SELECTORS[extensionState.chatMode];
    const usernameSelectors = currentSelectors.username;
    
    

    const userMessageMap = new Map();
    
    for (const message of existingMessages) {
      if (processedMessages.has(message)) continue;
      

      let usernameElement = null;
      for (const selector of usernameSelectors) {
        usernameElement = message.querySelector(selector);
        if (usernameElement) break;
      }
      if (!usernameElement && isVodPage()) {
        const info = findVodUsernameInfo(message);
        if (info.el) usernameElement = info.el;
      }
      
      if (!usernameElement) continue;
      
      const username = (((usernameElement.getAttribute && usernameElement.getAttribute('data-a-user')) || usernameElement.textContent) || '').trim().toLowerCase();
      if (!username) continue;
      
      // Skip if already has badge
      if (message.querySelector('.eloward-rank-badge')) continue;
      
      processedMessages.add(message);
      // Track pending badge target for immediate application on fetch
      if (!pendingBadgeTargets.has(username)) pendingBadgeTargets.set(username, new Set());
      pendingBadgeTargets.get(username).add(usernameElement);
      
      if (!userMessageMap.has(username)) {
        userMessageMap.set(username, []);
      }
      userMessageMap.get(username).push({
        messageElement: message,
        usernameElement: usernameElement
      });
    }
    

    if (userMessageMap.size > 0) {
      processUsernamesBatch(userMessageMap);
    }
  } catch (error) {
    // Silent error handling for production
  }
}



function processUsernamesBatch(userMessageMap) {
  try {
    
    chrome.runtime.sendMessage({ action: 'get_all_cached_ranks' }, (response) => {
      const cachedRanks = response?.ranks || {};
      const usersNeedingFetch = new Set();
      

      for (const [username, messageData] of userMessageMap.entries()) {

        if (extensionState.currentUser && username === extensionState.currentUser) {
          handleCurrentUserMessages(messageData);
          continue;
        }
        
        if (cachedRanks[username]) {

          applyRankToAllUserMessages(username, messageData, cachedRanks[username]);
          

          if (extensionState.channelName) {
            chrome.runtime.sendMessage({
              action: 'increment_db_reads',
              channel: extensionState.channelName
            });
            chrome.runtime.sendMessage({
              action: 'increment_successful_lookups',
              channel: extensionState.channelName
            });
          }
        } else {
          usersNeedingFetch.add(username);
        }
      }
      
      
      if (usersNeedingFetch.size > 0) {
        fetchRanksForUsers(usersNeedingFetch, userMessageMap);
      }
    });
  } catch (error) {
    // Silent error handling for production
  }
}

function handleCurrentUserMessages(messageData) {
  chrome.storage.local.get(['eloward_persistent_riot_user_data', 'eloward_user_options'], (data) => {
    const riotData = data.eloward_persistent_riot_user_data;
    const userOptions = data.eloward_user_options || {};
    
    const userRankData = riotData?.soloQueueRank ? {
      tier: riotData.soloQueueRank.tier,
      division: riotData.soloQueueRank.division,
      leaguePoints: riotData.soloQueueRank.leaguePoints,
      summonerName: riotData.riotId,
      region: riotData.region,
      animate_badge: userOptions.animate_badge || false
    } : (riotData ? {
      tier: 'UNRANKED',
      division: '',
      leaguePoints: null,
      summonerName: riotData.riotId,
      region: riotData.region,
      animate_badge: userOptions.animate_badge || false
    } : null);

    if (!userRankData) return;

    messageData.forEach(({ usernameElement }) => {
      addBadgeToMessage(usernameElement, userRankData);
    });

    // Immediately cache local user rank data for consistent performance
    chrome.runtime.sendMessage({
      action: 'set_rank_data',
      username: extensionState.currentUser,
      rankData: userRankData
    });

    
    if (extensionState.channelName) {
      chrome.runtime.sendMessage({
        action: 'increment_db_reads',
        channel: extensionState.channelName
      });
      chrome.runtime.sendMessage({
        action: 'increment_successful_lookups',
        channel: extensionState.channelName
      });
    }
  });
}

function applyRankToAllUserMessages(username, messageData, rankData) {
  messageData.forEach(({ usernameElement }) => {
    addBadgeToMessage(usernameElement, rankData);
  });
}

function fetchRanksForUsers(usersNeedingFetch, userMessageMap) {
  // Fetch ranks for each user (could be optimized further with a batch API endpoint)
  for (const username of usersNeedingFetch) {
    const messageData = userMessageMap.get(username);
    
    if (extensionState.channelName) {
      chrome.runtime.sendMessage({
        action: 'increment_db_reads',
        channel: extensionState.channelName
      });
    }

    chrome.runtime.sendMessage({
      action: 'fetch_rank_for_username',
      username: username,
      channel: extensionState.channelName
    }, (response) => {
      if (chrome.runtime.lastError) return;
      
      if (response?.success && response.rankData) {
        // Apply rank to ALL messages for this user at once
        applyRankToAllUserMessages(username, messageData, response.rankData);
        
        if (extensionState.channelName) {
          chrome.runtime.sendMessage({
            action: 'increment_successful_lookups',
            channel: extensionState.channelName
          });
        }
      }
    });
  }
}

function processNewMessage(messageNode) {
  if (!messageNode || processedMessages.has(messageNode)) return;
  if (!extensionState.isChannelActive) return;
  
  processedMessages.add(messageNode);
  
  if (processedMessages.size > 500) {
    const toDelete = Array.from(processedMessages).slice(0, 100);
    toDelete.forEach(msg => processedMessages.delete(msg));
  }

  try {
    const currentSelectors = SELECTORS[extensionState.chatMode];
    const usernameSelectors = currentSelectors.username;
    
    let usernameElement = null;
    for (const selector of usernameSelectors) {
      usernameElement = messageNode.querySelector(selector);
      if (usernameElement) break;
    }
    
    if (!usernameElement) {
      // VOD-specific: try robust fallbacks via container author anchor
      if (isVodPage()) {
        // 7TV VOD: username sits under .seventv-chat-user-username
        if (extensionState.chatMode === 'seventv') {
          usernameElement = messageNode.querySelector('.seventv-chat-user-username');
        }
        // Generic VOD fallback
        const info = !usernameElement ? findVodUsernameInfo(messageNode) : { el: usernameElement };
        if (info.el) usernameElement = info.el;
        if (!usernameElement) {
          console.log('📼 EloWard (VOD): New message without username element', messageNode);
          return;
        }
      } else {
        return;
      }
    }
    
    const username = (((usernameElement.getAttribute && usernameElement.getAttribute('data-a-user')) || usernameElement.textContent) || '').trim().toLowerCase();
    if (!username) {
      if (isVodPage()) {
        console.log('📼 EloWard (VOD): New message username empty', usernameElement);
      }
      return;
    }
    
    if (extensionState.currentUser && username === extensionState.currentUser) {
      chrome.storage.local.get(['eloward_persistent_riot_user_data', 'eloward_user_options'], (data) => {
        const riotData = data.eloward_persistent_riot_user_data;
        const userOptions = data.eloward_user_options || {};
        
        const userRankData = riotData?.soloQueueRank ? {
          tier: riotData.soloQueueRank.tier,
          division: riotData.soloQueueRank.division,
          leaguePoints: riotData.soloQueueRank.leaguePoints,
          summonerName: riotData.riotId,
          region: riotData.region,
          animate_badge: userOptions.animate_badge || false
        } : (riotData ? {
          tier: 'UNRANKED',
          division: '',
          leaguePoints: null,
          summonerName: riotData.riotId,
          region: riotData.region,
          animate_badge: userOptions.animate_badge || false
        } : null);

        if (!userRankData) return;

        // Immediately cache local user rank data for consistent performance
        chrome.runtime.sendMessage({
          action: 'set_rank_data',
          username: username,
          rankData: userRankData
        });

        
        if (extensionState.channelName) {
          chrome.runtime.sendMessage({
            action: 'increment_db_reads',
            channel: extensionState.channelName
          });
          
          chrome.runtime.sendMessage({
            action: 'increment_successful_lookups',
            channel: extensionState.channelName
          });
        }
        
        addBadgeToMessage(usernameElement, userRankData);
      });
      return;
    }
    
    // Register this username element as a pending target for when rank data arrives
    if (!pendingBadgeTargets.has(username)) pendingBadgeTargets.set(username, new Set());
    pendingBadgeTargets.get(username).add(usernameElement);
    fetchRankFromBackground(username);
  } catch (error) {
    console.error('EloWard: Error processing message:', error);
  }
}

function fetchRankFromBackground(username) {
  if (extensionState.channelName) {
    chrome.runtime.sendMessage({
      action: 'increment_db_reads',
      channel: extensionState.channelName
    });
  }

  chrome.runtime.sendMessage({
    action: 'fetch_rank_for_username',
    username: username,
    channel: extensionState.channelName
  }, (response) => {
    if (chrome.runtime.lastError) return;
    
    if (response?.success && response.rankData) {
      if (extensionState.channelName) {
        chrome.runtime.sendMessage({
          action: 'increment_successful_lookups',
          channel: extensionState.channelName
        });
      }

      // Apply the rank to ALL messages from this user in the chat
      applyRankToAllUserMessagesInChat(username, response.rankData);
    }
  });
}

function applyRankToAllUserMessagesInChat(username, rankData) {
  try {
    // 1) Apply to any pending specific username elements queued during observation
    const targets = pendingBadgeTargets.get(username);
    if (targets && targets.size) {
      targets.forEach((el) => {
        if (el && el.isConnected) addBadgeToMessage(el, rankData);
      });
      pendingBadgeTargets.delete(username);
    }
    
    // 2) Also sweep the visible chat for this username (covers initial scan and missed nodes)
    const currentSelectors = SELECTORS[extensionState.chatMode];
    const messageSelectors = currentSelectors.message;
    const usernameSelectors = currentSelectors.username;
    const allMessages = document.querySelectorAll(messageSelectors.join(', '));
    
    allMessages.forEach(messageElement => {
      if (messageElement.querySelector('.eloward-rank-badge')) return;
      let usernameElement = null;
      for (const selector of usernameSelectors) {
        usernameElement = messageElement.querySelector(selector);
        if (usernameElement) break;
      }
      if (!usernameElement && isVodPage()) {
        const info = findVodUsernameInfo(messageElement);
        if (info.el) usernameElement = info.el;
      }
      if (!usernameElement) return;
      const messageUsername = (((usernameElement.getAttribute && usernameElement.getAttribute('data-a-user')) || usernameElement.textContent) || '').trim().toLowerCase();
      if (messageUsername === username) {
        addBadgeToMessage(usernameElement, rankData);
      }
    });
  } catch (error) {
    console.error('EloWard: Error applying rank to all user messages:', error);
  }
}

function addBadgeToMessage(usernameElement, rankData) {
  if (!rankData?.tier) return;
  
  try {
    const currentSelectors = SELECTORS[extensionState.chatMode];
    const messageContainer = usernameElement.closest(currentSelectors.message.join(', ')) || usernameElement.closest('.dtSdDz, .vod-message, .seventv-user-message') || usernameElement.parentElement;
    
    if (!messageContainer) return;
    // If a badge already exists, update it instead of returning
    const existing = messageContainer.querySelector('.eloward-rank-badge');
    if (existing) {
      updateBadgeElement(existing, rankData);
      return;
    }
    
    // Prefer chat-mode specific placement (works for live and VOD)
    switch (extensionState.chatMode) {
      case 'seventv':
        addBadgeToSevenTVMessage(messageContainer, usernameElement, rankData);
        return;
      case 'ffz':
        addBadgeToFFZMessage(messageContainer, usernameElement, rankData);
        return;
      default:
        break;
    }
    
    // Standard Twitch chat
    if (isVodPage()) {
      addBadgeToVodMessage(messageContainer, usernameElement, rankData);
    } else {
      addBadgeToStandardMessage(messageContainer, rankData);
    }
  } catch (error) {
    console.error('EloWard: Error adding badge:', error);
  }
}

function addBadgeToVodMessage(messageContainer, usernameElement, rankData) {
  try {
    // Find the VOD row container that holds badges + author + message
    const vodRow = usernameElement.closest('.dtSdDz') || usernameElement.closest('.vod-message') || messageContainer;
    if (!vodRow) return;
    
    // Prefer the first span before the author anchor as a badge host (matches live layout spacing)
    let badgeHost = null;
    const siblings = Array.from(vodRow.childNodes);
    for (const node of siblings) {
      if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'SPAN') {
        badgeHost = node; break;
      }
      if (node === usernameElement) break;
    }
    if (!badgeHost) {
      badgeHost = document.createElement('span');
      badgeHost.className = 'eloward-badges-host';
      vodRow.insertBefore(badgeHost, usernameElement);
    }
    
    // Update existing badge if present
    const existing = badgeHost.querySelector('.eloward-rank-badge');
    if (existing) {
      updateBadgeElement(existing, rankData);
      return;
    }
    
    const badge = createBadgeElement(rankData);
    // Match live stream markup: wrap in a container div for consistent spacing
    const badgeWrapper = document.createElement('div');
    badgeWrapper.className = 'InjectLayout-sc-1i43xsx-0 dvtAVE';
    badgeWrapper.appendChild(badge);
    badgeHost.appendChild(badgeWrapper);
  } catch (e) {
    console.warn('EloWard (VOD): Failed to add badge', e);
  }
}

function addBadgeToSevenTVMessage(messageContainer, _usernameElement, rankData) {
  // Anchor at the top-level 7TV message wrapper to avoid matching mention tokens
  const userWrapper = messageContainer.closest('.seventv-user-message') || messageContainer.closest('.seventv-chat-vod-message-patched') || messageContainer;
  const chatUser = userWrapper.querySelector('.seventv-chat-user');
  let badgeList = chatUser ? chatUser.querySelector('.seventv-chat-user-badge-list') : null;
  let badgeListWasEmpty = false;
  
  if (!badgeList) {
    if (!chatUser) return;
    
    badgeList = document.createElement('span');
    badgeList.className = 'seventv-chat-user-badge-list';
    badgeListWasEmpty = true;
    
    const usernameEl = chatUser.querySelector('.seventv-chat-user-username');
    if (usernameEl) {
      chatUser.insertBefore(badgeList, usernameEl);
    } else {
      chatUser.insertBefore(badgeList, chatUser.firstChild);
    }
  } else {
    // Check if badge list only contains non-badge elements or is empty
    const existingBadges = badgeList.querySelectorAll('.seventv-chat-badge:not(.eloward-rank-badge)');
    badgeListWasEmpty = existingBadges.length === 0;
  }

  const existing = badgeList.querySelector('.eloward-rank-badge');
  if (existing) {
    updateBadgeElement(existing, rankData);
    return;
  }
  
  const badge = document.createElement('div');
  badge.className = 'seventv-chat-badge eloward-rank-badge';
  // Ensure rightmost position regardless of flex ordering
  try { badge.style.order = '9999'; } catch (_) {}
  
  // If this is the only badge, adjust positioning to align with username
  if (badgeListWasEmpty) {
    badge.classList.add('eloward-single-badge');
  }
  
  const isAnimated = rankData.animate_badge || false;
  
  badge.dataset.rankText = formatRankText(rankData);
  badge.dataset.rank = rankData.tier.toLowerCase();
  badge.dataset.division = rankData.division || '';
  badge.dataset.lp = rankData.leaguePoints !== undefined && rankData.leaguePoints !== null ? 
                     rankData.leaguePoints.toString() : '';
  badge.dataset.username = rankData.summonerName || '';
  badge.dataset.region = rankData.region;
  badge.dataset.isAnimated = isAnimated ? 'true' : 'false';
  
  const img = document.createElement('img');
  img.alt = rankData.tier;
  img.className = 'eloward-badge-img';
  img.width = 24;
  img.height = 24;
  img.decoding = 'async';
  try { img.fetchPriority = 'high'; } catch (_) {}
  img.loading = 'eager';
  img.src = ImageCache.getSrcSync(rankData.tier, isAnimated);
  
  badge.appendChild(img);
  badge.addEventListener('mouseenter', (e) => showSevenTVTooltip(e, rankData));
  badge.addEventListener('mouseleave', () => hideSevenTVTooltip());
  badge.addEventListener('click', handleBadgeClick);
  badge.style.cursor = 'pointer';
  
  badgeList.appendChild(badge);
}

function showSevenTVTooltip(event, rankData) {
  hideSevenTVTooltip();

  if (!rankData?.tier) return;

  const tooltip = document.createElement('div');
  tooltip.className = 'eloward-7tv-tooltip';
  tooltip.id = 'eloward-7tv-tooltip-active';

  const tooltipBadge = document.createElement('img');
  tooltipBadge.className = 'eloward-7tv-tooltip-badge';
  tooltipBadge.decoding = 'async';
  tooltipBadge.loading = 'eager';

  const isAnimated = rankData.animate_badge || false;
  tooltipBadge.src = ImageCache.getSrcSync(rankData.tier, isAnimated);
  tooltipBadge.alt = 'Rank Badge';

  const tooltipText = document.createElement('div');
  tooltipText.className = 'eloward-7tv-tooltip-text';

  const rankDiv = document.createElement('div');
  rankDiv.className = 'eloward-rank-line';
  rankDiv.textContent = formatRankTextForTooltip(rankData);
  tooltipText.appendChild(rankDiv);

  if (rankData.summonerName) {
    const summonerDiv = document.createElement('div');
    summonerDiv.className = 'eloward-summoner-line';
    summonerDiv.textContent = rankData.summonerName;
    tooltipText.appendChild(summonerDiv);
  }

  const displayRegion = getDisplayRegion(rankData.region);
  if (displayRegion) {
    const regionDiv = document.createElement('div');
    regionDiv.className = 'eloward-region-line';
    regionDiv.textContent = displayRegion;
    tooltipText.appendChild(regionDiv);
  }

  const hintDiv = document.createElement('div');
  hintDiv.className = 'eloward-hint';
  hintDiv.textContent = 'Click to view OP.GG';
  tooltipText.appendChild(hintDiv);

  tooltip.appendChild(tooltipBadge);
  tooltip.appendChild(tooltipText);

  const rect = event.target.getBoundingClientRect();
  const badgeCenter = rect.left + (rect.width / 2);

  tooltip.style.left = `${badgeCenter}px`;
  tooltip.style.top = `${rect.top - 5}px`;

  document.body.appendChild(tooltip);
}

function formatRankTextForTooltip(rankData) {
  if (!rankData || !rankData.tier || rankData.tier.toUpperCase() === 'UNRANKED') {
    return 'UNRANKED';
  }
  
  let rankText = rankData.tier;
  
  if (rankData.division && !['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(rankData.tier.toUpperCase())) {
    rankText += ' ' + rankData.division;
  }
  
  if (rankData.tier.toUpperCase() !== 'UNRANKED' && 
      rankData.leaguePoints !== undefined && 
      rankData.leaguePoints !== null) {
    rankText += ' - ' + rankData.leaguePoints + ' LP';
  }
  
  return rankText;
}

function hideSevenTVTooltip() {
  const existingTooltip = document.getElementById('eloward-7tv-tooltip-active');
  if (existingTooltip && existingTooltip.parentNode) {
    existingTooltip.remove();
  }
}

function addBadgeToFFZMessage(messageContainer, usernameElement, rankData) {
  // FFZ should use the same badge container approach as standard mode
  const badgeContainer = findBadgeContainer(messageContainer);
  
  if (!badgeContainer) {
    console.warn('EloWard: Could not find or create badge container for FFZ message');
    return;
  }
  // Update if present
  const existing = badgeContainer.querySelector('.eloward-rank-badge');
  if (existing) {
    updateBadgeElement(existing, rankData);
    return;
  }

  const badge = createBadgeElement(rankData);
  badge.classList.add('ffz-badge');
  
  // Create wrapper div to match other badges
  const badgeWrapper = document.createElement('div');
  badgeWrapper.className = 'InjectLayout-sc-1i43xsx-0 dvtAVE';
  badgeWrapper.appendChild(badge);
  badgeContainer.appendChild(badgeWrapper);
}

function addBadgeToStandardMessage(messageContainer, rankData) {
  // Find or create proper badge container - no fallbacks to username insertion
  const badgeContainer = findBadgeContainer(messageContainer);
  
  if (!badgeContainer) {
    console.warn('EloWard: Could not find or create badge container for message');
    return;
  }
  
  const badge = createBadgeElement(rankData);
  
  // Handle different wrapper structures based on chat mode
  if (extensionState.chatMode === 'seventv') {
    // 7TV mode - add directly to badge list
    badgeContainer.appendChild(badge);
  } else {
    // Standard/FFZ mode - create wrapper div to match other badges
    const badgeWrapper = document.createElement('div');
    badgeWrapper.className = 'InjectLayout-sc-1i43xsx-0 dvtAVE';
    badgeWrapper.appendChild(badge);
    badgeContainer.appendChild(badgeWrapper);
  }
}

function findBadgeContainer(messageContainer) {
  // Handle 7TV mode first
  if (extensionState.chatMode === 'seventv') {
    const seventvBadgeList = messageContainer.querySelector('.seventv-chat-user-badge-list');
    if (seventvBadgeList) {
      return seventvBadgeList;
    }
  }
  
  // First, look for existing badge container (works with FFZ and other extensions)
  const existingBadgeContainer = messageContainer.querySelector('.chat-line__message--badges');
  if (existingBadgeContainer) {
    return existingBadgeContainer;
  }
  
  // Handle standard Twitch chat - look for the badge container structure
  // Pattern: .chat-line__username-container > span (contains badge wrappers)
  const usernameContainer = messageContainer.querySelector('.chat-line__username-container');
  if (usernameContainer) {
    // Look for the span that contains badge wrappers
    const badgeSpan = usernameContainer.querySelector('span');
    if (badgeSpan && badgeSpan.querySelector('[data-a-target="chat-badge"]')) {
      return badgeSpan;
    }
    
    // If no badges exist yet, create the structure if we find the username container
    if (badgeSpan && !badgeSpan.querySelector('[data-a-target="chat-badge"]')) {
      // This span might be for badges but empty, let's use it
      return badgeSpan;
    }
  }
  
  // Fallback: look for any existing badge and get its parent container
  const existingBadge = messageContainer.querySelector('[data-a-target="chat-badge"]');
  if (existingBadge) {
    // Go up to find the container that holds all badges
    let parent = existingBadge.parentElement;
    while (parent && !parent.querySelector('[data-a-target="chat-badge"]')) {
      parent = parent.parentElement;
      if (parent === messageContainer) break;
    }
    if (parent && parent !== messageContainer) {
      return parent.parentElement; // The span that contains badge wrappers
    }
  }
  
  // If no badge container exists, create one - this should always succeed
  const messageContainerChild = messageContainer.querySelector('.chat-line__message-container');
  if (messageContainerChild) {
    const badgeContainer = document.createElement('span');
    badgeContainer.className = 'chat-line__message--badges';
    
  
    const usernameEl = messageContainerChild.querySelector('.chat-line__username') || 
                       messageContainerChild.querySelector('[data-a-target="chat-message-username"]') ||
                       messageContainerChild.querySelector('.chat-author__display-name');
    
    if (usernameEl) {
      messageContainerChild.insertBefore(badgeContainer, usernameEl);
    } else {
      messageContainerChild.insertBefore(badgeContainer, messageContainerChild.firstChild);
    }
    
    return badgeContainer;
  }
  

  const badgeContainer = document.createElement('span');
  badgeContainer.className = 'chat-line__message--badges';
  messageContainer.insertBefore(badgeContainer, messageContainer.firstChild);
  return badgeContainer;
}

function updateBadgeElement(badgeElement, rankData) {
  try {
    if (!badgeElement) return;
    
    const isAnimated = rankData.animate_badge || false;
    
    badgeElement.dataset.rankText = formatRankText(rankData);
    badgeElement.dataset.rank = rankData.tier.toLowerCase();
    badgeElement.dataset.division = rankData.division || '';
    badgeElement.dataset.lp = rankData.leaguePoints !== undefined && rankData.leaguePoints !== null ? String(rankData.leaguePoints) : '';
    badgeElement.dataset.username = rankData.summonerName || '';
    badgeElement.dataset.region = rankData.region || '';
    badgeElement.dataset.isAnimated = isAnimated ? 'true' : 'false';

    const img = badgeElement.querySelector('img');
    if (img) {
      img.alt = rankData.tier;
      try { img.decoding = 'async'; } catch (_) {}
      try { img.fetchPriority = 'high'; } catch (_) {}
      try { img.loading = 'eager'; } catch (_) {}
      img.src = ImageCache.getSrcSync(rankData.tier, isAnimated);
    }
  } catch (_) {}
}


function formatRankText(rankData) {
  if (!rankData || !rankData.tier || rankData.tier.toUpperCase() === 'UNRANKED') {
    return 'UNRANKED';
  }
  
  let rankText = rankData.tier;
  
  if (rankData.division && !['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(rankData.tier.toUpperCase())) {
    rankText += ' ' + rankData.division;
  }
  
  if (rankData.tier.toUpperCase() !== 'UNRANKED' && 
      rankData.leaguePoints !== undefined && 
      rankData.leaguePoints !== null) {
    rankText += ' - ' + rankData.leaguePoints + ' LP';
  }
  
  if (rankData.summonerName) {
    rankText += ` (${rankData.summonerName})`;
  }
  
  return rankText;
}

function showTooltip(event) {
  if (!tooltipElement) {
    tooltipElement = document.createElement('div');
    tooltipElement.className = 'eloward-tooltip';
    document.body.appendChild(tooltipElement);
  }

  const badge = event.currentTarget;
  const rankTier = badge.dataset.rank || 'UNRANKED';
  const division = badge.dataset.division || '';
  let lp = badge.dataset.lp || '';
  const regionCode = badge.dataset.region || '';
  const summonerName = badge.dataset.username || '';
  const displayRegion = getDisplayRegion(regionCode);

  if (lp && !isNaN(Number(lp))) {
    lp = Number(lp).toString();
  }

  while (tooltipElement.firstChild) {
    tooltipElement.removeChild(tooltipElement.firstChild);
  }

  const tooltipBadge = document.createElement('img');
  tooltipBadge.className = 'eloward-tooltip-badge';
  const originalImg = badge.querySelector('img');
  if (originalImg && originalImg.src) {
    tooltipBadge.src = originalImg.src;
    tooltipBadge.alt = 'Rank Badge';
  }
  tooltipElement.appendChild(tooltipBadge);

  const tooltipText = document.createElement('div');
  tooltipText.className = 'eloward-tooltip-text';

  const rankDiv = document.createElement('div');
  rankDiv.className = 'eloward-rank-line';
  if (!rankTier || rankTier.toUpperCase() === 'UNRANKED') {
    rankDiv.textContent = 'UNRANKED';
  } else {
    let formattedTier = rankTier.toUpperCase();
    let rankText = formattedTier;
    if (division && !['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(rankTier.toUpperCase())) {
      rankText += ' ' + division;
    }
    if (lp !== undefined && lp !== null && lp !== '') {
      rankText += ' - ' + lp + ' LP';
    }
    rankDiv.textContent = rankText;
  }
  tooltipText.appendChild(rankDiv);

  if (summonerName) {
    const summonerDiv = document.createElement('div');
    summonerDiv.className = 'eloward-summoner-line';
    summonerDiv.textContent = summonerName;
    tooltipText.appendChild(summonerDiv);
  }

  if (displayRegion) {
    const regionDiv = document.createElement('div');
    regionDiv.className = 'eloward-region-line';
    regionDiv.textContent = displayRegion;
    tooltipText.appendChild(regionDiv);
  }

  const hintDiv = document.createElement('div');
  hintDiv.className = 'eloward-hint';
  hintDiv.textContent = 'Click to view OP.GG';
  tooltipText.appendChild(hintDiv);

  tooltipElement.appendChild(tooltipText);

  const rect = badge.getBoundingClientRect();
  const badgeCenter = rect.left + (rect.width / 2);

  tooltipElement.style.left = `${badgeCenter}px`;
  tooltipElement.style.top = `${rect.top - 5}px`;
  tooltipElement.classList.add('visible');
}

function hideTooltip() {
  if (tooltipElement && tooltipElement.classList.contains('visible')) {
    tooltipElement.classList.remove('visible');
  }
}

initializeStorage();
setupUrlChangeObserver();
detectChatMode();
setupCompatibilityMonitor();
setupFallbackInitialization();

// Clear cache on page load (refresh/direct navigation) to detect newly joined EloWard users
try {
  chrome.runtime.sendMessage({ action: 'clear_rank_cache_except_current_user' });
} catch (_) {}

initializeExtension();


window.addEventListener('blur', () => {
  hideTooltip();
  hideSevenTVTooltip();
});

window.addEventListener('popstate', function() {
  // Clear cache on page refresh/navigation to detect newly joined EloWard users
  try {
    chrome.runtime.sendMessage({ action: 'clear_rank_cache_except_current_user' });
  } catch (_) {}
  
  if (!extensionState.initializationInProgress) {
    initializeExtension();
  }
});

// Listen for immediate rank cache updates from background (especially local user)
try {
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'rank_data_updated' && message.username && message.rankData) {
      try {
        applyRankToAllUserMessagesInChat(message.username, message.rankData);
      } catch (_) {}
    }
    
    // Handle console log messages from background script
    if (message && message.type === 'console_log' && message.message) {
      try {
        console.log(message.message);
      } catch (_) {}
    }
  });
} catch (_) {}

window.addEventListener('beforeunload', function() {
  if (extensionState.channelName) {
    cleanupChannel(extensionState.channelName);
  }
  // Do not clear rank cache on unload; background manages session resets
  try { ImageCache.revokeAll(); } catch (_) {}
});

 