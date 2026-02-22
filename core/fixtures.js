// [TITLE] Module: core/fixtures.js
// [TITLE] Purpose: fixtures
// [TITLE] Functionality Index:
// [TITLE] - Core Constants + Allowed Routes
// [TITLE] - Fixture Normalization + Validation
// [TITLE] - Transport Readiness Guards (Hue/WiZ)
// [TITLE] - Config Load/Persist + Backup Rotation
// [TITLE] - Registry Query APIs
// [TITLE] - Mutation APIs (upsert/remove/route)
// [TITLE] - Module Exports

/**
 * Fixture registry loader with live config reload.
 *
 * Primary editing surface is JSON:
 *   core/fixtures.config.json
 */
const fs = require("fs");
const net = require("net");
const path = require("path");
const { normalizePrivateOrLoopbackIpv4 } = require("./utils/private-ipv4");
const { parseBooleanLoose } = require("./utils/booleans");

// [TITLE] Section: Core Constants + Route Bindings
const CONFIG_PATH = path.join(__dirname, "fixtures.config.json");
const BACKUP_DIR = path.join(__dirname, "backups", "fixtures");
const MAX_BACKUPS = 40;
const ALLOWED_INTENTS = new Set([
  "HUE_STATE",
  "WIZ_PULSE",
  "TWITCH_HUE",
  "TWITCH_WIZ"
]);
const BUILTIN_BRANDS = new Set(["hue", "wiz"]);
const ALLOWED_CONTROL_MODES = new Set(["engine", "standalone"]);
const MOD_BRAND_RE = /^[a-z][a-z0-9_-]{1,31}$/;
const INTENT_ROUTE_BINDINGS = {
  HUE_STATE: { brand: "hue", mode: "engine" },
  WIZ_PULSE: { brand: "wiz", mode: "engine" },
  TWITCH_HUE: { brand: "hue", mode: "twitch" },
  TWITCH_WIZ: { brand: "wiz", mode: "twitch" }
};
const INTENT_ROUTE_ENV_OVERRIDES = {
  HUE_STATE: "ROUTE_HUE_STATE_ZONE",
  WIZ_PULSE: "ROUTE_WIZ_PULSE_ZONE",
  TWITCH_HUE: "ROUTE_TWITCH_HUE_ZONE",
  TWITCH_WIZ: "ROUTE_TWITCH_WIZ_ZONE"
};
const FIXTURE_CORE_FIELDS = new Set([
  "id",
  "brand",
  "zone",
  "enabled",
  "controlMode",
  "engineBinding",
  "engineEnabled",
  "twitchEnabled",
  "customEnabled",
  "bridgeIp",
  "username",
  "bridgeId",
  "clientKey",
  "entertainmentAreaId",
  "lightId",
  "ip"
]);
const CANONICAL_ZONE_BY_BRAND = Object.freeze({
  hue: "hue",
  wiz: "wiz"
});
const DERIVED_ZONE_BY_BRAND_MODE = Object.freeze({
  hue: Object.freeze({ engine: "hue", twitch: "hue", custom: "hue" }),
  wiz: Object.freeze({ engine: "wiz", twitch: "wiz", custom: "custom" })
});

// [TITLE] Section: Utility Helpers
function cloneJsonSafe(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function normalizeBrand(value) {
  return String(value || "").trim().toLowerCase();
}

function isBuiltinBrand(brand) {
  return BUILTIN_BRANDS.has(normalizeBrand(brand));
}

function isValidBrand(brand) {
  const normalized = normalizeBrand(brand);
  return isBuiltinBrand(normalized) || MOD_BRAND_RE.test(normalized);
}

function extractFixtureExtras(source = {}) {
  const extras = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (FIXTURE_CORE_FIELDS.has(key)) continue;
    const cloned = cloneJsonSafe(value, undefined);
    if (cloned === undefined) continue;
    extras[key] = cloned;
  }
  return extras;
}

function normalizeBoolean(value, fallback = false) {
  return parseBooleanLoose(value, fallback);
}

