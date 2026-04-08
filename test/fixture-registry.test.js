// [TITLE] Test Module: test/fixture-registry.test.js
// [TITLE] Purpose: verify fixture registry preserves Hue pairing metadata fields

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const createFixtureRegistry = require("../src/domains/fixtures/fixture-registry");

function makeTempPath(fileName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-fixture-registry-"));
  return path.join(dir, fileName);
}

test("fixture registry upsert keeps Hue bridge id/client key/entertainment area fields", () => {
  const storePath = makeTempPath("fixtures.json");
  const registry = createFixtureRegistry({
    storePath,
    seedConfig: { fixtures: [], intentRoutes: {} }
  });

  const saved = registry.upsertFixture({
    id: "hue-main-1",
    brand: "hue",
    zone: "hue",
    bridgeIp: "192.168.1.10",
    username: "user-a",
    lightId: 1,
    bridgeId: "001788ffeeabc123",
    clientKey: "aa11bb22",
    entertainmentAreaId: "Desk"
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.fixture.bridgeId, "001788FFEEABC123");
  assert.equal(saved.fixture.clientKey, "AA11BB22");
  assert.equal(saved.fixture.entertainmentAreaId, "Desk");

  registry.load();
  const rows = registry.getFixtures();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].bridgeId, "001788FFEEABC123");
  assert.equal(rows[0].clientKey, "AA11BB22");
  assert.equal(rows[0].entertainmentAreaId, "Desk");
});
