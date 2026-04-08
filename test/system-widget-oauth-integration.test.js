// [TITLE] Test Module: test/system-widget-oauth-integration.test.js
// [TITLE] Purpose: guard System widget OAuth runtime composition

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");

function loadWidgetRuntimeContext(extraContext = {}) {
  const context = {
    URL,
    URLSearchParams,
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: {
      location: { origin: "https://example.local" },
      open: () => ({ closed: false }),
      getSelection: () => ({ removeAllRanges() {} })
    },
    document: {
      getElementById: () => null,
      execCommand: () => true,
      body: { appendChild() {} },
      createElement: () => ({
        value: "",
        style: {},
        setAttribute() {},
        focus() {},
        select() {},
        remove() {}
      })
    },
    navigator: {
      clipboard: { writeText: async () => {} }
    },
    ...extraContext
  };
  vm.createContext(context);
  for (const relativePath of [
    "public/assets/js/domains/system/system-widget-oauth-flow-runtime-ui.js",
    "public/assets/js/domains/system/system-widget-oauth-vault-runtime-ui.js",
    "public/assets/js/domains/system/system-widget-template-runtime-ui.js"
  ]) {
    const filePath = path.join(repoRoot, relativePath);
    vm.runInContext(fs.readFileSync(filePath, "utf8"), context, {
      filename: filePath,
      timeout: 2000
    });
  }
  return context;
}

function input(value = "") {
  return {
    tagName: "INPUT",
    value,
    type: "password",
    checked: false,
    dataset: {},
    addEventListener() {}
  };
}

function createSystemWidgetElements() {
  return {
    health: {},
    systemWidgetStatus: { textContent: "" },
    systemWidgetOutput: { value: "", focus() {}, select() {} },
    systemWidgetBundleMode: { value: "separate" },
    systemWidgetDockModOauth: { checked: false },
    systemWidgetTwitchClientId: input("client-123"),
    systemWidgetTwitchUserAccessToken: input("token-abc"),
    systemWidgetTwitchBroadcasterId: input("broadcaster-42"),
    systemWidgetSensitiveToggleBtn: { textContent: "" },
    systemWidgetBaseUrl: input("https://bridge.example"),
    systemWidgetRaveAutoOffSec: input("300"),
    systemWidgetRaveAutoOffResetOnRepeat: { checked: true, dataset: {}, addEventListener() {} },
    systemWidgetEnableStatusSync: { checked: true },
    systemWidgetRaveOffAnnounceEnabled: { checked: true },
    systemWidgetRaveOffAnnounceMessage: input("RAVE ended."),
    systemWidgetBlockedMessage: input("RAVE is active."),
    systemWidgetSeBotEnabled: { checked: false },
    systemWidgetSeBotChannelId: input(""),
    systemWidgetSeBotJwt: input(""),
    systemWidgetSeBotPrefix: input("")
  };
}

function createSystemAdapter(calls) {
  return {
    async startSystemOauth(payload = {}) {
      calls.push({ method: "startSystemOauth", payload });
      return { ok: true, data: { ok: true, userCode: "START-1234", verificationUriComplete: "https://www.twitch.tv/activate" } };
    },
    async getSystemOauthDeviceStatus(payload = {}) {
      calls.push({ method: "getSystemOauthDeviceStatus", payload });
      return { ok: true, data: { ok: true, deviceFlow: { userCode: "READY-9876", status: "pending", verificationUriComplete: "https://www.twitch.tv/activate" } } };
    },
    async getSystemOauthStatus() {
      calls.push({ method: "getSystemOauthStatus" });
      return {
        ok: true,
        hasValues: true,
        presence: { twitchClientId: true, twitchBroadcasterId: true, twitchUserAccessToken: true },
        helix: { ready: true }
      };
    },
    async seedSystemOauthProfile(payload = {}) {
      calls.push({ method: "seedSystemOauthProfile", payload });
      return { ok: true, data: { ok: true, presence: { twitchClientId: true, twitchBroadcasterId: true, twitchUserAccessToken: true } } };
    },
    async clearSystemOauthProfile() {
      calls.push({ method: "clearSystemOauthProfile" });
      return { ok: true, data: { ok: true } };
    },
    async syncSystemOauthToMod(payload = {}) {
      calls.push({ method: "syncSystemOauthToMod", payload });
      return {
        ok: true,
        data: {
          ok: true,
          targetModId: "music-request-engine",
          status: { presence: { twitchClientId: true, twitchBroadcasterId: true, twitchUserAccessToken: true } }
        }
      };
    },
    async generateWidgetTemplate(payload = {}) {
      calls.push({ method: "generateWidgetTemplate", payload });
      return { ok: true, data: { ok: true, script: "/* widget */", active: payload } };
    }
  };
}

