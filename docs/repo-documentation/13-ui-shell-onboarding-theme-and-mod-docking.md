# 13. UI Shell, Onboarding, Theme, and Mod Docking Deep Dive

This chapter explains the browser shell as a runtime system. The goal is to make the UI understandable at the level where a maintainer can add a control, move a section, change the theme editor, add onboarding steps, or allow a mod to dock into the server experience without breaking startup.

The key idea: the browser UI is not a pile of independent scripts. It is a staged runtime with explicit ownership.

```text
server-rendered templates
  -> DOM registry
  -> shared shell helpers
  -> endpoint adapters
  -> domain runtime modules
  -> bootstrap sequencer
  -> telemetry polling and reactive UI reconciliation
```

## 1. The Browser Page Is a Contract Graph

Every visible control begins as template markup under `public/templates/index/sections`. A button is not “wired” just because it exists. It becomes a live control only after this full chain is satisfied:

1. The template declares a stable ID or data attribute.
2. `public/assets/js/core/dom.js` or `public/assets/js/core/dom-domain-registry.js` registers that element.
3. The owning runtime module reads `el.someId`.
4. The runtime binds event handlers.
5. The handler calls an endpoint adapter, not an inline route string.
6. The adapter returns a normalized response.
7. The runtime updates UI state or triggers a refresh.

For example, a simple button flow looks like this:

```html
<button id="aApplyBtn" type="button">APPLY + START AUDIO</button>
```

```js
// public/assets/js/core/dom.js
const el = {
  aApplyBtn: document.getElementById("aApplyBtn")
};
```

```js
// public/assets/js/domains/audio/audio-config-actions-ui.js
if (el.aApplyBtn) {
  el.aApplyBtn.onclick = () => runAudioConfigApply();
}
```

The important part is not the syntax. The important part is that ownership is traceable. If `aApplyBtn` fails, you can inspect one chain instead of searching the entire UI.

## 2. Script Order Is Runtime Architecture

`public/templates/index/sections/scripts.html` is the browser manifest. It is deliberately not bundled because this project favors easy runtime inspection and deterministic load order.

The high-level order is:

```text
core state
core DOM registry
core HTTP helpers
shared contracts
endpoint adapters
domain runtimes
domain orchestrators
shell utilities
LIVE shell/theme/onboarding
profile/runtime tail
bootstrap
```

Why this matters:

- `dom.js` must load after template IDs exist and after domain registry helpers exist.
- endpoint adapters must load before domain runtimes call route contracts.
- split runtime modules must load before orchestrators compose them.
- `bootstrap.js` must run last because it starts the app.

If a button exists but does nothing, inspect load order first. A script evaluation error before handler binding will make the UI look alive while behavior is dead.

The guardrail for this is `test/architecture-guardrails.test.js`, which checks script inventory and ordering.

## 3. DOM Registry Rules

The DOM registry is intentionally strict. If an interactive ID is in a template, it should be either:

- registered in `dom.js` or `dom-domain-registry.js`, or
- explicitly passive, meaning it is a layout anchor and not a control.

The inventory guard checks both directions:

```js
// conceptual shape from test/ui-public-inventory-guard.test.js
const templateIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
const registeredIds = new Set(
  [...registrySource.matchAll(/getElementById\("([^"]+)"\)/g)].map(match => match[1])
);
```

This catches two common UI bugs:

1. A template ID was added but no runtime owns it.
2. A DOM handle remains registered after the control was removed.

When adding a new UI control, update the tests in the same change if the new control is intentionally passive or query-selected through a collection.

## 4. Onboarding Tour Runtime

The onboarding runtime lives at `public/assets/js/domains/onboarding-tour-runtime-ui.js`.

It exists because the old first-run card only acknowledged setup. It did not teach the app. The new runtime is a real tour:

- it can run the full server tour
- it can run tab-specific tours
- it highlights a target section
- it scrolls the target into view
- it lets compatible mods contribute steps
- it remains safe if a mod is removed

The runtime is created from `live-theme-shell-ui.js`:

```js
const onboardingTourRuntime = createOnboardingTourRuntimeUi({
  el,
  ui,
  documentRef: document,
  windowRef: window,
  localStorageRef: localStorage,
  showTab,
  setBadge,
  tabTourButtons
});
```

The dependency injection here is deliberate. The tour runtime should not reach across the whole page by accident. It receives only the shell capabilities it needs:

