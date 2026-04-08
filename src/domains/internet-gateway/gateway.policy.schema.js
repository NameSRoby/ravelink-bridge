// [TITLE] Module: domains/internet-gateway/gateway.policy.schema.js
// [TITLE] Purpose: normalize + validate allowlist-first gateway destination policies
// [TITLE] Functionality Index:
// [TITLE] - enforce strict per-service allowlist shape
// [TITLE] - provide deterministic policy validation errors
// [TITLE] - resolve request allow/deny decisions from normalized policy rules

const INTERNET_GATEWAY_POLICY_SCHEMA_VERSION = 1;
const POLICY_ALLOWED_METHODS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);
const POLICY_ALLOWED_SCHEMES = new Set(["https"]);
const POLICY_ALLOWED_TLS_MIN = new Set(["TLSv1.2", "TLSv1.3"]);

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

function normalizeMethodList(value = []) {
  const source = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  for (const row of source) {
    const method = asString(row).toUpperCase();
    if (!POLICY_ALLOWED_METHODS.has(method) || seen.has(method)) continue;
    seen.add(method);
    out.push(method);
  }
  return out;
}

function normalizeHostList(value = []) {
  const source = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  for (const row of source) {
    const host = asString(row).toLowerCase();
    if (!host) continue;
    if (!/^[a-z0-9][a-z0-9.-]{0,251}[a-z0-9]$/i.test(host)) continue;
    if (host.includes("..")) continue;
    if (seen.has(host)) continue;
    seen.add(host);
    out.push(host);
  }
  return out;
}

function normalizePath(pathValue = "") {
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

function normalizePathPrefixList(value = []) {
  const source = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  for (const row of source) {
    const prefix = normalizePath(row);
    if (!prefix) continue;
    if (seen.has(prefix)) continue;
    seen.add(prefix);
    out.push(prefix);
  }
  return out;
}

function normalizePolicyRule(input = {}) {
  const source = asObject(input, {});
  const serviceKey = normalizeToken(source.serviceKey || source.service || "", "", 80);
  const schemeRaw = asString(source.scheme || "https").toLowerCase();
  const scheme = POLICY_ALLOWED_SCHEMES.has(schemeRaw) ? schemeRaw : "https";
  const methods = normalizeMethodList(source.methods || [source.method || "GET"]);
  const pathPrefixes = normalizePathPrefixList(source.pathPrefixes || source.paths || ["/"]);
  return {
    id: normalizeToken(source.id || serviceKey || "policy_rule", serviceKey || "policy_rule", 80),
    serviceKey,
    scheme,
    hosts: normalizeHostList(source.hosts),
    methods: methods.length ? methods : ["GET"],
    pathPrefixes: pathPrefixes.length ? pathPrefixes : ["/"],
    timeoutMs: clampInt(source.timeoutMs, 250, 60_000, 8_000),
    retryBudget: clampInt(source.retryBudget, 0, 8, 1),
    concurrencyCap: clampInt(source.concurrencyCap ?? source.maxConcurrency, 1, 256, 24),
    circuitBreakerFailureThreshold: clampInt(source.circuitBreakerFailureThreshold, 1, 20, 4),
    circuitBreakerCooldownMs: clampInt(source.circuitBreakerCooldownMs, 1_000, 300_000, 15_000),
    tlsMinVersion: POLICY_ALLOWED_TLS_MIN.has(asString(source.tlsMinVersion || "TLSv1.2"))
      ? asString(source.tlsMinVersion || "TLSv1.2")
      : "TLSv1.2",
    allowRedirects: source.allowRedirects === true,
    allowInsecureTls: source.allowInsecureTls === true
  };
}

function normalizeGatewayPolicy(input = {}) {
  const source = asObject(input, {});
  const rulesSource = Array.isArray(source.rules)
    ? source.rules
    : (Array.isArray(source.integrations) ? source.integrations : []);
  return {
    schemaVersion: clampInt(
      source.schemaVersion ?? source.policyVersion,
      1,
      1,
      INTERNET_GATEWAY_POLICY_SCHEMA_VERSION
    ),
    defaultDeny: source.defaultDeny !== false,
    rules: rulesSource.map(normalizePolicyRule)
  };
}

function validateGatewayPolicy(input = {}) {
  const normalized = normalizeGatewayPolicy(input);
  if (normalized.defaultDeny !== true) {
    return {
      ok: false,
      status: 400,
      error: "gateway_policy_invalid",
      detail: "Policy must be default-deny."
    };
  }
  if (!Array.isArray(normalized.rules) || normalized.rules.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "gateway_policy_invalid",
      detail: "Policy must contain at least one allowlist rule."
    };
  }
  const seenServiceKeys = new Set();
  for (const rule of normalized.rules) {
    if (!rule.serviceKey) {
      return {
        ok: false,
        status: 400,
        error: "gateway_policy_invalid",
        detail: "Each rule requires serviceKey."
      };
    }
    if (!Array.isArray(rule.hosts) || rule.hosts.length === 0) {
      return {
        ok: false,
        status: 400,
        error: "gateway_policy_invalid",
        detail: `Rule ${rule.id} requires at least one host.`
      };
    }
    if (!Array.isArray(rule.methods) || rule.methods.length === 0) {
      return {
        ok: false,
        status: 400,
        error: "gateway_policy_invalid",
        detail: `Rule ${rule.id} requires at least one method.`
      };
    }
    if (!Array.isArray(rule.pathPrefixes) || rule.pathPrefixes.length === 0) {
      return {
        ok: false,
        status: 400,
        error: "gateway_policy_invalid",
        detail: `Rule ${rule.id} requires at least one path prefix.`
      };
    }
    if (seenServiceKeys.has(rule.serviceKey)) {
      return {
        ok: false,
        status: 400,
        error: "gateway_policy_invalid",
        detail: `Duplicate serviceKey in policy: ${rule.serviceKey}`
      };
    }
    seenServiceKeys.add(rule.serviceKey);
  }
  return {
    ok: true,
    status: 200,
    value: normalized
  };
}

