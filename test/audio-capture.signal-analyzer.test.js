// [TITLE] Test Module: test/audio-capture.signal-analyzer.test.js
// [TITLE] Purpose: cover PCM telemetry projection for the audio capture runtime

const assert = require("node:assert/strict");
const test = require("node:test");

const createSignalAnalyzer = require("../src/domains/audio/audio-capture.signal-analyzer");

function f32(samples = []) {
  const buffer = Buffer.alloc(Math.max(0, samples.length) * 4);
  samples.forEach((sample, index) => {
    buffer.writeFloatLE(Number(sample) || 0, index * 4);
  });
  return buffer;
}

test("audio capture signal analyzer starts with silent metrics", () => {
  const analyzer = createSignalAnalyzer();

  assert.deepEqual(analyzer.getMetrics(), {
    level: 0,
    levelRaw: 0,
    rms: 0,
    peak: 0,
    transient: 0,
    spectralFlux: 0,
    zcr: 0,
    bandLow: 0,
    bandMid: 0,
    bandHigh: 0,
    energy: 0,
    beat: false,
    beatConfidence: 0,
    bpm: 0
  });
});

test("audio capture signal analyzer projects normalized f32 PCM metrics", () => {
  const analyzer = createSignalAnalyzer();
  const metrics = analyzer.pushChunk(f32([0.25, -0.25, 0.5, -0.5]));

  assert.equal(metrics.level > 0, true);
  assert.equal(metrics.peak, 0.5);
  assert.equal(metrics.zcr > 0, true);
  assert.equal(metrics.energy > 0, true);
  assert.equal(metrics.bandHigh > 0, true);
});

test("audio capture signal analyzer rescales int16-like f32 payloads", () => {
  const analyzer = createSignalAnalyzer();
  const metrics = analyzer.pushChunk(f32([16384, -16384, 32768, -32768]));

  assert.equal(metrics.peak, 1);
  assert.equal(metrics.level <= 1, true);
  assert.equal(metrics.energy <= 1, true);
});

test("audio capture signal analyzer smooths single-frame dropouts after strong history", () => {
  const analyzer = createSignalAnalyzer();
  const strong = analyzer.pushChunk(f32([0.7, -0.7, 0.6, -0.6]));
  const dropout = analyzer.pushChunk(f32([0, 0, 0, 0]));

  assert.equal(strong.level > 0.4, true);
  assert.equal(dropout.level > 0.1, true);
  assert.equal(dropout.peak > 0.1, true);
});
