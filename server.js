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

const LOG_SENSITIVE_KEY_RE = /(client[\s_-]*key|clientkey|client_key|app[\s_-]*key|user[\s_-]*name|username|authorization|token|password|api[_-]?key|secret|cookie|set-cookie|bridge[\s_-]*id|bridgeid|entertainment[\s_-]*area(?:[\s_-]*id)?|entertainmentareaid)\s*[=:]\s*([^\s,;|]+)/gi;
const LOG_SENSITIVE_JSON_KEY_RE = /("(?:clientkey|client_key|app[_-]?key|username|user[_-]?name|authorization|token|password|api[_-]?key|secret|cookie|set-cookie|bridgeid|bridge[_-]?id|entertainmentareaid|entertainment[_-]?area(?:[_-]?id)?)"\s*:\s*")([^"]*)(")/gi;
const LOG_SENSITIVE_HEX_RE = /\b[a-f0-9]{24,}\b/gi;
const LOG_SENSITIVE_BRIDGE_HEX_RE = /\b[a-f0-9]{16}\b/gi;
const LOG_SENSITIVE_UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const LOG_SENSITIVE_LONG_TOKEN_RE = /\b[a-z0-9_-]{20,}\b/gi;
const LOG_SENSITIVE_IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const LOG_SENSITIVE_API_SEGMENT_RE = /(\/api\/)([^\/\s?]+)/gi;
const LOG_SENSITIVE_QUERY_RE = /([?&](?:token|apikey|api_key|clientkey|client_key|username|password|authorization)=)[^&\s]+/gi;
const LOG_SENSITIVE_BEARER_RE = /(bearer\s+)[a-z0-9._~+/-]+/gi;
const LOG_SENSITIVE_OBJECT_KEY_RE = /^(clientkey|client_key|app[_-]?key|username|user[_-]?name|authorization|token|password|api[_-]?key|secret|cookie|set-cookie|bridgeid|bridge[_-]?id|entertainmentareaid|entertainment[_-]?area(?:[_-]?id)?)$/i;
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
  let text = String(value || "").trim();
  if (!text) return fallback;
  text = text.replace(LOG_SENSITIVE_KEY_RE, (_, key) => `${key}=[redacted]`);
  text = text.replace(LOG_SENSITIVE_JSON_KEY_RE, (_, lead, __, tail) => `${lead}[redacted]${tail}`);
  text = text.replace(LOG_SENSITIVE_QUERY_RE, (_, prefix) => `${prefix}[redacted]`);
  text = text.replace(LOG_SENSITIVE_BEARER_RE, (_, prefix) => `${prefix}[redacted]`);
  text = text.replace(LOG_SENSITIVE_API_SEGMENT_RE, (_, lead) => `${lead}[redacted]`);
  text = text.replace(LOG_SENSITIVE_BRIDGE_HEX_RE, "[redacted-id]");
  text = text.replace(LOG_SENSITIVE_UUID_RE, "[redacted-id]");
  text = text.replace(LOG_SENSITIVE_HEX_RE, "[redacted]");
  text = text.replace(LOG_SENSITIVE_LONG_TOKEN_RE, "[redacted]");
  text = text.replace(LOG_SENSITIVE_IPV4_RE, "[redacted-ip]");
  if (text.length > 3000) text = `${text.slice(0, 2997)}...`;
  return text;
}

function sanitizeLogValue(value, seen = new WeakSet(), depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactLogString(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return value;
  if (typeof value === "symbol") return String(value);
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;

  if (value instanceof Error) {
    return redactLogString(value.stack || value.message || String(value));
  }

  if (depth >= 5) return "[MaxDepth]";
  if (Array.isArray(value)) {
    return value.map(item => sanitizeLogValue(item, seen, depth + 1));
  }

  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (LOG_SENSITIVE_OBJECT_KEY_RE.test(String(key || ""))) {
        out[key] = "[redacted]";
      } else {
        out[key] = sanitizeLogValue(item, seen, depth + 1);
      }
    }
    seen.delete(value);
    return out;
  }

  try {
    return redactLogString(String(value));
  } catch {
    return "[Unserializable]";
  }
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
const http = require("http");
const net = require("net");
const fs = require("fs");
const path = require("path");
const { execFile, execFileSync, spawn } = require("child_process");

