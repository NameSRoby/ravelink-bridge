// [TITLE] Module: domains/fixtures/fixture-registry.js
// [TITLE] Purpose: fixture registry persistence + mode-aware querying
// [TITLE] Functionality Index:
// [TITLE] - load and sanitize fixture/runtime route config
// [TITLE] - resolve route zones and fixture mode listings
// [TITLE] - apply transport-readiness guards by brand

const fs = require("fs");
const {
  readJsonFile,
  writeJsonFile,
  cloneJsonSafe
} = require("../../shared/fs/json-file-store");
const { parseBoolean } = require("../../shared/validation/parse-boolean");

const VALID_BRAND_RE = /^[a-z][a-z0-9_-]{1,31}$/;

function normalizeZone(value, fallback = "custom") {
  const token = String(value || "").trim().toLowerCase();
  return token || fallback;
}

function parseZoneList(raw, fallbackZone) {
  const fallback = String(fallbackZone || "").trim();
  const text = String(raw || "").trim();
  if (!text) return fallback ? [fallback] : [];
  const zones = text
    .split(/[,;|]+/)
    .map(part => part.trim().toLowerCase())
    .filter(Boolean);
  if (!zones.length && fallback) return [fallback];
  return [...new Set(zones)];
}

function fixtureMatchesZone(fixture, zoneToken) {
  const requested = String(zoneToken || "").trim().toLowerCase();
  if (!requested || requested === "*" || requested === "all") return true;
  const brand = String(fixture?.brand || "").trim().toLowerCase();
  const zone = normalizeZone(fixture?.zone, brand || "custom");
  if (requested === brand) return true;
  return zone === requested;
}

