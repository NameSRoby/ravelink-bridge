# RaveLink Bridge

Lightweight and powerful streamer-first local lighting engine for Philips Hue + WiZ, with Twitch-ready controls and modular brand extension via local mods.

Optional support: https://ko-fi.com/namesroby

## Open Source Note

RaveLink-Bridge is open source. If you fork/remix and ship your own distro, attribution is appreciated (not required):
- "NameSroby's RaveLink-Bridge"

## Download

- Current Windows release (v1.3.0): https://github.com/NameSRoby/ravelink-bridge/releases/tag/v1.3.0
- All releases: https://github.com/NameSRoby/ravelink-bridge/releases

## What This Is

RaveLink Bridge runs on your stream PC and turns live audio + chat actions into Hue/WiZ light output.

- Audio-reactive engine for music/gameplay
- Twitch-triggerable color and scene control
- Channel points/reward friendly HTTP endpoints
- OBS dock URL built in (`/obs/dock`)
- MIDI controller mapping tab (learn + bindings + trigger tests)
- Mod system for adding other fixture brands without forking core Hue/WiZ transport logic

## Version 1.3.0 Changes

- Standalone custom device controls expanded for fixtures routed as `CUSTOM`:
  - Per-device selection from routed custom fixtures
  - Scene controls + RGB/CCT range controls + speed controls (including min/max auto-speed bands)
  - `STATIC` toggle support so selected fixtures can hold output after an initial effect
  - WiZ/Hue CCT controls retained with brightness-safe handling
- Mod Center now supports hotswap queue/apply/discard workflows:
  - Queue mod enable/disable changes without immediate reload
  - Pending change indicators and explicit `APPLY HOTSWAP`
  - Safe discard path to revert queued edits before runtime reload
- Meta Auto upgraded to a self-derived mode:
  - Stops using decade/auto-genre tuning as a control input while enabled
  - Infers its own genre from live audio metrics
  - Decisively drives profile, reactivity, and output Hz/overclock from audio behavior
  - Telemetry now exposes inferred Meta genre and target Hz
- Live UI fix: FLOW INTENSITY moved under advanced scene controls and now includes a dedicated reset button.
- Added full MIDI control surface and runtime API:
  - Dedicated `MIDI` tab with device scan/config, learn mode, action binding editor, and trigger testing
  - Runtime routes for status/config/learn/bindings/trigger (`/midi/*`)
  - Backward-compatible learn alias for legacy overclock mapping (`overclock -> overclock_toggle`)
- Mod developer docs expanded in `docs/MODS.md` with lifecycle details, hotswap behavior, and endpoint contracts.
- Added DEV/DEBUG-gated unsafe overclock controls (20-60Hz) with explicit confirmation gates and manual-only routes.
- Settings cog DEV tools are now hidden unless `DEV DEBUG` is enabled.
- Added expanded mod-support APIs (`/mods/config`, `/mods/runtime`, `/mods/hooks`, `/mods/hooks/:hook`, `/rave/overclock/tiers`).
- Added mod-packaged UI hosting:
  - New dedicated `MODS` tab for mod lifecycle + UI hosting.
  - Auto-generated top tabs for loaded mods that ship UI packages.
  - New routes: `/mods/ui/catalog` and `/mods-ui/:modId/*` for mod UI assets.
- Added dedicated `CUSTOM` tab for standalone/custom fixture control (Hue + WiZ) with direct custom fixture selection.
- Device routing selector no longer uses the old "custom-only" checkbox flow.
- Twitch prefix controls are now fully editable (`hue`, `wiz`, `mod-brand`) and include configurable unprefixed default target (`hue|wiz|both`).
- Added drag/drop mod import in `Mods -> Mod Center` (folder drop or folder picker), backed by `POST /mods/import`.
- Added built-in `dev-feature-probe-mod` with packaged Mod UI panel for testing standalone custom state, prefix APIs, and overclock routes.

## Streamer Quick Start

1. Install Node.js LTS from `https://nodejs.org`.
2. Start the bridge:

```powershell
npm install
npm start
```

3. Open `http://127.0.0.1:5050`.
4. In `FIXTURE LIST`, remove placeholders and add your real fixtures.
5. For Hue fixtures, set `bridgeIp`, `username`, and `lightId` (and `bridgeId` + `clientKey` if using Entertainment transport).
6. For WiZ fixtures, set `ip`.
7. In `DEVICE ROUTING`, enable per-fixture toggles:
- `ENGINE` for audio engine control
- `TWITCH` for chat/reward control
- `CUSTOM` for standalone custom control
8. Click `APPLY ROUTING`, then `TEST CONNECTIVITY`.
9. Start reactive output with `RAVE ON`.
10. Optional: in `MIDI`, map controller inputs to engine actions without editing code.

