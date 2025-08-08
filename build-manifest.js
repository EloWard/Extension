#!/usr/bin/env node

/**
 * Build script to generate browser-specific manifests
 * Usage: node build-manifest.js [chrome|firefox]
 */

const fs = require('fs');
const path = require('path');

// Base manifest configuration
const baseManifest = {
  name: "EloWard",
  version: "1.1.9",
  description: "Injects real-time League of Legends rank badges into Twitch chat so you can seamlessly display your rank on any channel",
  icons: {
    "16": "images/logo/icon16.png",
    "48": "images/logo/icon48.png",
    "128": "images/logo/icon128.png"
  },
  content_scripts: [
    {
      matches: ["*://*.twitch.tv/*"],
      js: ["browser-polyfill.js", "content.js"],
      css: ["styles.css"]
    },
    {
      matches: ["https://www.eloward.com/*"],
      js: ["browser-polyfill.js", "js/extensionBridge.js"],
      run_at: "document_start"
    }
  ],
  web_accessible_resources: [
    {
      resources: ["images/logo/*.png"],
      matches: ["<all_urls>"]
    }
  ],
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'; img-src 'self' data: https://eloward-cdn.unleashai.workers.dev"
  }
};

function generateChromeManifest() {
  return {
    manifest_version: 3,
    ...baseManifest,
    action: {
      default_popup: "popup.html",
      default_icon: {
        "16": "images/logo/icon16.png",
        "48": "images/logo/icon48.png",
        "128": "images/logo/icon128.png"
      }
    },
    permissions: ["storage", "tabs"],
    host_permissions: [
      "https://www.twitch.tv/*",
      "https://*.unleashai.workers.dev/*",
      "https://www.eloward.com/*"
    ],
    background: {
      service_worker: "background.js",
      type: "module"
    }
  };
}

function generateFirefoxManifest() {
  const manifest = {
    manifest_version: 2,
    ...baseManifest,
    browser_action: {
      default_popup: "popup.html",
      default_icon: {
        "16": "images/logo/icon16.png",
        "48": "images/logo/icon48.png",
        "128": "images/logo/icon128.png"
      }
    },
    permissions: [
      "storage",
      "tabs",
      "https://www.twitch.tv/*",
      "https://*.unleashai.workers.dev/*",
      "https://www.eloward.com/*"
    ],
    background: {
      page: "background.html"
    },
    applications: {
      gecko: {
        id: "eloward@unleashai.workers.dev"
      }
    }
  };

  // Convert MV3 web_accessible_resources format to MV2
  manifest.web_accessible_resources = ["images/logo/*.png"];
  
  // Convert MV3 CSP format to MV2
  manifest.content_security_policy = "script-src 'self'; object-src 'self'; img-src 'self' data: https://eloward-cdn.unleashai.workers.dev";
  
  // Remove externally_connectable for Firefox (not needed with content script approach)
  delete manifest.externally_connectable;

  return manifest;
}

function main() {
  const target = process.argv[2] || 'chrome';
  
  let manifest;
  let filename;
  
  switch (target.toLowerCase()) {
    case 'chrome':
      manifest = generateChromeManifest();
      filename = 'manifest.json';
      console.log('🔧 Building Chrome manifest...');
      break;
    case 'firefox':
      manifest = generateFirefoxManifest();
      filename = 'manifest.json';
      console.log('🦊 Building Firefox manifest...');
      break;
    default:
      console.error('❌ Invalid target. Use "chrome" or "firefox"');
      process.exit(1);
  }
  
  // Write the manifest
  const manifestPath = path.join(__dirname, filename);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  
  console.log(`✅ Generated ${filename} for ${target}`);
  
  // Also create a backup of the specific version
  const backupPath = path.join(__dirname, `manifest-${target}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(manifest, null, 2));
  
  console.log(`💾 Backup saved as manifest-${target}.json`);
}

if (require.main === module) {
  main();
}

module.exports = { generateChromeManifest, generateFirefoxManifest };