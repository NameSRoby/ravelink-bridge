// [TITLE] Module: domains/palette/palette-sequence-resolver.js
// [TITLE] Purpose: canonical palette config normalization + engine-v2 sequence resolution
// [TITLE] Functionality Index:
// [TITLE] - normalize persisted palette scope configs so canonical colorSequence is always present
// [TITLE] - resolve canonical family/index palette sequences into deterministic RGB hex values
// [TITLE] - derive engine-v2 holdTicks from canonical cycle configuration

const { rgbToHex } = require("../colors/color-space");

const PALETTE_FAMILY_ORDER = Object.freeze(["red", "yellow", "green", "violet", "blue", "custom"]);
const PALETTE_FAMILY_BANK_DEFAULT = Object.freeze({
  red: Object.freeze([
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
  ]),
  yellow: Object.freeze([
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
  ]),
  green: Object.freeze([
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
  ]),
  violet: Object.freeze([
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
  ]),
  blue: Object.freeze([
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
  ]),
  custom: Object.freeze([
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
});
const VIVIDNESS_LEVEL_OPTIONS = Object.freeze([0, 1, 2, 3, 4]);

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number(fallback);
  return Math.min(Number(max), Math.max(Number(min), parsed));
}

function normalizeFamilyToken(value) {
  const token = String(value || "").trim().toLowerCase();
  return PALETTE_FAMILY_ORDER.includes(token) ? token : "";
}

function normalizePaletteColorCount(value, fallback = 3) {
  return Math.max(1, Math.min(64, Math.round(clampNumber(Number(value), 1, 64, fallback))));
}

function normalizeRgbColor(raw = {}, fallback = { r: 255, g: 255, b: 255 }) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    r: clampNumber(Math.round(Number(source.r)), 0, 255, fallback.r),
    g: clampNumber(Math.round(Number(source.g)), 0, 255, fallback.g),
    b: clampNumber(Math.round(Number(source.b)), 0, 255, fallback.b)
  };
}

function normalizePaletteCustomFamilyColors(value = []) {
  const source = Array.isArray(value) ? value : [];
  const out = [];
  for (const row of source) {
    out.push(normalizeRgbColor(row));
    if (out.length >= 64) break;
  }
  return out.length
    ? out
    : PALETTE_FAMILY_BANK_DEFAULT.custom.map(color => ({ ...color }));
}

function resolveDefaultIndexSpan(family = "red", count = 3, customFamilyColors = []) {
  const safeFamily = normalizeFamilyToken(family) || "red";
  const desiredCount = normalizePaletteColorCount(count, 3);
  const familyColors = safeFamily === "custom"
    ? normalizePaletteCustomFamilyColors(customFamilyColors)
    : (Array.isArray(PALETTE_FAMILY_BANK_DEFAULT[safeFamily]) ? PALETTE_FAMILY_BANK_DEFAULT[safeFamily] : PALETTE_FAMILY_BANK_DEFAULT.red);
  const maxIndex = Math.max(0, familyColors.length - 1);
  const out = [];
  for (let index = 0; index <= maxIndex && out.length < desiredCount; index += 1) {
    out.push(index);
  }
  return out.length ? out : [0];
}

function normalizeFamilies(value, fallback = PALETTE_FAMILY_ORDER) {
  const list = Array.isArray(value)
    ? value
    : String(value || "").split(",").map(item => item.trim()).filter(Boolean);
  const out = [];
  for (const raw of list) {
    const family = normalizeFamilyToken(raw);
    if (!family || out.includes(family)) continue;
    out.push(family);
  }
  if (out.length) return out;
  return Array.isArray(fallback) && fallback.length
    ? normalizeFamilies(fallback, PALETTE_FAMILY_ORDER)
    : ["red"];
}

function normalizeFamilyColorCounts(value, fallback = {}, fallbackColorsPerFamily = 3) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const fallbackMap = fallback && typeof fallback === "object" && !Array.isArray(fallback) ? fallback : {};
  const out = {};
  for (const family of PALETTE_FAMILY_ORDER) {
    const raw = Object.prototype.hasOwnProperty.call(source, family)
      ? source[family]
      : Object.prototype.hasOwnProperty.call(fallbackMap, family)
        ? fallbackMap[family]
        : fallbackColorsPerFamily;
    out[family] = normalizePaletteColorCount(raw, fallbackColorsPerFamily);
  }
  return out;
}

