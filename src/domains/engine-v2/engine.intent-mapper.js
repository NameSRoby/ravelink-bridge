// [TITLE] Module: domains/engine-v2/engine.intent-mapper.js
// [TITLE] Purpose: map Engine v2 scene/policy state to per-fixture intent packets
// [TITLE] Functionality Index:
// [TITLE] - resolve scope precedence (fixture > zone > brand > global > safe default)
// [TITLE] - normalize fixture intents for dispatch adapters
// [TITLE] - expose deterministic ownership metadata for diagnostics
// [DEV] Complex Flow:
// [DEV] Scope precedence is intentionally explicit and tested so future policy modules
// [DEV] cannot silently override fixture-specific assignments.

const { normalizeFixtureIntents, normalizeRgbColor, clampNumber } = require("./engine.contracts");

function normalizeRoutingConfig(raw = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    global: source.global && typeof source.global === "object" ? source.global : {},
    brands: source.brands && typeof source.brands === "object" ? source.brands : {},
    zones: source.zones && typeof source.zones === "object" ? source.zones : {},
    zonesByBrand: source.zonesByBrand && typeof source.zonesByBrand === "object" ? source.zonesByBrand : {},
    fixtures: source.fixtures && typeof source.fixtures === "object" ? source.fixtures : {}
  };
}

function normalizeLayerConfig(layer = {}, fallback = {}) {
  const source = layer && typeof layer === "object" && !Array.isArray(layer) ? layer : {};
  const safeFallback = fallback && typeof fallback === "object" && !Array.isArray(fallback) ? fallback : {};
  return {
    rgb: normalizeRgbColor(source.rgb, safeFallback.rgb || { r: 0, g: 0, b: 0 }),
    brightness: clampNumber(source.brightness, 0, 1, safeFallback.brightness ?? 0),
    transitionMs: clampNumber(source.transitionMs, 0, 60000, safeFallback.transitionMs ?? 250),
    owner: String(source.owner || safeFallback.owner || "engine_v2").trim() || "engine_v2"
  };
}

module.exports = function createEngineIntentMapper(options = {}) {
  const baseDefault = normalizeLayerConfig(
    options.defaultIntent || {},
    { rgb: { r: 0, g: 0, b: 0 }, brightness: 0, transitionMs: 250, owner: "engine_v2_safe_idle" }
  );

  function resolveZoneLayer(routing = {}, brand = "", zone = "") {
    const safeRouting = routing && typeof routing === "object" ? routing : {};
    const brandKey = String(brand || "").trim().toLowerCase();
    const zoneKey = String(zone || "").trim().toLowerCase();
    if (!zoneKey) return null;

    const zonesByBrand = safeRouting.zonesByBrand && typeof safeRouting.zonesByBrand === "object"
      ? safeRouting.zonesByBrand
      : {};
    const brandMap = zonesByBrand[brandKey] && typeof zonesByBrand[brandKey] === "object"
      ? zonesByBrand[brandKey]
      : null;
    if (brandMap && brandMap[zoneKey] && typeof brandMap[zoneKey] === "object") {
      return brandMap[zoneKey];
    }

    const zones = safeRouting.zones && typeof safeRouting.zones === "object"
      ? safeRouting.zones
      : {};
    const brandScopedZone = zones[`${brandKey}:${zoneKey}`] || zones[`${brandKey}/${zoneKey}`];
    if (brandScopedZone && typeof brandScopedZone === "object") {
      return brandScopedZone;
    }
    const genericZone = zones[zoneKey];
    if (genericZone && typeof genericZone === "object") {
      return genericZone;
    }
    return null;
  }

  function mapIntents(input = {}) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const fixtures = Array.isArray(source.fixtures) ? source.fixtures : [];
    const routing = normalizeRoutingConfig(source.routing);

    const globalLayer = normalizeLayerConfig(routing.global, baseDefault);
    const intents = [];
    for (const fixture of fixtures) {
      const fixtureId = String(fixture?.id || "").trim();
      const brand = String(fixture?.brand || "").trim().toLowerCase();
      const zone = String(fixture?.zone || "").trim().toLowerCase();
      if (!fixtureId || !brand) continue;
      if (fixture?.enabled === false) continue;

      const brandRaw = routing.brands[brand];
      const zoneRaw = resolveZoneLayer(routing, brand, zone || brand);
      const fixtureRaw = routing.fixtures[fixtureId];
      const brandLayer = normalizeLayerConfig(brandRaw, globalLayer);
      const zoneLayer = zoneRaw && typeof zoneRaw === "object"
        ? normalizeLayerConfig(zoneRaw, brandLayer)
        : brandLayer;
      const resolved = fixtureRaw && typeof fixtureRaw === "object"
        ? normalizeLayerConfig(fixtureRaw, zoneLayer)
        : zoneLayer;

      const scope = fixtureRaw && typeof fixtureRaw === "object"
        ? "fixture"
        : zoneRaw && typeof zoneRaw === "object"
          ? "zone"
        : brandRaw && typeof brandRaw === "object"
          ? "brand"
          : "global";
      intents.push({
        fixtureId,
        brand,
        rgb: resolved.rgb,
        brightness: resolved.brightness,
        transitionMs: resolved.transitionMs,
        owner: resolved.owner,
        scope
      });
    }

    return normalizeFixtureIntents(intents);
  }

  return {
    mapIntents
  };
};
