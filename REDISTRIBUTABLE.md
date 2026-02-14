# RaveLink Bridge Redistributable Notes

This file mirrors high-level usage guidance for packaged/source redistribution.
Release note: `v1.4.2` is a behavior + stability hotfix update (no installation workflow changes).

Primary docs:
- `README.md` (full setup + runtime usage)
- `CHANGELOG.md` (update log for this shipped state)

## Beginner Install Guide (Windows)

1. Download the release zip:
- `RaveLink-Bridge-Windows-v1.4.2.zip`
2. Extract the zip to a normal folder (for example `Desktop\RaveLink-Bridge`).
3. Install Node.js LTS from:
- `https://nodejs.org`
4. Open the extracted folder and double-click:
- `RaveLink-Bridge.bat`
5. First launch auto-installs dependencies if missing, then starts the bridge.
6. Wait for the console to show the URL:
- `http://127.0.0.1:5050`
7. If browser does not open, open that URL manually.
8. Stop safely when done:
- `RaveLink-Bridge-Stop.bat`
- or `Ctrl+C` in the running terminal window
9. Fallback only if auto-install fails:
- open terminal in that folder and run `npm install`, then run `RaveLink-Bridge.bat` again

## Quick Launch

- Windows:
  - `RaveLink-Bridge.bat`
  - Stop with `RaveLink-Bridge-Stop.bat`
- Linux/macOS source run (experimental):
  - `bash RaveLink-Bridge.sh`
  - Stop with `bash RaveLink-Bridge-Stop.sh`

Open UI at:
- `http://127.0.0.1:5050`
