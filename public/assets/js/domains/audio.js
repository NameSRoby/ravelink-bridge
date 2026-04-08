// [TITLE] Module: public/assets/js/domains/audio.js
// [TITLE] Purpose: audio runtime config + app isolation + reactivity UI ownership
// [TITLE] Functionality Index:
// [TITLE] - audio source/app-isolation normalization and UI sync
// [TITLE] - audio reactivity map policy/render/load/save paths
// [TITLE] - audio telemetry/config/device loaders
// [DEV] Complex Flow:
// [DEV] This module keeps audio control surfaces consistent across LIVE/AUDIO tabs by
// [DEV] normalizing API payloads, applying compatibility constraints, and reconciling
// [DEV] telemetry vs draft UI state before persistence.

const audioUiInputAdapterRuntime = (typeof createAudioUiInputAdapter === "function"
  ? createAudioUiInputAdapter()
  : (() => {
    throw new Error("audio UI input adapter module missing");
  })());
function normalizeAudioDeviceListUi(value, fallback = []) {
  return audioUiInputAdapterRuntime.normalizeAudioDeviceListUi(value, fallback);
}
function formatAudioDeviceListUi(list = []) {
  return audioUiInputAdapterRuntime.formatAudioDeviceListUi(list);
}
function normalizeAudioAppNameUi(value) {
  return audioUiInputAdapterRuntime.normalizeAudioAppNameUi(value);
}
function normalizeAudioOutputEndpointNameUi(value) {
  return audioUiInputAdapterRuntime.normalizeAudioOutputEndpointNameUi(value);
}
function normalizeAudioAppTokenUi(value) {
  return audioUiInputAdapterRuntime.normalizeAudioAppTokenUi(value);
}
function normalizeAudioProfileNameUi(value) {
  return audioUiInputAdapterRuntime.normalizeAudioProfileNameUi(value);
}

const LIMITER_PRESETS = Object.freeze({
  transparent: Object.freeze({ limiterThreshold: 0.9, limiterKnee: 0.24 }),
  balanced: Object.freeze({ limiterThreshold: 0.82, limiterKnee: 0.16 }),
  hard: Object.freeze({ limiterThreshold: 0.72, limiterKnee: 0.08 })
});
const AUDIO_QUICK_PROFILES = Object.freeze({
  safe: Object.freeze({ sampleRate: 48000, framesPerBuffer: 512 }),
  balanced: Object.freeze({ sampleRate: 48000, framesPerBuffer: 256 }),
  fast: Object.freeze({ sampleRate: 48000, framesPerBuffer: 128 }),
  hires: Object.freeze({ sampleRate: 96000, framesPerBuffer: 256 })
});
const AUDIO_CONFIG_DEFAULTS = Object.freeze({
  inputBackend: "auto",
  autoPreferLegacyCapture: false,
  deviceMatch: "",
  deviceId: null,
  desktopOutputDeviceName: "",
  ffmpegPath: "ffmpeg",
  ffmpegInputFormat: "dshow",
  ffmpegInputDevice: "",
  ffmpegInputDevices: [],
  ffmpegLogLevel: "error",
  ffmpegUseWallclock: true,
  ffmpegAppIsolationEnabled: false,
  ffmpegAppIsolationStrict: false,
  ffmpegAppIsolationPrimaryApp: "",
  ffmpegAppIsolationFallbackApp: "",
  ffmpegAppIsolationPrimaryDevices: [],
  ffmpegAppIsolationFallbackDevices: [],
  ffmpegAppIsolationMultiSource: false,
  ffmpegAppIsolationCheckMs: 300000,
  procTapLauncher: "py",
  procTapPythonVersion: "3.13",
  procTapCaptureLocks: {},
  rustLoopbackPath: "ravelink-rust-audio-isolator.exe",
  rustAudioKernelEnabled: true,
  rustAudioKernelPath: "ravelink-audio-kernel.exe",
  rustAudioKernelIpcJsonl: true,
  rustSourceResolverEnabled: true,
  rustSourceResolverPath: "ravelink-source-resolver.exe",
  rustLoopbackFormat: "f32le",
  rustLoopbackAutoFallbackProcTap: true,
  rustHybridCaptureEnabled: true,
  sampleRate: 96000,
  framesPerBuffer: 128,
  channels: 2,
  outputGain: 1,
  autoLevelEnabled: true,
  autoLevelTargetRms: 0.028,
  autoLevelMinGain: 0.45,
  autoLevelMaxGain: 1.55,
  autoLevelResponse: 0.015,
  autoLevelGate: 0.007,
  noiseFloorMin: 0.00045,
  peakDecay: 0.93,
  bandLowHz: 180,
  bandMidHz: 2200,
  limiterThreshold: 0.82,
  limiterKnee: 0.16,
  restartMs: 1500,
  watchdogMs: 3000,
  logEveryTicks: 60
});
const AUDIO_REACTIVITY_SOURCE_CATALOG_DEFAULT = Object.freeze({
  smart: Object.freeze({ label: "SMART", description: "Adaptive blend" }),
  baseline: Object.freeze({ label: "BASE", description: "Steady RMS/body" }),
  bass: Object.freeze({ label: "BASS", description: "Low band" }),
  mids: Object.freeze({ label: "MIDS", description: "Mid band" }),
  highs: Object.freeze({ label: "HIGHS", description: "High band" }),
  peaks: Object.freeze({ label: "PEAKS", description: "Peak envelope" }),
  transients: Object.freeze({ label: "TRANS", description: "Attack spikes" }),
  flux: Object.freeze({ label: "FLUX", description: "Spectral motion" }),
  drums: Object.freeze({ label: "DRUMS", description: "Percussive blend" }),
  vocals: Object.freeze({ label: "VOCALS", description: "Vocal focus" }),
  beat: Object.freeze({ label: "BEAT", description: "Beat confidence" }),
  groove: Object.freeze({ label: "GROOVE", description: "Body blend" })
});
const AUDIO_REACTIVITY_TARGET_KEYS = Object.freeze(["hue", "wiz", "other"]);
const META_AUTO_TEMPO_TRACKER_KEYS = Object.freeze([
  "baseline",
  "peaks",
  "transients",
  "flux"
]);
const AUDIO_REACTIVITY_MAP_DEFAULT = Object.freeze({
  version: 1,
  reactivityGainMode: "auto",
  reactivityGain: 1,
  hardwareRateLimitsEnabled: false,
  metaAutoHueWizBaselineBlend: true,
  metaAutoTempoTrackersAuto: false,
  metaAutoTempoTrackers: Object.freeze({
    baseline: true,
    peaks: true,
    transients: true,
    flux: true
  }),
  targets: Object.freeze({
    hue: Object.freeze({ enabled: true, amount: 1, sources: Object.freeze(["smart", "baseline", "bass", "mids", "highs", "peaks", "transients", "flux", "drums", "vocals", "beat", "groove"]) }),
    wiz: Object.freeze({ enabled: true, amount: 1, sources: Object.freeze(["smart", "baseline", "bass", "mids", "highs", "peaks", "transients", "flux", "drums", "vocals", "beat", "groove"]) }),
    other: Object.freeze({ enabled: true, amount: 1, sources: Object.freeze(["smart", "baseline", "bass", "mids", "highs", "peaks", "transients", "flux", "drums", "vocals", "beat", "groove"]) })
  })
});
const AUDIO_REACTIVITY_SOURCE_ORDER = Object.freeze([
  "smart",
  "baseline",
  "bass",
  "mids",
  "highs",
  "peaks",
  "transients",
  "flux",
  "drums",
  "vocals",
  "beat",
  "groove"
]);