function normalizeFamilyColorIndexes(value, fallback = {}, familyColorCounts = {}, customFamilyColors = []) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const fallbackMap = fallback && typeof fallback === "object" && !Array.isArray(fallback) ? fallback : {};
  const countMap = familyColorCounts && typeof familyColorCounts === "object" ? familyColorCounts : {};
  const out = {};
  for (const family of PALETTE_FAMILY_ORDER) {
    const fallbackCount = normalizePaletteColorCount(countMap[family], 3);
    const rawList = Object.prototype.hasOwnProperty.call(source, family)
      ? source[family]
      : Object.prototype.hasOwnProperty.call(fallbackMap, family)
        ? fallbackMap[family]
        : resolveDefaultIndexSpan(family, fallbackCount, customFamilyColors);
    const parsed = Array.isArray(rawList)
      ? rawList
      : String(rawList || "").split(",").map(item => item.trim()).filter(Boolean);
    const seen = new Set();
    const list = [];
    const familyColors = family === "custom"
      ? normalizePaletteCustomFamilyColors(customFamilyColors)
      : (Array.isArray(PALETTE_FAMILY_BANK_DEFAULT[family]) ? PALETTE_FAMILY_BANK_DEFAULT[family] : PALETTE_FAMILY_BANK_DEFAULT.red);
    const maxIndex = Math.max(0, familyColors.length - 1);
    for (const token of parsed) {
      const index = Math.round(Number(token));
      if (!Number.isFinite(index) || index < 0 || index > maxIndex) continue;
      if (seen.has(index)) continue;
      seen.add(index);
      list.push(index);
    }
    out[family] = list.length
      ? list
      : resolveDefaultIndexSpan(family, fallbackCount, customFamilyColors);
  }
  return out;
}

function parsePaletteSequenceEntry(value = null) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const family = normalizeFamilyToken(value.family ?? value.familyId ?? value.group ?? value.id);
    const index = Math.round(Number(value.index ?? value.colorIndex ?? value.slot ?? value.value));
    if (!family || !Number.isFinite(index) || index < 0) return null;
    return { family, index };
  }
  const text = String(value || "").trim();
  if (!text) return null;
  const match = text.match(/^([a-z_]+)\s*[:/.|,]\s*(-?\d+)$/i);
  if (!match) return null;
  const family = normalizeFamilyToken(match[1]);
  const index = Math.round(Number(match[2]));
  if (!family || !Number.isFinite(index) || index < 0) return null;
  return { family, index };
}

function buildSequenceFromLegacySelection(config = {}) {
  const safe = config && typeof config === "object" && !Array.isArray(config) ? config : {};
  const customFamilyColors = normalizePaletteCustomFamilyColors(safe.customFamilyColors);
  const colorsPerFamily = normalizePaletteColorCount(safe.colorsPerFamily, 3);
  const families = normalizeFamilies(safe.families, PALETTE_FAMILY_ORDER);
  const familyColorCounts = normalizeFamilyColorCounts(
    safe.familyColorCounts,
    {},
    colorsPerFamily
  );
  const familyColorIndexes = normalizeFamilyColorIndexes(
    safe.familyColorIndexes,
    {},
    familyColorCounts,
    customFamilyColors
  );
  const out = [];
  for (const family of families) {
    const indexes = Array.isArray(familyColorIndexes[family]) && familyColorIndexes[family].length
      ? familyColorIndexes[family]
      : resolveDefaultIndexSpan(family, familyColorCounts[family] || colorsPerFamily, customFamilyColors);
    for (const index of indexes) {
      out.push({
        family,
        index: Math.max(0, Math.round(Number(index) || 0))
      });
      if (out.length >= 256) return out;
    }
  }
  return out.length ? out : [{ family: "red", index: 0 }];
}

