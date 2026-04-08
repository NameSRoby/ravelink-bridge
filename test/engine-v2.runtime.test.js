// [TITLE] Test Module: test/engine-v2.runtime.test.js
// [TITLE] Purpose: verify Engine v2 runtime lifecycle/status/tick behavior

const test = require("node:test");
const assert = require("node:assert/strict");

const createEngineV2Runtime = require("../src/domains/engine-v2/engine.runtime");

function createFixtureRegistryStub(fixtures = []) {
  let calls = 0;
  return {
    listEngineBy() {
      calls += 1;
      return fixtures.map(item => ({ ...item }));
    },
    getListCalls() {
      return calls;
    }
  };
}

function createPaletteServiceStub(rgb = { r: 255, g: 255, b: 255 }) {
  return {
    consumeTickFrame() {
      return {
        index: 0,
        token: "stub",
        name: "stub",
        hex: "#ffffff",
        rgb: { ...rgb },
        source: "stub",
        count: 1,
        holdTicks: 1
      };
    },
    getSnapshot() {
      return {
        version: 1,
        sequence: ["stub"],
        resolvedSequence: [],
        activeIndex: 0,
        holdTicks: 1,
        current: {
          index: 0,
          token: "stub",
          name: "stub",
          hex: "#ffffff",
          rgb: { ...rgb },
          source: "stub"
        },
        colorCount: 1
      };
    }
  };
}

test("engine-v2 runtime manual tick updates status and projection deterministically", () => {
  let tickNow = 1000;
  const runtime = createEngineV2Runtime({
    now: () => {
      tickNow += 10;
      return tickNow;
    },
    audioEngine: {
      getTelemetry() {
        return {
          energy: 0.6,
          rms: 0.4,
          flux: 0.3,
          transient: 0.2,
          bpm: 120,
          beatConfidence: 0.7
        };
      }
    },
    fixtureRegistry: createFixtureRegistryStub([
      { id: "hue-1", brand: "hue", zone: "hue", enabled: true, bridgeIp: "x", username: "u", lightId: 1 }
    ]),
    paletteService: createPaletteServiceStub({ r: 120, g: 20, b: 80 }),
    liveProfileService: {
      listProfiles() {
        return [{ name: "default" }];
      }
    },
    hueBridge: {
      sendState() {
        return { sent: 1, failed: 0, dryRun: true };
      }
    },
    wizBridge: {
      sendState() {
        return { sent: 0, failed: 0, dryRun: true };
      }
    },
    tickMs: 100,
    setInterval() {
      return { fake: true };
    },
    clearInterval() {}
  });

  const tick = runtime.tick({ reason: "unit_test" });
  assert.equal(tick.ok, true);
  const status = runtime.getStatus();
  assert.equal(status.tickCount, 1);
  assert.equal(status.lastTickAt > 0, true);
  const projection = runtime.getTelemetryProjection();
  assert.equal(projection.engineTelemetryVersion, 1);
  assert.equal(projection.dispatch.sent, 1);
});

test("engine-v2 runtime enforces twitch-highest override and hardware dispatch caps", () => {
  let nowMs = 1000;
  const wizStates = [];
  const runtime = createEngineV2Runtime({
    now: () => {
      nowMs += 10;
      return nowMs;
    },
    audioEngine: {
      getTelemetry() {
        return {
          energy: 0.2,
          rms: 0.1,
          flux: 0.1,
          transient: 0.1
        };
      }
    },
    fixtureRegistry: createFixtureRegistryStub([
      { id: "wiz-1", brand: "wiz", zone: "wiz", enabled: true, ip: "192.168.1.50" }
    ]),
    paletteService: createPaletteServiceStub({ r: 0, g: 0, b: 255 }),
    liveProfileService: {
      listProfiles() {
        return [];
      }
    },
    wizBridge: {
      sendState(_fixtures, state) {
        wizStates.push({ ...state });
        return { sent: 1, failed: 0, dryRun: true };
      }
    },
    hardwareLimits: {
      hueMaxHz: 10,
      wizMaxHz: 1
    },
    tickMs: 100,
    setInterval() {
      return { fake: true };
    },
    clearInterval() {}
  });

  runtime.queueControlEvent({
    owner: "twitch",
    type: "set_color",
    payload: {
      hex: "#00ff00",
      brightness: 1
    }
  });
  const first = runtime.tick({ reason: "first" });
  assert.equal(first.ok, true);
  assert.equal(wizStates.length, 1);
  assert.equal(wizStates[0].r, 0);
  assert.equal(wizStates[0].g, 255);
  assert.equal(wizStates[0].b, 0);
  assert.equal(wizStates[0].dimming, 100);

  runtime.tick({ reason: "second" });
  const projection = runtime.getTelemetryProjection();
  assert.equal(projection.dispatch.skippedWiz, 1);
});

test("engine-v2 runtime maps low WiZ brightness above protocol floor with visible range", () => {
  let nowMs = 2000;
  const wizStates = [];
  const runtime = createEngineV2Runtime({
    now: () => {
      nowMs += 200;
      return nowMs;
    },
    audioEngine: {
      getTelemetry() {
        return {
          energy: 0.2,
          rms: 0.1,
          flux: 0.12,
          transient: 0.08
        };
      }
    },
    fixtureRegistry: createFixtureRegistryStub([
      { id: "wiz-1", brand: "wiz", zone: "wiz", enabled: true, ip: "192.168.1.50" }
    ]),
    paletteService: createPaletteServiceStub({ r: 30, g: 120, b: 255 }),
    liveProfileService: {
      listProfiles() {
        return [];
      }
    },
    wizBridge: {
      sendState(_fixtures, state) {
        wizStates.push({ ...state });
        return { sent: 1, failed: 0, dryRun: true };
      }
    },
    tickMs: 100,
    setInterval() {
      return { fake: true };
    },
    clearInterval() {}
  });

  runtime.queueControlEvent({
    owner: "twitch",
    type: "set_color",
    payload: {
      rgb: { r: 30, g: 120, b: 255 },
      brightness: 0.1
    }
  });

  const result = runtime.tick({ reason: "wiz_low_brightness_mapping" });
  assert.equal(result.ok, true);
  assert.equal(wizStates.length, 1);
  assert.equal(wizStates[0].r, 30);
  assert.equal(wizStates[0].g, 120);
  assert.equal(wizStates[0].b, 255);
  assert.equal(wizStates[0].dimming > 10, true);
  assert.equal(wizStates[0].dimming < 30, true);
});

