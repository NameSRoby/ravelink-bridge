// [TITLE] Module: public/assets/js/domains/telemetry.js
// [TITLE] Purpose: telemetry orchestrator that composes bounded telemetry runtime modules
// [TITLE] Functionality Index:
// [TITLE] - telemetry helper normalization (scene/hz/poll tick)
// [TITLE] - telemetry runtime module composition (audit + monitor + poll)
// [TITLE] - cross-domain LIVE sync fan-out (`sync`)
// [DEV] Complex Flow:
// [DEV] This file intentionally stays orchestration-focused. Polling, monitor drawing,
// [DEV] and live-control audit mechanics live in `telemetry/*` runtime modules while
// [DEV] this layer preserves globally referenced helper names used by bootstrap/actions.

const mainScopeCtx = el?.canvas && typeof el.canvas.getContext === "function"
  ? el.canvas.getContext("2d")
  : document.createElement("canvas").getContext("2d");
const telemetryScopeCtx = el?.telemetryCanvas && typeof el.telemetryCanvas.getContext === "function"
  ? el.telemetryCanvas.getContext("2d")
  : document.createElement("canvas").getContext("2d");
const SCOPE_MAX_PIXEL_RATIO = 1.0;
const MAIN_SCOPE_MAX_FPS = 24;
const telemetrySeriesMax = 240;
const LIVE_OVERCLOCK_HZ_BY_LEVEL = Object.freeze([2, 4, 6, 8, 10, 12, 14, 16, 20, 30, 40, 50, 60]);

// [DEV] Compatibility global used by unload cleanup in app.js.
let mainScopeAnim = null;

function nextPollTick() {
  const tick = Number.isFinite(Number(pollTick)) ? Number(pollTick) : 0;
  pollTick = tick + 1;
  return tick;
}

function normalizeLiveSceneTokenUi(value, fallback = "auto") {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return fallback;
  if (key === "steady" || key === "calm") return "steady";
  if (key === "motion" || key === "groove") return "motion";
  if (key === "impact") return "impact";
  if (key === "auto" || key === "meta_auto") return "auto";
  return key;
}

function isKnownLiveSceneTokenUi(value = "") {
  const key = normalizeLiveSceneTokenUi(value, "");
  return key === "steady" || key === "motion" || key === "impact" || key === "auto";
}

function formatLiveHzUi(value) {
  const hz = Number(value);
  if (!Number.isFinite(hz) || hz <= 0) return "";
  return hz
    .toFixed(2)
    .replace(/\.00$/, "")
    .replace(/(\.\d)0$/, "$1");
}

const telemetryLiveAuditRuntime = (typeof createTelemetryLiveAuditRuntimeUi === "function"
  ? createTelemetryLiveAuditRuntimeUi({
    ui,
    el,
    setBadge: (node, state, text) => typeof setBadge === "function" ? setBadge(node, state, text) : undefined,
    LIVE_OVERCLOCK_HZ_BY_LEVEL
  })
  : (() => {
    throw new Error("telemetry live audit runtime module missing");
  })());

const {
  processLiveControlAuditTelemetry,
  resolveLiveEffectiveHzUi,
  setEngineHealthBadgeFromTelemetry
} = telemetryLiveAuditRuntime;

const telemetryMonitorRuntime = (typeof createTelemetryMonitorRuntimeUi === "function"
  ? createTelemetryMonitorRuntimeUi({
    el,
    ui,
    windowRef: window,
    documentRef: document,
    mainScopeCtx,
    telemetryScopeCtx,
    SCOPE_MAX_PIXEL_RATIO,
    MAIN_SCOPE_MAX_FPS,
    telemetrySeriesMax,
    formatLiveHzUi,
    getMainScopeAnim: () => mainScopeAnim,
    setMainScopeAnim: value => {
      mainScopeAnim = value || null;
    }
  })
  : (() => {
    throw new Error("telemetry monitor runtime module missing");
  })());

const {
  initializeTelemetryMonitorRuntimeUi,
  updateMainScopeInput,
  updateScopeHud,
  drawTelemetryScope,
  pushScopeSample,
  updateMonitorRenderingState,
  monitorsActive
} = telemetryMonitorRuntime;

initializeTelemetryMonitorRuntimeUi();

