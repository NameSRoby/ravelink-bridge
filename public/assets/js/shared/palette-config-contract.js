"use strict";
// [TITLE] Module: public/assets/js/shared/palette-config-contract.js
// [TITLE] Purpose: shared normalization/math utility for palette config
// [TITLE] Functionality Index:
// [TITLE] - shared low-level utility reused across engine/server paths
// [TITLE] - normalization math with explicit fallback behavior
// [TITLE] - small pure functions to reduce duplicated logic in monolith flows

function createPaletteConfigSnapshotNormalizer(options = {}) {
  const defaultConfig = options.defaultConfig && typeof options.defaultConfig === "object"
    ? options.defaultConfig
    : {};
  const normalizeColorCount = typeof options.normalizeColorCount === "function"
    ? options.normalizeColorCount
    : ((value, fallback) => Number.isFinite(Number(value)) ? Number(value) : Number(fallback) || 0);
  const familyOrder = Array.isArray(options.familyOrder) ? options.familyOrder.slice() : [];
  const resolveFamilyIndexSpan = typeof options.resolveFamilyIndexSpan === "function"
    ? options.resolveFamilyIndexSpan
    : (() => []);
  const normalizeDisorderAggression = typeof options.normalizeDisorderAggression === "function"
    ? options.normalizeDisorderAggression
    : ((value, fallback) => Number.isFinite(Number(value)) ? Number(value) : Number(fallback) || 0);
  const normalizeCycleMode = typeof options.normalizeCycleMode === "function"
    ? options.normalizeCycleMode
    : ((value, fallback) => String(value || fallback || ""));
  const normalizeTimedIntervalSec = typeof options.normalizeTimedIntervalSec === "function"
    ? options.normalizeTimedIntervalSec
    : ((value, fallback) => Number.isFinite(Number(value)) ? Number(value) : Number(fallback) || 0);
  const normalizeBeatLockGraceSec = typeof options.normalizeBeatLockGraceSec === "function"
    ? options.normalizeBeatLockGraceSec
    : ((value, fallback) => Number.isFinite(Number(value)) ? Number(value) : Number(fallback) || 0);
  const normalizeReactiveMargin = typeof options.normalizeReactiveMargin === "function"
    ? options.normalizeReactiveMargin
    : ((value, fallback) => Number.isFinite(Number(value)) ? Number(value) : Number(fallback) || 0);
  const normalizeBrightnessFollowAmount = typeof options.normalizeBrightnessFollowAmount === "function"
    ? options.normalizeBrightnessFollowAmount
    : ((value, fallback) => Number.isFinite(Number(value)) ? Number(value) : Number(fallback) || 0);
  const normalizeBrightnessScene = typeof options.normalizeBrightnessScene === "function"
    ? options.normalizeBrightnessScene
    : ((value, fallback) => String(value || fallback || ""));
  const normalizeBrightnessSceneHoldPulses = typeof options.normalizeBrightnessSceneHoldPulses === "function"
    ? options.normalizeBrightnessSceneHoldPulses
    : ((value, fallback) => Number.isFinite(Number(value)) ? Number(value) : Number(fallback) || 0);
  const normalizeVividness = typeof options.normalizeVividness === "function"
    ? options.normalizeVividness
    : ((value, fallback) => Number.isFinite(Number(value)) ? Number(value) : Number(fallback) || 0);
  const normalizeSpectrumMapMode = typeof options.normalizeSpectrumMapMode === "function"
    ? options.normalizeSpectrumMapMode
    : ((value, fallback) => String(value || fallback || ""));
  const normalizeSpectrumFeatureMap = typeof options.normalizeSpectrumFeatureMap === "function"
    ? options.normalizeSpectrumFeatureMap
    : (value => (Array.isArray(value) ? value.slice() : []));
  const parseDisorderValue = typeof options.parseDisorderValue === "function"
    ? options.parseDisorderValue
    : ((value, fallback) => (value === undefined ? Boolean(fallback) : Boolean(value)));
  const parseBeatLockValue = typeof options.parseBeatLockValue === "function"
    ? options.parseBeatLockValue
    : ((value, fallback) => (value === undefined ? Boolean(fallback) : Boolean(value)));
  const familyAliases = options.familyAliases && typeof options.familyAliases === "object"
    ? options.familyAliases
    : {};
  const familyDefs = options.familyDefs && typeof options.familyDefs === "object"
    ? options.familyDefs
    : {};

  function normalizeFamilies(value, fallback = defaultConfig.families) {
    const list = Array.isArray(value)
      ? value
      : String(value || "")
        .split(",")
        .map(item => item.trim())
        .filter(Boolean);
    const out = [];
    for (const raw of list) {
      const key = String(raw || "").trim().toLowerCase();
      const mapped = familyAliases[key] || key;
      if (!familyOrder.includes(mapped)) continue;
      if (out.includes(mapped)) continue;
      out.push(mapped);
    }
    if (out.length) return out;
    const fallbackList = Array.isArray(fallback) && fallback.length
      ? fallback
      : defaultConfig.families;
    return Array.isArray(fallbackList) && fallbackList.length
      ? normalizeFamilies(fallbackList, familyOrder)
      : familyOrder.slice(0, 1);
  }

  function normalizeFamilyColorCounts(
    value,
    fallback = defaultConfig.familyColorCounts,
    fallbackColorCount = defaultConfig.colorsPerFamily
  ) {
    const fallbackCount = normalizeColorCount(
      fallbackColorCount,
      defaultConfig.colorsPerFamily
    );
    const source = value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
    const fallbackMap = fallback && typeof fallback === "object" && !Array.isArray(fallback)
      ? fallback
      : {};
    const out = {};
    for (const familyId of familyOrder) {
      const raw = Object.prototype.hasOwnProperty.call(source, familyId)
        ? source[familyId]
        : Object.prototype.hasOwnProperty.call(fallbackMap, familyId)
          ? fallbackMap[familyId]
          : fallbackCount;
      out[familyId] = normalizeColorCount(raw, fallbackCount);
    }
    return out;
  }

  function normalizeFamilyColorIndexes(
    value,
    fallback = defaultConfig.familyColorIndexes,
    familyColorCounts = defaultConfig.familyColorCounts
  ) {
    const source = value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
    const fallbackMap = fallback && typeof fallback === "object" && !Array.isArray(fallback)
      ? fallback
      : {};
    const countMap = familyColorCounts && typeof familyColorCounts === "object"
      ? familyColorCounts
      : defaultConfig.familyColorCounts;
    const out = {};
    for (const familyId of familyOrder) {
      const familyDef = familyDefs[familyId];
      const maxIndex = Math.max(0, (Array.isArray(familyDef?.colors) ? familyDef.colors.length : 0) - 1);
      const desiredCount = normalizeColorCount(countMap[familyId], defaultConfig.colorsPerFamily);
      const rawList = Object.prototype.hasOwnProperty.call(source, familyId)
        ? source[familyId]
        : Object.prototype.hasOwnProperty.call(fallbackMap, familyId)
          ? fallbackMap[familyId]
          : resolveFamilyIndexSpan(familyId, desiredCount);
      const parsedList = Array.isArray(rawList)
        ? rawList
        : String(rawList || "")
          .split(",")
          .map(part => part.trim())
          .filter(Boolean);
      const deduped = [];
      for (const token of parsedList) {
        const idx = Math.round(Number(token));
        if (!Number.isFinite(idx)) continue;
        if (idx < 0 || idx > maxIndex) continue;
        if (deduped.includes(idx)) continue;
        deduped.push(idx);
      }
      out[familyId] = deduped.length
        ? deduped
        : resolveFamilyIndexSpan(familyId, desiredCount).filter(idx => idx >= 0 && idx <= maxIndex);
    }
    return out;
  }

  function normalizeConfigSnapshot(source = {}, fallback = defaultConfig) {
    const raw = source && typeof source === "object" ? source : {};
    const safeFallback = fallback && typeof fallback === "object"
      ? fallback
      : defaultConfig;
    const fallbackColorsPerFamily = normalizeColorCount(
      safeFallback.colorsPerFamily,
      defaultConfig.colorsPerFamily
    );
    const colorsPerFamily = normalizeColorCount(
      raw.colorsPerFamily,
      fallbackColorsPerFamily
    );
    const familyColorCountsFallback = normalizeFamilyColorCounts(
      safeFallback.familyColorCounts,
      defaultConfig.familyColorCounts,
      fallbackColorsPerFamily
    );
    const familyColorCounts = normalizeFamilyColorCounts(
      raw.familyColorCounts,
      familyColorCountsFallback,
      colorsPerFamily
    );

    return {
      colorsPerFamily,
      familyColorCounts,
      familyColorIndexes: normalizeFamilyColorIndexes(
        raw.familyColorIndexes,
        normalizeFamilyColorIndexes(
          safeFallback.familyColorIndexes,
          defaultConfig.familyColorIndexes,
          familyColorCountsFallback
        ),
        familyColorCounts
      ),
      families: normalizeFamilies(
        raw.families,
        normalizeFamilies(safeFallback.families, defaultConfig.families)
      ),
      disorder: Object.prototype.hasOwnProperty.call(raw, "disorder")
        ? parseDisorderValue(raw.disorder, Boolean(safeFallback.disorder))
        : Boolean(safeFallback.disorder),
      disorderAggression: normalizeDisorderAggression(
        raw.disorderAggression,
        normalizeDisorderAggression(safeFallback.disorderAggression, defaultConfig.disorderAggression)
      ),
      cycleMode: normalizeCycleMode(raw.cycleMode, safeFallback.cycleMode),
      timedIntervalSec: normalizeTimedIntervalSec(
        raw.timedIntervalSec,
        normalizeTimedIntervalSec(safeFallback.timedIntervalSec, defaultConfig.timedIntervalSec)
      ),
      beatLock: Object.prototype.hasOwnProperty.call(raw, "beatLock")
        ? parseBeatLockValue(raw.beatLock, Boolean(safeFallback.beatLock))
        : Boolean(safeFallback.beatLock),
      beatLockGraceSec: normalizeBeatLockGraceSec(
        raw.beatLockGraceSec,
        normalizeBeatLockGraceSec(safeFallback.beatLockGraceSec, defaultConfig.beatLockGraceSec)
      ),
      reactiveMargin: normalizeReactiveMargin(
        raw.reactiveMargin,
        normalizeReactiveMargin(safeFallback.reactiveMargin, defaultConfig.reactiveMargin)
      ),
      brightnessFollowAmount: normalizeBrightnessFollowAmount(
        raw.brightnessFollowAmount,
        normalizeBrightnessFollowAmount(
          safeFallback.brightnessFollowAmount,
          defaultConfig.brightnessFollowAmount
        )
      ),
      brightnessScene: normalizeBrightnessScene(
        raw.brightnessScene,
        normalizeBrightnessScene(
          safeFallback.brightnessScene,
          defaultConfig.brightnessScene
        )
      ),
      brightnessSceneHoldPulses: normalizeBrightnessSceneHoldPulses(
        raw.brightnessSceneHoldPulses,
        normalizeBrightnessSceneHoldPulses(
          safeFallback.brightnessSceneHoldPulses,
          defaultConfig.brightnessSceneHoldPulses
        )
      ),
      vividness: normalizeVividness(
        raw.vividness,
        normalizeVividness(safeFallback.vividness, defaultConfig.vividness)
      ),
      spectrumMapMode: normalizeSpectrumMapMode(raw.spectrumMapMode, safeFallback.spectrumMapMode),
      spectrumFeatureMap: normalizeSpectrumFeatureMap(
        raw.spectrumFeatureMap,
        normalizeSpectrumFeatureMap(
          safeFallback.spectrumFeatureMap,
          defaultConfig.spectrumFeatureMap
        )
      )
    };
  }

  return {
    buildUniformColorCounts(colorCount) {
      const count = normalizeColorCount(colorCount, defaultConfig.colorsPerFamily);
      const out = {};
      for (const familyId of familyOrder) {
        out[familyId] = count;
      }
      return out;
    },
    buildUniformColorIndexes(colorCount) {
      const count = normalizeColorCount(colorCount, defaultConfig.colorsPerFamily);
      const out = {};
      for (const familyId of familyOrder) {
        out[familyId] = resolveFamilyIndexSpan(familyId, count);
      }
      return out;
    },
    normalizeFamilies,
    normalizeFamilyColorCounts,
    normalizeFamilyColorIndexes,
    normalizeConfigSnapshot
  };
}
const contract = Object.freeze({
  createPaletteConfigSnapshotNormalizer
});

if (typeof module === "object" && module && module.exports) {
  module.exports = contract;
}
if (typeof globalThis === "object" && globalThis) {
  globalThis.RAVELINK_PALETTE_CONFIG_CONTRACT = contract;
}
