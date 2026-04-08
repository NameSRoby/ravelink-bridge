// [TITLE] Test Module: test/system-config.service.test.js
// [TITLE] Purpose: verify system config startup browser launch fields are stable

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const createSystemConfigService = require("../src/domains/system/system-config.service");

function makeTempPath(fileName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-system-config-"));
  return path.join(dir, fileName);
}

test("system config exposes browser auto-launch delay defaults and patch alias", () => {
  const storePath = makeTempPath("config.json");
  const service = createSystemConfigService({
    storePath
  });

  const initial = service.getConfig();
  assert.equal(initial.ok, true);
  assert.equal(initial.config.autoLaunchBrowser, true);
  assert.equal(initial.config.autoLaunchDelayMs, 1200);
  assert.equal(initial.config.updateChecksEnabled, true);
  assert.equal(initial.config.updateStartupPromptEnabled, true);

  const patched = service.patchConfig({
    delayMs: 2300,
    updateChecksEnabled: false,
    updateStartupPromptEnabled: false
  });
  assert.equal(patched.ok, true);
  assert.equal(patched.config.autoLaunchDelayMs, 2300);
  assert.equal(patched.config.updateChecksEnabled, false);
  assert.equal(patched.config.updateStartupPromptEnabled, false);
});

test("system config clamps browser auto-launch delay bounds", () => {
  const storePath = makeTempPath("config.json");
  const service = createSystemConfigService({
    storePath
  });

  const minPatched = service.patchConfig({
    autoLaunchDelayMs: -100
  });
  assert.equal(minPatched.ok, true);
  assert.equal(minPatched.config.autoLaunchDelayMs, 0);

  const maxPatched = service.patchConfig({
    autoLaunchDelayMs: 999999
  });
  assert.equal(maxPatched.ok, true);
  assert.equal(maxPatched.config.autoLaunchDelayMs, 30000);
});

test("system config does not persist removed legacy oauth debug fields", () => {
  const storePath = makeTempPath("config.json");
  const service = createSystemConfigService({
    storePath
  });

  const patched = service.patchConfig({
    autoLaunchBrowser: false,
    twitchClientId: "client-123",
    twitchBroadcasterId: "9876543",
    twitchUserAccessToken: "token-value",
    oauthRedirectUri: "http://localhost/callback"
  });
  assert.equal(patched.ok, true);
  assert.equal(patched.config.autoLaunchBrowser, false);
  assert.equal(patched.config.twitchClientId, undefined);
  assert.equal(patched.config.twitchUserAccessToken, undefined);
  assert.equal(patched.config.twitchBroadcasterId, undefined);
  assert.equal(patched.config.oauthRedirectUri, undefined);

  const reloaded = createSystemConfigService({
    storePath
  });
  const reloadedConfig = reloaded.getConfig();
  assert.equal(reloadedConfig.ok, true);
  assert.equal(reloadedConfig.config.autoLaunchBrowser, false);
  assert.equal(reloadedConfig.config.twitchClientId, undefined);
  assert.equal(reloadedConfig.config.twitchUserAccessToken, undefined);
  assert.equal(reloadedConfig.config.twitchBroadcasterId, undefined);

  const configFileRaw = fs.readFileSync(storePath, "utf8");
  assert.equal(configFileRaw.includes("token-value"), false);
  assert.equal(configFileRaw.includes("client-123"), false);
  assert.equal(configFileRaw.includes("oauthRedirectUri"), false);
});
