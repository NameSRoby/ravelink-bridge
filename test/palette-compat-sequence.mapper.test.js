// [TITLE] Test Module: test/palette-compat-sequence.mapper.test.js
// [TITLE] Purpose: verify canonical palette sequence resolver feeds engine-v2 deterministically

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizePaletteScopeConfig,
  buildEnginePaletteSequenceFromConfig,
  deriveEnginePaletteHoldTicksFromConfig
} = require("../src/domains/palette/palette-sequence-resolver");

test("palette sequence resolver resolves family/index sequence with custom colors", () => {
  const sequence = buildEnginePaletteSequenceFromConfig({
    colorSequence: [
      { family: "red", index: 0 },
      { family: "custom", index: 1 },
      { family: "blue", index: 2 }
    ],
    vividness: 2,
    customFamilyColors: [
      { r: 10, g: 20, b: 30 },
      { r: 255, g: 100, b: 0 }
    ]
  });

  assert.deepEqual(sequence, [
    "#ed091d",
    "#ff6400",
    "#1fb0eb"
  ]);
});

test("palette sequence resolver canonicalizes legacy family/index selection into colorSequence", () => {
  const normalized = normalizePaletteScopeConfig({
    families: ["blue", "custom"],
    colorsPerFamily: 2,
    familyColorIndexes: {
      blue: [1, 0],
      custom: [0]
    }
  });

  assert.deepEqual(normalized.colorSequence, [
    { family: "blue", index: 1 },
    { family: "blue", index: 0 },
    { family: "custom", index: 0 }
  ]);
  assert.deepEqual(normalized.families, ["blue", "custom"]);
});

test("palette sequence resolver derives deterministic hold ticks from timed interval", () => {
  const holdTicks = deriveEnginePaletteHoldTicksFromConfig(
    { timedIntervalSec: 2.4 },
    { tickHz: 10 }
  );
  assert.equal(holdTicks, 24);
});

test("palette sequence resolver keeps trigger cycle mode reactive with holdTicks=1", () => {
  const holdTicks = deriveEnginePaletteHoldTicksFromConfig(
    {
      cycleMode: "on_trigger",
      timedIntervalSec: 5
    },
    { tickHz: 10 }
  );
  assert.equal(holdTicks, 1);
});
