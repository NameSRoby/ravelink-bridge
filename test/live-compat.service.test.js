// [TITLE] Test Module: test/live-compat.service.test.js
// [TITLE] Purpose: verify live compatibility trigger-matrix runtime tuning persistence

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const createLiveCompatService = require("../src/domains/live/live-compat.service");

function makeTempPath(fileName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-live-compat-"));
  return path.join(dir, fileName);
}

test("live-compat trigger-matrix saves runtime tuning with clamp + mirror semantics", () => {
  const storePath = makeTempPath("compat.state.json");
  const service = createLiveCompatService({
    storePath
  });

  const patched = service.patchTriggerMatrix({
    override: {
      sceneFilterAggressiveness: {
        calm: 1.3,
        groove: 0.9,
        impact: 1.6
      },
      runtimeTuning: {
        bpmSourceMode: "derived",
        sceneSwitchCooldownMs: -25,
        impactHoldMs: 900,
        brightnessFloor: 0.18,
        brightnessCeil: 1.4,
        transitionFloorMs: 95,
        transitionCeilMs: 70,
        telemetryBeatConfidenceMin: 2
      }
    }
  });

  assert.equal(patched.ok, true);
  assert.equal(patched.global.runtimeTuning.bpmSourceMode, "derived");
  assert.equal(patched.global.runtimeTuning.sceneSwitchCooldownMs, 0);
  assert.equal(patched.global.runtimeTuning.impactHoldMs, 900);
  assert.equal(patched.global.runtimeTuning.brightnessFloor, 0.18);
  assert.equal(patched.global.runtimeTuning.brightnessCeil, 1);
  assert.equal(patched.global.runtimeTuning.transitionFloorMs, 95);
  assert.equal(patched.global.runtimeTuning.transitionCeilMs, 95);
  assert.equal(patched.global.runtimeTuning.telemetryBeatConfidenceMin, 1);
  assert.deepEqual(patched.manualGlobal.runtimeTuning, patched.global.runtimeTuning);
  assert.deepEqual(patched.config.runtimeTuning, patched.global.runtimeTuning);
  assert.deepEqual(patched.manualConfig.runtimeTuning, patched.global.runtimeTuning);

  const reloaded = createLiveCompatService({
    storePath
  });
  const snapshot = reloaded.getTriggerMatrix();
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.global.runtimeTuning.bpmSourceMode, "derived");
  assert.equal(snapshot.global.runtimeTuning.transitionCeilMs, 95);
});

test("live-compat trigger-matrix persists brand + fixture scoped runtime/filter overrides", () => {
  const storePath = makeTempPath("compat.scoped.state.json");
  const service = createLiveCompatService({
    storePath
  });

  const brandPatch = service.patchTriggerMatrix({
    scope: {
      level: "brand",
      brand: "hue"
    },
    override: {
      sceneFilterAggressiveness: {
        calm: 1.25,
        groove: 1.1,
        impact: 1.45
      },
      runtimeTuning: {
        brightnessFloor: 0.2,
        brightnessCeil: 0.9,
        transitionFloorMs: 120,
        transitionCeilMs: 420
      }
    }
  });
  assert.equal(brandPatch.ok, true);
  assert.equal(brandPatch.appliedScope.level, "brand");
  assert.equal(brandPatch.appliedScope.brand, "hue");
  assert.equal(brandPatch.brands.hue.runtimeTuning.brightnessFloor, 0.2);
  assert.equal(brandPatch.brands.hue.runtimeTuning.transitionCeilMs, 420);

  const fixturePatch = service.patchTriggerMatrix({
    scope: {
      level: "fixture",
      brand: "hue",
      fixtureId: "hue-main-1"
    },
    override: {
      runtimeTuning: {
        brightnessFloor: 0.3,
        brightnessCeil: 0.82,
        transitionFloorMs: 90,
        transitionCeilMs: 180
      }
    }
  });
  assert.equal(fixturePatch.ok, true);
  assert.equal(fixturePatch.appliedScope.level, "fixture");
  assert.equal(fixturePatch.appliedScope.fixtureId, "hue-main-1");
  assert.equal(fixturePatch.fixtureOverrides["hue-main-1"].brand, "hue");
  assert.equal(fixturePatch.fixtureOverrides["hue-main-1"].runtimeTuning.brightnessFloor, 0.3);
  assert.equal(fixturePatch.fixtureOverrides["hue-main-1"].runtimeTuning.brightnessCeil, 0.82);
  assert.equal(fixturePatch.fixtureOverrides["hue-main-1"].sceneFilterAggressiveness.calm, 1.25);

  const reloaded = createLiveCompatService({
    storePath
  });
  const snapshot = reloaded.getTriggerMatrix();
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.brands.hue.runtimeTuning.transitionFloorMs, 120);
  assert.equal(snapshot.fixtureOverrides["hue-main-1"].runtimeTuning.transitionCeilMs, 180);
});

