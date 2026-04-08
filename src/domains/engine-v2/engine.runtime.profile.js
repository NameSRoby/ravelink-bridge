// [TITLE] Module: domains/engine-v2/engine.runtime.profile.js
// [TITLE] Purpose: shape live profile + compatibility services into the engine runtime profile snapshot
// [TITLE] Functionality Index:
// [TITLE] - derive active profile name for engine ticks
// [TITLE] - read compatibility/trigger-matrix/overclock snapshots safely
// [TITLE] - build stable scheduler profile payloads for engine runtime

function listRuntimeProfilesSafe(liveProfileService) {
  if (!liveProfileService || typeof liveProfileService.listProfiles !== "function") {
    return [];
  }
  const profiles = liveProfileService.listProfiles();
  return Array.isArray(profiles) ? profiles : [];
}

function getLiveCompatibilitySnapshotSafe(liveCompatService) {
  const payload = liveCompatService?.getCompatibility?.();
  const snapshot = payload?.snapshot;
  return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
    ? snapshot
    : {};
}

function getLiveTriggerMatrixSnapshotSafe(liveCompatService) {
  const payload = liveCompatService?.getTriggerMatrix?.();
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload
    : {};
}

function getLiveOverclockSnapshotSafe(liveCompatService) {
  const payload = liveCompatService?.getOverclockTiers?.();
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload
    : {};
}

function buildEngineRuntimeProfileSnapshot(options = {}) {
  const liveProfileService = options.liveProfileService;
  const liveCompatService = options.liveCompatService;
  const profiles = listRuntimeProfilesSafe(liveProfileService);
  return {
    name: String(profiles[0]?.name || "default").trim() || "default",
    payload: {
      compatibility: getLiveCompatibilitySnapshotSafe(liveCompatService),
      triggerMatrix: getLiveTriggerMatrixSnapshotSafe(liveCompatService),
      overclock: getLiveOverclockSnapshotSafe(liveCompatService)
    }
  };
}

module.exports = {
  listRuntimeProfilesSafe,
  getLiveCompatibilitySnapshotSafe,
  getLiveTriggerMatrixSnapshotSafe,
  getLiveOverclockSnapshotSafe,
  buildEngineRuntimeProfileSnapshot
};