function normalizeColorSequence(value, fallback = [], config = {}) {
  const safeConfig = config && typeof config === "object" && !Array.isArray(config) ? config : {};
  const customFamilyColors = normalizePaletteCustomFamilyColors(safeConfig.customFamilyColors);
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
      const parsed = parsePaletteSequenceEntry(token);
      if (!parsed) continue;
      const familyColors = parsed.family === "custom"
        ? customFamilyColors
        : (Array.isArray(PALETTE_FAMILY_BANK_DEFAULT[parsed.family]) ? PALETTE_FAMILY_BANK_DEFAULT[parsed.family] : PALETTE_FAMILY_BANK_DEFAULT.red);
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

function deriveLegacySelectionFromColorSequence(sequence = [], fallback = {}) {
  const safeFallback = fallback && typeof fallback === "object" && !Array.isArray(fallback) ? fallback : {};
  const normalizedSequence = normalizeColorSequence(sequence, safeFallback.colorSequence || null, safeFallback);
  const indexMap = {};
  for (const family of PALETTE_FAMILY_ORDER) {
    indexMap[family] = [];
  }
  for (const entry of normalizedSequence) {
    const family = normalizeFamilyToken(entry.family);
    const index = Math.round(Number(entry.index));
    if (!family || !Number.isFinite(index)) continue;
    if (!indexMap[family].includes(index)) {
      indexMap[family].push(index);
    }
  }
  const activeFamilies = PALETTE_FAMILY_ORDER.filter(family => indexMap[family].length > 0);
  const families = activeFamilies.length
    ? activeFamilies
    : normalizeFamilies(safeFallback.families, PALETTE_FAMILY_ORDER);
  const longest = families.reduce((maxCount, family) => Math.max(maxCount, indexMap[family].length), 0);
  const colorsPerFamily = normalizePaletteColorCount(longest || safeFallback.colorsPerFamily || 3, safeFallback.colorsPerFamily || 3);
  const counts = {};
  for (const family of PALETTE_FAMILY_ORDER) {
    if (indexMap[family].length) counts[family] = indexMap[family].length;
  }
  const familyColorCounts = normalizeFamilyColorCounts(
    counts,
    safeFallback.familyColorCounts || {},
    colorsPerFamily
  );
  const familyColorIndexes = normalizeFamilyColorIndexes(
    indexMap,
    safeFallback.familyColorIndexes || {},
    familyColorCounts,
    safeFallback.customFamilyColors || []
  );
  return {
    colorsPerFamily,
    families,
    familyColorCounts,
    familyColorIndexes
  };
}

function normalizeVividnessLevel(value, fallback = 2) {
  const rounded = Math.round(clampNumber(Number(value), 0, 4, fallback));
  if (VIVIDNESS_LEVEL_OPTIONS.includes(rounded)) return rounded;
  return VIVIDNESS_LEVEL_OPTIONS.includes(fallback) ? fallback : 2;
}

function rgbToHsv(color = {}) {
  const source = normalizeRgbColor(color, { r: 0, g: 0, b: 0 });
  const r = source.r / 255;
  const g = source.g / 255;
  const b = source.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === r) h = (((g - b) / delta) % 6) * 60;
    else if (max === g) h = (((b - r) / delta) + 2) * 60;
    else h = (((r - g) / delta) + 4) * 60;
  }
  if (!Number.isFinite(h)) h = 0;
  if (h < 0) h += 360;
  return { h, s: max <= 0 ? 0 : (delta / max), v: max };
}

function hsvToRgb(hRaw = 0, sRaw = 0, vRaw = 0) {
  const h = ((Number(hRaw) % 360) + 360) % 360;
  const s = clampNumber(Number(sRaw), 0, 1, 0);
  const v = clampNumber(Number(vRaw), 0, 1, 0);
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (h < 60) {
    rp = c;
    gp = x;
  } else if (h < 120) {
    rp = x;
    gp = c;
  } else if (h < 180) {
    gp = c;
    bp = x;
  } else if (h < 240) {
    gp = x;
    bp = c;
  } else if (h < 300) {
    rp = x;
    bp = c;
  } else {
    rp = c;
    bp = x;
  }
  return normalizeRgbColor({
    r: Math.round((rp + m) * 255),
    g: Math.round((gp + m) * 255),
    b: Math.round((bp + m) * 255)
  }, { r: 0, g: 0, b: 0 });
}

function resolveVividnessProfile(level = 2) {
  const vividness = normalizeVividnessLevel(level, 2);
  const satBoostScaleByLevel = [0.72, 0.9, 1, 1.16, 1.32];
  const satBoostAddByLevel = [0, 0.03, 0.08, 0.14, 0.2];
  const minSatDeltaByLevel = [-0.12, -0.06, 0, 0.05, 0.1];
  const minValueDeltaByLevel = [-0.04, -0.01, 0, 0.03, 0.06];
  return {
    satBoostScale: satBoostScaleByLevel[vividness],
    satBoostAdd: satBoostAddByLevel[vividness],
    minSatDelta: minSatDeltaByLevel[vividness],
    minValueDelta: minValueDeltaByLevel[vividness]
  };
}

function applyPaletteVividnessToColor(color = {}, level = 2) {
  const safe = normalizeRgbColor(color, { r: 0, g: 0, b: 0 });
  const hsv = rgbToHsv(safe);
  if (hsv.s < 0.06) return safe;
  const profile = resolveVividnessProfile(level);
  const satBoost = clampNumber((0.69 * profile.satBoostScale) + profile.satBoostAdd, 0, 1, 0.69);
  const minSat = clampNumber(0.84 + profile.minSatDelta, 0, 1, 0.84);
  const minValue = clampNumber(0.18 + profile.minValueDelta, 0, 1, 0.18);
  const tunedSat = clampNumber(hsv.s + ((1 - hsv.s) * satBoost), minSat, 1, minSat);
  const tunedValue = clampNumber(Math.max(hsv.v, minValue), minValue, 1, minValue);
  return hsvToRgb(hsv.h, tunedSat, tunedValue);
}