Stop with `RAVE OFF`, `Ctrl+C`, or:

```powershell
npm run stop
```

Windows launchers:
- `RaveLink-Bridge.bat`
- `RaveLink-Bridge-Stop.bat`

## MIDI Quick Start

1. Open the `MIDI` tab (auto-shows when a MIDI input device is detected).
2. Select `MIDI INPUT PORT` and click `SAVE MIDI CFG`.
3. Choose a `LEARN ACTION`, click `ARM LEARN`, then press your controller key/knob.
4. Verify with `TRIGGER ACTION` and watch `LAST ACTION`.
5. Fine-tune or manually edit bindings in `LEARN + BINDINGS`.

Notes:
- If no MIDI device is detected, you can force-show the MIDI tab from the settings cog (`MIDI TAB` toggle).
- `DEV TOOLS` in the settings cog only appear when `DEV DEBUG` is enabled.

## OBS Dock

Add this URL to OBS custom docks:

- `http://127.0.0.1:5050/obs/dock`

Optional expanded layout URL:

- `http://127.0.0.1:5050/obs/dock?compact=0`

Notes:
- The dock URL redirects to `/?obsDock=1&compact=...` and enables dock-specific layout behavior.
- Remove or rename docks from OBS `View -> Docks -> Custom Browser Docks`.

## Twitch + Channel Points Setup

### Option A: StreamElements Widget (overlay logic)

Template file:
- `INTEGRATIONS_TWITCH/START-HERE-STREAMELEMENTS-WIDGET-TEMPLATE/PASTE-INTO-STREAMELEMENTS-CUSTOM-WIDGET.js`

Steps:
1. Create Twitch rewards for your actions (for example `Color`, `Teach`, `Rave`).
2. Copy each reward id into the template constants.
3. Keep `BASE_URL = "http://127.0.0.1:5050"` when OBS and bridge run on the same machine.
4. Paste template JS into a StreamElements Custom Widget.
5. Add that widget to OBS as a Browser Source.

### Option B: Streamer.bot / Mix It Up / SAMMI / any bot with HTTP actions

Use reward triggers or chat command actions to call bridge endpoints, for example:
- `POST http://127.0.0.1:5050/rave/on`
- `POST http://127.0.0.1:5050/rave/off`
- `GET http://127.0.0.1:5050/color?value1=purple`
- `GET http://127.0.0.1:5050/teach?value1=toxic+green`

### Overlay/Chat Bot Compatibility

Any overlay or bot can work if it can send HTTP requests to the bridge host.

- Local bot on stream PC: use `http://127.0.0.1:5050`.
- Bot on another machine: use the stream PC LAN IP (for example `http://192.168.1.x:5050`) and allow LAN access.
- Cloud bot service: cannot reach your localhost directly without a relay/tunnel. If you expose the bridge, secure it and limit commands.

## Stream Chat Command Matrix

Examples below assume your bot maps chat commands/channel-point rewards to HTTP calls.

