# 02. Backend Routes and Runtime

This chapter explains how HTTP routes are organized, how they map onto runtime services, and how to reason about orchestration-heavy request paths without getting lost in compatibility layers.

Read this chapter with one question in mind:

> When an HTTP request enters the server, which file is only coordinating work, and which file actually owns the behavior?

That distinction is the difference between safe maintenance and accidental architecture drift.

## 1) Topology: There Are Two Route Surfaces, Not Two Servers

The backend exposes two route layers:

- canonical routes in [`src/app/register-routes.js`](../../src/app/register-routes.js)
- compatibility routes in [`src/app/register-compat-routes.js`](../../src/app/register-compat-routes.js)

The canonical route file is the main HTTP surface for newer contracts. The compatibility file preserves older or UI-facing contracts that still need to exist while internals evolve.

The main route file explicitly composes the compat layer:

```js
registerCompatRoutes(app, {
  enforceWriteAccess,
  midiManager,
  modRuntime,
  fixtureRegistry,
  engineV2,
  enginePaletteService,
  liveCompatService,
  audioRuntimeService,
  systemConfigService,
  systemOauthService,
  startupReadinessService,
  startupLaunchDiagnosticsService,
  audioEngine,
  hueBridge,
  wizBridge,
  requestSystemStop
});
```

This tells you that:

1. compat routes are first-class members of the same server
2. compat routes do not build their own dependency graph
3. the same services back both canonical and compatibility contracts

That is one of the most important facts in the repository.

## 2) What `register-routes.js` Actually Owns

The main route file does four jobs:

1. define local/same-host write protection through `enforceWriteAccess`
2. expose canonical runtime endpoints
3. coordinate high-level lifecycle routes such as `/rave/on` and `/rave/off`
4. hand off legacy or compatibility-heavy surface area to `registerCompatRoutes(...)`

The first route block worth studying is the write guard:

```js
if (isWriteRequestAllowed({
  allowRemoteWrite,
  requestIp: req?.ip,
  socketRemoteAddress: req?.socket?.remoteAddress,
  socketLocalAddress: req?.socket?.localAddress
})) {
  next();
  return;
}
res.status(403).json({
  ok: false,
  error: "remote_write_forbidden",
  detail: "This write endpoint allows loopback and same-host requests by default. Set RAVELINK_ALLOW_REMOTE_WRITE=1 to allow remote LAN writes."
});
```

This is not just a helper. It is one of the repo's core safety policies:

- mutating routes are local-first
- LAN write access is opt-in
- route behavior remains deterministic instead of relying on browser-origin assumptions alone

## 3) Canonical Route Families and Why They Exist

The core route families in `register-routes.js` are a good map of the current backend priorities.

### Health and startup visibility

- `GET /health`

This is not a trivial health check. It is a multi-lane snapshot that includes:

- rave state
- audio state
- engine state
- fixture counts
- startup readiness
- launcher diagnostics

Read it when you want the fastest single response that explains “what state is the whole bridge in?”

### Audio runtime

- `GET /audio/status`
- `GET /audio/telemetry`
- `POST /audio/telemetry`

These routes sit on the boundary between raw capture/runtime state and normalized engine-facing telemetry.

### Engine v2 control surface

- `GET /engine/v2/status`
- `GET /engine/v2/palette`
- `POST /engine/v2/start`
- `POST /engine/v2/stop`
- `POST /engine/v2/tick`
- palette mutation routes

These routes are closer to engine runtime ownership than the LIVE compatibility routes are.

### LIVE status and profiles

- `GET /live/status`
- `GET /live/profiles`
- `POST /live/profiles/save`
- `POST /live/profiles/load`
- `DELETE /live/profiles/:name`

These are canonical routes for the newer read model and profile flow.

### RAVE lifecycle

- `GET /rave/status`
- `POST /rave/on`
- `POST /rave/off`

These are orchestration routes, not merely “set a boolean” endpoints.

### Twitch color commands

- `POST /teach`
- `GET /color/prefixes`
- `POST /color/prefixes`
- `POST /color`

These routes keep the text-command and prefix-based control surface available while newer runtime systems continue to evolve underneath.