test("live-compat sync-groups normalize duplicate ids/fixture assignments and persist", () => {
  const storePath = makeTempPath("compat.sync-groups.state.json");
  const service = createLiveCompatService({
    storePath
  });

  const patched = service.patchSyncGroups({
    enabled: true,
    groups: [
      {
        id: "Front Stage",
        name: "Front Stage",
        sequenceMode: "mirror",
        fixtureIds: ["hue-1", "wiz-1", "hue-1"]
      },
      {
        id: "front-stage",
        name: "Front Stage Duplicate",
        sequenceMode: "offset",
        phaseOffset: 999,
        fixtureIds: ["wiz-1", "wiz-2"]
      }
    ],
    fixtureEngine: {
      "hue-1": {
        excluded: true,
        removeBehavior: "restore"
      },
      "wiz-2": {
        excluded: 1,
        removeBehavior: "keep"
      },
      "hue-3": {
        excluded: true,
        removeBehavior: "custom_state",
        customFallback: {
          mode: "cct",
          cct: 5100,
          brightness: 67
        }
      }
    }
  });
  assert.equal(patched.ok, true);
  assert.equal(patched.snapshot.enabled, true);
  assert.equal(Array.isArray(patched.snapshot.groups), true);
  assert.equal(patched.snapshot.groups.length, 2);
  assert.equal(patched.snapshot.groups[0].id, "front-stage");
  assert.equal(patched.snapshot.groups[0].sequenceMode, "reverse");
  assert.deepEqual(patched.snapshot.groups[0].fixtureIds, ["hue-1", "wiz-1"]);
  assert.equal(patched.snapshot.groups[1].id, "front-stage-2");
  assert.equal(patched.snapshot.groups[1].sequenceMode, "offset");
  assert.equal(patched.snapshot.groups[1].phaseOffset, 64);
  assert.deepEqual(patched.snapshot.groups[1].fixtureIds, ["wiz-2"]);
  assert.equal(patched.snapshot.fixtureEngine["hue-1"].excluded, true);
  assert.equal(patched.snapshot.fixtureEngine["hue-1"].removeBehavior, "keep_current");
  assert.equal(patched.snapshot.fixtureEngine["wiz-2"].excluded, true);
  assert.equal(patched.snapshot.fixtureEngine["wiz-2"].removeBehavior, "keep_current");
  assert.equal(patched.snapshot.fixtureEngine["hue-3"].removeBehavior, "custom_state");
  assert.equal(patched.snapshot.fixtureEngine["hue-3"].customFallback.mode, "cct");
  assert.equal(patched.snapshot.fixtureEngine["hue-3"].customFallback.cct, 5100);
  assert.equal(patched.snapshot.fixtureEngine["hue-3"].customFallback.brightness, 67);

  const viaTriggerMatrix = service.patchTriggerMatrix({
    scope: { level: "global" },
    syncGroups: {
      enabled: false
    }
  });
  assert.equal(viaTriggerMatrix.ok, true);
  assert.equal(viaTriggerMatrix.syncGroups.enabled, false);
  assert.equal(viaTriggerMatrix.syncGroups.groups.length, 2);

  const reloaded = createLiveCompatService({
    storePath
  });
  const snapshot = reloaded.getSyncGroups();
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.snapshot.enabled, false);
  assert.equal(snapshot.snapshot.groups.length, 2);
  assert.equal(snapshot.snapshot.groups[0].sequenceMode, "reverse");
  assert.equal(snapshot.snapshot.groups[1].phaseOffset, 64);
  assert.equal(snapshot.snapshot.fixtureEngine["hue-1"].removeBehavior, "keep_current");
  assert.equal(snapshot.snapshot.fixtureEngine["hue-3"].customFallback.mode, "cct");
});

