// [TITLE] Module: app/routes/compat/system.compat.core-status.js
// [TITLE] Purpose: summarize readiness/core-status payloads for system compat routes
// [TITLE] Functionality Index:
// [TITLE] - service capability checks for system core-status
// [TITLE] - lane readiness summarization for startup readiness snapshots
// [TITLE] - final core-status token derivation for UI compatibility payloads
// [DEV] Complex Flow:
// [DEV] These summaries belong to the system compat surface because they shape the
// [DEV] `/system/core-status` payload rather than a general-purpose app contract.

function hasFn(target, name) {
  return Boolean(target && typeof target[name] === "function");
}

function summarizeCoreServiceChecks(input = {}) {
  const checks = {
    systemConfigService: hasFn(input.systemConfigService, "getConfig") && hasFn(input.systemConfigService, "patchConfig"),
    internetGatewayService: hasFn(input.internetGatewayRuntime, "getStatus") && hasFn(input.internetGatewayRuntime, "request"),
    systemUpdateService:
      hasFn(input.systemUpdateService, "getStatus") &&
      hasFn(input.systemUpdateService, "checkForUpdates") &&
      hasFn(input.systemUpdateService, "applyLatestUpdate"),
    systemOauthService: hasFn(input.systemOauthService, "getStatus") && hasFn(input.systemOauthService, "startDeviceFlow"),
    startupReadinessService: hasFn(input.startupReadinessService, "getSnapshot"),
    fixtureRegistry: hasFn(input.fixtureRegistry, "getFixtures"),
    modRuntime: hasFn(input.modRuntime, "list"),
    midiManager: hasFn(input.midiManager, "getStatus"),
    audioEngine: hasFn(input.audioEngine, "getStatus") && hasFn(input.audioEngine, "getRaveState"),
    engineV2: hasFn(input.engineV2, "getStatus") && hasFn(input.engineV2, "getTelemetryProjection"),
    liveCompatService: hasFn(input.liveCompatService, "getCompatibility"),
    hueBridgeAdapter: hasFn(input.hueBridge, "discoverBridges") || hasFn(input.hueBridge, "pairBridge"),
    wizBridgeAdapter: hasFn(input.wizBridge, "discoverDevices"),
    launcherDiagnosticsService: hasFn(input.startupLaunchDiagnosticsService, "getSnapshot")
  };
  const requiredKeys = [
    "systemConfigService",
    "startupReadinessService",
    "fixtureRegistry",
    "modRuntime",
    "midiManager",
    "audioEngine",
    "liveCompatService"
  ];
  const optionalKeys = Object.keys(checks).filter(key => !requiredKeys.includes(key));
  const requiredReady = requiredKeys.filter(key => checks[key] === true).length;
  const optionalReady = optionalKeys.filter(key => checks[key] === true).length;
  const missingRequired = requiredKeys.filter(key => checks[key] !== true);
  return {
    checks,
    requiredTotal: requiredKeys.length,
    requiredReady,
    optionalTotal: optionalKeys.length,
    optionalReady,
    missingRequired
  };
}

const CORE_REQUIRED_LANES = Object.freeze(["config", "profiles", "mods"]);
const CORE_OPTIONAL_LANES = Object.freeze(["midi", "hue", "wiz"]);

function normalizeLaneStateToken(value) {
  const token = String(value || "").trim().toLowerCase();
  if (token === "loaded") return "loaded";
  if (token === "partial") return "partial";
  if (token === "pending") return "pending";
  if (token === "failed") return "failed";
  return "missing";
}

function getRequestMap(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function getLaneState(states, key) {
  return normalizeLaneStateToken(getRequestMap(states)[key]);
}

function summarizeLaneCoreReadiness(snapshot = {}) {
  const currentSummary = getRequestMap(snapshot?.current?.summary);
  const laneCount = Math.max(0, Number(currentSummary.laneCount || 0));
  const readyCount = Math.max(0, Number(currentSummary.readyCount || 0));
  const blocking = Array.isArray(currentSummary.blocking)
    ? currentSummary.blocking.map(item => String(item || "").trim().toLowerCase()).filter(Boolean)
    : [];
  const states = getRequestMap(currentSummary.states);
  const requiredBlocking = CORE_REQUIRED_LANES.filter(key => getLaneState(states, key) !== "loaded");
  const requiredReadyCount = CORE_REQUIRED_LANES.length - requiredBlocking.length;
  const optionalBlocking = CORE_OPTIONAL_LANES.filter(key => {
    const state = getLaneState(states, key);
    return state === "partial" || state === "pending" || state === "failed";
  });
  const optionalReadyCount = CORE_OPTIONAL_LANES.length - optionalBlocking.length;
  return {
    laneCount,
    readyCount,
    blocking,
    states,
    allReady: laneCount > 0 && readyCount >= laneCount,
    requiredLaneCount: CORE_REQUIRED_LANES.length,
    requiredReadyCount,
    requiredBlocking,
    optionalLaneCount: CORE_OPTIONAL_LANES.length,
    optionalReadyCount,
    optionalBlocking,
    coreLaneReady: requiredBlocking.length === 0
  };
}

function computeCoreStatus(laneSummary = {}, serviceSummary = {}) {
  if (Number(serviceSummary.requiredReady || 0) < Number(serviceSummary.requiredTotal || 0)) {
    return "failed";
  }
  return laneSummary.coreLaneReady === true ? "ok" : "partial";
}

module.exports = {
  summarizeCoreServiceChecks,
  summarizeLaneCoreReadiness,
  computeCoreStatus
};
