# 12. Troubleshooting and Debug Playbook

Use this playbook when behavior is unclear, inconsistent, or failing under real usage. The goal is not only to list checks. The goal is to help you debug in the right order so you do not waste time patching the wrong layer.

The most important debugging rule in this repo is:

> first identify which layer is supposed to own the truth you are looking at

Many of the hardest bugs in this codebase come from confusing one layer's state for another:

- UI state vs runtime state
- compatibility state vs engine state
- mod queue state vs browser player state
- startup readiness vs “server is listening”

## 1) Startup Problems

### Symptom: server starts but UI does not open

Check:

1. `runtime/logs/launcher-browser-open.log`
2. `GET /system/startup-readiness`
3. `GET /system/launcher-diagnostics`

Interpretation:

- if the server is healthy but launch diagnostics show scheduling or launcher failure, this is a browser-open issue, not a server-start issue
- if readiness shows blocking lanes, the UI may open into an incomplete runtime state

### Symptom: server exits during boot

Check:

1. `runtime/logs/startup-latest.log`
2. lifecycle handlers in `src/app/index.js`
3. service creation and path wiring in `src/app/create-server.js`

Interpretation:

- failure before listen usually points at composition or startup service construction
- failure after listen but during early runtime often points at background startup work, optional subsystem initialization, or recoverable-error bursts

## 2) Browser UI Problems

### Symptom: UI renders but buttons do nothing

Check in this order:

1. browser console errors
2. `window.__ravelinkBootSummary`
3. domain-specific audit objects such as:
   - `window.__ravelinkLiveUiWiring`
   - `window.__ravelinkLiveOwnership`
   - `window.__ravelinkAudioUiWiring`
4. script order in `public/templates/index/sections/scripts.html`

Interpretation:

- if boot summary shows failures, do not assume routes are broken
- if a wiring audit says controls were not bound, inspect the owning runtime module before touching backend code

### Symptom: onboarding highlights the wrong thing or feels unreadable

Check:

1. onboarding target selectors in the tour runtime
2. tab and panel visibility before the step renders
3. current CSS focus and overlay treatment

Interpretation:

- onboarding bugs are often selector or layout timing problems, not generic styling problems

## 3) Audio Issues

### Symptom: no telemetry movement

Check:

1. `GET /audio/status`
2. `GET /audio/telemetry`
3. `GET /audio/devices`
4. `GET /audio/apps`

Interpretation:

- if `/audio/status` shows idle or failed session, debug capture startup first
- if status looks active but telemetry is flat, debug the capture runtime and signal analyzer path
- if devices or apps are missing, inspect discovery and backend selection first

### Symptom: desktop capture or app isolation is selecting the wrong source

Check:

1. `GET /audio/ffmpeg/app-isolation/locks`
2. `POST /audio/ffmpeg/app-isolation/scan`
3. `GET /audio/config`

Then apply a known override:

```bash
curl -X POST http://127.0.0.1:5050/audio/ffmpeg/app-isolation/locks/set \
  -H "Content-Type: application/json" \
  -d '{"sourceToken":"spotify","captureToken":"spotify","restart":true}'
```

Interpretation:

- if the lock fixes it, the failure is often token or process-selection ambiguity
- if the lock does not fix it, inspect device discovery and capture-session logic next

## 4) RAVE and LIVE Issues

### Symptom: rave button state and runtime behavior disagree

Check:

1. `GET /rave/status`
2. `GET /rave/telemetry`
3. `GET /engine/v2/status`
4. browser LIVE telemetry state

Interpretation:

- disagreement can come from stale browser reconciliation, not only from backend lifecycle failure
- if backend state is correct and UI is wrong, inspect the telemetry poll and sync runtimes

### Symptom: live settings do not persist

Check:

1. write request payload
2. readback from `/rave/live/compatibility` or canonical LIVE routes
3. `runtime/live/compat.state.json`
4. normalization in `live-compat.service.js`

Interpretation:

- if the write route accepts but readback is wrong, inspect normalization or persistence
- if persistence is correct but UI still looks wrong, inspect hydration and reconciliation on the browser side

