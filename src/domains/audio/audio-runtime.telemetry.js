// [TITLE] Module: domains/audio/audio-runtime.telemetry.js
// [TITLE] Purpose: shared audio runtime telemetry projection helper
// [TITLE] Functionality Index:
// [TITLE] - shape audio/runtime/app-isolation telemetry from config and capture status
// [TITLE] - mirror forced runtime flags into the shared audio engine port safely
// [TITLE] - keep telemetry projection out of top-level service orchestration

module.exports = function createAudioRuntimeTelemetry(options = {}) {
  const normalizeString = typeof options.normalizeString === "function"
    ? options.normalizeString
    : (value => String(value || "").trim());
  const normalizeAppName = typeof options.normalizeAppName === "function"
    ? options.normalizeAppName
    : (value => String(value || "").trim());
  const normalizeAppToken = typeof options.normalizeAppToken === "function"
    ? options.normalizeAppToken
    : (value => String(value || "").trim().toLowerCase());
  const clamp = typeof options.clamp === "function"
    ? options.clamp
    : ((value, min, max, fallback) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return Number(fallback);
      return Math.min(Number(max), Math.max(Number(min), parsed));
    });
  const getConfig = typeof options.getConfig === "function"
    ? options.getConfig
    : (() => ({}));
  const buildCaptureSessionSnapshot = typeof options.buildCaptureSessionSnapshot === "function"
    ? options.buildCaptureSessionSnapshot
    : (() => ({ active: false, lastStartedAt: 0, lastStoppedAt: 0, reason: "", updatedAt: 0 }));
  const captureRuntime = options.captureRuntime || {};
  const resolveInputBackendSelection = typeof options.resolveInputBackendSelection === "function"
    ? options.resolveInputBackendSelection
    : (() => ({ selectedBackend: "auto" }));
  const resolveAppIsolationTargetToken = typeof options.resolveAppIsolationTargetToken === "function"
    ? options.resolveAppIsolationTargetToken
    : (() => ({ resolvedDevices: [] }));
  const getLocks = typeof options.getLocks === "function"
    ? options.getLocks
    : (() => ({}));
  const audioEngine = options.audioEngine || {};

  function buildTelemetry(apps = [], options = {}) {
    const config = getConfig();
    const appsPayload = options && options.appsPayload && typeof options.appsPayload === "object"
      ? options.appsPayload
      : { apps };
    const appRows = Array.isArray(appsPayload.apps) ? appsPayload.apps : [];
    const forceRunning = options && Object.prototype.hasOwnProperty.call(options, "forceRunning")
      ? options.forceRunning === true
      : null;
    const runtimeRunning = forceRunning === null
      ? buildCaptureSessionSnapshot().active === true
      : forceRunning === true;
    const runtimeStatus = typeof captureRuntime.getStatus === "function" ? captureRuntime.getStatus() : {};
    const metricSource = options.metrics && typeof options.metrics === "object" ? options.metrics : {};
    const backendSelection = resolveInputBackendSelection();
    const isolationSelection = resolveAppIsolationTargetToken(config, appsPayload, getLocks());
    const captureToken = normalizeAppToken(isolationSelection.captureToken || "");
    const prev = typeof audioEngine.getTelemetry === "function" ? (audioEngine.getTelemetry() || {}) : {};
    const telemetry = {
      ...prev,
      backend: backendSelection.selectedBackend,
      running: runtimeRunning,
      device: normalizeString(config.desktopOutputDeviceName || config.ffmpegInputDevice || config.deviceMatch || "-", 256) || "-",
      appIsolation: {
        enabled: config.ffmpegAppIsolationEnabled === true,
        mode: config.ffmpegAppIsolationEnabled === true
          ? String(isolationSelection.selectedMode || "auto")
          : "off",
        strict: config.ffmpegAppIsolationStrict === true,
        primaryApp: normalizeAppName(config.ffmpegAppIsolationPrimaryApp || ""),
        fallbackApp: normalizeAppName(config.ffmpegAppIsolationFallbackApp || ""),
        selectedApp: normalizeAppName(
          isolationSelection.selectedApp
          || config.ffmpegAppIsolationPrimaryApp
          || config.ffmpegAppIsolationFallbackApp
          || ""
        ),
        activeApp: normalizeAppName(
          isolationSelection.activeApp
          || (captureToken ? `${captureToken}.exe` : "")
        ),
        captureToken,
        captureResolverBackend: backendSelection.selectedBackend,
        captureReason: normalizeString(isolationSelection.captureReason || (captureToken ? "selected_app" : "none"), 96),
        captureConfidence: captureToken
          ? clamp(String(isolationSelection.selectedBy || "").includes("fallback") ? 0.88 : 0.92, 0, 1, 0.9)
          : 0,
        resolvedDevices: Array.isArray(isolationSelection.resolvedDevices) && isolationSelection.resolvedDevices.length
          ? isolationSelection.resolvedDevices
          : (Array.isArray(config.ffmpegAppIsolationPrimaryDevices) ? config.ffmpegAppIsolationPrimaryDevices : []),
        selectedSourceToken: normalizeAppToken(isolationSelection.selectedSourceToken || ""),
        selectedBy: normalizeString(isolationSelection.selectedBy || "", 64),
        runningAppsCount: Array.isArray(appRows) ? appRows.length : 0
      },
      captureSession: buildCaptureSessionSnapshot(),
      captureRuntime: runtimeStatus,
      backendSelection,
      level: clamp(metricSource.level ?? prev.level, 0, 1, 0),
      levelRaw: clamp(metricSource.levelRaw ?? prev.levelRaw, 0, 2, 0),
      rms: clamp(metricSource.rms ?? prev.rms, 0, 1, 0),
      audioRms: clamp(metricSource.rms ?? prev.audioRms ?? prev.rms, 0, 1, 0),
      audioSourceLevel: clamp(metricSource.level ?? prev.audioSourceLevel ?? prev.level, 0, 1, 0),
      peak: clamp(metricSource.peak ?? prev.peak, 0, 1, 0),
      transient: clamp(metricSource.transient ?? prev.transient, 0, 1, 0),
      spectralFlux: clamp(metricSource.spectralFlux ?? prev.spectralFlux, 0, 1, 0),
      flux: clamp(metricSource.spectralFlux ?? prev.flux ?? prev.spectralFlux, 0, 1, 0),
      zcr: clamp(metricSource.zcr ?? prev.zcr, 0, 1, 0),
      bandLow: clamp(metricSource.bandLow ?? prev.bandLow, 0, 1, 0),
      bandMid: clamp(metricSource.bandMid ?? prev.bandMid, 0, 1, 0),
      bandHigh: clamp(metricSource.bandHigh ?? prev.bandHigh, 0, 1, 0),
      energy: clamp(metricSource.energy ?? prev.energy, 0, 1, 0),
      beat: metricSource.beat === true,
      beatPulse: metricSource.beatPulse === true,
      beatConfidence: clamp(metricSource.beatConfidence ?? prev.beatConfidence, 0, 1, 0),
      bpm: Math.round(clamp(metricSource.bpm ?? prev.bpm, 0, 260, 0))
    };
    if (typeof audioEngine.setTelemetry === "function") {
      audioEngine.setTelemetry(telemetry);
      return audioEngine.getTelemetry();
    }
    return telemetry;
  }

  return {
    buildTelemetry
  };
};
