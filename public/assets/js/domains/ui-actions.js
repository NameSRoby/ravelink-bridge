// [TITLE] Module: public/assets/js/domains/ui-actions.js
// [TITLE] Purpose: top-level UI action bindings for API base, system controls, and mod UI actions
// [TITLE] Functionality Index:
// [TITLE] - API base save/reset action wiring
// [TITLE] - system settings/poll/cache action wiring
// [TITLE] - mod UI select/refresh/reload/open + modding docs action wiring
// [DEV] Complex Flow:
// [DEV] These handlers bridge multiple domain owners at interaction time.
// [DEV] Keep route payloads, badge messages, and reload/poll side-effects
// [DEV] behavior-identical when moving or editing these bindings.

if (el.apiBaseSaveBtn && el.apiBaseInput) {
  el.apiBaseSaveBtn.onclick = async () => {
    const nextBase = normalizeApiBaseInput(el.apiBaseInput.value);
    setApiBase(nextBase);
    setBadge(el.health, "ok", nextBase ? "API BASE SAVED" : "API BASE CLEARED");
    await poll({ force: true });
  };
}

if (el.apiBaseResetBtn) {
  el.apiBaseResetBtn.onclick = async () => {
    setApiBase(inferredApiBase);
    setBadge(el.health, "ok", "API BASE RESET");
    await poll({ force: true });
  };
}

if (el.systemSettingsSaveBtn) {
  el.systemSettingsSaveBtn.onclick = async () => {
    const { pollingChanged } = saveSystemSettingsFromUi();
    const savedServer = await saveSystemServerSettingsFromUi();
    if (!savedServer.ok) {
      setBadge(el.health, "warn", `SYSTEM SETTINGS SAVED (SERVER CONFIG FAIL: ${savedServer.error || "request failed"})`);
    } else {
      setBadge(el.health, "ok", "SYSTEM SETTINGS SAVED");
    }
    if (!ui.pollPaused) {
      await poll({ force: true });
    } else if (pollingChanged) {
      renderSystemSettingsStatus();
    }
  };
}

if (el.systemSettingsResetBtn) {
  el.systemSettingsResetBtn.onclick = async () => {
    resetSystemSettingsToDefaults();
    const savedServer = await saveSystemServerSettingsFromUi();
    setBadge(
      el.health,
      savedServer.ok ? "ok" : "warn",
      savedServer.ok ? "SYSTEM SETTINGS RESET" : `SYSTEM RESET (SERVER CONFIG FAIL: ${savedServer.error || "request failed"})`
    );
    await poll({ force: true });
  };
}

if (el.systemPollNowBtn) {
  el.systemPollNowBtn.onclick = async () => {
    await poll({ force: true });
    await loadSystemUpdateStatus({ announce: false, triggerStartupPrompt: false });
    await loadSystemStartupReadiness({ announce: false });
    await loadSystemInternetGatewayStatus({ announce: false });
    await loadSystemWidgetReconcileStatus({ announce: false });
    await loadSystemRustTransportWorkerStatus({ announce: false });
    setBadge(el.health, "ok", "MANUAL POLL COMPLETE");
  };
}

if (el.systemUpdateCheckNowBtn) {
  el.systemUpdateCheckNowBtn.onclick = () => {
    runSystemUpdateCheck({ announce: true, force: true }).catch(err => {
      const message = String(err?.message || err || "update check failed");
      setBadge(el.health, "warn", message.toUpperCase());
    });
  };
}

if (el.systemUpdateOpenReleaseBtn) {
  el.systemUpdateOpenReleaseBtn.onclick = () => {
    const opened = openSystemUpdateReleasePage();
    if (!opened) {
      setBadge(el.health, "warn", "NO RELEASE LINK AVAILABLE");
      return;
    }
    setBadge(el.health, "ok", "RELEASE PAGE OPENED");
  };
}

if (el.systemUpdateApplyBtn) {
  el.systemUpdateApplyBtn.onclick = () => {
    const proceed = window.confirm(
      "Apply latest release files in-place now?\n\n" +
      "This keeps your runtime settings and makes a backup snapshot.\n" +
      "Server restart is required after apply."
    );
    if (!proceed) return;
    applySystemUpdate({ announce: true, forceCheck: true }).catch(err => {
      const message = String(err?.message || err || "update apply failed");
      setBadge(el.health, "warn", message.toUpperCase());
    });
  };
}

if (el.systemStartupReadinessRefreshBtn) {
  el.systemStartupReadinessRefreshBtn.onclick = async () => {
    const ok = await loadSystemStartupReadiness({ announce: true });
    if (!ok) return;
    setBadge(el.health, "ok", "STARTUP READINESS REFRESHED");
  };
}

