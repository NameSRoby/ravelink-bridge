# 04) Audio, Live, and RAVE Runtime

This chapter explains how audio capture, LIVE compatibility state, RAVE lifecycle control, and engine interpretation work together. The hard part of this subsystem is not any one file. The hard part is that several layers are all involved:

- capture/runtime state
- engine-facing telemetry
- persisted LIVE operator intent
- lifecycle routes
- browser sync and control surfaces

This chapter is meant to make those boundaries clear enough that you can reason about failures without mixing them together.

## Learning Goals

By the end of this chapter, you should be able to:

- trace RAVE on/off across backend services
- explain the difference between audio capture state and engine-facing telemetry
- explain the difference between LIVE compatibility state and live engine tick state
- add a new audio or LIVE field without putting it in the wrong layer

## 1. The Four-Lane Mental Model

This subsystem becomes understandable once you separate it into four lanes:

1. audio capture/runtime ownership
2. engine interpretation/runtime ownership
3. LIVE compatibility and persisted operator intent
4. frontend control and sync ownership

In file terms:

### Audio capture/runtime

- `src/domains/audio/audio-runtime.service.js`
- `src/domains/audio/audio-capture.runtime.js`
- extracted helpers such as:
  - `audio-runtime.app-isolation.js`
  - `audio-runtime.device-discovery.js`
  - `audio-runtime.capture-session.js`
  - `audio-runtime.catalog.js`

### Engine interpretation/runtime

- `src/domains/audio/audio-engine.port.js`
- `src/domains/engine-v2/engine.runtime.js`
- `src/domains/engine-v2/engine.scene-state.js`
- extracted scene/runtime helpers

### LIVE compatibility

- `src/domains/live/live-compat.service.js`
- `src/domains/live/live-profile.service.js`

### Frontend control/sync

- `public/assets/js/domains/live-controls.js`
- `public/assets/js/domains/audio.js`
- `public/assets/js/domains/telemetry.js`
- `public/assets/js/domains/contracts/live-endpoints.adapter.js`
- `public/assets/js/domains/contracts/audio-endpoints.adapter.js`

If you keep these four lanes separate in your head, most confusing behavior becomes explainable.

## 2. The Difference Between Audio Runtime and Audio Engine

One of the most common mistakes is assuming `audio-runtime.service.js` and `audio-engine.port.js` are the same kind of thing.

They are not.

### `audio-runtime.service.js`

This is the operator/runtime control service. It owns:

- config normalization
- saved profiles
- app isolation
- device discovery
- session start/stop/restart

### `audio-engine.port.js`

This is the engine-facing audio state bridge. It owns:

- rave active/inactive state
- current audio status
- current normalized telemetry
- the runtime-facing “what does the rest of the system see right now?” contract

That split matters because:

- the runtime service can restart, patch, or rediscover
- the engine-facing port still needs a stable view of current audio state

If you blur these together, you will put fields in the wrong place and confuse persistence with runtime state.

## 3. RAVE On: The Real Lifecycle

The best route to study is `POST /rave/on` in [`src/app/register-routes.js`](../../src/app/register-routes.js).

Conceptually, the route does this:

1. start or restart audio capture
2. reject if audio cannot be established
3. mark rave active in the audio engine
4. start engine v2
5. optionally sync Hue transport for active fixtures
6. notify mods with `onRaveStart`

This is why the route is useful to read. It shows that RAVE on is not a single toggle. It is a coordinated transition across several lanes.

### Why audio starts first

Because the engine depends on telemetry. If capture cannot start, allowing rave to enter an “on but blind” state would create confusing runtime behavior.

### Why mods are invoked last

Because mod hooks should observe an already-established runtime transition, not try to race the fundamental audio/engine startup path.

## 4. RAVE Off: Why It Is Not Just the Reverse Order by Accident

`POST /rave/off` coordinates:

1. stop rave in `audioEngine`
2. stop the audio session
3. stop engine v2
4. notify mods with `onRaveStop`
5. apply Twitch RAVE-off color profile

This order matters because the system wants:

- runtime state to stop moving
- capture to stop
- engine ticks to stop
- mods to observe the stop
- final visual fallback color behavior to apply

If these responsibilities were interleaved in arbitrary order, shutdown behavior would be much harder to reason about.

## 5. Audio Capture Strategy: What `audio-runtime.service.js` Really Decides

The audio runtime service is now smaller than it used to be because several lanes were extracted, but it still owns the high-level runtime decision tree.

### Key extracted helper modules

- [`audio-runtime.app-isolation.js`](../../src/domains/audio/audio-runtime.app-isolation.js)
- [`audio-runtime.device-discovery.js`](../../src/domains/audio/audio-runtime.device-discovery.js)
- [`audio-runtime.capture-session.js`](../../src/domains/audio/audio-runtime.capture-session.js)
- [`audio-runtime.catalog.js`](../../src/domains/audio/audio-runtime.catalog.js)

### What each one now owns

#### App isolation helper

Owns:

- token normalization
- Firefox/Nightly channel hints
- process relationship scoring
- representative PID selection

#### Device discovery helper

Owns:

- Windows endpoint probing
- desktop output resolution
- FFmpeg DShow ranking
- default-output selection

#### Capture session helper

Owns:

- start/restart/stop session sequencing
- backend strategy application
- capture-session state transitions

#### Catalog helper

Owns:

- app list shaping
- telemetry/config fallback app rows
- companion-map projection

This split is important because it makes the service readable again:

- service = top-level runtime decisions
- helper modules = dense bounded logic

## 6. The Capture Runtime: From Process Spawn to Telemetry

Low-level execution lives in [`src/domains/audio/audio-capture.runtime.js`](../../src/domains/audio/audio-capture.runtime.js), which now composes:

- `audio-capture.command-builders.js`
- `audio-capture.process-lifecycle.js`
- `audio-capture.launcher-utils.js`
- `audio-capture.signal-analyzer.js`

This separation is very useful conceptually:

### Command builders

Own the question:

> what command should be run for this capture strategy?

### Process lifecycle

Owns the question:

> once a capture child process exists, how do we supervise startup, activity, failure, and exit?

### Signal analyzer

Owns the question:

> once PCM data arrives, how do we convert it into telemetry fields the engine can use?

This decomposition is a good example of the repo's refactor style: separate “build command,” “run process,” and “interpret signal.”

## 7. LIVE Compatibility State Is Persisted Operator Intent

[`src/domains/live/live-compat.service.js`](../../src/domains/live/live-compat.service.js) is often misunderstood.

It is not the live engine tick state.

It is the persisted compatibility/intent layer that stores operator-facing state such as:

- scene lock and scene intent
- trigger matrix overrides
- runtime tuning
- sync groups
- overclock compatibility state

This is why routes like:

- `GET/POST /rave/live/compatibility`
- `GET/POST /rave/live/trigger-matrix`
- `GET/POST /rave/live/sync-groups`

are so important. They are not speaking directly to a running tick loop. They are speaking to the persisted compatibility bridge the engine and UI both understand.

## 8. Engine Runtime vs Scene State

The engine side now has clearer internal boundaries too.

### `engine.runtime.js`

Owns per-tick orchestration:

- scheduler cadence
- sync-group application
- fixture inclusion/exclusion
- palette advancement
- runtime dispatch sequencing

The dense logic has been progressively extracted into helpers like:

- `engine.runtime.sync-groups.js`
- `engine.runtime.profile.js`
- `engine.runtime.fixture-exclusions.js`
- `engine.runtime.fixture-catalog.js`
- `engine.runtime.cadence.js`
- `engine.runtime.palette-advance.js`

### `engine.scene-state.js`

Owns scene interpretation logic:

- scene selection
- BPM state
- section-state derivation
- cooldown logic
- transition smoothing

And it now composes helpers such as:

- `engine.scene-runtime-controls.js`
- `engine.scene-auto-selection.js`
- `engine.scene-bpm-state.js`
- `engine.scene-section-state.js`
- `engine.scene-cooldown-state.js`
- `engine.scene-transition-state.js`

This split matters because engine runtime orchestration and scene interpretation are related but not the same problem.

## 9. A Concrete Example: Why Brightness Tuning Lives Where It Does

Recent tuning work made brightness interpretation more section-aware so quiet and loud passages feel more correct.

That logic belongs in scene or interpretation code, not in:

- the route layer
- the audio capture service
- the browser UI

Why?

Because brightness response is an interpretation policy built from telemetry and musical context. That makes it engine scene-state logic.

This is a useful general rule:

> if a feature is answering “how should music telemetry feel as visual behavior?”, it probably belongs near scene-state or engine policy, not in the raw capture layer

## 10. Frontend LIVE and Audio Control Ownership

The browser side of this subsystem is intentionally split:

### Audio UI

- `audio.js` orchestrates audio domain composition
- runtime helpers own narrower lanes such as config, profiles, startup data, telemetry, and app selection

### LIVE UI

- `live-controls.js` orchestrates LIVE control boot
- runtime modules own power, scene filters, sync groups, overclock, profiles, and shell policy

### Telemetry UI

- polling and reconciliation live under `public/assets/js/domains/telemetry/`

This matters because the browser does not directly micromanage the engine. It:

1. writes normalized intent through adapters
2. polls canonical or compatibility status
3. reconciles the visual state from returned snapshots

## 11. The Most Important Adapter Calls in This Subsystem

These calls define a lot of the browser/backend contract:

```js
await liveEndpointsAdapter.patchTriggerMatrix({
  scope: { level: "brand", brand: "hue" },
  override: {
    runtimeTuning: { bpmSourceMode: "hybrid", sceneSwitchCooldownMs: 320 }
  }
});
```

```js
const result = await audioEndpointsAdapter.saveConfig({
  inputBackend: "auto",
  ffmpegAppIsolationEnabled: true,
  ffmpegAppIsolationPrimaryApp: "spotify"
});
```

These are useful examples because they show the intended model:

- UI sends normalized payloads
- route/service layer persists or applies them
- UI later hydrates from returned status or config

## 12. Extension Guidance: Where to Put New Fields

When adding a field, first classify what kind of field it is.

### If it is an audio capture or runtime setting

Put it through:

- `audio-runtime.service.js`
- config normalization
- relevant restart-sensitive logic
- audio UI config collection/apply code

### If it is an engine interpretation or tuning setting

Put it through:

- `live-compat.service.js` if it is persisted operator intent
- `engine.scene-state.js` or related helpers if it changes interpretation logic

### If it is a purely visual UI state

Keep it in browser runtime code and do not invent backend persistence unless it is truly operator state that must survive reloads.

## 13. Debugging Checklist for This Subsystem

When audio, LIVE, or RAVE behavior feels wrong, use this order:

1. `GET /audio/status`
2. `GET /audio/telemetry`
3. `GET /rave/status`
4. `GET /engine/v2/status`
5. `GET /live/status`
6. `GET /rave/live/compatibility`
7. frontend telemetry or LIVE audit objects in the browser

This order separates:

- capture failure
- telemetry absence
- rave lifecycle mismatch
- engine runtime issues
- persisted compatibility mismatch
- browser reconciliation issues

## 14. Core Principle

This subsystem stays understandable when you keep one rule in mind:

> raw capture, runtime interpretation, persisted operator intent, and browser synchronization are different layers

When changes stay in the correct layer, audio and LIVE behavior remain predictable even as features get more sophisticated.