- `el` for known DOM handles
- `ui` for shared state
- `showTab` to move the user to the right tab
- `setBadge` for status feedback
- `tabTourButtons` for focused replay controls

## 5. How a Tour Step Works

A server-owned tour step has this shape:

```js
{
  tab: "audio",
  target: "#aApplyBtn",
  title: "Audio capture",
  body: "Apply and start audio after selecting desktop/app capture."
}
```

When rendered, the tour runtime does this:

1. Switches to the step's tab with `showTab(step.tab)`.
2. Locates the target with `document.querySelector(step.target)`.
3. Falls back to the tab page if the specific target is unavailable.
4. Scrolls the target into view.
5. Positions the highlight rectangle using `getBoundingClientRect()`.
6. Places the instruction card near the target, clamped to the viewport.
7. Updates progress and Back/Next/Done controls.

The fallback behavior matters. A tour step should not break the whole onboarding flow if a feature is hidden, a mod is missing, or MIDI is not enabled.

## 6. Tab-Scoped Replay Buttons

The tab bar includes small help buttons:

```html
<button class="tabTourBtn" type="button" data-tour-tab="audio" aria-label="Replay Audio tab tour">?</button>
```

These are query-owned by `dom-query-collections.js`:

```js
tabTourButtons: Array.from(documentRef.querySelectorAll("[data-tour-tab]"))
```

The tour runtime binds them once:

```js
for (const btn of tabTourButtonsRef) {
  btn.addEventListener("click", event => {
    event.preventDefault();
    startOnboardingTour({ tab: btn.dataset.tourTab });
  });
}
```

This is intentionally not handled by `ui-navigation.js`. Navigation owns tab switching; onboarding owns tour activation.

## 7. Mod-Contributed Onboarding Steps

Mods can contribute steps without becoming hard dependencies. The song-request mod does this from its iframe:

```js
window.parent.postMessage({
  type: "ravelink:mod-onboarding-steps",
  modId: detectModId(),
  steps: [
    {
      title: "Song requests as a control panel",
      body: "Use the Requests tab locally as broadcaster controls."
    }
  ]
}, "*");
```

The server host does not let arbitrary page scripts directly mutate onboarding state. `mods-ui-host-runtime-ui.js` receives messages only from the current mod iframe content window, then dispatches a host-local event:

```js
if (data.type === "ravelink:mod-onboarding-steps") {
  dispatchModUiOnboardingSteps(data);
}
```

The onboarding runtime listens for that host event:

```js
windowRef.addEventListener("ravelink:mod-onboarding-steps", event => {
  const detail = event.detail || {};
  registerOnboardingSteps(detail.modId || "mod", detail.steps || []);
});
```

The important design constraint is that mod steps are ephemeral. They live in browser memory and are scoped to loaded UI state. Removing a mod removes its contribution naturally because the server does not persist or require those steps.

## 8. Theme Runtime

The theme pipeline is split across:

- `public/assets/js/shared/ui-contract.js`: preset definitions and storage key
- `public/assets/js/domains/live/live-theme-config-runtime-ui.js`: normalization, CSS variable writes, persistence, theme event emission
- `public/assets/js/domains/live/live-theme-shell-ui.js`: theme panel controls and event binding
- `public/assets/js/domains/mods/mods-ui-host-runtime-ui.js`: forwards theme updates into mod iframes

The expanded theme config includes:

```js
{
  bg: "#050507",
  panel: "#0b0e18",
  panel2: "#121a2f",
  accent: "#8b001f",
  edge: "#233055",
  btnBg: "#14182c",
  text: "#eaeaea",
  ok: "#19ff6a",
  warn: "#ffb000",
  bad: "#ff4444",
  glow: 67
}
```

`glow` is stored as a percentage-like integer, then converted to alpha for `--accentGlow`.

```js
const accentGlow = hexToRgba(next.accent, next.glow / 100);
root.style.setProperty("--accentGlow", accentGlow);
```

This keeps the UI simple for users while preserving a clean CSS variable output.

## 9. Theme Broadcast to Mods

When the theme changes, the server UI dispatches:

```js
window.dispatchEvent(new CustomEvent("ravelink:themechange", { detail }));
```

The mod host bridges that into the iframe:

