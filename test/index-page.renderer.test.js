// [TITLE] Test Module: test/index-page.renderer.test.js
// [TITLE] Purpose: verify modular UI template composition for "/" and "/index.html"

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const createIndexPageRenderer = require("../src/app/ui/index-page.renderer");

test("index page renderer composes all section templates without unresolved tokens", () => {
  const renderer = createIndexPageRenderer({
    templateRoot: path.join(process.cwd(), "public", "templates", "index")
  });

  const html = renderer.render();
  assert.ok(html.includes("<!DOCTYPE html>"));
  assert.ok(html.includes("id=\"tabsBar\""));
  assert.ok(html.includes("data-tab=\"live\""));
  assert.ok(html.includes("data-tab=\"fixtures\""));
  assert.ok(html.includes("data-tab=\"audio\""));
  assert.ok(html.includes("data-tab=\"system\""));
  assert.ok(html.includes("data-tab=\"mods\""));
  assert.equal(html.includes("{{HEAD}}"), false);
  assert.equal(html.includes("{{PANEL_LIVE}}"), false);
  assert.equal(html.includes("{{SCRIPTS}}"), false);
});
