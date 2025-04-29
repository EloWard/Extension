/**
 * EloWard Rank Badges - JavaScript Injector
 * 
 * This script is used to inject badge display functionality into a browser source
 * showing Twitch chat. This is only necessary if the C plugin cannot directly 
 * access the browser source content.
 */

(function() {
    // Constants
    const RANK_API_URL = 'https://eloward-viewers-api.unleashai-inquiries.workers.dev/api/ranks/lol';
    const BADGE_UPDATE_INTERVAL = 5000; // 5 seconds
    const BADGE_CLASS = 'eloward-rank-badge';
    const DEBUG = false;
    
    // Rank tier colors
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
    
    // Track processed messages to avoid duplicates
    const processedUsernames = new Set();
    const rankCache = new Map();
    
    // Add custom CSS for badges
    function addBadgeStyles() {
        const styleId = 'eloward-rank-badge-styles';
        if (document.getElementById(styleId)) return;
        
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            .${BADGE_CLASS} {
                display: inline-block;
                margin-left: 5px;
                padding: 1px 4px;
                border-radius: 3px;
                font-size: 11px;
                font-weight: bold;
                color: white;
                vertical-align: middle;
            }
        `;
        document.head.appendChild(style);
    }
    
    // Format the rank display (e.g., "DIAMOND III")
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
    
    // Get color for a rank tier
    function getRankColor(tier) {
        return RANK_COLORS[tier] || '#000000';
    }
    
    // Fetch rank data from the API
    async function fetchRankData(username) {
        try {
            // Check cache first
            if (rankCache.has(username)) {
                return rankCache.get(username);
            }
            
            const response = await fetch(`${RANK_API_URL}/${username}`);
            
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
            rankCache.set(username, data);
            return data;
        } catch (err) {
            if (DEBUG) console.error(`Error fetching rank for ${username}:`, err);
            return null;
        }
    }
    
    // Add a rank badge to a chat message
    async function addRankBadge(chatLine) {
        // Find the username element
        const usernameElement = chatLine.querySelector('.chat-author__display-name, .chat-line__username');
        if (!usernameElement) return;
        
        const username = usernameElement.textContent.trim().toLowerCase();
        
        // Skip if we've already processed this username in this session
        if (processedUsernames.has(username)) return;
        processedUsernames.add(username);
        
        // Fetch rank data
        const rankData = await fetchRankData(username);
        if (!rankData) return;
        
        // Create badge element
        const badgeElement = document.createElement('span');
        badgeElement.className = BADGE_CLASS;
        badgeElement.textContent = formatRank(rankData);
        badgeElement.style.backgroundColor = getRankColor(rankData.rank_tier);
        
        // Add the badge after the username
        usernameElement.parentNode.insertBefore(badgeElement, usernameElement.nextSibling);
        
        if (DEBUG) console.log(`Added badge for ${username}: ${formatRank(rankData)}`);
    }
    
    // Initialize the observer to watch for new chat messages
    function initChatObserver() {
        // Add badge styles
        addBadgeStyles();
        
        // Find the chat container
        const chatContainer = document.querySelector('.chat-scrollable-area__message-container, .chat-list');
        if (!chatContainer) {
            if (DEBUG) console.log('Chat container not found, will retry');
            setTimeout(initChatObserver, 1000);
            return;
        }
        
        // Process existing messages
        const existingMessages = chatContainer.querySelectorAll('.chat-line__message, .chat-line');
        existingMessages.forEach(addRankBadge);
        
        // Watch for new messages
        const observer = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE &&
                            (node.classList.contains('chat-line__message') || 
                             node.classList.contains('chat-line'))) {
                            addRankBadge(node);
                        }
                    });
                }
            });
        });
        
        observer.observe(chatContainer, { childList: true });
        if (DEBUG) console.log('EloWard rank badge observer initialized');
    }
    
    // Start the script
    function initialize() {
        if (DEBUG) console.log('Initializing EloWard rank badges script');
        initChatObserver();
        
        // Periodically clean up cache to avoid memory issues
        setInterval(() => {
            if (rankCache.size > 100) {
                // Keep only the 50 most recent entries
                const entries = Array.from(rankCache.entries());
                const toKeep = entries.slice(-50);
                rankCache.clear();
                toKeep.forEach(([key, value]) => rankCache.set(key, value));
            }
        }, 60000); // Clean every minute
    }
    
    // Start the plugin when the page is loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})(); 