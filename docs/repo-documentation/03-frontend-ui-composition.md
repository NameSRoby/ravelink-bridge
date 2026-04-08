# 03) Frontend UI Composition

This chapter explains how the browser UI is assembled, how boot sequencing works, how runtime modules are organized, and why the frontend is intentionally built around adapters plus bounded runtime modules instead of a single app framework.

The core idea is that the frontend has structure even though it is script-manifest driven. Understanding that structure is the difference between making a safe UI change and accidentally creating a dead page with unbound controls.

## Learning Goals

By the end of this chapter, you should be able to:

- explain how the browser UI is assembled from templates at request time
- trace frontend startup from `GET /` to wired runtime controls
- extend UI behavior using the repository's orchestrator-plus-runtime module pattern
- add or change API route usage without scattering raw route strings across domain files

## 1. The UI Is Composed Server-Side

RaveLink does not serve a static, monolithic `public/index.html` as the source of truth. Instead, the server assembles the page from templates every time `GET /` or `GET /index.html` is requested.

The composition pipeline is owned by `src/app/ui/index-page.renderer.js`:

```js
const sectionPaths = {
  "{{CHROME}}": path.join(sectionDir, "chrome.html"),
  "{{PANEL_LIVE}}": path.join(sectionDir, "panel-live.html"),
  "{{PANEL_FIXTURES}}": path.join(sectionDir, "panel-fixtures.html"),
  "{{PANEL_AUDIO}}": path.join(sectionDir, "panel-audio.html"),
  "{{PANEL_MIDI}}": path.join(sectionDir, "panel-midi.html"),
  "{{PANEL_SYSTEM}}": path.join(sectionDir, "panel-system.html"),
  "{{PANEL_MODS}}": path.join(sectionDir, "panel-mods.html"),
  "{{SCRIPTS}}": path.join(sectionDir, "scripts.html")
};
```

This model gives you three useful guarantees:

1. UI ownership stays modular by panel.
2. Missing template parts fail early during render.
3. Script order is explicit in one manifest (`scripts.html`).

### Why this matters operationally

This template model is one of the main reasons the repo was able to split the UI into smaller runtime modules without turning the HTML into one giant page definition. Each panel can evolve independently while still producing one coherent shell.

## 2. Template Assembly Layers

The main layers are:

- Shell frame: `public/templates/index/shell.html`
- `<head>` metadata: `public/templates/index/head.html`
- Section partials: `public/templates/index/sections/*.html`
- Ordered script manifest: `public/templates/index/sections/scripts.html`

A key practical rule is that panel HTML IDs are contracts. Runtime modules expect specific IDs such as `onBtn`, `aApplyBtn`, `liveSyncGroupsSaveBtn`, and many more. If you rename an ID, you must update the owning JS runtime in the same change.

### The shell and the manifest solve different problems

- `shell.html` defines layout and placeholder ownership
- `scripts.html` defines evaluation order

Those are separate contracts. A page can render correctly but still be functionally dead if script order breaks. This is why `verify-script-manifest-order.js` exists.

## 3. Startup Sequence and Runtime Ownership

The startup coordinator is `public/assets/js/bootstrap.js`. It runs a deterministic sequence:

1. Load persisted preferences and system settings.
2. Hydrate LIVE mode policy (`hydrateLiveModePolicyUi`).
3. Boot LIVE controls (`bootLiveControlsUi`).
4. Initialize theme/navigation/shell behavior.
5. Start telemetry polling and monitor loops.
6. Hydrate audio startup data and device/app lists.

Boot steps use guarded wrappers that prevent one failing subsystem from collapsing the whole UI startup.

Ownership split:

- `public/assets/js/bootstrap.js` owns sequencing and delayed retry scheduling.
- `public/assets/js/app.js` now owns shared shell helpers only; it no longer schedules startup retries or executes fallback recovery.
- `public/assets/js/app.js` loads before domain runtimes so shared helpers such as `setBadge()` and `toFixedSafe()` are available while split scripts evaluate.
- `public/assets/js/domains/ui-collapsible-panels-runtime-ui.js` owns collapsible state and navigation helpers.

Recent cleanup:

- the old startup fallback shim and timed fallback passes were deleted after startup ownership moved fully into `bootstrap.js`.
- collapsible controls are initialized directly during normal boot, and navigation continues to use `setCollapsibleState()` without a partial-boot recovery path.

### Boot summary is a real diagnostic surface

`bootstrap.js` now emits a runtime summary:

```js
const bootSummary = {
  startedAt: Date.now(),
  completedAt: null,
  ok: false,
  steps: [],
  failed: [],
  skipped: []
};
window.__ravelinkBootSummary = bootSummary;
```

This matters because "UI rendered" is not the same thing as "UI booted correctly." The boot summary tells you:

- which steps ran
- which steps failed
- which optional steps were skipped
- whether the page should be considered healthy

## 4. Domain Composition Pattern (Orchestrator + Runtime Modules)

Large domains are split into:

- An orchestrator that preserves global contracts.
- Focused runtime modules that own one bounded concern.

Example: LIVE controls orchestration in `public/assets/js/domains/live-controls.js`:

