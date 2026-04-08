// [TITLE] Module: public/assets/js/domains/palette/palette-runtime-wiring-ui.js
// [TITLE] Purpose: palette runtime composition + mutation wiring extracted from palette orchestrator
// [TITLE] Functionality Index:
// [TITLE] - palette runtime module composition bindings
// [TITLE] - palette load/patch mutation queue flows
// [TITLE] - palette action wiring bootstrap (global + brand)
// [DEV] Complex Flow:
// [DEV] This runtime file executes after palette.js and depends on palette domain globals
// [DEV] declared in that orchestrator. Keep script order stable in scripts manifest.

// [TITLE] Palette UI Render + Load Helpers
// [DEV] These functions generate vividness-aware palette swatches/editors and hydrate palette config/contract payloads from server routes without changing payload semantics.
const {
  buildPaletteColorSwatchStyleUi,
  rgbToHsvUi,
  hsvToRgbUi,
  resolvePaletteVividnessProfileUi,
  applyPaletteVividnessToColorUi,
  paletteRgbToHexUi
} = (typeof createPaletteColorUtilsUi === "function"
  ? createPaletteColorUtilsUi({
    clampNumber,
    normalizePaletteVividnessUi
  })
  : (() => {
    throw new Error("palette color utils module missing");
  })());
const {
  buildPaletteCustomFamilyDefineEditorUi,
  buildPaletteGlobalActiveSequenceEditorUi,
  buildPaletteGlobalFamilyLibraryEditorUi,
  buildPaletteFamilyColorEditorUi
} = (typeof createPaletteRenderBuildersUi === "function"
  ? createPaletteRenderBuildersUi({
    clampNumber,
    escapeHtmlUi,
    normalizePaletteBrandUi,
    normalizePaletteSequenceFamilyUi,
    normalizePaletteVividnessUi,
    normalizePaletteCustomFamilyColorsUi,
    getPaletteFamilyColorBankUi,
    parsePaletteColorSequenceEntryUi,
    buildPaletteColorSwatchStyleUi,
    applyPaletteVividnessToColorUi,
    paletteRgbToHexUi
  })
  : (() => {
    throw new Error("palette render builders module missing");
  })());
const {
  markPaletteBrandMenusInteraction,
  renderPaletteBrandMenus
} = (typeof createPaletteBrandViewRuntimeUi === "function"
  ? createPaletteBrandViewRuntimeUi({
    el,
    ui,
    documentRef: document,
    normalizePaletteBrandUi,
    PALETTE_ALL_FIXTURES_VALUE,
    persistPaletteFixtureSelectionMemory,
    PALETTE_BRAND_LABELS,
    getPaletteScopedConfigUi,
    normalizePaletteColorCountUi,
    normalizePaletteFamiliesUi,
    PALETTE_FAMILY_ORDER,
    normalizePaletteDisorderAggressionUi,
    normalizePaletteVividnessUi,
    getFixtureMetricScopedConfigUi,
    normalizeFixtureMetricModeUi,
    FIXTURE_METRIC_CONFIG_DEFAULT,
    normalizeFixtureMetricKeyUi,
    normalizeFixtureMetricHarmonySizeUi,
    normalizeFixtureMetricMaxHzUi,
    FIXTURE_METRIC_MAX_HZ_DEFAULT,
    formatFixtureMetricMaxHzUi,
    escapeHtmlUi,
    PALETTE_FAMILY_DEFS,
    getPaletteFamilyColorBankUi,
    applyPaletteVividnessToColorUi,
    resolvePaletteColorIndexesForFamilyUi,
    buildPaletteFamilyColorEditorUi,
    formatPaletteVividnessLabelUi,
    FIXTURE_METRIC_MODE_ORDER,
    FIXTURE_METRIC_KEYS,
    FIXTURE_METRIC_LABELS,
    FIXTURE_METRIC_HARMONY_MIN,
    FIXTURE_METRIC_HARMONY_MAX,
    FIXTURE_METRIC_MAX_HZ_MIN,
    FIXTURE_METRIC_MAX_HZ_MAX,
    FIXTURE_METRIC_MAX_HZ_STEP,
    PALETTE_SUPPORTED_BRANDS,
    normalizePaletteControlScopeUi,
    normalizePaletteCustomBrandMemoryUi,
    getPaletteBrandFixturesUi
  })
  : (() => {
    throw new Error("palette brand view runtime module missing");
  })());
