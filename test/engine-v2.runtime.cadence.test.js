// [TITLE] Purpose: verify engine-v2 cadence helper preserves manual caps and auto-hz dynamics

const test = require("node:test");
const assert = require("node:assert/strict");

const createEngineRuntimeCadence = require("../src/domains/engine-v2/engine.runtime.cadence");

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function createCadence(overrides = {}) {
  return createEngineRuntimeCadence({
    clampNumber,
    hardwareLimits: overrides.hardwareLimits || {
      hueMaxHz: 16,
      wizMaxHz: 16
    },
    OVERCLOCK_HZ_BY_LEVEL: {
      0: 2,
      1: 4,
      2: 6,
      3: 8,
      4: 10,
      5: 12,
      6: 14,
      7: 16
    }
  });
}

test("engine-v2 cadence helper preserves manual overclock requests when hardware can satisfy them", () => {
  const cadence = createCadence();

  const state = cadence.computeCadenceState({
    overclock: {
      autoEnabled: false,
      activeLevel: 3,
      devHz: 0
    },
    sceneState: {
      musicalProfile: "groove"
    },
    hasHueTargets: true,
    hasWizTargets: true
  });

  assert.equal(state.source, "manual");
  assert.equal(state.requestedHz, 8);
  assert.equal(state.appliedHz, 8);
  assert.equal(state.guarded, false);
});

test("engine-v2 cadence helper honors active-brand caps instead of shared minimum when only one brand is targeted", () => {
  const sceneState = {
    musicalProfile: "aggressive",
    loudnessSectionBand: "loud",
    beatPulse: true,
    bpm: 152,
    motion: 1.05,
    impactSignal: 1.34,
    flowIntensity: 2.1,
    transient: 0.86,
    flux: 0.74,
    transientRise: 0.72,
    fluxRise: 0.63,
    kickAccent: 0.9,
    beatConfidence: 0.82,
    energy: 0.88,
    rms: 0.7,
    loudness: 0.78,
    musicalDriveNorm: 0.9
  };
  const bothBrandsCadence = createCadence({
    hardwareLimits: {
      hueMaxHz: 16,
      wizMaxHz: 8
    }
  });
  const hueOnlyCadence = createCadence({
    hardwareLimits: {
      hueMaxHz: 16,
      wizMaxHz: 8
    }
  });

  let bothState = null;
  let hueOnlyState = null;
  for (let i = 0; i < 12; i += 1) {
    bothState = bothBrandsCadence.computeCadenceState({
      overclock: {
        autoEnabled: true,
        activeLevel: 2,
        devHz: 0
      },
      sceneState,
      hasHueTargets: true,
      hasWizTargets: true
    });
    hueOnlyState = hueOnlyCadence.computeCadenceState({
      overclock: {
        autoEnabled: true,
        activeLevel: 2,
        devHz: 0
      },
      sceneState,
      hasHueTargets: true,
      hasWizTargets: false
    });
  }

  assert.equal(bothState.appliedHz <= 8, true);
  assert.equal(hueOnlyState.appliedHz > bothState.appliedHz, true);
  assert.equal(hueOnlyState.appliedHz <= 16, true);
});

test("engine-v2 cadence helper reaches high-capacity auto-hz range on sustained aggressive sections", () => {
  const cadence = createCadence();
  let state = null;

  for (let i = 0; i < 14; i += 1) {
    state = cadence.computeCadenceState({
      overclock: {
        autoEnabled: true,
        activeLevel: 2,
        devHz: 0
      },
      sceneState: {
        musicalProfile: "aggressive",
        loudnessSectionBand: "loud",
        beatPulse: true,
        bpm: 158,
        motion: 1.08,
        impactSignal: 1.42,
        flowIntensity: 2.2,
        transient: 0.88,
        flux: 0.79,
        transientRise: 0.74,
        fluxRise: 0.68,
        kickAccent: 0.96,
        beatConfidence: 0.84,
        energy: 0.9,
        rms: 0.72,
        loudness: 0.8,
        musicalDriveNorm: 0.92
      },
      hasHueTargets: true,
      hasWizTargets: true
    });
  }

  assert.equal(state.source, "auto_hz");
  assert.equal(state.requestedHz >= 12, true);
  assert.equal(state.requestedHz <= 16, true);
  assert.equal(state.autoDebug.mode, "high");
  assert.equal(state.autoDebug.profile, "aggressive");
});
