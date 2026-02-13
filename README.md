# RaveLink Bridge

Lightweight and powerful streamer-first local lighting engine for Philips Hue + WiZ, with Twitch-ready controls and modular brand extension via local mods.

Optional support: https://ko-fi.com/namesroby

## Open Source Note

RaveLink-Bridge is open source. If you fork/remix and ship your own distro, attribution is appreciated (not required):
- "NameSroby's RaveLink-Bridge"

## Download

- Current Windows release (v1.3.1): https://github.com/NameSRoby/ravelink-bridge/releases/tag/v1.3.1
- All releases: https://github.com/NameSRoby/ravelink-bridge/releases

## What This Is

RaveLink Bridge runs on your stream PC and turns live audio + chat actions into Hue/WiZ light output.

- Audio-reactive engine for music/gameplay
- Twitch-triggerable color and scene control
- Channel points/reward friendly HTTP endpoints
- OBS dock URL built in (`/obs/dock`)
- MIDI controller mapping tab (learn + bindings + trigger tests)
- Mod system for adding other fixture brands without forking core Hue/WiZ transport logic

Developer tip:
- Most setup categories in this README have their own quick-start directly under the category heading (Streamer, Twitch, MIDI, OBS, Developer).

## Streamer Quick Start
**!! NEVER SHOW SERVER LOGS ON STREAM !!**
- *This tool has been conceptualised recently and is still missing security measures (future versions will have them patched in to make this tool more versatile)*

- *This should not be an issue as long as you run it only on your local machine and make sure you don't expose your server logs on stream!*

- *As long as you respect these warnings this software is competely safe and isolated to your pc*

- *This tool only recieves simple instructions (limited to smart bulb commands, which the tool itself has to recognize, only defined commands are **RELAYED** to the smart bulbs and **NEVER RUN** on this server) and does not communicate whith anything besides the smart bulbs in your local network!*

If your stream setup gremlin appears at 2AM, this checklist is built for that exact moment.

1. Install Node.js LTS from `https://nodejs.org`.
2. Double-click `RaveLink-Bridge.bat`.
3. Wait for the launcher window to show:
   - `Bridge URL: http://127.0.0.1:5050`
4. The browser should open automatically.
5. If the browser does not open automatically, open:
   - `http://127.0.0.1:5050`
6. Go to `FIXTURE LIST`:
   - Delete placeholder fixtures (`hue-main-1`, `wiz-background-1`, `wiz-custom-1`) if they are still there.
7. Add your real fixtures in `FIXTURE PAIRING / DEVICE SETUP`:
   - Hue: set `bridgeIp`, `username`, `lightId` (plus `bridgeId` + `clientKey` for Entertainment).
   - WiZ: set `ip`.
8. Go to `DEVICE ROUTING` and pick each fixture, then set modes:
   - `ENGINE` = audio reactive engine
   - `TWITCH` = chat/reward `/color` control
   - `CUSTOM` = manual/custom fixture behavior
9. Click `APPLY ROUTING` for each fixture you changed.
10. Click `TEST CONNECTIVITY` and confirm fixture target status is ready.
11. Start the show with `RAVE ON`.
12. Optional: open `MIDI` tab and map your controller buttons/knobs.
13. Stop with `RAVE OFF` when done.

**Stop options**
- `RaveLink-Bridge-Stop.bat`
- `Ctrl+C` in the launcher window
- `npm run stop` (terminal method)

Why this matters:
- Use one of the stop methods above so Node shuts down cleanly.
- If you just close windows/tabs the wrong way, the Node process can keep running in the background.
- That is not malware, just an unclean shutdown where the local bridge server did not exit properly.

**Terminal fallback (if needed)**

```powershell
npm install
npm start
```

## Twitch + Channel Points Setup

How this integration is meant to work:
- RaveLink Bridge runs locally on your stream PC (`http://127.0.0.1:5050`).
- Twitch reward listener code runs inside a StreamElements Custom Widget (overlay code).
- OBS loads that StreamElements overlay URL as a Browser Source.
- The integration bot must be connected to your channel chat (StreamElements bot, Streamer.bot account, Mix It Up, etc.), otherwise channel-point/chat activations are not seen.

If "where does this code go?" is ever the question, the answer is: inside the StreamElements widget JS panel, not in `server.js`.

### Option A: StreamElements Widget (overlay logic)

Use this exact template file:
- `INTEGRATIONS_TWITCH/START-HERE-STREAMELEMENTS-WIDGET-TEMPLATE/PASTE-INTO-STREAMELEMENTS-CUSTOM-WIDGET.js`

