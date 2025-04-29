# EloWard Rank Badges for OBS

An OBS Studio plugin that displays League of Legends rank badges next to usernames in Twitch chat for streamers.

## Overview

This OBS plugin integrates with the EloWard service to display rank badges for viewers in Twitch chat. It follows the same workflow as the EloWard browser extension, but operates directly within OBS:

1. Checks if the streamer is subscribed to EloWard
2. If subscribed, displays rank badges next to viewer usernames in the chat browser source
3. Tracks usage metrics similar to the browser extension

## Features

- Automatically checks streamer subscription status
- Displays League of Legends rank badges next to viewer usernames
- Shows tooltips with detailed rank information on hover
- Tracks database reads and successful lookups for metrics
- No caching of rank data on disk (all in-memory)
- Simple integration with existing OBS Twitch chat browser sources
- Multiple methods to detect the streamer name

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
2. Make sure you have a Browser Source showing your Twitch chat in the same scene (the name should contain "chat", "Chat", "twitch", or "Twitch")
3. Configure the plugin:
   - Enter your Twitch streamer name in the "Streamer Name" field if it's not automatically detected
   - The plugin will save this setting globally for all scenes

4. The plugin will automatically:
   - Check if you're subscribed to EloWard
   - If subscribed, inject the badge display code into the chat browser source
   - Display rank badges next to usernames in chat

5. You can monitor metrics from the plugin properties:
   - Database Reads: Number of API calls made to fetch rank data
   - Successful Lookups: Number of successful rank retrievals

## Streamer Name Detection

The plugin attempts to determine your Twitch username in the following order:

1. From the "Streamer Name" setting in the plugin properties
2. From your OBS stream settings (service username)
3. From your OBS profile name
4. From a global OBS setting

If none of these methods work, you should manually set your Twitch username in the plugin properties.

## Metrics Tracking

The plugin tracks the following metrics similar to the browser extension:

- **Database Reads**: Each time the plugin makes an API call to fetch rank data
- **Successful Lookups**: Each time a rank is successfully retrieved and displayed

These metrics are displayed in the plugin properties and are also sent to the EloWard service to track usage.

## Troubleshooting

- If rank badges aren't appearing:
  - Check the "Subscription Status" in the plugin properties to see if you're subscribed
  - Make sure your Twitch chat browser source has "chat", "Chat", "twitch", or "Twitch" in its name
  - Verify your streamer name is correctly set in the plugin properties
  - Check the OBS log file for any error messages

- If your streamer name isn't being detected:
  - Enter it manually in the plugin's "Streamer Name" field
  - Make sure to use your exact Twitch username

## Technical Notes

- This plugin uses the same API endpoints as the EloWard browser extension
- The plugin injects JavaScript into the browser source to display the badges
- Metrics are tracked both locally and on the EloWard server
- The plugin caches rank data in memory to reduce API calls 