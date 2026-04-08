// [TITLE] Module: domains/engine-v2/engine.scene-auto-selection.js
// [TITLE] Purpose: resolve automatic Engine v2 scene candidates from normalized musical signals
// [TITLE] Functionality Index:
// [TITLE] - score steady/motion/impact scene candidates
// [TITLE] - apply aggressiveness and previous-scene bias to candidate selection
// [TITLE] - derive musical section profile labels used by brightness and cadence shaping
// [DEV] This module stays pure: scene cooldown and hysteresis live in the stateful
// [DEV] scene-state model, while this helper only ranks the current signal frame.

const {
  clampNumber
} = require("./engine.contracts");
const {
  DEFAULT_SCENE_AGGRESSIVENESS,
  normalizeSceneLock
} = require("./engine.scene-runtime-controls");

function resolveAutoScene(input = {}) {
  const loudness = clampNumber(input.loudness, 0, 1, 0);
  const loudnessSection = clampNumber(input.loudnessSection, 0, 1, 0.5);
  const loudnessSectionBand = String(input.loudnessSectionBand || "normal").trim().toLowerCase() || "normal";
  const motion = clampNumber(input.motion, 0, 1.4, 0);
  const impactSignal = clampNumber(input.impactSignal, 0, 2, 0);
  const beatConfidence = clampNumber(input.beatConfidence, 0, 1, 0);
  const beatPulse = input.beatPulse === true;
  const pace = clampNumber(input.pace, 0, 1, 0);
  const transientRise = clampNumber(input.transientRise, 0, 1, 0);
  const fluxRise = clampNumber(input.fluxRise, 0, 1, 0);
  const kickAccent = clampNumber(input.kickAccent, 0, 1.4, 0);
  const sparkleAccent = clampNumber(input.sparkleAccent, 0, 1.4, 0);
  const aggressiveness = input.aggressiveness && typeof input.aggressiveness === "object"
    ? input.aggressiveness
    : DEFAULT_SCENE_AGGRESSIVENESS;
  const previousScene = normalizeSceneLock(input.previousScene, "motion");
  const paceConfidence = clampNumber(input.paceConfidence, 0, 1, 0);
  const impactBurst = input.impactBurst === true;
  const motionStability = clampNumber(input.motionStability, 0, 1, 0);
  const pacedBoost = pace * clampNumber((paceConfidence * 0.92) + 0.08, 0.08, 1, 0.18);

  const impactGate = clampNumber(
    (0.66 - (kickAccent * 0.06)) / clampNumber(aggressiveness.impact, 0.45, 2.25, 1),
    0.18,
    1.1,
    0.66
  );
  const motionGate = clampNumber(0.24 / clampNumber(aggressiveness.groove, 0.45, 2.25, 1), 0.1, 0.82, 0.24);
  const calmMotionGate = clampNumber(0.12 / clampNumber(aggressiveness.calm, 0.45, 2.25, 1), 0.05, 0.36, 0.12);
  const calmImpactGate = clampNumber(0.2 / clampNumber(aggressiveness.calm, 0.45, 2.25, 1), 0.07, 0.58, 0.2);

  const previousSceneImpactBias = previousScene === "impact" ? 0.08 : 0;
  const previousSceneMotionBias = previousScene === "motion" ? 0.06 : 0;
  const previousSceneCalmBias = previousScene === "steady" ? 0.03 : 0;
  const sectionImpactBias = loudnessSectionBand === "loud"
    ? 0.08
    : (loudnessSectionBand === "quiet" ? -0.08 : 0);
  const sectionMotionBias = loudnessSectionBand === "loud"
    ? 0.06
    : (loudnessSectionBand === "quiet" ? -0.06 : 0);
  const sectionCalmBias = loudnessSectionBand === "quiet"
    ? 0.2
    : (loudnessSectionBand === "loud" ? -0.06 : 0);

  const impactScore = clampNumber(
    (impactSignal * 0.92) +
    (transientRise * 0.76) +
    (fluxRise * 0.52) +
    (kickAccent * 0.34) +
    (motion * 0.08) +
    (loudnessSection * 0.05) +
    (beatConfidence * 0.22) +
    (impactBurst ? 0.22 : 0) +
    (beatPulse ? 0.16 : 0),
    0,
    3,
    0
  ) + previousSceneImpactBias + sectionImpactBias;
  const motionScore = clampNumber(
    (motion * 0.84) +
    (impactSignal * 0.08) +
    (fluxRise * 0.22) +
    (sparkleAccent * 0.18) +
    (pacedBoost * 0.24) +
    (loudness * 0.12) +
    (loudnessSection * 0.24) +
    (beatConfidence * 0.08) +
    (motionStability * 0.16) -
    (impactBurst ? 0.12 : 0),
    0,
    2.4,
    0
  ) + previousSceneMotionBias + sectionMotionBias;
  const calmScore = clampNumber(
    ((1 - motion) * 0.34) +
    ((1 - impactSignal) * 0.1) +
    ((1 - pacedBoost) * 0.14) +
    ((1 - loudness) * 0.05) +
    ((1 - loudnessSection) * 0.16) +
    (beatConfidence < 0.1 ? 0.03 : 0) +
    (!impactBurst ? 0.03 : 0),
    0,
    2.2,
    0
  ) + previousSceneCalmBias + sectionCalmBias;

  const impactHardGate = impactBurst
    ? impactGate
    : clampNumber(impactGate + 0.16, 0.24, 1.2, impactGate);
  const hardImpact = impactBurst && (
    impactSignal >= clampNumber(impactHardGate * 1.02, 0.52, 1.25, impactHardGate) ||
    (beatPulse && impactSignal >= 0.58 && transientRise >= 0.12) ||
    (transientRise >= 0.24 && fluxRise >= 0.16) ||
    (kickAccent >= 0.62 && transientRise >= 0.12)
  );
  const hardSteady = !impactBurst && !beatPulse && (
    motion <= Math.min(motionGate * 0.7, 0.22) &&
    impactSignal <= Math.min(calmImpactGate * 0.72, 0.16) &&
    transientRise <= 0.08 &&
    fluxRise <= 0.08 &&
    pacedBoost <= 0.58
  );
  let scene = "motion";
  if (hardImpact) {
    scene = "impact";
  } else if (hardSteady && previousScene !== "impact") {
    scene = "steady";
  } else if (impactSignal >= impactHardGate && impactScore >= (motionScore + (impactBurst ? -0.04 : 0.14))) {
    scene = "impact";
  } else if (
    previousScene === "motion" &&
    motion >= (motionGate * 0.82) &&
    motionScore >= (calmScore - 0.03) &&
    impactScore < (motionScore + 0.08)
  ) {
    scene = "motion";
  } else if (
    previousScene === "steady" &&
    calmScore >= (motionScore - 0.03) &&
    impactScore < (motionScore + 0.1)
  ) {
    scene = "steady";
  } else if (motion >= motionGate && motionScore >= (calmScore + 0.02)) {
    scene = "motion";
  } else if (motion <= calmMotionGate && impactSignal <= calmImpactGate) {
    scene = "steady";
  } else if (previousScene === "impact" && (impactBurst || impactSignal >= 0.52) && impactScore >= (motionScore - 0.06)) {
    scene = "impact";
  } else if (previousScene === "steady" && calmScore >= (motionScore + 0.06)) {
    scene = "steady";
  } else {
    scene = motionScore >= calmScore ? "motion" : "steady";
  }

  const rankedScores = [
    { id: "impact", score: impactScore },
    { id: "motion", score: motionScore },
    { id: "steady", score: calmScore }
  ].sort((a, b) => b.score - a.score);
  const selectedScore = rankedScores.find(row => row.id === scene)?.score ?? rankedScores[0]?.score ?? 0;
  const runnerUpScore = rankedScores.find(row => row.id !== scene)?.score ?? 0;
  const spread = clampNumber(selectedScore - runnerUpScore, 0, 1.6, 0);
  const confidence = clampNumber(
    (spread * 1.35) +
    (scene === "impact" ? ((impactSignal * 0.22) + (impactBurst ? 0.16 : 0) + (beatPulse ? 0.1 : 0)) : 0) +
    (scene === "motion" ? ((paceConfidence * 0.06) + (motionStability * 0.12)) : 0) +
    (scene === "impact" && impactBurst ? 0.08 : 0),
    0,
    1,
    0.35
  );

  return {
    scene,
    confidence,
    scores: {
      impact: impactScore,
      motion: motionScore,
      steady: calmScore
    }
  };
}