const AUDIO_APP_STATUS_HOLD_DEFAULT_MS = 2200;
let audioAppIsolationStatusHoldUntil = 0;
const AUDIO_APPLY_ATTENTION_KEY_CONFIG = "config";
const AUDIO_APPLY_ATTENTION_KEY_ISO = "iso";
const AUDIO_APPLY_ATTENTION_KEY_MANUAL = "manual";
const audioApplyAttentionState = {
  config: false,
  iso: false,
  manual: false
};

function getAudioApplyAttentionTargets(kind = AUDIO_APPLY_ATTENTION_KEY_CONFIG) {
  const key = String(kind || "").trim().toLowerCase();
  if (key === AUDIO_APPLY_ATTENTION_KEY_MANUAL) {
    return [el.aAppIsoManualSetBtn].filter(Boolean);
  }
  if (key === AUDIO_APPLY_ATTENTION_KEY_ISO) {
    return [el.aApplyBtn].filter(Boolean);
  }
  return [el.aApplyBtn].filter(Boolean);
}

function setAudioApplyAttention(kind = AUDIO_APPLY_ATTENTION_KEY_CONFIG, enabled = false) {
  const normalizedKey = String(kind || "").trim().toLowerCase();
  const key = normalizedKey === AUDIO_APPLY_ATTENTION_KEY_ISO
    ? AUDIO_APPLY_ATTENTION_KEY_ISO
    : (normalizedKey === AUDIO_APPLY_ATTENTION_KEY_MANUAL
      ? AUDIO_APPLY_ATTENTION_KEY_MANUAL
      : AUDIO_APPLY_ATTENTION_KEY_CONFIG);
  audioApplyAttentionState[key] = enabled === true;
  for (const button of getAudioApplyAttentionTargets(key)) {
    button.classList.toggle("audioNeedsApply", audioApplyAttentionState[key] === true);
  }
}

function pulseAudioApplyAttention(kind = AUDIO_APPLY_ATTENTION_KEY_CONFIG) {
  const targets = getAudioApplyAttentionTargets(kind);
  for (const button of targets) {
    button.classList.remove("audioNeedsApplyPulse");
    setTimeout(() => {
      button.classList.add("audioNeedsApplyPulse");
      setTimeout(() => button.classList.remove("audioNeedsApplyPulse"), 900);
    }, 20);
  }
}

function markAudioApplyAttention(kind = AUDIO_APPLY_ATTENTION_KEY_CONFIG) {
  setAudioApplyAttention(kind, true);
  pulseAudioApplyAttention(kind);
}

function clearAudioApplyAttention(kind = AUDIO_APPLY_ATTENTION_KEY_CONFIG) {
  setAudioApplyAttention(kind, false);
}

function announceAudioActionStatus(text = "", holdMs = AUDIO_APP_STATUS_HOLD_DEFAULT_MS) {
  updateAudioAppIsolationStatusText(text, { holdMs, priority: "action" });
  if (el.aAudioActionStatus) {
    const line = String(text || "").trim() || "Audio actions idle.";
    el.aAudioActionStatus.value = line;
  }
}

function updateAudioAppIsolationStatusText(text = "", options = {}) {
  const line = String(text || "").trim() || "App source scan idle.";
  const now = Date.now();
  const priority = String(options?.priority || "action").trim().toLowerCase();
  if (priority === "telemetry" && now < audioAppIsolationStatusHoldUntil) {
    return;
  }
  const holdMs = Number(options?.holdMs);
  if (Number.isFinite(holdMs) && holdMs > 0) {
    audioAppIsolationStatusHoldUntil = now + Math.max(80, Math.round(holdMs));
  }
  if (el.aAppIsolationStatus) el.aAppIsolationStatus.value = line;
  if (el.liveAudioAppSearchStat) el.liveAudioAppSearchStat.value = line;
}

function formatAudioApiErrorMessage(result, fallback = "request failed") {
  const response = result && typeof result === "object" ? result : null;
  const data = response?.data && typeof response.data === "object" ? response.data : null;
  const status = Math.max(0, Number(response?.status || 0));
  const base = String(data?.error || fallback || "request failed").trim() || "request failed";
  const retryAfter = Math.max(0, Number(data?.retryAfterSec || 0));
  if (status === 429 && retryAfter > 0) {
    return `${base} (rate limited, retry in ${retryAfter}s)`;
  }
  if (status > 0) {
    return `${base} (HTTP ${status})`;
  }
  return base;
}

function formatAudioApiRemoteWriteHint(result) {
  const response = result && typeof result === "object" ? result : null;
  const status = Math.max(0, Number(response?.status || 0));
  if (status !== 403) return "";
  const detail = String(response?.data?.detail || "").trim().toLowerCase();
  if (!detail.includes("loopback")) return "";
  return "control writes blocked from this browser host; open UI on http://127.0.0.1:5050 or set RAVELINK_ALLOW_REMOTE_WRITE=1";
}

function formatAudioApiErrorWithHint(result, fallback = "request failed") {
  const base = formatAudioApiErrorMessage(result, fallback);
  const hint = formatAudioApiRemoteWriteHint(result);
  return hint ? `${base} | ${hint}` : base;
}

const {
  detectLimiterPreset,
  normalizeRustLoopbackFormatUi,
  syncRustLoopbackFormatHintUi,
  isAudioAppsShowAllUiEnabled,
  getAudioSelectableAppsUi,
  updateAudioAppsFilterHintUi,
  syncAudioRoutingComplexityUi,
  isAudioCaptureModeAppIsolationUiEnabled,
  syncAudioCaptureModeUi,
  setAudioAppSelectOptions,
  syncAudioToggleIndicatorsUi,
  formatAudioActiveConfigSummaryUi,
  computeAudioDeviceScanHintsUi,
  updateAudioCaptureGuidanceUi,
  applyAudioConfigToInputs,
  collectAudioConfigFromInputs,
  collectAudioAppIsolationPatchFromInputs
} = (typeof createAudioConfigRuntimeUi === "function"
  ? createAudioConfigRuntimeUi({
    el,
    ui,
    documentRef: document,
    normalizeAudioDeviceListUi,
    formatAudioDeviceListUi,
    normalizeAudioAppNameUi,
    normalizeAudioOutputEndpointNameUi,
    normalizeAudioAppTokenUi,
    detectAudioQuickProfile: config => detectAudioQuickProfile(config),
    syncAudioQuickPresetButtons: () => syncAudioQuickPresetButtons(),
    syncLimiterPresetButtons: () => syncLimiterPresetButtons(),
    syncAudioQuickTuningFromInputs: () => syncAudioQuickTuningFromInputs(),
    markAudioApplyAttention,
    clearAudioApplyAttention,
    updateAudioAppIsolationStatusText,
    AUDIO_APPLY_ATTENTION_KEY_CONFIG,
    AUDIO_APPLY_ATTENTION_KEY_ISO,
    AUDIO_APPLY_ATTENTION_KEY_MANUAL,
    audioApplyAttentionState,
    LIMITER_PRESETS
  })
  : (() => {
    throw new Error("audio config runtime module missing");
  })());

