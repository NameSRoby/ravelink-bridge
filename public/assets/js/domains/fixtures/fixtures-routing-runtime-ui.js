// [TITLE] Module: public/assets/js/domains/fixtures/fixtures-routing-runtime-ui.js
// [TITLE] Purpose: fixture routing/connectivity runtime + fixture action wiring ownership
// [TITLE] Functionality Index:
// [TITLE] - routing toggle draft/apply flows
// [TITLE] - connectivity status projection and summary helpers
// [TITLE] - fixture action wiring for editor/pair/save/route controls
// [DEV] Complex Flow:
// [DEV] This runtime keeps high-churn fixture interaction wiring isolated so
// [DEV] domain refactors can evolve routing behavior without expanding the orchestrator.

function createFixturesRoutingRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const fixturesEndpointsAdapter = deps.fixturesEndpointsAdapter;
  const requiredAdapterMethods = ["testConnectivity", "saveFixture", "getFixturesSnapshot"];
  if (!fixturesEndpointsAdapter || typeof fixturesEndpointsAdapter !== "object") {
    throw new Error("fixtures routing runtime requires fixturesEndpointsAdapter");
  }
  for (const methodName of requiredAdapterMethods) {
    if (typeof fixturesEndpointsAdapter[methodName] !== "function") {
      throw new Error(`fixtures routing runtime missing adapter method: ${methodName}`);
    }
  }
  const setBadge = typeof deps.setBadge === 'function' ? deps.setBadge : (() => {});
  const updateFixtures = typeof deps.updateFixtures === 'function' ? deps.updateFixtures : (() => {});
  const isFixtureEngineEnabled = typeof deps.isFixtureEngineEnabled === 'function' ? deps.isFixtureEngineEnabled : (() => false);
  const isFixtureTwitchEnabled = typeof deps.isFixtureTwitchEnabled === 'function' ? deps.isFixtureTwitchEnabled : (() => true);
  const isFixtureConfiguredForOutput = typeof deps.isFixtureConfiguredForOutput === 'function' ? deps.isFixtureConfiguredForOutput : (() => false);
  const isValidFixtureBrand = typeof deps.isValidFixtureBrand === 'function' ? deps.isValidFixtureBrand : (() => false);
  const resolveFixtureFormBrand = typeof deps.resolveFixtureFormBrand === 'function' ? deps.resolveFixtureFormBrand : (() => 'hue');
  const getCanonicalZoneForBrand = typeof deps.getCanonicalZoneForBrand === 'function' ? deps.getCanonicalZoneForBrand : (() => 'custom');
  const syncFixtureCouplingDefaults = typeof deps.syncFixtureCouplingDefaults === 'function' ? deps.syncFixtureCouplingDefaults : (() => {});
  const applyFixtureBrandVisibility = typeof deps.applyFixtureBrandVisibility === 'function' ? deps.applyFixtureBrandVisibility : (() => {});
  const ensureHueEntertainmentAreaSelection = typeof deps.ensureHueEntertainmentAreaSelection === 'function' ? deps.ensureHueEntertainmentAreaSelection : (() => ({ ok: true, areaId: '' }));
  const ensureHueEntGuideAcknowledged = typeof deps.ensureHueEntGuideAcknowledged === 'function' ? deps.ensureHueEntGuideAcknowledged : (async () => true);
  const discoverHueBridgeAndFill = typeof deps.discoverHueBridgeAndFill === 'function' ? deps.discoverHueBridgeAndFill : (async () => ({ ok: false, error: 'discover unavailable' }));
  const readFixtureModeFields = typeof deps.readFixtureModeFields === 'function' ? deps.readFixtureModeFields : (() => ({ zone: 'custom', engineEnabled: false, twitchEnabled: true, customEnabled: false }));
  const saveFixtureFromForm = typeof deps.saveFixtureFromForm === 'function' ? deps.saveFixtureFromForm : (async () => ({ ok: false, error: 'save unavailable' }));
  const getKnownFixtureCatalog = typeof deps.getKnownFixtureCatalog === 'function' ? deps.getKnownFixtureCatalog : (async () => []);
  const upsertFixtureCatalogEntry = typeof deps.upsertFixtureCatalogEntry === 'function' ? deps.upsertFixtureCatalogEntry : ((fixture, options = {}) => {
    const catalog = Array.isArray(options.catalogSeed) ? options.catalogSeed.slice() : [];
    const id = String(fixture?.id || '').trim();
    if (!id) return catalog;
    const next = catalog.filter(row => String(row?.id || '').trim() !== id);
    next.push({ ...(fixture || {}) });
    return next;
  });
  const refreshFixturesFromServer = typeof deps.refreshFixturesFromServer === 'function' ? deps.refreshFixturesFromServer : (async () => ({ ok: false, snapshot: null }));
  const resetFixtureForm = typeof deps.resetFixtureForm === 'function' ? deps.resetFixtureForm : (() => {});
  const bindSensitiveFieldToggle = typeof deps.bindSensitiveFieldToggle === 'function' ? deps.bindSensitiveFieldToggle : (() => {});
  const applyFixtureCatalogToUi = typeof deps.applyFixtureCatalogToUi === 'function' ? deps.applyFixtureCatalogToUi : (() => {});
  const fillFixtureForm = typeof deps.fillFixtureForm === 'function' ? deps.fillFixtureForm : (() => {});

