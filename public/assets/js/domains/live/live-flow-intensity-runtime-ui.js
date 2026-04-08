// [TITLE] Module: public/assets/js/domains/live/live-flow-intensity-runtime-ui.js
// [TITLE] Purpose: LIVE flow-intensity control wiring
// [TITLE] Functionality Index:
// [TITLE] - flow-intensity slider state sync
// [TITLE] - delayed silent commit queueing
// [TITLE] - change/double-click/reset behavior
// [DEV] Complex Flow:
// [DEV] Flow intensity owns only local LIVE motion shaping. Commit timer storage is
// [DEV] injected by the System runtime bridge so old global helper semantics stay stable.

function createLiveFlowIntensityRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const clampFlowIntensity = typeof deps.clampFlowIntensity === "function"
    ? deps.clampFlowIntensity
    : (value => Math.max(0, Math.min(4, Number(value) || 1)));
  const applyFlowIntensityUi = typeof deps.applyFlowIntensityUi === "function"
    ? deps.applyFlowIntensityUi
    : (() => {});
  const commitFlowIntensity = typeof deps.commitFlowIntensity === "function"
    ? deps.commitFlowIntensity
    : (() => Promise.resolve(false));
  const resetFlowIntensity = typeof deps.resetFlowIntensity === "function"
    ? deps.resetFlowIntensity
    : (() => Promise.resolve(false));
  const getFlowIntensityCommitTimer = typeof deps.getFlowIntensityCommitTimer === "function"
    ? deps.getFlowIntensityCommitTimer
    : (() => null);
  const setFlowIntensityCommitTimer = typeof deps.setFlowIntensityCommitTimer === "function"
    ? deps.setFlowIntensityCommitTimer
    : (() => {});
  const setTimeoutRef = typeof deps.setTimeoutRef === "function" ? deps.setTimeoutRef : setTimeout;
  const clearTimeoutRef = typeof deps.clearTimeoutRef === "function" ? deps.clearTimeoutRef : clearTimeout;

  function clearPendingFlowIntensityCommit() {
    const timer = getFlowIntensityCommitTimer();
    if (timer) clearTimeoutRef(timer);
    setFlowIntensityCommitTimer(null);
  }

  function wireLiveFlowIntensityControlsUi() {
    if (el.flowIntensity) {
      el.flowIntensity.oninput = () => {
        ui.flowIntensity = clampFlowIntensity(Number(el.flowIntensity.value) / 100);
        ui.flowIntensityInputUntil = Date.now() + 900;
        applyFlowIntensityUi();

        const timer = getFlowIntensityCommitTimer();
        if (timer) clearTimeoutRef(timer);
        setFlowIntensityCommitTimer(setTimeoutRef(() => {
          commitFlowIntensity({ silent: true });
        }, 170));
      };

      el.flowIntensity.onchange = () => {
        clearPendingFlowIntensityCommit();
        commitFlowIntensity({ silent: false });
      };

      el.flowIntensity.ondblclick = () => {
        resetFlowIntensity({ silent: false });
      };
    }

    if (el.flowResetBtn) {
      el.flowResetBtn.onclick = () => {
        resetFlowIntensity({ silent: false });
      };
    }
  }

  return {
    clearPendingFlowIntensityCommit,
    wireLiveFlowIntensityControlsUi
  };
}
