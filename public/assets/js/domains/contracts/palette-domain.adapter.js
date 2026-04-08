// [TITLE] Module: public/assets/js/domains/contracts/palette-domain.adapter.js
// [TITLE] Purpose: typed palette payload contract adapter for runtime-safe normalization
// [TITLE] Functionality Index:
// [TITLE] - palette telemetry payload normalization
// [TITLE] - palette family token normalization
// [DEV] Complex Flow:
// [DEV] This adapter keeps scene/palette telemetry fields consistent so consumers can
// [DEV] read stable keys even as backend payloads evolve.

/**
 * @typedef {Object} PaletteTelemetryContract
 * @property {boolean} ok
 * @property {boolean} active
 * @property {boolean} running
 * @property {string} scene
 * @property {string} behavior
 * @property {string} phrase
 * @property {boolean} drop
 * @property {number} energy
 * @property {number} bpm
 * @property {number} flowIntensity
 * @property {string} paletteBrightnessSceneActive
 */

function normalizeNumberPaletteDomain(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number(fallback) || 0;
}

function normalizeBooleanPaletteDomain(value, fallback = false) {
  if (value === true || value === false) return value;
  return fallback === true;
}

function normalizeTokenPaletteDomain(value, fallback = "") {
  const token = String(value || "").trim().toLowerCase();
  return token || String(fallback || "").trim().toLowerCase();
}

/**
 * @param {any} payload
 * @returns {PaletteTelemetryContract}
 */
function normalizePaletteTelemetryContract(payload = null) {
  const source = payload && typeof payload === "object" ? payload : {};
  return {
    ...source,
    ok: normalizeBooleanPaletteDomain(source.ok, true),
    active: normalizeBooleanPaletteDomain(source.active ?? source.running, false),
    running: normalizeBooleanPaletteDomain(source.running ?? source.active, false),
    scene: String(source.scene || "-"),
    behavior: String(source.behavior || "-"),
    phrase: String(source.phrase || "-"),
    drop: normalizeBooleanPaletteDomain(source.drop, false),
    energy: normalizeNumberPaletteDomain(source.energy, 0.05),
    bpm: normalizeNumberPaletteDomain(source.bpm, 0),
    flowIntensity: normalizeNumberPaletteDomain(source.flowIntensity, 1),
    paletteBrightnessSceneActive: normalizeTokenPaletteDomain(
      source.paletteBrightnessSceneActive,
      ""
    )
  };
}

/** @type {{normalizePaletteTelemetryContract: (payload:any)=>PaletteTelemetryContract}} */
const paletteDomainAdapter = Object.freeze({
  normalizePaletteTelemetryContract
});

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizePaletteTelemetryContract,
    paletteDomainAdapter
  };
}
