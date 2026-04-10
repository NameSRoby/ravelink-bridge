const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createClassList() {
  return {
    add() {},
    remove() {},
    toggle() { return false; },
    contains() { return false; }
  };
}

function createNode() {
  const children = [];
  return {
    dataset: {},
    style: {},
    value: "",
    checked: false,
    disabled: false,
    textContent: "",
    innerHTML: "",
    onclick: null,
    classList: createClassList(),
    appendChild(child) {
      children.push(child);
      if (child?.selected === true) {
        this.value = child.value;
      }
    },
    removeChild(child) {
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
    },
    contains() {
      return false;
    },
    setAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    focus() {},
    closest() {
      return null;
    },
    get options() {
      return children;
    },
    get children() {
      return children;
    }
  };
}

function createElementProxy() {
  const target = {};
  return new Proxy(target, {
    get(obj, prop) {
      if (!(prop in obj)) {
        obj[prop] = createNode();
      }
      return obj[prop];
    }
  });
}

function createStorageStub(seed = {}) {
  const map = new Map(Object.entries(seed || {}).map(([key, value]) => [String(key), String(value)]));
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

function createDocumentStub() {
  return {
    activeElement: null,
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    createElement(tagName) {
      const tag = String(tagName || "").trim().toLowerCase();
      if (tag === "option") {
        return { value: "", textContent: "", selected: false };
      }
      if (tag === "optgroup") {
        const node = createNode();
        node.label = "";
        return node;
      }
      return createNode();
    },
    addEventListener() {},
    removeEventListener() {}
  };
}

function loadScript(relativeFile, context = {}) {
  const filePath = path.resolve(__dirname, "..", relativeFile);
  const code = fs.readFileSync(filePath, "utf8");
  vm.createContext(context);
  vm.runInContext(code, context, { filename: filePath });
  return context;
}

test("audio orchestrator loads config through bounded runtimes and startup wiring", async () => {
  const records = {
    wired: [],
    appliedConfigs: [],
    telemetry: [],
    manualSyncs: 0
  };
  const ui = {
    audioRunningApps: [],
    audioAppIsoManualLocks: {},
    audioConfiguredDesktopOutputDeviceName: "",
    audioConfiguredPrimaryApp: ""
  };
  const el = createElementProxy();
  const documentRef = createDocumentStub();
  const windowRef = {
    alert() {},
    dispatchEvent() {},
    addEventListener() {}
  };
  const context = loadScript("public/assets/js/domains/audio.js", {
    console,
    Date,
    Math,
    URLSearchParams,
    encodeURIComponent,
    setTimeout() { return 1; },
    clearTimeout() {},
    window: windowRef,
    document: documentRef,
    localStorage: createStorageStub(),
    navigator: {},
    HTMLInputElement: function HTMLInputElement() {},
    parseLooseBoolean(value) {
      if (value === true || value === false) return value;
      const token = String(value || "").trim().toLowerCase();
      return token === "1" || token === "true" || token === "yes" || token === "on";
    },
    clampNumber(value, min, max, fallback = 0) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return Number(fallback);
      return Math.min(Number(max), Math.max(Number(min), parsed));
    },
    toFixedSafe(value, digits = 2, fallback = "0.00") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed.toFixed(digits) : fallback;
    },
    AUDIO_SIMPLE_MODE_KEY: "audio_simple_mode",
    AUDIO_APPS_SHOW_ALL_KEY: "audio_show_all",
    AUDIO_OPTIONAL_TOOLS_DISMISS_KEY: "audio_optional_tools_dismiss",
    AUDIO_TUNING_MODE_KEY: "audio_tuning_mode",
    audioQuickPresetButtons: [],
    el,
    ui,
    setBadge() {},
    syncUiLazy() {},
    audioEndpointsAdapter: {
      async getConfig() {
        return {
          ok: true,
          config: { sampleRate: 48000, ffmpegAppIsolationEnabled: true },
          telemetry: {
            running: true,
            backendSelection: { selectedBackend: "rustloop" },
            appIsolation: { captureToken: "spotify" },
            captureSession: { reason: "startup" }
          }
        };
      },
      async getAppIsolationLocks() {
        return {
          ok: true,
          locks: { spotify: { capture: "manual" } },
          telemetry: { ignored: true }
        };
      },
      async getProfiles() { return { ok: true, profiles: [] }; },
      async saveProfile() { return { ok: true }; },
      async applyProfile() { return { ok: true }; },
      async deleteProfile() { return { ok: true }; },
      async getOptionalToolsStatus() { return { ok: true, status: {} }; },
      async getApps() { return { ok: true, apps: [] }; },
      async getDevices() { return { ok: true, devices: [] }; },
      async setAppIsolationLock() { return { ok: true }; },
      async clearAppIsolationLock() { return { ok: true }; },
      async scanAppIsolation() { return { ok: false, data: null }; },
      async saveConfig() { return { ok: true }; },
      async restart() { return { ok: true }; },
      async getReactivityMap() { return { ok: true, map: {} }; },
      async saveReactivityMap() { return { ok: true }; }
    },
    createAudioUiInputAdapter() {
      return {
        normalizeAudioDeviceListUi: value => Array.isArray(value) ? value : [],
        formatAudioDeviceListUi: list => Array.isArray(list) ? list.join(",") : "",
        normalizeAudioAppNameUi: value => String(value || "").trim(),
        normalizeAudioOutputEndpointNameUi: value => String(value || "").trim(),
        normalizeAudioAppTokenUi: value => String(value || "").trim().toLowerCase(),
        normalizeAudioProfileNameUi: value => String(value || "").trim()
      };
    },
    createAudioConfigRuntimeUi() {
      return {
        detectLimiterPreset: () => "balanced",
        normalizeRustLoopbackFormatUi: value => String(value || "").trim().toLowerCase() || "f32le",
        syncRustLoopbackFormatHintUi() {},
        isAudioAppsShowAllUiEnabled: () => false,
        getAudioSelectableAppsUi: () => [],
        updateAudioAppsFilterHintUi() {},
        syncAudioRoutingComplexityUi() {},
        isAudioCaptureModeAppIsolationUiEnabled: () => true,
        syncAudioCaptureModeUi() {},
        setAudioAppSelectOptions() {},
        syncAudioToggleIndicatorsUi() {},
        formatAudioActiveConfigSummaryUi: () => "configured",
        computeAudioDeviceScanHintsUi: () => ({ hasLoopback: false, hasVirtualCable: false, hasUsbAudio: false }),
        updateAudioCaptureGuidanceUi() {},
        applyAudioConfigToInputs(config = {}) {
          records.appliedConfigs.push(config);
        },
        collectAudioConfigFromInputs: () => ({}),
        collectAudioAppIsolationPatchFromInputs: () => ({})
      };
    },
    createAudioAppIsolationAssistRuntimeUi() {
      return {
        normalizeAudioManualLockMapUi(value = {}) {
          return { normalized: true, ...value };
        },
        normalizeAudioProcessMetadataRowsUi: value => Array.isArray(value) ? value : [],
        normalizeAudioCompanionMapUi: value => value && typeof value === "object" ? value : {},
        getAudioSelectedPrimaryAppTokenUi: () => "spotify",
        syncAudioManualCaptureInputUi() {
          records.manualSyncs += 1;
        },
        resolveAudioTokenSimilarityUi: () => 1,
        collectAudioLineageCompanionTokensUi: () => [],
        getAudioCompanionTokensForSelectedAppUi: () => [],
        renderAudioCompanionAssistUi() {},
        renderAudioManualCaptureAssistUi() {},
        normalizeAudioExecutableDirUi: value => String(value || "").trim(),
        hasAudioCompanionTokenHintUi: () => false,
        buildAudioProcessGraphUi: () => ({}),
        hasAudioProcessTreeRelationshipUi: () => false,
        hasAudioExecutableDirRelationshipUi: () => false,
        collectAudioManualCaptureSuggestionsUi: () => [],
        renderAudioManualCaptureSuggestionsUi() {}
      };
    },
    createAudioTelemetryFormattersUi() {
      return {
        applyAudioAppIsolationTelemetry(value) {
          records.telemetry.push(value);
        },
        formatAudioAppIsoScanSummary: () => "scan-summary"
      };
    },
    createAudioTelemetryRuntimeUi({ applyAudioAppIsolationTelemetry }) {
      return {
        updateAudioTelemetry(value) {
          applyAudioAppIsolationTelemetry(value);
        }
      };
    },
    createAudioReactivityMapRuntimeUi() {
      return {
        normalizeAudioReactivitySourceKeyUi: value => String(value || ""),
        normalizeAudioReactivitySourcesUi: value => Array.isArray(value) ? value : [],
        normalizeMetaAutoTempoTrackersUi: value => value || {},
        normalizeAudioReactivityMapUi: value => value || {},
        updateAudioReactivityPolicyUi() {},
        maybeApplySmartLiveReactivityPolicy() {},
        maybeRetuneSmartMatchFromTelemetry() {},
        setAudioReactivityMapStatus() {},
        refreshAudioReactivityMapStatus() {},
        markAudioReactivityMapDirty() {},
        applyAudioReactivityMapToUi() {},
        collectAudioReactivityMapFromUi: () => ({}),
        loadAudioReactivityMap: async () => true,
        saveAudioReactivityMap: async () => true,
        bindAudioReactivityMapUi() {}
      };
    },
    createAudioQuickTuneMathUi() {
      return {
        AUDIO_QUICK_TUNE_BOUNDS: {},
        AUDIO_QUICK_TUNE_STAGES: {},
        clamp01Ui: value => Math.max(0, Math.min(1, Number(value) || 0)),
        linearToPctUi: value => Number(value) || 0,
        pctToLinearUi: value => Number(value) || 0,
        logToPctUi: value => Number(value) || 0,
        pctToLogUi: value => Number(value) || 0,
        mapLimiterThresholdToControlPct: value => Number(value) || 0,
        mapControlPctToLimiterThreshold: value => Number(value) || 0,
        getNearestAudioQuickTuneStage: () => ({ pct: 0.5, label: "A" }),
        getAudioQuickTuneProfileInterpolatedPcts: () => ({})
      };
    },
    createAudioProfilesUi() {
      return {
        setAudioProfileStatusUi() {},
        renderAudioProfilesUi() {},
        loadAudioProfiles: async () => true,
        wireAudioProfileControlsUi() {
          records.wired.push("profiles");
        }
      };
    },
    createAudioQuickTuneRuntimeUi() {
      return {
        detectAudioQuickProfile: () => "balanced",
        getAudioQuickTuneSliderMap: () => ({}),
        isAudioQuickSnapEnabled: () => true,
        normalizeAudioQuickTunePct: value => Number(value) || 0,
        setAudioQuickTuneStageText() {},
        syncAudioQuickProfileSliderFromPcts() {},
        syncAudioQuickTuningFromInputs() {},
        applyAudioQuickTuningSlidersToInputs() {},
        applyAudioQuickProfileMixSliderToSliders() {},
        resetAudioQuickTuningToDefaults() {},
        syncAudioQuickPresetButtons() {},
        syncLimiterPresetButtons() {},
        applyAudioQuickProfile() { return true; }
      };
    },
    createAudioAppIsolationActionsUi() {
      return {
        wireAudioAppIsolationActionsUi() {
          records.wired.push("appIsolation");
        }
      };
    },
    createAudioConfigActionsUi() {
      return {
        wireAudioConfigActionsUi() {
          records.wired.push("config");
        }
      };
    },
    createAudioRuntimeStartupUi() {
      return {
        runAudioUiWiringAudit: () => ({ ok: true }),
        scheduleAudioStartupHydrateDeferredRetryUi() {},
        hydrateAudioStartupDataUi: async () => true,
        initializeAudioDomainUiDeferred() {
          records.wired.push("startup");
        }
      };
    }
  });

  const loaded = await context.loadAudioConfig();
  assert.equal(loaded, true);
  assert.equal(records.appliedConfigs.length, 1);
  assert.equal(records.appliedConfigs[0].sampleRate, 48000);
  assert.equal(records.telemetry.length, 1);
  assert.equal(records.telemetry[0]?.running, true);
  assert.equal(records.manualSyncs, 1);
  assert.equal(ui.audioConfigLoaded, true);
  assert.equal(ui.audioAppIsoManualLocks.normalized, true);
  assert.deepEqual(records.wired, ["profiles", "appIsolation", "config"]);
});

