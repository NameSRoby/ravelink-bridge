// [TITLE] Purpose: verify engine-v2 palette mapper transport and strict/musical frame behavior

const test = require("node:test");
const assert = require("node:assert/strict");

const createEngineRuntimePaletteMapper = require("../src/domains/engine-v2/engine.runtime.palette-mapper");

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function createPaletteMapper(overrides = {}) {
  return createEngineRuntimePaletteMapper({
    clampNumber,
    paletteMapperMode: overrides.paletteMapperMode || "strict",
    paletteService: overrides.paletteService || {
      getSnapshot() {
        return {
          resolvedSequence: [],
          colorCount: 1
        };
      }
    },
    getAppliedCadenceHz: overrides.getAppliedCadenceHz || (() => 6)
  });
}

test("engine-v2 palette mapper strict mode preserves literal base palette frames and resets musical state", () => {
  const mapper = createPaletteMapper({
    paletteMapperMode: "strict"
  });

  const frame = mapper.resolvePaletteFrameForTick({
    index: 7,
    count: 3,
    rgb: { r: 255, g: 0, b: 0 }
  }, {}, 1000, {});

  assert.equal(frame.index, 7);
  assert.equal(frame.count, 3);
  assert.deepEqual(frame.rgb, { r: 255, g: 0, b: 0 });
});

test("engine-v2 palette mapper transport clock advances subdivision deterministically and pulse resets phase", () => {
  const mapper = createPaletteMapper();

  const first = mapper.updateMusicalTransportClock({
    tickAt: 1000,
    bpm: 120,
    beatPulse: false,
    profileHint: "groove",
    driveNorm: 0.8
  });
  const second = mapper.updateMusicalTransportClock({
    tickAt: 1260,
    bpm: 120,
    beatPulse: false,
    profileHint: "groove",
    driveNorm: 0.8
  });
  const pulse = mapper.updateMusicalTransportClock({
    tickAt: 1520,
    bpm: 120,
    beatPulse: true,
    profileHint: "groove",
    driveNorm: 0.8
  });

  assert.equal(first.subdivision, 1);
  assert.equal(second.advance, true);
  assert.equal(second.subIndex, 1);
  assert.equal(pulse.advance, true);
  assert.equal(pulse.phase, 0);
  assert.equal(pulse.subIndex, 0);
});

test("engine-v2 palette mapper musical mode follows sequence centroid and returns smoothed mapped frames", () => {
  const paletteRows = [
    { index: 0, token: "#ff5500", name: "warm", hex: "#ff5500", rgb: { r: 255, g: 85, b: 0 }, source: "hex" },
    { index: 1, token: "#ffc400", name: "amber", hex: "#ffc400", rgb: { r: 255, g: 196, b: 0 }, source: "hex" },
    { index: 2, token: "#2f8cff", name: "sky", hex: "#2f8cff", rgb: { r: 47, g: 140, b: 255 }, source: "hex" },
    { index: 3, token: "#8d5bff", name: "violet", hex: "#8d5bff", rgb: { r: 141, g: 91, b: 255 }, source: "hex" }
  ];
  const mapper = createPaletteMapper({
    paletteMapperMode: "musical",
    paletteService: {
      getSnapshot() {
        return {
          resolvedSequence: paletteRows.map(row => ({ ...row, rgb: { ...row.rgb } })),
          colorCount: paletteRows.length
        };
      }
    },
    getAppliedCadenceHz: () => 9
  });

  const transportLow = mapper.updateMusicalTransportClock({
    tickAt: 1000,
    bpm: 116,
    beatPulse: false,
    profileHint: "groove",
    driveNorm: 0.38
  });
  const low = mapper.resolvePaletteFrameForTick({
    index: 0,
    token: paletteRows[0].token,
    name: paletteRows[0].name,
    hex: paletteRows[0].hex,
    rgb: { ...paletteRows[0].rgb },
    count: paletteRows.length
  }, {
    bandLow: 1,
    bandMid: 0.35,
    bandHigh: 0.12,
    transient: 0.08,
    flux: 0.07,
    beatConfidence: 0.08,
    beatPulse: false
  }, 1000, {
    sceneHint: "steady",
    profileHint: "groove",
    driveNorm: 0.38,
    transportClock: transportLow,
    beatPulse: false
  });

  const transportHigh = mapper.updateMusicalTransportClock({
    tickAt: 1260,
    bpm: 146,
    beatPulse: true,
    profileHint: "aggressive",
    driveNorm: 0.86
  });
  const high = mapper.resolvePaletteFrameForTick({
    index: 0,
    token: paletteRows[0].token,
    name: paletteRows[0].name,
    hex: paletteRows[0].hex,
    rgb: { ...paletteRows[0].rgb },
    count: paletteRows.length
  }, {
    bandLow: 0.12,
    bandMid: 0.36,
    bandHigh: 1,
    transient: 0.41,
    flux: 0.34,
    beatConfidence: 0.76,
    beatPulse: true
  }, 1260, {
    sceneHint: "motion",
    profileHint: "aggressive",
    driveNorm: 0.86,
    transportClock: transportHigh,
    beatPulse: true
  });

  assert.equal(String(low.source).includes("smoothed"), true);
  assert.equal(String(high.source).includes("smoothed"), true);
  const changed = high.rgb.r !== low.rgb.r || high.rgb.g !== low.rgb.g || high.rgb.b !== low.rgb.b;
  assert.equal(changed, true);
});
