// [TITLE] Test Module: test/system-widget-oauth-flow-runtime-ui.test.js
// [TITLE] Purpose: guard the shared System widget Twitch OAuth flow helper

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

function loadFlowHelper() {
  const filePath = path.join(__dirname, "..", "public", "assets", "js", "domains", "system", "system-widget-oauth-flow-runtime-ui.js");
  const source = fs.readFileSync(filePath, "utf8");
  const context = {
    URL,
    URLSearchParams,
    Date,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout,
    clearTimeout,
    window: {
      location: { origin: "https://example.local" },
      open: () => null,
      getSelection: () => ({ removeAllRanges: () => {} })
    },
    document: {
      body: {
        appendChild: () => {}
      },
      createElement: () => ({
        setAttribute: () => {},
        focus: () => {},
        select: () => {},
        remove: () => {},
        style: {}
      }),
      execCommand: () => true
    },
    navigator: {
      clipboard: {
        writeText: async () => {}
      }
    }
  };
  vm.runInNewContext(source, context, { filename: filePath, timeout: 2000 });
  return context.createSystemWidgetOauthFlowRuntimeUi;
}

test("shared oauth flow helper builds the Twitch activation base URL", () => {
  const createSystemWidgetOauthFlowRuntimeUi = loadFlowHelper();
  const runtime = createSystemWidgetOauthFlowRuntimeUi({
    systemEndpointsAdapter: {
      startSystemOauth: async () => ({ ok: false, data: null }),
      getSystemOauthDeviceStatus: async () => ({ ok: false, data: null })
    }
  });
  const result = runtime.buildSystemWidgetTwitchAuthorizeUrl();

  assert.equal(result.ok, true);
  assert.equal(result.url, "https://www.twitch.tv/activate");
});

test("shared oauth flow helper resolves an active system device-code snapshot", async () => {
  const createSystemWidgetOauthFlowRuntimeUi = loadFlowHelper();
  const adapterCalls = [];
  const runtime = createSystemWidgetOauthFlowRuntimeUi({
    systemEndpointsAdapter: {
      async getSystemOauthDeviceStatus(payload = {}) {
        adapterCalls.push({ method: "getSystemOauthDeviceStatus", payload });
        return {
          ok: true,
          data: {
            ok: true,
            deviceFlow: {
              userCode: "ABCD-EFGH",
              status: "connected",
              verificationUriComplete: "https://www.twitch.tv/activate?public=true"
            }
          }
        };
      },
      async startSystemOauth(payload = {}) {
        adapterCalls.push({ method: "startSystemOauth", payload });
        return { ok: false, data: null };
      }
    },
    fetchRef: async url => {
      throw new Error(`unexpected fetch ${url}`);
    }
  });

  const snapshot = await runtime.resolveSystemWidgetActivationTarget();

  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.userCode, "ABCD-EFGH");
  assert.equal(snapshot.status, "connected");
  assert.equal(snapshot.url.includes("device-code=ABCD-EFGH"), true);
  assert.equal(adapterCalls.some(call => call.method === "getSystemOauthDeviceStatus"), true);
  assert.equal(adapterCalls.some(call => call.method === "startSystemOauth"), false);
});

test("shared oauth flow helper opens and copies the active activation URL", async () => {
  const createSystemWidgetOauthFlowRuntimeUi = loadFlowHelper();
  let openedUrl = "";
  let statusText = "";
  let badgeArgs = null;
  const runtime = createSystemWidgetOauthFlowRuntimeUi({
    systemEndpointsAdapter: {
      async getSystemOauthDeviceStatus() {
        return {
          ok: true,
          data: {
            ok: true,
            deviceFlow: {
              userCode: "WXYZ-1234",
              status: "pending",
              verificationUriComplete: "https://www.twitch.tv/activate?public=true"
            }
          }
        };
      },
      async startSystemOauth() {
        return { ok: false, data: null };
      }
    },
    fetchRef: async () => ({
      ok: true,
      json: async () => ({ ok: false })
    }),
    windowRef: {
      location: { origin: "https://example.local" },
      open: url => {
        openedUrl = String(url || "");
        return { closed: false };
      },
      getSelection: () => ({ removeAllRanges: () => {} })
    },
    setSystemWidgetTemplateStatus: text => {
      statusText = String(text || "");
    },
    setBadge: (...args) => {
      badgeArgs = args;
    },
    saveSystemWidgetTemplatePrefsToStorage: () => {}
  });

  const opened = await runtime.openSystemWidgetOauthAuthorizeUrl();
  const copied = await runtime.copySystemWidgetOauthAuthorizeUrl();

  assert.equal(opened, true);
  assert.equal(copied, true);
  assert.equal(openedUrl.includes("device-code=WXYZ-1234"), true);
  assert.equal(statusText.includes("WXYZ-1234"), true);
  assert.equal(Array.isArray(badgeArgs), true);
  assert.equal(badgeArgs[0], undefined);
});

test("shared oauth flow helper requires the system endpoints adapter", () => {
  const createSystemWidgetOauthFlowRuntimeUi = loadFlowHelper();
  assert.throws(
    () => createSystemWidgetOauthFlowRuntimeUi({}),
    /system widget oauth flow runtime requires systemEndpointsAdapter/
  );
});
