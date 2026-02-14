// [TITLE] Module: core/rave-engine.js
// [TITLE] Purpose: rave-engine

/**
 * ======================================================
 * RAVE CORE ENGINE v2.9 — HYBRID + NEURAL + MIDI/OSC
 * ======================================================
 * - Hue ALWAYS emits (time-based)
 * - BPM optional, never required
 * - Silence-safe idle glow
 * - Multi-tier output rates (2Hz to 16Hz)
 * - Neural motif memory (per-genre)
 * - Scene presets bound to motifs
 * - Game mode auto-detection (clamp vs interpret)
 * - Phrase + drop prediction (energy-based)
 * - MIDI / OSC reinforcement (soft bias)
 */
// [TITLE] Functionality Index:
// [TITLE] - Telemetry State + Engine Runtime
// [TITLE] - Audio Reactivity Presets + Genre Profiles
// [TITLE] - Beat/Phrase/Drop Detection
// [TITLE] - Behavior + Scene Selection
// [TITLE] - Hue/WiZ Intent Emission
// [TITLE] - Meta Auto Planner
// [TITLE] - MIDI/OSC Bias + External Intent Handling
// [TITLE] - Public Control API (mode/overclock/drop/reactivity)

module.exports = function createRaveEngine(controls) {
  if (!controls || typeof controls.emit !== "function") {
    throw new Error("RAVE engine requires controls.emit()");
  }

  const parseBool = (value, fallback = false) => {
    if (value === true || value === false) return value;
    if (value === 1 || value === "1") return true;
    if (value === 0 || value === "0") return false;
    if (typeof value === "string") {
      const raw = value.trim().toLowerCase();
      if (raw === "true" || raw === "on" || raw === "yes") return true;
      if (raw === "false" || raw === "off" || raw === "no") return false;
    }
    return fallback;
  };
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const clamp255 = v => Math.round(clamp(Number(v) || 0, 0, 255));
  const lerp = (a, b, t) => (Number(a) || 0) + ((Number(b) || 0) - (Number(a) || 0)) * t;
  const blendColor = (a, b, t) => ({
    r: clamp255(lerp(a?.r, b?.r, t)),
    g: clamp255(lerp(a?.g, b?.g, t)),
    b: clamp255(lerp(a?.b, b?.b, t))
  });
  const boostColorSaturation = (color, amount = 0) => {
    const r = clamp255(color?.r);
    const g = clamp255(color?.g);
    const b = clamp255(color?.b);
    const boost = clamp(Number(amount) || 0, 0, 0.65);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (boost <= 0 || max <= 0 || max - min < 1) {
      return { r, g, b };
    }

    const sat = (max - min) / max;
    const targetSat = clamp(sat + ((1 - sat) * boost), sat, 1);
    const targetMin = max * (1 - targetSat);
    const spread = max - min;
    const gain = spread > 0 ? (max - targetMin) / spread : 1;

    return {
      r: clamp255(max - ((max - r) * gain)),
      g: clamp255(max - ((max - g) * gain)),
      b: clamp255(max - ((max - b) * gain))
    };
  };
  const MAX_OVERCLOCK_LEVEL = 12;
  const DEFAULT_OVERCLOCK_LEVEL = clamp(
    Number(process.env.RAVE_DEFAULT_OVERCLOCK_LEVEL ?? 2),
    0,
    MAX_OVERCLOCK_LEVEL
  );
  let dropDetectionEnabled = parseBool(process.env.RAVE_DROP_ENABLED, false);
  const AUTO_PROFILES = {
    reactive: {
      behaviorConfirmMs: 620,
      behaviorMinHoldMs: 1600,
      sceneConfirmMs: 760,
      sceneMinHoldMs: 2200,
      hysteresis: 0.038
    },
    balanced: {
      behaviorConfirmMs: 1250,
      behaviorMinHoldMs: 3300,
      sceneConfirmMs: 1850,
      sceneMinHoldMs: 5200,
      hysteresis: 0.062
    },
    cinematic: {
      behaviorConfirmMs: 2200,
      behaviorMinHoldMs: 5400,
      sceneConfirmMs: 3000,
      sceneMinHoldMs: 7600,
      hysteresis: 0.095
    }
  };
  const AUTO_FLOW_SWITCH_EXTRA_HOLD_MS = 900;
  const AUTO_FLOW_SWITCH_EXTRA_CONFIRM_MS = 320;
  const AUTO_FLOW_TO_FLOW_EXTRA_HOLD_MS = 280;
  const AUTO_FLOW_TO_FLOW_EXTRA_CONFIRM_MS = 180;

  const defaultAutoProfile =
    process.env.RAVE_AUTO_PROFILE &&
    AUTO_PROFILES[process.env.RAVE_AUTO_PROFILE]
      ? process.env.RAVE_AUTO_PROFILE
      : "balanced";

  const AUDIO_REACTIVITY_PRESETS = {
    balanced: {
      multipliers: {}
    },
    aggressive: {
      multipliers: {
        audioGain: 1.22,
        bandLow: 1.18,
        bandMid: 1.2,
        bandHigh: 1.28,
        flux: 1.35,
        intensityFlux: 1.34,
        intensityHigh: 1.28,
        beatBaseClamp: 0.86,
        beatBaseInterpret: 0.84,
        beatTransientLower: 1.32,
        beatFluxLower: 1.42,
        beatLowerCap: 1.3,
        beatRiseBase: 0.84,
        beatRiseTransient: 1.25,
        beatRiseFlux: 1.3,
        beatRiseMin: 0.84,
        beatRiseMax: 1,
        forcePulseFlux: 0.8,
        forcePulseEnergy: 0.78,
        buildTrend: 0.84,
        buildEnergy: 0.82,
        dropSlopeBase: 0.76,
        dropTransient: 0.82,
        dropFlux: 0.8,
        dropEnergyBase: 0.84,
        dropEnergyPad: 0.78,
        dropEnergyTransient: 1.2,
        recoverTrend: 0.84,
        recoverEnergy: 0.84,
        forceFlowLowFlux: 0.86
      }
    },
    precision: {
      multipliers: {
        audioGain: 0.9,
        bandLow: 0.88,
        bandMid: 0.9,
        bandHigh: 0.84,
        flux: 0.8,
        intensityFlux: 0.82,
        intensityHigh: 0.84,
        beatBaseClamp: 1.16,
        beatBaseInterpret: 1.15,
        beatTransientLower: 0.8,
        beatFluxLower: 0.72,
        beatLowerCap: 0.82,
        beatRiseBase: 1.24,
        beatRiseTransient: 0.84,
        beatRiseFlux: 0.78,
        beatRiseMin: 1.24,
        beatRiseMax: 1.26,
        forcePulseFlux: 1.28,
        forcePulseEnergy: 1.24,
        buildTrend: 1.26,
        buildEnergy: 1.18,
        dropSlopeBase: 1.3,
        dropTransient: 0.78,
        dropFlux: 0.74,
        dropEnergyBase: 1.22,
        dropEnergyPad: 1.26,
        dropEnergyTransient: 0.74,
        recoverTrend: 1.22,
        recoverEnergy: 1.14,
        forceFlowLowFlux: 1.18
      }
    }
  };

  const defaultAudioReactivityPreset =
    process.env.RAVE_AUDIO_REACTIVITY_PRESET &&
    AUDIO_REACTIVITY_PRESETS[process.env.RAVE_AUDIO_REACTIVITY_PRESET]
      ? process.env.RAVE_AUDIO_REACTIVITY_PRESET
      : "balanced";

  let autoProfile = defaultAutoProfile;
  let autoSwitch = AUTO_PROFILES[autoProfile];
  let audioReactivityPreset = defaultAudioReactivityPreset;
  const FLOW_INTENSITY_MIN = 0.35;
  const FLOW_INTENSITY_MAX = 2.5;
  let flowIntensity = clamp(
    Number(process.env.RAVE_FLOW_INTENSITY ?? 1),
    FLOW_INTENSITY_MIN,
    FLOW_INTENSITY_MAX
  );
  let wizSceneSync = parseBool(process.env.RAVE_WIZ_SCENE_SYNC, true);

  /* =========================
     TELEMETRY
  ========================= */
  const telemetry = {
    rms: 0,
    energy: 0,
    beat: false,
    beatConfidence: 0,
    beatIntervalMs: 0,
    bpm: 0,
    phase: 0,
    behavior: "idle",
    scene: "idle_soft",
    sceneAgeMs: 0,
    genre: "auto",
    mode: "interpret",
    modeLock: "auto",
    overclockLevel: DEFAULT_OVERCLOCK_LEVEL,
    phrase: "neutral",
    drop: false,
    dropDetectionEnabled: dropDetectionEnabled,
    intensity: 0,
    audioTransient: 0,
    audioPeak: 0,
    audioZcr: 0,
    audioBandLow: 0,
    audioBandMid: 0,
    audioBandHigh: 0,
    audioFlux: 0,
    audioProfile: "auto",
    genreRefTrack: "",
    genreRefBpm: 0,
    genreDetectBpm: 0,
    genreRefMode: "auto",
    genreRefDecade: "10s",
    metaAutoEnabled: false,
    metaAutoReason: "off",
    metaAutoProfile: "",
    metaAutoGenre: "auto",
    metaAutoReactivity: "",
    metaAutoHz: 2,
    metaAutoOverclock: 0,
    overclockAutoEnabled: false,
    overclockAutoReason: "off",
    overclockAutoHz: 2,
    overclockAutoOverclock: DEFAULT_OVERCLOCK_LEVEL,
    audioReactivityPreset: audioReactivityPreset,
    flowIntensity: flowIntensity,
    sceneSync: wizSceneSync,
    wizSceneSync: wizSceneSync,
    wizScene: "idle_soft",
    midiBias: 0,
    oscBias: 0,
    autoProfile: autoProfile
  };

  /* =========================
     AUDIO STATE
  ========================= */
  let audio = 0;
  let audioPeak = 0;
  let audioTransient = 0;
  let audioZcr = 0;
  let audioBandLow = 0;
  let audioBandMid = 0;
  let audioBandHigh = 0;
  let audioFlux = 0;
  let energy = 0;

  function setAudioLevel(v) {
    if (typeof v === "number") {
      audio = clamp(v, 0, 1);
      audioPeak = audio;
      audioTransient = 0;
      audioZcr = 0;
    } else if (v && typeof v === "object") {
      audio = clamp(v.level ?? v.rms ?? 0, 0, 1);
      audioPeak = clamp(v.peak ?? audio, 0, 1.5);
      audioTransient = clamp(v.transient ?? 0, 0, 1.2);
      audioZcr = clamp(v.zcr ?? 0, 0, 1);
      audioBandLow = clamp(v.bandLow ?? 0, 0, 1);
      audioBandMid = clamp(v.bandMid ?? 0, 0, 1);
      audioBandHigh = clamp(v.bandHigh ?? 0, 0, 1);
      audioFlux = clamp(v.spectralFlux ?? 0, 0, 1);
    } else {
      audio = 0;
      audioPeak = 0;
      audioTransient = 0;
      audioZcr = 0;
      audioBandLow = 0;
      audioBandMid = 0;
      audioBandHigh = 0;
      audioFlux = 0;
    }

    // Near-silence deadzone to suppress interface/device noise floor.
    const nearSilence =
      audio < 0.03 &&
      audioPeak < 0.06 &&
      audioTransient < 0.025 &&
      audioFlux < 0.02 &&
      audioZcr < 0.18 &&
      audioBandLow < 0.16 &&
      audioBandMid < 0.16 &&
      audioBandHigh < 0.16;

    if (nearSilence) {
      audio = 0;
      audioPeak = 0;
      audioTransient = 0;
      audioZcr = 0;
      audioBandLow = 0;
      audioBandMid = 0;
      audioBandHigh = 0;
      audioFlux = 0;
    }

    telemetry.rms = audio;
    telemetry.audioPeak = audioPeak;
    telemetry.audioTransient = audioTransient;
    telemetry.audioZcr = audioZcr;
    telemetry.audioBandLow = audioBandLow;
    telemetry.audioBandMid = audioBandMid;
    telemetry.audioBandHigh = audioBandHigh;
    telemetry.audioFlux = audioFlux;
  }

  /* =========================
     GENRE STATE
  ========================= */
  let activeGenre = "auto";
  const GENRE_AUDIO_PROFILES = {
    edm: {
      audioGain: 2.85,
      bandLow: 0.3, bandMid: 0.1, bandHigh: 0.06, flux: 0.12,
      intensityFlux: 0.19, intensityHigh: 0.1,
      beatBaseClamp: 0.28, beatBaseInterpret: 0.255,
      beatTransientLower: 0.09, beatFluxLower: 0.055, beatLowerCap: 0.12,
      beatRiseBase: 0.017, beatRiseTransient: 0.011, beatRiseFlux: 0.006, beatRiseMin: 0.0035, beatRiseMax: 0.02,
      forcePulseFlux: 0.26, forcePulseEnergy: 0.24,
      buildTrend: 0.011, buildEnergy: 0.2,
      dropSlopeBase: -0.03, dropTransient: 0.016, dropFlux: 0.008,
      dropEnergyBase: 0.28, dropEnergyPad: 0.1, dropEnergyTransient: 0.06,
      recoverTrend: 0.008, recoverEnergy: 0.17
    },
    hiphop: {
      audioGain: 2.75,
      bandLow: 0.34, bandMid: 0.09, bandHigh: 0.04, flux: 0.08,
      intensityFlux: 0.12, intensityHigh: 0.06,
      beatBaseClamp: 0.295, beatBaseInterpret: 0.27,
      beatTransientLower: 0.082, beatFluxLower: 0.03, beatLowerCap: 0.105,
      beatRiseBase: 0.0185, beatRiseTransient: 0.01, beatRiseFlux: 0.003, beatRiseMin: 0.0045, beatRiseMax: 0.021,
      forcePulseFlux: 0.34, forcePulseEnergy: 0.28,
      buildTrend: 0.0105, buildEnergy: 0.21,
      dropSlopeBase: -0.031, dropTransient: 0.014, dropFlux: 0.005,
      dropEnergyBase: 0.295, dropEnergyPad: 0.09, dropEnergyTransient: 0.055,
      recoverTrend: 0.0075, recoverEnergy: 0.175
    },
    metal: {
      audioGain: 2.9,
      bandLow: 0.2, bandMid: 0.16, bandHigh: 0.15, flux: 0.16,
      intensityFlux: 0.24, intensityHigh: 0.14,
      beatBaseClamp: 0.275, beatBaseInterpret: 0.245,
      beatTransientLower: 0.09, beatFluxLower: 0.068, beatLowerCap: 0.13,
      beatRiseBase: 0.0165, beatRiseTransient: 0.0115, beatRiseFlux: 0.0075, beatRiseMin: 0.003, beatRiseMax: 0.02,
      forcePulseFlux: 0.21, forcePulseEnergy: 0.2,
      buildTrend: 0.012, buildEnergy: 0.22,
      dropSlopeBase: -0.028, dropTransient: 0.017, dropFlux: 0.01,
      dropEnergyBase: 0.27, dropEnergyPad: 0.1, dropEnergyTransient: 0.055,
      recoverTrend: 0.0085, recoverEnergy: 0.19
    },
    ambient: {
      audioGain: 2.55,
      bandLow: 0.14, bandMid: 0.14, bandHigh: 0.07, flux: 0.04,
      intensityFlux: 0.06, intensityHigh: 0.05,
      beatBaseClamp: 0.325, beatBaseInterpret: 0.295,
      beatTransientLower: 0.055, beatFluxLower: 0.018, beatLowerCap: 0.07,
      beatRiseBase: 0.02, beatRiseTransient: 0.0075, beatRiseFlux: 0.0015, beatRiseMin: 0.0065, beatRiseMax: 0.023,
      forcePulseFlux: 0.5, forcePulseEnergy: 0.34,
      forceFlowLowFlux: 0.18,
      buildTrend: 0.014, buildEnergy: 0.24,
      dropSlopeBase: -0.036, dropTransient: 0.011, dropFlux: 0.002,
      dropEnergyBase: 0.33, dropEnergyPad: 0.07, dropEnergyTransient: 0.04,
      recoverTrend: 0.009, recoverEnergy: 0.2
    },
    house: {
      audioGain: 2.82,
      bandLow: 0.31, bandMid: 0.1, bandHigh: 0.06, flux: 0.1,
      intensityFlux: 0.14, intensityHigh: 0.07,
      beatBaseClamp: 0.29, beatBaseInterpret: 0.262,
      beatTransientLower: 0.085, beatFluxLower: 0.045, beatLowerCap: 0.11,
      beatRiseBase: 0.0178, beatRiseTransient: 0.0105, beatRiseFlux: 0.0045, beatRiseMin: 0.004, beatRiseMax: 0.02,
      forcePulseFlux: 0.28, forcePulseEnergy: 0.245,
      buildTrend: 0.0115, buildEnergy: 0.21,
      dropSlopeBase: -0.031, dropTransient: 0.015, dropFlux: 0.006,
      dropEnergyBase: 0.29, dropEnergyPad: 0.09, dropEnergyTransient: 0.055,
      recoverTrend: 0.0082, recoverEnergy: 0.175
    },
    trance: {
      audioGain: 2.88,
      bandLow: 0.24, bandMid: 0.13, bandHigh: 0.1, flux: 0.16,
      intensityFlux: 0.2, intensityHigh: 0.11,
      beatBaseClamp: 0.276, beatBaseInterpret: 0.248,
      beatTransientLower: 0.092, beatFluxLower: 0.06, beatLowerCap: 0.126,
      beatRiseBase: 0.0168, beatRiseTransient: 0.011, beatRiseFlux: 0.0065, beatRiseMin: 0.0035, beatRiseMax: 0.02,
      forcePulseFlux: 0.23, forcePulseEnergy: 0.22,
      buildTrend: 0.0122, buildEnergy: 0.22,
      dropSlopeBase: -0.029, dropTransient: 0.0165, dropFlux: 0.009,
      dropEnergyBase: 0.278, dropEnergyPad: 0.1, dropEnergyTransient: 0.057,
      recoverTrend: 0.0084, recoverEnergy: 0.184
    },
    dnb: {
      audioGain: 2.94,
      bandLow: 0.22, bandMid: 0.14, bandHigh: 0.14, flux: 0.2,
      intensityFlux: 0.26, intensityHigh: 0.13,
      beatBaseClamp: 0.266, beatBaseInterpret: 0.24,
      beatTransientLower: 0.098, beatFluxLower: 0.072, beatLowerCap: 0.14,
      beatRiseBase: 0.016, beatRiseTransient: 0.012, beatRiseFlux: 0.008, beatRiseMin: 0.003, beatRiseMax: 0.0195,
      forcePulseFlux: 0.2, forcePulseEnergy: 0.19,
      buildTrend: 0.0128, buildEnergy: 0.225,
      dropSlopeBase: -0.027, dropTransient: 0.0175, dropFlux: 0.011,
      dropEnergyBase: 0.272, dropEnergyPad: 0.1, dropEnergyTransient: 0.058,
      recoverTrend: 0.0088, recoverEnergy: 0.19
    },
    pop: {
      audioGain: 2.74,
      bandLow: 0.23, bandMid: 0.14, bandHigh: 0.1, flux: 0.11,
      intensityFlux: 0.13, intensityHigh: 0.09,
      beatBaseClamp: 0.3, beatBaseInterpret: 0.272,
      beatTransientLower: 0.078, beatFluxLower: 0.04, beatLowerCap: 0.102,
      beatRiseBase: 0.0188, beatRiseTransient: 0.0095, beatRiseFlux: 0.004, beatRiseMin: 0.0048, beatRiseMax: 0.021,
      forcePulseFlux: 0.31, forcePulseEnergy: 0.27,
      buildTrend: 0.0112, buildEnergy: 0.205,
      dropSlopeBase: -0.032, dropTransient: 0.0138, dropFlux: 0.006,
      dropEnergyBase: 0.298, dropEnergyPad: 0.088, dropEnergyTransient: 0.052,
      recoverTrend: 0.0078, recoverEnergy: 0.17
    },
    rock: {
      audioGain: 2.84,
      bandLow: 0.28, bandMid: 0.16, bandHigh: 0.1, flux: 0.13,
      intensityFlux: 0.17, intensityHigh: 0.1,
      beatBaseClamp: 0.286, beatBaseInterpret: 0.258,
      beatTransientLower: 0.09, beatFluxLower: 0.05, beatLowerCap: 0.115,
      beatRiseBase: 0.0172, beatRiseTransient: 0.0112, beatRiseFlux: 0.0052, beatRiseMin: 0.0038, beatRiseMax: 0.02,
      forcePulseFlux: 0.27, forcePulseEnergy: 0.24,
      buildTrend: 0.0116, buildEnergy: 0.215,
      dropSlopeBase: -0.03, dropTransient: 0.0158, dropFlux: 0.0072,
      dropEnergyBase: 0.286, dropEnergyPad: 0.094, dropEnergyTransient: 0.055,
      recoverTrend: 0.0082, recoverEnergy: 0.178
    },
    rnb: {
      audioGain: 2.72,
      bandLow: 0.29, bandMid: 0.13, bandHigh: 0.06, flux: 0.075,
      intensityFlux: 0.1, intensityHigh: 0.06,
      beatBaseClamp: 0.302, beatBaseInterpret: 0.276,
      beatTransientLower: 0.074, beatFluxLower: 0.028, beatLowerCap: 0.098,
      beatRiseBase: 0.019, beatRiseTransient: 0.0094, beatRiseFlux: 0.0028, beatRiseMin: 0.0048, beatRiseMax: 0.0215,
      forcePulseFlux: 0.36, forcePulseEnergy: 0.31,
      buildTrend: 0.0102, buildEnergy: 0.205,
      dropSlopeBase: -0.0335, dropTransient: 0.0135, dropFlux: 0.0045,
      dropEnergyBase: 0.3, dropEnergyPad: 0.086, dropEnergyTransient: 0.05,
      recoverTrend: 0.0076, recoverEnergy: 0.168
    },
    techno: {
      audioGain: 2.9,
      bandLow: 0.32, bandMid: 0.09, bandHigh: 0.07, flux: 0.14,
      intensityFlux: 0.2, intensityHigh: 0.08,
      beatBaseClamp: 0.278, beatBaseInterpret: 0.252,
      beatTransientLower: 0.092, beatFluxLower: 0.058, beatLowerCap: 0.122,
      beatRiseBase: 0.0169, beatRiseTransient: 0.0112, beatRiseFlux: 0.006, beatRiseMin: 0.0036, beatRiseMax: 0.02,
      forcePulseFlux: 0.24, forcePulseEnergy: 0.22,
      buildTrend: 0.012, buildEnergy: 0.22,
      dropSlopeBase: -0.029, dropTransient: 0.0162, dropFlux: 0.008,
      dropEnergyBase: 0.281, dropEnergyPad: 0.098, dropEnergyTransient: 0.056,
      recoverTrend: 0.0084, recoverEnergy: 0.182
    },
    media: {
      audioGain: 2.68,
      bandLow: 0.25, bandMid: 0.16, bandHigh: 0.07, flux: 0.06,
      intensityFlux: 0.08, intensityHigh: 0.07,
      beatBaseClamp: 0.312, beatBaseInterpret: 0.286,
      beatTransientLower: 0.068, beatFluxLower: 0.024, beatLowerCap: 0.092,
      beatRiseBase: 0.0195, beatRiseTransient: 0.0086, beatRiseFlux: 0.0022, beatRiseMin: 0.005, beatRiseMax: 0.022,
      forcePulseFlux: 0.4, forcePulseEnergy: 0.33,
      buildTrend: 0.0108, buildEnergy: 0.2,
      dropSlopeBase: -0.034, dropTransient: 0.0125, dropFlux: 0.0038,
      dropEnergyBase: 0.31, dropEnergyPad: 0.082, dropEnergyTransient: 0.048,
      recoverTrend: 0.0074, recoverEnergy: 0.166
    },
    auto: {
      audioGain: 2.8,
      bandLow: 0.22, bandMid: 0.13, bandHigh: 0.08, flux: 0.14,
      intensityFlux: 0.16, intensityHigh: 0.08,
      beatBaseClamp: 0.3, beatBaseInterpret: 0.27,
      beatTransientLower: 0.08, beatFluxLower: 0.04, beatLowerCap: 0.1,
      beatRiseBase: 0.018, beatRiseTransient: 0.01, beatRiseFlux: 0.004, beatRiseMin: 0.004, beatRiseMax: 0.02,
      forcePulseFlux: 0.3, forcePulseEnergy: 0.26,
      buildTrend: 0.012, buildEnergy: 0.22,
      dropSlopeBase: -0.032, dropTransient: 0.015, dropFlux: 0.007,
      dropEnergyBase: 0.3, dropEnergyPad: 0.08, dropEnergyTransient: 0.05,
      recoverTrend: 0.008, recoverEnergy: 0.18
    }
  };
  const GENRE_LABELS = {
    edm: "EDM",
    hiphop: "HIP-HOP",
    metal: "METAL",
    ambient: "AMBIENT",
    house: "HOUSE",
    trance: "TRANCE",
    dnb: "DNB",
    pop: "POP",
    rock: "ROCK",
    rnb: "R&B",
    techno: "TECHNO",
    media: "MEDIA",
    auto: "AUTO MIX"
  };
  const GENRE_ALIASES = {
    "hip-hop": "hiphop",
    "hip hop": "hiphop",
    "drum and bass": "dnb",
    "drum-and-bass": "dnb",
    "drumandbass": "dnb",
    "r&b": "rnb",
    "r and b": "rnb",
    "rhythm and blues": "rnb",
    "rhythm-and-blues": "rnb",
    "rhythmandblues": "rnb",
    rb: "rnb",
    latin: "rnb",
    movie: "media",
    movies: "media",
    film: "media",
    films: "media",
    cinema: "media",
    cinematic: "media",
    soundtrack: "media",
    youtube: "media",
    yt: "media",
    "video mode": "media",
    "cinema mode": "media",
    "auto mix": "auto",
    "auto-mix": "auto",
    automix: "auto"
  };
  const GENRE_REFERENCE_TRACKS = {
    edm: {
      title: "Animals",
      artist: "Martin Garrix",
      bpm: 128,
      detectBpm: 128,
      beatGapScale: 0.46,
      idleOffset: -0.008,
      flowOffset: -0.04,
      pulseFloorOffset: -0.045,
      heavyPromoteEnergy: 0.27,
      heavyPromoteTransient: 0.17,
      heavyPromoteFlux: 0.16,
      heavyPromoteMotion: 0.44,
      motionBeatConfidence: 0.36,
      motionTransient: 0.15,
      motionFlux: 0.15,
      quietRmsGate: 0.11,
      quietTransientGate: 0.15,
      quietFluxGate: 0.13,
      beatThresholdBias: -0.012,
      beatRiseBias: -0.0018
    },
    hiphop: {
      title: "SICKO MODE",
      artist: "Travis Scott",
      bpm: 155,
      detectBpm: 78,
      beatGapScale: 0.52,
      idleOffset: 0.002,
      flowOffset: 0.018,
      pulseFloorOffset: 0.02,
      heavyPromoteEnergy: 0.36,
      heavyPromoteTransient: 0.22,
      heavyPromoteFlux: 0.16,
      heavyPromoteMotion: 0.52,
      motionBeatConfidence: 0.46,
      motionTransient: 0.19,
      motionFlux: 0.16,
      quietRmsGate: 0.13,
      quietTransientGate: 0.18,
      quietFluxGate: 0.15,
      beatThresholdBias: 0.006,
      beatRiseBias: 0.0012
    },
    metal: {
      title: "BFG Division",
      artist: "Mick Gordon",
      bpm: 116,
      detectBpm: 116,
      beatGapScale: 0.44,
      idleOffset: -0.01,
      flowOffset: -0.055,
      pulseFloorOffset: -0.06,
      heavyPromoteEnergy: 0.24,
      heavyPromoteTransient: 0.16,
      heavyPromoteFlux: 0.15,
      heavyPromoteMotion: 0.42,
      motionBeatConfidence: 0.34,
      motionTransient: 0.14,
      motionFlux: 0.14,
      quietRmsGate: 0.1,
      quietTransientGate: 0.14,
      quietFluxGate: 0.12,
      beatThresholdBias: -0.018,
      beatRiseBias: -0.0022
    },
    ambient: {
      title: "Weightless",
      artist: "Marconi Union",
      bpm: 71,
      detectBpm: 71,
      beatGapScale: 0.58,
      idleOffset: 0.018,
      flowOffset: 0.12,
      pulseFloorOffset: 0.11,
      heavyPromoteEnergy: 0.5,
      heavyPromoteTransient: 0.3,
      heavyPromoteFlux: 0.28,
      heavyPromoteMotion: 0.66,
      motionBeatConfidence: 0.56,
      motionTransient: 0.24,
      motionFlux: 0.24,
      quietRmsGate: 0.16,
      quietTransientGate: 0.2,
      quietFluxGate: 0.18,
      beatThresholdBias: 0.03,
      beatRiseBias: 0.0032
    },
    house: {
      title: "One More Time",
      artist: "Daft Punk",
      bpm: 126,
      detectBpm: 126,
      beatGapScale: 0.47,
      idleOffset: -0.004,
      flowOffset: -0.022,
      pulseFloorOffset: -0.024,
      heavyPromoteEnergy: 0.29,
      heavyPromoteTransient: 0.18,
      heavyPromoteFlux: 0.17,
      heavyPromoteMotion: 0.46,
      motionBeatConfidence: 0.4,
      motionTransient: 0.16,
      motionFlux: 0.16,
      quietRmsGate: 0.115,
      quietTransientGate: 0.16,
      quietFluxGate: 0.14,
      beatThresholdBias: -0.008,
      beatRiseBias: -0.001
    },
    trance: {
      title: "Adagio for Strings",
      artist: "Tiesto",
      bpm: 140,
      detectBpm: 140,
      beatGapScale: 0.44,
      idleOffset: -0.006,
      flowOffset: -0.032,
      pulseFloorOffset: -0.035,
      heavyPromoteEnergy: 0.27,
      heavyPromoteTransient: 0.17,
      heavyPromoteFlux: 0.16,
      heavyPromoteMotion: 0.45,
      motionBeatConfidence: 0.38,
      motionTransient: 0.15,
      motionFlux: 0.15,
      quietRmsGate: 0.11,
      quietTransientGate: 0.15,
      quietFluxGate: 0.13,
      beatThresholdBias: -0.012,
      beatRiseBias: -0.0015
    },
    dnb: {
      title: "Blood Sugar",
      artist: "Pendulum",
      bpm: 176,
      detectBpm: 176,
      beatGapScale: 0.4,
      idleOffset: -0.012,
      flowOffset: -0.06,
      pulseFloorOffset: -0.065,
      heavyPromoteEnergy: 0.23,
      heavyPromoteTransient: 0.15,
      heavyPromoteFlux: 0.14,
      heavyPromoteMotion: 0.4,
      motionBeatConfidence: 0.33,
      motionTransient: 0.14,
      motionFlux: 0.13,
      quietRmsGate: 0.1,
      quietTransientGate: 0.14,
      quietFluxGate: 0.12,
      beatThresholdBias: -0.022,
      beatRiseBias: -0.0026
    },
    pop: {
      title: "Blinding Lights",
      artist: "The Weeknd",
      bpm: 171,
      detectBpm: 86,
      beatGapScale: 0.43,
      idleOffset: -0.002,
      flowOffset: -0.014,
      pulseFloorOffset: -0.01,
      heavyPromoteEnergy: 0.33,
      heavyPromoteTransient: 0.2,
      heavyPromoteFlux: 0.18,
      heavyPromoteMotion: 0.5,
      motionBeatConfidence: 0.42,
      motionTransient: 0.18,
      motionFlux: 0.17,
      quietRmsGate: 0.12,
      quietTransientGate: 0.17,
      quietFluxGate: 0.15,
      beatThresholdBias: -0.004,
      beatRiseBias: -0.0006
    },
    rock: {
      title: "Seven Nation Army",
      artist: "The White Stripes",
      bpm: 124,
      detectBpm: 124,
      beatGapScale: 0.46,
      idleOffset: -0.006,
      flowOffset: -0.03,
      pulseFloorOffset: -0.035,
      heavyPromoteEnergy: 0.28,
      heavyPromoteTransient: 0.17,
      heavyPromoteFlux: 0.16,
      heavyPromoteMotion: 0.45,
      motionBeatConfidence: 0.39,
      motionTransient: 0.16,
      motionFlux: 0.15,
      quietRmsGate: 0.11,
      quietTransientGate: 0.15,
      quietFluxGate: 0.13,
      beatThresholdBias: -0.01,
      beatRiseBias: -0.0013
    },
    rnb: {
      title: "No Diggity",
      artist: "Blackstreet",
      bpm: 88,
      detectBpm: 88,
      beatGapScale: 0.52,
      idleOffset: 0.004,
      flowOffset: 0.024,
      pulseFloorOffset: 0.03,
      heavyPromoteEnergy: 0.38,
      heavyPromoteTransient: 0.23,
      heavyPromoteFlux: 0.18,
      heavyPromoteMotion: 0.55,
      motionBeatConfidence: 0.48,
      motionTransient: 0.2,
      motionFlux: 0.17,
      quietRmsGate: 0.13,
      quietTransientGate: 0.18,
      quietFluxGate: 0.15,
      beatThresholdBias: 0.008,
      beatRiseBias: 0.001
    },
    techno: {
      title: "The Bells",
      artist: "Jeff Mills",
      bpm: 138,
      detectBpm: 138,
      beatGapScale: 0.43,
      idleOffset: -0.01,
      flowOffset: -0.05,
      pulseFloorOffset: -0.055,
      heavyPromoteEnergy: 0.24,
      heavyPromoteTransient: 0.16,
      heavyPromoteFlux: 0.15,
      heavyPromoteMotion: 0.41,
      motionBeatConfidence: 0.35,
      motionTransient: 0.145,
      motionFlux: 0.14,
      quietRmsGate: 0.105,
      quietTransientGate: 0.145,
      quietFluxGate: 0.125,
      beatThresholdBias: -0.017,
      beatRiseBias: -0.002
    },
    media: {
      title: "Time",
      artist: "Hans Zimmer",
      bpm: 62,
      detectBpm: 62,
      beatGapScale: 0.56,
      idleOffset: 0.01,
      flowOffset: 0.052,
      pulseFloorOffset: 0.07,
      heavyPromoteEnergy: 0.44,
      heavyPromoteTransient: 0.27,
      heavyPromoteFlux: 0.24,
      heavyPromoteMotion: 0.6,
      motionBeatConfidence: 0.52,
      motionTransient: 0.21,
      motionFlux: 0.2,
      quietRmsGate: 0.145,
      quietTransientGate: 0.19,
      quietFluxGate: 0.17,
      beatThresholdBias: 0.016,
      beatRiseBias: 0.0024
    },
    auto: {
      title: "Cross-Genre Blend",
      artist: "Adaptive Profile",
      bpm: 124,
      detectBpm: 124,
      beatGapScale: 0.46,
      idleOffset: 0,
      flowOffset: 0,
      pulseFloorOffset: 0,
      heavyPromoteEnergy: 0.32,
      heavyPromoteTransient: 0.22,
      heavyPromoteFlux: 0.2,
      heavyPromoteMotion: 0.52,
      motionBeatConfidence: 0.44,
      motionTransient: 0.18,
      motionFlux: 0.18,
      quietRmsGate: 0.12,
      quietTransientGate: 0.16,
      quietFluxGate: 0.14,
      beatThresholdBias: 0,
      beatRiseBias: 0
    }
  };
  const SUPPORTED_GENRE_DECADES = ["90s", "00s", "10s", "20s"];
  const GENRE_DECADE_ALIASES = {
    "1990s": "90s",
    "2000s": "00s",
    "2010s": "10s",
    "2020s": "20s"
  };
  const DEFAULT_GENRE_DECADE = "10s";
  const DEFAULT_GENRE_DECADE_BY_GENRE = {
    ambient: "00s",
    rnb: "90s",
    media: "10s",
    auto: "10s"
  };
  const GENRE_DECADE_STYLE_BIAS = {
    "90s": {
      beatGapScale: 0.035,
      flowOffset: 0.02,
      pulseFloorOffset: 0.03,
      quietRmsGate: 0.03,
      quietTransientGate: 0.03,
      quietFluxGate: 0.028,
      heavyPromoteEnergy: 0.045,
      heavyPromoteMotion: 0.06,
      motionBeatConfidence: 0.05,
      motionTransient: 0.03,
      motionFlux: 0.03,
      beatThresholdBias: 0.012,
      beatRiseBias: 0.0016,
      metaAggressionBias: -0.14,
      metaOverclockBias: -2,
      metaVariationBias: -0.09
    },
    "00s": {
      beatGapScale: 0.018,
      flowOffset: 0.01,
      pulseFloorOffset: 0.014,
      quietRmsGate: 0.012,
      quietTransientGate: 0.012,
      quietFluxGate: 0.01,
      heavyPromoteEnergy: 0.02,
      heavyPromoteMotion: 0.03,
      motionBeatConfidence: 0.018,
      motionTransient: 0.012,
      motionFlux: 0.012,
      beatThresholdBias: 0.005,
      beatRiseBias: 0.0008,
      metaAggressionBias: -0.04,
      metaOverclockBias: -1,
      metaVariationBias: -0.03
    },
    "10s": {
      beatGapScale: 0,
      flowOffset: 0,
      pulseFloorOffset: 0,
      quietRmsGate: 0,
      beatThresholdBias: 0,
      beatRiseBias: 0,
      metaAggressionBias: 0,
      metaOverclockBias: 0,
      metaVariationBias: 0
    },
    "20s": {
      beatGapScale: -0.02,
      flowOffset: -0.015,
      pulseFloorOffset: -0.02,
      quietRmsGate: -0.016,
      quietTransientGate: -0.016,
      quietFluxGate: -0.014,
      heavyPromoteEnergy: -0.03,
      heavyPromoteMotion: -0.04,
      motionBeatConfidence: -0.03,
      motionTransient: -0.02,
      motionFlux: -0.02,
      beatThresholdBias: -0.01,
      beatRiseBias: -0.0014,
      metaAggressionBias: 0.12,
      metaOverclockBias: 2,
      metaVariationBias: 0.1
    }
  };
  const GENRE_REFERENCE_TRACKS_BY_DECADE = {
    edm: {
      "90s": { title: "Children", artist: "Robert Miles", bpm: 137, detectBpm: 137 },
      "00s": { title: "Satisfaction", artist: "Benny Benassi", bpm: 126, detectBpm: 126 },
      "10s": GENRE_REFERENCE_TRACKS.edm,
      "20s": { title: "Turn On The Lights again..", artist: "Fred again.. x Swedish House Mafia", bpm: 132, detectBpm: 132 }
    },
    hiphop: {
      "90s": { title: "Nuthin' but a 'G' Thang", artist: "Dr. Dre", bpm: 94, detectBpm: 94 },
      "00s": { title: "In Da Club", artist: "50 Cent", bpm: 90, detectBpm: 90 },
      "10s": GENRE_REFERENCE_TRACKS.hiphop,
      "20s": { title: "Rich Flex", artist: "Drake & 21 Savage", bpm: 154, detectBpm: 77 }
    },
    metal: {
      "90s": { title: "Walk", artist: "Pantera", bpm: 116, detectBpm: 116 },
      "00s": { title: "Duality", artist: "Slipknot", bpm: 150, detectBpm: 75 },
      "10s": GENRE_REFERENCE_TRACKS.metal,
      "20s": { title: "Parasite Eve", artist: "Bring Me The Horizon", bpm: 140, detectBpm: 140 }
    },
    ambient: {
      "90s": { title: "Porcelain", artist: "Moby", bpm: 96, detectBpm: 96 },
      "00s": { title: "Aqueous Transmission", artist: "Incubus", bpm: 80, detectBpm: 80 },
      "10s": GENRE_REFERENCE_TRACKS.ambient,
      "20s": { title: "Promises", artist: "Floating Points", bpm: 68, detectBpm: 68 }
    },
    house: {
      "90s": { title: "Show Me Love", artist: "Robin S.", bpm: 120, detectBpm: 120 },
      "00s": GENRE_REFERENCE_TRACKS.house,
      "10s": { title: "Latch", artist: "Disclosure ft. Sam Smith", bpm: 122, detectBpm: 122 },
      "20s": { title: "B.O.T.A.", artist: "Eliza Rose & Interplanetary Criminal", bpm: 127, detectBpm: 127 }
    },
    trance: {
      "90s": { title: "For an Angel", artist: "Paul van Dyk", bpm: 138, detectBpm: 138 },
      "00s": GENRE_REFERENCE_TRACKS.trance,
      "10s": { title: "Opus", artist: "Eric Prydz", bpm: 126, detectBpm: 126 },
      "20s": { title: "Escape", artist: "Kx5 ft. Hayla", bpm: 126, detectBpm: 126 }
    },
    dnb: {
      "90s": { title: "Circles", artist: "Adam F", bpm: 174, detectBpm: 174 },
      "00s": GENRE_REFERENCE_TRACKS.dnb,
      "10s": { title: "Afterglow", artist: "Wilkinson", bpm: 174, detectBpm: 174 },
      "20s": { title: "Solar System", artist: "Sub Focus", bpm: 174, detectBpm: 174 }
    },
    pop: {
      "90s": { title: "...Baby One More Time", artist: "Britney Spears", bpm: 93, detectBpm: 93 },
      "00s": { title: "Toxic", artist: "Britney Spears", bpm: 143, detectBpm: 143 },
      "10s": GENRE_REFERENCE_TRACKS.pop,
      "20s": { title: "As It Was", artist: "Harry Styles", bpm: 174, detectBpm: 87 }
    },
    rock: {
      "90s": { title: "Smells Like Teen Spirit", artist: "Nirvana", bpm: 117, detectBpm: 117 },
      "00s": GENRE_REFERENCE_TRACKS.rock,
      "10s": { title: "Do I Wanna Know?", artist: "Arctic Monkeys", bpm: 85, detectBpm: 85 },
      "20s": { title: "The Adults Are Talking", artist: "The Strokes", bpm: 164, detectBpm: 82 }
    },
    rnb: {
      "90s": GENRE_REFERENCE_TRACKS.rnb,
      "00s": { title: "U Got It Bad", artist: "Usher", bpm: 100, detectBpm: 100 },
      "10s": { title: "Adorn", artist: "Miguel", bpm: 94, detectBpm: 94 },
      "20s": { title: "Snooze", artist: "SZA", bpm: 73, detectBpm: 73 }
    },
    techno: {
      "90s": GENRE_REFERENCE_TRACKS.techno,
      "00s": { title: "Knights of the Jaguar", artist: "DJ Rolando", bpm: 132, detectBpm: 132 },
      "10s": { title: "Your Mind", artist: "Adam Beyer & Bart Skils", bpm: 128, detectBpm: 128 },
      "20s": { title: "Age Of Love (Charlotte de Witte & Enrico Sangiuliano Remix)", artist: "Age Of Love", bpm: 135, detectBpm: 135 }
    },
    media: {
      "90s": { title: "Clubbed to Death", artist: "Rob Dougan", bpm: 90, detectBpm: 90 },
      "00s": { title: "Lux Aeterna", artist: "Clint Mansell", bpm: 81, detectBpm: 81 },
      "10s": GENRE_REFERENCE_TRACKS.media,
      "20s": { title: "Can You Hear The Music", artist: "Ludwig Goransson", bpm: 74, detectBpm: 74 }
    },
    auto: {
      "90s": { title: "Around the World", artist: "Daft Punk", bpm: 121, detectBpm: 121 },
      "00s": { title: "Crazy in Love", artist: "Beyonce ft. Jay-Z", bpm: 99, detectBpm: 99 },
      "10s": { title: "Uptown Funk", artist: "Mark Ronson ft. Bruno Mars", bpm: 115, detectBpm: 115 },
      "20s": { title: "Levitating", artist: "Dua Lipa", bpm: 103, detectBpm: 103 }
    }
  };
  const SUPPORTED_GENRES = Object.keys(GENRE_AUDIO_PROFILES);
  let genreDecadeMode = "auto";
  let resolvedGenreDecade = DEFAULT_GENRE_DECADE;
  let lastGenreReferenceRefreshAt = 0;

  function normalizeGenreDecadeMode(mode) {
    const raw = String(mode || "").trim().toLowerCase();
    if (!raw) return "auto";
    if (raw === "auto") return "auto";
    if (SUPPORTED_GENRE_DECADES.includes(raw)) return raw;
    if (GENRE_DECADE_ALIASES[raw]) return GENRE_DECADE_ALIASES[raw];
    return null;
  }

  function getDefaultGenreDecade(genreName) {
    return (
      DEFAULT_GENRE_DECADE_BY_GENRE[genreName] ||
      DEFAULT_GENRE_DECADE_BY_GENRE.auto ||
      DEFAULT_GENRE_DECADE
    );
  }

  function getGenreDecadeReferences(genreName) {
    return GENRE_REFERENCE_TRACKS_BY_DECADE[genreName] || GENRE_REFERENCE_TRACKS_BY_DECADE.auto;
  }

  function getGenreReferenceTrackForDecade(genreName, decade) {
    const normalizedGenre = normalizeGenreName(genreName) || "auto";
    const normalizedDecade = normalizeGenreDecadeMode(decade) || getDefaultGenreDecade(normalizedGenre);
    const decadeRefs = getGenreDecadeReferences(normalizedGenre);
    const fallbackDecade = getDefaultGenreDecade(normalizedGenre);
    const track =
      decadeRefs[normalizedDecade] ||
      decadeRefs[fallbackDecade] ||
      decadeRefs[DEFAULT_GENRE_DECADE] ||
      GENRE_REFERENCE_TRACKS[normalizedGenre] ||
      GENRE_REFERENCE_TRACKS.auto;
    return { ...(track || GENRE_REFERENCE_TRACKS.auto) };
  }

  function mergeGenreReferenceWithDecadeStyle(reference, decade) {
    const style = GENRE_DECADE_STYLE_BIAS[decade] || GENRE_DECADE_STYLE_BIAS[DEFAULT_GENRE_DECADE];
    const merged = { ...(reference || GENRE_REFERENCE_TRACKS.auto) };
    if (!style) return merged;

    for (const [key, value] of Object.entries(style)) {
      if (typeof value !== "number") continue;
      if (typeof merged[key] === "number") {
        merged[key] += value;
      } else {
        merged[key] = value;
      }
    }

    return merged;
  }

  function pickAutoGenreDecade(genreName) {
    const normalizedGenre = normalizeGenreName(genreName) || "auto";
    const decadeRefs = getGenreDecadeReferences(normalizedGenre);
    const defaultDecade = getDefaultGenreDecade(normalizedGenre);
    const beatConfidence = clamp(Number(telemetry.beatConfidence || 0), 0, 1);
    const liveBpm = Number(telemetry.bpm || 0);
    const bpmHint =
      liveBpm > 0 && beatConfidence >= 0.24
        ? liveBpm
        : 0;

    if (bpmHint > 0) {
      let bestDecade = defaultDecade;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const decade of SUPPORTED_GENRE_DECADES) {
        const ref = decadeRefs[decade];
        if (!ref) continue;
        const candidateBpm = Number(ref.detectBpm || ref.bpm || 0);
        if (!(candidateBpm > 0)) continue;
        const diff = Math.abs(candidateBpm - bpmHint);
        const stickyBonus = decade === resolvedGenreDecade ? -0.6 : 0;
        const score = diff + stickyBonus;
        if (score < bestScore) {
          bestScore = score;
          bestDecade = decade;
        }
      }
      return bestDecade;
    }

    const motion = clamp(
      Math.max(audioTransient, audioFlux, Number(telemetry.beatConfidence || 0)),
      0,
      1
    );
    const drive = getEnergyDrive();

    // Keep quiet states neutral instead of forcing 90s.
    if (motion < 0.1 && drive < 0.12) return defaultDecade;
    if (motion > 0.54 || drive > 0.62) return "20s";
    if (motion < 0.2 && drive < 0.24) return "00s";
    if (motion > 0.33 || drive > 0.4) return "10s";
    return defaultDecade;
  }

  function resolveGenreReferenceTrack(genreName) {
    const normalizedGenre = normalizeGenreName(genreName) || "auto";
    const targetDecade =
      genreDecadeMode === "auto"
        ? pickAutoGenreDecade(normalizedGenre)
        : genreDecadeMode;

    const rawRef = getGenreReferenceTrackForDecade(normalizedGenre, targetDecade);
    const mergedRef = mergeGenreReferenceWithDecadeStyle(rawRef, targetDecade);

    mergedRef.decade = targetDecade;
    mergedRef.decadeMode = genreDecadeMode;

    return {
      reference: mergedRef,
      decade: targetDecade
    };
  }

  function getGenreReferenceTrack(genreName) {
    return resolveGenreReferenceTrack(genreName).reference;
  }

  function normalizeGenreName(name) {
    const raw = String(name || "").trim().toLowerCase();
    if (!raw) return "auto";

    if (SUPPORTED_GENRES.includes(raw)) return raw;
    if (GENRE_ALIASES[raw]) return GENRE_ALIASES[raw];

    const squashed = raw.replace(/[\s_-]+/g, "");
    if (SUPPORTED_GENRES.includes(squashed)) return squashed;

    return null;
  }

  genreDecadeMode =
    normalizeGenreDecadeMode(process.env.RAVE_GENRE_DECADE_MODE) || "auto";

  let effectiveGenreAudioProfile = GENRE_AUDIO_PROFILES.auto;
  let effectiveGenreReference = getGenreReferenceTrackForDecade("auto", DEFAULT_GENRE_DECADE);

  function buildGenreAudioProfile(genreName, reactivityPreset) {
    const base = GENRE_AUDIO_PROFILES[genreName] || GENRE_AUDIO_PROFILES.auto;
    const preset = AUDIO_REACTIVITY_PRESETS[reactivityPreset] || AUDIO_REACTIVITY_PRESETS.balanced;
    const profile = { ...base };

    const multipliers = preset.multipliers || {};
    for (const [key, scale] of Object.entries(multipliers)) {
      if (typeof profile[key] === "number") {
        profile[key] *= scale;
      }
    }

    profile.audioGain = clamp(profile.audioGain, 2.2, 3.6);
    profile.bandLow = clamp(profile.bandLow, 0.05, 0.5);
    profile.bandMid = clamp(profile.bandMid, 0.05, 0.5);
    profile.bandHigh = clamp(profile.bandHigh, 0.03, 0.35);
    profile.flux = clamp(profile.flux, 0.01, 0.25);
    profile.intensityFlux = clamp(profile.intensityFlux, 0.02, 0.35);
    profile.intensityHigh = clamp(profile.intensityHigh, 0.02, 0.25);
    profile.beatBaseClamp = clamp(profile.beatBaseClamp, 0.16, 0.38);
    profile.beatBaseInterpret = clamp(profile.beatBaseInterpret, 0.16, 0.38);
    profile.beatTransientLower = clamp(profile.beatTransientLower, 0.03, 0.14);
    profile.beatFluxLower = clamp(profile.beatFluxLower, 0.01, 0.1);
    profile.beatLowerCap = clamp(profile.beatLowerCap, 0.04, 0.2);
    profile.beatRiseBase = clamp(profile.beatRiseBase, 0.01, 0.03);
    profile.beatRiseTransient = clamp(profile.beatRiseTransient, 0.0005, 0.03);
    profile.beatRiseFlux = clamp(profile.beatRiseFlux, 0.0005, 0.02);
    profile.beatRiseMin = clamp(profile.beatRiseMin, 0.001, 0.015);
    profile.beatRiseMax = Math.max(
      profile.beatRiseMin + 0.002,
      clamp(profile.beatRiseMax, 0.008, 0.04)
    );
    profile.forcePulseFlux = clamp(profile.forcePulseFlux, 0.08, 0.65);
    profile.forcePulseEnergy = clamp(profile.forcePulseEnergy, 0.08, 0.6);
    profile.buildTrend = clamp(profile.buildTrend, 0.005, 0.03);
    profile.buildEnergy = clamp(profile.buildEnergy, 0.1, 0.4);
    profile.dropSlopeBase = clamp(profile.dropSlopeBase, -0.06, -0.008);
    profile.dropTransient = clamp(profile.dropTransient, 0.002, 0.03);
    profile.dropFlux = clamp(profile.dropFlux, 0.001, 0.02);
    profile.dropEnergyBase = clamp(profile.dropEnergyBase, 0.18, 0.45);
    profile.dropEnergyPad = clamp(profile.dropEnergyPad, 0.03, 0.2);
    profile.dropEnergyTransient = clamp(profile.dropEnergyTransient, 0.01, 0.1);
    profile.recoverTrend = clamp(profile.recoverTrend, 0.004, 0.02);
    profile.recoverEnergy = clamp(profile.recoverEnergy, 0.12, 0.35);

    if (profile.forceFlowLowFlux !== undefined) {
      profile.forceFlowLowFlux = clamp(profile.forceFlowLowFlux, 0.05, 0.4);
    }

    return profile;
  }

  function applyResolvedGenreReference(resolved) {
    const next = resolved && resolved.reference
      ? resolved
      : resolveGenreReferenceTrack(activeGenre);
    effectiveGenreReference = next.reference;
    resolvedGenreDecade = next.decade || getDefaultGenreDecade(activeGenre);
    telemetry.genreRefTrack = `${effectiveGenreReference.artist} - ${effectiveGenreReference.title}`;
    telemetry.genreRefBpm = Number(effectiveGenreReference.bpm || 0);
    telemetry.genreDetectBpm = Number(
      effectiveGenreReference.detectBpm || effectiveGenreReference.bpm || 0
    );
    telemetry.genreRefMode = genreDecadeMode;
    telemetry.genreRefDecade = resolvedGenreDecade;
  }

  function rebuildGenreAudioProfile() {
    effectiveGenreAudioProfile = buildGenreAudioProfile(activeGenre, audioReactivityPreset);
    telemetry.audioProfile = activeGenre;
    applyResolvedGenreReference(resolveGenreReferenceTrack(activeGenre));
    telemetry.audioReactivityPreset = audioReactivityPreset;
    lastGenreReferenceRefreshAt = 0;
  }

  function maybeRefreshGenreReference(now = Date.now()) {
    if (genreDecadeMode !== "auto") return;
    if (now - lastGenreReferenceRefreshAt < 1600) return;
    lastGenreReferenceRefreshAt = now;

    const resolved = resolveGenreReferenceTrack(activeGenre);
    if (resolved.decade !== resolvedGenreDecade) {
      applyResolvedGenreReference(resolved);
    }
  }

  function setGenreDecadeMode(mode) {
    const normalized = normalizeGenreDecadeMode(mode);
    if (!normalized) return false;
    genreDecadeMode = normalized;
    rebuildGenreAudioProfile();
    return {
      mode: genreDecadeMode,
      resolved: resolvedGenreDecade
    };
  }

  function getGenreDecadeMode() {
    return genreDecadeMode;
  }

  function getResolvedGenreDecade() {
    return resolvedGenreDecade;
  }

  function getSupportedGenreDecades() {
    return [...SUPPORTED_GENRE_DECADES];
  }

  function getGenreAudioProfile() {
    return effectiveGenreAudioProfile;
  }

  function setAudioReactivityPreset(name) {
    if (!AUDIO_REACTIVITY_PRESETS[name]) return false;
    audioReactivityPreset = name;
    rebuildGenreAudioProfile();
    return true;
  }

  function setGenre(g) {
    const normalized = normalizeGenreName(g);
    activeGenre = normalized || "auto";
    telemetry.genre = activeGenre;
    if (activeGenre === "auto") {
      const now = Date.now();
      autoFlowStableScene = "flow_wash";
      autoFlowCandidateScene = autoFlowStableScene;
      autoFlowCandidateSince = now;
      autoFlowLastChangeAt = now;
    }
    rebuildGenreAudioProfile();
    return activeGenre;
  }

  function getSupportedGenres() {
    return [...SUPPORTED_GENRES];
  }

  function getGenreCatalog() {
    return SUPPORTED_GENRES.map(id => {
      const selectedDecade =
        genreDecadeMode === "auto"
          ? getDefaultGenreDecade(id)
          : genreDecadeMode;
      const selectedRef = getGenreReferenceTrackForDecade(id, selectedDecade);
      return {
        id,
        label: GENRE_LABELS[id] || id.toUpperCase(),
        referenceTrack: selectedRef.title,
        referenceArtist: selectedRef.artist,
        referenceBpm: Number(selectedRef.bpm || 0),
        referenceDecade: selectedDecade,
        referencesByDecade: Object.fromEntries(
          SUPPORTED_GENRE_DECADES.map(decade => {
            const ref = getGenreReferenceTrackForDecade(id, decade);
            return [decade, {
              title: ref.title,
              artist: ref.artist,
              bpm: Number(ref.bpm || 0),
              detectBpm: Number(ref.detectBpm || ref.bpm || 0)
            }];
          })
        )
      };
    });
  }

  rebuildGenreAudioProfile();

  /* =========================
     NEURAL MOTIF MEMORY
  ========================= */
  const MEMORY = {};

  function getGenreMemory(genre) {
    if (!MEMORY[genre]) {
      MEMORY[genre] = { idle: 1, flow: 1, pulse: 1 };
    }
    return MEMORY[genre];
  }

  function reinforce(genre, behavior, amount) {
    const mem = getGenreMemory(genre);
    mem[behavior] += amount;

    for (const k of Object.keys(mem)) {
      if (k !== behavior) mem[k] *= 0.995;
      mem[k] = clamp(mem[k], 0.5, 3);
    }
  }

  /* =========================
     SCENES
  ========================= */
  // Scene lock (manual override)
  const FLOW_DYNAMIC_LOCK = "__flow_dynamic__";
  let forcedScene = null; // null = AUTO
  let forcedSceneInput = null;

  const SCENES = {
    idle_soft: {
      sat: 160,
      briBase: 90,
      briWave: 30,
      hueSpeed: 3000,
      transition: 12
    },
    flow_wash: {
      sat: 186,
      briBase: 116,
      briScale: 92,
      briWave: 28,
      hueTimeDiv: 92,
      hueSwing: 4200,
      hueStep: 340,
      transition: 6,
      briMin: 110,
      briMax: 225,
      beatLift: 14,
      dropLift: 24
    },
    flow_edm: {
      sat: 212,
      briBase: 126,
      briScale: 104,
      briWave: 34,
      hueTimeDiv: 78,
      hueSwing: 5600,
      hueStep: 560,
      transition: 4,
      briMin: 120,
      briMax: 246,
      beatLift: 16,
      dropLift: 28
    },
    flow_hiphop: {
      sat: 170,
      briBase: 106,
      briScale: 84,
      briWave: 20,
      hueTimeDiv: 122,
      hueSwing: 3000,
      hueStep: 240,
      transition: 7,
      briMin: 96,
      briMax: 212,
      beatLift: 8,
      dropLift: 14
    },
    flow_metal: {
      sat: 236,
      briBase: 138,
      briScale: 118,
      briWave: 42,
      hueTimeDiv: 62,
      hueSwing: 7600,
      hueStep: 1320,
      transition: 3,
      briMin: 138,
      briMax: 254,
      beatLift: 24,
      dropLift: 34
    },
    flow_ambient: {
      sat: 128,
      briBase: 92,
      briScale: 62,
      briWave: 14,
      hueTimeDiv: 184,
      hueSwing: 1850,
      hueStep: 120,
      transition: 10,
      briMin: 80,
      briMax: 188,
      beatLift: 3,
      dropLift: 8
    },
    flow_house: {
      sat: 198,
      briBase: 118,
      briScale: 92,
      briWave: 24,
      hueTimeDiv: 108,
      hueSwing: 3800,
      hueStep: 290,
      transition: 5,
      briMin: 105,
      briMax: 228,
      beatLift: 12,
      dropLift: 20
    },
    flow_trance: {
      sat: 214,
      briBase: 122,
      briScale: 100,
      briWave: 30,
      hueTimeDiv: 84,
      hueSwing: 6200,
      hueStep: 520,
      transition: 4,
      briMin: 112,
      briMax: 240,
      beatLift: 15,
      dropLift: 24
    },
    flow_dnb: {
      sat: 236,
      briBase: 134,
      briScale: 110,
      briWave: 36,
      hueTimeDiv: 68,
      hueSwing: 7000,
      hueStep: 980,
      transition: 3,
      briMin: 126,
      briMax: 252,
      beatLift: 20,
      dropLift: 30
    },
    flow_pop: {
      sat: 182,
      briBase: 120,
      briScale: 84,
      briWave: 22,
      hueTimeDiv: 126,
      hueSwing: 3200,
      hueStep: 210,
      transition: 6,
      briMin: 104,
      briMax: 224,
      beatLift: 10,
      dropLift: 16
    },
    flow_rock: {
      sat: 220,
      briBase: 124,
      briScale: 102,
      briWave: 30,
      hueTimeDiv: 86,
      hueSwing: 5100,
      hueStep: 620,
      transition: 4,
      briMin: 114,
      briMax: 242,
      beatLift: 16,
      dropLift: 25
    },
    flow_rnb: {
      sat: 172,
      briBase: 112,
      briScale: 80,
      briWave: 18,
      hueTimeDiv: 132,
      hueSwing: 2550,
      hueStep: 180,
      transition: 7,
      briMin: 98,
      briMax: 214,
      beatLift: 8,
      dropLift: 12
    },
    flow_media: {
      sat: 156,
      briBase: 104,
      briScale: 76,
      briWave: 16,
      hueTimeDiv: 148,
      hueSwing: 2200,
      hueStep: 140,
      transition: 8,
      briMin: 92,
      briMax: 206,
      beatLift: 7,
      dropLift: 13
    },
    flow_techno: {
      sat: 232,
      briBase: 132,
      briScale: 106,
      briWave: 34,
      hueTimeDiv: 72,
      hueSwing: 6600,
      hueStep: 860,
      transition: 3,
      briMin: 122,
      briMax: 250,
      beatLift: 19,
      dropLift: 28
    },
    flow_cyberpunk: {
      sat: 226,
      briBase: 126,
      briScale: 102,
      briWave: 30,
      hueTimeDiv: 76,
      hueSwing: 5900,
      hueStep: 760,
      transition: 3,
      briMin: 116,
      briMax: 248,
      beatLift: 18,
      dropLift: 27
    },
    flow_sunset: {
      sat: 164,
      briBase: 106,
      briScale: 78,
      briWave: 18,
      hueTimeDiv: 154,
      hueSwing: 2100,
      hueStep: 150,
      transition: 8,
      briMin: 94,
      briMax: 210,
      beatLift: 7,
      dropLift: 12
    },
    flow_glacier: {
      sat: 174,
      briBase: 110,
      briScale: 84,
      briWave: 20,
      hueTimeDiv: 142,
      hueSwing: 2800,
      hueStep: 185,
      transition: 7,
      briMin: 98,
      briMax: 220,
      beatLift: 8,
      dropLift: 13
    },
    flow_storm: {
      sat: 238,
      briBase: 136,
      briScale: 112,
      briWave: 38,
      hueTimeDiv: 66,
      hueSwing: 7200,
      hueStep: 980,
      transition: 3,
      briMin: 128,
      briMax: 254,
      beatLift: 22,
      dropLift: 34
    },
    pulse_strobe: {
      sat: 254,
      briBase: 168,
      briScale: 96,
      hueStep: 14000,
      transitionBeat: 1,
      transitionFree: 3
    }
  };

  const GENRE_SCENES = {
    edm:     { idle: "idle_soft", flow: "flow_cyberpunk", pulse: "pulse_strobe" },
    hiphop: { idle: "idle_soft", flow: "flow_hiphop", pulse: "pulse_strobe" },
    metal:  { idle: "idle_soft", flow: "flow_metal", pulse: "pulse_strobe" },
    ambient:{ idle: "idle_soft", flow: "flow_ambient", pulse: "pulse_strobe" },
    house:  { idle: "idle_soft", flow: "flow_house", pulse: "pulse_strobe" },
    trance: { idle: "idle_soft", flow: "flow_trance", pulse: "pulse_strobe" },
    dnb:    { idle: "idle_soft", flow: "flow_dnb", pulse: "pulse_strobe" },
    pop:    { idle: "idle_soft", flow: "flow_sunset", pulse: "pulse_strobe" },
    rock:   { idle: "idle_soft", flow: "flow_rock", pulse: "pulse_strobe" },
    rnb:    { idle: "idle_soft", flow: "flow_rnb", pulse: "pulse_strobe" },
    techno: { idle: "idle_soft", flow: "flow_storm", pulse: "pulse_strobe" },
    media:  { idle: "idle_soft", flow: "flow_glacier", pulse: "pulse_strobe" },
    auto:   { idle: "idle_soft", flow: "flow_wash", pulse: "pulse_strobe" }
  };
  /* =========================
    WIZ PALETTES (PER SCENE)
  ========================= */
  const WIZ_PALETTES = {
    idle_soft: [
      { r: 100, g: 110, b: 168 }, // twilight blue
      { r: 126, g: 92,  b: 154 }, // soft violet
      { r: 86,  g: 138, b: 176 }  // cool haze
    ],

    flow_wash: [
      { r: 35,  g: 140, b: 205 }, // ocean blue
      { r: 55,  g: 175, b: 175 }, // teal water
      { r: 95,  g: 160, b: 235 }, // sky wash
      { r: 70,  g: 115, b: 210 }  // deep tide
    ],
    flow_edm: [
      { r: 20,  g: 220, b: 255 }, // laser cyan
      { r: 255, g: 70,  b: 225 }, // neon magenta
      { r: 110, g: 120, b: 255 }, // electric blue
      { r: 95,  g: 255, b: 185 }  // mint accent
    ],
    flow_hiphop: [
      { r: 245, g: 145, b: 55  }, // amber gold
      { r: 110, g: 75,  b: 205 }, // deep violet
      { r: 40,  g: 70,  b: 145 }, // navy
      { r: 210, g: 55,  b: 95  }  // wine red
    ],
    flow_metal: [
      { r: 255, g: 25,  b: 25  }, // blood red
      { r: 145, g: 165, b: 205 }, // steel
      { r: 235, g: 235, b: 235 }, // flash white
      { r: 255, g: 110, b: 20  }  // molten orange
    ],
    flow_ambient: [
      { r: 70,  g: 150, b: 170 }, // sea mist
      { r: 95,  g: 130, b: 195 }, // cloud blue
      { r: 110, g: 155, b: 140 }, // sage
      { r: 130, g: 115, b: 170 }  // dusk lavender
    ],
    flow_house: [
      { r: 255, g: 120, b: 35  }, // sunset orange
      { r: 255, g: 55,  b: 150 }, // club magenta
      { r: 35,  g: 190, b: 255 }, // aqua cyan
      { r: 255, g: 185, b: 70  }  // warm amber
    ],
    flow_trance: [
      { r: 55,  g: 220, b: 255 }, // bright cyan
      { r: 160, g: 110, b: 255 }, // violet
      { r: 255, g: 70,  b: 215 }, // trance pink
      { r: 120, g: 250, b: 210 }  // mint glow
    ],
    flow_dnb: [
      { r: 255, g: 35,  b: 35  }, // hard red
      { r: 255, g: 170, b: 35  }, // amber
      { r: 35,  g: 205, b: 255 }, // icy cyan
      { r: 190, g: 255, b: 110 }  // acid green
    ],
    flow_pop: [
      { r: 255, g: 115, b: 175 }, // bubblegum pink
      { r: 255, g: 220, b: 85  }, // candy yellow
      { r: 105, g: 240, b: 235 }, // mint aqua
      { r: 175, g: 130, b: 255 }  // lilac
    ],
    flow_rock: [
      { r: 255, g: 55,  b: 40  }, // amp red
      { r: 255, g: 150, b: 60  }, // stage amber
      { r: 175, g: 190, b: 220 }, // steel blue
      { r: 250, g: 240, b: 220 }  // warm white
    ],
    flow_rnb: [
      { r: 205, g: 80,  b: 150 }, // velvet magenta
      { r: 120, g: 85,  b: 200 }, // deep purple
      { r: 80,  g: 120, b: 210 }, // smooth indigo
      { r: 245, g: 170, b: 110 }  // warm amber
    ],
    flow_media: [
      { r: 70,  g: 105, b: 170 }, // midnight blue
      { r: 180, g: 120, b: 75  }, // cinema amber
      { r: 95,  g: 155, b: 175 }, // cool teal
      { r: 230, g: 200, b: 150 }  // projector warm
    ],
    flow_techno: [
      { r: 45,  g: 255, b: 155 }, // acid green
      { r: 45,  g: 155, b: 255 }, // electric blue
      { r: 240, g: 45,  b: 125 }, // hot pink
      { r: 210, g: 255, b: 90  }  // toxic lime
    ],
    flow_cyberpunk: [
      { r: 35,  g: 245, b: 235 }, // neon cyan
      { r: 255, g: 70,  b: 210 }, // magenta laser
      { r: 120, g: 95,  b: 255 }, // ultraviolet
      { r: 225, g: 255, b: 110 }  // lime edge
    ],
    flow_sunset: [
      { r: 255, g: 128, b: 78  }, // sunset orange
      { r: 255, g: 86,  b: 128 }, // warm rose
      { r: 255, g: 188, b: 112 }, // peach gold
      { r: 210, g: 120, b: 186 }  // dusk mauve
    ],
    flow_glacier: [
      { r: 88,  g: 164, b: 232 }, // glacier blue
      { r: 128, g: 210, b: 255 }, // ice cyan
      { r: 178, g: 198, b: 245 }, // frozen lavender
      { r: 144, g: 230, b: 218 }  // arctic mint
    ],
    flow_storm: [
      { r: 255, g: 45,  b: 55  }, // storm red
      { r: 255, g: 155, b: 35  }, // lightning amber
      { r: 66,  g: 162, b: 255 }, // electric blue
      { r: 228, g: 238, b: 255 }  // flash white
    ],

    pulse_strobe: [
      { r: 255, g: 50,  b: 50  }, // red
      { r: 255, g: 230, b: 120 }, // warm white
      { r: 255, g: 255, b: 255 }  // white
    ]
  };
  const FLOW_HUE_PALETTES = {
    flow_wash: {
      anchors: [24000, 32000, 43000, 56000],
      swing: 3600, stride: 4, step: 210, micro: 760, drift: 520
    },
    flow_edm: {
      anchors: [32000, 59000, 43000],
      swing: 5200, stride: 3, step: 260, micro: 900, drift: 700
    },
    flow_hiphop: {
      anchors: [7000, 52000, 43000],
      swing: 3000, stride: 5, step: 150, micro: 650, drift: 420
    },
    flow_metal: {
      anchors: [500, 8000, 43000],
      swing: 5800, stride: 3, step: 300, micro: 850, drift: 520
    },
    flow_ambient: {
      anchors: [28000, 38000, 52000],
      swing: 1700, stride: 7, step: 90, micro: 320, drift: 260
    },
    flow_house: {
      anchors: [5000, 59000, 32000],
      swing: 3600, stride: 4, step: 180, micro: 700, drift: 480
    },
    flow_trance: {
      anchors: [32000, 53000, 59000],
      swing: 4800, stride: 4, step: 220, micro: 760, drift: 620
    },
    flow_dnb: {
      anchors: [0, 8000, 32000],
      swing: 5600, stride: 3, step: 280, micro: 900, drift: 560
    },
    flow_pop: {
      anchors: [59000, 10000, 32000],
      swing: 2600, stride: 5, step: 130, micro: 560, drift: 400
    },
    flow_rock: {
      anchors: [1200, 5400, 8200, 43000],
      swing: 4400, stride: 3, step: 230, micro: 740, drift: 510
    },
    flow_rnb: {
      anchors: [58000, 61000, 5000, 43000],
      swing: 2400, stride: 5, step: 130, micro: 540, drift: 360
    },
    flow_media: {
      anchors: [47000, 8200, 38000],
      swing: 2100, stride: 6, step: 115, micro: 420, drift: 320
    },
    flow_techno: {
      anchors: [22000, 32000, 60000],
      swing: 5400, stride: 3, step: 290, micro: 820, drift: 640
    },
    flow_cyberpunk: {
      anchors: [32000, 60000, 53000, 18000],
      swing: 5600, stride: 3, step: 270, micro: 860, drift: 640
    },
    flow_sunset: {
      anchors: [5000, 9000, 14000, 58000],
      swing: 2200, stride: 6, step: 120, micro: 420, drift: 340
    },
    flow_glacier: {
      anchors: [35000, 42000, 50000, 28000],
      swing: 2600, stride: 6, step: 135, micro: 460, drift: 360
    },
    flow_storm: {
      anchors: [900, 6400, 30000, 43000],
      swing: 6200, stride: 3, step: 320, micro: 900, drift: 700
    }
  };
  const WIZ_PULSE_PALETTES = {
    edm: [
      { r: 30,  g: 220, b: 255 },
      { r: 255, g: 70,  b: 225 },
      { r: 255, g: 255, b: 255 }
    ],
    hiphop: [
      { r: 255, g: 150, b: 70  },
      { r: 120, g: 90,  b: 230 },
      { r: 255, g: 255, b: 255 }
    ],
    metal: [
      { r: 255, g: 30,  b: 30  },
      { r: 210, g: 220, b: 235 },
      { r: 255, g: 255, b: 255 }
    ],
    ambient: [
      { r: 95,  g: 145, b: 200 },
      { r: 130, g: 110, b: 170 },
      { r: 200, g: 235, b: 240 }
    ],
    house: [
      { r: 255, g: 120, b: 35  },
      { r: 255, g: 55,  b: 150 },
      { r: 255, g: 240, b: 180 }
    ],
    trance: [
      { r: 70,  g: 230, b: 255 },
      { r: 190, g: 120, b: 255 },
      { r: 255, g: 230, b: 255 }
    ],
    dnb: [
      { r: 255, g: 40,  b: 40  },
      { r: 255, g: 175, b: 35  },
      { r: 220, g: 255, b: 140 }
    ],
    pop: [
      { r: 255, g: 120, b: 180 },
      { r: 255, g: 220, b: 100 },
      { r: 220, g: 255, b: 245 }
    ],
    rock: [
      { r: 255, g: 60,  b: 45  },
      { r: 255, g: 170, b: 70  },
      { r: 255, g: 245, b: 220 }
    ],
    rnb: [
      { r: 220, g: 90,  b: 165 },
      { r: 140, g: 95,  b: 215 },
      { r: 255, g: 205, b: 160 }
    ],
    media: [
      { r: 95,  g: 145, b: 220 },
      { r: 235, g: 165, b: 95  },
      { r: 255, g: 240, b: 200 }
    ],
    techno: [
      { r: 60,  g: 255, b: 170 },
      { r: 65,  g: 170, b: 255 },
      { r: 255, g: 255, b: 255 }
    ],
    auto: [
      { r: 255, g: 60,  b: 60  },
      { r: 255, g: 175, b: 60  },
      { r: 255, g: 255, b: 255 }
    ]
  };

  /* =========================
     TIMING GUARDS
  ========================= */
  let running = false;
  let phase = 0;
  let lastHueEmit = 0;
  let nextHueEmitAt = 0;

  const HZ_INTERVALS = {
    normal: 500, // 2 Hz
    fast: 250, // 4 Hz
    turbo6: Math.round(1000 / 6), // ~166 ms
    turbo8: Math.round(1000 / 8), // 125 ms
    turbo10: Math.round(1000 / 10), // 100 ms
    turbo12: Math.round(1000 / 12), // ~83 ms
    turbo14: Math.round(1000 / 14), // ~71 ms
    turbo16: Math.round(1000 / 16), // ~62 ms
    turbo20: Math.round(1000 / 20), // 50 ms
    turbo30: Math.round(1000 / 30), // ~33 ms
    turbo40: Math.round(1000 / 40), // 25 ms
    turbo50: Math.round(1000 / 50), // 20 ms
    turbo60: Math.round(1000 / 60) // ~16 ms
  };

  let stableBehavior = "idle";
  let behaviorCandidate = "idle";
  let behaviorCandidateSince = 0;
  let lastBehaviorChangeAt = 0;

  let stableScene = "idle_soft";
  let sceneCandidate = "idle_soft";
  let sceneCandidateSince = 0;
  let lastSceneChangeAt = 0;
  let autoFlowStableScene = "flow_wash";
  let autoFlowCandidateScene = "flow_wash";
  let autoFlowCandidateSince = 0;
  let autoFlowLastChangeAt = 0;

  function setAutoProfile(name) {
    if (!AUTO_PROFILES[name]) return false;

    autoProfile = name;
    autoSwitch = AUTO_PROFILES[name];
    telemetry.autoProfile = autoProfile;

    const now = Date.now();
    behaviorCandidate = stableBehavior;
    behaviorCandidateSince = now;
    sceneCandidate = stableScene;
    sceneCandidateSince = now;
    autoFlowCandidateScene = autoFlowStableScene;
    autoFlowCandidateSince = now;

    return true;
  }

  function normalizeFlowIntensity(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return clamp(n, FLOW_INTENSITY_MIN, FLOW_INTENSITY_MAX);
  }

  function setFlowIntensity(value) {
    const next = normalizeFlowIntensity(value);
    if (next === null) return false;
    flowIntensity = next;
    telemetry.flowIntensity = flowIntensity;
    return flowIntensity;
  }

  /* =========================
     META AUTO (PROFILE/REACT/OC)
  ========================= */
  const META_AUTO_TIMING = {
    evalMs: 200,
    confirmMs: 520,
    holdMs: 1800,
    fastConfirmMs: 180,
    fastHoldMs: 550
  };
  const META_AUTO_CHAOS_RECENT_MS = 3200;
  const META_AUTO_CHAOS_PEAK_MS = 1000;
  const META_AUTO_LEARN_PEAK_DECAY = 0.987;
  const META_AUTO_LEARN_HOLD_MS = 1800;
  const META_AUTO_LEARN_SURGE_MS = 4200;
  const OVERCLOCK_AUTO_TIMING = {
    evalMs: 220,
    confirmMs: 420,
    holdMs: 900,
    fastConfirmMs: 180,
    fastHoldMs: 480
  };

  let metaAutoEnabled = process.env.RAVE_META_AUTO_DEFAULT === "1";
  let overclockAutoEnabled = process.env.RAVE_OVERCLOCK_AUTO_DEFAULT === "1";
  if (metaAutoEnabled && overclockAutoEnabled) {
    overclockAutoEnabled = false;
  }
  let metaAutoLastEvalAt = 0;
  let metaAutoLastAppliedAt = 0;
  let metaAutoCandidateSince = 0;
  let metaAutoCandidate = null;
  let metaAutoGenreStable = "auto";
  let metaAutoGenreCandidate = "auto";
  let metaAutoGenreCandidateSince = 0;
  let metaAutoLastDropAt = 0;
  let metaAutoLastChaosAt = 0;
  let metaAutoLastTargetHz = 2;
  let metaAutoDriveEma = 0;
  let metaAutoMotionEma = 0;
  let metaAutoIntensityEma = 0;
  let metaAutoDrivePeak = 0;
  let metaAutoMotionPeak = 0;
  let metaAutoIntensityPeak = 0;
  let metaAutoHeavySince = 0;
  let overclockAutoLastEvalAt = 0;
  let overclockAutoLastAppliedAt = 0;
  let overclockAutoCandidateSince = 0;
  let overclockAutoCandidate = null;

  const META_AUTO_HZ_BY_LEVEL = [2, 4, 6, 8, 10, 12, 14, 16, 20, 30, 40, 50, 60];
  const META_AUTO_GENRE_STYLE = {
    edm: { aggression: 0.42, maxHz: 16, floorHz: 5, baseProfile: "reactive", baseReactivity: "aggressive" },
    hiphop: { aggression: 0.18, maxHz: 12, floorHz: 4, baseProfile: "reactive", baseReactivity: "balanced" },
    metal: { aggression: 0.74, maxHz: 16, floorHz: 6, baseProfile: "reactive", baseReactivity: "aggressive" },
    ambient: { aggression: -0.6, maxHz: 6, floorHz: 2, baseProfile: "cinematic", baseReactivity: "precision" },
    house: { aggression: 0.22, maxHz: 12, floorHz: 5, baseProfile: "reactive", baseReactivity: "balanced" },
    trance: { aggression: 0.3, maxHz: 12, floorHz: 5, baseProfile: "reactive", baseReactivity: "balanced" },
    dnb: { aggression: 0.72, maxHz: 16, floorHz: 6, baseProfile: "reactive", baseReactivity: "aggressive" },
    pop: { aggression: 0.08, maxHz: 12, floorHz: 4, baseProfile: "balanced", baseReactivity: "balanced" },
    rock: { aggression: 0.4, maxHz: 16, floorHz: 5, baseProfile: "reactive", baseReactivity: "balanced" },
    rnb: { aggression: -0.18, maxHz: 10, floorHz: 3, baseProfile: "balanced", baseReactivity: "precision" },
    techno: { aggression: 0.56, maxHz: 16, floorHz: 6, baseProfile: "reactive", baseReactivity: "aggressive" },
    media: { aggression: -0.34, maxHz: 10, floorHz: 3, baseProfile: "cinematic", baseReactivity: "balanced" },
    auto: { aggression: 0.2, maxHz: 12, floorHz: 5, baseProfile: "balanced", baseReactivity: "balanced" }
  };
  metaAutoLastTargetHz = META_AUTO_HZ_BY_LEVEL[DEFAULT_OVERCLOCK_LEVEL] || 2;

  telemetry.metaAutoEnabled = metaAutoEnabled;
  telemetry.metaAutoReason = metaAutoEnabled ? "armed" : "off";
  telemetry.metaAutoProfile = autoProfile;
  telemetry.metaAutoGenre = metaAutoGenreStable;
  telemetry.metaAutoReactivity = audioReactivityPreset;
  telemetry.metaAutoHz = META_AUTO_HZ_BY_LEVEL[DEFAULT_OVERCLOCK_LEVEL] || 2;
  telemetry.metaAutoOverclock = 0;
  telemetry.overclockAutoEnabled = overclockAutoEnabled;
  telemetry.overclockAutoReason = overclockAutoEnabled ? "armed" : "off";
  telemetry.overclockAutoHz = META_AUTO_HZ_BY_LEVEL[DEFAULT_OVERCLOCK_LEVEL] || 2;
  telemetry.overclockAutoOverclock = DEFAULT_OVERCLOCK_LEVEL;

  function snapshotMetaPlan(reason = "steady") {
    return {
      autoProfile,
      audioReactivityPreset,
      overclockLevel,
      reason
    };
  }

  function sameMetaPlan(a, b) {
    if (!a || !b) return false;
    return (
      a.autoProfile === b.autoProfile &&
      a.audioReactivityPreset === b.audioReactivityPreset &&
      Number(a.overclockLevel) === Number(b.overclockLevel)
    );
  }

  function describeMetaReason(plan) {
    if (!plan) return "off";
    return String(plan.reason || "steady");
  }

  function overclockLevelFromHz(hz) {
    // Meta Auto intentionally stays within baseline safe tiers (<= 16Hz).
    const safeHz = clamp(Number(hz) || 2, 2, 16);
    let bestLevel = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let level = 0; level <= 7; level++) {
      const distance = Math.abs(safeHz - META_AUTO_HZ_BY_LEVEL[level]);
      if (
        distance < bestDistance ||
        (distance === bestDistance && META_AUTO_HZ_BY_LEVEL[level] > META_AUTO_HZ_BY_LEVEL[bestLevel])
      ) {
        bestDistance = distance;
        bestLevel = level;
      }
    }
    return bestLevel;
  }

  function learnMetaAutoFromSong(now, sample = {}) {
    const drive = clamp(Number(sample.drive) || 0, 0, 1);
    const motion = clamp(Number(sample.motion) || 0, 0, 1);
    const intensity = clamp(Number(sample.intensity) || 0, 0, 1.4);

    metaAutoDriveEma = lerp(metaAutoDriveEma, drive, 0.24);
    metaAutoMotionEma = lerp(metaAutoMotionEma, motion, 0.24);
    metaAutoIntensityEma = lerp(metaAutoIntensityEma, intensity, 0.2);

    metaAutoDrivePeak = Math.max(drive, metaAutoDrivePeak * META_AUTO_LEARN_PEAK_DECAY);
    metaAutoMotionPeak = Math.max(motion, metaAutoMotionPeak * META_AUTO_LEARN_PEAK_DECAY);
    metaAutoIntensityPeak = Math.max(intensity, metaAutoIntensityPeak * META_AUTO_LEARN_PEAK_DECAY);

    const drivePeakCarry = clamp(drive * 0.64 + motion * 0.36, 0, 1);
    const motionPeakCarry = clamp(motion * 0.68 + drive * 0.32, 0, 1);
    const intensityPeakCarry = clamp((intensity / 1.4) * 0.72 + motion * 0.28, 0, 1);
    const drivePeakWeight = lerp(0.32, 0.76, drivePeakCarry);
    const motionPeakWeight = lerp(0.32, 0.78, motionPeakCarry);
    const intensityPeakWeight = lerp(0.34, 0.8, intensityPeakCarry);

    const learnedDrive = clamp(
      Math.max(drive, metaAutoDriveEma * 0.9, metaAutoDrivePeak * drivePeakWeight),
      0,
      1
    );
    const learnedMotion = clamp(
      Math.max(motion, metaAutoMotionEma * 0.9, metaAutoMotionPeak * motionPeakWeight),
      0,
      1
    );
    const learnedIntensity = clamp(
      Math.max(intensity, metaAutoIntensityEma * 0.88, metaAutoIntensityPeak * intensityPeakWeight),
      0,
      1.4
    );

    const heavyMomentum = clamp(
      learnedDrive * 0.5 +
      learnedMotion * 0.4 +
      Math.max(0, learnedIntensity - 0.2) * 0.34,
      0,
      1.4
    );
    if (heavyMomentum >= 0.44) {
      if (metaAutoHeavySince <= 0) metaAutoHeavySince = now;
    } else if (heavyMomentum <= 0.3) {
      metaAutoHeavySince = 0;
    }
    const heavyHoldMs = metaAutoHeavySince > 0 ? Math.max(0, now - metaAutoHeavySince) : 0;

    return {
      drive: learnedDrive,
      motion: learnedMotion,
      intensity: learnedIntensity,
      heavyMomentum,
      heavyHoldMs
    };
  }

  function classifyMetaAutoGenre(metrics = {}) {
    const drive = clamp(Number(metrics.drive) || 0, 0, 1);
    const motion = clamp(Number(metrics.motion) || 0, 0, 1);
    const beat = clamp(Number(metrics.beat) || 0, 0, 1);
    const bpm = clamp(Number(metrics.bpm) || 118, 60, 190);
    const transient = clamp(Number(metrics.transient) || 0, 0, 1);
    const flux = clamp(Number(metrics.flux) || 0, 0, 1);
    const low = clamp(Number(metrics.low) || 0, 0, 1);
    const mid = clamp(Number(metrics.mid) || 0, 0, 1);
    const high = clamp(Number(metrics.high) || 0, 0, 1);
    const trend = clamp(Number(metrics.trend) || 0, -0.2, 0.2);
    const drop = Boolean(metrics.drop);
    const build = Boolean(metrics.build);

    const percussive = clamp(transient * 0.62 + flux * 0.38, 0, 1);
    const groove = clamp(drive * 0.5 + motion * 0.32 + beat * 0.18, 0, 1);
    const bassWeight = clamp(low * 0.72 + Math.max(0, low - high) * 0.5, 0, 1);
    const highWeight = clamp(high * 0.74 + Math.max(0, high - low) * 0.45, 0, 1);
    const harmonic = clamp(mid * 0.58 + high * 0.22 + (1 - percussive) * 0.2, 0, 1);
    const calmness = clamp((1 - drive) * 0.58 + (1 - motion) * 0.42, 0, 1);

    const scores = {
      edm: 0,
      hiphop: 0,
      metal: 0,
      ambient: 0,
      house: 0,
      trance: 0,
      dnb: 0,
      pop: 0,
      rock: 0,
      rnb: 0,
      techno: 0,
      media: 0
    };

    scores.ambient += calmness * 1.5 + harmonic * 0.42 + (bpm < 98 ? 0.32 : 0);
    scores.media += calmness * 1.05 + harmonic * 0.62 + (bpm >= 86 && bpm <= 126 ? 0.24 : 0);
    scores.rnb += bassWeight * 0.68 + harmonic * 0.64 + (bpm >= 72 && bpm <= 112 ? 0.44 : 0) + (1 - motion) * 0.34;
    scores.hiphop += bassWeight * 0.88 + percussive * 0.56 + (bpm <= 108 ? 0.5 : 0) + beat * 0.24;
    scores.house += groove * 0.76 + (bpm >= 118 && bpm <= 132 ? 0.54 : 0) + low * 0.24 + mid * 0.18;
    scores.trance += groove * 0.72 + highWeight * 0.54 + (bpm >= 128 && bpm <= 146 ? 0.5 : 0) + (1 - percussive) * 0.24;
    scores.techno += percussive * 0.84 + motion * 0.62 + (bpm >= 124 && bpm <= 152 ? 0.54 : 0) + highWeight * 0.28;
    scores.dnb += percussive * 0.9 + motion * 0.82 + beat * 0.42 + ((bpm >= 160 || (bpm >= 78 && bpm <= 95 && beat > 0.58)) ? 0.68 : 0);
    scores.metal += percussive * 0.94 + highWeight * 0.74 + drive * 0.64 + motion * 0.26 + (bpm >= 108 ? 0.38 : 0);
    scores.rock += percussive * 0.62 + mid * 0.46 + drive * 0.36 + (bpm >= 96 && bpm <= 150 ? 0.3 : 0);
    scores.pop += harmonic * 0.56 + groove * 0.52 + mid * 0.34 + (bpm >= 96 && bpm <= 132 ? 0.34 : 0);
    scores.edm += groove * 0.74 + percussive * 0.64 + drive * 0.54 + (bpm >= 122 && bpm <= 148 ? 0.46 : 0);

    if (trend > 0.018) {
      scores.techno += 0.18;
      scores.dnb += 0.14;
      scores.edm += 0.14;
      scores.trance += 0.12;
    }
    if (trend < -0.02) {
      scores.ambient += 0.16;
      scores.media += 0.12;
      scores.rnb += 0.1;
    }
    if (drop) {
      scores.dnb += 0.28;
      scores.techno += 0.22;
      scores.edm += 0.2;
      scores.metal += 0.18;
    }
    if (highWeight > 0.58 && percussive > 0.52 && drive > 0.46) {
      scores.metal += 0.2;
    }
    if (drive > 0.72 && motion > 0.66) {
      scores.metal += 0.16;
    }
    if (build) {
      scores.trance += 0.18;
      scores.house += 0.14;
      scores.techno += 0.14;
    }

    let genre = "edm";
    let score = Number.NEGATIVE_INFINITY;
    for (const [name, value] of Object.entries(scores)) {
      if (value > score) {
        genre = name;
        score = value;
      }
    }

    return { genre, score, scores };
  }

  function resolveMetaAutoGenre(now, classification) {
    const detectedGenre = String(classification?.genre || "edm");
    const scores = classification?.scores || {};

    if (metaAutoGenreStable === "auto" || !META_AUTO_GENRE_STYLE[metaAutoGenreStable]) {
      metaAutoGenreStable = detectedGenre;
      metaAutoGenreCandidate = detectedGenre;
      metaAutoGenreCandidateSince = now;
      return metaAutoGenreStable;
    }

    if (detectedGenre === metaAutoGenreStable) {
      metaAutoGenreCandidate = detectedGenre;
      metaAutoGenreCandidateSince = now;
      return metaAutoGenreStable;
    }

    if (detectedGenre !== metaAutoGenreCandidate) {
      metaAutoGenreCandidate = detectedGenre;
      metaAutoGenreCandidateSince = now;
      return metaAutoGenreStable;
    }

    const detectedScore = Number(scores[detectedGenre] || 0);
    const stableScore = Number(scores[metaAutoGenreStable] || 0);
    const delta = detectedScore - stableScore;
    const confirmMs = delta > 0.28 ? 90 : (delta > 0.16 ? 220 : 420);
    if (now - metaAutoGenreCandidateSince >= confirmMs) {
      metaAutoGenreStable = detectedGenre;
      metaAutoGenreCandidateSince = now;
    }

    return metaAutoGenreStable;
  }

  function computeMetaPlan(now = Date.now()) {
    const genreRef = effectiveGenreReference || GENRE_REFERENCE_TRACKS.auto;
    const drive = getEnergyDrive();
    const beat = clamp(Number(telemetry.beatConfidence || 0), 0, 1);
    const motion = clamp(Math.max(audioTransient, audioFlux, beat), 0, 1);
    const bpm = clamp(Number(telemetry.bpm || 118), 60, 190);
    const trend = clamp(Number(energyTrend || 0), -0.2, 0.2);

    const dropSignal =
      externalDrop ||
      (beat > 0.68 && audioTransient > 0.34 && audioFlux > 0.28 && drive > 0.55) ||
      (trend < -0.028 && drive > 0.42 && (audioTransient > 0.22 || audioFlux > 0.24));
    if (dropSignal) metaAutoLastDropAt = now;

    const drop = dropSignal || (now - metaAutoLastDropAt) < 680;
    const build = !drop && trend > 0.016 && drive > 0.33 && motion > 0.26;
    const recover = !drop && (now - metaAutoLastDropAt) < 1800 && trend > 0.004;
    const quietRmsGate = clamp(Number(genreRef.quietRmsGate ?? 0.12), 0.06, 0.24);
    const quietTransientGate = clamp(Number(genreRef.quietTransientGate ?? 0.16), 0.08, 0.28);
    const quietFluxGate = clamp(Number(genreRef.quietFluxGate ?? 0.14), 0.08, 0.26);
    const calmAudio = audio < quietRmsGate && audioTransient < quietTransientGate && audioFlux < quietFluxGate;
    const calmMotion = motion < Math.max(0.22, quietTransientGate * 1.06) && beat < 0.34;
    const calmDrive = drive < Math.max(0.2, quietRmsGate * 1.7);
    const sustainedCalm = !drop && !build && calmAudio && calmMotion && calmDrive;

    const chaosScore = clamp(
      audioTransient * 0.42 +
      audioFlux * 0.36 +
      motion * 0.14 +
      beat * 0.08 +
      Math.max(0, drive - 0.3) * 0.18,
      0,
      1.4
    );
    const chaotic = (
      chaosScore > 0.52 ||
      (audioTransient > 0.42 && audioFlux > 0.32) ||
      (motion > 0.66 && beat > 0.36)
    );
    if (chaotic) metaAutoLastChaosAt = now;
    const chaosAgeMs = now - metaAutoLastChaosAt;
    const chaosHot = chaosAgeMs < META_AUTO_CHAOS_RECENT_MS;
    const chaosPeak = chaosAgeMs < META_AUTO_CHAOS_PEAK_MS;

    const classification = classifyMetaAutoGenre({
      drive,
      motion,
      beat,
      bpm,
      transient: audioTransient,
      flux: audioFlux,
      low: audioBandLow,
      mid: audioBandMid,
      high: audioBandHigh,
      trend,
      build,
      drop
    });
    const metaGenre = resolveMetaAutoGenre(now, classification);
    const style = META_AUTO_GENRE_STYLE[metaGenre] || META_AUTO_GENRE_STYLE.auto;
    const decadeStyle =
      GENRE_DECADE_STYLE_BIAS[resolvedGenreDecade] ||
      GENRE_DECADE_STYLE_BIAS[DEFAULT_GENRE_DECADE] ||
      {};
    const decadeAggressionBias = clamp(Number(decadeStyle.metaAggressionBias || 0), -0.26, 0.26);
    const decadeOverclockBias = clamp(Number(decadeStyle.metaOverclockBias || 0), -2, 2);
    const decadeVariationBias = clamp(Number(decadeStyle.metaVariationBias || 0), -0.2, 0.2);
    const aggression = clamp(style.aggression + decadeAggressionBias, -0.9, 0.95);

    const intensityRaw = clamp(
      drive * 0.34 +
      motion * 0.3 +
      beat * 0.16 +
      audioTransient * 0.1 +
      audioFlux * 0.1 +
      (drop ? 0.18 : 0) +
      (build ? 0.08 : 0),
      0,
      1.4
    );
    const learnedSongState = learnMetaAutoFromSong(now, {
      drive,
      motion,
      intensity: intensityRaw
    });
    let driveSignal = learnedSongState.drive;
    let motionSignal = learnedSongState.motion;
    let intensity = learnedSongState.intensity;
    if (sustainedCalm) {
      driveSignal = Math.min(driveSignal, clamp(drive * 1.08 + audio * 0.24, 0, 1));
      motionSignal = Math.min(motionSignal, clamp(motion * 1.04, 0, 1));
      intensity = Math.min(intensity, clamp(intensityRaw * 1.04, 0, 1.4));
    }
    const heavyHoldMs = learnedSongState.heavyHoldMs;

    const power = clamp(
      driveSignal * 0.44 +
      motionSignal * 0.34 +
      beat * 0.12 +
      clamp((bpm - 94) / 96, 0, 1) * 0.08 +
      intensity * 0.08 +
      (drop ? 0.24 : 0) +
      (build ? 0.12 : 0) +
      aggression * 0.14,
      0,
      1.35
    );

    let tier = 0;
    if (drop || power >= 0.74 || (motionSignal > 0.72 && driveSignal > 0.54)) tier = 4;
    else if (build || power >= 0.56 || (driveSignal > 0.44 && motionSignal > 0.39)) tier = 3;
    else if (recover || power >= 0.42) tier = 2;
    else if (power >= 0.22) tier = 1;
    if (bpm >= 150 && (motionSignal > 0.3 || beat > 0.34)) tier = Math.max(tier, 2);
    if (bpm >= 164 && (motionSignal > 0.44 || beat > 0.4)) tier = Math.max(tier, 3);

    const aggressiveGenre = metaGenre === "metal" || metaGenre === "dnb" || metaGenre === "techno";
    if (aggressiveGenre && heavyHoldMs >= META_AUTO_LEARN_HOLD_MS) {
      tier = Math.max(tier, 2);
    }
    if (aggressiveGenre && heavyHoldMs >= META_AUTO_LEARN_SURGE_MS && (motionSignal > 0.4 || intensity > 0.48)) {
      tier = Math.max(tier, 3);
    }

    if (metaGenre === "metal") {
      if (driveSignal > 0.3 && motionSignal > 0.28) tier = Math.max(tier, 2);
      if (driveSignal > 0.46 && (motionSignal > 0.46 || (audioTransient > 0.38 && audioFlux > 0.34))) {
        tier = Math.max(tier, 3);
      }
      if (drop || (driveSignal > 0.66 && motionSignal > 0.62 && beat > 0.4)) tier = Math.max(tier, 4);
      if (heavyHoldMs >= META_AUTO_LEARN_SURGE_MS && intensity > 0.7) tier = Math.max(tier, 4);
    }
    if (chaotic && motionSignal > 0.38) tier = Math.max(tier, 2);
    if (chaotic && (motionSignal > 0.54 || beat > 0.4 || intensity > 0.56)) tier = Math.max(tier, 3);
    if ((drop && chaotic) || (chaotic && intensity > 0.9 && motionSignal > 0.7 && driveSignal > 0.5)) {
      tier = Math.max(tier, 4);
    }
    if (intensity > 0.56) tier = Math.max(tier, 2);
    if (intensity > 0.72 && (motionSignal > 0.48 || beat > 0.42)) tier = Math.max(tier, 3);
    if ((drop && intensity > 0.84) || (intensity > 0.96 && motionSignal > 0.68 && driveSignal > 0.64)) {
      tier = Math.max(tier, 4);
    }
    if (aggressiveGenre && intensity > 0.82 && motionSignal > 0.56 && (audioTransient > 0.48 || audioFlux > 0.44)) {
      tier = Math.max(tier, 4);
    }
    if (sustainedCalm) {
      tier = Math.min(tier, motionSignal > 0.26 ? 1 : 0);
    }

    let nextProfile = style.baseProfile;
    let nextReactivity = style.baseReactivity;
    let reason = "steady";

    if (tier >= 4) {
      nextProfile = "reactive";
      nextReactivity = "aggressive";
      reason = drop ? "drop" : "surge";
    } else if (tier === 3) {
      nextProfile = "reactive";
      nextReactivity = (motion > 0.5 || style.aggression > 0.1) ? "aggressive" : "balanced";
      reason = build ? "build" : "kinetic";
    } else if (tier === 2) {
      nextProfile = style.baseProfile === "cinematic" ? "balanced" : style.baseProfile;
      nextReactivity = style.baseReactivity === "aggressive" && motion < 0.5
        ? "balanced"
        : style.baseReactivity;
      reason = recover ? "recover" : "drive";
    } else if (tier === 1) {
      nextProfile = style.baseProfile === "reactive" ? "balanced" : style.baseProfile;
      nextReactivity = style.aggression > 0.25 ? "balanced" : "precision";
      reason = "steady";
    } else {
      nextProfile = "cinematic";
      nextReactivity = "precision";
      reason = "calm";
    }

    if (driveSignal < 0.11 && motionSignal < 0.12 && beat < 0.2 && !drop) {
      tier = 0;
      nextProfile = "cinematic";
      nextReactivity = "precision";
      reason = "calm";
    }

    if (aggression >= 0.34 && tier >= 2) {
      nextProfile = "reactive";
      if (tier >= 3 || motion > 0.48) {
        nextReactivity = "aggressive";
      }
    } else if (aggression <= -0.28 && tier <= 2) {
      nextProfile = tier <= 1 ? "cinematic" : "balanced";
      if (nextReactivity === "aggressive") {
        nextReactivity = "balanced";
      }
    }

    const baseHzByTier = [2, 4, 6, 9, 12];
    let targetHz = baseHzByTier[tier];
    if (aggression >= 0.58 && tier >= 3) targetHz += 2;
    else if (aggression >= 0.34 && tier >= 2) targetHz += 1;
    if (aggression <= -0.3 && !drop) targetHz -= 1;
    if (bpm >= 152 && tier >= 2) targetHz += 1;
    if (bpm <= 90 && tier <= 2) targetHz -= 1;
    if (build && tier >= 2) targetHz += 1;
    if (recover && !drop && targetHz > 6) targetHz -= 1;
    if (decadeVariationBias >= 0.08 && tier >= 2 && motionSignal > 0.44) targetHz += 1;
    if (decadeVariationBias <= -0.07 && !drop && tier <= 2) targetHz -= 1;
    if (metaGenre === "metal") {
      if (tier >= 2) targetHz += 1;
      if (tier >= 3 && (motionSignal > 0.54 || audioTransient > 0.42)) targetHz += 1;
      if (heavyHoldMs >= META_AUTO_LEARN_SURGE_MS && tier >= 2) targetHz += 1;
    }
    if (aggressiveGenre && heavyHoldMs >= META_AUTO_LEARN_HOLD_MS && tier >= 2) targetHz += 1;
    if (intensity > 0.6) targetHz += 1;
    if (intensity > 0.82 && tier >= 3) targetHz += 1;
    if ((drop || build || chaotic) && intensity > 0.88 && motionSignal > 0.58 && (audioTransient > 0.48 || audioFlux > 0.44)) {
      targetHz += 1;
    }
    if ((drop || chaotic) && intensity > 1.02 && motionSignal > 0.66 && driveSignal > 0.58) {
      targetHz += 1;
    }
    if (!drop && intensity < 0.22 && tier <= 1) targetHz -= 1;
    if (chaotic && tier >= 2) targetHz += 1;
    if (chaotic && tier >= 3 && (motionSignal > 0.56 || beat > 0.5 || driveSignal > 0.54)) targetHz += 1;

    // Pace lock: blend dynamic intensity with song tempo so Meta Auto follows track speed.
    const beatHz = clamp(bpm / 60, 1, 3.6);
    const tempoMultiplierByTier = [0.9, 1.25, 1.75, 2.2, 2.7];
    const tempoTierMultiplier = tempoMultiplierByTier[tier] || tempoMultiplierByTier[2];
    const aggressionTempoScale = clamp(1 + (aggression * 0.34), 0.72, 1.45);
    const tempoTargetHz = clamp(
      beatHz * tempoTierMultiplier * aggressionTempoScale +
      (drop ? 1.1 : 0) +
      (build ? 0.45 : 0),
      2,
      16
    );
    const tempoBlend = clamp(
      0.2 +
      (motionSignal * 0.28) +
      (beat * 0.18) +
      (build ? 0.14 : 0) +
      (drop ? 0.2 : 0),
      0.2,
      0.78
    );
    targetHz = lerp(targetHz, tempoTargetHz, tempoBlend);

    targetHz += decadeOverclockBias;

    const maxHz = clamp(style.maxHz + Math.max(0, decadeOverclockBias), 4, 16);
    const tempoFloor = clamp(beatHz * (tier >= 3 ? 1.55 : tier >= 2 ? 1.25 : 0.9), 2, 16);
    const floorHz = clamp(
      Math.max((tier <= 1 ? 2 : style.floorHz) + Math.min(0, decadeOverclockBias), tempoFloor),
      2,
      maxHz
    );
    if (chaosHot && !drop && !sustainedCalm && (motionSignal > 0.36 || intensity > 0.48)) {
      const chaosFloor = chaosPeak
        ? (tier >= 3 ? 8 : 6)
        : (tier >= 3 ? 7 : 5);
      targetHz = Math.max(targetHz, chaosFloor);
    }
    if (chaosHot && !sustainedCalm && targetHz < metaAutoLastTargetHz) {
      const maxDropPerEval = chaosPeak ? 1.8 : 3.2;
      targetHz = Math.max(targetHz, metaAutoLastTargetHz - maxDropPerEval);
    }
    targetHz = clamp(targetHz, floorHz, maxHz);
    if (sustainedCalm) {
      targetHz = Math.min(targetHz, clamp(2.8 + (beat > 0.3 ? 0.6 : 0), 2, 6));
    }
    if (drop) {
      targetHz = Math.max(targetHz, Math.min(maxHz, 10 + Math.round(Math.max(0, aggression) * 4)));
    }
    if (
      drop &&
      intensity > 0.96 &&
      driveSignal > 0.72 &&
      motionSignal > 0.72 &&
      (audioTransient > 0.56 || audioFlux > 0.52) &&
      bpm >= 118
    ) {
      targetHz = Math.max(targetHz, 16);
    }
    if (
      chaotic &&
      intensity > 0.86 &&
      driveSignal > 0.5 &&
      (audioTransient > 0.54 || audioFlux > 0.5) &&
      motionSignal > 0.56 &&
      bpm >= 112
    ) {
      targetHz = Math.max(targetHz, Math.min(maxHz, 14));
    }
    if (
      chaotic &&
      intensity > 0.98 &&
      driveSignal > 0.58 &&
      motionSignal > 0.66 &&
      beat > 0.4 &&
      (audioTransient > 0.6 || audioFlux > 0.56) &&
      bpm >= 116
    ) {
      targetHz = Math.max(targetHz, Math.min(maxHz, 16));
    }
    metaAutoLastTargetHz = targetHz;

    const nextOverclock = clamp(overclockLevelFromHz(targetHz), 0, MAX_OVERCLOCK_LEVEL);
    if (nextProfile === "reactive" && nextReactivity === "precision") {
      nextReactivity = "balanced";
    }

    const fastPath = drop || tier >= 3 || reason === "surge" || reason === "kinetic" || reason === "build";

    return {
      autoProfile: nextProfile,
      audioReactivityPreset: nextReactivity,
      overclockLevel: nextOverclock,
      reason,
      metaGenre,
      targetHz: Number(targetHz.toFixed(1)),
      fastPath
    };
  }

  function applyMetaPlan(plan, now = Date.now()) {
    if (!plan) return false;

    let changed = false;
    if (plan.autoProfile !== autoProfile) {
      changed = setAutoProfile(plan.autoProfile) || changed;
    }
    if (plan.audioReactivityPreset !== audioReactivityPreset) {
      changed = setAudioReactivityPreset(plan.audioReactivityPreset) || changed;
    }
    if (Number(plan.overclockLevel) !== Number(overclockLevel)) {
      setOverclock(Number(plan.overclockLevel), { manual: false });
      changed = true;
    }

    telemetry.metaAutoProfile = plan.autoProfile;
    telemetry.metaAutoGenre = String(plan.metaGenre || metaAutoGenreStable || "auto");
    telemetry.metaAutoReactivity = plan.audioReactivityPreset;
    telemetry.metaAutoHz = Number(
      plan.targetHz || (META_AUTO_HZ_BY_LEVEL[clamp(Number(plan.overclockLevel), 0, MAX_OVERCLOCK_LEVEL)] || 2)
    );
    telemetry.metaAutoOverclock = Number(plan.overclockLevel);
    telemetry.metaAutoReason = describeMetaReason(plan);

    if (changed) {
      metaAutoLastAppliedAt = now;
      metaAutoCandidate = snapshotMetaPlan(plan.reason);
      metaAutoCandidateSince = now;
    }
    return changed;
  }

  function setMetaAutoEnabled(enabled) {
    metaAutoEnabled = Boolean(enabled);
    telemetry.metaAutoEnabled = metaAutoEnabled;
    const now = Date.now();

    if (metaAutoEnabled) {
      overclockAutoEnabled = false;
      telemetry.overclockAutoEnabled = false;
      telemetry.overclockAutoReason = "meta-auto";
      telemetry.overclockAutoHz = META_AUTO_HZ_BY_LEVEL[clamp(overclockLevel, 0, MAX_OVERCLOCK_LEVEL)] || 2;
      telemetry.overclockAutoOverclock = overclockLevel;
      overclockAutoCandidate = null;
      overclockAutoCandidateSince = 0;
      overclockAutoLastEvalAt = 0;
      overclockAutoLastAppliedAt = now - OVERCLOCK_AUTO_TIMING.holdMs;

      metaAutoLastEvalAt = 0;
      metaAutoLastAppliedAt = now - META_AUTO_TIMING.holdMs;
      metaAutoCandidate = snapshotMetaPlan("enabled");
      metaAutoCandidateSince = now;
      metaAutoGenreCandidate = metaAutoGenreStable;
      metaAutoGenreCandidateSince = now;
      metaAutoLastDropAt = 0;
      metaAutoLastChaosAt = 0;
      metaAutoLastTargetHz = META_AUTO_HZ_BY_LEVEL[clamp(overclockLevel, 0, MAX_OVERCLOCK_LEVEL)] || 2;
      metaAutoDriveEma = 0;
      metaAutoMotionEma = 0;
      metaAutoIntensityEma = 0;
      metaAutoDrivePeak = 0;
      metaAutoMotionPeak = 0;
      metaAutoIntensityPeak = 0;
      metaAutoHeavySince = 0;
      telemetry.metaAutoReason = "enabled";
      telemetry.metaAutoProfile = autoProfile;
      telemetry.metaAutoGenre = metaAutoGenreStable;
      telemetry.metaAutoReactivity = audioReactivityPreset;
      telemetry.metaAutoHz = META_AUTO_HZ_BY_LEVEL[clamp(overclockLevel, 0, MAX_OVERCLOCK_LEVEL)] || 2;
      telemetry.metaAutoOverclock = overclockLevel;
    } else {
      metaAutoCandidate = snapshotMetaPlan("disabled");
      metaAutoCandidateSince = now;
      metaAutoLastChaosAt = 0;
      metaAutoLastTargetHz = META_AUTO_HZ_BY_LEVEL[clamp(overclockLevel, 0, MAX_OVERCLOCK_LEVEL)] || 2;
      metaAutoDriveEma = 0;
      metaAutoMotionEma = 0;
      metaAutoIntensityEma = 0;
      metaAutoDrivePeak = 0;
      metaAutoMotionPeak = 0;
      metaAutoIntensityPeak = 0;
      metaAutoHeavySince = 0;
      telemetry.metaAutoReason = "off";
      telemetry.metaAutoProfile = autoProfile;
      telemetry.metaAutoGenre = "off";
      telemetry.metaAutoReactivity = audioReactivityPreset;
      telemetry.metaAutoHz = META_AUTO_HZ_BY_LEVEL[clamp(overclockLevel, 0, MAX_OVERCLOCK_LEVEL)] || 2;
      telemetry.metaAutoOverclock = overclockLevel;
    }

    return metaAutoEnabled;
  }

  function updateMetaAuto(now) {
    if (!metaAutoEnabled) return;
    if (now - metaAutoLastEvalAt < META_AUTO_TIMING.evalMs) return;
    metaAutoLastEvalAt = now;

    const plan = computeMetaPlan(now);
    telemetry.metaAutoProfile = plan.autoProfile;
    telemetry.metaAutoGenre = String(plan.metaGenre || metaAutoGenreStable || "auto");
    telemetry.metaAutoReactivity = plan.audioReactivityPreset;
    telemetry.metaAutoHz = Number(
      plan.targetHz || (META_AUTO_HZ_BY_LEVEL[clamp(Number(plan.overclockLevel), 0, MAX_OVERCLOCK_LEVEL)] || 2)
    );
    telemetry.metaAutoOverclock = Number(plan.overclockLevel);
    telemetry.metaAutoReason = describeMetaReason(plan);

    const current = snapshotMetaPlan(plan.reason);
    if (sameMetaPlan(plan, current)) {
      metaAutoCandidate = plan;
      metaAutoCandidateSince = now;
      return;
    }

    if (!metaAutoCandidate || !sameMetaPlan(plan, metaAutoCandidate)) {
      metaAutoCandidate = plan;
      metaAutoCandidateSince = now;
      return;
    }

    const overclockDelta = Math.abs(Number(plan.overclockLevel) - Number(overclockLevel));
    const fastPath = Boolean(plan.fastPath || overclockDelta >= 2);
    const holdMs = fastPath ? META_AUTO_TIMING.fastHoldMs : META_AUTO_TIMING.holdMs;
    const confirmMs = fastPath ? META_AUTO_TIMING.fastConfirmMs : META_AUTO_TIMING.confirmMs;

    if (now - metaAutoLastAppliedAt < holdMs) return;
    if (now - metaAutoCandidateSince < confirmMs) return;

    applyMetaPlan(plan, now);
  }

  function snapshotOverclockAutoPlan(reason = "steady", targetHz = 2, source = "meta-plan", fastPath = false) {
    return {
      overclockLevel: clamp(Number(overclockLevel) || 0, 0, MAX_OVERCLOCK_LEVEL),
      reason: String(reason || "steady"),
      targetHz: Number(targetHz) || 2,
      source: String(source || "meta-plan"),
      fastPath: Boolean(fastPath)
    };
  }

  function sameOverclockAutoPlan(a, b) {
    if (!a || !b) return false;
    return Number(a.overclockLevel) === Number(b.overclockLevel);
  }

  function setOverclockAutoEnabled(enabled) {
    const next = Boolean(enabled);
    overclockAutoEnabled = next;
    telemetry.overclockAutoEnabled = next;

    const now = Date.now();
    overclockAutoLastEvalAt = 0;
    overclockAutoLastAppliedAt = now - OVERCLOCK_AUTO_TIMING.holdMs;
    overclockAutoCandidateSince = now;
    overclockAutoCandidate = snapshotOverclockAutoPlan(
      next ? "enabled" : "off",
      META_AUTO_HZ_BY_LEVEL[clamp(overclockLevel, 0, MAX_OVERCLOCK_LEVEL)] || 2
    );
    telemetry.overclockAutoHz = META_AUTO_HZ_BY_LEVEL[clamp(overclockLevel, 0, MAX_OVERCLOCK_LEVEL)] || 2;
    telemetry.overclockAutoOverclock = overclockLevel;
    telemetry.overclockAutoReason = next ? "enabled" : "off";

    if (next) {
      // This mode intentionally controls only Hz/overclock without Meta profile/reactivity automation.
      metaAutoEnabled = false;
      telemetry.metaAutoEnabled = false;
      telemetry.metaAutoReason = "off";
      telemetry.metaAutoGenre = "off";
      telemetry.metaAutoProfile = autoProfile;
      telemetry.metaAutoReactivity = audioReactivityPreset;
      telemetry.metaAutoHz = META_AUTO_HZ_BY_LEVEL[clamp(overclockLevel, 0, MAX_OVERCLOCK_LEVEL)] || 2;
      telemetry.metaAutoOverclock = overclockLevel;
    }

    return overclockAutoEnabled;
  }

  function updateOverclockAuto(now) {
    if (!overclockAutoEnabled) return;
    if (metaAutoEnabled) return;
    if (now - overclockAutoLastEvalAt < OVERCLOCK_AUTO_TIMING.evalMs) return;
    overclockAutoLastEvalAt = now;

    const plan = computeMetaPlan(now);
    const targetPlan = {
      overclockLevel: clamp(Number(plan.overclockLevel) || 0, 0, MAX_OVERCLOCK_LEVEL),
      reason: String(plan.reason || "steady"),
      targetHz: Number(plan.targetHz) || (META_AUTO_HZ_BY_LEVEL[clamp(overclockLevel, 0, MAX_OVERCLOCK_LEVEL)] || 2),
      source: String(plan.metaGenre || "auto"),
      fastPath: Boolean(plan.fastPath)
    };

    telemetry.overclockAutoEnabled = true;
    telemetry.overclockAutoHz = targetPlan.targetHz;
    telemetry.overclockAutoOverclock = targetPlan.overclockLevel;
    telemetry.overclockAutoReason = targetPlan.reason;

    const current = snapshotOverclockAutoPlan(
      telemetry.overclockAutoReason,
      telemetry.overclockAutoHz,
      targetPlan.source,
      targetPlan.fastPath
    );
    if (sameOverclockAutoPlan(targetPlan, current)) {
      overclockAutoCandidate = targetPlan;
      overclockAutoCandidateSince = now;
      return;
    }

    if (!overclockAutoCandidate || !sameOverclockAutoPlan(targetPlan, overclockAutoCandidate)) {
      overclockAutoCandidate = targetPlan;
      overclockAutoCandidateSince = now;
      return;
    }

    const levelDelta = Math.abs(Number(targetPlan.overclockLevel) - Number(overclockLevel));
    const fastPath = Boolean(targetPlan.fastPath || levelDelta >= 2);
    const holdMs = fastPath ? OVERCLOCK_AUTO_TIMING.fastHoldMs : OVERCLOCK_AUTO_TIMING.holdMs;
    const confirmMs = fastPath ? OVERCLOCK_AUTO_TIMING.fastConfirmMs : OVERCLOCK_AUTO_TIMING.confirmMs;

    if (now - overclockAutoLastAppliedAt < holdMs) return;
    if (now - overclockAutoCandidateSince < confirmMs) return;

    setOverclock(Number(targetPlan.overclockLevel), { manual: false });
    overclockAutoLastAppliedAt = now;
  }

  /* =========================
     WIZ TIMING GUARDS
  ========================= */
  let lastWizEmit = 0;
  let nextWizEmitAt = 0;
  let wizPhase = 0;
  let wizColorIndex = 0;
  let wizColorCursor = 0;
  let lastWizScene = null;
  const WIZ_SLOW_SCENES = new Set([
    "flow_ambient",
    "flow_house",
    "flow_pop",
    "flow_rnb",
    "flow_media",
    "flow_sunset",
    "flow_glacier"
  ]);
  const WIZ_AGGRESSIVE_SCENES = new Set([
    "flow_metal",
    "flow_dnb",
    "flow_techno",
    "flow_rock",
    "flow_storm",
    "flow_cyberpunk"
  ]);
  const WIZ_TRANCE_LIKE_SCENES = new Set(["flow_trance", "flow_edm", "flow_cyberpunk"]);
  const WIZ_FLOW_DESYNC_ALIAS = Object.freeze({
    flow_wash: "flow_house",
    flow_edm: "flow_trance",
    flow_hiphop: "flow_rnb",
    flow_metal: "flow_storm",
    flow_ambient: "flow_glacier",
    flow_house: "flow_wash",
    flow_trance: "flow_edm",
    flow_dnb: "flow_techno",
    flow_pop: "flow_sunset",
    flow_rock: "flow_metal",
    flow_rnb: "flow_hiphop",
    flow_media: "flow_glacier",
    flow_techno: "flow_dnb",
    flow_cyberpunk: "flow_storm",
    flow_sunset: "flow_pop",
    flow_glacier: "flow_media",
    flow_storm: "flow_cyberpunk"
  });

  /* =========================
    OVERCLOCK TIERS
    0 = slow2
    1 = slow4
    2 = turbo6
    3 = turbo8
    4 = turbo10
    5 = turbo12
    6 = turbo14
    7 = turbo16
    8 = turbo20 (unsafe/dev)
    9 = turbo30 (unsafe/dev)
    10 = turbo40 (unsafe/dev)
    11 = turbo50 (unsafe/dev)
    12 = turbo60 (unsafe/dev)
  ========================= */
  let overclockLevel = DEFAULT_OVERCLOCK_LEVEL;

  function getBaseIntervalMs() {
    if (overclockLevel >= 12) return HZ_INTERVALS.turbo60;
    if (overclockLevel >= 11) return HZ_INTERVALS.turbo50;
    if (overclockLevel >= 10) return HZ_INTERVALS.turbo40;
    if (overclockLevel >= 9) return HZ_INTERVALS.turbo30;
    if (overclockLevel >= 8) return HZ_INTERVALS.turbo20;
    if (overclockLevel >= 7) return HZ_INTERVALS.turbo16;
    if (overclockLevel >= 6) return HZ_INTERVALS.turbo14;
    if (overclockLevel >= 5) return HZ_INTERVALS.turbo12;
    if (overclockLevel >= 4) return HZ_INTERVALS.turbo10;
    if (overclockLevel >= 3) return HZ_INTERVALS.turbo8;
    if (overclockLevel >= 2) return HZ_INTERVALS.turbo6;
    if (overclockLevel >= 1) return HZ_INTERVALS.fast;
    return HZ_INTERVALS.normal;
  }

  function getEnergyDrive() {
    const base = clamp(energy * 0.72 + audio * 0.28, 0, 1);
    const motion = clamp(
      Math.max(
        audioTransient * 0.9,
        audioFlux * 1.05,
        Number(telemetry.beatConfidence || 0) * 0.95
      ),
      0,
      1
    );
    const motionDrive = clamp((motion - 0.11) / 0.72, 0, 1);
    return clamp(Math.max(base, motionDrive * 0.82), 0, 1);
  }

  function getHueIntervalMs() {
    const base = getBaseIntervalMs();
    const motion = clamp(
      Math.max(audioTransient, audioFlux, Number(telemetry.beatConfidence || 0)),
      0,
      1
    );
    const slowMultiplier = 1 + Math.max(0.12, (1 - getEnergyDrive()) * 0.9 - motion * 0.45);
    return Math.round(base * slowMultiplier);
  }

  function getWizIntervalMs() {
    const base = getBaseIntervalMs();
    const motion = clamp(
      Math.max(audioTransient, audioFlux, Number(telemetry.beatConfidence || 0)),
      0,
      1
    );
    const slowMultiplier = 1 + Math.max(0.18, (1 - getEnergyDrive()) * 1.08 - motion * 0.5);
    const scene = String(telemetry.scene || "");
    const flowMultiplier = scene.startsWith("flow_") ? 1.16 : 1;
    return Math.round(base * slowMultiplier * flowMultiplier);
  }

  function applyEnergyBrightnessScale(rawBri) {
    const drive = getEnergyDrive();
    const scale = 0.18 + drive * 0.88;
    const floor = 30 + Math.round(drive * 48);
    return Math.round(clamp(rawBri * scale, floor, 254));
  }

  function getWizBrightness() {
    const drive = getEnergyDrive();
    return clamp(Math.pow(drive, 1.0) * 1.08, 0.14, 1);
  }

  function setOverclock(v, options = {}) {
    const opts = options && typeof options === "object" ? options : {};
    const manual = opts.manual !== false;
    let next = 0;

    if (typeof v === "number") {
      next = Math.round(clamp(v, 0, MAX_OVERCLOCK_LEVEL));
    } else if (typeof v === "string") {
      const t = v.toLowerCase();
      if (t === "turbo60" || t === "x60" || t === "dev60" || t === "unsafe60" || t === "destructive60") next = 12;
      else if (t === "turbo50" || t === "x50" || t === "dev50" || t === "unsafe50" || t === "destructive50") next = 11;
      else if (t === "turbo40" || t === "x40" || t === "dev40" || t === "unsafe40" || t === "destructive40") next = 10;
      else if (t === "turbo30" || t === "x30" || t === "dev30" || t === "unsafe30" || t === "destructive30") next = 9;
      else if (t === "turbo20" || t === "x20" || t === "dev20" || t === "unsafe20" || t === "destructive20") next = 8;
      else if (t === "turbo16" || t === "x16" || t === "ludicrous") next = 7;
      else if (t === "turbo14" || t === "x14" || t === "hyper") next = 6;
      else if (t === "turbo12" || t === "x12" || t === "insane") next = 5;
      else if (t === "turbo10" || t === "x10" || t === "extreme") next = 4;
      else if (t === "turbo8" || t === "x8" || t === "ultra") next = 3;
      else if (t === "turbo6" || t === "turbo" || t === "x6") next = 2;
      else if (t === "on" || t === "fast" || t === "true") next = 1;
      else next = 0;
    } else {
      next = v ? DEFAULT_OVERCLOCK_LEVEL : 0;
    }

    if (manual && overclockAutoEnabled) {
      overclockAutoEnabled = false;
      telemetry.overclockAutoEnabled = false;
      telemetry.overclockAutoReason = "manual";
      telemetry.overclockAutoHz = META_AUTO_HZ_BY_LEVEL[clamp(next, 0, MAX_OVERCLOCK_LEVEL)] || 2;
      telemetry.overclockAutoOverclock = next;
      overclockAutoCandidate = null;
      overclockAutoCandidateSince = 0;
    }

    overclockLevel = next;
    telemetry.overclockLevel = overclockLevel;

    const now = Date.now();
    const hueInterval = getHueIntervalMs();
    const wizInterval = getWizIntervalMs();
    nextHueEmitAt = Math.max(nextHueEmitAt, now + hueInterval);
    nextWizEmitAt = Math.max(nextWizEmitAt, now + wizInterval);
  }


