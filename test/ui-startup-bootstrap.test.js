const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createConsoleStub() {
  return {
    debug() {},
    log() {},
    warn() {},
    error() {}
  };
}

function createStorageStub() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(String(key)) ? map.get(String(key)) : null;
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
    removeItem(key) {
      map.delete(String(key));
    }
  };
}

function createTimerHarness() {
  const timers = [];
  let nextId = 1;
  return {
    timers,
    setTimeout(fn, delay) {
      const timer = {
        id: nextId++,
        delay: Number(delay) || 0,
        fn,
        cleared: false
      };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer && typeof timer === "object") {
        timer.cleared = true;
      }
    }
  };
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail(message);
}

function loadScript(relativeFile, context) {
  const filePath = path.resolve(__dirname, "..", relativeFile);
  const code = fs.readFileSync(filePath, "utf8");
  vm.createContext(context);
  vm.runInContext(code, context, { filename: filePath });
  return context;
}

function createBootstrapHarness(overrides = {}) {
  const timers = createTimerHarness();
  const callCounts = {
    loadMods: 0,
    refreshFixturesFromServer: 0
  };
  const context = {
    console: createConsoleStub(),
    Promise,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    window: {},
    ui: {
      startTabPreference: "live",
      activeTab: "live"
    },
    el: {
      modActionModId: { value: "" },
      modActionName: { value: "" }
    },
    AUDIO_REACTIVITY_MAP_DEFAULT: { hue: { enabled: true } },
    normalizeStartTabPreference: value => String(value || "live").trim().toLowerCase() || "live",
    applySystemSettingsUi() {},
    restoreSystemWidgetPrefsFromStorage() {},
    loadSystemWidgetOauthSyncProfile: async () => true,
    loadSystemServerConfig: async () => true,
    loadSystemRouteCatalog: async () => true,
    loadSystemUpdateStatus: async () => true,
    loadSystemStartupReadiness: async () => true,
    loadSystemInternetGatewayStatus: async () => true,
    loadSystemWidgetReconcileStatus: async () => true,
    loadSystemRustTransportWorkerStatus: async () => true,
    applyApiBaseUi() {},
    applyFlowIntensityUi() {},
    applyAudioReactivityMapToUi() {},
    hydrateLiveModePolicyUi: async () => true,
    bootLiveControlsUi: async () => true,
    initThemeSettings() {},
    initObsDockMode() {},
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
    hydrateAudioStartupDataUi: async () => true,
    loadAudioReactivityMap() {},
    loadAudioOptionalToolsStatus() {},
    loadMidiStatus() {},
    refreshFixturesFromServer: async () => {
      callCounts.refreshFixturesFromServer += 1;
      return { ok: true };
    },
    loadMods: async () => {
      callCounts.loadMods += 1;
      return true;
    },
    loadColorPrefixConfig() {},
    runSystemNonLiveUiWiringAudit: async () => true,
    updateMainScopeInput() {},
    updateScopeHud() {},
    updateMonitorRenderingState() {},
    ...overrides
  };

  loadScript("public/assets/js/bootstrap.js", context);
  return { context, timers: timers.timers, callCounts };
}

function createClassList(initial = []) {
  const values = new Set(initial);
  return {
    add(name) {
      values.add(String(name));
    },
    remove(...names) {
      names.forEach(name => values.delete(String(name)));
    },
    contains(name) {
      return values.has(String(name));
    },
    toggle(name, force) {
      const key = String(name);
      if (force === undefined) {
        if (values.has(key)) {
          values.delete(key);
          return false;
        }
        values.add(key);
        return true;
      }
      if (force) values.add(key);
      else values.delete(key);
      return Boolean(force);
    }
  };
}

function createCollapsibleHarness() {
  const localStorage = createStorageStub();
  const buttonListeners = [];
  const button = {
    dataset: {},
    textContent: "",
    attrs: {},
    setAttribute(name, value) {
      this.attrs[String(name)] = String(value);
    },
    addEventListener(type, handler) {
      buttonListeners.push({ type, handler });
    },
    closest(selector) {
      return selector === ".collapsible" ? section : null;
    }
  };
  const section = {
    id: "deviceRouting",
    dataset: {},
    classList: createClassList(),
    querySelector(selector) {
      return selector === "[data-collapse-btn]" ? button : null;
    }
  };
  const documentRef = {
    querySelectorAll(selector) {
      if (selector === ".collapsible") return [section];
      if (selector === ".collapsible [data-collapse-btn]") return [button];
      return [];
    }
  };
  const context = {
    console: createConsoleStub(),
    localStorage,
    document: documentRef,
    window: {
      matchMedia() {
        return { matches: false };
      }
    }
  };

  loadScript("public/assets/js/domains/ui-collapsible-panels-runtime-ui.js", context);
  return {
    context,
    section,
    button,
    localStorage,
    getClickHandler() {
      return buttonListeners.find(listener => listener.type === "click")?.handler || null;
    }
  };
}

