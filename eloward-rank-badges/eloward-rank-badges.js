/**
 * EloWard Rank Badges - OBS Plugin
 * 
 * This script is injected into the OBS chat window
 * to display rank badges for viewers.
 */

(function() {
    // Configuration (provided by OBS plugin during injection)
    const CONFIG = window.ELOWARD_CONFIG || {
        streamerName: '',
        isSubscribed: false,
        apiUrls: {
            rank: 'https://eloward-viewers-api.unleashai-inquiries.workers.dev/api/ranks/lol',
            subscription: 'https://eloward-subscription-api.unleashai-inquiries.workers.dev'
        }
    };
    
    // Exit immediately if not subscribed
    if (!CONFIG.streamerName || !CONFIG.isSubscribed) {
        return;
    }
    
    // Constants
    const BADGE_CLASS = 'eloward-rank-badge';
    const DEBUG = false;
    
    // Track processed usernames to avoid duplicates
    const processedUsernames = new Set();
    const rankCache = new Map();
    
    // Track metrics
    let localDbReadCount = 0;
    let localSuccessfulLookupCount = 0;
    
    // Add periodic sync for metrics
    setInterval(() => {
        syncMetrics();
    }, 30000); // Sync every 30 seconds
    
    // Define resources path for accessing images
    const RESOURCES_PATH = (function() {
        // Try to detect the resources path based on the environment
        const scriptElement = document.currentScript;
        if (scriptElement && scriptElement.src) {
            const scriptPath = scriptElement.src;
            // Extract the base path from the script URL
            return scriptPath.substring(0, scriptPath.lastIndexOf('/') + 1) + 'images/ranks/';
        }
        // Fallback: assume a relative path
        return 'images/ranks/';
    })();
    
    // Rank tier mapping for image names
    const RANK_TIERS = [
        'IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM',
        'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER', 'UNRANKED'
    ];
    
    // Rank tier colors as fallback
    const RANK_COLORS = {
        'IRON': '#565556',
        'BRONZE': '#795649',
        'SILVER': '#7e8082',
        'GOLD': '#e09d49',
        'PLATINUM': '#36b5b8',
        'EMERALD': '#139d5c',
        'DIAMOND': '#5046c8',
        'MASTER': '#9646c8',
        'GRANDMASTER': '#c32d25',
        'CHALLENGER': '#e9ddaa',
        'UNRANKED': '#000000'
    };
    
    // Log initialization with config
    if (DEBUG) {
        console.log('EloWard Config:', CONFIG);
    }
    
    /**
     * Increment the db_read counter
     */
    async function incrementDbReadCounter() {
        localDbReadCount++;
        
        try {
            const response = await fetch(`${CONFIG.apiUrls.subscription}/metrics/db_read`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channel_name: CONFIG.streamerName })
            });
            
            if (DEBUG && !response.ok) {
                console.error(`Failed to increment db_read: ${response.status}`);
            }
        } catch (error) {
            if (DEBUG) console.error('Error incrementing db_read counter:', error);
        }
    }
    
    /**
     * Increment the successful_lookup counter
     */
    async function incrementSuccessfulLookupCounter() {
        localSuccessfulLookupCount++;
        
        try {
            const response = await fetch(`${CONFIG.apiUrls.subscription}/metrics/successful_lookup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channel_name: CONFIG.streamerName })
            });
            
            if (DEBUG && !response.ok) {
                console.error(`Failed to increment successful_lookup: ${response.status}`);
            }
        } catch (error) {
            if (DEBUG) console.error('Error incrementing successful_lookup counter:', error);
        }
    }
    
    /**
     * Sync locally tracked metrics with the OBS plugin
     */
    function syncMetrics() {
        if (DEBUG) {
            console.log(`EloWard Metrics: ${localDbReadCount} DB reads, ${localSuccessfulLookupCount} successful lookups`);
        }
    }
    
    // Add styles for rank badges
    function addRankStyles() {
        if (document.getElementById('eloward-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'eloward-styles';
        style.textContent = `
            .${BADGE_CLASS} {
                display: inline-flex;
                align-items: center;
                margin-left: 5px;
                vertical-align: middle;
            }
            
            .${BADGE_CLASS} img {
                width: 18px;
                height: 18px;
                margin-right: 2px;
            }
            
            .${BADGE_CLASS}:hover {
                opacity: 0.9;
            }
            
            .eloward-tooltip {
                position: absolute;
                background: rgba(0,0,0,0.85);
                color: white;
                border-radius: 4px;
                padding: 6px 10px;
                font-size: 12px;
                z-index: 9999;
                pointer-events: none;
                max-width: 200px;
                box-shadow: 0 2px 5px rgba(0,0,0,0.3);
            }
            
            .eloward-tooltip-content {
                display: flex;
                flex-direction: column;
            }
            
            .eloward-tooltip-rank {
                font-weight: bold;
                margin-bottom: 3px;
                display: flex;
                align-items: center;
            }
            
            .eloward-tooltip-rank img {
                margin-right: 5px;
                width: 24px;
                height: 24px;
            }
            
            .eloward-tooltip-stats {
                font-size: 11px;
                opacity: 0.9;
            }
        `;
        document.head.appendChild(style);
        if (DEBUG) console.log('EloWard: Added rank badge styles');
    }
    
    // Format rank for display (e.g. "DIAMOND III")
    function formatRank(rankData) {
        if (!rankData || !rankData.rank_tier || rankData.rank_tier === 'UNRANKED') {
            return 'UNRANKED';
        }
        
        const tier = rankData.rank_tier;
        const division = rankData.rank_division;
        
        if (tier === 'MASTER' || tier === 'GRANDMASTER' || tier === 'CHALLENGER') {
            return tier;
        } 
        
        return division ? `${tier} ${division}` : tier;
    }
    
    // Get the rank image URL based on tier
    function getRankImageUrl(tier) {
        if (!tier) return null;
        
        // Normalize tier name
        const normalizedTier = tier.toLowerCase();
        
        // First try 36px version (higher quality for tooltips)
        return `${RESOURCES_PATH}${normalizedTier}36.png`;
    }
    
    // Fallback to get color for rank tier
    function getRankColor(tier) {
        return RANK_COLORS[tier] || '#000000';
    }
    
    // Preload rank images for better performance
    function preloadRankImages() {
        RANK_TIERS.forEach(tier => {
            const img = new Image();
            img.src = getRankImageUrl(tier);
        });
    }
    
    // Create and show tooltip
    function showTooltip(event, rankData) {
        // Remove any existing tooltip
        hideTooltip();
        
        // Create tooltip
        const tooltip = document.createElement('div');
        tooltip.className = 'eloward-tooltip';
        
        // Create content
        const content = document.createElement('div');
        content.className = 'eloward-tooltip-content';
        
        // Add rank info with image
        const rankText = document.createElement('div');
        rankText.className = 'eloward-tooltip-rank';
        
        // Add rank image in tooltip
        const rankImg = document.createElement('img');
        rankImg.src = getRankImageUrl(rankData.rank_tier);
        rankImg.alt = rankData.rank_tier;
        rankImg.onerror = () => {
            rankImg.style.display = 'none';
            rankText.style.color = getRankColor(rankData.rank_tier);
        };
        rankText.appendChild(rankImg);
        
        // Add rank text
        const rankTextSpan = document.createElement('span');
        rankTextSpan.textContent = formatRank(rankData);
        rankText.appendChild(rankTextSpan);
        
        content.appendChild(rankText);
        
        // Add LP/winrate if available
        if (rankData.lp !== undefined || rankData.wins !== undefined) {
            const stats = document.createElement('div');
            stats.className = 'eloward-tooltip-stats';
            
            if (rankData.lp !== undefined) {
                stats.textContent = `${rankData.lp} LP`;
            }
            
            if (rankData.wins !== undefined && rankData.losses !== undefined) {
                const total = rankData.wins + rankData.losses;
                const winrate = total > 0 ? Math.round((rankData.wins / total) * 100) : 0;
                stats.textContent += stats.textContent ? ` • ` : '';
                stats.textContent += `${rankData.wins}W ${rankData.losses}L (${winrate}%)`;
            }
            
            content.appendChild(stats);
        }
        
        // Add summoner name if available
        if (rankData.summonerName) {
            const summonerInfo = document.createElement('div');
            summonerInfo.className = 'eloward-tooltip-stats';
            summonerInfo.textContent = rankData.summonerName;
            content.appendChild(summonerInfo);
        }
        
        tooltip.appendChild(content);
        document.body.appendChild(tooltip);
        
        // Position tooltip
        const rect = event.target.getBoundingClientRect();
        tooltip.style.left = `${rect.left + window.scrollX}px`;
        tooltip.style.top = `${rect.top + window.scrollY - tooltip.offsetHeight - 8}px`;
        
        // Save reference to tooltip
        window.elowardTooltip = tooltip;
    }
    
    // Hide tooltip
    function hideTooltip() {
        if (window.elowardTooltip) {
            window.elowardTooltip.remove();
            window.elowardTooltip = null;
        }
    }
    
    // Fetch rank data from API
    async function fetchRank(username) {        
        try {
            // Check cache first
            if (rankCache.has(username)) {
                return rankCache.get(username);
            }
            
            // Increment db_read counter
            await incrementDbReadCounter();
            
            const response = await fetch(`${CONFIG.apiUrls.rank}/${username}`);
            
            if (response.status === 404) {
                // User not found, cache as unranked
                const unrankedData = { rank_tier: 'UNRANKED' };
                rankCache.set(username, unrankedData);
                return unrankedData;
            }
            
            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }
            
            const data = await response.json();
            
            // Increment successful lookup counter
            await incrementSuccessfulLookupCounter();
            
            // Normalize data format to ensure consistent property names
            const normalizedData = {
                rank_tier: data.rank_tier || data.tier || 'UNRANKED',
                rank_division: data.rank_division || data.division,
                lp: data.lp || data.leaguePoints,
                wins: data.wins,
                losses: data.losses,
                summonerName: data.riot_id || data.summonerName
            };
            
            rankCache.set(username, normalizedData);
            return normalizedData;
        } catch (err) {
            if (DEBUG) console.error(`Error fetching rank for ${username}:`, err);
            return null;
        }
    }
    
    // Add badge to chat message
    async function addBadgeToMessage(chatLine) {
        // Find the username element (supports multiple Twitch chat formats)
        const usernameElement = chatLine.querySelector('.chat-author__display-name, .chat-line__username, .chat-line__username-container, .username');
        if (!usernameElement) return;
        
        // Extract username
        const username = usernameElement.textContent.trim().toLowerCase();
        
        // Skip if already processed (avoid duplicates)
        if (processedUsernames.has(username)) return;
        processedUsernames.add(username);
        
        // Fetch rank data
        const rankData = await fetchRank(username);
        if (!rankData) return;
        
        // Create badge element
        const badgeElement = document.createElement('span');
        badgeElement.className = BADGE_CLASS;
        badgeElement.dataset.rankText = formatRank(rankData);
        
        // Create the rank image
        const rankImg = document.createElement('img');
        rankImg.alt = rankData.rank_tier;
        rankImg.src = getRankImageUrl(rankData.rank_tier);
        
        // Handle image load error - fallback to color badge with text
        rankImg.onerror = () => {
            rankImg.style.display = 'none';
            badgeElement.textContent = formatRank(rankData);
            badgeElement.style.backgroundColor = getRankColor(rankData.rank_tier);
            badgeElement.style.padding = '1px 4px';
            badgeElement.style.borderRadius = '3px';
            badgeElement.style.fontSize = '11px';
            badgeElement.style.fontWeight = 'bold';
            badgeElement.style.color = 'white';
        };
        
        // Add the image to the badge
        badgeElement.appendChild(rankImg);
        
        // Store rank data for tooltip
        badgeElement.dataset.rank = rankData.rank_tier;
        badgeElement.dataset.division = rankData.rank_division || '';
        badgeElement.dataset.lp = rankData.lp !== undefined ? rankData.lp.toString() : '';
        badgeElement.dataset.username = rankData.summonerName || '';
        
        // Add tooltip events
        badgeElement.addEventListener('mouseenter', (e) => showTooltip(e, rankData));
        badgeElement.addEventListener('mouseleave', hideTooltip);
        
        // Add badge after username
        usernameElement.insertAdjacentElement('afterend', badgeElement);
        
        if (DEBUG) console.log(`Added badge for ${username}: ${formatRank(rankData)}`);
    }
    
    // Initialize chat observer
    function initChatObserver() {
        // Add styles
        addRankStyles();
        
        // Preload images
        preloadRankImages();
        
        // Find the chat container based on common Twitch chat layouts
        const containerSelectors = [
            '.chat-scrollable-area__message-container',  // Standard Twitch
            '.chat-list',                                // Alternate Twitch
            '.stream-chat',                              // OBS browser source
            '.live-chat-container',                      // Other common formats
            '.chat-room__content',                       // Twitch popout chat
            '.chat-container',                           // Generic chat container
            '.video-chat',                               // Video chat layout
            '[data-test-selector="chat-scrollable-area__message-container"]'  // Data attribute selector
        ];
        
        let chatContainer = null;
        for (const selector of containerSelectors) {
            chatContainer = document.querySelector(selector);
            if (chatContainer) break;
        }
        
        if (!chatContainer) {
            if (DEBUG) console.log('EloWard: Chat container not found, will retry');
            setTimeout(initChatObserver, 1000);
            return;
        }
        
        // Process existing messages
        const messageSelectors = [
            '.chat-line__message',
            '.chat-line',
            '.message',
            '.chat-message',
            '.chat-line-message',
            '.chat-entry'
        ];
        
        let existingMessages = [];
        for (const selector of messageSelectors) {
            const messages = chatContainer.querySelectorAll(selector);
            if (messages.length > 0) {
                existingMessages = messages;
                break;
            }
        }
        
        // Add badges to existing messages
        existingMessages.forEach(addBadgeToMessage);
        
        // Watch for new messages
        const observer = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            // Check all potential message classes
                            if (node.classList.contains('chat-line__message') || 
                                node.classList.contains('chat-line') ||
                                node.classList.contains('message') ||
                                node.classList.contains('chat-message') ||
                                node.classList.contains('chat-line-message') ||
                                node.classList.contains('chat-entry')) {
                                addBadgeToMessage(node);
                            }
                        }
                    });
                }
            });
        });
        
        observer.observe(chatContainer, { childList: true });
        if (DEBUG) console.log('EloWard: Chat observer initialized');
    }
    
    // Start the plugin
    function initialize() {
        if (DEBUG) {
            console.log('EloWard: Initializing rank badges');
        }
        
        // Initialize observer and start monitoring chat
        initChatObserver();
        
        // Clean up cache periodically
        setInterval(() => {
            if (rankCache.size > 100) {
                const entries = Array.from(rankCache.entries()).slice(-50);
                rankCache.clear();
                entries.forEach(([key, value]) => rankCache.set(key, value));
                if (DEBUG) console.log(`EloWard: Trimmed rank cache to 50 entries`);
            }
        }, 60000); // Clean every minute
    }
    
    // Run the plugin
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})(); 