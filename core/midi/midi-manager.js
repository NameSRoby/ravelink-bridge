// [TITLE] Module: core/midi/midi-manager.js
// [TITLE] Purpose: midi-manager

let midi = null;
let midiLoadError = null;
try {
  midi = require("midi");
} catch (err) {
  midiLoadError = err;
}

const midiLearn = require("./midi-learn");

function safePortName(input, index) {
  try {
    return String(input.getPortName(index) || "").trim();
  } catch {
    return "";
  }
}

function normalizeAction(action) {
  const key = String(action || "").trim().toLowerCase();
  if (key === "overclock" || key === "oc") return "overclock_toggle";
  return key;
}

function actionLabel(action) {
  return normalizeAction(action).replace(/_/g, " ").toUpperCase();
}

function parseMidiMessage(payload) {
  if (!Array.isArray(payload) || payload.length < 3) return null;

  const status = Number(payload[0]);
  const number = Number(payload[1]);
  const rawValue = Number(payload[2]);
  if (!Number.isFinite(status) || !Number.isFinite(number) || !Number.isFinite(rawValue)) return null;

  const command = status & 0xf0;
  let type = "";
  if (command === 0xb0) {
    type = "cc";
  } else if (command === 0x90 || command === 0x80) {
    type = "note";
  } else {
    return null;
  }

  return {
    type,
    channel: status & 0x0f,
    number: Math.max(0, Math.min(127, Math.round(number))),
    value: command === 0x80 ? 0 : Math.max(0, Math.min(127, Math.round(rawValue))),
    status,
    at: new Date().toISOString()
  };
}

