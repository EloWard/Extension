# EloWard Chrome Extension

A Chrome extension that displays League of Legends rank badges in Twitch chat for connected users.

## Features

- **Rank Badges in Chat** - See League of Legends ranks displayed next to usernames in Twitch chat
- **Multiple Chat Extensions Support** - Works with 7TV, FrankerFaceZ, and standard Twitch chat
- **Secure Authentication** - Connect your Twitch and Riot accounts safely
- **Real-time Updates** - Badges appear as users chat, with caching for performance
- **Cross-Region Support** - Works with all League of Legends regions

## Why Open Source?

EloWard is open-source for **transparency and security**. Since we handle sensitive account connections (Twitch + Riot Games), we want users to be able to:

- ✅ Audit our authentication code
- ✅ Verify we're not storing any information maliciously  
- ✅ Contribute improvements and bug fixes
- ✅ Trust that the extension is secure

## Installation

### From Chrome Web Store (Recommended)
1. Visit the [EloWard Website](https://www.eloward.com/) for links, detailed setup instructions, and dashboard/settings

### From Source (For Developers)
1. Clone this repository
2. Open `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the `EloWardApp` folder

## Setup

1. **Connect Twitch Account** - Authenticate with your Twitch account
2. **Connect Riot Account** - Link your League of Legends account
3. **Select Region** - Choose your LoL server region
4. **Start Using** - Rank badges will appear in Twitch chat!

## Licensing & Commercial Use

**License**: Apache 2.0 + Commons Clause

### What You CAN Do:
- ✅ Use the extension for free
- ✅ View and audit the source code
- ✅ Fork the repository for personal use
- ✅ Submit contributions and improvements
- ✅ Redistribute for non-commercial purposes

### What You CANNOT Do:
- ❌ Sell the extension or modified versions
- ❌ Use it in commercial products/services
- ❌ Host it as a paid service (SaaS)
- ❌ Sell hosting or consulting services based primarily on this software

This licensing ensures the extension remains free while protecting against commercial exploitation.

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

**Areas we'd love help with:**
- Performance optimizations for large chats
- Support for additional games
- New badge designs and animations
- Accessibility improvements
- Localization for international users

## Security

Security is our top priority. See [SECURITY.md](SECURITY.md) for:
- What data we handle and how
- Security audit guidelines
- How to report vulnerabilities
- Key files to review for security

## Architecture

```
EloWardApp/
├── background.js          # Background service worker
├── content.js            # Chat integration and badge injection
├── popup.html/js         # Extension popup UI
├── js/
│   ├── riotAuth.js      # Riot Games OAuth handling
│   ├── twitchAuth.js    # Twitch OAuth handling
│   └── persistentStorage.js # Local data management
├── css/                 # Styling for popup and badges
└── manifest.json        # Extension configuration
```

## Privacy

- **No server-side storage** - All data stays in your browser
- **Direct API communication** - Authentication happens directly with Twitch/Riot
- **Minimal permissions** - Only requests necessary Chrome extension permissions
- **Local caching** - Rank data cached locally for performance

## Support

- **Bug Reports** - Open an issue on GitHub
- **Feature Requests** - Start a discussion
- **Security Issues** - Email privately (see SECURITY.md)
- **General Questions** - Check existing issues first

## Development

### Prerequisites
- Chrome or Chromium browser
- Basic knowledge of JavaScript and Chrome Extension APIs

### Local Development
1. Clone the repository
2. Make changes to the code
3. Reload the extension in `chrome://extensions/`
4. Test in Twitch chat

### Testing
- Test with different chat extensions (7TV, FFZ, standard)
- Verify OAuth flows work correctly
- Check badge positioning and styling
- Test region switching and rank updates

## Trademark

"EloWard" is a trademark. Forks must use a different name and branding.

## Credits

Built with ❤️ for the League of Legends and Twitch communities.

## License

Licensed under Apache 2.0 + Commons Clause. See [LICENSE](LICENSE) for details.

---

**Note**: This extension is not affiliated with Riot Games or Twitch. League of Legends is a trademark of Riot Games, Inc. 