// [TITLE] Module: public/assets/js/domains/contracts/fixtures-domain.adapter.js
// [TITLE] Purpose: typed fixtures payload contract adapter for runtime-safe normalization
// [TITLE] Functionality Index:
// [TITLE] - fixture list/snapshot normalization
// [TITLE] - fixture identity + brand/zone safety normalization
// [DEV] Complex Flow:
// [DEV] This adapter preserves route payload flexibility while guaranteeing fixtures
// [DEV] consumers receive a stable array/object shape.

/**
 * @typedef {Object} FixtureContract
 * @property {string} id
 * @property {string} brand
 * @property {string} zone
 * @property {boolean} enabled
 * @property {boolean} engineEnabled
 * @property {boolean} twitchEnabled
 */

/**
 * @typedef {Object} FixturesSnapshotContract
 * @property {boolean} ok
 * @property {FixtureContract[]} fixtures
 * @property {number} total
 */

function normalizeTokenFixturesDomain(value, fallback = "") {
  const token = String(value || "").trim().toLowerCase();
  return token || String(fallback || "").trim().toLowerCase();
}

function normalizeBooleanFixturesDomain(value, fallback = true) {
  if (value === true || value === false) return value;
  const token = String(value || "").trim().toLowerCase();
  if (token === "true" || token === "1" || token === "yes" || token === "on") return true;
  if (token === "false" || token === "0" || token === "no" || token === "off") return false;
  return fallback === true;
}

function normalizeFixtureIdTokenFixturesDomain(value, max = 96) {
  const token = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return token.slice(0, Math.max(1, Number(max) || 96));
}

function normalizeIpv4TokenFixturesDomain(value) {
  const host = String(value || "").trim();
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) return "";
  const parts = host.split(".").map(part => Number(part));
  if (parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return "";
  return host;
}

function buildFallbackFixtureIdFixturesDomain(source = {}) {
  const brand = normalizeTokenFixturesDomain(source.brand, "fixture");

  if (brand === "hue") {
    const bridgeToken = normalizeFixtureIdTokenFixturesDomain(
      source.bridgeId || source.bridgeIp || source.ip || "bridge",
      24
    );
    const lightId = Math.round(Number(source.lightId || source.light?.id || 0));
    if (Number.isInteger(lightId) && lightId > 0) {
      return normalizeFixtureIdTokenFixturesDomain(`hue-${bridgeToken || "bridge"}-${lightId}`, 96);
    }
  }

  if (brand === "wiz") {
    const host = normalizeIpv4TokenFixturesDomain(source.ip || source.host || "");
    if (host) {
      return normalizeFixtureIdTokenFixturesDomain(`wiz-${host.replace(/\./g, "-")}`, 96);
    }
  }

  const hint =
    source.name ||
    source.label ||
    source.zone ||
    source.target ||
    source.ip ||
    source.bridgeIp ||
    "";
  const hintToken = normalizeFixtureIdTokenFixturesDomain(hint, 48);
  if (!hintToken) return "";
  return normalizeFixtureIdTokenFixturesDomain(`${brand || "fixture"}-${hintToken}`, 96);
}

function normalizeFixtureContract(fixture = null) {
  const source = fixture && typeof fixture === "object" ? fixture : {};
  const explicitId = String(source.id || source.fixtureId || "").trim();
  const id = normalizeFixtureIdTokenFixturesDomain(explicitId || "", 96) ||
    buildFallbackFixtureIdFixturesDomain(source);
  if (!id) return null;
  return {
    ...source,
    id,
    brand: normalizeTokenFixturesDomain(source.brand, "unknown"),
    zone: normalizeTokenFixturesDomain(source.zone, "default"),
    enabled: normalizeBooleanFixturesDomain(source.enabled, true),
    engineEnabled: normalizeBooleanFixturesDomain(source.engineEnabled, true),
    twitchEnabled: normalizeBooleanFixturesDomain(source.twitchEnabled, true)
  };
}

/**
 * @param {any} payload
 * @returns {FixturesSnapshotContract|null}
 */
function normalizeFixturesSnapshotContract(payload = null) {
  if (!payload || typeof payload !== "object") return null;
  const source = payload;
  const fixturesRaw = Array.isArray(source.fixtures)
    ? source.fixtures
    : (Array.isArray(source.items) ? source.items : []);
  const fixtures = fixturesRaw
    .map(normalizeFixtureContract)
    .filter(Boolean);
  return {
    ...source,
    ok: source.ok !== false,
    fixtures,
    total: fixtures.length
  };
}

/** @type {{normalizeFixtureContract:(fixture:any)=>FixtureContract|null, normalizeFixturesSnapshotContract:(payload:any)=>FixturesSnapshotContract|null}} */
const fixturesDomainAdapter = Object.freeze({
  normalizeFixtureContract,
  normalizeFixturesSnapshotContract
});

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizeFixtureContract,
    normalizeFixturesSnapshotContract,
    fixturesDomainAdapter
  };
}