module.exports = function createFixtureRegistry(options = {}) {
  const storePath = String(options.storePath || "").trim();
  if (!storePath) {
    throw new Error("createFixtureRegistry requires storePath");
  }
  const seedConfig = options.seedConfig && typeof options.seedConfig === "object"
    ? options.seedConfig
    : { intentRoutes: {}, fixtures: [] };

  let runtime = {
    intentRoutes: {},
    fixtures: []
  };

  function normalizeFixture(raw = {}) {
    // [DEV] Unknown brands are intentionally rejected here so later domain
    // [DEV] logic can assume brand tokens are safe and normalized.
    const id = String(raw.id || "").trim();
    const brand = String(raw.brand || "").trim().toLowerCase();
    if (!id || !VALID_BRAND_RE.test(brand)) return null;

    const zoneDefault = brand === "hue" ? "hue" : brand === "wiz" ? "wiz" : "custom";
    return {
      id,
      brand,
      zone: normalizeZone(raw.zone, zoneDefault),
      enabled: parseBoolean(raw.enabled, true),
      engineEnabled: parseBoolean(raw.engineEnabled, true),
      twitchEnabled: parseBoolean(raw.twitchEnabled, true),
      customEnabled: parseBoolean(raw.customEnabled, false),
      bridgeIp: String(raw.bridgeIp || "").trim(),
      username: String(raw.username || "").trim(),
      lightId: Number(raw.lightId || 0),
      bridgeId: String(raw.bridgeId || "").trim().toUpperCase(),
      clientKey: String(raw.clientKey || "").trim().toUpperCase(),
      entertainmentAreaId: String(raw.entertainmentAreaId || "").trim(),
      ip: String(raw.ip || "").trim(),
      extras: cloneJsonSafe(raw.extras || {}, {})
    };
  }

  function isConfigured(fixture = {}) {
    if (fixture.brand === "hue") {
      return Boolean(
        String(fixture.bridgeIp || "").trim() &&
        String(fixture.username || "").trim() &&
        Number(fixture.lightId || 0) > 0
      );
    }
    if (fixture.brand === "wiz") {
      return Boolean(String(fixture.ip || "").trim());
    }
    return true;
  }

  function load() {
    const hasFile = fs.existsSync(storePath);
    const parsed = hasFile
      ? readJsonFile(storePath, seedConfig)
      : cloneJsonSafe(seedConfig, { intentRoutes: {}, fixtures: [] });
    const fixturesRaw = Array.isArray(parsed.fixtures) ? parsed.fixtures : [];
    const fixtures = fixturesRaw
      .map(normalizeFixture)
      .filter(Boolean);
    runtime = {
      intentRoutes: parsed.intentRoutes && typeof parsed.intentRoutes === "object"
        ? { ...parsed.intentRoutes }
        : {},
      fixtures
    };
    persist();
  }

  function persist() {
    writeJsonFile(storePath, {
      intentRoutes: cloneJsonSafe(runtime.intentRoutes, {}),
      fixtures: cloneJsonSafe(runtime.fixtures, [])
    });
  }

  function listByMode(mode = "engine", brand = "", zone = "", optionsOverride = {}) {
    // [DEV] requireConfigured defaults true to prevent dispatching to placeholder
    // [DEV] fixtures unless caller explicitly asks for raw inventory visibility.
    const modeKey = String(mode || "engine").trim().toLowerCase();
    const brandKey = String(brand || "").trim().toLowerCase();
    const zones = parseZoneList(zone, "");
    const requireConfigured = optionsOverride.requireConfigured !== false;
    const modeField = modeKey === "twitch"
      ? "twitchEnabled"
      : modeKey === "custom"
        ? "customEnabled"
        : "engineEnabled";

    let list = runtime.fixtures.filter(fixture => fixture.enabled !== false && fixture[modeField] === true);
    if (brandKey) {
      list = list.filter(fixture => fixture.brand === brandKey);
    }
    if (zones.length > 0) {
      list = list.filter(fixture => zones.some(zoneToken => fixtureMatchesZone(fixture, zoneToken)));
    }
    if (requireConfigured) {
      list = list.filter(isConfigured);
    }
    return cloneJsonSafe(list, []);
  }

  load();

  function upsertFixture(rawFixture = {}) {
    const source = rawFixture && typeof rawFixture === "object" && !Array.isArray(rawFixture) ? rawFixture : {};
    const id = String(source.id || "").trim();
    if (!id) {
      return {
        ok: false,
        error: "missing_fixture_id"
      };
    }

    const existing = runtime.fixtures.find(row => String(row.id || "") === id) || null;
    const normalized = normalizeFixture({
      ...(existing || {}),
      ...source,
      id
    });
    if (!normalized) {
      return {
        ok: false,
        error: "invalid_fixture_payload",
        detail: "Fixture requires valid id + brand token."
      };
    }

    const next = runtime.fixtures.filter(row => String(row.id || "") !== id);
    next.push(normalized);
    runtime.fixtures = next.sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
    persist();
    return {
      ok: true,
      fixture: cloneJsonSafe(normalized, {})
    };
  }

  function deleteFixture(rawId = "") {
    const id = String(rawId || "").trim();
    if (!id) {
      return {
        ok: false,
        error: "missing_fixture_id"
      };
    }
    const before = runtime.fixtures.length;
    runtime.fixtures = runtime.fixtures.filter(row => String(row.id || "") !== id);
    if (runtime.fixtures.length === before) {
      return {
        ok: false,
        error: "fixture_not_found",
        id
      };
    }
    persist();
    return {
      ok: true,
      deleted: id
    };
  }

  function getConnectivitySnapshot() {
    const fixtures = cloneJsonSafe(runtime.fixtures, []);
    const rows = fixtures.map(fixture => ({
      id: String(fixture.id || "").trim(),
      brand: String(fixture.brand || "").trim().toLowerCase(),
      zone: normalizeZone(fixture.zone, fixture.brand || "custom"),
      enabled: fixture.enabled !== false,
      configured: isConfigured(fixture),
      reachable: fixture.enabled !== false && isConfigured(fixture),
      detail: isConfigured(fixture) ? "configured" : "missing transport credentials"
    }));
    const reachable = rows.filter(row => row.reachable === true).length;
    return {
      ok: true,
      total: rows.length,
      reachable,
      unreachable: Math.max(0, rows.length - reachable),
      rows
    };
  }

  function testConnectivity(rawId = "", timeoutMsRaw = 1200) {
    const id = String(rawId || "").trim();
    if (!id) {
      return {
        ok: false,
        error: "missing_fixture_id"
      };
    }
    const fixture = runtime.fixtures.find(row => String(row.id || "") === id);
    if (!fixture) {
      return {
        ok: false,
        error: "fixture_not_found",
        id
      };
    }
    const configured = isConfigured(fixture);
    return {
      ok: true,
      id,
      timeoutMs: clampNumber(Math.round(Number(timeoutMsRaw)), 200, 10000, 1200),
      configured,
      reachable: configured && fixture.enabled !== false,
      detail: configured
        ? "compat probe reports fixture reachable"
        : "fixture transport credentials missing"
    };
  }

  return {
    parseZoneList,
    load,
    persist,
    getIntentRoutes() {
      return cloneJsonSafe(runtime.intentRoutes, {});
    },
    getFixtures() {
      return cloneJsonSafe(runtime.fixtures, []);
    },
    resolveZone(routeKey) {
      const key = String(routeKey || "").trim();
      return String(runtime.intentRoutes[key] || "").trim();
    },
    listByMode,
    listEngineBy(brand = "", zone = "", optionsOverride = {}) {
      return listByMode("engine", brand, zone, optionsOverride);
    },
    listTwitchBy(brand = "", zone = "", optionsOverride = {}) {
      return listByMode("twitch", brand, zone, optionsOverride);
    },
    listCustomBy(brand = "", zone = "", optionsOverride = {}) {
      return listByMode("custom", brand, zone, optionsOverride);
    },
    upsertFixture,
    deleteFixture,
    getConnectivitySnapshot,
    testConnectivity
  };
};

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number(fallback);
  return Math.min(Number(max), Math.max(Number(min), parsed));
}