// [TITLE] Section: Audio App-Isolation Assist Runtime Composition
// [DEV] App-isolation helper token ranking + subprocess assist rendering moved into
// [DEV] a focused runtime module so queue/apply flows can evolve without growing
// [DEV] the audio orchestrator monolith.
const audioAppIsolationAssistRuntime = (typeof createAudioAppIsolationAssistRuntimeUi === "function"
  ? createAudioAppIsolationAssistRuntimeUi({
    el,
    ui,
    documentRef: document,
    normalizeAudioAppTokenUi,
    markAudioApplyAttention,
    clearAudioApplyAttention,
    AUDIO_APPLY_ATTENTION_KEY_MANUAL,
    setTimeoutRef: setTimeout
  })
  : (() => {
    throw new Error("audio app-isolation assist runtime module missing");
  })());
function normalizeAudioManualLockMapUi(value = {}) {
  return audioAppIsolationAssistRuntime.normalizeAudioManualLockMapUi(value);
}
function normalizeAudioProcessMetadataRowsUi(value = []) {
  return audioAppIsolationAssistRuntime.normalizeAudioProcessMetadataRowsUi(value);
}
function normalizeAudioCompanionMapUi(value = {}) {
  return audioAppIsolationAssistRuntime.normalizeAudioCompanionMapUi(value);
}
function getAudioSelectedPrimaryAppTokenUi() {
  return audioAppIsolationAssistRuntime.getAudioSelectedPrimaryAppTokenUi();
}
function syncAudioManualCaptureInputUi(options = {}) {
  return audioAppIsolationAssistRuntime.syncAudioManualCaptureInputUi(options);
}
function resolveAudioTokenSimilarityUi(aRaw, bRaw) {
  return audioAppIsolationAssistRuntime.resolveAudioTokenSimilarityUi(aRaw, bRaw);
}
function collectAudioLineageCompanionTokensUi(sourceToken = "") {
  return audioAppIsolationAssistRuntime.collectAudioLineageCompanionTokensUi(sourceToken);
}
function getAudioCompanionTokensForSelectedAppUi() {
  return audioAppIsolationAssistRuntime.getAudioCompanionTokensForSelectedAppUi();
}
function renderAudioCompanionAssistUi(options = {}) {
  return audioAppIsolationAssistRuntime.renderAudioCompanionAssistUi(options);
}
function renderAudioManualCaptureAssistUi(options = {}) {
  return audioAppIsolationAssistRuntime.renderAudioManualCaptureAssistUi(options);
}
function normalizeAudioExecutableDirUi(value = "") {
  return audioAppIsolationAssistRuntime.normalizeAudioExecutableDirUi(value);
}
function hasAudioCompanionTokenHintUi(token = "") {
  return audioAppIsolationAssistRuntime.hasAudioCompanionTokenHintUi(token);
}
function buildAudioProcessGraphUi(rows = []) {
  return audioAppIsolationAssistRuntime.buildAudioProcessGraphUi(rows);
}
function hasAudioProcessTreeRelationshipUi(sourceToken = "", candidateToken = "", graph = null) {
  return audioAppIsolationAssistRuntime.hasAudioProcessTreeRelationshipUi(sourceToken, candidateToken, graph);
}
function hasAudioExecutableDirRelationshipUi(sourceToken = "", candidateToken = "", graph = null) {
  return audioAppIsolationAssistRuntime.hasAudioExecutableDirRelationshipUi(sourceToken, candidateToken, graph);
}
function collectAudioManualCaptureSuggestionsUi() {
  return audioAppIsolationAssistRuntime.collectAudioManualCaptureSuggestionsUi();
}
function renderAudioManualCaptureSuggestionsUi() {
  return audioAppIsolationAssistRuntime.renderAudioManualCaptureSuggestionsUi();
}

const AUDIO_BUTTON_MIN_BUSY_MS = 320;
const AUDIO_BUTTON_RESULT_HOLD_MS = 1200;

async function runAudioButtonAction(button, busyLabel, action) {
  if (!button || typeof action !== "function") {
    return typeof action === "function" ? action() : false;
  }
  if (button.dataset.audioBusy === "1") return false;

  const idleLabel = String(button.dataset.audioIdleLabel || button.textContent || "").trim();
  const startedAt = Date.now();
  if (!button.dataset.audioIdleLabel) {
    button.dataset.audioIdleLabel = idleLabel;
  }
  button.classList.add("audioActionPressed");
  setTimeout(() => {
    button.classList.remove("audioActionPressed");
  }, 180);
  button.dataset.audioBusy = "1";
  button.classList.add("busy");
  button.disabled = true;
  button.textContent = String(busyLabel || "WORKING...").trim() || "WORKING...";
  try {
    return await action();
  } finally {
    const elapsedMs = Math.max(0, Date.now() - startedAt);
    if (elapsedMs < AUDIO_BUTTON_MIN_BUSY_MS) {
      await new Promise(resolve => setTimeout(resolve, AUDIO_BUTTON_MIN_BUSY_MS - elapsedMs));
    }
    button.dataset.audioBusy = "0";
    button.classList.remove("busy");
    button.disabled = false;
    button.textContent = button.dataset.audioIdleLabel || idleLabel || button.textContent;
  }
}

async function flashAudioButtonOutcome(button, options = {}) {
  if (!button) return;
  const ok = options?.ok === true;
  const holdMs = Math.max(220, Math.round(Number(options?.holdMs || AUDIO_BUTTON_RESULT_HOLD_MS)));
  const idleLabel = String(button.dataset.audioIdleLabel || button.textContent || "").trim();
  const label = String(
    options?.label ||
    (ok ? "DONE" : "FAILED")
  ).trim() || (ok ? "DONE" : "FAILED");
  const className = ok ? "audioActionOk" : "audioActionBad";
  button.classList.add(className);
  button.textContent = label;
  await new Promise(resolve => setTimeout(resolve, holdMs));
  button.classList.remove(className);
  button.textContent = button.dataset.audioIdleLabel || idleLabel || button.textContent;
}

async function runAudioButtonActionWithResult(button, busyLabel, action, options = {}) {
  let result = {
    ok: false,
    labelOk: String(options?.labelOk || "DONE"),
    labelFail: String(options?.labelFail || "FAILED"),
    holdMs: Number(options?.holdMs || AUDIO_BUTTON_RESULT_HOLD_MS)
  };
  try {
    await runAudioButtonAction(button, busyLabel, async () => {
      const value = await action();
      if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "ok")) {
        result = {
          ...result,
          ...value
        };
      } else if (typeof value === "boolean") {
        result.ok = value === true;
      } else {
        result.ok = true;
      }
    });
  } catch (err) {
    result.ok = false;
    const detail = String(err?.message || err || "").trim();
    if (detail) {
      announceAudioActionStatus(`AUDIO ACTION ERROR | ${detail}`, 3600);
    }
  }
  await flashAudioButtonOutcome(button, {
    ok: result.ok === true,
    label: result.ok ? result.labelOk : result.labelFail,
    holdMs: result.holdMs
  });
  return result.ok === true;
}

