// [TITLE] Module: public/assets/js/domains/live/live-sync-groups-transport-ui.js
// [TITLE] Purpose: LIVE sync-group canonical transport helpers
// [TITLE] Functionality Index:
// [TITLE] - canonical sync-group load
// [TITLE] - canonical sync-group save
// [TITLE] - profile snapshot apply through sync-group save path
// [DEV] Complex Flow:
// [DEV] Sync groups write only through the canonical LIVE sync-group adapter path.
// [DEV] Keep that transport boundary separate from table/editor event rendering.

function createLiveSyncGroupsTransportUi(deps = {}) {
  const ui = deps.ui || {};
  const el = deps.el || {};
  const liveEndpointsAdapter = deps.liveEndpointsAdapter || {};
  const setBadge = typeof deps.setBadge === "function" ? deps.setBadge : (() => {});
  const setLiveSyncGroupsStatus = typeof deps.setLiveSyncGroupsStatus === "function"
    ? deps.setLiveSyncGroupsStatus
    : (() => {});
  const applyLiveSyncGroupsUi = typeof deps.applyLiveSyncGroupsUi === "function"
    ? deps.applyLiveSyncGroupsUi
    : (() => {});
  const normalizeLiveSyncGroupsUi = typeof deps.normalizeLiveSyncGroupsUi === "function"
    ? deps.normalizeLiveSyncGroupsUi
    : ((value, fallback) => value || fallback || {});

  async function loadLiveSyncGroupsUi(options = {}) {
    const silent = options.silent === true;
    let snapshot = null;
    const syncGroupsResp = await liveEndpointsAdapter.getSyncGroups();
    if (syncGroupsResp && syncGroupsResp.ok !== false && syncGroupsResp.snapshot && typeof syncGroupsResp.snapshot === "object") {
      snapshot = syncGroupsResp.snapshot;
    }
    if (!snapshot) {
      const matrixResp = await liveEndpointsAdapter.getTriggerMatrix();
      if (matrixResp && matrixResp.ok === true && matrixResp.syncGroups && typeof matrixResp.syncGroups === "object") {
        snapshot = matrixResp.syncGroups;
      }
    }
    if (!snapshot) {
      if (!silent) {
        setBadge(el.health, "warn", "SYNC GROUP LOAD FAIL");
        setLiveSyncGroupsStatus("Load failed.");
      }
      return false;
    }
    applyLiveSyncGroupsUi(snapshot, {
      statusText: "Sync groups loaded.",
      sync: true
    });
    return true;
  }

  async function saveLiveSyncGroupsUi(options = {}) {
    const profile = normalizeLiveSyncGroupsUi(
      options.profile || ui.liveSyncGroups,
      ui.liveSyncGroups
    );
    const response = await liveEndpointsAdapter.patchSyncGroups(profile);
    if (!response.ok || !response.data || response.data.ok !== true) {
      setBadge(el.health, "bad", "SYNC GROUP SAVE FAIL");
      setLiveSyncGroupsStatus("Save failed.");
      return false;
    }
    const snapshot = response.data?.snapshot && typeof response.data.snapshot === "object"
      ? response.data.snapshot
      : (response.data?.syncGroups && typeof response.data.syncGroups === "object"
        ? response.data.syncGroups
        : profile);
    applyLiveSyncGroupsUi(snapshot, {
      statusText: "Sync groups saved.",
      sync: true
    });
    if (options.announce !== false) {
      setBadge(el.health, "ok", "SYNC GROUPS SAVED");
    }
    return true;
  }

  async function applyLiveSyncGroupsSnapshot(snapshot = null, options = {}) {
    const next = normalizeLiveSyncGroupsUi(snapshot || {}, ui.liveSyncGroups);
    const ok = await saveLiveSyncGroupsUi({
      profile: next,
      announce: options.announce !== false
    });
    if (!ok && options.announce !== false) {
      setBadge(el.health, "warn", "SYNC GROUP APPLY PARTIAL");
    }
    return ok;
  }

  return {
    applyLiveSyncGroupsSnapshot,
    loadLiveSyncGroupsUi,
    saveLiveSyncGroupsUi
  };
}

