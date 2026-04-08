// [TITLE] Module: domains/engine-v2/engine.scene-runtime-controls.js
// [TITLE] Purpose: normalize Engine v2 scene runtime controls from LIVE profile payloads
// [TITLE] Functionality Index:
// [TITLE] - normalize scene lock aliases and aggressiveness filters
// [TITLE] - normalize global runtime tuning and scoped brand/fixture overrides
// [TITLE] - extract stable scene/runtime controls from LIVE trigger-matrix payloads
// [DEV] This helper stays stateless so scene-state compute can focus on tempo,
// [DEV] scene selection, cooldown, and brightness envelopes.

const {
  clampNumber
} = require("./engine.contracts");

const SCENE_LOCK_TOKENS = new Set(["auto", "steady", "motion", "impact"]);
const BPM_SOURCE_MODES = new Set(["hybrid", "telemetry", "derived"]);

const DEFAULT_SCENE_AGGRESSIVENESS = Object.freeze({
  calm: 1,
  groove: 1,
  impact: 1
});

const DEFAULT_RUNTIME_TUNING = Object.freeze({
  bpmSourceMode: "hybrid",
  sceneSwitchCooldownMs: 260,
  impactHoldMs: 140,
  brightnessFloor: 0.02,
  brightnessCeil: 1,
  transitionFloorMs: 32,
  transitionCeilMs: 190,
  brightnessAttack: 0.84,
  brightnessRelease: 0.42,
  brightnessContrast: 1.22,
  brightnessTransientBoost: 0.58,
  brightnessFluxBoost: 0.34,
  brightnessBeatBoost: 0.2,
  brightnessDynamicsBoost: 0.52,
  brightnessSilenceCutoff: 0.1,
  brightnessSilenceSuppress: 0.04,
  loudnessFloorAttack: 0.32,
  loudnessFloorRelease: 0.02,
  loudnessCeilAttack: 0.26,
  loudnessCeilRelease: 0.016,
  loudnessAdaptiveMinSpan: 0.1,
  transitionSmoothingAttack: 0.4,
  transitionSmoothingRelease: 0.3,
  brightnessDriverFloorAttack: 0.32,
  brightnessDriverFloorRelease: 0.014,
  brightnessDriverCeilAttack: 0.24,
  brightnessDriverCeilRelease: 0.012,
  brightnessDynamicMinSpan: 0.09,
  brightnessDeltaFloorStep: 0.024,
  brightnessDeltaMotionStep: 0.18,
  brightnessDeltaBeatBoost: 0.09,
  telemetryBeatConfidenceMin: 0.34,
  derivedBeatMinIntervalMs: 120,
  derivedBeatMaxIntervalMs: 1600
});

const SCOPED_RUNTIME_BRANDS = Object.freeze(["hue", "wiz"]);

function normalizeSceneLock(value, fallback = "auto") {
  const token = String(value || "").trim().toLowerCase();
  if (!token) return fallback;
  if (token === "idle" || token === "calm" || token === "scene_idle") return "steady";
  if (token === "flow" || token === "groove" || token === "scene_flow") return "motion";
  if (token === "pulse" || token === "scene_pulse") return "impact";
  return SCENE_LOCK_TOKENS.has(token) ? token : fallback;
}

function normalizeBpmSourceMode(value, fallback = DEFAULT_RUNTIME_TUNING.bpmSourceMode) {
  const token = String(value || "").trim().toLowerCase();
  return BPM_SOURCE_MODES.has(token) ? token : String(fallback || DEFAULT_RUNTIME_TUNING.bpmSourceMode);
}

function normalizeSceneAggressiveness(raw = {}, fallback = DEFAULT_SCENE_AGGRESSIVENESS) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const fb = fallback && typeof fallback === "object" && !Array.isArray(fallback)
    ? fallback
    : DEFAULT_SCENE_AGGRESSIVENESS;
  return {
    calm: clampNumber(source.calm, 0.45, 2.25, fb.calm),
    groove: clampNumber(source.groove, 0.45, 2.25, fb.groove),
    impact: clampNumber(source.impact, 0.45, 2.25, fb.impact)
  };
}

