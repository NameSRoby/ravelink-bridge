# 14. Audio, LIVE, and Engine Deep Dive

This chapter is for the part of the repo that usually feels hardest at first: sound comes in, operator intent exists in several places, and somehow the engine must produce deterministic lighting output without turning the code into one giant state blob.

The shortest accurate summary is:

```text
audio capture -> telemetry snapshot
operator intent -> LIVE compatibility state
engine runtime -> resolves telemetry + intent + fixture catalog
dispatch -> brand adapters
UI polling -> reads back canonical status and compatibility state
```

The difficult part is that these lanes are intentionally different.

- Audio capture is about what the machine hears.
- LIVE compatibility state is about what the operator wants.
- Engine-v2 runtime is about what should happen right now.

If you collapse those into one file or one data model, the system becomes impossible to reason about.

## 1. The Three-State Problem

Many bugs in this repo come from mixing up three different concepts:

1. **Observed state**: current audio telemetry, current active fixtures, current running processes.
2. **Persistent operator intent**: scene lock, sync groups, scoped tuning, palette overrides, audio config.
3. **Resolved runtime decision**: which scene should be active on this tick, what brightness should be sent, which fixtures should be excluded, what cadence is allowed by current hardware caps.

These map cleanly to concrete code:

```text
Observed state:
  src/domains/audio/audio-engine.port.js
  src/domains/audio/audio-capture.runtime.js
  src/domains/audio/audio-runtime.telemetry.js

Persistent operator intent:
  src/domains/live/live-compat.service.js
  runtime/live/compat.state.json
  runtime/live/profiles.json
  runtime/audio/audio.config.json

Resolved runtime decision:
  src/domains/engine-v2/engine.runtime.js
  src/domains/engine-v2/engine.scene-state.js
  src/domains/engine-v2/engine.runtime.*.js
```

If you keep this separation in your head while reading the code, the architecture becomes much more legible.

## 2. Audio Runtime Service: Why It Exists

`src/domains/audio/audio-runtime.service.js` is the compatibility-facing audio root. It does not directly try to do all capture work itself anymore. The file remains important because it is the contract boundary that routes talk to.

It owns:

- config persistence and patch normalization
- device and application discovery
- capture session lifecycle
- profile save/load/delete behavior
- telemetry projection for UI routes
- app-isolation lock and token logic

The large file was intentionally split into helpers so each hard lane could be reasoned about separately:

```text
audio-runtime.app-isolation.js
audio-runtime.device-discovery.js
audio-runtime.capture-session.js
audio-runtime.catalog.js
audio-runtime.session-config.js
audio-runtime.telemetry.js
```

That split matters because these are different problems:

- app isolation is process and browser-name reasoning
- device discovery is Windows endpoint and FFmpeg candidate reasoning
- capture-session logic is lifecycle and restart orchestration
- telemetry shaping is response-contract logic

## 3. Audio Capture Runtime: Where PCM Becomes Meaning

`src/domains/audio/audio-capture.runtime.js` is the execution side. It uses helper modules for:

- command construction
- subprocess lifecycle
- source normalization
- signal analysis

The core job is:

1. choose a capture command/backend
2. launch the process
3. detect when capture is truly alive
4. read PCM chunks
5. turn them into telemetry
6. publish telemetry into `audioEngine`

The important conceptual point is that process start success is not the same as audio readiness. The lifecycle helper waits for actual signal output before considering the lane live.

Representative pattern:

```js
const processInfo = await startCaptureProcess(args);
processInfo.onChunk(chunk => {
  const metrics = analyzeAudioChunk(chunk);
  audioEngine.updateTelemetry(metrics);
});
```

The real code has more lifecycle detail, but that is the design heart of it.

## 4. Desktop Capture vs App Isolation

The project supports both desktop loopback and app-isolated capture because the intended operator workflows differ:

- Desktop loopback is simplest and best for general reactive lighting.
- App isolation is for browser-targeted or app-targeted capture where multiple audio sources exist.

The app-isolation lane is hard because process names alone are not enough. Modern browsers often have multiple processes, helper processes, media subprocesses, and channel variants.

That is why `audio-runtime.app-isolation.js` contains logic such as:

- app token normalization
- channel-aware browser matching
- companion-process inference
- manual lock resolution
- representative PID selection

The Firefox/Nightly work is a good example. The system preserves the compatibility token `firefox`, but uses channel hints and process metadata to choose the right live process when stable and Nightly are both open.

