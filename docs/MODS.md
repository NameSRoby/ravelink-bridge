# Mods Guide (v1.5.3)

This document is the developer reference for the local mod system shipped in this distro.
If you are building adapters, custom brands, or runtime behavior overrides, start here.

## Version Delta (v1.5.3)

Key behavior changes relevant to mod authors:

- No mod hook contract break in this update; existing mods continue to load/run with current lifecycle APIs.
- Palette runtime now commonly uses expanded family/count combinations in user presets:
  - families include `red`, `yellow`, `green`, `cyan`, `blue`
  - per-family counts can vary per palette (common values: `1`, `3`, `5`, `8`, `12`)
- WiZ runtime behavior was tuned for slower color pacing with stronger brightness contrast:
  - if your mod assumes high-frequency per-tick color changes, use `createStateGate` to avoid over-sending.
- Installer now exposes optional audio isolation tooling as an install task; support scripts remain:
  - `RaveLink-Bridge-Install-Optional-Audio-Tools.bat`

Example palette patch payload for tooling/mods (per-family count mix):

```json
{
  "families": ["red", "yellow", "green", "cyan", "blue"],
  "familyColorCounts": { "red": 5, "yellow": 3, "green": 12, "cyan": 8, "blue": 5 },
  "vividness": "high",
  "disorder": false
}
```

Existing v1.5 behavior retained:
- Legacy genre/decade tuning paths are retired from active runtime behavior.
- Palette sequencing + fixture metric routing are now first-class controls in LIVE.
- Per-brand/per-fixture target menus map to runtime overrides (global -> brand -> fixture).
- Scene-sync endpoints remain for compatibility (`/rave/scene/sync`), but WiZ standalone mode is enforced in current runtime.

New routing endpoints frequently used by tooling/mods:

- `GET /rave/palette`
- `POST /rave/palette`
- `GET /rave/palettes`
- `GET /rave/fixture-metrics`
- `POST /rave/fixture-metrics`
- `POST /rave/fixture-routing/clear`

## 1. Trust Model And Scope

- Mods are loaded from local disk under `mods/`.
- Mods run in-process with full Node.js privileges.
- There is no sandbox. Treat every enabled mod as trusted code.
- Core runtime isolates hook failures so one mod error should not crash the bridge, but logic bugs can still affect output behavior.

## 2. File Layout

```text
mods/
  mods.config.json
  <mod-id>/
    mod.json
    index.js
    ui/
      index.html
      app.js
      styles.css
```

- Loader implementation: `core/mods/mod-loader.js`
- Server API wiring: `server.js` (`/mods/*`)

## 3. Manifest Contract (`mod.json`)

Example:

```json
{
  "id": "my-mod",
  "name": "My Mod",
  "version": "1.0.0",
  "description": "Example mod",
  "main": "index.js",
  "ui": {
    "entry": "ui/index.html",
    "title": "My Mod Control"
  },
  "enabled": false
}
```

Required in practice:
- `id`: stable unique mod id
- `main`: entry file (defaults to `index.js` if omitted)

Optional UI fields:
- `ui` as string:
  - `"ui": "ui/index.html"`
- `ui` as object:
  - `"ui": { "entry": "ui/index.html", "title": "My Mod Control" }`

Optional mod hover-info fields (used by Mod Center tooltip):
- `infoFile`, `summaryFile`, `tooltipFile`, or `hoverTextFile` in `mod.json`
  - points to a local text/markdown file inside the mod folder
- If none is set, loader checks common files in this order:
  - `mod-info.txt`
  - `mod-info.md`
  - `description.txt`
  - `about.txt`
  - `README.txt`
  - `README.md`
- If no file is found, tooltip falls back to `manifest.description`

UI discovery fallback filenames (if `ui` not set):
- `ui/index.html`
- `ui.html`
- `mod-ui/index.html`
- `mod-ui.html`

UI surfacing behavior in the control UI:
- `MODS` is the dedicated tab for mod lifecycle + mod UI hosting.
- If a loaded mod exports UI, the top navigation gets an auto-generated mod tab button for it.
- Clicking that mod tab selects the mod and opens its UI in the `MODS -> MOD UI WORKBENCH` host frame.
- No settings-cog toggle is required for mod UI tabs.

