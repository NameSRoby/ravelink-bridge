// [TITLE] Module: public/assets/js/domains/contracts/mods-endpoints.adapter.js
// [TITLE] Purpose: typed endpoint adapter for mods domain runtime modules
// [TITLE] Functionality Index:
// [TITLE] - centralize mods route contracts
// [TITLE] - expose dynamic mod-action invocation helper

/**
 * @typedef {Object} ModsEndpointsAdapter
 * @property {() => Promise<any>} getUiCatalog
 * @property {(enabled: boolean) => Promise<{ok:boolean,status:number,data:any}>} setDebugEnabled
 * @property {() => Promise<{ok:boolean,status:number,data:any}>} clearDebugBuffer
 * @property {() => Promise<any>} getSnapshot
 * @property {(payload: Object) => Promise<{ok:boolean,status:number,data:any}>} importMods
 * @property {(payload: Object) => Promise<{ok:boolean,status:number,data:any}>} updateConfig
 * @property {() => Promise<{ok:boolean,status:number,data:any}>} reload
 * @property {(modId: string, action: string, method: \"GET\"|\"POST\", payload?: Object) => Promise<{ok:boolean,status:number,text:string,json:any}>} invokeAction
 */

/** @type {ModsEndpointsAdapter} */
const modsEndpointsAdapter = Object.freeze({
  getUiCatalog: () => getJson("/mods/ui/catalog"),
  setDebugEnabled: enabled => postJson("/mods/debug", { enabled: Boolean(enabled) }),
  clearDebugBuffer: () => postJson("/mods/debug/clear", {}),
  getSnapshot: () => getJson("/mods"),
  importMods: payload => postJson("/mods/import", payload),
  updateConfig: payload => postJson("/mods/config", payload),
  reload: () => postJson("/mods/reload", {}),
  async invokeAction(modId, action, method = "GET", payload = null) {
    const safeModId = encodeURIComponent(String(modId || "").trim());
    const safeAction = String(action || "").trim();
    const safeMethod = String(method || "GET").toUpperCase() === "POST" ? "POST" : "GET";
    const path = safeAction
      ? `/mods/${safeModId}/${encodeURIComponent(safeAction)}`
      : `/mods/${safeModId}`;
    try {
      const init = { method: safeMethod };
      if (safeMethod === "POST") {
        init.headers = { "Content-Type": "application/json" };
        init.body = JSON.stringify(
          payload && typeof payload === "object" && !Array.isArray(payload)
            ? payload
            : {}
        );
      }
      const res = await fetch(withBase(path), init);
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return {
        ok: res.ok,
        status: res.status,
        text,
        json
      };
    } catch {
      return {
        ok: false,
        status: 0,
        text: "",
        json: null
      };
    }
  }
});
