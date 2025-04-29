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

# Check if OBS is running
if pgrep -x "OBS" > /dev/null; then
    echo -e "${RED}[ERROR] OBS Studio is currently running."
    echo -e "Please close OBS Studio before continuing.${NC}"
    echo ""
    exit 1
fi

# Define variables
DOWNLOAD_URL="https://github.com/yourusername/eloward-rank-badges/releases/latest/download/eloward-rank-badges-mac.zip"
TEMP_DIR="/tmp/eloward_installer"
TEMP_ZIP="$TEMP_DIR/eloward-rank-badges.zip"

# Try to find OBS Studio installation paths
DEFAULT_OBS_APP="/Applications/OBS.app"
USER_OBS_APP="$HOME/Applications/OBS.app"

# Plugin directories
SYSTEM_PLUGIN_DIR="/Library/Application Support/obs-studio/plugins"
USER_PLUGIN_DIR="$HOME/Library/Application Support/obs-studio/plugins"

OBS_FOUND=0
PLUGIN_PATH=""

# Check if OBS is installed in Applications
if [ -d "$DEFAULT_OBS_APP" ]; then
    OBS_FOUND=1
    PLUGIN_PATH="$USER_PLUGIN_DIR"
# Check if OBS is installed in User Applications
elif [ -d "$USER_OBS_APP" ]; then
    OBS_FOUND=1
    PLUGIN_PATH="$USER_PLUGIN_DIR"
fi

# If OBS is not found, ask for manual path
if [ $OBS_FOUND -eq 0 ]; then
    echo -e "${YELLOW}[WARNING] Couldn't detect OBS Studio installation folder automatically.${NC}"
    echo ""
    echo "OBS Studio should be installed in /Applications or ~/Applications."
    echo -e "If you've installed it elsewhere, please ${YELLOW}drag and drop your OBS.app${NC} into this terminal window."
    echo -e "Or press Enter to use the default path: $DEFAULT_OBS_APP"
    echo ""
    
    read -p "Path to OBS.app: " MANUAL_PATH
    
    if [ -z "$MANUAL_PATH" ]; then
        # Use default if nothing is entered
        if [ -d "$DEFAULT_OBS_APP" ]; then
            OBS_FOUND=1
            PLUGIN_PATH="$USER_PLUGIN_DIR"
        else
            echo -e "${RED}[ERROR] OBS Studio not found at the default location.${NC}"
            echo "Please make sure OBS Studio is installed and try again."
            exit 1
        fi
    else
        # Remove quotes if user dragged and dropped the app
        MANUAL_PATH=$(echo "$MANUAL_PATH" | tr -d "'" | tr -d '"')
        
        if [ -d "$MANUAL_PATH" ]; then
            OBS_FOUND=1
            PLUGIN_PATH="$USER_PLUGIN_DIR"
        else
            echo -e "${RED}[ERROR] The specified path does not exist.${NC}"
            exit 1
        fi
    fi
fi

# Create temp directory
mkdir -p "$TEMP_DIR"

echo -e "${BLUE}[1/4] Downloading EloWard Rank Badges plugin...${NC}"
echo ""

# Download the plugin
if ! curl -L "$DOWNLOAD_URL" -o "$TEMP_ZIP" --progress-bar; then
    echo -e "${RED}[ERROR] Download failed. Please check your internet connection and try again.${NC}"
    rm -rf "$TEMP_DIR"
    exit 1
fi

echo -e "${BLUE}[2/4] Extracting files...${NC}"
echo ""

# Create extraction directory
mkdir -p "$TEMP_DIR/extracted"

# Extract the zip file
if ! unzip -q "$TEMP_ZIP" -d "$TEMP_DIR/extracted"; then
    echo -e "${RED}[ERROR] Extraction failed.${NC}"
    rm -rf "$TEMP_DIR"
    exit 1
fi

echo -e "${BLUE}[3/4] Installing plugin files...${NC}"
echo ""

# Create plugin directory if it doesn't exist
mkdir -p "$PLUGIN_PATH"

# Copy plugin files to OBS directory
if ! cp -R "$TEMP_DIR/extracted/eloward-rank-badges" "$PLUGIN_PATH/"; then
    echo -e "${RED}[ERROR] Failed to copy plugin files to OBS directory.${NC}"
    echo "You may need to run this script with sudo if installing to system directories."
    rm -rf "$TEMP_DIR"
    exit 1
fi

echo -e "${BLUE}[4/4] Cleaning up...${NC}"
echo ""

# Clean up
rm -rf "$TEMP_DIR"

echo -e "${GREEN}======================================================"
echo -e "Installation Complete!"
echo -e "======================================================${NC}"
echo ""
echo "The EloWard Rank Badges plugin has been successfully installed."
echo ""
echo -e "To use the plugin:"
echo -e "1. Launch OBS Studio"
echo -e "2. Add ${YELLOW}\"EloWard Rank Badges\"${NC} source to any scene"
echo -e "3. Make sure you have a Browser Source with Twitch chat in the same scene"
echo -e "4. Enter your Twitch username in the plugin properties if not automatically detected"
echo ""
echo -e "Need help? Visit: ${BLUE}https://eloward.com/support${NC}"
echo "" 