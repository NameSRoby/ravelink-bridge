# RaveLink Bridge

Lightweight streamer-first local lighting bridge for Philips Hue + WiZ, with audio-reactive LIVE behavior, Twitch-friendly control paths, MIDI performance mapping, and a modular local mod surface.

Optional support: https://ko-fi.com/namesroby

## Open Source Note

RaveLink Bridge is open source.

If you fork or remix it and ship your own distro, attribution is appreciated but not required:

- `NameSRoby's RaveLink Bridge`

## Download

- Current Windows release (`v1.6.3`): https://github.com/NameSRoby/ravelink-bridge/releases/tag/v1.6.3
- Latest release page: https://github.com/NameSRoby/ravelink-bridge/releases/latest
- All releases: https://github.com/NameSRoby/ravelink-bridge/releases

This repository is aligned to `v1.6.3`.

## What This Is

RaveLink Bridge runs on your stream PC and turns live audio plus operator control into Hue and WiZ output.

Core capabilities in the current public release:

- audio-reactive LIVE lighting engine with scene, palette, brightness, and cadence control
- Twitch-oriented color / teach / rave control routes
- MIDI learn + binding workflow for performance control
- modular browser UI with onboarding, theme customization, and diagnostics
- local-first safe-internet + Twitch Helix redemption sync lane
- optional local mods without turning mods into boot dependencies

## Public Repo Boundary

This public repository keeps the runnable server source, UI, scripts, tests, and the full `docs/repo-documentation` book.

It intentionally does **not** include:

- local runtime state, logs, vaults, caches, and machine-specific data
- the current local song-request mod

Optional local mods can still be added later under `mods/`, and the public repo now keeps that dock folder plus a safe baseline `mods.config.json` in place. Local-only mod enablement should live in `mods/mods.local.config.json`, which stays out of source control and out of the packaged public release.

## Quick Install (Windows)

1. Download `RaveLink-Bridge-v1.6.3.zip` from the Releases page.
2. Extract it anywhere you want.
3. Run `RaveLink-Bridge-Start.bat`.
4. Open `http://127.0.0.1:5050` if the browser does not open automatically.

The packaged release already includes runtime dependencies so it behaves like an appliance-style local tool instead of a source checkout.

## Streamer Quick Start

If you just want to get lights moving:

1. Start the bridge with `RaveLink-Bridge-Start.bat`.
2. Open `http://127.0.0.1:5050`.
3. Go to `FIXTURES` and add your real Hue / WiZ fixtures.
4. Set routing so the fixtures you want to react are enabled for the engine.
5. Go to `AUDIO` and apply a capture profile.
6. Click `RAVE ON`.
7. Use `LIVE` to tune scenes, palette behavior, auto Hz, and brightness.

Recommended first-read tabs:

- `FIXTURES` for hardware
- `AUDIO` for capture
- `LIVE` for the show look
- `SYSTEM` for Twitch OAuth / widget / safe-internet setup

## Windows Launcher Notes

The Windows launcher is not a thin wrapper. It:

- bootstraps dependencies on first run when needed
- validates startup prerequisites
- checks for stale listeners on the bridge port
- avoids killing unrelated processes
- coordinates browser opening through `scripts/launcher-open-browser.js`

Useful flags:

- `RaveLink-Bridge-Start.bat --install-only`
- `RaveLink-Bridge-Start.bat --force-install`
- `RaveLink-Bridge-Start.bat --skip-install`

Graceful stop helper:

```bat
RaveLink-Bridge-Stop.bat
```

Bridge URL default:

`http://127.0.0.1:5050`

## Source Quick Start

If you are running from source instead of the release zip:

```bash
npm install
npm start
```

## Package Public Release

Build the public Windows release zip from source:

```bash
npm run package:release
```

This produces:

`dist/RaveLink-Bridge-v1.6.3.zip`

Release packaging rules:

- includes the runnable app plus `node_modules`
- excludes local runtime state and logs
- excludes the local song-request mod
- includes the repository documentation book

## Test and Verification

Basic test run:

```bash
npm test
```

High-confidence verification pass:

```bash
npm run verify:runtime-refactor
```

Additional gate commands:

```bash
npm run verify:architecture
npm run verify:security
npm run verify:audit
npm run verify:readiness
```

Optional baseline capture:

```bash
npm run baseline:lock
```

## Documentation

Primary docs live in:

- `docs/repo-documentation/README.md`

Third-party notices:

- `THIRD_PARTY_NOTICES.md`

## License

ISC (`LICENSE`)
