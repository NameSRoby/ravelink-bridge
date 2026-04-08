// [TITLE] Module: public/assets/js/domains/live/live-theme-shell-ui.js
// [TITLE] Purpose: theme settings, onboarding shell gates, DEV tools, overclock ack gate, and OBS dock shell
// [TITLE] Functionality Index:
// [TITLE] - theme preset/custom color application
// [TITLE] - onboarding + Hue entertainment guide gate ownership
// [TITLE] - DEV debug and probe controls
// [TITLE] - destructive overclock acknowledgment gate
// [TITLE] - OBS dock compact mode controls
// [DEV] Complex Flow: this module owns shell-level UI that is not part of the live effect pipeline
// [DEV] but still gates dangerous operations and page layout state. Theme handlers can be retried
// [DEV] from bootstrap fallback paths, so they stay idempotent and support self-heal init.
let themeSettingsHandlersBound = false;
let themeSettingsFallbackBound = false;
let hueEntGuideAckResolver = null;
let hueEntGuideAckPromise = null;
let devOcAckResolver = null;
let devOcAckKeydownHandler = null;

const {
  applyThemeConfig,
  getThemePreset,
  normalizeHexColor,
  normalizeThemeGlow,
  normalizeThemeCustomConfig
} = (typeof createLiveThemeConfigRuntimeUi === "function"
  ? createLiveThemeConfigRuntimeUi({
    ui,
    documentRef: document,
    localStorageRef: localStorage,
    THEME_PRESETS,
    DEFAULT_THEME_NAME,
    THEME_STORAGE_KEY
  })
  : (() => {
    throw new Error("live theme config runtime module missing");
  })());
const onboardingTourRuntime = (typeof createOnboardingTourRuntimeUi === "function"
  ? createOnboardingTourRuntimeUi({
    el,
    ui,
    documentRef: document,
    windowRef: window,
    localStorageRef: localStorage,
    showTab,
    setBadge,
    tabTourButtons
  })
  : null);
