// [TITLE] Module: public/assets/js/shared/palette-metric-contract.js
// [TITLE] Purpose: shared palette metric normalization contract (server + UI parity)
// [TITLE] Functionality Index:
// [TITLE] - canonical metric mode/key lists
// [TITLE] - canonical metric labels/default config
// [TITLE] - canonical metric numeric bounds

(function buildPaletteMetricContract(rootFactory) {
  const contract = rootFactory();
  if (typeof module === "object" && module && module.exports) {
    module.exports = contract;
  }
  if (typeof globalThis === "object" && globalThis) {
    globalThis.RAVELINK_PALETTE_METRIC_CONTRACT = contract;
  }
})(function createPaletteMetricContract() {
  const clampNumber = (value, min, max, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return Number(fallback);
    return Math.min(Number(max), Math.max(Number(min), parsed));
  };

  const FIXTURE_METRIC_MODE_ORDER = Object.freeze(["manual", "meta_auto"]);
  const FIXTURE_METRIC_KEYS = Object.freeze(["baseline", "peaks", "transients", "flux"]);
  const FIXTURE_METRIC_LABELS = Object.freeze({
    baseline: "BASELINE",
    peaks: "PEAKS",
    transients: "TRANSIENTS",
    flux: "FLUX"
  });
  const FIXTURE_METRIC_CONFIG_DEFAULT = Object.freeze({
    mode: "manual",
    metric: "baseline",
    metaAutoFlip: false,
    harmonySize: 1,
    maxHz: null
  });
  const FIXTURE_METRIC_LIMITS = Object.freeze({
    harmonyMin: 1,
    harmonyMax: 8,
    maxHzMin: 0.5,
    maxHzMax: 24,
    maxHzDefault: 8,
    maxHzStep: 0.1
  });

  function normalizeFixtureMetricMode(value, options = {}) {
    const allowedModes = Array.isArray(options.allowedModes) && options.allowedModes.length
      ? options.allowedModes
      : FIXTURE_METRIC_MODE_ORDER;
    const defaultMode = String(options.defaultMode || FIXTURE_METRIC_CONFIG_DEFAULT.mode).trim().toLowerCase();
    const fallback = String(options.fallback || defaultMode).trim().toLowerCase();
    const mode = String(value || "").trim().toLowerCase();
    if (allowedModes.includes(mode)) return mode;
    if (allowedModes.includes(fallback)) return fallback;
    return allowedModes.includes(defaultMode) ? defaultMode : FIXTURE_METRIC_CONFIG_DEFAULT.mode;
  }

  function normalizeFixtureMetricKey(value, options = {}) {
    const allowedKeys = Array.isArray(options.allowedKeys) && options.allowedKeys.length
      ? options.allowedKeys
      : FIXTURE_METRIC_KEYS;
    const defaultKey = String(options.defaultKey || FIXTURE_METRIC_CONFIG_DEFAULT.metric).trim().toLowerCase();
    const fallback = String(options.fallback || defaultKey).trim().toLowerCase();
    const metric = String(value || "").trim().toLowerCase();
    if (allowedKeys.includes(metric)) return metric;
    if (allowedKeys.includes(fallback)) return fallback;
    return allowedKeys.includes(defaultKey) ? defaultKey : FIXTURE_METRIC_CONFIG_DEFAULT.metric;
  }

  function normalizeFixtureMetricHarmonySize(value, options = {}) {
    const harmonyMin = Number.isFinite(Number(options.harmonyMin))
      ? Number(options.harmonyMin)
      : FIXTURE_METRIC_LIMITS.harmonyMin;
    const harmonyMax = Number.isFinite(Number(options.harmonyMax))
      ? Number(options.harmonyMax)
      : FIXTURE_METRIC_LIMITS.harmonyMax;
    const defaultHarmony = Number.isFinite(Number(options.defaultHarmony))
      ? Number(options.defaultHarmony)
      : FIXTURE_METRIC_CONFIG_DEFAULT.harmonySize;
    const fallback = Number.isFinite(Number(options.fallback))
      ? Number(options.fallback)
      : defaultHarmony;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.round(clampNumber(parsed, harmonyMin, harmonyMax, defaultHarmony));
    }
    if (Number.isFinite(fallback)) {
      return Math.round(clampNumber(fallback, harmonyMin, harmonyMax, defaultHarmony));
    }
    return Math.round(clampNumber(defaultHarmony, harmonyMin, harmonyMax, FIXTURE_METRIC_CONFIG_DEFAULT.harmonySize));
  }

  function normalizeFixtureMetricMaxHz(value, options = {}) {
    const maxHzMin = Number.isFinite(Number(options.maxHzMin))
      ? Number(options.maxHzMin)
      : FIXTURE_METRIC_LIMITS.maxHzMin;
    const maxHzMax = Number.isFinite(Number(options.maxHzMax))
      ? Number(options.maxHzMax)
      : FIXTURE_METRIC_LIMITS.maxHzMax;
    const fallback = options.fallback;
    const parseCandidate = input => {
      if (input === undefined) return { ok: false, value: null };
      if (input === null) return { ok: true, value: null };
      if (typeof input === "string") {
        const raw = input.trim().toLowerCase();
        if (!raw) return { ok: true, value: null };
        if (
          raw === "off" ||
          raw === "none" ||
          raw === "null" ||
          raw === "unclamped" ||
          raw === "unclamp" ||
          raw === "disabled"
        ) {
          return { ok: true, value: null };
        }
      }
      const parsed = Number(input);
      if (!Number.isFinite(parsed) || parsed <= 0) return { ok: false, value: null };
      const clamped = clampNumber(parsed, maxHzMin, maxHzMax, null);
      if (!Number.isFinite(clamped) || clamped <= 0) return { ok: false, value: null };
      return { ok: true, value: Math.round(clamped * 10) / 10 };
    };

    const primary = parseCandidate(value);
    if (primary.ok) return primary.value;
    const fallbackParsed = parseCandidate(fallback);
    return fallbackParsed.ok ? fallbackParsed.value : null;
  }

  function normalizeFixtureMetricConfigSnapshot(source = {}, options = {}) {
    const raw = source && typeof source === "object" ? source : {};
    const defaults = options.defaults && typeof options.defaults === "object"
      ? options.defaults
      : FIXTURE_METRIC_CONFIG_DEFAULT;
    const fallbackSource = options.fallback && typeof options.fallback === "object"
      ? options.fallback
      : defaults;
    const parseBoolean = typeof options.parseBoolean === "function"
      ? options.parseBoolean
      : ((value, fallback = false) => {
        if (value === true || value === false) return value;
        if (value === 1 || value === "1") return true;
        if (value === 0 || value === "0") return false;
        if (typeof value === "string") {
          const token = value.trim().toLowerCase();
          if (token === "true" || token === "yes" || token === "on") return true;
          if (token === "false" || token === "no" || token === "off") return false;
        }
        return fallback === true;
      });

    const mode = normalizeFixtureMetricMode(raw.mode, {
      fallback: fallbackSource.mode,
      allowedModes: options.allowedModes,
      defaultMode: defaults.mode
    });
    let metric = normalizeFixtureMetricKey(raw.metric, {
      fallback: fallbackSource.metric,
      allowedKeys: options.allowedKeys,
      defaultKey: defaults.metric
    });
    let metaAutoFlip = Object.prototype.hasOwnProperty.call(raw, "metaAutoFlip")
      ? parseBoolean(raw.metaAutoFlip, Boolean(fallbackSource.metaAutoFlip))
      : Boolean(fallbackSource.metaAutoFlip);
    let harmonySize = normalizeFixtureMetricHarmonySize(raw.harmonySize, {
      fallback: fallbackSource.harmonySize,
      harmonyMin: options.harmonyMin,
      harmonyMax: options.harmonyMax,
      defaultHarmony: defaults.harmonySize
    });
    const maxHz = normalizeFixtureMetricMaxHz(raw.maxHz, {
      fallback: fallbackSource.maxHz,
      maxHzMin: options.maxHzMin,
      maxHzMax: options.maxHzMax
    });

    if (mode !== "meta_auto") {
      metaAutoFlip = false;
      harmonySize = Number(defaults.harmonySize);
    } else {
      metric = String(defaults.metric || "baseline").trim().toLowerCase();
    }

    return {
      mode,
      metric,
      metaAutoFlip,
      harmonySize,
      maxHz
    };
  }

  return Object.freeze({
    FIXTURE_METRIC_MODE_ORDER,
    FIXTURE_METRIC_KEYS,
    FIXTURE_METRIC_LABELS,
    FIXTURE_METRIC_CONFIG_DEFAULT,
    FIXTURE_METRIC_LIMITS,
    normalizeFixtureMetricMode,
    normalizeFixtureMetricKey,
    normalizeFixtureMetricHarmonySize,
    normalizeFixtureMetricMaxHz,
    normalizeFixtureMetricConfigSnapshot
  });
});
