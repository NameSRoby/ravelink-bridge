# Developer Guide

This guide is for contributors building features, transports, integrations, or mods on the current RaveLink Bridge runtime.

## Platform And Runtime

- Official packaged target: Windows 10/11 x64
- Runtime: Node.js (CommonJS) + Express
- UI: single-page app served from `public/index.html`
- Default local URL: `http://127.0.0.1:5050`
- Experimental source startup path is available on Linux/macOS via `RaveLink-Bridge.sh`

## Startup Entry Points

- Windows launcher:
  - `RaveLink-Bridge.bat`
  - stop via `RaveLink-Bridge-Stop.bat`
- Linux/macOS source launcher (experimental):
  - `RaveLink-Bridge.sh`
  - stop via `RaveLink-Bridge-Stop.sh`
- NPM entry points:
  - `npm start`
  - `npm run stop`

## Security Model (v1.4.1)

Runtime defaults are now local-first with hardened boundaries:

- Mutating routes are loopback-only unless `RAVELINK_ALLOW_REMOTE_WRITE=1`.
- Privileged read routes are loopback-only unless `RAVELINK_ALLOW_REMOTE_PRIVILEGED_READ=1`.
- Legacy mutating GET compatibility routes are disabled unless `RAVELINK_ALLOW_LEGACY_MUTATING_GET=1`.
- Hue Entertainment HTTPS path keeps TLS verification enabled.
- Sensitive runtime logs are redacted by default.

Dangerous developer override:

- `unsafeExposeSensitiveLogs` requires explicit ack phrase:
  - `I_UNDERSTAND_SENSITIVE_LOG_RISK`

Use this only for short-lived troubleshooting and disable immediately after.

## Project Layout

- `server.js`: runtime bootstrap, endpoint surface, orchestration
- `core/rave-engine.js`: audio-driven intent engine
- `core/audio.js`: input devices, telemetry, restartable audio stream
- `core/fixtures.js`: fixture model, validation, route derivation
- `core/hue-scheduler.js`: Hue send gating
- `core/hue-entertainment.js`: Hue Entertainment transport
- `core/wiz-scheduler.js`: WiZ send gating
- `adapters/wiz-adapter.js`: WiZ adapter sends
- `core/mods/mod-loader.js`: local mod contract and hook execution
- `mods/`: local trusted extension packages
- `scripts/`: release hygiene and helper scripts

## Runtime Flow

1. `core/audio.js` publishes telemetry (rms, transient, bands, flux, level).
2. `core/rave-engine.js` consumes telemetry and emits intents.
3. `server.js` resolves target zones/fixtures by brand + mode.
4. Hue and WiZ schedulers apply rate/delta gating and send output.
5. Mod hooks can observe or extend lifecycle and intent handling.

## Transport Rate Guard + Latency Notes

- Hardware-safe send-rate caps are enabled by default in the audio reactivity map config.
- Hue/WiZ schedulers include heartbeat sends to prevent long static stalls under low delta.
- Hue REST path uses conservative transition tuning to reduce perceived lag while staying within safe limits.
- Hue Entertainment remains the preferred low-latency path when bridge/area health allows it.

Primary intent types:
- `HUE_STATE`
- `WIZ_PULSE`
- `TWITCH_HUE`
- `TWITCH_WIZ`

## Fixture Registry Model

Config file:
- `core/fixtures.config.json`

Registry module:
- `core/fixtures.js`

Built-in brands:
- `hue`
- `wiz`

Mod brand ids:
- regex: `^[a-z][a-z0-9_-]{1,31}$`
- example: `http-rgb`

Per-fixture mode flags:
- `engineEnabled`
- `twitchEnabled`
- `customEnabled`

Coupling invariants:
- Hue fixtures cannot bind to WiZ engine paths, and WiZ fixtures cannot bind to Hue engine paths.
- `engineEnabled` and `customEnabled` are mutually exclusive.
- At least one mode is kept enabled (`engine`, `twitch`, or `custom`) to avoid unreachable fixtures.

