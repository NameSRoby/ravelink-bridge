// [TITLE] Module: public/assets/js/core/ui-state.js
// [TITLE] Purpose: centralized UI state bootstrap
// [TITLE] Functionality Index:
// [TITLE] - dock mode detection bootstrap
// [TITLE] - persisted palette fixture selection bootstrap
// [TITLE] - initial `ui` runtime state object

const UI_STATE_PALETTE_FIXTURE_SELECTION_KEY = "ravelink_palette_fixture_selection_v1";
const UI_STATE_OBS_DOCK_COMPACT_KEY = "ravelink_obs_dock_compact_v1";

function parseDockFlagUiState(rawValue) {
  const raw = String(rawValue || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function readPaletteFixtureSelectionBootstrapUiState() {
  const fallback = { hue: "__all__", wiz: "__all__" };
  try {
    const raw = String(localStorage.getItem(UI_STATE_PALETTE_FIXTURE_SELECTION_KEY) || "").trim();
    if (!raw) return { ...fallback };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...fallback };
    return {
      hue: String(parsed.hue || "__all__").trim() || "__all__",
      wiz: String(parsed.wiz || "__all__").trim() || "__all__"
    };
  } catch {
    return { ...fallback };
  }
}

function normalizeUiStateRgbColorChannel(raw) {
  const n = Math.round(Number(raw) || 0);
  return Math.max(0, Math.min(255, n));
}

function normalizeUiStateCustomPaletteColors(colors = []) {
  const source = Array.isArray(colors) ? colors : [];
  return source.map(color => ({
    r: normalizeUiStateRgbColorChannel(color?.r),
    g: normalizeUiStateRgbColorChannel(color?.g),
    b: normalizeUiStateRgbColorChannel(color?.b)
  }));
}

const uiStateDockSearchParams = new URLSearchParams(location.search || "");
const detectedObsDockModeUiState =
  parseDockFlagUiState(uiStateDockSearchParams.get("obsdock")) ||
  parseDockFlagUiState(uiStateDockSearchParams.get("obsDock")) ||
  parseDockFlagUiState(uiStateDockSearchParams.get("dock")) ||
  /obsbrowser|obs studio|obs\//i.test(String(navigator.userAgent || ""));
const detectedObsDockCompactUiState = detectedObsDockModeUiState
  ? (uiStateDockSearchParams.has("compact")
    ? parseDockFlagUiState(uiStateDockSearchParams.get("compact"))
    : localStorage.getItem(UI_STATE_OBS_DOCK_COMPACT_KEY) !== "0")
  : false;

const uiStateCustomFamilySeed = Object.freeze([
  Object.freeze({ r: 255, g: 0, b: 128 }),
  Object.freeze({ r: 255, g: 96, b: 0 }),
  Object.freeze({ r: 255, g: 220, b: 0 }),
  Object.freeze({ r: 64, g: 224, b: 64 }),
  Object.freeze({ r: 0, g: 188, b: 255 }),
  Object.freeze({ r: 90, g: 120, b: 255 }),
  Object.freeze({ r: 166, g: 88, b: 255 }),
  Object.freeze({ r: 255, g: 255, b: 255 })
]);

const ui = {
  liveShellMode: "full",
  liveShellModeHydrated: false,
  raveOn: false,
  mode: "interpret",
  modeLock: "interpret",
  audioQuickProfile: "balanced",
  flowIntensity: 1,
  brightnessPowerMode: "b",
  wizSceneSync: false,
  sceneSyncStrategy: "independent",
  flowIntensityInputUntil: 0,
  metaAutoEnabled: false,
  metaAutoReason: "off",
  metaAutoGenre: "auto",
  metaAutoHz: 2,
  metaAutoHueWizBaselineBlend: true,
  metaAutoTempoTrackersAuto: false,
  metaAutoTempoTrackers: {
    baseline: true,
    peaks: true,
    transients: true,
    flux: true
  },
  metaAutoTempoTrackersActive: {
    baseline: true,
    peaks: true,
    transients: true,
    flux: true
  },
  cadenceAutoEnabled: false,
  cadenceAutoSource: "manual",
  cadenceAutoRequestedHz: 2,
  cadenceAutoAppliedHz: 2,
  cadenceAutoGuardReason: "none",
  cadenceAutoGuarded: false,
  overclockAutoEnabled: false,
  overclockAutoReason: "off",
  overclockAutoHz: 2,
  limiterPreset: "balanced",
  activeTab: "live",
  paletteColorsPerFamily: 3,
  paletteFamilies: ["red", "yellow", "green", "violet", "blue", "custom"],
  paletteFamilyColorCounts: {
    red: 3,
    yellow: 3,
    green: 3,
    violet: 3,
    blue: 3,
    custom: 3
  },
  paletteFamilyColorIndexes: {
    red: [0, 2, 5],
    yellow: [0, 2, 5],
    green: [0, 2, 5],
    violet: [0, 2, 5],
    blue: [0, 2, 5],
    custom: [0, 2, 5]
  },
  paletteColorSequence: [
    { family: "red", index: 0 },
    { family: "red", index: 2 },
    { family: "red", index: 5 },
    { family: "yellow", index: 0 },
    { family: "yellow", index: 2 },
    { family: "yellow", index: 5 },
    { family: "green", index: 0 },
    { family: "green", index: 2 },
    { family: "green", index: 5 },
    { family: "violet", index: 0 },
    { family: "violet", index: 2 },
    { family: "violet", index: 5 },
    { family: "blue", index: 0 },
    { family: "blue", index: 2 },
    { family: "blue", index: 5 }
  ],
  paletteCustomFamilyColors: normalizeUiStateCustomPaletteColors(uiStateCustomFamilySeed),
  paletteDisorder: false,
  paletteDisorderAggression: 0.35,
  paletteCycleMode: "on_trigger",
  paletteTimedIntervalSec: 5,
  paletteBeatLock: false,
  paletteBeatLockGraceSec: 2,
  paletteReactiveMargin: 28,
  paletteBrightnessFollowAmount: 1,
  paletteVividness: 2,
  paletteSpectrumMapMode: "auto",
  paletteSpectrumFeatureMap: ["lows", "mids", "highs", "rms", "flux"],
  paletteBrandOverrides: { hue: null, wiz: null },
  paletteFixtureOverrides: {},
  paletteControlScope: "global",
  paletteCustomBrand: "hue",
  fixtureMetricConfig: { mode: "manual", metric: "baseline", metaAutoFlip: false, harmonySize: 1, maxHz: null },
  fixtureMetricBrandOverrides: { hue: null, wiz: null },
  fixtureMetricFixtureOverrides: {},
  paletteCatalog: [],
  paletteBrandFixtures: { hue: [], wiz: [] },
  paletteFixtureSelectionByBrand: readPaletteFixtureSelectionBootstrapUiState(),
  overclock: true,
  overclockLevel: 2,
  devDebugMode: localStorage.getItem("ravelink_dev_debug_v1") === "1",
  sceneLock: "auto",
  sceneFilterAggressiveness: {
    calm: 1,
    groove: 1,
    impact: 1
  },
  sceneFilterAggressivenessLoaded: false,
  sceneRuntimeTuning: {
    bpmSourceMode: "hybrid",
    sceneSwitchCooldownMs: 260,
    impactHoldMs: 140,
    brightnessFloor: 0.02,
    brightnessCeil: 1,
    transitionFloorMs: 32,
    transitionCeilMs: 190,
    telemetryBeatConfidenceMin: 0.34
  },
  sceneRuntimeTuningLoaded: false,
  liveSyncGroups: {
    enabled: false,
    groups: [],
    updatedAt: 0
  },
  liveSyncGroupsLoaded: false,
  liveSyncGroupSelectedId: "",
  activeSceneToken: "",
  activeSceneCandidateToken: "",
  audioReactivityMapLoaded: false,
  audioReactivityMapDirty: false,
  audioReactivityMap: null,
  lastRaveTelemetry: null,
  lastAudioTelemetry: null,
  pollErrors: 0,
  audioConfigLoaded: false,
  audioAppsLoaded: false,
  audioRunningApps: [],
  audioRunningProcessMetadata: [],
  audioCompanionMap: {},
  audioAppHintMeta: null,
  audioAudioCapableTokens: [],
  audioAppsShowAll: localStorage.getItem("ravelink_audio_apps_show_all_v1") === "1",
  audioSimpleRoutingMode: localStorage.getItem("ravelink_audio_simple_mode_v1") !== "0",
  audioTuningMode: String(localStorage.getItem("ravelink_audio_tuning_mode_v1") || "easy").trim().toLowerCase() === "advanced"
    ? "advanced"
    : "easy",
  audioHasLoopbackDevice: false,
  audioHasVirtualCableDevice: false,
  audioDetectedUsbAudio: false,
  audioLastDeviceScanCount: 0,
  audioDefaultOutputEndpointName: "",
  audioConfiguredDesktopOutputDeviceName: "",
  audioOptionalToolsStatus: null,
  audioOptionalToolsDismissed: localStorage.getItem("ravelink_audio_optional_tools_dismissed_v1") === "1",
  midiConfigLoaded: false,
  midiDetected: false,
  midiSnapshot: null,
  midiTabForced: localStorage.getItem("ravelink_midi_tab_forced_v1") === "1",
  modsLoadedAt: 0,
  modsTotal: 0,
  modsActive: 0,
  modsDebugEnabled: false,
  modsDebugLoaded: false,
  modUiCatalog: [],
  modUiSelectedId: localStorage.getItem("ravelink_mod_ui_selected_v1") || "",
  modUiLastId: "",
  modUiLastUrl: "",
  modsSnapshot: null,
  modsRuntimeConfig: { enabled: [], order: [], disabled: [] },
  modsDraftConfig: { enabled: [], order: [], disabled: [] },
  modsDraftDirty: false,
  fixtureModBrands: [],
  fixturesCatalog: [],
  fixturesSnapshotLoaded: false,
  routeSelectedId: "",
  lastBpm: 0,
  routeDraftDirty: false,
  routeDraftFixtureId: "",
  routeDraftFlags: null,
  routeLastSavedAt: 0,
  engineReadyTargets: 0,
  engineModeTargets: 0,
  fixtureConnectivityById: {},
  connectivitySummary: null,
  onboardingAcknowledged: false,
  hueEntGuideAcknowledged: false,
  colorPrefixConfigLoaded: false,
  colorPrefixOtherEnabled: false,
  colorPrefixDefaultTarget: "both",
  colorPrefixRuleState: {
    prefixes: { hue: "", wiz: "", other: "" },
    fixturePrefixes: {},
    capabilities: { other: false }
  },
  colorPrefixRuleSelectedKey: "",
  colorRaveOffEnabled: true,
  obsDockMode: detectedObsDockModeUiState,
  obsDockCompact: detectedObsDockCompactUiState,
  startTabPreference: String(localStorage.getItem("ravelink_ui_start_tab_v1") || "live").trim().toLowerCase(),
  confirmDangerousActions: localStorage.getItem("ravelink_ui_confirm_danger_v1") !== "0",
  pollPaused: localStorage.getItem("ravelink_ui_poll_paused_v1") === "1",
  serverAutoLaunchBrowser: true,
  serverHueTransportPreference: "auto",
  serverAudioBackendStrategy: "auto_rust_first",
  serverAudioBackendSelectionReason: "unknown",
  serverAudioBackendSelectionValue: "auto",
  serverUnsafeSensitiveLogs: false,
  serverUnsafeSensitiveLogsBaseline: false,
  serverUpdateChecksEnabled: true,
  serverUpdateStartupPromptEnabled: true,
  systemUpdateStatusSnapshot: null,
  systemStartupReadinessSnapshot: null,
  systemCoreStatusSnapshot: null,
  systemLauncherDiagnosticsSnapshot: null,
  themeName: "midnight",
  themeConfig: {
    bg: "#050507",
    panel: "#0b0e18",
    panel2: "#121a2f",
    accent: "#8b001f",
    edge: "#233055",
    btnBg: "#14182c",
    text: "#eaeaea",
    ok: "#19ff6a",
    warn: "#ffb000",
    bad: "#ff4444",
    glow: 67
  }
};
