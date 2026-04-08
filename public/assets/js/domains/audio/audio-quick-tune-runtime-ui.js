// [TITLE] Module: public/assets/js/domains/audio/audio-quick-tune-runtime-ui.js
// [TITLE] Purpose: audio quick-tune slider/runtime behavior extracted from audio orchestrator
// [TITLE] Functionality Index:
// [TITLE] - quick profile detection + preset button sync
// [TITLE] - slider stage snapping and stage label projection
// [TITLE] - slider/input bidirectional sync and defaults reset
// [DEV] Complex Flow:
// [DEV] Quick-tune math is intentionally centralized so profile presets, slider stages,
// [DEV] and advanced audio config inputs remain deterministic when users bounce between
// [DEV] compact and advanced controls.
function createAudioQuickTuneRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const documentRef = deps.documentRef || document;
  const AUDIO_QUICK_PROFILES = deps.AUDIO_QUICK_PROFILES && typeof deps.AUDIO_QUICK_PROFILES === "object"
    ? deps.AUDIO_QUICK_PROFILES
    : Object.freeze({});
  const AUDIO_CONFIG_DEFAULTS = deps.AUDIO_CONFIG_DEFAULTS && typeof deps.AUDIO_CONFIG_DEFAULTS === "object"
    ? deps.AUDIO_CONFIG_DEFAULTS
    : Object.freeze({});
  const audioQuickPresetButtons = Array.isArray(deps.audioQuickPresetButtons)
    ? deps.audioQuickPresetButtons
    : [];
  const AUDIO_QUICK_TUNE_BOUNDS = deps.AUDIO_QUICK_TUNE_BOUNDS && typeof deps.AUDIO_QUICK_TUNE_BOUNDS === "object"
    ? deps.AUDIO_QUICK_TUNE_BOUNDS
    : Object.freeze({});
  const AUDIO_QUICK_TUNE_STAGES = deps.AUDIO_QUICK_TUNE_STAGES && typeof deps.AUDIO_QUICK_TUNE_STAGES === "object"
    ? deps.AUDIO_QUICK_TUNE_STAGES
    : Object.freeze({ profile: [] });
  const clampNumber = typeof deps.clampNumber === "function"
    ? deps.clampNumber
    : ((value, min, max, fallback) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return Number(fallback);
      return Math.max(Number(min), Math.min(Number(max), parsed));
    });
  const clamp01Ui = typeof deps.clamp01Ui === "function" ? deps.clamp01Ui : (value => clampNumber(value, 0, 1, 0));
  const linearToPctUi = typeof deps.linearToPctUi === "function" ? deps.linearToPctUi : ((_value, _min, _max, fallback = 0) => clamp01Ui(fallback));
  const pctToLinearUi = typeof deps.pctToLinearUi === "function" ? deps.pctToLinearUi : ((_pct, _min, _max, fallback = 0) => Number(fallback));
  const logToPctUi = typeof deps.logToPctUi === "function" ? deps.logToPctUi : ((_value, _min, _max, fallback = 0) => clamp01Ui(fallback));
  const pctToLogUi = typeof deps.pctToLogUi === "function" ? deps.pctToLogUi : ((_pct, _min, _max, fallback = 0) => Number(fallback));
  const mapLimiterThresholdToControlPct = typeof deps.mapLimiterThresholdToControlPct === "function"
    ? deps.mapLimiterThresholdToControlPct
    : (_value => 0.34);
  const mapControlPctToLimiterThreshold = typeof deps.mapControlPctToLimiterThreshold === "function"
    ? deps.mapControlPctToLimiterThreshold
    : (_pct => 0.82);
  const getNearestAudioQuickTuneStage = typeof deps.getNearestAudioQuickTuneStage === "function"
    ? deps.getNearestAudioQuickTuneStage
    : (() => null);
  const getAudioQuickTuneProfileInterpolatedPcts = typeof deps.getAudioQuickTuneProfileInterpolatedPcts === "function"
    ? deps.getAudioQuickTuneProfileInterpolatedPcts
    : (() => ({}));

function detectAudioQuickProfile(config = {}) {
  const sampleRate = Number(config.sampleRate);
  const framesPerBuffer = Number(config.framesPerBuffer ?? config.frames);
  const profileName = Object.keys(AUDIO_QUICK_PROFILES).find(name => {
    const profile = AUDIO_QUICK_PROFILES[name];
    return (
      Number(profile.sampleRate) === sampleRate &&
      Number(profile.framesPerBuffer) === framesPerBuffer
    );
  });
  return profileName || "";
}

function getAudioQuickTuneSliderMap() {
  return {
    gain: el.aQuickGain,
    noiseFloorMin: el.aQuickNoiseGate,
    autoLevelTargetRms: el.aQuickAutoTarget,
    autoLevelGate: el.aQuickAutoGate,
    limiterControl: el.aQuickLimiter
  };
}

