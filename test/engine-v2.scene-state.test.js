// [TITLE] Test Module: test/engine-v2.scene-state.test.js
// [TITLE] Purpose: verify deterministic Engine v2 scene-state model behavior

const test = require("node:test");
const assert = require("node:assert/strict");

const createEngineSceneStateModel = require("../src/domains/engine-v2/engine.scene-state");

test("engine-v2 scene model resolves hybrid BPM from derived pulses when telemetry confidence is weak", () => {
  let clock = 1000;
  const model = createEngineSceneStateModel({
    now: () => clock
  });
  const baseInput = {
    telemetry: {
      rms: 0.28,
      energy: 0.3,
      transient: 0.82,
      flux: 0.35,
      beat: true,
      bpm: 172,
      beatConfidence: 0.2
    },
    profile: {
      payload: {}
    }
  };

  model.computeSceneState(baseInput);
  clock += 500;
  model.computeSceneState(baseInput);
  clock += 500;
  const out = model.computeSceneState(baseInput);

  assert.equal(out.cadenceState.bpmSource, "hybrid_adaptive");
  assert.equal(out.bpm >= 120 && out.bpm <= 172, true);
});

test("engine-v2 scene model drops stale derived BPM after pulse silence window", () => {
  let clock = 12000;
  const model = createEngineSceneStateModel({
    now: () => clock
  });
  const pulseInput = {
    telemetry: {
      rms: 0.2,
      energy: 0.24,
      transient: 0.85,
      flux: 0.34,
      beat: true,
      bpm: 0,
      beatConfidence: 0.1
    },
    profile: {
      payload: {
        triggerMatrix: {
          global: {
            runtimeTuning: {
              bpmSourceMode: "derived",
              derivedBeatMaxIntervalMs: 800
            }
          }
        }
      }
    }
  };

  model.computeSceneState(pulseInput);
  clock += 500;
  model.computeSceneState(pulseInput);
  clock += 500;
  const withDerived = model.computeSceneState(pulseInput);
  assert.equal(withDerived.bpm > 0, true);
  assert.equal(withDerived.cadenceState.bpmSource, "derived");

  clock += 2200;
  const stale = model.computeSceneState({
    telemetry: {
      rms: 0.02,
      energy: 0.02,
      transient: 0.01,
      flux: 0.01,
      beat: false,
      bpm: 0,
      beatConfidence: 0
    },
    profile: pulseInput.profile
  });
  assert.equal(stale.cadenceState.derivedBpm, 0);
  assert.equal(stale.bpm < withDerived.bpm, true);
});

test("engine-v2 scene model folds out-of-range derived pulse tempo into musical cadence window", () => {
  let clock = 14000;
  const model = createEngineSceneStateModel({
    now: () => clock
  });
  const pulseInput = {
    telemetry: {
      rms: 0.24,
      energy: 0.28,
      transient: 0.95,
      flux: 0.76,
      bandLow: 0.82,
      beat: true,
      beatPulse: true,
      bpm: 0,
      beatConfidence: 0.2
    },
    profile: {
      payload: {
        triggerMatrix: {
          global: {
            runtimeTuning: {
              bpmSourceMode: "derived"
            }
          }
        }
      }
    }
  };

  for (let i = 0; i < 6; i += 1) {
    model.computeSceneState(pulseInput);
    clock += 250; // raw derived cadence ~= 240 BPM, should fold to musical window
  }

  const out = model.computeSceneState(pulseInput);
  assert.equal(out.cadenceState.bpmSource, "derived");
  assert.equal(out.cadenceState.derivedBpm >= 100 && out.cadenceState.derivedBpm <= 140, true);
  assert.equal(out.bpm >= 100 && out.bpm <= 140, true);
});

test("engine-v2 scene model holds impact briefly and respects scene cooldown to prevent flicker", () => {
  let clock = 5000;
  const model = createEngineSceneStateModel({
    now: () => clock
  });

  const impact = model.computeSceneState({
    telemetry: {
      rms: 0.32,
      energy: 0.35,
      transient: 0.9,
      flux: 0.55,
      beat: true,
      bpm: 128,
      beatConfidence: 0.8
    },
    profile: {
      payload: {}
    }
  });
  assert.equal(impact.sceneIntent, "impact");

  clock += 80;
  const held = model.computeSceneState({
    telemetry: {
      rms: 0.04,
      energy: 0.05,
      transient: 0.02,
      flux: 0.02,
      beat: false,
      bpm: 0,
      beatConfidence: 0
    },
    profile: {
      payload: {}
    }
  });
  assert.equal(held.sceneIntent, "impact");

  clock += 900;
  const released = model.computeSceneState({
    telemetry: {
      rms: 0.04,
      energy: 0.05,
      transient: 0.02,
      flux: 0.02,
      beat: false,
      bpm: 0,
      beatConfidence: 0
    },
    profile: {
      payload: {}
    }
  });
  assert.equal(released.sceneIntent, "steady");
});

