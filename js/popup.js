// EloWard Popup Script
import { RiotAuth } from './riotAuth.js';
import { testRiotAuthFlow } from './test.js';

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const connectButton = document.getElementById('connect-riot');
  const connectionStatus = document.getElementById('riot-connection-status');
  const regionSelect = document.getElementById('region');
  const rankBadgePreview = document.getElementById('rank-badge-preview');
  const currentRank = document.getElementById('current-rank');
  
  // Initialize UI
  initializeUI();
  
  // Event listeners
  connectButton.addEventListener('click', handleConnect);
  regionSelect.addEventListener('change', handleRegionChange);
  
  /**
   * Initialize the UI based on the current state
   */
  function initializeUI() {
    // Check if user is authenticated
    if (RiotAuth.isAuthenticated()) {
      connectionStatus.textContent = 'Connected';
      connectionStatus.classList.add('connected');
      connectButton.textContent = 'Disconnect';
      
      // Get account info
      const accountInfo = RiotAuth.getAccountInfo();
      if (accountInfo) {
        console.log('Account info:', accountInfo);
      }
      
      // Get rank info
      const rankInfo = RiotAuth.getRankInfo();
      if (rankInfo) {
        displayRankInfo(rankInfo);
      } else {
        // Fetch rank info if not available
        chrome.storage.local.get('selectedRegion', (data) => {
          const region = data.selectedRegion || 'na1';
          regionSelect.value = region;
          
          // Fetch summoner info to get rank
          const summonerInfo = RiotAuth.getSummonerInfo();
          if (summonerInfo) {
            RiotAuth.fetchRankInfo(summonerInfo.id)
              .then(rankInfo => {
                displayRankInfo(rankInfo);
              })
              .catch(error => {
                console.error('Error fetching rank info:', error);
                currentRank.textContent = 'Unranked';
              });
          } else {
            currentRank.textContent = 'Unranked';
          }
        });
      }
    } else {
      connectionStatus.textContent = 'Not Connected';
      connectionStatus.classList.remove('connected');
      connectButton.textContent = 'Connect';
      currentRank.textContent = 'Unknown';
      rankBadgePreview.style.backgroundImage = '';
    }
  }
  
  /**
   * Handle connect/disconnect button click
   */
  async function handleConnect() {
    if (RiotAuth.isAuthenticated()) {
      // Disconnect
      RiotAuth.signOut();
      initializeUI();
    } else {
      // Connect
      try {
        // For development, we'll use the test function
        // In production, you would use RiotAuth.initAuth
        const success = await testRiotAuthFlow();
        
        if (success) {
          connectButton.disabled = true;
          connectButton.textContent = 'Authorizing...';
          
          // The callback.html will handle the response and update the UI
        } else {
          console.error('Failed to initiate authentication');
        }
      } catch (error) {
        console.error('Error initiating authentication:', error);
      }
    }
  }
  
  /**
   * Handle region change
   */
  function handleRegionChange() {
    const region = regionSelect.value;
    chrome.storage.local.set({ selectedRegion: region });
    
    // Update rank display if authenticated
    if (RiotAuth.isAuthenticated()) {
      // Re-fetch rank info for the new region
      const summonerInfo = RiotAuth.getSummonerInfo();
      if (summonerInfo) {
        RiotAuth.fetchRankInfo(summonerInfo.id)
          .then(rankInfo => {
            displayRankInfo(rankInfo);
          })
          .catch(error => {
            console.error('Error fetching rank info:', error);
            currentRank.textContent = 'Unranked';
          });
      }
    }
  }
  
  /**
   * Display rank information
   * @param {object} rankInfo - The rank information
   */
  function displayRankInfo(rankInfo) {
    if (!rankInfo) {
      currentRank.textContent = 'Unranked';
      rankBadgePreview.style.backgroundImage = `url(${chrome.runtime.getURL('images/ranks/unranked.png')})`;
      return;
    }
    
    // Format the rank text
    const tier = rankInfo.tier || 'Unranked';
    let rankText = tier;
    
    if (rankInfo.division && tier !== 'MASTER' && tier !== 'GRANDMASTER' && tier !== 'CHALLENGER') {
      rankText += ' ' + rankInfo.division;
    }
    
    if (rankInfo.leaguePoints !== undefined) {
      rankText += ` (${rankInfo.leaguePoints} LP)`;
    }
    
    currentRank.textContent = rankText;
    
    // Set the rank badge
    const tierLower = tier.toLowerCase();
    rankBadgePreview.style.backgroundImage = `url(${chrome.runtime.getURL(`images/ranks/${tierLower}.png`)})`;
  }
}); 