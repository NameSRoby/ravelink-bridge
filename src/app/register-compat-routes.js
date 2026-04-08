// [TITLE] Module: app/register-compat-routes.js
// [TITLE] Purpose: register compatibility HTTP routes required by current UI contracts
// [TITLE] Functionality Index:
// [TITLE] - MIDI and Mods route surface expected by domain endpoint adapters
// [TITLE] - LIVE/rave compatibility routes (overclock, trigger-matrix, palette snapshots)
// [TITLE] - fixtures/system probe and maintenance compatibility routes
// [DEV] Complex Flow:
// [DEV] These routes preserve deterministic payload contracts while implementation
// [DEV] internals are rebuilt. They intentionally avoid importing legacy rave-engine logic.

const registerAudioCompatRoutes = require("./routes/compat/audio.compat.routes");
const registerFixturesHardwareCompatRoutes = require("./routes/compat/fixtures-hardware.compat.routes");
const registerLiveRaveCompatRoutes = require("./routes/compat/live-rave.compat.routes");
const registerMidiCompatRoutes = require("./routes/compat/midi.compat.routes");
const registerModsCompatRoutes = require("./routes/compat/mods.compat.routes");
const registerSystemCompatRoutes = require("./routes/compat/system.compat.routes");
const registerTelemetryCompatRoutes = require("./routes/compat/telemetry.compat.routes");

function getRequestMap(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toCompatError(res, status, error, detail = "") {
  res.status(status).json({
    ok: false,
    error,
    detail: String(detail || "").trim()
  });
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number(fallback);
  return Math.min(Number(max), Math.max(Number(min), parsed));
}

function normalizeToken(value, max = 96) {
  return String(value || "").trim().slice(0, Math.max(1, Number(max) || 96));
}

module.exports = function registerCompatRoutes(app, deps = {}) {
  if (!app) throw new Error("registerCompatRoutes requires express app");

  const enforceWriteAccess = typeof deps.enforceWriteAccess === "function"
    ? deps.enforceWriteAccess
    : ((_req, _res, next) => next());
  const midiManager = deps.midiManager;
  const modRuntime = deps.modRuntime;
  const fixtureRegistry = deps.fixtureRegistry;
  const engineV2 = deps.engineV2;
  const enginePaletteService = deps.enginePaletteService;
  const liveCompatService = deps.liveCompatService;
  const audioRuntimeService = deps.audioRuntimeService;
  const systemConfigService = deps.systemConfigService;
  const internetGatewayRuntime = deps.internetGatewayRuntime;
  const systemUpdateService = deps.systemUpdateService;
  const systemOauthService = deps.systemOauthService;
  const startupReadinessService = deps.startupReadinessService;
  const startupLaunchDiagnosticsService = deps.startupLaunchDiagnosticsService;
  const audioEngine = deps.audioEngine;
  const hueBridge = deps.hueBridge;
  const wizBridge = deps.wizBridge;
  const requestSystemStop = typeof deps.requestSystemStop === "function"
    ? deps.requestSystemStop
    : null;
  registerTelemetryCompatRoutes(app, {
    audioEngine,
    engineV2,
    liveCompatService,
    hueBridge,
    wizBridge,
    getRequestMap,
    clampNumber
  });

  registerSystemCompatRoutes(app, {
    systemConfigService,
    audioRuntimeService,
    systemUpdateService,
    internetGatewayRuntime,
    systemOauthService,
    startupReadinessService,
    startupLaunchDiagnosticsService,
    requestSystemStop,
    modRuntime,
    fixtureRegistry,
    midiManager,
    audioEngine,
    engineV2,
    liveCompatService,
    hueBridge,
    wizBridge,
    enforceWriteAccess,
    getRequestMap,
    toCompatError,
    normalizeToken
  });

  registerAudioCompatRoutes(app, {
    audioRuntimeService,
    enforceWriteAccess,
    getRequestMap,
    toCompatError,
    normalizeToken
  });

  registerMidiCompatRoutes(app, {
    midiManager,
    enforceWriteAccess,
    getRequestMap,
    toCompatError
  });

  registerModsCompatRoutes(app, {
    modRuntime,
    enforceWriteAccess,
    getRequestMap,
    toCompatError
  });

  registerFixturesHardwareCompatRoutes(app, {
    fixtureRegistry,
    hueBridge,
    wizBridge,
    systemConfigService,
    enforceWriteAccess,
    getRequestMap,
    toCompatError,
    normalizeToken,
    clampNumber
  });

  registerLiveRaveCompatRoutes(app, {
    liveCompatService,
    modRuntime,
    engineV2,
    audioEngine,
    fixtureRegistry,
    enginePaletteService,
    enforceWriteAccess,
    getRequestMap,
    toCompatError,
    normalizeToken
  });

};
