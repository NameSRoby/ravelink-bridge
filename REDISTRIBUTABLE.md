# RaveLink Bridge Redistributable Notes

This file mirrors high-level usage guidance for packaged/source redistribution.
Release note: `v1.5.0` continues the v1.4.2 behavior baseline with hardened startup/bootstrap flow.

Primary docs:
- `README.md` (full setup + runtime usage)
- `CHANGELOG.md` (update log for this shipped state)

## Beginner Install Guide (Windows)

1. Download the release zip:
- `RaveLink-Bridge-Windows-v1.5.0.zip`
2. Extract the zip to a normal folder (for example `Desktop\RaveLink-Bridge`).
3. Install Node.js LTS from:
- `https://nodejs.org`
4. Open the extracted folder and double-click:
- `RaveLink-Bridge.bat`
5. First launch on a new system runs a full dependency bootstrap automatically, then starts the bridge.
6. Wait for the console to show the URL:
- `http://127.0.0.1:5050`
7. If browser does not open, open that URL manually.
8. Stop safely when done:
- `RaveLink-Bridge-Stop.bat`
- or `Ctrl+C` in the running terminal window
9. Fallback only if auto-install fails:
- open terminal in that folder and run `npm install`, then run `RaveLink-Bridge.bat` again

## CPU Compatibility Note

- Python wheels tagged `win_amd64` target the Windows x86_64 ABI.
- This is architecture naming, not vendor lock.
- They run on both AMD and Intel 64-bit CPUs.

## Startup Dependency Bootstrap

- On first launch on a new system, the launcher preflight runs full dependency bootstrap:
- Node dependency tree (`npm install`, including optional deps).
- Windows audio helper dependencies for app/process loopback workflows:
  - `ffmpeg`
  - `Python 3.13`
  - Python packages: `proc-tap`, `psutil`
- Dependency manifest changes (`package.json` / `package-lock.json`) trigger re-bootstrap automatically.

## Quick Launch

- Windows:
  - `RaveLink-Bridge.bat`
  - Stop with `RaveLink-Bridge-Stop.bat`
- Linux/macOS source run (experimental):
  - `bash RaveLink-Bridge.sh`
  - Stop with `bash RaveLink-Bridge-Stop.sh`

Open UI at:
- `http://127.0.0.1:5050`
