/* Copyright 2024 EloWard - Apache 2.0 + Commons Clause License */

document.body.setAttribute('data-eloward-chrome-ext', 'active');
document.documentElement.setAttribute('data-eloward-chrome-ext', 'active');

const extensionState = {
  isChannelActive: false,
  channelName: '',
  currentGame: null,
  currentUser: null,
  observerInitialized: false,
  lastChannelActiveCheck: null,
  initializationInProgress: false,
  currentInitializationId: null,
  compatibilityMode: false,
  initializationComplete: false,
  lastInitAttempt: 0,
  fallbackInitialized: false,
  chatMode: 'standard'
};

const channelState = {
  activeChannels: new Set(),
  currentChannel: null,
  activeAbortController: null
};

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


const SUPPORTED_GAMES = { 'League of Legends': true };

let processedMessages = new Set();
let tooltipElement = null;

const REGION_MAPPING = {
  'na1': 'na', 'euw1': 'euw', 'eun1': 'eune', 'kr': 'kr', 'br1': 'br',
  'jp1': 'jp', 'la1': 'lan', 'la2': 'las', 'oc1': 'oce', 'tr1': 'tr',
  'ru': 'ru', 'me1': 'me', 'sea': 'sg', 'tw2': 'tw', 'vn2': 'vn'
};

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
  badge.className = 'eloward-rank-badge';
  badge.dataset.rankText = formatRankText(rankData);
  badge.dataset.rank = rankData.tier.toLowerCase();
  badge.dataset.division = rankData.division || '';
  badge.dataset.lp = rankData.leaguePoints !== undefined && rankData.leaguePoints !== null ? 
                     rankData.leaguePoints.toString() : '';
  badge.dataset.username = rankData.summonerName || '';
  badge.dataset.region = rankData.region;
  
  const img = document.createElement('img');
  img.alt = rankData.tier;
  img.className = 'eloward-badge-img';
  img.width = 24;
  img.height = 24;
  img.src = `https://eloward-cdn.unleashai.workers.dev/lol/${rankData.tier.toLowerCase()}.png`;
  
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

function clearRankCache() {
  try { browser.runtime.sendMessage({ action: 'clear_rank_cache' }); } catch (_) {}
  processedMessages.clear();
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
  
  if (channelState.activeAbortController) {
    channelState.activeAbortController.abort();
    channelState.activeAbortController = null;
  }
  
  channelState.activeChannels.delete(channelName);
}

async function initializeChannel(channelName, initializationId) {
  if (!channelName) return false;
  
  const normalizedChannel = channelName.toLowerCase();
  const abortController = new AbortController();
  channelState.activeAbortController = abortController;
  
  try {
    if (extensionState.currentInitializationId !== initializationId) {
      return false;
    }
    
    channelState.activeChannels.add(normalizedChannel);
    channelState.currentChannel = normalizedChannel;
    
    const isActive = await checkChannelActive(channelName, true, abortController.signal);
    
    if (extensionState.currentInitializationId !== initializationId || abortController.signal.aborted) {
      return false;
    }
    
    if (isActive) {
      channelState.activeChannels.add(normalizedChannel);
      extensionState.isChannelActive = true;
    } else {
      channelState.activeChannels.delete(normalizedChannel);
      extensionState.isChannelActive = false;
    }
    
    return isActive;
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('EloWard: Channel initialization error:', error);
    }
    return false;
  }
}