## 5. Session Config Shaping: Why It Is Separate

Starting an audio session is not just “use whatever is in config.json.” The runtime must shape an effective session config using:

- persisted config
- discovered devices
- selected backend strategy
- app isolation/manual lock state
- live capture availability
- fallback source selection

That is why session config shaping lives in its own helper. It is a runtime decision, not raw persistence.

If a maintainer tries to shortcut this by reading config and spawning directly, they usually reintroduce bugs where:

- desktop capture does not restart when needed
- transient route metadata gets accidentally persisted
- fallback devices drift from the actual selected source
- app-isolated capture starts with stale process selection

## 6. LIVE Compatibility Service: The Operator Intent Store

`src/domains/live/live-compat.service.js` is often misunderstood. It is not the engine. It is not current telemetry. It is a compatibility and persistence service for operator-owned state.

It stores things like:

- scene lock or scene preference
- scene filter aggressiveness
- sync groups
- trigger matrix
- runtime tuning
- overclock compatibility state
- palette and fixture metric scoped overrides

This means a write such as:

```json
{
  "scope": { "level": "brand", "brand": "hue" },
  "override": {
    "runtimeTuning": {
      "sceneSwitchCooldownMs": 320,
      "impactHoldMs": 180
    }
  }
}
```

does not directly change lighting output. It changes the engine's future input. The engine still decides what to do on each tick.

This is a subtle but extremely important boundary.

## 7. Engine Runtime: The Resolver, Not the Store

`src/domains/engine-v2/engine.runtime.js` is the orchestrator that turns all the inputs into dispatch decisions.

Think of it as the runtime resolver:

```text
telemetry
+ fixture registry
+ hardware caps
+ live compat state
+ live profiles
+ palette service
= next dispatch frame
```

The file used to be much larger. It now delegates:

```text
engine.runtime.sync-groups.js
engine.runtime.profile.js
engine.runtime.fixture-catalog.js
engine.runtime.fixture-exclusions.js
engine.runtime.palette-mapper.js
engine.runtime.cadence.js
engine.runtime.palette-advance.js
```

That split is not cosmetic. It tells you which questions belong where:

- How do sync-group offsets map palette indexes? `engine.runtime.sync-groups.js`
- Which fixtures are even eligible for dispatch right now? `engine.runtime.fixture-catalog.js`
- How should removed fixtures behave? `engine.runtime.fixture-exclusions.js`
- How does the palette move over time? `engine.runtime.palette-advance.js`
- How fast may output move given current caps? `engine.runtime.cadence.js`

## 8. Scene State: The Brain of “Quiet, Loud, Calm, Impact”

`src/domains/engine-v2/engine.scene-state.js` is where the audio interpretation side becomes human-meaningful control behavior.

Its current split is:

```text
engine.scene-runtime-controls.js
engine.scene-auto-selection.js
engine.scene-bpm-state.js
engine.scene-section-state.js
engine.scene-cooldown-state.js
engine.scene-transition-state.js
```

These modules answer different questions:

- Which scene candidate best fits the current signal? `scene-auto-selection`
- What BPM should the system believe? `scene-bpm-state`
- Is the music quiet, normal, or loud in a stable way? `scene-section-state`
- Should a new scene be allowed yet? `scene-cooldown-state`
- How quickly should transitions move? `scene-transition-state`

### Why section-state exists

One of the most operator-visible bugs in lighting systems is brightness normalization that destroys the difference between quiet and loud passages.

`engine.scene-section-state.js` exists so the system can have a memory of loudness bands, not just the latest amplitude sample.

That lets the engine say:

- “this passage is still quiet”
- “this section is loud, but not impact-heavy”
- “hold some brightness floor because we are in a loud sustained section”

Without that memory, the output feels twitchy and emotionally flat.

## 9. Brightness Interpretation

The brightness system is now intentionally section-aware. The engine does not just map current RMS straight to a brightness number.

The runtime blends:

- adaptive current signal intensity
- section-state band (quiet / normal / loud)
- movement / impact interpretation
- brightness floor and ceiling tuning
- smoothing and transition timing

This is why very low and very loud passages can now feel more musically distinct than they did before. The engine is trying to interpret “what kind of passage is this?” rather than just “how large is the last number?”

## 10. Sync Groups and Fixture Exclusions

These two systems often get confused because both can reduce or alter output.

### Sync groups

Sync groups are about coordinated palette routing and motion:

