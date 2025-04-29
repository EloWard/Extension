# EloWard Rank Badges for OBS

An OBS Studio plugin that displays League of Legends rank badges next to usernames in Twitch chat for streamers.

## Overview

This OBS plugin integrates with the EloWard service to display rank badges for viewers in Twitch chat. It follows the same workflow as the EloWard browser extension, but operates directly within OBS:

1. Checks if the streamer is subscribed to EloWard
2. If subscribed, displays rank badges next to viewer usernames in the chat browser source

## Features

- Automatically checks streamer subscription status
- Displays League of Legends rank badges next to viewer usernames
- No caching of rank data on disk (all in-memory)
- Simple integration with existing OBS Twitch chat browser sources

## Installation

### Pre-built Binaries

1. Download the latest release zip file for your platform (Windows/Mac/Linux)
2. Extract the zip file to your OBS plugins directory:
   - Windows: `C:\Program Files\obs-studio\obs-plugins\64bit\`
   - macOS: `~/Library/Application Support/obs-studio/plugins/`
   - Linux: `/usr/lib/obs-plugins/` or `~/.config/obs-studio/plugins/`
3. Restart OBS Studio

### Building from Source

#### Prerequisites

- CMake 3.16 or newer
- OBS Studio development package
- C/C++ compiler (Visual Studio, GCC, or Clang)
- libcurl development package
- jansson JSON library development package

#### Build Steps

1. Clone this repository:
   ```
   git clone https://github.com/yourusername/eloward-rank-badges.git
   cd eloward-rank-badges
   ```

2. Create a build directory and run CMake:
   ```
   mkdir build
   cd build
   cmake ..
   ```

3. Build the plugin:
   ```
   cmake --build .
   ```

4. Install the plugin:
   ```
   cmake --install .
   ```

## Usage

1. After installing the plugin and restarting OBS Studio, add the "EloWard Rank Badges" source to any scene where you're displaying Twitch chat
2. Make sure you have a Browser Source showing your Twitch chat in the same scene (the name should contain "chat" or "Chat")
3. The plugin will automatically:
   - Check if you're subscribed to EloWard
   - If subscribed, inject the badge display code into the chat browser source
   - Display rank badges next to usernames in chat

## Troubleshooting

- If rank badges aren't appearing:
  - Make sure your Twitch chat browser source has "chat" in its name
  - Check if you're subscribed to EloWard using the "Check Subscription" button in the plugin properties
  - Check the OBS log file for any error messages

## Technical Notes

- This plugin uses the same API endpoints as the EloWard browser extension
- The plugin injects JavaScript into the browser source to display the badges
- Only the essential functionality is included to keep the plugin simple and focused 