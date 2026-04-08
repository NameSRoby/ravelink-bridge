// [TITLE] Module: domains/internet-gateway/internet-gateway.runtime.js
// [TITLE] Purpose: host runtime that owns internet-gateway worker lifecycle + IPC request dispatch
// [TITLE] Functionality Index:
// [TITLE] - spawn and supervise gateway subprocess
// [TITLE] - route typed request/response envelopes across IPC
// [TITLE] - expose stable status snapshots for system routes and callers

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { fork } = require("node:child_process");
const {
  normalizeGatewayRequest,
  validateGatewayRequest
} = require("./gateway.contracts");
const {
  validateGatewayPolicy
} = require("./gateway.policy.schema");
const { createDefaultGatewayPolicy } = require("./gateway.policy.defaults");

const IPC_SCHEMA = "ravelink.internet-gateway.ipc.v1";
const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;

function asString(value) {
  return String(value ?? "").trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : fallback;
}

function clampInt(value, min, max, fallback) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return Math.round(Number(fallback) || 0);
  return Math.min(Math.round(Number(max) || parsed), Math.max(Math.round(Number(min) || parsed), parsed));
}

function ensureDir(dirPath = "") {
  const target = asString(dirPath);
  if (!target) return;
  fs.mkdirSync(path.resolve(target), { recursive: true });
}

