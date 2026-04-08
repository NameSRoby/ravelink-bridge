// [TITLE] Module: public/assets/js/domains/contracts/color-prefix-endpoints.adapter.js
// [TITLE] Purpose: typed endpoint adapter for color prefix config UI domain
// [TITLE] Functionality Index:
// [TITLE] - centralize /color/prefixes snapshot + save contracts

/**
 * @typedef {Object} ColorPrefixEndpointsAdapter
 * @property {() => Promise<any>} getConfig
 * @property {(payload: Object) => Promise<{ok:boolean,status:number,data:any}>} saveConfig
 */

/** @type {ColorPrefixEndpointsAdapter} */
const colorPrefixEndpointsAdapter = Object.freeze({
  getConfig: () => getJson("/color/prefixes"),
  saveConfig: payload => postJson("/color/prefixes", payload)
});
