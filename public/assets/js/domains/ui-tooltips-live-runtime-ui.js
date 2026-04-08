// [TITLE] Module: public/assets/js/domains/ui-tooltips-live-runtime-ui.js
// [TITLE] Purpose: LIVE shell and scene tooltip copy ownership
// [TITLE] Functionality Index:
// [TITLE] - LIVE action/profile/theme/dev tooltips
// [TITLE] - scene/sync/runtime tuning tooltips
// [TITLE] - scene button tooltip labels

function applyLiveUiTooltips({ el, setNodeTitle }) {
  setNodeTitle(el.onBtn, "Start reactive rave output.");
  setNodeTitle(el.offBtn, "Stop reactive rave output.");
  setNodeTitle(el.panicBtn, "Emergency blackout command.");
  setNodeTitle(el.liveProfileName, "Local profile name for quick save/load in LIVE.");
  setNodeTitle(el.liveProfileSelect, "Browse and select saved local LIVE profiles.");
  setNodeTitle(el.liveProfileSaveBtn, "Save current LIVE controls to local profile storage.");
  setNodeTitle(el.liveProfileLoadBtn, "Load and apply saved LIVE controls from local profile storage.");
  setNodeTitle(el.liveProfileDeleteBtn, "Delete selected local LIVE profile.");
  setNodeTitle(el.liveProfileResetBtn, "Apply built-in LIVE defaults (AUTO scene, default overclock).");
  setNodeTitle(el.liveProfileStat, "Status of the currently selected local LIVE profile.");
  setNodeTitle(el.themeCogBtn, "Open theme settings.");
  setNodeTitle(el.obsDockCompactBtn, "Toggle compact OBS dock layout.");
  setNodeTitle(el.devDebugToggleBtn, "Toggle DEV/DEBUG mode. One-time warning on first enable, then unsafe 20-60Hz controls remain unlocked.");
  setNodeTitle(el.devDebugStatus, "DEV mode exposes unsafe overclock routes and is intended only for controlled test environments.");
  setNodeTitle(el.devToolRuntimeBtn, "Fetch /mods/runtime and show a quick runtime snapshot.");
  setNodeTitle(el.devToolConnectivityBtn, "Fetch /fixtures/connectivity for quick fixture health checks.");
  setNodeTitle(el.devToolHooksBtn, "Fetch /mods/hooks to inspect loaded hook maps.");
  setNodeTitle(el.devToolTiersBtn, "Fetch /rave/overclock/tiers to inspect safe/dev tier availability.");
  setNodeTitle(el.reloadBtn, "POST /rave/reload to refresh runtime lanes using current rebuild-safe contracts.");
  setNodeTitle(el.hueEntBtn, "Set Hue transport route preference to entertainment mode.");
  setNodeTitle(el.hueRestBtn, "Set Hue transport route preference to REST mode.");
  setNodeTitle(el.serverStopBtn, "Request server shutdown via /system/stop.");
  setNodeTitle(el.devToolsStatus, "Last dev tool execution status.");
  setNodeTitle(el.devToolsDump, "Latest JSON response from dev tools.");
  setNodeTitle(el.devOcAckInput, "Comical destructive overclock confirmation phrase input.");
  setNodeTitle(el.devOcAckConfirmBtn, "Arm unsafe overclock if phrase matches exactly.");
  setNodeTitle(el.devOcAckCancelBtn, "Cancel unsafe overclock arming.");
  setNodeTitle(el.ocAutoBtn, "Auto-tune overclock Hz from live audio only. This does not change Meta profile/reactivity.");
  setNodeTitle(el.ocDev20Btn, "Unsafe manual overclock 20Hz.");
  setNodeTitle(el.ocDev30Btn, "Unsafe manual overclock 30Hz.");
  setNodeTitle(el.ocDev40Btn, "Unsafe manual overclock 40Hz.");
  setNodeTitle(el.ocDev50Btn, "Unsafe manual overclock 50Hz.");
  setNodeTitle(el.ocDev60Btn, "Unsafe manual overclock 60Hz.");
  setNodeTitle(el.flowStat, "Scene-owned motion shaping status.");
  setNodeTitle(el.sceneSyncStat, "Scene sync mode for WiZ vs Hue.");
  setNodeTitle(el.sceneFilterAggCalm, "CALM scene aggressiveness. Higher = faster response, lower hold.");
  setNodeTitle(el.sceneFilterAggGroove, "GROOVE scene aggressiveness. Higher = faster response, lower hold.");
  setNodeTitle(el.sceneFilterAggImpact, "IMPACT scene aggressiveness. Higher = fastest transients and shorter hold.");
  setNodeTitle(el.sceneFilterAggResetBtn, "Reset all scene filter aggressiveness sliders to defaults.");
  setNodeTitle(el.sceneFilterAggSaveBtn, "Save scene filter aggressiveness to the currently selected LIVE scope target.");
  setNodeTitle(el.sceneFilterAggStatus, "Status for scene filter aggressiveness load/save operations.");
  setNodeTitle(el.liveScopeFixtureSelect, "When CUSTOM PER FIXTURE is active, choose ALL fixtures for brand-wide tuning or one fixture override.");
  setNodeTitle(el.liveScopeStatus, "Current LIVE scope target applied to scene runtime/filter save and load operations.");
  setNodeTitle(el.liveSyncGroupsEnabled, "Enable fixture sync-group routing. Disabled means global palette sequence is shared across all fixtures.");
  setNodeTitle(el.liveSyncGroupSelect, "Select the sync-group you want to edit.");
  setNodeTitle(el.liveSyncGroupAddBtn, "Create a new sync-group for cross-brand fixture sequence alignment.");
  setNodeTitle(el.liveSyncGroupDeleteBtn, "Delete the currently selected sync-group and return assigned fixtures to global sequencing.");
  setNodeTitle(el.liveSyncGroupName, "Human-readable group label shown in group selector and fixture assignment rows.");
  setNodeTitle(el.liveSyncGroupMode, "Sequence mode for this group: same order, reverse order, or offset order.");
  setNodeTitle(el.liveSyncGroupOffset, "Only used in OFFSET mode. Positive/negative values shift this group's sequence position.");
  setNodeTitle(el.liveSyncFixtureRows, "Assign each fixture to GLOBAL (none) or one sync-group.");
  setNodeTitle(el.liveSyncGroupsReloadBtn, "Reload sync-group snapshot from server state.");
  setNodeTitle(el.liveSyncGroupsSaveBtn, "Persist current sync-group configuration to server trigger-matrix state.");
  setNodeTitle(el.liveSyncGroupsStatus, "Status for sync-group load/save operations.");
  setNodeTitle(el.sceneRuntimeBpmSource, "Choose BPM source policy: hybrid blend, telemetry only, or derived only.");
  setNodeTitle(el.sceneRuntimeCooldownMs, "Minimum time before scene switches are allowed again.");
  setNodeTitle(el.sceneRuntimeImpactHoldMs, "Extra hold time for IMPACT before allowing scene downshift.");
  setNodeTitle(el.sceneRuntimeBrightnessFloor, "Minimum global brightness envelope while music remains active.");
  setNodeTitle(el.sceneRuntimeBrightnessCeil, "Maximum global brightness envelope cap.");
  setNodeTitle(el.sceneRuntimeBeatConfidenceMin, "Telemetry beat confidence threshold before telemetry BPM is trusted.");
  setNodeTitle(el.sceneRuntimeTransitionFloorMs, "Lower bound for color transition timing.");
  setNodeTitle(el.sceneRuntimeTransitionCeilMs, "Upper bound for color transition timing.");
  setNodeTitle(el.sceneRuntimeResetBtn, "Reset scene runtime tuning controls to recommended defaults.");
  setNodeTitle(el.sceneRuntimeSaveBtn, "Apply and persist scene runtime tuning immediately.");
  setNodeTitle(el.sceneRuntimeStatus, "Status for scene runtime tuning load/save operations.");

  sceneButtons.forEach(btn => {
    const key = String(btn.dataset.scene || "").toLowerCase();
    if (key === "auto") {
      setNodeTitle(btn, "Auto-select the best scene directly from the music.");
    } else if (key === "steady" || key === "idle") {
      setNodeTitle(btn, "Lock scene to STEADY: slow color drift with controlled motion and stable dynamics.");
    } else if (key === "motion" || key === "flow") {
      setNodeTitle(btn, "Lock scene to MOTION: rhythmic color flow with tighter real-time response.");
    } else if (key === "impact" || key === "pulse") {
      setNodeTitle(btn, "Lock scene to IMPACT: fastest color energy shifts for high-intensity passages.");
    } else {
      setNodeTitle(btn, `Lock scene to ${key}.`);
    }
  });
}