test("engine-v2 runtime keeps Hue RGB identity exact when only brightness changes", () => {
  let nowMs = 2600;
  const hueStates = [];
  const runtime = createEngineV2Runtime({
    now: () => {
      nowMs += 200;
      return nowMs;
    },
    audioEngine: {
      getTelemetry() {
        return {
          energy: 0.22,
          rms: 0.12,
          flux: 0.1,
          transient: 0.08
        };
      }
    },
    fixtureRegistry: createFixtureRegistryStub([
      { id: "hue-1", brand: "hue", zone: "hue", enabled: true, bridgeIp: "x", username: "u", lightId: 1 }
    ]),
    paletteService: createPaletteServiceStub({ r: 20, g: 180, b: 60 }),
    liveProfileService: {
      listProfiles() {
        return [];
      }
    },
    hueBridge: {
      sendState(_fixtures, state) {
        hueStates.push({ ...state, __rgb: { ...(state.__rgb || {}) } });
        return { sent: 1, failed: 0, dryRun: true };
      }
    },
    tickMs: 100,
    setInterval() {
      return { fake: true };
    },
    clearInterval() {}
  });

  runtime.queueControlEvent({
    owner: "twitch",
    type: "set_color",
    payload: {
      rgb: { r: 20, g: 180, b: 60 },
      brightness: 0.2
    }
  });
  runtime.tick({ reason: "hue_color_identity_low_brightness" });

  runtime.queueControlEvent({
    owner: "twitch",
    type: "set_color",
    payload: {
      rgb: { r: 20, g: 180, b: 60 },
      brightness: 0.9
    }
  });
  runtime.tick({ reason: "hue_color_identity_high_brightness" });

  assert.equal(hueStates.length >= 1, true);
  const last = hueStates[hueStates.length - 1];
  assert.equal(last.__rgb?.r, 20);
  assert.equal(last.__rgb?.g, 180);
  assert.equal(last.__rgb?.b, 60);
});

test("engine-v2 runtime start/stop lifecycle is deterministic", () => {
  let clock = 5000;
  let intervalCalls = 0;
  let clearCalls = 0;
  const handles = [];
  const runtime = createEngineV2Runtime({
    now: () => {
      clock += 5;
      return clock;
    },
    audioEngine: {
      getTelemetry() {
        return {};
      }
    },
    fixtureRegistry: createFixtureRegistryStub([]),
    liveProfileService: {
      listProfiles() {
        return [];
      }
    },
    setInterval(handler, _ms) {
      intervalCalls += 1;
      handles.push(handler);
      return { id: intervalCalls };
    },
    clearInterval() {
      clearCalls += 1;
    }
  });

  const started = runtime.start({ requestedBy: "unit" });
  assert.equal(started.ok, true);
  assert.equal(started.alreadyRunning, false);
  assert.equal(runtime.getStatus().running, true);
  assert.equal(intervalCalls, 1);

  const startedAgain = runtime.start({ requestedBy: "unit" });
  assert.equal(startedAgain.alreadyRunning, true);

  const stopped = runtime.stop({ requestedBy: "unit" });
  assert.equal(stopped.ok, true);
  assert.equal(stopped.wasRunning, true);
  assert.equal(runtime.getStatus().running, false);
  assert.equal(clearCalls, 1);
});

test("engine-v2 runtime uses one fixture snapshot per tick for dispatch + mapping", () => {
  let nowMs = 1000;
  const fixtureRegistry = createFixtureRegistryStub([
    { id: "hue-1", brand: "hue", zone: "main", enabled: true, bridgeIp: "x", username: "u", lightId: 1 },
    { id: "wiz-1", brand: "wiz", zone: "back", enabled: true, ip: "192.168.1.60" }
  ]);
  const runtime = createEngineV2Runtime({
    now: () => {
      nowMs += 220;
      return nowMs;
    },
    audioEngine: {
      getTelemetry() {
        return {};
      }
    },
    fixtureRegistry,
    paletteService: createPaletteServiceStub({ r: 200, g: 80, b: 20 }),
    liveProfileService: {
      listProfiles() {
        return [];
      }
    },
    hueBridge: {
      sendState() {
        return { sent: 1, failed: 0, dryRun: true };
      }
    },
    wizBridge: {
      sendState() {
        return { sent: 1, failed: 0, dryRun: true };
      }
    },
    tickMs: 100,
    setInterval() {
      return { fake: true };
    },
    clearInterval() {}
  });

  runtime.tick({ reason: "scale_snapshot_check_1" });
  runtime.tick({ reason: "scale_snapshot_check_2" });

  assert.equal(fixtureRegistry.getListCalls(), 2);
});

test("engine-v2 runtime dispatches large fixture catalogs without hard fixture-count caps", () => {
  let nowMs = 2000;
  const fixtureCount = 1200;
  const dispatchedFixtureIds = [];
  const fixtureRegistry = createFixtureRegistryStub(
    Array.from({ length: fixtureCount }, (_row, index) => ({
      id: `hue-${index + 1}`,
      brand: "hue",
      zone: index % 2 === 0 ? "front" : "back",
      enabled: true,
      bridgeIp: "127.0.0.1",
      username: "user",
      lightId: index + 1
    }))
  );
  const runtime = createEngineV2Runtime({
    now: () => {
      nowMs += 10;
      return nowMs;
    },
    audioEngine: {
      getTelemetry() {
        return {
          energy: 0.5,
          transient: 0.2
        };
      }
    },
    fixtureRegistry,
    paletteService: createPaletteServiceStub({ r: 10, g: 100, b: 220 }),
    liveProfileService: {
      listProfiles() {
        return [];
      }
    },
    hueBridge: {
      sendState(fixtures) {
        const rows = Array.isArray(fixtures) ? fixtures : [];
        for (const row of rows) {
          dispatchedFixtureIds.push(String(row?.id || ""));
        }
        return { sent: rows.length, failed: 0, dryRun: true };
      }
    },
    tickMs: 100,
    setInterval() {
      return { fake: true };
    },
    clearInterval() {}
  });

  const result = runtime.tick({ reason: "large_fixture_catalog" });
  assert.equal(result.ok, true);
  assert.equal(dispatchedFixtureIds.length, fixtureCount);
  assert.equal(dispatchedFixtureIds[0], "hue-1");
  assert.equal(dispatchedFixtureIds[fixtureCount - 1], `hue-${fixtureCount}`);
});

