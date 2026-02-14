// [TITLE] Module: core/hue-entertainment.js
// [TITLE] Purpose: hue-entertainment
// [TITLE] Functionality Index:
// [TITLE] - TLS + DNS Safety Guards
// [TITLE] - Redaction + Error String Sanitization
// [TITLE] - Hue Bridge Request/DTLS Overrides
// [TITLE] - Bridge Config Resolution + Area Selection
// [TITLE] - Start/Stop Lifecycle + Auto-Retry
// [TITLE] - Frame Send Path + Socket Failure Guards
// [TITLE] - Status Surface

/**
 * Optional Hue Entertainment transport wrapper.
 *
 * This module is intentionally defensive:
 * - If `hue-sync` is not installed or credentials are missing, it reports
 *   unavailable and the caller can keep using REST automatically.
 * - When available, it exposes start/stop/send helpers.
 */
const fs = require("fs");
const path = require("path");
const dns = require("dns");
const net = require("net");
const tls = require("tls");
const https = require("https");
const axios = require("axios");

// [TITLE] Section: Runtime State + Security Flags
const nativeDnsLookup = dns.lookup.bind(dns);
const bridgeDnsMap = new Map();
let dnsPatchInstalled = false;
let hueCaInstalled = false;
const hueHttpsAgentByBridge = new Map();
const HUE_INSECURE_TLS_ENV_REQUESTED = String(process.env.RAVELINK_ALLOW_INSECURE_HUE_TLS || "").trim() === "1";
const HUE_ENT_ENABLE_ORIGINAL_START_FALLBACK =
  String(process.env.RAVE_HUE_ENT_ORIGINAL_START_FALLBACK || "1").trim() !== "0";
const HUE_ENT_VERBOSE_LOGS = String(process.env.RAVE_HUE_ENT_VERBOSE_LOGS || "").trim() === "1";
let hueInsecureTlsWarningLogged = false;

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

// [TITLE] Section: Path/Host + TLS CA Helpers
function resolveHueSyncModuleDir() {
  try {
    const pkgPath = require.resolve("hue-sync/package.json");
    return path.dirname(pkgPath);
  } catch {
    return null;
  }
}

function resolveHueCaPath() {
  const candidates = [];
  if (process.env.RAVE_HUE_CA_CERT_PATH) {
    candidates.push(String(process.env.RAVE_HUE_CA_CERT_PATH));
  }
  const moduleDir = resolveHueSyncModuleDir();
  if (moduleDir) {
    candidates.push(path.join(moduleDir, "signify.pem"));
  }
  candidates.push(path.join(__dirname, "..", "node_modules", "hue-sync", "signify.pem"));
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || "";
}

function normalizeHost(value) {
  return String(value || "").trim().replace(/\.$/, "").toLowerCase();
}

function logHueEntVerbose(log = console, ...args) {
  if (!HUE_ENT_VERBOSE_LOGS) return;
  log.log?.(...args);
}

// [TITLE] Section: IPv4 Private/Loopback Guard
function parseIpv4Parts(value) {
  const text = String(value || "").trim();
  if (net.isIP(text) !== 4) return null;
  const parts = text.split(".").map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return parts;
}

function isPrivateOrLoopbackIpv4(value) {
  const parts = parseIpv4Parts(value);
  if (!parts) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 127) return true;
  return false;
}

// [TITLE] Section: Log Redaction Helpers
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

function maybeLogInsecureTlsRequest(log = console) {
  if (!HUE_INSECURE_TLS_ENV_REQUESTED || hueInsecureTlsWarningLogged) return;
  hueInsecureTlsWarningLogged = true;
  log.warn?.(
    "[SECURITY] RAVELINK_ALLOW_INSECURE_HUE_TLS is ignored. TLS certificate validation remains enabled."
  );
}

// [TITLE] Section: DNS + Fetch Compatibility
function installBridgeDnsPatch(log = console) {
  if (dnsPatchInstalled) return;

  dns.lookup = function patchedLookup(hostname, options, callback) {
    const host = normalizeHost(hostname);
    const mappedIp = bridgeDnsMap.get(host);

    let opts = options;
    let cb = callback;
    if (typeof opts === "function") {
      cb = opts;
      opts = undefined;
    }

    if (mappedIp && typeof cb === "function") {
      const all = Boolean(opts && typeof opts === "object" && opts.all);
      if (all) {
        cb(null, [{ address: mappedIp, family: 4 }]);
      } else {
        cb(null, mappedIp, 4);
      }
      return;
    }

    if (typeof cb === "function") {
      nativeDnsLookup(hostname, opts, cb);
      return;
    }

    return nativeDnsLookup(hostname, opts);
  };

  dnsPatchInstalled = true;
  logHueEntVerbose(log, "[HUE][ENT] installed bridge DNS patch");
}

