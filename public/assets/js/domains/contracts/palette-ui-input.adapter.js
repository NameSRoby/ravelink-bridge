// [TITLE] Module: public/assets/js/domains/contracts/palette-ui-input.adapter.js
// [TITLE] Purpose: typed palette UI input adapter for runtime knob normalization
// [TITLE] Functionality Index:
// [TITLE] - normalize palette cycle/disorder/timing knobs
// [TITLE] - normalize palette vividness and spectrum feature map fields
// [DEV] Complex Flow:
// [DEV] Knob normalization is centralized so global/brand/fixture scopes apply
// [DEV] identical clamp and fallback behavior across palette runtime paths.

function createPaletteUiInputAdapter(options = {}) {
  const clampNumber = typeof options.clampNumber === "function"
    ? options.clampNumber
    : ((value, min, max, fallback) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return Number(fallback);
      return Math.min(Number(max), Math.max(Number(min), parsed));
    });
  const cycleModeOrder = Array.isArray(options.cycleModeOrder) && options.cycleModeOrder.length
    ? options.cycleModeOrder.map(item => String(item || "").trim().toLowerCase()).filter(Boolean)
    : ["on_trigger"];
  const spectrumMapModeOrder = Array.isArray(options.spectrumMapModeOrder) && options.spectrumMapModeOrder.length
    ? options.spectrumMapModeOrder.map(item => String(item || "").trim().toLowerCase()).filter(Boolean)
    : ["auto", "manual"];
  const audioFeatureKeys = Array.isArray(options.audioFeatureKeys) && options.audioFeatureKeys.length
    ? options.audioFeatureKeys.map(item => String(item || "").trim().toLowerCase()).filter(Boolean)
    : ["rms"];
  const defaultSpectrumFeatureMap = Array.isArray(options.defaultSpectrumFeatureMap) && options.defaultSpectrumFeatureMap.length
    ? options.defaultSpectrumFeatureMap.map(item => String(item || "").trim().toLowerCase()).filter(Boolean)
    : ["rms"];
  const vividnessLevels = Array.isArray(options.vividnessLevelOptions) && options.vividnessLevelOptions.length
    ? options.vividnessLevelOptions.map(level => Math.round(Number(level))).filter(level => Number.isFinite(level))
    : [0, 1, 2, 3, 4];
  const vividnessMin = Math.min(...vividnessLevels);
  const vividnessMax = Math.max(...vividnessLevels);
  const timedIntervalMinSec = Number.isFinite(Number(options.timedIntervalMinSec)) ? Number(options.timedIntervalMinSec) : 2;
  const timedIntervalMaxSec = Number.isFinite(Number(options.timedIntervalMaxSec)) ? Number(options.timedIntervalMaxSec) : 60;
  const beatLockGraceMinSec = Number.isFinite(Number(options.beatLockGraceMinSec)) ? Number(options.beatLockGraceMinSec) : 0;
  const beatLockGraceMaxSec = Number.isFinite(Number(options.beatLockGraceMaxSec)) ? Number(options.beatLockGraceMaxSec) : 8;
  const reactiveMarginMin = Number.isFinite(Number(options.reactiveMarginMin)) ? Number(options.reactiveMarginMin) : 5;
  const reactiveMarginMax = Number.isFinite(Number(options.reactiveMarginMax)) ? Number(options.reactiveMarginMax) : 100;
  const brightnessFollowAmountMin = Number.isFinite(Number(options.brightnessFollowAmountMin))
    ? Number(options.brightnessFollowAmountMin)
    : 0;
  const brightnessFollowAmountMax = Number.isFinite(Number(options.brightnessFollowAmountMax))
    ? Number(options.brightnessFollowAmountMax)
    : 2;

  function normalizePaletteDisorderAggressionUi(value, fallback = 0.35) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return Number(fallback);
    const normalized = parsed > 1 ? (parsed / 100) : parsed;
    return Number(clampNumber(normalized, 0, 1, fallback));
  }

  function normalizePaletteCycleModeUi(value, fallback = "on_trigger") {
    const raw = String(value || "").trim().toLowerCase();
    if (cycleModeOrder.includes(raw)) return raw;
    const fallbackToken = String(fallback || "").trim().toLowerCase();
    return cycleModeOrder.includes(fallbackToken) ? fallbackToken : cycleModeOrder[0];
  }

  function normalizePaletteTimedIntervalSecUi(value, fallback = 5) {
    const normalize = raw => {
      const n = Number(raw);
      if (!Number.isFinite(n)) return null;
      if (n <= 3.5) return timedIntervalMinSec;
      return clampNumber(
        Math.round(n / 5) * 5,
        5,
        timedIntervalMaxSec,
        5
      );
    };
    const normalized = normalize(value);
    if (Number.isFinite(Number(normalized))) return Number(normalized);
    const fallbackNormalized = normalize(fallback);
    return Number.isFinite(Number(fallbackNormalized)) ? Number(fallbackNormalized) : 5;
  }

  function normalizePaletteBeatLockGraceSecUi(value, fallback = 2) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Number(clampNumber(Math.round(parsed), beatLockGraceMinSec, beatLockGraceMaxSec, 2));
    }
    const fallbackNum = Number(fallback);
    if (Number.isFinite(fallbackNum)) {
      return Number(clampNumber(Math.round(fallbackNum), beatLockGraceMinSec, beatLockGraceMaxSec, 2));
    }
    return 2;
  }

  function normalizePaletteReactiveMarginUi(value, fallback = 28) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Number(clampNumber(Math.round(parsed), reactiveMarginMin, reactiveMarginMax, 28));
    }
    const fallbackNum = Number(fallback);
    if (Number.isFinite(fallbackNum)) {
      return Number(clampNumber(Math.round(fallbackNum), reactiveMarginMin, reactiveMarginMax, 28));
    }
    return 28;
  }

  function normalizePaletteBrightnessFollowAmountUi(value, fallback = 1) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Number(clampNumber(parsed, brightnessFollowAmountMin, brightnessFollowAmountMax, 1));
    }
    const fallbackNum = Number(fallback);
    if (Number.isFinite(fallbackNum)) {
      return Number(clampNumber(fallbackNum, brightnessFollowAmountMin, brightnessFollowAmountMax, 1));
    }
    return 1;
  }

  function normalizePaletteVividnessUi(value, fallback = 2) {
    const rounded = Math.round(clampNumber(value, vividnessMin, vividnessMax, fallback));
    const token = Number(clampNumber(rounded, vividnessMin, vividnessMax, fallback));
    if (vividnessLevels.includes(token)) return token;
    return vividnessLevels.includes(Math.round(Number(fallback))) ? Math.round(Number(fallback)) : vividnessLevels[0];
  }

  function normalizePaletteSpectrumMapModeUi(value, fallback = "auto") {
    const raw = String(value || "").trim().toLowerCase();
    if (spectrumMapModeOrder.includes(raw)) return raw;
    const fallbackToken = String(fallback || "").trim().toLowerCase();
    return spectrumMapModeOrder.includes(fallbackToken) ? fallbackToken : spectrumMapModeOrder[0];
  }

  function normalizePaletteAudioFeatureUi(value, fallback = "rms") {
    const token = String(value || "").trim().toLowerCase();
    if (audioFeatureKeys.includes(token)) return token;
    const fallbackToken = String(fallback || "").trim().toLowerCase();
    return audioFeatureKeys.includes(fallbackToken) ? fallbackToken : audioFeatureKeys[0];
  }

  function normalizePaletteSpectrumFeatureMapUi(value, fallback = defaultSpectrumFeatureMap) {
    const list = Array.isArray(value)
      ? value
      : String(value || "")
        .split(",")
        .map(item => item.trim())
        .filter(Boolean);
    const fallbackList = Array.isArray(fallback) && fallback.length
      ? fallback
      : defaultSpectrumFeatureMap;
    const out = [];
    for (let i = 0; i < 5; i += 1) {
      const raw = Object.prototype.hasOwnProperty.call(list, i)
        ? list[i]
        : fallbackList[i % fallbackList.length];
      out.push(
        normalizePaletteAudioFeatureUi(raw, fallbackList[i % fallbackList.length])
      );
    }
    return out;
  }

  return Object.freeze({
    normalizePaletteDisorderAggressionUi,
    normalizePaletteCycleModeUi,
    normalizePaletteTimedIntervalSecUi,
    normalizePaletteBeatLockGraceSecUi,
    normalizePaletteReactiveMarginUi,
    normalizePaletteBrightnessFollowAmountUi,
    normalizePaletteVividnessUi,
    normalizePaletteSpectrumMapModeUi,
    normalizePaletteAudioFeatureUi,
    normalizePaletteSpectrumFeatureMapUi
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    createPaletteUiInputAdapter
  };
}