function getFixtureById(id) {
  const key = String(id || "").trim();
  if (!key) return null;
  return ui.fixturesCatalog.find(f => String(f.id) === key) || null;
}

function getFixtureRouteFlags(fixture) {
  return {
    engineEnabled: isFixtureEngineEnabled(fixture || {}),
    twitchEnabled: isFixtureTwitchEnabled(fixture || {})
  };
}

function summarizeRouteFlags(flags = {}) {
  const active = [];
  if (flags.engineEnabled) active.push("engine");
  if (flags.twitchEnabled) active.push("twitch");
  return active.length ? active.join("+") : "none";
}

function getFixtureConnectivityRecord(id) {
  const key = String(id || "").trim();
  if (!key) return null;
  return ui.fixtureConnectivityById[key] || null;
}

function getConnectivityStatusLabel(fixture, record) {
  const brand = String(fixture?.brand || "").trim().toLowerCase();
  if (!record) {
    if (brand !== "hue" && brand !== "wiz") return "MOD-BRAND (ADAPTER OWNED)";
    return "CHECK PENDING";
  }

  const status = String(record.status || "").trim().toLowerCase();
  if (status === "reachable") return "TARGET READY";
  if (status === "unreachable") return "TARGET UNREACHABLE";
  if (status === "not_configured") return "TARGET NOT CONFIGURED";
  if (status === "skipped") return "MOD-BRAND (ADAPTER OWNED)";
  if (status === "pending") return "CHECK PENDING";
  return "TARGET UNKNOWN";
}

function maskHostForDisplay(hostValue) {
  const raw = String(hostValue || "").trim();
  if (!raw) return "-";

  const bracketIpv6WithPort = raw.match(/^\[([^\]]+)\]:(\d{1,5})$/);
  if (bracketIpv6WithPort) {
    return `[${String(bracketIpv6WithPort[1] || "").slice(0, 2)}***]:${bracketIpv6WithPort[2]}`;
  }

  const ipv4WithPort = raw.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/);
  if (ipv4WithPort) {
    const parts = ipv4WithPort[1].split(".");
    return `${parts[0]}.***.***.${parts[3]}:${ipv4WithPort[2]}`;
  }

  const ipv4Only = raw.match(/^(\d{1,3})(?:\.(\d{1,3})){3}$/);
  if (ipv4Only) {
    const parts = raw.split(".");
    return `${parts[0]}.***.***.${parts[3]}`;
  }

  const hostWithPort = raw.match(/^([^:]+):(\d{1,5})$/);
  if (hostWithPort) {
    const host = String(hostWithPort[1] || "").trim();
    const maskedHost = host.length <= 2
      ? `${host.slice(0, 1)}*`
      : `${host.slice(0, 2)}***${host.slice(-1)}`;
    return `${maskedHost}:${hostWithPort[2]}`;
  }

  if (raw.startsWith("[") && raw.endsWith("]")) {
    const core = raw.slice(1, -1);
    return `[${core.slice(0, 2)}***]`;
  }

  if (raw.length <= 2) return `${raw.slice(0, 1)}*`;
  return `${raw.slice(0, 2)}***${raw.slice(-1)}`;
}

