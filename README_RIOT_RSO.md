# EloWard Riot RSO Integration

This document provides information about the Riot RSO (Riot Sign On) authentication in the EloWard extension.

## Overview

EloWard uses Riot RSO to authenticate users with their Riot Games accounts. This allows the extension to:

1. Verify that users own the League of Legends accounts they claim to have
2. Access their rank information directly from Riot's API
3. Display accurate rank badges in Twitch chat

## How It Works

### Authentication Flow

1. User clicks "Connect" in the extension popup
2. The extension requests an authorization URL from the EloWard backend
3. The backend generates the URL with the securely stored Riot client credentials
4. The extension initiates the Riot RSO flow using `chrome.identity.launchWebAuthFlow()`
5. User is redirected to the Riot login page
6. After successful login, Riot redirects back to the extension with an authorization code
7. The extension sends the code to the EloWard backend
8. The backend exchanges the code for an access token using the secure client credentials
9. The backend returns the token to the extension
10. The extension uses the token to fetch the user's account and summoner information via the backend
11. The user's rank is fetched and displayed in the popup

### Security Benefits

This approach offers several security benefits:

1. **Protected Client Credentials**: The Riot client ID and secret are never exposed in the extension code
2. **Centralized Management**: Client credentials can be updated on the server without updating the extension
3. **Enhanced Security**: The backend can implement additional security measures
4. **Rate Limit Management**: The backend can manage API rate limits more effectively

### Token Management

- Access tokens are stored securely in the extension's local storage
- Tokens are automatically refreshed when they expire via the backend
- Users can disconnect their accounts at any time

## API Usage

The extension uses the following Riot APIs through the backend proxy:

1. **Account V1 API**
   - `/accounts/me` - Get the authenticated user's account information

2. **Summoner V4 API**
   - `/summoners/me` - Get the authenticated user's summoner information

3. **League V4 API**
   - `/entries/by-summoner/{encryptedSummonerId}` - Get the user's rank information

## Backend Implementation

The EloWard backend implements several endpoints to support the Riot RSO flow:

1. **Authentication Initialization**
   - Endpoint: `/auth/riot/init`
   - Purpose: Generate the authorization URL with secure client credentials

2. **Token Exchange**
   - Endpoint: `/auth/riot/token`
   - Purpose: Exchange the authorization code for an access token

3. **Token Refresh**
   - Endpoint: `/auth/riot/token/refresh`
   - Purpose: Refresh an expired access token

4. **API Proxies**
   - Endpoints: `/riot/account/me`, `/riot/summoner/me`, `/riot/league/entries`
   - Purpose: Proxy requests to the Riot API with proper authentication

## Troubleshooting

### Common Issues

1. **Authentication fails**
   - Check your internet connection
   - Try again later (Riot servers might be experiencing issues)
   - Clear your browser cache and try again

2. **"No authentication data available" error**
   - The user may need to reconnect their account

3. **Rate limit exceeded**
   - The extension implements caching to minimize API calls, but if you're testing frequently, you might hit rate limits
   - Wait a few minutes and try again

### Debugging

- Check the browser console for error messages
- The extension logs authentication events and errors to help with debugging
- You can inspect the stored authentication data in the extension's local storage for troubleshooting

## Resources

- [Riot Games API Documentation](https://developer.riotgames.com/docs/portal)
- [Chrome Identity API Documentation](https://developer.chrome.com/docs/extensions/reference/identity/)
- [OAuth 2.0 Authorization Code Flow](https://oauth.net/2/grant-types/authorization-code/) 