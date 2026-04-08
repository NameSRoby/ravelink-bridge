// [TITLE] Module: domains/midi/midi-manager.port.js
// [TITLE] Purpose: real MIDI transport manager with contract-safe route projection
// [TITLE] Functionality Index:
// [TITLE] - scan/open MIDI input devices via transport adapter
// [TITLE] - learn and persist bindings from incoming note/cc messages
// [TITLE] - emit deterministic action-trigger state for UI + HTTP routes
// [DEV] Complex Flow:
// [DEV] Transport is adapter-driven and optional. If native transport is not
// [DEV] available, contract fields remain stable while status reports unavailability.

const fs = require("node:fs");
const {
  cloneJsonSafe,
  readJsonFile,
  writeJsonFile
} = require("../../shared/fs/json-file-store");
const createNodeMidiTransport = require("./midi-node.transport");

const DEFAULT_ACTIONS = Object.freeze([
  "drop",
  "overclock_toggle",
  "overclock_on",
  "overclock_off",
  "overclock_up",
  "overclock_down",
  "overclock_auto_toggle",
  "overclock_auto_on",
  "overclock_auto_off",
  "behavior_interpret",
  "scene_auto",
  "scene_idle",
  "scene_flow",
  "scene_pulse",
  "scene_steady",
  "scene_motion",
  "scene_impact",
  "flow_intensity_up",
  "flow_intensity_down",
  "flow_intensity_reset",
  "palette_ordered",
  "palette_disorder",
  "palette_colors_1",
  "palette_colors_3",
  "palette_colors_5",
  "palette_colors_8",
  "palette_colors_12",
  "palette_family_red",
  "palette_family_yellow",
  "palette_family_green",
  "palette_family_cyan",
  "palette_family_blue",
  "palette_family_purple",
  "palette_preset_all_1",
  "palette_preset_all_3",
  "palette_preset_duo_cool",
  "palette_preset_duo_warm"
]);

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number(fallback);
  return Math.min(Number(max), Math.max(Number(min), parsed));
}

