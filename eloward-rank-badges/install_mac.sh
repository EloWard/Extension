#!/bin/bash

# ANSI color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================================"
echo -e "  EloWard Rank Badges for OBS - Mac Installer"
echo -e "======================================================${NC}"
echo ""
echo "This script will install the EloWard Rank Badges plugin for OBS Studio."
echo ""

# Exit if OBS is running
if pgrep -x "OBS" > /dev/null; then
    echo -e "${RED}[ERROR] Please close OBS Studio before installing.${NC}"
    exit 1
fi

# Detect OBS plugin directory
OBS_USER_DIR="$HOME/Library/Application Support/obs-studio/plugins"
if [ ! -d "$OBS_USER_DIR" ]; then
    echo -e "${RED}[ERROR] OBS plugins folder not found at '$OBS_USER_DIR'${NC}"
    exit 1
fi

# Determine script directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Copy plugin binaries
echo Copying plugin module...
cp -R "$SCRIPT_DIR/plugins/obs-plugins/"* "$OBS_USER_DIR/"

# Copy data files
echo Copying JavaScript and data...
DATA_DEST="$HOME/Library/Application Support/obs-studio/data/obs-plugins/eloward-rank-badges"
mkdir -p "$DATA_DEST"
cp -R "$SCRIPT_DIR/data/"* "$DATA_DEST/"
cp "$SCRIPT_DIR/eloward-rank-badges.js" "$DATA_DEST/"

# Determine OBS directory
OBS_DIR="$HOME/Library/Application Support/obs-studio"
PLUGIN_NAME="eloward-rank-badges"
PLUGIN_DIR="$OBS_DIR/plugins/$PLUGIN_NAME"
DATA_DIR="$OBS_DIR/plugins/$PLUGIN_NAME/data"
RESOURCES_DIR="$DATA_DIR/images/ranks"

# Extension images source
EXTENSION_IMAGES_DIR="/Users/sunnywang/Desktop/EloWardApp/ext/images/ranks"

# Check if OBS is installed
if [ ! -d "$OBS_DIR" ]; then
    echo "Error: OBS Studio installation not found at $OBS_DIR"
    echo "Please make sure OBS Studio is installed."
    exit 1
fi

echo "Found OBS Studio installation at $OBS_DIR"

# Create plugin directories
mkdir -p "$PLUGIN_DIR/bin/mac"
mkdir -p "$DATA_DIR"
mkdir -p "$RESOURCES_DIR"

# Copy plugin files
echo "Copying plugin files..."
cp "$(dirname "$0")/eloward-rank-badges.c" "$PLUGIN_DIR/"
cp "$(dirname "$0")/eloward-rank-badges.js" "$DATA_DIR/"
cp -r "$(dirname "$0")/data/locale" "$DATA_DIR/"

# Copy the rank images from the extension directory
echo "Copying rank images from extension..."
if [ -d "$EXTENSION_IMAGES_DIR" ]; then
    cp "$EXTENSION_IMAGES_DIR"/*.png "$RESOURCES_DIR/"
    echo "Successfully copied rank badge images."
else
    echo "Warning: Extension images directory not found at $EXTENSION_IMAGES_DIR"
    echo "You will need to manually copy the rank images to: $RESOURCES_DIR"
fi

# Build the plugin
echo "Building plugin..."
cd "$PLUGIN_DIR"
# Simplified build for demo purposes
echo "Plugin installed to $PLUGIN_DIR"

# Create a CMakeLists.txt file
cat > "$PLUGIN_DIR/CMakeLists.txt" << EOL
cmake_minimum_required(VERSION 3.16)

project(eloward-rank-badges VERSION 1.0.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(libobs REQUIRED)
find_package(obs-frontend-api REQUIRED)
find_package(jansson REQUIRED)
find_package(CURL REQUIRED)

set(eloward-rank-badges_SOURCES
    eloward-rank-badges.c)

add_library(eloward-rank-badges MODULE
    \${eloward-rank-badges_SOURCES})

target_link_libraries(eloward-rank-badges
    libobs
    obs-frontend-api
    jansson
    CURL::libcurl)

configure_file(eloward-rank-badges.js "\${CMAKE_BINARY_DIR}/data/eloward-rank-badges.js" COPYONLY)

if(OS_MACOS)
    set_target_properties(eloward-rank-badges PROPERTIES
        PREFIX ""
        SUFFIX ".so")
endif()

setup_plugin_target(eloward-rank-badges)
EOL

echo -e "\n${GREEN}Installation complete!${NC}\n"
echo "Please restart OBS Studio and add the \"EloWard Rank Badges\" source."
echo ""
echo -e "To use the plugin:"
echo -e "1. Launch OBS Studio"
echo -e "2. Add ${YELLOW}\"EloWard Rank Badges\"${NC} source to any scene"
echo -e "3. Make sure you have a Browser Source with Twitch chat in the same scene"
echo -e "4. Enter your Twitch username in the plugin properties if not automatically detected"
echo ""
echo -e "Need help? Visit: ${BLUE}https://eloward.com/support${NC}"
echo "" 