function renderAudioOptionalToolsBanner() {
  if (!el.aOptionalToolsBanner || !el.aOptionalToolsBadge || !el.aOptionalToolsText) return;
  const status = ui.audioOptionalToolsStatus && typeof ui.audioOptionalToolsStatus === "object"
    ? ui.audioOptionalToolsStatus
    : null;
  if (!status || String(status.platform || "").trim() !== "win32") {
    el.aOptionalToolsBanner.classList.add("hidden");
    return;
  }

  const ffmpegOk = status?.checks?.ffmpeg?.available === true;
  const procTapOk = status?.checks?.procTap?.available === true;
  const rustKernelOk = status?.checks?.rustAudioKernel?.available === true;
  const rustLoopOk = status?.checks?.rustLoopback?.available === true;
  const rustRuntimeOk = rustKernelOk || rustLoopOk;
  const ready = status.optionalToolsReady === true;
  const needsInstall = status.needsOptionalInstall === true;
  const dismissed = ui.audioOptionalToolsDismissed === true;
  const showBanner = needsInstall || !dismissed;
  if (!showBanner) {
    el.aOptionalToolsBanner.classList.add("hidden");
    return;
  }

  el.aOptionalToolsBanner.classList.remove("hidden", "ok", "warn");
  el.aOptionalToolsBanner.classList.add(ready ? "ok" : "warn");
  el.aOptionalToolsBadge.className = `statusPill ${ready ? "ok" : "warn"}`;
  el.aOptionalToolsBadge.textContent = ready ? "INSTALLED" : "OPTIONAL INSTALL AVAILABLE";

  const scriptName = String(status?.installScript?.fileName || "RaveLink-Bridge-Install-Optional-Audio-Tools.bat");
  const strategy = String(status?.recommendedCaptureStrategy || "").trim().toLowerCase();
  if (ready) {
    const strategyLine = strategy === "force_rust"
      ? " Rust runtime is available; forcing Rust capture is supported."
      : strategy === "auto_rust_first"
        ? " Auto Rust-first strategy is recommended on this machine."
        : "";
    el.aOptionalToolsText.innerHTML =
      `Advanced app-isolation tools are installed.${escapeHtmlUi(strategyLine)} You can reinstall any time using <code>${escapeHtmlUi(scriptName)}</code>.`;
    return;
  }

  const missingParts = [];
  if (!rustRuntimeOk && !ffmpegOk) missingParts.push("rust runtime or ffmpeg");
  if (!rustRuntimeOk && !procTapOk) missingParts.push("process loopback tools");
  const missingWord = missingParts.length ? missingParts.join(" + ") : "optional tools";
  el.aOptionalToolsText.innerHTML =
    `Optional advanced app-isolation needs <b>${escapeHtmlUi(missingWord)}</b>. Install with one click from Start Menu: <b>RaveLink Bridge > Install Optional Audio Tools</b>.`;
}

function openAudioOptionalToolsHelp() {
  const status = ui.audioOptionalToolsStatus && typeof ui.audioOptionalToolsStatus === "object"
    ? ui.audioOptionalToolsStatus
    : null;
  const scriptName = String(status?.installScript?.fileName || "RaveLink-Bridge-Install-Optional-Audio-Tools.bat");
  const startMenuHint = String(
    status?.installScript?.startMenuHint || "Start Menu > RaveLink Bridge > Install Optional Audio Tools"
  );
  const lines = [
    "Optional Audio Tools Setup",
    "",
    "1) Open:",
    `   ${startMenuHint}`,
    "",
    "2) If using portable ZIP, run this file from app folder:",
    `   ${scriptName}`,
    "",
    "3) Wait for installer window to finish, then click REFRESH CFG in AUDIO tab."
  ];
  window.alert(lines.join("\n"));
}

async function loadAudioOptionalToolsStatus() {
  const r = await audioEndpointsAdapter.getOptionalToolsStatus();
  if (!r || !r.ok || !r.status || typeof r.status !== "object") return false;
  ui.audioOptionalToolsStatus = { ...r.status };
  renderAudioOptionalToolsBanner();
  return true;
}

const {
  applyAudioAppIsolationTelemetry,
  formatAudioAppIsoScanSummary
} = (typeof createAudioTelemetryFormattersUi === "function"
  ? createAudioTelemetryFormattersUi({
    el,
    ui,
    normalizeAudioAppNameUi,
    normalizeAudioAppTokenUi,
    updateAudioAppIsolationStatusText,
    getUiPrimaryApp: () => String(el.aAppPrimary?.value || ""),
    getPendingApplyState: () => Boolean(
      audioAppIsolationAutoApplyTimer ||
      audioAppIsolationAutoApplyInFlight ||
      audioAppIsolationPendingForceScan ||
      audioAppIsolationReplayPending
    )
  })
  : (() => {
    throw new Error("audio telemetry formatters module missing");
  })());

const {
  updateAudioTelemetry
} = (typeof createAudioTelemetryRuntimeUi === "function"
  ? createAudioTelemetryRuntimeUi({
    el,
    clampNumber,
    toFixedSafe,
    updateAudioCaptureGuidanceUi,
    applyAudioAppIsolationTelemetry
  })
  : (() => {
    throw new Error("audio telemetry runtime module missing");
  })());

async function loadAudioApps(options = {}) {
  const applyTelemetry = options?.applyTelemetry !== false;
  const forceRefresh = options?.forceRefresh === true;
  const showAllEnabled = isAudioAppsShowAllUiEnabled();
  const showAllProcesses = options?.showAllOverride === true || (
    options?.showAllOverride !== false && showAllEnabled === true
  );
  const query = new URLSearchParams();
  query.set("includeAudioHints", "1");
  query.set("includeProcessMeta", "1");
  if (showAllProcesses) query.set("expandInstances", "1");
  if (forceRefresh) query.set("_", String(Date.now()));
  let r = await audioEndpointsAdapter.getApps(query);
  if ((!r || !r.ok || !Array.isArray(r.apps)) && query.get("includeProcessMeta") === "1") {
    // Fallback path for slower systems where process metadata scan times out.
    query.delete("includeProcessMeta");
    r = await audioEndpointsAdapter.getApps(query);
  }
  if (!r || !r.ok || !Array.isArray(r.apps)) {
    ui.audioAppsLoaded = false;
    return false;
  }
  ui.audioRunningApps = r.apps.slice();
  ui.audioRunningProcessMetadata = normalizeAudioProcessMetadataRowsUi(r.processMetadata || []);
  ui.audioCompanionMap = normalizeAudioCompanionMapUi(r.audioHints?.companionMap || {});
  ui.audioAppHintMeta = r.audioHints && typeof r.audioHints === "object"
    ? { ...r.audioHints }
    : null;
  ui.audioAudioCapableTokens = Array.isArray(r.audioHints?.audioTokens)
    ? r.audioHints.audioTokens
      .map(token => normalizeAudioAppTokenUi(token))
      .filter(Boolean)
    : [];
  ui.audioAppsLoaded = true;
  setAudioAppSelectOptions(el.aAppPrimary, el.aAppPrimary?.value || "");
  setAudioAppSelectOptions(el.aAppFallback, el.aAppFallback?.value || "");
  updateAudioAppsFilterHintUi();
  syncAudioManualCaptureInputUi();
  if (applyTelemetry) applyAudioAppIsolationTelemetry(r.telemetry || null);
  return true;
}

