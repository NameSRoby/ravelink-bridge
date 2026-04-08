# RaveLink Bridge

Lightweight and powerful streamer-first local lighting engine for Philips Hue + WiZ, with Twitch-ready controls, MIDI performance mapping, audio-reactive LIVE behavior, and modular local extension points.

Optional support: https://ko-fi.com/namesroby

## Open Source Note

RaveLink Bridge is open source. If you fork/remix and ship your own distro, attribution is appreciated but not required:
- "NameSroby's RaveLink-Bridge"

## Download

- Current Windows release (v1.6.2): https://github.com/NameSRoby/ravelink-bridge/releases/latest
- All releases: https://github.com/NameSRoby/ravelink-bridge/releases

This repository is aligned to `v1.6.2`.

## Quick Install (Windows)

1. Preferred when available: download `RaveLink-Bridge-Windows-v1.6.2-setup-installer.exe` and run it.
2. Portable fallback: download `RaveLink-Bridge-Windows-v1.6.2-self-contained.zip` and extract it.
3. Standard ZIP fallback: download `RaveLink-Bridge-Windows-v1.6.2.zip` and extract it.
4. Run `RaveLink-Bridge-Start.bat`.
5. Open `http://127.0.0.1:5050`.

## v1.6.2 (Public Refresh + UI/Runtime Rework)

This release is the big public refresh since the older public builds.

- Server UI refresh:
  - LIVE, Fixtures, Audio, MIDI, Mods, and System were reorganized and cleaned up heavily
  - expanded theme customization while keeping the classic preset spirit
  - onboarding/tour system added across the server UI with per-tab replay
- Runtime/engine/audio improvements:
  - desktop capture/app isolation flow was cleaned up
  - scene, brightness, cadence, and compatibility boundaries were refactored and tuned
  - MIDI was reworked into an action-first learn workflow that better fits the current server
- Packaging/public release boundary:
  - Windows installer is back
  - self-contained and standard zip builds are included again
  - local runtime state and local-only mods are excluded from the public repo/release
  - the packaged `docs/repo-documentation` set is now much more detailed and maintainer-friendly

Detailed release notes:
- https://github.com/NameSRoby/ravelink-bridge/releases/tag/v1.6.2

## What This Is

RaveLink Bridge runs on your stream PC and turns live audio + operator/chat actions into Hue/WiZ light output.

- Audio-reactive LIVE engine for music/gameplay
- Twitch-triggerable color and rave control paths
- Channel points / reward friendly HTTP surface
- OBS dock URL built in (`/obs/dock`)
- MIDI controller mapping tab (learn + bindings + trigger tests)
- Local-first safe internet + Twitch Helix redemption sync lane
- Optional local mods without making mods a required boot dependency

## Public Repo Boundary (v1.6.2)

This public repository keeps the runnable server source, UI, scripts, tests, and the full `docs/repo-documentation` book.

It intentionally does **not** include:

- local runtime state, logs, vaults, caches, and machine-specific user data
- the current local song-request mod

Optional local mods can still be added later under `mods/`, but they are not bundled in this public source tree or in the packaged public release.

> Developer note: this README is intentionally streamer-first. The deep maintainer material lives under `docs/repo-documentation/`.

## Streamer Quick Start

If your stream setup gremlin appears at 2AM, this checklist is built for that exact moment.

1. If you used the Windows installer or self-contained ZIP, you do not need a separate Node install.
   - Source/minimal ZIP users: install Node.js LTS from `https://nodejs.org`.
2. Double-click `RaveLink-Bridge-Start.bat`.
   - Packaged distro builds ship with runtime dependencies included.
3. Wait for the launcher window to show:
   - `Bridge URL: http://127.0.0.1:5050`
4. The browser should open automatically.
5. If the browser does not open automatically, open:
   - `http://127.0.0.1:5050`
6. Go to `FIXTURES`:
   - pair your real Hue / WiZ fixtures
7. Go to `AUDIO`:
   - apply a capture profile and confirm the engine is receiving signal
8. Go to `LIVE`:
   - tune scenes, palette, auto Hz, and brightness
9. Start the show with `RAVE ON`.
10. Optional: open `MIDI` and map your controller.
11. Optional: open `SYSTEM` and set up Twitch OAuth / widget / safe-internet lanes.

**Stop options**
- `RaveLink-Bridge-Stop.bat`
- `Ctrl+C` in the launcher window
- `npm run stop` (terminal method)