- grouped fixtures can share phase
- offsets can deliberately shift phase
- reverse or remove behavior can be normalized consistently

### Fixture exclusions

Fixture exclusions are about removing fixtures from engine ownership:

- the engine should stop actively driving them
- one-shot removal effects may need to run
- smoothing state should be cleared so stale engine memory does not persist

The critical architectural point: exclusions change the dispatch map, not just the visible UI.

## 11. Frontend Control Flow

The frontend pieces for this subsystem are:

```text
public/assets/js/domains/audio.js
public/assets/js/domains/live-controls.js
public/assets/js/domains/telemetry.js
```

They each use adapters:

```text
audio-endpoints.adapter.js
live-endpoints.adapter.js
telemetry-endpoints.adapter.js
```

The UI is intentionally not responsible for deriving current truth. It polls canonical and compatibility surfaces:

- `/audio/status`
- `/audio/telemetry`
- `/live/status`
- `/rave/status`
- `/rave/telemetry`, `/hue/telemetry`, `/wiz/telemetry` where compatibility still matters

This is why UI code should never try to infer engine internals from local button state.

## 12. A Concrete Full Flow: RAVE ON

This flow is worth reading several times because it shows the whole architecture in motion.

### Step 1: UI button click

The LIVE tab power control triggers a handler in the owning runtime.

### Step 2: Adapter call

The frontend uses the adapter, not a raw route:

```js
await liveEndpointsAdapter.raveOn();
```

### Step 3: Route orchestration

The server route for `POST /rave/on` coordinates:

1. audio session startup
2. rave state start in `audioEngine`
3. engine-v2 start
4. optional mod hooks and hardware side effects

### Step 4: Runtime state changes

- `audioRuntimeService` starts capture
- `audioEngine` becomes rave-on
- `engineV2` begins ticking

### Step 5: Polling reconciliation

The browser poll runtimes pull updated status and telemetry. Buttons, badges, and scene/brightness state all reconcile from those read models.

The point is that the button does not directly “set its own active state.” The backend owns truth.

## 13. A Concrete Full Flow: App-Isolated Audio Apply

This is another important flow because it contains both persistence and restart semantics.

### UI side

The audio tab collects config and applies it through the audio adapter. The UI may request restart/apply metadata, but those fields are transient command intent.

### Backend side

`audio-runtime.service` accepts the patch, normalizes it, updates persistence-safe config, and decides whether the active session must restart.

The runtime intentionally strips transient fields before persisting. This prevents route intent from leaking into config storage.

That distinction is subtle:

- `restart: true` means “restart capture now”
- it does **not** mean “store restart: true forever in audio.config.json”

## 14. Common Misunderstandings

### “LIVE status and LIVE compatibility should be one route”

No. They answer different questions.

- `/live/status` should describe resolved current state.
- compatibility routes describe persisted operator intent and edit surfaces.

### “Engine-v2 should persist everything itself”

No. The engine should read persistent input state, not become the persistence owner for every editable UI lane.

### “Audio telemetry and engine scene state are the same”

No. Telemetry is rawer and more immediate. Scene state is interpreted and stateful.

## 15. Suggested Reading Order in Code

If you want to understand the subsystem deeply, read in this order:

1. `src/app/register-routes.js`
2. `src/domains/audio/audio-engine.port.js`
3. `src/domains/audio/audio-runtime.service.js`
4. `src/domains/audio/audio-capture.runtime.js`
5. `src/domains/live/live-compat.service.js`
6. `src/domains/engine-v2/engine.runtime.js`
7. `src/domains/engine-v2/engine.scene-state.js`
8. `public/assets/js/domains/audio.js`
9. `public/assets/js/domains/live-controls.js`
10. `public/assets/js/domains/telemetry.js`

Then read the focused helper files that correspond to the part you want to change.

## 16. Tests To Use While Editing

For targeted confidence:

```bash
node --test test/audio-runtime.service.test.js
node --test test/audio-runtime.device-discovery.test.js
node --test test/audio-runtime.capture-session.test.js
node --test test/audio-capture.command-builders.test.js
node --test test/audio-capture.process-lifecycle.test.js
node --test test/engine-v2.runtime.test.js
node --test test/engine-v2.scene-state.test.js
node --test test/engine-v2.scene-section-state.test.js
node --test test/engine-v2.scene-cooldown-state.test.js
```

For end-to-end confidence:

```bash
npm.cmd run verify:runtime-refactor
```
