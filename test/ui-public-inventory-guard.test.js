const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readTemplateHtml() {
  const sectionsDir = path.join(repoRoot, "public", "templates", "index", "sections");
  return fs.readdirSync(sectionsDir)
    .filter(name => name.endsWith(".html"))
    .sort()
    .map(name => read(path.join("public", "templates", "index", "sections", name)))
    .join("\n");
}

function readDomRegistrySources() {
  return [
    "public/assets/js/core/dom.js",
    "public/assets/js/core/dom-domain-registry.js"
  ].map(read).join("\n");
}

function walkFiles(dirPath) {
  return fs.readdirSync(dirPath, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(dirPath, entry.name);
    return entry.isDirectory() ? walkFiles(fullPath) : [fullPath];
  });
}

test("public templates keep unique ids", () => {
  const html = readTemplateHtml();
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const seen = new Set();
  const duplicates = new Set();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }

  assert.equal(duplicates.size, 0, `duplicate template ids: ${[...duplicates].sort().join(", ")}`);
  assert.ok(ids.length > 500, "template id inventory unexpectedly small");
});

test("template ids are either runtime-owned or passive layout anchors", () => {
  const html = readTemplateHtml();
  const registrySource = readDomRegistrySources();
  const registeredIds = new Set(
    [...registrySource.matchAll(/(?:documentRef|document)\.getElementById\("([^"]+)"\)/g)]
      .map(match => match[1])
  );
  const passiveLayoutAnchors = new Set([
    "deviceRouting",
    "liveBrightnessSection",
    "liveCadenceSection",
    "livePaletteSection",
    "liveReactivityCluster",
    "liveSceneSection",
    "liveScopeSection",
    "liveSyncGroupsSection",
    "modCenter",
    "modUiWorkbench",
    "scope",
    "supportPanel",
    "telemetryScope"
  ]);
  const passiveSelectorContainers = new Set([
    "aAdvancedTuningCluster",
    "paletteCustomBrandTabs"
  ]);
  const interactiveTags = new Set(["button", "input", "select", "textarea"]);
  const unowned = [];
  const passiveInteractive = [];
  for (const match of html.matchAll(/<([a-zA-Z0-9-]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const tagName = String(match[1] || "").toLowerCase();
    const id = String(match[2] || "").trim();
    const tagSource = String(match[0] || "");
    if (registeredIds.has(id)) continue;
    if (/\bdata-(scene|palette-custom-brand)=/.test(tagSource)) continue;
    if (passiveSelectorContainers.has(id)) continue;
    if (passiveLayoutAnchors.has(id)) {
      if (interactiveTags.has(tagName)) passiveInteractive.push(`${id}<${tagName}>`);
      continue;
    }
    unowned.push(`${id}<${tagName}>`);
  }

  assert.deepEqual(unowned, [], `template ids without runtime or passive-anchor owner:\n${unowned.join("\n")}`);
  assert.deepEqual(passiveInteractive, [], `passive anchors must not be interactive controls:\n${passiveInteractive.join("\n")}`);
});

test("registered DOM ids still exist in the public templates", () => {
  const html = readTemplateHtml();
  const templateIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const registrySource = readDomRegistrySources();
  const missing = [...registrySource.matchAll(/([A-Za-z0-9_$]+):\s*(?:documentRef|document)\.getElementById\("([^"]+)"\)/g)]
    .map(match => ({ key: match[1], id: match[2] }))
    .filter(entry => !templateIds.has(entry.id))
    .map(entry => `${entry.key}:${entry.id}`);

  assert.deepEqual(missing, [], `registered DOM ids missing from templates:\n${missing.join("\n")}`);
});

test("registered DOM entries are consumed outside the registry", () => {
  const registrySource = readDomRegistrySources();
  const entries = [...registrySource.matchAll(/([A-Za-z0-9_$]+):\s*(?:documentRef|document)\.getElementById\("([^"]+)"\)/g)]
    .map(match => ({ key: match[1], id: match[2] }));
  const runtimeFiles = walkFiles(path.join(repoRoot, "public", "assets", "js"))
    .filter(filePath => filePath.endsWith(".js"))
    .filter(filePath => !filePath.endsWith(path.join("core", "dom.js")))
    .filter(filePath => !filePath.endsWith(path.join("core", "dom-domain-registry.js")))
    .map(filePath => fs.readFileSync(filePath, "utf8"));
  const unused = [];
  for (const entry of entries) {
    const usagePattern = new RegExp(`(?:\\bel\\.${entry.key}\\b|\\[([\"'])${entry.key}\\1\\])`);
    if (!runtimeFiles.some(content => usagePattern.test(content))) {
      unused.push(`${entry.key}:${entry.id}`);
    }
  }

  assert.deepEqual(unused, [], `registered DOM entries without runtime consumers:\n${unused.join("\n")}`);
});

test("public jump links and live core jump buttons target existing owned sections", () => {
  const html = readTemplateHtml();
  const templateIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const brokenAnchors = [...html.matchAll(/\bhref="#([^"]+)"/g)]
    .map(match => match[1])
    .filter(targetId => !templateIds.has(targetId));
  const brokenLiveJumps = [...html.matchAll(/\bdata-live-jump-target="([^"]+)"/g)]
    .map(match => match[1])
    .filter(targetId => !templateIds.has(targetId));
  const navigationSource = read("public/assets/js/domains/ui-navigation.js");
  const liveShellSource = read("public/assets/js/domains/live/live-shell-runtime-ui.js");

  assert.deepEqual(brokenAnchors, [], `anchor links point at missing ids:\n${brokenAnchors.join("\n")}`);
  assert.deepEqual(brokenLiveJumps, [], `live jump controls point at missing ids:\n${brokenLiveJumps.join("\n")}`);
  assert.match(navigationSource, /activateTabAndScroll\("fixtures",\s*"deviceRouting"\)/);
  assert.match(navigationSource, /activateTabAndScroll\("mods",\s*"modCenter"\)/);
  assert.match(liveShellSource, /querySelectorAll\("\[data-live-jump-target\]"\)/);
  assert.match(liveShellSource, /scrollIntoView\(\{\s*behavior:\s*"smooth",\s*block:\s*"start"\s*\}\)/);
});

test("template CSS classes are styled or explicitly runtime-owned", () => {
  const html = readTemplateHtml();
  const css = read("public/assets/css/app.css");
  const cssClasses = new Set([...css.matchAll(/\.([A-Za-z_-][A-Za-z0-9_-]*)/g)].map(match => match[1]));
  const templateClasses = new Set(
    [...html.matchAll(/\bclass="([^"]+)"/g)]
      .flatMap(match => match[1].split(/\s+/).map(value => value.trim()).filter(Boolean))
  );
  const runtimeOwnedClasses = new Set([
    "audioIsoOnly",
    "collapsible",
    "inline-toggle",
    "liveAdvancedSection",
    "liveNonCoreSection",
    "liveSyncFixtureRows"
  ]);
  const unowned = [...templateClasses]
    .filter(className => !cssClasses.has(className))
    .filter(className => !runtimeOwnedClasses.has(className))
    .sort();

  assert.deepEqual(unowned, [], `template classes without CSS or runtime ownership:\n${unowned.join("\n")}`);
});

test("guided-tour dead wiring stays deleted", () => {
  const files = [
    "public/templates/index/sections/chrome.html",
    "public/assets/js/core/dom.js",
    "public/assets/js/domains/live/live-theme-shell-ui.js",
    "public/assets/js/core/ui-state.js",
    "public/assets/js/shared/ui-contract.js",
    "public/assets/js/bootstrap.js",
    "public/assets/js/app.js",
    "public/assets/css/app.css"
  ];

  for (const relativePath of files) {
    const content = read(relativePath);
    assert.equal(/guidedTour|guidedOnboarding|ravelink_guided_/i.test(content), false, `${relativePath} still contains guided-tour residue`);
  }
});

test("public panels do not carry stale placeholder runtime language", () => {
  const candidatePanels = [
    "public/templates/index/sections/panel-system.html",
    "public/templates/index/sections/panel-audio.html",
    "public/templates/index/sections/panel-live.html"
  ];
  const stalePatterns = [
    /coming soon/i,
    /not implemented/i,
    /old mode switching/i,
    /guided[- ]?tour/i,
    /reactor\.js/i
  ];
  const staleHits = [];

  for (const relativePath of candidatePanels) {
    const content = read(relativePath);
    for (const pattern of stalePatterns) {
      if (pattern.test(content)) {
        staleHits.push(`${relativePath}: ${pattern}`);
      }
    }
  }

  assert.deepEqual(staleHits, [], `candidate panels still contain stale placeholder/runtime language:\n${staleHits.join("\n")}`);
});

test("public tab information architecture keeps daily actions before diagnostics", () => {
  const audioPanel = read("public/templates/index/sections/panel-audio.html");
  const systemPanel = read("public/templates/index/sections/panel-system.html");
  const fixturesPanel = read("public/templates/index/sections/panel-fixtures.html");
  const livePanel = read("public/templates/index/sections/panel-live.html");

  assert.ok(
    audioPanel.indexOf("DAILY AUDIO ACTIONS") > audioPanel.indexOf("QUICK SETUP"),
    "Audio daily actions should follow quick setup basics"
  );
  assert.ok(
    audioPanel.indexOf("DAILY AUDIO ACTIONS") < audioPanel.indexOf("<h3>SOURCE ROUTING + APP ISOLATION"),
    "Audio daily actions should come before source-routing power tools"
  );
  assert.ok(
    audioPanel.indexOf("DAILY AUDIO ACTIONS") < audioPanel.indexOf("<h3>AUDIO RUNTIME SNAPSHOT"),
    "Audio daily actions should come before runtime diagnostics"
  );
  assert.match(systemPanel, /data-collapsible-key="systemStartupReadiness"[^>]*data-collapsed-default="1"/);
  assert.match(systemPanel, /data-collapsible-key="systemDevOperations"[^>]*data-collapsed-default="1"/);
  assert.match(fixturesPanel, /id="deviceRouting"[^>]*data-collapsed-default="1"/);
  assert.match(livePanel, /id="liveSyncGroupsSection"[^>]*data-collapsed-default="1"/);
});

test("core DOM composer fails if query collection factory is missing", () => {
  const domSource = read("public/assets/js/core/dom.js");
  assert.match(domSource, /core DOM query collections module missing/);
  assert.equal(/tabButtons:\s*\[\]/.test(domSource), false, "dom.js should not hide missing query collections behind empty arrays");
});
