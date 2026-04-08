const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createClassList(initial = []) {
  const set = new Set(initial);
  return {
    add(...tokens) {
      for (const token of tokens) set.add(String(token || "").trim());
    },
    remove(...tokens) {
      for (const token of tokens) set.delete(String(token || "").trim());
    },
    toggle(token, force) {
      const key = String(token || "").trim();
      if (!key) return false;
      if (force === true) {
        set.add(key);
        return true;
      }
      if (force === false) {
        set.delete(key);
        return false;
      }
      if (set.has(key)) {
        set.delete(key);
        return false;
      }
      set.add(key);
      return true;
    },
    contains(token) {
      return set.has(String(token || "").trim());
    }
  };
}

function loadFactory(relativeFile, factoryName) {
  const filePath = path.resolve(__dirname, "..", relativeFile);
  const code = fs.readFileSync(filePath, "utf8");
  const context = {
    console,
    setTimeout,
    clearTimeout,
    window: {}
  };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: filePath });
  const factory = context[factoryName];
  assert.equal(typeof factory, "function", `missing runtime factory: ${factoryName}`);
  return factory;
}

function loadAudioConfigRuntimeFactory() {
  const context = {
    console,
    setTimeout,
    clearTimeout,
    window: {}
  };
  vm.createContext(context);
  for (const relativeFile of [
    "public/assets/js/domains/audio/audio-config-app-selection-runtime-ui.js",
    "public/assets/js/domains/audio/audio-config-runtime-ui.js"
  ]) {
    const filePath = path.resolve(__dirname, "..", relativeFile);
    vm.runInContext(fs.readFileSync(filePath, "utf8"), context, { filename: filePath });
  }
  assert.equal(typeof context.createAudioConfigRuntimeUi, "function", "missing runtime factory: createAudioConfigRuntimeUi");
  return context.createAudioConfigRuntimeUi;
}