function renderSelectedFixtureConnectivityStatus(fixture) {
  if (!fixture) {
    el.standConnectivityStatus.value = "No fixture selected.";
    return;
  }

  const record = getFixtureConnectivityRecord(fixture.id);
  const host = String(record?.host || "").trim() || (fixture.brand === "hue"
    ? String(fixture.bridgeIp || "").trim()
    : String(fixture.ip || "").trim()) || "-";
  const maskedHost = maskHostForDisplay(host);
  const label = getConnectivityStatusLabel(fixture, record);
  const detail = String(record?.detail || "").trim();
  const checkedAt = Number(record?.checkedAt || 0) > 0
    ? new Date(Number(record.checkedAt)).toLocaleTimeString()
    : "-";
  el.standConnectivityStatus.value = `${fixture.id} | ${label} | host ${maskedHost} | ${detail || "no detail"} | checked ${checkedAt}`;
}

function updateConnectivityCache(entries, options = {}) {
  const merge = options && options.merge === true;
  const next = merge ? { ...ui.fixtureConnectivityById } : {};
  for (const entry of (Array.isArray(entries) ? entries : [])) {
    const id = String(entry?.id || "").trim();
    if (!id) continue;
    next[id] = entry;
  }
  ui.fixtureConnectivityById = next;
}

function setRouteChipState(node, enabled) {
  if (!node) return;
  const on = Boolean(enabled);
  node.dataset.on = on ? "true" : "false";
  node.classList.toggle("active", on);
  node.setAttribute("aria-pressed", on ? "true" : "false");
}

function getRouteChipState(node) {
  return node?.dataset?.on === "true";
}

function clearRouteDraftState() {
  ui.routeDraftDirty = false;
  ui.routeDraftFixtureId = "";
  ui.routeDraftFlags = null;
}

function setRouteDraftStateFromCurrentChips() {
  const id = String(el.standFixtureSelect.value || "").trim();
  if (!id) {
    clearRouteDraftState();
    return;
  }

  ui.routeDraftDirty = true;
  ui.routeDraftFixtureId = id;
  ui.routeDraftFlags = {
    engineEnabled: getRouteChipState(el.standRouteEngine),
    twitchEnabled: getRouteChipState(el.standRouteTwitch)
  };
}

function getRouteDraftFlagsForFixture(id) {
  const fixtureId = String(id || "").trim();
  if (!fixtureId || !ui.routeDraftDirty) return null;
  if (String(ui.routeDraftFixtureId || "") !== fixtureId) return null;
  const flags = ui.routeDraftFlags && typeof ui.routeDraftFlags === "object"
    ? ui.routeDraftFlags
    : null;
  if (!flags) return null;
  return {
    engineEnabled: flags.engineEnabled === true,
    twitchEnabled: flags.twitchEnabled === true
  };
}

function toggleRouteChip(node) {
  if (!node) return;
  setRouteChipState(node, !getRouteChipState(node));
}

function enforceRouteToggleConstraints() {
  if (el.standRouteEngine) el.standRouteEngine.disabled = false;
  if (el.standRouteTwitch) el.standRouteTwitch.disabled = false;
}

