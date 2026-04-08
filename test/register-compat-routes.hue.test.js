// [TITLE] Test Module: test/register-compat-routes.hue.test.js
// [TITLE] Purpose: verify Hue discover/pair compatibility route behavior

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const registerCompatRoutes = require("../src/app/register-compat-routes");

function toUrl(baseUrl, routePath = "/") {
  const normalized = String(routePath || "/").startsWith("/")
    ? String(routePath || "/")
    : `/${String(routePath || "")}`;
  return `${String(baseUrl || "").replace(/\/+$/, "")}${normalized}`;
}

async function requestJson(baseUrl, method, routePath, body = null) {
  const response = await fetch(toUrl(baseUrl, routePath), {
    method,
    headers: {
      "Content-Type": "application/json",
      Connection: "close"
    },
    body: body === null ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { __raw: text };
  }
  return {
    ok: response.ok,
    status: response.status,
    data
  };
}

async function withCompatServer(deps, run) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));
  registerCompatRoutes(app, deps);
  const listener = await new Promise(resolve => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
  const address = listener.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise(resolve => listener.close(resolve));
  }
}

function createDeps(overrides = {}) {
  return {
    enforceWriteAccess(_req, _res, next) {
      next();
    },
    midiManager: {
      getStatus: () => ({ ok: true }),
      refreshStatus: () => ({ ok: true, status: { ok: true } }),
      patchConfig: () => ({ ok: true, status: { ok: true } }),
      cancelLearn: () => ({ ok: true, status: { ok: true } }),
      armLearn: () => ({ ok: true, status: { ok: true } }),
      triggerAction: () => ({ ok: true, status: { ok: true } }),
      resetBindings: () => ({ ok: true, status: { ok: true } }),
      saveBinding: () => ({ ok: true, status: { ok: true } }),
      clearBinding: () => ({ ok: true, status: { ok: true } })
    },
    modRuntime: {
      list: () => ({ ok: true, mods: [], total: 0, loaded: 0 }),
      getSupportedHooks: () => [],
      getUiCatalog: () => ({ ok: true, mods: [] }),
      reload: async () => ({ ok: true }),
      setDebugEnabled: () => ({ ok: true }),
      clearDebugBuffer: () => ({ ok: true }),
      importMods: async () => ({ ok: true }),
      updateConfig: async () => ({ ok: true }),
      invokeAction: async () => ({ status: 200, body: { ok: true } }),
      handleHttp: async () => ({ status: 200, body: { ok: true } }),
      resolveUiAsset: () => ({ ok: false, error: "mod_ui_not_found" })
    },
    fixtureRegistry: {
      getFixtures: () => [],
      getIntentRoutes: () => ({}),
      load: () => {},
      upsertFixture: fixture => ({ ok: true, fixture }),
      deleteFixture: () => ({ ok: true }),
      getConnectivitySnapshot: () => ({ ok: true, rows: [] }),
      testConnectivity: () => ({ ok: true })
    },
    liveCompatService: {
      getCompatibility: () => ({ ok: true, snapshot: {} }),
      patchCompatibility: () => ({ ok: true }),
      getTriggerMatrix: () => ({ ok: true }),
      patchTriggerMatrix: () => ({ ok: true }),
      getPaletteSnapshot: () => ({ ok: true }),
      patchPalette: () => ({ ok: true }),
      getFixtureMetricsSnapshot: () => ({ ok: true }),
      patchFixtureMetrics: () => ({ ok: true }),
      clearFixtureRouting: () => ({ ok: true }),
      getOverclockTiers: () => ({ ok: true, tiers: [] }),
      setOverclockAuto: () => ({ ok: true }),
      setOverclockPresetLevel: () => ({ ok: true }),
      setOverclockDevHz: () => ({ ok: true })
    },
    systemConfigService: {
      getConfig: () => ({ ok: true, config: {} }),
      patchConfig: () => ({ ok: true, config: {} }),
      generateWidgetTemplate: () => ({ ok: true, script: "" })
    },
    audioEngine: {
      getStatus: () => ({ backend: "unwired", telemetryUpdatedAt: 0 }),
      stopRave: () => ({ ok: true })
    },
    hueBridge: {
      discoverBridges: async () => ({ ok: true, bridges: [] }),
      pairBridge: async () => ({ ok: false, error: "not_configured" }),
      listLights: async () => ({ ok: true, lights: [] })
    },
    ...overrides
  };
}

