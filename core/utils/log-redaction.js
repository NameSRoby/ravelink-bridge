// [TITLE] Module: core/utils/log-redaction.js
// [TITLE] Purpose: shared sensitive string/object redaction helpers

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
const SENSITIVE_LOG_OBJECT_KEY_RE = /^(clientkey|client_key|app[_-]?key|username|user[_-]?name|authorization|token|password|api[_-]?key|secret|cookie|set-cookie|bridgeid|bridge[_-]?id|entertainmentareaid|entertainment[_-]?area(?:[_-]?id)?)$/i;

function parseRedactionOptions(options = {}, defaults = {}) {
  if (typeof options === "string") {
    return {
      fallback: options,
      maxLength: defaults.maxLength || 300,
      maxDepth: defaults.maxDepth || 5
    };
  }
  const next = options && typeof options === "object" ? options : {};
  const fallback = String(next.fallback ?? defaults.fallback ?? "unknown");
  const maxLengthRaw = Number(next.maxLength ?? defaults.maxLength ?? 300);
  const maxDepthRaw = Number(next.maxDepth ?? defaults.maxDepth ?? 5);
  const maxLength = Number.isFinite(maxLengthRaw) ? Math.max(16, Math.round(maxLengthRaw)) : 300;
  const maxDepth = Number.isFinite(maxDepthRaw) ? Math.max(1, Math.round(maxDepthRaw)) : 5;
  return {
    fallback,
    maxLength,
    maxDepth
  };
}

function redactSensitiveLogValue(value, options = {}) {
  const opts = parseRedactionOptions(options, { fallback: "unknown", maxLength: 300, maxDepth: 5 });
  let text = String(value || "").trim();
  if (!text) return opts.fallback;
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
  if (text.length > opts.maxLength) {
    const head = Math.max(0, opts.maxLength - 3);
    text = `${text.slice(0, head)}...`;
  }
  return text;
}

function sanitizeLogValue(value, options = {}, seen = new WeakSet(), depth = 0) {
  const opts = parseRedactionOptions(options, { fallback: "unknown", maxLength: 300, maxDepth: 5 });
  if (value === null || value === undefined) return value;

  if (value instanceof Error) {
    return redactSensitiveLogValue(value.stack || value.message || String(value), opts);
  }

  if (depth >= opts.maxDepth) return "[MaxDepth]";
  if (Array.isArray(value)) {
    return value.map(item => sanitizeLogValue(item, opts, seen, depth + 1));
  }

  switch (typeof value) {
    case "string":
      return redactSensitiveLogValue(value, opts);
    case "number":
    case "boolean":
    case "bigint":
      return value;
    case "symbol":
      return String(value);
    case "function":
      return `[Function ${value.name || "anonymous"}]`;
    case "object": {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
      const out = {};
      for (const [key, item] of Object.entries(value)) {
        if (SENSITIVE_LOG_OBJECT_KEY_RE.test(String(key || ""))) {
          out[key] = "[redacted]";
        } else {
          out[key] = sanitizeLogValue(item, opts, seen, depth + 1);
        }
      }
      seen.delete(value);
      return out;
    }
    default:
      break;
  }

  try {
    return redactSensitiveLogValue(String(value), opts);
  } catch {
    return "[Unserializable]";
  }
}

module.exports = {
  redactSensitiveLogValue,
  sanitizeLogValue,
  SENSITIVE_LOG_OBJECT_KEY_RE
};
