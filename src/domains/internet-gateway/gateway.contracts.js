// [TITLE] Module: domains/internet-gateway/gateway.contracts.js
// [TITLE] Purpose: strict typed IPC contracts for internet gateway request/response lanes
// [TITLE] Functionality Index:
// [TITLE] - normalize gateway request/response/error envelopes
// [TITLE] - enforce no-raw-url contract boundary
// [TITLE] - provide deterministic validation errors for policy + runtime callers

const INTERNET_GATEWAY_CONTRACT_VERSION = 1;
const GATEWAY_ALLOWED_METHODS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);
const GATEWAY_ALLOWED_ERROR_CODES = new Set([
  "policy_denied",
  "invalid_request",
  "timeout",
  "upstream_4xx",
  "upstream_5xx",
  "network_error",
  "gateway_unavailable",
  "schema_invalid",
  "circuit_open"
]);

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

function normalizeToken(value, fallback = "", max = 120) {
  const token = asString(value || fallback).toLowerCase().replace(/[^a-z0-9._:-]+/g, "_");
  return token.slice(0, Math.max(1, Number(max) || 120));
}

function normalizeMethod(value, fallback = "GET") {
  const method = asString(value || fallback).toUpperCase();
  return GATEWAY_ALLOWED_METHODS.has(method) ? method : asString(fallback).toUpperCase();
}

function normalizePath(pathValue) {
  const raw = asString(pathValue);
  if (!raw) return "";
  if (raw.includes("://")) return "";
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  const compact = withLeadingSlash.replace(/\/{2,}/g, "/");
  const out = [];
  for (const piece of compact.split("/")) {
    const token = asString(piece);
    if (!token || token === ".") continue;
    if (token === "..") return "";
    out.push(token);
  }
  return `/${out.join("/")}`;
}

function normalizeQueryValue(value) {
  if (Array.isArray(value)) {
    return value.map(item => asString(item)).filter(Boolean).slice(0, 32);
  }
  return asString(value);
}

function normalizeStringMap(input = {}) {
  const source = asObject(input, {});
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(source)) {
    const key = normalizeToken(rawKey, "", 80);
    if (!key) continue;
    out[key] = normalizeQueryValue(rawValue);
  }
  return out;
}

function estimateJsonBytes(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
  } catch {
    return 0;
  }
}

function normalizeGatewayError(input = {}) {
  const source = asObject(input, {});
  const code = normalizeToken(source.code || source.error, "gateway_unavailable", 64);
  return {
    code: GATEWAY_ALLOWED_ERROR_CODES.has(code) ? code : "gateway_unavailable",
    detail: asString(source.detail || source.message || "").slice(0, 800),
    status: clampInt(source.status, 0, 599, 0),
    upstreamStatus: clampInt(source.upstreamStatus, 0, 599, 0),
    retryable: source.retryable === true
  };
}

function normalizeGatewayRequest(input = {}) {
  const source = asObject(input, {});
  const target = asObject(source.target, {});
  return {
    contractVersion: INTERNET_GATEWAY_CONTRACT_VERSION,
    requestId: asString(source.requestId || source.id || "").slice(0, 120),
    correlationId: asString(source.correlationId || source.requestId || "").slice(0, 120),
    integrationKey: normalizeToken(source.integrationKey || source.integration || "", "", 80),
    operation: normalizeToken(source.operation || source.action || "", "", 80),
    target: {
      serviceKey: normalizeToken(target.serviceKey || source.serviceKey || "", "", 80),
      method: normalizeMethod(target.method || source.method || "GET"),
      path: normalizePath(target.path || source.path || "")
    },
    query: normalizeStringMap(source.query),
    headers: normalizeStringMap(source.headers),
    body: source.body && typeof source.body === "object" && !Array.isArray(source.body)
      ? source.body
      : {},
    timeoutMs: clampInt(source.timeoutMs, 250, 60_000, 8_000),
    retryBudget: clampInt(source.retryBudget, 0, 8, 1)
  };
}

function validateGatewayRequest(input = {}) {
  const source = asObject(input, {});
  const normalized = normalizeGatewayRequest(source);

  if (asString(source.url || source.uri || source.endpoint || source.target?.url)) {
    return {
      ok: false,
      status: 400,
      error: "gateway_request_invalid",
      detail: "Raw URL fields are not allowed. Use typed target.serviceKey + target.path."
    };
  }
  if (!normalized.requestId) {
    return {
      ok: false,
      status: 400,
      error: "gateway_request_invalid",
      detail: "requestId is required."
    };
  }
  if (!normalized.integrationKey || !normalized.operation) {
    return {
      ok: false,
      status: 400,
      error: "gateway_request_invalid",
      detail: "integrationKey and operation are required."
    };
  }
  if (!normalized.target.serviceKey || !normalized.target.path) {
    return {
      ok: false,
      status: 400,
      error: "gateway_request_invalid",
      detail: "target.serviceKey and target.path are required."
    };
  }
  if (!GATEWAY_ALLOWED_METHODS.has(normalized.target.method)) {
    return {
      ok: false,
      status: 400,
      error: "gateway_request_invalid",
      detail: "target.method is not allowed."
    };
  }
  if (estimateJsonBytes(normalized.body) > 128_000) {
    return {
      ok: false,
      status: 413,
      error: "gateway_request_invalid",
      detail: "Gateway body exceeds allowed size budget."
    };
  }
  return {
    ok: true,
    status: 200,
    value: normalized
  };
}

