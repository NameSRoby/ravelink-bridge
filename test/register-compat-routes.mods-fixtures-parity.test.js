// [TITLE] Test Module: test/register-compat-routes.mods-fixtures-parity.test.js
// [TITLE] Purpose: verify restored mods/fixtures parity routes keep stable contracts

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
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

function createDeps(overrides = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-mod-ui-"));
  const modUiRoot = path.join(tempRoot, "example-mod", "ui");
  fs.mkdirSync(modUiRoot, { recursive: true });
  const modIndexPath = path.join(modUiRoot, "index.html");
  fs.writeFileSync(modIndexPath, "<!doctype html><html><body>mod-ui</body></html>", "utf8");
  const modAssetPath = path.join(modUiRoot, "asset.txt");
  fs.writeFileSync(modAssetPath, "asset-ok", "utf8");

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
      list: () => ({
        ok: true,
        mods: [{ id: "example-mod", hooks: ["onBoot"], loaded: true }],
        total: 1,
        loaded: 1,
        config: { enabled: ["example-mod"], order: ["example-mod"], disabled: [] },
        debug: { enabled: false, telemetryDebugSampleMs: 0, telemetryNoHandlerDebugMs: 0 }
      }),
      getSupportedHooks: () => ["onBoot", "onRaveStart"],
      getUiCatalog: () => ({
        ok: true,
        mods: [{
          id: "example-mod",
          name: "Example",
          version: "0.1.0",
          enabled: true,
          loaded: true,
          title: "Example UI",
          entry: "ui/index.html",
          url: "/mods-ui/example-mod/"
        }]
      }),
      reload: async () => ({ ok: true }),
      setDebugEnabled: () => ({ ok: true }),
      clearDebugBuffer: () => ({ ok: true }),
      importMods: async () => ({ ok: true }),
      updateConfig: async () => ({ ok: true }),
      invokeAction: async () => ({ status: 200, body: { ok: true } }),
      invokeHook: async hook => ({ ok: true, hook, invoked: 1, failed: 0, errors: [] }),
      handleHttp: async () => ({ status: 200, body: { ok: true } }),
      resolveUiAsset(modId, assetPath = "") {
        if (String(modId || "").trim() !== "example-mod") return { ok: false, error: "mod_not_found" };
        const safeAsset = String(assetPath || "").trim().replace(/^\/+/, "");
        if (!safeAsset) return { ok: true, filePath: modIndexPath };
        if (safeAsset === "asset.txt") return { ok: true, filePath: modAssetPath };
        return { ok: false, error: "mod_ui_asset_not_found" };
      }
    },
    fixtureRegistry: {
      getFixtures: () => [{ id: "wiz-main-1", brand: "wiz", zone: "main" }],
      getIntentRoutes: () => ({ HUE_STATE: "hue", WIZ_PULSE: "wiz", TWITCH_HUE: "hue", TWITCH_WIZ: "wiz" }),
      load: () => {},
      upsertFixture: fixture => ({ ok: true, fixture }),
      deleteFixture: () => ({ ok: true }),
      getConnectivitySnapshot: () => ({ ok: true, fixtureCount: 1, rows: [] }),
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
      stopRave: () => ({ ok: true }),
      getTelemetry: () => ({}),
      setTelemetry: () => ({ ok: true })
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
      saveProfile: () => ({ ok: true, profile: { name: "test" } }),
      applyProfile: () => ({ ok: true, applyResult: { config: {} } }),
      deleteProfile: () => ({ ok: true, deleted: "test" })
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

test("mods parity routes expose config/debug/hook + UI aliases", async () => {
  await withCompatServer(createDeps(), async baseUrl => {
    const config = await requestJson(baseUrl, "GET", "/mods/config");
    const debug = await requestJson(baseUrl, "GET", "/mods/debug");
    const hook = await requestJson(baseUrl, "POST", "/mods/hooks/onBoot", { payload: { at: 1 } });
    const modUiRoot = await fetch(toUrl(baseUrl, "/mods-ui/example-mod"));
    const modUiSlash = await fetch(toUrl(baseUrl, "/mods-ui/example-mod/"));
    const modUiAsset = await fetch(toUrl(baseUrl, "/mods-ui/example-mod/asset.txt"));

    assert.equal(config.status, 200);
    assert.equal(config.data?.ok, true);
    assert.equal(Array.isArray(config.data?.config?.enabled), true);
    assert.equal(debug.status, 200);
    assert.equal(debug.data?.ok, true);
    assert.equal(typeof debug.data?.debug, "object");
    assert.equal(hook.status, 200);
    assert.equal(hook.data?.ok, true);
    assert.equal(modUiRoot.status, 200);
    assert.equal(modUiSlash.status, 200);
    assert.equal(modUiAsset.status, 200);
  });
});

test("fixtures snapshot route exposes summary + connectivity fields used by the live UI", async () => {
  await withCompatServer(createDeps(), async baseUrl => {
    const snapshot = await requestJson(baseUrl, "GET", "/fixtures");

    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.data?.ok, true);
    assert.equal(Array.isArray(snapshot.data?.fixtures), true);
    assert.equal(typeof snapshot.data?.summary, "object");
    assert.equal(snapshot.data?.summary?.wiz, 1);
    assert.equal(snapshot.data?.summary?.wizEngine, 1);
    assert.equal(typeof snapshot.data?.connectivitySummary, "object");
    assert.equal(snapshot.data?.connectivitySummary?.total, 1);
    assert.equal(Array.isArray(snapshot.data?.connectivity), true);
  });
});