UI asset path contracts:
- Catalog: `GET /mods/ui/catalog`
- Host root for a mod UI: `GET /mods-ui/:modId/`
- Static assets under same root: `GET /mods-ui/:modId/<asset-path>`
- In practice, keep links/assets relative in your HTML (`./app.js`, `./styles.css`) so they resolve under `/mods-ui/:modId/`.

Notes:
- If `mods.config.json.enabled` is non-empty, that list controls enablement.
- If `mods.config.json.enabled` is empty, loader falls back to `manifest.enabled`.
- `mods.config.json.disabled` always wins (hard block).

## 4. Runtime Config (`mods/mods.config.json`)

Structure:

```json
{
  "enabled": ["hello-mod", "quiet-hours-mod"],
  "order": ["quiet-hours-mod", "hello-mod"],
  "disabled": []
}
```

Semantics:
- `enabled`: mod ids that should load
- `order`: optional priority list; loader sorts by this first, then id
- `disabled`: explicit block list

## 5. Mod Export Contract

A mod can export:
- An object of hooks
- A factory function returning that object

Factory signature:

```js
module.exports = function createMod(api, manifest) {
  return {
    // optional hooks
  };
};
```

## 6. Hook Lifecycle And Payloads

Supported hooks:
- `onLoad(payload, ctx)`
- `onBoot(payload, ctx)`
- `onRaveStart(payload, ctx)`
- `onRaveStop(payload, ctx)`
- `onIntent(payload, ctx)`
- `onTelemetry(payload, ctx)`
- `onShutdown(payload, ctx)`
- `onUnload(payload, ctx)`
- `onHttp(request, ctx)`

Hook timing:
- `onLoad`: after module instantiate
- `onUnload`: before reload/unload
- `onBoot`: server boot and mod reload boot events
- `onRaveStart` / `onRaveStop`: on `/rave/on` and `/rave/off`
- `onIntent`: for every engine intent (fire-and-forget observer)
- `onTelemetry`: when `/rave/telemetry` is requested
- `onShutdown`: bridge shutdown path
- `onHttp`: for `/mods/:modId` and `/mods/:modId/:action`

Payload shapes used by core:
- `onLoad`: `{ loadedAt }`
- `onBoot`: `{ reason, runtime }`
- `onRaveStart`: `{ source: "api", runtime }`
- `onRaveStop`: `{ source: "api", runtime }`
- `onIntent`: `{ intent }`
- `onTelemetry`: `{ telemetry }`
- `onShutdown`: `{ reason, runtime }`
- `onUnload`: `{ reason }`

`runtime` snapshot includes:
- `state` (global state manager snapshot)
- `transport` (`desired`, `active` Hue transport)
- `fixtures` (fixture summary)
- `audio` (audio telemetry snapshot)

## 7. `ctx` And `ctx.api` Reference

Every hook gets `ctx`:

- `ctx.hook`
- `ctx.now` (timestamp)
- `ctx.mod` (`id`, `name`, `version`)
- `ctx.api` helper surface

`ctx.api` methods:

- `id`: current mod id
- `manifest`: cloned manifest data
- `log(...)`, `warn(...)`, `error(...)`
- `now()`
- `enqueueHue(state, zone, options)`
- `enqueueWiz(state, zone, options)`
- `getEngineTelemetry()`
- `getHueTelemetry()`
- `getWizTelemetry()`
- `getAudioTelemetry()`
- `getFixtures()`
- `getFixturesBy(filters)`
- `getFixtureRoutes()`
- `getIntentZones(intent, options)`
- `getStandaloneFixtures()`
- `applyStandaloneState(id, statePatch)`
- `getColorCommandConfig()`
- `setColorCommandConfig(patch)`
- `normalizeRgbState(state, fallback)`
- `createStateGate(defaults)`
- `getState()`

`getFixturesBy(filters)` supports:
- `brand`
- `zone`
- `mode` (`engine`, `twitch`, `custom`)
- `enabledOnly` (default true)
- `requireConfigured` (brand-aware checks for Hue/WiZ)

`getIntentZones(intent, options)` supports:
- `brand`
- `mode` (default `engine`)
- `fallbackZone`

`createStateGate(defaults)` returns:
- `shouldSend(key, state, overrides)`
- `reset(key?)`
- `snapshot()`

Use it to enforce per-device min interval / color delta / dimming delta.

## 8. HTTP API For Mod Operations

### `GET /mods`

