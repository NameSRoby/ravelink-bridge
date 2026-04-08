// [TITLE] Test Module: test/engine-v2.scheduler.test.js
// [TITLE] Purpose: verify deterministic scheduler, policy order, and intent scope precedence

const test = require("node:test");
const assert = require("node:assert/strict");

const createEnginePolicyRegistry = require("../src/domains/engine-v2/engine.policy-registry");
const createEngineIntentMapper = require("../src/domains/engine-v2/engine.intent-mapper");
const createEngineScheduler = require("../src/domains/engine-v2/engine.scheduler");

test("engine-v2 policy registry applies handlers in priority order", () => {
  const registry = createEnginePolicyRegistry({
    defaults: [
      {
        id: "a",
        priority: 200,
        apply(state) {
          return { ...state, trace: [...(state.trace || []), "a"] };
        }
      },
      {
        id: "b",
        priority: 100,
        apply(state) {
          return { ...state, trace: [...(state.trace || []), "b"] };
        }
      }
    ]
  });

  const result = registry.applyPolicies({ trace: [] }, {});
  assert.equal(result.ok, true);
  assert.deepEqual(result.applied, ["b", "a"]);
  assert.deepEqual(result.state.trace, ["b", "a"]);
});

test("engine-v2 intent mapper respects fixture > zone > brand > global precedence", () => {
  const mapper = createEngineIntentMapper({
    defaultIntent: {
      rgb: { r: 0, g: 0, b: 0 },
      brightness: 0,
      transitionMs: 200,
      owner: "safe_idle"
    }
  });
  const intents = mapper.mapIntents({
    fixtures: [
      { id: "hue-1", brand: "hue", zone: "front", enabled: true },
      { id: "hue-2", brand: "hue", zone: "back", enabled: true },
      { id: "wiz-1", brand: "wiz", zone: "front", enabled: true }
    ],
    routing: {
      global: {
        rgb: { r: 10, g: 20, b: 30 },
        brightness: 0.2,
        transitionMs: 1000,
        owner: "global"
      },
      brands: {
        hue: {
          rgb: { r: 100, g: 110, b: 120 },
          brightness: 0.4,
          owner: "brand_hue"
        }
      },
      zones: {
        front: {
          rgb: { r: 80, g: 160, b: 240 },
          brightness: 0.5,
          owner: "zone_front"
        },
        "hue:back": {
          rgb: { r: 40, g: 60, b: 90 },
          brightness: 0.35,
          owner: "zone_hue_back"
        }
      },
      fixtures: {
        "hue-1": {
          rgb: { r: 210, g: 220, b: 230 },
          brightness: 0.7,
          transitionMs: 300,
          owner: "fixture_hue_1"
        }
      }
    }
  });
  const byId = new Map(intents.map(row => [row.fixtureId, row]));
  assert.equal(byId.get("hue-1").owner, "fixture_hue_1");
  assert.equal(byId.get("hue-1").scope, "fixture");
  assert.equal(byId.get("hue-2").owner, "zone_hue_back");
  assert.equal(byId.get("hue-2").scope, "zone");
  assert.equal(byId.get("wiz-1").owner, "zone_front");
  assert.equal(byId.get("wiz-1").scope, "zone");
});

test("engine-v2 scheduler runTick executes deterministic stage pipeline", () => {
  let clock = 1000;
  const scheduler = createEngineScheduler({
    now: () => {
      clock += 5;
      return clock;
    },
    applyPolicies(sceneState) {
      return {
        ok: true,
        state: {
          ...sceneState,
          routing: {
            global: {
              rgb: { r: 255, g: 0, b: 0 },
              brightness: 0.6,
              transitionMs: 150,
              owner: "policy"
            }
          }
        },
        applied: ["profile_baseline"],
        errors: []
      };
    },
    mapIntents({ fixtures = [], routing = {} }) {
      return fixtures.map(fixture => ({
        fixtureId: fixture.id,
        brand: fixture.brand,
        rgb: routing.global.rgb,
        brightness: routing.global.brightness,
        transitionMs: routing.global.transitionMs,
        owner: routing.global.owner,
        scope: "global"
      }));
    },
    dispatchByBrand(intents = []) {
      return {
        sent: intents.length,
        failed: 0,
        dryRun: true
      };
    }
  });

  const result = scheduler.runTick({
    telemetry: { energy: 0.8, rms: 0.5, flux: 0.4, transient: 0.2 },
    fixtures: [{ id: "hue-1", brand: "hue", enabled: true }]
  }, { tickMs: 100, tickCount: 1 });

  assert.equal(result.ok, true);
  assert.equal(result.sceneState.sceneIntent, "impact");
  assert.equal(result.intents.length, 1);
  assert.equal(result.dispatch.sent, 1);
  assert.equal(result.projection.running, true);
});

test("engine-v2 intent mapper handles large fixture catalogs with per-fixture control", () => {
  const mapper = createEngineIntentMapper({
    defaultIntent: {
      rgb: { r: 0, g: 0, b: 0 },
      brightness: 0,
      transitionMs: 200,
      owner: "safe_idle"
    }
  });

  const fixtureCount = 500;
  const fixtures = Array.from({ length: fixtureCount }, (_row, index) => ({
    id: `fixture-${index + 1}`,
    brand: index % 2 === 0 ? "hue" : "wiz",
    zone: index % 3 === 0 ? "front" : "back",
    enabled: true
  }));
  const fixturesRouting = {};
  for (let index = 0; index < fixtureCount; index += 50) {
    fixturesRouting[`fixture-${index + 1}`] = {
      rgb: { r: 255, g: 255, b: 255 },
      brightness: 1,
      transitionMs: 120,
      owner: `fixture_override_${index + 1}`
    };
  }

  const intents = mapper.mapIntents({
    fixtures,
    routing: {
      global: {
        rgb: { r: 20, g: 30, b: 40 },
        brightness: 0.2,
        transitionMs: 1000,
        owner: "global"
      },
      brands: {
        hue: {
          rgb: { r: 40, g: 60, b: 80 },
          brightness: 0.4,
          owner: "brand_hue"
        },
        wiz: {
          rgb: { r: 70, g: 90, b: 120 },
          brightness: 0.45,
          owner: "brand_wiz"
        }
      },
      zones: {
        front: {
          rgb: { r: 90, g: 120, b: 150 },
          brightness: 0.5,
          owner: "zone_front"
        },
        back: {
          rgb: { r: 60, g: 80, b: 100 },
          brightness: 0.35,
          owner: "zone_back"
        }
      },
      fixtures: fixturesRouting
    }
  });

  assert.equal(intents.length, fixtureCount);
  const byId = new Map(intents.map(row => [row.fixtureId, row]));
  assert.equal(byId.get("fixture-1").owner, "fixture_override_1");
  assert.equal(byId.get("fixture-1").scope, "fixture");
  assert.equal(byId.get("fixture-2").owner, "zone_back");
  assert.equal(byId.get("fixture-2").scope, "zone");
  assert.equal(byId.get("fixture-3").owner, "zone_back");
  assert.equal(byId.get("fixture-3").scope, "zone");
});
