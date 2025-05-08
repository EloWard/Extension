# EloWard Rank Badges for OBS

An OBS Studio plugin that displays League of Legends rank badges next to usernames in Twitch chat for streamers.

## Development Guide

This README provides instructions for developers working on the EloWard Rank Badges plugin.

### Prerequisites

- **OBS Studio** installed on your system
- **C/C++ development environment**:
  - Windows: Visual Studio with C++ workload
  - macOS: Xcode Command Line Tools (`xcode-select --install`)
- **CMake** (3.10 or newer)
- **Git** (for version control)

### Building the Plugin

#### macOS

1. Clone or download this repository
2. Open Terminal and navigate to the plugin directory:
   ```
   cd /path/to/eloward-rank-badges
   ```
3. Create and enter a build directory:
   ```
   mkdir build && cd build
   ```
4. Configure with CMake:
   ```
   cmake -DCMAKE_BUILD_TYPE=RelWithDebInfo -DCMAKE_PREFIX_PATH=/path/to/obs-studio/build ..
   ```
   Note: You must specify the path to your OBS Studio build directory using `-DCMAKE_PREFIX_PATH`
5. Build the plugin:
   ```
   make
   ```
   
This will create `eloward-rank-badges.so` in the build directory.

#### Windows

1. Clone or download this repository
2. Open a Developer Command Prompt for Visual Studio
3. Navigate to the plugin directory:
   ```
   cd \path\to\eloward-rank-badges
   ```
4. Create and enter a build directory:
   ```
   mkdir build
   cd build
   ```
5. Configure with CMake:
   ```
   cmake -G "Visual Studio 17 2022" -A x64 ..
   ```
   (Adjust Visual Studio version as needed)
6. Build the plugin:
   ```
   cmake --build . --config RelWithDebInfo
   ```

This will create `eloward-rank-badges.dll` in the build directory (usually in a subfolder like `RelWithDebInfo`).

### Testing the Plugin

#### 1. Install the Plugin Using the Scripts

**Important:** Close OBS Studio completely before running the installer.

##### macOS
1. Run the installer script:
   ```
   ./install_mac.sh
   ```
   The script will:
   - Find the compiled `.so` file
   - Create the necessary directories in your OBS installation
   - Copy the plugin and data files to the correct locations

##### Windows
1. Run the installer script by double-clicking `install_windows.bat` or from command prompt:
   ```
   install_windows.bat
   ```
   The script will:
   - Find the compiled `.dll` file
   - Create the necessary directories in your OBS installation
   - Copy the plugin and data files to the correct locations

#### 2. Open OBS and Add the Plugin

1. Launch OBS Studio
2. Create or select a scene where you want to test the plugin
3. Add a new source:
   - Click the "+" button in the Sources panel
   - Select "EloWard Rank Badges" from the list
   - Give it a name (e.g., "EloWard Badges") and click "OK"
4. The source will appear invisible in your scene (this is normal)
5. If you have a Twitch chat Browser Source in your scene, the plugin should automatically detect it

#### 3. Configure the Plugin (if needed)

If your Twitch username isn't automatically detected:
1. Right-click the "EloWard Rank Badges" source
2. Select "Properties"
3. Enter your Twitch username (lowercase) in the "Streamer Name" field
4. Click "OK"

#### 4. Verify It's Working

1. Check the OBS logs for plugin information:
   - Help → Log Files → View Current Log
   - Look for entries containing "EloWard Rank Badges" or "eloward-rank-badges"
2. If you have a Twitch chat Browser Source in the same scene, the plugin should inject the necessary code to display rank badges

### Troubleshooting Development Issues

- **Compilation errors?**
  - Check that you have all required dependencies
  - Ensure your CMake and compiler versions are up to date
  - Check the error logs for specific issues

- **Plugin not loading in OBS?**
  - Check if the plugin files were copied to the correct location
  - Look for errors in the OBS log (Help → Log Files → View Current Log)
  - Try reinstalling using the installer script

- **Changes not appearing when testing?**
  - Make sure you're rebuilding the plugin after changes
  - Reinstall using the installer script
  - Restart OBS completely after installing

## Project Structure

- `eloward-rank-badges.c` - Main plugin implementation
- `eloward-rank-badges.js` - JavaScript code injected into the browser source
- `data/` - Resources used by the plugin
- `install_mac.sh` - macOS installation script
- `install_windows.bat` - Windows installation script
- `CMakeLists.txt` - CMake build configuration

## Technical Details

For production details and user-facing documentation, see the [EloWard website](https://eloward.com).


   /Users/sunnywang/Desktop/EloWardApp/obs-studio/build

      cd ~/path/to/eloward-rank-badges
   mkdir -p build && cd build
   cmake \
     -DCMAKE_PREFIX_PATH=/Users/sunnywang/Desktop/EloWardApp/obs-studio/build \
     -DCMAKE_BUILD_TYPE=RelWithDebInfo \
     ..
   make