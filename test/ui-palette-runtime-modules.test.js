const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadFactory(relativeFile, factoryName) {
  const filePath = path.resolve(__dirname, "..", relativeFile);
  const code = fs.readFileSync(filePath, "utf8");
  const context = { console };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: filePath });
  const factory = context[factoryName];
  assert.equal(typeof factory, "function", `missing runtime factory: ${factoryName}`);
  return factory;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}


test("palette fixture-metric runtime normalizes config fields deterministically", () => {
  const createPaletteFixtureMetricContractRuntimeUi = loadFactory(
    "public/assets/js/domains/palette/palette-fixture-metric-contract-runtime-ui.js",
    "createPaletteFixtureMetricContractRuntimeUi"
  );

  const runtime = createPaletteFixtureMetricContractRuntimeUi({
    ui: {
      fixtureMetricConfig: {
        mode: "manual",
        metric: "baseline",
        metaAutoFlip: false,
        harmonySize: 1,
        maxHz: 8
      }
    },
    normalizePaletteBrandUi(value) {
      const brand = String(value || "").trim().toLowerCase();
      return (brand === "hue" || brand === "wiz") ? brand : "";
    },
    contract: {},
    defaults: {
      supportedBrands: ["hue", "wiz"],
      modeOrder: ["manual", "meta_auto"],
      metricKeys: ["baseline", "peaks", "transients", "flux"],
      configDefault: {
        mode: "manual",
        metric: "baseline",
        metaAutoFlip: false,
        harmonySize: 1,
        maxHz: null
      },
      limits: {
        harmonyMin: 1,
        harmonyMax: 8,
        maxHzMin: 0.5,
        maxHzMax: 24
      }
    }
  });

  const normalized = runtime.normalizeFixtureMetricConfigUi({
    mode: "META_AUTO",
    metric: "FLUX",
    metaAutoFlip: "1",
    harmonySize: 99,
    maxHz: "10.37"
  });
  assert.equal(normalized.mode, "meta_auto");
  assert.equal(normalized.metric, "flux");
  assert.equal(normalized.metaAutoFlip, true);
  assert.equal(normalized.harmonySize, 8);
  assert.equal(normalized.maxHz, 10.4);

  assert.equal(runtime.normalizeFixtureMetricMaxHzUi("invalid", 7.04), 7);
  assert.equal(runtime.formatFixtureMetricMaxHzUi("off"), "UNCLAMPED");
});

test("palette fixture-metric runtime scopes brand and fixture overrides", () => {
  const createPaletteFixtureMetricContractRuntimeUi = loadFactory(
    "public/assets/js/domains/palette/palette-fixture-metric-contract-runtime-ui.js",
    "createPaletteFixtureMetricContractRuntimeUi"
  );

  const runtime = createPaletteFixtureMetricContractRuntimeUi({
    ui: {},
    normalizePaletteBrandUi(value) {
      const brand = String(value || "").trim().toLowerCase();
      return (brand === "hue" || brand === "wiz") ? brand : "";
    },
    contract: {},
    defaults: {
      supportedBrands: ["hue", "wiz"],
      modeOrder: ["manual", "meta_auto"],
      metricKeys: ["baseline", "peaks", "transients", "flux"],
      configDefault: {
        mode: "manual",
        metric: "baseline",
        metaAutoFlip: false,
        harmonySize: 1,
        maxHz: null
      },
      limits: {
        harmonyMin: 1,
        harmonyMax: 8,
        maxHzMin: 0.5,
        maxHzMax: 24
      }
    }
  });

  const brandOverrides = runtime.normalizeFixtureMetricBrandOverridesUi(
    {
      hue: { mode: "meta_auto", metric: "peaks", maxHz: "off" },
      wiz: { mode: "manual", metric: "flux", maxHz: 3.5 }
    },
    { mode: "manual", metric: "baseline", metaAutoFlip: false, harmonySize: 1, maxHz: 8 }
  );
  assert.equal(brandOverrides.hue.mode, "meta_auto");
  assert.equal(brandOverrides.hue.maxHz, null);
  assert.equal(brandOverrides.wiz.metric, "flux");
  assert.equal(brandOverrides.wiz.maxHz, 3.5);

  const fixtureOverrides = runtime.normalizeFixtureMetricFixtureOverridesUi(
    {
      "fixture-1": { brand: "hue", metric: "transients", harmonySize: 2, maxHz: 30 },
      "fixture-2": { brand: "unknown", metric: "peaks" },
      "": { brand: "wiz", metric: "flux" }
    },
    brandOverrides,
    { mode: "manual", metric: "baseline", metaAutoFlip: false, harmonySize: 1, maxHz: 8 }
  );
  assert.deepEqual(Object.keys(fixtureOverrides), ["fixture-1"]);
  assert.equal(fixtureOverrides["fixture-1"].brand, "hue");
  assert.equal(fixtureOverrides["fixture-1"].fixtureId, "fixture-1");
  assert.equal(fixtureOverrides["fixture-1"].maxHz, 24);
});

