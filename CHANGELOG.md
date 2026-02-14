# Changelog

## v1.4.1 - Final Ship (2026-02-13)

### Security
- Completed multi-pass security hardening sweep for server routes, fixture/runtime handling, and log redaction.
- Kept TLS certificate validation enforced for Hue transport paths.
- Added/kept strict sensitive-log redaction defaults with explicit unsafe dev opt-in only.

### Stability + Bug Fixes
- Fixed fixture/runtime behaviors that could cause stale or missing UI state.
- Stabilized Hue Entertainment start/recovery fallback with bounded retries and safer area selection behavior.
- Added scheduler heartbeat refresh guards to prevent long static stalls when deltas remain small.
- Improved REST mode behavior under sustained playback so output stays active instead of freezing.

### Reactivity + Latency
- Added hardware-safe rate caps (default ON) with explicit override path.
- Tuned Hue REST transition handling and adaptive interval behavior for lower perceived latency while keeping safety limits.
- Kept per-brand audio reactivity mapping and smart compatibility policy flow.

### Platform + Startup
- Added Linux/macOS shell launchers for source bring-up:
  - `RaveLink-Bridge.sh`
  - `RaveLink-Bridge-Stop.sh`
- Updated Windows launchers for better npm command compatibility:
  - `RaveLink-Bridge.bat`
  - `RaveLink-Bridge-Stop.bat`
- Hardened browser auto-open behavior so missing opener tools do not crash startup.

### UI + Docs
- Forced UI cache/state reset on first load of this release via migration target bump.
- Updated README and platform marker text to reflect current release behavior and launcher options.
- Expanded developer documentation for current runtime/security workflow.

## Download And Use

1. Open releases:
   - `https://github.com/NameSRoby/ravelink-bridge/releases`
2. Download the latest `RaveLink-Bridge-Windows-v1.4.1.zip`.
3. Extract the zip.
4. Install dependencies if needed:
   - `npm install`
5. Start:
   - Windows: double-click `RaveLink-Bridge.bat`
   - Linux/macOS (source run): `bash RaveLink-Bridge.sh`
6. Open:
   - `http://127.0.0.1:5050`
7. Stop:
   - Windows: `RaveLink-Bridge-Stop.bat`
   - Linux/macOS: `bash RaveLink-Bridge-Stop.sh`
   - Or `Ctrl+C` in the running terminal.
