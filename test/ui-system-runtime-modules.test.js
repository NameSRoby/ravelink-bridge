const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadFactory(relativeFile, factoryName, extraContext = {}) {
  const filePath = path.resolve(__dirname, "..", relativeFile);
  const code = fs.readFileSync(filePath, "utf8");
  const context = {
    console,
    setTimeout,
    clearTimeout,
    ...extraContext
  };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: filePath });
  const factory = context[factoryName];
  assert.equal(typeof factory, "function", `missing runtime factory: ${factoryName}`);
  return factory;
}

function createStorageStub() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
    removeItem(key) {
      map.delete(String(key));
    }
  };
}

function createButtonNode() {
  return {
    onclick: () => {},
    disabled: false,
    textContent: "",
    classList: {
      toggle() {},
      add() {},
      remove() {}
    }
  };
}

const NON_LIVE_BUTTON_IDS = Object.freeze([
  "fxSaveBtn", "fxResetBtn", "fxHueDiscoverBtn", "fxHuePairBtn", "fxHueSaveBridgeBtn",
  "fxWizManualGuideBtn", "fxWizDiscoverBtn", "fxWizUseSelectedBtn", "fxWizClearDiscoveryBtn",
  "standRouteApplyBtn", "standRefreshBtn", "standConnectivityBtn", "fixturesReloadBtn",
  "colorPrefixSaveBtn", "colorPrefixResetBtn",
  "aRefreshBtn", "aScanBtn", "aApplyBtn", "aRefreshAdvancedBtn", "aRestartBtn", "aResetDefaultsBtn",
  "aProfileSaveBtn", "aProfileLoadBtn", "aProfileDeleteBtn",
  "aAppsRefreshBtn", "aAppIsoManualSetBtn", "aAppIsoManualClearBtn",
  "aTuningModeEasyBtn", "aTuningModeAdvancedBtn",
  "aQuickTuneResetBtn", "aQuickTuneApplyBtn",
  "midiRefreshBtn", "midiSaveCfgBtn", "midiLearnArmBtn", "midiLearnCancelBtn", "midiTriggerBtn",
  "midiBindingSaveBtn", "midiBindingClearBtn", "midiBindingResetBtn",
  "modsRefreshBtn", "modsReloadBtn", "modsDebugToggleBtn", "modsDebugClearBtn", "modImportBrowseBtn",
  "modEnableBtn", "modDisableBtn", "modApplyBtn", "modDiscardBtn", "modActionRunBtn",
  "modUiRefreshBtn", "modUiReloadBtn", "modUiOpenBtn", "moddingReadmeBtn",
  "systemSettingsSaveBtn", "systemSettingsResetBtn", "systemUpdateCheckNowBtn", "systemUpdateOpenReleaseBtn", "systemUpdateApplyBtn", "systemPollNowBtn", "systemClearCacheBtn",
  "systemStartupReadinessRefreshBtn", "systemStartupReadinessCopyBtn",
  "systemRouteCatalogLoadBtn", "systemRouteCatalogApplyBtn", "systemRouteConsoleSendBtn", "systemRouteConsoleCopyBtn",
  "systemGatewayStatusRefreshBtn",
  "systemWidgetGenerateBtn", "systemWidgetCopyBtn", "systemWidgetOauthOpenBtn", "systemWidgetOauthCopyBtn",
  "systemWidgetReconcileStatusRefreshBtn", "systemWidgetReconcileRunBtn", "systemWidgetReconcileCopyBtn",
  "systemWidgetSensitiveToggleBtn",
  "systemRustWorkerStatusRefreshBtn", "systemRustWorkerAdaptersRefreshBtn", "systemRustWorkerWatchdogRefreshBtn",
  "systemRustWorkerConfigApplyBtn", "systemRustWorkerStartBtn", "systemRustWorkerStopBtn", "systemRustWorkerRestartBtn", "systemRustWorkerCopyBtn",
  "apiBaseSaveBtn", "apiBaseResetBtn"
]);