test("live-compat service migrates legacy runtime tuning defaults at load", () => {
  const storePath = makeTempPath("compat.legacy-migration.state.json");
  fs.writeFileSync(storePath, JSON.stringify({
    compatibility: {
      sceneLock: "auto",
      sceneIntent: "auto",
      updatedAt: 1
    },
    triggerMatrix: {
      global: {
        sceneFilterAggressiveness: {
          calm: 1,
          groove: 1,
          impact: 1
        },
        runtimeTuning: {
          bpmSourceMode: "hybrid",
          sceneSwitchCooldownMs: 650,
          impactHoldMs: 220,
          brightnessFloor: 0.03,
          brightnessCeil: 1,
          transitionFloorMs: 70,
          transitionCeilMs: 280,
          telemetryBeatConfidenceMin: 0.45,
          derivedBeatMinIntervalMs: 120,
          derivedBeatMaxIntervalMs: 1600
        }
      },
      manualGlobal: {},
      config: {},
      manualConfig: {},
      brands: {},
      fixtureOverrides: {},
      updatedAt: 1
    },
    palette: {
      config: {},
      brands: {},
      fixtureOverrides: {},
      updatedAt: 0
    },
    fixtureMetrics: {
      config: {},
      brands: {},
      fixtureOverrides: {},
      updatedAt: 0
    },
    overclock: {
      autoEnabled: true,
      level: 2,
      devHz: 0,
      updatedAt: 0
    }
  }, null, 2));

  const service = createLiveCompatService({
    storePath
  });
  const matrix = service.getTriggerMatrix();
  assert.equal(matrix.ok, true);
  assert.equal(matrix.global.runtimeTuning.sceneSwitchCooldownMs, 260);
  assert.equal(matrix.global.runtimeTuning.impactHoldMs, 140);
  assert.equal(matrix.global.runtimeTuning.brightnessFloor, 0.02);
  assert.equal(matrix.global.runtimeTuning.transitionFloorMs, 32);
  assert.equal(matrix.global.runtimeTuning.transitionCeilMs, 190);
  assert.equal(matrix.global.runtimeTuning.telemetryBeatConfidenceMin, 0.34);
});

test("live-compat service migrates pre-reactive runtime tuning defaults at load", () => {
  const storePath = makeTempPath("compat.pre-reactive-migration.state.json");
  fs.writeFileSync(storePath, JSON.stringify({
    compatibility: {
      sceneLock: "auto",
      sceneIntent: "auto",
      updatedAt: 1
    },
    triggerMatrix: {
      global: {
        sceneFilterAggressiveness: {
          calm: 1,
          groove: 1,
          impact: 1
        },
        runtimeTuning: {
          bpmSourceMode: "hybrid",
          sceneSwitchCooldownMs: 260,
          impactHoldMs: 140,
          brightnessFloor: 0.02,
          brightnessCeil: 1,
          transitionFloorMs: 45,
          transitionCeilMs: 240,
          telemetryBeatConfidenceMin: 0.34,
          derivedBeatMinIntervalMs: 120,
          derivedBeatMaxIntervalMs: 1600
        }
      },
      manualGlobal: {},
      config: {},
      manualConfig: {},
      brands: {},
      fixtureOverrides: {},
      updatedAt: 1
    },
    palette: {
      config: {},
      brands: {},
      fixtureOverrides: {},
      updatedAt: 0
    },
    fixtureMetrics: {
      config: {},
      brands: {},
      fixtureOverrides: {},
      updatedAt: 0
    },
    overclock: {
      autoEnabled: false,
      level: 2,
      devHz: 0,
      updatedAt: 0
    }
  }, null, 2));

  const service = createLiveCompatService({
    storePath
  });
  const matrix = service.getTriggerMatrix();
  assert.equal(matrix.ok, true);
  assert.equal(matrix.global.runtimeTuning.transitionFloorMs, 32);
  assert.equal(matrix.global.runtimeTuning.transitionCeilMs, 190);
  assert.equal(matrix.global.runtimeTuning.sceneSwitchCooldownMs, 260);
  assert.equal(matrix.global.runtimeTuning.impactHoldMs, 140);
});
