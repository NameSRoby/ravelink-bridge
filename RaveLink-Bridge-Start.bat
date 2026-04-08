@echo off
setlocal EnableExtensions DisableDelayedExpansion
call :main %*
exit /b %ERRORLEVEL%

:main
cd /d "%~dp0"
call :initAnsiColors
title RaveLink Bridge :: Launcher

if not exist "runtime\logs" mkdir "runtime\logs" >nul 2>&1
set "START_LOG=runtime\logs\startup-latest.log"
> "%START_LOG%" (
  echo ============================================================
  echo [RaveLink] launcher boot timestamp: %date% %time%
  echo [RaveLink] cwd: %CD%
  echo [RaveLink] args: %*
)

where node >nul 2>&1
if errorlevel 1 (
  call :printLine "%C_ERR%" "[STARTUP] Node.js is not installed or not on PATH."
  call :printLine "%C_WARN%" "[STARTUP] Install Node.js LTS, then run this launcher again."
  >> "%START_LOG%" echo [STARTUP] failure: node_missing
  call :maybePause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  call :printLine "%C_ERR%" "[STARTUP] npm is not available on PATH."
  call :printLine "%C_WARN%" "[STARTUP] Reinstall Node.js LTS with npm included, then relaunch."
  >> "%START_LOG%" echo [STARTUP] failure: npm_missing
  call :maybePause
  exit /b 1
)

if not exist "scripts\bootstrap-runtime.js" (
  call :printLine "%C_ERR%" "[STARTUP] Missing bootstrap script: scripts\bootstrap-runtime.js"
  >> "%START_LOG%" echo [STARTUP] failure: bootstrap_script_missing
  call :maybePause
  exit /b 1
)

if not exist "src\app\index.js" (
  call :printLine "%C_ERR%" "[STARTUP] Missing server entrypoint: src\app\index.js"
  >> "%START_LOG%" echo [STARTUP] failure: app_entrypoint_missing
  call :maybePause
  exit /b 1
)

set "BRIDGE_HOST=%HOST%"
if not defined BRIDGE_HOST set "BRIDGE_HOST=127.0.0.1"
set "BRIDGE_PORT=%PORT%"
if not defined BRIDGE_PORT set "BRIDGE_PORT=5050"
set "BRIDGE_URL=http://%BRIDGE_HOST%:%BRIDGE_PORT%"
if not defined RAVELINK_INTERACTIVE_PAUSE set "RAVELINK_INTERACTIVE_PAUSE=0"
if not defined RAVELINK_USE_BROWSER_HELPER set "RAVELINK_USE_BROWSER_HELPER=0"
if not defined RAVELINK_SIMPLE_BROWSER_OPEN set "RAVELINK_SIMPLE_BROWSER_OPEN=0"
if not defined RAVELINK_FORCE_AUTO_BROWSER set "RAVELINK_FORCE_AUTO_BROWSER=1"

if not defined NODE_OPTIONS (
  set "NODE_OPTIONS=--use-system-ca"
) else (
  echo %NODE_OPTIONS% | findstr /I /C:"--use-system-ca" >nul
  if errorlevel 1 set "NODE_OPTIONS=%NODE_OPTIONS% --use-system-ca"
)

if not defined NODE_EXTRA_CA_CERTS (
  if exist "node_modules\hue-sync\signify.pem" set "NODE_EXTRA_CA_CERTS=%CD%\node_modules\hue-sync\signify.pem"
)

call :detectInstallOnly %*

