// [TITLE] Module: public/assets/js/domains/live/live-scene-filter-controls-ui.js
// [TITLE] Purpose: scene filter + runtime tuning controls for LIVE tab
// [TITLE] Functionality Index:
// [TITLE] - load scene filter aggressiveness + runtime tuning from trigger-matrix snapshot
// [TITLE] - slider/select normalization + UI label sync
// [TITLE] - save/reset actions through canonical LIVE scene-tuning adapter calls
//
// [DEV] Complex Flow:
// [DEV] This module owns the scene tuning lane end-to-end so profile apply and live
// [DEV] runtime updates can reuse one normalized payload contract without drift.

const LIVE_SCENE_FILTER_AGG_MIN = 0.45;
const LIVE_SCENE_FILTER_AGG_MAX = 2.1;
const LIVE_SCENE_FILTER_AGG_DEFAULT = 1;
const LIVE_SCENE_FILTER_AGG_KEYS = Object.freeze(["calm", "groove", "impact"]);

const LIVE_SCENE_RUNTIME_TUNING_DEFAULT = Object.freeze({
  bpmSourceMode: "hybrid",
  sceneSwitchCooldownMs: 260,
  impactHoldMs: 140,
  brightnessFloor: 0.02,
  brightnessCeil: 1,
  transitionFloorMs: 32,
  transitionCeilMs: 190,
  telemetryBeatConfidenceMin: 0.34
});
const LIVE_SCENE_SCOPE_BRANDS = Object.freeze(["hue", "wiz"]);
const LIVE_SCENE_SCOPE_ALL_FIXTURES_VALUE = "__all__";
const LIVE_SCENE_SCOPE_STORAGE_KEY = "ravelink_palette_fixture_selection_v1";

function normalizeLiveSceneFilterAggressivenessUi(profile = {}, fallback = null) {
  const source = profile && typeof profile === "object" && !Array.isArray(profile)
    ? profile
    : {};
  const safeFallback = fallback && typeof fallback === "object" && !Array.isArray(fallback)
    ? fallback
    : {};
  const normalizeOne = key => {
    const fallbackValue = clampNumber(
      Number(safeFallback[key]),
      LIVE_SCENE_FILTER_AGG_MIN,
      LIVE_SCENE_FILTER_AGG_MAX,
      LIVE_SCENE_FILTER_AGG_DEFAULT
    );
    return clampNumber(
      Number(source[key]),
      LIVE_SCENE_FILTER_AGG_MIN,
      LIVE_SCENE_FILTER_AGG_MAX,
      fallbackValue
    );
  };
  return {
    calm: normalizeOne("calm"),
    groove: normalizeOne("groove"),
    impact: normalizeOne("impact")
  };
}

function normalizeLiveSceneRuntimeBpmSourceUi(value, fallback = LIVE_SCENE_RUNTIME_TUNING_DEFAULT.bpmSourceMode) {
  const token = String(value || "").trim().toLowerCase();
  if (token === "hybrid" || token === "telemetry" || token === "derived") return token;
  return String(fallback || LIVE_SCENE_RUNTIME_TUNING_DEFAULT.bpmSourceMode).trim().toLowerCase() || "hybrid";
}

