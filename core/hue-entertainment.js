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
const tls = require("tls");
const https = require("https");
const axios = require("axios");

const nativeDnsLookup = dns.lookup.bind(dns);
const bridgeDnsMap = new Map();
let dnsPatchInstalled = false;
let hueCaInstalled = false;
const hueHttpsAgentByBridge = new Map();

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
  log.log?.("[HUE][ENT] installed bridge DNS patch");
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
      log.log?.("[HUE][ENT] using cross-fetch compatibility mode");
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

  const normalizedBridgeId = String(bridgeId || "").trim().toLowerCase();
  const allowInsecureTls = String(process.env.RAVE_HUE_ALLOW_INSECURE_TLS || "").trim().toLowerCase() === "true";

  const agent = new https.Agent({
    keepAlive: true,
    maxSockets: 8,
    rejectUnauthorized: !allowInsecureTls,
    servername: normalizedBridgeId || undefined,
    minVersion: "TLSv1.2"
  });
  hueHttpsAgentByBridge.set(key, agent);
  return agent;
}

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
  log.log?.(`[HUE][ENT] bridge IP request override active (${bridgeIp})`);
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
  log.log?.("[HUE][ENT] DTLS start override active (forced ciphers)");
  return true;
}

function parsePemCertificates(pemBundle = "") {
  const matches = String(pemBundle).match(
    /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g
  );
  return Array.isArray(matches) ? matches.map(s => s.trim()).filter(Boolean) : [];
}

function sanitizeLogDetail(value, fallback = "operation failed") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  return raw
    .replace(/(client[_-]?key|username|token|authorization|password|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, "$1[redacted]")
    .slice(0, 220);
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
    log.log?.("[HUE][ENT] installed Hue CA trust bundle");
    return true;
  } catch (err) {
    log.warn?.(`[HUE][ENT] failed to install Hue CA trust: ${err.message || err}`);
    return false;
  }
}