test("engine-v2 scene model accepts live runtime tuning updates in real time", () => {
  let clock = 9000;
  const model = createEngineSceneStateModel({
    now: () => clock
  });

  const impact = model.computeSceneState({
    telemetry: {
      rms: 0.36,
      energy: 0.4,
      transient: 0.94,
      flux: 0.62,
      beat: true,
      bpm: 126,
      beatConfidence: 0.9
    },
    profile: {
      payload: {}
    }
  });
  assert.equal(impact.sceneIntent, "impact");

  clock += 60;
  const tuned = model.computeSceneState({
    telemetry: {
      rms: 0.04,
      energy: 0.05,
      transient: 0.02,
      flux: 0.02,
      beat: false,
      bpm: 0,
      beatConfidence: 0
    },
    profile: {
      payload: {
        triggerMatrix: {
          global: {
            runtimeTuning: {
              sceneSwitchCooldownMs: 0,
              impactHoldMs: 0
            }
          }
        }
      }
    }
  });
  assert.equal(tuned.sceneIntent, "steady");
});

test("engine-v2 scene model extracts scoped runtime tuning maps from trigger-matrix payload", () => {
  const model = createEngineSceneStateModel();
  const controls = model.extractLiveRuntimeControls({
    profile: {
      payload: {
        triggerMatrix: {
          global: {
            runtimeTuning: {
              brightnessFloor: 0.1,
              brightnessCeil: 0.95
            }
          },
          brands: {
            hue: {
              brand: "hue",
              runtimeTuning: {
                brightnessFloor: 0.25,
                brightnessCeil: 0.8
              }
            }
          },
          fixtureOverrides: {
            "hue-main-2": {
              brand: "hue",
              fixtureId: "hue-main-2",
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

  assert.equal(controls.runtimeTuning.brightnessFloor, 0.1);
  assert.equal(controls.scopedRuntimeTuning.brands.hue.runtimeTuning.brightnessFloor, 0.25);
  assert.equal(
    controls.scopedRuntimeTuning.fixtureOverrides["hue-main-2"].runtimeTuning.brightnessCeil,
    0.5
  );
});

test("engine-v2 scene model allows steady intent on loud but low-movement passages", () => {
  let clock = 15000;
  const model = createEngineSceneStateModel({
    now: () => clock
  });

  const quietMotionInput = {
    telemetry: {
      rms: 0.74,
      energy: 0.78,
      transient: 0.01,
      flux: 0.015,
      beat: false,
      beatPulse: false,
      beatConfidence: 0.06,
      bpm: 118
    },
    profile: {
      payload: {}
    }
  };

  const first = model.computeSceneState(quietMotionInput);
  clock += 120;
  const second = model.computeSceneState(quietMotionInput);

  assert.equal(first.sceneIntent, "steady");
  assert.equal(second.sceneIntent, "steady");
  assert.equal(second.sceneCandidate, "steady");
});

test("engine-v2 scene brightness interprets quiet and loud sections without pinning flat volume", () => {
  let clock = 18000;
  const model = createEngineSceneStateModel({
    now: () => clock
  });

  const highVolume = {
    telemetry: {
      rms: 0.82,
      peak: 0.98,
      energy: 0.86,
      transient: 0.16,
      flux: 0.14,
      beat: false,
      beatPulse: false,
      beatConfidence: 0.1,
      bpm: 122
    },
    profile: {
      payload: {}
    }
  };
  const lowVolume = {
    telemetry: {
      rms: 0.38,
      peak: 0.55,
      energy: 0.41,
      transient: 0.16,
      flux: 0.14,
      beat: false,
      beatPulse: false,
      beatConfidence: 0.1,
      bpm: 122
    },
    profile: {
      payload: {}
    }
  };

  let highOut = null;
  for (let i = 0; i < 12; i += 1) {
    highOut = model.computeSceneState(highVolume);
    clock += 120;
  }
  let lowOut = null;
  for (let i = 0; i < 12; i += 1) {
    lowOut = model.computeSceneState(lowVolume);
    clock += 120;
  }

  const highBrightness = Number(highOut?.brightness || 0);
  const lowBrightness = Number(lowOut?.brightness || 0);
  assert.equal(highBrightness >= (lowBrightness + 0.28), true);
  assert.equal(highBrightness <= 0.7, true);
  assert.equal(lowBrightness <= 0.18, true);
});

test("engine-v2 scene brightness tracks quiet-to-loud section shifts with stable movement", () => {
  let clock = 19200;
  const model = createEngineSceneStateModel({
    now: () => clock
  });

  const quietSection = {
    telemetry: {
      rms: 0.12,
      peak: 0.22,
      energy: 0.16,
      transient: 0.18,
      flux: 0.14,
      beat: false,
      beatPulse: false,
      beatConfidence: 0.1,
      bpm: 124
    },
    profile: {
      payload: {}
    }
  };
  const loudSection = {
    telemetry: {
      rms: 0.62,
      peak: 0.86,
      energy: 0.7,
      transient: 0.18,
      flux: 0.14,
      beat: false,
      beatPulse: false,
      beatConfidence: 0.1,
      bpm: 124
    },
    profile: {
      payload: {}
    }
  };

  let quietOut = null;
  for (let i = 0; i < 20; i += 1) {
    quietOut = model.computeSceneState(quietSection);
    clock += 120;
  }

  let loudOut = null;
  for (let i = 0; i < 20; i += 1) {
    loudOut = model.computeSceneState(loudSection);
    clock += 120;
  }

  let quietReturnOut = null;
  for (let i = 0; i < 24; i += 1) {
    quietReturnOut = model.computeSceneState(quietSection);
    clock += 120;
  }

  const quietBrightness = Number(quietOut?.brightness || 0);
  const loudBrightness = Number(loudOut?.brightness || 0);
  const quietReturnBrightness = Number(quietReturnOut?.brightness || 0);
  assert.equal(loudBrightness >= (quietBrightness + 0.1), true);
  assert.equal(quietReturnBrightness <= (loudBrightness - 0.08), true);
});

test("engine-v2 scene emits stable loudness section bands (quiet/normal/loud)", () => {
  let clock = 19800;
  const model = createEngineSceneStateModel({
    now: () => clock
  });

  const quietInput = {
    telemetry: {
      rms: 0.08,
      peak: 0.16,
      energy: 0.1,
      transient: 0.12,
      flux: 0.08,
      beat: false,
      beatPulse: false,
      beatConfidence: 0.06,
      bpm: 120
    },
    profile: {
      payload: {}
    }
  };
  const loudInput = {
    telemetry: {
      rms: 0.76,
      peak: 0.92,
      energy: 0.84,
      transient: 0.12,
      flux: 0.08,
      beat: false,
      beatPulse: false,
      beatConfidence: 0.06,
      bpm: 120
    },
    profile: {
      payload: {}
    }
  };
  const normalInput = {
    telemetry: {
      rms: 0.5,
      peak: 0.66,
      energy: 0.56,
      transient: 0.12,
      flux: 0.08,
      beat: false,
      beatPulse: false,
      beatConfidence: 0.06,
      bpm: 120
    },
    profile: {
      payload: {}
    }
  };

  let quietOut = null;
  for (let i = 0; i < 20; i += 1) {
    quietOut = model.computeSceneState(quietInput);
    clock += 120;
  }
  let loudOut = null;
  for (let i = 0; i < 24; i += 1) {
    loudOut = model.computeSceneState(loudInput);
    clock += 120;
  }
  let normalOut = null;
  for (let i = 0; i < 28; i += 1) {
    normalOut = model.computeSceneState(normalInput);
    clock += 120;
  }

  assert.equal(String(quietOut?.loudnessSectionBand || ""), "quiet");
  assert.equal(String(loudOut?.loudnessSectionBand || ""), "loud");
  assert.equal(String(normalOut?.loudnessSectionBand || ""), "normal");
});

test("engine-v2 scene emits musical section profiles (calm/groove/aggressive)", () => {
  let clock = 20600;
  const createModel = () => createEngineSceneStateModel({
    now: () => clock
  });

  const calmInput = {
    telemetry: {
      rms: 0.05,
      peak: 0.1,
      energy: 0.06,
      transient: 0.08,
      flux: 0.06,
      beat: false,
      beatPulse: false,
      beatConfidence: 0.04,
      bpm: 96,
      bandLow: 0.06,
      bandMid: 0.08,
      bandHigh: 0.06
    },
    profile: {
      payload: {}
    }
  };
  const grooveInput = {
    telemetry: {
      rms: 0.42,
      peak: 0.6,
      energy: 0.46,
      transient: 0.16,
      flux: 0.12,
      beat: false,
      beatPulse: false,
      beatConfidence: 0.09,
      bpm: 118,
      bandLow: 0.22,
      bandMid: 0.3,
      bandHigh: 0.2
    },
    profile: {
      payload: {}
    }
  };
  const aggressiveInput = {
    telemetry: {
      rms: 0.84,
      peak: 0.98,
      energy: 0.9,
      transient: 0.42,
      flux: 0.34,
      beat: true,
      beatPulse: true,
      beatConfidence: 0.88,
      bpm: 156,
      bandLow: 0.78,
      bandMid: 0.62,
      bandHigh: 0.56
    },
    profile: {
      payload: {}
    }
  };

  const modelCalm = createModel();
  let calmOut = null;
  for (let i = 0; i < 24; i += 1) {
    calmOut = modelCalm.computeSceneState(calmInput);
    clock += 120;
  }
  const modelGroove = createModel();
  let grooveOut = null;
  for (let i = 0; i < 24; i += 1) {
    grooveOut = modelGroove.computeSceneState(grooveInput);
    clock += 120;
  }
  const modelAggressive = createModel();
  let aggressiveOut = null;
  for (let i = 0; i < 24; i += 1) {
    aggressiveOut = modelAggressive.computeSceneState(aggressiveInput);
    clock += 120;
  }

  assert.equal(String(calmOut?.musicalProfile || ""), "calm");
  assert.equal(String(grooveOut?.musicalProfile || ""), "groove");
  assert.equal(String(aggressiveOut?.musicalProfile || ""), "aggressive");
  assert.equal(Number(aggressiveOut?.musicalDriveNorm || 0) > Number(grooveOut?.musicalDriveNorm || 0), true);
  assert.equal(Number(grooveOut?.musicalDriveNorm || 0) > Number(calmOut?.musicalDriveNorm || 0), true);
});

test("engine-v2 scene profile stays telemetry-driven when scene lock is forced", () => {
  let clock = 23800;
  const model = createEngineSceneStateModel({
    now: () => clock
  });
  const quietInputWithImpactLock = {
    telemetry: {
      rms: 0.08,
      peak: 0.14,
      energy: 0.1,
      transient: 0.04,
      flux: 0.03,
      beat: false,
      beatPulse: false,
      beatConfidence: 0.05,
      bpm: 108,
      bandLow: 0.12,
      bandMid: 0.18,
      bandHigh: 0.1
    },
    profile: {
      payload: {
        compatibility: {
          sceneLock: "impact"
        }
      }
    }
  };

  let out = null;
  for (let i = 0; i < 24; i += 1) {
    out = model.computeSceneState(quietInputWithImpactLock);
    clock += 120;
  }

  assert.equal(String(out?.sceneIntent || ""), "impact");
  assert.notEqual(String(out?.musicalProfile || ""), "aggressive");
});

test("engine-v2 scene model avoids brightness pinning on loud but flat passages", () => {
  let clock = 20500;
  const model = createEngineSceneStateModel({
    now: () => clock
  });

  const loudFlatInput = {
    telemetry: {
      rms: 0.84,
      peak: 0.98,
      energy: 0.9,
      transient: 0.01,
      flux: 0.01,
      beat: false,
      beatPulse: false,
      beatConfidence: 0.04,
      bpm: 116
    },
    profile: {
      payload: {}
    }
  };

  let out = null;
  for (let i = 0; i < 16; i += 1) {
    out = model.computeSceneState(loudFlatInput);
    clock += 120;
  }

  assert.equal(out.sceneIntent, "steady");
  assert.equal(Number(out.brightness || 0) >= 0.1, true);
  assert.equal(Number(out.brightness || 0) <= 0.62, true);
});

test("engine-v2 scene brightness remains stable near floor under low-signal noise", () => {
  let clock = 24000;
  const model = createEngineSceneStateModel({
    now: () => clock
  });
  const series = [];

  for (let i = 0; i < 40; i += 1) {
    const rms = 0.03 + (Math.sin(i / 3) * 0.004);
    const flux = 0.02 + (i % 5 === 0 ? 0.04 : 0);
    const transient = 0.018 + (i % 7 === 0 ? 0.05 : 0);
    const out = model.computeSceneState({
      telemetry: {
        rms,
        energy: rms * 1.2,
        peak: rms * 1.6,
        transient,
        flux,
        beat: false,
        beatPulse: false,
        beatConfidence: 0.04,
        bpm: 108
      },
      profile: {
        payload: {}
      }
    });
    series.push(Number(out?.brightness || 0));
    clock += 120;
  }

  let maxDelta = 0;
  for (let i = 1; i < series.length; i += 1) {
    maxDelta = Math.max(maxDelta, Math.abs(series[i] - series[i - 1]));
  }
  const minBrightness = Math.min(...series);
  assert.equal(minBrightness >= 0.015, true);
  assert.equal(maxDelta <= 0.03, true);
});

test("engine-v2 scene brightness uses near full range from sustained quiet to loud impact", () => {
  let clock = 26800;
  const model = createEngineSceneStateModel({
    now: () => clock
  });

  const quietInput = {
    telemetry: {
      rms: 0.012,
      peak: 0.02,
      energy: 0.014,
      transient: 0.008,
      flux: 0.006,
      beat: false,
      beatPulse: false,
      beatConfidence: 0.02,
      bpm: 120,
      bandLow: 0.02,
      bandMid: 0.03,
      bandHigh: 0.02
    },
    profile: {
      payload: {}
    }
  };
  const loudInput = {
    telemetry: {
      rms: 0.9,
      peak: 0.99,
      energy: 0.94,
      transient: 0.42,
      flux: 0.34,
      beat: true,
      beatPulse: true,
      beatConfidence: 0.92,
      bpm: 154,
      bandLow: 0.82,
      bandMid: 0.66,
      bandHigh: 0.58
    },
    profile: {
      payload: {}
    }
  };

  let quietOut = null;
  for (let i = 0; i < 28; i += 1) {
    quietOut = model.computeSceneState(quietInput);
    clock += 120;
  }

  let loudOut = null;
  for (let i = 0; i < 28; i += 1) {
    loudOut = model.computeSceneState(loudInput);
    clock += 120;
  }

  const quietBrightness = Number(quietOut?.brightness || 0);
  const loudBrightness = Number(loudOut?.brightness || 0);
  assert.equal(quietBrightness <= 0.12, true);
  assert.equal(loudBrightness >= 0.9, true);
  assert.equal((loudBrightness - quietBrightness) >= 0.72, true);
});

test("engine-v2 scene brightness transitions remain smooth under sudden movement spikes", () => {
  let clock = 22000;
  const model = createEngineSceneStateModel({
    now: () => clock
  });

  const baseInput = {
    telemetry: {
      rms: 0.46,
      peak: 0.62,
      energy: 0.5,
      transient: 0.03,
      flux: 0.025,
      beat: false,
      beatPulse: false,
      beatConfidence: 0.08,
      bpm: 118
    },
    profile: {
      payload: {}
    }
  };
  const spikeInput = {
    telemetry: {
      rms: 0.5,
      peak: 0.88,
      energy: 0.58,
      transient: 1,
      flux: 1,
      beat: true,
      beatPulse: true,
      beatConfidence: 0.9,
      bpm: 136
    },
    profile: {
      payload: {}
    }
  };

  let baseOut = null;
  for (let i = 0; i < 8; i += 1) {
    baseOut = model.computeSceneState(baseInput);
    clock += 120;
  }
  const spikeA = model.computeSceneState(spikeInput);
  clock += 120;
  const spikeB = model.computeSceneState(spikeInput);

  const baseBrightness = Number(baseOut?.brightness || 0);
  const spikeABrightness = Number(spikeA?.brightness || 0);
  const spikeBBrightness = Number(spikeB?.brightness || 0);
  assert.equal((spikeABrightness - baseBrightness) <= 0.26, true);
  assert.equal((spikeBBrightness - spikeABrightness) <= 0.26, true);
});
