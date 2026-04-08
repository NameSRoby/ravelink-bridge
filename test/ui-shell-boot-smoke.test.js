// [TITLE] Test Module: test/ui-shell-boot-smoke.test.js
// [TITLE] Purpose: verify tab shell composition and script-asset boot integrity

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const createIndexPageRenderer = require("../src/app/ui/index-page.renderer");

function extractScriptPaths(html = "") {
  const out = [];
  const regex = /<script\s+src="([^"]+)"/gi;
  let match = regex.exec(html);
  while (match) {
    out.push(String(match[1] || "").trim());
    match = regex.exec(html);
  }
  return out.filter(Boolean);
}

test("composed UI shell contains all tab panels and profile controls", () => {
  const templateRoot = path.resolve(__dirname, "../public/templates/index");
  const renderer = createIndexPageRenderer({ templateRoot });
  const html = renderer.render();

  assert.equal(html.includes("data-tab=\"live\""), true);
  assert.equal(html.includes("data-tab=\"fixtures\""), true);
  assert.equal(html.includes("data-tab=\"audio\""), true);
  assert.equal(html.includes("data-tab=\"midi\""), true);
  assert.equal(html.includes("data-tab=\"mods\""), true);
  assert.equal(html.includes("data-tab=\"system\""), true);
  assert.equal(html.includes("id=\"liveProfileSaveBtn\""), true);
  assert.equal(html.includes("id=\"liveProfileLoadBtn\""), true);
  assert.equal(html.includes("id=\"liveProfileDeleteBtn\""), true);
});

test("script manifest references existing local assets only", () => {
  const templateRoot = path.resolve(__dirname, "../public/templates/index");
  const renderer = createIndexPageRenderer({ templateRoot });
  const html = renderer.render();
  const scripts = extractScriptPaths(html);
  const publicRoot = path.resolve(__dirname, "../public");

  assert.equal(scripts.length > 0, true);
  for (const src of scripts) {
    const clean = src.split("?")[0];
    const absolute = path.join(publicRoot, clean);
    assert.equal(fs.existsSync(absolute), true, `missing script file from manifest: ${clean}`);
  }
});
