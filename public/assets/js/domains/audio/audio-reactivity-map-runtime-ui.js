// [TITLE] Module: public/assets/js/domains/audio/audio-reactivity-map-runtime-ui.js
// [TITLE] Purpose: audio reactivity map normalization, persistence, and UI interaction runtime
// [TITLE] Functionality Index:
// [TITLE] - reactivity source/target normalization and metadata policy state
// [TITLE] - reactivity map status formatting + UI snapshot apply/collect
// [TITLE] - reactivity map load/save flows and control event wiring
// [DEV] Complex Flow:
// [DEV] This module keeps reactivity behavior deterministic across AUDIO/LIVE/TELEMETRY by
// [DEV] centralizing normalization and persistence in one bounded runtime surface.
function createAudioReactivityMapRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const parseLooseBoolean = typeof deps.parseLooseBoolean === "function"
    ? deps.parseLooseBoolean
    : ((value, fallback = false) => {
      if (typeof value === "boolean") return value;
      const token = String(value || "").trim().toLowerCase();
      if (!token) return fallback === true;
      if (["1", "true", "yes", "y", "on"].includes(token)) return true;
      if (["0", "false", "no", "n", "off"].includes(token)) return false;
      return fallback === true;
    });
  const clampNumber = typeof deps.clampNumber === "function"
    ? deps.clampNumber
    : ((value, min, max, fallback) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return Number(fallback);
      return Math.max(Number(min), Math.min(Number(max), parsed));
    });
  const announceAudioActionStatus = typeof deps.announceAudioActionStatus === "function"
    ? deps.announceAudioActionStatus
    : (() => {});
  const runAudioButtonActionWithResult = typeof deps.runAudioButtonActionWithResult === "function"
    ? deps.runAudioButtonActionWithResult
    : (async (_button, _busyLabel, action) => action());
  const audioEndpointsAdapter = deps.audioEndpointsAdapter && typeof deps.audioEndpointsAdapter === "object"
    ? deps.audioEndpointsAdapter
    : {};
  const AUDIO_REACTIVITY_SOURCE_CATALOG_DEFAULT = deps.AUDIO_REACTIVITY_SOURCE_CATALOG_DEFAULT && typeof deps.AUDIO_REACTIVITY_SOURCE_CATALOG_DEFAULT === "object"
    ? deps.AUDIO_REACTIVITY_SOURCE_CATALOG_DEFAULT
    : Object.freeze({});
  const AUDIO_REACTIVITY_TARGET_KEYS = Array.isArray(deps.AUDIO_REACTIVITY_TARGET_KEYS)
    ? deps.AUDIO_REACTIVITY_TARGET_KEYS
    : Object.freeze(["hue", "wiz", "other"]);
  const META_AUTO_TEMPO_TRACKER_KEYS = Array.isArray(deps.META_AUTO_TEMPO_TRACKER_KEYS)
    ? deps.META_AUTO_TEMPO_TRACKER_KEYS
    : Object.freeze(["baseline", "peaks", "transients", "flux"]);
  const AUDIO_REACTIVITY_MAP_DEFAULT = deps.AUDIO_REACTIVITY_MAP_DEFAULT && typeof deps.AUDIO_REACTIVITY_MAP_DEFAULT === "object"
    ? deps.AUDIO_REACTIVITY_MAP_DEFAULT
    : Object.freeze({ targets: Object.freeze({}) });
  const AUDIO_REACTIVITY_SOURCE_ORDER = Array.isArray(deps.AUDIO_REACTIVITY_SOURCE_ORDER)
    ? deps.AUDIO_REACTIVITY_SOURCE_ORDER
    : Object.freeze(["smart", "baseline", "bass", "mids", "highs", "peaks", "transients", "flux", "drums", "vocals", "beat", "groove"]);
  let audioReactivitySourceCatalogRuntime = { ...AUDIO_REACTIVITY_SOURCE_CATALOG_DEFAULT };
function normalizeAudioReactivitySourceKeyUi(value) {
  const key = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(audioReactivitySourceCatalogRuntime, key)
    ? key
    : "";
}

function normalizeAudioReactivitySourcesUi(value, fallback = AUDIO_REACTIVITY_SOURCE_ORDER) {
  const sourceList = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\s]+/)
      : [];
  const out = [];
  for (const source of sourceList) {
    const key = normalizeAudioReactivitySourceKeyUi(source);
    if (!key) continue;
    if (!out.includes(key)) out.push(key);
  }
  if (out.length) return out;

  const fallbackList = Array.isArray(fallback) ? fallback : [fallback];
  const normalizedFallback = fallbackList
    .map(normalizeAudioReactivitySourceKeyUi)
    .filter(Boolean);
  if (normalizedFallback.length) return [...new Set(normalizedFallback)];
  return AUDIO_REACTIVITY_SOURCE_ORDER.slice();
}

