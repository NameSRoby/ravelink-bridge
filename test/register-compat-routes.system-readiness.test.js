// [TITLE] Test Module: test/register-compat-routes.system-readiness.test.js
// [TITLE] Purpose: verify /system/startup-readiness compatibility route behavior

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
        boot: {
          capturedAt: Date.now(),
          lanes: {},
          summary: { readyCount: 6, laneCount: 6, blocking: [] }
        },
        current: {
          capturedAt: Date.now(),
          lanes: {},
          summary: { readyCount: 6, laneCount: 6, blocking: [] }
        }
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

test("compat startup-readiness route returns lane snapshot", async () => {
  await withCompatServer(createDeps({
    startupReadinessService: {
      getSnapshot: () => ({
        ok: true,
        generatedAt: 123,
        boot: {
          capturedAt: 100,
          lanes: {
            mods: { state: "loaded", detail: "1/1 mods loaded" }
          },
          summary: { readyCount: 5, laneCount: 6, blocking: ["wiz"] }
        },
        current: {
          capturedAt: 123,
          lanes: {
            wiz: { state: "missing", detail: "0/0 configured" }
          },
          summary: { readyCount: 5, laneCount: 6, blocking: ["wiz"] }
        }
      })
    }
  }), async baseUrl => {
    const response = await requestJson(baseUrl, "GET", "/system/startup-readiness");
    assert.equal(response.status, 200);
    assert.equal(response.data?.ok, true);
    assert.equal(response.data?.boot?.lanes?.mods?.state, "loaded");
    assert.equal(response.data?.current?.summary?.readyCount, 5);
  });
});

test("compat startup-readiness route reports unavailable when service missing", async () => {
  await withCompatServer(createDeps({
    startupReadinessService: null
  }), async baseUrl => {
    const response = await requestJson(baseUrl, "GET", "/system/startup-readiness");
    assert.equal(response.status, 503);
    assert.equal(response.data?.ok, false);
    assert.equal(response.data?.error, "startup_readiness_unavailable");
  });
});