function registerBridgeDns(bridgeId, bridgeIp, log = console) {
  const id = normalizeHost(bridgeId);
  const ip = String(bridgeIp || "").trim();
  if (!id || !ip) return;

  bridgeDnsMap.set(id, ip);
  installBridgeDnsPatch(log);
}

function ensureHueFetchCompatibility(log = console) {
  // hue-sync only installs cross-fetch when global fetch is missing.
  // On Node's native fetch path, its DNS monkey-patch can fail to apply reliably.
  // Force cross-fetch so bridge-id host -> bridge-ip DNS patching works consistently.
  try {
    const crossFetch = require("cross-fetch");
    const fetchFn = crossFetch?.fetch || crossFetch;
    if (typeof fetchFn === "function") {
      globalThis.fetch = fetchFn;
      if (crossFetch?.Headers) globalThis.Headers = crossFetch.Headers;
      if (crossFetch?.Request) globalThis.Request = crossFetch.Request;
      if (crossFetch?.Response) globalThis.Response = crossFetch.Response;
      logHueEntVerbose(log, "[HUE][ENT] using cross-fetch compatibility mode");
      return true;
    }
  } catch (err) {
    if (err?.code !== "MODULE_NOT_FOUND") {
      log.warn?.(`[HUE][ENT] cross-fetch compatibility unavailable: ${err.message || err}`);
    }
  }
  return false;
}

function getHueHttpsAgent(bridgeId = "") {
  const key = String(bridgeId || "").trim().toLowerCase() || "default";
  const cached = hueHttpsAgentByBridge.get(key);
  if (cached) return cached;

  const normalizedBridgeId = normalizeHost(bridgeId);
  const options = {
    keepAlive: true,
    maxSockets: 8,
    rejectUnauthorized: true
  };

  const hueCaPath = resolveHueCaPath();
  if (hueCaPath) {
    try {
      options.ca = fs.readFileSync(hueCaPath, "utf8");
    } catch {}
  }

  if (normalizedBridgeId) {
    options.servername = normalizedBridgeId;
    options.checkServerIdentity = (_host, cert) =>
      tls.checkServerIdentity(normalizedBridgeId, cert);
  }

  const agent = new https.Agent(options);
  hueHttpsAgentByBridge.set(key, agent);
  return agent;
}

// [TITLE] Section: Request/DTLS Overrides
function rewriteEndpointToBridgeIp(endpoint, bridgeIp) {
  const source = String(endpoint || "").trim();
  const ip = String(bridgeIp || "").trim();
  if (!source || !ip) return source;

  try {
    const parsed = new URL(source);
    parsed.hostname = ip;
    return parsed.toString();
  } catch {
    return source;
  }
}

function parseHueApiPayload(raw) {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return { data: raw };
    }
  }
  return { data: raw };
}

function installBridgeIpRequestOverride(bridgeRef, cfg, log = console) {
  if (!bridgeRef || typeof bridgeRef._request !== "function") return false;
  const bridgeIp = String(cfg?.bridgeIp || bridgeRef.url || "").trim();
  if (!bridgeIp) return false;

  const currentMarker = String(bridgeRef.__bridgeIpRequestOverride || "");
  if (currentMarker === bridgeIp) return true;

  bridgeRef._request = async function requestViaBridgeIp(endpoint, options = {}) {
    const method = String(options?.method || "GET").trim().toUpperCase() || "GET";
    const headers = {
      ...(options?.headers || {}),
      "hue-application-key":
        String(this.credentials?.username || "").trim() || String(cfg?.username || "").trim()
    };

    let data = undefined;
    if (options?.body && method !== "GET") {
      data = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
      if (!headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
      }
    }

    const target = rewriteEndpointToBridgeIp(endpoint, bridgeIp);
    const response = await axios({
      url: target,
      method,
      headers,
      data,
      timeout: 5000,
      responseType: "text",
      validateStatus: () => true,
      httpsAgent: getHueHttpsAgent(cfg?.bridgeId || bridgeRef.id)
    });

    return parseHueApiPayload(response?.data);
  };

  bridgeRef.__bridgeIpRequestOverride = bridgeIp;
  logHueEntVerbose(
    log,
    `[HUE][ENT] bridge IP request override active (${redactSensitiveLogValue(bridgeIp, "[redacted-ip]")})`
  );
  return true;
}