test("engine-v2 runtime reads live compatibility scene lock and applies scene-owned routing", () => {
  let nowMs = 4000;
  const runtime = createEngineV2Runtime({
    now: () => {
      nowMs += 10;
      return nowMs;
    },
    audioEngine: {
      getTelemetry() {
        return {
          energy: 0.08,
          rms: 0.06,
          flux: 0.04,
          transient: 0.03,
          bpm: 0,
          beatConfidence: 0
        };
      }
    },
    fixtureRegistry: createFixtureRegistryStub([
      { id: "wiz-1", brand: "wiz", zone: "desk", enabled: true, ip: "192.168.1.50" }
    ]),
    paletteService: createPaletteServiceStub({ r: 33, g: 99, b: 201 }),
    liveProfileService: {
      listProfiles() {
        return [{ name: "default" }];
      }
    },
    liveCompatService: {
      getCompatibility() {
        return {
          ok: true,
          snapshot: {
            sceneLock: "motion"
          }
        };
      },
      getTriggerMatrix() {
        return {
          ok: true,
          global: {
            sceneFilterAggressiveness: {
              calm: 1,
              groove: 1,
              impact: 1
            }
          }
        };
      },
      getOverclockTiers() {
        return { ok: true, tiers: [], activeLevel: 2, autoEnabled: false, devHz: 0 };
      }
    },
    wizBridge: {
      sendState() {
        return { sent: 1, failed: 0, dryRun: true };
      }
    },
    tickMs: 100,
    setInterval() {
      return { fake: true };
    },
    clearInterval() {}
  });

  runtime.tick({ reason: "scene_lock_motion" });
  const projection = runtime.getTelemetryProjection();
  assert.equal(projection.scene.sceneLock, "motion");
  assert.equal(projection.scene.sceneIntent, "motion");
  assert.equal(projection.scene.brightness > 0, true);
});

test("engine-v2 runtime applies scoped runtime tuning clamps per brand and fixture", async () => {
  let nowMs = 6000;
  const hueBatches = [];
  const runtime = createEngineV2Runtime({
    now: () => {
      nowMs += 10;
      return nowMs;
    },
    audioEngine: {
      getTelemetry() {
        return {
          energy: 0.8,
          rms: 0.72,
          flux: 0.42,
          transient: 0.38,
          bpm: 126,
          beatConfidence: 0.9
        };
      }
    },
    fixtureRegistry: createFixtureRegistryStub([
      { id: "hue-a", brand: "hue", zone: "front", enabled: true, bridgeIp: "x", username: "u", lightId: 1 },
      { id: "hue-b", brand: "hue", zone: "front", enabled: true, bridgeIp: "x", username: "u", lightId: 2 }
    ]),
    paletteService: createPaletteServiceStub({ r: 64, g: 130, b: 255 }),
    liveProfileService: {
      listProfiles() {
        return [{ name: "default" }];
      }
    },
    liveCompatService: {
      getCompatibility() {
        return {
          ok: true,
          snapshot: {
            sceneLock: "auto"
          }
        };
      },
      getTriggerMatrix() {
        return {
          ok: true,
          global: {
            sceneFilterAggressiveness: {
              calm: 1,
              groove: 1,
              impact: 1
            },
            runtimeTuning: {
              brightnessFloor: 0.03,
              brightnessCeil: 1,
              transitionFloorMs: 70,
              transitionCeilMs: 280
            }
          },
          brands: {
            hue: {
              brand: "hue",
              runtimeTuning: {
                brightnessFloor: 0.2,
                brightnessCeil: 0.6,
                transitionFloorMs: 120,
                transitionCeilMs: 300
              }
            }
          },
          fixtureOverrides: {
            "hue-b": {
              brand: "hue",
              fixtureId: "hue-b",
              runtimeTuning: {
                brightnessFloor: 0.35,
                brightnessCeil: 0.45,
                transitionFloorMs: 90,
                transitionCeilMs: 140
              }
            }
          }
        };
      },
      getOverclockTiers() {
        return { ok: true, tiers: [], activeLevel: 2, autoEnabled: false, devHz: 0 };
      }
    },
    hueBridge: {
      sendState(fixtures, state) {
        const rows = Array.isArray(fixtures) ? fixtures : [];
        hueBatches.push({
          fixtures: rows.map(row => String(row?.id || "")),
          state: { ...state }
        });
        return { sent: rows.length, failed: 0, dryRun: true };
      }
    },
    tickMs: 100,
    setInterval() {
      return { fake: true };
    },
    clearInterval() {}
  });

  for (let i = 0; i < 6; i += 1) {
    runtime.tick({ reason: `scoped_runtime_tuning_${i + 1}` });
  }
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(hueBatches.length > 0, true);
  const hueABatches = hueBatches.filter(batch => batch.fixtures.includes("hue-a"));
  const hueBBatches = hueBatches.filter(batch => batch.fixtures.includes("hue-b"));
  assert.equal(hueABatches.length > 0, true);
  assert.equal(hueBBatches.length > 0, true);

  const hueAState = hueABatches[hueABatches.length - 1]?.state || {};
  const hueBState = hueBBatches[hueBBatches.length - 1]?.state || {};
  const hueABrightness = Number(hueAState?.bri || 0) / 254;
  const hueBBrightness = Number(hueBState?.bri || 0) / 254;
  const hueATransitionMs = Number(hueAState?.transitiontime || 0) * 100;
  const hueBTransitionMs = Number(hueBState?.transitiontime || 0) * 100;

  assert.equal(hueABrightness >= 0.2 && hueABrightness <= 0.6, true);
  assert.equal(hueBBrightness >= 0.35 && hueBBrightness <= 0.45, true);
  assert.equal(hueATransitionMs >= 100 && hueATransitionMs <= 300, true);
  assert.equal(hueBTransitionMs >= 90 && hueBTransitionMs <= 200, true);
});