function createStorageStub(seed = {}) {
  const map = new Map(Object.entries(seed || {}).map(([k, v]) => [String(k), String(v)]));
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

function createElementStub(tagName) {
  if (String(tagName || "").toLowerCase() === "option") {
    return { value: "", textContent: "", selected: false };
  }
  if (String(tagName || "").toLowerCase() === "optgroup") {
    return {
      label: "",
      children: [],
      appendChild(child) {
        this.children.push(child);
      }
    };
  }
  return {
    classList: createClassList(),
    children: [],
    appendChild(child) {
      this.children.push(child);
    }
  };
}

function createSelectStub(initialOptions = []) {
  const options = Array.isArray(initialOptions) ? initialOptions.slice() : [];
  return {
    value: "",
    innerHTML: "",
    appendChild(option) {
      options.push(option);
      if (option?.selected === true) {
        this.value = option.value;
      }
    },
    get options() {
      return options;
    }
  };
}

function createAudioDocumentStub({ queryMap = {}, labelMap = {} } = {}) {
  return {
    createElement(tagName) {
      return createElementStub(tagName);
    },
    querySelectorAll(selector) {
      return Array.isArray(queryMap[selector]) ? queryMap[selector] : [];
    },
    querySelector(selector) {
      return labelMap[selector] || null;
    }
  };
}

test("audio quick-tune runtime keeps profile and preset state deterministic", () => {
  const createAudioQuickTuneRuntimeUi = loadFactory(
    "public/assets/js/domains/audio/audio-quick-tune-runtime-ui.js",
    "createAudioQuickTuneRuntimeUi"
  );

  const quickSafeBtn = { dataset: { audioQuick: "safe" }, classList: createClassList() };
  const quickFastBtn = { dataset: { audioQuick: "fast" }, classList: createClassList() };
  const limiterTransparentBtn = { dataset: { limiterPreset: "transparent" }, classList: createClassList() };
  const limiterHardBtn = { dataset: { limiterPreset: "hard" }, classList: createClassList() };

  const el = {
    aSampleRate: { value: "48000" },
    aFrames: { value: "256" },
    aQuickSnapStages: { checked: true },
    aQuickProfileMix: { value: "50" },
    aQuickProfileMixVal: { textContent: "" },
    aQuickProfileStage: { textContent: "" },
    aQuickGain: { value: "30" },
    aQuickNoiseGate: { value: "20" },
    aQuickAutoTarget: { value: "40" },
    aQuickAutoGate: { value: "10" },
    aQuickLimiter: { value: "30" },
    aQuickGainStage: { textContent: "" },
    aQuickNoiseGateStage: { textContent: "" },
    aQuickAutoTargetStage: { textContent: "" },
    aQuickAutoGateStage: { textContent: "" },
    aQuickLimiterStage: { textContent: "" }
  };
  const ui = { limiterPreset: "hard" };
  const documentRef = {
    querySelectorAll(selector) {
      if (selector === "[data-limiter-preset]") return [limiterTransparentBtn, limiterHardBtn];
      return [];
    }
  };

  const runtime = createAudioQuickTuneRuntimeUi({
    el,
    ui,
    documentRef,
    AUDIO_QUICK_PROFILES: {
      safe: { sampleRate: 48000, framesPerBuffer: 512 },
      fast: { sampleRate: 48000, framesPerBuffer: 128 }
    },
    AUDIO_CONFIG_DEFAULTS: {
      outputGain: 1,
      noiseFloorMin: 0.00045,
      autoLevelTargetRms: 0.028,
      autoLevelGate: 0.007,
      limiterThreshold: 0.82
    },
    audioQuickPresetButtons: [quickSafeBtn, quickFastBtn],
    getNearestAudioQuickTuneStage: () => ({ pct: 35, label: "A" })
  });

  assert.equal(runtime.applyAudioQuickProfile("safe"), true);
  assert.equal(el.aSampleRate.value, "48000");
  assert.equal(el.aFrames.value, "512");
  assert.equal(quickSafeBtn.classList.contains("active"), true);
  assert.equal(quickFastBtn.classList.contains("active"), false);

  const snapped = runtime.normalizeAudioQuickTunePct("gain", 0.32);
  const noSnap = runtime.normalizeAudioQuickTunePct("gain", 0.32, { allowSnap: false });
  el.aQuickSnapStages.checked = false;
  const disabledSnap = runtime.normalizeAudioQuickTunePct("gain", 0.32);
  assert.equal(snapped, 0.35);
  assert.equal(noSnap, 0.32);
  assert.equal(disabledSnap, 0.32);

  runtime.syncLimiterPresetButtons();
  assert.equal(limiterHardBtn.classList.contains("active"), true);
  assert.equal(limiterTransparentBtn.classList.contains("active"), false);
});

test("audio runtime startup toggles easy/advanced tuning mode and persists preference", () => {
  const createAudioRuntimeStartupUi = loadFactory(
    "public/assets/js/domains/audio/audio-runtime-startup-ui.js",
    "createAudioRuntimeStartupUi"
  );

  const easyPaneClassList = createClassList();
  const advancedPaneClassList = createClassList(["hidden"]);
  const easyBtnClassList = createClassList(["active"]);
  const advancedBtnClassList = createClassList();
  const storage = createStorageStub({ ravelink_audio_tuning_mode_v1: "advanced" });
  const ui = {
    audioProfiles: [],
    audioAppsLoaded: true,
    audioRunningApps: [{ displayName: "Spotify" }],
    audioDevicesLoaded: true,
    audioLastDeviceScanCount: 1,
    audioDefaultOutputEndpointName: "Speakers",
    audioConfiguredPrimaryApp: "",
    audioTuningMode: ""
  };

  const el = {
    health: {},
    aTuningEasyPane: { classList: easyPaneClassList },
    aTuningAdvancedPane: { classList: advancedPaneClassList },
    aTuningModeHint: { textContent: "" },
    aTuningModeEasyBtn: {
      classList: easyBtnClassList,
      onclick: null,
      setAttribute() {}
    },
    aTuningModeAdvancedBtn: {
      classList: advancedBtnClassList,
      onclick: null,
      setAttribute() {}
    },
    aAppIsolationEnabled: { checked: false },
    aAppPrimary: { options: [{ value: "" }, { value: "Spotify" }], value: "" },
    aAppFallback: { options: [{ value: "" }], value: "" },
    aDevices: { options: [{ value: "" }, { value: "desktop" }] }
  };

  const runtime = createAudioRuntimeStartupUi({
    el,
    ui,
    documentRef: { querySelectorAll: () => [] },
    localStorageRef: storage,
    setBadge: () => {},
    announceAudioActionStatus: () => {},
    setAudioProfileStatusUi: () => {},
    loadAudioProfiles: async () => true,
    bindAudioReactivityMapUi: () => {},
    syncAudioCaptureModeUi: () => {},
    syncAudioRoutingComplexityUi: () => {},
    updateAudioAppsFilterHintUi: () => {},
    renderAudioOptionalToolsBanner: () => {},
    setAudioAppSelectOptions: () => {},
    loadAudioConfig: async () => true,
    loadAudioApps: async () => true,
    loadAudioDevices: async () => true,
    normalizeAudioAppNameUi: value => String(value || "").trim(),
    AUDIO_UI_WIRING_BUTTON_IDS: ["aTuningModeEasyBtn", "aTuningModeAdvancedBtn"],
    AUDIO_UI_WIRING_OPTIONAL_BUTTON_IDS: new Set(),
    AUDIO_UI_WIRING_CRITICAL_IDS: []
  });

  runtime.initializeAudioDomainUiDeferred();

  assert.equal(ui.audioTuningMode, "advanced");
  assert.equal(easyPaneClassList.contains("hidden"), true);
  assert.equal(advancedPaneClassList.contains("hidden"), false);
  assert.equal(typeof el.aTuningModeEasyBtn.onclick, "function");
  assert.equal(typeof el.aTuningModeAdvancedBtn.onclick, "function");

  el.aTuningModeEasyBtn.onclick();
  assert.equal(ui.audioTuningMode, "easy");
  assert.equal(storage.getItem("ravelink_audio_tuning_mode_v1"), "easy");
  assert.equal(easyPaneClassList.contains("hidden"), false);
  assert.equal(advancedPaneClassList.contains("hidden"), true);
});

test("audio config apply requests a capture restart", async () => {
  const createAudioConfigActionsUi = loadFactory(
    "public/assets/js/domains/audio/audio-config-actions-ui.js",
    "createAudioConfigActionsUi"
  );
  const patches = [];
  const el = {
    health: {},
    aApplyBtn: { onclick: null }
  };

  const runtime = createAudioConfigActionsUi({
    el,
    ui: {},
    documentRef: { querySelectorAll: () => [] },
    collectAudioConfigFromInputs: () => ({ inputBackend: "rustloop" }),
    saveAudioConfig: async patch => {
      patches.push(patch);
      return {
        ok: true,
        data: {
          config: { inputBackend: "rustloop" },
          changed: ["inputBackend"],
          restarted: true
        }
      };
    },
    runAudioButtonActionWithResult: async (_button, _label, action) => action(),
    applyAudioConfigToInputs() {},
    loadAudioApps: async () => true,
    clearAudioApplyAttention() {},
    setBadge() {},
    announceAudioActionStatus() {}
  });

  runtime.wireAudioConfigActionsUi();
  assert.equal(typeof el.aApplyBtn.onclick, "function");
  await el.aApplyBtn.onclick();

  assert.equal(patches.length, 1);
  assert.equal(patches[0].inputBackend, "rustloop");
  assert.equal(patches[0].restart, true);
  assert.equal(patches[0].reason, "ui_audio_config_apply");
});

test("audio config runtime curates selectable apps and preserves configured targets", () => {
  const createAudioConfigRuntimeUi = loadAudioConfigRuntimeFactory();

  const selectNode = createSelectStub();
  const el = {
    aAppsShowAll: { checked: false },
    aAppPrimary: { value: "" },
    aAppFallback: { value: "" },
    aAppsFilterHint: { textContent: "" }
  };
  const ui = {
    audioRunningApps: [
      { displayName: "OBS Studio", audioCapable: true, likelyAudioConfidence: 0.41, instances: 2 },
      { displayName: "Firefox", likelyAudio: true, likelyAudioConfidence: 0.92, browserChannelHint: "nightly" },
      { displayName: "Updater", likelyAudio: false, likelyAudioConfidence: 0.02 }
    ],
    audioConfiguredPrimaryApp: "Updater",
    audioConfiguredFallbackApp: "",
    audioAppHintMeta: { source: "proctap_audio_processes", audioOnly: false }
  };

  const runtime = createAudioConfigRuntimeUi({
    el,
    ui,
    documentRef: createAudioDocumentStub()
  });

  runtime.setAudioAppSelectOptions(selectNode, "Updater");
  runtime.updateAudioAppsFilterHintUi();

  const rendered = Array.from(selectNode.options || []).map(option => `${option.value}|${option.textContent}`);
  assert.deepEqual(rendered, [
    "|NONE",
    "OBS Studio|OBS Studio (2) [41%]",
    "Firefox|Firefox [nightly] [92%]",
    "Updater|Updater [2%]"
  ]);
  assert.equal(el.aAppsFilterHint.textContent, "APP LIST MODE: audio-capable (3/3) via audio-probe");
});

test("audio telemetry runtime projects canonical telemetry into status fields", () => {
  const createAudioTelemetryRuntimeUi = loadFactory(
    "public/assets/js/domains/audio/audio-telemetry-runtime-ui.js",
    "createAudioTelemetryRuntimeUi"
  );

  const el = {
    aLevel: { textContent: "" },
    aRaw: { textContent: "" },
    aPeak: { textContent: "" },
    aTransient: { textContent: "" },
    aZcr: { textContent: "" },
    aBandLow: { textContent: "" },
    aBandMid: { textContent: "" },
    aBandHigh: { textContent: "" },
    aFlux: { textContent: "" },
    aAutoGain: { textContent: "" },
    aEffectiveGain: { textContent: "" },
    aDevice: { textContent: "" },
    aRunning: { textContent: "" },
    aRestart: { textContent: "" },
    aError: { textContent: "" }
  };
  const guidanceCalls = [];
  const appIsoCalls = [];
  const runtime = createAudioTelemetryRuntimeUi({
    el,
    clampNumber(value, min, max, fallback) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.max(min, Math.min(max, parsed));
    },
    toFixedSafe(value, digits, fallback) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed.toFixed(digits) : fallback;
    },
    updateAudioCaptureGuidanceUi() {
      guidanceCalls.push(true);
    },
    applyAudioAppIsolationTelemetry(value) {
      appIsoCalls.push(value);
    }
  });

  const telemetry = {
    audioRms: 0.345,
    audioSourceLevel: 0.456,
    peak: 0.9,
    transient: 0.33,
    bpm: 128.4,
    bandLow: 0.1,
    bandMid: 0.2,
    bandHigh: 0.3,
    spectralFlux: 0.44,
    beatConfidence: 0.87,
    autoLevelGain: 1.11,
    effectiveOutputGain: 0.98,
    backendSelection: { selectedBackend: "rustloop" },
    appIsolation: { captureToken: "firefox-nightly" },
    captureRuntime: { state: "capturing" },
    captureSession: { reason: "manual_restart" },
    lastError: ""
  };

  runtime.updateAudioTelemetry(telemetry);

  assert.equal(el.aLevel.textContent, "0.34");
  assert.equal(el.aRaw.textContent, "0.46");
  assert.equal(el.aPeak.textContent, "0.90");
  assert.equal(el.aZcr.textContent, "128");
  assert.equal(el.aFlux.textContent, "0.44");
  assert.equal(el.aAutoGain.textContent, "87%");
  assert.equal(el.aEffectiveGain.textContent, "1.11 / 0.98");
  assert.equal(el.aDevice.textContent, "rustloop | firefox-nightly");
  assert.equal(el.aRunning.textContent, "IDLE (capturing)");
  assert.equal(el.aRestart.textContent, "manual_restart");
  assert.equal(el.aError.textContent, "-");
  assert.equal(guidanceCalls.length, 1);
  assert.equal(appIsoCalls[0], telemetry);
});

