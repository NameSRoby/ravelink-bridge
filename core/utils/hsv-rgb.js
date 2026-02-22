"use strict";

const HSV_SECTOR_COMPONENT_ORDER = Object.freeze([
  Object.freeze([0, 1, 2]),
  Object.freeze([1, 0, 2]),
  Object.freeze([2, 0, 1]),
  Object.freeze([2, 1, 0]),
  Object.freeze([1, 2, 0]),
  Object.freeze([0, 2, 1])
]);

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  const fallbackNumber = Number(fallback);
  return Number.isFinite(fallbackNumber) ? fallbackNumber : 0;
}

function clampUnit(value, fallback = 0) {
  const n = toFiniteNumber(value, fallback);
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function normalizeHueDegrees(hue, fallback = 0) {
  const n = toFiniteNumber(hue, fallback) % 360;
  return n < 0 ? n + 360 : n;
}

function hsvToRgbUnit(h, s = 1, v = 1, options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const hue = normalizeHueDegrees(h, opts.hFallback ?? 0);
  const sat = clampUnit(s, opts.sFallback ?? 0);
  const val = clampUnit(v, opts.vFallback ?? 0);

  const chroma = val * sat;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = val - chroma;

  const componentPool = [chroma, secondary, 0];
  const sector = Math.floor(hue / 60) % 6;
  const order = HSV_SECTOR_COMPONENT_ORDER[sector];

  return {
    r: componentPool[order[0]] + match,
    g: componentPool[order[1]] + match,
    b: componentPool[order[2]] + match
  };
}

function toRgb255Channel(value) {
  const channel = Math.round(toFiniteNumber(value, 0) * 255);
  if (channel <= 0) return 0;
  if (channel >= 255) return 255;
  return channel;
}

function hsvToRgb255(h, s = 1, v = 1, options = {}) {
  const rgb = hsvToRgbUnit(h, s, v, options);
  return {
    r: toRgb255Channel(rgb.r),
    g: toRgb255Channel(rgb.g),
    b: toRgb255Channel(rgb.b)
  };
}

module.exports = {
  hsvToRgbUnit,
  hsvToRgb255
};
