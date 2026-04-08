# 07) Practical Cookbook and Examples

This chapter is a task-oriented companion to the architecture chapters. Each recipe is designed for developers extending UI, audio, LIVE, mods, or diagnostics without violating the repo's ownership boundaries.

Every recipe follows the same strategy:

1. find the owner module
2. add or update adapter or route contracts
3. wire UI/runtime behavior in the owning layer
4. verify with the right tests and guardrails

## Recipe 1: Add a New LIVE Action Button

### Goal

Add a new button in the LIVE tab that triggers a backend action.

### Steps

1. add markup in `public/templates/index/sections/panel-live.html`
2. add endpoint method in `public/assets/js/domains/contracts/live-endpoints.adapter.js`
3. wire click handler in the owning runtime
4. confirm mode policy gating if the action is advanced

### Example

```js
// live-endpoints.adapter.js
myNewAction: () => postJson("/live/my-feature", {})
```

```js
// owning runtime
if (el.myNewActionBtn) {
  el.myNewActionBtn.onclick = () => runUiActionWithGroupLock("power_state", [el.myNewActionBtn], async () => {
    const r = await liveEndpointsAdapter.myNewAction();
    setBadge(el.health, r?.ok ? "ok" : "bad", r?.ok ? "ACTION OK" : "ACTION FAIL");
    sync();
  });
}
```

### Why this pattern is correct

The button:

- lives in panel HTML
- transports through the adapter
- runs behavior in the runtime

No layer is skipped.

## Recipe 2: Persist a New Scene Runtime Tuning Field

### Goal

Introduce a new runtime-tuning parameter under `/live/scene-tuning` or compatibility trigger-matrix state.

### Steps

1. add normalization/default in `src/domains/live/live-compat.service.js`
2. include it in route patch/read response
3. add UI input and binding in the owning LIVE runtime
4. update profile persistence if the field belongs in snapshots

### Example payload

```json
{
  "scope": { "level": "fixture", "brand": "hue", "fixtureId": "hue-bridge-1" },
  "override": {
    "runtimeTuning": {
      "sceneSwitchCooldownMs": 300,
      "impactHoldMs": 180
    }
  }
}
```

## Recipe 3: Add Audio Config Field with Safe Restart Behavior

### Goal

Add a new audio configuration flag that should restart capture if changed.

### Steps

1. add default and normalization in `src/domains/audio/audio-runtime.service.js`
2. include key in patch/get config flows
3. if capture behavior changes, add key to `AUDIO_CAPTURE_RESTART_KEYS`
4. wire UI input collection/apply in the owning audio runtime

### Wiring pattern

```js
const patch = collectAudioConfigFromInputs();
const r = await audioEndpointsAdapter.saveConfig(patch);
if (r?.ok && r?.data?.ok) {
  applyAudioConfigToInputs(r.data.config || {});
}
```

### Important caution

Do not persist command-only fields as real config. If you introduce `restart`, `apply`, or other control hints, keep them transient.

## Recipe 4: Add an Audio App Isolation Quick Action

### Goal

Expose a one-click action that forces app-isolation scan.

### Steps

1. add button and status text in the Audio panel
2. reuse `/audio/ffmpeg/app-isolation/scan`
3. use the shared audio button-action wrapper

### Example

```js
const payload = { reason: "manual_scan", force: true, forceRestart: false };
const r = await audioEndpointsAdapter.scanAppIsolation(payload);
updateAudioAppIsolationStatusText(r?.ok ? "Scan complete." : "Scan failed.");
```

## Recipe 5: Add Telemetry Field to LIVE HUD

### Goal

Display a new backend telemetry value in LIVE analyzer/status area.

### Steps

1. ensure backend telemetry emits the field
2. map it in `telemetry-poll-runtime-ui.js`
3. render/sync it in `telemetry-sync-runtime-ui.js` or monitor runtime
4. add a safe default so older snapshots do not break

### Example polling group

```js
const [rave, audio] = await Promise.all([
  telemetryEndpointsAdapter.getRaveStatus(),
  telemetryEndpointsAdapter.getAudioTelemetry()
]);
```