Canonical built-in zones:
- `hue`
- `wiz`
- `custom`

Key behavior:
- Intent routes are derived from fixture mode states (not arbitrary manual overrides).
- `setIntentRoute` currently returns derived routing metadata and does not force static custom routes.

## Built-in Transport Details

### Hue path

- Engine output can run through REST or Entertainment transport.
- Entertainment has auto-recovery and REST fallback.
- Missing Entertainment credentials surface in logs as pending recovery reasons.

### WiZ path

- Per-fixture adapters are created from configured WiZ fixtures.
- Engine sends only to configured + routed targets.
- "no engine targets" warnings usually mean route mismatch or invalid/missing fixture IP config.

### Standalone custom state

- `POST /fixtures/standalone/state` applies direct fixture-level states.
- Useful for custom control panel behavior outside engine mode.

## API Surface (Current)

### Stream control

- `POST /rave/on`
- `POST /rave/off`
- `POST /rave/drop`
- `POST /rave/panic`
- `POST /rave/reload`
- `POST /rave/genre?name=...`
- `POST /rave/genre/decade?mode=...`
- `GET /rave/genre/decade`
- `POST /rave/mode?name=auto|game|bpm`
- `POST /rave/scene?name=...`
- `POST /rave/scene/auto`
- `POST /rave/mode/competitive/on`
- `POST /rave/mode/competitive/off`
- `POST /rave/overclock/*`
- `GET /rave/overclock/tiers`
- `POST /rave/overclock/dev/:hz/on?unsafe=true` (unsafe dev tiers: 20/30/40/50/60)
- `POST /rave/overclock/dev/hz?value=<hz>&unsafe=true`
- `POST /rave/auto/profile?name=reactive|balanced|cinematic`
- `POST /rave/audio/reactivity?name=balanced|aggressive|precision`
- `POST /rave/audio/profile?name=...`
- `POST /rave/flow/intensity?value=...`
- `GET /rave/flow/intensity`
- `POST /rave/meta/auto?enabled=true|false`
- `POST /rave/meta/auto/on`
- `POST /rave/meta/auto/off`
- `GET /rave/genres`
- `GET /rave/telemetry`

### Twitch color and teach

- `POST /teach`
- `GET|POST /color`
- `GET /color/prefixes`
- `POST /color/prefixes`

Legacy compatibility:

- `GET /rave/on`, `GET /rave/off`, and `GET /teach` only work when
  `RAVELINK_ALLOW_LEGACY_MUTATING_GET=1`.

Accepted compat text keys:
- query/body `value1`
- query/body `text`
- query/body `value`

Color target options:
- `target` or `brand`: `hue`, `wiz`, `both` (default)
- `zone`, `hueZone`, `wizZone`

### OBS dock

- `GET /obs/dock`

Behavior:
- Redirects to `/?obsDock=1&compact=1` by default.
- `?compact=0` keeps expanded dock layout.

### Mods

- `GET /mods`
- `GET /mods/config`
- `GET /mods/runtime`
- `GET /mods/hooks`
- `GET /mods/debug`
- `POST /mods/hooks/:hook`
- `POST /mods/debug`
- `POST /mods/debug/clear`
- `GET /mods/ui/catalog`
- `GET /mods-ui/:modId/`
- `GET /mods-ui/:modId/<asset-path>`
- `POST /mods/config`
- `POST /mods/reload`
- `POST /mods/import`
- `ALL /mods/:modId`
- `ALL /mods/:modId/:action`

### Automation

- `GET /automation/config`
- `POST /automation/config`
- `POST /automation/reload`
- `POST /automation/apply`

### Hue/WiZ transport ops

- `GET /hue/discover`
- `POST /hue/pair`
- `POST /hue/transport`
- `GET /hue/telemetry`
- `GET /wiz/telemetry`

### Audio

- `GET /audio/telemetry`
- `GET /audio/config`
- `POST /audio/config`
- `POST /audio/restart`
- `GET /audio/devices`

