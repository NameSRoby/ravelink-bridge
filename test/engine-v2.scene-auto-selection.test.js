// [TITLE] Test Module: test/engine-v2.scene-auto-selection.test.js
// [TITLE] Purpose: cover Engine v2 auto scene candidate and musical section selection

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  resolveAutoScene,
  resolveMusicalSectionProfile
} = require("../src/domains/engine-v2/engine.scene-auto-selection");

test("engine-v2 scene auto selection resolves impact from strong transient beat frames", () => {
  const out = resolveAutoScene({
    motion: 0.8,
    impactSignal: 1.1,
    beatPulse: true,
    transientRise: 0.4,
    fluxRise: 0.24,
    kickAccent: 0.7,
    beatConfidence: 0.8,
    previousScene: "motion"
  });

  assert.equal(out.scene, "impact");
  assert.equal(out.confidence > 0.5, true);
  assert.equal(out.scores.impact > out.scores.motion, true);
});

test("engine-v2 scene auto selection allows steady on low movement frames", () => {
  const out = resolveAutoScene({
    loudness: 0.2,
    loudnessSection: 0.32,
    loudnessSectionBand: "quiet",
    motion: 0.03,
    impactSignal: 0.02,
    beatPulse: false,
    transientRise: 0.02,
    fluxRise: 0.02,
    previousScene: "steady"
  });

  assert.equal(out.scene, "steady");
  assert.equal(out.scores.steady > out.scores.motion, true);
});

test("engine-v2 scene auto selection respects aggressiveness filters", () => {
  const restrainedImpact = resolveAutoScene({
    loudnessSectionBand: "normal",
    loudness: 0.5,
    loudnessSection: 0.5,
    motion: 0.3,
    impactSignal: 0.55,
    transientRise: 0.15,
    fluxRise: 0.1,
    previousScene: "motion",
    aggressiveness: {
      calm: 1,
      groove: 1,
      impact: 0.45
    }
  });
  const eagerImpact = resolveAutoScene({
    loudnessSectionBand: "normal",
    loudness: 0.5,
    loudnessSection: 0.5,
    motion: 0.3,
    impactSignal: 0.55,
    transientRise: 0.15,
    fluxRise: 0.1,
    previousScene: "motion",
    aggressiveness: {
      calm: 1,
      groove: 1,
      impact: 2.25
    }
  });

  assert.equal(restrainedImpact.scene, "steady");
  assert.equal(eagerImpact.scene, "impact");
});

test("engine-v2 scene auto selection derives musical section profiles", () => {
  assert.equal(resolveMusicalSectionProfile({
    loudnessSectionBand: "quiet",
    motion: 0.12,
    impactSignal: 0.1,
    loudness: 0.08,
    loudnessSection: 0.18
  }).profile, "calm");
  assert.equal(resolveMusicalSectionProfile({
    loudnessSectionBand: "normal",
    motion: 0.5,
    impactSignal: 0.4,
    loudness: 0.45,
    loudnessSection: 0.48
  }).profile, "groove");
  assert.equal(resolveMusicalSectionProfile({
    loudnessSectionBand: "loud",
    motion: 0.7,
    impactSignal: 0.95,
    loudness: 0.82,
    loudnessSection: 0.86,
    beatPulse: true
  }).profile, "aggressive");
});
