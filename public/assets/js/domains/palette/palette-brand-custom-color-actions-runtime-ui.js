// [TITLE] Module: public/assets/js/domains/palette/palette-brand-custom-color-actions-runtime-ui.js
// [TITLE] Purpose: palette brand custom-color mutation helpers
// [TITLE] Functionality Index:
// [TITLE] - scoped custom-color value update
// [TITLE] - scoped custom-color add/remove payload construction
// [TITLE] - custom-color status badge feedback
// [DEV] Complex Flow:
// [DEV] Keep custom family color mutations out of the broad brand action event
// [DEV] delegate so palette payload construction can be tested independently.

function createPaletteBrandCustomColorActionsRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const PALETTE_ALL_FIXTURES_VALUE = String(deps.PALETTE_ALL_FIXTURES_VALUE || "__all__");
  const normalizePaletteBrandUi = typeof deps.normalizePaletteBrandUi === "function"
    ? deps.normalizePaletteBrandUi
    : (value => String(value || "").trim().toLowerCase());
  const parsePaletteRgbColorTokenUi = typeof deps.parsePaletteRgbColorTokenUi === "function"
    ? deps.parsePaletteRgbColorTokenUi
    : (() => null);
  const getPaletteBrandScopePatchUi = typeof deps.getPaletteBrandScopePatchUi === "function"
    ? deps.getPaletteBrandScopePatchUi
    : (() => null);
  const getPaletteScopedConfigUi = typeof deps.getPaletteScopedConfigUi === "function"
    ? deps.getPaletteScopedConfigUi
    : (() => ({}));
  const normalizePaletteCustomFamilyColorsUi = typeof deps.normalizePaletteCustomFamilyColorsUi === "function"
    ? deps.normalizePaletteCustomFamilyColorsUi
    : (value => Array.isArray(value) ? value : []);
  const applyPalettePatch = typeof deps.applyPalettePatch === "function"
    ? deps.applyPalettePatch
    : (async () => false);
  const clampNumber = typeof deps.clampNumber === "function"
    ? deps.clampNumber
    : ((value, min, max, fallback = min) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, n));
    });
  const setBadge = typeof deps.setBadge === "function" ? deps.setBadge : (() => {});

  function getScopedCustomColors(brand = "") {
    const scopePatch = getPaletteBrandScopePatchUi(brand);
    if (!scopePatch) return null;
    const selectedFixture = scopePatch.fixtureId || PALETTE_ALL_FIXTURES_VALUE;
    const currentConfig = getPaletteScopedConfigUi(brand, selectedFixture);
    const currentColors = normalizePaletteCustomFamilyColorsUi(
      currentConfig.customFamilyColors,
      ui.paletteCustomFamilyColors
    );
    return {
      scopePatch,
      currentColors
    };
  }

  async function updatePaletteBrandCustomColorUi(inputNode) {
    if (!inputNode) return false;
    const brand = normalizePaletteBrandUi(inputNode.dataset?.paletteBrandCustomColorValue);
    if (!brand) return false;
    const index = Math.round(Number(inputNode.dataset?.colorIndex));
    if (!Number.isFinite(index) || index < 0) return false;
    const parsed = parsePaletteRgbColorTokenUi(inputNode.value);
    if (!parsed) return false;
    const scoped = getScopedCustomColors(brand);
    if (!scoped) return false;
    if (!Object.prototype.hasOwnProperty.call(scoped.currentColors, index)) return false;
    const nextColors = scoped.currentColors.slice();
    nextColors[index] = parsed;
    const ok = await applyPalettePatch(
      { ...scoped.scopePatch, customFamilyColors: nextColors },
      `${brand.toUpperCase()} CUSTOM COLORS`
    );
    if (ok) {
      setBadge(el.health, "ok", `${brand.toUpperCase()} CUSTOM COLOR ${index + 1} UPDATED`);
    }
    return ok === true;
  }

  async function addPaletteBrandCustomColorUi(buttonNode) {
    if (!buttonNode) return false;
    const brand = normalizePaletteBrandUi(buttonNode.dataset?.paletteBrandCustomColorAdd);
    if (!brand) return false;
    const scoped = getScopedCustomColors(brand);
    if (!scoped) return false;
    const seed = scoped.currentColors[scoped.currentColors.length - 1] || { r: 255, g: 255, b: 255 };
    const nextColors = scoped.currentColors.concat([{
      r: clampNumber(Number(seed?.r) + 8, 0, 255, 255),
      g: clampNumber(Number(seed?.g) + 8, 0, 255, 255),
      b: clampNumber(Number(seed?.b) + 8, 0, 255, 255)
    }]);
    const ok = await applyPalettePatch(
      { ...scoped.scopePatch, customFamilyColors: nextColors },
      `${brand.toUpperCase()} CUSTOM COLORS`
    );
    if (ok) {
      setBadge(el.health, "ok", `${brand.toUpperCase()} CUSTOM COLOR ADDED`);
    }
    return ok === true;
  }

  async function removePaletteBrandCustomColorUi(buttonNode) {
    if (!buttonNode) return false;
    const brand = normalizePaletteBrandUi(buttonNode.dataset?.paletteBrandCustomColorRemove);
    if (!brand) return false;
    const index = Math.round(Number(buttonNode.dataset?.colorIndex));
    if (!Number.isFinite(index) || index < 0) return false;
    const scoped = getScopedCustomColors(brand);
    if (!scoped) return false;
    if (scoped.currentColors.length <= 1) {
      setBadge(el.health, "warn", `${brand.toUpperCase()} CUSTOM FAMILY REQUIRES AT LEAST 1 COLOR`);
      return false;
    }
    const nextColors = scoped.currentColors.filter((_color, idx) => idx !== index);
    const ok = await applyPalettePatch(
      { ...scoped.scopePatch, customFamilyColors: nextColors },
      `${brand.toUpperCase()} CUSTOM COLORS`
    );
    if (ok) {
      setBadge(el.health, "ok", `${brand.toUpperCase()} CUSTOM COLOR REMOVED`);
    }
    return ok === true;
  }

  return {
    addPaletteBrandCustomColorUi,
    removePaletteBrandCustomColorUi,
    updatePaletteBrandCustomColorUi
  };
}

