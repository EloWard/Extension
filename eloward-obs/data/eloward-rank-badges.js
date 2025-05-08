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
        // Try multiple methods to find the images path
        
        // Method 1: If the OBS plugin has provided a configured path
        if (window.ELOWARD_RESOURCES_PATH) {
            return window.ELOWARD_RESOURCES_PATH;
        }
        
        // Method 2: Try to detect the path based on the script URL
        const scriptElement = document.currentScript;
        if (scriptElement && scriptElement.src) {
            const scriptPath = scriptElement.src;
            // Extract the base path from the script URL
            const basePath = scriptPath.substring(0, scriptPath.lastIndexOf('/') + 1);
            return `${basePath}images/ranks/`;
        }
        
        // Method 3: Check if we're in an OBS browser source
        if (window.obsstudio) {
            // Default OBS data path structure
            return 'file:///Library/Application Support/obs-studio/plugins/eloward-rank-badges/data/images/ranks/';
        }
        
        // Method 4: Fallback to a relative path
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
        console.log('EloWard Resources Path:', RESOURCES_PATH);
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
        
        // Try 36px image first, then 18px as fallback
        const baseUrl = `${RESOURCES_PATH}${normalizedTier}`;
        return `${baseUrl}36.png`;
    }
    
    // Get fallback image URL (18px version)
    function getFallbackImageUrl(tier) {
        if (!tier) return null;
        const normalizedTier = tier.toLowerCase();
        return `${RESOURCES_PATH}${normalizedTier}18.png`;
    }
    
    // Fallback to get color for rank tier
    function getRankColor(tier) {
        return RANK_COLORS[tier] || '#000000';
    }
    
    // Preload rank images
    function preloadRankImages() {
        RANK_TIERS.forEach(tier => {
            const img = new Image();
            img.src = getRankImageUrl(tier);
            
            const fallbackImg = new Image();
            fallbackImg.src = getFallbackImageUrl(tier);
        });
        
        if (DEBUG) console.log('EloWard: Preloaded rank images');
    }
    
    // Create and show tooltip with rank details
    function showTooltip(event, rankData) {
        // Don't show tooltip if there's no rank data
        if (!rankData) return;
        
        // Create tooltip element if it doesn't exist
        let tooltip = document.getElementById('eloward-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'eloward-tooltip';
            tooltip.className = 'eloward-tooltip';
            document.body.appendChild(tooltip);
        }
        
        // Create tooltip content
        const tooltipContent = document.createElement('div');
        tooltipContent.className = 'eloward-tooltip-content';
        
        // Format rank for display
        const formattedRank = formatRank(rankData);
        
        // Create rank header
        const rankHeader = document.createElement('div');
        rankHeader.className = 'eloward-tooltip-rank';
        
        // Try to add rank image
        if (rankData.rank_tier) {
            const rankImg = document.createElement('img');
            rankImg.src = getRankImageUrl(rankData.rank_tier);
            rankImg.onerror = () => {
                rankImg.src = getFallbackImageUrl(rankData.rank_tier);
                rankImg.onerror = () => {
                    rankImg.style.display = 'none';
                    // Add color indicator if image fails
                    rankHeader.style.borderLeft = `4px solid ${getRankColor(rankData.rank_tier)}`;
                    rankHeader.style.paddingLeft = '4px';
                };
            };
            rankHeader.appendChild(rankImg);
        }
        
        // Add text node with rank
        rankHeader.appendChild(document.createTextNode(formattedRank));
        tooltipContent.appendChild(rankHeader);
        
        // Add additional stats if available
        if (rankData.wins !== undefined || rankData.losses !== undefined) {
            const statsDiv = document.createElement('div');
            statsDiv.className = 'eloward-tooltip-stats';
            
            if (rankData.wins !== undefined && rankData.losses !== undefined) {
                const winRate = rankData.wins + rankData.losses > 0 
                    ? Math.round((rankData.wins / (rankData.wins + rankData.losses)) * 100) 
                    : 0;
                    
                statsDiv.textContent = `${rankData.wins}W ${rankData.losses}L (${winRate}% WR)`;
            } else if (rankData.lp !== undefined) {
                statsDiv.textContent = `${rankData.lp} LP`;
            }
            
            tooltipContent.appendChild(statsDiv);
        }
        
        // Set tooltip content
        tooltip.innerHTML = '';
        tooltip.appendChild(tooltipContent);
        
        // Position tooltip
        const rect = event.target.getBoundingClientRect();
        tooltip.style.left = `${rect.left}px`;
        tooltip.style.top = `${rect.top - tooltip.offsetHeight - 5}px`;
        
        // Ensure tooltip is fully visible
        const tooltipRect = tooltip.getBoundingClientRect();
        
        // Check if tooltip is outside viewport horizontally
        if (tooltipRect.right > window.innerWidth) {
            tooltip.style.left = `${window.innerWidth - tooltipRect.width - 5}px`;
        }
        
        // Check if tooltip is outside viewport vertically
        if (tooltipRect.top < 0) {
            tooltip.style.top = `${rect.bottom + 5}px`;
        }
        
        // Show the tooltip
        tooltip.style.display = 'block';
    }
    
    // Hide tooltip
    function hideTooltip() {
        const tooltip = document.getElementById('eloward-tooltip');
        if (tooltip) {
            tooltip.style.display = 'none';
        }
    }
    
    // Fetch rank data for a Twitch username
    async function fetchRank(username) {        
        // Check cache first
        if (rankCache.has(username.toLowerCase())) {
            return rankCache.get(username.toLowerCase());
        }
        
        // Track metrics
        incrementDbReadCounter();
        
        // Fetch from API
        try {
            const response = await fetch(`${CONFIG.apiUrls.rank}?username=${encodeURIComponent(username)}&channel=${encodeURIComponent(CONFIG.streamerName)}`);
            
            if (!response.ok) {
                if (DEBUG) console.error(`Failed to fetch rank: ${response.status}`);
                return null;
            }
            
            const data = await response.json();
            
            // Track successful lookup
            if (data && data.success) {
                incrementSuccessfulLookupCounter();
            }
            
            // Cache the result (even if it's a "not found")
            const rankData = data.success ? data.rank_data : null;
            rankCache.set(username.toLowerCase(), rankData);
            
            return rankData;
        } catch (error) {
            if (DEBUG) console.error('Error fetching rank:', error);
            return null;
        }
    }
    
    // Add rank badge to chat message
    async function addBadgeToMessage(chatLine) {
        // Find username element
        const usernameElements = chatLine.querySelectorAll('.chat-author__display-name, .chat-line__username, .chat-message-username');
        if (!usernameElements || usernameElements.length === 0) return;
        
        // Get the username element and extract username
        const usernameElement = usernameElements[0];
        const username = usernameElement.textContent.trim();
        
        // Check if we've already processed this username in this chat line
        const chatLineId = chatLine.getAttribute('data-message-id') || chatLine.getAttribute('id') || Math.random().toString(36).substring(2);
        const processedKey = `${username.toLowerCase()}-${chatLineId}`;
        
        if (processedUsernames.has(processedKey)) return;
        processedUsernames.add(processedKey);
        
        // Check if a badge is already added
        if (chatLine.querySelector(`.${BADGE_CLASS}`)) return;
        
        // Fetch rank for username
        const rankData = await fetchRank(username);
        
        // If no rank data, do nothing
        if (!rankData || !rankData.rank_tier) return;
        
        // Create badge element
        const badge = document.createElement('span');
        badge.className = BADGE_CLASS;
        
        // Create image element
        const img = document.createElement('img');
        img.alt = formatRank(rankData);
        img.src = getRankImageUrl(rankData.rank_tier);
        img.loading = 'lazy';
        
        // Handle image loading error - fallback to smaller image
        img.onerror = () => {
            img.src = getFallbackImageUrl(rankData.rank_tier);
            
            // If smaller image also fails, use colored text as fallback
            img.onerror = () => {
                img.style.display = 'none';
                badge.style.color = getRankColor(rankData.rank_tier);
                badge.textContent = rankData.rank_tier.charAt(0);
            };
        };
        
        // Add tooltip events
        badge.addEventListener('mouseenter', (event) => {
            showTooltip(event, rankData);
        });
        
        badge.addEventListener('mouseleave', () => {
            hideTooltip();
        });
        
        // Add image to badge
        badge.appendChild(img);
        
        // Add optional text for certain rank tiers
        if (rankData.rank_tier === 'MASTER' || rankData.rank_tier === 'GRANDMASTER' || rankData.rank_tier === 'CHALLENGER') {
            const tierText = document.createElement('span');
            tierText.textContent = rankData.lp + 'LP';
            tierText.style.fontSize = '10px';
            tierText.style.marginLeft = '2px';
            badge.appendChild(tierText);
        }
        
        // Insert badge after username
        const parent = usernameElement.parentNode;
        
        // Determine where to insert the badge
        if (parent.querySelector('.chat-message-punctuation') || parent.querySelector('.punctuation')) {
            // Insert before punctuation
            const punctuation = parent.querySelector('.chat-message-punctuation') || parent.querySelector('.punctuation');
            parent.insertBefore(badge, punctuation);
        } else {
            // Insert after username
            insertAfter(badge, usernameElement);
        }
    }
    
    // Helper function to insert element after another element
    function insertAfter(newNode, referenceNode) {
        referenceNode.parentNode.insertBefore(newNode, referenceNode.nextSibling);
    }
    
    // Initialize chat observer to find and process chat messages
    function initChatObserver() {
        // Add rank styles to head
        addRankStyles();
        
        // Preload rank images
        preloadRankImages();
        
        // Handler to process new chat messages
        const processChatMessages = (chatContainer) => {
            if (!chatContainer) return;
            
            // Find all chat messages
            const selector = [
                '.chat-line__message', // Twitch chat
                '.chat-message', // StreamElements chat
                '.chat-list__message', // Twitch popout chat
                '.chat-line' // Other chat format
            ].join(', ');
            
            const chatLines = chatContainer.querySelectorAll(selector);
            
            // Process each chat line that hasn't been processed yet
            chatLines.forEach(line => {
                if (!line.hasAttribute('data-eloward-processed')) {
                    line.setAttribute('data-eloward-processed', 'true');
                    addBadgeToMessage(line);
                }
            });
        };
        
        // Find potential chat containers
        const findChatContainers = () => {
            const potentialContainers = [
                document.querySelector('.chat-list--default'), // Twitch
                document.querySelector('.chat-list'), // Twitch
                document.querySelector('.chat-scrollable-area__message-container'), // Twitch
                document.querySelector('.chat-messages'), // StreamElements
                document.querySelector('.stream-chat') // General
            ];
            
            return potentialContainers.filter(container => container !== null);
        };
        
        // Start monitoring for chat containers and messages
        const initMonitoring = () => {
            // Process existing chat containers
            const containers = findChatContainers();
            containers.forEach(container => processChatMessages(container));
            
            // Set up mutation observer for the whole document to catch new containers/messages
            const observer = new MutationObserver((mutations) => {
                let shouldProcess = false;
                
                mutations.forEach(mutation => {
                    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                        shouldProcess = true;
                    }
                });
                
                if (shouldProcess) {
                    const containers = findChatContainers();
                    containers.forEach(container => processChatMessages(container));
                }
            });
            
            // Start observing the document
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
            
            if (DEBUG) console.log('EloWard: Chat observer initialized');
            return observer;
        };
        
        // Initialize once DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initMonitoring);
        } else {
            return initMonitoring();
        }
    }
    
    // Initialize the script
    function initialize() {
        if (DEBUG) console.log('EloWard: Initializing...');
        
        // Initialize chat observer
        const observer = initChatObserver();
        
        // Log initialization status
        if (DEBUG) {
            console.log('EloWard: Initialization complete');
            console.log('EloWard Streamer:', CONFIG.streamerName);
            console.log('EloWard Subscription:', CONFIG.isSubscribed);
        }
        
        // Return cleanup function for potential unloading
        return () => {
            if (observer) observer.disconnect();
            const tooltip = document.getElementById('eloward-tooltip');
            if (tooltip) tooltip.remove();
        };
    }
    
    // Start the script
    const cleanup = initialize();
    
    // Add unload handler for proper cleanup
    if (window.obsstudio) {
        window.addEventListener('unload', cleanup);
    }
})(); 