function normalizeRuntimeTuning(raw = {}, fallback = DEFAULT_RUNTIME_TUNING) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const fb = fallback && typeof fallback === "object" && !Array.isArray(fallback)
    ? fallback
    : DEFAULT_RUNTIME_TUNING;
  const brightnessFloor = clampNumber(source.brightnessFloor, 0, 0.9, fb.brightnessFloor);
  const brightnessCeil = clampNumber(source.brightnessCeil, brightnessFloor, 1, fb.brightnessCeil);
  const transitionFloorMs = clampNumber(source.transitionFloorMs, 20, 5000, fb.transitionFloorMs);
  const transitionCeilMs = clampNumber(source.transitionCeilMs, transitionFloorMs, 60000, fb.transitionCeilMs);
  return {
    bpmSourceMode: normalizeBpmSourceMode(source.bpmSourceMode, fb.bpmSourceMode),
    sceneSwitchCooldownMs: clampNumber(source.sceneSwitchCooldownMs, 0, 10000, fb.sceneSwitchCooldownMs),
    impactHoldMs: clampNumber(source.impactHoldMs, 0, 5000, fb.impactHoldMs),
    brightnessFloor,
    brightnessCeil,
    transitionFloorMs,
    transitionCeilMs,
    brightnessAttack: clampNumber(source.brightnessAttack, 0.05, 0.95, fb.brightnessAttack),
    brightnessRelease: clampNumber(source.brightnessRelease, 0.05, 0.95, fb.brightnessRelease),
    brightnessContrast: clampNumber(source.brightnessContrast, 0.6, 2.2, fb.brightnessContrast),
    brightnessTransientBoost: clampNumber(source.brightnessTransientBoost, 0, 1.5, fb.brightnessTransientBoost),
    brightnessFluxBoost: clampNumber(source.brightnessFluxBoost, 0, 1.2, fb.brightnessFluxBoost),
    brightnessBeatBoost: clampNumber(source.brightnessBeatBoost, 0, 1, fb.brightnessBeatBoost),
    brightnessDynamicsBoost: clampNumber(source.brightnessDynamicsBoost, 0, 1.5, fb.brightnessDynamicsBoost),
    brightnessSilenceCutoff: clampNumber(source.brightnessSilenceCutoff, 0, 0.5, fb.brightnessSilenceCutoff),
    brightnessSilenceSuppress: clampNumber(source.brightnessSilenceSuppress, 0, 1, fb.brightnessSilenceSuppress),
    loudnessFloorAttack: clampNumber(source.loudnessFloorAttack, 0.05, 0.95, fb.loudnessFloorAttack),
    loudnessFloorRelease: clampNumber(source.loudnessFloorRelease, 0.005, 0.25, fb.loudnessFloorRelease),
    loudnessCeilAttack: clampNumber(source.loudnessCeilAttack, 0.05, 0.95, fb.loudnessCeilAttack),
    loudnessCeilRelease: clampNumber(source.loudnessCeilRelease, 0.005, 0.25, fb.loudnessCeilRelease),
    loudnessAdaptiveMinSpan: clampNumber(source.loudnessAdaptiveMinSpan, 0.04, 0.5, fb.loudnessAdaptiveMinSpan),
    transitionSmoothingAttack: clampNumber(source.transitionSmoothingAttack, 0.05, 0.95, fb.transitionSmoothingAttack),
    transitionSmoothingRelease: clampNumber(source.transitionSmoothingRelease, 0.05, 0.95, fb.transitionSmoothingRelease),
    brightnessDriverFloorAttack: clampNumber(
      source.brightnessDriverFloorAttack,
      0.05,
      0.95,
      fb.brightnessDriverFloorAttack
    ),
    brightnessDriverFloorRelease: clampNumber(
      source.brightnessDriverFloorRelease,
      0.002,
      0.4,
      fb.brightnessDriverFloorRelease
    ),
    brightnessDriverCeilAttack: clampNumber(
      source.brightnessDriverCeilAttack,
      0.05,
      0.95,
      fb.brightnessDriverCeilAttack
    ),
    brightnessDriverCeilRelease: clampNumber(
      source.brightnessDriverCeilRelease,
      0.002,
      0.4,
      fb.brightnessDriverCeilRelease
    ),
    brightnessDynamicMinSpan: clampNumber(
      source.brightnessDynamicMinSpan,
      0.04,
      0.6,
      fb.brightnessDynamicMinSpan
    ),
    brightnessDeltaFloorStep: clampNumber(
      source.brightnessDeltaFloorStep,
      0.005,
      0.2,
      fb.brightnessDeltaFloorStep
    ),
    brightnessDeltaMotionStep: clampNumber(
      source.brightnessDeltaMotionStep,
      0.01,
      0.4,
      fb.brightnessDeltaMotionStep
    ),
    brightnessDeltaBeatBoost: clampNumber(
      source.brightnessDeltaBeatBoost,
      0,
      0.3,
      fb.brightnessDeltaBeatBoost
    ),
    telemetryBeatConfidenceMin: clampNumber(
      source.telemetryBeatConfidenceMin,
      0,
      1,
      fb.telemetryBeatConfidenceMin
    ),
    derivedBeatMinIntervalMs: clampNumber(
      source.derivedBeatMinIntervalMs,
      120,
      1200,
      fb.derivedBeatMinIntervalMs
    ),
    derivedBeatMaxIntervalMs: clampNumber(
      source.derivedBeatMaxIntervalMs,
      300,
      5000,
      fb.derivedBeatMaxIntervalMs
    )
  };
}

