# 01. System Architecture

This chapter is the architectural map for the whole repository. It is not meant to be a slogan-level overview. It is meant to answer the questions a maintainer actually has:

- Where does the process start?
- Which file is the real composition root?
- Which layers are allowed to know about which other layers?
- When a route fires, which service is supposed to own the real behavior?
- Why does the repository keep both canonical and compatibility contracts at the same time?

If you only read one chapter before touching backend code, read this one first, then read `02-backend-routes-and-runtime.md`.

## 1) The Real Mental Model: This Repo Is a Runtime Graph, Not a CRUD App

RaveLink Bridge is easiest to understand if you stop thinking about it as “an Express server with some endpoints” and instead think about it as a runtime graph with five major layers:

1. Process and lifecycle ownership
2. Application composition
3. HTTP route orchestration
4. Domain runtime services
5. Adapters and persisted state

In concrete file terms, that means:

1. `src/app/index.js`
2. `src/app/create-server.js`
3. `src/app/register-routes.js` and `src/app/register-compat-routes.js`
4. `src/domains/**`
5. `src/adapters/**`, `runtime/**`, `mods/**`

That ordering matters. If you try to understand the project by starting inside `src/domains/audio/` or `src/domains/engine-v2/`, the code will feel denser than it actually is, because those domains are not the whole program. They are only one layer in a larger runtime.

## 2) Read Order: The Fastest Way to Learn the Codebase

For a new maintainer, the shortest reliable reading path is:

1. `src/app/index.js`
2. `src/app/create-server.js`
3. `src/app/register-routes.js`
4. `src/app/register-compat-routes.js`
5. The specific domain service used by the route you care about

That read order works because every major decision is visible in one of those files:

- `index.js` answers “how does the process start and stop?”
- `create-server.js` answers “what exists in the dependency graph?”
- route files answer “which service owns this endpoint?”
- the domain file answers “what is the actual business/runtime logic?”

If you reverse that order, you will repeatedly mistake a compatibility contract or helper shim for the true owner of a feature.

## 3) Process Entry and Lifecycle Ownership

The executable entrypoint is [`src/app/index.js`](../../src/app/index.js). Its job is not “do all startup work.” Its job is narrower and more important:

- create the server graph once
- start listening
- schedule startup side effects like browser launch
- keep shutdown semantics deterministic
- classify runtime errors and decide when the process should actually exit

This is the first critical code example to understand:

```js
const { app, services } = createServer({
  rootDir: ROOT_DIR,
  requestSystemStop(meta = {}) {
    const source = String(meta?.source || "system_stop_route").trim() || "system_stop_route";
    return requestShutdown(`HTTP:${source}`);
  }
});
```

This tells you two very important things:

1. `index.js` does not manually construct domain services. It delegates that to `createServer(...)`.
2. `/system/stop` does not get a special shutdown path. It is explicitly wired back into the same process lifecycle that handles `SIGINT` and `SIGTERM`.

That second point matters a lot. A common mistake in Node apps is to let HTTP-triggered shutdown drift away from signal-triggered shutdown. This repo deliberately avoids that. The stop route is not allowed to invent its own semantics.

The next important block is the listen path:

```js
server = app.listen(PORT, HOST, () => {
  serverListening = true;
  const launchPlan = scheduleAutoBrowserLaunch({
    url: BRIDGE_URL,
    config: systemConfig,
    env: process.env,
    log: console,
    onSchedule(event) {
      startupLaunchDiagnosticsService?.recordSchedule?.(event);
    },
    onLaunchResult(event) {
      startupLaunchDiagnosticsService?.recordLaunchResult?.(event);
    }
  });
});
```

This is another example of the repository's design style:

- `index.js` owns process events
- the launch planner owns browser-launch policy
- the diagnostics service owns observable startup state

No single function tries to own all three concerns.

## 4) Composition Root: `create-server.js` Is the Real Backend Assembly File

If `index.js` owns lifecycle, then [`src/app/create-server.js`](../../src/app/create-server.js) owns composition.

This file is the closest thing the repo has to a backend dependency graph diagram. When you open it, you are looking at:

