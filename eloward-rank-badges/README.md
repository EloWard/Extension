# EloWard Rank Badges for OBS

An OBS Studio plugin that displays League of Legends rank badges next to usernames in Twitch chat for streamers.

## Overview

This OBS plugin integrates with the EloWard service to display rank badges for viewers in Twitch chat. It works by adding a small, invisible source to your scene which detects your chat source and injects the necessary code to show badges.

1. Checks if the streamer is subscribed to EloWard.
2. If subscribed, adds rank badges next to viewer usernames in the OBS chat window (Browser Source).
3. If not subscribed, performs no operations for maximum efficiency.

## Easy Installation

**Important:** Close OBS Studio completely before running the installer.

This package includes the pre-compiled plugin. The installer script simply copies the necessary files to the correct OBS Studio folders.

### Windows Users
1. Right-click on `install_windows.bat` and select "Run as administrator".
2. Follow the on-screen instructions.

### Mac Users
1. Open **Terminal** (you can find it in Applications > Utilities, or search using Spotlight).
2. Type the command `bash ` into the Terminal window (make sure to include the space after `bash`). **Do not press Enter yet.**
3. Drag the `install_mac.sh` file from your download location onto the Terminal window. The path to the file will appear after `bash `.
4. Press **Enter** in the Terminal window.
5. Follow any instructions shown in the Terminal.

The installer will automatically:
- Find your OBS installation.
- Install all required plugin files (binary, JavaScript, images, locale).
- Provide usage instructions.

## Usage

1. After running the installer, **restart OBS Studio** to ensure it loads the new plugin.
2. Go to the scene that contains your **Twitch chat Browser Source**.
3. Add a new source by clicking the **'+' button** under the 'Sources' dock.
4. Select **"EloWard Rank Badges"** from the list of available sources.
5. Give it a name (e.g., "EloWard Badges") and click **'OK'**.
6. **That's it!** The source is invisible but will now automatically detect your chat source in that scene and start showing badges (if you are subscribed and viewers have linked accounts).
7. If your Twitch username isn't detected automatically (check the OBS logs: Help -> Log Files -> View Current Log, look for "EloWard Ranks"), you can manually set it:
   - Right-click the "EloWard Rank Badges" source you added.
   - Select "Properties".
   - Enter your Twitch username (lowercase) in the "Streamer Name" field.
   - Click "OK".

## Troubleshooting

- **Plugin not listed in OBS after installation?**
  - Ensure OBS was *completely* closed (check Task Manager/Activity Monitor) before running the installer.
  - Run the installer again.
  - Restart OBS Studio after installation.
  - Check the OBS log files (Help -> Log Files -> View Current Log) for errors related to "eloward-rank-badges" during startup.

- **Badges not appearing in chat?**
  - Make sure the **"EloWard Rank Badges" source** is in the **same scene** as your Twitch chat Browser Source.
  - Ensure your chat **Browser Source's name** contains "chat", "Chat", "twitch", or "Twitch" (case-insensitive) so the plugin can find it.
  - Check the plugin's properties (right-click the source -> Properties) and verify your streamer name is correctly set if it wasn't auto-detected.
  - Confirm your EloWard subscription is active by checking your account on eloward.com.
  - Remember badges only show for viewers who have linked their Riot account via the EloWard extension.

- **Need more help?**
  - Visit [eloward.com/feedback](https://eloward.com/feedback) or email unleashai.inquiries@gmail.com

## Technical Details

For more technical information, see the [project GitHub page](https://github.com/yourusername/eloward-rank-badges).