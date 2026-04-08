// [TITLE] Module: public/assets/js/domains/live/live-profile-snapshot-runtime-ui.js
// [TITLE] Purpose: LIVE profile snapshot normalization, capture, and apply ownership
// [TITLE] Functionality Index:
// [TITLE] - LIVE profile snapshot normalization helpers
// [TITLE] - runtime palette / fixture metric / sync-group snapshot capture
// [TITLE] - snapshot apply flow across LIVE scene, cadence, palette, and metrics
// [DEV] Complex Flow:
// [DEV] This runtime owns the mutable snapshot boundary between saved LIVE profiles and
// [DEV] current scene runtime state. Keep storage/select UI concerns out of this file.

const LIVE_PROFILE_DEFAULT = Object.freeze({
  sceneLock: "auto",
  cadenceAutoEnabled: false,
  overclockAutoEnabled: false,
  overclockLevel: 2,
  sceneFilterAggressiveness: Object.freeze({
    calm: 1,
    groove: 1,
    impact: 1
  }),
  sceneRuntimeTuning: Object.freeze({
    bpmSourceMode: "hybrid",
    sceneSwitchCooldownMs: 260,
    impactHoldMs: 140,
    brightnessFloor: 0.02,
    brightnessCeil: 1,
    transitionFloorMs: 32,
    transitionCeilMs: 190,
    telemetryBeatConfidenceMin: 0.34
  }),
  paletteSnapshot: null,
  fixtureMetricSnapshot: null,
  syncGroups: null
});
const LIVE_PROFILE_ALLOWED_SCENES = new Set(["auto", "steady", "motion", "impact"]);

function normalizeLiveProfileSceneLock(value, fallback = "auto") {
  const key = String(value || "").trim().toLowerCase();
  if (key === "calm" || key === "steady") return "steady";
  if (key === "groove" || key === "motion") return "motion";
  if (key === "impact") return "impact";
  if (key === "meta_auto") return "auto";
  if (LIVE_PROFILE_ALLOWED_SCENES.has(key)) return key;
  return fallback;
}

function cloneLiveProfileData(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function normalizeLiveProfileSyncGroupsSnapshotSafe(raw = null, fallback = null) {
  if (typeof normalizeLiveProfileSyncGroupsSnapshot === "function") {
    return normalizeLiveProfileSyncGroupsSnapshot(raw, fallback);
  }
  const source = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw
    : (fallback && typeof fallback === "object" && !Array.isArray(fallback) ? fallback : null);
  return source ? cloneLiveProfileData(source, null) : null;
}

function normalizeLiveProfilePaletteSnapshot(raw = null, fallback = null) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw
    : (fallback && typeof fallback === "object" && !Array.isArray(fallback) ? fallback : null);
  if (!source) return null;

  const globalRaw = source.config && typeof source.config === "object"
    ? source.config
    : source;
  const normalizedGlobal = typeof normalizePaletteConfigUi === "function"
    ? normalizePaletteConfigUi(globalRaw, globalRaw)
    : cloneLiveProfileData(globalRaw, {});

  const normalizedBrands = typeof normalizePaletteBrandOverridesUi === "function"
    ? normalizePaletteBrandOverridesUi(source.brands, normalizedGlobal)
    : cloneLiveProfileData(source.brands, { hue: null, wiz: null });

  const normalizedFixtureOverrides = typeof normalizePaletteFixtureOverridesUi === "function"
    ? normalizePaletteFixtureOverridesUi(source.fixtureOverrides, normalizedBrands, normalizedGlobal)
    : cloneLiveProfileData(source.fixtureOverrides, {});

  const defaultSelection = typeof PALETTE_ALL_FIXTURES_VALUE === "string"
    ? PALETTE_ALL_FIXTURES_VALUE
    : "__all__";
  const brands = Array.isArray(PALETTE_SUPPORTED_BRANDS) && PALETTE_SUPPORTED_BRANDS.length
    ? PALETTE_SUPPORTED_BRANDS
    : ["hue", "wiz"];
  const fixtureSelectionByBrand = {};
  const rawSelection = source.fixtureSelectionByBrand && typeof source.fixtureSelectionByBrand === "object"
    ? source.fixtureSelectionByBrand
    : {};
  for (const brand of brands) {
    fixtureSelectionByBrand[brand] = String(rawSelection[brand] || defaultSelection).trim() || defaultSelection;
  }

  const normalizedScope = typeof normalizePaletteControlScopeUi === "function"
    ? normalizePaletteControlScopeUi(source.controlScope, "global")
    : (String(source.controlScope || "global").trim().toLowerCase() === "custom" ? "custom" : "global");
  const normalizedCustomBrand = typeof normalizePaletteCustomBrandMemoryUi === "function"
    ? normalizePaletteCustomBrandMemoryUi(source.customBrand, "hue")
    : (String(source.customBrand || "hue").trim().toLowerCase() || "hue");

  return {
    config: cloneLiveProfileData(normalizedGlobal, {}),
    brands: cloneLiveProfileData(normalizedBrands, { hue: null, wiz: null }),
    fixtureOverrides: cloneLiveProfileData(normalizedFixtureOverrides, {}),
    controlScope: normalizedScope,
    customBrand: normalizedCustomBrand,
    fixtureSelectionByBrand
  };
}

