// [TITLE] Module: public/assets/js/domains/live-controls.js
// [TITLE] Purpose: live controls orchestrator (delegates to live-controls-runtime-ui module)
// [TITLE] Functionality Index:
// [TITLE] - instantiate live controls runtime boot with app dependencies
// [TITLE] - expose global live boot helper used by bootstrap
// [DEV] Complex Flow:
// [DEV] Keep this file orchestration-only so runtime behavior can evolve in a dedicated
// [DEV] module while preserving the stable `bootLiveControlsUi()` global contract.

const {
  wireLiveFlowIntensityControlsUi
} = (typeof createLiveFlowIntensityRuntimeUi === "function"
  ? createLiveFlowIntensityRuntimeUi({
    el,
    ui,
    clampFlowIntensity,
    applyFlowIntensityUi,
    commitFlowIntensity,
    resetFlowIntensity,
    getFlowIntensityCommitTimer: () => flowIntensityCommitTimer,
    setFlowIntensityCommitTimer: value => {
      flowIntensityCommitTimer = value || null;
    }
  })
  : (() => {
    throw new Error("live flow intensity runtime module missing");
  })());

const {
  bootLiveControlsUi
} = (typeof createLiveControlsRuntimeUi === "function"
  ? createLiveControlsRuntimeUi({
    wireLiveEngineActionsUi,
    applyLiveModeUiPolicy,
    isLiveProfilesOnlyModeUi,
    wireLiveSceneControlsUi,
    wireLiveSceneFilterControlsUi,
    wireLiveOverclockControlsUi,
    wireLiveSyncGroupsControlsUi,
    wireLiveFlowIntensityControlsUi,
    startLiveShellUiRuntime,
    refreshAudioReactivityMapStatus,
    maybeApplySmartLiveReactivityPolicy,
    disableMetaAutoForManualOverrideLiveUi
  })
  : (() => {
    throw new Error("live controls runtime module missing");
  })());
