// [TITLE] Test Module: test/engine-v2.scene-cooldown-state.test.js
// [TITLE] Purpose: cover Engine v2 scene cooldown and effective tuning helpers

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  calculateEffectiveSceneTuning,
  createSceneCooldownState
} = require("../src/domains/engine-v2/engine.scene-cooldown-state");

test("engine-v2 scene cooldown state holds impact for the configured dwell window", () => {
  const tracker = createSceneCooldownState();
  const tuning = {
    sceneSwitchCooldownMs: 260,
    impactHoldMs: 140
  };

  assert.equal(tracker.applySceneCooldown("impact", 1000, tuning, 1), "impact");
  assert.equal(tracker.applySceneCooldown("steady", 1080, tuning, 1), "impact");
  assert.equal(tracker.applySceneCooldown("steady", 1900, tuning, 1), "steady");
  assert.equal(tracker.applySceneCooldown("steady", 2020, tuning, 1), "steady");
});

test("engine-v2 scene cooldown state can disable dwell gates with zero tuning", () => {
  const tracker = createSceneCooldownState();
  const tuning = {
    sceneSwitchCooldownMs: 0,
    impactHoldMs: 0
  };

  assert.equal(tracker.applySceneCooldown("impact", 1000, tuning, 1), "impact");
  assert.equal(tracker.applySceneCooldown("steady", 1010, tuning, 1), "steady");
});

test("engine-v2 scene cooldown state derives effective tuning from active signal", () => {
  const tuning = calculateEffectiveSceneTuning({
    tuning: {
      sceneSwitchCooldownMs: 260,
      impactHoldMs: 140
    },
    sceneMotion: 1.1,
    sceneImpact: 0.7,
    beatPulse: true,
    sceneCandidate: "impact"
  });

  assert.equal(tuning.sceneSwitchCooldownMs < 260, true);
  assert.equal(tuning.impactHoldMs >= 140, true);
});
