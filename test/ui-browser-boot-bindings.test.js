// [TITLE] Test Module: test/ui-browser-boot-bindings.test.js
// [TITLE] Purpose: verify browser-executed UI scripts bind domain controls

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

test("browser UI boot completes and binds non-mod domain controls", { timeout: 60_000 }, () => {
  const probeScript = String.raw`
process.env.RAVELINK_DRY_RUN_TRANSPORT = "1";
process.env.RAVELINK_INTERNET_GATEWAY_ENABLED = "0";
process.env.RAVELINK_TWITCH_RECONCILE_ENABLED = "0";
const createServer = require("./src/app/create-server");
const { chromium } = require("playwright");

(async () => {
  const { app, services } = createServer({
    rootDir: process.cwd(),
    currentVersion: "ui-browser-boot-test"
  });
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    instance.on("error", reject);
  });
  const port = server.address().port;
  const baseUrl = "http://127.0.0.1:" + port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", error => {
    pageErrors.push(String(error && error.stack || error || "unknown_page_error"));
  });
  page.on("console", message => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.addInitScript(apiBase => {
    localStorage.setItem("rave_api_base", apiBase);
  }, baseUrl);
  await page.goto(baseUrl + "/", { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForFunction(
    () => window.__ravelinkBootSummary && window.__ravelinkBootSummary.completedAt,
    null,
    { timeout: 22000 }
  );
  await page.waitForTimeout(500);

  const snapshot = await page.evaluate(() => {
    const ids = [
      "liveProfileSaveBtn",
      "liveProfileLoadBtn",
      "onBtn",
      "offBtn",
      "panicBtn",
      "fxSaveBtn",
      "fxResetBtn",
      "systemSettingsSaveBtn",
      "modsRefreshBtn",
      "midiRefreshBtn",
      "sceneFilterAggSaveBtn",
      "sceneRuntimeSaveBtn"
    ];
    const buttons = Object.fromEntries(ids.map(id => {
      const node = document.getElementById(id);
      return [id, {
        exists: Boolean(node),
        onclick: Boolean(node && typeof node.onclick === "function")
      }];
    }));
    return {
      bootSummary: window.__ravelinkBootSummary || null,
      liveOwnership: window.__ravelinkLiveOwnership || null,
      buttons
    };
  });

  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await services.modRuntime?.shutdown?.();
  services.internetGatewayRuntime?.shutdown?.();
  services.systemOauthService?.stopAutoReconcile?.();
  services.audioRuntimeService?.stopSession?.({ reason: "test_cleanup" });

  console.log("__UI_BROWSER_BOOT_RESULT__" + JSON.stringify({ snapshot, pageErrors, consoleErrors }));
})().then(() => process.exit(0)).catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
`;

  const result = spawnSync(process.execPath, ["-e", probeScript], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 60_000
  });
  assert.equal(result.status, 0, `browser boot probe failed:\n${result.stdout}\n${result.stderr}`);
  const markerLine = String(result.stdout || "")
    .split(/\r?\n/)
    .find(line => line.startsWith("__UI_BROWSER_BOOT_RESULT__"));
  assert.ok(markerLine, `browser boot probe did not emit result marker:\n${result.stdout}\n${result.stderr}`);
  const payload = JSON.parse(markerLine.replace("__UI_BROWSER_BOOT_RESULT__", ""));

  assert.deepEqual(payload.pageErrors, []);
  assert.deepEqual(payload.consoleErrors, []);
  assert.equal(payload.snapshot?.bootSummary?.ok, true, JSON.stringify(payload.snapshot?.bootSummary, null, 2));
  assert.equal(payload.snapshot?.liveOwnership?.ok, true, JSON.stringify(payload.snapshot?.liveOwnership, null, 2));
  for (const [id, state] of Object.entries(payload.snapshot?.buttons || {})) {
    assert.equal(state.exists, true, `${id} should exist`);
    assert.equal(state.onclick, true, `${id} should have an onclick handler`);
  }
});