### Fixtures

- `GET /fixtures`
- `GET /fixtures/connectivity`
- `POST /fixtures/connectivity/test`
- `GET /fixtures/standalone`
- `GET /fixtures/standalone/custom`
- `GET /fixtures/standalone/fixture/:id`
- `POST /fixtures/standalone/state`
- `POST /fixtures/standalone/state/batch`
- `GET /fixtures/config`
- `POST /fixtures/fixture`
- `DELETE /fixtures/fixture`
- `POST /fixtures/fixture/delete`
- `POST /fixtures/route`
- `POST /fixtures/reload`

### System

- `POST /system/stop`

## Mod Architecture

Config:
- `mods/mods.config.json`

Manifest:
- `mods/<mod-id>/mod.json`

Hooks:
- `onLoad`
- `onBoot`
- `onRaveStart`
- `onRaveStop`
- `onIntent`
- `onTelemetry`
- `onShutdown`
- `onUnload`
- `onHttp`

Key helper APIs:
- `api.getFixturesBy(...)`
- `api.getIntentZones(intent, ...)`
- `api.getStandaloneFixtures()`
- `api.applyStandaloneState(id, patch)`
- `api.getColorCommandConfig()`
- `api.setColorCommandConfig(patch)`
- `api.normalizeRgbState(...)`
- `api.createStateGate(...)`
- `api.enqueueHue(...)`
- `api.enqueueWiz(...)`

Full mod details:
- `docs/MODS.md`
- Built-in API probe mod with packaged UI: `mods/dev-feature-probe-mod/`

## Adding A New Fixture Brand Without Forking Core

1. Choose a brand id that matches `^[a-z][a-z0-9_-]{1,31}$`.
2. Implement mod adapter transport in `mods/<your-mod>/index.js` and load it through `MODS -> MOD CENTER`.
3. Add fixtures for that brand in one of two ways:
   - UI path: `FIXTURES -> FIXTURE PAIRING / DEVICE SETUP -> BRAND -> Mod Brands`
     - locked until mods are discovered
     - supports `CUSTOM MOD BRAND...` + `MOD BRAND ID`
   - Config path: edit `core/fixtures.config.json` directly.
4. Route fixtures under `FIXTURES -> DEVICE ROUTING` (new fixtures default to `ENGINE + TWITCH`).
5. Resolve fixtures through `api.getFixturesBy({ brand, mode })`.
6. Resolve intent zones through `api.getIntentZones(...)`.
7. Normalize payload with `api.normalizeRgbState(...)`.
8. Use a state gate (`api.createStateGate`) to throttle deltas.
9. Expose optional diagnostics with `onHttp`.

Reference adapter:
- `mods/http-rgb-brand-mod/`

## Frontend Notes

Single-page UI:
- `public/index.html`

Important UI/runtime areas:
- API base override in local storage (`rave_api_base`)
- Theme presets + custom accent/button colors
- OBS dock mode detection via query flags (`obsDock`, `compact`) and user-agent checks
- Fixture routing controls now align to canonical zone naming (`hue`, `wiz`, `custom`)
- Dedicated `CUSTOM` tab hosts standalone/custom device controls with a custom-routed fixture selector (Hue + WiZ)
- `MODS` tab hosts mod lifecycle + mod UI workbench, and loaded mod UIs can surface as auto-generated top tabs via `/mods-ui/*`

## UI Storage Reset + Migration

UI state reset is controlled by `UI_STORAGE_MIGRATION_TARGET` in `public/index.html`.

Workflow:

1. Bump migration target token (date + suffix).
2. Add/remove `localStorage` keys in `applyUiStorageMigration()`.
3. Reload browser once to apply migration.

Use this for:

- forcing clean onboarding after major UX/security updates
- clearing stale mode/toggle state after schema changes

Current release practice:

- Bump migration target on major ship branches to guarantee cache/state reset for end users.
- Keep the reset list explicit for sensitive toggles and dynamic tab state keys.

