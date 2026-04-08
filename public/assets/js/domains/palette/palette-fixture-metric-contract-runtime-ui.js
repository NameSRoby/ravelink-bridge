// [TITLE] Module: public/assets/js/domains/palette/palette-fixture-metric-contract-runtime-ui.js
// [TITLE] Purpose: normalize fixture-metric contract payloads and scoped override snapshots
// [TITLE] Functionality Index:
// [TITLE] - normalize fixture metric mode/key/harmony/max-hz values
// [TITLE] - normalize fixture metric config snapshots with fallback inheritance
// [TITLE] - project brand and fixture override maps into deterministic scoped objects
// [DEV] Complex Flow:
// [DEV] These helpers are consumed by palette orchestrator + scope-config runtime.
// [DEV] Keep return shapes stable because downstream UI event handlers rely on exact keys.

function createPaletteFixtureMetricContractRuntimeUi(deps = {}) {
  const ui = deps.ui && typeof deps.ui === "object" ? deps.ui : {};
  const clampNumber = typeof deps.clampNumber === "function"
    ? deps.clampNumber
    : ((value, min, max, fallback) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return Number(fallback);
      return Math.min(Number(max), Math.max(Number(min), parsed));
    });
  const parseBooleanUi = typeof deps.parseBooleanUi === "function"
    ? deps.parseBooleanUi
    : ((value, fallback = false) => {
      if (typeof value === "boolean") return value;
      if (value === 1 || value === "1") return true;
      if (value === 0 || value === "0") return false;
      return fallback;
    });
  const normalizePaletteBrandUi = typeof deps.normalizePaletteBrandUi === "function"
    ? deps.normalizePaletteBrandUi
    : (value => String(value || "").trim().toLowerCase());

  const contract = deps.contract && typeof deps.contract === "object" ? deps.contract : {};
  const defaults = deps.defaults && typeof deps.defaults === "object" ? deps.defaults : {};
  const supportedBrands = Array.isArray(defaults.supportedBrands) && defaults.supportedBrands.length
    ? defaults.supportedBrands.map(brand => String(brand || "").trim().toLowerCase()).filter(Boolean)
    : ["hue", "wiz"];
  const modeOrder = Array.isArray(defaults.modeOrder) && defaults.modeOrder.length
    ? defaults.modeOrder.map(mode => String(mode || "").trim().toLowerCase()).filter(Boolean)
    : ["manual", "meta_auto"];
  const metricKeys = Array.isArray(defaults.metricKeys) && defaults.metricKeys.length
    ? defaults.metricKeys.map(metric => String(metric || "").trim().toLowerCase()).filter(Boolean)
    : ["baseline", "peaks", "transients", "flux"];
  const configDefault = defaults.configDefault && typeof defaults.configDefault === "object"
    ? defaults.configDefault
    : Object.freeze({
      mode: "manual",
      metric: "baseline",
      metaAutoFlip: false,
      harmonySize: 1,
      maxHz: null
    });
  const limits = defaults.limits && typeof defaults.limits === "object" ? defaults.limits : {};
  const harmonyMin = Number.isFinite(Number(limits.harmonyMin)) ? Number(limits.harmonyMin) : 1;
  const harmonyMax = Number.isFinite(Number(limits.harmonyMax)) ? Number(limits.harmonyMax) : 8;
  const maxHzMin = Number.isFinite(Number(limits.maxHzMin)) ? Number(limits.maxHzMin) : 0.5;
  const maxHzMax = Number.isFinite(Number(limits.maxHzMax)) ? Number(limits.maxHzMax) : 24;

  function normalizeFixtureMetricModeUi(value, fallback = configDefault.mode) {
    if (typeof contract.normalizeFixtureMetricMode === "function") {
      return contract.normalizeFixtureMetricMode(value, {
        fallback,
        allowedModes: modeOrder,
        defaultMode: configDefault.mode
      });
    }
    const mode = String(value || "").trim().toLowerCase();
    if (modeOrder.includes(mode)) return mode;
    const fallbackMode = String(fallback || "").trim().toLowerCase();
    return modeOrder.includes(fallbackMode) ? fallbackMode : configDefault.mode;
  }

  function normalizeFixtureMetricKeyUi(value, fallback = configDefault.metric) {
    if (typeof contract.normalizeFixtureMetricKey === "function") {
      return contract.normalizeFixtureMetricKey(value, {
        fallback,
        allowedKeys: metricKeys,
        defaultKey: configDefault.metric
      });
    }
    const metric = String(value || "").trim().toLowerCase();
    if (metricKeys.includes(metric)) return metric;
    const fallbackMetric = String(fallback || "").trim().toLowerCase();
    return metricKeys.includes(fallbackMetric) ? fallbackMetric : configDefault.metric;
  }

  function normalizeFixtureMetricHarmonySizeUi(value, fallback = configDefault.harmonySize) {
    if (typeof contract.normalizeFixtureMetricHarmonySize === "function") {
      return contract.normalizeFixtureMetricHarmonySize(value, {
        fallback,
        harmonyMin,
        harmonyMax,
        defaultHarmony: configDefault.harmonySize
      });
    }
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return clampNumber(Math.round(parsed), harmonyMin, harmonyMax, configDefault.harmonySize);
    }
    const fallbackParsed = Number(fallback);
    if (Number.isFinite(fallbackParsed)) {
      return clampNumber(Math.round(fallbackParsed), harmonyMin, harmonyMax, configDefault.harmonySize);
    }
    return configDefault.harmonySize;
  }

  function normalizeFixtureMetricMaxHzUi(value, fallback = configDefault.maxHz) {
    if (typeof contract.normalizeFixtureMetricMaxHz === "function") {
      return contract.normalizeFixtureMetricMaxHz(value, {
        fallback,
        maxHzMin,
        maxHzMax
      });
    }

    const normalizeRaw = input => {
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

    const primary = normalizeRaw(value);
    if (primary.ok) return primary.value;
    const fallbackValue = normalizeRaw(fallback);
    return fallbackValue.ok ? fallbackValue.value : null;
  }

  function formatFixtureMetricMaxHzUi(value) {
    const hz = normalizeFixtureMetricMaxHzUi(value, null);
    if (!(Number.isFinite(hz) && hz > 0)) return "UNCLAMPED";
    const text = Number.isInteger(hz) ? String(hz) : hz.toFixed(1).replace(/\.0$/, "");
    return `${text} HZ`;
  }

  function normalizeFixtureMetricConfigUi(config = {}, fallback = null) {
    const base = fallback && typeof fallback === "object"
      ? fallback
      : {
        mode: ui.fixtureMetricConfig?.mode || configDefault.mode,
        metric: ui.fixtureMetricConfig?.metric || configDefault.metric,
        metaAutoFlip: ui.fixtureMetricConfig?.metaAutoFlip === true,
        harmonySize: ui.fixtureMetricConfig?.harmonySize || configDefault.harmonySize,
        maxHz: Object.prototype.hasOwnProperty.call(ui.fixtureMetricConfig || {}, "maxHz")
          ? ui.fixtureMetricConfig.maxHz
          : configDefault.maxHz
      };
    const source = config && typeof config === "object" ? config : {};
    if (typeof contract.normalizeFixtureMetricConfigSnapshot === "function") {
      return contract.normalizeFixtureMetricConfigSnapshot(source, {
        defaults: configDefault,
        fallback: base,
        parseBoolean: parseBooleanUi,
        allowedModes: modeOrder,
        allowedKeys: metricKeys,
        harmonyMin,
        harmonyMax,
        maxHzMin,
        maxHzMax
      });
    }
    return {
      mode: normalizeFixtureMetricModeUi(source.mode, base.mode),
      metric: normalizeFixtureMetricKeyUi(source.metric, base.metric),
      metaAutoFlip: Object.prototype.hasOwnProperty.call(source, "metaAutoFlip")
        ? parseBooleanUi(source.metaAutoFlip, Boolean(base.metaAutoFlip))
        : Boolean(base.metaAutoFlip),
      harmonySize: normalizeFixtureMetricHarmonySizeUi(source.harmonySize, base.harmonySize),
      maxHz: Object.prototype.hasOwnProperty.call(source, "maxHz")
        ? normalizeFixtureMetricMaxHzUi(source.maxHz, base.maxHz)
        : normalizeFixtureMetricMaxHzUi(base.maxHz, configDefault.maxHz)
    };
  }

  function normalizeFixtureMetricBrandOverridesUi(raw = {}, globalConfig = null) {
    const source = raw && typeof raw === "object" ? raw : {};
    const base = normalizeFixtureMetricConfigUi(globalConfig || {}, globalConfig || null);
    const out = {};
    for (const brand of supportedBrands) {
      const entry = source[brand];
      out[brand] = entry && typeof entry === "object"
        ? normalizeFixtureMetricConfigUi(entry, base)
        : null;
    }
    return out;
  }

  function normalizeFixtureMetricFixtureOverridesUi(raw = {}, brandOverrides = null, globalConfig = null) {
    const source = raw && typeof raw === "object" ? raw : {};
    const out = {};
    for (const [rawFixtureId, rawConfig] of Object.entries(source)) {
      const fixtureId = String(rawFixtureId || "").trim();
      if (!fixtureId) continue;
      if (!rawConfig || typeof rawConfig !== "object") continue;
      const brand = normalizePaletteBrandUi(rawConfig.brand);
      if (!brand) continue;
      const fallback = brandOverrides && brandOverrides[brand]
        ? brandOverrides[brand]
        : normalizeFixtureMetricConfigUi(globalConfig || {}, globalConfig || null);
      out[fixtureId] = {
        ...normalizeFixtureMetricConfigUi(rawConfig, fallback),
        brand,
        fixtureId
      };
    }
    return out;
  }

  return {
    normalizeFixtureMetricModeUi,
    normalizeFixtureMetricKeyUi,
    normalizeFixtureMetricHarmonySizeUi,
    normalizeFixtureMetricMaxHzUi,
    formatFixtureMetricMaxHzUi,
    normalizeFixtureMetricConfigUi,
    normalizeFixtureMetricBrandOverridesUi,
    normalizeFixtureMetricFixtureOverridesUi
  };
}