| Chat action idea | Endpoint | Example |
|---|---|---|
| Start show | `POST /rave/on` | `http://127.0.0.1:5050/rave/on` |
| Stop show | `POST /rave/off` | `http://127.0.0.1:5050/rave/off` |
| Force drop pulse | `POST /rave/drop` | `http://127.0.0.1:5050/rave/drop` |
| Teach color phrase | `GET or POST /teach` | `/teach?value1=deep+ocean+blue` |
| Apply named color | `GET or POST /color` | `/color?value1=hot+pink` |
| Color only Hue | `GET or POST /color` | `/color?value1=cyan&target=hue` |
| Color only WiZ | `GET or POST /color` | `/color?value1=orange&target=wiz` |
| Color specific route zone | `GET or POST /color` | `/color?value1=red&zone=wiz` |
| Set genre | `POST /rave/genre?name=<genre>` | `/rave/genre?name=techno` |
| Set genre decade mode | `POST /rave/genre/decade?mode=<mode>` | `/rave/genre/decade?mode=20s` |
| Set behavior mode | `POST /rave/mode?name=<auto|game|bpm>` | `/rave/mode?name=game` |
| Lock scene | `POST /rave/scene?name=<scene>` | `/rave/scene?name=flow` |
| Release scene lock | `POST /rave/scene/auto` | `/rave/scene/auto` |
| Set auto profile | `POST /rave/auto/profile?name=<profile>` | `/rave/auto/profile?name=reactive` |
| Set audio reactivity | `POST /rave/audio/reactivity?name=<preset>` | `/rave/audio/reactivity?name=aggressive` |
| Set flow intensity | `POST /rave/flow/intensity?value=<0.35-2.5>` | `/rave/flow/intensity?value=1.35` |
| Meta auto on | `POST /rave/meta/auto/on` | `/rave/meta/auto/on` |
| Meta auto off | `POST /rave/meta/auto/off` | `/rave/meta/auto/off` |
| Meta auto explicit flag | `POST /rave/meta/auto?enabled=<true|false>` | `/rave/meta/auto?enabled=true` |
| Overclock base on/off | `POST /rave/overclock/on` or `/off` | `/rave/overclock/on` |
| Overclock turbo | `POST /rave/overclock/turbo/on` | `/rave/overclock/turbo/on` |
| Overclock ultra | `POST /rave/overclock/ultra/on` | `/rave/overclock/ultra/on` |
| Overclock extreme | `POST /rave/overclock/extreme/on` | `/rave/overclock/extreme/on` |
| Overclock insane | `POST /rave/overclock/insane/on` | `/rave/overclock/insane/on` |
| Overclock hyper | `POST /rave/overclock/hyper/on` | `/rave/overclock/hyper/on` |
| Overclock ludicrous | `POST /rave/overclock/ludicrous/on` | `/rave/overclock/ludicrous/on` |

Common values:
- Genre names: `auto`, `edm`, `hiphop`, `metal`, `ambient`, `house`, `trance`, `dnb`, `pop`, `rock`, `rnb`, `techno`, `media`
- Decade modes: `auto`, `90s`, `00s`, `10s`, `20s`
- Scene names: `auto`, `idle_soft`, `flow`, `pulse_strobe`
- Auto profiles: `reactive`, `balanced`, `cinematic`
- Audio reactivity presets: `balanced`, `aggressive`, `precision`

Admin-only (do not expose to public chat):
- `POST /rave/panic`
- `POST /rave/reload`
- `POST /system/stop`
- `POST /rave/overclock/dev/<20|30|40|50|60>/on?unsafe=true`
- `POST /mods/hooks/:hook`

## Routing Rules That Matter For Streaming

- Hue fixtures stay on Hue paths, WiZ fixtures stay on WiZ paths.
- `engineEnabled` and `customEnabled` cannot both be active on the same fixture.
- `TWITCH` commands only affect fixtures with `twitchEnabled: true`.
- Route values shown in UI (`AUTO_HUE_STATE`, `AUTO_WIZ_PULSE`, `AUTO_TWITCH_*`) are derived from fixture mode toggles.
- Canonical built-in zones are `hue`, `wiz`, and `custom`.

## Troubleshooting

If audio is moving but bulbs are static:
- Verify fixture credentials/IP are valid.
- Confirm fixture mode toggles are enabled and route was applied.
- Check connectivity with `TEST CONNECTIVITY`.
- Confirm command target/zone actually maps to routed fixtures.

Log hints:
- `[HUE][ENT] ... missing bridgeIp/username/bridgeId/clientKey` means Hue fixture or env config is incomplete.
- `[WIZ] no engine targets ... fixtures routed but not configured` means WiZ fixtures exist but have missing/invalid IP.
- `no routed fixtures matched` from `/color` means Twitch route + target filters found zero fixtures.

## Developer Quick Start

1. Install dependencies and run:

```powershell
npm install
npm start
```

2. Open `http://127.0.0.1:5050`.
3. Run targeted syntax checks:

```powershell
node --check server.js
node --check core\fixtures.js
node --check core\mods\mod-loader.js
node --check core\midi\midi-manager.js
node --check core\midi\midi-learn.js
```

4. For broad checks:

```powershell
Get-ChildItem -Recurse -File -Filter *.js |
  Where-Object { $_.FullName -notmatch '\\node_modules\\' -and $_.FullName -notmatch '\\release\\' } |
  ForEach-Object { node --check $_.FullName }
```

## Repository Map