test("audio config runtime applies and collects capture config deterministically", () => {
  const createAudioConfigRuntimeUi = loadAudioConfigRuntimeFactory();

  const labelBySelector = {
    'label[for="aCaptureModeDesktop"]': { classList: createClassList() },
    'label[for="aCaptureModeAppIso"]': { classList: createClassList() },
    'label[for="aPreferLegacyCapture"]': { classList: createClassList() },
    'label[for="aUseRustAudioKernel"]': { classList: createClassList() },
    'label[for="aUseRustSourceResolver"]': { classList: createClassList() },
    'label[for="aAppIsolationMultiSource"]': { classList: createClassList() },
    'label[for="aAppIsolationStrict"]': { classList: createClassList() },
    'label[for="aAutoLevelEnabled"]': { classList: createClassList() },
    'label[for="aQuickSnapStages"]': { classList: createClassList() }
  };
  const isoOnlyNode = { classList: createClassList(["hidden"]) };
  const documentRef = createAudioDocumentStub({
    queryMap: {
      ".audioIsoOnly": [isoOnlyNode],
      ".audioIsoAdvanced": []
    },
    labelMap: labelBySelector
  });

  const appPrimary = createSelectStub();
  const appFallback = createSelectStub();
  const appIsolationCheckMs = createSelectStub([{ value: "300000", textContent: "5 MIN" }]);
  appIsolationCheckMs.value = "300000";

  const el = {
    aInputBackend: { value: "" },
    aPreferLegacyCapture: { id: "aPreferLegacyCapture", checked: false },
    aUseRustAudioKernel: { id: "aUseRustAudioKernel", checked: false },
    aUseRustSourceResolver: { id: "aUseRustSourceResolver", checked: false },
    aRustLoopbackFormat: { value: "" },
    aRustLoopbackFormatHint: { textContent: "" },
    aDeviceMatch: { value: "" },
    aDeviceId: { value: "" },
    aDevices: { value: "" },
    aFfmpegPath: { value: "" },
    aFfmpegFormat: { value: "" },
    aFfmpegDevice: { value: "" },
    aFfmpegSources: { value: "" },
    aAppIsolationEnabled: { checked: false },
    aCaptureModeDesktop: { id: "aCaptureModeDesktop", checked: false },
    aCaptureModeAppIso: { id: "aCaptureModeAppIso", checked: false },
    aCaptureModeHint: { textContent: "" },
    aIsoSimpleMode: { id: "aIsoSimpleMode", checked: true, closest: () => null },
    aAppIsolationMultiSource: { id: "aAppIsolationMultiSource", checked: false },
    aAppIsolationStrict: { id: "aAppIsolationStrict", checked: false },
    aAppIsolationCheckMs: appIsolationCheckMs,
    aAppPrimary: appPrimary,
    aAppFallback: appFallback,
    aAppPrimarySources: { value: "" },
    aAppFallbackSources: { value: "" },
    aSampleRate: { value: "" },
    aFrames: { value: "" },
    aChannels: { value: "" },
    aGain: { value: "" },
    aAutoLevelEnabled: { id: "aAutoLevelEnabled", checked: false },
    aAutoLevelTarget: { value: "" },
    aAutoLevelMinGain: { value: "" },
    aAutoLevelMaxGain: { value: "" },
    aAutoLevelGate: { value: "" },
    aNoise: { value: "" },
    aPeakDecay: { value: "" },
    aBandLowHz: { value: "" },
    aBandMidHz: { value: "" },
    aLimiterThreshold: { value: "" },
    aLimiterKnee: { value: "" },
    aRestartMs: { value: "" },
    aLogTicks: { value: "" },
    aCaptureGuidanceHint: { textContent: "" },
    aAppsShowAll: { id: "aAppsShowAll", checked: false },
    aQuickSnapStages: { id: "aQuickSnapStages", checked: true }
  };
  const ui = {
    audioRunningApps: [
      { displayName: "Firefox", likelyAudio: true, likelyAudioConfidence: 0.85, browserChannelHint: "nightly" }
    ],
    audioConfiguredPrimaryApp: "",
    audioConfiguredFallbackApp: "",
    audioHasLoopbackDevice: true,
    audioHasVirtualCableDevice: false,
    audioDetectedUsbAudio: false,
    audioLastDeviceScanCount: 3,
    audioDefaultOutputEndpointName: "Studio Speakers"
  };
  const clearedAttention = [];

  const runtime = createAudioConfigRuntimeUi({
    el,
    ui,
    documentRef,
    normalizeAudioDeviceListUi(value, fallback = []) {
      if (Array.isArray(value)) return value.map(item => String(item || "").trim()).filter(Boolean);
      const parts = String(value || "").split(/[,\n]+/g).map(item => item.trim()).filter(Boolean);
      return parts.length ? parts : fallback.slice();
    },
    formatAudioDeviceListUi(list = []) {
      return Array.isArray(list) ? list.join(", ") : String(list || "");
    },
    normalizeAudioAppTokenUi(value) {
      return String(value || "").trim().toLowerCase().replace(/\.exe$/i, "");
    },
    detectAudioQuickProfile() {
      return "fast";
    },
    syncAudioQuickPresetButtons() {},
    syncLimiterPresetButtons() {},
    syncAudioQuickTuningFromInputs() {},
    clearAudioApplyAttention(kind) {
      clearedAttention.push(kind);
    }
  });

  runtime.applyAudioConfigToInputs({
    inputBackend: "rustloop",
    autoPreferLegacyCapture: true,
    rustAudioKernelEnabled: true,
    rustSourceResolverEnabled: true,
    rustLoopbackFormat: "s16",
    deviceMatch: "speakers",
    deviceId: null,
    desktopOutputDeviceName: "Studio Speakers",
    ffmpegPath: "ffmpeg.exe",
    ffmpegInputFormat: "wasapi",
    ffmpegInputDevices: ["Line 1", "Line 2"],
    ffmpegAppIsolationEnabled: true,
    ffmpegAppIsolationStrict: true,
    ffmpegAppIsolationPrimaryApp: "Firefox",
    ffmpegAppIsolationFallbackApp: "",
    ffmpegAppIsolationPrimaryDevices: ["Line 1"],
    ffmpegAppIsolationFallbackDevices: [],
    ffmpegAppIsolationMultiSource: true,
    ffmpegAppIsolationCheckMs: 300000,
    sampleRate: 48000,
    framesPerBuffer: 256,
    channels: 2,
    outputGain: 1.25,
    autoLevelEnabled: true,
    autoLevelTargetRms: 0.03,
    autoLevelMinGain: 0.45,
    autoLevelMaxGain: 1.55,
    autoLevelGate: 0.008,
    noiseFloorMin: 0.0005,
    peakDecay: 0.91,
    bandLowHz: 190,
    bandMidHz: 2100,
    limiterThreshold: 0.82,
    limiterKnee: 0.16,
    restartMs: 1750,
    logEveryTicks: 45
  });

  assert.equal(el.aRustLoopbackFormat.value, "s16le");
  assert.match(el.aRustLoopbackFormatHint.textContent, /lowest bandwidth\/CPU path/i);
  assert.equal(el.aCaptureModeAppIso.checked, true);
  assert.equal(el.aCaptureModeDesktop.checked, false);
  assert.match(el.aCaptureGuidanceHint.textContent, /Rust loopback backend selected/i);
  assert.match(el.aCaptureGuidanceHint.textContent, /APP ISOLATION is ON/i);
  assert.equal(ui.audioConfiguredPrimaryApp, "Firefox");
  assert.deepEqual(clearedAttention, ["config", "iso", "manual"]);

  el.aDevices.value = `desktop:${encodeURIComponent("Studio Speakers")}`;
  const collected = runtime.collectAudioConfigFromInputs();
  assert.equal(collected.desktopOutputDeviceName, "Studio Speakers");
  assert.equal(collected.rustLoopbackFormat, "s16le");
  assert.equal(collected.ffmpegInputDevice, "Line 1");
  assert.deepEqual(Array.from(collected.ffmpegInputDevices || []), ["Line 1", "Line 2"]);
  assert.equal(collected.ffmpegAppIsolationEnabled, true);

  const isoPatch = runtime.collectAudioAppIsolationPatchFromInputs();
  assert.deepEqual(Object.keys(isoPatch).sort(), [
    "autoPreferLegacyCapture",
    "ffmpegAppIsolationCheckMs",
    "ffmpegAppIsolationEnabled",
    "ffmpegAppIsolationFallbackApp",
    "ffmpegAppIsolationFallbackDevices",
    "ffmpegAppIsolationMultiSource",
    "ffmpegAppIsolationPrimaryApp",
    "ffmpegAppIsolationPrimaryDevices",
    "ffmpegAppIsolationStrict",
    "ffmpegInputDevice",
    "ffmpegInputDevices",
    "ffmpegInputFormat",
    "inputBackend",
    "rustAudioKernelEnabled",
    "rustLoopbackFormat",
    "rustSourceResolverEnabled"
  ]);
});