Returns runtime snapshot:
- discovered mods
- load state
- configured ids (`enabled/order/disabled`)
- config file path

Example:

```powershell
Invoke-RestMethod http://127.0.0.1:5050/mods
```

### `GET /mods/config`

Returns active mod config and config path.

```powershell
Invoke-RestMethod http://127.0.0.1:5050/mods/config
```

### `GET /mods/runtime`

Returns runtime snapshot useful for adapter diagnostics:
- core state summary
- transport desired/active status
- fixture summary
- audio telemetry
- current mod snapshot

```powershell
Invoke-RestMethod http://127.0.0.1:5050/mods/runtime
```

### `GET /mods/debug`

Returns detailed mod diagnostics for development:
- per-event `sectionTitle` (`CONFIG`, `DISCOVERY`, `LIFECYCLE`, `HOOKS`, `HTTP`, `DEBUG`)
- per-event `explanation` (human-readable reason)
- high-resolution duration data on hook/lifecycle events
- hook aggregate timing/failure stats

Query options:
- `limit` (default 300)
- `sinceSeq` (incremental tailing)
- `includeEvents` (`true|false`)
- `includeHookStats` (`true|false`)

```powershell
Invoke-RestMethod "http://127.0.0.1:5050/mods/debug?limit=150"
```

### `POST /mods/debug`

Updates debug runtime behavior.

Body keys:
- `enabled` (boolean)
- `maxEvents` (100-5000)
- `maxPayloadChars` (300-20000)
- `maxDepth` (2-8)
- `clear` (boolean; optional)

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:5050/mods/debug `
  -ContentType "application/json" `
  -Body '{"enabled":true,"maxEvents":1200,"maxPayloadChars":5000,"maxDepth":6}'
```

### `POST /mods/debug/clear`

Clears stored in-memory debug events while keeping current debug settings.

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:5050/mods/debug/clear
```

### `GET /mods/hooks`

Returns:
- supported hook names
- loaded mods and which hooks each exposes

```powershell
Invoke-RestMethod http://127.0.0.1:5050/mods/hooks
```

### `POST /mods/config`

Patch and optionally reload mod config.

Request body keys:
- `enabled` (array of ids)
- `order` (array of ids)
- `disabled` (array of ids)
- `reload` (boolean, default true)

Behavior:
- Writes `mods/mods.config.json`
- Invalid IDs are ignored (valid format: `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$`).
- If `reload !== false`, performs full mod reload
- If reloaded, server triggers `onBoot` with `reason: "mods_reload"`

Example (reload now):

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:5050/mods/config `
  -ContentType "application/json" `
  -Body '{"enabled":["hello-mod","my-mod"],"order":["my-mod","hello-mod"],"disabled":[]}'
```

Example (save config only, no runtime reload):

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:5050/mods/config `
  -ContentType "application/json" `
  -Body '{"enabled":["my-mod"],"reload":false}'
```

### `POST /mods/reload`

Forces teardown + reload of enabled mods using current config file.

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:5050/mods/reload
```

### `POST /mods/import`

Imports a mod folder from a drag/drop or file-picker client payload.

Request body keys:
- `files` (required): array of `{ path, contentBase64 }`
- `modId` (optional): overrides manifest id when valid
- `overwrite` (optional, boolean): replace existing mod folder
- `enableAfterImport` (optional, boolean): add mod id to enabled config
- `reload` (optional, boolean, default true): reload runtime after import

Constraints:
- max 2000 files
- max 20MB decoded payload
- requires `mod.json` in payload
- path traversal is blocked

Example:

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:5050/mods/import `
  -ContentType "application/json" `
  -Body '{"files":[{"path":"my-mod/mod.json","contentBase64":"eyJpZCI6Im15LW1vZCJ9"}],"overwrite":false,"enableAfterImport":true}'
```

### `POST /mods/hooks/:hook`

Manual hook invoke endpoint for testing/instrumentation.

Body:
- send payload object directly, or
- `{ "payload": { ... } }`

Example:

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:5050/mods/hooks/onBoot `
  -ContentType "application/json" `
  -Body '{"payload":{"reason":"manual_test"}}'