- `server.js`: API surface, runtime orchestration, transport lifecycle
- `core/rave-engine.js`: audio-to-intent logic
- `core/audio.js`: capture + telemetry
- `core/fixtures.js`: fixture registry, validation, coupling, derived routing
- `core/mods/mod-loader.js`: trusted local mod loader and hook runner
- `core/midi/midi-manager.js`: MIDI runtime, port connect/reconnect, action dispatch
- `core/midi/midi-learn.js`: MIDI config + learn/binding persistence
- `core/hue-scheduler.js`: Hue scheduler
- `core/hue-entertainment.js`: Hue Entertainment transport path
- `core/wiz-scheduler.js` + `adapters/wiz-adapter.js`: WiZ transport path
- `mods/`: local mods (`mod.json` + entrypoint)
- `docs/`: project docs
- `scripts/sanitize-release.js`: scrub release-sensitive files
- `scripts/export-redistributable.js`: generate distributable folder

## Runtime Architecture

1. `core/audio.js` emits telemetry.
2. `core/rave-engine.js` emits intents (`HUE_STATE`, `WIZ_PULSE`, Twitch variants).
3. `core/fixtures.js` resolves mode/brand/zone eligible fixtures.
4. Built-in Hue/WiZ transports send output with scheduler and state gating.
5. Mods can observe and extend behavior through hook APIs.

Core API families:
- `/rave/*`
- `/audio/*`
- `/fixtures/*`
- `/hue/*`
- `/wiz/*`
- `/automation/*`
- `/mods/*`
- `/midi/*`

## Fixture Model And Modular Brand Path

Config file:
- `core/fixtures.config.json`

Built-in brands:
- `hue`
- `wiz`

Mod brands:
- any lowercase id matching `^[a-z][a-z0-9_-]{1,31}$` (example `http-rgb`)

Per fixture mode flags:
- `engineEnabled`
- `twitchEnabled`
- `customEnabled`

Coupling rules:
- Built-in brand coupling is strict (`hue` to Hue path, `wiz` to WiZ path).
- `engineEnabled` and `customEnabled` are mutually exclusive.
- Mod-brand fixtures can carry extra fields for adapter metadata.

Recommended extension flow:
1. Create/load your mod adapter (`mods/<your-mod>/mod.json` + `index.js`).
2. Add mod-brand fixtures either:
   - in UI (`FIXTURES -> FIXTURE PAIRING / DEVICE SETUP -> BRAND -> Mod Brands`), or
   - directly in `core/fixtures.config.json`.
3. Route fixtures in `FIXTURES -> DEVICE ROUTING` (new fixtures default to `ENGINE + TWITCH`).
4. Use helper APIs such as `api.getFixturesBy`, `api.getIntentZones`, `api.normalizeRgbState`, and `api.createStateGate`.
5. Expose optional mod endpoints through `onHttp`.

Reference mod:
- `mods/http-rgb-brand-mod/`

## Optional Core File Lock

Commands:

```powershell
npm run core:lock
npm run core:unlock
npm run core:lock:status
```

Manifest:
- `core/core-lock-manifest.json`

## Release Workflow

1. Stop bridge.
2. Sanitize and export:

```powershell
npm run sanitize:release
npm run export:redistributable
```

3. Zip:

```powershell
Compress-Archive -Path .\release\RaveLink-Bridge-Windows-v1.3.0\* -DestinationPath .\release\RaveLink-Bridge-Windows-v1.3.0.zip -Force
```

Output:
- `release/RaveLink-Bridge-Windows-v1.3.0`

## Security And Data Hygiene

- Keep local backups private (`backups/`, `core/backups/`).
- Do not publish real fixture credentials/tokens/IPs.
- Use `sanitize-release` before publishing redistributables.

## Related Docs

- Developer guide: `docs/DEVELOPER_GUIDE.md`
- Modding: `docs/MODS.md`
- Streaming integrations: `docs/STREAMING_INTEGRATIONS.md`
- Launch checklist: `docs/LAUNCH_CHECKLIST.md`
- Third-party notices: `THIRD_PARTY_NOTICES.md`
- 
<img alt="UI_GREEN" src="https://github.com/user-attachments/assets/34c965f8-5262-466d-b217-d87084f568ec" height="702" />
<img alt="UI_RED" src="https://github.com/user-attachments/assets/10122b60-abf7-4538-ae80-b84a3a55b5ae" height="702" />
<img alt="UI_ORANGE" src="https://github.com/user-attachments/assets/152771b7-d5aa-44ca-b483-94155f306523" height="702" />
<img alt="UI_BLUE" src="https://github.com/user-attachments/assets/fbf283fc-a1c1-4dc0-ace5-b1f4ff96f7a6" height="702" />

## License

ISC (`LICENSE`)

