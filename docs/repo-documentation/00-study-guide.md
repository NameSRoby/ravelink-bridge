# Documentation Guide: Learn The Repository End-to-End

This documentation set explains the repository as a complete system.
It is written for developers who need to understand architecture, behavior, extension points, and operational practices.

If you are new to the codebase, read in this order:

1. `00-study-guide.md` (this file)
2. `01-system-architecture.md`
3. `02-backend-routes-and-runtime.md`
4. `03-frontend-ui-composition.md`
5. `04-audio-live-and-rave.md`
6. `05-mod-platform.md`
7. `06-song-request-mod-deep-dive.md`
8. `07-practical-cookbook-and-examples.md`
9. `08-operations-testing-and-release.md`
10. `09-api-reference-index.md`
11. `10-data-models-and-state-files.md`
12. `11-security-model-and-hardening.md`
13. `12-troubleshooting-and-debug-playbook.md`
14. `13-ui-shell-onboarding-theme-and-mod-docking.md`
15. `14-audio-live-engine-deep-dive.md`
16. `15-system-oauth-helix-and-safe-internet.md`
17. `16-song-request-player-widget-and-queue-deep-dive.md`
18. `17-maintainer-code-walkthroughs.md`

## How To Use This Documentation

- Read each chapter once for context.
- Re-read relevant sections when implementing changes in that area.
- Keep the repository open and follow file paths, route examples, and runtime contracts directly.
- Run targeted tests after every behavior change.
- When a topic feels difficult, read the matching deep-dive chapter after the first pass. The deep-dive chapters are written to explain logic, not just list files.
- Treat the inline code examples as tracing anchors: open the named file, search for the example, and read the surrounding code before moving on.

## How To Read These Docs Well

The strongest way to use this set is not as passive reading. Read with the editor open and trace the examples.

A good rhythm is:

1. read one section
2. open the file paths it names
3. find the exact function or state shape being discussed
4. compare the explanation to the real code
5. only then move on

This repository rewards active reading because many of the important boundaries are conceptual, not just folder-based.

Do not optimize for speed on the first pass. The repository has several places where two files can look like they own the same behavior until you trace the exact request path. The chapters are now written to call that out explicitly, especially in the route/runtime, audio/LIVE, OAuth/gateway, and song-request sections.

Example:

- after reading `03-frontend-ui-composition.md`, open `public/templates/index/sections/scripts.html`, `public/assets/js/core/dom.js`, and `public/assets/js/bootstrap.js`
- after reading `14-audio-live-engine-deep-dive.md`, open `src/domains/audio/audio-runtime.service.js`, `src/domains/audio/audio-capture.runtime.js`, `src/domains/engine-v2/engine.runtime.js`, and `src/domains/engine-v2/engine.scene-state.js`
- after reading `16-song-request-player-widget-and-queue-deep-dive.md`, open `mods/song-request-mod/index.js` and trace one queue request all the way through to history

## Learning Outcomes

By the end of this documentation set, you should be able to:

- explain how requests flow from routes into domain services and adapters
- extend backend and frontend behavior without breaking architectural boundaries
- reason about audio capture, app isolation, and rave lifecycle behavior
- build and maintain mods using platform contracts
- debug production-like issues using telemetry, logs, and verification gates
- reason through the hardest flows: browser UI boot, onboarding + mod docking, desktop/app-isolated audio capture, LIVE scene state, Twitch Helix redemption sync, and the song-request player action queue

## Core Principles Repeated Throughout

- domain-first ownership and explicit module boundaries
- side effects isolated behind adapters or runtime ports
- compatibility routes that preserve existing clients while internals evolve
- deterministic payload contracts and test-backed behavior
- security hardening before convenience on mutating paths

## Suggested Deep Reading Paths

### If you are changing UI behavior

Read:

1. `03-frontend-ui-composition.md`
2. `13-ui-shell-onboarding-theme-and-mod-docking.md`
3. `17-maintainer-code-walkthroughs.md`

Then keep these files open while editing:

```text
public/templates/index/sections/*.html
public/templates/index/sections/scripts.html
public/assets/js/core/dom.js
public/assets/js/core/dom-query-collections.js
public/assets/js/domains/**/*
test/ui-browser-boot-bindings.test.js
test/ui-public-inventory-guard.test.js
test/architecture-guardrails.test.js
```

The main mental model is: markup IDs are contracts, `dom.js` collects the handles, runtime modules own behavior, endpoint adapters own routes, and `bootstrap.js` owns startup sequencing.

### If you are changing audio, LIVE, or engine behavior

Read:

1. `04-audio-live-and-rave.md`
2. `14-audio-live-engine-deep-dive.md`
3. `10-data-models-and-state-files.md`

Then keep these files open while editing:

```text
src/domains/audio/audio-runtime.service.js
src/domains/audio/audio-capture.runtime.js
src/domains/audio/audio-runtime.*.js
src/domains/engine-v2/engine.runtime.js
src/domains/engine-v2/engine.scene-state.js
src/domains/live/live-compat.service.js
public/assets/js/domains/audio.js
public/assets/js/domains/live-controls.js
public/assets/js/domains/telemetry.js
```

The main mental model is: audio capture produces telemetry, LIVE compatibility stores operator intent, engine-v2 resolves that intent into output, and telemetry polling reconciles the visible UI.

### If you are changing Twitch redemption status sync

Read:

1. `15-system-oauth-helix-and-safe-internet.md`
2. `11-security-model-and-hardening.md`
3. `16-song-request-player-widget-and-queue-deep-dive.md`

Then keep these files open while editing:

```text
src/domains/system/system-oauth.service.js
src/domains/system/system-oauth.*.js
src/domains/system/internet-gateway.service.js
mods/song-request-mod/index.js
mods/song-request-mod/templates/PASTE-INTO-STREAMELEMENTS-CUSTOM-WIDGET.js
test/system-oauth.reconcile.test.js
test/apple-music-se-command.integration.test.js
```

The main mental model is: widgets should not own direct Helix writes when the server safe-internet lane is available. Widgets and mods forward intent and redemption metadata; System OAuth and the gateway-first transport own fulfillment/refund.

## How To Read Difficult Code Sections

When a chapter says a section is difficult, use this workflow:

1. read the chapter subsection fully
2. copy the exact file path into your editor
3. locate the quoted function or code example
4. read 40-100 lines above and below it
5. identify which layer owns the truth at that moment
6. only then compare it with neighboring modules

This prevents one of the most common mistakes in this repository: reading an adapter, compat route, or UI sync helper first and assuming it is the source of truth.

## Difficulty Map

If you are trying to decide which parts deserve the most patience, this is a good rough ranking:

### Usually easy to understand quickly

- route registration shape
- DOM registry and template ownership
- fixture CRUD flows
- basic mod discovery and config

### Medium complexity

- browser startup order
- audio config and profile persistence
- theme propagation
- dynamic mod UI mounting

### High complexity

- app-isolated audio capture
- LIVE compatibility vs engine-v2 runtime decision ownership
- Twitch OAuth + gateway-first transport + reconcile
- song-request queue dispatch vs browser-player reconciliation

When you hit one of the high-complexity areas, slow down and read the matching deep dive instead of trying to infer behavior from one file.