function normalizeLiveSceneRuntimeTuningUi(profile = {}, fallback = null) {
  const source = profile && typeof profile === "object" && !Array.isArray(profile)
    ? profile
    : {};
  const safeFallback = fallback && typeof fallback === "object" && !Array.isArray(fallback)
    ? fallback
    : LIVE_SCENE_RUNTIME_TUNING_DEFAULT;

  const brightnessFloor = clampNumber(
    Number(source.brightnessFloor),
    0,
    0.9,
    clampNumber(Number(safeFallback.brightnessFloor), 0, 0.9, LIVE_SCENE_RUNTIME_TUNING_DEFAULT.brightnessFloor)
  );
  const brightnessCeil = clampNumber(
    Number(source.brightnessCeil),
    brightnessFloor,
    1,
    clampNumber(Number(safeFallback.brightnessCeil), brightnessFloor, 1, LIVE_SCENE_RUNTIME_TUNING_DEFAULT.brightnessCeil)
  );
  const transitionFloorMs = clampNumber(
    Number(source.transitionFloorMs),
    20,
    5000,
    clampNumber(Number(safeFallback.transitionFloorMs), 20, 5000, LIVE_SCENE_RUNTIME_TUNING_DEFAULT.transitionFloorMs)
  );
  const transitionCeilMs = clampNumber(
    Number(source.transitionCeilMs),
    transitionFloorMs,
    60000,
    clampNumber(Number(safeFallback.transitionCeilMs), transitionFloorMs, 60000, LIVE_SCENE_RUNTIME_TUNING_DEFAULT.transitionCeilMs)
  );

  return {
    bpmSourceMode: normalizeLiveSceneRuntimeBpmSourceUi(source.bpmSourceMode, safeFallback.bpmSourceMode),
    sceneSwitchCooldownMs: clampNumber(
      Number(source.sceneSwitchCooldownMs),
      0,
      10000,
      clampNumber(Number(safeFallback.sceneSwitchCooldownMs), 0, 10000, LIVE_SCENE_RUNTIME_TUNING_DEFAULT.sceneSwitchCooldownMs)
    ),
    impactHoldMs: clampNumber(
      Number(source.impactHoldMs),
      0,
      5000,
      clampNumber(Number(safeFallback.impactHoldMs), 0, 5000, LIVE_SCENE_RUNTIME_TUNING_DEFAULT.impactHoldMs)
    ),
    brightnessFloor,
    brightnessCeil,
    transitionFloorMs,
    transitionCeilMs,
    telemetryBeatConfidenceMin: clampNumber(
      Number(source.telemetryBeatConfidenceMin),
      0,
      1,
      clampNumber(Number(safeFallback.telemetryBeatConfidenceMin), 0, 1, LIVE_SCENE_RUNTIME_TUNING_DEFAULT.telemetryBeatConfidenceMin)
    )
  };
}

function formatLiveSceneFilterAggressivenessValue(value) {
  const normalized = clampNumber(
    Number(value),
    LIVE_SCENE_FILTER_AGG_MIN,
    LIVE_SCENE_FILTER_AGG_MAX,
    LIVE_SCENE_FILTER_AGG_DEFAULT
  );
  return `${normalized.toFixed(2)}x`;
}

function formatLiveSceneRuntimeMsLabel(value) {
  return `${Math.round(Number(value) || 0)}ms`;
}

function formatLiveSceneRuntimePercentLabel(value01) {
  return `${Math.round(clampNumber(Number(value01) * 100, 0, 100, 0))}%`;
}

function getLiveSceneFilterSliderElements() {
  return {
    calm: el.sceneFilterAggCalm,
    groove: el.sceneFilterAggGroove,
    impact: el.sceneFilterAggImpact
  };
}

function getLiveSceneFilterValueElements() {
  return {
    calm: el.sceneFilterAggCalmVal,
    groove: el.sceneFilterAggGrooveVal,
    impact: el.sceneFilterAggImpactVal
  };
}

function getLiveSceneRuntimeSliderElements() {
  return {
    sceneSwitchCooldownMs: el.sceneRuntimeCooldownMs,
    impactHoldMs: el.sceneRuntimeImpactHoldMs,
    brightnessFloor: el.sceneRuntimeBrightnessFloor,
    brightnessCeil: el.sceneRuntimeBrightnessCeil,
    transitionFloorMs: el.sceneRuntimeTransitionFloorMs,
    transitionCeilMs: el.sceneRuntimeTransitionCeilMs,
    telemetryBeatConfidenceMin: el.sceneRuntimeBeatConfidenceMin
  };
}

function getLiveSceneRuntimeValueElements() {
  return {
    sceneSwitchCooldownMs: el.sceneRuntimeCooldownMsVal,
    impactHoldMs: el.sceneRuntimeImpactHoldMsVal,
    brightnessFloor: el.sceneRuntimeBrightnessFloorVal,
    brightnessCeil: el.sceneRuntimeBrightnessCeilVal,
    transitionFloorMs: el.sceneRuntimeTransitionFloorMsVal,
    transitionCeilMs: el.sceneRuntimeTransitionCeilMsVal,
    telemetryBeatConfidenceMin: el.sceneRuntimeBeatConfidenceMinVal
  };
}

function setLiveSceneFilterAggStatus(text) {
  if (!el.sceneFilterAggStatus) return;
  el.sceneFilterAggStatus.value = String(text || "").trim() || "Scene filter tuning idle.";
}

function setLiveSceneRuntimeStatus(text) {
  if (!el.sceneRuntimeStatus) return;
  el.sceneRuntimeStatus.value = String(text || "").trim() || "Scene runtime tuning idle.";
}

