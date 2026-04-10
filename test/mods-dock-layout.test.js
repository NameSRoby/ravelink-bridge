const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("public mods dock keeps a safe empty config baseline", () => {
  const configPath = path.resolve(__dirname, "..", "mods", "mods.config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.deepEqual(config, {
    enabled: [],
    order: [],
    disabled: []
  });
});

test("public mods dock readme documents local override and exclusion boundary", () => {
  const readmePath = path.resolve(__dirname, "..", "mods", "README.md");
  const readme = fs.readFileSync(readmePath, "utf8");
  assert.equal(readme.includes("mods.local.config.json"), true);
  assert.equal(readme.toLowerCase().includes("song-request mod"), true);
  assert.equal(readme.toLowerCase().includes("should not be published") || readme.toLowerCase().includes("does not bundle local-only mods"), true);
});