- path resolution
- runtime store locations
- adapter creation
- domain service construction
- Express middleware installation
- UI renderer registration
- route registration
- asynchronous mod loading

This is the most important architectural rule in the file:

> services are built first, then injected into routes

That means route files should not be secretly constructing their own dependencies. If a route needs a service, the service should already exist in `create-server.js` and be passed in explicitly.

The path object is the easiest place to see how much ownership is centralized here:

```js
const paths = {
  runtimeDir,
  publicDir,
  uiTemplateDir: path.join(publicDir, "templates", "index"),
  fixturesStorePath: path.join(runtimeDir, "fixtures", "fixtures.json"),
  systemConfigStorePath: path.join(runtimeDir, "system", "config.json"),
  systemOauthVaultPath: path.join(runtimeDir, "system", "oauth.vault.json")
};
```

This is not just convenience. It is an operational safety choice:

- all persisted runtime files are declared centrally
- route files do not invent storage paths ad hoc
- domain services can be tested with well-defined filesystem boundaries

When a maintainer wants to know “where does this file on disk come from?”, `create-server.js` is one of the first files to check.

## 5) The Runtime Graph: Which Services Matter Most

The repository has many services, but a handful are structurally central. If you understand these, most of the repo becomes easier:

### Core runtime services

- `src/domains/audio/audio-engine.port.js`
- `src/domains/audio/audio-runtime.service.js`
- `src/domains/engine-v2/engine.runtime.js`
- `src/domains/engine-v2/engine.scene-state.js`
- `src/domains/live/live-compat.service.js`
- `src/domains/mods/mod-loader.port.js`
- `src/domains/system/system-config.service.js`
- `src/domains/system/system-oauth.service.js`

### Why each one exists

#### `audio-engine.port.js`

This is the runtime-facing audio state bridge. It is not the low-level capture system. It is the stateful interface the rest of the system uses to ask questions like:

- is rave active?
- what is the current telemetry snapshot?
- what is the runtime audio status?

#### `audio-runtime.service.js`

This is the higher-level operator-facing audio runtime. It owns:

- saved config
- profiles
- app isolation
- device discovery
- capture session lifecycle

This distinction matters. A lot of confusion disappears once you separate “the capture/control service” from “the current engine-facing audio snapshot.”

#### `engine.runtime.js`

This is the tick-time orchestration engine. It coordinates:

- scheduler cadence
- palette progression
- sync groups
- fixture exclusions
- output dispatch decisions

The engine is where runtime policy becomes per-tick behavior.

#### `engine.scene-state.js`

This file, plus its extracted helpers, is where “interpret the music into scene behavior” lives. It is not a route layer. It is not a UI policy layer. It is scene decision logic.

#### `live-compat.service.js`

This is the persisted compatibility state bridge between operator intent and runtime behavior. It stores things like:

- scene intent
- scoped trigger matrix settings
- sync groups
- overclock compatibility state

When a user clicks a control, that does not directly mutate engine internals. Often it first lands in this persisted compatibility state.

#### `mod-loader.port.js`

This owns mod discovery, sandbox lifecycle, config ordering, hook fan-out, and mod UI cataloging. It is the main “mod platform” service.

#### `system-oauth.service.js`

This is now a composed service over:

- `system-oauth.vault.js`
- `system-oauth.transport.js`
- `system-oauth.device-flow.js`
- `system-oauth.reconcile.js`

That split is important because the repository treats Twitch/OAuth and safe outbound internet access as operationally sensitive behavior, not miscellaneous helper logic.

## 6) Security Is Not an Afterthought Layer

This repository treats security as part of startup and route composition, not as something route handlers “remember to do.”

The global middleware file is [`src/app/runtime/request-security.middleware.js`](../../src/app/runtime/request-security.middleware.js).

That middleware owns:

- origin validation
- CORS behavior
- mutating request hardening
- JSON size/error handling
- CSP differences between core UI and `/mods-ui/*`

Then route files apply `enforceWriteAccess` for mutating behavior that should remain local by default.

This double-layer matters:

1. Global middleware protects the application boundary.
2. Route-level write guards protect state mutation semantics.

That is why a maintainer should not remove `enforceWriteAccess` just because the middleware already exists. They solve related but not identical problems.

## 7) Boot Flow: What Actually Happens During Startup

When the process starts, the real sequence is:

1. `index.js` resolves host/port and calls `createServer(...)`.
2. `create-server.js` resolves paths, builds services, installs middleware, and registers routes.
3. The UI renderer and static asset serving are registered.
4. Mod runtime load is started asynchronously.
5. The HTTP server begins listening.
6. Startup diagnostics are logged.
7. Browser auto-launch may be scheduled.
8. Readiness and health endpoints become available immediately, even if optional lanes are still converging.

This leads to a critical operational idea:

> “The server is listening” and “all subsystems are ready” are intentionally different states.

That is why `GET /health`, `GET /system/startup-readiness`, and `GET /system/core-status` all exist. They answer different operational questions.

## 8) Request Walkthrough: Trace a Real Request End-to-End

The simplest useful walkthrough is `POST /rave/on`.

From a code-reading perspective, the path is:

1. `src/app/register-routes.js`
2. `audioRuntimeService.startSession(...)`
3. `audioEngine.startRave(...)`
4. `engineV2.start(...)`
5. optional bridge sync
6. mod hook fan-out

Why this route is such a good study example:

- it is orchestration-heavy
- it touches several domains
- it shows the difference between route ownership and service ownership
- it proves the repo does not try to push complicated runtime sequencing into the browser

The route layer's job is to coordinate high-level phases in the right order. The domain services' job is to own the meaning of each phase.

## 9) Compatibility Contracts Exist for a Reason

The repo has both canonical routes and compatibility routes because the internal architecture has been evolving while preserving existing UI/mod/operator surfaces.

That is why these two files both matter:

- `src/app/register-routes.js`
- `src/app/register-compat-routes.js`

The important architectural point is that compatibility routes are not a separate application. They are composed into the same server, with the same service graph, and they reuse the same ownership boundaries.

Compatibility exists to preserve contracts while internals move, not to create a second “business logic layer.”

If a maintainer starts implementing real logic only in compatibility files, the architecture will drift in the wrong direction.

## 10) What New Contributors Usually Get Wrong

The most common architectural misunderstandings are:

### Mistake 1: treating route files as business logic owners

Route files coordinate and normalize. They should not become the deepest owner of runtime rules.

### Mistake 2: treating persisted compatibility state as the live engine itself

`live-compat.service.js` stores operator intent and compatibility payloads. The engine uses that information, but it is not identical to the engine's current live tick state.

### Mistake 3: treating mod integrations as core boot assumptions

Mods can dock onboarding, OAuth helpers, and widgets onto the server surface, but the server must remain coherent if a mod is removed.

### Mistake 4: assuming “UI dead” means backend failure

Several historical failures came from browser boot ordering and script evaluation, not broken routes. That is why the repo now carries browser boot guards and UI ownership audits.

## 11) Architecture Checklist for Any Change

Before making a non-trivial change, answer these questions in order:

1. Which process or boot file owns lifecycle for this feature?
2. Which composition file creates the dependency or service?
3. Which route exposes it?
4. Which domain service owns the actual behavior?
5. Which persisted state, if any, is the source of truth?
6. Which compatibility contract must remain stable?
7. Which frontend adapter/runtime consumes it?

If you cannot answer those questions, you do not understand the feature deeply enough yet to change it safely.

## 12) Why This Architecture Works for This Repo

RaveLink is balancing several difficult constraints at once:

- local-first operation
- hardware integrations
- mods and embedded UIs
- compatibility with older UI contracts
- progressively refactored backend domains
- security-sensitive OAuth and internet egress behavior

The architecture works because it keeps those constraints separated:

- process lifecycle is owned centrally
- dependency wiring is explicit
- routes orchestrate
- domains own behavior
- compatibility contracts preserve migration safety
- persisted state is normalized instead of trusted blindly

That is the core idea to carry forward as you read the rest of the repository documentation.