```

### `GET /mods/ui/catalog`

Returns discovered mod UI descriptors:
- includes loaded and offline mod UIs
- includes runtime URL when the mod is currently loaded

Example:

```powershell
Invoke-RestMethod http://127.0.0.1:5050/mods/ui/catalog
```

### `GET /mods-ui/:modId/`
### `GET /mods-ui/:modId/<asset-path>`

Serves packaged mod UI files from the selected mod folder.

Rules:
- Only loaded mods are served (`409` while mod is not loaded).
- Path traversal is blocked.
- `index.html` is auto-served for directory targets.

Examples:

```powershell
Invoke-WebRequest http://127.0.0.1:5050/mods-ui/my-mod/
Invoke-WebRequest http://127.0.0.1:5050/mods-ui/my-mod/app.js
```

### `ALL /mods/:modId`
### `ALL /mods/:modId/:action`

Routes to mod `onHttp` handler.

`onHttp` request payload:
- `action`
- `method`
- `path`
- `query`
- `body`
- `headers`

Return contract from `onHttp`:
- Return `{ status, body }` for explicit response control
- Return any object to send JSON body with status `200`
- Return scalar/non-object to auto-wrap:
  - `{ ok: true, modId, action, result }`

Error behavior:
- Unknown/unloaded mod: `404`
- No `onHttp` in mod: `404`
- Mod throws: `500`

Example:

```powershell
Invoke-RestMethod http://127.0.0.1:5050/mods/hello-mod/status
Invoke-RestMethod -Method Post http://127.0.0.1:5050/mods/http-rgb-brand-mod/test `
  -ContentType "application/json" `
  -Body '{"id":"desk-strip-1","r":255,"g":120,"b":20,"dimming":45}'
```

### Overclock APIs Useful For Mods

Safe tiers:
- `POST /rave/overclock/off` (2Hz)
- `POST /rave/overclock/on` (4Hz)
- `POST /rave/overclock/turbo/on` (6Hz)
- `POST /rave/overclock/ultra/on` (8Hz)
- `POST /rave/overclock/extreme/on` (10Hz)
- `POST /rave/overclock/insane/on` (12Hz)
- `POST /rave/overclock/hyper/on` (14Hz)
- `POST /rave/overclock/ludicrous/on` (16Hz)

Unsafe dev tiers (manual acknowledgement required):
- `POST /rave/overclock/dev/20/on?unsafe=true`
- `POST /rave/overclock/dev/30/on?unsafe=true`
- `POST /rave/overclock/dev/40/on?unsafe=true`
- `POST /rave/overclock/dev/50/on?unsafe=true`
- `POST /rave/overclock/dev/60/on?unsafe=true`
- `POST /rave/overclock/dev/hz?value=<20|30|40|50|60>&unsafe=true`

Tier discovery:
- `GET /rave/overclock/tiers`

Warning:
- Unsafe tiers are intentional stress modes and can produce unstable or unpredictable behavior.

### Custom Device Control APIs Useful For Mods

- `GET /fixtures/standalone`
- `GET /fixtures/standalone/custom`
- `GET /fixtures/standalone/fixture/:id`
- `POST /fixtures/standalone/state`
- `POST /fixtures/standalone/state/batch`

Examples:

```powershell
Invoke-RestMethod http://127.0.0.1:5050/fixtures/standalone/custom
Invoke-RestMethod -Method Post http://127.0.0.1:5050/fixtures/standalone/state `
  -ContentType "application/json" `
  -Body '{"id":"wiz-custom-1","state":{"mode":"scene","scene":"flow","speedMode":"audio"}}'
Invoke-RestMethod -Method Post http://127.0.0.1:5050/fixtures/standalone/state/batch `
  -ContentType "application/json" `
  -Body '{"ids":["wiz-custom-1","hue-custom-1"],"state":{"static":true}}'
```

Twitch color prefix config APIs:
- `GET /color/prefixes`
- `POST /color/prefixes`

## 9. Hotswap Model In This Distro

The Mod Center UI uses a queued-apply model:

1. User toggles enable/disable in UI (draft only, no server reload yet).
2. UI shows pending count (`n pending apply`).
3. `APPLY HOTSWAP` posts config to `/mods/config` and reloads runtime.
4. `DISCARD CHANGES` drops local draft and keeps current runtime.

