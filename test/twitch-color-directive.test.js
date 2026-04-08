// [TITLE] Test Module: test/twitch-color-directive.test.js
// [TITLE] Purpose: verify Twitch color directive parsing behavior

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const createColorLibraryService = require("../src/domains/colors/color-library.service");
const createTwitchColorDirectiveService = require("../src/domains/twitch/twitch-color-directive");

function makeTempPath(fileName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-twitch-directive-"));
  return path.join(dir, fileName);
}

function createFixtureServices() {
  const colorLibrary = createColorLibraryService({
    storePath: makeTempPath("colors.json"),
    seedCustomColors: {}
  });
  const directiveService = createTwitchColorDirectiveService({ colorLibrary });
  return { colorLibrary, directiveService };
}

test("brightness-only directive is accepted", () => {
  const { directiveService } = createFixtureServices();
  const result = directiveService.parseTwitchColorDirective("dim");
  assert.equal(result.ok, true);
  assert.equal(result.type, "brightness_only");
  assert.equal(result.hueState.bri, 178);
  assert.equal(result.wizState.dimming, 70);
});

test("typo color still resolves through fuzzy lookup", () => {
  const { directiveService } = createFixtureServices();
  const result = directiveService.parseTwitchColorDirective("greeen");
  assert.equal(result.ok, true);
  assert.equal(result.type, "color");
  assert.equal(result.matchedName, "green");
  assert.ok(result.fuzzy);
});

test("directive parser resolves typo colors embedded in phrase text", () => {
  const { directiveService } = createFixtureServices();
  const result = directiveService.parseTwitchColorDirective("dim make it gren please");
  assert.equal(result.ok, true);
  assert.equal(result.type, "color");
  assert.equal(result.brightness, "dim");
  assert.equal(result.matchedName, "green");
  assert.ok(result.fuzzy);
});