test("palette metadata runtime hydrates families, aliases, defs, and color-count options", () => {
  const createPaletteRuntimeMetadataRuntimeUi = loadFactory(
    "public/assets/js/domains/palette/palette-runtime-metadata-runtime-ui.js",
    "createPaletteRuntimeMetadataRuntimeUi"
  );

  const defaults = {
    familyOrderDefault: ["red", "blue", "custom"],
    familyAliasesDefault: { rouge: "red", azure: "blue", custom: "custom" },
    colorCountOptionsDefault: [1, 2],
    familyDefsDefault: {
      red: { id: "red", label: "RED", colors: [{ r: 200, g: 1, b: 1 }, { r: 201, g: 2, b: 2 }] },
      blue: { id: "blue", label: "BLUE", colors: [{ r: 1, g: 1, b: 200 }, { r: 2, g: 2, b: 201 }] },
      custom: { id: "custom", label: "CUSTOM", colors: [{ r: 9, g: 9, b: 9 }, { r: 10, g: 10, b: 10 }] }
    }
  };
  const state = {
    familyOrder: defaults.familyOrderDefault.slice(),
    familyAliases: { ...defaults.familyAliasesDefault },
    colorCountOptions: defaults.colorCountOptionsDefault.slice(),
    familyDefs: { ...defaults.familyDefsDefault }
  };

  const runtime = createPaletteRuntimeMetadataRuntimeUi({
    state,
    defaults
  });

  const snapshot = {
    contract: {
      families: ["blue", "custom", "red", "blue"],
      familyAliases: {
        sky: "blue",
        invalid: "violet",
        maker: "custom"
      },
      familyDefs: {
        blue: {
          id: "blue",
          label: "Blue",
          colors: [{ r: 5, g: 6, b: 7 }]
        },
        custom: {
          id: "custom",
          label: "Custom",
          colors: [{ r: 1, g: 2, b: 3 }, { r: 4, g: 5, b: 6 }, { r: 7, g: 8, b: 9 }]
        },
        red: {
          id: "red",
          label: "Red",
          colors: [{ r: 10, g: 11, b: 12 }, { r: 13, g: 14, b: 15 }]
        }
      },
      colorsPerFamily: [1, 2, 5]
    }
  };

  const payload = runtime.resolvePaletteRuntimeMetadataPayloadUi(snapshot);
  assert.equal(Array.isArray(payload.families), true);
  assert.equal(payload.families.length, 4);

  runtime.applyPaletteRuntimeMetadataUi(snapshot);
  assert.deepEqual(Array.from(state.familyOrder), ["blue", "custom", "red"]);
  assert.equal(state.familyAliases.sky, "blue");
  assert.equal(Object.prototype.hasOwnProperty.call(state.familyAliases, "invalid"), false);
  assert.equal(state.familyDefs.blue.colors.length, 2);
  assert.equal(state.familyDefs.custom.colors.length, 2);
  assert.deepEqual(Array.from(state.colorCountOptions), [1, 2]);
});

