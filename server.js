// [TITLE] Module: server.js
// [TITLE] Purpose: server

/**
 * ======================================================
 * HUE + WIZ BRIDGE — STABLE / BEAT-LOCKED / SCHEDULED
 * ======================================================
 * - Hue updates ONLY on beats
 * - Hue strictly rate + delta guarded
 * - WiZ remains fire-and-forget
 */
// [TITLE] Functionality Index:
// [TITLE] - Process Safety Hooks (fatal exception guards)
// [TITLE] - Core Runtime Wiring (engine/audio/midi/mods)
// [TITLE] - Fixture Routing + Connectivity
// [TITLE] - Hue Transport + Entertainment Recovery
// [TITLE] - WiZ Scheduling + Dispatch
// [TITLE] - Audio Reactivity Map (per-brand source routing)
// [TITLE] - Standalone/Custom Fixture Runtime
// [TITLE] - Twitch/Color Command Routing
// [TITLE] - REST API Endpoints

const {
  redactSensitiveLogValue: redactSensitiveText,
  sanitizeLogValue: sanitizeSensitiveLogValue
} = require("./core/utils/log-redaction");
const {
  parseIpv4Parts: parsePrivateIpv4Parts,
  isPrivateOrLoopbackIpv4,
  normalizePrivateOrLoopbackIpv4
} = require("./core/utils/private-ipv4");
const {
  parseBooleanToken: parseBooleanTokenShared,
  parseBooleanLoose: parseBooleanLooseShared
} = require("./core/utils/booleans");
const { hsvToRgb255: convertHsvToRgb255 } = require("./core/utils/hsv-rgb");
const { createServerColorUtils } = require("./core/server/color-utils");
const { createRequestPatchUtils } = require("./core/server/request-patch-utils");
const { rateLimit: expressRateLimit } = require("express-rate-limit");
const {
  PALETTE_COLOR_COUNT_OPTIONS: SHARED_PALETTE_COLOR_COUNT_OPTIONS,
  PALETTE_FAMILY_ORDER: SHARED_PALETTE_FAMILY_ORDER,
  PALETTE_FAMILY_ALIASES: SHARED_PALETTE_FAMILY_ALIASES,
  PALETTE_FAMILY_DEFS: SHARED_PALETTE_FAMILY_DEFS,
  PALETTE_PRESETS: SHARED_PALETTE_PRESETS,
  resolvePaletteFamilyIndexSpan: resolveSharedPaletteFamilyIndexSpan
} = require("./core/palette/family-spec");
let unsafeExposeSensitiveLogsRuntime = String(process.env.RAVELINK_UNSAFE_LOG_SECRETS || "").trim() === "1";

function setUnsafeExposeSensitiveLogsRuntime(enabled) {
  const next = enabled === true;
  const changed = next !== unsafeExposeSensitiveLogsRuntime;
  unsafeExposeSensitiveLogsRuntime = next;
  if (changed && next) {
    console.warn("[SECURITY] UNSAFE sensitive log mode enabled: log redaction is OFF (dev risk).");
  }
  if (changed && !next) {
    console.log("[SECURITY] sensitive log redaction enabled.");
  }
}

function redactLogString(value, fallback = "unknown") {
  return redactSensitiveText(value, { fallback, maxLength: 3000, maxDepth: 5 });
}

function redactSensitiveLogValue(value, fallback = "unknown") {
  return redactSensitiveText(value, { fallback, maxLength: 300, maxDepth: 5 });
}

function sanitizeLogValue(value) {
  return sanitizeSensitiveLogValue(value, { fallback: "unknown", maxLength: 3000, maxDepth: 5 });
}

function installGlobalLogRedaction() {
  if (console.__ravelinkLogRedactionInstalled) return;

  const native = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: typeof console.info === "function" ? console.info.bind(console) : console.log.bind(console),
    debug: typeof console.debug === "function" ? console.debug.bind(console) : console.log.bind(console)
  };

  for (const method of Object.keys(native)) {
    console[method] = (...args) => {
      if (unsafeExposeSensitiveLogsRuntime) {
        native[method](...args);
        return;
      }
      const sanitizedArgs = args.map(arg => sanitizeLogValue(arg));
      native[method](...sanitizedArgs);
    };
  }

  Object.defineProperty(console, "__ravelinkLogRedactionInstalled", {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false
  });
}

installGlobalLogRedaction();

process.on("uncaughtException", err => {
  console.error("[FATAL] uncaughtException");
  console.error(err.stack || err);
});

process.on("unhandledRejection", err => {
  console.error("[FATAL] unhandledRejection");
  console.error(err);
});

const express = require("express");
const axios = require("axios");
const https = require("https");
const tls = require("tls");
const net = require("net");
const fs = require("fs");
const path = require("path");
const { execFile, execFileSync, spawn, spawnSync } = require("child_process");

// [TITLE] Section: Core Dependencies
// ======================================================
// CORE
// ======================================================
let createRaveEngine = require("./core/rave-engine");
let createAudio = require("./core/audio");
const fixtureRegistry = require("./core/fixtures");
const automationRules = require("./core/automation-rules");
const state = require("./core/state");
const createModLoader = require("./core/mods/mod-loader");
const createStandaloneLogic = require("./core/standalone/logic");
const createStandaloneRuntime = require("./core/standalone/runtime");
const createTwitchColorRuntime = require("./core/twitch-color-runtime");

// [TITLE] Section: MIDI Dependencies
// ======================================================
// MIDI
// ======================================================
const createMidiManager = require("./core/midi/midi-manager");

// [TITLE] Section: Hue Dependencies
// ======================================================
// HUE
// ======================================================

const createHueScheduler = require("./core/hue-scheduler");
const createHueEntertainmentTransport = require("./core/hue-entertainment");

// [TITLE] Section: WiZ Dependencies
// ======================================================
// WIZ
// ======================================================
const createWizScheduler = require("./core/wiz-scheduler");
const pickWizColor = require("./wiz/wiz-energy-strategy");
const createWizAdapter = require("./adapters/wiz-adapter");
const colorEngine = require("./colors/color-engine");
const registerRavePaletteMetricRoutes = require("./routes/rave-palette-metric-routes");
const registerMidiRoutes = require("./routes/midi-routes");
const registerRaveOverclockRoutes = require("./routes/rave-overclock-routes");
const registerRaveSceneSyncRoutes = require("./routes/rave-scene-sync-routes");
const registerSystemRoutes = require("./routes/system-routes");
const registerStandaloneRoutes = require("./routes/standalone-routes");
const registerFixturesConnectivityRoutes = require("./routes/fixtures-connectivity-routes");
const registerFixturesRoutes = require("./routes/fixtures-routes");

// [TITLE] Section: Runtime Configuration
// ======================================================
// CONFIG
// ======================================================
const PORT = Number(process.env.PORT || 5050);
const HOST = String(process.env.HOST || "127.0.0.1").trim() || "127.0.0.1";
const RUNTIME_DIR = path.join(__dirname, ".runtime");
const PID_FILE = path.join(RUNTIME_DIR, "bridge.pid");
const HUE_PAIR_APP_NAME = "hue-bridge-final";
const TWITCH_COLOR_CONFIG_PATH = path.join(__dirname, "core", "twitch.color.config.json");
const AUDIO_REACTIVITY_MAP_CONFIG_PATH = path.join(__dirname, "core", "audio.reactivity.map.json");
const AUDIO_RUNTIME_CONFIG_PATH = path.join(__dirname, "core", "audio.config.json");
const SYSTEM_CONFIG_PATH = path.join(__dirname, "core", "system.config.json");
const STANDALONE_STATE_CONFIG_PATH = path.join(__dirname, "core", "standalone.state.json");
const PALETTE_FIXTURE_OVERRIDES_CONFIG_PATH = path.join(__dirname, "core", "palette.fixture.overrides.json");
const FIXTURE_METRIC_ROUTING_CONFIG_PATH = path.join(__dirname, "core", "fixture.metric.routing.json");
const OPTIONAL_AUDIO_TOOLS_SCRIPT_NAME = "RaveLink-Bridge-Install-Optional-Audio-Tools.bat";
const OPTIONAL_AUDIO_TOOLS_SCRIPT_PATH = path.join(__dirname, OPTIONAL_AUDIO_TOOLS_SCRIPT_NAME);
const MODS_README_PATH = path.join(__dirname, "docs", "MODS.md");
const TWITCH_COLOR_TARGETS = new Set(["hue", "wiz", "both", "other"]);
const TWITCH_COLOR_PREFIX_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const TWITCH_RANDOM_COLOR_TOKENS = new Set(["random", "rand", "rnd"]);
const MOD_IMPORT_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const TWITCH_COLOR_CONFIG_DEFAULT = Object.freeze({
  version: 1,
  defaultTarget: "hue",
  autoDefaultTarget: true,
  prefixes: Object.freeze({
    hue: "",
    wiz: "wiz",
    other: ""
  }),
  fixturePrefixes: Object.freeze({}),
  raveOff: Object.freeze({
    enabled: true,
    defaultText: "random",
    groups: Object.freeze({}),
    fixtures: Object.freeze({})
  })
});
const AUDIO_REACTIVITY_SOURCE_CATALOG = Object.freeze({
  smart: Object.freeze({ label: "Smart Mix", description: "Adaptive blend of energy, transient, flux, and bands." }),
  baseline: Object.freeze({ label: "Baseline", description: "Steady RMS/body response." }),
  bass: Object.freeze({ label: "Bass", description: "Low band emphasis for bassline/kick weight." }),
  mids: Object.freeze({ label: "Mids", description: "Mid band focus for vocals/leads." }),
  highs: Object.freeze({ label: "Highs", description: "High band focus for hats/sparkle." }),
  peaks: Object.freeze({ label: "Peaks", description: "Peak envelope for sharp accents." }),
  transients: Object.freeze({ label: "Transients", description: "Attack spikes for punch." }),
  flux: Object.freeze({ label: "Flux", description: "Spectral motion/detail changes." }),
  drums: Object.freeze({ label: "Drums", description: "Percussive blend (bass + transient + flux + beat)." }),
  vocals: Object.freeze({ label: "Vocals", description: "Mid/high blend tuned for vocal presence." }),
  beat: Object.freeze({ label: "Beat", description: "Beat confidence pulses." }),
  groove: Object.freeze({ label: "Groove", description: "Body blend (RMS + bass + mids + beat)." })
});
const AUDIO_REACTIVITY_TARGET_KEYS = Object.freeze(["hue", "wiz", "other"]);
const META_AUTO_TEMPO_TRACKER_KEYS = Object.freeze([
  "baseline",
  "peaks",
  "transients",
  "flux"
]);
const HUE_TRANSPORT_PREFERENCE = Object.freeze({
  AUTO: "auto",
  REST: "rest"
});
const HUE_TRANSPORT_PREFERENCE_VALUES = new Set(Object.values(HUE_TRANSPORT_PREFERENCE));
const CANONICAL_ROUTE_ZONE_BY_BRAND = Object.freeze({
  hue: "hue",
  wiz: "wiz"
});
const FIXTURE_LIST_METHOD_BY_MODE = Object.freeze({
  engine: "listEngineBy",
  twitch: "listTwitchBy",
  custom: "listCustomBy"
});
const CONNECTIVITY_STATUS_TO_SUMMARY_KEY = Object.freeze({
  reachable: "reachable",
  unreachable: "unreachable",
  not_configured: "notConfigured",
  skipped: "skipped"
});
const AUDIO_REACTIVITY_MAP_DEFAULT = Object.freeze({
  version: 1,
  dropEnabled: false,
  hardwareRateLimitsEnabled: true,
  metaAutoHueWizBaselineBlend: true,
  metaAutoTempoTrackersAuto: false,
  metaAutoTempoTrackers: Object.freeze({
    baseline: true,
    peaks: false,
    transients: false,
    flux: false
  }),
  targets: Object.freeze({
    hue: Object.freeze({ enabled: true, amount: 1, sources: Object.freeze(["smart"]) }),
    wiz: Object.freeze({ enabled: true, amount: 1, sources: Object.freeze(["smart"]) }),
    other: Object.freeze({ enabled: true, amount: 1, sources: Object.freeze(["smart"]) })
  })
});
const SYSTEM_CONFIG_DEFAULT = Object.freeze({
  version: 3,
  autoLaunchBrowser: true,
  browserLaunchDelayMs: 1200,
  unsafeExposeSensitiveLogs: false,
  hueTransportPreference: HUE_TRANSPORT_PREFERENCE.AUTO
});
const STANDALONE_STATE_CONFIG_DEFAULT = Object.freeze({
  version: 1,
  fixtures: Object.freeze({})
});
const PALETTE_COLOR_COUNT_OPTIONS = SHARED_PALETTE_COLOR_COUNT_OPTIONS;
const PALETTE_SUPPORTED_BRANDS = Object.freeze(["hue", "wiz"]);
const PALETTE_FAMILY_ORDER = SHARED_PALETTE_FAMILY_ORDER;
const PALETTE_FAMILY_ALIASES = SHARED_PALETTE_FAMILY_ALIASES;
const PALETTE_CYCLE_MODE_ORDER = Object.freeze([
  "on_trigger",
  "timed_cycle",
  "reactive_shift",
  "spectrum_mapper"
]);
const PALETTE_BRIGHTNESS_MODE_ORDER = Object.freeze(["legacy", "test"]);
const PALETTE_SPECTRUM_MAP_MODE_ORDER = Object.freeze(["auto", "manual"]);
const PALETTE_AUDIO_FEATURE_KEYS = Object.freeze([
  "lows",
  "mids",
  "highs",
  "rms",
  "energy",
  "flux",
  "peaks",
  "transients",
  "beat"
]);
const PALETTE_SIGNAL_FEATURE_FIELD_MAP = Object.freeze({
  lows: "lows",
  mids: "mids",
  highs: "highs",
  rms: "rms",
  energy: "energy",
  flux: "flux",
  peaks: "peaks",
  transients: "transients",
  beat: "beat"
});
const PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP = Object.freeze([
  "lows",
  "mids",
  "highs",
  "rms",
  "flux"
]);
const PALETTE_TIMED_INTERVAL_MIN_SEC = 2;
const PALETTE_TIMED_INTERVAL_MAX_SEC = 60;
const PALETTE_BEAT_LOCK_GRACE_MIN_SEC = 0;
const PALETTE_BEAT_LOCK_GRACE_MAX_SEC = 8;
const PALETTE_REACTIVE_MARGIN_MIN = 5;
const PALETTE_REACTIVE_MARGIN_MAX = 100;
const PALETTE_BRIGHTNESS_FOLLOW_AMOUNT_MIN = 0;
const PALETTE_BRIGHTNESS_FOLLOW_AMOUNT_MAX = 2;
const PALETTE_VIVIDNESS_LEVEL_OPTIONS = Object.freeze([0, 1, 2, 3, 4]);
const PALETTE_CONFIG_DEFAULT = Object.freeze({
  colorsPerFamily: 3,
  familyColorCounts: Object.freeze({
    red: 3,
    yellow: 3,
    green: 3,
    cyan: 3,
    blue: 3
  }),
  families: Object.freeze(["red", "green", "blue"]),
  disorder: false,
  disorderAggression: 0.35,
  cycleMode: "on_trigger",
  timedIntervalSec: 5,
  beatLock: false,
  beatLockGraceSec: 2,
  reactiveMargin: 28,
  brightnessMode: "legacy",
  brightnessFollowAmount: 1,
  vividness: 2,
  spectrumMapMode: "auto",
  spectrumFeatureMap: PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP
});
const PALETTE_FAMILY_DEFS = SHARED_PALETTE_FAMILY_DEFS;
const PALETTE_FIXTURE_OVERRIDES_DEFAULT = Object.freeze({
  version: 1,
  fixtures: Object.freeze({})
});
const FIXTURE_METRIC_MODE_ORDER = Object.freeze(["manual", "meta_auto"]);
const FIXTURE_METRIC_KEYS = Object.freeze(["baseline", "peaks", "transients", "flux"]);
const FIXTURE_METRIC_HARMONY_MIN = 1;
const FIXTURE_METRIC_HARMONY_MAX = 8;
const FIXTURE_METRIC_MAX_HZ_MIN = 0.5;
const FIXTURE_METRIC_MAX_HZ_MAX = 24;
const FIXTURE_METRIC_CONFIG_DEFAULT = Object.freeze({
  mode: "manual",
  metric: "baseline",
  metaAutoFlip: false,
  harmonySize: 1,
  maxHz: null
});
const FIXTURE_METRIC_ROUTING_DEFAULT = Object.freeze({
  version: 1,
  config: Object.freeze({ ...FIXTURE_METRIC_CONFIG_DEFAULT }),
  brands: Object.freeze({
    hue: null,
    wiz: null
  }),
  fixtures: Object.freeze({})
});
const UNSAFE_SENSITIVE_LOG_ACK_PHRASE = "I_UNDERSTAND_SENSITIVE_LOG_RISK";
let HueSyncCtor = null;

function getHueSyncCtor() {
  if (HueSyncCtor) return HueSyncCtor;
  const mod = require("hue-sync");
  const ctor = mod?.default || mod;
  if (typeof ctor !== "function") {
    throw new Error("hue-sync constructor unavailable");
  }
  HueSyncCtor = ctor;
  return HueSyncCtor;
}

function normalizeBridgeDiscovery(item = {}) {
  const ip = String(
    item.internalipaddress ||
    item.ip ||
    item.address ||
    ""
  ).trim();
  const id = String(item.id || item.bridgeid || "").trim().toUpperCase();
  const port = Number(item.port || 80);
  return {
    ip,
    id,
    port: Number.isFinite(port) && port > 0 ? port : 80
  };
}

function stringifyHueError(err) {
  if (!err) return "unknown error";
  if (err instanceof Error) return err.message || String(err);

  const parts = [];
  if (err.description) parts.push(String(err.description));
  if (err.type !== undefined) parts.push(`type=${err.type}`);
  if (err.address) parts.push(`address=${err.address}`);

  const raw = String(parts.join(" | ") || err.message || err.error || JSON.stringify(err));
  return raw;
}

function redactErrorForLog(err, fallback = "unknown error") {
  if (!err) return fallback;
  return redactSensitiveLogValue(err.message || err, fallback);
}

function sanitizeHueFallbackReason(value, fallback = "entertainment fallback") {
  return redactSensitiveLogValue(value, fallback);
}

function parseIpv4Parts(ip) {
  return parsePrivateIpv4Parts(ip);
}

function isPrivateHueBridgeIp(ip) {
  return isPrivateOrLoopbackIpv4(ip);
}

function normalizeHueBridgeIp(ip) {
  return normalizePrivateOrLoopbackIpv4(ip);
}

const hueRestHttpsAgentByBridge = new Map();
const hueBridgeIdByIp = new Map();

function resolveHueRestCaPath() {
  const candidates = [];
  if (process.env.RAVE_HUE_CA_CERT_PATH) {
    candidates.push(String(process.env.RAVE_HUE_CA_CERT_PATH));
  }
  try {
    const hueSyncPkg = require.resolve("hue-sync/package.json");
    const hueSyncDir = path.dirname(hueSyncPkg);
    candidates.push(path.join(hueSyncDir, "signify.pem"));
  } catch {}
  candidates.push(path.join(__dirname, "node_modules", "hue-sync", "signify.pem"));
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || "";
}

const hueRestCaPath = resolveHueRestCaPath();
let hueRestCaPem = "";
if (hueRestCaPath) {
  try {
    hueRestCaPem = fs.readFileSync(hueRestCaPath, "utf8");
  } catch {}
}

function normalizeHueBridgeIdToken(value) {
  const token = String(value || "").trim().toLowerCase();
  return token.replace(/[^a-f0-9:-]/g, "");
}

function rememberHueBridgeIdentity(bridgeIp, bridgeId) {
  const ip = normalizeHueBridgeIp(bridgeIp);
  const id = normalizeHueBridgeIdToken(bridgeId);
  if (!ip || !id) return;
  hueBridgeIdByIp.set(ip, id);
}

function resolveHueBridgeIdentityForTarget(target = {}) {
  const bridgeIp = normalizeHueBridgeIp(target?.bridgeIp || "");
  const directBridgeId = normalizeHueBridgeIdToken(target?.bridgeId || "");
  if (bridgeIp && directBridgeId) {
    rememberHueBridgeIdentity(bridgeIp, directBridgeId);
    return directBridgeId;
  }
  if (bridgeIp && hueBridgeIdByIp.has(bridgeIp)) {
    return hueBridgeIdByIp.get(bridgeIp);
  }
  return directBridgeId;
}

function getHueRestHttpsAgent(target = {}) {
  const bridgeIp = normalizeHueBridgeIp(target?.bridgeIp || "");
  const bridgeId = resolveHueBridgeIdentityForTarget(target);
  const key = bridgeId || bridgeIp || "default";
  if (hueRestHttpsAgentByBridge.has(key)) {
    return hueRestHttpsAgentByBridge.get(key);
  }

  const options = {
    keepAlive: true,
    maxSockets: 32,
    keepAliveMsecs: 1000,
    rejectUnauthorized: true
  };
  if (hueRestCaPem) {
    options.ca = hueRestCaPem;
  }
  if (bridgeId) {
    options.servername = bridgeId;
    options.checkServerIdentity = (_host, cert) =>
      tls.checkServerIdentity(bridgeId, cert);
  }

  const agent = new https.Agent(options);
  hueRestHttpsAgentByBridge.set(key, agent);
  return agent;
}

function destroyHueRestHttpsAgents() {
  for (const agent of hueRestHttpsAgentByBridge.values()) {
    try {
      agent.destroy();
    } catch {}
  }
  hueRestHttpsAgentByBridge.clear();
}

function isLoopbackRequest(req) {
  const remote = String(
    req?.socket?.remoteAddress ||
    req?.ip ||
    ""
  ).trim().toLowerCase();

  return (
    remote === "127.0.0.1" ||
    remote === "::1" ||
    remote === "::ffff:127.0.0.1" ||
    remote.startsWith("::ffff:127.")
  );
}

function parseBooleanToken(value) {
  return parseBooleanTokenShared(value);
}

function parseBooleanLoose(value, fallback = false) {
  return parseBooleanLooseShared(value, fallback);
}

function parseBoolean(value, fallback = false) {
  return parseBooleanLoose(value, fallback);
}

function clampNumber(value, min, max, fallback = min) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    const fallbackNum = Number(fallback);
    return Number.isFinite(fallbackNum) ? fallbackNum : min;
  }
  return Math.min(max, Math.max(min, n));
}

const {
  clampRgb255,
  miredToKelvin,
  kelvinToRgb,
  xyBriToRgb,
  hueStateToWizState,
  clamp01,
  getAudioTelemetryMotionProfile,
  boostRgbSaturation,
  rgbToHsv255,
  hsvToRgb255,
  resolveAudioReactivitySourceLevel
} = createServerColorUtils({ clampNumber, convertHsvToRgb255 });

const {
  hasOwn,
  isNonArrayObject,
  getRequestMap,
  createRequestValueReader,
  patchOptionalBoolean,
  patchOptionalNumber,
  patchOptionalLowerString,
  mergePatchObject,
  parseLowerTokenList
} = createRequestPatchUtils({ parseBoolean });

function probeCommand(command, args = [], options = {}) {
  try {
    const result = spawnSync(command, args, {
      windowsHide: true,
      encoding: "utf8",
      timeout: Math.max(250, Math.min(10000, Number(options.timeoutMs || 2400))),
      stdio: "pipe"
    });
    const failedBySpawn = Boolean(result?.error && result.error.code === "ENOENT");
    const reached = !failedBySpawn;
    const ok = reached && result?.status === 0;
    return {
      reached,
      ok,
      status: Number(result?.status || 0),
      error: result?.error ? String(result.error.message || result.error) : "",
      stdout: String(result?.stdout || "").trim(),
      stderr: String(result?.stderr || "").trim()
    };
  } catch (err) {
    return {
      reached: false,
      ok: false,
      status: 0,
      error: String(err?.message || err || "command probe failed").trim(),
      stdout: "",
      stderr: ""
    };
  }
}

function resolveOptionalAudioToolsStatus() {
  const platform = process.platform;
  const ffmpegEnvPath = String(process.env.RAVE_AUDIO_FFMPEG_PATH || "").trim();
  const ffmpegEnvPathExists = ffmpegEnvPath ? fs.existsSync(ffmpegEnvPath) : false;
  const bundledFfmpegPath = path.join(__dirname, "runtime", "tools", "ffmpeg", "ffmpeg.exe");
  const bundledFfmpegExists = fs.existsSync(bundledFfmpegPath);
  const ffmpegProbe = probeCommand("ffmpeg", ["-version"], { timeoutMs: 1800 });
  const ffmpegAvailable = Boolean(ffmpegProbe.ok || ffmpegEnvPathExists || bundledFfmpegExists);
  let ffmpegSource = "missing";
  if (ffmpegEnvPathExists) ffmpegSource = "env_path";
  else if (bundledFfmpegExists) ffmpegSource = "bundled";
  else if (ffmpegProbe.ok) ffmpegSource = "path";

  const py313Probe = platform === "win32"
    ? probeCommand("py", ["-3.13", "--version"], { timeoutMs: 1800 })
    : { reached: false, ok: false, status: 0, error: "windows-only", stdout: "", stderr: "" };
  const python313Available = platform === "win32" ? py313Probe.ok : false;

  const procTapProbe = platform === "win32" && python313Available
    ? probeCommand("py", ["-3.13", "-c", "import proctap, psutil"], { timeoutMs: 2400 })
    : { reached: false, ok: false, status: 0, error: "python-3.13-missing", stdout: "", stderr: "" };
  const processLoopbackAvailable = platform === "win32" ? procTapProbe.ok : false;

  const windowsAdvancedFeaturesReady = ffmpegAvailable && processLoopbackAvailable;
  const needsOptionalInstall = platform === "win32" && !windowsAdvancedFeaturesReady;
  const installScriptExists = fs.existsSync(OPTIONAL_AUDIO_TOOLS_SCRIPT_PATH);
  const installCommand = installScriptExists ? OPTIONAL_AUDIO_TOOLS_SCRIPT_NAME : "";

  return {
    platform,
    windowsOnlyFeature: true,
    optionalToolsReady: platform === "win32" ? windowsAdvancedFeaturesReady : true,
    needsOptionalInstall,
    installScript: {
      exists: installScriptExists,
      fileName: OPTIONAL_AUDIO_TOOLS_SCRIPT_NAME,
      command: installCommand,
      startMenuHint: "Start Menu > RaveLink Bridge > Install Optional Audio Tools"
    },
    checks: {
      ffmpeg: {
        available: ffmpegAvailable,
        source: ffmpegSource,
        envPath: ffmpegEnvPath,
        envPathExists: ffmpegEnvPathExists,
        bundledPath: bundledFfmpegExists ? bundledFfmpegPath : "",
        pathCommandReachable: ffmpegProbe.reached,
        pathCommandOk: ffmpegProbe.ok
      },
      python313: {
        available: python313Available,
        launcherReachable: py313Probe.reached,
        launcherOk: py313Probe.ok
      },
      procTap: {
        available: processLoopbackAvailable,
        importOk: procTapProbe.ok
      }
    }
  };
}

function sanitizeHueTransportPreference(value, fallback = HUE_TRANSPORT_PREFERENCE.AUTO) {
  const raw = String(value || "").trim().toLowerCase();
  if (HUE_TRANSPORT_PREFERENCE_VALUES.has(raw)) return raw;
  const fallbackRaw = String(fallback || "").trim().toLowerCase();
  if (HUE_TRANSPORT_PREFERENCE_VALUES.has(fallbackRaw)) return fallbackRaw;
  return HUE_TRANSPORT_PREFERENCE.AUTO;
}

function clampSystemBrowserLaunchDelayMs(value, fallback = SYSTEM_CONFIG_DEFAULT.browserLaunchDelayMs) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(250, Math.min(15000, Math.round(n)));
}

function sanitizeSystemConfig(input = {}) {
  const raw = input && typeof input === "object" ? input : {};
  return {
    version: 3,
    autoLaunchBrowser: parseBooleanLoose(raw.autoLaunchBrowser, SYSTEM_CONFIG_DEFAULT.autoLaunchBrowser),
    browserLaunchDelayMs: clampSystemBrowserLaunchDelayMs(
      raw.browserLaunchDelayMs,
      SYSTEM_CONFIG_DEFAULT.browserLaunchDelayMs
    ),
    unsafeExposeSensitiveLogs: parseBooleanLoose(
      raw.unsafeExposeSensitiveLogs,
      SYSTEM_CONFIG_DEFAULT.unsafeExposeSensitiveLogs
    ),
    hueTransportPreference: sanitizeHueTransportPreference(
      raw.hueTransportPreference,
      SYSTEM_CONFIG_DEFAULT.hueTransportPreference
    )
  };
}

function readSystemConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SYSTEM_CONFIG_PATH, "utf8"));
    return sanitizeSystemConfig(parsed);
  } catch {
    return sanitizeSystemConfig(SYSTEM_CONFIG_DEFAULT);
  }
}

function writeSystemConfig(config) {
  const safe = sanitizeSystemConfig(config);
  fs.mkdirSync(path.dirname(SYSTEM_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(SYSTEM_CONFIG_PATH, `${JSON.stringify(safe, null, 2)}\n`, "utf8");
  return safe;
}

const AUDIO_RUNTIME_CONFIG_KEYS = Object.freeze([
  "inputBackend",
  "sampleRate",
  "framesPerBuffer",
  "channels",
  "noiseFloorMin",
  "peakDecay",
  "outputGain",
  "autoLevelEnabled",
  "autoLevelTargetRms",
  "autoLevelMinGain",
  "autoLevelMaxGain",
  "autoLevelResponse",
  "autoLevelGate",
  "limiterThreshold",
  "limiterKnee",
  "restartMs",
  "watchdogMs",
  "logEveryTicks",
  "bandLowHz",
  "bandMidHz",
  "deviceMatch",
  "deviceId",
  "ffmpegPath",
  "ffmpegInputFormat",
  "ffmpegInputDevice",
  "ffmpegInputDevices",
  "ffmpegLogLevel",
  "ffmpegUseWallclock",
  "ffmpegAppIsolationEnabled",
  "ffmpegAppIsolationStrict",
  "ffmpegAppIsolationPrimaryApp",
  "ffmpegAppIsolationFallbackApp",
  "ffmpegAppIsolationPrimaryDevices",
  "ffmpegAppIsolationFallbackDevices",
  "ffmpegAppIsolationMultiSource",
  "ffmpegAppIsolationCheckMs"
]);

function sanitizeAudioRuntimeConfig(input = null) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const safe = {};
  for (const key of AUDIO_RUNTIME_CONFIG_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    safe[key] = input[key];
  }
  return Object.keys(safe).length ? safe : null;
}

function readAudioRuntimeConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(AUDIO_RUNTIME_CONFIG_PATH, "utf8"));
    return sanitizeAudioRuntimeConfig(parsed);
  } catch {
    return null;
  }
}

function writeAudioRuntimeConfig(config) {
  const safe = sanitizeAudioRuntimeConfig(config);
  if (!safe) return null;
  fs.mkdirSync(path.dirname(AUDIO_RUNTIME_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(AUDIO_RUNTIME_CONFIG_PATH, `${JSON.stringify(safe, null, 2)}\n`, "utf8");
  return safe;
}

let audioRuntimeConfigWriteTimer = null;
let audioRuntimeConfigWritePending = null;
let audioRuntimeConfigWriteInFlight = false;

function scheduleAudioRuntimeConfigWrite(config, options = {}) {
  const safe = sanitizeAudioRuntimeConfig(config);
  if (!safe) return;
  const delayMs = Math.max(25, Math.min(2500, Math.round(Number(options.delayMs || 180))));
  audioRuntimeConfigWritePending = safe;

  const queueWrite = async () => {
    if (audioRuntimeConfigWriteInFlight) return;
    if (!audioRuntimeConfigWritePending) return;
    const payload = audioRuntimeConfigWritePending;
    audioRuntimeConfigWritePending = null;
    audioRuntimeConfigWriteInFlight = true;
    try {
      await fs.promises.mkdir(path.dirname(AUDIO_RUNTIME_CONFIG_PATH), { recursive: true });
      await fs.promises.writeFile(
        AUDIO_RUNTIME_CONFIG_PATH,
        `${JSON.stringify(payload, null, 2)}\n`,
        "utf8"
      );
    } catch (err) {
      console.warn(`[AUDIO] runtime config async write failed: ${err.message || err}`);
    } finally {
      audioRuntimeConfigWriteInFlight = false;
      if (audioRuntimeConfigWritePending && !audioRuntimeConfigWriteTimer) {
        audioRuntimeConfigWriteTimer = setTimeout(() => {
          audioRuntimeConfigWriteTimer = null;
          queueWrite().catch(() => {});
        }, delayMs);
        audioRuntimeConfigWriteTimer.unref?.();
      }
    }
  };

  if (audioRuntimeConfigWriteTimer) {
    clearTimeout(audioRuntimeConfigWriteTimer);
    audioRuntimeConfigWriteTimer = null;
  }
  if (options.immediate === true) {
    queueWrite().catch(() => {});
    return;
  }
  audioRuntimeConfigWriteTimer = setTimeout(() => {
    audioRuntimeConfigWriteTimer = null;
    queueWrite().catch(() => {});
  }, delayMs);
  audioRuntimeConfigWriteTimer.unref?.();
}

function flushScheduledAudioRuntimeConfigWriteSync() {
  if (audioRuntimeConfigWriteTimer) {
    clearTimeout(audioRuntimeConfigWriteTimer);
    audioRuntimeConfigWriteTimer = null;
  }
  if (!audioRuntimeConfigWritePending) return null;
  const pending = audioRuntimeConfigWritePending;
  audioRuntimeConfigWritePending = null;
  return writeAudioRuntimeConfig(pending);
}

function clampAudioReactivityAmount(value, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1.8, Math.round(n * 100) / 100));
}

function normalizeAudioReactivitySourceKey(value) {
  const key = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(AUDIO_REACTIVITY_SOURCE_CATALOG, key)
    ? key
    : "";
}

function sanitizeAudioReactivitySources(value, fallback = ["smart"]) {
  const rawList = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\s]+/)
      : [];
  const deduped = [];
  for (const raw of rawList) {
    const key = normalizeAudioReactivitySourceKey(raw);
    if (!key) continue;
    if (!deduped.includes(key)) deduped.push(key);
    if (deduped.length >= 6) break;
  }
  if (deduped.length > 0) return deduped;

  const fallbackList = Array.isArray(fallback) ? fallback : [fallback];
  const normalizedFallback = fallbackList
    .map(normalizeAudioReactivitySourceKey)
    .filter(Boolean);
  return normalizedFallback.length ? [...new Set(normalizedFallback)] : ["smart"];
}

function sanitizeAudioReactivityTargetConfig(input = {}, fallback = {}) {
  const raw = input && typeof input === "object" ? input : {};
  const safeFallback = fallback && typeof fallback === "object" ? fallback : {};
  const fallbackSources = Array.isArray(safeFallback.sources) ? safeFallback.sources : ["smart"];
  return {
    enabled: parseBooleanLoose(raw.enabled, parseBooleanLoose(safeFallback.enabled, true)),
    amount: clampAudioReactivityAmount(raw.amount, clampAudioReactivityAmount(safeFallback.amount, 1)),
    sources: sanitizeAudioReactivitySources(raw.sources, fallbackSources)
  };
}

function sanitizeMetaAutoTempoTrackersConfig(input = {}, fallback = {}) {
  const raw = input && typeof input === "object" ? input : {};
  const safeFallback = fallback && typeof fallback === "object" ? fallback : {};
  const out = {};
  for (const key of META_AUTO_TEMPO_TRACKER_KEYS) {
    out[key] = parseBooleanLoose(raw[key], parseBooleanLoose(safeFallback[key], false));
  }
  return out;
}

function enforceMetaAutoTempoTrackerCompatibility(trackers = {}) {
  const safe = sanitizeMetaAutoTempoTrackersConfig(
    trackers,
    AUDIO_REACTIVITY_MAP_DEFAULT.metaAutoTempoTrackers
  );
  const hasAny = META_AUTO_TEMPO_TRACKER_KEYS.some(key => safe[key] === true);
  if (!hasAny) {
    // Empty tracker sets are contradictory to tempo-tracker mode.
    safe.baseline = true;
  }
  return safe;
}

function sanitizeAudioReactivityMapConfig(input = {}) {
  const raw = input && typeof input === "object" ? input : {};
  const rawTargets = raw.targets && typeof raw.targets === "object" ? raw.targets : {};
  const fallbackTargets = AUDIO_REACTIVITY_MAP_DEFAULT.targets || {};
  const targets = {};
  for (const target of AUDIO_REACTIVITY_TARGET_KEYS) {
    targets[target] = sanitizeAudioReactivityTargetConfig(
      rawTargets[target],
      fallbackTargets[target]
    );
  }
  const defaultTrackers = AUDIO_REACTIVITY_MAP_DEFAULT.metaAutoTempoTrackers || {};
  const fallbackTrackers = sanitizeMetaAutoTempoTrackersConfig(defaultTrackers, defaultTrackers);
  const baselineBlend = parseBooleanLoose(
    raw.metaAutoHueWizBaselineBlend,
    parseBooleanLoose(fallbackTrackers.baseline, false)
  );
  const mergedTrackersInput = {
    ...fallbackTrackers,
    baseline: baselineBlend,
    ...(
      raw.metaAutoTempoTrackers && typeof raw.metaAutoTempoTrackers === "object"
        ? raw.metaAutoTempoTrackers
        : {}
    )
  };
  const metaAutoTempoTrackers = enforceMetaAutoTempoTrackerCompatibility(
    mergedTrackersInput,
    fallbackTrackers
  );
  const baselineBlendEnabled = metaAutoTempoTrackers.baseline === true;
  return {
    version: 1,
    dropEnabled: parseBooleanLoose(raw.dropEnabled, AUDIO_REACTIVITY_MAP_DEFAULT.dropEnabled),
    hardwareRateLimitsEnabled: parseBooleanLoose(
      raw.hardwareRateLimitsEnabled,
      AUDIO_REACTIVITY_MAP_DEFAULT.hardwareRateLimitsEnabled
    ),
    metaAutoHueWizBaselineBlend: baselineBlendEnabled,
    metaAutoTempoTrackersAuto: parseBooleanLoose(
      raw.metaAutoTempoTrackersAuto,
      parseBooleanLoose(AUDIO_REACTIVITY_MAP_DEFAULT.metaAutoTempoTrackersAuto, false)
    ),
    metaAutoTempoTrackers,
    targets
  };
}

function readAudioReactivityMapConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(AUDIO_REACTIVITY_MAP_CONFIG_PATH, "utf8"));
    return sanitizeAudioReactivityMapConfig(parsed);
  } catch {
    return sanitizeAudioReactivityMapConfig(AUDIO_REACTIVITY_MAP_DEFAULT);
  }
}

function writeAudioReactivityMapConfig(config) {
  const safe = sanitizeAudioReactivityMapConfig(config);
  fs.mkdirSync(path.dirname(AUDIO_REACTIVITY_MAP_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(AUDIO_REACTIVITY_MAP_CONFIG_PATH, `${JSON.stringify(safe, null, 2)}\n`, "utf8");
  return safe;
}

function sanitizeStandaloneStateConfig(input = {}) {
  const raw = input && typeof input === "object" ? input : {};
  const rawFixtures = raw.fixtures && typeof raw.fixtures === "object" && !Array.isArray(raw.fixtures)
    ? raw.fixtures
    : {};
  const fixtures = {};
  for (const [rawId, rawState] of Object.entries(rawFixtures)) {
    const id = String(rawId || "").trim();
    if (!id || id.length > 128) continue;
    if (!rawState || typeof rawState !== "object" || Array.isArray(rawState)) continue;
    fixtures[id] = { ...rawState };
  }
  return {
    version: 1,
    fixtures
  };
}

function readStandaloneStateConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STANDALONE_STATE_CONFIG_PATH, "utf8"));
    return sanitizeStandaloneStateConfig(parsed);
  } catch {
    return sanitizeStandaloneStateConfig(STANDALONE_STATE_CONFIG_DEFAULT);
  }
}

function writeStandaloneStateConfig(config) {
  const safe = sanitizeStandaloneStateConfig(config);
  fs.mkdirSync(path.dirname(STANDALONE_STATE_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(STANDALONE_STATE_CONFIG_PATH, `${JSON.stringify(safe, null, 2)}\n`, "utf8");
  return safe;
}

function normalizePaletteBrandKey(value) {
  const key = String(value || "").trim().toLowerCase();
  return PALETTE_SUPPORTED_BRANDS.includes(key) ? key : "";
}

function normalizePaletteColorCount(value, fallback = PALETTE_CONFIG_DEFAULT.colorsPerFamily) {
  const parsed = Number(value);
  if (PALETTE_COLOR_COUNT_OPTIONS.includes(parsed)) return parsed;
  const fallbackParsed = Number(fallback);
  if (PALETTE_COLOR_COUNT_OPTIONS.includes(fallbackParsed)) return fallbackParsed;
  return PALETTE_CONFIG_DEFAULT.colorsPerFamily;
}

function buildPaletteUniformColorCounts(colorCount) {
  const count = normalizePaletteColorCount(colorCount, PALETTE_CONFIG_DEFAULT.colorsPerFamily);
  const out = {};
  for (const familyId of PALETTE_FAMILY_ORDER) {
    out[familyId] = count;
  }
  return out;
}

function normalizePaletteFamilyColorCounts(
  value,
  fallback = PALETTE_CONFIG_DEFAULT.familyColorCounts,
  fallbackColorCount = PALETTE_CONFIG_DEFAULT.colorsPerFamily
) {
  const fallbackCount = normalizePaletteColorCount(
    fallbackColorCount,
    PALETTE_CONFIG_DEFAULT.colorsPerFamily
  );
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const fallbackMap = fallback && typeof fallback === "object" && !Array.isArray(fallback)
    ? fallback
    : {};
  const out = {};
  for (const familyId of PALETTE_FAMILY_ORDER) {
    const raw = Object.prototype.hasOwnProperty.call(source, familyId)
      ? source[familyId]
      : Object.prototype.hasOwnProperty.call(fallbackMap, familyId)
        ? fallbackMap[familyId]
        : fallbackCount;
    out[familyId] = normalizePaletteColorCount(raw, fallbackCount);
  }
  return out;
}

function normalizePaletteDisorderAggression(value, fallback = PALETTE_CONFIG_DEFAULT.disorderAggression) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number(fallback) || PALETTE_CONFIG_DEFAULT.disorderAggression;
  const normalized = parsed > 1 ? (parsed / 100) : parsed;
  return Math.max(0, Math.min(1, normalized));
}

function normalizePaletteCycleMode(value, fallback = PALETTE_CONFIG_DEFAULT.cycleMode) {
  const key = String(value || "").trim().toLowerCase();
  if (PALETTE_CYCLE_MODE_ORDER.includes(key)) return key;
  const fallbackKey = String(fallback || "").trim().toLowerCase();
  return PALETTE_CYCLE_MODE_ORDER.includes(fallbackKey)
    ? fallbackKey
    : PALETTE_CONFIG_DEFAULT.cycleMode;
}

function normalizePaletteTimedIntervalSec(value, fallback = PALETTE_CONFIG_DEFAULT.timedIntervalSec) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return clampNumber(
      Math.round(parsed),
      PALETTE_TIMED_INTERVAL_MIN_SEC,
      PALETTE_TIMED_INTERVAL_MAX_SEC,
      PALETTE_CONFIG_DEFAULT.timedIntervalSec
    );
  }
  const fallbackNum = Number(fallback);
  if (Number.isFinite(fallbackNum)) {
    return clampNumber(
      Math.round(fallbackNum),
      PALETTE_TIMED_INTERVAL_MIN_SEC,
      PALETTE_TIMED_INTERVAL_MAX_SEC,
      PALETTE_CONFIG_DEFAULT.timedIntervalSec
    );
  }
  return PALETTE_CONFIG_DEFAULT.timedIntervalSec;
}

function normalizePaletteBeatLockGraceSec(value, fallback = PALETTE_CONFIG_DEFAULT.beatLockGraceSec) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return clampNumber(
      Math.round(parsed),
      PALETTE_BEAT_LOCK_GRACE_MIN_SEC,
      PALETTE_BEAT_LOCK_GRACE_MAX_SEC,
      PALETTE_CONFIG_DEFAULT.beatLockGraceSec
    );
  }
  const fallbackNum = Number(fallback);
  if (Number.isFinite(fallbackNum)) {
    return clampNumber(
      Math.round(fallbackNum),
      PALETTE_BEAT_LOCK_GRACE_MIN_SEC,
      PALETTE_BEAT_LOCK_GRACE_MAX_SEC,
      PALETTE_CONFIG_DEFAULT.beatLockGraceSec
    );
  }
  return PALETTE_CONFIG_DEFAULT.beatLockGraceSec;
}

function normalizePaletteReactiveMargin(value, fallback = PALETTE_CONFIG_DEFAULT.reactiveMargin) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return clampNumber(
      Math.round(parsed),
      PALETTE_REACTIVE_MARGIN_MIN,
      PALETTE_REACTIVE_MARGIN_MAX,
      PALETTE_CONFIG_DEFAULT.reactiveMargin
    );
  }
  const fallbackNum = Number(fallback);
  if (Number.isFinite(fallbackNum)) {
    return clampNumber(
      Math.round(fallbackNum),
      PALETTE_REACTIVE_MARGIN_MIN,
      PALETTE_REACTIVE_MARGIN_MAX,
      PALETTE_CONFIG_DEFAULT.reactiveMargin
    );
  }
  return PALETTE_CONFIG_DEFAULT.reactiveMargin;
}

function normalizePaletteBrightnessMode(value, fallback = PALETTE_CONFIG_DEFAULT.brightnessMode) {
  const mode = String(value || "").trim().toLowerCase();
  if (PALETTE_BRIGHTNESS_MODE_ORDER.includes(mode)) return mode;
  const fallbackMode = String(fallback || "").trim().toLowerCase();
  return PALETTE_BRIGHTNESS_MODE_ORDER.includes(fallbackMode)
    ? fallbackMode
    : PALETTE_CONFIG_DEFAULT.brightnessMode;
}

function normalizePaletteBrightnessFollowAmount(
  value,
  fallback = PALETTE_CONFIG_DEFAULT.brightnessFollowAmount
) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return clampNumber(
      parsed,
      PALETTE_BRIGHTNESS_FOLLOW_AMOUNT_MIN,
      PALETTE_BRIGHTNESS_FOLLOW_AMOUNT_MAX,
      PALETTE_CONFIG_DEFAULT.brightnessFollowAmount
    );
  }
  const fallbackNum = Number(fallback);
  if (Number.isFinite(fallbackNum)) {
    return clampNumber(
      fallbackNum,
      PALETTE_BRIGHTNESS_FOLLOW_AMOUNT_MIN,
      PALETTE_BRIGHTNESS_FOLLOW_AMOUNT_MAX,
      PALETTE_CONFIG_DEFAULT.brightnessFollowAmount
    );
  }
  return PALETTE_CONFIG_DEFAULT.brightnessFollowAmount;
}

function normalizePaletteVividness(value, fallback = PALETTE_CONFIG_DEFAULT.vividness) {
  const minLevel = PALETTE_VIVIDNESS_LEVEL_OPTIONS[0];
  const maxLevel = PALETTE_VIVIDNESS_LEVEL_OPTIONS[PALETTE_VIVIDNESS_LEVEL_OPTIONS.length - 1];
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return clampNumber(Math.round(parsed), minLevel, maxLevel, PALETTE_CONFIG_DEFAULT.vividness);
  }
  const fallbackNum = Number(fallback);
  if (Number.isFinite(fallbackNum)) {
    return clampNumber(Math.round(fallbackNum), minLevel, maxLevel, PALETTE_CONFIG_DEFAULT.vividness);
  }
  return PALETTE_CONFIG_DEFAULT.vividness;
}

function normalizePaletteSpectrumMapMode(value, fallback = PALETTE_CONFIG_DEFAULT.spectrumMapMode) {
  const key = String(value || "").trim().toLowerCase();
  if (PALETTE_SPECTRUM_MAP_MODE_ORDER.includes(key)) return key;
  const fallbackKey = String(fallback || "").trim().toLowerCase();
  return PALETTE_SPECTRUM_MAP_MODE_ORDER.includes(fallbackKey)
    ? fallbackKey
    : PALETTE_CONFIG_DEFAULT.spectrumMapMode;
}

function normalizePaletteAudioFeatureKey(value, fallback = PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP[0]) {
  const key = String(value || "").trim().toLowerCase();
  if (PALETTE_AUDIO_FEATURE_KEYS.includes(key)) return key;
  const fallbackKey = String(fallback || "").trim().toLowerCase();
  return PALETTE_AUDIO_FEATURE_KEYS.includes(fallbackKey)
    ? fallbackKey
    : PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP[0];
}

function normalizePaletteSpectrumFeatureMap(value, fallback = PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP) {
  const list = Array.isArray(value)
    ? value
    : String(value || "")
      .split(",")
      .map(item => item.trim())
      .filter(Boolean);
  const fallbackList = Array.isArray(fallback) && fallback.length
    ? fallback
    : PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP;
  const out = [];
  for (let i = 0; i < 5; i += 1) {
    const raw = Object.prototype.hasOwnProperty.call(list, i)
      ? list[i]
      : fallbackList[i % fallbackList.length];
    out.push(
      normalizePaletteAudioFeatureKey(raw, fallbackList[i % fallbackList.length])
    );
  }
  return out;
}

function normalizePaletteFamilies(value, fallback = PALETTE_CONFIG_DEFAULT.families) {
  const list = Array.isArray(value)
    ? value
    : String(value || "")
      .split(",")
      .map(item => item.trim())
      .filter(Boolean);
  const out = [];
  for (const raw of list) {
    const key = String(raw || "").trim().toLowerCase();
    const mapped = PALETTE_FAMILY_ALIASES[key] || key;
    if (!PALETTE_FAMILY_ORDER.includes(mapped)) continue;
    if (out.includes(mapped)) continue;
    out.push(mapped);
  }
  if (out.length) return out;
  const fallbackList = Array.isArray(fallback) && fallback.length
    ? fallback
    : PALETTE_CONFIG_DEFAULT.families;
  return normalizePaletteFamilies(fallbackList, PALETTE_FAMILY_ORDER);
}

function resolvePaletteColorCountForFamily(
  config = {},
  familyId,
  fallback = PALETTE_CONFIG_DEFAULT.colorsPerFamily
) {
  const familyKey = String(familyId || "").trim().toLowerCase();
  const fallbackCount = normalizePaletteColorCount(config?.colorsPerFamily, fallback);
  if (!PALETTE_FAMILY_ORDER.includes(familyKey)) return fallbackCount;
  const counts = config?.familyColorCounts && typeof config.familyColorCounts === "object"
    ? config.familyColorCounts
    : null;
  if (!counts || !Object.prototype.hasOwnProperty.call(counts, familyKey)) {
    return fallbackCount;
  }
  return normalizePaletteColorCount(counts[familyKey], fallbackCount);
}

function normalizePaletteConfigSnapshot(source = {}, fallback = PALETTE_CONFIG_DEFAULT) {
  const raw = source && typeof source === "object" ? source : {};
  const safeFallback = fallback && typeof fallback === "object"
    ? fallback
    : PALETTE_CONFIG_DEFAULT;
  const fallbackColorsPerFamily = normalizePaletteColorCount(
    safeFallback.colorsPerFamily,
    PALETTE_CONFIG_DEFAULT.colorsPerFamily
  );
  const colorsPerFamily = normalizePaletteColorCount(
    raw.colorsPerFamily,
    fallbackColorsPerFamily
  );
  const familyColorCountsFallback = normalizePaletteFamilyColorCounts(
    safeFallback.familyColorCounts,
    PALETTE_CONFIG_DEFAULT.familyColorCounts,
    fallbackColorsPerFamily
  );
  return {
    colorsPerFamily,
    familyColorCounts: normalizePaletteFamilyColorCounts(
      raw.familyColorCounts,
      familyColorCountsFallback,
      colorsPerFamily
    ),
    families: normalizePaletteFamilies(
      raw.families,
      normalizePaletteFamilies(safeFallback.families, PALETTE_CONFIG_DEFAULT.families)
    ),
    disorder: Object.prototype.hasOwnProperty.call(raw, "disorder")
      ? parseBooleanLoose(raw.disorder, Boolean(safeFallback.disorder))
      : Boolean(safeFallback.disorder),
    disorderAggression: normalizePaletteDisorderAggression(
      raw.disorderAggression,
      normalizePaletteDisorderAggression(safeFallback.disorderAggression, PALETTE_CONFIG_DEFAULT.disorderAggression)
    ),
    cycleMode: normalizePaletteCycleMode(raw.cycleMode, safeFallback.cycleMode),
    timedIntervalSec: normalizePaletteTimedIntervalSec(
      raw.timedIntervalSec,
      normalizePaletteTimedIntervalSec(safeFallback.timedIntervalSec, PALETTE_CONFIG_DEFAULT.timedIntervalSec)
    ),
    beatLock: Object.prototype.hasOwnProperty.call(raw, "beatLock")
      ? parseBooleanLoose(raw.beatLock, Boolean(safeFallback.beatLock))
      : Boolean(safeFallback.beatLock),
    beatLockGraceSec: normalizePaletteBeatLockGraceSec(
      raw.beatLockGraceSec,
      normalizePaletteBeatLockGraceSec(safeFallback.beatLockGraceSec, PALETTE_CONFIG_DEFAULT.beatLockGraceSec)
    ),
    reactiveMargin: normalizePaletteReactiveMargin(
      raw.reactiveMargin,
      normalizePaletteReactiveMargin(safeFallback.reactiveMargin, PALETTE_CONFIG_DEFAULT.reactiveMargin)
    ),
    brightnessMode: normalizePaletteBrightnessMode(
      raw.brightnessMode,
      normalizePaletteBrightnessMode(safeFallback.brightnessMode, PALETTE_CONFIG_DEFAULT.brightnessMode)
    ),
    brightnessFollowAmount: normalizePaletteBrightnessFollowAmount(
      raw.brightnessFollowAmount,
      normalizePaletteBrightnessFollowAmount(
        safeFallback.brightnessFollowAmount,
        PALETTE_CONFIG_DEFAULT.brightnessFollowAmount
      )
    ),
    vividness: normalizePaletteVividness(
      raw.vividness,
      normalizePaletteVividness(safeFallback.vividness, PALETTE_CONFIG_DEFAULT.vividness)
    ),
    spectrumMapMode: normalizePaletteSpectrumMapMode(raw.spectrumMapMode, safeFallback.spectrumMapMode),
    spectrumFeatureMap: normalizePaletteSpectrumFeatureMap(
      raw.spectrumFeatureMap,
      normalizePaletteSpectrumFeatureMap(
        safeFallback.spectrumFeatureMap,
        PALETTE_CONFIG_DEFAULT.spectrumFeatureMap
      )
    )
  };
}

function sanitizePaletteFixtureOverridesConfig(input = {}) {
  const raw = input && typeof input === "object" ? input : {};
  const rawFixtures = raw.fixtures && typeof raw.fixtures === "object" && !Array.isArray(raw.fixtures)
    ? raw.fixtures
    : {};
  const fixtures = {};
  for (const [rawId, rawConfig] of Object.entries(rawFixtures)) {
    const fixtureId = String(rawId || "").trim();
    if (!fixtureId || fixtureId.length > 128) continue;
    if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) continue;
    fixtures[fixtureId] = normalizePaletteConfigSnapshot(rawConfig, PALETTE_CONFIG_DEFAULT);
  }
  return {
    version: 1,
    fixtures
  };
}

function readPaletteFixtureOverridesConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(PALETTE_FIXTURE_OVERRIDES_CONFIG_PATH, "utf8"));
    return sanitizePaletteFixtureOverridesConfig(parsed);
  } catch {
    return sanitizePaletteFixtureOverridesConfig(PALETTE_FIXTURE_OVERRIDES_DEFAULT);
  }
}

function writePaletteFixtureOverridesConfig(config) {
  const safe = sanitizePaletteFixtureOverridesConfig(config);
  fs.mkdirSync(path.dirname(PALETTE_FIXTURE_OVERRIDES_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(PALETTE_FIXTURE_OVERRIDES_CONFIG_PATH, `${JSON.stringify(safe, null, 2)}\n`, "utf8");
  return safe;
}

function normalizeFixtureMetricMode(value, fallback = FIXTURE_METRIC_CONFIG_DEFAULT.mode) {
  const key = String(value || "").trim().toLowerCase();
  if (FIXTURE_METRIC_MODE_ORDER.includes(key)) return key;
  const fallbackKey = String(fallback || "").trim().toLowerCase();
  return FIXTURE_METRIC_MODE_ORDER.includes(fallbackKey)
    ? fallbackKey
    : FIXTURE_METRIC_CONFIG_DEFAULT.mode;
}

function normalizeFixtureMetricKey(value, fallback = FIXTURE_METRIC_CONFIG_DEFAULT.metric) {
  const key = String(value || "").trim().toLowerCase();
  if (FIXTURE_METRIC_KEYS.includes(key)) return key;
  const fallbackKey = String(fallback || "").trim().toLowerCase();
  return FIXTURE_METRIC_KEYS.includes(fallbackKey)
    ? fallbackKey
    : FIXTURE_METRIC_CONFIG_DEFAULT.metric;
}

function normalizeFixtureMetricHarmonySize(value, fallback = FIXTURE_METRIC_CONFIG_DEFAULT.harmonySize) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return Math.max(
      FIXTURE_METRIC_HARMONY_MIN,
      Math.min(FIXTURE_METRIC_HARMONY_MAX, Math.round(parsed))
    );
  }
  const fallbackParsed = Number(fallback);
  if (Number.isFinite(fallbackParsed)) {
    return Math.max(
      FIXTURE_METRIC_HARMONY_MIN,
      Math.min(FIXTURE_METRIC_HARMONY_MAX, Math.round(fallbackParsed))
    );
  }
  return FIXTURE_METRIC_CONFIG_DEFAULT.harmonySize;
}

function normalizeFixtureMetricMaxHz(value, fallback = FIXTURE_METRIC_CONFIG_DEFAULT.maxHz) {
  const parseValue = input => {
    if (input === undefined) return { ok: false, value: null };
    if (input === null) return { ok: true, value: null };
    if (typeof input === "string") {
      const raw = input.trim().toLowerCase();
      if (!raw) return { ok: true, value: null };
      if (
        raw === "off" ||
        raw === "none" ||
        raw === "null" ||
        raw === "unclamped" ||
        raw === "unclamp" ||
        raw === "disabled"
      ) {
        return { ok: true, value: null };
      }
    }
    const parsed = Number(input);
    if (!Number.isFinite(parsed) || parsed <= 0) return { ok: false, value: null };
    const clamped = Math.max(
      FIXTURE_METRIC_MAX_HZ_MIN,
      Math.min(FIXTURE_METRIC_MAX_HZ_MAX, parsed)
    );
    return { ok: true, value: Math.round(clamped * 10) / 10 };
  };

  const primary = parseValue(value);
  if (primary.ok) return primary.value;
  const fallbackValue = parseValue(fallback);
  return fallbackValue.ok ? fallbackValue.value : null;
}

function normalizeFixtureMetricConfigSnapshot(source = {}, fallback = FIXTURE_METRIC_CONFIG_DEFAULT) {
  const raw = source && typeof source === "object" ? source : {};
  const safeFallback = fallback && typeof fallback === "object"
    ? fallback
    : FIXTURE_METRIC_CONFIG_DEFAULT;
  const mode = normalizeFixtureMetricMode(raw.mode, safeFallback.mode);
  let metric = normalizeFixtureMetricKey(raw.metric, safeFallback.metric);
  let metaAutoFlip = Object.prototype.hasOwnProperty.call(raw, "metaAutoFlip")
    ? parseBooleanLoose(raw.metaAutoFlip, Boolean(safeFallback.metaAutoFlip))
    : Boolean(safeFallback.metaAutoFlip);
  let harmonySize = normalizeFixtureMetricHarmonySize(raw.harmonySize, safeFallback.harmonySize);
  const maxHz = normalizeFixtureMetricMaxHz(raw.maxHz, safeFallback.maxHz);

  if (mode !== "meta_auto") {
    // Manual mode overrules meta-auto-only controls.
    metaAutoFlip = false;
    harmonySize = FIXTURE_METRIC_CONFIG_DEFAULT.harmonySize;
  } else {
    // In meta-auto mode, manual metric selection is not used.
    metric = FIXTURE_METRIC_CONFIG_DEFAULT.metric;
  }

  return {
    mode,
    metric,
    metaAutoFlip,
    harmonySize,
    maxHz
  };
}

function sanitizeFixtureMetricRoutingConfig(input = {}) {
  const raw = input && typeof input === "object" ? input : {};
  const globalSource = raw.config && typeof raw.config === "object" && !Array.isArray(raw.config)
    ? raw.config
    : raw;
  const config = normalizeFixtureMetricConfigSnapshot(
    globalSource,
    FIXTURE_METRIC_CONFIG_DEFAULT
  );

  const rawBrands = raw.brands && typeof raw.brands === "object" && !Array.isArray(raw.brands)
    ? raw.brands
    : {};
  const brands = {};
  for (const brand of PALETTE_SUPPORTED_BRANDS) {
    const entry = rawBrands[brand];
    brands[brand] = entry && typeof entry === "object" && !Array.isArray(entry)
      ? normalizeFixtureMetricConfigSnapshot(entry, config)
      : null;
  }

  const rawFixtures = raw.fixtures && typeof raw.fixtures === "object" && !Array.isArray(raw.fixtures)
    ? raw.fixtures
    : {};
  const fixtures = {};
  for (const [rawId, rawConfig] of Object.entries(rawFixtures)) {
    const fixtureId = String(rawId || "").trim();
    if (!fixtureId || fixtureId.length > 128) continue;
    if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) continue;
    const brand = normalizePaletteBrandKey(rawConfig.brand);
    const fallback = brand && brands[brand] ? brands[brand] : config;
    fixtures[fixtureId] = normalizeFixtureMetricConfigSnapshot(rawConfig, fallback);
  }

  return {
    version: 1,
    config,
    brands,
    fixtures
  };
}

function readFixtureMetricRoutingConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FIXTURE_METRIC_ROUTING_CONFIG_PATH, "utf8"));
    return sanitizeFixtureMetricRoutingConfig(parsed);
  } catch {
    return sanitizeFixtureMetricRoutingConfig(FIXTURE_METRIC_ROUTING_DEFAULT);
  }
}

function writeFixtureMetricRoutingConfig(config) {
  const safe = sanitizeFixtureMetricRoutingConfig(config);
  fs.mkdirSync(path.dirname(FIXTURE_METRIC_ROUTING_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(FIXTURE_METRIC_ROUTING_CONFIG_PATH, `${JSON.stringify(safe, null, 2)}\n`, "utf8");
  return safe;
}

let systemConfigRuntime = readSystemConfig();
setUnsafeExposeSensitiveLogsRuntime(Boolean(systemConfigRuntime?.unsafeExposeSensitiveLogs));
console.log(
  `[SYSTEM] config loaded (autoLaunchBrowser=${systemConfigRuntime.autoLaunchBrowser}, ` +
  `delayMs=${systemConfigRuntime.browserLaunchDelayMs}, ` +
  `unsafeExposeSensitiveLogs=${Boolean(systemConfigRuntime.unsafeExposeSensitiveLogs)}, ` +
  `hueTransportPreference=${sanitizeHueTransportPreference(systemConfigRuntime.hueTransportPreference)})`
);
const standaloneStateConfigRuntime = readStandaloneStateConfig();
console.log(
  `[STANDALONE] state loaded (${Object.keys(standaloneStateConfigRuntime.fixtures).length} fixtures)`
);
let paletteFixtureOverridesRuntime = readPaletteFixtureOverridesConfig();
console.log(
  `[PALETTE] fixture overrides loaded (${Object.keys(paletteFixtureOverridesRuntime.fixtures).length} fixtures)`
);
let fixtureMetricRoutingRuntime = readFixtureMetricRoutingConfig();
console.log(
  `[METRICS] fixture routing loaded (${Object.keys(fixtureMetricRoutingRuntime.fixtures).length} fixture overrides)`
);
const initialAudioRuntimeConfig = readAudioRuntimeConfig();
if (initialAudioRuntimeConfig) {
  console.log(`[AUDIO] runtime config loaded (${Object.keys(initialAudioRuntimeConfig).length} keys)`);
}

function isHueLinkButtonPending(err) {
  const type = Number(err?.type);
  if (type === 101) return true;
  const msg = stringifyHueError(err).toLowerCase();
  return (
    msg.includes("link button") ||
    msg.includes("linkbutton") ||
    msg.includes("not pressed") ||
    msg.includes("type=101")
  );
}

async function fetchHueBridgeConfigByIp(ip, bridgeIdHint = "") {
  const target = normalizeHueBridgeIp(ip);
  if (!target || !isPrivateHueBridgeIp(target)) return null;
  const bridgeId = normalizeHueBridgeIdToken(bridgeIdHint);
  if (bridgeId) {
    rememberHueBridgeIdentity(target, bridgeId);
  }
  try {
    const bridgeConfigUrl = new URL("/api/0/config", `https://${target}`);
    const { data } = await axios.get(bridgeConfigUrl.toString(), {
      timeout: 1800,
      maxRedirects: 0,
      httpsAgent: getHueRestHttpsAgent({
        bridgeIp: target,
        bridgeId
      })
    });
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

// ======================================================
// EXPRESS
// ======================================================
const app = express();
const MUTATING_HTTP_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const ALLOW_REMOTE_WRITE_RUNTIME = String(process.env.RAVELINK_ALLOW_REMOTE_WRITE || "").trim() === "1";
const ALLOW_REMOTE_MOD_WRITE_RUNTIME =
  String(process.env.RAVELINK_ALLOW_REMOTE_MOD_WRITE || "").trim() === "1";
const ALLOW_REMOTE_PRIVILEGED_READ_RUNTIME =
  String(process.env.RAVELINK_ALLOW_REMOTE_PRIVILEGED_READ || "").trim() === "1";
const ENABLE_LEGACY_COLOR_GET_RUNTIME =
  String(process.env.RAVELINK_ENABLE_LEGACY_COLOR_GET || "").trim() === "1";
const LOOPBACK_HOST_ALIASES = new Set(["127.0.0.1", "localhost", "::1"]);
const PRIVILEGED_READ_ROUTES = new Set([
  "/fixtures",
  "/fixtures/config",
  "/fixtures/connectivity",
  "/hue/discover",
  "/audio/devices"
]);
const jsonParserDefault = express.json({ limit: "2mb", strict: true });
const jsonParserLarge = express.json({ limit: "22mb", strict: true });

function splitHostPort(rawHostHeader = "") {
  const raw = String(rawHostHeader || "").trim();
  if (!raw) return { host: "", port: 0 };
  if (raw.startsWith("[")) {
    const match = raw.match(/^\[([^\]]+)\](?::(\d{1,5}))?$/);
    if (!match) return { host: "", port: 0 };
    const host = String(match[1] || "").trim().toLowerCase();
    const port = Number(match[2] || 0);
    return { host, port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0 };
  }
  const parts = raw.split(":");
  if (parts.length === 1) {
    return { host: raw.toLowerCase(), port: 0 };
  }
  const maybePort = Number(parts[parts.length - 1] || 0);
  if (Number.isInteger(maybePort) && maybePort > 0 && maybePort <= 65535) {
    const host = parts.slice(0, -1).join(":").trim().toLowerCase();
    return { host, port: maybePort };
  }
  return { host: raw.toLowerCase(), port: 0 };
}

function isLoopbackHostToken(host = "") {
  const key = String(host || "").trim().toLowerCase();
  return LOOPBACK_HOST_ALIASES.has(key);
}

function normalizeOriginPort(parsedOrigin) {
  const explicit = Number(parsedOrigin?.port || 0);
  if (Number.isInteger(explicit) && explicit > 0 && explicit <= 65535) {
    return explicit;
  }
  return parsedOrigin?.protocol === "https:" ? 443 : 80;
}

function validateBrowserOrigin(req) {
  const origin = String(req.headers.origin || "").trim();
  if (!origin) {
    return { ok: true, allowOrigin: "" };
  }
  if (origin === "null") {
    const loopback = isLoopbackRequest(req);
    return {
      ok: loopback,
      allowOrigin: loopback ? "null" : "",
      reason: "null origin blocked for non-loopback client"
    };
  }

  let parsedOrigin = null;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return { ok: false, allowOrigin: "", reason: "invalid origin header" };
  }

  if (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") {
    return { ok: false, allowOrigin: "", reason: "origin protocol not allowed" };
  }

  const requestHost = splitHostPort(req.headers.host || "");
  const originHost = String(parsedOrigin.hostname || "").trim().toLowerCase();
  const originPort = normalizeOriginPort(parsedOrigin);
  const requestPort = requestHost.port || PORT;
  const requestHostName = String(requestHost.host || "").trim().toLowerCase();
  const requestIsLoopback = isLoopbackRequest(req);

  const sameHost = Boolean(
    requestHostName &&
    originHost &&
    requestHostName === originHost &&
    requestPort === originPort
  );
  const loopbackAliasMatch = Boolean(
    isLoopbackHostToken(requestHostName) &&
    isLoopbackHostToken(originHost) &&
    requestPort === originPort
  );

  if (!sameHost && !loopbackAliasMatch) {
    if (requestIsLoopback || ALLOW_REMOTE_WRITE_RUNTIME) {
      return { ok: true, allowOrigin: origin };
    }
    return {
      ok: false,
      allowOrigin: "",
      reason: "cross-origin request blocked"
    };
  }

  return { ok: true, allowOrigin: origin };
}

function getFetchSiteHeader(req) {
  return String(req.headers["sec-fetch-site"] || "").trim().toLowerCase();
}

function isCrossSiteBrowserRequest(req) {
  return getFetchSiteHeader(req) === "cross-site";
}

function isPrivilegedReadRoute(pathname = "") {
  const route = String(pathname || "").trim();
  if (!route) return false;
  if (PRIVILEGED_READ_ROUTES.has(route)) return true;
  return false;
}

function canReadPrivilegedRoute(req) {
  return (
    ALLOW_REMOTE_PRIVILEGED_READ_RUNTIME ||
    ALLOW_REMOTE_WRITE_RUNTIME ||
    isLoopbackRequest(req)
  );
}

app.disable("x-powered-by");
app.set("etag", false);
app.use((req, res, next) => {
  const originValidation = validateBrowserOrigin(req);
  const loopbackRequest = isLoopbackRequest(req);
  const allowCrossSiteMutatingRequest = ALLOW_REMOTE_WRITE_RUNTIME || loopbackRequest;
  if (originValidation.allowOrigin) {
    res.setHeader("Access-Control-Allow-Origin", originValidation.allowOrigin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,PUT,PATCH,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Requested-With");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
  );

  if (req.method === "OPTIONS") {
    if (!originValidation.ok && !allowCrossSiteMutatingRequest) {
      res.status(403).json({ ok: false, error: "untrusted_origin", detail: originValidation.reason });
      return;
    }
    res.sendStatus(204);
    return;
  }

  if (
    isCrossSiteBrowserRequest(req) &&
    MUTATING_HTTP_METHODS.has(req.method) &&
    !allowCrossSiteMutatingRequest
  ) {
    res.status(403).json({
      ok: false,
      error: "cross_site_blocked",
      detail: "cross-site browser requests are blocked for control routes"
    });
    return;
  }

  if (!originValidation.ok && MUTATING_HTTP_METHODS.has(req.method) && !allowCrossSiteMutatingRequest) {
    res.status(403).json({ ok: false, error: "untrusted_origin", detail: originValidation.reason });
    return;
  }
  next();
});
app.use((req, res, next) => {
  const parser = req.path === "/mods/import" ? jsonParserLarge : jsonParserDefault;
  parser(req, res, next);
});
app.use((err, req, res, next) => {
  if (!err) {
    next();
    return;
  }
  if (err.type === "entity.too.large") {
    res.status(413).json({ ok: false, error: "payload too large" });
    return;
  }
  if (err instanceof SyntaxError && err.status === 400 && Object.prototype.hasOwnProperty.call(err, "body")) {
    res.status(400).json({ ok: false, error: "invalid json payload" });
    return;
  }
  next(err);
});
app.use(express.static(path.join(__dirname, "public"), {
  dotfiles: "ignore",
  etag: false,
  maxAge: 0
}));

function getRequestClientIp(req) {
  return String(
    req?.socket?.remoteAddress ||
    req?.ip ||
    "unknown"
  ).trim() || "unknown";
}

function createIpRateLimiter({ windowMs = 60000, max = 60, bucket = "default" } = {}) {
  const windowSizeMs = Math.max(1000, Number(windowMs) || 60000);
  const maxHits = Math.max(1, Number(max) || 1);
  const hits = new Map();

  const sweepIntervalMs = Math.max(5000, Math.min(windowSizeMs, 60000));
  const sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (!entry || entry.expiresAt <= now) hits.delete(key);
    }
  }, sweepIntervalMs);
  sweepTimer.unref?.();

  return (req, res, next) => {
    const now = Date.now();
    const key = `${bucket}:${getRequestClientIp(req)}`;
    let entry = hits.get(key);
    if (!entry || entry.expiresAt <= now) {
      entry = { count: 0, expiresAt: now + windowSizeMs };
      hits.set(key, entry);
    }

    entry.count += 1;
    if (entry.count > maxHits) {
      const retryAfterSec = Math.max(1, Math.ceil((entry.expiresAt - now) / 1000));
      res.set("Retry-After", String(retryAfterSec));
      res.status(429).json({
        ok: false,
        error: "rate limit exceeded",
        bucket,
        retryAfterSec
      });
      return;
    }
    next();
  };
}

const docsReadmeRateLimit = createIpRateLimiter({
  windowMs: 10000,
  max: 24,
  bucket: "docs_mods_readme"
});
const modUiAssetRateLimit = createIpRateLimiter({
  windowMs: 10000,
  max: 240,
  bucket: "mods_ui_assets"
});
const modsImportRateLimit = createIpRateLimiter({
  windowMs: 60000,
  max: 6,
  bucket: "mods_import"
});
const modsConfigRateLimit = createIpRateLimiter({
  windowMs: 60000,
  max: 24,
  bucket: "mods_config"
});
const modsImportRateLimitStrict = expressRateLimit({
  windowMs: 60000,
  limit: 6,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: req => getRequestClientIp(req),
  handler: (_req, res) => {
    res.status(429).json({
      ok: false,
      error: "rate limit exceeded",
      bucket: "mods_import"
    });
  }
});
const modsConfigRateLimitStrict = expressRateLimit({
  windowMs: 60000,
  limit: 24,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: req => getRequestClientIp(req),
  handler: (_req, res) => {
    res.status(429).json({
      ok: false,
      error: "rate limit exceeded",
      bucket: "mods_config"
    });
  }
});
const modsReadRateLimit = createIpRateLimiter({
  windowMs: 10000,
  max: 120,
  bucket: "mods_read"
});
const modsHookInvokeRateLimit = createIpRateLimiter({
  windowMs: 15000,
  max: 40,
  bucket: "mods_hooks"
});
const modsUiCatalogRateLimit = createIpRateLimiter({
  windowMs: 10000,
  max: 60,
  bucket: "mods_ui_catalog"
});
const modsReloadRateLimit = createIpRateLimiter({
  windowMs: 60000,
  max: 12,
  bucket: "mods_reload"
});
const apiWriteRateLimit = createIpRateLimiter({
  windowMs: 10000,
  max: 90,
  bucket: "api_write"
});
const hueDiscoverRateLimit = createIpRateLimiter({
  windowMs: 60000,
  max: 12,
  bucket: "hue_discover"
});
const huePairRateLimit = createIpRateLimiter({
  windowMs: 60000,
  max: 6,
  bucket: "hue_pair"
});
const hueTransportRateLimit = createIpRateLimiter({
  windowMs: 15000,
  max: 24,
  bucket: "hue_transport"
});
const fixturesConnectivityRateLimit = createIpRateLimiter({
  windowMs: 15000,
  max: 24,
  bucket: "fixtures_connectivity"
});
const audioDevicesRateLimit = createIpRateLimiter({
  windowMs: 10000,
  max: 20,
  bucket: "audio_devices"
});
const audioAppsRateLimit = createIpRateLimiter({
  windowMs: 10000,
  max: 24,
  bucket: "audio_apps"
});
const audioRestartRateLimit = createIpRateLimiter({
  windowMs: 30000,
  max: 8,
  bucket: "audio_restart"
});
const audioAppScanRateLimit = createIpRateLimiter({
  windowMs: 30000,
  max: 12,
  bucket: "audio_app_scan"
});
const fixturesReadRateLimit = createIpRateLimiter({
  windowMs: 10000,
  max: 24,
  bucket: "fixtures_read"
});
const standaloneStateRateLimit = createIpRateLimiter({
  windowMs: 10000,
  max: 40,
  bucket: "standalone_state"
});
const modsHttpRouteRateLimit = createIpRateLimiter({
  windowMs: 10000,
  max: 80,
  bucket: "mods_http_route"
});

app.use((req, res, next) => {
  if (!MUTATING_HTTP_METHODS.has(req.method)) {
    next();
    return;
  }
  apiWriteRateLimit(req, res, next);
});

app.use((req, res, next) => {
  if (!MUTATING_HTTP_METHODS.has(req.method)) {
    next();
    return;
  }
  if (ALLOW_REMOTE_WRITE_RUNTIME || isLoopbackRequest(req)) {
    next();
    return;
  }
  res.status(403).json({
    ok: false,
    error: "forbidden",
    detail: "mutating API routes are restricted to local loopback requests"
  });
});
app.use((req, res, next) => {
  if (req.method !== "GET") {
    next();
    return;
  }
  if (!isPrivilegedReadRoute(req.path)) {
    next();
    return;
  }
  if (canReadPrivilegedRoute(req)) {
    next();
    return;
  }
  res.status(403).json({
    ok: false,
    error: "forbidden",
    detail: "privileged read routes are restricted to local loopback requests"
  });
});

const MODS_README_MAX_BYTES = 2 * 1024 * 1024;
let modsReadmeCache = { loaded: false, mtimeMs: 0, body: "" };

function readModsReadmeCached() {
  const stat = fs.statSync(MODS_README_PATH);
  if (!stat.isFile()) {
    throw new Error("mods readme unavailable");
  }
  if (stat.size > MODS_README_MAX_BYTES) {
    throw new Error("mods readme exceeds 2MB");
  }
  const mtimeMs = Number(stat.mtimeMs || 0);
  if (modsReadmeCache.loaded && modsReadmeCache.mtimeMs === mtimeMs) {
    return modsReadmeCache.body;
  }

  const body = fs.readFileSync(MODS_README_PATH, "utf8");
  modsReadmeCache = {
    loaded: true,
    mtimeMs,
    body
  };
  return body;
}

app.get("/docs/mods/readme", docsReadmeRateLimit, (_, res) => {
  try {
    const markdown = readModsReadmeCached();
    res.set("Cache-Control", "no-store");
    res.type("text/markdown; charset=utf-8");
    res.send(markdown);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: "mods readme unavailable",
      detail: redactErrorForLog(err, "read failed")
    });
  }
});

// ======================================================
// HUE PIPELINE (SCHEDULED + SERIALIZED)
// ======================================================
const hueSchedulers = new Map();
const hueInFlightZones = new Set();
const pendingHueStateByZone = new Map();
const pendingHueSyncStateByZone = new Map();
let hueNoTargetLogAt = 0;
let wizNoTargetLogAt = 0;

const hueTelemetry = {
  sent: 0,
  sentRest: 0,
  sentEntertainment: 0,
  skippedScheduler: 0,
  skippedInflight: 0,
  skippedSyncHold: 0,
  skippedNoTargets: 0,
  inflight: false,
  lastDurationMs: 0
};

const HUE_TRANSPORT = {
  REST: "rest",
  ENTERTAINMENT: "entertainment"
};

function getHueTransportPreferenceRuntime() {
  return sanitizeHueTransportPreference(
    systemConfigRuntime?.hueTransportPreference,
    SYSTEM_CONFIG_DEFAULT.hueTransportPreference
  );
}

function getPreferredHueTransportMode() {
  return getHueTransportPreferenceRuntime() === HUE_TRANSPORT_PREFERENCE.REST
    ? HUE_TRANSPORT.REST
    : HUE_TRANSPORT.ENTERTAINMENT;
}

const hueTransport = {
  desired: HUE_TRANSPORT.ENTERTAINMENT,
  active: HUE_TRANSPORT.REST,
  fallbackReason: null,
  switches: 0,
  errors: 0
};
let hueRecoveryInFlight = false;
let hueRecoveryNextAt = 0;
let hueRecoveryTimer = null;
const HUE_RECOVERY_COOLDOWN_MS = 3000;
const HUE_RECOVERY_MAX_COOLDOWN_MS = 60000;
const HUE_RECOVERY_TIMEOUT_BACKOFF_MS = 30000;
const HUE_RECOVERY_TIMEOUT_SUPPRESS_STREAK = 2;
const HUE_RECOVERY_FAST_RETRY_STREAK_LIMIT = 1;
const HUE_RECOVERY_START_DELAY_MS = 300;
const HUE_RECOVERY_SOCKET_START_DELAY_MS = 1400;
const HUE_ENT_MODE_SWITCH_TIMEOUT_MS = 12000;
const HUE_REST_MODE_SWITCH_TIMEOUT_MS = 2200;
const HUE_RECOVERY_SUPPRESS_LOG_INTERVAL_MS = 15000;
const HUE_ENT_HARD_FAIL_ESCALATE_STREAK = 5;
const HUE_ENT_HARD_FAIL_STREAK_WINDOW_MS = 3500;
const HUE_ENT_CONNECT_GRACE_MS = 12000;
let hueRecoveryFailStreak = 0;
let hueRecoveryTimeoutStreak = 0;
let hueRecoveryLastPendingReason = "";
let hueRecoveryLastPendingLogAt = 0;
let hueTransportOp = Promise.resolve();
let hueTransportRequestSeq = 0;
let hueTransportPendingMode = null;
let hueTransportPendingPromise = null;
let hueEntertainmentHardFailStreak = 0;
let hueEntertainmentLastHardFailAt = 0;
let hueEntertainmentConnectedAt = 0;
let hueRecoverySuppressedByTimeout = false;
let hueRecoverySuppressedReason = "";
let hueRecoverySuppressedAt = 0;
let hueRecoverySuppressedLogAt = 0;

// [TITLE] Section: Hardware Rate Capability Guard
const TRANSPORT_RATE_CAPS = Object.freeze({
  hue: Object.freeze({
    rest: Object.freeze({
      defaultMs: 220,
      safeMinMs: 150,
      safeMaxMs: 460,
      unsafeMinMs: 120,
      unsafeMaxMs: 1200,
      maxSilenceMs: 900
    }),
    entertainment: Object.freeze({
      defaultMs: 96,
      safeMinMs: 76,
      safeMaxMs: 260,
      unsafeMinMs: 40,
      unsafeMaxMs: 600,
      maxSilenceMs: 620
    })
  }),
  wiz: Object.freeze({
    default: Object.freeze({
      defaultMs: 120,
      safeMinMs: 102,
      safeMaxMs: 320,
      unsafeMinMs: 45,
      unsafeMaxMs: 600,
      maxSilenceMs: 760
    })
  })
});
const HUE_REST_SINGLE_FIXTURE_SAFE_MIN_MS = 170;
const HUE_REST_FAST_TRANSITION_RATE_MS = 190;
const HUE_REST_MEDIUM_TRANSITION_RATE_MS = 280;
const HUE_REST_SLOW_TRANSITION_RATE_MS = 420;
const WIZ_SINGLE_FIXTURE_SAFE_MIN_MS = 92;
const WIZ_FANOUT_SAFE_MIN_MS = 100;

function areHardwareRateLimitsEnabled() {
  return audioReactivityMapRuntime?.hardwareRateLimitsEnabled !== false;
}

function clampIntervalMsForProfile(rawMs, profile, overrides = {}) {
  const safeProfile = profile && typeof profile === "object"
    ? profile
    : TRANSPORT_RATE_CAPS.wiz.default;
  const enforceSafe = areHardwareRateLimitsEnabled();
  const overrideSafeMin = Number(overrides.safeMinMs);
  const overrideSafeMax = Number(overrides.safeMaxMs);
  const safeMinMs = Number.isFinite(overrideSafeMin) && overrideSafeMin > 0
    ? overrideSafeMin
    : Number(safeProfile.safeMinMs || safeProfile.defaultMs || 80);
  const safeMaxMs = Number.isFinite(overrideSafeMax) && overrideSafeMax > 0
    ? overrideSafeMax
    : Number(safeProfile.safeMaxMs || safeProfile.defaultMs || 600);
  const minMs = enforceSafe
    ? safeMinMs
    : Number(safeProfile.unsafeMinMs || safeProfile.safeMinMs || 40);
  const maxMs = enforceSafe
    ? safeMaxMs
    : Number(safeProfile.unsafeMaxMs || safeProfile.safeMaxMs || 1200);

  const seed = Number(rawMs);
  const fallback = Number(safeProfile.defaultMs || minMs);
  const base = Number.isFinite(seed) && seed > 0 ? seed : fallback;
  const bounded = Math.max(Math.min(base, maxMs), minMs);
  return Math.max(1, Math.round(bounded));
}

function getHueRateProfileForActiveTransport() {
  return hueTransport.active === HUE_TRANSPORT.ENTERTAINMENT
    ? TRANSPORT_RATE_CAPS.hue.entertainment
    : TRANSPORT_RATE_CAPS.hue.rest;
}

function getHueRestAdaptiveSafeMinMs(zone = "hue") {
  const zoneKey = normalizeRouteZoneToken(zone, "hue");
  const targets = listEngineFixtures("hue", zoneKey);
  return targets.length <= 1
    ? HUE_REST_SINGLE_FIXTURE_SAFE_MIN_MS
    : Number(TRANSPORT_RATE_CAPS.hue.rest.safeMinMs || 170);
}

function shouldForceHueRestScheduling(zone = "hue") {
  const zoneKey = normalizeRouteZoneToken(zone, "hue");
  const hueTargets = listEngineFixtures("hue", zoneKey);
  for (const target of hueTargets) {
    const fixtureId = String(target?.id || "").trim();
    if (!fixtureId) continue;
    if (getFixturePaletteOverrideConfig(fixtureId, "hue")) return true;
    if (hasFixtureMetricRoutingActiveConfig(fixtureId, "hue")) return true;
  }
  return false;
}

function getWizAdaptiveSafeMinMs(zone = "wiz") {
  const zoneKey = normalizeRouteZoneToken(zone, "wiz");
  const targets = listEngineFixtures("wiz", zoneKey);
  if (targets.length <= 1) {
    return WIZ_SINGLE_FIXTURE_SAFE_MIN_MS;
  }
  if (targets.length >= 7) {
    return WIZ_FANOUT_SAFE_MIN_MS;
  }
  return Number(TRANSPORT_RATE_CAPS.wiz.default.safeMinMs || 85);
}

function buildHueScheduleOptions(options = {}, zone = "hue") {
  const input = options && typeof options === "object" ? options : {};
  const forceRestProfile = input.forceRestProfile === true;
  const useRestProfile = forceRestProfile || hueTransport.active === HUE_TRANSPORT.REST;
  const profile = useRestProfile
    ? TRANSPORT_RATE_CAPS.hue.rest
    : TRANSPORT_RATE_CAPS.hue.entertainment;
  const adaptiveSafeMinMs = useRestProfile
    ? getHueRestAdaptiveSafeMinMs(zone)
    : Number(profile.safeMinMs || profile.defaultMs || 80);
  const minIntervalMs = clampIntervalMsForProfile(
    input.minIntervalMs,
    profile,
    { safeMinMs: adaptiveSafeMinMs }
  );
  const rawMaxSilence = Number(input.maxSilenceMs);
  const fallbackMaxSilence = Number(profile.maxSilenceMs || (minIntervalMs * 4));
  const maxSilenceMs = Math.max(
    minIntervalMs,
    Math.round(
      Number.isFinite(rawMaxSilence) && rawMaxSilence > 0
        ? rawMaxSilence
        : fallbackMaxSilence
    )
  );
  return {
    ...input,
    minIntervalMs,
    maxSilenceMs
  };
}

function tuneHueRestTransitionForLatency(state, effectiveRateMs = 260, options = {}) {
  const source = state && typeof state === "object" ? state : null;
  if (!source) return source;
  if (hueTransport.active !== HUE_TRANSPORT.REST) return source;
  if (source.on === false) return source;
  const flowMode = Boolean(options && options.flowMode);

  const current = Number(source.transitiontime);
  if (!Number.isFinite(current)) return source;

  let cap = Math.max(0, Math.round(current));
  if (effectiveRateMs <= HUE_REST_FAST_TRANSITION_RATE_MS) cap = 1;
  else if (effectiveRateMs <= HUE_REST_MEDIUM_TRANSITION_RATE_MS) cap = 1;
  else if (effectiveRateMs <= HUE_REST_SLOW_TRANSITION_RATE_MS) cap = 2;
  if (flowMode) {
    if (effectiveRateMs <= HUE_REST_FAST_TRANSITION_RATE_MS) cap = Math.max(cap, 1);
    else if (effectiveRateMs <= HUE_REST_MEDIUM_TRANSITION_RATE_MS) cap = Math.max(cap, 2);
    else cap = Math.max(cap, 3);
  }

  const nextTransition = Math.max(0, Math.min(Math.round(current), cap));
  if (nextTransition === Math.round(current)) return source;
  return {
    ...source,
    transitiontime: nextTransition
  };
}

function buildWizScheduleOptions(options = {}, zone = "wiz") {
  const input = options && typeof options === "object" ? options : {};
  const profile = TRANSPORT_RATE_CAPS.wiz.default;
  const minIntervalMs = clampIntervalMsForProfile(
    input.minIntervalMs,
    profile,
    { safeMinMs: getWizAdaptiveSafeMinMs(zone) }
  );
  const rawMaxSilence = Number(input.maxSilenceMs);
  const fallbackMaxSilence = Number(profile.maxSilenceMs || (minIntervalMs * 4));
  const maxSilenceMs = Math.max(
    minIntervalMs,
    Math.round(
      Number.isFinite(rawMaxSilence) && rawMaxSilence > 0
        ? rawMaxSilence
        : fallbackMaxSilence
    )
  );
  return {
    ...input,
    minIntervalMs,
    maxSilenceMs
  };
}

const hueEntertainment = createHueEntertainmentTransport({
  fixtureRegistry,
  log: console
});

function normalizeRouteZoneToken(value, fallback = "") {
  const token = String(value || "").trim().toLowerCase();
  return token || String(fallback || "").trim().toLowerCase();
}

function getCanonicalZoneFallback(brand, fallback = "custom") {
  const brandKey = String(brand || "").trim().toLowerCase();
  const canonical = CANONICAL_ROUTE_ZONE_BY_BRAND[brandKey];
  if (canonical) return canonical;
  const normalizedFallback = normalizeRouteZoneToken(fallback, "");
  return normalizedFallback || brandKey || "custom";
}

function getFixtureZoneAliases(fixture) {
  const aliases = new Set();
  if (!fixture || typeof fixture !== "object") return aliases;

  const brand = String(fixture.brand || "").trim().toLowerCase();
  const zone = normalizeRouteZoneToken(fixture.zone, getCanonicalZoneFallback(brand, "custom"));
  const customEnabled = parseBoolean(fixture.customEnabled, false);

  aliases.add(zone);
  aliases.add("all");
  aliases.add("*");
  if (brand) aliases.add(brand);

  if (brand === "hue") {
    aliases.add("hue");
    return aliases;
  }

  if (brand === "wiz") {
    aliases.add("wiz");
    if (customEnabled) aliases.add("custom");
    return aliases;
  }

  return aliases;
}

function fixtureMatchesRouteZone(fixture, zoneToken) {
  const requested = normalizeRouteZoneToken(zoneToken);
  if (!requested || requested === "all" || requested === "*") return true;
  return getFixtureZoneAliases(fixture).has(requested);
}

function listFixturesByModeScoped(mode, brand, zone, options = {}) {
  const requireConfigured = options.requireConfigured !== false;
  const modeKey = String(mode || "engine").trim().toLowerCase();
  const brandKey = String(brand || "").trim().toLowerCase();
  const zoneKey = normalizeRouteZoneToken(zone);

  let fixtures = [];
  const preferredMethod = FIXTURE_LIST_METHOD_BY_MODE[modeKey];
  if (preferredMethod && typeof fixtureRegistry[preferredMethod] === "function") {
    fixtures = fixtureRegistry[preferredMethod](brandKey, "", { requireConfigured });
  } else if (typeof fixtureRegistry.listBy === "function") {
    fixtures = fixtureRegistry.listBy(brandKey, "", { requireConfigured });
  }

  if (!zoneKey || zoneKey === "all" || zoneKey === "*") {
    return fixtures;
  }

  return fixtures.filter(fixture => fixtureMatchesRouteZone(fixture, zoneKey));
}

function listEngineFixtures(brand, zone) {
  return listFixturesByModeScoped("engine", brand, zone, { requireConfigured: true });
}

function listTwitchFixtures(brand, zone) {
  return listFixturesByModeScoped("twitch", brand, zone, { requireConfigured: true });
}

function listColorCommandFixtures(brand, zone) {
  const twitchFixtures = listTwitchFixtures(brand, zone);
  if (twitchFixtures.length || state.isLockedBy("rave")) {
    return twitchFixtures;
  }
  return listEngineFixtures(brand, zone);
}

function listCustomFixtures(brand, zone) {
  return listFixturesByModeScoped("custom", brand, zone, { requireConfigured: true });
}

function listEngineModeFixtures(brand, zone) {
  return listFixturesByModeScoped("engine", brand, zone, { requireConfigured: false });
}

function hasConfiguredHueEngineTargets() {
  return listEngineFixtures("hue").length > 0;
}

function logNoEngineTargets(kind, zone) {
  const now = Date.now();
  if (kind === "hue") {
    if ((now - hueNoTargetLogAt) < 5000) return;
    hueNoTargetLogAt = now;
  } else {
    if ((now - wizNoTargetLogAt) < 5000) return;
    wizNoTargetLogAt = now;
  }

  const candidates = listEngineModeFixtures(kind, zone);
  const configured = candidates.filter(isFixtureConfiguredForTransport);
  const cachedConnectivity = configured
    .map(fixture => fixtureConnectivityCache.get(String(fixture.id || "").trim()))
    .filter(Boolean);
  const reachable = cachedConnectivity.filter(item => item.status === "reachable").length;
  const unreachable = cachedConnectivity.filter(item => item.status === "unreachable").length;

  const reason = !candidates.length
    ? "no fixtures routed for this zone"
    : !configured.length
      ? "fixtures routed but not configured"
      : (reachable === 0 && unreachable > 0)
        ? "fixtures configured but unreachable (check IP/network)"
        : "fixtures routed but not configured";
  console.warn(`[${kind.toUpperCase()}] no engine targets (zone=${String(zone || getCanonicalZoneFallback(kind, "custom"))}) | ${reason}`);
}

function getHueScheduler(zone) {
  if (!hueSchedulers.has(zone)) {
    hueSchedulers.set(zone, createHueScheduler());
  }
  return hueSchedulers.get(zone);
}

function isHueEntertainmentSyncInProgress() {
  return (
    hueTransport.desired === HUE_TRANSPORT.ENTERTAINMENT &&
    hueTransportPendingMode === HUE_TRANSPORT.ENTERTAINMENT &&
    Boolean(hueTransportPendingPromise)
  );
}

async function flushHue(zone = "hue") {
  const pendingEntry = pendingHueStateByZone.get(zone);
  const pendingEnvelope = pendingEntry &&
    typeof pendingEntry === "object" &&
    !Array.isArray(pendingEntry) &&
    (
      Object.prototype.hasOwnProperty.call(pendingEntry, "state") ||
      Object.prototype.hasOwnProperty.call(pendingEntry, "fixtureStates") ||
      Object.prototype.hasOwnProperty.call(pendingEntry, "paletteIntent")
    );
  const pendingHueState = pendingEnvelope
    ? pendingEntry.state
    : pendingEntry;
  const fixtureStates = pendingEnvelope && pendingEntry.fixtureStates && typeof pendingEntry.fixtureStates === "object"
    ? pendingEntry.fixtureStates
    : null;
  const isInFlight = hueInFlightZones.has(zone);

  if (isInFlight || !pendingHueState) {
    if (isInFlight && pendingHueState) {
      hueTelemetry.skippedInflight++;
    }
    return;
  }

  const stateToSend = pendingHueState;
  pendingHueStateByZone.delete(zone);
  hueInFlightZones.add(zone);
  hueTelemetry.inflight = true;

  const start = Date.now();

  try {
    const hueTargets = listEngineFixtures("hue", zone);
    if (!hueTargets.length) return;

    const ops = [];
    for (const target of hueTargets) {
      const fixtureId = String(target?.id || "").trim();
      const fixtureState = fixtureId && fixtureStates && fixtureStates[fixtureId]
        ? fixtureStates[fixtureId]
        : stateToSend;
      const allowDispatch = shouldDispatchFixtureWithMetricHzClamp(
        fixtureId,
        "hue",
        zone,
        { forceSend: fixtureState?.on === false }
      );
      if (!allowDispatch) {
        hueTelemetry.skippedScheduler++;
        continue;
      }
      ops.push(
        axios.put(
          `https://${target.bridgeIp}/api/${target.username}/lights/${target.lightId}/state`,
          fixtureState,
          {
            timeout: 1500,
            httpsAgent: getHueRestHttpsAgent(target)
          }
        )
      );
    }
    if (!ops.length) return;
    const results = await Promise.allSettled(ops);
    for (const r of results) {
      if (r.status === "rejected") {
        console.error("[HUE] light send failed:", r.reason?.message || r.reason);
      }
    }

    hueTelemetry.sent++;
    hueTelemetry.sentRest++;
  } catch (err) {
    console.error("[HUE] send failed:", err.message || err);
  } finally {
    hueTelemetry.lastDurationMs = Date.now() - start;
    hueInFlightZones.delete(zone);
    hueTelemetry.inflight = hueInFlightZones.size > 0;

    if (pendingHueStateByZone.has(zone)) {
      setImmediate(() => flushHue(zone));
    }
  }
}

function sendHueViaEntertainment(state, zone = "hue", options = {}) {
  const hueTargets = listEngineFixtures("hue", zone);
  if (!hueTargets.length) {
    hueTelemetry.skippedNoTargets++;
    logNoEngineTargets("hue", zone);
    return;
  }

  const paletteIntent = options && typeof options === "object"
    ? options.paletteIntent
    : null;
  const fixtureStates = {};
  let hasFixtureOverrides = false;
  for (const target of hueTargets) {
    const fixtureId = String(target?.id || "").trim();
    if (!fixtureId) continue;
    const stateForFixture = applyFixturePaletteToHueState(state, target, paletteIntent);
    const hasMaxHzClamp = hasFixtureMetricMaxHzClamp(fixtureId, "hue");
    if (stateForFixture !== state || hasMaxHzClamp) {
      fixtureStates[fixtureId] = stateForFixture;
      hasFixtureOverrides = true;
    }
  }
  if (hasFixtureOverrides) {
    pendingHueStateByZone.set(zone, {
      state,
      fixtureStates,
      paletteIntent
    });
    flushHue(zone);
    return;
  }

  const start = Date.now();
  try {
    const uniqueHueCount = new Set(
      hueTargets.map(t => `${t.bridgeIp || "?"}:${Number(t.lightId || 0)}`)
    ).size;
    const entStatus = hueEntertainment.getStatus?.() || {};
    const channelCount = Math.max(
      1,
      Number(entStatus.channelCount || uniqueHueCount || hueTargets.length)
    );
    hueEntertainment.send(state, channelCount);
    hueEntertainmentHardFailStreak = 0;
    hueEntertainmentLastHardFailAt = 0;
    if (!(hueEntertainmentConnectedAt > 0)) hueEntertainmentConnectedAt = Date.now();
    hueTelemetry.sent++;
    hueTelemetry.sentEntertainment++;
    hueTelemetry.lastDurationMs = Date.now() - start;
  } catch (err) {
    const failureDetail = redactErrorForLog(err);
    const isHardFailure = isHueEntertainmentSendHardFailure(failureDetail);
    hueTransport.errors++;
    hueTransport.fallbackReason = failureDetail;

    if (isHardFailure) {
      const now = Date.now();
      const withinConnectGrace =
        hueEntertainmentConnectedAt > 0 &&
        (now - hueEntertainmentConnectedAt) < HUE_ENT_CONNECT_GRACE_MS;
      if (withinConnectGrace) {
        hueEntertainmentHardFailStreak = 0;
        hueEntertainmentLastHardFailAt = now;
        hueTransport.active = HUE_TRANSPORT.ENTERTAINMENT;
        console.warn(
          `[HUE][ENT] startup grace hard-send warning: ${hueTransport.fallbackReason}`
        );
        return;
      }
      if (
        !hueEntertainmentLastHardFailAt ||
        (now - hueEntertainmentLastHardFailAt) > HUE_ENT_HARD_FAIL_STREAK_WINDOW_MS
      ) {
        hueEntertainmentHardFailStreak = 1;
      } else {
        hueEntertainmentHardFailStreak += 1;
      }
      hueEntertainmentLastHardFailAt = now;

      if (hueEntertainmentHardFailStreak < HUE_ENT_HARD_FAIL_ESCALATE_STREAK) {
        // Absorb brief DTLS hiccups without transport flapping.
        hueTransport.active = HUE_TRANSPORT.ENTERTAINMENT;
        console.warn(
          `[HUE][ENT] transient hard send warning (${hueEntertainmentHardFailStreak}/${HUE_ENT_HARD_FAIL_ESCALATE_STREAK}): ${hueTransport.fallbackReason}`
        );
        return;
      }

      hueEntertainmentHardFailStreak = 0;
      hueEntertainmentLastHardFailAt = 0;
      hueEntertainmentConnectedAt = 0;
      console.warn(`[HUE][ENT] send fallback to REST: ${hueTransport.fallbackReason}`);
      hueTransport.active = HUE_TRANSPORT.REST;
      hueEntertainment.stop().catch(stopErr => {
        console.warn("[HUE][ENT] cleanup stop failed:", redactErrorForLog(stopErr));
      });
      forceHueEntertainmentRecovery("send_fallback");
      pendingHueStateByZone.set(zone, {
        state,
        fixtureStates: null,
        paletteIntent
      });
      flushHue(zone);
    } else {
      // Keep DTLS active on transient transition faults; drop only this frame.
      hueTransport.active = HUE_TRANSPORT.ENTERTAINMENT;
      console.warn(
        `[HUE][ENT] transient send warning (kept entertainment active): ${hueTransport.fallbackReason}`
      );
    }
  }
}

function flushHueSyncQueue() {
  if (!pendingHueSyncStateByZone.size) return;
  const queued = [...pendingHueSyncStateByZone.entries()];
  pendingHueSyncStateByZone.clear();

  if (hueTransport.active === HUE_TRANSPORT.ENTERTAINMENT) {
    for (const [zone, entry] of queued) {
      const envelope = entry && typeof entry === "object" && !Array.isArray(entry)
        ? entry
        : { state: entry };
      const fixtureStates = envelope.fixtureStates && typeof envelope.fixtureStates === "object"
        ? envelope.fixtureStates
        : null;
      if (fixtureStates && Object.keys(fixtureStates).length) {
        pendingHueStateByZone.set(zone, envelope);
        flushHue(zone);
      } else {
        sendHueViaEntertainment(envelope.state, zone, { paletteIntent: envelope.paletteIntent });
      }
    }
    return;
  }

  for (const [zone, entry] of queued) {
    pendingHueStateByZone.set(zone, entry);
    flushHue(zone);
  }
}

function enqueueHue(state, zone = "hue", options = {}) {
  const scheduler = getHueScheduler(zone);
  const forceRestProfile = shouldForceHueRestScheduling(zone);
  const scheduleOptions = buildHueScheduleOptions(
    { ...(options && typeof options === "object" ? options : {}), forceRestProfile },
    zone
  );

  if (!scheduler.shouldSend(state, scheduleOptions)) {
    hueTelemetry.skippedScheduler++;
    return;
  }

  const paletteIntent = scheduleOptions.paletteIntent;
  const hueTargets = listEngineFixtures("hue", zone);
  const fixtureStates = {};
  let hasFixtureOverrides = false;
  for (const target of hueTargets) {
    const fixtureId = String(target?.id || "").trim();
    if (!fixtureId) continue;
    const stateForFixture = applyFixturePaletteToHueState(state, target, paletteIntent);
    if (stateForFixture !== state) {
      fixtureStates[fixtureId] = stateForFixture;
      hasFixtureOverrides = true;
    }
  }

  const envelope = {
    state,
    fixtureStates: hasFixtureOverrides ? fixtureStates : null,
    paletteIntent
  };

  if (hueTransport.active === HUE_TRANSPORT.ENTERTAINMENT && !hasFixtureOverrides) {
    sendHueViaEntertainment(state, zone, { paletteIntent });
    return;
  }

  if (isHueEntertainmentSyncInProgress()) {
    hueTelemetry.skippedSyncHold++;
    pendingHueSyncStateByZone.set(zone, envelope);
    return;
  }

  scheduleHueEntertainmentRecovery("rest_emit");
  pendingHueStateByZone.set(zone, envelope);
  flushHue(zone);
}

async function setHueTransportMode(nextMode) {
  const requestedInput = nextMode === HUE_TRANSPORT.ENTERTAINMENT
    ? HUE_TRANSPORT.ENTERTAINMENT
    : HUE_TRANSPORT.REST;
  const requested = requestedInput === HUE_TRANSPORT.ENTERTAINMENT && !state.isLockedBy("rave")
    ? HUE_TRANSPORT.REST
    : requestedInput;
  if (hueTransportPendingPromise && hueTransportPendingMode === requested) {
    return hueTransportPendingPromise;
  }
  const requestSeq = ++hueTransportRequestSeq;
  hueTransport.desired = requested;
  const isSuperseded = () => requestSeq !== hueTransportRequestSeq;

  const applyRequestedMode = async () => {
    const previousActive = hueTransport.active;

    try {
      if (requested === HUE_TRANSPORT.REST) {
        await hueEntertainment.stop();
        hueTransport.active = HUE_TRANSPORT.REST;
        hueTransport.fallbackReason = null;
        hueEntertainmentConnectedAt = 0;
        hueEntertainmentHardFailStreak = 0;
        hueEntertainmentLastHardFailAt = 0;
      } else {
        if (isSuperseded()) {
          return {
            desired: hueTransport.desired,
            active: hueTransport.active,
            fallbackReason: hueTransport.fallbackReason
          };
        }
        const status = hueEntertainment.getStatus();
        const hasHueTargets = hasConfiguredHueEngineTargets();
        if (!hasHueTargets) {
          if (status.active) {
            await hueEntertainment.stop().catch(() => {});
          }
          hueTransport.active = HUE_TRANSPORT.REST;
          hueTransport.fallbackReason = "no configured Hue fixtures routed to ENGINE";
          hueEntertainmentConnectedAt = 0;
        } else if (!status.available) {
          hueTransport.active = HUE_TRANSPORT.REST;
          hueTransport.fallbackReason = sanitizeHueFallbackReason(
            status.reason,
            "entertainment driver unavailable"
          );
          hueEntertainmentConnectedAt = 0;
        } else if (!status.configured) {
          hueTransport.active = HUE_TRANSPORT.REST;
          hueTransport.fallbackReason =
            "missing bridgeIp/username/bridgeId/clientKey (fixture or env)";
          hueEntertainmentConnectedAt = 0;
        } else if (status.active) {
          hueTransport.active = HUE_TRANSPORT.ENTERTAINMENT;
          hueTransport.fallbackReason = null;
          hueEntertainmentConnectedAt = Date.now();
          hueEntertainmentHardFailStreak = 0;
          hueEntertainmentLastHardFailAt = 0;
          clearHueRecoveryTimeoutSuppression();
        } else {
          // Force a clean DTLS state before every (re)start attempt.
          await hueEntertainment.stop().catch(() => {});
          if (isSuperseded()) {
            return {
              desired: hueTransport.desired,
              active: hueTransport.active,
              fallbackReason: hueTransport.fallbackReason
            };
          }
          let result = await hueEntertainment.start();
          if (isSuperseded()) {
            await hueEntertainment.stop().catch(() => {});
            hueTransport.active = HUE_TRANSPORT.REST;
            hueTransport.fallbackReason = "transport request superseded";
            return {
              desired: hueTransport.desired,
              active: hueTransport.active,
              fallbackReason: hueTransport.fallbackReason
            };
          }

          if (result.ok) {
            hueTransport.active = HUE_TRANSPORT.ENTERTAINMENT;
            hueTransport.fallbackReason = null;
            hueEntertainmentConnectedAt = Date.now();
            hueEntertainmentHardFailStreak = 0;
            hueEntertainmentLastHardFailAt = 0;
            clearHueRecoveryTimeoutSuppression();
          } else {
            await hueEntertainment.stop().catch(() => {});
            hueTransport.active = HUE_TRANSPORT.REST;
            hueTransport.fallbackReason = sanitizeHueFallbackReason(
              result.reason,
              "entertainment start failed"
            );
            hueEntertainmentConnectedAt = 0;
            hueTransport.errors++;
          }
        }
      }
    } catch (err) {
      if (!isSuperseded()) {
        hueTransport.active = HUE_TRANSPORT.REST;
        hueTransport.fallbackReason = redactErrorForLog(err);
        hueEntertainmentConnectedAt = 0;
        hueTransport.errors++;
        console.warn("[HUE][ENT] mode switch failed:", hueTransport.fallbackReason);
      }
    }

    if (!isSuperseded() && hueTransport.active !== previousActive) {
      hueTransport.switches++;
    }

    return {
      desired: hueTransport.desired,
      active: hueTransport.active,
      fallbackReason: hueTransport.fallbackReason
    };
  };

  const nextOp = hueTransportOp.then(applyRequestedMode, applyRequestedMode);
  const trackedOp = nextOp.finally(() => {
    if (hueTransportPendingPromise === trackedOp) {
      hueTransportPendingMode = null;
      hueTransportPendingPromise = null;
    }
    flushHueSyncQueue();
  });
  hueTransportPendingMode = requested;
  hueTransportPendingPromise = trackedOp;
  hueTransportOp = trackedOp.catch(() => {});
  return trackedOp;
}

function cancelHueEntertainmentRecovery(reason = "manual") {
  if (hueRecoveryTimer) {
    clearTimeout(hueRecoveryTimer);
    hueRecoveryTimer = null;
  }
  hueRecoveryInFlight = false;
  hueRecoveryFailStreak = 0;
  hueRecoveryTimeoutStreak = 0;
  hueRecoveryLastPendingReason = "";
  hueRecoveryLastPendingLogAt = 0;
  hueRecoveryNextAt = Date.now() + HUE_RECOVERY_MAX_COOLDOWN_MS;
  if (reason) {
    console.log(`[HUE][ENT] recovery paused (${reason})`);
  }
}

function shouldUseHueRecoverySocketDelay(reason = "unspecified") {
  if (String(reason || "").trim().toLowerCase() === "send_fallback") return true;
  const fallback = String(hueTransport.fallbackReason || "").trim().toLowerCase();
  return (
    fallback.includes("socket is closed") ||
    fallback.includes("socket closed") ||
    fallback.includes("socket hang up") ||
    fallback.includes("econnreset") ||
    fallback.includes("broken pipe") ||
    fallback.includes("dtls connect timeout") ||
    fallback.includes("handshake timed out")
  );
}

function isHueEntertainmentSendHardFailure(message = "") {
  const lower = String(message || "").trim().toLowerCase();
  if (!lower) return false;
  return (
    lower.includes("socket is closed") ||
    lower.includes("socket closed") ||
    lower.includes("socket hang up") ||
    lower.includes("econnreset") ||
    lower.includes("broken pipe") ||
    lower.includes("entertainment stream inactive") ||
    lower.includes("entertainment bridge unavailable")
  );
}

function isHueRecoveryTimeoutFailure(message = "") {
  const lower = String(message || "").trim().toLowerCase();
  if (!lower) return false;
  return (
    lower.includes("dtls connect timeout") ||
    lower.includes("handshake timed out")
  );
}

function shouldUseHueRecoveryFastRetry(reason = "unspecified") {
  const token = String(reason || "").trim().toLowerCase();
  return (
    token === "send_fallback" ||
    token.includes("boot_sync")
  );
}

function isHueRecoverySuppressionBypassReason(reason = "unspecified") {
  const token = String(reason || "").trim().toLowerCase();
  return (
    token === "manual" ||
    token === "transport_route" ||
    token === "system_config" ||
    token.includes("boot_sync")
  );
}

function shouldSkipHueRecoveryReason(reason = "unspecified") {
  const token = String(reason || "").trim().toLowerCase();
  if (!token) return false;
  // While rave is running, avoid startup/background recovery loops
  // that can repeatedly trigger DTLS reconnect storms and visible flicker.
  if (state.isLockedBy?.("rave")) {
    if (token.includes("boot_sync")) return true;
    if (token === "rest_emit") return true;
    if (token === "reload") return true;
    if (token === "rave_off_idle") return true;
  }
  return false;
}

function clearHueRecoveryTimeoutSuppression() {
  hueRecoverySuppressedByTimeout = false;
  hueRecoverySuppressedReason = "";
  hueRecoverySuppressedAt = 0;
  hueRecoverySuppressedLogAt = 0;
}

function computeHueRecoveryCooldown(reason = "unspecified", failureDetail = "") {
  const timeoutFailure = isHueRecoveryTimeoutFailure(failureDetail);
  if (timeoutFailure) {
    hueRecoveryTimeoutStreak = Math.min(10, hueRecoveryTimeoutStreak + 1);
  } else {
    hueRecoveryTimeoutStreak = 0;
  }

  const fastRetry = shouldUseHueRecoveryFastRetry(reason) &&
    hueRecoveryFailStreak <= HUE_RECOVERY_FAST_RETRY_STREAK_LIMIT &&
    hueRecoveryTimeoutStreak <= 1;

  const expCooldown = Math.min(
    HUE_RECOVERY_MAX_COOLDOWN_MS,
    HUE_RECOVERY_COOLDOWN_MS * Math.pow(2, Math.min(5, hueRecoveryFailStreak - 1))
  );
  let cooldown = fastRetry ? HUE_RECOVERY_COOLDOWN_MS : expCooldown;

  if (hueRecoveryTimeoutStreak >= 2) {
    const timeoutCooldown = Math.min(
      HUE_RECOVERY_MAX_COOLDOWN_MS,
      HUE_RECOVERY_TIMEOUT_BACKOFF_MS + Math.max(0, hueRecoveryTimeoutStreak - 2) * 5000
    );
    cooldown = Math.max(cooldown, timeoutCooldown);
  }

  return cooldown;
}

function scheduleHueEntertainmentRecovery(reason = "unspecified") {
  if (hueTransport.desired !== HUE_TRANSPORT.ENTERTAINMENT) return;
  if (shouldSkipHueRecoveryReason(reason)) return;
  const bypassSuppression = isHueRecoverySuppressionBypassReason(reason);
  if (hueRecoverySuppressedByTimeout && !bypassSuppression) {
    const now = Date.now();
    if ((now - hueRecoverySuppressedLogAt) > HUE_RECOVERY_SUPPRESS_LOG_INTERVAL_MS) {
      hueRecoverySuppressedLogAt = now;
      console.warn(
        `[HUE][ENT] auto-recover suppressed for current rave session: ${hueRecoverySuppressedReason || "previous DTLS timeout"}`
      );
    }
    return;
  }
  if (hueTransport.active === HUE_TRANSPORT.ENTERTAINMENT) return;
  if (!hasConfiguredHueEngineTargets()) {
    hueTransport.active = HUE_TRANSPORT.REST;
    hueTransport.fallbackReason = "no configured Hue fixtures routed to ENGINE";
    return;
  }
  if (hueRecoveryInFlight) return;
  const now = Date.now();
  if (now < hueRecoveryNextAt) return;

  hueRecoveryInFlight = true;
  hueRecoveryNextAt = now + HUE_RECOVERY_COOLDOWN_MS;
  const recoveryStartDelayMs = shouldUseHueRecoverySocketDelay(reason)
    ? HUE_RECOVERY_SOCKET_START_DELAY_MS
    : HUE_RECOVERY_START_DELAY_MS;

  hueRecoveryTimer = setTimeout(async () => {
    try {
      const result = await setHueTransportMode(HUE_TRANSPORT.ENTERTAINMENT);
      if (result.active === HUE_TRANSPORT.ENTERTAINMENT) {
        hueRecoveryFailStreak = 0;
        hueRecoveryTimeoutStreak = 0;
        hueRecoveryNextAt = Date.now() + HUE_RECOVERY_COOLDOWN_MS;
        clearHueRecoveryTimeoutSuppression();
        console.log(`[HUE][ENT] auto-recovered (${reason})`);
      } else {
        hueRecoveryFailStreak = Math.min(10, hueRecoveryFailStreak + 1);
        const pendingReasonRaw = String(result.fallbackReason || "still on REST");
        const cooldown = computeHueRecoveryCooldown(reason, pendingReasonRaw);
        hueRecoveryNextAt = Date.now() + cooldown;
        const pendingReason = redactSensitiveLogValue(pendingReasonRaw);
        const pendingKey = `${reason}|${pendingReason}`;
        const shouldLogPending =
          pendingKey !== hueRecoveryLastPendingReason ||
          (Date.now() - hueRecoveryLastPendingLogAt) > 30000;
        if (shouldLogPending) {
          hueRecoveryLastPendingReason = pendingKey;
          hueRecoveryLastPendingLogAt = Date.now();
          console.warn(
            `[HUE][ENT] auto-recover pending (${reason}): ${pendingReason} | retry in ${cooldown}ms`
          );
        }
        if (
          isHueRecoveryTimeoutFailure(pendingReasonRaw) &&
          !bypassSuppression &&
          hueRecoveryTimeoutStreak >= HUE_RECOVERY_TIMEOUT_SUPPRESS_STREAK
        ) {
          hueRecoverySuppressedByTimeout = true;
          hueRecoverySuppressedReason = pendingReason;
          hueRecoverySuppressedAt = Date.now();
          hueRecoverySuppressedLogAt = hueRecoverySuppressedAt;
          hueRecoveryNextAt = Math.max(
            hueRecoveryNextAt,
            hueRecoverySuppressedAt + HUE_RECOVERY_MAX_COOLDOWN_MS
          );
          console.warn(
            `[HUE][ENT] auto-recover suspended for current rave session after timeout: ${pendingReason}`
          );
        } else if (isHueRecoveryTimeoutFailure(pendingReasonRaw) && !bypassSuppression) {
          console.warn(
            `[HUE][ENT] timeout recovery streak ${hueRecoveryTimeoutStreak}/${HUE_RECOVERY_TIMEOUT_SUPPRESS_STREAK}; keeping auto-recover active`
          );
        }
      }
    } catch (err) {
      hueRecoveryFailStreak = Math.min(10, hueRecoveryFailStreak + 1);
      const errorDetail = redactErrorForLog(err);
      const cooldown = computeHueRecoveryCooldown(reason, errorDetail);
      hueRecoveryNextAt = Date.now() + cooldown;
      console.warn(`[HUE][ENT] auto-recover failed (${reason}):`, errorDetail);
      if (
        isHueRecoveryTimeoutFailure(errorDetail) &&
        !bypassSuppression &&
        hueRecoveryTimeoutStreak >= HUE_RECOVERY_TIMEOUT_SUPPRESS_STREAK
      ) {
        hueRecoverySuppressedByTimeout = true;
        hueRecoverySuppressedReason = errorDetail;
        hueRecoverySuppressedAt = Date.now();
        hueRecoverySuppressedLogAt = hueRecoverySuppressedAt;
        hueRecoveryNextAt = Math.max(
          hueRecoveryNextAt,
          hueRecoverySuppressedAt + HUE_RECOVERY_MAX_COOLDOWN_MS
        );
        console.warn(
          `[HUE][ENT] auto-recover suspended for current rave session after timeout: ${errorDetail}`
        );
      } else if (isHueRecoveryTimeoutFailure(errorDetail) && !bypassSuppression) {
        console.warn(
          `[HUE][ENT] timeout recovery streak ${hueRecoveryTimeoutStreak}/${HUE_RECOVERY_TIMEOUT_SUPPRESS_STREAK}; keeping auto-recover active`
        );
      }
    } finally {
      hueRecoveryInFlight = false;
      hueRecoveryTimer = null;
    }
  }, recoveryStartDelayMs);
}

function forceHueEntertainmentRecovery(reason = "manual") {
  if (shouldSkipHueRecoveryReason(reason)) return;
  const token = String(reason || "").trim().toLowerCase();
  if (isHueRecoverySuppressionBypassReason(token)) {
    clearHueRecoveryTimeoutSuppression();
  }
  const bypassBackoff =
    token === "manual" ||
    token === "send_fallback" ||
    token.includes("boot_sync");
  if (bypassBackoff || hueRecoveryTimeoutStreak < 2) {
    hueRecoveryNextAt = 0;
  } else {
    hueRecoveryNextAt = Math.max(
      hueRecoveryNextAt,
      Date.now() + HUE_RECOVERY_TIMEOUT_BACKOFF_MS
    );
  }
  scheduleHueEntertainmentRecovery(reason);
}

let automationEventSeq = 0;

function nextAutomationEventSeq() {
  automationEventSeq += 1;
  return automationEventSeq;
}

function sleep(ms) {
  const waitMs = Math.min(60000, Math.max(0, Number(ms) || 0));
  if (!waitMs) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, waitMs));
}

async function settleWithTimeout(promise, timeoutMs, fallbackFactory) {
  const timeout = Math.max(200, Number(timeoutMs) || 2000);
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise(resolve => {
        timer = setTimeout(() => {
          resolve(typeof fallbackFactory === "function" ? fallbackFactory() : fallbackFactory);
        }, timeout);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function toHueBrightness(percent) {
  const p = Math.min(100, Math.max(1, Math.round(Number(percent) || 1)));
  return Math.min(254, Math.max(1, Math.round((p / 100) * 254)));
}

function toHueTransitionTime(ms) {
  const value = Math.round((Number(ms) || 0) / 100);
  return Math.max(0, Math.min(100, value));
}

function getAutomationHueTargets(targetZone) {
  const zone = String(targetZone || "all").trim().toLowerCase();
  if (!zone || zone === "all") return listEngineFixtures("hue");
  return listEngineFixtures("hue", zone);
}

async function runAutomationEvent(eventName, seqId = automationEventSeq) {
  const eventKey = eventName === "stop" ? "stop" : "start";
  const cfg = automationRules.getConfig();
  const eventCfg = cfg[eventKey] || {};

  if (cfg.enabled === false) {
    return { ok: true, skipped: "disabled" };
  }
  if (eventCfg.enabled === false) {
    return { ok: true, skipped: `${eventKey}_disabled` };
  }

  const delayMs = Math.max(0, Math.min(60000, Number(eventCfg.delayMs) || 0));
  if (delayMs > 0) {
    await sleep(delayMs);
  }

  if (seqId !== automationEventSeq) {
    return { ok: true, skipped: "superseded" };
  }

  const targets = getAutomationHueTargets(cfg.targetZone);
  if (!targets.length) {
    return { ok: false, skipped: "no_hue_targets" };
  }

  const payload = {
    on: true,
    bri: toHueBrightness(eventCfg.brightnessPercent),
    transitiontime: toHueTransitionTime(cfg.transitionMs)
  };

  const startedAt = Date.now();
  const results = await Promise.allSettled(
    targets.map(target =>
      axios.put(
        `https://${target.bridgeIp}/api/${target.username}/lights/${target.lightId}/state`,
        payload,
        {
          timeout: 1800,
          httpsAgent: getHueRestHttpsAgent(target)
        }
      )
    )
  );

  const failed = results.filter(r => r.status === "rejected");
  const summary = {
    ok: failed.length === 0,
    event: eventKey,
    targets: targets.length,
    failed: failed.length,
    bri: payload.bri,
    transitiontime: payload.transitiontime,
    durationMs: Date.now() - startedAt
  };

  if (!summary.ok) {
    const reason = failed[0]?.reason?.message || failed[0]?.reason || "unknown";
    console.warn(`[AUTOMATION] ${eventKey} action partial failure: ${reason}`);
  } else {
    console.log(
      `[AUTOMATION] ${eventKey} brightness applied ` +
      `(bri=${payload.bri}, targets=${summary.targets}, ${summary.durationMs}ms)`
    );
  }

  return summary;
}

// ======================================================
// WIZ
// ======================================================
const wizAdapters = new Map();
const wizSchedulers = new Map();
let wizAdapterVersion = -1;
let lastFixtureSummaryLogKey = "";
const wizTelemetry = {
  sent: 0,
  skippedScheduler: 0,
  skippedNoTargets: 0,
  sendErrors: 0,
  lastDurationMs: 0,
  adaptiveTxReduced: 0,
  adaptiveTxSoft: 0,
  adaptiveTxHard: 0,
  adaptiveTxSavedPackets: 0,
  adaptiveTxLastScore: 0,
  adaptiveTxLastRepeats: 1
};
const WIZ_ADAPTIVE_TX_GOVERNOR_ENABLED = String(process.env.RAVELINK_WIZ_ADAPTIVE_TX_GOVERNOR || "1").trim() !== "0";
const fixtureConnectivityCache = new Map();
const fixtureConnectivityInFlight = new Map();
const CONNECTIVITY_CACHE_TTL_MS = 30000;

function isFixtureConfiguredForTransport(fixture) {
  const check = fixtureRegistry?.isFixtureConfiguredForTransport;
  if (typeof check === "function") return Boolean(check(fixture));
  return true;
}

function extractConnectivityHost(rawAddress) {
  const raw = String(rawAddress || "").trim();
  if (!raw) return "";

  const bracketed = raw.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) {
    return String(bracketed[1] || "").trim();
  }

  if (raw.includes(":")) {
    const hostPort = raw.match(/^([^:]+):(\d{1,5})$/);
    if (hostPort) {
      return String(hostPort[1] || "").trim();
    }
  }

  return raw;
}

function getFixtureConnectivityHost(fixture) {
  const brand = String(fixture?.brand || "").trim().toLowerCase();
  if (brand === "hue") return extractConnectivityHost(fixture?.bridgeIp);
  if (brand === "wiz") return extractConnectivityHost(fixture?.ip);
  return extractConnectivityHost(fixture?.host || fixture?.ip || fixture?.bridgeIp);
}

function getFixtureConnectivityMissingReason(fixture) {
  const brand = String(fixture?.brand || "").trim().toLowerCase();
  if (brand === "hue") {
    const missing = [];
    if (!String(fixture?.bridgeIp || "").trim()) missing.push("bridgeIp");
    if (!String(fixture?.username || "").trim()) missing.push("username");
    if (!Number.isFinite(Number(fixture?.lightId)) || Number(fixture?.lightId) <= 0) missing.push("lightId");
    return missing.length ? `missing ${missing.join("/")}` : "invalid hue config";
  }
  if (brand === "wiz") {
    if (!String(fixture?.ip || "").trim()) return "missing ip";
    return "invalid wiz config";
  }
  return "mod fixture connectivity handled by its adapter";
}

function clampWizTxNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeWizTxRepeats(value, fallback = 1) {
  return Math.round(clampWizTxNumber(value, 1, 3, fallback));
}

function normalizeWizTxDelayMs(value, fallback = 18) {
  return Math.round(clampWizTxNumber(value, 8, 120, fallback));
}

function resolveAdaptiveWizTxOptions(tx = {}, context = {}) {
  const source = tx && typeof tx === "object" ? tx : {};
  const baseRepeats = normalizeWizTxRepeats(source.repeats, 1);
  const baseDelayMs = normalizeWizTxDelayMs(source.repeatDelayMs, 18);
  if (!WIZ_ADAPTIVE_TX_GOVERNOR_ENABLED || baseRepeats <= 1) {
    return {
      tx: {
        ...source,
        repeats: baseRepeats,
        repeatDelayMs: baseDelayMs
      },
      adjusted: false,
      baseRepeats,
      repeats: baseRepeats,
      score: 0,
      severity: "none"
    };
  }

  const now = Date.now();
  const isDrop = source.isDrop === true || context.isDrop === true;
  const isBeat = source.isBeat === true || context.isBeat === true;
  const targetCount = Math.max(1, Math.round(Number(context.targetCount || source.targetCount || 1)));
  const minIntervalMs = Math.max(
    30,
    Math.round(Number(context.minIntervalMs || source.minIntervalMs || 120))
  );
  const pressureEma = Math.max(0, Number(transportPressureFeedback?.ema || 0));
  const holdUntil = Number(transportPressureFeedback?.holdUntil || 0);
  const heldPressure = now < holdUntil
    ? Math.max(pressureEma, 0.14)
    : pressureEma;
  const hueBusyPenalty = hueTelemetry.inflight === true
    ? clampWizTxNumber((Number(hueTelemetry.lastDurationMs || 0) - 110) / 380, 0, 0.35, 0)
    : 0;
  const fanoutPenalty = targetCount >= 8
    ? 0.14
    : (targetCount >= 5 ? 0.09 : (targetCount >= 3 ? 0.05 : 0));
  const ratePenalty = minIntervalMs <= 85
    ? 0.12
    : (minIntervalMs <= 125 ? 0.08 : 0.04);
  const priorityDiscount = isDrop
    ? 0.12
    : (isBeat ? 0.04 : 0);
  const score = clampWizTxNumber(
    heldPressure + hueBusyPenalty + fanoutPenalty + ratePenalty - priorityDiscount,
    0,
    2.4,
    0
  );

  let maxRepeats = baseRepeats;
  let severity = "none";
  if (score >= 1.32) {
    maxRepeats = isDrop ? 2 : 1;
    severity = "hard";
  } else if (score >= 0.86) {
    maxRepeats = isDrop ? 2 : 1;
    severity = "soft";
  } else if (score >= 0.52) {
    maxRepeats = isDrop ? 2 : Math.min(2, baseRepeats);
    severity = "soft";
  }

  const repeats = Math.max(1, Math.min(baseRepeats, maxRepeats));
  const repeatDelayMs = repeats < baseRepeats
    ? normalizeWizTxDelayMs(Math.round(baseDelayMs * (severity === "hard" ? 0.8 : 0.9)), baseDelayMs)
    : baseDelayMs;
  return {
    tx: {
      ...source,
      repeats,
      repeatDelayMs
    },
    adjusted: repeats < baseRepeats,
    baseRepeats,
    repeats,
    score,
    severity
  };
}

function runHostPing(host, timeoutMs = 1200) {
  const target = String(host || "").trim();
  if (!target) {
    return Promise.resolve({
      available: true,
      reachable: false,
      detail: "empty host"
    });
  }

  const safeTimeoutMs = Math.max(400, Math.min(5000, Number(timeoutMs) || 1200));
  const args = process.platform === "win32"
    ? ["-n", "1", "-w", String(safeTimeoutMs), target]
    : ["-c", "1", "-W", String(Math.max(1, Math.ceil(safeTimeoutMs / 1000))), target];

  return new Promise(resolve => {
    execFile(
      "ping",
      args,
      {
        windowsHide: true,
        timeout: safeTimeoutMs + 400
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ available: true, reachable: true, detail: "reachable" });
          return;
        }

        const code = String(error.code || "").toUpperCase();
        if (code === "ENOENT") {
          resolve({
            available: false,
            reachable: false,
            detail: "ping command unavailable"
          });
          return;
        }

        const detail = String(stderr || stdout || error.message || "ping failed")
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 200);
        resolve({
          available: true,
          reachable: false,
          detail: detail || "no ping response"
        });
      }
    );
  });
}

function logConnectivityTransition(previous, next) {
  const changed =
    !previous ||
    previous.status !== next.status ||
    previous.host !== next.host;
  if (!changed) return;

  const prefix = `[${String(next.brand || "FIXTURE").toUpperCase()}][NET]`;
  if (next.status === "reachable") {
    console.log(`${prefix} ${next.id} reachable (${next.host || "n/a"})`);
    return;
  }
  if (next.status === "unreachable") {
    console.warn(`${prefix} ${next.id} unreachable (${next.host || "n/a"}) | ${next.detail}`);
    return;
  }
  if (next.status === "not_configured") {
    console.warn(`${prefix} ${next.id} not configured | ${next.detail}`);
  }
}

async function probeFixtureConnectivity(fixture, options = {}) {
  if (!fixture || typeof fixture !== "object") return null;

  const fixtureId = String(fixture.id || "").trim();
  if (!fixtureId) return null;

  const brand = String(fixture.brand || "").trim().toLowerCase();
  const zone = normalizeRouteZoneToken(fixture.zone, getCanonicalZoneFallback(brand, "custom"));
  const host = getFixtureConnectivityHost(fixture);
  const configured = isFixtureConfiguredForTransport(fixture);

  let status = "unknown";
  let detail = "pending";
  let reachable = null;

  if (brand !== "hue" && brand !== "wiz") {
    status = "skipped";
    detail = "mod-brand fixture (adapter-defined transport)";
    reachable = null;
  } else if (!configured) {
    status = "not_configured";
    detail = getFixtureConnectivityMissingReason(fixture);
    reachable = false;
  } else if (!host) {
    status = "unknown";
    detail = "host missing";
    reachable = false;
  } else {
    const ping = await runHostPing(host, options.timeoutMs);
    if (!ping.available) {
      status = "unknown";
      detail = ping.detail || "ping unavailable";
      reachable = null;
    } else if (ping.reachable) {
      status = "reachable";
      detail = "reachable";
      reachable = true;
    } else {
      status = "unreachable";
      detail = ping.detail || "no ping response";
      reachable = false;
    }
  }

  const result = {
    id: fixtureId,
    brand,
    zone,
    host,
    configured,
    status,
    detail,
    reachable,
    checkedAt: Date.now()
  };

  const previous = fixtureConnectivityCache.get(fixtureId) || null;
  fixtureConnectivityCache.set(fixtureId, result);
  if (options.logChanges !== false) {
    logConnectivityTransition(previous, result);
  }

  return result;
}

function queueFixtureConnectivityProbe(fixture, options = {}) {
  if (!fixture || typeof fixture !== "object") return Promise.resolve(null);
  const fixtureId = String(fixture.id || "").trim();
  if (!fixtureId) return Promise.resolve(null);

  const force = options.force === true;
  const host = getFixtureConnectivityHost(fixture);
  const cached = fixtureConnectivityCache.get(fixtureId);
  if (
    !force &&
    cached &&
    cached.host === host &&
    (Date.now() - Number(cached.checkedAt || 0)) < CONNECTIVITY_CACHE_TTL_MS
  ) {
    return Promise.resolve(cached);
  }

  if (!force && fixtureConnectivityInFlight.has(fixtureId)) {
    return fixtureConnectivityInFlight.get(fixtureId);
  }

  const task = probeFixtureConnectivity(fixture, options)
    .catch(err => {
      const fallback = {
        id: fixtureId,
        brand: String(fixture.brand || "").trim().toLowerCase(),
        zone: normalizeRouteZoneToken(
          fixture.zone,
          getCanonicalZoneFallback(String(fixture.brand || "").trim().toLowerCase(), "custom")
        ),
        host,
        configured: isFixtureConfiguredForTransport(fixture),
        status: "unknown",
        detail: err.message || String(err),
        reachable: null,
        checkedAt: Date.now()
      };
      fixtureConnectivityCache.set(fixtureId, fallback);
      return fallback;
    })
    .finally(() => {
      fixtureConnectivityInFlight.delete(fixtureId);
    });

  fixtureConnectivityInFlight.set(fixtureId, task);
  return task;
}

function summarizeConnectivityResults(results = []) {
  const summary = {
    total: 0,
    reachable: 0,
    unreachable: 0,
    notConfigured: 0,
    unknown: 0,
    skipped: 0
  };

  for (const item of results) {
    if (!item) continue;
    summary.total += 1;
    const counterKey = CONNECTIVITY_STATUS_TO_SUMMARY_KEY[item.status];
    if (counterKey) summary[counterKey] += 1;
    else summary.unknown += 1;
  }

  return summary;
}

function getConnectivitySnapshotForFixtures(fixtures = []) {
  return (fixtures || []).map(fixture => {
    const id = String(fixture?.id || "").trim();
    if (!id) return null;
    return (
      fixtureConnectivityCache.get(id) ||
      {
        id,
        brand: String(fixture?.brand || "").trim().toLowerCase(),
        zone: normalizeRouteZoneToken(fixture?.zone, "custom"),
        host: getFixtureConnectivityHost(fixture),
        configured: isFixtureConfiguredForTransport(fixture),
        status: "pending",
        detail: "awaiting connectivity probe",
        reachable: null,
        checkedAt: 0
      }
    );
  }).filter(Boolean);
}

function pruneConnectivityCache(fixtures = []) {
  const keep = new Set(
    (fixtures || [])
      .map(fixture => String(fixture?.id || "").trim())
      .filter(Boolean)
  );

  for (const fixtureId of fixtureConnectivityCache.keys()) {
    if (!keep.has(fixtureId)) {
      fixtureConnectivityCache.delete(fixtureId);
    }
  }

  for (const fixtureId of fixtureConnectivityInFlight.keys()) {
    if (!keep.has(fixtureId)) {
      fixtureConnectivityInFlight.delete(fixtureId);
    }
  }
}

function getWizScheduler(zone) {
  if (!wizSchedulers.has(zone)) {
    wizSchedulers.set(zone, createWizScheduler());
  }
  return wizSchedulers.get(zone);
}

function getEngineDispatchZone(fixture) {
  const brand = String(fixture?.brand || "").trim().toLowerCase();
  if (brand === "hue") return "hue";
  if (brand === "wiz") return "wiz";
  return normalizeRouteZoneToken(fixture?.zone, getCanonicalZoneFallback(brand, "custom"));
}

function refreshWizAdapters() {
  const version = fixtureRegistry.getVersion();
  if (version === wizAdapterVersion) return;

  const configured = listEngineFixtures("wiz");
  const nextById = new Map(configured.map(f => [f.id, f]));

  for (const [id, entry] of wizAdapters.entries()) {
    if (!nextById.has(id)) {
      try {
        entry.send.close?.();
      } catch {}
      wizAdapters.delete(id);
    }
  }

  for (const fixture of configured) {
    const existing = wizAdapters.get(fixture.id);
    const zone = getEngineDispatchZone(fixture);
    queueFixtureConnectivityProbe(fixture, { force: false, logChanges: true }).catch(() => {});

    if (existing && existing.ip === fixture.ip) {
      existing.zone = zone;
      continue;
    }

    if (existing) {
      try {
        existing.send.close?.();
      } catch {}
    }

    wizAdapters.set(fixture.id, {
      id: fixture.id,
      ip: fixture.ip,
      zone,
      send: createWizAdapter({ ip: fixture.ip })
    });
  }

  wizAdapterVersion = version;

  const fixtureSummary = fixtureRegistry.summary();
  const summaryKey = JSON.stringify({
    hue: fixtureSummary.hue,
    wiz: fixtureSummary.wiz,
    routes: fixtureSummary.routes || {}
  });
  if (summaryKey !== lastFixtureSummaryLogKey) {
    lastFixtureSummaryLogKey = summaryKey;
    console.log(
      `[FIXTURES] reloaded v${fixtureSummary.version} | Hue=${fixtureSummary.hue} WiZ=${fixtureSummary.wiz} routes=${JSON.stringify(fixtureSummary.routes)}`
    );
  }
}

function getWizTargets(zone) {
  refreshWizAdapters();
  return [...wizAdapters.values()].filter(target => target.zone === zone);
}

// Split route lists by explicit separators only, so zone names can include spaces.
const ZONE_SPLIT_RE = /[,;|]+/;

function parseZoneList(raw, fallbackZone) {
  const fallback = String(fallbackZone || "").trim();
  const text = String(raw || "").trim();
  if (!text) return fallback ? [fallback] : [];

  const zones = text
    .split(ZONE_SPLIT_RE)
    .map(z => z.trim())
    .filter(Boolean);

  if (!zones.length && fallback) return [fallback];
  return [...new Set(zones)];
}

function getFixtureDispatchZoneForMode(fixture, mode = "engine") {
  const targetMode = String(mode || "engine").trim().toLowerCase();
  const brand = String(fixture?.brand || "").trim().toLowerCase();
  if (brand === "hue") return "hue";
  if (brand === "wiz") {
    if (targetMode === "custom") return "custom";
    return "wiz";
  }
  return normalizeRouteZoneToken(fixture?.zone, getCanonicalZoneFallback(brand, "custom"));
}

function listFixturesByMode(mode, brand, zone) {
  if (mode === "twitch") return listTwitchFixtures(brand, zone);
  if (mode === "custom") return listCustomFixtures(brand, zone);
  return listEngineFixtures(brand, zone);
}

function resolveIntentZones(intent, brand, fallbackZone, options = {}) {
  const mode = String(options.mode || "engine").trim().toLowerCase();
  const brandKey = String(brand || "").trim().toLowerCase();
  const explicitZone = intent && typeof intent.zone === "string"
    ? intent.zone
    : null;
  const rawZone = explicitZone || fixtureRegistry.resolveZone(intent) || fallbackZone;
  const parsed = parseZoneList(rawZone, fallbackZone);
  const hasAll = parsed.some(z => z === "*" || z.toLowerCase() === "all");
  const routedFixtures = listFixturesByMode(mode, brandKey);
  const availableZones = [...new Set(
    routedFixtures
      .map(f => getFixtureDispatchZoneForMode(f, mode))
      .filter(Boolean)
  )];

  if (!hasAll) {
    if (!brandKey || !routedFixtures.length) return parsed;

    const matchedZones = [...new Set(
      parsed.flatMap(token => {
        const matches = routedFixtures.filter(fixture => fixtureMatchesRouteZone(fixture, token));
        return matches.map(fixture => getFixtureDispatchZoneForMode(fixture, mode));
      }).filter(Boolean)
    )];

    if (matchedZones.length) return matchedZones;
    if (availableZones.length) return availableZones;
    return [fallbackZone || getCanonicalZoneFallback(brandKey, "custom")];
  }

  const zones = [...new Set(
    routedFixtures
      .map(f => String(getFixtureDispatchZoneForMode(f, mode) || fallbackZone).trim())
      .filter(Boolean)
  )];
  return zones.length ? zones : [fallbackZone || getCanonicalZoneFallback(brandKey, "custom")];
}

function buildFixtureModeInteroperabilityReport(options = {}) {
  const verbose = options && options.verbose === true;
  const fixtures = fixtureRegistry.getFixtures?.() || [];
  const routes = fixtureRegistry.getIntentRoutes?.() || {};
  const issues = [];
  const rows = [];

  const listIds = list => new Set(
    (Array.isArray(list) ? list : [])
      .map(item => String(item?.id || "").trim())
      .filter(Boolean)
  );

  const engineIdsByBrand = {
    hue: listIds(fixtureRegistry.listEngineBy?.("hue", "", { requireConfigured: false }) || []),
    wiz: listIds(fixtureRegistry.listEngineBy?.("wiz", "", { requireConfigured: false }) || [])
  };
  const twitchIdsByBrand = {
    hue: listIds(fixtureRegistry.listTwitchBy?.("hue", "", { requireConfigured: false }) || []),
    wiz: listIds(fixtureRegistry.listTwitchBy?.("wiz", "", { requireConfigured: false }) || [])
  };
  const customIdsByBrand = {
    hue: listIds(fixtureRegistry.listCustomBy?.("hue", "", { requireConfigured: false }) || []),
    wiz: listIds(fixtureRegistry.listCustomBy?.("wiz", "", { requireConfigured: false }) || [])
  };

  const activeCounts = {
    engine: 0,
    twitch: 0,
    custom: 0
  };

  for (const fixture of fixtures) {
    if (!fixture || typeof fixture !== "object") continue;
    const id = String(fixture.id || "").trim();
    if (!id) continue;

    const brand = String(fixture.brand || "").trim().toLowerCase();
    const reportedMode = String(fixture.controlMode || "").trim().toLowerCase();
    const enabled = fixture.enabled !== false;
    const engineEnabled = parseBoolean(fixture.engineEnabled, false);
    const twitchEnabled = parseBoolean(fixture.twitchEnabled, false);
    const customEnabled = parseBoolean(fixture.customEnabled, false);
    const controlMode = engineEnabled ? "engine" : "standalone";
    const engineBinding = String(
      fixture.engineBinding || (engineEnabled ? brand : "standalone")
    ).trim().toLowerCase();

    if (engineEnabled) activeCounts.engine += 1;
    if (twitchEnabled) activeCounts.twitch += 1;
    if (customEnabled) activeCounts.custom += 1;

    if (engineEnabled && customEnabled) {
      issues.push({ id, severity: "error", code: "engine_custom_conflict", message: "engineEnabled and customEnabled cannot both be true" });
    }
    if (!engineEnabled && !twitchEnabled && !customEnabled) {
      issues.push({ id, severity: "warn", code: "no_mode_enabled", message: "fixture has no enabled routing mode (idle)" });
    }
    if (engineEnabled && engineBinding !== brand) {
      issues.push({ id, severity: "error", code: "engine_binding_mismatch", message: `engineBinding must be '${brand}' when engineEnabled=true` });
    }
    if (!engineEnabled && engineBinding !== "standalone") {
      issues.push({ id, severity: "warn", code: "standalone_binding_mismatch", message: "engineBinding should be 'standalone' when engineEnabled=false" });
    }
    if (reportedMode && reportedMode !== controlMode) {
      issues.push({ id, severity: "warn", code: "control_mode_mismatch", message: `controlMode should be '${controlMode}' for current mode flags` });
    }

    if (enabled && (brand === "hue" || brand === "wiz")) {
      const inEngine = engineIdsByBrand[brand].has(id);
      const inTwitch = twitchIdsByBrand[brand].has(id);
      const inCustom = customIdsByBrand[brand].has(id);
      if (inEngine !== engineEnabled) {
        issues.push({ id, severity: "error", code: "engine_list_mismatch", message: "engine list membership does not match engineEnabled flag" });
      }
      if (inTwitch !== twitchEnabled) {
        issues.push({ id, severity: "error", code: "twitch_list_mismatch", message: "twitch list membership does not match twitchEnabled flag" });
      }
      if (inCustom !== customEnabled) {
        issues.push({ id, severity: "error", code: "custom_list_mismatch", message: "custom list membership does not match customEnabled flag" });
      }
    }

    if (verbose) {
      rows.push({
        id,
        brand,
        enabled,
        controlMode,
        reportedControlMode: reportedMode || controlMode,
        engineBinding,
        engineEnabled,
        twitchEnabled,
        customEnabled
      });
    }
  }

  const byCode = {};
  for (const issue of issues) {
    const key = String(issue.code || "unknown");
    byCode[key] = (byCode[key] || 0) + 1;
  }

  return {
    ok: issues.filter(item => item.severity === "error").length === 0,
    checkedAt: Date.now(),
    totalFixtures: fixtures.length,
    activeCounts,
    routes,
    issueCount: issues.length,
    issuesByCode: byCode,
    issues,
    ...(verbose ? { fixtures: rows } : {})
  };
}

function enqueueWiz(state, zone = "wiz", options = {}) {
  const scheduler = getWizScheduler(zone);
  const scheduleOptions = buildWizScheduleOptions(options, zone);
  if (!scheduler.shouldSend(state, scheduleOptions)) {
    wizTelemetry.skippedScheduler++;
    return;
  }

  const targets = getWizTargets(zone);
  if (!targets.length) {
    wizTelemetry.skippedNoTargets++;
    logNoEngineTargets("wiz", zone);
    return;
  }
  const adaptiveTx = resolveAdaptiveWizTxOptions(scheduleOptions.tx, {
    targetCount: targets.length,
    minIntervalMs: scheduleOptions.minIntervalMs
  });
  const txOptions = adaptiveTx.tx;
  wizTelemetry.adaptiveTxLastScore = Number(adaptiveTx.score || 0);
  wizTelemetry.adaptiveTxLastRepeats = Number(adaptiveTx.repeats || 1);
  if (adaptiveTx.adjusted) {
    wizTelemetry.adaptiveTxReduced += 1;
    if (adaptiveTx.severity === "hard") wizTelemetry.adaptiveTxHard += 1;
    else wizTelemetry.adaptiveTxSoft += 1;
  }

  const start = Date.now();
  let sentCount = 0;
  const repeatsSavedPerTarget = Math.max(0, Number(adaptiveTx.baseRepeats || 1) - Number(adaptiveTx.repeats || 1));
  for (const target of targets) {
    const stateForTarget = applyFixturePaletteToWizState(
      state,
      target.id,
      scheduleOptions.paletteIntent
    );
    const allowDispatch = shouldDispatchFixtureWithMetricHzClamp(
      target.id,
      "wiz",
      zone,
      { forceSend: stateForTarget?.on === false }
    );
    if (!allowDispatch) {
      wizTelemetry.skippedScheduler++;
      continue;
    }
    try {
      target.send(stateForTarget, txOptions);
      sentCount += 1;
      if (repeatsSavedPerTarget > 0) {
        wizTelemetry.adaptiveTxSavedPackets += repeatsSavedPerTarget;
      }
    } catch (err) {
      wizTelemetry.sendErrors++;
      console.error("[WIZ] send failed:", err.message || err);
    }
  }

  if (sentCount <= 0) {
    wizTelemetry.lastDurationMs = Date.now() - start;
    return;
  }
  wizTelemetry.sent++;
  wizTelemetry.lastDurationMs = Date.now() - start;
}

const fixturePaletteSequenceState = new Map();
const fixturePaletteBrightnessState = new Map();
const fixturePaletteSequenceCache = new Map();
const PALETTE_SEQUENCE_CACHE_MAX = 192;
const PALETTE_PATCH_FIELDS = Object.freeze([
  "colorsPerFamily",
  "familyColorCounts",
  "families",
  "disorder",
  "disorderAggression",
  "cycleMode",
  "timedIntervalSec",
  "beatLock",
  "beatLockGraceSec",
  "reactiveMargin",
  "brightnessMode",
  "brightnessFollowAmount",
  "vividness",
  "spectrumMapMode",
  "spectrumFeatureMap"
]);

function hasPatchKey(source, key) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function hasPalettePatchFields(patch = {}) {
  return PALETTE_PATCH_FIELDS.some(key => hasPatchKey(patch, key));
}

function applyPaletteConfigPatch(updated, current, next) {
  if (hasPatchKey(next, "colorsPerFamily")) {
    updated.colorsPerFamily = normalizePaletteColorCount(next.colorsPerFamily, current.colorsPerFamily);
    updated.familyColorCounts = buildPaletteUniformColorCounts(updated.colorsPerFamily);
  }
  if (hasPatchKey(next, "familyColorCounts")) {
    updated.familyColorCounts = normalizePaletteFamilyColorCounts(
      next.familyColorCounts,
      updated.familyColorCounts || current.familyColorCounts,
      updated.colorsPerFamily || current.colorsPerFamily
    );
  }
  if (hasPatchKey(next, "families")) {
    updated.families = normalizePaletteFamilies(next.families, current.families);
  }
  if (hasPatchKey(next, "disorder")) {
    updated.disorder = Boolean(next.disorder);
  }
  if (hasPatchKey(next, "disorderAggression")) {
    updated.disorderAggression = normalizePaletteDisorderAggression(
      next.disorderAggression,
      current.disorderAggression
    );
  }
  if (hasPatchKey(next, "cycleMode")) {
    updated.cycleMode = normalizePaletteCycleMode(next.cycleMode, current.cycleMode);
  }
  if (hasPatchKey(next, "timedIntervalSec")) {
    updated.timedIntervalSec = normalizePaletteTimedIntervalSec(
      next.timedIntervalSec,
      current.timedIntervalSec
    );
  }
  if (hasPatchKey(next, "beatLock")) {
    updated.beatLock = parseBooleanLoose(next.beatLock, Boolean(current.beatLock));
  }
  if (hasPatchKey(next, "beatLockGraceSec")) {
    updated.beatLockGraceSec = normalizePaletteBeatLockGraceSec(
      next.beatLockGraceSec,
      current.beatLockGraceSec
    );
  }
  if (hasPatchKey(next, "reactiveMargin")) {
    updated.reactiveMargin = normalizePaletteReactiveMargin(
      next.reactiveMargin,
      current.reactiveMargin
    );
  }
  if (hasPatchKey(next, "brightnessMode")) {
    updated.brightnessMode = normalizePaletteBrightnessMode(
      next.brightnessMode,
      current.brightnessMode
    );
  }
  if (hasPatchKey(next, "brightnessFollowAmount")) {
    updated.brightnessFollowAmount = normalizePaletteBrightnessFollowAmount(
      next.brightnessFollowAmount,
      current.brightnessFollowAmount
    );
  }
  if (hasPatchKey(next, "vividness")) {
    updated.vividness = normalizePaletteVividness(
      next.vividness,
      current.vividness
    );
  }
  if (hasPatchKey(next, "spectrumMapMode")) {
    updated.spectrumMapMode = normalizePaletteSpectrumMapMode(
      next.spectrumMapMode,
      current.spectrumMapMode
    );
  }
  if (hasPatchKey(next, "spectrumFeatureMap")) {
    updated.spectrumFeatureMap = normalizePaletteSpectrumFeatureMap(
      next.spectrumFeatureMap,
      current.spectrumFeatureMap
    );
  }
  return updated;
}

function getEngineGlobalPaletteConfig() {
  const raw = engine?.getPaletteConfig?.();
  return normalizePaletteConfigSnapshot(raw, PALETTE_CONFIG_DEFAULT);
}

function getEnginePaletteConfigForBrand(brandKey) {
  const brand = normalizePaletteBrandKey(brandKey);
  const globalConfig = getEngineGlobalPaletteConfig();
  if (!brand) return globalConfig;

  const direct = engine?.getPaletteConfig?.(brand);
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return normalizePaletteConfigSnapshot(direct, globalConfig);
  }

  const globalRaw = engine?.getPaletteConfig?.() || {};
  const brands = globalRaw && typeof globalRaw === "object" && globalRaw.brands && typeof globalRaw.brands === "object"
    ? globalRaw.brands
    : {};
  const brandRaw = brands[brand];
  if (brandRaw && typeof brandRaw === "object" && !Array.isArray(brandRaw)) {
    return normalizePaletteConfigSnapshot(brandRaw, globalConfig);
  }
  return globalConfig;
}

function prunePaletteFixtureOverrides(fixtures = null) {
  const fixtureList = Array.isArray(fixtures)
    ? fixtures
    : (fixtureRegistry.getFixtures?.() || []);
  const fixtureById = new Map(
    fixtureList
      .map(fixture => [String(fixture?.id || "").trim(), fixture])
      .filter(([id]) => Boolean(id))
  );
  const current = paletteFixtureOverridesRuntime?.fixtures || {};
  const nextFixtures = {};
  let changed = false;

  for (const [fixtureId, rawConfig] of Object.entries(current)) {
    const fixture = fixtureById.get(fixtureId);
    if (!fixture) {
      changed = true;
      fixturePaletteSequenceState.delete(fixtureId);
      continue;
    }
    const brand = normalizePaletteBrandKey(fixture.brand);
    if (!brand) {
      changed = true;
      fixturePaletteSequenceState.delete(fixtureId);
      continue;
    }
    const normalized = normalizePaletteConfigSnapshot(
      rawConfig,
      getEnginePaletteConfigForBrand(brand)
    );
    nextFixtures[fixtureId] = normalized;
    if (!rawConfig || JSON.stringify(rawConfig) !== JSON.stringify(normalized)) {
      changed = true;
    }
  }

  if (!changed && Object.keys(nextFixtures).length !== Object.keys(current).length) {
    changed = true;
  }

  if (changed) {
    paletteFixtureOverridesRuntime = writePaletteFixtureOverridesConfig({
      ...paletteFixtureOverridesRuntime,
      fixtures: nextFixtures
    });
  }
}

function buildPaletteBrandFixtureCatalog(fixtures = null) {
  const fixtureList = Array.isArray(fixtures)
    ? fixtures
    : (fixtureRegistry.getFixtures?.() || []);
  const byBrand = {};
  for (const brand of PALETTE_SUPPORTED_BRANDS) {
    byBrand[brand] = [];
  }

  for (const fixture of fixtureList) {
    if (!fixture || typeof fixture !== "object") continue;
    const fixtureId = String(fixture.id || "").trim();
    if (!fixtureId) continue;
    const brand = normalizePaletteBrandKey(fixture.brand);
    if (!brand) continue;
    const engineEnabled = parseBoolean(fixture.engineEnabled, false);
    if (fixture.enabled === false || !engineEnabled) continue;
    const zone = getFixtureDispatchZoneForMode(fixture, "engine");
    byBrand[brand].push({
      id: fixtureId,
      brand,
      zone,
      label: `${fixtureId} | ${String(zone || brand).toUpperCase()}`
    });
  }

  for (const brand of PALETTE_SUPPORTED_BRANDS) {
    byBrand[brand].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  return byBrand;
}

function buildPaletteFixtureOverrideSnapshot() {
  const fixtures = fixtureRegistry.getFixtures?.() || [];
  prunePaletteFixtureOverrides(fixtures);
  const fixtureById = new Map(
    fixtures
      .map(fixture => [String(fixture?.id || "").trim(), fixture])
      .filter(([id]) => Boolean(id))
  );
  const out = {};

  for (const [fixtureId, rawConfig] of Object.entries(paletteFixtureOverridesRuntime.fixtures || {})) {
    const fixture = fixtureById.get(fixtureId);
    if (!fixture) continue;
    const brand = normalizePaletteBrandKey(fixture.brand);
    if (!brand) continue;
    out[fixtureId] = {
      ...normalizePaletteConfigSnapshot(rawConfig, getEnginePaletteConfigForBrand(brand)),
      fixtureId,
      brand
    };
  }

  return out;
}

function getFixturePaletteOverrideConfig(fixtureId, brandKey) {
  const id = String(fixtureId || "").trim();
  const brand = normalizePaletteBrandKey(brandKey);
  if (!id || !brand) return null;
  const raw = paletteFixtureOverridesRuntime.fixtures?.[id];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return normalizePaletteConfigSnapshot(raw, getEnginePaletteConfigForBrand(brand));
}

function resolvePaletteVividnessProfile(level = PALETTE_CONFIG_DEFAULT.vividness) {
  const vividness = normalizePaletteVividness(level, PALETTE_CONFIG_DEFAULT.vividness);
  const satBoostScaleByLevel = [0.72, 0.9, 1, 1.16, 1.32];
  const satBoostAddByLevel = [0, 0.03, 0.08, 0.14, 0.2];
  const minSatDeltaByLevel = [-0.12, -0.06, 0, 0.05, 0.1];
  const minValueDeltaByLevel = [-0.04, -0.01, 0, 0.03, 0.06];
  const softSatScaleByLevel = [0.76, 0.88, 1, 1.14, 1.28];
  const softSatAddByLevel = [0, 0.02, 0.05, 0.1, 0.14];
  const softMinSatDeltaByLevel = [-0.12, -0.07, 0, 0.05, 0.1];
  const softMinValueDeltaByLevel = [-0.05, -0.02, 0, 0.02, 0.04];
  return {
    vividness,
    satBoostScale: satBoostScaleByLevel[vividness],
    satBoostAdd: satBoostAddByLevel[vividness],
    minSatDelta: minSatDeltaByLevel[vividness],
    minValueDelta: minValueDeltaByLevel[vividness],
    softSatScale: softSatScaleByLevel[vividness],
    softSatAdd: softSatAddByLevel[vividness],
    softMinSatDelta: softMinSatDeltaByLevel[vividness],
    softMinValueDelta: softMinValueDeltaByLevel[vividness]
  };
}

function tunePaletteVibrancy255(color = {}, options = {}) {
  const base = {
    r: clampRgb255(color?.r),
    g: clampRgb255(color?.g),
    b: clampRgb255(color?.b)
  };
  const baseHsv = rgbToHsv255(base);
  const preserveNeutralBelow = clampNumber(Number(options.preserveNeutralBelow) || 0, 0, 0.3, 0);
  if (baseHsv.s <= preserveNeutralBelow) {
    return base;
  }
  const satBoost = clampNumber(Number(options.satBoost) || 0, 0, 1, 0);
  const minSat = clampNumber(Number(options.minSat) || 0, 0, 1, 0);
  const minValue = clampNumber(Number(options.minValue) || 0, 0, 1, 0);
  const maxValue = clampNumber(Number(options.maxValue) || 1, minValue, 1, 1);
  const boosted = boostRgbSaturation(base, satBoost);
  const hsv = rgbToHsv255(boosted);
  return hsvToRgb255(
    hsv.h,
    Math.max(hsv.s, minSat),
    clampNumber(Math.max(hsv.v, minValue), minValue, maxValue, maxValue)
  );
}

function tunePaletteArrayVibrancy255(palette = [], options = {}) {
  const src = Array.isArray(palette) ? palette : [];
  const softEvery = Math.max(0, Math.round(Number(options.softEvery) || 0));
  return src.map((color, index) => {
    const softTone = softEvery > 0 && ((index + 1) % softEvery === 0);
    return tunePaletteVibrancy255(color, {
      satBoost: softTone ? options.softSatBoost : options.satBoost,
      minSat: softTone ? options.softMinSat : options.minSat,
      minValue: softTone ? options.softMinValue : options.minValue,
      maxValue: options.maxValue,
      preserveNeutralBelow: options.preserveNeutralBelow
    });
  });
}

function buildPaletteFamilyColors(familyId, colorsPerFamily, vividnessLevel = PALETTE_CONFIG_DEFAULT.vividness) {
  const family = PALETTE_FAMILY_DEFS[familyId];
  if (!family) return [];
  const colors = Array.isArray(family.colors) ? family.colors.slice() : [];
  if (!colors.length) return [];
  const count = normalizePaletteColorCount(colorsPerFamily, PALETTE_CONFIG_DEFAULT.colorsPerFamily);
  const span = resolveSharedPaletteFamilyIndexSpan(familyId, count);
  const picked = span
    .map(idx => colors[idx])
    .filter(Boolean);
  const sourcePalette = picked.length
    ? picked
    : colors.slice(0, Math.max(1, Math.min(count, colors.length)));
  const ultraDensity = count >= 12;
  const highDensity = count >= 8 && count < 12;
  const mediumDensity = count >= 5 && count < 8;
  const narrowDensity = count <= 3;
  const profile = resolvePaletteVividnessProfile(vividnessLevel);
  const baseSatBoost = narrowDensity
    ? 0.72
    : ultraDensity
      ? 0.62
      : highDensity
        ? 0.66
        : 0.69;
  const baseMinSat = narrowDensity
    ? 0.93
    : ultraDensity
      ? 0.89
      : highDensity
        ? 0.9
        : 0.91;
  const baseMinValue = narrowDensity ? 0.38 : 0.32;
  return tunePaletteArrayVibrancy255(sourcePalette, {
    satBoost: clampNumber((baseSatBoost * profile.satBoostScale) + profile.satBoostAdd, 0, 1, 0.68),
    minSat: clampNumber(baseMinSat + profile.minSatDelta, 0, 1, 0.9),
    minValue: clampNumber(baseMinValue + profile.minValueDelta, 0, 1, 0.32),
    maxValue: 1,
    softEvery: narrowDensity ? 0 : (ultraDensity ? 6 : (highDensity ? 5 : (mediumDensity ? 4 : 0))),
    softSatBoost: clampNumber((0.26 * profile.softSatScale) + profile.softSatAdd, 0, 1, 0.3),
    softMinSat: clampNumber(0.76 + profile.softMinSatDelta, 0, 1, 0.72),
    softMinValue: clampNumber(0.3 + profile.softMinValueDelta, 0, 1, 0.3),
    preserveNeutralBelow: 0.06
  });
}

function normalizePaletteHueDeg(value) {
  const hue = Number(value);
  if (!Number.isFinite(hue)) return 0;
  return ((hue % 360) + 360) % 360;
}

function paletteHueDistanceDeg(a, b) {
  const aa = normalizePaletteHueDeg(a);
  const bb = normalizePaletteHueDeg(b);
  const delta = Math.abs(aa - bb);
  return delta > 180 ? (360 - delta) : delta;
}

function shortestHueDeltaDeg(fromHue, toHue) {
  return ((normalizePaletteHueDeg(toHue) - normalizePaletteHueDeg(fromHue) + 540) % 360) - 180;
}

function rotatePaletteColors(colors = [], shift = 0) {
  const list = Array.isArray(colors) ? colors.slice() : [];
  const len = list.length;
  if (len <= 1) return list;
  const offset = ((Math.round(Number(shift) || 0) % len) + len) % len;
  if (offset === 0) return list;
  return list.slice(offset).concat(list.slice(0, offset));
}

function buildPaletteFamilyVariants(colors = []) {
  const base = Array.isArray(colors) ? colors : [];
  if (!base.length) return [];
  const variants = [];
  const seen = new Set();
  const directions = [base.slice(), base.slice().reverse()];

  const pushVariant = candidate => {
    const normalized = candidate.map(color => ({
      r: clampRgb255(color?.r),
      g: clampRgb255(color?.g),
      b: clampRgb255(color?.b)
    }));
    const fingerprint = normalized.map(color => `${color.r},${color.g},${color.b}`).join("|");
    if (!fingerprint || seen.has(fingerprint)) return;
    const hues = normalized.map(color => normalizePaletteHueDeg(rgbToHsv255(color).h));
    let internalScore = 0;
    for (let i = 0; i < hues.length - 1; i += 1) {
      internalScore += paletteHueDistanceDeg(hues[i], hues[i + 1]);
    }
    variants.push({
      colors: normalized,
      startHue: hues[0] || 0,
      endHue: hues[hues.length - 1] || 0,
      internalScore
    });
    seen.add(fingerprint);
  };

  for (const direction of directions) {
    for (let offset = 0; offset < direction.length; offset += 1) {
      pushVariant(rotatePaletteColors(direction, offset));
    }
  }
  if (!variants.length) {
    pushVariant(base);
  }
  return variants;
}

function orientPaletteFamiliesForOrderedFlow(segments = []) {
  const safeSegments = Array.isArray(segments)
    ? segments.filter(segment => Array.isArray(segment) && segment.length > 0)
    : [];
  if (safeSegments.length <= 1) {
    return safeSegments.map(segment => segment.slice());
  }

  const candidateSets = safeSegments.map(segment => buildPaletteFamilyVariants(segment));
  if (candidateSets.some(set => !Array.isArray(set) || !set.length)) {
    return safeSegments.map(segment => segment.slice());
  }

  const transitionWeight = 6.8;
  const cycleClosureWeight = 7.2;
  let bestScore = Number.POSITIVE_INFINITY;
  let best = null;
  const chosen = new Array(candidateSets.length);

  const walk = (idx, score) => {
    if (idx >= candidateSets.length) {
      let total = score;
      if (candidateSets.length > 1) {
        const first = chosen[0];
        const last = chosen[chosen.length - 1];
        total += paletteHueDistanceDeg(last.endHue, first.startHue) * cycleClosureWeight;
      }
      if (total < bestScore) {
        bestScore = total;
        best = chosen.slice();
      }
      return;
    }
    for (const candidate of candidateSets[idx]) {
      let nextScore = score + candidate.internalScore;
      if (idx > 0) {
        const prev = chosen[idx - 1];
        nextScore += paletteHueDistanceDeg(prev.endHue, candidate.startHue) * transitionWeight;
      }
      if (nextScore >= bestScore) continue;
      chosen[idx] = candidate;
      walk(idx + 1, nextScore);
    }
  };

  walk(0, 0);
  if (!best || !best.length) {
    return safeSegments.map(segment => segment.slice());
  }
  return best.map(item => item.colors.slice());
}

function buildPaletteSequence(config = {}) {
  const normalized = normalizePaletteConfigSnapshot(config, PALETTE_CONFIG_DEFAULT);
  const selectedFamilies = normalizePaletteFamilies(
    normalized.families,
    PALETTE_CONFIG_DEFAULT.families
  );
  const cacheKey = getPaletteConfigFingerprint(normalized);
  if (fixturePaletteSequenceCache.has(cacheKey)) {
    return fixturePaletteSequenceCache.get(cacheKey).map(color => ({ ...color }));
  }

  const out = [];
  const familySegments = selectedFamilies
    .map(familyId => {
      const count = resolvePaletteColorCountForFamily(
        normalized,
        familyId,
        normalized.colorsPerFamily
      );
      return buildPaletteFamilyColors(familyId, count, normalized.vividness);
    })
    .filter(segment => Array.isArray(segment) && segment.length > 0);
  const flowSegments = !normalized.disorder && familySegments.length >= 2
    ? orientPaletteFamiliesForOrderedFlow(familySegments)
    : familySegments;

  for (const segment of flowSegments) {
    for (const color of segment) {
      out.push({
        r: clampRgb255(color.r),
        g: clampRgb255(color.g),
        b: clampRgb255(color.b)
      });
    }
  }
  if (!out.length) {
    const fallbackCount = resolvePaletteColorCountForFamily(
      normalized,
      "red",
      PALETTE_CONFIG_DEFAULT.colorsPerFamily
    );
    return buildPaletteFamilyColors("red", fallbackCount, normalized.vividness).map(color => ({
      r: clampRgb255(color.r),
      g: clampRgb255(color.g),
      b: clampRgb255(color.b)
    }));
  }
  fixturePaletteSequenceCache.set(cacheKey, out.map(color => ({ ...color })));
  while (fixturePaletteSequenceCache.size > PALETTE_SEQUENCE_CACHE_MAX) {
    const firstKey = fixturePaletteSequenceCache.keys().next().value;
    fixturePaletteSequenceCache.delete(firstKey);
  }
  return out;
}

function getPaletteConfigFingerprint(config = {}) {
  const normalized = normalizePaletteConfigSnapshot(config, PALETTE_CONFIG_DEFAULT);
  const normalizedFamilies = normalizePaletteFamilies(
    normalized.families,
    PALETTE_CONFIG_DEFAULT.families
  );
  const familyCountFingerprint = normalizedFamilies
    .map(familyId => `${familyId}:${resolvePaletteColorCountForFamily(
      normalized,
      familyId,
      normalized.colorsPerFamily
    )}`)
    .join(",");
  return [
    String(normalized.colorsPerFamily),
    familyCountFingerprint,
    normalizedFamilies.join(","),
    normalized.disorder ? "1" : "0",
    String(Math.round(normalizePaletteDisorderAggression(normalized.disorderAggression, 0.35) * 1000)),
    normalizePaletteCycleMode(normalized.cycleMode, PALETTE_CONFIG_DEFAULT.cycleMode),
    String(normalizePaletteTimedIntervalSec(normalized.timedIntervalSec, PALETTE_CONFIG_DEFAULT.timedIntervalSec)),
    normalized.beatLock ? "1" : "0",
    String(normalizePaletteBeatLockGraceSec(normalized.beatLockGraceSec, PALETTE_CONFIG_DEFAULT.beatLockGraceSec)),
    String(normalizePaletteReactiveMargin(normalized.reactiveMargin, PALETTE_CONFIG_DEFAULT.reactiveMargin)),
    String(normalizePaletteVividness(normalized.vividness, PALETTE_CONFIG_DEFAULT.vividness)),
    normalizePaletteSpectrumMapMode(normalized.spectrumMapMode, PALETTE_CONFIG_DEFAULT.spectrumMapMode),
    normalizePaletteSpectrumFeatureMap(normalized.spectrumFeatureMap, PALETTE_CONFIG_DEFAULT.spectrumFeatureMap).join(",")
  ].join("|");
}

function getPaletteSignalFromIntent(intent = {}) {
  const raw = intent && typeof intent === "object" ? intent : {};
  const nowMs = Date.now();
  const normalizeUnit = (value, fallback = 0) => clampNumber(Number(value), 0, 1, fallback);
  const normalizeWide = (value, max = 1.5) => clampNumber(Number(value), 0, max, 0) / max;
  const bpm = clampNumber(Number(raw.bpm), 0, 260, 0);
  return {
    nowMs,
    bpm,
    energy: normalizeUnit(raw.energy, normalizeUnit(raw.audioDrive, normalizeUnit(raw.audioSourceLevel, 0))),
    rms: normalizeUnit(raw.rms, normalizeUnit(raw.audioSourceLevel, 0)),
    lows: normalizeUnit(raw.audioBandLow, normalizeUnit(raw.bandLow, 0)),
    mids: normalizeUnit(raw.audioBandMid, normalizeUnit(raw.bandMid, 0)),
    highs: normalizeUnit(raw.audioBandHigh, normalizeUnit(raw.bandHigh, 0)),
    flux: normalizeUnit(raw.audioFlux, normalizeUnit(raw.flux, normalizeUnit(raw.audioMotion, 0))),
    peaks: normalizeWide(raw.audioPeak, 1.5),
    transients: normalizeWide(raw.audioTransient, 1.2),
    beat: raw.beat === true || raw.drop === true
      ? 1
      : normalizeUnit(raw.beatConfidence, 0),
    phrase: String(raw.phrase || "").trim().toLowerCase(),
    scene: String(raw.scene || "").trim().toLowerCase()
  };
}

function getPaletteSignalFeatureValue(signal = null, featureKey = "rms") {
  const src = signal && typeof signal === "object" ? signal : {};
  const feature = normalizePaletteAudioFeatureKey(featureKey, "rms");
  const field = PALETTE_SIGNAL_FEATURE_FIELD_MAP[feature] || "rms";
  return clampNumber(src[field], 0, 1, 0);
}

function getPaletteGroupLengths(config = null) {
  const normalizedConfig = normalizePaletteConfigSnapshot(
    config && typeof config === "object" ? config : PALETTE_CONFIG_DEFAULT,
    PALETTE_CONFIG_DEFAULT
  );
  const selectedFamilies = normalizePaletteFamilies(
    normalizedConfig.families,
    PALETTE_CONFIG_DEFAULT.families
  );
  const lengths = selectedFamilies.map(familyId => resolvePaletteColorCountForFamily(
    normalizedConfig,
    familyId,
    normalizedConfig.colorsPerFamily
  ));
  if (lengths.length) return lengths;
  return [
    normalizePaletteColorCount(
      normalizedConfig.colorsPerFamily,
      PALETTE_CONFIG_DEFAULT.colorsPerFamily
    )
  ];
}

function buildPaletteGroupLayout(config = null, length = 1) {
  const len = Math.max(1, Number(length) || 1);
  const requestedLengths = getPaletteGroupLengths(config);
  const layout = [];
  let cursor = 0;
  for (const requestedLength of requestedLengths) {
    if (cursor >= len) break;
    const remaining = len - cursor;
    const size = clampNumber(Math.round(Number(requestedLength) || 1), 1, remaining, 1);
    layout.push({ start: cursor, length: size });
    cursor += size;
  }
  if (!layout.length) {
    return [{ start: 0, length: len }];
  }
  if (cursor < len) {
    layout[layout.length - 1].length += (len - cursor);
  }
  return layout;
}

function getPaletteGroupIndexForLayout(index, layout = [], length = 1) {
  const len = Math.max(1, Number(length) || 1);
  const safeLayout = Array.isArray(layout) && layout.length
    ? layout
    : [{ start: 0, length: len }];
  const base = ((Number(index) || 0) % len + len) % len;
  for (let i = 0; i < safeLayout.length; i += 1) {
    const group = safeLayout[i];
    const start = clampNumber(Math.round(Number(group.start) || 0), 0, Math.max(0, len - 1), 0);
    const size = clampNumber(Math.round(Number(group.length) || 1), 1, Math.max(1, len - start), 1);
    if (base >= start && base < (start + size)) return i;
  }
  return Math.max(0, safeLayout.length - 1);
}

function getPaletteGroupBaseForLayout(groupIndex, layout = [], length = 1) {
  const len = Math.max(1, Number(length) || 1);
  const safeLayout = Array.isArray(layout) && layout.length
    ? layout
    : [{ start: 0, length: len }];
  const idx = clampNumber(Math.round(Number(groupIndex) || 0), 0, Math.max(0, safeLayout.length - 1), 0);
  const group = safeLayout[idx];
  return clampNumber(Math.round(Number(group.start) || 0), 0, Math.max(0, len - 1), 0);
}

function pickFixturePaletteNextIndex(currentIndex, sequenceLength, config = {}, intent = {}) {
  const len = Math.max(1, Number(sequenceLength) || 1);
  const index = ((Number(currentIndex) || 0) % len + len) % len;
  if (len <= 1) return 0;
  const scope = String(intent?.scope || "color").trim().toLowerCase();
  if (scope === "group") {
    const groupLayout = buildPaletteGroupLayout(config, len);
    const groupCount = Math.max(1, groupLayout.length);
    if (groupCount <= 1) return 0;
    const currentGroup = getPaletteGroupIndexForLayout(index, groupLayout, len);
    const step = Boolean(intent?.drop) && groupCount > 2 ? 2 : 1;
    const nextGroup = (currentGroup + step) % groupCount;
    return getPaletteGroupBaseForLayout(nextGroup, groupLayout, len);
  }
  const isBeat = Boolean(intent?.beat);
  const isDrop = Boolean(intent?.drop);
  if (config.disorder) {
    const aggression = normalizePaletteDisorderAggression(config.disorderAggression, 0.35);
    const jumpChance = Math.max(
      0.12,
      Math.min(0.98, 0.18 + aggression * 0.64 + (isBeat ? 0.1 : 0) + (isDrop ? 0.12 : 0))
    );
    if (Math.random() < jumpChance) {
      const maxJump = Math.max(1, Math.round(1 + aggression * Math.max(1, len - 1)));
      const jump = 1 + Math.floor(Math.random() * maxJump);
      return (index + jump) % len;
    }
    if (isBeat || isDrop) {
      return (index + 1) % len;
    }
    return index;
  }
  let step = 1;
  if (isDrop && len > 2) step = 2;
  return (index + step) % len;
}

function shouldAdvanceFixturePaletteTimed(state = {}, config = {}, intent = {}, signal = {}) {
  const nowMs = clampNumber(signal.nowMs, 0, Number.MAX_SAFE_INTEGER, Date.now());
  const intervalMs = normalizePaletteTimedIntervalSec(
    config.timedIntervalSec,
    PALETTE_CONFIG_DEFAULT.timedIntervalSec
  ) * 1000;
  if (!(Number(state.lastAdvanceAt) > 0)) {
    state.lastAdvanceAt = nowMs;
    state.waitStartAt = 0;
    return false;
  }
  const dueAt = Number(state.lastAdvanceAt) + intervalMs;
  if (nowMs < dueAt) {
    state.waitStartAt = 0;
    return false;
  }
  const beatLock = parseBooleanLoose(config.beatLock, false) === true;
  if (!beatLock) {
    state.waitStartAt = 0;
    state.lastAdvanceAt = nowMs;
    return true;
  }
  if (Boolean(intent?.beat) || Boolean(intent?.drop)) {
    state.waitStartAt = 0;
    state.lastAdvanceAt = nowMs;
    return true;
  }
  const graceMs = normalizePaletteBeatLockGraceSec(
    config.beatLockGraceSec,
    PALETTE_CONFIG_DEFAULT.beatLockGraceSec
  ) * 1000;
  if (!(Number(state.waitStartAt) > 0)) {
    state.waitStartAt = dueAt;
  }
  if ((nowMs - Number(state.waitStartAt)) >= graceMs) {
    state.waitStartAt = 0;
    state.lastAdvanceAt = nowMs;
    return true;
  }
  return false;
}

function computeFixtureReactiveShiftScore(currentSignal = {}, previousSignal = {}, intent = {}, reactiveMargin = PALETTE_CONFIG_DEFAULT.reactiveMargin) {
  const margin = normalizePaletteReactiveMargin(reactiveMargin, PALETTE_CONFIG_DEFAULT.reactiveMargin);
  const marginNorm = clampNumber(
    (margin - PALETTE_REACTIVE_MARGIN_MIN) / Math.max(1, PALETTE_REACTIVE_MARGIN_MAX - PALETTE_REACTIVE_MARGIN_MIN),
    0,
    1,
    0.2
  );
  const sensitivityBoost = 1.65 - (marginNorm * 0.9);
  const bpmScale = Math.max(4, 6 + (margin * 0.34));
  const bpmDelta = Math.abs(Number(currentSignal.bpm || 0) - Number(previousSignal.bpm || 0)) / bpmScale;
  const energyDelta = Math.abs(Number(currentSignal.energy || 0) - Number(previousSignal.energy || 0));
  const fluxDelta = Math.abs(Number(currentSignal.flux || 0) - Number(previousSignal.flux || 0));
  const bandDelta = Math.max(
    Math.abs(Number(currentSignal.lows || 0) - Number(previousSignal.lows || 0)),
    Math.abs(Number(currentSignal.mids || 0) - Number(previousSignal.mids || 0)),
    Math.abs(Number(currentSignal.highs || 0) - Number(previousSignal.highs || 0))
  );
  const phraseShift = currentSignal.phrase && previousSignal.phrase && currentSignal.phrase !== previousSignal.phrase
    ? 0.86
    : 0;
  const sceneShift = currentSignal.scene && previousSignal.scene && currentSignal.scene !== previousSignal.scene
    ? 0.52
    : 0;
  const eventBoost = Boolean(intent?.drop)
    ? 0.66
    : (Boolean(intent?.beat) ? 0.24 : 0);
  const score = (
    (bpmDelta * 1.08) +
    (energyDelta * 1.8 * sensitivityBoost) +
    (fluxDelta * 1.45 * sensitivityBoost) +
    (bandDelta * 1.24 * sensitivityBoost) +
    phraseShift +
    sceneShift +
    eventBoost
  );
  const threshold = 1.04 + (marginNorm * 0.84);
  return { score, threshold };
}

function shouldAdvanceFixturePaletteReactive(state = {}, config = {}, intent = {}, signal = {}) {
  const nowMs = clampNumber(signal.nowMs, 0, Number.MAX_SAFE_INTEGER, Date.now());
  const previousSignal = state.lastSignal && typeof state.lastSignal === "object"
    ? state.lastSignal
    : null;
  state.lastSignal = {
    bpm: clampNumber(signal.bpm, 0, 260, 0),
    energy: clampNumber(signal.energy, 0, 1, 0),
    lows: clampNumber(signal.lows, 0, 1, 0),
    mids: clampNumber(signal.mids, 0, 1, 0),
    highs: clampNumber(signal.highs, 0, 1, 0),
    flux: clampNumber(signal.flux, 0, 1, 0),
    phrase: String(signal.phrase || "").trim().toLowerCase(),
    scene: String(signal.scene || "").trim().toLowerCase()
  };
  if (!previousSignal) {
    state.lastAdvanceAt = nowMs;
    return false;
  }
  const margin = normalizePaletteReactiveMargin(config.reactiveMargin, PALETTE_CONFIG_DEFAULT.reactiveMargin);
  const cooldownMs = 260 + Math.round(margin * 7.2);
  if ((nowMs - Number(state.lastAdvanceAt || 0)) < cooldownMs) {
    return false;
  }
  const scored = computeFixtureReactiveShiftScore(signal, previousSignal, intent, margin);
  if (scored.score >= scored.threshold) {
    state.lastAdvanceAt = nowMs;
    return true;
  }
  return false;
}

function resolveFixtureSpectrumFeatureMap(config = {}) {
  const mode = normalizePaletteSpectrumMapMode(config.spectrumMapMode, PALETTE_CONFIG_DEFAULT.spectrumMapMode);
  if (mode === "manual") {
    return normalizePaletteSpectrumFeatureMap(
      config.spectrumFeatureMap,
      PALETTE_CONFIG_DEFAULT.spectrumFeatureMap
    );
  }
  return PALETTE_CONFIG_DEFAULT.spectrumFeatureMap.slice();
}

function pickFixtureSpectrumPaletteIndex(sequenceLength, config = {}, signal = {}, state = {}) {
  const len = Math.max(1, Number(sequenceLength) || 1);
  if (len <= 1) return 0;
  const featureMap = resolveFixtureSpectrumFeatureMap(config);
  const values = [];
  for (let i = 0; i < len; i += 1) {
    const feature = featureMap[i % featureMap.length];
    const value = getPaletteSignalFeatureValue(signal, feature);
    values.push(value);
  }
  let bestIndex = 0;
  let bestValue = values[0] || 0;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] > bestValue) {
      bestValue = values[i];
      bestIndex = i;
    }
  }
  const previousIndex = clampNumber(Number(state.lastSpectrumIndex), 0, Math.max(0, len - 1), 0);
  const previousValue = values[previousIndex] || 0;
  const nowMs = clampNumber(signal.nowMs, 0, Number.MAX_SAFE_INTEGER, Date.now());
  const activity = clampNumber(
    Math.max(
      clampNumber(signal.energy, 0, 1, 0),
      clampNumber(signal.flux, 0, 1, 0),
      clampNumber(signal.beat, 0, 1, 0)
    ),
    0,
    1,
    0
  );
  const minHoldMs = Math.round(140 + ((1 - activity) * 220));
  const lastSwitchAt = clampNumber(state.lastSpectrumSwitchAt, 0, Number.MAX_SAFE_INTEGER, 0);
  if (
    bestIndex !== previousIndex &&
    lastSwitchAt > 0 &&
    (nowMs - lastSwitchAt) < minHoldMs
  ) {
    return previousIndex;
  }
  const requiredDelta = 0.045 + ((1 - activity) * 0.03);
  if (previousIndex >= 0 && (bestValue - previousValue) < requiredDelta) {
    return previousIndex;
  }
  if (bestIndex !== previousIndex) {
    state.lastSpectrumSwitchAt = nowMs;
  }
  return bestIndex;
}

function resolvePaletteMotionMetricKey(fixtureId = "", brandKey = "", telemetry = {}) {
  const id = String(fixtureId || "").trim();
  const brand = normalizePaletteBrandKey(brandKey);
  if (!id || !brand) return "baseline";
  if (!hasFixtureMetricRoutingActiveConfig(id, brand)) return "baseline";
  const scoped = getScopedFixtureMetricConfig(id, brand);
  const mode = normalizeFixtureMetricMode(scoped.mode, FIXTURE_METRIC_CONFIG_DEFAULT.mode);
  if (mode !== "meta_auto") {
    return normalizeFixtureMetricKey(scoped.metric, FIXTURE_METRIC_CONFIG_DEFAULT.metric);
  }
  const dominant = String(telemetry?.metaAutoDominantTracker || "").trim().toLowerCase();
  if (dominant) {
    return normalizeFixtureMetricKey(dominant, FIXTURE_METRIC_CONFIG_DEFAULT.metric);
  }
  return FIXTURE_METRIC_CONFIG_DEFAULT.metric;
}

function resolveFixturePaletteMotionProfile(
  fixtureId = "",
  brandKey = "",
  intent = {},
  signal = {},
  state = {}
) {
  const telemetry = engine?.getTelemetry?.() || {};
  const metricKey = resolvePaletteMotionMetricKey(fixtureId, brandKey, telemetry);
  const metricLevel = clampNumber(
    resolveFixtureMetricLevel(metricKey, telemetry, intent),
    0,
    1,
    0
  );
  const nowMs = clampNumber(signal.nowMs, 0, Number.MAX_SAFE_INTEGER, Date.now());
  const rms = clampNumber(signal.rms, 0, 1, 0);
  const energy = clampNumber(signal.energy, 0, 1, rms);
  const transients = clampNumber(signal.transients, 0, 1, 0);
  const flux = clampNumber(signal.flux, 0, 1, 0);
  const beat = clampNumber(signal.beat, 0, 1, 0);
  const peaksMetric = metricKey === "peaks";
  const transientsMetric = metricKey === "transients";
  const fluxMetric = metricKey === "flux";
  const low = clampNumber(signal.lows, 0, 1, 0);
  const mid = clampNumber(signal.mids, 0, 1, 0);
  const high = clampNumber(signal.highs, 0, 1, 0);
  const drums = clamp01(
    (low * 0.55) +
    (transients * 0.28) +
    (flux * 0.17) +
    (beat * 0.1),
    0
  );
  const weightedMetricLevel = metricKey === "baseline"
    ? clamp01((metricLevel * 0.7) + (drums * 0.3), metricLevel)
    : peaksMetric
      ? clamp01(
        (metricLevel * 0.86) +
        (transients * 0.09) +
        (flux * 0.05),
        metricLevel
      )
      : transientsMetric
        ? clamp01(
          (metricLevel * 0.84) +
          (flux * 0.1) +
          (drums * 0.06),
          metricLevel
        )
        : fluxMetric
          ? clamp01(
            (metricLevel * 0.84) +
            (transients * 0.1) +
            (energy * 0.06),
            metricLevel
          )
        : metricLevel;
  const supportLevel = peaksMetric
    ? clamp01(
      (transients * 0.46) +
      (flux * 0.3) +
      (energy * 0.14) +
      (rms * 0.1),
      0
    )
    : transientsMetric
      ? clamp01(
        (transients * 0.56) +
        (flux * 0.24) +
        (energy * 0.12) +
        (rms * 0.08),
        0
      )
      : fluxMetric
        ? clamp01(
          (flux * 0.58) +
          (transients * 0.24) +
          (energy * 0.12) +
          (rms * 0.06),
          0
        )
      : clamp01(
        (energy * 0.36) +
        (rms * 0.2) +
        (transients * 0.22) +
        (flux * 0.22),
        0
      );
  const rawLevel = clamp01(
    (weightedMetricLevel * 0.82) + (supportLevel * 0.18),
    weightedMetricLevel
  );
  const previousEma = clampNumber(Number(state.motionEma), 0, 1, rawLevel);
  const alpha = rawLevel >= previousEma
    ? (peaksMetric ? 0.34 : (transientsMetric ? 0.36 : (fluxMetric ? 0.32 : 0.24)))
    : (peaksMetric ? 0.2 : (transientsMetric ? 0.18 : (fluxMetric ? 0.16 : 0.1)));
  const level = clampNumber(previousEma + ((rawLevel - previousEma) * alpha), 0, 1, rawLevel);
  state.motionEma = level;
  const previousMetricLevel = clampNumber(Number(state.lastMetricLevel), 0, 1, metricLevel);
  const previousMotionLevel = clampNumber(Number(state.lastMotionLevel), 0, 1, level);
  const metricRise = Math.max(0, metricLevel - previousMetricLevel);
  const motionRise = Math.max(0, level - previousMotionLevel);
  state.lastMetricLevel = metricLevel;
  state.lastMotionLevel = level;

  const driveBase = peaksMetric
    ? clamp01(
      Math.max(
        (metricLevel * 0.9) + (transients * 0.08) + (flux * 0.02),
        (level * 0.86) + (metricRise * 0.54),
        (transients * 0.62) + (flux * 0.38)
      ),
      metricLevel
    )
    : transientsMetric
      ? clamp01(
        Math.max(
          (metricLevel * 0.84) + (flux * 0.16),
          (level * 0.9) + (metricRise * 0.42),
          (transients * 0.74) + (flux * 0.26)
        ),
        metricLevel
      )
      : fluxMetric
        ? clamp01(
          Math.max(
            (metricLevel * 0.86) + (transients * 0.14),
            (level * 0.88) + (metricRise * 0.48),
            (flux * 0.78) + (transients * 0.22)
          ),
          metricLevel
        )
      : clamp01(
        Math.max(
          metricLevel,
          level * 0.94,
          supportLevel * 0.88,
          (transients * 0.72) + (flux * 0.28)
        ),
        metricLevel
      );
  const drive = clamp01(Math.pow(driveBase, 0.72), driveBase);
  const impulse = peaksMetric
    ? clamp01(
      (metricRise * 1.75) +
      (motionRise * 1.05) +
      (transients * 0.14) +
      (flux * 0.08),
      0
    )
    : transientsMetric
      ? clamp01(
        (metricRise * 1.55) +
        (motionRise * 1.22) +
        (transients * 0.2) +
        (flux * 0.1),
        0
      )
      : fluxMetric
        ? clamp01(
          (metricRise * 1.4) +
          (motionRise * 1.18) +
          (flux * 0.24) +
          (transients * 0.12),
          0
        )
      : clamp01(
        (metricRise * 1.3) +
        (motionRise * 1.12) +
        (transients * 0.18) +
        (flux * 0.12),
        0
      );

  const silenceEvidence = clamp01(
    Math.max(
      rms,
      energy * 0.94,
      transients * 0.88,
      flux * 0.86,
      low * 0.74,
      mid * 0.7,
      high * 0.7,
      metricLevel * 0.92,
      beat * 0.84
    ),
    0
  );
  const silent = peaksMetric
    ? (silenceEvidence < 0.035 && level < 0.055 && drive < 0.06)
    : transientsMetric
      ? (silenceEvidence < 0.036 && level < 0.054 && drive < 0.058)
      : fluxMetric
        ? (silenceEvidence < 0.034 && level < 0.052 && drive < 0.056)
      : (silenceEvidence < 0.04 && level < 0.06 && drive < 0.065);

  return {
    nowMs,
    metricKey,
    level,
    metricLevel,
    drive,
    impulse,
    silent
  };
}

function pickFixturePaletteColor(fixtureId, brandKey, intent = {}, configOverride = null) {
  const config = configOverride && typeof configOverride === "object"
    ? configOverride
    : getFixturePaletteOverrideConfig(fixtureId, brandKey);
  if (!config) return null;
  const sequence = buildPaletteSequence(config);
  if (!sequence.length) return null;

  const id = String(fixtureId || "").trim();
  if (!id) return null;
  const fingerprint = getPaletteConfigFingerprint(config);
  const signal = getPaletteSignalFromIntent(intent);
  const nowMs = signal.nowMs;
  let state = fixturePaletteSequenceState.get(id);
  if (!state || state.fingerprint !== fingerprint || Number(state.length) !== sequence.length) {
    state = {
      index: 0,
      colorOffset: 0,
      fingerprint,
      length: sequence.length,
      lastAdvanceAt: nowMs,
      waitStartAt: 0,
      lastSignal: null,
      lastSpectrumIndex: 0,
      lastSpectrumSwitchAt: 0,
      lastColorShiftAt: nowMs,
      lastColorTickAt: nowMs,
      colorPhase: 0,
      motionEma: 0,
      lastMetricLevel: 0,
      lastMotionLevel: 0
    };
  }

  const mode = normalizePaletteCycleMode(config.cycleMode, PALETTE_CONFIG_DEFAULT.cycleMode);
  const groupLayout = buildPaletteGroupLayout(config, sequence.length);
  const groupCount = Math.max(1, groupLayout.length);
  let index = getPaletteGroupBaseForLayout(
    getPaletteGroupIndexForLayout(Number(state.index) || 0, groupLayout, sequence.length),
    groupLayout,
    sequence.length
  );
  const motionProfile = resolveFixturePaletteMotionProfile(id, brandKey, intent, signal, state);
  const applyGroupColorOffset = () => {
    const groupIndex = getPaletteGroupIndexForLayout(index, groupLayout, sequence.length);
    const group = groupLayout[groupIndex] || { start: 0, length: sequence.length };
    const baseIndex = clampNumber(Math.round(Number(group.start) || 0), 0, Math.max(0, sequence.length - 1), 0);
    index = baseIndex;
    const groupSpan = Math.max(1, Math.min(group.length, sequence.length - baseIndex));
    let offset = clampNumber(Math.round(Number(state.colorOffset) || 0), 0, Math.max(0, groupSpan - 1), 0);
    let phase = Number(state.colorPhase);
    if (!Number.isFinite(phase)) phase = offset;
    if (groupSpan <= 1) {
      offset = 0;
      state.colorOffset = offset;
      state.colorPhase = 0;
      return baseIndex + offset;
    }

    const prevTickAt = clampNumber(Number(state.lastColorTickAt), 0, Number.MAX_SAFE_INTEGER, 0);
    const dtMs = prevTickAt > 0
      ? clampNumber(nowMs - prevTickAt, 8, 360, 66)
      : 66;
    state.lastColorTickAt = nowMs;

    const metricLevel = clampNumber(motionProfile.metricLevel, 0, 1, 0);
    const motionLevel = clampNumber(motionProfile.level, 0, 1, metricLevel);
    const drive = clampNumber(motionProfile.drive, 0, 1, clamp01(Math.max(metricLevel, motionLevel), metricLevel));
    const impulse = clampNumber(motionProfile.impulse, 0, 1, 0);
    const metricKey = String(motionProfile.metricKey || "baseline").trim().toLowerCase();
    const peaksMetric = metricKey === "peaks";
    const transientsMetric = metricKey === "transients";
    const fluxMetric = metricKey === "flux";
    const aggression = normalizePaletteDisorderAggression(config.disorderAggression, 0.35);
    const motionPace = peaksMetric
      ? clamp01(
        (drive * 0.56) +
        (motionLevel * 0.2) +
        (impulse * 0.94) +
        (metricLevel * 0.22),
        drive
      )
      : transientsMetric
        ? clamp01(
          (drive * 0.6) +
          (motionLevel * 0.22) +
          (impulse * 0.86) +
          (metricLevel * 0.14),
          drive
        )
        : fluxMetric
          ? clamp01(
            (drive * 0.64) +
            (motionLevel * 0.24) +
            (impulse * 0.74) +
            (metricLevel * 0.18),
            drive
          )
        : clamp01(
          (drive * 0.72) +
          (motionLevel * 0.24) +
          (impulse * 0.58),
          drive
        );
    const cadencePerSec = config.disorder
      ? (
        peaksMetric
          ? (0.18 + motionPace * 6.1 + aggression * 1.1)
          : transientsMetric
            ? (0.17 + motionPace * 5.8 + aggression * 1.12)
            : fluxMetric
              ? (0.18 + motionPace * 5.95 + aggression * 1.08)
            : (0.16 + motionPace * 5.2 + aggression * 1.15)
      )
      : (
        peaksMetric
          ? (0.14 + motionPace * 5.35)
          : transientsMetric
            ? (0.13 + motionPace * 4.95)
            : fluxMetric
              ? (0.14 + motionPace * 5.2)
            : (0.12 + motionPace * 4.4)
      );
    const allowMotion = !motionProfile.silent && motionPace >= (
      config.disorder
        ? 0.008
        : (peaksMetric ? 0.005 : (transientsMetric ? 0.0055 : (fluxMetric ? 0.0052 : 0.006)))
    );
    const phaseAdvance = allowMotion
      ? ((cadencePerSec * dtMs) / 1000)
      : 0;

    if (!(phaseAdvance > 0)) {
      state.colorOffset = offset;
      state.colorPhase = phase;
      return baseIndex + offset;
    }

    const prevPhase = phase;
    phase += phaseAdvance;
    state.colorPhase = phase;

    let nextOffset = offset;
    if (config.disorder) {
      const crossedSteps = Math.max(0, Math.floor(phase) - Math.floor(prevPhase));
      if (!(crossedSteps > 0)) {
        state.colorOffset = nextOffset;
        return baseIndex + nextOffset;
      }
      const randomChance = clampNumber(
        (0.22 + aggression * 0.54 + motionPace * 0.24 + impulse * (peaksMetric ? 0.3 : (transientsMetric ? 0.26 : (fluxMetric ? 0.24 : 0.18)))),
        0.08,
        0.98,
        0.42
      );
      if (Math.random() < randomChance && groupSpan > 2) {
        nextOffset = Math.floor(Math.random() * groupSpan);
      } else {
        const shouldDoubleStep = groupSpan > 3 && (
          aggression > 0.62 ||
          (peaksMetric ? impulse > 0.34 : (transientsMetric ? impulse > 0.32 : (fluxMetric ? impulse > 0.36 : impulse > 0.42)))
        );
        const step = shouldDoubleStep ? 2 : 1;
        nextOffset = (nextOffset + step) % groupSpan;
      }
    } else {
      nextOffset = ((Math.floor(phase) % groupSpan) + groupSpan) % groupSpan;
    }

    if (nextOffset !== offset) {
      state.lastColorShiftAt = nowMs;
    }
    state.colorOffset = nextOffset;
    return baseIndex + nextOffset;
  };

  let emitIndex = index;
  if (mode === "spectrum_mapper") {
    const groupIndex = pickFixtureSpectrumPaletteIndex(groupCount, config, signal, state);
    index = getPaletteGroupBaseForLayout(groupIndex, groupLayout, sequence.length);
    state.index = index;
    state.lastSpectrumIndex = clampNumber(groupIndex, 0, Math.max(0, groupCount - 1), 0);
    state.lastAdvanceAt = nowMs;
    emitIndex = applyGroupColorOffset();
  } else if (mode === "timed_cycle") {
    const shouldAdvance = shouldAdvanceFixturePaletteTimed(state, config, intent, signal);
    if (shouldAdvance) {
      index = pickFixturePaletteNextIndex(index, sequence.length, config, { ...intent, scope: "group" });
      state.index = index;
    }
    emitIndex = applyGroupColorOffset();
  } else if (mode === "reactive_shift") {
    const shouldAdvance = shouldAdvanceFixturePaletteReactive(state, config, intent, signal);
    if (shouldAdvance) {
      index = pickFixturePaletteNextIndex(index, sequence.length, config, { ...intent, scope: "group" });
      state.index = index;
      state.lastSpectrumIndex = getPaletteGroupIndexForLayout(index, groupLayout, sequence.length);
    }
    emitIndex = applyGroupColorOffset();
  } else {
    // on_trigger: advance palette group only on beat/drop triggers.
    const triggerAdvance = Boolean(intent?.beat || intent?.drop);
    if (triggerAdvance) {
      const nextIndex = pickFixturePaletteNextIndex(index, sequence.length, config, { ...intent, scope: "group" });
      state.index = nextIndex;
      index = getPaletteGroupBaseForLayout(
        getPaletteGroupIndexForLayout(nextIndex, groupLayout, sequence.length),
        groupLayout,
        sequence.length
      );
      state.lastAdvanceAt = nowMs;
      state.lastSpectrumIndex = getPaletteGroupIndexForLayout(index, groupLayout, sequence.length);
    }
    emitIndex = applyGroupColorOffset();
  }

  fixturePaletteSequenceState.set(id, {
    ...state,
    fingerprint,
    length: sequence.length
  });

  return {
    r: clampRgb255((sequence[emitIndex] || sequence[0]).r),
    g: clampRgb255((sequence[emitIndex] || sequence[0]).g),
    b: clampRgb255((sequence[emitIndex] || sequence[0]).b)
  };
}

function normalizePaletteBrightnessStateColor(color = null) {
  if (!color || typeof color !== "object") return null;
  return {
    r: clampRgb255(color.r),
    g: clampRgb255(color.g),
    b: clampRgb255(color.b)
  };
}

function computePaletteColorMotion(previousColor = null, nextColor = null) {
  const prev = normalizePaletteBrightnessStateColor(previousColor);
  const next = normalizePaletteBrightnessStateColor(nextColor);
  if (!prev || !next) return 0;
  const prevHsv = rgbToHsv255(prev);
  const nextHsv = rgbToHsv255(next);
  const hueDelta = Math.abs((((Number(nextHsv.h || 0) - Number(prevHsv.h || 0)) + 540) % 360) - 180) / 180;
  const satDelta = Math.abs(Number(nextHsv.s || 0) - Number(prevHsv.s || 0));
  const valueDelta = Math.abs(Number(nextHsv.v || 0) - Number(prevHsv.v || 0));
  return clamp01((hueDelta * 0.56) + (satDelta * 0.24) + (valueDelta * 0.2), 0);
}

function getPaletteBrightnessStateKey(brandKey = "", fixtureId = "") {
  const brand = normalizePaletteBrandKey(brandKey);
  const id = String(fixtureId || "").trim();
  if (!brand || !id) return "";
  return `${brand}:${id.toLowerCase()}`;
}

function resolvePaletteBrightnessFollowDrive(intent = {}, colorMotion = 0) {
  const signal = getPaletteSignalFromIntent(intent);
  const baseline = clampNumber(signal.rms, 0, 1, 0);
  const energy = clampNumber(signal.energy, 0, 1, baseline);
  const transients = clampNumber(signal.transients, 0, 1, 0);
  const flux = clampNumber(signal.flux, 0, 1, 0);
  const beat = clampNumber(signal.beat, 0, 1, 0);
  const drums = clamp01(
    (signal.lows * 0.54) +
    (transients * 0.28) +
    (flux * 0.18) +
    (beat * 0.14),
    0
  );
  const scene = String(signal.scene || "").trim().toLowerCase();
  const sceneBoost = scene === "pulse_strobe"
    ? 0.12
    : (scene.startsWith("flow_") ? 0.08 : 0);
  const phrase = String(signal.phrase || "").trim().toLowerCase();
  const phraseBoost = phrase === "drop"
    ? 0.1
    : (phrase === "build" ? 0.06 : 0);
  const dropBoost = intent?.drop ? 0.2 : 0;

  const reactiveDrive = clamp01(
    (energy * 0.3) +
    (drums * 0.3) +
    (transients * 0.16) +
    (flux * 0.14) +
    (beat * 0.1) +
    sceneBoost +
    phraseBoost +
    dropBoost,
    0
  );
  const punch = clamp01(
    (transients * 0.46) +
    (flux * 0.24) +
    (beat * 0.18) +
    (drums * 0.2),
    0
  );
  const silenceEvidence = clamp01(
    Math.max(
      baseline * 0.95,
      energy * 0.96,
      drums * 0.98,
      transients * 0.9,
      flux * 0.88,
      beat * 0.84
    ),
    0
  );
  const combinedDrive = clamp01(
    Math.max(
      (reactiveDrive * 0.7) + (colorMotion * 0.2) + (punch * 0.1),
      (colorMotion * 0.5) + (transients * 0.28) + (flux * 0.22)
    ),
    reactiveDrive
  );
  const silent = silenceEvidence < 0.04 && combinedDrive < 0.075;
  return {
    combinedDrive,
    reactiveDrive,
    punch,
    silenceEvidence,
    silent
  };
}

function applyPaletteBrightnessFollowToHueState(
  state = {},
  fixtureId = "",
  config = {},
  intent = {},
  color = null
) {
  const source = state && typeof state === "object" ? state : null;
  if (!source || source.on === false) return source;
  const fixtureKey = getPaletteBrightnessStateKey("hue", fixtureId);
  if (!fixtureKey) return source;

  const brightnessMode = normalizePaletteBrightnessMode(
    config?.brightnessMode,
    PALETTE_CONFIG_DEFAULT.brightnessMode
  );
  if (brightnessMode !== "test") {
    fixturePaletteBrightnessState.delete(fixtureKey);
    return source;
  }

  const followAmount = normalizePaletteBrightnessFollowAmount(
    config?.brightnessFollowAmount,
    PALETTE_CONFIG_DEFAULT.brightnessFollowAmount
  );
  if (followAmount <= 0) {
    fixturePaletteBrightnessState.set(fixtureKey, {
      ema: clampNumber(source.bri, 1, 254, 160),
      color: normalizePaletteBrightnessStateColor(color)
    });
    return source;
  }

  const runtimeState = fixturePaletteBrightnessState.get(fixtureKey) || {};
  const safeColor = normalizePaletteBrightnessStateColor(color) || runtimeState.color || null;
  const colorMotion = computePaletteColorMotion(runtimeState.color, safeColor);
  const drive = resolvePaletteBrightnessFollowDrive(intent, colorMotion);
  const followGain = clampNumber(0.68 + (followAmount * 0.44), 0.2, 1.6, 1);
  const dynamicDrive = clamp01(
    (drive.combinedDrive * followGain * 1.08) + (drive.punch * 0.12),
    0
  );

  const baseBri = clampNumber(source.bri, 1, 254, 160);
  const floorPercent = clampNumber(
    0.12 + ((1 - dynamicDrive) * 0.44) - (colorMotion * 0.16) - (drive.punch * 0.08),
    0.03,
    0.86,
    0.24
  );
  const floorBri = Math.max(1, Math.min(254, Math.round(baseBri * floorPercent)));
  let targetBri = floorBri + (
    (baseBri - floorBri) *
    clampNumber(0.44 + (dynamicDrive * 1.04) + (drive.punch * 0.16), 0.12, 1.44, 0.86)
  );
  if (dynamicDrive > 0.86) {
    const headroom = Math.max(0, 254 - baseBri);
    const spike = clampNumber((dynamicDrive - 0.86) / 0.14, 0, 1, 0);
    targetBri = Math.max(
      targetBri,
      baseBri + (headroom * spike * (0.45 + colorMotion * 0.4))
    );
  }
  if (drive.silent) {
    const silentCap = Math.max(1, Math.round(baseBri * clampNumber(0.08 + (followAmount * 0.06), 0.08, 0.2, 0.12)));
    targetBri = Math.min(targetBri, silentCap);
  }
  targetBri = clampNumber(Math.round(targetBri), 1, 254, baseBri);

  const previousEma = Number(runtimeState.ema);
  const seeded = Number.isFinite(previousEma)
    ? clampNumber(previousEma, 1, 254, baseBri)
    : baseBri;
  const riseAlpha = clampNumber(
    0.22 +
      (dynamicDrive * 0.26) +
      (colorMotion * 0.2) +
      (drive.punch * 0.12) +
      (intent?.beat ? 0.08 : 0) +
      (intent?.drop ? 0.14 : 0),
    0.16,
    0.86,
    0.36
  );
  const fallAlpha = clampNumber(
    0.14 + ((1 - dynamicDrive) * 0.2) + (colorMotion * 0.08),
    0.06,
    0.46,
    0.22
  );
  const alpha = targetBri >= seeded
    ? riseAlpha
    : Math.max(fallAlpha, drive.silent ? 0.56 : 0);
  const smoothed = clampNumber(Math.round(seeded + ((targetBri - seeded) * alpha)), 1, 254, targetBri);

  fixturePaletteBrightnessState.set(fixtureKey, {
    ema: smoothed,
    color: safeColor
  });

  if (smoothed === baseBri) return source;
  return {
    ...source,
    bri: smoothed
  };
}

function applyPaletteBrightnessFollowToWizState(
  state = {},
  fixtureId = "",
  config = {},
  intent = {},
  color = null
) {
  const source = state && typeof state === "object" ? state : null;
  if (!source || source.on === false) return source;
  const fixtureKey = getPaletteBrightnessStateKey("wiz", fixtureId);
  if (!fixtureKey) return source;

  const brightnessMode = normalizePaletteBrightnessMode(
    config?.brightnessMode,
    PALETTE_CONFIG_DEFAULT.brightnessMode
  );
  if (brightnessMode !== "test") {
    fixturePaletteBrightnessState.delete(fixtureKey);
    return source;
  }

  const followAmount = normalizePaletteBrightnessFollowAmount(
    config?.brightnessFollowAmount,
    PALETTE_CONFIG_DEFAULT.brightnessFollowAmount
  );
  const baseDimming = clampNumber(
    source.dimming,
    1,
    100,
    Math.round(clampNumber(source.brightness, 0.01, 1, 0.72) * 100)
  );
  if (followAmount <= 0) {
    fixturePaletteBrightnessState.set(fixtureKey, {
      ema: baseDimming,
      color: normalizePaletteBrightnessStateColor(color)
    });
    return source;
  }

  const runtimeState = fixturePaletteBrightnessState.get(fixtureKey) || {};
  const safeColor = normalizePaletteBrightnessStateColor(color) || runtimeState.color || null;
  const colorMotion = computePaletteColorMotion(runtimeState.color, safeColor);
  const drive = resolvePaletteBrightnessFollowDrive(intent, colorMotion);
  const followGain = clampNumber(0.68 + (followAmount * 0.44), 0.2, 1.6, 1);
  const dynamicDrive = clamp01(
    (drive.combinedDrive * followGain * 1.08) + (drive.punch * 0.12),
    0
  );

  const floorPercent = clampNumber(
    0.1 + ((1 - dynamicDrive) * 0.48) - (colorMotion * 0.12) - (drive.punch * 0.1),
    0.02,
    0.86,
    0.24
  );
  const floor = Math.max(1, Math.min(100, Math.round(baseDimming * floorPercent)));
  let targetDimming = floor + (
    (baseDimming - floor) *
    clampNumber(0.42 + (dynamicDrive * 1.08) + (drive.punch * 0.16), 0.12, 1.46, 0.86)
  );
  if (dynamicDrive > 0.86) {
    const headroom = Math.max(0, 100 - baseDimming);
    const spike = clampNumber((dynamicDrive - 0.86) / 0.14, 0, 1, 0);
    targetDimming = Math.max(
      targetDimming,
      baseDimming + (headroom * spike * (0.42 + colorMotion * 0.4))
    );
  }
  if (drive.silent) {
    const silentCap = Math.max(1, Math.round(baseDimming * clampNumber(0.04 + (followAmount * 0.06), 0.04, 0.18, 0.1)));
    targetDimming = Math.min(targetDimming, silentCap);
  }
  targetDimming = clampNumber(Math.round(targetDimming), 1, 100, baseDimming);

  const previousEma = Number(runtimeState.ema);
  const seeded = Number.isFinite(previousEma)
    ? clampNumber(previousEma, 1, 100, baseDimming)
    : baseDimming;
  const riseAlpha = clampNumber(
    0.24 +
      (dynamicDrive * 0.28) +
      (colorMotion * 0.18) +
      (drive.punch * 0.1) +
      (intent?.beat ? 0.08 : 0) +
      (intent?.drop ? 0.12 : 0),
    0.16,
    0.88,
    0.36
  );
  const fallAlpha = clampNumber(
    0.14 + ((1 - dynamicDrive) * 0.2) + (colorMotion * 0.08),
    0.06,
    0.52,
    0.22
  );
  const alpha = targetDimming >= seeded
    ? riseAlpha
    : Math.max(fallAlpha, drive.silent ? 0.64 : 0);
  const smoothed = clampNumber(Math.round(seeded + ((targetDimming - seeded) * alpha)), 1, 100, targetDimming);

  fixturePaletteBrightnessState.set(fixtureKey, {
    ema: smoothed,
    color: safeColor
  });

  if (smoothed === baseDimming) return source;
  const next = {
    ...source,
    dimming: smoothed
  };
  if (Object.prototype.hasOwnProperty.call(next, "brightness")) {
    next.brightness = Math.max(0.01, Math.min(1, smoothed / 100));
  }
  return next;
}

function applyFixturePaletteToHueState(state = {}, fixture = null, intent = {}) {
  const source = state && typeof state === "object" ? state : null;
  if (!source || source.on === false) return source;
  const fixtureId = String(fixture?.id || "").trim();
  if (!fixtureId) return source;
  const config = getFixturePaletteOverrideConfig(fixtureId, "hue");
  if (!config) return source;

  const color = pickFixturePaletteColor(fixtureId, "hue", intent, config);
  const base = color
    ? (() => {
      const hsv = rgbToHsv255(color);
      let hue = Math.round((hsv.h / 360) * 65535) % 65535;
      if (hue < 0) hue += 65535;
      return {
        ...source,
        hue,
        sat: Math.max(0, Math.min(254, Math.round((Number(hsv.s) || 0) * 254)))
      };
    })()
    : source;

  const metricApplied = applyFixtureMetricToHueState(base, fixture, intent);
  return applyPaletteBrightnessFollowToHueState(metricApplied, fixtureId, config, intent, color);
}

function applyFixturePaletteToWizState(state = {}, fixtureId = "", intent = {}) {
  const source = state && typeof state === "object" ? state : null;
  if (!source || source.on === false) return source;
  const id = String(fixtureId || "").trim();
  if (!id) return source;
  const config = getFixturePaletteOverrideConfig(id, "wiz");
  if (!config) return source;

  const color = pickFixturePaletteColor(id, "wiz", intent, config);
  const next = color
    ? {
      ...source,
      r: clampRgb255(color.r),
      g: clampRgb255(color.g),
      b: clampRgb255(color.b)
    }
    : { ...source };
  if (Object.prototype.hasOwnProperty.call(next, "temp")) {
    delete next.temp;
  }
  const metricApplied = applyFixtureMetricToWizState(next, id, intent);
  return applyPaletteBrightnessFollowToWizState(metricApplied, id, config, intent, color);
}

function setFixturePaletteOverrideConfig(patch = {}) {
  const next = patch && typeof patch === "object" ? patch : {};
  const fixtureId = String(next.fixtureId || "").trim();
  if (!fixtureId) {
    return { ok: false, status: 400, error: "missing fixtureId" };
  }

  const fixtures = fixtureRegistry.getFixtures?.() || [];
  const fixture = fixtures.find(item => String(item?.id || "").trim() === fixtureId) || null;
  if (!fixture) {
    return { ok: false, status: 404, error: "fixture not found" };
  }

  const fixtureBrand = normalizePaletteBrandKey(fixture.brand);
  if (!fixtureBrand) {
    return {
      ok: false,
      status: 400,
      error: `fixture brand '${String(fixture.brand || "unknown")}' does not support palette overrides`
    };
  }

  const requestedBrand = normalizePaletteBrandKey(next.brand);
  if (requestedBrand && requestedBrand !== fixtureBrand) {
    return {
      ok: false,
      status: 400,
      error: `fixtureId '${fixtureId}' belongs to brand '${fixtureBrand}', not '${requestedBrand}'`
    };
  }

  const clearRequested = parseBooleanLoose(next.clearOverride, false) === true;
  if (clearRequested) {
    if (paletteFixtureOverridesRuntime.fixtures[fixtureId]) {
      const fixturesNext = { ...paletteFixtureOverridesRuntime.fixtures };
      delete fixturesNext[fixtureId];
      paletteFixtureOverridesRuntime = writePaletteFixtureOverridesConfig({
        ...paletteFixtureOverridesRuntime,
        fixtures: fixturesNext
      });
    }
    fixturePaletteSequenceState.delete(fixtureId);
    fixturePaletteBrightnessState.delete(getPaletteBrightnessStateKey(fixtureBrand, fixtureId));
    return {
      ok: true,
      fixtureId,
      brand: fixtureBrand,
      cleared: true
    };
  }

  if (!hasPalettePatchFields(next)) {
    return { ok: false, status: 400, error: "no valid palette fields" };
  }

  const base = getEnginePaletteConfigForBrand(fixtureBrand);
  const currentRaw = paletteFixtureOverridesRuntime.fixtures?.[fixtureId] || {};
  const current = normalizePaletteConfigSnapshot(currentRaw, base);
  const updated = applyPaletteConfigPatch({ ...current }, current, next);

  const normalized = normalizePaletteConfigSnapshot(updated, base);
  paletteFixtureOverridesRuntime = writePaletteFixtureOverridesConfig({
    ...paletteFixtureOverridesRuntime,
    fixtures: {
      ...paletteFixtureOverridesRuntime.fixtures,
      [fixtureId]: normalized
    }
  });
  fixturePaletteSequenceState.delete(fixtureId);
  return {
    ok: true,
    fixtureId,
    brand: fixtureBrand,
    cleared: false,
    config: normalized
  };
}

const fixtureMetricAutoStateByScope = new Map();
const fixtureMetricHzClampStateByBrand = {
  hue: new Map(),
  wiz: new Map()
};

function pruneFixtureMetricAutoStateScopes(validFixtureIds = []) {
  const validBrands = new Set(PALETTE_SUPPORTED_BRANDS.map(brand => `brand:${brand}`));
  const validFixtureKeys = new Set(
    (Array.isArray(validFixtureIds) ? validFixtureIds : [])
      .map(id => String(id || "").trim().toLowerCase())
      .filter(Boolean)
      .map(id => `fixture:${id}`)
  );
  const keepKeys = new Set([
    "global",
    ...validBrands,
    ...validFixtureKeys
  ]);
  for (const key of fixtureMetricAutoStateByScope.keys()) {
    if (!keepKeys.has(key)) {
      fixtureMetricAutoStateByScope.delete(key);
    }
  }
}

function getFixtureMetricHzClampStateMap(brandKey) {
  const brand = normalizePaletteBrandKey(brandKey);
  if (!brand) return null;
  const map = fixtureMetricHzClampStateByBrand[brand];
  return map instanceof Map ? map : null;
}

function buildFixtureMetricHzClampDispatchKey(fixtureId, zone, brandKey) {
  const id = String(fixtureId || "").trim().toLowerCase();
  if (!id) return "";
  const brand = normalizePaletteBrandKey(brandKey) || "fixture";
  const zoneKey = normalizeRouteZoneToken(zone, brand);
  return `${id}|${zoneKey || brand}`;
}

function pruneFixtureMetricHzClampState(validFixtureIds = []) {
  const valid = new Set(
    (Array.isArray(validFixtureIds) ? validFixtureIds : [])
      .map(id => String(id || "").trim().toLowerCase())
      .filter(Boolean)
  );
  for (const brand of PALETTE_SUPPORTED_BRANDS) {
    const stateMap = getFixtureMetricHzClampStateMap(brand);
    if (!stateMap) continue;
    for (const key of stateMap.keys()) {
      const fixtureId = String(key || "").split("|")[0];
      if (!fixtureId || !valid.has(fixtureId)) {
        stateMap.delete(key);
      }
    }
  }
}

const FIXTURE_METRIC_PATCH_FIELDS = Object.freeze([
  "mode",
  "metric",
  "metaAutoFlip",
  "harmonySize",
  "maxHz"
]);

function hasFixtureMetricPatchFields(patch = {}) {
  return FIXTURE_METRIC_PATCH_FIELDS.some(key => hasPatchKey(patch, key));
}

function applyFixtureMetricConfigPatch(updated, current, next) {
  if (hasPatchKey(next, "mode")) {
    updated.mode = normalizeFixtureMetricMode(next.mode, current.mode);
  }
  if (hasPatchKey(next, "metric")) {
    updated.metric = normalizeFixtureMetricKey(next.metric, current.metric);
  }
  if (hasPatchKey(next, "metaAutoFlip")) {
    updated.metaAutoFlip = Boolean(next.metaAutoFlip);
  }
  if (hasPatchKey(next, "harmonySize")) {
    updated.harmonySize = normalizeFixtureMetricHarmonySize(next.harmonySize, current.harmonySize);
  }
  if (hasPatchKey(next, "maxHz")) {
    updated.maxHz = normalizeFixtureMetricMaxHz(next.maxHz, current.maxHz);
  }
  return updated;
}

function getFixtureMetricGlobalConfig() {
  return normalizeFixtureMetricConfigSnapshot(
    fixtureMetricRoutingRuntime?.config || {},
    FIXTURE_METRIC_CONFIG_DEFAULT
  );
}

function getFixtureMetricConfigForBrand(brandKey) {
  const brand = normalizePaletteBrandKey(brandKey);
  const globalConfig = getFixtureMetricGlobalConfig();
  if (!brand) return globalConfig;
  const raw = fixtureMetricRoutingRuntime?.brands?.[brand];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return globalConfig;
  return normalizeFixtureMetricConfigSnapshot(raw, globalConfig);
}

function getFixtureMetricOverrideConfig(fixtureId, brandKey) {
  const id = String(fixtureId || "").trim();
  const brand = normalizePaletteBrandKey(brandKey);
  if (!id || !brand) return null;
  const raw = fixtureMetricRoutingRuntime?.fixtures?.[id];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return normalizeFixtureMetricConfigSnapshot(raw, getFixtureMetricConfigForBrand(brand));
}

function getScopedFixtureMetricConfig(fixtureId, brandKey) {
  const brand = normalizePaletteBrandKey(brandKey);
  const id = String(fixtureId || "").trim();
  const brandConfig = getFixtureMetricConfigForBrand(brand);
  if (!id || !brand) return brandConfig;
  const fixtureConfig = getFixtureMetricOverrideConfig(id, brand);
  return fixtureConfig || brandConfig;
}

function getFixtureMetricMaxHzGateMs(fixtureId, brandKey, baseMinIntervalMs = 0) {
  const id = String(fixtureId || "").trim();
  const brand = normalizePaletteBrandKey(brandKey);
  if (!id || !brand) return 0;
  const scoped = getScopedFixtureMetricConfig(id, brand);
  const maxHz = normalizeFixtureMetricMaxHz(scoped?.maxHz, null);
  if (!(Number.isFinite(maxHz) && maxHz > 0)) return 0;
  const clampMs = Math.max(1, Math.round(1000 / maxHz));
  const baseMs = Number(baseMinIntervalMs);
  if (Number.isFinite(baseMs) && baseMs > 0) {
    return Math.max(clampMs, Math.round(baseMs));
  }
  return clampMs;
}

function hasFixtureMetricMaxHzClamp(fixtureId, brandKey) {
  return getFixtureMetricMaxHzGateMs(fixtureId, brandKey, 0) > 0;
}

function shouldDispatchFixtureWithMetricHzClamp(fixtureId, brandKey, zone, options = {}) {
  const id = String(fixtureId || "").trim();
  const brand = normalizePaletteBrandKey(brandKey);
  if (!id || !brand) return true;
  const forceSend = options && options.forceSend === true;
  if (forceSend) return true;
  const gateMs = getFixtureMetricMaxHzGateMs(id, brand, options?.minIntervalMs || 0);
  if (!(gateMs > 0)) return true;

  const stateMap = getFixtureMetricHzClampStateMap(brand);
  if (!stateMap) return true;
  const key = buildFixtureMetricHzClampDispatchKey(id, zone, brand);
  if (!key) return true;

  const now = Date.now();
  const lastAt = Number(stateMap.get(key) || 0);
  if (Number.isFinite(lastAt) && (now - lastAt) < gateMs) {
    return false;
  }
  stateMap.set(key, now);
  return true;
}

function pruneFixtureMetricRoutingOverrides(fixtures = null) {
  const fixtureList = Array.isArray(fixtures)
    ? fixtures
    : (fixtureRegistry.getFixtures?.() || []);
  const fixtureById = new Map(
    fixtureList
      .map(fixture => [String(fixture?.id || "").trim(), fixture])
      .filter(([id]) => Boolean(id))
  );

  const safeCurrent = sanitizeFixtureMetricRoutingConfig(fixtureMetricRoutingRuntime);
  const globalConfig = normalizeFixtureMetricConfigSnapshot(
    safeCurrent.config,
    FIXTURE_METRIC_CONFIG_DEFAULT
  );
  const nextBrands = {};
  for (const brand of PALETTE_SUPPORTED_BRANDS) {
    const rawBrand = safeCurrent.brands?.[brand];
    nextBrands[brand] = rawBrand && typeof rawBrand === "object" && !Array.isArray(rawBrand)
      ? normalizeFixtureMetricConfigSnapshot(rawBrand, globalConfig)
      : null;
  }

  let changed = false;
  const nextFixtures = {};
  for (const [fixtureId, rawConfig] of Object.entries(safeCurrent.fixtures || {})) {
    const fixture = fixtureById.get(fixtureId);
    if (!fixture) {
      changed = true;
      continue;
    }
    const brand = normalizePaletteBrandKey(fixture.brand);
    if (!brand) {
      changed = true;
      continue;
    }
    const fallback = nextBrands[brand] || globalConfig;
    const normalized = normalizeFixtureMetricConfigSnapshot(rawConfig, fallback);
    nextFixtures[fixtureId] = normalized;
    if (JSON.stringify(rawConfig) !== JSON.stringify(normalized)) {
      changed = true;
    }
  }

  pruneFixtureMetricAutoStateScopes(Object.keys(nextFixtures));
  pruneFixtureMetricHzClampState([...fixtureById.keys()]);

  if (
    !changed &&
    (
      Object.keys(nextFixtures).length !== Object.keys(safeCurrent.fixtures || {}).length ||
      JSON.stringify(nextBrands) !== JSON.stringify(safeCurrent.brands || {})
    )
  ) {
    changed = true;
  }

  if (changed) {
    fixtureMetricRoutingRuntime = writeFixtureMetricRoutingConfig({
      ...safeCurrent,
      config: globalConfig,
      brands: nextBrands,
      fixtures: nextFixtures
    });
  } else {
    fixtureMetricRoutingRuntime = {
      ...safeCurrent,
      config: globalConfig,
      brands: nextBrands,
      fixtures: nextFixtures
    };
  }
}

function buildFixtureMetricRoutingSnapshot(fixtures = null) {
  const fixtureList = Array.isArray(fixtures)
    ? fixtures
    : (fixtureRegistry.getFixtures?.() || []);
  pruneFixtureMetricRoutingOverrides(fixtureList);
  const globalConfig = getFixtureMetricGlobalConfig();
  const brands = {};
  for (const brand of PALETTE_SUPPORTED_BRANDS) {
    const brandConfig = getFixtureMetricConfigForBrand(brand);
    brands[brand] = fixtureMetricRoutingRuntime?.brands?.[brand]
      ? normalizeFixtureMetricConfigSnapshot(brandConfig, globalConfig)
      : null;
  }
  return {
    config: globalConfig,
    brands,
    fixtureOverrides: buildFixtureMetricOverrideSnapshotFromList(fixtureList),
    options: {
      modes: FIXTURE_METRIC_MODE_ORDER.slice(),
      metrics: FIXTURE_METRIC_KEYS.slice(),
      harmonyMin: FIXTURE_METRIC_HARMONY_MIN,
      harmonyMax: FIXTURE_METRIC_HARMONY_MAX,
      maxHzMin: FIXTURE_METRIC_MAX_HZ_MIN,
      maxHzMax: FIXTURE_METRIC_MAX_HZ_MAX
    }
  };
}

function buildFixtureMetricOverrideSnapshotFromList(fixtures = []) {
  const fixtureList = Array.isArray(fixtures) ? fixtures : [];
  const fixtureById = new Map(
    fixtureList
      .map(fixture => [String(fixture?.id || "").trim(), fixture])
      .filter(([id]) => Boolean(id))
  );
  const out = {};
  for (const [fixtureId, rawConfig] of Object.entries(fixtureMetricRoutingRuntime.fixtures || {})) {
    const fixture = fixtureById.get(fixtureId);
    if (!fixture) continue;
    const brand = normalizePaletteBrandKey(fixture.brand);
    if (!brand) continue;
    out[fixtureId] = {
      ...normalizeFixtureMetricConfigSnapshot(rawConfig, getFixtureMetricConfigForBrand(brand)),
      fixtureId,
      brand
    };
  }
  return out;
}

function isFixtureMetricConfigNeutral(config = {}, options = {}) {
  const ignoreMaxHz = options && options.ignoreMaxHz === true;
  const normalized = normalizeFixtureMetricConfigSnapshot(config, FIXTURE_METRIC_CONFIG_DEFAULT);
  return (
    normalized.mode === "manual" &&
    normalized.metric === "baseline" &&
    normalized.metaAutoFlip !== true &&
    normalizeFixtureMetricHarmonySize(normalized.harmonySize, 1) === 1 &&
    (
      ignoreMaxHz ||
      normalizeFixtureMetricMaxHz(normalized.maxHz, null) === null
    )
  );
}

function hasFixtureMetricRoutingActiveConfig(fixtureId, brandKey) {
  const brand = normalizePaletteBrandKey(brandKey);
  const id = String(fixtureId || "").trim();
  if (!brand || !id) return false;

  const globalConfig = getFixtureMetricGlobalConfig();
  if (!isFixtureMetricConfigNeutral(globalConfig)) return true;

  const brandOverrideRaw = fixtureMetricRoutingRuntime?.brands?.[brand];
  if (brandOverrideRaw && typeof brandOverrideRaw === "object" && !Array.isArray(brandOverrideRaw)) {
    const brandScoped = normalizeFixtureMetricConfigSnapshot(brandOverrideRaw, globalConfig);
    if (!isFixtureMetricConfigNeutral(brandScoped)) {
      return true;
    }
  }

  const fixtureOverrideRaw = fixtureMetricRoutingRuntime?.fixtures?.[id];
  if (fixtureOverrideRaw && typeof fixtureOverrideRaw === "object" && !Array.isArray(fixtureOverrideRaw)) {
    const fixtureScoped = normalizeFixtureMetricConfigSnapshot(
      fixtureOverrideRaw,
      getFixtureMetricConfigForBrand(brand)
    );
    if (!isFixtureMetricConfigNeutral(fixtureScoped)) {
      return true;
    }
  }
  return false;
}

function resolveFixtureMetricLevel(metricId, telemetry = {}, intent = {}) {
  const t = telemetry && typeof telemetry === "object" ? telemetry : {};
  const i = intent && typeof intent === "object" ? intent : {};
  const baseline = clamp01(t.audioSourceLevel, clamp01(t.rms, clamp01(i.audioSourceLevel, 0)));
  const peaksRaw = clamp01(Number(t.audioPeak || 0) / 1.5, 0);
  const transientsRaw = clamp01(Number(t.audioTransient || 0) / 1.2, 0);
  const fluxRaw = clamp01(t.audioFlux, clamp01(t.spectralFlux, 0));
  const flux = clamp01(
    Math.max(
      Math.pow(fluxRaw, 1.18),
      (fluxRaw * 0.7) + (transientsRaw * 0.2) + (peaksRaw * 0.1)
    ),
    0
  );
  const transients = clamp01(
    Math.max(
      Math.pow(transientsRaw, 1.22),
      (transientsRaw * 0.66) + (flux * 0.24) + (peaksRaw * 0.1)
    ),
    0
  );
  const peaks = clamp01(
    Math.max(
      Math.pow(peaksRaw, 1.24),
      (peaksRaw * 0.58) + (transients * 0.3) + (flux * 0.12)
    ),
    0
  );
  switch (normalizeFixtureMetricKey(metricId, "baseline")) {
    case "peaks":
      return peaks;
    case "transients":
      return transients;
    case "flux":
      return flux;
    case "baseline":
    default:
      return baseline;
  }
}

function getFixtureMetricAutoPool(telemetry = {}) {
  const t = telemetry && typeof telemetry === "object" ? telemetry : {};
  const active = t.metaAutoTempoTrackersActive && typeof t.metaAutoTempoTrackersActive === "object"
    ? t.metaAutoTempoTrackersActive
    : (t.metaAutoTempoTrackers && typeof t.metaAutoTempoTrackers === "object" ? t.metaAutoTempoTrackers : {});
  const pool = FIXTURE_METRIC_KEYS.filter(key => active[key] === true);
  return pool.length ? pool : FIXTURE_METRIC_KEYS.slice();
}

function listMetricRoutedFixtureIds(brandKey, options = {}) {
  const brand = normalizePaletteBrandKey(brandKey);
  if (!brand) return [];
  const metaAutoOnly = options?.metaAutoOnly === true;
  const fixtures = fixtureRegistry.getFixtures?.() || [];
  return fixtures
    .filter(fixture => {
      if (!fixture || typeof fixture !== "object") return false;
      const fixtureBrand = normalizePaletteBrandKey(fixture.brand);
      if (!fixtureBrand || fixtureBrand !== brand) return false;
      const engineEnabled = parseBoolean(fixture.engineEnabled, false);
      if (fixture.enabled === false || !engineEnabled) return false;
      const fixtureId = String(fixture.id || "").trim();
      if (!fixtureId) return false;
      if (!hasFixtureMetricRoutingActiveConfig(fixtureId, fixtureBrand)) return false;
      if (!metaAutoOnly) return true;
      const scoped = getScopedFixtureMetricConfig(fixtureId, fixtureBrand);
      return normalizeFixtureMetricMode(scoped.mode, "manual") === "meta_auto";
    })
    .map(fixture => String(fixture.id || "").trim())
    .filter(Boolean)
    .sort((a, b) => String(a).localeCompare(String(b)));
}

function getFixtureMetricAutoState(scopeKey = "") {
  const key = String(scopeKey || "global").trim().toLowerCase() || "global";
  let state = fixtureMetricAutoStateByScope.get(key);
  if (!state || typeof state !== "object") {
    state = {
      offset: 0,
      lastAdvanceAt: 0,
      lastDominantTracker: "baseline"
    };
    fixtureMetricAutoStateByScope.set(key, state);
  }
  return state;
}

function resolveFixtureMetricAutoScopeKey(fixtureId, brandKey) {
  const brand = normalizePaletteBrandKey(brandKey);
  const id = String(fixtureId || "").trim();
  if (id) {
    const fixtureOverrideRaw = fixtureMetricRoutingRuntime?.fixtures?.[id];
    if (fixtureOverrideRaw && typeof fixtureOverrideRaw === "object" && !Array.isArray(fixtureOverrideRaw)) {
      return `fixture:${id.toLowerCase()}`;
    }
  }
  if (brand) return `brand:${brand}`;
  return "global";
}

function maybeAdvanceFixtureMetricAutoOffset(config = {}, intent = {}, telemetry = {}, scopeKey = "") {
  if (config.metaAutoFlip !== true) return;
  const pool = getFixtureMetricAutoPool(telemetry);
  if (!pool.length) return;
  const autoState = getFixtureMetricAutoState(scopeKey);

  const now = Date.now();
  const beat = Boolean(intent?.beat);
  const drop = Boolean(intent?.drop);
  const dominant = String(telemetry?.metaAutoDominantTracker || "").trim().toLowerCase();
  const dominantChanged = dominant && dominant !== autoState.lastDominantTracker;
  const trigger = beat || drop || dominantChanged;
  const gateMs = drop ? 120 : (beat ? 240 : 340);

  if (dominant) {
    autoState.lastDominantTracker = dominant;
  }
  if (!trigger) return;
  if ((now - Number(autoState.lastAdvanceAt || 0)) < gateMs) return;

  autoState.offset =
    (Number(autoState.offset || 0) + 1) % Math.max(1, pool.length);
  autoState.lastAdvanceAt = now;
}

function resolveFixtureMetricAssignment(fixtureId, brandKey, intent = {}, telemetry = {}) {
  const brand = normalizePaletteBrandKey(brandKey);
  const scopeKey = resolveFixtureMetricAutoScopeKey(fixtureId, brand);
  const scoped = getScopedFixtureMetricConfig(fixtureId, brandKey);
  const mode = normalizeFixtureMetricMode(scoped.mode, "manual");
  if (mode !== "meta_auto") {
    return {
      config: scoped,
      mode,
      metric: normalizeFixtureMetricKey(scoped.metric, "baseline")
    };
  }

  maybeAdvanceFixtureMetricAutoOffset(scoped, intent, telemetry, scopeKey);
  const pool = getFixtureMetricAutoPool(telemetry);
  if (!pool.length) {
    return {
      config: scoped,
      mode,
      metric: normalizeFixtureMetricKey(scoped.metric, "baseline")
    };
  }

  let ids = listMetricRoutedFixtureIds(brand, { metaAutoOnly: true });
  const fixtureIdKey = String(fixtureId || "").trim();
  if (fixtureIdKey && !ids.includes(fixtureIdKey)) {
    ids = ids.concat([fixtureIdKey]).sort((a, b) => String(a).localeCompare(String(b)));
  }
  const index = Math.max(0, ids.indexOf(String(fixtureId || "").trim()));
  const harmonySize = normalizeFixtureMetricHarmonySize(scoped.harmonySize, 1);
  const groupIndex = Math.floor(index / Math.max(1, harmonySize));
  const offset = Number(getFixtureMetricAutoState(scopeKey).offset || 0) % pool.length;
  const metric = pool[(groupIndex + offset) % pool.length] || pool[0];
  return {
    config: scoped,
    mode,
    metric: normalizeFixtureMetricKey(metric, "baseline")
  };
}

function applyFixtureMetricToHueState(state = {}, fixture = null, intent = {}) {
  const source = state && typeof state === "object" ? state : null;
  if (!source || source.on === false) return source;
  const fixtureId = String(fixture?.id || "").trim();
  if (!fixtureId) return source;
  if (!hasFixtureMetricRoutingActiveConfig(fixtureId, "hue")) return source;
  const scoped = getScopedFixtureMetricConfig(fixtureId, "hue");
  if (isFixtureMetricConfigNeutral(scoped, { ignoreMaxHz: true })) return source;

  const telemetry = engine?.getTelemetry?.() || {};
  const assigned = resolveFixtureMetricAssignment(fixtureId, "hue", intent, telemetry);
  const level = resolveFixtureMetricLevel(assigned.metric, telemetry, intent);
  const baseBri = clampNumber(source.bri, 1, 254, 160);
  const floorBri = Math.max(2, Math.round(baseBri * 0.18));
  const drive = clampNumber(0.34 + (level * 0.9), 0.22, 1.24, 0.72);
  const nextBri = Math.max(1, Math.min(254, Math.round(floorBri + ((baseBri - floorBri) * drive))));

  const satBase = clampNumber(source.sat, 1, 254, 180);
  const satBoost = Math.round(level * 34);
  return {
    ...source,
    bri: nextBri,
    sat: Math.max(1, Math.min(254, satBase + satBoost))
  };
}

function applyFixtureMetricToWizState(state = {}, fixtureId = "", intent = {}) {
  const source = state && typeof state === "object" ? state : null;
  if (!source || source.on === false) return source;
  const id = String(fixtureId || "").trim();
  if (!id) return source;
  if (!hasFixtureMetricRoutingActiveConfig(id, "wiz")) return source;
  const scoped = getScopedFixtureMetricConfig(id, "wiz");
  if (isFixtureMetricConfigNeutral(scoped, { ignoreMaxHz: true })) return source;

  const telemetry = engine?.getTelemetry?.() || {};
  const assigned = resolveFixtureMetricAssignment(id, "wiz", intent, telemetry);
  const level = resolveFixtureMetricLevel(assigned.metric, telemetry, intent);
  const baseDimming = clampNumber(
    source.dimming,
    1,
    100,
    Math.round(clampNumber(source.brightness, 0.01, 1, 0.7) * 100)
  );
  const floor = Math.max(1, Math.round(baseDimming * 0.22));
  const drive = clampNumber(0.34 + (level * 0.9), 0.22, 1.24, 0.72);
  const dimming = Math.max(1, Math.min(100, Math.round(floor + ((baseDimming - floor) * drive))));
  const next = {
    ...source,
    dimming
  };
  if (Object.prototype.hasOwnProperty.call(next, "brightness")) {
    next.brightness = Math.max(0.01, Math.min(1, dimming / 100));
  }
  return next;
}

function setFixtureMetricOverrideConfig(patch = {}) {
  const next = patch && typeof patch === "object" ? patch : {};
  const fixtureId = String(next.fixtureId || "").trim();
  if (!fixtureId) {
    return { ok: false, status: 400, error: "missing fixtureId" };
  }

  const fixtures = fixtureRegistry.getFixtures?.() || [];
  const fixture = fixtures.find(item => String(item?.id || "").trim() === fixtureId) || null;
  if (!fixture) {
    return { ok: false, status: 404, error: "fixture not found" };
  }

  const fixtureBrand = normalizePaletteBrandKey(fixture.brand);
  if (!fixtureBrand) {
    return {
      ok: false,
      status: 400,
      error: `fixture brand '${String(fixture.brand || "unknown")}' does not support metric routing`
    };
  }

  const requestedBrand = normalizePaletteBrandKey(next.brand);
  if (requestedBrand && requestedBrand !== fixtureBrand) {
    return {
      ok: false,
      status: 400,
      error: `fixtureId '${fixtureId}' belongs to brand '${fixtureBrand}', not '${requestedBrand}'`
    };
  }

  const clearRequested = parseBooleanLoose(next.clearOverride, false) === true;
  if (clearRequested) {
    if (fixtureMetricRoutingRuntime.fixtures[fixtureId]) {
      const fixturesNext = { ...fixtureMetricRoutingRuntime.fixtures };
      delete fixturesNext[fixtureId];
      fixtureMetricRoutingRuntime = writeFixtureMetricRoutingConfig({
        ...fixtureMetricRoutingRuntime,
        fixtures: fixturesNext
      });
    }
    pruneFixtureMetricAutoStateScopes(Object.keys(fixtureMetricRoutingRuntime.fixtures || {}));
    return {
      ok: true,
      fixtureId,
      brand: fixtureBrand,
      cleared: true
    };
  }

  if (!hasFixtureMetricPatchFields(next)) {
    return { ok: false, status: 400, error: "no valid metric fields" };
  }

  const base = getFixtureMetricConfigForBrand(fixtureBrand);
  const currentRaw = fixtureMetricRoutingRuntime.fixtures?.[fixtureId] || {};
  const current = normalizeFixtureMetricConfigSnapshot(currentRaw, base);
  const updated = applyFixtureMetricConfigPatch({ ...current }, current, next);

  const normalized = normalizeFixtureMetricConfigSnapshot(updated, base);
  fixtureMetricRoutingRuntime = writeFixtureMetricRoutingConfig({
    ...fixtureMetricRoutingRuntime,
    fixtures: {
      ...fixtureMetricRoutingRuntime.fixtures,
      [fixtureId]: normalized
    }
  });
  pruneFixtureMetricAutoStateScopes(Object.keys(fixtureMetricRoutingRuntime.fixtures || {}));
  return {
    ok: true,
    fixtureId,
    brand: fixtureBrand,
    cleared: false,
    config: normalized
  };
}

function patchFixtureMetricRoutingConfig(patch = {}) {
  const next = patch && typeof patch === "object" ? patch : {};
  const requestedBrand = normalizePaletteBrandKey(next.brand);
  const fixtureId = String(next.fixtureId || "").trim();
  const clearRequested = parseBooleanLoose(next.clearOverride, false) === true;
  if (fixtureId) {
    return setFixtureMetricOverrideConfig(next);
  }

  if (!requestedBrand && !hasFixtureMetricPatchFields(next)) {
    return { ok: false, status: 400, error: "no valid metric fields" };
  }

  if (requestedBrand) {
    if (clearRequested) {
      const brands = {
        ...(fixtureMetricRoutingRuntime.brands || {}),
        [requestedBrand]: null
      };
      fixtureMetricRoutingRuntime = writeFixtureMetricRoutingConfig({
        ...fixtureMetricRoutingRuntime,
        brands
      });
      pruneFixtureMetricAutoStateScopes(Object.keys(fixtureMetricRoutingRuntime.fixtures || {}));
      return {
        ok: true,
        scope: "brand",
        brand: requestedBrand,
        cleared: true,
        config: null
      };
    }

    const base = getFixtureMetricConfigForBrand(requestedBrand);
    const currentRaw = fixtureMetricRoutingRuntime.brands?.[requestedBrand] || {};
    const current = normalizeFixtureMetricConfigSnapshot(currentRaw, base);
    const updated = applyFixtureMetricConfigPatch({ ...current }, current, next);
    const normalized = normalizeFixtureMetricConfigSnapshot(updated, base);
    fixtureMetricRoutingRuntime = writeFixtureMetricRoutingConfig({
      ...fixtureMetricRoutingRuntime,
      brands: {
        ...(fixtureMetricRoutingRuntime.brands || {}),
        [requestedBrand]: normalized
      }
    });
    pruneFixtureMetricAutoStateScopes(Object.keys(fixtureMetricRoutingRuntime.fixtures || {}));
    return {
      ok: true,
      scope: "brand",
      brand: requestedBrand,
      cleared: false,
      config: normalized
    };
  }

  if (clearRequested) {
    fixtureMetricRoutingRuntime = writeFixtureMetricRoutingConfig(FIXTURE_METRIC_ROUTING_DEFAULT);
    pruneFixtureMetricAutoStateScopes(Object.keys(fixtureMetricRoutingRuntime.fixtures || {}));
    return {
      ok: true,
      scope: "global",
      cleared: true,
      config: getFixtureMetricGlobalConfig()
    };
  }

  const current = getFixtureMetricGlobalConfig();
  const updated = applyFixtureMetricConfigPatch({ ...current }, current, next);
  const normalized = normalizeFixtureMetricConfigSnapshot(updated, current);
  fixtureMetricRoutingRuntime = writeFixtureMetricRoutingConfig({
    ...fixtureMetricRoutingRuntime,
    config: normalized
  });
  pruneFixtureMetricAutoStateScopes(Object.keys(fixtureMetricRoutingRuntime.fixtures || {}));
  return {
    ok: true,
    scope: "global",
    cleared: false,
    config: normalized
  };
}

function clearFixtureRoutingOverridesAtomic(patch = {}) {
  const next = patch && typeof patch === "object" ? patch : {};
  const fixtureId = String(next.fixtureId || "").trim();
  const requestedBrand = normalizePaletteBrandKey(next.brand);

  if (!fixtureId && !requestedBrand) {
    return {
      ok: false,
      status: 400,
      error: "brand or fixtureId required"
    };
  }

  const paletteOverridesBefore = sanitizePaletteFixtureOverridesConfig(paletteFixtureOverridesRuntime);
  const metricRoutingBefore = sanitizeFixtureMetricRoutingConfig(fixtureMetricRoutingRuntime);
  const sequenceStateBefore = new Map(fixturePaletteSequenceState);
  const brightnessStateBefore = new Map(fixturePaletteBrightnessState);

  let paletteBrandBefore = null;
  let paletteBrandHadOverride = false;
  if (!fixtureId && requestedBrand) {
    const paletteSnapshot = engine.getPaletteConfig?.() || {};
    const brandMap = (
      paletteSnapshot &&
      typeof paletteSnapshot === "object" &&
      paletteSnapshot.brands &&
      typeof paletteSnapshot.brands === "object"
    )
      ? paletteSnapshot.brands
      : {};
    paletteBrandHadOverride = Boolean(
      brandMap[requestedBrand] &&
      typeof brandMap[requestedBrand] === "object" &&
      !Array.isArray(brandMap[requestedBrand])
    );
    const scoped = engine.getPaletteConfig?.(requestedBrand);
    if (scoped && typeof scoped === "object" && !Array.isArray(scoped)) {
      paletteBrandBefore = normalizePaletteConfigSnapshot(scoped, PALETTE_CONFIG_DEFAULT);
    }
  }

  try {
    if (fixtureId) {
      const paletteResult = setFixturePaletteOverrideConfig({
        fixtureId,
        brand: requestedBrand || next.brand,
        clearOverride: true
      });
      if (!paletteResult.ok) {
        return {
          ok: false,
          status: paletteResult.status || 400,
          error: paletteResult.error || "fixture palette clear failed"
        };
      }

      const metricResult = setFixtureMetricOverrideConfig({
        fixtureId,
        brand: requestedBrand || next.brand,
        clearOverride: true
      });
      if (!metricResult.ok) {
        throw new Error(metricResult.error || "fixture metric clear failed");
      }

      return {
        ok: true,
        scope: "fixture",
        fixtureId,
        brand: metricResult.brand || paletteResult.brand
      };
    }

    const paletteNext = engine.setPaletteConfig?.({
      brand: requestedBrand,
      clearOverride: true
    });
    if (!paletteNext) {
      throw new Error("brand palette clear failed");
    }

    const metricResult = patchFixtureMetricRoutingConfig({
      brand: requestedBrand,
      clearOverride: true
    });
    if (!metricResult.ok) {
      throw new Error(metricResult.error || "brand metric clear failed");
    }

    return {
      ok: true,
      scope: "brand",
      brand: requestedBrand
    };
  } catch (err) {
    try {
      paletteFixtureOverridesRuntime = writePaletteFixtureOverridesConfig(paletteOverridesBefore);
      fixtureMetricRoutingRuntime = writeFixtureMetricRoutingConfig(metricRoutingBefore);

      fixturePaletteSequenceState.clear();
      for (const [id, state] of sequenceStateBefore.entries()) {
        fixturePaletteSequenceState.set(id, state);
      }
      fixturePaletteBrightnessState.clear();
      for (const [id, state] of brightnessStateBefore.entries()) {
        fixturePaletteBrightnessState.set(id, state);
      }

      if (!fixtureId && requestedBrand) {
        if (paletteBrandHadOverride && paletteBrandBefore) {
          engine.setPaletteConfig?.({
            brand: requestedBrand,
            colorsPerFamily: paletteBrandBefore.colorsPerFamily,
            familyColorCounts: paletteBrandBefore.familyColorCounts,
            families: paletteBrandBefore.families,
            disorder: paletteBrandBefore.disorder,
            disorderAggression: paletteBrandBefore.disorderAggression,
            cycleMode: paletteBrandBefore.cycleMode,
            timedIntervalSec: paletteBrandBefore.timedIntervalSec,
            beatLock: paletteBrandBefore.beatLock,
            beatLockGraceSec: paletteBrandBefore.beatLockGraceSec,
            reactiveMargin: paletteBrandBefore.reactiveMargin,
            brightnessMode: paletteBrandBefore.brightnessMode,
            brightnessFollowAmount: paletteBrandBefore.brightnessFollowAmount,
            vividness: paletteBrandBefore.vividness,
            spectrumMapMode: paletteBrandBefore.spectrumMapMode,
            spectrumFeatureMap: paletteBrandBefore.spectrumFeatureMap
          });
        } else {
          engine.setPaletteConfig?.({
            brand: requestedBrand,
            clearOverride: true
          });
        }
      }
    } catch (rollbackErr) {
      console.warn(`[RAVE] fixture routing rollback warning: ${rollbackErr.message || rollbackErr}`);
    }
    return {
      ok: false,
      status: 500,
      error: err?.message || String(err || "fixture routing clear failed")
    };
  }
}

// ======================================================
// STANDALONE FIXTURE CONTROL
// ======================================================
const standaloneLogic = createStandaloneLogic({
  parseBoolean: parseBooleanLoose,
  getTelemetry: () => audio?.getTelemetry?.() || {},
  getAudioReactivityDrive: () => getAudioReactivityDrive("other")
});
const {
  normalizeStandaloneState,
  nextStandaloneAnimatedState,
  hsvToRgb
} = standaloneLogic;

function listStandaloneFixtures() {
  const listCustomBy = fixtureRegistry.listCustomBy;
  if (typeof listCustomBy === "function") {
    const hue = listCustomBy("hue", "", { requireConfigured: false }) || [];
    const wiz = listCustomBy("wiz", "", { requireConfigured: false }) || [];
    return [...hue, ...wiz];
  }
  const fixtures = fixtureRegistry.getFixtures?.() || [];
  return fixtures.filter(fixture => parseBooleanLoose(fixture?.customEnabled, false));
}

function getStandaloneFixtureById(id) {
  const fixtureId = String(id || "").trim();
  if (!fixtureId) return null;
  return listStandaloneFixtures().find(fixture => String(fixture?.id || "").trim() === fixtureId) || null;
}

function hasStandalonePersistedState(id) {
  const fixtureId = String(id || "").trim();
  if (!fixtureId) return false;
  const fixtures = standaloneStateConfigRuntime?.fixtures || {};
  return Object.prototype.hasOwnProperty.call(fixtures, fixtureId);
}

function getStandalonePersistedState(id) {
  const fixtureId = String(id || "").trim();
  if (!fixtureId) return null;
  const fixtures = standaloneStateConfigRuntime?.fixtures || {};
  const raw = fixtures[fixtureId];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const fixture = getStandaloneFixtureById(fixtureId);
  const brand = fixture?.brand || "hue";
  return normalizeStandaloneState({}, raw, brand);
}

function persistStandaloneStateForFixture(id, state) {
  const fixtureId = String(id || "").trim();
  if (!fixtureId) return null;
  const fixture = getStandaloneFixtureById(fixtureId);
  const brand = fixture?.brand || "hue";
  const normalizedState = normalizeStandaloneState({}, state, brand);
  const safe = writeStandaloneStateConfig({
    ...standaloneStateConfigRuntime,
    fixtures: {
      ...(standaloneStateConfigRuntime.fixtures || {}),
      [fixtureId]: normalizedState
    }
  });
  standaloneStateConfigRuntime.version = Number(safe.version || 1);
  standaloneStateConfigRuntime.fixtures = { ...(safe.fixtures || {}) };
  return normalizedState;
}

function wait(ms) {
  const timeoutMs = Math.max(0, Math.round(Number(ms) || 0));
  return new Promise(resolve => setTimeout(resolve, timeoutMs));
}

const standaloneRuntime = createStandaloneRuntime({
  fixtureRegistry,
  createWizAdapter,
  axios,
  getHueHttpsAgentForFixture: fixture => getHueRestHttpsAgent(fixture),
  parseBoolean: parseBooleanLoose,
  normalizeStandaloneState,
  nextStandaloneAnimatedState,
  toHueTransitionTime,
  toHueBrightness,
  hsvToRgb,
  listStandaloneFixtures,
  getStandaloneFixtureById,
  getStandalonePersistedState,
  hasStandalonePersistedState,
  persistStandaloneStateForFixture,
  wait,
  log: console
});

function getStandaloneWizAdapter(fixture) {
  return standaloneRuntime.getStandaloneWizAdapter(fixture);
}

function closeStandaloneWizAdapter(id) {
  return standaloneRuntime.closeStandaloneWizAdapter(id);
}

function stopStandaloneTimer(id) {
  return standaloneRuntime.stopStandaloneTimer(id);
}

function startStandaloneTimer(fixture, state) {
  return standaloneRuntime.startStandaloneTimer(fixture, state);
}

function buildStandaloneSnapshot(fixture) {
  return standaloneRuntime.buildStandaloneSnapshot(fixture);
}

function buildStandaloneSnapshotList() {
  return standaloneRuntime.buildStandaloneSnapshotList();
}

function buildStandaloneSnapshotById(id) {
  return standaloneRuntime.buildStandaloneSnapshotById(id);
}

function syncStandaloneRuntime() {
  return standaloneRuntime.syncStandaloneRuntime();
}

async function sendStandaloneState(fixture, state) {
  return standaloneRuntime.sendStandaloneState(fixture, state);
}

async function sendStandaloneStateWithRetry(fixture, state, options = {}) {
  return standaloneRuntime.sendStandaloneStateWithRetry(fixture, state, options);
}

async function applyStandaloneStateById(id, patch = {}) {
  return standaloneRuntime.applyStandaloneStateById(id, patch);
}

async function applyStandaloneRaveStopUpdates() {
  return standaloneRuntime.applyStandaloneRaveStopUpdates();
}

async function applyStandaloneStartupUpdates() {
  return standaloneRuntime.applyStandaloneStartupUpdates();
}

async function applyStandaloneRaveStartUpdates() {
  return standaloneRuntime.applyStandaloneRaveStartUpdates();
}

function getStandaloneStateById(id) {
  return standaloneRuntime.getStateById(id);
}
// ENGINE + AUDIO
// ======================================================
let engine = null;
let audio = null;
let audioRuntimeConfig = initialAudioRuntimeConfig || null;
let midiManager = null;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const transportPressureFeedback = {
  lastAt: 0,
  lastHueSent: 0,
  lastWizSent: 0,
  lastHueRateSkipped: 0,
  lastWizRateSkipped: 0,
  lastHueInflightSkipped: 0,
  ema: 0,
  holdUntil: 0
};
const TRANSPORT_PRESSURE_UPDATE_MIN_MS = 80;
const TRANSPORT_PRESSURE_HOLD_MS = 560;

function getSchedulerRateSkipTotals(schedulers) {
  let sent = 0;
  let skippedRate = 0;
  let skippedDelta = 0;
  for (const scheduler of schedulers.values()) {
    const t = scheduler?.getTelemetry?.();
    if (!t || typeof t !== "object") continue;
    sent += Number(t.sent || 0);
    skippedRate += Number(t.skippedRate || 0);
    skippedDelta += Number(t.skippedDelta || 0);
  }
  return { sent, skippedRate, skippedDelta };
}

function resetTransportPressureFeedback() {
  transportPressureFeedback.lastAt = 0;
  transportPressureFeedback.lastHueSent = 0;
  transportPressureFeedback.lastWizSent = 0;
  transportPressureFeedback.lastHueRateSkipped = 0;
  transportPressureFeedback.lastWizRateSkipped = 0;
  transportPressureFeedback.lastHueInflightSkipped = 0;
  transportPressureFeedback.ema = 0;
  transportPressureFeedback.holdUntil = 0;
}

function updateEngineTransportPressure(reason = "emit") {
  if (!engine?.setTransportPressure) return;
  const now = Date.now();
  const hueSchedulerTotals = getSchedulerRateSkipTotals(hueSchedulers);
  const wizSchedulerTotals = getSchedulerRateSkipTotals(wizSchedulers);
  const hueSent = Number(hueTelemetry.sent || 0);
  const wizSent = Number(wizTelemetry.sent || 0);
  const hueInflightSkipped = Number(hueTelemetry.skippedInflight || 0) + Number(hueTelemetry.skippedSyncHold || 0);

  if (!(transportPressureFeedback.lastAt > 0)) {
    transportPressureFeedback.lastAt = now;
    transportPressureFeedback.lastHueSent = hueSent;
    transportPressureFeedback.lastWizSent = wizSent;
    transportPressureFeedback.lastHueRateSkipped = Number(hueSchedulerTotals.skippedRate || 0);
    transportPressureFeedback.lastWizRateSkipped = Number(wizSchedulerTotals.skippedRate || 0);
    transportPressureFeedback.lastHueInflightSkipped = hueInflightSkipped;
    engine.setTransportPressure({
      now,
      pressure: 0,
      raw: 0,
      reason,
      sampleMs: 0
    });
    return;
  }

  const sampleMs = Math.max(1, now - transportPressureFeedback.lastAt);
  if (sampleMs < TRANSPORT_PRESSURE_UPDATE_MIN_MS) return;

  const hueRateSkippedTotal = Number(hueSchedulerTotals.skippedRate || 0);
  const wizRateSkippedTotal = Number(wizSchedulerTotals.skippedRate || 0);
  const hueSentDelta = Math.max(0, hueSent - transportPressureFeedback.lastHueSent);
  const wizSentDelta = Math.max(0, wizSent - transportPressureFeedback.lastWizSent);
  const rateSkippedDelta = Math.max(0, hueRateSkippedTotal - transportPressureFeedback.lastHueRateSkipped) +
    Math.max(0, wizRateSkippedTotal - transportPressureFeedback.lastWizRateSkipped);
  const inflightSkippedDelta = Math.max(0, hueInflightSkipped - transportPressureFeedback.lastHueInflightSkipped);
  const sentDelta = hueSentDelta + wizSentDelta;

  const demandTotal = sentDelta + rateSkippedDelta + inflightSkippedDelta;
  const skipRatePerSec = (rateSkippedDelta * 1000) / Math.max(1, sampleMs);
  let rawPressure = demandTotal > 0
    ? ((rateSkippedDelta + (inflightSkippedDelta * 1.65)) / Math.max(1, demandTotal))
    : 0;
  rawPressure += clamp(skipRatePerSec / 7.5, 0, 0.6);
  if (hueTelemetry.inflight === true) {
    const inflightPenalty = clamp(
      (Number(hueTelemetry.lastDurationMs || 0) - 110) / 320,
      0,
      0.42
    );
    rawPressure += inflightPenalty;
  }
  rawPressure = clamp(rawPressure, 0, 2.4);

  const alpha = rawPressure >= transportPressureFeedback.ema ? 0.78 : 0.3;
  transportPressureFeedback.ema = clamp(
    transportPressureFeedback.ema + ((rawPressure - transportPressureFeedback.ema) * alpha),
    0,
    2.4
  );
  if (rawPressure >= 0.24 || inflightSkippedDelta > 0) {
    transportPressureFeedback.holdUntil = now + TRANSPORT_PRESSURE_HOLD_MS;
  }
  const heldPressure = now < transportPressureFeedback.holdUntil
    ? Math.max(transportPressureFeedback.ema, rawPressure * 0.96, 0.14)
    : transportPressureFeedback.ema;
  const engineTelemetry = engine?.getTelemetry?.() || {};
  const autoHzControlActive = Boolean(engineTelemetry.metaAutoEnabled || engineTelemetry.overclockAutoEnabled);

  engine.setTransportPressure({
    now,
    reason,
    sampleMs,
    sent: sentDelta,
    skippedRate: rateSkippedDelta,
    skippedInflight: inflightSkippedDelta,
    raw: autoHzControlActive ? rawPressure : 0,
    pressure: autoHzControlActive ? heldPressure : 0
  });

  transportPressureFeedback.lastAt = now;
  transportPressureFeedback.lastHueSent = hueSent;
  transportPressureFeedback.lastWizSent = wizSent;
  transportPressureFeedback.lastHueRateSkipped = hueRateSkippedTotal;
  transportPressureFeedback.lastWizRateSkipped = wizRateSkippedTotal;
  transportPressureFeedback.lastHueInflightSkipped = hueInflightSkipped;
}

function getModsRuntimeSnapshot() {
  return {
    state: state.getStatus?.() || {},
    transport: {
      desired: hueTransport.desired,
      active: hueTransport.active
    },
    fixtures: fixtureRegistry.summary?.() || {},
    audio: audio?.getTelemetry?.() || { running: false },
    audioReactivityMap: getAudioReactivityMapSnapshot(),
    modsDebug: modLoader.getDebugDiagnostics?.({ includeEvents: false }) || null
  };
}

const modLoader = createModLoader({
  rootDir: __dirname,
  log: console,
  actions: {
    enqueueHue: (statePatch, zone, options) => enqueueHue(statePatch, zone, options),
    enqueueWiz: (statePatch, zone, options) => enqueueWiz(statePatch, zone, options),
    getEngineTelemetry: () => engine?.getTelemetry?.() || null,
    getHueTelemetry: () => ({
      ...hueTelemetry,
      transportDesired: hueTransport.desired,
      transportActive: hueTransport.active,
      transportFallbackReason: hueTransport.fallbackReason
    }),
    getWizTelemetry: () => ({ ...wizTelemetry }),
    getAudioTelemetry: () => audio?.getTelemetry?.() || { running: false },
    getAudioReactivityMap: () => getAudioReactivityMapSnapshot(),
    getAudioReactivityDrive: (target = "other") => getAudioReactivityDrive(target),
    getFixtures: () => fixtureRegistry.getFixtures?.() || [],
    getFixturesBy: (filters = {}) => {
      const opts = filters && typeof filters === "object" ? filters : {};
      const brand = String(opts.brand || "").trim().toLowerCase();
      const zone = String(opts.zone || "").trim().toLowerCase();
      const mode = String(opts.mode || "").trim().toLowerCase();
      const enabledOnly = opts.enabledOnly !== false;
      const requireConfigured = Boolean(opts.requireConfigured);
      const configuredCheck = fixtureRegistry.isFixtureConfiguredForTransport;

      const fixtures = fixtureRegistry.getFixtures?.() || [];
      return fixtures.filter(fixture => {
        if (!fixture || typeof fixture !== "object") return false;
        if (enabledOnly && fixture.enabled === false) return false;
        if (brand && String(fixture.brand || "").trim().toLowerCase() !== brand) return false;
        if (zone && String(fixture.zone || "").trim().toLowerCase() !== zone) return false;

        if (mode === "engine" && fixture.engineEnabled !== true) return false;
        if (mode === "twitch" && fixture.twitchEnabled !== true) return false;
        if (mode === "custom" && fixture.customEnabled !== true) return false;

        if (requireConfigured && typeof configuredCheck === "function") {
          return configuredCheck(fixture);
        }
        return true;
      });
    },
    getFixtureRoutes: () => fixtureRegistry.getIntentRoutes?.() || {},
    getIntentZones: (intent, options = {}) => {
      const opts = options && typeof options === "object" ? options : {};
      const brand = String(opts.brand || "").trim().toLowerCase();
      const fallbackZone = String(opts.fallbackZone || "").trim() || getCanonicalZoneFallback(brand, "custom");
      const mode = String(opts.mode || "engine").trim().toLowerCase();
      return resolveIntentZones(intent, brand, fallbackZone, { mode });
    },
    getStandaloneFixtures: () => buildStandaloneSnapshotList(),
    applyStandaloneState: async (id, statePatch = {}) => {
      const fixtureId = String(id || "").trim();
      if (!fixtureId) {
        return { ok: false, status: 400, error: "missing fixture id" };
      }
      return applyStandaloneStateById(fixtureId, statePatch);
    },
    getColorCommandConfig: () => ({
      config: getTwitchColorConfigSnapshot(),
      capabilities: getTwitchColorCapabilities()
    }),
    setColorCommandConfig: (patch = {}) => {
      const updated = patchTwitchColorConfig(patch);
      return {
        config: updated,
        capabilities: getTwitchColorCapabilities()
      };
    },
    getState: () => state.getStatus?.() || {}
  }
});

function fireModHook(hook, payload = {}) {
  modLoader
    .invokeHook(hook, payload)
    .then(result => {
      if (result && Number(result.failed || 0) > 0) {
        console.warn(
          `[MODS] hook ${hook} partial failure: failed=${result.failed}/${result.invoked}`
        );
      }
    })
    .catch(err => {
      console.warn(`[MODS] hook ${hook} failed:`, err.message || err);
    });
}

function bootEngine(reason = "boot") {
  console.log("[RAVE] booting engine");

  for (const scheduler of hueSchedulers.values()) {
    scheduler.reset();
  }
  for (const scheduler of wizSchedulers.values()) {
    scheduler.reset();
  }

  midiManager?.dispose?.();
  midiManager = null;
  resetAudioReactivityEnvelopes();
  resetTransportPressureFeedback();

  engine = createRaveEngine({
    emit(intent) {
      try {
        if (intent && typeof intent === "object") {
          // Fire-and-forget observer hook for mod-side intent listeners.
          modLoader.invokeHook("onIntent", { intent }).catch(() => {});
        }

        // ---------- HUE (BEAT-ONLY) ----------
        if (intent.type === "HUE_STATE") {
          const engineTelemetry = engine?.getTelemetry?.() || {};
          const mappedIntent = applyHueIntentAudioReactivity(intent, engineTelemetry);
          const requestedRateMs = Number(mappedIntent.rateMs || 0);
          const requestedMaxSilenceMs = Number(mappedIntent.maxSilenceMs || 0);
          const hueRateProfile = getHueRateProfileForActiveTransport();
          const effectiveRateMs = clampIntervalMsForProfile(
            requestedRateMs > 0 ? requestedRateMs : hueRateProfile.defaultMs,
            hueRateProfile
          );
          const turboRate = effectiveRateMs <= 170;
          const hueTriggerBoost = clamp(
            Math.max(
              Number(mappedIntent.audioDrums || 0),
              Number(mappedIntent.audioBody || 0) * 0.86,
              Number(mappedIntent.audioMotion || 0) * 0.9,
              mappedIntent.drop ? 0.92 : 0,
              mappedIntent.beat ? 0.62 : 0
            ),
            0,
            1
          );
          const highRateReactive =
            effectiveRateMs <= 124 &&
            hueTriggerBoost >= 0.24;
          const intentDeltaScale = Number(mappedIntent.deltaScale);
          const zones = resolveIntentZones(mappedIntent, "hue", "hue");
          for (const zone of zones) {
            const tunedHueState = tuneHueRestTransitionForLatency(
              mappedIntent.state,
              effectiveRateMs,
              { flowMode: Boolean(mappedIntent.forceDelta) }
            );
            enqueueHue(
              tunedHueState,
              zone,
              {
                minIntervalMs: effectiveRateMs,
                maxSilenceMs: requestedMaxSilenceMs > 0
                  ? requestedMaxSilenceMs
                  : hueRateProfile.maxSilenceMs,
                forceDelta: Boolean(
                  mappedIntent.forceRate ||
                  mappedIntent.forceDelta ||
                  highRateReactive ||
                  hueTriggerBoost >= 0.48
                ),
                deltaScale: Number.isFinite(intentDeltaScale)
                  ? intentDeltaScale
                  : (highRateReactive ? 0.46 : (turboRate ? 0.54 : 0.94)),
                triggerBoost: hueTriggerBoost,
                paletteIntent: mappedIntent
              }
            );
          }
          updateEngineTransportPressure("hue_emit");
          return;
        }

        // ---------- WIZ ----------
        if (intent.type === "WIZ_PULSE") {
          const engineTelemetry = engine?.getTelemetry?.() || {};
          const mappedIntent = applyWizIntentAudioReactivity(intent, engineTelemetry);
          const requestedRateMs = Number(mappedIntent.rateMs || 0);
          const requestedMaxSilenceMs = Number(mappedIntent.maxSilenceMs || 0);
          const wizRateProfile = TRANSPORT_RATE_CAPS.wiz.default;
          const effectiveRateMs = clampIntervalMsForProfile(
            requestedRateMs > 0 ? requestedRateMs : wizRateProfile.defaultMs,
            wizRateProfile
          );
          const veryHighRate = effectiveRateMs <= 75;
          const highRate = effectiveRateMs <= 125;
          const zones = resolveIntentZones(mappedIntent, "wiz", "wiz");

          const color = mappedIntent.color || pickWizColor(mappedIntent);
          if (!color) return;

          const dimming = Number.isFinite(color.dimming)
            ? Math.round(clamp(Number(color.dimming), 1, 100))
            : Math.round(clamp((mappedIntent.brightness || 1) * 100, 1, 100));
          const dropActive = Boolean(
            audioReactivityMapRuntime.dropEnabled && mappedIntent.drop
          );
          const beatActive = Boolean(mappedIntent.beat);

          for (const zone of zones) {
            enqueueWiz(
              {
                r: color.r,
                g: color.g,
                b: color.b,
                dimming
              },
              zone,
              {
                minIntervalMs: effectiveRateMs,
                maxSilenceMs: requestedMaxSilenceMs > 0
                  ? requestedMaxSilenceMs
                  : wizRateProfile.maxSilenceMs,
                // Keep WiZ cadence aligned with engine intent; avoid auto-forcing delta
                // on every beat, which can cause color flicker and overly short dwell.
                forceDelta: Boolean(mappedIntent.forceRate || mappedIntent.forceDelta),
                deltaScale: Number.isFinite(Number(mappedIntent.deltaScale))
                  ? Number(mappedIntent.deltaScale)
                  : (veryHighRate ? 0.76 : (highRate ? 0.92 : 1.08)),
                paletteIntent: mappedIntent,
                tx: {
                  // UDP is lossy; repeat key beats/drops for better visual lock.
                  repeats: dropActive ? 2 : 1,
                  repeatDelayMs: highRate ? 14 : 20,
                  isDrop: dropActive,
                  isBeat: beatActive,
                  minIntervalMs: effectiveRateMs
                }
              }
            );
          }
          updateEngineTransportPressure("wiz_emit");
        }
      } catch (err) {
        console.error("[RAVE][EMIT ERROR]", err.stack || err);
      }
    }
  });

  audio = createAudio(() => {});

  engine.setDropDetectionEnabled?.(Boolean(audioReactivityMapRuntime.dropEnabled));
  if (engine?.setMetaAutoTempoTrackers) {
    engine.setMetaAutoTempoTrackers(
      sanitizeMetaAutoTempoTrackersConfig(
        audioReactivityMapRuntime.metaAutoTempoTrackers,
        AUDIO_REACTIVITY_MAP_DEFAULT.metaAutoTempoTrackers
      )
    );
  } else {
    engine.setMetaAutoTempoBaselineBlend?.(
      Boolean(audioReactivityMapRuntime.metaAutoHueWizBaselineBlend)
    );
  }
  engine.setMetaAutoTempoTrackersAuto?.(
    Boolean(audioReactivityMapRuntime.metaAutoTempoTrackersAuto)
  );

  if (audioRuntimeConfig && audio.setConfig) {
    audio.setConfig(audioRuntimeConfig, { restart: false });
  }
  audioRuntimeConfig = audio.getConfig?.() || audioRuntimeConfig;
  writeAudioRuntimeConfig(audioRuntimeConfig);

  const audioStatsMinMs = clamp(
    Math.round(Number(process.env.RAVE_AUDIO_STATS_MIN_MS || 6)),
    1,
    50
  );
  let lastAudioStatsForwardAt = 0;
  audio.onStats?.(stats => {
    const now = Date.now();
    if ((now - lastAudioStatsForwardAt) < audioStatsMinMs) return;
    lastAudioStatsForwardAt = now;
    engine.setAudioLevel({
      level: stats.level,
      rms: stats.rms,
      peak: stats.peak,
      transient: stats.transient,
      zcr: stats.zcr,
      bandLow: stats.bandLow,
      bandMid: stats.bandMid,
      bandHigh: stats.bandHigh,
      spectralFlux: stats.spectralFlux
    });
  });

  refreshWizAdapters();
  syncStandaloneRuntime();
  applyStandaloneStartupUpdates().catch(err => {
    console.warn("[STANDALONE] startup reapply failed:", err.message || err);
  });
  console.log(`[RAVE] engine + audio wired (WiZ targets: ${wizAdapters.size})`);

  midiManager = createMidiManager(engine);

  console.log("[RAVE] MIDI manager created and wired");

  const preferredHueMode = getPreferredHueTransportMode();
  const bootHueMode = preferredHueMode === HUE_TRANSPORT.ENTERTAINMENT
    ? HUE_TRANSPORT.REST
    : preferredHueMode;
  setHueTransportMode(bootHueMode)
    .catch(err => {
      console.warn("[HUE] transport sync failed:", err.message || err);
    });

  fireModHook("onBoot", {
    reason,
    runtime: getModsRuntimeSnapshot()
  });
}

async function initializeRuntime() {
  try {
    const mods = await modLoader.load();
    console.log(`[MODS] ready (${mods.loaded}/${mods.total} loaded)`);
  } catch (err) {
    console.warn("[MODS] initialization failed:", err.message || err);
  }

  bootEngine("startup");
}

// ======================================================
// ROUTES
// ======================================================
async function handleRaveOn(_, res) {
  const automationSeq = nextAutomationEventSeq();
  try {
    state.lock("rave");
    cancelHueEntertainmentRecovery("rave_on_reset");
    clearHueRecoveryTimeoutSuppression();
    const preferredHueMode = getPreferredHueTransportMode();
    const transport = await settleWithTimeout(
      setHueTransportMode(preferredHueMode),
      preferredHueMode === HUE_TRANSPORT.ENTERTAINMENT
        ? HUE_ENT_MODE_SWITCH_TIMEOUT_MS
        : HUE_REST_MODE_SWITCH_TIMEOUT_MS,
      () => ({
        desired: hueTransport.desired,
        active: hueTransport.active,
        fallbackReason: preferredHueMode === HUE_TRANSPORT.ENTERTAINMENT
          ? "entertainment switch timeout"
          : "rest switch timeout"
      })
    );
    const entertainmentNeedsRecovery =
      preferredHueMode === HUE_TRANSPORT.ENTERTAINMENT &&
      transport.active !== HUE_TRANSPORT.ENTERTAINMENT;
    if (preferredHueMode === HUE_TRANSPORT.ENTERTAINMENT) {
      if (entertainmentNeedsRecovery) {
        forceHueEntertainmentRecovery("rave_on_prestart");
      } else {
        scheduleHueEntertainmentRecovery("rave_on_prestart");
      }
    }
    engine.start();
    audio.start();
    if (
      preferredHueMode === HUE_TRANSPORT.ENTERTAINMENT &&
      !entertainmentNeedsRecovery
    ) {
      scheduleHueEntertainmentRecovery("rave_on");
    }
    fireModHook("onRaveStart", {
      source: "api",
      runtime: getModsRuntimeSnapshot()
    });
    applyStandaloneRaveStartUpdates().catch(err => {
      console.warn("[STANDALONE] rave-start update failed:", err.message || err);
    });
    runAutomationEvent("start", automationSeq).catch(err => {
      console.warn("[AUTOMATION] start action failed:", err.message || err);
    });
    res.sendStatus(200);
  } catch (err) {
    console.error("[RAVE] start failed", err);
    state.unlock("rave");
    res.sendStatus(500);
  }
}

async function handleRaveOff(_, res) {
  const automationSeq = nextAutomationEventSeq();
  cancelHueEntertainmentRecovery("rave_off");
  clearHueRecoveryTimeoutSuppression();
  state.unlock("rave");
  let raveOffColorApplied = false;

  try {
    audio.stop();
  } catch (err) {
    console.warn("[RAVE] audio stop warning:", err?.message || err);
  }

  try {
    await engine.stop();
  } catch (err) {
    console.warn("[RAVE] engine stop warning:", err?.message || err);
  }

  try {
    const transport = await settleWithTimeout(
      setHueTransportMode(HUE_TRANSPORT.REST),
      HUE_REST_MODE_SWITCH_TIMEOUT_MS,
      () => ({
        desired: hueTransport.desired,
        active: hueTransport.active,
        fallbackReason: "rest switch timeout"
      })
    );
    if (transport.active !== HUE_TRANSPORT.REST) {
      hueTransport.active = HUE_TRANSPORT.REST;
      hueTransport.fallbackReason = "rest switch timeout";
      hueEntertainment.stop().catch(() => {});
    }
  } catch (err) {
    console.warn("[RAVE] transport stop warning:", err?.message || err);
  }

  try {
    const result = await applyTwitchRaveOffColorProfile();
    raveOffColorApplied = result?.applied === true;
    if (raveOffColorApplied) {
      console.log(
        `[RAVE] stop color profile applied (assigned=${result.assigned || 0}, ` +
        `hue=${result.hueTargets || 0}, wiz=${result.wizTargets || 0})`
      );
    }
    if (Array.isArray(result?.warnings) && result.warnings.length) {
      const first = result.warnings[0];
      console.warn(
        `[RAVE] stop color profile warning: ${first.fixtureId || "fixture"} ` +
        `(${first.error || "invalid command"})`
      );
    }
  } catch (err) {
    console.warn("[RAVE] stop color profile warning:", err?.message || err);
  }

  fireModHook("onRaveStop", {
    source: "api",
    runtime: getModsRuntimeSnapshot()
  });
  if (raveOffColorApplied) {
    console.log("[AUTOMATION] stop brightness skipped (rave-off color profile active)");
  } else {
    runAutomationEvent("stop", automationSeq).catch(err => {
      console.warn("[AUTOMATION] stop action failed:", err.message || err);
    });
  }
  if (raveOffColorApplied) {
    console.log("[STANDALONE] rave-stop updates skipped (rave-off color profile active)");
  } else {
    applyStandaloneRaveStopUpdates().catch(err => {
      console.warn("[STANDALONE] rave-stop update failed:", err.message || err);
    });
  }
  res.sendStatus(200);
}

app.post("/rave/on", handleRaveOn);
app.get("/rave/on", (_, res) => {
  res.status(405).json({
    ok: false,
    error: "method_not_allowed",
    detail: "Use POST /rave/on."
  });
});

app.post("/rave/off", handleRaveOff);
app.get("/rave/off", (_, res) => {
  res.status(405).json({
    ok: false,
    error: "method_not_allowed",
    detail: "Use POST /rave/off."
  });
});

app.post("/rave/reload", async (_, res) => {
  console.log("[RAVE] hot reload requested");

  try {
    audio?.stop();
    await engine?.stop();
  } catch {}

  delete require.cache[require.resolve("./core/rave-engine")];
  createRaveEngine = require("./core/rave-engine");
  delete require.cache[require.resolve("./core/audio")];
  createAudio = require("./core/audio");

  bootEngine("reload");

  const preferredHueMode = getPreferredHueTransportMode();
  await setHueTransportMode(preferredHueMode);
  if (preferredHueMode === HUE_TRANSPORT.ENTERTAINMENT) {
    scheduleHueEntertainmentRecovery("reload");
  }

  console.log("[RAVE] engine hot-reloaded");
  res.sendStatus(200);
});

app.post("/rave/drop", (_, res) => {
  if (!audioReactivityMapRuntime.dropEnabled) {
    res.status(409).json({
      ok: false,
      error: "drop_disabled",
      message: "Drop trigger is disabled. Enable DROP REACTIVE in Audio Reactivity Map."
    });
    return;
  }
  engine.forceDrop?.();
  res.json({ ok: true, dropEnabled: true });
});

const twitchColorRuntime = createTwitchColorRuntime({
  fs,
  path,
  configPath: TWITCH_COLOR_CONFIG_PATH,
  configDefault: TWITCH_COLOR_CONFIG_DEFAULT,
  colorTargets: TWITCH_COLOR_TARGETS,
  prefixRegex: TWITCH_COLOR_PREFIX_RE,
  parseBoolean,
  normalizeRouteZoneToken
});
const {
  sanitizeTwitchColorPrefix,
  sanitizeTwitchColorTarget,
  sanitizeTwitchColorCommandText,
  sanitizeTwitchRaveOffGroupKey,
  sanitizeTwitchRaveOffConfig,
  getTwitchColorConfigSnapshot,
  patchTwitchColorConfig,
  parseColorTarget,
  splitPrefixedColorText
} = twitchColorRuntime;
const twitchColorRuntimeSummary = twitchColorRuntime.getLoadSummary();
console.log(
  `[COLOR] twitch command config loaded (default=${twitchColorRuntimeSummary.defaultTarget}, ` +
  `autoDefaultTarget=${twitchColorRuntimeSummary.autoDefaultTarget === true}, ` +
  `prefixes=${JSON.stringify(twitchColorRuntimeSummary.prefixes)}, ` +
  `fixturePrefixes=${Number(twitchColorRuntimeSummary.fixturePrefixCount || 0)}, ` +
  `raveOffEnabled=${twitchColorRuntimeSummary.raveOffEnabled === true})`
);

const audioReactivityMapRuntime = readAudioReactivityMapConfig();
const audioReactivityEnvelopeByTarget = {
  hue: 1,
  wiz: 1,
  other: 1
};
const wizReactiveDynamics = {
  beatPulse: 0,
  lastTickAt: 0,
  brightnessEma: 0,
  hueEma: null,
  colorEma: null
};
const hueReactiveDynamics = {
  lastTickAt: 0,
  hueEma: null,
  satEma: null
};
console.log(
  `[AUDIO] reactivity map loaded (dropEnabled=${audioReactivityMapRuntime.dropEnabled}, ` +
  `hardwareRateLimitsEnabled=${audioReactivityMapRuntime.hardwareRateLimitsEnabled !== false}, ` +
  `metaAutoHueWizBaselineBlend=${audioReactivityMapRuntime.metaAutoHueWizBaselineBlend === true}, ` +
  `metaAutoTempoTrackersAuto=${audioReactivityMapRuntime.metaAutoTempoTrackersAuto === true}, ` +
  `metaAutoTempoTrackers=${summarizeMetaAutoTempoTrackers(audioReactivityMapRuntime.metaAutoTempoTrackers)}, ` +
  `hue=${audioReactivityMapRuntime.targets.hue.sources.join("+")}, ` +
  `wiz=${audioReactivityMapRuntime.targets.wiz.sources.join("+")}, ` +
  `other=${audioReactivityMapRuntime.targets.other.sources.join("+")})`
);

function resetAudioReactivityEnvelopes() {
  for (const key of Object.keys(audioReactivityEnvelopeByTarget)) {
    audioReactivityEnvelopeByTarget[key] = 1;
  }
  wizReactiveDynamics.beatPulse = 0;
  wizReactiveDynamics.lastTickAt = 0;
  wizReactiveDynamics.brightnessEma = 0;
  wizReactiveDynamics.hueEma = null;
  wizReactiveDynamics.colorEma = null;
  hueReactiveDynamics.lastTickAt = 0;
  hueReactiveDynamics.hueEma = null;
  hueReactiveDynamics.satEma = null;
}

function getAudioReactivitySourceCatalogSnapshot() {
  const catalog = {};
  for (const [key, info] of Object.entries(AUDIO_REACTIVITY_SOURCE_CATALOG)) {
    catalog[key] = {
      label: String(info?.label || key).trim(),
      description: String(info?.description || "").trim()
    };
  }
  return catalog;
}

function summarizeMetaAutoTempoTrackers(trackers = {}) {
  const safe = sanitizeMetaAutoTempoTrackersConfig(
    trackers,
    AUDIO_REACTIVITY_MAP_DEFAULT.metaAutoTempoTrackers
  );
  const active = META_AUTO_TEMPO_TRACKER_KEYS.filter(key => safe[key] === true);
  return active.length ? active.join("+") : "classic";
}

function getAudioReactivityMapSnapshot() {
  return {
    version: Number(audioReactivityMapRuntime.version || 1),
    dropEnabled: Boolean(audioReactivityMapRuntime.dropEnabled),
    hardwareRateLimitsEnabled: audioReactivityMapRuntime.hardwareRateLimitsEnabled !== false,
    metaAutoHueWizBaselineBlend: audioReactivityMapRuntime.metaAutoHueWizBaselineBlend === true,
    metaAutoTempoTrackersAuto: audioReactivityMapRuntime.metaAutoTempoTrackersAuto === true,
    metaAutoTempoTrackers: sanitizeMetaAutoTempoTrackersConfig(
      audioReactivityMapRuntime.metaAutoTempoTrackers,
      AUDIO_REACTIVITY_MAP_DEFAULT.metaAutoTempoTrackers
    ),
    targets: {
      hue: {
        enabled: Boolean(audioReactivityMapRuntime.targets?.hue?.enabled),
        amount: clampAudioReactivityAmount(audioReactivityMapRuntime.targets?.hue?.amount, 1),
        sources: sanitizeAudioReactivitySources(audioReactivityMapRuntime.targets?.hue?.sources, ["smart"])
      },
      wiz: {
        enabled: Boolean(audioReactivityMapRuntime.targets?.wiz?.enabled),
        amount: clampAudioReactivityAmount(audioReactivityMapRuntime.targets?.wiz?.amount, 1),
        sources: sanitizeAudioReactivitySources(audioReactivityMapRuntime.targets?.wiz?.sources, ["smart"])
      },
      other: {
        enabled: Boolean(audioReactivityMapRuntime.targets?.other?.enabled),
        amount: clampAudioReactivityAmount(audioReactivityMapRuntime.targets?.other?.amount, 1),
        sources: sanitizeAudioReactivitySources(audioReactivityMapRuntime.targets?.other?.sources, ["smart"])
      }
    },
    sourceCatalog: getAudioReactivitySourceCatalogSnapshot()
  };
}

function patchAudioReactivityMapConfig(patch = {}, options = {}) {
  const rawPatchInput = patch && typeof patch === "object" ? patch : {};
  const opts = options && typeof options === "object" ? options : {};
  const preserveMetaControls = opts.preserveMetaControls === true;
  const rawPatch = { ...rawPatchInput };
  if (preserveMetaControls) {
    delete rawPatch.metaAutoHueWizBaselineBlend;
    delete rawPatch.metaAutoTempoTrackersAuto;
    delete rawPatch.metaAutoTempoTrackers;
  }
  const rawPatchTrackers = rawPatch.metaAutoTempoTrackers && typeof rawPatch.metaAutoTempoTrackers === "object"
    ? rawPatch.metaAutoTempoTrackers
    : {};
  const merged = {
    ...audioReactivityMapRuntime,
    ...rawPatch,
    metaAutoTempoTrackers: {
      ...(audioReactivityMapRuntime.metaAutoTempoTrackers || {}),
      ...rawPatchTrackers
    },
    targets: {
      ...(audioReactivityMapRuntime.targets || {}),
      ...(rawPatch.targets && typeof rawPatch.targets === "object" ? rawPatch.targets : {})
    }
  };
  const next = writeAudioReactivityMapConfig(merged);
  audioReactivityMapRuntime.version = next.version;
  audioReactivityMapRuntime.dropEnabled = next.dropEnabled;
  audioReactivityMapRuntime.hardwareRateLimitsEnabled = next.hardwareRateLimitsEnabled !== false;
  audioReactivityMapRuntime.metaAutoHueWizBaselineBlend = next.metaAutoHueWizBaselineBlend === true;
  audioReactivityMapRuntime.metaAutoTempoTrackersAuto = next.metaAutoTempoTrackersAuto === true;
  audioReactivityMapRuntime.metaAutoTempoTrackers = sanitizeMetaAutoTempoTrackersConfig(
    next.metaAutoTempoTrackers,
    AUDIO_REACTIVITY_MAP_DEFAULT.metaAutoTempoTrackers
  );
  audioReactivityMapRuntime.targets = {
    hue: { ...next.targets.hue },
    wiz: { ...next.targets.wiz },
    other: { ...next.targets.other }
  };
  resetAudioReactivityEnvelopes();
  if (engine?.setDropDetectionEnabled) {
    engine.setDropDetectionEnabled(Boolean(audioReactivityMapRuntime.dropEnabled));
  }
  if (engine?.setMetaAutoTempoBaselineBlend) {
    engine.setMetaAutoTempoBaselineBlend(
      Boolean(audioReactivityMapRuntime.metaAutoHueWizBaselineBlend)
    );
  }
  if (engine?.setMetaAutoTempoTrackers) {
    engine.setMetaAutoTempoTrackers(audioReactivityMapRuntime.metaAutoTempoTrackers);
  }
  if (engine?.setMetaAutoTempoTrackersAuto) {
    engine.setMetaAutoTempoTrackersAuto(
      Boolean(audioReactivityMapRuntime.metaAutoTempoTrackersAuto)
    );
  }
  return getAudioReactivityMapSnapshot();
}

function getAudioReactivityDrive(target = "hue", telemetry = null) {
  const targetKey = AUDIO_REACTIVITY_TARGET_KEYS.includes(String(target || "").trim().toLowerCase())
    ? String(target || "").trim().toLowerCase()
    : "other";
  const cfg = audioReactivityMapRuntime.targets?.[targetKey] || AUDIO_REACTIVITY_MAP_DEFAULT.targets[targetKey];
  if (!cfg || cfg.enabled === false) {
    audioReactivityEnvelopeByTarget[targetKey] = 1;
    return {
      target: targetKey,
      enabled: false,
      drive: 1,
      level: 1,
      amount: 1,
      sources: ["smart"]
    };
  }

  const t = telemetry && typeof telemetry === "object"
    ? telemetry
    : (engine?.getTelemetry?.() || {});
  const metaAutoEnabled = Boolean(
    engine?.getMetaAutoEnabled?.() ??
    engine?.getTelemetry?.()?.metaAutoEnabled
  );
  const metaAutoBlendActive =
    audioReactivityMapRuntime.metaAutoHueWizBaselineBlend === true &&
    metaAutoEnabled &&
    (targetKey === "hue" || targetKey === "wiz");
  let sources = sanitizeAudioReactivitySources(cfg.sources, ["smart"]);
  if (metaAutoBlendActive) {
    const blended = ["baseline", "drums", ...sources];
    sources = [...new Set(blended)].slice(0, 6);
  }
  const levels = sources.map(source => resolveAudioReactivitySourceLevel(source, t));
  const avgLevel = levels.reduce((sum, value) => sum + value, 0) / Math.max(1, levels.length);
  const sortedLevels = levels.slice().sort((a, b) => b - a);
  const sourcePeak = clamp01(sortedLevels[0], avgLevel);
  const upperCount = Math.max(1, Math.min(3, sortedLevels.length));
  const upperMean = sortedLevels.slice(0, upperCount).reduce((sum, value) => sum + value, 0) / upperCount;
  const transientLevel = resolveAudioReactivitySourceLevel("transients", t);
  const peakLevel = resolveAudioReactivitySourceLevel("peaks", t);
  const beatLevel = resolveAudioReactivitySourceLevel("beat", t);
  const drumsLevel = resolveAudioReactivitySourceLevel("drums", t);
  const vocalsLevel = resolveAudioReactivitySourceLevel("vocals", t);
  const vocalOverhang = clamp01(
    ((vocalsLevel * 0.86) - (drumsLevel * 0.62) - (beatLevel * 0.28)) * 1.25,
    0
  );
  const blendedLevel = clamp01(
    (avgLevel * 0.4) +
    (upperMean * 0.34) +
    (sourcePeak * 0.18) +
    (drumsLevel * 0.08),
    avgLevel
  );
  let characterLevel = clamp01(
    (transientLevel * 0.34) +
    (peakLevel * 0.3) +
    (beatLevel * 0.2) +
    (drumsLevel * 0.16),
    0
  );
  const shapedBody = clamp01(Math.pow(Math.max(blendedLevel, 0), 0.78), blendedLevel);
  characterLevel = clamp01(characterLevel * (1 - (vocalOverhang * 0.28)), 0);
  const shapedBodyTuned = clamp01(shapedBody * (1 - (vocalOverhang * 0.2)), shapedBody * 0.75);
  const amount = clampAudioReactivityAmount(cfg.amount, 1);
  const dynamicFloor = sources.length > 1 ? 0.5 : 0.46;
  const expressiveDrive = Math.max(
    0.34,
    Math.min(
      1.58,
      dynamicFloor +
      (shapedBodyTuned * 0.88) +
      (characterLevel * 0.44)
    )
  );
  const unsmoothedDrive = Math.max(
    0.34,
    Math.min(1.58, (1 - amount) + (expressiveDrive * amount))
  );
  const prevDrive = Math.max(0.34, Math.min(1.58, Number(audioReactivityEnvelopeByTarget[targetKey] || 1)));
  const alpha = unsmoothedDrive >= prevDrive ? 0.82 : 0.58;
  const drive = prevDrive + (unsmoothedDrive - prevDrive) * alpha;
  audioReactivityEnvelopeByTarget[targetKey] = drive;

  return {
    target: targetKey,
    enabled: true,
    drive,
    level: shapedBodyTuned,
    character: characterLevel,
    peak: peakLevel,
    transient: transientLevel,
    beat: beatLevel,
    vocalOverhang,
    amount,
    sources,
    metaAutoBlendActive
  };
}

function appendPaletteSignalToIntentOutput(intent = {}, telemetry = null, fallbackScene = "") {
  const nextIntent = intent && typeof intent === "object" ? { ...intent } : {};
  const t = telemetry && typeof telemetry === "object"
    ? telemetry
    : (engine?.getTelemetry?.() || {});
  const resolvedScene = String(
    nextIntent.scene ||
    t?.wizScene ||
    t?.scene ||
    fallbackScene ||
    ""
  ).trim().toLowerCase();
  nextIntent.bpm = clampNumber(Number(nextIntent.bpm ?? t?.bpm), 0, 260, 0);
  nextIntent.energy = clampNumber(
    Number(nextIntent.energy ?? t?.energy ?? nextIntent.audioDrive),
    0,
    1,
    0
  );
  nextIntent.rms = clampNumber(
    Number(nextIntent.rms ?? t?.audioSourceLevel ?? t?.rms ?? nextIntent.audioSourceLevel),
    0,
    1,
    0
  );
  nextIntent.audioBandLow = clampNumber(Number(nextIntent.audioBandLow ?? t?.audioBandLow), 0, 1, 0);
  nextIntent.audioBandMid = clampNumber(Number(nextIntent.audioBandMid ?? t?.audioBandMid), 0, 1, 0);
  nextIntent.audioBandHigh = clampNumber(Number(nextIntent.audioBandHigh ?? t?.audioBandHigh), 0, 1, 0);
  nextIntent.audioFlux = clampNumber(Number(nextIntent.audioFlux ?? t?.audioFlux), 0, 1, 0);
  nextIntent.audioPeak = clampNumber(Number(nextIntent.audioPeak ?? t?.audioPeak), 0, 1.5, 0);
  nextIntent.audioTransient = clampNumber(Number(nextIntent.audioTransient ?? t?.audioTransient), 0, 1.2, 0);
  nextIntent.beatConfidence = clampNumber(
    Number(nextIntent.beatConfidence ?? t?.beatConfidence),
    0,
    1,
    nextIntent.beat ? 0.62 : 0
  );
  nextIntent.phrase = String(nextIntent.phrase || t?.phrase || "").trim().toLowerCase();
  nextIntent.scene = resolvedScene;
  return nextIntent;
}

function getRawPercussiveBody(telemetry = {}) {
  const t = telemetry && typeof telemetry === "object" ? telemetry : {};
  const baseline = clamp01(t.audioSourceLevel, clamp01(t.rms, 0));
  const energyValue = clamp01(t.energy, baseline);
  const low = clamp01(t.audioBandLow, baseline);
  const mid = clamp01(t.audioBandMid, baseline);
  const high = clamp01(t.audioBandHigh, baseline);
  const transient = clamp01(t.audioTransient ?? t.transient, 0);
  const flux = clamp01(t.audioFlux, clamp01(t.spectralFlux, 0));
  const beat = clamp01(t.beatConfidence, t.beat ? 0.62 : 0);
  const drums = clamp01(
    (low * 0.56) +
    (transient * 0.27) +
    (flux * 0.17) +
    (beat * 0.08),
    0
  );
  const body = clamp01(
    Math.max(
      (energyValue * 0.68) + (baseline * 0.32),
      (baseline * 0.58) + (low * 0.24) + (mid * 0.18),
      (drums * 0.82) + (mid * 0.16),
      (high * 0.18) + (drums * 0.68) + (baseline * 0.22)
    ),
    baseline
  );
  const activity = clamp01(
    Math.max(
      body,
      drums * 0.96,
      (transient * 0.84) + (flux * 0.16),
      beat * 0.8
    ),
    body
  );
  return {
    baseline,
    drums,
    body,
    activity
  };
}

function applyHueIntentAudioReactivity(intent = {}, telemetry = null) {
  if (!intent || typeof intent !== "object") return intent;
  if (!intent.state || typeof intent.state !== "object") return intent;
  const profile = getAudioReactivityDrive("hue", telemetry);
  if (!profile.enabled) {
    hueReactiveDynamics.hueEma = null;
    hueReactiveDynamics.satEma = null;
    return { ...intent, drop: false };
  }
  const motionProfile = getAudioTelemetryMotionProfile(telemetry);
  const raw = getRawPercussiveBody(telemetry);
  const dropActive = Boolean(audioReactivityMapRuntime.dropEnabled && intent.drop);
  const beatActive = Boolean(intent.beat);
  const now = Date.now();
  hueReactiveDynamics.lastTickAt = now;

  const statePatch = { ...intent.state };
  const baseBri = clampNumber(statePatch.bri, 1, 254, 160);
  const floorPercent = clampNumber(
    0.24 +
      (profile.character * 0.16) +
      (raw.body * 0.2) +
      (raw.drums * 0.14) -
      (motionProfile.quietMix * 0.09) -
      (motionProfile.hushMix * 0.05),
    0.1,
    0.76,
    0.26
  );
  const floorBri = Math.max(3, Math.min(170, Math.round(baseBri * floorPercent)));
  const boundedDrive = Math.max(
    0.22,
    Math.min(
      1.64,
      profile.drive -
        (motionProfile.quietMix * 0.04) -
        (clamp01(profile.vocalOverhang, 0) * 0.06) +
        (raw.drums * 0.24) +
        (raw.body * 0.16)
    )
  );
  let nextBri = floorBri + ((baseBri - floorBri) * Math.min(1.04, boundedDrive));
  if (boundedDrive > 1.04) {
    const extra = Math.min(1, (boundedDrive - 1.04) / 0.41);
    const headroom = Math.max(0, 254 - baseBri);
    nextBri = baseBri + (headroom * extra * (0.6 + (profile.character * 0.4)));
  }
  statePatch.bri = Math.max(1, Math.min(254, Math.round(nextBri)));

  if (Number.isFinite(Number(statePatch.transitiontime))) {
    const flowMode = Boolean(intent.forceDelta);
    const baseTransition = clampNumber(statePatch.transitiontime, 0, 30, 3);
    const trim = Math.max(
      0,
      Math.round(
        ((boundedDrive - 0.36) * 3.1) +
        (profile.character * 1.2) +
        (raw.drums * 1.6) +
        (raw.body * 0.9)
      )
    );
    const quietHold = Math.round(Math.max(
      0,
      (clamp01(profile.vocalOverhang, 0) * 0.9) -
      (raw.drums * 1.8) -
      (raw.activity * 1.2)
    ));
    const transitionCap = flowMode || raw.activity > 0.26
      ? 2
      : 4;
    const floor = flowMode || raw.activity > 0.18 ? 1 : 0;
    statePatch.transitiontime = Math.max(
      floor,
      Math.min(transitionCap, baseTransition - trim + quietHold)
    );
  }
  if (Number.isFinite(Number(statePatch.sat)) && statePatch.on !== false) {
    const satBase = clampNumber(statePatch.sat, 1, 254, 180);
    const satBoost = Math.round(
      (profile.character * 16) +
      (Math.max(0, boundedDrive - 1) * 22) +
      (raw.drums * 8) -
      (clamp01(profile.vocalOverhang, 0) * 8)
    );
    const satTarget = Math.max(1, Math.min(254, satBase + satBoost));
    if (!(hueReactiveDynamics.satEma > 0)) {
      hueReactiveDynamics.satEma = satTarget;
    }
    const satAlpha = clampNumber(
      0.14 +
      (raw.drums * 0.14) +
      (raw.activity * 0.1) +
      (dropActive ? 0.18 : 0) +
      (beatActive ? 0.08 : 0),
      0.1,
      0.64,
      0.22
    );
    hueReactiveDynamics.satEma += (satTarget - hueReactiveDynamics.satEma) * satAlpha;
    statePatch.sat = Math.max(1, Math.min(254, Math.round(hueReactiveDynamics.satEma)));
  }
  const baseRateMs = clampNumber(intent.rateMs, 56, 1200, 0);
  const rhythmRateSignal = clampNumber(
    Math.max(
      raw.drums,
      raw.activity * 0.88,
      profile.transient * 0.92,
      profile.peak * 0.72,
      profile.beat * 0.7
    ),
    0,
    1,
    0
  );
  const rhythmTargetRateMs = Math.round(242 - (rhythmRateSignal * 150));
  let nextRateMs = baseRateMs > 0
    ? clampNumber(Math.min(baseRateMs, rhythmTargetRateMs), 56, 1200, baseRateMs)
    : intent.rateMs;
  if (dropActive) {
    nextRateMs = Math.min(nextRateMs, 82);
  } else if (rhythmRateSignal > 0.72) {
    nextRateMs = Math.min(nextRateMs, 100);
  } else if (rhythmRateSignal > 0.5) {
    nextRateMs = Math.min(nextRateMs, 126);
  }
  if (statePatch.on !== false && Number.isFinite(Number(statePatch.hue))) {
    const baseHueDeg = normalizePaletteHueDeg((Number(statePatch.hue) / 65535) * 360);
    if (!Number.isFinite(Number(hueReactiveDynamics.hueEma))) {
      hueReactiveDynamics.hueEma = baseHueDeg;
    }
    const signalStrength = clampNumber(
      Math.max(
        raw.drums * 0.9,
        raw.activity * 0.78,
        profile.transient * 0.72,
        profile.peak * 0.62,
        dropActive ? 1 : 0,
        beatActive ? 0.68 : 0
      ),
      0,
      1,
      0
    );
    const fastRateSignal = clampNumber((172 - nextRateMs) / 116, 0, 1, 0);
    const hueAlpha = clampNumber(
      0.1 +
      (signalStrength * 0.22) +
      (fastRateSignal * 0.14) +
      (dropActive ? 0.08 : 0) +
      (beatActive ? 0.04 : 0),
      0.08,
      0.62,
      0.2
    );
    const maxStepDeg = clampNumber(
      5 +
      (signalStrength * 22) +
      (fastRateSignal * 16) +
      (dropActive ? 12 : 0),
      4,
      46,
      12
    );
    const hueDelta = shortestHueDeltaDeg(hueReactiveDynamics.hueEma, baseHueDeg);
    const hueStep = clampNumber(hueDelta * hueAlpha, -maxStepDeg, maxStepDeg, 0);
    hueReactiveDynamics.hueEma = normalizePaletteHueDeg(hueReactiveDynamics.hueEma + hueStep);
    let stabilizedHue = Math.round((hueReactiveDynamics.hueEma / 360) * 65535) % 65535;
    if (stabilizedHue < 0) stabilizedHue += 65535;
    statePatch.hue = stabilizedHue;
  }
  const quietMaxSilenceMs = null;
  const forcedDeltaByBody = raw.drums > 0.24 || raw.activity > 0.32 || profile.transient > 0.26;
  const baseDeltaScale = clampNumber(
    Number(intent.deltaScale),
    0.35,
    1.2,
    Boolean(intent.forceDelta) ? 0.72 : 1
  );
  const deltaFloor = nextRateMs <= 105 ? 0.36 : 0.42;
  const nextDeltaScale = clampNumber(
    baseDeltaScale - (raw.drums * 0.28) - (raw.activity * 0.16),
    deltaFloor,
    1.05,
    baseDeltaScale
  );

  return appendPaletteSignalToIntentOutput({
    ...intent,
    drop: dropActive,
    forceDelta: Boolean(intent.forceDelta || forcedDeltaByBody),
    deltaScale: nextDeltaScale,
    rateMs: nextRateMs,
    ...(Number.isFinite(quietMaxSilenceMs) ? { maxSilenceMs: quietMaxSilenceMs } : {}),
    audioDrive: Number(profile.drive.toFixed(3)),
    audioSourceLevel: Number(profile.level.toFixed(3)),
    audioMotion: Number(motionProfile.motion.toFixed(3)),
    audioDrums: Number(raw.drums.toFixed(3)),
    audioBody: Number(raw.body.toFixed(3)),
    audioSources: profile.sources,
    state: statePatch
  }, telemetry);
}

function applyWizIntentAudioReactivity(intent = {}, telemetry = null) {
  if (!intent || typeof intent !== "object") return intent;
  const profile = getAudioReactivityDrive("wiz", telemetry);
  if (!profile.enabled) {
    wizReactiveDynamics.beatPulse = 0;
    wizReactiveDynamics.lastTickAt = 0;
    wizReactiveDynamics.brightnessEma = 0;
    wizReactiveDynamics.hueEma = null;
    wizReactiveDynamics.colorEma = null;
    return { ...intent, drop: false };
  }
  const motionProfile = getAudioTelemetryMotionProfile(telemetry);
  const raw = getRawPercussiveBody(telemetry);
  const sceneName = String(
    intent.scene ||
    telemetry?.wizScene ||
    telemetry?.scene ||
    ""
  ).trim().toLowerCase();
  const pulseScene = sceneName === "pulse_strobe";
  const flowScene = sceneName.startsWith("flow_");

  const next = { ...intent };
  const dropActive = Boolean(audioReactivityMapRuntime.dropEnabled && intent.drop);
  const beatActive = Boolean(intent.beat);
  const now = Date.now();
  const elapsedMs = wizReactiveDynamics.lastTickAt > 0
    ? clampNumber(now - wizReactiveDynamics.lastTickAt, 8, 280, 33)
    : 33;
  wizReactiveDynamics.lastTickAt = now;
  const beatDecay = Math.pow(0.5, elapsedMs / 210);
  wizReactiveDynamics.beatPulse *= beatDecay;
  const beatAttack = clamp01(
    (profile.beat * 0.56) +
    (profile.transient * 0.28) +
    (profile.peak * 0.16) +
    (raw.drums * 0.18),
    0
  );
  const drumAttack = clamp01(
    (raw.drums * 0.72) +
    (profile.transient * 0.22) +
    (motionProfile.motion * 0.06),
    0
  );
  if (dropActive) {
    wizReactiveDynamics.beatPulse = Math.max(wizReactiveDynamics.beatPulse, 1);
  } else if (beatActive) {
    wizReactiveDynamics.beatPulse = Math.max(
      wizReactiveDynamics.beatPulse,
      0.72 + (beatAttack * 0.24)
    );
  } else if (drumAttack > 0.28) {
    wizReactiveDynamics.beatPulse = Math.max(
      wizReactiveDynamics.beatPulse,
      0.34 + (drumAttack * 0.42)
    );
  }
  const beatPulse = clamp01(wizReactiveDynamics.beatPulse, 0);
  const baseBrightness = clampNumber(next.brightness, 0.004, 1, 0.65);
  const boundedDrive = Math.max(
    0.2,
    Math.min(
      1.62,
      profile.drive -
        (motionProfile.quietMix * 0.05) -
        (clamp01(profile.vocalOverhang, 0) * 0.08) +
        (raw.drums * 0.26) +
        (raw.body * 0.14)
    )
  );
  const driveNorm = clampNumber((boundedDrive - 0.34) / 1.06, 0, 1, 0);
  const floorPercent = clampNumber(
    0.26 +
      (profile.character * 0.16) +
      (raw.body * 0.16) +
      (raw.drums * 0.12) -
      (motionProfile.quietMix * 0.08) -
      (motionProfile.hushMix * 0.04),
    0.01,
    0.78,
    0.28
  );
  const floor = Math.max(0.002, Math.min(0.58, baseBrightness * floorPercent));
  let brightness = floor + ((baseBrightness - floor) * Math.min(1.04, boundedDrive));
  brightness += beatPulse * (
    pulseScene
      ? (0.2 + (profile.character * 0.12))
      : (0.12 + (profile.character * 0.08))
  );
  if (boundedDrive > 1.04) {
    const extra = Math.min(1, (boundedDrive - 1.04) / 0.41);
    const headroom = Math.max(0, 1 - baseBrightness);
    brightness = baseBrightness + (headroom * extra * (0.78 + (profile.character * 0.5)));
  }
  const highEvidence = clampNumber(
    (driveNorm * 0.58) +
    (raw.drums * 0.2) +
    (profile.peak * 0.22) +
    (profile.beat * 0.2),
    0,
    1,
    driveNorm
  );
  const lowEvidence = clampNumber(
    (motionProfile.quietMix * 0.4) +
    (motionProfile.hushMix * 0.28) +
    ((1 - driveNorm) * 0.22) -
    (raw.drums * 0.42) -
    (raw.body * 0.28),
    0,
    1,
    0
  );
  if (dropActive) {
    brightness = Math.max(
      brightness,
      baseBrightness * (1.2 + (profile.character * 0.08))
    );
    if (highEvidence >= 0.68 || (boundedDrive >= 1.08 && brightness >= 0.84)) {
      brightness = 1;
    } else if (highEvidence >= 0.52) {
      brightness = Math.max(brightness, 0.95);
    }
  } else if (beatActive && boundedDrive >= 1.04) {
    brightness = Math.max(
      brightness,
      baseBrightness * (1.1 + (profile.character * 0.06))
    );
    if (highEvidence >= 0.76 || (boundedDrive >= 1.14 && brightness >= 0.86)) {
      brightness = Math.max(brightness, 1);
    } else if (highEvidence >= 0.62) {
      brightness = Math.max(brightness, 0.93);
    }
  }
  if (pulseScene) {
    if (dropActive) {
      brightness = Math.max(brightness, 0.98);
    } else if (beatActive) {
      brightness = Math.max(brightness, 0.9);
    } else if (beatPulse > 0.54) {
      brightness = Math.max(brightness, 0.72 + beatPulse * 0.3);
    }
  }
  if (!dropActive) {
    const quietDimmer = Math.max(
      0.05,
      pulseScene
        ? 1 - (motionProfile.quietMix * 0.1) - (motionProfile.hushMix * 0.12) + (beatPulse * 0.14) + (raw.drums * 0.18)
        : 1 - (motionProfile.quietMix * 0.18) - (motionProfile.hushMix * 0.22) + (beatPulse * 0.1) + (raw.drums * 0.22) + (raw.body * 0.12)
    );
    brightness *= quietDimmer;
    if (!beatActive && drumAttack < 0.24 && lowEvidence > 0.84) {
      const quietCap = 0.03 + ((1 - lowEvidence) * 0.1);
      brightness = Math.min(brightness, quietCap);
    }
    if (highEvidence >= 0.74 && brightness >= 0.7) brightness = Math.max(brightness, 1);
    brightness = Math.min(brightness, 1);
  }
  const brightnessTarget = Math.max(0.003, Math.min(1, brightness));
  if (!(wizReactiveDynamics.brightnessEma > 0)) {
    wizReactiveDynamics.brightnessEma = brightnessTarget;
  }
  const prevBrightnessEma = wizReactiveDynamics.brightnessEma;
  const riseAlpha = clampNumber(
    (pulseScene ? 0.66 : 0.58) +
      (beatPulse * (pulseScene ? 0.2 : 0.14)) +
      (dropActive ? (pulseScene ? 0.22 : 0.18) : 0) +
      (raw.drums * 0.2) +
      (raw.body * 0.12),
    0.42,
    0.98,
    0.64
  );
  const fallAlpha = clampNumber(
    (pulseScene ? 0.5 : 0.42) +
      ((1 - clamp01(motionProfile.motion, 0)) * (pulseScene ? 0.12 : 0.16)) +
      (raw.drums * 0.1) +
      (raw.activity * 0.08),
    0.32,
    0.86,
    0.48
  );
  const brightnessAlpha = brightnessTarget >= wizReactiveDynamics.brightnessEma
    ? riseAlpha
    : fallAlpha;
  wizReactiveDynamics.brightnessEma += (brightnessTarget - wizReactiveDynamics.brightnessEma) * brightnessAlpha;
  const riseDiff = Math.max(0, brightnessTarget - prevBrightnessEma);
  const fallDiff = Math.max(0, prevBrightnessEma - brightnessTarget);
  if (
    riseDiff > 0.06 &&
    (dropActive || beatActive || drumAttack > 0.3 || profile.transient > 0.24)
  ) {
    const attackKick = Math.max(0.02, riseDiff * 0.38);
    wizReactiveDynamics.brightnessEma = Math.min(1, wizReactiveDynamics.brightnessEma + attackKick);
  }
  if (fallDiff > 0.07 && !dropActive) {
    const releaseKick = Math.max(0.018, fallDiff * (pulseScene ? 0.3 : 0.34));
    wizReactiveDynamics.brightnessEma = Math.max(0.003, wizReactiveDynamics.brightnessEma - releaseKick);
  }
  next.brightness = Math.max(0.003, Math.min(1, wizReactiveDynamics.brightnessEma));
  const minRateMs = pulseScene ? 84 : (flowScene ? 1200 : 72);
  const maxRateMs = flowScene ? 3800 : 1200;
  const baseRateMs = clampNumber(next.rateMs, minRateMs, maxRateMs, 0);
  const rhythmRateSignal = clampNumber(
    Math.max(
      raw.drums,
      raw.activity * 0.9,
      profile.transient * 0.92,
      profile.peak * 0.74,
      profile.beat * 0.7,
      beatPulse * 0.82
    ),
    0,
    1,
    0
  );
  const rhythmTargetRateMs = Math.round(
    pulseScene
      ? (210 - (rhythmRateSignal * 100))
      : (
        flowScene
          ? (3000 - (rhythmRateSignal * 380))
          : (234 - (rhythmRateSignal * 108))
      )
  );
  next.rateMs = baseRateMs > 0
    ? clampNumber(Math.min(baseRateMs, rhythmTargetRateMs), minRateMs, maxRateMs, baseRateMs)
    : next.rateMs;
  if (dropActive) {
    next.rateMs = Math.min(next.rateMs, pulseScene ? 88 : (flowScene ? 1800 : 100));
  } else if (rhythmRateSignal > 0.72) {
    next.rateMs = Math.min(next.rateMs, pulseScene ? 96 : (flowScene ? 2200 : 112));
  } else if (rhythmRateSignal > 0.5) {
    next.rateMs = Math.min(next.rateMs, pulseScene ? 106 : (flowScene ? 2600 : 126));
  }
  const saturationBoost = 0.72;
  if (next.color && typeof next.color === "object") {
    if (pulseScene || flowScene) {
      if (flowScene) {
        // Keep engine-generated flow hue motion intact instead of over-smoothing.
        wizReactiveDynamics.hueEma = null;
      }
      next.color = {
        ...boostRgbSaturation(
          {
            r: clampRgb255(next.color.r),
            g: clampRgb255(next.color.g),
            b: clampRgb255(next.color.b)
          },
          pulseScene ? 0.04 : 0.08
        )
      };
    } else {
      const currentHsv = rgbToHsv255(next.color);
      const hueNudge = dropActive
        ? (2.8 + (profile.character * 2.2))
        : beatActive
          ? (1.1 + (beatPulse * 1.6))
          : (
            drumAttack > 0.34
              ? (0.5 + (drumAttack * 0.9))
              : 0
          );
      const rawTargetHue = normalizePaletteHueDeg(currentHsv.h + hueNudge);
      if (!Number.isFinite(Number(wizReactiveDynamics.hueEma))) {
        wizReactiveDynamics.hueEma = currentHsv.h;
      }
      const hueSignal = clampNumber(
        Math.max(
          drumAttack * 0.9,
          raw.drums * 0.84,
          raw.activity * 0.58,
          beatPulse * 0.86,
          dropActive ? 1 : 0,
          beatActive ? 0.66 : 0
        ),
        0,
        1,
        0
      );
      const settleBias = (!dropActive && !beatActive && drumAttack < 0.28) ? 0.12 : 0;
      const hueAlpha = clampNumber(
        0.035 + (hueSignal * 0.08) + (settleBias * 0.45),
        0.03,
        0.2,
        0.07
      );
      const maxHueStep = clampNumber(
        1.2 + (hueSignal * 3.6) + (dropActive ? 1.1 : 0),
        1,
        7,
        2.4
      );
      const hueDelta = shortestHueDeltaDeg(wizReactiveDynamics.hueEma, rawTargetHue);
      const hueStep = clampNumber(hueDelta * hueAlpha, -maxHueStep, maxHueStep, 0);
      let nextHue = normalizePaletteHueDeg(wizReactiveDynamics.hueEma + hueStep);
      const maxDriftFromBase = clampNumber(
        dropActive
          ? (6 + (profile.character * 1.4))
          : (
            beatActive
              ? (4 + (beatPulse * 1.8))
              : (drumAttack > 0.34 ? 2.8 : 1.8)
          ),
        1.4,
        8,
        3
      );
      const driftFromBase = shortestHueDeltaDeg(currentHsv.h, nextHue);
      nextHue = normalizePaletteHueDeg(
        currentHsv.h + clampNumber(driftFromBase, -maxDriftFromBase, maxDriftFromBase, 0)
      );
      wizReactiveDynamics.hueEma = nextHue;
      const satFloor = clampNumber(
        0.88 + (profile.character * 0.08) + (beatPulse * 0.06),
        0.86,
        0.99,
        0.9
      );
      const valueFloor = clampNumber(
        Math.max(0.2, (next.brightness * 0.44)) + (beatPulse * 0.06),
        0.16,
        0.56,
        0.24
      );
      next.color = {
        ...boostRgbSaturation(
          hsvToRgb255(
            nextHue,
            Math.max(currentHsv.s, satFloor),
            Math.max(currentHsv.v, valueFloor)
          ),
          saturationBoost
        )
      };
    }
  }
  if (next.color && typeof next.color === "object") {
    const targetColor = {
      r: clampRgb255(next.color.r),
      g: clampRgb255(next.color.g),
      b: clampRgb255(next.color.b)
    };
    if (pulseScene) {
      wizReactiveDynamics.colorEma = null;
    } else {
      const prevColor = wizReactiveDynamics.colorEma && typeof wizReactiveDynamics.colorEma === "object"
        ? wizReactiveDynamics.colorEma
        : targetColor;
      const colorMotion = clampNumber(
        Math.max(motionProfile.motion, raw.activity, beatPulse * 0.72),
        0,
        1,
        0
      );
      const colorSignal = clampNumber(
        Math.max(colorMotion, beatPulse * 0.84, dropActive ? 1 : 0, beatActive ? 0.62 : 0),
        0,
        1,
        colorMotion
      );
      const riseAlpha = clampNumber(
        flowScene ? (0.1 + colorSignal * 0.18) : (0.08 + colorSignal * 0.16),
        0.07,
        0.34,
        0.14
      );
      const fallAlpha = clampNumber(
        flowScene ? (0.08 + (1 - colorSignal) * 0.08) : (0.06 + (1 - colorSignal) * 0.08),
        0.05,
        0.22,
        0.1
      );
      const blendChannel = (current, target) => {
        const alpha = target >= current ? riseAlpha : fallAlpha;
        return current + ((target - current) * alpha);
      };
      const smoothedColor = {
        r: blendChannel(prevColor.r, targetColor.r),
        g: blendChannel(prevColor.g, targetColor.g),
        b: blendChannel(prevColor.b, targetColor.b)
      };
      wizReactiveDynamics.colorEma = smoothedColor;
      next.color = {
        r: clampRgb255(Math.round(smoothedColor.r)),
        g: clampRgb255(Math.round(smoothedColor.g)),
        b: clampRgb255(Math.round(smoothedColor.b))
      };
    }
  }
  const forcedDeltaByBody = raw.drums > 0.29 || raw.activity > 0.38 || drumAttack > 0.42;
  const baseDeltaScale = clampNumber(
    Number(next.deltaScale),
    0.35,
    1.2,
    pulseScene ? 1 : (flowScene ? 0.94 : 0.96)
  );
  // Do not force every beat by default; preserve enough hold time so WiZ colors read clearly.
  const beatForce = pulseScene ? beatActive : false;
  next.forceDelta = Boolean(next.forceDelta || dropActive || beatForce || forcedDeltaByBody);
  next.deltaScale = clampNumber(
    baseDeltaScale - (raw.drums * 0.28) - (raw.activity * 0.16),
    0.56,
    1.04,
    baseDeltaScale
  );
  next.drop = dropActive;
  next.audioDrive = Number(profile.drive.toFixed(3));
  next.audioSourceLevel = Number(profile.level.toFixed(3));
  next.audioMotion = Number(motionProfile.motion.toFixed(3));
  next.audioDrums = Number(raw.drums.toFixed(3));
  next.audioBody = Number(raw.body.toFixed(3));
  next.audioSources = profile.sources;
  return appendPaletteSignalToIntentOutput(next, telemetry, sceneName);
}

const TWITCH_COLOR_BRIGHTNESS = Object.freeze({
  hueBriBright: 254,
  hueBriDim: 178,
  wizDimmingBright: 100,
  wizDimmingDim: 70
});

function getTwitchColorCapabilities() {
  const fixtures = typeof fixtureRegistry.listTwitchBy === "function"
    ? fixtureRegistry.listTwitchBy("", "")
    : fixtureRegistry.listBy("", "");
  const hasOther = fixtures.some(fixture => {
    const brand = String(fixture?.brand || "").trim().toLowerCase();
    return Boolean(brand && brand !== "hue" && brand !== "wiz");
  });

  return {
    hue: true,
    wiz: true,
    other: hasOther
  };
}

function resolveTwitchFixtureById(fixtureId) {
  const targetId = String(fixtureId || "").trim();
  if (!targetId) return null;
  const fixtures = listColorCommandFixtures("", "");
  for (const fixture of fixtures) {
    if (String(fixture?.id || "").trim() === targetId) return fixture;
  }
  return null;
}

function parseTwitchColorDirective(rawText) {
  const source = sanitizeTwitchColorCommandText(rawText, "");
  if (!source) {
    return { ok: false, error: "missing color text" };
  }

  const words = source.split(/\s+/).filter(Boolean);
  let brightnessToken = "";
  const colorWords = [];
  for (const word of words) {
    const key = String(word || "").trim().toLowerCase();
    if (key === "bright" || key === "dim") {
      brightnessToken = key;
      continue;
    }
    colorWords.push(word);
  }

  if (!colorWords.length) {
    if (!brightnessToken) {
      return { ok: false, error: "missing color text" };
    }
    const isDim = brightnessToken === "dim";
    return {
      ok: true,
      type: "brightness_only",
      brightness: brightnessToken,
      hueState: {
        on: true,
        bri: isDim ? TWITCH_COLOR_BRIGHTNESS.hueBriDim : TWITCH_COLOR_BRIGHTNESS.hueBriBright,
        transitiontime: 2
      },
      wizState: {
        on: true,
        dimming: isDim ? TWITCH_COLOR_BRIGHTNESS.wizDimmingDim : TWITCH_COLOR_BRIGHTNESS.wizDimmingBright
      }
    };
  }

  const colorText = colorWords.join(" ").trim();
  const normalizedColorText = colorText.toLowerCase();
  if (TWITCH_RANDOM_COLOR_TOKENS.has(normalizedColorText)) {
    const hueDeg = Math.floor(Math.random() * 360);
    const hueValue = Math.round((hueDeg / 360) * 65535) % 65535;
    const rgb = hsvToRgb255(hueDeg, 1, 1);
    const isDim = brightnessToken === "dim";
    return {
      ok: true,
      type: "random",
      brightness: brightnessToken || "bright",
      colorText: "random",
      hueState: {
        on: true,
        hue: hueValue < 0 ? hueValue + 65535 : hueValue,
        sat: 254,
        bri: isDim ? TWITCH_COLOR_BRIGHTNESS.hueBriDim : TWITCH_COLOR_BRIGHTNESS.hueBriBright,
        transitiontime: 2
      },
      wizState: {
        on: true,
        r: rgb.r,
        g: rgb.g,
        b: rgb.b,
        dimming: isDim ? TWITCH_COLOR_BRIGHTNESS.wizDimmingDim : TWITCH_COLOR_BRIGHTNESS.wizDimmingBright
      }
    };
  }
  const parseText = brightnessToken ? `${brightnessToken} ${colorText}` : colorText;
  const parsed = colorEngine.parseColor(parseText);
  if (!parsed) {
    return { ok: false, error: "invalid color text" };
  }

  const hueState = {
    ...parsed,
    transitiontime: Number.isFinite(Number(parsed.transitiontime)) ? parsed.transitiontime : 2
  };
  if (brightnessToken === "dim") {
    hueState.bri = TWITCH_COLOR_BRIGHTNESS.hueBriDim;
  } else if (!Number.isFinite(Number(hueState.bri)) || brightnessToken === "bright") {
    hueState.bri = TWITCH_COLOR_BRIGHTNESS.hueBriBright;
  }

  const wizState = hueStateToWizState(hueState);
  if (brightnessToken === "dim") {
    wizState.dimming = TWITCH_COLOR_BRIGHTNESS.wizDimmingDim;
  } else if (!Number.isFinite(Number(wizState.dimming)) || brightnessToken === "bright") {
    wizState.dimming = TWITCH_COLOR_BRIGHTNESS.wizDimmingBright;
  }

  return {
    ok: true,
    type: "color",
    brightness: brightnessToken || "",
    colorText,
    hueState,
    wizState
  };
}

function normalizeTwitchRaveOffDirective(directive) {
  const source = directive && typeof directive === "object" ? directive : null;
  if (!source || source.ok !== true) return source;
  if (source.type !== "random") return source;

  const hueStateSource = source.hueState && typeof source.hueState === "object"
    ? source.hueState
    : {};
  const wizStateSource = source.wizState && typeof source.wizState === "object"
    ? source.wizState
    : {};

  return {
    ...source,
    brightness: "bright",
    hueState: {
      ...hueStateSource,
      on: true,
      bri: TWITCH_COLOR_BRIGHTNESS.hueBriBright,
      transitiontime: Number.isFinite(Number(hueStateSource.transitiontime))
        ? hueStateSource.transitiontime
        : 2
    },
    wizState: {
      ...wizStateSource,
      on: true,
      dimming: TWITCH_COLOR_BRIGHTNESS.wizDimmingBright
    }
  };
}

function getColorRequestOptions(req) {
  const query = req.query || {};
  const body = req.body || {};
  const rawTarget = query.target ?? query.brand ?? body.target ?? body.brand;
  const targetText = String(rawTarget ?? "").trim();
  const targetExplicit = targetText.length > 0;
  return {
    target: targetExplicit ? parseColorTarget(targetText, "both") : null,
    targetExplicit,
    zone: String(query.zone ?? body.zone ?? "").trim(),
    hueZone: String(query.hueZone ?? body.hueZone ?? "").trim(),
    wizZone: String(query.wizZone ?? body.wizZone ?? "").trim()
  };
}

function resolveAutoDefaultColorTarget(commandConfig = {}) {
  const fallback = parseColorTarget(
    commandConfig.defaultTarget,
    TWITCH_COLOR_CONFIG_DEFAULT.defaultTarget
  );
  if (commandConfig.autoDefaultTarget === false) {
    return fallback;
  }

  if (fallback !== "hue" && fallback !== "wiz") {
    return fallback;
  }

  const fixtures = listColorCommandFixtures("", "");
  let hasHue = false;
  let hasWiz = false;
  for (const fixture of fixtures) {
    const brand = String(fixture?.brand || "").trim().toLowerCase();
    if (brand === "hue") hasHue = true;
    if (brand === "wiz") hasWiz = true;
    if (hasHue && hasWiz) break;
  }

  if (fallback === "hue") {
    if (hasHue) return "hue";
    if (hasWiz) return "wiz";
    return "hue";
  }

  if (fallback === "wiz") {
    if (hasWiz) return "wiz";
    if (hasHue) return "hue";
    return "wiz";
  }

  return fallback;
}

function resolveZonesFromRoute(rawZone, brand, fallbackZone, listFn, options = {}) {
  const mode = String(options.mode || "engine").trim().toLowerCase();
  const canonicalFallback = getCanonicalZoneFallback(brand, fallbackZone || "custom");
  const parsed = parseZoneList(rawZone, canonicalFallback);
  const hasAll = parsed.some(z => z === "*" || String(z).toLowerCase() === "all");
  if (!hasAll) return parsed;
  const zones = [...new Set(
    listFn(brand)
      .map(fixture => getFixtureDispatchZoneForMode(fixture, mode))
      .map(zone => String(zone || canonicalFallback).trim())
      .filter(Boolean)
  )];
  return zones.length ? zones : [canonicalFallback];
}

function collectFixturesByZones(listFn, brand, zones = []) {
  const byId = new Map();
  for (const zone of zones) {
    for (const fixture of listFn(brand, zone)) {
      const key = String(fixture.id || `${fixture.brand}:${fixture.zone}:${fixture.ip || fixture.lightId}`);
      byId.set(key, fixture);
    }
  }
  return [...byId.values()];
}

async function sendHueStateToFixtures(fixtures = [], state = {}) {
  if (!fixtures.length) return;
  const ops = fixtures.map(target =>
    axios.put(
      `https://${target.bridgeIp}/api/${target.username}/lights/${target.lightId}/state`,
      state,
      {
        timeout: 1800,
        httpsAgent: getHueRestHttpsAgent(target)
      }
    )
  );
  const results = await Promise.allSettled(ops);
  for (const result of results) {
    if (result.status === "rejected") {
      console.warn("[COLOR][HUE] send failed:", result.reason?.message || result.reason);
    }
  }
}

function sendWizStateToFixtures(fixtures = [], wizState = {}) {
  for (const fixture of fixtures) {
    try {
      const send = getStandaloneWizAdapter(fixture);
      send(
        wizState,
        { repeats: 2, repeatDelayMs: 16 }
      );
    } catch (err) {
      console.warn("[COLOR][WIZ] send failed:", err.message || err);
    }
  }
}

async function applyColorText(rawText, options = {}) {
  if (state.isLockedBy("rave")) {
    return {
      ok: false,
      target: null,
      usedPrefix: null,
      fixtureTargetId: null,
      error: "rave active; /color is disabled while RAVE is on"
    };
  }

  const commandConfig = getTwitchColorConfigSnapshot();
  const prefixed = splitPrefixedColorText(
    rawText,
    commandConfig.prefixes,
    commandConfig.fixturePrefixes
  );
  const fixtureScopedTarget = !options.targetExplicit && prefixed.fixtureId
    ? resolveTwitchFixtureById(prefixed.fixtureId)
    : null;
  const implicitDefaultTarget = resolveAutoDefaultColorTarget(commandConfig);
  const target = options.targetExplicit
    ? parseColorTarget(options.target, implicitDefaultTarget)
    : fixtureScopedTarget
      ? parseColorTarget(fixtureScopedTarget.brand, implicitDefaultTarget)
    : parseColorTarget(prefixed.target || implicitDefaultTarget, implicitDefaultTarget);
  const colorText = String(prefixed.text || "").trim();

  if (!colorText) {
    return {
      ok: false,
      target,
      usedPrefix: prefixed.prefix || null,
      fixtureTargetId: prefixed.fixtureId || null,
      error: prefixed.target
        ? `missing color after ${prefixed.target} prefix`
        : prefixed.fixtureId
          ? "missing color after fixture prefix"
        : "missing color text"
    };
  }

  if (!options.targetExplicit && prefixed.fixtureId && !fixtureScopedTarget) {
    return {
      ok: false,
      target: null,
      usedPrefix: prefixed.prefix || null,
      fixtureTargetId: prefixed.fixtureId,
      error: `fixture prefix target not found or not twitch-enabled: ${prefixed.fixtureId}`
    };
  }

  if (target === "other") {
    return {
      ok: false,
      target,
      usedPrefix: prefixed.prefix || null,
      fixtureTargetId: prefixed.fixtureId || null,
      error: "other target requires mod-brand color adapter support"
    };
  }

  const directive = parseTwitchColorDirective(colorText);
  if (!directive.ok) {
    return {
      ok: false,
      target,
      usedPrefix: prefixed.prefix || null,
      fixtureTargetId: prefixed.fixtureId || null,
      error: directive.error || "invalid color text"
    };
  }

  const fixedFixture = fixtureScopedTarget || null;
  const response = {
    ok: true,
    target,
    usedPrefix: prefixed.prefix || null,
    fixtureTargetId: fixedFixture ? String(fixedFixture.id || "") : null,
    hueZones: [],
    wizZones: [],
    hueTargets: 0,
    wizTargets: 0,
    directiveType: directive.type
  };

  if (target === "hue" || target === "both") {
    const hueZones = fixedFixture
      ? [String(getFixtureDispatchZoneForMode(fixedFixture, "twitch") || "hue").trim() || "hue"]
      : resolveZonesFromRoute(
        options.hueZone || options.zone || fixtureRegistry.resolveZone("TWITCH_HUE") || "hue",
        "hue",
        "hue",
        listColorCommandFixtures,
        { mode: "twitch" }
      );
    response.hueZones = hueZones;
    const hueFixtures = fixedFixture
      ? (String(fixedFixture.brand || "").trim().toLowerCase() === "hue" ? [fixedFixture] : [])
      : collectFixturesByZones(listColorCommandFixtures, "hue", hueZones);
    response.hueTargets = hueFixtures.length;
    if (hueFixtures.length) {
      await sendHueStateToFixtures(hueFixtures, directive.hueState);
    }
  }

  if (target === "wiz" || target === "both") {
    const wizZones = fixedFixture
      ? [String(getFixtureDispatchZoneForMode(fixedFixture, "twitch") || "wiz").trim() || "wiz"]
      : resolveZonesFromRoute(
        options.wizZone || options.zone || fixtureRegistry.resolveZone("TWITCH_WIZ") || "wiz",
        "wiz",
        "wiz",
        listColorCommandFixtures,
        { mode: "twitch" }
      );
    response.wizZones = wizZones;
    const wizFixtures = fixedFixture
      ? (String(fixedFixture.brand || "").trim().toLowerCase() === "wiz" ? [fixedFixture] : [])
      : collectFixturesByZones(listColorCommandFixtures, "wiz", wizZones);
    response.wizTargets = wizFixtures.length;
    if (wizFixtures.length) {
      sendWizStateToFixtures(wizFixtures, directive.wizState);
    }
  }

  if ((response.hueTargets + response.wizTargets) <= 0) {
    response.ok = false;
    response.error = "no routed fixtures matched";
  }

  return response;
}

function resolveTwitchRaveOffCommandForFixture(fixture, raveOffConfig = {}) {
  const fixtureId = String(fixture?.id || "").trim();
  const brand = String(fixture?.brand || "").trim().toLowerCase();
  const zone = normalizeRouteZoneToken(
    getFixtureDispatchZoneForMode(fixture, "engine"),
    normalizeRouteZoneToken(fixture?.zone, getCanonicalZoneFallback(brand, brand))
  );
  const fixtureMap = raveOffConfig.fixtures && typeof raveOffConfig.fixtures === "object"
    ? raveOffConfig.fixtures
    : {};
  const groupMap = raveOffConfig.groups && typeof raveOffConfig.groups === "object"
    ? raveOffConfig.groups
    : {};

  if (fixtureId && fixtureMap[fixtureId]) {
    return sanitizeTwitchColorCommandText(fixtureMap[fixtureId], "");
  }
  const zoneKey = sanitizeTwitchRaveOffGroupKey(`${brand}:${zone}`);
  if (zoneKey && groupMap[zoneKey]) {
    return sanitizeTwitchColorCommandText(groupMap[zoneKey], "");
  }
  if (brand && groupMap[brand]) {
    return sanitizeTwitchColorCommandText(groupMap[brand], "");
  }
  return sanitizeTwitchColorCommandText(raveOffConfig.defaultText, "");
}

async function applyTwitchRaveOffColorProfile() {
  const colorConfigSnapshot = getTwitchColorConfigSnapshot();
  const config = sanitizeTwitchRaveOffConfig(
    colorConfigSnapshot?.raveOff,
    TWITCH_COLOR_CONFIG_DEFAULT.raveOff
  );
  if (config.enabled !== true) {
    return { ok: true, applied: false, reason: "disabled", targets: 0 };
  }

  const fixturesById = new Map();
  for (const fixture of listEngineFixtures("hue")) {
    const fixtureId = String(fixture?.id || "").trim();
    if (fixtureId) fixturesById.set(fixtureId, fixture);
  }
  for (const fixture of listEngineFixtures("wiz")) {
    const fixtureId = String(fixture?.id || "").trim();
    if (fixtureId) fixturesById.set(fixtureId, fixture);
  }
  const fixtures = [...fixturesById.values()];
  if (!fixtures.length) {
    return { ok: true, applied: false, reason: "no_engine_targets", targets: 0 };
  }

  const assignments = [];
  const warnings = [];
  for (const fixture of fixtures) {
    const commandText = resolveTwitchRaveOffCommandForFixture(fixture, config);
    if (!commandText) continue;
    const directive = parseTwitchColorDirective(commandText);
    if (!directive.ok) {
      warnings.push({
        fixtureId: String(fixture?.id || "").trim(),
        commandText,
        error: directive.error || "invalid color text"
      });
      continue;
    }
    assignments.push({
      fixture,
      directive: normalizeTwitchRaveOffDirective(directive),
      commandText
    });
  }

  if (!assignments.length) {
    return {
      ok: true,
      applied: false,
      reason: warnings.length ? "invalid_commands" : "empty_profile",
      targets: fixtures.length,
      warnings
    };
  }

  const hueBatches = new Map();
  const wizBatches = new Map();
  for (const item of assignments) {
    const fixture = item.fixture;
    const brand = String(fixture?.brand || "").trim().toLowerCase();
    if (brand === "hue") {
      const key = JSON.stringify(item.directive.hueState);
      const batch = hueBatches.get(key) || { state: item.directive.hueState, fixtures: [] };
      batch.fixtures.push(fixture);
      hueBatches.set(key, batch);
    } else if (brand === "wiz") {
      const key = JSON.stringify(item.directive.wizState);
      const batch = wizBatches.get(key) || { state: item.directive.wizState, fixtures: [] };
      batch.fixtures.push(fixture);
      wizBatches.set(key, batch);
    }
  }

  for (const batch of hueBatches.values()) {
    // RAVE is already stopping; enforce REST hue writes.
    await sendHueStateToFixtures(batch.fixtures, batch.state);
  }
  for (const batch of wizBatches.values()) {
    sendWizStateToFixtures(batch.fixtures, batch.state);
  }

  return {
    ok: true,
    applied: true,
    targets: fixtures.length,
    assigned: assignments.length,
    hueTargets: [...hueBatches.values()].reduce((sum, batch) => sum + batch.fixtures.length, 0),
    wizTargets: [...wizBatches.values()].reduce((sum, batch) => sum + batch.fixtures.length, 0),
    warnings
  };
}

function teachColor(rawText) {
  return colorEngine.teach(String(rawText || ""));
}

function getCompatText(req) {
  return String(
    req.query.value1 ??
    req.query.text ??
    req.query.value ??
    req.body?.value1 ??
    req.body?.text ??
    req.body?.value ??
    ""
  ).trim();
}

function patchBrandKey(patch, rawValue) {
  const normalized = normalizePaletteBrandKey(rawValue);
  patch.brand = normalized || String(rawValue || "").trim().toLowerCase();
}

app.get("/obs/dock", (req, res) => {
  const compact = parseBoolean(req.query.compact, true);
  const dockUrl = compact ? "/?obsDock=1&compact=1" : "/?obsDock=1&compact=0";
  res.redirect(302, dockUrl);
});

app.get("/teach", (_, res) => {
  res.status(405).json({
    ok: false,
    error: "method_not_allowed",
    detail: "Use POST /teach."
  });
});

app.post("/teach", (req, res) => {
  const text = getCompatText(req);
  const ok = teachColor(text);
  res.json({ ok, text });
});

app.get("/color/prefixes", (_, res) => {
  res.json({
    ok: true,
    config: getTwitchColorConfigSnapshot(),
    capabilities: getTwitchColorCapabilities()
  });
});

app.post("/color/prefixes", (req, res) => {
  const body = getRequestMap(req.body);
  const patch = {};

  if (hasOwn(body, "defaultTarget")) {
    patch.defaultTarget = body.defaultTarget;
  }
  if (hasOwn(body, "autoDefaultTarget")) {
    patch.autoDefaultTarget = body.autoDefaultTarget;
  }
  if (hasOwn(body, "autoDefault")) {
    patch.autoDefaultTarget = body.autoDefault;
  }

  if (body.prefixes && typeof body.prefixes === "object") {
    patch.prefixes = { ...body.prefixes };
  }

  if (isNonArrayObject(body.fixturePrefixes)) {
    patch.fixturePrefixes = { ...body.fixturePrefixes };
  }

  if (isNonArrayObject(body.raveOff)) {
    patch.raveOff = { ...body.raveOff };
  }

  const prefixAliasMap = [
    ["huePrefix", "hue"],
    ["wizPrefix", "wiz"],
    ["otherPrefix", "other"]
  ];
  for (const [bodyKey, prefixKey] of prefixAliasMap) {
    if (hasOwn(body, bodyKey)) {
      mergePatchObject(patch, "prefixes", { [prefixKey]: body[bodyKey] });
    }
  }

  if (body.clearOther === true || body.reset === true) {
    mergePatchObject(patch, "prefixes", { other: "" });
  }

  if (body.clearFixturePrefixes === true || body.reset === true) {
    patch.fixturePrefixes = {};
  }

  if (hasOwn(body, "raveOffEnabled")) {
    mergePatchObject(patch, "raveOff", { enabled: body.raveOffEnabled });
  }

  if (hasOwn(body, "raveOffDefaultText")) {
    mergePatchObject(patch, "raveOff", { defaultText: body.raveOffDefaultText });
  }

  if (isNonArrayObject(body.raveOffGroups)) {
    mergePatchObject(patch, "raveOff", { groups: { ...body.raveOffGroups } });
  }

  if (isNonArrayObject(body.raveOffFixtures)) {
    mergePatchObject(patch, "raveOff", { fixtures: { ...body.raveOffFixtures } });
  }

  if (body.clearRaveOffGroups === true || body.reset === true) {
    mergePatchObject(patch, "raveOff", { groups: {} });
  }

  if (body.clearRaveOffFixtures === true || body.reset === true) {
    mergePatchObject(patch, "raveOff", { fixtures: {} });
  }

  if (body.reset === true) {
    patch.defaultTarget = TWITCH_COLOR_CONFIG_DEFAULT.defaultTarget;
    patch.autoDefaultTarget = TWITCH_COLOR_CONFIG_DEFAULT.autoDefaultTarget;
    patch.raveOff = {
      enabled: TWITCH_COLOR_CONFIG_DEFAULT.raveOff.enabled,
      defaultText: TWITCH_COLOR_CONFIG_DEFAULT.raveOff.defaultText,
      groups: {},
      fixtures: {}
    };
  }

  const config = patchTwitchColorConfig(patch);
  res.json({
    ok: true,
    config,
    capabilities: getTwitchColorCapabilities()
  });
});

function handleColorRequest(req, res) {
  const text = getCompatText(req);
  applyColorText(text, getColorRequestOptions(req))
    .then(result => {
      if (result.ok) {
        res.json({ ok: true, text, ...result });
        return;
      }
      const message = String(result.error || "").toLowerCase();
      const status = message.includes("rave active") ? 409 : 200;
      res.status(status).json({ ok: false, text, ...result });
    })
    .catch(err => {
      res.status(500).json({ ok: false, text, error: err.message || String(err) });
    });
}

if (ENABLE_LEGACY_COLOR_GET_RUNTIME) {
  app.get("/color", handleColorRequest);
} else {
  app.get("/color", (_, res) => {
    res.status(405).json({
      ok: false,
      error: "method_not_allowed",
      detail: "Use POST /color. Set RAVELINK_ENABLE_LEGACY_COLOR_GET=1 to re-enable legacy GET compatibility."
    });
  });
}
app.post("/color", handleColorRequest);

function parsePaletteFamiliesInput(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map(item => String(item || "").trim().toLowerCase())
      .filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map(item => String(item || "").trim().toLowerCase())
      .filter(Boolean);
  }
  return null;
}

function parsePaletteFamilyColorCountsInput(raw) {
  let source = raw;
  if (typeof source === "string") {
    const text = source.trim();
    if (!text) return null;
    try {
      source = JSON.parse(text);
    } catch {
      return null;
    }
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return null;
  }
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(source)) {
    const key = String(rawKey || "").trim().toLowerCase();
    const mapped = PALETTE_FAMILY_ALIASES[key] || key;
    if (!PALETTE_FAMILY_ORDER.includes(mapped)) continue;
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) continue;
    out[mapped] = parsed;
  }
  return Object.keys(out).length ? out : null;
}

function collectPalettePatch(req) {
  const read = createRequestValueReader(req);
  const patch = {};
  patchOptionalNumber(read, patch, "colorsPerFamily");
  const familyColorCounts = parsePaletteFamilyColorCountsInput(read("familyColorCounts"));
  if (familyColorCounts && Object.keys(familyColorCounts).length) {
    patch.familyColorCounts = familyColorCounts;
  }

  const familiesRaw = read("families");
  const families = parsePaletteFamiliesInput(familiesRaw);
  if (families && families.length) {
    patch.families = families;
  }

  patchOptionalBoolean(read, patch, "disorder");
  patchOptionalNumber(read, patch, "disorderAggression");
  patchOptionalLowerString(read, patch, "cycleMode");
  patchOptionalNumber(read, patch, "timedIntervalSec");
  patchOptionalBoolean(read, patch, "beatLock");
  patchOptionalNumber(read, patch, "beatLockGraceSec");
  patchOptionalNumber(read, patch, "reactiveMargin");
  patchOptionalLowerString(read, patch, "brightnessMode");
  patchOptionalNumber(read, patch, "brightnessFollowAmount");
  patchOptionalNumber(read, patch, "vividness");
  patchOptionalLowerString(read, patch, "spectrumMapMode");

  const spectrumFeatureMapRaw = read("spectrumFeatureMap");
  if (spectrumFeatureMapRaw !== undefined) {
    if (Array.isArray(spectrumFeatureMapRaw)) {
      patch.spectrumFeatureMap = parseLowerTokenList(spectrumFeatureMapRaw);
    } else {
      const parsedList = parseLowerTokenList(spectrumFeatureMapRaw);
      if (parsedList.length) patch.spectrumFeatureMap = parsedList;
    }
  }

  const brandRaw = read("brand");
  if (brandRaw !== undefined) {
    patchBrandKey(patch, brandRaw);
  }

  const fixtureIdRaw = read("fixtureId");
  if (fixtureIdRaw !== undefined) {
    patch.fixtureId = String(fixtureIdRaw || "").trim();
  }

  patchOptionalBoolean(read, patch, "clearOverride");

  return patch;
}

function collectFixtureMetricPatch(req) {
  const read = createRequestValueReader(req);
  const patch = {};

  const modeRaw = read("mode");
  if (modeRaw !== undefined) {
    const rawMode = String(modeRaw || "").trim().toLowerCase();
    if (!rawMode || !FIXTURE_METRIC_MODE_ORDER.includes(rawMode)) {
      patch.__invalidMode = rawMode || String(modeRaw || "");
    } else {
      patch.mode = rawMode;
    }
  }

  const metricRaw = read("metric");
  if (metricRaw !== undefined) {
    const rawMetric = String(metricRaw || "").trim().toLowerCase();
    if (!rawMetric || !FIXTURE_METRIC_KEYS.includes(rawMetric)) {
      patch.__invalidMetric = rawMetric || String(metricRaw || "");
    } else {
      patch.metric = rawMetric;
    }
  }

  const flipRaw = read("metaAutoFlip");
  if (flipRaw !== undefined) {
    const parsed = parseBoolean(flipRaw, null);
    if (parsed !== null) patch.metaAutoFlip = parsed;
  }

  const harmonyRaw = read("harmonySize");
  if (harmonyRaw !== undefined) {
    const harmonyNum = Number(harmonyRaw);
    if (!Number.isFinite(harmonyNum)) {
      patch.__invalidHarmonySize = String(harmonyRaw || "");
    } else {
      patch.harmonySize = normalizeFixtureMetricHarmonySize(
        harmonyNum,
        FIXTURE_METRIC_CONFIG_DEFAULT.harmonySize
      );
    }
  }

  const maxHzRaw = read("maxHz");
  if (maxHzRaw !== undefined) {
    if (maxHzRaw === null) {
      patch.maxHz = null;
    } else {
      const isString = typeof maxHzRaw === "string";
      const rawText = isString
        ? maxHzRaw.trim().toLowerCase()
        : "";
      if (
        isString &&
        (
          rawText === "" ||
          rawText === "off" ||
          rawText === "none" ||
          rawText === "null" ||
          rawText === "unclamped" ||
          rawText === "unclamp" ||
          rawText === "disabled"
        )
      ) {
        patch.maxHz = null;
      } else {
        const maxHzNum = Number(maxHzRaw);
        if (!Number.isFinite(maxHzNum)) {
          patch.__invalidMaxHz = String(maxHzRaw);
        } else if (maxHzNum <= 0) {
          patch.maxHz = null;
        } else {
          patch.maxHz = normalizeFixtureMetricMaxHz(
            maxHzNum,
            FIXTURE_METRIC_CONFIG_DEFAULT.maxHz
          );
        }
      }
    }
  }

  const brandRaw = read("brand");
  if (brandRaw !== undefined) patchBrandKey(patch, brandRaw);

  const fixtureIdRaw = read("fixtureId");
  if (fixtureIdRaw !== undefined) {
    patch.fixtureId = String(fixtureIdRaw || "").trim();
  }

  patchOptionalBoolean(read, patch, "clearOverride");

  return patch;
}

function collectFixtureRoutingClearPatch(req) {
  const read = createRequestValueReader(req);
  const patch = {};

  const brandRaw = read("brand");
  if (brandRaw !== undefined) {
    patchBrandKey(patch, brandRaw);
  }

  const fixtureIdRaw = read("fixtureId");
  if (fixtureIdRaw !== undefined) {
    patch.fixtureId = String(fixtureIdRaw || "").trim();
  }

  return patch;
}

function buildPalettePresetRuntimeOptions() {
  const out = {};
  for (const [key, preset] of Object.entries(SHARED_PALETTE_PRESETS || {})) {
    const id = String(preset?.id || key || "").trim().toLowerCase();
    if (!id) continue;
    const families = normalizePaletteFamilies(
      Array.isArray(preset?.families) ? preset.families : [],
      PALETTE_FAMILY_ORDER
    );
    const entry = {
      id,
      label: String(preset?.label || id).trim() || id,
      group: String(preset?.group || "").trim().toLowerCase() || "custom",
      families
    };
    const colorsPerFamily = Number(preset?.colorsPerFamily);
    if (Number.isFinite(colorsPerFamily)) {
      entry.colorsPerFamily = normalizePaletteColorCount(
        colorsPerFamily,
        PALETTE_CONFIG_DEFAULT.colorsPerFamily
      );
    } else {
      entry.colorsPerFamily = null;
    }
    if (preset?.familyColorCounts && typeof preset.familyColorCounts === "object") {
      entry.familyColorCounts = normalizePaletteFamilyColorCounts(
        preset.familyColorCounts,
        buildPaletteUniformColorCounts(PALETTE_CONFIG_DEFAULT.colorsPerFamily),
        PALETTE_CONFIG_DEFAULT.colorsPerFamily
      );
    }
    out[id] = entry;
  }
  return out;
}

function buildPaletteRuntimeSnapshot(configOverride = null) {
  const fixtures = fixtureRegistry.getFixtures?.() || [];
  prunePaletteFixtureOverrides(fixtures);
  const defaultConfig = {
    colorsPerFamily: PALETTE_CONFIG_DEFAULT.colorsPerFamily,
    familyColorCounts: { ...PALETTE_CONFIG_DEFAULT.familyColorCounts },
    families: PALETTE_CONFIG_DEFAULT.families.slice(),
    disorder: PALETTE_CONFIG_DEFAULT.disorder,
    disorderAggression: PALETTE_CONFIG_DEFAULT.disorderAggression,
    cycleMode: PALETTE_CONFIG_DEFAULT.cycleMode,
    timedIntervalSec: PALETTE_CONFIG_DEFAULT.timedIntervalSec,
    beatLock: PALETTE_CONFIG_DEFAULT.beatLock,
    beatLockGraceSec: PALETTE_CONFIG_DEFAULT.beatLockGraceSec,
    reactiveMargin: PALETTE_CONFIG_DEFAULT.reactiveMargin,
    brightnessMode: PALETTE_CONFIG_DEFAULT.brightnessMode,
    brightnessFollowAmount: PALETTE_CONFIG_DEFAULT.brightnessFollowAmount,
    vividness: PALETTE_CONFIG_DEFAULT.vividness,
    spectrumMapMode: PALETTE_CONFIG_DEFAULT.spectrumMapMode,
    spectrumFeatureMap: PALETTE_CONFIG_DEFAULT.spectrumFeatureMap.slice()
  };
  const sourceConfig = configOverride || engine.getPaletteConfig?.() || defaultConfig;
  const normalizedGlobalConfig = normalizePaletteConfigSnapshot(
    sourceConfig,
    defaultConfig
  );
  const sourceBrands = (
    sourceConfig &&
    typeof sourceConfig === "object" &&
    sourceConfig.brands &&
    typeof sourceConfig.brands === "object"
  )
    ? sourceConfig.brands
    : {};
  const normalizedBrandOverrides = {};
  for (const brand of PALETTE_SUPPORTED_BRANDS) {
    const override = sourceBrands[brand];
    normalizedBrandOverrides[brand] = (
      override &&
      typeof override === "object" &&
      !Array.isArray(override)
    )
      ? normalizePaletteConfigSnapshot(override, normalizedGlobalConfig)
      : null;
  }
  return {
    ok: true,
    config: {
      ...normalizedGlobalConfig,
      brands: normalizedBrandOverrides
    },
    catalog: engine.getPaletteCatalog?.() || [],
    options: {
      colorsPerFamily: PALETTE_COLOR_COUNT_OPTIONS.slice(),
      families: PALETTE_FAMILY_ORDER.slice(),
      familyAliases: { ...PALETTE_FAMILY_ALIASES },
      brands: PALETTE_SUPPORTED_BRANDS.slice(),
      presets: buildPalettePresetRuntimeOptions(),
      cycleModes: PALETTE_CYCLE_MODE_ORDER.slice(),
      brightnessModes: PALETTE_BRIGHTNESS_MODE_ORDER.slice(),
      spectrumMapModes: PALETTE_SPECTRUM_MAP_MODE_ORDER.slice(),
      audioFeatures: PALETTE_AUDIO_FEATURE_KEYS.slice(),
      timedIntervalSec: {
        min: PALETTE_TIMED_INTERVAL_MIN_SEC,
        max: PALETTE_TIMED_INTERVAL_MAX_SEC,
        default: PALETTE_CONFIG_DEFAULT.timedIntervalSec
      },
      beatLockGraceSec: {
        min: PALETTE_BEAT_LOCK_GRACE_MIN_SEC,
        max: PALETTE_BEAT_LOCK_GRACE_MAX_SEC,
        default: PALETTE_CONFIG_DEFAULT.beatLockGraceSec
      },
      reactiveMargin: {
        min: PALETTE_REACTIVE_MARGIN_MIN,
        max: PALETTE_REACTIVE_MARGIN_MAX,
        default: PALETTE_CONFIG_DEFAULT.reactiveMargin
      },
      brightnessFollowAmount: {
        min: PALETTE_BRIGHTNESS_FOLLOW_AMOUNT_MIN,
        max: PALETTE_BRIGHTNESS_FOLLOW_AMOUNT_MAX,
        default: PALETTE_CONFIG_DEFAULT.brightnessFollowAmount
      },
      vividness: {
        levels: PALETTE_VIVIDNESS_LEVEL_OPTIONS.slice(),
        default: PALETTE_CONFIG_DEFAULT.vividness
      }
    },
    metricRouting: buildFixtureMetricRoutingSnapshot(fixtures),
    brandFixtures: buildPaletteBrandFixtureCatalog(fixtures),
    fixtureOverrides: buildPaletteFixtureOverrideSnapshot()
  };
}

registerRavePaletteMetricRoutes(app, {
  collectPalettePatch,
  collectFixtureMetricPatch,
  collectFixtureRoutingClearPatch,
  normalizePaletteBrandKey,
  parseBooleanLoose,
  hasPalettePatchFields,
  hasFixtureMetricPatchFields,
  PALETTE_SUPPORTED_BRANDS,
  PALETTE_PATCH_FIELDS,
  FIXTURE_METRIC_MODE_ORDER,
  FIXTURE_METRIC_KEYS,
  FIXTURE_METRIC_HARMONY_MIN,
  FIXTURE_METRIC_HARMONY_MAX,
  FIXTURE_METRIC_MAX_HZ_MIN,
  FIXTURE_METRIC_MAX_HZ_MAX,
  setFixturePaletteOverrideConfig,
  patchFixtureMetricRoutingConfig,
  clearFixtureRoutingOverridesAtomic,
  buildPaletteRuntimeSnapshot,
  buildFixtureMetricRoutingSnapshot,
  buildPaletteBrandFixtureCatalog,
  fixtureRegistry,
  getEngine: () => engine
});

app.post("/rave/mode", (req, res) => {
  const requested = String(req.query.name || "bpm").trim().toLowerCase();
  if (requested && requested !== "bpm" && requested !== "interpret") {
    return res.status(410).json({
      ok: false,
      error: "mode removed",
      replacement: "/rave/mode?name=bpm"
    });
  }
  engine.setBehavior?.("interpret");
  res.sendStatus(200);
});

/* ======================================================
   SCENE CONTROL
   ====================================================== */
app.post("/rave/scene", (req, res) => {
  const ok = engine.setScene?.(req.query.name || null);
  if (ok === false) {
    res.status(400).json({
      ok: false,
      error: "invalid scene",
      requested: String(req.query.name || "")
    });
    return;
  }
  res.sendStatus(200);
});

app.post("/rave/scene/auto", (_, res) => {
  engine.setScene?.(null);
  res.sendStatus(200);
});


/* ======================================================
   MIDI CONTROL
   ====================================================== */
registerMidiRoutes(app, {
  getMidiManager: () => midiManager,
  getRequestMap
});

registerRaveOverclockRoutes(app, {
  getEngine: () => engine
});

app.post("/rave/panic", async (_, res) => {
  console.warn("[PANIC] BLACKOUT");

  audio.stop();
  await engine.stop();
  await setHueTransportMode(HUE_TRANSPORT.REST);

  const hueZones = [...new Set(fixtureRegistry.listBy("hue").map(f => f.zone || "hue"))];
  for (const zone of hueZones) {
    enqueueHue({ on: false, transitiontime: 0 }, zone);
  }

  res.sendStatus(200);
});

app.post("/rave/auto/profile", (req, res) => {
  const name = String(req.query.name || "").toLowerCase();
  const ok = engine.setAutoProfile?.(name);

  if (!ok) {
    res.status(400).json({
      ok: false,
      error: "invalid profile",
      allowed: ["reactive", "balanced", "cinematic"]
    });
    return;
  }

  console.log("[RAVE] auto profile =", name);
  res.json({ ok: true, name });
});

function setAudioReactivityRoute(req, res) {
  const name = String(req.query.name || "").toLowerCase();
  const ok = engine.setAudioReactivityPreset?.(name);

  if (!ok) {
    res.status(400).json({
      ok: false,
      error: "invalid audio reactivity preset",
      allowed: ["balanced", "aggressive", "precision"]
    });
    return;
  }

  console.log("[RAVE] audio reactivity =", name);
  res.json({ ok: true, name });
}

app.post("/rave/audio/reactivity", setAudioReactivityRoute);
app.post("/rave/audio/profile", setAudioReactivityRoute);

app.post("/rave/flow/intensity", (req, res) => {
  const raw = req.query.value ?? req.query.intensity ?? req.body?.value ?? req.body?.intensity;
  const next = engine.setFlowIntensity?.(raw);

  if (next === false || next === null || next === undefined) {
    res.status(400).json({
      ok: false,
      error: "invalid flow intensity",
      allowedRange: { min: 0.35, max: 2.5 }
    });
    return;
  }

  console.log("[RAVE] flow intensity =", Number(next).toFixed(2));
  res.json({ ok: true, value: Number(next) });
});

app.get("/rave/flow/intensity", (_, res) => {
  const value = Number(engine.getFlowIntensity?.() ?? engine.getTelemetry?.()?.flowIntensity ?? 1);
  res.json({
    ok: true,
    value
  });
});

function readEnabledFlagRaw(req, fallback = undefined) {
  return req.query.enabled
    ?? req.query.on
    ?? req.query.value
    ?? req.body?.enabled
    ?? req.body?.on
    ?? req.body?.value
    ?? fallback;
}

function parseEnabledFlagForRoute(req, res, { fallback = undefined, requireInput = false } = {}) {
  const raw = readEnabledFlagRaw(req, fallback);
  const hasInput = raw !== null && raw !== undefined && String(raw).trim() !== "";
  if (!hasInput && requireInput) {
    res.status(400).json({
      ok: false,
      error: "missing enabled flag",
      allowed: ["true", "false"]
    });
    return null;
  }
  const enabled = parseBoolean(raw, null);
  if (enabled === null) {
    res.status(400).json({
      ok: false,
      error: "invalid enabled flag",
      allowed: ["true", "false"]
    });
    return null;
  }
  return Boolean(enabled);
}

registerRaveSceneSyncRoutes(app, {
  getEngine: () => engine,
  parseEnabledFlagForRoute
});

app.post("/rave/meta/auto", (req, res) => {
  const enabled = parseEnabledFlagForRoute(req, res);
  if (enabled === null) return;

  const next = engine.setMetaAutoEnabled?.(enabled);
  console.log(`[RAVE] meta auto ${next ? "ON" : "OFF"}`);
  res.json({
    ok: true,
    enabled: Boolean(next)
  });
});

function getMetaAutoTempoTrackersRuntimeSnapshot() {
  const safe = sanitizeMetaAutoTempoTrackersConfig(
    audioReactivityMapRuntime.metaAutoTempoTrackers,
    AUDIO_REACTIVITY_MAP_DEFAULT.metaAutoTempoTrackers
  );
  safe.baseline = audioReactivityMapRuntime.metaAutoHueWizBaselineBlend === true;
  return safe;
}

function hasAnyMetaAutoTempoTrackerEnabled(trackers = {}) {
  const safe = sanitizeMetaAutoTempoTrackersConfig(
    trackers,
    AUDIO_REACTIVITY_MAP_DEFAULT.metaAutoTempoTrackers
  );
  return META_AUTO_TEMPO_TRACKER_KEYS.some(key => safe[key] === true);
}

function sameMetaAutoTempoTrackersConfig(a = {}, b = {}) {
  const aa = sanitizeMetaAutoTempoTrackersConfig(
    a,
    AUDIO_REACTIVITY_MAP_DEFAULT.metaAutoTempoTrackers
  );
  const bb = sanitizeMetaAutoTempoTrackersConfig(
    b,
    AUDIO_REACTIVITY_MAP_DEFAULT.metaAutoTempoTrackers
  );
  for (const key of META_AUTO_TEMPO_TRACKER_KEYS) {
    if (aa[key] !== bb[key]) return false;
  }
  return true;
}

function recommendMetaAutoTempoTrackers(trackers = {}, telemetry = {}) {
  const safeCurrent = sanitizeMetaAutoTempoTrackersConfig(
    trackers,
    AUDIO_REACTIVITY_MAP_DEFAULT.metaAutoTempoTrackers
  );
  const t = telemetry && typeof telemetry === "object" ? telemetry : {};
  const bpm = clamp(Number(t.bpm || 0), 0, 220);
  const beatConfidence = clamp(Number(t.beatConfidence || 0), 0, 1);
  const transient = clamp(Number(t.audioTransient || 0), 0, 1.4);
  const flux = clamp(Number(t.audioFlux || 0), 0, 1.2);
  const lowBand = clamp(Number(t.audioBandLow || 0), 0, 1.2);
  const energy = clamp(Number(t.energy || 0), 0, 1.4);
  const motion = clamp(
    Math.max(
      transient * 0.86,
      flux * 0.82,
      beatConfidence * 0.9,
      Math.min(1, energy * 0.74),
      Math.min(1, bpm / 172)
    ),
    0,
    1
  );
  const calmState = motion < 0.28 && energy < 0.24 && transient < 0.16 && flux < 0.14;

  const recommended = {
    baseline: true,
    peaks: false,
    transients: false,
    flux: false
  };

  if (motion >= 0.42 || bpm >= 136 || transient >= 0.24 || flux >= 0.22 || energy >= 0.4) {
    recommended.transients = true;
    recommended.flux = true;
  }
  if (bpm >= 152 || beatConfidence >= 0.56 || transient >= 0.34 || motion >= 0.58) {
    recommended.peaks = true;
  }
  if (calmState) {
    recommended.flux = true;
    recommended.transients = recommended.transients && (transient >= 0.2 || beatConfidence >= 0.3);
    recommended.peaks = false;
  }
  if (lowBand >= 0.24 || beatConfidence >= 0.24) {
    recommended.baseline = true;
  }

  if (!recommended.peaks && !recommended.transients && !recommended.flux) {
    recommended.transients = true;
  }

  // Keep existing hard-ON toggles unless force is requested by caller.
  return sanitizeMetaAutoTempoTrackersConfig(
    {
      ...recommended,
      baseline: recommended.baseline || safeCurrent.baseline
    },
    AUDIO_REACTIVITY_MAP_DEFAULT.metaAutoTempoTrackers
  );
}

function applyMetaAutoTempoTrackerCandidates(options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const force = Boolean(opts.force);
  const currentAutoEnabled = audioReactivityMapRuntime.metaAutoTempoTrackersAuto === true;
  const autoEnabled = hasOwn(opts, "autoEnabled")
    ? Boolean(opts.autoEnabled)
    : currentAutoEnabled;
  const current = getMetaAutoTempoTrackersRuntimeSnapshot();
  if (!force && hasAnyMetaAutoTempoTrackerEnabled(current)) {
    let existing = sanitizeMetaAutoTempoTrackersConfig(
      current,
      AUDIO_REACTIVITY_MAP_DEFAULT.metaAutoTempoTrackers
    );
    if (currentAutoEnabled !== autoEnabled) {
      const toggled = patchAudioReactivityMapConfig({
        metaAutoTempoTrackersAuto: autoEnabled
      });
      existing = sanitizeMetaAutoTempoTrackersConfig(
        toggled.metaAutoTempoTrackers,
        AUDIO_REACTIVITY_MAP_DEFAULT.metaAutoTempoTrackers
      );
    }
    return {
      trackers: existing,
      autoEnabled,
      changed: currentAutoEnabled !== autoEnabled,
      reason: currentAutoEnabled !== autoEnabled ? "auto-updated" : "already-configured"
    };
  }

  const telemetry = engine?.getTelemetry?.() || {};
  const recommended = recommendMetaAutoTempoTrackers(current, telemetry);
  const merged = force
    ? recommended
    : sanitizeMetaAutoTempoTrackersConfig(
      { ...current, ...recommended },
      AUDIO_REACTIVITY_MAP_DEFAULT.metaAutoTempoTrackers
    );
  const next = patchAudioReactivityMapConfig({
    metaAutoTempoTrackersAuto: autoEnabled,
    metaAutoTempoTrackers: merged,
    metaAutoHueWizBaselineBlend: merged.baseline === true
  });
  const safeTrackers = sanitizeMetaAutoTempoTrackersConfig(
    next.metaAutoTempoTrackers,
    AUDIO_REACTIVITY_MAP_DEFAULT.metaAutoTempoTrackers
  );
  const changed = !sameMetaAutoTempoTrackersConfig(current, safeTrackers) ||
    currentAutoEnabled !== (next.metaAutoTempoTrackersAuto === true);
  return {
    trackers: safeTrackers,
    autoEnabled: next.metaAutoTempoTrackersAuto === true,
    changed,
    reason: changed ? "generated" : "unchanged"
  };
}

function parseMetaAutoTempoTrackerPatchFromRequest(req) {
  const bodyRoot = getRequestMap(req.body);
  const autoRaw = req.query.auto
    ?? req.query.autoEnabled
    ?? bodyRoot.auto
    ?? bodyRoot.autoEnabled;
  const autoEnabled = parseBoolean(autoRaw, null);
  const modeRaw = String(req.query.mode ?? bodyRoot.mode ?? "").trim().toLowerCase();
  if (modeRaw) {
    if (!META_AUTO_TEMPO_TRACKER_KEYS.includes(modeRaw)) {
      return { ok: false, error: "invalid mode", allowedModes: META_AUTO_TEMPO_TRACKER_KEYS };
    }
    const rawEnabled = req.query.enabled
      ?? req.query.on
      ?? req.query.value
      ?? bodyRoot.enabled
      ?? bodyRoot.on
      ?? bodyRoot.value;
    const enabled = parseBoolean(rawEnabled, null);
    if (enabled === null) {
      return { ok: false, error: "invalid enabled flag", allowed: ["true", "false"] };
    }
    return {
      ok: true,
      patch: { [modeRaw]: Boolean(enabled) },
      autoEnabled
    };
  }

  const bodyTrackers = isNonArrayObject(bodyRoot.trackers)
    ? bodyRoot.trackers
    : bodyRoot;
  const patch = {};

  for (const key of META_AUTO_TEMPO_TRACKER_KEYS) {
    const fromBody = parseBoolean(bodyTrackers[key], null);
    if (fromBody !== null) {
      patch[key] = Boolean(fromBody);
      continue;
    }
    const fromQuery = parseBoolean(req.query[key], null);
    if (fromQuery !== null) {
      patch[key] = Boolean(fromQuery);
    }
  }

  if (!Object.keys(patch).length) {
    if (autoEnabled === null) {
      return {
        ok: false,
        error: "missing tracker patch",
        detail: "Provide one or more tracker booleans, mode+enabled, or auto toggle.",
        allowedModes: META_AUTO_TEMPO_TRACKER_KEYS
      };
    }
  }

  return { ok: true, patch, autoEnabled };
}

app.get("/rave/meta/auto/hz-trackers", (_, res) => {
  const trackers = getMetaAutoTempoTrackersRuntimeSnapshot();
  res.json({
    ok: true,
    trackers,
    autoEnabled: audioReactivityMapRuntime.metaAutoTempoTrackersAuto === true,
    active: META_AUTO_TEMPO_TRACKER_KEYS.filter(key => trackers[key] === true),
    summary: summarizeMetaAutoTempoTrackers(trackers),
    scope: "meta-auto-only",
    brands: ["hue", "wiz"]
  });
});

app.post("/rave/meta/auto/hz-trackers", (req, res) => {
  const parsed = parseMetaAutoTempoTrackerPatchFromRequest(req);
  if (!parsed.ok) {
    res.status(400).json({
      ok: false,
      error: parsed.error,
      detail: parsed.detail,
      allowed: parsed.allowed || ["true", "false"],
      allowedModes: parsed.allowedModes || META_AUTO_TEMPO_TRACKER_KEYS
    });
    return;
  }

  const current = getMetaAutoTempoTrackersRuntimeSnapshot();
  const mergedTrackers = sanitizeMetaAutoTempoTrackersConfig(
    { ...current, ...parsed.patch },
    AUDIO_REACTIVITY_MAP_DEFAULT.metaAutoTempoTrackers
  );
  const nextAutoEnabled = parsed.autoEnabled === null
    ? audioReactivityMapRuntime.metaAutoTempoTrackersAuto === true
    : Boolean(parsed.autoEnabled);
  const next = patchAudioReactivityMapConfig({
    metaAutoTempoTrackersAuto: nextAutoEnabled,
    metaAutoTempoTrackers: mergedTrackers,
    metaAutoHueWizBaselineBlend: mergedTrackers.baseline === true
  });
  const safeTrackers = sanitizeMetaAutoTempoTrackersConfig(
    next.metaAutoTempoTrackers,
    AUDIO_REACTIVITY_MAP_DEFAULT.metaAutoTempoTrackers
  );
  console.log(`[RAVE] meta auto hz trackers ${summarizeMetaAutoTempoTrackers(safeTrackers)}`);
  res.json({
    ok: true,
    trackers: safeTrackers,
    autoEnabled: next.metaAutoTempoTrackersAuto === true,
    active: META_AUTO_TEMPO_TRACKER_KEYS.filter(key => safeTrackers[key] === true),
    summary: summarizeMetaAutoTempoTrackers(safeTrackers),
    scope: "meta-auto-only",
    brands: ["hue", "wiz"]
  });
});

app.get("/rave/meta/auto/hz-trackers/auto", (_, res) => {
  res.json({
    ok: true,
    enabled: audioReactivityMapRuntime.metaAutoTempoTrackersAuto === true,
    scope: "meta-auto-only",
    brands: ["hue", "wiz"]
  });
});

app.post("/rave/meta/auto/hz-trackers/auto", (req, res) => {
  const enabled = parseEnabledFlagForRoute(req, res);
  if (enabled === null) return;

  let nextEnabled = Boolean(enabled);
  let safeTrackers = getMetaAutoTempoTrackersRuntimeSnapshot();
  let seededCandidates = false;
  if (nextEnabled) {
    const seeded = applyMetaAutoTempoTrackerCandidates({
      force: false,
      autoEnabled: true
    });
    nextEnabled = seeded.autoEnabled === true;
    safeTrackers = sanitizeMetaAutoTempoTrackersConfig(
      seeded.trackers,
      AUDIO_REACTIVITY_MAP_DEFAULT.metaAutoTempoTrackers
    );
    seededCandidates = seeded.changed === true && seeded.reason === "generated";
  } else {
    const next = patchAudioReactivityMapConfig({
      metaAutoTempoTrackersAuto: false
    });
    nextEnabled = next.metaAutoTempoTrackersAuto === true;
    safeTrackers = sanitizeMetaAutoTempoTrackersConfig(
      next.metaAutoTempoTrackers,
      AUDIO_REACTIVITY_MAP_DEFAULT.metaAutoTempoTrackers
    );
  }
  console.log(
    `[RAVE] meta auto hz tracker auto ${nextEnabled ? "ON" : "OFF"} ` +
    `(trackers=${summarizeMetaAutoTempoTrackers(safeTrackers)}${seededCandidates ? ", seeded" : ""})`
  );
  res.json({
    ok: true,
    enabled: nextEnabled === true,
    trackers: safeTrackers,
    seededCandidates,
    scope: "meta-auto-only",
    brands: ["hue", "wiz"]
  });
});

app.post("/rave/meta/auto/hz-trackers/candidates", (req, res) => {
  const forceRaw = req.query.force ?? req.body?.force;
  const autoRaw = req.query.autoEnabled ?? req.query.auto ?? req.body?.autoEnabled ?? req.body?.auto;
  const force = forceRaw === undefined ? true : Boolean(parseBoolean(forceRaw, true));
  const autoEnabledParsed = parseBoolean(autoRaw, null);
  const autoEnabled = autoEnabledParsed === null
    ? (audioReactivityMapRuntime.metaAutoTempoTrackersAuto === true)
    : Boolean(autoEnabledParsed);
  const next = applyMetaAutoTempoTrackerCandidates({
    force,
    autoEnabled
  });
  const safeTrackers = sanitizeMetaAutoTempoTrackersConfig(
    next.trackers,
    AUDIO_REACTIVITY_MAP_DEFAULT.metaAutoTempoTrackers
  );
  console.log(
    `[RAVE] meta auto hz tracker candidates ${next.changed ? "APPLIED" : "UNCHANGED"} ` +
    `(trackers=${summarizeMetaAutoTempoTrackers(safeTrackers)}, auto=${next.autoEnabled ? "ON" : "OFF"})`
  );
  res.json({
    ok: true,
    changed: next.changed === true,
    reason: String(next.reason || (next.changed ? "generated" : "unchanged")),
    trackers: safeTrackers,
    autoEnabled: next.autoEnabled === true,
    active: META_AUTO_TEMPO_TRACKER_KEYS.filter(key => safeTrackers[key] === true),
    summary: summarizeMetaAutoTempoTrackers(safeTrackers),
    scope: "meta-auto-only",
    brands: ["hue", "wiz"]
  });
});

app.get("/rave/meta/auto/hue-wiz-baseline-blend", (_, res) => {
  const trackers = getMetaAutoTempoTrackersRuntimeSnapshot();
  res.json({
    ok: true,
    enabled: trackers.baseline === true,
    trackers,
    autoEnabled: audioReactivityMapRuntime.metaAutoTempoTrackersAuto === true,
    scope: "meta-auto-only",
    brands: ["hue", "wiz"]
  });
});

app.post("/rave/meta/auto/hue-wiz-baseline-blend", (req, res) => {
  const enabled = parseEnabledFlagForRoute(req, res, { requireInput: true });
  if (enabled === null) return;

  const trackers = getMetaAutoTempoTrackersRuntimeSnapshot();
  const mergedTrackers = sanitizeMetaAutoTempoTrackersConfig(
    { ...trackers, baseline: Boolean(enabled) },
    AUDIO_REACTIVITY_MAP_DEFAULT.metaAutoTempoTrackers
  );
  const next = patchAudioReactivityMapConfig({
    metaAutoTempoTrackers: mergedTrackers,
    metaAutoHueWizBaselineBlend: mergedTrackers.baseline === true
  });
  console.log(
    `[RAVE] meta auto hue/wiz baseline blend ${next.metaAutoHueWizBaselineBlend ? "ON" : "OFF"}`
  );
  res.json({
    ok: true,
    enabled: next.metaAutoHueWizBaselineBlend === true,
    trackers: sanitizeMetaAutoTempoTrackersConfig(
      next.metaAutoTempoTrackers,
      AUDIO_REACTIVITY_MAP_DEFAULT.metaAutoTempoTrackers
    ),
    autoEnabled: next.metaAutoTempoTrackersAuto === true,
    scope: "meta-auto-only",
    brands: ["hue", "wiz"]
  });
});

function setOverclockAutoRoute(req, res, enabledFallback = null) {
  const enabled = parseEnabledFlagForRoute(req, res, {
    fallback: enabledFallback,
    requireInput: true
  });
  if (enabled === null) return;

  const next = engine.setOverclockAutoEnabled?.(enabled);
  const telemetry = engine.getTelemetry?.() || {};
  const hz = Number(telemetry.overclockAutoHz || telemetry.metaAutoHz || 2);
  const overclockLevel = Number(telemetry.overclockLevel || 0);
  console.log(`[RAVE] overclock auto ${next ? "ON" : "OFF"}`);
  res.json({
    ok: true,
    enabled: Boolean(next),
    hz,
    overclockLevel
  });
}

app.post("/rave/overclock/auto", (req, res) => setOverclockAutoRoute(req, res));
app.post("/rave/overclock/auto/on", (req, res) => setOverclockAutoRoute(req, res, true));
app.post("/rave/overclock/auto/off", (req, res) => setOverclockAutoRoute(req, res, false));

const META_AUTO_TOGGLE_ROUTES = Object.freeze([
  { path: "/rave/meta/auto/on", enabled: true, log: "[RAVE] meta auto ON" },
  { path: "/rave/meta/auto/off", enabled: false, log: "[RAVE] meta auto OFF" }
]);
for (const route of META_AUTO_TOGGLE_ROUTES) {
  app.post(route.path, (_, res) => {
    const next = engine.setMetaAutoEnabled?.(route.enabled);
    console.log(route.log);
    res.json({ ok: true, enabled: Boolean(next) });
  });
}

app.get("/rave/telemetry", (_, res) => {
  const telemetry = engine.getTelemetry();
  fireModHook("onTelemetry", { telemetry });
  res.json(telemetry);
});

app.get("/mods", modsReadRateLimit, (_, res) => {
  res.json(modLoader.list());
});

app.get("/mods/config", modsReadRateLimit, (_, res) => {
  const snapshot = modLoader.list?.() || {};
  res.json({
    ok: true,
    configPath: snapshot.configPath || "",
    config: snapshot.config || { enabled: [], order: [], disabled: [] }
  });
});

app.get("/mods/runtime", modsReadRateLimit, (_, res) => {
  res.json({
    ok: true,
    runtime: getModsRuntimeSnapshot(),
    mods: modLoader.list?.() || {}
  });
});

app.get("/mods/debug", modsReadRateLimit, (req, res) => {
  const limit = Math.max(0, Math.min(5000, Number(req.query.limit) || 300));
  const sinceSeq = Math.max(0, Number(req.query.sinceSeq) || 0);
  const includeHookStats = parseBoolean(req.query.includeHookStats, true) !== false;
  const includeEvents = parseBoolean(req.query.includeEvents, true) !== false;
  const snapshot = modLoader.getDebugDiagnostics?.({
    limit,
    sinceSeq,
    includeHookStats,
    includeEvents
  }) || {
    enabled: false,
    maxEvents: 0,
    maxPayloadChars: 0,
    maxDepth: 0,
    sequence: 0,
    counters: {},
    hookStats: {},
    events: []
  };

  res.json({
    ok: true,
    debug: snapshot
  });
});

function ensureModWriteRouteAllowed(req, res, routeLabel = "") {
  if (isLoopbackRequest(req)) return true;
  if (!ALLOW_REMOTE_WRITE_RUNTIME) {
    res.status(403).json({
      ok: false,
      error: "forbidden",
      detail: "mod write routes are restricted to local loopback requests"
    });
    return false;
  }
  if (ALLOW_REMOTE_MOD_WRITE_RUNTIME) return true;
  res.status(403).json({
    ok: false,
    error: "forbidden",
    detail:
      "remote mod write routes require RAVELINK_ALLOW_REMOTE_MOD_WRITE=1 when RAVELINK_ALLOW_REMOTE_WRITE=1",
    route: String(routeLabel || req.path || "").trim() || undefined
  });
  return false;
}

app.post("/mods/debug", modsConfigRateLimit, (req, res) => {
  if (!ensureModWriteRouteAllowed(req, res, "/mods/debug")) return;
  const patch = req.body && typeof req.body === "object" ? req.body : {};
  const snapshot = modLoader.setDebugConfig?.(patch);
  if (!snapshot) {
    res.status(503).json({ ok: false, error: "mods debug config unavailable" });
    return;
  }
  res.json({
    ok: true,
    debug: snapshot
  });
});

app.post("/mods/debug/clear", modsConfigRateLimit, (req, res) => {
  if (!ensureModWriteRouteAllowed(req, res, "/mods/debug/clear")) return;
  const snapshot = modLoader.clearDebugEvents?.();
  if (!snapshot) {
    res.status(503).json({ ok: false, error: "mods debug clear unavailable" });
    return;
  }
  res.json({
    ok: true,
    debug: snapshot
  });
});

app.get("/mods/hooks", modsReadRateLimit, (_, res) => {
  const snapshot = modLoader.list?.() || {};
  const mods = Array.isArray(snapshot.mods) ? snapshot.mods : [];
  res.json({
    ok: true,
    supported: modLoader.getSupportedHooks?.() || [],
    loadedMods: mods
      .filter(mod => mod && mod.loaded)
      .map(mod => ({
        id: mod.id,
        hooks: Array.isArray(mod.hooks) ? mod.hooks : []
      }))
  });
});

app.post("/mods/hooks/:hook", modsHookInvokeRateLimit, async (req, res) => {
  if (!ensureModWriteRouteAllowed(req, res, "/mods/hooks/:hook")) return;
  const hook = String(req.params.hook || "").trim();
  if (!hook) {
    res.status(400).json({ ok: false, error: "missing hook name" });
    return;
  }

  const payload = req.body && typeof req.body === "object"
    ? (req.body.payload !== undefined ? req.body.payload : req.body)
    : {};

  try {
    const result = await modLoader.invokeHook(hook, payload);
    res.status(result?.ok === false ? 400 : 200).json(result);
  } catch (err) {
    res.status(500).json({
      ok: false,
      hook,
      error: err.message || String(err)
    });
  }
});

app.get("/mods/ui/catalog", modsUiCatalogRateLimit, (_, res) => {
  const entries = modLoader.listModUis?.({ loadedOnly: false }) || [];
  const mods = entries.map(item => ({
    id: item.id,
    name: item.name,
    version: item.version,
    enabled: Boolean(item.enabled),
    loaded: Boolean(item.loaded),
    title: item.title,
    entry: item.entry,
    url: item.loaded ? `/mods-ui/${encodeURIComponent(item.id)}/` : ""
  }));

  res.json({
    ok: true,
    total: mods.length,
    loaded: mods.filter(mod => mod.loaded).length,
    mods
  });
});

function resolveModUiAssetPath(modId, requestPath = "", options = {}) {
  const descriptor = modLoader.getModUi?.(modId);
  if (!descriptor) {
    return { ok: false, status: 404, error: "mod ui not found" };
  }

  if (options.requireLoaded !== false && !descriptor.loaded) {
    return { ok: false, status: 409, error: "mod ui unavailable while mod is not loaded" };
  }

  const root = path.resolve(String(descriptor.assetRoot || ""));
  const entryPath = path.resolve(String(descriptor.entryPath || ""));
  if (!root || !entryPath) {
    return { ok: false, status: 404, error: "mod ui entry missing" };
  }

  const raw = String(requestPath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  let targetPath = entryPath;
  if (raw) {
    const normalized = path.posix.normalize(raw);
    if (!normalized || normalized === "." || normalized === "..") {
      return { ok: false, status: 400, error: "invalid ui asset path" };
    }
    if (normalized.startsWith("../") || normalized.includes("/../")) {
      return { ok: false, status: 400, error: "invalid ui asset path" };
    }
    targetPath = path.resolve(root, normalized);
  }

  if (targetPath !== root && !targetPath.startsWith(root + path.sep)) {
    return { ok: false, status: 403, error: "asset path escape blocked" };
  }

  let stat = null;
  try {
    stat = fs.statSync(targetPath);
  } catch {
    return { ok: false, status: 404, error: "ui asset not found" };
  }

  if (stat.isDirectory()) {
    const indexPath = path.resolve(targetPath, "index.html");
    if (!indexPath.startsWith(root + path.sep)) {
      return { ok: false, status: 403, error: "asset path escape blocked" };
    }
    try {
      const indexStat = fs.statSync(indexPath);
      if (!indexStat.isFile()) {
        return { ok: false, status: 404, error: "ui index not found" };
      }
      targetPath = indexPath;
    } catch {
      return { ok: false, status: 404, error: "ui index not found" };
    }
  } else if (!stat.isFile()) {
    return { ok: false, status: 404, error: "ui asset not found" };
  }

  return {
    ok: true,
    descriptor,
    path: targetPath
  };
}

function sendResolvedModUiAsset(req, res, requestPath = "") {
  const resolved = resolveModUiAssetPath(req.params.modId, requestPath, { requireLoaded: true });
  if (!resolved.ok) {
    res.status(Number(resolved.status) || 404).json({
      ok: false,
      error: resolved.error
    });
    return;
  }

  res.set("Cache-Control", "no-store");
  res.sendFile(resolved.path, err => {
    if (!err) return;
    if (res.headersSent) return;
    res.status(500).json({
      ok: false,
      error: err.message || String(err)
    });
  });
}

app.get("/mods-ui/:modId", modUiAssetRateLimit, (req, res) => {
  sendResolvedModUiAsset(req, res, "");
});

app.get("/mods-ui/:modId/", modUiAssetRateLimit, (req, res) => {
  sendResolvedModUiAsset(req, res, "");
});

app.get("/mods-ui/:modId/*assetPath", modUiAssetRateLimit, (req, res) => {
  const rawTail = req.params?.assetPath;
  const tail = Array.isArray(rawTail) ? rawTail.join("/") : String(rawTail || "");
  sendResolvedModUiAsset(req, res, tail);
});

function sanitizeImportedRelativePath(rawPath) {
  const raw = String(rawPath || "").replace(/\\/g, "/").trim();
  if (!raw) return "";
  if (raw.includes("\0")) return "";
  // Block Windows ADS and drive-letter style paths early.
  if (raw.includes(":")) return "";
  if (raw.length > 240) return "";
  const normalized = path.posix.normalize(raw).replace(/^\/+/, "");
  if (!normalized || normalized === "." || normalized === "..") return "";
  if (path.posix.isAbsolute(normalized)) return "";
  if (normalized.startsWith("../") || normalized.includes("/../")) return "";
  if (/^[a-zA-Z]:/.test(normalized)) return "";
  const parts = normalized.split("/");
  if (parts.some(part => !part || part.length > 100)) return "";
  return normalized;
}

function decodeImportedContentBase64(raw) {
  const input = String(raw || "").trim().replace(/\s+/g, "");
  if (!input) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input)) return null;
  if (input.length % 4 !== 0) return null;
  try {
    const decoded = Buffer.from(input, "base64");
    if (!decoded || !decoded.length) return null;
    const canonicalInput = input.replace(/=+$/, "");
    const canonicalDecoded = decoded.toString("base64").replace(/=+$/, "");
    if (canonicalInput !== canonicalDecoded) return null;
    return decoded;
  } catch {
    return null;
  }
}

function normalizeModImportRecords(rawFiles = []) {
  const errors = [];
  const records = [];
  let totalBytes = 0;

  for (const file of (Array.isArray(rawFiles) ? rawFiles : [])) {
    const normalizedPath = sanitizeImportedRelativePath(
      file?.path ?? file?.relativePath ?? file?.name ?? ""
    );
    if (!normalizedPath) {
      errors.push("invalid file path in import payload");
      continue;
    }

    const content = decodeImportedContentBase64(file?.contentBase64);
    if (!content) {
      errors.push(`invalid base64 content for ${normalizedPath}`);
      continue;
    }

    totalBytes += content.length;
    records.push({
      path: normalizedPath,
      content
    });
  }

  if (records.length > 0) {
    const modJsonCandidates = records
      .filter(record => String(record.path || "").toLowerCase().endsWith("/mod.json") || String(record.path || "").toLowerCase() === "mod.json")
      .sort((a, b) => a.path.length - b.path.length);
    const primaryModJson = modJsonCandidates[0] || null;
    if (!primaryModJson) {
      errors.push("mod.json not found in import payload");
      return { ok: false, errors, records: [], totalBytes: 0, manifest: null, rootPrefix: "" };
    }

    const rootPrefixRaw = path.posix.dirname(primaryModJson.path);
    const rootPrefix = rootPrefixRaw === "." ? "" : rootPrefixRaw;
    const dedupedByPath = new Map();

    for (const record of records) {
      let relative = record.path;
      if (rootPrefix && relative.startsWith(`${rootPrefix}/`)) {
        relative = relative.slice(rootPrefix.length + 1);
      }
      relative = sanitizeImportedRelativePath(relative);
      if (!relative) continue;
      dedupedByPath.set(relative, {
        path: relative,
        content: record.content
      });
    }

    const finalRecords = Array.from(dedupedByPath.values());
    const manifestRecord = finalRecords.find(record => record.path.toLowerCase() === "mod.json");
    if (!manifestRecord) {
      errors.push("mod.json missing at import root");
      return { ok: false, errors, records: [], totalBytes: 0, manifest: null, rootPrefix };
    }

    let manifest = null;
    try {
      manifest = JSON.parse(String(manifestRecord.content.toString("utf8")));
    } catch {
      errors.push("invalid mod.json (JSON parse failed)");
      return { ok: false, errors, records: [], totalBytes: 0, manifest: null, rootPrefix };
    }

    return {
      ok: errors.length === 0,
      errors,
      records: finalRecords,
      totalBytes,
      manifest,
      rootPrefix
    };
  }

  return {
    ok: false,
    errors: errors.length ? errors : ["no files provided"],
    records: [],
    totalBytes: 0,
    manifest: null,
    rootPrefix: ""
  };
}

function resolveImportModId(rawRequestedId, normalizedImport) {
  const requested = String(rawRequestedId || "").trim();
  const manifestId = String(normalizedImport?.manifest?.id || "").trim();
  const rootName = path.posix.basename(String(normalizedImport?.rootPrefix || "").trim());
  const candidate = requested || manifestId || rootName || "";
  if (!MOD_IMPORT_ID_RE.test(candidate)) return "";
  return candidate;
}

function writeImportedModFiles(targetDir, records = []) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const record of records) {
    const rel = sanitizeImportedRelativePath(record?.path || "");
    if (!rel) continue;
    const abs = path.resolve(targetDir, rel);
    if (!abs.startsWith(path.resolve(targetDir) + path.sep)) {
      throw new Error(`path escape blocked for ${rel}`);
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, record.content);
  }
}

app.post("/mods/import", modsImportRateLimitStrict, modsImportRateLimit, async (req, res) => {
  if (!ensureModWriteRouteAllowed(req, res, "/mods/import")) return;
  const payload = req.body && typeof req.body === "object" ? req.body : {};
  const rawFiles = Array.isArray(payload.files) ? payload.files : [];
  const overwrite = payload.overwrite === true;
  const enableAfterImport = payload.enableAfterImport === true;
  const reloadAfterImport = payload.reload !== false;

  if (!rawFiles.length) {
    res.status(400).json({ ok: false, error: "missing files[] payload" });
    return;
  }
  if (rawFiles.length > 2000) {
    res.status(400).json({ ok: false, error: "too many files (max 2000)" });
    return;
  }

  const normalized = normalizeModImportRecords(rawFiles);
  if (!normalized.ok) {
    res.status(400).json({
      ok: false,
      error: "invalid import payload",
      details: normalized.errors
    });
    return;
  }
  if (normalized.totalBytes > 20 * 1024 * 1024) {
    res.status(400).json({ ok: false, error: "import payload too large (max 20MB)" });
    return;
  }

  const modId = resolveImportModId(payload.modId, normalized);
  if (!modId) {
    res.status(400).json({
      ok: false,
      error: "invalid mod id",
      expected: "Use modId matching ^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$ or provide valid manifest id."
    });
    return;
  }

  const snapshot = modLoader.list?.() || {};
  const modsDir = path.resolve(String(snapshot.modsDir || path.join(__dirname, "mods")));
  const destinationDir = path.resolve(modsDir, modId);

  if (destinationDir !== modsDir && !destinationDir.startsWith(modsDir + path.sep)) {
    res.status(400).json({ ok: false, error: "invalid import destination" });
    return;
  }

  if (fs.existsSync(destinationDir) && !overwrite) {
    res.status(409).json({
      ok: false,
      error: "mod already exists",
      modId,
      hint: "Set overwrite=true to replace existing mod files."
    });
    return;
  }

  const stamp = Date.now();
  const nonce = Math.random().toString(36).slice(2, 8);
  const tmpRoot = path.join(__dirname, ".runtime", `mod-import-${stamp}-${nonce}`);
  const tmpModDir = path.join(tmpRoot, modId);

  try {
    writeImportedModFiles(tmpModDir, normalized.records);
    const tmpManifestPath = path.join(tmpModDir, "mod.json");
    if (!fs.existsSync(tmpManifestPath)) {
      throw new Error("mod.json missing after import write");
    }

    fs.mkdirSync(modsDir, { recursive: true });
    if (overwrite && fs.existsSync(destinationDir)) {
      fs.rmSync(destinationDir, { recursive: true, force: true });
    }
    fs.renameSync(tmpModDir, destinationDir);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (err) {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
    res.status(500).json({
      ok: false,
      error: err.message || String(err),
      modId
    });
    return;
  }

  if (enableAfterImport) {
    const current = modLoader.list?.() || {};
    const configPath = String(current.configPath || "").trim();
    const currentConfig = current?.config && typeof current.config === "object"
      ? current.config
      : { enabled: [], order: [], disabled: [] };
    if (configPath) {
      const enabled = normalizeModIdList(currentConfig.enabled);
      const disabled = normalizeModIdList(currentConfig.disabled).filter(id => id !== modId);
      const order = normalizeModIdList(currentConfig.order);
      if (!enabled.includes(modId)) enabled.push(modId);
      if (!order.includes(modId)) order.push(modId);
      const nextConfig = { enabled, disabled, order };
      try {
        fs.writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
      } catch (err) {
        res.status(500).json({
          ok: false,
          error: `imported but failed to update mods config: ${err.message || err}`,
          modId
        });
        return;
      }
    }
  }

  let nextSnapshot = modLoader.list?.() || {};
  if (reloadAfterImport || enableAfterImport) {
    try {
      nextSnapshot = await modLoader.reload();
      fireModHook("onBoot", {
        reason: "mods_import",
        runtime: getModsRuntimeSnapshot()
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: `imported but reload failed: ${err.message || err}`,
        modId
      });
      return;
    }
  }

  res.json({
    ok: true,
    modId,
    importedFiles: normalized.records.length,
    importedBytes: normalized.totalBytes,
    overwrite,
    enableAfterImport,
    reloaded: reloadAfterImport || enableAfterImport,
    snapshot: nextSnapshot
  });
});

function normalizeModIdList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const id = String(item || "").trim();
    if (!id || !MOD_IMPORT_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

app.post("/mods/config", modsConfigRateLimitStrict, modsConfigRateLimit, async (req, res) => {
  if (!ensureModWriteRouteAllowed(req, res, "/mods/config")) return;
  const current = modLoader.list();
  const currentConfig = current?.config && typeof current.config === "object"
    ? current.config
    : { enabled: [], order: [], disabled: [] };
  const configPath = String(current?.configPath || "").trim();
  const patch = req.body && typeof req.body === "object" ? req.body : {};
  if (!configPath) {
    res.status(500).json({
      ok: false,
      error: "mods config path unavailable"
    });
    return;
  }

  const nextConfig = {
    enabled: patch.enabled !== undefined
      ? normalizeModIdList(patch.enabled)
      : normalizeModIdList(currentConfig.enabled),
    order: patch.order !== undefined
      ? normalizeModIdList(patch.order)
      : normalizeModIdList(currentConfig.order),
    disabled: patch.disabled !== undefined
      ? normalizeModIdList(patch.disabled)
      : normalizeModIdList(currentConfig.disabled)
  };

  try {
    fs.writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message || String(err)
    });
    return;
  }

  const shouldReload = patch.reload !== false;
  if (!shouldReload) {
    res.json({
      ok: true,
      configPath,
      config: nextConfig
    });
    return;
  }

  try {
    const snapshot = await modLoader.reload();
    fireModHook("onBoot", {
      reason: "mods_reload",
      runtime: getModsRuntimeSnapshot()
    });
    res.json({
      ok: true,
      configPath,
      config: nextConfig,
      snapshot
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message || String(err)
    });
  }
});

app.post("/mods/reload", modsReloadRateLimit, async (req, res) => {
  if (!ensureModWriteRouteAllowed(req, res, "/mods/reload")) return;
  try {
    const snapshot = await modLoader.reload();
    fireModHook("onBoot", {
      reason: "mods_reload",
      runtime: getModsRuntimeSnapshot()
    });
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message || String(err)
    });
  }
});

async function handleModHttpRoute(req, res) {
  if (!ensureModWriteRouteAllowed(req, res, "mods_http")) return;
  try {
    const result = await modLoader.handleHttp({
      modId: req.params.modId,
      action: req.params.action || "",
      method: req.method,
      path: req.path,
      query: req.query || {},
      body: req.body && typeof req.body === "object" ? req.body : {},
      headers: req.headers || {}
    });

    if (!result?.handled) {
      res.status(Number(result?.status) || 404).json(
        result?.body || { ok: false, error: "mod endpoint not found" }
      );
      return;
    }

    const status = Number(result.status) || 200;
    if (result.body !== undefined) {
      if (typeof result.body === "object") {
        res.status(status).json(result.body);
      } else {
        res.status(status).send(result.body);
      }
      return;
    }

    res.sendStatus(status);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message || String(err)
    });
  }
}

app.all("/mods/:modId", modsHttpRouteRateLimit, handleModHttpRoute);
app.all("/mods/:modId/:action", modsHttpRouteRateLimit, handleModHttpRoute);

app.get("/automation/config", (_, res) => {
  res.json({
    ok: true,
    config: automationRules.getConfig(),
    meta: automationRules.getMeta()
  });
});

app.post("/automation/config", (req, res) => {
  try {
    const patch = req.body && typeof req.body === "object" ? req.body : {};
    const result = automationRules.setConfig(patch);
    res.json(result);
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || String(err)
    });
  }
});

app.post("/automation/reload", (_, res) => {
  const ok = automationRules.reload();
  res.status(ok ? 200 : 500).json({
    ok,
    config: automationRules.getConfig(),
    meta: automationRules.getMeta()
  });
});

app.post("/automation/apply", async (req, res) => {
  const requested = String(req.query.event || req.body?.event || "start").toLowerCase().trim();
  if (requested !== "start" && requested !== "stop") {
    res.status(400).json({
      ok: false,
      error: "invalid event",
      allowed: ["start", "stop"]
    });
    return;
  }

  const seq = nextAutomationEventSeq();
  const result = await runAutomationEvent(requested, seq);
  res.json({
    ok: Boolean(result?.ok),
    result
  });
});

app.get("/hue/discover", hueDiscoverRateLimit, async (_, res) => {
  try {
    const HueSync = getHueSyncCtor();
    const discovered = await HueSync.discover();
    const bridges = (Array.isArray(discovered) ? discovered : [])
      .map(normalizeBridgeDiscovery)
      .filter(b => b.ip);

    res.json({
      ok: true,
      bridges
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: stringifyHueError(err)
    });
  }
});

app.post("/hue/pair", huePairRateLimit, async (req, res) => {
  const payload = req.body && typeof req.body === "object" ? req.body : {};
  const appName = String(payload.appName || HUE_PAIR_APP_NAME).trim() || HUE_PAIR_APP_NAME;
  const timeoutMs = Math.min(120000, Math.max(5000, Number(payload.timeoutMs || 30000)));
  const pollMs = Math.min(3000, Math.max(500, Number(payload.pollMs || 1200)));
  const saveFixture = payload.saveFixture !== false;
  const fixtureHintPayload = payload.fixture && typeof payload.fixture === "object"
    ? payload.fixture
    : {};
  const requestedEntertainmentAreaId = String(
    payload.entertainmentAreaId ??
    fixtureHintPayload.entertainmentAreaId ??
    ""
  ).trim();

  try {
    const HueSync = getHueSyncCtor();

    const rawBridgeIpInput = String(payload.bridgeIp || "").trim();
    const requestedBridgeIp = normalizeHueBridgeIp(rawBridgeIpInput);
    const rawBridgeIdInput = String(payload.bridgeId || "").trim();
    const requestedBridgeId = normalizeHueBridgeIdToken(rawBridgeIdInput).toUpperCase();
    if (rawBridgeIpInput && !requestedBridgeIp) {
      res.status(400).json({
        ok: false,
        paired: false,
        error: "invalid_bridge_ip",
        message: "bridgeIp must be a private/local IPv4 address"
      });
      return;
    }

    const discovered = await HueSync.discover();
    const bridges = (Array.isArray(discovered) ? discovered : [])
      .map(normalizeBridgeDiscovery)
      .filter(b => b.ip);

    let discoveredBridge = null;
    if (requestedBridgeIp) {
      discoveredBridge = bridges.find(b => b.ip === requestedBridgeIp) || null;
      if (!discoveredBridge) {
        res.status(400).json({
          ok: false,
          paired: false,
          error: "bridge_not_discovered",
          message: "bridgeIp must match a Hue bridge discovered on the local network"
        });
        return;
      }
    } else if (requestedBridgeId) {
      discoveredBridge = bridges.find(b => b.id === requestedBridgeId) || null;
      if (!discoveredBridge) {
        res.status(400).json({
          ok: false,
          paired: false,
          error: "bridge_not_discovered",
          message: "bridgeId must match a Hue bridge discovered on the local network"
        });
        return;
      }
    } else {
      discoveredBridge = bridges[0] || null;
    }

    if (!discoveredBridge) {
      res.status(404).json({
        ok: false,
        paired: false,
        error: "no_bridge_found",
        message: "No Hue bridge discovered on local network"
      });
      return;
    }
    let bridgeIp = discoveredBridge.ip;
    let bridgeId = requestedBridgeId || String(discoveredBridge.id || "").trim().toUpperCase();
    bridgeIp = normalizeHueBridgeIp(bridgeIp);
    if (!bridgeIp) {
      res.status(400).json({
        ok: false,
        paired: false,
        error: "invalid_bridge_ip",
        message: "bridgeIp must be a private/local IPv4 address"
      });
      return;
    }

    const bridgeConfig = await fetchHueBridgeConfigByIp(bridgeIp, bridgeId);
    if (!bridgeId) {
      bridgeId = String(bridgeConfig?.bridgeid || "").trim().toUpperCase();
    }
    if (bridgeId) {
      rememberHueBridgeIdentity(bridgeIp, bridgeId);
    }

    const startedAt = Date.now();
    let lastPendingMessage = "Link button not pressed";
    while ((Date.now() - startedAt) < timeoutMs) {
      try {
        const credentials = await HueSync.register(bridgeIp, appName);
        const username = String(credentials?.username || "").trim();
        const clientKey = String(credentials?.clientkey || credentials?.clientKey || "").trim().toUpperCase();

        if (!username || !clientKey) {
          throw new Error("Bridge registration did not return username/clientkey");
        }

        let savedFixture = null;
        let fixtureSaveError = "";
        let entertainmentAreas = [];
        let warning = null;
        let resolvedEntertainmentAreaId = requestedEntertainmentAreaId;

        const appendWarning = text => {
          const next = String(text || "").trim();
          if (!next) return;
          warning = warning ? `${warning} | ${next}` : next;
        };

        if (bridgeId) {
          try {
            const bridge = new HueSync({
              credentials: {
                username,
                clientkey: clientKey
              },
              id: bridgeId,
              url: bridgeIp
            });

            const areas = await bridge.getEntertainmentAreas();
            entertainmentAreas = (Array.isArray(areas) ? areas : []).map(a => ({
              id: String(a?.id || a?.rid || "").trim(),
              name: String(a?.name || a?.metadata?.name || a?.id || a?.rid || "").trim()
            }));

            const normalizeAreaToken = value => String(value || "").trim().toLowerCase();
            const requestedToken = normalizeAreaToken(requestedEntertainmentAreaId);
            const matchedArea = requestedToken
              ? (entertainmentAreas.find(area =>
                normalizeAreaToken(area.id) === requestedToken ||
                normalizeAreaToken(area.name) === requestedToken
              ) || null)
              : null;
            const fallbackArea = entertainmentAreas[0] || null;

            if (matchedArea) {
              resolvedEntertainmentAreaId = String(matchedArea.id || matchedArea.name || "").trim();
            } else if (fallbackArea) {
              resolvedEntertainmentAreaId = String(fallbackArea.id || fallbackArea.name || "").trim();
              if (requestedEntertainmentAreaId) {
                appendWarning("configured entertainment area not found on bridge; using first available area");
              } else {
                appendWarning("no entertainment area provided; using first available area");
              }
            } else {
              resolvedEntertainmentAreaId = requestedEntertainmentAreaId;
              if (requestedEntertainmentAreaId) {
                appendWarning("configured entertainment area not found and bridge returned no selectable areas");
              }
            }
          } catch (err) {
            warning = `paired, but entertainment area fetch failed: ${stringifyHueError(err)}`;
          }
        }

        if (saveFixture) {
          try {
            const fixtureHint = fixtureHintPayload;

            const allFixtures = typeof fixtureRegistry.getFixtures === "function"
              ? fixtureRegistry.getFixtures()
              : [];
            const hueFixtures = allFixtures.filter(
              fixture => String(fixture?.brand || "").trim().toLowerCase() === "hue"
            );

            const requestedId = String(
              payload.fixtureId ?? fixtureHint.id ?? payload.id ?? ""
            ).trim();
            const requestedZoneRaw = String(
              payload.zone ?? fixtureHint.zone ?? ""
            ).trim();
            const requestedZone = normalizeRouteZoneToken(
              requestedZoneRaw,
              getCanonicalZoneFallback("hue", "hue")
            );
            const requestedLightId = Math.max(
              1,
              Number(payload.lightId ?? fixtureHint.lightId ?? 1) || 1
            );

            const engineEnabled = parseBoolean(
              payload.engineEnabled ?? fixtureHint.engineEnabled,
              true
            );
            const twitchEnabled = parseBoolean(
              payload.twitchEnabled ?? fixtureHint.twitchEnabled,
              true
            );
            let customEnabled = parseBoolean(
              payload.customEnabled ?? fixtureHint.customEnabled,
              false
            );
            if (engineEnabled && customEnabled) {
              customEnabled = false;
            }

            let nextFixtureId = requestedId;
            if (!nextFixtureId) {
              const byBridge = hueFixtures.find(fixture => {
                const fixtureBridgeId = String(fixture?.bridgeId || "").trim().toUpperCase();
                const fixtureBridgeIp = String(fixture?.bridgeIp || "").trim();
                return (
                  (bridgeId && fixtureBridgeId && fixtureBridgeId === bridgeId) ||
                  (bridgeIp && fixtureBridgeIp && fixtureBridgeIp === bridgeIp)
                );
              });
              if (byBridge) {
                nextFixtureId = String(byBridge.id || "").trim();
              }
            }
            if (!nextFixtureId) {
              const baseId = bridgeId
                ? `hue-${bridgeId.toLowerCase().slice(-6)}`
                : "hue-main";
              const existingIds = new Set(
                allFixtures.map(fixture => String(fixture?.id || "").trim()).filter(Boolean)
              );
              let suffix = 1;
              let candidate = `${baseId}-${suffix}`;
              while (existingIds.has(candidate)) {
                suffix += 1;
                candidate = `${baseId}-${suffix}`;
              }
              nextFixtureId = candidate;
            }

            const entertainmentAreaId = resolvedEntertainmentAreaId;

            const fixturePayload = {
              id: nextFixtureId,
              brand: "hue",
              zone: requestedZone,
              enabled: parseBoolean(payload.enabled ?? fixtureHint.enabled, true),
              controlMode: engineEnabled ? "engine" : "standalone",
              engineBinding: engineEnabled ? "hue" : "standalone",
              engineEnabled,
              twitchEnabled,
              customEnabled,
              bridgeIp,
              username,
              bridgeId: bridgeId || "",
              clientKey,
              entertainmentAreaId,
              lightId: requestedLightId
            };

            const upsertResult = fixtureRegistry.upsertFixture(fixturePayload);
            if (!upsertResult.ok) {
              fixtureSaveError = String(upsertResult.error || "fixture upsert failed");
            } else {
              savedFixture = upsertResult.fixture || fixturePayload;
              refreshWizAdapters();
              syncStandaloneRuntime();
              queueFixtureConnectivityProbe(savedFixture, { force: true, logChanges: true }).catch(() => {});
              await setHueTransportMode(hueTransport.desired);
            }
          } catch (err) {
            fixtureSaveError = err?.message || String(err);
          }
        }

        res.json({
          ok: true,
          paired: true,
          bridge: {
            ip: bridgeIp,
            id: bridgeId || "",
            name: String(bridgeConfig?.name || "").trim()
          },
          credentials: {
            username,
            clientKey
          },
          fixture: savedFixture,
          fixtureSaved: Boolean(savedFixture),
          fixtureSaveError: fixtureSaveError || "",
          entertainmentAreaId: resolvedEntertainmentAreaId || "",
          entertainmentAreas,
          warning,
          elapsedMs: Date.now() - startedAt
        });
        return;
      } catch (err) {
        if (isHueLinkButtonPending(err)) {
          lastPendingMessage = stringifyHueError(err);
          await sleep(pollMs);
          continue;
        }

        res.status(502).json({
          ok: false,
          paired: false,
          error: "pair_failed",
          message: stringifyHueError(err),
          bridge: {
            ip: bridgeIp,
            id: bridgeId || ""
          }
        });
        return;
      }
    }

    res.status(408).json({
      ok: false,
      paired: false,
      error: "link_button_timeout",
      message: lastPendingMessage || "Press the Hue Bridge link button and retry.",
      bridge: {
        ip: bridgeIp,
        id: bridgeId || ""
      },
      elapsedMs: Date.now() - startedAt
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      paired: false,
      error: "pairing_unavailable",
      message: stringifyHueError(err)
    });
  }
});

app.post("/hue/transport", hueTransportRateLimit, async (req, res) => {
  const mode = String(req.query.mode || "").toLowerCase();
  const next = mode === "entertainment"
    ? HUE_TRANSPORT.ENTERTAINMENT
    : HUE_TRANSPORT.REST;

  const result = await setHueTransportMode(next);
  if (next === HUE_TRANSPORT.ENTERTAINMENT && result.active !== HUE_TRANSPORT.ENTERTAINMENT) {
    scheduleHueEntertainmentRecovery("transport_route");
  }
  res.json({
    ok: result.active === next,
    ...result,
    entertainment: hueEntertainment.getStatus()
  });
});

app.get("/hue/telemetry", (_, res) => {
  const scheduler = {};
  for (const [zone, zoneScheduler] of hueSchedulers.entries()) {
    scheduler[zone] = zoneScheduler.getTelemetry();
  }

  res.json({
    ...hueTelemetry,
    skipped:
      hueTelemetry.skippedScheduler +
      hueTelemetry.skippedInflight +
      hueTelemetry.skippedSyncHold +
      hueTelemetry.skippedNoTargets,
    transportDesired: hueTransport.desired,
    transportActive: hueTransport.active,
    transportFallbackReason: hueTransport.fallbackReason,
    transportSwitches: hueTransport.switches,
    transportErrors: hueTransport.errors,
    entertainment: hueEntertainment.getStatus(),
    scheduler
  });
});

app.get("/wiz/telemetry", (_, res) => {
  const scheduler = {};
  for (const [zone, zoneScheduler] of wizSchedulers.entries()) {
    scheduler[zone] = zoneScheduler.getTelemetry();
  }

  res.json({
    ...wizTelemetry,
    skipped: wizTelemetry.skippedScheduler + wizTelemetry.skippedNoTargets,
    scheduler
  });
});

app.get("/audio/telemetry", (_, res) => {
  res.json(audio?.getTelemetry?.() || { running: false });
});

app.get("/audio/config", (_, res) => {
  if (!audio?.getConfig) {
    res.status(503).json({ ok: false, error: "audio unavailable" });
    return;
  }

  audioRuntimeConfig = audio.getConfig();
  res.json({
    ok: true,
    config: audioRuntimeConfig,
    telemetry: audio.getTelemetry?.() || null
  });
});

app.post("/audio/config", (req, res) => {
  if (!audio?.setConfig) {
    res.status(503).json({ ok: false, error: "audio unavailable" });
    return;
  }

  const patch = req.body && typeof req.body === "object" ? req.body : {};
  const result = audio.setConfig(patch, { restart: true });
  audioRuntimeConfig = result.config || audioRuntimeConfig;
  scheduleAudioRuntimeConfigWrite(audioRuntimeConfig, { delayMs: 180 });
  res.json(result);
});

app.get("/audio/reactivity-map", (_, res) => {
  res.json({
    ok: true,
    config: getAudioReactivityMapSnapshot(),
    engineDropEnabled: Boolean(engine?.getDropDetectionEnabled?.())
  });
});

app.post("/audio/reactivity-map", (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const reset = body.reset === true;
  const patch = reset
    ? {
      dropEnabled: AUDIO_REACTIVITY_MAP_DEFAULT.dropEnabled,
      hardwareRateLimitsEnabled: AUDIO_REACTIVITY_MAP_DEFAULT.hardwareRateLimitsEnabled,
      metaAutoHueWizBaselineBlend: audioReactivityMapRuntime.metaAutoHueWizBaselineBlend === true,
      metaAutoTempoTrackersAuto: audioReactivityMapRuntime.metaAutoTempoTrackersAuto === true,
      metaAutoTempoTrackers: sanitizeMetaAutoTempoTrackersConfig(
        audioReactivityMapRuntime.metaAutoTempoTrackers,
        AUDIO_REACTIVITY_MAP_DEFAULT.metaAutoTempoTrackers
      ),
      targets: {
        hue: { ...AUDIO_REACTIVITY_MAP_DEFAULT.targets.hue },
        wiz: { ...AUDIO_REACTIVITY_MAP_DEFAULT.targets.wiz },
        other: { ...AUDIO_REACTIVITY_MAP_DEFAULT.targets.other }
      }
    }
    : body;

  const config = patchAudioReactivityMapConfig(patch, { preserveMetaControls: true });
  res.json({
    ok: true,
    config,
    engineDropEnabled: Boolean(engine?.getDropDetectionEnabled?.())
  });
});

app.post("/audio/restart", audioRestartRateLimit, (_, res) => {
  if (!audio?.restart) {
    res.status(503).json({ ok: false, error: "audio unavailable" });
    return;
  }

  const result = audio.restart("api");
  res.json(result);
});

app.get("/audio/devices", audioDevicesRateLimit, (_, res) => {
  if (!audio?.listDevices) {
    res.status(503).json({ ok: false, error: "audio unavailable" });
    return;
  }

  try {
    res.json({
      ok: true,
      devices: audio.listDevices()
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message || String(err)
    });
  }
});

app.get("/audio/apps", audioAppsRateLimit, async (req, res) => {
  if (!audio?.listRunningApps) {
    res.status(503).json({ ok: false, error: "audio app scan unavailable" });
    return;
  }

  try {
    const includeAudioHints = parseBooleanLoose(req?.query?.includeAudioHints, false) === true;
    const audioOnly = parseBooleanLoose(req?.query?.audioOnly, false) === true;
    const result = await audio.listRunningApps({
      includeAudioHints,
      audioOnly
    });
    if (!result?.ok) {
      res.status(500).json({
        ok: false,
        error: result?.error || "audio app scan failed",
        apps: []
      });
      return;
    }
    res.json({
      ok: true,
      apps: Array.isArray(result.apps) ? result.apps : [],
      scannedAt: Number(result.scannedAt || Date.now()),
      audioHints: result.audioHints && typeof result.audioHints === "object"
        ? result.audioHints
        : null,
      telemetry: audio.getTelemetry?.() || null
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message || String(err),
      apps: []
    });
  }
});

app.get("/audio/optional-tools/status", audioAppsRateLimit, (_, res) => {
  try {
    res.json({
      ok: true,
      status: resolveOptionalAudioToolsStatus()
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message || String(err)
    });
  }
});

app.post("/audio/ffmpeg/app-isolation/scan", audioAppScanRateLimit, async (_, res) => {
  if (!audio?.scanFfmpegAppIsolation) {
    res.status(503).json({ ok: false, error: "audio app isolation scan unavailable" });
    return;
  }

  try {
    const result = await audio.scanFfmpegAppIsolation({ reason: "api_force", force: true, apply: true });
    audioRuntimeConfig = audio.getConfig?.() || audioRuntimeConfig;
    if (!result?.ok) {
      res.status(500).json({
        ok: false,
        error: result?.error || "audio app isolation scan failed",
        config: audioRuntimeConfig,
        telemetry: audio.getTelemetry?.() || null
      });
      return;
    }

    res.json({
      ok: true,
      ...result,
      config: audioRuntimeConfig,
      telemetry: audio.getTelemetry?.() || null
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message || String(err),
      config: audioRuntimeConfig,
      telemetry: audio.getTelemetry?.() || null
    });
  }
});

registerFixturesRoutes(app, {
  fixturesReadRateLimit,
  fixtureRegistry,
  refreshWizAdapters,
  syncStandaloneRuntime,
  prunePaletteFixtureOverrides,
  pruneFixtureMetricRoutingOverrides,
  pruneConnectivityCache,
  queueFixtureConnectivityProbe,
  getConnectivitySnapshotForFixtures,
  summarizeConnectivityResults,
  buildStandaloneSnapshotList,
  buildFixtureModeInteroperabilityReport,
  setHueTransportMode,
  getHueTransportDesired: () => hueTransport.desired,
  fixtureConnectivityCache,
  fixtureConnectivityInFlight
});

registerFixturesConnectivityRoutes(app, {
  fixturesConnectivityRateLimit,
  fixtureRegistry,
  pruneConnectivityCache,
  queueFixtureConnectivityProbe,
  getConnectivitySnapshotForFixtures,
  summarizeConnectivityResults
});

registerStandaloneRoutes(app, {
  standaloneStateRateLimit,
  buildStandaloneSnapshotList,
  buildStandaloneSnapshotById,
  applyStandaloneStateById
});

function getSystemConfigSnapshot() {
  return {
    version: Number(systemConfigRuntime?.version || 3),
    autoLaunchBrowser: systemConfigRuntime?.autoLaunchBrowser !== false,
    browserLaunchDelayMs: clampSystemBrowserLaunchDelayMs(systemConfigRuntime?.browserLaunchDelayMs),
    unsafeExposeSensitiveLogs: systemConfigRuntime?.unsafeExposeSensitiveLogs === true,
    hueTransportPreference: sanitizeHueTransportPreference(
      systemConfigRuntime?.hueTransportPreference,
      SYSTEM_CONFIG_DEFAULT.hueTransportPreference
    )
  };
}

function patchSystemConfig(patch = {}) {
  const rawPatch = getRequestMap(patch);
  const merged = {
    ...getSystemConfigSnapshot()
  };
  for (const key of ["autoLaunchBrowser", "browserLaunchDelayMs", "hueTransportPreference"]) {
    if (hasOwn(rawPatch, key)) {
      merged[key] = rawPatch[key];
    }
  }
  if (hasOwn(rawPatch, "unsafeExposeSensitiveLogs")) {
    const requested = parseBooleanLoose(rawPatch.unsafeExposeSensitiveLogs, merged.unsafeExposeSensitiveLogs);
    const enablingUnsafe = requested === true && merged.unsafeExposeSensitiveLogs !== true;
    if (enablingUnsafe) {
      const ack = String(rawPatch.unsafeExposeSensitiveLogsAck || "").trim();
      if (ack !== UNSAFE_SENSITIVE_LOG_ACK_PHRASE) {
        return {
          ok: false,
          status: 400,
          error: "unsafe_log_ack_required",
          detail: `Set unsafeExposeSensitiveLogsAck=${UNSAFE_SENSITIVE_LOG_ACK_PHRASE} to enable unsafe sensitive logging.`
        };
      }
    }
    merged.unsafeExposeSensitiveLogs = requested;
  }

  systemConfigRuntime = writeSystemConfig(merged);
  setUnsafeExposeSensitiveLogsRuntime(Boolean(systemConfigRuntime?.unsafeExposeSensitiveLogs));
  return { ok: true, config: getSystemConfigSnapshot() };
}

registerSystemRoutes(app, {
  isLoopbackRequest,
  getRequestMap,
  patchSystemConfig,
  getSystemConfigSnapshot,
  getHueTransport: () => hueTransport,
  getPreferredHueTransportMode,
  setHueTransportMode,
  settleWithTimeout,
  HUE_TRANSPORT,
  HUE_ENT_MODE_SWITCH_TIMEOUT_MS,
  HUE_REST_MODE_SWITCH_TIMEOUT_MS,
  scheduleHueEntertainmentRecovery,
  shutdown
});

let httpServer = null;
let shutdownPromise = null;
let shutdownTimer = null;
let browserLaunchTimer = null;
let parentWatchTimer = null;
const parentWatchEnabled = String(process.env.RAVELINK_WATCH_PARENT || "").trim() === "1";
const parentPidAtBoot = Number(process.ppid || 0);

function isProcessAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = String(err?.code || "").toUpperCase();
    if (code === "EPERM" || code === "EACCES") return true;
    return false;
  }
}

function stopParentWatchdog() {
  if (!parentWatchTimer) return;
  clearInterval(parentWatchTimer);
  parentWatchTimer = null;
}

function startParentWatchdog() {
  if (!parentWatchEnabled) return;
  if (!Number.isFinite(parentPidAtBoot) || parentPidAtBoot <= 1 || parentPidAtBoot === process.pid) return;
  if (parentWatchTimer) return;
  parentWatchTimer = setInterval(() => {
    if (shutdownPromise) return;
    if (isProcessAlive(parentPidAtBoot)) return;
    console.warn(`[SYS] parent process ${parentPidAtBoot} exited; shutting down`);
    shutdown("parent_exit", 0).catch(() => process.exit(1));
  }, 1500);
  parentWatchTimer.unref?.();
}

function getBridgeBaseUrl() {
  return `http://${HOST}:${PORT}`;
}

function normalizeBrowserLaunchUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function isBrowserAutoLaunchEnabled() {
  if (String(process.env.RAVELINK_NO_BROWSER || "").trim() === "1") return false;
  return getSystemConfigSnapshot().autoLaunchBrowser !== false;
}

async function waitForBridgeHttpReady(baseUrl, options = {}) {
  const attempts = Math.max(1, Math.min(30, Number(options.attempts) || 12));
  const intervalMs = Math.max(80, Math.min(1500, Number(options.intervalMs) || 220));
  const target = `${String(baseUrl || "").replace(/\/+$/, "")}/`;

  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await axios.get(target, {
        timeout: 900,
        validateStatus: () => true
      });
      if (response && Number(response.status) >= 200 && Number(response.status) < 500) {
        return true;
      }
    } catch {}

    if (i < attempts - 1) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }

  return false;
}

function openUrlInDefaultBrowser(url) {
  const target = normalizeBrowserLaunchUrl(url);
  if (!target) return false;

  const commandExists = command => {
    const lookup = process.platform === "win32" ? "where" : "which";
    try {
      execFileSync(lookup, [command], {
        stdio: "ignore",
        windowsHide: true
      });
      return true;
    } catch {
      return false;
    }
  };

  const spawnDetached = (command, args = [], options = {}) => {
    try {
      const child = spawn(command, args, {
        detached: true,
        stdio: "ignore",
        ...options
      });
      // Prevent unhandled "error" events when an opener is missing on Linux.
      child.once?.("error", () => {});
      child.unref?.();
      return true;
    } catch {
      return false;
    }
  };

  if (process.platform === "win32") {
    if (!commandExists("cmd.exe")) return false;
    return spawnDetached("cmd.exe", ["/d", "/s", "/c", "start", "", target], {
      windowsHide: true
    });
  }

  if (process.platform === "darwin") {
    if (!commandExists("open")) return false;
    return spawnDetached("open", [target]);
  }

  const linuxOpeners = [
    ["xdg-open", [target]],
    ["gio", ["open", target]],
    ["sensible-browser", [target]]
  ];
  for (const [command, args] of linuxOpeners) {
    if (!commandExists(command)) continue;
    if (spawnDetached(command, args)) return true;
  }

  return false;
}

function scheduleBrowserAutoLaunch() {
  if (!isBrowserAutoLaunchEnabled()) {
    console.log("[SYS] browser auto-launch disabled");
    return;
  }

  const { browserLaunchDelayMs } = getSystemConfigSnapshot();
  const baseUrl = getBridgeBaseUrl();

  if (browserLaunchTimer) {
    clearTimeout(browserLaunchTimer);
    browserLaunchTimer = null;
  }

  const launchDelayMs = Math.max(
    250,
    Math.min(15000, Number(browserLaunchDelayMs) || SYSTEM_CONFIG_DEFAULT.browserLaunchDelayMs)
  );

  browserLaunchTimer = setTimeout(async () => {
    const ready = await waitForBridgeHttpReady(baseUrl, { attempts: 14, intervalMs: 220 });
    if (!ready) {
      console.warn("[SYS] bridge readiness probe timed out; launching browser anyway");
    }

    const opened = openUrlInDefaultBrowser(baseUrl);
    if (opened) {
      console.log(`[SYS] browser launched: ${baseUrl}`);
    } else {
      console.warn(`[SYS] failed to launch browser automatically: ${baseUrl}`);
    }
  }, launchDelayMs);
  browserLaunchTimer.unref?.();
}

function writePidFile() {
  try {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    fs.writeFileSync(PID_FILE, String(process.pid), "utf8");
  } catch (err) {
    console.warn("[SYS] failed to write pid file:", err.message || err);
  }
}

function removePidFile() {
  try {
    const raw = fs.readFileSync(PID_FILE, "utf8");
    if (String(raw || "").trim() === String(process.pid)) {
      fs.unlinkSync(PID_FILE);
    }
  } catch {}
}

function closeHttpServer() {
  if (!httpServer) return Promise.resolve();

  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };

    try {
      httpServer.close(() => finish());
      setTimeout(finish, 1500).unref?.();
    } catch {
      finish();
    }
  });
}

async function shutdown(reason = "signal", exitCode = 0) {
  if (shutdownPromise) return shutdownPromise;

  shutdownPromise = (async () => {
    console.log(`[SYS] shutdown requested (${reason})`);
    stopParentWatchdog();
    if (browserLaunchTimer) {
      clearTimeout(browserLaunchTimer);
      browserLaunchTimer = null;
    }
    shutdownTimer = setTimeout(() => {
      console.error("[SYS] forced shutdown timeout reached");
      removePidFile();
      process.exit(1);
    }, 10000);
    shutdownTimer.unref?.();

    try {
      state.unlock("rave");
    } catch {}

    try {
      await Promise.race([
        modLoader.invokeHook("onShutdown", {
          reason,
          runtime: getModsRuntimeSnapshot()
        }),
        new Promise(resolve => setTimeout(resolve, 1200))
      ]);
    } catch {}

    try {
      standaloneRuntime.shutdown();
      for (const entry of wizAdapters.values()) {
        try {
          entry.send.close?.();
        } catch {}
      }
      wizAdapters.clear();
    } catch {}

    try {
      midiManager?.dispose?.();
      midiManager = null;
    } catch {}

    try {
      audio?.stop?.();
    } catch {}

    try {
      flushScheduledAudioRuntimeConfigWriteSync();
    } catch {}

    try {
      await Promise.resolve(engine?.stop?.());
    } catch {}

    try {
      await Promise.race([
        setHueTransportMode(HUE_TRANSPORT.REST),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("hue transport stop timeout")), 2200)
        )
      ]);
    } catch (err) {
      console.warn("[SYS] hue transport shutdown failed:", err.message || err);
    }

    try {
      await closeHttpServer();
    } catch {}

    try {
      destroyHueRestHttpsAgents();
    } catch {}

    removePidFile();
    if (shutdownTimer) {
      clearTimeout(shutdownTimer);
      shutdownTimer = null;
    }
    process.exit(exitCode);
  })();

  return shutdownPromise;
}

let shutdownSignalCount = 0;
function handleShutdownSignal(signalName) {
  shutdownSignalCount += 1;
  if (shutdownSignalCount >= 2) {
    console.error(`[SYS] ${signalName} received again during shutdown; forcing exit`);
    try {
      removePidFile();
    } catch {}
    process.exit(1);
    return;
  }
  shutdown(signalName, 0).catch(() => process.exit(1));
}

process.on("SIGINT", () => {
  handleShutdownSignal("SIGINT");
});
process.on("SIGTERM", () => {
  handleShutdownSignal("SIGTERM");
});
process.on("SIGBREAK", () => {
  handleShutdownSignal("SIGBREAK");
});
process.on("exit", () => {
  removePidFile();
});

// initial boot after full runtime declaration
initializeRuntime().catch(err => {
  console.error("[SYS] runtime initialization failed:", err.message || err);
});

// ======================================================
httpServer = app.listen(PORT, HOST, () => {
  writePidFile();
  startParentWatchdog();
  console.log(`Hue bridge running on ${getBridgeBaseUrl()}`);
  scheduleBrowserAutoLaunch();
});

