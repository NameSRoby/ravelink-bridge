// [TITLE] Test Module: test/ui-browser-boot-smoke.test.js
// [TITLE] Purpose: real-browser guard for static asset serving and UI handler binding

const assert = require("node:assert/strict");
const test = require("node:test");

const { bootHttpTestServer } = require("../scripts/test-support/http-test-server");

let chromium = null;
try {
  ({ chromium } = require("playwright"));
} catch {
  chromium = null;
}

test("browser UI boot loads scripts and binds representative controls", { skip: !chromium }, async (t) => {
  const previousEnv = {
    RAVELINK_ALLOW_REMOTE_WRITE: process.env.RAVELINK_ALLOW_REMOTE_WRITE,
    RAVELINK_DRY_RUN_TRANSPORT: process.env.RAVELINK_DRY_RUN_TRANSPORT
  };
  process.env.RAVELINK_ALLOW_REMOTE_WRITE = "1";
  process.env.RAVELINK_DRY_RUN_TRANSPORT = "1";

  const server = await bootHttpTestServer();
  let browser = null;
  t.after(async () => {
    if (browser) await browser.close();
    await server.close();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  const badMessages = [];
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("console", message => {
    const text = message.text();
    if (/Refused to execute script|MIME type|ReferenceError|TypeError/i.test(text)) {
      badMessages.push(`${message.type()}: ${text}`);
    }
  });
  page.on("pageerror", error => {
    badMessages.push(`pageerror: ${error?.stack || error?.message || error}`);
  });

  const response = await page.goto(`${server.baseUrl}/`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000
  });
  assert.equal(response?.status(), 200);

  await page.waitForFunction(() => {
    const requiredIds = [
      "systemSettingsSaveBtn",
      "fxSaveBtn",
      "liveProfileSaveBtn",
      "modUiRefreshBtn",
      "midiRefreshBtn",
      "colorPrefixSaveBtn"
    ];
    return requiredIds.every(id => {
      const node = document.getElementById(id);
      return Boolean(node && node.onclick);
    });
  }, null, { timeout: 12_000 });

  const summary = await page.evaluate(() => window.__ravelinkBootSummary || null);
  assert.equal(Boolean(summary), true);
  assert.equal(summary.fatal || "", "");
  assert.deepEqual(badMessages, []);
});