## Recipe 6: Split a Growing Runtime File Safely

### Goal

Split logic into a new `create...RuntimeUi` module without breaking boot.

### Steps

1. create new runtime file in domain folder
2. inject dependencies from orchestrator
3. add script include in `scripts.html` before the orchestrator that uses it
4. keep global function contracts stable

### Example composition pattern

```js
const { doThingUi } = createMyRuntimeUi({ ui, el, setBadge, adapter });
```

### Guardrail to remember

If you forget script order, the page may render but the runtime will fail during evaluation. Always treat `scripts.html` as part of the feature change.

## Recipe 7: Add a New Adapter Contract

### Goal

Expose a backend endpoint to a domain without scattering route strings.

### Steps

1. add method in the correct adapter under `public/assets/js/domains/contracts/`
2. update the consuming domain runtime to call this method
3. do not call `getJson` / `postJson` directly from unrelated files

### Example

```js
const telemetryEndpointsAdapter = Object.freeze({
  getAudioTelemetry: () => getJson("/audio/telemetry"),
  getMidiStatus: () => getJson("/midi/status")
});
```

## Recipe 8: Add New Sync Group Controls

### Goal

Extend fixture sync-group behavior for LIVE.

### Steps

1. update normalization and limits in the sync-group UI runtime
2. persist new fields in `live-compat.service.js`
3. keep canonical `/live/sync-groups` as the preferred write lane
4. only use compat fallback when legacy parity truly requires it

### Existing save pattern

```js
let response = await liveEndpointsAdapter.patchSyncGroups(profile);
if (!response.ok || !response.data || response.data.ok !== true) {
  response = await liveEndpointsAdapter.patchTriggerMatrix({
    scope: { level: "global" },
    override: { syncGroups: profile }
  });
}
```

Use a fallback like that only when the compatibility requirement is real. New UI work should prefer the canonical route first.

## Recipe 9: Add a New Panel Section

### Goal

Add a new high-level UI section while preserving composition rules.

### Steps

1. add partial file in `public/templates/index/sections/`
2. add placeholder token in `shell.html`
3. register token mapping in `src/app/ui/index-page.renderer.js`
4. add scripts in `scripts.html` if new runtime code is required

## Recipe 10: Debug Startup Wiring Failures

### Goal

Diagnose boot problems where controls render but do not respond.

### Steps

1. inspect `window.__ravelinkBootSummary`
2. check runtime audit objects
3. verify required elements exist and handlers are bound
4. confirm script order in `scripts.html`

### Useful runtime audit objects

- `window.__ravelinkLiveUiWiring`
- `window.__ravelinkLiveOwnership`
- `window.__ravelinkAudioUiWiring`

If these show missing/unwired controls, fix ownership and boot order first before changing business logic.

## Recipe 11: Add a New Mod Action Safely

### Goal

Expose a new mod capability through `/mods/:modId/:action`.

### Steps

1. implement the action in the mod export surface
2. classify it as viewer/admin/public in the mod's security logic
3. add or update local UI wiring if needed
4. add an integration test against the mod action contract

### Example shape

```js
actions: {
  diagnostics: ({ payload, api }) => ({
    status: 200,
    body: { ok: true, at: Date.now(), source: api.id }
  })
}
```

## Recipe 12: Add a New Persisted Runtime File

### Goal

Introduce a new JSON store without creating a normalization trap.

### Steps

1. decide the owning service first
2. define immutable defaults
3. normalize old/missing values on read
4. persist through that service only
5. document the file in `10-data-models-and-state-files.md`

This step matters because the repo's state files are only understandable when their owner and normalizer are clear.

## Closing Notes

These recipes work best when you stay faithful to the repository's architecture:

- template composition for HTML
- orchestrator/runtime split for domain JS
- adapter-only route strings
- normalized persistence on backend services
- explicit ownership between canonical and compatibility surfaces

That combination is what keeps UI/audio/live/rave/mod evolution safe as features grow.
