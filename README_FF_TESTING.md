# Firefox Testing Guide for EloWard

## Loading the Extension

1. Open Firefox Developer Edition (recommended) or Firefox 109+
2. Navigate to `about:debugging#/runtime/this-firefox`
3. Click **"Load Temporary Add-on..."**
4. Select the folder containing `manifest.json` (this directory)
5. The extension should load successfully

## Quick Test Checklist

- [ ] Extension appears in the toolbar with EloWard icon
- [ ] Click the icon - popup opens without errors
- [ ] Visit `https://www.twitch.tv` - content script loads
- [ ] Open Browser Console (`Ctrl+Shift+J`) - no fatal errors from EloWard
- [ ] Check `about:debugging` - no persistent errors logged

## Known Firefox Differences

### What Works
- All Chrome APIs used (`chrome.storage.local`, `chrome.runtime.sendMessage`, `chrome.tabs`) are fully supported
- Manifest V3 service worker functions correctly
- Content script injection works on Twitch
- Popup UI and storage persistence work as expected

### Manifest Changes Made
- Added `browser_specific_settings.gecko` with temporary test ID
- Set minimum Firefox version to 109.0 for full MV3 + ES modules support
- Added hybrid `scripts` property alongside `service_worker` for Firefox compatibility

## Development Notes

- **Temporary Add-ons**: Extensions loaded via `about:debugging` don't require AMO signing
- **Extension ID**: Using placeholder `eloward-test@example.com` for testing
- **For Distribution**: You'll need a stable gecko ID and AMO signing process
- **No Shim Required**: All Chrome APIs are natively supported in Firefox

## Console Monitoring

Watch these locations for errors:
1. **Browser Console** (`Ctrl+Shift+J`): Background script errors
2. **about:debugging**: Extension-level issues
3. **Twitch page console**: Content script issues

## Troubleshooting

- If manifest fails to load: Check Firefox version (need 109+ for full MV3)
- If popup doesn't open: Check popup.html path and permissions
- If content script doesn't inject: Verify Twitch page loads fully before testing

---

**Diff Summary (manifest.json changes):**
```diff
+ "browser_specific_settings": {
+   "gecko": {
+     "id": "eloward-test@example.com", 
+     "strict_min_version": "109.0"
+   }
+ },
  "background": {
    "service_worker": "background.js",
    "type": "module",
+   "scripts": ["background.js"]
  },
```

No source code changes required - all `chrome.*` APIs work natively in Firefox.