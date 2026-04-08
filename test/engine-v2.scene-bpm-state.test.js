// [TITLE] Test Module: test/engine-v2.scene-bpm-state.test.js
// [TITLE] Purpose: cover Engine v2 scene BPM derivation and hybrid source blending

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createSceneBpmState,
  getBpmSourceConfidence,
  normalizeDerivedBpm
} = require("../src/domains/engine-v2/engine.scene-bpm-state");
const {
  DEFAULT_RUNTIME_TUNING
} = require("../src/domains/engine-v2/engine.scene-runtime-controls");

function capturePulse(tracker, nowMs, tuning = DEFAULT_RUNTIME_TUNING) {
  return tracker.maybeCaptureDerivedPulse({
    beatPulse: true,
    transient: 0.85,
    flux: 0.34,
    bandLow: 0.8,
    beatConfidence: 0.2
  }, tuning, nowMs);
}

test("engine-v2 scene BPM state derives tempo from pulse intervals", () => {
  const tracker = createSceneBpmState();
  const tuning = {
    ...DEFAULT_RUNTIME_TUNING,
    bpmSourceMode: "derived"
  };

  assert.equal(capturePulse(tracker, 1000, tuning), true);
  assert.equal(capturePulse(tracker, 1500, tuning), true);
  assert.equal(capturePulse(tracker, 2000, tuning), true);
  const out = tracker.resolveBpm({ bpm: 0, beatConfidence: 0.1 }, tuning, 2000);

  assert.equal(out.source, "derived");
  assert.equal(out.derivedBpm, 120);
  assert.equal(out.bpm, 120);
  assert.equal(out.confidence > 0.5, true);
});

test("engine-v2 scene BPM state drops stale derived pulse memory", () => {
  const tracker = createSceneBpmState();
  const tuning = {
    ...DEFAULT_RUNTIME_TUNING,
    bpmSourceMode: "derived",
    derivedBeatMaxIntervalMs: 800
  };

  capturePulse(tracker, 1000, tuning);
  capturePulse(tracker, 1500, tuning);
  capturePulse(tracker, 2000, tuning);
  const withDerived = tracker.resolveBpm({ bpm: 0, beatConfidence: 0.1 }, tuning, 2000);
  const stale = tracker.resolveBpm({ bpm: 0, beatConfidence: 0 }, tuning, 4200);

  assert.equal(withDerived.derivedBpm, 120);
  assert.equal(stale.derivedBpm, 0);
  assert.equal(stale.source, "none");
  assert.equal(stale.bpm < withDerived.bpm, true);
});

test("engine-v2 scene BPM state blends weak telemetry with derived cadence", () => {
  const tracker = createSceneBpmState();
  const tuning = {
    ...DEFAULT_RUNTIME_TUNING,
    bpmSourceMode: "hybrid"
  };

  capturePulse(tracker, 1000, tuning);
  capturePulse(tracker, 1500, tuning);
  capturePulse(tracker, 2000, tuning);
  const out = tracker.resolveBpm({ bpm: 172, beatConfidence: 0.2 }, tuning, 2000);

  assert.equal(out.source, "hybrid_adaptive");
  assert.equal(out.telemetryBpm, 172);
  assert.equal(out.derivedBpm, 120);
  assert.equal(out.bpm > 120 && out.bpm < 172, true);
});

test("engine-v2 scene BPM state folds octave aliases and reports source confidence", () => {
  assert.equal(normalizeDerivedBpm(240), 120);
  assert.equal(normalizeDerivedBpm(50), 100);
  assert.equal(getBpmSourceConfidence({
    source: "derived",
    derivedConfidence: 0.8
  }) > 0.8, true);
});
