// [TITLE] Module: public/assets/js/domains/palette/palette-brand-view-runtime.js
// [TITLE] Purpose: brand/per-fixture palette menu render and interaction-protection runtime
// [TITLE] Functionality Index:
// [TITLE] - fixture target selection memory normalization
// [TITLE] - brand card render markup
// [TITLE] - deferred render protection while brand menus are being edited
// [TITLE] - brand menu render/runtime refresh entrypoint
// [DEV] Complex Flow:
// [DEV] The per-brand palette menus are expensive and easy to clobber while users interact
// [DEV] with selects/inputs. This module owns the render/defer lifecycle and exposes only the
// [DEV] render + interaction guards back to palette.js. Mutation handlers remain separate.

function createPaletteBrandViewRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const documentRef = deps.documentRef || document;
  const normalizePaletteBrandUi = typeof deps.normalizePaletteBrandUi === "function" ? deps.normalizePaletteBrandUi : (value => String(value || "").trim().toLowerCase());
  const PALETTE_ALL_FIXTURES_VALUE = String(deps.PALETTE_ALL_FIXTURES_VALUE || "__all__");
  const persistPaletteFixtureSelectionMemory = typeof deps.persistPaletteFixtureSelectionMemory === "function" ? deps.persistPaletteFixtureSelectionMemory : (() => {});
  const PALETTE_BRAND_LABELS = deps.PALETTE_BRAND_LABELS || {};
  const getPaletteScopedConfigUi = typeof deps.getPaletteScopedConfigUi === "function" ? deps.getPaletteScopedConfigUi : (() => ({}));
  const normalizePaletteColorCountUi = typeof deps.normalizePaletteColorCountUi === "function" ? deps.normalizePaletteColorCountUi : (value => Number(value) || 3);
  const normalizePaletteFamiliesUi = typeof deps.normalizePaletteFamiliesUi === "function" ? deps.normalizePaletteFamiliesUi : (value => Array.isArray(value) ? value : []);
  const PALETTE_FAMILY_ORDER = Array.isArray(deps.PALETTE_FAMILY_ORDER) ? deps.PALETTE_FAMILY_ORDER : [];
  const normalizePaletteDisorderAggressionUi = typeof deps.normalizePaletteDisorderAggressionUi === "function" ? deps.normalizePaletteDisorderAggressionUi : (value => Number(value) || 0.35);
  const normalizePaletteVividnessUi = typeof deps.normalizePaletteVividnessUi === "function" ? deps.normalizePaletteVividnessUi : (value => Number(value) || 2);
  const getFixtureMetricScopedConfigUi = typeof deps.getFixtureMetricScopedConfigUi === "function" ? deps.getFixtureMetricScopedConfigUi : (() => ({}));
  const normalizeFixtureMetricModeUi = typeof deps.normalizeFixtureMetricModeUi === "function" ? deps.normalizeFixtureMetricModeUi : (value => String(value || "manual").trim().toLowerCase());
  const FIXTURE_METRIC_CONFIG_DEFAULT = deps.FIXTURE_METRIC_CONFIG_DEFAULT || { mode: "manual", metric: "baseline", harmonySize: 1, maxHz: 0 };
  const normalizeFixtureMetricKeyUi = typeof deps.normalizeFixtureMetricKeyUi === "function" ? deps.normalizeFixtureMetricKeyUi : (value => String(value || "baseline").trim().toLowerCase());
  const normalizeFixtureMetricHarmonySizeUi = typeof deps.normalizeFixtureMetricHarmonySizeUi === "function" ? deps.normalizeFixtureMetricHarmonySizeUi : (value => Number(value) || 1);
  const normalizeFixtureMetricMaxHzUi = typeof deps.normalizeFixtureMetricMaxHzUi === "function" ? deps.normalizeFixtureMetricMaxHzUi : (value => Number(value) || 0);
  const FIXTURE_METRIC_MAX_HZ_DEFAULT = Number(deps.FIXTURE_METRIC_MAX_HZ_DEFAULT || 0);
  const formatFixtureMetricMaxHzUi = typeof deps.formatFixtureMetricMaxHzUi === "function" ? deps.formatFixtureMetricMaxHzUi : (value => String(value || 0));
  const escapeHtmlUi = typeof deps.escapeHtmlUi === "function" ? deps.escapeHtmlUi : (value => String(value || ""));
  const PALETTE_FAMILY_DEFS = deps.PALETTE_FAMILY_DEFS || {};
  const getPaletteFamilyColorBankUi = typeof deps.getPaletteFamilyColorBankUi === "function" ? deps.getPaletteFamilyColorBankUi : (() => []);
  const applyPaletteVividnessToColorUi = typeof deps.applyPaletteVividnessToColorUi === "function" ? deps.applyPaletteVividnessToColorUi : (color => color || { r: 255, g: 255, b: 255 });
  const resolvePaletteColorIndexesForFamilyUi = typeof deps.resolvePaletteColorIndexesForFamilyUi === "function" ? deps.resolvePaletteColorIndexesForFamilyUi : (() => []);
  const buildPaletteFamilyColorEditorUi = typeof deps.buildPaletteFamilyColorEditorUi === "function" ? deps.buildPaletteFamilyColorEditorUi : (() => "");
  const formatPaletteVividnessLabelUi = typeof deps.formatPaletteVividnessLabelUi === "function" ? deps.formatPaletteVividnessLabelUi : (value => String(value || ""));
  const FIXTURE_METRIC_MODE_ORDER = Array.isArray(deps.FIXTURE_METRIC_MODE_ORDER) ? deps.FIXTURE_METRIC_MODE_ORDER : [];
  const FIXTURE_METRIC_KEYS = Array.isArray(deps.FIXTURE_METRIC_KEYS) ? deps.FIXTURE_METRIC_KEYS : [];
  const FIXTURE_METRIC_LABELS = deps.FIXTURE_METRIC_LABELS || {};
  const FIXTURE_METRIC_HARMONY_MIN = Number(deps.FIXTURE_METRIC_HARMONY_MIN || 1);
  const FIXTURE_METRIC_HARMONY_MAX = Number(deps.FIXTURE_METRIC_HARMONY_MAX || 8);
  const FIXTURE_METRIC_MAX_HZ_MIN = Number(deps.FIXTURE_METRIC_MAX_HZ_MIN || 2);
  const FIXTURE_METRIC_MAX_HZ_MAX = Number(deps.FIXTURE_METRIC_MAX_HZ_MAX || 16);
  const FIXTURE_METRIC_MAX_HZ_STEP = Number(deps.FIXTURE_METRIC_MAX_HZ_STEP || 1);
  const PALETTE_SUPPORTED_BRANDS = Array.isArray(deps.PALETTE_SUPPORTED_BRANDS) ? deps.PALETTE_SUPPORTED_BRANDS : [];
  const normalizePaletteControlScopeUi = typeof deps.normalizePaletteControlScopeUi === "function" ? deps.normalizePaletteControlScopeUi : (value => String(value || "global").trim().toLowerCase());
  const normalizePaletteCustomBrandMemoryUi = typeof deps.normalizePaletteCustomBrandMemoryUi === "function" ? deps.normalizePaletteCustomBrandMemoryUi : ((_value, fallback) => fallback || "hue");
  const getPaletteBrandFixturesUi = typeof deps.getPaletteBrandFixturesUi === "function" ? deps.getPaletteBrandFixturesUi : (() => []);

  let paletteBrandMenusDeferredRenderTimer = null;
  let paletteBrandMenusInteractionUntil = 0;

  function getPaletteBrandSelectionUi(brand, fixtures = []) {
    const brandKey = normalizePaletteBrandUi(brand);
    if (!brandKey) return PALETTE_ALL_FIXTURES_VALUE;
    if (!ui.paletteFixtureSelectionByBrand || typeof ui.paletteFixtureSelectionByBrand !== "object") {
      ui.paletteFixtureSelectionByBrand = { hue: PALETTE_ALL_FIXTURES_VALUE, wiz: PALETTE_ALL_FIXTURES_VALUE };
    }
    const requested = String(ui.paletteFixtureSelectionByBrand[brandKey] || PALETTE_ALL_FIXTURES_VALUE).trim();
    const validFixtureIds = new Set((Array.isArray(fixtures) ? fixtures : []).map(entry => String(entry.id || "").trim()));
    const selected = requested === PALETTE_ALL_FIXTURES_VALUE || validFixtureIds.has(requested)
      ? requested
      : PALETTE_ALL_FIXTURES_VALUE;
    if (ui.paletteFixtureSelectionByBrand[brandKey] !== selected) {
      ui.paletteFixtureSelectionByBrand[brandKey] = selected;
      persistPaletteFixtureSelectionMemory();
    }
    return selected;
  }

  function buildPaletteBrandCardUi(brand, fixtures = []) {
    const brandKey = normalizePaletteBrandUi(brand);
    if (!brandKey) return "";
    const brandLabel = PALETTE_BRAND_LABELS[brandKey] || brandKey.toUpperCase();
    const selectedFixture = getPaletteBrandSelectionUi(brandKey, fixtures);
    const config = getPaletteScopedConfigUi(brandKey, selectedFixture);
    const colorsPerFamily = normalizePaletteColorCountUi(config.colorsPerFamily, 3);
    const families = normalizePaletteFamiliesUi(config.families, PALETTE_FAMILY_ORDER);
    const vividness = normalizePaletteVividnessUi(config.vividness, 2);
    const fixtureOverrideCount = (Array.isArray(fixtures) ? fixtures : []).reduce((count, entry) => {
      const fixtureId = String(entry?.id || "").trim();
      if (!fixtureId) return count;
      const override = ui.paletteFixtureOverrides && ui.paletteFixtureOverrides[fixtureId];
      return override && override.brand === brandKey ? count + 1 : count;
    }, 0);
    const targetScopeHint = selectedFixture === PALETTE_ALL_FIXTURES_VALUE
      ? `Scope: brand default (${brandLabel} all fixtures).`
      : `Scope: fixture override (${selectedFixture}).`;
    const targetOverrideHint = selectedFixture === PALETTE_ALL_FIXTURES_VALUE && fixtureOverrideCount > 0
      ? `${fixtureOverrideCount} fixture override${fixtureOverrideCount === 1 ? "" : "s"} active. Brand edits do not replace fixture-specific overrides until cleared.`
      : "";

    const fixtureOptions = [
      `<option value="${PALETTE_ALL_FIXTURES_VALUE}" ${selectedFixture === PALETTE_ALL_FIXTURES_VALUE ? "selected" : ""}>ALL ${brandLabel} FIXTURES</option>`,
      ...fixtures.map(entry => {
        const id = String(entry.id || "").trim();
        const label = escapeHtmlUi(entry.label || id);
        return `<option value="${escapeHtmlUi(id)}" ${selectedFixture === id ? "selected" : ""}>${label}</option>`;
      })
    ].join("");

    const familyControls = PALETTE_FAMILY_ORDER.map(family => {
      const familyLabel = String(PALETTE_FAMILY_DEFS[family]?.label || family).trim().toUpperCase() || family.toUpperCase();
      const baseColorBank = getPaletteFamilyColorBankUi(family, config);
      const colorBank = baseColorBank.map(color => applyPaletteVividnessToColorUi(color, vividness));
      const customDefineColors = baseColorBank;
      const selectedIndexes = resolvePaletteColorIndexesForFamilyUi(config, family, colorsPerFamily);
      const editor = buildPaletteFamilyColorEditorUi({
        scope: "brand",
        brand: brandKey,
        family,
        familyLabel,
        selectedIndexes,
        colors: colorBank,
        baseColors: baseColorBank,
        customDefineColors
      });
      return (
        `<div class="paletteBrandFamilyControl">` +
          `<button type="button" data-palette-brand-family="${brandKey}" data-family="${family}" class="${families.includes(family) ? "active" : ""}" title="Toggle ${familyLabel} family in the playback sequence for this target.">${familyLabel}</button>` +
          editor +
        `</div>`
      );
    }).join("");
    const vividnessLabel = formatPaletteVividnessLabelUi(vividness);
    return (
      `<div class="paletteBrandCard" data-palette-brand-card="${brandKey}">` +
        `<h4>${brandLabel} FIXTURE MENU</h4>` +
        `<div class="paletteBrandSections">` +
          `<details class="paletteBrandSection" open>` +
            `<summary>TARGET</summary>` +
            `<div class="paletteBrandSectionBody">` +
              `<div class="paletteBrandFixtureRow">` +
                `<div>` +
                  `<p class="paletteBrandSubLabel">TARGET</p>` +
                  `<select data-palette-brand-fixture="${brandKey}" title="Choose ALL fixtures of this brand, or one fixture ID for a per-fixture override.">${fixtureOptions}</select>` +
                `</div>` +
                `<button type="button" data-palette-brand-clear="${brandKey}" title="Clear all palette and song-metric overrides for the currently selected target.">CLEAR ALL OVERRIDE</button>` +
              `</div>` +
              `<p class="hint paletteScopeHint">${escapeHtmlUi(targetScopeHint)}</p>` +
              (targetOverrideHint ? `<p class="hint paletteScopeHint paletteScopeHintWarn">${escapeHtmlUi(targetOverrideHint)}</p>` : "") +
            `</div>` +
          `</details>` +
          `<details class="paletteBrandSection" open>` +
            `<summary>COLOR PALETTE</summary>` +
            `<div class="paletteBrandSectionBody">` +
              `<p class="paletteBrandSubLabel">FAMILIES + COLOR SELECTION</p>` +
              `<div class="paletteBrandFamilyGrid">${familyControls}</div>` +
              `<div class="paletteBrandSlider">` +
                `<label>` +
                  `<span>VIVIDNESS</span>` +
                  `<span class="sliderInlineControls">` +
                    `<span class="paletteBrandValue" data-palette-brand-vividness-val="${brandKey}">${vividnessLabel}</span>` +
                    `<button type="button" class="sliderInlineResetBtn" data-palette-brand-vividness-reset="${brandKey}">RESET</button>` +
                  `</span>` +
                `</label>` +
                `<input type="range" min="0" max="4" step="1" value="${vividness}" data-palette-brand-vividness-slider="${brandKey}" title="Set ${brandLabel} vividness. Swatch previews update live while dragging.">` +
              `</div>` +
              `<p class="hint">Higher vividness boosts saturation/contrast and preview swatches update live while you drag.</p>` +
            `</div>` +
          `</details>` +
        `</div>` +
      `</div>`
    );
  }

  function markPaletteBrandMenusInteraction(holdMs = 1200) {
    const nextUntil = Date.now() + Math.max(250, Number(holdMs) || 1200);
    if (nextUntil > paletteBrandMenusInteractionUntil) {
      paletteBrandMenusInteractionUntil = nextUntil;
    }
  }

  function isPaletteBrandMenusInteractionActive() {
    if (el.paletteBrandMenus && documentRef.activeElement && el.paletteBrandMenus.contains(documentRef.activeElement)) {
      const active = documentRef.activeElement;
      const tag = String(active.tagName || "").trim().toLowerCase();
      if (tag === "select" || tag === "input" || tag === "textarea") {
        return true;
      }
    }
    return Date.now() < Number(paletteBrandMenusInteractionUntil || 0);
  }

  function schedulePaletteBrandMenusDeferredRender(options = {}) {
    if (paletteBrandMenusDeferredRenderTimer) return;
    paletteBrandMenusDeferredRenderTimer = setTimeout(() => {
      paletteBrandMenusDeferredRenderTimer = null;
      renderPaletteBrandMenus(options);
    }, 200);
  }

  function renderPaletteBrandMenus(options = {}) {
    if (!el.paletteBrandMenus) return;
    const opts = options && typeof options === "object" ? options : {};
    const force = opts.force === true;
    if (!force && isPaletteBrandMenusInteractionActive()) {
      schedulePaletteBrandMenusDeferredRender(opts);
      return;
    }
    if (paletteBrandMenusDeferredRenderTimer) {
      clearTimeout(paletteBrandMenusDeferredRenderTimer);
      paletteBrandMenusDeferredRenderTimer = null;
    }
    const fixturesByBrand = {};
    const availableBrands = [];
    for (const brand of PALETTE_SUPPORTED_BRANDS) {
      const fixtures = getPaletteBrandFixturesUi(brand);
      if (!fixtures.length) continue;
      fixturesByBrand[brand] = fixtures;
      availableBrands.push(brand);
    }
    if (!availableBrands.length) {
      el.paletteBrandMenus.innerHTML = `<div class="hint">No engine-routed Hue/WiZ fixtures detected for per-brand menus.</div>`;
      return;
    }

    const customScopeActive = normalizePaletteControlScopeUi(ui.paletteControlScope, "global") === "custom";
    if (!availableBrands.includes(ui.paletteCustomBrand)) {
      ui.paletteCustomBrand = availableBrands[0];
    }

    if (customScopeActive) {
      const activeBrand = normalizePaletteCustomBrandMemoryUi(ui.paletteCustomBrand, availableBrands[0]);
      const fixtures = fixturesByBrand[activeBrand] || fixturesByBrand[availableBrands[0]] || [];
      el.paletteBrandMenus.innerHTML = buildPaletteBrandCardUi(activeBrand, fixtures);
      return;
    }

    const cards = availableBrands.map(brand => buildPaletteBrandCardUi(brand, fixturesByBrand[brand] || []));
    el.paletteBrandMenus.innerHTML = cards.join("");
  }

  return {
    markPaletteBrandMenusInteraction,
    renderPaletteBrandMenus
  };
}