// [TITLE] Section: Default Config Seed
const DEFAULT_CONFIG = {
  intentRoutes: {
    HUE_STATE: "all",
    WIZ_PULSE: "all",
    TWITCH_HUE: "all",
    TWITCH_WIZ: "all"
  },
  fixtures: [
    {
      id: "hue-main-1",
      brand: "hue",
      zone: "hue",
      enabled: true,
      engineEnabled: true,
      twitchEnabled: true,
      customEnabled: false,
      bridgeIp: "192.168.x.x",
      username: "replace_with_hue_username",
      bridgeId: "replace_with_bridge_id",
      clientKey: "replace_with_client_key",
      lightId: 1
    },
    {
      id: "wiz-background-1",
      brand: "wiz",
      zone: "wiz",
      enabled: true,
      engineEnabled: true,
      twitchEnabled: true,
      customEnabled: false,
      ip: "192.168.x.x"
    },
    {
      id: "wiz-custom-1",
      brand: "wiz",
      zone: "custom",
      enabled: true,
      engineEnabled: false,
      twitchEnabled: true,
      customEnabled: true,
      ip: "192.168.x.x"
    }
  ]
};

const registry = {
  fixtures: [],
  intentRoutes: { ...DEFAULT_CONFIG.intentRoutes },
  version: 0,
  loadedAt: 0
};

// [TITLE] Section: Config File Load + Read
function loadConfigFile() {
  const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  return {
    intentRoutes: parsed.intentRoutes || {},
    fixtures: Array.isArray(parsed.fixtures) ? parsed.fixtures : []
  };
}

function getConfig() {
  try {
    return loadConfigFile();
  } catch {
    return {
      intentRoutes: { ...DEFAULT_CONFIG.intentRoutes },
      fixtures: DEFAULT_CONFIG.fixtures.map(f => ({ ...f }))
    };
  }
}

// [TITLE] Section: Mode/Zone Normalization
function normalizeControlMode(value) {
  const mode = String(value || "engine").trim().toLowerCase();
  return ALLOWED_CONTROL_MODES.has(mode) ? mode : "engine";
}

function normalizeZone(value, fallback = "custom") {
  const zone = String(value || "").trim().toLowerCase();
  return zone || fallback;
}

function getCanonicalZoneForBrand(brand, fallback = "custom") {
  const key = normalizeBrand(brand);
  const canonical = CANONICAL_ZONE_BY_BRAND[key];
  return canonical || normalizeZone(fallback, "custom");
}

// [TITLE] Section: Host + Placeholder Validation
const PLACEHOLDER_MARKERS = [
  "replace_with",
  "your_",
  "example",
  "192.168.x.x",
  "x.x.x.x",
  "<",
  ">"
];

const HOSTNAME_RE = /^(?=.{1,253}$)(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)*$/i;

function isLikelyPlaceholderValue(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return false;
  if (PLACEHOLDER_MARKERS.some(marker => raw.includes(marker))) return true;
  if (/^\d{1,3}\.\d{1,3}\.x\.x$/i.test(raw)) return true;
  if (/^x\.x\.x\.x$/i.test(raw)) return true;
  return false;
}

function isLikelyNetworkHost(value) {
  const host = String(value || "").trim();
  if (!host) return false;
  if (isLikelyPlaceholderValue(host)) return false;
  if (net.isIP(host) > 0) return true;

  const bracketedWithPort = host.match(/^\[([^\]]+)\]:(\d{1,5})$/);
  if (bracketedWithPort) {
    const ip = String(bracketedWithPort[1] || "").trim();
    const port = Number(bracketedWithPort[2] || 0);
    return net.isIP(ip) > 0 && Number.isInteger(port) && port >= 1 && port <= 65535;
  }

  const bracketed = host.match(/^\[([^\]]+)\]$/);
  if (bracketed && net.isIP(bracketed[1]) > 0) return true;

  const hostWithPort = host.match(/^([^:]+):(\d{1,5})$/);
  if (hostWithPort) {
    const hostPart = String(hostWithPort[1] || "").trim();
    const port = Number(hostWithPort[2] || 0);
    const hostOk = net.isIP(hostPart) > 0 || HOSTNAME_RE.test(hostPart);
    return hostOk && Number.isInteger(port) && port >= 1 && port <= 65535;
  }

  if (host.includes(":")) return false;
  return HOSTNAME_RE.test(host);
}

// [TITLE] Section: Private LAN IP Guards
function normalizePrivateLanIpv4(value) {
  return normalizePrivateOrLoopbackIpv4(value);
}