test("audio reactivity runtime normalizes, loads, and collects map state", async () => {
  const createAudioReactivityMapRuntimeUi = loadFactory(
    "public/assets/js/domains/audio/audio-reactivity-map-runtime-ui.js",
    "createAudioReactivityMapRuntimeUi"
  );

  const el = {
    reactHardwareRateLimitsEnabled: { checked: true },
    reactGainMode: { value: "auto" },
    reactGainManual: { value: "100", disabled: false },
    reactGainManualVal: { textContent: "" },
    reactMapStatus: { value: "" },
    reactGainSaveBtn: null
  };
  const ui = {
    audioReactivityMap: null,
    metaAutoTempoTrackersAuto: false,
    metaAutoTempoTrackers: null
  };
  const AUDIO_REACTIVITY_TARGET_KEYS = ["hue", "wiz", "other"];
  const AUDIO_REACTIVITY_SOURCE_ORDER = ["smart", "bass", "flux"];
  const AUDIO_REACTIVITY_MAP_DEFAULT = {
    reactivityGainMode: "auto",
    reactivityGain: 1,
    hardwareRateLimitsEnabled: true,
    metaAutoTempoTrackersAuto: false,
    metaAutoTempoTrackers: { baseline: true, peaks: true, transients: true, flux: true },
    targets: {
      hue: { enabled: true, amount: 1, sources: ["smart", "bass", "flux"] },
      wiz: { enabled: true, amount: 1, sources: ["smart", "bass", "flux"] },
      other: { enabled: true, amount: 1, sources: ["smart", "bass", "flux"] }
    }
  };

  const runtime = createAudioReactivityMapRuntimeUi({
    el,
    ui,
    AUDIO_REACTIVITY_SOURCE_CATALOG_DEFAULT: {
      smart: { label: "SMART" },
      bass: { label: "BASS" },
      flux: { label: "FLUX" }
    },
    AUDIO_REACTIVITY_TARGET_KEYS,
    META_AUTO_TEMPO_TRACKER_KEYS: ["baseline", "peaks", "transients", "flux"],
    AUDIO_REACTIVITY_MAP_DEFAULT,
    AUDIO_REACTIVITY_SOURCE_ORDER,
    audioEndpointsAdapter: {
      async getReactivityMap() {
        return {
          ok: true,
          config: {
            sourceCatalog: { pulse: { label: "PULSE" } },
            reactivityGainMode: "manual",
            reactivityGain: 1.4,
            hardwareRateLimitsEnabled: true,
            metaAutoTempoTrackers: { baseline: true, peaks: false, transients: true, flux: true },
            targets: {
              hue: { enabled: true, amount: 1.2, sources: ["bass", "pulse"] },
              wiz: { enabled: true, amount: 1, sources: ["smart"] },
              other: { enabled: false, amount: 0.6, sources: ["flux"] }
            }
          }
        };
      },
      async saveReactivityMap(payload) {
        return { ok: true, data: { config: payload } };
      }
    }
  });

  const normalized = runtime.normalizeAudioReactivityMapUi({
    reactivityGainMode: "MANUAL",
    reactivityGain: 8,
    targets: {
      hue: { enabled: false, amount: -5, sources: ["bass", "unknown"] }
    },
    metaAutoTempoTrackers: { baseline: false, peaks: false, transients: false, flux: false }
  });
  assert.equal(normalized.reactivityGainMode, "manual");
  assert.equal(normalized.reactivityGain, 3);
  assert.equal(normalized.targets.hue.amount, 0);
  assert.equal(Array.from(normalized.targets.hue.sources || []).join(","), "bass");
  assert.equal(normalized.metaAutoTempoTrackers.baseline, true);

  const loaded = await runtime.loadAudioReactivityMap();
  assert.equal(loaded, true);
  assert.equal(ui.audioReactivityMapLoaded, true);
  assert.equal(el.reactGainMode.value, "manual");
  assert.equal(el.reactGainManual.value, "140");

  el.reactGainMode.value = "manual";
  el.reactGainManual.value = "250";
  el.reactHardwareRateLimitsEnabled.checked = false;
  ui.metaAutoTempoTrackersAuto = true;
  ui.metaAutoTempoTrackers = { baseline: true, peaks: false, transients: true, flux: false };
  const collected = runtime.collectAudioReactivityMapFromUi();
  assert.equal(collected.reactivityGainMode, "manual");
  assert.equal(collected.reactivityGain, 2.5);
  assert.equal(collected.hardwareRateLimitsEnabled, false);
  assert.equal(collected.metaAutoTempoTrackersAuto, true);

  const saved = await runtime.saveAudioReactivityMap();
  assert.equal(saved.ok, true);
  assert.equal(ui.audioReactivityMapLoaded, true);
});