## Release Finalization Workflow

1. Run sanitize sweep:
   - `npm run sanitize:release`
2. Run release export:
   - `npm run export:redistributable`
3. Verify outputs under `release/`:
   - folder: `RaveLink-Bridge-Windows-v<version>`
   - zip: `RaveLink-Bridge-Windows-v<version>.zip`
4. Re-run syntax checks on changed runtime files:
   - `node --check server.js`
   - `node --check core/hue-scheduler.js`
   - `node --check core/wiz-scheduler.js`
5. Re-lock immutable/core files:
   - `npm run core:lock`

## Debugging Playbook

Use these first:

```powershell
Invoke-RestMethod http://127.0.0.1:5050/rave/telemetry
Invoke-RestMethod http://127.0.0.1:5050/fixtures
Invoke-RestMethod http://127.0.0.1:5050/fixtures/connectivity
Invoke-RestMethod http://127.0.0.1:5050/hue/telemetry
Invoke-RestMethod http://127.0.0.1:5050/wiz/telemetry
Invoke-RestMethod http://127.0.0.1:5050/audio/telemetry
```

Common failure signatures:
- Hue Entertainment pending/missing credentials: missing `bridgeIp`/`username`/`bridgeId`/`clientKey`.
- WiZ no targets: routed fixtures exist but are not configured or not mapped to current zone/mode.
- Audio active but no lights: fixture mode toggles not enabled or fixtures not configured/reachable.

## Local Validation Workflow

Minimum checks before merge:

```powershell
node --check server.js
node --check core\fixtures.js
node --check core\mods\mod-loader.js
```

Optional broad pass:

```powershell
Get-ChildItem -Recurse -File -Filter *.js |
  Where-Object { $_.FullName -notmatch '\\node_modules\\' -and $_.FullName -notmatch '\\release\\' } |
  ForEach-Object { node --check $_.FullName }
```

Recommended 3-pass pre-release check:

1. Focused syntax: `server.js`, `core/*` transport/registry files, active integrations.
2. Security grep: verify no insecure TLS toggles, no sensitive log leaks, no unsafe HTML sinks in changed code.
3. Broad parse: full repo `node --check` sweep excluding `node_modules` and `release`.

## Core Lock Workflow

Manifest:

- `core/core-lock-manifest.json`

Modes:

- `npm run core:lock`
- `npm run core:unlock`
- `npm run core:lock:status`
- `npm run core:unlock:key:init`
- `npm run core:unlock:key:status`

Manifest fields:

- `files`: mutable lock targets (lock/unlock toggled).
- `immutableFiles`: always enforced read-only, including during unlock.
- `unlock`: key path + env var + unlock enforcement policy.

This is used to protect critical runtime/security files from accidental edits.

Unlock requires a matching key when `unlock.requireForUnlock` is enabled:
- generate key once: `npm run core:unlock:key:init`
- unlock using env var: set `RAVELINK_CORE_UNLOCK_KEY=<key>` then run `npm run core:unlock`

## Release And Sanitization

Use:

```powershell
npm run sanitize:release
npm run export:redistributable
```

Sanitization/export scripts:
- `scripts/sanitize-release.js`
- `scripts/export-redistributable.js`

Do not ship:
- local backups (`backups/`, `core/backups/`)
- real fixture credentials/tokens/keys in committed config files
- runtime folders (`.runtime`, `release` temp outputs)

## Release Finalization (Single-Commit Distribution)

When publishing a reset-history distribution:

1. Confirm sanitization + redistributable export are complete.
2. Create a new orphan commit from current tree.
3. Force-push to target branch intentionally.

Only do this when you explicitly want to replace prior commit history.

## Security Notes

- Treat local mods as trusted code with full process privileges.
- Keep API local-only unless you intentionally expose it behind a controlled gateway.
- Restrict high-risk endpoints (`/rave/panic`, `/system/stop`, `/mods/config`) from public chat automation.
