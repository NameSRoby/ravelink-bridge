// [TITLE] Test Module: test/color-library.test.js
// [TITLE] Purpose: verify color library teach and fuzzy resolution behavior

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const createColorLibraryService = require("../src/domains/colors/color-library.service");

function makeTempPath(fileName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-color-lib-"));
  return path.join(dir, fileName);
}

test("teachColor persists new color and allows fuzzy parsing immediately", () => {
  const storePath = makeTempPath("colors.json");
  const service = createColorLibraryService({
    storePath,
    seedCustomColors: {}
  });

  const teach = service.teachColor("toxic green #39ff14");
  assert.equal(teach.ok, true);
  assert.equal(teach.changed, true);
  assert.equal(teach.refundRecommended, false);
  assert.equal(teach.name, "toxicgreen");
  assert.equal(teach.hex, "#39ff14");

  const parsed = service.parseColorText("toxik green", { allowFuzzy: true });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.matchedName, "toxicgreen");
  assert.equal(parsed.hex, "#39ff14");
  assert.ok(parsed.fuzzy);
});

test("teachColor duplicate returns refundRecommended and keeps library unchanged", () => {
  const storePath = makeTempPath("colors.json");
  const service = createColorLibraryService({
    storePath,
    seedCustomColors: {}
  });

  const first = service.teachColor("laser red #ff0044");
  assert.equal(first.ok, true);
  assert.equal(first.changed, true);

  const duplicate = service.teachColor("laser red #ff0044");
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.refundRecommended, true);
  assert.equal(duplicate.reason, "already_exists");

  const sameHex = service.teachColor("another red #ff0044");
  assert.equal(sameHex.ok, true);
  assert.equal(sameHex.changed, false);
  assert.equal(sameHex.refundRecommended, true);
  assert.equal(sameHex.reason, "hex_exists");
});

test("teachColor accepts hex-first format and keeps taught name lookup", () => {
  const storePath = makeTempPath("colors.json");
  const service = createColorLibraryService({
    storePath,
    seedCustomColors: {}
  });

  const taught = service.teachColor("#12abef ocean glow");
  assert.equal(taught.ok, true);
  assert.equal(taught.changed, true);
  assert.equal(taught.name, "oceanglow");
  assert.equal(taught.hex, "#12abef");

  const parsed = service.parseColorText("ocean glow", { allowFuzzy: false });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.matchedName, "oceanglow");
  assert.equal(parsed.hex, "#12abef");
});

test("color library migrates legacy taught colors when new store is missing", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-color-lib-migrate-"));
  const storePath = path.join(tempDir, "runtime-colors.json");
  const legacyPath = path.join(tempDir, "colors.json");
  fs.writeFileSync(legacyPath, JSON.stringify({
    "Ocean Glow": "#12abef"
  }, null, 2), "utf8");

  const service = createColorLibraryService({
    storePath,
    legacyStorePath: legacyPath,
    seedCustomColors: {}
  });

  const parsed = service.parseColorText("ocean glow", { allowFuzzy: false });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.matchedName, "oceanglow");
  assert.equal(parsed.hex, "#12abef");

  const persisted = JSON.parse(fs.readFileSync(storePath, "utf8"));
  assert.equal(persisted.oceanglow, "#12abef");
});

test("fuzzy parsing resolves typo tokens inside longer phrase inputs", () => {
  const storePath = makeTempPath("colors.json");
  const service = createColorLibraryService({
    storePath,
    seedCustomColors: {}
  });

  const parsed = service.parseColorText("make it gren please", { allowFuzzy: true });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.matchedName, "green");
  assert.equal(parsed.hex, "#00ff00");
  assert.ok(parsed.fuzzy);
});
