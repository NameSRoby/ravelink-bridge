// [TITLE] Module: public/assets/js/domains/palette.js
// [TITLE] Purpose: palette domain constants, normalization, runtime sync, and scoped helpers
// [TITLE] Functionality Index:
// [TITLE] - palette family/runtime contract defaults + aliases
// [TITLE] - palette config normalization + snapshot application
// [TITLE] - palette brand card rendering + scoped state helpers

const PALETTE_FAMILY_ORDER_DEFAULT = Object.freeze(["red", "yellow", "green", "violet", "blue", "custom"]);
const PALETTE_FAMILY_ALIASES_DEFAULT = Object.freeze({
  violet: "violet",
  purple: "violet",
  magenta: "violet",
  pink: "violet",
  amber: "yellow",
  lime: "yellow",
  aqua: "blue",
  teal: "blue",
  custom: "custom",
  costum: "custom"
});
const PALETTE_COLOR_COUNT_OPTIONS_DEFAULT = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
const PALETTE_FAMILY_DEFS_DEFAULT = Object.freeze({
  red: Object.freeze({
    id: "red",
    label: "RED",
    colors: Object.freeze([
      Object.freeze({ r: 237, g: 40, b: 57 }),
      Object.freeze({ r: 229, g: 43, b: 80 }),
      Object.freeze({ r: 190, g: 0, b: 50 }),
      Object.freeze({ r: 124, g: 9, b: 2 }),
      Object.freeze({ r: 164, g: 44, b: 2 }),
      Object.freeze({ r: 191, g: 79, b: 81 }),
      Object.freeze({ r: 251, g: 96, b: 127 }),
      Object.freeze({ r: 253, g: 188, b: 180 }),
      Object.freeze({ r: 197, g: 30, b: 58 }),
      Object.freeze({ r: 150, g: 0, b: 24 }),
      Object.freeze({ r: 224, g: 60, b: 49 }),
      Object.freeze({ r: 255, g: 34, b: 38 })
    ])
  }),
  yellow: Object.freeze({
    id: "yellow",
    label: "YELLOW",
    colors: Object.freeze([
      Object.freeze({ r: 227, g: 168, b: 87 }),
      Object.freeze({ r: 217, g: 160, b: 33 }),
      Object.freeze({ r: 255, g: 204, b: 0 }),
      Object.freeze({ r: 255, g: 248, b: 231 }),
      Object.freeze({ r: 168, g: 181, b: 69 }),
      Object.freeze({ r: 255, g: 255, b: 102 }),
      Object.freeze({ r: 255, g: 196, b: 12 }),
      Object.freeze({ r: 238, g: 230, b: 0 }),
      Object.freeze({ r: 228, g: 168, b: 41 }),
      Object.freeze({ r: 210, g: 181, b: 91 }),
      Object.freeze({ r: 250, g: 231, b: 181 }),
      Object.freeze({ r: 189, g: 183, b: 107 })
    ])
  }),
  green: Object.freeze({
    id: "green",
    label: "GREEN",
    colors: Object.freeze([
      Object.freeze({ r: 156, g: 175, b: 136 }),
      Object.freeze({ r: 80, g: 200, b: 120 }),
      Object.freeze({ r: 128, g: 128, b: 0 }),
      Object.freeze({ r: 34, g: 139, b: 34 }),
      Object.freeze({ r: 152, g: 255, b: 152 }),
      Object.freeze({ r: 76, g: 187, b: 23 }),
      Object.freeze({ r: 147, g: 233, b: 190 }),
      Object.freeze({ r: 53, g: 94, b: 59 }),
      Object.freeze({ r: 50, g: 205, b: 50 }),
      Object.freeze({ r: 0, g: 128, b: 128 }),
      Object.freeze({ r: 79, g: 121, b: 66 }),
      Object.freeze({ r: 107, g: 142, b: 35 })
    ])
  }),
  violet: Object.freeze({
    id: "violet",
    label: "VIOLET",
    colors: Object.freeze([
      Object.freeze({ r: 102, g: 2, b: 60 }),
      Object.freeze({ r: 112, g: 41, b: 99 }),
      Object.freeze({ r: 223, g: 115, b: 255 }),
      Object.freeze({ r: 153, g: 50, b: 204 }),
      Object.freeze({ r: 160, g: 32, b: 240 }),
      Object.freeze({ r: 136, g: 78, b: 160 }),
      Object.freeze({ r: 214, g: 202, b: 221 }),
      Object.freeze({ r: 145, g: 92, b: 131 }),
      Object.freeze({ r: 201, g: 160, b: 220 }),
      Object.freeze({ r: 75, g: 46, b: 131 }),
      Object.freeze({ r: 143, g: 0, b: 255 }),
      Object.freeze({ r: 86, g: 60, b: 92 })
    ])
  }),
  blue: Object.freeze({
    id: "blue",
    label: "BLUE",
    colors: Object.freeze([
      Object.freeze({ r: 0, g: 0, b: 128 }),
      Object.freeze({ r: 65, g: 105, b: 225 }),
      Object.freeze({ r: 135, g: 206, b: 235 }),
      Object.freeze({ r: 0, g: 127, b: 255 }),
      Object.freeze({ r: 63, g: 0, b: 255 }),
      Object.freeze({ r: 54, g: 117, b: 136 }),
      Object.freeze({ r: 100, g: 149, b: 237 }),
      Object.freeze({ r: 204, g: 204, b: 255 }),
      Object.freeze({ r: 176, g: 224, b: 230 }),
      Object.freeze({ r: 16, g: 52, b: 166 }),
      Object.freeze({ r: 21, g: 96, b: 189 }),
      Object.freeze({ r: 0, g: 71, b: 171 })
    ])
  }),
  custom: Object.freeze({
    id: "custom",
    label: "CUSTOM",
    colors: Object.freeze([
      Object.freeze({ r: 255, g: 0, b: 128 }),
      Object.freeze({ r: 255, g: 64, b: 0 }),
      Object.freeze({ r: 255, g: 180, b: 0 }),
      Object.freeze({ r: 255, g: 235, b: 0 }),
      Object.freeze({ r: 128, g: 255, b: 0 }),
      Object.freeze({ r: 0, g: 220, b: 80 }),
      Object.freeze({ r: 0, g: 188, b: 255 }),
      Object.freeze({ r: 0, g: 120, b: 255 }),
      Object.freeze({ r: 90, g: 120, b: 255 }),
      Object.freeze({ r: 166, g: 88, b: 255 }),
      Object.freeze({ r: 230, g: 80, b: 210 }),
      Object.freeze({ r: 255, g: 255, b: 255 })
    ])
  })
});
let PALETTE_FAMILY_ORDER = Object.freeze([...PALETTE_FAMILY_ORDER_DEFAULT]);
let PALETTE_FAMILY_ALIASES = Object.freeze({ ...PALETTE_FAMILY_ALIASES_DEFAULT });
let PALETTE_COLOR_COUNT_OPTIONS = Object.freeze([...PALETTE_COLOR_COUNT_OPTIONS_DEFAULT]);
let PALETTE_FAMILY_DEFS = Object.freeze({ ...PALETTE_FAMILY_DEFS_DEFAULT });
const PALETTE_SUPPORTED_BRANDS = Object.freeze(["hue", "wiz"]);
const PALETTE_BRAND_LABELS = Object.freeze({
  hue: "HUE",
  wiz: "WIZ"
});
const PALETTE_ALL_FIXTURES_VALUE = "__all__";
const PALETTE_CYCLE_MODE_ORDER = Object.freeze([
  "on_trigger"
]);
const PALETTE_SPECTRUM_MAP_MODE_ORDER = Object.freeze(["auto", "manual"]);
const PALETTE_AUDIO_FEATURE_KEYS = Object.freeze([
  "lows",
  "mids",
  "highs",
  "rms",
  "energy",
  "flux",
  "peaks",
  "transients",
  "beat"
]);
const PALETTE_AUDIO_FEATURE_LABELS = Object.freeze({
  lows: "LOWS",
  mids: "MIDS",
  highs: "HIGHS",
  rms: "RMS",
  energy: "ENERGY",
  flux: "FLUX",
  peaks: "PEAKS",
  transients: "TRANSIENTS",
  beat: "BEAT"
});
const PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP = Object.freeze([
  "lows",
  "mids",
  "highs",
  "rms",
  "flux"
]);
const PALETTE_TIMED_INTERVAL_MIN_SEC = 2;
const PALETTE_TIMED_INTERVAL_MAX_SEC = 60;
const PALETTE_BEAT_LOCK_GRACE_MIN_SEC = 0;
const PALETTE_BEAT_LOCK_GRACE_MAX_SEC = 8;
const PALETTE_REACTIVE_MARGIN_MIN = 5;
const PALETTE_REACTIVE_MARGIN_MAX = 100;
const PALETTE_BRIGHTNESS_FOLLOW_AMOUNT_MIN = 0;
const PALETTE_BRIGHTNESS_FOLLOW_AMOUNT_MAX = 2;
const PALETTE_VIVIDNESS_LEVEL_OPTIONS = Object.freeze([0, 1, 2, 3, 4]);
const PALETTE_VIVIDNESS_LABELS = Object.freeze({
  0: "SOFT",
  1: "BALANCED",
  2: "HIGH",
  3: "ULTRA",
  4: "MAX"
});
const PALETTE_FIXTURE_SELECTION_STORAGE_KEY = "ravelink_palette_fixture_selection_v1";

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number(fallback);
  return Math.min(Number(max), Math.max(Number(min), parsed));
}

