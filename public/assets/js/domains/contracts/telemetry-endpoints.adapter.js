// [TITLE] Module: public/assets/js/domains/contracts/telemetry-endpoints.adapter.js
// [TITLE] Purpose: typed endpoint adapter for telemetry polling/runtime snapshots
// [TITLE] Functionality Index:
// [TITLE] - centralize telemetry poll route contracts
// [TITLE] - provide one-call wrappers for high-frequency telemetry reads
// [DEV] `/rave/telemetry`, `/hue/telemetry`, and `/wiz/telemetry` are treated as
// [DEV] telemetry read contracts for the browser poller. They remain isolated here
// [DEV] so compatibility naming does not leak into domain runtimes.

/**
 * @typedef {Object} TelemetryEndpointsAdapter
 * @property {() => Promise<any>} getRaveStatus
 * @property {() => Promise<any>} getRaveTelemetry
 * @property {() => Promise<any>} getHueTelemetry
 * @property {() => Promise<any>} getWizTelemetry
 * @property {() => Promise<any>} getAudioTelemetry
 * @property {() => Promise<any>} getFixturesSnapshot
 * @property {() => Promise<any>} getModsSnapshot
 * @property {() => Promise<any>} getColorPrefixes
 * @property {() => Promise<any>} getMidiStatus
 * @property {() => Promise<any>} getAudioReactivityMap
 */

/** @type {TelemetryEndpointsAdapter} */
const telemetryEndpointsAdapter = Object.freeze({
  getRaveStatus: () => getJson("/rave/status"),
  getRaveTelemetry: () => getJson("/rave/telemetry"),
  getHueTelemetry: () => getJson("/hue/telemetry"),
  getWizTelemetry: () => getJson("/wiz/telemetry"),
  getAudioTelemetry: () => getJson("/audio/telemetry"),
  getFixturesSnapshot: () => getJson("/fixtures"),
  getModsSnapshot: () => getJson("/mods"),
  getColorPrefixes: () => getJson("/color/prefixes"),
  getMidiStatus: () => getJson("/midi/status"),
  getAudioReactivityMap: () => getJson("/audio/reactivity-map")
});
