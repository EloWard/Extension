/**
 * EloWard Rank Badges - OBS Plugin
 * 
 * This script is injected into the browser source showing Twitch chat
 * to display rank badges for viewers.
 */

(function() {
    // Constants for API URLs
    const RANK_API_URL = 'https://eloward-viewers-api.unleashai-inquiries.workers.dev/api/ranks/lol';
    const BADGE_CLASS = 'eloward-rank-badge';
    const DEBUG = false;
    
    // Track processed usernames to avoid duplicates
    const processedUsernames = new Set();
    const rankCache = new Map();
    
    // Rank tier colors matching the extension
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
    
    // Add styles for rank badges
    function addRankStyles() {
        if (document.getElementById('eloward-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'eloward-styles';
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
    
    // Get color for rank tier
    function getRankColor(tier) {
        return RANK_COLORS[tier] || '#000000';
    }
    
    // Fetch rank data from API
    async function fetchRank(username) {
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
        badgeElement.textContent = formatRank(rankData);
        badgeElement.style.backgroundColor = getRankColor(rankData.rank_tier);
        
        // Add badge after username
        usernameElement.insertAdjacentElement('afterend', badgeElement);
        
        if (DEBUG) console.log(`Added badge for ${username}: ${formatRank(rankData)}`);
    }
    
    // Initialize chat observer
    function initChatObserver() {
        // Add styles
        addRankStyles();
        
        // Find the chat container based on common Twitch chat layouts
        const containerSelectors = [
            '.chat-scrollable-area__message-container',  // Standard Twitch
            '.chat-list',                                // Alternate Twitch
            '.stream-chat',                              // OBS browser source
            '.live-chat-container'                       // Other common formats
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
            '.chat-message'
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
                                node.classList.contains('chat-message')) {
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
        if (DEBUG) console.log('EloWard: Initializing rank badges');
        
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