async function loadAudioAppIsolationLocks(options = {}) {
  const r = await audioEndpointsAdapter.getAppIsolationLocks();
  if (!r || !r.ok) return false;
  ui.audioAppIsoManualLocks = normalizeAudioManualLockMapUi(r.locks || {});
  if (options?.syncInput !== false) {
    syncAudioManualCaptureInputUi({ force: options?.forceInput === true });
  }
  if (options?.applyTelemetry !== false && r.telemetry && typeof r.telemetry === "object") {
    applyAudioAppIsolationTelemetry(r.telemetry);
  }
  return true;
}

async function forceAudioAppIsolationScan(options = {}) {
  const payload = {};
  if (options?.forceRestart === true) payload.forceRestart = true;
  if (options?.apply === false) payload.apply = false;
  if (options?.force === false) payload.force = false;
  const reason = String(options?.reason || "").trim();
  if (reason) payload.reason = reason;
  const r = await audioEndpointsAdapter.scanAppIsolation(payload);
  if (!r.ok || !r.data) {
    return {
      ok: false,
      error: formatAudioApiErrorWithHint(r, "app isolation scan failed")
    };
  }
  const reloadApps = options?.reloadApps !== false;
  if (reloadApps) {
    const appsReloaded = await loadAudioApps({ applyTelemetry: false, forceRefresh: true });
    if (!appsReloaded && Array.isArray(r.data.runningApps)) {
      ui.audioRunningApps = r.data.runningApps.slice();
      ui.audioRunningProcessMetadata = normalizeAudioProcessMetadataRowsUi(r.data.processMetadata || []);
      ui.audioCompanionMap = normalizeAudioCompanionMapUi(r.data?.audioHints?.companionMap || {});
      ui.audioAppHintMeta = null;
      ui.audioAudioCapableTokens = [];
      ui.audioAppsLoaded = true;
      setAudioAppSelectOptions(el.aAppPrimary, el.aAppPrimary?.value || "");
      setAudioAppSelectOptions(el.aAppFallback, el.aAppFallback?.value || "");
      updateAudioAppsFilterHintUi();
      syncAudioManualCaptureInputUi();
    }
  }
  if (r.data.config && typeof r.data.config === "object") {
    applyAudioConfigToInputs(r.data.config);
  }
  const telemetry = r.data.telemetry && typeof r.data.telemetry === "object"
    ? r.data.telemetry
    : null;
  applyAudioAppIsolationTelemetry(telemetry);
  const appIso = telemetry?.appIsolation && typeof telemetry.appIsolation === "object"
    ? telemetry.appIsolation
    : null;
  return {
    ok: true,
    error: "",
    running: telemetry?.running === true,
    runningApps: Math.max(0, Number(r.data?.runningApps?.length || appIso?.runningAppsCount || 0)),
    mode: String(appIso?.mode || "").trim(),
    selectedApp: normalizeAudioAppNameUi(appIso?.selectedApp || appIso?.primaryApp || ""),
    captureToken: normalizeAudioAppTokenUi(appIso?.captureToken || ""),
    captureResolverBackend: String(appIso?.captureResolverBackend || "").trim().toLowerCase()
  };
}

let audioAppIsolationAutoApplyTimer = null;
let audioAppIsolationAutoApplyInFlight = false;
let audioAppIsolationPendingForceScan = false;
let audioAppIsolationReplayPending = false;
let audioAppIsolationReplayForceScan = false;
let audioAppIsolationReplayReason = "APP ISO";

function syncUiLazy() {
  if (typeof sync === "function") {
    sync();
  }
}

function cancelQueuedAudioAppIsolationAutoApply() {
  if (audioAppIsolationAutoApplyTimer) {
    clearTimeout(audioAppIsolationAutoApplyTimer);
    audioAppIsolationAutoApplyTimer = null;
  }
  audioAppIsolationPendingForceScan = false;
  audioAppIsolationReplayPending = false;
  audioAppIsolationReplayForceScan = false;
  audioAppIsolationReplayReason = "APP ISO";
}

async function applyAudioAppIsolationPatch(reason = "APP ISO", options = {}) {
  if (audioAppIsolationAutoApplyInFlight) {
    audioAppIsolationReplayPending = true;
    if (options?.forceScan === true) audioAppIsolationReplayForceScan = true;
    if (String(reason || "").trim()) audioAppIsolationReplayReason = reason;
    return false;
  }
  audioAppIsolationAutoApplyInFlight = true;
  try {
    const forceScan = options?.forceScan === true;
    updateAudioAppIsolationStatusText(forceScan ? `${reason} APPLYING+SCAN` : `${reason} APPLYING`);
    const patch = collectAudioAppIsolationPatchFromInputs();
    if (patch.ffmpegAppIsolationEnabled === true && !normalizeAudioAppNameUi(patch.ffmpegAppIsolationPrimaryApp || "")) {
      const msg = `${reason} APPLY FAILED | SELECT MAIN APP FIRST`;
      updateAudioAppIsolationStatusText(msg);
      setBadge(el.health, "warn", "APP ISO NEEDS MAIN APP");
      announceAudioActionStatus(msg, 5200);
      return false;
    }
    const r = await audioEndpointsAdapter.saveConfig(patch);
    if (!r.ok) {
      updateAudioAppIsolationStatusText(`${reason} APPLY FAILED | ${formatAudioApiErrorWithHint(r, "save failed")}`);
      setBadge(el.health, "bad", `${reason} APPLY FAIL`);
      return false;
    }
    const savedConfig = r.data && typeof r.data.config === "object" ? r.data.config : null;
    const savedAppIsoEnabled = savedConfig?.ffmpegAppIsolationEnabled === true;
    if (patch.ffmpegAppIsolationEnabled !== savedAppIsoEnabled) {
      const desiredWord = patch.ffmpegAppIsolationEnabled ? "APP ISOLATION" : "DESKTOP LISTEN";
      const actualWord = savedAppIsoEnabled ? "APP ISOLATION" : "DESKTOP LISTEN";
      const mismatchLine = `${reason} APPLY FAILED | MODE MISMATCH | REQUESTED ${desiredWord} | SAVED ${actualWord}`;
      updateAudioAppIsolationStatusText(mismatchLine);
      setBadge(el.health, "bad", `${reason} MODE MISMATCH`);
      announceAudioActionStatus(mismatchLine, 6400);
      return false;
    }
    if (savedConfig) {
      applyAudioConfigToInputs(savedConfig);
    }
    await loadAudioApps({ forceRefresh: true });
    let scanOk = true;
    let scanError = "";
    if (forceScan && savedAppIsoEnabled === true) {
      const scanResult = await forceAudioAppIsolationScan({
        reason: "ui_force_apply"
      });
      scanOk = scanResult?.ok === true;
      scanError = String(scanResult?.error || "").trim();
      if (!scanOk) {
        updateAudioAppIsolationStatusText(`${reason} SAVED | SCAN FAILED | ${scanError || "scan unavailable"}`);
      }
    }
    setBadge(
      el.health,
      scanOk ? "ok" : "bad",
      forceScan
        ? (
          scanOk
            ? (r.data && r.data.restarted ? `${reason} SAVED + SCAN + RESTART` : `${reason} SAVED + SCAN`)
            : `${reason} SAVED | SCAN FAIL`
        )
        : (r.data && r.data.restarted ? `${reason} SAVED + RESTART` : `${reason} SAVED`)
    );
    clearAudioApplyAttention(AUDIO_APPLY_ATTENTION_KEY_ISO);
    return scanOk;
  } finally {
    audioAppIsolationAutoApplyInFlight = false;
    if (audioAppIsolationReplayPending) {
      const replayReason = String(audioAppIsolationReplayReason || reason || "APP ISO").trim() || "APP ISO";
      const replayForceScan = audioAppIsolationReplayForceScan === true;
      audioAppIsolationReplayPending = false;
      audioAppIsolationReplayForceScan = false;
      audioAppIsolationReplayReason = "APP ISO";
      queueAudioAppIsolationAutoApply(replayReason, { forceScan: replayForceScan, delayMs: 70 });
    } else {
      const hasPending = Boolean(
        audioAppIsolationAutoApplyTimer ||
        audioAppIsolationAutoApplyInFlight ||
        audioAppIsolationPendingForceScan ||
        audioAppIsolationReplayPending
      );
      if (!hasPending) {
        const current = String(el.aAppIsolationStatus?.value || "").replace(/\s*\|\s*PENDING APPLY(?:\+SCAN)?\s*$/i, "");
        updateAudioAppIsolationStatusText(current || "APP ISO READY");
      }
    }
  }
}

