// [TITLE] Purpose: verify engine-v2 sync-group runtime normalization and palette-frame helpers

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SYNC_GROUP_DEFAULT_REMOVE_BEHAVIOR,
  normalizeSyncGroupModeRuntime,
  normalizeSyncGroupRemoveBehaviorRuntime,
  normalizeSyncGroupCustomFallbackRuntime,
  buildSyncGroupFixtureMapRuntime,
  resolveSyncGroupPaletteIndexRuntime,
  resolvePaletteFrameByIndexRuntime
} = require("../src/domains/engine-v2/engine.runtime.sync-groups");

test("engine-v2 sync-group runtime normalization keeps deterministic group and fixture-engine maps", () => {
  const snapshot = buildSyncGroupFixtureMapRuntime({
    enabled: true,
    groups: [
      { id: "frontline", sequenceMode: "mirror", phaseOffset: 3, fixtureIds: ["hue-1", "wiz-2", "hue-1"] },
      { id: "frontline", sequenceMode: "offset", phaseOffset: 2, fixtureIds: ["ignored-duplicate-group"] },
      { id: "backline", sequenceMode: "offset", phaseOffset: -4, fixtureIds: ["hue-3"] }
    ],
    fixtureEngine: {
      "hue-1": {
        excluded: true,
        removeBehavior: "restore"
      },
      "hue-3": {
        removeBehavior: "custom",
        customFallback: {
          mode: "kelvin",
          cct: 5100,
          brightness: 67
        }
      }
    }
  });

  assert.equal(snapshot.enabled, true);
  assert.equal(snapshot.groups.length, 2);
  assert.equal(snapshot.groups[0].sequenceMode, "reverse");
  assert.deepEqual(snapshot.groups[0].fixtureIds, ["hue-1", "wiz-2"]);
  assert.equal(snapshot.fixtureGroupById.get("hue-3")?.id, "backline");
  assert.equal(snapshot.fixtureEngineById.get("hue-1")?.excluded, true);
  assert.equal(snapshot.fixtureEngineById.get("hue-1")?.removeBehavior, "keep_current");
  assert.equal(snapshot.fixtureEngineById.get("hue-3")?.customFallback?.mode, "cct");
  assert.equal(snapshot.fixtureEngineById.get("hue-3")?.customFallback?.cct, 5100);
});

test("engine-v2 sync-group runtime palette index resolver handles sync, reverse, and offset deterministically", () => {
  assert.equal(resolveSyncGroupPaletteIndexRuntime(2, 5, { sequenceMode: "sync" }), 2);
  assert.equal(resolveSyncGroupPaletteIndexRuntime(1, 5, { sequenceMode: "mirror" }), 3);
  assert.equal(resolveSyncGroupPaletteIndexRuntime(4, 5, { sequenceMode: "offset", phaseOffset: 3 }), 2);
  assert.equal(resolveSyncGroupPaletteIndexRuntime(-1, 5, { sequenceMode: "offset", phaseOffset: -2 }), 2);
});

test("engine-v2 sync-group runtime palette-frame resolver preserves palette metadata and fallback RGB", () => {
  const resolved = resolvePaletteFrameByIndexRuntime({
    paletteSnapshot: {
      resolvedSequence: [
        { token: "red", name: "Red", hex: "#ff0000", rgb: { r: 255, g: 0, b: 0 }, source: "palette" },
        { token: "green", name: "Green", hex: "#00ff00", rgb: { r: 0, g: 255, b: 0 }, source: "palette" }
      ]
    },
    basePaletteFrame: {
      holdTicks: 4
    },
    index: 1
  });

  const fallback = resolvePaletteFrameByIndexRuntime({
    basePaletteFrame: {
      index: 0,
      count: 1,
      rgb: { r: 12, g: 34, b: 56 },
      holdTicks: 2
    },
    index: 9
  });

  assert.equal(resolved.index, 1);
  assert.equal(resolved.token, "green");
  assert.equal(resolved.rgb.g, 255);
  assert.equal(resolved.holdTicks, 4);
  assert.equal(fallback.index, 0);
  assert.equal(fallback.count, 1);
  assert.equal(fallback.rgb.r, 12);
  assert.equal(fallback.holdTicks, 2);
});

test("engine-v2 sync-group runtime remove-behavior and custom-fallback normalization stay migration-safe", () => {
  assert.equal(
    normalizeSyncGroupRemoveBehaviorRuntime("restore", SYNC_GROUP_DEFAULT_REMOVE_BEHAVIOR),
    "keep_current"
  );
  assert.equal(
    normalizeSyncGroupRemoveBehaviorRuntime("custom-state", SYNC_GROUP_DEFAULT_REMOVE_BEHAVIOR),
    "custom_state"
  );

  const fallback = normalizeSyncGroupCustomFallbackRuntime({
    mode: "white",
    kelvin: 4800,
    brightness: 45
  });
  assert.equal(fallback.mode, "cct");
  assert.equal(fallback.cct, 4800);
  assert.equal(fallback.brightness, 45);
  assert.equal(normalizeSyncGroupModeRuntime("mirror"), "reverse");
});
