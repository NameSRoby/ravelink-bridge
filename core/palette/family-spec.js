"use strict";

const PALETTE_COLOR_COUNT_OPTIONS = Object.freeze([1, 3, 5, 8, 12]);
const PALETTE_FAMILY_ORDER = Object.freeze(["red", "yellow", "green", "cyan", "blue"]);
const PALETTE_FAMILY_ALIASES = Object.freeze({
  magenta: "red",
  purple: "red",
  pink: "red",
  amber: "yellow",
  lime: "yellow",
  aqua: "cyan",
  teal: "cyan"
});

const PALETTE_FAMILY_DEFS = Object.freeze({
  red: Object.freeze({
    id: "red",
    label: "RED",
    description:
      "Red-centered spectrum: narrow true-red at 1/3, broader adjacent tones at 5/8, cross-spectrum edge at 12.",
    colors: Object.freeze([
      Object.freeze({ r: 255, g: 85, b: 0 }),
      Object.freeze({ r: 255, g: 64, b: 0 }),
      Object.freeze({ r: 255, g: 42, b: 0 }),
      Object.freeze({ r: 255, g: 21, b: 0 }),
      Object.freeze({ r: 255, g: 8, b: 0 }),
      Object.freeze({ r: 255, g: 0, b: 0 }),
      Object.freeze({ r: 255, g: 0, b: 21 }),
      Object.freeze({ r: 255, g: 0, b: 64 }),
      Object.freeze({ r: 255, g: 0, b: 106 }),
      Object.freeze({ r: 255, g: 0, b: 149 }),
      Object.freeze({ r: 255, g: 0, b: 191 }),
      Object.freeze({ r: 255, g: 0, b: 234 })
    ])
  }),
  yellow: Object.freeze({
    id: "yellow",
    label: "YELLOW",
    description:
      "Yellow bridge spectrum: sits between red and green with warm amber tones at low counts and lime edge tones at 12.",
    colors: Object.freeze([
      Object.freeze({ r: 255, g: 170, b: 0 }),
      Object.freeze({ r: 255, g: 196, b: 0 }),
      Object.freeze({ r: 255, g: 221, b: 0 }),
      Object.freeze({ r: 255, g: 247, b: 0 }),
      Object.freeze({ r: 238, g: 255, b: 0 }),
      Object.freeze({ r: 212, g: 255, b: 0 }),
      Object.freeze({ r: 187, g: 255, b: 0 }),
      Object.freeze({ r: 162, g: 255, b: 0 }),
      Object.freeze({ r: 136, g: 255, b: 0 }),
      Object.freeze({ r: 111, g: 255, b: 0 }),
      Object.freeze({ r: 85, g: 255, b: 0 }),
      Object.freeze({ r: 60, g: 255, b: 0 })
    ])
  }),
  green: Object.freeze({
    id: "green",
    label: "GREEN",
    description:
      "Green-centered spectrum: narrow true-green at 1/3, broader adjacent tones at 5/8, cyan-edge crossover at 12.",
    colors: Object.freeze([
      Object.freeze({ r: 128, g: 255, b: 0 }),
      Object.freeze({ r: 102, g: 255, b: 0 }),
      Object.freeze({ r: 77, g: 255, b: 0 }),
      Object.freeze({ r: 51, g: 255, b: 0 }),
      Object.freeze({ r: 26, g: 255, b: 0 }),
      Object.freeze({ r: 0, g: 255, b: 0 }),
      Object.freeze({ r: 0, g: 255, b: 26 }),
      Object.freeze({ r: 0, g: 255, b: 51 }),
      Object.freeze({ r: 0, g: 255, b: 76 }),
      Object.freeze({ r: 0, g: 255, b: 102 }),
      Object.freeze({ r: 0, g: 255, b: 128 }),
      Object.freeze({ r: 0, g: 255, b: 153 })
    ])
  }),
  cyan: Object.freeze({
    id: "cyan",
    label: "CYAN",
    description:
      "Cyan bridge spectrum: distinct teal-to-cyan bridge between green and blue; controlled edge merge appears mainly at 12.",
    colors: Object.freeze([
      Object.freeze({ r: 0, g: 255, b: 128 }),
      Object.freeze({ r: 0, g: 255, b: 153 }),
      Object.freeze({ r: 0, g: 255, b: 179 }),
      Object.freeze({ r: 0, g: 255, b: 204 }),
      Object.freeze({ r: 0, g: 255, b: 229 }),
      Object.freeze({ r: 0, g: 255, b: 255 }),
      Object.freeze({ r: 0, g: 229, b: 255 }),
      Object.freeze({ r: 0, g: 204, b: 255 }),
      Object.freeze({ r: 0, g: 179, b: 255 }),
      Object.freeze({ r: 0, g: 153, b: 255 }),
      Object.freeze({ r: 0, g: 128, b: 255 }),
      Object.freeze({ r: 0, g: 102, b: 255 })
    ])
  }),
  blue: Object.freeze({
    id: "blue",
    label: "BLUE",
    description:
      "Blue-centered spectrum: narrow true-blue at 1/3, broader adjacent tones at 5/8, violet-edge crossover at 12.",
    colors: Object.freeze([
      Object.freeze({ r: 0, g: 128, b: 255 }),
      Object.freeze({ r: 0, g: 94, b: 255 }),
      Object.freeze({ r: 0, g: 60, b: 255 }),
      Object.freeze({ r: 0, g: 26, b: 255 }),
      Object.freeze({ r: 8, g: 0, b: 255 }),
      Object.freeze({ r: 43, g: 0, b: 255 }),
      Object.freeze({ r: 76, g: 0, b: 255 }),
      Object.freeze({ r: 111, g: 0, b: 255 }),
      Object.freeze({ r: 144, g: 0, b: 255 }),
      Object.freeze({ r: 179, g: 0, b: 255 }),
      Object.freeze({ r: 212, g: 0, b: 255 }),
      Object.freeze({ r: 247, g: 0, b: 255 })
    ])
  })
});

