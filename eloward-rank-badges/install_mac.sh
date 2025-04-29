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
PLUGIN_BIN_DIR="$PLUGIN_DIR/bin/mac"
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
COMPILED_PLUGIN_FILE="$SCRIPT_DIR/eloward-rank-badges.so" # Assumes .so file is in the same dir as the script

# Check if compiled plugin exists
if [ ! -f "$COMPILED_PLUGIN_FILE" ]; then
    echo -e "${RED}[ERROR] Compiled plugin file (eloward-rank-badges.so) not found in the package.${NC}"
    echo "Please ensure the package is complete."
    exit 1
fi

# Create plugin directories
echo "Creating plugin directories..."
mkdir -p "$PLUGIN_BIN_DIR"
mkdir -p "$DATA_DIR/images/ranks"
mkdir -p "$DATA_DIR/locale"

# Copy compiled plugin binary
echo "Copying plugin module..."
cp "$COMPILED_PLUGIN_FILE" "$PLUGIN_BIN_DIR/"

# Copy data files (JS, images, locale)
echo "Copying data files..."
cp "$SCRIPT_DIR/eloward-rank-badges.js" "$DATA_DIR/"

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

echo -e "\n${GREEN}Installation complete!${NC}\n"
echo "Please restart OBS Studio to load the plugin."
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo -e "1. Launch OBS Studio."
echo -e "2. Go to the scene containing your Twitch chat (Browser Source)."
echo -e "3. Add a new source by clicking the '+' button under 'Sources'."
echo -e "4. Select ${YELLOW}\"EloWard Rank Badges\"${NC} from the list."
echo -e "5. Click 'OK'. The plugin will now work in that scene."
echo -e "6. If your Twitch name isn't detected, open the source properties and enter it."
echo ""
echo -e "Need help? Visit ${BLUE}https://eloward.com/feedback${NC} or email ${YELLOW}unleashai.inquiries@gmail.com${NC}"
echo ""