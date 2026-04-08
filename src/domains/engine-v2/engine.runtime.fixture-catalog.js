// [TITLE] Module: domains/engine-v2/engine.runtime.fixture-catalog.js
// [TITLE] Purpose: fixture catalog + exclusion snapshot shaping for engine runtime ticks
// [TITLE] Functionality Index:
// [TITLE] - build configured engine fixture catalogs from the registry
// [TITLE] - project sync-group fixture-engine exclusions into removal-control rows
// [TITLE] - keep dispatch fixture maps and smoothing-state cleanup in sync with the latest catalog

module.exports = function createEngineRuntimeFixtureCatalog(options = {}) {
  const fixtureRegistry = options.fixtureRegistry;
  const buildSyncGroupFixtureMapRuntime = options.buildSyncGroupFixtureMapRuntime;
  const normalizeSyncGroupRemoveBehaviorRuntime = options.normalizeSyncGroupRemoveBehaviorRuntime;
  const normalizeSyncGroupCustomFallbackRuntime = options.normalizeSyncGroupCustomFallbackRuntime;
  const fixtureIntentSmoothingState = options.fixtureIntentSmoothingState;
  const SYNC_GROUP_DEFAULT_REMOVE_BEHAVIOR = options.SYNC_GROUP_DEFAULT_REMOVE_BEHAVIOR;
  const SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT = options.SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT;

  let dispatchFixtureById = new Map();

  function getDispatchFixtureById() {
    return dispatchFixtureById;
  }

  function getFixtureCatalogSnapshot(profile = null) {
    const rows = fixtureRegistry.listEngineBy("", "", { requireConfigured: true });
    const triggerMatrix = profile?.payload?.triggerMatrix;
    const syncGroups = buildSyncGroupFixtureMapRuntime(triggerMatrix?.syncGroups);
    const nextDispatchMap = new Map();
    const nextExcludedControls = new Map();
    const catalog = [];

    for (const row of rows) {
      const fixtureId = String(row?.id || "").trim();
      const brand = String(row?.brand || "").trim().toLowerCase();
      if (!fixtureId || !brand) continue;
      const fixtureEngineControl = syncGroups.fixtureEngineById.get(fixtureId) || {
        excluded: false,
        removeBehavior: SYNC_GROUP_DEFAULT_REMOVE_BEHAVIOR,
        customFallback: SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT
      };
      if (fixtureEngineControl.excluded === true) {
        nextExcludedControls.set(fixtureId, {
          fixture: { ...row },
          removeBehavior: normalizeSyncGroupRemoveBehaviorRuntime(
            fixtureEngineControl.removeBehavior,
            SYNC_GROUP_DEFAULT_REMOVE_BEHAVIOR
          ),
          customFallback: normalizeSyncGroupCustomFallbackRuntime(
            fixtureEngineControl.customFallback,
            SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT
          )
        });
        continue;
      }
      nextDispatchMap.set(fixtureId, { ...row });
      catalog.push({
        id: fixtureId,
        brand,
        zone: String(row?.zone || "").trim().toLowerCase(),
        enabled: row?.enabled !== false
      });
    }

    dispatchFixtureById = nextDispatchMap;
    for (const fixtureId of fixtureIntentSmoothingState.keys()) {
      if (!nextDispatchMap.has(fixtureId)) {
        fixtureIntentSmoothingState.delete(fixtureId);
      }
    }

    return {
      catalog,
      excludedControlsById: nextExcludedControls
    };
  }

  return {
    getDispatchFixtureById,
    getFixtureCatalogSnapshot
  };
};
