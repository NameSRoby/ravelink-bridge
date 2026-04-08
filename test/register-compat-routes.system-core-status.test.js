// [TITLE] Test Module: test/register-compat-routes.system-core-status.test.js
// [TITLE] Purpose: verify /system/core-status and /system/launcher-diagnostics behavior

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const registerCompatRoutes = require("../src/app/register-compat-routes");

function toUrl(baseUrl, routePath = "/") {
  const normalized = String(routePath || "/").startsWith("/")
    ? String(routePath || "/")
    : `/${String(routePath || "")}`;
  return `${String(baseUrl || "").replace(/\/+$/, "")}${normalized}`;
}

async function requestJson(baseUrl, method, routePath, body = null) {
  const response = await fetch(toUrl(baseUrl, routePath), {
    method,
    headers: {
      "Content-Type": "application/json",
      Connection: "close"
    },
    body: body === null ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { __raw: text };
  }
  return {
    ok: response.ok,
    status: response.status,
    data
  };
}

function createDeps(overrides = {}) {
  return {
    enforceWriteAccess(_req, _res, next) {
      next();
    },
    midiManager: {
      getStatus: () => ({ ok: true }),
      refreshStatus: () => ({ ok: true, status: { ok: true } }),
      patchConfig: () => ({ ok: true, status: { ok: true } }),
      cancelLearn: () => ({ ok: true, status: { ok: true } }),
      armLearn: () => ({ ok: true, status: { ok: true } }),
      triggerAction: () => ({ ok: true, status: { ok: true } }),
      resetBindings: () => ({ ok: true, status: { ok: true } }),
      saveBinding: () => ({ ok: true, status: { ok: true } }),
      clearBinding: () => ({ ok: true, status: { ok: true } })
    },
    modRuntime: {
      list: () => ({ ok: true, mods: [], total: 0, loaded: 0 }),
      getSupportedHooks: () => [],
      getUiCatalog: () => ({ ok: true, mods: [] }),
      reload: async () => ({ ok: true }),
      setDebugEnabled: () => ({ ok: true }),
      clearDebugBuffer: () => ({ ok: true }),
      importMods: async () => ({ ok: true }),
      updateConfig: async () => ({ ok: true }),
      invokeAction: async () => ({ status: 200, body: { ok: true } }),
      handleHttp: async () => ({ status: 200, body: { ok: true } }),
      resolveUiAsset: () => ({ ok: false, error: "mod_ui_not_found" })
    },
    fixtureRegistry: {
      getFixtures: () => [],
      getIntentRoutes: () => ({}),
      load: () => {},
      upsertFixture: fixture => ({ ok: true, fixture }),
      deleteFixture: () => ({ ok: true }),
      getConnectivitySnapshot: () => ({ ok: true, rows: [] }),
      testConnectivity: () => ({ ok: true })
    },
    liveCompatService: {
      getCompatibility: () => ({ ok: true, snapshot: {} }),
      patchCompatibility: () => ({ ok: true }),
      getTriggerMatrix: () => ({ ok: true }),
      patchTriggerMatrix: () => ({ ok: true }),
      getPaletteSnapshot: () => ({ ok: true }),
      patchPalette: () => ({ ok: true }),
      getFixtureMetricsSnapshot: () => ({ ok: true }),
      patchFixtureMetrics: () => ({ ok: true }),
      clearFixtureRouting: () => ({ ok: true }),
      getOverclockTiers: () => ({ ok: true, tiers: [] }),
      setOverclockAuto: () => ({ ok: true }),
      setOverclockPresetLevel: () => ({ ok: true }),
      setOverclockDevHz: () => ({ ok: true })
    },
    systemConfigService: {
      getConfig: () => ({ ok: true, config: {} }),
      patchConfig: () => ({ ok: true, config: {} }),
      generateWidgetTemplate: () => ({ ok: true, script: "" })
    },
    audioEngine: {
      getStatus: () => ({ backend: "unwired", telemetryUpdatedAt: 0 }),
      getRaveState: () => ({ active: false, startedAt: 0, lastStoppedAt: 0 }),
      stopRave: () => ({ ok: true })
    },
    hueBridge: {
      discoverBridges: async () => ({ ok: true, bridges: [] }),
      pairBridge: async () => ({ ok: false, error: "not_configured" })
    },
    wizBridge: {
      discoverDevices: async () => ({ ok: true, devices: [] })
    },
    startupReadinessService: {
      getSnapshot: () => ({
        ok: true,
        generatedAt: Date.now(),
        current: {
          capturedAt: Date.now(),
          summary: {
            laneCount: 6,
            readyCount: 4,
            blocking: ["midi", "wiz"],
            states: {
              config: "loaded",
              profiles: "loaded",
              mods: "loaded",
              midi: "missing",
              hue: "loaded",
              wiz: "missing"
            }
          }
        }
      })
    },
    startupLaunchDiagnosticsService: {
      getSnapshot: () => ({
        bootedAt: 1,
        updatedAt: 2,
        lastOutcome: "launched",
        lastReason: "launch_ok",
        lastUrl: "http://127.0.0.1:5050",
        lastDelayMs: 1200,
        lastLauncher: "cmd_start",
        lastError: "",
        lastScheduledAt: 1,
        lastAttemptAt: 2,
        scheduleCount: 1,
        attemptCount: 1,
        launchSuccessCount: 1,
        launchFailureCount: 0
      })
    },
    ...overrides
  };
}

async function withCompatServer(deps, run) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));
  registerCompatRoutes(app, deps);
  const listener = await new Promise(resolve => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
  const address = listener.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise(resolve => listener.close(resolve));
  }
}