const {
  renderPaletteFamilyGridRecoveryUi,
  renderPaletteFamilyButtons,
  ensurePaletteFamilyGridHydratedUi,
  syncPaletteUiStateFromRuntime,
  applyPaletteTelemetrySnapshotToUi,
  setPaletteControlScopeUi,
  setPaletteCustomBrandUi
} = (typeof createPaletteGlobalViewRuntimeUi === "function"
  ? createPaletteGlobalViewRuntimeUi({
    el,
    ui,
    PALETTE_FAMILY_ORDER,
    PALETTE_FAMILY_DEFS,
    PALETTE_FAMILY_ALIASES,
    PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP,
    escapeHtmlUi,
    setBadge: (node, state, text) => typeof setBadge === "function" ? setBadge(node, state, text) : undefined,
    getPaletteGlobalConfigUi,
    normalizePaletteColorSequenceUi,
    normalizePaletteSequenceFamilyUi,
    getPaletteFamilyColorBankUi,
    buildPaletteGlobalFamilyLibraryEditorUi,
    buildPaletteGlobalActiveSequenceEditorUi,
    getPaletteGlobalFamilyTab: () => paletteGlobalFamilyTab,
    setPaletteGlobalFamilyTab: value => {
      paletteGlobalFamilyTab = value;
    },
    normalizePaletteControlScopeUi,
    applyPaletteScopeVisibilityUi,
    normalizePaletteBrandUi,
    normalizePaletteCustomBrandMemoryUi,
    renderPaletteBrandMenus,
    sync: syncUiLazy,
    paletteCustomBrandButtons,
    isPaletteGlobalPanelInteractionActive,
    getPaletteFamilyButtons,
    getPaletteFamilyCountSelectors,
    resolvePaletteColorCountForFamilyUi,
    paletteDisorderButtons,
    syncPaletteVividnessSliderUi,
    syncPaletteDisorderAggressionSliderUi,
    normalizePaletteBrightnessFollowAmountUi,
    getPaletteFamiliesLabelUi,
    formatPaletteCountSummaryUi,
    formatPaletteVividnessLabelUi,
    normalizePaletteFamiliesUi,
    normalizePaletteColorCountUi,
    normalizePaletteFamilyColorCountsUi,
    normalizePaletteCustomFamilyColorsUi,
    normalizePaletteFamilyColorIndexesUi,
    normalizePaletteDisorderAggressionUi,
    normalizePaletteCycleModeUi,
    normalizePaletteTimedIntervalSecUi,
    parseBooleanUi,
    normalizePaletteBeatLockGraceSecUi,
    normalizePaletteReactiveMarginUi,
    normalizePaletteVividnessUi,
    normalizePaletteSpectrumMapModeUi,
    normalizePaletteSpectrumFeatureMapUi
  })
  : (() => {
    throw new Error("palette global view runtime module missing");
  })());