function normalizeLiveProfileFixtureMetricSnapshot(raw = null, fallback = null) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw
    : (fallback && typeof fallback === "object" && !Array.isArray(fallback) ? fallback : null);
  if (!source) return null;

  const globalRaw = source.config && typeof source.config === "object"
    ? source.config
    : source;
  const normalizedGlobal = typeof normalizeFixtureMetricConfigUi === "function"
    ? normalizeFixtureMetricConfigUi(globalRaw, globalRaw)
    : cloneLiveProfileData(globalRaw, {});

  const normalizedBrands = typeof normalizeFixtureMetricBrandOverridesUi === "function"
    ? normalizeFixtureMetricBrandOverridesUi(source.brands, normalizedGlobal)
    : cloneLiveProfileData(source.brands, { hue: null, wiz: null });

  const normalizedFixtureOverrides = typeof normalizeFixtureMetricFixtureOverridesUi === "function"
    ? normalizeFixtureMetricFixtureOverridesUi(source.fixtureOverrides, normalizedBrands, normalizedGlobal)
    : cloneLiveProfileData(source.fixtureOverrides, {});

  return {
    config: cloneLiveProfileData(normalizedGlobal, {}),
    brands: cloneLiveProfileData(normalizedBrands, { hue: null, wiz: null }),
    fixtureOverrides: cloneLiveProfileData(normalizedFixtureOverrides, {})
  };
}

async function buildLiveProfilePaletteSnapshotFromRuntime() {
  const runtime = await liveEndpointsAdapter.getPaletteSnapshot();
  if (runtime && runtime.ok) {
    return normalizeLiveProfilePaletteSnapshot({
      config: runtime.config || {},
      brands: runtime.brands || {},
      fixtureOverrides: runtime.fixtureOverrides || {},
      controlScope: ui.paletteControlScope,
      customBrand: ui.paletteCustomBrand,
      fixtureSelectionByBrand: ui.paletteFixtureSelectionByBrand
    });
  }
  return normalizeLiveProfilePaletteSnapshot({
    config: typeof getPaletteGlobalConfigUi === "function" ? getPaletteGlobalConfigUi() : {},
    brands: ui.paletteBrandOverrides || {},
    fixtureOverrides: ui.paletteFixtureOverrides || {},
    controlScope: ui.paletteControlScope,
    customBrand: ui.paletteCustomBrand,
    fixtureSelectionByBrand: ui.paletteFixtureSelectionByBrand
  });
}