if (el.systemStartupReadinessCopyBtn) {
  el.systemStartupReadinessCopyBtn.onclick = () => {
    copySystemStartupReadinessDiagnosticsJson().catch(err => {
      const message = String(err?.message || err || "readiness diagnostics copy failed");
      setBadge(el.health, "warn", message.toUpperCase());
    });
  };
}

if (el.systemRouteCatalogLoadBtn) {
  el.systemRouteCatalogLoadBtn.onclick = async () => {
    const ok = await loadSystemRouteCatalog({ announce: true });
    if (!ok) return;
    setBadge(el.health, "ok", "ROUTE CATALOG REFRESHED");
  };
}

if (el.systemRouteCatalogSelect) {
  el.systemRouteCatalogSelect.onchange = () => {
    const token = String(el.systemRouteCatalogSelect.value || "").trim();
    if (!token) return;
    applySystemRouteCatalogSelection();
  };
}

if (el.systemRouteCatalogApplyBtn) {
  el.systemRouteCatalogApplyBtn.onclick = () => {
    const ok = applySystemRouteCatalogSelection();
    if (!ok) {
      setBadge(el.health, "warn", "SELECT ROUTE FIRST");
      return;
    }
    setBadge(el.health, "ok", "ROUTE APPLIED");
  };
}

if (el.systemRouteConsoleSendBtn) {
  el.systemRouteConsoleSendBtn.onclick = () => {
    runSystemRouteConsoleRequest({ announce: true }).catch(err => {
      const message = String(err?.message || err || "route request failed");
      if (el.systemRouteConsoleStatus) el.systemRouteConsoleStatus.value = message;
      setBadge(el.health, "warn", "ROUTE REQUEST FAILED");
    });
  };
}

if (el.systemRouteConsoleCopyBtn) {
  el.systemRouteConsoleCopyBtn.onclick = () => {
    copySystemRouteConsoleResponse().catch(err => {
      const message = String(err?.message || err || "route response copy failed");
      if (el.systemRouteConsoleStatus) el.systemRouteConsoleStatus.value = message;
      setBadge(el.health, "warn", "ROUTE COPY FAILED");
    });
  };
}

if (el.systemGatewayStatusRefreshBtn) {
  el.systemGatewayStatusRefreshBtn.onclick = async () => {
    const ok = await loadSystemInternetGatewayStatus({ announce: true });
    if (!ok) return;
    setBadge(el.health, "ok", "SAFE INTERNET STATUS REFRESHED");
  };
}

if (el.systemWidgetReconcileStatusRefreshBtn) {
  el.systemWidgetReconcileStatusRefreshBtn.onclick = async () => {
    const ok = await loadSystemWidgetReconcileStatus({ announce: true });
    if (!ok) return;
    setBadge(el.health, "ok", "TWITCH REDEMPTION SYNC REFRESHED");
  };
}

if (el.systemWidgetReconcileRunBtn) {
  el.systemWidgetReconcileRunBtn.onclick = () => {
    runSystemWidgetReconcileNow({ announce: true }).catch(err => {
      const message = String(err?.message || err || "reconcile failed");
      if (el.systemGatewayStatusText) el.systemGatewayStatusText.value = message;
      setBadge(el.health, "warn", "TWITCH REDEMPTION SYNC FAILED");
    });
  };
}

if (el.systemWidgetReconcileCopyBtn) {
  el.systemWidgetReconcileCopyBtn.onclick = () => {
    copySystemWidgetReconcileResultJson().catch(err => {
      const message = String(err?.message || err || "reconcile copy failed");
      if (el.systemGatewayStatusText) el.systemGatewayStatusText.value = message;
      setBadge(el.health, "warn", "RECONCILE COPY FAILED");
    });
  };
}

if (el.systemRustWorkerStatusRefreshBtn) {
  el.systemRustWorkerStatusRefreshBtn.onclick = async () => {
    const ok = await loadSystemRustTransportWorkerStatus({ announce: true });
    if (!ok) return;
    setBadge(el.health, "ok", "RUST WORKER STATUS REFRESHED");
  };
}

if (el.systemRustWorkerAdaptersRefreshBtn) {
  el.systemRustWorkerAdaptersRefreshBtn.onclick = () => {
    loadSystemRustTransportWorkerAdapters({ announce: true, refresh: true }).catch(err => {
      const message = String(err?.message || err || "rust adapter refresh failed");
      if (el.systemRustWorkerStatusText) el.systemRustWorkerStatusText.value = message;
      setBadge(el.health, "warn", "RUST ADAPTER REFRESH FAILED");
    });
  };
}

