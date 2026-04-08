// [TITLE] Module: public/assets/js/bootstrap.js
// [TITLE] Purpose: startup bootstrap shell for UI initialization order
// [TITLE] Functionality Index:
// [TITLE] - deterministic UI startup sequencing
// [TITLE] - async palette metadata + config warmup
// [TITLE] - poll/monitor loop kickoff

// [DEV] Startup sequence is intentionally centralized here.
// [DEV] This keeps behavior order explicit while allowing app.js to be split into
// [DEV] domain modules without mixing execution side effects with definitions.
void (async () => {
  const bootSummary = {
    startedAt: Date.now(),
    completedAt: null,
    ok: false,
    steps: [],
    failed: [],
    skipped: []
  };
  const bootSummaryTarget = typeof window !== "undefined"
    ? window
    : (typeof globalThis !== "undefined" ? globalThis : null);
  if (bootSummaryTarget) bootSummaryTarget.__ravelinkBootSummary = bootSummary;

  function bootFailureMessage(err) {
    return String(err?.message || err || "unknown_boot_error");
  }

  function recordBootStep(label, status, detail = {}) {
    const entry = {
      label,
      status,
      optional: Boolean(detail.optional)
    };
    if (detail.error) entry.error = String(detail.error);
    bootSummary.steps.push(entry);
    if (status === "failed") bootSummary.failed.push(entry);
    if (status === "skipped") bootSummary.skipped.push(entry);
    return entry;
  }

  function finishBootSummary(fatalErr = null) {
    if (fatalErr) bootSummary.fatal = bootFailureMessage(fatalErr);
    bootSummary.completedAt = Date.now();
    bootSummary.ok = !bootSummary.fatal && !bootSummary.failed.some(entry => !entry.optional);
    return bootSummary;
  }

  async function runBootStep(label, fn, options = {}) {
    const timeoutMs = Math.max(250, Number(options.timeoutMs) || 5000);
    const optional = Boolean(options.optional);
    let timeoutId = null;
    try {
      const task = Promise.resolve().then(fn);
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs);
      });
      const result = await Promise.race([task, timeout]);
      recordBootStep(label, "ok", { optional });
      return result;
    } catch (err) {
      recordBootStep(label, "failed", {
        optional,
        error: bootFailureMessage(err)
      });
      console.debug(`[BOOT][DEBUG] ${label} failed:`, err?.message || err);
      return null;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  async function runOptionalBootStep(label, fn, options = {}) {
    if (typeof fn !== "function") {
      recordBootStep(label, "skipped", { optional: true });
      console.debug(`[BOOT][DEBUG] ${label} skipped: unavailable`);
      return null;
    }
    return runBootStep(label, fn, { ...options, optional: true });
  }

  try {
    const normalizeStartTab = typeof normalizeStartTabPreference === "function"
      ? normalizeStartTabPreference
      : (value => String(value || "live").trim().toLowerCase() || "live");
    ui.startTabPreference = normalizeStartTab(ui.startTabPreference);
    ui.activeTab = normalizeStartTab(ui.startTabPreference);

    if (typeof applySystemSettingsUi === "function") applySystemSettingsUi();
    if (typeof restoreSystemWidgetPrefsFromStorage === "function") restoreSystemWidgetPrefsFromStorage();
    if (typeof loadSystemWidgetOauthSyncProfile === "function") {
      loadSystemWidgetOauthSyncProfile({ announce: false, overwriteExisting: false }).catch(err => {
        console.debug("[BOOT][DEBUG] loadSystemWidgetOauthSyncProfile failed:", err?.message || err);
      });
    }
    await runOptionalBootStep("loadSystemServerConfig", () => loadSystemServerConfig(), { timeoutMs: 5000 });
    if (typeof loadSystemRouteCatalog === "function") {
      loadSystemRouteCatalog({ announce: false }).catch(err => {
        console.debug("[BOOT][DEBUG] loadSystemRouteCatalog failed:", err?.message || err);
      });
    }
    if (typeof loadSystemUpdateStatus === "function") {
      loadSystemUpdateStatus({ announce: false, triggerStartupPrompt: true }).catch(err => {
        console.debug("[BOOT][DEBUG] loadSystemUpdateStatus failed:", err?.message || err);
      });
    }
    if (typeof loadSystemStartupReadiness === "function") {
      loadSystemStartupReadiness({ announce: false }).catch(err => {
        console.debug("[BOOT][DEBUG] loadSystemStartupReadiness failed:", err?.message || err);
      });
    }
    if (typeof loadSystemInternetGatewayStatus === "function") {
      loadSystemInternetGatewayStatus({ announce: false }).catch(err => {
        console.debug("[BOOT][DEBUG] loadSystemInternetGatewayStatus failed:", err?.message || err);
      });
    }
    if (typeof loadSystemWidgetReconcileStatus === "function") {
      loadSystemWidgetReconcileStatus({ announce: false }).catch(err => {
        console.debug("[BOOT][DEBUG] loadSystemWidgetReconcileStatus failed:", err?.message || err);
      });
    }
    if (typeof loadSystemRustTransportWorkerStatus === "function") {
      loadSystemRustTransportWorkerStatus({ announce: false }).catch(err => {
        console.debug("[BOOT][DEBUG] loadSystemRustTransportWorkerStatus failed:", err?.message || err);
      });
    }
    if (typeof applyApiBaseUi === "function") applyApiBaseUi();
    if (typeof applyFlowIntensityUi === "function") applyFlowIntensityUi();
    if (typeof applyAudioReactivityMapToUi === "function" && typeof AUDIO_REACTIVITY_MAP_DEFAULT !== "undefined") {
      applyAudioReactivityMapToUi(AUDIO_REACTIVITY_MAP_DEFAULT, { markDirty: false });
    }
    await runBootStep("hydrateLiveModePolicyUi", () => hydrateLiveModePolicyUi({ silent: true }), { timeoutMs: 4000 });
    await runBootStep("bootLiveControlsUi", () => bootLiveControlsUi(), { timeoutMs: 3500 });
    await runBootStep("initThemeSettings", () => initThemeSettings(), { timeoutMs: 3500 });
    await runBootStep("initObsDockMode", () => initObsDockMode(), { timeoutMs: 2500 });
    if (typeof initCollapsiblePanels === "function") initCollapsiblePanels();
    if (typeof applyUiTooltips === "function") applyUiTooltips();
    if (typeof initLiveProfileControls === "function") initLiveProfileControls();
    if (el.modActionModId) el.modActionModId.value = "hello-mod";
    if (el.modActionName) el.modActionName.value = "status";
    if (typeof resetFixtureForm === "function") resetFixtureForm();
    if (typeof showTab === "function") showTab(ui.activeTab);
    if (typeof sync === "function") sync();
    if (typeof initOnboardingGate === "function") initOnboardingGate();
    if (typeof initHueEntGuideGate === "function") initHueEntGuideGate();

    const profilesOnlyLiveMode = typeof isLiveProfilesOnlyModeUi === "function" && isLiveProfilesOnlyModeUi();
    if (!profilesOnlyLiveMode) {
      try {
        await loadPaletteConfig();
      } catch (err) {
        console.debug("[BOOT][DEBUG] loadPaletteConfig failed:", err?.message || err);
      }
      try {
        await loadLiveSceneSnapshot({ silent: true, attempts: 6, retryDelayMs: 260 });
      } catch (err) {
        console.debug("[BOOT][DEBUG] loadLiveSceneSnapshot failed:", err?.message || err);
      }
    }
    if (typeof applyUiTooltips === "function") applyUiTooltips();
    if (typeof sync === "function") sync();
    if (typeof pollLoop === "function") pollLoop();

    if (typeof syncAudioQuickPresetButtons === "function") syncAudioQuickPresetButtons();
    await runBootStep("hydrateAudioStartupDataUi", () => hydrateAudioStartupDataUi(), { timeoutMs: 12000 });
    if (typeof loadAudioReactivityMap === "function") loadAudioReactivityMap();
    if (typeof loadAudioOptionalToolsStatus === "function") loadAudioOptionalToolsStatus();
    if (typeof loadMidiStatus === "function") loadMidiStatus();
    await runOptionalBootStep("refreshFixturesFromServer", () => refreshFixturesFromServer({ attempts: 5 }), { timeoutMs: 6000 });
    setTimeout(() => {
      if (typeof refreshFixturesFromServer !== "function") return;
      refreshFixturesFromServer({ attempts: 5 }).catch(err => {
        console.debug("[BOOT][DEBUG] refreshFixturesFromServer(delayed) failed:", err?.message || err);
      });
    }, 1800);
    const modsBootLoaded = await runOptionalBootStep("loadModsInitial", () => loadMods(), { timeoutMs: 7000 });
    if (!modsBootLoaded) {
      const retryDelaysMs = [900, 2200, 5000];
      retryDelaysMs.forEach(delayMs => {
        setTimeout(() => {
          if (typeof loadMods !== "function") return;
          loadMods().catch(err => {
            console.debug("[BOOT][DEBUG] loadMods retry failed:", err?.message || err);
          });
        }, delayMs);
      });
    }
    if (typeof loadColorPrefixConfig === "function") loadColorPrefixConfig();
    await runOptionalBootStep("runSystemNonLiveUiWiringAudit", () => runSystemNonLiveUiWiringAudit(), { timeoutMs: 2500 });
    if (typeof updateMainScopeInput === "function") updateMainScopeInput(
      { energy: 0.05, rms: 0.03, drop: false },
      { level: 0.03, transient: 0, spectralFlux: 0, bandLow: 0, bandMid: 0, bandHigh: 0 }
    );
    if (typeof updateScopeHud === "function") updateScopeHud(
      { energy: 0.05, rms: 0.03, drop: false, scene: "-", behavior: "-" },
      { level: 0.03, transient: 0, spectralFlux: 0, bandLow: 0, bandMid: 0, bandHigh: 0 }
    );
    if (typeof updateMonitorRenderingState === "function") updateMonitorRenderingState();
    if (typeof sync === "function") sync();
    finishBootSummary();
  } catch (err) {
    finishBootSummary(err);
    console.debug("[BOOT][DEBUG] bootstrap fatal catch:", err?.message || err);
  }
})();
