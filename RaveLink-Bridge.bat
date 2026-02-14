@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo [RaveLink] Starting launcher in "%CD%"

where node >nul 2>&1
if errorlevel 1 (
  echo [RaveLink][ERROR] Node.js is not installed or not in PATH.
  echo Install Node.js LTS from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)

set "NPM_BIN="
where npm.cmd >nul 2>&1
if not errorlevel 1 set "NPM_BIN=npm.cmd"
if not defined NPM_BIN (
  where npm >nul 2>&1
  if not errorlevel 1 set "NPM_BIN=npm"
)
if not defined NPM_BIN (
  echo [RaveLink][ERROR] npm is not available in PATH.
  echo Reinstall Node.js LTS from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)

if not exist "package.json" (
  echo [RaveLink][ERROR] package.json not found in this folder.
  echo Open this launcher from the project folder root.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\\express\\package.json" (
  echo [RaveLink] First run or dependencies missing. Installing packages...
  call %NPM_BIN% install
  if errorlevel 1 (
    echo [RaveLink][ERROR] npm install failed.
    echo.
    pause
    exit /b 1
  )
)

set "HUE_CERT=%CD%\node_modules\hue-sync\signify.pem"
if not defined NODE_EXTRA_CA_CERTS if exist "%HUE_CERT%" (
  set "NODE_EXTRA_CA_CERTS=%HUE_CERT%"
)

echo [RaveLink] Bridge URL: http://127.0.0.1:5050
echo [RaveLink] Press Ctrl+C in this window to stop the bridge.
echo.
call %NPM_BIN% start
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [RaveLink] Bridge exited with code %EXIT_CODE%.
)

echo.
pause
exit /b %EXIT_CODE%