function normalizePaletteControlScopeUi(value, fallback = "global") {
  const mode = String(value || "").trim().toLowerCase();
  if (mode === "custom") return "custom";
  if (mode === "global") return "global";
  const fallbackMode = String(fallback || "").trim().toLowerCase();
  return fallbackMode === "custom" ? "custom" : "global";
}

function normalizePaletteCustomBrandMemoryUi(value, fallback = "hue") {
  const brand = String(value || "").trim().toLowerCase();
  if (PALETTE_SUPPORTED_BRANDS.includes(brand)) return brand;
  const fallbackBrand = String(fallback || "").trim().toLowerCase();
  return PALETTE_SUPPORTED_BRANDS.includes(fallbackBrand) ? fallbackBrand : "hue";
}

function normalizePaletteFixtureSelectionByBrandMemory(value = null) {
  const base = {
    hue: PALETTE_ALL_FIXTURES_VALUE,
    wiz: PALETTE_ALL_FIXTURES_VALUE
  };
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  for (const brand of PALETTE_SUPPORTED_BRANDS) {
    const raw = String(source[brand] || PALETTE_ALL_FIXTURES_VALUE).trim();
    base[brand] = raw || PALETTE_ALL_FIXTURES_VALUE;
  }
  return base;
}

function persistPaletteFixtureSelectionMemory() {
  try {
    const safe = normalizePaletteFixtureSelectionByBrandMemory(ui.paletteFixtureSelectionByBrand);
    ui.paletteFixtureSelectionByBrand = { ...safe };
    localStorage.setItem(PALETTE_FIXTURE_SELECTION_STORAGE_KEY, JSON.stringify(safe));
  } catch (err) {
    console.debug("[PALETTE][DEBUG] persist fixture selection memory failed:", err?.message || err);
  }
}

ui.paletteFixtureSelectionByBrand = normalizePaletteFixtureSelectionByBrandMemory(
  ui.paletteFixtureSelectionByBrand
);
let paletteGlobalPanelInteractionUntil = 0;
let paletteMutationQueue = Promise.resolve();
let paletteGlobalSequenceDragIndex = -1;

function syncUiLazy() {
  if (typeof sync === "function") {
    sync();
  }
}
let paletteGlobalFamilyTab = "red";

function enqueuePaletteMutation(task) {
  const run = typeof task === "function" ? task : async () => false;
  const next = paletteMutationQueue.then(() => run(), () => run());
  paletteMutationQueue = next.catch(err => {
    console.debug("[PALETTE][DEBUG] mutation queue task failed:", err?.message || err);
  });
  return next;
}

const PALETTE_METRIC_CONTRACT = (typeof RAVELINK_PALETTE_METRIC_CONTRACT === "object" && RAVELINK_PALETTE_METRIC_CONTRACT)
  ? RAVELINK_PALETTE_METRIC_CONTRACT
  : Object.freeze({
    FIXTURE_METRIC_MODE_ORDER: Object.freeze(["manual", "meta_auto"]),
    FIXTURE_METRIC_KEYS: Object.freeze(["baseline", "peaks", "transients", "flux"]),
    FIXTURE_METRIC_LABELS: Object.freeze({
      baseline: "BASELINE",
      peaks: "PEAKS",
      transients: "TRANSIENTS",
      flux: "FLUX"
    }),
    FIXTURE_METRIC_CONFIG_DEFAULT: Object.freeze({
      mode: "manual",
      metric: "baseline",
      metaAutoFlip: false,
      harmonySize: 1,
      maxHz: null
    }),
    FIXTURE_METRIC_LIMITS: Object.freeze({
      harmonyMin: 1,
      harmonyMax: 8,
      maxHzMin: 0.5,
      maxHzMax: 24,
      maxHzDefault: 8,
      maxHzStep: 0.1
    })
  });