// [TITLE] Section: Transport Readiness (Hue/WiZ)
function isHueFixtureConfigured(fixture = {}) {
  const bridgeIp = String(fixture.bridgeIp || "").trim();
  const username = String(fixture.username || "").trim();
  const lightId = Number(fixture.lightId || 0);
  return (
    Boolean(normalizePrivateLanIpv4(bridgeIp)) &&
    Boolean(username) &&
    !isLikelyPlaceholderValue(username) &&
    Number.isFinite(lightId) &&
    lightId > 0
  );
}

function isHueEntertainmentConfigured(fixture = {}) {
  const bridgeId = String(fixture.bridgeId || "").trim();
  const clientKey = String(fixture.clientKey || "").trim();
  return (
    isHueFixtureConfigured(fixture) &&
    Boolean(bridgeId) &&
    Boolean(clientKey) &&
    !isLikelyPlaceholderValue(bridgeId) &&
    !isLikelyPlaceholderValue(clientKey)
  );
}

function isWizFixtureConfigured(fixture = {}) {
  const ip = String(fixture.ip || "").trim();
  return Boolean(normalizePrivateLanIpv4(ip));
}

const TRANSPORT_CONFIG_BY_BRAND = Object.freeze({
  hue: isHueFixtureConfigured,
  wiz: isWizFixtureConfigured
});

function isFixtureConfiguredForTransport(fixture = {}) {
  const brand = normalizeBrand(fixture.brand);
  const check = TRANSPORT_CONFIG_BY_BRAND[brand];
  if (check) return check(fixture);
  return isValidBrand(brand);
}

// [TITLE] Section: Fixture Coupling + Derived Binding
function normalizeFixtureModeFlags(input = {}) {
  const engineEnabled = normalizeBoolean(input.engineEnabled, true);
  const twitchEnabled = normalizeBoolean(input.twitchEnabled, true);
  let customEnabled = normalizeBoolean(input.customEnabled, false);

  // Standalone custom control and live engine mode are mutually exclusive.
  if (engineEnabled && customEnabled) {
    customEnabled = false;
  }

  if (engineEnabled || twitchEnabled || customEnabled) {
    return { engineEnabled, twitchEnabled, customEnabled };
  }

  // Avoid creating an unreachable fixture with no active routing modes.
  return { engineEnabled: false, twitchEnabled: false, customEnabled: true };
}

function normalizeRequestedEngineBinding(value) {
  const raw = normalizeBrand(value);
  if (!raw) return "";
  if (raw === "none") return "standalone";
  return raw;
}

function deriveEngineBinding({ brand, engineEnabled, requestedBinding }) {
  void requestedBinding;
  return engineEnabled ? brand : "standalone";
}

function validateFixtureCoupling({
  brand,
  engineEnabled,
  twitchEnabled,
  customEnabled,
  requestedBinding
}) {
  if (!isValidBrand(brand)) {
    return "invalid fixture brand";
  }

  if (requestedBinding && requestedBinding !== "standalone" && requestedBinding !== brand) {
    return "invalid engine binding";
  }

  if (!engineEnabled && !twitchEnabled && !customEnabled) {
    return "at least one mode must be enabled (engine/twitch/custom)";
  }

  if (engineEnabled && customEnabled) {
    return "custom mode cannot be enabled while engine mode is enabled";
  }

  if (engineEnabled && requestedBinding && requestedBinding !== brand) {
    return `${brand.toUpperCase()} fixtures cannot bind to ${requestedBinding.toUpperCase()} engine path`;
  }

  return null;
}

function isEngineCoupledFixture(fixture = {}) {
  const brand = normalizeBrand(fixture.brand);
  const modeFlags = normalizeFixtureModeFlags(fixture);
  const binding = String(
    fixture.engineBinding || (modeFlags.engineEnabled ? brand : "standalone")
  ).trim().toLowerCase();

  return (
    modeFlags.engineEnabled &&
    binding === brand &&
    isValidBrand(brand)
  );
}

