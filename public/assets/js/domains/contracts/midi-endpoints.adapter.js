// [TITLE] Module: public/assets/js/domains/contracts/midi-endpoints.adapter.js
// [TITLE] Purpose: typed endpoint adapter for MIDI domain UI runtime
// [TITLE] Functionality Index:
// [TITLE] - centralize MIDI status + mutation contracts
// [TITLE] - expose action-safe learn/trigger/binding helpers

/**
 * @typedef {Object} MidiEndpointsAdapter
 * @property {() => Promise<any>} getStatus
 * @property {() => Promise<{ok:boolean,status:number,data:any}>} refreshStatus
 * @property {(patch: Object) => Promise<{ok:boolean,status:number,data:any}>} saveConfig
 * @property {(action: string) => Promise<{ok:boolean,status:number,data:any}>} armLearn
 * @property {() => Promise<{ok:boolean,status:number,data:any}>} cancelLearn
 * @property {(action: string) => Promise<{ok:boolean,status:number,data:any}>} triggerAction
 * @property {(action: string, patch: Object) => Promise<{ok:boolean,status:number,data:any}>} saveBinding
 * @property {(action: string) => Promise<{ok:boolean,status:number,data:any}>} clearBinding
 * @property {() => Promise<{ok:boolean,status:number,data:any}>} resetBindings
 */

function normalizeMidiActionRouteToken(action) {
  return encodeURIComponent(String(action || "").trim().toLowerCase());
}

/** @type {MidiEndpointsAdapter} */
const midiEndpointsAdapter = Object.freeze({
  getStatus: () => getJson("/midi/status"),
  refreshStatus: () => postJson("/midi/refresh", {}),
  saveConfig: patch => postJson("/midi/config", patch),
  armLearn: action => postJson(`/midi/learn/${normalizeMidiActionRouteToken(action)}`, {}),
  cancelLearn: () => postJson("/midi/learn/cancel", {}),
  triggerAction: action => postJson(`/midi/trigger/${normalizeMidiActionRouteToken(action)}`, {}),
  saveBinding: (action, patch) => postJson(`/midi/bindings/${normalizeMidiActionRouteToken(action)}`, patch),
  clearBinding: action => deleteJson(`/midi/bindings/${normalizeMidiActionRouteToken(action)}`),
  resetBindings: () => postJson("/midi/bindings/reset", {})
});