```js
const { bootLiveControlsUi } = createLiveControlsRuntimeUi({
  wireLiveEngineActionsUi,
  applyLiveModeUiPolicy,
  isLiveProfilesOnlyModeUi,
  wireLiveSceneControlsUi,
  wireLiveSceneFilterControlsUi,
  wireLiveOverclockControlsUi,
  wireLiveSyncGroupsControlsUi,
  startLiveShellUiRuntime
});
```

The runtime boot (`live/live-controls-runtime-ui.js`) then enforces order and capability gating.

This pattern appears throughout the frontend:

- `telemetry.js` -> telemetry runtime modules
- `audio.js` -> startup, quick-tune, profile, app-isolation runtime modules
- `palette.js` + `palette-runtime-wiring-ui.js` -> global/brand view and action runtimes
- `system-flow.js` -> system runtime modules

### Why the split matters

The orchestrator preserves stable global names and boot surfaces. The sub-runtime owns the detailed logic. That makes it possible to refactor large domains without breaking every script that expects a specific global entry point.

## 5. Endpoint Adapter Rule: Transport Is Centralized

Route strings belong in `public/assets/js/domains/contracts/*.adapter.js`, not in random domain files.

Example (`live-endpoints.adapter.js`):

```js
const liveEndpointsAdapter = Object.freeze({
  getLiveStatus: () => getJson("/live/status"),
  patchSceneIntent: patch => postJson("/live/scene", patch),
  getTriggerMatrix: () => getJson("/live/scene-tuning"),
  patchTriggerMatrix: patch => postJson("/live/scene-tuning", patch),
  getSyncGroups: () => getJson("/live/sync-groups"),
  patchSyncGroups: patch => postJson("/live/sync-groups", patch),
  raveOn: () => api("/rave/on"),
  raveOff: () => api("/rave/off")
});
```

Domain modules call adapter methods, not raw routes. This makes backend contract migration a single-file update.

### Why this rule is strict

The repo added route-boundary tests because direct `getJson("/some/route")` calls scattered around domain code were a real source of regressions. If a contract changes:

- adapter-only transport means one file changes
- scattered transport means every domain file becomes a migration risk

## 6. UI Policy and Capability Gating (LIVE)

`live/live-shell-runtime-ui.js` applies policy based on `/live/status`:

- `full` mode: advanced LIVE controls available
- `profiles_only` mode: advanced sections hidden/disabled

This policy is enforced before advanced handlers run, so unsupported actions are visually and behaviorally gated.

This matters because the UI is not just "draw everything and hope." It actively adapts to backend capability and mode policy.

## 7. Runtime Dependency Guards

Recent refactors made the frontend stricter about missing dependencies. For example, `system-flow.js` now throws when required dependencies are missing instead of quietly substituting inert fallbacks:

```js
function getRequiredSystemFlowFunction(name) {
  const fn = systemFlowGlobal[name];
  if (typeof fn !== "function") {
    throw new Error(`system-flow missing required function dependency: ${name}`);
  }
  return fn;
}
```

This is important because a "soft-fail" frontend can look alive while actually doing nothing. The repo now prefers:

- explicit boot failure
- boot summary visibility
- browser boot tests

over fake-alive UI behavior.

## 8. Practical Extension Patterns

### Pattern A: Add a New UI Action Button

1. Add button markup in the owning panel partial.
2. Wire it in the owning runtime module.
3. Update wiring audit arrays if the domain tracks required button wiring.

Example wiring shape:

```js
if (el.myNewBtn) {
  el.myNewBtn.onclick = () => runLiveButtonAction(el.myNewBtn, "WORKING...", async () => {
    const r = await liveEndpointsAdapter.patchTriggerMatrix({
      scope: { level: "global" },
      override: { myFeatureFlag: true }
    });
    if (r?.ok && r?.data?.ok) sync();
  });
}
```

### Pattern B: Add a New Backend Route to Frontend

1. Add adapter method in the relevant `*.adapter.js` file.
2. Inject/use it from the owning runtime module.
3. Keep payload normalization in the runtime/domain layer.

### Pattern C: Split a Growing Runtime File

1. Keep existing global function names stable in the orchestrator.
2. Move detailed behavior into a `create...RuntimeUi` module.
3. Inject dependencies from the orchestrator.
4. Keep script load order deterministic in `scripts.html`.

## 9. DOM Registry and Selector Ownership

The repo also centralizes DOM lookups through `public/assets/js/core/dom.js` and the split DOM registry helpers. That means selector ownership is part of the frontend architecture, not an implementation afterthought.

Why that matters:

- missing DOM elements can be audited systematically
- browser boot tests can detect missing controls
- panel refactors do not have to rely on random ad-hoc `querySelector` calls

## 10. Mental Model for Safe UI Changes

Use this checklist whenever you extend frontend behavior:

1. Which panel partial owns the markup?
2. Which runtime module owns behavior?
3. Which adapter owns transport contracts?
4. Which audit/boot step confirms wiring?
5. Does mode policy (`full` vs `profiles_only`) need to gate this control?

When you answer these five questions first, most UI changes become straightforward and low-risk.
