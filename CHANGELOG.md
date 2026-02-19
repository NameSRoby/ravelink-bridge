# Changelog

## v1.5.0 - Sanitized Baseline + Startup Bootstrap (2026-02-19)

### Startup Bootstrap
- Added first-launch dependency bootstrap state tracking for new systems.
- Startup now performs full dependency sync on first launch (and when dependency manifests change).
- Added Windows dependency preflight checks/install attempts for `ffmpeg`, `Python 3.13`, `proc-tap`, and `psutil`.

### Security + Hygiene
- Expanded sanitization workflow to reset runtime configs, wipe local runtime artifacts, and remove archived sensitive backups.
- Added full-template resets for fixture/audio/reactivity/system/palette/metric runtime JSON config files.
- Sanitization now also covers `.pushrepo` mirror content.

### UI + Docs
- Bumped UI storage migration target to force a clean browser memory baseline for this release.
- Re-bumped UI storage migration target for the reissued `v1.5` package so previously installed `v1.5` clients get a one-time UI memory wipe again.
- Updated onboarding flow text/steps to current priority controls and fixture palette/metric routing workflow.
- Updated mod developer guide to `v1.4.2-dev` runtime behavior model and endpoint set.

## v1.4.2 - Behavior Tuning + Stability Hotfix (2026-02-14)

### Meta Auto Song Learning
- Meta Auto now learns live song behavior using short-term EMA + decaying peak memory across drive/motion/intensity.
- Aggressive tracks (metal/dnb/techno) now gain sustained-build promotion so overclock/HZ can climb out of 2Hz/4Hz lock when the song ramps.
- Added stability guardrails so low-energy songs still settle into calm low-rate bands.

### Mod Loader + Logging
- Sanitized `onTelemetry` debug payloads so high-churn snapshots no longer dump full telemetry objects to release logs.
- Added telemetry hook debug sampling controls in mod debug runtime config (`telemetryDebugSampleMs`).
- Disabled no-handler `onTelemetry` batch debug spam by default (`telemetryNoHandlerDebugMs=0`).

### UI + State Hygiene
- Bumped UI storage migration target to force a one-time browser UI memory wipe for this hotfix release.

### Notes
- This is a release-stability hotfix focused on log hygiene and runtime noise reduction.

### Behavior Tuning Baseline

### Behavior Tuning
- Added live scene-link controls so WiZ follows Hue scene mode by default with one-click manual desync.
- Exposed generic scene-sync API aliases (`/rave/scene/sync`) for cleaner multi-brand control paths.
- Improved telemetry compatibility with `sceneSync` + `wizSceneSync` state reporting.
- Expanded mod developer diagnostics with sectioned debug events, explanations, high-resolution timing, and `/mods/debug` APIs.
- Added key-protected core unlock flow (`core/.core-lock.key`) with init/status commands for safer lock workflow.

### Hue Entertainment Reliability
- Hardened Entertainment reconnect lifecycle with stronger teardown/preclear/retry flow and optional legacy start fallback.
- Improved timeout handling and diagnostics for repeated DTLS connect timeout cycles.

### UI + State Hygiene
- Bumped UI storage migration target so stale browser UI memory is wiped on first load of this release.
- Added scene-sync status visibility in Live controls.

### Notes
- This release is focused on behavior tuning; install/start workflow is unchanged from v1.4.1.
- Release description now includes a beginner-friendly install guide so first-time users can bootstrap without prior setup knowledge.

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
- Hardened UI memory wipe to sanitize local/session storage plus browser cache storage before reload.
- Updated README and platform marker text to reflect current release behavior and launcher options.
- Expanded developer documentation for current runtime/security workflow.

## Download And Use

1. Open releases:
   - `https://github.com/NameSRoby/ravelink-bridge/releases`
2. Download the latest `RaveLink-Bridge-Windows-v1.5.0.zip`.
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
