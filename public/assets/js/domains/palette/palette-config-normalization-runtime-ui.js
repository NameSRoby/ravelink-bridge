// [TITLE] Module: public/assets/js/domains/palette/palette-config-normalization-runtime-ui.js
// [TITLE] Purpose: palette persisted snapshot normalization + scoped override shaping runtime
// [TITLE] Functionality Index:
// [TITLE] - palette config contract normalizer bootstrap
// [TITLE] - global palette config normalization with canonical colorSequence repair
// [TITLE] - brand + fixture override normalization on top of global config
// [DEV] Complex Flow:
// [DEV] Palette config normalization must keep canonical colorSequence stable so
// [DEV] scoped overrides and saved presets do not drift between loads.
function createPaletteConfigNormalizationRuntimeUi(deps = {}) {
  const ui = deps.ui || {};
  const contract = deps.contract && typeof deps.contract === "object" ? deps.contract : {};
  const configDefault = deps.configDefault && typeof deps.configDefault === "object"
    ? deps.configDefault
    : Object.freeze({});
  const PALETTE_FAMILY_ORDER = Array.isArray(deps.PALETTE_FAMILY_ORDER)
    ? deps.PALETTE_FAMILY_ORDER
    : Object.freeze(["red", "yellow", "green", "violet", "blue", "custom"]);
  const PALETTE_FAMILY_ALIASES = deps.PALETTE_FAMILY_ALIASES && typeof deps.PALETTE_FAMILY_ALIASES === "object"
    ? deps.PALETTE_FAMILY_ALIASES
    : Object.freeze({});
  const PALETTE_FAMILY_DEFS = deps.PALETTE_FAMILY_DEFS && typeof deps.PALETTE_FAMILY_DEFS === "object"
    ? deps.PALETTE_FAMILY_DEFS
    : Object.freeze({});
  const PALETTE_FAMILY_DEFS_DEFAULT = deps.PALETTE_FAMILY_DEFS_DEFAULT && typeof deps.PALETTE_FAMILY_DEFS_DEFAULT === "object"
    ? deps.PALETTE_FAMILY_DEFS_DEFAULT
    : Object.freeze({});
  const PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP = deps.PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP && typeof deps.PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP === "object"
    ? deps.PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP
    : Object.freeze([]);
  const PALETTE_SUPPORTED_BRANDS = Array.isArray(deps.PALETTE_SUPPORTED_BRANDS)
    ? deps.PALETTE_SUPPORTED_BRANDS
    : ["hue", "wiz"];
  const buildPaletteUniformColorCountsUi = typeof deps.buildPaletteUniformColorCountsUi === "function"
    ? deps.buildPaletteUniformColorCountsUi
    : (() => ({}));
  const buildPaletteUniformColorIndexesUi = typeof deps.buildPaletteUniformColorIndexesUi === "function"
    ? deps.buildPaletteUniformColorIndexesUi
    : (() => ({}));
  const resolvePaletteDefaultIndexSpanUi = typeof deps.resolvePaletteDefaultIndexSpanUi === "function"
    ? deps.resolvePaletteDefaultIndexSpanUi
    : (() => []);
  const normalizePaletteColorCountUi = typeof deps.normalizePaletteColorCountUi === "function"
    ? deps.normalizePaletteColorCountUi
    : (value => Math.max(1, Math.round(Number(value) || 1)));
  const normalizePaletteDisorderAggressionUi = typeof deps.normalizePaletteDisorderAggressionUi === "function"
    ? deps.normalizePaletteDisorderAggressionUi
    : (value, fallback = 0.35) => Number.isFinite(Number(value)) ? Number(value) : Number(fallback);
  const normalizePaletteCycleModeUi = typeof deps.normalizePaletteCycleModeUi === "function"
    ? deps.normalizePaletteCycleModeUi
    : (value, fallback = "on_trigger") => String(value || fallback || "on_trigger").trim().toLowerCase();
  const normalizePaletteTimedIntervalSecUi = typeof deps.normalizePaletteTimedIntervalSecUi === "function"
    ? deps.normalizePaletteTimedIntervalSecUi
    : (value, fallback = 5) => Number.isFinite(Number(value)) ? Number(value) : Number(fallback);
  const normalizePaletteBeatLockGraceSecUi = typeof deps.normalizePaletteBeatLockGraceSecUi === "function"
    ? deps.normalizePaletteBeatLockGraceSecUi
    : (value, fallback = 2) => Number.isFinite(Number(value)) ? Number(value) : Number(fallback);
  const normalizePaletteReactiveMarginUi = typeof deps.normalizePaletteReactiveMarginUi === "function"
    ? deps.normalizePaletteReactiveMarginUi
    : (value, fallback = 28) => Number.isFinite(Number(value)) ? Number(value) : Number(fallback);
  const normalizePaletteBrightnessFollowAmountUi = typeof deps.normalizePaletteBrightnessFollowAmountUi === "function"
    ? deps.normalizePaletteBrightnessFollowAmountUi
    : (value, fallback = 1) => Number.isFinite(Number(value)) ? Number(value) : Number(fallback);
  const normalizePaletteVividnessUi = typeof deps.normalizePaletteVividnessUi === "function"
    ? deps.normalizePaletteVividnessUi
    : (value, fallback = 2) => Number.isFinite(Number(value)) ? Number(value) : Number(fallback);
  const normalizePaletteSpectrumMapModeUi = typeof deps.normalizePaletteSpectrumMapModeUi === "function"
    ? deps.normalizePaletteSpectrumMapModeUi
    : (value, fallback = "auto") => String(value || fallback || "auto").trim().toLowerCase();
  const normalizePaletteSpectrumFeatureMapUi = typeof deps.normalizePaletteSpectrumFeatureMapUi === "function"
    ? deps.normalizePaletteSpectrumFeatureMapUi
    : (value => Array.isArray(value) ? value.slice() : []);
  const parseBooleanUi = typeof deps.parseBooleanUi === "function"
    ? deps.parseBooleanUi
    : ((value, fallback = false) => typeof value === "boolean" ? value : Boolean(fallback));
  const normalizePaletteCustomFamilyColorsUi = typeof deps.normalizePaletteCustomFamilyColorsUi === "function"
    ? deps.normalizePaletteCustomFamilyColorsUi
    : (value => Array.isArray(value) ? value.slice() : []);
  const normalizePaletteFamilyColorCountsUi = typeof deps.normalizePaletteFamilyColorCountsUi === "function"
    ? deps.normalizePaletteFamilyColorCountsUi
    : (value => value && typeof value === "object" ? { ...value } : {});
  const normalizePaletteFamilyColorIndexesUi = typeof deps.normalizePaletteFamilyColorIndexesUi === "function"
    ? deps.normalizePaletteFamilyColorIndexesUi
    : (value => value && typeof value === "object" ? { ...value } : {});
  const normalizePaletteFamiliesUi = typeof deps.normalizePaletteFamiliesUi === "function"
    ? deps.normalizePaletteFamiliesUi
    : (value => Array.isArray(value) ? value.slice() : PALETTE_FAMILY_ORDER.slice());
  const normalizePaletteColorSequenceUi = typeof deps.normalizePaletteColorSequenceUi === "function"
    ? deps.normalizePaletteColorSequenceUi
    : (value => Array.isArray(value) ? value.slice() : []);
  const derivePaletteLegacySelectionFromColorSequenceUi = typeof deps.derivePaletteLegacySelectionFromColorSequenceUi === "function"
    ? deps.derivePaletteLegacySelectionFromColorSequenceUi
    : (() => ({}));
  const normalizePaletteBrandUi = typeof deps.normalizePaletteBrandUi === "function"
    ? deps.normalizePaletteBrandUi
    : (value => String(value || "").trim().toLowerCase());

  let paletteConfigNormalizerUi = null;
  try {
    paletteConfigNormalizerUi =
      typeof contract.createPaletteConfigSnapshotNormalizer === "function"
        ? contract.createPaletteConfigSnapshotNormalizer({
          defaultConfig: configDefault,
          familyOrder: PALETTE_FAMILY_ORDER,
          familyAliases: PALETTE_FAMILY_ALIASES,
          familyDefs: PALETTE_FAMILY_DEFS,
          resolveFamilyIndexSpan: resolvePaletteDefaultIndexSpanUi,
          normalizeColorCount: normalizePaletteColorCountUi,
          normalizeDisorderAggression: normalizePaletteDisorderAggressionUi,
          normalizeCycleMode: normalizePaletteCycleModeUi,
          normalizeTimedIntervalSec: normalizePaletteTimedIntervalSecUi,
          normalizeBeatLockGraceSec: normalizePaletteBeatLockGraceSecUi,
          normalizeReactiveMargin: normalizePaletteReactiveMarginUi,
          normalizeBrightnessFollowAmount: normalizePaletteBrightnessFollowAmountUi,
          normalizeVividness: normalizePaletteVividnessUi,
          normalizeSpectrumMapMode: normalizePaletteSpectrumMapModeUi,
          normalizeSpectrumFeatureMap: normalizePaletteSpectrumFeatureMapUi,
          parseDisorderValue: (value, fallback) => parseBooleanUi(value, fallback),
          parseBeatLockValue: (value, fallback) => parseBooleanUi(value, fallback)
        })
        : null;
  } catch (err) {
    console.error("[PALETTE][ERROR] failed to create config normalizer:", err);
    paletteConfigNormalizerUi = null;
  }

  function buildPaletteConfigFallbackUi() {
    return {
      colorsPerFamily: ui.paletteColorsPerFamily || 3,
      familyColorCounts: ui.paletteFamilyColorCounts || buildPaletteUniformColorCountsUi(ui.paletteColorsPerFamily || 3),
      familyColorIndexes: ui.paletteFamilyColorIndexes || buildPaletteUniformColorIndexesUi(ui.paletteColorsPerFamily || 3),
      colorSequence: ui.paletteColorSequence || null,
      customFamilyColors: ui.paletteCustomFamilyColors || PALETTE_FAMILY_DEFS?.custom?.colors || PALETTE_FAMILY_DEFS_DEFAULT?.custom?.colors || [],
      families: ui.paletteFamilies || PALETTE_FAMILY_ORDER,
      disorder: ui.paletteDisorder,
      disorderAggression: ui.paletteDisorderAggression || 0.35,
      cycleMode: ui.paletteCycleMode || "on_trigger",
      timedIntervalSec: ui.paletteTimedIntervalSec || 5,
      beatLock: ui.paletteBeatLock === true,
      beatLockGraceSec: ui.paletteBeatLockGraceSec || 2,
      reactiveMargin: ui.paletteReactiveMargin || 28,
      brightnessFollowAmount: ui.paletteBrightnessFollowAmount ?? 1,
      vividness: ui.paletteVividness || 2,
      spectrumMapMode: ui.paletteSpectrumMapMode || "auto",
      spectrumFeatureMap: ui.paletteSpectrumFeatureMap || PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP
    };
  }

  function normalizePaletteConfigUi(config = {}, fallback = null) {
    const base = fallback && typeof fallback === "object"
      ? fallback
      : buildPaletteConfigFallbackUi();
    const source = config && typeof config === "object" ? config : {};
    const sharedFallbackSnapshot =
      paletteConfigNormalizerUi && typeof paletteConfigNormalizerUi.normalizeConfigSnapshot === "function"
        ? paletteConfigNormalizerUi.normalizeConfigSnapshot(base, configDefault)
        : null;
    const sharedNormalizedSnapshot =
      paletteConfigNormalizerUi && typeof paletteConfigNormalizerUi.normalizeConfigSnapshot === "function"
        ? paletteConfigNormalizerUi.normalizeConfigSnapshot(
          source,
          sharedFallbackSnapshot || configDefault
        )
        : null;
    const normalizedCustomFamilyColors = normalizePaletteCustomFamilyColorsUi(
      source.customFamilyColors,
      base.customFamilyColors || ui.paletteCustomFamilyColors || PALETTE_FAMILY_DEFS?.custom?.colors || PALETTE_FAMILY_DEFS_DEFAULT?.custom?.colors || []
    );
    const colorsPerFamily = sharedNormalizedSnapshot
      ? normalizePaletteColorCountUi(
        sharedNormalizedSnapshot.colorsPerFamily,
        base.colorsPerFamily || configDefault.colorsPerFamily
      )
      : normalizePaletteColorCountUi(source.colorsPerFamily, base.colorsPerFamily || 3);
    const familyColorCountsFallback = normalizePaletteFamilyColorCountsUi(
      sharedFallbackSnapshot?.familyColorCounts || base.familyColorCounts,
      buildPaletteUniformColorCountsUi(base.colorsPerFamily || colorsPerFamily || 3),
      colorsPerFamily
    );
    const familyColorIndexesFallback = normalizePaletteFamilyColorIndexesUi(
      sharedFallbackSnapshot?.familyColorIndexes || base.familyColorIndexes,
      buildPaletteUniformColorIndexesUi(base.colorsPerFamily || colorsPerFamily || 3),
      familyColorCountsFallback,
      normalizedCustomFamilyColors
    );
    const normalizedFamilyColorCounts = sharedNormalizedSnapshot
      ? normalizePaletteFamilyColorCountsUi(
        sharedNormalizedSnapshot.familyColorCounts,
        familyColorCountsFallback,
        colorsPerFamily
      )
      : normalizePaletteFamilyColorCountsUi(
        source.familyColorCounts,
        familyColorCountsFallback,
        colorsPerFamily
      );
    const normalizedFamilyColorIndexes = normalizePaletteFamilyColorIndexesUi(
      source.familyColorIndexes,
      familyColorIndexesFallback,
      normalizedFamilyColorCounts,
      normalizedCustomFamilyColors
    );
    const normalizedFamilies = sharedNormalizedSnapshot
      ? normalizePaletteFamiliesUi(sharedNormalizedSnapshot.families, base.families || PALETTE_FAMILY_ORDER)
      : normalizePaletteFamiliesUi(source.families, base.families || PALETTE_FAMILY_ORDER);
    const normalizedColorSequence = normalizePaletteColorSequenceUi(
      source.colorSequence,
      base.colorSequence || null,
      {
        colorsPerFamily,
        familyColorCounts: normalizedFamilyColorCounts,
        familyColorIndexes: normalizedFamilyColorIndexes,
        customFamilyColors: normalizedCustomFamilyColors,
        families: normalizedFamilies
      }
    );
    const derivedLegacySelection = derivePaletteLegacySelectionFromColorSequenceUi(
      normalizedColorSequence,
      {
        colorsPerFamily,
        familyColorCounts: normalizedFamilyColorCounts,
        familyColorIndexes: normalizedFamilyColorIndexes,
        customFamilyColors: normalizedCustomFamilyColors,
        families: normalizedFamilies
      }
    );
    const finalColorsPerFamily = normalizePaletteColorCountUi(
      Math.max(colorsPerFamily, derivedLegacySelection.colorsPerFamily || 1),
      colorsPerFamily
    );
    const finalFamilyColorCounts = normalizePaletteFamilyColorCountsUi(
      derivedLegacySelection.familyColorCounts,
      familyColorCountsFallback,
      finalColorsPerFamily
    );
    const finalFamilyColorIndexes = normalizePaletteFamilyColorIndexesUi(
      derivedLegacySelection.familyColorIndexes,
      familyColorIndexesFallback,
      finalFamilyColorCounts,
      normalizedCustomFamilyColors
    );
    return {
      colorsPerFamily: finalColorsPerFamily,
      familyColorCounts: finalFamilyColorCounts,
      familyColorIndexes: finalFamilyColorIndexes,
      colorSequence: normalizedColorSequence.map(entry => ({
        family: entry.family,
        index: entry.index
      })),
      customFamilyColors: normalizedCustomFamilyColors,
      families: derivedLegacySelection.families.slice(),
      disorder: sharedNormalizedSnapshot
        ? Boolean(sharedNormalizedSnapshot.disorder)
        : Object.prototype.hasOwnProperty.call(source, "disorder")
          ? Boolean(source.disorder)
          : Boolean(base.disorder),
      disorderAggression: sharedNormalizedSnapshot
        ? normalizePaletteDisorderAggressionUi(
          sharedNormalizedSnapshot.disorderAggression,
          base.disorderAggression || configDefault.disorderAggression
        )
        : normalizePaletteDisorderAggressionUi(
          source.disorderAggression,
          base.disorderAggression || 0.35
        ),
      cycleMode: sharedNormalizedSnapshot
        ? normalizePaletteCycleModeUi(
          sharedNormalizedSnapshot.cycleMode,
          base.cycleMode || configDefault.cycleMode
        )
        : normalizePaletteCycleModeUi(source.cycleMode, base.cycleMode || "on_trigger"),
      timedIntervalSec: sharedNormalizedSnapshot
        ? normalizePaletteTimedIntervalSecUi(
          sharedNormalizedSnapshot.timedIntervalSec,
          base.timedIntervalSec || configDefault.timedIntervalSec
        )
        : normalizePaletteTimedIntervalSecUi(
          source.timedIntervalSec,
          base.timedIntervalSec || 5
        ),
      beatLock: sharedNormalizedSnapshot
        ? parseBooleanUi(sharedNormalizedSnapshot.beatLock, Boolean(base.beatLock))
        : Object.prototype.hasOwnProperty.call(source, "beatLock")
          ? parseBooleanUi(source.beatLock, Boolean(base.beatLock))
          : Boolean(base.beatLock),
      beatLockGraceSec: sharedNormalizedSnapshot
        ? normalizePaletteBeatLockGraceSecUi(
          sharedNormalizedSnapshot.beatLockGraceSec,
          base.beatLockGraceSec || configDefault.beatLockGraceSec
        )
        : normalizePaletteBeatLockGraceSecUi(
          source.beatLockGraceSec,
          base.beatLockGraceSec || 2
        ),
      reactiveMargin: sharedNormalizedSnapshot
        ? normalizePaletteReactiveMarginUi(
          sharedNormalizedSnapshot.reactiveMargin,
          base.reactiveMargin || configDefault.reactiveMargin
        )
        : normalizePaletteReactiveMarginUi(
          source.reactiveMargin,
          base.reactiveMargin || 28
        ),
      brightnessFollowAmount: sharedNormalizedSnapshot
        ? normalizePaletteBrightnessFollowAmountUi(
          sharedNormalizedSnapshot.brightnessFollowAmount,
          base.brightnessFollowAmount ?? configDefault.brightnessFollowAmount
        )
        : normalizePaletteBrightnessFollowAmountUi(
          source.brightnessFollowAmount,
          base.brightnessFollowAmount ?? 1
        ),
      vividness: sharedNormalizedSnapshot
        ? normalizePaletteVividnessUi(
          sharedNormalizedSnapshot.vividness,
          base.vividness || configDefault.vividness
        )
        : normalizePaletteVividnessUi(
          source.vividness,
          base.vividness || 2
        ),
      spectrumMapMode: sharedNormalizedSnapshot
        ? normalizePaletteSpectrumMapModeUi(
          sharedNormalizedSnapshot.spectrumMapMode,
          base.spectrumMapMode || configDefault.spectrumMapMode
        )
        : normalizePaletteSpectrumMapModeUi(
          source.spectrumMapMode,
          base.spectrumMapMode || "auto"
        ),
      spectrumFeatureMap: sharedNormalizedSnapshot
        ? normalizePaletteSpectrumFeatureMapUi(
          sharedNormalizedSnapshot.spectrumFeatureMap,
          base.spectrumFeatureMap || configDefault.spectrumFeatureMap
        )
        : normalizePaletteSpectrumFeatureMapUi(
          source.spectrumFeatureMap,
          base.spectrumFeatureMap || PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP
        )
    };
  }

  function normalizePaletteBrandOverridesUi(raw = {}, globalConfig = null) {
    const source = raw && typeof raw === "object" ? raw : {};
    const base = normalizePaletteConfigUi(globalConfig || {}, globalConfig || null);
    const out = {};
    for (const brand of PALETTE_SUPPORTED_BRANDS) {
      const entry = source[brand];
      out[brand] = entry && typeof entry === "object"
        ? normalizePaletteConfigUi(entry, base)
        : null;
    }
    return out;
  }

  function normalizePaletteFixtureOverridesUi(raw = {}, brandOverrides = null, globalConfig = null) {
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
        : normalizePaletteConfigUi(globalConfig || {}, globalConfig || null);
      out[fixtureId] = {
        ...normalizePaletteConfigUi(rawConfig, fallback),
        brand,
        fixtureId
      };
    }
    return out;
  }

  return {
    normalizePaletteConfigUi,
    normalizePaletteBrandOverridesUi,
    normalizePaletteFixtureOverridesUi
  };
}