function normalizeMetaAutoTempoTrackersUi(input = {}, fallback = null) {
  const raw = input && typeof input === "object" ? input : {};
  const fb = fallback && typeof fallback === "object" ? fallback : {};
  const out = {};
  for (const key of META_AUTO_TEMPO_TRACKER_KEYS) {
    out[key] = parseLooseBoolean(raw[key], parseLooseBoolean(fb[key], true));
  }
  if (!META_AUTO_TEMPO_TRACKER_KEYS.some(key => out[key] === true)) {
    out.baseline = true;
  }
  return out;
}

function normalizeAudioReactivityMapUi(input = {}) {
  const raw = input && typeof input === "object" ? input : {};
  const rawTargets = raw.targets && typeof raw.targets === "object" ? raw.targets : {};
  const fallbackTargets = AUDIO_REACTIVITY_MAP_DEFAULT.targets || {};
  const targets = {};
  for (const target of AUDIO_REACTIVITY_TARGET_KEYS) {
    const targetRaw = rawTargets[target] && typeof rawTargets[target] === "object"
      ? rawTargets[target]
      : {};
    const fallback = fallbackTargets[target] || {};
    targets[target] = {
      enabled: parseLooseBoolean(targetRaw.enabled, parseLooseBoolean(fallback.enabled, true)),
      amount: clampNumber(targetRaw.amount, 0, 1.8, clampNumber(fallback.amount, 0, 1.8, 1)),
      sources: normalizeAudioReactivitySourcesUi(targetRaw.sources, fallback.sources || AUDIO_REACTIVITY_SOURCE_ORDER)
    };
  }
  const fallbackTrackers = normalizeMetaAutoTempoTrackersUi(
    AUDIO_REACTIVITY_MAP_DEFAULT.metaAutoTempoTrackers,
    AUDIO_REACTIVITY_MAP_DEFAULT.metaAutoTempoTrackers
  );
  const baselineBlend = parseLooseBoolean(
    raw.metaAutoHueWizBaselineBlend,
    parseLooseBoolean(fallbackTrackers.baseline, false)
  );
  const mergedTrackerRaw = {
    ...fallbackTrackers,
    baseline: baselineBlend,
    ...(
      raw.metaAutoTempoTrackers && typeof raw.metaAutoTempoTrackers === "object"
        ? raw.metaAutoTempoTrackers
        : {}
    )
  };
  const metaAutoTempoTrackers = normalizeMetaAutoTempoTrackersUi(
    mergedTrackerRaw,
    fallbackTrackers
  );

  const normalizeReactivityGainMode = (value, fallback = AUDIO_REACTIVITY_MAP_DEFAULT.reactivityGainMode) => {
    const token = String(value || "").trim().toLowerCase();
    if (token === "manual") return "manual";
    if (token === "auto") return "auto";
    return String(fallback || "auto").trim().toLowerCase() === "manual" ? "manual" : "auto";
  };
  const clampReactivityGain = (value, fallback = AUDIO_REACTIVITY_MAP_DEFAULT.reactivityGain) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return clampNumber(Number(fallback), 0.25, 3, 1);
    }
    return clampNumber(parsed, 0.25, 3, 1);
  };

  return {
    version: 1,
    reactivityGainMode: normalizeReactivityGainMode(
      raw.reactivityGainMode,
      AUDIO_REACTIVITY_MAP_DEFAULT.reactivityGainMode
    ),
    reactivityGain: clampReactivityGain(
      raw.reactivityGain,
      AUDIO_REACTIVITY_MAP_DEFAULT.reactivityGain
    ),
    metaAutoTempoTrackersAuto: parseLooseBoolean(
      raw.metaAutoTempoTrackersAuto,
      parseLooseBoolean(AUDIO_REACTIVITY_MAP_DEFAULT.metaAutoTempoTrackersAuto, false)
    ),
    hardwareRateLimitsEnabled: parseLooseBoolean(
      raw.hardwareRateLimitsEnabled,
      parseLooseBoolean(AUDIO_REACTIVITY_MAP_DEFAULT.hardwareRateLimitsEnabled, true)
    ),
    metaAutoHueWizBaselineBlend: metaAutoTempoTrackers.baseline === true,
    metaAutoTempoTrackers,
    targets
  };
}

function updateAudioReactivityPolicyUi() {
  const cfg = normalizeAudioReactivityMapUi(ui.audioReactivityMap || AUDIO_REACTIVITY_MAP_DEFAULT);
  if (el.reactHardwareRateLimitsEnabled) {
    el.reactHardwareRateLimitsEnabled.checked = cfg.hardwareRateLimitsEnabled !== false;
  }
}

