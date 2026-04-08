// [TITLE] Purpose: verify engine-v2 runtime profile snapshot shaping from live services

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  listRuntimeProfilesSafe,
  getLiveCompatibilitySnapshotSafe,
  getLiveTriggerMatrixSnapshotSafe,
  getLiveOverclockSnapshotSafe,
  buildEngineRuntimeProfileSnapshot
} = require("../src/domains/engine-v2/engine.runtime.profile");

test("engine-v2 runtime profile helpers tolerate missing or malformed services", () => {
  assert.deepEqual(listRuntimeProfilesSafe(null), []);
  assert.deepEqual(getLiveCompatibilitySnapshotSafe(null), {});
  assert.deepEqual(getLiveTriggerMatrixSnapshotSafe(null), {});
  assert.deepEqual(getLiveOverclockSnapshotSafe(null), {});

  const malformed = buildEngineRuntimeProfileSnapshot({
    liveProfileService: {
      listProfiles() {
        return { bad: true };
      }
    },
    liveCompatService: {
      getCompatibility() {
        return { snapshot: null };
      },
      getTriggerMatrix() {
        return null;
      },
      getOverclockTiers() {
        return "bad";
      }
    }
  });

  assert.equal(malformed.name, "default");
  assert.deepEqual(malformed.payload.compatibility, {});
  assert.deepEqual(malformed.payload.triggerMatrix, {});
  assert.deepEqual(malformed.payload.overclock, {});
});

test("engine-v2 runtime profile helper preserves first profile name and live compat payloads", () => {
  const snapshot = buildEngineRuntimeProfileSnapshot({
    liveProfileService: {
      listProfiles() {
        return [{ name: "show-main" }, { name: "backup" }];
      }
    },
    liveCompatService: {
      getCompatibility() {
        return {
          ok: true,
          snapshot: {
            sceneLock: "motion",
            sceneIntent: "impact"
          }
        };
      },
      getTriggerMatrix() {
        return {
          ok: true,
          syncGroups: {
            enabled: true
          }
        };
      },
      getOverclockTiers() {
        return {
          ok: true,
          activeLevel: 4,
          autoEnabled: false
        };
      }
    }
  });

  assert.equal(snapshot.name, "show-main");
  assert.equal(snapshot.payload.compatibility.sceneLock, "motion");
  assert.equal(snapshot.payload.compatibility.sceneIntent, "impact");
  assert.equal(snapshot.payload.triggerMatrix.syncGroups.enabled, true);
  assert.equal(snapshot.payload.overclock.activeLevel, 4);
});
