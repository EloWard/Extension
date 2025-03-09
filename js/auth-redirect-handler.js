/**
 * EloWard Authentication Redirect Handler
 * 
 * This content script runs on https://eloward.vercel.app/ to capture 
 * authentication responses from Riot Games and pass them back to the extension.
 */

(function() {
  console.log('EloWard Auth Redirect Handler loaded');
  
  // Function to process URL parameters
  function processAuthResponse() {
    try {
      const url = new URL(window.location.href);
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      const error_description = url.searchParams.get('error_description');
      
      console.log('Processing authentication response:', { 
        hasCode: !!code, 
        hasState: !!state,
        hasError: !!error
      });
      
      if (code && state) {
        // Save authentication result to extension storage
        chrome.storage.local.set({
          'eloward_auth_callback_result': {
            code,
            state,
            timestamp: Date.now()
          }
        }, () => {
          console.log('Saved authentication code to extension storage');
          
          // Display success message on the page
          document.body.innerHTML = `
            <div style="text-align: center; padding: 50px; font-family: sans-serif;">
              <h1 style="color: #4CAF50;">Authentication Successful!</h1>
              <p>You have successfully authenticated with Riot Games.</p>
              <p>You may close this window and return to the EloWard extension.</p>
            </div>
          `;
        });
      } else if (error) {
        // Save error to extension storage
        chrome.storage.local.set({
          'eloward_auth_callback_result': {
            error,
            error_description,
            state,
            timestamp: Date.now()
          }
        }, () => {
          console.log('Saved authentication error to extension storage');
          
          // Display error message on the page
          document.body.innerHTML = `
            <div style="text-align: center; padding: 50px; font-family: sans-serif;">
              <h1 style="color: #F44336;">Authentication Failed</h1>
              <p>Error: ${error}</p>
              <p>${error_description || ''}</p>
              <p>Please close this window and try again.</p>
            </div>
          `;
        });
      }
    } catch (error) {
      console.error('Error processing authentication response:', error);
    }
  }
  
  // Process the authentication response as soon as the page loads
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    processAuthResponse();
  } else {
    document.addEventListener('DOMContentLoaded', processAuthResponse);
  }
})(); 