// [TITLE] Module: public/assets/js/domains/live/live-controls-runtime-ui.js
// [TITLE] Purpose: live controls runtime boot orchestration for grouped live modules
// [TITLE] Functionality Index:
// [TITLE] - one-time live control boot guard
// [TITLE] - full vs profiles-only live control runtime wiring
// [TITLE] - sync-group control runtime boot
// [TITLE] - flow-intensity control runtime boot
// [TITLE] - live shell runtime startup
// [DEV] Complex Flow:
// [DEV] Keep this runtime focused on boot order and ownership boundaries only.
// [DEV] Action details remain in the specialized live/* runtime modules.

function createLiveControlsRuntimeUi(deps = {}) {
  const wireLiveEngineActionsUi = typeof deps.wireLiveEngineActionsUi === "function"
    ? deps.wireLiveEngineActionsUi
    : (() => {});
  const applyLiveModeUiPolicy = typeof deps.applyLiveModeUiPolicy === "function"
    ? deps.applyLiveModeUiPolicy
    : (() => {});
  const isLiveProfilesOnlyModeUi = typeof deps.isLiveProfilesOnlyModeUi === "function"
    ? deps.isLiveProfilesOnlyModeUi
    : (() => false);
  const wireLiveSceneControlsUi = typeof deps.wireLiveSceneControlsUi === "function"
    ? deps.wireLiveSceneControlsUi
    : (() => ({}));
  const wireLiveSceneFilterControlsUi = typeof deps.wireLiveSceneFilterControlsUi === "function"
    ? deps.wireLiveSceneFilterControlsUi
    : (() => ({}));
  const wireLiveOverclockControlsUi = typeof deps.wireLiveOverclockControlsUi === "function"
    ? deps.wireLiveOverclockControlsUi
    : (() => {});
  const wireLiveSyncGroupsControlsUi = typeof deps.wireLiveSyncGroupsControlsUi === "function"
    ? deps.wireLiveSyncGroupsControlsUi
    : (() => ({}));
  const wireLiveFlowIntensityControlsUi = typeof deps.wireLiveFlowIntensityControlsUi === "function"
    ? deps.wireLiveFlowIntensityControlsUi
    : (() => {});
  const startLiveShellUiRuntime = typeof deps.startLiveShellUiRuntime === "function"
    ? deps.startLiveShellUiRuntime
    : (() => {});
  const refreshAudioReactivityMapStatus = typeof deps.refreshAudioReactivityMapStatus === "function"
    ? deps.refreshAudioReactivityMapStatus
    : (() => {});
  const maybeApplySmartLiveReactivityPolicy = typeof deps.maybeApplySmartLiveReactivityPolicy === "function"
    ? deps.maybeApplySmartLiveReactivityPolicy
    : (() => {});
  const disableMetaAutoForManualOverrideLiveUi = typeof deps.disableMetaAutoForManualOverrideLiveUi === "function"
    ? deps.disableMetaAutoForManualOverrideLiveUi
    : (() => Promise.resolve(true));

  let liveControlsBootstrapped = false;

  function bootLiveControlsUi() {
    if (liveControlsBootstrapped) return;

    wireLiveEngineActionsUi();
    applyLiveModeUiPolicy();

    if (!isLiveProfilesOnlyModeUi()) {
      wireLiveSceneControlsUi({
        refreshAudioReactivityMapStatus,
        maybeApplySmartLiveReactivityPolicy,
        disableMetaAutoForManualOverride: disableMetaAutoForManualOverrideLiveUi
      });
      wireLiveSceneFilterControlsUi({
        maybeApplySmartLiveReactivityPolicy
      });
      wireLiveOverclockControlsUi();
      wireLiveSyncGroupsControlsUi();
      wireLiveFlowIntensityControlsUi();
    }

    startLiveShellUiRuntime();
    liveControlsBootstrapped = true;
  }

  return {
    bootLiveControlsUi
  };
}
