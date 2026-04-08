// [TITLE] Test Module: test/live-profile.service.test.js
// [TITLE] Purpose: verify live profile save/load/delete flow

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const createLiveProfileService = require("../src/domains/live/live-profile.service");

function makeTempPath(fileName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-live-profile-"));
  return path.join(dir, fileName);
}

test("save/load/delete live profiles works with deterministic metadata", () => {
  const service = createLiveProfileService({
    storePath: makeTempPath("profiles.json")
  });

  const save = service.saveProfile("Main Show", { scene: "test" });
  assert.equal(save.ok, true);
  assert.equal(save.profile.name, "Main Show");

  const listAfterSave = service.listProfiles();
  assert.equal(listAfterSave.length, 1);
  assert.equal(listAfterSave[0].name, "Main Show");

  const loaded = service.loadProfile("Main Show");
  assert.equal(loaded.ok, true);
  assert.equal(loaded.profile.payload.scene, "test");

  const deleted = service.deleteProfile("Main Show");
  assert.equal(deleted.ok, true);

  const listAfterDelete = service.listProfiles();
  assert.equal(listAfterDelete.length, 0);
});