function installBridgeDtlsStartOverride(bridgeRef, cfg, log = console) {
  if (!bridgeRef || typeof bridgeRef.start !== "function") return false;
  if (bridgeRef.__dtlsStartOverrideInstalled) return true;

  let dtlsClient = null;
  try {
    const mod = require("node-dtls-client");
    dtlsClient = mod?.dtls || null;
  } catch (err) {
    log.warn?.(`[HUE][ENT] DTLS override unavailable: ${err.message || err}`);
    return false;
  }
  if (!dtlsClient || typeof dtlsClient.createSocket !== "function") {
    return false;
  }

  const originalStart = bridgeRef.start.bind(bridgeRef);
  bridgeRef.__originalStart = originalStart;

  bridgeRef.start = async function startWithForcedCipher(selectedArea, timeout = 1000) {
    this.entertainmentArea = selectedArea;
    this.abortionController = new AbortController();

    await this.updateEntertainmentArea(selectedArea.id, { action: "start" });

    const username = String(this.credentials?.username || cfg?.username || "").trim();
    const clientKeyHex = String(this.credentials?.clientkey || cfg?.clientKey || "").trim();
    if (!username || !clientKeyHex) {
      throw new Error("missing username/clientkey for DTLS start");
    }

    this.socket = dtlsClient.createSocket({
      timeout,
      port: 2100,
      type: "udp4",
      address: this.url,
      signal: this.abortionController.signal,
      // node-dtls-client expects "ciphers". Keep legacy key too for compatibility.
      ciphers: ["TLS_PSK_WITH_AES_128_GCM_SHA256"],
      cipherSuites: ["TLS_PSK_WITH_AES_128_GCM_SHA256"],
      psk: {
        [username]: Buffer.from(clientKeyHex, "hex")
      }
    });

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = err => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      };

      this.socket.once("connected", () => finish());
      this.socket.once("error", err => finish(err instanceof Error ? err : new Error(String(err || "DTLS start failed"))));
    });
  };

  bridgeRef.__dtlsStartOverrideInstalled = true;
  logHueEntVerbose(log, "[HUE][ENT] DTLS start override active (forced ciphers)");
  return true;
}

// [TITLE] Section: CA Trust Installation
function parsePemCertificates(pemBundle = "") {
  const matches = String(pemBundle).match(
    /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g
  );
  return Array.isArray(matches) ? matches.map(s => s.trim()).filter(Boolean) : [];
}

function wait(ms) {
  const delay = Math.max(0, Number(ms) || 0);
  if (!delay) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, delay));
}

function ensureHueTrustStore({ bundledHueCaPath, log = console }) {
  if (hueCaInstalled) return true;
  if (typeof tls.getCACertificates !== "function" || typeof tls.setDefaultCACertificates !== "function") {
    return false;
  }

  const caCandidates = [];
  if (process.env.NODE_EXTRA_CA_CERTS) {
    caCandidates.push(process.env.NODE_EXTRA_CA_CERTS);
  }
  caCandidates.push(bundledHueCaPath);

  const caPath = caCandidates.find(p => p && fs.existsSync(p));
  if (!caPath) return false;

  try {
    const pemBundle = fs.readFileSync(caPath, "utf8");
    const extraCerts = parsePemCertificates(pemBundle);
    if (!extraCerts.length) return false;

    const defaultCerts = tls.getCACertificates("default");
    const merged = defaultCerts.slice();

    for (const cert of extraCerts) {
      if (!merged.includes(cert)) {
        merged.push(cert);
      }
    }

    tls.setDefaultCACertificates(merged);
    hueCaInstalled = true;
    log.log?.(`[HUE][ENT] installed Hue CA trust (${path.basename(caPath)})`);
    return true;
  } catch (err) {
    log.warn?.(`[HUE][ENT] failed to install Hue CA trust: ${err.message || err}`);
    return false;
  }
}

