// [TITLE] Module: domains/engine-v2/engine.scene-transition-state.js
// [TITLE] Purpose: stateful transition timing smoothing for Engine v2 scene outputs
// [TITLE] Functionality Index:
// [TITLE] - resolve cadence-aware target transition timing
// [TITLE] - smooth transition changes with beat/jump escape hatches
// [TITLE] - clamp final transition timing to runtime tuning bounds
// [DEV] This helper owns transition envelope memory only; BPM derivation and scene
// [DEV] candidate/cooldown logic live in their own scene-state helpers.

const {
  clampNumber
} = require("./engine.contracts");
const {
  DEFAULT_RUNTIME_TUNING
} = require("./engine.scene-runtime-controls");

function createSceneTransitionState() {
  let transitionEnvelopeMs = 0;

  function resolveTransitionMs(input = {}) {
    const tuning = input.tuning && typeof input.tuning === "object" ? input.tuning : DEFAULT_RUNTIME_TUNING;
    const bpmState = input.bpmState && typeof input.bpmState === "object" ? input.bpmState : {};
    const scenePace = clampNumber(input.scenePace, 0, 1, 0);
    const sceneMotion = clampNumber(input.sceneMotion, 0, 1.35, 0);
    const impactSignal = clampNumber(input.impactSignal, 0, 2, 0);
    const loudnessDeltaEma = clampNumber(input.loudnessDeltaEma, 0, 1, 0);
    const transientRise = clampNumber(input.transientRise, 0, 1, 0);
    const beatPulse = input.beatPulse === true;
    const loudnessSectionBand = String(input.loudnessSectionBand || "normal").trim().toLowerCase() || "normal";
    const telemetryBpm = clampNumber(Number(bpmState.bpm || 0), 0, 260, 0);
    const derivedBpm = clampNumber(Number(bpmState.derivedBpm || 0), 0, 260, 0);
    const cadenceSignalBpm = telemetryBpm > 0
      ? telemetryBpm
      : (derivedBpm > 0 ? derivedBpm : 0);
    const cadenceFallbackBpm = clampNumber(
      78 + (scenePace * 78) + (sceneMotion * 24) + (impactSignal * 10) + (beatPulse ? 8 : 0),
      64,
      196,
      120
    );
    const cadenceConfidence = clampNumber(bpmState.confidence, 0, 1, 0);
    const bpmForCadence = cadenceSignalBpm > 0
      ? clampNumber(
        (cadenceSignalBpm * (0.28 + (cadenceConfidence * 0.72))) +
        (cadenceFallbackBpm * (0.72 - (cadenceConfidence * 0.72))),
        60,
        220,
        cadenceFallbackBpm
      )
      : cadenceFallbackBpm;
    const beatMs = 60000 / Math.max(1, bpmForCadence);
    const paceDriveNorm = clampNumber(
      (scenePace * 0.36) +
      (clampNumber(sceneMotion / 1.2, 0, 1, 0) * 0.34) +
      (clampNumber(impactSignal / 1.4, 0, 1, 0) * 0.2) +
      (loudnessDeltaEma * 0.1),
      0,
      1,
      0.46
    );
    const paceFactor = clampNumber(
      0.72 - (paceDriveNorm * 0.46) - (beatPulse ? 0.1 : 0),
      0.2,
      1.06,
      0.62
    );
    const pulseFactor = beatPulse ? 0.68 : 1;
    const jumpTransitionFactor = clampNumber(
      1 -
      (clampNumber(impactSignal / 1.4, 0, 1, 0) * 0.22) -
      (transientRise * 0.26) -
      (beatPulse ? 0.16 : 0),
      0.58,
      1,
      0.86
    );
    const sectionTransitionFactor = loudnessSectionBand === "quiet"
      ? 1.22
      : (loudnessSectionBand === "loud" ? 0.84 : 1);
    const transitionTargetMs = clampNumber(
      Math.round(beatMs * paceFactor * pulseFactor * jumpTransitionFactor * sectionTransitionFactor),
      tuning.transitionFloorMs,
      tuning.transitionCeilMs,
      140
    );
    if (!(transitionEnvelopeMs > 0)) {
      transitionEnvelopeMs = transitionTargetMs;
    } else {
      const transitionGap = Math.abs(transitionTargetMs - transitionEnvelopeMs);
      if ((beatPulse && transitionGap >= 86) || transitionGap >= 60) {
        transitionEnvelopeMs = transitionTargetMs;
      } else {
        const transitionSmoothing = transitionTargetMs <= transitionEnvelopeMs
          ? clampNumber(tuning.transitionSmoothingAttack, 0.05, 0.95, 0.46)
          : clampNumber(tuning.transitionSmoothingRelease, 0.05, 0.95, 0.38);
        transitionEnvelopeMs = clampNumber(
          transitionEnvelopeMs + ((transitionTargetMs - transitionEnvelopeMs) * transitionSmoothing),
          tuning.transitionFloorMs,
          tuning.transitionCeilMs,
          transitionTargetMs
        );
      }
    }
    return clampNumber(
      Math.round(transitionEnvelopeMs),
      tuning.transitionFloorMs,
      tuning.transitionCeilMs,
      transitionTargetMs
    );
  }

  return {
    resolveTransitionMs
  };
}

module.exports = {
  createSceneTransitionState
};