module.exports = function createHueEntertainmentTransport({ fixtureRegistry, log = console }) {
  let HueSync = null;
  let bridge = null;
  let active = false;
  let areaRef = null;
  let streamChannelCount = 1;
  let unavailableReason = null;
  const bundledHueCaPath = resolveHueCaPath();

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
    if (typeof fixtureRegistry.isLikelyNetworkHost === "function") {
      return fixtureRegistry.isLikelyNetworkHost(text) ? text : "";
    }
    return text;
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
    if (message) parts.push(String(message));

    if (err.description) parts.push(`description=${err.description}`);
    if (err.type) parts.push(`type=${err.type}`);

    const code = err.code || err.cause?.code;
    if (code) parts.push(`code=${code}`);

    const causeMessage = err.cause?.message;
    if (causeMessage && causeMessage !== message) {
      parts.push(`cause=${causeMessage}`);
    }

    return parts.join(" | ");
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
    if (/dtls handshake timed out|handshake timed out/i.test(base)) {
      return (
        `${base} | bridge=${cfg.bridgeIp} id=${cfg.bridgeId || "-"} ` +
        `area=${cfg.entertainmentAreaId || "auto-first"} | ` +
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
      `fetch failed | bridge=${cfg.bridgeIp} id=${cfg.bridgeId || "-"} ` +
      `area=${cfg.entertainmentAreaId || "auto-first"} | httpProbe=${httpProbe}${bridgeIdMismatch} | ` +
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
      log.log?.(`[HUE][ENT] area stop (${origin}) -> ${areaId}`);
    } catch (err) {
      const detail = stringifyError(err);
      if (
        /ERR_INVALID_IP_ADDRESS/i.test(detail) ||
        /Invalid IP address:\s*undefined/i.test(detail)
      ) {
        log.log?.(`[HUE][ENT] area stop skipped (${origin}): ${detail}`);
        return;
      }
      log.warn?.(`[HUE][ENT] area stop failed (${origin}): ${detail}`);
    }
  }

  async function startBridgeStream(bridgeRef, areaCandidate, timeoutMs = 3500) {
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
        socket.once("error", onSocketError);
        clearSocketGuard = () => {
          socket.removeListener?.("error", onSocketError);
        };
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (socketPoll) clearInterval(socketPoll);
        clearSocketGuard();
        reject(new Error("DTLS connect timeout"));
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
        startPromise = bridgeRef.start(areaCandidate);
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

  function pickArea(areas, requestedId) {
    if (!Array.isArray(areas) || !areas.length) return null;
    if (!requestedId) return areas[0];

    const requested = String(requestedId).toLowerCase();
    return (
      areas.find(a => String(a.id || "").toLowerCase() === requested) ||
      areas.find(a => String(a.rid || "").toLowerCase() === requested) ||
      areas.find(a => String(a.name || "").toLowerCase() === requested) ||
      null
    );
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

    try {
      nextBridge = new HueSync({
        credentials: {
          username: cfg.username,
          clientkey: cfg.clientKey
        },
        id: cfg.bridgeId,
        url: cfg.bridgeIp
      });
      if (cfg.bridgeId) nextBridge.id = cfg.bridgeId;
      if (cfg.bridgeIp) nextBridge.url = cfg.bridgeIp;
      registerBridgeDns(cfg.bridgeId, cfg.bridgeIp, log);
      installBridgeIpRequestOverride(nextBridge, cfg, log);
      installBridgeDtlsStartOverride(nextBridge, cfg, log);
      bridge = nextBridge;

      const areas = await nextBridge.getEntertainmentAreas();
      nextArea = pickArea(areas, cfg.entertainmentAreaId);
      areaRef = nextArea;
      if (!nextArea) {
        unavailableReason = "no entertainment area found";
        bridge = null;
        return { ok: false, reason: unavailableReason };
      }

      const retryAreaId = nextArea.id || nextArea.rid || cfg.entertainmentAreaId;
      const attempts = [7000, 10000, 13000];
      let started = false;
      let lastStartError = null;

      // Clear stale area state before attempting DTLS stream.
      if (retryAreaId) {
        await stopEntertainmentArea(nextBridge, nextArea, "start-preclear");
        await wait(220);
      }

      for (let i = 0; i < attempts.length; i += 1) {
        const timeoutMs = attempts[i];
        const candidate = i === 0 || !retryAreaId
          ? nextArea
          : { id: retryAreaId, name: nextArea.name || retryAreaId };

        try {
          await startBridgeStream(nextBridge, candidate, timeoutMs);
          started = true;
          lastStartError = null;
          break;
        } catch (err) {
          lastStartError = err;
          log.warn?.(
            `[HUE][ENT] start attempt ${i + 1}/${attempts.length} failed: ${stringifyError(err)}`
          );
          await stopEntertainmentArea(nextBridge, nextArea, `start-retry-${i + 1}`);
          await wait(260 + (i * 180));
        }
      }

      if (!started && lastStartError) {
        throw lastStartError;
      }

      if (nextBridge.socket && typeof nextBridge.socket.on === "function") {
        nextBridge.socket.on("error", err => {
          const detail = stringifyError(err);
          unavailableReason = detail;
          log.warn?.(`[HUE][ENT] socket error: ${detail}`);
        });
      }

      streamChannelCount = Math.max(1, inferAreaChannelCount(nextArea));
      unavailableReason = null;
      active = true;
      log.log?.(
        `[HUE][ENT] started (${nextArea.name || nextArea.id || nextArea.rid || "area"}, channels=${streamChannelCount})`
      );
      return { ok: true };
    } catch (err) {
      await stopEntertainmentArea(nextBridge || bridge, nextArea || areaRef, "start-failed");

      active = false;
      bridge = null;
      areaRef = null;
      streamChannelCount = 1;
      unavailableReason = await diagnoseStartFailure(err, cfg);
      log.warn?.(`[HUE][ENT] start failed: ${sanitizeLogDetail(unavailableReason)}`);
      return { ok: false, reason: unavailableReason };
    }
  }

  async function stop() {
    if (!bridge) {
      active = false;
      return;
    }

    const bridgeRef = bridge;
    const activeArea = areaRef;
    try {
      // Request stream stop over REST first while bridge metadata is intact.
      await stopEntertainmentArea(bridgeRef, activeArea, "stop");
      await bridgeRef.stop();
    } catch (err) {
      log.warn?.(`[HUE][ENT] stop warning: ${err.message || err}`);
    } finally {
      active = false;
      bridge = null;
      areaRef = null;
      streamChannelCount = 1;
    }
  }

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
      const message = stringifyError(err) || "entertainment transition failed";
      unavailableReason = message;
      const lower = message.toLowerCase();
      const socketClosed =
        lower.includes("socket is closed") ||
        lower.includes("socket closed") ||
        lower.includes("socket hang up") ||
        lower.includes("econnreset") ||
        lower.includes("broken pipe");
      if (socketClosed) {
        active = false;
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
      if (p && typeof p.catch === "function") {
        p.catch(err => {
          const message = stringifyError(err);
          unavailableReason = message;
          const lower = String(message || "").toLowerCase();
          const socketClosed =
            lower.includes("socket is closed") ||
            lower.includes("socket closed") ||
            lower.includes("socket hang up") ||
            lower.includes("econnreset") ||
            lower.includes("broken pipe");
          if (socketClosed) {
            active = false;
          }
          log.warn?.(`[HUE][ENT] transition warning: ${message}`);
        });
      }
    } catch (err) {
      failHard(err);
    }
  }

  function getStatus() {
    return {
      available: Boolean(HueSync),
      configured: isConfigured(),
      active,
      reason: unavailableReason,
      channelCount: streamChannelCount,
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
