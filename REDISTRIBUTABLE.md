# RaveLink Bridge Redistributable Notes

This file mirrors high-level usage guidance for packaged/source redistribution.
Release note: `v1.5.1` continues the v1.5 baseline with additional security hardening and reactivity polish.

Primary docs:
- `README.md` (full setup + runtime usage)
- `CHANGELOG.md` (update log for this shipped state)

## Beginner Install Guide (Windows)

1. Preferred when available, run installer:
- `RaveLink-Bridge-Windows-v1.5.1-setup-installer.exe`
2. ZIP fallback:
- Prefer `RaveLink-Bridge-Windows-v1.5.1-self-contained.zip` (no preinstalled Node required)
- Legacy/minimal package: `RaveLink-Bridge-Windows-v1.5.1.zip`
- Extract to a normal folder (for example `Desktop\RaveLink-Bridge`)
- Double-click `RaveLink-Bridge.bat`
3. Wait for the console to show the URL:
- `http://127.0.0.1:5050`
4. If browser does not open, open that URL manually.
5. Stop safely when done:
- `RaveLink-Bridge-Stop.bat`
- or `Ctrl+C` in the running terminal window
6. ZIP-only fallback if dependencies are missing:
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
- Build Windows installer from source:
  - `npm run build:setup:windows`
- Linux/macOS source run (experimental):
  - `bash RaveLink-Bridge.sh`
  - Stop with `bash RaveLink-Bridge-Stop.sh`

Open UI at:
- `http://127.0.0.1:5050`
