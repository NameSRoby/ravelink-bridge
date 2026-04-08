// [TITLE] Module: domains/audio/rust-transport-worker.runtime.js
// [TITLE] Purpose: rust transport-worker subprocess lifecycle runtime for audio compatibility routes
// [TITLE] Functionality Index:
// [TITLE] - deterministic worker spawn/stop/restart ownership
// [TITLE] - JSON-line IPC envelope send/receive for config + diagnostics requests
// [TITLE] - stable status snapshots consumed by /audio/rust/transport-worker/* routes

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const WORKER_BASENAME_RE = /^(?:ravelink-transport-worker|transport-worker)(?:\.exe)?$/i;
const DEFAULT_WORKER_COMMAND = "ravelink-transport-worker.exe";
const ALLOW_SIBLING_REPO_TOOLS = normalizeBool(process.env.RAVELINK_ALLOW_SIBLING_REPO_TOOLS, false);

function normalizeString(value, max = 256) {
  return String(value || "").trim().slice(0, Math.max(1, Number(max) || 256));
}

function normalizeBool(value, fallback = false) {
  if (value === true || value === false) return value;
  const token = String(value || "").trim().toLowerCase();
  if (!token) return fallback === true;
  if (["1", "true", "yes", "on"].includes(token)) return true;
  if (["0", "false", "no", "off"].includes(token)) return false;
  return fallback === true;
}

function clamp(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number(fallback);
  return Math.min(Number(max), Math.max(Number(min), parsed));
}

function hasPathSegment(value = "") {
  const token = normalizeString(value, 512);
  if (!token) return false;
  return token.includes("\\") || token.includes("/") || token.includes(":");
}

function parseFirstJsonLine(raw = "") {
  const lines = String(raw || "")
    .split(/\r?\n/g)
    .map(line => String(line || "").trim())
    .filter(Boolean);
  for (const line of lines) {
    try {
      return JSON.parse(line);
    } catch {
      // keep scanning
    }
  }
  return null;
}

