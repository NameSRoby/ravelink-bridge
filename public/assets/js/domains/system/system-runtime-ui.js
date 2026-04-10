// [TITLE] Module: public/assets/js/domains/system/system-runtime-ui.js
// [TITLE] Purpose: system settings + widget generator runtime decomposition
// [TITLE] Functionality Index:
// [TITLE] - system preference normalize/apply/save/reset helpers
// [TITLE] - server config persistence contract bridge
// [TITLE] - startup readiness diagnostics load/copy helpers
// [TITLE] - widget template generator state/read/write/copy helpers
// [TITLE] - flow intensity state helpers
// [DEV] Complex Flow:
// [DEV] System settings own both local UI state and server-persisted policy flags.
// [DEV] Keep apply/save ordering deterministic so bootstrap, actions, and telemetry
// [DEV] remain consistent across reloads and runtime transitions.

function createSystemRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const windowRef = deps.windowRef || window;
  const documentRef = deps.documentRef || document;
  const navigatorRef = deps.navigatorRef || navigator;
  const localStorageRef = deps.localStorageRef || localStorage;
  const sessionStorageRef = (
    deps.sessionStorageRef &&
    typeof deps.sessionStorageRef.getItem === "function" &&
    typeof deps.sessionStorageRef.setItem === "function"
  )
    ? deps.sessionStorageRef
    : null;
  const setBadge = typeof deps.setBadge === "function" ? deps.setBadge : (() => {});
  const applyLiveModeUiPolicy = typeof deps.applyLiveModeUiPolicy === "function"
    ? deps.applyLiveModeUiPolicy
    : (() => {});
  const withBasePath = typeof deps.withBase === "function"
    ? deps.withBase
    : (value => String(value || "").trim());
  const normalizeApiBaseInput = typeof deps.normalizeApiBaseInput === "function"
    ? deps.normalizeApiBaseInput
    : (value => String(value || "").trim());
  const confirmUnsafeSensitiveLogEnable = typeof deps.confirmUnsafeSensitiveLogEnable === "function"
    ? deps.confirmUnsafeSensitiveLogEnable
    : (() => ({ ok: false, ack: "" }));
  const wipeUiBrowserMemory = typeof deps.wipeUiBrowserMemory === "function"
    ? deps.wipeUiBrowserMemory
    : (async () => {});
  const pollIntervalMs = Math.max(100, Number(deps.pollIntervalMs) || 220);
  const UI_START_TAB_KEY = String(deps.UI_START_TAB_KEY || "ravelink_ui_start_tab_v1");
  const UI_CONFIRM_DANGER_KEY = String(deps.UI_CONFIRM_DANGER_KEY || "ravelink_ui_confirm_danger_v1");
  const UI_POLL_PAUSED_KEY = String(deps.UI_POLL_PAUSED_KEY || "ravelink_ui_poll_paused_v1");
  const systemEndpointsAdapter = deps.systemEndpointsAdapter;
  const requiredAdapterMethods = [
    "getConfig",
    "saveConfig",
    "getRouteCatalog",
    "requestRoute",
    "getInternetGatewayStatus",
    "getUpdateStatus",
    "checkForUpdates",
    "applyUpdate",
    "getSystemOauthStatus",
    "seedSystemOauthProfile",
    "clearSystemOauthProfile",
    "startSystemOauth",
    "getSystemOauthDeviceStatus",
    "disconnectSystemOauth",
    "syncSystemOauthToMod",
    "getWidgetRedemptionReconcileStatus",
    "reconcileWidgetRedemptions",
    "generateWidgetTemplate"
  ];
  const audioEndpointsAdapter = deps.audioEndpointsAdapter;
  const requiredAudioAdapterMethods = [
    "getRustTransportWorkerStatus",
    "getRustTransportWorkerAdapters",
    "getRustTransportWorkerWatchdog",
    "setRustTransportWorkerConfig",
    "startRustTransportWorker",
    "stopRustTransportWorker",
    "restartRustTransportWorker"
  ];
  if (!systemEndpointsAdapter || typeof systemEndpointsAdapter !== "object") {
    throw new Error("system runtime requires systemEndpointsAdapter");
  }
  for (const methodName of requiredAdapterMethods) {
    if (typeof systemEndpointsAdapter[methodName] !== "function") {
      throw new Error(`system runtime missing adapter method: ${methodName}`);
    }
  }
  if (!audioEndpointsAdapter || typeof audioEndpointsAdapter !== "object") {
    throw new Error("system runtime requires audioEndpointsAdapter");
  }
  for (const methodName of requiredAudioAdapterMethods) {
    if (typeof audioEndpointsAdapter[methodName] !== "function") {
      throw new Error(`system runtime missing audio adapter method: ${methodName}`);
    }
  }
  const getFlowIntensityCommitTimer = typeof deps.getFlowIntensityCommitTimer === "function"
    ? deps.getFlowIntensityCommitTimer
    : (() => null);
  const setFlowIntensityCommitTimer = typeof deps.setFlowIntensityCommitTimer === "function"
    ? deps.setFlowIntensityCommitTimer
    : (() => {});

  const START_TAB_VALUES = new Set(["live", "fixtures", "audio", "midi", "mods", "system"]);
  const AUDIO_BACKEND_STRATEGY_VALUES = new Set([
    "auto_rust_first",
    "force_rust"
  ]);
  const SYSTEM_WIDGET_TEMPLATE_PREFS_KEY = "ravelink_system_widget_template_v1";
  const SYSTEM_WIDGET_TEMPLATE_DEFAULTS = Object.freeze({
    colorRewardId: "",
    teachRewardId: "",
    raveRewardId: "",
    baseUrl: "http://127.0.0.1:5050",
    raveAutoOffSec: 300,
    raveAutoOffResetOnRepeat: true,
    enableStatusSync: false,
    streamElementsBotChatEnabled: false,
    streamElementsBotChannelId: "",
    streamElementsBotJwt: "",
    streamElementsBotMessagePrefix: "",
    twitchClientId: "",
    twitchUserAccessToken: "",
    twitchBroadcasterId: "",
    raveOffAnnounceEnabled: true,
    raveOffAnnounceMessage: "RAVE is now off. Change Lights redemption is active again.",
    blockedMessage: "light commands are disabled while RAVE is active (runtime: 5 minutes)"
  });
  const startupReadinessRuntime = (typeof createSystemStartupReadinessRuntimeUi === "function"
    ? createSystemStartupReadinessRuntimeUi({
      el,
      ui,
      windowRef,
      documentRef,
      navigatorRef,
      setBadge,
      systemEndpointsAdapter,
      audioEndpointsAdapter
    })
    : (() => {
      throw new Error("system startup-readiness runtime module missing");
    })());

  function normalizeStartTabPreference(value) {
    const raw = String(value || "").trim().toLowerCase();
    return START_TAB_VALUES.has(raw) ? raw : "live";
  }

  function normalizeHueTransportPreference(value) {
    const token = String(value || "").trim().toLowerCase();
    if (token === "rest") return "rest";
    if (token === "entertainment") return "entertainment";
    return "auto";
  }

  function normalizeAudioBackendStrategy(value) {
    const raw = String(value || "").trim().toLowerCase();
    return AUDIO_BACKEND_STRATEGY_VALUES.has(raw) ? raw : "auto_rust_first";
  }

  function shouldConfirmDangerousAction() {
    return ui.confirmDangerousActions !== false;
  }

  function updatePollIndicator() {
    if (!el.pollMs) return;
    el.pollMs.textContent = ui.pollPaused ? "PAUSED" : String(pollIntervalMs);
  }

  function renderSystemSettingsStatus() {
    if (!el.systemSettingsStatus) return;
    const startTab = normalizeStartTabPreference(ui.startTabPreference).toUpperCase();
    const confirms = ui.confirmDangerousActions ? "CONFIRM ON" : "CONFIRM OFF";
    const polling = ui.pollPaused ? "POLL PAUSED" : "POLL LIVE";
    const browserLaunch = ui.serverAutoLaunchBrowser ? "BROWSER AUTO ON" : "BROWSER AUTO OFF";
    const hueTransport = (() => {
      const mode = normalizeHueTransportPreference(ui.serverHueTransportPreference);
      if (mode === "rest") return "HUE REST ONLY";
      if (mode === "entertainment") return "HUE ENTERTAINMENT";
      return "HUE AUTO";
    })();
    const captureStrategy = (() => {
      const strategy = normalizeAudioBackendStrategy(ui.serverAudioBackendStrategy);
      if (strategy === "force_rust") return "AUDIO FORCE RUST";
      return "AUDIO AUTO RUST-FIRST";
    })();
    const captureSelection = String(ui.serverAudioBackendSelectionValue || "auto").trim().toUpperCase();
    const captureReason = String(ui.serverAudioBackendSelectionReason || "unknown")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_ -]+/g, "_");
    const logsMode = ui.serverUnsafeSensitiveLogs ? "LOG REDACTION OFF (DEV RISK)" : "LOG REDACTION ON";
    const updatesMode = (() => {
      if (ui.serverUpdateChecksEnabled !== true) return "UPDATES STARTUP OFF";
      return ui.serverUpdateStartupPromptEnabled === true
        ? "UPDATES STARTUP+PROMPT"
        : "UPDATES STARTUP SILENT";
    })();
    const wiring = (() => {
      const summary = ui.nonLiveUiWiringSummary && typeof ui.nonLiveUiWiringSummary === "object"
        ? ui.nonLiveUiWiringSummary
        : null;
      if (!summary) return "NON-LIVE UI AUDIT PENDING";
      return summary.ok === true ? "NON-LIVE UI WIRED" : "NON-LIVE UI WIRING WARN";
    })();
    el.systemSettingsStatus.value = `${startTab} | ${confirms} | ${polling} | ${browserLaunch} | ${hueTransport} | ${captureStrategy} -> ${captureSelection} (${captureReason}) | ${updatesMode} | ${logsMode}`;
    el.systemSettingsStatus.value += ` | ${wiring}`;
  }

  function renderSystemStartupReadinessUi(snapshot = {}, options = {}) {
    return startupReadinessRuntime.renderSystemStartupReadinessUi(snapshot, options);
  }

  async function loadSystemStartupReadiness(options = {}) {
    return startupReadinessRuntime.loadSystemStartupReadiness(options);
  }

  async function copySystemStartupReadinessDiagnosticsJson() {
    return startupReadinessRuntime.copySystemStartupReadinessDiagnosticsJson();
  }

  const systemOpsRuntime = (typeof createSystemOpsRuntimeUi === "function"
    ? createSystemOpsRuntimeUi({
      el,
      ui,
      windowRef,
      documentRef,
      navigatorRef,
      setBadge,
      systemEndpointsAdapter,
      audioEndpointsAdapter
    })
    : (() => {
      throw new Error("system ops runtime module missing");
    })());
  const {
    renderSystemRouteCatalogOptions,
    loadSystemRouteCatalog,
    applySystemRouteCatalogSelection,
    runSystemRouteConsoleRequest,
    copySystemRouteConsoleResponse,
    renderGatewayAndReconcileStatus,
    loadSystemInternetGatewayStatus,
    loadSystemWidgetReconcileStatus,
    runSystemWidgetReconcileNow,
    copySystemWidgetReconcileResultJson,
    renderSystemRustTransportWorkerStatus,
    loadSystemRustTransportWorkerStatus,
    loadSystemRustTransportWorkerAdapters,
    loadSystemRustTransportWorkerWatchdog,
    saveSystemRustTransportWorkerConfig,
    startSystemRustTransportWorker,
    stopSystemRustTransportWorker,
    restartSystemRustTransportWorker,
    copySystemRustTransportWorkerJson
  } = systemOpsRuntime;

  const systemUpdateRuntime = (typeof createSystemUpdateRuntimeUi === "function"
    ? createSystemUpdateRuntimeUi({
      el,
      ui,
      windowRef,
      sessionStorageRef,
      setBadge,
      systemEndpointsAdapter
    })
    : (() => {
      throw new Error("system update runtime module missing");
    })());
  const {
    normalizeBooleanSelectValue,
    renderSystemUpdateStatus,
    loadSystemUpdateStatus,
    runSystemUpdateCheck,
    applySystemUpdate,
    openSystemUpdateReleasePage
  } = systemUpdateRuntime;

  function applySystemSettingsUi() {
    if (el.systemStartTab) {
      el.systemStartTab.value = normalizeStartTabPreference(ui.startTabPreference);
    }
    if (el.systemConfirmActions) {
      el.systemConfirmActions.value = ui.confirmDangerousActions ? "true" : "false";
    }
    if (el.systemPollingMode) {
      el.systemPollingMode.value = ui.pollPaused ? "paused" : "live";
    }
    if (el.systemAutoLaunchBrowser) {
      el.systemAutoLaunchBrowser.value = ui.serverAutoLaunchBrowser ? "true" : "false";
    }
    if (el.systemHueTransportPreference) {
      el.systemHueTransportPreference.value = normalizeHueTransportPreference(ui.serverHueTransportPreference);
    }
    if (el.systemAudioBackendStrategy) {
      el.systemAudioBackendStrategy.value = normalizeAudioBackendStrategy(ui.serverAudioBackendStrategy);
    }
    if (el.systemUnsafeSensitiveLogs) {
      el.systemUnsafeSensitiveLogs.value = ui.serverUnsafeSensitiveLogs ? "true" : "false";
    }
    if (el.systemUpdateChecksEnabled) {
      el.systemUpdateChecksEnabled.value = ui.serverUpdateChecksEnabled ? "true" : "false";
    }
    if (el.systemUpdateStartupPromptEnabled) {
      el.systemUpdateStartupPromptEnabled.value = ui.serverUpdateStartupPromptEnabled ? "true" : "false";
    }
    if (el.systemRouteConsoleMethod && !String(el.systemRouteConsoleMethod.value || "").trim()) {
      el.systemRouteConsoleMethod.value = "GET";
    }
    if (el.systemRouteConsolePath && !String(el.systemRouteConsolePath.value || "").trim()) {
      el.systemRouteConsolePath.value = "/health";
    }
    if (el.systemRouteConsoleBody && !String(el.systemRouteConsoleBody.value || "").trim()) {
      el.systemRouteConsoleBody.value = "{}";
    }
    if (el.systemWidgetReconcileStatus && !String(el.systemWidgetReconcileStatus.value || "").trim()) {
      el.systemWidgetReconcileStatus.value = "FULFILLED";
    }
    if (el.systemWidgetReconcileReason && !String(el.systemWidgetReconcileReason.value || "").trim()) {
      el.systemWidgetReconcileReason.value = "manual_reconcile";
    }
    if (el.systemRustWorkerEnabled && !String(el.systemRustWorkerEnabled.value || "").trim()) {
      el.systemRustWorkerEnabled.value = "true";
    }
    if (el.systemRustWorkerAutoStart && !String(el.systemRustWorkerAutoStart.value || "").trim()) {
      el.systemRustWorkerAutoStart.value = "true";
    }
    if (el.systemRustWorkerAdapterPreference && !String(el.systemRustWorkerAdapterPreference.value || "").trim()) {
      el.systemRustWorkerAdapterPreference.value = "auto";
    }
    if (el.systemRustWorkerWatchdogMs && !String(el.systemRustWorkerWatchdogMs.value || "").trim()) {
      el.systemRustWorkerWatchdogMs.value = "2500";
    }
    if (el.systemRustWorkerRestartBackoffMs && !String(el.systemRustWorkerRestartBackoffMs.value || "").trim()) {
      el.systemRustWorkerRestartBackoffMs.value = "1200";
    }
    updatePollIndicator();
    if (ui.pollPaused && el.netBadge) {
      setBadge(el.netBadge, "warn", "POLL PAUSED");
    }
    renderSystemSettingsStatus();
    renderSystemUpdateStatus();
    renderSystemRouteCatalogOptions();
    renderGatewayAndReconcileStatus();
    renderSystemRustTransportWorkerStatus();
    applyLiveModeUiPolicy();
  }

  function saveSystemSettingsFromUi() {
    const previousPaused = ui.pollPaused;
    ui.startTabPreference = normalizeStartTabPreference(el.systemStartTab?.value || ui.startTabPreference);
    ui.confirmDangerousActions = String(el.systemConfirmActions?.value || "true").trim().toLowerCase() !== "false";
    ui.pollPaused = String(el.systemPollingMode?.value || "live").trim().toLowerCase() === "paused";
    ui.serverAutoLaunchBrowser = String(el.systemAutoLaunchBrowser?.value || "true").trim().toLowerCase() !== "false";
    ui.serverHueTransportPreference = normalizeHueTransportPreference(el.systemHueTransportPreference?.value || "auto");
    ui.serverAudioBackendStrategy = normalizeAudioBackendStrategy(el.systemAudioBackendStrategy?.value || "auto_rust_first");
    ui.serverUnsafeSensitiveLogs = String(el.systemUnsafeSensitiveLogs?.value || "false").trim().toLowerCase() === "true";
    ui.serverUpdateChecksEnabled = normalizeBooleanSelectValue(el.systemUpdateChecksEnabled?.value, ui.serverUpdateChecksEnabled !== false);
    ui.serverUpdateStartupPromptEnabled = normalizeBooleanSelectValue(
      el.systemUpdateStartupPromptEnabled?.value,
      ui.serverUpdateStartupPromptEnabled !== false
    );

    localStorageRef.setItem(UI_START_TAB_KEY, ui.startTabPreference);
    localStorageRef.setItem(UI_CONFIRM_DANGER_KEY, ui.confirmDangerousActions ? "1" : "0");
    localStorageRef.setItem(UI_POLL_PAUSED_KEY, ui.pollPaused ? "1" : "0");
    applySystemSettingsUi();
    return { pollingChanged: previousPaused !== ui.pollPaused };
  }

  function resetSystemSettingsToDefaults() {
    ui.startTabPreference = "live";
    ui.confirmDangerousActions = true;
    ui.pollPaused = false;
    ui.serverAutoLaunchBrowser = true;
    ui.serverHueTransportPreference = "auto";
    ui.serverAudioBackendStrategy = "auto_rust_first";
    ui.serverAudioBackendSelectionReason = "unknown";
    ui.serverAudioBackendSelectionValue = "auto";
    ui.serverUnsafeSensitiveLogs = false;
    ui.serverUnsafeSensitiveLogsBaseline = false;
    ui.serverUpdateChecksEnabled = true;
    ui.serverUpdateStartupPromptEnabled = true;
    ui.systemUpdateStatusSnapshot = null;
    localStorageRef.removeItem(UI_START_TAB_KEY);
    localStorageRef.removeItem(UI_CONFIRM_DANGER_KEY);
    localStorageRef.removeItem(UI_POLL_PAUSED_KEY);
    applySystemSettingsUi();
  }

  async function loadSystemServerConfig() {
    const response = await systemEndpointsAdapter.getConfig();
    if (!response || response.ok !== true || !response.config) return false;
    ui.serverAutoLaunchBrowser = response.config.autoLaunchBrowser !== false;
    ui.serverHueTransportPreference = normalizeHueTransportPreference(response.config.hueTransportPreference);
    ui.serverAudioBackendStrategy = normalizeAudioBackendStrategy(response.config.audioCaptureBackendStrategy);
    ui.serverAudioBackendSelectionReason = String(response.audioBackendSelection?.reason || "unknown").trim().toLowerCase();
    ui.serverAudioBackendSelectionValue = String(response.audioBackendSelection?.selectedBackend || "auto").trim().toLowerCase();
    ui.serverUnsafeSensitiveLogs = response.config.unsafeExposeSensitiveLogs === true;
    ui.serverUnsafeSensitiveLogsBaseline = ui.serverUnsafeSensitiveLogs;
    ui.serverUpdateChecksEnabled = response.config.updateChecksEnabled !== false;
    ui.serverUpdateStartupPromptEnabled = response.config.updateStartupPromptEnabled !== false;
    applySystemSettingsUi();
    return true;
  }

  async function saveSystemServerSettingsFromUi() {
    const enablingUnsafeLogs = ui.serverUnsafeSensitiveLogs === true && ui.serverUnsafeSensitiveLogsBaseline !== true;
    let unsafeAck = "";
    if (enablingUnsafeLogs) {
      const ack = confirmUnsafeSensitiveLogEnable();
      if (!ack.ok) {
        ui.serverUnsafeSensitiveLogs = ui.serverUnsafeSensitiveLogsBaseline === true;
        applySystemSettingsUi();
        return { ok: false, error: "unsafe sensitive log mode enable cancelled" };
      }
      unsafeAck = ack.ack;
    }

    const payload = {
      autoLaunchBrowser: ui.serverAutoLaunchBrowser,
      hueTransportPreference: normalizeHueTransportPreference(ui.serverHueTransportPreference),
      audioCaptureBackendStrategy: normalizeAudioBackendStrategy(ui.serverAudioBackendStrategy),
      updateChecksEnabled: ui.serverUpdateChecksEnabled === true,
      updateStartupPromptEnabled: ui.serverUpdateStartupPromptEnabled === true,
      unsafeExposeSensitiveLogs: ui.serverUnsafeSensitiveLogs
    };
    if (unsafeAck) payload.unsafeExposeSensitiveLogsAck = unsafeAck;
    const response = await systemEndpointsAdapter.saveConfig(payload);
    if (!response.ok || response.data?.ok !== true) {
      ui.serverUnsafeSensitiveLogs = ui.serverUnsafeSensitiveLogsBaseline === true;
      applySystemSettingsUi();
      return {
        ok: false,
        error: response.data?.error || "server settings save failed"
      };
    }

    ui.serverAutoLaunchBrowser = response.data?.config?.autoLaunchBrowser !== false;
    ui.serverHueTransportPreference = normalizeHueTransportPreference(response.data?.config?.hueTransportPreference);
    ui.serverAudioBackendStrategy = normalizeAudioBackendStrategy(response.data?.config?.audioCaptureBackendStrategy);
    ui.serverAudioBackendSelectionReason = String(response.data?.audioBackendSelection?.reason || "unknown").trim().toLowerCase();
    ui.serverAudioBackendSelectionValue = String(response.data?.audioBackendSelection?.selectedBackend || "auto").trim().toLowerCase();
    ui.serverUnsafeSensitiveLogs = response.data?.config?.unsafeExposeSensitiveLogs === true;
    ui.serverUnsafeSensitiveLogsBaseline = ui.serverUnsafeSensitiveLogs;
    ui.serverUpdateChecksEnabled = response.data?.config?.updateChecksEnabled !== false;
    ui.serverUpdateStartupPromptEnabled = response.data?.config?.updateStartupPromptEnabled !== false;
    applySystemSettingsUi();
    return { ok: true };
  }

  const systemUiWiringAuditRuntime = (typeof createSystemUiWiringAuditRuntimeUi === "function"
    ? createSystemUiWiringAuditRuntimeUi({
      el,
      ui,
      windowRef,
      setBadge,
      renderSystemSettingsStatus
    })
    : (() => {
      throw new Error("system UI wiring-audit runtime module missing");
    })());
  const { runSystemNonLiveUiWiringAudit } = systemUiWiringAuditRuntime;

  function clearUiLocalCache() {
    return wipeUiBrowserMemory({ includeCacheStorage: true });
  }

  function clampSystemWidgetRaveAutoOffSec(value) {
    const parsed = Math.round(Number(value));
    if (!Number.isFinite(parsed)) return SYSTEM_WIDGET_TEMPLATE_DEFAULTS.raveAutoOffSec;
    return Math.max(15, Math.min(1800, parsed));
  }

  function normalizeSystemWidgetBaseUrl(value) {
    const raw = String(value || "").trim();
    const origin = String(windowRef.location.origin || "").trim();
    const safeOrigin = origin && origin !== "null" ? origin : SYSTEM_WIDGET_TEMPLATE_DEFAULTS.baseUrl;
    if (!raw) return safeOrigin;
    const normalized = normalizeApiBaseInput(raw);
    if (normalized) return normalized;
    return raw || safeOrigin;
  }

  const systemWidgetTemplateRuntime = (typeof createSystemWidgetTemplateRuntimeUi === "function"
    ? createSystemWidgetTemplateRuntimeUi({
      el,
      ui,
      windowRef,
      documentRef,
      navigatorRef,
      localStorageRef,
      setBadge,
      normalizeSystemWidgetBaseUrl,
      clampSystemWidgetRaveAutoOffSec,
      systemEndpointsAdapter,
      modsEndpointsAdapter: (typeof modsEndpointsAdapter === "object" ? modsEndpointsAdapter : null),
      widgetPrefsStorageKey: SYSTEM_WIDGET_TEMPLATE_PREFS_KEY,
      widgetTemplateDefaults: SYSTEM_WIDGET_TEMPLATE_DEFAULTS
    })
    : (() => {
      throw new Error("system widget template runtime module missing");
    })());
  const {
    setSystemWidgetTemplateStatus,
    toggleSystemWidgetSensitiveFieldsReveal,
    saveSystemWidgetTemplatePrefsToStorage,
    restoreSystemWidgetPrefsFromStorage,
    buildSystemWidgetTemplatePayload,
    buildSystemWidgetTwitchAuthorizeUrl,
    openSystemWidgetOauthAuthorizeUrl,
    copySystemWidgetOauthAuthorizeUrl,
    loadSystemWidgetOauthSyncProfile,
    saveSystemOauthClientIdOverride,
    clearBundledSystemOauthClientId,
    syncSystemWidgetOauthToMod,
    seedSystemWidgetOauthDevVaultFromUi,
    clearSystemWidgetOauthDevVault,
    describeSystemWidgetTemplateActiveParams,
    generateSystemWidgetTemplate,
    copySystemWidgetTemplate
  } = systemWidgetTemplateRuntime;

  function clampFlowIntensity(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 1;
    return Math.min(2.5, Math.max(0.35, n));
  }

  function applyFlowIntensityUi() {
    const value = 1;
    ui.flowIntensity = value;
    if (el.flowIntensity) {
      el.flowIntensity.value = String(Math.round(value * 100));
    }
    const text = "SCENE-OWNED";
    if (el.flowIntensityVal) el.flowIntensityVal.textContent = text;
    if (el.flowStat) el.flowStat.textContent = text;
  }

  async function commitFlowIntensity(options = {}) {
    const silent = options.silent !== false;
    ui.flowIntensity = 1;
    applyFlowIntensityUi();
    if (!silent) setBadge(el.health, "ok", "FLOW SHAPING IS SCENE-OWNED");
    return true;
  }

  async function resetFlowIntensity(options = {}) {
    const flowTimer = getFlowIntensityCommitTimer();
    if (flowTimer) {
      clearTimeout(flowTimer);
      setFlowIntensityCommitTimer(null);
    }
    ui.flowIntensity = 1;
    ui.flowIntensityInputUntil = Date.now() + 900;
    applyFlowIntensityUi();
    const ok = await commitFlowIntensity({ silent: options.silent !== false ? true : false });
    if (ok && options.silent === false) {
      setBadge(el.health, "ok", "FLOW RESET TO 1.00x");
    }
    return ok;
  }

  return {
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
    saveSystemOauthClientIdOverride,
    clearBundledSystemOauthClientId,
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
  };
}
