# EloWard Extension - Cross-Browser Build Guide

This extension now supports both Chrome and Firefox with automatic manifest generation.

## Quick Start

### For Chrome/Chromium browsers:
```bash
node build-manifest.js chrome
```

### For Firefox:
```bash
node build-manifest.js firefox
```

## What's Included

- ✅ **webextension-polyfill**: Cross-browser API compatibility
- ✅ **Automatic manifest generation**: Chrome (MV3) and Firefox (MV2)
- ✅ **All chrome.* APIs converted to browser.* APIs**
- ✅ **Cross-browser external messaging**

## File Structure

- `manifest.json` - Active manifest (generated)
- `manifest-chrome.json` - Chrome-specific backup
- `manifest-firefox.json` - Firefox-specific backup  
- `browser-polyfill.js` - webextension-polyfill for cross-browser compatibility
- `build-manifest.js` - Build script for generating manifests

## Browser Differences Handled

### Chrome (Manifest V3)
- Uses `service_worker` for background script
- `action` instead of `browser_action`
- Separate `host_permissions` array
- Structured `web_accessible_resources`

### Firefox (Manifest V2)
- Uses `scripts` array for background script
- `browser_action` instead of `action`
- Combined `permissions` array
- Simple `web_accessible_resources` array
- Includes `applications.gecko.id` for Firefox AMO

## Development

The extension now uses `browser.*` APIs throughout for cross-browser compatibility. The webextension-polyfill automatically handles the differences between Chrome's callback-based APIs and Firefox's promise-based APIs.

## Testing

1. Build the appropriate manifest for your target browser
2. Load the extension in developer mode
3. Test authentication and core functionality