function normalizeGatewayResponse(input = {}) {
  const source = asObject(input, {});
  const ok = source.ok === true;
  return {
    contractVersion: INTERNET_GATEWAY_CONTRACT_VERSION,
    ok,
    requestId: asString(source.requestId || "").slice(0, 120),
    correlationId: asString(source.correlationId || source.requestId || "").slice(0, 120),
    status: clampInt(source.status, 0, 599, ok ? 200 : 502),
    result: ok && source.result && typeof source.result === "object" && !Array.isArray(source.result)
      ? source.result
      : {},
    error: ok ? null : normalizeGatewayError(source.error || source)
  };
}

function validateGatewayResponse(input = {}) {
  const normalized = normalizeGatewayResponse(input);
  if (!normalized.requestId) {
    return {
      ok: false,
      status: 500,
      error: "gateway_response_invalid",
      detail: "requestId is required in gateway response."
    };
  }
  if (normalized.ok && (normalized.status < 200 || normalized.status >= 300)) {
    return {
      ok: false,
      status: 500,
      error: "gateway_response_invalid",
      detail: "ok=true responses must use 2xx status codes."
    };
  }
  if (!normalized.ok && !normalized.error?.code) {
    return {
      ok: false,
      status: 500,
      error: "gateway_response_invalid",
      detail: "ok=false responses require typed error payload."
    };
  }
  return {
    ok: true,
    status: 200,
    value: normalized
  };
}

function isObjectMap(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasAnyField(map = {}, fields = []) {
  const source = isObjectMap(map) ? map : {};
  return fields.some(field => Boolean(asString(source[field] || "")));
}

function validateGatewayOperationResultShape(request = {}, result = {}) {
  const sourceRequest = asObject(request, {});
  const sourceResult = asObject(result, {});
  const operation = normalizeToken(sourceRequest.operation || "", "", 80);
  const status = clampInt(sourceResult.status, 0, 599, 0);
  const body = sourceResult.body;

  if (status < 200 || status >= 300) {
    return {
      ok: true,
      status: 200
    };
  }

  if (
    operation === "oauth2_revoke"
  ) {
    return {
      ok: true,
      status: 200
    };
  }

  if (!isObjectMap(body)) {
    return {
      ok: false,
      status: 502,
      error: "gateway_response_schema_invalid",
      detail: `Response body must be an object for operation=${operation || "unknown"}.`
    };
  }

  if (operation === "oauth2_validate") {
    if (!hasAnyField(body, ["client_id", "user_id"])) {
      return {
        ok: false,
        status: 502,
        error: "gateway_response_schema_invalid",
        detail: "OAuth validate response missing client_id/user_id."
      };
    }
  }

  if (operation === "oauth2_device_start") {
    if (!hasAnyField(body, ["user_code"]) || !hasAnyField(body, ["device_code"]) || !hasAnyField(body, ["verification_uri"])) {
      return {
        ok: false,
        status: 502,
        error: "gateway_response_schema_invalid",
        detail: "OAuth device-start response missing required fields."
      };
    }
  }

  if (operation === "oauth2_device_poll" || operation === "oauth2_token_refresh") {
    if (!hasAnyField(body, ["access_token"])) {
      return {
        ok: false,
        status: 502,
        error: "gateway_response_schema_invalid",
        detail: "OAuth token response missing access_token."
      };
    }
  }

  if (
    operation === "patch_redemption_status" ||
    operation === "helix_list_manageable_rewards" ||
    operation === "helix_list_pending_redemptions"
  ) {
    if (!Array.isArray(body.data)) {
      return {
        ok: false,
        status: 502,
        error: "gateway_response_schema_invalid",
        detail: `Helix response missing data[] for operation=${operation}.`
      };
    }
  }

  return {
    ok: true,
    status: 200
  };
}

module.exports = {
  INTERNET_GATEWAY_CONTRACT_VERSION,
  GATEWAY_ALLOWED_METHODS,
  GATEWAY_ALLOWED_ERROR_CODES,
  normalizeGatewayError,
  normalizeGatewayRequest,
  validateGatewayRequest,
  normalizeGatewayResponse,
  validateGatewayResponse,
  validateGatewayOperationResultShape
};
