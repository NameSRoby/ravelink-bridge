// [TITLE] Test Module: test/twitch-color-config.test.js
// [TITLE] Purpose: verify prefix config sanitization and parsing precedence

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const createTwitchColorConfigRuntime = require("../src/domains/twitch/twitch-color-config.runtime");

function makeTempPath(fileName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-twitch-config-"));
  return path.join(dir, fileName);
}

test("fixture prefix takes precedence over brand prefix in splitPrefixedColorText", () => {
  const configPath = makeTempPath("twitch.color.config.json");
  const runtime = createTwitchColorConfigRuntime({ configPath });

  runtime.patch({
    prefixes: {
      hue: "hue",
      wiz: "wiz"
    },
    fixturePrefixes: {
      "fixture-main": "main"
    }
  });

  const split = runtime.splitPrefixedColorText(
    "main electric blue",
    runtime.getSnapshot().prefixes,
    runtime.getSnapshot().fixturePrefixes
  );
  assert.equal(split.fixtureId, "fixture-main");
  assert.equal(split.target, null);
  assert.equal(split.text, "electric blue");
});

test("reserved/duplicate fixture prefixes are sanitized out", () => {
  const configPath = makeTempPath("twitch.color.config.json");
  const runtime = createTwitchColorConfigRuntime({ configPath });

  const result = runtime.patch({
    prefixes: {
      hue: "hue",
      wiz: "wiz",
      other: ""
    },
    fixturePrefixes: {
      "fixture-1": "hue",
      "fixture-2": "vip",
      "fixture-3": "vip"
    }
  });

  assert.equal(result.fixturePrefixes["fixture-1"], undefined);
  assert.equal(result.fixturePrefixes["fixture-2"], "vip");
  assert.equal(result.fixturePrefixes["fixture-3"], undefined);
});
