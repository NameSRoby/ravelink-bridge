// [TITLE] Test Module: test/audio-runtime.catalog.test.js
// [TITLE] Purpose: guard audio runtime catalog discovery and fallback shaping helpers

const test = require("node:test");
const assert = require("node:assert/strict");

const createAudioRuntimeCatalog = require("../src/domains/audio/audio-runtime.catalog");

function createCatalogHelper(overrides = {}) {
  let config = {
    desktopOutputDeviceName: "",
    ffmpegInputDevice: "",
    deviceMatch: "",
    ffmpegAppIsolationPrimaryApp: "",
    ffmpegAppIsolationFallbackApp: "",
    ...(overrides.config || {})
  };
  let cacheApps = {
    at: 0,
    payload: {
      ok: true,
      apps: [],
      processMetadata: [],
      audioHints: { source: "proctap_audio_processes", audioOnly: false, audioTokens: [], companionMap: {} }
    }
  };
  const telemetry = {
    ...(overrides.telemetry || {})
  };
  const helper = createAudioRuntimeCatalog({
    normalizeString: overrides.normalizeString || ((value, max = 256) => String(value || "").trim().slice(0, max)),
    cloneJsonSafe: overrides.cloneJsonSafe || (value => JSON.parse(JSON.stringify(value))),
    normalizeAppName: overrides.normalizeAppName || (value => String(value || "").trim()),
    normalizeAppToken: overrides.normalizeAppToken || (value => String(value || "").trim().toLowerCase().replace(/\.exe$/i, "")),
    normalizeTokenList: overrides.normalizeTokenList || (values => (Array.isArray(values) ? values : []).map(value => String(value || "").trim().toLowerCase().replace(/\.exe$/i, "")).filter(Boolean)),
    tokenLooksBrowserLike: overrides.tokenLooksBrowserLike || (token => ["firefox", "chrome", "msedge", "msedgewebview2"].includes(String(token || "").trim().toLowerCase())),
    detectBrowserChannelHint: overrides.detectBrowserChannelHint || (() => ""),
    buildCompanionMapFromAudioTokens: overrides.buildCompanionMapFromAudioTokens || (() => ({})),
    runPowerShellJson: overrides.runPowerShellJson || (() => []),
    listProcTapAudioProcessesSync: overrides.listProcTapAudioProcessesSync || (() => ({ ok: false, source: "window_activity", audioTokens: [] })),
    now: overrides.now || (() => 1700000000000),
    getConfig: overrides.getConfig || (() => config),
    getCacheApps: overrides.getCacheApps || (() => cacheApps),
    setCacheApps: overrides.setCacheApps || (next => {
      cacheApps = { ...next };
    }),
    audioEngine: overrides.audioEngine || {
      getTelemetry() {
        return { ...telemetry };
      }
    },
    platform: overrides.platform || "win32"
  });
  return {
    helper,
    readCacheApps: () => ({ ...cacheApps, payload: JSON.parse(JSON.stringify(cacheApps.payload)) }),
    readConfig: () => ({ ...config }),
    setConfig: next => {
      config = { ...config, ...(next || {}) };
    }
  };
}

test("audio catalog fallback output prefers configured or telemetry device names over generic defaults", () => {
  const runtime = createCatalogHelper({
    config: {
      desktopOutputDeviceName: "",
      ffmpegInputDevice: "",
      deviceMatch: "none"
    },
    telemetry: {
      device: "Headphones (RAVE)"
    }
  });

  const name = runtime.helper.resolveFallbackOutputDeviceName();

  assert.equal(name, "Headphones (RAVE)");
});

test("audio catalog fallback app rows dedupe config and telemetry app names", () => {
  const runtime = createCatalogHelper({
    config: {
      ffmpegAppIsolationPrimaryApp: "Firefox.exe",
      ffmpegAppIsolationFallbackApp: "Firefox.exe"
    },
    telemetry: {
      appIsolation: {
        selectedApp: "firefox.exe",
        activeApp: "spotify.exe",
        primaryApp: "Firefox.exe"
      }
    }
  });

  const rows = runtime.helper.buildConfiguredAppFallbackRows();

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.displayName), [
    "firefox.exe",
    "spotify.exe"
  ]);
  assert.equal(rows.every(row => row.configuredFallback === true), true);
});

test("audio catalog getApps uses configured fallback rows when Windows process discovery is empty", () => {
  const runtime = createCatalogHelper({
    config: {
      ffmpegAppIsolationPrimaryApp: "Firefox.exe"
    },
    runPowerShellJson: () => [],
    listProcTapAudioProcessesSync: () => ({
      ok: false,
      source: "window_activity",
      audioTokens: [],
      error: ""
    })
  });

  const payload = runtime.helper.getApps({
    forceRefresh: true
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.apps.length, 1);
  assert.equal(payload.apps[0].displayName, "firefox.exe");
  assert.equal(payload.audioHints.source, "config_fallback");
  assert.deepEqual(runtime.readCacheApps().payload.apps, payload.apps);
});