function sanitizeExecutableInput(value = "", fallback = "") {
  const token = normalizeString(value, 512);
  if (!token) return normalizeString(fallback, 512);
  if (/[\u0000-\u001F\u007F"'`|&;<>()]/.test(token)) return normalizeString(fallback, 512);
  return token;
}

function resolveSiblingRepoRoots(rootDir = "") {
  const source = normalizeString(rootDir, 512);
  if (!source) return [];
  const parentDir = path.dirname(source);
  if (!parentDir) return [];
  try {
    const currentBase = path.basename(source).toLowerCase();
    return fs.readdirSync(parentDir, { withFileTypes: true })
      .filter(entry => entry && entry.isDirectory && entry.isDirectory())
      .map(entry => String(entry.name || "").trim())
      .filter(name => /^RaveLink-Bridge-Windows-v/i.test(name))
      .filter(name => name.toLowerCase() !== currentBase)
      .map(name => path.join(parentDir, name));
  } catch {
    return [];
  }
}

function probeCommandReachable(command = "") {
  const token = normalizeString(command, 512);
  if (!token || hasPathSegment(token)) return false;
  try {
    const result = spawnSync(token, ["--version"], {
      windowsHide: true,
      encoding: "utf8",
      timeout: 1200,
      stdio: "pipe"
    });
    if (result?.error && String(result.error.code || "").trim().toUpperCase() === "ENOENT") {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function resolveWorkerCommandPath(input = "", options = {}) {
  const rootDir = normalizeString(options.rootDir, 512);
  const siblingRoots = ALLOW_SIBLING_REPO_TOOLS ? resolveSiblingRepoRoots(rootDir) : [];
  const candidates = [
    sanitizeExecutableInput(input, ""),
    sanitizeExecutableInput(process.env.RAVE_TRANSPORT_WORKER_PATH || "", ""),
    rootDir ? path.join(rootDir, "runtime", "tools", "rust-runtime", "ravelink-transport-worker.exe") : "",
    ...siblingRoots.map(repoRoot => path.join(repoRoot, "runtime", "tools", "rust-runtime", "ravelink-transport-worker.exe")),
    rootDir ? path.join(rootDir, "ravelink-transport-worker.exe") : "",
    DEFAULT_WORKER_COMMAND
  ]
    .map(value => normalizeString(value, 512))
    .filter(Boolean);

  for (const candidate of candidates) {
    if (hasPathSegment(candidate)) {
      const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(rootDir || process.cwd(), candidate);
      if (!WORKER_BASENAME_RE.test(path.basename(absolute))) continue;
      if (fs.existsSync(absolute)) {
        return {
          available: true,
          command: absolute,
          source: "path",
          bundled: absolute.toLowerCase().includes("\\runtime\\tools\\rust-runtime\\")
        };
      }
      continue;
    }
    if (!WORKER_BASENAME_RE.test(candidate)) continue;
    if (probeCommandReachable(candidate)) {
      return {
        available: true,
        command: candidate,
        source: "path_command",
        bundled: false
      };
    }
  }
  return {
    available: false,
    command: sanitizeExecutableInput(input, DEFAULT_WORKER_COMMAND) || DEFAULT_WORKER_COMMAND,
    source: "missing",
    bundled: false
  };
}

module.exports = function createRustTransportWorkerRuntime(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const rootDir = normalizeString(options.rootDir || process.cwd(), 512);
  const log = options.log || console;
  let state = {
    proc: null,
    running: false,
    pid: 0,
    starts: 0,
    restarts: 0,
    stops: 0,
    exits: 0,
    errors: 0,
    lastStartAt: 0,
    lastStopAt: 0,
    lastExitAt: 0,
    lastErrorAt: 0,
    lastError: "",
    lastExitCode: null,
    lastExitSignal: null,
    lastEventType: "",
    lastEventAt: 0,
    lastReason: "boot",
    lastRestartAt: 0,
    restartTimer: null,
    stderrCarry: "",
    telemetry: {
      lastStats: null,
      lastPressure: null,
      lastPreview: null,
      lastWatchdog: null,
      lastAdapterCatalog: null,
      lastConfigAck: null,
      lastEnqueueAck: null,
      lastWorkerError: null
    },
    enqueued: 0,
    enqueueFailed: 0
  };
  let config = {
    enabled: true,
    autoStart: true,
    commandPath: "",
    adapterPreference: "auto",
    watchdogMs: 2500,
    restartBackoffMs: 1200,
    updatedAt: Number(now() || Date.now())
  };
  let commandRuntime = resolveWorkerCommandPath(config.commandPath, { rootDir });

  function clearRestartTimer() {
    if (!state.restartTimer) return;
    clearTimeout(state.restartTimer);
    state.restartTimer = null;
  }

  function sendEnvelope(type, payload = {}) {
    if (!state.proc || !state.running || !state.proc.stdin || state.proc.stdin.destroyed) return false;
    const envelope = {
      schema: "ravelink.ipc.v1",
      type: normalizeString(type, 128),
      payload: payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}
    };
    if (!envelope.type) return false;
    try {
      state.proc.stdin.write(`${JSON.stringify(envelope)}\n`);
      return true;
    } catch {
      return false;
    }
  }

  function buildWorkerConfigPayload() {
    return {
      adapterPreference: String(config.adapterPreference || "auto"),
      watchdogMs: Math.round(clamp(config.watchdogMs, 250, 30000, 2500))
    };
  }

  function requestAdapterCatalog() {
    if (!state.running) return false;
    return sendEnvelope("transport.adapter.describe", {});
  }

  function requestWatchdogSnapshot() {
    if (!state.running) return false;
    return sendEnvelope("transport.watchdog.snapshot", {});
  }

  function handleWorkerEnvelope(raw = {}) {
    const eventType = normalizeString(raw?.type, 96);
    if (!eventType) return;
    state.lastEventType = eventType;
    state.lastEventAt = Number(now() || Date.now());
    const payload = raw?.payload && typeof raw.payload === "object" ? raw.payload : null;
    if (eventType === "worker.ready") {
      sendEnvelope("config.set", buildWorkerConfigPayload());
      requestAdapterCatalog();
      requestWatchdogSnapshot();
      return;
    }
    if (eventType === "config.ack") {
      state.telemetry.lastConfigAck = payload;
      return;
    }
    if (eventType === "transport.enqueue.ack") {
      state.telemetry.lastEnqueueAck = payload;
      return;
    }
    if (eventType === "transport.adapter.catalog") {
      state.telemetry.lastAdapterCatalog = payload;
      return;
    }
    if (eventType === "transport.emit.stats") {
      state.telemetry.lastStats = payload;
      return;
    }
    if (eventType === "transport.pressure") {
      state.telemetry.lastPressure = payload;
      return;
    }
    if (eventType === "transport.emit.preview") {
      state.telemetry.lastPreview = payload;
      return;
    }
    if (eventType === "transport.watchdog.status") {
      state.telemetry.lastWatchdog = payload;
      return;
    }
    if (eventType === "worker.error") {
      state.telemetry.lastWorkerError = payload;
      const code = normalizeString(payload?.code, 96);
      const message = normalizeString(payload?.message, 320);
      state.lastError = message || code || "transport_worker_reported_error";
      state.lastErrorAt = Number(now() || Date.now());
      state.errors += 1;
    }
  }

  function scheduleRestart(reason = "close") {
    if (!(config.enabled === true && config.autoStart === true)) return;
    if (state.restartTimer) return;
    state.restartTimer = setTimeout(() => {
      state.restartTimer = null;
      if (state.running) return;
      state.restarts += 1;
      state.lastRestartAt = Number(now() || Date.now());
      start({
        reason: `auto_restart_${normalizeString(reason, 64) || "close"}`
      });
    }, Math.round(clamp(config.restartBackoffMs, 100, 60000, 1200)));
    if (typeof state.restartTimer?.unref === "function") {
      state.restartTimer.unref();
    }
  }

  function start(meta = {}) {
    if (state.running === true) return getStatus();
    clearRestartTimer();
    commandRuntime = resolveWorkerCommandPath(config.commandPath, { rootDir });
    if (commandRuntime.available !== true) {
      state.errors += 1;
      state.lastErrorAt = Number(now() || Date.now());
      state.lastError = "transport_worker_command_missing";
      state.lastReason = "start_missing_command";
      scheduleRestart("missing_command");
      return getStatus();
    }

    let proc = null;
    try {
      proc = spawn(commandRuntime.command, [], {
        windowsHide: true,
        stdio: ["pipe", "ignore", "pipe"]
      });
    } catch (error) {
      state.errors += 1;
      state.lastErrorAt = Number(now() || Date.now());
      state.lastError = normalizeString(error?.message || error, 320) || "transport_worker_spawn_failed";
      state.lastReason = "start_spawn_failed";
      scheduleRestart("spawn_error");
      return getStatus();
    }

    state.proc = proc;
    state.running = true;
    state.pid = Math.max(0, Number(proc.pid || 0));
    state.starts += 1;
    state.lastStartAt = Number(now() || Date.now());
    state.lastReason = normalizeString(meta.reason, 96) || "api_start";
    state.lastError = "";
    state.lastErrorAt = 0;
    state.lastExitCode = null;
    state.lastExitSignal = null;
    state.stderrCarry = "";

    proc.stderr.on("data", chunk => {
      const text = String(chunk || "");
      if (!text) return;
      state.stderrCarry += text;
      const lines = state.stderrCarry.split(/\r?\n/g);
      state.stderrCarry = lines.pop() || "";
      for (const line of lines) {
        const trimmed = normalizeString(line, 2000);
        if (!trimmed) continue;
        const parsed = parseFirstJsonLine(trimmed);
        if (parsed && typeof parsed === "object") {
          handleWorkerEnvelope(parsed);
          continue;
        }
        state.lastError = normalizeString(trimmed, 400);
        state.lastErrorAt = Number(now() || Date.now());
      }
    });

    proc.on("error", error => {
      state.errors += 1;
      state.lastErrorAt = Number(now() || Date.now());
      state.lastError = normalizeString(error?.message || error, 320) || "transport_worker_runtime_error";
      state.running = false;
      state.pid = 0;
      state.proc = null;
      scheduleRestart("runtime_error");
    });

    proc.on("close", (code, signal) => {
      if (state.proc !== proc) return;
      state.proc = null;
      state.running = false;
      state.pid = 0;
      state.exits += 1;
      state.lastExitAt = Number(now() || Date.now());
      state.lastExitCode = code ?? null;
      state.lastExitSignal = signal ?? null;
      scheduleRestart("close");
    });

    sendEnvelope("config.set", buildWorkerConfigPayload());
    requestAdapterCatalog();
    requestWatchdogSnapshot();
    return getStatus();
  }

  function stop(meta = {}) {
    clearRestartTimer();
    const disable = normalizeBool(meta.disable, false);
    if (disable) {
      config.enabled = false;
    }
    state.stops += 1;
    state.lastStopAt = Number(now() || Date.now());
    state.lastReason = normalizeString(meta.reason, 96) || "api_stop";
    if (!state.proc) {
      state.running = false;
      state.pid = 0;
      config.updatedAt = Number(now() || Date.now());
      return getStatus();
    }
    try {
      sendEnvelope("worker.shutdown", {});
    } catch {
      // noop
    }
    try {
      state.proc.stdin?.end?.();
    } catch {
      // noop
    }
    try {
      state.proc.kill("SIGTERM");
    } catch {
      // noop
    }
    state.proc = null;
    state.running = false;
    state.pid = 0;
    config.updatedAt = Number(now() || Date.now());
    return getStatus();
  }

  function restart(meta = {}) {
    stop({
      reason: normalizeString(meta.reason, 96) || "api_restart",
      disable: false
    });
    config.enabled = true;
    state.lastRestartAt = Number(now() || Date.now());
    return start({
      reason: normalizeString(meta.reason, 96) || "api_restart"
    });
  }

  function setConfig(patch = {}, options = {}) {
    const source = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
    config = {
      ...config,
      enabled: source.enabled === undefined ? config.enabled : normalizeBool(source.enabled, config.enabled),
      autoStart: source.autoStart === undefined ? config.autoStart : normalizeBool(source.autoStart, config.autoStart),
      commandPath: source.commandPath === undefined && source.path === undefined
        ? config.commandPath
        : sanitizeExecutableInput(source.commandPath === undefined ? source.path : source.commandPath, ""),
      adapterPreference: normalizeString(
        source.adapterPreference === undefined ? config.adapterPreference : source.adapterPreference,
        64
      ).toLowerCase() || "auto",
      watchdogMs: Math.round(clamp(source.watchdogMs, 250, 30000, config.watchdogMs)),
      restartBackoffMs: Math.round(clamp(
        source.restartBackoffMs === undefined ? source.restartDelayMs : source.restartBackoffMs,
        100,
        60000,
        config.restartBackoffMs
      )),
      updatedAt: Number(now() || Date.now())
    };
    commandRuntime = resolveWorkerCommandPath(config.commandPath, { rootDir });

    if (config.enabled !== true) {
      stop({
        reason: "config_disabled",
        disable: true
      });
      return getStatus();
    }
    if (options.autoStartIfEnabled === true && config.autoStart === true) {
      start({
        reason: "config_autostart"
      });
    } else if (state.running) {
      sendEnvelope("config.set", buildWorkerConfigPayload());
    }
    return getStatus();
  }

  function getStatus() {
    commandRuntime = resolveWorkerCommandPath(config.commandPath, { rootDir });
    return {
      available: commandRuntime.available === true,
      command: normalizeString(commandRuntime.command, 512),
      commandSource: normalizeString(commandRuntime.source, 32) || "missing",
      enabled: config.enabled === true,
      running: state.running === true,
      autoStart: config.autoStart === true,
      adapterPreference: normalizeString(config.adapterPreference, 64) || "auto",
      watchdogMs: Math.round(clamp(config.watchdogMs, 250, 30000, 2500)),
      restartBackoffMs: Math.round(clamp(config.restartBackoffMs, 100, 60000, 1200)),
      lastReason: normalizeString(state.lastReason, 96),
      lastStartedAt: Number(state.lastStartAt || 0),
      lastStoppedAt: Number(state.lastStopAt || 0),
      lastRestartAt: Number(state.lastRestartAt || 0),
      runtime: {
        pid: Math.max(0, Number(state.pid || 0)),
        starts: Number(state.starts || 0),
        restarts: Number(state.restarts || 0),
        stops: Number(state.stops || 0),
        exits: Number(state.exits || 0),
        errors: Number(state.errors || 0),
        lastExitAt: Number(state.lastExitAt || 0),
        lastErrorAt: Number(state.lastErrorAt || 0),
        lastError: normalizeString(state.lastError, 400),
        lastExitCode: state.lastExitCode,
        lastExitSignal: state.lastExitSignal,
        lastEventType: normalizeString(state.lastEventType, 96),
        lastEventAt: Number(state.lastEventAt || 0),
        restartPending: state.restartTimer !== null,
        enqueued: Number(state.enqueued || 0),
        enqueueFailed: Number(state.enqueueFailed || 0)
      },
      telemetry: {
        lastStats: state.telemetry.lastStats,
        lastPressure: state.telemetry.lastPressure,
        lastPreview: state.telemetry.lastPreview,
        lastWatchdog: state.telemetry.lastWatchdog,
        lastAdapterCatalog: state.telemetry.lastAdapterCatalog,
        lastConfigAck: state.telemetry.lastConfigAck,
        lastEnqueueAck: state.telemetry.lastEnqueueAck,
        lastWorkerError: state.telemetry.lastWorkerError
      },
      updatedAt: Number(config.updatedAt || now() || Date.now())
    };
  }

  if (config.enabled === true && config.autoStart === true) {
    start({
      reason: "startup_autostart"
    });
  }

  return {
    getStatus,
    setConfig,
    start,
    stop,
    restart,
    requestAdapterCatalog,
    requestWatchdogSnapshot,
    sendEnvelope
  };
};