test("palette runtime snapshot runtime applies config, metrics, menus, and scope event", () => {
  const createPaletteRuntimeSnapshotRuntimeUi = loadFactory(
    "public/assets/js/domains/palette/palette-runtime-snapshot-runtime-ui.js",
    "createPaletteRuntimeSnapshotRuntimeUi"
  );

  const calls = [];
  const events = [];
  const ui = {};
  function CustomEventStub(type, options = {}) {
    this.type = type;
    this.detail = options.detail || {};
  }
  const runtime = createPaletteRuntimeSnapshotRuntimeUi({
    ui,
    windowRef: {
      dispatchEvent(event) {
        events.push({ type: event.type, detail: event.detail });
      }
    },
    CustomEventRef: CustomEventStub,
    applyPaletteRuntimeMetadataUi(snapshot) {
      calls.push(["metadata", snapshot.contract?.version || 0]);
    },
    applyPaletteSnapshotToUi(config, options) {
      calls.push(["config", config.name, options.fixtureOverrides.fixtureA, options.brandFixtures.hue?.length || 0]);
    },
    applyFixtureMetricRoutingSnapshotToUi(metricRouting) {
      calls.push(["metrics", metricRouting.mode]);
    },
    renderPaletteBrandMenus(options) {
      calls.push(["menus", options.reason, options.force]);
    }
  });

  runtime.applyPaletteRuntimeSnapshotToUi({
    contract: { version: 2 },
    catalog: [{ id: "palette-a" }],
    config: { name: "global" },
    fixtureOverrides: { fixtureA: true },
    brandFixtures: { hue: ["fixtureA"] },
    metricRouting: { mode: "meta_auto" }
  }, { forceRender: true });

  assert.deepEqual(ui.paletteCatalog, [{ id: "palette-a" }]);
  assert.deepEqual(calls, [
    ["metadata", 2],
    ["config", "global", true, 1],
    ["metrics", "meta_auto"],
    ["menus", "palette_runtime_snapshot", true]
  ]);
  assert.deepEqual(plain(events), [{
    type: "ravelink:live-scope-targets-updated",
    detail: { reason: "palette_runtime_snapshot" }
  }]);
});

test("palette brand custom-color actions build scoped mutation payloads", async () => {
  const createPaletteBrandCustomColorActionsRuntimeUi = loadFactory(
    "public/assets/js/domains/palette/palette-brand-custom-color-actions-runtime-ui.js",
    "createPaletteBrandCustomColorActionsRuntimeUi"
  );

  const patches = [];
  const badges = [];
  const runtime = createPaletteBrandCustomColorActionsRuntimeUi({
    el: { health: {} },
    ui: {
      paletteCustomFamilyColors: [
        { r: 10, g: 20, b: 30 },
        { r: 40, g: 50, b: 60 }
      ]
    },
    normalizePaletteBrandUi(value) {
      const brand = String(value || "").trim().toLowerCase();
      return brand === "hue" || brand === "wiz" ? brand : "";
    },
    parsePaletteRgbColorTokenUi(value) {
      if (String(value || "").trim() === "#010203") return { r: 1, g: 2, b: 3 };
      return null;
    },
    getPaletteBrandScopePatchUi(brand) {
      return { brand, fixtureId: "fixture-1" };
    },
    getPaletteScopedConfigUi() {
      return {
        customFamilyColors: [
          { r: 10, g: 20, b: 30 },
          { r: 40, g: 50, b: 60 }
        ]
      };
    },
    normalizePaletteCustomFamilyColorsUi(value, fallback = []) {
      return Array.isArray(value) && value.length ? value.slice() : fallback.slice();
    },
    clampNumber(value, min, max, fallback) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.max(min, Math.min(max, parsed));
    },
    async applyPalettePatch(patch, label) {
      patches.push({ patch, label });
      return true;
    },
    setBadge(_node, state, text) {
      badges.push({ state, text });
    }
  });

  assert.equal(await runtime.updatePaletteBrandCustomColorUi({
    value: "#010203",
    dataset: { paletteBrandCustomColorValue: "hue", colorIndex: "1" }
  }), true);
  assert.equal(await runtime.addPaletteBrandCustomColorUi({
    dataset: { paletteBrandCustomColorAdd: "hue" }
  }), true);
  assert.equal(await runtime.removePaletteBrandCustomColorUi({
    dataset: { paletteBrandCustomColorRemove: "hue", colorIndex: "0" }
  }), true);

  assert.deepEqual(plain(patches), [
    {
      patch: {
        brand: "hue",
        fixtureId: "fixture-1",
        customFamilyColors: [{ r: 10, g: 20, b: 30 }, { r: 1, g: 2, b: 3 }]
      },
      label: "HUE CUSTOM COLORS"
    },
    {
      patch: {
        brand: "hue",
        fixtureId: "fixture-1",
        customFamilyColors: [{ r: 10, g: 20, b: 30 }, { r: 40, g: 50, b: 60 }, { r: 48, g: 58, b: 68 }]
      },
      label: "HUE CUSTOM COLORS"
    },
    {
      patch: {
        brand: "hue",
        fixtureId: "fixture-1",
        customFamilyColors: [{ r: 40, g: 50, b: 60 }]
      },
      label: "HUE CUSTOM COLORS"
    }
  ]);
  assert.deepEqual(plain(badges), [
    { state: "ok", text: "HUE CUSTOM COLOR 2 UPDATED" },
    { state: "ok", text: "HUE CUSTOM COLOR ADDED" },
    { state: "ok", text: "HUE CUSTOM COLOR REMOVED" }
  ]);
});

