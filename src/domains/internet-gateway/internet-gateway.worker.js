// [TITLE] Module: domains/internet-gateway/internet-gateway.worker.js
// [TITLE] Purpose: isolated subprocess worker that executes allowlisted outbound HTTP requests
// [TITLE] Functionality Index:
// [TITLE] - receives typed IPC requests from host runtime
// [TITLE] - enforces policy allowlist before any outbound call
// [TITLE] - returns bounded structured responses and typed errors

const fs = require("node:fs");
const path = require("node:path");
const axios = require("axios");
const {
  validateGatewayRequest,
  normalizeGatewayResponse,
  validateGatewayOperationResultShape
} = require("./gateway.contracts");
const {
  validateGatewayPolicy
} = require("./gateway.policy.schema");
const { createDefaultGatewayPolicy } = require("./gateway.policy.defaults");

const IPC_SCHEMA = "ravelink.internet-gateway.ipc.v1";
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ETIMEDOUT",
  "EPIPE"
]);
const CIRCUIT_OPEN_ERROR_STATUS = 503;

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

function shouldRetryStatus(status) {
  return RETRYABLE_STATUS_CODES.has(Number(status || 0));
}

function shouldRetryError(error) {
  const code = asString(error?.code || "").toUpperCase();
  if (RETRYABLE_ERROR_CODES.has(code)) return true;
  const message = asString(error?.message || "").toLowerCase();
  if (!message) return false;
  return (
    message.includes("timeout") ||
    message.includes("socket hang up") ||
    message.includes("network error")
  );
}

function parseRetryAfterMs(headers = {}) {
  const source = asObject(headers, {});
  const retryAfterRaw = asString(source["retry-after"] || source["Retry-After"] || "");
  if (!retryAfterRaw) return 0;
  const numeric = Number(retryAfterRaw);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return clampInt(numeric * 1000, 0, 20_000, 0);
  }
  const dateMs = Number(new Date(retryAfterRaw).getTime() || 0);
  if (dateMs <= 0) return 0;
  return clampInt(dateMs - Date.now(), 0, 20_000, 0);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function normalizeHeadersForHttp(input = {}) {
  const source = asObject(input, {});
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(source)) {
    const key = asString(rawKey).toLowerCase();
    if (!key) continue;
    if (
      key !== "authorization" &&
      key !== "client-id" &&
      key !== "content-type" &&
      key !== "accept" &&
      key !== "user-agent"
    ) {
      continue;
    }
    if (Array.isArray(rawValue)) {
      out[key] = rawValue.map(item => asString(item)).filter(Boolean).join(", ");
      continue;
    }
    out[key] = asString(rawValue);
  }
  return out;
}

function normalizeHeadersForIpc(input = {}) {
  const source = asObject(input, {});
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(source)) {
    const key = asString(rawKey).toLowerCase();
    if (!key) continue;
    if (Array.isArray(rawValue)) {
      out[key] = rawValue.map(item => asString(item)).filter(Boolean).join(", ");
      continue;
    }
    out[key] = asString(rawValue);
  }
  return out;
}

function normalizeQueryForHttp(input = {}) {
  const source = asObject(input, {});
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(source)) {
    const key = asString(rawKey);
    if (!key) continue;
    if (Array.isArray(rawValue)) {
      out[key] = rawValue.map(item => asString(item));
      continue;
    }
    out[key] = asString(rawValue);
  }
  return out;
}

function normalizeBodyForHttp(input = {}, headers = {}) {
  const source = asObject(input, {});
  if (!Object.keys(source).length) return undefined;
  const headerMap = asObject(headers, {});
  const contentType = asString(headerMap["content-type"] || headerMap["Content-Type"] || "").toLowerCase();
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams();
    for (const [rawKey, rawValue] of Object.entries(source)) {
      const key = asString(rawKey);
      if (!key) continue;
      if (Array.isArray(rawValue)) {
        for (const item of rawValue) {
          params.append(key, asString(item));
        }
        continue;
      }
      params.set(key, asString(rawValue));
    }
    return params.toString();
  }
  return source;
}

const circuitByRuleId = new Map();