const PALETTE_FAMILY_INDEX_SPAN_BY_COUNT = Object.freeze({
  1: Object.freeze({
    default: Object.freeze([5])
  }),
  3: Object.freeze({
    red: Object.freeze([0, 5, 10]),
    yellow: Object.freeze([0, 4, 8]),
    green: Object.freeze([3, 7, 11]),
    cyan: Object.freeze([5, 8, 11]),
    blue: Object.freeze([4, 7, 10]),
    default: Object.freeze([0, 5, 10])
  }),
  5: Object.freeze({
    red: Object.freeze([0, 2, 5, 8, 10]),
    yellow: Object.freeze([0, 2, 4, 6, 8]),
    green: Object.freeze([4, 5, 7, 9, 11]),
    cyan: Object.freeze([5, 6, 8, 10, 11]),
    blue: Object.freeze([4, 5, 7, 9, 11]),
    default: Object.freeze([0, 2, 5, 8, 10])
  }),
  8: Object.freeze({
    red: Object.freeze([0, 1, 2, 3, 4, 5, 7, 9]),
    yellow: Object.freeze([0, 1, 2, 3, 4, 5, 6, 7]),
    green: Object.freeze([2, 3, 4, 5, 6, 7, 8, 9]),
    cyan: Object.freeze([3, 4, 5, 6, 7, 8, 9, 10]),
    blue: Object.freeze([3, 4, 5, 6, 7, 8, 9, 10]),
    default: Object.freeze([1, 2, 3, 4, 5, 6, 7, 8])
  }),
  12: Object.freeze({
    default: Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })
});

const PALETTE_PRESETS = Object.freeze({
  all_1: Object.freeze({
    id: "all_1",
    label: "ALL COLORS x1",
    group: "uniform",
    families: Object.freeze(["red", "yellow", "green", "cyan", "blue"]),
    colorsPerFamily: 1
  }),
  all_3: Object.freeze({
    id: "all_3",
    label: "ALL COLORS x3",
    group: "uniform",
    families: Object.freeze(["red", "yellow", "green", "cyan", "blue"]),
    colorsPerFamily: 3
  }),
  duo_cool: Object.freeze({
    id: "duo_cool",
    label: "COOL BRIDGE",
    group: "bridge",
    families: Object.freeze(["green", "cyan", "blue"]),
    colorsPerFamily: null,
    familyColorCounts: Object.freeze({
      green: 12,
      cyan: 8,
      blue: 5
    })
  }),
  duo_warm: Object.freeze({
    id: "duo_warm",
    label: "WARM BRIDGE",
    group: "bridge",
    families: Object.freeze(["red", "yellow", "green"]),
    colorsPerFamily: null,
    familyColorCounts: Object.freeze({
      red: 5,
      yellow: 8,
      green: 12
    })
  })
});

function normalizePaletteFamilyId(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const mapped = PALETTE_FAMILY_ALIASES[raw] || raw;
  return PALETTE_FAMILY_ORDER.includes(mapped) ? mapped : "";
}

function normalizePaletteColorCountOption(value, fallback = 3) {
  const parsed = Number(value);
  if (PALETTE_COLOR_COUNT_OPTIONS.includes(parsed)) return parsed;
  const fallbackParsed = Number(fallback);
  if (PALETTE_COLOR_COUNT_OPTIONS.includes(fallbackParsed)) return fallbackParsed;
  return 3;
}

function resolvePaletteFamilyIndexSpan(familyId, colorCount) {
  const normalizedFamily = normalizePaletteFamilyId(familyId);
  const normalizedCount = normalizePaletteColorCountOption(colorCount, 3);
  const spanByFamily = PALETTE_FAMILY_INDEX_SPAN_BY_COUNT[normalizedCount]
    || PALETTE_FAMILY_INDEX_SPAN_BY_COUNT[3];
  const span = (normalizedFamily && spanByFamily?.[normalizedFamily])
    || spanByFamily?.default
    || PALETTE_FAMILY_INDEX_SPAN_BY_COUNT[3].default;
  return Array.isArray(span) ? span.slice() : [4, 5, 6];
}

module.exports = {
  PALETTE_COLOR_COUNT_OPTIONS,
  PALETTE_FAMILY_ORDER,
  PALETTE_FAMILY_ALIASES,
  PALETTE_FAMILY_DEFS,
  PALETTE_FAMILY_INDEX_SPAN_BY_COUNT,
  PALETTE_PRESETS,
  normalizePaletteFamilyId,
  normalizePaletteColorCountOption,
  resolvePaletteFamilyIndexSpan
};
