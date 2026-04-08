# 08. Operations, Testing, and Release

This chapter explains how the repository is operated day-to-day, how the main quality gates are structured, and what “release ready” means in concrete commands and artifacts.

The point of this chapter is not just to list scripts. It is to explain what each safety layer is trying to prevent.

## 1) Local Operations Model

The project supports two main ways to run:

- direct Node startup
- Windows launcher flow

### Direct runtime

Typical command:

```bash
npm start
```

This runs `node src/app/index.js` and is the simplest way to reproduce backend behavior quickly.

### Windows launcher runtime

The Windows flow uses:

- `RaveLink-Bridge-Start.bat`
- `RaveLink-Bridge-Stop.bat`

The start launcher is not a thin wrapper. It does preflight work before starting Node:

1. validates required files and tools
2. runs `scripts/bootstrap-runtime.js`
3. resolves host and port
4. checks for stale listeners
5. avoids killing unrelated processes
6. optionally assists with browser open behavior

This matters because many operators run the bridge as an appliance-like tool, not from a dev shell.

## 2) Process Lifecycle Safety

The core lifecycle logic lives in [`src/app/index.js`](../../src/app/index.js).

Important protections include:

- shared graceful shutdown path for signals and `/system/stop`
- bounded force-exit timeout
- listen error handling such as `EADDRINUSE`
- recoverable lifecycle error classification
- burst-threshold guard for repeated recoverable failures

This matters because the runtime interacts with hardware bridges, audio capture tools, and optional subsystems that can fail in noisy ways. Without lifecycle discipline, those failures become zombie processes or infinite restart loops.

## 3) Request and Route Safety in Operations Terms

Operational safety is not just “the process should stay alive.” It is also:

- browser requests should be bounded and predictable
- remote mutation should not be accidentally exposed
- heavy imports should not blow up normal JSON limits

Two files matter most:

- `src/app/runtime/request-security.middleware.js`
- `src/app/register-routes.js`

The middleware owns application-boundary behavior such as:

- origin validation
- method handling
- CSP
- JSON parser limits

The route file owns `enforceWriteAccess`, which keeps mutating routes local-first unless `RAVELINK_ALLOW_REMOTE_WRITE=1` is explicitly enabled.

That distinction matters operationally because a request can be syntactically valid but still not be allowed to mutate state.

## 4) Test Suite Shape: Why It Is Structured This Way

The main test command is:

```bash
npm test
```

The repo uses Node's built-in test runner (`node --test`), and the test suite is not just unit tests. It mixes:

- route contract tests
- domain behavior tests
- UI boot and wiring tests
- architecture guardrail tests
- mod integration tests

This is deliberate. The project's failure modes are often boundary failures rather than purely local logic bugs.

### Important test families

#### Startup and lifecycle

- `test/startup-readiness.service.test.js`
- `test/startup-launch-diagnostics.service.test.js`
- `test/startup.browser-launch.test.js`

#### Security and write guards

- `test/request-security.middleware.test.js`
- `test/register-routes.security.test.js`

#### Route compatibility and system surfaces

- `test/register-compat-routes.*.test.js`
- `test/http-preengine-smoke.test.js`

#### Browser and UI wiring

- `test/ui-browser-boot-bindings.test.js`
- `test/ui-system-runtime-modules.test.js`
- `test/ui-midi-runtime-ui.test.js`

#### Mod and song-request integration

- `test/apple-music-se-command.integration.test.js`
- `test/apple-music-widget-announcer.test.js`

### Why this matters

A lot of regressions in this repo are “the contracts still exist but the behavior no longer lines up.” The suite is shaped to catch that class of bug.

## 5) Verification Scripts and What They Protect

The repository defines several verification scripts in `package.json`.

Key examples:

```json
"verify:architecture": "node scripts/verify-architecture.js",
"verify:security": "node scripts/verify-security-baseline.js",
"verify:audit": "node scripts/verify-dependency-audit.js",
"verify:mods": "node --test test/apple-music-se-command.integration.test.js test/apple-music-widget-announcer.test.js",
"verify:runtime-refactor": "..."
```

### `verify:architecture`

This protects structural contracts such as:

- domain route boundaries
- file-size budgets
- documentation ownership headers
- script manifest order

This is important because the repo has repeatedly used guardrails to keep refactor gains from sliding backward.

### `verify:security`

This protects:

- write-guard coverage
- header hardening
- route protection expectations
- security-baseline files such as the packaged root `THIRD_PARTY_NOTICES.md`

### `verify:audit`

This runs production dependency audit at a high severity threshold.

### `verify:mods`

This isolates high-value mod and widget behavior that should stay green even when unrelated refactors happen elsewhere.

### `verify:runtime-refactor`

This is the broad operational confidence command after the refactor work. It combines:

- route guards
- budget guards
- docs alignment
- manifest order
- mod integration
- browser boot
- backend runtime suites

In practical terms, this is currently the most important “did the system still hang together?” check.

## 6) Release Readiness Gate

The canonical release gate is [`scripts/verify-release-readiness.js`](../../scripts/verify-release-readiness.js).

It runs stages in order:

1. architecture
2. security
3. tests
4. dependency audit

That order matters because it fails fast on cheap structural regressions before spending time on the full suite.

## 7) Baseline Locks and Release Artifacts

The repo can capture a pre-engine or release-like baseline using:

```bash
npm run baseline:lock
```

This process:

- runs readiness gates unless skipped
- captures runtime and repository metadata
- writes baseline artifacts under `dist/release-baselines/*`

This is useful because the repo values explainable release state, not just “the tests were green at some point.”

## 8) CI Merge Gate

The CI workflow mirrors the local safety expectations:

1. architecture verification
2. security verification
3. full tests
4. dependency audit

This alignment matters. The local playbook and the CI playbook should not feel like two different repos with two different definitions of “done.”

## 9) Recommended Operational Playbook

For a risky change or release candidate, use this order:

1. run targeted tests for the touched area
2. run `npm run verify:architecture`
3. run `npm run verify:security`
4. run `npm test`
5. run `npm run verify:audit`
6. run `npm run verify:readiness`
7. optionally run `npm run baseline:lock`

The reason to start with targeted tests is simple: if you know which domain you changed, get fast feedback before paying the full suite cost.

## 10) Operational Failure Classes This Repo Cares About

The gates and scripts exist to prevent recurring failure classes:

- broken compatibility contracts
- boot order regressions in the browser UI
- route guard drift
- documentation and ownership drift
- stale security assumptions
- mod/widget behavior silently diverging from the server

Understanding those failure classes makes the verification stack easier to appreciate. It is not “lots of scripts because the repo is complicated.” It is lots of scripts because the repo has learned where it is fragile.

## 11) Core Principle

Operations in this repository are built around one idea:

> a change is not finished when the code compiles; it is finished when the runtime, contracts, security, and release evidence all still line up

That is the standard to keep in mind when you are the last person touching a risky change.