function queueAudioAppIsolationAutoApply(reason = "APP ISO", options = {}) {
  if (audioAppIsolationAutoApplyTimer) {
    clearTimeout(audioAppIsolationAutoApplyTimer);
  }
  const forceScan = options?.forceScan === true;
  if (forceScan) {
    audioAppIsolationPendingForceScan = true;
  }
  updateAudioAppIsolationStatusText(
    forceScan
      ? "APP ISO UI CHANGED | PENDING APPLY+SCAN"
      : "APP ISO UI CHANGED | PENDING APPLY"
  );
  markAudioApplyAttention(AUDIO_APPLY_ATTENTION_KEY_ISO);
  const delayMs = Number.isFinite(Number(options?.delayMs))
    ? Math.max(40, Math.round(Number(options.delayMs)))
    : 220;
  audioAppIsolationAutoApplyTimer = setTimeout(() => {
    audioAppIsolationAutoApplyTimer = null;
    const pendingForceScan = audioAppIsolationPendingForceScan === true;
    audioAppIsolationPendingForceScan = false;
    applyAudioAppIsolationPatch(reason, { forceScan: pendingForceScan }).catch(() => {
      setBadge(el.health, "bad", `${reason} APPLY FAIL`);
      updateAudioAppIsolationStatusText("APP ISO APPLY FAILED");
    });
  }, delayMs);
}

function parseLooseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const token = String(value ?? "").trim().toLowerCase();
  if (!token) return fallback === true;
  if (["1", "true", "yes", "y", "on"].includes(token)) return true;
  if (["0", "false", "no", "n", "off"].includes(token)) return false;
  return fallback === true;
}

// [TITLE] Section: Audio Reactivity Map Runtime Composition
// [DEV] Reactivity normalization/load/save/bind behavior is delegated to a focused
// [DEV] runtime module so telemetry/live integrations can evolve without expanding
// [DEV] the core audio orchestrator file.
const {
  normalizeAudioReactivitySourceKeyUi,
  normalizeAudioReactivitySourcesUi,
  normalizeMetaAutoTempoTrackersUi,
  normalizeAudioReactivityMapUi,
  updateAudioReactivityPolicyUi,
  maybeApplySmartLiveReactivityPolicy,
  maybeRetuneSmartMatchFromTelemetry,
  setAudioReactivityMapStatus,
  refreshAudioReactivityMapStatus,
  markAudioReactivityMapDirty,
  applyAudioReactivityMapToUi,
  collectAudioReactivityMapFromUi,
  loadAudioReactivityMap,
  saveAudioReactivityMap,
  bindAudioReactivityMapUi
} = (typeof createAudioReactivityMapRuntimeUi === "function"
  ? createAudioReactivityMapRuntimeUi({
    el,
    ui,
    parseLooseBoolean,
    clampNumber,
    announceAudioActionStatus,
    runAudioButtonActionWithResult,
    audioEndpointsAdapter,
    AUDIO_REACTIVITY_SOURCE_CATALOG_DEFAULT,
    AUDIO_REACTIVITY_TARGET_KEYS,
    META_AUTO_TEMPO_TRACKER_KEYS,
    AUDIO_REACTIVITY_MAP_DEFAULT,
    AUDIO_REACTIVITY_SOURCE_ORDER
  })
  : (() => {
    throw new Error("audio reactivity map runtime module missing");
  })());

async function loadAudioConfig() {
  const r = await audioEndpointsAdapter.getConfig();
  if (!r || !r.ok) return false;
  applyAudioConfigToInputs(r.config || {});
  updateAudioTelemetry(r.telemetry || null);
  await loadAudioAppIsolationLocks({ syncInput: true, forceInput: true, applyTelemetry: false });
  ui.audioConfigLoaded = true;
  return true;
}

async function loadAudioDevices() {
  const r = await audioEndpointsAdapter.getDevices();
  if (!r || !r.ok || !Array.isArray(r.devices)) {
    ui.audioDevicesLoaded = false;
    if (el.aDevices && (!el.aDevices.options || el.aDevices.options.length === 0)) {
      el.aDevices.innerHTML = "";
      const autoOpt = document.createElement("option");
      autoOpt.value = "";
      autoOpt.textContent = "AUTO SELECT";
      el.aDevices.appendChild(autoOpt);
      el.aDevices.value = "";
    }
    return false;
  }
  const rows = Array.isArray(r.devices) ? r.devices : [];
  const portAudioDevices = rows.filter(device => String(device?.backend || "").trim().toLowerCase() === "portaudio");
  let desktopOutputDevices = rows.filter(device => String(device?.backend || "").trim().toLowerCase() === "desktop_output");
  if (!desktopOutputDevices.length) {
    const hintedName = normalizeAudioOutputEndpointNameUi(r.defaultOutputEndpointHint?.name || "");
    if (hintedName) {
      desktopOutputDevices = [
        {
          id: "desktop-output:default",
          name: hintedName,
          backend: "desktop_output",
          active: true,
          isDefaultOutput: true,
          fallback: true
        }
      ];
    }
  }

  el.aDevices.innerHTML = "";
  const autoOpt = document.createElement("option");
  autoOpt.value = "";
  autoOpt.textContent = (desktopOutputDevices.length || portAudioDevices.length)
    ? "AUTO SELECT (DEFAULT OUTPUT)"
    : "AUTO SELECT (NO ACTIVE SOURCES DETECTED)";
  el.aDevices.appendChild(autoOpt);

  if (desktopOutputDevices.length) {
    const group = document.createElement("optgroup");
    group.label = "ACTIVE DESKTOP OUTPUTS";
    desktopOutputDevices.forEach(d => {
      const name = normalizeAudioOutputEndpointNameUi(d?.name || "");
      if (!name) return;
      const o = document.createElement("option");
      o.value = `desktop:${encodeURIComponent(name)}`;
      const isDefault = d?.isDefaultOutput === true;
      o.textContent = isDefault ? `${name} [DEFAULT]` : name;
      group.appendChild(o);
    });
    if (group.children.length > 0) {
      el.aDevices.appendChild(group);
    }
  }

  portAudioDevices.forEach(d => {
    const o = document.createElement("option");
    o.value = `portaudio:${String(d.id)}`;
    o.textContent = `${d.id} | ${d.name} | ${d.hostAPIName}`;
    el.aDevices.appendChild(o);
  });

  const selectedDesktopOutput = normalizeAudioOutputEndpointNameUi(ui.audioConfiguredDesktopOutputDeviceName || "");
  const selectedDesktopValue = selectedDesktopOutput
    ? `desktop:${encodeURIComponent(selectedDesktopOutput)}`
    : "";
  const selectedId = String(el.aDeviceId?.value || "").trim();
  const selectedPortaudioValue = selectedId ? `portaudio:${selectedId}` : "";
  const allOptions = Array.from(el.aDevices.options || []);
  if (selectedDesktopValue && !allOptions.some(option => option.value === selectedDesktopValue)) {
    const missingOpt = document.createElement("option");
    missingOpt.value = selectedDesktopValue;
    missingOpt.textContent = `${selectedDesktopOutput} [NOT ACTIVE]`;
    el.aDevices.appendChild(missingOpt);
    allOptions.push(missingOpt);
  }
  if (selectedDesktopValue && allOptions.some(option => option.value === selectedDesktopValue)) {
    el.aDevices.value = selectedDesktopValue;
  } else if (selectedPortaudioValue && allOptions.some(option => option.value === selectedPortaudioValue)) {
    el.aDevices.value = selectedPortaudioValue;
  } else {
    el.aDevices.value = "";
  }
  ui.audioDefaultOutputEndpointName = normalizeAudioOutputEndpointNameUi(r.defaultOutputEndpointHint?.name || "");
  ui.audioLastDeviceScanCount = r.devices.length;
  const deviceHints = computeAudioDeviceScanHintsUi(r.devices);
  ui.audioHasLoopbackDevice = deviceHints.hasLoopback === true;
  ui.audioHasVirtualCableDevice = deviceHints.hasVirtualCable === true;
  ui.audioDetectedUsbAudio = deviceHints.hasUsbAudio === true;
  updateAudioCaptureGuidanceUi();
  ui.audioDevicesLoaded = true;

  return true;
}