## 4) Compatibility Route Families After the Refactor

The compatibility layer is no longer one giant inline route file. It is now composed from extracted registrars under [`src/app/routes/compat`](../../src/app/routes/compat).

Those registrars are:

- `audio.compat.routes.js`
- `fixtures-hardware.compat.routes.js`
- `live-rave.compat.routes.js`
- `midi.compat.routes.js`
- `mods.compat.routes.js`
- `system.compat.routes.js`
- `telemetry.compat.routes.js`

That structure matters because it turns the old “everything compat lives everywhere” problem into domain-shaped compatibility ownership.

### What each compat registrar owns

#### `telemetry.compat.routes.js`

Owns compatibility telemetry reads like:

- `/rave/telemetry`
- `/hue/telemetry`
- `/wiz/telemetry`

#### `audio.compat.routes.js`

Owns:

- `/audio/config`
- `/audio/apps`
- `/audio/devices`
- `/audio/reactivity-map`
- `/audio/profiles/*`
- rust worker and optional tool routes

#### `live-rave.compat.routes.js`

Owns the older LIVE and RAVE compatibility surface:

- `/rave/live/*`
- `/rave/scene`
- `/rave/palette`
- `/rave/drop`
- `/rave/overclock/*`

#### `system.compat.routes.js`

Owns:

- `/system/config`
- `/system/oauth/*`
- `/system/core-status`
- `/system/startup-readiness`
- `/system/launcher-diagnostics`
- `/system/stop`

#### `mods.compat.routes.js`

Owns:

- `/mods/*`
- `/mods-ui/*`
- `/mods/import`
- `/mods/reload`

#### `fixtures-hardware.compat.routes.js`

Owns fixture and hardware bridge compatibility behavior:

- `/fixtures/*`
- `/hue/*`
- `/wiz/*`

#### `midi.compat.routes.js`

Owns the MIDI compatibility surface.

This is the new reading rule:

> if a route looks old or UI-compat-oriented, search the extracted compat registrar first, not the old monolithic compat file.

## 5) The Difference Between Route Logic and Runtime Logic

A route file should usually do only a few things:

- parse and normalize request input
- enforce access rules
- call the correct domain service
- shape the response contract

When route files start making deep domain decisions themselves, the repository becomes harder to reason about. A lot of the refactor work in this repo has been about pushing logic back down into the right service or helper module.

Three examples show what “good route orchestration” looks like.

## 6) Example A: `/health` as a Read-Model Aggregator

The health route is not “simple,” but it is still structurally clean because it only reads from owning services and synthesizes a response:

```js
app.get("/health", (_req, res) => {
  const rave = audioEngine.getRaveState();
  const audioStatus = audioEngine.getStatus();
  const engineStatus = engineV2.getStatus();
  const readiness = startupReadinessService?.getSnapshot?.() || null;
  const launcherDiagnostics = startupLaunchDiagnosticsService?.getSnapshot?.() || null;
  res.json({
    ok: true,
    rave: { ... },
    audio: { ... },
    engineV2: { ... },
    startupReadiness: ...,
    launcherDiagnostics
  });
});
```

The route does not decide what rave state means. It asks the audio engine.
The route does not decide what engine status means. It asks engine v2.
The route does not invent startup state. It asks the readiness service.

This is a good example of a route acting as a read-model aggregator.

## 7) Example B: `/system/core-status` as Structured Synthesis

The compatibility system core-status route is useful because it is one of the most explicit examples of multi-lane status synthesis.

The route composes:

- lane readiness summary
- service check summary
- final operator-facing status

The logic shape is:

```js
const laneSummary = summarizeLaneCoreReadiness(readinessSnapshot || {});
const serviceSummary = summarizeCoreServiceChecks({ ...deps });
const status = computeCoreStatus(laneSummary, serviceSummary);
```

This is the correct pattern for operator diagnostics:

1. compute detailed lane truth
2. compute service interface truth
3. derive a final concise status

Do not collapse all three phases into one opaque helper if you want diagnostics to remain explainable.

## 8) Example C: `/rave/on` as Orchestration, Not Business Logic

`POST /rave/on` is one of the best routes in the repo to study because it touches multiple runtime systems without pretending the route layer owns them.

