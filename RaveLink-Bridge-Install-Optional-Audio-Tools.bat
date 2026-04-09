@echo off
setlocal EnableExtensions EnableDelayedExpansion
REM [TITLE] Script: RaveLink-Bridge-Install-Optional-Audio-Tools.bat
REM [TITLE] Purpose: local helper to bootstrap optional runtime dependencies used by audio + mod lanes
REM [TITLE] Functionality Index:
REM [TITLE] - verifies packaged dependencies or bootstraps local ones when needed
REM [TITLE] - installs Playwright browser runtimes used by mod browser-driver integrations
REM [TITLE] - leaves shell open with clear diagnostics on failure

cd /d "%~dp0"

echo [RaveLink] Optional runtime tools bootstrap
echo.
echo This helper will:
echo   1) verify packaged Node dependencies ^(or bootstrap local ones if needed^)
echo   2) install Playwright browser runtimes into your user profile
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

echo [RaveLink] Step 1/2: verify runtime dependencies...
node scripts\bootstrap-runtime.js
if errorlevel 1 (
  echo [RaveLink][ERROR] Runtime dependency check/bootstrap failed.
  pause
  exit /b 1
)

if not defined PLAYWRIGHT_BROWSERS_PATH (
  if defined LOCALAPPDATA (
    set "PLAYWRIGHT_BROWSERS_PATH=%LOCALAPPDATA%\RaveLink Bridge\playwright-browsers"
  )
)

echo.
echo [RaveLink] Step 2/2: install Playwright browser runtimes...
if defined PLAYWRIGHT_BROWSERS_PATH (
  echo [RaveLink] Playwright browser path: %PLAYWRIGHT_BROWSERS_PATH%
)
call npx playwright install chromium firefox
if errorlevel 1 (
  echo [RaveLink][WARN] Playwright browser install failed.
  echo [RaveLink][WARN] You can retry manually with: npx playwright install chromium firefox
  echo.
  pause
  exit /b 1
)

echo.
echo [RaveLink] Optional runtime tools bootstrap completed.
pause
exit /b 0