/* =========================
   GAME MODE DETECTION
========================= */
let transientAvg = 0;
let forcedMode = null;

function pickAutoFlowScene() {
  const intensity = Number(telemetry.intensity || 0);
  const motion = Math.max(
    audioTransient,
    audioFlux,
    Number(telemetry.beatConfidence || 0)
  );
  const drive = getEnergyDrive();

  if (
    telemetry.drop ||
    (audioFlux > 0.32 && drive > 0.28) ||
    (audioTransient > 0.38 && intensity > 0.4)
  ) {
    return "flow_storm";
  }
  if (audioBandLow > 0.44 && intensity > 0.35) {
    return "flow_dnb";
  }
  if (audioBandMid > 0.34 || (intensity > 0.5 && motion > 0.34)) {
    return "flow_cyberpunk";
  }
  if (audioBandHigh > 0.32 || (motion > 0.42 && audioBandHigh > 0.24 && drive < 0.52)) {
    return "flow_glacier";
  }
  if (drive < 0.12 && motion < 0.16) {
    return "flow_sunset";
  }
  return "flow_wash";
}

  function resolveFlowScene(now = Date.now()) {
    if (activeGenre === "auto") {
      const proposed = pickAutoFlowScene();
      if (!autoFlowStableScene) {
        autoFlowStableScene = proposed;
        autoFlowCandidateScene = proposed;
        autoFlowCandidateSince = now;
        autoFlowLastChangeAt = now;
        return autoFlowStableScene;
      }

      if (proposed === autoFlowStableScene) {
        autoFlowCandidateScene = proposed;
        autoFlowCandidateSince = now;
        return autoFlowStableScene;
      }

      if (proposed !== autoFlowCandidateScene) {
        autoFlowCandidateScene = proposed;
        autoFlowCandidateSince = now;
        return autoFlowStableScene;
      }

      const motion = Math.max(
        audioTransient,
        audioFlux,
        Number(telemetry.beatConfidence || 0)
      );
      const drive = getEnergyDrive();
      const intenseBuild =
        telemetry.drop ||
        (telemetry.phrase === "build" && drive > 0.36) ||
        (motion > 0.6 && drive > 0.36);
      const aggressiveFlowSwitch = intenseBuild || (motion > 0.56 && drive > 0.3);
      const holdMs = aggressiveFlowSwitch
        ? Math.round((autoSwitch.sceneMinHoldMs + AUTO_FLOW_SWITCH_EXTRA_HOLD_MS) * 0.45)
        : autoSwitch.sceneMinHoldMs + AUTO_FLOW_SWITCH_EXTRA_HOLD_MS;
      const confirmMs = aggressiveFlowSwitch
        ? Math.round((autoSwitch.sceneConfirmMs + AUTO_FLOW_SWITCH_EXTRA_CONFIRM_MS) * 0.42)
        : autoSwitch.sceneConfirmMs + AUTO_FLOW_SWITCH_EXTRA_CONFIRM_MS;

      if (!intenseBuild && now - autoFlowLastChangeAt < holdMs) {
        return autoFlowStableScene;
      }
      if (!intenseBuild && now - autoFlowCandidateSince < confirmMs) {
        return autoFlowStableScene;
      }

      autoFlowStableScene = proposed;
      autoFlowLastChangeAt = now;
      return autoFlowStableScene;
    }

    return (GENRE_SCENES[activeGenre] || GENRE_SCENES.auto).flow || "flow_wash";
  }

