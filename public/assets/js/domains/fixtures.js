// [TITLE] Module: public/assets/js/domains/fixtures.js
// [TITLE] Purpose: fixture snapshot + route/catalog UI sync ownership
// [TITLE] Functionality Index:
// [TITLE] - fixture catalog render fan-out
// [TITLE] - fixture poll snapshot application
// [TITLE] Fixture UI Sync Helpers
// [DEV] These helpers keep fixture snapshot application centralized so poll/save
// [DEV] paths share one UI update contract (catalog rows, route selectors,
// [DEV] connectivity summary, and fixture cards).
// [TITLE] Section: WiZ Onboarding Runtime Composition
// [DEV] WiZ onboarding helper logic is isolated so manual-IP-first UX can evolve
// [DEV] without growing this fixtures orchestrator file.
const fixturesEndpointsAdapterRef = (
  typeof fixturesEndpointsAdapter === "object" &&
  fixturesEndpointsAdapter
)
  ? fixturesEndpointsAdapter
  : null;
const fixturesUiInputAdapter = (typeof createFixturesUiInputAdapter === "function"
  ? createFixturesUiInputAdapter({
    modBrandRe: MOD_BRAND_RE
  })
  : (() => {
    throw new Error("fixtures UI input adapter module missing");
  })());
function getCanonicalZoneForBrand(brand, fallback = "custom") {
  return fixturesUiInputAdapter.getCanonicalZoneForBrand(brand, fallback);
}

function normalizeZoneKey(value, fallback = "custom") {
  return fixturesUiInputAdapter.normalizeZoneKey(value, fallback);
}

function isBuiltinFixtureBrand(value) {
  return fixturesUiInputAdapter.isBuiltinFixtureBrand(value);
}

function normalizeFixtureModBrandToken(value) {
  return fixturesUiInputAdapter.normalizeFixtureModBrandToken(value);
}

function normalizeFixtureModBrandList(value) {
  return fixturesUiInputAdapter.normalizeFixtureModBrandList(value);
}

function collectFixtureModBrandsFromSnapshot(summary = {}, fixtures = []) {
  return fixturesUiInputAdapter.collectFixtureModBrandsFromSnapshot(summary, fixtures);
}

function isValidFixtureBrand(brandValue) {
  return fixturesUiInputAdapter.isValidFixtureBrand(brandValue);
}

function parseLooseBoolean(value, fallback = false) {
  return fixturesUiInputAdapter.parseLooseBoolean(value, fallback);
}

function isLikelyPlaceholderConfigValue(value) {
  return fixturesUiInputAdapter.isLikelyPlaceholderConfigValue(value);
}

function isFixtureConfiguredForOutput(fixture = {}) {
  return fixturesUiInputAdapter.isFixtureConfiguredForOutput(fixture);
}

function isFixtureEngineEnabled(fixture = {}) {
  return fixturesUiInputAdapter.isFixtureEngineEnabled(fixture);
}

function isFixtureTwitchEnabled(fixture = {}) {
  return fixturesUiInputAdapter.isFixtureTwitchEnabled(fixture);
}

function isFixtureCustomEnabled(fixture = {}) {
  return fixturesUiInputAdapter.isFixtureCustomEnabled(fixture);
}
const fixturesWizOnboardingRuntime = (typeof createFixturesWizOnboardingRuntimeUi === "function"
  ? createFixturesWizOnboardingRuntimeUi({
    el,
    setBadge: (node, state, text) => typeof setBadge === "function" ? setBadge(node, state, text) : undefined,
    fixturesEndpointsAdapter: fixturesEndpointsAdapterRef,
    getEffectiveBrand: () => resolveFixtureFormBrand(""),
    getCurrentIp: () => String(el.fxWizIp?.value || "").trim(),
    setCurrentIp: value => {
      if (!el.fxWizIp) return;
      el.fxWizIp.value = String(value || "").trim();
    }
  })
  : (() => {
    throw new Error("fixtures wiz onboarding runtime module missing");
  })());
