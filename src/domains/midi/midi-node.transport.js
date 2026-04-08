// [TITLE] Module: domains/midi/midi-node.transport.js
// [TITLE] Purpose: optional native MIDI transport adapter for Node runtime
// [TITLE] Functionality Index:
// [TITLE] - discover available MIDI input ports
// [TITLE] - open/close selected input port and stream messages
// [TITLE] - normalize availability/error state when native module is missing
// [DEV] Complex Flow:
// [DEV] This adapter is intentionally optional. If the native `midi` package is not
// [DEV] available, it returns deterministic unavailable state without throwing.

function normalizePortName(value, fallback = "") {
  const name = String(value || "").trim();
  return name || String(fallback || "").trim();
}

function clampDeviceIndex(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return parsed;
}

function resolvePortSelection(ports = [], config = {}) {
  const rows = Array.isArray(ports) ? ports : [];
  if (!rows.length) return null;
  const safeConfig = config && typeof config === "object" ? config : {};
  const explicit = clampDeviceIndex(safeConfig.deviceIndex, null);
  if (explicit !== null) {
    const hit = rows.find(row => Number(row.index) === explicit);
    if (hit) return hit;
  }
  const match = String(safeConfig.deviceMatch || "").trim().toLowerCase();
  if (match) {
    const hit = rows.find(row => String(row.name || "").toLowerCase().includes(match));
    if (hit) return hit;
  }
  return rows[0] || null;
}

module.exports = function createNodeMidiTransport(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const log = options.log && typeof options.log === "object" ? options.log : console;

  let moduleAvailable = false;
  let moduleError = "";
  let midiModule = null;
  let liveInput = null;
  let activePort = null;
  let messageHandler = null;

  try {
    midiModule = options.midiModule || require("midi");
    if (midiModule && typeof midiModule.Input === "function") {
      moduleAvailable = true;
    } else {
      moduleAvailable = false;
      moduleError = "midi module missing Input constructor";
    }
  } catch (error) {
    moduleAvailable = false;
    moduleError = error?.message || "native midi module unavailable";
  }

  function openTempInput() {
    if (!moduleAvailable || !midiModule) return null;
    try {
      return new midiModule.Input();
    } catch (error) {
      moduleError = error?.message || "failed to instantiate midi input";
      moduleAvailable = false;
      return null;
    }
  }

  function getCapabilities() {
    return {
      available: moduleAvailable,
      error: moduleError
    };
  }

  function scanPorts() {
    if (!moduleAvailable) return [];
    const input = openTempInput();
    if (!input) return [];
    try {
      const count = Math.max(0, Number(input.getPortCount?.() || 0));
      const out = [];
      for (let index = 0; index < count; index += 1) {
        let name = "";
        try {
          name = normalizePortName(input.getPortName?.(index), `port ${index}`);
        } catch {
          name = `port ${index}`;
        }
        out.push({ index, name });
      }
      return out;
    } finally {
      try {
        input.closePort?.();
      } catch {}
    }
  }

  function stopListening() {
    if (!liveInput) {
      activePort = null;
      messageHandler = null;
      return {
        ok: true,
        wasConnected: false
      };
    }
    try {
      liveInput.removeAllListeners?.("message");
    } catch {}
    try {
      liveInput.closePort?.();
    } catch {}
    const wasConnected = activePort !== null;
    liveInput = null;
    activePort = null;
    messageHandler = null;
    return {
      ok: true,
      wasConnected
    };
  }

  function startListening(config = {}, onMessage = () => {}) {
    stopListening();
    if (!moduleAvailable) {
      return {
        ok: false,
        connected: false,
        error: moduleError || "native midi module unavailable"
      };
    }

    const ports = scanPorts();
    const selected = resolvePortSelection(ports, config);
    if (!selected) {
      return {
        ok: true,
        connected: false,
        activePortIndex: null,
        activePortName: "",
        reason: "no_ports_detected"
      };
    }

    const input = openTempInput();
    if (!input) {
      return {
        ok: false,
        connected: false,
        error: moduleError || "failed to initialize midi input"
      };
    }
    try {
      input.ignoreTypes?.(false, false, false);
      input.on?.("message", (deltaTime, message) => {
        const safe = Array.isArray(message) ? message.map(value => Number(value) || 0) : [];
        onMessage({
          at: Number(now() || Date.now()),
          deltaTime: Number(deltaTime || 0),
          raw: safe
        });
      });
      input.openPort?.(Number(selected.index));
      liveInput = input;
      activePort = {
        index: Number(selected.index),
        name: String(selected.name || "")
      };
      messageHandler = onMessage;
      return {
        ok: true,
        connected: true,
        activePortIndex: activePort.index,
        activePortName: activePort.name
      };
    } catch (error) {
      try {
        input.closePort?.();
      } catch {}
      const message = error?.message || String(error);
      moduleError = message;
      log.warn?.(`[MIDI] failed to open port ${selected.index}: ${message}`);
      liveInput = null;
      activePort = null;
      messageHandler = null;
      return {
        ok: false,
        connected: false,
        error: message
      };
    }
  }

  function isListening() {
    return activePort !== null && liveInput !== null && typeof messageHandler === "function";
  }

  return {
    getCapabilities,
    scanPorts,
    startListening,
    stopListening,
    isListening
  };
};
