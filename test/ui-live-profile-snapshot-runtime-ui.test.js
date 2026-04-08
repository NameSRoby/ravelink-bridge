const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const LIVE_PROFILE_SNAPSHOT_PATH = path.resolve(__dirname, "..", "public/assets/js/domains/live/live-profile-snapshot-runtime-ui.js");
const LIVE_PROFILE_SNAPSHOT_CODE = fs.readFileSync(LIVE_PROFILE_SNAPSHOT_PATH, "utf8");

function createClassList() {
  const values = new Set();
  return {
    add(value) {
      values.add(String(value));
    },
    remove(value) {
      values.delete(String(value));
    },
    contains(value) {
      return values.has(String(value));
    }
  };
}

function loadLiveProfileSnapshotContext(overrides = {}) {
  const patchCalls = [];
  const badgeCalls = [];
  const pollCalls = [];
  const syncCalls = [];
  const ui = overrides.ui || {
    sceneLock: "auto",
    cadenceAutoEnabled: false,
    overclockAutoEnabled: false,
    overclockLevel: 2,
    sceneFilterAggressiveness: { calm: 1, groove: 1, impact: 1 },
    sceneRuntimeTuning: { bpmSourceMode: "hybrid" },
    paletteBrandOverrides: {},
    paletteFixtureOverrides: {},
    paletteControlScope: "global",
    paletteCustomBrand: "hue",
    paletteFixtureSelectionByBrand: {},
    fixtureMetricConfig: {},
    fixtureMetricBrandOverrides: {},
    fixtureMetricFixtureOverrides: {}
  };
  const context = {
    console,
    ui,
    el: overrides.el || {
      health: {},
      ocAutoBtn: { classList: createClassList() },
      ocOffBtn: { classList: createClassList() },
      ocOnBtn: { classList: createClassList() },
      ocTurboBtn: { classList: createClassList() },
      ocUltraBtn: { classList: createClassList() },
      ocExtremeBtn: { classList: createClassList() },
      ocInsaneBtn: { classList: createClassList() },
      ocHyperBtn: { classList: createClassList() },
      ocLudicrousBtn: { classList: createClassList() }
    },
    sceneButtons: overrides.sceneButtons || [{ dataset: { scene: "motion" }, classList: createClassList() }],
    PALETTE_SUPPORTED_BRANDS: ["hue", "wiz"],
    PALETTE_ALL_FIXTURES_VALUE: "__all__",
    liveEndpointsAdapter: overrides.liveEndpointsAdapter || {
      async getPaletteSnapshot() { return null; },
      async getFixtureMetricSnapshot() { return null; },
      async patchSceneIntent(patch) {
        patchCalls.push(patch);
        return { ok: true, data: { ok: true, applied: { sceneLock: patch.sceneLock }, snapshot: { sceneLock: patch.sceneLock } } };
      }
    },
    parseBooleanUi(value, fallback = false) {
      if (value === true || value === false) return value;
      if (value === 1 || value === "1" || String(value || "").trim().toLowerCase() === "true") return true;
      if (value === 0 || value === "0" || String(value || "").trim().toLowerCase() === "false") return false;
      return fallback === true;
    },
    clampNumber(value, min, max, fallback) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.max(min, Math.min(max, parsed));
    },
    setOverclockAutoEnabled: async () => true,
    setOverclockPreset: async () => true,
    applyFlowIntensityUi() {},
    maybeApplySmartLiveReactivityPolicy() {},
    sync() {
      syncCalls.push({ sceneLock: ui.sceneLock });
    },
    poll: async options => {
      pollCalls.push(options);
    },
    setBadge(node, state, text) {
      badgeCalls.push({ node, state, text });
    },
    requestAnimationFrame(callback) {
      if (typeof callback === "function") callback();
    },
    setTimeout(callback) {
      if (typeof callback === "function") callback();
      return 1;
    },
    clearTimeout() {}
  };
  vm.createContext(context);
  vm.runInContext(LIVE_PROFILE_SNAPSHOT_CODE, context, { filename: LIVE_PROFILE_SNAPSHOT_PATH });
  return { context, ui, patchCalls, badgeCalls, pollCalls, syncCalls };
}

test("live profile snapshot normalization canonicalizes legacy scene aliases and bounds overclock", () => {
  const { context } = loadLiveProfileSnapshotContext();

  const normalized = context.normalizeLiveProfileSnapshot({
    sceneLock: "groove",
    cadenceAutoEnabled: "1",
    overclockLevel: 12
  });

  assert.equal(normalized.sceneLock, "motion");
  assert.equal(normalized.cadenceAutoEnabled, true);
  assert.equal(normalized.overclockAutoEnabled, true);
  assert.equal(normalized.overclockLevel, 7);
});

test("live profile snapshot apply commits scene lock and updates UI state", async () => {
  const { context, ui, patchCalls, badgeCalls, pollCalls } = loadLiveProfileSnapshotContext();

  const ok = await context.applyLiveProfileSnapshot({
    sceneLock: "groove",
    cadenceAutoEnabled: false,
    overclockLevel: 3
  }, { announce: true, forcePoll: true, pulse: false });

  assert.equal(ok, true);
  assert.equal(patchCalls[0]?.sceneLock, "motion");
  assert.equal(ui.sceneLock, "motion");
  assert.equal(ui.brightnessPowerMode, "b");
  assert.equal(ui.flowIntensity, 1);
  assert.equal(pollCalls.length, 1);
  assert.equal(badgeCalls.at(-1)?.state, "ok");
  assert.equal(badgeCalls.at(-1)?.text, "LIVE PROFILE APPLIED");
});
