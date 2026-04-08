// [TITLE] Module: domains/audio/audio-runtime.capture-session.js
// [TITLE] Purpose: capture session snapshot, stop flow, and backend strategy helpers
// [TITLE] Functionality Index:
// [TITLE] - probe legacy backend availability and project backend-strategy decisions
// [TITLE] - shape persisted capture-session snapshots for telemetry and route responses
// [TITLE] - apply backend strategy changes and stop active capture sessions safely

module.exports = function createAudioRuntimeCaptureSession(options = {}) {
  const normalizeString = typeof options.normalizeString === "function"
    ? options.normalizeString
    : (value => String(value || "").trim());
  const normalizePathToken = typeof options.normalizePathToken === "function"
    ? options.normalizePathToken
    : (value => String(value || "").trim());
  const normalizeCaptureBackendStrategy = typeof options.normalizeCaptureBackendStrategy === "function"
    ? options.normalizeCaptureBackendStrategy
    : (value => String(value || "").trim().toLowerCase() || "auto_rust_first");
  const detectRustCaptureRuntimeAvailability = typeof options.detectRustCaptureRuntimeAvailability === "function"
    ? options.detectRustCaptureRuntimeAvailability
    : (() => ({ available: false }));
  const probeCommandToken = typeof options.probeCommandToken === "function"
    ? options.probeCommandToken
    : (() => ({ reached: false }));
  const cloneJsonSafe = typeof options.cloneJsonSafe === "function"
    ? options.cloneJsonSafe
    : (value => JSON.parse(JSON.stringify(value)));
  const sanitizeReasonToken = typeof options.sanitizeReasonToken === "function"
    ? options.sanitizeReasonToken
    : (value => normalizeString(value || "", 96) || "api_request");
  const now = typeof options.now === "function" ? options.now : Date.now;
  const inputBackends = options.inputBackends instanceof Set
    ? options.inputBackends
    : new Set(["auto", "ffmpeg", "portaudio", "rustloop"]);
  const getConfig = typeof options.getConfig === "function"
    ? options.getConfig
    : (() => ({}));
  const setConfig = typeof options.setConfig === "function"
    ? options.setConfig
    : (() => {});
  const persistAll = typeof options.persistAll === "function"
    ? options.persistAll
    : (() => {});
  const getCaptureSession = typeof options.getCaptureSession === "function"
    ? options.getCaptureSession
    : (() => ({
      active: false,
      lastStartedAt: 0,
      lastStoppedAt: 0,
      reason: "",
      updatedAt: 0
    }));
  const setCaptureSession = typeof options.setCaptureSession === "function"
    ? options.setCaptureSession
    : (() => {});
  const audioEngine = options.audioEngine || {};
  const captureRuntime = options.captureRuntime || {};
  const setAppIsolationLifecycleArmed = typeof options.setAppIsolationLifecycleArmed === "function"
    ? options.setAppIsolationLifecycleArmed
    : (() => {});
  const getApps = typeof options.getApps === "function"
    ? options.getApps
    : (() => ({ apps: [] }));
  const buildTelemetry = typeof options.buildTelemetry === "function"
    ? options.buildTelemetry
    : (() => ({}));
  const resolveInputBackendSelection = typeof options.resolveInputBackendSelection === "function"
    ? options.resolveInputBackendSelection
    : (() => ({ selectedBackend: "auto" }));
  const applyEngineBackend = typeof options.applyEngineBackend === "function"
    ? options.applyEngineBackend
    : (() => ({ backend: "unwired" }));
  const startSession = typeof options.startSession === "function"
    ? options.startSession
    : (async () => ({
      session: buildCaptureSessionSnapshot(),
      telemetry: {}
    }));
  const rootDir = String(options.rootDir || "");

  function buildCaptureSessionSnapshot(session = getCaptureSession()) {
    return {
      active: session?.active === true,
      lastStartedAt: Number(session?.lastStartedAt || 0),
      lastStoppedAt: Number(session?.lastStoppedAt || 0),
      reason: String(session?.reason || ""),
      updatedAt: Number(session?.updatedAt || 0)
    };
  }

  function resolveLegacyCaptureAvailability(currentConfig = {}) {
    const ffmpegToken = normalizePathToken(currentConfig.ffmpegPath || "ffmpeg") || "ffmpeg";
    const probe = probeCommandToken(ffmpegToken, ["-version"], 1400);
    return probe.reached === true;
  }

  function resolveBackendSelectionForStrategy(strategyRaw = "auto_rust_first") {
    const strategy = normalizeCaptureBackendStrategy(strategyRaw);
    const currentConfig = getConfig();
    const rustRuntime = detectRustCaptureRuntimeAvailability(currentConfig, { rootDir });
    const rustAvailable = rustRuntime.available === true;
    const legacyAvailable = resolveLegacyCaptureAvailability(currentConfig);
    if (strategy === "force_rust") {
      if (rustAvailable) {
        return {
          strategy,
          inputBackend: "rustloop",
          reason: "forced_rust",
          rustAvailable,
          legacyAvailable
        };
      }
      if (legacyAvailable) {
        return {
          strategy,
          inputBackend: "ffmpeg",
          reason: "forced_rust_fallback_legacy",
          rustAvailable,
          legacyAvailable
        };
      }
      return {
        strategy,
        inputBackend: "auto",
        reason: "forced_rust_unavailable",
        rustAvailable,
        legacyAvailable
      };
    }
    if (rustAvailable) {
      return {
        strategy,
        inputBackend: "rustloop",
        reason: "auto_rust_available",
        rustAvailable,
        legacyAvailable
      };
    }
    if (legacyAvailable) {
      return {
        strategy,
        inputBackend: "ffmpeg",
        reason: "auto_rust_unavailable_fallback_ffmpeg",
        rustAvailable,
        legacyAvailable
      };
    }
    return {
      strategy,
      inputBackend: "auto",
      reason: "auto_no_capture_backend_available",
      rustAvailable,
      legacyAvailable
    };
  }

  function stopSession(meta = {}) {
    const at = Number(now() || Date.now());
    const reason = sanitizeReasonToken(meta.reason, "runtime_stop");
    const prevSession = getCaptureSession();
    const wasActive = prevSession.active === true;
    setAppIsolationLifecycleArmed(false, {
      resetBackoff: true
    });
    const captureStop = typeof captureRuntime.stopCapture === "function"
      ? captureRuntime.stopCapture({ reason })
      : null;
    const nextSession = {
      ...prevSession,
      active: false,
      lastStoppedAt: at,
      reason,
      updatedAt: at
    };
    setCaptureSession(nextSession);
    const snapshot = buildCaptureSessionSnapshot(nextSession);
    if (typeof audioEngine.setTelemetry === "function") {
      audioEngine.setTelemetry({
        running: false,
        captureSession: snapshot,
        lastStopReason: reason
      });
    }
    const apps = getApps({ forceRefresh: false });
    return {
      ok: true,
      stopped: wasActive === true,
      reason,
      capture: captureStop?.status || (typeof captureRuntime.getStatus === "function" ? captureRuntime.getStatus() : {}),
      session: snapshot,
      config: cloneJsonSafe(getConfig(), {}),
      telemetry: buildTelemetry(apps.apps || [], { forceRunning: false, appsPayload: apps })
    };
  }

  async function applyCaptureBackendStrategy(strategyRaw = "auto_rust_first", options = {}) {
    const strategy = normalizeCaptureBackendStrategy(strategyRaw);
    const decision = resolveBackendSelectionForStrategy(strategy);
    const currentConfig = getConfig();
    const nextInputBackend = inputBackends.has(String(decision.inputBackend || "").trim().toLowerCase())
      ? String(decision.inputBackend || "auto").trim().toLowerCase()
      : "auto";
    const changed = String(currentConfig.inputBackend || "auto").trim().toLowerCase() !== nextInputBackend;
    if (changed) {
      setConfig({
        ...currentConfig,
        inputBackend: nextInputBackend,
        updatedAt: Number(now() || Date.now())
      });
      persistAll();
    }
    const audioBackendSelection = applyEngineBackend();
    const restartIfSessionActive = options.restartIfSessionActive === true;
    const shouldRestart = restartIfSessionActive && getCaptureSession().active === true;
    const reason = normalizeString(
      options.reason || `audio_backend_strategy_${strategy}`,
      96
    ) || `audio_backend_strategy_${strategy}`;

    if (shouldRestart) {
      const startedSession = await startSession({
        reason,
        forceRefreshApps: true
      });
      return {
        ok: true,
        strategy,
        decision,
        changed,
        restarted: true,
        config: cloneJsonSafe(getConfig(), {}),
        audioBackendSelection,
        backendSelection: resolveInputBackendSelection(),
        capture: typeof captureRuntime.getStatus === "function" ? captureRuntime.getStatus() : {},
        session: startedSession.session,
        telemetry: startedSession.telemetry
      };
    }

    const apps = getApps({ forceRefresh: true });
    return {
      ok: true,
      strategy,
      decision,
      changed,
      restarted: false,
      config: cloneJsonSafe(getConfig(), {}),
      audioBackendSelection,
      backendSelection: resolveInputBackendSelection(),
      capture: typeof captureRuntime.getStatus === "function" ? captureRuntime.getStatus() : {},
      session: buildCaptureSessionSnapshot(),
      telemetry: buildTelemetry(apps.apps || [], { appsPayload: apps })
    };
  }

  return {
    buildCaptureSessionSnapshot,
    resolveLegacyCaptureAvailability,
    resolveBackendSelectionForStrategy,
    stopSession,
    applyCaptureBackendStrategy
  };
};
