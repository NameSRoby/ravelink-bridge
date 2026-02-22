const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const createTwitchColorRuntime = require("../core/twitch-color-runtime");
const { parseBooleanLoose } = require("../core/utils/booleans");

function createRuntimeWithConfig(config) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-tcr-"));
  const configPath = path.join(tmpRoot, "twitch.color.config.json");
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  const runtime = createTwitchColorRuntime({
    fs,
    path,
    configPath,
    configDefault: {
      version: 1,
      defaultTarget: "hue",
      autoDefaultTarget: true,
      prefixes: { hue: "", wiz: "wiz", other: "" },
      fixturePrefixes: {},
      raveOff: { enabled: true, defaultText: "random", groups: {}, fixtures: {} }
    },
    colorTargets: new Set(["hue", "wiz", "both", "other"]),
    prefixRegex: /^[a-z][a-z0-9_-]{0,31}$/,
    parseBoolean: parseBooleanLoose,
    normalizeRouteZoneToken: (value, fallback = "") => String(value || "").trim().toLowerCase() || fallback
  });
  return { runtime, tmpRoot };
}

test("twitch color runtime prevents fixture-prefix collisions with brand prefixes", () => {
  const { runtime, tmpRoot } = createRuntimeWithConfig({
    version: 1,
    defaultTarget: "hue",
    prefixes: { hue: "hue", wiz: "wiz", other: "" },
    fixturePrefixes: {
      "wiz-main-1": "wiz",
      "desk-strip": "desk"
    },
    raveOff: { enabled: true, defaultText: "random", groups: {}, fixtures: {} }
  });

  const snapshot = runtime.getTwitchColorConfigSnapshot();
  assert.equal(snapshot.fixturePrefixes["wiz-main-1"], undefined);
  assert.equal(snapshot.fixturePrefixes["desk-strip"], "desk");

  const brandParse = runtime.splitPrefixedColorText(
    "wiz blue",
    snapshot.prefixes,
    snapshot.fixturePrefixes
  );
  assert.equal(brandParse.target, "wiz");
  assert.equal(brandParse.fixtureId, "");

  const fixtureParse = runtime.splitPrefixedColorText(
    "desk cyan",
    snapshot.prefixes,
    snapshot.fixturePrefixes
  );
  assert.equal(fixtureParse.target, null);
  assert.equal(fixtureParse.fixtureId, "desk-strip");

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test("twitch color runtime tracks autoDefaultTarget and locks it on explicit defaultTarget patch", () => {
  const { runtime, tmpRoot } = createRuntimeWithConfig({
    version: 1,
    defaultTarget: "hue",
    autoDefaultTarget: true,
    prefixes: { hue: "", wiz: "wiz", other: "" },
    fixturePrefixes: {},
    raveOff: { enabled: true, defaultText: "random", groups: {}, fixtures: {} }
  });

  const initial = runtime.getTwitchColorConfigSnapshot();
  assert.equal(initial.autoDefaultTarget, true);

  const patched = runtime.patchTwitchColorConfig({ defaultTarget: "wiz" });
  assert.equal(patched.defaultTarget, "wiz");
  assert.equal(patched.autoDefaultTarget, false);

  const reEnabled = runtime.patchTwitchColorConfig({ autoDefaultTarget: true });
  assert.equal(reEnabled.autoDefaultTarget, true);

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
