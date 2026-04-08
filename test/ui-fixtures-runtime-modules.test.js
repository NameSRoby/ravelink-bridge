const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadScript(relativeFile, extraContext = {}) {
  const filePath = path.resolve(__dirname, "..", relativeFile);
  const code = fs.readFileSync(filePath, "utf8");
  const context = {
    console,
    ...extraContext
  };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: filePath });
  return context;
}

test("fixtures endpoints adapter owns empty-snapshot fallback hydration", async () => {
  const getJsonCalls = [];
  const context = loadScript(
    "public/assets/js/domains/contracts/fixtures-endpoints.adapter.js",
    {
      getJson: async route => {
        getJsonCalls.push(route);
        if (route === "/fixtures") {
          return {
            ok: true,
            fixtures: [],
            routes: {},
            summary: null,
            connectivity: null,
            connectivitySummary: null
          };
        }
        if (route === "/fixtures/config") {
          return {
            ok: true,
            config: {
              fixtures: [{ id: "fixture-1", brand: "hue" }],
              intentRoutes: { HUE_STATE: "hue" },
              summary: { hue: 1, hueReady: 1, hueEngine: 1, hueEngineReady: 1 },
              connectivity: [{ id: "fixture-1", ok: true }],
              connectivitySummary: { ready: 1, total: 1 }
            }
          };
        }
        return null;
      },
      postJson: async () => ({ ok: true }),
      deleteJson: async () => ({ ok: true }),
      api: async () => true
    }
  );

  const snapshot = await context.getFixturesSnapshotWithFallback();
  assert.deepEqual(getJsonCalls, ["/fixtures", "/fixtures/config"]);
  assert.equal(snapshot.fixtures.length, 1);
  assert.equal(snapshot.routes.HUE_STATE, "hue");
  assert.equal(snapshot.summary.hue, 1);
  assert.equal(Array.isArray(snapshot.connectivity), true);
  assert.equal(snapshot.connectivitySummary.ready, 1);
});

test("fixtures snapshot runtime applies summary, routes, and connectivity state consistently", () => {
  const events = [];
  const windowRef = {
    dispatchEvent(event) {
      events.push(event);
    }
  };
  const el = {
    fixHue: { textContent: "" },
    fixWiz: { textContent: "" },
    fixHueReady: { textContent: "" },
    fixWizReady: { textContent: "" },
    routeHue: { textContent: "" },
    routeWiz: { textContent: "" },
    routeTwitchHue: { textContent: "" },
    routeTwitchWiz: { textContent: "" },
    routeHueInput: { value: "" },
    routeWizInput: { value: "" },
    routeTwitchHueInput: { value: "" },
    routeTwitchWizInput: { value: "" },
    cfgVer: { textContent: "" },
    cfgAt: { textContent: "" }
  };
  const ui = {
    fixturesCatalog: []
  };
  let connectivityRows = null;
  let renderedCatalog = null;

  const context = loadScript(
    "public/assets/js/domains/fixtures/fixtures-snapshot-runtime-ui.js",
    {
      window: windowRef,
      CustomEvent: function CustomEvent(type, init) {
        this.type = type;
        this.detail = init?.detail || null;
      }
    }
  );

  const runtime = context.createFixturesSnapshotRuntimeUi({
    el,
    ui,
    windowRef,
    updateConnectivityCache(rows) {
      connectivityRows = rows;
    },
    renderPaletteBrandMenus() {},
    renderRouteFixtureOptions(catalog) {
      renderedCatalog = catalog;
    },
    renderFixtureRows() {},
    syncFixtureBrandOptions() {},
    collectFixtureModBrandsFromSnapshot(summary, fixtures) {
      return summary.hue > 0 && fixtures.length ? ["mod-hue"] : [];
    }
  });

  runtime.updateFixtures({
    fixtures: [{ id: "fixture-1", brand: "hue", zone: "left", enabled: true }],
    routes: {
      HUE_STATE: "hue",
      WIZ_PULSE: "wiz",
      TWITCH_HUE: "hue",
      TWITCH_WIZ: "wiz"
    },
    summary: {
      hue: 1,
      wiz: 0,
      hueReady: 1,
      wizReady: 0,
      hueEngine: 1,
      wizEngine: 0,
      hueEngineReady: 1,
      wizEngineReady: 0,
      version: 5,
      loadedAt: "2026-04-03T01:02:03.000Z"
    },
    connectivity: [{ id: "fixture-1", ok: true }],
    connectivitySummary: { ready: 1, total: 1 }
  });

  assert.equal(el.fixHue.textContent, "1");
  assert.equal(el.routeHue.textContent, "hue");
  assert.equal(ui.engineReadyTargets, 1);
  assert.equal(ui.engineModeTargets, 1);
  assert.deepEqual(ui.fixtureModBrands, ["mod-hue"]);
  assert.equal(ui.fixturesSnapshotLoaded, true);
  assert.deepEqual(renderedCatalog, [{ id: "fixture-1", brand: "hue", zone: "left", enabled: true }]);
  assert.deepEqual(connectivityRows, [{ id: "fixture-1", ok: true }]);
  assert.equal(ui.connectivitySummary.ready, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "ravelink:live-scope-targets-updated");
});