The real sequence is roughly:

1. start or restart audio capture
2. reject with `audio_start_failed` if capture cannot be established
3. mark rave active in the audio engine
4. start engine v2
5. optionally sync Hue transport
6. fan out `onRaveStart` to mods

The route is coordinating a multi-lane transition.

What the route is *not* doing:

- calculating scene state
- deciding audio device ranking
- choosing capture strategy details
- dispatching fixture frames itself

Those decisions belong to the deeper services.

## 9) Example D: Controlled Shutdown

`POST /system/stop` is deceptively simple, but it encodes a strong architectural choice.

The route delegates to `requestSystemStop(...)`, and `index.js` wires that callback into the same graceful shutdown path used by process signals.

Why this matters:

- one shutdown path means one place to reason about cleanup
- tests do not have to simulate two unrelated shutdown systems
- runtime teardown remains deterministic

If you ever feel tempted to add route-specific shutdown cleanup, stop and push that work back into the shared lifecycle path instead.

## 10) Example E: Safe Mod Reload

Routes like `/mods/reload` and `/rave/reload` do not implement reload behavior inline. They delegate into a shared runtime reload handler that tracks in-flight state and prevents overlapping reloads.

This is a recurring theme in the repo:

- route receives the request
- shared runtime helper owns sequencing
- concurrent state is guarded in one place

When a feature has “already running,” “already reloading,” or “in flight” semantics, it usually deserves a helper or service with explicit state instead of route-local booleans.

## 11) Startup Lifecycle Services Are First-Class Observability Tools

Two runtime services make backend startup much easier to understand:

- [`src/app/runtime/startup-readiness.service.js`](../../src/app/runtime/startup-readiness.service.js)
- [`src/app/runtime/startup-launch-diagnostics.service.js`](../../src/app/runtime/startup-launch-diagnostics.service.js)

### Startup readiness service

This service tracks both:

- boot-time readiness
- current runtime readiness

That split is extremely important. A lane can fail at boot and recover later, or succeed at boot and degrade later. If you only store one summary, you lose that distinction.

### Launch diagnostics service

This service records:

- schedule decisions
- launch attempts
- success/failure outcomes
- launcher identity
- timestamps and counters

That is why the repository can explain browser auto-launch behavior without guessing from logs alone.

## 12) Debugging Rule: Follow the Route Graph Before the Domain Graph

When debugging a request path, the safest order is:

1. find the route
2. identify access control
3. identify the called service
4. inspect normalization and response shaping
5. only then read the deeper domain implementation

This order prevents a common mistake: debugging a domain service in isolation while the real failure is bad route payload shaping or compatibility normalization.

## 13) What to Touch When Adding a New Route

When adding a new route, decide first which surface it belongs to:

### Add to canonical routes when:

- the contract is new
- the route reflects current architecture
- the UI adapter or service should target the newer shape

### Add to compatibility routes when:

- existing UI or tooling depends on older route naming or payloads
- the new route is preserving behavior during migration
- the response shape is intentionally legacy-facing

Then follow this checklist:

1. choose the owning route registrar
2. apply `enforceWriteAccess` if it mutates state
3. delegate to an existing service if possible
4. add or update tests for the route contract
5. update frontend endpoint adapters if the browser will use it

## 14) High-Value Debugging Entry Points

These are the best route-level entry points when the system behaves strangely:

1. `GET /health`
2. `GET /system/core-status`
3. `GET /system/startup-readiness`
4. `GET /audio/status`
5. `GET /engine/v2/status`
6. `GET /mods/runtime`

This order mirrors the architecture:

- overall health
- startup and core readiness
- audio lane
- engine lane
- mod lane

If you start with a narrow mod or UI symptom without checking these first, you can waste time debugging the wrong layer.

## 15) The Core Principle of the Backend Surface

The backend remains maintainable because it preserves one structural rule:

> routes orchestrate and normalize, but services own the real behavior

Everything in the route refactor points back to that rule:

- extracted compat registrars
- route-local access control
- shared lifecycle paths
- aggregated read models
- service-backed runtime orchestration

If you keep that boundary intact, even very large route surfaces remain understandable.