const liveScopeTargetRuntime = (typeof createLiveScopeTargetRuntimeUi === "function"
  ? createLiveScopeTargetRuntimeUi({
    ui,
    el,
    normalizeLiveSceneFilterAggressivenessUi,
    normalizeLiveSceneRuntimeTuningUi,
    brands: LIVE_SCENE_SCOPE_BRANDS,
    allFixturesValue: LIVE_SCENE_SCOPE_ALL_FIXTURES_VALUE,
    storageKey: LIVE_SCENE_SCOPE_STORAGE_KEY
  })
  : null);
const resolveLiveSceneScopeFromUi = typeof liveScopeTargetRuntime?.resolveScopeFromUi === "function"
  ? liveScopeTargetRuntime.resolveScopeFromUi
  : (() => ({
    level: "global",
    scopePayload: { level: "global" },
    label: "GLOBAL SETTINGS",
    brand: "",
    fixtureId: ""
  }));
const resolveLiveSceneScopeSnapshotEntry = typeof liveScopeTargetRuntime?.resolveScopeSnapshotEntry === "function"
  ? liveScopeTargetRuntime.resolveScopeSnapshotEntry
  : (() => ({
    sceneFilterAggressiveness: normalizeLiveSceneFilterAggressivenessUi({}, ui.sceneFilterAggressiveness),
    runtimeTuning: normalizeLiveSceneRuntimeTuningUi({}, ui.sceneRuntimeTuning)
  }));
const renderLiveSceneScopeSelectorUi = typeof liveScopeTargetRuntime?.renderScopeSelectorUi === "function"
  ? liveScopeTargetRuntime.renderScopeSelectorUi
  : (() => resolveLiveSceneScopeFromUi());
const persistLiveSceneScopeFixtureSelection = typeof liveScopeTargetRuntime?.persistFixtureSelection === "function"
  ? liveScopeTargetRuntime.persistFixtureSelection
  : (() => {});
const emitLiveSceneScopeChanged = typeof liveScopeTargetRuntime?.emitScopeChanged === "function"
  ? liveScopeTargetRuntime.emitScopeChanged
  : (() => {});
const normalizeLiveSceneScopeBrand = typeof liveScopeTargetRuntime?.normalizeBrand === "function"
  ? liveScopeTargetRuntime.normalizeBrand
  : (value => String(value || "").trim().toLowerCase() || "hue");
const normalizeLiveSceneScopeFixtureId = typeof liveScopeTargetRuntime?.normalizeFixtureId === "function"
  ? liveScopeTargetRuntime.normalizeFixtureId
  : (value => String(value || "").trim());

function applyLiveSceneFilterAggressivenessUi(profile = {}, options = {}) {
  const next = normalizeLiveSceneFilterAggressivenessUi(
    profile,
    ui.sceneFilterAggressiveness
  );
  ui.sceneFilterAggressiveness = { ...next };
  ui.sceneFilterAggressivenessLoaded = true;

  const sliders = getLiveSceneFilterSliderElements();
  const values = getLiveSceneFilterValueElements();
  for (const key of LIVE_SCENE_FILTER_AGG_KEYS) {
    const slider = sliders[key];
    const valueNode = values[key];
    const percent = Math.round(next[key] * 100);
    if (slider) slider.value = String(percent);
    if (valueNode) valueNode.textContent = formatLiveSceneFilterAggressivenessValue(next[key]);
  }

  if (options.statusText) {
    setLiveSceneFilterAggStatus(options.statusText);
  }
  if (options.sync === true) {
    sync();
  }
}

