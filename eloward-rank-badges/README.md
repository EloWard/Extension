# EloWard Rank Badges for OBS

An OBS Studio plugin that displays League of Legends rank badges next to usernames in Twitch chat for streamers.

## Overview

This OBS plugin integrates with the EloWard service to display rank badges for viewers in Twitch chat. It follows the same workflow as the EloWard browser extension, but operates directly within OBS:

1. Checks if the streamer is subscribed to EloWard
2. If subscribed, displays rank badges next to viewer usernames in the OBS chat window
3. If not subscribed, performs no operations for maximum efficiency

## Features

- Automatically checks streamer subscription status
- Displays League of Legends rank badges next to viewer usernames
- Shows tooltips with detailed rank information on hover
- No caching of rank data on disk (all in-memory)
- Simple integration with existing OBS Twitch chat window
- Multiple methods to detect the streamer name
- Zero resource consumption when not subscribed

## Easy Installation (Recommended)

### Windows Users
1. Download the [`install_windows.bat`](https://github.com/yourusername/eloward-rank-badges/releases/latest/download/install_windows.bat) file
2. Right-click the downloaded file and select "Run as administrator"
3. Follow the on-screen instructions

### Mac Users
1. Download the [`install_mac.sh`](https://github.com/yourusername/eloward-rank-badges/releases/latest/download/install_mac.sh) file
2. Open Terminal (from Applications > Utilities)
3. Drag the downloaded file into the Terminal window and press Enter
4. If prompted, enter your password
5. Follow the on-screen instructions

That's it! The installer will automatically:
- Find your OBS installation
- Download the latest plugin version
- Install all required files
- Provide clear usage instructions

## Manual Installation

If you prefer to install manually, follow these steps:

### Windows
1. Download the [latest release ZIP](https://github.com/yourusername/eloward-rank-badges/releases/latest/download/eloward-rank-badges-windows.zip)
2. Extract the ZIP file
3. Copy the contents of the extracted `obs-plugins` folder to `C:\Program Files\obs-studio\obs-plugins\`
4. Copy the contents of the extracted `data` folder to `C:\Program Files\obs-studio\data\obs-plugins\eloward-rank-badges\`

### Mac
1. Download the [latest release ZIP](https://github.com/yourusername/eloward-rank-badges/releases/latest/download/eloward-rank-badges-mac.zip)
2. Extract the ZIP file
3. Copy the `eloward-rank-badges` folder to `~/Library/Application Support/obs-studio/plugins/`

### Linux
1. Download the [latest release ZIP](https://github.com/yourusername/eloward-rank-badges/releases/latest/download/eloward-rank-badges-linux.zip)
2. Extract the ZIP file
3. Copy the `eloward-rank-badges` folder to `~/.config/obs-studio/plugins/`

## Usage

1. After installing, restart OBS Studio
2. Add the "EloWard Rank Badges" source to any scene where you're displaying Twitch chat
3. Make sure you have a Browser Source showing your Twitch chat in the same scene (the name should contain "chat", "Chat", "twitch", or "Twitch")
4. Enter your Twitch username in the plugin properties if it's not automatically detected

The plugin will automatically:
- Check if you're subscribed to EloWard
- If subscribed, display rank badges next to usernames in chat
- If not subscribed, remain dormant with zero resource impact

## Troubleshooting

- **Badges not appearing?**
  - Make sure your Twitch chat browser source has "chat", "Chat", "twitch", or "Twitch" in its name
  - Verify your streamer name is correctly set in the plugin properties
  - Confirm that your EloWard subscription is active
  - Check the OBS log file for any error messages

- **Can't find the plugin in OBS?**
  - Make sure OBS is completely closed when installing the plugin
  - Try running the installer again with administrator privileges
  - Restart OBS after installation

- **Still having issues?**
  - Visit [eloward.com/support](https://eloward.com/support) for additional help
  - Check the [GitHub issues page](https://github.com/yourusername/eloward-rank-badges/issues) for known problems

## Building from Source

For advanced users who want to build the plugin from source:

### Prerequisites
- CMake 3.16 or newer
- OBS Studio development package
- C/C++ compiler (Visual Studio, GCC, or Clang)
- libcurl development package
- jansson JSON library development package

### Build Steps
1. Clone the repository
2. Create a build directory: `mkdir build && cd build`
3. Run CMake: `cmake ..`
4. Build the plugin: `cmake --build .`
5. Install: `cmake --install .`

## Technical Notes

- This plugin uses the same API endpoints as the EloWard browser extension
- The plugin injects JavaScript into the OBS chat window to display the badges
- Metrics are tracked on the EloWard server only when subscribed
- The plugin caches rank data in memory to reduce API calls
- When not subscribed, the plugin remains completely dormant for zero performance impact 