async function buildLiveProfileFixtureMetricSnapshotFromRuntime() {
  const runtime = await liveEndpointsAdapter.getFixtureMetricSnapshot();
  if (runtime && runtime.ok) {
    return normalizeLiveProfileFixtureMetricSnapshot({
      config: runtime.config || {},
      brands: runtime.brands || {},
      fixtureOverrides: runtime.fixtureOverrides || {}
    });
  }
  return normalizeLiveProfileFixtureMetricSnapshot({
    config: ui.fixtureMetricConfig || {},
    brands: ui.fixtureMetricBrandOverrides || {},
    fixtureOverrides: ui.fixtureMetricFixtureOverrides || {}
  });
}

async function applyLiveProfilePaletteSnapshot(snapshot = null) {
  const next = normalizeLiveProfilePaletteSnapshot(snapshot, null);
  if (!next) return true;
  if (typeof applyPalettePatch !== "function") return false;

  let ok = true;
  const brands = Array.isArray(PALETTE_SUPPORTED_BRANDS) && PALETTE_SUPPORTED_BRANDS.length
    ? PALETTE_SUPPORTED_BRANDS
    : ["hue", "wiz"];

  for (const brand of brands) {
    const cleared = await applyPalettePatch({ brand, clearOverride: true }, "LIVE PROFILE PALETTE");
    if (!cleared) ok = false;
  }

  const globalPatch = next.config && typeof next.config === "object"
    ? { ...next.config }
    : {};
  const globalOk = await applyPalettePatch(globalPatch, "LIVE PROFILE PALETTE");
  if (!globalOk) ok = false;

  for (const brand of brands) {
    const brandConfig = next.brands && next.brands[brand] && typeof next.brands[brand] === "object"
      ? next.brands[brand]
      : null;
    if (!brandConfig) continue;
    const brandOk = await applyPalettePatch({ ...brandConfig, brand }, "LIVE PROFILE PALETTE");
    if (!brandOk) ok = false;
  }

  const fixtureEntries = Object.entries(next.fixtureOverrides || {});
  for (const [fixtureIdRaw, configRaw] of fixtureEntries) {
    const fixtureId = String(fixtureIdRaw || "").trim();
    const config = configRaw && typeof configRaw === "object" ? configRaw : null;
    const brand = String(config?.brand || "").trim().toLowerCase();
    if (!fixtureId || !config || !brand) continue;
    const fixtureOk = await applyPalettePatch(
      { ...config, fixtureId, brand },
      "LIVE PROFILE PALETTE"
    );
    if (!fixtureOk) ok = false;
  }

  ui.paletteFixtureSelectionByBrand = cloneLiveProfileData(
    next.fixtureSelectionByBrand || ui.paletteFixtureSelectionByBrand || {},
    ui.paletteFixtureSelectionByBrand || {}
  );
  if (typeof setPaletteControlScopeUi === "function") {
    setPaletteControlScopeUi(next.controlScope || "global", { forceRender: true, sync: false });
  } else {
    ui.paletteControlScope = String(next.controlScope || "global").trim().toLowerCase() === "custom"
      ? "custom"
      : "global";
  }
  if (typeof setPaletteCustomBrandUi === "function") {
    setPaletteCustomBrandUi(next.customBrand || "hue", { forceRender: true, sync: false });
  } else {
    ui.paletteCustomBrand = String(next.customBrand || "hue").trim().toLowerCase() || "hue";
  }
  if (typeof renderPaletteBrandMenus === "function") {
    renderPaletteBrandMenus({ force: true, reason: "live_profile_palette_restore" });
  }
  return ok;
}