function applyLiveSceneRuntimeTuningUi(profile = {}, options = {}) {
  const next = normalizeLiveSceneRuntimeTuningUi(
    profile,
    ui.sceneRuntimeTuning
  );
  ui.sceneRuntimeTuning = { ...next };
  ui.sceneRuntimeTuningLoaded = true;

  if (el.sceneRuntimeBpmSource) {
    el.sceneRuntimeBpmSource.value = next.bpmSourceMode;
  }

  const sliders = getLiveSceneRuntimeSliderElements();
  const valueNodes = getLiveSceneRuntimeValueElements();
  if (sliders.sceneSwitchCooldownMs) sliders.sceneSwitchCooldownMs.value = String(Math.round(next.sceneSwitchCooldownMs));
  if (sliders.impactHoldMs) sliders.impactHoldMs.value = String(Math.round(next.impactHoldMs));
  if (sliders.brightnessFloor) sliders.brightnessFloor.value = String(Math.round(next.brightnessFloor * 100));
  if (sliders.brightnessCeil) sliders.brightnessCeil.value = String(Math.round(next.brightnessCeil * 100));
  if (sliders.transitionFloorMs) sliders.transitionFloorMs.value = String(Math.round(next.transitionFloorMs));
  if (sliders.transitionCeilMs) sliders.transitionCeilMs.value = String(Math.round(next.transitionCeilMs));
  if (sliders.telemetryBeatConfidenceMin) sliders.telemetryBeatConfidenceMin.value = String(Math.round(next.telemetryBeatConfidenceMin * 100));

  if (valueNodes.sceneSwitchCooldownMs) valueNodes.sceneSwitchCooldownMs.textContent = formatLiveSceneRuntimeMsLabel(next.sceneSwitchCooldownMs);
  if (valueNodes.impactHoldMs) valueNodes.impactHoldMs.textContent = formatLiveSceneRuntimeMsLabel(next.impactHoldMs);
  if (valueNodes.brightnessFloor) valueNodes.brightnessFloor.textContent = formatLiveSceneRuntimePercentLabel(next.brightnessFloor);
  if (valueNodes.brightnessCeil) valueNodes.brightnessCeil.textContent = formatLiveSceneRuntimePercentLabel(next.brightnessCeil);
  if (valueNodes.transitionFloorMs) valueNodes.transitionFloorMs.textContent = formatLiveSceneRuntimeMsLabel(next.transitionFloorMs);
  if (valueNodes.transitionCeilMs) valueNodes.transitionCeilMs.textContent = formatLiveSceneRuntimeMsLabel(next.transitionCeilMs);
  if (valueNodes.telemetryBeatConfidenceMin) valueNodes.telemetryBeatConfidenceMin.textContent = formatLiveSceneRuntimePercentLabel(next.telemetryBeatConfidenceMin);

  if (options.statusText) {
    setLiveSceneRuntimeStatus(options.statusText);
  }
  if (options.sync === true) {
    sync();
  }
}

function readLiveSceneFilterAggressivenessFromUi() {
  const sliders = getLiveSceneFilterSliderElements();
  const profile = {};
  for (const key of LIVE_SCENE_FILTER_AGG_KEYS) {
    const slider = sliders[key];
    const raw = slider ? (Number(slider.value) / 100) : Number(ui.sceneFilterAggressiveness?.[key]);
    profile[key] = clampNumber(
      Number(raw),
      LIVE_SCENE_FILTER_AGG_MIN,
      LIVE_SCENE_FILTER_AGG_MAX,
      LIVE_SCENE_FILTER_AGG_DEFAULT
    );
  }
  return profile;
}

function readLiveSceneRuntimeTuningFromUi() {
  const sliders = getLiveSceneRuntimeSliderElements();
  return normalizeLiveSceneRuntimeTuningUi({
    bpmSourceMode: el.sceneRuntimeBpmSource?.value || ui.sceneRuntimeTuning?.bpmSourceMode,
    sceneSwitchCooldownMs: Number(sliders.sceneSwitchCooldownMs?.value ?? ui.sceneRuntimeTuning?.sceneSwitchCooldownMs),
    impactHoldMs: Number(sliders.impactHoldMs?.value ?? ui.sceneRuntimeTuning?.impactHoldMs),
    brightnessFloor: Number(
      sliders.brightnessFloor?.value ??
      (LIVE_SCENE_RUNTIME_TUNING_DEFAULT.brightnessFloor * 100)
    ) / 100,
    brightnessCeil: Number(sliders.brightnessCeil?.value ?? 100) / 100,
    transitionFloorMs: Number(sliders.transitionFloorMs?.value ?? ui.sceneRuntimeTuning?.transitionFloorMs),
    transitionCeilMs: Number(sliders.transitionCeilMs?.value ?? ui.sceneRuntimeTuning?.transitionCeilMs),
    telemetryBeatConfidenceMin: Number(
      sliders.telemetryBeatConfidenceMin?.value ??
      (LIVE_SCENE_RUNTIME_TUNING_DEFAULT.telemetryBeatConfidenceMin * 100)
    ) / 100
  }, ui.sceneRuntimeTuning);
}

