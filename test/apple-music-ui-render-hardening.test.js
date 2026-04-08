const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.join(__dirname, "..", "mods", "song-request-mod", "ui", "app.js");
const htmlPath = path.join(__dirname, "..", "mods", "song-request-mod", "ui", "index.html");
const cssPath = path.join(__dirname, "..", "mods", "song-request-mod", "ui", "styles.css");

function sliceFunctionBlock(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.ok(start >= 0, `missing token: ${startToken}`);
  assert.ok(end > start, `missing token: ${endToken}`);
  return source.slice(start, end);
}

test("apple music queue/history renderers avoid row-level innerHTML templating", () => {
  const source = fs.readFileSync(appPath, "utf8");
  const queueBlock = sliceFunctionBlock(source, "function renderQueue(snapshot) {", "function renderHistory(snapshot) {");
  const historyBlock = sliceFunctionBlock(source, "function renderHistory(snapshot) {", "function renderEvents(snapshot) {");

  assert.equal(queueBlock.includes("tr.innerHTML"), false, "renderQueue should not use tr.innerHTML");
  assert.equal(historyBlock.includes("tr.innerHTML"), false, "renderHistory should not use tr.innerHTML");
  assert.equal(queueBlock.includes("createElement(\"button\")"), true, "renderQueue should build action buttons via DOM APIs");
  assert.equal(historyBlock.includes("textContent"), true, "renderHistory should set cell text via textContent");
});

test("song request mod UI avoids dead-feeling duplicate utility buttons", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const source = fs.readFileSync(appPath, "utf8");
  for (const id of [
    "jumpOverlayToolsBtn",
    "jumpWidgetToolsBtn",
    "rqRefreshBtn",
    "historyRefreshBtn",
    "policySaveResolverQuickBtn"
  ]) {
    assert.equal(html.includes(`id="${id}"`), false, `${id} should not be rendered as a duplicate utility button`);
    assert.equal(source.includes(id), false, `${id} should not keep stale JS wiring`);
  }
  const css = fs.readFileSync(cssPath, "utf8");
  assert.equal(source.includes("function runButtonAction("), true, "remaining async action buttons should share busy-state feedback");
  assert.equal(source.includes("dataset.busy"), true, "button actions should expose busy state");
  assert.equal(css.includes('button[data-busy="true"]'), true, "button busy state should be visible to CSS");
});

test("song request mod requests tab is a local control panel, not a chat simulator", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const source = fs.readFileSync(appPath, "utf8");
  for (const id of [
    "rqUser",
    "rqIsMod",
    "rqIsVip",
    "rmUser",
    "rmIsMod",
    "rmIsVip",
    "volUser",
    "volIsMod",
    "skipSendBtn"
  ]) {
    assert.equal(html.includes(`id="${id}"`), false, `${id} should not be rendered in the local Requests control panel`);
    assert.equal(source.includes(id), false, `${id} should not keep stale local UI wiring`);
  }
  assert.match(html, /Local Queue Control/i);
  assert.match(html, /Current Playback/i);
  assert.equal(source.includes("localControlIdentity"), true, "local controls should use a single privileged local identity");
});

test("song request mod history is paged and clearable from the local UI", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const source = fs.readFileSync(appPath, "utf8");
  for (const id of ["historyPrevBtn", "historyNextBtn", "historyPageInfo", "historyClearBtn"]) {
    assert.equal(html.includes(`id="${id}"`), true, `${id} should be rendered for history paging/clear`);
    assert.equal(source.includes(id), true, `${id} should be wired by the mod UI runtime`);
  }
  assert.equal(source.includes("const historyPageSize = 25"), true, "history UI should show 25 actions per page");
  assert.equal(source.includes('callApi("admin_history_clear"'), true, "history clear should call the admin history clear endpoint");
});

test("song request mod UI exposes a native RaveLink browser-player mirror", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const source = fs.readFileSync(appPath, "utf8");
  for (const id of [
    "appleMirrorCard",
    "appleMirrorArtwork",
    "appleMirrorStatus",
    "appleMirrorTitle",
    "appleMirrorProgressBar",
    "appleMirrorUpNext"
  ]) {
    assert.equal(html.includes(`id="${id}"`), true, `${id} should be rendered in the player mirror`);
    assert.equal(source.includes(id), true, `${id} should be owned by the mod UI runtime`);
  }
  assert.equal(source.includes("function renderApplePlayerMirror("), true, "mod UI should render the browser-player mirror from state");
});

test("song request mod includes a guided tour and server-first OAuth path", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const source = fs.readFileSync(appPath, "utf8");
  const css = fs.readFileSync(cssPath, "utf8");
  for (const id of [
    "modTourStartBtn",
    "modTourTabBtn",
    "modTourLayer",
    "modTourHighlight",
    "modTourTitle"
  ]) {
    assert.equal(html.includes(`id=\"${id}\"`), true, `${id} should be rendered for mod-local onboarding`);
    assert.equal(source.includes(id), true, `${id} should be wired by the mod UI runtime`);
  }
  assert.equal(source.includes("function startTwitchOAuthViaSystem("), true, "mod UI should prefer the shared System OAuth lane when available");
  assert.equal(source.includes('callSystemApi("/system/oauth/start"'), true, "mod UI should be able to start System OAuth");
  assert.equal(source.includes('callSystemApi("/system/oauth/device-status"'), true, "mod UI should poll System OAuth device status");
  assert.equal(css.includes(".mod-tour-layer"), true, "mod-local onboarding overlay should be styled");
  assert.equal(css.includes(".hidden"), true, "mod-local hidden state should be defined so the placeholder tour shell stays hidden until activated");
  assert.equal(source.includes('target: "#modQuickstartCard"'), true, "guided tour should start by explaining the mod itself");
  assert.equal(html.includes('id="modQuickstartCard"'), true, "mod UI should include a quickstart explainer card");
});
