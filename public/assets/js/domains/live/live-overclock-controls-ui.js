// [TITLE] Module: public/assets/js/domains/live/live-overclock-controls-ui.js
// [TITLE] Purpose: LIVE overclock + dev-overclock control ownership
// [TITLE] Functionality Index:
// [TITLE] - auto hz on/off
// [TITLE] - manual overclock tier selection
// [TITLE] - unsafe dev overclock gating + apply
// [TITLE] - manual meta-auto disable helper for cadence overrides
// [DEV] Complex Flow:
// [DEV] This module owns mutually-exclusive cadence controls. Manual overclock actions must disable
// [DEV] auto-hz and meta-auto in a consistent order so UI state, badges, and downstream policy stay aligned.

async function setOverclockAutoEnabled(enabled, options = {}) {
  const announce = options.announce !== false;
  const action = enabled ? "on" : "off";
  const r = await liveEndpointsAdapter.setOverclockAuto(enabled);
  if (!r.ok || !r.data) {
    if (announce) {
      setBadge(el.health, "bad", `AUTO HZ ${action.toUpperCase()} FAIL`);
    }
    return false;
  }
  const overclockState = r.data?.overclock && typeof r.data.overclock === "object"
    ? r.data.overclock
    : null;

  ui.cadenceAutoEnabled = Boolean(
    r.data.cadenceAutoEnabled ??
    overclockState?.autoEnabled ??
    r.data.enabled
  );
  ui.cadenceAutoSource = String(
    r.data.cadenceAutoSource ||
    (ui.cadenceAutoEnabled ? "auto_hz" : "manual")
  ).trim().toLowerCase();
  if (Number.isFinite(Number(r.data.cadenceAutoRequestedHz))) {
    ui.cadenceAutoRequestedHz = Number(r.data.cadenceAutoRequestedHz);
  } else if (overclockState && Number.isFinite(Number(overclockState.devHz)) && Number(overclockState.devHz) > 0) {
    ui.cadenceAutoRequestedHz = Number(overclockState.devHz);
  } else if (Number.isFinite(Number(r.data.hz))) {
    ui.cadenceAutoRequestedHz = Number(r.data.hz);
  }
  if (Number.isFinite(Number(r.data.cadenceAutoAppliedHz))) {
    ui.cadenceAutoAppliedHz = Number(r.data.cadenceAutoAppliedHz);
  } else if (Number.isFinite(Number(r.data.hz))) {
    ui.cadenceAutoAppliedHz = Number(r.data.hz);
  }
  if (typeof r.data.cadenceAutoGuardReason === "string") ui.cadenceAutoGuardReason = r.data.cadenceAutoGuardReason || "none";
  if (typeof r.data.cadenceAutoGuarded === "boolean") ui.cadenceAutoGuarded = r.data.cadenceAutoGuarded;
  ui.overclockAutoEnabled = Boolean(ui.cadenceAutoEnabled && ui.cadenceAutoSource === "auto_hz");
  ui.overclockAutoReason = ui.overclockAutoEnabled ? "enabled" : "off";
  if (ui.overclockAutoEnabled && Number.isFinite(Number(ui.cadenceAutoAppliedHz))) {
    ui.overclockAutoHz = Number(ui.cadenceAutoAppliedHz);
  } else {
    ui.overclockAutoHz = null;
  }
  if (Number.isFinite(Number(r.data.overclockLevel))) {
    ui.overclockLevel = Number(r.data.overclockLevel);
    ui.overclock = ui.overclockLevel > 0;
  } else if (overclockState && Number.isFinite(Number(overclockState.level))) {
    ui.overclockLevel = Number(overclockState.level);
    ui.overclock = ui.overclockLevel > 0;
  }
  if (ui.overclockAutoEnabled) {
    ui.metaAutoEnabled = false;
    ui.metaAutoReason = "off";
  }

  if (announce) {
    const hzLabel = Number.isFinite(Number(ui.overclockAutoHz))
      ? ` ${Number(ui.overclockAutoHz).toFixed(1).replace(/\.0$/, "")}HZ`
      : "";
    setBadge(
      el.health,
      ui.overclockAutoEnabled ? "ok" : "warn",
      ui.overclockAutoEnabled ? `AUTO HZ ON${hzLabel}` : "AUTO HZ OFF"
    );
  }
  if (typeof maybeApplySmartLiveReactivityPolicy === "function") {
    maybeApplySmartLiveReactivityPolicy(ui.overclockAutoEnabled ? "OC AUTO ON" : "OC AUTO OFF");
  }
  sync();
  return true;
}

