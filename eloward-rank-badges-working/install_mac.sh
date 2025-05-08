#!/bin/bash

# ANSI color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================================"
echo -e "  EloWard Rank Badges for OBS - Mac Test Installer"
echo -e "======================================================${NC}"
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

# Check if OBS user directory exists
if [ ! -d "$OBS_DIR" ]; then
    echo -e "${YELLOW}Warning: OBS Application Support directory not found at '$OBS_DIR'. Creating it.${NC}"
    mkdir -p "$OBS_DIR/plugins" || {
        echo -e "${RED}Failed to create OBS directory. Check permissions.${NC}"
        exit 1
    }
fi

echo -e "${GREEN}Using OBS plugin directory: $PLUGIN_DIR${NC}"

# Determine script directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Create plugin directories
echo "Creating plugin directories..."
mkdir -p "$PLUGIN_DIR" # Ensure base plugin dir exists
mkdir -p "$PLUGIN_DIR/bin/64bit" # Binary directory
mkdir -p "$DATA_DIR/images/ranks"
mkdir -p "$DATA_DIR/locale"

# Check for compiled plugin
COMPILED_PLUGIN="${SCRIPT_DIR}/build/eloward-rank-badges.so"
if [ ! -f "$COMPILED_PLUGIN" ]; then
    echo -e "${YELLOW}Warning: Compiled plugin not found at $COMPILED_PLUGIN${NC}"
    echo "Attempting to find it elsewhere..."
    COMPILED_PLUGIN=$(find "${SCRIPT_DIR}" -name "*.so" | grep -i "eloward-rank" | head -n 1)
    
    if [ -z "$COMPILED_PLUGIN" ]; then
        echo -e "${RED}Error: Could not find compiled plugin (.so file).${NC}"
        echo "Please build the plugin first or place the .so file in the build directory."
        exit 1
    else
        echo -e "${GREEN}Found plugin at: $COMPILED_PLUGIN${NC}"
    fi
fi

# Copy plugin binary
echo "Copying plugin binary..."
cp "$COMPILED_PLUGIN" "$PLUGIN_DIR/bin/64bit/"

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
    echo -e "${YELLOW}Warning: Rank images not found in the package.${NC}"
    echo "The plugin may not display rank badges correctly."
fi

echo -e "\n${GREEN}Plugin installed successfully!${NC}\n"
echo "Please restart OBS Studio to load the plugin."
echo ""
echo -e "${YELLOW}Usage:${NC}"
echo "1. Launch OBS Studio."
echo "2. Add the 'EloWard Rank Badges' source to the scene containing your chat."
echo "3. If needed, set your streamer name in the source properties."
echo ""
echo -e "Need help? Visit ${BLUE}https://eloward.com/feedback${NC} or email ${YELLOW}unleashai.inquiries@gmail.com${NC}"
echo ""