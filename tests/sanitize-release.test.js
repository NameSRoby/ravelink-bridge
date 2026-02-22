const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const sanitizeRelease = require("../scripts/sanitize-release");

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

test("sanitize-release removes sensitive/local artifacts and rewrites fixture config template", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-sanitize-test-"));
  try {
    writeJson(path.join(tempRoot, "core", "fixtures.config.json"), {
      fixtures: [
        {
          id: "hue-local-1",
          bridgeIp: "192.168.1.131",
          username: "real-user-key",
          clientKey: "real-client-key",
          bridgeId: "REALBRIDGEID",
          entertainmentAreaId: "real-area-id",
          lightId: 1
        }
      ]
    });
    fs.mkdirSync(path.join(tempRoot, "release"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "backups"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "core", "backups"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "core", ".core-lock.key"), "secret", "utf8");

    sanitizeRelease(tempRoot, {
      purgeRuntime: true,
      purgeBackups: true,
      purgeRelease: true,
      pruneRootArtifacts: true
    });

    const sanitized = JSON.parse(
      fs.readFileSync(path.join(tempRoot, "core", "fixtures.config.json"), "utf8")
    );
    const firstFixture = Array.isArray(sanitized.fixtures) ? sanitized.fixtures[0] : null;
    assert.ok(firstFixture);
    assert.equal(firstFixture.bridgeIp, "192.168.x.x");
    assert.equal(firstFixture.username, "replace_with_hue_username");
    assert.equal(firstFixture.clientKey, "replace_with_client_key");
    assert.equal(firstFixture.bridgeId, "replace_with_bridge_id");
    assert.equal(firstFixture.entertainmentAreaId, "replace_with_entertainment_area");

    assert.equal(fs.existsSync(path.join(tempRoot, "release")), false);
    assert.equal(fs.existsSync(path.join(tempRoot, "backups")), false);
    assert.equal(fs.existsSync(path.join(tempRoot, "core", "backups")), false);
    assert.equal(fs.existsSync(path.join(tempRoot, "core", ".core-lock.key")), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