function initializeStorage() {
  chrome.storage.local.get(null, (allData) => {
    extensionState.currentUser = findCurrentUser(allData);
    
    if (extensionState.currentUser) {
      chrome.runtime.sendMessage({
        action: 'set_current_user',
        username: extensionState.currentUser
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

async function checkChannelActive(channelName, forceCheck = false, signal = null) {
  if (!channelName) return false;
  
  if (signal?.aborted) {
    throw new DOMException('Operation aborted', 'AbortError');
  }
  
  const now = Date.now();
  if (!forceCheck && 
      extensionState.lastChannelActiveCheck && 
      extensionState.channelName === channelName && 
      (now - extensionState.lastChannelActiveCheck) < 30000) {
    return extensionState.isChannelActive;
  }
  
  try {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Operation aborted', 'AbortError'));
        return;
      }
      
      const abortListener = () => {
        reject(new DOMException('Operation aborted', 'AbortError'));
      };
      
      if (signal) {
        signal.addEventListener('abort', abortListener, { once: true });
      }
      
      chrome.runtime.sendMessage(
        { 
          action: 'check_channel_active', 
          streamer: channelName,
          skipCache: true
        },
        (response) => {
          if (signal) {
            signal.removeEventListener('abort', abortListener);
          }
          
          if (signal?.aborted) {
            reject(new DOMException('Operation aborted', 'AbortError'));
            return;
          }
          
          if (chrome.runtime.lastError) {
            resolve(false);
            return;
          }
          
          const isActive = response && response.active === true;
          console.log(`${isActive ? '✅' : '❌'} EloWard: Channel ${channelName} is ${isActive ? 'active' : 'not active'}`);
          
          if (!signal?.aborted) {
            extensionState.lastChannelActiveCheck = now;
          }
          
          resolve(isActive);
        }
      );
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw error;
    }
    return false;
  }
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
    if (scraped) {
      console.log(`🎮 EloWard (VOD): Game category detected - ${scraped}`);
      return scraped;
    }
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
          if (extensionState.channelName && !extensionState.initializationInProgress) {
            initializeExtension();
          }
        }
      }
    }, 1000);
  }
  
  const gameObserver = new MutationObserver(checkGameChange);
  const streamInfoTarget = document.querySelector('[data-a-target="stream-info-card"]');
  
  if (streamInfoTarget) {
    gameObserver.observe(streamInfoTarget, { 
      subtree: true, 
      childList: true,
      attributes: true,
      attributeFilter: ['data-a-target']
    });
    
    window._eloward_game_observer = gameObserver;
  }
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
  if (isVodPage()) {
    console.log(`📼 EloWard: VOD mode active for ${extensionState.channelName}`);
  }
  
  chrome.runtime.sendMessage({
    action: 'channel_switched',
    oldChannel: channelState.currentChannel,
    newChannel: currentChannel
  });
  
  setTimeout(async () => {
    if (extensionState.currentInitializationId !== initializationId) return;
    
    const detectedGame = await getCurrentGame();
    extensionState.currentGame = detectedGame;
    
    setupGameChangeObserver();
    
    if (!isGameSupported(extensionState.currentGame)) {
      console.log(`🚀 EloWard: Extension not active - unsupported game: ${extensionState.currentGame || 'none'}`);
      extensionState.initializationInProgress = false;
      extensionState.initializationComplete = true;
      return;
    }
    
    initializeChannel(extensionState.channelName, initializationId)
      .then(channelActive => {
        if (extensionState.currentInitializationId !== initializationId) return;
        
        if (channelActive) {
          console.log(`🚀 EloWard: Extension active for ${extensionState.channelName} (${extensionState.chatMode} mode)`);
          if (!extensionState.observerInitialized) {
            initializeObserver();
          }
          try {
            // Only auto-refresh if Riot appears connected or we have stored Riot data
            chrome.storage.local.get(['eloward_persistent_connected_state','eloward_persistent_riot_user_data'], (data) => {
              const connected = !!data?.eloward_persistent_connected_state?.riot;
              const hasRiotData = !!data?.eloward_persistent_riot_user_data?.puuid;
              if (connected || hasRiotData) {
                chrome.runtime.sendMessage({ action: 'auto_refresh_rank' }, (resp) => {
                  if (resp?.refreshed) {
                    console.log('EloWard: Rank auto-refreshed on activation');
                  }
                });
              }
            });
          } catch (_) {}
        } else {
          console.log(`🚀 EloWard: Extension not active - channel ${extensionState.channelName} not subscribed`);
        }
        
        extensionState.initializationInProgress = false;
        extensionState.initializationComplete = true;
      })
      .catch(error => {
        if (error.name !== 'AbortError') {
          console.error('EloWard: Initialization error:', error);
        }
        extensionState.initializationInProgress = false;
        extensionState.initializationComplete = true;
      });
  }, 1500);
}

