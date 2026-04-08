// [TITLE] Purpose: verify engine-v2 fixture exclusion helper state capture and remove-action behavior

const test = require("node:test");
const assert = require("node:assert/strict");

const createEngineRuntimeFixtureExclusions = require("../src/domains/engine-v2/engine.runtime.fixture-exclusions");

function createFixtureExclusionHelper(overrides = {}) {
  const fixtureIntentSmoothingState = overrides.fixtureIntentSmoothingState || new Map();
  const fixtureLastEngineStateById = overrides.fixtureLastEngineStateById || new Map();
  const fixtureBaselineStateById = overrides.fixtureBaselineStateById || new Map();
  const hueCalls = [];
  const wizCalls = [];
  const helper = createEngineRuntimeFixtureExclusions({
    now: overrides.now || (() => 1234),
    clampNumber(value, min, max, fallback) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.max(min, Math.min(max, parsed));
    },
    WIZ_DIMMING_MIN: 10,
    WIZ_DIMMING_MAX: 100,
    SYNC_GROUP_DEFAULT_REMOVE_BEHAVIOR: "keep_current",
    SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT: {
      mode: "hex",
      hex: "#ffffff",
      cct: 4000,
      brightness: 100
    },
    normalizeSyncGroupRemoveBehaviorRuntime: overrides.normalizeSyncGroupRemoveBehaviorRuntime || ((value, fallback = "keep_current") => {
      const token = String(value || "").trim().toLowerCase();
      if (token === "restore") return "keep_current";
      if (token === "custom" || token === "custom_state") return "custom_state";
      if (token === "blackout") return "blackout";
      return fallback;
    }),
    normalizeSyncGroupCustomFallbackRuntime: overrides.normalizeSyncGroupCustomFallbackRuntime || ((value, fallback) => ({
      ...fallback,
      ...(value && typeof value === "object" ? value : {})
    })),
    mapEngineBrightnessToHueBri: overrides.mapEngineBrightnessToHueBri || (value => Math.max(1, Math.round(Number(value) * 254))),
    createHueStateFromRgb: overrides.createHueStateFromRgb || ((rgb, options = {}) => ({ on: true, bri: options.brightness, transitiontime: options.transitiontime, __rgb: { ...rgb } })),
    createWizStateFromRgb: overrides.createWizStateFromRgb || ((rgb, options = {}) => ({ on: true, r: rgb.r, g: rgb.g, b: rgb.b, dimming: options.dimming })),
    hexToRgb: overrides.hexToRgb || (hex => {
      const safe = String(hex || "").replace(/^#/, "");
      if (!/^[0-9a-f]{6}$/i.test(safe)) return null;
      return {
        r: parseInt(safe.slice(0, 2), 16),
        g: parseInt(safe.slice(2, 4), 16),
        b: parseInt(safe.slice(4, 6), 16)
      };
    }),
    buildHueDispatchStateKey: state => JSON.stringify(state),
    buildWizDispatchStateKey: state => JSON.stringify(state),
    hueBridge: {
      sendState(fixtures, state) {
        hueCalls.push({
          fixtures: Array.isArray(fixtures) ? fixtures.map(row => row.id) : [],
          state
        });
        return Promise.resolve({ sent: fixtures.length, failed: 0, dryRun: false });
      }
    },
    wizBridge: {
      sendState(fixtures, state) {
        wizCalls.push({
          fixtures: Array.isArray(fixtures) ? fixtures.map(row => row.id) : [],
          state
        });
        return { sent: fixtures.length, failed: 0, dryRun: false };
      }
    },
    fixtureIntentSmoothingState,
    fixtureLastEngineStateById,
    fixtureBaselineStateById,
    consoleRef: { warn() {} }
  });
  return {
    helper,
    fixtureIntentSmoothingState,
    fixtureLastEngineStateById,
    fixtureBaselineStateById,
    hueCalls,
    wizCalls
  };
}

test("engine-v2 fixture exclusion helper remembers fixture engine state snapshots once per baseline", () => {
  const { helper, fixtureLastEngineStateById, fixtureBaselineStateById } = createFixtureExclusionHelper();

  helper.rememberFixtureEngineStateRuntime("hue-main", "hue", {
    on: true,
    bri: 200,
    transitiontime: 2,
    xy: [0.4, 0.5],
    __rgb: { r: 12, g: 34, b: 56 }
  });
  helper.rememberFixtureEngineStateRuntime("hue-main", "hue", {
    on: true,
    bri: 150,
    transitiontime: 1,
    xy: [0.2, 0.3]
  });

  assert.equal(fixtureLastEngineStateById.get("hue-main")?.state?.bri, 150);
  assert.equal(fixtureBaselineStateById.get("hue-main")?.state?.bri, 200);
  assert.deepEqual(fixtureBaselineStateById.get("hue-main")?.state?.__rgb, { r: 12, g: 34, b: 56 });
});

test("engine-v2 fixture exclusion helper resolves blackout and custom remove states deterministically", () => {
  const { helper } = createFixtureExclusionHelper();

  const hueBlackout = helper.resolveFixtureRemovalStateRuntime("hue-a", { id: "hue-a", brand: "hue" }, "blackout");
  const wizCustom = helper.resolveFixtureRemovalStateRuntime("wiz-b", { id: "wiz-b", brand: "wiz" }, "custom_state", {
    mode: "cct",
    cct: 4900,
    brightness: 15
  });
  const hueCustom = helper.resolveFixtureRemovalStateRuntime("hue-b", { id: "hue-b", brand: "hue" }, "custom_state", {
    mode: "hex",
    hex: "#ff4010",
    brightness: 35
  });

  assert.equal(hueBlackout.on, false);
  assert.equal(hueBlackout.bri, 1);
  assert.equal(wizCustom.temp, 4900);
  assert.equal(wizCustom.dimming, 15);
  assert.equal(hueCustom.on, true);
  assert.equal(hueCustom.__rgb.r, 255);
  assert.equal(hueCustom.__rgb.g, 64);
  assert.equal(hueCustom.__rgb.b, 16);
});

test("engine-v2 fixture exclusion helper reconciles new exclusions once and clears smoothing state", async () => {
  const fixtureIntentSmoothingState = new Map([
    ["hue-a", { brightness: 0.4 }],
    ["wiz-b", { brightness: 0.7 }]
  ]);
  const { helper, hueCalls, wizCalls } = createFixtureExclusionHelper({
    fixtureIntentSmoothingState
  });

  helper.reconcileExcludedFixtureControlsRuntime(new Map([
    ["hue-a", {
      fixture: { id: "hue-a", brand: "hue" },
      removeBehavior: "blackout"
    }],
    ["wiz-b", {
      fixture: { id: "wiz-b", brand: "wiz" },
      removeBehavior: "custom_state",
      customFallback: { mode: "cct", cct: 5100, brightness: 22 }
    }]
  ]));
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(fixtureIntentSmoothingState.has("hue-a"), false);
  assert.equal(fixtureIntentSmoothingState.has("wiz-b"), false);
  assert.equal(hueCalls.length, 1);
  assert.deepEqual(hueCalls[0].fixtures, ["hue-a"]);
  assert.equal(hueCalls[0].state.on, false);
  assert.equal(wizCalls.length, 1);
  assert.deepEqual(wizCalls[0].fixtures, ["wiz-b"]);
  assert.equal(wizCalls[0].state.temp, 5100);

  helper.reconcileExcludedFixtureControlsRuntime(new Map([
    ["hue-a", {
      fixture: { id: "hue-a", brand: "hue" },
      removeBehavior: "blackout"
    }]
  ]));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(hueCalls.length, 1);
});