function normalizeSceneLock(sceneName) {
  const raw = String(sceneName || "").trim().toLowerCase();
  if (!raw || raw === "auto") return null;
  if (raw === "flow") return "flow";
  if (raw === "idle") return "idle_soft";
  if (raw === "pulse") return "pulse_strobe";
  if (raw === "flow_latin") return "flow_rnb";
  if (raw === "flow_movie" || raw === "flow_movies" || raw === "flow_cinema" || raw === "media") return "flow_media";
  if (SCENES[raw]) return raw;
  return null;
}

function setWizSceneSync(enabled) {
  wizSceneSync = Boolean(enabled);
  telemetry.sceneSync = wizSceneSync;
  telemetry.wizSceneSync = wizSceneSync;
  return wizSceneSync;
}

function getDesyncedFlowScene(sceneName) {
  const key = String(sceneName || "").trim().toLowerCase();
  return WIZ_FLOW_DESYNC_ALIAS[key] || key || "flow_wash";
}

function resolveWizScene(now = Date.now()) {
  const hueScene = String(telemetry.scene || stableScene || "idle_soft");
  if (wizSceneSync) return hueScene;

  if (forcedSceneInput === "flow") {
    return getDesyncedFlowScene(resolveFlowScene(now));
  }

  if (forcedScene && forcedScene !== FLOW_DYNAMIC_LOCK) {
    return forcedScene;
  }

  const behavior = String(telemetry.behavior || "idle").trim().toLowerCase();
  if (behavior === "flow") {
    const flowScene = activeGenre === "auto"
      ? resolveFlowScene(now)
      : ((GENRE_SCENES[activeGenre] || GENRE_SCENES.auto).flow || "flow_wash");
    return getDesyncedFlowScene(flowScene);
  }

  const fallbackGenreScenes = GENRE_SCENES[activeGenre] || GENRE_SCENES.auto;
  return fallbackGenreScenes[behavior] || "idle_soft";
}