// [TITLE] Section: Fixture Normalization Pipeline
function normalizeFixture(fixture, index) {
  const brand = normalizeBrand(fixture?.brand);
  if (!fixture || !isValidBrand(brand)) {
    return null;
  }

  const modeFlags = normalizeFixtureModeFlags(fixture);
  const controlMode = modeFlags.engineEnabled ? "engine" : "standalone";
  const requestedBinding = normalizeRequestedEngineBinding(fixture.engineBinding);
  const engineBinding = deriveEngineBinding({
    brand,
    engineEnabled: modeFlags.engineEnabled,
    requestedBinding
  });

  const base = {
    id: fixture.id || `${brand}-${index + 1}`,
    brand,
    zone: normalizeZone(fixture.zone, getCanonicalZoneForBrand(brand, "custom")),
    enabled: fixture.enabled !== false,
    controlMode,
    engineBinding,
    engineEnabled: modeFlags.engineEnabled,
    twitchEnabled: modeFlags.twitchEnabled,
    customEnabled: modeFlags.customEnabled
  };

  if (brand === "hue") {
    const normalizedBridgeIp = normalizePrivateLanIpv4(fixture.bridgeIp || process.env.HUE_BRIDGE_IP || "");
    return {
      ...base,
      bridgeIp: normalizedBridgeIp,
      username: fixture.username || process.env.HUE_USERNAME || "",
      lightId: Number(fixture.lightId || process.env.HUE_LIGHT_ID || 1),
      // Optional Hue Entertainment fields (per bridge / area).
      bridgeId: fixture.bridgeId || process.env.HUE_BRIDGE_ID || "",
      clientKey: fixture.clientKey || process.env.HUE_CLIENT_KEY || "",
      entertainmentAreaId:
        fixture.entertainmentAreaId || process.env.HUE_ENTERTAINMENT_AREA_ID || ""
    };
  }

  if (brand === "wiz") {
    const normalizedWizIp = normalizePrivateLanIpv4(fixture.ip || process.env.WIZ_BACKGROUND_IP || "");
    return {
      ...base,
      ip: normalizedWizIp
    };
  }

  return {
    ...base,
    ...extractFixtureExtras(fixture)
  };
}

// [TITLE] Section: Derived Intent Route Resolution
function getDerivedIntentZones(fixtures, binding) {
  const targetBrand = String(binding?.brand || "").trim().toLowerCase();
  const mode = String(binding?.mode || "engine").trim().toLowerCase();
  if (!targetBrand) return [];

  const zones = [];
  for (const fixture of fixtures || []) {
    if (!fixture || fixture.enabled === false) continue;
    if (normalizeBrand(fixture.brand) !== targetBrand) continue;

    const modeFlags = normalizeFixtureModeFlags(fixture);
    const modeEnabled = mode === "twitch"
      ? modeFlags.twitchEnabled
      : mode === "custom"
        ? modeFlags.customEnabled
        : modeFlags.engineEnabled;
    if (!modeEnabled) continue;
    const brand = normalizeBrand(fixture.brand);
    const brandModeMap = DERIVED_ZONE_BY_BRAND_MODE[brand];
    if (brandModeMap) {
      zones.push(brandModeMap[mode] || brandModeMap.engine);
      continue;
    }
    zones.push(normalizeZone(fixture.zone, getCanonicalZoneForBrand(brand, "custom")));
  }

  return [...new Set(zones)];
}

function mergeIntentRoutes(fixtures) {
  const routes = { ...DEFAULT_CONFIG.intentRoutes };

  for (const intent of Object.keys(INTENT_ROUTE_BINDINGS)) {
    const envKey = INTENT_ROUTE_ENV_OVERRIDES[intent];
    const envValue = envKey ? String(process.env[envKey] || "").trim() : "";
    if (envValue) {
      routes[intent] = envValue;
      continue;
    }

    const zones = getDerivedIntentZones(fixtures, INTENT_ROUTE_BINDINGS[intent]);
    routes[intent] = zones.length ? zones.join(",") : "none";
  }

  return routes;
}

function applyConfig(raw) {
  registry.fixtures = (raw.fixtures || []).map(normalizeFixture).filter(Boolean);
  registry.intentRoutes = mergeIntentRoutes(registry.fixtures);
  registry.version += 1;
  registry.loadedAt = Date.now();
}

