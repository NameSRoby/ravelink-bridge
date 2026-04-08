// [TITLE] Module: public/assets/js/domains/system/system-ui-wiring-audit-runtime-ui.js
// [TITLE] Purpose: non-live UI wiring audit helpers for the system domain
// [TITLE] Functionality Index:
// [TITLE] - required non-live button/critical-node inventories
// [TITLE] - runtime wiring audit used during bootstrap and module verification
// [DEV] Complex Flow:
// [DEV] Keep the wiring audit separate from general system settings so bootstrap
// [DEV] can verify non-live controls without re-growing the main runtime file.

function createSystemUiWiringAuditRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const windowRef = deps.windowRef || window;
  const setBadge = typeof deps.setBadge === "function" ? deps.setBadge : (() => {});
  const renderSystemSettingsStatus = typeof deps.renderSystemSettingsStatus === "function"
    ? deps.renderSystemSettingsStatus
    : (() => {});

  const NON_LIVE_UI_WIRING_BUTTON_IDS = Object.freeze([
    "fxSaveBtn",
    "fxResetBtn",
    "fxHueDiscoverBtn",
    "fxHuePairBtn",
    "fxHueSaveBridgeBtn",
    "fxWizManualGuideBtn",
    "fxWizDiscoverBtn",
    "fxWizUseSelectedBtn",
    "fxWizClearDiscoveryBtn",
    "standRouteApplyBtn",
    "standRefreshBtn",
    "standConnectivityBtn",
    "fixturesReloadBtn",
    "colorPrefixSaveBtn",
    "colorPrefixResetBtn",
    "aRefreshBtn",
    "aScanBtn",
    "aApplyBtn",
    "aRefreshAdvancedBtn",
    "aRestartBtn",
    "aResetDefaultsBtn",
    "aProfileSaveBtn",
    "aProfileLoadBtn",
    "aProfileDeleteBtn",
    "aAppsRefreshBtn",
    "aAppIsoManualSetBtn",
    "aAppIsoManualClearBtn",
    "aTuningModeEasyBtn",
    "aTuningModeAdvancedBtn",
    "aQuickTuneResetBtn",
    "aQuickTuneApplyBtn",
    "midiRefreshBtn",
    "midiSaveCfgBtn",
    "midiLearnArmBtn",
    "midiLearnCancelBtn",
    "midiTriggerBtn",
    "midiBindingSaveBtn",
    "midiBindingClearBtn",
    "midiBindingResetBtn",
    "modsRefreshBtn",
    "modsReloadBtn",
    "modsDebugToggleBtn",
    "modsDebugClearBtn",
    "modImportBrowseBtn",
    "modEnableBtn",
    "modDisableBtn",
    "modApplyBtn",
    "modDiscardBtn",
    "modActionRunBtn",
    "modUiRefreshBtn",
    "modUiReloadBtn",
    "modUiOpenBtn",
    "moddingReadmeBtn",
    "systemSettingsSaveBtn",
    "systemSettingsResetBtn",
    "systemUpdateCheckNowBtn",
    "systemUpdateOpenReleaseBtn",
    "systemUpdateApplyBtn",
    "systemPollNowBtn",
    "systemClearCacheBtn",
    "systemStartupReadinessRefreshBtn",
    "systemStartupReadinessCopyBtn",
    "systemRouteCatalogLoadBtn",
    "systemRouteCatalogApplyBtn",
    "systemRouteConsoleSendBtn",
    "systemRouteConsoleCopyBtn",
    "systemGatewayStatusRefreshBtn",
    "systemWidgetReconcileStatusRefreshBtn",
    "systemWidgetReconcileRunBtn",
    "systemWidgetReconcileCopyBtn",
    "systemRustWorkerStatusRefreshBtn",
    "systemRustWorkerAdaptersRefreshBtn",
    "systemRustWorkerWatchdogRefreshBtn",
    "systemRustWorkerConfigApplyBtn",
    "systemRustWorkerStartBtn",
    "systemRustWorkerStopBtn",
    "systemRustWorkerRestartBtn",
    "systemRustWorkerCopyBtn",
    "systemWidgetGenerateBtn",
    "systemWidgetCopyBtn",
    "systemWidgetOauthOpenBtn",
    "systemWidgetOauthCopyBtn",
    "systemWidgetSensitiveToggleBtn",
    "apiBaseSaveBtn",
    "apiBaseResetBtn"
  ]);
  const NON_LIVE_UI_WIRING_CRITICAL_IDS = Object.freeze([
    "fixtureRows",
    "aDevices",
    "midiPortSelect",
    "modsRows",
    "systemStartupReadinessRows"
  ]);

  function runSystemNonLiveUiWiringAudit() {
    const missingButtons = [];
    const unwiredButtons = [];
    const missingCritical = [];

    for (const id of NON_LIVE_UI_WIRING_BUTTON_IDS) {
      const node = el[id];
      if (!node) {
        missingButtons.push(id);
        continue;
      }
      if (typeof node.onclick !== "function") {
        unwiredButtons.push(id);
      }
    }

    for (const id of NON_LIVE_UI_WIRING_CRITICAL_IDS) {
      if (!el[id]) missingCritical.push(id);
    }

    const ok = missingButtons.length === 0 && unwiredButtons.length === 0 && missingCritical.length === 0;
    const summary = {
      ok,
      missingButtons,
      unwiredButtons,
      missingCritical,
      checkedButtons: NON_LIVE_UI_WIRING_BUTTON_IDS.length,
      checkedCritical: NON_LIVE_UI_WIRING_CRITICAL_IDS.length
    };
    ui.nonLiveUiWiringSummary = summary;
    windowRef.__ravelinkNonLiveUiWiring = summary;
    renderSystemSettingsStatus();

    if (!ok) {
      console.error("[UI][NON-LIVE] wiring audit failed:", summary);
      setBadge(el.health, "warn", "NON-LIVE UI WIRING FAIL");
      return summary;
    }

    console.log("[UI][NON-LIVE] wiring audit ok:", summary);
    return summary;
  }

  return { runSystemNonLiveUiWiringAudit };
}