test("engine-v2 runtime applies live sync-group palette routing deterministically per fixture", async () => {
  let nowMs = 9000;
  const hueBatches = [];
  const paletteRows = [
    { index: 0, token: "red", name: "red", hex: "#ff0000", rgb: { r: 255, g: 0, b: 0 }, source: "test" },
    { index: 1, token: "green", name: "green", hex: "#00ff00", rgb: { r: 0, g: 255, b: 0 }, source: "test" },
    { index: 2, token: "blue", name: "blue", hex: "#0000ff", rgb: { r: 0, g: 0, b: 255 }, source: "test" }
  ];
  const runtime = createEngineV2Runtime({
    now: () => {
      nowMs += 120;
      return nowMs;
    },
    audioEngine: {
      getTelemetry() {
        return {
          energy: 0.52,
          rms: 0.44,
          flux: 0.16,
          transient: 0.2,
          beat: true,
          beatPulse: true,
          beatConfidence: 0.66,
          bpm: 124
        };
      }
    },
    fixtureRegistry: createFixtureRegistryStub([
      { id: "hue-a", brand: "hue", zone: "front", enabled: true, bridgeIp: "x", username: "u", lightId: 1 },
      { id: "hue-b", brand: "hue", zone: "front", enabled: true, bridgeIp: "x", username: "u", lightId: 2 }
    ]),
    paletteService: {
      consumeTickFrame() {
        return {
          index: 0,
          token: paletteRows[0].token,
          name: paletteRows[0].name,
          hex: paletteRows[0].hex,
          rgb: { ...paletteRows[0].rgb },
          source: "test",
          count: paletteRows.length,
          holdTicks: 1
        };
      },
      getSnapshot() {
        return {
          version: 1,
          customColors: {},
          sequence: paletteRows.map(row => row.token),
          resolvedSequence: paletteRows.map(row => ({ ...row, rgb: { ...row.rgb } })),
          activeIndex: 0,
          holdTicks: 1,
          current: { ...paletteRows[0], rgb: { ...paletteRows[0].rgb } },
          colorCount: paletteRows.length
        };
      }
    },
    liveProfileService: {
      listProfiles() {
        return [{ name: "default" }];
      }
    },
    liveCompatService: {
      getCompatibility() {
        return {
          ok: true,
          snapshot: {
            sceneLock: "auto"
          }
        };
      },
      getTriggerMatrix() {
        return {
          ok: true,
          global: {
            sceneFilterAggressiveness: {
              calm: 1,
              groove: 1,
              impact: 1
            }
          },
          syncGroups: {
            enabled: true,
            groups: [
              {
                id: "reverse-group",
                sequenceMode: "reverse",
                fixtureIds: ["hue-b"]
              }
            ]
          }
        };
      },
      getOverclockTiers() {
        return { ok: true, tiers: [], activeLevel: 2, autoEnabled: false, devHz: 0 };
      }
    },
    hueBridge: {
      sendState(fixtures, state) {
        const rows = Array.isArray(fixtures) ? fixtures : [];
        hueBatches.push({
          fixtures: rows.map(row => String(row?.id || "")),
          rgb: {
            r: Number(state?.__rgb?.r || 0),
            g: Number(state?.__rgb?.g || 0),
            b: Number(state?.__rgb?.b || 0)
          }
        });
        return { sent: rows.length, failed: 0, dryRun: false };
      }
    },
    tickMs: 100,
    setInterval() {
      return { fake: true };
    },
    clearInterval() {}
  });

  runtime.tick({ reason: "sync_groups_reverse" });
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(hueBatches.length >= 2, true);
  const fixtureColorById = new Map();
  for (const batch of hueBatches) {
    for (const fixtureId of batch.fixtures) {
      fixtureColorById.set(fixtureId, { ...batch.rgb });
    }
  }
  assert.deepEqual(fixtureColorById.get("hue-a"), { r: 255, g: 0, b: 0 });
  assert.deepEqual(fixtureColorById.get("hue-b"), { r: 0, g: 0, b: 255 });
});

test("engine-v2 runtime excludes fixtures from engine dispatch using sync-group fixture engine controls", async () => {
  let nowMs = 10400;
  const hueBatches = [];
  const runtime = createEngineV2Runtime({
    now: () => {
      nowMs += 120;
      return nowMs;
    },
    audioEngine: {
      getTelemetry() {
        return {
          energy: 0.44,
          rms: 0.3,
          flux: 0.14,
          transient: 0.19,
          beat: true,
          beatPulse: true,
          beatConfidence: 0.62,
          bpm: 122
        };
      }
    },
    fixtureRegistry: createFixtureRegistryStub([
      { id: "hue-a", brand: "hue", zone: "front", enabled: true, bridgeIp: "x", username: "u", lightId: 1 },
      { id: "hue-b", brand: "hue", zone: "front", enabled: true, bridgeIp: "x", username: "u", lightId: 2 }
    ]),
    paletteService: createPaletteServiceStub({ r: 255, g: 64, b: 0 }),
    liveProfileService: {
      listProfiles() {
        return [{ name: "default" }];
      }
    },
    liveCompatService: {
      getCompatibility() {
        return {
          ok: true,
          snapshot: {
            sceneLock: "auto"
          }
        };
      },
      getTriggerMatrix() {
        return {
          ok: true,
          global: {
            sceneFilterAggressiveness: {
              calm: 1,
              groove: 1,
              impact: 1
            }
          },
          syncGroups: {
            enabled: true,
            groups: [],
            fixtureEngine: {
              "hue-b": {
                excluded: true,
                removeBehavior: "keep_current"
              }
            }
          }
        };
      },
      getOverclockTiers() {
        return { ok: true, tiers: [], activeLevel: 2, autoEnabled: false, devHz: 0 };
      }
    },
    hueBridge: {
      sendState(fixtures, state) {
        const rows = Array.isArray(fixtures) ? fixtures : [];
        hueBatches.push({
          fixtures: rows.map(row => String(row?.id || "")),
          on: state?.on !== false
        });
        return { sent: rows.length, failed: 0, dryRun: false };
      }
    },
    tickMs: 100,
    setInterval() {
      return { fake: true };
    },
    clearInterval() {}
  });

  runtime.tick({ reason: "fixture_engine_excluded" });
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));

  const dispatchedIds = new Set(
    hueBatches
      .filter(batch => batch.on === true)
      .flatMap(batch => batch.fixtures)
  );
  assert.equal(dispatchedIds.has("hue-a"), true);
  assert.equal(dispatchedIds.has("hue-b"), false);
});