// [DEV] Deferred renderer binding:
// [DEV] palette.js constructs scope runtime before this file executes, so we inject the
// [DEV] real family renderer here once it exists to avoid init-order TDZ failures.
let paletteScopeRuntimeForRenderBinding = null;
try {
  paletteScopeRuntimeForRenderBinding = paletteScopeConfigRuntime;
} catch (err) {
  console.debug("[PALETTE][DEBUG] scope runtime unavailable for render binding:", err?.message || err);
}
if (
  paletteScopeRuntimeForRenderBinding &&
  typeof paletteScopeRuntimeForRenderBinding.setRenderPaletteFamilyButtonsUi === "function"
) {
  paletteScopeRuntimeForRenderBinding.setRenderPaletteFamilyButtonsUi(renderPaletteFamilyButtons);
}
const {
  wirePaletteGlobalActionsUi
} = (typeof createPaletteGlobalActionsRuntimeUi === "function"
  ? createPaletteGlobalActionsRuntimeUi({
    el,
    ui,
    sync: syncUiLazy,
    setBadge: (node, state, text) => typeof setBadge === "function" ? setBadge(node, state, text) : undefined,
    paletteCustomBrandButtons,
    paletteDisorderButtons,
    setPaletteControlScopeUi,
    setPaletteCustomBrandUi,
    markPaletteGlobalPanelInteraction,
    isPaletteGlobalScopeActiveUi,
    normalizePaletteVividnessUi,
    syncPaletteVividnessSliderUi,
    renderPaletteFamilyButtons,
    applyPalettePatch,
    formatPaletteVividnessLabelUi,
    loadPaletteConfig,
    getPaletteGlobalConfigUi,
    normalizePaletteColorSequenceUi,
    normalizePaletteCustomFamilyColorsUi,
    clampNumber,
    parsePaletteColorSequenceEntryUi,
    derivePaletteLegacySelectionFromColorSequenceUi,
    normalizePaletteSequenceFamilyUi,
    PALETTE_FAMILY_ORDER,
    getPaletteGlobalFamilyTab: () => paletteGlobalFamilyTab,
    setPaletteGlobalFamilyTab: value => {
      paletteGlobalFamilyTab = value;
    },
    parsePaletteRgbColorTokenUi,
    getPaletteGlobalSequenceDragIndex: () => paletteGlobalSequenceDragIndex,
    setPaletteGlobalSequenceDragIndex: value => {
      paletteGlobalSequenceDragIndex = value;
    },
    normalizePaletteDisorderAggressionUi,
    syncPaletteDisorderAggressionSliderUi
  })
  : (() => {
    throw new Error("palette global actions runtime module missing");
  })());

function applyPaletteVividnessPreviewToSwatchesUi(container, vividnessLevel = 2) {
  if (!container || typeof container.querySelectorAll !== "function") return;
  const vividness = normalizePaletteVividnessUi(vividnessLevel, 2);
  const swatches = Array.from(
    container.querySelectorAll("[data-palette-base-r][data-palette-base-g][data-palette-base-b]")
  );
  swatches.forEach(node => {
    const base = {
      r: clampNumber(Math.round(Number(node.dataset.paletteBaseR) || 0), 0, 255, 0),
      g: clampNumber(Math.round(Number(node.dataset.paletteBaseG) || 0), 0, 255, 0),
      b: clampNumber(Math.round(Number(node.dataset.paletteBaseB) || 0), 0, 255, 0)
    };
    const tuned = applyPaletteVividnessToColorUi(base, vividness);
    node.setAttribute("style", buildPaletteColorSwatchStyleUi(tuned));
  });
}

async function loadPaletteConfig(options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const attempts = clampNumber(Math.round(Number(opts.attempts) || 6), 1, 20, 6);
  const retryDelayMs = clampNumber(Math.round(Number(opts.retryDelayMs) || 300), 50, 4000, 300);
  const silent = opts.silent === true;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const snapshot = await paletteEndpointsAdapter.getPaletteSnapshot();
    if (snapshot && typeof snapshot === "object" && (snapshot.ok !== false)) {
      try {
        applyPaletteRuntimeSnapshotToUi(snapshot);
        return true;
      } catch (err) {
        console.debug("[PALETTE][DEBUG] startup snapshot apply failed:", err?.message || err);
      }
    }
    if (attempt < attempts) {
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
  }

  try {
    const fallbackSnapshot = {
      ok: true,
      config: {},
      catalog: Array.isArray(ui.paletteCatalog) ? ui.paletteCatalog.slice() : [],
      fixtureOverrides: {},
      brandFixtures: {},
      metricRouting: {}
    };
    applyPaletteRuntimeSnapshotToUi(fallbackSnapshot, { forceRender: true });
  } catch (err) {
    console.debug("[PALETTE][DEBUG] fallback palette render failed:", err?.message || err);
    renderPaletteFamilyButtons(Array.isArray(ui.paletteCatalog) ? ui.paletteCatalog : []);
  }

  if (!silent) {
    setBadge(el.health, "warn", "PALETTE STARTUP RETRY ACTIVE");
  }
  return false;
}

