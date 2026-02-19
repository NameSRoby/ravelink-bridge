// [TITLE] Module: core/mods/mod-loader.js
// [TITLE] Purpose: mod-loader

const fs = require("fs");
const path = require("path");

const DEFAULT_CONFIG = {
  enabled: [],
  order: [],
  disabled: []
};

const SUPPORTED_HOOKS = new Set([
  "onLoad",
  "onBoot",
  "onRaveStart",
  "onRaveStop",
  "onIntent",
  "onTelemetry",
  "onShutdown",
  "onUnload",
  "onHttp"
]);
const MOD_INFO_FILE_CANDIDATES = [
  "mod-info.txt",
  "mod-info.md",
  "description.txt",
  "about.txt",
  "README.txt",
  "README.md"
];
const MAX_MOD_INFO_FILE_BYTES = 128 * 1024;
const MAX_MOD_SUMMARY_CHARS = 320;
const DEFAULT_MOD_DEBUG_MAX_EVENTS = 800;
const DEFAULT_MOD_DEBUG_PAYLOAD_CHARS = 2400;
const DEFAULT_MOD_DEBUG_MAX_DEPTH = 5;
const DEFAULT_MOD_TELEMETRY_DEBUG_SAMPLE_MS = 4000;
const DEFAULT_MOD_TELEMETRY_NO_HANDLER_DEBUG_MS = 0;
const DEBUG_REDACT_KEY_RE = /(secret|token|password|passwd|clientkey|api[_-]?key|authorization|cookie|session|bearer)/i;

function cloneJsonSafe(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const raw = String(value).trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return fallback;
}

function parseIntRange(value, min, max, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function roundDebugNumber(value, digits = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const safeDigits = Math.max(0, Math.min(6, Math.round(Number(digits) || 0)));
  const factor = Math.pow(10, safeDigits);
  return Math.round(n * factor) / factor;
}

function sanitizeHookDebugPayload(hookName, payload = {}) {
  const hook = String(hookName || "").trim();
  const sourcePayload = payload && typeof payload === "object" ? payload : {};
  if (hook !== "onTelemetry") return sourcePayload;

  const telemetry = sourcePayload.telemetry && typeof sourcePayload.telemetry === "object"
    ? sourcePayload.telemetry
    : {};

  return {
    telemetry: {
      behavior: String(telemetry.behavior || ""),
      scene: String(telemetry.scene || ""),
      phrase: String(telemetry.phrase || ""),
      mode: String(telemetry.mode || ""),
      modeLock: String(telemetry.modeLock || ""),
      genre: String(telemetry.genre || ""),
      overclockLevel: Number.isFinite(Number(telemetry.overclockLevel))
        ? Math.round(Number(telemetry.overclockLevel))
        : 0,
      rms: roundDebugNumber(telemetry.rms, 4),
      energy: roundDebugNumber(telemetry.energy, 4),
      intensity: roundDebugNumber(telemetry.intensity, 4),
      bpm: roundDebugNumber(telemetry.bpm, 2),
      beat: Boolean(telemetry.beat),
      beatConfidence: roundDebugNumber(telemetry.beatConfidence, 4),
      drop: Boolean(telemetry.drop),
      audioTransient: roundDebugNumber(telemetry.audioTransient, 4),
      audioPeak: roundDebugNumber(telemetry.audioPeak, 4),
      audioFlux: roundDebugNumber(telemetry.audioFlux, 4)
    },
    __sanitized: true,
    __source: "onTelemetry"
  };
}

function nowHrNs() {
  try {
    return process.hrtime.bigint();
  } catch {
    return BigInt(Date.now()) * BigInt(1_000_000);
  }
}

function elapsedMsFromNs(startNs) {
  const base = typeof startNs === "bigint" ? startNs : nowHrNs();
  const deltaNs = nowHrNs() - base;
  const ms = Number(deltaNs) / 1_000_000;
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Number(ms.toFixed(3));
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => String(item || "").trim())
    .filter(Boolean);
}

function normalizeConfig(raw = {}) {
  return {
    enabled: normalizeStringArray(raw.enabled),
    order: normalizeStringArray(raw.order),
    disabled: normalizeStringArray(raw.disabled)
  };
}

function asErrorMessage(err) {
  if (!err) return "unknown error";
  if (err instanceof Error) return err.message || String(err);
  return String(err);
}

function summarizeDebugValue(
  value,
  options = {},
  depth = 0,
  seen = new WeakSet(),
  keyHint = ""
) {
  const maxDepth = parseIntRange(
    options.maxDepth,
    1,
    8,
    DEFAULT_MOD_DEBUG_MAX_DEPTH
  );
  const maxArray = parseIntRange(options.maxArray, 4, 128, 20);
  const maxKeys = parseIntRange(options.maxKeys, 4, 128, 28);
  const maxString = parseIntRange(options.maxString, 24, 2048, 260);

  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return String(value);
  if (typeof value === "string") {
    if (value.length <= maxString) return value;
    return `${value.slice(0, Math.max(0, maxString - 3))}...`;
  }
  if (typeof value === "function") {
    return `[function ${value.name || "anonymous"}]`;
  }
  if (value instanceof Date) {
    const ts = Number(value.getTime());
    return Number.isFinite(ts) ? value.toISOString() : String(value);
  }
  if (value instanceof Error) {
    const stack = String(value.stack || "").split(/\r?\n/).slice(0, 3).join(" | ");
    return {
      name: String(value.name || "Error"),
      message: asErrorMessage(value),
      stack: stack || ""
    };
  }
  if (typeof value !== "object") {
    return String(value);
  }

  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (depth >= maxDepth) {
    if (Array.isArray(value)) return `[array depth>${maxDepth}]`;
    return `[object depth>${maxDepth}]`;
  }

  if (Array.isArray(value)) {
    const out = [];
    const len = value.length;
    const limit = Math.min(len, maxArray);
    for (let i = 0; i < limit; i += 1) {
      out.push(summarizeDebugValue(value[i], options, depth + 1, seen, keyHint));
    }
    if (len > limit) {
      out.push(`[+${len - limit} more]`);
    }
    return out;
  }

  const keys = Object.keys(value);
  const out = {};
  const limit = Math.min(keys.length, maxKeys);
  for (let i = 0; i < limit; i += 1) {
    const key = keys[i];
    if (DEBUG_REDACT_KEY_RE.test(String(key || "")) || DEBUG_REDACT_KEY_RE.test(String(keyHint || ""))) {
      out[key] = "[redacted]";
      continue;
    }
    out[key] = summarizeDebugValue(value[key], options, depth + 1, seen, key);
  }
  if (keys.length > limit) {
    out.__truncatedKeys = keys.length - limit;
  }
  return out;
}

