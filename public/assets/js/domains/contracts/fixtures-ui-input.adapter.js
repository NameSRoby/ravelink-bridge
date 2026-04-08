// [TITLE] Module: public/assets/js/domains/contracts/fixtures-ui-input.adapter.js
// [TITLE] Purpose: typed fixtures UI input adapter for brand/zone/config normalization
// [TITLE] Functionality Index:
// [TITLE] - normalize fixture brand and zone tokens
// [TITLE] - normalize fixture booleans and placeholder transport values
// [TITLE] - normalize fixture mod-brand catalog projection
// [DEV] Complex Flow:
// [DEV] This adapter centralizes fixture-brand validation and placeholder checks so
// [DEV] fixture form, list rendering, and routing controls use one canonical rule-set.

function createFixturesUiInputAdapter(options = {}) {
  const modBrandRe = options.modBrandRe instanceof RegExp
    ? options.modBrandRe
    : /^[a-z][a-z0-9_-]{1,31}$/;

  function getCanonicalZoneForBrand(brand, fallback = "custom") {
    const key = String(brand || "").trim().toLowerCase();
    if (key === "hue") return "hue";
    if (key === "wiz") return "wiz";
    return String(fallback || "custom").trim().toLowerCase() || "custom";
  }

  function normalizeZoneKey(value, fallback = "custom") {
    const zone = String(value || "").trim().toLowerCase();
    return zone || fallback;
  }

  function isBuiltinFixtureBrand(value) {
    const brand = String(value || "").trim().toLowerCase();
    return brand === "hue" || brand === "wiz";
  }

  function normalizeFixtureModBrandToken(value) {
    const brand = String(value || "").trim().toLowerCase();
    if (!brand || isBuiltinFixtureBrand(brand)) return "";
    return modBrandRe.test(brand) ? brand : "";
  }

  function normalizeFixtureModBrandList(value) {
    if (!Array.isArray(value)) return [];
    const set = new Set();
    value.forEach(item => {
      const brand = normalizeFixtureModBrandToken(item);
      if (brand) set.add(brand);
    });
    return [...set].sort();
  }

  function collectFixtureModBrandsFromSnapshot(summary = {}, fixtures = []) {
    const set = new Set(normalizeFixtureModBrandList(summary?.modBrands));
    if (Array.isArray(fixtures)) {
      fixtures.forEach(fixture => {
        const brand = normalizeFixtureModBrandToken(fixture?.brand);
        if (brand) set.add(brand);
      });
    }
    return [...set].sort();
  }

  function isValidFixtureBrand(brandValue) {
    const brand = String(brandValue || "").trim().toLowerCase();
    if (!brand) return false;
    if (brand === "hue" || brand === "wiz") return true;
    return modBrandRe.test(brand);
  }

  function parseLooseBoolean(value, fallback = false) {
    if (typeof value === "boolean") return value;
    if (value === 1 || value === "1") return true;
    if (value === 0 || value === "0") return false;
    if (typeof value === "string") {
      const raw = value.trim().toLowerCase();
      if (raw === "true" || raw === "on" || raw === "yes") return true;
      if (raw === "false" || raw === "off" || raw === "no") return false;
    }
    return fallback;
  }

  function isLikelyPlaceholderConfigValue(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return true;
    if (raw.includes("replace_with")) return true;
    if (raw.includes("192.168.x.x")) return true;
    if (raw.includes("x.x.x.x")) return true;
    if (raw.includes("example")) return true;
    return false;
  }

  function isFixtureConfiguredForOutput(fixture = {}) {
    const brand = String(fixture?.brand || "").trim().toLowerCase();
    if (brand === "hue") {
      const bridgeIp = String(fixture?.bridgeIp || "").trim();
      const username = String(fixture?.username || "").trim();
      const lightId = Number(fixture?.lightId || 0);
      return (
        !isLikelyPlaceholderConfigValue(bridgeIp) &&
        !isLikelyPlaceholderConfigValue(username) &&
        Number.isFinite(lightId) &&
        lightId > 0
      );
    }
    if (brand === "wiz") {
      const ip = String(fixture?.ip || "").trim();
      return !isLikelyPlaceholderConfigValue(ip);
    }
    return true;
  }

  function isFixtureEngineEnabled(fixture = {}) {
    return parseLooseBoolean(fixture?.engineEnabled, false);
  }

  function isFixtureTwitchEnabled(fixture = {}) {
    if (Object.prototype.hasOwnProperty.call(fixture, "twitchEnabled")) {
      return parseLooseBoolean(fixture.twitchEnabled, true);
    }
    return true;
  }

  function isFixtureCustomEnabled(fixture = {}) {
    return parseLooseBoolean(fixture?.customEnabled, false);
  }

  return Object.freeze({
    getCanonicalZoneForBrand,
    normalizeZoneKey,
    isBuiltinFixtureBrand,
    normalizeFixtureModBrandToken,
    normalizeFixtureModBrandList,
    collectFixtureModBrandsFromSnapshot,
    isValidFixtureBrand,
    parseLooseBoolean,
    isLikelyPlaceholderConfigValue,
    isFixtureConfiguredForOutput,
    isFixtureEngineEnabled,
    isFixtureTwitchEnabled,
    isFixtureCustomEnabled
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    createFixturesUiInputAdapter
  };
}
