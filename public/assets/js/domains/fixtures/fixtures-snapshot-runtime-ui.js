// [TITLE] Module: public/assets/js/domains/fixtures/fixtures-snapshot-runtime-ui.js
// [TITLE] Purpose: fixture snapshot + catalog application runtime helpers
// [TITLE] Functionality Index:
// [TITLE] - fixture scope signature tracking
// [TITLE] - fixture catalog fan-out to routes/table
// [TITLE] - fixture snapshot application to UI counters and connectivity state

function createFixturesSnapshotRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const windowRef = deps.windowRef || window;
  const updateConnectivityCache = typeof deps.updateConnectivityCache === "function"
    ? deps.updateConnectivityCache
    : (() => {});
  const renderPaletteBrandMenus = typeof deps.renderPaletteBrandMenus === "function"
    ? deps.renderPaletteBrandMenus
    : (() => {});
  const renderRouteFixtureOptions = typeof deps.renderRouteFixtureOptions === "function"
    ? deps.renderRouteFixtureOptions
    : (() => {});
  const renderFixtureRows = typeof deps.renderFixtureRows === "function"
    ? deps.renderFixtureRows
    : (() => {});
  const syncFixtureBrandOptions = typeof deps.syncFixtureBrandOptions === "function"
    ? deps.syncFixtureBrandOptions
    : (() => {});
  const collectFixtureModBrandsFromSnapshot = typeof deps.collectFixtureModBrandsFromSnapshot === "function"
    ? deps.collectFixtureModBrandsFromSnapshot
    : (() => []);
  let lastFixtureScopeTargetsSignatureUi = "";

  function buildFixtureScopeTargetsSignatureUi(fixtures = []) {
    const rows = Array.isArray(fixtures) ? fixtures : [];
    return rows
      .map(row => [
        String(row?.id || "").trim(),
        String(row?.brand || "").trim().toLowerCase(),
        String(row?.zone || "").trim().toLowerCase(),
        row?.enabled !== false ? "1" : "0"
      ].join("|"))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .join(";");
  }

  function applyFixtureCatalogToUi(fixtures = []) {
    const catalog = Array.isArray(fixtures) ? fixtures.slice() : [];
    ui.fixturesCatalog = catalog;
    try {
      renderRouteFixtureOptions(catalog);
    } catch (err) {
      console.warn("[FIXTURES][UI] route selector render failed:", err?.message || err);
    }
    try {
      renderFixtureRows(catalog);
    } catch (err) {
      console.warn("[FIXTURES][UI] fixture table render failed:", err?.message || err);
    }
  }

  function updateFixtures(snapshot) {
    const summary = snapshot?.summary || {};
    const routes = snapshot?.routes || snapshot?.intentRoutes || summary.routes || {};
    const snapshotHasFixturesArray = Array.isArray(snapshot?.fixtures);
    const fixtures = snapshotHasFixturesArray
      ? snapshot.fixtures
      : (Array.isArray(ui.fixturesCatalog) ? ui.fixturesCatalog.slice() : []);
    ui.fixtureModBrands = collectFixtureModBrandsFromSnapshot(summary, fixtures);
    syncFixtureBrandOptions();
    updateConnectivityCache(snapshot?.connectivity || []);
    ui.connectivitySummary = snapshot?.connectivitySummary || null;

    if (el.fixHue) el.fixHue.textContent = String(summary.hue ?? 0);
    if (el.fixWiz) el.fixWiz.textContent = String(summary.wiz ?? 0);
    if (el.fixHueReady) el.fixHueReady.textContent = String(summary.hueReady ?? 0);
    if (el.fixWizReady) el.fixWizReady.textContent = String(summary.wizReady ?? 0);
    ui.engineReadyTargets = Number(summary.hueEngineReady ?? summary.hueReady ?? 0) +
      Number(summary.wizEngineReady ?? summary.wizReady ?? 0);
    ui.engineModeTargets = Number(summary.hueEngine ?? 0) + Number(summary.wizEngine ?? 0);
    if (el.routeHue) el.routeHue.textContent = routes.HUE_STATE || "-";
    if (el.routeWiz) el.routeWiz.textContent = routes.WIZ_PULSE || "-";
    if (el.routeTwitchHue) el.routeTwitchHue.textContent = routes.TWITCH_HUE || "-";
    if (el.routeTwitchWiz) el.routeTwitchWiz.textContent = routes.TWITCH_WIZ || "-";
    if (el.routeHueInput) el.routeHueInput.value = routes.HUE_STATE || "hue";
    if (el.routeWizInput) el.routeWizInput.value = routes.WIZ_PULSE || "wiz";
    if (el.routeTwitchHueInput) el.routeTwitchHueInput.value = routes.TWITCH_HUE || "hue";
    if (el.routeTwitchWizInput) el.routeTwitchWizInput.value = routes.TWITCH_WIZ || "wiz";
    if (el.cfgVer) el.cfgVer.textContent = String(summary.version ?? 0);
    if (el.cfgAt) {
      el.cfgAt.textContent = summary.loadedAt
        ? new Date(summary.loadedAt).toLocaleTimeString()
        : "-";
    }

    applyFixtureCatalogToUi(fixtures);
    renderPaletteBrandMenus({ reason: "fixtures_update" });
    const nextSignature = buildFixtureScopeTargetsSignatureUi(fixtures);
    if (nextSignature !== lastFixtureScopeTargetsSignatureUi) {
      lastFixtureScopeTargetsSignatureUi = nextSignature;
      try {
        windowRef.dispatchEvent(new CustomEvent("ravelink:live-scope-targets-updated", {
          detail: { reason: "fixtures_update" }
        }));
      } catch {}
    }
    ui.fixturesSnapshotLoaded = snapshotHasFixturesArray || fixtures.length > 0;
  }

  return {
    buildFixtureScopeTargetsSignatureUi,
    applyFixtureCatalogToUi,
    updateFixtures
  };
}