const telemetryPollRuntime = (typeof createTelemetryPollRuntimeUi === "function"
  ? createTelemetryPollRuntimeUi({
    el,
    ui,
    telemetryEndpointsAdapter,
    audioDomainAdapter: typeof audioDomainAdapter === "object" ? audioDomainAdapter : null,
    paletteDomainAdapter: typeof paletteDomainAdapter === "object" ? paletteDomainAdapter : null,
    fixturesDomainAdapter: typeof fixturesDomainAdapter === "object" ? fixturesDomainAdapter : null,
    nextPollTick,
    pollIntervalMs,
    setBadge: (node, state, text) => typeof setBadge === "function" ? setBadge(node, state, text) : undefined,
    isLiveProfilesOnlyModeUi: () => typeof isLiveProfilesOnlyModeUi === "function" && isLiveProfilesOnlyModeUi(),
    updateFixtures: snapshot => {
      if (typeof updateFixtures === "function") updateFixtures(snapshot);
    },
    renderMods: snapshot => {
      if (typeof renderMods === "function") renderMods(snapshot);
    },
    applyColorPrefixSnapshot: snapshot => {
      if (typeof applyColorPrefixSnapshot === "function") applyColorPrefixSnapshot(snapshot);
    },
    applyMidiSnapshot: snapshot => {
      if (typeof applyMidiSnapshot === "function") applyMidiSnapshot(snapshot);
    },
    applyMetaAutoTempoTrackersState: trackers => {
      if (typeof applyMetaAutoTempoTrackersState === "function") applyMetaAutoTempoTrackersState(trackers);
    },
    applyAudioReactivityMapToUi: (config, options) => {
      if (typeof applyAudioReactivityMapToUi === "function") applyAudioReactivityMapToUi(config, options);
    },
    setAudioReactivitySourceCatalogRuntime: catalog => {
      if (typeof setAudioReactivitySourceCatalogRuntime === "function") {
        setAudioReactivitySourceCatalogRuntime(catalog);
      }
    },
    AUDIO_REACTIVITY_SOURCE_CATALOG_DEFAULT,
    clampFlowIntensity: value => {
      if (typeof clampFlowIntensity === "function") {
        return clampFlowIntensity(value);
      }
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 1;
    },
    applyFlowIntensityUi: () => {
      if (typeof applyFlowIntensityUi === "function") applyFlowIntensityUi();
    },
    normalizeLiveSceneTokenUi,
    isKnownLiveSceneTokenUi,
    applyPaletteTelemetrySnapshotToUi: (payload, options) => {
      if (typeof applyPaletteTelemetrySnapshotToUi === "function") applyPaletteTelemetrySnapshotToUi(payload, options);
    },
    maybeRetuneSmartMatchFromTelemetry: () => {
      if (typeof maybeRetuneSmartMatchFromTelemetry === "function") maybeRetuneSmartMatchFromTelemetry();
    },
    setEngineHealthBadgeFromTelemetry,
    updateMainScopeInput,
    updateScopeHud,
    pushScopeSample,
    drawTelemetryScope,
    monitorsActive,
    processLiveControlAuditTelemetry,
    sync: () => sync(),
    updateAudioTelemetry: payload => {
      if (typeof updateAudioTelemetry === "function") updateAudioTelemetry(payload);
    },
    syncAudioRuntimeStateIndicatorsFromConfig: (config, options) => {
      if (typeof syncAudioRuntimeStateIndicatorsFromConfig === "function") {
        syncAudioRuntimeStateIndicatorsFromConfig(config, options);
      }
    },
    getPaletteFamiliesLabelUi,
    formatPaletteCountSummaryUi,
    getPaletteGlobalConfigUi,
    formatPaletteVividnessLabelUi,
    toFixedSafe: (value, digits, fallback) => {
      if (typeof toFixedSafe === "function") {
        return toFixedSafe(value, digits, fallback);
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return String(fallback ?? "0");
      const places = Math.max(0, Math.min(6, Math.floor(Number(digits) || 0)));
      return parsed.toFixed(places);
    }
  })
  : (() => {
    throw new Error("telemetry poll runtime module missing");
  })());

const {
  poll,
  pollLoop,
  stopTelemetryPolling
} = telemetryPollRuntime;
const {
  sync
} = (typeof createTelemetrySyncRuntimeUi === "function"
  ? createTelemetrySyncRuntimeUi({
    el,
    ui,
    sceneButtons,
    audioQuickPresetButtons,
    limiterPresetButtons,
    normalizeLiveSceneTokenUi,
    formatLiveHzUi,
    resolveLiveEffectiveHzUi,
    applyLiveModeUiPolicy: () => {
      if (typeof applyLiveModeUiPolicy === "function") applyLiveModeUiPolicy();
    },
    syncPaletteUiStateFromRuntime: () => {
      if (typeof syncPaletteUiStateFromRuntime === "function") syncPaletteUiStateFromRuntime();
    },
    updateAudioReactivityPolicyUi: () => {
      if (typeof updateAudioReactivityPolicyUi === "function") updateAudioReactivityPolicyUi();
    },
    normalizeMetaAutoTempoTrackersUi: (value, fallback) => {
      if (typeof normalizeMetaAutoTempoTrackersUi === "function") {
        return normalizeMetaAutoTempoTrackersUi(value, fallback);
      }
      const base = fallback && typeof fallback === "object" ? fallback : {};
      const source = value && typeof value === "object" ? value : {};
      return {
        baseline: source.baseline !== false && base.baseline !== false,
        peaks: source.peaks !== false && base.peaks !== false,
        transients: source.transients !== false && base.transients !== false,
        flux: source.flux !== false && base.flux !== false
      };
    },
    defaultMetaAutoTempoTrackers: typeof AUDIO_REACTIVITY_MAP_DEFAULT === "object" &&
      AUDIO_REACTIVITY_MAP_DEFAULT &&
      typeof AUDIO_REACTIVITY_MAP_DEFAULT.metaAutoTempoTrackers === "object"
      ? AUDIO_REACTIVITY_MAP_DEFAULT.metaAutoTempoTrackers
      : null
  })
  : (() => {
    throw new Error("telemetry sync runtime module missing");
  })());