function resolveMusicalSectionProfile(input = {}) {
  const loudnessSectionBand = String(input.loudnessSectionBand || "normal").trim().toLowerCase() || "normal";
  const motion = clampNumber(input.motion, 0, 1.4, 0);
  const impactSignal = clampNumber(input.impactSignal, 0, 2, 0);
  const loudness = clampNumber(input.loudness, 0, 1, 0);
  const loudnessSection = clampNumber(input.loudnessSection, 0, 1, 0.5);
  const beatPulse = input.beatPulse === true;

  const driveNorm = clampNumber(
    (loudnessSection * 0.34) +
    (loudness * 0.18) +
    (clampNumber(motion / 1.2, 0, 1, 0) * 0.28) +
    (clampNumber(impactSignal / 1.4, 0, 1, 0) * 0.2) +
    (beatPulse ? 0.1 : 0),
    0,
    1,
    0.45
  );
  const calmCandidate = (
    loudnessSectionBand === "quiet" &&
    motion <= 0.48 &&
    impactSignal <= 0.56 &&
    driveNorm <= 0.52
  );
  const aggressiveCandidate = (
    loudnessSectionBand === "loud" ||
    driveNorm >= 0.68 ||
    impactSignal >= 0.9 ||
    (beatPulse && motion >= 0.55)
  );

  let profile = "groove";
  if (calmCandidate) profile = "calm";
  else if (aggressiveCandidate) profile = "aggressive";
  return { profile, driveNorm };
}

module.exports = {
  resolveAutoScene,
  resolveMusicalSectionProfile
};
