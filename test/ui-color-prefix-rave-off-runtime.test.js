// [TITLE] Test Module: test/ui-color-prefix-rave-off-runtime.test.js
// [TITLE] Purpose: guard color-prefix RAVE-off map parsing split

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadRuntimeFactory() {
  const filePath = path.resolve(__dirname, "..", "public", "assets", "js", "domains", "color-prefix-rave-off-runtime-ui.js");
  const context = { console };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(filePath, "utf8"), context, { filename: filePath });
  return context.createColorPrefixRaveOffRuntimeUi;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("color-prefix RAVE-off runtime normalizes group and fixture maps", () => {
  const createColorPrefixRaveOffRuntimeUi = loadRuntimeFactory();
  const runtime = createColorPrefixRaveOffRuntimeUi();

  assert.equal(runtime.normalizeColorRaveOffGroupKey("Hue:*"), "hue:all");
  assert.equal(runtime.normalizeColorRaveOffGroupKey("wiz:desk_zone"), "wiz:desk_zone");
  assert.equal(runtime.normalizeColorRaveOffGroupKey("unknown:desk"), "");

  assert.deepEqual(
    plain(runtime.normalizeColorRaveOffGroupMap({
      "hue:desk": "dim red",
      "wiz:*": "blue",
      bad: "green"
    })),
    {
      "hue:desk": "dim red",
      "wiz:all": "blue"
    }
  );
  assert.deepEqual(
    plain(runtime.normalizeColorRaveOffFixtureMap({
      "fixture-2": "purple",
      "": "red",
      "fixture-1": " dim blue "
    })),
    {
      "fixture-1": "dim blue",
      "fixture-2": "purple"
    }
  );
});

test("color-prefix RAVE-off runtime parses duplicate and invalid text rows deterministically", () => {
  const createColorPrefixRaveOffRuntimeUi = loadRuntimeFactory();
  const runtime = createColorPrefixRaveOffRuntimeUi();

  const groupParsed = runtime.parseColorRaveOffGroupMapText("hue=random\nbad:zone=red\nhue=blue");
  assert.equal(groupParsed.ok, false);
  assert.deepEqual(plain(groupParsed.map), { hue: "random" });
  assert.equal(groupParsed.errors.some(error => error.includes("invalid group key")), true);
  assert.equal(groupParsed.errors.some(error => error.includes("duplicate group key")), true);

  const fixtureParsed = runtime.parseColorRaveOffFixtureMapText("fixture-a=red\nfixture-a=blue\n=missing");
  assert.equal(fixtureParsed.ok, false);
  assert.deepEqual(plain(fixtureParsed.map), { "fixture-a": "red" });
  assert.equal(fixtureParsed.errors.some(error => error.includes("duplicate fixture id")), true);

  assert.equal(runtime.formatColorRaveOffGroupMapText({ "wiz:all": "blue", hue: "random" }), "hue=random\nwiz:all=blue");
  assert.equal(runtime.formatColorRaveOffFixtureMapText({ b: "blue", a: "red" }), "a=red\nb=blue");
});
