// [TITLE] Module: core/midi/midi-learn.js
// [TITLE] Purpose: midi-learn

const fs = require("fs");
const path = require("path");

const MAP_PATH = path.join(__dirname, "..", "midi-map.json");
const ACTIONS = Object.freeze([
  "drop",
  "overclock_toggle",
  "overclock_on",
  "overclock_off",
  "overclock_up",
  "overclock_down",
  "behavior_auto",
  "behavior_clamp",
  "behavior_interpret",
  "scene_auto",
  "scene_idle",
  "scene_flow",
  "scene_pulse",
  "auto_profile_reactive",
  "auto_profile_balanced",
  "auto_profile_cinematic",
  "audio_reactivity_balanced",
  "audio_reactivity_aggressive",
  "audio_reactivity_precision",
  "meta_auto_toggle",
  "meta_auto_on",
  "meta_auto_off"
]);
const ACTION_SET = new Set(ACTIONS);
const TYPE_SET = new Set(["note", "cc"]);

const DEFAULT_BINDINGS = Object.freeze({
  drop: Object.freeze({ type: "note", number: 36, channel: null, minValue: 1 }),
  overclock_toggle: Object.freeze({ type: "cc", number: 64, channel: null, minValue: 64 })
});

const DEFAULT_CONFIG = Object.freeze({
  version: 2,
  enabled: true,
  deviceIndex: null,
  deviceMatch: "",
  velocityThreshold: 1,
  bindings: DEFAULT_BINDINGS
});

let learnState = {
  target: null,
  startedAt: 0,
  expiresAt: 0
};

function safeClone(obj) {
  return JSON.parse(JSON.stringify(obj || {}));
}

function toInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function normalizeAction(action) {
  let key = String(action || "").trim().toLowerCase();
  if (key === "overclock" || key === "oc") key = "overclock_toggle";
  return ACTION_SET.has(key) ? key : "";
}

function normalizeType(type, fallback = "note") {
  const key = String(type || "").trim().toLowerCase();
  return TYPE_SET.has(key) ? key : fallback;
}

function normalizeBinding(binding, fallback = null) {
  if (!binding || typeof binding !== "object") {
    return fallback ? safeClone(fallback) : null;
  }

  const fallbackType = normalizeType(fallback?.type || "note");
  const fallbackNumber = Number.isFinite(Number(fallback?.number))
    ? toInt(fallback.number, 0, 127, 36)
    : 36;
  const fallbackMinValue = Number.isFinite(Number(fallback?.minValue))
    ? toInt(fallback.minValue, 0, 127, fallbackType === "cc" ? 64 : 1)
    : (fallbackType === "cc" ? 64 : 1);
  const fallbackChannel = Number.isInteger(Number(fallback?.channel))
    ? toInt(fallback.channel, 0, 15, null)
    : null;

  const type = normalizeType(binding.type, fallbackType);
  const number = toInt(binding.number, 0, 127, fallbackNumber);
  const channel = binding.channel === null || binding.channel === undefined || binding.channel === ""
    ? null
    : toInt(binding.channel, 0, 15, fallbackChannel);
  const minValue = toInt(binding.minValue, 0, 127, fallbackMinValue ?? (type === "cc" ? 64 : 1));

  return {
    type,
    number,
    channel,
    minValue
  };
}

