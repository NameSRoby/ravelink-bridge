# 17. Maintainer Code Walkthroughs

This chapter is the "how do I actually work in this repo without breaking five adjacent systems?" guide.

The earlier chapters explain architecture and runtime logic. This chapter explains how to move through the code practically, how to trace behavior, and how to make changes in ways that preserve the boundaries the refactors were trying to create.

Think of it as a set of field guides.

## 1. Walkthrough: Trace A Dead UI Control

When a browser control exists but "does nothing," do not start by changing its handler. Trace the whole contract chain.

Use this order:

1. confirm the control exists in template markup
2. confirm its ID is registered in `dom.js` or `dom-domain-registry.js`
3. confirm the owning runtime module reads that handle
4. confirm the runtime module binds the event
5. confirm the event path calls an endpoint adapter, not an inline route
6. confirm the adapter returns the normalized shape the runtime expects
7. confirm bootstrap/script order let that runtime execute at all

The smallest useful end-to-end example is:

```html
<button id="aApplyBtn" type="button">APPLY + START AUDIO</button>
```

```js
// public/assets/js/core/dom.js
aApplyBtn: document.getElementById("aApplyBtn")
```

```js
// public/assets/js/domains/audio/audio-config-actions-ui.js
if (el.aApplyBtn) {
  el.aApplyBtn.onclick = () => runAudioConfigApply();
}
```

```js
// public/assets/js/domains/contracts/audio-endpoints.adapter.js
patchAudioConfig: payload => postJson("/audio/config", payload)
```

If the handler exists but the page still feels dead, check browser boot and script order next. The UI has a real boot summary now:

```js
const bootSummaryTarget = typeof window !== "undefined" ? window : globalThis;
if (bootSummaryTarget) bootSummaryTarget.__ravelinkBootSummary = bootSummary;
```

That is one of the highest-value debugging aids in the browser layer.

## 2. Walkthrough: Add A New Browser Control Safely

Use this checklist every time:

1. add markup in `public/templates/index/sections/*.html`
2. register the handle in `public/assets/js/core/dom.js` or query collection in `dom-query-collections.js`
3. bind logic in the owning runtime module
4. call an endpoint adapter, not a raw route string
5. update relevant tooltip and onboarding if it is user-facing
6. update script manifest if you added a new runtime module
7. update UI inventory / guardrail tests

If you skip step 4, you erode the route-boundary rule.
If you skip step 6, you get the classic "looks present, never binds" failure.
If you skip step 7, the next cleanup pass will not know the control is intentional.

## 3. Walkthrough: Change Browser Startup Without Rebreaking The UI

The browser shell is staged. Startup ownership is centralized in `public/assets/js/bootstrap.js`.

That means:

- `bootstrap.js` owns startup sequencing
- `app.js` owns shared shell helpers only
- domain modules should expose callable runtime functions, not run side effects on load

When adding startup work:

1. decide whether the work is blocking or optional
2. prefer `runBootStep()` for blocking behavior
3. prefer `runOptionalBootStep()` or fire-and-log for soft dependencies
4. keep timing, retries, and failure recording in bootstrap rather than reintroducing random fallback loops elsewhere

Representative pattern:

```js
await runBootStep("hydrateAudioStartupDataUi", () => hydrateAudioStartupDataUi(), { timeoutMs: 12000 });
await runOptionalBootStep("refreshFixturesFromServer", () => refreshFixturesFromServer({ attempts: 5 }), { timeoutMs: 6000 });
```

The deep rule here is:

Do not let individual domains reinvent startup orchestration in private.

## 4. Walkthrough: Add Or Change An API Route

Backend route work should usually be traced through:

1. canonical route registrar or compat route registrar
2. domain service
3. persistence/runtime collaborators
4. frontend endpoint adapter
5. frontend runtime module

A healthy route change looks like this:

```js
app.post("/audio/config", enforceWriteAccess, async (req, res) => {
  res.json(await audioRuntimeService.patchConfig(getRequestMap(req.body)));
});
```

Good properties of this shape:

- route is thin
- write access is explicit
- payload normalization happens once
- the service owns behavior

Bad smell:

- route handler containing business logic branches
- browser runtime calling route strings directly
- compatibility shims quietly mutating payloads without documentation

## 5. Walkthrough: Change Audio Capture Behavior

The audio domain gets easier once you stop treating `audio-runtime.service.js` as the only place to look.

Use this reading order:

```text
src/domains/audio/audio-runtime.service.js
src/domains/audio/audio-runtime.session-config.js
src/domains/audio/audio-runtime.capture-session.js
src/domains/audio/audio-runtime.device-discovery.js
src/domains/audio/audio-runtime.app-isolation.js
src/domains/audio/audio-capture.runtime.js
src/domains/audio/audio-capture.command-builders.js
src/domains/audio/audio-capture.process-lifecycle.js
src/domains/audio/audio-capture.signal-analyzer.js
```

Then ask which layer you are actually changing:

- config/persistence?
- discovery?
- launch command choice?
- process lifecycle?
- telemetry math?
- UI projection?

That question prevents the classic bug where a maintainer "fixes" desktop capture in the persistence layer even though the bug lived in lifecycle or command building.

## 6. Walkthrough: Tune LIVE / Engine Behavior Without Making It Mushy

The audio/LIVE/engine boundary is one of the most conceptually important in the repo:

- audio = observed machine state
- LIVE compat = persistent operator intent
- engine-v2 = resolved runtime decision

When changing effect behavior, ask which of these you mean:

1. Should the system hear something differently?
2. Should the operator intent model store a different setting?
3. Should the engine interpret the same inputs differently?