function renderRouteFixtureOptions(fixtures = []) {
  const previous = String(ui.routeSelectedId || el.standFixtureSelect.value || "").trim();
  const optionsCatalog = Array.isArray(fixtures) ? fixtures.slice() : [];

  el.standFixtureSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "select fixture";
  el.standFixtureSelect.appendChild(placeholder);

  for (const fixture of optionsCatalog) {
    const id = String(fixture?.id || "").trim();
    if (!id) continue;
    const option = document.createElement("option");
    const brand = String(fixture.brand || "").toUpperCase();
    const brandKey = String(fixture.brand || "").trim().toLowerCase();
    const zone = String(
      fixture.zone ||
      (brandKey === "hue" ? "hue" : (brandKey === "wiz" ? "wiz" : "custom"))
    );
    option.value = id;
    option.textContent = `${id} | ${brand} | ${zone}`;
    el.standFixtureSelect.appendChild(option);
  }

  const hasPrevious = previous && optionsCatalog.some(f => String(f.id) === previous);
  ui.routeSelectedId = hasPrevious ? previous : "";
  el.standFixtureSelect.value = ui.routeSelectedId;
  syncRouteSelectionUi();
}

function renderRouteDraftStatus(fixture) {
  if (!fixture) return;
  const currentFlags = {
    engineEnabled: getRouteChipState(el.standRouteEngine),
    twitchEnabled: getRouteChipState(el.standRouteTwitch)
  };
  const statusWord = getRouteDraftFlagsForFixture(fixture.id) ? "DRAFT" : "APPLIED";
  const connectivityRecord = getFixtureConnectivityRecord(fixture.id);
  const configuredWord = connectivityRecord
    ? getConnectivityStatusLabel(fixture, connectivityRecord)
    : (isFixtureConfiguredForOutput(fixture) ? "TARGET CONFIGURED" : "TARGET NOT CONFIGURED");
  const savedAtText = ui.routeLastSavedAt
    ? new Date(ui.routeLastSavedAt).toLocaleTimeString()
    : "-";
  const brandKey = String(fixture.brand || "").trim().toLowerCase();
  const zone = String(
    fixture.zone ||
    (brandKey === "hue" ? "hue" : (brandKey === "wiz" ? "wiz" : "custom"))
  );
  el.standRouteStatus.value =
    `${fixture.id} | zone ${zone} | ` +
    `modes ${summarizeRouteFlags(currentFlags).toUpperCase()} | ${statusWord} | ${configuredWord} | last save ${savedAtText}`;
  renderSelectedFixtureConnectivityStatus(fixture);
}

function syncRouteSelectionUi() {
  const selectedId = String(el.standFixtureSelect.value || "").trim();
  if (ui.routeDraftDirty && ui.routeDraftFixtureId && ui.routeDraftFixtureId !== selectedId) {
    clearRouteDraftState();
  }
  ui.routeSelectedId = selectedId;
  const fixture = getFixtureById(selectedId);
  if (!fixture) {
    clearRouteDraftState();
    el.standRouteStatus.value = "Select a fixture, choose ENGINE/TWITCH, then click APPLY ROUTING.";
    el.standConnectivityStatus.value = "No fixture selected.";
    setRouteChipState(el.standRouteEngine, false);
    setRouteChipState(el.standRouteTwitch, false);
    enforceRouteToggleConstraints();
    return;
  }

  const flags = getRouteDraftFlagsForFixture(fixture.id) || getFixtureRouteFlags(fixture);
  setRouteChipState(el.standRouteEngine, flags.engineEnabled);
  setRouteChipState(el.standRouteTwitch, flags.twitchEnabled);
  enforceRouteToggleConstraints();
  renderRouteDraftStatus(fixture);
}