test("palette config normalization runtime preserves scoped overrides and legacy sequence repair", () => {
  const createPaletteConfigNormalizationRuntimeUi = loadFactory(
    "public/assets/js/domains/palette/palette-config-normalization-runtime-ui.js",
    "createPaletteConfigNormalizationRuntimeUi"
  );

  const runtime = createPaletteConfigNormalizationRuntimeUi({
    ui: {
      paletteColorsPerFamily: 3,
      paletteFamilyColorCounts: { red: 3, blue: 3, custom: 3 },
      paletteFamilyColorIndexes: { red: [0, 1, 2], blue: [0, 1, 2], custom: [0, 1, 2] },
      paletteColorSequence: [{ family: "red", index: 0 }],
      paletteCustomFamilyColors: [{ r: 1, g: 2, b: 3 }],
      paletteFamilies: ["red", "blue", "custom"],
      paletteDisorder: false,
      paletteDisorderAggression: 0.35,
      paletteCycleMode: "on_trigger",
      paletteTimedIntervalSec: 5,
      paletteBeatLock: false,
      paletteBeatLockGraceSec: 2,
      paletteReactiveMargin: 28,
      paletteBrightnessFollowAmount: 1,
      paletteVividness: 2,
      paletteSpectrumMapMode: "auto",
      paletteSpectrumFeatureMap: ["lows", "mids", "highs"]
    },
    contract: {
      createPaletteConfigSnapshotNormalizer() {
        return {
          normalizeConfigSnapshot(source = {}, fallback = {}) {
            return {
              ...fallback,
              ...source,
              familyColorCounts: source.familyColorCounts || fallback.familyColorCounts,
              familyColorIndexes: source.familyColorIndexes || fallback.familyColorIndexes,
              families: source.families || fallback.families,
              spectrumFeatureMap: source.spectrumFeatureMap || fallback.spectrumFeatureMap
            };
          }
        };
      }
    },
    configDefault: {
      colorsPerFamily: 3,
      familyColorCounts: { red: 3, blue: 3, custom: 3 },
      familyColorIndexes: { red: [0, 1, 2], blue: [0, 1, 2], custom: [0, 1, 2] },
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
      spectrumFeatureMap: ["lows", "mids", "highs"]
    },
    PALETTE_FAMILY_ORDER: ["red", "blue", "custom"],
    PALETTE_FAMILY_ALIASES: { rouge: "red", azure: "blue", custom: "custom" },
    PALETTE_FAMILY_DEFS: {
      custom: { colors: [{ r: 9, g: 9, b: 9 }] }
    },
    PALETTE_FAMILY_DEFS_DEFAULT: {
      custom: { colors: [{ r: 9, g: 9, b: 9 }] }
    },
    PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP: ["lows", "mids", "highs"],
    PALETTE_SUPPORTED_BRANDS: ["hue", "wiz"],
    buildPaletteUniformColorCountsUi(count = 3) {
      return { red: count, blue: count, custom: count };
    },
    buildPaletteUniformColorIndexesUi(count = 3) {
      const indexes = Array.from({ length: count }, (_value, idx) => idx);
      return { red: indexes.slice(), blue: indexes.slice(), custom: indexes.slice() };
    },
    resolvePaletteDefaultIndexSpanUi() {
      return [0, 1, 2];
    },
    normalizePaletteColorCountUi(value, fallback = 3) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.max(1, Math.round(parsed)) : Number(fallback);
    },
    normalizePaletteDisorderAggressionUi(value, fallback = 0.35) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : Number(fallback);
    },
    normalizePaletteCycleModeUi(value, fallback = "on_trigger") {
      return String(value || fallback || "on_trigger").trim().toLowerCase();
    },
    normalizePaletteTimedIntervalSecUi(value, fallback = 5) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : Number(fallback);
    },
    normalizePaletteBeatLockGraceSecUi(value, fallback = 2) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : Number(fallback);
    },
    normalizePaletteReactiveMarginUi(value, fallback = 28) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : Number(fallback);
    },
    normalizePaletteBrightnessFollowAmountUi(value, fallback = 1) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : Number(fallback);
    },
    normalizePaletteVividnessUi(value, fallback = 2) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : Number(fallback);
    },
    normalizePaletteSpectrumMapModeUi(value, fallback = "auto") {
      return String(value || fallback || "auto").trim().toLowerCase();
    },
    normalizePaletteSpectrumFeatureMapUi(value, fallback = []) {
      return Array.isArray(value) && value.length ? value.slice() : fallback.slice();
    },
    parseBooleanUi(value, fallback = false) {
      if (typeof value === "boolean") return value;
      if (String(value || "").trim() === "1") return true;
      if (String(value || "").trim() === "0") return false;
      return Boolean(fallback);
    },
    normalizePaletteCustomFamilyColorsUi(value, fallback = []) {
      return Array.isArray(value) && value.length ? value.slice() : fallback.slice();
    },
    normalizePaletteFamilyColorCountsUi(value, fallback = {}, colorsPerFamily = 3) {
      return value && typeof value === "object"
        ? { ...fallback, ...value }
        : { ...fallback, red: colorsPerFamily, blue: colorsPerFamily, custom: colorsPerFamily };
    },
    normalizePaletteFamilyColorIndexesUi(value, fallback = {}, counts = {}) {
      if (value && typeof value === "object") return { ...fallback, ...value };
      return {
        ...fallback,
        red: Array.from({ length: counts.red || 0 }, (_value, idx) => idx),
        blue: Array.from({ length: counts.blue || 0 }, (_value, idx) => idx),
        custom: Array.from({ length: counts.custom || 0 }, (_value, idx) => idx)
      };
    },
    normalizePaletteFamiliesUi(value, fallback = []) {
      return Array.isArray(value) && value.length ? value.slice() : fallback.slice();
    },
    normalizePaletteColorSequenceUi(value, fallback = []) {
      const rows = Array.isArray(value) && value.length ? value : fallback;
      return rows.map(entry => ({
        family: String(entry.family || "red").trim().toLowerCase(),
        index: Math.max(0, Math.round(Number(entry.index || 0)))
      }));
    },
    derivePaletteLegacySelectionFromColorSequenceUi(sequence = [], fallback = {}) {
      const families = sequence.map(entry => entry.family);
      return {
        colorsPerFamily: 2,
        familyColorCounts: { red: 2, blue: 2, custom: 2 },
        familyColorIndexes: { red: [0, 1], blue: [0, 1], custom: [0, 1] },
        families: families.length ? families : (fallback.families || ["red"])
      };
    },
    normalizePaletteBrandUi(value) {
      const brand = String(value || "").trim().toLowerCase();
      return (brand === "hue" || brand === "wiz") ? brand : "";
    }
  });

  const normalized = runtime.normalizePaletteConfigUi({
    families: ["blue", "custom"],
    colorSequence: [{ family: "blue", index: 1 }, { family: "custom", index: 0 }],
    cycleMode: "TIMED",
    timedIntervalSec: "7",
    beatLock: "1",
    spectrumFeatureMap: ["mids", "flux"]
  });
  assert.equal(normalized.colorsPerFamily, 3);
  assert.deepEqual(Array.from(normalized.families), ["blue", "custom"]);
  assert.equal(normalized.colorSequence[0].family, "blue");
  assert.equal(normalized.cycleMode, "timed");
  assert.equal(normalized.timedIntervalSec, 7);
  assert.equal(normalized.beatLock, true);

  const brandOverrides = runtime.normalizePaletteBrandOverridesUi(
    {
      hue: { cycleMode: "timed", timedIntervalSec: 9 },
      wiz: { vividness: 4 }
    },
    normalized
  );
  assert.equal(brandOverrides.hue.cycleMode, "timed");
  assert.equal(brandOverrides.hue.timedIntervalSec, 9);
  assert.equal(brandOverrides.wiz.vividness, 4);

  const fixtureOverrides = runtime.normalizePaletteFixtureOverridesUi(
    {
      "fixture-1": { brand: "hue", beatLock: false, spectrumMapMode: "manual" },
      "fixture-2": { brand: "unknown", vividness: 1 }
    },
    brandOverrides,
    normalized
  );
  assert.deepEqual(Object.keys(fixtureOverrides), ["fixture-1"]);
  assert.equal(fixtureOverrides["fixture-1"].brand, "hue");
  assert.equal(fixtureOverrides["fixture-1"].fixtureId, "fixture-1");
  assert.equal(fixtureOverrides["fixture-1"].spectrumMapMode, "manual");
});

