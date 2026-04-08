// [TITLE] Module: public/assets/js/domains/live/live-scene-controls-runtime-ui.js
// [TITLE] Purpose: live scene snapshot hydration + scene control ownership
// [TITLE] Functionality Index:
// [TITLE] - scene snapshot hydration/apply
// [TITLE] - meta-auto tracker state sync
// [TITLE] - scene button bindings
//
// [DEV] Complex Flow:
// [DEV] This module owns the canonical live scene control lane. Reads hydrate through
// [DEV] the LIVE status adapter path and writes commit through the canonical scene
// [DEV] adapter method, so preserve scene payload keys and badge semantics.

function applyMetaAutoTempoTrackersState(trackers = {}) {
  const normalized = normalizeMetaAutoTempoTrackersUi(trackers);
  const autoEnabled = ui.metaAutoTempoTrackersAuto === true;
  ui.metaAutoTempoTrackers = { ...normalized };
  ui.metaAutoTempoTrackersActive = { ...normalized };
  ui.metaAutoHueWizBaselineBlend = normalized.baseline === true;
  if (ui.audioReactivityMap && typeof ui.audioReactivityMap === "object") {
    ui.audioReactivityMap.metaAutoTempoTrackersAuto = autoEnabled;
    ui.audioReactivityMap.metaAutoTempoTrackers = { ...normalized };
    ui.audioReactivityMap.metaAutoHueWizBaselineBlend = normalized.baseline === true;
  }
}

function normalizeLiveSceneLockUi(value, fallback = "auto") {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return fallback;
  if (key === "calm" || key === "steady") return "steady";
  if (key === "groove" || key === "motion") return "motion";
  if (key === "impact") return "impact";
  if (key === "auto" || key === "meta_auto") return "auto";
  return fallback;
}

async function setMetaAutoTempoTracker(modeKey, enabled, options = {}) {
  const mode = String(modeKey || "").trim().toLowerCase();
  if (!META_AUTO_TEMPO_TRACKER_KEYS.includes(mode)) return false;
  const announce = options.announce !== false;
  void enabled;
  const forcedTrackers = {};
  for (const key of META_AUTO_TEMPO_TRACKER_KEYS) {
    forcedTrackers[key] = true;
  }
  ui.metaAutoTempoTrackersAuto = true;
  applyMetaAutoTempoTrackersState(forcedTrackers);
  if (typeof options.refreshAudioReactivityMapStatus === "function") {
    options.refreshAudioReactivityMapStatus();
  }
  if (announce) {
    setBadge(el.health, "ok", "TRACKERS LIVE-MANAGED");
  }
  sync();
  return true;
}

async function setMetaAutoHueWizBaselineBlend(enabled, options = {}) {
  return setMetaAutoTempoTracker("baseline", enabled, options);
}

function applyLiveSceneSnapshotToUi(snapshot = {}, options = {}) {
  const source = snapshot && typeof snapshot === "object" ? snapshot : {};
  if (source.sceneLock) {
    ui.sceneLock = normalizeLiveSceneLockUi(source.sceneLock, normalizeLiveSceneLockUi(ui.sceneLock, "auto"));
  } else if (source.sceneIntent) {
    ui.sceneLock = normalizeLiveSceneLockUi(source.sceneIntent, normalizeLiveSceneLockUi(ui.sceneLock, "auto"));
  }
  ui.brightnessPowerMode = "b";
  ui.flowIntensity = 1;
  if (options.sync !== false) {
    sync();
  }
}

async function loadLiveSceneSnapshot(options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const attempts = clampNumber(Math.round(Number(opts.attempts) || 4), 1, 12, 4);
  const retryDelayMs = clampNumber(Math.round(Number(opts.retryDelayMs) || 220), 50, 4000, 220);
  const silent = opts.silent === true;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const payload = await liveEndpointsAdapter.getCompatibility();
    const snapshot = (
      payload &&
      typeof payload === "object" &&
      payload.ok !== false &&
      payload.snapshot &&
      typeof payload.snapshot === "object"
    )
      ? payload.snapshot
      : null;
    if (snapshot) {
      applyLiveSceneSnapshotToUi(snapshot, { sync: false });
      return true;
    }
    if (attempt < attempts) {
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
  }
  if (!silent) {
    setBadge(el.health, "warn", "LIVE SCENE SNAPSHOT DELAYED");
  }
  return false;
}

function wireLiveSceneControlsUi(deps = {}) {
  const refreshAudioReactivityMapStatus = typeof deps.refreshAudioReactivityMapStatus === "function"
    ? deps.refreshAudioReactivityMapStatus
    : (() => {});
  const maybeApplySmartLiveReactivityPolicy = typeof deps.maybeApplySmartLiveReactivityPolicy === "function"
    ? deps.maybeApplySmartLiveReactivityPolicy
    : (() => {});

  sceneButtons.forEach(btn => {
    btn.onclick = () => runUiActionWithGroupLock("scene_lock_select", sceneButtons, async () => {
      const previousScene = String(ui.sceneLock || "auto");
      const scene = btn.dataset.scene;
      const targetScene = scene === "auto" ? "auto" : scene;
      if (!targetScene) return;
      const r = await liveEndpointsAdapter.patchSceneIntent({
        sceneLock: targetScene
      });
      if (!r.ok || !r.data || r.data.ok !== true) {
        ui.sceneLock = previousScene;
        setBadge(el.health, "bad", "SCENE CHANGE FAIL");
        sync();
        return;
      }
      ui.sceneLock = normalizeLiveSceneLockUi(r.data?.applied?.sceneLock || targetScene, "auto");
      setBadge(el.health, "ok", `SCENE ${String(ui.sceneLock || "auto").toUpperCase()}`);
      maybeApplySmartLiveReactivityPolicy(`SCENE ${String(ui.sceneLock || "auto").toUpperCase()}`);
      sync();
    });
  });

  return {
    applyLiveSceneSnapshotToUi,
    loadLiveSceneSnapshot,
    setMetaAutoTempoTracker,
    setMetaAutoHueWizBaselineBlend
  };
}
