// [TITLE] Module: mods/http-rgb-brand-mod/index.js
// [TITLE] Purpose: index

const fs = require("fs");
const path = require("path");
const axios = require("axios");

const CONFIG_PATH = path.join(__dirname, "config.json");
const SUPPORTED_INTENTS = new Set(["HUE_STATE", "WIZ_PULSE", "TWITCH_HUE", "TWITCH_WIZ"]);
const DEFAULT_CONFIG = {
  enabled: true,
  brand: "http-rgb",
  intentModes: {
    engine: true,
    twitch: true
  },
  http: {
    method: "POST",
    timeoutMs: 1200,
    authHeader: "X-Api-Key"
  },
  scheduler: {
    defaultMinIntervalMs: 100,
    defaultMinColorDelta: 8,
    defaultMinDimmingDelta: 3
  },
  mapping: {
    fallback: {
      r: 255,
      g: 110,
      b: 20,
      dimming: 50
    }
  },
  targets: []
};

function clamp(value, min, max, fallback = min) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeBrand(raw) {
  return String(raw || "").trim().toLowerCase();
}

function normalizeMethod(raw) {
  const method = String(raw || "POST").trim().toUpperCase();
  return method || "POST";
}

function normalizeToken(raw) {
  return String(raw || "").trim();
}

function normalizeTarget(raw = {}, fallback = {}) {
  const id = String(raw.id || fallback.id || "").trim();
  const endpoint = String(raw.endpoint || raw.url || fallback.endpoint || "").trim();
  const zone = String(raw.zone || fallback.zone || "default").trim().toLowerCase() || "default";
  const method = normalizeMethod(raw.method || fallback.method || "");
  const token = normalizeToken(raw.token || fallback.token || "");
  const enabled = raw.enabled !== false;
  const headers = raw.headers && typeof raw.headers === "object" ? { ...raw.headers } : {};
  const minIntervalMs = Math.max(
    0,
    Math.round(Number(raw.minIntervalMs ?? fallback.minIntervalMs) || 0)
  );
  const minColorDelta = Math.max(
    0,
    Math.round(Number(raw.minColorDelta ?? fallback.minColorDelta) || 0)
  );
  const minDimmingDelta = Math.max(
    0,
    Math.round(Number(raw.minDimmingDelta ?? fallback.minDimmingDelta) || 0)
  );

  return {
    id,
    endpoint,
    zone,
    method,
    token,
    enabled,
    headers,
    minIntervalMs,
    minColorDelta,
    minDimmingDelta
  };
}

function normalizeConfig(raw = {}) {
  const brand = normalizeBrand(raw.brand || DEFAULT_CONFIG.brand);
  const fallback = raw?.mapping?.fallback || DEFAULT_CONFIG.mapping.fallback;
  const scheduler = raw?.scheduler || {};
  const http = raw?.http || {};
  const intentModes = raw?.intentModes || {};

  return {
    enabled: raw.enabled !== false,
    brand: brand || DEFAULT_CONFIG.brand,
    intentModes: {
      engine: intentModes.engine !== false,
      twitch: intentModes.twitch !== false
    },
    http: {
      method: normalizeMethod(http.method || DEFAULT_CONFIG.http.method),
      timeoutMs: Math.round(clamp(http.timeoutMs, 200, 10000, DEFAULT_CONFIG.http.timeoutMs)),
      authHeader: String(http.authHeader || DEFAULT_CONFIG.http.authHeader).trim() || DEFAULT_CONFIG.http.authHeader
    },
    scheduler: {
      defaultMinIntervalMs: Math.max(
        0,
        Math.round(Number(scheduler.defaultMinIntervalMs) || DEFAULT_CONFIG.scheduler.defaultMinIntervalMs)
      ),
      defaultMinColorDelta: Math.max(
        0,
        Math.round(Number(scheduler.defaultMinColorDelta) || DEFAULT_CONFIG.scheduler.defaultMinColorDelta)
      ),
      defaultMinDimmingDelta: Math.max(
        0,
        Math.round(Number(scheduler.defaultMinDimmingDelta) || DEFAULT_CONFIG.scheduler.defaultMinDimmingDelta)
      )
    },
    mapping: {
      fallback: {
        r: Math.round(clamp(fallback.r, 0, 255, DEFAULT_CONFIG.mapping.fallback.r)),
        g: Math.round(clamp(fallback.g, 0, 255, DEFAULT_CONFIG.mapping.fallback.g)),
        b: Math.round(clamp(fallback.b, 0, 255, DEFAULT_CONFIG.mapping.fallback.b)),
        dimming: Math.round(clamp(fallback.dimming, 1, 100, DEFAULT_CONFIG.mapping.fallback.dimming))
      }
    },
    targets: Array.isArray(raw.targets)
      ? raw.targets.map((item, idx) => normalizeTarget(item, { id: `target-${idx + 1}` }))
      : []
  };
}