async function testFixtureConnectivity() {
  const fixtureId = String(el.standFixtureSelect.value || "").trim();
  const fixture = getFixtureById(fixtureId);
  if (!fixture) {
    setBadge(el.health, "warn", "SELECT FIXTURE");
    return false;
  }

  el.standConnectivityStatus.value = `${fixtureId} | CHECKING CONNECTIVITY...`;
  const response = await fixturesEndpointsAdapter.testConnectivity(fixtureId, 1200);
  if (!response.ok || !response.data?.ok) {
    const reason = response.data?.error || "connectivity test failed";
    setBadge(el.health, "bad", `CONNECTIVITY FAIL: ${reason}`);
    el.standConnectivityStatus.value = `${fixtureId} | TARGET UNKNOWN | ${reason}`;
    return false;
  }

  updateConnectivityCache(response.data.results || [], { merge: true });
  ui.connectivitySummary = response.data.summary || null;
  const record = getFixtureConnectivityRecord(fixtureId);
  renderSelectedFixtureConnectivityStatus(fixture);
  renderRouteDraftStatus(fixture);

  const status = String(record?.status || "").trim().toLowerCase();
  if (status === "reachable") {
    setBadge(el.health, "ok", "CONNECTIVITY OK");
  } else if (status === "unreachable") {
    setBadge(el.health, "warn", "TARGET UNREACHABLE");
  } else if (status === "not_configured") {
    setBadge(el.health, "warn", "TARGET NOT CONFIGURED");
  } else if (status === "skipped") {
    setBadge(el.health, "ok", "MOD BRAND CONNECTIVITY BY ADAPTER");
  } else {
    setBadge(el.health, "warn", "CONNECTIVITY UNKNOWN");
  }
  return status === "reachable";
}

async function applyFixtureRouteMode() {
  const id = String(el.standFixtureSelect.value || "").trim();
  const fixture = getFixtureById(id);
  if (!fixture) {
    setBadge(el.health, "warn", "SELECT FIXTURE");
    return;
  }

  const engineEnabled = getRouteChipState(el.standRouteEngine);
  const twitchEnabled = getRouteChipState(el.standRouteTwitch);
  const brand = String(fixture.brand || "").trim().toLowerCase();
  if (!isValidFixtureBrand(brand)) {
    setBadge(el.health, "bad", "INVALID FIXTURE BRAND");
    return;
  }

  const next = {
    ...fixture,
    controlMode: engineEnabled ? "engine" : "standalone",
    engineBinding: engineEnabled ? brand : "standalone",
    engineEnabled,
    twitchEnabled,
    customEnabled: false
  };

  setRouteDraftStateFromCurrentChips();
  const save = await fixturesEndpointsAdapter.saveFixture(next);
  if (!save.ok || !save.data?.ok) {
    setBadge(el.health, "bad", `ROUTING SAVE FAIL: ${save.data?.error || "invalid payload"}`);
    return;
  }

  ui.routeLastSavedAt = Date.now();
  setBadge(el.health, "ok", "ROUTING SAVED");

  clearRouteDraftState();
  const refreshed = await refreshFixturesFromServer({ attempts: 4 });
  if (!refreshed.ok) {
    const f = await fixturesEndpointsAdapter.getFixturesSnapshot();
    if (f) updateFixtures(f);
  }
}


// [TITLE] Section: Fixture UI Event Wiring
// [DEV] Why: fixture interactions should be owned by fixture domain to keep
// [DEV] route, draft-state, and connectivity behavior in one module during refactor slices.
// [DEV] Change safety: preserve handler ordering and badge/status semantics.

el.fxBrand.onchange = () => {
  const selectedBrand = resolveFixtureFormBrand("");
  const originalId = String(el.fxOriginalId?.value || "").trim();
  if (originalId) {
    const originalFixture = getFixtureById(originalId);
    const originalBrand = String(originalFixture?.brand || "").trim().toLowerCase();
    if (originalBrand && originalBrand !== selectedBrand) {
      if (String(el.fxId?.value || "").trim() === originalId) {
        el.fxId.value = "";
      }
      if (el.fxOriginalId) el.fxOriginalId.value = "";
    }
  }

  if (!el.fxZone.value.trim()) {
    el.fxZone.value = getCanonicalZoneForBrand(selectedBrand, "custom");
  }
  syncFixtureCouplingDefaults("brand");
  applyFixtureBrandVisibility();
};

if (el.fxModBrandId) {
  el.fxModBrandId.oninput = () => {
    el.fxModBrandId.value = String(el.fxModBrandId.value || "").toLowerCase().trim();
    syncFixtureCouplingDefaults("mod-brand");
    applyFixtureBrandVisibility();
  };
}