const {
  AUDIO_QUICK_TUNE_BOUNDS,
  AUDIO_QUICK_TUNE_STAGES,
  clamp01Ui,
  linearToPctUi,
  pctToLinearUi,
  logToPctUi,
  pctToLogUi,
  mapLimiterThresholdToControlPct,
  mapControlPctToLimiterThreshold,
  getNearestAudioQuickTuneStage,
  getAudioQuickTuneProfileInterpolatedPcts
} = (typeof createAudioQuickTuneMathUi === "function"
  ? createAudioQuickTuneMathUi()
  : (() => {
    throw new Error("audio quick tune utils module missing");
  })());
const {
  setAudioProfileStatusUi,
  renderAudioProfilesUi,
  loadAudioProfiles,
  wireAudioProfileControlsUi
} = (typeof createAudioProfilesUi === "function"
  ? createAudioProfilesUi({
    el,
    ui,
    normalizeAudioProfileNameUi,
    getAudioProfiles: () => audioEndpointsAdapter.getProfiles(),
    saveAudioProfile: name => audioEndpointsAdapter.saveProfile(name),
    applyAudioProfile: name => audioEndpointsAdapter.applyProfile(name),
    deleteAudioProfile: name => audioEndpointsAdapter.deleteProfile(name),
    formatAudioApiErrorWithHint,
    runAudioButtonActionWithResult,
    announceAudioActionStatus,
    applyAudioConfigToInputs
  })
  : (() => {
    throw new Error("audio profiles module missing");
  })());

// [TITLE] Section: Audio Quick-Tune Runtime Composition
// [DEV] Quick-tune slider math + preset stage mapping is delegated to a focused
// [DEV] runtime module while audio.js keeps stable, hoisted helper function names
// [DEV] used by existing startup and config flows.
const audioQuickTuneRuntime = (typeof createAudioQuickTuneRuntimeUi === "function"
  ? createAudioQuickTuneRuntimeUi({
    el,
    ui,
    documentRef: document,
    AUDIO_QUICK_PROFILES,
    AUDIO_CONFIG_DEFAULTS,
    audioQuickPresetButtons,
    AUDIO_QUICK_TUNE_BOUNDS,
    AUDIO_QUICK_TUNE_STAGES,
    clampNumber,
    clamp01Ui,
    linearToPctUi,
    pctToLinearUi,
    logToPctUi,
    pctToLogUi,
    mapLimiterThresholdToControlPct,
    mapControlPctToLimiterThreshold,
    getNearestAudioQuickTuneStage,
    getAudioQuickTuneProfileInterpolatedPcts
  })
  : (() => {
    throw new Error("audio quick-tune runtime module missing");
  })());
function detectAudioQuickProfile(config = {}) {
  return audioQuickTuneRuntime.detectAudioQuickProfile(config);
}
function getAudioQuickTuneSliderMap() {
  return audioQuickTuneRuntime.getAudioQuickTuneSliderMap();
}
function isAudioQuickSnapEnabled() {
  return audioQuickTuneRuntime.isAudioQuickSnapEnabled();
}
function normalizeAudioQuickTunePct(key = "", pct = 0, options = {}) {
  return audioQuickTuneRuntime.normalizeAudioQuickTunePct(key, pct, options);
}
function setAudioQuickTuneStageText(key = "", pct = 0, options = {}) {
  return audioQuickTuneRuntime.setAudioQuickTuneStageText(key, pct, options);
}
function syncAudioQuickProfileSliderFromPcts(pcts = {}) {
  return audioQuickTuneRuntime.syncAudioQuickProfileSliderFromPcts(pcts);
}
function syncAudioQuickTuningFromInputs() {
  return audioQuickTuneRuntime.syncAudioQuickTuningFromInputs();
}
function applyAudioQuickTuningSlidersToInputs() {
  return audioQuickTuneRuntime.applyAudioQuickTuningSlidersToInputs();
}
function applyAudioQuickProfileMixSliderToSliders() {
  return audioQuickTuneRuntime.applyAudioQuickProfileMixSliderToSliders();
}
function resetAudioQuickTuningToDefaults() {
  return audioQuickTuneRuntime.resetAudioQuickTuningToDefaults();
}
function syncAudioQuickPresetButtons() {
  return audioQuickTuneRuntime.syncAudioQuickPresetButtons();
}
function syncLimiterPresetButtons() {
  return audioQuickTuneRuntime.syncLimiterPresetButtons();
}
function applyAudioQuickProfile(name) {
  return audioQuickTuneRuntime.applyAudioQuickProfile(name);
}

