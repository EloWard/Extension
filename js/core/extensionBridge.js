/* Copyright 2024 EloWard - Apache 2.0 + Commons Clause License */

/**
 * Extension Bridge - Facilitates communication between EloWard website and extension
 * This script runs on eloward.com pages to enable cross-browser extension messaging
 */

(function() {
  'use strict';
  
  // Reduce noisy logs in production
  
  // Make extension available to the website via window object
  if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.id) {
    // Extension is loaded and browser API is available
    
    
    // Expose extension messaging to the website
    window.elowardExtension = {
      id: browser.runtime.id,
      isInstalled: true,
      
      // Send message to the extension background script
      sendMessage: function(message, callback) {
        
        
        if (typeof callback === 'function') {
          
          browser.runtime.sendMessage(message)
            .then(response => {
                
              callback(response);
            })
            .catch(error => {
               
              callback({ success: false, error: error.message });
            });
        } else {
          return browser.runtime.sendMessage(message)
           .catch(() => {});
        }
      },
      
      // Listen for messages from the website
      onMessage: function(listener) {
        browser.runtime.onMessage.addListener(listener);
      }
    };
    
    // Also expose for backward compatibility
    window.chromeExtension = window.elowardExtension;
    
    // Notify the website that extension is ready
    window.dispatchEvent(new CustomEvent('elowardExtensionReady', {
      detail: {
        extensionId: browser.runtime.id,
        version: browser.runtime.getManifest().version
      }
    }));
    
    
    
  } else {
    console.log('[EloWard Extension Bridge] Extension not detected or browser API unavailable');
    
    // Extension not available - provide fallback
    window.elowardExtension = {
      isInstalled: false,
      sendMessage: function(message, callback) {
        console.warn('[EloWard Extension Bridge] Extension not available, message not sent:', message);
        if (typeof callback === 'function') {
          callback({ success: false, error: 'Extension not available' });
        }
        return Promise.reject(new Error('Extension not available'));
      }
    };
    
    // Also expose for backward compatibility
    window.chromeExtension = window.elowardExtension;
  }
  
  // Handle auth redirects specifically
  if (window.location.pathname.includes('/auth/redirect') || 
      window.location.pathname.includes('/riot/auth/redirect') ||
      window.location.pathname.includes('/twitch/auth/redirect')) {
    
    
    
    // Check if popup auth is handling this to avoid duplicates
    if (typeof browser !== 'undefined' && browser.storage) {
      browser.storage.local.get('eloward_popup_auth_active').then(data => {
        if (data.eloward_popup_auth_active) {
           
          // Store callback data for AuthCallbackWatcher but don't send message to background
          storeCallbackDataOnly();
          return;
        }
        
        // Process the auth redirect normally (store data AND send message)
        processAuthRedirect();
      });
    } else {
      // Fallback if browser API not available
      processAuthRedirect();
    }
    
    function storeCallbackDataOnly() {
      // Extract auth parameters from URL
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      const state = urlParams.get('state');
      const error = urlParams.get('error');
      
      if (code && state) {
         
        
        // Store callback data in the keys that AuthCallbackWatcher expects
        if (typeof browser !== 'undefined' && browser.storage) {
          const service = window.location.pathname.includes('/twitch/') ? 'twitch' : 'riot';
          const payload = {
            'auth_callback': { code, state, service },
            'eloward_auth_callback': { code, state }
          };
          if (service === 'twitch') {
            payload['twitch_auth_callback'] = { code, state, service };
          }
          browser.storage.local.set(payload);
        }

        // Also proactively notify the background to process immediately as a fallback
        try {
          if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.sendMessage) {
            // Determine service from path
            let service = 'riot';
            if (window.location.pathname.includes('/twitch/')) service = 'twitch';
            browser.runtime.sendMessage({
              type: 'auth_callback',
              service,
              params: { code, state, service }
            }).catch(() => {});
          }
        } catch (_) {}
      } else if (error) {
        console.error('[EloWard Extension Bridge] Auth error (popup mode):', error);
      }
    }
    
    function processAuthRedirect() {
      console.log('[EloWard Extension Bridge] Processing auth redirect...');
      
      // Extract auth parameters from URL
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      const state = urlParams.get('state');
      const error = urlParams.get('error');
      
      if (code && state) {
        console.log('[EloWard Extension Bridge] Auth parameters found, sending to extension');
        
        // Determine service from URL path
        let service = 'riot'; // default
        if (window.location.pathname.includes('/twitch/')) {
          service = 'twitch';
        }
        
        // Always store callback data as a robust fallback so the extension can poll it
        try {
          if (typeof browser !== 'undefined' && browser.storage) {
            const callbackData = { code, state, service, timestamp: Date.now() };
            // Write to multiple keys so either popup or background can pick it up reliably
            const payload = { 'auth_callback': callbackData, 'eloward_auth_callback': { code, state } };
            if (service === 'twitch') {
              payload['twitch_auth_callback'] = callbackData;
            }
            browser.storage.local.set(payload);
          }
        } catch (e) {
          // Non-fatal
        }
        
        const authData = {
          type: 'auth_callback',
          service: service,
          params: {
            code: code,
            state: state,
            service: service
          }
        };
        
        // Send auth data to extension (always) — Firefox may ignore opener postMessage
        try {
          if (window.elowardExtension && window.elowardExtension.isInstalled) {
            window.elowardExtension.sendMessage(authData, function(response) {
              console.log('[EloWard Extension Bridge] Auth message response:', response);
            });
          } else if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.sendMessage) {
            browser.runtime.sendMessage(authData).catch(() => {});
          }
        } catch (_) {}
      } else if (error) {
        console.error('[EloWard Extension Bridge] Auth error:', error);
        
        // Send error to extension
        if (window.elowardExtension && window.elowardExtension.isInstalled) {
          window.elowardExtension.sendMessage({
            type: 'auth_error',
            error: error
          });
        }
      }
    }
  }
  
})();