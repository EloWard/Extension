# EloWard Rank Badges for OBS

An OBS Studio plugin that displays League of Legends rank badges next to usernames in Twitch chat for streamers.

## Overview

This OBS plugin integrates with the EloWard service to display rank badges for viewers in Twitch chat:

1. Checks if the streamer is subscribed to EloWard
2. If subscribed, displays rank badges next to viewer usernames in the OBS chat window
3. If not subscribed, performs no operations for maximum efficiency

## Easy Installation

### Windows Users
1. Close OBS Studio if it's running
2. Right-click on `install_windows.bat` and select "Run as administrator"
3. Follow the on-screen instructions

### Mac Users
1. Close OBS Studio if it's running
2. Open Terminal (from Applications > Utilities)
3. Drag the `install_mac.sh` file into the Terminal window
4. Press Enter
5. If prompted, enter your password

The installer will automatically:
- Find your OBS installation
- Install all required files
- Provide usage instructions

## Usage

1. After installing, restart OBS Studio
2. Add the "EloWard Rank Badges" source to any scene with Twitch chat
3. Make sure your Twitch chat Browser Source has "chat", "Chat", "twitch", or "Twitch" in its name
4. Enter your Twitch username in the plugin properties if it's not automatically detected

## Troubleshooting

- **Badges not appearing?**
  - Make sure your Twitch chat browser source has "chat", "Chat", "twitch", or "Twitch" in its name
  - Verify your streamer name is correctly set in the plugin properties
  - Confirm that your EloWard subscription is active

- **Can't find the plugin in OBS?**
  - Make sure OBS is completely closed when running the installer
  - Try running the installer script again with administrator privileges
  - Restart OBS after installation

- **Need more help?**
  - Visit [eloward.com/support](https://eloward.com/support)

## Technical Details

For more technical information, see the [project GitHub page](https://github.com/yourusername/eloward-rank-badges). 