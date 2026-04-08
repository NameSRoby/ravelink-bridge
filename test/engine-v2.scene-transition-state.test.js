// [TITLE] Test Module: test/engine-v2.scene-transition-state.test.js
// [TITLE] Purpose: cover Engine v2 transition timing state helper

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createSceneTransitionState
} = require("../src/domains/engine-v2/engine.scene-transition-state");

test("engine-v2 scene transition state resolves cadence-aware transition timing", () => {
  const tracker = createSceneTransitionState();
  const slow = tracker.resolveTransitionMs({
    bpmState: { bpm: 90, derivedBpm: 0, confidence: 1 },
    scenePace: 0.1,
    sceneMotion: 0.1,
    impactSignal: 0.05,
    loudnessSectionBand: "quiet",
    tuning: {
      transitionFloorMs: 32,
      transitionCeilMs: 500,
      transitionSmoothingAttack: 0.4,
      transitionSmoothingRelease: 0.3
    }
  });
  const fast = tracker.resolveTransitionMs({
    bpmState: { bpm: 160, derivedBpm: 0, confidence: 1 },
    scenePace: 0.9,
    sceneMotion: 1.1,
    impactSignal: 1,
    transientRise: 0.5,
    beatPulse: true,
    loudnessSectionBand: "loud",
    tuning: {
      transitionFloorMs: 32,
      transitionCeilMs: 500,
      transitionSmoothingAttack: 0.4,
      transitionSmoothingRelease: 0.3
    }
  });

  assert.equal(slow > fast, true);
  assert.equal(fast >= 32, true);
});

test("engine-v2 scene transition state clamps to tuning bounds", () => {
  const tracker = createSceneTransitionState();
  const out = tracker.resolveTransitionMs({
    bpmState: { bpm: 260, confidence: 1 },
    scenePace: 1,
    sceneMotion: 2,
    impactSignal: 2,
    transientRise: 1,
    beatPulse: true,
    tuning: {
      transitionFloorMs: 80,
      transitionCeilMs: 120,
      transitionSmoothingAttack: 0.4,
      transitionSmoothingRelease: 0.3
    }
  });

  assert.equal(out >= 80 && out <= 120, true);
});
