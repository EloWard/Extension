# EloWard: League of Legends Rank Badges for Twitch Chat

EloWard is a Chrome extension that displays League of Legends rank badges next to usernames in Twitch chat, allowing viewers to showcase their in-game achievements while watching streams.

## Features

- **Rank Badge Display**: Shows League of Legends rank badges (Iron through Challenger) next to usernames in Twitch chat
- **Streamer-Activated**: Badges only appear in chats of streamers who have subscribed to the service
- **Account Linking**: Connects viewers' Twitch accounts with their League of Legends accounts
- **Real-Time Rank Updates**: Badges reflect current League of Legends ranks, updated regularly

## Current MVP Status

This is a Minimum Viable Product (MVP) implementation that includes:

- Basic Chrome extension structure
- UI for account linking
- Mock authentication flow (no real authentication yet)
- Mock rank data generation
- Badge display system for Twitch chat
- Active channel detection

## Development Setup

1. Clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension folder
5. The extension should now be installed and active

## Usage

1. Click the EloWard extension icon in Chrome
2. Connect your Twitch and League of Legends accounts (simulated in MVP)
3. Visit one of the active Twitch channels (currently hardcoded for testing)
4. You should see rank badges next to usernames in chat

## Active Channels for Testing

The MVP is configured to work on the following Twitch channels:
- riotgames
- lcs
- faker
- doublelift
- tyler1

## Project Structure

```
├── manifest.json         # Chrome extension manifest
├── popup.html            # Extension popup HTML
├── background.js         # Background service worker
├── content.js            # Content script for Twitch pages
├── styles.css            # Styles for badges in Twitch chat
├── css/
│   └── popup.css         # Styles for the extension popup
├── js/
│   └── popup.js          # JavaScript for the extension popup
└── images/
    ├── icon16.png        # Extension icon (16x16)
    ├── icon48.png        # Extension icon (48x48)
    ├── icon128.png       # Extension icon (128x128)
    └── ranks/            # Rank badge images
        ├── iron.png
        ├── bronze.png
        ├── silver.png
        ├── gold.png
        ├── platinum.png
        ├── emerald.png
        ├── diamond.png
        ├── master.png
        ├── grandmaster.png
        └── challenger.png
```

## Next Steps

- Implement real authentication with Riot RSO and Twitch OAuth
- Create backend service for storing user data and managing subscriptions
- Add real rank data fetching from Riot API
- Implement subscription system for streamers
- Create streamer dashboard for subscription management
- Add more customization options

## License

This project is licensed under the MIT License - see the LICENSE file for details. 