async function applyLiveProfileFixtureMetricSnapshot(snapshot = null) {
  const next = normalizeLiveProfileFixtureMetricSnapshot(snapshot, null);
  if (!next) return true;
  if (typeof applyFixtureMetricPatch !== "function") return false;

  let ok = true;
  const brands = Array.isArray(PALETTE_SUPPORTED_BRANDS) && PALETTE_SUPPORTED_BRANDS.length
    ? PALETTE_SUPPORTED_BRANDS
    : ["hue", "wiz"];

  for (const brand of brands) {
    const cleared = await applyFixtureMetricPatch({ brand, clearOverride: true }, "LIVE PROFILE METRIC");
    if (!cleared) ok = false;
  }

  const globalPatch = next.config && typeof next.config === "object"
    ? { ...next.config }
    : {};
  const globalOk = await applyFixtureMetricPatch(globalPatch, "LIVE PROFILE METRIC");
  if (!globalOk) ok = false;

  for (const brand of brands) {
    const brandConfig = next.brands && next.brands[brand] && typeof next.brands[brand] === "object"
      ? next.brands[brand]
      : null;
    if (!brandConfig) continue;
    const brandOk = await applyFixtureMetricPatch({ ...brandConfig, brand }, "LIVE PROFILE METRIC");
    if (!brandOk) ok = false;
  }

  const fixtureEntries = Object.entries(next.fixtureOverrides || {});
  for (const [fixtureIdRaw, configRaw] of fixtureEntries) {
    const fixtureId = String(fixtureIdRaw || "").trim();
    const config = configRaw && typeof configRaw === "object" ? configRaw : null;
    const brand = String(config?.brand || "").trim().toLowerCase();
    if (!fixtureId || !config || !brand) continue;
    const fixtureOk = await applyFixtureMetricPatch(
      { ...config, fixtureId, brand },
      "LIVE PROFILE METRIC"
    );
    if (!fixtureOk) ok = false;
  }

  return ok;
}

function normalizeLiveProfileSnapshot(raw = {}, fallback = LIVE_PROFILE_DEFAULT) {
  const source = raw && typeof raw === "object" ? raw : {};
  const base = fallback && typeof fallback === "object" ? fallback : LIVE_PROFILE_DEFAULT;
  const sceneRaw = normalizeLiveProfileSceneLock(source.sceneLock || base.sceneLock || "auto", "auto");
  const overclockLevelRaw = Number(source.overclockLevel);
  const overclockLevelBase = Number(base.overclockLevel);
  const overclockLevel = Number.isFinite(overclockLevelRaw)
    ? Math.max(0, Math.min(7, Math.round(overclockLevelRaw)))
    : (Number.isFinite(overclockLevelBase) ? Math.max(0, Math.min(7, Math.round(overclockLevelBase))) : 2);
  const cadenceAutoEnabled = parseBooleanUi(
    source.cadenceAutoEnabled,
    parseBooleanUi(source.overclockAutoEnabled, parseBooleanUi(base.cadenceAutoEnabled ?? base.overclockAutoEnabled, false))
  ) === true;
  const normalizeSceneFilterProfile = typeof normalizeLiveSceneFilterAggressivenessUi === "function"
    ? normalizeLiveSceneFilterAggressivenessUi
    : ((input = {}, fb = null) => {
      const src = input && typeof input === "object" ? input : {};
      const safeFallback = fb && typeof fb === "object" ? fb : {};
      const normalizeOne = key => clampNumber(
        Number(src[key]),
        0.45,
        2.1,
        clampNumber(Number(safeFallback[key]), 0.45, 2.1, 1)
      );
      return {
        calm: normalizeOne("calm"),
        groove: normalizeOne("groove"),
        impact: normalizeOne("impact")
      };
    });
  const sceneFilterAggressiveness = normalizeSceneFilterProfile(
    source.sceneFilterAggressiveness,
    base.sceneFilterAggressiveness
  );
  const normalizeSceneRuntimeTuningProfile = typeof normalizeLiveSceneRuntimeTuningUi === "function"
    ? normalizeLiveSceneRuntimeTuningUi
    : ((input = {}, fb = null) => {
      const src = input && typeof input === "object" ? input : {};
      const safeFallback = fb && typeof fb === "object" ? fb : {};
      return { ...safeFallback, ...src };
    });
  const sceneRuntimeTuning = normalizeSceneRuntimeTuningProfile(
    source.sceneRuntimeTuning,
    base.sceneRuntimeTuning
  );
  const paletteSnapshot = normalizeLiveProfilePaletteSnapshot(
    source.paletteSnapshot,
    base.paletteSnapshot
  );
  const fixtureMetricSnapshot = normalizeLiveProfileFixtureMetricSnapshot(
    source.fixtureMetricSnapshot,
    base.fixtureMetricSnapshot
  );
  const syncGroups = normalizeLiveProfileSyncGroupsSnapshotSafe(
    source.syncGroups,
    base.syncGroups
  );
  return {
    sceneLock: LIVE_PROFILE_ALLOWED_SCENES.has(sceneRaw) ? sceneRaw : "auto",
    cadenceAutoEnabled,
    overclockAutoEnabled: cadenceAutoEnabled,
    overclockLevel,
    sceneFilterAggressiveness,
    sceneRuntimeTuning,
    paletteSnapshot,
    fixtureMetricSnapshot,
    syncGroups
  };
}

