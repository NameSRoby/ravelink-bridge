// [TITLE] Test Module: test/engine-v2.palette-service.test.js
// [TITLE] Purpose: verify Engine v2 palette service custom-color + sequence behavior

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const createEnginePaletteService = require("../src/domains/engine-v2/engine.palette.service");

function createTempPalettePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-engine-palette-"));
  return {
    dir,
    file: path.join(dir, "palette.config.json")
  };
}

test("engine-v2 palette service teaches custom colors with duplicate refund behavior", () => {
  const temp = createTempPalettePath();
  const service = createEnginePaletteService({
    storePath: temp.file
  });

  const taught = service.teachCustomColor({ text: "OceanGlow #12abef" });
  assert.equal(taught.ok, true);
  assert.equal(taught.changed, true);
  assert.equal(taught.refundRecommended, false);

  const duplicate = service.teachCustomColor({ text: "OceanGlow #12abef" });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.refundRecommended, true);

  const byHex = service.teachCustomColor({ name: "Another", hex: "#12abef" });
  assert.equal(byHex.ok, true);
  assert.equal(byHex.changed, false);
  assert.equal(byHex.reason, "hex_exists");

  const hexFirst = service.teachCustomColor({ text: "#22cc88 Mint Pulse" });
  assert.equal(hexFirst.ok, true);
  assert.equal(hexFirst.changed, true);
  assert.equal(hexFirst.name, "mintpulse");
  assert.equal(hexFirst.hex, "#22cc88");

  fs.rmSync(temp.dir, { recursive: true, force: true });
});

test("engine-v2 palette service sequence supports fuzzy names and deterministic tick cycling", () => {
  const temp = createTempPalettePath();
  const service = createEnginePaletteService({
    storePath: temp.file
  });

  const setSequence = service.setSequence(["reed", "#00ff00", "blue"]);
  assert.equal(setSequence.ok, true);
  assert.deepEqual(setSequence.snapshot.sequence, ["red", "#00ff00", "blue"]);

  const cycle = service.setCycleConfig({ holdTicks: 2 });
  assert.equal(cycle.ok, true);
  assert.equal(cycle.holdTicks, 2);

  const frameA = service.consumeTickFrame({ advance: true });
  const frameB = service.consumeTickFrame({ advance: true });
  const frameC = service.consumeTickFrame({ advance: true });
  assert.equal(frameA.index, 0);
  assert.equal(frameB.index, 0);
  assert.equal(frameC.index, 1);

  const advanced = service.advance(1);
  assert.equal(advanced.ok, true);
  assert.equal(advanced.current.index, 2);

  fs.rmSync(temp.dir, { recursive: true, force: true });
});

test("engine-v2 palette service supports weighted advance for beat-driven palette stepping", () => {
  const temp = createTempPalettePath();
  const service = createEnginePaletteService({
    storePath: temp.file
  });

  const setSequence = service.setSequence(["red", "green", "blue"]);
  assert.equal(setSequence.ok, true);
  const cycle = service.setCycleConfig({ holdTicks: 4 });
  assert.equal(cycle.ok, true);

  const frameA = service.consumeTickFrame({ advance: true, advanceWeight: 1 });
  const frameB = service.consumeTickFrame({ advance: true, advanceWeight: 3 });
  const frameC = service.consumeTickFrame({ advance: true, advanceWeight: 1 });
  assert.equal(frameA.index, 0);
  assert.equal(frameB.index, 0);
  assert.equal(frameC.index, 1);

  fs.rmSync(temp.dir, { recursive: true, force: true });
});