// [TITLE] Palette Mutation + Event Wiring
// [DEV] Routes all global and per-brand palette control events through queued patch helpers so UI intent maps to server contracts without parallel mutation races.

/* MANUAL PALETTE SEQUENCER */
async function applyPalettePatch(patch = {}, badgePrefix = "PALETTE") {
  return enqueuePaletteMutation(async () => {
    const r = await paletteEndpointsAdapter.patchPalette(patch);
    if (!r.ok || !r.data || !r.data.ok) {
      const reason = r.data?.error ? `: ${r.data.error}` : "";
      setBadge(el.health, "bad", `${badgePrefix} FAIL${reason}`);
      return false;
    }
    applyPaletteRuntimeSnapshotToUi(r.data || {}, { forceRender: true });
    maybeApplySmartLiveReactivityPolicy(`${badgePrefix} UPDATE`);
    sync();
    return true;
  });
}

async function applyFixtureMetricPatch(patch = {}, badgePrefix = "FIXTURE METRIC") {
  return enqueuePaletteMutation(async () => {
    const r = await paletteEndpointsAdapter.patchFixtureMetrics(patch);
    if (!r.ok || !r.data || !r.data.ok) {
      const reason = r.data?.error ? `: ${r.data.error}` : "";
      setBadge(el.health, "bad", `${badgePrefix} FAIL${reason}`);
      return false;
    }
    applyFixtureMetricRoutingSnapshotToUi(r.data || {});
    if (r.data?.brandFixtures && typeof r.data.brandFixtures === "object") {
      ui.paletteBrandFixtures = {
        hue: Array.isArray(r.data.brandFixtures.hue) ? r.data.brandFixtures.hue.slice() : [],
        wiz: Array.isArray(r.data.brandFixtures.wiz) ? r.data.brandFixtures.wiz.slice() : []
      };
    }
    renderPaletteBrandMenus({ force: true, reason: "fixture_metric_patch" });
    sync();
    return true;
  });
}

async function applyFixtureRoutingClearPatch(patch = {}, badgePrefix = "OVERRIDE") {
  return enqueuePaletteMutation(async () => {
    const r = await paletteEndpointsAdapter.clearFixtureRouting(patch);
    if (!r.ok || !r.data || !r.data.ok) {
      const reason = r.data?.error ? `: ${r.data.error}` : "";
      setBadge(el.health, "bad", `${badgePrefix} FAIL${reason}`);
      return false;
    }
    applyPaletteRuntimeSnapshotToUi(r.data || {}, { forceRender: true });
    maybeApplySmartLiveReactivityPolicy(`${badgePrefix} UPDATE`);
    sync();
    return true;
  });
}

function syncPaletteDisorderAggressionSliderUi() {
  const pct = Math.round(normalizePaletteDisorderAggressionUi(ui.paletteDisorderAggression, 0.35) * 100);
  if (el.paletteDisorderAggression) el.paletteDisorderAggression.value = String(pct);
  if (el.paletteDisorderAggressionVal) el.paletteDisorderAggressionVal.textContent = `${pct}%`;
}

function syncPaletteVividnessSliderUi() {
  const vividness = normalizePaletteVividnessUi(ui.paletteVividness, 2);
  ui.paletteVividness = vividness;
  if (el.paletteVividness) el.paletteVividness.value = String(vividness);
  if (el.paletteVividnessVal) el.paletteVividnessVal.textContent = formatPaletteVividnessLabelUi(vividness);
}

function isPaletteGlobalScopeActiveUi() {
  return normalizePaletteControlScopeUi(ui.paletteControlScope, "global") === "global";
}

function formatPaletteVividnessLabelUi(level) {
  const key = normalizePaletteVividnessUi(level, 2);
  return PALETTE_VIVIDNESS_LABELS[key] || String(key);
}

