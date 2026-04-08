// [TITLE] Module: app/routes/compat/fixtures-hardware.compat.helpers.js
// [TITLE] Purpose: own fixture snapshot and hardware normalization helpers for compat routes
// [TITLE] Functionality Index:
// [TITLE] - build fixture inventory/connectivity compatibility snapshots
// [TITLE] - normalize fixture ids plus Hue/WiZ discovery/pairing payload fields
// [TITLE] - derive deterministic Hue fixture ids and bridge capability snapshots
// [DEV] Complex Flow:
// [DEV] These helpers shape only the fixtures/hardware compat surface, so they live
// [DEV] beside that registrar instead of inflating the top-level compat composer.

function createFixturesHardwareCompatHelpers(deps = {}) {
  const getRequestMap = typeof deps.getRequestMap === "function"
    ? deps.getRequestMap
    : (value => (value && typeof value === "object" && !Array.isArray(value) ? value : {}));
  const normalizeToken = typeof deps.normalizeToken === "function"
    ? deps.normalizeToken
    : ((value, max = 96) => String(value || "").trim().slice(0, Math.max(1, Number(max) || 96)));
  const clampNumber = typeof deps.clampNumber === "function"
    ? deps.clampNumber
    : ((value, min, max, fallback) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return Number(fallback);
      return Math.min(Number(max), Math.max(Number(min), parsed));
    });

  function normalizeFixtureIdFromRequest(req) {
    return String(
      req?.body?.id ??
      req?.query?.id ??
      req?.params?.id ??
      ""
    ).trim();
  }

  function normalizeHueBridgeHost(value) {
    const token = String(value || "").trim().toLowerCase();
    if (!token) return "";
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(token)) return token;
    if (/^[a-z0-9][a-z0-9.-]{0,252}[a-z0-9]$/i.test(token)) return token;
    return "";
  }

  function normalizeIpv4Host(value) {
    const token = String(value || "").trim();
    if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(token)) return "";
    const parts = token.split(".").map(part => Number(part));
    if (parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return "";
    return token;
  }

  function isCompatFixtureConfigured(fixture = {}) {
    const brand = String(fixture?.brand || "").trim().toLowerCase();
    if (brand === "hue") {
      return Boolean(
        String(fixture?.bridgeIp || "").trim() &&
        String(fixture?.username || "").trim() &&
        Number(fixture?.lightId || 0) > 0
      );
    }
    if (brand === "wiz") {
      return Boolean(String(fixture?.ip || "").trim());
    }
    return true;
  }

  function listCompatFixturesByMode(fixtures = [], mode = "engine", brand = "", options = {}) {
    const rows = Array.isArray(fixtures) ? fixtures : [];
    const modeKey = String(mode || "engine").trim().toLowerCase();
    const brandKey = String(brand || "").trim().toLowerCase();
    const requireConfigured = options?.requireConfigured !== false;
    return rows.filter(fixture => {
      const fixtureBrand = String(fixture?.brand || "").trim().toLowerCase();
      if (brandKey && fixtureBrand !== brandKey) return false;
      if (fixture?.enabled === false) return false;
      if (modeKey === "custom") {
        if (fixture?.customEnabled !== true) return false;
      } else if (modeKey === "twitch") {
        if (fixture?.twitchEnabled === false) return false;
      } else if (fixture?.engineEnabled === false) {
        return false;
      }
      if (requireConfigured && !isCompatFixtureConfigured(fixture)) {
        return false;
      }
      return true;
    });
  }

  function buildCompatFixturesSnapshot(fixtureRegistry) {
    const fixtures = Array.isArray(fixtureRegistry?.getFixtures?.())
      ? fixtureRegistry.getFixtures()
      : [];
    const routes = fixtureRegistry?.getIntentRoutes?.() || {};
    const connectivitySnapshot = fixtureRegistry?.getConnectivitySnapshot?.() || {};
    const connectivityRows = Array.isArray(connectivitySnapshot?.rows)
      ? connectivitySnapshot.rows
      : fixtures.map(fixture => ({
        id: String(fixture?.id || "").trim(),
        brand: String(fixture?.brand || "").trim().toLowerCase(),
        zone: String(fixture?.zone || "").trim().toLowerCase(),
        enabled: fixture?.enabled !== false,
        configured: isCompatFixtureConfigured(fixture),
        reachable: fixture?.enabled !== false && isCompatFixtureConfigured(fixture),
        detail: isCompatFixtureConfigured(fixture) ? "configured" : "missing transport credentials"
      }));
    const engineHue = typeof fixtureRegistry?.listEngineBy === "function"
      ? fixtureRegistry.listEngineBy("hue", "", { requireConfigured: false })
      : listCompatFixturesByMode(fixtures, "engine", "hue", { requireConfigured: false });
    const engineWiz = typeof fixtureRegistry?.listEngineBy === "function"
      ? fixtureRegistry.listEngineBy("wiz", "", { requireConfigured: false })
      : listCompatFixturesByMode(fixtures, "engine", "wiz", { requireConfigured: false });
    const engineHueReady = typeof fixtureRegistry?.listEngineBy === "function"
      ? fixtureRegistry.listEngineBy("hue", "", { requireConfigured: true })
      : listCompatFixturesByMode(fixtures, "engine", "hue", { requireConfigured: true });
    const engineWizReady = typeof fixtureRegistry?.listEngineBy === "function"
      ? fixtureRegistry.listEngineBy("wiz", "", { requireConfigured: true })
      : listCompatFixturesByMode(fixtures, "engine", "wiz", { requireConfigured: true });
    const modBrands = [...new Set(
      fixtures
        .map(fixture => String(fixture?.brand || "").trim().toLowerCase())
        .filter(brand => brand && brand !== "hue" && brand !== "wiz")
    )].sort();
    const summary = {
      total: fixtures.length,
      hue: fixtures.filter(fixture => String(fixture?.brand || "").trim().toLowerCase() === "hue").length,
      wiz: fixtures.filter(fixture => String(fixture?.brand || "").trim().toLowerCase() === "wiz").length,
      hueReady: connectivityRows.filter(row => String(row?.brand || "").trim().toLowerCase() === "hue" && row?.reachable === true).length,
      wizReady: connectivityRows.filter(row => String(row?.brand || "").trim().toLowerCase() === "wiz" && row?.reachable === true).length,
      hueEngine: engineHue.length,
      wizEngine: engineWiz.length,
      hueEngineReady: engineHueReady.length,
      wizEngineReady: engineWizReady.length,
      modBrands,
      routes
    };
    const reachableCount = connectivityRows.filter(row => row?.reachable === true).length;
    const totalCount = Number(
      connectivitySnapshot?.total ??
      connectivitySnapshot?.fixtureCount ??
      connectivityRows.length ??
      0
    ) || 0;
    const resolvedReachableCount = Number(connectivitySnapshot?.reachable ?? reachableCount) || 0;
    const connectivitySummary = {
      ok: connectivitySnapshot?.ok !== false,
      total: totalCount,
      reachable: resolvedReachableCount,
      unreachable: Number(
        connectivitySnapshot?.unreachable ??
        Math.max(0, totalCount - resolvedReachableCount)
      ) || 0
    };
    return {
      ok: true,
      fixtures,
      routes,
      intentRoutes: routes,
      summary,
      connectivity: connectivityRows,
      connectivitySummary
    };
  }

  function normalizeFixtureIdToken(value, fallback = "") {
    const raw = String(value || fallback || "").trim().toLowerCase();
    return raw.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  }

  function buildHueFixtureId(hint = {}) {
    const bridgeId = normalizeToken(hint.bridgeId, 12).toLowerCase().replace(/[^a-z0-9]+/g, "");
    const lightId = clampNumber(Math.round(Number(hint.lightId)), 1, 65535, 1);
    const bridgeToken = bridgeId || "bridge";
    return normalizeFixtureIdToken(`hue-${bridgeToken}-${lightId}`, `hue-${lightId}`);
  }

  function normalizeEntertainmentAreas(rows = []) {
    const out = [];
    for (const row of (Array.isArray(rows) ? rows : [])) {
      const id = normalizeToken(row?.id, 64);
      if (!id) continue;
      out.push({
        id,
        name: normalizeToken(row?.name || id, 96)
      });
    }
    return out;
  }

  function normalizeHueBridgeCapabilities(input = {}) {
    const source = getRequestMap(input);
    const bridgeModelId = normalizeToken(source.bridgeModelId, 32).toUpperCase();
    return {
      bridgeModelId,
      bridgeSoftwareVersion: normalizeToken(source.bridgeSoftwareVersion, 64),
      apiVersion: normalizeToken(source.apiVersion, 64),
      supportsHttps: source.supportsHttps !== false,
      supportsEntertainment: source.supportsEntertainment !== false,
      forceHttp: source.forceHttp === true,
      entertainmentAreasAvailable: source.entertainmentAreasAvailable === true
    };
  }

  function normalizeDiscoveredBridges(rows = []) {
    const out = [];
    for (const row of (Array.isArray(rows) ? rows : [])) {
      const ip = normalizeHueBridgeHost(row?.ip || row?.internalipaddress || row?.internalIpAddress);
      if (!ip) continue;
      out.push({
        id: normalizeToken(row?.id || row?.bridgeid || row?.bridgeId, 64).toUpperCase(),
        ip
      });
    }
    return out;
  }

  function normalizeHueBridgeLights(rows = []) {
    const out = [];
    for (const row of (Array.isArray(rows) ? rows : [])) {
      const lightId = clampNumber(Math.round(Number(row?.lightId)), 1, 65535, NaN);
      if (!Number.isFinite(lightId)) continue;
      out.push({
        lightId,
        name: normalizeToken(row?.name || `Hue light ${lightId}`, 96),
        modelId: normalizeToken(row?.modelId, 32).toUpperCase(),
        type: normalizeToken(row?.type, 64),
        productName: normalizeToken(row?.productName, 64),
        uniqueId: normalizeToken(row?.uniqueId, 128),
        swVersion: normalizeToken(row?.swVersion, 32)
      });
    }
    out.sort((a, b) => Number(a.lightId || 0) - Number(b.lightId || 0));
    return out;
  }

  return {
    normalizeFixtureIdFromRequest,
    buildCompatFixturesSnapshot,
    normalizeFixtureIdToken,
    normalizeHueBridgeHost,
    normalizeIpv4Host,
    normalizeEntertainmentAreas,
    normalizeHueBridgeCapabilities,
    normalizeDiscoveredBridges,
    normalizeHueBridgeLights,
    buildHueFixtureId
  };
}

module.exports = {
  createFixturesHardwareCompatHelpers
};