```js
frameWindow.postMessage({
  type: "ravelink:theme",
  version: 1,
  source: "ravelink-bridge",
  theme: { accent, bg, panel, panel2, edge, btnBg, text, ok, warn, bad }
}, "*");
```

The song-request mod applies those as its own CSS variables:

```js
setVar("--accent", theme.accent);
setVar("--button-bg", theme.btnBg);
setVar("--ok", theme.ok);
setVar("--warn", theme.warn);
setVar("--bad", theme.bad);
```

This lets mods feel native when embedded while still staying standalone-compatible when opened directly.

## 10. Widget and OAuth Docking Model

The System widget panel now exposes two related choices:

- separate server + mod widgets, recommended
- combined widget when the selected mod supports widget generation

The rule is simple: separate widgets are the stable default. Combined widgets are a convenience layer.

When combined mode is selected, `system-widget-template-runtime-ui.js`:

1. generates the server widget normally
2. finds the selected mod UI ID from `ui.modUiSelectedId`
3. reads saved mod widget preferences from local storage
4. calls the selected mod action `admin_widget_template_get`
5. appends the mod widget script if generation succeeds
6. keeps the server widget script if mod generation fails

Representative logic:

```js
const response = await modsEndpointsAdapter.invokeAction(
  modId,
  "admin_widget_template_get",
  "POST",
  modPayload
);

if (!response.ok || response.json?.ok !== true) {
  return { ok: false, script: systemScript, appended: false };
}

return {
  ok: true,
  appended: true,
  script: `${systemScript}\n\n/* docked mod widget */\n${response.json.script}`
};
```

This is what makes docking safe. If the mod is removed, disabled, or incompatible, server widget generation still works.

## 11. How To Add a New Theme Field

To add a new theme field, update all of these:

1. Add preset defaults in `shared/ui-contract.js`.
2. Add default state in `core/ui-state.js`.
3. Add input markup with `data-theme-custom="fieldName"` in `chrome.html`.
4. Add a DOM handle in `dom.js` only if a runtime needs a direct handle.
5. Normalize the field in `live-theme-config-runtime-ui.js`.
6. Write the CSS variable in `applyThemeConfig`.
7. Forward it through `mods-ui-host-runtime-ui.js` if mods should receive it.
8. Update `test/ui-live-theme-config-runtime-ui.test.js`.

Do not add a theme control that writes CSS directly from the shell. All theme persistence and CSS variable output should remain in the theme config runtime.

## 12. How To Add a New Onboarding Step

For server-owned steps, add a step in `onboarding-tour-runtime-ui.js`:

```js
{
  tab: "system",
  target: "#systemWidgetBundleMode",
  title: "Widget setup",
  body: "Separate widgets are recommended. Combined widget is opt-in."
}
```

For mod-owned steps, post the message from the mod iframe:

```js
window.parent.postMessage({
  type: "ravelink:mod-onboarding-steps",
  modId: "my-mod",
  steps: [{ title: "My mod", body: "This is what the mod does." }]
}, "*");
```

Avoid making mod steps target internal iframe selectors from the server overlay. The host overlay cannot highlight inside iframe DOM reliably without unsafe coupling. Instead, target the mod host panel and explain the mod's first action.

## 13. Common Failure Modes

### The tour opens but highlights nothing

Usually the target selector is stale. Fix the selector or choose a more stable anchor. Prefer IDs on durable controls over deeply nested CSS selectors.

### The theme changes but the mod does not update

Check:

1. `live-theme-config-runtime-ui.js` dispatches `ravelink:themechange`.
2. `mods-ui-host-runtime-ui.js` receives the event and posts `ravelink:theme`.
3. the mod iframe is loaded and has a message listener.

### A tab help button does nothing

Check:

1. it has `data-tour-tab`.
2. `dom-query-collections.js` includes `[data-tour-tab]`.
3. `wireOnboardingTourControls()` ran from `initThemeSettings`.
4. browser console has no earlier script evaluation error.

## 14. Test Coverage To Run

Use:

```bash
node --test test/ui-onboarding-tour-runtime-ui.test.js
node --test test/ui-live-theme-config-runtime-ui.test.js
node --test test/ui-mods-runtime-modules.test.js
node --test test/ui-browser-boot-bindings.test.js
node --test test/ui-public-inventory-guard.test.js
```

For a full confidence run:

```bash
npm.cmd run verify:runtime-refactor
```
