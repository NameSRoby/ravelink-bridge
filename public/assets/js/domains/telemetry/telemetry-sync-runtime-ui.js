// [TITLE] Module: public/assets/js/domains/telemetry/telemetry-sync-runtime-ui.js
// [TITLE] Purpose: telemetry-driven LIVE sync runtime fan-out ownership
// [TITLE] Functionality Index:
// [TITLE] - power/meta/cadence status sync
// [TITLE] - overclock/dev/debug button state sync
// [TITLE] - scene lock/candidate/active status sync
// [DEV] Complex Flow:
// [DEV] This runtime is intentionally pure UI fan-out so sync behavior can evolve
// [DEV] without touching telemetry poll/monitor scheduling code.

function createTelemetrySyncRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const sceneButtons = Array.isArray(deps.sceneButtons) ? deps.sceneButtons : [];
  const audioQuickPresetButtons = Array.isArray(deps.audioQuickPresetButtons) ? deps.audioQuickPresetButtons : [];
  const limiterPresetButtons = Array.isArray(deps.limiterPresetButtons) ? deps.limiterPresetButtons : [];
  const normalizeLiveSceneTokenUi = typeof deps.normalizeLiveSceneTokenUi === "function"
    ? deps.normalizeLiveSceneTokenUi
    : (value => String(value || "").trim().toLowerCase());
  const formatLiveHzUi = typeof deps.formatLiveHzUi === "function"
    ? deps.formatLiveHzUi
    : (value => String(Number(value) || ""));
  const resolveLiveEffectiveHzUi = typeof deps.resolveLiveEffectiveHzUi === "function"
    ? deps.resolveLiveEffectiveHzUi
    : (() => 2);
  const applyLiveModeUiPolicy = typeof deps.applyLiveModeUiPolicy === "function"
    ? deps.applyLiveModeUiPolicy
    : (() => {});
  const syncPaletteUiStateFromRuntime = typeof deps.syncPaletteUiStateFromRuntime === "function"
    ? deps.syncPaletteUiStateFromRuntime
    : (() => {});
  const updateAudioReactivityPolicyUi = typeof deps.updateAudioReactivityPolicyUi === "function"
    ? deps.updateAudioReactivityPolicyUi
    : (() => {});
  const normalizeMetaAutoTempoTrackersUi = typeof deps.normalizeMetaAutoTempoTrackersUi === "function"
    ? deps.normalizeMetaAutoTempoTrackersUi
    : (value => ({
      baseline: value?.baseline !== false,
      peaks: value?.peaks !== false,
      transients: value?.transients !== false,
      flux: value?.flux !== false
    }));
  const defaultMetaAutoTempoTrackers = deps.defaultMetaAutoTempoTrackers && typeof deps.defaultMetaAutoTempoTrackers === "object"
    ? deps.defaultMetaAutoTempoTrackers
    : { baseline: true, peaks: true, transients: true, flux: true };

  function syncLivePowerUi() {
    if (el.onBtn) el.onBtn.classList.toggle("active", ui.raveOn);
    if (el.offBtn) el.offBtn.classList.toggle("active", !ui.raveOn);
  }

  function syncMetaAutoStatusUi() {
    applyLiveModeUiPolicy();

    const metaTempoTrackers = normalizeMetaAutoTempoTrackersUi(ui.metaAutoTempoTrackers, defaultMetaAutoTempoTrackers);
    const metaTempoTrackersActive = normalizeMetaAutoTempoTrackersUi(ui.metaAutoTempoTrackersActive, metaTempoTrackers);
    ui.metaAutoTempoTrackers = { ...metaTempoTrackers };
    ui.metaAutoTempoTrackersActive = { ...metaTempoTrackersActive };
    ui.metaAutoHueWizBaselineBlend = metaTempoTrackers.baseline === true;

    const metaGenreLabel = String(ui.metaAutoGenre || "auto").toUpperCase();
    const metaReasonLabel = String(ui.metaAutoReason || "").toUpperCase();
    const metaHzNum = Number(ui.metaAutoHz);
    const metaHzFormatted = formatLiveHzUi(metaHzNum);
    const metaHzLabel = metaHzFormatted ? `${metaHzFormatted}HZ` : "";
    if (el.metaAutoStat) {
      el.metaAutoStat.textContent = ui.metaAutoEnabled
        ? `ON ${metaGenreLabel}${metaReasonLabel ? ` ${metaReasonLabel}` : ""}${metaHzLabel ? ` ${metaHzLabel}` : ""}`.trim()
        : "OFF";
    }
    if (el.flowStat) {
      const sceneToken = String(ui.sceneLock || "auto").trim().toLowerCase();
      el.flowStat.textContent = sceneToken === "auto" ? "SCENE-AUTO" : "SCENE-OWNED";
    }
  }

  function syncAudioPresetButtonsUi() {
    for (const btn of audioQuickPresetButtons) {
      btn.classList.toggle("active", btn.dataset.audioQuick === ui.audioQuickProfile);
    }
    for (const btn of limiterPresetButtons) {
      btn.classList.toggle("active", btn.dataset.limiterPreset === ui.limiterPreset);
    }
  }

  function syncOverclockButtonsUi() {
    if (el.ocAutoBtn) {
      el.ocAutoBtn.classList.toggle("active", Boolean(ui.cadenceAutoEnabled || ui.metaAutoEnabled));
      const source = String(ui.cadenceAutoSource || (ui.metaAutoEnabled ? "meta_auto" : "manual")).trim().toUpperCase() || "MANUAL";
      const requestedHz = Number(ui.cadenceAutoRequestedHz);
      const appliedHz = Number(ui.cadenceAutoAppliedHz);
      const requestedLabel = Number.isFinite(requestedHz) && requestedHz > 0
        ? ` | REQ ${formatLiveHzUi(requestedHz)}HZ`
        : "";
      const appliedLabel = Number.isFinite(appliedHz) && appliedHz > 0
        ? ` | APPLIED ${formatLiveHzUi(appliedHz)}HZ`
        : "";
      const guardReason = String(ui.cadenceAutoGuardReason || "none").trim().toLowerCase() || "none";
      const guardLabel = Boolean(ui.cadenceAutoGuarded) || guardReason !== "none"
        ? ` | GUARD ${guardReason.toUpperCase()}`
        : "";
      el.ocAutoBtn.title = `AUTO HZ (${source})${requestedLabel}${appliedLabel}${guardLabel}`;

      const resolvedHzCandidates = [
        Number(ui.cadenceAutoAppliedHz),
        Number(ui.cadenceAutoRequestedHz),
        Number(ui.metaAutoHz),
        Number(ui.overclockAutoHz),
        Number(resolveLiveEffectiveHzUi())
      ];
      const effectiveHz = resolvedHzCandidates.find(value => Number.isFinite(value) && value > 0) || 2;
      const showLiveHz = Number.isFinite(effectiveHz) && effectiveHz > 0;
      const requestedVsAppliedVisible = Number.isFinite(requestedHz) &&
        Number.isFinite(appliedHz) &&
        requestedHz > 0 &&
        appliedHz > 0 &&
        Math.abs(requestedHz - appliedHz) >= 0.05;
      el.ocAutoBtn.textContent = showLiveHz
        ? (requestedVsAppliedVisible
          ? `AUTO HZ ${formatLiveHzUi(appliedHz)}HZ`
          : `AUTO HZ ${formatLiveHzUi(effectiveHz)}HZ`)
        : "AUTO HZ";
    }

    const overclockManualActive = !Boolean(ui.cadenceAutoEnabled || ui.metaAutoEnabled);
    if (el.ocLudicrousBtn) el.ocLudicrousBtn.classList.toggle("active", overclockManualActive && ui.overclockLevel === 7);
    if (el.ocHyperBtn) el.ocHyperBtn.classList.toggle("active", overclockManualActive && ui.overclockLevel === 6);
    if (el.ocInsaneBtn) el.ocInsaneBtn.classList.toggle("active", overclockManualActive && ui.overclockLevel === 5);
    if (el.ocExtremeBtn) el.ocExtremeBtn.classList.toggle("active", overclockManualActive && ui.overclockLevel === 4);
    if (el.ocUltraBtn) el.ocUltraBtn.classList.toggle("active", overclockManualActive && ui.overclockLevel === 3);
    if (el.ocTurboBtn) el.ocTurboBtn.classList.toggle("active", overclockManualActive && ui.overclockLevel === 2);
    if (el.ocOnBtn) el.ocOnBtn.classList.toggle("active", overclockManualActive && ui.overclockLevel === 1);
    if (el.ocOffBtn) el.ocOffBtn.classList.toggle("active", overclockManualActive && ui.overclockLevel === 0);

    if (el.ocDev20Btn) el.ocDev20Btn.classList.toggle("active", overclockManualActive && ui.overclockLevel === 8);
    if (el.ocDev30Btn) el.ocDev30Btn.classList.toggle("active", overclockManualActive && ui.overclockLevel === 9);
    if (el.ocDev40Btn) el.ocDev40Btn.classList.toggle("active", overclockManualActive && ui.overclockLevel === 10);
    if (el.ocDev50Btn) el.ocDev50Btn.classList.toggle("active", overclockManualActive && ui.overclockLevel === 11);
    if (el.ocDev60Btn) el.ocDev60Btn.classList.toggle("active", overclockManualActive && ui.overclockLevel === 12);
  }

  function syncDebugControlsUi() {
    if (el.ocDevCluster) {
      el.ocDevCluster.classList.toggle("hidden", !ui.devDebugMode);
    }
    if (el.devToolsPanel) {
      el.devToolsPanel.classList.toggle("hidden", !ui.devDebugMode);
    }
    if (el.devDebugToggleBtn) {
      el.devDebugToggleBtn.classList.toggle("active", ui.devDebugMode);
    }
  }

  function syncSceneButtonsUi() {
    for (const btn of sceneButtons) {
      const scene = normalizeLiveSceneTokenUi(btn.dataset.scene, "");
      const currentLock = normalizeLiveSceneTokenUi(ui.sceneLock, "auto");
      const activeSceneToken = normalizeLiveSceneTokenUi(ui.activeSceneToken, "");
      const isManualActive = scene === currentLock;
      const isDerivedActive = currentLock === "auto" && scene !== "auto" && scene === activeSceneToken;
      btn.classList.toggle("active", isManualActive);
      btn.classList.toggle("activeLive", isDerivedActive);
    }
  }

  function syncSceneStatusUi() {
    ui.brightnessPowerMode = "b";
    const sceneStandalone = String(ui.sceneSyncStrategy || "independent").trim().toLowerCase() === "independent";

    syncPaletteUiStateFromRuntime();

    const currentLock = normalizeLiveSceneTokenUi(ui.sceneLock, "auto");
    const activeScene = normalizeLiveSceneTokenUi(ui.activeSceneToken, "");
    const candidateScene = normalizeLiveSceneTokenUi(ui.activeSceneCandidateToken, "");
    if (el.sceneLockStat) {
      el.sceneLockStat.textContent = currentLock === "auto" ? "AUTO" : currentLock.toUpperCase();
    }
    if (el.sceneSyncStat) {
      const sceneModeText = sceneStandalone
        ? "WIZ SCENE MODE: INDEPENDENT"
        : "SCENE LINK: HUE + WIZ SYNCED";
      const syncGroups = ui.liveSyncGroups && typeof ui.liveSyncGroups === "object"
        ? ui.liveSyncGroups
        : { enabled: false, groups: [] };
      const syncGroupCount = Array.isArray(syncGroups.groups) ? syncGroups.groups.length : 0;
      const syncGroupText = syncGroups.enabled === true && syncGroupCount > 0
        ? ` | GROUP SYNC: ${syncGroupCount}`
        : "";
      if (currentLock === "auto") {
        const targetScene = candidateScene && candidateScene !== "auto"
          ? candidateScene
          : (activeScene && activeScene !== "auto" ? activeScene : "");
        const activeText = activeScene && activeScene !== "auto"
          ? activeScene.toUpperCase()
          : "WAITING";
        el.sceneSyncStat.textContent = targetScene
          ? `${sceneModeText} | AUTO TARGET: ${targetScene.toUpperCase()} | ACTIVE: ${activeText}${syncGroupText}`
          : `${sceneModeText} | AUTO TARGET: WAITING | ACTIVE: ${activeText}${syncGroupText}`;
      } else {
        el.sceneSyncStat.textContent = activeScene && activeScene !== "auto"
          ? `${sceneModeText} | ACTIVE SCENE: ${activeScene.toUpperCase()}${syncGroupText}`
          : `${sceneModeText}${syncGroupText}`;
      }
    }
  }

  function sync() {
    syncLivePowerUi();
    syncMetaAutoStatusUi();
    syncAudioPresetButtonsUi();
    syncOverclockButtonsUi();
    syncDebugControlsUi();
    syncSceneButtonsUi();
    syncSceneStatusUi();
    updateAudioReactivityPolicyUi();
  }

  return {
    sync
  };
}
