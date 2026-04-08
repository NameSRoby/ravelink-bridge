# 09. API Reference Index

This chapter is a practical route index for maintainers. It is not a replacement for reading the route files, but it is the quickest way to answer:

- which endpoint should I call?
- which file owns it?
- is it canonical or compatibility-facing?
- what is the endpoint actually used for?

Use this chapter as an index, then jump into `02-backend-routes-and-runtime.md` when you need deeper route behavior.

## 1) Core Service Endpoints

### Health and system visibility

- `GET /health`
- `GET /system/core-status`
- `GET /system/startup-readiness`
- `GET /system/launcher-diagnostics`
- `POST /system/stop`

### Primary owners

- canonical health route: `src/app/register-routes.js`
- system compatibility routes: `src/app/routes/compat/system.compat.routes.js`

### Typical usage

```bash
curl http://127.0.0.1:5050/health
curl http://127.0.0.1:5050/system/core-status
```

### What to use them for

- `GET /health`: broad runtime snapshot
- `GET /system/core-status`: operator-facing readiness synthesis
- `GET /system/startup-readiness`: lane-by-lane startup truth
- `GET /system/launcher-diagnostics`: browser-open diagnostics
- `POST /system/stop`: graceful shutdown through the normal lifecycle path

## 2) Twitch and Color Endpoints

- `POST /color`
- `POST /teach`
- `GET /color/prefixes`
- `POST /color/prefixes`

### Primary owner

- `src/app/register-routes.js`

### Example

```bash
curl -X POST http://127.0.0.1:5050/color \
  -H "Content-Type: application/json" \
  -d '{"text":"blue kitchen"}'
```

### Notes

- these routes remain important even after engine and LIVE refactors because the text-command control surface is still a first-class feature
- mutating calls are write-guarded

## 3) RAVE and LIVE Endpoints

### Canonical lifecycle and status

- `GET /rave/status`
- `POST /rave/on`
- `POST /rave/off`
- `GET /live/status`
- `GET /live/profiles`
- `POST /live/profiles/save`
- `POST /live/profiles/load`
- `DELETE /live/profiles/:name`

### Compatibility LIVE surface

- `GET/POST /rave/live/compatibility`
- `GET/POST /rave/live/trigger-matrix`
- `GET/POST /rave/live/sync-groups`
- `GET/POST /rave/palette`
- `GET/POST /rave/fixture-metrics`
- `POST /rave/fixture-routing/clear`
- `POST /rave/drop`
- `/rave/overclock/*`

### Primary owners

- canonical routes: `src/app/register-routes.js`
- compatibility routes: `src/app/routes/compat/live-rave.compat.routes.js`

### Example

```bash
curl -X POST http://127.0.0.1:5050/rave/live/trigger-matrix \
  -H "Content-Type: application/json" \
  -d '{"global":{"sceneFilter":{"enabled":true}}}'
```

### Notes

- canonical `/live/status` is now the main LIVE read model
- compatibility routes still matter because the UI and older tooling still rely on them

## 4) Audio Endpoints

### Runtime and telemetry

- `GET /audio/status`
- `GET /audio/telemetry`
- `POST /audio/telemetry`

### Config and discovery

- `GET/POST /audio/config`
- `GET /audio/devices`
- `GET /audio/apps`
- `GET /audio/profiles`
- `POST /audio/profiles/save`
- `POST /audio/profiles/load`
- `DELETE /audio/profiles/:name`
- `GET/POST /audio/reactivity-map`

### App isolation and tooling

- `GET /audio/ffmpeg/app-isolation/locks`
- `POST /audio/ffmpeg/app-isolation/locks/set`
- `POST /audio/ffmpeg/app-isolation/locks/clear`
- `POST /audio/ffmpeg/app-isolation/scan`
- `/audio/rust/transport-worker/*`
- `/audio/optional-tools/status`

### Primary owner