function syncWizOnboardingUi() {
  return fixturesWizOnboardingRuntime.syncWizOnboardingUi();
}

let applyFixtureCatalogToUi = () => {};
let updateFixtures = () => {};
let updateConnectivityCache = () => {};
let renderRouteFixtureOptions = () => {};
let loadFixturesSnapshot = async () => null;
let refreshFixturesFromServer = async () => ({ ok: false, snapshot: null });
let getKnownFixtureCatalog = async () => [];
let upsertFixtureCatalogEntry = (fixture = {}, options = {}) => {
  const source = Array.isArray(options.catalogSeed) ? options.catalogSeed.slice() : [];
  return fixture?.id ? [...source, { ...fixture }] : source;
};

const fixturesFormRuntime = (typeof createFixturesFormRuntimeUi === "function"
  ? createFixturesFormRuntimeUi({
    el,
    ui,
    windowRef: window,
    documentRef: document,
    setBadge: (node, state, text) => typeof setBadge === "function" ? setBadge(node, state, text) : undefined,
    showTab: tab => typeof showTab === "function" ? showTab(tab) : undefined,
    fixturesEndpointsAdapter: fixturesEndpointsAdapterRef,
    syncWizOnboardingUi,
    applyFixtureCatalogToUi: catalog => applyFixtureCatalogToUi(catalog),
    loadFixturesSnapshot: attempts => loadFixturesSnapshot(attempts),
    refreshFixturesFromServer: options => refreshFixturesFromServer(options),
    getKnownFixtureCatalog: () => getKnownFixtureCatalog(),
    upsertFixtureCatalogEntry: (...args) => upsertFixtureCatalogEntry(...args),
    updateFixtures: snapshot => updateFixtures(snapshot),
    ensureHueEntertainmentAreaSelection,
    normalizeZoneKey,
    getCanonicalZoneForBrand,
    isBuiltinFixtureBrand,
    normalizeFixtureModBrandToken,
    normalizeFixtureModBrandList,
    isValidFixtureBrand,
    isFixtureEngineEnabled,
    isFixtureTwitchEnabled,
    isFixtureCustomEnabled,
    isFixtureConfiguredForOutput,
    FIXTURE_MOD_CUSTOM_BRAND_VALUE
  })
  : (() => {
    throw new Error("fixtures form runtime module missing");
  })());
const {
  resolveFixtureFormBrand,
  syncFixtureBrandOptions,
  readFixtureModeFields,
  validateFixtureCoupling,
  updateFixtureCompatibilityHint,
  syncFixtureCouplingDefaults,
  applyFixtureBrandVisibility,
  resetFixtureForm,
  setSensitiveFieldVisibility,
  bindSensitiveFieldToggle,
  collectFixtureForm,
  fillFixtureForm,
  renderFixtureRows,
  saveFixtureFromForm
} = fixturesFormRuntime;

const fixturesSnapshotRuntime = (typeof createFixturesSnapshotRuntimeUi === "function"
  ? createFixturesSnapshotRuntimeUi({
    el,
    ui,
    windowRef: window,
    updateConnectivityCache: (...args) => updateConnectivityCache(...args),
    renderPaletteBrandMenus: options => renderPaletteBrandMenus(options),
    renderRouteFixtureOptions: catalog => renderRouteFixtureOptions(catalog),
    renderFixtureRows,
    syncFixtureBrandOptions,
    collectFixtureModBrandsFromSnapshot
  })
  : (() => {
    throw new Error("fixtures snapshot runtime module missing");
  })());
const {
  buildFixtureScopeTargetsSignatureUi,
} = fixturesSnapshotRuntime;
({
  applyFixtureCatalogToUi,
  updateFixtures
} = fixturesSnapshotRuntime);