// [TITLE] Section: Core Dependencies
// ======================================================
// CORE
// ======================================================
let createRaveEngine = require("./core/rave-engine");
const createAudio = require("./core/audio");
const fixtureRegistry = require("./core/fixtures");
const automationRules = require("./core/automation-rules");
const genreState = require("./core/genre-state");
const state = require("./core/state");
const createModLoader = require("./core/mods/mod-loader");

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
const SYSTEM_CONFIG_PATH = path.join(__dirname, "core", "system.config.json");
const MODS_README_PATH = path.join(__dirname, "docs", "MODS.md");
const TWITCH_COLOR_TARGETS = new Set(["hue", "wiz", "both", "other"]);
const TWITCH_COLOR_PREFIX_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const MOD_IMPORT_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const TWITCH_COLOR_CONFIG_DEFAULT = Object.freeze({
  version: 1,
  defaultTarget: "hue",
  prefixes: Object.freeze({
    hue: "hue",
    wiz: "wiz",
    other: ""
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
const HUE_TRANSPORT_PREFERENCE = Object.freeze({
  AUTO: "auto",
  REST: "rest"
});
const AUDIO_REACTIVITY_MAP_DEFAULT = Object.freeze({
  version: 1,
  dropEnabled: false,
  hardwareRateLimitsEnabled: true,
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

const SENSITIVE_LOG_KEY_RE = /(client[\s_-]*key|clientkey|client_key|app[\s_-]*key|user[\s_-]*name|username|authorization|token|password|api[_-]?key|secret|cookie|set-cookie|bridge[\s_-]*id|bridgeid|entertainment[\s_-]*area(?:[\s_-]*id)?|entertainmentareaid)\s*[=:]\s*([^\s,;|]+)/gi;
const SENSITIVE_LOG_JSON_KEY_RE = /("(?:clientkey|client_key|app[_-]?key|username|user[_-]?name|authorization|token|password|api[_-]?key|secret|cookie|set-cookie|bridgeid|bridge[_-]?id|entertainmentareaid|entertainment[_-]?area(?:[_-]?id)?)"\s*:\s*")([^"]*)(")/gi;
const SENSITIVE_LOG_HEX_RE = /\b[a-f0-9]{24,}\b/gi;
const SENSITIVE_LOG_BRIDGE_HEX_RE = /\b[a-f0-9]{16}\b/gi;
const SENSITIVE_LOG_UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const SENSITIVE_LOG_LONG_TOKEN_RE = /\b[a-z0-9_-]{20,}\b/gi;
const SENSITIVE_LOG_IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const SENSITIVE_LOG_API_SEGMENT_RE = /(\/api\/)([^\/\s?]+)/gi;
const SENSITIVE_LOG_QUERY_RE = /([?&](?:token|apikey|api_key|clientkey|client_key|username|password|authorization)=)[^&\s]+/gi;
const SENSITIVE_LOG_BEARER_RE = /(bearer\s+)[a-z0-9._~+/-]+/gi;

function redactSensitiveLogValue(value, fallback = "unknown") {
  let text = String(value || "").trim();
  if (!text) return fallback;
  text = text.replace(SENSITIVE_LOG_KEY_RE, (_, key) => `${key}=[redacted]`);
  text = text.replace(SENSITIVE_LOG_JSON_KEY_RE, (_, lead, __, tail) => `${lead}[redacted]${tail}`);
  text = text.replace(SENSITIVE_LOG_QUERY_RE, (_, prefix) => `${prefix}[redacted]`);
  text = text.replace(SENSITIVE_LOG_BEARER_RE, (_, prefix) => `${prefix}[redacted]`);
  text = text.replace(SENSITIVE_LOG_API_SEGMENT_RE, (_, lead) => `${lead}[redacted]`);
  text = text.replace(SENSITIVE_LOG_BRIDGE_HEX_RE, "[redacted-id]");
  text = text.replace(SENSITIVE_LOG_UUID_RE, "[redacted-id]");
  text = text.replace(SENSITIVE_LOG_HEX_RE, "[redacted]");
  text = text.replace(SENSITIVE_LOG_LONG_TOKEN_RE, "[redacted]");
  text = text.replace(SENSITIVE_LOG_IPV4_RE, "[redacted-ip]");
  if (text.length > 300) text = `${text.slice(0, 297)}...`;
  return text;
}

function redactErrorForLog(err, fallback = "unknown error") {
  if (!err) return fallback;
  return redactSensitiveLogValue(err.message || err, fallback);
}

function sanitizeHueFallbackReason(value, fallback = "entertainment fallback") {
  return redactSensitiveLogValue(value, fallback);
}

function parseIpv4Parts(ip) {
  const text = String(ip || "").trim();
  if (net.isIP(text) !== 4) return null;
  const parts = text.split(".").map(part => Number(part));
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null;
  }
  return parts;
}

function isPrivateHueBridgeIp(ip) {
  const parts = parseIpv4Parts(ip);
  if (!parts) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // Link-local.
  if (a === 127) return true; // Local testing only.
  return false;
}

function normalizeHueBridgeIp(ip) {
  const target = String(ip || "").trim();
  if (!target) return "";
  return isPrivateHueBridgeIp(target) ? target : "";
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

function parseBooleanLoose(value, fallback = false) {
  if (value === true || value === false) return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  if (typeof value === "string") {
    const raw = value.trim().toLowerCase();
    if (raw === "true" || raw === "on" || raw === "yes") return true;
    if (raw === "false" || raw === "off" || raw === "no") return false;
  }
  return fallback;
}

function sanitizeHueTransportPreference(value, fallback = HUE_TRANSPORT_PREFERENCE.AUTO) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === HUE_TRANSPORT_PREFERENCE.REST) return HUE_TRANSPORT_PREFERENCE.REST;
  if (raw === HUE_TRANSPORT_PREFERENCE.AUTO) return HUE_TRANSPORT_PREFERENCE.AUTO;
  return sanitizeHueTransportPreference(fallback, HUE_TRANSPORT_PREFERENCE.AUTO);
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
  return {
    version: 1,
    dropEnabled: parseBooleanLoose(raw.dropEnabled, AUDIO_REACTIVITY_MAP_DEFAULT.dropEnabled),
    hardwareRateLimitsEnabled: parseBooleanLoose(
      raw.hardwareRateLimitsEnabled,
      AUDIO_REACTIVITY_MAP_DEFAULT.hardwareRateLimitsEnabled
    ),
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

let systemConfigRuntime = readSystemConfig();
setUnsafeExposeSensitiveLogsRuntime(Boolean(systemConfigRuntime?.unsafeExposeSensitiveLogs));
console.log(
  `[SYSTEM] config loaded (autoLaunchBrowser=${systemConfigRuntime.autoLaunchBrowser}, ` +
  `delayMs=${systemConfigRuntime.browserLaunchDelayMs}, ` +
  `unsafeExposeSensitiveLogs=${Boolean(systemConfigRuntime.unsafeExposeSensitiveLogs)}, ` +
  `hueTransportPreference=${sanitizeHueTransportPreference(systemConfigRuntime.hueTransportPreference)})`
);

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

async function fetchHueBridgeConfigByIp(ip) {
  const target = normalizeHueBridgeIp(ip);
  if (!target) return null;
  try {
    const { data } = await axios.get(`http://${target}/api/0/config`, {
      timeout: 1800,
      maxRedirects: 0
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
const ALLOW_REMOTE_PRIVILEGED_READ_RUNTIME =
  String(process.env.RAVELINK_ALLOW_REMOTE_PRIVILEGED_READ || "").trim() === "1";
const ALLOW_LEGACY_MUTATING_GET_RUNTIME =
  String(process.env.RAVELINK_ALLOW_LEGACY_MUTATING_GET || "").trim() === "1";
const LOOPBACK_HOST_ALIASES = new Set(["127.0.0.1", "localhost", "::1"]);
const LEGACY_MUTATING_GET_ROUTES = new Set(["/rave/on", "/rave/off", "/teach"]);
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
  const isLegacyMutatingGetRoute = req.method === "GET" && LEGACY_MUTATING_GET_ROUTES.has(req.path);
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
    if (!originValidation.ok) {
      res.status(403).json({ ok: false, error: "untrusted_origin", detail: originValidation.reason });
      return;
    }
    res.sendStatus(204);
    return;
  }

  if (isCrossSiteBrowserRequest(req) && (MUTATING_HTTP_METHODS.has(req.method) || isLegacyMutatingGetRoute)) {
    res.status(403).json({
      ok: false,
      error: "cross_site_blocked",
      detail: "cross-site browser requests are blocked for control routes"
    });
    return;
  }

  if (!originValidation.ok && (MUTATING_HTTP_METHODS.has(req.method) || isLegacyMutatingGetRoute)) {
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
const audioRestartRateLimit = createIpRateLimiter({
  windowMs: 30000,
  max: 8,
  bucket: "audio_restart"
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
const hueHttpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 32,
  keepAliveMsecs: 1000
});

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
const HUE_RECOVERY_FAST_RETRY_STREAK_LIMIT = 1;
const HUE_RECOVERY_START_DELAY_MS = 300;
const HUE_RECOVERY_SOCKET_START_DELAY_MS = 1400;
let hueRecoveryFailStreak = 0;
let hueRecoveryTimeoutStreak = 0;
let hueRecoveryLastPendingReason = "";
let hueRecoveryLastPendingLogAt = 0;
let hueTransportOp = Promise.resolve();
let hueTransportRequestSeq = 0;
let hueTransportPendingMode = null;
let hueTransportPendingPromise = null;

// [TITLE] Section: Hardware Rate Capability Guard
const TRANSPORT_RATE_CAPS = Object.freeze({
  hue: Object.freeze({
    rest: Object.freeze({
      defaultMs: 260,
      safeMinMs: 170,
      safeMaxMs: 550,
      unsafeMinMs: 120,
      unsafeMaxMs: 1200,
      maxSilenceMs: 1200
    }),
    entertainment: Object.freeze({
      defaultMs: 95,
      safeMinMs: 72,
      safeMaxMs: 240,
      unsafeMinMs: 40,
      unsafeMaxMs: 600,
      maxSilenceMs: 780
    })
  }),
  wiz: Object.freeze({
    default: Object.freeze({
      defaultMs: 105,
      safeMinMs: 75,
      safeMaxMs: 240,
      unsafeMinMs: 45,
      unsafeMaxMs: 600,
      maxSilenceMs: 900
    })
  })
});
const HUE_REST_SINGLE_FIXTURE_SAFE_MIN_MS = 190;
const HUE_REST_FAST_TRANSITION_RATE_MS = 220;
const HUE_REST_MEDIUM_TRANSITION_RATE_MS = 340;
const HUE_REST_SLOW_TRANSITION_RATE_MS = 500;

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

function buildHueScheduleOptions(options = {}, zone = "hue") {
  const input = options && typeof options === "object" ? options : {};
  const profile = getHueRateProfileForActiveTransport();
  const adaptiveSafeMinMs = profile === TRANSPORT_RATE_CAPS.hue.rest
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
  if (effectiveRateMs <= HUE_REST_FAST_TRANSITION_RATE_MS) cap = 0;
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

function buildWizScheduleOptions(options = {}) {
  const input = options && typeof options === "object" ? options : {};
  const profile = TRANSPORT_RATE_CAPS.wiz.default;
  const minIntervalMs = clampIntervalMsForProfile(input.minIntervalMs, profile);
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
  if (brandKey === "hue") return "hue";
  if (brandKey === "wiz") return "wiz";
  const normalizedFallback = normalizeRouteZoneToken(fallback, "");
  return normalizedFallback || brandKey || "custom";
}

function getFixtureZoneAliases(fixture) {
  const aliases = new Set();
  if (!fixture || typeof fixture !== "object") return aliases;

  const brand = String(fixture.brand || "").trim().toLowerCase();
  const zone = normalizeRouteZoneToken(fixture.zone, getCanonicalZoneFallback(brand, "custom"));
  const legacyStandalone = String(fixture.controlMode || "engine").trim().toLowerCase() === "standalone";
  const customEnabled = parseBoolean(fixture.customEnabled, legacyStandalone);

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
  if (modeKey === "engine" && typeof fixtureRegistry.listEngineBy === "function") {
    fixtures = fixtureRegistry.listEngineBy(brandKey, "", { requireConfigured });
  } else if (modeKey === "twitch" && typeof fixtureRegistry.listTwitchBy === "function") {
    fixtures = fixtureRegistry.listTwitchBy(brandKey, "", { requireConfigured });
  } else if (modeKey === "custom" && typeof fixtureRegistry.listCustomBy === "function") {
    fixtures = fixtureRegistry.listCustomBy(brandKey, "", { requireConfigured });
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
  const pendingHueState = pendingHueStateByZone.get(zone);
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

    const ops = hueTargets.map(target =>
      axios.put(
        `http://${target.bridgeIp}/api/${target.username}/lights/${target.lightId}/state`,
        stateToSend,
        { timeout: 1500, httpAgent: hueHttpAgent }
      )
    );
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

function sendHueViaEntertainment(state, zone = "hue") {
  const hueTargets = listEngineFixtures("hue", zone);
  if (!hueTargets.length) {
    hueTelemetry.skippedNoTargets++;
    logNoEngineTargets("hue", zone);
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
    hueTelemetry.sent++;
    hueTelemetry.sentEntertainment++;
    hueTelemetry.lastDurationMs = Date.now() - start;
  } catch (err) {
    const failureDetail = redactErrorForLog(err);
    const isHardFailure = isHueEntertainmentSendHardFailure(failureDetail);
    hueTransport.errors++;
    hueTransport.fallbackReason = failureDetail;

    if (isHardFailure) {
      console.warn(`[HUE][ENT] send fallback to REST: ${hueTransport.fallbackReason}`);
      hueTransport.active = HUE_TRANSPORT.REST;
      hueEntertainment.stop().catch(stopErr => {
        console.warn("[HUE][ENT] cleanup stop failed:", redactErrorForLog(stopErr));
      });
      forceHueEntertainmentRecovery("send_fallback");
      pendingHueStateByZone.set(zone, state);
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
    for (const [zone, state] of queued) {
      sendHueViaEntertainment(state, zone);
    }
    return;
  }

  for (const [zone, state] of queued) {
    pendingHueStateByZone.set(zone, state);
    flushHue(zone);
  }
}

function enqueueHue(state, zone = "hue", options = {}) {
  const scheduler = getHueScheduler(zone);
  const scheduleOptions = buildHueScheduleOptions(options, zone);

  if (!scheduler.shouldSend(state, scheduleOptions)) {
    hueTelemetry.skippedScheduler++;
    return;
  }

  if (hueTransport.active === HUE_TRANSPORT.ENTERTAINMENT) {
    sendHueViaEntertainment(state, zone);
    return;
  }

  if (isHueEntertainmentSyncInProgress()) {
    hueTelemetry.skippedSyncHold++;
    pendingHueSyncStateByZone.set(zone, state);
    return;
  }

  scheduleHueEntertainmentRecovery("rest_emit");
  pendingHueStateByZone.set(zone, state);
  flushHue(zone);
}

async function setHueTransportMode(nextMode) {
  const requested = nextMode === HUE_TRANSPORT.ENTERTAINMENT
    ? HUE_TRANSPORT.ENTERTAINMENT
    : HUE_TRANSPORT.REST;
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
        } else if (!status.available) {
          hueTransport.active = HUE_TRANSPORT.REST;
          hueTransport.fallbackReason = sanitizeHueFallbackReason(
            status.reason,
            "entertainment driver unavailable"
          );
        } else if (!status.configured) {
          hueTransport.active = HUE_TRANSPORT.REST;
          hueTransport.fallbackReason =
            "missing bridgeIp/username/bridgeId/clientKey (fixture or env)";
        } else if (status.active) {
          hueTransport.active = HUE_TRANSPORT.ENTERTAINMENT;
          hueTransport.fallbackReason = null;
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
          } else {
            await hueEntertainment.stop().catch(() => {});
            hueTransport.active = HUE_TRANSPORT.REST;
            hueTransport.fallbackReason = sanitizeHueFallbackReason(
              result.reason,
              "entertainment start failed"
            );
            hueTransport.errors++;
          }
        }
      }
    } catch (err) {
      if (!isSuperseded()) {
        hueTransport.active = HUE_TRANSPORT.REST;
        hueTransport.fallbackReason = redactErrorForLog(err);
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
    lower.includes("handshake timed out") ||
    lower.includes("legacy-start") ||
    lower.includes("forced-start")
  );
}

function shouldUseHueRecoveryFastRetry(reason = "unspecified") {
  const token = String(reason || "").trim().toLowerCase();
  return (
    token === "send_fallback" ||
    token.includes("boot_sync")
  );
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
      }
    } catch (err) {
      hueRecoveryFailStreak = Math.min(10, hueRecoveryFailStreak + 1);
      const errorDetail = redactErrorForLog(err);
      const cooldown = computeHueRecoveryCooldown(reason, errorDetail);
      hueRecoveryNextAt = Date.now() + cooldown;
      console.warn(`[HUE][ENT] auto-recover failed (${reason}):`, errorDetail);
    } finally {
      hueRecoveryInFlight = false;
      hueRecoveryTimer = null;
    }
  }, recoveryStartDelayMs);
}

function forceHueEntertainmentRecovery(reason = "manual") {
  const token = String(reason || "").trim().toLowerCase();
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
        `http://${target.bridgeIp}/api/${target.username}/lights/${target.lightId}/state`,
        payload,
        { timeout: 1800, httpAgent: hueHttpAgent }
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
  lastDurationMs: 0
};
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
    if (item.status === "reachable") summary.reachable += 1;
    else if (item.status === "unreachable") summary.unreachable += 1;
    else if (item.status === "not_configured") summary.notConfigured += 1;
    else if (item.status === "skipped") summary.skipped += 1;
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
    if (targetMode === "twitch" && parseBoolean(fixture?.customEnabled, false)) {
      return "custom";
    }
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

function enqueueWiz(state, zone = "wiz", options = {}) {
  const scheduler = getWizScheduler(zone);
  const scheduleOptions = buildWizScheduleOptions(options);
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

  const start = Date.now();
  for (const target of targets) {
    try {
      target.send(state, scheduleOptions.tx);
    } catch (err) {
      wizTelemetry.sendErrors++;
      console.error("[WIZ] send failed:", err.message || err);
    }
  }

  wizTelemetry.sent++;
  wizTelemetry.lastDurationMs = Date.now() - start;
}

// ======================================================
// STANDALONE FIXTURE CONTROL
// ======================================================
const standaloneStates = new Map();
const standaloneTimers = new Map();
const standaloneInFlight = new Set();
const standaloneWizAdapters = new Map();
const STANDALONE_SCENES = new Set(["sweep", "bounce", "pulse", "spark"]);
const STANDALONE_SPEED_MODES = new Set(["fixed", "audio"]);
const STANDALONE_COLOR_MODES = new Set(["hsv", "cct"]);

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseBoolean(value, fallback = false) {
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

function isStandaloneFixture(fixture) {
  const legacyStandalone = String(fixture?.controlMode || "engine").trim().toLowerCase() === "standalone";
  return parseBoolean(fixture?.customEnabled, legacyStandalone);
}

function listStandaloneFixtures() {
  return fixtureRegistry.getFixtures().filter(f => isStandaloneFixture(f));
}

function getStandaloneFixtureById(id) {
  const fixtureId = String(id || "").trim();
  if (!fixtureId) return null;
  return listStandaloneFixtures().find(f => String(f.id) === fixtureId) || null;
}

function normalizeStandaloneScene(scene, fallback = "sweep") {
  const key = String(scene || "").trim().toLowerCase();
  if (STANDALONE_SCENES.has(key)) return key;
  return STANDALONE_SCENES.has(fallback) ? fallback : "sweep";
}

function normalizeStandaloneSpeedMode(mode, fallback = "fixed") {
  const key = String(mode || "").trim().toLowerCase();
  if (STANDALONE_SPEED_MODES.has(key)) return key;
  return STANDALONE_SPEED_MODES.has(fallback) ? fallback : "fixed";
}

function normalizeStandaloneColorMode(mode, fallback = "hsv") {
  const key = String(mode || "").trim().toLowerCase();
  if (STANDALONE_COLOR_MODES.has(key)) return key;
  return STANDALONE_COLOR_MODES.has(fallback) ? fallback : "hsv";
}

function normalizeStandaloneStateRanges(source, base, keyMin, keyMax, min, max, fallbackMin, fallbackMax) {
  const has = key => Object.prototype.hasOwnProperty.call(source, key);
  const nextMin = has(keyMin)
    ? clampNumber(source[keyMin], min, max, base[keyMin])
    : base[keyMin];
  const nextMax = has(keyMax)
    ? clampNumber(source[keyMax], min, max, base[keyMax])
    : base[keyMax];
  let low = Math.round(Number.isFinite(Number(nextMin)) ? Number(nextMin) : fallbackMin);
  let high = Math.round(Number.isFinite(Number(nextMax)) ? Number(nextMax) : fallbackMax);
  low = Math.max(min, Math.min(max, low));
  high = Math.max(min, Math.min(max, high));
  if (low > high) {
    const swap = low;
    low = high;
    high = swap;
  }
  return [low, high];
}

function normalizeStandaloneState(input, previous, brand = "hue") {
  const defaults = {
    on: true,
    bri: 70,
    hue: brand === "hue" ? 210 : 190,
    sat: 80,
    transitionMs: 350,
    mode: "rgb",
    scene: "sweep",
    animate: false,
    static: false,
    updateOnRaveStart: false,
    updateOnRaveStop: false,
    speedMode: "fixed",
    speedHz: 1.2,
    speedHzMin: 0.6,
    speedHzMax: 3.2,
    hueMin: 0,
    hueMax: 359,
    satMin: 45,
    satMax: 100,
    colorMode: "hsv",
    cctKelvin: 4000,
    cctMinKelvin: 2700,
    cctMaxKelvin: 6500,
    motionPhase: 0,
    motionDirection: 1
  };

  const source = input && typeof input === "object" ? input : {};
  const base = previous && typeof previous === "object"
    ? { ...defaults, ...previous }
    : { ...defaults };

  const has = key => Object.prototype.hasOwnProperty.call(source, key);
  const [hueMin, hueMax] = normalizeStandaloneStateRanges(source, base, "hueMin", "hueMax", 0, 359, 0, 359);
  const [satMin, satMax] = normalizeStandaloneStateRanges(source, base, "satMin", "satMax", 0, 100, 45, 100);
  const [cctMinKelvin, cctMaxKelvin] = normalizeStandaloneStateRanges(
    source,
    base,
    "cctMinKelvin",
    "cctMaxKelvin",
    2200,
    6500,
    2700,
    6500
  );

  const next = {
    on: has("on") ? parseBoolean(source.on, base.on) : base.on,
    mode: has("mode") ? String(source.mode || base.mode).trim().toLowerCase() : String(base.mode || "scene"),
    scene: has("scene") ? normalizeStandaloneScene(source.scene, base.scene) : normalizeStandaloneScene(base.scene, "sweep"),
    bri: has("bri")
      ? clampNumber(source.bri, 1, 100, base.bri)
      : base.bri,
    hue: has("hue")
      ? clampNumber(source.hue, 0, 359, base.hue)
      : base.hue,
    sat: has("sat")
      ? clampNumber(source.sat, 0, 100, base.sat)
      : base.sat,
    transitionMs: has("transitionMs")
      ? clampNumber(source.transitionMs, 0, 10000, base.transitionMs)
      : base.transitionMs,
    animate: has("animate")
      ? parseBoolean(source.animate, base.animate)
      : base.animate,
    static: has("static")
      ? parseBoolean(source.static, base.static)
      : base.static,
    updateOnRaveStart: has("updateOnRaveStart")
      ? parseBoolean(source.updateOnRaveStart, base.updateOnRaveStart)
      : base.updateOnRaveStart,
    updateOnRaveStop: has("updateOnRaveStop")
      ? parseBoolean(source.updateOnRaveStop, base.updateOnRaveStop)
      : base.updateOnRaveStop,
    speedMode: has("speedMode")
      ? normalizeStandaloneSpeedMode(source.speedMode, base.speedMode)
      : normalizeStandaloneSpeedMode(base.speedMode, "fixed"),
    speedHz: has("speedHz")
      ? clampNumber(source.speedHz, 0.2, 12, base.speedHz)
      : base.speedHz,
    speedHzMin: has("speedHzMin")
      ? clampNumber(source.speedHzMin, 0.2, 12, base.speedHzMin)
      : base.speedHzMin,
    speedHzMax: has("speedHzMax")
      ? clampNumber(source.speedHzMax, 0.2, 12, base.speedHzMax)
      : base.speedHzMax,
    hueMin,
    hueMax,
    satMin,
    satMax,
    colorMode: has("colorMode")
      ? normalizeStandaloneColorMode(source.colorMode, base.colorMode)
      : normalizeStandaloneColorMode(base.colorMode, "hsv"),
    cctKelvin: has("cctKelvin")
      ? clampNumber(source.cctKelvin, 2200, 6500, base.cctKelvin)
      : base.cctKelvin,
    cctMinKelvin,
    cctMaxKelvin,
    motionPhase: has("motionPhase")
      ? clampNumber(source.motionPhase, 0, 1, base.motionPhase)
      : clampNumber(base.motionPhase, 0, 1, 0),
    motionDirection: has("motionDirection")
      ? (Number(source.motionDirection) < 0 ? -1 : 1)
      : (Number(base.motionDirection) < 0 ? -1 : 1)
  };

  const nextMode = next.mode === "rgb" || next.mode === "scene" || next.mode === "auto"
    ? next.mode
    : (next.animate ? "scene" : "rgb");
  next.mode = nextMode;
  if (next.mode === "rgb") {
    next.animate = false;
  }

  return {
    on: Boolean(next.on),
    mode: next.mode,
    scene: next.scene,
    bri: Math.round(next.bri),
    hue: Math.round(next.hue),
    sat: Math.round(next.sat),
    transitionMs: Math.round(next.transitionMs),
    animate: Boolean(next.animate),
    static: Boolean(next.static),
    updateOnRaveStart: Boolean(next.updateOnRaveStart),
    updateOnRaveStop: Boolean(next.updateOnRaveStop),
    speedMode: next.speedMode,
    speedHz: Number(next.speedHz.toFixed(2)),
    speedHzMin: Number(next.speedHzMin.toFixed(2)),
    speedHzMax: Number(next.speedHzMax.toFixed(2)),
    hueMin: Math.round(next.hueMin),
    hueMax: Math.round(next.hueMax),
    satMin: Math.round(next.satMin),
    satMax: Math.round(next.satMax),
    colorMode: next.colorMode,
    cctKelvin: Math.round(next.cctKelvin),
    cctMinKelvin: Math.round(next.cctMinKelvin),
    cctMaxKelvin: Math.round(next.cctMaxKelvin),
    motionPhase: Number(next.motionPhase.toFixed(4)),
    motionDirection: next.motionDirection < 0 ? -1 : 1
  };
}

function getStandaloneReactiveEnergy() {
  const telemetry = engine?.getTelemetry?.() || {};
  const energy = clampNumber(Number(telemetry.energy), 0, 1, 0);
  const rms = clampNumber(Number(telemetry.rms), 0, 1, 0);
  const flux = clampNumber(Number(telemetry.audioFlux ?? telemetry.flux), 0, 1, 0);
  const fallback = clampNumber(Math.max(energy, rms, flux * 0.8), 0, 1, 0.25);
  const profile = getAudioReactivityDrive("other", telemetry);
  if (!profile.enabled) {
    return fallback;
  }
  const mappedDrive = clampNumber((Number(profile.drive) - 0.12) / 1.08, 0, 1, fallback);
  const sourceLevel = clampNumber(Number(profile.level), 0, 1, fallback);
  return clampNumber(Math.max(mappedDrive, sourceLevel), 0, 1, fallback);
}

function resolveStandaloneDynamicHz(state = {}) {
  const mode = String(state.mode || "").trim().toLowerCase();
  const fixedHz = clampNumber(state.speedHz, 0.2, 12, 1.2);
  if (mode === "auto") {
    const telemetry = engine?.getTelemetry?.() || {};
    const bpm = Number(telemetry.bpm);
    if (Number.isFinite(bpm) && bpm > 0) {
      return clampNumber(bpm / 90, 0.4, 12, fixedHz);
    }
    return fixedHz;
  }
  if (String(state.speedMode || "").trim().toLowerCase() !== "audio") {
    return fixedHz;
  }
  const minHz = clampNumber(state.speedHzMin, 0.2, 12, 0.6);
  const maxHz = clampNumber(state.speedHzMax, minHz, 12, 3.2);
  const energy = getStandaloneReactiveEnergy();
  return minHz + ((maxHz - minHz) * energy);
}

function normalizeStandaloneScenePhase(phase) {
  let next = Number(phase);
  if (!Number.isFinite(next)) next = 0;
  while (next >= 1) next -= 1;
  while (next < 0) next += 1;
  return next;
}

function nextStandaloneAnimatedState(fixture, current, intervalMs) {
  const source = current && typeof current === "object" ? current : {};
  const scene = normalizeStandaloneScene(source.scene, "sweep");
  const colorMode = normalizeStandaloneColorMode(source.colorMode, "hsv");
  const hueLow = Math.round(Math.min(source.hueMin ?? 0, source.hueMax ?? 359));
  const hueHigh = Math.round(Math.max(source.hueMin ?? 0, source.hueMax ?? 359));
  const satLow = Math.round(Math.min(source.satMin ?? 0, source.satMax ?? 100));
  const satHigh = Math.round(Math.max(source.satMin ?? 0, source.satMax ?? 100));
  const cctLow = Math.round(Math.min(source.cctMinKelvin ?? 2700, source.cctMaxKelvin ?? 6500));
  const cctHigh = Math.round(Math.max(source.cctMinKelvin ?? 2700, source.cctMaxKelvin ?? 6500));
  const hueSpan = Math.max(1, hueHigh - hueLow);
  const satSpan = Math.max(0, satHigh - satLow);
  const cctSpan = Math.max(0, cctHigh - cctLow);
  const hz = resolveStandaloneDynamicHz(source);
  const step = clampNumber((hz * Math.max(40, Number(intervalMs) || 120)) / 1000, 0.01, 0.8, 0.08);
  const phase = normalizeStandaloneScenePhase(source.motionPhase);
  const direction = Number(source.motionDirection) < 0 ? -1 : 1;

  let nextPhase = phase;
  let nextDirection = direction;
  let hue = clampNumber(source.hue, 0, 359, hueLow);
  let sat = clampNumber(source.sat, 0, 100, satHigh);
  let bri = clampNumber(source.bri, 1, 100, 70);
  let cctKelvin = clampNumber(source.cctKelvin, 2200, 6500, cctLow);

  if (scene === "bounce") {
    let bouncePhase = phase + (step * direction);
    if (bouncePhase >= 1) {
      bouncePhase = 1 - (bouncePhase - 1);
      nextDirection = -1;
    } else if (bouncePhase <= 0) {
      bouncePhase = Math.abs(bouncePhase);
      nextDirection = 1;
    }
    nextPhase = normalizeStandaloneScenePhase(bouncePhase);
  } else {
    nextPhase = normalizeStandaloneScenePhase(phase + step);
  }

  if (scene === "pulse") {
    const wave = 0.5 + (Math.sin(nextPhase * Math.PI * 2) * 0.5);
    const briFloor = Math.max(8, Math.round(bri * 0.35));
    const briCeil = Math.max(briFloor, Math.round(source.bri || bri));
    bri = Math.round(briFloor + ((briCeil - briFloor) * wave));
    hue = Math.round(hueLow + (hueSpan * normalizeStandaloneScenePhase(nextPhase * 0.45)));
    sat = Math.round(satHigh - (satSpan * (wave * 0.45)));
    cctKelvin = Math.round(cctLow + (cctSpan * wave));
  } else if (scene === "spark") {
    const energy = getStandaloneReactiveEnergy();
    const jumpChance = clampNumber((0.18 + (energy * 0.65)) * step * 2.4, 0, 1, 0.2);
    if (Math.random() < jumpChance) {
      hue = Math.round(hueLow + (Math.random() * hueSpan));
      sat = Math.round(satLow + (Math.random() * satSpan));
      cctKelvin = Math.round(cctLow + (Math.random() * cctSpan));
    } else {
      hue = Math.round(hueLow + (hueSpan * nextPhase));
      sat = Math.round(satLow + (satSpan * nextPhase));
      cctKelvin = Math.round(cctLow + (cctSpan * nextPhase));
    }
  } else {
    hue = Math.round(hueLow + (hueSpan * nextPhase));
    sat = Math.round(satLow + (satSpan * nextPhase));
    cctKelvin = Math.round(cctLow + (cctSpan * nextPhase));
  }

  const patch = {
    hue,
    sat,
    bri,
    cctKelvin,
    speedHz: Number(hz.toFixed(2)),
    motionPhase: nextPhase,
    motionDirection: nextDirection
  };
  if (colorMode === "cct") {
    patch.sat = satLow;
  }
  return normalizeStandaloneState(patch, source, fixture?.brand);
}

function hsvToRgb(h, s, v = 100) {
  const hue = ((Number(h) % 360) + 360) % 360;
  const sat = clampNumber(s, 0, 100, 0) / 100;
  const val = clampNumber(v, 0, 100, 100) / 100;
  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;

  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  };
}

function getStandaloneWizAdapter(fixture) {
  if (!fixture || fixture.brand !== "wiz") return null;
  if (
    typeof fixtureRegistry.isWizFixtureConfigured === "function" &&
    !fixtureRegistry.isWizFixtureConfigured(fixture)
  ) {
    return null;
  }
  const id = String(fixture.id || "").trim();
  if (!id) return null;

  const existing = standaloneWizAdapters.get(id);
  if (existing && existing.ip === fixture.ip) {
    return existing.send;
  }

  if (existing) {
    try {
      existing.send.close?.();
    } catch {}
    standaloneWizAdapters.delete(id);
  }

  const send = createWizAdapter({ ip: fixture.ip });
  standaloneWizAdapters.set(id, { id, ip: fixture.ip, send });
  return send;
}

function closeStandaloneWizAdapter(id) {
  const key = String(id || "").trim();
  const existing = standaloneWizAdapters.get(key);
  if (!existing) return;
  try {
    existing.send.close?.();
  } catch {}
  standaloneWizAdapters.delete(key);
}

function stopStandaloneTimer(id) {
  const key = String(id || "").trim();
  const current = standaloneTimers.get(key);
  if (current) {
    clearInterval(current.handle);
    standaloneTimers.delete(key);
  }
}

function startStandaloneTimer(fixture, state) {
  const id = String(fixture?.id || "").trim();
  if (!id) return;
  if (!state?.animate || state?.static || fixture.enabled === false) {
    stopStandaloneTimer(id);
    return;
  }

  const mode = String(state?.mode || "").trim().toLowerCase();
  const intervalSeedHz = mode === "auto"
    ? 8
    : (
      String(state?.speedMode || "").trim().toLowerCase() === "audio"
        ? clampNumber(state?.speedHzMax, 0.2, 12, 3.2)
        : clampNumber(state?.speedHz, 0.2, 12, 1.2)
    );
  const intervalMs = Math.round(
    clampNumber(1000 / Math.max(0.2, Number(intervalSeedHz) || 1), 80, 2000, 833)
  );
  const existing = standaloneTimers.get(id);
  if (existing && existing.intervalMs === intervalMs) {
    return;
  }
  if (existing) {
    clearInterval(existing.handle);
    standaloneTimers.delete(id);
  }

  const handle = setInterval(async () => {
    if (standaloneInFlight.has(id)) return;

    const liveFixture = getStandaloneFixtureById(id);
    if (!liveFixture || liveFixture.enabled === false) {
      stopStandaloneTimer(id);
      return;
    }

    const current = standaloneStates.get(id);
    if (!current || !current.animate || current.static) {
      stopStandaloneTimer(id);
      return;
    }

    const nextState = nextStandaloneAnimatedState(liveFixture, current, intervalMs);
    standaloneStates.set(id, nextState);

    standaloneInFlight.add(id);
    try {
      await sendStandaloneState(liveFixture, nextState);
    } catch {}
    standaloneInFlight.delete(id);
  }, intervalMs);

  standaloneTimers.set(id, { handle, intervalMs });
}

function buildStandaloneSnapshot(fixture) {
  const id = String(fixture?.id || "").trim();
  const current = standaloneStates.get(id) || normalizeStandaloneState({}, null, fixture?.brand);
  const target = fixture?.brand === "hue"
    ? `${fixture.bridgeIp || "-"} / light ${fixture.lightId || "-"}`
    : (fixture?.ip || "-");
  const legacyMode = String(fixture?.controlMode || "engine").trim().toLowerCase();
  const engineEnabled = parseBoolean(fixture?.engineEnabled, legacyMode === "engine");
  const twitchEnabled = parseBoolean(fixture?.twitchEnabled, false);
  const customEnabled = parseBoolean(fixture?.customEnabled, legacyMode === "standalone");

  return {
    id,
    brand: fixture.brand,
    zone: fixture.zone || "",
    enabled: fixture.enabled !== false,
    controlMode: engineEnabled ? "engine" : "standalone",
    engineBinding: fixture.engineBinding || (engineEnabled ? fixture.brand : "standalone"),
    engineEnabled,
    twitchEnabled,
    customEnabled,
    target,
    supportsCct: fixture?.brand === "wiz" || fixture?.brand === "hue",
    animating: standaloneTimers.has(id),
    state: { ...current }
  };
}

function buildStandaloneSnapshotList() {
  syncStandaloneRuntime();
  return listStandaloneFixtures().map(buildStandaloneSnapshot);
}

function buildStandaloneSnapshotById(id) {
  const fixtureId = String(id || "").trim();
  if (!fixtureId) return null;
  syncStandaloneRuntime();
  const fixture = getStandaloneFixtureById(fixtureId);
  if (!fixture) return null;
  return buildStandaloneSnapshot(fixture);
}

function syncStandaloneRuntime() {
  const fixtures = listStandaloneFixtures();
  const nextIds = new Set(fixtures.map(f => String(f.id || "").trim()).filter(Boolean));

  for (const id of standaloneStates.keys()) {
    if (!nextIds.has(id)) {
      standaloneStates.delete(id);
    }
  }

  for (const id of standaloneTimers.keys()) {
    if (!nextIds.has(id)) {
      stopStandaloneTimer(id);
    }
  }

  for (const id of standaloneWizAdapters.keys()) {
    if (!nextIds.has(id)) {
      closeStandaloneWizAdapter(id);
    }
  }

  for (const fixture of fixtures) {
    const id = String(fixture.id || "").trim();
    if (!id) continue;
    const current = standaloneStates.get(id);
    const next = normalizeStandaloneState({}, current, fixture.brand);
    standaloneStates.set(id, next);

    if (fixture.brand === "wiz" && fixture.enabled !== false) {
      getStandaloneWizAdapter(fixture);
    } else if (fixture.brand === "wiz" && fixture.enabled === false) {
      closeStandaloneWizAdapter(id);
    } else {
      closeStandaloneWizAdapter(id);
    }

    if (fixture.enabled === false || !next.animate) {
      stopStandaloneTimer(id);
    } else {
      startStandaloneTimer(fixture, next);
    }
  }
}

function kelvinToHueCt(kelvin) {
  const tempK = clampNumber(kelvin, 1200, 9000, 3200);
  const mired = Math.round(1000000 / Math.max(1, tempK));
  return Math.max(153, Math.min(500, mired));
}

async function sendStandaloneState(fixture, state) {
  if (!fixture || !state) {
    return { ok: false, error: "invalid fixture/state" };
  }

  if (fixture.brand === "hue") {
    const isReady =
      typeof fixtureRegistry.isHueFixtureConfigured === "function"
        ? fixtureRegistry.isHueFixtureConfigured(fixture)
        : Boolean(fixture.bridgeIp && fixture.username && fixture.lightId);
    if (!isReady) {
      return { ok: false, error: "missing hue bridgeIp/username/lightId" };
    }

    const hue360 = ((state.hue % 360) + 360) % 360;
    const payload = {
      on: Boolean(state.on),
      transitiontime: toHueTransitionTime(state.transitionMs)
    };

    if (payload.on) {
      payload.bri = toHueBrightness(state.bri);
      if (String(state.colorMode || "").trim().toLowerCase() === "cct") {
        payload.ct = kelvinToHueCt(state.cctKelvin);
      } else {
        payload.hue = Math.round((hue360 / 360) * 65535);
        payload.sat = clampNumber(Math.round((state.sat / 100) * 254), 0, 254, 203);
      }
    }

    try {
      await axios.put(
        `http://${fixture.bridgeIp}/api/${fixture.username}/lights/${fixture.lightId}/state`,
        payload,
        { timeout: 1800, httpAgent: hueHttpAgent }
      );
      return { ok: true, transport: "hue-rest" };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  }

  if (fixture.brand === "wiz") {
    const isReady =
      typeof fixtureRegistry.isWizFixtureConfigured === "function"
        ? fixtureRegistry.isWizFixtureConfigured(fixture)
        : Boolean(fixture.ip);
    if (!isReady) {
      return { ok: false, error: "missing wiz ip" };
    }

    const send = getStandaloneWizAdapter(fixture);
    if (!send) {
      return { ok: false, error: "wiz fixture adapter unavailable" };
    }
    const colorMode = String(state.colorMode || "").trim().toLowerCase();
    const wizState = {
      on: Boolean(state.on),
      dimming: state.on ? clampNumber(Math.round(state.bri), 10, 100, 70) : 10
    };

    if (state.on && colorMode === "cct") {
      wizState.temp = clampNumber(Math.round(state.cctKelvin), 2200, 6500, 4000);
    } else if (state.on) {
      const rgb = hsvToRgb(state.hue, state.sat, 100);
      wizState.r = rgb.r;
      wizState.g = rgb.g;
      wizState.b = rgb.b;
    }
    try {
      send(wizState, { repeats: 1, repeatDelayMs: 16 });
      return { ok: true, transport: "wiz-udp" };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  }

  return { ok: false, error: "unsupported fixture brand" };
}

async function applyStandaloneStateById(id, patch = {}) {
  syncStandaloneRuntime();

  const fixture = getStandaloneFixtureById(id);
  if (!fixture) {
    return { ok: false, status: 404, error: "standalone fixture not found" };
  }
  if (fixture.enabled === false) {
    return { ok: false, status: 409, error: "fixture is disabled", fixture: buildStandaloneSnapshot(fixture) };
  }

  const fixtureId = String(fixture.id || "").trim();
  const current = standaloneStates.get(fixtureId);
  const next = normalizeStandaloneState(patch, current, fixture.brand);
  standaloneStates.set(fixtureId, next);

  const sent = await sendStandaloneState(fixture, next);
  if (!sent.ok) {
    return { ok: false, status: 502, error: sent.error || "standalone send failed" };
  }

  if (next.animate && !next.static) startStandaloneTimer(fixture, next);
  else stopStandaloneTimer(fixtureId);

  return {
    ok: true,
    fixture: buildStandaloneSnapshot(fixture),
    transport: sent.transport
  };
}

async function applyStandaloneRaveStopUpdates() {
  syncStandaloneRuntime();
  const fixtures = listStandaloneFixtures().filter(f => f && f.enabled !== false);
  for (const fixture of fixtures) {
    const fixtureId = String(fixture.id || "").trim();
    if (!fixtureId) continue;
    const current = standaloneStates.get(fixtureId);
    if (!current || !current.updateOnRaveStop) continue;
    try {
      await sendStandaloneState(fixture, current);
    } catch {}
  }
}

// ======================================================
// ENGINE + AUDIO
// ======================================================
let engine = null;
let audio = null;
let audioRuntimeConfig = null;
let midiManager = null;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

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
                forceDelta: Boolean(mappedIntent.forceRate || mappedIntent.forceDelta),
                deltaScale: Number.isFinite(intentDeltaScale)
                  ? intentDeltaScale
                  : (turboRate ? 0.5 : 1)
              }
            );
          }
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
            ? color.dimming
            : Math.round(clamp((mappedIntent.brightness || 1) * 100, 10, 100));
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
                forceDelta: Boolean(mappedIntent.forceRate || mappedIntent.forceDelta || dropActive),
                deltaScale: Number.isFinite(Number(mappedIntent.deltaScale))
                  ? Number(mappedIntent.deltaScale)
                  : (veryHighRate ? 0.5 : (highRate ? 0.62 : 0.92)),
                tx: {
                  // UDP is lossy; repeat key beats/drops for better visual lock.
                  repeats: dropActive ? (veryHighRate ? 2 : 3) : beatActive ? (veryHighRate ? 1 : 2) : 1,
                  repeatDelayMs: highRate ? 12 : 18
                }
              }
            );
          }
        }
      } catch (err) {
        console.error("[RAVE][EMIT ERROR]", err.stack || err);
      }
    }
  });

  audio = createAudio(level => {
    engine.setAudioLevel(level);
  });

  engine.setDropDetectionEnabled?.(Boolean(audioReactivityMapRuntime.dropEnabled));

  if (audioRuntimeConfig && audio.setConfig) {
    audio.setConfig(audioRuntimeConfig, { restart: false });
  }
  audioRuntimeConfig = audio.getConfig?.() || audioRuntimeConfig;

  audio.onStats?.(stats => {
    engine.setAudioLevel({
      level: stats.level,
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
  console.log(`[RAVE] engine + audio wired (WiZ targets: ${wizAdapters.size})`);

  midiManager = createMidiManager(engine);

  console.log("[RAVE] MIDI manager created and wired");

  const preferredHueMode = getPreferredHueTransportMode();
  setHueTransportMode(preferredHueMode)
    .then(result => {
      if (
        preferredHueMode === HUE_TRANSPORT.ENTERTAINMENT &&
        result.active !== HUE_TRANSPORT.ENTERTAINMENT
      ) {
        forceHueEntertainmentRecovery("boot_sync");
      }
    })
    .catch(err => {
      console.warn("[HUE] transport sync failed:", err.message || err);
      if (preferredHueMode === HUE_TRANSPORT.ENTERTAINMENT) {
        forceHueEntertainmentRecovery("boot_sync");
      }
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

// initial boot
initializeRuntime();

// ======================================================
// ROUTES
// ======================================================
async function handleRaveOn(_, res) {
  const automationSeq = nextAutomationEventSeq();
  try {
    state.lock("rave");
    const preferredHueMode = getPreferredHueTransportMode();
    const transport = await settleWithTimeout(
      setHueTransportMode(preferredHueMode),
      preferredHueMode === HUE_TRANSPORT.ENTERTAINMENT ? 3600 : 2200,
      () => ({
        desired: hueTransport.desired,
        active: hueTransport.active,
        fallbackReason: preferredHueMode === HUE_TRANSPORT.ENTERTAINMENT
          ? "entertainment switch timeout"
          : "rest switch timeout"
      })
    );
    if (preferredHueMode === HUE_TRANSPORT.ENTERTAINMENT) {
      if (transport.active !== HUE_TRANSPORT.ENTERTAINMENT) {
        forceHueEntertainmentRecovery("rave_on_prestart");
      } else {
        scheduleHueEntertainmentRecovery("rave_on_prestart");
      }
    }
    engine.start();
    audio.start();
    if (preferredHueMode === HUE_TRANSPORT.ENTERTAINMENT) {
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
  const keepEntertainmentWarm = getPreferredHueTransportMode() === HUE_TRANSPORT.ENTERTAINMENT;
  cancelHueEntertainmentRecovery("rave_off");
  state.unlock("rave");

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
    if (keepEntertainmentWarm) {
      const transport = await settleWithTimeout(
        setHueTransportMode(HUE_TRANSPORT.ENTERTAINMENT),
        3200,
        () => ({
          desired: hueTransport.desired,
          active: hueTransport.active,
          fallbackReason: "entertainment keep-warm timeout"
        })
      );
      if (transport.active !== HUE_TRANSPORT.ENTERTAINMENT) {
        scheduleHueEntertainmentRecovery("rave_off_idle");
      } else {
        scheduleHueEntertainmentRecovery("rave_off_idle");
      }
    } else {
      const transport = await settleWithTimeout(
        setHueTransportMode(HUE_TRANSPORT.REST),
        2200,
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
    }
  } catch (err) {
    console.warn("[RAVE] transport stop warning:", err?.message || err);
  }

  fireModHook("onRaveStop", {
    source: "api",
    runtime: getModsRuntimeSnapshot()
  });
  runAutomationEvent("stop", automationSeq).catch(err => {
    console.warn("[AUTOMATION] stop action failed:", err.message || err);
  });
  applyStandaloneRaveStopUpdates().catch(err => {
    console.warn("[STANDALONE] rave-stop update failed:", err.message || err);
  });
  res.sendStatus(200);
}

app.post("/rave/on", handleRaveOn);
if (ALLOW_LEGACY_MUTATING_GET_RUNTIME) {
  app.get("/rave/on", handleRaveOn);
} else {
  app.get("/rave/on", (_, res) => {
    res.status(405).json({
      ok: false,
      error: "method_not_allowed",
      detail: "Use POST /rave/on. Legacy mutating GET routes are disabled by default."
    });
  });
}

app.post("/rave/off", handleRaveOff);
if (ALLOW_LEGACY_MUTATING_GET_RUNTIME) {
  app.get("/rave/off", handleRaveOff);
} else {
  app.get("/rave/off", (_, res) => {
    res.status(405).json({
      ok: false,
      error: "method_not_allowed",
      detail: "Use POST /rave/off. Legacy mutating GET routes are disabled by default."
    });
  });
}

app.post("/rave/reload", async (_, res) => {
  console.log("[RAVE] hot reload requested");

  try {
    audio?.stop();
    await engine?.stop();
  } catch {}

  delete require.cache[require.resolve("./core/rave-engine")];
  createRaveEngine = require("./core/rave-engine");

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

function clampRgb255(v) {
  return Math.max(0, Math.min(255, Math.round(Number(v) || 0)));
}

function miredToKelvin(mired) {
  const m = Number(mired);
  if (!Number.isFinite(m) || m <= 0) return 3200;
  return Math.max(1200, Math.min(9000, Math.round(1000000 / m)));
}

function kelvinToRgb(kelvin) {
  let temp = Math.max(1000, Math.min(40000, Number(kelvin) || 3200)) / 100;
  let red;
  let green;
  let blue;

  if (temp <= 66) {
    red = 255;
    green = 99.4708025861 * Math.log(temp) - 161.1195681661;
    blue = temp <= 19 ? 0 : (138.5177312231 * Math.log(temp - 10) - 305.0447927307);
  } else {
    red = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
    green = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
    blue = 255;
  }

  return {
    r: clampRgb255(red),
    g: clampRgb255(green),
    b: clampRgb255(blue)
  };
}

function xyBriToRgb(x, y, bri = 180) {
  const xx = Number(x);
  const yy = Number(y);
  if (!Number.isFinite(xx) || !Number.isFinite(yy) || yy <= 0.0001) {
    return { r: 255, g: 255, b: 255 };
  }

  const z = 1.0 - xx - yy;
  const Y = Math.max(0.05, Math.min(1, Number(bri) / 254));
  const X = (Y / yy) * xx;
  const Z = (Y / yy) * z;

  let r = X * 1.656492 - Y * 0.354851 - Z * 0.255038;
  let g = -X * 0.707196 + Y * 1.655397 + Z * 0.036152;
  let b = X * 0.051713 - Y * 0.121364 + Z * 1.01153;

  r = r <= 0.0031308 ? 12.92 * r : (1.055 * Math.pow(r, 1 / 2.4) - 0.055);
  g = g <= 0.0031308 ? 12.92 * g : (1.055 * Math.pow(g, 1 / 2.4) - 0.055);
  b = b <= 0.0031308 ? 12.92 * b : (1.055 * Math.pow(b, 1 / 2.4) - 0.055);

  r = Math.max(0, r);
  g = Math.max(0, g);
  b = Math.max(0, b);

  const maxChannel = Math.max(r, g, b, 1);
  if (maxChannel > 1) {
    r /= maxChannel;
    g /= maxChannel;
    b /= maxChannel;
  }

  return {
    r: clampRgb255(r * 255),
    g: clampRgb255(g * 255),
    b: clampRgb255(b * 255)
  };
}

function hueStateToWizState(hueState = {}) {
  const bri = Math.max(10, Math.min(100, Math.round((Number(hueState.bri || 180) / 254) * 100)));
  let rgb = { r: 255, g: 255, b: 255 };

  if (Array.isArray(hueState.xy) && hueState.xy.length >= 2) {
    rgb = xyBriToRgb(hueState.xy[0], hueState.xy[1], hueState.bri || 180);
  } else if (Number.isFinite(Number(hueState.ct))) {
    rgb = kelvinToRgb(miredToKelvin(hueState.ct));
  }

  return {
    r: rgb.r,
    g: rgb.g,
    b: rgb.b,
    dimming: bri
  };
}

function sanitizeTwitchColorPrefix(value, fallback = "") {
  const token = String(value || "").trim().toLowerCase();
  if (!token) return "";
  if (TWITCH_COLOR_PREFIX_RE.test(token)) return token;
  return String(fallback || "").trim().toLowerCase();
}

function sanitizeTwitchColorTarget(value, fallback = "hue") {
  const target = String(value || "").trim().toLowerCase();
  if (TWITCH_COLOR_TARGETS.has(target)) return target;
  const safeFallback = String(fallback || "hue").trim().toLowerCase();
  return TWITCH_COLOR_TARGETS.has(safeFallback) ? safeFallback : "hue";
}

function sanitizeTwitchColorConfig(input = {}) {
  const raw = input && typeof input === "object" ? input : {};
  const rawPrefixes = raw.prefixes && typeof raw.prefixes === "object" ? raw.prefixes : {};
  const hasHue = Object.prototype.hasOwnProperty.call(rawPrefixes, "hue");
  const hasWiz = Object.prototype.hasOwnProperty.call(rawPrefixes, "wiz");
  const hasOther = Object.prototype.hasOwnProperty.call(rawPrefixes, "other");

  const huePrefix = hasHue
    ? sanitizeTwitchColorPrefix(rawPrefixes.hue, "")
    : sanitizeTwitchColorPrefix(TWITCH_COLOR_CONFIG_DEFAULT.prefixes.hue, "hue");
  const wizPrefix = hasWiz
    ? sanitizeTwitchColorPrefix(rawPrefixes.wiz, "")
    : sanitizeTwitchColorPrefix(TWITCH_COLOR_CONFIG_DEFAULT.prefixes.wiz, "wiz");
  const otherPrefix = hasOther
    ? sanitizeTwitchColorPrefix(rawPrefixes.other, "")
    : sanitizeTwitchColorPrefix(TWITCH_COLOR_CONFIG_DEFAULT.prefixes.other, "");

  return {
    version: 1,
    defaultTarget: sanitizeTwitchColorTarget(raw.defaultTarget, TWITCH_COLOR_CONFIG_DEFAULT.defaultTarget),
    prefixes: {
      hue: huePrefix,
      wiz: wizPrefix,
      other: otherPrefix
    }
  };
}

function readTwitchColorConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(TWITCH_COLOR_CONFIG_PATH, "utf8"));
    return sanitizeTwitchColorConfig(parsed);
  } catch {
    return sanitizeTwitchColorConfig(TWITCH_COLOR_CONFIG_DEFAULT);
  }
}

function writeTwitchColorConfig(config) {
  const safe = sanitizeTwitchColorConfig(config);
  fs.mkdirSync(path.dirname(TWITCH_COLOR_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(TWITCH_COLOR_CONFIG_PATH, `${JSON.stringify(safe, null, 2)}\n`, "utf8");
  return safe;
}

const twitchColorConfigRuntime = readTwitchColorConfig();
console.log(
  `[COLOR] twitch command config loaded (default=${twitchColorConfigRuntime.defaultTarget}, ` +
  `prefixes=${JSON.stringify(twitchColorConfigRuntime.prefixes)})`
);

function getTwitchColorConfigSnapshot() {
  return {
    version: twitchColorConfigRuntime.version,
    defaultTarget: twitchColorConfigRuntime.defaultTarget,
    prefixes: { ...twitchColorConfigRuntime.prefixes }
  };
}

function patchTwitchColorConfig(patch = {}) {
  const rawPatch = patch && typeof patch === "object" ? patch : {};
  const merged = {
    ...twitchColorConfigRuntime,
    ...rawPatch,
    prefixes: {
      ...twitchColorConfigRuntime.prefixes,
      ...(rawPatch.prefixes && typeof rawPatch.prefixes === "object" ? rawPatch.prefixes : {})
    }
  };
  const next = writeTwitchColorConfig(merged);
  twitchColorConfigRuntime.version = next.version;
  twitchColorConfigRuntime.defaultTarget = next.defaultTarget;
  twitchColorConfigRuntime.prefixes = { ...next.prefixes };
  return getTwitchColorConfigSnapshot();
}

const audioReactivityMapRuntime = readAudioReactivityMapConfig();
const audioReactivityEnvelopeByTarget = {
  hue: 1,
  wiz: 1,
  other: 1
};
console.log(
  `[AUDIO] reactivity map loaded (dropEnabled=${audioReactivityMapRuntime.dropEnabled}, ` +
  `hardwareRateLimitsEnabled=${audioReactivityMapRuntime.hardwareRateLimitsEnabled !== false}, ` +
  `hue=${audioReactivityMapRuntime.targets.hue.sources.join("+")}, ` +
  `wiz=${audioReactivityMapRuntime.targets.wiz.sources.join("+")}, ` +
  `other=${audioReactivityMapRuntime.targets.other.sources.join("+")})`
);

function resetAudioReactivityEnvelopes() {
  for (const key of Object.keys(audioReactivityEnvelopeByTarget)) {
    audioReactivityEnvelopeByTarget[key] = 1;
  }
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

function getAudioReactivityMapSnapshot() {
  return {
    version: Number(audioReactivityMapRuntime.version || 1),
    dropEnabled: Boolean(audioReactivityMapRuntime.dropEnabled),
    hardwareRateLimitsEnabled: audioReactivityMapRuntime.hardwareRateLimitsEnabled !== false,
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

function patchAudioReactivityMapConfig(patch = {}) {
  const rawPatch = patch && typeof patch === "object" ? patch : {};
  const merged = {
    ...audioReactivityMapRuntime,
    ...rawPatch,
    targets: {
      ...(audioReactivityMapRuntime.targets || {}),
      ...(rawPatch.targets && typeof rawPatch.targets === "object" ? rawPatch.targets : {})
    }
  };
  const next = writeAudioReactivityMapConfig(merged);
  audioReactivityMapRuntime.version = next.version;
  audioReactivityMapRuntime.dropEnabled = next.dropEnabled;
  audioReactivityMapRuntime.hardwareRateLimitsEnabled = next.hardwareRateLimitsEnabled !== false;
  audioReactivityMapRuntime.targets = {
    hue: { ...next.targets.hue },
    wiz: { ...next.targets.wiz },
    other: { ...next.targets.other }
  };
  resetAudioReactivityEnvelopes();
  if (engine?.setDropDetectionEnabled) {
    engine.setDropDetectionEnabled(Boolean(audioReactivityMapRuntime.dropEnabled));
  }
  return getAudioReactivityMapSnapshot();
}

function clamp01(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function getAudioTelemetryMotionProfile(telemetry = {}) {
  const t = telemetry && typeof telemetry === "object" ? telemetry : {};
  const rms = clamp01(t.rms, clamp01(t.level, 0));
  const energyValue = clamp01(t.energy, rms);
  const transient = clamp01(t.audioTransient ?? t.transient, 0);
  const flux = clamp01(t.audioFlux, clamp01(t.spectralFlux, 0));
  const beat = clamp01(t.beatConfidence, t.beat ? 0.65 : 0);
  const motion = clamp01(
    Math.max(
      energyValue,
      rms * 0.94,
      transient * 0.9,
      flux * 0.82,
      beat * 0.72
    ),
    0
  );
  const quietMix = clamp01((0.24 - motion) / 0.24, 0);
  const hushMix = clamp01((0.14 - motion) / 0.14, 0);
  return {
    motion,
    quietMix,
    hushMix
  };
}

function boostRgbSaturation(color = {}, amount = 0) {
  const r = clampRgb255(color?.r);
  const g = clampRgb255(color?.g);
  const b = clampRgb255(color?.b);
  const boost = clampNumber(amount, 0, 0.75, 0);
  const maxChannel = Math.max(r, g, b);
  const minChannel = Math.min(r, g, b);
  if (boost <= 0 || maxChannel <= 0 || maxChannel - minChannel < 1) {
    return { r, g, b };
  }

  const sat = (maxChannel - minChannel) / maxChannel;
  const targetSat = clamp01(sat + ((1 - sat) * boost), sat);
  const targetMin = maxChannel * (1 - targetSat);
  const spread = maxChannel - minChannel;
  const gain = spread > 0 ? (maxChannel - targetMin) / spread : 1;

  return {
    r: clampRgb255(maxChannel - ((maxChannel - r) * gain)),
    g: clampRgb255(maxChannel - ((maxChannel - g) * gain)),
    b: clampRgb255(maxChannel - ((maxChannel - b) * gain))
  };
}

function resolveAudioReactivitySourceLevel(source, telemetry = {}) {
  const t = telemetry && typeof telemetry === "object" ? telemetry : {};
  const rms = clamp01(t.rms, 0);
  const energyValue = clamp01(t.energy, rms);
  const low = clamp01(t.audioBandLow, rms);
  const mid = clamp01(t.audioBandMid, rms);
  const high = clamp01(t.audioBandHigh, rms);
  const transient = clamp01(Number(t.audioTransient || 0) / 1.2, 0);
  const peak = clamp01(Number(t.audioPeak || 0) / 1.5, 0);
  const flux = clamp01(t.audioFlux, 0);
  const beat = clamp01(t.beatConfidence, t.beat ? 0.65 : 0);

  switch (source) {
    case "baseline":
      return rms;
    case "bass":
      return low;
    case "mids":
      return mid;
    case "highs":
      return high;
    case "peaks":
      return peak;
    case "transients":
      return transient;
    case "flux":
      return flux;
    case "drums":
      return clamp01(low * 0.42 + transient * 0.3 + flux * 0.18 + beat * 0.1, 0);
    case "vocals":
      return clamp01(mid * 0.58 + high * 0.29 + flux * 0.13, 0);
    case "beat":
      return beat;
    case "groove":
      return clamp01(rms * 0.34 + low * 0.34 + mid * 0.2 + beat * 0.12, 0);
    case "smart":
    default:
      return clamp01(
        energyValue * 0.34 +
        transient * 0.22 +
        flux * 0.16 +
        low * 0.14 +
        mid * 0.1 +
        beat * 0.04,
        0
      );
  }
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
  const sources = sanitizeAudioReactivitySources(cfg.sources, ["smart"]);
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
  const blendedLevel = clamp01(
    (avgLevel * 0.4) +
    (upperMean * 0.34) +
    (sourcePeak * 0.18) +
    (drumsLevel * 0.08),
    avgLevel
  );
  const characterLevel = clamp01(
    (transientLevel * 0.34) +
    (peakLevel * 0.3) +
    (beatLevel * 0.2) +
    (drumsLevel * 0.16),
    0
  );
  const shapedBody = clamp01(Math.pow(Math.max(blendedLevel, 0), 0.78), blendedLevel);
  const amount = clampAudioReactivityAmount(cfg.amount, 1);
  const dynamicFloor = sources.length > 1 ? 0.44 : 0.4;
  const expressiveDrive = Math.max(
    0.34,
    Math.min(
      1.45,
      dynamicFloor +
      (shapedBody * 0.78) +
      (characterLevel * 0.37)
    )
  );
  const unsmoothedDrive = Math.max(
    0.34,
    Math.min(1.45, (1 - amount) + (expressiveDrive * amount))
  );
  const prevDrive = Math.max(0.34, Math.min(1.45, Number(audioReactivityEnvelopeByTarget[targetKey] || 1)));
  const alpha = unsmoothedDrive >= prevDrive ? 0.64 : 0.34;
  const drive = prevDrive + (unsmoothedDrive - prevDrive) * alpha;
  audioReactivityEnvelopeByTarget[targetKey] = drive;

  return {
    target: targetKey,
    enabled: true,
    drive,
    level: shapedBody,
    character: characterLevel,
    peak: peakLevel,
    transient: transientLevel,
    beat: beatLevel,
    amount,
    sources
  };
}

function applyHueIntentAudioReactivity(intent = {}, telemetry = null) {
  if (!intent || typeof intent !== "object") return intent;
  if (!intent.state || typeof intent.state !== "object") return intent;
  const profile = getAudioReactivityDrive("hue", telemetry);
  if (!profile.enabled) return { ...intent, drop: false };
  const motionProfile = getAudioTelemetryMotionProfile(telemetry);

  const statePatch = { ...intent.state };
  const baseBri = clampNumber(statePatch.bri, 1, 254, 160);
  const floorPercent = clampNumber(
    0.36 +
      (profile.character * 0.12) -
      (motionProfile.quietMix * 0.22) -
      (motionProfile.hushMix * 0.12),
    0.06,
    0.62,
    0.22
  );
  const floorBri = Math.max(3, Math.min(170, Math.round(baseBri * floorPercent)));
  const boundedDrive = Math.max(
    0.18,
    Math.min(1.45, profile.drive - (motionProfile.quietMix * 0.12))
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
    const trim = Math.max(0, Math.round(((boundedDrive - 0.4) * 3.2) + (profile.character * 1.3)));
    const quietHold = Math.round(
      (motionProfile.quietMix * 2.4) +
      (motionProfile.hushMix * 3.2)
    );
    const floor = flowMode ? 1 : 0;
    statePatch.transitiontime = Math.max(floor, Math.min(30, baseTransition - trim + quietHold));
  }
  if (Number.isFinite(Number(statePatch.sat)) && statePatch.on !== false) {
    const satBase = clampNumber(statePatch.sat, 1, 254, 180);
    const satBoost = Math.round((profile.character * 20) + (Math.max(0, boundedDrive - 1) * 26));
    statePatch.sat = Math.max(1, Math.min(254, satBase + satBoost));
  }
  const baseRateMs = clampNumber(intent.rateMs, 40, 1200, 0);
  const quietRateBoost = Math.round(
    (motionProfile.quietMix * 120) +
    (motionProfile.hushMix * 140)
  );
  const quietMaxSilenceMs = motionProfile.quietMix > 0.18
    ? Math.round(
      780 +
      (motionProfile.quietMix * 260) +
      (motionProfile.hushMix * 300)
    )
    : null;

  return {
    ...intent,
    drop: Boolean(audioReactivityMapRuntime.dropEnabled && intent.drop),
    rateMs: baseRateMs > 0 ? baseRateMs + quietRateBoost : intent.rateMs,
    ...(Number.isFinite(quietMaxSilenceMs) ? { maxSilenceMs: quietMaxSilenceMs } : {}),
    audioDrive: Number(profile.drive.toFixed(3)),
    audioSourceLevel: Number(profile.level.toFixed(3)),
    audioMotion: Number(motionProfile.motion.toFixed(3)),
    audioSources: profile.sources,
    state: statePatch
  };
}

function applyWizIntentAudioReactivity(intent = {}, telemetry = null) {
  if (!intent || typeof intent !== "object") return intent;
  const profile = getAudioReactivityDrive("wiz", telemetry);
  if (!profile.enabled) return { ...intent, drop: false };
  const motionProfile = getAudioTelemetryMotionProfile(telemetry);

  const next = { ...intent };
  const dropActive = Boolean(audioReactivityMapRuntime.dropEnabled && intent.drop);
  const beatActive = Boolean(intent.beat);
  const baseBrightness = clampNumber(next.brightness, 0.06, 1, 0.65);
  const boundedDrive = Math.max(
    0.16,
    Math.min(1.45, profile.drive - (motionProfile.quietMix * 0.14))
  );
  const floorScale = clampNumber(
    0.44 +
      (profile.character * 0.16) -
      (motionProfile.quietMix * 0.24) -
      (motionProfile.hushMix * 0.12),
    0.08,
    0.78,
    0.2
  );
  const floor = Math.max(0.03, Math.min(0.72, baseBrightness * floorScale));
  let brightness = floor + ((baseBrightness - floor) * Math.min(1.1, boundedDrive));
  if (boundedDrive > 1.02) {
    const extra = Math.min(1, (boundedDrive - 1.02) / 0.43);
    const headroom = Math.max(0, 1 - baseBrightness);
    brightness = baseBrightness + (headroom * extra * (0.66 + (profile.character * 0.4)));
  }
  if (dropActive) {
    brightness = Math.max(
      brightness,
      baseBrightness * (1.12 + (profile.character * 0.06))
    );
    if (boundedDrive >= 1.08 && brightness >= 0.93) {
      brightness = 1;
    }
  } else if (beatActive && boundedDrive >= 1.1) {
    brightness = Math.max(
      brightness,
      baseBrightness * (1.05 + (profile.character * 0.04))
    );
    if (boundedDrive >= 1.22 && brightness >= 0.97) {
      brightness = 1;
    }
  }
  if (!dropActive) {
    const quietDimmer = Math.max(
      0.32,
      1 - (motionProfile.quietMix * 0.22) - (motionProfile.hushMix * 0.28)
    );
    brightness *= quietDimmer;
  }
  next.brightness = Math.max(0.04, Math.min(1, brightness));
  const baseRateMs = clampNumber(next.rateMs, 40, 1200, 0);
  const quietRateBoost = Math.round(
    (motionProfile.quietMix * 90) +
    (motionProfile.hushMix * 120)
  );
  next.rateMs = baseRateMs > 0 ? baseRateMs + quietRateBoost : next.rateMs;
  if (motionProfile.quietMix > 0.18) {
    next.maxSilenceMs = Math.round(
      900 +
      (motionProfile.quietMix * 220) +
      (motionProfile.hushMix * 280)
    );
  }
  const saturationBoost = clampNumber(
    0.24 +
      (profile.character * 0.22) +
      (dropActive || beatActive ? 0.08 : 0),
    0,
    0.75,
    0.28
  );
  if (next.color && typeof next.color === "object") {
    next.color = {
      ...next.color,
      ...boostRgbSaturation(next.color, saturationBoost)
    };
  }
  next.drop = dropActive;
  next.audioDrive = Number(profile.drive.toFixed(3));
  next.audioSourceLevel = Number(profile.level.toFixed(3));
  next.audioMotion = Number(motionProfile.motion.toFixed(3));
  next.audioSources = profile.sources;
  return next;
}

function parseColorTarget(raw, fallback = "both") {
  return sanitizeTwitchColorTarget(raw, fallback);
}

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

function splitPrefixedColorText(rawText, prefixes = {}) {
  const source = String(rawText || "").trim();
  if (!source) {
    return { target: null, prefix: "", text: "" };
  }

  const candidates = [
    { target: "hue", prefix: sanitizeTwitchColorPrefix(prefixes.hue, "") },
    { target: "wiz", prefix: sanitizeTwitchColorPrefix(prefixes.wiz, "") },
    { target: "other", prefix: sanitizeTwitchColorPrefix(prefixes.other, "") }
  ]
    .filter(entry => entry.prefix)
    .sort((a, b) => b.prefix.length - a.prefix.length);

  const lower = source.toLowerCase();
  for (const entry of candidates) {
    const token = entry.prefix;
    if (
      lower === token ||
      lower.startsWith(`${token} `) ||
      lower.startsWith(`${token}:`) ||
      lower.startsWith(`${token}=`) ||
      lower.startsWith(`${token}-`)
    ) {
      let rest = source.slice(token.length).trim();
      rest = rest.replace(/^[:=\-]+/, "").trim();
      return {
        target: entry.target,
        prefix: token,
        text: rest
      };
    }
  }

  return {
    target: null,
    prefix: "",
    text: source
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
      `http://${target.bridgeIp}/api/${target.username}/lights/${target.lightId}/state`,
      state,
      { timeout: 1800, httpAgent: hueHttpAgent }
    )
  );
  const results = await Promise.allSettled(ops);
  for (const result of results) {
    if (result.status === "rejected") {
      console.warn("[COLOR][HUE] send failed:", result.reason?.message || result.reason);
    }
  }
}

async function applyStandaloneRaveStartUpdates() {
  syncStandaloneRuntime();
  const fixtures = listStandaloneFixtures().filter(f => f && f.enabled !== false);
  for (const fixture of fixtures) {
    const fixtureId = String(fixture.id || "").trim();
    if (!fixtureId) continue;
    const current = standaloneStates.get(fixtureId);
    if (!current || !current.updateOnRaveStart) continue;
    try {
      await sendStandaloneState(fixture, current);
    } catch {}
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
  const commandConfig = getTwitchColorConfigSnapshot();
  const prefixed = splitPrefixedColorText(rawText, commandConfig.prefixes);
  const target = options.targetExplicit
    ? parseColorTarget(options.target, commandConfig.defaultTarget)
    : parseColorTarget(prefixed.target || commandConfig.defaultTarget, commandConfig.defaultTarget);
  const colorText = String(prefixed.text || "").trim();

  if (!colorText) {
    return {
      ok: false,
      target,
      usedPrefix: prefixed.prefix || null,
      error: prefixed.target
        ? `missing color after ${prefixed.target} prefix`
        : "missing color text"
    };
  }

  if (target === "other") {
    return {
      ok: false,
      target,
      usedPrefix: prefixed.prefix || null,
      error: "other target requires mod-brand color adapter support"
    };
  }

  const parsed = colorEngine.parseColor(colorText);
  if (!parsed) {
    return {
      ok: false,
      target,
      usedPrefix: prefixed.prefix || null,
      error: "invalid color text"
    };
  }

  const response = {
    ok: true,
    target,
    usedPrefix: prefixed.prefix || null,
    hueZones: [],
    wizZones: [],
    hueTargets: 0,
    wizTargets: 0
  };

  if (target === "hue" || target === "both") {
    const hueZoneSeed = options.hueZone || options.zone || fixtureRegistry.resolveZone("TWITCH_HUE") || "hue";
    const hueZones = resolveZonesFromRoute(hueZoneSeed, "hue", "hue", listTwitchFixtures, { mode: "twitch" });
    response.hueZones = hueZones;
    const hueFixtures = collectFixturesByZones(listTwitchFixtures, "hue", hueZones);
    response.hueTargets = hueFixtures.length;
    if (hueFixtures.length) {
      await sendHueStateToFixtures(hueFixtures, parsed);
    }
  }

  if (target === "wiz" || target === "both") {
    const wizZoneSeed = options.wizZone || options.zone || fixtureRegistry.resolveZone("TWITCH_WIZ") || "wiz";
    const wizZones = resolveZonesFromRoute(wizZoneSeed, "wiz", "wiz", listTwitchFixtures, { mode: "twitch" });
    response.wizZones = wizZones;
    const wizFixtures = collectFixturesByZones(listTwitchFixtures, "wiz", wizZones);
    response.wizTargets = wizFixtures.length;
    const wizState = hueStateToWizState(parsed);
    if (wizFixtures.length) {
      sendWizStateToFixtures(wizFixtures, wizState);
    }
  }

  if ((response.hueTargets + response.wizTargets) <= 0) {
    response.ok = false;
    response.error = "no routed fixtures matched";
  }

  return response;
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

app.get("/obs/dock", (req, res) => {
  const compact = parseBoolean(req.query.compact, true);
  const dockUrl = compact ? "/?obsDock=1&compact=1" : "/?obsDock=1&compact=0";
  res.redirect(302, dockUrl);
});

if (ALLOW_LEGACY_MUTATING_GET_RUNTIME) {
  app.get("/teach", (req, res) => {
    const text = getCompatText(req);
    const ok = teachColor(text);
    res.json({ ok, text });
  });
} else {
  app.get("/teach", (_, res) => {
    res.status(405).json({
      ok: false,
      error: "method_not_allowed",
      detail: "Use POST /teach. Legacy mutating GET routes are disabled by default."
    });
  });
}

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
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const patch = {};

  if (Object.prototype.hasOwnProperty.call(body, "defaultTarget")) {
    patch.defaultTarget = body.defaultTarget;
  }

  if (body.prefixes && typeof body.prefixes === "object") {
    patch.prefixes = { ...body.prefixes };
  }

  if (Object.prototype.hasOwnProperty.call(body, "huePrefix")) {
    patch.prefixes = {
      ...(patch.prefixes || {}),
      hue: body.huePrefix
    };
  }

  if (Object.prototype.hasOwnProperty.call(body, "wizPrefix")) {
    patch.prefixes = {
      ...(patch.prefixes || {}),
      wiz: body.wizPrefix
    };
  }

  if (Object.prototype.hasOwnProperty.call(body, "otherPrefix")) {
    patch.prefixes = {
      ...(patch.prefixes || {}),
      other: body.otherPrefix
    };
  }

  if (body.clearOther === true || body.reset === true) {
    patch.prefixes = {
      ...(patch.prefixes || {}),
      other: ""
    };
  }

  const config = patchTwitchColorConfig(patch);
  res.json({
    ok: true,
    config,
    capabilities: getTwitchColorCapabilities()
  });
});

app.get("/color", (req, res) => {
  const text = getCompatText(req);
  applyColorText(text, getColorRequestOptions(req))
    .then(result => {
      res.json({ ok: result.ok, text, ...result });
    })
    .catch(err => {
      res.status(500).json({ ok: false, text, error: err.message || String(err) });
    });
});

app.post("/color", (req, res) => {
  const text = getCompatText(req);
  applyColorText(text, getColorRequestOptions(req))
    .then(result => {
      res.json({ ok: result.ok, text, ...result });
    })
    .catch(err => {
      res.status(500).json({ ok: false, text, error: err.message || String(err) });
    });
});

app.post("/rave/genre", (req, res) => {
  const requested = String(req.query.name || "edm");
  const normalized = engine.normalizeGenre?.(requested);

  if (!normalized) {
    res.status(400).json({
      ok: false,
      error: "invalid genre",
      requested,
      allowed: engine.getSupportedGenres?.() || []
    });
    return;
  }

  const applied = engine.setGenre?.(normalized) || normalized;
  genreState.set(applied);
  res.json({ ok: true, requested, applied });
});

app.post("/rave/genre/decade", (req, res) => {
  const requested = String(
    req.query.mode ?? req.query.name ?? req.query.decade ?? "auto"
  ).toLowerCase().trim();
  const next = engine.setGenreDecadeMode?.(requested);

  if (!next) {
    res.status(400).json({
      ok: false,
      error: "invalid decade mode",
      requested,
      allowed: ["auto", ...(engine.getSupportedGenreDecades?.() || [])]
    });
    return;
  }

  console.log(`[RAVE] genre decade = ${next.mode} (resolved ${next.resolved})`);
  res.json({
    ok: true,
    mode: next.mode,
    resolved: next.resolved
  });
});

app.get("/rave/genre/decade", (_, res) => {
  res.json({
    ok: true,
    mode: engine.getGenreDecadeMode?.() || "auto",
    resolved: engine.getResolvedGenreDecade?.() || "10s",
    allowed: ["auto", ...(engine.getSupportedGenreDecades?.() || [])]
  });
});

app.post("/rave/mode", (req, res) => {
  const { name } = req.query;

  switch (name) {
    case "game":
      engine.setBehavior?.("clamp");
      break;

    case "bpm":
      engine.setBehavior?.("interpret");
      break;

    case "auto":
      engine.setBehavior?.("auto");
      break;

    default:
      engine.setBehavior?.("auto");
      break;
  }

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
   MODE — COMPETITIVE / INTERPRET (EXPLICIT)
   ====================================================== */
app.post("/rave/mode/competitive/on", (_, res) => {
  engine.setBehavior?.("clamp");
  console.log("[RAVE] mode = COMPETITIVE (clamp)");
  res.sendStatus(200);
});

app.post("/rave/mode/competitive/off", (_, res) => {
  engine.setBehavior?.("auto");
  console.log("[RAVE] mode = AUTO");
  res.sendStatus(200);
});

/* ======================================================
   MIDI CONTROL
   ====================================================== */
function getMidiSnapshot() {
  if (!midiManager || typeof midiManager.getStatus !== "function") {
    return {
      ok: false,
      moduleAvailable: false,
      moduleError: "midi manager unavailable",
      connected: false,
      activePortIndex: null,
      activePortName: "",
      ports: [],
      portCount: 0,
      config: {
        enabled: false,
        deviceIndex: null,
        deviceMatch: "",
        velocityThreshold: 1,
        bindings: {}
      },
      actions: [],
      learn: { target: null, startedAt: 0, expiresAt: 0 },
      lastMessage: null,
      lastAction: "",
      lastActionAt: "",
      reason: "midi manager unavailable"
    };
  }
  return midiManager.getStatus();
}

app.get("/midi/status", (_, res) => {
  res.json(getMidiSnapshot());
});

app.post("/midi/refresh", (_, res) => {
  if (midiManager && typeof midiManager.refresh === "function") {
    return res.json(midiManager.refresh());
  }
  return res.status(503).json(getMidiSnapshot());
});

app.post("/midi/config", (req, res) => {
  if (!midiManager || typeof midiManager.applyConfig !== "function") {
    return res.status(503).json(getMidiSnapshot());
  }
  const patch = req.body && typeof req.body === "object" ? req.body : {};
  return res.json(midiManager.applyConfig(patch));
});

app.post("/midi/learn/cancel", (_, res) => {
  if (!midiManager || typeof midiManager.cancelLearn !== "function") {
    return res.status(503).json(getMidiSnapshot());
  }
  return res.json(midiManager.cancelLearn());
});

app.post("/midi/learn/:action", (req, res) => {
  if (!midiManager || typeof midiManager.startLearn !== "function") {
    return res.status(503).json(getMidiSnapshot());
  }
  let action = String(req.params.action || "").trim().toLowerCase();
  if (action === "overclock") action = "overclock_toggle";
  const result = midiManager.startLearn(action);
  if (!result.ok) {
    return res.status(400).json({
      ...result.status,
      ok: false,
      error: "invalid midi learn action",
      requested: action
    });
  }
  return res.json(result.status);
});

app.post("/midi/bindings/reset", (_, res) => {
  if (!midiManager || typeof midiManager.resetBindings !== "function") {
    return res.status(503).json(getMidiSnapshot());
  }
  return res.json(midiManager.resetBindings());
});

app.post("/midi/bindings/:action", (req, res) => {
  if (!midiManager || typeof midiManager.setBinding !== "function") {
    return res.status(503).json(getMidiSnapshot());
  }
  const action = String(req.params.action || "").trim().toLowerCase();
  const binding = req.body && typeof req.body === "object" ? req.body : {};
  const result = midiManager.setBinding(action, binding);
  if (!result.ok) {
    return res.status(400).json({
      ...result.status,
      ok: false,
      error: "invalid midi binding",
      requested: action
    });
  }
  return res.json(result.status);
});

app.delete("/midi/bindings/:action", (req, res) => {
  if (!midiManager || typeof midiManager.clearBinding !== "function") {
    return res.status(503).json(getMidiSnapshot());
  }
  const action = String(req.params.action || "").trim().toLowerCase();
  const result = midiManager.clearBinding(action);
  if (!result.ok) {
    return res.status(400).json({
      ...result.status,
      ok: false,
      error: "binding not found",
      requested: action
    });
  }
  return res.json(result.status);
});

app.post("/midi/trigger/:action", (req, res) => {
  if (!midiManager || typeof midiManager.triggerAction !== "function") {
    return res.status(503).json(getMidiSnapshot());
  }
  const action = String(req.params.action || "").trim().toLowerCase();
  const result = midiManager.triggerAction(action);
  if (!result.ok) {
    return res.status(400).json({
      ...result.status,
      ok: false,
      error: "invalid midi trigger action",
      requested: action
    });
  }
  return res.json(result.status);
});

const UNSAFE_OVERCLOCK_TIERS = Object.freeze({
  "20": { hz: 20, tier: "turbo20", level: 8, name: "DEV 20Hz" },
  "30": { hz: 30, tier: "turbo30", level: 9, name: "DEV 30Hz" },
  "40": { hz: 40, tier: "turbo40", level: 10, name: "DEV 40Hz" },
  "50": { hz: 50, tier: "turbo50", level: 11, name: "DEV 50Hz" },
  "60": { hz: 60, tier: "turbo60", level: 12, name: "DEV 60Hz" }
});

const UNSAFE_OVERCLOCK_BY_TIER = Object.freeze(
  Object.values(UNSAFE_OVERCLOCK_TIERS).reduce((acc, item) => {
    acc[item.tier] = item;
    acc[`x${item.hz}`] = item;
    acc[`dev${item.hz}`] = item;
    acc[`unsafe${item.hz}`] = item;
    acc[`destructive${item.hz}`] = item;
    return acc;
  }, {})
);

function hasUnsafeOverclockAck(req) {
  const raw = String(
    req.query.unsafe ??
    req.query.confirm ??
    req.query.ack ??
    req.body?.unsafe ??
    req.body?.confirm ??
    req.body?.ack ??
    ""
  ).trim().toLowerCase();

  return (
    raw === "1" ||
    raw === "true" ||
    raw === "yes" ||
    raw === "on" ||
    raw === "unsafe"
  );
}

function unsafeOverclockRejected(res, requested = "") {
  res.status(400).json({
    ok: false,
    error: "unsafe acknowledgement required",
    requested: String(requested || ""),
    requiredQuery: "unsafe=true",
    warning: "Destructive overclock tiers can cause unstable or unpredictable behavior."
  });
}

function applyUnsafeOverclockHzRoute(req, res, rawHz) {
  const key = String(rawHz || "").trim();
  const spec = UNSAFE_OVERCLOCK_TIERS[key];
  if (!spec) {
    res.status(400).json({
      ok: false,
      error: "invalid dev overclock hz",
      allowedHz: Object.keys(UNSAFE_OVERCLOCK_TIERS).map(v => Number(v))
    });
    return;
  }
  if (!hasUnsafeOverclockAck(req)) {
    unsafeOverclockRejected(res, spec.tier);
    return;
  }

  engine.setOverclock?.(spec.tier);
  console.warn(`[RAVE] UNSAFE overclock ${spec.name} enabled`);
  res.json({
    ok: true,
    unsafe: true,
    tier: spec.tier,
    hz: spec.hz,
    level: spec.level
  });
}

/* ======================================================
   OVERCLOCK — NEW SEMANTIC ROUTES
   ====================================================== */
app.post("/rave/overclock/on", (_, res) => {
  engine.setOverclock?.("fast");
  console.log("[RAVE] overclock SLOW 4Hz");
  res.sendStatus(200);
});

app.post("/rave/overclock/off", (_, res) => {
  engine.setOverclock?.(0);
  console.log("[RAVE] overclock SLOW 2Hz");
  res.sendStatus(200);
});

app.post("/rave/overclock/turbo/on", (_, res) => {
  engine.setOverclock?.("turbo6");
  console.log("[RAVE] overclock TURBO 6Hz");
  res.sendStatus(200);
});

app.post("/rave/overclock/turbo/off", (_, res) => {
  engine.setOverclock?.("fast");
  console.log("[RAVE] overclock TURBO OFF -> FAST");
  res.sendStatus(200);
});

app.post("/rave/overclock/ultra/on", (_, res) => {
  engine.setOverclock?.("turbo8");
  console.log("[RAVE] overclock ULTRA 8Hz");
  res.sendStatus(200);
});

app.post("/rave/overclock/extreme/on", (_, res) => {
  engine.setOverclock?.("turbo10");
  console.log("[RAVE] overclock EXTREME 10Hz");
  res.sendStatus(200);
});

app.post("/rave/overclock/insane/on", (_, res) => {
  engine.setOverclock?.("turbo12");
  console.log("[RAVE] overclock INSANE 12Hz");
  res.sendStatus(200);
});

app.post("/rave/overclock/hyper/on", (_, res) => {
  engine.setOverclock?.("turbo14");
  console.log("[RAVE] overclock HYPER 14Hz");
  res.sendStatus(200);
});

app.post("/rave/overclock/ludicrous/on", (_, res) => {
  engine.setOverclock?.("turbo16");
  console.log("[RAVE] overclock LUDICROUS 16Hz");
  res.sendStatus(200);
});

app.post("/rave/overclock/dev/:hz/on", (req, res) => {
  applyUnsafeOverclockHzRoute(req, res, req.params.hz);
});

app.post("/rave/overclock/dev/hz", (req, res) => {
  const value = req.query.value ?? req.query.hz ?? req.body?.value ?? req.body?.hz;
  applyUnsafeOverclockHzRoute(req, res, value);
});

app.get("/rave/overclock/tiers", (_, res) => {
  const safe = [
    { level: 0, hz: 2, tier: "normal", label: "SLOW 2Hz" },
    { level: 1, hz: 4, tier: "fast", label: "SLOW 4Hz" },
    { level: 2, hz: 6, tier: "turbo6", label: "DEFAULT 6Hz" },
    { level: 3, hz: 8, tier: "turbo8", label: "ULTRA 8Hz" },
    { level: 4, hz: 10, tier: "turbo10", label: "EXTREME 10Hz" },
    { level: 5, hz: 12, tier: "turbo12", label: "INSANE 12Hz" },
    { level: 6, hz: 14, tier: "turbo14", label: "HYPER 14Hz" },
    { level: 7, hz: 16, tier: "turbo16", label: "LUDICROUS 16Hz" }
  ];
  const unsafe = Object.values(UNSAFE_OVERCLOCK_TIERS).map(item => ({
    level: item.level,
    hz: item.hz,
    tier: item.tier,
    label: item.name,
    unsafe: true,
    route: `/rave/overclock/dev/${item.hz}/on?unsafe=true`
  }));

  res.json({
    ok: true,
    safe,
    unsafe,
    warning: "Unsafe tiers are manual-only and require explicit acknowledgement."
  });
});

/* ======================================================
   LEGACY / GENERIC OVERCLOCK (KEEP)
   ====================================================== */
app.post("/rave/overclock", (req, res) => {
  const enabled = req.query.enabled === "true";
  const tier = String(req.query.tier || "").toLowerCase();
  const unsafeTier = UNSAFE_OVERCLOCK_BY_TIER[tier];

  if (!enabled) {
    engine.setOverclock?.(0);
  } else if (unsafeTier) {
    if (!hasUnsafeOverclockAck(req)) {
      unsafeOverclockRejected(res, tier);
      return;
    }
    engine.setOverclock?.(unsafeTier.tier);
  } else if (tier === "turbo16" || tier === "x16" || tier === "ludicrous") {
    engine.setOverclock?.("turbo16");
  } else if (tier === "turbo14" || tier === "x14" || tier === "hyper") {
    engine.setOverclock?.("turbo14");
  } else if (tier === "turbo12" || tier === "x12" || tier === "insane") {
    engine.setOverclock?.("turbo12");
  } else if (tier === "turbo10" || tier === "x10" || tier === "extreme") {
    engine.setOverclock?.("turbo10");
  } else if (tier === "turbo8" || tier === "x8" || tier === "ultra") {
    engine.setOverclock?.("turbo8");
  } else if (tier === "turbo6" || tier === "turbo" || tier === "x6" || tier === "default") {
    engine.setOverclock?.("turbo6");
  } else {
    engine.setOverclock?.("fast");
  }

  res.sendStatus(200);
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

function setWizSceneSyncRoute(req, res, enabledFallback = null) {
  const raw = req.query.enabled
    ?? req.query.value
    ?? req.query.on
    ?? req.body?.enabled
    ?? req.body?.value
    ?? req.body?.on
    ?? enabledFallback;

  const hasInput = raw !== null && raw !== undefined && String(raw).trim() !== "";
  if (!hasInput) {
    res.status(400).json({
      ok: false,
      error: "missing enabled flag",
      allowed: ["true", "false"]
    });
    return;
  }

  const enabled = parseBoolean(raw, null);
  if (enabled === null) {
    res.status(400).json({
      ok: false,
      error: "invalid enabled flag",
      allowed: ["true", "false"]
    });
    return;
  }

  const next = engine.setWizSceneSync?.(enabled);
  console.log(`[RAVE] WiZ scene sync ${next ? "ON" : "OFF"}`);
  res.json({
    ok: true,
    enabled: Boolean(next),
    strategy: "hue_wiz_link"
  });
}

function getWizSceneSyncEnabled() {
  return Boolean(engine.getWizSceneSync?.() ?? engine.getTelemetry?.()?.wizSceneSync ?? true);
}

app.post("/rave/wiz/sync", (req, res) => setWizSceneSyncRoute(req, res));
app.post("/rave/wiz/sync/on", (req, res) => setWizSceneSyncRoute(req, res, true));
app.post("/rave/wiz/sync/off", (req, res) => setWizSceneSyncRoute(req, res, false));
app.get("/rave/wiz/sync", (_, res) => {
  const enabled = getWizSceneSyncEnabled();
  res.json({
    ok: true,
    enabled,
    strategy: "hue_wiz_link"
  });
});

// Generic alias for future multi-brand scene-link expansion.
app.post("/rave/scene/sync", (req, res) => setWizSceneSyncRoute(req, res));
app.post("/rave/scene/sync/on", (req, res) => setWizSceneSyncRoute(req, res, true));
app.post("/rave/scene/sync/off", (req, res) => setWizSceneSyncRoute(req, res, false));
app.get("/rave/scene/sync", (_, res) => {
  const enabled = getWizSceneSyncEnabled();
  res.json({
    ok: true,
    enabled,
    strategy: "hue_wiz_link",
    brands: ["hue", "wiz"]
  });
});

app.post("/rave/meta/auto", (req, res) => {
  const raw = String(
    req.query.enabled ?? req.query.on ?? req.query.value ?? ""
  ).toLowerCase().trim();

  let enabled;
  if (raw === "1" || raw === "true" || raw === "on" || raw === "yes") enabled = true;
  else if (raw === "0" || raw === "false" || raw === "off" || raw === "no") enabled = false;
  else {
    res.status(400).json({
      ok: false,
      error: "invalid enabled flag",
      allowed: ["true", "false"]
    });
    return;
  }

  const next = engine.setMetaAutoEnabled?.(enabled);
  console.log(`[RAVE] meta auto ${next ? "ON" : "OFF"}`);
  res.json({
    ok: true,
    enabled: Boolean(next)
  });
});

app.post("/rave/meta/auto/default", (_, res) => {
  engine.setOverclock?.(2);
  const next = engine.setMetaAutoEnabled?.(true);
  const telemetry = engine.getTelemetry?.() || {};
  const overclockLevel = Number(telemetry.overclockLevel || 2);
  console.log("[RAVE] meta auto DEFAULT 6HZ");
  res.json({
    ok: true,
    enabled: Boolean(next),
    overclockLevel
  });
});

app.post("/rave/meta/auto/on", (_, res) => {
  const next = engine.setMetaAutoEnabled?.(true);
  console.log("[RAVE] meta auto ON");
  res.json({ ok: true, enabled: Boolean(next) });
});

app.post("/rave/meta/auto/off", (_, res) => {
  const next = engine.setMetaAutoEnabled?.(false);
  console.log("[RAVE] meta auto OFF");
  res.json({ ok: true, enabled: Boolean(next) });
});

app.get("/rave/genres", (_, res) => {
  const genres = engine.getGenreCatalog?.() || [];
  res.json({
    ok: true,
    genres
  });
});

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

app.post("/mods/debug", modsConfigRateLimit, (req, res) => {
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

app.post("/mods/debug/clear", modsConfigRateLimit, (_, res) => {
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
  const normalized = path.posix.normalize(raw).replace(/^\/+/, "");
  if (!normalized || normalized === "." || normalized === "..") return "";
  if (path.posix.isAbsolute(normalized)) return "";
  if (normalized.startsWith("../") || normalized.includes("/../")) return "";
  return normalized;
}

function decodeImportedContentBase64(raw) {
  const input = String(raw || "").trim();
  if (!input) return null;
  try {
    return Buffer.from(input, "base64");
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

app.post("/mods/import", modsImportRateLimit, async (req, res) => {
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
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

app.post("/mods/config", modsConfigRateLimit, async (req, res) => {
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

app.post("/mods/reload", modsReloadRateLimit, async (_, res) => {
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

    let bridgeIp = String(payload.bridgeIp || "").trim();
    let bridgeId = String(payload.bridgeId || "").trim().toUpperCase();

    let discoveredBridge = null;
    if (!bridgeIp || !bridgeId) {
      const discovered = await HueSync.discover();
      const bridges = (Array.isArray(discovered) ? discovered : [])
        .map(normalizeBridgeDiscovery)
        .filter(b => b.ip);

      if (bridgeIp) {
        discoveredBridge = bridges.find(b => b.ip === bridgeIp) || null;
      } else {
        discoveredBridge = bridges[0] || null;
      }

      if (!bridgeIp && discoveredBridge) bridgeIp = discoveredBridge.ip;
      if (!bridgeId && discoveredBridge?.id) bridgeId = discoveredBridge.id;
    }

    if (!bridgeIp) {
      res.status(404).json({
        ok: false,
        paired: false,
        error: "no_bridge_found",
        message: "No Hue bridge discovered on local network"
      });
      return;
    }
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

    const bridgeConfig = await fetchHueBridgeConfigByIp(bridgeIp);
    if (!bridgeId) {
      bridgeId = String(bridgeConfig?.bridgeid || "").trim().toUpperCase();
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
      targets: {
        hue: { ...AUDIO_REACTIVITY_MAP_DEFAULT.targets.hue },
        wiz: { ...AUDIO_REACTIVITY_MAP_DEFAULT.targets.wiz },
        other: { ...AUDIO_REACTIVITY_MAP_DEFAULT.targets.other }
      }
    }
    : body;

  const config = patchAudioReactivityMapConfig(patch);
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

app.get("/fixtures", fixturesReadRateLimit, (_, res) => {
  refreshWizAdapters();
  syncStandaloneRuntime();
  const fixtures = fixtureRegistry.getFixtures();
  pruneConnectivityCache(fixtures);
  for (const fixture of fixtures) {
    queueFixtureConnectivityProbe(fixture, { force: false, logChanges: true }).catch(() => {});
  }
  const connectivity = getConnectivitySnapshotForFixtures(fixtures);
  res.json({
    fixtures,
    routes: fixtureRegistry.getIntentRoutes(),
    summary: fixtureRegistry.summary(),
    standalone: buildStandaloneSnapshotList(),
    connectivity,
    connectivitySummary: summarizeConnectivityResults(connectivity)
  });
});

app.get("/fixtures/connectivity", fixturesConnectivityRateLimit, (req, res) => {
  const fixtureId = String(req.query.id || "").trim();
  const brand = String(req.query.brand || "").trim().toLowerCase();
  const force = String(req.query.force || "").trim() === "1";
  const timeoutMs = Math.max(300, Math.min(5000, Number(req.query.timeoutMs) || 1200));

  const allFixtures = fixtureRegistry.getFixtures();
  pruneConnectivityCache(allFixtures);
  const fixtures = allFixtures.filter(fixture => {
    if (fixtureId && String(fixture?.id || "").trim() !== fixtureId) return false;
    if (brand && String(fixture?.brand || "").trim().toLowerCase() !== brand) return false;
    return true;
  });

  if (!fixtures.length) {
    res.status(404).json({ ok: false, error: "no fixtures matched" });
    return;
  }

  const task = force
    ? Promise.all(fixtures.map(fixture => queueFixtureConnectivityProbe(fixture, { force: true, timeoutMs, logChanges: true })))
    : Promise.resolve(getConnectivitySnapshotForFixtures(fixtures));

  task
    .then(results => {
      const normalized = (results || []).filter(Boolean);
      res.json({
        ok: true,
        results: normalized,
        summary: summarizeConnectivityResults(normalized)
      });
    })
    .catch(err => {
      res.status(500).json({
        ok: false,
        error: err.message || String(err)
      });
    });
});

app.post("/fixtures/connectivity/test", fixturesConnectivityRateLimit, async (req, res) => {
  const payload = req.body && typeof req.body === "object" ? req.body : {};
  const fixtureId = String(payload.id || "").trim();
  const brand = String(payload.brand || "").trim().toLowerCase();
  const timeoutMs = Math.max(300, Math.min(5000, Number(payload.timeoutMs) || 1200));

  const allFixtures = fixtureRegistry.getFixtures();
  pruneConnectivityCache(allFixtures);
  const fixtures = allFixtures.filter(fixture => {
    if (fixtureId && String(fixture?.id || "").trim() !== fixtureId) return false;
    if (brand && String(fixture?.brand || "").trim().toLowerCase() !== brand) return false;
    return true;
  });

  if (!fixtures.length) {
    res.status(404).json({ ok: false, error: "no fixtures matched" });
    return;
  }

  const results = await Promise.all(
    fixtures.map(fixture => queueFixtureConnectivityProbe(fixture, { force: true, timeoutMs, logChanges: true }))
  );

  const normalized = results.filter(Boolean);
  res.json({
    ok: true,
    results: normalized,
    summary: summarizeConnectivityResults(normalized)
  });
});

app.get("/fixtures/standalone", (_, res) => {
  res.json({
    ok: true,
    fixtures: buildStandaloneSnapshotList()
  });
});

app.get("/fixtures/standalone/custom", (_, res) => {
  const fixtures = buildStandaloneSnapshotList().filter(entry => entry?.customEnabled === true);
  res.json({
    ok: true,
    total: fixtures.length,
    fixtures
  });
});

app.get("/fixtures/standalone/fixture/:id", (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) {
    res.status(400).json({ ok: false, error: "missing fixture id" });
    return;
  }
  const fixture = buildStandaloneSnapshotById(id);
  if (!fixture) {
    res.status(404).json({ ok: false, error: "standalone fixture not found", id });
    return;
  }
  res.json({ ok: true, fixture });
});

app.post("/fixtures/standalone/state", standaloneStateRateLimit, async (req, res) => {
  const payload = req.body && typeof req.body === "object" ? req.body : {};
  const id = String(payload.id || "").trim();
  if (!id) {
    res.status(400).json({ ok: false, error: "missing fixture id" });
    return;
  }

  const patchSource = payload.state && typeof payload.state === "object"
    ? payload.state
    : payload;
  const patch = { ...patchSource };
  delete patch.id;

  const result = await applyStandaloneStateById(id, patch);
  const status = Number(result.status) || (result.ok ? 200 : 400);
  res.status(status).json(result);
});

app.post("/fixtures/standalone/state/batch", standaloneStateRateLimit, async (req, res) => {
  const payload = req.body && typeof req.body === "object" ? req.body : {};
  const rawUpdates = Array.isArray(payload.updates) ? payload.updates : null;
  let updates = [];

  if (rawUpdates) {
    updates = rawUpdates
      .map(item => {
        const id = String(item?.id || "").trim();
        const statePatch = item?.state && typeof item.state === "object"
          ? item.state
          : (item && typeof item === "object" ? item : {});
        return { id, state: statePatch };
      })
      .filter(item => item.id);
  } else {
    const ids = Array.isArray(payload.ids)
      ? payload.ids.map(item => String(item || "").trim()).filter(Boolean)
      : [];
    const statePatch = payload.state && typeof payload.state === "object"
      ? payload.state
      : {};
    updates = ids.map(id => ({ id, state: statePatch }));
  }

  if (!updates.length) {
    res.status(400).json({
      ok: false,
      error: "missing updates",
      expected: {
        updates: [{ id: "fixture-id", state: {} }],
        or: { ids: ["fixture-id"], state: {} }
      }
    });
    return;
  }

  const results = await Promise.all(
    updates.map(async item => {
      const result = await applyStandaloneStateById(item.id, item.state || {});
      return { id: item.id, ...result };
    })
  );

  const failed = results.filter(result => result?.ok !== true);
  res.status(failed.length ? 207 : 200).json({
    ok: failed.length === 0,
    total: results.length,
    failed: failed.length,
    results
  });
});

app.get("/fixtures/config", (_, res) => {
  res.json({
    ok: true,
    config: fixtureRegistry.getConfig()
  });
});

app.post("/fixtures/fixture", async (req, res) => {
  const payload = req.body && typeof req.body === "object" ? req.body : {};
  const replaceId = String(payload.replaceId ?? payload.originalId ?? "").trim();
  const fixturePayload = { ...payload };
  delete fixturePayload.replaceId;
  delete fixturePayload.originalId;
  const result = fixtureRegistry.upsertFixture(fixturePayload, { replaceId });
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }

  refreshWizAdapters();
  syncStandaloneRuntime();
  queueFixtureConnectivityProbe(result.fixture, { force: true, logChanges: true }).catch(() => {});
  await setHueTransportMode(hueTransport.desired);
  res.json({
    ok: true,
    fixture: result.fixture,
    summary: fixtureRegistry.summary()
  });
});

app.delete("/fixtures/fixture", async (req, res) => {
  const id = req.query.id || (req.body && req.body.id);
  const fixtureId = String(id || "").trim();
  const result = fixtureRegistry.removeFixture(id);
  if (!result.ok) {
    res.status(404).json(result);
    return;
  }

  if (fixtureId) {
    fixtureConnectivityCache.delete(fixtureId);
    fixtureConnectivityInFlight.delete(fixtureId);
  }
  refreshWizAdapters();
  syncStandaloneRuntime();
  await setHueTransportMode(hueTransport.desired);
  res.json({
    ok: true,
    summary: fixtureRegistry.summary()
  });
});

// Fallback for clients/environments where DELETE is blocked.
app.post("/fixtures/fixture/delete", async (req, res) => {
  const id = (req.body && req.body.id) || req.query.id;
  const fixtureId = String(id || "").trim();
  const result = fixtureRegistry.removeFixture(id);
  if (!result.ok) {
    res.status(404).json(result);
    return;
  }

  if (fixtureId) {
    fixtureConnectivityCache.delete(fixtureId);
    fixtureConnectivityInFlight.delete(fixtureId);
  }
  refreshWizAdapters();
  syncStandaloneRuntime();
  await setHueTransportMode(hueTransport.desired);
  res.json({
    ok: true,
    summary: fixtureRegistry.summary()
  });
});

app.post("/fixtures/route", async (req, res) => {
  const payload = req.body && typeof req.body === "object" ? req.body : {};
  const result = fixtureRegistry.setIntentRoute(payload.intent, payload.zone);
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }

  refreshWizAdapters();
  syncStandaloneRuntime();
  await setHueTransportMode(hueTransport.desired);
  res.json({
    ok: true,
    route: { intent: result.intent, zone: result.zone },
    routes: fixtureRegistry.getIntentRoutes(),
    summary: fixtureRegistry.summary()
  });
});

app.post("/fixtures/reload", async (_, res) => {
  const ok = fixtureRegistry.reload();
  refreshWizAdapters();
  syncStandaloneRuntime();
  const fixtures = fixtureRegistry.getFixtures();
  pruneConnectivityCache(fixtures);
  for (const fixture of fixtures) {
    queueFixtureConnectivityProbe(fixture, { force: false, logChanges: true }).catch(() => {});
  }
  await setHueTransportMode(hueTransport.desired);
  res.status(ok ? 200 : 500).json({
    ok,
    summary: fixtureRegistry.summary()
  });
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
  const rawPatch = patch && typeof patch === "object" ? patch : {};
  const merged = {
    ...getSystemConfigSnapshot()
  };
  if (Object.prototype.hasOwnProperty.call(rawPatch, "autoLaunchBrowser")) {
    merged.autoLaunchBrowser = rawPatch.autoLaunchBrowser;
  }
  if (Object.prototype.hasOwnProperty.call(rawPatch, "browserLaunchDelayMs")) {
    merged.browserLaunchDelayMs = rawPatch.browserLaunchDelayMs;
  }
  if (Object.prototype.hasOwnProperty.call(rawPatch, "unsafeExposeSensitiveLogs")) {
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
  if (Object.prototype.hasOwnProperty.call(rawPatch, "hueTransportPreference")) {
    merged.hueTransportPreference = rawPatch.hueTransportPreference;
  }

  systemConfigRuntime = writeSystemConfig(merged);
  setUnsafeExposeSensitiveLogsRuntime(Boolean(systemConfigRuntime?.unsafeExposeSensitiveLogs));
  return { ok: true, config: getSystemConfigSnapshot() };
}

app.get("/system/config", (_, res) => {
  res.json({
    ok: true,
    config: getSystemConfigSnapshot()
  });
});

app.post("/system/config", async (req, res) => {
  if (!isLoopbackRequest(req)) {
    res.status(403).json({
      ok: false,
      error: "forbidden",
      detail: "system config updates are allowed only from local loopback requests"
    });
    return;
  }

  const payload = req.body && typeof req.body === "object" ? req.body : {};
  const patched = patchSystemConfig(payload);
  if (!patched.ok) {
    res.status(Number(patched.status) || 400).json({
      ok: false,
      error: patched.error || "invalid_system_config_patch",
      detail: patched.detail || "invalid system config update"
    });
    return;
  }

  let transport = {
    desired: hueTransport.desired,
    active: hueTransport.active,
    fallbackReason: hueTransport.fallbackReason
  };
  try {
    const preferredHueMode = getPreferredHueTransportMode();
    transport = await settleWithTimeout(
      setHueTransportMode(preferredHueMode),
      preferredHueMode === HUE_TRANSPORT.ENTERTAINMENT ? 3200 : 2200,
      () => ({
        desired: hueTransport.desired,
        active: hueTransport.active,
        fallbackReason: preferredHueMode === HUE_TRANSPORT.ENTERTAINMENT
          ? "entertainment switch timeout"
          : "rest switch timeout"
      })
    );
    if (preferredHueMode === HUE_TRANSPORT.ENTERTAINMENT && transport.active !== HUE_TRANSPORT.ENTERTAINMENT) {
      scheduleHueEntertainmentRecovery("system_config");
    }
  } catch (err) {
    console.warn("[SYSTEM] hue transport preference apply failed:", err?.message || err);
  }

  res.json({
    ok: true,
    config: patched.config,
    transport
  });
});

app.post("/system/stop", (req, res) => {
  if (!isLoopbackRequest(req)) {
    res.status(403).json({
      ok: false,
      error: "forbidden",
      detail: "system stop is allowed only from local loopback requests"
    });
    return;
  }

  res.json({
    ok: true,
    message: "shutdown requested"
  });

  setTimeout(() => {
    shutdown("api_stop", 0).catch(err => {
      console.error("[SYS] api stop failed:", err.message || err);
      process.exit(1);
    });
  }, 120);
});

let httpServer = null;
let shutdownPromise = null;
let shutdownTimer = null;
let browserLaunchTimer = null;

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
      for (const id of standaloneTimers.keys()) {
        stopStandaloneTimer(id);
      }
      for (const id of standaloneWizAdapters.keys()) {
        closeStandaloneWizAdapter(id);
      }
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
      hueHttpAgent.destroy();
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

process.on("SIGINT", () => {
  shutdown("SIGINT", 0).catch(() => process.exit(1));
});
process.on("SIGTERM", () => {
  shutdown("SIGTERM", 0).catch(() => process.exit(1));
});
process.on("SIGBREAK", () => {
  shutdown("SIGBREAK", 0).catch(() => process.exit(1));
});
process.on("exit", () => {
  removePidFile();
});

// ======================================================
httpServer = app.listen(PORT, HOST, () => {
  writePidFile();
  console.log(`Hue bridge running on ${getBridgeBaseUrl()}`);
  scheduleBrowserAutoLaunch();
});
