/* Copyright 2024 EloWard - Apache 2.0 + Commons Clause License */

/**
 * Extension Bridge - Facilitates communication between EloWard website and extension
 * This script runs on eloward.com pages to enable cross-browser extension messaging
 */

(function() {
  'use strict';
  
  console.log('[EloWard Extension Bridge] Initializing...');
  
  // Make extension available to the website via window object
  if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.id) {
    // Extension is loaded and browser API is available
    console.log('[EloWard Extension Bridge] Extension detected with ID:', browser.runtime.id);
    
    // Expose extension messaging to the website
    window.elowardExtension = {
      id: browser.runtime.id,
      isInstalled: true,
      
      // Send message to the extension background script
      sendMessage: function(message, callback) {
        console.log('[EloWard Extension Bridge] Sending message:', message);
        
        if (typeof callback === 'function') {
          browser.runtime.sendMessage(message)
            .then(response => {
              console.log('[EloWard Extension Bridge] Response received:', response);
              callback(response);
            })
            .catch(error => {
              console.error('[EloWard Extension Bridge] Message failed:', error);
              callback({ success: false, error: error.message });
            });
        } else {
          return browser.runtime.sendMessage(message);
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
    
    console.log('[EloWard Extension Bridge] Bridge established successfully');
    
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
    
    console.log('[EloWard Extension Bridge] Auth redirect detected');
    
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
      
      const authData = {
        type: 'auth_callback',
        service: service,
        params: {
          code: code,
          state: state,
          service: service
        }
      };
      
      // Send auth data to extension
      if (window.elowardExtension && window.elowardExtension.isInstalled) {
        window.elowardExtension.sendMessage(authData, function(response) {
          console.log('[EloWard Extension Bridge] Auth message response:', response);
        });
      } else {
        console.warn('[EloWard Extension Bridge] Extension not available for auth callback');
      }
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
  
})();