function normalizeDeviceIndex(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function parseLegacyBindings(raw) {
  const bindings = {};

  if (raw && typeof raw === "object") {
    if (raw.drop && typeof raw.drop === "object") {
      bindings.drop = normalizeBinding(raw.drop, DEFAULT_BINDINGS.drop);
    }
    if (raw.overclock && typeof raw.overclock === "object") {
      bindings.overclock_toggle = normalizeBinding(raw.overclock, DEFAULT_BINDINGS.overclock_toggle);
    }
  }

  const ccMap = raw && raw.cc && typeof raw.cc === "object" ? raw.cc : {};
  const noteMap = raw && raw.note && typeof raw.note === "object" ? raw.note : {};

  for (const [number, action] of Object.entries(ccMap)) {
    const key = normalizeAction(action);
    if (!key) continue;
    bindings[key] = normalizeBinding({
      type: "cc",
      number: Number(number),
      channel: null,
      minValue: 64
    }, DEFAULT_BINDINGS[key] || { type: "cc", number: 0, channel: null, minValue: 64 });
  }

  for (const [number, action] of Object.entries(noteMap)) {
    const key = normalizeAction(action);
    if (!key) continue;
    bindings[key] = normalizeBinding({
      type: "note",
      number: Number(number),
      channel: null,
      minValue: 1
    }, DEFAULT_BINDINGS[key] || { type: "note", number: 0, channel: null, minValue: 1 });
  }

  return bindings;
}

function normalizeConfig(rawConfig) {
  const raw = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  const base = safeClone(DEFAULT_CONFIG);

  const normalized = {
    version: 2,
    enabled: raw.enabled === undefined ? base.enabled : Boolean(raw.enabled),
    deviceIndex: normalizeDeviceIndex(raw.deviceIndex),
    deviceMatch: String(raw.deviceMatch || "").trim(),
    velocityThreshold: toInt(raw.velocityThreshold, 0, 127, base.velocityThreshold),
    bindings: {}
  };

  const defaultBindings = safeClone(DEFAULT_BINDINGS);
  const rawBindings = raw.bindings && typeof raw.bindings === "object" ? raw.bindings : {};
  const legacyBindings = parseLegacyBindings(raw);
  const merged = { ...defaultBindings, ...legacyBindings, ...rawBindings };

  for (const [action, value] of Object.entries(merged)) {
    const key = normalizeAction(action);
    if (!key) continue;
    normalized.bindings[key] = normalizeBinding(
      value,
      defaultBindings[key] || { type: "note", number: 36, channel: null, minValue: 1 }
    );
  }

  return normalized;
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(MAP_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeConfig(parsed);
  } catch {
    return normalizeConfig(DEFAULT_CONFIG);
  }
}

let config = loadConfig();

function saveConfig() {
  try {
    fs.writeFileSync(MAP_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  } catch (err) {
    console.warn("[MIDI] failed to save map:", err?.message || err);
  }
}

function getLearnState() {
  return {
    target: learnState.target,
    startedAt: learnState.startedAt || 0,
    expiresAt: learnState.expiresAt || 0
  };
}

module.exports = {
  getActions() {
    return [...ACTIONS];
  },

  getConfig() {
    return safeClone(config);
  },

  patchConfig(patch = {}) {
    const candidate = {
      ...config,
      ...(patch && typeof patch === "object" ? patch : {})
    };
    config = normalizeConfig(candidate);
    saveConfig();
    return safeClone(config);
  },

  setBinding(action, binding = {}) {
    const key = normalizeAction(action);
    if (!key) return null;
    const fallback = DEFAULT_BINDINGS[key] || { type: "note", number: 36, channel: null, minValue: 1 };
    const normalized = normalizeBinding(binding, fallback);
    if (!normalized) return null;

    config.bindings = { ...(config.bindings || {}) };
    config.bindings[key] = normalized;
    saveConfig();
    return safeClone(normalized);
  },

  clearBinding(action) {
    const key = normalizeAction(action);
    if (!key) return false;
    if (!config.bindings || !config.bindings[key]) return false;
    config.bindings = { ...(config.bindings || {}) };
    delete config.bindings[key];
    saveConfig();
    return true;
  },

  resetBindings() {
    config.bindings = safeClone(DEFAULT_BINDINGS);
    saveConfig();
    return safeClone(config.bindings);
  },

  startLearn(target, options = {}) {
    const action = normalizeAction(target);
    if (!action) return false;
    const timeoutMs = toInt(options.timeoutMs, 1000, 300000, 30000);
    const now = Date.now();
    learnState = {
      target: action,
      startedAt: now,
      expiresAt: now + timeoutMs
    };
    console.log("[MIDI] learn started:", action);
    return true;
  },

  cancelLearn() {
    learnState = {
      target: null,
      startedAt: 0,
      expiresAt: 0
    };
  },

  getLearnState() {
    return getLearnState();
  },

  handleMessage(msg = {}) {
    const target = normalizeAction(learnState.target);
    if (!target) return null;

    if (learnState.expiresAt > 0 && Date.now() > learnState.expiresAt) {
      this.cancelLearn();
      return null;
    }

    const type = normalizeType(msg.type, "");
    if (!type) return null;
    const number = toInt(msg.number, 0, 127, null);
    if (number === null) return null;
    const channel = msg.channel === null || msg.channel === undefined
      ? null
      : toInt(msg.channel, 0, 15, null);
    const minValue = type === "cc" ? 64 : 1;

    const binding = normalizeBinding(
      { type, number, channel, minValue },
      DEFAULT_BINDINGS[target] || { type, number, channel, minValue }
    );
    if (!binding) return null;

    config.bindings = { ...(config.bindings || {}) };
    config.bindings[target] = binding;
    saveConfig();
    console.log("[MIDI] learned", target, binding);

    this.cancelLearn();
    return { action: target, binding: safeClone(binding) };
  }
};
