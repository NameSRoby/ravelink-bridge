// [TITLE] Test Module: test/audio-engine.port.test.js
// [TITLE] Purpose: verify telemetry-first audio port rave/session behavior

const test = require("node:test");
const assert = require("node:assert/strict");
const createAudioEnginePort = require("../src/domains/audio/audio-engine.port");

test("setTelemetry supports merge, replace, and clear modes", () => {
  const audio = createAudioEnginePort({
    now: () => 100
  });

  const first = audio.setTelemetry({ rms: 0.42, energy: 0.9 });
  assert.equal(first.ok, true);
  assert.equal(first.changed, true);
  assert.deepEqual(audio.getTelemetry(), { rms: 0.42, energy: 0.9 });
  assert.equal(audio.getStatus().telemetryUpdatedAt, 100);

  const merged = audio.setTelemetry({ bpm: 128 });
  assert.equal(merged.ok, true);
  assert.deepEqual(audio.getTelemetry(), { rms: 0.42, energy: 0.9, bpm: 128 });

  const replaced = audio.setTelemetry({ replace: true, peak: 0.77 });
  assert.equal(replaced.ok, true);
  assert.deepEqual(audio.getTelemetry(), { peak: 0.77 });

  const cleared = audio.setTelemetry({ clear: true });
  assert.equal(cleared.ok, true);
  assert.deepEqual(audio.getTelemetry(), {});
});

test("rave lifecycle transitions are deterministic", () => {
  let nowTick = 500;
  const audio = createAudioEnginePort({
    now: () => nowTick
  });

  const started = audio.startRave({ reason: "route_test" });
  assert.equal(started.ok, true);
  assert.equal(started.active, true);
  assert.equal(started.startedAt, 500);

  const secondStart = audio.startRave({ reason: "duplicate" });
  assert.equal(secondStart.alreadyActive, true);

  nowTick = 900;
  const stopped = audio.stopRave({ reason: "route_stop" });
  assert.equal(stopped.ok, true);
  assert.equal(stopped.wasActive, true);
  assert.equal(stopped.active, false);
  assert.equal(stopped.lastStoppedAt, 900);

  const status = audio.getStatus();
  assert.equal(status.status, "idle");
  assert.equal(status.rave.active, false);
});

test("setBackend enforces allowed backend tokens", () => {
  const audio = createAudioEnginePort();

  const invalid = audio.setBackend("nope");
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error, "invalid_backend");

  const legacy = audio.setBackend("legacy");
  assert.equal(legacy.ok, true);
  assert.equal(legacy.backend, "legacy");
  assert.equal(audio.getStatus().backend, "legacy");
});

function extractShape(value) {
  if (Array.isArray(value)) {
    return {
      type: "array",
      items: value.length ? extractShape(value[0]) : { type: "unknown" }
    };
  }
  if (value === null) return { type: "null" };
  const kind = typeof value;
  if (kind === "object") {
    const shape = {};
    for (const key of Object.keys(value).sort()) {
      shape[key] = extractShape(value[key]);
    }
    return {
      type: "object",
      shape
    };
  }
  return { type: kind };
}

test("legacy and rust backend telemetry snapshots keep parity contract shape", () => {
  const telemetrySample = {
    rms: 0.31,
    energy: 0.78,
    flux: 0.12,
    beats: {
      bpm: 128,
      confidence: 0.86
    },
    bands: {
      low: 0.41,
      mid: 0.53,
      high: 0.62
    },
    markers: ["drop", "rise"]
  };

  const legacyAudio = createAudioEnginePort({ backend: "legacy" });
  const rustAudio = createAudioEnginePort({ backend: "rust" });
  legacyAudio.setTelemetry({ replace: true, ...telemetrySample });
  rustAudio.setTelemetry({ replace: true, ...telemetrySample });

  const legacyShape = extractShape(legacyAudio.getTelemetry());
  const rustShape = extractShape(rustAudio.getTelemetry());
  assert.deepEqual(legacyShape, rustShape);
});
