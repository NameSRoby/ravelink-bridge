// [TITLE] Purpose: verify engine-v2 fixture catalog helper keeps dispatch maps and exclusion rows deterministic

const test = require("node:test");
const assert = require("node:assert/strict");

const createEngineRuntimeFixtureCatalog = require("../src/domains/engine-v2/engine.runtime.fixture-catalog");

function createFixtureCatalog(overrides = {}) {
  return createEngineRuntimeFixtureCatalog({
    fixtureRegistry: {
      listEngineBy() {
        return typeof overrides.getRows === "function"
          ? overrides.getRows()
          : (overrides.rows || []);
      }
    },
    buildSyncGroupFixtureMapRuntime(input) {
      return {
        fixtureEngineById: new Map(Object.entries(input?.fixtureEngine || {}))
      };
    },
    normalizeSyncGroupRemoveBehaviorRuntime(value, fallback) {
      const token = String(value || "").trim().toLowerCase();
      return token || fallback;
    },
    normalizeSyncGroupCustomFallbackRuntime(value, fallback) {
      return value && typeof value === "object"
        ? { ...value }
        : { ...fallback };
    },
    fixtureIntentSmoothingState: overrides.fixtureIntentSmoothingState || new Map(),
    SYNC_GROUP_DEFAULT_REMOVE_BEHAVIOR: "keep_current",
    SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT: { hex: "", brightness: 1 }
  });
}

test("engine-v2 fixture catalog helper builds dispatch maps only for non-excluded configured fixtures", () => {
  const helper = createFixtureCatalog({
    rows: [
      { id: "hue-a", brand: "hue", zone: "front", enabled: true },
      { id: "wiz-a", brand: "wiz", zone: "back", enabled: false },
      { id: "skip-me", brand: "", zone: "back", enabled: true }
    ]
  });

  const snapshot = helper.getFixtureCatalogSnapshot({
    payload: {
      triggerMatrix: {
        syncGroups: {
          fixtureEngine: {
            "wiz-a": {
              excluded: true,
              removeBehavior: "blackout"
            }
          }
        }
      }
    }
  });

  assert.deepEqual(snapshot.catalog, [
    { id: "hue-a", brand: "hue", zone: "front", enabled: true }
  ]);
  assert.equal(snapshot.excludedControlsById.has("wiz-a"), true);
  assert.equal(snapshot.excludedControlsById.get("wiz-a").removeBehavior, "blackout");
  assert.deepEqual(
    Array.from(helper.getDispatchFixtureById().keys()),
    ["hue-a"]
  );
});

test("engine-v2 fixture catalog helper clears smoothing state for fixtures that leave the dispatch map", () => {
  const fixtureIntentSmoothingState = new Map([
    ["hue-a", { brightness: 1 }],
    ["wiz-old", { brightness: 0.5 }]
  ]);
  let rows = [
    { id: "hue-a", brand: "hue", zone: "front", enabled: true },
    { id: "wiz-old", brand: "wiz", zone: "back", enabled: true }
  ];
  const helper = createFixtureCatalog({
    fixtureIntentSmoothingState,
    getRows: () => rows
  });

  helper.getFixtureCatalogSnapshot({ payload: { triggerMatrix: {} } });
  rows = [
    { id: "hue-a", brand: "hue", zone: "front", enabled: true }
  ];
  helper.getFixtureCatalogSnapshot({ payload: { triggerMatrix: {} } });

  assert.equal(fixtureIntentSmoothingState.has("hue-a"), true);
  assert.equal(fixtureIntentSmoothingState.has("wiz-old"), false);
});
