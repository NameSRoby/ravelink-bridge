// [TITLE] Test Module: test/register-compat-routes.audio.test.js
// [TITLE] Purpose: verify /audio/* compatibility routes are wired and shaped for UI contracts

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

function createDeps(overrides = {}) {
  const audioRuntimeService = {
    getOptionalToolsStatus: () => ({ ok: true, status: { platform: "win32", optionalToolsReady: true, checks: {} } }),
    getApps: () => ({
      ok: true,
      apps: [{ displayName: "spotify.exe", app: "spotify.exe", processName: "spotify", instances: 1, pids: [1234], audioCapable: true, likelyAudio: true, likelyAudioConfidence: 0.9, windowTitles: [] }],
      processMetadata: [],
      audioHints: { source: "proctap_audio_processes", audioOnly: false, audioTokens: ["spotify"], companionMap: {} }
    }),
    getAppIsolationLocks: () => ({ ok: true, locks: { spotify: "spotify" }, telemetry: { appIsolation: { enabled: true } } }),
    setAppIsolationLock: body => ({ ok: true, locks: { [String(body.sourceToken || "spotify").replace(/\.exe$/i, "")]: String(body.captureToken || "spotify").replace(/\.exe$/i, "") } }),
    clearAppIsolationLock: () => ({ ok: true, locks: {} }),
    scanAppIsolation: () => ({ ok: true, runningApps: [], processMetadata: [], audioHints: {}, telemetry: { appIsolation: { enabled: true } }, config: {}, restarted: false }),
    getConfig: () => ({ ok: true, config: { inputBackend: "auto", sampleRate: 96000 }, telemetry: { running: true } }),
    patchConfig: body => ({ ok: true, config: { inputBackend: body.inputBackend || "auto" }, changed: Object.keys(body || {}), restarted: false, telemetry: { running: true } }),
    restart: () => ({ ok: true, reason: "audio_restart_route", restarted: true, config: { inputBackend: "auto" }, telemetry: { running: true } }),
    getDevices: () => ({ ok: true, devices: [{ id: "1", name: "Speakers", backend: "desktop_output", isDefaultOutput: true }, { id: "1", name: "Speakers", backend: "portaudio", isDefaultOutput: true }], defaultOutputEndpointHint: { name: "Speakers" } }),
    getReactivityMap: () => ({ ok: true, config: { reactivityGainMode: "auto", reactivityGain: 1 } }),
    patchReactivityMap: () => ({ ok: true, config: { reactivityGainMode: "manual", reactivityGain: 1.2 } }),
    getProfiles: () => ({ ok: true, profiles: { profiles: [{ id: "main", name: "Main", updatedAt: 1 }] } }),
    saveProfile: () => ({ ok: true, profile: { name: "Main" } }),
    applyProfile: () => ({ ok: true, applyResult: { config: { sampleRate: 48000 } } }),
    deleteProfile: () => ({ ok: true, deleted: "main" }),
    getRustTransportWorkerStatus: () => ({
      available: true,
      enabled: true,
      running: false,
      telemetry: {
        lastAdapterCatalog: { generatedAt: 1, adapters: [] },
        lastWatchdog: { generatedAt: 1, running: false, heartbeatOk: false }
      }
    }),
    requestRustTransportWorkerAdapterCatalog: () => ({ requested: true }),
    requestRustTransportWorkerWatchdogSnapshot: () => ({ requested: true }),
    setRustTransportWorkerConfig: () => ({ available: true, enabled: true, running: true }),
    startRustTransportWorker: () => ({ available: true, enabled: true, running: true }),
    stopRustTransportWorker: () => ({ available: true, enabled: false, running: false }),
    restartRustTransportWorker: () => ({ available: true, enabled: true, running: true })
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
      stopRave: () => ({ ok: true }),
      getTelemetry: () => ({}),
      setTelemetry: () => ({ ok: true })
    },
    hueBridge: { discoverBridges: async () => ({ ok: true, bridges: [] }), pairBridge: async () => ({ ok: false, error: "not_configured" }) },
    wizBridge: { discoverDevices: async () => ({ ok: true, devices: [] }) },
    startupReadinessService: { getSnapshot: () => ({ ok: true, current: { summary: { laneCount: 0, readyCount: 0, blocking: [], states: {} } } }) },
    startupLaunchDiagnosticsService: { getSnapshot: () => ({}) },
    audioRuntimeService,
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

test("audio compatibility GET routes return expected UI bootstrap contracts", async () => {
  await withCompatServer(createDeps(), async baseUrl => {
    const cfg = await requestJson(baseUrl, "GET", "/audio/config");
    const devices = await requestJson(baseUrl, "GET", "/audio/devices");
    const apps = await requestJson(baseUrl, "GET", "/audio/apps");
    const profiles = await requestJson(baseUrl, "GET", "/audio/profiles");
    const profileSchema = await requestJson(baseUrl, "GET", "/audio/profiles/schema");
    const map = await requestJson(baseUrl, "GET", "/audio/reactivity-map");
    const tools = await requestJson(baseUrl, "GET", "/audio/optional-tools/status");
    const locks = await requestJson(baseUrl, "GET", "/audio/ffmpeg/app-isolation/locks");
    const workerStatus = await requestJson(baseUrl, "GET", "/audio/rust/transport-worker/status");
    const workerAdapters = await requestJson(baseUrl, "GET", "/audio/rust/transport-worker/adapters?refresh=true");
    const workerWatchdog = await requestJson(baseUrl, "GET", "/audio/rust/transport-worker/watchdog?refresh=true");

    assert.equal(cfg.status, 200);
    assert.equal(cfg.data?.ok, true);
    assert.equal(typeof cfg.data?.config, "object");
    assert.equal(Array.isArray(devices.data?.devices), true);
    assert.equal(Array.isArray(apps.data?.apps), true);
    assert.equal(Array.isArray(profiles.data?.profiles?.profiles), true);
    assert.equal(profileSchema.data?.ok, true);
    assert.equal(profileSchema.data?.schema?.type, "object");
    assert.equal(map.data?.ok, true);
    assert.equal(tools.data?.ok, true);
    assert.equal(typeof locks.data?.locks, "object");
    assert.equal(workerStatus.data?.ok, true);
    assert.equal(typeof workerStatus.data?.status, "object");
    assert.equal(workerAdapters.data?.ok, true);
    assert.equal(typeof workerAdapters.data?.status, "object");
    assert.equal(workerWatchdog.data?.ok, true);
    assert.equal(typeof workerWatchdog.data?.status, "object");
  });
});

test("audio compatibility mutation routes return expected payload structures", async () => {
  await withCompatServer(createDeps(), async baseUrl => {
    const patch = await requestJson(baseUrl, "POST", "/audio/config", { inputBackend: "rustloop" });
    const restart = await requestJson(baseUrl, "POST", "/audio/restart", {});
    const saveProfile = await requestJson(baseUrl, "POST", "/audio/profiles/save", { name: "Main" });
    const applyProfile = await requestJson(baseUrl, "POST", "/audio/profiles/apply", { name: "Main" });
    const deleteProfile = await requestJson(baseUrl, "POST", "/audio/profiles/delete", { name: "Main" });
    const setLock = await requestJson(baseUrl, "POST", "/audio/ffmpeg/app-isolation/locks/set", { sourceToken: "spotify.exe", captureToken: "spotify.exe" });
    const clearLock = await requestJson(baseUrl, "POST", "/audio/ffmpeg/app-isolation/locks/clear", { sourceToken: "spotify.exe" });
    const scan = await requestJson(baseUrl, "POST", "/audio/ffmpeg/app-isolation/scan", {});
    const map = await requestJson(baseUrl, "POST", "/audio/reactivity-map", { reactivityGainMode: "manual", reactivityGain: 1.2 });
    const workerConfig = await requestJson(baseUrl, "POST", "/audio/rust/transport-worker/config", { enabled: true });
    const workerStart = await requestJson(baseUrl, "POST", "/audio/rust/transport-worker/start", { reason: "test_start" });
    const workerStop = await requestJson(baseUrl, "POST", "/audio/rust/transport-worker/stop", { disable: true });
    const workerRestart = await requestJson(baseUrl, "POST", "/audio/rust/transport-worker/restart", { reason: "test_restart" });

    assert.equal(patch.status, 200);
    assert.equal(typeof patch.data?.config, "object");
    assert.equal(restart.data?.ok, true);
    assert.equal(saveProfile.data?.ok, true);
    assert.equal(typeof applyProfile.data?.applyResult?.config, "object");
    assert.equal(deleteProfile.data?.ok, true);
    assert.equal(setLock.data?.ok, true);
    assert.equal(clearLock.data?.ok, true);
    assert.equal(scan.data?.ok, true);
    assert.equal(map.data?.ok, true);
    assert.equal(typeof map.data?.config, "object");
    assert.equal(workerConfig.data?.ok, true);
    assert.equal(typeof workerConfig.data?.status, "object");
    assert.equal(workerStart.data?.ok, true);
    assert.equal(workerStop.data?.ok, true);
    assert.equal(workerRestart.data?.ok, true);
  });
});

test("audio config route forces restart for app-isolation apply when capture is active", async () => {
  const calls = [];
  const deps = createDeps({
    audioRuntimeService: {
      ...createDeps().audioRuntimeService,
      getSessionStatus: () => ({ active: true }),
      patchConfig: async (body, options = {}) => {
        calls.push({ body, options });
        return { ok: true, config: body, changed: Object.keys(body || {}), restarted: options.restart === true };
      }
    }
  });
  await withCompatServer(deps, async baseUrl => {
    const patch = await requestJson(baseUrl, "POST", "/audio/config", {
      ffmpegAppIsolationEnabled: true,
      ffmpegAppIsolationPrimaryApp: "firefox.exe",
      restart: true,
      reason: "ui_audio_config_apply"
    });
    assert.equal(patch.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options?.restart, true);
    assert.equal(calls[0].options?.reason, "ui_audio_config_apply");
    assert.equal(Object.hasOwn(calls[0].body, "restart"), false);
    assert.equal(Object.hasOwn(calls[0].body, "reason"), false);
  });
});

test("app-isolation lock routes honor restart/apply intent and trigger scan/rebind", async () => {
  const scanCalls = [];
  const deps = createDeps({
    audioRuntimeService: {
      ...createDeps().audioRuntimeService,
      getSessionStatus: () => ({ active: true }),
      scanAppIsolation: async payload => {
        scanCalls.push(payload || {});
        return { ok: true, restarted: payload?.forceRestart === true, telemetry: { running: true }, capture: {}, session: {} };
      }
    }
  });
  await withCompatServer(deps, async baseUrl => {
    const setLock = await requestJson(baseUrl, "POST", "/audio/ffmpeg/app-isolation/locks/set", {
      sourceToken: "spotify.exe",
      captureToken: "spotify.exe",
      restart: true
    });
    assert.equal(setLock.status, 200);
    assert.equal(setLock.data?.ok, true);
    assert.equal(setLock.data?.apply?.ok, true);
    assert.equal(setLock.data?.apply?.restarted, true);

    const clearLockNoApply = await requestJson(baseUrl, "POST", "/audio/ffmpeg/app-isolation/locks/clear", {
      sourceToken: "spotify.exe",
      apply: false
    });
    assert.equal(clearLockNoApply.status, 200);
    assert.equal(clearLockNoApply.data?.ok, true);
    assert.equal(clearLockNoApply.data?.apply, undefined);
  });
  assert.equal(scanCalls.length, 1);
  assert.equal(scanCalls[0]?.forceRestart, true);
});

test("hot audio probe routes reuse cached payloads on immediate repeated reads", async () => {
  let appsCalls = 0;
  let devicesCalls = 0;
  let toolsCalls = 0;
  const deps = createDeps({
    audioRuntimeService: {
      ...createDeps().audioRuntimeService,
      getApps: () => {
        appsCalls += 1;
        return {
          ok: true,
          apps: [{ displayName: `spotify-${appsCalls}.exe` }],
          processMetadata: [],
          audioHints: { source: "test", audioOnly: false, audioTokens: [], companionMap: {} }
        };
      },
      getDevices: () => {
        devicesCalls += 1;
        return {
          ok: true,
          devices: [{ id: "1", name: `Speakers-${devicesCalls}`, backend: "desktop_output", isDefaultOutput: true }],
          defaultOutputEndpointHint: { name: `Speakers-${devicesCalls}` }
        };
      },
      getOptionalToolsStatus: () => {
        toolsCalls += 1;
        return {
          ok: true,
          status: { platform: "win32", optionalToolsReady: true, checks: {}, seq: toolsCalls }
        };
      }
    }
  });

  await withCompatServer(deps, async baseUrl => {
    const appsOne = await requestJson(baseUrl, "GET", "/audio/apps");
    const appsTwo = await requestJson(baseUrl, "GET", "/audio/apps");
    const devicesOne = await requestJson(baseUrl, "GET", "/audio/devices");
    const devicesTwo = await requestJson(baseUrl, "GET", "/audio/devices");
    const toolsOne = await requestJson(baseUrl, "GET", "/audio/optional-tools/status");
    const toolsTwo = await requestJson(baseUrl, "GET", "/audio/optional-tools/status");

    assert.equal(appsOne.status, 200);
    assert.equal(appsTwo.status, 200);
    assert.equal(devicesOne.status, 200);
    assert.equal(devicesTwo.status, 200);
    assert.equal(toolsOne.status, 200);
    assert.equal(toolsTwo.status, 200);
    assert.equal(appsOne.data?.apps?.[0]?.displayName, appsTwo.data?.apps?.[0]?.displayName);
    assert.equal(devicesOne.data?.devices?.[0]?.name, devicesTwo.data?.devices?.[0]?.name);
    assert.equal(toolsOne.data?.status?.seq, toolsTwo.data?.status?.seq);
  });

  assert.equal(appsCalls, 1);
  assert.equal(devicesCalls, 1);
  assert.equal(toolsCalls, 1);
});
