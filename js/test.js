// Test file for Riot RSO authentication flow

/**
 * Test the Riot RSO auth flow
 * @returns {Promise<boolean>} - Whether the flow was initiated successfully
 */
export async function testRiotAuthFlow() {
  try {
    // Get the extension ID for the redirect URI
    const extensionId = chrome.runtime.id;
    const redirectUri = `chrome-extension://${extensionId}/callback.html`;
    
    // Generate a random state for security
    const state = Math.random().toString(36).substring(2, 15);
    localStorage.setItem('eloward_auth_state', state);
    
    // Request authorization URL from the worker
    const initResponse = await fetch('https://eloward-riotrso.unleashai-inquiries.workers.dev/auth/riot/init', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        region: 'americas',
        state,
        redirectUri
      })
    });
    
    if (!initResponse.ok) {
      throw new Error(`Failed to initialize authentication: ${initResponse.status}`);
    }
    
    const initData = await initResponse.json();
    
    // Open the authorization URL in a new tab
    console.log('Opening auth URL:', initData.authUrl);
    chrome.tabs.create({ url: initData.authUrl });
    
    return true;
  } catch (error) {
    console.error('Error testing Riot auth flow:', error);
    return false;
  }
} 