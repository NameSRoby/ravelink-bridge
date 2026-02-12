@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo [RaveLink][ERROR] npm is not available in PATH.
  echo Install Node.js LTS from https://nodejs.org and run again.
  echo.
  pause
  exit /b 1
)

if not exist "package.json" (
  echo [RaveLink][ERROR] package.json not found in this folder.
  echo.
  pause
  exit /b 1
)

call npm.cmd run stop
echo.
pause
