// [TITLE] Module: app/routes/compat/fixtures-hardware.compat.routes.js
// [TITLE] Purpose: register fixtures and hardware compatibility routes for current UI contracts
// [TITLE] Functionality Index:
// [TITLE] - fixture inventory/config/connectivity routes
// [TITLE] - Hue/WiZ discovery and Hue pairing compatibility routes
// [TITLE] - Hue transport mode compatibility route
// [DEV] Complex Flow:
// [DEV] This slice keeps fixture registry and hardware onboarding routes together
// [DEV] because the current UI still treats them as one operational surface.

const { createFixturesHardwareCompatHelpers } = require("./fixtures-hardware.compat.helpers");

module.exports = function registerFixturesHardwareCompatRoutes(app, deps = {}) {
  const fixtureRegistry = deps.fixtureRegistry;
  const hueBridge = deps.hueBridge;
  const wizBridge = deps.wizBridge;
  const systemConfigService = deps.systemConfigService;
  const enforceWriteAccess = typeof deps.enforceWriteAccess === "function"
    ? deps.enforceWriteAccess
    : ((_req, _res, next) => next());
  const getRequestMap = typeof deps.getRequestMap === "function"
    ? deps.getRequestMap
    : (value => (value && typeof value === "object" && !Array.isArray(value) ? value : {}));
  const toCompatError = typeof deps.toCompatError === "function"
    ? deps.toCompatError
    : ((res, status, error, detail = "") => {
      res.status(status).json({
        ok: false,
        error,
        detail: String(detail || "").trim()
      });
    });
  const normalizeToken = typeof deps.normalizeToken === "function"
    ? deps.normalizeToken
    : (value => String(value || "").trim());
  const clampNumber = typeof deps.clampNumber === "function"
    ? deps.clampNumber
    : ((value, _min, _max, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback);
  const helpers = createFixturesHardwareCompatHelpers({
    getRequestMap,
    normalizeToken,
    clampNumber
  });
  const buildCompatFixturesSnapshot = typeof deps.buildCompatFixturesSnapshot === "function"
    ? deps.buildCompatFixturesSnapshot
    : helpers.buildCompatFixturesSnapshot;
  const normalizeFixtureIdToken = typeof deps.normalizeFixtureIdToken === "function"
    ? deps.normalizeFixtureIdToken
    : helpers.normalizeFixtureIdToken;
  const normalizeFixtureIdFromRequest = typeof deps.normalizeFixtureIdFromRequest === "function"
    ? deps.normalizeFixtureIdFromRequest
    : helpers.normalizeFixtureIdFromRequest;
  const normalizeHueBridgeHost = typeof deps.normalizeHueBridgeHost === "function"
    ? deps.normalizeHueBridgeHost
    : helpers.normalizeHueBridgeHost;
  const normalizeIpv4Host = typeof deps.normalizeIpv4Host === "function"
    ? deps.normalizeIpv4Host
    : helpers.normalizeIpv4Host;
  const normalizeEntertainmentAreas = typeof deps.normalizeEntertainmentAreas === "function"
    ? deps.normalizeEntertainmentAreas
    : helpers.normalizeEntertainmentAreas;
  const normalizeHueBridgeCapabilities = typeof deps.normalizeHueBridgeCapabilities === "function"
    ? deps.normalizeHueBridgeCapabilities
    : helpers.normalizeHueBridgeCapabilities;
  const normalizeDiscoveredBridges = typeof deps.normalizeDiscoveredBridges === "function"
    ? deps.normalizeDiscoveredBridges
    : helpers.normalizeDiscoveredBridges;
  const normalizeHueBridgeLights = typeof deps.normalizeHueBridgeLights === "function"
    ? deps.normalizeHueBridgeLights
    : helpers.normalizeHueBridgeLights;
  const buildHueFixtureId = typeof deps.buildHueFixtureId === "function"
    ? deps.buildHueFixtureId
    : helpers.buildHueFixtureId;

  app.post("/hue/transport", enforceWriteAccess, (req, res) => {
    const mode = String(req.query?.mode || req.body?.mode || "auto").trim().toLowerCase();
    if (mode !== "auto" && mode !== "rest" && mode !== "entertainment") {
      toCompatError(res, 400, "invalid_hue_transport_mode", "Use auto/rest/entertainment.");
      return;
    }
    if (systemConfigService && typeof systemConfigService.patchConfig === "function") {
      systemConfigService.patchConfig({
        hueTransportPreference: mode
      });
    }
    let telemetry = null;
    if (hueBridge && typeof hueBridge.setTransportMode === "function") {
      telemetry = hueBridge.setTransportMode(mode);
    }
    if (hueBridge && typeof hueBridge.syncTransportForFixtures === "function" && fixtureRegistry && typeof fixtureRegistry.getFixtures === "function") {
      telemetry = hueBridge.syncTransportForFixtures(fixtureRegistry.getFixtures(), {
        mode,
        reason: "hue_transport_route"
      });
    }
    res.json({
      ok: true,
      mode,
      telemetry
    });
  });

  app.get("/fixtures", (_req, res) => {
    res.json(buildCompatFixturesSnapshot(fixtureRegistry));
  });

  app.get("/fixtures/config", (_req, res) => {
    const snapshot = buildCompatFixturesSnapshot(fixtureRegistry);
    res.json({
      ok: true,
      config: snapshot
    });
  });

  app.get("/fixtures/modes/verify", (req, res) => {
    const verbose = String(req?.query?.verbose || "").trim() === "1";
    const fixtures = fixtureRegistry.getFixtures();
    const rows = fixtures.map(row => ({
      id: normalizeFixtureIdToken(row?.id, ""),
      brand: normalizeToken(row?.brand || "other", 16).toLowerCase() || "other",
      mode: {
        enabled: row?.enabled !== false,
        engineEnabled: row?.engineEnabled !== false,
        twitchEnabled: row?.twitchEnabled !== false,
        customEnabled: row?.customEnabled === true
      }
    }));
    const hasConflict = rows.some(item => item.mode.enabled !== true);
    const report = {
      ok: !hasConflict,
      summary: {
        total: rows.length,
        enabled: rows.filter(item => item.mode.enabled === true).length,
        disabled: rows.filter(item => item.mode.enabled !== true).length
      },
      conflicts: rows
        .filter(item => item.mode.enabled !== true)
        .map(item => ({
          fixtureId: item.id,
          issue: "fixture_disabled"
        })),
      rows: verbose ? rows : []
    };
    res.status(report.ok ? 200 : 409).json(report);
  });

  app.post("/fixtures/reload", enforceWriteAccess, (_req, res) => {
    fixtureRegistry.load();
    res.json({
      ok: true,
      fixtures: fixtureRegistry.getFixtures()
    });
  });

  app.post("/fixtures/fixture", enforceWriteAccess, (req, res) => {
    const result = fixtureRegistry.upsertFixture(getRequestMap(req.body));
    if (!result.ok) {
      toCompatError(res, 400, String(result.error || "invalid_fixture_payload"), result.detail);
      return;
    }
    res.json({
      ok: true,
      ...result,
      fixtures: fixtureRegistry.getFixtures()
    });
  });

  app.delete("/fixtures/fixture", enforceWriteAccess, (req, res) => {
    const id = normalizeFixtureIdFromRequest(req);
    const result = fixtureRegistry.deleteFixture(id);
    if (!result.ok) {
      const status = result.error === "fixture_not_found" ? 404 : 400;
      toCompatError(res, status, String(result.error || "delete_fixture_failed"), id);
      return;
    }
    res.json({
      ok: true,
      ...result,
      fixtures: fixtureRegistry.getFixtures()
    });
  });

  app.get("/fixtures/connectivity", (_req, res) => {
    res.json(fixtureRegistry.getConnectivitySnapshot());
  });

  app.post("/fixtures/connectivity/test", enforceWriteAccess, (req, res) => {
    const body = getRequestMap(req.body);
    const result = fixtureRegistry.testConnectivity(body.id, body.timeoutMs);
    if (!result.ok) {
      const status = result.error === "fixture_not_found" ? 404 : 400;
      toCompatError(res, status, String(result.error || "fixture_connectivity_failed"));
      return;
    }
    res.json(result);
  });

  app.get("/hue/discover", async (req, res) => {
    if (!hueBridge || typeof hueBridge.discoverBridges !== "function") {
      toCompatError(res, 503, "hue_discovery_unavailable");
      return;
    }
    const result = await hueBridge.discoverBridges({
      timeoutMs: req?.query?.timeoutMs
    });
    if (!result?.ok) {
      toCompatError(res, 502, String(result?.error || "hue_discovery_failed"), String(result?.detail || ""));
      return;
    }
    res.json({
      ok: true,
      bridges: normalizeDiscoveredBridges(result.bridges)
    });
  });

  app.post("/hue/pair", enforceWriteAccess, async (req, res) => {
    if (!hueBridge || typeof hueBridge.pairBridge !== "function") {
      toCompatError(res, 503, "hue_pair_unavailable");
      return;
    }
    const body = getRequestMap(req.body);
    const bridgeIp = normalizeHueBridgeHost(body.bridgeIp);
    if (!bridgeIp) {
      toCompatError(res, 400, "invalid_bridge_ip");
      return;
    }
    const pair = await hueBridge.pairBridge({
      bridgeIp,
      bridgeId: normalizeToken(body.bridgeId, 64),
      appName: normalizeToken(body.appName || "ravelink#bridge", 96),
      timeoutMs: clampNumber(body.timeoutMs, 1000, 120000, 30000),
      pollMs: clampNumber(body.pollMs, 250, 10000, 1200)
    });
    if (!pair?.ok) {
      const status = String(pair?.error || "") === "link_button_timeout" ? 408 : 400;
      toCompatError(res, status, String(pair?.error || "pair_failed"), String(pair?.detail || ""));
      return;
    }

    const bridge = {
      ip: normalizeHueBridgeHost(pair?.bridge?.ip || bridgeIp),
      id: normalizeToken(pair?.bridge?.id || body.bridgeId, 64).toUpperCase()
    };
    const credentials = {
      username: normalizeToken(pair?.credentials?.username, 64),
      clientKey: normalizeToken(pair?.credentials?.clientKey, 128).toUpperCase()
    };
    const entertainmentAreas = normalizeEntertainmentAreas(pair?.entertainmentAreas);
    const bridgeCapabilities = normalizeHueBridgeCapabilities(pair?.capabilities);
    const supportsEntertainment = bridgeCapabilities.supportsEntertainment === true
      && Boolean(credentials.clientKey);
    const fixtureHint = getRequestMap(body.fixture);
    let entertainmentAreaId = normalizeToken(
      body.entertainmentAreaId || fixtureHint.entertainmentAreaId,
      96
    );
    let warning = false;
    if (!entertainmentAreaId && entertainmentAreas.length) {
      entertainmentAreaId = String(entertainmentAreas[0].name || entertainmentAreas[0].id || "").trim();
      warning = true;
    }
    if (body.requireEntertainmentArea !== false && supportsEntertainment && !entertainmentAreaId) {
      res.status(400).json({
        ok: false,
        error: "missing_entertainment_area",
        entertainmentAreas
      });
      return;
    }

    let fixtureSaved = false;
    let fixture = null;
    let fixtureSaveError = "";
    if (body.saveFixture === true) {
      const lightId = clampNumber(
        fixtureHint.lightId ?? body.lightId,
        1,
        65535,
        1
      );
      const fixtureId = normalizeFixtureIdToken(
        fixtureHint.id || body.fixtureId,
        buildHueFixtureId({
          bridgeId: bridge.id || bridge.ip,
          lightId
        })
      );
      const fixturePayload = {
        id: fixtureId,
        brand: "hue",
        zone: normalizeToken(fixtureHint.zone || "hue", 64).toLowerCase() || "hue",
        enabled: fixtureHint.enabled !== false,
        engineEnabled: fixtureHint.engineEnabled !== false,
        twitchEnabled: fixtureHint.twitchEnabled !== false,
        customEnabled: fixtureHint.customEnabled === true,
        bridgeIp: bridge.ip,
        username: credentials.username,
        lightId,
        bridgeId: bridge.id,
        clientKey: supportsEntertainment ? credentials.clientKey : "",
        entertainmentAreaId: supportsEntertainment ? entertainmentAreaId : "",
        extras: {
          ...getRequestMap(fixtureHint.extras),
          hueBridgeCapabilities: bridgeCapabilities
        }
      };
      const saved = fixtureRegistry.upsertFixture(fixturePayload);
      if (saved?.ok) {
        fixtureSaved = true;
        fixture = saved.fixture || fixturePayload;
      } else {
        fixtureSaveError = String(saved?.error || "fixture_save_failed");
      }
    }

    res.json({
      ok: true,
      bridge,
      credentials,
      bridgeIp: bridge.ip,
      username: credentials.username,
      clientkey: credentials.clientKey,
      entertainmentAreas,
      capabilities: bridgeCapabilities,
      fixtureSaved,
      fixture,
      fixtureSaveError,
      warning
    });
  });

  app.post("/hue/pair/all", enforceWriteAccess, async (req, res) => {
    if (!fixtureRegistry || typeof fixtureRegistry.upsertFixture !== "function" || typeof fixtureRegistry.getFixtures !== "function") {
      toCompatError(res, 503, "fixture_registry_unavailable");
      return;
    }
    if (!hueBridge || typeof hueBridge.listLights !== "function") {
      toCompatError(res, 503, "hue_light_inventory_unavailable");
      return;
    }

    const body = getRequestMap(req.body);
    const fixtureHint = getRequestMap(body.fixture);
    const bridgeIp = normalizeHueBridgeHost(body.bridgeIp);
    const username = normalizeToken(body.username, 64).replace(/[^a-zA-Z0-9_-]/g, "");
    if (!bridgeIp) {
      toCompatError(res, 400, "invalid_bridge_ip");
      return;
    }
    if (!username) {
      toCompatError(res, 400, "missing_hue_username");
      return;
    }

    const lightScan = await hueBridge.listLights({
      bridgeIp,
      username,
      timeoutMs: clampNumber(body.timeoutMs, 200, 15000, 3000)
    });
    if (!lightScan?.ok) {
      toCompatError(
        res,
        502,
        String(lightScan?.error || "hue_lights_query_failed"),
        String(lightScan?.detail || "")
      );
      return;
    }

    const lights = normalizeHueBridgeLights(lightScan.lights);
    const bridgeId = normalizeToken(body.bridgeId, 64).toUpperCase();
    const clientKey = normalizeToken(body.clientKey, 128).toUpperCase();
    const entertainmentAreaId = normalizeToken(body.entertainmentAreaId, 96);
    const zone = normalizeToken(fixtureHint.zone || "hue", 64).toLowerCase() || "hue";
    const enabled = fixtureHint.enabled !== false;
    const engineEnabled = fixtureHint.engineEnabled !== false;
    const twitchEnabled = fixtureHint.twitchEnabled !== false;
    const customEnabled = fixtureHint.customEnabled === true;

    const capabilityInput = getRequestMap(body.capabilities);
    const fallbackCapabilities = normalizeHueBridgeCapabilities({
      supportsEntertainment: Boolean(clientKey),
      supportsHttps: true,
      forceHttp: false,
      entertainmentAreasAvailable: Boolean(entertainmentAreaId)
    });
    const bridgeCapabilities = normalizeHueBridgeCapabilities({
      ...fallbackCapabilities,
      ...capabilityInput,
      supportsEntertainment: capabilityInput.supportsEntertainment === undefined
        ? fallbackCapabilities.supportsEntertainment
        : capabilityInput.supportsEntertainment,
      supportsHttps: capabilityInput.supportsHttps === undefined
        ? fallbackCapabilities.supportsHttps
        : capabilityInput.supportsHttps,
      forceHttp: capabilityInput.forceHttp === true,
      entertainmentAreasAvailable: capabilityInput.entertainmentAreasAvailable === undefined
        ? fallbackCapabilities.entertainmentAreasAvailable
        : capabilityInput.entertainmentAreasAvailable
    });
    const entertainmentAreaForFixtures = bridgeCapabilities.supportsEntertainment === true
      ? entertainmentAreaId
      : "";
    const clientKeyForFixtures = bridgeCapabilities.supportsEntertainment === true
      ? clientKey
      : "";

    const existingIds = new Set(
      (Array.isArray(fixtureRegistry.getFixtures()) ? fixtureRegistry.getFixtures() : [])
        .map(row => String(row?.id || "").trim())
        .filter(Boolean)
    );

    const fixtures = [];
    const errors = [];
    let added = 0;
    let updated = 0;
    let skipped = 0;
    for (const light of lights) {
      const lightId = clampNumber(Math.round(Number(light?.lightId)), 1, 65535, NaN);
      if (!Number.isFinite(lightId)) {
        skipped += 1;
        continue;
      }
      const fixtureId = normalizeFixtureIdToken(
        buildHueFixtureId({
          bridgeId: bridgeId || bridgeIp,
          lightId
        }),
        `hue-${lightId}`
      );
      const fixturePayload = {
        id: fixtureId,
        brand: "hue",
        zone,
        enabled,
        engineEnabled,
        twitchEnabled,
        customEnabled,
        bridgeIp,
        username,
        lightId,
        bridgeId,
        clientKey: clientKeyForFixtures,
        entertainmentAreaId: entertainmentAreaForFixtures,
        extras: {
          hueBridgeCapabilities: bridgeCapabilities
        }
      };
      const saved = fixtureRegistry.upsertFixture(fixturePayload);
      if (saved?.ok) {
        const wasExisting = existingIds.has(fixtureId);
        if (wasExisting) {
          updated += 1;
        } else {
          added += 1;
          existingIds.add(fixtureId);
        }
        fixtures.push(saved.fixture || fixturePayload);
      } else {
        skipped += 1;
        errors.push({
          lightId,
          error: String(saved?.error || "fixture_save_failed")
        });
      }
    }

    res.json({
      ok: true,
      bridge: {
        ip: bridgeIp,
        id: bridgeId
      },
      totalLights: lights.length,
      added,
      updated,
      skipped,
      failed: errors.length,
      fixtures,
      lights,
      errors
    });
  });

  app.get("/wiz/discover", async (req, res) => {
    if (!wizBridge || typeof wizBridge.discoverDevices !== "function") {
      toCompatError(res, 503, "wiz_discovery_unavailable");
      return;
    }
    const result = await wizBridge.discoverDevices({
      timeoutMs: req?.query?.timeoutMs
    });
    if (!result?.ok) {
      toCompatError(res, 502, String(result?.error || "wiz_discovery_failed"), String(result?.detail || ""));
      return;
    }
    const devices = (Array.isArray(result.devices) ? result.devices : [])
      .map(row => ({
        ip: normalizeIpv4Host(row?.ip),
        mac: normalizeToken(row?.mac, 64).toUpperCase(),
        moduleName: normalizeToken(row?.moduleName, 96),
        roomId: clampNumber(row?.roomId, 0, 65535, 0),
        roomName: normalizeToken(row?.roomName, 96)
      }))
      .filter(row => row.ip);
    res.json({
      ok: true,
      devices
    });
  });
};