const PALETTE_CONFIG_CONTRACT = (typeof RAVELINK_PALETTE_CONFIG_CONTRACT === "object" && RAVELINK_PALETTE_CONFIG_CONTRACT)
  ? RAVELINK_PALETTE_CONFIG_CONTRACT
  : Object.freeze({
    createPaletteConfigSnapshotNormalizer: null
  });
const FIXTURE_METRIC_MODE_ORDER = Array.isArray(PALETTE_METRIC_CONTRACT.FIXTURE_METRIC_MODE_ORDER)
  ? PALETTE_METRIC_CONTRACT.FIXTURE_METRIC_MODE_ORDER
  : Object.freeze(["manual", "meta_auto"]);
const FIXTURE_METRIC_KEYS = Array.isArray(PALETTE_METRIC_CONTRACT.FIXTURE_METRIC_KEYS)
  ? PALETTE_METRIC_CONTRACT.FIXTURE_METRIC_KEYS
  : Object.freeze(["baseline", "peaks", "transients", "flux"]);
const FIXTURE_METRIC_LABELS = (
  PALETTE_METRIC_CONTRACT.FIXTURE_METRIC_LABELS &&
  typeof PALETTE_METRIC_CONTRACT.FIXTURE_METRIC_LABELS === "object"
)
  ? PALETTE_METRIC_CONTRACT.FIXTURE_METRIC_LABELS
  : Object.freeze({
    baseline: "BASELINE",
    peaks: "PEAKS",
    transients: "TRANSIENTS",
    flux: "FLUX"
  });
const FIXTURE_METRIC_CONFIG_DEFAULT = Object.freeze({
  ...((
    PALETTE_METRIC_CONTRACT.FIXTURE_METRIC_CONFIG_DEFAULT &&
    typeof PALETTE_METRIC_CONTRACT.FIXTURE_METRIC_CONFIG_DEFAULT === "object"
  )
    ? PALETTE_METRIC_CONTRACT.FIXTURE_METRIC_CONFIG_DEFAULT
    : {
      mode: "manual",
      metric: "baseline",
      metaAutoFlip: false,
      harmonySize: 1,
      maxHz: null
    })
});
const FIXTURE_METRIC_HARMONY_MIN = Number(PALETTE_METRIC_CONTRACT.FIXTURE_METRIC_LIMITS?.harmonyMin || 1);
const FIXTURE_METRIC_HARMONY_MAX = Number(PALETTE_METRIC_CONTRACT.FIXTURE_METRIC_LIMITS?.harmonyMax || 8);
const FIXTURE_METRIC_MAX_HZ_MIN = Number(PALETTE_METRIC_CONTRACT.FIXTURE_METRIC_LIMITS?.maxHzMin || 0.5);
const FIXTURE_METRIC_MAX_HZ_MAX = Number(PALETTE_METRIC_CONTRACT.FIXTURE_METRIC_LIMITS?.maxHzMax || 24);
const FIXTURE_METRIC_MAX_HZ_DEFAULT = Number(PALETTE_METRIC_CONTRACT.FIXTURE_METRIC_LIMITS?.maxHzDefault || 8);
const FIXTURE_METRIC_MAX_HZ_STEP = Number(PALETTE_METRIC_CONTRACT.FIXTURE_METRIC_LIMITS?.maxHzStep || 0.1);

function parseBooleanUi(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  if (typeof value === "string") {
    const raw = value.trim().toLowerCase();
    if (raw === "true" || raw === "on" || raw === "yes") return true;
    if (raw === "false" || raw === "off" || raw === "no") return false;
  }
  return fallback;
}

function normalizePaletteBrandUi(value) {
  const brand = String(value || "").trim().toLowerCase();
  return PALETTE_SUPPORTED_BRANDS.includes(brand) ? brand : "";
}

function normalizePaletteFamiliesUi(value, fallback = PALETTE_FAMILY_ORDER) {
  const list = Array.isArray(value)
    ? value
    : String(value || "")
      .split(",")
      .map(item => item.trim())
      .filter(Boolean);
  const out = [];
  for (const raw of list) {
    const key = String(raw || "").trim().toLowerCase();
    const mapped = PALETTE_FAMILY_ALIASES[key] || key;
    if (!PALETTE_FAMILY_ORDER.includes(mapped)) continue;
    if (out.includes(mapped)) continue;
    out.push(mapped);
  }
  if (out.length) return out;
  return Array.isArray(fallback) && fallback.length
    ? normalizePaletteFamiliesUi(fallback, PALETTE_FAMILY_ORDER)
    : ["red"];
}

function normalizePaletteColorCountUi(value, fallback = 3) {
  const parsed = Number(value);
  if (PALETTE_COLOR_COUNT_OPTIONS.includes(parsed)) return parsed;
  const fallbackParsed = Number(fallback);
  if (PALETTE_COLOR_COUNT_OPTIONS.includes(fallbackParsed)) return fallbackParsed;
  return PALETTE_COLOR_COUNT_OPTIONS[Math.max(0, PALETTE_COLOR_COUNT_OPTIONS.length - 1)] || 3;
}

function parsePaletteRgbColorTokenUi(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const r = Number(value.r);
    const g = Number(value.g);
    const b = Number(value.b);
    if (Number.isFinite(r) || Number.isFinite(g) || Number.isFinite(b)) {
      return {
        r: clampNumber(Math.round(Number(r) || 0), 0, 255, 0),
        g: clampNumber(Math.round(Number(g) || 0), 0, 255, 0),
        b: clampNumber(Math.round(Number(b) || 0), 0, 255, 0)
      };
    }
    if (value.color && typeof value.color === "object" && !Array.isArray(value.color)) {
      return parsePaletteRgbColorTokenUi(value.color);
    }
  }
  const raw = String(value || "").trim();
  if (!raw) return null;
  const hexMatch = raw.match(/^#?([0-9a-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    return {
      r: clampNumber(parseInt(hex.slice(0, 2), 16), 0, 255, 0),
      g: clampNumber(parseInt(hex.slice(2, 4), 16), 0, 255, 0),
      b: clampNumber(parseInt(hex.slice(4, 6), 16), 0, 255, 0)
    };
  }
  const parts = raw
    .replace(/^rgb\(/i, "")
    .replace(/\)$/i, "")
    .split(",")
    .map(part => part.trim())
    .filter(Boolean);
  if (parts.length >= 3) {
    const r = Number(parts[0]);
    const g = Number(parts[1]);
    const b = Number(parts[2]);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      return {
        r: clampNumber(Math.round(r), 0, 255, 0),
        g: clampNumber(Math.round(g), 0, 255, 0),
        b: clampNumber(Math.round(b), 0, 255, 0)
      };
    }
  }
  return null;
}

