// [TITLE] Module: mods/quiet-hours-mod/index.js
// [TITLE] Purpose: index

const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "config.json");

const DAY_TO_INDEX = new Map([
  ["sun", 0],
  ["sunday", 0],
  ["mon", 1],
  ["monday", 1],
  ["tue", 2],
  ["tues", 2],
  ["tuesday", 2],
  ["wed", 3],
  ["wednesday", 3],
  ["thu", 4],
  ["thur", 4],
  ["thurs", 4],
  ["thursday", 4],
  ["fri", 5],
  ["friday", 5],
  ["sat", 6],
  ["saturday", 6]
]);

const DEFAULT_CONFIG = {
  enabled: true,
  timezone: "local",
  windows: [
    {
      name: "night",
      days: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"],
      start: "22:30",
      end: "07:30"
    }
  ],
  hue: {
    maxBri: 130,
    maxSat: 185,
    minTransitionTime: 5
  },
  wiz: {
    maxBrightness: 0.42,
    minBrightness: 0.1,
    maxDimming: 42
  },
  strobeSuppression: {
    enabled: true,
    blockDrop: true,
    blockBeatBoost: true,
    minRateMsHue: 240,
    minRateMsWiz: 150
  }
};

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseTimeToMinutes(value) {
  const text = String(value || "").trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function minutesToTimeText(totalMinutes) {
  const mins = clamp(totalMinutes, 0, 1439, 0);
  const hh = String(Math.floor(mins / 60)).padStart(2, "0");
  const mm = String(mins % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function normalizeDays(days) {
  if (!Array.isArray(days) || !days.length) return [0, 1, 2, 3, 4, 5, 6];
  const result = [];
  for (const raw of days) {
    const idx = DAY_TO_INDEX.get(String(raw || "").trim().toLowerCase());
    if (idx === undefined) continue;
    if (!result.includes(idx)) result.push(idx);
  }
  return result.length ? result : [0, 1, 2, 3, 4, 5, 6];
}

function normalizeWindow(window, fallbackName = "window") {
  const startMinutes = parseTimeToMinutes(window?.start);
  const endMinutes = parseTimeToMinutes(window?.end);
  const start = startMinutes === null ? 22 * 60 + 30 : startMinutes;
  const end = endMinutes === null ? 7 * 60 + 30 : endMinutes;
  const days = normalizeDays(window?.days);
  return {
    name: String(window?.name || fallbackName).trim() || fallbackName,
    days,
    start,
    end,
    startText: minutesToTimeText(start),
    endText: minutesToTimeText(end)
  };
}

function ensureConfigFile() {
  if (fs.existsSync(CONFIG_PATH)) return;
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf8");
}

function normalizeConfig(raw = {}) {
  const cfg = {
    enabled: raw.enabled !== false,
    timezone: String(raw.timezone || "local").trim().toLowerCase() || "local",
    windows: [],
    hue: {
      maxBri: clamp(raw?.hue?.maxBri, 1, 254, DEFAULT_CONFIG.hue.maxBri),
      maxSat: clamp(raw?.hue?.maxSat, 0, 254, DEFAULT_CONFIG.hue.maxSat),
      minTransitionTime: Math.round(
        clamp(raw?.hue?.minTransitionTime, 0, 60, DEFAULT_CONFIG.hue.minTransitionTime)
      )
    },
    wiz: {
      maxBrightness: clamp(raw?.wiz?.maxBrightness, 0.05, 1, DEFAULT_CONFIG.wiz.maxBrightness),
      minBrightness: clamp(raw?.wiz?.minBrightness, 0, 1, DEFAULT_CONFIG.wiz.minBrightness),
      maxDimming: Math.round(clamp(raw?.wiz?.maxDimming, 10, 100, DEFAULT_CONFIG.wiz.maxDimming))
    },
    strobeSuppression: {
      enabled: raw?.strobeSuppression?.enabled !== false,
      blockDrop: raw?.strobeSuppression?.blockDrop !== false,
      blockBeatBoost: raw?.strobeSuppression?.blockBeatBoost !== false,
      minRateMsHue: Math.round(
        clamp(raw?.strobeSuppression?.minRateMsHue, 60, 2000, DEFAULT_CONFIG.strobeSuppression.minRateMsHue)
      ),
      minRateMsWiz: Math.round(
        clamp(raw?.strobeSuppression?.minRateMsWiz, 40, 1200, DEFAULT_CONFIG.strobeSuppression.minRateMsWiz)
      )
    }
  };

  if (cfg.wiz.minBrightness > cfg.wiz.maxBrightness) {
    const mid = (cfg.wiz.minBrightness + cfg.wiz.maxBrightness) / 2;
    cfg.wiz.minBrightness = Math.max(0, Math.min(1, mid - 0.05));
    cfg.wiz.maxBrightness = Math.max(0, Math.min(1, mid + 0.05));
  }

  const windows = Array.isArray(raw.windows) ? raw.windows : DEFAULT_CONFIG.windows;
  cfg.windows = windows.map((item, idx) => normalizeWindow(item, `window-${idx + 1}`));
  if (!cfg.windows.length) {
    cfg.windows = [normalizeWindow(DEFAULT_CONFIG.windows[0], "night")];
  }

  return cfg;
}

function loadConfig() {
  ensureConfigFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    return normalizeConfig(parsed);
  } catch {
    return normalizeConfig(DEFAULT_CONFIG);
  }
}

function dayBefore(dayIndex) {
  return dayIndex === 0 ? 6 : dayIndex - 1;
}

function isWindowActive(window, dayIndex, minutes) {
  if (!window || !Array.isArray(window.days)) return false;
  const startsToday = window.days.includes(dayIndex);
  if (window.start === window.end) {
    return startsToday;
  }
  if (window.start < window.end) {
    return startsToday && minutes >= window.start && minutes < window.end;
  }

  const previousDay = dayBefore(dayIndex);
  const startedYesterday = window.days.includes(previousDay);
  return (startsToday && minutes >= window.start) || (startedYesterday && minutes < window.end);
}

function getQuietWindow(config, now = new Date()) {
  const dayIndex = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  for (const window of config.windows) {
    if (isWindowActive(window, dayIndex, minutes)) {
      return window;
    }
  }
  return null;
}

function summarizeConfig(config) {
  return {
    enabled: config.enabled,
    timezone: config.timezone,
    windows: config.windows.map(window => ({
      name: window.name,
      days: window.days,
      start: window.startText,
      end: window.endText
    })),
    hue: { ...config.hue },
    wiz: { ...config.wiz },
    strobeSuppression: { ...config.strobeSuppression }
  };
}

module.exports = function createQuietHoursMod(api) {
  let config = loadConfig();
  let overrideMode = "auto"; // auto | on | off
  const stats = {
    seenIntents: 0,
    adjustedIntents: 0,
    adjustedHue: 0,
    adjustedWiz: 0,
    lastAdjustedAt: 0
  };

  function getQuietState(now = new Date()) {
    if (overrideMode === "on") {
      return { active: true, reason: "override_on", window: null };
    }
    if (overrideMode === "off") {
      return { active: false, reason: "override_off", window: null };
    }
    if (!config.enabled) {
      return { active: false, reason: "disabled", window: null };
    }
    const window = getQuietWindow(config, now);
    if (!window) return { active: false, reason: "outside_window", window: null };
    return { active: true, reason: "schedule", window };
  }

  function adjustHueIntent(intent) {
    if (!intent || intent.type !== "HUE_STATE" || !intent.state || typeof intent.state !== "object") {
      return false;
    }

    let changed = false;
    const state = intent.state;

    if (Number.isFinite(Number(state.bri))) {
      const bri = Math.round(clamp(state.bri, 1, config.hue.maxBri, config.hue.maxBri));
      if (bri !== state.bri) {
        state.bri = bri;
        changed = true;
      }
    }

    if (Number.isFinite(Number(state.sat))) {
      const sat = Math.round(clamp(state.sat, 0, config.hue.maxSat, config.hue.maxSat));
      if (sat !== state.sat) {
        state.sat = sat;
        changed = true;
      }
    }

    const minTransition = Math.max(0, Number(config.hue.minTransitionTime || 0));
    if (!Number.isFinite(Number(state.transitiontime)) || Number(state.transitiontime) < minTransition) {
      state.transitiontime = minTransition;
      changed = true;
    }

    if (config.strobeSuppression.enabled) {
      const minRate = Number(config.strobeSuppression.minRateMsHue || 0);
      if (!Number.isFinite(Number(intent.rateMs)) || Number(intent.rateMs) < minRate) {
        intent.rateMs = minRate;
        changed = true;
      }

      if (config.strobeSuppression.blockDrop && intent.drop === true) {
        intent.drop = false;
        changed = true;
      }

      if (intent.forceRate === true) {
        intent.forceRate = false;
        changed = true;
      }
      if (intent.forceDelta === true) {
        intent.forceDelta = false;
        changed = true;
      }
    }

    return changed;
  }

  function adjustWizIntent(intent) {
    if (!intent || intent.type !== "WIZ_PULSE") return false;
    let changed = false;

    if (Number.isFinite(Number(intent.brightness))) {
      const capped = clamp(intent.brightness, config.wiz.minBrightness, config.wiz.maxBrightness, config.wiz.maxBrightness);
      if (capped !== intent.brightness) {
        intent.brightness = capped;
        changed = true;
      }
    } else {
      intent.brightness = config.wiz.maxBrightness;
      changed = true;
    }

    if (intent.color && typeof intent.color === "object" && Number.isFinite(Number(intent.color.dimming))) {
      const dimming = Math.round(
        clamp(intent.color.dimming, 10, config.wiz.maxDimming, config.wiz.maxDimming)
      );
      if (dimming !== intent.color.dimming) {
        intent.color.dimming = dimming;
        changed = true;
      }
    }

    if (config.strobeSuppression.enabled) {
      const minRate = Number(config.strobeSuppression.minRateMsWiz || 0);
      if (!Number.isFinite(Number(intent.rateMs)) || Number(intent.rateMs) < minRate) {
        intent.rateMs = minRate;
        changed = true;
      }

      if (config.strobeSuppression.blockDrop && intent.drop === true) {
        intent.drop = false;
        changed = true;
      }

      if (config.strobeSuppression.blockBeatBoost && intent.beat === true) {
        intent.beat = false;
        changed = true;
      }

      if (intent.forceRate === true) {
        intent.forceRate = false;
        changed = true;
      }
      if (intent.forceDelta === true) {
        intent.forceDelta = false;
        changed = true;
      }
    }

    return changed;
  }

  function statusBody() {
    const quiet = getQuietState(new Date());
    return {
      ok: true,
      mod: "quiet-hours-mod",
      quietActive: quiet.active,
      quietReason: quiet.reason,
      activeWindow: quiet.window
        ? {
          name: quiet.window.name,
          start: quiet.window.startText,
          end: quiet.window.endText,
          days: quiet.window.days
        }
        : null,
      overrideMode,
      stats: { ...stats },
      config: summarizeConfig(config),
      now: new Date().toISOString()
    };
  }

  return {
    onLoad() {
      config = loadConfig();
      api.log(
        `loaded. windows=${config.windows.length}, enabled=${config.enabled}, timezone=${config.timezone}`
      );
    },

    onIntent(payload) {
      if (!payload || !payload.intent || typeof payload.intent !== "object") return;
      stats.seenIntents += 1;

      const quiet = getQuietState(new Date());
      if (!quiet.active) return;

      const intent = payload.intent;
      const hueChanged = adjustHueIntent(intent);
      const wizChanged = adjustWizIntent(intent);

      if (!hueChanged && !wizChanged) return;

      stats.adjustedIntents += 1;
      if (hueChanged) stats.adjustedHue += 1;
      if (wizChanged) stats.adjustedWiz += 1;
      stats.lastAdjustedAt = Date.now();
    },

    onHttp(request) {
      const action = String(request?.action || "status").trim().toLowerCase();

      if (action === "status") {
        return { status: 200, body: statusBody() };
      }

      if (action === "reload") {
        config = loadConfig();
        return {
          status: 200,
          body: {
            ok: true,
            reloaded: true,
            config: summarizeConfig(config)
          }
        };
      }

      if (action === "on") {
        overrideMode = "on";
        return { status: 200, body: { ok: true, overrideMode } };
      }

      if (action === "off") {
        overrideMode = "off";
        return { status: 200, body: { ok: true, overrideMode } };
      }

      if (action === "auto") {
        overrideMode = "auto";
        return { status: 200, body: { ok: true, overrideMode } };
      }

      return {
        status: 400,
        body: {
          ok: false,
          error: "unknown action",
          allowed: ["status", "reload", "on", "off", "auto"]
        }
      };
    }
  };
};
