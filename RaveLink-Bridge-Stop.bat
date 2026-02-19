@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [RaveLink][ERROR] Node.js is not installed or not in PATH.
  echo Install Node.js LTS from https://nodejs.org and run again.
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

if not exist "package.json" (
  echo [RaveLink][ERROR] package.json not found in this folder.
  echo.
  pause
  exit /b 1
)

if exist "scripts\stop-bridge.js" (
  node scripts\stop-bridge.js
) else (
  if not defined NPM_BIN (
    echo [RaveLink][ERROR] npm is not available in PATH.
    echo Install Node.js LTS from https://nodejs.org and run again.
    echo.
    pause
    exit /b 1
  )
  call %NPM_BIN% run stop
)
echo.
pause
