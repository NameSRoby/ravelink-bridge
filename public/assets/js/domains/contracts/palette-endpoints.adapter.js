// [TITLE] Module: public/assets/js/domains/contracts/palette-endpoints.adapter.js
// [TITLE] Purpose: typed endpoint adapter for palette domain UI modules
// [TITLE] Functionality Index:
// [TITLE] - centralize rave palette route paths
// [TITLE] - keep palette mutation/read contracts explicit

/**
 * @typedef {Object} PaletteEndpointsAdapter
 * @property {() => Promise<any>} getPaletteSnapshot
 * @property {(patch: Object) => Promise<{ok:boolean,status:number,data:any}>} patchPalette
 * @property {(patch: Object) => Promise<{ok:boolean,status:number,data:any}>} patchFixtureMetrics
 * @property {(patch: Object) => Promise<{ok:boolean,status:number,data:any}>} clearFixtureRouting
 */

/** @type {PaletteEndpointsAdapter} */
const paletteEndpointsAdapter = Object.freeze({
  getPaletteSnapshot: () => getJson("/rave/palette"),
  patchPalette: patch => postJson("/rave/palette", patch),
  patchFixtureMetrics: patch => postJson("/rave/fixture-metrics", patch),
  clearFixtureRouting: patch => postJson("/rave/fixture-routing/clear", patch)
});
