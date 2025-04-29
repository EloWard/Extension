@echo off
SETLOCAL EnableDelayedExpansion

echo ======================================================
echo   EloWard Rank Badges for OBS - Windows Installer
echo ======================================================
echo.
echo This script will install the EloWard Rank Badges plugin for OBS Studio.
echo.

:: Check if running with admin privileges
NET SESSION >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] This script requires administrative privileges.
    echo Please right-click the script and select "Run as administrator".
    echo.
    pause
    exit /b 1
)

:: Check if OBS is running
tasklist /FI "IMAGENAME eq obs64.exe" 2>NUL | find /I /N "obs64.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo [ERROR] OBS Studio is currently running.
    echo Please close OBS Studio before continuing.
    echo.
    pause
    exit /b 1
)

:: Define variables
set "DOWNLOAD_URL=https://github.com/yourusername/eloward-rank-badges/releases/latest/download/eloward-rank-badges-windows.zip"
set "TEMP_DIR=%TEMP%\eloward_installer"
set "TEMP_ZIP=%TEMP_DIR%\eloward-rank-badges.zip"

:: Try to find OBS Studio installation paths
set "DEFAULT_OBS_PATH_64=%ProgramFiles%\obs-studio"
set "DEFAULT_OBS_PATH_32=%ProgramFiles(x86)%\obs-studio"
set "DEFAULT_OBS_USER_PATH=%APPDATA%\obs-studio"

set "OBS_FOUND=0"
set "OBS_PATH="

if exist "%DEFAULT_OBS_PATH_64%" (
    set "OBS_PATH=%DEFAULT_OBS_PATH_64%"
    set "OBS_FOUND=1"
) else if exist "%DEFAULT_OBS_PATH_32%" (
    set "OBS_PATH=%DEFAULT_OBS_PATH_32%"
    set "OBS_FOUND=1"
)

:: Check if OBS is installed
if "%OBS_FOUND%"=="0" (
    echo [WARNING] Couldn't detect OBS Studio installation folder automatically.
    echo.
    
    :: Ask for manual path
    set /p "MANUAL_PATH=Please enter the path to your OBS Studio installation (or press Enter to exit): "
    
    if "!MANUAL_PATH!"=="" (
        echo Installation canceled.
        pause
        exit /b 1
    ) else (
        if exist "!MANUAL_PATH!" (
            set "OBS_PATH=!MANUAL_PATH!"
            set "OBS_FOUND=1"
        ) else (
            echo [ERROR] The specified path does not exist.
            pause
            exit /b 1
        )
    )
)

:: Verify OBS path contains the plugins folder structure
if not exist "%OBS_PATH%\obs-plugins\64bit" (
    echo [ERROR] The OBS plugin directory was not found in the specified path.
    echo Expected: %OBS_PATH%\obs-plugins\64bit
    echo.
    pause
    exit /b 1
)

:: Create temp directory
if not exist "%TEMP_DIR%" mkdir "%TEMP_DIR%"

echo [1/4] Downloading EloWard Rank Badges plugin...
echo.

:: Download the plugin using PowerShell
powershell -Command "& {[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%DOWNLOAD_URL%' -OutFile '%TEMP_ZIP%'}"

if not exist "%TEMP_ZIP%" (
    echo [ERROR] Download failed. Please check your internet connection and try again.
    rmdir /S /Q "%TEMP_DIR%" 2>nul
    pause
    exit /b 1
)

echo [2/4] Extracting files...
echo.

:: Create PowerShell script to extract the ZIP file
echo Add-Type -AssemblyName System.IO.Compression.FileSystem > "%TEMP_DIR%\extract.ps1"
echo [System.IO.Compression.ZipFile]::ExtractToDirectory('%TEMP_ZIP%', '%TEMP_DIR%\extracted') >> "%TEMP_DIR%\extract.ps1"

:: Run the extraction script
powershell -ExecutionPolicy Bypass -File "%TEMP_DIR%\extract.ps1"

if not exist "%TEMP_DIR%\extracted" (
    echo [ERROR] Extraction failed.
    rmdir /S /Q "%TEMP_DIR%" 2>nul
    pause
    exit /b 1
)

echo [3/4] Installing plugin files...
echo.

:: Copy plugin files to OBS directory
xcopy /E /I /Y "%TEMP_DIR%\extracted\obs-plugins\64bit\*" "%OBS_PATH%\obs-plugins\64bit\"
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to copy plugin files to OBS directory.
    rmdir /S /Q "%TEMP_DIR%" 2>nul
    pause
    exit /b 1
)

:: Copy data files to OBS directory
if exist "%TEMP_DIR%\extracted\data" (
    if not exist "%OBS_PATH%\data\obs-plugins\eloward-rank-badges" mkdir "%OBS_PATH%\data\obs-plugins\eloward-rank-badges"
    xcopy /E /I /Y "%TEMP_DIR%\extracted\data\*" "%OBS_PATH%\data\obs-plugins\eloward-rank-badges\"
    if %ERRORLEVEL% NEQ 0 (
        echo [WARNING] Failed to copy data files. Plugin may not work correctly.
    )
)

echo [4/4] Cleaning up...
echo.

:: Clean up
rmdir /S /Q "%TEMP_DIR%" 2>nul

echo ======================================================
echo Installation Complete!
echo ======================================================
echo.
echo The EloWard Rank Badges plugin has been successfully installed.
echo.
echo To use the plugin:
echo 1. Launch OBS Studio
echo 2. Add "EloWard Rank Badges" source to any scene
echo 3. Make sure you have a Browser Source with Twitch chat in the same scene
echo 4. Enter your Twitch username in the plugin properties if not automatically detected
echo.
echo Need help? Visit: https://eloward.com/support
echo.
pause 