function isAudioQuickSnapEnabled() {
  return el.aQuickSnapStages ? el.aQuickSnapStages.checked === true : true;
}

function normalizeAudioQuickTunePct(key = "", pct = 0, options = {}) {
  const clamped = clamp01Ui(pct, 0);
  if (options.allowSnap === false || !isAudioQuickSnapEnabled()) return clamped;
  const stage = getNearestAudioQuickTuneStage(key, clamped);
  if (!stage) return clamped;
  return clamp01Ui(Number(stage.pct || 0) / 100, clamped);
}

function setAudioQuickTuneStageText(key = "", pct = 0, options = {}) {
  const stageNodeByKey = {
    profile: el.aQuickProfileStage,
    gain: el.aQuickGainStage,
    noiseFloorMin: el.aQuickNoiseGateStage,
    autoLevelTargetRms: el.aQuickAutoTargetStage,
    autoLevelGate: el.aQuickAutoGateStage,
    limiterControl: el.aQuickLimiterStage
  };
  const node = stageNodeByKey[key];
  if (!node) return;
  const custom = options.custom === true;
  if (custom) {
    node.textContent = "STAGE: CUSTOM";
    return;
  }
  const stage = getNearestAudioQuickTuneStage(key, pct);
  node.textContent = stage?.label ? `STAGE: ${stage.label}` : "STAGE: CUSTOM";
}

function syncAudioQuickProfileSliderFromPcts(pcts = {}) {
  if (!el.aQuickProfileMix || !el.aQuickProfileMixVal) return;
  const points = AUDIO_QUICK_TUNE_STAGES.profile;
  let best = points[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const dist =
      Math.abs((Number(pcts.gain || 0) * 100) - Number(point.values.gain || 0)) +
      Math.abs((Number(pcts.noiseFloorMin || 0) * 100) - Number(point.values.noiseFloorMin || 0)) +
      Math.abs((Number(pcts.autoLevelTargetRms || 0) * 100) - Number(point.values.autoLevelTargetRms || 0)) +
      Math.abs((Number(pcts.autoLevelGate || 0) * 100) - Number(point.values.autoLevelGate || 0)) +
      Math.abs((Number(pcts.limiterControl || 0) * 100) - Number(point.values.limiterControl || 0));
    if (dist < bestDist) {
      bestDist = dist;
      best = point;
    }
  }
  const isCustom = bestDist > 30;
  const profilePct = isCustom
    ? clamp01Ui(Number(el.aQuickProfileMix.value) / 100, Number(best.pct) / 100)
    : clamp01Ui(Number(best.pct) / 100, 0.5);
  if (!isCustom) {
    el.aQuickProfileMix.value = String(Math.round(profilePct * 100));
  }
  el.aQuickProfileMixVal.textContent = `${Math.round(profilePct * 100)}%`;
  setAudioQuickTuneStageText("profile", profilePct, { custom: isCustom });
}