async function disableOverclockAutoForManualOverride(options = {}) {
  const announce = options.announce !== false;
  if (!ui.overclockAutoEnabled) return true;

  const ok = await setOverclockAutoEnabled(false, { announce: false });
  if (!ok) {
    setBadge(el.health, "bad", "AUTO HZ DISABLE FAIL");
    return false;
  }
  ui.overclockAutoEnabled = false;
  ui.overclockAutoHz = null;
  ui.overclockAutoReason = "manual";
  ui.cadenceAutoEnabled = false;
  ui.cadenceAutoSource = "manual";
  if (announce) {
    setBadge(el.health, "warn", "AUTO HZ OFF (MANUAL OVERRIDE)");
  }
  return true;
}

async function setOverclockPreset(level, label = "") {
  const overclockAutoOk = await disableOverclockAutoForManualOverride({ announce: false });
  if (!overclockAutoOk) return false;
  const metaOk = await disableMetaAutoForManualOverrideLiveUi({ announce: false });
  if (!metaOk) return false;

  const ok = await liveEndpointsAdapter.setOverclockPresetLevel(level);
  if (!ok) {
    setBadge(el.health, "bad", "OVERCLOCK FAIL");
    return false;
  }
  ui.overclockLevel = Number(level);
  ui.overclock = ui.overclockLevel > 0;
  ui.overclockAutoEnabled = false;
  ui.overclockAutoHz = null;
  ui.cadenceAutoEnabled = false;
  ui.cadenceAutoSource = "manual";
  if (label) {
    setBadge(el.health, "ok", label);
  }
  if (typeof maybeApplySmartLiveReactivityPolicy === "function") {
    maybeApplySmartLiveReactivityPolicy(label || "OVERCLOCK");
  }
  sync();
  return true;
}

async function confirmUnsafeDevOverclock(hz) {
  if (!ui.devOverclockComicalAcked) {
    const step1 = window.confirm(
      `Unsafe DEV ${hz}Hz overclock requested.\n\nAre you sure?`
    );
    if (!step1) return false;
    const step2 = window.confirm("Really really sure?");
    if (!step2) return false;
    const step3 = window.confirm("Really really sure?");
    if (!step3) return false;

    const acked = await openDevOverclockAckGate(hz);
    if (!acked) return false;
    ui.devOverclockComicalAcked = true;
    localStorage.setItem(DEV_OVERCLOCK_COMICAL_ACK_KEY, "1");
    return true;
  }

  window.alert(
    "Warning: 20Hz and above is aggressive and destructive.\n\n" +
    "Behavior can become unstable or unpredictable."
  );
  return true;
}

async function setUnsafeDevOverclock(hz) {
  const parsedHz = Number(hz);
  const level = DEV_OVERCLOCK_LEVEL_BY_HZ[parsedHz];
  if (!Number.isFinite(parsedHz) || !Number.isFinite(level)) {
    setBadge(el.health, "bad", "INVALID DEV OVERCLOCK");
    return false;
  }
  if (!ui.devDebugMode) {
    setBadge(el.health, "warn", "ENABLE DEV DEBUG IN SETTINGS COG");
    return false;
  }
  if (!(await confirmUnsafeDevOverclock(parsedHz))) {
    setBadge(el.health, "warn", "DEV OVERCLOCK CANCELED");
    return false;
  }
  const overclockAutoOk = await disableOverclockAutoForManualOverride();
  if (!overclockAutoOk) return false;
  const metaOk = await disableMetaAutoForManualOverrideLiveUi();
  if (!metaOk) return false;

  const r = await liveEndpointsAdapter.setOverclockDev(parsedHz);
  if (!r.ok || !r.data || !r.data.ok) {
    const reason = r.data?.error ? `: ${r.data.error}` : "";
    setBadge(el.health, "bad", `DEV OVERCLOCK FAIL${reason}`);
    return false;
  }

  ui.overclockLevel = Number(level);
  ui.overclock = true;
  ui.overclockAutoEnabled = false;
  ui.overclockAutoHz = null;
  ui.cadenceAutoEnabled = false;
  ui.cadenceAutoSource = "manual";
  if (typeof maybeApplySmartLiveReactivityPolicy === "function") {
    maybeApplySmartLiveReactivityPolicy(`DEV ${parsedHz}HZ`);
  }
  setBadge(el.health, "warn", `DEV ${parsedHz}HZ ARMED`);
  sync();
  return true;
}