el.fxControlMode.onchange = () => {
  syncFixtureCouplingDefaults("mode");
};

el.fxEngineBinding.onchange = () => {
  updateFixtureCompatibilityHint();
};

el.fxResetBtn.onclick = () => {
  resetFixtureForm();
};

bindSensitiveFieldToggle(el.fxBridgeIp, el.fxBridgeIpShowBtn, "HUE BRIDGE IP");
bindSensitiveFieldToggle(el.fxUsername, el.fxUsernameShowBtn, "HUE USERNAME");
bindSensitiveFieldToggle(el.fxClientKey, el.fxClientKeyShowBtn, "HUE CLIENT KEY");
bindSensitiveFieldToggle(el.fxWizIp, el.fxWizIpShowBtn, "WIZ IP / MOD TARGET");

if (typeof wireFixturesHuePairingRuntimeUi === "function") {
  wireFixturesHuePairingRuntimeUi({
    el,
    fixturesEndpointsAdapter,
    setBadge,
    applyFixtureBrandVisibility,
    ensureHueEntertainmentAreaSelection,
    ensureHueEntGuideAcknowledged,
    discoverHueBridgeAndFill,
    readFixtureModeFields,
    getFixtureById,
    saveFixtureFromForm,
    getKnownFixtureCatalog,
    upsertFixtureCatalogEntry,
    applyFixtureCatalogToUi,
    refreshFixturesFromServer,
    windowRef: window
  });
}

el.fxSaveBtn.onclick = async () => {
  const saved = await saveFixtureFromForm({ resetAfter: true });
  if (!saved.ok) {
    setBadge(el.health, "bad", `FIXTURE SAVE FAIL: ${saved.error || "invalid payload"}`);
    return;
  }

  const routeSync = saved.routeSync || { ok: true, changed: false };
  if (routeSync.ok && routeSync.changed) {
    setBadge(el.health, "ok", "FIXTURE SAVED + ROUTE UPDATED");
  } else if (!routeSync.ok) {
    setBadge(el.health, "warn", "FIXTURE SAVED (ROUTE UPDATE FAIL)");
  } else {
    setBadge(el.health, "ok", "FIXTURE SAVED");
  }
};

el.standFixtureSelect.onchange = () => {
  syncRouteSelectionUi();
};

const onRouteToggleChange = () => {
  enforceRouteToggleConstraints();
  setRouteDraftStateFromCurrentChips();
  const fixture = getFixtureById(el.standFixtureSelect.value);
  if (fixture) {
    renderRouteDraftStatus(fixture);
  }
};
el.standRouteEngine.onclick = () => {
  toggleRouteChip(el.standRouteEngine);
  onRouteToggleChange();
};
el.standRouteTwitch.onclick = () => {
  toggleRouteChip(el.standRouteTwitch);
  onRouteToggleChange();
};

el.standRouteApplyBtn.onclick = async () => {
  await applyFixtureRouteMode();
};

el.standConnectivityBtn.onclick = async () => {
  await testFixtureConnectivity();
};

el.standRefreshBtn.onclick = async () => {
  const refreshed = await refreshFixturesFromServer({ attempts: 4 });
  setBadge(
    el.health,
    refreshed.ok ? "ok" : "bad",
    refreshed.ok ? "FIXTURE REFRESH" : "FIXTURE REFRESH FAIL"
  );
};


  return {
    getFixtureById,
    getFixtureRouteFlags,
    summarizeRouteFlags,
    getFixtureConnectivityRecord,
    getConnectivityStatusLabel,
    maskHostForDisplay,
    renderSelectedFixtureConnectivityStatus,
    updateConnectivityCache,
    setRouteChipState,
    getRouteChipState,
    clearRouteDraftState,
    setRouteDraftStateFromCurrentChips,
    getRouteDraftFlagsForFixture,
    toggleRouteChip,
    enforceRouteToggleConstraints,
    renderRouteFixtureOptions,
    renderRouteDraftStatus,
    syncRouteSelectionUi,
    testFixtureConnectivity,
    applyFixtureRouteMode
  };
}