function createRuntimeForAudit(buttonOverrides = {}) {
  const windowRef = {};
  const el = {
    health: { badge: null },
    systemSettingsStatus: { value: "" },
    fixtureRows: {},
    aDevices: {},
    midiPortSelect: {},
    modsRows: {},
    systemStartupReadinessRows: {}
  };
  for (const id of NON_LIVE_BUTTON_IDS) {
    el[id] = createButtonNode();
  }
  for (const [id, value] of Object.entries(buttonOverrides || {})) {
    el[id] = value;
  }

  const createSystemRuntimeUi = loadFactory(
    "public/assets/js/domains/system/system-runtime-ui.js",
    "createSystemRuntimeUi",
    {
      createSystemUiWiringAuditRuntimeUi: loadFactory(
        "public/assets/js/domains/system/system-ui-wiring-audit-runtime-ui.js",
        "createSystemUiWiringAuditRuntimeUi"
      ),
      createSystemOpsRuntimeUi() {
        return {
          renderSystemRouteCatalogOptions() {},
          loadSystemRouteCatalog: async () => true,
          applySystemRouteCatalogSelection: () => true,
          runSystemRouteConsoleRequest: async () => true,
          copySystemRouteConsoleResponse: async () => true,
          renderGatewayAndReconcileStatus() {},
          loadSystemInternetGatewayStatus: async () => true,
          loadSystemWidgetReconcileStatus: async () => true,
          runSystemWidgetReconcileNow: async () => true,
          copySystemWidgetReconcileResultJson: async () => true,
          renderSystemRustTransportWorkerStatus() {},
          loadSystemRustTransportWorkerStatus: async () => true,
          loadSystemRustTransportWorkerAdapters: async () => true,
          loadSystemRustTransportWorkerWatchdog: async () => true,
          saveSystemRustTransportWorkerConfig: async () => true,
          startSystemRustTransportWorker: async () => true,
          stopSystemRustTransportWorker: async () => true,
          restartSystemRustTransportWorker: async () => true,
          copySystemRustTransportWorkerJson: async () => true
        };
      },
      createSystemUpdateRuntimeUi() {
        return {
          normalizeBooleanSelectValue: (value, fallback = true) => {
            const token = String(value || "").trim().toLowerCase();
            if (!token) return fallback === true;
            return token === "true" || token === "1" || token === "yes" || token === "on";
          },
          renderSystemUpdateStatus() {},
          loadSystemUpdateStatus: async () => true,
          runSystemUpdateCheck: async () => true,
          applySystemUpdate: async () => true,
          openSystemUpdateReleasePage: () => true
        };
      },
      createSystemWidgetTemplateRuntimeUi() {
        return {
          setSystemWidgetTemplateStatus() {},
          toggleSystemWidgetSensitiveFieldsReveal() {},
          saveSystemWidgetTemplatePrefsToStorage() {},
          restoreSystemWidgetPrefsFromStorage() {},
          buildSystemWidgetTemplatePayload: () => ({}),
          buildSystemWidgetTwitchAuthorizeUrl: () => ({ ok: true, url: "https://www.twitch.tv/activate" }),
          openSystemWidgetOauthAuthorizeUrl: async () => true,
          copySystemWidgetOauthAuthorizeUrl: async () => true,
          loadSystemWidgetOauthSyncProfile: async () => true,
          syncSystemWidgetOauthToMod: async () => true,
          seedSystemWidgetOauthDevVaultFromUi: async () => true,
          clearSystemWidgetOauthDevVault: async () => true,
          describeSystemWidgetTemplateActiveParams: () => "baseline-only",
          generateSystemWidgetTemplate: async () => true,
          copySystemWidgetTemplate: async () => true
        };
      },
      createSystemStartupReadinessRuntimeUi() {
        return {
          renderSystemStartupReadinessUi: () => ({}),
          loadSystemStartupReadiness: async () => true,
          copySystemStartupReadinessDiagnosticsJson: async () => true
        };
      }
    }
  );

  const runtime = createSystemRuntimeUi({
    el,
    ui: {},
    windowRef,
    documentRef: {},
    navigatorRef: {},
    localStorageRef: createStorageStub(),
    setBadge(node, state, text) {
      if (!node) return;
      node.badge = { state, text };
    },
    applyLiveModeUiPolicy() {},
    normalizeApiBaseInput: value => String(value || "").trim(),
    confirmUnsafeSensitiveLogEnable: () => ({ ok: true, ack: "UNSAFE_LOGS_ACCEPTED" }),
    wipeUiBrowserMemory: async () => {},
    systemEndpointsAdapter: {
      getConfig: async () => ({ ok: true, config: {} }),
      getRouteCatalog: async () => ({ ok: true, routes: [] }),
      requestRoute: async () => ({ ok: true, status: 200, data: {}, raw: "{}" }),
      getInternetGatewayStatus: async () => ({ ok: true }),
      getUpdateStatus: async () => ({ ok: true }),
      checkForUpdates: async () => ({ ok: false, data: null }),
      applyUpdate: async () => ({ ok: false, data: null }),
      getSystemOauthStatus: async () => ({ ok: true, presence: {}, hasValues: false }),
      seedSystemOauthProfile: async () => ({ ok: false, data: null }),
      clearSystemOauthProfile: async () => ({ ok: false, data: null }),
      startSystemOauth: async () => ({ ok: false, data: null }),
      getSystemOauthDeviceStatus: async () => ({ ok: false, data: null }),
      disconnectSystemOauth: async () => ({ ok: false, data: null }),
      syncSystemOauthToMod: async () => ({ ok: false, data: null }),
      getWidgetRedemptionReconcileStatus: async () => ({ ok: true }),
      reconcileWidgetRedemptions: async () => ({ ok: false, data: null }),
      saveConfig: async () => ({ ok: false, data: null }),
      generateWidgetTemplate: async () => ({ ok: false, data: null })
    },
    audioEndpointsAdapter: {
      getRustTransportWorkerStatus: async () => ({ ok: true }),
      getRustTransportWorkerAdapters: async () => ({ ok: true }),
      getRustTransportWorkerWatchdog: async () => ({ ok: true }),
      setRustTransportWorkerConfig: async () => ({ ok: false, data: null }),
      startRustTransportWorker: async () => ({ ok: false, data: null }),
      stopRustTransportWorker: async () => ({ ok: false, data: null }),
      restartRustTransportWorker: async () => ({ ok: false, data: null })
    }
  });

  return { runtime, el, windowRef };
}

