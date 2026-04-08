// [TITLE] Module: public/assets/js/domains/system-flow.js
// [TITLE] Purpose: system runtime orchestrator (delegates to system-runtime-ui module)
// [TITLE] Functionality Index:
// [TITLE] - instantiate system runtime helpers with app-level dependencies
// [TITLE] - expose global system helpers used by bootstrap/actions/live domains
// [DEV] Complex Flow:
// [DEV] This file intentionally stays thin so system behavior lives in a dedicated
// [DEV] module while preserving existing global helper names for cross-domain callers.

let flowIntensityCommitTimer = null;
const systemFlowGlobal = (typeof globalThis === "object" && globalThis)
  ? globalThis
  : (typeof window === "object" ? window : {});

function getRequiredSystemFlowFunction(name) {
  const fn = systemFlowGlobal[name];
  if (typeof fn !== "function") {
    throw new Error(`system-flow missing required function dependency: ${name}`);
  }
  return fn;
}

function getRequiredSystemFlowObject(name) {
  const value = systemFlowGlobal[name];
  if (!value || typeof value !== "object") {
    throw new Error(`system-flow missing required object dependency: ${name}`);
  }
  return value;
}

function callSystemFlowFunction(name, fn, args = []) {
  const resolved = typeof fn === "function" ? fn : systemFlowGlobal[name];
  if (typeof resolved !== "function") {
    throw new Error(`system-flow missing required function dependency: ${name}`);
  }
  return resolved(...args);
}

const pollIntervalMsSafe = Number.isFinite(Number(pollIntervalMs))
  ? Number(pollIntervalMs)
  : 220;
const uiStartTabKeySafe = (typeof UI_START_TAB_KEY === "string" && UI_START_TAB_KEY.trim())
  ? UI_START_TAB_KEY
  : "ravelink_ui_start_tab_v1";
const uiConfirmDangerKeySafe = (typeof UI_CONFIRM_DANGER_KEY === "string" && UI_CONFIRM_DANGER_KEY.trim())
  ? UI_CONFIRM_DANGER_KEY
  : "ravelink_ui_confirm_danger_v1";
const uiPollPausedKeySafe = (typeof UI_POLL_PAUSED_KEY === "string" && UI_POLL_PAUSED_KEY.trim())
  ? UI_POLL_PAUSED_KEY
  : "ravelink_ui_poll_paused_v1";

const {
  normalizeStartTabPreference,
  normalizeHueTransportPreference,
  normalizeAudioBackendStrategy,
  shouldConfirmDangerousAction,
  updatePollIndicator,
  renderSystemSettingsStatus,
  renderSystemStartupReadinessUi,
  applySystemSettingsUi,
  saveSystemSettingsFromUi,
  resetSystemSettingsToDefaults,
  loadSystemServerConfig,
  loadSystemUpdateStatus,
  loadSystemStartupReadiness,
  loadSystemRouteCatalog,
  applySystemRouteCatalogSelection,
  runSystemRouteConsoleRequest,
  copySystemRouteConsoleResponse,
  loadSystemInternetGatewayStatus,
  loadSystemWidgetReconcileStatus,
  runSystemWidgetReconcileNow,
  copySystemWidgetReconcileResultJson,
  loadSystemRustTransportWorkerStatus,
  loadSystemRustTransportWorkerAdapters,
  loadSystemRustTransportWorkerWatchdog,
  saveSystemRustTransportWorkerConfig,
  startSystemRustTransportWorker,
  stopSystemRustTransportWorker,
  restartSystemRustTransportWorker,
  copySystemRustTransportWorkerJson,
  copySystemStartupReadinessDiagnosticsJson,
  saveSystemServerSettingsFromUi,
  runSystemUpdateCheck,
  applySystemUpdate,
  openSystemUpdateReleasePage,
  clearUiLocalCache,
  runSystemNonLiveUiWiringAudit,
  clampSystemWidgetRaveAutoOffSec,
  normalizeSystemWidgetBaseUrl,
  setSystemWidgetTemplateStatus,
  toggleSystemWidgetSensitiveFieldsReveal,
  saveSystemWidgetTemplatePrefsToStorage,
  restoreSystemWidgetPrefsFromStorage,
  buildSystemWidgetTemplatePayload,
  buildSystemWidgetTwitchAuthorizeUrl,
  openSystemWidgetOauthAuthorizeUrl,
  copySystemWidgetOauthAuthorizeUrl,
  loadSystemWidgetOauthSyncProfile,
  syncSystemWidgetOauthToMod,
  seedSystemWidgetOauthDevVaultFromUi,
  clearSystemWidgetOauthDevVault,
  describeSystemWidgetTemplateActiveParams,
  generateSystemWidgetTemplate,
  copySystemWidgetTemplate,
  clampFlowIntensity,
  applyFlowIntensityUi,
  commitFlowIntensity,
  resetFlowIntensity
} = (typeof createSystemRuntimeUi === "function"
  ? createSystemRuntimeUi({
    el,
    ui,
    windowRef: window,
    documentRef: document,
    navigatorRef: navigator,
    localStorageRef: localStorage,
    sessionStorageRef: sessionStorage,
    setBadge: (node, state, text) => callSystemFlowFunction("setBadge", typeof setBadge === "function" ? setBadge : null, [node, state, text]),
    withBase: value => callSystemFlowFunction("withBase", typeof withBase === "function" ? withBase : null, [value]),
    applyLiveModeUiPolicy: (...args) => callSystemFlowFunction(
      "applyLiveModeUiPolicy",
      typeof applyLiveModeUiPolicy === "function" ? applyLiveModeUiPolicy : null,
      args
    ),
    normalizeApiBaseInput: (...args) => callSystemFlowFunction(
      "normalizeApiBaseInput",
      typeof normalizeApiBaseInput === "function" ? normalizeApiBaseInput : null,
      args
    ),
    confirmUnsafeSensitiveLogEnable: (...args) => callSystemFlowFunction(
      "confirmUnsafeSensitiveLogEnable",
      typeof confirmUnsafeSensitiveLogEnable === "function" ? confirmUnsafeSensitiveLogEnable : null,
      args
    ),
    wipeUiBrowserMemory: (...args) => callSystemFlowFunction(
      "wipeUiBrowserMemory",
      typeof wipeUiBrowserMemory === "function" ? wipeUiBrowserMemory : null,
      args
    ),
    pollIntervalMs: pollIntervalMsSafe,
    UI_START_TAB_KEY: uiStartTabKeySafe,
    UI_CONFIRM_DANGER_KEY: uiConfirmDangerKeySafe,
    UI_POLL_PAUSED_KEY: uiPollPausedKeySafe,
    systemEndpointsAdapter: (
      typeof systemEndpointsAdapter === "object" && systemEndpointsAdapter
    ) ? systemEndpointsAdapter : getRequiredSystemFlowObject("systemEndpointsAdapter"),
    audioEndpointsAdapter: (
      typeof audioEndpointsAdapter === "object" && audioEndpointsAdapter
    ) ? audioEndpointsAdapter : getRequiredSystemFlowObject("audioEndpointsAdapter"),
    getFlowIntensityCommitTimer: () => flowIntensityCommitTimer,
    setFlowIntensityCommitTimer: value => {
      flowIntensityCommitTimer = value || null;
    }
  })
  : (() => {
    throw new Error("system runtime module missing");
  })());
