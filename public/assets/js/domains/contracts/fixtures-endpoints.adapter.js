// [TITLE] Module: public/assets/js/domains/contracts/fixtures-endpoints.adapter.js
// [TITLE] Purpose: typed endpoint adapter for fixtures domain UI modules
// [TITLE] Functionality Index:
// [TITLE] - centralize fixture/hue route paths
// [TITLE] - provide explicit fixture CRUD and diagnostics request helpers

/**
 * @typedef {Object} FixturesEndpointsAdapter
 * @property {() => Promise<any>} getFixturesSnapshot
 * @property {() => Promise<any>} getFixturesConfig
 * @property {(fixture: Object) => Promise<{ok:boolean,status:number,data:any}>} saveFixture
 * @property {() => Promise<boolean>} reloadFixtures
 * @property {() => Promise<any>} discoverHueBridge
 * @property {(fixtureId: string) => Promise<{ok:boolean,status:number,data:any}>} deleteFixtureDeleteQuery
 * @property {(fixtureId: string, timeoutMs?: number) => Promise<{ok:boolean,status:number,data:any}>} testConnectivity
 * @property {(payload: Object) => Promise<{ok:boolean,status:number,data:any}>} pairHueBridge
 * @property {(payload: Object) => Promise<{ok:boolean,status:number,data:any}>} addAllHueFixtures
 * @property {() => Promise<any>} discoverWizDevices
 */

async function getFixturesSnapshotWithFallback() {
  const snapshot = await getJson("/fixtures");
  if (!snapshot || snapshot.ok !== true || !Array.isArray(snapshot.fixtures)) {
    return snapshot;
  }

  const resolveRoutes = (...candidates) => {
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
      const entries = Object.entries(candidate).filter(([key, value]) => String(key || "").trim() && value != null);
      if (entries.length > 0) {
        return Object.fromEntries(entries);
      }
    }
    return {};
  };

  if (snapshot.fixtures.length > 0) {
    return {
      ...snapshot,
      routes: resolveRoutes(snapshot.routes, snapshot.intentRoutes)
    };
  }

  const configFallback = await getJson("/fixtures/config");
  const fallbackFixtures = Array.isArray(configFallback?.config?.fixtures)
    ? configFallback.config.fixtures
    : [];
  const fallbackRoutes = resolveRoutes(
    configFallback?.config?.routes,
    configFallback?.config?.intentRoutes
  );
  if (fallbackFixtures.length <= 0) {
    return {
      ...snapshot,
      routes: resolveRoutes(snapshot.routes, snapshot.intentRoutes, fallbackRoutes)
    };
  }

  return {
    ...snapshot,
    fixtures: fallbackFixtures,
    routes: resolveRoutes(snapshot.routes, snapshot.intentRoutes, fallbackRoutes),
    summary: snapshot.summary || configFallback?.config?.summary || {},
    connectivity: Array.isArray(snapshot.connectivity)
      ? snapshot.connectivity
      : (Array.isArray(configFallback?.config?.connectivity) ? configFallback.config.connectivity : []),
    connectivitySummary: snapshot.connectivitySummary || configFallback?.config?.connectivitySummary || null
  };
}

/** @type {FixturesEndpointsAdapter} */
const fixturesEndpointsAdapter = Object.freeze({
  getFixturesSnapshot: () => getFixturesSnapshotWithFallback(),
  getFixturesConfig: () => getJson("/fixtures/config"),
  saveFixture: fixture => postJson("/fixtures/fixture", fixture),
  reloadFixtures: () => api("/fixtures/reload"),
  discoverHueBridge: () => getJson("/hue/discover"),
  deleteFixtureDeleteQuery: fixtureId => deleteJson(`/fixtures/fixture?id=${encodeURIComponent(String(fixtureId || ""))}`),
  testConnectivity: (fixtureId, timeoutMs = 1200) => postJson("/fixtures/connectivity/test", {
    id: String(fixtureId || ""),
    timeoutMs: Number(timeoutMs || 1200)
  }),
  pairHueBridge: payload => postJson("/hue/pair", payload),
  addAllHueFixtures: payload => postJson("/hue/pair/all", payload),
  discoverWizDevices: () => getJson("/wiz/discover")
});
