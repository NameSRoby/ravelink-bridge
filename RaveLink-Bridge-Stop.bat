@echo off
setlocal EnableExtensions EnableDelayedExpansion
REM [TITLE] Script: RaveLink-Bridge-Stop.bat
REM [TITLE] Purpose: graceful local bridge shutdown helper for Windows
REM [TITLE] Functionality Index:
REM [TITLE] - resolves host/port defaults used by the bridge launcher
REM [TITLE] - requests /system/stop to trigger deterministic graceful shutdown
REM [TITLE] - falls back between curl and node-fetch transport paths

set "BRIDGE_HOST=%HOST%"
if "%BRIDGE_HOST%"=="" set "BRIDGE_HOST=127.0.0.1"
set "BRIDGE_PORT=%PORT%"
if "%BRIDGE_PORT%"=="" set "BRIDGE_PORT=5050"
set "STOP_URL=http://%BRIDGE_HOST%:%BRIDGE_PORT%/system/stop"

echo [RaveLink] Requesting graceful stop via %STOP_URL%

where curl >nul 2>&1
if not errorlevel 1 (
  curl -sS -X POST "%STOP_URL%" -H "Content-Type: application/json" -d "{}"
  if not errorlevel 1 (
    echo.
    echo [RaveLink] Stop request sent.
    exit /b 0
  )
  echo [STOP] curl stop request failed; trying node fallback...
)

where node >nul 2>&1
if errorlevel 1 (
  echo [STOP] Neither curl nor node is available on PATH.
  exit /b 1
)

node -e "const u=process.argv[1];(async function(){try{const r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const t=await r.text();if(t)process.stdout.write(t);process.exit(r.ok?0:1);}catch(e){console.error('[STOP] request failed: '+(e&&e.message?e.message:String(e)));process.exit(1);}})();" "%STOP_URL%"
if errorlevel 1 (
  echo [STOP] node fallback stop request failed.
  exit /b 1
)

echo.
echo [RaveLink] Stop request sent.
exit /b 0