module.exports = function createMidiManager(engine) {
  const moduleAvailable = Boolean(midi);
  const moduleError = moduleAvailable ? "" : (midiLoadError?.message || String(midiLoadError || "module unavailable"));

  const state = {
    moduleAvailable,
    moduleError,
    connected: false,
    activePortIndex: null,
    activePortName: "",
    ports: [],
    lastMessage: null,
    lastAction: "",
    lastActionAt: "",
    reason: moduleAvailable ? "" : moduleError
  };

  let disposed = false;
  let input = null;
  let onMessageHandler = null;
  const latchedByBinding = new Map();

  function listPorts() {
    if (!moduleAvailable) return [];

    let probe = null;
    try {
      probe = new midi.Input();
      const count = Number(probe.getPortCount() || 0);
      const out = [];
      for (let i = 0; i < count; i += 1) {
        out.push({
          index: i,
          name: safePortName(probe, i)
        });
      }
      return out;
    } catch (err) {
      state.reason = `port scan failed: ${err?.message || err}`;
      return [];
    } finally {
      try {
        probe?.removeAllListeners?.();
      } catch {}
      try {
        probe?.closePort?.();
      } catch {}
    }
  }

  function setLastAction(text) {
    const label = String(text || "").trim();
    if (!label) return;
    state.lastAction = label;
    state.lastActionAt = new Date().toISOString();
  }

  function clearConnection() {
    if (input && onMessageHandler) {
      try {
        input.removeListener("message", onMessageHandler);
      } catch {}
    }
    try {
      input?.closePort?.();
    } catch {}
    try {
      input?.removeAllListeners?.();
    } catch {}

    input = null;
    onMessageHandler = null;
    state.connected = false;
    state.activePortIndex = null;
    state.activePortName = "";
    latchedByBinding.clear();
  }

  function resolvePortIndex(ports, config) {
    const preferredName = String(config?.deviceMatch || "").trim().toLowerCase();
    if (preferredName) {
      const match = ports.find(port => String(port.name || "").toLowerCase().includes(preferredName));
      if (match) return match.index;
    }

    const preferredIndex = Number(config?.deviceIndex);
    if (Number.isInteger(preferredIndex) && preferredIndex >= 0) {
      const exact = ports.find(port => Number(port.index) === preferredIndex);
      if (exact) return exact.index;
    }

    return ports.length ? ports[0].index : null;
  }

  function applyAction(action, message = null) {
    const key = normalizeAction(action);
    if (!key) return false;

    const telemetry = engine?.getTelemetry?.() || {};
    const currentOverclock = Number(telemetry.overclockLevel || 0);
    const disableMetaAutoForManual = () => {
      if (telemetry.metaAutoEnabled) {
        engine?.setMetaAutoEnabled?.(false);
      }
    };

    switch (key) {
      case "drop":
        engine?.forceDrop?.();
        return true;

      case "overclock_toggle":
        engine?.setOverclock?.(currentOverclock > 0 ? 0 : 2);
        return true;

      case "overclock_on":
        engine?.setOverclock?.(2);
        return true;

      case "overclock_off":
        engine?.setOverclock?.(0);
        return true;

      case "overclock_up": {
        const next = Math.max(0, Math.min(7, currentOverclock + 1));
        engine?.setOverclock?.(next);
        return true;
      }

      case "overclock_down": {
        const next = Math.max(0, Math.min(7, currentOverclock - 1));
        engine?.setOverclock?.(next);
        return true;
      }

      case "behavior_auto":
        engine?.setBehavior?.("auto");
        return true;

      case "behavior_clamp":
        engine?.setBehavior?.("clamp");
        return true;

      case "behavior_interpret":
        engine?.setBehavior?.("interpret");
        return true;

      case "scene_auto":
        engine?.setScene?.(null);
        return true;

      case "scene_idle":
        engine?.setScene?.("idle_soft");
        return true;

      case "scene_flow":
        engine?.setScene?.("flow");
        return true;

      case "scene_pulse":
        engine?.setScene?.("pulse_drive");
        return true;

      case "auto_profile_reactive":
        disableMetaAutoForManual();
        engine?.setAutoProfile?.("reactive");
        return true;

      case "auto_profile_balanced":
        disableMetaAutoForManual();
        engine?.setAutoProfile?.("balanced");
        return true;

      case "auto_profile_cinematic":
        disableMetaAutoForManual();
        engine?.setAutoProfile?.("cinematic");
        return true;

      case "audio_reactivity_balanced":
        disableMetaAutoForManual();
        engine?.setAudioReactivityPreset?.("balanced");
        return true;

      case "audio_reactivity_aggressive":
        disableMetaAutoForManual();
        engine?.setAudioReactivityPreset?.("aggressive");
        return true;

      case "audio_reactivity_precision":
        disableMetaAutoForManual();
        engine?.setAudioReactivityPreset?.("precision");
        return true;

      case "meta_auto_toggle":
        engine?.setMetaAutoEnabled?.(!Boolean(telemetry.metaAutoEnabled));
        return true;

      case "meta_auto_on":
        engine?.setMetaAutoEnabled?.(true);
        return true;

      case "meta_auto_off":
        engine?.setMetaAutoEnabled?.(false);
        return true;

      default:
        return false;
    }
  }

  function bindingMatchesMessage(binding, message) {
    if (!binding || typeof binding !== "object") return false;

    const type = String(binding.type || "").trim().toLowerCase();
    if (!type || type !== message.type) return false;

    const number = Number(binding.number);
    if (!Number.isInteger(number) || number < 0 || number > 127 || number !== message.number) return false;

    if (binding.channel !== null && binding.channel !== undefined && binding.channel !== "") {
      const channel = Number(binding.channel);
      if (!Number.isInteger(channel) || channel < 0 || channel > 15 || channel !== message.channel) {
        return false;
      }
    }

    return true;
  }

  function messageActiveForBinding(binding, message, fallbackThreshold) {
    const minValueRaw = Number(binding?.minValue);
    const minValue = Number.isFinite(minValueRaw)
      ? Math.max(0, Math.min(127, Math.round(minValueRaw)))
      : Math.max(0, Math.min(127, Math.round(Number(fallbackThreshold) || 1)));

    return Number(message.value) >= minValue;
  }

  function onMessage(_deltaTime, payload) {
    const parsed = parseMidiMessage(payload);
    if (!parsed) return;

    state.lastMessage = parsed;

    const learned = midiLearn.handleMessage(parsed);
    if (learned && learned.action) {
      setLastAction(`LEARNED ${actionLabel(learned.action)}`);
      return;
    }

    const config = midiLearn.getConfig();
    if (!config || config.enabled === false) return;

    const bindings = config.bindings && typeof config.bindings === "object" ? config.bindings : {};
    const fallbackThreshold = Number(config.velocityThreshold || 1);

    for (const [action, binding] of Object.entries(bindings)) {
      const actionKey = normalizeAction(action);
      if (!actionKey) continue;

      const bindingKey = `${actionKey}:${String(binding?.type || "")}:${String(binding?.number || "")}:${String(binding?.channel ?? "any")}`;

      if (!bindingMatchesMessage(binding, parsed)) {
        latchedByBinding.delete(bindingKey);
        continue;
      }

      const activeNow = messageActiveForBinding(binding, parsed, fallbackThreshold);
      if (!activeNow) {
        latchedByBinding.delete(bindingKey);
        continue;
      }

      if (latchedByBinding.get(bindingKey)) {
        continue;
      }

      latchedByBinding.set(bindingKey, true);
      const ok = applyAction(actionKey, parsed);
      if (ok) {
        setLastAction(`MIDI ${actionLabel(actionKey)}`);
      }
    }
  }

  function connect() {
    clearConnection();

    state.ports = listPorts();
    if (!moduleAvailable) {
      state.reason = moduleError || "module unavailable";
      return false;
    }

    const config = midiLearn.getConfig();
    if (!config || config.enabled === false) {
      state.reason = "midi disabled in config";
      return false;
    }

    if (!state.ports.length) {
      state.reason = "no midi ports found";
      return false;
    }

    const selectedIndex = resolvePortIndex(state.ports, config);
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0) {
      state.reason = "no valid midi port selected";
      return false;
    }

    try {
      input = new midi.Input();
      input.openPort(selectedIndex);
      try {
        input.ignoreTypes(false, false, false);
      } catch {}

      onMessageHandler = onMessage;
      input.on("message", onMessageHandler);

      state.connected = true;
      state.activePortIndex = selectedIndex;
      state.activePortName = safePortName(input, selectedIndex) || (state.ports.find(p => p.index === selectedIndex)?.name || "");
      state.reason = "listening";
      console.log("[MIDI] listening on:", state.activePortName || `port ${selectedIndex}`);
      return true;
    } catch (err) {
      state.reason = `failed to open midi port: ${err?.message || err}`;
      clearConnection();
      state.ports = listPorts();
      return false;
    }
  }

  function getStatus() {
    return {
      ok: true,
      moduleAvailable: state.moduleAvailable,
      moduleError: state.moduleError,
      connected: state.connected,
      activePortIndex: state.activePortIndex,
      activePortName: state.activePortName,
      ports: state.ports,
      portCount: state.ports.length,
      config: midiLearn.getConfig(),
      actions: midiLearn.getActions(),
      learn: midiLearn.getLearnState(),
      lastMessage: state.lastMessage,
      lastAction: state.lastAction,
      lastActionAt: state.lastActionAt,
      reason: state.reason
    };
  }

  connect();

  return {
    getStatus() {
      return getStatus();
    },

    refresh() {
      connect();
      return getStatus();
    },

    applyConfig(patch = {}) {
      midiLearn.patchConfig(patch);
      connect();
      return getStatus();
    },

    startLearn(action) {
      const ok = midiLearn.startLearn(action);
      if (ok) setLastAction(`MIDI LEARN ARM ${actionLabel(action)}`);
      return { ok, status: getStatus() };
    },

    cancelLearn() {
      midiLearn.cancelLearn();
      setLastAction("MIDI LEARN CANCELED");
      return getStatus();
    },

    setBinding(action, binding = {}) {
      const saved = midiLearn.setBinding(action, binding);
      if (saved) {
        setLastAction(`MIDI BINDING SAVED ${actionLabel(action)}`);
      }
      return { ok: Boolean(saved), status: getStatus() };
    },

    clearBinding(action) {
      const removed = midiLearn.clearBinding(action);
      if (removed) {
        setLastAction(`MIDI BINDING CLEARED ${actionLabel(action)}`);
      }
      return { ok: removed, status: getStatus() };
    },

    resetBindings() {
      midiLearn.resetBindings();
      setLastAction("MIDI DEFAULT BINDINGS RESTORED");
      return getStatus();
    },

    triggerAction(action) {
      const ok = applyAction(action);
      if (ok) {
        setLastAction(`MIDI TRIGGER ${actionLabel(action)}`);
      }
      return { ok, status: getStatus() };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      clearConnection();
      console.log("[MIDI] manager disposed");
    }
  };
};