function normalizePaletteCustomFamilyColorsUi(value, fallback = null) {
  const normalizeList = raw => {
    let source = raw;
    if (typeof source === "string") {
      const text = source.trim();
      if (!text) return [];
      try {
        source = JSON.parse(text);
      } catch {
        source = [text];
      }
    }
    if (!Array.isArray(source)) return [];
    const out = [];
    for (const entry of source) {
      const parsed = parsePaletteRgbColorTokenUi(entry);
      if (!parsed) continue;
      out.push(parsed);
      if (out.length >= 64) break;
    }
    return out;
  };
  const defaultColors = normalizeList(PALETTE_FAMILY_DEFS?.custom?.colors || PALETTE_FAMILY_DEFS_DEFAULT?.custom?.colors || []);
  const fallbackList = normalizeList(fallback);
  const sourceList = normalizeList(value);
  const base = sourceList.length
    ? sourceList
    : (fallbackList.length ? fallbackList : defaultColors);
  const safe = base.length ? base : [{ r: 255, g: 255, b: 255 }];
  return safe.map(color => ({
    r: clampNumber(Math.round(Number(color?.r) || 0), 0, 255, 0),
    g: clampNumber(Math.round(Number(color?.g) || 0), 0, 255, 0),
    b: clampNumber(Math.round(Number(color?.b) || 0), 0, 255, 0)
  }));
}

function getPaletteFamilyColorBankUi(familyId = "red", config = null) {
  const key = String(familyId || "").trim().toLowerCase();
  const mapped = PALETTE_FAMILY_ALIASES[key] || key;
  const safeConfig = config && typeof config === "object" ? config : {};
  if (mapped === "custom") {
    return normalizePaletteCustomFamilyColorsUi(
      safeConfig.customFamilyColors,
      ui.paletteCustomFamilyColors || PALETTE_FAMILY_DEFS?.custom?.colors || PALETTE_FAMILY_DEFS_DEFAULT?.custom?.colors || []
    );
  }
  const family = PALETTE_FAMILY_DEFS[mapped];
  if (!family || !Array.isArray(family.colors)) return [];
  return family.colors.map(color => ({
    r: clampNumber(Math.round(Number(color?.r) || 0), 0, 255, 0),
    g: clampNumber(Math.round(Number(color?.g) || 0), 0, 255, 0),
    b: clampNumber(Math.round(Number(color?.b) || 0), 0, 255, 0)
  }));
}

function resolvePaletteDefaultIndexSpanUi(familyId = "red", colorCount = 3, config = null) {
  const colors = getPaletteFamilyColorBankUi(familyId, config);
  const max = colors.length;
  if (!(max > 0)) return [0];
  const count = clampNumber(
    normalizePaletteColorCountUi(colorCount, Math.min(max, 3)),
    1,
    max,
    Math.min(max, 3)
  );
  const fixedSpanByCount = {
    1: [5],
    2: [0, 11],
    3: [0, 6, 11],
    4: [0, 4, 7, 11],
    5: [0, 3, 6, 8, 11],
    6: [0, 2, 4, 7, 9, 11],
    7: [0, 2, 4, 6, 7, 9, 11],
    8: [0, 2, 3, 5, 6, 8, 9, 11],
    9: [0, 1, 3, 4, 6, 7, 8, 10, 11],
    10: [0, 1, 2, 4, 5, 6, 7, 9, 10, 11],
    11: [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11],
    12: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  };
  if (max >= 12 && fixedSpanByCount[count]) {
    return fixedSpanByCount[count].filter(idx => idx >= 0 && idx < max);
  }
  if (count >= max) {
    return Array.from({ length: max }, (_, idx) => idx);
  }
  if (count === 1) {
    return [Math.floor((max - 1) / 2)];
  }
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const index = Math.round((i * (max - 1)) / (count - 1));
    if (!out.includes(index)) out.push(index);
  }
  for (let idx = 0; out.length < count && idx < max; idx += 1) {
    if (!out.includes(idx)) out.push(idx);
  }
  out.sort((a, b) => a - b);
  return out;
}

function buildPaletteUniformColorCountsUi(colorCount = 3) {
  const count = normalizePaletteColorCountUi(colorCount, 3);
  const out = {};
  for (const family of PALETTE_FAMILY_ORDER) {
    out[family] = count;
  }
  return out;
}

function buildPaletteUniformColorIndexesUi(colorCount = 3) {
  const count = normalizePaletteColorCountUi(colorCount, 3);
  const out = {};
  for (const family of PALETTE_FAMILY_ORDER) {
    out[family] = resolvePaletteDefaultIndexSpanUi(family, count);
  }
  return out;
}

function normalizePaletteFamilyColorCountsUi(
  value,
  fallback = null,
  fallbackColorCount = 3
) {
  const fallbackCount = normalizePaletteColorCountUi(fallbackColorCount, 3);
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const fallbackSource = fallback && typeof fallback === "object" && !Array.isArray(fallback)
    ? fallback
    : buildPaletteUniformColorCountsUi(fallbackCount);
  const out = {};
  for (const family of PALETTE_FAMILY_ORDER) {
    const raw = Object.prototype.hasOwnProperty.call(source, family)
      ? source[family]
      : Object.prototype.hasOwnProperty.call(fallbackSource, family)
        ? fallbackSource[family]
        : fallbackCount;
    out[family] = normalizePaletteColorCountUi(raw, fallbackCount);
  }
  return out;
}

