# EloWard Rank Badges for OBS

This OBS plugin displays League of Legends rank badges next to usernames in Twitch chat.

## Features

- Displays League of Legends rank badges in OBS browser sources showing Twitch chat
- Automatically detects the streamer's username
- Shows tooltips with detailed rank information on hover
- Maintains subscription verification with the EloWard service

## Installation

### macOS

1. Download the latest release from the [releases page](https://github.com/EloWard/eloward-rank-badges/releases)
2. Extract the archive
3. Copy the `eloward-rank-badges.plugin` folder to `~/Library/Application Support/obs-studio/plugins/`
4. Restart OBS

### Windows

1. Download the latest release from the [releases page](https://github.com/EloWard/eloward-rank-badges/releases)
2. Extract the archive
3. Copy the `eloward-rank-badges` folder to `C:\Program Files\obs-studio\obs-plugins\64bit\`
4. Restart OBS

## Usage

1. Add a Browser Source to your scene with the Twitch chat URL
2. The plugin will automatically detect the chat and inject rank badges

## Building from Source

### Prerequisites

- CMake 3.28 or newer
- OBS Studio development files
- CURL development libraries
- Jansson development libraries

### Build Steps

```bash
# Clone the repository
git clone https://github.com/EloWard/eloward-rank-badges.git
cd eloward-rank-badges

# Configure with CMake
cmake -S . -B build -G Ninja

# Build
cmake --build build

# Install
cmake --install build
```

## License

This project is licensed under the GPL v2 License - see the LICENSE file for details.

## Acknowledgments

- OBS Studio Team for their excellent software and plugin API
- League of Legends for providing the rank tier system
- All the streamers who use the EloWard extension
