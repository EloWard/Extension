// Test file to verify connection with the Riot RSO worker

document.addEventListener('DOMContentLoaded', async () => {
  // Add a test button to the extension popup
  const testButton = document.createElement('button');
  testButton.textContent = 'Test Worker Connection';
  testButton.className = 'btn test-btn';
  document.querySelector('footer').before(testButton);
  
  // Add event listener to test button
  testButton.addEventListener('click', async () => {
    try {
      // Test connection to the worker
      const response = await fetch('https://eloward-riotrso.unleashai-inquiries.workers.dev/health');
      const data = await response.json();
      
      // Show result
      if (data.status === 'ok') {
        alert('Connection successful! Worker is online.');
      } else {
        alert('Connection successful, but worker returned unexpected response.');
        console.log('Worker response:', data);
      }
    } catch (error) {
      alert(`Connection failed: ${error.message}`);
      console.error('Worker connection error:', error);
    }
  });
});

// Function to test the Riot RSO auth flow
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