test("engine-v2 runtime applies blackout behavior once when fixture is removed from engine controls", () => {
  let nowMs = 11200;
  let tickIndex = 0;
  const hueBatches = [];
  const runtime = createEngineV2Runtime({
    now: () => {
      nowMs += 120;
      return nowMs;
    },
    audioEngine: {
      getTelemetry() {
        return {
          energy: 0.5,
          rms: 0.36,
          flux: 0.2,
          transient: 0.22,
          beat: true,
          beatPulse: true,
          beatConfidence: 0.66,
          bpm: 126
        };
      }
    },
    fixtureRegistry: createFixtureRegistryStub([
      { id: "hue-a", brand: "hue", zone: "front", enabled: true, bridgeIp: "x", username: "u", lightId: 1 },
      { id: "hue-b", brand: "hue", zone: "front", enabled: true, bridgeIp: "x", username: "u", lightId: 2 }
    ]),
    paletteService: createPaletteServiceStub({ r: 90, g: 30, b: 255 }),
    liveProfileService: {
      listProfiles() {
        return [{ name: "default" }];
      }
    },
    liveCompatService: {
      getCompatibility() {
        return {
          ok: true,
          snapshot: {
            sceneLock: "auto"
          }
        };
      },
      getTriggerMatrix() {
        tickIndex += 1;
        return {
          ok: true,
          global: {
            sceneFilterAggressiveness: {
              calm: 1,
              groove: 1,
              impact: 1
            }
          },
          syncGroups: {
            enabled: true,
            groups: [],
            fixtureEngine: tickIndex >= 2
              ? {
                "hue-b": {
                  excluded: true,
                  removeBehavior: "blackout"
                }
              }
              : {}
          }
        };
      },
      getOverclockTiers() {
        return { ok: true, tiers: [], activeLevel: 2, autoEnabled: false, devHz: 0 };
      }
    },
    hueBridge: {
      sendState(fixtures, state) {
        const rows = Array.isArray(fixtures) ? fixtures : [];
        hueBatches.push({
          fixtures: rows.map(row => String(row?.id || "")),
          on: state?.on !== false
        });
        return { sent: rows.length, failed: 0, dryRun: false };
      }
    },
    tickMs: 100,
    setInterval() {
      return { fake: true };
    },
    clearInterval() {}
  });

  runtime.tick({ reason: "fixture_engine_blackout_tick_1" });
  runtime.tick({ reason: "fixture_engine_blackout_tick_2" });

  const hueBBlackoutCount = hueBatches.filter(batch =>
    batch.fixtures.includes("hue-b") && batch.on === false
  ).length;
  assert.equal(hueBBlackoutCount >= 1, true);
});

test("engine-v2 runtime applies custom remove-state payloads for hue and wiz exclusions", () => {
  let nowMs = 11600;
  let tickIndex = 0;
  const hueBatches = [];
  const wizBatches = [];
  const runtime = createEngineV2Runtime({
    now: () => {
      nowMs += 120;
      return nowMs;
    },
    audioEngine: {
      getTelemetry() {
        return {
          energy: 0.48,
          rms: 0.34,
          flux: 0.18,
          transient: 0.2,
          beat: true,
          beatPulse: true,
          beatConfidence: 0.64,
          bpm: 124
        };
      }
    },
    fixtureRegistry: createFixtureRegistryStub([
      { id: "hue-a", brand: "hue", zone: "front", enabled: true, bridgeIp: "x", username: "u", lightId: 1 },
      { id: "hue-b", brand: "hue", zone: "front", enabled: true, bridgeIp: "x", username: "u", lightId: 2 },
      { id: "wiz-a", brand: "wiz", zone: "back", enabled: true, ip: "192.168.1.61" },
      { id: "wiz-b", brand: "wiz", zone: "back", enabled: true, ip: "192.168.1.62" }
    ]),
    paletteService: createPaletteServiceStub({ r: 90, g: 30, b: 255 }),
    liveProfileService: {
      listProfiles() {
        return [{ name: "default" }];
      }
    },
    liveCompatService: {
      getCompatibility() {
        return {
          ok: true,
          snapshot: {
            sceneLock: "auto"
          }
        };
      },
      getTriggerMatrix() {
        tickIndex += 1;
        return {
          ok: true,
          global: {
            sceneFilterAggressiveness: {
              calm: 1,
              groove: 1,
              impact: 1
            }
          },
          syncGroups: {
            enabled: true,
            groups: [],
            fixtureEngine: tickIndex >= 2
              ? {
                "hue-b": {
                  excluded: true,
                  removeBehavior: "custom_state",
                  customFallback: {
                    mode: "hex",
                    hex: "#ff4010",
                    brightness: 35
                  }
                },
                "wiz-b": {
                  excluded: true,
                  removeBehavior: "custom_state",
                  customFallback: {
                    mode: "cct",
                    cct: 4900,
                    brightness: 15
                  }
                }
              }
              : {}
          }
        };
      },
      getOverclockTiers() {
        return { ok: true, tiers: [], activeLevel: 2, autoEnabled: false, devHz: 0 };
      }
    },
    hueBridge: {
      sendState(fixtures, state) {
        const rows = Array.isArray(fixtures) ? fixtures : [];
        hueBatches.push({
          fixtures: rows.map(row => String(row?.id || "")),
          state: { ...state, __rgb: state?.__rgb ? { ...state.__rgb } : undefined }
        });
        return { sent: rows.length, failed: 0, dryRun: false };
      }
    },
    wizBridge: {
      sendState(fixtures, state) {
        const rows = Array.isArray(fixtures) ? fixtures : [];
        wizBatches.push({
          fixtures: rows.map(row => String(row?.id || "")),
          state: { ...state }
        });
        return { sent: rows.length, failed: 0, dryRun: false };
      }
    },
    tickMs: 100,
    setInterval() {
      return { fake: true };
    },
    clearInterval() {}
  });

  runtime.tick({ reason: "fixture_engine_custom_remove_tick_1" });
  runtime.tick({ reason: "fixture_engine_custom_remove_tick_2" });

  const hueRemoveBatch = hueBatches.find(batch =>
    batch.fixtures.includes("hue-b")
    && Number(batch.state?.__rgb?.r) === 255
    && Number(batch.state?.__rgb?.g) === 64
    && Number(batch.state?.__rgb?.b) === 16
  ) || null;
  const wizRemoveBatch = wizBatches.find(batch =>
    batch.fixtures.includes("wiz-b")
    && Number(batch.state?.temp) === 4900
  ) || null;
  assert.notEqual(hueRemoveBatch, null);
  assert.notEqual(wizRemoveBatch, null);
  assert.equal(hueRemoveBatch.state?.on !== false, true);
  assert.equal(hueRemoveBatch.state?.__rgb?.r, 255);
  assert.equal(hueRemoveBatch.state?.__rgb?.g, 64);
  assert.equal(hueRemoveBatch.state?.__rgb?.b, 16);
  assert.equal(Number(hueRemoveBatch.state?.bri || 0) > 1, true);
  assert.equal(wizRemoveBatch.state?.on !== false, true);
  assert.equal(wizRemoveBatch.state?.temp, 4900);
  assert.equal(wizRemoveBatch.state?.dimming, 15);
});