function maybeApplySmartLiveReactivityPolicy() {
  updateAudioReactivityPolicyUi();
  return false;
}

function maybeRetuneSmartMatchFromTelemetry() {
  // Smart Match was removed. Keep this no-op to preserve call-site stability.
}

function setAudioReactivityMapStatus(text) {
  if (!el.reactMapStatus) return;
  el.reactMapStatus.value = String(text || '').trim();
}

function refreshAudioReactivityMapStatus() {
  const cfg = normalizeAudioReactivityMapUi(ui.audioReactivityMap || AUDIO_REACTIVITY_MAP_DEFAULT);
  const gainMode = String(cfg.reactivityGainMode || "auto").trim().toLowerCase() === "manual"
    ? "MANUAL"
    : "AUTO";
  const gainWord = `${clampNumber(cfg.reactivityGain, 0.25, 3, 1).toFixed(2)}x`;
  ui.metaAutoTempoTrackersAuto = cfg.metaAutoTempoTrackersAuto === true;
  const hardwareWord = cfg.hardwareRateLimitsEnabled ? "HW CAPS ON" : "HW CAPS OFF";
  const metaBlendWord = "META H/W FACTORS FULL-SPECTRUM+HZ";
  const trackerWord = "TRACKERS FULL-SPECTRUM LOCKED";
  const parts = [hardwareWord, metaBlendWord, trackerWord, `GAIN:${gainMode}@${gainWord}`];
  for (const target of AUDIO_REACTIVITY_TARGET_KEYS) {
    const row = cfg.targets[target] || {};
    const label = target === "other" ? "CUSTOM" : target.toUpperCase();
    const sources = Array.isArray(row.sources) && row.sources.length ? row.sources.join("+") : "smart";
    const amountWord = `${clampNumber(row.amount, 0, 1.8, 1).toFixed(2)}x`;
    parts.push(`${label}:${row.enabled ? sources : "off"}@${amountWord}`);
  }
  if (ui.audioReactivityMapDirty) {
    parts.push("UNSAVED");
  }
  setAudioReactivityMapStatus(parts.join(" | "));
  updateAudioReactivityPolicyUi();
}

function markAudioReactivityMapDirty() {
  ui.audioReactivityMap = collectAudioReactivityMapFromUi();
  ui.audioReactivityMapDirty = true;
  refreshAudioReactivityMapStatus();
}

function applyAudioReactivityMapToUi(config = {}, options = {}) {
  const normalized = normalizeAudioReactivityMapUi(config);
  ui.audioReactivityMap = normalized;
  ui.metaAutoTempoTrackersAuto = normalized.metaAutoTempoTrackersAuto === true;
  ui.metaAutoTempoTrackers = { ...normalizeMetaAutoTempoTrackersUi(normalized.metaAutoTempoTrackers) };
  if (!ui.metaAutoTempoTrackersActive || typeof ui.metaAutoTempoTrackersActive !== 'object') {
    ui.metaAutoTempoTrackersActive = { ...ui.metaAutoTempoTrackers };
  }
  ui.metaAutoHueWizBaselineBlend = normalized.metaAutoHueWizBaselineBlend === true;
  ui.audioReactivityMapDirty = options.markDirty === true;
  if (el.reactHardwareRateLimitsEnabled) {
    el.reactHardwareRateLimitsEnabled.checked = normalized.hardwareRateLimitsEnabled !== false;
  }
  if (el.reactGainMode) {
    el.reactGainMode.value = normalized.reactivityGainMode === "manual" ? "manual" : "auto";
  }
  if (el.reactGainManual) {
    const gainPct = Math.round(clampNumber(normalized.reactivityGain, 0.25, 3, 1) * 100);
    el.reactGainManual.value = String(gainPct);
  }
  if (el.reactGainManualVal) {
    el.reactGainManualVal.textContent = `${clampNumber(normalized.reactivityGain, 0.25, 3, 1).toFixed(2)}x`;
  }
  if (el.reactGainManual) {
    el.reactGainManual.disabled = normalized.reactivityGainMode !== "manual";
  }
  refreshAudioReactivityMapStatus();
  updateAudioReactivityPolicyUi();
}