echo %C_BOX%========================================================================================%C_RESET%
call :printLine "%C_TITLE%" " RAVELINK BRIDGE :: LAUNCHER"
call :printLine "%C_BOX%" "----------------------------------------------------------------------------------------"
call :printLine "%C_DIM%" " Session"
call :printLine "%C_INFO%" " [LAUNCHER] Workspace      : %CD%"
call :printLine "%C_INFO%" " [LAUNCHER] Bridge URL     : %BRIDGE_URL%"
call :printLine "%C_INFO%" " [LAUNCHER] Startup Log    : %START_LOG%"
echo %C_INFO% [LAUNCHER] Close Shortcut : press Ctrl and C once to stop the bridge%C_RESET%
echo(

>> "%START_LOG%" echo [STARTUP] node_options=%NODE_OPTIONS%
>> "%START_LOG%" echo [STARTUP] node_extra_ca_certs=%NODE_EXTRA_CA_CERTS%

node scripts\bootstrap-runtime.js %* >> "%START_LOG%" 2>&1
if errorlevel 1 (
  call :printLine "%C_ERR%" "[STARTUP] Dependency bootstrap failed."
  call :printLine "%C_WARN%" "[STARTUP] See %START_LOG% for details."
  type "%START_LOG%"
  call :maybePause
  exit /b 1
)

if "%INSTALL_ONLY%"=="1" (
  call :printLine "%C_OK%" "[STARTUP] Install-only mode complete."
  exit /b 0
)

call :resolvePortListener "%BRIDGE_PORT%" PORT_PID PORT_PROC
if defined PORT_PID (
  call :handlePortConflict
  if errorlevel 1 exit /b 1
)

call :configureBrowserOwnership
if errorlevel 1 exit /b 1

echo(
call :printLine "%C_INFO%" "[LAUNCHER] Starting bridge runtime..."
if /I "%RAVELINK_INTERACTIVE_PAUSE%"=="1" (
  call :printLine "%C_DIM%" "[LAUNCHER] Exit behavior: pause enabled via RAVELINK_INTERACTIVE_PAUSE=1."
) else (
  call :printLine "%C_DIM%" "[LAUNCHER] Exit behavior: auto-close on process exit."
)
echo(

node src\app\index.js
set "EXIT_CODE=%ERRORLEVEL%"
if "%EXIT_CODE%"=="-1073741510" (
  echo(
  call :printLine "%C_WARN%" "[LAUNCHER] Bridge interrupted by Ctrl+C."
  exit /b 0
)

echo(
if "%EXIT_CODE%"=="0" (
  call :printLine "%C_OK%" "[LAUNCHER] Bridge process exited cleanly with code=%EXIT_CODE%."
) else (
  call :printLine "%C_ERR%" "[LAUNCHER] Bridge process exited with code=%EXIT_CODE%."
)
call :maybePause
exit /b %EXIT_CODE%

:detectInstallOnly
set "INSTALL_ONLY=0"
if "%~1"=="" goto :eof
:detectInstallOnlyLoop
if "%~1"=="" goto :eof
if /I "%~1"=="--install-only" set "INSTALL_ONLY=1"
shift
goto detectInstallOnlyLoop

:resolvePortListener
setlocal DisableDelayedExpansion
set "_listenPort=%~1"
set "_listenPid="
set "_listenProc="
for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr /R /C:":%_listenPort% .*LISTENING"') do if not defined _listenPid set "_listenPid=%%P"
if defined _listenPid (
  for /f "usebackq tokens=1 delims=," %%N in (`tasklist /FI "PID eq %_listenPid%" /FO CSV /NH`) do if not defined _listenProc set "_listenProc=%%~N"
)
if not defined _listenProc set "_listenProc=unknown"
set "_listenProc=%_listenProc:"=%"
if /I "%_listenProc:~0,5%"=="INFO:" set "_listenProc=unknown"
endlocal & set "%~2=%_listenPid%" & set "%~3=%_listenProc%"
goto :eof

:handlePortConflict
call :printLine "%C_WARN%" "[STARTUP] Detected existing listener on %BRIDGE_HOST%:%BRIDGE_PORT% with PID=%PORT_PID%, process=%PORT_PROC%."
>> "%START_LOG%" echo [STARTUP] existing_listener pid=%PORT_PID% process=%PORT_PROC%
call :printLine "%C_WARN%" "[STARTUP] Attempting graceful stop via /system/stop..."
if exist "%~dp0RaveLink-Bridge-Stop.bat" call "%~dp0RaveLink-Bridge-Stop.bat" >nul 2>&1
timeout /t 1 /nobreak >nul

call :resolvePortListener "%BRIDGE_PORT%" PORT_PID_CHECK PORT_PROC_CHECK
if not defined PORT_PID_CHECK goto :eof

if /I "%PORT_PROC_CHECK%"=="node.exe" (
  call :printLine "%C_WARN%" "[STARTUP] Attempting force-stop of stale Node listener with PID=%PORT_PID_CHECK%."
  >> "%START_LOG%" echo [STARTUP] stale_listener_force_stop_attempt pid=%PORT_PID_CHECK% process=%PORT_PROC_CHECK%
  taskkill /PID %PORT_PID_CHECK% /T /F >nul 2>&1
  timeout /t 1 /nobreak >nul
  call :resolvePortListener "%BRIDGE_PORT%" PORT_PID_FORCE_CHECK PORT_PROC_FORCE_CHECK
  if not defined PORT_PID_FORCE_CHECK (
    call :printLine "%C_OK%" "[STARTUP] Cleared stale Node listener from port %BRIDGE_PORT%."
    >> "%START_LOG%" echo [STARTUP] stale_listener_cleared_by_force_stop pid=%PORT_PID_CHECK%
    goto :eof
  )
  call :printLine "%C_ERR%" "[STARTUP] Port %BRIDGE_PORT% is still occupied after force-stop with PID=%PORT_PID_FORCE_CHECK%, process=%PORT_PROC_FORCE_CHECK%."
  call :printLine "%C_WARN%" "[STARTUP] Close that process manually or change PORT, then relaunch."
  >> "%START_LOG%" echo [STARTUP] failure: listener_port_still_occupied_after_force_stop pid=%PORT_PID_FORCE_CHECK% process=%PORT_PROC_FORCE_CHECK%
  call :maybePause
  exit /b 1
)

call :printLine "%C_ERR%" "[STARTUP] Port %BRIDGE_PORT% is still occupied with PID=%PORT_PID_CHECK%, process=%PORT_PROC_CHECK%."
call :printLine "%C_WARN%" "[STARTUP] Close that process manually or change PORT, then relaunch."
>> "%START_LOG%" echo [STARTUP] failure: listener_port_still_occupied_after_graceful_stop pid=%PORT_PID_CHECK% process=%PORT_PROC_CHECK%
call :maybePause
exit /b 1

:configureBrowserOwnership
if /I "%RAVELINK_DISABLE_AUTO_BROWSER%"=="1" exit /b 0

if /I "%RAVELINK_SIMPLE_BROWSER_OPEN%"=="1" (
  call :scheduleSimpleBrowserOpen
  set "RAVELINK_DISABLE_AUTO_BROWSER=1"
  call :printLine "%C_OK%" "[STARTUP] Browser open scheduled: default browser in simple-launcher mode."
  call :printLine "%C_WARN%" "[STARTUP] Auto browser in server: disabled for simple-launcher mode."
  call :printLine "%C_INFO%" "[STARTUP] Browser target: %BRIDGE_URL%"
  >> "%START_LOG%" echo [STARTUP] browser_simple_open_scheduled url=%BRIDGE_URL%
  >> "%START_LOG%" echo [STARTUP] server_auto_browser_disabled_for_simple_mode=1
  exit /b 0
)

if /I "%RAVELINK_USE_BROWSER_HELPER%"=="1" (
  if exist "scripts\launcher-open-browser.js" (
    call :armBrowserHelper
    set "RAVELINK_DISABLE_AUTO_BROWSER=1"
    call :printLine "%C_OK%" "[STARTUP] Browser helper armed: launcher owns readiness launch."
    call :printLine "%C_WARN%" "[STARTUP] Auto browser in server: disabled for launcher session."
    call :printLine "%C_INFO%" "[STARTUP] Browser helper target: %BRIDGE_URL%"
    >> "%START_LOG%" echo [STARTUP] browser_helper_armed url=%BRIDGE_URL%
    >> "%START_LOG%" echo [STARTUP] server_auto_browser_disabled_for_launcher=1
    exit /b 0
  )

  call :printLine "%C_WARN%" "[STARTUP] Browser helper missing at scripts\launcher-open-browser.js."
  call :printLine "%C_WARN%" "[STARTUP] Server auto-launch remains active."
  >> "%START_LOG%" echo [STARTUP] browser_helper_missing
  exit /b 0
)

call :printLine "%C_OK%" "[STARTUP] Browser auto-launch owned by server in legacy mode."
>> "%START_LOG%" echo [STARTUP] server_auto_browser_enabled=1 helper_opt_in=%RAVELINK_USE_BROWSER_HELPER% simple_opt_in=%RAVELINK_SIMPLE_BROWSER_OPEN%
exit /b 0

:scheduleSimpleBrowserOpen
start "" /b cmd /d /c "ping -n 3 127.0.0.1 >nul ^& explorer %BRIDGE_URL%" >nul 2>&1
goto :eof

:armBrowserHelper
start "" /b node "scripts\launcher-open-browser.js" --url "%BRIDGE_URL%" --probe-path "/health" --diagnostics-path "/system/launcher-diagnostics" --attempts 120 --delay-ms 350 --grace-delay-ms 2200 --log-path "runtime\logs\launcher-browser-open.log" >nul 2>&1
goto :eof

:initAnsiColors
set "RAVELINK_COLOR=1"
if defined RAVELINK_NO_COLOR set "RAVELINK_COLOR=0"
for /f %%E in ('echo prompt $E^| cmd') do set "ESC=%%E"
if not defined ESC set "RAVELINK_COLOR=0"
if "%RAVELINK_COLOR%"=="1" (
  set "C_RESET=%ESC%[0m"
  set "C_TITLE=%ESC%[1;38;5;51m"
  set "C_BOX=%ESC%[38;5;39m"
  set "C_INFO=%ESC%[38;5;117m"
  set "C_OK=%ESC%[38;5;83m"
  set "C_WARN=%ESC%[38;5;220m"
  set "C_ERR=%ESC%[1;38;5;203m"
  set "C_DIM=%ESC%[38;5;245m"
  goto :eof
)
set "C_RESET="
set "C_TITLE="
set "C_BOX="
set "C_INFO="
set "C_OK="
set "C_WARN="
set "C_ERR="
set "C_DIM="
goto :eof

:printLine
setlocal DisableDelayedExpansion
set "_color=%~1"
set "_text=%~2"
if "%~2"=="" (
  echo(
  endlocal
  goto :eof
)
if "%RAVELINK_COLOR%"=="1" (
  <nul set /p "=%_color%%_text%"
  echo(%C_RESET%
) else (
  echo(%_text%
)
endlocal
goto :eof

:maybePause
if /I "%RAVELINK_INTERACTIVE_PAUSE%"=="1" (
  call :printLine "%C_DIM%" "[LAUNCHER] Press any key to close this window."
  pause
)
goto :eof
