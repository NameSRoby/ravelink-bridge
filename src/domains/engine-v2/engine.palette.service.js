// [TITLE] Module: domains/engine-v2/engine.palette.service.js
// [TITLE] Purpose: persistent palette sequencing + custom color teaching for Engine v2
// [TITLE] Functionality Index:
// [TITLE] - store custom palette colors and ordered sequence definitions
// [TITLE] - resolve sequence entries with typo-tolerant color token matching
// [TITLE] - provide tick-driven palette frame consumption for engine scheduler input
// [DEV] Complex Flow:
// [DEV] Sequence resolution accepts names, hex tokens, and fuzzy matches. Persisted
// [DEV] sequence entries are canonicalized to avoid drift across runtime restarts.

const fs = require("fs");
const {
  readJsonFile,
  writeJsonFile,
  cloneJsonSafe
} = require("../../shared/fs/json-file-store");
const { normalizeHex, hexToRgb } = require("../colors/color-space");
const {
  normalizeLookupToken,
  findBestFuzzyMatch
} = require("../../shared/fuzzy/fuzzy-text");

const TEACH_PATTERN_NAME_HEX = /^(.+?)(?:\s+|[:=,]\s*)(#[0-9a-f]{6})$/i;
const TEACH_PATTERN_HEX_NAME = /^(#[0-9a-f]{6})(?:\s+|[:=,]\s*)(.+)$/i;
const DEFAULT_BASE_COLORS = Object.freeze({
  red: "#ff0000",
  yellow: "#ffff00",
  green: "#00ff00",
  cyan: "#00ffff",
  blue: "#0000ff",
  violet: "#8000ff",
  pink: "#ff0080",
  white: "#ffffff"
});
const DEFAULT_SEQUENCE = Object.freeze(["red", "blue", "violet", "cyan"]);

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number(fallback);
  return Math.min(Number(max), Math.max(Number(min), parsed));
}

function normalizeColorName(value) {
  return normalizeLookupToken(value);
}

function sanitizeCustomColorMap(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const out = {};
  for (const [rawName, rawHex] of Object.entries(source)) {
    const name = normalizeColorName(rawName);
    const hex = normalizeHex(rawHex);
    if (!name || !hex) continue;
    out[name] = hex;
  }
  return out;
}

module.exports = function createEnginePaletteService(options = {}) {
  const storePath = String(options.storePath || "").trim();
  if (!storePath) {
    throw new Error("createEnginePaletteService requires storePath");
  }

  const baseColors = sanitizeCustomColorMap(options.baseColors || DEFAULT_BASE_COLORS);
  let version = 1;
  let customColors = {};
  let sequence = [...DEFAULT_SEQUENCE];
  let activeIndex = 0;
  let holdTicks = 1;
  let holdCounter = 0;

  function getColorMap() {
    return {
      ...baseColors,
      ...customColors
    };
  }

  function findColorByHex(hex) {
    const safe = normalizeHex(hex);
    if (!safe) return null;
    const map = getColorMap();
    for (const [name, value] of Object.entries(map)) {
      if (String(value || "").toLowerCase() === safe) {
        return { name, hex: safe };
      }
    }
    return null;
  }

  function resolveColorToken(rawToken, optionsOverride = {}) {
    const optionsSafe = optionsOverride && typeof optionsOverride === "object" ? optionsOverride : {};
    const allowFuzzy = optionsSafe.allowFuzzy !== false;
    const text = String(rawToken || "").trim();
    if (!text) return null;

    const hex = normalizeHex(text);
    if (hex) {
      return {
        token: hex,
        canonicalToken: hex,
        name: "",
        hex,
        rgb: hexToRgb(hex),
        source: "hex",
        fuzzy: null
      };
    }

    const name = normalizeColorName(text);
    if (!name) return null;
    const colorMap = getColorMap();
    if (colorMap[name]) {
      const matchHex = colorMap[name];
      return {
        token: text,
        canonicalToken: name,
        name,
        hex: matchHex,
        rgb: hexToRgb(matchHex),
        source: Object.prototype.hasOwnProperty.call(customColors, name) ? "custom" : "base",
        fuzzy: null
      };
    }

    if (!allowFuzzy) return null;
    const fuzzy = findBestFuzzyMatch(name, Object.keys(colorMap), {
      minScore: 170,
      maxDistanceRatio: 0.34
    });
    if (!fuzzy || !colorMap[fuzzy.value]) return null;
    const matchName = String(fuzzy.value || "");
    const matchHex = colorMap[matchName];
    return {
      token: text,
      canonicalToken: matchName,
      name: matchName,
      hex: matchHex,
      rgb: hexToRgb(matchHex),
      source: Object.prototype.hasOwnProperty.call(customColors, matchName) ? "custom_fuzzy" : "base_fuzzy",
      fuzzy
    };
  }

  function normalizeSequenceEntries(rawEntries = [], optionsOverride = {}) {
    const entries = Array.isArray(rawEntries) ? rawEntries : [];
    const out = [];
    for (const raw of entries) {
      const token = (raw && typeof raw === "object" && !Array.isArray(raw))
        ? String(raw.token ?? raw.name ?? raw.hex ?? "").trim()
        : String(raw || "").trim();
      if (!token) continue;
      const resolved = resolveColorToken(token, optionsOverride);
      if (!resolved) continue;
      out.push(resolved.canonicalToken);
      if (out.length >= 256) break;
    }
    return out;
  }

  function persist(reason = "update") {
    version += 1;
    writeJsonFile(storePath, {
      version,
      customColors,
      sequence,
      activeIndex,
      holdTicks,
      updatedAt: Date.now(),
      reason
    });
  }

  function load() {
    const hasFile = fs.existsSync(storePath);
    const raw = hasFile ? readJsonFile(storePath, {}) : {};
    customColors = sanitizeCustomColorMap(raw.customColors || {});
    const loadedSequence = normalizeSequenceEntries(raw.sequence || DEFAULT_SEQUENCE, { allowFuzzy: false });
    sequence = loadedSequence.length ? loadedSequence : [...DEFAULT_SEQUENCE];
    activeIndex = clampNumber(Math.round(Number(raw.activeIndex || 0)), 0, Math.max(0, sequence.length - 1), 0);
    holdTicks = clampNumber(Math.round(Number(raw.holdTicks || 1)), 1, 128, 1);
    holdCounter = 0;
    persist("load");
  }

  function getResolvedSequence() {
    return sequence.map((token, index) => {
      const resolved = resolveColorToken(token, { allowFuzzy: false });
      const fallbackHex = "#ffffff";
      return {
        index,
        token,
        name: resolved?.name || "",
        hex: resolved?.hex || fallbackHex,
        rgb: resolved?.rgb || { r: 255, g: 255, b: 255 },
        source: resolved?.source || "fallback"
      };
    });
  }

  function getCurrentResolvedEntry() {
    const safeIndex = clampNumber(activeIndex, 0, Math.max(0, sequence.length - 1), 0);
    const token = sequence[safeIndex] || DEFAULT_SEQUENCE[0];
    const resolved = resolveColorToken(token, { allowFuzzy: false }) || {
      token: "#ffffff",
      canonicalToken: "#ffffff",
      name: "",
      hex: "#ffffff",
      rgb: { r: 255, g: 255, b: 255 },
      source: "fallback",
      fuzzy: null
    };
    return {
      index: safeIndex,
      token: resolved.canonicalToken,
      name: resolved.name,
      hex: resolved.hex,
      rgb: resolved.rgb,
      source: resolved.source
    };
  }

  function consumeTickFrame(optionsOverride = {}) {
    const optionsSafe = optionsOverride && typeof optionsOverride === "object" ? optionsOverride : {};
    const shouldAdvance = optionsSafe.advance !== false;
    const advanceWeight = clampNumber(
      Math.round(Number(optionsSafe.advanceWeight || 1)),
      1,
      8,
      1
    );
    const current = getCurrentResolvedEntry();
    if (shouldAdvance && sequence.length > 1) {
      holdCounter += advanceWeight;
      if (holdCounter >= holdTicks) {
        holdCounter = 0;
        activeIndex = (activeIndex + 1) % sequence.length;
      }
    }
    return {
      ...current,
      count: sequence.length,
      holdTicks
    };
  }

  function setSequence(rawEntries = []) {
    const next = normalizeSequenceEntries(rawEntries);
    if (!next.length) {
      return {
        ok: false,
        error: "invalid_sequence",
        detail: "Sequence must include at least one valid color token (name or #RRGGBB)."
      };
    }
    sequence = next;
    activeIndex = clampNumber(activeIndex, 0, Math.max(0, sequence.length - 1), 0);
    holdCounter = 0;
    persist("set_sequence");
    return {
      ok: true,
      changed: true,
      snapshot: getSnapshot()
    };
  }

  function advance(stepRaw = 1) {
    const step = clampNumber(Math.round(Number(stepRaw || 1)), 1, 1024, 1);
    if (sequence.length > 0) {
      activeIndex = (activeIndex + step) % sequence.length;
      holdCounter = 0;
      persist("advance");
    }
    return {
      ok: true,
      step,
      current: getCurrentResolvedEntry(),
      snapshot: getSnapshot()
    };
  }

  function setCycleConfig(input = {}) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    holdTicks = clampNumber(Math.round(Number(source.holdTicks || holdTicks)), 1, 128, holdTicks);
    holdCounter = 0;
    persist("set_cycle_config");
    return {
      ok: true,
      holdTicks,
      snapshot: getSnapshot()
    };
  }

  function teachCustomColor(input = {}) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const inlineText = String(source.text || "").trim();
    let nameToken = "";
    let hexToken = "";
    if (inlineText) {
      const nameHexMatch = inlineText.match(TEACH_PATTERN_NAME_HEX);
      const hexNameMatch = nameHexMatch ? null : inlineText.match(TEACH_PATTERN_HEX_NAME);
      if (nameHexMatch || hexNameMatch) {
        nameToken = nameHexMatch ? nameHexMatch[1] : hexNameMatch[2];
        hexToken = nameHexMatch ? nameHexMatch[2] : hexNameMatch[1];
      }
    } else {
      nameToken = String(source.name || "").trim();
      hexToken = String(source.hex || "").trim();
    }

    const name = normalizeColorName(nameToken);
    const hex = normalizeHex(hexToken);
    if (!name || !hex) {
      return {
        ok: false,
        changed: false,
        reason: "invalid_teach_payload",
        refundRecommended: false
      };
    }
    if (baseColors[name]) {
      return {
        ok: true,
        changed: false,
        reason: "name_exists_base",
        refundRecommended: true,
        name,
        hex: baseColors[name]
      };
    }
    if (customColors[name]) {
      return {
        ok: true,
        changed: false,
        reason: "name_exists_custom",
        refundRecommended: true,
        name,
        hex: customColors[name]
      };
    }
    const existingHex = findColorByHex(hex);
    if (existingHex) {
      return {
        ok: true,
        changed: false,
        reason: "hex_exists",
        refundRecommended: true,
        name: existingHex.name,
        hex: existingHex.hex
      };
    }

    customColors[name] = hex;
    persist("teach_custom_color");
    return {
      ok: true,
      changed: true,
      reason: "taught",
      refundRecommended: false,
      name,
      hex,
      snapshot: getSnapshot()
    };
  }

  function getSnapshot() {
    return {
      version,
      customColors: cloneJsonSafe(customColors, {}),
      sequence: sequence.slice(),
      resolvedSequence: getResolvedSequence(),
      activeIndex,
      holdTicks,
      current: getCurrentResolvedEntry(),
      colorCount: Object.keys(getColorMap()).length
    };
  }

  load();

  return {
    normalizeColorName,
    resolveColorToken,
    getSnapshot,
    teachCustomColor,
    setSequence,
    setCycleConfig,
    advance,
    consumeTickFrame,
    getCurrentResolvedEntry
  };
};
