// [TITLE] Test Module: test/engine-v2.scene-runtime-controls.test.js
// [TITLE] Purpose: cover Engine v2 scene runtime control normalization helpers

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  extractLiveRuntimeControls,
  normalizeRuntimeTuning,
  normalizeSceneAggressiveness,
  normalizeSceneLock
} = require("../src/domains/engine-v2/engine.scene-runtime-controls");

test("engine-v2 scene runtime controls normalize legacy scene lock aliases", () => {
  assert.equal(normalizeSceneLock("idle"), "steady");
  assert.equal(normalizeSceneLock("scene_flow"), "motion");
  assert.equal(normalizeSceneLock("pulse"), "impact");
  assert.equal(normalizeSceneLock("unknown", "auto"), "auto");
});

test("engine-v2 scene runtime controls clamp runtime tuning ranges", () => {
  const tuning = normalizeRuntimeTuning({
    bpmSourceMode: "derived",
    brightnessFloor: 0.8,
    brightnessCeil: 0.2,
    transitionFloorMs: 6000,
    transitionCeilMs: 1000,
    telemetryBeatConfidenceMin: 2
  });

  assert.equal(tuning.bpmSourceMode, "derived");
  assert.equal(tuning.brightnessFloor, 0.8);
  assert.equal(tuning.brightnessCeil, 0.8);
  assert.equal(tuning.transitionFloorMs, 5000);
  assert.equal(tuning.transitionCeilMs, 5000);
  assert.equal(tuning.telemetryBeatConfidenceMin, 1);
});

test("engine-v2 scene runtime controls normalize scene aggressiveness filters", () => {
  assert.deepEqual(normalizeSceneAggressiveness({
    calm: 0,
    groove: 3,
    impact: 1.4
  }), {
    calm: 0.45,
    groove: 2.25,
    impact: 1.4
  });
});

test("engine-v2 scene runtime controls extract scoped brand and fixture overrides", () => {
  const controls = extractLiveRuntimeControls({
    profile: {
      payload: {
        compatibility: {
          sceneIntent: "scene_pulse"
        },
        triggerMatrix: {
          global: {
            sceneFilterAggressiveness: {
              calm: 0.75,
              groove: 1.5,
              impact: 2.1
            },
            runtimeTuning: {
              brightnessFloor: 0.1,
              brightnessCeil: 0.95
            }
          },
          brands: {
            hue: {
              runtimeTuning: {
                brightnessFloor: 0.25,
                brightnessCeil: 0.8
              }
            }
          },
          fixtureOverrides: {
            "hue-main-2": {
              brand: "hue",
              runtimeTuning: {
                brightnessFloor: 0.4,
                brightnessCeil: 0.5
              }
            }
          }
        }
      }
    }
  });

  assert.equal(controls.sceneLock, "impact");
  assert.equal(controls.sceneAggressiveness.groove, 1.5);
  assert.equal(controls.runtimeTuning.brightnessFloor, 0.1);
  assert.equal(controls.scopedRuntimeTuning.brands.hue.runtimeTuning.brightnessFloor, 0.25);
  assert.equal(controls.scopedRuntimeTuning.fixtureOverrides["hue-main-2"].runtimeTuning.brightnessCeil, 0.5);
});
