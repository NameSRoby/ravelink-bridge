// [TITLE] Module: public/assets/js/domains/palette/palette-brand-actions-runtime.js
// [TITLE] Purpose: brand/per-fixture palette interaction and mutation event wiring
// [TITLE] Functionality Index:
// [TITLE] - brand target selection + override clearing
// [TITLE] - brand family/custom-color/vividness/disorder mutation wiring
// [TITLE] - fixture metric per-brand control wiring
// [DEV] Complex Flow:
// [DEV] This module owns only the event layer for the brand/per-fixture palette menus.
// [DEV] Patch helpers, scoped config resolvers, and shared palette normalizers are injected
// [DEV] so the same mutation contracts remain canonical in palette.js.

function createPaletteBrandActionsRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const sync = typeof deps.sync === "function" ? deps.sync : (() => {});
  const setBadge = typeof deps.setBadge === "function" ? deps.setBadge : (() => {});
  const PALETTE_ALL_FIXTURES_VALUE = String(deps.PALETTE_ALL_FIXTURES_VALUE || "__all__");
  const persistPaletteFixtureSelectionMemory = typeof deps.persistPaletteFixtureSelectionMemory === "function" ? deps.persistPaletteFixtureSelectionMemory : (() => {});
  const markPaletteBrandMenusInteraction = typeof deps.markPaletteBrandMenusInteraction === "function" ? deps.markPaletteBrandMenusInteraction : (() => {});
  const normalizePaletteBrandUi = typeof deps.normalizePaletteBrandUi === "function" ? deps.normalizePaletteBrandUi : (value => String(value || "").trim().toLowerCase());
  const getPaletteBrandScopePatchUi = typeof deps.getPaletteBrandScopePatchUi === "function" ? deps.getPaletteBrandScopePatchUi : (() => null);
  const getPaletteScopedConfigUi = typeof deps.getPaletteScopedConfigUi === "function" ? deps.getPaletteScopedConfigUi : (() => ({}));
  const applyPalettePatch = typeof deps.applyPalettePatch === "function" ? deps.applyPalettePatch : (async () => false);
  const PALETTE_FAMILY_ORDER = Array.isArray(deps.PALETTE_FAMILY_ORDER) ? deps.PALETTE_FAMILY_ORDER : [];
  const resolvePaletteColorIndexesForFamilyUi = typeof deps.resolvePaletteColorIndexesForFamilyUi === "function" ? deps.resolvePaletteColorIndexesForFamilyUi : (() => []);
  const normalizePaletteFamiliesUi = typeof deps.normalizePaletteFamiliesUi === "function" ? deps.normalizePaletteFamiliesUi : (value => Array.isArray(value) ? value : []);
  const getPaletteFamiliesLabelUi = typeof deps.getPaletteFamiliesLabelUi === "function" ? deps.getPaletteFamiliesLabelUi : (() => "");
  const applyFixtureMetricPatch = typeof deps.applyFixtureMetricPatch === "function" ? deps.applyFixtureMetricPatch : (async () => false);
  const normalizeFixtureMetricModeUi = typeof deps.normalizeFixtureMetricModeUi === "function" ? deps.normalizeFixtureMetricModeUi : (value => String(value || "manual").trim().toLowerCase());
  const FIXTURE_METRIC_CONFIG_DEFAULT = deps.FIXTURE_METRIC_CONFIG_DEFAULT || { mode: "manual", metric: "baseline", harmonySize: 1, maxHz: null };
  const normalizeFixtureMetricKeyUi = typeof deps.normalizeFixtureMetricKeyUi === "function" ? deps.normalizeFixtureMetricKeyUi : (value => String(value || "baseline").trim().toLowerCase());
  const FIXTURE_METRIC_LABELS = deps.FIXTURE_METRIC_LABELS || {};
  const normalizeFixtureMetricMaxHzUi = typeof deps.normalizeFixtureMetricMaxHzUi === "function" ? deps.normalizeFixtureMetricMaxHzUi : (value => Number(value) || 0);
  const FIXTURE_METRIC_MAX_HZ_DEFAULT = Number(deps.FIXTURE_METRIC_MAX_HZ_DEFAULT || 8);
  const formatFixtureMetricMaxHzUi = typeof deps.formatFixtureMetricMaxHzUi === "function" ? deps.formatFixtureMetricMaxHzUi : (value => String(value || 0));
  const normalizePaletteDisorderAggressionUi = typeof deps.normalizePaletteDisorderAggressionUi === "function" ? deps.normalizePaletteDisorderAggressionUi : (value => Number(value) || 0.35);
  const normalizePaletteVividnessUi = typeof deps.normalizePaletteVividnessUi === "function" ? deps.normalizePaletteVividnessUi : (value => Number(value) || 2);
  const formatPaletteVividnessLabelUi = typeof deps.formatPaletteVividnessLabelUi === "function" ? deps.formatPaletteVividnessLabelUi : (value => String(value || ""));
  const applyPaletteVividnessPreviewToSwatchesUi = typeof deps.applyPaletteVividnessPreviewToSwatchesUi === "function" ? deps.applyPaletteVividnessPreviewToSwatchesUi : (() => {});
  const normalizeFixtureMetricHarmonySizeUi = typeof deps.normalizeFixtureMetricHarmonySizeUi === "function" ? deps.normalizeFixtureMetricHarmonySizeUi : (value => Number(value) || 1);
  const renderPaletteBrandMenus = typeof deps.renderPaletteBrandMenus === "function" ? deps.renderPaletteBrandMenus : (() => {});
  const applyFixtureRoutingClearPatch = typeof deps.applyFixtureRoutingClearPatch === "function" ? deps.applyFixtureRoutingClearPatch : (async () => false);
  const {
    addPaletteBrandCustomColorUi,
    removePaletteBrandCustomColorUi,
    updatePaletteBrandCustomColorUi
  } = (typeof createPaletteBrandCustomColorActionsRuntimeUi === "function"
    ? createPaletteBrandCustomColorActionsRuntimeUi({
      el,
      ui,
      PALETTE_ALL_FIXTURES_VALUE,
      normalizePaletteBrandUi,
      parsePaletteRgbColorTokenUi: deps.parsePaletteRgbColorTokenUi,
      getPaletteBrandScopePatchUi,
      getPaletteScopedConfigUi,
      normalizePaletteCustomFamilyColorsUi: deps.normalizePaletteCustomFamilyColorsUi,
      applyPalettePatch,
      clampNumber: deps.clampNumber,
      setBadge
    })
    : (() => {
      throw new Error("palette brand custom-color actions runtime module missing");
    })());

  function wirePaletteBrandActionsUi() {
    if (el.paletteBrandMenus) {
      const markBrandMenusHot = evt => {
        const type = String(evt?.type || "").trim().toLowerCase();
        if (type === "pointerdown" || type === "focusin") {
          markPaletteBrandMenusInteraction(5200);
          return;
        }
        if (type === "change") {
          markPaletteBrandMenusInteraction(2200);
          return;
        }
        if (type === "input") {
          markPaletteBrandMenusInteraction(1600);
          return;
        }
        markPaletteBrandMenusInteraction(1200);
      };
      ["pointerdown", "focusin", "keydown", "input", "change"].forEach(type => {
        el.paletteBrandMenus.addEventListener(type, markBrandMenusHot, { capture: true });
      });
    
      el.paletteBrandMenus.onchange = async e => {
        const fixtureSelect = e.target.closest("select[data-palette-brand-fixture]");
        if (fixtureSelect) {
          const brand = normalizePaletteBrandUi(fixtureSelect.dataset.paletteBrandFixture);
          if (!brand) return;
          const selected = String(fixtureSelect.value || PALETTE_ALL_FIXTURES_VALUE).trim() || PALETTE_ALL_FIXTURES_VALUE;
          ui.paletteFixtureSelectionByBrand[brand] = selected;
          persistPaletteFixtureSelectionMemory();
          if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
            try {
              window.dispatchEvent(new CustomEvent("ravelink:live-scope-changed", {
                detail: {
                  reason: "palette_brand_fixture_change",
                  scope: "custom",
                  customBrand: brand,
                  fixtureId: selected
                }
              }));
            } catch (err) {
              console.debug("[PALETTE][DEBUG] fixture scope change event dispatch failed:", err?.message || err);
            }
          }
          renderPaletteBrandMenus({ force: true, reason: "fixture_select_change" });
          sync();
          return;
        }
    
        const customColorInput = e.target.closest("input[data-palette-brand-custom-color-value]");
        if (customColorInput) {
          await updatePaletteBrandCustomColorUi(customColorInput);
          return;
        }
      };
    
      el.paletteBrandMenus.oninput = e => {
        const chaosSlider = e.target.closest("input[data-palette-brand-aggression]");
        if (chaosSlider) {
          const brand = normalizePaletteBrandUi(chaosSlider.dataset.paletteBrandAggression);
          if (!brand) return;
          const pct = Math.round(normalizePaletteDisorderAggressionUi(chaosSlider.value, 0.35) * 100);
          const valueNode = el.paletteBrandMenus.querySelector(`[data-palette-brand-aggression-val="${brand}"]`);
          if (valueNode) valueNode.textContent = `${pct}%`;
          return;
        }
    
        const vividnessSlider = e.target.closest("input[data-palette-brand-vividness-slider]");
        if (vividnessSlider) {
          const brand = normalizePaletteBrandUi(vividnessSlider.dataset.paletteBrandVividnessSlider);
          if (!brand) return;
          const vividness = normalizePaletteVividnessUi(vividnessSlider.value, 2);
          vividnessSlider.value = String(vividness);
          const valueNode = el.paletteBrandMenus.querySelector(`[data-palette-brand-vividness-val="${brand}"]`);
          if (valueNode) valueNode.textContent = formatPaletteVividnessLabelUi(vividness);
          const card = vividnessSlider.closest("[data-palette-brand-card]");
          applyPaletteVividnessPreviewToSwatchesUi(card, vividness);
          return;
        }
    
        const harmonySlider = e.target.closest("input[data-fixture-metric-harmony]");
        if (harmonySlider) {
          const brand = normalizePaletteBrandUi(harmonySlider.dataset.fixtureMetricHarmony);
          if (!brand) return;
          const harmony = normalizeFixtureMetricHarmonySizeUi(
            harmonySlider.value,
            FIXTURE_METRIC_CONFIG_DEFAULT.harmonySize
          );
          const valueNode = el.paletteBrandMenus.querySelector(`[data-fixture-metric-harmony-val="${brand}"]`);
          if (valueNode) valueNode.textContent = String(harmony);
          return;
        }
    
        const maxHzSlider = e.target.closest("input[data-fixture-metric-maxhz]");
        if (maxHzSlider) {
          const brand = normalizePaletteBrandUi(maxHzSlider.dataset.fixtureMetricMaxhz);
          if (!brand) return;
          const maxHz = normalizeFixtureMetricMaxHzUi(maxHzSlider.value, FIXTURE_METRIC_MAX_HZ_DEFAULT);
          const valueNode = el.paletteBrandMenus.querySelector(`[data-fixture-metric-maxhz-val="${brand}"]`);
          if (valueNode) valueNode.textContent = formatFixtureMetricMaxHzUi(maxHz);
        }
      };
    
      el.paletteBrandMenus.onclick = async e => {
        const clearBtn = e.target.closest("[data-palette-brand-clear]");
        if (clearBtn) {
          const brand = normalizePaletteBrandUi(clearBtn.dataset.paletteBrandClear);
          if (!brand) return;
          const scopePatch = getPaletteBrandScopePatchUi(brand);
          if (!scopePatch) return;
          const targetLabel = scopePatch.fixtureId ? scopePatch.fixtureId : `${brand.toUpperCase()} ALL`;
          const clearOk = await applyFixtureRoutingClearPatch(
            { ...scopePatch },
            `${brand.toUpperCase()} OVERRIDE`
          );
          if (clearOk) {
            setBadge(el.health, "ok", `OVERRIDES CLEARED ${targetLabel}`);
          }
          return;
        }
    
        const vividnessResetBtn = e.target.closest("[data-palette-brand-vividness-reset]");
        if (vividnessResetBtn) {
          const brand = normalizePaletteBrandUi(vividnessResetBtn.dataset.paletteBrandVividnessReset);
          if (!brand) return;
          const scopePatch = getPaletteBrandScopePatchUi(brand);
          if (!scopePatch) return;
          const card = vividnessResetBtn.closest("[data-palette-brand-card]");
          const slider = card
            ? card.querySelector(`input[data-palette-brand-vividness-slider="${brand}"]`)
            : null;
          if (slider) slider.value = "2";
          const valueNode = el.paletteBrandMenus.querySelector(`[data-palette-brand-vividness-val="${brand}"]`);
          if (valueNode) valueNode.textContent = formatPaletteVividnessLabelUi(2);
          applyPaletteVividnessPreviewToSwatchesUi(card, 2);
          const ok = await applyPalettePatch(
            { ...scopePatch, vividness: 2 },
            `${brand.toUpperCase()} PALETTE VIVIDNESS`
          );
          if (ok) {
            setBadge(el.health, "ok", `${brand.toUpperCase()} VIVIDNESS ${formatPaletteVividnessLabelUi(2)}`);
          }
          return;
        }
    
        const customColorAddBtn = e.target.closest("[data-palette-brand-custom-color-add]");
        if (customColorAddBtn) {
          await addPaletteBrandCustomColorUi(customColorAddBtn);
          return;
        }
    
        const customColorRemoveBtn = e.target.closest("[data-palette-brand-custom-color-remove]");
        if (customColorRemoveBtn) {
          await removePaletteBrandCustomColorUi(customColorRemoveBtn);
          return;
        }
    
        const familyColorAddBtn = e.target.closest("[data-palette-brand-family-color-add]");
        if (familyColorAddBtn) {
          const brand = normalizePaletteBrandUi(familyColorAddBtn.dataset.paletteBrandFamilyColorAdd);
          if (!brand) return;
          const family = String(familyColorAddBtn.dataset.family || "").trim().toLowerCase();
          if (!PALETTE_FAMILY_ORDER.includes(family)) return;
          const colorIndex = Math.round(Number(familyColorAddBtn.dataset.colorIndex));
          if (!Number.isFinite(colorIndex) || colorIndex < 0) return;
          const scopePatch = getPaletteBrandScopePatchUi(brand);
          if (!scopePatch) return;
          const selectedFixture = scopePatch.fixtureId || PALETTE_ALL_FIXTURES_VALUE;
          const currentConfig = getPaletteScopedConfigUi(brand, selectedFixture);
          const currentIndexes = resolvePaletteColorIndexesForFamilyUi(currentConfig, family, currentConfig.colorsPerFamily || 3);
          if (currentIndexes.includes(colorIndex)) return;
          const nextIndexes = currentIndexes.concat([colorIndex]);
          const currentFamilies = normalizePaletteFamiliesUi(currentConfig.families, PALETTE_FAMILY_ORDER);
          const patch = {
            ...scopePatch,
            familyColorIndexes: { [family]: nextIndexes }
          };
          if (!currentFamilies.includes(family)) {
            patch.families = PALETTE_FAMILY_ORDER.filter(name => currentFamilies.concat([family]).includes(name));
          }
          const ok = await applyPalettePatch(
            patch,
            `${brand.toUpperCase()} COLOR ADD`
          );
          if (ok) {
            setBadge(el.health, "ok", `${brand.toUpperCase()} ${family.toUpperCase()} COLOR ${colorIndex + 1} ADDED`);
          }
          return;
        }
    
        const familyColorRemoveBtn = e.target.closest("[data-palette-brand-family-color-remove]");
        if (familyColorRemoveBtn) {
          const brand = normalizePaletteBrandUi(familyColorRemoveBtn.dataset.paletteBrandFamilyColorRemove);
          if (!brand) return;
          const family = String(familyColorRemoveBtn.dataset.family || "").trim().toLowerCase();
          if (!PALETTE_FAMILY_ORDER.includes(family)) return;
          const colorIndex = Math.round(Number(familyColorRemoveBtn.dataset.colorIndex));
          if (!Number.isFinite(colorIndex) || colorIndex < 0) return;
          const scopePatch = getPaletteBrandScopePatchUi(brand);
          if (!scopePatch) return;
          const selectedFixture = scopePatch.fixtureId || PALETTE_ALL_FIXTURES_VALUE;
          const currentConfig = getPaletteScopedConfigUi(brand, selectedFixture);
          const currentIndexes = resolvePaletteColorIndexesForFamilyUi(currentConfig, family, currentConfig.colorsPerFamily || 3);
          if (currentIndexes.length <= 1) {
            setBadge(el.health, "warn", `${brand.toUpperCase()} ${family.toUpperCase()} REQUIRES AT LEAST 1 COLOR`);
            return;
          }
          const nextIndexes = currentIndexes.filter(idx => idx !== colorIndex);
          const ok = await applyPalettePatch(
            { ...scopePatch, familyColorIndexes: { [family]: nextIndexes } },
            `${brand.toUpperCase()} COLOR REMOVE`
          );
          if (ok) {
            setBadge(el.health, "ok", `${brand.toUpperCase()} ${family.toUpperCase()} COLOR ${colorIndex + 1} REMOVED`);
          }
          return;
        }
    
        const familyColorMoveBtn = e.target.closest("[data-palette-brand-family-color-move]");
        if (familyColorMoveBtn) {
          const brand = normalizePaletteBrandUi(familyColorMoveBtn.dataset.paletteBrandFamilyColorMove);
          if (!brand) return;
          const family = String(familyColorMoveBtn.dataset.family || "").trim().toLowerCase();
          if (!PALETTE_FAMILY_ORDER.includes(family)) return;
          const colorIndex = Math.round(Number(familyColorMoveBtn.dataset.colorIndex));
          const dir = Math.round(Number(familyColorMoveBtn.dataset.dir));
          if (!Number.isFinite(colorIndex) || !Number.isFinite(dir) || (dir !== -1 && dir !== 1)) return;
          const scopePatch = getPaletteBrandScopePatchUi(brand);
          if (!scopePatch) return;
          const selectedFixture = scopePatch.fixtureId || PALETTE_ALL_FIXTURES_VALUE;
          const currentConfig = getPaletteScopedConfigUi(brand, selectedFixture);
          const currentIndexes = resolvePaletteColorIndexesForFamilyUi(currentConfig, family, currentConfig.colorsPerFamily || 3);
          const pos = currentIndexes.indexOf(colorIndex);
          if (pos < 0) return;
          const targetPos = pos + dir;
          if (targetPos < 0 || targetPos >= currentIndexes.length) return;
          const nextIndexes = currentIndexes.slice();
          const temp = nextIndexes[targetPos];
          nextIndexes[targetPos] = nextIndexes[pos];
          nextIndexes[pos] = temp;
          const ok = await applyPalettePatch(
            { ...scopePatch, familyColorIndexes: { [family]: nextIndexes } },
            `${brand.toUpperCase()} COLOR ORDER`
          );
          if (ok) {
            setBadge(el.health, "ok", `${brand.toUpperCase()} ${family.toUpperCase()} ORDER UPDATED`);
          }
          return;
        }
    
        const familyBtn = e.target.closest("[data-palette-brand-family]");
        if (familyBtn) {
          const brand = normalizePaletteBrandUi(familyBtn.dataset.paletteBrandFamily);
          if (!brand) return;
          const family = String(familyBtn.dataset.family || "").trim().toLowerCase();
          if (!PALETTE_FAMILY_ORDER.includes(family)) return;
          const scopePatch = getPaletteBrandScopePatchUi(brand);
          if (!scopePatch) return;
          const selectedFixture = scopePatch.fixtureId || PALETTE_ALL_FIXTURES_VALUE;
          const currentConfig = getPaletteScopedConfigUi(brand, selectedFixture);
          const currentFamilies = normalizePaletteFamiliesUi(currentConfig.families, PALETTE_FAMILY_ORDER);
          const exists = currentFamilies.includes(family);
          let nextFamilies = exists
            ? currentFamilies.filter(name => name !== family)
            : currentFamilies.concat([family]);
          if (!nextFamilies.length) nextFamilies = [family];
          nextFamilies = PALETTE_FAMILY_ORDER.filter(name => nextFamilies.includes(name));
          const ok = await applyPalettePatch(
            { ...scopePatch, families: nextFamilies },
            `${brand.toUpperCase()} PALETTE FAMILIES`
          );
          if (ok) {
            setBadge(el.health, "ok", `${brand.toUpperCase()} ${getPaletteFamiliesLabelUi(nextFamilies)}`);
          }
          return;
        }
    
        const disorderBtn = e.target.closest("[data-palette-brand-disorder]");
        if (disorderBtn) {
          const brand = normalizePaletteBrandUi(disorderBtn.dataset.paletteBrandDisorder);
          if (!brand) return;
          const disorder = String(disorderBtn.dataset.disorder || "").trim().toLowerCase() === "true";
          const scopePatch = getPaletteBrandScopePatchUi(brand);
          if (!scopePatch) return;
          const ok = await applyPalettePatch(
            { ...scopePatch, disorder },
            `${brand.toUpperCase()} PALETTE ORDER`
          );
          if (ok) {
            setBadge(el.health, "ok", `${brand.toUpperCase()} ${disorder ? "DISORDER" : "ORDERED"}`);
          }
          return;
        }
    
        const metricModeBtn = e.target.closest("[data-fixture-metric-mode]");
        if (metricModeBtn) {
          const brand = normalizePaletteBrandUi(metricModeBtn.dataset.fixtureMetricMode);
          if (!brand) return;
          const mode = normalizeFixtureMetricModeUi(metricModeBtn.dataset.mode, FIXTURE_METRIC_CONFIG_DEFAULT.mode);
          const scopePatch = getPaletteBrandScopePatchUi(brand);
          if (!scopePatch) return;
          const ok = await applyFixtureMetricPatch(
            { ...scopePatch, mode },
            `${brand.toUpperCase()} METRIC MODE`
          );
          if (ok) {
            setBadge(el.health, "ok", `${brand.toUpperCase()} MODE ${mode === "meta_auto" ? "META AUTO" : "MANUAL"}`);
          }
          return;
        }
    
        const metricBtn = e.target.closest("[data-fixture-metric-key]");
        if (metricBtn) {
          const brand = normalizePaletteBrandUi(metricBtn.dataset.fixtureMetricKey);
          if (!brand) return;
          const metric = normalizeFixtureMetricKeyUi(metricBtn.dataset.metric, FIXTURE_METRIC_CONFIG_DEFAULT.metric);
          const scopePatch = getPaletteBrandScopePatchUi(brand);
          if (!scopePatch) return;
          const ok = await applyFixtureMetricPatch(
            { ...scopePatch, metric },
            `${brand.toUpperCase()} METRIC`
          );
          if (ok) {
            setBadge(el.health, "ok", `${brand.toUpperCase()} ${FIXTURE_METRIC_LABELS[metric] || metric.toUpperCase()}`);
          }
          return;
        }
    
        const flipBtn = e.target.closest("[data-fixture-metric-flip]");
        if (flipBtn) {
          const brand = normalizePaletteBrandUi(flipBtn.dataset.fixtureMetricFlip);
          if (!brand) return;
          const enabled = String(flipBtn.dataset.enabled || "").trim().toLowerCase() === "true";
          const scopePatch = getPaletteBrandScopePatchUi(brand);
          if (!scopePatch) return;
          const ok = await applyFixtureMetricPatch(
            { ...scopePatch, metaAutoFlip: enabled },
            `${brand.toUpperCase()} METRIC FLIP`
          );
          if (ok) {
            setBadge(el.health, "ok", `${brand.toUpperCase()} ${enabled ? "FLIP ON" : "FLIP OFF"}`);
          }
          return;
        }
    
        const maxHzModeBtn = e.target.closest("[data-fixture-metric-maxhz-mode]");
        if (maxHzModeBtn) {
          const brand = normalizePaletteBrandUi(maxHzModeBtn.dataset.fixtureMetricMaxhzMode);
          if (!brand) return;
          const unclamped = String(maxHzModeBtn.dataset.unclamped || "").trim().toLowerCase() === "true";
          const scopePatch = getPaletteBrandScopePatchUi(brand);
          if (!scopePatch) return;
          if (unclamped) {
            const ok = await applyFixtureMetricPatch(
              { ...scopePatch, maxHz: null },
              `${brand.toUpperCase()} MAX HZ`
            );
            if (ok) {
              setBadge(el.health, "ok", `${brand.toUpperCase()} MAX HZ UNCLAMPED`);
            }
            return;
          }
          const slider = el.paletteBrandMenus.querySelector(`input[data-fixture-metric-maxhz="${brand}"]`);
          const maxHz = normalizeFixtureMetricMaxHzUi(
            slider?.value,
            FIXTURE_METRIC_MAX_HZ_DEFAULT
          );
          const appliedHz = Number.isFinite(maxHz) && maxHz > 0
            ? maxHz
            : FIXTURE_METRIC_MAX_HZ_DEFAULT;
          const ok = await applyFixtureMetricPatch(
            { ...scopePatch, maxHz: appliedHz },
            `${brand.toUpperCase()} MAX HZ`
          );
          if (ok) {
            setBadge(el.health, "ok", `${brand.toUpperCase()} MAX HZ ${formatFixtureMetricMaxHzUi(appliedHz)}`);
          }
        }
      };
    
      el.paletteBrandMenus.addEventListener("change", async e => {
        const chaosSlider = e.target.closest("input[data-palette-brand-aggression]");
        if (chaosSlider) {
          const brand = normalizePaletteBrandUi(chaosSlider.dataset.paletteBrandAggression);
          if (!brand) return;
          const aggression = normalizePaletteDisorderAggressionUi(chaosSlider.value, 0.35);
          const scopePatch = getPaletteBrandScopePatchUi(brand);
          if (!scopePatch) return;
          const ok = await applyPalettePatch(
            { ...scopePatch, disorderAggression: aggression },
            `${brand.toUpperCase()} PALETTE CHAOS`
          );
          if (ok) {
            setBadge(el.health, "ok", `${brand.toUpperCase()} CHAOS ${Math.round(aggression * 100)}%`);
          }
          return;
        }
    
        const vividnessSlider = e.target.closest("input[data-palette-brand-vividness-slider]");
        if (vividnessSlider) {
          const brand = normalizePaletteBrandUi(vividnessSlider.dataset.paletteBrandVividnessSlider);
          if (!brand) return;
          const vividness = normalizePaletteVividnessUi(vividnessSlider.value, 2);
          const scopePatch = getPaletteBrandScopePatchUi(brand);
          if (!scopePatch) return;
          const ok = await applyPalettePatch(
            { ...scopePatch, vividness },
            `${brand.toUpperCase()} PALETTE VIVIDNESS`
          );
          if (ok) {
            setBadge(el.health, "ok", `${brand.toUpperCase()} VIVIDNESS ${formatPaletteVividnessLabelUi(vividness)}`);
          }
          return;
        }
    
        const harmonySlider = e.target.closest("input[data-fixture-metric-harmony]");
        if (harmonySlider) {
          const brand = normalizePaletteBrandUi(harmonySlider.dataset.fixtureMetricHarmony);
          if (!brand) return;
          const harmonySize = normalizeFixtureMetricHarmonySizeUi(
            harmonySlider.value,
            FIXTURE_METRIC_CONFIG_DEFAULT.harmonySize
          );
          const scopePatch = getPaletteBrandScopePatchUi(brand);
          if (!scopePatch) return;
          const ok = await applyFixtureMetricPatch(
            { ...scopePatch, harmonySize },
            `${brand.toUpperCase()} HARMONY`
          );
          if (ok) {
            setBadge(el.health, "ok", `${brand.toUpperCase()} HARMONY ${harmonySize}`);
          }
          return;
        }
    
        const maxHzSlider = e.target.closest("input[data-fixture-metric-maxhz]");
        if (maxHzSlider) {
          const brand = normalizePaletteBrandUi(maxHzSlider.dataset.fixtureMetricMaxhz);
          if (!brand) return;
          const maxHz = normalizeFixtureMetricMaxHzUi(
            maxHzSlider.value,
            FIXTURE_METRIC_MAX_HZ_DEFAULT
          );
          const appliedHz = Number.isFinite(maxHz) && maxHz > 0
            ? maxHz
            : FIXTURE_METRIC_MAX_HZ_DEFAULT;
          const scopePatch = getPaletteBrandScopePatchUi(brand);
          if (!scopePatch) return;
          const ok = await applyFixtureMetricPatch(
            { ...scopePatch, maxHz: appliedHz },
            `${brand.toUpperCase()} MAX HZ`
          );
          if (ok) {
            setBadge(el.health, "ok", `${brand.toUpperCase()} MAX HZ ${formatFixtureMetricMaxHzUi(appliedHz)}`);
          }
        }
      });
    }
  }

  return { wirePaletteBrandActionsUi };
}
