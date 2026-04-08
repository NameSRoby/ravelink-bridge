// [TITLE] Module: public/assets/js/domains/contracts/live-endpoints.adapter.js
// [TITLE] Purpose: typed endpoint adapter for LIVE tab runtime modules
// [TITLE] Functionality Index:
// [TITLE] - centralize live/rave route contracts
// [TITLE] - expose overclock + canonical LIVE mutation helpers
// [TITLE] - expose shell dev-tool probe endpoints

const LIVE_OVERCLOCK_ROUTE_BY_LEVEL = Object.freeze({
  0: "/rave/overclock/off",
  1: "/rave/overclock/on",
  2: "/rave/overclock/turbo/on",
  3: "/rave/overclock/ultra/on",
  4: "/rave/overclock/extreme/on",
  5: "/rave/overclock/insane/on",
  6: "/rave/overclock/hyper/on",
  7: "/rave/overclock/ludicrous/on"
});

function buildLiveCompatibilitySnapshotFromStatus(payload) {
  const source = payload && typeof payload === "object" ? payload : null;
  if (!source || source.ok === false) return null;
  const compatibility = source.compatibility && typeof source.compatibility === "object"
    ? source.compatibility
    : {};
  const sceneLock = String(source.sceneLock || compatibility.sceneLock || "").trim().toLowerCase();
  const sceneIntent = String(source.sceneIntent || compatibility.sceneIntent || sceneLock || "").trim().toLowerCase();
  if (!sceneLock && !sceneIntent && Object.keys(compatibility).length === 0) {
    return null;
  }
  return {
    ok: true,
    snapshot: {
      ...compatibility,
      sceneLock: sceneLock || "auto",
      sceneIntent: sceneIntent || sceneLock || "auto",
      updatedAt: Number(compatibility.updatedAt || source.compatibilityUpdatedAt || 0)
    }
  };
}

/**
 * @typedef {Object} LiveEndpointsAdapter
 * @property {() => Promise<any>} getLiveStatus
 * @property {() => Promise<any>} getCompatibility
 * @property {(patch: Object) => Promise<{ok:boolean,status:number,data:any}>} patchSceneIntent
 * @property {() => Promise<any>} getTriggerMatrix
 * @property {(patch: Object) => Promise<{ok:boolean,status:number,data:any}>} patchTriggerMatrix
 * @property {() => Promise<any>} getSyncGroups
 * @property {(patch: Object) => Promise<{ok:boolean,status:number,data:any}>} patchSyncGroups
 * @property {() => Promise<boolean>} raveOn
 * @property {() => Promise<boolean>} raveOff
 * @property {() => Promise<boolean>} ravePanic
 * @property {() => Promise<boolean>} raveReload
 * @property {() => Promise<{ok:boolean,status:number,data:any}>} raveReloadDetailed
 * @property {() => Promise<{ok:boolean,status:number,data:any}>} setHueTransportEntertainment
 * @property {() => Promise<{ok:boolean,status:number,data:any}>} setHueTransportRest
 * @property {() => Promise<{ok:boolean,status:number,data:any}>} stopSystem
 * @property {(enabled: boolean) => Promise<{ok:boolean,status:number,data:any}>} setOverclockAuto
 * @property {(level: number) => Promise<boolean>} setOverclockPresetLevel
 * @property {(hz: number) => Promise<{ok:boolean,status:number,data:any}>} setOverclockDev
 * @property {() => Promise<any>} getPaletteSnapshot
 * @property {() => Promise<any>} getFixtureMetricSnapshot
 * @property {() => Promise<any>} probeModsRuntime
 * @property {() => Promise<any>} probeFixturesConnectivity
 * @property {() => Promise<any>} probeModsHooks
 * @property {() => Promise<any>} probeOverclockTiers
 */

/** @type {LiveEndpointsAdapter} */
const liveEndpointsAdapter = Object.freeze({
  getLiveStatus: () => getJson("/live/status"),
  getCompatibility: async () => {
    const canonicalStatus = await getJson("/live/status");
    const canonicalSnapshot = buildLiveCompatibilitySnapshotFromStatus(canonicalStatus);
    if (canonicalSnapshot) return canonicalSnapshot;
    return getJson("/rave/live/compatibility");
  },
  patchSceneIntent: patch => postJson("/live/scene", patch),
  getTriggerMatrix: () => getJson("/live/scene-tuning"),
  patchTriggerMatrix: patch => postJson("/live/scene-tuning", patch),
  getSyncGroups: () => getJson("/live/sync-groups"),
  patchSyncGroups: patch => postJson("/live/sync-groups", patch),
  raveOn: () => api("/rave/on"),
  raveOff: () => api("/rave/off"),
  ravePanic: () => api("/rave/panic"),
  raveReload: () => api("/rave/reload"),
  raveReloadDetailed: () => postJson("/rave/reload", {}),
  setHueTransportEntertainment: () => postJson("/hue/transport?mode=entertainment", {}),
  setHueTransportRest: () => postJson("/hue/transport?mode=rest", {}),
  stopSystem: () => postJson("/system/stop", {}),
  setOverclockAuto: enabled => postJson(`/rave/overclock/auto?enabled=${enabled ? "true" : "false"}`, {}),
  setOverclockPresetLevel: level => {
    const safeLevel = Math.max(0, Math.min(7, Math.round(Number(level) || 0)));
    const route = LIVE_OVERCLOCK_ROUTE_BY_LEVEL[safeLevel] || LIVE_OVERCLOCK_ROUTE_BY_LEVEL[2];
    return api(route);
  },
  setOverclockDev: hz => postJson(`/rave/overclock/dev/${Math.max(1, Math.round(Number(hz) || 0))}/on?unsafe=true`, { unsafe: true }),
  getPaletteSnapshot: () => getJson("/rave/palette"),
  getFixtureMetricSnapshot: () => getJson("/rave/fixture-metrics"),
  probeModsRuntime: () => getJson("/mods/runtime"),
  probeFixturesConnectivity: () => getJson("/fixtures/connectivity"),
  probeModsHooks: () => getJson("/mods/hooks"),
  probeOverclockTiers: () => getJson("/rave/overclock/tiers")
});