test("compat hue discover route returns normalized bridge list", async () => {
  await withCompatServer(createDeps({
    hueBridge: {
      discoverBridges: async () => ({
        ok: true,
        bridges: [
          { id: "001788FFEEABCDEF", ip: "192.168.1.20" },
          { id: "", ip: "bridge.local" }
        ]
      }),
      pairBridge: async () => ({ ok: false, error: "not_configured" })
    }
  }), async baseUrl => {
    const response = await requestJson(baseUrl, "GET", "/hue/discover");
    assert.equal(response.status, 200);
    assert.equal(response.data?.ok, true);
    assert.equal(Array.isArray(response.data?.bridges), true);
    assert.equal(response.data?.bridges?.[0]?.ip, "192.168.1.20");
    assert.equal(response.data?.bridges?.[1]?.ip, "bridge.local");
  });
});

test("compat hue pair route returns credentials and saves fixture when requested", async () => {
  await withCompatServer(createDeps({
    hueBridge: {
      discoverBridges: async () => ({ ok: true, bridges: [] }),
      pairBridge: async () => ({
        ok: true,
        bridge: { ip: "192.168.1.50", id: "001788FFEEABCDEF" },
        credentials: { username: "user-a", clientKey: "aabbccdd" },
        entertainmentAreas: [{ id: "7", name: "Desk" }]
      })
    }
  }), async baseUrl => {
    const response = await requestJson(baseUrl, "POST", "/hue/pair", {
      bridgeIp: "192.168.1.50",
      saveFixture: true,
      fixture: {
        id: "desk-main",
        lightId: 3,
        zone: "desk",
        engineEnabled: true,
        twitchEnabled: true
      }
    });
    assert.equal(response.status, 200);
    assert.equal(response.data?.ok, true);
    assert.equal(response.data?.credentials?.username, "user-a");
    assert.equal(response.data?.credentials?.clientKey, "AABBCCDD");
    assert.equal(response.data?.fixtureSaved, true);
    assert.equal(response.data?.fixture?.id, "desk-main");
    assert.equal(response.data?.fixture?.entertainmentAreaId, "Desk");
  });
});

test("compat hue pair route returns missing_entertainment_area when required", async () => {
  await withCompatServer(createDeps({
    hueBridge: {
      discoverBridges: async () => ({ ok: true, bridges: [] }),
      pairBridge: async () => ({
        ok: true,
        bridge: { ip: "192.168.1.60", id: "001788FFEE000001" },
        credentials: { username: "user-b", clientKey: "0011" },
        entertainmentAreas: []
      })
    }
  }), async baseUrl => {
    const response = await requestJson(baseUrl, "POST", "/hue/pair", {
      bridgeIp: "192.168.1.60",
      saveFixture: false
    });
    assert.equal(response.status, 400);
    assert.equal(response.data?.ok, false);
    assert.equal(response.data?.error, "missing_entertainment_area");
  });
});

