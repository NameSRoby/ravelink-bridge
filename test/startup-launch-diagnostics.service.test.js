// [TITLE] Test Module: test/startup-launch-diagnostics.service.test.js
// [TITLE] Purpose: verify startup launcher diagnostics service state transitions

const test = require("node:test");
const assert = require("node:assert/strict");

const createStartupLaunchDiagnosticsService = require("../src/app/runtime/startup-launch-diagnostics.service");

test("startup launch diagnostics tracks schedule and launch outcomes", () => {
  let now = 1_000;
  const service = createStartupLaunchDiagnosticsService({
    now: () => now
  });

  now = 1_200;
  service.recordSchedule({
    scheduled: true,
    reason: "scheduled",
    url: "http://127.0.0.1:5050",
    delayMs: 1200
  });

  now = 2_500;
  service.recordLaunchResult({
    ok: true,
    launcher: "cmd_start",
    url: "http://127.0.0.1:5050",
    delayMs: 1200
  });

  const snapshot = service.getSnapshot();
  assert.equal(snapshot.bootedAt, 1_000);
  assert.equal(snapshot.lastOutcome, "launched");
  assert.equal(snapshot.lastLauncher, "cmd_start");
  assert.equal(snapshot.lastError, "");
  assert.equal(snapshot.scheduleCount, 1);
  assert.equal(snapshot.attemptCount, 1);
  assert.equal(snapshot.launchSuccessCount, 1);
  assert.equal(snapshot.launchFailureCount, 0);
});

test("startup launch diagnostics records disabled and failed outcomes", () => {
  let now = 10_000;
  const service = createStartupLaunchDiagnosticsService({
    now: () => now
  });

  now = 10_500;
  service.recordSchedule({
    scheduled: false,
    reason: "auto_launch_disabled",
    url: "http://127.0.0.1:5050",
    delayMs: 0
  });

  now = 11_000;
  service.recordLaunchResult({
    ok: false,
    launcher: "rundll32_url_handler",
    error: "launcher_failed",
    url: "http://127.0.0.1:5050",
    delayMs: 0
  });

  const snapshot = service.getSnapshot();
  assert.equal(snapshot.lastOutcome, "failed");
  assert.equal(snapshot.lastReason, "launcher_failed");
  assert.equal(snapshot.lastLauncher, "rundll32_url_handler");
  assert.equal(snapshot.lastError, "launcher_failed");
  assert.equal(snapshot.scheduleCount, 0);
  assert.equal(snapshot.attemptCount, 1);
  assert.equal(snapshot.launchSuccessCount, 0);
  assert.equal(snapshot.launchFailureCount, 1);
});
