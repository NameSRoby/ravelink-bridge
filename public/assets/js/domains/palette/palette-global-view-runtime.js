// [TITLE] Module: public/assets/js/domains/palette/palette-global-view-runtime.js
// [TITLE] Purpose: render, sync, and telemetry projection for the global palette panel
// [TITLE] Functionality Index:
// [TITLE] - deterministic family-grid recovery render
// [TITLE] - family library/sequence render
// [TITLE] - family-grid hydration repair
// [TITLE] - global palette panel runtime sync
// [TITLE] - telemetry snapshot projection into palette UI state
// [DEV] Complex Flow:
// [DEV] This module owns only the global palette view/runtime projection layer. It does
// [DEV] not own palette mutation routes or direct event binding. Mutable palette state and
// [DEV] patch/apply actions stay in palette.js and are injected into this runtime.

function createPaletteGlobalViewRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const PALETTE_FAMILY_ORDER = Array.isArray(deps.PALETTE_FAMILY_ORDER) ? deps.PALETTE_FAMILY_ORDER : [];
  const PALETTE_FAMILY_DEFS = deps.PALETTE_FAMILY_DEFS || {};
  const PALETTE_FAMILY_ALIASES = deps.PALETTE_FAMILY_ALIASES || {};
  const PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP = deps.PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP || [];
  const escapeHtmlUi = typeof deps.escapeHtmlUi === "function" ? deps.escapeHtmlUi : (value => String(value || ""));
  const setBadge = typeof deps.setBadge === "function" ? deps.setBadge : (() => {});
  const getPaletteGlobalConfigUi = typeof deps.getPaletteGlobalConfigUi === "function" ? deps.getPaletteGlobalConfigUi : (() => ({}));
  const normalizePaletteColorSequenceUi = typeof deps.normalizePaletteColorSequenceUi === "function" ? deps.normalizePaletteColorSequenceUi : (value => Array.isArray(value) ? value : []);
  const normalizePaletteSequenceFamilyUi = typeof deps.normalizePaletteSequenceFamilyUi === "function" ? deps.normalizePaletteSequenceFamilyUi : (value => String(value || "").trim().toLowerCase());
  const getPaletteFamilyColorBankUi = typeof deps.getPaletteFamilyColorBankUi === "function" ? deps.getPaletteFamilyColorBankUi : (() => []);
  const buildPaletteGlobalFamilyLibraryEditorUi = typeof deps.buildPaletteGlobalFamilyLibraryEditorUi === "function" ? deps.buildPaletteGlobalFamilyLibraryEditorUi : (() => "");
  const buildPaletteGlobalActiveSequenceEditorUi = typeof deps.buildPaletteGlobalActiveSequenceEditorUi === "function" ? deps.buildPaletteGlobalActiveSequenceEditorUi : (() => "");
  const getPaletteGlobalFamilyTab = typeof deps.getPaletteGlobalFamilyTab === "function" ? deps.getPaletteGlobalFamilyTab : (() => "red");
  const setPaletteGlobalFamilyTab = typeof deps.setPaletteGlobalFamilyTab === "function" ? deps.setPaletteGlobalFamilyTab : (() => {});
  const normalizePaletteControlScopeUi = typeof deps.normalizePaletteControlScopeUi === "function" ? deps.normalizePaletteControlScopeUi : (value => String(value || "global").trim().toLowerCase());
  const applyPaletteScopeVisibilityUi = typeof deps.applyPaletteScopeVisibilityUi === "function" ? deps.applyPaletteScopeVisibilityUi : (() => {});
  const normalizePaletteBrandUi = typeof deps.normalizePaletteBrandUi === "function" ? deps.normalizePaletteBrandUi : (value => String(value || "").trim().toLowerCase());
  const normalizePaletteCustomBrandMemoryUi = typeof deps.normalizePaletteCustomBrandMemoryUi === "function" ? deps.normalizePaletteCustomBrandMemoryUi : ((_value, fallback) => fallback || "hue");
  const renderPaletteBrandMenus = typeof deps.renderPaletteBrandMenus === "function" ? deps.renderPaletteBrandMenus : (() => {});
  const sync = typeof deps.sync === "function" ? deps.sync : (() => {});
  const paletteCustomBrandButtons = Array.isArray(deps.paletteCustomBrandButtons) ? deps.paletteCustomBrandButtons : [];
  const isPaletteGlobalPanelInteractionActive = typeof deps.isPaletteGlobalPanelInteractionActive === "function" ? deps.isPaletteGlobalPanelInteractionActive : (() => false);
  const getPaletteFamilyButtons = typeof deps.getPaletteFamilyButtons === "function" ? deps.getPaletteFamilyButtons : (() => []);
  const getPaletteFamilyCountSelectors = typeof deps.getPaletteFamilyCountSelectors === "function" ? deps.getPaletteFamilyCountSelectors : (() => []);
  const resolvePaletteColorCountForFamilyUi = typeof deps.resolvePaletteColorCountForFamilyUi === "function" ? deps.resolvePaletteColorCountForFamilyUi : (() => 3);
  const paletteDisorderButtons = Array.isArray(deps.paletteDisorderButtons) ? deps.paletteDisorderButtons : [];
  const syncPaletteVividnessSliderUi = typeof deps.syncPaletteVividnessSliderUi === "function" ? deps.syncPaletteVividnessSliderUi : (() => {});
  const syncPaletteDisorderAggressionSliderUi = typeof deps.syncPaletteDisorderAggressionSliderUi === "function" ? deps.syncPaletteDisorderAggressionSliderUi : (() => {});
  const normalizePaletteBrightnessFollowAmountUi = typeof deps.normalizePaletteBrightnessFollowAmountUi === "function" ? deps.normalizePaletteBrightnessFollowAmountUi : (value => Number(value) || 1);
  const getPaletteFamiliesLabelUi = typeof deps.getPaletteFamiliesLabelUi === "function" ? deps.getPaletteFamiliesLabelUi : (() => "PALETTE");
  const formatPaletteCountSummaryUi = typeof deps.formatPaletteCountSummaryUi === "function" ? deps.formatPaletteCountSummaryUi : (() => "");
  const formatPaletteVividnessLabelUi = typeof deps.formatPaletteVividnessLabelUi === "function" ? deps.formatPaletteVividnessLabelUi : (value => String(value || ""));
  const normalizePaletteFamiliesUi = typeof deps.normalizePaletteFamiliesUi === "function" ? deps.normalizePaletteFamiliesUi : (value => Array.isArray(value) ? value : []);
  const normalizePaletteColorCountUi = typeof deps.normalizePaletteColorCountUi === "function" ? deps.normalizePaletteColorCountUi : (value => Number(value) || 3);
  const normalizePaletteFamilyColorCountsUi = typeof deps.normalizePaletteFamilyColorCountsUi === "function" ? deps.normalizePaletteFamilyColorCountsUi : (value => value || {});
  const normalizePaletteCustomFamilyColorsUi = typeof deps.normalizePaletteCustomFamilyColorsUi === "function" ? deps.normalizePaletteCustomFamilyColorsUi : (value => Array.isArray(value) ? value : []);
  const normalizePaletteFamilyColorIndexesUi = typeof deps.normalizePaletteFamilyColorIndexesUi === "function" ? deps.normalizePaletteFamilyColorIndexesUi : (value => value || {});
  const normalizePaletteDisorderAggressionUi = typeof deps.normalizePaletteDisorderAggressionUi === "function" ? deps.normalizePaletteDisorderAggressionUi : (value => Number(value) || 0.35);
  const normalizePaletteCycleModeUi = typeof deps.normalizePaletteCycleModeUi === "function" ? deps.normalizePaletteCycleModeUi : (value => String(value || "on_trigger").trim().toLowerCase());
  const normalizePaletteTimedIntervalSecUi = typeof deps.normalizePaletteTimedIntervalSecUi === "function" ? deps.normalizePaletteTimedIntervalSecUi : (value => Number(value) || 5);
  const parseBooleanUi = typeof deps.parseBooleanUi === "function" ? deps.parseBooleanUi : (value => Boolean(value));
  const normalizePaletteBeatLockGraceSecUi = typeof deps.normalizePaletteBeatLockGraceSecUi === "function" ? deps.normalizePaletteBeatLockGraceSecUi : (value => Number(value) || 2);
  const normalizePaletteReactiveMarginUi = typeof deps.normalizePaletteReactiveMarginUi === "function" ? deps.normalizePaletteReactiveMarginUi : (value => Number(value) || 28);
  const normalizePaletteVividnessUi = typeof deps.normalizePaletteVividnessUi === "function" ? deps.normalizePaletteVividnessUi : (value => Number(value) || 2);
  const normalizePaletteSpectrumMapModeUi = typeof deps.normalizePaletteSpectrumMapModeUi === "function" ? deps.normalizePaletteSpectrumMapModeUi : (value => String(value || "auto").trim().toLowerCase());
  const normalizePaletteSpectrumFeatureMapUi = typeof deps.normalizePaletteSpectrumFeatureMapUi === "function" ? deps.normalizePaletteSpectrumFeatureMapUi : (value => Array.isArray(value) ? value : []);

  function renderPaletteFamilyGridRecoveryUi(reason = "render_error") {
    if (!el.paletteFamilyGrid) return;
    const safeReason = String(reason || "render_error").trim() || "render_error";
    ui.paletteFamilyGridRecovery = {
      active: true,
      reason: safeReason,
      updatedAt: Date.now()
    };
    el.paletteFamilyGrid.innerHTML =
      `<div class="paletteFamilyLibraryBlock" data-palette-family-recovery="1">` +
        `<p class="hint">Palette family controls paused (${escapeHtmlUi(safeReason)}). Runtime sync will retry from current palette metadata.</p>` +
      `</div>`;
  }

  function renderPaletteFamilyButtons(palettes = []) {
    if (!el.paletteFamilyGrid) return;
    try {
      const source = Array.isArray(palettes) && palettes.length
        ? palettes
        : (Array.isArray(ui.paletteCatalog) ? ui.paletteCatalog : []);
      const labelsByFamily = {};
      for (const palette of source) {
        const raw = String(palette?.id || "").trim().toLowerCase();
        if (!raw) continue;
        const family = PALETTE_FAMILY_ALIASES[raw] || raw;
        if (!PALETTE_FAMILY_ORDER.includes(family)) continue;
        labelsByFamily[family] = String(palette?.label || family).trim().toUpperCase() || family.toUpperCase();
      }
      const config = getPaletteGlobalConfigUi();
      const sequence = normalizePaletteColorSequenceUi(
        config.colorSequence,
        ui.paletteColorSequence,
        config
      );
      const availableFamilies = PALETTE_FAMILY_ORDER.slice();
      const fallbackFamily = availableFamilies.find(family => family !== "custom") || availableFamilies[0] || "red";
      const requestedFamily = normalizePaletteSequenceFamilyUi(getPaletteGlobalFamilyTab());
      const activeFamily = availableFamilies.includes(requestedFamily) ? requestedFamily : fallbackFamily;
      setPaletteGlobalFamilyTab(activeFamily);
      const tabs = availableFamilies.map(family => {
        const defaultLabel = PALETTE_FAMILY_DEFS[family]?.label || family.toUpperCase();
        const rawLabel = String(labelsByFamily[family] || defaultLabel).trim().toUpperCase() || family.toUpperCase();
        return (
          `<button type="button" class="${family === activeFamily ? "active" : ""}" data-palette-family-tab="${family}" title="Show ${escapeHtmlUi(rawLabel)} library controls.">${escapeHtmlUi(rawLabel)}</button>`
        );
      }).join("");
      const familyCards = availableFamilies.map(family => {
        const defaultLabel = PALETTE_FAMILY_DEFS[family]?.label || family.toUpperCase();
        const rawLabel = String(labelsByFamily[family] || defaultLabel).trim().toUpperCase() || family.toUpperCase();
        const baseColorBank = getPaletteFamilyColorBankUi(family, config);
        const customDefineColors = baseColorBank;
        return buildPaletteGlobalFamilyLibraryEditorUi({
          family,
          familyLabel: rawLabel,
          baseColors: baseColorBank,
          customDefineColors,
          vividness: config.vividness,
          sequence,
          hidden: family !== activeFamily
        });
      }).join("");
      el.paletteFamilyGrid.innerHTML =
        `<div class="paletteFamilyLibraryBlock">` +
          `<div class="paletteFamilyTabs compactButtonRow">${tabs}</div>` +
          `<div class="paletteFamilyPanels">${familyCards}</div>` +
        `</div>` +
        buildPaletteGlobalActiveSequenceEditorUi({
          sequence,
          vividness: config.vividness,
          customFamilyColors: config.customFamilyColors
        });
      ui.paletteFamilyGridRecovery = {
        active: false,
        reason: "",
        updatedAt: Date.now()
      };
    } catch (err) {
      console.error("[PALETTE][ERROR] renderPaletteFamilyButtons failed:", err);
      renderPaletteFamilyGridRecoveryUi(err?.message || "render_error");
      setBadge(el.health, "warn", "PALETTE FAMILY UI RECOVERY PENDING");
    }
  }

  function ensurePaletteFamilyGridHydratedUi() {
    if (!el.paletteFamilyGrid) return;
    const hasTabs = Boolean(el.paletteFamilyGrid.querySelector("[data-palette-family-tab]"));
    if (hasTabs) return;
    const recoveryPending = Boolean(el.paletteFamilyGrid.querySelector("[data-palette-family-recovery]"));
    const rawText = String(el.paletteFamilyGrid.textContent || "").trim().toLowerCase();
    if (recoveryPending || rawText.includes("loading palette families")) {
      renderPaletteFamilyButtons(Array.isArray(ui.paletteCatalog) ? ui.paletteCatalog : []);
    }
  }

  function syncPaletteUiStateFromRuntime() {
    ensurePaletteFamilyGridHydratedUi();
    const paletteScope = normalizePaletteControlScopeUi(ui.paletteControlScope, "global");
    const customScopeActive = paletteScope === "custom";
    ui.paletteControlScope = paletteScope;
    applyPaletteScopeVisibilityUi(paletteScope);
    paletteCustomBrandButtons.forEach(btn => {
      const brand = normalizePaletteBrandUi(btn.dataset.paletteCustomBrand);
      const active = brand === normalizePaletteBrandUi(ui.paletteCustomBrand);
      btn.classList.toggle("active", active);
      btn.disabled = !customScopeActive;
    });
    if (el.paletteBrandMenus) {
      const cards = Array.from(el.paletteBrandMenus.querySelectorAll("[data-palette-brand-card]"));
      const availableBrands = cards
        .map(card => normalizePaletteBrandUi(card.dataset.paletteBrandCard))
        .filter(Boolean);
      if (customScopeActive && availableBrands.length && !availableBrands.includes(ui.paletteCustomBrand)) {
        ui.paletteCustomBrand = availableBrands[0];
      }
      cards.forEach(card => {
        const brand = normalizePaletteBrandUi(card.dataset.paletteBrandCard);
        const visible = !customScopeActive || brand === ui.paletteCustomBrand;
        card.classList.toggle("hidden", !visible);
      });
    }

    const globalPaletteConfig = getPaletteGlobalConfigUi();
    const paletteGlobalInteractionActive = isPaletteGlobalPanelInteractionActive();
    if (el.paletteVividness) el.paletteVividness.disabled = customScopeActive;
    if (el.paletteVividnessResetBtn) el.paletteVividnessResetBtn.disabled = customScopeActive;
    getPaletteFamilyButtons().forEach(btn => {
      const key = String(btn.dataset.paletteFamilyTab || btn.dataset.paletteFamily || "").trim().toLowerCase();
      btn.classList.toggle("active", key === normalizePaletteSequenceFamilyUi(getPaletteGlobalFamilyTab()));
      btn.disabled = customScopeActive;
    });
    getPaletteFamilyCountSelectors().forEach(select => {
      const family = String(select.dataset.paletteFamilyCount || "").trim().toLowerCase();
      if (!PALETTE_FAMILY_ORDER.includes(family)) return;
      const count = resolvePaletteColorCountForFamilyUi(globalPaletteConfig, family, ui.paletteColorsPerFamily || 3);
      if (!paletteGlobalInteractionActive) select.value = String(count);
      select.disabled = customScopeActive;
    });
    paletteDisorderButtons.forEach(btn => {
      const disorder = String(btn.dataset.paletteDisorder || "").toLowerCase() === "true";
      btn.classList.toggle("active", disorder === Boolean(ui.paletteDisorder));
      btn.disabled = customScopeActive;
    });
    if (el.paletteDisorderAggression) el.paletteDisorderAggression.disabled = customScopeActive;
    if (el.paletteDisorderAggressionResetBtn) el.paletteDisorderAggressionResetBtn.disabled = customScopeActive;
    syncPaletteVividnessSliderUi();
    syncPaletteDisorderAggressionSliderUi();
    ui.paletteBrightnessFollowAmount = normalizePaletteBrightnessFollowAmountUi(ui.paletteBrightnessFollowAmount, 1);
    if (el.paletteStat) {
      el.paletteStat.textContent = `${getPaletteFamiliesLabelUi(ui.paletteFamilies)} ${formatPaletteCountSummaryUi(globalPaletteConfig, ui.paletteFamilies)} | ${formatPaletteVividnessLabelUi(ui.paletteVividness)}`;
    }
    if (el.paletteOrderStat) {
      el.paletteOrderStat.textContent = ui.paletteDisorder
        ? `DISORDER ${Math.round((ui.paletteDisorderAggression || 0) * 100)}%`
        : "ORDERED";
    }
  }

  function applyPaletteTelemetrySnapshotToUi(telemetry = {}, options = {}) {
    const t = telemetry && typeof telemetry === "object" ? telemetry : {};
    const force = options && options.force === true;
    const paletteTelemetryLocked = !force &&
      normalizePaletteControlScopeUi(ui.paletteControlScope, "global") === "global" &&
      isPaletteGlobalPanelInteractionActive();
    if (paletteTelemetryLocked) return;

    if (Object.prototype.hasOwnProperty.call(t, "paletteFamilies")) {
      ui.paletteFamilies = normalizePaletteFamiliesUi(
        Array.isArray(t.paletteFamilies) ? t.paletteFamilies : String(t.paletteFamilies || ""),
        ui.paletteFamilies || PALETTE_FAMILY_ORDER
      );
    }
    if (Number.isFinite(Number(t.paletteColorsPerFamily))) {
      ui.paletteColorsPerFamily = normalizePaletteColorCountUi(
        t.paletteColorsPerFamily,
        ui.paletteColorsPerFamily || 3
      );
    }
    if (Object.prototype.hasOwnProperty.call(t, "paletteFamilyColorCounts")) {
      ui.paletteFamilyColorCounts = normalizePaletteFamilyColorCountsUi(
        t.paletteFamilyColorCounts,
        ui.paletteFamilyColorCounts,
        ui.paletteColorsPerFamily || 3
      );
    }
    if (Object.prototype.hasOwnProperty.call(t, "paletteCustomFamilyColors")) {
      ui.paletteCustomFamilyColors = normalizePaletteCustomFamilyColorsUi(
        t.paletteCustomFamilyColors,
        ui.paletteCustomFamilyColors
      );
    }
    if (Object.prototype.hasOwnProperty.call(t, "paletteFamilyColorIndexes")) {
      ui.paletteFamilyColorIndexes = normalizePaletteFamilyColorIndexesUi(
        t.paletteFamilyColorIndexes,
        ui.paletteFamilyColorIndexes,
        ui.paletteFamilyColorCounts,
        ui.paletteCustomFamilyColors
      );
    }
    if (Object.prototype.hasOwnProperty.call(t, "paletteColorSequence")) {
      ui.paletteColorSequence = normalizePaletteColorSequenceUi(
        t.paletteColorSequence,
        ui.paletteColorSequence,
        {
          colorsPerFamily: ui.paletteColorsPerFamily,
          familyColorCounts: ui.paletteFamilyColorCounts,
          familyColorIndexes: ui.paletteFamilyColorIndexes,
          customFamilyColors: ui.paletteCustomFamilyColors,
          families: ui.paletteFamilies
        }
      );
    }
    if (typeof t.paletteDisorder === "boolean") {
      ui.paletteDisorder = t.paletteDisorder;
    }
    if (Object.prototype.hasOwnProperty.call(t, "paletteDisorderAggression")) {
      ui.paletteDisorderAggression = normalizePaletteDisorderAggressionUi(
        t.paletteDisorderAggression,
        ui.paletteDisorderAggression || 0.35
      );
    }
    if (Object.prototype.hasOwnProperty.call(t, "paletteCycleMode")) {
      ui.paletteCycleMode = normalizePaletteCycleModeUi(
        t.paletteCycleMode,
        ui.paletteCycleMode || "on_trigger"
      );
    }
    if (Object.prototype.hasOwnProperty.call(t, "paletteTimedIntervalSec")) {
      ui.paletteTimedIntervalSec = normalizePaletteTimedIntervalSecUi(
        t.paletteTimedIntervalSec,
        ui.paletteTimedIntervalSec || 5
      );
    }
    if (Object.prototype.hasOwnProperty.call(t, "paletteBeatLock")) {
      ui.paletteBeatLock = parseBooleanUi(t.paletteBeatLock, ui.paletteBeatLock === true);
    }
    if (Object.prototype.hasOwnProperty.call(t, "paletteBeatLockGraceSec")) {
      ui.paletteBeatLockGraceSec = normalizePaletteBeatLockGraceSecUi(
        t.paletteBeatLockGraceSec,
        ui.paletteBeatLockGraceSec || 2
      );
    }
    if (Object.prototype.hasOwnProperty.call(t, "paletteReactiveMargin")) {
      ui.paletteReactiveMargin = normalizePaletteReactiveMarginUi(
        t.paletteReactiveMargin,
        ui.paletteReactiveMargin || 28
      );
    }
    if (Object.prototype.hasOwnProperty.call(t, "paletteBrightnessFollowAmount")) {
      ui.paletteBrightnessFollowAmount = normalizePaletteBrightnessFollowAmountUi(
        t.paletteBrightnessFollowAmount,
        ui.paletteBrightnessFollowAmount ?? 1
      );
    }
    if (Object.prototype.hasOwnProperty.call(t, "paletteVividness")) {
      ui.paletteVividness = normalizePaletteVividnessUi(
        t.paletteVividness,
        ui.paletteVividness || 2
      );
    }
    if (Object.prototype.hasOwnProperty.call(t, "paletteSpectrumMapMode")) {
      ui.paletteSpectrumMapMode = normalizePaletteSpectrumMapModeUi(
        t.paletteSpectrumMapMode,
        ui.paletteSpectrumMapMode || "auto"
      );
    }
    if (Object.prototype.hasOwnProperty.call(t, "paletteSpectrumFeatureMap")) {
      ui.paletteSpectrumFeatureMap = normalizePaletteSpectrumFeatureMapUi(
        t.paletteSpectrumFeatureMap,
        ui.paletteSpectrumFeatureMap || PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP
      );
    }
  }

  function emitPaletteScopeChangeUi(reason = "palette_scope_changed") {
    if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
    try {
      window.dispatchEvent(new CustomEvent("ravelink:live-scope-changed", {
        detail: {
          reason: String(reason || "palette_scope_changed"),
          scope: normalizePaletteControlScopeUi(ui.paletteControlScope, "global"),
          customBrand: normalizePaletteCustomBrandMemoryUi(ui.paletteCustomBrand, "hue")
        }
      }));
    } catch (err) {
      console.debug("[PALETTE][DEBUG] scope change event dispatch failed:", err?.message || err);
    }
  }

  function setPaletteControlScopeUi(scope, options = {}) {
    const next = normalizePaletteControlScopeUi(scope, ui.paletteControlScope);
    const changed = next !== ui.paletteControlScope;
    ui.paletteControlScope = next;
    applyPaletteScopeVisibilityUi(next);
    if (next === "custom") {
      ui.paletteCustomBrand = normalizePaletteCustomBrandMemoryUi(ui.paletteCustomBrand, "hue");
    }
    if (changed || options.forceRender === true) {
      renderPaletteBrandMenus({ force: true, reason: "palette_scope_change" });
    }
    if (changed || options.forceRender === true) {
      emitPaletteScopeChangeUi("palette_scope_change");
    }
    if (options.sync !== false) {
      sync();
    }
  }

  function setPaletteCustomBrandUi(brand, options = {}) {
    const next = normalizePaletteCustomBrandMemoryUi(brand, ui.paletteCustomBrand);
    const changed = next !== ui.paletteCustomBrand;
    ui.paletteCustomBrand = next;
    if (changed || options.forceRender === true) {
      renderPaletteBrandMenus({ force: true, reason: "palette_custom_brand_change" });
    }
    if (changed || options.forceRender === true) {
      emitPaletteScopeChangeUi("palette_custom_brand_change");
    }
    if (options.sync !== false) {
      sync();
    }
  }

  return {
    renderPaletteFamilyGridRecoveryUi,
    renderPaletteFamilyButtons,
    ensurePaletteFamilyGridHydratedUi,
    syncPaletteUiStateFromRuntime,
    applyPaletteTelemetrySnapshotToUi,
    setPaletteControlScopeUi,
    setPaletteCustomBrandUi
  };
}
