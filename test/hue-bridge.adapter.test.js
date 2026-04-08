// [TITLE] Test Module: test/hue-bridge.adapter.test.js
// [TITLE] Purpose: verify Hue adapter timeout fallback and error-log throttling

const test = require("node:test");
const assert = require("node:assert/strict");

const createHueBridgeAdapter = require("../src/adapters/brands/hue-bridge.adapter");

test("Hue adapter lists bridge lights from legacy API inventory", async () => {
  const adapter = createHueBridgeAdapter({
    axios: {
      get: async () => ({
        status: 200,
        data: {
          "2": { name: "Desk 2", modelid: "LCA001", type: "Extended color light" },
          "1": { name: "Desk 1", modelid: "LCA001", type: "Extended color light" },
          abc: { name: "invalid" }
        }
      })
    },
    dryRun: false
  });
  const result = await adapter.listLights({
    bridgeIp: "192.168.1.120",
    username: "test-user"
  });
  assert.equal(result.ok, true);
  assert.equal(result.bridgeIp, "192.168.1.120");
  assert.equal(Array.isArray(result.lights), true);
  assert.equal(result.lights.length, 2);
  assert.equal(result.lights[0].lightId, 1);
  assert.equal(result.lights[1].lightId, 2);
  assert.equal(result.lights[0].name, "Desk 1");
});

test("Hue adapter falls back to HTTP when HTTPS request times out", async () => {
  const calls = [];
  const axios = {
    put: async (url) => {
      calls.push(url);
      if (url.startsWith("https://")) {
        const error = new Error("timeout of 1800ms exceeded");
        error.code = "ECONNABORTED";
        throw error;
      }
      return { status: 200, data: [{ success: true }] };
    }
  };
  const adapter = createHueBridgeAdapter({
    axios,
    dryRun: false,
    now: () => 1000
  });
  const result = await adapter.sendState([
    {
      brand: "hue",
      bridgeIp: "192.168.1.10",
      username: "testuser",
      lightId: 1
    }
  ], { on: true, bri: 120 });

  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].startsWith("https://"), true);
  assert.equal(calls[1].startsWith("http://"), true);
});

test("Hue adapter throttles repeated identical send errors", async () => {
  let nowTick = 1000;
  const logWarnings = [];
  const axios = {
    put: async () => {
      throw new Error("network timeout");
    }
  };
  const adapter = createHueBridgeAdapter({
    axios,
    dryRun: false,
    now: () => nowTick,
    log: {
      warn: (...args) => {
        logWarnings.push(args.join(" "));
      }
    }
  });

  await adapter.sendState([
    { brand: "hue", bridgeIp: "192.168.1.10", username: "user", lightId: 1 }
  ], { on: true });
  nowTick = 1100;
  await adapter.sendState([
    { brand: "hue", bridgeIp: "192.168.1.10", username: "user", lightId: 1 }
  ], { on: true });
  nowTick = 17000;
  await adapter.sendState([
    { brand: "hue", bridgeIp: "192.168.1.10", username: "user", lightId: 1 }
  ], { on: true });

  assert.equal(logWarnings.length, 2);
  assert.equal(logWarnings[0].includes("[HUE] state send failed:"), true);
  assert.equal(logWarnings[1].includes("[HUE] state send failed:"), true);
});

test("Hue adapter applies temporary cooldown after timeout failures", async () => {
  let nowTick = 1000;
  let calls = 0;
  const axios = {
    put: async () => {
      calls += 1;
      const error = new Error("timeout of 1800ms exceeded");
      error.code = "ECONNABORTED";
      throw error;
    }
  };
  const adapter = createHueBridgeAdapter({
    axios,
    dryRun: false,
    now: () => nowTick,
    log: {
      warn() {}
    }
  });
  const fixture = {
    brand: "hue",
    bridgeIp: "192.168.1.10",
    username: "user",
    lightId: 1
  };

  const first = await adapter.sendState([fixture], { on: true });
  assert.equal(first.sent, 0);
  assert.equal(first.failed, 1);
  assert.equal(calls, 2);

  // [DEV] Immediate re-send should be skipped due to transient bridge cooldown.
  nowTick = 1050;
  const second = await adapter.sendState([fixture], { on: true });
  assert.equal(second.sent, 0);
  assert.equal(second.failed, 0);
  assert.equal(second.skipped, 1);
  assert.equal(calls, 2);

  // [DEV] After cooldown window passes, adapter should retry bridge transport.
  nowTick = 5000;
  const third = await adapter.sendState([fixture], { on: true });
  assert.equal(third.sent, 0);
  assert.equal(third.failed, 1);
  assert.equal(calls, 4);
});

test("Hue adapter honors fixture capability forceHttp hint", async () => {
  const calls = [];
  const axios = {
    put: async (url) => {
      calls.push(url);
      return { status: 200, data: [{ success: true }] };
    }
  };
  const adapter = createHueBridgeAdapter({
    axios,
    dryRun: false,
    now: () => 1000
  });
  const result = await adapter.sendState([
    {
      brand: "hue",
      bridgeIp: "192.168.1.30",
      username: "http-only-user",
      lightId: 2,
      extras: {
        hueBridgeCapabilities: {
          forceHttp: true,
          supportsHttps: false,
          supportsEntertainment: false,
          bridgeModelId: "BSB001"
        }
      }
    }
  ], { on: true, bri: 180 });

  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].startsWith("http://"), true);
});

test("Hue adapter keeps entertainment RGB independent from bri when __rgb is unavailable", async () => {
  const frames = [];
  const entertainmentRuntime = {
    getStatus: () => ({
      available: true,
      reason: ""
    }),
    sendFrame: async (_config, frameInput) => {
      frames.push(frameInput);
      return { ok: true };
    },
    stopAll: async () => ({ ok: true })
  };
  const adapter = createHueBridgeAdapter({
    axios: {
      put: async () => {
        throw new Error("rest_fallback_should_not_run");
      }
    },
    dryRun: false,
    now: () => 1000,
    createHueEntertainmentRuntime: () => entertainmentRuntime
  });

  const result = await adapter.sendState([{
    brand: "hue",
    bridgeIp: "192.168.1.10",
    username: "ent-user",
    lightId: 1,
    clientKey: "A".repeat(32),
    entertainmentAreaId: "desk-area",
    bridgeId: "ECB5FAFFFE923D75",
    extras: {
      hueBridgeCapabilities: {
        supportsEntertainment: true,
        supportsHttps: true,
        forceHttp: false,
        bridgeModelId: "BSB002"
      }
    }
  }], {
    on: true,
    xy: [0.3127, 0.3290],
    bri: 12
  });

  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].bri, 12);
  assert.ok(Number(frames[0].rgb?.r) >= 220);
  assert.ok(Number(frames[0].rgb?.g) >= 220);
  assert.ok(Number(frames[0].rgb?.b) >= 220);
});
