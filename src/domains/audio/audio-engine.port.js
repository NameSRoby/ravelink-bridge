// [TITLE] Module: domains/audio/audio-engine.port.js
// [TITLE] Purpose: telemetry-first audio + rave session runtime contract
// [TITLE] Functionality Index:
// [TITLE] - maintain swappable backend token (legacy/rust/unwired)
// [TITLE] - own in-memory telemetry snapshot updates for audio.js bridge input
// [TITLE] - expose rave lifecycle state while rebuild engine logic is intentionally absent

const { cloneJsonSafe } = require("../../shared/fs/json-file-store");

const ALLOWED_BACKENDS = new Set(["unwired", "legacy", "rust"]);

function isObjectMap(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

module.exports = function createAudioEnginePort(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  let backend = String(options.backend || "unwired").trim().toLowerCase();
  if (!ALLOWED_BACKENDS.has(backend)) backend = "unwired";

  let telemetry = {};
  let telemetryUpdatedAt = 0;
  let raveState = {
    active: false,
    startedAt: 0,
    lastStoppedAt: 0,
    source: "audio_telemetry_port",
    reason: ""
  };

  function getStatus() {
    return {
      backend,
      status: raveState.active ? "rave_active" : "idle",
      telemetryUpdatedAt,
      rave: cloneJsonSafe(raveState, {})
    };
  }

  function getTelemetry() {
    return cloneJsonSafe(telemetry, {});
  }

  function setTelemetry(patch = {}) {
    const input = cloneJsonSafe(patch, null);
    if (!isObjectMap(input)) {
      return {
        ok: false,
        error: "invalid_telemetry_payload",
        detail: "Telemetry payload must be a JSON object map."
      };
    }

    // [DEV] Top-level merge keeps producer contracts stable while enabling
    // [DEV] partial telemetry updates from future audio.js emitters.
    const replaceMode = input.replace === true;
    const clearMode = input.clear === true;
    const next = replaceMode || clearMode ? {} : cloneJsonSafe(telemetry, {});

    if (!clearMode) {
      for (const [key, value] of Object.entries(input)) {
        if (key === "replace" || key === "clear") continue;
        next[key] = value;
      }
    }

    const changed = JSON.stringify(next) !== JSON.stringify(telemetry);
    if (changed) {
      telemetry = next;
      telemetryUpdatedAt = Number(now() || Date.now());
    }
    return {
      ok: true,
      changed
    };
  }

  function setBackend(nextBackend = "") {
    const token = String(nextBackend || "").trim().toLowerCase();
    if (!ALLOWED_BACKENDS.has(token)) {
      return {
        ok: false,
        error: "invalid_backend",
        allowedBackends: [...ALLOWED_BACKENDS]
      };
    }
    const changed = token !== backend;
    backend = token;
    return {
      ok: true,
      backend,
      changed
    };
  }

  function getRaveState() {
    return cloneJsonSafe(raveState, {});
  }

  function startRave(meta = {}) {
    if (raveState.active === true) {
      return {
        ok: true,
        alreadyActive: true,
        ...getRaveState()
      };
    }
    const startedAt = Number(now() || Date.now());
    raveState = {
      ...raveState,
      active: true,
      startedAt,
      source: "audio_telemetry_port",
      reason: String(meta.reason || "")
    };
    return {
      ok: true,
      alreadyActive: false,
      ...getRaveState()
    };
  }

  function stopRave(meta = {}) {
    const wasActive = raveState.active === true;
    const stoppedAt = Number(now() || Date.now());
    raveState = {
      ...raveState,
      active: false,
      lastStoppedAt: stoppedAt,
      reason: String(meta.reason || "")
    };
    return {
      ok: true,
      wasActive,
      stoppedAt,
      ...getRaveState()
    };
  }

  return {
    getStatus,
    getTelemetry,
    setTelemetry,
    setBackend,
    getRaveState,
    startRave,
    stopRave
  };
};