// [DEV] Quick tuning bridges compact slider controls and full audio config
// [DEV] fields. Keep conversion math and stage labels aligned so UI previews,
// [DEV] persisted values, and preset chips stay deterministic.
function syncAudioQuickTuningFromInputs() {
  if (!el.aQuickGain || !el.aQuickNoiseGate || !el.aQuickAutoTarget || !el.aQuickAutoGate || !el.aQuickLimiter) return;

  const gain = clampNumber(Number(el.aGain?.value), AUDIO_QUICK_TUNE_BOUNDS.gain.min, AUDIO_QUICK_TUNE_BOUNDS.gain.max, 1);
  const noiseFloorMin = clampNumber(
    Number(el.aNoise?.value),
    AUDIO_QUICK_TUNE_BOUNDS.noiseFloorMin.min,
    AUDIO_QUICK_TUNE_BOUNDS.noiseFloorMin.max,
    0.00045
  );
  const autoTarget = clampNumber(
    Number(el.aAutoLevelTarget?.value),
    AUDIO_QUICK_TUNE_BOUNDS.autoLevelTargetRms.min,
    AUDIO_QUICK_TUNE_BOUNDS.autoLevelTargetRms.max,
    0.028
  );
  const autoGate = clampNumber(
    Number(el.aAutoLevelGate?.value),
    AUDIO_QUICK_TUNE_BOUNDS.autoLevelGate.min,
    AUDIO_QUICK_TUNE_BOUNDS.autoLevelGate.max,
    0.007
  );
  const limiter = clampNumber(
    Number(el.aLimiterThreshold?.value),
    AUDIO_QUICK_TUNE_BOUNDS.limiterThreshold.min,
    AUDIO_QUICK_TUNE_BOUNDS.limiterThreshold.max,
    0.82
  );

  const gainPct = linearToPctUi(gain, AUDIO_QUICK_TUNE_BOUNDS.gain.min, AUDIO_QUICK_TUNE_BOUNDS.gain.max, 0.33);
  const noisePct = logToPctUi(
    noiseFloorMin,
    AUDIO_QUICK_TUNE_BOUNDS.noiseFloorMin.min,
    AUDIO_QUICK_TUNE_BOUNDS.noiseFloorMin.max,
    0.28
  );
  const autoTargetPct = linearToPctUi(
    autoTarget,
    AUDIO_QUICK_TUNE_BOUNDS.autoLevelTargetRms.min,
    AUDIO_QUICK_TUNE_BOUNDS.autoLevelTargetRms.max,
    0.31
  );
  const autoGatePct = linearToPctUi(
    autoGate,
    AUDIO_QUICK_TUNE_BOUNDS.autoLevelGate.min,
    AUDIO_QUICK_TUNE_BOUNDS.autoLevelGate.max,
    0.21
  );
  const limiterPct = mapLimiterThresholdToControlPct(limiter);

  el.aQuickGain.value = String(Math.round(gainPct * 100));
  el.aQuickNoiseGate.value = String(Math.round(noisePct * 100));
  el.aQuickAutoTarget.value = String(Math.round(autoTargetPct * 100));
  el.aQuickAutoGate.value = String(Math.round(autoGatePct * 100));
  el.aQuickLimiter.value = String(Math.round(limiterPct * 100));

  if (el.aQuickGainVal) el.aQuickGainVal.textContent = `${gain.toFixed(2)}x`;
  if (el.aQuickNoiseGateVal) el.aQuickNoiseGateVal.textContent = noiseFloorMin.toFixed(5);
  if (el.aQuickAutoTargetVal) el.aQuickAutoTargetVal.textContent = autoTarget.toFixed(3);
  if (el.aQuickAutoGateVal) el.aQuickAutoGateVal.textContent = autoGate.toFixed(3);
  if (el.aQuickLimiterVal) el.aQuickLimiterVal.textContent = `${Math.round(limiterPct * 100)}%`;

  setAudioQuickTuneStageText("gain", gainPct);
  setAudioQuickTuneStageText("noiseFloorMin", noisePct);
  setAudioQuickTuneStageText("autoLevelTargetRms", autoTargetPct);
  setAudioQuickTuneStageText("autoLevelGate", autoGatePct);
  setAudioQuickTuneStageText("limiterControl", limiterPct);
  syncAudioQuickProfileSliderFromPcts({
    gain: gainPct,
    noiseFloorMin: noisePct,
    autoLevelTargetRms: autoTargetPct,
    autoLevelGate: autoGatePct,
    limiterControl: limiterPct
  });
}

function applyAudioQuickTuningSlidersToInputs() {
  if (!el.aQuickGain || !el.aQuickNoiseGate || !el.aQuickAutoTarget || !el.aQuickAutoGate || !el.aQuickLimiter) return;

  let gainPct = normalizeAudioQuickTunePct("gain", Number(el.aQuickGain.value) / 100);
  let noisePct = normalizeAudioQuickTunePct("noiseFloorMin", Number(el.aQuickNoiseGate.value) / 100);
  let autoTargetPct = normalizeAudioQuickTunePct("autoLevelTargetRms", Number(el.aQuickAutoTarget.value) / 100);
  let autoGatePct = normalizeAudioQuickTunePct("autoLevelGate", Number(el.aQuickAutoGate.value) / 100);
  let limiterPct = normalizeAudioQuickTunePct("limiterControl", Number(el.aQuickLimiter.value) / 100);

  el.aQuickGain.value = String(Math.round(gainPct * 100));
  el.aQuickNoiseGate.value = String(Math.round(noisePct * 100));
  el.aQuickAutoTarget.value = String(Math.round(autoTargetPct * 100));
  el.aQuickAutoGate.value = String(Math.round(autoGatePct * 100));
  el.aQuickLimiter.value = String(Math.round(limiterPct * 100));

  const gain = pctToLinearUi(gainPct, AUDIO_QUICK_TUNE_BOUNDS.gain.min, AUDIO_QUICK_TUNE_BOUNDS.gain.max, 1);
  const noiseFloorMin = pctToLogUi(
    noisePct,
    AUDIO_QUICK_TUNE_BOUNDS.noiseFloorMin.min,
    AUDIO_QUICK_TUNE_BOUNDS.noiseFloorMin.max,
    0.00045
  );
  const autoTarget = pctToLinearUi(
    autoTargetPct,
    AUDIO_QUICK_TUNE_BOUNDS.autoLevelTargetRms.min,
    AUDIO_QUICK_TUNE_BOUNDS.autoLevelTargetRms.max,
    0.028
  );
  const autoGate = pctToLinearUi(
    autoGatePct,
    AUDIO_QUICK_TUNE_BOUNDS.autoLevelGate.min,
    AUDIO_QUICK_TUNE_BOUNDS.autoLevelGate.max,
    0.007
  );
  const limiter = mapControlPctToLimiterThreshold(limiterPct);

  if (el.aGain) el.aGain.value = gain.toFixed(2);
  if (el.aNoise) el.aNoise.value = noiseFloorMin.toFixed(5);
  if (el.aAutoLevelTarget) el.aAutoLevelTarget.value = autoTarget.toFixed(3);
  if (el.aAutoLevelGate) el.aAutoLevelGate.value = autoGate.toFixed(3);
  if (el.aLimiterThreshold) el.aLimiterThreshold.value = limiter.toFixed(2);

  syncAudioQuickTuningFromInputs();
}

