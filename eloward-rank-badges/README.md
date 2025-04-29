# EloWard Rank Badges for OBS

An OBS Studio plugin that displays League of Legends rank badges next to usernames in Twitch chat for streamers.

## Overview

This plugin connects to the EloWard API service to retrieve player rank data and displays it next to viewer usernames in the Twitch chat OBS source. This allows streamers to easily see the ranks of their viewers directly in their OBS chat source.

## Features

- Displays League of Legends rank badges next to usernames in Twitch chat
- Automatically fetches rank data from the EloWard API
- Simple integration with existing OBS Twitch chat browser sources
- No authentication or configuration needed

## Installation

### Pre-built Binaries

1. Download the latest release zip file for your platform (Windows/Mac/Linux) from the releases page
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

1. After installing the plugin, restart OBS Studio
2. Add the "EloWard Rank Badges" source to any scene where you're displaying Twitch chat
3. Make sure you also have a Browser Source displaying your Twitch chat in the same scene
4. The plugin will automatically find your chat browser source and add rank badges next to usernames

## Technical Notes

- This plugin uses the EloWard API to fetch rank data
- No caching is performed to keep memory usage low
- The plugin detects chat sources by looking for browser sources with "chat" in their name

## Troubleshooting

- If rank badges aren't appearing, make sure your chat browser source has "chat" in its name
- Check the OBS log file for any error messages from the plugin
- Verify that your internet connection is working properly

## License

This project is licensed under the MIT License - see the LICENSE file for details. 