test("system widget template composes OAuth device-flow actions through the system adapter", async () => {
  const calls = [];
  const opened = [];
  const copied = [];
  const context = loadWidgetRuntimeContext({
    window: {
      location: { origin: "https://example.local" },
      open: url => {
        opened.push(String(url || ""));
        return { closed: false };
      },
      getSelection: () => ({ removeAllRanges() {} })
    },
    navigator: {
      clipboard: { writeText: async value => copied.push(String(value || "")) }
    }
  });
  const runtime = context.createSystemWidgetTemplateRuntimeUi({
    el: createSystemWidgetElements(),
    ui: { devDebugMode: true },
    systemEndpointsAdapter: createSystemAdapter(calls),
    windowRef: context.window,
    documentRef: context.document,
    navigatorRef: context.navigator,
    localStorageRef: context.localStorage,
    setBadge() {}
  });

  assert.equal(await runtime.openSystemWidgetOauthAuthorizeUrl(), true);
  assert.equal(await runtime.copySystemWidgetOauthAuthorizeUrl(), true);

  assert.equal(calls.filter(call => call.method === "getSystemOauthDeviceStatus").length, 2);
  assert.equal(calls.some(call => call.method === "startSystemOauth"), false);
  assert.equal(opened[0].includes("device-code=READY-9876"), true);
  assert.equal(copied[0].includes("device-code=READY-9876"), true);
});

test("system widget template can append a compatible mod widget when combined mode is selected", async () => {
  const calls = [];
  const modCalls = [];
  const elements = createSystemWidgetElements();
  elements.systemWidgetBundleMode.value = "combined";
  const storage = new Map([
    ["ravelink_widget_template_music-request-engine", JSON.stringify({
      songRewardId: "song-reward",
      playlistRewardId: "playlist-reward",
      baseUrl: "https://bridge.example",
      enableChatCommands: true,
      nowPlayingAnnouncerIntervalMs: 1400
    })]
  ]);
  const context = loadWidgetRuntimeContext({
    localStorage: {
      getItem(key) {
        return storage.get(String(key)) || null;
      },
      setItem(key, value) {
        storage.set(String(key), String(value));
      },
      removeItem(key) {
        storage.delete(String(key));
      }
    }
  });
  const runtime = context.createSystemWidgetTemplateRuntimeUi({
    el: elements,
    ui: { modUiSelectedId: "music-request-engine" },
    systemEndpointsAdapter: createSystemAdapter(calls),
    modsEndpointsAdapter: {
      async invokeAction(modId, action, method, payload) {
        modCalls.push({ modId, action, method, payload });
        return { ok: true, json: { ok: true, script: "/* mod widget */" }, text: "" };
      }
    },
    windowRef: context.window,
    documentRef: context.document,
    navigatorRef: context.navigator,
    localStorageRef: context.localStorage,
    setBadge() {}
  });

  assert.equal(await runtime.generateSystemWidgetTemplate(), true);
  assert.match(elements.systemWidgetOutput.value, /\/\* widget \*\//);
  assert.match(elements.systemWidgetOutput.value, /\/\* mod widget \*\//);
  assert.equal(modCalls.length, 1);
  assert.equal(modCalls[0].modId, "music-request-engine");
  assert.equal(modCalls[0].action, "admin_widget_template_get");
  assert.equal(modCalls[0].payload.songRewardId, "song-reward");
});

test("system widget template composes OAuth vault seed clear and mod sync through the vault runtime", async () => {
  const calls = [];
  const badges = [];
  const elements = createSystemWidgetElements();
  const context = loadWidgetRuntimeContext();
  const runtime = context.createSystemWidgetTemplateRuntimeUi({
    el: elements,
    ui: { devDebugMode: true },
    systemEndpointsAdapter: createSystemAdapter(calls),
    windowRef: context.window,
    documentRef: context.document,
    navigatorRef: context.navigator,
    localStorageRef: context.localStorage,
    setBadge: (...args) => badges.push(args)
  });

  assert.equal(await runtime.loadSystemWidgetOauthSyncProfile({ announce: true }), true);
  assert.equal(await runtime.seedSystemWidgetOauthDevVaultFromUi(), true);
  assert.equal(elements.systemWidgetTwitchClientId.value, "");
  assert.equal(elements.systemWidgetTwitchUserAccessToken.value, "");
  assert.equal(elements.systemWidgetTwitchBroadcasterId.value, "");
  assert.equal(elements.systemWidgetTwitchClientId.type, "password");

  elements.systemWidgetTwitchClientId.value = "client-123";
  elements.systemWidgetTwitchUserAccessToken.value = "token-abc";
  elements.systemWidgetTwitchBroadcasterId.value = "broadcaster-42";
  assert.equal(await runtime.syncSystemWidgetOauthToMod(), true);
  assert.equal(await runtime.clearSystemWidgetOauthDevVault(), true);

  const methods = calls.map(call => call.method);
  assert.equal(methods.includes("getSystemOauthStatus"), true);
  assert.equal(methods.filter(method => method === "seedSystemOauthProfile").length, 2);
  assert.equal(methods.includes("syncSystemOauthToMod"), true);
  assert.equal(methods.includes("clearSystemOauthProfile"), true);
  assert.equal(badges.some(args => args[2] === "SYSTEM OAUTH SYNCED TO MOD"), true);
});