test("palette orchestrator applies runtime snapshots through metadata and scoped runtimes", () => {
  const records = {
    metadata: [],
    configSnapshots: [],
    metricRouting: [],
    renders: [],
    events: []
  };
  const ui = {};
  const context = loadScript("public/assets/js/domains/palette.js", {
    console,
    Date,
    Math,
    JSON,
    window: {
      dispatchEvent(event) {
        records.events.push(event);
      }
    },
    document: createDocumentStub(),
    localStorage: createStorageStub(),
    CustomEvent: function CustomEvent(type, init) {
      this.type = type;
      this.detail = init?.detail || null;
    },
    ui,
    el: createElementProxy(),
    renderPaletteBrandMenus(payload = {}) {
      records.renders.push(payload);
    },
    createPaletteUiInputAdapter() {
      return {
        normalizePaletteDisorderAggressionUi: (value, fallback = 0.35) => Number(value) || fallback,
        normalizePaletteCycleModeUi: (value, fallback = "on_trigger") => String(value || fallback),
        normalizePaletteTimedIntervalSecUi: (value, fallback = 5) => Number(value) || fallback,
        normalizePaletteBeatLockGraceSecUi: (value, fallback = 2) => Number(value) || fallback,
        normalizePaletteReactiveMarginUi: (value, fallback = 28) => Number(value) || fallback,
        normalizePaletteBrightnessFollowAmountUi: (value, fallback = 1) => Number(value) || fallback,
        normalizePaletteVividnessUi: (value, fallback = 2) => Number(value) || fallback,
        normalizePaletteSpectrumMapModeUi: (value, fallback = "auto") => String(value || fallback),
        normalizePaletteAudioFeatureUi: (value, fallback = "rms") => String(value || fallback),
        normalizePaletteSpectrumFeatureMapUi: value => Array.isArray(value) ? value : ["lows", "mids", "highs"]
      };
    },
    createPaletteConfigNormalizationRuntimeUi() {
      return {
        normalizePaletteConfigUi: source => source || {},
        normalizePaletteBrandOverridesUi: value => value || {},
        normalizePaletteFixtureOverridesUi: value => value || {}
      };
    },
    createPaletteFixtureMetricContractRuntimeUi() {
      return {
        normalizeFixtureMetricModeUi: value => String(value || "manual"),
        normalizeFixtureMetricKeyUi: value => String(value || "baseline"),
        normalizeFixtureMetricHarmonySizeUi: value => Number(value) || 1,
        normalizeFixtureMetricMaxHzUi: value => value,
        formatFixtureMetricMaxHzUi: value => String(value ?? "UNCLAMPED"),
        normalizeFixtureMetricConfigUi: value => value || {},
        normalizeFixtureMetricBrandOverridesUi: value => value || {},
        normalizeFixtureMetricFixtureOverridesUi: value => value || {}
      };
    },
    createPaletteScopeConfigRuntimeUi() {
      return {
        applyFixtureMetricRoutingSnapshotToUi(snapshot = {}) {
          records.metricRouting.push(snapshot);
        },
        getFixtureMetricBrandConfigUi: () => ({}),
        getFixtureMetricScopedConfigUi: () => ({}),
        applyPaletteSnapshotToUi(config = {}, options = {}) {
          records.configSnapshots.push({ config, options });
        },
        getPaletteGlobalConfigUi: () => ({}),
        getPaletteBrandConfigUi: () => ({}),
        getPaletteScopedConfigUi: () => ({}),
        getPaletteBrandFixturesUi: () => []
      };
    },
    createPaletteRuntimeMetadataRuntimeUi() {
      return {
        resolvePaletteRuntimeMetadataPayloadUi: snapshot => snapshot,
        applyPaletteRuntimeMetadataUi(snapshot = {}) {
          records.metadata.push(snapshot);
        }
      };
    },
    createPaletteRuntimeSnapshotRuntimeUi({
      windowRef,
      CustomEventRef,
      applyPaletteRuntimeMetadataUi,
      applyPaletteSnapshotToUi,
      applyFixtureMetricRoutingSnapshotToUi,
      renderPaletteBrandMenus
    }) {
      return {
        applyPaletteRuntimeSnapshotToUi(snapshot = {}, options = {}) {
          applyPaletteRuntimeMetadataUi(snapshot);
          applyPaletteSnapshotToUi(snapshot.config || {}, {
            fixtureOverrides: snapshot.fixtureOverrides || {},
            brandFixtures: snapshot.brandFixtures || {},
            forceRender: options.forceRender === true
          });
          applyFixtureMetricRoutingSnapshotToUi(snapshot.metricRouting || {});
          renderPaletteBrandMenus({
            reason: "palette_runtime_snapshot",
            force: options.forceRender === true
          });
          if (windowRef && typeof windowRef.dispatchEvent === "function" && typeof CustomEventRef === "function") {
            windowRef.dispatchEvent(new CustomEventRef("ravelink:live-scope-targets-updated", {
              detail: { catalog: Array.isArray(snapshot.catalog) ? snapshot.catalog.slice() : [] }
            }));
          }
          ui.paletteCatalog = Array.isArray(snapshot.catalog) ? snapshot.catalog.slice() : [];
        }
      };
    }
  });
  const applyPaletteRuntimeSnapshotToUi = vm.runInContext("applyPaletteRuntimeSnapshotToUi", context);

  applyPaletteRuntimeSnapshotToUi({
    catalog: [{ id: "fixture-1", brand: "hue" }],
    config: { cycleMode: "timed", timedIntervalSec: 9 },
    fixtureOverrides: { "fixture-1": { vividness: 3 } },
    brandFixtures: { hue: [{ id: "fixture-1" }] },
    metricRouting: { mode: "flux" }
  }, {
    forceRender: true
  });

  assert.equal(records.metadata.length, 1);
  assert.equal(records.configSnapshots.length, 1);
  assert.equal(records.configSnapshots[0].config.cycleMode, "timed");
  assert.equal(records.configSnapshots[0].options.fixtureOverrides["fixture-1"].vividness, 3);
  assert.equal(records.metricRouting.length, 1);
  assert.equal(records.metricRouting[0].mode, "flux");
  assert.equal(Array.isArray(ui.paletteCatalog), true);
  assert.equal(ui.paletteCatalog[0].id, "fixture-1");
  assert.equal(records.renders.length, 1);
  assert.equal(records.renders[0].reason, "palette_runtime_snapshot");
  assert.equal(records.renders[0].force, true);
  assert.equal(records.events.length, 1);
  assert.equal(records.events[0].type, "ravelink:live-scope-targets-updated");
});
