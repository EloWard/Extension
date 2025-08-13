# Security Policy

## Our Commitment to Transparency

EloWard is open-source specifically to allow users to verify that their account information is handled securely. You can audit our code to ensure we're not doing anything malicious with your Twitch or Riot Games credentials.

## What Data We Handle

### Authentication Data
- **Twitch OAuth tokens** - Stored locally in extension storage (per browser)
- **Riot Games OAuth tokens** - Stored locally in extension storage  
- **Account information** - Usernames, display names, PUIDs (stored locally)

### Rank Data
- **League of Legends rank information** - Fetched from Riot API and cached
- **Linked account data** - Mapping between Twitch usernames and Riot accounts

## How We Protect Your Data

### Local Storage Only
- All sensitive data is stored in your browser’s extension storage
- No passwords or tokens are transmitted to our servers
- OAuth tokens are exchanged via secure Cloudflare Workers that hide client secrets

### Secure Communication
- All API calls use HTTPS
- OAuth flows follow industry best practices
- No credentials are logged or transmitted in plain text

### Minimal Data Collection
- We only request the minimum permissions needed
- Tokens are automatically refreshed when possible
- Data is cleared when you disconnect accounts

## Key Security Files to Audit

### Authentication Modules
- [`js/riotAuth.js`](js/riotAuth.js) - Handles Riot Games OAuth flow
- [`js/twitchAuth.js`](js/twitchAuth.js) - Handles Twitch OAuth flow
- [`js/persistentStorage.js`](js/persistentStorage.js) - Manages local data storage

### Core Extension Logic
- [`background.js`](background.js) - Background processes and API calls
- [`content.js`](content.js) - Chat integration and badge display
- [`manifest.json`](manifest.json) - Extension permissions and configuration

## Security Best Practices We Follow

1. **OAuth 2.0 with PKCE** - Industry standard authentication
2. **Token rotation** - Refresh tokens when possible to limit exposure
3. **Scoped permissions** - Only request necessary API access
4. **Local data storage** - No server-side storage of credentials
5. **HTTPS only** - All network communication is encrypted

## Verifying Chrome Web Store Builds

Once published to the Chrome Web Store, you can verify that version matches this source code:

1. Download the extension from the Chrome Web Store
2. Extract the CRX file and compare with this repository
3. Check that no additional code or permissions have been added
4. Verify the manifest.json permissions match this version

## Reporting Security Issues

If you discover a security vulnerability:

1. **DO NOT** open a public issue
2. Email security concerns to: unleashai.inquiries@gmail.com
3. Include steps to reproduce the issue
4. Allow reasonable time for us to fix before public disclosure

## Security Audit Checklist

When auditing EloWard's security, check:

- OAuth flows use proper state parameters and PKCE
- No hardcoded secrets or API keys
- Tokens are stored securely in Chrome extension storage
- No unnecessary network requests or data transmission
- Proper error handling that doesn't leak sensitive data
- Content Security Policy is properly configured
- Extension permissions are minimal and justified

## Third-Party Dependencies

We aim to minimize external dependencies. Current dependencies are:
- Chrome Extension APIs (built-in)
- Standard web APIs (fetch, crypto, etc.)

## Questions About Security?

- Review our open-source code in this repository
- Check our authentication flow documentation
- Open an issue for general security questions (not vulnerabilities)

**Remember: The entire codebase is available for your review. We encourage security-conscious users to audit our code before using the extension.** 