test("compat hue pair route allows legacy bridge pairing without entertainment area", async () => {
  await withCompatServer(createDeps({
    hueBridge: {
      discoverBridges: async () => ({ ok: true, bridges: [] }),
      pairBridge: async () => ({
        ok: true,
        bridge: { ip: "192.168.1.70", id: "001788FFEE000070" },
        credentials: { username: "user-c", clientKey: "" },
        entertainmentAreas: [],
        capabilities: {
          bridgeModelId: "BSB001",
          supportsHttps: false,
          supportsEntertainment: false,
          forceHttp: true
        }
      })
    }
  }), async baseUrl => {
    const response = await requestJson(baseUrl, "POST", "/hue/pair", {
      bridgeIp: "192.168.1.70",
      saveFixture: true,
      fixture: {
        id: "legacy-main",
        lightId: 1
      }
    });
    assert.equal(response.status, 200);
    assert.equal(response.data?.ok, true);
    assert.equal(response.data?.capabilities?.bridgeModelId, "BSB001");
    assert.equal(response.data?.fixtureSaved, true);
    assert.equal(response.data?.fixture?.clientKey, "");
    assert.equal(response.data?.fixture?.entertainmentAreaId, "");
    assert.equal(
      response.data?.fixture?.extras?.hueBridgeCapabilities?.supportsEntertainment,
      false
    );
  });
});

test("compat hue pair all route adds one fixture per Hue light", async () => {
  const savedFixtures = [];
  const existingFixtures = [
    {
      id: "hue-001788ffeeab-1",
      brand: "hue",
      zone: "hue",
      bridgeIp: "192.168.1.90",
      username: "user-bulk",
      lightId: 1
    }
  ];
  await withCompatServer(createDeps({
    fixtureRegistry: {
      getFixtures: () => existingFixtures.slice(),
      getIntentRoutes: () => ({}),
      load: () => {},
      upsertFixture: fixture => {
        savedFixtures.push({ ...fixture });
        return { ok: true, fixture };
      },
      deleteFixture: () => ({ ok: true }),
      getConnectivitySnapshot: () => ({ ok: true, rows: [] }),
      testConnectivity: () => ({ ok: true })
    },
    hueBridge: {
      discoverBridges: async () => ({ ok: true, bridges: [] }),
      pairBridge: async () => ({ ok: false, error: "not_required" }),
      listLights: async () => ({
        ok: true,
        lights: [
          { lightId: 1, name: "Desk 1" },
          { lightId: 2, name: "Desk 2" }
        ]
      })
    }
  }), async baseUrl => {
    const response = await requestJson(baseUrl, "POST", "/hue/pair/all", {
      bridgeIp: "192.168.1.90",
      bridgeId: "001788FFEEABCDEF",
      username: "user-bulk",
      clientKey: "aabb",
      entertainmentAreaId: "Desk",
      fixture: {
        zone: "desk",
        engineEnabled: true,
        twitchEnabled: true
      }
    });

    assert.equal(response.status, 200);
    assert.equal(response.data?.ok, true);
    assert.equal(response.data?.totalLights, 2);
    assert.equal(response.data?.added, 1);
    assert.equal(response.data?.updated, 1);
    assert.equal(Array.isArray(response.data?.fixtures), true);
    assert.equal(response.data?.fixtures?.length, 2);
    assert.equal(savedFixtures.length, 2);
    assert.equal(savedFixtures[0]?.id, "hue-001788ffeeab-1");
    assert.equal(savedFixtures[1]?.id, "hue-001788ffeeab-2");
    assert.equal(savedFixtures[0]?.entertainmentAreaId, "Desk");
    assert.equal(savedFixtures[1]?.entertainmentAreaId, "Desk");
  });
});

test("compat hue pair all route requires Hue username", async () => {
  await withCompatServer(createDeps({
    hueBridge: {
      discoverBridges: async () => ({ ok: true, bridges: [] }),
      pairBridge: async () => ({ ok: false, error: "not_required" }),
      listLights: async () => ({ ok: true, lights: [{ lightId: 1, name: "Desk" }] })
    }
  }), async baseUrl => {
    const response = await requestJson(baseUrl, "POST", "/hue/pair/all", {
      bridgeIp: "192.168.1.90"
    });
    assert.equal(response.status, 400);
    assert.equal(response.data?.ok, false);
    assert.equal(response.data?.error, "missing_hue_username");
  });
});