Equivalent legacy copy:
- `INTEGRATIONS_TWITCH/streamelements/reward-listener.template.js`

Step-by-step:
1. Start `RaveLink-Bridge.bat` first, so the local bridge is already live.
2. Make sure your integration bot is in your Twitch chat before testing rewards.
3. Make sure OBS is running and the StreamElements overlay Browser Source is active.
4. In Twitch Creator Dashboard, create your Channel Point rewards (for example `Rave`, `Teach`, `Color`).
5. Open Twitch Creator Dashboard -> Viewer Rewards -> Channel Points, then copy each reward ID.
6. Open the template file above in a code editor.
7. Edit these constants in that file:
   - `COLOR_REWARD_ID`
   - `TEACH_REWARD_ID`
   - `RAVE_REWARD_ID`
   - `TEACH_REWARD_ID` input format: `<name> <#RRGGBB>` (example `toxic_green #39ff14`).
   - Use underscores/hyphens in `<name>` (spaces are not supported in teach names).
8. Leave `BASE_URL = "http://127.0.0.1:5050"` when OBS + bridge run on the same PC.
9. Open StreamElements -> `My Overlays` -> your overlay -> `+` -> `Static/Custom` -> `Custom Widget`.
10. In widget editor:
   - Paste full template code into the `JS` tab.
   - `HTML`/`CSS` can stay empty for this listener-only widget.
11. Save the overlay.
12. Copy the overlay URL from StreamElements.
13. In OBS, add or update a `Browser Source` that points to that overlay URL.
14. Keep that Browser Source active during stream.
15. Trigger one reward in Twitch chat and confirm lights respond.

If rewards trigger in StreamElements but lights do not move, re-check:
- `BASE_URL` value
- reward IDs in the template
- widget code is in the StreamElements `JS` tab (not in bridge files)
- bridge is running (`http://127.0.0.1:5050` opens)
- integration bot is connected to chat
- OBS is running with the overlay Browser Source active

### Option B: Streamer.bot / Mix It Up / SAMMI / any bot with HTTP actions

Use reward triggers or chat command actions to call bridge endpoints, for example:
- `POST http://127.0.0.1:5050/rave/on`
- `POST http://127.0.0.1:5050/rave/off`
- `GET http://127.0.0.1:5050/color?value1=purple`
- `GET http://127.0.0.1:5050/teach?value1=toxic_green+%2339ff14`

### Overlay/Chat Bot Compatibility

Any overlay or bot can work if it can send HTTP requests to the bridge host.

- Local bot on stream PC: use `http://127.0.0.1:5050`.
- Bot on another machine: use the stream PC LAN IP (for example `http://192.168.1.x:5050`) and allow LAN access.
- Cloud bot service: cannot reach your localhost directly without a relay/tunnel. If you expose the bridge, secure it and limit commands.

## Stream Command Matrix (Channel Points First)

Plain-English flow:
1. Viewer redeems a channel point reward (optionally with text input).
2. Your bot/overlay reads that text and sends one HTTP request to the bridge.
3. The bridge applies the action to fixtures that are routed for `TWITCH`.

What the included StreamElements widget supports out of the box:
- `RAVE_REWARD_ID` -> calls `/rave/on` (then auto `/rave/off` after timeout).
- `COLOR_REWARD_ID` -> sends reward text to `/color?value1=...`.
- `TEACH_REWARD_ID` -> sends reward text to `/teach?value1=...`.

Concrete channel point examples (default widget behavior):

| Viewer input or reward text | Bot HTTP request | What happens |
|---|---|---|
| Reward title `RAVE` | `POST http://127.0.0.1:5050/rave/on` | Starts rave engine (default widget then auto-calls `/rave/off` after timeout). |
| Reward text `blue` | `GET http://127.0.0.1:5050/color?value1=blue` | Applies blue using current Twitch color config (default target is `hue`). |
| Reward text `wiz blue` | `GET http://127.0.0.1:5050/color?value1=wiz+blue` | Applies blue to WiZ-routed fixtures only. |
| Reward text `hue blue` | `GET http://127.0.0.1:5050/color?value1=hue+blue` | Applies blue to Hue-routed fixtures only. |
| Reward text `toxic_green #39ff14` (Teach reward) | `GET http://127.0.0.1:5050/teach?value1=toxic_green+%2339ff14` | Learns a new color alias named `toxic_green`. |

How much can you customize:
- You can name rewards anything (`Blue`, `Wiz Blue`, `Rave Start`, etc.).
- You can map one action to channel points, chat, deck buttons, or all of them.
- You can hardcode values in your bot or parse viewer-provided text.
- You can control who can trigger actions using reward/bot permission settings.
- Keep admin endpoints private (`/rave/panic`, `/system/stop`, `/rave/reload`).