const fixturesServerRuntime = (typeof createFixturesServerRuntimeUi === "function"
  ? createFixturesServerRuntimeUi({
    ui,
    fixturesEndpointsAdapter: fixturesEndpointsAdapterRef,
    updateFixtures
  })
  : (() => {
    throw new Error("fixtures server runtime module missing");
  })());
({
  loadFixturesSnapshot,
  refreshFixturesFromServer,
  getKnownFixtureCatalog,
  upsertFixtureCatalogEntry
} = fixturesServerRuntime);

// [TITLE] Fixture Domain Consolidated Slice
// [DEV] Consolidated extraction of fixture routing/form/save
// [DEV] connectivity runtime helpers from app.js to accelerate monolith split
// [DEV] while keeping payload routes and UI behavior parity unchanged.
async function discoverHueBridgeAndFill(preferredIp = "") {
  const discovered = await fixturesEndpointsAdapter.discoverHueBridge();
  const bridges = Array.isArray(discovered?.bridges) ? discovered.bridges : [];
  if (!bridges.length) {
    return { ok: false, error: discovered?.error || "No Hue bridge found on local network" };
  }

  const prefer = String(preferredIp || el.fxBridgeIp.value || "").trim();
  const selected =
    bridges.find(b => String(b?.ip || "").trim() === prefer) ||
    bridges[0];

  const ip = String(selected?.ip || "").trim();
  const id = String(selected?.id || "").trim().toUpperCase();
  if (ip) el.fxBridgeIp.value = ip;
  if (id) el.fxBridgeId.value = id;

  return {
    ok: true,
    bridge: {
      ip,
      id
    },
    total: bridges.length
  };
}

function ensureHueEntertainmentAreaSelection(options = {}) {
  const forcePrompt = options.forcePrompt === true;
  const promptIfMissing = options.promptIfMissing !== false;
  const forceWhenBridgeConfigured = options.forceWhenBridgeConfigured !== false;
  const brand = resolveFixtureFormBrand("");
  if (brand !== "hue") return { ok: true, areaId: "" };

  const bridgeIp = String(el.fxBridgeIp?.value || "").trim();
  const username = String(el.fxUsername?.value || "").trim();
  const bridgeId = String(el.fxBridgeId?.value || "").trim();
  const clientKey = String(el.fxClientKey?.value || "").trim();
  let areaId = String(el.fxEntertainmentAreaId?.value || "").trim();

  const bridgeConfigured = Boolean((bridgeIp && username) || (bridgeId && clientKey));
  const mustRequireArea = forcePrompt || (forceWhenBridgeConfigured && bridgeConfigured);
  if (!mustRequireArea) return { ok: true, areaId };

  if (forcePrompt || (!areaId && promptIfMissing)) {
    const prompted = window.prompt(
      "Hue Entertainment Area is required for reliable Hue streaming.\n\nEnter the exact Entertainment Area name or id:",
      areaId
    );
    if (prompted === null) {
      return {
        ok: false,
        cancelled: true,
        message: "Hue setup cancelled (entertainment area is required)."
      };
    }
    areaId = String(prompted || "").trim();
  }

  if (!areaId) {
    return {
      ok: false,
      cancelled: false,
      message: "Set ENT AREA before pairing or saving Hue bridge edits."
    };
  }

  el.fxEntertainmentAreaId.value = areaId;
  return { ok: true, areaId };
}