function applyAudioQuickProfileMixSliderToSliders() {
  if (!el.aQuickProfileMix) return;
  let profilePct = normalizeAudioQuickTunePct("profile", Number(el.aQuickProfileMix.value) / 100);
  el.aQuickProfileMix.value = String(Math.round(profilePct * 100));
  if (el.aQuickProfileMixVal) el.aQuickProfileMixVal.textContent = `${Math.round(profilePct * 100)}%`;
  setAudioQuickTuneStageText("profile", profilePct);

  const sliderMap = getAudioQuickTuneSliderMap();
  const profilePcts = getAudioQuickTuneProfileInterpolatedPcts(profilePct);
  for (const [key, node] of Object.entries(sliderMap)) {
    if (!node) continue;
    const nextPct = normalizeAudioQuickTunePct(key, Number(profilePcts[key] || 0) / 100);
    node.value = String(Math.round(nextPct * 100));
  }
  applyAudioQuickTuningSlidersToInputs();
}

function resetAudioQuickTuningToDefaults() {
  if (el.aGain) el.aGain.value = Number(AUDIO_CONFIG_DEFAULTS.outputGain || 1).toFixed(2);
  if (el.aNoise) el.aNoise.value = Number(AUDIO_CONFIG_DEFAULTS.noiseFloorMin || 0.00045).toFixed(5);
  if (el.aAutoLevelTarget) el.aAutoLevelTarget.value = Number(AUDIO_CONFIG_DEFAULTS.autoLevelTargetRms || 0.028).toFixed(3);
  if (el.aAutoLevelGate) el.aAutoLevelGate.value = Number(AUDIO_CONFIG_DEFAULTS.autoLevelGate || 0.007).toFixed(3);
  if (el.aLimiterThreshold) el.aLimiterThreshold.value = Number(AUDIO_CONFIG_DEFAULTS.limiterThreshold || 0.82).toFixed(2);
  syncAudioQuickTuningFromInputs();
}

function syncAudioQuickPresetButtons() {
  const profileName = detectAudioQuickProfile({
    sampleRate: Number(el.aSampleRate?.value),
    framesPerBuffer: Number(el.aFrames?.value)
  });
  ui.audioQuickProfile = profileName || "";
  audioQuickPresetButtons.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.audioQuick === profileName);
  });
}

function syncLimiterPresetButtons() {
  const limiterPreset = String(ui.limiterPreset || "").trim().toLowerCase();
  for (const btn of Array.from(documentRef.querySelectorAll("[data-limiter-preset]"))) {
    const presetName = String(btn.dataset.limiterPreset || "").trim().toLowerCase();
    btn.classList.toggle("active", limiterPreset && presetName === limiterPreset);
  }
}

function applyAudioQuickProfile(name) {
  const profile = AUDIO_QUICK_PROFILES[String(name || "").trim().toLowerCase()];
  if (!profile) return false;
  el.aSampleRate.value = String(profile.sampleRate);
  el.aFrames.value = String(profile.framesPerBuffer);
  syncAudioQuickPresetButtons();
  return true;
}
  return {
    detectAudioQuickProfile,
    getAudioQuickTuneSliderMap,
    isAudioQuickSnapEnabled,
    normalizeAudioQuickTunePct,
    setAudioQuickTuneStageText,
    syncAudioQuickProfileSliderFromPcts,
    syncAudioQuickTuningFromInputs,
    applyAudioQuickTuningSlidersToInputs,
    applyAudioQuickProfileMixSliderToSliders,
    resetAudioQuickTuningToDefaults,
    syncAudioQuickPresetButtons,
    syncLimiterPresetButtons,
    applyAudioQuickProfile
  };
}
