// [TITLE] Module: public/assets/js/domains/audio/audio-runtime-startup-ui.js
// [TITLE] Purpose: audio UI startup hydration + wiring audit lifecycle owner
// [TITLE] Functionality Index:
// [TITLE] - wiring completeness audit for audio controls
// [TITLE] - startup hydration retry orchestration
// [TITLE] - deferred one-time audio domain boot flow
// [DEV] Complex Flow:
// [DEV] Startup hydration intentionally retries config/apps/devices as a unit to
// [DEV] reduce race-driven empty dropdown states during cold boot.

function createAudioRuntimeStartupUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const documentRef = deps.documentRef || document;
  const localStorageRef = deps.localStorageRef || localStorage;
  const setBadge = typeof deps.setBadge === "function" ? deps.setBadge : (() => {});
  const announceAudioActionStatus = typeof deps.announceAudioActionStatus === "function"
    ? deps.announceAudioActionStatus
    : (() => {});
  const setAudioProfileStatusUi = typeof deps.setAudioProfileStatusUi === "function"
    ? deps.setAudioProfileStatusUi
    : (() => {});
  const loadAudioProfiles = typeof deps.loadAudioProfiles === "function"
    ? deps.loadAudioProfiles
    : (async () => false);
  const bindAudioReactivityMapUi = typeof deps.bindAudioReactivityMapUi === "function"
    ? deps.bindAudioReactivityMapUi
    : (() => {});
  const syncAudioCaptureModeUi = typeof deps.syncAudioCaptureModeUi === "function"
    ? deps.syncAudioCaptureModeUi
    : (() => {});
  const syncAudioRoutingComplexityUi = typeof deps.syncAudioRoutingComplexityUi === "function"
    ? deps.syncAudioRoutingComplexityUi
    : (() => {});
  const updateAudioAppsFilterHintUi = typeof deps.updateAudioAppsFilterHintUi === "function"
    ? deps.updateAudioAppsFilterHintUi
    : (() => {});
  const renderAudioOptionalToolsBanner = typeof deps.renderAudioOptionalToolsBanner === "function"
    ? deps.renderAudioOptionalToolsBanner
    : (() => {});
  const setAudioAppSelectOptions = typeof deps.setAudioAppSelectOptions === "function"
    ? deps.setAudioAppSelectOptions
    : (() => {});
  const loadAudioConfig = typeof deps.loadAudioConfig === "function"
    ? deps.loadAudioConfig
    : (async () => false);
  const loadAudioApps = typeof deps.loadAudioApps === "function"
    ? deps.loadAudioApps
    : (async () => false);
  const loadAudioDevices = typeof deps.loadAudioDevices === "function"
    ? deps.loadAudioDevices
    : (async () => false);
  const normalizeAudioAppNameUi = typeof deps.normalizeAudioAppNameUi === "function"
    ? deps.normalizeAudioAppNameUi
    : (value => String(value || "").trim());
  const AUDIO_UI_WIRING_BUTTON_IDS = Array.isArray(deps.AUDIO_UI_WIRING_BUTTON_IDS)
    ? deps.AUDIO_UI_WIRING_BUTTON_IDS
    : [];
  const AUDIO_UI_WIRING_OPTIONAL_BUTTON_IDS = deps.AUDIO_UI_WIRING_OPTIONAL_BUTTON_IDS instanceof Set
    ? deps.AUDIO_UI_WIRING_OPTIONAL_BUTTON_IDS
    : new Set();
  const AUDIO_UI_WIRING_CRITICAL_IDS = Array.isArray(deps.AUDIO_UI_WIRING_CRITICAL_IDS)
    ? deps.AUDIO_UI_WIRING_CRITICAL_IDS
    : [];
  const AUDIO_TUNING_MODE_KEY = String(deps.AUDIO_TUNING_MODE_KEY || "ravelink_audio_tuning_mode_v1");

  const AUDIO_STARTUP_HYDRATE_MAX_ATTEMPTS = Math.max(1, Number(deps.AUDIO_STARTUP_HYDRATE_MAX_ATTEMPTS) || 4);
  const AUDIO_STARTUP_HYDRATE_RETRY_MS = Math.max(200, Number(deps.AUDIO_STARTUP_HYDRATE_RETRY_MS) || 900);
  const AUDIO_STARTUP_HYDRATE_DEFERRED_RETRY_MS = Math.max(400, Number(deps.AUDIO_STARTUP_HYDRATE_DEFERRED_RETRY_MS) || 4500);

  let audioDomainUiInitialized = false;
  let audioStartupHydrateInFlight = false;
  let audioStartupHydrateDeferredRetryTimer = null;

  function normalizeAudioTuningMode(mode) {
    return String(mode || "").trim().toLowerCase() === "advanced" ? "advanced" : "easy";
  }

  function renderAudioTuningModeUi(mode) {
    const normalizedMode = normalizeAudioTuningMode(mode);
    ui.audioTuningMode = normalizedMode;

    if (el.aTuningEasyPane) {
      el.aTuningEasyPane.classList.toggle("hidden", normalizedMode !== "easy");
    }
    if (el.aTuningAdvancedPane) {
      el.aTuningAdvancedPane.classList.toggle("hidden", normalizedMode !== "advanced");
    }

    if (el.aTuningModeEasyBtn) {
      const active = normalizedMode === "easy";
      el.aTuningModeEasyBtn.classList.toggle("active", active);
      el.aTuningModeEasyBtn.setAttribute("aria-selected", active ? "true" : "false");
    }
    if (el.aTuningModeAdvancedBtn) {
      const active = normalizedMode === "advanced";
      el.aTuningModeAdvancedBtn.classList.toggle("active", active);
      el.aTuningModeAdvancedBtn.setAttribute("aria-selected", active ? "true" : "false");
    }
    if (el.aTuningModeHint) {
      el.aTuningModeHint.textContent = normalizedMode === "advanced"
        ? "Advanced mode active: thresholds, limiter shape, and restart/debug controls are visible."
        : "Easy mode active: everyday tuning controls are visible. Switch to advanced mode for troubleshooting controls.";
    }
  }

  function setAudioTuningMode(mode, options = {}) {
    renderAudioTuningModeUi(mode);
    if (options.persist === false) return;
    try {
      localStorageRef.setItem(AUDIO_TUNING_MODE_KEY, ui.audioTuningMode === "advanced" ? "advanced" : "easy");
    } catch {
      // ignore storage write failures
    }
  }

  function initAudioTuningModeUi() {
    const hasControls = Boolean(el.aTuningModeEasyBtn || el.aTuningModeAdvancedBtn || el.aTuningEasyPane || el.aTuningAdvancedPane);
    if (!hasControls) return;

    let storedMode = "";
    try {
      storedMode = String(localStorageRef.getItem(AUDIO_TUNING_MODE_KEY) || "").trim();
    } catch {
      storedMode = "";
    }
    const initialMode = normalizeAudioTuningMode(ui.audioTuningMode || storedMode || "easy");
    setAudioTuningMode(initialMode, { persist: false });

    if (el.aTuningModeEasyBtn) {
      el.aTuningModeEasyBtn.onclick = () => {
        setAudioTuningMode("easy");
      };
    }
    if (el.aTuningModeAdvancedBtn) {
      el.aTuningModeAdvancedBtn.onclick = () => {
        setAudioTuningMode("advanced");
      };
    }
  }

  function runAudioUiWiringAudit() {
    const missingButtons = [];
    const unwiredButtons = [];
    const missingCritical = [];
    for (const id of AUDIO_UI_WIRING_BUTTON_IDS) {
      const node = el[id];
      if (!node) {
        if (AUDIO_UI_WIRING_OPTIONAL_BUTTON_IDS.has(id)) continue;
        missingButtons.push(id);
        continue;
      }
      if (typeof node.onclick !== "function") {
        unwiredButtons.push(id);
      }
    }
    for (const id of AUDIO_UI_WIRING_CRITICAL_IDS) {
      if (!el[id]) missingCritical.push(id);
    }

    const quickButtons = Array.from(documentRef.querySelectorAll("[data-audio-quick]"));
    const quickUnwired = quickButtons.filter(btn => typeof btn.onclick !== "function");
    const limiterButtons = Array.from(documentRef.querySelectorAll("[data-limiter-preset]"));
    const limiterUnwired = limiterButtons.filter(btn => typeof btn.onclick !== "function");

    const ok = (
      missingButtons.length === 0 &&
      unwiredButtons.length === 0 &&
      missingCritical.length === 0 &&
      quickUnwired.length === 0 &&
      limiterUnwired.length === 0
    );
    const summary = {
      ok,
      missingButtons,
      unwiredButtons,
      missingCritical,
      quickButtons: quickButtons.length,
      quickUnwired: quickUnwired.length,
      limiterButtons: limiterButtons.length,
      limiterUnwired: limiterUnwired.length
    };
    window.__ravelinkAudioUiWiring = summary;

    if (!ok) {
      const parts = [];
      if (missingButtons.length) parts.push(`missing buttons=${missingButtons.join(",")}`);
      if (unwiredButtons.length) parts.push(`unwired buttons=${unwiredButtons.join(",")}`);
      if (missingCritical.length) parts.push(`missing controls=${missingCritical.join(",")}`);
      if (quickUnwired.length) parts.push(`unwired quick presets=${quickUnwired.length}`);
      if (limiterUnwired.length) parts.push(`unwired limiter presets=${limiterUnwired.length}`);
      const detail = parts.join(" | ").slice(0, 480);
      setBadge(el.health, "bad", "AUDIO UI WIRING FAIL");
      announceAudioActionStatus(`AUDIO UI WIRING FAIL | ${detail}`, 6500);
      console.error("[AUDIO][UI] wiring audit failed:", summary);
      return;
    }

    setBadge(el.health, "ok", "AUDIO UI WIRED");
    announceAudioActionStatus(
      `AUDIO UI WIRED | controls=${AUDIO_UI_WIRING_CRITICAL_IDS.length} | buttons=${AUDIO_UI_WIRING_BUTTON_IDS.length} | quick=${quickButtons.length} | limiter=${limiterButtons.length}`,
      2600
    );
    console.log("[AUDIO][UI] wiring audit ok:", summary);
  }

  function scheduleAudioStartupHydrateDeferredRetryUi(delayMs = AUDIO_STARTUP_HYDRATE_DEFERRED_RETRY_MS) {
    if (audioStartupHydrateDeferredRetryTimer) return;
    const waitMs = Number.isFinite(Number(delayMs))
      ? Math.max(500, Math.round(Number(delayMs)))
      : AUDIO_STARTUP_HYDRATE_DEFERRED_RETRY_MS;
    audioStartupHydrateDeferredRetryTimer = setTimeout(() => {
      audioStartupHydrateDeferredRetryTimer = null;
      void hydrateAudioStartupDataUi();
    }, waitMs);
  }

  function hasAudioStartupAppsReadyUi() {
    if (ui.audioAppsLoaded !== true) return false;
    if (Array.isArray(ui.audioRunningApps) && ui.audioRunningApps.length > 0) return true;
    const optionCount = Number(el.aAppPrimary?.options?.length || 0);
    if (optionCount > 1) return true;
    const configuredPrimary = normalizeAudioAppNameUi(
      el.aAppPrimary?.value || ui.audioConfiguredPrimaryApp || ""
    );
    return configuredPrimary.length > 0;
  }

  function hasAudioStartupDevicesReadyUi() {
    if (ui.audioDevicesLoaded === true) return true;
    if (Number(ui.audioLastDeviceScanCount || 0) > 0) return true;
    if (String(ui.audioDefaultOutputEndpointName || "").trim()) return true;
    const optionCount = Number(el.aDevices?.options?.length || 0);
    return optionCount > 1;
  }

  async function hydrateAudioStartupDataUi() {
    if (audioStartupHydrateInFlight) return false;
    audioStartupHydrateInFlight = true;
    let hydrated = false;
    try {
      for (let attempt = 1; attempt <= AUDIO_STARTUP_HYDRATE_MAX_ATTEMPTS; attempt += 1) {
        const cfgOk = await loadAudioConfig();
        const [appsOk, devicesOk] = await Promise.all([
          loadAudioApps({ forceRefresh: true }),
          loadAudioDevices()
        ]);
        const appsReady = appsOk && hasAudioStartupAppsReadyUi();
        const devicesReady = devicesOk && hasAudioStartupDevicesReadyUi();
        hydrated = cfgOk && appsReady && devicesReady;
        if (hydrated) {
          if (audioStartupHydrateDeferredRetryTimer) {
            clearTimeout(audioStartupHydrateDeferredRetryTimer);
            audioStartupHydrateDeferredRetryTimer = null;
          }
          return true;
        }
        if (attempt < AUDIO_STARTUP_HYDRATE_MAX_ATTEMPTS) {
          await new Promise(resolve => setTimeout(resolve, AUDIO_STARTUP_HYDRATE_RETRY_MS));
        }
      }
      return false;
    } finally {
      audioStartupHydrateInFlight = false;
      if (!hydrated) {
        announceAudioActionStatus("AUDIO STARTUP HYDRATION PARTIAL | USE REFRESH CFG IF NEEDED", 3200);
        scheduleAudioStartupHydrateDeferredRetryUi();
      }
    }
  }

  function initializeAudioDomainUiDeferred() {
    if (audioDomainUiInitialized) return;
    audioDomainUiInitialized = true;
    setAudioProfileStatusUi("Loading audio profiles...");
    loadAudioProfiles({ silent: true, syncNameInput: false }).then(ok => {
      if (!ok) {
        setAudioProfileStatusUi("Audio profiles unavailable.");
        return;
      }
      setAudioProfileStatusUi(
        Array.isArray(ui.audioProfiles) && ui.audioProfiles.length
          ? `Audio profiles ready (${ui.audioProfiles.length}).`
          : "No saved audio profiles yet."
      );
    });
    bindAudioReactivityMapUi();
    initAudioTuningModeUi();
    syncAudioCaptureModeUi({
      appIsoEnabled: el.aAppIsolationEnabled ? el.aAppIsolationEnabled.checked === true : false
    });
    syncAudioRoutingComplexityUi();
    updateAudioAppsFilterHintUi();
    renderAudioOptionalToolsBanner();
    if (el.aAppPrimary && (!el.aAppPrimary.options || el.aAppPrimary.options.length === 0)) {
      setAudioAppSelectOptions(el.aAppPrimary, el.aAppPrimary.value || "");
    }
    if (el.aAppFallback && (!el.aAppFallback.options || el.aAppFallback.options.length === 0)) {
      setAudioAppSelectOptions(el.aAppFallback, el.aAppFallback.value || "");
    }
    void hydrateAudioStartupDataUi();
    runAudioUiWiringAudit();
  }

  return {
    runAudioUiWiringAudit,
    scheduleAudioStartupHydrateDeferredRetryUi,
    hydrateAudioStartupDataUi,
    initializeAudioDomainUiDeferred
  };
}