- `src/app/routes/compat/audio.compat.routes.js`

### Notes

- most operator-facing audio configuration is still served through compatibility routes
- mutating audio routes are write-guarded
- some endpoints affect persisted config, others affect transient runtime state only

## 5) Mods and Mod UI Endpoints

### Platform and loader endpoints

- `GET /mods`
- `GET /mods/config`
- `POST /mods/config`
- `POST /mods/reload`
- `GET /mods/runtime`
- `GET /mods/hooks`
- `POST /mods/hooks/:hook`
- `POST /mods/import`
- `GET /mods/ui/catalog`

### Mod action endpoints

- `GET /mods/:modId/:action`
- `POST /mods/:modId/:action`
- nested action paths such as `/mods/:modId/admin/policy/set`

### Mod UI endpoints

- `GET /mods-ui/:modId/`
- `GET /mods-ui/:modId/*assetPath`

### Primary owner

- `src/app/routes/compat/mods.compat.routes.js`

### Example

```bash
curl -X POST http://127.0.0.1:5050/mods/song-request-mod/request \
  -H "Content-Type: application/json" \
  -d '{"text":"Daft Punk - Around The World","username":"viewer","userId":"123"}'
```

## 6) Engine v2 Endpoints

- `GET /engine/v2/status`
- `GET /engine/v2/palette`
- `POST /engine/v2/palette/custom-color`
- `POST /engine/v2/palette/sequence`
- `POST /engine/v2/palette/cycle`
- `POST /engine/v2/palette/advance`
- `POST /engine/v2/start`
- `POST /engine/v2/stop`
- `POST /engine/v2/tick`

### Primary owner

- `src/app/register-routes.js`

### Notes

- these are closer to canonical engine control than the compatibility LIVE surface
- palette routes are often easier to understand if read together with engine palette service code

## 7) Fixtures and Hardware Adapter Endpoints

- `GET /fixtures/*`
- `POST /fixtures/*`
- `/hue/discover`
- `/hue/pair`
- `/hue/pair/all`
- `/hue/transport`
- `/wiz/discover`
- `GET /hue/telemetry`
- `GET /wiz/telemetry`

### Primary owners

- hardware config and compatibility routes: `src/app/routes/compat/fixtures-hardware.compat.routes.js`
- compatibility telemetry reads: `src/app/routes/compat/telemetry.compat.routes.js`

### Notes

- some of these routes are setup and provisioning flows
- others are status or telemetry reads
- the ownership split between hardware routes and telemetry routes is intentional after the compat extraction

## 8) MIDI Endpoints

- `GET /midi/status`
- `GET /midi/config`
- `POST /midi/config`
- MIDI learning or mapping routes under `/midi/*`

### Primary owner

- `src/app/routes/compat/midi.compat.routes.js`

### Notes

- MIDI remains compatibility-oriented because the UI and operator workflow are still evolving

## 9) Route Ownership Quick Reference

- canonical routes: `src/app/register-routes.js`
- compat composition: `src/app/register-compat-routes.js`
- audio compat: `src/app/routes/compat/audio.compat.routes.js`
- fixtures and hardware compat: `src/app/routes/compat/fixtures-hardware.compat.routes.js`
- live and rave compat: `src/app/routes/compat/live-rave.compat.routes.js`
- midi compat: `src/app/routes/compat/midi.compat.routes.js`
- mods compat: `src/app/routes/compat/mods.compat.routes.js`
- system compat: `src/app/routes/compat/system.compat.routes.js`
- telemetry compat: `src/app/routes/compat/telemetry.compat.routes.js`

## 10) How to Use This Index Safely

When you find a route here, do not stop at the URL. Next ask:

1. is it canonical or compatibility-facing?
2. which route file or registrar owns it?
3. which service actually implements the behavior?
4. does the browser call it through an adapter already?

That habit is what turns this index from a lookup table into a real maintenance tool.
