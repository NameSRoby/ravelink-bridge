@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo [RaveLink] Optional audio tools bootstrap
echo.
echo This installs optional Windows dependencies used by app/process-isolation audio capture:
echo   - ffmpeg
echo   - Python 3.13
echo   - proc-tap + psutil
echo.
echo It may use internet access and winget.
echo.

set "NODE_BIN="
set "LOCAL_NODE=%CD%\runtime\node.exe"
if exist "%LOCAL_NODE%" (
  set "NODE_BIN=%LOCAL_NODE%"
) else (
  where node >nul 2>&1
  if not errorlevel 1 set "NODE_BIN=node"
)

if not defined NODE_BIN (
  echo [RaveLink][ERROR] Node runtime not found.
  echo Expected bundled runtime: runtime\node.exe
  echo Or install Node.js LTS from https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not exist "scripts\start-bridge.js" (
  echo [RaveLink][ERROR] scripts\start-bridge.js not found.
  echo.
  pause
  exit /b 1
)

set "RAVELINK_BOOTSTRAP_DEPS=1"
set "RAVELINK_BOOTSTRAP_SYSTEM_DEPS=1"
set "RAVELINK_BOOTSTRAP_ONLY=1"

"%NODE_BIN%" scripts\start-bridge.js
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if "%EXIT_CODE%"=="0" (
  echo [RaveLink] Optional audio tools bootstrap completed.
) else (
  echo [RaveLink][WARN] Optional bootstrap exited with code %EXIT_CODE%.
)
echo.
pause
exit /b %EXIT_CODE%