if (el.systemRustWorkerWatchdogRefreshBtn) {
  el.systemRustWorkerWatchdogRefreshBtn.onclick = () => {
    loadSystemRustTransportWorkerWatchdog({ announce: true, refresh: true }).catch(err => {
      const message = String(err?.message || err || "rust watchdog refresh failed");
      if (el.systemRustWorkerStatusText) el.systemRustWorkerStatusText.value = message;
      setBadge(el.health, "warn", "RUST WATCHDOG REFRESH FAILED");
    });
  };
}

if (el.systemRustWorkerConfigApplyBtn) {
  el.systemRustWorkerConfigApplyBtn.onclick = () => {
    saveSystemRustTransportWorkerConfig({ announce: true }).catch(err => {
      const message = String(err?.message || err || "rust worker config failed");
      if (el.systemRustWorkerStatusText) el.systemRustWorkerStatusText.value = message;
      setBadge(el.health, "warn", "RUST WORKER CONFIG FAILED");
    });
  };
}

if (el.systemRustWorkerStartBtn) {
  el.systemRustWorkerStartBtn.onclick = () => {
    startSystemRustTransportWorker({ announce: true }).catch(err => {
      const message = String(err?.message || err || "rust worker start failed");
      if (el.systemRustWorkerStatusText) el.systemRustWorkerStatusText.value = message;
      setBadge(el.health, "warn", "RUST WORKER START FAILED");
    });
  };
}

if (el.systemRustWorkerStopBtn) {
  el.systemRustWorkerStopBtn.onclick = () => {
    stopSystemRustTransportWorker({ announce: true }).catch(err => {
      const message = String(err?.message || err || "rust worker stop failed");
      if (el.systemRustWorkerStatusText) el.systemRustWorkerStatusText.value = message;
      setBadge(el.health, "warn", "RUST WORKER STOP FAILED");
    });
  };
}

if (el.systemRustWorkerRestartBtn) {
  el.systemRustWorkerRestartBtn.onclick = () => {
    restartSystemRustTransportWorker({ announce: true }).catch(err => {
      const message = String(err?.message || err || "rust worker restart failed");
      if (el.systemRustWorkerStatusText) el.systemRustWorkerStatusText.value = message;
      setBadge(el.health, "warn", "RUST WORKER RESTART FAILED");
    });
  };
}

if (el.systemRustWorkerCopyBtn) {
  el.systemRustWorkerCopyBtn.onclick = () => {
    copySystemRustTransportWorkerJson().catch(err => {
      const message = String(err?.message || err || "rust worker copy failed");
      if (el.systemRustWorkerStatusText) el.systemRustWorkerStatusText.value = message;
      setBadge(el.health, "warn", "RUST WORKER COPY FAILED");
    });
  };
}

if (el.systemClearCacheBtn) {
  el.systemClearCacheBtn.onclick = async () => {
    const proceed = window.confirm("Clear UI local/session/cache memory and reload now?");
    if (!proceed) return;
    try {
      await clearUiLocalCache();
    } finally {
      window.location.reload();
    }
  };
}

if (el.systemWidgetGenerateBtn) {
  el.systemWidgetGenerateBtn.onclick = () => {
    generateSystemWidgetTemplate().catch(err => {
      const message = String(err?.message || err || "widget generation failed");
      setSystemWidgetTemplateStatus(message);
      setBadge(el.health, "warn", "SYSTEM WIDGET GENERATOR FAILED");
    });
  };
}

if (el.systemWidgetCopyBtn) {
  el.systemWidgetCopyBtn.onclick = () => {
    copySystemWidgetTemplate().catch(err => {
      const message = String(err?.message || err || "widget copy failed");
      setSystemWidgetTemplateStatus(message);
      setBadge(el.health, "warn", "WIDGET COPY FAILED");
    });
  };
}

if (el.systemWidgetOauthOpenBtn) {
  el.systemWidgetOauthOpenBtn.onclick = () => {
    openSystemWidgetOauthAuthorizeUrl().catch(err => {
      const message = String(err?.message || err || "activation page open failed");
      setSystemWidgetTemplateStatus(message);
      setBadge(el.health, "warn", "TWITCH OAUTH OPEN FAILED");
    });
  };
}

if (el.systemWidgetOauthCopyBtn) {
  el.systemWidgetOauthCopyBtn.onclick = () => {
    copySystemWidgetOauthAuthorizeUrl().catch(err => {
      const message = String(err?.message || err || "activation link copy failed");
      setSystemWidgetTemplateStatus(message);
      setBadge(el.health, "warn", "TWITCH OAUTH COPY FAILED");
    });
  };
}

if (el.systemWidgetOauthSeedBtn) {
  el.systemWidgetOauthSeedBtn.onclick = () => {
    seedSystemWidgetOauthDevVaultFromUi().catch(err => {
      const message = String(err?.message || err || "oauth seed failed");
      setSystemWidgetTemplateStatus(message);
      setBadge(el.health, "warn", "DEV OAUTH SEED FAILED");
    });
  };
}

