// [TITLE] Module: domains/live/live-sync-groups.normalization.js
// [TITLE] Purpose: shared backend normalization helpers for LIVE sync-group contracts
// [TITLE] Functionality Index:
// [TITLE] - normalize sequence-mode/remove-behavior/custom-fallback tokens consistently
// [TITLE] - share fixture-id dedupe rules between compat persistence and engine runtime
// [TITLE] - keep sync-group contract semantics defined in one backend helper

const SYNC_GROUP_SEQUENCE_MODES = new Set(["sync", "reverse", "offset"]);
const SYNC_GROUP_REMOVE_BEHAVIORS = new Set(["custom_state", "keep_current", "blackout"]);
const SYNC_GROUP_DEFAULT_REMOVE_BEHAVIOR = "keep_current";
const SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT = Object.freeze({
  mode: "hex",
  hex: "#ffffff",
  cct: 4000,
  brightness: 100
});

module.exports = function createLiveSyncGroupNormalization(options = {}) {
  const clampNumber = typeof options.clampNumber === "function"
    ? options.clampNumber
    : ((value, min, max, fallback) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return Number(fallback);
      return Math.min(Number(max), Math.max(Number(min), parsed));
    });

  function normalizeSyncGroupSequenceMode(value, fallback = "sync") {
    const token = String(value || "").trim().toLowerCase();
    if (token === "mirror") return "reverse";
    if (SYNC_GROUP_SEQUENCE_MODES.has(token)) return token;
    const fallbackToken = String(fallback || "").trim().toLowerCase();
    if (fallbackToken === "mirror") return "reverse";
    return SYNC_GROUP_SEQUENCE_MODES.has(fallbackToken) ? fallbackToken : "sync";
  }

  function normalizeSyncGroupFixtureIds(value = [], options = {}) {
    const source = Array.isArray(value) ? value : [];
    const out = [];
    const seen = new Set();
    const limit = Math.max(1, Math.round(Number(options.limit || 4096)));
    for (const row of source) {
      const fixtureId = String(row || "").trim();
      if (!fixtureId || seen.has(fixtureId)) continue;
      seen.add(fixtureId);
      out.push(fixtureId);
      if (out.length >= limit) break;
    }
    return out;
  }

  function normalizeSyncGroupRemoveBehavior(value, fallback = SYNC_GROUP_DEFAULT_REMOVE_BEHAVIOR) {
    const token = String(value || "").trim().toLowerCase();
    if (token === "restore" || token === "pre_engine" || token === "pre-engine" || token === "preengine" || token === "previous") {
      return "keep_current";
    }
    if (token === "keep" || token === "current" || token === "hold" || token === "hold_last" || token === "hold-last") {
      return "keep_current";
    }
    if (token === "custom" || token === "custom_state" || token === "custom-state" || token === "custom_fallback" || token === "custom-fallback") {
      return "custom_state";
    }
    if (token === "off" || token === "black" || token === "blackout") {
      return "blackout";
    }
    if (SYNC_GROUP_REMOVE_BEHAVIORS.has(token)) return token;
    const fallbackToken = String(fallback || "").trim().toLowerCase();
    if (SYNC_GROUP_REMOVE_BEHAVIORS.has(fallbackToken)) return fallbackToken;
    return SYNC_GROUP_DEFAULT_REMOVE_BEHAVIOR;
  }

  function normalizeSyncGroupHexColor(value, fallback = "#ffffff") {
    const token = String(value || "").trim().toLowerCase();
    if (/^#?[0-9a-f]{6}$/i.test(token)) {
      return token.startsWith("#") ? token : `#${token}`;
    }
    const fb = String(fallback || "").trim().toLowerCase();
    if (/^#?[0-9a-f]{6}$/i.test(fb)) {
      return fb.startsWith("#") ? fb : `#${fb}`;
    }
    return "#ffffff";
  }

  function normalizeSyncGroupCustomFallbackMode(value, fallback = "hex") {
    const token = String(value || "").trim().toLowerCase();
    if (token === "cct" || token === "white" || token === "kelvin" || token === "temp" || token === "temperature") {
      return "cct";
    }
    if (token === "hex" || token === "rgb" || token === "color") {
      return "hex";
    }
    const fallbackToken = String(fallback || "").trim().toLowerCase();
    if (fallbackToken === "cct" || fallbackToken === "white" || fallbackToken === "kelvin" || fallbackToken === "temp") {
      return "cct";
    }
    return "hex";
  }

  function normalizeSyncGroupCustomFallback(value = {}, fallback = SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const fb = fallback && typeof fallback === "object" && !Array.isArray(fallback)
      ? fallback
      : SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT;
    const mode = normalizeSyncGroupCustomFallbackMode(
      source.mode ?? source.type,
      normalizeSyncGroupCustomFallbackMode(fb.mode, SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT.mode)
    );
    return {
      mode,
      hex: normalizeSyncGroupHexColor(
        source.hex ?? source.color ?? source.colorHex ?? source.value,
        normalizeSyncGroupHexColor(fb.hex, SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT.hex)
      ),
      cct: clampNumber(
        Math.round(Number(source.cct ?? source.kelvin ?? source.temp)),
        2000,
        6500,
        clampNumber(Math.round(Number(fb.cct)), 2000, 6500, SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT.cct)
      ),
      brightness: clampNumber(
        Math.round(Number(source.brightness ?? source.level ?? source.dimming)),
        1,
        100,
        clampNumber(Math.round(Number(fb.brightness)), 1, 100, SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT.brightness)
      )
    };
  }

  return {
    SYNC_GROUP_DEFAULT_REMOVE_BEHAVIOR,
    SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT,
    normalizeSyncGroupSequenceMode,
    normalizeSyncGroupFixtureIds,
    normalizeSyncGroupRemoveBehavior,
    normalizeSyncGroupHexColor,
    normalizeSyncGroupCustomFallbackMode,
    normalizeSyncGroupCustomFallback
  };
};