function updateMode() {
  const transient = Math.abs(audio - energy);
  transientAvg += (transient - transientAvg) * 0.1;

  if (forcedMode !== null) {
    telemetry.mode = forcedMode;
    telemetry.modeLock = forcedMode;
  } else {
    telemetry.mode = transientAvg > 0.12 ? "clamp" : "interpret";
    telemetry.modeLock = "auto";
  }
}

function getModeSwitchBias() {
  const lock = String(telemetry.modeLock || "auto").trim().toLowerCase();
  if (lock === "clamp") {
    return {
      idleThresholdBias: 0.014,
      flowThresholdBias: 0.04,
      hysteresisScale: 1.25,
      behaviorHoldScale: 1.22,
      behaviorConfirmScale: 1.18,
      sceneHoldScale: 1.2,
      sceneConfirmScale: 1.16
    };
  }
  if (lock === "interpret") {
    return {
      idleThresholdBias: -0.01,
      flowThresholdBias: -0.022,
      hysteresisScale: 0.82,
      behaviorHoldScale: 0.84,
      behaviorConfirmScale: 0.8,
      sceneHoldScale: 0.82,
      sceneConfirmScale: 0.78
    };
  }
  return {
    idleThresholdBias: 0,
    flowThresholdBias: 0,
    hysteresisScale: 1,
    behaviorHoldScale: 1,
    behaviorConfirmScale: 1,
    sceneHoldScale: 1,
    sceneConfirmScale: 1
  };
}


  /* =========================
     MIDI / OSC BIAS
  ========================= */
  let midiEnergyBoost = 0;
  let oscEnergyBoost = 0;
  let externalBeat = false;
  let externalDrop = false;

  function decayExternal() {
    midiEnergyBoost *= 0.85;
    oscEnergyBoost *= 0.85;
    externalBeat = false;
    externalDrop = false;
  }

  function setIntent(intent = {}) {
  switch (intent.type) {

    case "MIDI_NOTE":
      midiEnergyBoost = Math.max(
        midiEnergyBoost,
        clamp((intent.velocity || 0) / 127, 0, 1) * 0.4
      );

      externalBeat = true;

      if (dropDetectionEnabled && intent.velocity > 90) {
        externalDrop = true;
      }
      break;

    case "MIDI_CC":
      // CC 64 = overclock toggle (EDGE-TRIGGERED)
      if (intent.cc === 64) {
        const next = intent.value > 64;
        const target = next ? DEFAULT_OVERCLOCK_LEVEL : 0;
        if (target !== overclockLevel) {
          setOverclock(target);
        }
      }
      break;

    case "OSC_ENERGY":
      oscEnergyBoost = clamp(intent.value || 0, 0, 1) * 0.6;
      break;

    case "OSC_BEAT":
      externalBeat = true;
      break;

    case "OSC_DROP":
      if (dropDetectionEnabled) {
        externalDrop = true;
      }
      break;
  }

  telemetry.midiBias = midiEnergyBoost;
  telemetry.oscBias = oscEnergyBoost;
}


  /* =========================
     ENERGY FOLLOWER
  ========================= */
  let energyFloor = 0;
  let silentFrames = 0;

  function updateEnergy() {
    const gp = getGenreAudioProfile();
    const floorTarget = audio < 0.08 ? audio : 0;
    energyFloor += (floorTarget - energyFloor) * 0.02;
    energyFloor = clamp(energyFloor, 0, 0.08);

    const silentInput =
      audio === 0 &&
      audioPeak === 0 &&
      audioTransient === 0 &&
      audioFlux === 0 &&
      midiEnergyBoost < 0.01 &&
      oscEnergyBoost < 0.01 &&
      !externalBeat &&
      !externalDrop;

    if (silentInput) silentFrames += 1;
    else silentFrames = 0;

    if (silentInput && silentFrames >= 6) {
      const decay = telemetry.mode === "clamp" ? 0.9 : 0.88;
      energy *= decay;
      energyFloor *= 0.86;
      if (energy < 0.002) energy = 0;
      if (energyFloor < 0.001) energyFloor = 0;

      telemetry.energy = energy;
      telemetry.intensity = clamp(energy * 0.55, 0, 1);
      return;
    }

    const peakLift = clamp((audioPeak - audio) * 0.35, 0, 0.25);
    const transientLift = clamp(audioTransient * 0.28, 0, 0.34);
    const zcrLift = clamp(audioZcr * 0.05, 0, 0.05);
    const bandLift = clamp(
      audioBandLow * gp.bandLow + audioBandMid * gp.bandMid + audioBandHigh * gp.bandHigh,
      0,
      0.34
    );
    const fluxLift = clamp(audioFlux * gp.flux, 0, 0.2);

    const target = clamp(audio * gp.audioGain + peakLift + transientLift + zcrLift + bandLift + fluxLift, 0, 1.2);

    let biasedTarget = clamp(
      target + midiEnergyBoost + oscEnergyBoost,
      0,
      1.2
    );

    // Quiet-audio cap prevents low RMS beds from inflating into pulse energy.
    if (!externalDrop) {
      const quietByRms = clamp((audio - 0.05) / 0.3, 0, 1);
      const quietByTransient = clamp((audioTransient - 0.05) / 0.35, 0, 1);
      const quietByFlux = clamp((audioFlux - 0.03) / 0.28, 0, 1);
      const quietDrive = Math.max(quietByRms, quietByTransient, quietByFlux);
      const quietCap = 0.1 + quietDrive * 0.56;
      biasedTarget = Math.min(biasedTarget, quietCap);

      // Keep subtle movement alive in quieter passages with real motion.
      const microMotionFloor = clamp(
        audioTransient * 0.12 +
        audioFlux * 0.11 +
        Math.max(audioBandLow, audioBandMid, audioBandHigh) * 0.03,
        0,
        0.11
      );
      biasedTarget = Math.max(biasedTarget, microMotionFloor);
    }

    if (telemetry.mode === "clamp") {
      const limited = Math.min(biasedTarget, energy + 0.12);
      energy += (limited - energy) * 0.25;
    } else {
      energy += (biasedTarget - energy) * (biasedTarget > energy ? 0.45 : 0.18);
    }

    if (energy < energyFloor) {
      energy = energyFloor;
    }

    telemetry.energy = energy;
    telemetry.intensity = clamp(
      energy * 0.68 +
      audioTransient * 0.2 +
      Math.max(0, audioPeak - audio) * 0.12 +
      audioFlux * gp.intensityFlux +
      audioBandHigh * gp.intensityHigh,
      0,
      1
    );
  }

  /* =========================
     BEAT DETECTION
  ========================= */
  let lastBeatTime = 0;
  let beatIntervals = [];
  let beatEnergyAtLast = 0;

  function estimateBpm() {
    if (!beatIntervals.length) return 0;
    const sorted = [...beatIntervals].sort((a, b) => a - b);
    const center = sorted.slice(1, Math.max(2, sorted.length - 1));
    const avg =
      center.reduce((sum, n) => sum + n, 0) / Math.max(1, center.length);
    if (!Number.isFinite(avg) || avg <= 0) return 0;
    return clamp(60000 / avg, 55, 190);
  }

  function registerBeat(now) {
    const gp = getGenreAudioProfile();
    if (lastBeatTime > 0) {
      const interval = now - lastBeatTime;
      if (interval >= 130 && interval <= 1500) {
        beatIntervals.push(interval);
        if (beatIntervals.length > 12) beatIntervals.shift();
      }
    }

    const bpm = estimateBpm();
    telemetry.bpm = bpm;
    telemetry.beatIntervalMs = lastBeatTime > 0 ? now - lastBeatTime : 0;

    if (bpm > 0 && telemetry.beatIntervalMs > 0) {
      const expected = 60000 / bpm;
      const err = Math.abs(telemetry.beatIntervalMs - expected) / expected;
      telemetry.beatConfidence = clamp(1 - err * 1.6, 0, 1);
    } else {
      telemetry.beatConfidence = clamp(
        audioTransient * (gp.beatTransientLower * 9) +
        audioFlux * (gp.beatFluxLower * 7),
        0,
        1
      );
    }

    lastBeatTime = now;
    beatEnergyAtLast = energy;
  }

  function detectBeat(now) {
    const gp = getGenreAudioProfile();
    const genreRef = effectiveGenreReference || GENRE_REFERENCE_TRACKS.auto;
    if (externalBeat) {
      registerBeat(now);
      return true;
    }

    const bpmHint = clamp(Number(genreRef.detectBpm || genreRef.bpm || 124), 60, 190);
    const bpmForGap = telemetry.bpm > 0 ? telemetry.bpm : bpmHint;
    const beatGapScale = clamp(Number(genreRef.beatGapScale ?? 0.45), 0.35, 0.65);
    const predictedMs = clamp((60000 / bpmForGap) * beatGapScale, 120, 420);

    const gap = now - lastBeatTime;
    if (gap < predictedMs) return false;

    const modeBase = telemetry.mode === "clamp" ? gp.beatBaseClamp : gp.beatBaseInterpret;
    const transientLower = clamp(
      audioTransient * gp.beatTransientLower + audioFlux * gp.beatFluxLower,
      0,
      gp.beatLowerCap
    );
    const beatThresholdBias = clamp(Number(genreRef.beatThresholdBias || 0), -0.05, 0.06);
    const threshold = clamp(modeBase - transientLower + beatThresholdBias, 0.18, 0.39);

    const rise = energy - beatEnergyAtLast;
    const beatRiseBias = clamp(Number(genreRef.beatRiseBias || 0), -0.004, 0.006);
    const riseGate = clamp(
      gp.beatRiseBase - audioTransient * gp.beatRiseTransient - audioFlux * gp.beatRiseFlux + beatRiseBias,
      gp.beatRiseMin,
      gp.beatRiseMax + 0.004
    );

    if (energy > threshold && rise > riseGate) {
      registerBeat(now);
      return true;
    }
    return false;
  }

  /* =========================
     PHRASE + DROP DETECTION
  ========================= */
  let energyTrend = 0;
  let lastEnergy = 0;
  let dropCooldown = 0;

  function updatePhrase() {
    const gp = getGenreAudioProfile();
    const delta = energy - lastEnergy;
    lastEnergy = energy;

    energyTrend += (delta - energyTrend) * 0.2;

    telemetry.drop = false;
    telemetry.phrase = "neutral";

    if (energyTrend > gp.buildTrend && energy > gp.buildEnergy) {
      telemetry.phrase = "build";
    }

    const dropSlope = gp.dropSlopeBase - audioTransient * gp.dropTransient - audioFlux * gp.dropFlux;
    const dropEnergyGate = gp.dropEnergyBase + clamp(
      gp.dropEnergyPad - audioTransient * gp.dropEnergyTransient,
      0,
      gp.dropEnergyPad
    );

    const shouldDrop =
      dropDetectionEnabled &&
      (
        (energyTrend < dropSlope && energy > dropEnergyGate && dropCooldown <= 0) ||
        externalDrop
      );
    if (shouldDrop) {
      telemetry.phrase = "drop";
      telemetry.drop = true;
      dropCooldown = telemetry.bpm > 0
        ? Math.round(clamp((60000 / telemetry.bpm) / 50, 10, 18))
        : 12;
    }

    if (!telemetry.drop && dropCooldown > 2 && energyTrend > gp.recoverTrend && energy > gp.recoverEnergy) {
      telemetry.phrase = "recover";
    }

    if (dropCooldown > 0) dropCooldown--;
  }

  /* =========================
     BEHAVIOR SELECTION
  ========================= */
  function chooseBehavior(now) {
    const gp = getGenreAudioProfile();
    const genreRef = effectiveGenreReference || GENRE_REFERENCE_TRACKS.auto;
    const mem = getGenreMemory(activeGenre);
    const modeBias = getModeSwitchBias();
    const drive = getEnergyDrive();
    const motion = Math.max(
      audioTransient,
      audioFlux,
      Number(telemetry.beatConfidence || 0)
    );

    let idleT = 0.08 - (mem.idle - 1) * 0.01;
    let flowT = 0.25 - (mem.flow - 1) * 0.015;
    idleT += Number(genreRef.idleOffset || 0);
    flowT += Number(genreRef.flowOffset || 0);
    idleT += modeBias.idleThresholdBias;
    flowT += modeBias.flowThresholdBias;
    if (overclockLevel >= 3) {
      // In sustained 8Hz+ modes, require slightly more energy before pulse.
      idleT += 0.012;
      flowT += 0.045;
    }
    const hRaw = overclockLevel > 0
      ? Math.max(0.02, autoSwitch.hysteresis * 0.6)
      : autoSwitch.hysteresis;
    const h = clamp(hRaw * modeBias.hysteresisScale, 0.02, 0.16);

    let desired = stableBehavior;

    if (stableBehavior === "idle") {
      if (energy >= idleT + h) {
        desired = energy < flowT + h ? "flow" : "pulse";
      }
    } else if (stableBehavior === "flow") {
      if (energy < idleT - h) desired = "idle";
      else if (energy >= flowT + h) desired = "pulse";
    } else {
      if (energy < flowT - h) {
        desired = energy < idleT - h ? "idle" : "flow";
      }
    }

    if (telemetry.drop) {
      desired = "pulse";
    } else if (telemetry.phrase === "recover" && desired === "pulse") {
      desired = "flow";
    } else if (telemetry.phrase === "build" && desired === "idle") {
      desired = "flow";
    }

    if (audioFlux > gp.forcePulseFlux && energy > gp.forcePulseEnergy) {
      desired = "pulse";
    }

    if (
      gp.forceFlowLowFlux !== undefined &&
      audioFlux < gp.forceFlowLowFlux &&
      desired === "pulse" &&
      energy < 0.55
    ) {
      desired = "flow";
    }

    // Heavy tracks (high transient/flux) can auto-promote from flow to pulse.
    const heavyEnergyGate = clamp(
      Number(genreRef.heavyPromoteEnergy ?? 0.32),
      0.2,
      0.6
    );
    const heavyTransientGate = clamp(
      Number(genreRef.heavyPromoteTransient ?? 0.22),
      0.1,
      0.35
    );
    const heavyFluxGate = clamp(
      Number(genreRef.heavyPromoteFlux ?? 0.2),
      0.08,
      0.35
    );
    const heavyMotionGate = clamp(
      Number(genreRef.heavyPromoteMotion ?? 0.52),
      0.3,
      0.85
    );
    if (
      !telemetry.drop &&
      desired === "flow" &&
      energy > heavyEnergyGate &&
      (audioTransient > heavyTransientGate || audioFlux > heavyFluxGate || motion > heavyMotionGate)
    ) {
      desired = "pulse";
    }

    if (!telemetry.drop) {
      const idleFloor = overclockLevel >= 3 ? 0.16 : 0.12;
      const basePulseFloor =
        (overclockLevel >= 3 ? 0.48 : 0.42) + Number(genreRef.pulseFloorOffset || 0);
      const pulseRelief = clamp(motion * 0.14 + Math.max(0, energy - flowT) * 0.22, 0, 0.16);
      const pulseFloor = basePulseFloor - pulseRelief;
      if (drive < idleFloor && desired !== "idle") {
        desired = "idle";
      } else if (desired === "pulse" && drive < pulseFloor) {
        desired = "flow";
      }
    }

    // Global quiet-audio guard:
    // low RMS/transients/flux should never look like a full pulse scene.
    if (!telemetry.drop) {
      const quietRmsGate = clamp(Number(genreRef.quietRmsGate ?? 0.12), 0.06, 0.24);
      const quietTransientGate = clamp(Number(genreRef.quietTransientGate ?? 0.16), 0.08, 0.28);
      const quietFluxGate = clamp(Number(genreRef.quietFluxGate ?? 0.14), 0.08, 0.26);
      const quietAudio = audio < quietRmsGate && audioTransient < quietTransientGate && audioFlux < quietFluxGate;
      if (quietAudio) {
        if (drive < 0.1) desired = "idle";
        else if (desired === "pulse") desired = "flow";
      }
    }

    // Pulse must be justified by musical motion; otherwise stay in flow/idle.
    if (desired === "pulse" && !telemetry.drop) {
      const motionBeatGate = clamp(
        Number(genreRef.motionBeatConfidence ?? 0.44),
        0.24,
        0.68
      );
      const motionTransientGate = clamp(
        Number(genreRef.motionTransient ?? 0.18),
        0.1,
        0.32
      );
      const motionFluxGate = clamp(
        Number(genreRef.motionFlux ?? 0.18),
        0.08,
        0.3
      );
      const pulseMotion =
        telemetry.phrase === "build" ||
        isFinite(telemetry.beatConfidence) && telemetry.beatConfidence > motionBeatGate ||
        audioTransient > motionTransientGate ||
        audioFlux > motionFluxGate;

      if (!pulseMotion) {
        desired = drive < 0.12 ? "idle" : "flow";
      }
    }

    const emergencyDemotePulse = !telemetry.drop &&
      stableBehavior === "pulse" &&
      desired !== "pulse" &&
      drive < (overclockLevel >= 3 ? 0.38 : 0.34);

    if (emergencyDemotePulse) {
      stableBehavior = desired;
      behaviorCandidate = desired;
      behaviorCandidateSince = now;
      lastBehaviorChangeAt = now;
      return stableBehavior;
    }

    if (desired === stableBehavior) {
      behaviorCandidate = desired;
      behaviorCandidateSince = now;
      return stableBehavior;
    }

    if (behaviorCandidate !== desired) {
      behaviorCandidate = desired;
      behaviorCandidateSince = now;
      return stableBehavior;
    }

    const fastBehaviorSwitch =
      telemetry.drop ||
      telemetry.phrase === "build" ||
      (motion > 0.58 && drive > 0.34);
    const behaviorHoldBaseMs = fastBehaviorSwitch
      ? Math.round(autoSwitch.behaviorMinHoldMs * 0.4)
      : autoSwitch.behaviorMinHoldMs;
    const behaviorConfirmBaseMs = fastBehaviorSwitch
      ? Math.round(autoSwitch.behaviorConfirmMs * 0.45)
      : autoSwitch.behaviorConfirmMs;
    const behaviorHoldMs = Math.round(behaviorHoldBaseMs * modeBias.behaviorHoldScale);
    const behaviorConfirmMs = Math.round(behaviorConfirmBaseMs * modeBias.behaviorConfirmScale);

    if (now - lastBehaviorChangeAt < behaviorHoldMs) {
      return stableBehavior;
    }

    if (now - behaviorCandidateSince < behaviorConfirmMs) {
      return stableBehavior;
    }

    stableBehavior = desired;
    lastBehaviorChangeAt = now;
    return stableBehavior;
  }

  function chooseScene(now, behavior) {
    if (forcedScene) {
      const lockedScene = forcedScene === FLOW_DYNAMIC_LOCK
        ? resolveFlowScene(now)
        : forcedScene;
      stableScene = lockedScene;
      sceneCandidate = lockedScene;
      sceneCandidateSince = now;
      return lockedScene;
    }

    const directDesired = activeGenre === "auto" && behavior === "flow"
      ? resolveFlowScene(now)
      : (GENRE_SCENES[activeGenre] || GENRE_SCENES.auto)[behavior];
    let desiredScene = directDesired;
    const modeBias = getModeSwitchBias();
    const drive = getEnergyDrive();

    // Prevent abrupt pulse -> idle jumps unless energy is truly quiet.
    if (
      stableScene === "pulse_strobe" &&
      directDesired === "idle_soft" &&
      energy > 0.11 &&
      !telemetry.drop
    ) {
      desiredScene = resolveFlowScene(now);
    }

    const emergencyExitPulse =
      stableScene === "pulse_strobe" &&
      desiredScene !== "pulse_strobe" &&
      !telemetry.drop &&
      drive < 0.42 &&
      audio < 0.12 &&
      audioTransient < 0.18 &&
      audioFlux < 0.16;

    if (emergencyExitPulse) {
      stableScene = desiredScene;
      sceneCandidate = desiredScene;
      sceneCandidateSince = now;
      lastSceneChangeAt = now;
      return stableScene;
    }

    if (desiredScene === stableScene) {
      sceneCandidate = desiredScene;
      sceneCandidateSince = now;
      return stableScene;
    }

    if (sceneCandidate !== desiredScene) {
      sceneCandidate = desiredScene;
      sceneCandidateSince = now;
      return stableScene;
    }

    const sceneMotion = Math.max(
      audioTransient,
      audioFlux,
      Number(telemetry.beatConfidence || 0)
    );
    const autoFlowToFlow =
      activeGenre === "auto" &&
      stableScene.startsWith("flow_") &&
      desiredScene.startsWith("flow_") &&
      stableScene !== desiredScene;
    const strongBuild = telemetry.phrase === "build" && drive > 0.4;
    const extremeMotion = sceneMotion > 0.66 && drive > 0.46;
    const allowFastPulse =
      desiredScene === "pulse_strobe" &&
      (telemetry.drop || strongBuild || extremeMotion);
    const aggressiveSceneSwitch =
      allowFastPulse ||
      (autoFlowToFlow && sceneMotion > 0.54 && drive > 0.3) ||
      (sceneMotion > 0.64 && drive > 0.42);
    const sceneHoldBaseMs =
      Math.round((
        autoSwitch.sceneMinHoldMs +
        (autoFlowToFlow ? AUTO_FLOW_TO_FLOW_EXTRA_HOLD_MS : 0)
      ) * (aggressiveSceneSwitch ? 0.46 : 1));
    const sceneConfirmBaseMs =
      Math.round((
        autoSwitch.sceneConfirmMs +
        (autoFlowToFlow ? AUTO_FLOW_TO_FLOW_EXTRA_CONFIRM_MS : 0)
      ) * (aggressiveSceneSwitch ? 0.44 : 1));
    const sceneHoldMs = Math.max(140, Math.round(sceneHoldBaseMs * modeBias.sceneHoldScale));
    const sceneConfirmMs = Math.max(120, Math.round(sceneConfirmBaseMs * modeBias.sceneConfirmScale));

    if (!allowFastPulse && now - lastSceneChangeAt < sceneHoldMs) {
      return stableScene;
    }

    if (!allowFastPulse && now - sceneCandidateSince < sceneConfirmMs) {
      return stableScene;
    }

    stableScene = desiredScene;
    lastSceneChangeAt = now;
    return stableScene;
  }

  /* =========================
     HUE EMITTER
  ========================= */
  function emitHue(now, isBeat) {
    const interval = getHueIntervalMs();
    if (!nextHueEmitAt) nextHueEmitAt = now;
    if (now < nextHueEmitAt) return;

    nextHueEmitAt += interval;
    if (nextHueEmitAt < now - interval * 2) {
      nextHueEmitAt = now + interval;
    }

    lastHueEmit = now;

    phase++;
    telemetry.phase = phase;

    const behavior = chooseBehavior(now);
    telemetry.behavior = behavior;

    const sceneName = chooseScene(now, behavior);


    telemetry.scene = sceneName;
    telemetry.sceneAgeMs = Math.max(0, now - lastSceneChangeAt);
    const scene = SCENES[sceneName];

    let hue, bri, transition;

    if (sceneName === "idle_soft") {
      hue = (phase * scene.hueSpeed) % 65535;
      bri = scene.briBase + Math.sin(phase * 0.4) * scene.briWave;
      transition = scene.transition;
      reinforce(activeGenre, "idle", 0.01);
    }
    else if (sceneName.startsWith("flow_")) {
      const drive = getEnergyDrive();
      const flowEnergy = clamp(flowIntensity, FLOW_INTENSITY_MIN, FLOW_INTENSITY_MAX);
      const flowMotionScale = 0.68 + flowEnergy * 0.52;
      const flowHueScale = 0.72 + flowEnergy * 0.5;
      const flowLiftScale = 0.72 + flowEnergy * 0.48;
      const flowWaveScale = 0.65 + flowEnergy * 0.55;
      const motion = clamp(
        audioTransient * 0.46 +
        audioFlux * 0.34 +
        Number(telemetry.beatConfidence || 0) * 0.2 +
        (isBeat ? 0.08 : 0) +
        (telemetry.drop ? 0.16 : 0),
        0,
        1
      );
      const scaledMotion = clamp(motion * flowMotionScale, 0, 1);
      const beatLift = (isBeat ? (scene.beatLift || 0) : 0) * flowLiftScale;
      const dropLift = (telemetry.drop ? (scene.dropLift || 0) : 0) * flowLiftScale;
      const transitionByRate = Math.max(1, Math.round(interval / 120));
      const flowHue = FLOW_HUE_PALETTES[sceneName];
      if (flowHue && Array.isArray(flowHue.anchors) && flowHue.anchors.length) {
        const strideBase = Math.max(1, Number(flowHue.stride) || 4);
        const stride = Math.max(1, Math.round(strideBase - scaledMotion * 1.8));
        const anchor = flowHue.anchors[Math.floor(phase / stride) % flowHue.anchors.length];
        const swing = Math.min(scene.hueSwing, Number(flowHue.swing) || scene.hueSwing);
        const micro = Number(flowHue.micro) || 650;
        const drift = Number(flowHue.drift) || 0;
        const stepBase = Number(flowHue.step) || Math.max(40, Math.round(scene.hueStep * 0.22));
        const step = stepBase * (1 + scaledMotion * 1.35) * flowHueScale;
        const reactiveWarp = (
          Math.sin(now / 42 + phase * 0.66) * (180 + scaledMotion * 1180) +
          Math.sin(now / 68 + audioBandLow * 6.28) * (90 + audioBandLow * 520) +
          Math.sin(now / 56 + audioBandHigh * 5.1) * (70 + audioBandHigh * 470)
        ) * flowHueScale;
        hue = (
          anchor +
          Math.sin(phase * 0.33) * swing +
          Math.sin(phase * 0.11 + now / 1000) * micro +
          Math.sin(now / Math.max(40, scene.hueTimeDiv) * 0.2) * drift +
          phase * step +
          reactiveWarp
        ) % 65535;
      } else {
        const step = scene.hueStep * (1 + scaledMotion * 1.35) * flowHueScale;
        hue = (
          (now / scene.hueTimeDiv) +
          Math.sin(phase * 0.35) * scene.hueSwing +
          phase * step +
          Math.sin(now / 44 + phase * 0.62) * (180 + scaledMotion * 1100) * flowHueScale
        ) % 65535;
      }
      if (hue < 0) hue += 65535;
      const motionLift = (
        scaledMotion * (10 + (scene.beatLift || 10) * 0.85) +
        Math.max(0, drive - 0.2) * 18
      ) * flowLiftScale;
      const reactiveWave = Math.sin(phase * (0.38 + scaledMotion * 0.34) + audioFlux * 2.5) *
        (scene.briWave * (0.7 + scaledMotion * 0.9) * flowWaveScale);
      bri = clamp(
        scene.briBase +
        energy * scene.briScale +
        reactiveWave +
        beatLift +
        dropLift +
        motionLift,
        scene.briMin || 110,
        scene.briMax || 225
      );
      const baseTransition = Math.min(scene.transition, transitionByRate);
      const flowTransitionFloor = Math.min(
        scene.transition,
        interval <= 110 ? 2 : (interval <= 220 ? 2 : 3)
      );
      const transitionDrop =
        Math.round(scaledMotion * 2.2 * flowLiftScale) +
        (isBeat ? 1 : 0) +
        (telemetry.drop ? 1 : 0);
      transition = Math.round(clamp(baseTransition - transitionDrop, flowTransitionFloor, scene.transition));
      reinforce(activeGenre, "flow", 0.02);
    }
    else {
      hue = (phase * scene.hueStep) % 65535;
      bri = clamp(scene.briBase + energy * scene.briScale, 150, 254);

      transition = telemetry.drop
        ? 1
        : (isBeat ? scene.transitionBeat : scene.transitionFree);

      reinforce(activeGenre, "pulse", telemetry.drop ? 0.08 : 0.02);
    }

    controls.emit({
      type: "HUE_STATE",
      phase,
      energy,
      rateMs: interval,
      forceRate: overclockLevel >= 2,
      forceDelta: sceneName.startsWith("flow_"),
      deltaScale: sceneName.startsWith("flow_") ? 0.75 : 1,
      state: {
        on: true,
        hue,
        sat: scene.sat,
        bri: applyEnergyBrightnessScale(bri),
        transitiontime: transition
      }
    });
  }

  /* =========================
    WIZ EMITTER
  ========================= */
  function emitWiz(now, isBeat) {
    const interval = getWizIntervalMs();
    if (!nextWizEmitAt) nextWizEmitAt = now;
    if (now < nextWizEmitAt) return;

    nextWizEmitAt += interval;
    if (nextWizEmitAt < now - interval * 2) {
      nextWizEmitAt = now + interval;
    }

    const scene = resolveWizScene(now);
    telemetry.wizScene = scene;
    const flowScene = scene.startsWith("flow_");
    let palette = WIZ_PALETTES[scene] || WIZ_PALETTES.idle_soft;
    if (scene === "pulse_strobe") {
      palette = WIZ_PULSE_PALETTES[activeGenre] || WIZ_PULSE_PALETTES.auto;
    }

    // reset palette position if scene changed
    if (scene !== lastWizScene) {
      wizColorIndex = 0;
      wizColorCursor = 0;
      lastWizScene = scene;
    }

    const drive = getEnergyDrive();
    const motion = Math.max(
      audioTransient,
      audioFlux,
      Number(telemetry.beatConfidence || 0)
    );
    // Keep flow scenes alive even in quieter passages.
    const canAnimate = flowScene || drive > 0.16;
    const motionAdvanceEvery = WIZ_SLOW_SCENES.has(scene)
      ? Math.max(2, 6 - Math.round(motion * 5))
      : Math.max(1, 4 - Math.round(motion * 4));
    const motionAdvance = flowScene && canAnimate && motion > 0.1 && (wizPhase % motionAdvanceEvery === 0);
    const shouldAdvance = canAnimate && (
      WIZ_SLOW_SCENES.has(scene)
        ? (telemetry.drop || (isBeat && (wizPhase % 2 === 0)))
        : WIZ_AGGRESSIVE_SCENES.has(scene)
          ? (isBeat || telemetry.drop || telemetry.phrase === "build" || energy > 0.55)
          : WIZ_TRANCE_LIKE_SCENES.has(scene)
            ? (isBeat || telemetry.drop || telemetry.phrase === "build" || telemetry.audioFlux > 0.22)
            : (isBeat || telemetry.drop || telemetry.phrase === "build")
    ) || motionAdvance;

    if (!palette.length) {
      palette = WIZ_PALETTES.idle_soft;
    }

    let color;
    if (flowScene) {
      const len = Math.max(1, palette.length);
      const flowEnergy = clamp(flowIntensity, FLOW_INTENSITY_MIN, FLOW_INTENSITY_MAX);
      const flowSpeedScale = 0.5 + flowEnergy * 0.42;
      const flowTextureScale = 0.52 + flowEnergy * 0.48;
      const speedBase = (0.03 + drive * 0.22 + motion * 0.4) * flowSpeedScale;
      const phraseBoost = telemetry.phrase === "build" ? 0.08 : 0;
      const beatBoost = isBeat ? (0.08 + motion * 0.12) : 0;
      const dropBoost = telemetry.drop ? 0.2 : 0;
      const intervalScale = clamp(interval / 165, 0.5, 2.1);
      const step = (speedBase + phraseBoost + beatBoost + dropBoost) * intervalScale;
      wizColorCursor = (wizColorCursor + step) % len;

      const baseIdx = Math.floor(wizColorCursor) % len;
      const nextIdx = (baseIdx + 1) % len;
      const mixT = wizColorCursor - Math.floor(wizColorCursor);
      const baseColor = blendColor(palette[baseIdx], palette[nextIdx], mixT);

      // Add subtle time/audio modulation so flow never looks frozen.
      const texture = (4 + motion * 14 + Math.max(0, drive - 0.2) * 10) * flowTextureScale;
      const waveR =
        Math.sin(now / 260 + wizColorCursor * 1.35 + audioBandHigh * 4.2) * texture +
        Math.sin(now / 760 + audioBandLow * 3.5) * (1.6 + drive * 4);
      const waveG =
        Math.sin(now / 300 + wizColorCursor * 1.05 + audioBandMid * 4.1) * texture +
        Math.sin(now / 820 + audioBandHigh * 3.2) * (1.6 + motion * 4);
      const waveB =
        Math.sin(now / 240 + wizColorCursor * 1.55 + audioBandLow * 3.8) * texture +
        Math.sin(now / 700 + audioBandMid * 3.7) * (1.6 + drive * 3.6);

      color = {
        r: clamp255(baseColor.r + waveR),
        g: clamp255(baseColor.g + waveG),
        b: clamp255(baseColor.b + waveB)
      };
      wizColorIndex = baseIdx;
    } else {
      if (shouldAdvance) {
        wizColorIndex = (wizColorIndex + 1) % palette.length;
      }
      color = palette[wizColorIndex];
    }
    const saturationBoost = clamp((flowScene ? 0.24 : 0.23) + (motion * 0.16), 0, 0.5);
    const boostedColor = boostColorSaturation(color, saturationBoost);

    lastWizEmit = now;

    controls.emit({
      type: "WIZ_PULSE",
      phase: wizPhase++,
      energy,
      rateMs: interval,
      forceRate: overclockLevel >= 3,
      // Keep flow moving even on low-motion tracks.
      forceDelta: flowScene ? true : motion > 0.28,
      deltaScale: flowScene ? clamp(0.72 - motion * 0.28, 0.34, 0.82) : 1,
      beat: telemetry.drop || isBeat,
      drop: telemetry.drop,
      color: boostedColor,
      brightness: flowScene
        ? clamp(getWizBrightness() * clamp(0.9 + flowIntensity * 0.17, 0.7, 1.35), 0.14, 1)
        : getWizBrightness()
    });
  }


  /* =========================
     LOOP
  ========================= */
  function loop() {
    if (!running) return;

    try {
      const now = Date.now();

      updateMode();
      updateEnergy();

      const isBeat = detectBeat(now);
      telemetry.beat = isBeat;

      updatePhrase();
      maybeRefreshGenreReference(now);
      updateMetaAuto(now);
      updateOverclockAuto(now);

      emitHue(now, isBeat);
      emitWiz(now, isBeat);
      decayExternal();


    } catch (err) {
      console.error("[RAVE][LOOP ERROR]", err);
    }

    setTimeout(loop, 16);
  }

  /* =========================
     PUBLIC API
  ========================= */
  return {
    start() {
      if (running) return;
      running = true;
      const now = Date.now();

      forcedMode = null;
      forcedScene = null;
      forcedSceneInput = null;
      telemetry.mode = "interpret";
      telemetry.modeLock = "auto";

      audio = 0;
      audioPeak = 0;
      audioTransient = 0;
      audioZcr = 0;
      audioBandLow = 0;
      audioBandMid = 0;
      audioBandHigh = 0;
      audioFlux = 0;
      energy = 0;
      energyFloor = 0;
      silentFrames = 0;
      phase = 0;
      lastHueEmit = 0;
      nextHueEmitAt = 0;
      lastWizEmit = 0;
      nextWizEmitAt = 0;
      wizPhase = 0;
      wizColorIndex = 0;
      wizColorCursor = 0;
      lastWizScene = null;
      overclockLevel = DEFAULT_OVERCLOCK_LEVEL;
      transientAvg = 0;
      energyTrend = 0;
      dropCooldown = 0;
      lastEnergy = 0;
      lastBeatTime = 0;
      beatIntervals = [];
      beatEnergyAtLast = 0;
      midiEnergyBoost = 0;
      oscEnergyBoost = 0;
      externalBeat = false;
      externalDrop = false;
      stableBehavior = "idle";
      behaviorCandidate = "idle";
      behaviorCandidateSince = now;
      lastBehaviorChangeAt = now;
      stableScene = "idle_soft";
      sceneCandidate = "idle_soft";
      sceneCandidateSince = now;
      lastSceneChangeAt = now;
      autoFlowStableScene = "flow_wash";
      autoFlowCandidateScene = autoFlowStableScene;
      autoFlowCandidateSince = now;
      autoFlowLastChangeAt = now;
      telemetry.behavior = stableBehavior;
      telemetry.scene = stableScene;
      telemetry.sceneAgeMs = 0;
      telemetry.beatConfidence = 0;
      telemetry.beatIntervalMs = 0;
      telemetry.bpm = 0;
      telemetry.intensity = 0;
      telemetry.audioTransient = 0;
      telemetry.audioPeak = 0;
      telemetry.audioZcr = 0;
      telemetry.audioBandLow = 0;
      telemetry.audioBandMid = 0;
      telemetry.audioBandHigh = 0;
      telemetry.audioFlux = 0;
      telemetry.autoProfile = autoProfile;
      telemetry.audioProfile = activeGenre;
      telemetry.genreRefTrack = `${effectiveGenreReference.artist} - ${effectiveGenreReference.title}`;
      telemetry.genreRefBpm = Number(effectiveGenreReference.bpm || 0);
      telemetry.genreDetectBpm = Number(
        effectiveGenreReference.detectBpm || effectiveGenreReference.bpm || 0
      );
      telemetry.genreRefMode = genreDecadeMode;
      telemetry.genreRefDecade = resolvedGenreDecade;
      telemetry.audioReactivityPreset = audioReactivityPreset;
      telemetry.dropDetectionEnabled = dropDetectionEnabled;
      telemetry.flowIntensity = flowIntensity;
      telemetry.sceneSync = wizSceneSync;
      telemetry.wizSceneSync = wizSceneSync;
      telemetry.wizScene = stableScene;
      telemetry.overclockLevel = overclockLevel;
      telemetry.metaAutoEnabled = metaAutoEnabled;
      telemetry.metaAutoProfile = autoProfile;
      telemetry.metaAutoGenre = metaAutoEnabled ? metaAutoGenreStable : "off";
      telemetry.metaAutoReactivity = audioReactivityPreset;
      telemetry.metaAutoHz = META_AUTO_HZ_BY_LEVEL[clamp(overclockLevel, 0, MAX_OVERCLOCK_LEVEL)] || 2;
      telemetry.metaAutoOverclock = overclockLevel;
      telemetry.metaAutoReason = metaAutoEnabled ? "armed" : "off";
      telemetry.overclockAutoEnabled = overclockAutoEnabled;
      telemetry.overclockAutoReason = overclockAutoEnabled ? "armed" : "off";
      telemetry.overclockAutoHz = META_AUTO_HZ_BY_LEVEL[clamp(overclockLevel, 0, MAX_OVERCLOCK_LEVEL)] || 2;
      telemetry.overclockAutoOverclock = overclockLevel;

      metaAutoLastEvalAt = 0;
      metaAutoLastAppliedAt = now - META_AUTO_TIMING.holdMs;
      metaAutoCandidate = snapshotMetaPlan("start");
      metaAutoCandidateSince = now;
      metaAutoGenreCandidate = metaAutoGenreStable;
      metaAutoGenreCandidateSince = now;
      metaAutoLastDropAt = 0;
      metaAutoLastChaosAt = 0;
      metaAutoLastTargetHz = META_AUTO_HZ_BY_LEVEL[clamp(overclockLevel, 0, MAX_OVERCLOCK_LEVEL)] || 2;
      metaAutoDriveEma = 0;
      metaAutoMotionEma = 0;
      metaAutoIntensityEma = 0;
      metaAutoDrivePeak = 0;
      metaAutoMotionPeak = 0;
      metaAutoIntensityPeak = 0;
      metaAutoHeavySince = 0;
      overclockAutoLastEvalAt = 0;
      overclockAutoLastAppliedAt = now - OVERCLOCK_AUTO_TIMING.holdMs;
      overclockAutoCandidate = snapshotOverclockAutoPlan(
        overclockAutoEnabled ? "start" : "off",
        META_AUTO_HZ_BY_LEVEL[clamp(overclockLevel, 0, MAX_OVERCLOCK_LEVEL)] || 2
      );
      overclockAutoCandidateSince = now;

      console.log("[RAVE] v2.9 started");
      loop();
    },

    stop() {
      running = false;
    },

    setAudioLevel: setAudioLevel,
    setGenre: setGenre,
    setGenreDecadeMode: setGenreDecadeMode,
    setIntent: setIntent,
    setOverclock: setOverclock,

    // Manual scene lock
    setScene(sceneName) {
      const now = Date.now();
      const normalizedLock = normalizeSceneLock(sceneName);
      const requested = String(sceneName ?? "").trim().toLowerCase();

      if (requested && requested !== "auto" && normalizedLock === null) {
        console.warn("[RAVE] invalid scene lock:", sceneName);
        return false;
      }

      forcedSceneInput = null;
      if (normalizedLock === "flow") {
        forcedScene = FLOW_DYNAMIC_LOCK;
        forcedSceneInput = "flow";
      } else {
        forcedScene = normalizedLock;
        forcedSceneInput = normalizedLock || null;
      }

      if (forcedScene) {
        const lockedScene = forcedScene === FLOW_DYNAMIC_LOCK
          ? resolveFlowScene(now)
          : forcedScene;
        stableScene = lockedScene;
        sceneCandidate = lockedScene;
        sceneCandidateSince = now;
        lastSceneChangeAt = now;
        if (activeGenre === "auto" && lockedScene.startsWith("flow_")) {
          autoFlowStableScene = lockedScene;
          autoFlowCandidateScene = lockedScene;
          autoFlowCandidateSince = now;
          autoFlowLastChangeAt = now;
        }
        telemetry.scene = lockedScene;
        console.log(
          "[RAVE] scene locked:",
          forcedSceneInput === "flow" ? `flow -> ${lockedScene} (dynamic)` : lockedScene
        );
      } else {
        forcedSceneInput = null;
        sceneCandidate = stableScene;
        sceneCandidateSince = now;
        lastSceneChangeAt = now;
        if (activeGenre === "auto") {
          autoFlowCandidateScene = autoFlowStableScene;
          autoFlowCandidateSince = now;
          autoFlowLastChangeAt = now;
        }
        console.log("[RAVE] scene released (AUTO)");
      }

      return true;
    },

    setBehavior(mode) {
      if (mode === "clamp") {
        telemetry.mode = "clamp";
        forcedMode = "clamp";
        telemetry.modeLock = "clamp";
      } else if (mode === "interpret") {
        telemetry.mode = "interpret";
        forcedMode = "interpret";
        telemetry.modeLock = "interpret";
      } else {
        forcedMode = null;
        telemetry.modeLock = "auto";
      }
    },

    setAutoProfile(name) {
      return setAutoProfile(name);
    },

    setAudioReactivityPreset(name) {
      return setAudioReactivityPreset(name);
    },

    setDropDetectionEnabled(enabled) {
      dropDetectionEnabled = Boolean(enabled);
      if (!dropDetectionEnabled) {
        externalDrop = false;
        telemetry.drop = false;
        dropCooldown = 0;
      }
      telemetry.dropDetectionEnabled = dropDetectionEnabled;
      return dropDetectionEnabled;
    },

    getDropDetectionEnabled() {
      return dropDetectionEnabled;
    },

    setFlowIntensity(value) {
      return setFlowIntensity(value);
    },

    getFlowIntensity() {
      return flowIntensity;
    },

    setWizSceneSync(enabled) {
      return setWizSceneSync(enabled);
    },

    getWizSceneSync() {
      return wizSceneSync;
    },

    setMetaAutoEnabled(enabled) {
      return setMetaAutoEnabled(enabled);
    },

    getMetaAutoEnabled() {
      return metaAutoEnabled;
    },

    setOverclockAutoEnabled(enabled) {
      return setOverclockAutoEnabled(enabled);
    },

    getOverclockAutoEnabled() {
      return overclockAutoEnabled;
    },

    getAudioReactivityPreset() {
      return audioReactivityPreset;
    },

    normalizeGenre(name) {
      return normalizeGenreName(name);
    },

    getSupportedGenres() {
      return getSupportedGenres();
    },

    getSupportedGenreDecades() {
      return getSupportedGenreDecades();
    },

    getGenreDecadeMode() {
      return getGenreDecadeMode();
    },

    getResolvedGenreDecade() {
      return getResolvedGenreDecade();
    },

    getGenreCatalog() {
      return getGenreCatalog();
    },

    forceDrop() {
      externalBeat = true;
      if (dropDetectionEnabled) {
        externalDrop = true;
      }
      midiEnergyBoost = Math.max(midiEnergyBoost, 0.35);
      dropCooldown = 0;
    },

    getTelemetry() {
      return telemetry;
    }
  };
};


 
