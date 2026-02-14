#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v npm >/dev/null 2>&1; then
  echo "[RaveLink][ERROR] npm is not available in PATH."
  echo "Install Node.js LTS from https://nodejs.org and run again."
  exit 1
fi

if [ ! -f "package.json" ]; then
  echo "[RaveLink][ERROR] package.json not found in this folder."
  exit 1
fi

npm run stop
