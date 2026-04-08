// [TITLE] Module: public/assets/js/domains/live/live-engine-actions-ui.js
// [TITLE] Purpose: live tab power/engine/fixture action wiring
// [TITLE] Functionality Index:
// [TITLE] - rave power button ownership
// [TITLE] - engine/transport command wiring
// [DEV] Complex Flow:
// [DEV] Profiles-only capability gating must stay deterministic so unsupported actions
// [DEV] are disabled in UI before route execution and do not surface avoidable errors.

function wireLiveEngineActionsUi() {
  const profilesOnly = typeof isLiveProfilesOnlyModeUi === "function" && isLiveProfilesOnlyModeUi();
  const POWER_ACTION_BUTTONS = collectUiGroupButtons([el.onBtn, el.offBtn, el.panicBtn]);

  if (el.onBtn) {
    el.onBtn.onclick = () => runUiActionWithGroupLock("power_state", POWER_ACTION_BUTTONS, async () => {
      const ok = await liveEndpointsAdapter.raveOn();
      ui.raveOn = ok;
      setBadge(el.health, ok ? "ok" : "bad", ok ? "RAVE ON" : "RAVE ON FAIL");
      sync();
    });
  }

  if (el.offBtn) {
    el.offBtn.onclick = () => runUiActionWithGroupLock("power_state", POWER_ACTION_BUTTONS, async () => {
      const ok = await liveEndpointsAdapter.raveOff();
      if (ok) ui.raveOn = false;
      setBadge(el.health, ok ? "ok" : "bad", ok ? "RAVE OFF" : "RAVE OFF FAIL");
      sync();
    });
  }

  if (el.panicBtn) {
    if (profilesOnly) {
      el.panicBtn.disabled = true;
      el.panicBtn.title = "Disabled in profiles-only mode.";
    } else {
      el.panicBtn.onclick = () => runUiActionWithGroupLock("power_state", POWER_ACTION_BUTTONS, async () => {
        if (shouldConfirmDangerousAction() && !window.confirm("Trigger PANIC blackout?")) return;
        const ok = await liveEndpointsAdapter.ravePanic();
        if (!ok) {
          setBadge(el.health, "bad", "PANIC FAIL");
          return;
        }
        ui.raveOn = false;
        setBadge(el.health, "warn", "PANIC");
        sync();
      });
    }
  }

  // [DEV] Legacy engine utility controls (reload/drop/transport/stop) were removed from UI scope.
  // [DEV] Live tab now owns only power + deterministic scene/overclock/profile controls.

}