function setDevDebugMode(enabled, options = {}) {
  ui.devDebugMode = Boolean(enabled);

  if (el.ocDevCluster) {
    el.ocDevCluster.classList.toggle("hidden", !ui.devDebugMode);
  }
  if (el.devToolsPanel) {
    el.devToolsPanel.classList.toggle("hidden", !ui.devDebugMode);
  }
  if (el.devDebugToggleBtn) {
    el.devDebugToggleBtn.textContent = ui.devDebugMode ? "DEV DEBUG ON" : "DEV DEBUG OFF";
    el.devDebugToggleBtn.classList.toggle("active", ui.devDebugMode);
  }
  if (el.devDebugStatus) {
    el.devDebugStatus.textContent = ui.devDebugMode
      ? "DEV mode is ON. Runtime probes + maintenance commands are unlocked, and unsafe controls (if present) can be armed."
      : "Enables developer probes and maintenance commands. Use only for controlled testing.";
  }

  if (options.persist !== false) {
    localStorage.setItem(DEV_DEBUG_KEY, ui.devDebugMode ? "1" : "0");
  }
}
function setDevToolsStatus(text) {
  if (!el.devToolsStatus) return;
  el.devToolsStatus.value = String(text || "").trim() || "DEV tools idle.";
}
function toSafeJsonString(payload, fallback = "") {
  try {
    const seen = new WeakSet();
    return JSON.stringify(payload, (key, value) => {
      if (value && typeof value === "object") {
        if (seen.has(value)) return "[Circular]";
        seen.add(value);
      }
      return value;
    }, 2);
  } catch {
    return String(fallback || "");
  }
}
function setDevToolsDump(payload, label = "") {
  if (!el.devToolsDump) return;
  const header = String(label || "").trim();
  const body = typeof payload === "string"
    ? payload
    : toSafeJsonString(payload, "[unserializable payload]");
  const full = header ? `${header}\n${body}` : body;
  el.devToolsDump.value = full.length > 50000 ? `${full.slice(0, 50000)}\n...[truncated]` : full;
}
async function runDevToolsProbe(label, fetcher, traceLabel = "") {
  const name = String(label || "DEV TOOL").trim();
  setDevToolsStatus(`${name}: querying...`);
  const snapshot = await Promise.resolve().then(() => fetcher());
  if (!snapshot) {
    setDevToolsStatus(`${name}: failed`);
    setBadge(el.health, "bad", `${name} FAIL`);
    return false;
  }
  setDevToolsStatus(`${name}: ok @ ${new Date().toLocaleTimeString()}`);
  const trace = String(traceLabel || "").trim();
  setDevToolsDump(snapshot, trace ? `${name} ${trace}` : name);
  setBadge(el.health, "ok", `${name} OK`);
  return true;
}
function isDevDebugEnabledForCommands() {
  if (ui.devDebugMode) return true;
  setDevToolsStatus("Enable DEV DEBUG first.");
  setBadge(el.health, "warn", "ENABLE DEV DEBUG FIRST");
  return false;
}
function normalizeDevCommandResultEnvelope(raw) {
  if (typeof raw === "boolean") {
    return {
      ok: raw === true,
      statusText: raw === true ? "ok" : "failed",
      payload: { ok: raw === true }
    };
  }
  if (!raw || typeof raw !== "object") {
    return {
      ok: false,
      statusText: "invalid_response",
      payload: { ok: false, error: "invalid_response" }
    };
  }
  const hasOk = Object.prototype.hasOwnProperty.call(raw, "ok");
  const hasStatus = Object.prototype.hasOwnProperty.call(raw, "status");
  const status = Number(raw.status);
  const ok = hasOk
    ? raw.ok === true
    : (hasStatus ? status >= 200 && status < 300 : true);
  const statusText = hasStatus && Number.isFinite(status)
    ? `status_${Math.round(status)}`
    : (ok ? "ok" : "failed");
  return {
    ok,
    statusText,
    payload: raw
  };
}
async function runDevMaintenanceCommand(label, execute, options = {}) {
  const name = String(label || "DEV COMMAND").trim().toUpperCase();
  if (!isDevDebugEnabledForCommands()) return false;
  setDevToolsStatus(`${name}: running...`);

  let raw = null;
  try {
    raw = await Promise.resolve().then(execute);
  } catch (error) {
    const message = String(error?.message || error || "command_failed");
    setDevToolsStatus(`${name}: ${message}`);
    setDevToolsDump({ ok: false, error: message }, name);
    setBadge(el.health, "bad", `${name} FAIL`);
    return false;
  }

  const result = normalizeDevCommandResultEnvelope(raw);
  setDevToolsDump(result.payload, name);
  setDevToolsStatus(`${name}: ${result.statusText}`);
  setBadge(el.health, result.ok ? "ok" : "bad", result.ok ? `${name} OK` : `${name} FAIL`);

  if (result.ok && options.reloadUiAfter === true) {
    setTimeout(() => {
      window.location.reload();
    }, 450);
  }
  return result.ok;
}
function closeDevOverclockAckGate(confirmed) {
  if (devOcAckKeydownHandler) {
    document.removeEventListener("keydown", devOcAckKeydownHandler);
    devOcAckKeydownHandler = null;
  }
  if (el.devOcAckGate) {
    el.devOcAckGate.classList.add("hidden");
    el.devOcAckGate.setAttribute("aria-hidden", "true");
  }
  if (el.devOcAckInput) el.devOcAckInput.value = "";
  if (devOcAckResolver) {
    const resolve = devOcAckResolver;
    devOcAckResolver = null;
    resolve(Boolean(confirmed));
  }
}
function openDevOverclockAckGate(hz) {
  if (!el.devOcAckGate || !el.devOcAckInput || !el.devOcAckPhrase) {
    return Promise.resolve(false);
  }
  if (devOcAckResolver) {
    devOcAckResolver(false);
    devOcAckResolver = null;
  }

  el.devOcAckPhrase.value = DEV_OVERCLOCK_COMICAL_TEXT;
  el.devOcAckInput.value = "";
  el.devOcAckGate.classList.remove("hidden");
  el.devOcAckGate.setAttribute("aria-hidden", "false");

  return new Promise(resolve => {
    devOcAckResolver = resolve;
    devOcAckKeydownHandler = ev => {
      if (!el.devOcAckGate || el.devOcAckGate.classList.contains("hidden")) {
        if (devOcAckKeydownHandler) {
          document.removeEventListener("keydown", devOcAckKeydownHandler);
          devOcAckKeydownHandler = null;
        }
        return;
      }
      if (ev.key === "Escape") {
        ev.preventDefault();
        closeDevOverclockAckGate(false);
        return;
      }
      if (ev.key === "Enter") {
        ev.preventDefault();
        const typed = String(el.devOcAckInput.value || "").trim();
        if (!typed) {
          closeDevOverclockAckGate(false);
          return;
        }
        closeDevOverclockAckGate(typed.toUpperCase() === DEV_OVERCLOCK_COMICAL_TEXT);
      }
    };
    document.addEventListener("keydown", devOcAckKeydownHandler);

    setTimeout(() => {
      if (el.devOcAckInput) el.devOcAckInput.focus();
    }, 0);
  });
}
function confirmDevDebugEnableOnce() {
  if (ui.devDebugWarned) return true;
  const proceed = window.confirm(
    "DEV/DEBUG MODE unlocks destructive 20-60Hz overclock.\n\n" +
    "This warning appears once. Continue?"
  );
  if (!proceed) return false;
  ui.devDebugWarned = true;
  localStorage.setItem(DEV_DEBUG_WARN_ONCE_KEY, "1");
  return true;
}
function confirmUnsafeSensitiveLogEnable() {
  const proceed = window.confirm(
    "DANGER: This will disable server log redaction and expose sensitive values in plain text logs.\n\n" +
    "Exposed data may include Hue usernames/client keys, bridge ids, entertainment area ids, bearer/access tokens, auth headers/cookies, and private IP/host data.\n\n" +
    "Logs can be copied, indexed, uploaded, or retained by other tools.\n\n" +
    "Continue?"
  );
  if (!proceed) return { ok: false, ack: "" };

  const typed = String(
    window.prompt(
      `Type exactly ${UNSAFE_LOG_ACK_PHRASE} to confirm you understand the risk:`,
      ""
    ) || ""
  ).trim();

  if (typed !== UNSAFE_LOG_ACK_PHRASE) {
    return { ok: false, ack: "" };
  }

  return { ok: true, ack: typed };
}
function syncThemeUi() {
  const fallbackTheme = THEME_PRESETS[DEFAULT_THEME_NAME] || {};
  for (const input of getThemeCustomInputNodes()) {
    const key = String(input?.dataset?.themeCustom || "").trim();
    if (!key) continue;
    if (key === "glow") {
      const glow = normalizeThemeGlow(ui.themeConfig?.glow, fallbackTheme.glow);
      input.value = String(glow);
      if (el.themeGlowStrengthVal) el.themeGlowStrengthVal.textContent = `${glow}%`;
      continue;
    }
    input.value = normalizeHexColor(ui.themeConfig?.[key], fallbackTheme[key] || "#8b001f");
  }

  themePresetButtons.forEach(btn => {
    const name = String(btn.dataset.themePreset || "").trim().toLowerCase();
    btn.classList.toggle("active", name === ui.themeName);
  });
}
function applyThemePreset(name, options = {}) {
  ui.themeName = String(name || DEFAULT_THEME_NAME).trim().toLowerCase();
  if (!THEME_PRESETS[ui.themeName]) ui.themeName = DEFAULT_THEME_NAME;
  applyThemeConfig(getThemePreset(ui.themeName), options);
  syncThemeUi();
}
function toggleThemePanel(open) {
  const nextOpen = open === undefined
    ? el.themePanel.classList.contains("hidden")
    : Boolean(open);
  el.themePanel.classList.toggle("hidden", !nextOpen);
}
function getThemeCustomInputNodes() {
  const explicit = [
    el.themeLogoColor,
    el.themeButtonColor,
    el.themeBgColor,
    el.themePanelColor,
    el.themeSurfaceColor,
    el.themeEdgeColor,
    el.themeTextColor,
    el.themeOkColor,
    el.themeWarnColor,
    el.themeBadColor,
    el.themeGlowStrength
  ].filter(Boolean);
  return themeCustomInputs.length ? themeCustomInputs : explicit;
}
function initOnboardingGate() {
  if (!el.onboardGate) return;
  const wasAcked = localStorage.getItem("ravelink_onboard_ack_v1") === "1";
  ui.onboardingAcknowledged = wasAcked;
  if (wasAcked) {
    el.onboardGate.classList.add("hidden");
    return;
  }
  if (el.onboardAckBtn) {
    el.onboardAckBtn.onclick = () => {
      localStorage.setItem("ravelink_onboard_ack_v1", "1");
      ui.onboardingAcknowledged = true;
      el.onboardGate.classList.add("hidden");
      if (onboardingTourRuntime && typeof onboardingTourRuntime.startOnboardingTour === "function") {
        onboardingTourRuntime.startOnboardingTour();
      }
    };
  }
  if (el.onboardSkipBtn) {
    el.onboardSkipBtn.onclick = () => {
      localStorage.setItem("ravelink_onboard_ack_v1", "1");
      ui.onboardingAcknowledged = true;
      el.onboardGate.classList.add("hidden");
    };
  }
}
function initHueEntGuideGate() {
  if (!el.hueEntGuideGate) return;
  const wasAcked = localStorage.getItem("ravelink_hue_ent_guide_ack_v1") === "1";
  ui.hueEntGuideAcknowledged = wasAcked;
  if (wasAcked) {
    el.hueEntGuideGate.classList.add("hidden");
    return;
  }
  if (el.hueEntGuideAckBtn) {
    el.hueEntGuideAckBtn.onclick = () => {
      localStorage.setItem("ravelink_hue_ent_guide_ack_v1", "1");
      ui.hueEntGuideAcknowledged = true;
      el.hueEntGuideGate.classList.add("hidden");
      if (typeof hueEntGuideAckResolver === "function") {
        hueEntGuideAckResolver(true);
        hueEntGuideAckResolver = null;
      }
      hueEntGuideAckPromise = null;
    };
  }
}
function ensureHueEntGuideAcknowledged() {
  const wasAcked = localStorage.getItem("ravelink_hue_ent_guide_ack_v1") === "1";
  ui.hueEntGuideAcknowledged = wasAcked;
  if (wasAcked) {
    return Promise.resolve(true);
  }
  if (!el.hueEntGuideGate) {
    return Promise.resolve(true);
  }
  el.hueEntGuideGate.classList.remove("hidden");
  if (hueEntGuideAckPromise) {
    return hueEntGuideAckPromise;
  }
  hueEntGuideAckPromise = new Promise(resolve => {
    hueEntGuideAckResolver = resolve;
  });
  return hueEntGuideAckPromise;
}
function clearOnboardingProgressStateUi() {
  // [DEV] Reset explicit onboarding acks so users can relaunch first-run
  // [DEV] guidance from the settings panel.
  try {
    localStorage.removeItem("ravelink_onboard_ack_v1");
    localStorage.removeItem("ravelink_hue_ent_guide_ack_v1");
    ui.onboardingAcknowledged = false;
    ui.hueEntGuideAcknowledged = false;
  } catch (err) {
    console.debug("[ONBOARD][DEBUG] failed to clear onboarding state:", err?.message || err);
  }
}
function relaunchOnboardingUi(options = {}) {
  const jumpToFixtures = options.jumpToFixtures === true;
  const tabName = String(options.tab || (jumpToFixtures ? "fixtures" : "") || "").trim().toLowerCase();
  const badgeText = String(options.badgeText || "").trim() || "ONBOARDING READY";

  clearOnboardingProgressStateUi();
  if (typeof initOnboardingGate === "function") initOnboardingGate();
  if (typeof initHueEntGuideGate === "function") initHueEntGuideGate();
  if (el.onboardGate) el.onboardGate.classList.add("hidden");

  if (jumpToFixtures && typeof showTab === "function") {
    showTab("fixtures");
  }
  if (onboardingTourRuntime && typeof onboardingTourRuntime.startOnboardingTour === "function") {
    onboardingTourRuntime.startOnboardingTour({ tab: tabName });
  } else if (el.onboardGate) {
    el.onboardGate.classList.remove("hidden");
  }
  toggleThemePanel(false);
  setBadge(el.health, "ok", badgeText);
}
function initThemeSettings() {
  let loaded = null;
  try {
    loaded = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) || "null");
  } catch (err) {
    console.debug("[THEME][DEBUG] failed to parse saved theme config:", err?.message || err);
  }

  const loadedNameRaw = String(loaded?.name || "").trim().toLowerCase();
  const hasStoredTheme = loaded && typeof loaded === "object";
  const hasValidStoredThemeName = Boolean(THEME_PRESETS[loadedNameRaw]);
  const loadedName = hasValidStoredThemeName ? loadedNameRaw : DEFAULT_THEME_NAME;
  ui.themeName = loadedName;
  const preset = getThemePreset(ui.themeName);
  const custom = normalizeThemeCustomConfig(loaded?.custom, preset);
  const shouldPersistTheme =
    !hasStoredTheme ||
    !hasValidStoredThemeName;

  applyThemeConfig(
    {
      ...preset,
      ...custom
    },
    { persist: shouldPersistTheme }
  );
  syncThemeUi();
  setDevDebugMode(ui.devDebugMode, { persist: false });
  setDevToolsStatus(ui.devDebugMode ? "DEV tools idle." : "DEV tools hidden. Enable DEV DEBUG to use probes.");
  if (typeof applyMidiTabVisibility === "function") {
    applyMidiTabVisibility({ preserveTab: false });
  }
  if (onboardingTourRuntime && typeof onboardingTourRuntime.wireOnboardingTourControls === "function") {
    onboardingTourRuntime.wireOnboardingTourControls();
  }

  // [DEV] Theme handlers are attached once. Subsequent init calls can still re-apply
  // [DEV] visual state/storage hydration without stacking duplicate click listeners.
  if (themeSettingsHandlersBound) {
    return;
  }
  themeSettingsHandlersBound = true;

  themePresetButtons.forEach(btn => {
    btn.onclick = () => {
      applyThemePreset(btn.dataset.themePreset || DEFAULT_THEME_NAME);
    };
  });

  getThemeCustomInputNodes().forEach(input => {
    input.oninput = () => {
      const key = String(input?.dataset?.themeCustom || "").trim();
      if (!key) return;
      applyThemeConfig({ ...ui.themeConfig, [key]: key === "glow" ? Number(input.value) : input.value });
      syncThemeUi();
    };
  });
  if (el.themeResetBtn) {
    el.themeResetBtn.onclick = () => {
      applyThemePreset(DEFAULT_THEME_NAME);
    };
  }
  if (el.devDebugToggleBtn) {
    el.devDebugToggleBtn.onclick = () => {
      const next = !ui.devDebugMode;
      if (next) {
        if (!confirmDevDebugEnableOnce()) {
          setBadge(el.health, "warn", "DEV DEBUG ENABLE CANCELED");
          return;
        }
      }

      setDevDebugMode(next);
      setDevToolsStatus(next ? "DEV tools idle." : "DEV tools hidden. Enable DEV DEBUG to use probes.");
      setBadge(el.health, next ? "warn" : "ok", next ? "DEV DEBUG ON" : "DEV DEBUG OFF");
      sync();
    };
  }
  if (el.midiTabToggleBtn) {
    el.midiTabToggleBtn.onclick = () => {
      if (ui.midiDetected) {
        setBadge(el.health, "ok", "MIDI DETECTED: TAB AUTO-VISIBLE");
        return;
      }
      if (typeof setMidiTabForced !== "function" || typeof applyMidiTabVisibility !== "function") {
        setBadge(el.health, "warn", "MIDI TAB TOGGLE UNAVAILABLE");
        return;
      }
      setMidiTabForced(!ui.midiTabForced);
      applyMidiTabVisibility();
      setBadge(el.health, "ok", ui.midiTabForced ? "MIDI TAB FORCED ON" : "MIDI TAB AUTO-HIDDEN");
    };
  }
  if (el.onboardStartBtn) {
    el.onboardStartBtn.onclick = () => {
      relaunchOnboardingUi({
        jumpToFixtures: false,
        badgeText: "ONBOARDING STARTED"
      });
    };
  }
  if (el.onboardResetBtn) {
    el.onboardResetBtn.onclick = () => {
      relaunchOnboardingUi({
        jumpToFixtures: false,
        badgeText: "ONBOARDING RESET"
      });
    };
  }
  if (el.devToolRuntimeBtn) {
    el.devToolRuntimeBtn.onclick = () => runDevToolsProbe("RUNTIME", liveEndpointsAdapter.probeModsRuntime, "mods_runtime");
  }
  if (el.devToolConnectivityBtn) {
    el.devToolConnectivityBtn.onclick = () => runDevToolsProbe("CONNECTIVITY", liveEndpointsAdapter.probeFixturesConnectivity, "fixtures_connectivity");
  }
  if (el.devToolHooksBtn) {
    el.devToolHooksBtn.onclick = () => runDevToolsProbe("MOD HOOKS", liveEndpointsAdapter.probeModsHooks, "mods_hooks");
  }
  if (el.devToolTiersBtn) {
    el.devToolTiersBtn.onclick = () => runDevToolsProbe("OC TIERS", liveEndpointsAdapter.probeOverclockTiers, "overclock_tiers");
  }
  if (el.reloadBtn) {
    el.reloadBtn.onclick = () => runDevMaintenanceCommand(
      "RAVE RELOAD",
      () => liveEndpointsAdapter.raveReloadDetailed(),
      { reloadUiAfter: true }
    );
  }
  if (el.hueEntBtn) {
    el.hueEntBtn.onclick = () => runDevMaintenanceCommand(
      "HUE ENT",
      () => liveEndpointsAdapter.setHueTransportEntertainment()
    );
  }
  if (el.hueRestBtn) {
    el.hueRestBtn.onclick = () => runDevMaintenanceCommand(
      "HUE REST",
      () => liveEndpointsAdapter.setHueTransportRest()
    );
  }
  if (el.serverStopBtn) {
    el.serverStopBtn.onclick = () => runDevMaintenanceCommand(
      "STOP SERVER",
      async () => {
        const confirmNeeded = typeof shouldConfirmDangerousAction === "function"
          ? shouldConfirmDangerousAction()
          : true;
        if (confirmNeeded) {
          const proceed = window.confirm("Request server shutdown now?");
          if (!proceed) return { ok: false, status: 0, error: "cancelled" };
        }
        return liveEndpointsAdapter.stopSystem();
      }
    );
  }
  if (el.devOcAckCancelBtn) {
    el.devOcAckCancelBtn.onclick = () => closeDevOverclockAckGate(false);
  }
  if (el.devOcAckConfirmBtn) {
    el.devOcAckConfirmBtn.onclick = () => {
      const typed = String(el.devOcAckInput?.value || "").trim();
      if (!typed) {
        closeDevOverclockAckGate(false);
        return;
      }
      closeDevOverclockAckGate(typed.toUpperCase() === DEV_OVERCLOCK_COMICAL_TEXT);
    };
  }
  if (el.devOcAckGate) {
    el.devOcAckGate.onclick = ev => {
      if (ev.target === el.devOcAckGate) {
        closeDevOverclockAckGate(false);
      }
    };
  }
  if (el.themeCloseBtn) {
    el.themeCloseBtn.onclick = () => toggleThemePanel(false);
  }
  if (el.themeCogBtn) {
    el.themeCogBtn.onclick = () => toggleThemePanel();
  }

  document.addEventListener("click", ev => {
    if (!el.themePanel || el.themePanel.classList.contains("hidden")) return;
    const target = ev.target;
    const clickedInsidePanel = el.themePanel.contains(target);
    const clickedCog = el.themeCogBtn && (target === el.themeCogBtn || el.themeCogBtn.contains(target));
    if (!clickedInsidePanel && !clickedCog) {
      toggleThemePanel(false);
    }
  });
}
function ensureThemeSettingsFallbackBindings() {
  if (themeSettingsFallbackBound) return;
  themeSettingsFallbackBound = true;

  // [DEV] Last-resort delegated controls for the cog panel. Keep these local-only
  // [DEV] (no server writes) so users retain shell control even in partial boot failures.
  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const presetBtn = target.closest("#themePanel [data-theme-preset]");
    if (presetBtn) {
      if (typeof applyThemePreset === "function") {
        applyThemePreset(presetBtn.dataset.themePreset || DEFAULT_THEME_NAME);
      }
      return;
    }

    if (target.closest("#themeResetBtn")) {
      if (typeof applyThemePreset === "function") {
        applyThemePreset(DEFAULT_THEME_NAME);
      }
      return;
    }

    if (target.closest("#themeCloseBtn")) {
      if (el.themePanel) el.themePanel.classList.add("hidden");
      return;
    }

    if (target.closest("#onboardStartBtn")) {
      relaunchOnboardingUi({
        jumpToFixtures: false,
        badgeText: "ONBOARDING STARTED"
      });
      return;
    }

    if (target.closest("#onboardResetBtn")) {
      relaunchOnboardingUi({
        jumpToFixtures: false,
        badgeText: "ONBOARDING RESET"
      });
    }
  });

  document.addEventListener("input", event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (target.matches("[data-theme-custom]")) {
      if (typeof applyThemeConfig === "function") {
        const key = String(target.dataset.themeCustom || "").trim();
        if (!key) return;
        applyThemeConfig({
          ...ui.themeConfig,
          [key]: key === "glow" ? Number(target.value) : target.value
        });
        syncThemeUi();
      }
    }
  });
}
function ensureThemeSettingsSelfHealInit() {
  ensureThemeSettingsFallbackBindings();
  setTimeout(() => {
    if (themeSettingsHandlersBound) return;
    try {
      initThemeSettings();
    } catch (err) {
      console.debug("[THEME][DEBUG] self-heal init failed:", err?.message || err);
    }
  }, 140);
}
ensureThemeSettingsSelfHealInit();
function setObsDockCompact(compact, options = {}) {
  ui.obsDockCompact = Boolean(compact);
  document.body.classList.toggle("obsDockCompact", ui.obsDockCompact);
  if (el.obsDockCompactBtn) {
    el.obsDockCompactBtn.textContent = ui.obsDockCompact ? "DK+" : "DK";
    el.obsDockCompactBtn.title = ui.obsDockCompact
      ? "Switch to expanded OBS dock layout"
      : "Switch to compact OBS dock layout";
  }
  if (options.persist !== false) {
    localStorage.setItem(OBS_DOCK_COMPACT_KEY, ui.obsDockCompact ? "1" : "0");
  }
}
function initObsDockMode() {
  if (!ui.obsDockMode) return;
  document.body.classList.add("obsDockMode");
  if (el.obsDockCompactBtn) {
    el.obsDockCompactBtn.classList.remove("hidden");
    el.obsDockCompactBtn.onclick = () => {
      setObsDockCompact(!ui.obsDockCompact);
    };
  }
  setObsDockCompact(ui.obsDockCompact, { persist: false });
}
