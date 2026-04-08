# RaveLink Bridge v1.6.2

This repository contains the public source for the current RaveLink Bridge server release.

It intentionally keeps the core server, UI, scripts, and deep repository documentation, while excluding local runtime state and local-only mods.

## Current Status

- New domain-first structure is in place.
- First production slice is implemented:
  - Twitch color prefixes (brand + per-fixture)
  - `/teach` color learning with persistence + duplicate-safe refund signal
  - `/color` parsing with fuzzy typo handling and Hue/WiZ payload translation
  - Audio telemetry baseline:
    - `GET /audio/status`
    - `GET /audio/telemetry`
    - `POST /audio/telemetry`
    - Audio compatibility/config routes:
      - `GET/POST /audio/config`
      - `GET /audio/devices`
      - `GET /audio/apps`
      - `GET /audio/profiles`
      - `GET/POST /audio/reactivity-map`
      - `GET /audio/ffmpeg/app-isolation/locks`
      - `POST /audio/ffmpeg/app-isolation/*`
  - Engine v2 skeleton baseline:
    - `GET /engine/v2/status`
    - `GET /engine/v2/palette`
    - `POST /engine/v2/start`
    - `POST /engine/v2/stop`
    - `POST /engine/v2/tick`
    - `POST /engine/v2/palette/custom-color`
    - `POST /engine/v2/palette/sequence`
    - `POST /engine/v2/palette/cycle`
    - `POST /engine/v2/palette/advance`
  - UI compatibility route baseline:
    - MIDI contract routes (`/midi/*`) now return deterministic compatibility snapshots
    - Mods contract routes (`/mods/*`, `/mods/ui/catalog`, `/mods/runtime`, `/mods/hooks`)
    - LIVE compatibility routes (`/rave/live/compatibility`, `/rave/live/trigger-matrix`)
    - Rave palette/fixture metrics routes (`/rave/palette`, `/rave/fixture-metrics`, `/rave/fixture-routing/clear`)
    - Overclock and probe compatibility routes (`/rave/overclock/*`, `/fixtures/*`, `/system/config`)
    - Core diagnostics routes (`/system/startup-readiness`, `/system/core-status`, `/system/launcher-diagnostics`)
  - `/rave/on`, `/rave/off`, and `/rave/status` compatibility routes now use telemetry-port rave state (no transferred engine runtime)
  - Live profile storage endpoints (`save/load/delete`) with Live tab in `full` mode
  - Frontend LIVE tab now defaults to a core-first surface (colors/scenes/auto-hz/brightness), with quick-jump buttons and core sections visible at load while non-core sections stay hidden by default
  - UI shell refactor:
    - Visual design preserved
    - `public/index.html` no longer holds the monolithic page source
    - `/` and `/index.html` are composed from modular section templates
- Local runtime state, logs, vaults, and caches are intentionally excluded from source control.
- The current song-request mod is intentionally not included in this repository or the packaged public release.

## Start From Source

```bash
npm install
npm start
```

Windows fast-start launcher:

```bat
RaveLink-Bridge-Start.bat
```

What it does:
- First boot: installs dependencies automatically.
- Next boots: skips install on fast path unless lockfile changed.
- Launches server directly via `node src/app/index.js` for low startup overhead.
- Runs startup preflight checks (`node`, `npm`, required script/entrypoint files) before boot.
- Attempts stale-port recovery when an older bridge listener is holding bridge port.
- Refuses force-kill when the port holder is not this bridge process.
- Pauses after bridge process exit so diagnostics stay visible.
- Sets launcher browser-open policy defaults (`RAVELINK_FORCE_AUTO_BROWSER=1`), while helper-owned launch disables server-side auto-open for that session.
- Arms launcher-side readiness helper (`scripts/launcher-open-browser.js`) that:
  - disables server-side auto-browser open for launcher session and owns browser-open flow
  - waits for `/health`
  - checks `/system/launcher-diagnostics`
  - opens the bridge URL via default browser deterministically
  - writes helper logs to `runtime/logs/launcher-browser-open.log`

Useful flags:
- `RaveLink-Bridge-Start.bat --install-only` (install/check deps without starting server)
- `RaveLink-Bridge-Start.bat --force-install` (force reinstall dependencies)
- `RaveLink-Bridge-Start.bat --skip-install` (skip bootstrap and launch immediately)

Graceful local stop helper:

```bat
RaveLink-Bridge-Stop.bat
```

Browser auto-launch notes:
- Server startup (`npm start`) uses OS-native default-browser launchers.
- Windows uses fallback launch sequence (`cmd start` -> `PowerShell Start-Process` -> `rundll32`) for stronger reliability.
- You can suppress launcher/browser auto-open by setting `RAVELINK_DISABLE_AUTO_BROWSER=1`.
- Sibling-repo rust tool lookup is disabled by default; set `RAVELINK_ALLOW_SIBLING_REPO_TOOLS=1` to re-enable legacy sibling fallback behavior.

Bridge URL defaults to:

`http://127.0.0.1:5050`

## Package Public Release

Create the public Windows release zip with runtime dependencies included:

```bash
npm run package:release
```

This builds:

`dist/RaveLink-Bridge-v1.6.2.zip`

Release package rules:

- includes the runnable app plus `node_modules`
- excludes local runtime state and logs
- excludes the local song-request mod
- ships an empty `mods/` folder so optional local mods can still be added later

## Test

```bash
npm test
```

## Pre-Engine Gates

```bash
npm run verify:architecture
npm run verify:security
npm run verify:audit
npm run verify:readiness
```

Lock baseline snapshot:

```bash
npm run baseline:lock
```

## Documentation

See:

- `docs/repo-documentation/README.md` (complete repository documentation)
- `THIRD_PARTY_NOTICES.md`