function getCircuitState(rule = {}) {
  const ruleId = asString(rule?.id || rule?.serviceKey || "unknown");
  if (!circuitByRuleId.has(ruleId)) {
    circuitByRuleId.set(ruleId, {
      ruleId,
      consecutiveFailures: 0,
      openedAt: 0,
      openUntil: 0,
      lastFailureAt: 0,
      lastSuccessAt: 0,
      trips: 0
    });
  }
  return circuitByRuleId.get(ruleId);
}

function isCircuitOpen(rule = {}, atMs = Date.now()) {
  const state = getCircuitState(rule);
  if (Number(state.openUntil || 0) <= Number(atMs || Date.now())) {
    state.openUntil = 0;
    return false;
  }
  return true;
}

function recordCircuitFailure(rule = {}, atMs = Date.now()) {
  const state = getCircuitState(rule);
  const threshold = clampInt(rule?.circuitBreakerFailureThreshold, 1, 20, 4);
  const cooldownMs = clampInt(rule?.circuitBreakerCooldownMs, 1_000, 300_000, 15_000);
  state.consecutiveFailures += 1;
  state.lastFailureAt = Number(atMs || Date.now());
  if (state.consecutiveFailures >= threshold) {
    state.trips += 1;
    state.openedAt = Number(atMs || Date.now());
    state.openUntil = Number(atMs || Date.now()) + cooldownMs;
  }
  return state;
}

function recordCircuitSuccess(rule = {}, atMs = Date.now()) {
  const state = getCircuitState(rule);
  state.consecutiveFailures = 0;
  state.lastSuccessAt = Number(atMs || Date.now());
  state.openUntil = 0;
  return state;
}

function sanitizeAuditEvent(event = {}) {
  const source = asObject(event, {});
  return {
    at: Number(source.at || Date.now()),
    requestId: asString(source.requestId || "").slice(0, 120),
    correlationId: asString(source.correlationId || "").slice(0, 120),
    integrationKey: asString(source.integrationKey || "").slice(0, 80),
    operation: asString(source.operation || "").slice(0, 80),
    serviceKey: asString(source.serviceKey || "").slice(0, 80),
    policyRuleId: asString(source.policyRuleId || "").slice(0, 80),
    method: asString(source.method || "").slice(0, 10),
    path: asString(source.path || "").slice(0, 240),
    status: clampInt(source.status, 0, 599, 0),
    attempts: clampInt(source.attempts, 0, 20, 0),
    durationMs: clampInt(source.durationMs, 0, 120_000, 0),
    success: source.success === true,
    errorCode: asString(source.errorCode || "").slice(0, 64),
    retryable: source.retryable === true,
    viaCircuitOpen: source.viaCircuitOpen === true,
    circuitOpenUntil: Math.max(0, Number(source.circuitOpenUntil || 0)),
    circuitConsecutiveFailures: Math.max(0, Number(source.circuitConsecutiveFailures || 0))
  };
}

function mapUpstreamErrorCode(statusCode = 0, networkError = null) {
  if (networkError) return "network_error";
  const code = Number(statusCode || 0);
  if (code >= 400 && code < 500) return "upstream_4xx";
  if (code >= 500) return "upstream_5xx";
  return "gateway_unavailable";
}

function loadPolicy(policyPath = "") {
  const resolvedPath = asString(policyPath);
  let parsed = null;
  if (resolvedPath && fs.existsSync(resolvedPath)) {
    try {
      parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
    } catch (error) {
      return {
        ok: false,
        path: resolvedPath,
        error: `gateway_policy_parse_failed:${asString(error?.message || error)}`
      };
    }
  } else {
    parsed = createDefaultGatewayPolicy();
  }
  const validated = validateGatewayPolicy(parsed);
  if (!validated.ok) {
    return {
      ok: false,
      path: resolvedPath,
      error: asString(validated.detail || validated.error || "gateway_policy_invalid")
    };
  }
  return {
    ok: true,
    path: resolvedPath,
    policy: validated.value
  };
}

const policyPath = path.resolve(
  asString(process.env.RAVELINK_INTERNET_GATEWAY_POLICY_PATH || path.join(process.cwd(), "runtime", "system", "internet-gateway.policy.json"))
);
let policyState = loadPolicy(policyPath);

function sendEnvelope(type, payload = {}) {
  if (!process || typeof process.send !== "function") return;
  process.send({
    schema: IPC_SCHEMA,
    type: asString(type),
    payload: asObject(payload, {})
  });
}

