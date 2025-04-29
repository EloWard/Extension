# EloWard Rank Badges for OBS

An OBS Studio plugin that displays League of Legends rank badges next to usernames in Twitch chat for streamers.

## Overview

This OBS plugin integrates with the EloWard service to display rank badges for viewers in Twitch chat:

1. Checks if the streamer is subscribed to EloWard
2. If subscribed, displays rank badges next to viewer usernames in the OBS chat window
3. If not subscribed, performs no operations for maximum efficiency

## Easy Installation

**Important:** Close OBS Studio completely before running the installer.

### Windows Users
1. Right-click on `install_windows.bat` and select "Run as administrator"
2. Follow the on-screen instructions

### Mac Users
1. Open **Terminal** (you can find it in Applications > Utilities, or search using Spotlight).
2. Type the command `bash ` into the Terminal window (make sure to include the space after `bash`). **Do not press Enter yet.**
3. Drag the `install_mac.sh` file from your download location onto the Terminal window. The path to the file will appear after `bash `.
4. Press **Enter** in the Terminal window.
5. Follow any instructions shown in the Terminal.

The installer will automatically:
- Find your OBS installation (in your user Library folder)
- Install all required plugin files
- Provide usage instructions

## Usage

1. After installing, restart OBS Studio
2. Add the "EloWard Rank Badges" source to any scene that contains your Twitch chat browser source.
3. Make sure your Twitch chat Browser Source has a name containing "chat", "Chat", "twitch", or "Twitch" (case-insensitive) so the plugin can find it.
4. Enter your Twitch username in the plugin properties if it's not automatically detected.

## Troubleshooting

- **Badges not appearing?**
  - Ensure OBS was fully closed during installation.
  - Restart OBS after installation.
  - Double-check that the "EloWard Rank Badges" source is added to the *same scene* as your chat browser source.
  - Verify your chat browser source name includes "chat" or "twitch".
  - Verify your streamer name is correctly set in the plugin properties.
  - Confirm that your EloWard subscription is active.

- **Can't find the plugin in OBS?**
  - Make sure OBS was completely closed when running the installer.
  - Try running the installer script again.
  - Restart OBS after installation.

- **Need more help?**
  - Visit [eloward.com/feedback](https://eloward.com/feedback) or email unleashai.inquiries@gmail.com