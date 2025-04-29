@echo off
SETLOCAL EnableDelayedExpansion

echo EloWard Rank Badges Installer for OBS Studio
echo =============================================
echo.

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

:: Extension images source
SET "EXTENSION_IMAGES_DIR=%~dp0..\ext\images\ranks"
IF NOT EXIST "!EXTENSION_IMAGES_DIR!" (
    SET "EXTENSION_IMAGES_DIR=%UserProfile%\Desktop\EloWardApp\ext\images\ranks"
)

:: Setup directories
SET "PLUGIN_PATH=!OBS_INSTALL_PATH!\plugins\!PLUGIN_NAME!"
SET "DATA_PATH=!PLUGIN_PATH!\data"
SET "IMAGES_PATH=!DATA_PATH!\images\ranks"

:: Create directories
echo Creating directories...
IF NOT EXIST "!PLUGIN_PATH!" mkdir "!PLUGIN_PATH!"
IF NOT EXIST "!DATA_PATH!" mkdir "!DATA_PATH!"
IF NOT EXIST "!IMAGES_PATH!" mkdir "!IMAGES_PATH!"

:: Copy files
echo Copying plugin files...
copy "%~dp0eloward-rank-badges.c" "!PLUGIN_PATH!"
copy "%~dp0eloward-rank-badges.js" "!DATA_PATH!"
xcopy /E /Y "%~dp0data\locale" "!DATA_PATH!\locale\"

:: Copy rank images
echo Copying rank badge images...
IF EXIST "!EXTENSION_IMAGES_DIR!" (
    xcopy /Y "!EXTENSION_IMAGES_DIR!\*.png" "!IMAGES_PATH!\"
    echo Successfully copied rank badge images.
) ELSE (
    echo Warning: Extension images directory not found at !EXTENSION_IMAGES_DIR!
    echo You will need to manually copy the rank images to: !IMAGES_PATH!
)

:: Create a CMakeLists.txt file
echo Creating CMakeLists.txt...
(
    echo cmake_minimum_required^(VERSION 3.16^)
    echo.
    echo project^(eloward-rank-badges VERSION 1.0.0^)
    echo.
    echo set^(CMAKE_CXX_STANDARD 17^)
    echo set^(CMAKE_CXX_STANDARD_REQUIRED ON^)
    echo.
    echo find_package^(libobs REQUIRED^)
    echo find_package^(obs-frontend-api REQUIRED^)
    echo find_package^(jansson REQUIRED^)
    echo find_package^(CURL REQUIRED^)
    echo.
    echo set^(eloward-rank-badges_SOURCES
    echo     eloward-rank-badges.c^)
    echo.
    echo add_library^(eloward-rank-badges MODULE
    echo     ${eloward-rank-badges_SOURCES}^)
    echo.
    echo target_link_libraries^(eloward-rank-badges
    echo     libobs
    echo     obs-frontend-api
    echo     jansson
    echo     CURL::libcurl^)
    echo.
    echo configure_file^(eloward-rank-badges.js "${CMAKE_BINARY_DIR}/data/eloward-rank-badges.js" COPYONLY^)
    echo.
    echo if^(OS_WINDOWS^)
    echo     set_target_properties^(eloward-rank-badges PROPERTIES
    echo         PREFIX ""
    echo         SUFFIX ".dll"^)
    echo endif^(^)
    echo.
    echo setup_plugin_target^(eloward-rank-badges^)
) > "!PLUGIN_PATH!\CMakeLists.txt"

echo.
echo Installation complete!
echo.
echo To finish installation:
echo 1. Restart OBS Studio
echo 2. Add a 'EloWard Rank Badges' source to your scene
echo 3. Enter your Twitch channel name if not automatically detected
echo.
echo Support: https://eloward.com/support
echo.
echo Press any key to exit...
pause > nul
exit /b 0 