function formatLiveProfileSnapshotSummary(snapshot = {}) {
  const safe = normalizeLiveProfileSnapshot(snapshot, LIVE_PROFILE_DEFAULT);
  const scene = safe.sceneLock === "auto" ? "SCENE AUTO" : `SCENE ${String(safe.sceneLock || "").toUpperCase()}`;
  const hz = safe.cadenceAutoEnabled
    ? "AUTO HZ"
    : `${Math.max(0, Math.min(7, Math.round(Number(safe.overclockLevel) || 0)))} STEP HZ`;
  return [scene, hz].join(" | ");
}

function pulseLiveProfileAppliedControls(snapshot = {}) {
  const safe = normalizeLiveProfileSnapshot(snapshot, LIVE_PROFILE_DEFAULT);
  const normalizedSceneLock = normalizeLiveProfileSceneLock(safe.sceneLock, "auto");
  const targets = [];
  const sceneBtn = sceneButtons.find(btn => btn.dataset.scene === normalizedSceneLock);
  if (sceneBtn) targets.push(sceneBtn);

  if (safe.cadenceAutoEnabled && el.ocAutoBtn) {
    targets.push(el.ocAutoBtn);
  } else {
    const overclockButtonsByLevel = {
      0: el.ocOffBtn,
      1: el.ocOnBtn,
      2: el.ocTurboBtn,
      3: el.ocUltraBtn,
      4: el.ocExtremeBtn,
      5: el.ocInsaneBtn,
      6: el.ocHyperBtn,
      7: el.ocLudicrousBtn
    };
    const level = Math.max(0, Math.min(7, Math.round(Number(safe.overclockLevel) || 0)));
    const targetBtn = overclockButtonsByLevel[level];
    if (targetBtn) targets.push(targetBtn);
  }

  const uniqueTargets = [...new Set(targets.filter(Boolean))];
  for (const node of uniqueTargets) {
    node.classList.remove("profileAppliedPulse");
  }
  requestAnimationFrame(() => {
    for (const node of uniqueTargets) {
      node.classList.add("profileAppliedPulse");
    }
    setTimeout(() => {
      for (const node of uniqueTargets) {
        node.classList.remove("profileAppliedPulse");
      }
    }, 1000);
  });
}

function buildLiveProfileSnapshotFromUi() {
  const paletteSnapshot = normalizeLiveProfilePaletteSnapshot({
    config: typeof getPaletteGlobalConfigUi === "function" ? getPaletteGlobalConfigUi() : {},
    brands: ui.paletteBrandOverrides || {},
    fixtureOverrides: ui.paletteFixtureOverrides || {},
    controlScope: ui.paletteControlScope,
    customBrand: ui.paletteCustomBrand,
    fixtureSelectionByBrand: ui.paletteFixtureSelectionByBrand
  });
  const fixtureMetricSnapshot = normalizeLiveProfileFixtureMetricSnapshot({
    config: ui.fixtureMetricConfig || {},
    brands: ui.fixtureMetricBrandOverrides || {},
    fixtureOverrides: ui.fixtureMetricFixtureOverrides || {}
  });
  const syncGroups = normalizeLiveProfileSyncGroupsSnapshotSafe(
    ui.liveSyncGroups || null,
    null
  );
  return normalizeLiveProfileSnapshot({
    sceneLock: ui.sceneLock,
    cadenceAutoEnabled: ui.cadenceAutoEnabled,
    overclockAutoEnabled: ui.overclockAutoEnabled,
    overclockLevel: ui.overclockLevel,
    sceneFilterAggressiveness: ui.sceneFilterAggressiveness,
    sceneRuntimeTuning: ui.sceneRuntimeTuning,
    paletteSnapshot,
    fixtureMetricSnapshot,
    syncGroups
  }, LIVE_PROFILE_DEFAULT);
}

