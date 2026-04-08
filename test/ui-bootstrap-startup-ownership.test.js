const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function readFile(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8");
}

function extractScriptPaths(html = "") {
  const out = [];
  const regex = /<script\s+src="([^"]+)"/gi;
  let match = regex.exec(html);
  while (match) {
    out.push(String(match[1] || "").trim());
    match = regex.exec(html);
  }
  return out.filter(Boolean);
}

async function flushAsyncWork() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

test("script manifest loads app helper layer before domain runtimes and bootstrap", () => {
  const html = readFile("public/templates/index/sections/scripts.html");
  const scripts = extractScriptPaths(html);
  const domIndex = scripts.findIndex(src => src.includes("assets/js/core/dom.js"));
  const httpIndex = scripts.findIndex(src => src.includes("assets/js/core/http.js"));
  const audioIndex = scripts.findIndex(src => src.includes("assets/js/domains/audio.js"));
  const systemFlowIndex = scripts.findIndex(src => src.includes("assets/js/domains/system-flow.js"));
  const collapsibleIndex = scripts.findIndex(src => src.includes("ui-collapsible-panels-runtime-ui.js"));
  const appIndex = scripts.findIndex(src => src.includes("assets/js/app.js"));
  const bootstrapIndex = scripts.findIndex(src => src.includes("assets/js/bootstrap.js"));

  assert.equal(domIndex >= 0, true);
  assert.equal(httpIndex >= 0, true);
  assert.equal(audioIndex >= 0, true);
  assert.equal(systemFlowIndex >= 0, true);
  assert.equal(collapsibleIndex >= 0, true);
  assert.equal(appIndex >= 0, true);
  assert.equal(bootstrapIndex >= 0, true);
  assert.equal(domIndex < appIndex, true);
  assert.equal(httpIndex < appIndex, true);
  assert.equal(appIndex < audioIndex, true);
  assert.equal(appIndex < systemFlowIndex, true);
  assert.equal(collapsibleIndex < bootstrapIndex, true);
  assert.equal(appIndex < bootstrapIndex, true);
});

test("app.js no longer owns startup fallback orchestration or retry scheduling", () => {
  const source = readFile("public/assets/js/app.js");

  assert.equal(source.includes("runUiStartupFallbackPass"), false);
  assert.equal(source.includes("ensureFallbackDelegatedShellBindings"), false);
  assert.equal(source.includes("refreshFixturesFromServer(delayed)"), false);
  assert.equal(source.includes("loadMods retry failed"), false);
  assert.equal(source.includes("startup_t250"), false);
});

test("bootstrap owns fallback labels and keeps final fallback invocation local to bootstrap", async () => {
  const filePath = path.resolve(__dirname, "../public/assets/js/bootstrap.js");
  const code = fs.readFileSync(filePath, "utf8");

  const context = {
    console,
    Promise,
    window: {},
    ui: {
      startTabPreference: "live",
      activeTab: ""
    },
    el: {
      modActionModId: { value: "" },
      modActionName: { value: "" }
    },
    AUDIO_REACTIVITY_MAP_DEFAULT: { targets: {} },
    setTimeout(callback, delayMs) {
      return { callback, delayMs };
    },
    clearTimeout() {},
    loadSystemServerConfig: async () => true,
    hydrateLiveModePolicyUi: async () => true,
    bootLiveControlsUi: async () => true,
    initThemeSettings: async () => true,
    initObsDockMode: async () => true,
    hydrateAudioStartupDataUi: async () => true,
    refreshFixturesFromServer: async () => ({ ok: true }),
    loadMods: async () => true,
    applySystemSettingsUi() {},
    restoreSystemWidgetPrefsFromStorage() {},
    loadSystemWidgetOauthSyncProfile: async () => true,
    loadSystemRouteCatalog: async () => true,
    loadSystemUpdateStatus: async () => true,
    loadSystemStartupReadiness: async () => true,
    loadSystemInternetGatewayStatus: async () => true,
    loadSystemWidgetReconcileStatus: async () => true,
    loadSystemRustTransportWorkerStatus: async () => true,
    applyApiBaseUi() {},
    applyFlowIntensityUi() {},
    applyAudioReactivityMapToUi() {},
    initCollapsiblePanels() {},
    applyUiTooltips() {},
    initLiveProfileControls() {},
    resetFixtureForm() {},
    showTab() {},
    sync() {},
    initOnboardingGate() {},
    initHueEntGuideGate() {},
    isLiveProfilesOnlyModeUi: () => false,
    loadPaletteConfig: async () => true,
    loadLiveSceneSnapshot: async () => true,
    pollLoop() {},
    syncAudioQuickPresetButtons() {},
    loadAudioReactivityMap() {},
    loadAudioOptionalToolsStatus() {},
    loadMidiStatus() {},
    loadColorPrefixConfig() {},
    runSystemNonLiveUiWiringAudit: async () => true,
    updateMainScopeInput() {},
    updateScopeHud() {},
    updateMonitorRenderingState() {}
  };

  vm.createContext(context);
  vm.runInContext(code, context, { filename: filePath });
  await flushAsyncWork();

  assert.equal(code.includes("startup_t250"), false);
  assert.equal(code.includes("startup_t1500"), false);
  assert.equal(code.includes("startup_t3200"), false);
  assert.equal(code.includes("runUiStartupFallbackPass"), false);
  assert.equal(code.includes("initGuidedOnboarding"), false);
  assert.equal(context.window.__ravelinkBootSummary.ok, true);
  assert.equal(code.includes("refreshFixturesFromServer(delayed)"), true);
});
