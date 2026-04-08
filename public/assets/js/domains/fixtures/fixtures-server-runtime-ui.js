// [TITLE] Module: public/assets/js/domains/fixtures/fixtures-server-runtime-ui.js
// [TITLE] Purpose: fixture snapshot/catalog server refresh ownership runtime
// [TITLE] Functionality Index:
// [TITLE] - snapshot retry + config fallback loading
// [TITLE] - refresh/apply ownership for fixture server sync
// [TITLE] - catalog lookup/upsert helpers shared by routing and form flows
// [DEV] Complex Flow:
// [DEV] Fixture save/routing flows need a stable local catalog even while the
// [DEV] server snapshot is still warming. Keep the fallback order deterministic
// [DEV] so route editors and form saves always fan out through one snapshot owner.
function createFixturesServerRuntimeUi(deps = {}) {
  const ui = deps.ui || {};
  const fixturesEndpointsAdapter = deps.fixturesEndpointsAdapter;
  const requiredAdapterMethods = ["getFixturesSnapshot", "getFixturesConfig"];
  if (!fixturesEndpointsAdapter || typeof fixturesEndpointsAdapter !== "object") {
    throw new Error("fixtures server runtime requires fixturesEndpointsAdapter");
  }
  for (const methodName of requiredAdapterMethods) {
    if (typeof fixturesEndpointsAdapter[methodName] !== "function") {
      throw new Error(`fixtures server runtime missing adapter method: ${methodName}`);
    }
  }
  const updateFixtures = typeof deps.updateFixtures === "function" ? deps.updateFixtures : (() => {});
  const setTimeoutRef = typeof deps.setTimeoutRef === "function" ? deps.setTimeoutRef : setTimeout;

  async function loadFixturesSnapshot(attempts = 1) {
    const maxAttempts = Math.max(1, Math.min(5, Number(attempts) || 1));
    for (let i = 0; i < maxAttempts; i += 1) {
      const snapshot = await fixturesEndpointsAdapter.getFixturesSnapshot();
      if (snapshot && Array.isArray(snapshot.fixtures)) {
        return snapshot;
      }
      if (i < (maxAttempts - 1)) {
        await new Promise(resolve => setTimeoutRef(resolve, 140));
      }
    }

    const configSnapshot = await fixturesEndpointsAdapter.getFixturesConfig();
    if (configSnapshot?.ok && Array.isArray(configSnapshot?.config?.fixtures)) {
      return {
        fixtures: configSnapshot.config.fixtures,
        routes: configSnapshot.config.intentRoutes || {},
        summary: configSnapshot.config.summary || {},
        connectivity: Array.isArray(configSnapshot.config.connectivity) ? configSnapshot.config.connectivity : [],
        connectivitySummary: configSnapshot.config.connectivitySummary || null
      };
    }
    return null;
  }

  async function refreshFixturesFromServer(options = {}) {
    const attempts = Math.max(1, Math.min(5, Number(options.attempts) || 1));
    const clearOnFail = options.clearOnFail === true;
    const snapshot = await loadFixturesSnapshot(attempts);
    if (snapshot) {
      updateFixtures(snapshot);
      return { ok: true, snapshot };
    }

    if (clearOnFail) {
      updateFixtures({
        fixtures: [],
        routes: {},
        summary: {},
        connectivity: [],
        connectivitySummary: null
      });
    }

    return { ok: false, snapshot: null };
  }

  async function getKnownFixtureCatalog() {
    const localCatalog = Array.isArray(ui.fixturesCatalog) ? ui.fixturesCatalog.slice() : [];
    if (localCatalog.length) return localCatalog;

    const snapshot = await loadFixturesSnapshot(2);
    if (snapshot && Array.isArray(snapshot.fixtures)) {
      return snapshot.fixtures.slice();
    }
    return localCatalog;
  }

  function upsertFixtureCatalogEntry(fixture = {}, options = {}) {
    const source = Array.isArray(options.catalogSeed)
      ? options.catalogSeed.slice()
      : (Array.isArray(ui.fixturesCatalog) ? ui.fixturesCatalog.slice() : []);
    const replaceId = String(options.replaceId || "").trim();
    const nextId = String(fixture?.id || "").trim();
    if (!nextId) return source;

    return [
      ...source.filter(row => {
        const id = String(row?.id || "").trim();
        if (!id) return false;
        if (id === nextId) return false;
        if (replaceId && id === replaceId) return false;
        return true;
      }),
      { ...fixture, id: nextId }
    ];
  }

  return {
    loadFixturesSnapshot,
    refreshFixturesFromServer,
    getKnownFixtureCatalog,
    upsertFixtureCatalogEntry
  };
}