function getProfilePayload(input = {}) {
  const profile = input?.profile && typeof input.profile === "object" ? input.profile : {};
  return profile.payload && typeof profile.payload === "object" && !Array.isArray(profile.payload)
    ? profile.payload
    : {};
}

function normalizeScopedRuntimeBrand(value, fallback = "") {
  const token = String(value || "").trim().toLowerCase();
  if (SCOPED_RUNTIME_BRANDS.includes(token)) return token;
  const fallbackToken = String(fallback || "").trim().toLowerCase();
  return SCOPED_RUNTIME_BRANDS.includes(fallbackToken) ? fallbackToken : "";
}

function normalizeScopedRuntimeFixtureId(value) {
  return String(value || "").trim();
}

function normalizeScopedRuntimeBrandOverrides(raw = {}, globalRuntime = DEFAULT_RUNTIME_TUNING) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const [rawBrand, row] of Object.entries(source)) {
    const rowMap = row && typeof row === "object" && !Array.isArray(row) ? row : {};
    const brand = normalizeScopedRuntimeBrand(rowMap.brand || rawBrand);
    if (!brand) continue;
    out[brand] = {
      brand,
      runtimeTuning: normalizeRuntimeTuning(rowMap.runtimeTuning, globalRuntime)
    };
  }
  return out;
}

function normalizeScopedRuntimeFixtureOverrides(raw = {}, brandOverrides = {}, globalRuntime = DEFAULT_RUNTIME_TUNING) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const [rawFixtureId, row] of Object.entries(source)) {
    const rowMap = row && typeof row === "object" && !Array.isArray(row) ? row : {};
    const fixtureId = normalizeScopedRuntimeFixtureId(rowMap.fixtureId || rawFixtureId);
    if (!fixtureId) continue;
    const brand = normalizeScopedRuntimeBrand(rowMap.brand);
    if (!brand) continue;
    const fallback = brandOverrides[brand]?.runtimeTuning || globalRuntime;
    out[fixtureId] = {
      fixtureId,
      brand,
      runtimeTuning: normalizeRuntimeTuning(rowMap.runtimeTuning, fallback)
    };
  }
  return out;
}

function extractLiveRuntimeControls(input = {}) {
  const payload = getProfilePayload(input);
  const compatibility = payload.compatibility && typeof payload.compatibility === "object"
    ? payload.compatibility
    : {};
  const triggerMatrix = payload.triggerMatrix && typeof payload.triggerMatrix === "object"
    ? payload.triggerMatrix
    : {};
  const global = triggerMatrix.global && typeof triggerMatrix.global === "object"
    ? triggerMatrix.global
    : {};
  const runtimeTuning = global.runtimeTuning && typeof global.runtimeTuning === "object"
    ? global.runtimeTuning
    : payload.runtimeTuning;
  const normalizedRuntimeTuning = normalizeRuntimeTuning(runtimeTuning, DEFAULT_RUNTIME_TUNING);
  const scopedRuntimeBrandOverrides = normalizeScopedRuntimeBrandOverrides(
    triggerMatrix.brands,
    normalizedRuntimeTuning
  );
  const scopedRuntimeFixtureOverrides = normalizeScopedRuntimeFixtureOverrides(
    triggerMatrix.fixtureOverrides,
    scopedRuntimeBrandOverrides,
    normalizedRuntimeTuning
  );
  return {
    sceneLock: normalizeSceneLock(
      compatibility.sceneLock || compatibility.sceneIntent || payload.sceneLock,
      "auto"
    ),
    sceneAggressiveness: normalizeSceneAggressiveness(
      global.sceneFilterAggressiveness || payload.sceneFilterAggressiveness,
      DEFAULT_SCENE_AGGRESSIVENESS
    ),
    runtimeTuning: normalizedRuntimeTuning,
    scopedRuntimeTuning: {
      brands: scopedRuntimeBrandOverrides,
      fixtureOverrides: scopedRuntimeFixtureOverrides
    }
  };
}

module.exports = {
  DEFAULT_RUNTIME_TUNING,
  DEFAULT_SCENE_AGGRESSIVENESS,
  SCOPED_RUNTIME_BRANDS,
  normalizeBpmSourceMode,
  normalizeRuntimeTuning,
  normalizeSceneAggressiveness,
  normalizeSceneLock,
  normalizeScopedRuntimeBrand,
  normalizeScopedRuntimeBrandOverrides,
  normalizeScopedRuntimeFixtureId,
  normalizeScopedRuntimeFixtureOverrides,
  extractLiveRuntimeControls
};