function findPolicyRuleByServiceKey(policy = {}, serviceKey = "") {
  const rules = Array.isArray(policy?.rules) ? policy.rules : [];
  return rules.find(rule => asString(rule?.serviceKey || "") === asString(serviceKey));
}

function doesPolicyAllowRequest(policy = {}, request = {}) {
  const rule = findPolicyRuleByServiceKey(policy, request?.target?.serviceKey);
  if (!rule) {
    return {
      ok: false,
      detail: `No policy rule for serviceKey=${asString(request?.target?.serviceKey || "unknown")}`
    };
  }
  const method = asString(request?.target?.method || "").toUpperCase();
  if (!Array.isArray(rule.methods) || !rule.methods.includes(method)) {
    return {
      ok: false,
      detail: `Method denied for serviceKey=${asString(rule.serviceKey)}`
    };
  }
  const pathValue = asString(request?.target?.path || "");
  const pathAllowed = (Array.isArray(rule.pathPrefixes) ? rule.pathPrefixes : [])
    .some(prefix => pathValue.startsWith(asString(prefix)));
  if (!pathAllowed) {
    return {
      ok: false,
      detail: `Path denied for serviceKey=${asString(rule.serviceKey)}`
    };
  }
  const host = Array.isArray(rule.hosts) ? asString(rule.hosts[0] || "") : "";
  if (!host) {
    return {
      ok: false,
      detail: `Policy rule has no hosts for serviceKey=${asString(rule.serviceKey)}`
    };
  }
  return {
    ok: true,
    rule,
    host
  };
}

async function executeOutbound(policyRule = {}, request = {}) {
  const startedAt = Date.now();
  const method = asString(request?.target?.method || "GET").toUpperCase();
  const host = asString(policyRule?.hosts?.[0] || "");
  const scheme = asString(policyRule?.scheme || "https").toLowerCase() || "https";
  const pathValue = asString(request?.target?.path || "");
  const headers = normalizeHeadersForHttp(request?.headers);
  const query = normalizeQueryForHttp(request?.query);
  const data = normalizeBodyForHttp(request?.body, headers);
  const timeoutMs = clampInt(
    request?.timeoutMs,
    250,
    clampInt(policyRule?.timeoutMs, 250, 60_000, 8_000),
    clampInt(policyRule?.timeoutMs, 250, 60_000, 8_000)
  );
  const maxAttempts = clampInt(request?.retryBudget, 0, clampInt(policyRule?.retryBudget, 0, 8, 1), 0) + 1;
  const url = `${scheme}://${host}${pathValue}`;

  let attempts = 0;
  let lastResponse = null;
  let lastError = null;
  while (attempts < maxAttempts) {
    attempts += 1;
    try {
      const response = await axios.request({
        url,
        method,
        params: query,
        headers,
        data,
        timeout: timeoutMs,
        maxRedirects: policyRule.allowRedirects === true ? 5 : 0,
        validateStatus: () => true
      });
      const status = Number(response?.status || 0);
      const retryableStatus = shouldRetryStatus(status);
      if (retryableStatus && attempts < maxAttempts) {
        const retryAfterMs = parseRetryAfterMs(response?.headers);
        await sleep(Math.max(retryAfterMs, 200 * attempts));
        lastResponse = response;
        continue;
      }
      return {
        ok: status >= 200 && status < 300,
        status,
        attempts,
        body: response?.data,
        headers: normalizeHeadersForIpc(response?.headers || {}),
        retryable: retryableStatus,
        durationMs: Math.max(0, Date.now() - startedAt)
      };
    } catch (error) {
      const retryableError = shouldRetryError(error);
      lastError = error;
      if (retryableError && attempts < maxAttempts) {
        await sleep(200 * attempts);
        continue;
      }
      break;
    }
  }

  if (lastResponse) {
    const status = Number(lastResponse?.status || 0);
    return {
      ok: status >= 200 && status < 300,
      status,
      attempts,
      body: lastResponse?.data,
      headers: normalizeHeadersForIpc(lastResponse?.headers || {}),
      retryable: shouldRetryStatus(status),
      durationMs: Math.max(0, Date.now() - startedAt)
    };
  }
  return {
    ok: false,
    status: 0,
    attempts,
    body: {},
    headers: {},
    retryable: shouldRetryError(lastError),
    networkError: asString(lastError?.message || "gateway_outbound_failed"),
    durationMs: Math.max(0, Date.now() - startedAt)
  };
}

