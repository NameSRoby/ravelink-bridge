// [TITLE] Test Module: test/register-compat-routes.rave-aliases.test.js
// [TITLE] Purpose: verify restored rave compatibility aliases map to engine-v2/live-compat behaviors

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
  return { ok: response.ok, status: response.status, data };
}

function createDeps() {
  let compatibility = {
    sceneLock: "auto",
    sceneIntent: "auto"
  };
  let syncGroups = {
    enabled: false,
    groups: [],
    updatedAt: 0
  };
  let overclock = {
    autoEnabled: false,
    level: 2,
    devHz: 0
  };
  return {
    enforceWriteAccess(_req, _res, next) { next(); },
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
      invokeHook: async () => ({ ok: true, invoked: 1, failed: 0, errors: [] }),
      handleHttp: async () => ({ status: 200, body: { ok: true } }),
      resolveUiAsset: () => ({ ok: false, error: "mod_ui_not_found" })
    },
    fixtureRegistry: {
      getFixtures: () => [{ id: "hue-main-1", brand: "hue", zone: "hue" }, { id: "wiz-main-1", brand: "wiz", zone: "wiz" }],
      getIntentRoutes: () => ({ HUE_STATE: "hue", WIZ_PULSE: "wiz" }),
      load: () => {},
      upsertFixture: fixture => ({ ok: true, fixture }),
      deleteFixture: () => ({ ok: true }),
      getConnectivitySnapshot: () => ({ ok: true, fixtureCount: 2, rows: [] }),
      testConnectivity: () => ({ ok: true })
    },
    liveCompatService: {
      patchCompatibility(patch = {}) {
        const sceneLock = String(patch.sceneLock || "auto").trim().toLowerCase();
        compatibility = {
          sceneLock,
          sceneIntent: sceneLock
        };
        return {
          ok: true,
          applied: { ...compatibility },
          snapshot: { ...compatibility }
        };
      },
      getCompatibility: () => ({ ok: true, snapshot: { ...compatibility } }),
      getTriggerMatrix: () => ({
        ok: true,
        global: { sceneFilterAggressiveness: { calm: 1, groove: 1, impact: 1 } },
        syncGroups: { ...syncGroups },
        brands: {},
        fixtureOverrides: {}
      }),
      patchTriggerMatrix: () => ({ ok: true }),
      getSyncGroups: () => ({ ok: true, snapshot: { ...syncGroups } }),
      patchSyncGroups: patch => {
        const source = patch && typeof patch === "object" ? patch : {};
        syncGroups = {
          enabled: source.enabled === true,
          groups: Array.isArray(source.groups) ? source.groups : [],
          updatedAt: Date.now()
        };
        return { ok: true, snapshot: { ...syncGroups }, triggerMatrixUpdatedAt: Date.now() };
      },
      getPaletteSnapshot: () => ({ ok: true }),
      patchPalette: () => ({ ok: true, config: {} }),
      getFixtureMetricsSnapshot: () => ({ ok: true }),
      patchFixtureMetrics: () => ({ ok: true }),
      clearFixtureRouting: () => ({ ok: true }),
      setOverclockAuto(enabled) {
        overclock = { ...overclock, autoEnabled: enabled === true };
        return { ok: true, overclock: { ...overclock } };
      },
      setOverclockPresetLevel(level) {
        overclock = { ...overclock, level: Number(level || 0), autoEnabled: false, devHz: 0 };
        return { ok: true, overclock: { ...overclock } };
      },
      setOverclockDevHz(hz) {
        overclock = { ...overclock, devHz: Number(hz || 0), autoEnabled: false };
        return { ok: true, overclock: { ...overclock } };
      },
      getOverclockTiers: () => ({ ok: true, tiers: [], activeLevel: overclock.level, autoEnabled: overclock.autoEnabled, devHz: overclock.devHz })
    },
    systemConfigService: {
      getConfig: () => ({ ok: true, config: {} }),
      patchConfig: () => ({ ok: true, config: {} }),
      generateWidgetTemplate: () => ({ ok: true, script: "" })
    },
    audioEngine: {
      getStatus: () => ({ backend: "rust", telemetryUpdatedAt: 1 }),
      getRaveState: () => ({ active: true, startedAt: 1, lastStoppedAt: 0 }),
      stopRave: () => ({ ok: true }),
      getTelemetry: () => ({ rms: 0.2, energy: 0.4, bpm: 126 }),
      setTelemetry: () => ({ ok: true })
    },
    engineV2: {
      getStatus: () => ({ running: true }),
      getTelemetryProjection: () => ({ scene: { sceneCandidate: "motion" } }),
      queueControlEvent: () => {}
    },
    enginePaletteService: {
      getSnapshot: () => ({})
    },
    hueBridge: { discoverBridges: async () => ({ ok: true, bridges: [] }), pairBridge: async () => ({ ok: false, error: "not_configured" }) },
    wizBridge: { discoverDevices: async () => ({ ok: true, devices: [] }) },
    startupReadinessService: { getSnapshot: () => ({ ok: true, current: { summary: { laneCount: 0, readyCount: 0, blocking: [], states: {} } } }) },
    startupLaunchDiagnosticsService: { getSnapshot: () => ({}) },
    audioRuntimeService: {
      getOptionalToolsStatus: () => ({ ok: true, status: { platform: "win32", optionalToolsReady: true, checks: {} } }),
      getApps: () => ({ ok: true, apps: [], processMetadata: [], audioHints: { source: "none", audioOnly: false, audioTokens: [], companionMap: {} } }),
      getAppIsolationLocks: () => ({ ok: true, locks: {}, telemetry: {} }),
      setAppIsolationLock: () => ({ ok: true, locks: {} }),
      clearAppIsolationLock: () => ({ ok: true, locks: {} }),
      scanAppIsolation: () => ({ ok: true, runningApps: [], processMetadata: [], audioHints: {}, telemetry: {}, config: {}, restarted: false }),
      getConfig: () => ({ ok: true, config: {}, telemetry: {} }),
      patchConfig: () => ({ ok: true, config: {}, changed: [], restarted: false, telemetry: {} }),
      restart: () => ({ ok: true, restarted: true, config: {}, telemetry: {} }),
      getDevices: () => ({ ok: true, devices: [], defaultOutputEndpointHint: { name: "" } }),
      getReactivityMap: () => ({ ok: true, config: {} }),
      patchReactivityMap: () => ({ ok: true, config: {} }),
      getProfiles: () => ({ ok: true, profiles: { profiles: [] } }),
      saveProfile: () => ({ ok: true, profile: { name: "main" } }),
      applyProfile: () => ({ ok: true, applyResult: { config: {} } }),
      deleteProfile: () => ({ ok: true, deleted: "main" }),
      getRustTransportWorkerStatus: () => ({ available: false }),
      requestRustTransportWorkerAdapterCatalog: () => ({ requested: false }),
      requestRustTransportWorkerWatchdogSnapshot: () => ({ requested: false }),
      setRustTransportWorkerConfig: () => ({ available: false }),
      startRustTransportWorker: () => ({ available: false }),
      stopRustTransportWorker: () => ({ available: false }),
      restartRustTransportWorker: () => ({ available: false })
    }
  };
}