test("palette global view uses deterministic recovery when family rendering fails", () => {
  const createPaletteGlobalViewRuntimeUi = loadFactory(
    "public/assets/js/domains/palette/palette-global-view-runtime.js",
    "createPaletteGlobalViewRuntimeUi"
  );

  const grid = {
    innerHTML: "",
    textContent: "",
    querySelector(selector) {
      if (selector === "[data-palette-family-recovery]") {
        return this.innerHTML.includes("data-palette-family-recovery") ? {} : null;
      }
      if (selector === "[data-palette-family-tab]") {
        return this.innerHTML.includes("data-palette-family-tab") ? {} : null;
      }
      return null;
    }
  };
  const ui = { paletteCatalog: [{ id: "red", label: "RED" }] };
  const badges = [];
  const runtime = createPaletteGlobalViewRuntimeUi({
    el: { paletteFamilyGrid: grid, health: {} },
    ui,
    PALETTE_FAMILY_ORDER: ["red", "custom"],
    PALETTE_FAMILY_DEFS: { red: { label: "RED" }, custom: { label: "CUSTOM" } },
    getPaletteGlobalConfigUi: () => ({ colorSequence: [{ family: "red", index: 0 }], vividness: 2 }),
    getPaletteFamilyColorBankUi: () => [{ r: 255, g: 0, b: 0 }],
    buildPaletteGlobalFamilyLibraryEditorUi() {
      throw new Error("builder_broke");
    },
    buildPaletteGlobalActiveSequenceEditorUi: () => "<div data-palette-sequence-card></div>",
    setBadge: (...args) => badges.push(args)
  });

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    runtime.renderPaletteFamilyButtons([{ id: "red", label: "RED" }]);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(grid.innerHTML.includes("data-palette-family-recovery"), true);
  assert.equal(grid.innerHTML.includes("fallback active"), false);
  assert.equal(ui.paletteFamilyGridRecovery.active, true);
  assert.equal(ui.paletteFamilyGridRecovery.reason, "builder_broke");
  assert.equal(badges[0][2], "PALETTE FAMILY UI RECOVERY PENDING");
});