test("system runtime non-live wiring audit reports OK when required controls are wired", () => {
  const { runtime, windowRef, el } = createRuntimeForAudit();
  const summary = runtime.runSystemNonLiveUiWiringAudit();

  assert.equal(summary.ok, true);
  assert.equal(Array.isArray(summary.missingButtons), true);
  assert.equal(summary.missingButtons.length, 0);
  assert.equal(summary.unwiredButtons.length, 0);
  assert.equal(summary.missingCritical.length, 0);
  assert.equal(windowRef.__ravelinkNonLiveUiWiring?.ok, true);
  assert.equal(String(el.systemSettingsStatus.value || "").includes("NON-LIVE UI WIRED"), true);
});

test("system runtime non-live wiring audit reports failures for missing/unwired controls", () => {
  const { runtime, el } = createRuntimeForAudit({
    modApplyBtn: { onclick: null },
    modsReloadBtn: null
  });
  const summary = runtime.runSystemNonLiveUiWiringAudit();

  assert.equal(summary.ok, false);
  assert.equal(summary.unwiredButtons.includes("modApplyBtn"), true);
  assert.equal(summary.missingButtons.includes("modsReloadBtn"), true);
  assert.equal(el.health.badge?.state, "warn");
  assert.equal(String(el.systemSettingsStatus.value || "").includes("NON-LIVE UI WIRING WARN"), true);
});