## 5) Mod and Widget Issues

### Symptom: mod action returns unexpected payload

Check:

1. `GET /mods/runtime`
2. the exact action payload you sent
3. mod-local event or status output
4. the action router in the mod itself

Interpretation:

- if the loader says the mod is not loaded, stop there
- if the mod is loaded but the payload is wrong, inspect route-to-action normalization

### Symptom: StreamElements widget does not trigger the expected behavior

Check:

1. reward IDs and generated widget constants
2. request shape reaching `/mods/.../se_command` or related endpoints
3. dedupe flow
4. permission and security settings
5. whether the generated template was recopied after recent fixes

Interpretation:

- widget bugs often come from stale pasted template code or dedupe logic rather than the queue core

## 6) Queue and Command Flow Debug for the Song Request Mod

Use this order:

1. inspect queue state in the mod UI
2. inspect `state`, `events`, and `status` endpoints
3. test known commands such as remove or skip with controlled identities
4. inspect `playerActions` and `nowPlaying`
5. inspect browser bridge behavior only after server queue logic makes sense

Interpretation:

- queue order bugs are often server-side state issues
- “Apple player did something weird” is not enough to conclude the browser bridge is the first broken layer

## 7) System OAuth, Gateway, and Reconcile Issues

### Symptom: Helix reconciliation is not working

Check:

1. system OAuth status in the System tab
2. `/system/oauth/*` responses
3. required scopes and readiness in core or system status surfaces
4. reconcile result payloads and errors

Interpretation:

- many failures are actually missing or expired token state
- some failures are scope mismatch, not transport failure
- if gateway status is not ready, fix outbound capability before debugging reconcile logic

## 8) High-Value Logs and Files

Use these first:

- `runtime/logs/startup-latest.log`
- `runtime/logs/launcher-browser-open.log`
- `runtime/live/compat.state.json`
- `runtime/audio/audio.config.json`
- system OAuth vault and related runtime files
- mod `.runtime/*` files for the song-request mod

These files are high-value because they correspond to major ownership boundaries:

- startup
- browser open behavior
- LIVE persisted intent
- audio config
- system auth
- mod runtime state

## 9) Fast Verification Commands

Use these after you have a hypothesis:

```bash
npm test
npm run verify:architecture
npm run verify:security
npm run verify:readiness
npm run verify:mods
npm run verify:runtime-refactor
```

The right command depends on the bug class:

- route or structural issue: `verify:architecture`
- security or write-guard issue: `verify:security`
- song-request/widget issue: `verify:mods`
- broad confidence after refactor-sensitive changes: `verify:runtime-refactor`

## 10) Debugging Discipline

Use this discipline consistently:

1. isolate one domain first
2. capture baseline request and response before changing code
3. identify the owner of the truth you are debugging
4. patch one layer at a time
5. run the smallest relevant tests first
6. retest manually after targeted tests pass

This discipline matters because many failures in this repo are cross-layer. If you change multiple layers at once, you can “fix” the symptom while making ownership harder to reason about.

## 11) Use the Deep Dives When the Failure Is Conceptual

When you can reproduce a problem but still do not understand which layer is supposed to own it, stop and read the deeper chapter for that subsystem before changing code:

- browser UI feels dead or controls do nothing: `13-ui-shell-onboarding-theme-and-mod-docking.md`
- audio reacts oddly or LIVE and engine state feel inconsistent: `14-audio-live-engine-deep-dive.md`
- Twitch OAuth, Helix, gateway, or redemption sync feel confusing: `15-system-oauth-helix-and-safe-internet.md`
- song-request queue, widget, player, or history behavior is strange: `16-song-request-player-widget-and-queue-deep-dive.md`

Many of the repository's hardest bugs are not caused by one bad line. They are caused by misunderstanding which layer owns which truth.

## 12) Final Rule

When debugging this repository, do not start with the most visible symptom. Start with the most authoritative owner of the state behind that symptom.

That rule will save you more time than any single log line or helper command.