For example, brightness tuning for quiet vs loud passages belongs in the engine scene state logic, not in raw audio telemetry math.

The scene-state helper split now gives you a useful map:

```text
engine.scene-auto-selection.js
engine.scene-bpm-state.js
engine.scene-section-state.js
engine.scene-cooldown-state.js
engine.scene-transition-state.js
engine.scene-runtime-controls.js
```

Pick one. If you feel tempted to change two or three at once, stop and name the boundary first.

## 7. Walkthrough: Change Queue Behavior In The Song-Request Mod

The fastest way to break the mod is to confuse queue order with player observation.

When changing queue behavior, trace:

1. queue state selection
2. dispatch-state computation
3. player-action enqueue
4. browser-driver reconciliation
5. history side effects

Do not jump straight from "remove song" to "splice some array" unless you have already decided whether you are removing:

- a queued request
- a submitted tail entry
- a current request
- a browser-only current song that was never from the queue

Those cases do not mean the same thing.

## 8. Walkthrough: Add A Tour Step Or Docked Mod Step

Server-owned onboarding lives in `public/assets/js/domains/onboarding-tour-runtime-ui.js`.

Add a server step when:

- the feature is part of the core server experience
- the step can be targeted by stable server markup
- the step should exist even if no mod is loaded

Use mod-contributed steps when:

- the UI belongs to a mod iframe
- the mod may be hotloaded away
- the server should not persist or require those steps

The mod host bridge listens for:

```js
if (data.type === "ravelink:mod-onboarding-steps") {
  dispatchModUiOnboardingSteps(data);
}
```

That design keeps mod docking optional and disposable.

## 9. Walkthrough: Add A New Theme Field

The theme system is now rich enough that adding one field should be treated as a multi-file contract change.

Typical required updates:

1. `public/assets/js/shared/ui-contract.js`
2. `public/assets/js/core/ui-state.js`
3. `public/templates/index/sections/chrome.html`
4. `public/assets/js/core/dom.js`
5. `public/assets/js/core/dom-query-collections.js`
6. `public/assets/js/domains/live/live-theme-config-runtime-ui.js`
7. `public/assets/js/domains/live/live-theme-shell-ui.js`
8. `public/assets/js/domains/mods/mods-ui-host-runtime-ui.js`
9. mod UI theme receiver if embedded mods should match it
10. tests

If you update only the theme panel and CSS variables, the server UI may work but embedded mod UIs will silently drift.

## 10. Walkthrough: Keep Mods Removable While Improving Integration

This repo intentionally supports stronger integration without creating hard dependency knots.

That means:

- mod onboarding can dock into server onboarding
- mod widget generation can optionally bundle into the server widget
- mod OAuth affordances can optionally dock into the server panel
- theme propagation can flow from host to mod iframe

But the design rule is always:

If the mod vanishes, the server must still make sense.

That is why combined widget generation is "best effort" and not "the server widget now depends on mod output."

## 11. Walkthrough: Use Guardrails Instead Of Memory

This repo now has a lot of guardrails. Use them on purpose.

High-value ones:

```text
test/architecture-guardrails.test.js
test/docs-ownership-alignment.test.js
test/ui-browser-boot-bindings.test.js
test/ui-public-inventory-guard.test.js
scripts/verify-domain-file-budgets.js
scripts/verify-domain-doc-comments.js
scripts/verify-script-manifest-order.js
scripts/verify-domain-route-boundary.js
npm.cmd run verify:runtime-refactor
```

Do not rely on memory for:

- script order
- DOM inventory
- file size drift
- docs alignment
- route-boundary purity

That is exactly what the guardrails are for.

## 12. Walkthrough: Write Better Repository Docs

Since this documentation set is now meant to teach the repo deeply, good doc updates should do more than list files.

Strong doc additions include:

- a runtime map
- why the split exists
- a representative code example
- common failure modes
- practical change rules

Weak doc additions usually look like:

- file catalogs with no logic
- generic prose like "this handles data"
- descriptions that repeat function names without explaining state boundaries

When documenting a hard subsystem, always answer:

1. what truth does this layer own?
2. what truth does it explicitly not own?
3. what does it receive?
4. what does it emit?
5. what breaks if someone collapses this separation?

## 13. Code Reading Strategy For Giant Files

Some files are still large. When faced with one:

1. search for exported/public functions first
2. identify the state object(s)
3. identify normalization helpers
4. identify timers, loops, or workers
5. identify route/UI entry points into the file
6. read by responsibility cluster, not linearly

This is especially important for:

- `mods/song-request-mod/index.js`
- `public/assets/js/domains/live/live-theme-shell-ui.js`
- any route registrar

Large does not always mean tangled. Sometimes it means "several nearby clusters still live together."

## 14. A Good End-To-End Change Ritual

Here is the safest general pattern for working in this repo:

1. identify the owner layer first
2. make the smallest boundary-respecting change
3. update or add tests in the touched domain
4. run focused checks first
5. run `npm.cmd run verify:runtime-refactor` for broader confidence
6. update docs if the mental model changed

That last step matters. A lot of the pain in codebases like this comes from architecture evolving faster than the explanations people rely on.

## 15. If You Only Remember Five Rules

1. Browser controls are contracts, not just DOM nodes.
2. Endpoint adapters own routes; runtimes own behavior.
3. Audio, LIVE compat, and engine-v2 are three different truths.
4. Mods may integrate deeply, but they must remain removable.
5. Gateway-first + server-owned reconcile beats ad-hoc widget authority.

If you hold those five rules, most of the repository will stay understandable even when the exact files change.
