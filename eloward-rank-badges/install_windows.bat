@echo off
SETLOCAL EnableDelayedExpansion

echo EloWard Rank Badges Installer for OBS Studio
echo =============================================
echo.

:: Check if OBS is running
tasklist /FI "IMAGENAME eq obs64.exe" 2>NUL | find /I "obs64.exe" >NUL
if "%ERRORLEVEL%"=="0" (
    echo [ERROR] Please close OBS Studio before installing.
    echo.
    echo Press any key to exit...
    pause > nul
    exit /b 1
)

:: Find OBS installation path
SET "OBS_INSTALL_PATH="
SET "PLUGIN_NAME=eloward-rank-badges"

:: Check common installation locations
IF EXIST "%ProgramFiles%\obs-studio" (
    SET "OBS_INSTALL_PATH=%ProgramFiles%\obs-studio"
) ELSE (
    IF EXIST "%ProgramFiles(x86)%\obs-studio" (
        SET "OBS_INSTALL_PATH=%ProgramFiles(x86)%\obs-studio"
    )
)

:: If not found in Program Files, try appdata
IF "!OBS_INSTALL_PATH!" == "" (
    IF EXIST "%APPDATA%\obs-studio" (
        SET "OBS_INSTALL_PATH=%APPDATA%\obs-studio"
    )
)

:: Handle case where OBS is not detected
IF "!OBS_INSTALL_PATH!" == "" (
    echo Error: OBS Studio installation not found.
    echo Please make sure OBS is installed.
    echo.
    echo Press any key to exit...
    pause > nul
    exit /b 1
)

echo Found OBS Studio at: !OBS_INSTALL_PATH!

:: Determine script directory (where the installer is located)
SET "SCRIPT_DIR=%~dp0"
SET "COMPILED_PLUGIN_FILE=%SCRIPT_DIR%eloward-rank-badges.dll" &:: Assumes .dll file is in the same dir

:: Check if compiled plugin exists
IF NOT EXIST "!COMPILED_PLUGIN_FILE!" (
    echo [ERROR] Compiled plugin file (eloward-rank-badges.dll) not found in the package.
    echo Please ensure the package is complete.
    echo.
    echo Press any key to exit...
    pause > nul
    exit /b 1
)

:: Setup directories
SET "PLUGIN_PATH=!OBS_INSTALL_PATH!\plugins\!PLUGIN_NAME!"
SET "PLUGIN_BIN_PATH=!PLUGIN_PATH!\bin\64bit" &:: Assuming 64-bit OBS
SET "DATA_PATH=!PLUGIN_PATH!\data"
SET "IMAGES_PATH=!DATA_PATH!\images\ranks"

:: Create directories
echo Creating directories...
IF NOT EXIST "!PLUGIN_PATH!" mkdir "!PLUGIN_PATH!"
IF NOT EXIST "!PLUGIN_BIN_PATH!" mkdir "!PLUGIN_BIN_PATH!"
IF NOT EXIST "!DATA_PATH!" mkdir "!DATA_PATH!"
IF NOT EXIST "!IMAGES_PATH!" mkdir "!IMAGES_PATH!"
IF NOT EXIST "!DATA_PATH!\locale" mkdir "!DATA_PATH!\locale"

:: Copy compiled plugin binary
echo Copying plugin module...
copy "!COMPILED_PLUGIN_FILE!" "!PLUGIN_BIN_PATH!\"

:: Copy data files (JS, images, locale)
echo Copying data files...
copy "%SCRIPT_DIR%eloward-rank-badges.js" "!DATA_PATH!\"

:: Copy locale data if it exists
IF EXIST "%SCRIPT_DIR%data\locale" (
    xcopy /E /Y /I "%SCRIPT_DIR%data\locale\*" "!DATA_PATH!\locale\"
)

:: Copy rank images from the plugin package
echo Copying rank badge images...
IF EXIST "%SCRIPT_DIR%data\images\ranks" (
    xcopy /Y "%SCRIPT_DIR%data\images\ranks\*.png" "!IMAGES_PATH!\"
    echo Successfully copied rank badge images.
) ELSE (
    echo Warning: Rank images not found in the plugin package.
    echo The plugin may not display rank badges correctly.
)

echo.
echo Installation complete!
echo.
echo Please restart OBS Studio to load the plugin.
echo.
echo Next Steps:
echo 1. Launch OBS Studio.
echo 2. Go to the scene containing your Twitch chat (Browser Source).
echo 3. Add a new source by clicking the '+' button under 'Sources'.
echo 4. Select "EloWard Rank Badges" from the list.
echo 5. Click 'OK'. The plugin will now work in that scene.
echo 6. If your Twitch name isn't detected, open the source properties and enter it.
echo.
echo Need help? Visit https://eloward.com/feedback or email unleashai.inquiries@gmail.com
echo.
echo Press any key to exit...
pause > nul
exit /b 0 