Why this matters:
- Use one of the stop methods above so Node shuts down cleanly.
- If you just close windows/tabs the wrong way, the Node process can keep running in the background.
- That is not malware, just an unclean shutdown where the local bridge server did not exit properly.

**Terminal fallback (if needed)**

```bash
npm install
npm start
```

## Twitch + Channel Points Setup

How this integration is meant to work:
- RaveLink Bridge runs locally on your stream PC (`http://127.0.0.1:5050`).
- Twitch reward listener code runs inside your chosen overlay/bot lane.
- OBS/browser sources or automation tools can call the bridge locally.
- The integration bot must actually be connected to your channel/chat context or activations are not seen.

Typical control families exposed by the bridge:
- `POST /rave/on`
- `POST /rave/off`
- `POST /color`
- `POST /teach`

For the deeper current setup model, including safe-internet and Helix redemption sync, use:
- `docs/repo-documentation/15-system-oauth-helix-and-safe-internet.md`
- `docs/repo-documentation/07-practical-cookbook-and-examples.md`

## MIDI Quick Start

1. Open the `MIDI` tab.
   - It auto-shows when a MIDI input device is detected.
   - If no device is detected, you can force-show the MIDI tab from the settings cog.
2. Select `MIDI INPUT PORT` and save config.
3. Choose a learn action.
4. Arm learn.
5. Touch the controller.
6. Verify with a trigger test and watch the binding summary.

Notes:
- The current MIDI workflow is action-first, not raw note-number-first.
- The goal is to map LIVE behavior like drop hit, scene auto, overclock, palette order, and transport toggles quickly.

## OBS Dock

Add this URL to OBS custom docks:

- `http://127.0.0.1:5050/obs/dock`

Optional expanded layout URL:

- `http://127.0.0.1:5050/obs/dock?compact=0`

Notes:
- The dock URL redirects to `/?obsDock=1&compact=...` and enables dock-specific layout behavior.
- Remove or rename docks from OBS `View -> Docks -> Custom Browser Docks`.

## Version 1.6.2 Notes

- This is a major public refresh release, not just a small hotfix build.
- Main focus:
  - server UI modernization and onboarding
  - runtime/engine/audio cleanup and tuning
  - restored Windows packaging artifacts
  - sanitized public repo boundary for open release
- Private/local-only mods are intentionally outside this public package.

## Developer Quick Start

Developer tip:
- Most setup categories in this README have their own quick-start directly under the category heading (Streamer, Twitch, MIDI, OBS, Developer).

1. Install dependencies and run:

```powershell
npm install
npm start
```

2. Open `http://127.0.0.1:5050`.
3. Run the main verification pass:

```powershell
npm run verify:runtime-refactor
```

4. Package public release artifacts:

```powershell
npm run package:release
npm run package:installer
```

## Repository Map

- `src/`: server/runtime/domain source
- `public/`: browser UI, templates, styles, frontend runtime composition
- `scripts/`: verification, release, packaging, and helper automation
- `test/`: runtime, browser, route, docs, and architecture guard suites
- `docs/repo-documentation/`: packaged maintainer/study-guide documentation
- `THIRD_PARTY_NOTICES.md`: third-party notices included in public release

## Runtime Architecture

1. Audio/runtime services collect signal and session state.
2. Engine-v2 derives scene, palette, cadence, brightness, and intent state.
3. Fixture/routing layers resolve which brand/fixture targets are eligible.
4. Built-in Hue/WiZ transports send output with scheduler/state gating.
5. Optional mods can observe/extend behavior through supported surfaces.

Core API families:
- `/rave/*`
- `/audio/*`
- `/fixtures/*`
- `/hue/*`
- `/wiz/*`
- `/mods/*`
- `/midi/*`
- `/system/*`

## Release Workflow

1. Stop bridge.
2. Package the public release:

```powershell
npm run package:release
npm run package:installer
```

Outputs:
- `dist/RaveLink-Bridge-Windows-v1.6.2.zip`
- `dist/RaveLink-Bridge-Windows-v1.6.2-self-contained.zip`
- `dist/RaveLink-Bridge-Windows-v1.6.2-setup-installer.exe`

## Security And Data Hygiene

- Keep local backups private.
- Do not publish real fixture credentials, tokens, or IPs.
- Public release packaging excludes local runtime state and local-only mods.
- The current song-request mod is intentionally local-only and excluded from the public repo/release.

## Related Docs

Primary docs set:
- `docs/repo-documentation/README.md`

Supporting packaged notice:
- `THIRD_PARTY_NOTICES.md`

## License

ISC (`LICENSE`)