async function withCompatServer(run) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));
  registerCompatRoutes(app, createDeps());
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

test("rave compatibility aliases map to deterministic v2/live-compat routes", async () => {
  await withCompatServer(async baseUrl => {
    const sceneAuto = await requestJson(baseUrl, "POST", "/rave/scene/auto");
    const sceneNamed = await requestJson(baseUrl, "POST", "/rave/scene?name=flow");
    const drop = await requestJson(baseUrl, "POST", "/rave/drop", {});
    const pipeline = await requestJson(baseUrl, "GET", "/rave/pipeline?brand=hue&limit=1");
    const fixtureProfiles = await requestJson(baseUrl, "GET", "/rave/fixture-behavior/profiles");
    const syncGroupsSet = await requestJson(baseUrl, "POST", "/rave/live/sync-groups", {
      enabled: true,
      groups: [
        { id: "g1", name: "G1", sequenceMode: "reverse", fixtureIds: ["hue-main-1"] }
      ]
    });
    const syncGroupsGet = await requestJson(baseUrl, "GET", "/rave/live/sync-groups");

    assert.equal(sceneAuto.status, 200);
    assert.equal(sceneAuto.data?.ok, true);
    assert.equal(sceneAuto.data?.sceneLock, "auto");
    assert.equal(sceneNamed.status, 200);
    assert.equal(sceneNamed.data?.sceneLock, "motion");
    assert.equal(drop.status, 200);
    assert.equal(drop.data?.ok, true);
    assert.equal(pipeline.status, 200);
    assert.equal(pipeline.data?.ok, true);
    assert.equal(pipeline.data?.fixtureCount, 1);
    assert.equal(fixtureProfiles.status, 200);
    assert.equal(fixtureProfiles.data?.ok, true);
    assert.equal(typeof fixtureProfiles.data?.global, "object");
    assert.equal(syncGroupsSet.status, 200);
    assert.equal(syncGroupsSet.data?.ok, true);
    assert.equal(syncGroupsGet.status, 200);
    assert.equal(syncGroupsGet.data?.ok, true);
    assert.equal(syncGroupsGet.data?.snapshot?.enabled, true);
    assert.equal(Array.isArray(syncGroupsGet.data?.snapshot?.groups), true);
    assert.equal(syncGroupsGet.data?.snapshot?.groups?.[0]?.id, "g1");
  });
});