Important:
- Hot enable/disable is safe because loader tears down existing mod instances (`onUnload`) before reload.
- Runtime reload does not require process restart.
- Mod-packaged UI availability follows this same hotswap cycle:
  - if a mod with `ui` is enabled + applied, it appears in `/mods/ui/catalog`, in `MODS -> MOD UI WORKBENCH`, and as an auto-generated top mod tab.
  - if disabled + applied, `/mods-ui/:modId/*` is no longer served.
- Drag/drop import in Mod Center is a frontend convenience for the same `/mods/import` API.

## 10. Minimal Mod Template

`mods/my-mod/mod.json`

```json
{
  "id": "my-mod",
  "name": "My Mod",
  "version": "1.0.0",
  "description": "Minimal mod",
  "main": "index.js",
  "enabled": false
}
```

`mods/my-mod/index.js`

```js
module.exports = function createMyMod(api) {
  const gate = api.createStateGate({
    minIntervalMs: 120,
    minColorDelta: 8,
    minDimmingDelta: 3
  });

  return {
    onLoad() {
      api.log("loaded");
    },

    onIntent(payload) {
      const intent = payload?.intent;
      if (!intent || intent.type !== "WIZ_PULSE") return;
      const zones = api.getIntentZones(intent, { brand: "wiz", mode: "engine", fallbackZone: "wiz" });
      for (const zone of zones) {
        const color = api.normalizeRgbState(intent.color || {}, { r: 0, g: 0, b: 0, dimming: 60 });
        if (!gate.shouldSend(`wiz:${zone}`, color)) continue;
        api.enqueueWiz(color, zone, { minIntervalMs: 90 });
      }
    },

    onHttp(req) {
      if ((req.action || "").toLowerCase() === "status") {
        return { status: 200, body: { ok: true, mod: "my-mod" } };
      }
      return { status: 400, body: { ok: false, error: "unknown action" } };
    }
  };
};
```

## 11. Custom Brand Adapter Pattern

Use mods to integrate non-Hue/WiZ fixtures without changing core transports.

Pattern:
1. Choose a fixture brand id that matches `^[a-z][a-z0-9_-]{1,31}$` (example: `http-rgb`).
2. Build + load your mod adapter (`mods/<mod-id>/mod.json` + `index.js`), then enable/apply it from `MODS -> MOD CENTER`.
3. Add fixtures for that brand using `FIXTURES -> FIXTURE PAIRING / DEVICE SETUP`. The `Mod Brands` selector group stays locked/greyed-out until mods are discovered.
4. In that form, choose your brand from the detected list, or pick `CUSTOM MOD BRAND...` and enter the brand id in `MOD BRAND ID`.
5. Save fixtures and route them in `FIXTURES -> DEVICE ROUTING`. New fixtures default to `ENGINE + TWITCH` and `CUSTOM` can be enabled when needed.
6. In your mod, filter fixtures with `api.getFixturesBy({ brand: "http-rgb", mode: "engine" })`.
7. Resolve zone targets with `api.getIntentZones(intent, { brand: "http-rgb", mode: "engine", fallbackZone: "custom" })`.
8. Observe intents in `onIntent`, map to adapter payload, and gate sends with `api.createStateGate(...)`.
9. Send to your transport (HTTP/UDP/serial/etc) and expose diagnostics through `onHttp`.

Notes for fixture metadata:
- Non-Hue fixtures in the built-in form use `MOD TARGET / IP (OPTIONAL)` (`ip` field).
- Your adapter can also read additional fixture fields directly from `api.getFixturesBy(...)` if you store custom keys in `core/fixtures.config.json`.

Reference adapter included:
- `mods/http-rgb-brand-mod/`

## 12. Troubleshooting

- Mod not loading:
  - Check `/mods` response for `error`
  - Verify `mod.json` parse and `main` path
  - Ensure id is enabled and not in `disabled`
- HTTP action returns 404:
  - Mod not loaded or missing `onHttp`
- Hook appears not called:
  - Verify hook name is supported exactly
  - `onTelemetry` only fires when `/rave/telemetry` is requested
- Output spam/flood:
  - Add `createStateGate` throttling and enforce deltas

## 13. Related Docs

- `README.md`
- `docs/DEVELOPER_GUIDE.md`
- `docs/STREAMING_INTEGRATIONS.md`

## 14. Open-Source Attribution (Optional)

RaveLink-Bridge is open source. If you fork, remix, or ship a derived distro, credit to the original project is appreciated:
- "NameSroby's RaveLink-Bridge"

This is a request, not a hard requirement.
