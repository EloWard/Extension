/**
 * EloWard - Twitch Authentication Callback Handler
 * This script extracts auth parameters from the URL and communicates them back to the extension
 */

document.addEventListener('DOMContentLoaded', () => {
  console.log('Twitch auth callback page loaded');
  
  // Elements
  const loadingElement = document.getElementById('loading');
  const successElement = document.getElementById('success');
  const errorElement = document.getElementById('error');
  const errorDetailsElement = document.getElementById('error-details');
  
  // Extract auth parameters from URL
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  const error = params.get('error');
  const errorDescription = params.get('error_description');
  
  console.log('Auth callback parameters:', { 
    code: code ? 'present' : 'missing', 
    state: state ? 'present' : 'missing',
    error: error || 'none'
  });
  
  // Handle error case
  if (error) {
    console.error('Twitch auth error:', error, errorDescription);
    loadingElement.style.display = 'none';
    errorElement.style.display = 'block';
    errorDetailsElement.textContent = errorDescription || error || 'Authentication was denied or failed';
    return;
  }
  
  // Validate required parameters
  if (!code || !state) {
    console.error('Missing required auth parameters');
    loadingElement.style.display = 'none';
    errorElement.style.display = 'block';
    errorDetailsElement.textContent = 'Missing required authentication parameters';
    return;
  }
  
  // Prepare auth data
  const authData = {
    code,
    state,
    source: 'twitch_auth_callback'
  };
  
  // Store the auth data in chrome.storage.local
  chrome.storage.local.set({
    'twitch_auth_callback': authData,
    'auth_callback': authData // For compatibility
  }, () => {
    console.log('Stored auth callback data in chrome.storage');
    
    // Also try localStorage as a fallback
    try {
      localStorage.setItem('eloward_twitch_auth_callback_data', JSON.stringify(authData));
      console.log('Stored auth callback data in localStorage');
    } catch (err) {
      console.warn('Could not store auth callback data in localStorage:', err);
    }
    
    // Communicate with extension background page
    try {
      chrome.runtime.sendMessage({
        type: 'twitch_auth_callback',
        params: authData
      }, response => {
        console.log('Background page response:', response);
        
        // Show success message
        loadingElement.style.display = 'none';
        successElement.style.display = 'block';
        
        // Close the tab after a short delay
        setTimeout(() => {
          window.close();
        }, 3000);
      });
    } catch (err) {
      console.error('Error sending message to background page:', err);
      
      // Still show success since data is stored in storage
      loadingElement.style.display = 'none';
      successElement.style.display = 'block';
      
      // Close the tab after a longer delay
      setTimeout(() => {
        window.close();
      }, 5000);
    }
  });
}); 