// [TITLE] Module: public/assets/js/domains/audio/audio-telemetry-formatters-ui.js
// [TITLE] Purpose: audio app-isolation telemetry formatting + status synthesis helpers
// [TITLE] Functionality Index:
// [TITLE] - app-isolation status line synthesis from telemetry payloads
// [TITLE] - scan result summary formatting for badge/status output
// [DEV] Complex Flow:
// [DEV] Formatting logic intentionally normalizes backend/resolver tokens and mismatch
// [DEV] signals so UI diagnostics remain stable while backend internals evolve.

function createAudioTelemetryFormattersUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const normalizeAudioAppNameUi = typeof deps.normalizeAudioAppNameUi === "function"
    ? deps.normalizeAudioAppNameUi
    : (value => String(value || "").trim());
  const normalizeAudioAppTokenUi = typeof deps.normalizeAudioAppTokenUi === "function"
    ? deps.normalizeAudioAppTokenUi
    : (value => String(value || "").trim().toLowerCase());
  const updateAudioAppIsolationStatusText = typeof deps.updateAudioAppIsolationStatusText === "function"
    ? deps.updateAudioAppIsolationStatusText
    : (() => {});
  const getPendingApplyState = typeof deps.getPendingApplyState === "function"
    ? deps.getPendingApplyState
    : (() => false);
  const getUiPrimaryApp = typeof deps.getUiPrimaryApp === "function"
    ? deps.getUiPrimaryApp
    : (() => String(el.aAppPrimary?.value || ""));

  function applyAudioAppIsolationTelemetry(telemetry = null) {
    const t = telemetry && typeof telemetry === "object" ? telemetry : null;
    const appIso = t && t.appIsolation && typeof t.appIsolation === "object"
      ? t.appIsolation
      : null;
    if (!appIso) return;

    const enabled = appIso.enabled === true;
    const mode = String(appIso.mode || (enabled ? "auto" : "manual")).trim().toUpperCase();
    const activeApp = String(appIso.activeApp || "").trim();
    const selectedApp = normalizeAudioAppNameUi(appIso.selectedApp || appIso.primaryApp || "");
    const captureToken = normalizeAudioAppTokenUi(appIso.captureToken || "");
    const captureApp = captureToken ? `${captureToken}.exe` : "";
    const captureResolverBackendRaw = String(appIso.captureResolverBackend || "").trim().toLowerCase();
    const captureResolverBackend = captureResolverBackendRaw
      ? captureResolverBackendRaw.replace(/[^a-z0-9]+/g, " ").trim().toUpperCase()
      : "";
    const captureReasonRaw = String(appIso.captureReason || "").trim().toLowerCase();
    const captureReason = captureReasonRaw
      ? captureReasonRaw.replace(/_/g, " ").toUpperCase()
      : "";
    const captureConfidenceRaw = Number(appIso.captureConfidence ?? 0);
    const captureConfidence = Number.isFinite(captureConfidenceRaw)
      ? Math.max(0, Math.min(1, captureConfidenceRaw))
      : 0;
    const backendWord = String(t?.backend || "").trim().toLowerCase();
    const runtimeRunning = t?.running === true;
    const devices = Array.isArray(appIso.resolvedDevices) ? appIso.resolvedDevices : [];
    const sourceWord = devices.length
      ? `${devices.length} SOURCE${devices.length === 1 ? "" : "S"}`
      : (backendWord === "rustloop" ? "PROCESS LOOPBACK" : "NO SOURCES");
    const strictWord = appIso.strict === true ? " | STRICT" : "";
    const appPath = [`TARGET ${selectedApp || "none"}`];
    if (captureApp && captureApp.toLowerCase() !== selectedApp.toLowerCase()) {
      appPath.push(`CAPTURE ${captureApp}`);
    }
    if (
      activeApp &&
      activeApp.toLowerCase() !== selectedApp.toLowerCase() &&
      activeApp.toLowerCase() !== captureApp.toLowerCase()
    ) {
      appPath.push(`ACTIVE ${activeApp}`);
    }
    const appWord = appPath.join(" -> ");
    let line = enabled
      ? `APP ISO ${mode} | APP ${appWord} | ${sourceWord}${strictWord}`
      : `APP ISO OFF | ${sourceWord}`;
    if (enabled && captureResolverBackend) {
      line = `${line} | RESOLVER ${captureResolverBackend}`;
    }
    if (enabled && captureReason) {
      const pct = Math.round(captureConfidence * 100);
      line = `${line} | RESOLVE ${captureReason}${pct > 0 ? ` (${pct}%)` : ""}`;
    }
    if (
      enabled &&
      runtimeRunning &&
      backendWord !== "ffmpeg" &&
      backendWord !== "proctap" &&
      backendWord !== "rustloop"
    ) {
      line = `${line} | WARNING BACKEND=${String(t?.backend || "unknown").toUpperCase()}`;
    }
    if (enabled && !runtimeRunning) {
      line = `${line} | AUDIO ENGINE STOPPED`;
    }
    if (enabled) {
      const uiPrimaryApp = normalizeAudioAppNameUi(getUiPrimaryApp());
      const livePrimaryApp = normalizeAudioAppNameUi(appIso.primaryApp || appIso.selectedApp || "");
      const mismatch = Boolean(
        uiPrimaryApp &&
        livePrimaryApp &&
        uiPrimaryApp.toLowerCase() !== livePrimaryApp.toLowerCase()
      );
      if (mismatch) {
        line = `${line} | TARGET DRIFT (CLICK FORCE APPLY)`;
      }
    }
    if (Boolean(getPendingApplyState())) {
      line = `${line} | PENDING APPLY`;
    }
    updateAudioAppIsolationStatusText(line, { priority: "telemetry" });
  }

  function formatAudioAppIsoScanSummary(prefix = "APP ISO", result = null) {
    const label = String(prefix || "APP ISO").trim() || "APP ISO";
    const mode = String(result?.mode || "").trim().toUpperCase() || "UNKNOWN";
    const target = normalizeAudioAppNameUi(result?.selectedApp || "");
    const capture = normalizeAudioAppTokenUi(result?.captureToken || "");
    const resolverBackendRaw = String(result?.captureResolverBackend || "").trim().toLowerCase();
    const resolverBackend = resolverBackendRaw
      ? resolverBackendRaw.replace(/[^a-z0-9]+/g, " ").trim().toUpperCase()
      : "";
    const runningApps = Math.max(0, Number(result?.runningApps || 0));
    const runtimeWord = result?.running === true ? "LIVE" : "STAGED";
    const targetWord = target || "none";
    const captureWord = capture && `${capture}.exe`.toLowerCase() !== targetWord.toLowerCase()
      ? ` -> ${capture}.exe`
      : "";
    const resolverWord = resolverBackend ? ` | RESOLVER ${resolverBackend}` : "";
    return `${label} | ${runtimeWord} | MODE ${mode} | TARGET ${targetWord}${captureWord}${resolverWord} | APPS ${runningApps}`;
  }

  return {
    applyAudioAppIsolationTelemetry,
    formatAudioAppIsoScanSummary
  };
}