function collectAudioReactivityMapFromUi() {
  const base = normalizeAudioReactivityMapUi(ui.audioReactivityMap || AUDIO_REACTIVITY_MAP_DEFAULT);
  base.reactivityGainMode = el.reactGainMode && String(el.reactGainMode.value || "").trim().toLowerCase() === "manual"
    ? "manual"
    : "auto";
  base.reactivityGain = el.reactGainManual
    ? clampNumber(Number(el.reactGainManual.value) / 100, 0.25, 3, base.reactivityGain || 1)
    : clampNumber(Number(base.reactivityGain), 0.25, 3, 1);
  base.hardwareRateLimitsEnabled = el.reactHardwareRateLimitsEnabled
    ? el.reactHardwareRateLimitsEnabled.checked !== false
    : true;
  base.metaAutoTempoTrackersAuto = ui.metaAutoTempoTrackersAuto === true;
  base.metaAutoTempoTrackers = normalizeMetaAutoTempoTrackersUi(
    ui.metaAutoTempoTrackers,
    base.metaAutoTempoTrackers
  );
  base.metaAutoHueWizBaselineBlend = base.metaAutoTempoTrackers.baseline === true;
  return normalizeAudioReactivityMapUi(base);
}

async function loadAudioReactivityMap() {
  const r = await audioEndpointsAdapter.getReactivityMap();
  if (!r || !r.ok || !r.config) return false;
  if (r.config.sourceCatalog && typeof r.config.sourceCatalog === "object") {
    audioReactivitySourceCatalogRuntime = { ...AUDIO_REACTIVITY_SOURCE_CATALOG_DEFAULT, ...r.config.sourceCatalog };
  }
  applyAudioReactivityMapToUi(r.config, { markDirty: false });
  maybeApplySmartLiveReactivityPolicy();
  ui.audioReactivityMapLoaded = true;
  return true;
}

async function saveAudioReactivityMap(options = {}) {
  const reset = options.reset === true;
  const payload = reset
    ? { reset: true }
    : collectAudioReactivityMapFromUi();
  const r = await audioEndpointsAdapter.saveReactivityMap(payload);
  if (!r.ok || !r.data?.config) return { ok: false, error: r.data?.error || "save failed" };
  if (r.data.config.sourceCatalog && typeof r.data.config.sourceCatalog === "object") {
    audioReactivitySourceCatalogRuntime = { ...AUDIO_REACTIVITY_SOURCE_CATALOG_DEFAULT, ...r.data.config.sourceCatalog };
  }
  applyAudioReactivityMapToUi(r.data.config, { markDirty: false });
  ui.audioReactivityMapLoaded = true;
  return { ok: true };
}

function bindAudioReactivityMapUi() {
  let saveDebounce = null;
  const scheduleSave = (delayMs = 320) => {
    if (saveDebounce) clearTimeout(saveDebounce);
    saveDebounce = setTimeout(async () => {
      saveDebounce = null;
      const saved = await saveAudioReactivityMap();
      if (saved?.ok) {
        announceAudioActionStatus("REACTIVITY GAIN SAVED", 1600);
      } else {
        announceAudioActionStatus(`REACTIVITY GAIN SAVE FAILED | ${saved?.error || "unknown error"}`, 3200);
      }
    }, Math.max(120, Math.round(Number(delayMs) || 320)));
  };

  if (el.reactHardwareRateLimitsEnabled) {
    el.reactHardwareRateLimitsEnabled.onchange = () => {
      markAudioReactivityMapDirty();
      scheduleSave();
    };
  }
  if (el.reactGainMode) {
    el.reactGainMode.onchange = () => {
      if (el.reactGainManual) {
        el.reactGainManual.disabled = String(el.reactGainMode.value || "").trim().toLowerCase() !== "manual";
      }
      markAudioReactivityMapDirty();
      scheduleSave();
    };
  }
  if (el.reactGainManual) {
    el.reactGainManual.oninput = () => {
      const gain = clampNumber(Number(el.reactGainManual.value) / 100, 0.25, 3, 1);
      if (el.reactGainManualVal) {
        el.reactGainManualVal.textContent = `${gain.toFixed(2)}x`;
      }
      markAudioReactivityMapDirty();
      scheduleSave(220);
    };
  }
  if (el.reactGainSaveBtn) {
    el.reactGainSaveBtn.onclick = async () => {
      await runAudioButtonActionWithResult(
        el.reactGainSaveBtn,
        "SAVING...",
        async () => {
          const saved = await saveAudioReactivityMap();
          if (!saved.ok) {
            announceAudioActionStatus(`REACTIVITY GAIN SAVE FAILED | ${saved.error || "unknown error"}`, 3600);
            return { ok: false, labelFail: "FAILED" };
          }
          announceAudioActionStatus("REACTIVITY GAIN SAVED", 1800);
          return { ok: true, labelOk: "SAVED" };
        }
      );
    };
  }

  updateAudioReactivityPolicyUi();
}
  return {
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
  };
}
