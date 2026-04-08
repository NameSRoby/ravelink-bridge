// [TITLE] Module: public/assets/js/domains/audio/audio-telemetry-runtime-ui.js
// [TITLE] Purpose: audio telemetry snapshot projection into runtime status UI
// [TITLE] Functionality Index:
// [TITLE] - canonical audio telemetry field normalization
// [TITLE] - live AUDIO tab metric/status rendering
// [TITLE] - app-isolation telemetry bridge invocation
// [DEV] Complex Flow:
// [DEV] Keep telemetry DOM projection here so the audio orchestrator can stay focused
// [DEV] on boot/load sequencing while the backend telemetry contract evolves.

function createAudioTelemetryRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const clampNumber = typeof deps.clampNumber === "function"
    ? deps.clampNumber
    : ((value, min, max, fallback) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.max(min, Math.min(max, parsed));
    });
  const toFixedSafe = typeof deps.toFixedSafe === "function"
    ? deps.toFixedSafe
    : ((value, digits = 2, fallback = "0.00") => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed.toFixed(digits) : fallback;
    });
  const updateAudioCaptureGuidanceUi = typeof deps.updateAudioCaptureGuidanceUi === "function"
    ? deps.updateAudioCaptureGuidanceUi
    : (() => {});
  const applyAudioAppIsolationTelemetry = typeof deps.applyAudioAppIsolationTelemetry === "function"
    ? deps.applyAudioAppIsolationTelemetry
    : (() => {});

  function updateAudioTelemetry(a) {
    if (!a) return;
    const rms = Number(a.audioRms ?? a.rms ?? a.level);
    const sourceLevel = Number(a.audioSourceLevel ?? a.levelRaw ?? a.level);
    const peak = Number(a.peak);
    const transient = Number(a.transient);
    const bpm = Number(a.bpm);
    const flux = Number(a.spectralFlux ?? a.flux);
    const beatConfidence = clampNumber(Number(a.beatConfidence), 0, 1, 0);
    const autoLevelGain = Number(a.autoLevelGain);
    const fallbackOutputGain = Number(a?.config?.outputGain);
    const effectiveGain = Number(a.effectiveOutputGain ?? fallbackOutputGain);
    const backend = String(a?.backendSelection?.selectedBackend || a.backend || "-").trim().toLowerCase() || "-";
    const captureTarget = String(
      a?.appIsolation?.captureToken ||
      a?.appIsolation?.activeApp ||
      a?.appIsolation?.selectedApp ||
      a.device ||
      "-"
    ).trim() || "-";
    const captureRuntimeState = String(a?.captureRuntime?.state || a?.captureRuntime?.status || "").trim().toLowerCase();
    const sessionReason = String(a?.captureSession?.reason || a.lastRestartReason || "-").trim() || "-";
    const errorText = String(a.lastError || a?.captureRuntime?.lastError || "-").trim() || "-";

    el.aLevel.textContent = toFixedSafe(rms, 2, "0.00");
    el.aRaw.textContent = toFixedSafe(sourceLevel, 2, "0.00");
    el.aPeak.textContent = toFixedSafe(peak, 2, "0.00");
    el.aTransient.textContent = toFixedSafe(transient, 2, "0.00");
    el.aZcr.textContent = Number.isFinite(bpm) && bpm > 0 ? String(Math.round(bpm)) : "-";
    el.aBandLow.textContent = toFixedSafe(a.bandLow, 2, "0.00");
    el.aBandMid.textContent = toFixedSafe(a.bandMid, 2, "0.00");
    el.aBandHigh.textContent = toFixedSafe(a.bandHigh, 2, "0.00");
    el.aFlux.textContent = toFixedSafe(flux, 2, "0.00");
    if (el.aAutoGain) {
      el.aAutoGain.textContent = `${Math.round(beatConfidence * 100)}%`;
    }
    if (el.aEffectiveGain) {
      const autoText = Number.isFinite(autoLevelGain) ? toFixedSafe(autoLevelGain, 2, "1.00") : "1.00";
      const effText = Number.isFinite(effectiveGain) ? toFixedSafe(effectiveGain, 2, "1.00") : "1.00";
      el.aEffectiveGain.textContent = `${autoText} / ${effText}`;
    }
    el.aDevice.textContent = captureTarget !== "-"
      ? `${backend} | ${captureTarget}`
      : backend;
    el.aRunning.textContent = a.running
      ? (captureRuntimeState ? `RUNNING (${captureRuntimeState})` : "RUNNING")
      : (captureRuntimeState ? `IDLE (${captureRuntimeState})` : "IDLE");
    el.aRestart.textContent = sessionReason;
    el.aError.textContent = errorText;
    updateAudioCaptureGuidanceUi();
    applyAudioAppIsolationTelemetry(a);
  }

  return {
    updateAudioTelemetry
  };
}

