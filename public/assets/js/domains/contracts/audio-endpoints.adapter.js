// [TITLE] Module: public/assets/js/domains/contracts/audio-endpoints.adapter.js
// [TITLE] Purpose: typed endpoint adapter for audio domain UI modules
// [TITLE] Functionality Index:
// [TITLE] - centralize audio route paths
// [TITLE] - expose typed request helper functions for monolith split migration

/**
 * @typedef {Object} AudioEndpointsAdapter
 * @property {() => Promise<any>} getOptionalToolsStatus
 * @property {(query: URLSearchParams) => Promise<any>} getApps
 * @property {() => Promise<any>} getAppIsolationLocks
 * @property {(payload: Object) => Promise<{ok:boolean,status:number,data:any}>} scanAppIsolation
 * @property {(patch: Object) => Promise<{ok:boolean,status:number,data:any}>} saveConfig
 * @property {() => Promise<{ok:boolean,status:number,data:any}>} restart
 * @property {() => Promise<any>} getReactivityMap
 * @property {(payload: Object) => Promise<{ok:boolean,status:number,data:any}>} saveReactivityMap
 * @property {() => Promise<any>} getConfig
 * @property {() => Promise<any>} getDevices
 * @property {() => Promise<any>} getProfiles
 * @property {(name: string) => Promise<{ok:boolean,status:number,data:any}>} saveProfile
 * @property {(name: string) => Promise<{ok:boolean,status:number,data:any}>} applyProfile
 * @property {(name: string) => Promise<{ok:boolean,status:number,data:any}>} deleteProfile
 * @property {(payload: Object) => Promise<{ok:boolean,status:number,data:any}>} setAppIsolationLock
 * @property {(payload: Object) => Promise<{ok:boolean,status:number,data:any}>} clearAppIsolationLock
 * @property {() => Promise<any>} getRustTransportWorkerStatus
 * @property {(refresh?: boolean) => Promise<any>} getRustTransportWorkerAdapters
 * @property {(refresh?: boolean) => Promise<any>} getRustTransportWorkerWatchdog
 * @property {(payload: Object) => Promise<{ok:boolean,status:number,data:any}>} setRustTransportWorkerConfig
 * @property {(payload: Object) => Promise<{ok:boolean,status:number,data:any}>} startRustTransportWorker
 * @property {(payload: Object) => Promise<{ok:boolean,status:number,data:any}>} stopRustTransportWorker
 * @property {(payload: Object) => Promise<{ok:boolean,status:number,data:any}>} restartRustTransportWorker
 */

/** @type {AudioEndpointsAdapter} */
const audioEndpointsAdapter = Object.freeze({
  getOptionalToolsStatus: () => getJson("/audio/optional-tools/status"),
  getApps: query => getJson(`/audio/apps?${String(query?.toString?.() || "")}`),
  getAppIsolationLocks: () => getJson("/audio/ffmpeg/app-isolation/locks"),
  scanAppIsolation: payload => postJson("/audio/ffmpeg/app-isolation/scan", payload),
  saveConfig: patch => postJson("/audio/config", patch),
  restart: () => postJson("/audio/restart", {}),
  getReactivityMap: () => getJson("/audio/reactivity-map"),
  saveReactivityMap: payload => postJson("/audio/reactivity-map", payload),
  getConfig: () => getJson("/audio/config"),
  getDevices: () => getJson("/audio/devices"),
  getProfiles: () => getJson("/audio/profiles"),
  saveProfile: name => postJson("/audio/profiles/save", { name: String(name || "").trim() }),
  applyProfile: name => postJson("/audio/profiles/apply", { name: String(name || "").trim() }),
  deleteProfile: name => postJson("/audio/profiles/delete", { name: String(name || "").trim() }),
  setAppIsolationLock: payload => postJson("/audio/ffmpeg/app-isolation/locks/set", payload),
  clearAppIsolationLock: payload => postJson("/audio/ffmpeg/app-isolation/locks/clear", payload),
  getRustTransportWorkerStatus: () => getJson("/audio/rust/transport-worker/status"),
  getRustTransportWorkerAdapters: refresh => getJson(`/audio/rust/transport-worker/adapters${refresh === true ? "?refresh=1" : ""}`),
  getRustTransportWorkerWatchdog: refresh => getJson(`/audio/rust/transport-worker/watchdog${refresh === true ? "?refresh=1" : ""}`),
  setRustTransportWorkerConfig: payload => postJson("/audio/rust/transport-worker/config", payload),
  startRustTransportWorker: payload => postJson("/audio/rust/transport-worker/start", payload || {}),
  stopRustTransportWorker: payload => postJson("/audio/rust/transport-worker/stop", payload || {}),
  restartRustTransportWorker: payload => postJson("/audio/rust/transport-worker/restart", payload || {})
});
