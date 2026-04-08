@echo off
setlocal EnableExtensions EnableDelayedExpansion
REM [TITLE] Script: RaveLink-Bridge-Install-Optional-Audio-Tools.bat
REM [TITLE] Purpose: local helper to bootstrap optional runtime dependencies used by audio + mod lanes
REM [TITLE] Functionality Index:
REM [TITLE] - ensures npm dependencies are installed via scripts\bootstrap-runtime.js
REM [TITLE] - installs Playwright browser runtimes used by mod browser-driver integrations
REM [TITLE] - leaves shell open with clear diagnostics on failure

cd /d "%~dp0"

echo [RaveLink] Optional runtime tools bootstrap
echo.
echo This helper will:
echo   1) install/update Node dependencies
echo   2) install Playwright browser runtimes
echo.
echo Note: ffmpeg/system-level audio tooling may still require manual install.
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [RaveLink][ERROR] Node.js is not installed or not on PATH.
  pause
  exit /b 1
)

if not exist "scripts\bootstrap-runtime.js" (
  echo [RaveLink][ERROR] Missing script: scripts\bootstrap-runtime.js
  pause
  exit /b 1
)

echo [RaveLink] Step 1/2: bootstrap Node dependencies...
node scripts\bootstrap-runtime.js --force-install
if errorlevel 1 (
  echo [RaveLink][ERROR] Dependency bootstrap failed.
  pause
  exit /b 1
)

echo.
echo [RaveLink] Step 2/2: install Playwright browser runtimes...
call npx playwright install
if errorlevel 1 (
  echo [RaveLink][WARN] Playwright browser install failed.
  echo [RaveLink][WARN] You can retry manually with: npx playwright install
  echo.
  pause
  exit /b 1
)

echo.
echo [RaveLink] Optional runtime tools bootstrap completed.
pause
exit /b 0