function sanitizeRelativeFilePath(value) {
  const raw = String(value || "").replace(/\\/g, "/").trim();
  if (!raw) return "";
  if (raw.includes("\0")) return "";
  // Block Windows ADS and drive-letter style paths.
  if (raw.includes(":")) return "";
  if (raw.length > 240) return "";

  const normalized = path.posix.normalize(raw);
  if (!normalized || normalized === "." || normalized === "..") return "";
  if (path.posix.isAbsolute(normalized)) return "";
  if (normalized.startsWith("../") || normalized.includes("/../")) return "";
  if (/^[a-zA-Z]:/.test(normalized)) return "";
  const parts = normalized.split("/");
  if (parts.some(part => !part || part.length > 100)) return "";
  return normalized;
}

function collapseWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateSummary(value, maxChars = MAX_MOD_SUMMARY_CHARS) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, Math.max(0, maxChars - 3)).trimEnd();
  return `${cut}...`;
}

function sanitizeInlineMarkdown(value) {
  return collapseWhitespace(
    String(value || "")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
      .replace(/[*_~`>|]/g, "")
  );
}

function summarizeText(rawText, fallback = "") {
  const lines = String(rawText || "").replace(/\r/g, "").split("\n");
  const chunks = [];
  let inCodeFence = false;

  for (let line of lines) {
    const trimmed = String(line || "").trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    line = trimmed
      .replace(/^#{1,6}\s+/, "")
      .replace(/^[-*+]\s+/, "")
      .replace(/^\d+\.\s+/, "")
      .replace(/^>\s*/, "");

    const normalized = sanitizeInlineMarkdown(line);
    if (!normalized) continue;

    chunks.push(normalized);
    if (chunks.join(" ").length >= MAX_MOD_SUMMARY_CHARS) {
      break;
    }
  }

  const summary = truncateSummary(collapseWhitespace(chunks.join(" ")));
  if (summary) return summary;
  return truncateSummary(sanitizeInlineMarkdown(fallback));
}

function tryReadModInfoFile(baseDir, relativePath) {
  const rel = sanitizeRelativeFilePath(relativePath);
  if (!rel) return "";

  const root = path.resolve(String(baseDir || ""));
  if (!root) return "";
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) return "";

  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    return "";
  }

  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_MOD_INFO_FILE_BYTES) {
    return "";
  }

  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return "";
  }
}

function resolveModTooltip(baseDir, manifest = {}) {
  const manifestDescription = String(manifest?.description || "").trim();
  const manifestSummary = summarizeText(manifestDescription, "");
  const requestedInfoFile = String(
    manifest?.infoFile ||
    manifest?.summaryFile ||
    manifest?.tooltipFile ||
    manifest?.hoverTextFile ||
    ""
  ).trim();

  const seen = new Set();
  const candidates = [requestedInfoFile, ...MOD_INFO_FILE_CANDIDATES];
  for (const candidate of candidates) {
    const rel = sanitizeRelativeFilePath(candidate);
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);

    const fileText = tryReadModInfoFile(baseDir, rel);
    if (!fileText) continue;

    const summary = summarizeText(fileText, manifestDescription);
    if (summary) {
      return { text: summary, source: rel };
    }
  }

  return {
    text: manifestSummary,
    source: manifestSummary ? "manifest.description" : ""
  };
}

function resolveModUiDescriptor(baseDir, manifest = {}) {
  const root = path.resolve(String(baseDir || ""));
  if (!root) return null;

  const rawUi = manifest?.ui;
  let requestedEntry = "";
  let requestedTitle = "";

  if (typeof rawUi === "string") {
    requestedEntry = rawUi;
  } else if (rawUi && typeof rawUi === "object") {
    requestedEntry = String(
      rawUi.entry ?? rawUi.path ?? rawUi.file ?? ""
    ).trim();
    requestedTitle = String(rawUi.title ?? rawUi.name ?? "").trim();
  }

  const candidateSet = new Set();
  const candidates = [
    requestedEntry,
    "ui/index.html",
    "ui.html",
    "mod-ui/index.html",
    "mod-ui.html"
  ]
    .map(sanitizeRelativeFilePath)
    .filter(Boolean)
    .filter(rel => {
      if (candidateSet.has(rel)) return false;
      candidateSet.add(rel);
      return true;
    });

  for (const rel of candidates) {
    const abs = path.resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + path.sep)) continue;
    if (!fs.existsSync(abs)) continue;
    if (path.extname(abs).toLowerCase() !== ".html") continue;

    return {
      entry: path.relative(root, abs).split(path.sep).join("/"),
      entryPath: abs,
      assetRoot: path.dirname(abs),
      title:
        requestedTitle ||
        String(manifest?.name || manifest?.id || "MOD UI").trim() ||
        "MOD UI"
    };
  }

  return null;
}

function clamp(value, min, max, fallback = min) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeRgbState(input = {}, fallback = {}) {
  const base = input && typeof input === "object" ? input : {};
  const fallbackState = fallback && typeof fallback === "object" ? fallback : {};
  const r = Math.round(clamp(base.r, 0, 255, clamp(fallbackState.r, 0, 255, 0)));
  const g = Math.round(clamp(base.g, 0, 255, clamp(fallbackState.g, 0, 255, 0)));
  const b = Math.round(clamp(base.b, 0, 255, clamp(fallbackState.b, 0, 255, 0)));
  const dimming = Math.round(clamp(base.dimming, 1, 100, clamp(fallbackState.dimming, 1, 100, 100)));
  return { r, g, b, dimming };
}

function buildFixtureFilter(filters = {}) {
  const brand = String(filters.brand || "").trim().toLowerCase();
  const zone = String(filters.zone || "").trim().toLowerCase();
  const mode = String(filters.mode || "").trim().toLowerCase();
  const enabledOnly = filters.enabledOnly !== false;
  const configuredOnly = Boolean(filters.requireConfigured);

  return fixture => {
    if (!fixture || typeof fixture !== "object") return false;
    if (enabledOnly && fixture.enabled === false) return false;
    if (brand && String(fixture.brand || "").trim().toLowerCase() !== brand) return false;
    if (zone && String(fixture.zone || "").trim().toLowerCase() !== zone) return false;

    if (mode === "engine" && fixture.engineEnabled !== true) return false;
    if (mode === "twitch" && fixture.twitchEnabled !== true) return false;
    if (mode === "custom" && fixture.customEnabled !== true) return false;

    if (!configuredOnly) return true;
    if (fixture.brand === "hue") {
      return Boolean(fixture.bridgeIp) && Boolean(fixture.username) && Number(fixture.lightId) > 0;
    }
    if (fixture.brand === "wiz") {
      return Boolean(fixture.ip);
    }
    return true;
  };
}

function createStateGate(defaults = {}) {
  const lastByKey = new Map();
  const baseMinIntervalMs = Math.max(0, Math.round(Number(defaults.minIntervalMs) || 0));
  const baseMinColorDelta = Math.max(0, Math.round(Number(defaults.minColorDelta) || 0));
  const baseMinDimmingDelta = Math.max(0, Math.round(Number(defaults.minDimmingDelta) || 0));

  function reset(key = "") {
    const k = String(key || "").trim();
    if (!k) {
      lastByKey.clear();
      return;
    }
    lastByKey.delete(k);
  }

  function shouldSend(key, state, overrides = {}) {
    const k = String(key || "").trim();
    if (!k) return false;

    const nowMs = Number(overrides.nowMs || Date.now());
    const next = normalizeRgbState(state);
    const minIntervalMs = Math.max(
      0,
      Math.round(Number(overrides.minIntervalMs ?? baseMinIntervalMs) || 0)
    );
    const minColorDelta = Math.max(
      0,
      Math.round(Number(overrides.minColorDelta ?? baseMinColorDelta) || 0)
    );
    const minDimmingDelta = Math.max(
      0,
      Math.round(Number(overrides.minDimmingDelta ?? baseMinDimmingDelta) || 0)
    );

    const previous = lastByKey.get(k);
    if (previous) {
      const elapsed = nowMs - previous.at;
      if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < minIntervalMs) {
        return false;
      }

      const colorDelta = Math.max(
        Math.abs(next.r - previous.state.r),
        Math.abs(next.g - previous.state.g),
        Math.abs(next.b - previous.state.b)
      );
      const dimmingDelta = Math.abs(next.dimming - previous.state.dimming);
      if (colorDelta < minColorDelta && dimmingDelta < minDimmingDelta) {
        return false;
      }
    }

    lastByKey.set(k, {
      at: nowMs,
      state: next
    });
    return true;
  }

  function snapshot() {
    const out = {};
    for (const [key, value] of lastByKey.entries()) {
      out[key] = {
        at: value.at,
        state: { ...value.state }
      };
    }
    return out;
  }

  return {
    shouldSend,
    reset,
    snapshot
  };
}

module.exports = function createModLoader(options = {}) {
  const rootDir = path.resolve(String(options.rootDir || process.cwd()));
  const modsDir = path.resolve(String(options.modsDir || path.join(rootDir, "mods")));
  const configPath = path.resolve(String(options.configPath || path.join(modsDir, "mods.config.json")));
  const actions = options.actions && typeof options.actions === "object"
    ? options.actions
    : {};
  const logger = options.log || console;
  const initialDebugEnabled = parseBool(
    options.debug ?? process.env.RAVELINK_MOD_DEBUG,
    false
  );
  const initialDebugMaxEvents = parseIntRange(
    options.debugMaxEvents ?? process.env.RAVELINK_MOD_DEBUG_MAX_EVENTS,
    100,
    5000,
    DEFAULT_MOD_DEBUG_MAX_EVENTS
  );
  const initialDebugPayloadChars = parseIntRange(
    options.debugPayloadChars ?? process.env.RAVELINK_MOD_DEBUG_PAYLOAD_CHARS,
    300,
    20000,
    DEFAULT_MOD_DEBUG_PAYLOAD_CHARS
  );
  const initialDebugMaxDepth = parseIntRange(
    options.debugMaxDepth ?? process.env.RAVELINK_MOD_DEBUG_MAX_DEPTH,
    2,
    8,
    DEFAULT_MOD_DEBUG_MAX_DEPTH
  );
  const initialTelemetryDebugSampleMs = parseIntRange(
    options.telemetryDebugSampleMs ?? process.env.RAVELINK_MOD_TELEMETRY_DEBUG_SAMPLE_MS,
    250,
    60000,
    DEFAULT_MOD_TELEMETRY_DEBUG_SAMPLE_MS
  );
  const initialTelemetryNoHandlerDebugMs = parseIntRange(
    options.telemetryNoHandlerDebugMs ?? process.env.RAVELINK_MOD_TELEMETRY_NO_HANDLER_DEBUG_MS,
    0,
    300000,
    DEFAULT_MOD_TELEMETRY_NO_HANDLER_DEBUG_MS
  );

  let activeConfig = normalizeConfig(DEFAULT_CONFIG);
  let entries = [];
  let loadedAt = 0;
  let debugEnabled = initialDebugEnabled;
  let debugMaxEvents = initialDebugMaxEvents;
  let debugPayloadChars = initialDebugPayloadChars;
  let debugMaxDepth = initialDebugMaxDepth;
  let telemetryDebugSampleMs = initialTelemetryDebugSampleMs;
  let telemetryNoHandlerDebugMs = initialTelemetryNoHandlerDebugMs;
  let debugSequence = 0;
  const debugEvents = [];
  const hookStats = Object.create(null);
  const hookDebugLastAt = Object.create(null);
  const hookNoHandlerDebugLastAt = Object.create(null);

  const debugCounters = {
    loadAttempts: 0,
    loadFailures: 0,
    hookCalls: 0,
    hookFailures: 0,
    httpCalls: 0,
    httpFailures: 0
  };

  function getDebugSerializationOptions() {
    return {
      maxDepth: debugMaxDepth,
      maxArray: 22,
      maxKeys: 32,
      maxString: Math.max(120, Math.min(1200, Math.round(debugPayloadChars / 8)))
    };
  }

  function getDefaultDebugExplanation(kind, detail = {}) {
    const hook = String(detail?.hook || "").trim();
    const modId = String(detail?.modId || detail?.id || "").trim();
    if (kind === "mods.hook.call") {
      return `Calling hook${hook ? ` '${hook}'` : ""}${modId ? ` on mod '${modId}'` : ""}.`;
    }
    if (kind === "mods.hook.ok") {
      return `Hook${hook ? ` '${hook}'` : ""}${modId ? ` for mod '${modId}'` : ""} completed successfully.`;
    }
    if (kind === "mods.hook.error") {
      return `Hook${hook ? ` '${hook}'` : ""}${modId ? ` for mod '${modId}'` : ""} failed and returned an error.`;
    }
    if (kind === "mods.hook.batch.start") {
      return `Starting hook batch${hook ? ` for '${hook}'` : ""}.`;
    }
    if (kind === "mods.hook.batch.done") {
      return `Finished hook batch${hook ? ` for '${hook}'` : ""}.`;
    }
    if (kind === "mods.hook.batch.skipped") {
      return `Skipped hook batch${hook ? ` for '${hook}'` : ""} because no loaded handlers are registered.`;
    }
    if (kind === "mods.instantiate.start") {
      return `Loading mod module${modId ? ` '${modId}'` : ""} and preparing exported hooks.`;
    }
    if (kind === "mods.instantiate.ok") {
      return `Mod${modId ? ` '${modId}'` : ""} loaded and registered its available hooks.`;
    }
    if (kind === "mods.instantiate.failed") {
      return `Mod${modId ? ` '${modId}'` : ""} failed during load/initialization.`;
    }
    if (kind === "mods.load.start") {
      return "Starting full mod loader cycle (config read, discover, instantiate).";
    }
    if (kind === "mods.load.done") {
      return "Completed mod loader cycle and refreshed loaded mod snapshot.";
    }
    if (kind === "mods.config.loaded") {
      return "Read and normalized mods.config.json from disk.";
    }
    if (kind === "mods.config.invalid") {
      return "mods.config.json could not be parsed and defaults were applied.";
    }
    if (kind === "mods.http.call") {
      return "Forwarding incoming mod HTTP request to target mod onHttp handler.";
    }
    if (kind === "mods.http.ok") {
      return "Mod HTTP handler returned a valid response.";
    }
    if (kind === "mods.http.error") {
      return "Mod HTTP handler threw an exception while processing request.";
    }
    return "Detailed mod loader diagnostic event.";
  }

  function getDebugSectionTitle(kind = "") {
    const key = String(kind || "").trim().toLowerCase();
    if (key.startsWith("mods.config.")) return "CONFIG";
    if (key.startsWith("mods.discover.")) return "DISCOVERY";
    if (key.startsWith("mods.instantiate.") || key.startsWith("mods.load.") || key.startsWith("mods.teardown.")) {
      return "LIFECYCLE";
    }
    if (key.startsWith("mods.hook.")) return "HOOKS";
    if (key.startsWith("mods.http.")) return "HTTP";
    if (key.startsWith("debug.")) return "DEBUG";
    if (key.startsWith("mod.user.")) return "MOD USER";
    return "GENERAL";
  }

  function shouldLogHookBatchDebug(hookName, hasHandlers = true) {
    const hook = String(hookName || "").trim();
    if (hook !== "onTelemetry") return true;

    const intervalMs = hasHandlers
      ? telemetryDebugSampleMs
      : telemetryNoHandlerDebugMs;
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return false;

    const now = Date.now();
    const map = hasHandlers ? hookDebugLastAt : hookNoHandlerDebugLastAt;
    const lastAt = Number(map[hook] || 0);
    if (Number.isFinite(lastAt) && (now - lastAt) < intervalMs) {
      return false;
    }
    map[hook] = now;
    return true;
  }

  function appendDebugEvent(kind, detail = {}, options = {}) {
    const explanation = String(
      options.explanation || getDefaultDebugExplanation(kind, detail)
    ).trim();
    const event = {
      seq: ++debugSequence,
      at: Date.now(),
      atIso: new Date().toISOString(),
      uptimeMs: Number((process.uptime?.() || 0).toFixed(3)) * 1000,
      kind: String(kind || "event").trim() || "event",
      sectionTitle: getDebugSectionTitle(kind),
      explanation,
      detail: summarizeDebugValue(
        detail,
        getDebugSerializationOptions()
      )
    };

    debugEvents.push(event);
    while (debugEvents.length > debugMaxEvents) {
      debugEvents.shift();
    }

    if (!debugEnabled) return event;

    const level = String(options.level || "log").toLowerCase();
    const logFn = typeof logger?.[level] === "function"
      ? logger[level].bind(logger)
      : (typeof logger?.log === "function" ? logger.log.bind(logger) : console.log);

    let rendered = "";
    try {
      rendered = JSON.stringify(event);
    } catch {
      rendered = `{"seq":${event.seq},"kind":"${event.kind}"}`;
    }
    if (rendered.length > debugPayloadChars) {
      rendered = `${rendered.slice(0, Math.max(0, debugPayloadChars - 12))}...\"truncated\"`;
    }
    logFn(`[MODS][DBG] ${rendered}`);
    return event;
  }

  function clearDebugEvents() {
    debugEvents.length = 0;
  }

  function recordHookStat(hookName, modId, durationMs, ok, errorMessage = "") {
    const key = String(hookName || "").trim() || "unknown";
    if (!hookStats[key]) {
      hookStats[key] = {
        invoked: 0,
        failed: 0,
        totalDurationMs: 0,
        maxDurationMs: 0,
        lastDurationMs: 0,
        lastAt: 0,
        lastModId: "",
        lastError: ""
      };
    }
    const stat = hookStats[key];
    stat.invoked += 1;
    if (!ok) stat.failed += 1;
    stat.totalDurationMs += Math.max(0, Number(durationMs) || 0);
    stat.maxDurationMs = Math.max(stat.maxDurationMs, Math.max(0, Number(durationMs) || 0));
    stat.lastDurationMs = Math.max(0, Number(durationMs) || 0);
    stat.lastAt = Date.now();
    stat.lastModId = String(modId || "");
    stat.lastError = ok ? "" : String(errorMessage || "");
  }

  function getDebugDiagnostics(options = {}) {
    const opts = options && typeof options === "object" ? options : {};
    const includeEvents = opts.includeEvents !== false;
    const includeHookStats = opts.includeHookStats !== false;
    const limit = parseIntRange(opts.limit, 0, 5000, Math.min(debugEvents.length, 400));
    const sinceSeq = parseIntRange(opts.sinceSeq, 0, Number.MAX_SAFE_INTEGER, 0);
    const filtered = includeEvents
      ? debugEvents
        .filter(event => Number(event.seq) > sinceSeq)
        .slice(limit > 0 ? -limit : undefined)
      : [];

    const statsOut = {};
    if (includeHookStats) {
      for (const [hook, stat] of Object.entries(hookStats)) {
        const invoked = Number(stat.invoked || 0);
        statsOut[hook] = {
          invoked,
          failed: Number(stat.failed || 0),
          avgDurationMs: invoked > 0 ? Number((stat.totalDurationMs / invoked).toFixed(2)) : 0,
          maxDurationMs: Number(stat.maxDurationMs || 0),
          lastDurationMs: Number(stat.lastDurationMs || 0),
          lastAt: Number(stat.lastAt || 0),
          lastModId: String(stat.lastModId || ""),
          lastError: String(stat.lastError || "")
        };
      }
    }

    return {
      enabled: debugEnabled,
      maxEvents: debugMaxEvents,
      maxPayloadChars: debugPayloadChars,
      maxDepth: debugMaxDepth,
      telemetryDebugSampleMs,
      telemetryNoHandlerDebugMs,
      sequence: debugSequence,
      counters: { ...debugCounters },
      hookStats: statsOut,
      events: filtered
    };
  }

  function setDebugConfig(patch = {}) {
    const next = patch && typeof patch === "object" ? patch : {};
    if (Object.prototype.hasOwnProperty.call(next, "enabled")) {
      debugEnabled = parseBool(next.enabled, debugEnabled);
    }
    if (Object.prototype.hasOwnProperty.call(next, "maxEvents")) {
      debugMaxEvents = parseIntRange(next.maxEvents, 100, 5000, debugMaxEvents);
      while (debugEvents.length > debugMaxEvents) {
        debugEvents.shift();
      }
    }
    if (Object.prototype.hasOwnProperty.call(next, "maxPayloadChars")) {
      debugPayloadChars = parseIntRange(next.maxPayloadChars, 300, 20000, debugPayloadChars);
    }
    if (Object.prototype.hasOwnProperty.call(next, "maxDepth")) {
      debugMaxDepth = parseIntRange(next.maxDepth, 2, 8, debugMaxDepth);
    }
    if (Object.prototype.hasOwnProperty.call(next, "telemetryDebugSampleMs")) {
      telemetryDebugSampleMs = parseIntRange(
        next.telemetryDebugSampleMs,
        250,
        60000,
        telemetryDebugSampleMs
      );
    }
    if (Object.prototype.hasOwnProperty.call(next, "telemetryNoHandlerDebugMs")) {
      telemetryNoHandlerDebugMs = parseIntRange(
        next.telemetryNoHandlerDebugMs,
        0,
        300000,
        telemetryNoHandlerDebugMs
      );
    }
    if (next.clear === true) {
      clearDebugEvents();
    }

    appendDebugEvent("debug.config.updated", {
      enabled: debugEnabled,
      maxEvents: debugMaxEvents,
      maxPayloadChars: debugPayloadChars,
      maxDepth: debugMaxDepth,
      telemetryDebugSampleMs,
      telemetryNoHandlerDebugMs,
      cleared: next.clear === true
    });

    return getDebugDiagnostics({ includeEvents: false });
  }

  function ensureConfigFile() {
    try {
      if (!fs.existsSync(modsDir)) {
        fs.mkdirSync(modsDir, { recursive: true });
        appendDebugEvent("mods.config.dir.created", { modsDir });
      }
      if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf8");
        appendDebugEvent("mods.config.file.created", { configPath });
      }
    } catch (err) {
      logger.warn?.("[MODS] failed to prepare config file:", asErrorMessage(err));
      appendDebugEvent(
        "mods.config.prepare.failed",
        {
          configPath,
          error: asErrorMessage(err)
        },
        { level: "warn" }
      );
    }
  }

  function loadConfig() {
    ensureConfigFile();
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
      activeConfig = normalizeConfig(raw);
      appendDebugEvent("mods.config.loaded", {
        configPath,
        enabledCount: activeConfig.enabled.length,
        orderCount: activeConfig.order.length,
        disabledCount: activeConfig.disabled.length
      });
    } catch (err) {
      logger.warn?.("[MODS] invalid config, using defaults:", asErrorMessage(err));
      activeConfig = normalizeConfig(DEFAULT_CONFIG);
      appendDebugEvent(
        "mods.config.invalid",
        {
          configPath,
          error: asErrorMessage(err)
        },
        { level: "warn" }
      );
    }
    return activeConfig;
  }

  function discoverEntries() {
    if (!fs.existsSync(modsDir)) {
      appendDebugEvent("mods.discover.empty", { reason: "modsDir missing", modsDir });
      return [];
    }

    const config = activeConfig || loadConfig();
    const enabledSet = new Set(config.enabled);
    const disabledSet = new Set(config.disabled);
    const orderIndex = new Map(config.order.map((id, idx) => [id, idx]));

    const discovered = [];
    const topLevel = fs.readdirSync(modsDir, { withFileTypes: true });
    appendDebugEvent("mods.discover.start", {
      modsDir,
      entries: topLevel.length
    });
    for (const dirent of topLevel) {
      if (!dirent.isDirectory()) continue;
      if (dirent.name.startsWith(".")) continue;

      const baseDir = path.join(modsDir, dirent.name);
      const manifestPath = path.join(baseDir, "mod.json");
      if (!fs.existsSync(manifestPath)) continue;

      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      } catch (err) {
        appendDebugEvent(
          "mods.discover.invalid_manifest",
          {
            id: dirent.name,
            manifestPath,
            error: asErrorMessage(err)
          },
          { level: "warn" }
        );
        discovered.push({
          id: dirent.name,
          name: dirent.name,
          version: "0.0.0",
          description: "",
          tooltip: "",
          tooltipSource: "",
          dir: baseDir,
          manifestPath,
          enabled: false,
          loaded: false,
          instance: null,
          error: `invalid mod.json: ${asErrorMessage(err)}`,
          hooks: [],
          modulePath: "",
          ui: null
        });
        continue;
      }

      const id = String(manifest.id || dirent.name).trim() || dirent.name;
      const name = String(manifest.name || id).trim() || id;
      const version = String(manifest.version || "0.0.0").trim() || "0.0.0";
      const description = String(manifest.description || "").trim();
      const tooltip = resolveModTooltip(baseDir, manifest);
      const requestedMainFile = String(manifest.main || "index.js").trim() || "index.js";
      const mainFile = sanitizeRelativeFilePath(requestedMainFile);
      const modulePath = mainFile ? path.resolve(baseDir, mainFile) : "";
      const modulePathAllowed = Boolean(
        modulePath &&
        (modulePath === baseDir || modulePath.startsWith(baseDir + path.sep))
      );
      const modulePathError = !modulePathAllowed
        ? "invalid mod entry path (manifest.main)"
        : "";
      const ui = resolveModUiDescriptor(baseDir, manifest);
      const enabledByConfig = enabledSet.size > 0 ? enabledSet.has(id) : Boolean(manifest.enabled);
      const enabled = enabledByConfig && !disabledSet.has(id) && !modulePathError;

      discovered.push({
        id,
        name,
        version,
        description,
        tooltip: tooltip.text,
        tooltipSource: tooltip.source,
        dir: baseDir,
        manifestPath,
        manifest,
        modulePath,
        enabled,
        loaded: false,
        instance: null,
        error: modulePathError || null,
        hooks: [],
        ui,
        order: orderIndex.has(id) ? orderIndex.get(id) : Number.MAX_SAFE_INTEGER
      });

      appendDebugEvent("mods.discover.entry", {
        id,
        enabled,
        modulePath,
        modulePathError: modulePathError || "",
        hooksDeclared: Array.isArray(manifest.hooks) ? manifest.hooks.length : undefined,
        hasUi: Boolean(ui)
      });
    }

    discovered.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.id.localeCompare(b.id);
    });

    appendDebugEvent("mods.discover.done", {
      total: discovered.length,
      enabled: discovered.filter(entry => entry.enabled).length
    });
    return discovered;
  }

  function makeApiFor(entry) {
    const prefix = `[MOD:${entry.id}]`;
    return {
      id: entry.id,
      manifest: cloneJsonSafe(entry.manifest || {}, {}),
      log(...args) {
        logger.log(prefix, ...args);
      },
      warn(...args) {
        logger.warn?.(prefix, ...args);
      },
      error(...args) {
        logger.error?.(prefix, ...args);
      },
      debug(eventName = "mod.debug", detail = {}) {
        appendDebugEvent("mod.user.debug", {
          modId: entry.id,
          modName: entry.name,
          eventName: String(eventName || "").trim() || "mod.debug",
          detail
        });
      },
      now() {
        return Date.now();
      },
      enqueueHue(state, zone = "default", options = {}) {
        return actions.enqueueHue?.(state, zone, options);
      },
      enqueueWiz(state, zone = "default", options = {}) {
        return actions.enqueueWiz?.(state, zone, options);
      },
      getEngineTelemetry() {
        return cloneJsonSafe(actions.getEngineTelemetry?.(), null);
      },
      getHueTelemetry() {
        return cloneJsonSafe(actions.getHueTelemetry?.(), null);
      },
      getWizTelemetry() {
        return cloneJsonSafe(actions.getWizTelemetry?.(), null);
      },
      getAudioTelemetry() {
        return cloneJsonSafe(actions.getAudioTelemetry?.(), null);
      },
      getFixtures() {
        return cloneJsonSafe(actions.getFixtures?.(), []);
      },
      getFixturesBy(filters = {}) {
        const safeFilters = cloneJsonSafe(filters, {});
        const fromActions = actions.getFixturesBy?.(safeFilters);
        if (Array.isArray(fromActions)) {
          return cloneJsonSafe(fromActions, []);
        }
        const fixtures = cloneJsonSafe(actions.getFixtures?.(), []);
        const filter = buildFixtureFilter(safeFilters);
        return fixtures.filter(filter);
      },
      getFixtureRoutes() {
        return cloneJsonSafe(actions.getFixtureRoutes?.(), {});
      },
      getIntentZones(intent, options = {}) {
        const zones = actions.getIntentZones?.(
          cloneJsonSafe(intent, {}),
          cloneJsonSafe(options, {})
        );
        if (Array.isArray(zones)) {
          return cloneJsonSafe(zones, []);
        }
        return [];
      },
      getStandaloneFixtures() {
        return cloneJsonSafe(actions.getStandaloneFixtures?.(), []);
      },
      async applyStandaloneState(id, statePatch = {}) {
        return cloneJsonSafe(
          await Promise.resolve(
            actions.applyStandaloneState?.(
              String(id || ""),
              cloneJsonSafe(statePatch, {})
            )
          ),
          { ok: false, error: "standalone apply unavailable" }
        );
      },
      getColorCommandConfig() {
        return cloneJsonSafe(actions.getColorCommandConfig?.(), {
          config: null,
          capabilities: null
        });
      },
      setColorCommandConfig(patch = {}) {
        return cloneJsonSafe(
          actions.setColorCommandConfig?.(cloneJsonSafe(patch, {})),
          { config: null, capabilities: null }
        );
      },
      normalizeRgbState(state, fallback = {}) {
        return normalizeRgbState(state, fallback);
      },
      createStateGate(defaults = {}) {
        return createStateGate(defaults);
      },
      getState() {
        return cloneJsonSafe(actions.getState?.(), null);
      }
    };
  }

  async function invokeSingle(entry, hookName, payload = {}, options = {}) {
    if (!entry || !entry.loaded || !entry.instance) {
      return { ok: false, skipped: true, reason: "entry_not_loaded", durationMs: 0 };
    }
    const handler = entry.instance[hookName];
    if (typeof handler !== "function") {
      return { ok: false, skipped: true, reason: "handler_missing", durationMs: 0 };
    }

    const opts = options && typeof options === "object" ? options : {};
    const logLifecycleDebug = opts.logLifecycleDebug !== false;
    const debugPayload = Object.prototype.hasOwnProperty.call(opts, "debugPayload")
      ? opts.debugPayload
      : sanitizeHookDebugPayload(hookName, payload);

    const startedAtNs = nowHrNs();
    if (logLifecycleDebug) {
      appendDebugEvent("mods.hook.call", {
        hook: hookName,
        modId: entry.id,
        modName: entry.name,
        payload: debugPayload
      });
    }

    const api = makeApiFor(entry);
    const context = {
      hook: hookName,
      mod: {
        id: entry.id,
        name: entry.name,
        version: entry.version
      },
      api,
      now: Date.now()
    };

    debugCounters.hookCalls += 1;
    try {
      const result = await Promise.resolve(handler(payload, context));
      const durationMs = elapsedMsFromNs(startedAtNs);
      recordHookStat(hookName, entry.id, durationMs, true);
      if (logLifecycleDebug) {
        appendDebugEvent("mods.hook.ok", {
          hook: hookName,
          modId: entry.id,
          durationMs,
          result
        });
      }
      return { ok: true, skipped: false, durationMs, result };
    } catch (err) {
      const message = asErrorMessage(err);
      const durationMs = elapsedMsFromNs(startedAtNs);
      debugCounters.hookFailures += 1;
      recordHookStat(hookName, entry.id, durationMs, false, message);
      appendDebugEvent(
        "mods.hook.error",
        {
          hook: hookName,
          modId: entry.id,
          durationMs,
          error: message
        },
        { level: "warn" }
      );
      throw err;
    }
  }

  async function teardown(reason = "reload") {
    appendDebugEvent("mods.teardown.start", { reason, loadedMods: entries.filter(entry => entry.loaded).length });
    for (const entry of entries) {
      if (!entry.loaded || !entry.instance) continue;
      try {
        await invokeSingle(entry, "onUnload", { reason });
      } catch (err) {
        logger.warn?.(`[MODS] ${entry.id} onUnload failed: ${asErrorMessage(err)}`);
        appendDebugEvent(
          "mods.teardown.unload_failed",
          {
            modId: entry.id,
            reason,
            error: asErrorMessage(err)
          },
          { level: "warn" }
        );
      }
    }
    appendDebugEvent("mods.teardown.done", { reason });
  }

  async function instantiate(entry) {
    if (!entry.enabled) return entry;

    if (!entry.modulePath || !fs.existsSync(entry.modulePath)) {
      entry.loaded = false;
      entry.error = "mod entry file not found";
      appendDebugEvent(
        "mods.instantiate.missing_entry",
        {
          modId: entry.id,
          modulePath: entry.modulePath
        },
        { level: "warn" }
      );
      return entry;
    }

    const startedAtNs = nowHrNs();
    appendDebugEvent("mods.instantiate.start", {
      modId: entry.id,
      modulePath: entry.modulePath
    });

    try {
      const resolved = require.resolve(entry.modulePath);
      delete require.cache[resolved];
      const loaded = require(resolved);
      const instance = typeof loaded === "function"
        ? loaded(makeApiFor(entry), cloneJsonSafe(entry.manifest || {}, {}))
        : loaded;

      if (!instance || typeof instance !== "object") {
        throw new Error("mod must export an object or factory returning an object");
      }

      entry.instance = instance;
      entry.loaded = true;
      entry.error = null;
      entry.hooks = Object.keys(instance).filter(name => SUPPORTED_HOOKS.has(name));

      await invokeSingle(entry, "onLoad", {
        loadedAt: Date.now()
      });
      appendDebugEvent("mods.instantiate.ok", {
        modId: entry.id,
        durationMs: elapsedMsFromNs(startedAtNs),
        hooks: entry.hooks
      });
    } catch (err) {
      entry.loaded = false;
      entry.instance = null;
      entry.error = asErrorMessage(err);
      entry.hooks = [];
      appendDebugEvent(
        "mods.instantiate.failed",
        {
          modId: entry.id,
          durationMs: elapsedMsFromNs(startedAtNs),
          error: entry.error
        },
        { level: "warn" }
      );
    }

    return entry;
  }

  async function load() {
    debugCounters.loadAttempts += 1;
    const startedAtNs = nowHrNs();
    appendDebugEvent("mods.load.start", {
      attempt: debugCounters.loadAttempts
    });

    await teardown("reload");
    loadConfig();
    entries = discoverEntries();

    for (const entry of entries) {
      await instantiate(entry);
      if (entry.enabled && entry.loaded) {
        logger.log?.(`[MODS] loaded ${entry.id}@${entry.version}`);
      } else if (entry.enabled && !entry.loaded) {
        logger.warn?.(`[MODS] failed ${entry.id}: ${entry.error}`);
        debugCounters.loadFailures += 1;
      }
    }

    loadedAt = Date.now();
    appendDebugEvent("mods.load.done", {
      durationMs: elapsedMsFromNs(startedAtNs),
      total: entries.length,
      loaded: entries.filter(entry => entry.loaded).length,
      failed: entries.filter(entry => entry.enabled && !entry.loaded).length
    });
    return list();
  }

  async function reload() {
    return load();
  }

  function list() {
    const loaded = entries.filter(entry => entry.loaded).length;
    return {
      ok: true,
      modsDir,
      configPath,
      loadedAt,
      total: entries.length,
      loaded,
      debug: getDebugDiagnostics({ includeEvents: false }),
      config: cloneJsonSafe(activeConfig, normalizeConfig(DEFAULT_CONFIG)),
      mods: entries.map(entry => ({
        id: entry.id,
        name: entry.name,
        version: entry.version,
        description: entry.description,
        tooltip: entry.tooltip || "",
        tooltipSource: entry.tooltipSource || "",
        dir: entry.dir,
        enabled: Boolean(entry.enabled),
        loaded: Boolean(entry.loaded),
        hooks: [...entry.hooks],
        ui: entry.ui
          ? {
              entry: entry.ui.entry,
              title: entry.ui.title
            }
          : null,
        error: entry.error
      }))
    };
  }

  function getModUi(modId) {
    const id = String(modId || "").trim();
    if (!id) return null;

    const entry = entries.find(item => item.id === id);
    if (!entry || !entry.ui) return null;

    return {
      id: entry.id,
      name: entry.name,
      version: entry.version,
      enabled: Boolean(entry.enabled),
      loaded: Boolean(entry.loaded),
      title: String(entry.ui.title || entry.name || entry.id).trim() || entry.id,
      entry: entry.ui.entry,
      entryPath: entry.ui.entryPath,
      assetRoot: entry.ui.assetRoot,
      dir: entry.dir
    };
  }

  function listModUis(options = {}) {
    const loadedOnly = options.loadedOnly !== false;
    return entries
      .filter(entry => entry.ui && (!loadedOnly || entry.loaded))
      .map(entry => ({
        id: entry.id,
        name: entry.name,
        version: entry.version,
        enabled: Boolean(entry.enabled),
        loaded: Boolean(entry.loaded),
        title: String(entry.ui.title || entry.name || entry.id).trim() || entry.id,
        entry: entry.ui.entry
      }));
  }

  async function invokeHook(hookName, payload = {}) {
    const hook = String(hookName || "").trim();
    if (!SUPPORTED_HOOKS.has(hook) || hook === "onHttp") {
      appendDebugEvent(
        "mods.hook.batch.unsupported",
        {
          hook,
          reason: "unsupported hook"
        },
        { level: "warn" }
      );
      return {
        ok: false,
        hook,
        invoked: 0,
        failed: 0,
        errors: [{ modId: "*", message: "unsupported hook" }]
      };
    }

    const handlers = entries.filter(entry => (
      entry &&
      entry.loaded &&
      entry.instance &&
      typeof entry.instance[hook] === "function"
    ));
    const hasHandlers = handlers.length > 0;
    const debugPayload = sanitizeHookDebugPayload(hook, payload);
    const logBatchDebug = shouldLogHookBatchDebug(hook, hasHandlers);

    if (logBatchDebug) {
      appendDebugEvent("mods.hook.batch.start", {
        hook,
        payload: debugPayload
      });
    }

    if (!hasHandlers) {
      if (logBatchDebug) {
        appendDebugEvent("mods.hook.batch.skipped", {
          hook,
          reason: "no loaded handlers",
          invoked: 0
        });
      }
      return {
        ok: true,
        hook,
        invoked: 0,
        failed: 0,
        errors: []
      };
    }

    const errors = [];
    let invoked = 0;
    for (const entry of handlers) {
      invoked++;
      try {
        await invokeSingle(entry, hook, payload, {
          logLifecycleDebug: logBatchDebug,
          debugPayload
        });
      } catch (err) {
        errors.push({
          modId: entry.id,
          message: asErrorMessage(err)
        });
      }
    }

    if (logBatchDebug) {
      appendDebugEvent("mods.hook.batch.done", {
        hook,
        invoked,
        failed: errors.length
      });
    }

    return {
      ok: errors.length === 0,
      hook,
      invoked,
      failed: errors.length,
      errors
    };
  }

  async function handleHttp(request = {}) {
    const modId = String(request.modId || "").trim();
    const action = String(request.action || "").trim();
    debugCounters.httpCalls += 1;
    appendDebugEvent("mods.http.call", {
      modId,
      action,
      method: String(request.method || "GET").toUpperCase(),
      path: String(request.path || ""),
      query: request.query || {},
      body: request.body || {}
    });

    if (!modId) {
      appendDebugEvent(
        "mods.http.reject",
        { reason: "missing modId", action },
        { level: "warn" }
      );
      return {
        handled: false,
        status: 400,
        body: { ok: false, error: "missing modId" }
      };
    }

    const entry = entries.find(item => item.id === modId);
    if (!entry || !entry.loaded || !entry.instance) {
      appendDebugEvent(
        "mods.http.reject",
        { reason: "mod not found or not loaded", modId, action },
        { level: "warn" }
      );
      return {
        handled: false,
        status: 404,
        body: { ok: false, error: "mod not found or not loaded", modId }
      };
    }

    if (typeof entry.instance.onHttp !== "function") {
      appendDebugEvent(
        "mods.http.reject",
        { reason: "mod has no HTTP handler", modId, action },
        { level: "warn" }
      );
      return {
        handled: false,
        status: 404,
        body: { ok: false, error: "mod has no HTTP handler", modId }
      };
    }

    try {
      const payload = {
        action,
        method: String(request.method || "GET").toUpperCase(),
        path: String(request.path || ""),
        query: cloneJsonSafe(request.query || {}, {}),
        body: cloneJsonSafe(request.body || {}, {}),
        headers: cloneJsonSafe(request.headers || {}, {})
      };
      const context = {
        hook: "onHttp",
        mod: {
          id: entry.id,
          name: entry.name,
          version: entry.version
        },
        api: makeApiFor(entry),
        now: Date.now()
      };
      const result = await Promise.resolve(entry.instance.onHttp(payload, context));

      if (result && typeof result === "object") {
        appendDebugEvent("mods.http.ok", {
          modId,
          action,
          status: Number(result.status) || 200,
          body: result.body !== undefined ? result.body : result
        });
        return {
          handled: true,
          status: Number(result.status) || 200,
          body: result.body !== undefined ? result.body : result
        };
      }

      appendDebugEvent("mods.http.ok", {
        modId,
        action,
        status: 200,
        body: { ok: true, modId, action, result: result ?? null }
      });
      return {
        handled: true,
        status: 200,
        body: { ok: true, modId, action, result: result ?? null }
      };
    } catch (err) {
      debugCounters.httpFailures += 1;
      appendDebugEvent(
        "mods.http.error",
        {
          modId,
          action,
          error: asErrorMessage(err)
        },
        { level: "warn" }
      );
      return {
        handled: true,
        status: 500,
        body: {
          ok: false,
          modId,
          error: asErrorMessage(err)
        }
      };
    }
  }

  return {
    load,
    reload,
    list,
    getDebugDiagnostics(options = {}) {
      return getDebugDiagnostics(options);
    },
    setDebugConfig(patch = {}) {
      return setDebugConfig(patch);
    },
    clearDebugEvents() {
      clearDebugEvents();
      return getDebugDiagnostics({ includeEvents: false });
    },
    getSupportedHooks() {
      return Array.from(SUPPORTED_HOOKS.values());
    },
    getModUi,
    listModUis,
    invokeHook,
    handleHttp
  };
};