function applyCustomFixtureSelectionFromTab(options = {}) {
  const notify = options.notify === true;
  const catalog = Array.isArray(ui.fixturesCatalog) ? ui.fixturesCatalog : [];
  if (!catalog.length) {
    if (el.standFixtureSelect) el.standFixtureSelect.value = "";
    ui.routeSelectedId = "";
    if (typeof syncRouteSelectionUi === "function") {
      syncRouteSelectionUi();
    }
    if (notify) setBadge(el.health, "warn", "NO FIXTURES AVAILABLE");
    return false;
  }

  const currentId = String(el.standFixtureSelect?.value || ui.routeSelectedId || "").trim();
  const hasCurrent = catalog.some(fixture => String(fixture?.id || "").trim() === currentId);
  const nextId = hasCurrent
    ? currentId
    : String(catalog[0]?.id || "").trim();
  ui.routeSelectedId = nextId;
  if (el.standFixtureSelect) el.standFixtureSelect.value = nextId;
  if (typeof syncRouteSelectionUi === "function") {
    syncRouteSelectionUi();
  }
  if (notify) setBadge(el.health, "ok", "CUSTOM FIXTURE READY");
  return true;
}

// [TITLE] Fixture Routing Runtime Composition
// [DEV] Keep routing/connectivity/event-wiring ownership in fixtures runtime module so
// [DEV] this orchestrator remains focused on fixture form + snapshot domain behavior.
const fixturesRoutingRuntime = (typeof createFixturesRoutingRuntimeUi === 'function'
  ? createFixturesRoutingRuntimeUi({
    el,
    ui,
    fixturesEndpointsAdapter: fixturesEndpointsAdapterRef,
    setBadge: (node, state, text) => typeof setBadge === 'function' ? setBadge(node, state, text) : undefined,
    updateFixtures,
    isFixtureEngineEnabled,
    isFixtureTwitchEnabled,
    isFixtureConfiguredForOutput,
    isValidFixtureBrand,
    resolveFixtureFormBrand,
    getCanonicalZoneForBrand,
    syncFixtureCouplingDefaults,
    applyFixtureBrandVisibility,
    ensureHueEntertainmentAreaSelection,
    ensureHueEntGuideAcknowledged: async () => (
      typeof ensureHueEntGuideAcknowledged === "function"
        ? ensureHueEntGuideAcknowledged()
        : true
    ),
    discoverHueBridgeAndFill,
    readFixtureModeFields,
    saveFixtureFromForm,
    getKnownFixtureCatalog,
    upsertFixtureCatalogEntry,
    refreshFixturesFromServer,
    resetFixtureForm,
    bindSensitiveFieldToggle,
    applyFixtureCatalogToUi,
    fillFixtureForm
  })
  : (() => {
    throw new Error('fixtures routing runtime module missing');
  })());
const {
  getFixtureById,
  getFixtureRouteFlags,
  summarizeRouteFlags,
  getFixtureConnectivityRecord,
  getConnectivityStatusLabel,
  maskHostForDisplay,
  renderSelectedFixtureConnectivityStatus,
  setRouteChipState,
  getRouteChipState,
  clearRouteDraftState,
  setRouteDraftStateFromCurrentChips,
  getRouteDraftFlagsForFixture,
  toggleRouteChip,
  enforceRouteToggleConstraints,
  renderRouteDraftStatus,
  syncRouteSelectionUi,
  testFixtureConnectivity,
  applyFixtureRouteMode
} = fixturesRoutingRuntime;
({
  updateConnectivityCache,
  renderRouteFixtureOptions
} = fixturesRoutingRuntime);

fixturesWizOnboardingRuntime.wireWizOnboardingControls();

// [TITLE] Section: Fixtures Non-Live Control Wiring
// [DEV] Why this lives here:
// [DEV] Fixtures reload is a FIXTURES-domain control and must remain operational even
// [DEV] when LIVE tab actions are unavailable/disabled during rebuild phases.
if (el.fixturesReloadBtn) {
  el.fixturesReloadBtn.onclick = async () => {
    const ok = await fixturesEndpointsAdapter.reloadFixtures();
    setBadge(el.health, ok ? "ok" : "bad", ok ? "FIXTURES RELOADED" : "FIXTURES RELOAD FAIL");
    await refreshFixturesFromServer({ attempts: 4 });
    if (typeof loadColorPrefixConfig === "function") {
      await loadColorPrefixConfig();
    }
  };
}