async function handleGatewayRequest(requestInput = {}) {
  const startedAt = Date.now();
  let request = {};
  let allow = null;

  function emitAudit(partial = {}) {
    sendEnvelope("gateway.audit", {
      event: sanitizeAuditEvent({
        at: Date.now(),
        requestId: asString(request?.requestId || requestInput?.requestId || ""),
        correlationId: asString(request?.correlationId || requestInput?.correlationId || ""),
        integrationKey: asString(request?.integrationKey || requestInput?.integrationKey || ""),
        operation: asString(request?.operation || requestInput?.operation || ""),
        serviceKey: asString(request?.target?.serviceKey || requestInput?.target?.serviceKey || ""),
        policyRuleId: asString(allow?.rule?.id || ""),
        method: asString(request?.target?.method || requestInput?.target?.method || ""),
        path: asString(request?.target?.path || requestInput?.target?.path || ""),
        durationMs: Math.max(0, Date.now() - startedAt),
        ...asObject(partial, {})
      })
    });
  }

  const validatedRequest = validateGatewayRequest(requestInput);
  if (!validatedRequest.ok) {
    const response = normalizeGatewayResponse({
      ok: false,
      requestId: asString(requestInput?.requestId || ""),
      correlationId: asString(requestInput?.correlationId || ""),
      status: Number(validatedRequest.status || 400),
      error: {
        code: "invalid_request",
        detail: asString(validatedRequest.detail || validatedRequest.error || "gateway_request_invalid"),
        status: Number(validatedRequest.status || 400),
        retryable: false
      }
    });
    emitAudit({
      success: false,
      status: Number(response.status || 400),
      errorCode: "invalid_request",
      retryable: false,
      attempts: 0
    });
    return response;
  }
  request = validatedRequest.value;

  if (!policyState.ok) {
    const response = normalizeGatewayResponse({
      ok: false,
      requestId: request.requestId,
      correlationId: request.correlationId,
      status: 503,
      error: {
        code: "gateway_unavailable",
        detail: asString(policyState.error || "gateway_policy_not_loaded"),
        status: 503,
        retryable: true
      }
    });
    emitAudit({
      success: false,
      status: Number(response.status || 503),
      errorCode: "gateway_unavailable",
      retryable: true,
      attempts: 0
    });
    return response;
  }

  allow = doesPolicyAllowRequest(policyState.policy, request);
  if (!allow.ok) {
    const response = normalizeGatewayResponse({
      ok: false,
      requestId: request.requestId,
      correlationId: request.correlationId,
      status: 403,
      error: {
        code: "policy_denied",
        detail: allow.detail,
        status: 403,
        retryable: false
      }
    });
    emitAudit({
      success: false,
      status: Number(response.status || 403),
      errorCode: "policy_denied",
      retryable: false,
      attempts: 0
    });
    return response;
  }

  if (isCircuitOpen(allow.rule, Date.now())) {
    const circuit = getCircuitState(allow.rule);
    const response = normalizeGatewayResponse({
      ok: false,
      requestId: request.requestId,
      correlationId: request.correlationId,
      status: CIRCUIT_OPEN_ERROR_STATUS,
      error: {
        code: "circuit_open",
        detail: `circuit_open:${asString(allow.rule?.id || allow.rule?.serviceKey || "")}`,
        status: CIRCUIT_OPEN_ERROR_STATUS,
        retryable: true
      }
    });
    emitAudit({
      success: false,
      status: Number(response.status || CIRCUIT_OPEN_ERROR_STATUS),
      errorCode: "circuit_open",
      retryable: true,
      attempts: 0,
      viaCircuitOpen: true,
      circuitOpenUntil: Number(circuit.openUntil || 0),
      circuitConsecutiveFailures: Number(circuit.consecutiveFailures || 0)
    });
    return response;
  }

  const outbound = await executeOutbound(allow.rule, request);
  if (!outbound.ok) {
    if (outbound.retryable === true || Number(outbound.status || 0) >= 500 || outbound.networkError) {
      recordCircuitFailure(allow.rule, Date.now());
    }
    const errorCode = mapUpstreamErrorCode(outbound.status, outbound.networkError);
    const circuit = getCircuitState(allow.rule);
    const response = normalizeGatewayResponse({
      ok: false,
      requestId: request.requestId,
      correlationId: request.correlationId,
      status: Number(outbound.status || 502) || 502,
      error: {
        code: errorCode,
        detail: outbound.networkError || `upstream_http_${Number(outbound.status || 0)}`,
        status: Number(outbound.status || 502) || 502,
        upstreamStatus: Number(outbound.status || 0) || 0,
        retryable: outbound.retryable === true
      }
    });
    emitAudit({
      success: false,
      status: Number(response.status || 502),
      errorCode,
      retryable: outbound.retryable === true,
      attempts: Number(outbound.attempts || 0),
      durationMs: Number(outbound.durationMs || 0),
      circuitOpenUntil: Number(circuit.openUntil || 0),
      circuitConsecutiveFailures: Number(circuit.consecutiveFailures || 0)
    });
    return response;
  }

  const schemaCheck = validateGatewayOperationResultShape(request, {
    status: Number(outbound.status || 200),
    body: outbound.body
  });
  if (!schemaCheck.ok) {
    const circuit = recordCircuitFailure(allow.rule, Date.now());
    const response = normalizeGatewayResponse({
      ok: false,
      requestId: request.requestId,
      correlationId: request.correlationId,
      status: Number(schemaCheck.status || 502),
      error: {
        code: "schema_invalid",
        detail: asString(schemaCheck.detail || schemaCheck.error || "gateway_response_schema_invalid"),
        status: Number(schemaCheck.status || 502),
        upstreamStatus: Number(outbound.status || 0),
        retryable: false
      }
    });
    emitAudit({
      success: false,
      status: Number(response.status || 502),
      errorCode: "schema_invalid",
      retryable: false,
      attempts: Number(outbound.attempts || 0),
      durationMs: Number(outbound.durationMs || 0),
      circuitOpenUntil: Number(circuit.openUntil || 0),
      circuitConsecutiveFailures: Number(circuit.consecutiveFailures || 0)
    });
    return response;
  }

  recordCircuitSuccess(allow.rule, Date.now());
  const response = normalizeGatewayResponse({
    ok: true,
    requestId: request.requestId,
    correlationId: request.correlationId,
    status: 200,
    result: {
      status: Number(outbound.status || 200),
      body: outbound.body && typeof outbound.body === "object" ? outbound.body : {},
      headers: outbound.headers,
      attempts: Number(outbound.attempts || 1),
      policyRuleId: asString(allow.rule?.id || ""),
      serviceKey: asString(request.target.serviceKey || "")
    }
  });
  const circuit = getCircuitState(allow.rule);
  emitAudit({
    success: true,
    status: Number(response?.result?.status || response.status || 200),
    attempts: Number(outbound.attempts || 1),
    durationMs: Number(outbound.durationMs || 0),
    circuitOpenUntil: Number(circuit.openUntil || 0),
    circuitConsecutiveFailures: Number(circuit.consecutiveFailures || 0)
  });
  return response;
}

process.on("message", async envelope => {
  const source = asObject(envelope, {});
  if (asString(source.schema) !== IPC_SCHEMA) return;
  const type = asString(source.type);
  const payload = asObject(source.payload, {});
  if (type === "gateway.shutdown") {
    process.exit(0);
    return;
  }
  if (type === "gateway.reload-policy") {
    policyState = loadPolicy(policyPath);
    sendEnvelope("gateway.ready", {
      ok: policyState.ok === true,
      policyPath,
      policyLoaded: policyState.ok === true,
      policyError: asString(policyState.error || "")
    });
    return;
  }
  if (type !== "gateway.request") return;
  const request = asObject(payload.request, {});
  const response = await handleGatewayRequest(request);
  sendEnvelope("gateway.response", {
    response
  });
});

process.on("disconnect", () => {
  process.exit(0);
});

sendEnvelope("gateway.ready", {
  ok: policyState.ok === true,
  policyPath,
  policyLoaded: policyState.ok === true,
  policyError: asString(policyState.error || "")
});