async function applyLiveProfileSnapshot(snapshot = {}, options = {}) {
  const announce = options.announce !== false;
  const forcePoll = options.forcePoll === true;
  const pulse = options.pulse !== false;
  const next = normalizeLiveProfileSnapshot(snapshot, LIVE_PROFILE_DEFAULT);
  let ok = true;

  const autoHzOk = await setOverclockAutoEnabled(next.cadenceAutoEnabled, { announce: false });
  if (!autoHzOk) ok = false;

  if (!next.cadenceAutoEnabled) {
    const safeLevel = Math.max(0, Math.min(7, Math.round(Number(next.overclockLevel) || 2)));
    const overclockOk = await setOverclockPreset(safeLevel, "");
    if (!overclockOk) ok = false;
  }

  const compatResp = await liveEndpointsAdapter.patchSceneIntent({
    sceneLock: next.sceneLock
  });
  if (compatResp.ok && compatResp.data && compatResp.data.ok === true) {
    const applied = compatResp.data.applied && typeof compatResp.data.applied === "object"
      ? compatResp.data.applied
      : {};
    const snapshotData = compatResp.data.snapshot && typeof compatResp.data.snapshot === "object"
      ? compatResp.data.snapshot
      : {};
    ui.sceneLock = normalizeLiveProfileSceneLock(
      applied.sceneLock || snapshotData.sceneLock || next.sceneLock || "auto",
      "auto"
    );
    ui.brightnessPowerMode = "b";
    ui.flowIntensity = 1;
    ui.flowIntensityInputUntil = Date.now() + 600;
    applyFlowIntensityUi();
  } else {
    ok = false;
  }
  if (typeof applyLiveSceneFilterAggressivenessSnapshot === "function") {
    const sceneFilterOk = await applyLiveSceneFilterAggressivenessSnapshot(
      next.sceneFilterAggressiveness,
      { announce: false }
    );
    if (!sceneFilterOk) ok = false;
  }
  if (typeof applyLiveSceneRuntimeTuningSnapshot === "function") {
    const sceneRuntimeOk = await applyLiveSceneRuntimeTuningSnapshot(
      next.sceneRuntimeTuning,
      { announce: false }
    );
    if (!sceneRuntimeOk) ok = false;
  }

  const paletteOk = await applyLiveProfilePaletteSnapshot(next.paletteSnapshot);
  if (!paletteOk) ok = false;
  const fixtureMetricOk = await applyLiveProfileFixtureMetricSnapshot(next.fixtureMetricSnapshot);
  if (!fixtureMetricOk) ok = false;
  if (next.syncGroups && typeof applyLiveSyncGroupsSnapshot === "function") {
    const syncGroupsOk = await applyLiveSyncGroupsSnapshot(next.syncGroups, { announce: false });
    if (!syncGroupsOk) ok = false;
  }

  maybeApplySmartLiveReactivityPolicy("LIVE PROFILE LOAD");
  if (forcePoll) {
    try {
      await poll({ force: true });
    } catch {
      ok = false;
      sync();
    }
  } else {
    sync();
  }
  if (pulse) {
    pulseLiveProfileAppliedControls(buildLiveProfileSnapshotFromUi());
  }
  if (announce) {
    setBadge(el.health, ok ? "ok" : "warn", ok ? "LIVE PROFILE APPLIED" : "LIVE PROFILE APPLIED (PARTIAL)");
  }
  return ok;
}