test("engine-v2 runtime coalesces async Hue dispatches to avoid overlapping transport calls", async () => {
  let nowMs = 12000;
  let sendCalls = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const releaseQueue = [];

  const runtime = createEngineV2Runtime({
    now: () => {
      nowMs += 120;
      return nowMs;
    },
    audioEngine: {
      getTelemetry() {
        return {
          energy: 0.65,
          rms: 0.58,
          flux: 0.31,
          transient: 0.24,
          bpm: 126,
          beatConfidence: 0.7
        };
      }
    },
    fixtureRegistry: createFixtureRegistryStub([
      { id: "hue-main-1", brand: "hue", zone: "front", enabled: true, bridgeIp: "x", username: "u", lightId: 1 }
    ]),
    paletteService: createPaletteServiceStub({ r: 200, g: 40, b: 80 }),
    liveProfileService: {
      listProfiles() {
        return [{ name: "default" }];
      }
    },
    hueBridge: {
      sendState() {
        sendCalls += 1;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return new Promise(resolve => {
          releaseQueue.push(() => {
            inFlight -= 1;
            resolve({ sent: 1, failed: 0, dryRun: false });
          });
        });
      }
    },
    tickMs: 100,
    setInterval() {
      return { fake: true };
    },
    clearInterval() {}
  });

  runtime.tick({ reason: "async_hue_tick_1" });
  runtime.tick({ reason: "async_hue_tick_2" });
  runtime.tick({ reason: "async_hue_tick_3" });
  assert.equal(sendCalls, 1);

  const releaseFirst = releaseQueue.shift();
  assert.equal(typeof releaseFirst, "function");
  releaseFirst();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(sendCalls, 2);

  const releaseSecond = releaseQueue.shift();
  assert.equal(typeof releaseSecond, "function");
  releaseSecond();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(maxInFlight, 1);
});

test("engine-v2 runtime auto-hz uses dynamic range instead of pinning cap on low movement", () => {
  let nowMs = 20000;
  let phase = "low";
  const runtime = createEngineV2Runtime({
    now: () => {
      nowMs += 240;
      return nowMs;
    },
    audioEngine: {
      getTelemetry() {
        if (phase === "low") {
          return {
            energy: 0.72,
            rms: 0.68,
            flux: 0.01,
            transient: 0.01,
            beat: false,
            beatPulse: false,
            beatConfidence: 0.06,
            bpm: 118
          };
        }
        return {
          energy: 0.78,
          rms: 0.7,
          flux: 0.46,
          transient: 0.62,
          beat: true,
          beatPulse: true,
          beatConfidence: 0.81,
          bpm: 154
        };
      }
    },
    fixtureRegistry: createFixtureRegistryStub([
      { id: "hue-auto-1", brand: "hue", zone: "hue", enabled: true, bridgeIp: "x", username: "u", lightId: 1 }
    ]),
    paletteService: createPaletteServiceStub({ r: 120, g: 60, b: 220 }),
    liveProfileService: {
      listProfiles() {
        return [{ name: "default" }];
      }
    },
    liveCompatService: {
      getCompatibility() {
        return {
          ok: true,
          snapshot: {
            sceneLock: "auto"
          }
        };
      },
      getTriggerMatrix() {
        return {
          ok: true,
          global: {
            sceneFilterAggressiveness: {
              calm: 1,
              groove: 1,
              impact: 1
            }
          }
        };
      },
      getOverclockTiers() {
        return {
          ok: true,
          tiers: [],
          activeLevel: 2,
          autoEnabled: true,
          devHz: 0
        };
      }
    },
    hueBridge: {
      sendState() {
        return { sent: 1, failed: 0, dryRun: true };
      }
    },
    hardwareLimits: {
      hueMaxHz: 10,
      wizMaxHz: 10
    },
    tickMs: 100,
    setInterval() {
      return { fake: true };
    },
    clearInterval() {}
  });

  runtime.tick({ reason: "auto_hz_low_movement" });
  const lowProjection = runtime.getTelemetryProjection();
  const lowRequestedHz = Number(lowProjection?.scene?.cadenceState?.requestedHz || 0);

  phase = "high";
  runtime.tick({ reason: "auto_hz_high_movement" });
  const highProjection = runtime.getTelemetryProjection();
  const highRequestedHz = Number(highProjection?.scene?.cadenceState?.requestedHz || 0);

  assert.equal(lowRequestedHz < 10, true);
  assert.equal(lowRequestedHz >= 1.5, true);
  assert.equal(highRequestedHz > lowRequestedHz, true);
  assert.equal(highRequestedHz <= 10, true);
});