Full endpoint reference:
The routes below are available in the bridge API, but anything beyond the 3 default widget reward IDs requires your own bot/automation mapping.

| Stream action idea | Endpoint | Example |
|---|---|---|
| Start show | `POST /rave/on` | `http://127.0.0.1:5050/rave/on` |
| Stop show | `POST /rave/off` | `http://127.0.0.1:5050/rave/off` |
| Force drop pulse | `POST /rave/drop` | `http://127.0.0.1:5050/rave/drop` |
| Teach color alias (`<name> <#RRGGBB>`) | `GET or POST /teach` | `/teach?value1=toxic_green+%2339ff14` |
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
- Teach payload format: `<name> <#RRGGBB>` (example `laser_blue #00aaff`, query-string encoded as `laser_blue+%2300aaff`)

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
- Route values shown in UI (`HUE_STATE`, `WIZ_PULSE`, `TWITCH_HUE`, `TWITCH_WIZ`) are derived from fixture mode toggles.
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

## Version 1.3.1 Patch Notes

- Fixture list reliability improved:
  - `FIXTURE LIST` now stays populated from the canonical fixture catalog.
  - Paired/saved fixtures no longer disappear until route selection is re-opened.
  - Poll fallback keeps fixture updates flowing even when some telemetry endpoints fail.
- Audio Control improvements:
  - Added `RESET AUDIO DEFAULTS` button to restore default audio config and apply immediately.
- Adaptive Meta tuning expanded across genres (not only metal):
  - Better high-intensity response under aggressive material.
  - Reduced tendency to sit at low Hz during strong passages.
  - 16Hz remains rare and only during extreme intensity/drop moments.
- Custom Fixture Control:
  - Added `RAVE-START UPDATE` alongside `RAVE-END UPDATE`.
  - Status now clearly shows start/stop hook states.
  - Added clearer disabled styling for non-interactive controls.
- Legacy automation UX:
  - `NO-CODE AUTOMATION RULES` is now clearly marked deprecated and replaced by `CUSTOM FIXTURE CONTROL`.
  - Legacy controls are greyed/locked by default and require explicit unlock.

For older major feature lists, see tag history under Releases.

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
node --check core\rave-engine.js
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
Compress-Archive -Path .\release\RaveLink-Bridge-Windows-v1.3.1\* -DestinationPath .\release\RaveLink-Bridge-Windows-v1.3.1.zip -Force
```

Output:
- `release/RaveLink-Bridge-Windows-v1.3.1`

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
## Notes

 - **I'm new to programing and this first started as a small project to have an independent tool for myself for my usecase (letting chat change the color of my smart bulbs)**
 - **Only as the code started getting expanded on did I realise that this could be a cool tool for more people to use**
 - **This caused me to have to completely rewrite full sections of the code to make it modular to accomodate as many fixtures as the user seems fit (this started with 3 bulbs and a hue bridge that I own)**
 - **This Project would never have reached this stage if it wasn't for AI tools that helped me a lot on solving problems debugging and doing math for me, structure the project, even teaching me how concepts I want to impliment could be implimented**

 - **Hence why it wasn't built with security vulnerabilities in mind as it was always meant to be ran on a local machine**
 - **Moving forwards I will be going through the code and apply those so this code can be safely used as an external server, or making it less dangerous for userers to download mods from other devs that have bad intentions**
 - **Otherwise as long as the machine is yours, this server only recieves one type of command externally and that values input from a twitch chat**
    - **Which it filters to only allow colors, like for example *blue* *hot pink* *#960018* or commands that teach colors to a library limited to hex codes**
      - **The software after checks if the recieved value matches it's defined library and relays it as an r,g,b value to the smart fixtures*
 - **NEVER is it possible to make the server run anything malicious code (unless your machine is already compromised), as the server only serves as a messenger**

 ## The UI
<img alt="UI_GREEN" src="https://github.com/user-attachments/assets/34c965f8-5262-466d-b217-d87084f568ec" height="702" />
<img alt="UI_RED" src="https://github.com/user-attachments/assets/10122b60-abf7-4538-ae80-b84a3a55b5ae" height="702" />
<img alt="UI_ORANGE" src="https://github.com/user-attachments/assets/152771b7-d5aa-44ca-b483-94155f306523" height="702" />
<img alt="UI_BLUE" src="https://github.com/user-attachments/assets/fbf283fc-a1c1-4dc0-ace5-b1f4ff96f7a6" height="702" />

## License

ISC (`LICENSE`)