function normalizeRequestTarget(input = {}) {
  const source = asObject(input, {});
  const target = asObject(source.target, {});
  return {
    serviceKey: normalizeToken(target.serviceKey || source.serviceKey || "", "", 80),
    method: asString(target.method || source.method || "").toUpperCase(),
    path: normalizePath(target.path || source.path || "")
  };
}

function doesPolicyAllowRequest(policyInput = {}, requestInput = {}) {
  const validated = validateGatewayPolicy(policyInput);
  if (!validated.ok) {
    return {
      ok: false,
      status: 500,
      error: "gateway_policy_invalid",
      detail: validated.detail
    };
  }
  const policy = validated.value;
  const request = normalizeRequestTarget(requestInput);
  const rule = policy.rules.find(item => item.serviceKey === request.serviceKey);
  if (!rule) {
    return {
      ok: false,
      status: 403,
      error: "policy_denied",
      detail: `No allowlist rule for serviceKey=${request.serviceKey || "unknown"}`
    };
  }
  if (!rule.methods.includes(request.method)) {
    return {
      ok: false,
      status: 403,
      error: "policy_denied",
      detail: `Method denied for serviceKey=${rule.serviceKey}`
    };
  }
  const pathAllowed = rule.pathPrefixes.some(prefix => request.path.startsWith(prefix));
  if (!pathAllowed) {
    return {
      ok: false,
      status: 403,
      error: "policy_denied",
      detail: `Path denied for serviceKey=${rule.serviceKey}`
    };
  }
  return {
    ok: true,
    status: 200,
    ruleId: rule.id,
    serviceKey: rule.serviceKey
  };
}

module.exports = {
  INTERNET_GATEWAY_POLICY_SCHEMA_VERSION,
  POLICY_ALLOWED_METHODS,
  normalizePolicyRule,
  normalizeGatewayPolicy,
  validateGatewayPolicy,
  doesPolicyAllowRequest
};