test("compat core-status route reports ok when required core lanes are loaded", async () => {
  await withCompatServer(createDeps(), async baseUrl => {
    const response = await requestJson(baseUrl, "GET", "/system/core-status");
    assert.equal(response.status, 200);
    assert.equal(response.data?.ok, true);
    assert.equal(response.data?.status, "ok");
    assert.equal(response.data?.laneSummary?.readyCount, 4);
    assert.equal(response.data?.laneSummary?.laneCount, 6);
    assert.deepEqual(response.data?.laneSummary?.requiredBlocking, []);
    assert.equal(response.data?.serviceSummary?.requiredReady, response.data?.serviceSummary?.requiredTotal);
    assert.equal(response.data?.launcher?.lastOutcome, "launched");
  });
});

test("compat core-status route reports partial when required core lane is not loaded", async () => {
  await withCompatServer(createDeps({
    startupReadinessService: {
      getSnapshot: () => ({
        ok: true,
        generatedAt: Date.now(),
        current: {
          capturedAt: Date.now(),
          summary: {
            laneCount: 6,
            readyCount: 3,
            blocking: ["mods"],
            states: {
              config: "loaded",
              profiles: "loaded",
              mods: "pending",
              midi: "missing",
              hue: "loaded",
              wiz: "missing"
            }
          }
        }
      })
    }
  }), async baseUrl => {
    const response = await requestJson(baseUrl, "GET", "/system/core-status");
    assert.equal(response.status, 200);
    assert.equal(response.data?.ok, true);
    assert.equal(response.data?.status, "partial");
    assert.deepEqual(response.data?.laneSummary?.requiredBlocking, ["mods"]);
  });
});

test("compat launcher-diagnostics route reports unavailable when diagnostics service missing", async () => {
  await withCompatServer(createDeps({
    startupLaunchDiagnosticsService: null
  }), async baseUrl => {
    const response = await requestJson(baseUrl, "GET", "/system/launcher-diagnostics");
    assert.equal(response.status, 503);
    assert.equal(response.data?.ok, false);
    assert.equal(response.data?.error, "launcher_diagnostics_unavailable");
  });
});

test("compat internet-gateway status route reports gateway snapshot when available", async () => {
  await withCompatServer(createDeps({
    internetGatewayRuntime: {
      getStatus: () => ({
        ok: true,
        enabled: true,
        running: true,
        ready: true,
        policyLoaded: true
      }),
      request: async () => ({
        ok: false
      })
    }
  }), async baseUrl => {
    const response = await requestJson(baseUrl, "GET", "/system/internet-gateway/status");
    assert.equal(response.status, 200);
    assert.equal(response.data?.ok, true);
    assert.equal(response.data?.gateway?.enabled, true);
    assert.equal(response.data?.gateway?.running, true);
  });
});