function readConfigFile() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf8");
    return normalizeConfig(DEFAULT_CONFIG);
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    return normalizeConfig(parsed);
  } catch {
    return normalizeConfig(DEFAULT_CONFIG);
  }
}

function hsvToRgb(h, s, v) {
  const hh = ((Number(h) % 360) + 360) % 360;
  const ss = clamp(s, 0, 1, 0);
  const vv = clamp(v, 0, 1, 0);

  const c = vv * ss;
  const x = c * (1 - Math.abs((hh / 60) % 2 - 1));
  const m = vv - c;

  let rp = 0;
  let gp = 0;
  let bp = 0;

  if (hh < 60) [rp, gp, bp] = [c, x, 0];
  else if (hh < 120) [rp, gp, bp] = [x, c, 0];
  else if (hh < 180) [rp, gp, bp] = [0, c, x];
  else if (hh < 240) [rp, gp, bp] = [0, x, c];
  else if (hh < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];

  return {
    r: Math.round((rp + m) * 255),
    g: Math.round((gp + m) * 255),
    b: Math.round((bp + m) * 255)
  };
}

function buildRgbFromHueIntent(intent, fallback) {
  const state = intent && typeof intent.state === "object" ? intent.state : {};
  const hue = Number(state.hue);
  const sat = Number(state.sat);
  const bri = Number(state.bri);
  if (Number.isFinite(hue) && Number.isFinite(sat) && Number.isFinite(bri)) {
    const rgb = hsvToRgb((hue / 65535) * 360, sat / 254, bri / 254);
    return {
      ...rgb,
      dimming: Math.round(clamp((bri / 254) * 100, 1, 100, fallback.dimming))
    };
  }
  return { ...fallback };
}

function buildRgbFromWizIntent(intent, fallback) {
  const color = intent && typeof intent.color === "object" ? intent.color : {};
  const fromColor = {
    r: Math.round(clamp(color.r, 0, 255, fallback.r)),
    g: Math.round(clamp(color.g, 0, 255, fallback.g)),
    b: Math.round(clamp(color.b, 0, 255, fallback.b))
  };
  const brightness = Number(intent?.brightness);
  const dimming = Number.isFinite(Number(color.dimming))
    ? Math.round(clamp(color.dimming, 1, 100, fallback.dimming))
    : Number.isFinite(brightness)
      ? Math.round(clamp(brightness * 100, 1, 100, fallback.dimming))
      : fallback.dimming;
  return {
    ...fromColor,
    dimming
  };
}

function mapIntentToRgb(intent, fallback) {
  if (!intent || typeof intent !== "object") return null;
  if (intent.type === "HUE_STATE" || intent.type === "TWITCH_HUE") {
    return buildRgbFromHueIntent(intent, fallback);
  }
  if (intent.type === "WIZ_PULSE" || intent.type === "TWITCH_WIZ") {
    return buildRgbFromWizIntent(intent, fallback);
  }
  return null;
}

function routeModeForIntent(intentType) {
  if (intentType === "TWITCH_HUE" || intentType === "TWITCH_WIZ") return "twitch";
  return "engine";
}

