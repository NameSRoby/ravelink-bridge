const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readDoc(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8");
}

test("module ownership map documents current startup and shell ownership boundaries", () => {
  const ownershipMap = readDoc("docs/repo-documentation/03-frontend-ui-composition.md");

  assert.equal(ownershipMap.includes("`public/assets/js/bootstrap.js`"), true);
  assert.equal(ownershipMap.includes("`public/assets/js/bootstrap.js` owns sequencing and delayed retry scheduling."), true);
  assert.equal(ownershipMap.includes("`public/assets/js/app.js`"), true);
  assert.equal(ownershipMap.includes("`public/assets/js/app.js` now owns shared shell helpers only; it no longer schedules startup retries or executes fallback recovery."), true);
  assert.equal(ownershipMap.includes("`public/assets/js/domains/ui-collapsible-panels-runtime-ui.js`"), true);
  assert.equal(ownershipMap.includes("`public/assets/js/domains/ui-collapsible-panels-runtime-ui.js` owns collapsible state and navigation helpers."), true);
});

test("frontend UI composition chapter documents the current startup ownership path", () => {
  const chapter = readDoc("docs/repo-documentation/03-frontend-ui-composition.md");

  assert.equal(chapter.includes("`public/assets/js/bootstrap.js` owns sequencing and delayed retry scheduling."), true);
  assert.equal(chapter.includes("`public/assets/js/app.js` now owns shared shell helpers only; it no longer schedules startup retries or executes fallback recovery."), true);
  assert.equal(chapter.includes("`public/assets/js/domains/ui-collapsible-panels-runtime-ui.js` owns collapsible state and navigation helpers."), true);
  assert.equal(chapter.includes("runUiStartupFallbackPass"), false);
});

test("repo handbook reflects current startup and fixture fallback ownership", () => {
  const handbook = readDoc("docs/repo-documentation/03-frontend-ui-composition.md");

  assert.equal(handbook.includes("`public/assets/js/bootstrap.js` owns sequencing and delayed retry scheduling."), true);
  assert.equal(handbook.includes("`public/assets/js/domains/ui-collapsible-panels-runtime-ui.js` owns collapsible state and navigation helpers."), true);
  assert.equal(handbook.includes("The orchestrator preserves stable global names and boot surfaces."), true);
});
