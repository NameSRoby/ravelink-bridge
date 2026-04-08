// [TITLE] Module: public/assets/js/domains/contracts/system-endpoints.adapter.js
// [TITLE] Purpose: typed endpoint adapter for system settings/runtime widget flows
// [TITLE] Functionality Index:
// [TITLE] - centralize system config load/save contract paths
// [TITLE] - centralize system widget template generation contract path

/**
 * @typedef {Object} SystemEndpointsAdapter
 * @property {() => Promise<any>} getConfig
 * @property {() => Promise<any>} getStartupReadiness
 * @property {() => Promise<any>} getCoreStatus
 * @property {() => Promise<any>} getLauncherDiagnostics
 * @property {() => Promise<any>} getRouteCatalog
 * @property {() => Promise<any>} getInternetGatewayStatus
 * @property {() => Promise<any>} getUpdateStatus
 * @property {(payload: Object) => Promise<{ok:boolean,status:number,data:any}>} saveConfig
 * @property {(payload: Object) => Promise<{ok:boolean,status:number,data:any}>} checkForUpdates
 * @property {(payload: Object) => Promise<{ok:boolean,status:number,data:any}>} applyUpdate
 * @property {() => Promise<any>} getSystemOauthStatus
 * @property {(payload: Object) => Promise<{ok:boolean,status:number,data:any}>} seedSystemOauthProfile
 * @property {() => Promise<{ok:boolean,status:number,data:any}>} clearSystemOauthProfile
 * @property {(payload: Object) => Promise<{ok:boolean,status:number,data:any}>} startSystemOauth
 * @property {(payload: Object) => Promise<{ok:boolean,status:number,data:any}>} getSystemOauthDeviceStatus
 * @property {(payload: Object) => Promise<{ok:boolean,status:number,data:any}>} disconnectSystemOauth
 * @property {(payload: Object) => Promise<{ok:boolean,status:number,data:any}>} syncSystemOauthToMod
 * @property {() => Promise<any>} getWidgetRedemptionReconcileStatus
 * @property {(payload: Object) => Promise<{ok:boolean,status:number,data:any}>} reconcileWidgetRedemptions
 * @property {(payload: Object) => Promise<{ok:boolean,status:number,data:any}>} patchWidgetRedemptionStatus
 * @property {(payload: Object) => Promise<{ok:boolean,status:number,data:any}>} generateWidgetTemplate
 * @property {(routePath: string, init?: Object) => Promise<{ok:boolean,status:number,data:any,raw:string}>} requestRoute
 */

/** @type {SystemEndpointsAdapter} */
const systemEndpointsAdapter = Object.freeze({
  getConfig: () => getJson("/system/config"),
  getSystemOauthStatus: () => getJson("/system/oauth/status"),
  getStartupReadiness: () => getJson("/system/startup-readiness"),
  getCoreStatus: () => getJson("/system/core-status"),
  getLauncherDiagnostics: () => getJson("/system/launcher-diagnostics"),
  getRouteCatalog: () => getJson("/system/routes/catalog"),
  getInternetGatewayStatus: () => getJson("/system/internet-gateway/status"),
  getUpdateStatus: () => getJson("/system/update/status"),
  saveConfig: payload => postJson("/system/config", payload),
  checkForUpdates: payload => postJson("/system/update/check", payload),
  applyUpdate: payload => postJson("/system/update/apply", payload),
  seedSystemOauthProfile: payload => postJson("/system/oauth/seed", payload),
  clearSystemOauthProfile: () => postJson("/system/oauth/clear", {}),
  startSystemOauth: payload => postJson("/system/oauth/start", payload),
  getSystemOauthDeviceStatus: payload => postJson("/system/oauth/device-status", payload),
  disconnectSystemOauth: payload => postJson("/system/oauth/disconnect", payload),
  syncSystemOauthToMod: payload => postJson("/system/oauth/sync-to-mod", payload),
  getWidgetRedemptionReconcileStatus: () => getJson("/system/widget-redemption-reconcile-status"),
  reconcileWidgetRedemptions: payload => postJson("/system/widget-redemption-reconcile", payload),
  patchWidgetRedemptionStatus: payload => postJson("/system/widget-redemption-status", payload),
  generateWidgetTemplate: payload => postJson("/system/widget-template-get", payload),
  requestRoute: async (routePath, init = {}) => {
    try {
      const response = await fetch(withBase(routePath), {
        cache: "no-store",
        ...init
      });
      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { ok: response.ok, status: response.status, raw: text };
      }
      return {
        ok: response.ok,
        status: response.status,
        data,
        raw: text
      };
    } catch {
      return {
        ok: false,
        status: 0,
        data: null,
        raw: ""
      };
    }
  }
});
