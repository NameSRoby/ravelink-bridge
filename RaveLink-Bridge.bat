@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo [RaveLink] Starting launcher in "%CD%"

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

if not exist "package.json" (
  echo [RaveLink][ERROR] package.json not found in this folder.
  echo Open this launcher from the project folder root.
  echo.
  pause
  exit /b 1
)

if exist "distribution.manifest.json" (
  if not defined RAVELINK_BOOTSTRAP_DEPS set "RAVELINK_BOOTSTRAP_DEPS=0"
  if not defined RAVELINK_BOOTSTRAP_SYSTEM_DEPS set "RAVELINK_BOOTSTRAP_SYSTEM_DEPS=0"
  echo [RaveLink] Self-contained distro mode enabled.
)

set "BUNDLED_FFMPEG=%CD%\runtime\tools\ffmpeg\ffmpeg.exe"
if not defined RAVE_AUDIO_FFMPEG_PATH if exist "%BUNDLED_FFMPEG%" (
  set "RAVE_AUDIO_FFMPEG_PATH=%BUNDLED_FFMPEG%"
)

set "HUE_CERT=%CD%\node_modules\hue-sync\signify.pem"
if not defined NODE_EXTRA_CA_CERTS if exist "%HUE_CERT%" (
  set "NODE_EXTRA_CA_CERTS=%HUE_CERT%"
)

echo [RaveLink] Bridge URL: http://127.0.0.1:5050
echo [RaveLink] Press Ctrl+C in this window to stop the bridge.
echo.
if exist "scripts\start-bridge.js" (
  "%NODE_BIN%" scripts\start-bridge.js
) else (
  set "LOCAL_NPM_CLI=%CD%\runtime\node_modules\npm\bin\npm-cli.js"
  if exist "%LOCAL_NPM_CLI%" (
    "%NODE_BIN%" "%LOCAL_NPM_CLI%" start
  ) else (
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
    call %NPM_BIN% start
  )
)
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [RaveLink] Bridge exited with code %EXIT_CODE%.
)

echo.
pause
exit /b %EXIT_CODE%