function getOverclockControlButtons() {
  return collectUiGroupButtons([
    el.ocOffBtn,
    el.ocOnBtn,
    el.ocTurboBtn,
    el.ocUltraBtn,
    el.ocExtremeBtn,
    el.ocInsaneBtn,
    el.ocHyperBtn,
    el.ocLudicrousBtn,
    el.ocAutoBtn,
    el.ocDev20Btn,
    el.ocDev30Btn,
    el.ocDev40Btn,
    el.ocDev50Btn,
    el.ocDev60Btn
  ]);
}

function wireLiveOverclockControlsUi() {
  el.ocLudicrousBtn.onclick = () => runUiActionWithGroupLock("overclock_select", getOverclockControlButtons(), () => setOverclockPreset(7, "OC 16HZ"));
  el.ocHyperBtn.onclick = () => runUiActionWithGroupLock("overclock_select", getOverclockControlButtons(), () => setOverclockPreset(6, "OC 14HZ"));
  el.ocInsaneBtn.onclick = () => runUiActionWithGroupLock("overclock_select", getOverclockControlButtons(), () => setOverclockPreset(5, "OC 12HZ"));
  el.ocExtremeBtn.onclick = () => runUiActionWithGroupLock("overclock_select", getOverclockControlButtons(), () => setOverclockPreset(4, "OC 10HZ"));
  el.ocUltraBtn.onclick = () => runUiActionWithGroupLock("overclock_select", getOverclockControlButtons(), () => setOverclockPreset(3, "OC 8HZ"));
  el.ocTurboBtn.onclick = () => runUiActionWithGroupLock("overclock_select", getOverclockControlButtons(), () => setOverclockPreset(2, "OC 6HZ"));
  el.ocOnBtn.onclick = () => runUiActionWithGroupLock("overclock_select", getOverclockControlButtons(), () => setOverclockPreset(1, "OC 4HZ"));
  el.ocOffBtn.onclick = () => runUiActionWithGroupLock("overclock_select", getOverclockControlButtons(), () => setOverclockPreset(0, "OC 2HZ"));

  if (el.ocAutoBtn) {
    el.ocAutoBtn.onclick = () => runUiActionWithGroupLock("overclock_select", getOverclockControlButtons(), async () => {
      await setOverclockAutoEnabled(!ui.overclockAutoEnabled);
    });
  }

  if (el.ocDev20Btn) el.ocDev20Btn.onclick = () => runUiActionWithGroupLock("overclock_select", getOverclockControlButtons(), () => setUnsafeDevOverclock(20));
  if (el.ocDev30Btn) el.ocDev30Btn.onclick = () => runUiActionWithGroupLock("overclock_select", getOverclockControlButtons(), () => setUnsafeDevOverclock(30));
  if (el.ocDev40Btn) el.ocDev40Btn.onclick = () => runUiActionWithGroupLock("overclock_select", getOverclockControlButtons(), () => setUnsafeDevOverclock(40));
  if (el.ocDev50Btn) el.ocDev50Btn.onclick = () => runUiActionWithGroupLock("overclock_select", getOverclockControlButtons(), () => setUnsafeDevOverclock(50));
  if (el.ocDev60Btn) el.ocDev60Btn.onclick = () => runUiActionWithGroupLock("overclock_select", getOverclockControlButtons(), () => setUnsafeDevOverclock(60));
}

