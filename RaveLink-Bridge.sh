#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "[RaveLink] Starting launcher in \"$PWD\""

if ! command -v node >/dev/null 2>&1; then
  echo "[RaveLink][ERROR] Node.js is not installed or not in PATH."
  echo "Install Node.js LTS from https://nodejs.org and run this file again."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[RaveLink][ERROR] npm is not available in PATH."
  echo "Reinstall Node.js LTS from https://nodejs.org and run this file again."
  exit 1
fi

if [ ! -f "package.json" ]; then
  echo "[RaveLink][ERROR] package.json not found in this folder."
  echo "Open this launcher from the project folder root."
  exit 1
fi

if [ -z "${NODE_EXTRA_CA_CERTS:-}" ] && [ -f "node_modules/hue-sync/signify.pem" ]; then
  export NODE_EXTRA_CA_CERTS="$PWD/node_modules/hue-sync/signify.pem"
fi

echo "[RaveLink] Bridge URL: http://127.0.0.1:5050"
echo "[RaveLink] Press Ctrl+C in this terminal to stop the bridge."
echo
npm start
