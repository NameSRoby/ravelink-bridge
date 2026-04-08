// [TITLE] Module: public/assets/js/domains/palette/palette-scope-config-runtime-ui.js
// [TITLE] Purpose: palette scoped config + fixture metric scope runtime extracted from palette orchestrator
// [TITLE] Functionality Index:
// [TITLE] - apply fixture metric routing snapshots to UI scope state
// [TITLE] - apply palette global/brand/fixture scoped snapshot config
// [TITLE] - resolve scoped palette + fixture metric config views for brand menus
// [DEV] Complex Flow:
// [DEV] Scope helpers are central to brand menu rendering and patch payloads.
// [DEV] Keep normalization order stable so scoped overrides remain deterministic.
function createPaletteScopeConfigRuntimeUi(deps = {}) {
  const ui = deps.ui || {};
  const normalizeFixtureMetricConfigUi = typeof deps.normalizeFixtureMetricConfigUi === "function"
    ? deps.normalizeFixtureMetricConfigUi
    : (value => value && typeof value === "object" ? { ...value } : {});
  const FIXTURE_METRIC_CONFIG_DEFAULT = deps.FIXTURE_METRIC_CONFIG_DEFAULT && typeof deps.FIXTURE_METRIC_CONFIG_DEFAULT === "object"
    ? deps.FIXTURE_METRIC_CONFIG_DEFAULT
    : Object.freeze({ mode: "disabled", metric: "rms", harmonySize: 3, maxHz: 24 });
  const normalizeFixtureMetricBrandOverridesUi = typeof deps.normalizeFixtureMetricBrandOverridesUi === "function"
    ? deps.normalizeFixtureMetricBrandOverridesUi
    : (raw => raw && typeof raw === "object" ? { ...raw } : {});
  const normalizeFixtureMetricFixtureOverridesUi = typeof deps.normalizeFixtureMetricFixtureOverridesUi === "function"
    ? deps.normalizeFixtureMetricFixtureOverridesUi
    : (raw => raw && typeof raw === "object" ? { ...raw } : {});
  const normalizePaletteBrandUi = typeof deps.normalizePaletteBrandUi === "function"
    ? deps.normalizePaletteBrandUi
    : (value => String(value || "").trim().toLowerCase());
  const PALETTE_ALL_FIXTURES_VALUE = String(deps.PALETTE_ALL_FIXTURES_VALUE || "__all__");
  const normalizePaletteConfigUi = typeof deps.normalizePaletteConfigUi === "function"
    ? deps.normalizePaletteConfigUi
    : (value => value && typeof value === "object" ? { ...value } : {});
  const buildPaletteUniformColorCountsUi = typeof deps.buildPaletteUniformColorCountsUi === "function"
    ? deps.buildPaletteUniformColorCountsUi
    : (() => ({}));
  const buildPaletteUniformColorIndexesUi = typeof deps.buildPaletteUniformColorIndexesUi === "function"
    ? deps.buildPaletteUniformColorIndexesUi
    : (() => ({}));
  const PALETTE_FAMILY_DEFS = deps.PALETTE_FAMILY_DEFS && typeof deps.PALETTE_FAMILY_DEFS === "object"
    ? deps.PALETTE_FAMILY_DEFS
    : Object.freeze({});
  const PALETTE_FAMILY_DEFS_DEFAULT = deps.PALETTE_FAMILY_DEFS_DEFAULT && typeof deps.PALETTE_FAMILY_DEFS_DEFAULT === "object"
    ? deps.PALETTE_FAMILY_DEFS_DEFAULT
    : Object.freeze({});
  const PALETTE_FAMILY_ORDER = Array.isArray(deps.PALETTE_FAMILY_ORDER)
    ? deps.PALETTE_FAMILY_ORDER
    : Object.freeze(["red", "yellow", "green", "violet", "blue", "custom"]);
  const normalizePaletteColorSequenceUi = typeof deps.normalizePaletteColorSequenceUi === "function"
    ? deps.normalizePaletteColorSequenceUi
    : (value => Array.isArray(value) ? value.slice() : []);
  const normalizePaletteCustomFamilyColorsUi = typeof deps.normalizePaletteCustomFamilyColorsUi === "function"
    ? deps.normalizePaletteCustomFamilyColorsUi
    : (value => Array.isArray(value) ? value.slice() : []);
  const normalizePaletteSpectrumFeatureMapUi = typeof deps.normalizePaletteSpectrumFeatureMapUi === "function"
    ? deps.normalizePaletteSpectrumFeatureMapUi
    : (value => value && typeof value === "object" ? { ...value } : {});
  const PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP = deps.PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP && typeof deps.PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP === "object"
    ? deps.PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP
    : Object.freeze({});
  const normalizePaletteBrandOverridesUi = typeof deps.normalizePaletteBrandOverridesUi === "function"
    ? deps.normalizePaletteBrandOverridesUi
    : (raw => raw && typeof raw === "object" ? { ...raw } : {});
  const normalizePaletteFixtureOverridesUi = typeof deps.normalizePaletteFixtureOverridesUi === "function"
    ? deps.normalizePaletteFixtureOverridesUi
    : (raw => raw && typeof raw === "object" ? { ...raw } : {});
  // [DEV] Renderer binding can arrive after scope runtime construction because palette
  // [DEV] orchestration and render wiring are intentionally split across files.
  let renderPaletteFamilyButtons = typeof deps.renderPaletteFamilyButtons === "function"
    ? deps.renderPaletteFamilyButtons
    : (() => {});
  const parseBooleanUi = typeof deps.parseBooleanUi === "function"
    ? deps.parseBooleanUi
    : ((value, fallback = false) => typeof value === "boolean" ? value : fallback);

function applyFixtureMetricRoutingSnapshotToUi(snapshot = {}) {
  const source = snapshot && typeof snapshot === "object" ? snapshot : {};
  const normalizedGlobal = normalizeFixtureMetricConfigUi(source.config || source, FIXTURE_METRIC_CONFIG_DEFAULT);
  ui.fixtureMetricConfig = { ...normalizedGlobal };
  ui.fixtureMetricBrandOverrides = normalizeFixtureMetricBrandOverridesUi(
    source.brands,
    normalizedGlobal
  );
  ui.fixtureMetricFixtureOverrides = normalizeFixtureMetricFixtureOverridesUi(
    source.fixtureOverrides,
    ui.fixtureMetricBrandOverrides,
    normalizedGlobal
  );
}

function getFixtureMetricBrandConfigUi(brand) {
  const brandKey = normalizePaletteBrandUi(brand);
  const globalConfig = normalizeFixtureMetricConfigUi(ui.fixtureMetricConfig, FIXTURE_METRIC_CONFIG_DEFAULT);
  if (!brandKey) return globalConfig;
  const override = ui.fixtureMetricBrandOverrides && ui.fixtureMetricBrandOverrides[brandKey];
  return override
    ? normalizeFixtureMetricConfigUi(override, globalConfig)
    : globalConfig;
}

function getFixtureMetricScopedConfigUi(brand, fixtureId = PALETTE_ALL_FIXTURES_VALUE) {
  const brandKey = normalizePaletteBrandUi(brand);
  const base = getFixtureMetricBrandConfigUi(brandKey);
  const id = String(fixtureId || "").trim();
  if (!brandKey || !id || id === PALETTE_ALL_FIXTURES_VALUE) return base;
  const fixtureOverride = ui.fixtureMetricFixtureOverrides && ui.fixtureMetricFixtureOverrides[id];
  if (!fixtureOverride || fixtureOverride.brand !== brandKey) return base;
  return normalizeFixtureMetricConfigUi(fixtureOverride, base);
}

function applyPaletteSnapshotToUi(config = {}, options = {}) {
  const next = config && typeof config === "object" ? config : {};
  const normalizedGlobal = normalizePaletteConfigUi(
    next,
    {
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
    }
  );
  ui.paletteColorsPerFamily = normalizedGlobal.colorsPerFamily;
  ui.paletteFamilyColorCounts = { ...normalizedGlobal.familyColorCounts };
  ui.paletteFamilyColorIndexes = { ...normalizedGlobal.familyColorIndexes };
  ui.paletteColorSequence = normalizePaletteColorSequenceUi(
    normalizedGlobal.colorSequence,
    ui.paletteColorSequence,
    normalizedGlobal
  );
  ui.paletteCustomFamilyColors = normalizePaletteCustomFamilyColorsUi(
    normalizedGlobal.customFamilyColors,
    ui.paletteCustomFamilyColors || PALETTE_FAMILY_DEFS?.custom?.colors || PALETTE_FAMILY_DEFS_DEFAULT?.custom?.colors || []
  );
  ui.paletteFamilies = normalizedGlobal.families.slice();
  ui.paletteDisorder = Boolean(normalizedGlobal.disorder);
  ui.paletteDisorderAggression = normalizedGlobal.disorderAggression;
  ui.paletteCycleMode = normalizedGlobal.cycleMode;
  ui.paletteTimedIntervalSec = normalizedGlobal.timedIntervalSec;
  ui.paletteBeatLock = normalizedGlobal.beatLock === true;
  ui.paletteBeatLockGraceSec = normalizedGlobal.beatLockGraceSec;
  ui.paletteReactiveMargin = normalizedGlobal.reactiveMargin;
  ui.paletteBrightnessFollowAmount = normalizedGlobal.brightnessFollowAmount;
  ui.paletteVividness = normalizedGlobal.vividness;
  ui.paletteSpectrumMapMode = normalizedGlobal.spectrumMapMode;
  ui.paletteSpectrumFeatureMap = normalizePaletteSpectrumFeatureMapUi(
    normalizedGlobal.spectrumFeatureMap,
    PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP
  );

  ui.paletteBrandOverrides = normalizePaletteBrandOverridesUi(
    next.brands,
    normalizedGlobal
  );

  const opts = options && typeof options === "object" ? options : {};
  if (opts.fixtureOverrides && typeof opts.fixtureOverrides === "object") {
    ui.paletteFixtureOverrides = normalizePaletteFixtureOverridesUi(
      opts.fixtureOverrides,
      ui.paletteBrandOverrides,
      normalizedGlobal
    );
  }
  if (opts.brandFixtures && typeof opts.brandFixtures === "object") {
    ui.paletteBrandFixtures = {
      hue: Array.isArray(opts.brandFixtures.hue) ? opts.brandFixtures.hue.slice() : [],
      wiz: Array.isArray(opts.brandFixtures.wiz) ? opts.brandFixtures.wiz.slice() : []
    };
  }
  renderPaletteFamilyButtons(ui.paletteCatalog);
}

function getPaletteGlobalConfigUi() {
  return normalizePaletteConfigUi({
    colorsPerFamily: ui.paletteColorsPerFamily,
    familyColorCounts: ui.paletteFamilyColorCounts,
    familyColorIndexes: ui.paletteFamilyColorIndexes,
    colorSequence: ui.paletteColorSequence,
    customFamilyColors: ui.paletteCustomFamilyColors,
    families: ui.paletteFamilies,
    disorder: ui.paletteDisorder,
    disorderAggression: ui.paletteDisorderAggression,
    cycleMode: ui.paletteCycleMode,
    timedIntervalSec: ui.paletteTimedIntervalSec,
    beatLock: ui.paletteBeatLock,
    beatLockGraceSec: ui.paletteBeatLockGraceSec,
    reactiveMargin: ui.paletteReactiveMargin,
    brightnessFollowAmount: ui.paletteBrightnessFollowAmount,
    vividness: ui.paletteVividness,
    spectrumMapMode: ui.paletteSpectrumMapMode,
    spectrumFeatureMap: ui.paletteSpectrumFeatureMap
  });
}

function getPaletteBrandConfigUi(brand) {
  const brandKey = normalizePaletteBrandUi(brand);
  const globalConfig = getPaletteGlobalConfigUi();
  if (!brandKey) return globalConfig;
  const override = ui.paletteBrandOverrides && ui.paletteBrandOverrides[brandKey];
  return override
    ? normalizePaletteConfigUi(override, globalConfig)
    : globalConfig;
}

function getPaletteScopedConfigUi(brand, fixtureId = PALETTE_ALL_FIXTURES_VALUE) {
  const brandKey = normalizePaletteBrandUi(brand);
  const base = getPaletteBrandConfigUi(brandKey);
  const id = String(fixtureId || "").trim();
  if (!brandKey || !id || id === PALETTE_ALL_FIXTURES_VALUE) return base;
  const fixtureOverride = ui.paletteFixtureOverrides && ui.paletteFixtureOverrides[id];
  if (!fixtureOverride || fixtureOverride.brand !== brandKey) return base;
  return normalizePaletteConfigUi(fixtureOverride, base);
}

function getPaletteBrandFixturesUi(brand) {
  const brandKey = normalizePaletteBrandUi(brand);
  if (!brandKey) return [];
  const routed = ui.paletteBrandFixtures && Array.isArray(ui.paletteBrandFixtures[brandKey])
    ? ui.paletteBrandFixtures[brandKey]
    : [];
  if (routed.length) {
    return routed
      .map(entry => {
        const id = String(entry?.id || "").trim();
        const zone = String(entry?.zone || brandKey).trim().toLowerCase() || brandKey;
        return {
          id,
          label: `${id} | ${zone.toUpperCase()}`
        };
      })
      .filter(entry => Boolean(entry.id))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
  const catalog = Array.isArray(ui.fixturesCatalog) ? ui.fixturesCatalog : [];
  return catalog
    .filter(fixture => {
      if (!fixture || typeof fixture !== "object") return false;
      const fixtureBrand = normalizePaletteBrandUi(fixture.brand);
      if (fixtureBrand !== brandKey) return false;
      if (fixture.enabled === false) return false;
      return parseBooleanUi(fixture.engineEnabled, true);
    })
    .map(fixture => {
      const id = String(fixture.id || "").trim();
      const zone = String(fixture.zone || brandKey).trim().toLowerCase() || brandKey;
      return {
        id,
        label: `${id} | ${zone.toUpperCase()}`
      };
    })
    .filter(entry => Boolean(entry.id))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function setRenderPaletteFamilyButtonsUi(nextRender) {
  if (typeof nextRender === "function") {
    renderPaletteFamilyButtons = nextRender;
  }
}

  return {
    applyFixtureMetricRoutingSnapshotToUi,
    getFixtureMetricBrandConfigUi,
    getFixtureMetricScopedConfigUi,
    applyPaletteSnapshotToUi,
    getPaletteGlobalConfigUi,
    getPaletteBrandConfigUi,
    getPaletteScopedConfigUi,
    getPaletteBrandFixturesUi,
    setRenderPaletteFamilyButtonsUi
  };
}