function applyPaletteScopeVisibilityUi(scope = "global") {
  const normalizedScope = normalizePaletteControlScopeUi(scope, "global");
  const customScopeActive = normalizedScope === "custom";
  if (el.paletteScopeGlobalBtn) {
    el.paletteScopeGlobalBtn.classList.toggle("active", !customScopeActive);
  }
  if (el.paletteScopeCustomBtn) {
    el.paletteScopeCustomBtn.classList.toggle("active", customScopeActive);
  }
  if (el.paletteGlobalPanel) {
    el.paletteGlobalPanel.classList.toggle("hidden", customScopeActive);
  }
  if (el.paletteCustomPanel) {
    el.paletteCustomPanel.classList.toggle("hidden", !customScopeActive);
  }
  if (el.liveScopeCustomTargetPanel) {
    el.liveScopeCustomTargetPanel.classList.toggle("hidden", !customScopeActive);
  }
}

wirePaletteGlobalActionsUi();

function getPaletteBrandScopePatchUi(brandKey) {
  const brand = normalizePaletteBrandUi(brandKey);
  if (!brand) return null;
  const fixtures = getPaletteBrandFixturesUi(brand);
  const validFixtureIds = new Set(fixtures.map(entry => String(entry.id || "").trim()).filter(Boolean));
  const requested = String(ui.paletteFixtureSelectionByBrand?.[brand] || PALETTE_ALL_FIXTURES_VALUE).trim();
  const selected = requested !== PALETTE_ALL_FIXTURES_VALUE && validFixtureIds.has(requested)
    ? requested
    : PALETTE_ALL_FIXTURES_VALUE;
  if (ui.paletteFixtureSelectionByBrand[brand] !== selected) {
    ui.paletteFixtureSelectionByBrand[brand] = selected;
    persistPaletteFixtureSelectionMemory();
  }
  const patch = { brand };
  if (selected && selected !== PALETTE_ALL_FIXTURES_VALUE) {
    patch.fixtureId = selected;
  }
  return patch;
}


const {
  wirePaletteBrandActionsUi
} = (typeof createPaletteBrandActionsRuntimeUi === "function"
  ? createPaletteBrandActionsRuntimeUi({
    el,
    ui,
    sync: syncUiLazy,
    setBadge: (node, state, text) => typeof setBadge === "function" ? setBadge(node, state, text) : undefined,
    PALETTE_ALL_FIXTURES_VALUE,
    persistPaletteFixtureSelectionMemory,
    markPaletteBrandMenusInteraction,
    normalizePaletteBrandUi,
    parsePaletteRgbColorTokenUi,
    getPaletteBrandScopePatchUi,
    getPaletteScopedConfigUi,
    normalizePaletteCustomFamilyColorsUi,
    applyPalettePatch,
    clampNumber,
    PALETTE_FAMILY_ORDER,
    resolvePaletteColorIndexesForFamilyUi,
    normalizePaletteFamiliesUi,
    getPaletteFamiliesLabelUi,
    applyFixtureMetricPatch,
    normalizeFixtureMetricModeUi,
    FIXTURE_METRIC_CONFIG_DEFAULT,
    normalizeFixtureMetricKeyUi,
    FIXTURE_METRIC_LABELS,
    normalizeFixtureMetricMaxHzUi,
    FIXTURE_METRIC_MAX_HZ_DEFAULT,
    formatFixtureMetricMaxHzUi,
    normalizePaletteDisorderAggressionUi,
    normalizePaletteVividnessUi,
    formatPaletteVividnessLabelUi,
    applyPaletteVividnessPreviewToSwatchesUi,
    normalizeFixtureMetricHarmonySizeUi,
    renderPaletteBrandMenus,
    applyFixtureRoutingClearPatch
  })
  : (() => {
    throw new Error("palette brand actions runtime module missing");
  })());

wirePaletteBrandActionsUi();

// [DEV] Startup fail-safe:
// [DEV] Render palette family/category controls from local defaults immediately so
// [DEV] UI never remains stuck on static "Loading palette families..." placeholder
// [DEV] if bootstrap/API hydration is delayed or interrupted.
if (el.paletteFamilyGrid) {
  try {
    renderPaletteFamilyButtons(Array.isArray(ui.paletteCatalog) ? ui.paletteCatalog : []);
  } catch (err) {
    console.debug("[PALETTE][DEBUG] initial local render failed:", err?.message || err);
  }
}