function resolveLiveSceneFilterAggressivenessFromSnapshot(snapshot = null, scope = resolveLiveSceneScopeFromUi()) {
  const entry = resolveLiveSceneScopeSnapshotEntry(snapshot, scope);
  return normalizeLiveSceneFilterAggressivenessUi(
    entry.sceneFilterAggressiveness || {},
    ui.sceneFilterAggressiveness
  );
}

function resolveLiveSceneRuntimeTuningFromSnapshot(snapshot = null, scope = resolveLiveSceneScopeFromUi()) {
  const entry = resolveLiveSceneScopeSnapshotEntry(snapshot, scope);
  return normalizeLiveSceneRuntimeTuningUi(
    entry.runtimeTuning || {},
    ui.sceneRuntimeTuning
  );
}

async function loadLiveSceneFilterAggressivenessUi(options = {}) {
  const silent = options.silent === true;
  const scope = options.scope && typeof options.scope === "object"
    ? options.scope
    : resolveLiveSceneScopeFromUi();
  const payload = await liveEndpointsAdapter.getTriggerMatrix();
  if (!payload || payload.ok !== true) {
    if (!silent) {
      setBadge(el.health, "warn", "SCENE FILTER LOAD FAIL");
      setLiveSceneFilterAggStatus("Load failed.");
      setLiveSceneRuntimeStatus("Load failed.");
    }
    return false;
  }
  const filterProfile = resolveLiveSceneFilterAggressivenessFromSnapshot(payload, scope);
  const runtimeProfile = resolveLiveSceneRuntimeTuningFromSnapshot(payload, scope);
  applyLiveSceneFilterAggressivenessUi(filterProfile, {
    statusText: `Scene filter tuning loaded (${scope.label || "GLOBAL SETTINGS"}).`,
    sync: false
  });
  applyLiveSceneRuntimeTuningUi(runtimeProfile, {
    statusText: `Scene runtime tuning loaded (${scope.label || "GLOBAL SETTINGS"}).`,
    sync: false
  });
  return true;
}

async function saveLiveSceneFilterAggressivenessUi(options = {}) {
  const scope = options.scope && typeof options.scope === "object"
    ? options.scope
    : resolveLiveSceneScopeFromUi();
  const profile = normalizeLiveSceneFilterAggressivenessUi(
    options.profile || readLiveSceneFilterAggressivenessFromUi(),
    ui.sceneFilterAggressiveness
  );
  const response = await liveEndpointsAdapter.patchTriggerMatrix({
    scope: scope.scopePayload || { level: "global" },
    override: {
      sceneFilterAggressiveness: profile
    }
  });
  if (!response.ok || !response.data || response.data.ok !== true) {
    setBadge(el.health, "bad", "SCENE FILTER SAVE FAIL");
    setLiveSceneFilterAggStatus("Save failed.");
    return false;
  }
  const next = resolveLiveSceneFilterAggressivenessFromSnapshot(response.data, scope);
  applyLiveSceneFilterAggressivenessUi(next, {
    statusText: `Scene filter tuning saved (${scope.label || "GLOBAL SETTINGS"}).`,
    sync: false
  });
  setBadge(el.health, "ok", "SCENE FILTER SAVED");
  return true;
}

async function saveLiveSceneRuntimeTuningUi(options = {}) {
  const scope = options.scope && typeof options.scope === "object"
    ? options.scope
    : resolveLiveSceneScopeFromUi();
  const profile = normalizeLiveSceneRuntimeTuningUi(
    options.profile || readLiveSceneRuntimeTuningFromUi(),
    ui.sceneRuntimeTuning
  );
  const response = await liveEndpointsAdapter.patchTriggerMatrix({
    scope: scope.scopePayload || { level: "global" },
    override: {
      runtimeTuning: profile
    }
  });
  if (!response.ok || !response.data || response.data.ok !== true) {
    setBadge(el.health, "bad", "SCENE RUNTIME SAVE FAIL");
    setLiveSceneRuntimeStatus("Save failed.");
    return false;
  }
  const next = resolveLiveSceneRuntimeTuningFromSnapshot(response.data, scope);
  applyLiveSceneRuntimeTuningUi(next, {
    statusText: `Scene runtime tuning saved (${scope.label || "GLOBAL SETTINGS"}).`,
    sync: false
  });
  setBadge(el.health, "ok", "SCENE RUNTIME SAVED");
  return true;
}

