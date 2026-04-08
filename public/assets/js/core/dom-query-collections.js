// [TITLE] Module: public/assets/js/core/dom-query-collections.js
// [TITLE] Purpose: shared static selector groups composed after core DOM registry creation
// [TITLE] Functionality Index:
// [TITLE] - top-level tab/scene/button collections
// [TITLE] - palette family query helpers scoped off `el`
// [TITLE] - theme/audio preset button collections used across runtimes
function createCoreDomQueryCollections(deps = {}) {
  const documentRef = deps.documentRef || document;
  const el = deps.el || {};
  return {
    tabButtons: Array.from(documentRef.querySelectorAll("[data-tab-btn]")),
    tabPages: Array.from(documentRef.querySelectorAll("[data-tab]")),
    sceneButtons: Array.from(documentRef.querySelectorAll("[data-scene]")),
    audioQuickPresetButtons: Array.from(documentRef.querySelectorAll("[data-audio-quick]")),
    paletteDisorderButtons: Array.from(documentRef.querySelectorAll("[data-palette-disorder]")),
    paletteCustomBrandButtons: Array.from(documentRef.querySelectorAll("[data-palette-custom-brand]")),
    limiterPresetButtons: Array.from(documentRef.querySelectorAll("[data-limiter-preset]")),
    tabTourButtons: Array.from(documentRef.querySelectorAll("[data-tour-tab]")),
    themeCustomInputs: Array.from(documentRef.querySelectorAll("[data-theme-custom]")),
    getPaletteFamilyButtons: () =>
      el.paletteFamilyGrid
        ? Array.from(el.paletteFamilyGrid.querySelectorAll("[data-palette-family-tab]"))
        : [],
    getPaletteFamilyCountSelectors: () =>
      el.paletteFamilyGrid
        ? Array.from(el.paletteFamilyGrid.querySelectorAll("[data-palette-family-count]"))
        : [],
    themePresetButtons: Array.from(documentRef.querySelectorAll("[data-theme-preset]"))
  };
}