if (el.systemWidgetOauthClearBtn) {
  el.systemWidgetOauthClearBtn.onclick = () => {
    clearSystemWidgetOauthDevVault().catch(err => {
      const message = String(err?.message || err || "oauth clear failed");
      setSystemWidgetTemplateStatus(message);
      setBadge(el.health, "warn", "DEV OAUTH CLEAR FAILED");
    });
  };
}

if (el.systemWidgetOauthSyncToModBtn) {
  el.systemWidgetOauthSyncToModBtn.onclick = () => {
    syncSystemWidgetOauthToMod().catch(err => {
      const message = String(err?.message || err || "oauth sync failed");
      setSystemWidgetTemplateStatus(message);
      setBadge(el.health, "warn", "OAUTH SYNC FAILED");
    });
  };
}

if (el.systemWidgetSensitiveToggleBtn) {
  el.systemWidgetSensitiveToggleBtn.onclick = () => {
    toggleSystemWidgetSensitiveFieldsReveal();
  };
}

[
  el.systemWidgetColorRewardId,
  el.systemWidgetBundleMode,
  el.systemWidgetDockModOauth,
  el.systemWidgetTeachRewardId,
  el.systemWidgetRaveRewardId,
  el.systemWidgetBaseUrl,
  el.systemWidgetRaveAutoOffSec,
  el.systemWidgetEnableStatusSync,
  el.systemWidgetSeBotEnabled,
  el.systemWidgetSeBotChannelId,
  el.systemWidgetSeBotJwt,
  el.systemWidgetSeBotPrefix,
  el.systemWidgetTwitchClientId,
  el.systemWidgetTwitchUserAccessToken,
  el.systemWidgetTwitchBroadcasterId,
  el.systemWidgetRaveOffAnnounceEnabled,
  el.systemWidgetRaveOffAnnounceMessage,
  el.systemWidgetBlockedMessage
].forEach(node => {
  if (!node) return;
  node.addEventListener("input", saveSystemWidgetTemplatePrefsToStorage);
  node.addEventListener("change", saveSystemWidgetTemplatePrefsToStorage);
});

if (el.modUiSelect) {
  el.modUiSelect.onchange = () => {
    ui.modUiSelectedId = normalizeModUiId(el.modUiSelect.value);
    syncModUiSelectionToHotswapTarget({ force: true });
    if (ui.modUiSelectedId) {
      localStorage.setItem(MOD_UI_SELECTED_KEY, ui.modUiSelectedId);
      if (ui.activeTab === "mods" || (typeof isModUiTabName === "function" && isModUiTabName(ui.activeTab))) {
        showTab(typeof buildModUiTabName === "function" ? buildModUiTabName(ui.modUiSelectedId) : "mods");
      }
    } else {
      localStorage.removeItem(MOD_UI_SELECTED_KEY);
      if (typeof isModUiTabName === "function" && isModUiTabName(ui.activeTab)) {
        showTab("mods");
      }
    }
    renderModUiFrame({ forceReload: true });
  };
}

if (el.modUiRefreshBtn) {
  el.modUiRefreshBtn.onclick = async () => {
    const ok = await refreshModUiCatalog({ preferRemote: true, forceReload: true, persist: true });
    setBadge(el.health, ok ? "ok" : "bad", ok ? "MOD UI CATALOG REFRESHED" : "MOD UI CATALOG FAIL");
  };
}

if (el.modUiReloadBtn) {
  el.modUiReloadBtn.onclick = () => {
    const descriptor = getSelectedModUiDescriptor();
    if (!descriptor || !descriptor.loaded || !descriptor.url) {
      setBadge(el.health, "warn", "SELECT A LOADED MOD UI FIRST");
      return;
    }
    const tabName = typeof buildModUiTabName === "function" ? buildModUiTabName(descriptor.id) : "mods";
    showTab(tabName || "mods");
    renderModUiFrame({ forceReload: true });
    setBadge(el.health, "ok", "MOD UI TAB OPENED");
  };
}

if (el.modUiOpenBtn) {
  el.modUiOpenBtn.onclick = () => {
    const descriptor = getSelectedModUiDescriptor();
    if (!descriptor || !descriptor.loaded || !descriptor.url) {
      setBadge(el.health, "warn", "SELECT A LOADED MOD UI FIRST");
      return;
    }
    window.open(withBase(descriptor.url), "_blank", "noopener");
  };
}

if (el.moddingReadmeBtn) {
  el.moddingReadmeBtn.onclick = () => {
    const proceed = window.confirm(
      "You are about to open developer modding documentation in a separate page.\n\nContinue?"
    );
    if (!proceed) return;
    window.open(withBase("/modding-readme.html"), "_blank", "noopener");
  };
}