test("fixtures server runtime retries snapshot load, falls back to config, and upserts catalog entries", async () => {
  let snapshotCalls = 0;
  const appliedSnapshots = [];
  const context = loadScript(
    "public/assets/js/domains/fixtures/fixtures-server-runtime-ui.js"
  );

  const runtime = context.createFixturesServerRuntimeUi({
    ui: {
      fixturesCatalog: [{ id: "fixture-1", brand: "hue" }]
    },
    setTimeoutRef(resolve) {
      resolve();
    },
    fixturesEndpointsAdapter: {
      async getFixturesSnapshot() {
        snapshotCalls += 1;
        if (snapshotCalls < 2) return null;
        return {
          fixtures: [{ id: "fixture-2", brand: "wiz" }],
          routes: { HUE_STATE: "hue" },
          summary: { wiz: 1 },
          connectivity: [],
          connectivitySummary: { ready: 1, total: 1 }
        };
      },
      async getFixturesConfig() {
        return {
          ok: true,
          config: {
            fixtures: [{ id: "fixture-config", brand: "hue" }],
            intentRoutes: { HUE_STATE: "hue" },
            summary: { hue: 1 },
            connectivity: [],
            connectivitySummary: { ready: 1, total: 1 }
          }
        };
      }
    },
    updateFixtures(snapshot) {
      appliedSnapshots.push(snapshot);
    }
  });

  const loaded = await runtime.loadFixturesSnapshot(2);
  assert.equal(snapshotCalls, 2);
  assert.equal(loaded.fixtures[0].id, "fixture-2");

  const fallbackRuntime = context.createFixturesServerRuntimeUi({
    ui: { fixturesCatalog: [] },
    setTimeoutRef(resolve) {
      resolve();
    },
    fixturesEndpointsAdapter: {
      async getFixturesSnapshot() {
        return null;
      },
      async getFixturesConfig() {
        return {
          ok: true,
          config: {
            fixtures: [{ id: "fixture-config", brand: "hue" }],
            intentRoutes: { HUE_STATE: "hue" },
            summary: { hue: 1 },
            connectivity: [{ id: "fixture-config", ok: true }],
            connectivitySummary: { ready: 1, total: 1 }
          }
        };
      }
    }
  });
  const fallbackLoaded = await fallbackRuntime.loadFixturesSnapshot(1);
  assert.equal(fallbackLoaded.fixtures[0].id, "fixture-config");
  assert.equal(fallbackLoaded.connectivitySummary.ready, 1);

  const refreshed = await runtime.refreshFixturesFromServer({ attempts: 1 });
  assert.equal(refreshed.ok, true);
  assert.equal(appliedSnapshots.length, 1);
  assert.equal(appliedSnapshots[0].fixtures[0].id, "fixture-2");

  const known = await runtime.getKnownFixtureCatalog();
  assert.deepEqual(known, [{ id: "fixture-1", brand: "hue" }]);

  const upserted = runtime.upsertFixtureCatalogEntry(
    { id: "fixture-3", brand: "mod" },
    { replaceId: "fixture-1" }
  );
  assert.deepEqual(
    Array.from(upserted, row => ({ id: row.id, brand: row.brand })),
    [{ id: "fixture-3", brand: "mod" }]
  );
});