function normalizeAction(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeBindingPatch(patch = {}, fallback = null) {
  const source = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
  const fb = fallback && typeof fallback === "object" && !Array.isArray(fallback) ? fallback : {};
  const type = String(source.type || fb.type || "note").trim().toLowerCase() === "cc" ? "cc" : "note";
  const number = clampNumber(Math.round(Number(source.number ?? fb.number)), 0, 127, type === "cc" ? 64 : 36);
  const channelRaw = source.channel ?? fb.channel;
  const channel = channelRaw === null || channelRaw === undefined || channelRaw === ""
    ? null
    : clampNumber(Math.round(Number(channelRaw)), 0, 15, 0);
  const minValue = clampNumber(Math.round(Number(source.minValue ?? fb.minValue)), 0, 127, type === "cc" ? 64 : 1);
  return {
    type,
    number,
    channel,
    minValue
  };
}

function parseMidiRawMessage(raw = []) {
  const bytes = Array.isArray(raw) ? raw.map(value => clampNumber(Math.round(Number(value)), 0, 255, 0)) : [];
  if (bytes.length < 1) return null;
  const status = bytes[0];
  const channel = status & 0x0f;
  const command = status & 0xf0;
  const number = bytes.length > 1 ? bytes[1] : 0;
  const value = bytes.length > 2 ? bytes[2] : 0;
  if (command === 0x90 && value > 0) {
    return { type: "note", channel, number, value, raw: bytes };
  }
  if (command === 0x80 || (command === 0x90 && value === 0)) {
    return { type: "note", channel, number, value: 0, raw: bytes };
  }
  if (command === 0xb0) {
    return { type: "cc", channel, number, value, raw: bytes };
  }
  return { type: "raw", channel, number, value, raw: bytes };
}

function bindingMatchesMessage(binding = null, message = null) {
  if (!binding || typeof binding !== "object" || !message || typeof message !== "object") return false;
  const type = String(binding.type || "").trim().toLowerCase() === "cc" ? "cc" : "note";
  if (type !== String(message.type || "").trim().toLowerCase()) return false;
  if (Number(binding.number) !== Number(message.number)) return false;
  if (binding.channel !== null && binding.channel !== undefined && Number(binding.channel) !== Number(message.channel)) {
    return false;
  }
  const threshold = clampNumber(Number(binding.minValue), 0, 127, 0);
  return Number(message.value) >= threshold;
}

module.exports = function createNoopMidiManager(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const storePath = String(options.storePath || "").trim();
  const log = options.log && typeof options.log === "object" ? options.log : console;
  const onAction = typeof options.onAction === "function" ? options.onAction : (() => {});
  const actions = Array.isArray(options.actions) && options.actions.length
    ? options.actions.map(normalizeAction).filter(Boolean)
    : [...DEFAULT_ACTIONS];
  const actionSet = new Set(actions);

  const transport = options.transport && typeof options.transport === "object"
    ? options.transport
    : createNodeMidiTransport({ log, now });

  let config = {
    enabled: options.enabled !== false,
    deviceIndex: null,
    deviceMatch: "",
    velocityThreshold: 1,
    bindings: {}
  };
  let learn = {
    target: null,
    startedAt: 0,
    expiresAt: 0
  };
  let lastMessage = null;
  let lastAction = "";
  let lastActionAt = 0;
  let ports = [];
  let activePortIndex = null;
  let activePortName = "";
  let moduleError = "";
  let reason = "midi_ready";

  function persistConfig() {
    if (!storePath) return;
    writeJsonFile(storePath, config);
  }

  function loadConfig() {
    if (!storePath || !fs.existsSync(storePath)) return;
    const parsed = readJsonFile(storePath, {});
    const rawBindings = parsed.bindings && typeof parsed.bindings === "object" ? parsed.bindings : {};
    const normalizedBindings = {};
    for (const [rawAction, rawBinding] of Object.entries(rawBindings)) {
      const action = normalizeAction(rawAction);
      if (!action || !actionSet.has(action)) continue;
      normalizedBindings[action] = normalizeBindingPatch(rawBinding);
    }
    config = {
      enabled: parsed.enabled !== false,
      deviceIndex: parsed.deviceIndex === null || parsed.deviceIndex === undefined || parsed.deviceIndex === ""
        ? null
        : clampNumber(Math.round(Number(parsed.deviceIndex)), 0, 1024, 0),
      deviceMatch: String(parsed.deviceMatch || "").trim().slice(0, 128),
      velocityThreshold: clampNumber(Math.round(Number(parsed.velocityThreshold)), 0, 127, 1),
      bindings: normalizedBindings
    };
  }

  function updatePorts() {
    const nextPorts = transport.scanPorts?.() || [];
    ports = Array.isArray(nextPorts)
      ? nextPorts.map(row => ({
        index: clampNumber(Math.round(Number(row?.index)), 0, 1024, 0),
        name: String(row?.name || "").trim()
      })).filter(row => row.name)
      : [];
  }

  function ensureTransportState() {
    const capabilities = transport.getCapabilities?.() || { available: false, error: "transport_unavailable" };
    moduleError = String(capabilities.error || "").trim();
    updatePorts();

    if (capabilities.available !== true) {
      reason = "midi_transport_unavailable";
      activePortIndex = null;
      activePortName = "";
      transport.stopListening?.();
      return;
    }
    if (config.enabled !== true) {
      reason = "midi_disabled";
      activePortIndex = null;
      activePortName = "";
      transport.stopListening?.();
      return;
    }

    const start = transport.startListening?.(config, transportMessage => {
      handleTransportMessage(transportMessage);
    }) || { ok: false, connected: false, error: "transport_start_failed" };
    if (start.connected === true) {
      activePortIndex = Number(start.activePortIndex);
      activePortName = String(start.activePortName || "");
      reason = "midi_listening";
      return;
    }
    activePortIndex = null;
    activePortName = "";
    reason = String(start.reason || (ports.length ? "midi_not_connected" : "no_midi_ports"));
    if (start.ok === false && start.error) {
      moduleError = String(start.error || "").trim();
    }
  }

  function triggerAction(rawAction = "", triggerMeta = {}) {
    const action = normalizeAction(rawAction);
    if (!action || !actionSet.has(action)) {
      return {
        ok: false,
        error: "invalid_midi_action",
        action
      };
    }
    const at = Number(now() || Date.now());
    lastAction = action;
    lastActionAt = at;
    onAction({
      owner: "midi",
      type: "trigger_action",
      action,
      at,
      payload: cloneJsonSafe(triggerMeta, {})
    });
    return {
      ok: true,
      action
    };
  }

  function handleTransportMessage(row = {}) {
    const parsed = parseMidiRawMessage(row.raw);
    if (!parsed) return;
    const at = Number(row.at || now() || Date.now());
    lastMessage = {
      type: parsed.type,
      channel: parsed.channel,
      number: parsed.number,
      value: parsed.value,
      at,
      raw: parsed.raw
    };

    const learnActive = learn.target && Number(learn.expiresAt || 0) >= at;
    if (learnActive && (parsed.type === "note" || parsed.type === "cc")) {
      config.bindings[learn.target] = normalizeBindingPatch({
        type: parsed.type,
        number: parsed.number,
        channel: parsed.channel,
        minValue: config.velocityThreshold
      });
      persistConfig();
      learn = {
        target: null,
        startedAt: 0,
        expiresAt: 0
      };
    }

    const entries = Object.entries(config.bindings || {});
    for (const [action, binding] of entries) {
      if (!bindingMatchesMessage(binding, parsed)) continue;
      triggerAction(action, {
        source: "midi_message",
        message: cloneJsonSafe(lastMessage, null)
      });
      break;
    }
  }

  function buildStatus() {
    const capabilities = transport.getCapabilities?.() || { available: false, error: "transport_unavailable" };
    return {
      ok: true,
      moduleAvailable: capabilities.available === true,
      moduleError: String(moduleError || capabilities.error || "").trim(),
      connected: transport.isListening?.() === true && activePortIndex !== null,
      activePortIndex: activePortIndex === null ? null : Number(activePortIndex),
      activePortName: String(activePortName || ""),
      ports: cloneJsonSafe(ports, []),
      portCount: ports.length,
      config: cloneJsonSafe(config, {
        enabled: true,
        deviceIndex: null,
        deviceMatch: "",
        velocityThreshold: 1,
        bindings: {}
      }),
      actions: [...actions],
      learn: cloneJsonSafe(learn, { target: null, startedAt: 0, expiresAt: 0 }),
      lastMessage: cloneJsonSafe(lastMessage, null),
      lastAction,
      lastActionAt: lastActionAt > 0 ? new Date(lastActionAt).toISOString() : "",
      reason
    };
  }

  function getStatus() {
    ensureTransportState();
    return buildStatus();
  }

  function refreshStatus() {
    ensureTransportState();
    return {
      ok: true,
      status: buildStatus()
    };
  }

  function patchConfig(patch = {}) {
    const source = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
    config = {
      ...config,
      enabled: source.enabled === undefined ? config.enabled : source.enabled !== false,
      deviceIndex: source.deviceIndex === undefined || source.deviceIndex === null || source.deviceIndex === ""
        ? null
        : clampNumber(Math.round(Number(source.deviceIndex)), 0, 1024, 0),
      deviceMatch: source.deviceMatch === undefined
        ? config.deviceMatch
        : String(source.deviceMatch || "").trim().slice(0, 128),
      velocityThreshold: source.velocityThreshold === undefined
        ? config.velocityThreshold
        : clampNumber(Math.round(Number(source.velocityThreshold)), 0, 127, config.velocityThreshold)
    };
    if (source.bindings && typeof source.bindings === "object" && !Array.isArray(source.bindings)) {
      const nextBindings = {};
      for (const [rawAction, rawBinding] of Object.entries(source.bindings)) {
        const action = normalizeAction(rawAction);
        if (!action || !actionSet.has(action)) continue;
        nextBindings[action] = normalizeBindingPatch(rawBinding);
      }
      config.bindings = nextBindings;
    }
    persistConfig();
    ensureTransportState();
    return {
      ok: true,
      status: buildStatus()
    };
  }

  function armLearn(rawAction = "") {
    const action = normalizeAction(rawAction);
    if (!action || !actionSet.has(action)) {
      return {
        ok: false,
        error: "invalid_midi_action",
        action
      };
    }
    const at = Number(now() || Date.now());
    learn = {
      target: action,
      startedAt: at,
      expiresAt: at + 30000
    };
    return {
      ok: true,
      status: buildStatus()
    };
  }

  function cancelLearn() {
    learn = {
      target: null,
      startedAt: 0,
      expiresAt: 0
    };
    return {
      ok: true,
      status: buildStatus()
    };
  }

  function saveBinding(rawAction = "", patch = {}) {
    const action = normalizeAction(rawAction);
    if (!action || !actionSet.has(action)) {
      return {
        ok: false,
        error: "invalid_midi_action",
        action
      };
    }
    config.bindings[action] = normalizeBindingPatch(patch, config.bindings[action]);
    persistConfig();
    return {
      ok: true,
      action,
      status: buildStatus()
    };
  }

  function clearBinding(rawAction = "") {
    const action = normalizeAction(rawAction);
    if (!action || !actionSet.has(action)) {
      return {
        ok: false,
        error: "invalid_midi_action",
        action
      };
    }
    delete config.bindings[action];
    persistConfig();
    return {
      ok: true,
      action,
      status: buildStatus()
    };
  }

  function resetBindings() {
    config.bindings = {};
    persistConfig();
    return {
      ok: true,
      status: buildStatus()
    };
  }

  loadConfig();
  ensureTransportState();

  return {
    getStatus,
    refreshStatus,
    patchConfig,
    armLearn,
    cancelLearn,
    triggerAction(rawAction = "") {
      const result = triggerAction(rawAction, { source: "manual_trigger" });
      if (!result.ok) return result;
      return {
        ok: true,
        action: result.action,
        status: buildStatus()
      };
    },
    saveBinding,
    clearBinding,
    resetBindings
  };
};
