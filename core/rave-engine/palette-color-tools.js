"use strict";

const WIZ_DISTINCT_COLOR_ANCHORS = Object.freeze([
  Object.freeze({ r: 255, g: 40, b: 50 }), // red
  Object.freeze({ r: 30, g: 220, b: 255 }), // cyan
  Object.freeze({ r: 150, g: 70, b: 255 }), // violet
  Object.freeze({ r: 75, g: 255, b: 90 }), // green
  Object.freeze({ r: 255, g: 175, b: 30 }), // amber
  Object.freeze({ r: 255, g: 80, b: 190 }) // magenta
]);

function createRavePaletteColorTools(options = {}) {
  const clamp = typeof options.clamp === "function"
    ? options.clamp
    : ((v, min, max) => Math.min(max, Math.max(min, Number(v) || 0)));
  const clamp255 = typeof options.clamp255 === "function"
    ? options.clamp255
    : (v => Math.round(clamp(v, 0, 255)));
  const rgbToHsv = typeof options.rgbToHsv === "function"
    ? options.rgbToHsv
    : (() => ({ h: 0, s: 0, v: 0 }));
  const hsvToRgb255 = typeof options.hsvToRgb255 === "function"
    ? options.hsvToRgb255
    : ((h, s, v) => ({ r: 0, g: 0, b: 0, h, s, v }));

  const hueDistanceDeg = (a, b) => {
    const aa = ((Number(a) || 0) % 360 + 360) % 360;
    const bb = ((Number(b) || 0) % 360 + 360) % 360;
    const delta = Math.abs(aa - bb);
    return delta > 180 ? 360 - delta : delta;
  };

  const rgbDistance = (a = {}, b = {}) => {
    const dr = clamp255(a?.r) - clamp255(b?.r);
    const dg = clamp255(a?.g) - clamp255(b?.g);
    const db = clamp255(a?.b) - clamp255(b?.b);
    return Math.sqrt((dr * dr) + (dg * dg) + (db * db));
  };

  const normalizeWizDistinctPalette = (colors = [], targetLength = 3) => {
    const src = Array.isArray(colors) ? colors : [];
    const required = Math.max(1, Math.min(6, Math.round(Number(targetLength) || 3)));
    const minRgbDistance = 104;
    const minHueDistance = 56;
    const minSatDistance = 0.08;
    const minValueDistance = 0.1;
    const out = [];

    const tryAdd = color => {
      const candidate = {
        r: clamp255(color?.r),
        g: clamp255(color?.g),
        b: clamp255(color?.b)
      };
      const candidateHsv = rgbToHsv(candidate);
      if (out.length === 0) {
        out.push(candidate);
        return;
      }
      for (const existing of out) {
        const existingHsv = rgbToHsv(existing);
        const hueDelta = hueDistanceDeg(candidateHsv.h, existingHsv.h);
        const satDelta = Math.abs(candidateHsv.s - existingHsv.s);
        const valueDelta = Math.abs(candidateHsv.v - existingHsv.v);
        const rgbDelta = rgbDistance(candidate, existing);
        const brightnessOnlyVariant =
          hueDelta < 20 &&
          satDelta < minSatDistance &&
          valueDelta >= minValueDistance;
        const tooCloseHueCluster =
          hueDelta < minHueDistance &&
          (rgbDelta < minRgbDistance || satDelta < minSatDistance);
        if (brightnessOnlyVariant || tooCloseHueCluster) return;
      }
      out.push(candidate);
    };

    for (const color of src) {
      tryAdd(color);
      if (out.length >= required) break;
    }
    for (const anchor of WIZ_DISTINCT_COLOR_ANCHORS) {
      tryAdd(anchor);
      if (out.length >= required) break;
    }
    while (out.length < required) {
      out.push({ ...WIZ_DISTINCT_COLOR_ANCHORS[out.length % WIZ_DISTINCT_COLOR_ANCHORS.length] });
    }
    return out.slice(0, required);
  };

  const normalizeWizContrastPalette = (colors = [], optionsInput = {}) => {
    const src = Array.isArray(colors) ? colors : [];
    const options = optionsInput && typeof optionsInput === "object" ? optionsInput : {};
    const targetLength = Math.max(1, Math.min(6, Math.round(Number(options.targetLength) || src.length || 3)));
    const minSaturation = clamp(Number(options.minSaturation) || 0.9, 0.75, 1);
    const minValue = clamp(Number(options.minValue) || 0.3, 0.12, 0.9);
    const maxValue = clamp(Number(options.maxValue) || 0.98, minValue, 1);
    const valueSwing = clamp(Number(options.valueSwing) || 0.2, 0, 0.36);
    const boosted = [];

    for (let i = 0; i < src.length; i += 1) {
      const color = src[i];
      const hsv = rgbToHsv(color);
      const sat = Math.max(hsv.s, minSaturation);
      const phase = (i % 2 === 0) ? 1 : -1;
      const valBase = Math.max(hsv.v, minValue);
      const val = clamp(valBase + (phase * valueSwing * 0.5), minValue, maxValue);
      boosted.push(hsvToRgb255(hsv.h, sat, val));
    }

    return normalizeWizDistinctPalette(
      boosted.length ? boosted : src,
      targetLength
    );
  };

  const reorderPaletteForContrast = (colors = [], preserveFirst = true) => {
    const src = Array.isArray(colors)
      ? colors.map(color => ({
        r: clamp255(color?.r),
        g: clamp255(color?.g),
        b: clamp255(color?.b)
      }))
      : [];
    if (src.length <= 2) return src;

    const out = [];
    const used = new Set();
    let currentIndex = preserveFirst ? 0 : 0;
    while (out.length < src.length) {
      out.push(src[currentIndex]);
      used.add(currentIndex);
      if (out.length >= src.length) break;

      const current = src[currentIndex];
      const currentHsv = rgbToHsv(current);
      let nextIndex = -1;
      let nextScore = -1;
      for (let i = 0; i < src.length; i += 1) {
        if (used.has(i)) continue;
        const candidate = src[i];
        const candidateHsv = rgbToHsv(candidate);
        const score =
          (hueDistanceDeg(currentHsv.h, candidateHsv.h) * 2.4) +
          (rgbDistance(current, candidate) * 0.34) +
          (Math.abs(currentHsv.s - candidateHsv.s) * 42) +
          (Math.abs(currentHsv.v - candidateHsv.v) * 36);
        if (score > nextScore) {
          nextScore = score;
          nextIndex = i;
        }
      }
      currentIndex = nextIndex >= 0 ? nextIndex : src.findIndex((_, idx) => !used.has(idx));
      if (currentIndex < 0) break;
    }
    return out.length ? out : src;
  };

  const tuneWizManualPalette = (colors = [], optionsInput = {}) => {
    const src = Array.isArray(colors) ? colors : [];
    const options = optionsInput && typeof optionsInput === "object" ? optionsInput : {};
    const pulseScene = options?.pulseScene === true;
    if (!src.length) return [];
    const tuned = [];
    for (let i = 0; i < src.length; i += 1) {
      const hsv = rgbToHsv(src[i]);
      const satFloor = pulseScene ? 0.95 : 0.92;
      const valueFloor = pulseScene ? 0.44 : 0.3;
      const phase = (i % 2 === 0) ? 1 : -1;
      const valueSwing = pulseScene ? 0.11 : 0.09;
      tuned.push(hsvToRgb255(
        hsv.h,
        Math.max(hsv.s, satFloor),
        clamp(Math.max(hsv.v, valueFloor) + (phase * valueSwing), valueFloor, 1)
      ));
    }
    return tuned;
  };

  const enforceMinSaturation = (color = {}, minSat = 0.88, minValue = 0.2) => {
    const hsv = rgbToHsv(color);
    return hsvToRgb255(
      hsv.h,
      Math.max(hsv.s, clamp(Number(minSat) || 0, 0, 1)),
      Math.max(hsv.v, clamp(Number(minValue) || 0, 0, 1))
    );
  };

  const boostColorSaturation = (color = {}, amount = 0) => {
    const r = clamp255(color?.r);
    const g = clamp255(color?.g);
    const b = clamp255(color?.b);
    const boost = clamp(Number(amount) || 0, 0, 1);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (boost <= 0 || max <= 0 || max - min < 1) {
      return { r, g, b };
    }

    const sat = (max - min) / max;
    const targetSat = clamp(sat + ((1 - sat) * boost), sat, 1);
    const targetMin = max * (1 - targetSat);
    const spread = max - min;
    const gain = spread > 0 ? (max - targetMin) / spread : 1;
    const boosted = {
      r: clamp255(max - ((max - r) * gain)),
      g: clamp255(max - ((max - g) * gain)),
      b: clamp255(max - ((max - b) * gain))
    };
    if (boost <= 0.5) return boosted;

    const vivid = clamp((boost - 0.5) / 0.5, 0, 1);
    const luma =
      boosted.r * 0.2126 +
      boosted.g * 0.7152 +
      boosted.b * 0.0722;
    const chromaGain = 1 + (vivid * 1.28);
    const valueGain = 1 + (vivid * 0.24);

    return {
      r: clamp255((luma + ((boosted.r - luma) * chromaGain)) * valueGain),
      g: clamp255((luma + ((boosted.g - luma) * chromaGain)) * valueGain),
      b: clamp255((luma + ((boosted.b - luma) * chromaGain)) * valueGain)
    };
  };

  const tunePaletteVibrancy = (color = {}, optionsInput = {}) => {
    const options = optionsInput && typeof optionsInput === "object" ? optionsInput : {};
    const base = {
      r: clamp255(color?.r),
      g: clamp255(color?.g),
      b: clamp255(color?.b)
    };
    const baseHsv = rgbToHsv(base);
    const preserveNeutralBelow = clamp(Number(options.preserveNeutralBelow) || 0, 0, 0.3);
    if (baseHsv.s <= preserveNeutralBelow) {
      return base;
    }
    const satBoost = clamp(Number(options.satBoost) || 0, 0, 1);
    const minSat = clamp(Number(options.minSat) || 0, 0, 1);
    const minValue = clamp(Number(options.minValue) || 0, 0, 1);
    const maxValue = clamp(Number(options.maxValue) || 1, minValue, 1);
    const boosted = boostColorSaturation(base, satBoost);
    const hsv = rgbToHsv(boosted);
    return hsvToRgb255(
      hsv.h,
      Math.max(hsv.s, minSat),
      clamp(Math.max(hsv.v, minValue), minValue, maxValue)
    );
  };

  const tunePaletteArrayVibrancy = (palette = [], options = {}) => {
    const src = Array.isArray(palette) ? palette : [];
    const softEvery = Math.max(0, Math.round(Number(options.softEvery) || 0));
    return src.map((color, index) => {
      const softTone = softEvery > 0 && ((index + 1) % softEvery === 0);
      return tunePaletteVibrancy(color, {
        satBoost: softTone ? options.softSatBoost : options.satBoost,
        minSat: softTone ? options.softMinSat : options.minSat,
        minValue: softTone ? options.softMinValue : options.minValue,
        maxValue: options.maxValue,
        preserveNeutralBelow: options.preserveNeutralBelow
      });
    });
  };

  return {
    normalizeWizDistinctPalette,
    normalizeWizContrastPalette,
    reorderPaletteForContrast,
    tuneWizManualPalette,
    enforceMinSaturation,
    boostColorSaturation,
    tunePaletteVibrancy,
    tunePaletteArrayVibrancy
  };
}

module.exports = {
  createRavePaletteColorTools
};
