// [TITLE] Test Module: test/engine-v2.contracts.test.js
// [TITLE] Purpose: verify Engine v2 contract normalization and projection behavior

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ENGINE_V2_TELEMETRY_VERSION,
  ENGINE_V2_POLICY_ORDER,
  normalizeEngineInputSnapshot,
  normalizeFixtureIntents,
  buildEngineTelemetryProjection
} = require("../src/domains/engine-v2/engine.contracts");

test("engine-v2 policy order keeps twitch as highest-priority overlay", () => {
  const order = Array.from(ENGINE_V2_POLICY_ORDER);
  assert.equal(order[order.length - 1], "twitch_overlays");
});

test("engine-v2 contracts normalize input snapshots deterministically", () => {
  const normalized = normalizeEngineInputSnapshot({
    telemetry: {
      rms: "0.45",
      energy: 2,
      peak: 0.78,
      flux: -3,
      transients: 0.6,
      spectralFlux: 0.72,
      bandLow: 0.25,
      bandMid: 0.5,
      bandHigh: 0.85,
      bpm: 128,
      beatConfidence: 3,
      beat: "yes",
      beatPulse: "true"
    },
    profile: {
      name: "set-a",
      payload: { mode: "impact" }
    },
    controlEvents: [
      { type: "scene_lock", owner: "midi", payload: { scene: "steady" } },
      { type: "", owner: "mods" }
    ],
    fixtures: [
      { id: "hue-1", brand: "hue", zone: "main", enabled: true },
      { id: "wiz-1", brand: "wiz", zone: "back", enabled: false },
      { id: "", brand: "wiz" }
    ]
  });

  assert.equal(normalized.telemetry.energy, 1);
  assert.equal(normalized.telemetry.peak, 0.78);
  assert.equal(normalized.telemetry.flux, 0);
  assert.equal(normalized.telemetry.spectralFlux, 0.72);
  assert.equal(normalized.telemetry.transient, 0.6);
  assert.equal(normalized.telemetry.bandLow, 0.25);
  assert.equal(normalized.telemetry.bandMid, 0.5);
  assert.equal(normalized.telemetry.bandHigh, 0.85);
  assert.equal(normalized.telemetry.beatConfidence, 1);
  assert.equal(normalized.telemetry.beat, true);
  assert.equal(normalized.telemetry.beatPulse, true);
  assert.equal(normalized.profile.name, "set-a");
  assert.equal(normalized.controlEvents.length, 1);
  assert.equal(normalized.fixtures.length, 2);
});

test("engine-v2 contracts normalize fixture intents and telemetry projection", () => {
  const intents = normalizeFixtureIntents([
    {
      fixtureId: "hue-1",
      brand: "hue",
      rgb: { r: 255, g: 40, b: 30 },
      brightness: 1.4,
      transitionMs: 120,
      owner: "twitch",
      scope: "fixture"
    },
    {
      fixtureId: "",
      brand: "wiz"
    }
  ]);
  assert.equal(intents.length, 1);
  assert.equal(intents[0].brightness, 1);
  assert.equal(intents[0].owner, "twitch");

  const projection = buildEngineTelemetryProjection({
    status: {
      running: true,
      tickMs: 100,
      tickCount: 9,
      lastTickAt: 1234,
      loopDurationMs: 6,
      intentsCount: 2
    },
    sceneState: {
      energy: 0.8,
      rms: 0.4,
      peak: 0.92,
      transient: 0.7,
      flux: 0.5,
      bandLow: 0.2,
      bandMid: 0.5,
      bandHigh: 0.7,
      bpm: 128,
      beatConfidence: 0.9,
      beatPulse: true,
      loudnessSection: 0.58,
      loudnessSectionBand: "loud",
      musicalProfile: "aggressive",
      musicalDriveNorm: 0.67,
      sceneLock: "auto",
      sceneIntent: "impact",
      sceneCandidate: "impact",
      sceneCandidateConfidence: 0.82,
      flowIntensity: 1.4,
      brightness: 0.86,
      brightnessSourceRaw: 0.66,
      brightnessSourceNormalized: 0.74,
      brightnessMusicalDrive: 0.71,
      brightnessRangeDemand: 0.63,
      transitionMs: 140,
      cadenceState: {
        bpmSource: "hybrid_blend"
      }
    },
    dispatch: {
      sent: 2,
      failed: 0,
      dryRun: true
    }
  });

  assert.equal(projection.engineTelemetryVersion, ENGINE_V2_TELEMETRY_VERSION);
  assert.equal(projection.running, true);
  assert.equal(projection.tickCount, 9);
  assert.equal(projection.scene.sceneLock, "auto");
  assert.equal(projection.scene.sceneIntent, "impact");
  assert.equal(projection.scene.beatPulse, true);
  assert.equal(projection.scene.sceneCandidateConfidence, 0.82);
  assert.equal(projection.scene.flowIntensity, 1.4);
  assert.equal(projection.scene.loudnessSection, 0.58);
  assert.equal(projection.scene.loudnessSectionBand, "loud");
  assert.equal(projection.scene.musicalProfile, "aggressive");
  assert.equal(projection.scene.musicalDriveNorm, 0.67);
  assert.equal(projection.scene.brightnessSourceRaw, 0.66);
  assert.equal(projection.scene.brightnessSourceNormalized, 0.74);
  assert.equal(projection.scene.brightnessMusicalDrive, 0.71);
  assert.equal(projection.scene.brightnessRangeDemand, 0.63);
  assert.equal(projection.scene.cadenceState?.bpmSource, "hybrid_blend");
  assert.equal(projection.dispatch.sent, 2);
});