function normalizePaletteFamilyColorIndexesUi(
  value,
  fallback = null,
  familyColorCounts = null,
  customFamilyColors = null
) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const fallbackSource = fallback && typeof fallback === "object" && !Array.isArray(fallback)
    ? fallback
    : {};
  const countMap = familyColorCounts && typeof familyColorCounts === "object"
    ? familyColorCounts
    : buildPaletteUniformColorCountsUi(3);
  const normalizedCustomFamilyColors = normalizePaletteCustomFamilyColorsUi(
    customFamilyColors,
    ui.paletteCustomFamilyColors || PALETTE_FAMILY_DEFS?.custom?.colors || PALETTE_FAMILY_DEFS_DEFAULT?.custom?.colors || []
  );
  const customConfig = {
    customFamilyColors: normalizedCustomFamilyColors
  };
  const out = {};
  for (const family of PALETTE_FAMILY_ORDER) {
    const colors = family === "custom"
      ? normalizedCustomFamilyColors
      : getPaletteFamilyColorBankUi(family, customConfig);
    const maxIndex = Math.max(0, colors.length - 1);
    const desiredCount = clampNumber(
      normalizePaletteColorCountUi(countMap[family], 3),
      1,
      Math.max(1, colors.length),
      Math.min(3, Math.max(1, colors.length))
    );
    const rawList = Object.prototype.hasOwnProperty.call(source, family)
      ? source[family]
      : Object.prototype.hasOwnProperty.call(fallbackSource, family)
        ? fallbackSource[family]
        : resolvePaletteDefaultIndexSpanUi(family, desiredCount, customConfig);
    const parsed = Array.isArray(rawList)
      ? rawList
      : String(rawList || "")
        .split(",")
        .map(part => part.trim())
        .filter(Boolean);
    const deduped = [];
    for (const token of parsed) {
      const idx = Math.round(Number(token));
      if (!Number.isFinite(idx)) continue;
      if (idx < 0 || idx > maxIndex) continue;
      if (deduped.includes(idx)) continue;
      deduped.push(idx);
    }
    out[family] = deduped.length
      ? deduped
      : resolvePaletteDefaultIndexSpanUi(family, desiredCount, customConfig);
  }
  return out;
}

function normalizePaletteSequenceFamilyUi(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const mapped = PALETTE_FAMILY_ALIASES[raw] || raw;
  return PALETTE_FAMILY_ORDER.includes(mapped) ? mapped : "";
}

function parsePaletteColorSequenceEntryUi(value = null) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const family = normalizePaletteSequenceFamilyUi(
      value.family ?? value.familyId ?? value.group ?? value.id
    );
    const index = Math.round(Number(value.index ?? value.colorIndex ?? value.slot ?? value.value));
    if (!family || !Number.isFinite(index)) return null;
    return { family, index };
  }
  const text = String(value || "").trim();
  if (!text) return null;
  const match = text.match(/^([a-z_]+)\s*[:/.|,]\s*(-?\d+)$/i);
  if (!match) return null;
  const family = normalizePaletteSequenceFamilyUi(match[1]);
  const index = Math.round(Number(match[2]));
  if (!family || !Number.isFinite(index)) return null;
  return { family, index };
}