test("engine-v2 runtime auto-hz reaches high-capacity range on sustained aggressive sections", () => {
  let nowMs = 33200;
  let phase = "quiet";
  const runtime = createEngineV2Runtime({
    now: () => {
      nowMs += 220;
      return nowMs;
    },
    audioEngine: {
      getTelemetry() {
        if (phase === "quiet") {
          return {
            energy: 0.24,
            rms: 0.2,
            flux: 0.04,
            transient: 0.06,
            beat: false,
            beatPulse: false,
            beatConfidence: 0.08,
            bpm: 106,
            bandLow: 0.16,
            bandMid: 0.22,
            bandHigh: 0.18
          };
        }
        return {
          energy: 0.92,
          rms: 0.88,
          peak: 0.98,
          flux: 0.74,
          transient: 0.86,
          beat: true,
          beatPulse: true,
          beatConfidence: 0.94,
          bpm: 172,
          bandLow: 0.9,
          bandMid: 0.62,
          bandHigh: 0.48
        };
      }
    },
    fixtureRegistry: createFixtureRegistryStub([
      { id: "hue-capacity-1", brand: "hue", zone: "hue", enabled: true, bridgeIp: "x", username: "u", lightId: 1 }
    ]),
    paletteService: createPaletteServiceStub({ r: 220, g: 40, b: 30 }),
    liveProfileService: {
      listProfiles() {
        return [{ name: "default" }];
      }
    },
    liveCompatService: {
      getCompatibility() {
        return {
          ok: true,
          snapshot: {
            sceneLock: "auto"
          }
        };
      },
      getTriggerMatrix() {
        return {
          ok: true,
          global: {
            sceneFilterAggressiveness: {
              calm: 1,
              groove: 1,
              impact: 1
            }
          }
        };
      },
      getOverclockTiers() {
        return {
          ok: true,
          tiers: [],
          activeLevel: 2,
          autoEnabled: true,
          devHz: 0
        };
      }
    },
    hueBridge: {
      sendState() {
        return { sent: 1, failed: 0, dryRun: true };
      }
    },
    hardwareLimits: {
      hueMaxHz: 16,
      wizMaxHz: 16
    },
    tickMs: 100,
    setInterval() {
      return { fake: true };
    },
    clearInterval() {}
  });

  for (let i = 0; i < 8; i += 1) {
    runtime.tick({ reason: `auto_hz_capacity_quiet_${i}` });
  }
  const quietProjection = runtime.getTelemetryProjection();
  const quietRequestedHz = Number(quietProjection?.scene?.cadenceState?.requestedHz || 0);

  phase = "aggressive";
  for (let i = 0; i < 14; i += 1) {
    runtime.tick({ reason: `auto_hz_capacity_aggressive_${i}` });
  }
  const aggressiveProjection = runtime.getTelemetryProjection();
  const aggressiveRequestedHz = Number(aggressiveProjection?.scene?.cadenceState?.requestedHz || 0);

  assert.equal(quietRequestedHz <= 8.5, true);
  assert.equal(aggressiveRequestedHz > quietRequestedHz, true);
  assert.equal(aggressiveRequestedHz >= 12, true);
  assert.equal(aggressiveRequestedHz <= 16, true);
});

test("engine-v2 runtime honors active-brand caps instead of global min cap", () => {
  let nowMs = 24000;
  const runtime = createEngineV2Runtime({
    now: () => {
      nowMs += 240;
      return nowMs;
    },
    audioEngine: {
      getTelemetry() {
        return {
          energy: 0.88,
          rms: 0.82,
          peak: 0.95,
          flux: 0.6,
          transient: 0.78,
          beat: true,
          beatPulse: true,
          beatConfidence: 0.92,
          bpm: 168,
          bandLow: 0.9,
          bandMid: 0.5,
          bandHigh: 0.42
        };
      }
    },
    fixtureRegistry: createFixtureRegistryStub([
      { id: "hue-ceiling-1", brand: "hue", zone: "hue", enabled: true, bridgeIp: "x", username: "u", lightId: 1 }
    ]),
    paletteService: createPaletteServiceStub({ r: 210, g: 90, b: 30 }),
    liveProfileService: {
      listProfiles() {
        return [{ name: "default" }];
      }
    },
    liveCompatService: {
      getCompatibility() {
        return {
          ok: true,
          snapshot: {
            sceneLock: "auto"
          }
        };
      },
      getTriggerMatrix() {
        return {
          ok: true,
          global: {
            sceneFilterAggressiveness: {
              calm: 1,
              groove: 1,
              impact: 1
            }
          }
        };
      },
      getOverclockTiers() {
        return {
          ok: true,
          tiers: [],
          activeLevel: 7,
          autoEnabled: false,
          devHz: 0
        };
      }
    },
    hueBridge: {
      sendState() {
        return { sent: 1, failed: 0, dryRun: true };
      }
    },
    hardwareLimits: {
      hueMaxHz: 16,
      wizMaxHz: 10
    },
    tickMs: 100,
    setInterval() {
      return { fake: true };
    },
    clearInterval() {}
  });

  runtime.tick({ reason: "active_brand_cap_hue_only" });
  const projection = runtime.getTelemetryProjection();
  const requestedHz = Number(projection?.scene?.cadenceState?.requestedHz || 0);
  const appliedHue = Number(projection?.scene?.cadenceState?.appliedByBrand?.hue || 0);
  const appliedHz = Number(projection?.scene?.cadenceState?.appliedHz || 0);
  assert.equal(requestedHz, 16);
  assert.equal(appliedHue, 16);
  assert.equal(appliedHz, 16);
});