function setupUrlChangeObserver() {
  if (window._eloward_url_observer) return;
  
  const urlObserver = new MutationObserver(function() {
    const currentChannel = getCurrentChannelName();
    
    if (window.location.pathname.includes('oauth2') || 
        window.location.pathname.includes('auth/') ||
        window.location.href.includes('auth/callback') ||
        window.location.href.includes('auth/redirect')) {
      return;
    }
    
    if (currentChannel && currentChannel !== extensionState.channelName) {
      if (extensionState.channelName) {
        cleanupChannel(extensionState.channelName);
      }
      
      extensionState.channelName = currentChannel;
      extensionState.initializationComplete = false;
      clearRankCache();
      
      setTimeout(() => {
        const verifyChannel = getCurrentChannelName();
        if (verifyChannel === currentChannel) {
          initializeExtension();
        }
      }, 500);
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
    '.seventv-chat-container'
  ];
  
  for (const selector of selectors) {
    const container = document.querySelector(selector);
    if (container) return container;
  }
  
  const anyMessage = document.querySelector('.chat-line__message, .chat-line, [data-a-target="chat-line-message"]');
  if (anyMessage) {
    const container = anyMessage.closest('[role="log"]') || anyMessage.parentElement;
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
    } catch (error) {
      // Silent error handling for production
    }
  });
  
  chatObserver.observe(chatContainer, {
    childList: true,
    subtree: true
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
      
      if (!usernameElement) continue;
      
      const username = usernameElement.textContent?.trim().toLowerCase();
      if (!username) continue;
      
      // Skip if already has badge
      if (message.querySelector('.eloward-rank-badge')) continue;
      
      processedMessages.add(message);
      
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

        if (extensionState.currentUser && username === extensionState.currentUser.toLowerCase()) {
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
  chrome.storage.local.get(['eloward_persistent_riot_user_data'], (data) => {
    const riotData = data.eloward_persistent_riot_user_data;
    
    const userRankData = riotData?.rankInfo ? {
      tier: riotData.rankInfo.tier,
      division: riotData.rankInfo.rank,
      leaguePoints: riotData.rankInfo.leaguePoints,
      summonerName: riotData.riotId,
      region: riotData.region
    } : (riotData ? {
      tier: 'UNRANKED',
      division: '',
      leaguePoints: null,
      summonerName: riotData.riotId,
      region: riotData.region
    } : null);

    if (!userRankData) return;

    messageData.forEach(({ usernameElement }) => {
      addBadgeToMessage(usernameElement, userRankData);
    });

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
    
    if (!usernameElement) return;
    
    const username = usernameElement.textContent?.trim().toLowerCase();
    if (!username) return;
    
    if (extensionState.currentUser && username === extensionState.currentUser.toLowerCase()) {
      chrome.storage.local.get(['eloward_persistent_riot_user_data'], (data) => {
        const riotData = data.eloward_persistent_riot_user_data;
        
        const userRankData = riotData?.rankInfo ? {
          tier: riotData.rankInfo.tier,
          division: riotData.rankInfo.rank,
          leaguePoints: riotData.rankInfo.leaguePoints,
          summonerName: riotData.riotId,
          region: riotData.region
        } : (riotData ? {
          tier: 'UNRANKED',
          division: '',
          leaguePoints: null,
          summonerName: riotData.riotId,
          region: riotData.region
        } : null);

        if (!userRankData) return;

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
    const currentSelectors = SELECTORS[extensionState.chatMode];
    const messageSelectors = currentSelectors.message;
    const usernameSelectors = currentSelectors.username;
    
    // Find all messages in the current chat
    const allMessages = document.querySelectorAll(messageSelectors.join(', '));
    
    allMessages.forEach(messageElement => {
      // Skip if already has badge
      if (messageElement.querySelector('.eloward-rank-badge')) return;
      
      // Find username element
      let usernameElement = null;
      for (const selector of usernameSelectors) {
        usernameElement = messageElement.querySelector(selector);
        if (usernameElement) break;
      }
      
      if (!usernameElement) return;
      
      const messageUsername = usernameElement.textContent?.trim().toLowerCase();
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
    const messageContainer = usernameElement.closest(currentSelectors.message.join(', '));
    
    if (!messageContainer) return;
    if (messageContainer.querySelector('.eloward-rank-badge')) return;
    
    switch (extensionState.chatMode) {
      case 'seventv':
        addBadgeToSevenTVMessage(messageContainer, usernameElement, rankData);
        break;
      case 'ffz':
        addBadgeToFFZMessage(messageContainer, usernameElement, rankData);
        break;
      default:
        addBadgeToStandardMessage(messageContainer, rankData);
        break;
    }
  } catch (error) {
    console.error('EloWard: Error adding badge:', error);
  }
}

function addBadgeToSevenTVMessage(messageContainer, _usernameElement, rankData) {
  let badgeList = messageContainer.querySelector('.seventv-chat-user-badge-list');
  let badgeListWasEmpty = false;
  
  if (!badgeList) {
    const chatUser = messageContainer.querySelector('.seventv-chat-user');
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

  if (badgeList.querySelector('.eloward-rank-badge')) return;
  
  const badge = document.createElement('div');
  badge.className = 'seventv-chat-badge eloward-rank-badge';
  
  // If this is the only badge, adjust positioning to align with username
  if (badgeListWasEmpty) {
    badge.classList.add('eloward-single-badge');
  }
  
  badge.dataset.rankText = formatRankText(rankData);
  badge.dataset.rank = rankData.tier.toLowerCase();
  badge.dataset.division = rankData.division || '';
  badge.dataset.lp = rankData.leaguePoints !== undefined && rankData.leaguePoints !== null ? 
                     rankData.leaguePoints.toString() : '';
  badge.dataset.username = rankData.summonerName || '';
  badge.dataset.region = rankData.region;
  
  const img = document.createElement('img');
  img.alt = rankData.tier;
  img.className = 'eloward-badge-img';
  img.width = 24;
  img.height = 24;
  img.src = `https://eloward-cdn.unleashai.workers.dev/lol/${rankData.tier.toLowerCase()}.png`;
  
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
  tooltipBadge.src = `https://eloward-cdn.unleashai.workers.dev/lol/${rankData.tier.toLowerCase()}.png`;
  tooltipBadge.alt = 'Rank Badge';
  
  const tooltipText = document.createElement('div');
  tooltipText.className = 'eloward-7tv-tooltip-text';
  tooltipText.textContent = formatRankTextForTooltip(rankData);
  
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
  
  if (lp && !isNaN(Number(lp))) {
    lp = Number(lp).toString();
  }
  
  tooltipElement.innerHTML = '';
  
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
  
  if (!rankTier || rankTier.toUpperCase() === 'UNRANKED') {
    tooltipText.textContent = 'Unranked';
  } else {
    let formattedTier = rankTier.toLowerCase();
    formattedTier = formattedTier.charAt(0).toUpperCase() + formattedTier.slice(1);
    
    let rankText = formattedTier;
    
    if (division && !['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(rankTier.toUpperCase())) {
      rankText += ' ' + division;
    }
    
    if (lp !== undefined && lp !== null && lp !== '') {
      rankText += ' - ' + lp + ' LP';
    }
    
    tooltipText.textContent = rankText;
  }
  
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
initializeExtension();


window.addEventListener('blur', () => {
  hideTooltip();
  hideSevenTVTooltip();
});

window.addEventListener('popstate', function() {
  if (!extensionState.initializationInProgress) {
    initializeExtension();
  }
});

window.addEventListener('beforeunload', function() {
  if (extensionState.channelName) {
    cleanupChannel(extensionState.channelName);
  }
  clearRankCache();
});

 