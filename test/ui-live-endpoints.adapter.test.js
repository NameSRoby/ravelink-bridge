// [TITLE] Purpose: verify canonical LIVE endpoint adapter behavior and compat fallback

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const LIVE_ENDPOINTS_PATH = path.resolve(__dirname, "..", "public/assets/js/domains/contracts/live-endpoints.adapter.js");
const LIVE_ENDPOINTS_CODE = `${fs.readFileSync(LIVE_ENDPOINTS_PATH, "utf8")}\n;globalThis.__adapter = liveEndpointsAdapter;\n;globalThis.__buildLiveCompatibilitySnapshotFromStatus = buildLiveCompatibilitySnapshotFromStatus;`;

function loadLiveEndpointsContext(overrides = {}) {
  const getJsonCalls = [];
  const postJsonCalls = [];
  const apiCalls = [];
  const context = {
    console,
    getJson: async path => {
      getJsonCalls.push(path);
      if (typeof overrides.getJson === "function") {
        return overrides.getJson(path);
      }
      return null;
    },
    postJson: async (path, body) => {
      postJsonCalls.push({ path, body });
      if (typeof overrides.postJson === "function") {
        return overrides.postJson(path, body);
      }
      return { ok: true, status: 200, data: {} };
    },
    api: async path => {
      apiCalls.push(path);
      if (typeof overrides.api === "function") {
        return overrides.api(path);
      }
      return true;
    }
  };
  vm.createContext(context);
  vm.runInContext(LIVE_ENDPOINTS_CODE, context, { filename: LIVE_ENDPOINTS_PATH });
  return {
    adapter: context.__adapter,
    buildLiveCompatibilitySnapshotFromStatus: context.__buildLiveCompatibilitySnapshotFromStatus,
    getJsonCalls,
    postJsonCalls,
    apiCalls
  };
}

test("live endpoints adapter prefers canonical live status compatibility snapshot", async () => {
  const { adapter, getJsonCalls } = loadLiveEndpointsContext({
    async getJson(path) {
      if (path === "/live/status") {
        return {
          ok: true,
          mode: "full",
          compatibility: {
            sceneLock: "motion",
            sceneIntent: "impact",
            updatedAt: 42
          }
        };
      }
      if (path === "/rave/live/compatibility") {
        throw new Error("compat fallback should not be called when canonical status is populated");
      }
      return null;
    }
  });

  const payload = await adapter.getCompatibility();

  assert.deepEqual(getJsonCalls, ["/live/status"]);
  assert.equal(payload?.ok, true);
  assert.equal(payload?.snapshot?.sceneLock, "motion");
  assert.equal(payload?.snapshot?.sceneIntent, "impact");
  assert.equal(payload?.snapshot?.updatedAt, 42);
});

test("live endpoints adapter falls back to compat route when canonical live status lacks snapshot state", async () => {
  const { adapter, getJsonCalls } = loadLiveEndpointsContext({
    async getJson(path) {
      if (path === "/live/status") {
        return { ok: true, mode: "full" };
      }
      if (path === "/rave/live/compatibility") {
        return {
          ok: true,
          snapshot: {
            sceneLock: "auto",
            sceneIntent: "auto",
            updatedAt: 7
          }
        };
      }
      return null;
    }
  });

  const payload = await adapter.getCompatibility();

  assert.deepEqual(getJsonCalls, ["/live/status", "/rave/live/compatibility"]);
  assert.equal(payload?.ok, true);
  assert.equal(payload?.snapshot?.sceneLock, "auto");
  assert.equal(payload?.snapshot?.sceneIntent, "auto");
  assert.equal(payload?.snapshot?.updatedAt, 7);
});

test("canonical live status compatibility helper normalizes top-level scene fields into snapshot shape", () => {
  const { buildLiveCompatibilitySnapshotFromStatus } = loadLiveEndpointsContext();

  const payload = buildLiveCompatibilitySnapshotFromStatus({
    ok: true,
    sceneLock: "groove",
    sceneIntent: "impact",
    compatibilityUpdatedAt: 99
  });

  assert.equal(payload?.ok, true);
  assert.equal(payload?.snapshot?.sceneLock, "groove");
  assert.equal(payload?.snapshot?.sceneIntent, "impact");
  assert.equal(payload?.snapshot?.updatedAt, 99);
});

test("live endpoints adapter writes scene intent and sync groups through canonical live routes", async () => {
  const { adapter, postJsonCalls, getJsonCalls } = loadLiveEndpointsContext({
    async postJson(path, body) {
      return { ok: true, status: 200, data: { ok: true, path, body } };
    },
    async getJson(path) {
      if (path === "/live/sync-groups") {
        return { ok: true, snapshot: { enabled: true, groups: [] } };
      }
      return null;
    }
  });

  const scene = await adapter.patchSceneIntent({ sceneLock: "motion" });
  const tuning = await adapter.patchTriggerMatrix({ scope: { level: "global" }, override: { runtimeTuning: { bpmSourceMode: "hybrid" } } });
  const groups = await adapter.patchSyncGroups({ enabled: true, groups: [] });
  const readGroups = await adapter.getSyncGroups();
  await adapter.getTriggerMatrix();

  assert.equal(scene.ok, true);
  assert.equal(tuning.ok, true);
  assert.equal(groups.ok, true);
  assert.equal(readGroups?.ok, true);
  assert.deepEqual(postJsonCalls.map(call => call.path), ["/live/scene", "/live/scene-tuning", "/live/sync-groups"]);
  assert.deepEqual(getJsonCalls, ["/live/sync-groups", "/live/scene-tuning"]);
  assert.equal(postJsonCalls.some(call => call.path.includes("/rave/live/compatibility")), false);
  assert.equal(postJsonCalls.some(call => call.path.includes("/rave/live/sync-groups")), false);
  assert.equal(postJsonCalls.some(call => call.path.includes("/rave/live/trigger-matrix")), false);
});