function writeJsonIfMissing(filePath = "", payload = {}) {
  const target = path.resolve(asString(filePath));
  if (!target) return;
  if (fs.existsSync(target)) return;
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function nextRequestId() {
  const random = crypto.randomBytes(4).toString("hex");
  return `igw_${Date.now()}_${random}`;
}

module.exports = function createInternetGatewayRuntime(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const log = options.log || console;
  const rootDir = path.resolve(asString(options.rootDir || process.cwd()) || process.cwd());
  const runtimeDir = path.resolve(asString(options.runtimeDir || path.join(rootDir, "runtime")));
  const policyPath = path.resolve(asString(
    options.policyPath || path.join(runtimeDir, "system", "internet-gateway.policy.json")
  ));
  const workerPath = path.resolve(asString(
    options.workerPath || path.join(__dirname, "internet-gateway.worker.js")
  ));
  const enabled = options.enabled !== false;
  const autoStart = options.autoStart !== false;
  const requestTimeoutMs = clampInt(options.requestTimeoutMs, 500, 120_000, DEFAULT_REQUEST_TIMEOUT_MS);
  const forkFn = typeof options.forkFn === "function" ? options.forkFn : fork;

  const defaultPolicy = createDefaultGatewayPolicy();
  const defaultPolicyValidation = validateGatewayPolicy(defaultPolicy);
  if (defaultPolicyValidation.ok !== true) {
    throw new Error(`internet_gateway_default_policy_invalid:${asString(defaultPolicyValidation.detail || "")}`);
  }
  writeJsonIfMissing(policyPath, defaultPolicy);

  let child = null;
  let state = {
    enabled,
    autoStart,
    running: false,
    ready: false,
    pid: 0,
    starts: 0,
    stops: 0,
    exits: 0,
    requestCount: 0,
    requestErrors: 0,
    pendingCount: 0,
    lastStartAt: 0,
    lastStopAt: 0,
    lastExitAt: 0,
    lastRequestAt: 0,
    lastError: "",
    lastReadyAt: 0,
    auditCount: 0,
    lastAuditAt: 0,
    lastAudit: null,
    policyPath,
    policyLoaded: false,
    policyError: ""
  };
  const pending = new Map();

  function clearPendingWithError(errorCode = "gateway_unavailable", detail = "gateway_worker_unavailable") {
    for (const [requestId, entry] of pending.entries()) {
      clearTimeout(entry.timer);
      entry.resolve({
        ok: false,
        requestId,
        correlationId: entry.request?.correlationId || "",
        status: 503,
        error: {
          code: errorCode,
          detail,
          status: 503,
          retryable: true
        }
      });
    }
    pending.clear();
    state.pendingCount = 0;
  }

  function onChildMessage(envelope = {}) {
    const source = asObject(envelope, {});
    if (asString(source.schema) !== IPC_SCHEMA) return;
    const type = asString(source.type);
    const payload = asObject(source.payload, {});
    if (type === "gateway.ready") {
      state.ready = payload.ok === true;
      state.policyLoaded = payload.policyLoaded === true;
      state.policyError = asString(payload.policyError || "");
      state.lastReadyAt = Number(now() || Date.now());
      return;
    }
    if (type === "gateway.audit") {
      const event = asObject(payload.event, {});
      state.auditCount += 1;
      state.lastAuditAt = Number(now() || Date.now());
      state.lastAudit = {
        at: Number(event.at || 0),
        requestId: asString(event.requestId || ""),
        correlationId: asString(event.correlationId || ""),
        operation: asString(event.operation || ""),
        serviceKey: asString(event.serviceKey || ""),
        policyRuleId: asString(event.policyRuleId || ""),
        method: asString(event.method || ""),
        path: asString(event.path || ""),
        status: Number(event.status || 0),
        attempts: Number(event.attempts || 0),
        durationMs: Number(event.durationMs || 0),
        success: event.success === true,
        errorCode: asString(event.errorCode || ""),
        retryable: event.retryable === true,
        viaCircuitOpen: event.viaCircuitOpen === true,
        circuitOpenUntil: Number(event.circuitOpenUntil || 0),
        circuitConsecutiveFailures: Number(event.circuitConsecutiveFailures || 0)
      };
      return;
    }
    if (type !== "gateway.response") return;
    const response = asObject(payload.response, {});
    const requestId = asString(response.requestId || "");
    if (!requestId || !pending.has(requestId)) return;
    const entry = pending.get(requestId);
    pending.delete(requestId);
    clearTimeout(entry.timer);
    state.pendingCount = pending.size;
    if (response.ok !== true) {
      state.requestErrors += 1;
    }
    entry.resolve(response);
  }

  function onChildExit(code = null, signal = null) {
    state.running = false;
    state.ready = false;
    state.pid = 0;
    state.exits += 1;
    state.lastExitAt = Number(now() || Date.now());
    const reason = `gateway_worker_exit_${Number(code ?? -1)}_${asString(signal || "")}`;
    state.lastError = reason;
    clearPendingWithError("gateway_unavailable", reason);
    child = null;
  }

  function start(meta = {}) {
    if (state.enabled !== true) return getStatus();
    if (state.running === true && child) return getStatus();
    if (!fs.existsSync(workerPath)) {
      state.lastError = "gateway_worker_missing";
      state.running = false;
      state.ready = false;
      return getStatus();
    }
    try {
      child = forkFn(workerPath, [], {
        cwd: rootDir,
        env: {
          ...process.env,
          RAVELINK_INTERNET_GATEWAY_POLICY_PATH: policyPath
        },
        stdio: ["ignore", "ignore", "ignore", "ipc"]
      });
    } catch (error) {
      state.lastError = asString(error?.message || "gateway_worker_spawn_failed");
      state.running = false;
      state.ready = false;
      child = null;
      return getStatus();
    }

    state.running = true;
    state.ready = false;
    state.pid = Number(child.pid || 0) || 0;
    state.starts += 1;
    state.lastStartAt = Number(now() || Date.now());
    state.lastError = "";

    child.on("message", onChildMessage);
    child.on("close", onChildExit);
    child.on("error", error => {
      state.lastError = asString(error?.message || "gateway_worker_runtime_error");
      onChildExit(-1, "error");
    });
    if (typeof child.unref === "function") {
      child.unref();
    }

    if (meta.reloadPolicy === true && child?.send) {
      child.send({
        schema: IPC_SCHEMA,
        type: "gateway.reload-policy",
        payload: {}
      });
    }
    return getStatus();
  }

  function stop(meta = {}) {
    const reason = asString(meta.reason || "api_stop");
    state.stops += 1;
    state.lastStopAt = Number(now() || Date.now());
    const worker = child;
    if (!worker) {
      state.running = false;
      state.ready = false;
      state.pid = 0;
      state.lastError = reason;
      return getStatus();
    }
    try {
      worker.send({
        schema: IPC_SCHEMA,
        type: "gateway.shutdown",
        payload: {}
      });
    } catch {
      // ignore
    }
    try {
      if (typeof worker.disconnect === "function") {
        worker.disconnect();
      }
    } catch {
      // ignore
    }
    try {
      worker.kill("SIGTERM");
    } catch {
      // ignore
    }
    child = null;
    state.running = false;
    state.ready = false;
    state.pid = 0;
    state.lastError = reason;
    clearPendingWithError("gateway_unavailable", reason);
    return getStatus();
  }

  function getStatus() {
    return {
      ok: true,
      enabled: state.enabled === true,
      autoStart: state.autoStart === true,
      running: state.running === true,
      ready: state.ready === true,
      pid: Number(state.pid || 0),
      starts: Number(state.starts || 0),
      stops: Number(state.stops || 0),
      exits: Number(state.exits || 0),
      requestCount: Number(state.requestCount || 0),
      requestErrors: Number(state.requestErrors || 0),
      pendingCount: Number(state.pendingCount || 0),
      lastStartAt: Number(state.lastStartAt || 0),
      lastStopAt: Number(state.lastStopAt || 0),
      lastExitAt: Number(state.lastExitAt || 0),
      lastRequestAt: Number(state.lastRequestAt || 0),
      lastReadyAt: Number(state.lastReadyAt || 0),
      auditCount: Number(state.auditCount || 0),
      lastAuditAt: Number(state.lastAuditAt || 0),
      lastAudit: state.lastAudit ? { ...state.lastAudit } : null,
      lastError: asString(state.lastError || ""),
      policyPath: asString(state.policyPath || ""),
      policyLoaded: state.policyLoaded === true,
      policyError: asString(state.policyError || ""),
      workerPath
    };
  }

  async function request(requestInput = {}) {
    if (state.enabled !== true) {
      return {
        ok: false,
        status: 503,
        error: {
          code: "gateway_unavailable",
          detail: "internet_gateway_disabled",
          status: 503,
          retryable: true
        }
      };
    }
    if (state.running !== true || !child) {
      start({
        reason: "request_start"
      });
    }
    if (state.running !== true || !child || typeof child.send !== "function") {
      state.requestErrors += 1;
      return {
        ok: false,
        status: 503,
        error: {
          code: "gateway_unavailable",
          detail: "internet_gateway_worker_unavailable",
          status: 503,
          retryable: true
        }
      };
    }

    const requestNormalized = normalizeGatewayRequest({
      ...asObject(requestInput, {}),
      requestId: asString(requestInput?.requestId || nextRequestId())
    });
    const requestValidation = validateGatewayRequest(requestNormalized);
    if (!requestValidation.ok) {
      state.requestErrors += 1;
      return {
        ok: false,
        status: Number(requestValidation.status || 400),
        error: {
          code: "invalid_request",
          detail: asString(requestValidation.detail || requestValidation.error || "gateway_request_invalid"),
          status: Number(requestValidation.status || 400),
          retryable: false
        }
      };
    }
    const request = requestValidation.value;
    state.requestCount += 1;
    state.lastRequestAt = Number(now() || Date.now());

    return await new Promise(resolve => {
      const timeoutMs = clampInt(
        request.timeoutMs + 1500,
        500,
        120_000,
        requestTimeoutMs + 1500
      );
      const timer = setTimeout(() => {
        pending.delete(request.requestId);
        state.pendingCount = pending.size;
        state.requestErrors += 1;
        resolve({
          ok: false,
          requestId: request.requestId,
          correlationId: request.correlationId,
          status: 504,
          error: {
            code: "timeout",
            detail: "internet_gateway_request_timeout",
            status: 504,
            retryable: true
          }
        });
      }, timeoutMs);
      pending.set(request.requestId, {
        request,
        resolve,
        timer
      });
      state.pendingCount = pending.size;
      try {
        child.send({
          schema: IPC_SCHEMA,
          type: "gateway.request",
          payload: {
            request
          }
        });
      } catch (error) {
        clearTimeout(timer);
        pending.delete(request.requestId);
        state.pendingCount = pending.size;
        state.requestErrors += 1;
        resolve({
          ok: false,
          requestId: request.requestId,
          correlationId: request.correlationId,
          status: 503,
          error: {
            code: "gateway_unavailable",
            detail: asString(error?.message || "internet_gateway_send_failed"),
            status: 503,
            retryable: true
          }
        });
      }
    });
  }

  function reloadPolicy() {
    if (!child || state.running !== true) {
      start({
        reason: "reload_policy_start"
      });
    }
    if (!child || typeof child.send !== "function") return getStatus();
    child.send({
      schema: IPC_SCHEMA,
      type: "gateway.reload-policy",
      payload: {}
    });
    return getStatus();
  }

  function shutdown() {
    return stop({
      reason: "shutdown"
    });
  }

  if (state.enabled === true && state.autoStart === true) {
    start({
      reason: "startup_autostart"
    });
  }

  return {
    getStatus,
    start,
    stop,
    request,
    reloadPolicy,
    shutdown
  };
};
