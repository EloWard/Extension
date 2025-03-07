# EloWard: League of Legends Rank Badges for Twitch

<div align="center">
  <img src="images/logo/icon128.png" alt="EloWard Logo" width="80" height="80">
  <h3>Show off your League rank in Twitch chat</h3>
</div>

## Overview

EloWard is a Chrome extension that displays League of Legends rank badges next to usernames in Twitch chat. Now you can immediately see which rank that challenger player in chat actually is!

<div align="center">
  <img src="screenshots/preview.png" alt="EloWard Preview" width="500">
</div>

## Features

- 🎮 **Twitch Integration**: Automatically shows rank badges in any Twitch chat
- 🏆 **Real-time Rank Display**: Shows accurate, up-to-date LoL ranks
- 🌍 **Region Support**: Supports all major LoL regions
- 🔗 **Account Linking**: Easily connect your Twitch and Riot accounts
- 🎨 **Clean Design**: Modern, unobtrusive UI that fits with Twitch's design

## Installation

### From Chrome Web Store (Coming Soon)
1. Visit the Chrome Web Store (link coming soon)
2. Click "Add to Chrome"
3. Confirm the installation

### Manual Installation (Developer Mode)
1. Download this repository
2. Go to `chrome://extensions/` in Chrome
3. Enable "Developer mode" in the top-right corner
4. Click "Load unpacked" and select the downloaded folder
5. The extension should now be installed and visible in your toolbar

## Getting Started

1. Click the EloWard icon in your Chrome toolbar
2. Connect your Twitch account
3. Connect your League of Legends account
4. Select your server region
5. Visit any Twitch channel to see rank badges in chat!

## How It Works

EloWard connects your Twitch username to your Riot ID, then uses the Riot Games API to fetch your current rank information. When you chat on Twitch, other users with the extension installed will see your rank badge next to your name.

When browsing Twitch channels with the extension active, you'll see rank badges next to other chatters who have connected their accounts.

## Privacy

EloWard only accesses:
- Your Twitch username (with your permission)
- Your Riot ID (with your permission)
- Your League of Legends rank data (public information)

We do not store any personal information beyond what's necessary for the extension to function. Your account connection data is stored locally on your device and is not shared with any third parties.

## Development

### Project Structure

```
├── images/               # Extension icons and rank badges
│   └── ranks/            # Rank badge images
├── js/                   # JavaScript files
│   ├── config.js         # Configuration constants
│   └── popup.js          # Popup interface logic
├── css/                  # CSS stylesheets
│   └── popup.css         # Popup styling
├── background.js         # Extension background script
├── content.js            # Content script for Twitch pages
├── manifest.json         # Extension manifest
├── popup.html            # Extension popup interface
└── styles.css            # Twitch chat badge styling
```

### Building From Source

1. Clone the repository
2. Install dependencies (none required for basic functionality)
3. Make your changes
4. Load the extension in developer mode for testing

## Contributing

Contributions are welcome! If you'd like to contribute, please:

1. Fork the repository
2. Create a new branch for your feature
3. Make your changes
4. Submit a pull request

## License

[MIT License](LICENSE)

## Credits

- Rank badge images derived from League of Legends assets
- Built with love for the League and Twitch communities

---

<div align="center">
  <p>Made by EloWard Team © 2023</p>
</div> 