// [TITLE] Test Module: test/audio-runtime.capture-session.test.js
// [TITLE] Purpose: guard audio runtime capture-session strategy and stop helpers

const test = require("node:test");
const assert = require("node:assert/strict");

const createAudioRuntimeCaptureSession = require("../src/domains/audio/audio-runtime.capture-session");

function createSessionHelper(overrides = {}) {
  let config = {
    inputBackend: "auto",
    ffmpegPath: "ffmpeg",
    ...(overrides.config || {})
  };
  let captureSession = {
    active: false,
    lastStartedAt: 0,
    lastStoppedAt: 0,
    reason: "boot",
    updatedAt: 0,
    ...(overrides.captureSession || {})
  };
  const telemetryState = {};
  let persisted = 0;
  let lifecyclePatch = null;
  const captureRuntime = overrides.captureRuntime || {
    stopCapture() {
      return { status: { running: false, source: "stop_capture" } };
    },
    getStatus() {
      return { running: captureSession.active === true };
    }
  };
  const helper = createAudioRuntimeCaptureSession({
    now: overrides.now || (() => 1700000000000),
    normalizeString: overrides.normalizeString || ((value, max = 256) => String(value || "").trim().slice(0, max)),
    normalizePathToken: overrides.normalizePathToken || (value => String(value || "").trim()),
    normalizeCaptureBackendStrategy: overrides.normalizeCaptureBackendStrategy || (value => String(value || "").trim().toLowerCase() || "auto_rust_first"),
    detectRustCaptureRuntimeAvailability: overrides.detectRustCaptureRuntimeAvailability || (() => ({ available: false })),
    probeCommandToken: overrides.probeCommandToken || (() => ({ reached: false })),
    cloneJsonSafe: overrides.cloneJsonSafe || (value => JSON.parse(JSON.stringify(value))),
    sanitizeReasonToken: overrides.sanitizeReasonToken || ((value, fallback = "api_request") => String(value || fallback || "").trim() || fallback),
    inputBackends: overrides.inputBackends || new Set(["auto", "ffmpeg", "portaudio", "rustloop"]),
    getConfig: overrides.getConfig || (() => config),
    setConfig: overrides.setConfig || (next => {
      config = { ...next };
    }),
    persistAll: overrides.persistAll || (() => {
      persisted += 1;
    }),
    getCaptureSession: overrides.getCaptureSession || (() => captureSession),
    setCaptureSession: overrides.setCaptureSession || (next => {
      captureSession = { ...next };
    }),
    audioEngine: overrides.audioEngine || {
      setTelemetry(patch = {}) {
        Object.assign(telemetryState, patch);
      }
    },
    captureRuntime,
    setAppIsolationLifecycleArmed: overrides.setAppIsolationLifecycleArmed || ((armed, patch) => {
      lifecyclePatch = {
        armed: armed === true,
        ...(patch && typeof patch === "object" ? patch : {})
      };
    }),
    getApps: overrides.getApps || (() => ({ apps: [{ displayName: "firefox.exe" }] })),
    buildTelemetry: overrides.buildTelemetry || ((apps = [], options = {}) => ({
      running: options.forceRunning === true,
      apps: apps.length
    })),
    resolveInputBackendSelection: overrides.resolveInputBackendSelection || (() => ({ selectedBackend: config.inputBackend || "auto" })),
    applyEngineBackend: overrides.applyEngineBackend || (() => ({ backend: config.inputBackend || "auto" })),
    startSession: overrides.startSession || (async meta => ({
      session: {
        active: true,
        lastStartedAt: 1700000000100,
        lastStoppedAt: 0,
        reason: String(meta?.reason || ""),
        updatedAt: 1700000000100
      },
      telemetry: {
        running: true,
        reason: meta?.reason || ""
      }
    })),
    rootDir: overrides.rootDir || "D:\\RaveLink-Bridge-Windows-v1.6.2_DEV"
  });
  return {
    helper,
    readConfig: () => ({ ...config }),
    readCaptureSession: () => ({ ...captureSession }),
    readTelemetry: () => ({ ...telemetryState }),
    readPersisted: () => persisted,
    readLifecyclePatch: () => lifecyclePatch
  };
}

test("capture-session strategy falls back to ffmpeg when rust is unavailable but legacy probe succeeds", () => {
  const runtime = createSessionHelper({
    detectRustCaptureRuntimeAvailability: () => ({ available: false }),
    probeCommandToken: () => ({ reached: true })
  });

  const decision = runtime.helper.resolveBackendSelectionForStrategy("force_rust");

  assert.equal(decision.inputBackend, "ffmpeg");
  assert.equal(decision.reason, "forced_rust_fallback_legacy");
  assert.equal(decision.rustAvailable, false);
  assert.equal(decision.legacyAvailable, true);
});

test("capture-session stopSession clears active state and mirrors stop telemetry", () => {
  const runtime = createSessionHelper({
    captureSession: {
      active: true,
      lastStartedAt: 1699999999000,
      reason: "runtime_start",
      updatedAt: 1699999999000
    }
  });

  const result = runtime.helper.stopSession({
    reason: "runtime_stop_manual"
  });

  assert.equal(result.ok, true);
  assert.equal(result.stopped, true);
  assert.equal(result.session.active, false);
  assert.equal(result.session.reason, "runtime_stop_manual");
  assert.equal(runtime.readCaptureSession().active, false);
  assert.deepEqual(runtime.readLifecyclePatch(), {
    armed: false,
    resetBackoff: true
  });
  assert.equal(runtime.readTelemetry().running, false);
  assert.equal(runtime.readTelemetry().lastStopReason, "runtime_stop_manual");
});

test("capture-session applyCaptureBackendStrategy updates config and restarts active session when requested", async () => {
  const startCalls = [];
  const runtime = createSessionHelper({
    config: {
      inputBackend: "auto",
      ffmpegPath: "ffmpeg"
    },
    captureSession: {
      active: true,
      reason: "runtime_start",
      updatedAt: 1699999999000
    },
    detectRustCaptureRuntimeAvailability: () => ({ available: true }),
    probeCommandToken: () => ({ reached: true }),
    startSession: async meta => {
      startCalls.push({ ...meta });
      return {
        session: {
          active: true,
          lastStartedAt: 1700000000200,
          lastStoppedAt: 0,
          reason: meta.reason,
          updatedAt: 1700000000200
        },
        telemetry: {
          running: true,
          reason: meta.reason
        }
      };
    }
  });

  const result = await runtime.helper.applyCaptureBackendStrategy("force_rust", {
    restartIfSessionActive: true,
    reason: "audio_backend_strategy_force_rust"
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.restarted, true);
  assert.equal(result.decision.inputBackend, "rustloop");
  assert.equal(runtime.readConfig().inputBackend, "rustloop");
  assert.equal(runtime.readPersisted(), 1);
  assert.equal(startCalls.length, 1);
  assert.equal(startCalls[0].reason, "audio_backend_strategy_force_rust");
});
