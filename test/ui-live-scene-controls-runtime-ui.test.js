// [TITLE] Purpose: verify LIVE scene snapshot hydration and scene control runtime behavior

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const LIVE_SCENE_PATH = path.resolve(__dirname, "..", "public/assets/js/domains/live/live-scene-controls-runtime-ui.js");
const LIVE_SCENE_CODE = fs.readFileSync(LIVE_SCENE_PATH, "utf8");

function loadLiveSceneContext(overrides = {}) {
  const badgeCalls = [];
  const syncCalls = [];
  const ui = overrides.ui || {
    sceneLock: "auto",
    brightnessPowerMode: "",
    flowIntensity: 0,
    metaAutoTempoTrackersAuto: false,
    metaAutoTempoTrackers: {},
    metaAutoTempoTrackersActive: {},
    metaAutoHueWizBaselineBlend: false,
    audioReactivityMap: {}
  };
  const el = overrides.el || { health: {} };
  const context = {
    console,
    ui,
    el,
    liveEndpointsAdapter: overrides.liveEndpointsAdapter || {
      getCompatibility: async () => ({ ok: true, snapshot: { sceneLock: "auto" } }),
      patchSceneIntent: async () => ({ ok: true, data: { ok: true, applied: { sceneLock: "auto" } } })
    },
    META_AUTO_TEMPO_TRACKER_KEYS: ["baseline", "peaks", "transients", "flux"],
    normalizeMetaAutoTempoTrackersUi: trackers => ({
      baseline: trackers?.baseline !== false,
      peaks: trackers?.peaks !== false,
      transients: trackers?.transients !== false,
      flux: trackers?.flux !== false
    }),
    clampNumber(value, min, max, fallback) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.max(min, Math.min(max, parsed));
    },
    setBadge(node, state, text) {
      badgeCalls.push({ node, state, text });
    },
    sync() {
      syncCalls.push({ sceneLock: ui.sceneLock, flowIntensity: ui.flowIntensity });
    },
    runUiActionWithGroupLock: async (_key, _buttons, action) => action(),
    sceneButtons: overrides.sceneButtons || [],
    setTimeout(callback) {
      if (typeof callback === "function") callback();
      return 1;
    },
    clearTimeout() {}
  };
  vm.createContext(context);
  vm.runInContext(LIVE_SCENE_CODE, context, { filename: LIVE_SCENE_PATH });
  return { context, ui, el, badgeCalls, syncCalls };
}

function createSceneButton(scene) {
  return {
    dataset: { scene: String(scene || "") },
    onclick: null
  };
}

test("scene lock normalization collapses legacy aliases into canonical scene tokens", () => {
  const { context } = loadLiveSceneContext();

  assert.equal(context.normalizeLiveSceneLockUi("calm"), "steady");
  assert.equal(context.normalizeLiveSceneLockUi("groove"), "motion");
  assert.equal(context.normalizeLiveSceneLockUi("meta_auto"), "auto");
  assert.equal(context.normalizeLiveSceneLockUi("impact"), "impact");
  assert.equal(context.normalizeLiveSceneLockUi("unknown", "steady"), "steady");
});

test("scene snapshot load retries until a snapshot arrives", async () => {
  let calls = 0;
  const { context, ui, badgeCalls } = loadLiveSceneContext({
    liveEndpointsAdapter: {
      async getCompatibility() {
        calls += 1;
        if (calls < 3) return { ok: true, snapshot: null };
        return { ok: true, snapshot: { sceneLock: "groove" } };
      }
    }
  });

  const ok = await context.loadLiveSceneSnapshot({ attempts: 4, retryDelayMs: 1 });

  assert.equal(ok, true);
  assert.equal(calls, 3);
  assert.equal(ui.sceneLock, "motion");
  assert.equal(ui.brightnessPowerMode, "b");
  assert.equal(ui.flowIntensity, 1);
  assert.equal(badgeCalls.length, 0);
});

test("scene snapshot load warns after exhausting retries", async () => {
  const { context, badgeCalls } = loadLiveSceneContext({
    liveEndpointsAdapter: {
      async getCompatibility() {
        return { ok: false };
      }
    }
  });

  const ok = await context.loadLiveSceneSnapshot({ attempts: 3, retryDelayMs: 1, silent: false });

  assert.equal(ok, false);
  assert.equal(badgeCalls.at(-1)?.state, "warn");
  assert.equal(badgeCalls.at(-1)?.text, "LIVE SCENE SNAPSHOT DELAYED");
});

test("scene buttons normalize applied scene lock and announce success/failure badges", async () => {
  const sceneAuto = createSceneButton("auto");
  const sceneGroove = createSceneButton("groove");
  const patchCalls = [];
  const { context, ui, badgeCalls, syncCalls } = loadLiveSceneContext({
    ui: {
      sceneLock: "steady",
      brightnessPowerMode: "",
      flowIntensity: 0,
      metaAutoTempoTrackersAuto: false,
      metaAutoTempoTrackers: {},
      metaAutoTempoTrackersActive: {},
      metaAutoHueWizBaselineBlend: false,
      audioReactivityMap: {}
    },
    sceneButtons: [sceneAuto, sceneGroove],
    liveEndpointsAdapter: {
      async getCompatibility() {
        return { ok: true, snapshot: { sceneLock: "auto" } };
      },
      async patchSceneIntent(patch) {
        patchCalls.push(patch);
        if (patch.sceneLock === "groove") {
          return { ok: true, data: { ok: true, applied: { sceneLock: "motion" } } };
        }
        return { ok: false, data: { ok: false } };
      }
    }
  });

  context.wireLiveSceneControlsUi({
    maybeApplySmartLiveReactivityPolicy() {}
  });

  await sceneGroove.onclick();
  assert.equal(patchCalls[0]?.sceneLock, "groove");
  assert.equal(ui.sceneLock, "motion");
  assert.equal(badgeCalls.at(-1)?.state, "ok");
  assert.equal(badgeCalls.at(-1)?.text, "SCENE MOTION");

  await sceneAuto.onclick();
  assert.equal(ui.sceneLock, "motion");
  assert.equal(badgeCalls.at(-1)?.state, "bad");
  assert.equal(badgeCalls.at(-1)?.text, "SCENE CHANGE FAIL");
  assert.equal(syncCalls.length > 0, true);
});