// [TITLE] Section: Transport Factory
module.exports = function createHueEntertainmentTransport({ fixtureRegistry, log = console }) {
  maybeLogInsecureTlsRequest(log);
  let HueSync = null;
  let bridge = null;
  let active = false;
  let areaRef = null;
  let streamChannelCount = 1;
  let unavailableReason = null;
  let lastStartDiagnostic = null;
  const bundledHueCaPath = resolveHueCaPath();

  function hasSocketFailureSignature(message = "") {
    const lower = String(message || "").trim().toLowerCase();
    if (!lower) return false;
    return (
      lower.includes("socket is closed") ||
      lower.includes("socket closed") ||
      lower.includes("socket hang up") ||
      lower.includes("econnreset") ||
      lower.includes("broken pipe")
    );
  }

  function markTransitionFailure(message = "") {
    const socketFault = hasSocketFailureSignature(message);
    if (!socketFault) {
      return false;
    }
    active = false;
    try {
      bridge?.socket?.close?.();
    } catch {}
    if (bridge) {
      bridge.socket = null;
    }
    return true;
  }

  const isPlaceholderValue = value => {
    if (typeof fixtureRegistry.isLikelyPlaceholderValue === "function") {
      return fixtureRegistry.isLikelyPlaceholderValue(value);
    }
    return /replace_with|192\.168\.x\.x|x\.x\.x\.x|example/i.test(String(value || ""));
  };

  const sanitizeField = value => {
    const text = String(value || "").trim();
    if (!text) return "";
    if (isPlaceholderValue(text)) return "";
    return text;
  };

  const sanitizeHost = value => {
    const text = sanitizeField(value);
    if (!text) return "";
    return isPrivateOrLoopbackIpv4(text) ? text : "";
  };

  function hasValidBridgeConfig(cfg = {}) {
    const bridgeIp = sanitizeHost(cfg.bridgeIp);
    const username = sanitizeField(cfg.username);
    const bridgeId = sanitizeField(cfg.bridgeId);
    const clientKey = sanitizeField(cfg.clientKey);
    return Boolean(bridgeIp && username && bridgeId && clientKey);
  }

  try {
    ensureHueFetchCompatibility(log);
    ensureHueTrustStore({ bundledHueCaPath, log });
    // Optional dependency. Keep runtime working if absent.
    const hueSyncModule = require("hue-sync");
    HueSync = hueSyncModule?.default || hueSyncModule;
    if (typeof HueSync !== "function") {
      HueSync = null;
      unavailableReason = "hue-sync module loaded but constructor not found";
    }
  } catch (err) {
    unavailableReason = `hue-sync unavailable (${err.message})`;
  }

  function getBridgeConfig() {
    const hueFixtures = typeof fixtureRegistry.listEngineBy === "function"
      ? fixtureRegistry.listEngineBy("hue", "", { requireConfigured: true })
      : fixtureRegistry.listBy("hue", "", { requireConfigured: true });
    const allHueFixtures = typeof fixtureRegistry.listEngineBy === "function"
      ? fixtureRegistry.listEngineBy("hue")
      : fixtureRegistry.listBy("hue");
    const primary = hueFixtures[0];

    const bridgeIp = sanitizeHost(primary?.bridgeIp || process.env.HUE_BRIDGE_IP || "");
    const username = sanitizeField(primary?.username || process.env.HUE_USERNAME || "");
    const bridgeId = sanitizeField(primary?.bridgeId || process.env.HUE_BRIDGE_ID || "");
    const clientKey = sanitizeField(primary?.clientKey || process.env.HUE_CLIENT_KEY || "");

    // Prefer any explicit area configured on the same bridge, even if it's on
    // another Hue fixture entry.
    const mergedArea = allHueFixtures.find(f => {
      const areaId = sanitizeField(f?.entertainmentAreaId || "");
      if (!f || !areaId) return false;
      const sameIp = bridgeIp && f.bridgeIp && String(f.bridgeIp) === String(bridgeIp);
      const sameId = bridgeId && f.bridgeId && String(f.bridgeId).toUpperCase() === String(bridgeId).toUpperCase();
      return sameIp || sameId;
    })?.entertainmentAreaId;

    const entertainmentAreaId =
      sanitizeField(mergedArea) ||
      sanitizeField(primary?.entertainmentAreaId) ||
      sanitizeField(process.env.HUE_ENTERTAINMENT_AREA_ID) ||
      "";

    return {
      bridgeIp,
      username,
      bridgeId,
      clientKey,
      entertainmentAreaId
    };
  }

  function isConfigured() {
    const c = getBridgeConfig();
    return hasValidBridgeConfig(c);
  }

  async function fetchWithTimeout(url, timeoutMs = 1500) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  function stringifyError(err) {
    if (!err) return "unknown error";

    const parts = [];
    let message = err.message || String(err);
    if (message === "[object Object]") {
      try {
        message = JSON.stringify(err);
      } catch {
        message = "[object Object]";
      }
    }
    if (message) parts.push(redactSensitiveLogValue(message));

    if (err.description) parts.push(`description=${redactSensitiveLogValue(err.description)}`);
    if (err.type) parts.push(`type=${redactSensitiveLogValue(err.type)}`);

    const code = err.code || err.cause?.code;
    if (code) parts.push(`code=${redactSensitiveLogValue(code)}`);

    const causeMessage = err.cause?.message;
    if (causeMessage && causeMessage !== message) {
      parts.push(`cause=${redactSensitiveLogValue(causeMessage)}`);
    }

    return redactSensitiveLogValue(parts.join(" | "));
  }

  function buildTlsHint() {
    if (process.env.NODE_EXTRA_CA_CERTS) {
      return `NODE_EXTRA_CA_CERTS is set to "${process.env.NODE_EXTRA_CA_CERTS}"`;
    }

    if (fs.existsSync(bundledHueCaPath)) {
      return `set NODE_EXTRA_CA_CERTS=${bundledHueCaPath} before starting Node`;
    }

    return "set NODE_EXTRA_CA_CERTS to hue-sync/signify.pem before starting Node";
  }

  async function diagnoseStartFailure(err, cfg) {
    const base = stringifyError(err);
    const safeBridgeIp = redactSensitiveLogValue(cfg?.bridgeIp || "-", "-");
    const safeBridgeId = redactSensitiveLogValue(cfg?.bridgeId || "-", "-");
    const safeArea = cfg?.entertainmentAreaId ? "[configured]" : "auto-first";
    if (/dtls handshake timed out|handshake timed out/i.test(base)) {
      return (
        `${base} | bridge=${safeBridgeIp} id=${safeBridgeId} ` +
        `area=${safeArea} | ` +
        "possible causes: bridge/area busy in another app, stale entertainment session, or unstable LAN path"
      );
    }
    if (!/fetch failed/i.test(base)) {
      return base;
    }

    let httpProbe = "not-tested";
    let bridgeIdMismatch = "";

    try {
      const probe = await fetchWithTimeout(`http://${cfg.bridgeIp}/api/0/config`, 1500);
      const probeBody = await probe.json().catch(() => null);
      httpProbe = `reachable (HTTP ${probe.status})`;

      const discoveredBridgeId = String(probeBody?.bridgeid || "").toUpperCase();
      const configuredBridgeId = String(cfg.bridgeId || "").toUpperCase();
      if (
        discoveredBridgeId &&
        configuredBridgeId &&
        discoveredBridgeId !== configuredBridgeId
      ) {
        bridgeIdMismatch = ` | bridgeId mismatch (configured=${configuredBridgeId}, discovered=${discoveredBridgeId})`;
      }
    } catch (probeErr) {
      httpProbe = `unreachable (${stringifyError(probeErr)})`;
    }

    return (
      `fetch failed | bridge=${safeBridgeIp} id=${safeBridgeId} ` +
      `area=${safeArea} | httpProbe=${httpProbe}${bridgeIdMismatch} | ` +
      `likely Hue HTTPS trust/DNS issue. ${buildTlsHint()}`
    );
  }

  async function stopEntertainmentArea(bridgeRef, area, origin = "cleanup") {
    const areaId = area && (area.id || area.rid);
    const bridgeId = String(bridgeRef?.id || "").trim();
    const bridgeUrl = String(bridgeRef?.url || "").trim();
    if (
      !bridgeRef ||
      !areaId ||
      typeof bridgeRef.updateEntertainmentArea !== "function" ||
      !bridgeId ||
      !bridgeUrl
    ) {
      return;
    }
    try {
      await bridgeRef.updateEntertainmentArea(areaId, { action: "stop" });
      logHueEntVerbose(
        log,
        `[HUE][ENT] area stop (${redactSensitiveLogValue(origin)}) -> ${redactSensitiveLogValue(areaId)}`
      );
    } catch (err) {
      const detail = stringifyError(err);
      if (
        /ERR_INVALID_IP_ADDRESS/i.test(detail) ||
        /Invalid IP address:\s*undefined/i.test(detail)
      ) {
        logHueEntVerbose(log, `[HUE][ENT] area stop skipped (${origin}): ${detail}`);
        return;
      }
      log.warn?.(`[HUE][ENT] area stop failed (${origin}): ${detail}`);
    }
  }

  async function stopEntertainmentAreas(bridgeRef, areas = [], origin = "cleanup-batch") {
    const seen = new Set();
    for (const area of Array.isArray(areas) ? areas : []) {
      const areaId = getAreaIdentifier(area);
      if (!areaId || seen.has(areaId)) continue;
      seen.add(areaId);
      await stopEntertainmentArea(bridgeRef, area, `${origin}:${areaId}`);
      await wait(60);
    }
  }

  async function teardownBridge(bridgeRef, area, origin = "cleanup") {
    if (!bridgeRef) return;
    try {
      await stopEntertainmentArea(bridgeRef, area, origin);
    } catch {}
    try {
      bridgeRef.stop?.();
    } catch {}
    try {
      bridgeRef.abortionController?.abort?.();
    } catch {}
    try {
      bridgeRef.socket?.close?.();
    } catch {}
    try {
      bridgeRef.socket = null;
    } catch {}
    try {
      bridgeRef.abortionController = null;
    } catch {}
  }

  async function startBridgeStream(bridgeRef, areaCandidate, options = {}) {
    const timeoutMs = Math.max(
      1200,
      Number(options?.timeoutMs || options?.timeout || 3500)
    );
    const useOriginalStart = Boolean(options?.useOriginalStart);
    const modeTag = useOriginalStart ? "legacy-start" : "forced-start";
    return new Promise((resolve, reject) => {
      let settled = false;
      let clearSocketGuard = () => {};
      let socketPoll = null;
      let guardedSocket = null;

      const attachSocketGuard = socket => {
        if (!socket || socket === guardedSocket || typeof socket.once !== "function") return;
        guardedSocket = socket;
        const onSocketError = err => {
          finish(err instanceof Error ? err : new Error(String(err || "DTLS socket error")));
        };
        const onSocketClose = () => {
          finish(new Error("DTLS socket closed before connect"));
        };
        socket.once("error", onSocketError);
        socket.once("close", onSocketClose);
        clearSocketGuard = () => {
          socket.removeListener?.("error", onSocketError);
          socket.removeListener?.("close", onSocketClose);
        };
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (socketPoll) clearInterval(socketPoll);
        clearSocketGuard();
        try {
          bridgeRef?.abortionController?.abort?.();
        } catch {}
        try {
          bridgeRef?.socket?.close?.();
        } catch {}
        if (bridgeRef) {
          bridgeRef.socket = null;
        }
        reject(new Error(`DTLS connect timeout (${modeTag}, ${timeoutMs}ms)`));
      }, timeoutMs);

      const finish = err => {
        if (settled) return;
        settled = true;
        if (socketPoll) clearInterval(socketPoll);
        clearTimeout(timer);
        clearSocketGuard();
        if (err) reject(err);
        else resolve();
      };

      let startPromise;
      try {
        const startFn = useOriginalStart && typeof bridgeRef.__originalStart === "function"
          ? bridgeRef.__originalStart
          : bridgeRef.start.bind(bridgeRef);
        // Forward attempt timeout to HueSync/node-dtls-client socket creation.
        startPromise = startFn(areaCandidate, timeoutMs);
      } catch (err) {
        finish(err);
        return;
      }

      // hue-sync creates its socket after async REST calls; poll briefly until socket exists.
      socketPoll = setInterval(() => {
        attachSocketGuard(bridgeRef.socket);
      }, 10);
      attachSocketGuard(bridgeRef.socket);

      Promise.resolve(startPromise).then(() => finish()).catch(finish);
    });
  }

  function hsvToRgb(h, s, v) {
    const c = v * s;
    const hp = h / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r1 = 0;
    let g1 = 0;
    let b1 = 0;

    if (hp >= 0 && hp < 1) {
      r1 = c; g1 = x;
    } else if (hp < 2) {
      r1 = x; g1 = c;
    } else if (hp < 3) {
      g1 = c; b1 = x;
    } else if (hp < 4) {
      g1 = x; b1 = c;
    } else if (hp < 5) {
      r1 = x; b1 = c;
    } else {
      r1 = c; b1 = x;
    }

    const m = v - c;
    return {
      r: Math.round((r1 + m) * 255),
      g: Math.round((g1 + m) * 255),
      b: Math.round((b1 + m) * 255)
    };
  }

  function hueStateToRgb(state = {}) {
    const hue = Number(state.hue || 0);
    const sat = Number(state.sat || 0);
    const bri = Number(state.bri || 0);
    const h = ((hue % 65535) / 65535) * 360;
    const s = Math.max(0, Math.min(1, sat / 254));
    const v = Math.max(0, Math.min(1, bri / 254));
    return hsvToRgb(h, s, v);
  }

  function normalizeAreaToken(value) {
    return String(value || "").trim().toLowerCase();
  }

  function getAreaIdentifier(area) {
    return String(area?.id || area?.rid || "").trim();
  }

  function getAreaDisplayName(area) {
    return String(area?.name || area?.metadata?.name || getAreaIdentifier(area) || "unknown").trim();
  }

  function areaMatchesToken(area, token) {
    const requested = normalizeAreaToken(token);
    if (!requested) return false;
    const directId = normalizeAreaToken(area?.id || "");
    const rid = normalizeAreaToken(area?.rid || "");
    const name = normalizeAreaToken(area?.name || "");
    const metadataName = normalizeAreaToken(area?.metadata?.name || "");
    return requested === directId || requested === rid || requested === name || requested === metadataName;
  }

  function buildAreaStartCandidates(areas, requestedId) {
    const list = (Array.isArray(areas) ? areas : [])
      .filter(area => area && typeof area === "object")
      .slice(0, 8);
    if (!list.length) {
      return {
        candidates: [],
        requestedMatched: false
      };
    }

    const requested = normalizeAreaToken(requestedId);
    const requestedCandidate = requested
      ? (list.find(area => areaMatchesToken(area, requested)) || null)
      : null;

    const seen = new Set();
    const candidates = [];
    const pushUnique = area => {
      if (!area) return;
      const key = `${normalizeAreaToken(area?.id || "")}|${normalizeAreaToken(area?.rid || "")}|${normalizeAreaToken(area?.name || "")}`;
      if (!key || seen.has(key)) return;
      seen.add(key);
      candidates.push(area);
    };

    pushUnique(requestedCandidate);
    for (const area of list) pushUnique(area);

    return {
      candidates,
      requestedMatched: Boolean(requestedCandidate) || !requested
    };
  }

  function inferAreaChannelCount(area) {
    if (!area || typeof area !== "object") return 1;
    const channels = Array.isArray(area.channels) ? area.channels.length : 0;
    if (channels > 0) return channels;
    const lightServices = Array.isArray(area.light_services) ? area.light_services.length : 0;
    if (lightServices > 0) return lightServices;
    const serviceLocations = Array.isArray(area.locations?.service_locations)
      ? area.locations.service_locations.length
      : 0;
    if (serviceLocations > 0) return serviceLocations;
    return 1;
  }

  // [TITLE] Subsection: Lifecycle Start
  async function start() {
    if (active) {
      return { ok: true };
    }

    if (!HueSync) {
      return {
        ok: false,
        reason: unavailableReason || "hue-sync package not available"
      };
    }

    if (!isConfigured()) {
      unavailableReason = "missing Hue Entertainment credentials";
      return { ok: false, reason: unavailableReason };
    }

    const cfg = getBridgeConfig();

    let nextBridge = null;
    let nextArea = null;

    const createBridgeInstance = () => {
      const instance = new HueSync({
        credentials: {
          username: cfg.username,
          clientkey: cfg.clientKey
        },
        id: cfg.bridgeId,
        url: cfg.bridgeIp
      });
      if (cfg.bridgeId) instance.id = cfg.bridgeId;
      if (cfg.bridgeIp) instance.url = cfg.bridgeIp;
      registerBridgeDns(cfg.bridgeId, cfg.bridgeIp, log);
      installBridgeIpRequestOverride(instance, cfg, log);
      installBridgeDtlsStartOverride(instance, cfg, log);
      return instance;
    };

    try {
      nextBridge = createBridgeInstance();
      bridge = nextBridge;
      lastStartDiagnostic = null;

      const areas = await nextBridge.getEntertainmentAreas();
      const {
        candidates: areaCandidates,
        requestedMatched
      } = buildAreaStartCandidates(areas, cfg.entertainmentAreaId);

      if (!areaCandidates.length) {
        unavailableReason = "no entertainment area found";
        bridge = null;
        return { ok: false, reason: unavailableReason };
      }

      if (cfg.entertainmentAreaId && !requestedMatched) {
        log.warn?.(
          "[HUE][ENT] configured entertainment area not found; falling back to first available area"
        );
      }

      const maxAreaCandidates = Math.max(1, Math.min(2, areaCandidates.length));
      const preclearAreas = areaCandidates.slice(0, Math.max(2, maxAreaCandidates));
      const attemptsPrimary = [
        { timeoutMs: 6500, useOriginalStart: false, label: "forced-1" },
        { timeoutMs: 9000, useOriginalStart: false, label: "forced-2" }
      ];
      const attemptsFallback = [
        { timeoutMs: 8000, useOriginalStart: false, label: "forced-fallback-1" }
      ];
      if (HUE_ENT_ENABLE_ORIGINAL_START_FALLBACK) {
        attemptsPrimary.push({ timeoutMs: 10000, useOriginalStart: true, label: "legacy-compat" });
        attemptsFallback.push({ timeoutMs: 12000, useOriginalStart: true, label: "legacy-fallback" });
      }
      let started = false;
      let lastStartError = null;

      for (let areaIdx = 0; areaIdx < maxAreaCandidates && !started; areaIdx += 1) {
        const candidateArea = areaCandidates[areaIdx];
        const candidateAreaId = getAreaIdentifier(candidateArea);
        if (!candidateAreaId) continue;
        nextArea = candidateArea;

        const attempts = areaIdx === 0 ? attemptsPrimary : attemptsFallback;
        for (let i = 0; i < attempts.length; i += 1) {
          const attempt = attempts[i];
          const isInitialAttempt = areaIdx === 0 && i === 0;
          const attemptBridge = isInitialAttempt ? nextBridge : createBridgeInstance();
          const candidate = (!attempt.useOriginalStart && i === 0)
            ? candidateArea
            : { id: candidateAreaId, name: getAreaDisplayName(candidateArea) };

          try {
            // Clear stale sessions across top candidate areas before each connect attempt.
            await stopEntertainmentAreas(
              attemptBridge,
              preclearAreas,
              `start-preclear-${areaIdx + 1}-${i + 1}`
            );
            await wait(220 + (i * 120) + (areaIdx * 80));
            await startBridgeStream(attemptBridge, candidate, attempt);
            nextBridge = attemptBridge;
            bridge = attemptBridge;
            started = true;
            lastStartError = null;
            lastStartDiagnostic = {
              ok: true,
              area: getAreaDisplayName(candidateArea),
              areaIndex: areaIdx + 1,
              attempt: i + 1,
              mode: attempt.useOriginalStart ? "legacy-start" : "forced-start",
              timeoutMs: attempt.timeoutMs,
              at: Date.now()
            };
            break;
          } catch (err) {
            lastStartError = err;
            const attemptDetail = redactSensitiveLogValue(
              stringifyError(err),
              "start attempt failed"
            );
            lastStartDiagnostic = {
              ok: false,
              area: getAreaDisplayName(candidateArea),
              areaIndex: areaIdx + 1,
              attempt: i + 1,
              mode: attempt.useOriginalStart ? "legacy-start" : "forced-start",
              timeoutMs: attempt.timeoutMs,
              error: attemptDetail,
              at: Date.now()
            };
            log.warn?.(
              `[HUE][ENT] start attempt area ${areaIdx + 1}/${maxAreaCandidates} try ${i + 1}/${attempts.length} (${attempt.useOriginalStart ? "legacy" : "forced"}) failed: ${attemptDetail}`
            );
            await teardownBridge(
              attemptBridge,
              candidateArea,
              `start-retry-${areaIdx + 1}-${i + 1}`
            );
            if (bridge === attemptBridge && !started) {
              bridge = null;
            }
            await wait(280 + (i * 180) + (areaIdx * 140));
          }
        }
      }

      if (!started && lastStartError) {
        throw lastStartError;
      }
      if (!started) {
        throw new Error("no entertainment start attempts executed");
      }

      areaRef = nextArea;

      if (nextBridge.socket && typeof nextBridge.socket.on === "function") {
        nextBridge.socket.on("error", err => {
          const detail = redactSensitiveLogValue(stringifyError(err), "socket error");
          unavailableReason = detail;
          markTransitionFailure(detail);
          log.warn?.(`[HUE][ENT] socket error: ${detail}`);
        });
      }

      streamChannelCount = Math.max(1, inferAreaChannelCount(nextArea));
      unavailableReason = null;
      active = true;
      log.log?.(
        `[HUE][ENT] started (area-selected, channels=${streamChannelCount})`
      );
      return { ok: true };
    } catch (err) {
      await teardownBridge(nextBridge || bridge, nextArea || areaRef, "start-failed");

      active = false;
      bridge = null;
      areaRef = null;
      streamChannelCount = 1;
      unavailableReason = redactSensitiveLogValue(
        await diagnoseStartFailure(err, cfg),
        "entertainment start failed"
      );
      log.warn?.(`[HUE][ENT] start failed: ${unavailableReason}`);
      return { ok: false, reason: unavailableReason };
    }
  }

  // [TITLE] Subsection: Lifecycle Stop
  async function stop() {
    if (!bridge) {
      active = false;
      return;
    }

    const bridgeRef = bridge;
    const activeArea = areaRef;
    try {
      // Request stream stop over REST first while bridge metadata is intact.
      await teardownBridge(bridgeRef, activeArea, "stop");
    } catch (err) {
      const detail = redactSensitiveLogValue(err?.message || err, "stop warning");
      log.warn?.(`[HUE][ENT] stop warning: ${detail}`);
    } finally {
      active = false;
      bridge = null;
      areaRef = null;
      streamChannelCount = 1;
    }
  }

  // [TITLE] Subsection: Frame Send Path
  function send(state = {}, lightCount = 1) {
    if (!bridge) {
      throw new Error(unavailableReason || "entertainment bridge unavailable");
    }
    if (!active) {
      throw new Error(unavailableReason || "entertainment stream inactive");
    }

    const rgb = state.on === false
      ? { r: 0, g: 0, b: 0 }
      : hueStateToRgb(state);
    const requestedCount = Math.max(1, Number(lightCount || 1));
    const count = Math.max(1, Number(streamChannelCount || requestedCount));
    // hue-sync expects per-channel tuples: [R, G, B]
    const frame = Array.from(
      { length: count },
      () => [rgb.r, rgb.g, rgb.b]
    );

    const failHard = err => {
      const message = redactSensitiveLogValue(
        stringifyError(err),
        "entertainment transition failed"
      );
      unavailableReason = message;
      const socketFault = markTransitionFailure(message);
      if (!socketFault) {
        log.warn?.(`[HUE][ENT] transition warning: ${message}`);
        return;
      }
      throw new Error(message);
    };

    const socket = bridge.socket;
    if (
      socket &&
      (socket.destroyed === true ||
        socket.closed === true ||
        String(socket.readyState || "").toLowerCase() === "closed")
    ) {
      unavailableReason = "DTLS socket is closed";
      active = false;
      throw new Error(unavailableReason);
    }

    try {
      const p = bridge.transition(frame);
      if (p && typeof p.then === "function" && typeof p.catch === "function") {
        p.then(() => {
          unavailableReason = null;
        }).catch(err => {
          const message = redactSensitiveLogValue(stringifyError(err), "transition warning");
          unavailableReason = message;
          markTransitionFailure(message);
          log.warn?.(`[HUE][ENT] transition warning: ${message}`);
        });
      } else {
        unavailableReason = null;
      }
    } catch (err) {
      failHard(err);
    }
  }

  // [TITLE] Subsection: Status Surface
  function getStatus() {
    return {
      available: Boolean(HueSync),
      configured: isConfigured(),
      active,
      reason: unavailableReason,
      channelCount: streamChannelCount,
      startFallbackEnabled: HUE_ENT_ENABLE_ORIGINAL_START_FALLBACK,
      lastStart: lastStartDiagnostic
        ? { ...lastStartDiagnostic }
        : null,
      area: areaRef
        ? (areaRef.name || areaRef.id || areaRef.rid || null)
        : null
    };
  }

  return {
    start,
    stop,
    send,
    getStatus
  };
};
