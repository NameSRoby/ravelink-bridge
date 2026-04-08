// [TITLE] Module: public/assets/js/domains/palette/palette-runtime-snapshot-runtime-ui.js
// [TITLE] Purpose: palette runtime snapshot application and UI refresh bridge
// [TITLE] Functionality Index:
// [TITLE] - runtime metadata/config/metric snapshot apply sequencing
// [TITLE] - palette brand menu refresh after snapshot apply
// [TITLE] - LIVE scope target update event dispatch
// [DEV] Complex Flow:
// [DEV] Keep snapshot apply order here so palette.js does not regain broad
// [DEV] runtime/render sync ownership as palette contracts evolve.

function createPaletteRuntimeSnapshotRuntimeUi(deps = {}) {
  const ui = deps.ui || {};
  const windowRef = deps.windowRef || (typeof window !== "undefined" ? window : null);
  const CustomEventRef = deps.CustomEventRef || (typeof CustomEvent !== "undefined" ? CustomEvent : null);
  const applyPaletteRuntimeMetadataUi = typeof deps.applyPaletteRuntimeMetadataUi === "function"
    ? deps.applyPaletteRuntimeMetadataUi
    : (() => {});
  const applyPaletteSnapshotToUi = typeof deps.applyPaletteSnapshotToUi === "function"
    ? deps.applyPaletteSnapshotToUi
    : (() => {});
  const applyFixtureMetricRoutingSnapshotToUi = typeof deps.applyFixtureMetricRoutingSnapshotToUi === "function"
    ? deps.applyFixtureMetricRoutingSnapshotToUi
    : (() => {});
  const renderPaletteBrandMenus = typeof deps.renderPaletteBrandMenus === "function"
    ? deps.renderPaletteBrandMenus
    : (() => {});

  function dispatchPaletteScopeTargetsUpdatedUi() {
    if (!windowRef || typeof windowRef.dispatchEvent !== "function" || typeof CustomEventRef !== "function") {
      return;
    }
    try {
      windowRef.dispatchEvent(new CustomEventRef("ravelink:live-scope-targets-updated", {
        detail: {
          reason: "palette_runtime_snapshot"
        }
      }));
    } catch (err) {
      console.debug("[PALETTE][DEBUG] scope target event dispatch failed:", err?.message || err);
    }
  }

  function applyPaletteRuntimeSnapshotToUi(snapshot = {}, options = {}) {
    const data = snapshot && typeof snapshot === "object" ? snapshot : {};
    const opts = options && typeof options === "object" ? options : {};
    applyPaletteRuntimeMetadataUi(data);
    if (Array.isArray(data.catalog)) {
      ui.paletteCatalog = data.catalog.slice();
    }
    applyPaletteSnapshotToUi(data.config || {}, {
      fixtureOverrides: data.fixtureOverrides || {},
      brandFixtures: data.brandFixtures || {}
    });
    applyFixtureMetricRoutingSnapshotToUi(data.metricRouting || {});
    renderPaletteBrandMenus({
      reason: "palette_runtime_snapshot",
      force: opts.forceRender === true
    });
    dispatchPaletteScopeTargetsUpdatedUi();
  }

  return {
    applyPaletteRuntimeSnapshotToUi,
    dispatchPaletteScopeTargetsUpdatedUi
  };
}