test("engine-v2 runtime defaults to strict palette mapper mode for literal sequence colors", async () => {
  let nowMs = 25200;
  const hueStates = [];
  let phase = "low";
  const paletteRows = [
    { index: 0, token: "#ff0000", name: "red", hex: "#ff0000", rgb: { r: 255, g: 0, b: 0 }, source: "hex" },
    { index: 1, token: "#00ff00", name: "green", hex: "#00ff00", rgb: { r: 0, g: 255, b: 0 }, source: "hex" },
    { index: 2, token: "#0000ff", name: "blue", hex: "#0000ff", rgb: { r: 0, g: 0, b: 255 }, source: "hex" }
  ];
  const paletteService = {
    consumeTickFrame() {
      return {
        index: 0,
        token: paletteRows[0].token,
        name: paletteRows[0].name,
        hex: paletteRows[0].hex,
        rgb: { ...paletteRows[0].rgb },
        source: "stub",
        count: paletteRows.length,
        holdTicks: 1
      };
    },
    getSnapshot() {
      return {
        version: 1,
        customColors: {},
        sequence: paletteRows.map(row => row.token),
        resolvedSequence: paletteRows.map(row => ({ ...row, rgb: { ...row.rgb } })),
        activeIndex: 0,
        holdTicks: 1,
        current: { ...paletteRows[0], rgb: { ...paletteRows[0].rgb } },
        colorCount: paletteRows.length
      };
    }
  };

  const runtime = createEngineV2Runtime({
    now: () => {
      nowMs += 260;
      return nowMs;
    },
    audioEngine: {
      getTelemetry() {
        if (phase === "low") {
          return {
            energy: 0.42,
            rms: 0.38,
            transient: 0.04,
            flux: 0.03,
            beat: false,
            beatPulse: false,
            beatConfidence: 0.06,
            bpm: 100,
            bandLow: 1,
            bandMid: 0.2,
            bandHigh: 0.1
          };
        }
        return {
          energy: 0.82,
          rms: 0.72,
          transient: 0.68,
          flux: 0.54,
          beat: true,
          beatPulse: true,
          beatConfidence: 0.91,
          bpm: 170,
          bandLow: 0.1,
          bandMid: 0.3,
          bandHigh: 1
        };
      }
    },
    fixtureRegistry: createFixtureRegistryStub([
      { id: "hue-strict-1", brand: "hue", zone: "hue", enabled: true, bridgeIp: "x", username: "u", lightId: 1 }
    ]),
    paletteService,
    liveProfileService: {
      listProfiles() {
        return [{ name: "default" }];
      }
    },
    hueBridge: {
      sendState(_fixtures, state) {
        hueStates.push({
          r: Number(state?.__rgb?.r || 0),
          g: Number(state?.__rgb?.g || 0),
          b: Number(state?.__rgb?.b || 0)
        });
        return { sent: 1, failed: 0, dryRun: false };
      }
    },
    tickMs: 100,
    setInterval() {
      return { fake: true };
    },
    clearInterval() {}
  });

  runtime.tick({ reason: "strict_palette_low" });
  phase = "high";
  for (let i = 0; i < 4; i += 1) {
    runtime.tick({ reason: `strict_palette_high_${i + 1}` });
  }
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(runtime.getStatus().paletteMapperMode, "strict");
  assert.equal(hueStates.length >= 2, true);
  const baseline = hueStates[0];
  const allMatch = hueStates.every(row =>
    row.r === baseline.r &&
    row.g === baseline.g &&
    row.b === baseline.b
  );
  assert.equal(allMatch, true);
  assert.deepEqual(baseline, { r: 255, g: 0, b: 0 });
});

test("engine-v2 runtime musical palette mapper follows spectral centroid deterministically", async () => {
  let nowMs = 26000;
  const hueStates = [];
  let phase = "low";
  let highPhaseFlip = false;
  const paletteRows = [
    { index: 0, token: "#ff5500", name: "warm", hex: "#ff5500", rgb: { r: 255, g: 85, b: 0 }, source: "hex" },
    { index: 1, token: "#ffc400", name: "amber", hex: "#ffc400", rgb: { r: 255, g: 196, b: 0 }, source: "hex" },
    { index: 2, token: "#2f8cff", name: "sky", hex: "#2f8cff", rgb: { r: 47, g: 140, b: 255 }, source: "hex" },
    { index: 3, token: "#8d5bff", name: "violet", hex: "#8d5bff", rgb: { r: 141, g: 91, b: 255 }, source: "hex" }
  ];
  const paletteService = {
    consumeTickFrame() {
      return {
        index: 0,
        token: paletteRows[0].token,
        name: paletteRows[0].name,
        hex: paletteRows[0].hex,
        rgb: { ...paletteRows[0].rgb },
        source: "stub",
        count: paletteRows.length,
        holdTicks: 1
      };
    },
    getSnapshot() {
      return {
        version: 1,
        customColors: {},
        sequence: paletteRows.map(row => row.token),
        resolvedSequence: paletteRows.map(row => ({ ...row, rgb: { ...row.rgb } })),
        activeIndex: 0,
        holdTicks: 1,
        current: { ...paletteRows[0], rgb: { ...paletteRows[0].rgb } },
        colorCount: paletteRows.length
      };
    }
  };

  const runtime = createEngineV2Runtime({
    now: () => {
      nowMs += 260;
      return nowMs;
    },
    audioEngine: {
      getTelemetry() {
        if (phase === "low") {
          return {
            energy: 0.52,
            rms: 0.48,
            transient: 0.08,
            flux: 0.07,
            beat: false,
            beatPulse: false,
            beatConfidence: 0.08,
            bpm: 116,
            bandLow: 1,
            bandMid: 0.35,
            bandHigh: 0.12
          };
        }
        highPhaseFlip = !highPhaseFlip;
        if (highPhaseFlip) {
          return {
            energy: 0.66,
            rms: 0.58,
            transient: 0.41,
            flux: 0.34,
            beat: true,
            beatPulse: true,
            beatConfidence: 0.76,
            bpm: 144,
            bandLow: 0.12,
            bandMid: 0.36,
            bandHigh: 1
          };
        }
        return {
          energy: 0.67,
          rms: 0.59,
          transient: 0.43,
          flux: 0.35,
          beat: true,
          beatPulse: true,
          beatConfidence: 0.78,
          bpm: 146,
          bandLow: 1,
          bandMid: 0.34,
          bandHigh: 0.12
        };
      }
    },
    fixtureRegistry: createFixtureRegistryStub([
      { id: "hue-musical-1", brand: "hue", zone: "hue", enabled: true, bridgeIp: "x", username: "u", lightId: 1 }
    ]),
    paletteService,
    liveProfileService: {
      listProfiles() {
        return [{ name: "default" }];
      }
    },
    hueBridge: {
      sendState(_fixtures, state) {
        hueStates.push({
          r: Number(state?.__rgb?.r || 0),
          g: Number(state?.__rgb?.g || 0),
          b: Number(state?.__rgb?.b || 0)
        });
        return { sent: 1, failed: 0, dryRun: false };
      }
    },
    paletteMapperMode: "musical",
    tickMs: 100,
    setInterval() {
      return { fake: true };
    },
    clearInterval() {}
  });

  runtime.tick({ reason: "musical_palette_low" });
  phase = "high";
  for (let i = 0; i < 10; i += 1) {
    runtime.tick({ reason: `musical_palette_high_${i + 1}` });
  }
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(hueStates.length >= 2, true);
  const first = hueStates[0];
  const changed = hueStates.slice(1).some(row =>
    !(row.r === first.r && row.g === first.g && row.b === first.b)
  );
  assert.equal(changed, true);
});