module.exports = function createHttpRgbBrandMod(api) {
  let config = readConfigFile();
  const inFlight = new Set();
  const stats = {
    seenIntents: 0,
    targetAttempts: 0,
    sent: 0,
    skippedDisabled: 0,
    skippedMode: 0,
    skippedNoTarget: 0,
    skippedRoute: 0,
    skippedGate: 0,
    skippedInflight: 0,
    sendErrors: 0,
    lastSendAt: 0
  };

  const gate = api.createStateGate?.({
    minIntervalMs: config.scheduler.defaultMinIntervalMs,
    minColorDelta: config.scheduler.defaultMinColorDelta,
    minDimmingDelta: config.scheduler.defaultMinDimmingDelta
  });

  function reloadConfig() {
    config = readConfigFile();
    gate?.reset?.();
    return config;
  }

  function getConfigTargetsById() {
    const byId = new Map();
    for (const item of config.targets || []) {
      const target = normalizeTarget(item);
      if (!target.id || !target.endpoint) continue;
      byId.set(target.id, target);
    }
    return byId;
  }

  function getFixtureTargets(mode) {
    const fixtures = api.getFixturesBy?.({
      brand: config.brand,
      mode,
      enabledOnly: true
    }) || [];

    return fixtures
      .map(fixture => {
        const target = normalizeTarget(fixture, {
          id: String(fixture.id || "").trim(),
          zone: String(fixture.zone || "default").trim().toLowerCase(),
          method: config.http.method
        });
        return {
          ...target,
          fixtureId: String(fixture.id || "").trim(),
          fixtureZone: String(fixture.zone || "default").trim().toLowerCase()
        };
      })
      .filter(target => target.fixtureId && target.endpoint);
  }

  function mergeTargets(mode) {
    const byId = getConfigTargetsById();
    const fixtureTargets = getFixtureTargets(mode);
    for (const target of fixtureTargets) {
      const fallback = byId.get(target.fixtureId) || {};
      byId.set(target.fixtureId, normalizeTarget(target, fallback));
    }
    return [...byId.values()].filter(item => item.enabled !== false && item.endpoint && item.id);
  }

  function resolveIntentZones(intent, mode) {
    const zones = api.getIntentZones?.(intent, {
      brand: config.brand,
      mode,
      fallbackZone: "default"
    });
    if (Array.isArray(zones) && zones.length) {
      return zones.map(z => String(z || "").trim().toLowerCase()).filter(Boolean);
    }
    if (intent && typeof intent.zone === "string") {
      return [String(intent.zone).trim().toLowerCase()].filter(Boolean);
    }
    return [];
  }

  function shouldAllowMode(intentType) {
    const mode = routeModeForIntent(intentType);
    if (mode === "twitch") return config.intentModes.twitch !== false;
    return config.intentModes.engine !== false;
  }

  function buildHeaders(target) {
    const headers = {
      "Content-Type": "application/json",
      ...((target.headers && typeof target.headers === "object") ? target.headers : {})
    };
    if (target.token) {
      headers[String(config.http.authHeader || "X-Api-Key")] = target.token;
    }
    return headers;
  }

  function sendToTarget(target, state, intentType) {
    const key = String(target.id || "").trim();
    if (!key) return;
    if (inFlight.has(key)) {
      stats.skippedInflight += 1;
      return;
    }

    const method = normalizeMethod(target.method || config.http.method);
    const payload = {
      on: state.dimming > 0,
      rgb: {
        r: state.r,
        g: state.g,
        b: state.b
      },
      dimming: state.dimming,
      source: "ravelink-bridge",
      fixtureBrand: config.brand,
      fixtureId: target.id,
      zone: target.zone || "default",
      intentType
    };

    inFlight.add(key);
    stats.targetAttempts += 1;
    axios({
      method,
      url: target.endpoint,
      timeout: config.http.timeoutMs,
      headers: buildHeaders(target),
      data: payload
    })
      .then(() => {
        stats.sent += 1;
        stats.lastSendAt = Date.now();
      })
      .catch(err => {
        stats.sendErrors += 1;
        api.warn(`send failed (${target.id}):`, err.message || err);
      })
      .finally(() => {
        inFlight.delete(key);
      });
  }

  function statusBody() {
    const availableFixtures = api.getFixturesBy?.({
      brand: config.brand,
      enabledOnly: true
    }) || [];
    return {
      ok: true,
      mod: "http-rgb-brand-mod",
      brand: config.brand,
      config,
      fixtures: availableFixtures.map(item => ({
        id: item.id,
        zone: item.zone,
        enabled: item.enabled,
        engineEnabled: item.engineEnabled,
        twitchEnabled: item.twitchEnabled,
        endpoint: item.endpoint || item.url || ""
      })),
      stats: { ...stats },
      inFlight: inFlight.size,
      now: new Date().toISOString()
    };
  }

  return {
    onLoad() {
      reloadConfig();
      api.log(`loaded for brand=${config.brand}`);
    },

    onIntent(payload) {
      const intent = payload?.intent;
      if (!intent || typeof intent !== "object") return;
      if (!SUPPORTED_INTENTS.has(String(intent.type || ""))) return;

      stats.seenIntents += 1;
      if (!config.enabled) {
        stats.skippedDisabled += 1;
        return;
      }

      if (!shouldAllowMode(intent.type)) {
        stats.skippedMode += 1;
        return;
      }

      const fallback = api.normalizeRgbState?.(config.mapping.fallback, DEFAULT_CONFIG.mapping.fallback)
        || normalizeConfig(DEFAULT_CONFIG).mapping.fallback;
      const mapped = mapIntentToRgb(intent, fallback);
      if (!mapped) return;
      const state = api.normalizeRgbState?.(mapped, fallback) || mapped;
      const mode = routeModeForIntent(intent.type);
      const zones = new Set(resolveIntentZones(intent, mode));
      const targets = mergeTargets(mode);

      if (!targets.length) {
        stats.skippedNoTarget += 1;
        return;
      }

      for (const target of targets) {
        const zone = String(target.zone || "default").trim().toLowerCase();
        if (zones.size > 0 && !zones.has(zone)) {
          stats.skippedRoute += 1;
          continue;
        }

        const allow = gate?.shouldSend?.(target.id, state, {
          minIntervalMs: target.minIntervalMs || config.scheduler.defaultMinIntervalMs,
          minColorDelta: target.minColorDelta || config.scheduler.defaultMinColorDelta,
          minDimmingDelta: target.minDimmingDelta || config.scheduler.defaultMinDimmingDelta
        });
        if (allow === false) {
          stats.skippedGate += 1;
          continue;
        }

        sendToTarget(target, state, intent.type);
      }
    },

    onHttp(request) {
      const action = String(request?.action || "status").trim().toLowerCase();

      if (action === "status") {
        return { status: 200, body: statusBody() };
      }

      if (action === "reload") {
        reloadConfig();
        return {
          status: 200,
          body: {
            ok: true,
            reloaded: true,
            config
          }
        };
      }

      if (action === "test") {
        const body = request?.body && typeof request.body === "object" ? request.body : {};
        const id = String(body.id || "").trim();
        const method = normalizeMethod(body.method || config.http.method);
        const endpoint = String(body.endpoint || "").trim();
        const token = normalizeToken(body.token || "");
        const fallback = api.normalizeRgbState?.(config.mapping.fallback, DEFAULT_CONFIG.mapping.fallback)
          || normalizeConfig(DEFAULT_CONFIG).mapping.fallback;
        const state = api.normalizeRgbState?.(body, fallback) || fallback;

        if (!endpoint && !id) {
          return {
            status: 400,
            body: { ok: false, error: "provide id (existing target) or endpoint" }
          };
        }

        let target = null;
        if (id) {
          target = mergeTargets("engine").find(item => item.id === id) || null;
          if (!target && !endpoint) {
            return {
              status: 404,
              body: { ok: false, error: "target not found", id }
            };
          }
        }

        const resolved = normalizeTarget({
          id: id || "manual-test",
          endpoint: endpoint || target?.endpoint || "",
          zone: target?.zone || "default",
          method,
          token: token || target?.token || "",
          headers: target?.headers || {}
        });

        sendToTarget(resolved, state, "MOD_TEST");
        return {
          status: 200,
          body: {
            ok: true,
            queued: true,
            target: {
              id: resolved.id,
              endpoint: resolved.endpoint,
              zone: resolved.zone
            },
            state
          }
        };
      }

      return {
        status: 400,
        body: {
          ok: false,
          error: "unknown action",
          allowed: ["status", "reload", "test"]
        }
      };
    }
  };
};
