// [TITLE] Module: public/assets/js/domains/fixtures/fixtures-hue-pairing-runtime-ui.js
// [TITLE] Purpose: Hue bridge discovery/pairing fixture runtime wiring
// [TITLE] Functionality Index:
// [TITLE] - wire discover + link-button pairing actions
// [TITLE] - prevent accidental fixture overwrite when switching Hue light id
// [TITLE] - support pair-mode import of all bridge lights when requested
// [TITLE] - preserve save-bridge-edits flow without re-pairing

function wireFixturesHuePairingRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const fixturesEndpointsAdapter = deps.fixturesEndpointsAdapter;
  const requiredAdapterMethods = ["addAllHueFixtures", "pairHueBridge"];
  if (!fixturesEndpointsAdapter || typeof fixturesEndpointsAdapter !== "object") {
    throw new Error("fixtures hue pairing runtime requires fixturesEndpointsAdapter");
  }
  for (const methodName of requiredAdapterMethods) {
    if (typeof fixturesEndpointsAdapter[methodName] !== "function") {
      throw new Error(`fixtures hue pairing runtime missing adapter method: ${methodName}`);
    }
  }
  const setBadge = typeof deps.setBadge === "function" ? deps.setBadge : (() => {});
  const applyFixtureBrandVisibility = typeof deps.applyFixtureBrandVisibility === "function" ? deps.applyFixtureBrandVisibility : (() => {});
  const ensureHueEntertainmentAreaSelection = typeof deps.ensureHueEntertainmentAreaSelection === "function" ? deps.ensureHueEntertainmentAreaSelection : (() => ({ ok: true, areaId: "" }));
  const ensureHueEntGuideAcknowledged = typeof deps.ensureHueEntGuideAcknowledged === "function" ? deps.ensureHueEntGuideAcknowledged : (async () => true);
  const discoverHueBridgeAndFill = typeof deps.discoverHueBridgeAndFill === "function" ? deps.discoverHueBridgeAndFill : (async () => ({ ok: false, error: "discover unavailable" }));
  const readFixtureModeFields = typeof deps.readFixtureModeFields === "function" ? deps.readFixtureModeFields : (() => ({ zone: "hue", engineEnabled: true, twitchEnabled: true, customEnabled: false }));
  const getFixtureById = typeof deps.getFixtureById === "function" ? deps.getFixtureById : (() => null);
  const saveFixtureFromForm = typeof deps.saveFixtureFromForm === "function" ? deps.saveFixtureFromForm : (async () => ({ ok: false, error: "save unavailable" }));
  const getKnownFixtureCatalog = typeof deps.getKnownFixtureCatalog === "function" ? deps.getKnownFixtureCatalog : (async () => []);
  const upsertFixtureCatalogEntry = typeof deps.upsertFixtureCatalogEntry === "function"
    ? deps.upsertFixtureCatalogEntry
    : ((fixture, options = {}) => {
      const catalog = Array.isArray(options.catalogSeed) ? options.catalogSeed.slice() : [];
      const id = String(fixture?.id || "").trim();
      if (!id) return catalog;
      const next = catalog.filter(row => String(row?.id || "").trim() !== id);
      next.push({ ...(fixture || {}) });
      return next;
    });
  const applyFixtureCatalogToUi = typeof deps.applyFixtureCatalogToUi === "function" ? deps.applyFixtureCatalogToUi : (() => {});
  const refreshFixturesFromServer = typeof deps.refreshFixturesFromServer === "function" ? deps.refreshFixturesFromServer : (async () => ({ ok: false }));
  const windowRef = deps.windowRef || window;

  function setHuePairButtonsDisabled(disabled) {
    const next = disabled === true;
    if (el.fxHueDiscoverBtn) el.fxHueDiscoverBtn.disabled = next;
    if (el.fxHuePairBtn) el.fxHuePairBtn.disabled = next;
    if (el.fxHuePairMode) el.fxHuePairMode.disabled = next;
    if (el.fxHueSaveBridgeBtn) el.fxHueSaveBridgeBtn.disabled = next;
  }

  function buildFixtureModeSeed() {
    const modeState = readFixtureModeFields();
    return {
      zone: modeState.zone,
      enabled: el.fxEnabled.value === "true",
      engineEnabled: modeState.engineEnabled,
      twitchEnabled: modeState.twitchEnabled,
      customEnabled: modeState.customEnabled
    };
  }

  function resolveHuePairFixtureIdHint(lightId, bridgeIp) {
    const currentId = String(el.fxId?.value || "").trim();
    const originalId = String(el.fxOriginalId?.value || "").trim();
    if (!originalId) return currentId;

    // [DEV] Only keep the same id when user is still targeting same Hue fixture.
    const originalFixture = getFixtureById(originalId);
    const originalBrand = String(originalFixture?.brand || "").trim().toLowerCase();
    if (originalBrand !== "hue") return "";
    const originalLightId = Number(originalFixture?.lightId || 0);
    const currentLightId = Math.max(1, Number(lightId || 1));
    const originalBridgeIp = String(originalFixture?.bridgeIp || "").trim().toLowerCase();
    const selectedBridgeIp = String(bridgeIp || "").trim().toLowerCase();
    const sameBridge = !originalBridgeIp || !selectedBridgeIp || originalBridgeIp === selectedBridgeIp;
    const sameLight = originalLightId === currentLightId;
    if (!sameBridge || !sameLight) return "";
    return originalId;
  }

  async function runHueImportAllLights(payload = {}) {
    const addAll = await fixturesEndpointsAdapter.addAllHueFixtures(payload);
    if (!addAll.ok || addAll.data?.ok !== true) {
      return {
        ok: false,
        error: addAll.data?.error || "request_failed"
      };
    }

    const savedFixtures = Array.isArray(addAll.data.fixtures) ? addAll.data.fixtures : [];
    if (savedFixtures.length > 0) {
      const catalogSeed = await getKnownFixtureCatalog();
      let localCatalog = catalogSeed;
      for (const fixture of savedFixtures) {
        localCatalog = upsertFixtureCatalogEntry(fixture, { catalogSeed: localCatalog });
      }
      applyFixtureCatalogToUi(localCatalog);
      await refreshFixturesFromServer({ attempts: 5 });
    }
    return { ok: true, data: addAll.data };
  }

  if (el.fxHueDiscoverBtn) {
    el.fxHueDiscoverBtn.onclick = async () => {
      if (el.fxBrand.value !== "hue") {
        el.fxBrand.value = "hue";
        applyFixtureBrandVisibility();
      }

      const areaCheck = ensureHueEntertainmentAreaSelection({
        forcePrompt: false,
        promptIfMissing: false,
        forceWhenBridgeConfigured: true
      });
      if (!areaCheck.ok) {
        setBadge(el.health, "warn", areaCheck.message || "ENT AREA REQUIRED");
        return;
      }

      await ensureHueEntGuideAcknowledged();

      const found = await discoverHueBridgeAndFill();
      if (!found.ok) {
        setBadge(el.health, "bad", "HUE DISCOVERY FAIL");
        return;
      }

      setBadge(
        el.health,
        "ok",
        found.bridge.id
          ? `HUE BRIDGE FOUND (${found.bridge.id})`
          : "HUE BRIDGE FOUND"
      );
    };
  }

  if (el.fxHuePairBtn) {
    el.fxHuePairBtn.onclick = async () => {
      if (el.fxBrand.value !== "hue") {
        el.fxBrand.value = "hue";
        applyFixtureBrandVisibility();
      }

      let bridgeIp = el.fxBridgeIp.value.trim();
      if (!bridgeIp) {
        const found = await discoverHueBridgeAndFill();
        if (!found.ok) {
          setBadge(el.health, "bad", "PAIR FAIL: NO BRIDGE");
          return;
        }
        bridgeIp = found.bridge.ip;
      }

      const areaCheck = ensureHueEntertainmentAreaSelection({
        forcePrompt: true,
        promptIfMissing: true,
        forceWhenBridgeConfigured: true
      });
      if (!areaCheck.ok) {
        setBadge(el.health, "warn", areaCheck.message || "ENT AREA REQUIRED");
        return;
      }

      if (!windowRef.confirm(
        "Press the LINK button on your Hue Bridge now, then click OK to start pairing (about 30s timeout)."
      )) {
        return;
      }

      setHuePairButtonsDisabled(true);
      setBadge(el.health, "warn", "PAIRING HUE: PRESS LINK BUTTON");

      const modeState = buildFixtureModeSeed();
      const pairMode = String(el.fxHuePairMode?.value || "single_light").trim().toLowerCase();
      const lightId = Math.max(1, Number(el.fxLightId.value || 1));
      const fixtureIdHint = resolveHuePairFixtureIdHint(lightId, bridgeIp);
      const fixtureHint = {
        id: fixtureIdHint,
        zone: modeState.zone,
        enabled: modeState.enabled,
        engineEnabled: modeState.engineEnabled,
        twitchEnabled: modeState.twitchEnabled,
        customEnabled: modeState.customEnabled,
        lightId,
        entertainmentAreaId: el.fxEntertainmentAreaId.value.trim()
      };

      const pair = await fixturesEndpointsAdapter.pairHueBridge({
        bridgeIp,
        bridgeId: el.fxBridgeId.value.trim(),
        appName: "hue-bridge-final",
        timeoutMs: 30000,
        pollMs: 1200,
        lightId: fixtureHint.lightId,
        entertainmentAreaId: fixtureHint.entertainmentAreaId,
        saveFixture: true,
        fixture: fixtureHint
      });

      setHuePairButtonsDisabled(false);
      if (!pair.ok || !pair.data?.ok) {
        const code = pair.data?.error || "pair_failed";
        if (code === "link_button_timeout") {
          setBadge(el.health, "warn", "PAIR TIMEOUT: PRESS LINK + RETRY");
        } else if (code === "missing_entertainment_area") {
          setBadge(el.health, "warn", "PAIR BLOCKED: SET ENT AREA");
        } else if (code === "invalid_bridge_ip") {
          setBadge(el.health, "bad", "PAIR FAIL: INVALID BRIDGE IP");
        } else {
          setBadge(el.health, "bad", "HUE PAIR FAIL");
        }
        return;
      }

      const bridge = pair.data.bridge || {};
      const creds = pair.data.credentials || {};
      const areas = Array.isArray(pair.data.entertainmentAreas) ? pair.data.entertainmentAreas : [];
      const pairedFixture = pair.data.fixture && typeof pair.data.fixture === "object"
        ? pair.data.fixture
        : null;
      const fixtureSavedByPair = pair.data.fixtureSaved === true && Boolean(pairedFixture);
      const fixtureSaveError = String(pair.data.fixtureSaveError || "").trim();

      if (bridge.ip) el.fxBridgeIp.value = String(bridge.ip).trim();
      if (bridge.id) el.fxBridgeId.value = String(bridge.id).trim().toUpperCase();
      if (creds.username) el.fxUsername.value = String(creds.username).trim();
      if (creds.clientKey) el.fxClientKey.value = String(creds.clientKey).trim().toUpperCase();
      if (pairedFixture?.id) el.fxId.value = String(pairedFixture.id).trim();
      if (pairedFixture?.id && el.fxOriginalId) el.fxOriginalId.value = String(pairedFixture.id).trim();
      if (pairedFixture?.zone && !el.fxZone.value.trim()) {
        el.fxZone.value = String(pairedFixture.zone).trim();
      }
      if (!el.fxEntertainmentAreaId.value.trim() && areas.length) {
        const first = areas[0] || {};
        el.fxEntertainmentAreaId.value = String(first.name || first.id || "").trim();
      }

      if (pairMode === "import_all_lights") {
        setBadge(el.health, "warn", "PAIR OK: IMPORTING ALL HUE LIGHT IDS...");
        const importResult = await runHueImportAllLights({
          bridgeIp: bridge.ip || bridgeIp,
          bridgeId: bridge.id || String(el.fxBridgeId?.value || "").trim(),
          username: creds.username || String(el.fxUsername?.value || "").trim(),
          clientKey: creds.clientKey || String(el.fxClientKey?.value || "").trim(),
          entertainmentAreaId: String(el.fxEntertainmentAreaId?.value || "").trim(),
          fixture: {
            zone: modeState.zone,
            enabled: modeState.enabled,
            engineEnabled: modeState.engineEnabled,
            twitchEnabled: modeState.twitchEnabled,
            customEnabled: modeState.customEnabled
          },
          capabilities: pair.data.capabilities || {}
        });
        if (!importResult.ok) {
          setBadge(el.health, "bad", `PAIR OK, IMPORT FAIL: ${importResult.error}`);
          return;
        }
        const added = Number(importResult.data?.added || 0);
        const updated = Number(importResult.data?.updated || 0);
        const skipped = Number(importResult.data?.skipped || 0);
        const failed = Number(importResult.data?.failed || 0);
        if (failed > 0 || skipped > 0) {
          setBadge(el.health, "warn", `HUE IMPORT PARTIAL (ADD ${added} | UPD ${updated} | SKIP ${skipped} | FAIL ${failed})`);
          return;
        }
        if (added <= 0 && updated <= 0) {
          setBadge(el.health, "warn", "HUE IMPORT: NO LIGHTS FOUND");
          return;
        }
        setBadge(el.health, "ok", `HUE IMPORT SAVED (ADD ${added} | UPD ${updated})`);
        return;
      }

      let saved = null;
      if (fixtureSavedByPair) {
        const catalogSeed = await getKnownFixtureCatalog();
        const localCatalog = upsertFixtureCatalogEntry(pairedFixture, { catalogSeed });
        applyFixtureCatalogToUi(localCatalog);
        const refreshed = await refreshFixturesFromServer({ attempts: 5 });
        saved = {
          ok: true,
          savedFixture: pairedFixture,
          refreshOk: refreshed.ok,
          routeSync: { ok: true, changed: false }
        };
      } else {
        saved = await saveFixtureFromForm({ resetAfter: false });
      }

      if (!saved.ok) {
        const detail = saved.error || fixtureSaveError || "fixture save failed";
        const msg = `HUE PAIRED (SAVE FAIL: ${detail})`;
        setBadge(el.health, pair.data.warning ? "warn" : "bad", msg);
        return;
      }

      if (saved.savedFixture?.id) {
        el.fxId.value = String(saved.savedFixture.id);
        if (el.fxOriginalId) el.fxOriginalId.value = String(saved.savedFixture.id).trim();
      }

      const routeSync = saved.routeSync || { ok: true, changed: false };
      if (!routeSync.ok) {
        setBadge(el.health, "warn", "HUE PAIRED + SAVED (ROUTE UPDATE FAIL)");
        return;
      }

      if (pair.data.warning) {
        setBadge(
          el.health,
          "warn",
          routeSync.changed
            ? "HUE PAIRED + SAVED + ROUTE (AREA WARN)"
            : "HUE PAIRED + SAVED (AREA WARN)"
        );
        return;
      }

      if (routeSync.changed) {
        setBadge(el.health, "ok", "HUE PAIRED + SAVED + ROUTE UPDATED");
      } else {
        setBadge(el.health, "ok", "HUE PAIRED + SAVED");
      }
    };
  }

  if (el.fxHueSaveBridgeBtn) {
    el.fxHueSaveBridgeBtn.onclick = async () => {
      if (el.fxBrand.value !== "hue") {
        el.fxBrand.value = "hue";
        applyFixtureBrandVisibility();
      }

      const areaCheck = ensureHueEntertainmentAreaSelection({
        forcePrompt: false,
        promptIfMissing: true,
        forceWhenBridgeConfigured: true
      });
      if (!areaCheck.ok) {
        setBadge(el.health, "warn", areaCheck.message || "ENT AREA REQUIRED");
        return;
      }

      const saved = await saveFixtureFromForm({ resetAfter: false });
      if (!saved.ok) {
        setBadge(el.health, "bad", `BRIDGE EDIT SAVE FAIL: ${saved.error || "invalid payload"}`);
        return;
      }

      const routeSync = saved.routeSync || { ok: true, changed: false };
      if (!routeSync.ok) {
        setBadge(el.health, "warn", "BRIDGE EDITS SAVED (ROUTE UPDATE FAIL)");
        return;
      }

      if (routeSync.changed) {
        setBadge(el.health, "ok", "BRIDGE EDITS SAVED + ROUTE UPDATED");
      } else {
        setBadge(el.health, "ok", "BRIDGE EDITS SAVED");
      }
    };
  }
}