test("bootstrap initializes directly without scheduling startup fallback passes", async () => {
  const harness = createBootstrapHarness();
  await waitFor(
    () => harness.callCounts.loadMods === 1,
    "bootstrap did not reach the initial mods load"
  );

  const activeDelays = harness.timers.filter(timer => !timer.cleared).map(timer => timer.delay);
  assert.deepEqual(activeDelays.filter(delay => delay === 250 || delay === 1500 || delay === 3200), []);
  assert.equal(activeDelays.includes(1800), true);
});

test("bootstrap isolates optional boot failures and continues later startup work", async () => {
  const stages = [];
  const harness = createBootstrapHarness({
    loadSystemServerConfig: async () => {
      throw new Error("config_boom");
    },
    bootLiveControlsUi: async () => {
      stages.push("bootLiveControlsUi");
      return true;
    },
    hydrateAudioStartupDataUi: async () => {
      stages.push("hydrateAudioStartupDataUi");
      return true;
    }
  });

  await waitFor(
    () => stages.length === 2,
    "bootstrap did not finish later startup work after optional step failure"
  );

  assert.deepEqual(stages, ["bootLiveControlsUi", "hydrateAudioStartupDataUi"]);

  const summary = harness.context.window.__ravelinkBootSummary;
  assert.equal(summary.ok, true);
  assert.equal(summary.fatal, undefined);
  assert.equal(
    Array.from(summary.failed, entry => `${entry.label}:${entry.optional}`).join(","),
    "loadSystemServerConfig:true"
  );
  assert.equal(
    summary.steps.some(entry => entry.label === "bootLiveControlsUi" && entry.status === "ok"),
    true
  );
});

test("bootstrap exposes a completed startup summary for support diagnostics", async () => {
  const harness = createBootstrapHarness();
  await waitFor(
    () => harness.context.window.__ravelinkBootSummary?.completedAt,
    "bootstrap did not expose a completed boot summary"
  );

  const summary = harness.context.window.__ravelinkBootSummary;
  assert.equal(summary.ok, true);
  assert.equal(summary.failed.length, 0);
  assert.equal(summary.skipped.length, 0);
  assert.equal(
    summary.steps.some(entry => entry.label === "hydrateAudioStartupDataUi" && entry.status === "ok"),
    true
  );
});

test("bootstrap owns mods retry scheduling when the initial mods boot load fails", async () => {
  let loadModsCalls = 0;
  const harness = createBootstrapHarness({
    loadMods: async () => {
      loadModsCalls += 1;
      return false;
    }
  });

  await waitFor(
    () => loadModsCalls === 1,
    "bootstrap did not finish initial mods retry scheduling"
  );

  const activeDelays = harness.timers.filter(timer => !timer.cleared).map(timer => timer.delay);
  assert.equal(loadModsCalls, 1);
  assert.deepEqual(
    activeDelays.filter(delay => delay === 900 || delay === 2200 || delay === 5000),
    [900, 2200, 5000]
  );
});

test("collapsible runtime binds panels deterministically without a startup fallback shim", () => {
  const harness = createCollapsibleHarness();
  harness.context.initCollapsiblePanels();

  assert.equal(harness.section.dataset.collapsibleBound, "1");
  assert.equal(typeof harness.context.runUiStartupFallbackPass, "undefined");
  const clickHandler = harness.getClickHandler();
  assert.equal(typeof clickHandler, "function");
  assert.equal(harness.button.textContent, "Collapse section");
  assert.equal(harness.button.attrs["aria-label"], "Collapse section");

  clickHandler();
  assert.equal(harness.section.classList.contains("collapsed"), true);
  assert.equal(harness.button.textContent, "Expand section");
  assert.equal(harness.button.attrs["aria-label"], "Expand section");
  assert.equal(
    harness.localStorage.getItem("ravelink_ui_collapsed_deviceRouting"),
    "1"
  );
});
