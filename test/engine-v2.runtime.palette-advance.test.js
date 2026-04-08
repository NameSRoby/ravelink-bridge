// [TITLE] Purpose: verify engine-v2 palette advance helper keeps strict/musical timing deterministic

const test = require("node:test");
const assert = require("node:assert/strict");

const createEngineRuntimePaletteAdvance = require("../src/domains/engine-v2/engine.runtime.palette-advance");

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

test("engine-v2 palette advance helper seeds stale advance on the first strict tick", () => {
  const helper = createEngineRuntimePaletteAdvance({
    clampNumber,
    paletteMapperMode: "strict"
  });

  const result = helper.computePaletteAdvance({
    tickAt: 1000,
    transportClock: {
      bpm: 120,
      subdivision: 1,
      advance: false
    },
    audioTelemetry: {
      transient: 0.12,
      flux: 0.08,
      beatConfidence: 0.08
    },
    beatPulse: false,
    cadenceHz: 6,
    profileHint: "groove",
    sectionBandHint: "normal",
    profileDriveHint: 0.32
  });

  assert.equal(result.advance, true);
  assert.equal(result.advanceWeight, 1);
});

test("engine-v2 palette advance helper returns heavy strict steps on aggressive beat pulses", () => {
  const helper = createEngineRuntimePaletteAdvance({
    clampNumber,
    paletteMapperMode: "strict"
  });

  helper.computePaletteAdvance({
    tickAt: 1000,
    transportClock: {
      bpm: 148,
      subdivision: 2,
      advance: false
    },
    audioTelemetry: {
      transient: 0.2,
      flux: 0.14,
      beatConfidence: 0.2
    },
    beatPulse: false,
    cadenceHz: 6,
    profileHint: "aggressive",
    sectionBandHint: "normal",
    profileDriveHint: 0.4
  });

  const result = helper.computePaletteAdvance({
    tickAt: 1320,
    transportClock: {
      bpm: 152,
      subdivision: 2,
      advance: true
    },
    audioTelemetry: {
      transient: 0.9,
      flux: 0.74,
      beatConfidence: 0.82
    },
    beatPulse: true,
    cadenceHz: 12,
    profileHint: "aggressive",
    sectionBandHint: "loud",
    profileDriveHint: 0.88
  });

  assert.equal(result.advance, true);
  assert.equal(result.advanceWeight, 2);
});

test("engine-v2 palette advance helper returns heavy musical steps for pulse-driven motion", () => {
  const helper = createEngineRuntimePaletteAdvance({
    clampNumber,
    paletteMapperMode: "musical"
  });

  helper.computePaletteAdvance({
    tickAt: 1000,
    transportClock: {
      bpm: 116,
      subdivision: 1,
      advance: false
    },
    audioTelemetry: {
      transient: 0.12,
      flux: 0.1,
      beatConfidence: 0.08,
      rms: 0.22,
      energy: 0.24
    },
    beatPulse: false,
    cadenceHz: 6,
    profileHint: "groove",
    sectionBandHint: "normal",
    profileDriveHint: 0.34
  });

  const result = helper.computePaletteAdvance({
    tickAt: 1280,
    transportClock: {
      bpm: 144,
      subdivision: 2,
      advance: true
    },
    audioTelemetry: {
      transient: 0.82,
      flux: 0.7,
      beatConfidence: 0.76,
      rms: 0.72,
      energy: 0.82
    },
    beatPulse: true,
    cadenceHz: 12,
    profileHint: "aggressive",
    sectionBandHint: "loud",
    profileDriveHint: 0.84
  });

  assert.equal(result.advance, true);
  assert.equal(result.advanceWeight, 2);
});
