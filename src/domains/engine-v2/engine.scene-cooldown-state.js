// [TITLE] Module: domains/engine-v2/engine.scene-cooldown-state.js
// [TITLE] Purpose: stateful scene cooldown and candidate hysteresis for Engine v2
// [TITLE] Functionality Index:
// [TITLE] - apply scene candidate confidence and streak gates
// [TITLE] - enforce impact hold and scene dwell timing
// [TITLE] - derive effective cooldown tuning from current motion/impact signals
// [DEV] Auto-scene scoring stays pure in engine.scene-auto-selection.js; this
// [DEV] helper owns only time-based hysteresis around selected candidates.

const {
  clampNumber
} = require("./engine.contracts");
const {
  DEFAULT_RUNTIME_TUNING,
  normalizeSceneLock
} = require("./engine.scene-runtime-controls");

function calculateEffectiveSceneTuning(input = {}) {
  const tuning = input.tuning && typeof input.tuning === "object" ? input.tuning : DEFAULT_RUNTIME_TUNING;
  const sceneMotion = clampNumber(input.sceneMotion, 0, 1.35, 0);
  const sceneImpact = clampNumber(input.sceneImpact, 0, 2, 0);
  const beatPulse = input.beatPulse === true;
  const sceneCandidate = normalizeSceneLock(input.sceneCandidate, "steady");
  const cooldownScale = clampNumber(
    1.08 - (sceneMotion * 0.08) - (sceneImpact * 0.03) - (beatPulse ? 0.02 : 0),
    0.95,
    1.2,
    1.02
  );
  const holdScale = clampNumber(
    1.04 - (sceneMotion * 0.12) + (sceneCandidate === "impact" ? 0.1 : 0),
    0.72,
    1.15,
    0.96
  );
  return {
    ...tuning,
    sceneSwitchCooldownMs: Math.round(clampNumber(
      tuning.sceneSwitchCooldownMs * cooldownScale,
      0,
      4000,
      tuning.sceneSwitchCooldownMs
    )),
    impactHoldMs: Math.round(clampNumber(
      tuning.impactHoldMs * holdScale,
      0,
      3000,
      tuning.impactHoldMs
    ))
  };
}

function createSceneCooldownState() {
  let lastScene = "steady";
  let lastSceneChangedAt = 0;
  let lastSceneCandidate = "steady";
  let sceneCandidateStreak = 0;

  function getLastScene() {
    return lastScene;
  }

  function applySceneCooldown(
    candidate = "steady",
    nowMs = Date.now(),
    tuning = DEFAULT_RUNTIME_TUNING,
    sceneCandidateConfidence = 1
  ) {
    const target = normalizeSceneLock(candidate, "steady");
    if (target === lastSceneCandidate) {
      sceneCandidateStreak += 1;
    } else {
      lastSceneCandidate = target;
      sceneCandidateStreak = 1;
    }
    if (!lastSceneChangedAt) {
      lastScene = target;
      lastSceneChangedAt = nowMs;
      return target;
    }
    if (target === lastScene) {
      return target;
    }
    const exitingImpact = lastScene === "impact" && target !== "impact";
    const requiredCandidateStreak = target === "impact"
      ? (sceneCandidateConfidence >= 0.94 ? 1 : 3)
      : (exitingImpact ? 2 : (sceneCandidateConfidence >= 0.96 ? 1 : 2));
    if (
      target === "impact" &&
      sceneCandidateConfidence < 0.82 &&
      sceneCandidateStreak < 4 &&
      clampNumber(tuning.sceneSwitchCooldownMs, 0, 10000, 0) > 0
    ) {
      return lastScene;
    }
    if (
      target !== "impact" &&
      sceneCandidateConfidence < 0.62 &&
      clampNumber(tuning.sceneSwitchCooldownMs, 0, 10000, 0) > 0
    ) {
      return lastScene;
    }
    if (
      target !== "impact" &&
      sceneCandidateStreak < requiredCandidateStreak &&
      clampNumber(tuning.sceneSwitchCooldownMs, 0, 10000, 0) > 0
    ) {
      return lastScene;
    }
    const elapsed = Math.max(0, nowMs - lastSceneChangedAt);
    const impactHoldMs = clampNumber(tuning.impactHoldMs, 0, 5000, 0);
    const requiredImpactHoldMs = impactHoldMs > 0
      ? Math.max(impactHoldMs, 110)
      : 0;
    if (lastScene === "impact" && elapsed < requiredImpactHoldMs) {
      return lastScene;
    }
    if (clampNumber(tuning.sceneSwitchCooldownMs, 0, 10000, 0) > 0) {
      const minSceneDwellMs = lastScene === "steady"
        ? 260
        : (lastScene === "motion" ? 220 : 150);
      const requiredElapsed = Math.max(
        clampNumber(tuning.sceneSwitchCooldownMs, 0, 10000, 0),
        minSceneDwellMs
      );
      if (elapsed < requiredElapsed) {
        return lastScene;
      }
    } else if (elapsed < tuning.sceneSwitchCooldownMs) {
      return lastScene;
    }
    lastScene = target;
    lastSceneChangedAt = nowMs;
    return target;
  }

  return {
    applySceneCooldown,
    getLastScene
  };
}

module.exports = {
  calculateEffectiveSceneTuning,
  createSceneCooldownState
};