function normalizePaletteColorSequenceUi(value, fallback = null, config = {}) {
  const safeConfig = config && typeof config === "object" ? config : {};
  const normalizedCustomFamilyColors = normalizePaletteCustomFamilyColorsUi(
    safeConfig.customFamilyColors,
    ui.paletteCustomFamilyColors || PALETTE_FAMILY_DEFS?.custom?.colors || PALETTE_FAMILY_DEFS_DEFAULT?.custom?.colors || []
  );
  const banks = {};
  for (const family of PALETTE_FAMILY_ORDER) {
    banks[family] = family === "custom"
      ? normalizedCustomFamilyColors
      : getPaletteFamilyColorBankUi(family, { customFamilyColors: normalizedCustomFamilyColors });
  }

  const parseSource = source => {
    let next = source;
    if (typeof next === "string") {
      const text = next.trim();
      if (!text) return [];
      try {
        next = JSON.parse(text);
      } catch {
        next = text.split(",").map(part => part.trim()).filter(Boolean);
      }
    }
    if (!Array.isArray(next)) return [];
    const out = [];
    const seen = new Set();
    for (const token of next) {
      const parsed = parsePaletteColorSequenceEntryUi(token);
      if (!parsed) continue;
      const familyColors = Array.isArray(banks[parsed.family]) ? banks[parsed.family] : [];
      const maxIndex = Math.max(0, familyColors.length - 1);
      if (parsed.index < 0 || parsed.index > maxIndex) continue;
      const key = `${parsed.family}:${parsed.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(parsed);
    }
    return out;
  };

  const primary = parseSource(value);
  if (primary.length) return primary;
  const fallbackList = parseSource(fallback);
  return fallbackList.length ? fallbackList : [{ family: "red", index: 0 }];
}

function derivePaletteLegacySelectionFromColorSequenceUi(sequence = [], fallback = {}) {
  const safeFallback = fallback && typeof fallback === "object"
    ? fallback
    : {};
  const normalizedSequence = normalizePaletteColorSequenceUi(
    sequence,
    safeFallback.colorSequence || null,
    safeFallback
  );
  const indexMap = {};
  for (const family of PALETTE_FAMILY_ORDER) {
    indexMap[family] = [];
  }
  for (const entry of normalizedSequence) {
    const family = normalizePaletteSequenceFamilyUi(entry.family);
    const index = Math.round(Number(entry.index));
    if (!family || !Number.isFinite(index)) continue;
    if (!indexMap[family].includes(index)) {
      indexMap[family].push(index);
    }
  }
  const activeFamilies = PALETTE_FAMILY_ORDER.filter(family => indexMap[family].length > 0);
  const families = activeFamilies.length
    ? activeFamilies
    : normalizePaletteFamiliesUi(safeFallback.families, PALETTE_FAMILY_ORDER);
  const longest = families.reduce((maxCount, family) => {
    const size = Array.isArray(indexMap[family]) ? indexMap[family].length : 0;
    return Math.max(maxCount, size);
  }, 0);
  const colorsPerFamily = normalizePaletteColorCountUi(
    longest || safeFallback.colorsPerFamily || 3,
    safeFallback.colorsPerFamily || 3
  );
  const counts = {};
  for (const family of PALETTE_FAMILY_ORDER) {
    const list = indexMap[family];
    if (Array.isArray(list) && list.length) {
      counts[family] = list.length;
    }
  }
  const familyColorCounts = normalizePaletteFamilyColorCountsUi(
    counts,
    safeFallback.familyColorCounts || buildPaletteUniformColorCountsUi(colorsPerFamily),
    colorsPerFamily
  );
  const familyColorIndexes = normalizePaletteFamilyColorIndexesUi(
    indexMap,
    safeFallback.familyColorIndexes || buildPaletteUniformColorIndexesUi(colorsPerFamily),
    familyColorCounts,
    safeFallback.customFamilyColors
  );
  return {
    colorsPerFamily,
    families,
    familyColorCounts,
    familyColorIndexes
  };
}

function resolvePaletteColorCountForFamilyUi(
  config = {},
  familyId = "red",
  fallback = 3
) {
  const key = String(familyId || "").trim().toLowerCase();
  const mapped = PALETTE_FAMILY_ALIASES[key] || key;
  const fallbackCount = normalizePaletteColorCountUi(config?.colorsPerFamily, fallback);
  if (!PALETTE_FAMILY_ORDER.includes(mapped)) return fallbackCount;
  const indexMap = config?.familyColorIndexes && typeof config.familyColorIndexes === "object"
    ? config.familyColorIndexes
    : null;
  if (indexMap && Array.isArray(indexMap[mapped]) && indexMap[mapped].length) {
    return normalizePaletteColorCountUi(indexMap[mapped].length, fallbackCount);
  }
  const counts = config?.familyColorCounts && typeof config.familyColorCounts === "object"
    ? config.familyColorCounts
    : null;
  if (!counts || !Object.prototype.hasOwnProperty.call(counts, mapped)) return fallbackCount;
  return normalizePaletteColorCountUi(counts[mapped], fallbackCount);
}

function resolvePaletteColorIndexesForFamilyUi(
  config = {},
  familyId = "red",
  fallback = 3
) {
  const key = String(familyId || "").trim().toLowerCase();
  const mapped = PALETTE_FAMILY_ALIASES[key] || key;
  const fallbackCount = normalizePaletteColorCountUi(config?.colorsPerFamily, fallback);
  if (!PALETTE_FAMILY_ORDER.includes(mapped)) return resolvePaletteDefaultIndexSpanUi("red", fallbackCount, config);
  const count = resolvePaletteColorCountForFamilyUi(config, mapped, fallbackCount);
  const map = config?.familyColorIndexes && typeof config.familyColorIndexes === "object"
    ? config.familyColorIndexes
    : null;
  if (!map || !Object.prototype.hasOwnProperty.call(map, mapped)) {
    return resolvePaletteDefaultIndexSpanUi(mapped, count, config);
  }
  return normalizePaletteFamilyColorIndexesUi(
    { [mapped]: map[mapped] },
    { [mapped]: resolvePaletteDefaultIndexSpanUi(mapped, count, config) },
    { [mapped]: count },
    config?.customFamilyColors
  )[mapped];
}

function getPaletteUniformColorCountUi(config = {}, families = null) {
  const normalizedFamilies = normalizePaletteFamiliesUi(
    Array.isArray(families) && families.length ? families : config?.families,
    PALETTE_FAMILY_ORDER
  );
  if (!normalizedFamilies.length) return null;
  const first = resolvePaletteColorCountForFamilyUi(config, normalizedFamilies[0], config?.colorsPerFamily || 3);
  for (let i = 1; i < normalizedFamilies.length; i += 1) {
    const next = resolvePaletteColorCountForFamilyUi(config, normalizedFamilies[i], config?.colorsPerFamily || 3);
    if (next !== first) return null;
  }
  return first;
}

function formatPaletteCountSummaryUi(config = {}, families = null) {
  const uniform = getPaletteUniformColorCountUi(config, families);
  if (Number.isFinite(uniform)) return `x${uniform}`;
  return "MIXED";
}

const paletteUiInputAdapter = (typeof createPaletteUiInputAdapter === "function"
  ? createPaletteUiInputAdapter({
    clampNumber,
    cycleModeOrder: PALETTE_CYCLE_MODE_ORDER,
    spectrumMapModeOrder: PALETTE_SPECTRUM_MAP_MODE_ORDER,
    audioFeatureKeys: PALETTE_AUDIO_FEATURE_KEYS,
    defaultSpectrumFeatureMap: PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP,
    vividnessLevelOptions: PALETTE_VIVIDNESS_LEVEL_OPTIONS,
    timedIntervalMinSec: PALETTE_TIMED_INTERVAL_MIN_SEC,
    timedIntervalMaxSec: PALETTE_TIMED_INTERVAL_MAX_SEC,
    beatLockGraceMinSec: PALETTE_BEAT_LOCK_GRACE_MIN_SEC,
    beatLockGraceMaxSec: PALETTE_BEAT_LOCK_GRACE_MAX_SEC,
    reactiveMarginMin: PALETTE_REACTIVE_MARGIN_MIN,
    reactiveMarginMax: PALETTE_REACTIVE_MARGIN_MAX,
    brightnessFollowAmountMin: PALETTE_BRIGHTNESS_FOLLOW_AMOUNT_MIN,
    brightnessFollowAmountMax: PALETTE_BRIGHTNESS_FOLLOW_AMOUNT_MAX
  })
  : (() => {
    throw new Error("palette UI input adapter module missing");
  })());
function normalizePaletteDisorderAggressionUi(value, fallback = 0.35) {
  return paletteUiInputAdapter.normalizePaletteDisorderAggressionUi(value, fallback);
}
function normalizePaletteCycleModeUi(value, fallback = "on_trigger") {
  return paletteUiInputAdapter.normalizePaletteCycleModeUi(value, fallback);
}
function normalizePaletteTimedIntervalSecUi(value, fallback = 5) {
  return paletteUiInputAdapter.normalizePaletteTimedIntervalSecUi(value, fallback);
}
function normalizePaletteBeatLockGraceSecUi(value, fallback = 2) {
  return paletteUiInputAdapter.normalizePaletteBeatLockGraceSecUi(value, fallback);
}
function normalizePaletteReactiveMarginUi(value, fallback = 28) {
  return paletteUiInputAdapter.normalizePaletteReactiveMarginUi(value, fallback);
}
function normalizePaletteBrightnessFollowAmountUi(value, fallback = 1) {
  return paletteUiInputAdapter.normalizePaletteBrightnessFollowAmountUi(value, fallback);
}
function normalizePaletteVividnessUi(value, fallback = 2) {
  return paletteUiInputAdapter.normalizePaletteVividnessUi(value, fallback);
}
function normalizePaletteSpectrumMapModeUi(value, fallback = "auto") {
  return paletteUiInputAdapter.normalizePaletteSpectrumMapModeUi(value, fallback);
}
function normalizePaletteAudioFeatureUi(value, fallback = "rms") {
  return paletteUiInputAdapter.normalizePaletteAudioFeatureUi(value, fallback);
}
function normalizePaletteSpectrumFeatureMapUi(value, fallback = PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP) {
  return paletteUiInputAdapter.normalizePaletteSpectrumFeatureMapUi(value, fallback);
}

function getPaletteFamiliesLabelUi(families) {
  const normalized = normalizePaletteFamiliesUi(families, ui.paletteFamilies);
  return normalized.map(name => String(name || "").toUpperCase()).join("+");
}

const PALETTE_CONFIG_CONTRACT_DEFAULT_UI = Object.freeze({
  colorsPerFamily: 3,
  familyColorCounts: Object.freeze(buildPaletteUniformColorCountsUi(3)),
  familyColorIndexes: Object.freeze(buildPaletteUniformColorIndexesUi(3)),
  families: Object.freeze([...PALETTE_FAMILY_ORDER]),
  disorder: false,
  disorderAggression: 0.35,
  cycleMode: "on_trigger",
  timedIntervalSec: 5,
  beatLock: false,
  beatLockGraceSec: 2,
  reactiveMargin: 28,
  brightnessFollowAmount: 1,
  vividness: 2,
  spectrumMapMode: "auto",
  spectrumFeatureMap: Object.freeze([...PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP])
});
const {
  normalizePaletteConfigUi,
  normalizePaletteBrandOverridesUi,
  normalizePaletteFixtureOverridesUi
} = (typeof createPaletteConfigNormalizationRuntimeUi === "function"
  ? createPaletteConfigNormalizationRuntimeUi({
    ui,
    contract: PALETTE_CONFIG_CONTRACT,
    configDefault: PALETTE_CONFIG_CONTRACT_DEFAULT_UI,
    PALETTE_FAMILY_ORDER,
    PALETTE_FAMILY_ALIASES,
    PALETTE_FAMILY_DEFS,
    PALETTE_FAMILY_DEFS_DEFAULT,
    PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP,
    PALETTE_SUPPORTED_BRANDS,
    buildPaletteUniformColorCountsUi,
    buildPaletteUniformColorIndexesUi,
    resolvePaletteDefaultIndexSpanUi,
    normalizePaletteColorCountUi,
    normalizePaletteDisorderAggressionUi,
    normalizePaletteCycleModeUi,
    normalizePaletteTimedIntervalSecUi,
    normalizePaletteBeatLockGraceSecUi,
    normalizePaletteReactiveMarginUi,
    normalizePaletteBrightnessFollowAmountUi,
    normalizePaletteVividnessUi,
    normalizePaletteSpectrumMapModeUi,
    normalizePaletteSpectrumFeatureMapUi,
    parseBooleanUi,
    normalizePaletteCustomFamilyColorsUi,
    normalizePaletteFamilyColorCountsUi,
    normalizePaletteFamilyColorIndexesUi,
    normalizePaletteFamiliesUi,
    normalizePaletteColorSequenceUi,
    derivePaletteLegacySelectionFromColorSequenceUi,
    normalizePaletteBrandUi
  })
  : (() => {
    throw new Error("palette config normalization runtime module missing");
  })());

// [TITLE] Section: Palette Fixture-Metric Contract Runtime Composition
// [DEV] Fixture-metric snapshot normalization is delegated to a focused module so palette.js
// [DEV] keeps stable helper names while reducing monolith complexity.
const paletteFixtureMetricContractRuntime = (typeof createPaletteFixtureMetricContractRuntimeUi === "function"
  ? createPaletteFixtureMetricContractRuntimeUi({
    ui,
    clampNumber,
    parseBooleanUi,
    normalizePaletteBrandUi,
    contract: PALETTE_METRIC_CONTRACT,
    defaults: {
      supportedBrands: PALETTE_SUPPORTED_BRANDS,
      modeOrder: FIXTURE_METRIC_MODE_ORDER,
      metricKeys: FIXTURE_METRIC_KEYS,
      configDefault: FIXTURE_METRIC_CONFIG_DEFAULT,
      limits: {
        harmonyMin: FIXTURE_METRIC_HARMONY_MIN,
        harmonyMax: FIXTURE_METRIC_HARMONY_MAX,
        maxHzMin: FIXTURE_METRIC_MAX_HZ_MIN,
        maxHzMax: FIXTURE_METRIC_MAX_HZ_MAX
      }
    }
  })
  : (() => {
    throw new Error("palette fixture-metric contract runtime module missing");
  })());
function normalizeFixtureMetricModeUi(value, fallback = FIXTURE_METRIC_CONFIG_DEFAULT.mode) {
  return paletteFixtureMetricContractRuntime.normalizeFixtureMetricModeUi(value, fallback);
}
function normalizeFixtureMetricKeyUi(value, fallback = FIXTURE_METRIC_CONFIG_DEFAULT.metric) {
  return paletteFixtureMetricContractRuntime.normalizeFixtureMetricKeyUi(value, fallback);
}
function normalizeFixtureMetricHarmonySizeUi(value, fallback = FIXTURE_METRIC_CONFIG_DEFAULT.harmonySize) {
  return paletteFixtureMetricContractRuntime.normalizeFixtureMetricHarmonySizeUi(value, fallback);
}
function normalizeFixtureMetricMaxHzUi(value, fallback = FIXTURE_METRIC_CONFIG_DEFAULT.maxHz) {
  return paletteFixtureMetricContractRuntime.normalizeFixtureMetricMaxHzUi(value, fallback);
}
function formatFixtureMetricMaxHzUi(value) {
  return paletteFixtureMetricContractRuntime.formatFixtureMetricMaxHzUi(value);
}
function normalizeFixtureMetricConfigUi(config = {}, fallback = null) {
  return paletteFixtureMetricContractRuntime.normalizeFixtureMetricConfigUi(config, fallback);
}
function normalizeFixtureMetricBrandOverridesUi(raw = {}, globalConfig = null) {
  return paletteFixtureMetricContractRuntime.normalizeFixtureMetricBrandOverridesUi(raw, globalConfig);
}
function normalizeFixtureMetricFixtureOverridesUi(raw = {}, brandOverrides = null, globalConfig = null) {
  return paletteFixtureMetricContractRuntime.normalizeFixtureMetricFixtureOverridesUi(
    raw,
    brandOverrides,
    globalConfig
  );
}

// [TITLE] Section: Palette Scope-Config Runtime Composition
// [DEV] Palette brand/fixture scoped config and fixture-metric scope helpers are delegated
// [DEV] to a bounded runtime module to keep palette orchestrator focused on core contracts.
const paletteScopeConfigRuntime = (typeof createPaletteScopeConfigRuntimeUi === "function"
  ? createPaletteScopeConfigRuntimeUi({
    ui,
    normalizeFixtureMetricConfigUi,
    FIXTURE_METRIC_CONFIG_DEFAULT,
    normalizeFixtureMetricBrandOverridesUi,
    normalizeFixtureMetricFixtureOverridesUi,
    normalizePaletteBrandUi,
    PALETTE_ALL_FIXTURES_VALUE,
    normalizePaletteConfigUi,
    buildPaletteUniformColorCountsUi,
    buildPaletteUniformColorIndexesUi,
    PALETTE_FAMILY_DEFS,
    PALETTE_FAMILY_DEFS_DEFAULT,
    PALETTE_FAMILY_ORDER,
    normalizePaletteColorSequenceUi,
    normalizePaletteCustomFamilyColorsUi,
    normalizePaletteSpectrumFeatureMapUi,
    PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP,
    normalizePaletteBrandOverridesUi,
    normalizePaletteFixtureOverridesUi,
    // [DEV] Palette family renderer is injected later by palette-runtime-wiring-ui.js
    // [DEV] to avoid lexical init-order coupling across split runtime files.
    renderPaletteFamilyButtons: () => {},
    parseBooleanUi
  })
  : (() => {
    throw new Error("palette scope-config runtime module missing");
  })());
function applyFixtureMetricRoutingSnapshotToUi(snapshot = {}) {
  return paletteScopeConfigRuntime.applyFixtureMetricRoutingSnapshotToUi(snapshot);
}
function getFixtureMetricBrandConfigUi(brand) {
  return paletteScopeConfigRuntime.getFixtureMetricBrandConfigUi(brand);
}
function getFixtureMetricScopedConfigUi(brand, fixtureId = PALETTE_ALL_FIXTURES_VALUE) {
  return paletteScopeConfigRuntime.getFixtureMetricScopedConfigUi(brand, fixtureId);
}
function applyPaletteSnapshotToUi(config = {}, options = {}) {
  return paletteScopeConfigRuntime.applyPaletteSnapshotToUi(config, options);
}
function getPaletteGlobalConfigUi() {
  return paletteScopeConfigRuntime.getPaletteGlobalConfigUi();
}
function getPaletteBrandConfigUi(brand) {
  return paletteScopeConfigRuntime.getPaletteBrandConfigUi(brand);
}
function getPaletteScopedConfigUi(brand, fixtureId = PALETTE_ALL_FIXTURES_VALUE) {
  return paletteScopeConfigRuntime.getPaletteScopedConfigUi(brand, fixtureId);
}
function getPaletteBrandFixturesUi(brand) {
  return paletteScopeConfigRuntime.getPaletteBrandFixturesUi(brand);
}

function escapeHtmlUi(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function markPaletteGlobalPanelInteraction(holdMs = 1200) {
  const nextUntil = Date.now() + Math.max(250, Number(holdMs) || 1200);
  if (nextUntil > paletteGlobalPanelInteractionUntil) {
    paletteGlobalPanelInteractionUntil = nextUntil;
  }
}

function isPaletteGlobalPanelInteractionActive() {
  if (el.paletteGlobalPanel && document.activeElement && el.paletteGlobalPanel.contains(document.activeElement)) {
    const active = document.activeElement;
    const tag = String(active.tagName || "").trim().toLowerCase();
    if (tag === "select" || tag === "input" || tag === "textarea") {
      return true;
    }
  }
  return Date.now() < Number(paletteGlobalPanelInteractionUntil || 0);
}

// [DEV] Contract-first metadata resolver:
// [DEV] Palette family metadata is sourced only from the shared server contract.
// [DEV] Legacy snapshot `options` metadata is intentionally ignored so browser
// [DEV] family defs/order/count options cannot drift from the canonical contract.
// [TITLE] Section: Palette Runtime Metadata Composition
// [DEV] Contract metadata hydration (families/aliases/defs/counts) is delegated to a
// [DEV] focused runtime module while palette.js preserves stable helper names.
const paletteRuntimeMetadataState = {
  get familyOrder() { return PALETTE_FAMILY_ORDER; },
  set familyOrder(value) { PALETTE_FAMILY_ORDER = value; },
  get familyAliases() { return PALETTE_FAMILY_ALIASES; },
  set familyAliases(value) { PALETTE_FAMILY_ALIASES = value; },
  get colorCountOptions() { return PALETTE_COLOR_COUNT_OPTIONS; },
  set colorCountOptions(value) { PALETTE_COLOR_COUNT_OPTIONS = value; },
  get familyDefs() { return PALETTE_FAMILY_DEFS; },
  set familyDefs(value) { PALETTE_FAMILY_DEFS = value; }
};
const paletteRuntimeMetadataRuntime = (typeof createPaletteRuntimeMetadataRuntimeUi === "function"
  ? createPaletteRuntimeMetadataRuntimeUi({
    state: paletteRuntimeMetadataState,
    clampNumber,
    defaults: {
      familyOrderDefault: PALETTE_FAMILY_ORDER_DEFAULT,
      familyAliasesDefault: PALETTE_FAMILY_ALIASES_DEFAULT,
      colorCountOptionsDefault: PALETTE_COLOR_COUNT_OPTIONS_DEFAULT,
      familyDefsDefault: PALETTE_FAMILY_DEFS_DEFAULT
    }
  })
  : (() => {
    throw new Error("palette runtime metadata module missing");
  })());
function resolvePaletteRuntimeMetadataPayloadUi(snapshot = {}) {
  return paletteRuntimeMetadataRuntime.resolvePaletteRuntimeMetadataPayloadUi(snapshot);
}
function applyPaletteRuntimeMetadataUi(snapshot = {}) {
  return paletteRuntimeMetadataRuntime.applyPaletteRuntimeMetadataUi(snapshot);
}

const {
  applyPaletteRuntimeSnapshotToUi
} = (typeof createPaletteRuntimeSnapshotRuntimeUi === "function"
  ? createPaletteRuntimeSnapshotRuntimeUi({
    ui,
    windowRef: typeof window !== "undefined" ? window : null,
    CustomEventRef: typeof CustomEvent === "function" ? CustomEvent : null,
    applyPaletteRuntimeMetadataUi,
    applyPaletteSnapshotToUi,
    applyFixtureMetricRoutingSnapshotToUi,
    renderPaletteBrandMenus: options => renderPaletteBrandMenus(options)
  })
  : (() => {
    throw new Error("palette runtime snapshot module missing");
  })());