async function applyLiveSceneFilterAggressivenessSnapshot(snapshot = null, options = {}) {
  const scope = options.scope && typeof options.scope === "object"
    ? options.scope
    : {
      level: "global",
      scopePayload: { level: "global" },
      label: "GLOBAL SETTINGS"
    };
  const next = normalizeLiveSceneFilterAggressivenessUi(
    snapshot,
    ui.sceneFilterAggressiveness
  );
  const ok = await saveLiveSceneFilterAggressivenessUi({ profile: next, scope });
  if (!ok && options.announce !== false) {
    setBadge(el.health, "warn", "SCENE FILTER APPLY PARTIAL");
  }
  return ok;
}

async function applyLiveSceneRuntimeTuningSnapshot(snapshot = null, options = {}) {
  const scope = options.scope && typeof options.scope === "object"
    ? options.scope
    : {
      level: "global",
      scopePayload: { level: "global" },
      label: "GLOBAL SETTINGS"
    };
  const next = normalizeLiveSceneRuntimeTuningUi(
    snapshot,
    ui.sceneRuntimeTuning
  );
  const ok = await saveLiveSceneRuntimeTuningUi({ profile: next, scope });
  if (!ok && options.announce !== false) {
    setBadge(el.health, "warn", "SCENE RUNTIME APPLY PARTIAL");
  }
  return ok;
}

