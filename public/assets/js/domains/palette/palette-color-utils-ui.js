// [TITLE] Module: public/assets/js/domains/palette/palette-color-utils-ui.js
// [TITLE] Purpose: pure palette swatch/vividness/color-space helpers for palette UI
// [TITLE] Functionality Index:
// [TITLE] - swatch style generation
// [TITLE] - rgb/hsv conversion helpers
// [TITLE] - vividness profile + vividness color tuning
// [TITLE] - rgb to hex conversion
// [DEV] Complex Flow:
// [DEV] Palette rendering, custom color editing, and vividness preview all share
// [DEV] the same color math. Keep that math in one pure factory so palette.js owns
// [DEV] runtime state/events while this file owns deterministic color transforms.
(function attachPaletteColorUtilsUi(global) {
  "use strict";

  function fallbackClampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return Number(fallback);
    return Math.min(Number(max), Math.max(Number(min), parsed));
  }

  global.createPaletteColorUtilsUi = function createPaletteColorUtilsUi(deps = {}) {
    const clampNumber = typeof deps.clampNumber === "function"
      ? deps.clampNumber
      : fallbackClampNumber;
    const normalizePaletteVividnessUi = typeof deps.normalizePaletteVividnessUi === "function"
      ? deps.normalizePaletteVividnessUi
      : (value => fallbackClampNumber(Number(value), 0, 4, 2));

    function buildPaletteColorSwatchStyleUi(color = {}) {
      const r = clampNumber(Math.round(Number(color?.r) || 0), 0, 255, 0);
      const g = clampNumber(Math.round(Number(color?.g) || 0), 0, 255, 0);
      const b = clampNumber(Math.round(Number(color?.b) || 0), 0, 255, 0);
      const luma = ((r * 299) + (g * 587) + (b * 114)) / 1000;
      const text = luma >= 150 ? "#0a0f1d" : "#f5f8ff";
      const border = luma >= 150 ? "rgba(10,15,29,0.52)" : "rgba(255,255,255,0.42)";
      return `background:rgb(${r},${g},${b});color:${text};border-color:${border};`;
    }

    function rgbToHsvUi(color = {}) {
      const r = clampNumber(Math.round(Number(color?.r) || 0), 0, 255, 0) / 255;
      const g = clampNumber(Math.round(Number(color?.g) || 0), 0, 255, 0) / 255;
      const b = clampNumber(Math.round(Number(color?.b) || 0), 0, 255, 0) / 255;
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
      const s = max <= 0 ? 0 : (delta / max);
      const v = max;
      return { h, s, v };
    }

    function hsvToRgbUi(h = 0, s = 0, v = 0) {
      const hh = ((Number(h) % 360) + 360) % 360;
      const sat = clampNumber(Number(s), 0, 1, 0);
      const val = clampNumber(Number(v), 0, 1, 0);
      const c = val * sat;
      const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
      const m = val - c;
      let rp = 0;
      let gp = 0;
      let bp = 0;
      if (hh < 60) {
        rp = c;
        gp = x;
      } else if (hh < 120) {
        rp = x;
        gp = c;
      } else if (hh < 180) {
        gp = c;
        bp = x;
      } else if (hh < 240) {
        gp = x;
        bp = c;
      } else if (hh < 300) {
        rp = x;
        bp = c;
      } else {
        rp = c;
        bp = x;
      }
      return {
        r: clampNumber(Math.round((rp + m) * 255), 0, 255, 0),
        g: clampNumber(Math.round((gp + m) * 255), 0, 255, 0),
        b: clampNumber(Math.round((bp + m) * 255), 0, 255, 0)
      };
    }

    function resolvePaletteVividnessProfileUi(level = 2) {
      const vividness = normalizePaletteVividnessUi(level, 2);
      const satBoostScaleByLevel = [0.72, 0.9, 1, 1.16, 1.32];
      const satBoostAddByLevel = [0, 0.03, 0.08, 0.14, 0.2];
      const minSatDeltaByLevel = [-0.12, -0.06, 0, 0.05, 0.1];
      const minValueDeltaByLevel = [-0.04, -0.01, 0, 0.03, 0.06];
      return {
        vividness,
        satBoostScale: satBoostScaleByLevel[vividness],
        satBoostAdd: satBoostAddByLevel[vividness],
        minSatDelta: minSatDeltaByLevel[vividness],
        minValueDelta: minValueDeltaByLevel[vividness]
      };
    }

    function applyPaletteVividnessToColorUi(color = {}, vividnessLevel = 2) {
      const safe = {
        r: clampNumber(Math.round(Number(color?.r) || 0), 0, 255, 0),
        g: clampNumber(Math.round(Number(color?.g) || 0), 0, 255, 0),
        b: clampNumber(Math.round(Number(color?.b) || 0), 0, 255, 0)
      };
      const hsv = rgbToHsvUi(safe);
      if (hsv.s < 0.06) return safe;
      const profile = resolvePaletteVividnessProfileUi(vividnessLevel);
      const satBoost = clampNumber((0.69 * profile.satBoostScale) + profile.satBoostAdd, 0, 1, 0.69);
      const minSat = clampNumber(0.84 + profile.minSatDelta, 0, 1, 0.84);
      const minValue = clampNumber(0.18 + profile.minValueDelta, 0, 1, 0.18);
      const tunedSat = clampNumber(hsv.s + ((1 - hsv.s) * satBoost), minSat, 1, minSat);
      const tunedValue = clampNumber(Math.max(hsv.v, minValue), minValue, 1, minValue);
      return hsvToRgbUi(hsv.h, tunedSat, tunedValue);
    }

    function paletteRgbToHexUi(color = {}) {
      const r = clampNumber(Math.round(Number(color?.r) || 0), 0, 255, 0).toString(16).padStart(2, "0");
      const g = clampNumber(Math.round(Number(color?.g) || 0), 0, 255, 0).toString(16).padStart(2, "0");
      const b = clampNumber(Math.round(Number(color?.b) || 0), 0, 255, 0).toString(16).padStart(2, "0");
      return `#${r}${g}${b}`;
    }

    return {
      buildPaletteColorSwatchStyleUi,
      rgbToHsvUi,
      hsvToRgbUi,
      resolvePaletteVividnessProfileUi,
      applyPaletteVividnessToColorUi,
      paletteRgbToHexUi
    };
  };
})(window);