// [TITLE] Section: Persist + Backups
function pruneBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return;
  const backups = fs
    .readdirSync(BACKUP_DIR, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(".json"))
    .map(entry => {
      const filePath = path.join(BACKUP_DIR, entry.name);
      const stat = fs.statSync(filePath);
      return { filePath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (let i = MAX_BACKUPS; i < backups.length; i += 1) {
    try {
      fs.unlinkSync(backups[i].filePath);
    } catch {}
  }
}

function backupCurrentConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupPath = path.join(BACKUP_DIR, `fixtures.config.${Date.now()}.json`);
  fs.copyFileSync(CONFIG_PATH, backupPath);
  pruneBackups();
  return backupPath;
}

function persistConfig(raw) {
  const runtimeFixtures = (Array.isArray(raw.fixtures) ? raw.fixtures : [])
    .map(normalizeFixture)
    .filter(Boolean);

  const payload = {
    intentRoutes: mergeIntentRoutes(runtimeFixtures),
    fixtures: Array.isArray(raw.fixtures) ? raw.fixtures : []
  };
  backupCurrentConfig();
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  applyConfig(payload);
}

// [TITLE] Section: Runtime Init + File Watch Reload
function reload() {
  try {
    const rawConfig = loadConfigFile();
    applyConfig(rawConfig);
    return true;
  } catch (err) {
    console.warn(`[FIXTURES] reload failed (${err.message}); keeping previous config`);
    return false;
  }
}

function init() {
  try {
    applyConfig(loadConfigFile());
    console.log(`[FIXTURES] loaded from ${path.basename(CONFIG_PATH)} (v${registry.version})`);
  } catch (err) {
    console.warn(`[FIXTURES] using defaults (${err.message})`);
    applyConfig(DEFAULT_CONFIG);
  }

  fs.watchFile(CONFIG_PATH, { interval: 600 }, (curr, prev) => {
    if (curr.mtimeMs === prev.mtimeMs) return;
    reload();
  });
}

// [TITLE] Section: Registry Query APIs
function getFixtures() {
  return registry.fixtures.slice();
}

function getIntentRoutes() {
  return { ...registry.intentRoutes };
}

function getVersion() {
  return registry.version;
}

function listBy(brand, zone, options = {}) {
  return listFixturesWithMode(brand, zone, options, fixture => fixture.enabled !== false);
}

function listEngineBy(brand, zone, options = {}) {
  return listFixturesWithMode(brand, zone, options, fixture => isEngineCoupledFixture(fixture));
}

function listTwitchBy(brand, zone, options = {}) {
  return listFixturesWithMode(
    brand,
    zone,
    options,
    fixture => normalizeBoolean(fixture.twitchEnabled, false)
  );
}

function listCustomBy(brand, zone, options = {}) {
  return listFixturesWithMode(
    brand,
    zone,
    options,
    fixture => normalizeBoolean(fixture.customEnabled, false)
  );
}

function listFixturesWithMode(brand, zone, options = {}, modePredicate = null) {
  const requireConfigured = Boolean(options.requireConfigured);
  const filters = [
    fixture => Boolean(fixture && fixture.enabled)
  ];
  if (brand) filters.push(fixture => fixture.brand === brand);
  if (zone) filters.push(fixture => fixture.zone === zone);
  if (requireConfigured) filters.push(isFixtureConfiguredForTransport);
  if (typeof modePredicate === "function") filters.push(modePredicate);

  return registry.fixtures.filter(fixture => filters.every(filter => filter(fixture)));
}

// [TITLE] Section: Summary + Mutation APIs
function resolveZone(intent) {
  if (!intent) return null;

  if (typeof intent === "string") {
    return registry.intentRoutes[intent] || null;
  }

  return intent.zone || registry.intentRoutes[intent.type] || null;
}

function summary() {
  const hueCount = listBy("hue").length;
  const wizCount = listBy("wiz").length;
  const hueEngineCount = listEngineBy("hue").length;
  const wizEngineCount = listEngineBy("wiz").length;
  const hueTwitchCount = listTwitchBy("hue").length;
  const wizTwitchCount = listTwitchBy("wiz").length;
  const hueCustomCount = listCustomBy("hue").length;
  const wizCustomCount = listCustomBy("wiz").length;
  const hueReadyCount = listBy("hue", "", { requireConfigured: true }).length;
  const wizReadyCount = listBy("wiz", "", { requireConfigured: true }).length;
  const hueEngineReadyCount = listEngineBy("hue", "", { requireConfigured: true }).length;
  const wizEngineReadyCount = listEngineBy("wiz", "", { requireConfigured: true }).length;
  const hueTwitchReadyCount = listTwitchBy("hue", "", { requireConfigured: true }).length;
  const wizTwitchReadyCount = listTwitchBy("wiz", "", { requireConfigured: true }).length;
  const hueEntertainmentReadyCount = listBy("hue", "").filter(isHueEntertainmentConfigured).length;
  const modBrandSet = new Set(
    registry.fixtures
      .map(f => normalizeBrand(f.brand))
      .filter(brand => brand && !isBuiltinBrand(brand))
  );
  return {
    version: registry.version,
    loadedAt: registry.loadedAt,
    routes: getIntentRoutes(),
    hue: hueCount,
    wiz: wizCount,
    hueEngine: hueEngineCount,
    wizEngine: wizEngineCount,
    hueTwitch: hueTwitchCount,
    wizTwitch: wizTwitchCount,
    hueCustom: hueCustomCount,
    wizCustom: wizCustomCount,
    hueReady: hueReadyCount,
    wizReady: wizReadyCount,
    hueEngineReady: hueEngineReadyCount,
    wizEngineReady: wizEngineReadyCount,
    hueTwitchReady: hueTwitchReadyCount,
    wizTwitchReady: wizTwitchReadyCount,
    hueEntertainmentReady: hueEntertainmentReadyCount,
    hueStandalone: hueCustomCount,
    wizStandalone: wizCustomCount,
    modBrandCount: modBrandSet.size,
    modBrands: [...modBrandSet].sort()
  };
}

function sanitizeFixtureForConfig(input = {}, fallbackIndex = 0, options = {}) {
  const strict = Boolean(options.strict);
  const brand = normalizeBrand(input.brand);
  if (!isValidBrand(brand)) {
    return { ok: false, error: "invalid fixture brand (use hue, wiz, or a lowercase mod-brand id)" };
  }

  const id = String(input.id || `${brand}-${Date.now()}-${fallbackIndex}`).trim();
  const zone = normalizeZone(input.zone, getCanonicalZoneForBrand(brand, "custom"));
  const enabled = input.enabled !== false;
  const modeFlags = normalizeFixtureModeFlags(input);
  const controlMode = modeFlags.engineEnabled ? "engine" : "standalone";
  const requestedBinding = normalizeRequestedEngineBinding(input.engineBinding);
  const couplingError = validateFixtureCoupling({
    brand,
    zone,
    engineEnabled: modeFlags.engineEnabled,
    twitchEnabled: modeFlags.twitchEnabled,
    customEnabled: modeFlags.customEnabled,
    requestedBinding
  });
  if (strict && couplingError) {
    return { ok: false, error: couplingError };
  }
  const engineBinding = deriveEngineBinding({
    brand,
    engineEnabled: modeFlags.engineEnabled,
    requestedBinding
  });
  const engineEnabled = modeFlags.engineEnabled;
  const twitchEnabled = modeFlags.twitchEnabled;
  const customEnabled = modeFlags.customEnabled;

  if (brand === "hue") {
    const bridgeIpRaw = String(input.bridgeIp || "").trim();
    const bridgeIp = normalizePrivateLanIpv4(bridgeIpRaw);
    const username = String(input.username || "").trim();
    const bridgeId = String(input.bridgeId || "").trim();
    const clientKey = String(input.clientKey || "").trim();
    const entertainmentAreaId = String(input.entertainmentAreaId || "").trim();
    const lightId = Math.max(1, Number(input.lightId || 1) || 1);

    const hasConfiguredBridgeTransport =
      Boolean(bridgeIp) &&
      Boolean(username) &&
      !isLikelyPlaceholderValue(username);
    const hasEntertainmentCredentials =
      Boolean(bridgeId) &&
      Boolean(clientKey) &&
      !isLikelyPlaceholderValue(bridgeId) &&
      !isLikelyPlaceholderValue(clientKey);

    if (strict && bridgeIpRaw && !bridgeIp) {
      return {
        ok: false,
        error: "hue bridgeIp must be a private/local IPv4 address"
      };
    }

    if (strict && (hasConfiguredBridgeTransport || hasEntertainmentCredentials)) {
      if (!bridgeIp) {
        return {
          ok: false,
          error: "hue bridgeIp must be a private/local IPv4 address"
        };
      }
      if (!entertainmentAreaId || isLikelyPlaceholderValue(entertainmentAreaId)) {
        return {
          ok: false,
          error: "hue entertainment area is required when Hue bridge credentials are configured"
        };
      }
    }

    return {
      ok: true,
      fixture: {
        id,
        brand,
        zone,
        enabled,
        controlMode,
        engineBinding,
        engineEnabled,
        twitchEnabled,
        customEnabled,
        bridgeIp,
        username,
        bridgeId,
        clientKey,
        entertainmentAreaId,
        lightId
      }
    };
  }

  if (brand === "wiz") {
    const wizIpRaw = String(input.ip || "").trim();
    const wizIp = normalizePrivateLanIpv4(wizIpRaw);
    if (strict && wizIpRaw && !wizIp) {
      return {
        ok: false,
        error: "wiz ip must be a private/local IPv4 address"
      };
    }
    return {
      ok: true,
      fixture: {
        id,
        brand,
        zone,
        enabled,
        controlMode,
        engineBinding,
        engineEnabled,
        twitchEnabled,
        customEnabled,
        ip: wizIp
      }
    };
  }

  return {
    ok: true,
    fixture: {
      id,
      brand,
      zone,
      enabled,
      controlMode,
      engineBinding,
      engineEnabled,
      twitchEnabled,
      customEnabled,
      ...extractFixtureExtras(input)
    }
  };
}

function upsertFixture(fixtureInput, options = {}) {
  const raw = getConfig();
  const replaceId = String(options?.replaceId || options?.originalId || "").trim();
  const normalized = sanitizeFixtureForConfig(
    fixtureInput,
    raw.fixtures.length + 1,
    { strict: true }
  );
  if (!normalized.ok) return { ok: false, error: normalized.error || "invalid fixture payload" };
  const next = normalized.fixture;

  const nextId = String(next.id || "").trim();
  const replaceIdx = replaceId
    ? raw.fixtures.findIndex(f => String(f.id) === replaceId)
    : -1;

  const hasIdConflict = Boolean(
    replaceId &&
    replaceId !== nextId &&
    raw.fixtures.some((fixture, index) => String(fixture.id) === nextId && index !== replaceIdx)
  );
  if (hasIdConflict) {
    return { ok: false, error: `fixture id already exists: ${nextId}` };
  }

  if (replaceIdx >= 0 && replaceId !== nextId) {
    raw.fixtures.splice(replaceIdx, 1);
  }

  const idx = raw.fixtures.findIndex(f => String(f.id) === nextId);
  if (idx >= 0) {
    raw.fixtures[idx] = {
      ...raw.fixtures[idx],
      ...next
    };
  } else {
    raw.fixtures.push(next);
  }

  persistConfig(raw);
  return { ok: true, fixture: next };
}

function removeFixture(id) {
  const fixtureId = String(id || "").trim();
  if (!fixtureId) return { ok: false, error: "missing id" };

  const raw = getConfig();
  const before = raw.fixtures.length;
  raw.fixtures = raw.fixtures.filter(f => String(f.id) !== fixtureId);
  if (raw.fixtures.length === before) {
    return { ok: false, error: "fixture not found" };
  }

  persistConfig(raw);
  return { ok: true };
}

function setIntentRoute(intent, zone) {
  const key = String(intent || "").trim();
  void zone;

  if (!ALLOWED_INTENTS.has(key)) {
    return { ok: false, error: "unsupported intent route" };
  }

  return {
    ok: true,
    intent: key,
    zone: String(registry.intentRoutes[key] || "none"),
    derived: true
  };
}

// [TITLE] Section: Module Exports
init();

module.exports = {
  getFixtures,
  getConfig,
  getIntentRoutes,
  getVersion,
  listBy,
  listEngineBy,
  listTwitchBy,
  listCustomBy,
  isLikelyPlaceholderValue,
  isLikelyNetworkHost,
  isHueFixtureConfigured,
  isHueEntertainmentConfigured,
  isWizFixtureConfigured,
  isFixtureConfiguredForTransport,
  isEngineCoupledFixture,
  resolveZone,
  setIntentRoute,
  upsertFixture,
  removeFixture,
  reload,
  summary
};
