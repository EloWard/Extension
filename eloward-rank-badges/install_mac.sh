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

# Determine OBS directories
OBS_DIR="$HOME/Library/Application Support/obs-studio"
PLUGIN_NAME="eloward-rank-badges"
PLUGIN_DIR="$OBS_DIR/plugins/$PLUGIN_NAME"
DATA_DIR="$PLUGIN_DIR/data"
RESOURCES_DIR="$DATA_DIR/images/ranks"

# Check if OBS is installed
if [ ! -d "$OBS_DIR" ]; then
    echo -e "${RED}[ERROR] OBS Studio installation not found at '$OBS_DIR'${NC}"
    echo "Please make sure OBS Studio is installed."
    exit 1
fi

echo -e "${GREEN}Found OBS Studio installation at $OBS_DIR${NC}"

# Determine script directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Create plugin directories
echo "Creating plugin directories..."
mkdir -p "$PLUGIN_DIR/bin/mac"
mkdir -p "$DATA_DIR/images/ranks"
mkdir -p "$DATA_DIR/locale"

# Copy plugin files
echo "Copying plugin files..."
cp "$SCRIPT_DIR/eloward-rank-badges.c" "$PLUGIN_DIR/"
cp "$SCRIPT_DIR/eloward-rank-badges.js" "$DATA_DIR/"
if [ -f "$SCRIPT_DIR/CMakeLists.txt" ]; then
    cp "$SCRIPT_DIR/CMakeLists.txt" "$PLUGIN_DIR/"
fi

# Copy locale data if it exists
if [ -d "$SCRIPT_DIR/data/locale" ]; then
    cp -r "$SCRIPT_DIR/data/locale"/* "$DATA_DIR/locale/"
fi

# Copy the rank images from the plugin's data directory
echo "Copying rank badge images..."
if [ -d "$SCRIPT_DIR/data/images/ranks" ]; then
    cp "$SCRIPT_DIR/data/images/ranks"/*.png "$RESOURCES_DIR/"
    echo "Successfully copied rank badge images."
else
    echo -e "${YELLOW}Warning: Rank images not found in the plugin package.${NC}"
    echo "The plugin may not display rank badges correctly."
fi

# Create a CMakeLists.txt file if it doesn't exist
if [ ! -f "$PLUGIN_DIR/CMakeLists.txt" ]; then
    echo "Creating CMakeLists.txt..."
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
fi

echo -e "\n${GREEN}Installation complete!${NC}\n"
echo "Please restart OBS Studio and add the \"EloWard Rank Badges\" source."
echo ""
echo -e "To use the plugin:"
echo -e "1. Launch OBS Studio"
echo -e "2. Add ${YELLOW}\"EloWard Rank Badges\"${NC} source to any scene"
echo -e "3. Make sure you have a Browser Source with Twitch chat in the same scene"
echo -e "4. Enter your Twitch username in the plugin properties if not automatically detected"
echo ""
echo -e "Need help? Visit ${BLUE}https://eloward.com/feedback${NC} or email ${YELLOW}unleashai.inquiries@gmail.com${NC}"
echo ""