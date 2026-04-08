// [TITLE] Module: public/assets/js/domains/telemetry/telemetry-live-audit-runtime-ui.js
// [TITLE] Purpose: telemetry live-control audit + effective HZ/status helpers
// [TITLE] Functionality Index:
// [TITLE] - control ownership audit snapshot + diff pipeline
// [TITLE] - live effective HZ resolution helper
// [TITLE] - engine health badge synthesis helper
// [DEV] Complex Flow:
// [DEV] Audit checks compare pre/post telemetry snapshots against expected ownership fields
// [DEV] so overwrite regressions become visible without changing runtime behavior.

function createTelemetryLiveAuditRuntimeUi(deps = {}) {
  const ui = deps.ui || {};
  const el = deps.el || {};
  const setBadge = typeof deps.setBadge === "function" ? deps.setBadge : (() => {});
  const LIVE_OVERCLOCK_HZ_BY_LEVEL = Array.isArray(deps.LIVE_OVERCLOCK_HZ_BY_LEVEL)
    ? deps.LIVE_OVERCLOCK_HZ_BY_LEVEL
    : [2, 4, 6, 8, 10, 12, 14, 16, 20, 30, 40, 50, 60];
  const LIVE_CONTROL_AUDIT_FIELDS = Array.isArray(deps.LIVE_CONTROL_AUDIT_FIELDS)
    ? deps.LIVE_CONTROL_AUDIT_FIELDS
    : [
      "audioRms",
      "energy",
      "audioBandLow",
      "audioTransient",
      "audioFlux",
      "beat",
      "beatConfidence",
      "bpm",
      "beatIntervalMs",
      "brightnessPercent",
      "hueBrightnessOut",
      "wizBrightnessOut",
      "sceneLock",
      "sceneIntent",
      "paletteBrightnessSceneActive",
      "cadenceAutoRequestedHz",
      "cadenceAutoAppliedHz",
      "cadenceAutoGuardReason",
      "liveTriggerMatrixOverlayDrivers"
    ];

  let liveControlAuditLastHandledSeq = 0;
  let liveControlAuditPrevSnapshot = null;

  function getLiveControlAuditRuntimeUi() {
    if (typeof window === "undefined") return null;
    const runtime = window.__ravelinkLiveControlAudit;
    if (!runtime || typeof runtime !== "object") return null;
    if (runtime.enabled === false) return null;
    return runtime;
  }

  function buildLiveControlAuditSnapshot(t = {}) {
    const triggerOverlay = t?.liveTriggerMatrixOverlayDrivers && typeof t.liveTriggerMatrixOverlayDrivers === "object"
      ? t.liveTriggerMatrixOverlayDrivers
      : null;
    return {
      audioRms: Number(t.audioRms ?? t.rms ?? 0),
      energy: Number(t.energy ?? 0),
      audioBandLow: Number(t.audioBandLow ?? 0),
      audioTransient: Number(t.audioTransient ?? 0),
      audioFlux: Number(t.audioFlux ?? 0),
      beat: Boolean(t.beat === true),
      beatConfidence: Number(t.beatConfidence ?? 0),
      bpm: Number(t.bpm ?? 0),
      beatIntervalMs: Number(t.beatIntervalMs ?? 0),
      brightnessPercent: Number(t.brightnessPercent ?? 0),
      hueBrightnessOut: Number(t.hueBrightnessOut ?? 0),
      wizBrightnessOut: Number(t.wizBrightnessOut ?? 0),
      sceneLock: String(ui.sceneLock || t.sceneLock || "auto").trim().toLowerCase(),
      sceneIntent: String(t.sceneIntent || "").trim().toLowerCase(),
      paletteBrightnessSceneActive: String(t.paletteBrightnessSceneActive || ui.activeSceneToken || "").trim().toLowerCase(),
      cadenceAutoRequestedHz: Number(t.cadenceAutoRequestedHz ?? ui.cadenceAutoRequestedHz ?? 0),
      cadenceAutoAppliedHz: Number(t.cadenceAutoAppliedHz ?? ui.cadenceAutoAppliedHz ?? 0),
      cadenceAutoGuardReason: String(t.cadenceAutoGuardReason || ui.cadenceAutoGuardReason || "none").trim().toLowerCase(),
      liveTriggerMatrixOverlayDrivers: triggerOverlay
        ? `${String(triggerOverlay.colorShiftDriver || "").trim().toLowerCase()}|${String(triggerOverlay.brightnessEffectDriver || "").trim().toLowerCase()}|${String(triggerOverlay.sceneSelectDriver || "").trim().toLowerCase()}`
        : ""
    };
  }

  function resolveLiveControlAuditExpectedFields(action = {}) {
    const buttonId = String(action.buttonId || "").trim().toLowerCase();
    if (!buttonId) return [];
    if (buttonId.startsWith("scene")) return ["sceneLock", "paletteBrightnessSceneActive", "sceneIntent"];
    if (buttonId.startsWith("oc")) {
      return ["cadenceAutoRequestedHz", "cadenceAutoAppliedHz", "cadenceAutoGuardReason"];
    }
    return [];
  }

  function diffLiveControlAuditSnapshots(previous = null, next = null) {
    if (!previous || !next) return [];
    const rows = [];
    for (const key of LIVE_CONTROL_AUDIT_FIELDS) {
      const before = previous[key];
      const after = next[key];
      if (typeof before === "number" && typeof after === "number") {
        const delta = Math.abs(after - before);
        if (delta > 0.0005) {
          rows.push({
            key,
            before: Number.isFinite(before) ? Number(before.toFixed(4)) : before,
            after: Number.isFinite(after) ? Number(after.toFixed(4)) : after
          });
        }
      } else if (before !== after) {
        rows.push({ key, before, after });
      }
    }
    return rows;
  }

  function processLiveControlAuditTelemetry(t = {}) {
    const runtime = getLiveControlAuditRuntimeUi();
    const snapshot = buildLiveControlAuditSnapshot(t);
    if (!runtime) {
      liveControlAuditPrevSnapshot = snapshot;
      return;
    }
    const action = runtime.lastCompletedAction && typeof runtime.lastCompletedAction === "object"
      ? runtime.lastCompletedAction
      : null;
    if (!action || Number(action.seq) <= Number(liveControlAuditLastHandledSeq)) {
      liveControlAuditPrevSnapshot = snapshot;
      return;
    }
    const diffs = diffLiveControlAuditSnapshots(liveControlAuditPrevSnapshot, snapshot);
    const expected = resolveLiveControlAuditExpectedFields(action);
    const expectedDiffs = expected.length
      ? diffs.filter(row => expected.includes(row.key))
      : [];
    const overwriteSuspected = expected.length > 0 && expectedDiffs.length === 0;
    const prefix = overwriteSuspected ? "[LIVE-AUDIT][CONFLICT]" : "[LIVE-AUDIT]";
    console.groupCollapsed(
      `${prefix} #${action.seq} ${String(action.buttonId || "button")} ${String(action.status || "ok").toUpperCase()}`
    );
    console.log("action", action);
    console.log("expected_fields", expected);
    console.log("changed_fields", diffs);
    if (overwriteSuspected) {
      console.warn("expected ownership fields did not change; possible overwrite or route conflict");
    }
    console.groupEnd();
    runtime.lastAudit = {
      seq: action.seq,
      overwriteSuspected,
      expected,
      changed: diffs.map(row => row.key),
      at: Date.now()
    };
    liveControlAuditLastHandledSeq = Number(action.seq);
    liveControlAuditPrevSnapshot = snapshot;
  }

  function resolveLiveEffectiveHzUi() {
    const cadenceAppliedHz = Number(ui.cadenceAutoAppliedHz);
    if (Boolean(ui.cadenceAutoEnabled) && Number.isFinite(cadenceAppliedHz) && cadenceAppliedHz > 0) {
      return cadenceAppliedHz;
    }
    const metaHzNum = Number(ui.metaAutoHz);
    if (Boolean(ui.metaAutoEnabled) && Number.isFinite(metaHzNum) && metaHzNum > 0) {
      return metaHzNum;
    }
    const autoHzNum = Number(ui.overclockAutoHz);
    if (!Boolean(ui.cadenceAutoEnabled) && Boolean(ui.overclockAutoEnabled) && Number.isFinite(autoHzNum) && autoHzNum > 0) {
      return autoHzNum;
    }
    const level = Math.max(0, Math.min(LIVE_OVERCLOCK_HZ_BY_LEVEL.length - 1, Math.round(Number(ui.overclockLevel) || 0)));
    return Number(LIVE_OVERCLOCK_HZ_BY_LEVEL[level] || 2);
  }

  function setEngineHealthBadgeFromTelemetry(h = null) {
    const hue = h && typeof h === "object" ? h : {};
    const totalTargets = Math.max(0, Math.round(Number(ui.engineModeTargets) || 0));
    const readyTargets = Math.max(0, Math.round(Number(ui.engineReadyTargets) || 0));
    const unreachableTargets = Math.max(0, Math.round(Number(ui.connectivitySummary?.unreachable || 0)));
    const activeEnt = hue.transportActive === "entertainment" || hue?.entertainment?.active === true;
    const hueMode = activeEnt ? "ENT" : "REST";
    const totalLabel = Math.max(totalTargets, readyTargets);
    const text = `FIXTURES ${readyTargets}/${totalLabel} | HUE ${hueMode}`;
    const hasFixtureIssue = totalTargets <= 0 || readyTargets < totalTargets || unreachableTargets > 0;
    setBadge(el.health, hasFixtureIssue ? "warn" : "ok", text);
  }

  return {
    processLiveControlAuditTelemetry,
    resolveLiveEffectiveHzUi,
    setEngineHealthBadgeFromTelemetry
  };
}