function normalizePaletteScopeConfig(config = {}, fallback = {}) {
  const source = config && typeof config === "object" && !Array.isArray(config) ? config : {};
  const base = fallback && typeof fallback === "object" && !Array.isArray(fallback) ? fallback : {};
  const customFamilyColors = normalizePaletteCustomFamilyColors(
    source.customFamilyColors !== undefined
      ? source.customFamilyColors
      : base.customFamilyColors
  );
  const colorsPerFamily = normalizePaletteColorCount(
    source.colorsPerFamily !== undefined ? source.colorsPerFamily : base.colorsPerFamily,
    base.colorsPerFamily || 3
  );
  const familyColorCounts = normalizeFamilyColorCounts(
    source.familyColorCounts,
    base.familyColorCounts || {},
    colorsPerFamily
  );
  const familyColorIndexes = normalizeFamilyColorIndexes(
    source.familyColorIndexes,
    base.familyColorIndexes || {},
    familyColorCounts,
    customFamilyColors
  );
  const families = normalizeFamilies(
    source.families,
    base.families || PALETTE_FAMILY_ORDER
  );
  const canonicalFallbackSequence = Array.isArray(base.colorSequence) && base.colorSequence.length
    ? base.colorSequence
    : buildSequenceFromLegacySelection({
      ...base,
      customFamilyColors,
      colorsPerFamily,
      familyColorCounts,
      familyColorIndexes,
      families
    });
  const colorSequence = normalizeColorSequence(
    source.colorSequence,
    canonicalFallbackSequence,
    {
      customFamilyColors
    }
  );
  const derivedLegacy = deriveLegacySelectionFromColorSequence(colorSequence, {
    colorsPerFamily,
    familyColorCounts,
    familyColorIndexes,
    customFamilyColors,
    families
  });
  return {
    ...source,
    colorsPerFamily: normalizePaletteColorCount(
      Math.max(colorsPerFamily, derivedLegacy.colorsPerFamily || 1),
      colorsPerFamily
    ),
    familyColorCounts: normalizeFamilyColorCounts(
      derivedLegacy.familyColorCounts,
      familyColorCounts,
      colorsPerFamily
    ),
    familyColorIndexes: normalizeFamilyColorIndexes(
      derivedLegacy.familyColorIndexes,
      familyColorIndexes,
      derivedLegacy.familyColorCounts,
      customFamilyColors
    ),
    colorSequence: colorSequence.map(entry => ({
      family: entry.family,
      index: entry.index
    })),
    customFamilyColors,
    families: derivedLegacy.families.slice()
  };
}

function resolveFamilyColorBank(config = {}, family = "red") {
  return family === "custom"
    ? normalizePaletteCustomFamilyColors(config.customFamilyColors)
    : (Array.isArray(PALETTE_FAMILY_BANK_DEFAULT[family]) ? PALETTE_FAMILY_BANK_DEFAULT[family] : PALETTE_FAMILY_BANK_DEFAULT.red);
}

function buildEnginePaletteSequenceFromConfig(config = {}) {
  const canonical = normalizePaletteScopeConfig(config, {});
  const vividness = normalizeVividnessLevel(canonical.vividness, 2);
  const out = [];
  for (const entry of canonical.colorSequence) {
    const family = entry.family;
    const bank = resolveFamilyColorBank(canonical, family);
    const maxIndex = Math.max(0, bank.length - 1);
    const safeIndex = clampNumber(entry.index, 0, maxIndex, 0);
    const baseRgb = normalizeRgbColor(bank[safeIndex] || bank[0] || { r: 255, g: 255, b: 255 });
    const rgb = applyPaletteVividnessToColor(baseRgb, vividness);
    out.push(rgbToHex(rgb));
    if (out.length >= 256) break;
  }
  return out.length ? out : ["#ffffff"];
}

function deriveEnginePaletteHoldTicksFromConfig(config = {}, options = {}) {
  const source = normalizePaletteScopeConfig(config, {});
  const cycleMode = String(source.cycleMode || "").trim().toLowerCase();
  if (cycleMode === "on_trigger" || cycleMode === "reactive" || cycleMode === "beat_lock") {
    return 1;
  }
  const tickHz = clampNumber(Number(options.tickHz), 1, 60, 10);
  const timedIntervalSec = clampNumber(Number(source.timedIntervalSec), 0.1, 60, 1.2);
  return clampNumber(Math.round(timedIntervalSec * tickHz), 1, 128, 12);
}

module.exports = {
  buildSequenceFromLegacySelection,
  normalizePaletteScopeConfig,
  buildEnginePaletteSequenceFromConfig,
  deriveEnginePaletteHoldTicksFromConfig
};
