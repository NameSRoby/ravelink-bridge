// [TITLE] Test Module: test/register-compat-routes.telemetry.test.js
// [TITLE] Purpose: verify telemetry compatibility routes keep stable payload contracts

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
      getCompatibility: () => ({ ok: true, snapshot: { sceneLock: "auto", sceneIntent: "flow" } }),
      patchCompatibility: () => ({ ok: true }),
      getTriggerMatrix: () => ({ ok: true, global: {}, brands: {}, fixtureOverrides: {} }),
      patchTriggerMatrix: () => ({ ok: true }),
      getSyncGroups: () => ({ ok: true, snapshot: { enabled: false, groups: [] } }),
      patchSyncGroups: () => ({ ok: true }),
      getPaletteSnapshot: () => ({ ok: true }),
      patchPalette: () => ({ ok: true }),
      getFixtureMetricsSnapshot: () => ({ ok: true }),
      patchFixtureMetrics: () => ({ ok: true }),
      clearFixtureRouting: () => ({ ok: true }),
      getOverclockTiers: () => ({ ok: true, tiers: [], activeLevel: 3, devHz: 0 }),
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
      getStatus: () => ({ backend: "rust", telemetryUpdatedAt: 123 }),
      getRaveState: () => ({ active: true }),
      getTelemetry: () => ({ rms: 0.4, energy: 0.8, bpm: 128 }),
      stopRave: () => ({ ok: true })
    },
    engineV2: {
      getStatus: () => ({ running: true, tickMs: 100, tickCount: 7 }),
      getTelemetryProjection: () => ({
        scene: {
          sceneCandidate: "flow",
          cadenceState: {
            autoEnabled: true,
            requestedHz: 14,
            appliedHz: 12,
            guardReason: "hardware_limit",
            guarded: true,
            overclockLevel: 4
          }
        }
      })
    },
    hueBridge: {},
    wizBridge: {},
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

test("compat telemetry routes keep rave projection fields and hardware fallbacks stable", async () => {
  await withCompatServer(createDeps(), async baseUrl => {
    const raveTelemetry = await requestJson(baseUrl, "GET", "/rave/telemetry");
    const hueTelemetry = await requestJson(baseUrl, "GET", "/hue/telemetry");
    const wizTelemetry = await requestJson(baseUrl, "GET", "/wiz/telemetry");

    assert.equal(raveTelemetry.status, 200);
    assert.equal(raveTelemetry.data?.ok, true);
    assert.equal(raveTelemetry.data?.source, "engine_v2_projection");
    assert.equal(raveTelemetry.data?.scene, "motion");
    assert.equal(raveTelemetry.data?.active, true);
    assert.equal(raveTelemetry.data?.running, true);
    assert.equal(raveTelemetry.data?.cadenceAutoEnabled, true);
    assert.equal(raveTelemetry.data?.cadenceAutoRequestedHz, 14);
    assert.equal(raveTelemetry.data?.cadenceAutoAppliedHz, 12);
    assert.equal(raveTelemetry.data?.cadenceAutoGuardReason, "hardware_limit");
    assert.equal(raveTelemetry.data?.overclockLevel, 4);
    assert.equal(raveTelemetry.data?.audio?.backend, "rust");
    assert.equal(typeof raveTelemetry.data?.engine?.projection, "object");

    assert.equal(hueTelemetry.status, 200);
    assert.equal(hueTelemetry.data?.ok, true);
    assert.equal(hueTelemetry.data?.source, "compat_projection");
    assert.equal(hueTelemetry.data?.status, "ready");

    assert.equal(wizTelemetry.status, 200);
    assert.equal(wizTelemetry.data?.ok, true);
    assert.equal(wizTelemetry.data?.source, "compat_projection");
    assert.equal(wizTelemetry.data?.status, "ready");
  });
});
