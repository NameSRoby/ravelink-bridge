// [TITLE] Test Module: test/engine-v2.scene-section-state.test.js
// [TITLE] Purpose: cover Engine v2 loudness section-state derivation

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createSceneSectionState
} = require("../src/domains/engine-v2/engine.scene-section-state");

test("engine-v2 scene section state derives quiet/normal/loud bands with hysteresis", () => {
  const tracker = createSceneSectionState();
  const quiet = { rms: 0.08, energy: 0.1 };
  const loud = { rms: 0.76, energy: 0.84 };
  const normal = { rms: 0.5, energy: 0.56 };

  let quietOut = null;
  for (let i = 0; i < 20; i += 1) quietOut = tracker.update(quiet);
  let loudOut = null;
  for (let i = 0; i < 24; i += 1) loudOut = tracker.update(loud);
  let normalOut = null;
  for (let i = 0; i < 28; i += 1) normalOut = tracker.update(normal);

  assert.equal(quietOut.loudnessSectionBand, "quiet");
  assert.equal(loudOut.loudnessSectionBand, "loud");
  assert.equal(normalOut.loudnessSectionBand, "normal");
  assert.equal(loudOut.loudness > quietOut.loudness, true);
});

test("engine-v2 scene section state emits loudness delta normalization", () => {
  const tracker = createSceneSectionState();
  tracker.update({ rms: 0.1, energy: 0.1 });
  const jump = tracker.update({ rms: 0.7, energy: 0.72 });

  assert.equal(jump.loudnessDelta > 0, true);
  assert.equal(jump.loudnessDeltaNorm > 0, true);
  assert.equal(jump.loudnessAdaptiveSpan > 0, true);
});
