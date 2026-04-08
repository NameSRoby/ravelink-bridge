// [TITLE] Module: public/assets/js/domains/contracts/audio-domain.adapter.js
// [TITLE] Purpose: typed audio payload contract adapter for runtime-safe normalization
// [TITLE] Functionality Index:
// [TITLE] - audio telemetry payload normalization
// [TITLE] - audio reactivity map contract normalization
// [DEV] Complex Flow:
// [DEV] This adapter does not own transport routes. It normalizes payload shape so
// [DEV] consumers can evolve without repeatedly patching monolith runtime files.

/**
 * @typedef {Object} AudioTelemetryContract
 * @property {number} level
 * @property {number} transient
 * @property {number} spectralFlux
 * @property {number} bandLow
 * @property {number} bandMid
 * @property {number} bandHigh
 * @property {number} energy
 * @property {number} audioRms
 * @property {number} audioSourceLevel
 * @property {number} bpm
 * @property {Object|null} config
 */

/**
 * @typedef {Object} AudioReactivityMapContract
 * @property {string} reactivityGainMode
 * @property {number} reactivityGain
 * @property {boolean} hardwareRateLimitsEnabled
 * @property {{hue:Object, wiz:Object, other:Object}} targets
 * @property {{baseline:boolean, peaks:boolean, transients:boolean, flux:boolean}} metaAutoTempoTrackers
 */

function normalizeNumberAudioDomain(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number(fallback) || 0;
}

function normalizeBooleanAudioDomain(value, fallback = false) {
  if (value === true || value === false) return value;
  return fallback === true;
}

/**
 * @param {any} payload
 * @returns {AudioTelemetryContract}
 */
function normalizeAudioTelemetryContract(payload = null) {
  const source = payload && typeof payload === "object" ? payload : {};
  const level = normalizeNumberAudioDomain(
    source.level ?? source.audioSourceLevel ?? source.audioRms ?? source.rms,
    0.03
  );
  const transient = normalizeNumberAudioDomain(source.transient ?? source.audioTransient, 0);
  const spectralFlux = normalizeNumberAudioDomain(source.spectralFlux ?? source.audioFlux, 0);
  const bandLow = normalizeNumberAudioDomain(source.bandLow ?? source.audioBandLow, level);
  const bandMid = normalizeNumberAudioDomain(source.bandMid ?? source.audioBandMid, level * 0.9);
  const bandHigh = normalizeNumberAudioDomain(source.bandHigh ?? source.audioBandHigh, level * 0.8);
  const energy = normalizeNumberAudioDomain(source.energy, 0.05);
  const audioRms = normalizeNumberAudioDomain(source.audioRms ?? source.rms ?? level, level);
  const audioSourceLevel = normalizeNumberAudioDomain(source.audioSourceLevel ?? level, level);
  const bpm = normalizeNumberAudioDomain(source.bpm, 0);
  const config = source.config && typeof source.config === "object" ? source.config : null;
  return {
    ...source,
    level,
    transient,
    spectralFlux,
    bandLow,
    bandMid,
    bandHigh,
    energy,
    audioRms,
    audioSourceLevel,
    bpm,
    config
  };
}

function normalizeReactivityTargetContract(target = null) {
  const source = target && typeof target === "object" ? target : {};
  const amount = normalizeNumberAudioDomain(source.amount, 1);
  return {
    ...source,
    enabled: normalizeBooleanAudioDomain(source.enabled, true),
    amount: Number.isFinite(amount) ? amount : 1,
    sources: Array.isArray(source.sources)
      ? source.sources.map(value => String(value || "").trim()).filter(Boolean)
      : []
  };
}

/**
 * @param {any} payload
 * @returns {AudioReactivityMapContract}
 */
function normalizeAudioReactivityMapContract(payload = null) {
  const source = payload && typeof payload === "object" ? payload : {};
  const trackers = source.metaAutoTempoTrackers && typeof source.metaAutoTempoTrackers === "object"
    ? source.metaAutoTempoTrackers
    : {};
  return {
    ...source,
    reactivityGainMode: String(source.reactivityGainMode || "auto").trim().toLowerCase() || "auto",
    reactivityGain: normalizeNumberAudioDomain(source.reactivityGain, 1),
    hardwareRateLimitsEnabled: normalizeBooleanAudioDomain(source.hardwareRateLimitsEnabled, false),
    targets: {
      hue: normalizeReactivityTargetContract(source.targets?.hue),
      wiz: normalizeReactivityTargetContract(source.targets?.wiz),
      other: normalizeReactivityTargetContract(source.targets?.other)
    },
    metaAutoTempoTrackers: {
      baseline: normalizeBooleanAudioDomain(trackers.baseline, true),
      peaks: normalizeBooleanAudioDomain(trackers.peaks, true),
      transients: normalizeBooleanAudioDomain(trackers.transients, true),
      flux: normalizeBooleanAudioDomain(trackers.flux, true)
    }
  };
}

/** @type {{normalizeAudioTelemetryContract: (payload:any)=>AudioTelemetryContract, normalizeAudioReactivityMapContract: (payload:any)=>AudioReactivityMapContract}} */
const audioDomainAdapter = Object.freeze({
  normalizeAudioTelemetryContract,
  normalizeAudioReactivityMapContract
});

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizeAudioTelemetryContract,
    normalizeAudioReactivityMapContract,
    audioDomainAdapter
  };
}
