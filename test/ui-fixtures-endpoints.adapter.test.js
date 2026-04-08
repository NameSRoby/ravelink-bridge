const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadFixturesEndpointsAdapter(getJsonImpl) {
  const filePath = path.resolve(__dirname, "../public/assets/js/domains/contracts/fixtures-endpoints.adapter.js");
  const code = fs.readFileSync(filePath, "utf8");
  const context = {
    console,
    getJson: getJsonImpl,
    postJson: async () => ({ ok: true }),
    api: async () => true,
    deleteJson: async () => ({ ok: true })
  };
  vm.createContext(context);
  vm.runInContext(`${code}\nthis.__fixturesEndpointsAdapter = fixturesEndpointsAdapter;`, context, { filename: filePath });
  return context.__fixturesEndpointsAdapter;
}

test("fixtures endpoints adapter backfills empty snapshot inventory from config", async () => {
  const adapter = loadFixturesEndpointsAdapter(async url => {
    if (url === "/fixtures") {
      return {
        ok: true,
        fixtures: [],
        summary: null,
        connectivity: null,
        connectivitySummary: null
      };
    }
    if (url === "/fixtures/config") {
      return {
        ok: true,
        config: {
          fixtures: [{ id: "wiz-desk", brand: "wiz", ip: "192.168.1.10" }],
          intentRoutes: { wiz: true },
          summary: { wiz: 1, total: 1 },
          connectivity: [{ id: "wiz-desk", reachable: true }],
          connectivitySummary: { total: 1, reachable: 1 }
        }
      };
    }
    return null;
  });

  const snapshot = await adapter.getFixturesSnapshot();

  assert.equal(Array.isArray(snapshot.fixtures), true);
  assert.equal(snapshot.fixtures.length, 1);
  assert.equal(snapshot.fixtures[0].id, "wiz-desk");
  assert.equal(snapshot.routes?.wiz, true);
  assert.equal(snapshot.summary?.wiz, 1);
  assert.equal(snapshot.summary?.total, 1);
  assert.equal(Array.isArray(snapshot.connectivity), true);
  assert.equal(snapshot.connectivity[0]?.id, "wiz-desk");
  assert.equal(snapshot.connectivity[0]?.reachable, true);
  assert.equal(snapshot.connectivitySummary?.total, 1);
  assert.equal(snapshot.connectivitySummary?.reachable, 1);
});

test("fixtures endpoints adapter preserves non-empty snapshot inventory without config override", async () => {
  let configRequests = 0;
  const adapter = loadFixturesEndpointsAdapter(async url => {
    if (url === "/fixtures") {
      return {
        ok: true,
        fixtures: [{ id: "hue-main", brand: "hue", lightId: 1 }],
        routes: { hue: true },
        summary: { hue: 1, total: 1 },
        connectivity: [{ id: "hue-main", reachable: true }],
        connectivitySummary: { total: 1, reachable: 1 }
      };
    }
    if (url === "/fixtures/config") {
      configRequests += 1;
      return {
        ok: true,
        config: {
          fixtures: [{ id: "unused", brand: "wiz" }]
        }
      };
    }
    return null;
  });

  const snapshot = await adapter.getFixturesSnapshot();

  assert.equal(snapshot.fixtures[0].id, "hue-main");
  assert.equal(snapshot.summary?.hue, 1);
  assert.equal(snapshot.summary?.total, 1);
  assert.equal(configRequests, 0);
});