function wireLiveSceneFilterControlsUi(deps = {}) {
  const maybeApplySmartLiveReactivityPolicy = typeof deps.maybeApplySmartLiveReactivityPolicy === "function"
    ? deps.maybeApplySmartLiveReactivityPolicy
    : (() => {});
  const refreshScopedProfiles = (options = {}) => {
    const silent = options.silent !== false;
    const scope = renderLiveSceneScopeSelectorUi();
    return loadLiveSceneFilterAggressivenessUi({ silent, scope });
  };

  const sliders = getLiveSceneFilterSliderElements();
  const valueNodes = getLiveSceneFilterValueElements();
  for (const key of LIVE_SCENE_FILTER_AGG_KEYS) {
    const slider = sliders[key];
    const valueNode = valueNodes[key];
    if (!slider) continue;
    slider.oninput = () => {
      const value = clampNumber(
        Number(slider.value) / 100,
        LIVE_SCENE_FILTER_AGG_MIN,
        LIVE_SCENE_FILTER_AGG_MAX,
        LIVE_SCENE_FILTER_AGG_DEFAULT
      );
      if (valueNode) valueNode.textContent = formatLiveSceneFilterAggressivenessValue(value);
      ui.sceneFilterAggressiveness = {
        ...normalizeLiveSceneFilterAggressivenessUi(ui.sceneFilterAggressiveness, null),
        [key]: value
      };
      setLiveSceneFilterAggStatus("Unsaved scene filter tuning.");
    };
  }

  if (el.sceneFilterAggResetBtn) {
    el.sceneFilterAggResetBtn.onclick = () => {
      const defaults = {
        calm: LIVE_SCENE_FILTER_AGG_DEFAULT,
        groove: LIVE_SCENE_FILTER_AGG_DEFAULT,
        impact: LIVE_SCENE_FILTER_AGG_DEFAULT
      };
      applyLiveSceneFilterAggressivenessUi(defaults, {
        statusText: "Reset to defaults. Save to apply.",
        sync: false
      });
    };
  }

  if (el.sceneFilterAggSaveBtn) {
    el.sceneFilterAggSaveBtn.onclick = () => runLiveButtonAction(
      el.sceneFilterAggSaveBtn,
      "SAVING...",
      async () => {
        const ok = await saveLiveSceneFilterAggressivenessUi({
          scope: resolveLiveSceneScopeFromUi()
        });
        if (ok) {
          maybeApplySmartLiveReactivityPolicy("SCENE FILTER SAVED");
          sync();
        }
      }
    );
  }

  const runtimeSliders = getLiveSceneRuntimeSliderElements();
  const runtimeValueNodes = getLiveSceneRuntimeValueElements();
  const updateRuntimeFromUi = () => {
    ui.sceneRuntimeTuning = readLiveSceneRuntimeTuningFromUi();
    const next = ui.sceneRuntimeTuning;
    if (runtimeValueNodes.sceneSwitchCooldownMs) runtimeValueNodes.sceneSwitchCooldownMs.textContent = formatLiveSceneRuntimeMsLabel(next.sceneSwitchCooldownMs);
    if (runtimeValueNodes.impactHoldMs) runtimeValueNodes.impactHoldMs.textContent = formatLiveSceneRuntimeMsLabel(next.impactHoldMs);
    if (runtimeValueNodes.brightnessFloor) runtimeValueNodes.brightnessFloor.textContent = formatLiveSceneRuntimePercentLabel(next.brightnessFloor);
    if (runtimeValueNodes.brightnessCeil) runtimeValueNodes.brightnessCeil.textContent = formatLiveSceneRuntimePercentLabel(next.brightnessCeil);
    if (runtimeValueNodes.transitionFloorMs) runtimeValueNodes.transitionFloorMs.textContent = formatLiveSceneRuntimeMsLabel(next.transitionFloorMs);
    if (runtimeValueNodes.transitionCeilMs) runtimeValueNodes.transitionCeilMs.textContent = formatLiveSceneRuntimeMsLabel(next.transitionCeilMs);
    if (runtimeValueNodes.telemetryBeatConfidenceMin) runtimeValueNodes.telemetryBeatConfidenceMin.textContent = formatLiveSceneRuntimePercentLabel(next.telemetryBeatConfidenceMin);
    setLiveSceneRuntimeStatus("Unsaved scene runtime tuning.");
  };

  for (const slider of Object.values(runtimeSliders)) {
    if (!slider) continue;
    slider.oninput = updateRuntimeFromUi;
  }
  if (el.sceneRuntimeBpmSource) {
    el.sceneRuntimeBpmSource.onchange = updateRuntimeFromUi;
  }
  if (el.sceneRuntimeResetBtn) {
    el.sceneRuntimeResetBtn.onclick = () => {
      applyLiveSceneRuntimeTuningUi(LIVE_SCENE_RUNTIME_TUNING_DEFAULT, {
        statusText: "Reset to defaults. Save to apply.",
        sync: false
      });
    };
  }
  if (el.sceneRuntimeSaveBtn) {
    el.sceneRuntimeSaveBtn.onclick = () => runLiveButtonAction(
      el.sceneRuntimeSaveBtn,
      "SAVING...",
      async () => {
        const ok = await saveLiveSceneRuntimeTuningUi({
          scope: resolveLiveSceneScopeFromUi()
        });
        if (ok) {
          maybeApplySmartLiveReactivityPolicy("SCENE RUNTIME SAVED");
          sync();
        }
      }
    );
  }

  if (el.liveScopeFixtureSelect) {
    el.liveScopeFixtureSelect.onchange = () => {
      const brand = normalizeLiveSceneScopeBrand(ui.paletteCustomBrand, "hue");
      if (!ui.paletteFixtureSelectionByBrand || typeof ui.paletteFixtureSelectionByBrand !== "object") {
        ui.paletteFixtureSelectionByBrand = { hue: LIVE_SCENE_SCOPE_ALL_FIXTURES_VALUE, wiz: LIVE_SCENE_SCOPE_ALL_FIXTURES_VALUE };
      }
      const selected = normalizeLiveSceneScopeFixtureId(el.liveScopeFixtureSelect.value || LIVE_SCENE_SCOPE_ALL_FIXTURES_VALUE) || LIVE_SCENE_SCOPE_ALL_FIXTURES_VALUE;
      ui.paletteFixtureSelectionByBrand[brand] = selected;
      persistLiveSceneScopeFixtureSelection();
      emitLiveSceneScopeChanged("live_scope_fixture_select_change");
      refreshScopedProfiles({ silent: true }).catch(() => {});
      sync();
    };
  }
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    const refreshScopeListener = () => {
      refreshScopedProfiles({ silent: true }).catch(() => {});
    };
    window.addEventListener("ravelink:live-scope-changed", refreshScopeListener);
    window.addEventListener("ravelink:live-scope-targets-updated", refreshScopeListener);
  }

  refreshScopedProfiles({ silent: true }).catch(() => {});

  return {
    loadLiveSceneFilterAggressivenessUi,
    saveLiveSceneFilterAggressivenessUi,
    applyLiveSceneFilterAggressivenessSnapshot,
    saveLiveSceneRuntimeTuningUi,
    applyLiveSceneRuntimeTuningSnapshot
  };
}