// [TITLE] Section: Audio UI Event Wiring
// [DEV] This block owns event handlers for AUDIO tab controls and the live
// [DEV] app-isolation mini-surface. Keep badge text, payload shapes, and
// [DEV] auto-apply queueing behavior stable when editing.
const {
  wireAudioAppIsolationActionsUi
} = (typeof createAudioAppIsolationActionsUi === "function"
  ? createAudioAppIsolationActionsUi({
    el,
    ui,
    windowRef: window,
    localStorageRef: localStorage,
    AUDIO_SIMPLE_MODE_KEY,
    AUDIO_APPS_SHOW_ALL_KEY,
    AUDIO_OPTIONAL_TOOLS_DISMISS_KEY,
    isAudioCaptureModeAppIsolationUiEnabled,
    syncAudioCaptureModeUi,
    updateAudioCaptureGuidanceUi,
    cancelQueuedAudioAppIsolationAutoApply,
    applyAudioAppIsolationPatch,
    setBadge: (node, state, text) => typeof setBadge === "function" ? setBadge(node, state, text) : undefined,
    announceAudioActionStatus,
    syncAudioRoutingComplexityUi,
    setAudioAppSelectOptions,
    updateAudioAppsFilterHintUi,
    isAudioAppsShowAllUiEnabled,
    loadAudioApps,
    getAudioSelectableAppsUi,
    openAudioOptionalToolsHelp,
    renderAudioOptionalToolsBanner,
    runAudioButtonActionWithResult,
    loadAudioConfig,
    loadAudioReactivityMap,
    loadAudioOptionalToolsStatus,
    loadAudioDevices,
    loadAudioProfiles,
    formatAudioActiveConfigSummaryUi,
    forceAudioAppIsolationScan,
    formatAudioAppIsoScanSummary,
    setAppIsolationLock: payload => audioEndpointsAdapter.setAppIsolationLock(payload),
    clearAppIsolationLock: payload => audioEndpointsAdapter.clearAppIsolationLock(payload),
    getAudioSelectedPrimaryAppTokenUi,
    normalizeAudioAppTokenUi,
    formatAudioApiErrorWithHint,
    normalizeAudioManualLockMapUi,
    syncAudioManualCaptureInputUi,
    clearAudioApplyAttention,
    AUDIO_APPLY_ATTENTION_KEY_MANUAL,
    renderAudioManualCaptureAssistUi,
    markAudioApplyAttention,
    queueAudioAppIsolationAutoApply,
    syncRustLoopbackFormatHintUi,
    normalizeRustLoopbackFormatUi,
    updateAudioAppIsolationStatusText,
    sync: syncUiLazy
  })
  : (() => {
    throw new Error("audio app isolation actions module missing");
  })());
const {
  wireAudioConfigActionsUi
} = (typeof createAudioConfigActionsUi === "function"
  ? createAudioConfigActionsUi({
    el,
    ui,
    windowRef: window,
    documentRef: document,
    syncAudioQuickPresetButtons,
    applyAudioQuickTuningSlidersToInputs,
    applyAudioQuickProfileMixSliderToSliders,
    syncAudioQuickTuningFromInputs,
    detectLimiterPreset,
    syncLimiterPresetButtons,
    runAudioButtonActionWithResult,
    resetAudioQuickTuningToDefaults,
    setBadge: (node, state, text) => typeof setBadge === "function" ? setBadge(node, state, text) : undefined,
    markAudioApplyAttention,
    AUDIO_APPLY_ATTENTION_KEY_CONFIG,
    announceAudioActionStatus,
    saveAudioConfig: patch => audioEndpointsAdapter.saveConfig(patch),
    restartAudioEngine: () => audioEndpointsAdapter.restart(),
    formatAudioApiErrorWithHint,
    applyAudioConfigToInputs,
    clearAudioApplyAttention,
    formatAudioActiveConfigSummaryUi,
    applyAudioQuickProfile,
    collectAudioConfigFromInputs,
    loadAudioApps,
    loadAudioConfig,
    sync: syncUiLazy,
    LIMITER_PRESETS,
    AUDIO_CONFIG_DEFAULTS
  })
  : (() => {
    throw new Error("audio config actions module missing");
  })());

wireAudioProfileControlsUi();
wireAudioAppIsolationActionsUi();
wireAudioConfigActionsUi();

const AUDIO_UI_WIRING_BUTTON_IDS = Object.freeze([
  "aTuningModeEasyBtn",
  "aTuningModeAdvancedBtn",
  "aQuickTuneResetBtn",
  "aQuickTuneApplyBtn",
  "aProfileSaveBtn",
  "aProfileLoadBtn",
  "aProfileDeleteBtn",
  "aRefreshBtn",
  "aScanBtn",
  "aAppsRefreshBtn",
  "aAppIsoManualSetBtn",
  "aAppIsoManualClearBtn",
  "aApplyBtn",
  "aRefreshAdvancedBtn",
  "aRestartBtn",
  "aResetDefaultsBtn"
]);

const AUDIO_UI_WIRING_OPTIONAL_BUTTON_IDS = new Set();

const AUDIO_UI_WIRING_CRITICAL_IDS = Object.freeze([
  "aInputBackend",
  "aPreferLegacyCapture",
  "aUseRustAudioKernel",
  "aUseRustSourceResolver",
  "aRustLoopbackFormat",
  "aFfmpegFormat",
  "aFfmpegDevice",
  "aFfmpegSources",
  "aCaptureGuidanceHint",
  "aAppIsolationEnabled",
  "aAppIsolationMultiSource",
  "aAppIsolationStrict",
  "aAppIsolationCheckMs",
  "aAppPrimary",
  "aAppFallback",
  "aAppIsoCompanionSelect",
  "aAppPrimarySources",
  "aAppFallbackSources",
  "aCaptureModeDesktop",
  "aCaptureModeAppIso",
  "aProfileName",
  "aProfileSelect",
  "aProfileStatus",
  "aAppsShowAll",
  "aSampleRate",
  "aFrames",
  "aChannels",
  "aGain",
  "aDeviceMatch",
  "aDeviceId",
  "aFfmpegPath",
  "aAutoLevelEnabled",
  "aAutoLevelTarget",
  "aAutoLevelMinGain",
  "aAutoLevelMaxGain",
  "aAutoLevelGate",
  "aNoise",
  "aPeakDecay",
  "aBandLowHz",
  "aBandMidHz",
  "aLimiterThreshold",
  "aLimiterKnee",
  "aRestartMs",
  "aLogTicks"
]);

const {
  runAudioUiWiringAudit,
  scheduleAudioStartupHydrateDeferredRetryUi,
  hydrateAudioStartupDataUi,
  initializeAudioDomainUiDeferred
} = (typeof createAudioRuntimeStartupUi === "function"
  ? createAudioRuntimeStartupUi({
    el,
    ui,
    documentRef: document,
    localStorageRef: localStorage,
    setBadge: (node, state, text) => typeof setBadge === "function" ? setBadge(node, state, text) : undefined,
    announceAudioActionStatus,
    setAudioProfileStatusUi,
    loadAudioProfiles,
    bindAudioReactivityMapUi,
    syncAudioCaptureModeUi,
    syncAudioRoutingComplexityUi,
    updateAudioAppsFilterHintUi,
    renderAudioOptionalToolsBanner,
    setAudioAppSelectOptions,
    loadAudioConfig,
    loadAudioApps,
    loadAudioDevices,
    normalizeAudioAppNameUi,
    AUDIO_UI_WIRING_BUTTON_IDS,
    AUDIO_UI_WIRING_OPTIONAL_BUTTON_IDS,
    AUDIO_UI_WIRING_CRITICAL_IDS,
    AUDIO_TUNING_MODE_KEY
  })
  : (() => {
    throw new Error("audio runtime startup module missing");
  })());

document.addEventListener("change", event => {
  const target = event?.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.type !== "checkbox") return;
  if (!target.closest('[data-tab="audio"]')) return;
  syncAudioToggleIndicatorsUi();
});

setTimeout(initializeAudioDomainUiDeferred, 0);




