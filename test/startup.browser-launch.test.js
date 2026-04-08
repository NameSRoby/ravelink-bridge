// [TITLE] Test Module: test/startup.browser-launch.test.js
// [TITLE] Purpose: verify startup browser auto-launch behavior is deterministic

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  clampLaunchDelayMs,
  buildLaunchStrategies,
  launchBrowserUrl,
  scheduleAutoBrowserLaunch
} = require("../src/app/runtime/startup.browser-launch");

test("clampLaunchDelayMs normalizes invalid and out-of-range values", () => {
  assert.equal(clampLaunchDelayMs("bad"), 1200);
  assert.equal(clampLaunchDelayMs(-10), 0);
  assert.equal(clampLaunchDelayMs(999999), 30000);
});

test("launchBrowserUrl selects explorer launcher on windows", () => {
  let command = "";
  let args = [];
  let spawnOptions = null;
  const result = launchBrowserUrl("http://127.0.0.1:5050", {
    platform: "win32",
    spawnFn(nextCommand, nextArgs, nextOptions) {
      command = String(nextCommand || "");
      args = Array.isArray(nextArgs) ? nextArgs.slice() : [];
      spawnOptions = nextOptions || null;
      return {
        unref() {}
      };
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.launcher, "explorer_url_handler");
  assert.equal(command, "explorer.exe");
  assert.equal(args[0], "http://127.0.0.1:5050");
  assert.equal(spawnOptions?.detached, true);
});

test("buildLaunchStrategies includes windows fallback launchers", () => {
  const strategies = buildLaunchStrategies("http://127.0.0.1:5050", "win32");
  assert.equal(Array.isArray(strategies), true);
  assert.equal(strategies.length, 4);
  assert.deepEqual(
    strategies.map(row => row.launcher),
    ["explorer_url_handler", "powershell_start_process", "cmd_start", "rundll32_url_handler"]
  );
});

test("launchBrowserUrl falls back when first windows strategy throws", () => {
  let spawnCalls = 0;
  const commands = [];
  const result = launchBrowserUrl("http://127.0.0.1:5050", {
    platform: "win32",
    spawnFn(nextCommand) {
      spawnCalls += 1;
      commands.push(String(nextCommand || ""));
      if (spawnCalls === 1) {
        throw new Error("cmd missing");
      }
      return {
        unref() {}
      };
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.launcher, "powershell_start_process");
  assert.equal(commands[0], "explorer.exe");
  assert.equal(commands[1], "powershell.exe");
});

test("scheduleAutoBrowserLaunch honors disable env flag", () => {
  let scheduled = false;
  const result = scheduleAutoBrowserLaunch({
    url: "http://127.0.0.1:5050",
    config: { autoLaunchBrowser: true, autoLaunchDelayMs: 1200 },
    env: {
      RAVELINK_DISABLE_AUTO_BROWSER: "1"
    },
    setTimeoutFn() {
      scheduled = true;
      return null;
    },
    log: {
      log() {},
      warn() {}
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.scheduled, false);
  assert.equal(scheduled, false);
});

test("scheduleAutoBrowserLaunch schedules launch with configured delay", () => {
  let launchCalls = 0;
  let seenUrl = "";
  let seenDelayMs = 0;
  let timerUnrefCalled = false;
  let scheduleEvents = 0;
  let launchEvents = 0;
  const result = scheduleAutoBrowserLaunch({
    url: "http://127.0.0.1:5050",
    config: { autoLaunchBrowser: true, autoLaunchDelayMs: 777 },
    env: {},
    setTimeoutFn(handler, delayMs) {
      seenDelayMs = Number(delayMs || 0);
      handler();
      return {
        unref() {
          timerUnrefCalled = true;
        }
      };
    },
    launchFn(url) {
      launchCalls += 1;
      seenUrl = String(url || "");
      return { ok: true, launcher: "test" };
    },
    onSchedule(event) {
      scheduleEvents += 1;
      assert.equal(event?.scheduled, true);
      assert.equal(event?.reason, "scheduled");
    },
    onLaunchResult(event) {
      launchEvents += 1;
      assert.equal(event?.ok, true);
      assert.equal(event?.launcher, "test");
    },
    log: {
      log() {},
      warn() {}
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.scheduled, true);
  assert.equal(result.delayMs, 777);
  assert.equal(seenDelayMs, 777);
  assert.equal(launchCalls, 1);
  assert.equal(seenUrl, "http://127.0.0.1:5050");
  assert.equal(timerUnrefCalled, true);
  assert.equal(scheduleEvents, 1);
  assert.equal(launchEvents, 1);
});
