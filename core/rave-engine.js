// [TITLE] Module: core/rave-engine.js
// [TITLE] Purpose: rave-engine

/**
 * ======================================================
 * RAVE CORE ENGINE v2.9 â€” HYBRID + NEURAL + MIDI/OSC
 * ======================================================
 * - Hue ALWAYS emits (time-based)
 * - BPM optional, never required
 * - Silence-safe idle glow
 * - Multi-tier output rates (2Hz to 16Hz)
 * - Neural motif memory (per-genre)
 * - Scene presets bound to motifs
 * - BPM interpret mode (always-on)
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
  const hsvToRgb255 = (h, s = 1, v = 1) => {
    const hue = ((Number(h) || 0) % 360 + 360) % 360;
    const sat = clamp(Number(s) || 0, 0, 1);
    const val = clamp(Number(v) || 0, 0, 1);
    const c = val * sat;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = val - c;
    let r1 = 0;
    let g1 = 0;
    let b1 = 0;

    if (hue < 60) { r1 = c; g1 = x; b1 = 0; }
    else if (hue < 120) { r1 = x; g1 = c; b1 = 0; }
    else if (hue < 180) { r1 = 0; g1 = c; b1 = x; }
    else if (hue < 240) { r1 = 0; g1 = x; b1 = c; }
    else if (hue < 300) { r1 = x; g1 = 0; b1 = c; }
    else { r1 = c; g1 = 0; b1 = x; }

    return {
      r: clamp255((r1 + m) * 255),
      g: clamp255((g1 + m) * 255),
      b: clamp255((b1 + m) * 255)
    };
  };
  const rgbToHsv = (color = {}) => {
    const r = clamp255(color?.r) / 255;
    const g = clamp255(color?.g) / 255;
    const b = clamp255(color?.b) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let h = 0;

    if (delta > 0) {
      if (max === r) h = ((g - b) / delta) % 6;
      else if (max === g) h = ((b - r) / delta) + 2;
      else h = ((r - g) / delta) + 4;
      h *= 60;
      if (h < 0) h += 360;
    }

    const s = max <= 0 ? 0 : (delta / max);
    const v = max;
    return {
      h: clamp(h, 0, 360),
      s: clamp(s, 0, 1),
      v: clamp(v, 0, 1)
    };
  };
  const hueDistanceDeg = (a, b) => {
    const aa = ((Number(a) || 0) % 360 + 360) % 360;
    const bb = ((Number(b) || 0) % 360 + 360) % 360;
    const delta = Math.abs(aa - bb);
    return delta > 180 ? 360 - delta : delta;
  };
  const rgbDistance = (a = {}, b = {}) => {
    const dr = clamp255(a?.r) - clamp255(b?.r);
    const dg = clamp255(a?.g) - clamp255(b?.g);
    const db = clamp255(a?.b) - clamp255(b?.b);
    return Math.sqrt((dr * dr) + (dg * dg) + (db * db));
  };
  const WIZ_DISTINCT_COLOR_ANCHORS = Object.freeze([
    Object.freeze({ r: 255, g: 40,  b: 50  }), // red
    Object.freeze({ r: 30,  g: 220, b: 255 }), // cyan
    Object.freeze({ r: 150, g: 70,  b: 255 }), // violet
    Object.freeze({ r: 75,  g: 255, b: 90  }), // green
    Object.freeze({ r: 255, g: 175, b: 30  }), // amber
    Object.freeze({ r: 255, g: 80,  b: 190 })  // magenta
  ]);
  const normalizeWizDistinctPalette = (colors = [], targetLength = 3) => {
    const src = Array.isArray(colors) ? colors : [];
    const required = Math.max(1, Math.min(6, Math.round(Number(targetLength) || 3)));
    const minRgbDistance = 104;
    const minHueDistance = 56;
    const minSatDistance = 0.08;
    const minValueDistance = 0.1;
    const out = [];

    const tryAdd = color => {
      const candidate = {
        r: clamp255(color?.r),
        g: clamp255(color?.g),
        b: clamp255(color?.b)
      };
      const candidateHsv = rgbToHsv(candidate);
      if (out.length === 0) {
        out.push(candidate);
        return;
      }
      for (const existing of out) {
        const existingHsv = rgbToHsv(existing);
        const hueDelta = hueDistanceDeg(candidateHsv.h, existingHsv.h);
        const satDelta = Math.abs(candidateHsv.s - existingHsv.s);
        const valueDelta = Math.abs(candidateHsv.v - existingHsv.v);
        const rgbDelta = rgbDistance(candidate, existing);
        const brightnessOnlyVariant =
          hueDelta < 20 &&
          satDelta < minSatDistance &&
          valueDelta >= minValueDistance;
        const tooCloseHueCluster =
          hueDelta < minHueDistance &&
          (rgbDelta < minRgbDistance || satDelta < minSatDistance);
        if (brightnessOnlyVariant || tooCloseHueCluster) return;
      }
      out.push(candidate);
    };

    for (const color of src) {
      tryAdd(color);
      if (out.length >= required) break;
    }
    for (const anchor of WIZ_DISTINCT_COLOR_ANCHORS) {
      tryAdd(anchor);
      if (out.length >= required) break;
    }
    while (out.length < required) {
      out.push({ ...WIZ_DISTINCT_COLOR_ANCHORS[out.length % WIZ_DISTINCT_COLOR_ANCHORS.length] });
    }
    return out.slice(0, required);
  };
  const normalizeWizContrastPalette = (colors = [], options = {}) => {
    const src = Array.isArray(colors) ? colors : [];
    const targetLength = Math.max(1, Math.min(6, Math.round(Number(options.targetLength) || src.length || 3)));
    const minSaturation = clamp(Number(options.minSaturation) || 0.9, 0.75, 1);
    const minValue = clamp(Number(options.minValue) || 0.3, 0.12, 0.9);
    const maxValue = clamp(Number(options.maxValue) || 0.98, minValue, 1);
    const valueSwing = clamp(Number(options.valueSwing) || 0.2, 0, 0.36);
    const boosted = [];

    for (let i = 0; i < src.length; i += 1) {
      const color = src[i];
      const hsv = rgbToHsv(color);
      const sat = Math.max(hsv.s, minSaturation);
      const phase = (i % 2 === 0) ? 1 : -1;
      const valBase = Math.max(hsv.v, minValue);
      const val = clamp(valBase + (phase * valueSwing * 0.5), minValue, maxValue);
      boosted.push(hsvToRgb255(hsv.h, sat, val));
    }

    return normalizeWizDistinctPalette(
      boosted.length ? boosted : src,
      targetLength
    );
  };
  const reorderPaletteForContrast = (colors = [], preserveFirst = true) => {
    const src = Array.isArray(colors)
      ? colors.map(color => ({
        r: clamp255(color?.r),
        g: clamp255(color?.g),
        b: clamp255(color?.b)
      }))
      : [];
    if (src.length <= 2) return src;

    const out = [];
    const used = new Set();
    let currentIndex = preserveFirst ? 0 : 0;
    while (out.length < src.length) {
      out.push(src[currentIndex]);
      used.add(currentIndex);
      if (out.length >= src.length) break;

      const current = src[currentIndex];
      const currentHsv = rgbToHsv(current);
      let nextIndex = -1;
      let nextScore = -1;
      for (let i = 0; i < src.length; i += 1) {
        if (used.has(i)) continue;
        const candidate = src[i];
        const candidateHsv = rgbToHsv(candidate);
        const score =
          (hueDistanceDeg(currentHsv.h, candidateHsv.h) * 2.4) +
          (rgbDistance(current, candidate) * 0.34) +
          (Math.abs(currentHsv.s - candidateHsv.s) * 42) +
          (Math.abs(currentHsv.v - candidateHsv.v) * 36);
        if (score > nextScore) {
          nextScore = score;
          nextIndex = i;
        }
      }
      currentIndex = nextIndex >= 0 ? nextIndex : src.findIndex((_, idx) => !used.has(idx));
      if (currentIndex < 0) break;
    }
    return out.length ? out : src;
  };
  const tuneWizManualPalette = (colors = [], options = {}) => {
    const src = Array.isArray(colors) ? colors : [];
    const pulseScene = options?.pulseScene === true;
    if (!src.length) return [];
    const tuned = [];
    for (let i = 0; i < src.length; i += 1) {
      const hsv = rgbToHsv(src[i]);
      const satFloor = pulseScene ? 0.95 : 0.92;
      const valueFloor = pulseScene ? 0.44 : 0.3;
      const phase = (i % 2 === 0) ? 1 : -1;
      const valueSwing = pulseScene ? 0.11 : 0.09;
      tuned.push(hsvToRgb255(
        hsv.h,
        Math.max(hsv.s, satFloor),
        clamp(Math.max(hsv.v, valueFloor) + (phase * valueSwing), valueFloor, 1)
      ));
    }
    return tuned;
  };
  const enforceMinSaturation = (color = {}, minSat = 0.88, minValue = 0.2) => {
    const hsv = rgbToHsv(color);
    return hsvToRgb255(
      hsv.h,
      Math.max(hsv.s, clamp(Number(minSat) || 0, 0, 1)),
      Math.max(hsv.v, clamp(Number(minValue) || 0, 0, 1))
    );
  };
  const boostColorSaturation = (color, amount = 0) => {
    const r = clamp255(color?.r);
    const g = clamp255(color?.g);
    const b = clamp255(color?.b);
    const boost = clamp(Number(amount) || 0, 0, 1);
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
    const boosted = {
      r: clamp255(max - ((max - r) * gain)),
      g: clamp255(max - ((max - g) * gain)),
      b: clamp255(max - ((max - b) * gain))
    };
    if (boost <= 0.5) return boosted;

    const vivid = clamp((boost - 0.5) / 0.5, 0, 1);
    const luma =
      boosted.r * 0.2126 +
      boosted.g * 0.7152 +
      boosted.b * 0.0722;
    const chromaGain = 1 + (vivid * 1.28);
    const valueGain = 1 + (vivid * 0.24);

    return {
      r: clamp255((luma + ((boosted.r - luma) * chromaGain)) * valueGain),
      g: clamp255((luma + ((boosted.g - luma) * chromaGain)) * valueGain),
      b: clamp255((luma + ((boosted.b - luma) * chromaGain)) * valueGain)
    };
  };
  const tunePaletteVibrancy = (color = {}, options = {}) => {
    const base = {
      r: clamp255(color?.r),
      g: clamp255(color?.g),
      b: clamp255(color?.b)
    };
    const baseHsv = rgbToHsv(base);
    const preserveNeutralBelow = clamp(Number(options.preserveNeutralBelow) || 0, 0, 0.3);
    if (baseHsv.s <= preserveNeutralBelow) {
      return base;
    }
    const satBoost = clamp(Number(options.satBoost) || 0, 0, 1);
    const minSat = clamp(Number(options.minSat) || 0, 0, 1);
    const minValue = clamp(Number(options.minValue) || 0, 0, 1);
    const maxValue = clamp(Number(options.maxValue) || 1, minValue, 1);
    const boosted = boostColorSaturation(base, satBoost);
    const hsv = rgbToHsv(boosted);
    return hsvToRgb255(
      hsv.h,
      Math.max(hsv.s, minSat),
      clamp(Math.max(hsv.v, minValue), minValue, maxValue)
    );
  };
  const tunePaletteArrayVibrancy = (palette = [], options = {}) => {
    const src = Array.isArray(palette) ? palette : [];
    const softEvery = Math.max(0, Math.round(Number(options.softEvery) || 0));
    return src.map((color, index) => {
      const softTone = softEvery > 0 && ((index + 1) % softEvery === 0);
      return tunePaletteVibrancy(color, {
        satBoost: softTone ? options.softSatBoost : options.satBoost,
        minSat: softTone ? options.softMinSat : options.minSat,
        minValue: softTone ? options.softMinValue : options.minValue,
        maxValue: options.maxValue,
        preserveNeutralBelow: options.preserveNeutralBelow
      });
    });
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
      behaviorConfirmMs: 460,
      behaviorMinHoldMs: 1200,
      sceneConfirmMs: 560,
      sceneMinHoldMs: 1700,
      hysteresis: 0.034,
      idleThresholdBias: -0.012,
      flowThresholdBias: -0.055,
      pulseFloorBias: -0.09,
      quietGuardScale: 0.8,
      heavyPromoteScale: 0.82,
      motionGateBias: -0.08,
      demoteDriveBias: -0.08,
      forcePulseFluxBias: -0.04,
      forcePulseEnergyBias: -0.03
    },
    balanced: {
      behaviorConfirmMs: 760,
      behaviorMinHoldMs: 2100,
      sceneConfirmMs: 1180,
      sceneMinHoldMs: 3300,
      hysteresis: 0.072,
      idleThresholdBias: 0,
      flowThresholdBias: 0,
      pulseFloorBias: 0,
      quietGuardScale: 1,
      heavyPromoteScale: 1,
      motionGateBias: 0,
      demoteDriveBias: 0,
      forcePulseFluxBias: 0,
      forcePulseEnergyBias: 0
    },
    cinematic: {
      behaviorConfirmMs: 2200,
      behaviorMinHoldMs: 6200,
      sceneConfirmMs: 3400,
      sceneMinHoldMs: 8800,
      hysteresis: 0.124,
      idleThresholdBias: 0.014,
      flowThresholdBias: 0.085,
      pulseFloorBias: 0.12,
      quietGuardScale: 1.2,
      heavyPromoteScale: 1.24,
      motionGateBias: 0.1,
      demoteDriveBias: 0.08,
      forcePulseFluxBias: 0.08,
      forcePulseEnergyBias: 0.07
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
        audioGain: 1.28,
        bandLow: 1.24,
        bandMid: 1.26,
        bandHigh: 1.34,
        flux: 1.48,
        intensityFlux: 1.52,
        intensityHigh: 1.36,
        beatBaseClamp: 0.8,
        beatBaseInterpret: 0.78,
        beatTransientLower: 1.45,
        beatFluxLower: 1.55,
        beatLowerCap: 1.42,
        beatRiseBase: 0.78,
        beatRiseTransient: 1.34,
        beatRiseFlux: 1.4,
        beatRiseMin: 0.8,
        beatRiseMax: 1.08,
        forcePulseFlux: 0.68,
        forcePulseEnergy: 0.7,
        buildTrend: 0.74,
        buildEnergy: 0.74,
        dropSlopeBase: 0.7,
        dropTransient: 0.86,
        dropFlux: 0.88,
        dropEnergyBase: 0.76,
        dropEnergyPad: 0.72,
        dropEnergyTransient: 1.28,
        recoverTrend: 0.78,
        recoverEnergy: 0.78,
        forceFlowLowFlux: 0.74
      }
    },
    precision: {
      multipliers: {
        audioGain: 0.82,
        bandLow: 0.8,
        bandMid: 0.82,
        bandHigh: 0.74,
        flux: 0.62,
        intensityFlux: 0.65,
        intensityHigh: 0.72,
        beatBaseClamp: 1.24,
        beatBaseInterpret: 1.22,
        beatTransientLower: 0.72,
        beatFluxLower: 0.62,
        beatLowerCap: 0.74,
        beatRiseBase: 1.32,
        beatRiseTransient: 0.74,
        beatRiseFlux: 0.68,
        beatRiseMin: 1.32,
        beatRiseMax: 1.34,
        forcePulseFlux: 1.48,
        forcePulseEnergy: 1.44,
        buildTrend: 1.36,
        buildEnergy: 1.26,
        dropSlopeBase: 1.36,
        dropTransient: 0.72,
        dropFlux: 0.66,
        dropEnergyBase: 1.3,
        dropEnergyPad: 1.34,
        dropEnergyTransient: 0.66,
        recoverTrend: 1.34,
        recoverEnergy: 1.24,
        forceFlowLowFlux: 1.28
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
  const CALM_SILENCE_THRESHOLD = 0.2;
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
    audioSourceLevel: 0,
    audioRms: 0,
    energy: 0,
    beat: false,
    beatConfidence: 0,
    beatIntervalMs: 0,
    bpm: 0,
    brightnessTier: "silent",
    brightnessPercent: 0.05,
    brightnessSourceLevel: 0,
    hueBrightnessOut: 0,
    wizBrightnessOut: 0,
    onsetTempoBpm: 0,
    onsetTempoConfidence: 0,
    beatHintBpm: 0,
    phase: 0,
    behavior: "idle",
    scene: "idle_soft",
    sceneAgeMs: 0,
    genre: "auto",
    paletteFamilies: "blue",
    paletteColorsPerFamily: 3,
    paletteDisorder: false,
    paletteDisorderAggression: 0.35,
    paletteCycleMode: "on_trigger",
    paletteTimedIntervalSec: 5,
    paletteBeatLock: false,
    paletteBeatLockGraceSec: 2,
    paletteReactiveMargin: 28,
    paletteSpectrumMapMode: "auto",
    paletteSpectrumFeatureMap: ["lows", "mids", "highs", "rms", "flux"],
    mode: "interpret",
    modeLock: "interpret",
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
    metaAutoIntentHz: 2,
    metaAutoAppliedHz: 2,
    metaAutoRangeLowPct: 0,
    metaAutoRangeHighPct: 0,
    metaAutoDominantTracker: "baseline",
    metaAutoDominantSwitches: 0,
    metaAutoTempoBaselineBlend: true,
    metaAutoTempoTrackersAuto: false,
    metaAutoTempoTrackers: {
      baseline: true,
      peaks: false,
      transients: false,
      flux: false
    },
    metaAutoTempoTrackersActive: {
      baseline: true,
      peaks: false,
      transients: false,
      flux: false
    },
    metaAutoOverclock: 0,
    overclockAutoEnabled: false,
    overclockAutoReason: "off",
    overclockAutoHz: 2,
    overclockAutoOverclock: DEFAULT_OVERCLOCK_LEVEL,
    transportPressure: 0,
    transportPressureRaw: 0,
    transportPressureAt: 0,
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
  let audioRms = 0;
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
      audioRms = audio;
      audioPeak = audio;
      audioTransient = 0;
      audioZcr = 0;
    } else if (v && typeof v === "object") {
      audio = clamp(v.level ?? v.rms ?? 0, 0, 1);
      audioRms = clamp(v.rms ?? audio, 0, 1);
      audioPeak = clamp(v.peak ?? audio, 0, 1.5);
      audioTransient = clamp(v.transient ?? 0, 0, 1.2);
      audioZcr = clamp(v.zcr ?? 0, 0, 1);
      audioBandLow = clamp(v.bandLow ?? 0, 0, 1);
      audioBandMid = clamp(v.bandMid ?? 0, 0, 1);
      audioBandHigh = clamp(v.bandHigh ?? 0, 0, 1);
      audioFlux = clamp(v.spectralFlux ?? 0, 0, 1);
    } else {
      audio = 0;
      audioRms = 0;
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
      audio < 0.052 &&
      audioPeak < 0.1 &&
      audioTransient < 0.055 &&
      audioFlux < 0.05 &&
      audioZcr < 0.26 &&
      audioBandLow < 0.24 &&
      audioBandMid < 0.24 &&
      audioBandHigh < 0.24;

    if (nearSilence) {
      audio = 0;
      audioRms = 0;
      audioPeak = 0;
      audioTransient = 0;
      audioZcr = 0;
      audioBandLow = 0;
      audioBandMid = 0;
      audioBandHigh = 0;
      audioFlux = 0;
    }

    telemetry.rms = audio;
    telemetry.audioSourceLevel = audio;
    telemetry.audioRms = audioRms;
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
      beatGapScale: 0.47,
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
      beatGapScale: 0.45,
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
      "20s": { title: "I Love You", artist: "Fontaines D.C.", bpm: 114, detectBpm: 114 }
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
    if (normalizedGenre === "auto") {
      return DEFAULT_GENRE_DECADE;
    }
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

  function getGenreAudioProfile() {
    return effectiveGenreAudioProfile;
  }

  function setAudioReactivityPreset(name) {
    if (!AUDIO_REACTIVITY_PRESETS[name]) return false;
    audioReactivityPreset = name;
    rebuildGenreAudioProfile();
    return true;
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
  const BEHAVIOR_SCENE_DEFAULTS = Object.freeze({
    idle: "idle_soft",
    flow: "flow_wash",
    pulse: "pulse_strobe"
  });
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
      { r: 255, g: 50,  b: 70  },
      { r: 150, g: 70,  b: 255 }
    ],
    hiphop: [
      { r: 255, g: 170, b: 45  },
      { r: 60,  g: 205, b: 255 },
      { r: 200, g: 70,  b: 220 }
    ],
    metal: [
      { r: 255, g: 30,  b: 30  },
      { r: 66,  g: 172, b: 255 },
      { r: 255, g: 180, b: 30  }
    ],
    ambient: [
      { r: 70,  g: 180, b: 245 },
      { r: 130, g: 90,  b: 220 },
      { r: 90,  g: 240, b: 165 }
    ],
    house: [
      { r: 255, g: 120, b: 35  },
      { r: 55,  g: 205, b: 255 },
      { r: 255, g: 60,  b: 170 }
    ],
    trance: [
      { r: 70,  g: 230, b: 255 },
      { r: 190, g: 120, b: 255 },
      { r: 255, g: 70,  b: 180 }
    ],
    dnb: [
      { r: 255, g: 40,  b: 40  },
      { r: 60,  g: 205, b: 255 },
      { r: 255, g: 180, b: 35  }
    ],
    pop: [
      { r: 255, g: 120, b: 180 },
      { r: 80,  g: 235, b: 230 },
      { r: 255, g: 205, b: 70  }
    ],
    rock: [
      { r: 255, g: 60,  b: 45  },
      { r: 80,  g: 185, b: 255 },
      { r: 255, g: 180, b: 60  }
    ],
    rnb: [
      { r: 220, g: 90,  b: 165 },
      { r: 90,  g: 175, b: 255 },
      { r: 255, g: 170, b: 75  }
    ],
    media: [
      { r: 90,  g: 170, b: 245 },
      { r: 255, g: 175, b: 65  },
      { r: 170, g: 85,  b: 240 }
    ],
    techno: [
      { r: 60,  g: 255, b: 170 },
      { r: 65,  g: 170, b: 255 },
      { r: 255, g: 70,  b: 170 }
    ],
    auto: [
      { r: 255, g: 60,  b: 60  },
      { r: 60,  g: 205, b: 255 },
      { r: 170, g: 80,  b: 255 }
    ]
  };
  const SOFT_WIZ_SCENE_KEYS = Object.freeze(new Set([
    "idle_soft",
    "flow_ambient",
    "flow_sunset",
    "flow_glacier",
    "flow_media"
  ]));
  for (const [sceneKey, palette] of Object.entries(WIZ_PALETTES)) {
    const softScene = SOFT_WIZ_SCENE_KEYS.has(sceneKey);
    WIZ_PALETTES[sceneKey] = tunePaletteArrayVibrancy(palette, {
      satBoost: softScene ? 0.34 : 0.44,
      minSat: softScene ? 0.7 : 0.78,
      minValue: 0.24,
      maxValue: 1,
      softEvery: softScene ? 3 : 4,
      softSatBoost: 0.16,
      softMinSat: 0.58,
      softMinValue: 0.2,
      preserveNeutralBelow: 0.1
    });
  }
  for (const key of Object.keys(WIZ_PULSE_PALETTES)) {
    WIZ_PULSE_PALETTES[key] = tunePaletteArrayVibrancy(WIZ_PULSE_PALETTES[key], {
      satBoost: 0.52,
      minSat: 0.84,
      minValue: 0.28,
      maxValue: 1,
      softEvery: 0,
      preserveNeutralBelow: 0.08
    });
  }

  const MANUAL_PALETTE_COLOR_COUNT_OPTIONS = Object.freeze([1, 3, 5, 8, 12]);
  const MANUAL_PALETTE_FAMILY_DEFS = Object.freeze({
    red: Object.freeze({
      id: "red",
      label: "RED",
      description: "Red-centered spectrum that expands into pink/magenta/purple at higher color counts.",
      colors: Object.freeze([
        Object.freeze({ r: 110, g: 0, b: 10 }),
        Object.freeze({ r: 154, g: 0, b: 18 }),
        Object.freeze({ r: 196, g: 8, b: 24 }),
        Object.freeze({ r: 236, g: 22, b: 30 }),
        Object.freeze({ r: 255, g: 52, b: 42 }),
        Object.freeze({ r: 255, g: 84, b: 88 }),
        Object.freeze({ r: 255, g: 74, b: 132 }),
        Object.freeze({ r: 246, g: 58, b: 174 }),
        Object.freeze({ r: 220, g: 50, b: 214 }),
        Object.freeze({ r: 186, g: 56, b: 242 }),
        Object.freeze({ r: 150, g: 58, b: 252 }),
        Object.freeze({ r: 120, g: 46, b: 224 })
      ])
    }),
    green: Object.freeze({
      id: "green",
      label: "GREEN",
      description: "Green-centered spectrum that expands into lime/chartreuse and teal at higher color counts.",
      colors: Object.freeze([
        Object.freeze({ r: 6, g: 66, b: 10 }),
        Object.freeze({ r: 8, g: 106, b: 14 }),
        Object.freeze({ r: 14, g: 146, b: 22 }),
        Object.freeze({ r: 28, g: 186, b: 30 }),
        Object.freeze({ r: 56, g: 222, b: 42 }),
        Object.freeze({ r: 96, g: 242, b: 38 }),
        Object.freeze({ r: 142, g: 250, b: 30 }),
        Object.freeze({ r: 190, g: 248, b: 24 }),
        Object.freeze({ r: 136, g: 255, b: 86 }),
        Object.freeze({ r: 74, g: 252, b: 138 }),
        Object.freeze({ r: 30, g: 236, b: 186 }),
        Object.freeze({ r: 18, g: 214, b: 220 })
      ])
    }),
    blue: Object.freeze({
      id: "blue",
      label: "BLUE",
      description: "Blue-centered spectrum that expands into cyan/indigo/violet at higher color counts.",
      colors: Object.freeze([
        Object.freeze({ r: 6, g: 14, b: 106 }),
        Object.freeze({ r: 10, g: 36, b: 156 }),
        Object.freeze({ r: 18, g: 72, b: 206 }),
        Object.freeze({ r: 22, g: 114, b: 246 }),
        Object.freeze({ r: 16, g: 156, b: 255 }),
        Object.freeze({ r: 20, g: 198, b: 255 }),
        Object.freeze({ r: 86, g: 236, b: 255 }),
        Object.freeze({ r: 72, g: 126, b: 255 }),
        Object.freeze({ r: 96, g: 110, b: 255 }),
        Object.freeze({ r: 118, g: 98, b: 255 }),
        Object.freeze({ r: 140, g: 86, b: 255 }),
        Object.freeze({ r: 162, g: 76, b: 248 })
      ])
    })
  });
  const MANUAL_PALETTE_FAMILY_ALIASES = Object.freeze({
    magenta: "red",
    purple: "red",
    pink: "red",
    amber: "green",
    yellow: "green",
    lime: "green",
    cyan: "blue",
    aqua: "blue",
    teal: "blue"
  });
  const MANUAL_PALETTE_FAMILY_IDS = Object.freeze(Object.keys(MANUAL_PALETTE_FAMILY_DEFS));
  const MANUAL_PALETTE_CYCLE_MODE_ORDER = Object.freeze([
    "on_trigger",
    "timed_cycle",
    "reactive_shift",
    "spectrum_mapper"
  ]);
  const MANUAL_PALETTE_SPECTRUM_MAP_MODE_ORDER = Object.freeze(["auto", "manual"]);
  const MANUAL_PALETTE_AUDIO_FEATURE_KEYS = Object.freeze([
    "lows",
    "mids",
    "highs",
    "rms",
    "energy",
    "flux",
    "peaks",
    "transients",
    "beat"
  ]);
  const MANUAL_PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP = Object.freeze([
    "lows",
    "mids",
    "highs",
    "rms",
    "flux"
  ]);
  const MANUAL_PALETTE_TIMED_INTERVAL_MIN_SEC = 2;
  const MANUAL_PALETTE_TIMED_INTERVAL_MAX_SEC = 60;
  const MANUAL_PALETTE_BEAT_LOCK_GRACE_MIN_SEC = 0;
  const MANUAL_PALETTE_BEAT_LOCK_GRACE_MAX_SEC = 8;
  const MANUAL_PALETTE_REACTIVE_MARGIN_MIN = 5;
  const MANUAL_PALETTE_REACTIVE_MARGIN_MAX = 100;
  const DEFAULT_MANUAL_PALETTE_CONFIG = Object.freeze({
    colorsPerFamily: 3,
    families: Object.freeze(["red", "green", "blue"]),
    disorder: false,
    disorderAggression: 0.35,
    cycleMode: "on_trigger",
    timedIntervalSec: 5,
    beatLock: false,
    beatLockGraceSec: 2,
    reactiveMargin: 28,
    spectrumMapMode: "auto",
    spectrumFeatureMap: MANUAL_PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP
  });
  const MANUAL_PALETTE_SUPPORTED_BRANDS = Object.freeze(["hue", "wiz"]);

  function normalizeManualPaletteBrandKey(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return null;
    return MANUAL_PALETTE_SUPPORTED_BRANDS.includes(raw) ? raw : null;
  }

  function normalizeManualPaletteColorCount(value, fallback = DEFAULT_MANUAL_PALETTE_CONFIG.colorsPerFamily) {
    const parsed = Number(value);
    if (MANUAL_PALETTE_COLOR_COUNT_OPTIONS.includes(parsed)) return parsed;
    const fallbackParsed = Number(fallback);
    if (MANUAL_PALETTE_COLOR_COUNT_OPTIONS.includes(fallbackParsed)) return fallbackParsed;
    return DEFAULT_MANUAL_PALETTE_CONFIG.colorsPerFamily;
  }

  function normalizeManualPaletteDisorderAggression(value, fallback = DEFAULT_MANUAL_PALETTE_CONFIG.disorderAggression) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    const normalized = parsed > 1 ? (parsed / 100) : parsed;
    return clamp(normalized, 0, 1);
  }

  function normalizeManualPaletteCycleMode(value, fallback = DEFAULT_MANUAL_PALETTE_CONFIG.cycleMode) {
    const key = String(value || "").trim().toLowerCase();
    if (MANUAL_PALETTE_CYCLE_MODE_ORDER.includes(key)) return key;
    const fallbackKey = String(fallback || "").trim().toLowerCase();
    return MANUAL_PALETTE_CYCLE_MODE_ORDER.includes(fallbackKey)
      ? fallbackKey
      : DEFAULT_MANUAL_PALETTE_CONFIG.cycleMode;
  }

  function normalizeManualPaletteTimedIntervalSec(value, fallback = DEFAULT_MANUAL_PALETTE_CONFIG.timedIntervalSec) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return clamp(
        Math.round(parsed),
        MANUAL_PALETTE_TIMED_INTERVAL_MIN_SEC,
        MANUAL_PALETTE_TIMED_INTERVAL_MAX_SEC
      );
    }
    const fallbackNum = Number(fallback);
    if (Number.isFinite(fallbackNum)) {
      return clamp(
        Math.round(fallbackNum),
        MANUAL_PALETTE_TIMED_INTERVAL_MIN_SEC,
        MANUAL_PALETTE_TIMED_INTERVAL_MAX_SEC
      );
    }
    return DEFAULT_MANUAL_PALETTE_CONFIG.timedIntervalSec;
  }

  function normalizeManualPaletteBeatLockGraceSec(value, fallback = DEFAULT_MANUAL_PALETTE_CONFIG.beatLockGraceSec) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return clamp(
        Math.round(parsed),
        MANUAL_PALETTE_BEAT_LOCK_GRACE_MIN_SEC,
        MANUAL_PALETTE_BEAT_LOCK_GRACE_MAX_SEC
      );
    }
    const fallbackNum = Number(fallback);
    if (Number.isFinite(fallbackNum)) {
      return clamp(
        Math.round(fallbackNum),
        MANUAL_PALETTE_BEAT_LOCK_GRACE_MIN_SEC,
        MANUAL_PALETTE_BEAT_LOCK_GRACE_MAX_SEC
      );
    }
    return DEFAULT_MANUAL_PALETTE_CONFIG.beatLockGraceSec;
  }

  function normalizeManualPaletteReactiveMargin(value, fallback = DEFAULT_MANUAL_PALETTE_CONFIG.reactiveMargin) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return clamp(
        Math.round(parsed),
        MANUAL_PALETTE_REACTIVE_MARGIN_MIN,
        MANUAL_PALETTE_REACTIVE_MARGIN_MAX
      );
    }
    const fallbackNum = Number(fallback);
    if (Number.isFinite(fallbackNum)) {
      return clamp(
        Math.round(fallbackNum),
        MANUAL_PALETTE_REACTIVE_MARGIN_MIN,
        MANUAL_PALETTE_REACTIVE_MARGIN_MAX
      );
    }
    return DEFAULT_MANUAL_PALETTE_CONFIG.reactiveMargin;
  }

  function normalizeManualPaletteSpectrumMapMode(value, fallback = DEFAULT_MANUAL_PALETTE_CONFIG.spectrumMapMode) {
    const key = String(value || "").trim().toLowerCase();
    if (MANUAL_PALETTE_SPECTRUM_MAP_MODE_ORDER.includes(key)) return key;
    const fallbackKey = String(fallback || "").trim().toLowerCase();
    return MANUAL_PALETTE_SPECTRUM_MAP_MODE_ORDER.includes(fallbackKey)
      ? fallbackKey
      : DEFAULT_MANUAL_PALETTE_CONFIG.spectrumMapMode;
  }

  function normalizeManualPaletteAudioFeatureKey(value, fallback = MANUAL_PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP[0]) {
    const key = String(value || "").trim().toLowerCase();
    if (MANUAL_PALETTE_AUDIO_FEATURE_KEYS.includes(key)) return key;
    const fallbackKey = String(fallback || "").trim().toLowerCase();
    return MANUAL_PALETTE_AUDIO_FEATURE_KEYS.includes(fallbackKey)
      ? fallbackKey
      : MANUAL_PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP[0];
  }

  function normalizeManualPaletteSpectrumFeatureMap(value, fallback = MANUAL_PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP) {
    const list = Array.isArray(value)
      ? value
      : String(value || "")
        .split(",")
        .map(part => part.trim())
        .filter(Boolean);
    const fallbackList = Array.isArray(fallback) && fallback.length
      ? fallback
      : MANUAL_PALETTE_DEFAULT_SPECTRUM_FEATURE_MAP;
    const out = [];
    for (let i = 0; i < 5; i += 1) {
      const raw = Object.prototype.hasOwnProperty.call(list, i)
        ? list[i]
        : fallbackList[i % fallbackList.length];
      out.push(
        normalizeManualPaletteAudioFeatureKey(raw, fallbackList[i % fallbackList.length])
      );
    }
    return out;
  }

  function normalizeManualPaletteFamilies(rawFamilies, fallback = DEFAULT_MANUAL_PALETTE_CONFIG.families) {
    const list = Array.isArray(rawFamilies)
      ? rawFamilies
      : String(rawFamilies || "")
        .split(",")
        .map(part => part.trim())
        .filter(Boolean);
    const normalized = [];
    for (const item of list) {
      const key = String(item || "").trim().toLowerCase();
      const mapped = MANUAL_PALETTE_FAMILY_ALIASES[key] || key;
      if (!MANUAL_PALETTE_FAMILY_IDS.includes(mapped)) continue;
      if (normalized.includes(mapped)) continue;
      normalized.push(mapped);
    }
    if (normalized.length > 0) return normalized;
    return Array.isArray(fallback) && fallback.length
      ? normalizeManualPaletteFamilies(fallback, MANUAL_PALETTE_FAMILY_IDS)
      : ["red"];
  }

  function buildManualPaletteColorsForFamily(familyId, colorsPerFamily) {
    const family = MANUAL_PALETTE_FAMILY_DEFS[familyId];
    if (!family) return [];
    const colors = Array.isArray(family.colors) ? family.colors.slice() : [];
    if (!colors.length) return [];
    const targetCount = normalizeManualPaletteColorCount(colorsPerFamily, DEFAULT_MANUAL_PALETTE_CONFIG.colorsPerFamily);
    const pickEvenly = (pool, count) => {
      if (!Array.isArray(pool) || !pool.length || count <= 0) return [];
      if (count >= pool.length) return pool.slice();
      if (count === 1) return [pool[Math.floor((pool.length - 1) / 2)]];
      const out = [];
      const used = new Set();
      for (let i = 0; i < count; i += 1) {
        const pos = (i * (pool.length - 1)) / (count - 1);
        let idx = Math.round(pos);
        idx = clamp(idx, 0, pool.length - 1);
        while (used.has(idx) && idx < pool.length - 1) idx += 1;
        while (used.has(idx) && idx > 0) idx -= 1;
        if (used.has(idx)) continue;
        used.add(idx);
        out.push(pool[idx]);
      }
      return out.length ? out : pool.slice(0, count);
    };
    const corePalette = colors.slice(0, Math.min(5, colors.length));
    const picked = targetCount <= corePalette.length
      ? pickEvenly(corePalette, targetCount)
      : pickEvenly(colors, Math.min(targetCount, colors.length));
    const highDensity = targetCount >= 8;
    const mediumDensity = targetCount >= 5 && targetCount < 8;
    return tunePaletteArrayVibrancy(picked, {
      satBoost: highDensity ? 0.46 : (mediumDensity ? 0.4 : 0.34),
      minSat: highDensity ? 0.8 : (mediumDensity ? 0.76 : 0.72),
      minValue: 0.26,
      maxValue: 1,
      softEvery: highDensity ? 5 : (mediumDensity ? 4 : 0),
      softSatBoost: 0.14,
      softMinSat: 0.56,
      softMinValue: 0.22,
      preserveNeutralBelow: 0.08
    });
  }

  let manualPaletteColorsPerFamily = normalizeManualPaletteColorCount(
    process.env.RAVE_MANUAL_PALETTE_COLORS_PER_FAMILY,
    DEFAULT_MANUAL_PALETTE_CONFIG.colorsPerFamily
  );
  let manualPaletteFamilies = normalizeManualPaletteFamilies(
    process.env.RAVE_MANUAL_PALETTE_FAMILIES,
    DEFAULT_MANUAL_PALETTE_CONFIG.families
  );
  let manualPaletteDisorder = parseBool(
    process.env.RAVE_MANUAL_PALETTE_DISORDER,
    DEFAULT_MANUAL_PALETTE_CONFIG.disorder
  );
  let manualPaletteDisorderAggression = normalizeManualPaletteDisorderAggression(
    process.env.RAVE_MANUAL_PALETTE_DISORDER_AGGRESSION,
    DEFAULT_MANUAL_PALETTE_CONFIG.disorderAggression
  );
  let manualPaletteCycleMode = normalizeManualPaletteCycleMode(
    process.env.RAVE_MANUAL_PALETTE_CYCLE_MODE,
    DEFAULT_MANUAL_PALETTE_CONFIG.cycleMode
  );
  let manualPaletteTimedIntervalSec = normalizeManualPaletteTimedIntervalSec(
    process.env.RAVE_MANUAL_PALETTE_TIMED_INTERVAL_SEC,
    DEFAULT_MANUAL_PALETTE_CONFIG.timedIntervalSec
  );
  let manualPaletteBeatLock = parseBool(
    process.env.RAVE_MANUAL_PALETTE_BEAT_LOCK,
    DEFAULT_MANUAL_PALETTE_CONFIG.beatLock
  );
  let manualPaletteBeatLockGraceSec = normalizeManualPaletteBeatLockGraceSec(
    process.env.RAVE_MANUAL_PALETTE_BEAT_LOCK_GRACE_SEC,
    DEFAULT_MANUAL_PALETTE_CONFIG.beatLockGraceSec
  );
  let manualPaletteReactiveMargin = normalizeManualPaletteReactiveMargin(
    process.env.RAVE_MANUAL_PALETTE_REACTIVE_MARGIN,
    DEFAULT_MANUAL_PALETTE_CONFIG.reactiveMargin
  );
  let manualPaletteSpectrumMapMode = normalizeManualPaletteSpectrumMapMode(
    process.env.RAVE_MANUAL_PALETTE_SPECTRUM_MAP_MODE,
    DEFAULT_MANUAL_PALETTE_CONFIG.spectrumMapMode
  );
  let manualPaletteSpectrumFeatureMap = normalizeManualPaletteSpectrumFeatureMap(
    process.env.RAVE_MANUAL_PALETTE_SPECTRUM_FEATURE_MAP,
    DEFAULT_MANUAL_PALETTE_CONFIG.spectrumFeatureMap
  );
  const manualPaletteBrandOverrides = {
    hue: null,
    wiz: null
  };
  const MANUAL_PALETTE_SEQUENCE_CACHE_MAX = 96;
  const manualPaletteSequenceCache = new Map();

  function getManualPaletteCatalog() {
    return MANUAL_PALETTE_FAMILY_IDS.map(id => {
      const family = MANUAL_PALETTE_FAMILY_DEFS[id];
      return {
        id: family.id,
        label: family.label,
        description: family.description
      };
    });
  }

  function getManualPaletteGlobalConfig() {
    return {
      colorsPerFamily: manualPaletteColorsPerFamily,
      families: manualPaletteFamilies.slice(),
      disorder: Boolean(manualPaletteDisorder),
      disorderAggression: manualPaletteDisorderAggression,
      cycleMode: manualPaletteCycleMode,
      timedIntervalSec: manualPaletteTimedIntervalSec,
      beatLock: Boolean(manualPaletteBeatLock),
      beatLockGraceSec: manualPaletteBeatLockGraceSec,
      reactiveMargin: manualPaletteReactiveMargin,
      spectrumMapMode: manualPaletteSpectrumMapMode,
      spectrumFeatureMap: manualPaletteSpectrumFeatureMap.slice()
    };
  }

  function normalizeManualPaletteConfigSnapshot(source = {}, fallback = DEFAULT_MANUAL_PALETTE_CONFIG) {
    const raw = source && typeof source === "object" ? source : {};
    const safeFallback = fallback && typeof fallback === "object"
      ? fallback
      : DEFAULT_MANUAL_PALETTE_CONFIG;
    return {
      colorsPerFamily: normalizeManualPaletteColorCount(
        raw.colorsPerFamily,
        normalizeManualPaletteColorCount(safeFallback.colorsPerFamily, DEFAULT_MANUAL_PALETTE_CONFIG.colorsPerFamily)
      ),
      families: normalizeManualPaletteFamilies(
        raw.families,
        normalizeManualPaletteFamilies(safeFallback.families, DEFAULT_MANUAL_PALETTE_CONFIG.families)
      ),
      disorder: Object.prototype.hasOwnProperty.call(raw, "disorder")
        ? Boolean(raw.disorder)
        : Boolean(safeFallback.disorder),
      disorderAggression: normalizeManualPaletteDisorderAggression(
        raw.disorderAggression,
        normalizeManualPaletteDisorderAggression(safeFallback.disorderAggression, DEFAULT_MANUAL_PALETTE_CONFIG.disorderAggression)
      ),
      cycleMode: normalizeManualPaletteCycleMode(raw.cycleMode, safeFallback.cycleMode),
      timedIntervalSec: normalizeManualPaletteTimedIntervalSec(
        raw.timedIntervalSec,
        normalizeManualPaletteTimedIntervalSec(
          safeFallback.timedIntervalSec,
          DEFAULT_MANUAL_PALETTE_CONFIG.timedIntervalSec
        )
      ),
      beatLock: Object.prototype.hasOwnProperty.call(raw, "beatLock")
        ? parseBool(raw.beatLock, Boolean(safeFallback.beatLock))
        : Boolean(safeFallback.beatLock),
      beatLockGraceSec: normalizeManualPaletteBeatLockGraceSec(
        raw.beatLockGraceSec,
        normalizeManualPaletteBeatLockGraceSec(
          safeFallback.beatLockGraceSec,
          DEFAULT_MANUAL_PALETTE_CONFIG.beatLockGraceSec
        )
      ),
      reactiveMargin: normalizeManualPaletteReactiveMargin(
        raw.reactiveMargin,
        normalizeManualPaletteReactiveMargin(
          safeFallback.reactiveMargin,
          DEFAULT_MANUAL_PALETTE_CONFIG.reactiveMargin
        )
      ),
      spectrumMapMode: normalizeManualPaletteSpectrumMapMode(
        raw.spectrumMapMode,
        safeFallback.spectrumMapMode
      ),
      spectrumFeatureMap: normalizeManualPaletteSpectrumFeatureMap(
        raw.spectrumFeatureMap,
        normalizeManualPaletteSpectrumFeatureMap(
          safeFallback.spectrumFeatureMap,
          DEFAULT_MANUAL_PALETTE_CONFIG.spectrumFeatureMap
        )
      )
    };
  }

  function getManualPaletteConfigForBrand(brandKey) {
    const base = getManualPaletteGlobalConfig();
    const key = normalizeManualPaletteBrandKey(brandKey);
    if (!key) return normalizeManualPaletteConfigSnapshot(base, DEFAULT_MANUAL_PALETTE_CONFIG);
    const override = manualPaletteBrandOverrides[key];
    if (!override || typeof override !== "object") {
      return normalizeManualPaletteConfigSnapshot(base, DEFAULT_MANUAL_PALETTE_CONFIG);
    }
    return normalizeManualPaletteConfigSnapshot(override, base);
  }

  function getManualPaletteConfig(brandKey = null) {
    const key = normalizeManualPaletteBrandKey(brandKey);
    if (key) {
      const resolved = getManualPaletteConfigForBrand(key);
      return {
        ...resolved,
        brand: key,
        override: Boolean(manualPaletteBrandOverrides[key])
      };
    }

    const globalConfig = getManualPaletteGlobalConfig();
    const brands = {};
    for (const brand of MANUAL_PALETTE_SUPPORTED_BRANDS) {
      const override = manualPaletteBrandOverrides[brand];
      brands[brand] = override && typeof override === "object"
        ? normalizeManualPaletteConfigSnapshot(override, globalConfig)
        : null;
    }

    return {
      ...normalizeManualPaletteConfigSnapshot(globalConfig, DEFAULT_MANUAL_PALETTE_CONFIG),
      brands
    };
  }

  function applyManualPaletteTelemetry() {
    telemetry.paletteFamilies = manualPaletteFamilies.join(",");
    telemetry.paletteColorsPerFamily = manualPaletteColorsPerFamily;
    telemetry.paletteDisorder = Boolean(manualPaletteDisorder);
    telemetry.paletteDisorderAggression = manualPaletteDisorderAggression;
    telemetry.paletteCycleMode = manualPaletteCycleMode;
    telemetry.paletteTimedIntervalSec = manualPaletteTimedIntervalSec;
    telemetry.paletteBeatLock = Boolean(manualPaletteBeatLock);
    telemetry.paletteBeatLockGraceSec = manualPaletteBeatLockGraceSec;
    telemetry.paletteReactiveMargin = manualPaletteReactiveMargin;
    telemetry.paletteSpectrumMapMode = manualPaletteSpectrumMapMode;
    telemetry.paletteSpectrumFeatureMap = manualPaletteSpectrumFeatureMap.slice();
  }

  function setManualPaletteConfig(patch = {}) {
    const next = patch && typeof patch === "object" ? patch : {};
    const brandKey = normalizeManualPaletteBrandKey(next.brand);

    if (brandKey) {
      if (next.clearOverride === true || parseBool(next.clearOverride, false) === true) {
        manualPaletteBrandOverrides[brandKey] = null;
        applyManualPaletteTelemetry();
        return getManualPaletteConfig();
      }

      const base = getManualPaletteConfigForBrand(brandKey);
      const updated = { ...base };
      if (Object.prototype.hasOwnProperty.call(next, "colorsPerFamily")) {
        updated.colorsPerFamily = normalizeManualPaletteColorCount(
          next.colorsPerFamily,
          base.colorsPerFamily
        );
      }
      if (Object.prototype.hasOwnProperty.call(next, "families")) {
        updated.families = normalizeManualPaletteFamilies(
          next.families,
          base.families
        );
      }
      if (Object.prototype.hasOwnProperty.call(next, "disorder")) {
        updated.disorder = Boolean(next.disorder);
      }
      if (Object.prototype.hasOwnProperty.call(next, "disorderAggression")) {
        updated.disorderAggression = normalizeManualPaletteDisorderAggression(
          next.disorderAggression,
          base.disorderAggression
        );
      }
      if (Object.prototype.hasOwnProperty.call(next, "cycleMode")) {
        updated.cycleMode = normalizeManualPaletteCycleMode(next.cycleMode, base.cycleMode);
      }
      if (Object.prototype.hasOwnProperty.call(next, "timedIntervalSec")) {
        updated.timedIntervalSec = normalizeManualPaletteTimedIntervalSec(
          next.timedIntervalSec,
          base.timedIntervalSec
        );
      }
      if (Object.prototype.hasOwnProperty.call(next, "beatLock")) {
        updated.beatLock = parseBool(next.beatLock, Boolean(base.beatLock));
      }
      if (Object.prototype.hasOwnProperty.call(next, "beatLockGraceSec")) {
        updated.beatLockGraceSec = normalizeManualPaletteBeatLockGraceSec(
          next.beatLockGraceSec,
          base.beatLockGraceSec
        );
      }
      if (Object.prototype.hasOwnProperty.call(next, "reactiveMargin")) {
        updated.reactiveMargin = normalizeManualPaletteReactiveMargin(
          next.reactiveMargin,
          base.reactiveMargin
        );
      }
      if (Object.prototype.hasOwnProperty.call(next, "spectrumMapMode")) {
        updated.spectrumMapMode = normalizeManualPaletteSpectrumMapMode(
          next.spectrumMapMode,
          base.spectrumMapMode
        );
      }
      if (Object.prototype.hasOwnProperty.call(next, "spectrumFeatureMap")) {
        updated.spectrumFeatureMap = normalizeManualPaletteSpectrumFeatureMap(
          next.spectrumFeatureMap,
          base.spectrumFeatureMap
        );
      }
      manualPaletteBrandOverrides[brandKey] = normalizeManualPaletteConfigSnapshot(
        updated,
        base
      );
      applyManualPaletteTelemetry();
      return getManualPaletteConfig();
    }

    if (Object.prototype.hasOwnProperty.call(next, "colorsPerFamily")) {
      manualPaletteColorsPerFamily = normalizeManualPaletteColorCount(
        next.colorsPerFamily,
        manualPaletteColorsPerFamily
      );
    }
    if (Object.prototype.hasOwnProperty.call(next, "families")) {
      manualPaletteFamilies = normalizeManualPaletteFamilies(
        next.families,
        manualPaletteFamilies
      );
    }
    if (Object.prototype.hasOwnProperty.call(next, "disorder")) {
      manualPaletteDisorder = Boolean(next.disorder);
    }
    if (Object.prototype.hasOwnProperty.call(next, "disorderAggression")) {
      manualPaletteDisorderAggression = normalizeManualPaletteDisorderAggression(
        next.disorderAggression,
        manualPaletteDisorderAggression
      );
    }
    if (Object.prototype.hasOwnProperty.call(next, "cycleMode")) {
      manualPaletteCycleMode = normalizeManualPaletteCycleMode(
        next.cycleMode,
        manualPaletteCycleMode
      );
    }
    if (Object.prototype.hasOwnProperty.call(next, "timedIntervalSec")) {
      manualPaletteTimedIntervalSec = normalizeManualPaletteTimedIntervalSec(
        next.timedIntervalSec,
        manualPaletteTimedIntervalSec
      );
    }
    if (Object.prototype.hasOwnProperty.call(next, "beatLock")) {
      manualPaletteBeatLock = parseBool(next.beatLock, manualPaletteBeatLock);
    }
    if (Object.prototype.hasOwnProperty.call(next, "beatLockGraceSec")) {
      manualPaletteBeatLockGraceSec = normalizeManualPaletteBeatLockGraceSec(
        next.beatLockGraceSec,
        manualPaletteBeatLockGraceSec
      );
    }
    if (Object.prototype.hasOwnProperty.call(next, "reactiveMargin")) {
      manualPaletteReactiveMargin = normalizeManualPaletteReactiveMargin(
        next.reactiveMargin,
        manualPaletteReactiveMargin
      );
    }
    if (Object.prototype.hasOwnProperty.call(next, "spectrumMapMode")) {
      manualPaletteSpectrumMapMode = normalizeManualPaletteSpectrumMapMode(
        next.spectrumMapMode,
        manualPaletteSpectrumMapMode
      );
    }
    if (Object.prototype.hasOwnProperty.call(next, "spectrumFeatureMap")) {
      manualPaletteSpectrumFeatureMap = normalizeManualPaletteSpectrumFeatureMap(
        next.spectrumFeatureMap,
        manualPaletteSpectrumFeatureMap
      );
    }
    applyManualPaletteTelemetry();
    return getManualPaletteConfig();
  }

  function normalizeManualPaletteHueDeg(value) {
    const hue = Number(value);
    if (!Number.isFinite(hue)) return 0;
    return ((hue % 360) + 360) % 360;
  }

  function hueDistanceCircularDeg(a, b) {
    const aa = normalizeManualPaletteHueDeg(a);
    const bb = normalizeManualPaletteHueDeg(b);
    const delta = Math.abs(aa - bb);
    return delta > 180 ? (360 - delta) : delta;
  }

  function rotateManualPaletteColors(colors = [], shift = 0) {
    const list = Array.isArray(colors) ? colors.slice() : [];
    const len = list.length;
    if (len <= 1) return list;
    const offset = ((Math.round(Number(shift) || 0) % len) + len) % len;
    if (offset === 0) return list;
    return list.slice(offset).concat(list.slice(0, offset));
  }

  function buildManualPaletteFamilyVariants(colors = []) {
    const base = Array.isArray(colors) ? colors : [];
    if (!base.length) return [];
    const variants = [];
    const seen = new Set();
    const directions = [base.slice(), base.slice().reverse()];

    const pushVariant = candidate => {
      const normalized = candidate.map(color => ({
        r: clamp255(color?.r),
        g: clamp255(color?.g),
        b: clamp255(color?.b)
      }));
      const fingerprint = normalized
        .map(color => `${color.r},${color.g},${color.b}`)
        .join("|");
      if (!fingerprint || seen.has(fingerprint)) return;
      const hues = normalized.map(color => normalizeManualPaletteHueDeg(rgbToHsv(color).h));
      let internalScore = 0;
      for (let i = 0; i < hues.length - 1; i += 1) {
        internalScore += hueDistanceCircularDeg(hues[i], hues[i + 1]);
      }
      variants.push({
        colors: normalized,
        startHue: hues[0] || 0,
        endHue: hues[hues.length - 1] || 0,
        internalScore
      });
      seen.add(fingerprint);
    };

    for (const direction of directions) {
      for (let offset = 0; offset < direction.length; offset += 1) {
        pushVariant(rotateManualPaletteColors(direction, offset));
      }
    }

    if (!variants.length) {
      pushVariant(base);
    }
    return variants;
  }

  function orientManualPaletteFamiliesForOrderedFlow(familySegments = []) {
    const segments = Array.isArray(familySegments)
      ? familySegments.filter(segment => Array.isArray(segment) && segment.length > 0)
      : [];
    if (segments.length <= 1) {
      return segments.map(segment => segment.slice());
    }

    const candidateSets = segments.map(segment => buildManualPaletteFamilyVariants(segment));
    if (candidateSets.some(set => !Array.isArray(set) || !set.length)) {
      return segments.map(segment => segment.slice());
    }

    const transitionWeight = 6.8;
    const cycleClosureWeight = 7.2;
    let bestScore = Number.POSITIVE_INFINITY;
    let best = null;
    const chosen = new Array(candidateSets.length);

    const walk = (idx, score) => {
      if (idx >= candidateSets.length) {
        let total = score;
        if (candidateSets.length > 1) {
          const first = chosen[0];
          const last = chosen[chosen.length - 1];
          total += hueDistanceCircularDeg(last.endHue, first.startHue) * cycleClosureWeight;
        }
        if (total < bestScore) {
          bestScore = total;
          best = chosen.slice();
        }
        return;
      }

      for (const candidate of candidateSets[idx]) {
        let nextScore = score + candidate.internalScore;
        if (idx > 0) {
          const prev = chosen[idx - 1];
          nextScore += hueDistanceCircularDeg(prev.endHue, candidate.startHue) * transitionWeight;
        }
        if (nextScore >= bestScore) continue;
        chosen[idx] = candidate;
        walk(idx + 1, nextScore);
      }
    };

    walk(0, 0);
    if (!best || !best.length) {
      return segments.map(segment => segment.slice());
    }
    return best.map(item => item.colors.slice());
  }

  function buildActiveManualPaletteSequence(config = null) {
    const paletteConfig = normalizeManualPaletteConfigSnapshot(
      config && typeof config === "object" ? config : getManualPaletteGlobalConfig(),
      getManualPaletteGlobalConfig()
    );
    const cacheKey = [
      String(normalizeManualPaletteColorCount(
        paletteConfig.colorsPerFamily,
        DEFAULT_MANUAL_PALETTE_CONFIG.colorsPerFamily
      )),
      normalizeManualPaletteFamilies(
        paletteConfig.families,
        DEFAULT_MANUAL_PALETTE_CONFIG.families
      ).join(","),
      paletteConfig.disorder ? "1" : "0"
    ].join("|");
    if (manualPaletteSequenceCache.has(cacheKey)) {
      return manualPaletteSequenceCache.get(cacheKey).map(color => ({ ...color }));
    }

    const sequence = [];
    const selectedFamilies = normalizeManualPaletteFamilies(
      paletteConfig.families,
      DEFAULT_MANUAL_PALETTE_CONFIG.families
    );
    const familySegments = selectedFamilies
      .map(familyId => buildManualPaletteColorsForFamily(
        familyId,
        paletteConfig.colorsPerFamily
      ))
      .filter(segment => Array.isArray(segment) && segment.length > 0);
    const flowSegments = !paletteConfig.disorder && familySegments.length >= 2
      ? orientManualPaletteFamiliesForOrderedFlow(familySegments)
      : familySegments;

    for (const segment of flowSegments) {
      for (const color of segment) {
        sequence.push({
          r: clamp255(color.r),
          g: clamp255(color.g),
          b: clamp255(color.b)
        });
      }
    }
    if (!sequence.length) {
      const fallback = buildManualPaletteColorsForFamily("red", 3);
      for (const color of fallback) {
        sequence.push({
          r: clamp255(color.r),
          g: clamp255(color.g),
          b: clamp255(color.b)
        });
      }
    }
    manualPaletteSequenceCache.set(cacheKey, sequence.map(color => ({ ...color })));
    while (manualPaletteSequenceCache.size > MANUAL_PALETTE_SEQUENCE_CACHE_MAX) {
      const firstKey = manualPaletteSequenceCache.keys().next().value;
      manualPaletteSequenceCache.delete(firstKey);
    }
    return sequence;
  }

  function getManualPaletteGroupSize(config = null, length = 1) {
    const normalizedConfig = normalizeManualPaletteConfigSnapshot(
      config && typeof config === "object" ? config : getManualPaletteGlobalConfig(),
      getManualPaletteGlobalConfig()
    );
    const requestedSize = normalizeManualPaletteColorCount(
      normalizedConfig.colorsPerFamily,
      DEFAULT_MANUAL_PALETTE_CONFIG.colorsPerFamily
    );
    const len = Math.max(1, Number(length) || 1);
    return clamp(requestedSize, 1, len);
  }

  function normalizeManualPaletteGroupBase(index, length, groupSize) {
    const len = Math.max(1, Number(length) || 1);
    const size = clamp(Math.round(Number(groupSize) || 1), 1, len);
    const base = ((Number(index) || 0) % len + len) % len;
    const group = Math.floor(base / size);
    return clamp(group * size, 0, Math.max(0, len - 1));
  }

  function pickManualPaletteNextIndex(currentIndex, length, paletteConfig = null, options = {}) {
    const len = Math.max(1, Number(length) || 1);
    if (len <= 1) return 0;
    const base = ((Number(currentIndex) || 0) % len + len) % len;
    const config = normalizeManualPaletteConfigSnapshot(
      paletteConfig && typeof paletteConfig === "object" ? paletteConfig : getManualPaletteGlobalConfig(),
      getManualPaletteGlobalConfig()
    );
    const scope = String(options?.scope || "color").trim().toLowerCase();
    if (scope === "group") {
      const groupSize = getManualPaletteGroupSize(config, len);
      const groupCount = Math.max(1, Math.ceil(len / groupSize));
      if (groupCount <= 1) return 0;
      const currentGroup = clamp(Math.floor(base / groupSize), 0, groupCount - 1);
      const step = Boolean(options?.isDrop) && groupCount > 2 ? 2 : 1;
      const nextGroup = (currentGroup + step) % groupCount;
      return normalizeManualPaletteGroupBase(nextGroup * groupSize, len, groupSize);
    }
    if (!config.disorder) return (base + 1) % len;
    const isBeat = Boolean(options.isBeat);
    const isDrop = Boolean(options.isDrop);
    const aggression = clamp(config.disorderAggression, 0, 1);
    const chaosChance = clamp(
      0.2 + aggression * 0.62 + (isBeat ? 0.08 : 0) + (isDrop ? 0.1 : 0),
      0.12,
      0.98
    );
    if (Math.random() >= chaosChance) {
      return (base + 1) % len;
    }
    const maxJump = Math.max(1, Math.round(1 + aggression * (len - 1)));
    const jump = 1 + Math.floor(Math.random() * maxJump);
    const directionBias = clamp(0.52 + aggression * 0.2, 0.5, 0.82);
    const direction = Math.random() < directionBias ? 1 : -1;
    return ((base + (jump * direction)) % len + len) % len;
  }

  function getManualPaletteRuntimeFingerprint(config = null) {
    const normalized = normalizeManualPaletteConfigSnapshot(
      config && typeof config === "object" ? config : getManualPaletteGlobalConfig(),
      getManualPaletteGlobalConfig()
    );
    return [
      String(normalized.colorsPerFamily),
      normalizeManualPaletteFamilies(normalized.families, DEFAULT_MANUAL_PALETTE_CONFIG.families).join(","),
      normalized.disorder ? "1" : "0",
      String(Math.round(normalizeManualPaletteDisorderAggression(normalized.disorderAggression, 0.35) * 1000)),
      normalizeManualPaletteCycleMode(normalized.cycleMode, DEFAULT_MANUAL_PALETTE_CONFIG.cycleMode),
      String(normalizeManualPaletteTimedIntervalSec(normalized.timedIntervalSec, DEFAULT_MANUAL_PALETTE_CONFIG.timedIntervalSec)),
      normalized.beatLock ? "1" : "0",
      String(normalizeManualPaletteBeatLockGraceSec(normalized.beatLockGraceSec, DEFAULT_MANUAL_PALETTE_CONFIG.beatLockGraceSec)),
      String(normalizeManualPaletteReactiveMargin(normalized.reactiveMargin, DEFAULT_MANUAL_PALETTE_CONFIG.reactiveMargin)),
      normalizeManualPaletteSpectrumMapMode(normalized.spectrumMapMode, DEFAULT_MANUAL_PALETTE_CONFIG.spectrumMapMode),
      normalizeManualPaletteSpectrumFeatureMap(normalized.spectrumFeatureMap, DEFAULT_MANUAL_PALETTE_CONFIG.spectrumFeatureMap).join(",")
    ].join("|");
  }

  function getManualPaletteCycleState(brandKey) {
    const key = normalizeManualPaletteBrandKey(brandKey);
    if (!key) return null;
    const state = manualPaletteCycleStateByBrand[key];
    return state && typeof state === "object" ? state : null;
  }

  function normalizeManualPaletteSignalValue(value, min = 0, max = 1, fallback = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return clamp(n, min, max);
  }

  function buildManualPaletteCycleSignal(sceneName = "", isBeat = false, isDrop = false) {
    return {
      nowMs: Date.now(),
      bpm: normalizeManualPaletteSignalValue(telemetry.bpm, 0, 260, 0),
      energy: normalizeManualPaletteSignalValue(telemetry.energy, 0, 1, 0),
      rms: normalizeManualPaletteSignalValue(
        telemetry.audioSourceLevel ?? telemetry.rms,
        0,
        1,
        0
      ),
      lows: normalizeManualPaletteSignalValue(audioBandLow, 0, 1, 0),
      mids: normalizeManualPaletteSignalValue(audioBandMid, 0, 1, 0),
      highs: normalizeManualPaletteSignalValue(audioBandHigh, 0, 1, 0),
      flux: normalizeManualPaletteSignalValue(audioFlux, 0, 1, 0),
      peaks: normalizeManualPaletteSignalValue(audioPeak, 0, 1.5, 0) / 1.5,
      transients: normalizeManualPaletteSignalValue(audioTransient, 0, 1.2, 0) / 1.2,
      beat: normalizeManualPaletteSignalValue(
        telemetry.beatConfidence,
        0,
        1,
        (isBeat || isDrop) ? 0.62 : 0
      ),
      phrase: String(telemetry.phrase || "").trim().toLowerCase(),
      scene: String(sceneName || telemetry.scene || "").trim().toLowerCase()
    };
  }

  function getManualPaletteCycleSignalFeatureValue(signal = {}, feature = "rms") {
    const key = normalizeManualPaletteAudioFeatureKey(feature, "rms");
    if (key === "lows") return normalizeManualPaletteSignalValue(signal.lows, 0, 1, 0);
    if (key === "mids") return normalizeManualPaletteSignalValue(signal.mids, 0, 1, 0);
    if (key === "highs") return normalizeManualPaletteSignalValue(signal.highs, 0, 1, 0);
    if (key === "energy") return normalizeManualPaletteSignalValue(signal.energy, 0, 1, 0);
    if (key === "flux") return normalizeManualPaletteSignalValue(signal.flux, 0, 1, 0);
    if (key === "peaks") return normalizeManualPaletteSignalValue(signal.peaks, 0, 1, 0);
    if (key === "transients") return normalizeManualPaletteSignalValue(signal.transients, 0, 1, 0);
    if (key === "beat") return normalizeManualPaletteSignalValue(signal.beat, 0, 1, 0);
    return normalizeManualPaletteSignalValue(signal.rms, 0, 1, 0);
  }

  function resolveManualPaletteSpectrumFeatureMap(config = {}) {
    const mode = normalizeManualPaletteSpectrumMapMode(
      config.spectrumMapMode,
      DEFAULT_MANUAL_PALETTE_CONFIG.spectrumMapMode
    );
    if (mode === "manual") {
      return normalizeManualPaletteSpectrumFeatureMap(
        config.spectrumFeatureMap,
        DEFAULT_MANUAL_PALETTE_CONFIG.spectrumFeatureMap
      );
    }
    return DEFAULT_MANUAL_PALETTE_CONFIG.spectrumFeatureMap.slice();
  }

  function pickManualPaletteSpectrumIndex(length, config = {}, signal = {}, state = {}) {
    const len = Math.max(1, Number(length) || 1);
    if (len <= 1) return 0;
    const featureMap = resolveManualPaletteSpectrumFeatureMap(config);
    const values = [];
    for (let i = 0; i < len; i += 1) {
      const feature = featureMap[i % featureMap.length];
      values.push(getManualPaletteCycleSignalFeatureValue(signal, feature));
    }
    let bestIndex = 0;
    let bestValue = values[0] || 0;
    for (let i = 1; i < values.length; i += 1) {
      if (values[i] > bestValue) {
        bestValue = values[i];
        bestIndex = i;
      }
    }
    const rawPreviousIndex = Number(state.lastSpectrumIndex);
    const previousIndex = Number.isFinite(rawPreviousIndex)
      ? clamp(Math.round(rawPreviousIndex), 0, len - 1)
      : 0;
    const previousValue = values[previousIndex] || 0;
    if ((bestValue - previousValue) < 0.05) {
      return previousIndex;
    }
    return bestIndex;
  }

  function shouldAdvanceManualPaletteTimed(state = {}, config = {}, options = {}, signal = {}) {
    const nowMs = Number(signal.nowMs || Date.now());
    const intervalMs = normalizeManualPaletteTimedIntervalSec(
      config.timedIntervalSec,
      DEFAULT_MANUAL_PALETTE_CONFIG.timedIntervalSec
    ) * 1000;
    if (!(Number(state.lastAdvanceAt) > 0)) {
      state.lastAdvanceAt = nowMs;
      state.waitStartAt = 0;
      return false;
    }
    const dueAt = Number(state.lastAdvanceAt) + intervalMs;
    if (nowMs < dueAt) {
      state.waitStartAt = 0;
      return false;
    }
    const beatLock = parseBool(config.beatLock, false) === true;
    if (!beatLock) {
      state.waitStartAt = 0;
      state.lastAdvanceAt = nowMs;
      return true;
    }
    if (Boolean(options.isBeat) || Boolean(options.isDrop)) {
      state.waitStartAt = 0;
      state.lastAdvanceAt = nowMs;
      return true;
    }
    const graceMs = normalizeManualPaletteBeatLockGraceSec(
      config.beatLockGraceSec,
      DEFAULT_MANUAL_PALETTE_CONFIG.beatLockGraceSec
    ) * 1000;
    if (!(Number(state.waitStartAt) > 0)) {
      state.waitStartAt = dueAt;
    }
    if ((nowMs - Number(state.waitStartAt)) >= graceMs) {
      state.waitStartAt = 0;
      state.lastAdvanceAt = nowMs;
      return true;
    }
    return false;
  }

  function computeManualPaletteReactiveShiftScore(currentSignal = {}, previousSignal = {}, options = {}, reactiveMargin = DEFAULT_MANUAL_PALETTE_CONFIG.reactiveMargin) {
    const margin = normalizeManualPaletteReactiveMargin(
      reactiveMargin,
      DEFAULT_MANUAL_PALETTE_CONFIG.reactiveMargin
    );
    const marginNorm = clamp(
      (margin - MANUAL_PALETTE_REACTIVE_MARGIN_MIN) /
      Math.max(1, MANUAL_PALETTE_REACTIVE_MARGIN_MAX - MANUAL_PALETTE_REACTIVE_MARGIN_MIN),
      0,
      1
    );
    const sensitivityBoost = 1.62 - (marginNorm * 0.9);
    const bpmScale = Math.max(4, 6 + (margin * 0.34));
    const bpmDelta = Math.abs(Number(currentSignal.bpm || 0) - Number(previousSignal.bpm || 0)) / bpmScale;
    const energyDelta = Math.abs(Number(currentSignal.energy || 0) - Number(previousSignal.energy || 0));
    const fluxDelta = Math.abs(Number(currentSignal.flux || 0) - Number(previousSignal.flux || 0));
    const bandDelta = Math.max(
      Math.abs(Number(currentSignal.lows || 0) - Number(previousSignal.lows || 0)),
      Math.abs(Number(currentSignal.mids || 0) - Number(previousSignal.mids || 0)),
      Math.abs(Number(currentSignal.highs || 0) - Number(previousSignal.highs || 0))
    );
    const phraseShift = currentSignal.phrase && previousSignal.phrase && currentSignal.phrase !== previousSignal.phrase
      ? 0.86
      : 0;
    const sceneShift = currentSignal.scene && previousSignal.scene && currentSignal.scene !== previousSignal.scene
      ? 0.52
      : 0;
    const eventBoost = options.isDrop
      ? 0.66
      : (options.isBeat ? 0.24 : 0);
    const score = (
      (bpmDelta * 1.08) +
      (energyDelta * 1.8 * sensitivityBoost) +
      (fluxDelta * 1.45 * sensitivityBoost) +
      (bandDelta * 1.24 * sensitivityBoost) +
      phraseShift +
      sceneShift +
      eventBoost
    );
    const threshold = 1.04 + (marginNorm * 0.84);
    return { score, threshold };
  }

  function shouldAdvanceManualPaletteReactive(state = {}, config = {}, options = {}, signal = {}) {
    const nowMs = Number(signal.nowMs || Date.now());
    const previousSignal = state.lastSignal && typeof state.lastSignal === "object"
      ? state.lastSignal
      : null;
    state.lastSignal = {
      bpm: normalizeManualPaletteSignalValue(signal.bpm, 0, 260, 0),
      energy: normalizeManualPaletteSignalValue(signal.energy, 0, 1, 0),
      lows: normalizeManualPaletteSignalValue(signal.lows, 0, 1, 0),
      mids: normalizeManualPaletteSignalValue(signal.mids, 0, 1, 0),
      highs: normalizeManualPaletteSignalValue(signal.highs, 0, 1, 0),
      flux: normalizeManualPaletteSignalValue(signal.flux, 0, 1, 0),
      phrase: String(signal.phrase || "").trim().toLowerCase(),
      scene: String(signal.scene || "").trim().toLowerCase()
    };
    if (!previousSignal) {
      state.lastAdvanceAt = nowMs;
      return false;
    }
    const margin = normalizeManualPaletteReactiveMargin(
      config.reactiveMargin,
      DEFAULT_MANUAL_PALETTE_CONFIG.reactiveMargin
    );
    const cooldownMs = 260 + Math.round(margin * 7.2);
    if ((nowMs - Number(state.lastAdvanceAt || 0)) < cooldownMs) {
      return false;
    }
    const scored = computeManualPaletteReactiveShiftScore(signal, previousSignal, options, margin);
    if (scored.score >= scored.threshold) {
      state.lastAdvanceAt = nowMs;
      return true;
    }
    return false;
  }

  function resolveManualPaletteIndexForEmit(brandKey, currentIndex, length, paletteConfig = null, options = {}) {
    const len = Math.max(1, Number(length) || 1);
    const baseIndex = ((Number(currentIndex) || 0) % len + len) % len;
    if (len <= 1) {
      return { emitIndex: 0, index: 0, advanced: false };
    }
    const state = getManualPaletteCycleState(brandKey);
    if (!state) {
      return { emitIndex: baseIndex, index: baseIndex, advanced: false };
    }
    const config = normalizeManualPaletteConfigSnapshot(
      paletteConfig && typeof paletteConfig === "object" ? paletteConfig : getManualPaletteConfigForBrand(brandKey),
      getManualPaletteConfigForBrand(brandKey)
    );
    const groupSize = getManualPaletteGroupSize(config, len);
    const groupCount = Math.max(1, Math.ceil(len / groupSize));
    const signal = buildManualPaletteCycleSignal(options.sceneName, options.isBeat, options.isDrop);
    const fingerprint = getManualPaletteRuntimeFingerprint(config);
    if (state.fingerprint !== fingerprint || Number(state.length) !== len) {
      state.index = normalizeManualPaletteGroupBase(baseIndex, len, groupSize);
      state.colorOffset = 0;
      state.length = len;
      state.fingerprint = fingerprint;
      state.lastAdvanceAt = signal.nowMs;
      state.waitStartAt = 0;
      state.lastSignal = null;
      state.lastSpectrumIndex = clamp(Math.floor(state.index / groupSize), 0, Math.max(0, groupCount - 1));
    }
    let index = normalizeManualPaletteGroupBase(state.index, len, groupSize);
    const mode = normalizeManualPaletteCycleMode(config.cycleMode, DEFAULT_MANUAL_PALETTE_CONFIG.cycleMode);
    const orderedOffsetStep = Boolean(options.isDrop) && groupSize > 2 ? 2 : 1;
    const applyGroupColorOffset = () => {
      const groupSpan = Math.max(1, Math.min(groupSize, len - index));
      let offset = clamp(Math.round(Number(state.colorOffset) || 0), 0, Math.max(0, groupSpan - 1));
      if (groupSpan > 1) {
        if (config.disorder) {
          const aggression = clamp(config.disorderAggression, 0, 1);
          const randomChance = clamp(
            0.22 + aggression * 0.56 + (options.isBeat ? 0.08 : 0) + (options.isDrop ? 0.14 : 0),
            0.12,
            0.98
          );
          if (Math.random() < randomChance) {
            offset = Math.floor(Math.random() * groupSpan);
          }
        } else {
          offset = (offset + orderedOffsetStep) % groupSpan;
        }
      } else {
        offset = 0;
      }
      state.colorOffset = offset;
      return normalizeManualPaletteGroupBase(index, len, groupSize) + offset;
    };

    if (mode === "spectrum_mapper") {
      const groupIndex = pickManualPaletteSpectrumIndex(groupCount, config, signal, state);
      index = normalizeManualPaletteGroupBase(groupIndex * groupSize, len, groupSize);
      state.index = index;
      state.lastSpectrumIndex = clamp(groupIndex, 0, Math.max(0, groupCount - 1));
      state.lastAdvanceAt = signal.nowMs;
      const emitIndex = applyGroupColorOffset();
      return {
        emitIndex,
        index,
        advanced: index !== normalizeManualPaletteGroupBase(baseIndex, len, groupSize)
      };
    }

    if (mode === "timed_cycle") {
      const shouldAdvance = shouldAdvanceManualPaletteTimed(state, config, options, signal);
      if (shouldAdvance) {
        const steps = clamp(Math.round(Number(options.advanceStep) || 1), 1, 4);
        for (let i = 0; i < steps; i += 1) {
          index = pickManualPaletteNextIndex(index, len, config, { ...options, scope: "group" });
        }
        state.index = index;
      }
      const emitIndex = applyGroupColorOffset();
      return {
        emitIndex,
        index,
        advanced: shouldAdvance
      };
    }

    if (mode === "reactive_shift") {
      const shouldAdvance = shouldAdvanceManualPaletteReactive(state, config, options, signal);
      if (shouldAdvance) {
        const steps = clamp(Math.round(Number(options.advanceStep) || 1), 1, 4);
        for (let i = 0; i < steps; i += 1) {
          index = pickManualPaletteNextIndex(index, len, config, { ...options, scope: "group" });
        }
        state.index = index;
        state.lastSpectrumIndex = clamp(Math.floor(index / groupSize), 0, Math.max(0, groupCount - 1));
      }
      const emitIndex = applyGroupColorOffset();
      return {
        emitIndex,
        index,
        advanced: shouldAdvance
      };
    }

    // on_trigger: advance palette group on trigger events while still moving within active group.
    let advanced = false;
    const triggerHint = Boolean(options.triggerHint);
    if (triggerHint) {
      const steps = clamp(Math.round(Number(options.advanceStep) || 1), 1, 4);
      for (let i = 0; i < steps; i += 1) {
        index = pickManualPaletteNextIndex(index, len, config, { ...options, scope: "group" });
      }
      state.index = index;
      state.lastAdvanceAt = signal.nowMs;
      state.lastSpectrumIndex = clamp(Math.floor(index / groupSize), 0, Math.max(0, groupCount - 1));
      advanced = true;
    }
    const emitIndex = applyGroupColorOffset();
    return {
      emitIndex,
      index,
      advanced
    };
  }

  applyManualPaletteTelemetry();

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
    evalMs: 60,
    confirmMs: 70,
    holdMs: 110,
    fastConfirmMs: 20,
    fastHoldMs: 40
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
  const META_AUTO_TEMPO_TRACKER_KEYS = Object.freeze([
    "baseline",
    "peaks",
    "transients",
    "flux"
  ]);
  const META_AUTO_TEMPO_TRACKER_AUTO_TIMING = {
    holdMs: 180,
    fastHoldMs: 72
  };
  const META_AUTO_TEMPO_TRACKER_DOMINANCE = Object.freeze({
    winnerFloor: 0.42,
    winnerGap: 0.048,
    decisiveWinnerFloor: 0.52,
    decisiveGap: 0.08,
    supportGap: 0.042
  });
  const TRANSPORT_PRESSURE_MAX = 2.4;
  const TRANSPORT_PRESSURE_DECAY_MS = 900;
  const META_AUTO_DOMINANT_TRACKER_LOCK = Object.freeze({
    minHoldMs: 260,
    maxHoldMs: 900,
    overtakeGap: 0.18,
    instantGap: 0.3,
    overtakeGapFast: 0.13,
    instantGapFast: 0.24
  });
  const META_AUTO_DYNAMIC_RANGE = Object.freeze({
    lowRiseAlpha: 0.1,
    lowFallAlpha: 0.22,
    highRiseAlpha: 0.2,
    highFallAlpha: 0.1
  });
  const META_AUTO_APPLIED_HZ_SLEW = Object.freeze({
    baseUp: 1.25,
    baseDown: 1.08,
    fastUpBoost: 1.8,
    quietDownBoost: 1.3
  });

  function sanitizeMetaAutoTempoTrackers(input = {}, fallback = {}) {
    const raw = input && typeof input === "object" ? input : {};
    const safeFallback = fallback && typeof fallback === "object" ? fallback : {};
    const out = {};
    for (const key of META_AUTO_TEMPO_TRACKER_KEYS) {
      out[key] = parseBool(raw[key], parseBool(safeFallback[key], false));
    }
    return out;
  }

  function cloneMetaAutoTempoTrackers(trackers = {}, fallback = {}) {
    return sanitizeMetaAutoTempoTrackers(trackers, fallback);
  }

  function getPrimaryMetaAutoTempoTracker(trackers = {}) {
    const safe = sanitizeMetaAutoTempoTrackers(trackers, {});
    for (const key of META_AUTO_TEMPO_TRACKER_KEYS) {
      if (safe[key] === true) return key;
    }
    return null;
  }

  function sameMetaAutoTempoTrackers(a, b) {
    if (!a || !b) return false;
    for (const key of META_AUTO_TEMPO_TRACKER_KEYS) {
      if (Boolean(a[key]) !== Boolean(b[key])) return false;
    }
    return true;
  }

  function seedMetaAutoTempoTrackerAutoScores(trackers = {}) {
    const safe = sanitizeMetaAutoTempoTrackers(trackers, {});
    return {
      baseline: safe.baseline ? 0.72 : 0.28,
      peaks: safe.peaks ? 0.68 : 0.22,
      transients: safe.transients ? 0.68 : 0.22,
      flux: safe.flux ? 0.68 : 0.22
    };
  }

  let metaAutoEnabled = process.env.RAVE_META_AUTO_DEFAULT === "1";
  let metaAutoTempoTrackers = sanitizeMetaAutoTempoTrackers({
    baseline: parseBool(process.env.RAVE_META_AUTO_BASELINE_TEMPO_BLEND, true),
    peaks: parseBool(process.env.RAVE_META_AUTO_PEAKS_TEMPO_TRACKER, false),
    transients: parseBool(process.env.RAVE_META_AUTO_TRANSIENTS_TEMPO_TRACKER, false),
    flux: parseBool(process.env.RAVE_META_AUTO_FLUX_TEMPO_TRACKER, false)
  });
  let metaAutoTempoTrackersAuto = parseBool(process.env.RAVE_META_AUTO_TEMPO_TRACKERS_AUTO, false);
  let metaAutoTempoTrackerAutoScores = seedMetaAutoTempoTrackerAutoScores(metaAutoTempoTrackers);
  let metaAutoTempoTrackerAutoStable = cloneMetaAutoTempoTrackers(metaAutoTempoTrackers, metaAutoTempoTrackers);
  let metaAutoTempoTrackerAutoCandidate = cloneMetaAutoTempoTrackers(metaAutoTempoTrackers, metaAutoTempoTrackers);
  let metaAutoTempoTrackerAutoCandidateSince = 0;
  let metaAutoTempoDominantLockKey = getPrimaryMetaAutoTempoTracker(metaAutoTempoTrackers);
  let metaAutoTempoDominantLockSince = 0;
  let metaAutoTempoDominantLockScore = 0;
  let metaAutoTempoBaselineBlend = metaAutoTempoTrackers.baseline === true;
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
  let metaAutoIntentHz = 2;
  let metaAutoAppliedHz = 2;
  let metaAutoRangeLowAnchor = 0.2;
  let metaAutoRangeHighAnchor = 0.82;
  let metaAutoRangeSamples = 0;
  let metaAutoRangeLowHits = 0;
  let metaAutoRangeHighHits = 0;
  let metaAutoDominantSwitches = 0;
  let metaAutoLastDominantTracker = "baseline";
  let metaAutoDriveEma = 0;
  let metaAutoMotionEma = 0;
  let metaAutoIntensityEma = 0;
  let metaAutoDrivePeak = 0;
  let metaAutoMotionPeak = 0;
  let metaAutoIntensityPeak = 0;
  let metaAutoHeavySince = 0;
  let metaAutoTempoBpmEma = 0;
  let metaAutoRangeStallSince = 0;
  let metaAutoRangeStallAnchorHz = 0;
  let metaAutoRangeStallAnchorTempo = 0;
  let metaAutoRangeStallAnchorDrive = 0;
  let metaAutoRangeStallAnchorMotion = 0;
  let transportPressureEma = 0;
  let transportPressureRaw = 0;
  let transportPressureUpdatedAt = 0;
  let overclockAutoLastEvalAt = 0;
  let overclockAutoLastAppliedAt = 0;
  let overclockAutoCandidateSince = 0;
  let overclockAutoCandidate = null;

  const META_AUTO_HZ_BY_LEVEL = [2, 4, 6, 8, 10, 12, 14, 16, 20, 30, 40, 50, 60];
  const META_AUTO_HZ_MIN = META_AUTO_HZ_BY_LEVEL[0] || 2;
  const META_AUTO_HZ_MAX = 16;
  const META_AUTO_HZ_LEVEL_MAX = (() => {
    let maxLevel = 0;
    for (let i = 0; i < META_AUTO_HZ_BY_LEVEL.length; i++) {
      if (META_AUTO_HZ_BY_LEVEL[i] <= META_AUTO_HZ_MAX) {
        maxLevel = i;
      } else {
        break;
      }
    }
    return maxLevel;
  })();
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
  metaAutoIntentHz = metaAutoLastTargetHz;
  metaAutoAppliedHz = metaAutoLastTargetHz;

  telemetry.metaAutoEnabled = metaAutoEnabled;
  telemetry.metaAutoReason = metaAutoEnabled ? "armed" : "off";
  telemetry.metaAutoProfile = autoProfile;
  telemetry.metaAutoGenre = metaAutoGenreStable;
  telemetry.metaAutoReactivity = audioReactivityPreset;
  telemetry.metaAutoHz = META_AUTO_HZ_BY_LEVEL[DEFAULT_OVERCLOCK_LEVEL] || 2;
  telemetry.metaAutoIntentHz = telemetry.metaAutoHz;
  telemetry.metaAutoAppliedHz = telemetry.metaAutoHz;
  telemetry.metaAutoRangeLowPct = 0;
  telemetry.metaAutoRangeHighPct = 0;
  telemetry.metaAutoDominantTracker = getPrimaryMetaAutoTempoTracker(metaAutoTempoTrackers) || "baseline";
  telemetry.metaAutoDominantSwitches = 0;
  telemetry.metaAutoTempoBaselineBlend = metaAutoTempoBaselineBlend;
  telemetry.metaAutoTempoTrackersAuto = metaAutoTempoTrackersAuto;
  telemetry.metaAutoTempoTrackers = { ...metaAutoTempoTrackers };
  telemetry.metaAutoTempoTrackersActive = { ...metaAutoTempoTrackers };
  telemetry.metaAutoOverclock = 0;
  telemetry.overclockAutoEnabled = overclockAutoEnabled;
  telemetry.overclockAutoReason = overclockAutoEnabled ? "armed" : "off";
  telemetry.overclockAutoHz = META_AUTO_HZ_BY_LEVEL[DEFAULT_OVERCLOCK_LEVEL] || 2;
  telemetry.overclockAutoOverclock = DEFAULT_OVERCLOCK_LEVEL;

  function resetMetaAutoTempoTrackerAutoState(seedTrackers = metaAutoTempoTrackers) {
    const safeSeed = cloneMetaAutoTempoTrackers(seedTrackers, metaAutoTempoTrackers);
    metaAutoTempoTrackerAutoScores = seedMetaAutoTempoTrackerAutoScores(safeSeed);
    metaAutoTempoTrackerAutoStable = cloneMetaAutoTempoTrackers(safeSeed, safeSeed);
    metaAutoTempoTrackerAutoCandidate = cloneMetaAutoTempoTrackers(safeSeed, safeSeed);
    metaAutoTempoTrackerAutoCandidateSince = 0;
    metaAutoTempoDominantLockKey = getPrimaryMetaAutoTempoTracker(safeSeed);
    metaAutoTempoDominantLockSince = 0;
    metaAutoTempoDominantLockScore = 0;
    metaAutoLastDominantTracker = metaAutoTempoDominantLockKey || "none";
    telemetry.metaAutoDominantTracker = metaAutoLastDominantTracker;
  }

  function setMetaAutoTempoTrackersActiveTelemetry(trackers = metaAutoTempoTrackers) {
    const safe = sanitizeMetaAutoTempoTrackers(trackers, metaAutoTempoTrackers);
    telemetry.metaAutoTempoBaselineBlend = metaAutoTempoBaselineBlend;
    telemetry.metaAutoTempoTrackersAuto = metaAutoTempoTrackersAuto === true;
    telemetry.metaAutoTempoTrackers = { ...metaAutoTempoTrackers };
    telemetry.metaAutoTempoTrackersActive = { ...safe };
    telemetry.metaAutoDominantTracker = getPrimaryMetaAutoTempoTracker(safe) || "none";
  }

  function scoreMetaAutoTempoTrackersAuto(context = {}) {
    const driveSignal = clamp(Number(context.driveSignal || 0), 0, 1);
    const motionSignal = clamp(Number(context.motionSignal || 0), 0, 1);
    const intensity = clamp(Number(context.intensity || 0), 0, 1.4);
    const beat = clamp(Number(context.beat || 0), 0, 1);
    const baselineTempoDrive = clamp(Number(context.baselineTempoDrive || 0), 0, 1);
    const drumsDrive = clamp(Number(context.drumsDrive || 0), 0, 1);
    const audioPeak = clamp(Number(context.audioPeak || 0), 0, 1.5);
    const audioTransient = clamp(Number(context.audioTransient || 0), 0, 1.2);
    const audioFlux = clamp(Number(context.audioFlux || 0), 0, 1);
    const silenceFactor = clamp(Number(context.silenceFactor || 0), 0, 1);
    const sustainedCalm = Boolean(context.sustainedCalm);
    const drop = Boolean(context.drop);
    const build = Boolean(context.build);
    const aggressiveGenre = Boolean(context.aggressiveGenre);
    const metaGenre = String(context.metaGenre || "");
    const tier = clamp(Number(context.tier || 0), 0, 4);
    const calmness = clamp((0.34 - motionSignal) / 0.34, 0, 1);
    const fastGenre = metaGenre === "techno" || metaGenre === "dnb" || metaGenre === "edm" || metaGenre === "trance";

    let baselineScore = clamp(
      0.48 +
      (baselineTempoDrive * 0.2) +
      (drumsDrive * 0.28) +
      (beat * 0.1) +
      (sustainedCalm ? 0.18 : 0) -
      (audioTransient * 0.1) -
      (audioFlux * 0.09) -
      (silenceFactor * 0.1),
      0,
      1
    );
    let peaksScore = clamp(
      (audioPeak * 0.56) +
      (driveSignal * 0.16) +
      (intensity * 0.08) +
      (drop ? 0.24 : 0) +
      (aggressiveGenre ? 0.1 : 0) -
      (calmness * 0.28),
      0,
      1
    );
    let transientsScore = clamp(
      (audioTransient * 0.66) +
      (beat * 0.2) +
      (motionSignal * 0.12) +
      (drop ? 0.2 : 0) +
      (aggressiveGenre ? 0.12 : 0) -
      (calmness * 0.3),
      0,
      1
    );
    let fluxScore = clamp(
      (audioFlux * 0.66) +
      (motionSignal * 0.2) +
      (beat * 0.1) +
      (build ? 0.16 : 0) +
      (fastGenre ? 0.12 : 0) -
      (calmness * 0.26),
      0,
      1
    );

    if (tier >= 3) {
      peaksScore = Math.max(peaksScore, 0.48);
      transientsScore = Math.max(transientsScore, 0.58);
      fluxScore = Math.max(fluxScore, 0.56);
    }
    if (drop) {
      peaksScore = Math.max(peaksScore, 0.66);
      transientsScore = Math.max(transientsScore, 0.68);
    }
    if (sustainedCalm || silenceFactor > 0.6) {
      baselineScore = Math.max(baselineScore, 0.64);
      peaksScore *= 0.58;
      transientsScore *= 0.52;
      fluxScore *= 0.55;
    }

    return {
      baseline: clamp(baselineScore, 0, 1),
      peaks: clamp(peaksScore, 0, 1),
      transients: clamp(transientsScore, 0, 1),
      flux: clamp(fluxScore, 0, 1)
    };
  }

  function resolveMetaAutoTempoTrackersForPlan(now, context = {}) {
    const manual = sanitizeMetaAutoTempoTrackers(metaAutoTempoTrackers, metaAutoTempoTrackers);
    if (!metaAutoEnabled || metaAutoTempoTrackersAuto !== true) {
      metaAutoTempoDominantLockKey = getPrimaryMetaAutoTempoTracker(manual);
      metaAutoTempoDominantLockSince = now;
      metaAutoTempoDominantLockScore = 0;
      metaAutoLastDominantTracker = metaAutoTempoDominantLockKey || "none";
      telemetry.metaAutoDominantTracker = metaAutoLastDominantTracker;
      setMetaAutoTempoTrackersActiveTelemetry(manual);
      return manual;
    }
    const tempoConfidence = clamp(Number(context.tempoConfidence || 0), 0, 1);
    const effectiveTempoBpm = clamp(
      Number(context.effectiveTempoBpm || context.smoothTempoBpm || 0),
      0,
      260
    );
    const hardQuietWindow =
      Number(context.audioTransient || 0) <= 0.06 &&
      Number(context.audioFlux || 0) <= 0.055 &&
      Number(context.audioPeak || 0) <= 0.14 &&
      Number(context.beat || 0) <= 0.12 &&
      Number(context.driveSignal || 0) <= 0.16 &&
      Number(context.motionSignal || 0) <= 0.18 &&
      Number(context.silenceFactor || 0) >= 0.55 &&
      tempoConfidence <= 0.22 &&
      effectiveTempoBpm <= 90 &&
      Boolean(context.sustainedCalm);
    if (hardQuietWindow) {
      const quietTrackers = {
        baseline: manual.baseline === true,
        peaks: false,
        transients: false,
        flux: false
      };
      if (!quietTrackers.baseline) {
        if (manual.peaks === true) quietTrackers.peaks = true;
        else if (manual.transients === true) quietTrackers.transients = true;
        else if (manual.flux === true) quietTrackers.flux = true;
      }
      metaAutoTempoTrackerAutoScores = {
        baseline: clamp(lerp(Number(metaAutoTempoTrackerAutoScores.baseline || 0.64), 0.72, 0.5), 0, 1),
        peaks: clamp(lerp(Number(metaAutoTempoTrackerAutoScores.peaks || 0.2), 0.18, 0.6), 0, 1),
        transients: clamp(lerp(Number(metaAutoTempoTrackerAutoScores.transients || 0.2), 0.18, 0.6), 0, 1),
        flux: clamp(lerp(Number(metaAutoTempoTrackerAutoScores.flux || 0.2), 0.18, 0.6), 0, 1)
      };
      metaAutoTempoTrackerAutoStable = cloneMetaAutoTempoTrackers(quietTrackers, quietTrackers);
      metaAutoTempoTrackerAutoCandidate = cloneMetaAutoTempoTrackers(quietTrackers, quietTrackers);
      metaAutoTempoTrackerAutoCandidateSince = now;
      metaAutoTempoDominantLockKey = getPrimaryMetaAutoTempoTracker(quietTrackers);
      metaAutoTempoDominantLockSince = now;
      metaAutoTempoDominantLockScore = 0;
      metaAutoLastDominantTracker = metaAutoTempoDominantLockKey || "none";
      telemetry.metaAutoDominantTracker = metaAutoLastDominantTracker;
      setMetaAutoTempoTrackersActiveTelemetry(metaAutoTempoTrackerAutoStable);
      return cloneMetaAutoTempoTrackers(metaAutoTempoTrackerAutoStable, quietTrackers);
    }

    const scored = scoreMetaAutoTempoTrackersAuto(context);
    const ema = {};
    for (const key of META_AUTO_TEMPO_TRACKER_KEYS) {
      const prev = clamp(Number(metaAutoTempoTrackerAutoScores[key] || 0), 0, 1);
      const target = clamp(Number(scored[key] || 0), 0, 1);
      const alpha = target >= prev ? 0.84 : 0.7;
      ema[key] = clamp(lerp(prev, target, alpha), 0, 1);
    }
    metaAutoTempoTrackerAutoScores = ema;

    const stable = cloneMetaAutoTempoTrackers(
      metaAutoTempoTrackerAutoStable,
      metaAutoTempoTrackers
    );
    const trackerAllowed = {
      baseline: manual.baseline === true,
      peaks: manual.peaks === true,
      transients: manual.transients === true,
      flux: manual.flux === true
    };
    const anyTrackerAllowed = (
      trackerAllowed.baseline ||
      trackerAllowed.peaks ||
      trackerAllowed.transients ||
      trackerAllowed.flux
    );
    if (!anyTrackerAllowed) {
      const none = { baseline: false, peaks: false, transients: false, flux: false };
      metaAutoTempoTrackerAutoStable = cloneMetaAutoTempoTrackers(none, none);
      metaAutoTempoTrackerAutoCandidate = cloneMetaAutoTempoTrackers(none, none);
      metaAutoTempoTrackerAutoCandidateSince = now;
      metaAutoTempoDominantLockKey = null;
      metaAutoTempoDominantLockSince = 0;
      metaAutoTempoDominantLockScore = 0;
      metaAutoLastDominantTracker = "none";
      telemetry.metaAutoDominantTracker = "none";
      setMetaAutoTempoTrackersActiveTelemetry(none);
      return none;
    }
    const candidate = {
      baseline: false,
      peaks: false,
      transients: false,
      flux: false
    };
    const allowedKeys = META_AUTO_TEMPO_TRACKER_KEYS.filter(key => trackerAllowed[key]);
    const rankedTrackers = allowedKeys
      .map(key => ({ key, score: clamp(Number(ema[key] || 0), 0, 1) }))
      .sort((a, b) => b.score - a.score);
    const topTracker = rankedTrackers[0] || { key: "baseline", score: 0 };
    const secondTracker = rankedTrackers[1] || { key: "baseline", score: 0 };
    const thirdTracker = rankedTrackers[2] || { key: "baseline", score: 0 };
    const topGap = Math.max(0, topTracker.score - secondTracker.score);
    const secondGap = Math.max(0, secondTracker.score - thirdTracker.score);
    const lockSignal = clamp(
      (Number(context.motionSignal || 0) * 0.34) +
      (tempoConfidence * 0.3) +
      (Number(context.beat || 0) * 0.2) +
      (clamp(Number(context.intensity || 0), 0, 1.4) * 0.12),
      0,
      1
    );
    const lockHoldMs = Math.round(lerp(
      META_AUTO_DOMINANT_TRACKER_LOCK.maxHoldMs,
      META_AUTO_DOMINANT_TRACKER_LOCK.minHoldMs,
      lockSignal
    ));
    const lockKeyAllowed = (
      metaAutoTempoDominantLockKey &&
      trackerAllowed[metaAutoTempoDominantLockKey] === true
    );
    const lockAgeMs = metaAutoTempoDominantLockSince > 0
      ? (now - metaAutoTempoDominantLockSince)
      : Number.POSITIVE_INFINITY;
    const lockScore = lockKeyAllowed
      ? clamp(Number(ema[metaAutoTempoDominantLockKey] || 0), 0, 1)
      : 0;
    const lockOvertakeGap = (
      context.drop || context.build
    )
      ? META_AUTO_DOMINANT_TRACKER_LOCK.overtakeGapFast
      : META_AUTO_DOMINANT_TRACKER_LOCK.overtakeGap;
    const lockInstantGap = (
      context.drop || context.build
    )
      ? META_AUTO_DOMINANT_TRACKER_LOCK.instantGapFast
      : META_AUTO_DOMINANT_TRACKER_LOCK.instantGap;
    const keepDominantLock = (
      lockKeyAllowed &&
      lockAgeMs < lockHoldMs &&
      lockScore >= 0.3 &&
      (
        topTracker.key === metaAutoTempoDominantLockKey ||
        (
          topTracker.key !== metaAutoTempoDominantLockKey &&
          (topTracker.score - lockScore) < lockOvertakeGap &&
          topTracker.score < (lockScore + lockInstantGap)
        )
      )
    );
    const dominantSwitchDecisive = (
      topTracker.key &&
      topTracker.key !== metaAutoTempoDominantLockKey &&
      (
        (topGap >= lockInstantGap && topTracker.score >= 0.56) ||
        topTracker.score >= (lockScore + lockInstantGap)
      )
    );
    const dominantSwitchReady = (
      !lockKeyAllowed ||
      topTracker.key === metaAutoTempoDominantLockKey ||
      lockAgeMs >= lockHoldMs ||
      dominantSwitchDecisive
    );
    const stablePrimary = META_AUTO_TEMPO_TRACKER_KEYS.find(key => stable[key]) || null;
    const stablePrimaryScore = stablePrimary ? clamp(Number(ema[stablePrimary] || 0), 0, 1) : 0;
    const dominanceGate = META_AUTO_TEMPO_TRACKER_DOMINANCE;
    const surgeTrackerWindow =
      context.drop ||
      context.build ||
      Number(context.tier || 0) >= 3;
    const calmResetWindow =
      Boolean(context.sustainedCalm) ||
      (
        Number(context.silenceFactor || 0) >= 0.62 &&
        Number(context.driveSignal || 0) <= 0.2 &&
        Number(context.motionSignal || 0) <= 0.22 &&
        Number(context.beat || 0) <= 0.24 &&
        tempoConfidence <= 0.24
      );
    const rawQuietWindow =
      Number(context.audioTransient || 0) <= 0.06 &&
      Number(context.audioFlux || 0) <= 0.055 &&
      Number(context.audioPeak || 0) <= 0.14 &&
      Number(context.beat || 0) <= 0.16 &&
      Number(context.driveSignal || 0) <= 0.18 &&
      Number(context.motionSignal || 0) <= 0.2 &&
      Number(context.silenceFactor || 0) >= 0.52 &&
      tempoConfidence <= 0.2 &&
      effectiveTempoBpm <= 92;
    const lowTrackerEvidence =
      ema.peaks <= 0.34 &&
      ema.transients <= 0.34 &&
      ema.flux <= 0.34;
    const lowTrackerEvidenceInCalm =
      lowTrackerEvidence &&
      (
        calmResetWindow ||
        rawQuietWindow ||
        Number(context.silenceFactor || 0) >= 0.56
      );
    if (calmResetWindow || rawQuietWindow || lowTrackerEvidenceInCalm) {
      if (trackerAllowed.baseline && (ema.baseline >= 0.34 || Number(context.silenceFactor || 0) >= 0.42)) {
        candidate.baseline = true;
      } else if (topTracker.key && trackerAllowed[topTracker.key]) {
        candidate[topTracker.key] = true;
      }
    }

    if (context.sustainedCalm) {
      candidate.baseline = trackerAllowed.baseline === true;
      candidate.peaks = false;
      candidate.transients = false;
      candidate.flux = false;
    }
    // Dominance selection: choose strongest live factor, add secondary only when close.
    if (!(calmResetWindow || rawQuietWindow || lowTrackerEvidenceInCalm || context.sustainedCalm)) {
      if (topTracker.key && trackerAllowed[topTracker.key]) {
        candidate[topTracker.key] = topTracker.score >= (surgeTrackerWindow ? 0.36 : dominanceGate.winnerFloor);
      }
      const closePairGap = surgeTrackerWindow ? 0.1 : dominanceGate.supportGap;
      const secondaryFloor = surgeTrackerWindow ? 0.5 : 0.54;
      if (
        secondTracker.key &&
        trackerAllowed[secondTracker.key] &&
        secondTracker.score >= secondaryFloor &&
        topGap <= closePairGap
      ) {
        candidate[secondTracker.key] = true;
      }
      const allowThird =
        surgeTrackerWindow &&
        thirdTracker.key &&
        trackerAllowed[thirdTracker.key] &&
        thirdTracker.score >= 0.62 &&
        topGap <= 0.08 &&
        secondGap <= 0.05;
      if (allowThird) candidate[thirdTracker.key] = true;

      // Baseline joins only when it is dominant-ish or close support.
      if (trackerAllowed.baseline && !candidate.baseline) {
        const baselineSupport =
          ema.baseline >= 0.6 &&
          (topTracker.key === "baseline" || (topTracker.score - ema.baseline) <= 0.04) &&
          Number(context.silenceFactor || 0) < 0.38;
        if (baselineSupport) candidate.baseline = true;
      }
    }
    const dominanceLiveWindow = !(calmResetWindow || rawQuietWindow || lowTrackerEvidenceInCalm || context.sustainedCalm);
    const dominanceAmbiguous = (
      dominanceLiveWindow &&
      topTracker.score < 0.68 &&
      topGap < 0.05 &&
      secondTracker.score >= 0.46
    );
    const preferStableCandidate = (
      dominanceAmbiguous &&
      stablePrimary &&
      trackerAllowed[stablePrimary] === true &&
      stablePrimaryScore >= (topTracker.score - 0.07)
    );
    if (keepDominantLock && trackerAllowed[metaAutoTempoDominantLockKey]) {
      candidate.baseline = false;
      candidate.peaks = false;
      candidate.transients = false;
      candidate.flux = false;
      candidate[metaAutoTempoDominantLockKey] = true;
      if (
        metaAutoTempoDominantLockKey !== "baseline" &&
        trackerAllowed.baseline === true &&
        Number(context.silenceFactor || 0) < 0.28 &&
        ema.baseline >= (lockScore - 0.015)
      ) {
        candidate.baseline = true;
      }
    }
    if (preferStableCandidate) {
      candidate.baseline = false;
      candidate.peaks = false;
      candidate.transients = false;
      candidate.flux = false;
      candidate[stablePrimary] = true;
      if (
        stablePrimary !== "baseline" &&
        trackerAllowed.baseline === true &&
        Number(context.silenceFactor || 0) < 0.3 &&
        ema.baseline >= (stablePrimaryScore - 0.015)
      ) {
        candidate.baseline = true;
      }
    }
    if (dominanceLiveWindow && topTracker.key) {
      const strictGap = Math.max(0, topTracker.score - secondTracker.score);
      const strictWinner = topTracker.key;
      const shouldForceWinner =
        context.drop ||
        context.build ||
        (
          !preferStableCandidate &&
          (
            topTracker.score >= dominanceGate.winnerFloor ||
            strictGap >= dominanceGate.winnerGap ||
            Number(context.motionSignal || 0) >= 0.46 ||
            Number(context.audioTransient || 0) >= 0.4 ||
            Number(context.audioFlux || 0) >= 0.38 ||
            Number(context.audioPeak || 0) >= 0.58
          )
        );
      if (shouldForceWinner) {
        candidate.baseline = false;
        candidate.peaks = false;
        candidate.transients = false;
        candidate.flux = false;
        if (trackerAllowed[strictWinner]) {
          candidate[strictWinner] = true;
        }
        if (
          strictWinner !== "baseline" &&
          trackerAllowed.baseline &&
          !context.drop &&
          !context.build &&
          Number(context.silenceFactor || 0) < 0.32 &&
          ema.baseline >= 0.72 &&
          ema.baseline >= (topTracker.score - 0.015) &&
          topTracker.score <= 0.62
        ) {
          candidate.baseline = true;
        }
      }
    }
    candidate.baseline = candidate.baseline && trackerAllowed.baseline;
    candidate.peaks = candidate.peaks && trackerAllowed.peaks;
    candidate.transients = candidate.transients && trackerAllowed.transients;
    candidate.flux = candidate.flux && trackerAllowed.flux;
    if (!candidate.baseline && !candidate.peaks && !candidate.transients && !candidate.flux) {
      if (trackerAllowed.baseline) candidate.baseline = true;
      else if (trackerAllowed.peaks) candidate.peaks = true;
      else if (trackerAllowed.transients) candidate.transients = true;
      else if (trackerAllowed.flux) candidate.flux = true;
    }

    const holdMsBase = (
      context.drop ||
      context.build ||
      Number(context.tier || 0) >= 3
    )
      ? META_AUTO_TEMPO_TRACKER_AUTO_TIMING.fastHoldMs
      : META_AUTO_TEMPO_TRACKER_AUTO_TIMING.holdMs;
    const decisiveSignal = topTracker.score >= dominanceGate.decisiveWinnerFloor && topGap >= dominanceGate.decisiveGap;
    const holdMs = decisiveSignal
      ? Math.max(35, Math.round(holdMsBase * 0.32))
      : holdMsBase;
    const forceImmediateSwitch =
      !sameMetaAutoTempoTrackers(candidate, stable) &&
      !keepDominantLock &&
      dominantSwitchReady &&
      !preferStableCandidate &&
      (
        context.drop ||
        context.build ||
        (topTracker.score >= 0.54 && topGap >= 0.1)
      );
    const realtimeDominantSwitch =
      !sameMetaAutoTempoTrackers(candidate, stable) &&
      !calmResetWindow &&
      !rawQuietWindow &&
      !lowTrackerEvidenceInCalm &&
      !keepDominantLock &&
      dominantSwitchReady &&
      !preferStableCandidate &&
      (
        (topTracker.score >= dominanceGate.winnerFloor && topGap >= dominanceGate.winnerGap) ||
        Number(context.motionSignal || 0) >= 0.44 ||
        Number(context.audioTransient || 0) >= 0.36 ||
        Number(context.audioFlux || 0) >= 0.34 ||
        Number(context.audioPeak || 0) >= 0.6
      );

    if (forceImmediateSwitch || realtimeDominantSwitch) {
      metaAutoTempoTrackerAutoStable = cloneMetaAutoTempoTrackers(candidate, candidate);
      metaAutoTempoTrackerAutoCandidate = cloneMetaAutoTempoTrackers(candidate, candidate);
      metaAutoTempoTrackerAutoCandidateSince = now;
      const nextPrimary = getPrimaryMetaAutoTempoTracker(candidate) || topTracker.key || "baseline";
      if (nextPrimary && nextPrimary !== metaAutoLastDominantTracker) {
        metaAutoDominantSwitches += 1;
        metaAutoLastDominantTracker = nextPrimary;
      }
      telemetry.metaAutoDominantTracker = nextPrimary || "none";
      telemetry.metaAutoDominantSwitches = metaAutoDominantSwitches;
      metaAutoTempoDominantLockKey = nextPrimary;
      metaAutoTempoDominantLockSince = now;
      metaAutoTempoDominantLockScore = clamp(Number(ema[metaAutoTempoDominantLockKey] || topTracker.score || 0), 0, 1);
      setMetaAutoTempoTrackersActiveTelemetry(metaAutoTempoTrackerAutoStable);
      return cloneMetaAutoTempoTrackers(metaAutoTempoTrackerAutoStable, candidate);
    }

    if (sameMetaAutoTempoTrackers(candidate, stable)) {
      metaAutoTempoTrackerAutoCandidate = cloneMetaAutoTempoTrackers(candidate, candidate);
      metaAutoTempoTrackerAutoCandidateSince = now;
    } else if (!sameMetaAutoTempoTrackers(candidate, metaAutoTempoTrackerAutoCandidate)) {
      metaAutoTempoTrackerAutoCandidate = cloneMetaAutoTempoTrackers(candidate, candidate);
      metaAutoTempoTrackerAutoCandidateSince = now;
    } else if (metaAutoTempoTrackerAutoCandidateSince <= 0 || (now - metaAutoTempoTrackerAutoCandidateSince) >= holdMs) {
      metaAutoTempoTrackerAutoStable = cloneMetaAutoTempoTrackers(candidate, candidate);
      metaAutoTempoTrackerAutoCandidate = cloneMetaAutoTempoTrackers(candidate, candidate);
      metaAutoTempoTrackerAutoCandidateSince = now;
    }

    const active = cloneMetaAutoTempoTrackers(
      metaAutoTempoTrackerAutoStable,
      metaAutoTempoTrackers
    );
    const activePrimary = getPrimaryMetaAutoTempoTracker(active) || topTracker.key || null;
    if (activePrimary && activePrimary !== metaAutoLastDominantTracker) {
      metaAutoDominantSwitches += 1;
      metaAutoLastDominantTracker = activePrimary;
    } else if (!activePrimary) {
      metaAutoLastDominantTracker = "none";
    }
    telemetry.metaAutoDominantTracker = activePrimary || "none";
    telemetry.metaAutoDominantSwitches = metaAutoDominantSwitches;
    if (activePrimary) {
      if (activePrimary !== metaAutoTempoDominantLockKey) {
        metaAutoTempoDominantLockKey = activePrimary;
        metaAutoTempoDominantLockSince = now;
      } else if (metaAutoTempoDominantLockSince <= 0) {
        metaAutoTempoDominantLockSince = now;
      }
      metaAutoTempoDominantLockScore = clamp(Number(ema[activePrimary] || topTracker.score || 0), 0, 1);
    } else {
      metaAutoTempoDominantLockKey = null;
      metaAutoTempoDominantLockSince = 0;
      metaAutoTempoDominantLockScore = 0;
    }
    setMetaAutoTempoTrackersActiveTelemetry(active);
    return active;
  }

  resetMetaAutoTempoTrackerAutoState(metaAutoTempoTrackers);

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

  function readTransportPressure(now = Date.now()) {
    const ts = Number(transportPressureUpdatedAt || 0);
    if (!(ts > 0)) {
      return {
        pressure: 0,
        raw: 0,
        ageMs: Number.POSITIVE_INFINITY
      };
    }
    const ageMs = Math.max(0, now - ts);
    const decay = Math.exp(-ageMs / TRANSPORT_PRESSURE_DECAY_MS);
    return {
      pressure: clamp(transportPressureEma * decay, 0, TRANSPORT_PRESSURE_MAX),
      raw: clamp(transportPressureRaw * decay, 0, TRANSPORT_PRESSURE_MAX),
      ageMs
    };
  }

  function setTransportPressure(sample = {}) {
    const input = sample && typeof sample === "object" ? sample : {};
    const now = Number(input.now);
    const ts = Number.isFinite(now) && now > 0 ? now : Date.now();
    const current = readTransportPressure(ts).pressure;
    const incomingRaw = clamp(
      Number(input.raw ?? input.pressure ?? 0),
      0,
      TRANSPORT_PRESSURE_MAX
    );
    const incomingPressure = clamp(
      Number(input.pressure ?? incomingRaw),
      0,
      TRANSPORT_PRESSURE_MAX
    );
    const alpha = incomingPressure >= current ? 0.84 : 0.32;
    const next = clamp(lerp(current, incomingPressure, alpha), 0, TRANSPORT_PRESSURE_MAX);
    transportPressureEma = next;
    transportPressureRaw = incomingRaw;
    transportPressureUpdatedAt = ts;
    telemetry.transportPressure = Number(next.toFixed(3));
    telemetry.transportPressureRaw = Number(incomingRaw.toFixed(3));
    telemetry.transportPressureAt = ts;
    return telemetry.transportPressure;
  }

  function overclockLevelFromHz(hz) {
    // Meta Auto runs strictly in the 2..16Hz envelope.
    const safeHz = clamp(Number(hz) || META_AUTO_HZ_MIN, META_AUTO_HZ_MIN, META_AUTO_HZ_MAX);
    let bestLevel = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let level = 0; level <= META_AUTO_HZ_LEVEL_MAX; level++) {
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
    const confirmMs = delta > 0.28 ? 100 : (delta > 0.16 ? 240 : 460);
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
    const baselineDrive = clamp(audio * 0.62 + audioBandLow * 0.28 + beat * 0.1, 0, 1);
    // Base-drums drive: low-end percussive emphasis (kick/bass drum),
    // intentionally de-emphasizes broad/high-band drum motion.
    const baseDrumsDrive = clamp(
      audioBandLow * 0.6 +
      beat * 0.22 +
      audioTransient * 0.12 +
      Math.max(0, audioBandLow - audioBandMid) * 0.06,
      0,
      1
    );
    const drumsDrive = baseDrumsDrive;
    const baselineTempoDrive = clamp(baselineDrive * 0.56 + drumsDrive * 0.44, 0, 1);
    const bpm = clamp(Number(telemetry.bpm || 118), 60, 190);
    const trend = clamp(Number(energyTrend || 0), -0.2, 0.2);
    const transportPressureState = readTransportPressure(now);
    const transportSendPressure = clamp(Number(transportPressureState.pressure || 0), 0, TRANSPORT_PRESSURE_MAX);
    const transportSendPressureRaw = clamp(Number(transportPressureState.raw || 0), 0, TRANSPORT_PRESSURE_MAX);
    const transportPressureAgeMs = Number(transportPressureState.ageMs || Number.POSITIVE_INFINITY);

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

    // Tempo-first mapping with alias correction + smoothing.
    // Keep normal tempo response below 16; unlock 16 only on high-confidence very-fast sections.
    let tempoBpm = bpm;
    if (
      tempoBpm >= 176 &&
      beat < 0.3 &&
      motionSignal < 0.34 &&
      intensity < 0.5 &&
      tier <= 1 &&
      !aggressiveGenre &&
      !chaotic &&
      heavyHoldMs < META_AUTO_LEARN_HOLD_MS
    ) {
      tempoBpm *= 0.5;
    } else if (
      tempoBpm <= 90 &&
      beat > 0.56 &&
      motionSignal > 0.58 &&
      intensity > 0.62
    ) {
      tempoBpm *= 2;
    }
    tempoBpm = clamp(tempoBpm, 60, 190);
    if (!(metaAutoTempoBpmEma > 0)) metaAutoTempoBpmEma = tempoBpm;
    const tempoDelta = tempoBpm - metaAutoTempoBpmEma;
    const rampingUp = tempoDelta >= 0;
    const fastCue = drop || build || beat > 0.62 || motionSignal > 0.6;
    const tempoUrgency = clamp(
      (audioBandLow * 0.34) +
      (beat * 0.28) +
      (audioTransient * 0.22) +
      (audioFlux * 0.16) +
      (Math.max(0, driveSignal - 0.32) * 0.22) +
      (drop ? 0.18 : 0) +
      (build ? 0.12 : 0),
      0,
      1
    );
    const tempoEmaAlpha = rampingUp
      ? clamp((fastCue ? 0.4 : 0.3) + (tempoUrgency * 0.16), 0.26, 0.62)
      : clamp((fastCue ? 0.2 : 0.16) - (tempoUrgency * 0.04), 0.08, 0.24);
    metaAutoTempoBpmEma = lerp(metaAutoTempoBpmEma, tempoBpm, tempoEmaAlpha);
    const smoothTempoBpm = metaAutoTempoBpmEma;

    const tempoEvidence = clamp((smoothTempoBpm - 112) / 78, 0, 1);
    const tempoConfidence = clamp(
      beat * 0.42 +
      motionSignal * 0.28 +
      intensity * 0.2 +
      tempoEvidence * 0.1 +
      transportSendPressure * 0.08,
      0,
      1
    );
    const trackerSignalEvidence = clamp(
      (audioBandLow * 0.32) +
      (beat * 0.2) +
      (audioTransient * 0.18) +
      (audioFlux * 0.16) +
      (audioPeak * 0.14) +
      (motionSignal * 0.12),
      0,
      1
    );
    const rawSilenceFactor = clamp(
      Math.max(0, (0.102 - audio) * 6.2) +
      Math.max(0, (0.2 - beat) * 1.6) +
      Math.max(0, (0.24 - motionSignal) * 1.05),
      0,
      1
    );
    const silenceEvidenceRelief = clamp(
      (trackerSignalEvidence * 0.46) +
      (beat * 0.16) +
      (Math.max(0, audioBandLow - 0.08) * 0.82) +
      (Math.max(0, audioTransient - 0.1) * 0.58) +
      (Math.max(0, audioPeak - 0.16) * 0.44),
      0,
      0.74
    );
    const silenceFactor = clamp(rawSilenceFactor - silenceEvidenceRelief, 0, 1);
    const tempoSilencePull = clamp(
      silenceFactor * (1 - tempoConfidence * 0.82) * lerp(0.64, 0.22, trackerSignalEvidence),
      0,
      1
    );
    const effectiveTempoBpm = lerp(
      smoothTempoBpm,
      60,
      tempoSilencePull
    );
    const tempoNorm = clamp((effectiveTempoBpm - 60) / 130, 0, 1);
    const tempoLinearHz = 2 + ((effectiveTempoBpm - 60) / 8.2);
    const tempoCurveHz = 2 + Math.pow(tempoNorm, 0.68) * 13.2;
    const tempoLift = clamp(
      (beat - 0.34) * 1.7 +
      (motionSignal - 0.4) * 1.25 +
      (intensity - 0.54) * 0.95 +
      (tier >= 3 ? 0.22 : 0) -
      (silenceFactor * 1.45) +
      (tempoConfidence - 0.42) * 0.42,
      -2.6,
      1.55
    );
    const activeTrackerFlags = resolveMetaAutoTempoTrackersForPlan(now, {
      driveSignal,
      motionSignal,
      intensity,
      beat,
      baselineTempoDrive,
      drumsDrive,
      audioPeak,
      audioTransient,
      audioFlux,
      silenceFactor,
      sustainedCalm,
      drop,
      build,
      aggressiveGenre,
      metaGenre,
      tier,
      tempoConfidence,
      smoothTempoBpm,
      effectiveTempoBpm
    });
    const trackerBaselineActive = Boolean(activeTrackerFlags.baseline);
    const trackerPeaksActive = Boolean(activeTrackerFlags.peaks);
    const trackerTransientsActive = Boolean(activeTrackerFlags.transients);
    const trackerFluxActive = Boolean(activeTrackerFlags.flux);
    const metaTempoTrackerActive = Boolean(
      trackerBaselineActive ||
      trackerPeaksActive ||
      trackerTransientsActive ||
      trackerFluxActive
    );
    const activeTrackerCount =
      (trackerBaselineActive ? 1 : 0) +
      (trackerPeaksActive ? 1 : 0) +
      (trackerTransientsActive ? 1 : 0) +
      (trackerFluxActive ? 1 : 0);
    const manualTrackerMode = metaAutoTempoTrackersAuto !== true;
    const baselineSolo = trackerBaselineActive && activeTrackerCount === 1;
    const peaksSolo = trackerPeaksActive && activeTrackerCount === 1;
    const transientsSolo = trackerTransientsActive && activeTrackerCount === 1;
    const fluxSolo = trackerFluxActive && activeTrackerCount === 1;
    const sharedManualBoost = manualTrackerMode
      ? (activeTrackerCount <= 1 ? 1.34 : (activeTrackerCount === 2 ? 1.2 : 1.08))
      : 1;
    const baselineTrackerBoost = trackerBaselineActive
      ? (manualTrackerMode ? (baselineSolo ? 1.3 : Math.max(1.1, sharedManualBoost - 0.08)) : 1)
      : 1;
    const peaksTrackerBoost = trackerPeaksActive
      ? (manualTrackerMode ? (peaksSolo ? 1.58 : Math.max(1.18, sharedManualBoost + 0.06)) : 1)
      : 1;
    const transientsTrackerBoost = trackerTransientsActive
      ? (manualTrackerMode ? (transientsSolo ? 1.54 : Math.max(1.18, sharedManualBoost + 0.04)) : 1)
      : 1;
    const fluxTrackerBoost = trackerFluxActive
      ? (manualTrackerMode ? (fluxSolo ? 1.48 : Math.max(1.16, sharedManualBoost + 0.02)) : 1)
      : 1;
    const trackerIntentRank = [];
    if (trackerBaselineActive) {
      trackerIntentRank.push({
        key: "baseline",
        score: clamp(
          (baselineTempoDrive * 0.58) +
          (drumsDrive * 0.42) +
          (beat * 0.12),
          0,
          1.7
        )
      });
    }
    if (trackerPeaksActive) {
      trackerIntentRank.push({
        key: "peaks",
        score: clamp(
          (audioPeak * 0.72) +
          (beat * 0.2) +
          (audioTransient * 0.14),
          0,
          1.7
        )
      });
    }
    if (trackerTransientsActive) {
      trackerIntentRank.push({
        key: "transients",
        score: clamp(
          (audioTransient * 0.76) +
          (beat * 0.16) +
          (audioFlux * 0.18),
          0,
          1.7
        )
      });
    }
    if (trackerFluxActive) {
      trackerIntentRank.push({
        key: "flux",
        score: clamp(
          (audioFlux * 0.72) +
          (motionSignal * 0.24) +
          (beat * 0.1),
          0,
          1.7
        )
      });
    }
    trackerIntentRank.sort((a, b) => b.score - a.score);
    const dominantTrackerKey = trackerIntentRank[0] ? trackerIntentRank[0].key : null;
    const dominantTrackerScore = trackerIntentRank[0] ? trackerIntentRank[0].score : 0;
    const secondaryTrackerScore = trackerIntentRank[1] ? trackerIntentRank[1].score : 0;
    const dominantTrackerGap = Math.max(0, dominantTrackerScore - secondaryTrackerScore);
    const dominantTrackerConfidence = clamp(
      (dominantTrackerScore * 0.56) +
      (dominantTrackerGap * 1.24) +
      (tempoConfidence * 0.18) -
      (silenceFactor * 0.32),
      0,
      1.6
    );
    const autoDominantSingle = metaAutoTempoTrackersAuto && activeTrackerCount === 1;
    const dominantSignalDemand = autoDominantSingle
      ? clamp(
        trackerPeaksActive
          ? (audioPeak * 0.82 + beat * 0.18)
          : trackerTransientsActive
            ? (audioTransient * 0.84 + beat * 0.16)
            : trackerFluxActive
              ? (audioFlux * 0.86 + motionSignal * 0.14)
              : ((baselineTempoDrive * 0.42) + (drumsDrive * 0.58)),
        0,
        1.6
      )
      : 0;
    const dominantAggression = autoDominantSingle
      ? clamp(
        (dominantSignalDemand * 0.62) +
        (tempoConfidence * 0.22) +
        (beat * 0.16),
        0,
        1.6
      )
      : 0;
    const musicMirrorDrive = clamp(
      (trackerSignalEvidence * 0.42) +
      (baselineTempoDrive * 0.22) +
      (drumsDrive * 0.2) +
      (tempoConfidence * 0.16),
      0,
      1.6
    );
    const musicMirrorPulse = clamp(
      (audioTransient * 0.46) +
      (audioPeak * 0.18) +
      (beat * 0.2) +
      (Math.max(0, audioBandLow - audioBandMid) * 0.28) +
      (drop ? 0.18 : 0) +
      (build ? 0.1 : 0),
      0,
      1.8
    );
    const musicMirrorTargetHz = clamp(
      2 +
      Math.pow(clamp(musicMirrorDrive / 1.2, 0, 1), 0.72) * 14 +
      (musicMirrorPulse * 2.35) -
      (silenceFactor * 1.5),
      2,
      16
    );
    const dominantRangeIntent = clamp(
      (dominantTrackerConfidence * 0.6) +
      (musicMirrorPulse * 0.34) +
      (tempoConfidence * 0.2) +
      (drop ? 0.24 : 0) +
      (build ? 0.12 : 0),
      0,
      1.9
    );
    const lowRangeIntent = clamp(
      (silenceFactor * 0.76) +
      (Math.max(0, 0.38 - trackerSignalEvidence) * 1.05) +
      (sustainedCalm ? 0.26 : 0) -
      (drop ? 0.28 : 0) -
      (build ? 0.16 : 0),
      0,
      1.4
    );
    const rangeIntentTargetHz = clamp(
      2 +
      (dominantRangeIntent * 8.8) -
      (lowRangeIntent * 3.4),
      2,
      16
    );
    const dominantIntentTargetHz = dominantTrackerKey
      ? clamp(
        2 +
        Math.pow(clamp(dominantTrackerScore / 1.18, 0, 1), 0.62) * 13.8 +
        (
          dominantTrackerKey === "baseline"
            ? (drumsDrive * 1.25 + baselineTempoDrive * 0.9)
            : dominantTrackerKey === "transients"
              ? (audioTransient * 1.4 + beat * 0.65)
              : dominantTrackerKey === "peaks"
                ? (audioPeak * 1.3 + beat * 0.55)
                : (audioFlux * 1.25 + motionSignal * 0.7)
        ) +
        (drop ? 0.8 : (build ? 0.42 : 0)) -
        (silenceFactor * 1.25),
        2,
        16
      )
      : musicMirrorTargetHz;
    const songEnergyComposite = clamp(
      (baselineTempoDrive * 0.26) +
      (drumsDrive * 0.24) +
      (motionSignal * 0.18) +
      (beat * 0.14) +
      (audioTransient * 0.1) +
      (audioPeak * 0.08),
      0,
      1
    );
    const rangeLowTarget = clamp(
      songEnergyComposite -
      (0.16 + (silenceFactor * 0.1)),
      0.04,
      0.74
    );
    const rangeHighTarget = clamp(
      songEnergyComposite +
      (0.24 + (tempoConfidence * 0.18) + (drop ? 0.08 : 0)),
      0.28,
      0.98
    );
    const nextLow = clamp(
      rangeLowTarget,
      0.03,
      Math.max(0.72, rangeHighTarget - 0.12)
    );
    const lowAlpha = nextLow >= metaAutoRangeLowAnchor
      ? META_AUTO_DYNAMIC_RANGE.lowRiseAlpha
      : META_AUTO_DYNAMIC_RANGE.lowFallAlpha;
    metaAutoRangeLowAnchor = clamp(
      lerp(metaAutoRangeLowAnchor, nextLow, lowAlpha),
      0.03,
      0.78
    );
    const nextHigh = clamp(
      Math.max(rangeHighTarget, metaAutoRangeLowAnchor + 0.14),
      metaAutoRangeLowAnchor + 0.14,
      0.99
    );
    const highAlpha = nextHigh >= metaAutoRangeHighAnchor
      ? META_AUTO_DYNAMIC_RANGE.highRiseAlpha
      : META_AUTO_DYNAMIC_RANGE.highFallAlpha;
    metaAutoRangeHighAnchor = clamp(
      lerp(metaAutoRangeHighAnchor, nextHigh, highAlpha),
      metaAutoRangeLowAnchor + 0.14,
      0.995
    );
    const dynamicRangeSpan = Math.max(0.14, metaAutoRangeHighAnchor - metaAutoRangeLowAnchor);
    const dynamicRangeNorm = clamp(
      (songEnergyComposite - metaAutoRangeLowAnchor) / dynamicRangeSpan,
      0,
      1
    );
    const dynamicRangeTargetHz = clamp(
      META_AUTO_HZ_MIN +
      Math.pow(dynamicRangeNorm, 0.8) * (META_AUTO_HZ_MAX - META_AUTO_HZ_MIN),
      META_AUTO_HZ_MIN,
      META_AUTO_HZ_MAX
    );
    const transportRateDemand = clamp(
      (transportSendPressure * 0.84) +
      (transportSendPressureRaw * 0.34) +
      (Math.max(0, (640 - transportPressureAgeMs) / 640) * 0.18),
      0,
      2.6
    );
    const transportGovernor = clamp(
      (transportRateDemand - 0.24) / 1.64,
      0,
      1.3
    );
    let targetHz = clamp(
      lerp(tempoCurveHz, tempoLinearHz, 0.44) + tempoLift + (transportRateDemand * 0.58),
      META_AUTO_HZ_MIN,
      META_AUTO_HZ_MAX
    );
    let metaBaselineHighPush = 0;
    let metaBaselineLowPull = 0;
    let baselineRampNeed = 0;
    if (trackerBaselineActive) {
      const baselineDemand = clamp((baselineTempoDrive * 0.46) + (drumsDrive * 0.54), 0, 1);
      baselineRampNeed = clamp(
        (baselineDemand - 0.5) * 2.65 +
        (drop ? 0.3 : 0) +
        (build ? 0.16 : 0) +
        (tempoConfidence * 0.18) -
        (silenceFactor * 0.55),
        0,
        1.6
      );
      baselineRampNeed = clamp(baselineRampNeed * baselineTrackerBoost, 0, 2.25);
      let baselineTempoBias = clamp(
        (baselineTempoDrive - 0.4) * 2.2 +
        (drumsDrive - 0.36) * 2.1 -
        (silenceFactor * 1.2),
        -1.35,
        1.95
      );
      baselineTempoBias = clamp(baselineTempoBias * baselineTrackerBoost, -1.7, 2.7);
      metaBaselineHighPush = clamp(
        (baselineTempoDrive - 0.52) * 2.35 +
        (drumsDrive - 0.46) * 2.5 +
        (tempoConfidence * baselineRampNeed * 0.28) +
        (drop ? 0.42 : (build ? 0.2 : 0)) -
        (silenceFactor * 0.5),
        0,
        1.8
      );
      metaBaselineHighPush = clamp(metaBaselineHighPush * baselineTrackerBoost, 0, 2.55);
      metaBaselineLowPull = clamp(
        (0.36 - baselineTempoDrive) * 2.6 +
        (0.34 - drumsDrive) * 1.9 +
        (silenceFactor * 1.05) +
        ((1 - tempoConfidence) * 0.48) -
        (drop ? 0.32 : 0),
        0,
        1.7
      );
      if (manualTrackerMode) {
        metaBaselineLowPull = clamp(metaBaselineLowPull * (0.86 / baselineTrackerBoost), 0, 1.55);
      }
      targetHz += baselineTempoBias + (metaBaselineHighPush * 1.04) - (metaBaselineLowPull * 1.16);
      const allowDeepCalmCap =
        !manualTrackerMode ||
        (
          beat < 0.2 &&
          audioBandLow < 0.22 &&
          baselineTempoDrive < 0.24 &&
          drumsDrive < 0.24
        );
      if (!drop && !build && allowDeepCalmCap && metaBaselineLowPull > 0.76 && silenceFactor > 0.38) {
        const deepCalmCap = clamp(2.1 + ((1 - metaBaselineLowPull) * 2.8), 2, 4.8);
        targetHz = Math.min(targetHz, deepCalmCap);
      }
    }
    let trackerHighPush = 0;
    let trackerLowPull = 0;
    let trackerRampNeed = 0;
    let trackerTempoBias = 0;
    if (trackerPeaksActive) {
      const peakDemand = clamp(
        (audioPeak * 0.62) +
        (audioTransient * 0.16) +
        (beat * 0.22),
        0,
        1
      );
      const peakRamp = clamp(
        (peakDemand - 0.5) * 2.28 +
        (drop ? 0.24 : 0) +
        (build ? 0.12 : 0) -
        (silenceFactor * 0.34),
        0,
        1.2
      );
      trackerRampNeed = Math.max(
        trackerRampNeed,
        clamp(peakRamp * peaksTrackerBoost, 0, 1.85)
      );
      let peakHighPush = clamp(
        (peakDemand - 0.58) * 2.1 +
        (tempoConfidence * 0.14) +
        (drop ? 0.32 : (build ? 0.14 : 0)) -
        (silenceFactor * 0.45),
        0,
        1.25
      );
      peakHighPush = clamp(peakHighPush * peaksTrackerBoost, 0, 1.95);
      let peakLowPull = clamp(
        (0.35 - peakDemand) * 2.1 +
        (silenceFactor * 0.85) +
        ((1 - tempoConfidence) * 0.2),
        0,
        1.1
      );
      if (manualTrackerMode) {
        peakLowPull = clamp(peakLowPull * (0.84 / peaksTrackerBoost), 0, 1.05);
      }
      trackerTempoBias += clamp(
        ((peakDemand - 0.43) * 1.78 * peaksTrackerBoost) -
        (silenceFactor * (manualTrackerMode ? 0.64 : 0.84)),
        -1.15,
        1.95
      );
      trackerHighPush += peakHighPush;
      trackerLowPull += peakLowPull;
      targetHz += (peakHighPush * 0.78) - (peakLowPull * 0.62);
    }
    if (trackerTransientsActive) {
      const transientDemand = clamp(
        (audioTransient * 0.72) +
        (audioFlux * 0.1) +
        (beat * 0.18),
        0,
        1
      );
      const transientRamp = clamp(
        (transientDemand - 0.46) * 2.36 +
        (drop ? 0.22 : 0) +
        (build ? 0.14 : 0) -
        (silenceFactor * 0.28),
        0,
        1.25
      );
      trackerRampNeed = Math.max(
        trackerRampNeed,
        clamp(transientRamp * transientsTrackerBoost, 0, 1.95)
      );
      let transientHighPush = clamp(
        (transientDemand - 0.52) * 2.18 +
        (tempoConfidence * 0.12) +
        (drop ? 0.28 : (build ? 0.12 : 0)) -
        (silenceFactor * 0.38),
        0,
        1.2
      );
      transientHighPush = clamp(transientHighPush * transientsTrackerBoost, 0, 1.9);
      let transientLowPull = clamp(
        (0.34 - transientDemand) * 1.9 +
        (silenceFactor * 0.76) +
        ((1 - tempoConfidence) * 0.18),
        0,
        1.05
      );
      if (manualTrackerMode) {
        transientLowPull = clamp(transientLowPull * (0.84 / transientsTrackerBoost), 0, 1.02);
      }
      trackerTempoBias += clamp(
        ((transientDemand - 0.4) * 1.86 * transientsTrackerBoost) -
        (silenceFactor * (manualTrackerMode ? 0.54 : 0.68)),
        -1.05,
        2
      );
      trackerHighPush += transientHighPush;
      trackerLowPull += transientLowPull;
      targetHz += (transientHighPush * 0.82) - (transientLowPull * 0.58);
    }
    if (trackerFluxActive) {
      const fluxDemand = clamp(
        (audioFlux * 0.74) +
        (motionSignal * 0.18) +
        (beat * 0.08),
        0,
        1
      );
      const fluxRamp = clamp(
        (fluxDemand - 0.46) * 2.18 +
        (drop ? 0.18 : 0) +
        (build ? 0.18 : 0) -
        (silenceFactor * 0.26),
        0,
        1.18
      );
      trackerRampNeed = Math.max(
        trackerRampNeed,
        clamp(fluxRamp * fluxTrackerBoost, 0, 1.8)
      );
      let fluxHighPush = clamp(
        (fluxDemand - 0.5) * 2.06 +
        (tempoConfidence * 0.14) +
        (drop ? 0.2 : (build ? 0.16 : 0)) -
        (silenceFactor * 0.34),
        0,
        1.14
      );
      fluxHighPush = clamp(fluxHighPush * fluxTrackerBoost, 0, 1.78);
      let fluxLowPull = clamp(
        (0.34 - fluxDemand) * 1.76 +
        (silenceFactor * 0.72) +
        ((1 - tempoConfidence) * 0.16),
        0,
        1
      );
      if (manualTrackerMode) {
        fluxLowPull = clamp(fluxLowPull * (0.84 / fluxTrackerBoost), 0, 0.98);
      }
      trackerTempoBias += clamp(
        ((fluxDemand - 0.4) * 1.72 * fluxTrackerBoost) -
        (silenceFactor * (manualTrackerMode ? 0.52 : 0.62)),
        -0.95,
        1.8
      );
      trackerHighPush += fluxHighPush;
      trackerLowPull += fluxLowPull;
      targetHz += (fluxHighPush * 0.76) - (fluxLowPull * 0.56);
    }
    if (metaTempoTrackerActive) {
      targetHz += trackerTempoBias;
    }
    let trackerDemandFloor = 2;
    if (metaTempoTrackerActive) {
      const baselineFloor = trackerBaselineActive
        ? clamp(
          2 +
          (baselineTempoDrive * 6.2) +
          (drumsDrive * 6.8) +
          (beat * 1.6) -
          (silenceFactor * 2.2),
          2,
          16
        )
        : 2;
      const peaksFloor = trackerPeaksActive
        ? clamp(
          2 +
          (audioPeak * 8.6) +
          (beat * 2.4) +
          (audioTransient * 1.1) -
          (silenceFactor * 2),
          2,
          16
        )
        : 2;
      const transientsFloor = trackerTransientsActive
        ? clamp(
          2 +
          (audioTransient * 9.2) +
          (beat * 1.9) +
          (audioFlux * 1.4) -
          (silenceFactor * 1.9),
          2,
          16
        )
        : 2;
      const fluxFloor = trackerFluxActive
        ? clamp(
          2 +
          (audioFlux * 8.8) +
          (motionSignal * 2.8) +
          (beat * 1.2) -
          (silenceFactor * 1.8),
          2,
          16
        )
        : 2;
      trackerDemandFloor = Math.max(baselineFloor, peaksFloor, transientsFloor, fluxFloor);
      const trackerFloorQuietBlock =
        audio <= 0.05 &&
        audioPeak <= 0.14 &&
        audioTransient <= 0.06 &&
        audioFlux <= 0.055 &&
        beat <= 0.12 &&
        driveSignal <= 0.16 &&
        motionSignal <= 0.18 &&
        silenceFactor >= 0.55 &&
        tempoConfidence <= 0.22 &&
        effectiveTempoBpm <= 94 &&
        sustainedCalm;
      if (!trackerFloorQuietBlock) {
        targetHz = Math.max(targetHz, trackerDemandFloor);
      }
      if (autoDominantSingle && !trackerFloorQuietBlock && !sustainedCalm) {
        const dominantSingleFloor = clamp(
          4.1 +
          (dominantSignalDemand * 10.6) +
          (beat * 2.1) +
          (motionSignal * 1.1) -
          (silenceFactor * 1.05),
          3.8,
          16
        );
        targetHz = Math.max(targetHz, dominantSingleFloor);
      }
      if (!trackerFloorQuietBlock) {
        const mirrorFloor = clamp(
          2.9 +
          (musicMirrorDrive * 7.2) +
          (musicMirrorPulse * 1.6) +
          (tempoConfidence * 1.4) -
          (silenceFactor * 1.35),
          2.8,
          15.4
        );
        targetHz = Math.max(targetHz, mirrorFloor);
      }
    }
    if (!sustainedCalm && transportRateDemand > 0.1) {
      targetHz += clamp(
        (transportGovernor * 0.52) +
        (tempoConfidence * 0.24) -
        (silenceFactor * 0.3),
        -0.1,
        0.85
      );
    }
    const metaTempoTrackerRampNeed = Math.max(baselineRampNeed, trackerRampNeed);
    const metaTempoTrackerHighPush = metaBaselineHighPush + trackerHighPush;
    const metaTempoTrackerLowPull = metaBaselineLowPull + trackerLowPull;
    if (metaTempoTrackerActive) {
      const mirrorBlend = metaAutoTempoTrackersAuto ? 0.76 : 0.62;
      targetHz = lerp(targetHz, musicMirrorTargetHz, mirrorBlend);
      const dominantIntentBlend = metaAutoTempoTrackersAuto
        ? clamp(0.76 + (dominantTrackerConfidence * 0.08), 0.74, 0.9)
        : clamp(0.62 + (dominantTrackerConfidence * 0.08), 0.58, 0.82);
      targetHz = lerp(targetHz, dominantIntentTargetHz, dominantIntentBlend);
      const rangeIntentBlend = metaAutoTempoTrackersAuto
        ? clamp(0.3 + (dominantTrackerConfidence * 0.04), 0.28, 0.46)
        : clamp(0.22 + (dominantTrackerConfidence * 0.04), 0.2, 0.38);
      targetHz = lerp(targetHz, rangeIntentTargetHz, rangeIntentBlend);
      targetHz += clamp(
        (musicMirrorPulse - 0.28) * 2.9 +
        (autoDominantSingle ? dominantAggression * 0.74 : 0) +
        (dominantTrackerConfidence * 0.52) +
        (dominantTrackerGap * 1.9),
        -0.75,
        2.9
      );
    }
    const dynamicRangeBlend = clamp(
      0.24 +
      (tempoConfidence * 0.24) +
      (metaTempoTrackerActive ? 0.12 : 0) +
      (drop ? 0.12 : 0) -
      (sustainedCalm ? 0.1 : 0),
      0.2,
      0.68
    );
    targetHz = lerp(targetHz, dynamicRangeTargetHz, dynamicRangeBlend);
    const spectrumCenterHz = clamp(2 + Math.pow(tempoNorm, 0.72) * 12.6, 2, 14.6);
    const spectrumSpread = clamp(
      0.86 +
      tempoConfidence * 0.34 +
      (chaosHot ? 0.12 : 0) +
      (drop ? 0.16 : (build ? 0.08 : 0)) -
      (sustainedCalm ? 0.22 : 0) +
      (dominantRangeIntent * 0.26) -
      (lowRangeIntent * 0.2),
      0.64,
      2.08
    );
    targetHz = spectrumCenterHz + ((targetHz - spectrumCenterHz) * spectrumSpread);
    const styleMaxHzBase = Number(style.maxHz || 16);
    const styleMaxLift = clamp(
      tempoConfidence * 2.2 +
      motionSignal * 1.4 +
      (drop ? 1.2 : 0) +
      (build ? 0.6 : 0) +
      (chaosHot ? 0.5 : 0) -
      (sustainedCalm ? 1.6 : 0) +
      (dominantRangeIntent * 1.05) -
      (lowRangeIntent * 0.62),
      0,
      6.1
    );
    const hardQuietTempoReset =
      audio <= 0.05 &&
      audioPeak <= 0.14 &&
      audioTransient <= 0.06 &&
      audioFlux <= 0.055 &&
      beat <= 0.12 &&
      driveSignal <= 0.16 &&
      motionSignal <= 0.18 &&
      silenceFactor >= 0.55 &&
      tempoConfidence <= 0.22 &&
      effectiveTempoBpm <= 94 &&
      sustainedCalm;
    const styleMaxCap = META_AUTO_HZ_MAX;
    const styleMaxHz = clamp(
      styleMaxHzBase +
      styleMaxLift +
      (decadeOverclockBias * 0.35) +
      (
        metaTempoTrackerActive
          ? clamp((metaTempoTrackerHighPush * 1.62) - (metaTempoTrackerLowPull * 0.52), 0, 2.8)
          : 0
      ),
      6,
      styleMaxCap
    );
    targetHz = Math.min(targetHz, styleMaxHz);
    if (
      !sustainedCalm &&
      dominantRangeIntent >= 1.08 &&
      musicMirrorPulse >= 0.72
    ) {
      const burstFloor = clamp(
        11.8 +
        (dominantRangeIntent * 2.2) +
        (dominantTrackerGap * 3.2) -
        (silenceFactor * 1.2),
        11.6,
        styleMaxCap
      );
      targetHz = Math.max(targetHz, burstFloor);
    }
    if (
      !sustainedCalm &&
      !hardQuietTempoReset &&
      transportRateDemand >= 1.08 &&
      (metaTempoTrackerActive || beat > 0.42 || motionSignal > 0.46)
    ) {
      targetHz += clamp(
        0.24 +
        (transportGovernor * 0.9) +
        (tempoConfidence * 0.28) -
        (silenceFactor * 0.34),
        0.08,
        1.45
      );
    }
    if (!drop && !build && sustainedCalm && lowRangeIntent > 0.72) {
      const deepLowCap = clamp(
        2.2 +
        ((1 - lowRangeIntent) * 2.3) +
        (trackerSignalEvidence * 1.8),
        2,
        4.9
      );
      targetHz = Math.min(targetHz, deepLowCap);
    }
    const highConfidenceFast =
      beat >= 0.74 &&
      motionSignal > 0.7 &&
      intensity > 0.92;
    const metaTrackerFastEvidence = clamp(
      (metaTempoTrackerHighPush * 0.36) +
      (metaTempoTrackerRampNeed * 0.44) +
      (tempoConfidence * 0.2),
      0,
      1.6
    );
    const metaHighConfidenceFast = (
      metaTempoTrackerActive &&
      smoothTempoBpm >= 168 &&
      (
        (trackerBaselineActive && baselineTempoDrive > 0.54 && drumsDrive > 0.5) ||
        metaTrackerFastEvidence > 0.64
      ) &&
      (tempoConfidence > 0.64 || drop || build)
    );
    if (
      (
        smoothTempoBpm >= 184 &&
        highConfidenceFast &&
        (drop || tempoConfidence > 0.78)
      ) ||
      metaHighConfidenceFast
    ) {
      targetHz = 16;
    }
    const styleFloorHzBase = Number(style.floorHz || 2);
    const styleFloorHz = clamp(
      styleFloorHzBase +
      (decadeOverclockBias * 0.3) -
      (sustainedCalm ? 1.4 : 0) -
      (silenceFactor * 0.9),
      2,
      8.5
    );
    const floorDrive = clamp(
      (tempoNorm * 0.46) +
      (tempoConfidence * 0.28) +
      (tier >= 2 ? 0.18 : 0) +
      (aggressiveGenre ? 0.12 : 0) -
      (silenceFactor * 0.42) +
      (
        metaTempoTrackerActive
          ? (
            (trackerBaselineActive ? (baselineTempoDrive * 0.12) : 0) +
            (metaTempoTrackerHighPush * 0.14) -
            (metaTempoTrackerLowPull * 0.22)
          )
          : 0
      ),
      0,
      1
    );
    const adaptiveFloorHz = clamp(
      2 + ((styleFloorHz - 2) * floorDrive),
      2,
      9.5
    );
    if (!sustainedCalm || drop || build || recover || tempoConfidence > 0.3) {
      targetHz = Math.max(targetHz, adaptiveFloorHz);
    }
    if (hardQuietTempoReset && !drop && !build) {
      const quietCap = clamp(
        3.2 + (baselineTempoDrive * 1.85) + (drumsDrive * 1.25),
        3,
        6.6
      );
      targetHz = Math.min(targetHz, quietCap);
    }
    if (metaAutoTempoTrackersAuto && metaTempoTrackerActive && !sustainedCalm) {
      const bpmFloor = clamp(
        3.2 + Math.max(0, (smoothTempoBpm - 82) / 18),
        3.2,
        8.6
      );
      const motionFloor = clamp(
        3.1 +
        (baselineTempoDrive * 2.25) +
        (drumsDrive * 2.55) +
        (motionSignal * 2.6) +
        (beat * 1.35) -
        (silenceFactor * 1.35),
        3,
        11.4
      );
      const dominantAutoFloor = autoDominantSingle
        ? clamp(
          3.8 +
          (dominantSignalDemand * 6.4) +
          (tempoConfidence * 1.8) +
          (beat * 1.1) -
          (silenceFactor * 1.2),
          3.6,
          13.4
        )
        : 2;
      const confidenceFloor = tempoConfidence >= 0.22
        ? Math.max(bpmFloor, motionFloor, dominantAutoFloor)
        : Math.max(3.2, bpmFloor * 0.92, dominantAutoFloor * 0.88);
      targetHz = Math.max(targetHz, confidenceFloor);
    }
    const lowLockEscapeSignal = clamp(
      (musicMirrorDrive * 0.56) +
      (musicMirrorPulse * 0.44) +
      (tempoConfidence * 0.18) +
      (drop ? 0.22 : 0) +
      (build ? 0.12 : 0),
      0,
      1.9
    );
    const prevHz = (
      metaAutoAppliedHz > 0
        ? metaAutoAppliedHz
        : (metaAutoLastTargetHz > 0 ? metaAutoLastTargetHz : targetHz)
    );
    if (
      metaTempoTrackerActive &&
      !sustainedCalm &&
      !hardQuietTempoReset &&
      prevHz <= 4.4 &&
      lowLockEscapeSignal >= 0.34
    ) {
      const escapeFloor = clamp(
        5 +
        (lowLockEscapeSignal * 7.8) +
        (beat * 1.4) +
        (tempoConfidence * 1.2) -
        (silenceFactor * 1.1),
        5.2,
        16
      );
      targetHz = Math.max(targetHz, escapeFloor);
    }
    if (
      metaTempoTrackerActive &&
      !sustainedCalm &&
      !hardQuietTempoReset &&
      prevHz <= 6.2 &&
      lowLockEscapeSignal >= 0.52
    ) {
      const midEscapeFloor = clamp(
        6.6 +
        (lowLockEscapeSignal * 6.4) +
        (tempoConfidence * 1.4) -
        (silenceFactor * 0.9),
        6.8,
        16
      );
      targetHz = Math.max(targetHz, midEscapeFloor);
    }
    if (metaTempoTrackerActive && targetHz > prevHz) {
      const upDelta = targetHz - prevHz;
      const floorDeltaAssist = Math.max(0, trackerDemandFloor - prevHz);
      const manualRampAssist = (manualTrackerMode && metaTempoTrackerActive)
        ? clamp(
          0.18 +
          (metaTempoTrackerRampNeed * 0.48) +
          (metaTempoTrackerHighPush * 0.16),
          0.12,
          1.3
        )
        : 0;
      const baselineDrumAssist = (
        trackerBaselineActive &&
        (manualTrackerMode || metaAutoTempoTrackersAuto)
      )
        ? clamp(
          (drumsDrive * 0.52) +
          (baselineTempoDrive * 0.22) +
          (beat * 0.18) -
          (silenceFactor * 0.18),
          0,
          0.95
        )
        : 0;
      const deliberateUpCap = clamp(
        0.44 +
        (metaTempoTrackerRampNeed * (fastCue ? 2.1 : 1.56)) +
        (floorDeltaAssist * 0.5) +
        (autoDominantSingle ? clamp(0.58 + dominantSignalDemand * 1.32 + dominantAggression * 0.36, 0.4, 2.8) : 0) +
        manualRampAssist +
        baselineDrumAssist +
        (drop ? 0.44 : 0) +
        (build ? 0.24 : 0),
        0.38,
        5.2
      );
      targetHz = prevHz + Math.min(upDelta, deliberateUpCap);
    }
    const midBandTrap = prevHz >= 6 && prevHz <= 10 && Math.abs(targetHz - prevHz) < 0.55;
    if (midBandTrap) {
      if (tempoConfidence > 0.64 || drop || build || chaotic) {
        targetHz += 0.75 + Math.max(0, (tempoConfidence - 0.64) * 1.1);
      } else if (sustainedCalm || silenceFactor > 0.56) {
        targetHz -= 0.72;
      }
    }
    const lowSwing = Math.abs(targetHz - prevHz) < 0.2;
    let stallRelease = 0;
    if (lowSwing) {
      if (metaAutoRangeStallSince <= 0) {
        metaAutoRangeStallSince = now;
        metaAutoRangeStallAnchorHz = prevHz;
        metaAutoRangeStallAnchorTempo = smoothTempoBpm;
        metaAutoRangeStallAnchorDrive = baselineTempoDrive;
        metaAutoRangeStallAnchorMotion = motionSignal;
      } else {
        const stallAgeMs = now - metaAutoRangeStallSince;
        const tempoMoved = Math.abs(smoothTempoBpm - metaAutoRangeStallAnchorTempo);
        const driveMoved = Math.abs(baselineTempoDrive - metaAutoRangeStallAnchorDrive);
        const motionMoved = Math.abs(motionSignal - metaAutoRangeStallAnchorMotion);
        const shouldForceRelease =
          stallAgeMs >= (metaTempoTrackerActive ? 1200 : 1850) &&
          (
            tempoMoved > 4.2 ||
            driveMoved > 0.085 ||
            motionMoved > 0.13 ||
            drop ||
            build ||
            silenceFactor > 0.62
          );
        if (shouldForceRelease) {
          const upCue = clamp(
            tempoConfidence * 0.42 +
            baselineTempoDrive * 0.34 +
            drumsDrive * 0.24 +
            (drop ? 0.28 : 0) +
            (build ? 0.18 : 0) -
            silenceFactor * 0.24,
            0,
            1.6
          );
          const downCue = clamp(
            silenceFactor * 0.62 +
            Math.max(0, 0.42 - baselineTempoDrive) * 0.58 +
            Math.max(0, 0.35 - drumsDrive) * 0.44 +
            (sustainedCalm ? 0.2 : 0),
            0,
            1.6
          );
          stallRelease = upCue >= downCue
            ? (0.92 + Math.max(0, upCue - downCue) * 0.92)
            : -(0.88 + Math.max(0, downCue - upCue) * 0.9);
          targetHz += stallRelease;
          metaAutoRangeStallSince = now - Math.round(metaTempoTrackerActive ? 420 : 620);
          metaAutoRangeStallAnchorHz = targetHz;
          metaAutoRangeStallAnchorTempo = smoothTempoBpm;
          metaAutoRangeStallAnchorDrive = baselineTempoDrive;
          metaAutoRangeStallAnchorMotion = motionSignal;
        }
      }
    } else if (Math.abs(targetHz - metaAutoRangeStallAnchorHz) > 1.2 || Math.abs(targetHz - prevHz) > 0.34) {
      metaAutoRangeStallSince = 0;
      metaAutoRangeStallAnchorHz = 0;
      metaAutoRangeStallAnchorTempo = 0;
      metaAutoRangeStallAnchorDrive = 0;
      metaAutoRangeStallAnchorMotion = 0;
    }
    if (!drop && !build && prevHz >= 12.5 && !highConfidenceFast) {
      let highHoldCap = clamp(
        11.1 +
        Math.max(0, (effectiveTempoBpm - 144) / 15) +
        tempoConfidence * 1.05,
        11.1,
        14.2
      );
      if (metaTempoTrackerActive) {
        highHoldCap = clamp(
          highHoldCap + (metaTempoTrackerHighPush * 1.3) - (metaTempoTrackerLowPull * 0.44),
          11.1,
          16
        );
      }
      targetHz = Math.min(targetHz, highHoldCap);
    }
    if (!drop) {
      let releaseBias = clamp(
        (0.56 - tempoConfidence) * 1.9 +
        silenceFactor * 0.78 +
        Math.max(0, (prevHz - 10) / 7) * 0.42,
        0,
        1.95
      );
      if (fastCue) releaseBias *= 0.78;
      if (aggressiveGenre && smoothTempoBpm >= 132) releaseBias *= 0.82;
      if (metaTempoTrackerActive) {
        const holdFactor = clamp(
          1 -
          (
            trackerBaselineActive
              ? (baselineTempoDrive * 0.18 + drumsDrive * 0.1)
              : 0
          ) +
          (metaTempoTrackerLowPull * 0.2) -
          (metaTempoTrackerHighPush * 0.16),
          0.6,
          1.2
        );
        releaseBias *= holdFactor;
        releaseBias *= clamp(
          1 -
          (dominantTrackerConfidence * 0.26) -
          (dominantTrackerGap * 0.32) -
          (musicMirrorPulse * 0.08),
          0.38,
          1.08
        );
        if (metaAutoTempoTrackersAuto) {
          releaseBias *= clamp(
            0.58 +
            (metaTempoTrackerLowPull * 0.14) -
            (metaTempoTrackerHighPush * 0.2) -
            (dominantAggression * 0.08),
            0.42,
            0.78
          );
        }
      }
      releaseBias *= clamp(
        1 - (transportGovernor * 0.2),
        0.46,
        1.06
      );
      targetHz -= releaseBias;
    }
    let maxUpPerEval = (
      (fastCue ? 2.35 : 1.86) +
      clamp(transportGovernor * 2.6, 0, 2.85)
    );
    let maxDownPerEvalBase = (silenceFactor > 0.46 ? 1.55 : 0.95) * clamp(
      1 - (transportGovernor * 0.22),
      0.42,
      1
    );
    if (metaTempoTrackerActive) {
      maxUpPerEval += 0.16 + (metaTempoTrackerRampNeed * 0.62) + (metaTempoTrackerHighPush * 0.2);
      maxDownPerEvalBase += 0.34 + (metaTempoTrackerLowPull * 0.74);
      maxUpPerEval += clamp(
        (dominantTrackerConfidence * 0.46) + (dominantTrackerGap * 0.86),
        0,
        1.9
      );
      maxDownPerEvalBase *= clamp(
        0.94 -
        (dominantTrackerConfidence * 0.14) -
        (dominantTrackerGap * 0.1),
        0.46,
        0.92
      );
      if (manualTrackerMode) {
        maxUpPerEval += 0.4 + (metaTempoTrackerRampNeed * 0.56);
        maxDownPerEvalBase *= clamp(
          0.66 + (metaTempoTrackerLowPull * 0.12),
          0.56,
          0.84
        );
      }
      if (metaAutoTempoTrackersAuto) {
        maxDownPerEvalBase *= clamp(
          0.64 +
          (metaTempoTrackerLowPull * 0.12) -
          (metaTempoTrackerHighPush * 0.08) -
          (dominantAggression * 0.06),
          0.38,
          0.72
        );
      }
      if (autoDominantSingle) {
        maxUpPerEval += clamp(
          0.62 +
          dominantSignalDemand * 1.08 +
          dominantAggression * 0.4,
          0.5,
          2.9
        );
        maxDownPerEvalBase *= clamp(
          0.72 -
          dominantSignalDemand * 0.08 -
          dominantAggression * 0.06,
          0.46,
          0.78
        );
      }
    }
    if (stallRelease > 0) {
      maxUpPerEval += 0.62;
    } else if (stallRelease < 0) {
      maxDownPerEvalBase += 0.62;
    }
    const maxDownPerEval = (
      prevHz > 12 &&
      !drop &&
      !highConfidenceFast
    )
      ? Math.max(maxDownPerEvalBase, 2.45)
      : maxDownPerEvalBase;
    targetHz = clamp(targetHz, prevHz - maxDownPerEval, prevHz + maxUpPerEval);
    const rangeAssist = clamp(
      (dominantRangeIntent * 1.18) +
      (musicMirrorPulse * 0.52) +
      (metaTempoTrackerRampNeed * 0.22) -
      (lowRangeIntent * 1.06) -
      (silenceFactor * 0.44),
      -1.35,
      1.7
    );
    targetHz += rangeAssist;
    const weakSignalSmoothing = (
      !drop &&
      !build &&
      !recover &&
      transportGovernor < 0.9 &&
      tempoConfidence < 0.62 &&
      dominantRangeIntent < 0.96 &&
      Math.abs(targetHz - prevHz) < 2.4
    );
    if (weakSignalSmoothing) {
      const settleBlend = clamp(
        0.24 +
        (silenceFactor * 0.24) +
        (lowRangeIntent * 0.18) -
        (musicMirrorPulse * 0.16),
        0.16,
        0.46
      );
      targetHz = lerp(targetHz, prevHz, settleBlend);
    }
    const intentHz = clamp(targetHz, META_AUTO_HZ_MIN, META_AUTO_HZ_MAX);
    metaAutoIntentHz = intentHz;
    const intentDelta = intentHz - prevHz;
    let appliedUpLimit = clamp(
      META_AUTO_APPLIED_HZ_SLEW.baseUp +
      (transportGovernor * 1.15) +
      (metaTempoTrackerRampNeed * 0.62) +
      (drop || build ? META_AUTO_APPLIED_HZ_SLEW.fastUpBoost : 0) +
      (lowLockEscapeSignal > 0.58 ? 0.68 : 0),
      0.64,
      5.1
    );
    let appliedDownLimit = clamp(
      META_AUTO_APPLIED_HZ_SLEW.baseDown +
      (silenceFactor * 0.62) +
      (hardQuietTempoReset ? META_AUTO_APPLIED_HZ_SLEW.quietDownBoost : 0) -
      (transportGovernor * 0.18),
      0.6,
      4.2
    );
    if (intentDelta < 0 && Math.abs(intentDelta) > 2.4 && !drop && !build) {
      appliedDownLimit += 0.22;
    }
    targetHz = clamp(intentHz, prevHz - appliedDownLimit, prevHz + appliedUpLimit);
    const targetMaxHz = META_AUTO_HZ_MAX;
    targetHz = clamp(targetHz, META_AUTO_HZ_MIN, targetMaxHz);
    metaAutoAppliedHz = targetHz;
    metaAutoLastTargetHz = targetHz;
    metaAutoRangeSamples += 1;
    if (targetHz <= 4.15) metaAutoRangeLowHits += 1;
    if (targetHz >= 13.75) metaAutoRangeHighHits += 1;
    telemetry.metaAutoRangeLowPct = metaAutoRangeSamples > 0
      ? Number(((metaAutoRangeLowHits / metaAutoRangeSamples) * 100).toFixed(1))
      : 0;
    telemetry.metaAutoRangeHighPct = metaAutoRangeSamples > 0
      ? Number(((metaAutoRangeHighHits / metaAutoRangeSamples) * 100).toFixed(1))
      : 0;

    const hzQuantizeBias = (
      metaTempoTrackerActive &&
      !hardQuietTempoReset &&
      !sustainedCalm
    )
      ? (
        lerp(0.45, 1.2, clamp(lowLockEscapeSignal / 1.15, 0, 1)) +
        (transportGovernor * 0.22) +
        (dominantRangeIntent * 0.16) -
        (lowRangeIntent * 0.34)
      )
      : 0;
    const nextOverclock = clamp(
      overclockLevelFromHz(targetHz + hzQuantizeBias),
      0,
      MAX_OVERCLOCK_LEVEL
    );
    if (nextProfile === "reactive" && nextReactivity === "precision") {
      nextReactivity = "balanced";
    }

    const fastPath = (
      drop ||
      build ||
      tier >= 3 ||
      reason === "surge" ||
      reason === "kinetic" ||
      reason === "build" ||
      lowLockEscapeSignal >= 0.5 ||
      transportRateDemand >= 0.34
    );

    return {
      autoProfile: nextProfile,
      audioReactivityPreset: nextReactivity,
      overclockLevel: nextOverclock,
      reason,
      metaGenre,
      intentHz: Number(intentHz.toFixed(1)),
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
    telemetry.metaAutoIntentHz = Number(
      plan.intentHz || plan.targetHz || (META_AUTO_HZ_BY_LEVEL[clamp(Number(plan.overclockLevel), 0, MAX_OVERCLOCK_LEVEL)] || 2)
    );
    telemetry.metaAutoAppliedHz = telemetry.metaAutoHz;
    metaAutoIntentHz = telemetry.metaAutoIntentHz;
    metaAutoAppliedHz = telemetry.metaAutoAppliedHz;
    metaAutoLastTargetHz = metaAutoAppliedHz;
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
    telemetry.metaAutoTempoBaselineBlend = metaAutoTempoBaselineBlend;
    telemetry.metaAutoTempoTrackersAuto = metaAutoTempoTrackersAuto === true;
    telemetry.metaAutoTempoTrackers = { ...metaAutoTempoTrackers };
    telemetry.metaAutoTempoTrackersActive = { ...metaAutoTempoTrackers };
    const now = Date.now();
    resetMetaAutoTempoTrackerAutoState(metaAutoTempoTrackers);

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
      metaAutoIntentHz = metaAutoLastTargetHz;
      metaAutoAppliedHz = metaAutoLastTargetHz;
      metaAutoRangeLowAnchor = 0.2;
      metaAutoRangeHighAnchor = 0.82;
      metaAutoRangeSamples = 0;
      metaAutoRangeLowHits = 0;
      metaAutoRangeHighHits = 0;
      metaAutoDominantSwitches = 0;
      metaAutoLastDominantTracker = getPrimaryMetaAutoTempoTracker(metaAutoTempoTrackers) || "baseline";
      metaAutoDriveEma = 0;
      metaAutoMotionEma = 0;
      metaAutoIntensityEma = 0;
      metaAutoDrivePeak = 0;
      metaAutoMotionPeak = 0;
      metaAutoIntensityPeak = 0;
      metaAutoHeavySince = 0;
      metaAutoTempoBpmEma = 0;
      metaAutoRangeStallSince = 0;
      metaAutoRangeStallAnchorHz = 0;
      metaAutoRangeStallAnchorTempo = 0;
      metaAutoRangeStallAnchorDrive = 0;
      metaAutoRangeStallAnchorMotion = 0;
      telemetry.metaAutoReason = "enabled";
      telemetry.metaAutoProfile = autoProfile;
      telemetry.metaAutoGenre = metaAutoGenreStable;
      telemetry.metaAutoReactivity = audioReactivityPreset;
      telemetry.metaAutoHz = META_AUTO_HZ_BY_LEVEL[clamp(overclockLevel, 0, MAX_OVERCLOCK_LEVEL)] || 2;
      telemetry.metaAutoIntentHz = telemetry.metaAutoHz;
      telemetry.metaAutoAppliedHz = telemetry.metaAutoHz;
      telemetry.metaAutoRangeLowPct = 0;
      telemetry.metaAutoRangeHighPct = 0;
      telemetry.metaAutoDominantTracker = metaAutoLastDominantTracker;
      telemetry.metaAutoDominantSwitches = 0;
      telemetry.metaAutoOverclock = overclockLevel;
    } else {
      metaAutoCandidate = snapshotMetaPlan("disabled");
      metaAutoCandidateSince = now;
      metaAutoLastChaosAt = 0;
      metaAutoLastTargetHz = META_AUTO_HZ_BY_LEVEL[clamp(overclockLevel, 0, MAX_OVERCLOCK_LEVEL)] || 2;
      metaAutoIntentHz = metaAutoLastTargetHz;
      metaAutoAppliedHz = metaAutoLastTargetHz;
      metaAutoRangeLowAnchor = 0.2;
      metaAutoRangeHighAnchor = 0.82;
      metaAutoRangeSamples = 0;
      metaAutoRangeLowHits = 0;
      metaAutoRangeHighHits = 0;
      metaAutoDominantSwitches = 0;
      metaAutoLastDominantTracker = "none";
      metaAutoDriveEma = 0;
      metaAutoMotionEma = 0;
      metaAutoIntensityEma = 0;
      metaAutoDrivePeak = 0;
      metaAutoMotionPeak = 0;
      metaAutoIntensityPeak = 0;
      metaAutoHeavySince = 0;
      metaAutoTempoBpmEma = 0;
      metaAutoRangeStallSince = 0;
      metaAutoRangeStallAnchorHz = 0;
      metaAutoRangeStallAnchorTempo = 0;
      metaAutoRangeStallAnchorDrive = 0;
      metaAutoRangeStallAnchorMotion = 0;
      telemetry.metaAutoReason = "off";
      telemetry.metaAutoProfile = autoProfile;
      telemetry.metaAutoGenre = "off";
      telemetry.metaAutoReactivity = audioReactivityPreset;
      telemetry.metaAutoHz = META_AUTO_HZ_BY_LEVEL[clamp(overclockLevel, 0, MAX_OVERCLOCK_LEVEL)] || 2;
      telemetry.metaAutoIntentHz = telemetry.metaAutoHz;
      telemetry.metaAutoAppliedHz = telemetry.metaAutoHz;
      telemetry.metaAutoRangeLowPct = 0;
      telemetry.metaAutoRangeHighPct = 0;
      telemetry.metaAutoDominantTracker = "none";
      telemetry.metaAutoDominantSwitches = 0;
      telemetry.metaAutoOverclock = overclockLevel;
    }

    return metaAutoEnabled;
  }

  function setMetaAutoTempoTrackers(patch = {}) {
    const merged = (
      patch && typeof patch === "object" && !Array.isArray(patch)
    )
      ? { ...metaAutoTempoTrackers, ...patch }
      : { ...metaAutoTempoTrackers };
    const next = sanitizeMetaAutoTempoTrackers(merged, metaAutoTempoTrackers);
    metaAutoTempoTrackers = next;
    metaAutoTempoBaselineBlend = next.baseline === true;
    telemetry.metaAutoTempoBaselineBlend = metaAutoTempoBaselineBlend;
    telemetry.metaAutoTempoTrackersAuto = metaAutoTempoTrackersAuto === true;
    telemetry.metaAutoTempoTrackers = { ...metaAutoTempoTrackers };
    const now = Date.now();
    metaAutoLastEvalAt = 0;
    metaAutoLastAppliedAt = now - META_AUTO_TIMING.holdMs;
    metaAutoCandidateSince = now;
    metaAutoRangeSamples = 0;
    metaAutoRangeLowHits = 0;
    metaAutoRangeHighHits = 0;
    metaAutoRangeLowAnchor = 0.2;
    metaAutoRangeHighAnchor = 0.82;
    metaAutoIntentHz = metaAutoLastTargetHz;
    metaAutoAppliedHz = metaAutoLastTargetHz;
    telemetry.metaAutoRangeLowPct = 0;
    telemetry.metaAutoRangeHighPct = 0;
    metaAutoRangeStallSince = 0;
    metaAutoRangeStallAnchorHz = 0;
    metaAutoRangeStallAnchorTempo = 0;
    metaAutoRangeStallAnchorDrive = 0;
    metaAutoRangeStallAnchorMotion = 0;
    resetMetaAutoTempoTrackerAutoState(metaAutoTempoTrackers);
    setMetaAutoTempoTrackersActiveTelemetry(metaAutoTempoTrackers);
    return { ...metaAutoTempoTrackers };
  }

  function getMetaAutoTempoTrackers() {
    return { ...metaAutoTempoTrackers };
  }

  function setMetaAutoTempoTrackersAuto(enabled) {
    metaAutoTempoTrackersAuto = Boolean(enabled);
    telemetry.metaAutoTempoTrackersAuto = metaAutoTempoTrackersAuto === true;
    const now = Date.now();
    metaAutoLastEvalAt = 0;
    metaAutoLastAppliedAt = now - META_AUTO_TIMING.holdMs;
    metaAutoCandidateSince = now;
    metaAutoRangeSamples = 0;
    metaAutoRangeLowHits = 0;
    metaAutoRangeHighHits = 0;
    metaAutoRangeLowAnchor = 0.2;
    metaAutoRangeHighAnchor = 0.82;
    metaAutoIntentHz = metaAutoLastTargetHz;
    metaAutoAppliedHz = metaAutoLastTargetHz;
    telemetry.metaAutoRangeLowPct = 0;
    telemetry.metaAutoRangeHighPct = 0;
    metaAutoRangeStallSince = 0;
    metaAutoRangeStallAnchorHz = 0;
    metaAutoRangeStallAnchorTempo = 0;
    metaAutoRangeStallAnchorDrive = 0;
    metaAutoRangeStallAnchorMotion = 0;
    resetMetaAutoTempoTrackerAutoState(metaAutoTempoTrackers);
    setMetaAutoTempoTrackersActiveTelemetry(metaAutoTempoTrackers);
    return metaAutoTempoTrackersAuto;
  }

  function getMetaAutoTempoTrackersAuto() {
    return metaAutoTempoTrackersAuto === true;
  }

  function setMetaAutoTempoBaselineBlend(enabled) {
    return setMetaAutoTempoTrackers({ baseline: Boolean(enabled) }).baseline === true;
  }

  function getMetaAutoTempoBaselineBlend() {
    return getMetaAutoTempoTrackers().baseline === true;
  }

  function updateMetaAuto(now) {
    if (!metaAutoEnabled) return;
    if (now - metaAutoLastEvalAt < META_AUTO_TIMING.evalMs) return;
    metaAutoLastEvalAt = now;

    const previousAppliedHz = Number(telemetry.metaAutoAppliedHz || telemetry.metaAutoHz || metaAutoAppliedHz || 0);
    const plan = computeMetaPlan(now);
    telemetry.metaAutoProfile = plan.autoProfile;
    telemetry.metaAutoGenre = String(plan.metaGenre || metaAutoGenreStable || "auto");
    telemetry.metaAutoReactivity = plan.audioReactivityPreset;
    telemetry.metaAutoHz = Number(
      plan.targetHz || (META_AUTO_HZ_BY_LEVEL[clamp(Number(plan.overclockLevel), 0, MAX_OVERCLOCK_LEVEL)] || 2)
    );
    telemetry.metaAutoIntentHz = Number(
      plan.intentHz || plan.targetHz || (META_AUTO_HZ_BY_LEVEL[clamp(Number(plan.overclockLevel), 0, MAX_OVERCLOCK_LEVEL)] || 2)
    );
    telemetry.metaAutoAppliedHz = telemetry.metaAutoHz;
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
    const targetHzDelta = Math.abs(Number(plan.targetHz || 0) - previousAppliedHz);
    const fastPath = Boolean(plan.fastPath || overclockDelta >= 1 || targetHzDelta >= 1.25);
    const holdMs = fastPath ? META_AUTO_TIMING.fastHoldMs : META_AUTO_TIMING.holdMs;
    const confirmMs = fastPath ? META_AUTO_TIMING.fastConfirmMs : META_AUTO_TIMING.confirmMs;

    if (fastPath && overclockDelta >= 1 && (now - metaAutoLastAppliedAt) >= Math.max(16, Math.round(holdMs * 0.5))) {
      applyMetaPlan(plan, now);
      return;
    }
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
      telemetry.metaAutoIntentHz = telemetry.metaAutoHz;
      telemetry.metaAutoAppliedHz = telemetry.metaAutoHz;
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
  let hueColorIndex = 0;
  let wizColorIndex = 0;
  let wizColorCursor = 0;
  let wizBeatPulse = 0;
  let lastWizBeatAt = 0;
  let wizBeatStep = 0;
  let lastWizPaletteAdvanceAt = 0;
  let hueBrightnessSmoothed = 96;
  let wizBrightnessSmoothed = 0.2;
  let brightnessLevelFloorEma = 0.004;
  let brightnessLevelCeilEma = 0.16;
  let brightnessPresenceHold = 0;
  let brightnessPercentSmoothed = 0.05;
  let brightnessDriveEma = 0;
  let brightnessSilentFrames = 0;
  let lastWizScene = null;
  const manualPaletteCycleStateByBrand = {
    hue: {
      index: 0,
      colorOffset: 0,
      fingerprint: "",
      length: 0,
      lastAdvanceAt: 0,
      waitStartAt: 0,
      lastSignal: null,
      lastSpectrumIndex: 0
    },
    wiz: {
      index: 0,
      colorOffset: 0,
      fingerprint: "",
      length: 0,
      lastAdvanceAt: 0,
      waitStartAt: 0,
      lastSignal: null,
      lastSpectrumIndex: 0
    }
  };
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

  function getRawMusicBody() {
    const baseline = clamp(
      Math.max(
        audio,
        audioRms * 0.96,
        energy * 0.84
      ),
      0,
      1
    );
    const drums = clamp(
      audioBandLow * 0.58 +
      audioTransient * 0.27 +
      audioFlux * 0.15,
      0,
      1
    );
    const mids = clamp(audioBandMid * 0.72 + audioBandHigh * 0.28, 0, 1);
    const beat = clamp(Number(telemetry.beatConfidence || 0), 0, 1);
    const body = clamp(
      Math.max(
        baseline * 0.78 + drums * 0.34,
        baseline * 0.62 + drums * 0.28 + mids * 0.16,
        drums * 0.84,
        beat * 0.66
      ),
      0,
      1
    );
    return {
      baseline,
      drums,
      mids,
      beat,
      body
    };
  }

  const BRIGHTNESS_TIER_MIN = 0.06;
  const BRIGHTNESS_TIER_LOW = 0.40;
  const BRIGHTNESS_TIER_MEDIUM = 0.70;
  const BRIGHTNESS_TIER_HIGH = 1.00;

  function getVolumeBrightnessTier() {
    const smoothStep = (a, b, x) => {
      const t = clamp((x - a) / Math.max(1e-6, (b - a)), 0, 1);
      return t * t * (3 - 2 * t);
    };
    const sourceLevelRaw = clamp(
      Math.max(
        audio * 0.62 + audioRms * 0.38,
        audioRms * 0.96,
        Number(telemetry.audioSourceLevel || 0)
      ),
      0,
      1
    );
    const presenceEvidence = clamp(
      Math.max(
        audioTransient * 0.9,
        audioFlux * 0.84,
        Number(telemetry.beatConfidence || 0) * 0.88,
        audioBandLow * 0.78,
        audioBandMid * 0.62,
        energy * 0.54
      ),
      0,
      1
    );
    const floorAlpha = sourceLevelRaw <= brightnessLevelFloorEma ? 0.22 : 0.015;
    const ceilAlpha = sourceLevelRaw >= brightnessLevelCeilEma ? 0.2 : 0.02;
    brightnessLevelFloorEma = lerp(brightnessLevelFloorEma, sourceLevelRaw, floorAlpha);
    brightnessLevelCeilEma = lerp(brightnessLevelCeilEma, sourceLevelRaw, ceilAlpha);
    if (brightnessLevelCeilEma < (brightnessLevelFloorEma + 0.06)) {
      brightnessLevelCeilEma = brightnessLevelFloorEma + 0.06;
    }
    const dynamicLevel = clamp(
      (sourceLevelRaw - (brightnessLevelFloorEma + 0.0035)) /
      Math.max(0.05, brightnessLevelCeilEma - brightnessLevelFloorEma),
      0,
      1
    );
    brightnessPresenceHold = Math.max(
      presenceEvidence,
      brightnessPresenceHold * (presenceEvidence > brightnessPresenceHold ? 0.97 : 0.92)
    );
    const rhythmicPresence = clamp(
      Math.max(
        dynamicLevel * 0.72 + presenceEvidence * 0.28,
        sourceLevelRaw * 0.48 + dynamicLevel * 0.26 + presenceEvidence * 0.26,
        presenceEvidence * 0.82
      ),
      0,
      1
    );
    brightnessDriveEma = lerp(
      brightnessDriveEma,
      rhythmicPresence,
      rhythmicPresence > brightnessDriveEma ? 0.2 : 0.075
    );
    const absoluteSilentEdge = 0.004;
    const silentCandidate =
      sourceLevelRaw <= absoluteSilentEdge &&
      presenceEvidence < 0.045 &&
      dynamicLevel < 0.05 &&
      brightnessDriveEma < 0.075;
    brightnessSilentFrames = silentCandidate ? (brightnessSilentFrames + 1) : 0;
    const sustainedSilent = brightnessSilentFrames >= 12;
    const sourceLevel = sustainedSilent
      ? 0
      : clamp(
        Math.max(
          dynamicLevel * 0.74 + brightnessDriveEma * 0.26,
          sourceLevelRaw * 0.28 + presenceEvidence * 0.36 + brightnessPresenceHold * 0.36
        ),
        0,
        1
      );
    const effectiveLevel = sustainedSilent
      ? 0
      : clamp(
        Math.max(
          sourceLevel,
          sourceLevelRaw * 0.42 + dynamicLevel * 0.36 + brightnessPresenceHold * 0.22
        ),
        0,
        1
      );
    let percent = BRIGHTNESS_TIER_MIN;
    if (effectiveLevel <= 0.05) {
      percent = BRIGHTNESS_TIER_MIN;
    } else if (effectiveLevel <= 0.34) {
      percent = lerp(
        BRIGHTNESS_TIER_MIN,
        BRIGHTNESS_TIER_LOW,
        smoothStep(0.05, 0.34, effectiveLevel)
      );
    } else if (effectiveLevel <= 0.78) {
      percent = lerp(
        BRIGHTNESS_TIER_LOW,
        BRIGHTNESS_TIER_MEDIUM,
        smoothStep(0.34, 0.78, effectiveLevel)
      );
    } else {
      percent = lerp(
        BRIGHTNESS_TIER_MEDIUM,
        BRIGHTNESS_TIER_HIGH,
        smoothStep(0.78, 1, effectiveLevel)
      );
    }

    const peakLevel = clamp(
      Math.max(
        presenceEvidence * 0.88 + dynamicLevel * 0.12,
        sourceLevelRaw * 0.26 + dynamicLevel * 0.74,
        telemetry.drop ? 1 : 0
      ),
      0,
      1
    );
    if (peakLevel > 0.8) {
      const peakBoost = lerp(
        BRIGHTNESS_TIER_MEDIUM,
        BRIGHTNESS_TIER_HIGH,
        smoothStep(0.8, 1, peakLevel)
      );
      percent = Math.max(percent, peakBoost);
    }

    const rawPercent = clamp(percent, BRIGHTNESS_TIER_MIN, BRIGHTNESS_TIER_HIGH);
    const percentAlpha = rawPercent >= brightnessPercentSmoothed
      ? clamp(0.18 + peakLevel * 0.1, 0.14, 0.32)
      : (sustainedSilent ? 0.18 : 0.085);
    brightnessPercentSmoothed = lerp(brightnessPercentSmoothed, rawPercent, percentAlpha);
    const resolvedPercent = clamp(brightnessPercentSmoothed, BRIGHTNESS_TIER_MIN, BRIGHTNESS_TIER_HIGH);
    const previousTier = String(telemetry.brightnessTier || "silent").trim().toLowerCase();
    const silentThreshold = previousTier === "low" ? 0.095 : 0.11;
    const mediumThreshold = previousTier === "medium" ? 0.5 : 0.54;
    const highThreshold = previousTier === "high" ? 0.8 : 0.88;
    let tier = "silent";
    if (resolvedPercent <= silentThreshold) tier = "silent";
    else if (resolvedPercent < mediumThreshold) tier = "low";
    else if (resolvedPercent < highThreshold) tier = "medium";
    else tier = "high";
    telemetry.brightnessTier = tier;
    telemetry.brightnessPercent = resolvedPercent;
    telemetry.brightnessSourceLevel = effectiveLevel;
    telemetry.brightnessSourceRaw = sourceLevelRaw;
    telemetry.brightnessSourceNormalized = dynamicLevel;
    return {
      tier,
      percent: resolvedPercent,
      sourceLevel: effectiveLevel,
      effectiveLevel,
      sourceLevelRaw,
      normalizedLevel: dynamicLevel
    };
  }

  function getRhythmCadenceSignal(now = Date.now()) {
    const raw = getRawMusicBody();
    const rms = clamp(Math.max(audioRms, audio, 0.02), 0.02, 1);
    const beat = clamp(Number(telemetry.beatConfidence || 0), 0, 1);
    const relTransient = clamp(audioTransient / (0.06 + rms * 0.52), 0, 1.4);
    const relFlux = clamp(audioFlux / (0.05 + rms * 0.5), 0, 1.3);
    const beatRecency = lastWizBeatAt > 0
      ? clamp(1 - ((now - lastWizBeatAt) / 420), 0, 1)
      : 0;
    const drums = clamp(
      raw.drums * 0.72 +
      relTransient * 0.18 +
      relFlux * 0.12 +
      beat * 0.08,
      0,
      1
    );
    const rhythmPeak = Math.max(
      drums,
      relTransient * 0.86,
      relFlux * 0.82,
      beat * 0.74,
      beatRecency * 0.68
    );
    const rhythmBody = clamp(
      drums * 0.38 +
      relTransient * 0.2 +
      relFlux * 0.18 +
      beat * 0.16 +
      beatRecency * 0.08,
      0,
      1
    );
    const rhythm = clamp(
      rhythmBody * 0.74 + rhythmPeak * 0.26,
      0,
      1
    );
    return {
      raw,
      drums,
      beat,
      beatRecency,
      relTransient,
      relFlux,
      rhythm
    };
  }

  function getEnergyDrive() {
    const raw = getRawMusicBody();
    const base = clamp(energy * 0.58 + raw.baseline * 0.42, 0, 1);
    const motion = clamp(
      Math.max(
        audioTransient * 0.9,
        audioFlux * 1.02,
        raw.drums * 0.88,
        raw.body * 0.74,
        raw.beat * 0.92
      ),
      0,
      1
    );
    const motionDrive = clamp((motion - 0.08) / 0.74, 0, 1);
    const bodyDrive = clamp(raw.body * (0.82 + raw.drums * 0.22), 0, 1);
    return clamp(Math.max(base, bodyDrive, motionDrive * 0.84), 0, 1);
  }

  function getHueIntervalMs(now = Date.now()) {
    const base = getBaseIntervalMs();
    const rhythm = getRhythmCadenceSignal(now);
    const rhythmInterval = Math.round(lerp(280, 92, rhythm.rhythm));
    const overclockBoostCap = Math.round(base * 1.08);
    return Math.round(clamp(Math.min(rhythmInterval, overclockBoostCap), 84, 340));
  }

  function getWizIntervalMs(now = Date.now()) {
    const base = getBaseIntervalMs();
    const rhythm = getRhythmCadenceSignal(now);
    const rhythmInterval = Math.round(lerp(248, 80, rhythm.rhythm));
    const overclockBoostCap = Math.round(base * 0.98);
    return Math.round(clamp(Math.min(rhythmInterval, overclockBoostCap), 74, 300));
  }

  function applyEnergyBrightnessScale(rawBri) {
    const volumeTier = getVolumeBrightnessTier();
    const rhythm = getRhythmCadenceSignal();
    const minFloor = Math.max(1, Math.round(254 * BRIGHTNESS_TIER_MIN));
    const source = clamp(rawBri, 1, 254);
    const accent = clamp(
      rhythm.rhythm * 0.18 +
      rhythm.relTransient * 0.08 +
      rhythm.relFlux * 0.06 +
      (telemetry.beat ? 0.07 : 0) +
      (telemetry.drop ? 0.18 : 0),
      0,
      0.14
    );
    let target = source * volumeTier.percent;
    if (volumeTier.tier === "silent") {
      target = Math.max(minFloor, source * BRIGHTNESS_TIER_MIN * (1 + accent * 0.08));
    } else {
      target *= 1 + accent * 0.16;
    }
    const accentedTarget = clamp(target, minFloor, 254);
    if (!(hueBrightnessSmoothed > 0)) hueBrightnessSmoothed = accentedTarget;
    const blend = accentedTarget >= hueBrightnessSmoothed
      ? clamp(0.26 + rhythm.rhythm * 0.18, 0.2, 0.56)
      : clamp(0.13 + (1 - rhythm.rhythm) * 0.06, 0.1, 0.24);
    hueBrightnessSmoothed = lerp(hueBrightnessSmoothed, accentedTarget, blend);
    const output = Math.round(clamp(hueBrightnessSmoothed, 1, 254));
    telemetry.hueBrightnessOut = clamp(output / 254, 0, 1);
    return output;
  }

  function getWizBrightness(nowMs = Date.now()) {
    const volumeTier = getVolumeBrightnessTier();
    const rhythm = getRhythmCadenceSignal(nowMs);
    const beatConfidence = clamp(Number(telemetry.beatConfidence || 0), 0, 1);
    const beatAgeMs = lastWizBeatAt > 0 ? (nowMs - lastWizBeatAt) : Number.POSITIVE_INFINITY;
    const beatAgeLift = beatAgeMs < 220 ? (1 - (beatAgeMs / 220)) * 0.12 : 0;
    const pulseLift = wizBeatPulse * (0.16 + beatConfidence * 0.08);
    const accent = clamp(
      rhythm.rhythm * 0.22 +
      rhythm.drums * 0.16 +
      rhythm.relTransient * 0.08 +
      pulseLift +
      beatAgeLift +
      (telemetry.beat ? 0.06 : 0) +
      (telemetry.drop ? 0.2 : 0),
      0,
      0.16
    );
    let target = volumeTier.percent;
    if (volumeTier.tier === "silent") {
      target = BRIGHTNESS_TIER_MIN + accent * 0.08;
    } else {
      target = volumeTier.percent * (1 + accent * 0.18);
    }
    if (telemetry.drop) target = Math.max(target, 0.9);
    return clamp(target, BRIGHTNESS_TIER_MIN, 1);
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
    // Overclock changes can happen rapidly under Meta Auto; never postpone emit deadlines.
    // Tighten future deadlines only, so cadence cannot be starved by repeated retiming.
    if (nextHueEmitAt > 0) {
      nextHueEmitAt = Math.min(nextHueEmitAt, now + hueInterval);
    }
    if (nextWizEmitAt > 0) {
      nextWizEmitAt = Math.min(nextWizEmitAt, now + wizInterval);
    }
  }


/* =========================
   GAME MODE DETECTION
========================= */
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
  if (forcedSceneInput === "flow") {
    const flowScene = resolveFlowScene(now);
    return wizSceneSync ? flowScene : getDesyncedFlowScene(flowScene);
  }

  if (forcedScene && forcedScene !== FLOW_DYNAMIC_LOCK) {
    return forcedScene;
  }

  const behavior = String(telemetry.behavior || "idle").trim().toLowerCase();
  if (behavior === "flow") {
    const flowScene = resolveFlowScene(now);
    return wizSceneSync ? flowScene : getDesyncedFlowScene(flowScene);
  }

  return BEHAVIOR_SCENE_DEFAULTS[behavior] || "idle_soft";
}

function updateMode() {
  telemetry.mode = "interpret";
  telemetry.modeLock = "interpret";
  forcedMode = "interpret";
}

function getModeSwitchBias() {
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
      const decay = 0.88;
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
    const midDominance = clamp(
      audioBandMid - Math.max(audioBandLow * 0.84, audioBandHigh * 0.9),
      0,
      1
    );
    const percussionSupport = clamp(audioBandLow * 1.4 + audioTransient * 0.6 + audioFlux * 0.5, 0, 1);
    const vocalPenalty = midDominance * (1 - percussionSupport) * 0.24;
    const bandLift = clamp(
      audioBandLow * gp.bandLow + audioBandMid * gp.bandMid * 0.62 + audioBandHigh * gp.bandHigh,
      0,
      0.34
    );
    const fluxLift = clamp(audioFlux * gp.flux, 0, 0.2);

    const target = clamp(
      audio * gp.audioGain + peakLift + transientLift + zcrLift + bandLift + fluxLift - vocalPenalty,
      0,
      1.2
    );

    let biasedTarget = clamp(
      target + midiEnergyBoost + oscEnergyBoost,
      0,
      1.2
    );

    // Quiet-audio cap prevents low RMS beds from inflating into pulse energy.
    if (!externalDrop) {
      const quietByRms = clamp((audio - 0.05) / 0.3, 0, 1);
      const quietByTransient = clamp((audioTransient - 0.07) / 0.35, 0, 1);
      const quietByFlux = clamp((audioFlux - 0.05) / 0.3, 0, 1);
      const quietDrive = Math.max(quietByRms, quietByTransient, quietByFlux);
      const quietCap = 0.05 + quietDrive * 0.72;
      biasedTarget = Math.min(biasedTarget, quietCap);

      // Keep subtle movement alive in quieter passages with real motion.
      const microMotionFloor = clamp(
        audioTransient * 0.035 +
        audioFlux * 0.03 +
        Math.max(audioBandLow, audioBandMid, audioBandHigh) * 0.01,
        0,
        0.04
      );
      biasedTarget = Math.max(biasedTarget, microMotionFloor);
    }

    energy += (biasedTarget - energy) * (biasedTarget > energy ? 0.26 : 0.12);

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
  const BPM_INTERVAL_MIN_MS = 260;
  const BPM_INTERVAL_MAX_MS = 1500;
  const ONSET_TEMPO_MIN_BPM = 70;
  const ONSET_TEMPO_MAX_BPM = 190;
  const ONSET_TEMPO_HISTORY_MAX = 760;
  const ONSET_TEMPO_RECALC_MS = 180;
  let onsetTempoHistory = [];
  let onsetTempoLastAt = 0;
  let onsetTempoFrameMs = 16;
  let onsetTempoPrevLow = 0;
  let onsetTempoCachedBpm = 0;
  let onsetTempoCachedConfidence = 0;
  let onsetTempoCachedAt = 0;

  function pushOnsetTempoSample(now) {
    const t = Number(now);
    if (!Number.isFinite(t)) return;
    if (onsetTempoLastAt > 0) {
      const dt = clamp(t - onsetTempoLastAt, 8, 120);
      onsetTempoFrameMs += (dt - onsetTempoFrameMs) * 0.08;
    }
    onsetTempoLastAt = t;
    const lowRise = Math.max(0, audioBandLow - onsetTempoPrevLow);
    onsetTempoPrevLow = audioBandLow;
    const onset = clamp(
      audioFlux * 0.52 +
      audioTransient * 0.4 +
      lowRise * 0.34 +
      Math.max(0, audioPeak - audio) * 0.08,
      0,
      1.6
    );
    onsetTempoHistory.push(onset);
    if (onsetTempoHistory.length > ONSET_TEMPO_HISTORY_MAX) {
      onsetTempoHistory.shift();
    }
  }

  function estimateOnsetTempoBpm(now = Date.now()) {
    const ts = Number(now);
    if (
      Number.isFinite(ts) &&
      onsetTempoCachedAt > 0 &&
      (ts - onsetTempoCachedAt) < ONSET_TEMPO_RECALC_MS
    ) {
      return {
        bpm: onsetTempoCachedBpm,
        confidence: onsetTempoCachedConfidence
      };
    }

    const series = onsetTempoHistory;
    const len = series.length;
    if (len < 160) {
      onsetTempoCachedBpm = 0;
      onsetTempoCachedConfidence = 0;
      onsetTempoCachedAt = Number.isFinite(ts) ? ts : Date.now();
      return { bpm: 0, confidence: 0 };
    }

    const frameMs = clamp(onsetTempoFrameMs, 10, 48);

    const mean = series.reduce((sum, value) => sum + value, 0) / len;
    let bestBpm = 0;
    let bestScore = -1;
    let secondScore = -1;

    for (let bpm = ONSET_TEMPO_MIN_BPM; bpm <= ONSET_TEMPO_MAX_BPM; bpm += 1) {
      const lag = Math.round((60000 / bpm) / frameMs);
      if (!(lag >= 2 && lag < (len - 6))) continue;
      let sum = 0;
      let normA = 0;
      let normB = 0;
      for (let i = lag; i < len; i += 1) {
        const a = series[i] - mean;
        const b = series[i - lag] - mean;
        sum += a * b;
        normA += a * a;
        normB += b * b;
      }
      if (!(normA > 0 && normB > 0)) continue;
      const corr = sum / Math.sqrt(normA * normB);
      if (!Number.isFinite(corr)) continue;

      const score = corr;
      if (score > bestScore) {
        secondScore = bestScore;
        bestScore = score;
        bestBpm = bpm;
      } else if (score > secondScore) {
        secondScore = score;
      }
    }

    if (!(bestScore > 0) || !(bestBpm > 0)) {
      onsetTempoCachedBpm = 0;
      onsetTempoCachedConfidence = 0;
      onsetTempoCachedAt = Number.isFinite(ts) ? ts : Date.now();
      return { bpm: 0, confidence: 0 };
    }

    const margin = Math.max(0, bestScore - Math.max(0, secondScore));
    const confidence = clamp(bestScore * 0.65 + margin * 0.9, 0, 1);
    const percussiveEvidence = clamp(
      audioTransient * 0.52 +
      audioFlux * 0.34 +
      audioBandLow * 0.24,
      0,
      1
    );
    let resolvedBpm = bestBpm;
    if (bestBpm < 112 && (bestBpm * 2) <= ONSET_TEMPO_MAX_BPM) {
      const doubledBpm = bestBpm * 2;
      const doubledLag = Math.round((60000 / doubledBpm) / frameMs);
      if (doubledLag >= 2 && doubledLag < (len - 6)) {
        let sum = 0;
        let normA = 0;
        let normB = 0;
        for (let i = doubledLag; i < len; i += 1) {
          const a = series[i] - mean;
          const b = series[i - doubledLag] - mean;
          sum += a * b;
          normA += a * a;
          normB += b * b;
        }
        if (normA > 0 && normB > 0) {
          const doubledCorr = sum / Math.sqrt(normA * normB);
          const promote = (
            doubledCorr >= (bestScore * 0.84) &&
            bestScore >= 0.08 &&
            doubledCorr >= 0.07 &&
            percussiveEvidence >= 0.22
          );
          if (promote) {
            resolvedBpm = doubledBpm;
          }
        }
      }
    }

    onsetTempoCachedBpm = resolvedBpm;
    onsetTempoCachedConfidence = confidence;
    onsetTempoCachedAt = Number.isFinite(ts) ? ts : Date.now();
    return { bpm: resolvedBpm, confidence };
  }

  function resolveBeatBpmHint() {
    const onsetTempo = estimateOnsetTempoBpm();
    const onsetBpm = clamp(Number(onsetTempo.bpm || 0), 0, 190);
    const onsetConfidence = clamp(Number(onsetTempo.confidence || 0), 0, 1);
    const liveBpmRaw = Number(telemetry.bpm || 0);
    const liveConfidence = clamp(Number(telemetry.beatConfidence || 0), 0, 1);
    let hint = liveBpmRaw > 0 ? clamp(liveBpmRaw, 55, 190) : 120;
    if (beatIntervals.length >= 3) {
      const estimate = estimateBpm();
      if (estimate > 0) {
        const weight = liveBpmRaw > 0
          ? clamp(0.36 + (1 - liveConfidence) * 0.2, 0.36, 0.62)
          : 0.68;
        hint = clamp(lerp(hint, estimate, weight), 55, 190);
      }
    }
    if (onsetBpm > 0) {
      const onsetWeight = clamp(0.06 + onsetConfidence * 0.72, 0.06, 0.78);
      hint = clamp(lerp(hint, onsetBpm, onsetWeight), 55, 190);
    }
    if (liveBpmRaw > 0 && liveConfidence >= 0.2) {
      const liveBpm = clamp(liveBpmRaw, 55, 190);
      const liveWeight = clamp(0.42 + liveConfidence * 0.38, 0.42, 0.8);
      hint = clamp(lerp(hint, liveBpm, liveWeight), 55, 190);
    }
    const resolved = clamp(hint, 55, 190);
    telemetry.onsetTempoBpm = onsetBpm;
    telemetry.onsetTempoConfidence = onsetConfidence;
    telemetry.beatHintBpm = resolved;
    return resolved;
  }

  function normalizeBeatIntervalForBpm(intervalMs, gapScale = 1) {
    const safeInterval = Number(intervalMs);
    if (!Number.isFinite(safeInterval) || safeInterval <= 0) return 0;
    const _safeScale = Number.isFinite(gapScale) ? clamp(gapScale, 0.35, 1.15) : 1;

    const bpmHint = resolveBeatBpmHint();
    const onsetTempo = estimateOnsetTempoBpm();
    const onsetBpm = clamp(Number(onsetTempo.bpm || 0), 0, 190);
    const onsetConfidence = clamp(Number(onsetTempo.confidence || 0), 0, 1);
    const currentBpm = clamp(Number(telemetry.bpm || 0), 0, 190);
    const raw = getRawMusicBody();
    const highTempoIntent = clamp(
      raw.drums * 0.62 +
      audioTransient * 0.2 +
      audioFlux * 0.14 +
      Number(telemetry.beatConfidence || 0) * 0.08,
      0,
      1
    );
    const candidates = [];
    const pushCandidate = value => {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return;
      if (n < BPM_INTERVAL_MIN_MS * 0.7 || n > BPM_INTERVAL_MAX_MS * 1.3) return;
      const near = candidates.some(existing => Math.abs(existing - n) <= 6);
      if (!near) candidates.push(n);
    };
    const ratios = [0.5, 2 / 3, 0.75, 5 / 6, 1, 6 / 5, 4 / 3, 1.5, 2];
    const normalizedBase = safeInterval / _safeScale;
    [safeInterval, normalizedBase].forEach(base => {
      for (const ratio of ratios) {
        pushCandidate(base * ratio);
      }
    });
    let bestInterval = safeInterval;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidateInterval of candidates) {
      if (!Number.isFinite(candidateInterval) || candidateInterval <= 0) continue;
      const candidateBpm = 60000 / candidateInterval;
      if (!Number.isFinite(candidateBpm) || candidateBpm <= 0) continue;
      const intervalDrift = Math.abs(Math.log2(candidateInterval / safeInterval));
      let score = Math.abs(candidateBpm - bpmHint) * 0.86;
      score += intervalDrift * 2.2;
      if (onsetBpm > 0) {
        score += Math.abs(candidateBpm - onsetBpm) * (0.34 - onsetConfidence * 0.2);
      }
      if (candidateBpm > 190) score += (candidateBpm - 190) * 2;
      else if (candidateBpm > 182) score += (candidateBpm - 182) * 0.75;
      if (candidateBpm < 58) score += (58 - candidateBpm) * 1.2;
      if (currentBpm > 0) {
        const currentDelta = Math.abs(candidateBpm - currentBpm);
        score += Math.min(currentDelta, 18) * 0.05 + Math.max(0, currentDelta - 18) * 0.018;
      }
      if (highTempoIntent > 0.56 && candidateBpm >= 146 && candidateBpm <= 182) {
        score -= (highTempoIntent - 0.56) * 24;
      }
      if (highTempoIntent > 0.62 && candidateBpm < 120) {
        score += (120 - candidateBpm) * 0.22;
      }
      if (candidateInterval < BPM_INTERVAL_MIN_MS) {
        score += (BPM_INTERVAL_MIN_MS - candidateInterval) / 24;
      }
      if (score < bestScore) {
        bestScore = score;
        bestInterval = candidateInterval;
      }
    }
    return bestInterval;
  }

  function estimateBpm() {
    if (!beatIntervals.length) return 0;
    const sorted = [...beatIntervals].sort((a, b) => a - b);
    const center = sorted.slice(1, Math.max(2, sorted.length - 1));
    const avg = center.reduce((sum, n) => sum + n, 0) / Math.max(1, center.length);
    const median = sorted[Math.floor(sorted.length / 2)];
    const blendedInterval = (Number.isFinite(median) && median > 0)
      ? (median * 0.72 + avg * 0.28)
      : avg;
    if (!Number.isFinite(blendedInterval) || blendedInterval <= 0) return 0;
    const rawBpm = clamp(60000 / blendedInterval, 55, 190);
    const onsetTempo = estimateOnsetTempoBpm();
    const onsetBpm = clamp(Number(onsetTempo.bpm || 0), 0, 190);
    const onsetConfidence = clamp(Number(onsetTempo.confidence || 0), 0, 1);
    const currentBpm = clamp(Number(telemetry.bpm || 0), 0, 190);
    const raw = getRawMusicBody();
    const highTempoIntent = clamp(
      raw.drums * 0.62 +
      audioTransient * 0.22 +
      audioFlux * 0.16,
      0,
      1
    );
    const ratios = [0.5, 2 / 3, 0.75, 5 / 6, 1, 6 / 5, 4 / 3, 1.5, 2];
    let best = rawBpm;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const ratio of ratios) {
      const candidate = rawBpm * ratio;
      if (!(candidate >= 55 && candidate <= 190)) continue;
      const ratioPenalty = Math.abs(Math.log2(ratio)) * 1.45;
      let score = ratioPenalty;
      if (onsetBpm > 0) {
        score += Math.abs(candidate - onsetBpm) * (0.3 - onsetConfidence * 0.22);
      }
      if (currentBpm > 0) {
        score += Math.abs(candidate - currentBpm) * 0.085;
      }
      score += Math.abs(candidate - rawBpm) * 0.16;
      if (highTempoIntent > 0.56 && candidate >= 146 && candidate <= 182) {
        score -= (highTempoIntent - 0.56) * 22;
      }
      if (highTempoIntent > 0.6 && candidate < 118) {
        score += (118 - candidate) * 0.18;
      }
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    if (best < 108 && (best * 2) <= 190) {
      const doubled = best * 2;
      const onsetSupportsDouble = onsetBpm > 0 && Math.abs(onsetBpm - doubled) <= 16;
      const hintBpm = clamp(Number(telemetry.beatHintBpm || 0), 0, 190);
      const hintSupportsDouble = hintBpm > 0 && Math.abs(hintBpm - doubled) <= 18;
      const promoteScore = clamp(
        (onsetSupportsDouble ? 0.56 : 0) +
        (hintSupportsDouble ? 0.24 : 0) +
        onsetConfidence * 0.18 +
        (onsetSupportsDouble ? 0.24 : 0) +
        (currentBpm >= 138 ? 0.12 : 0) +
        (beatIntervals.length >= 5 ? 0.08 : 0),
        0,
        1
      );
      if (promoteScore >= 0.58) {
        best = doubled;
      }
    }
    if (onsetBpm >= 150 && onsetConfidence >= 0.2 && best < (onsetBpm * 0.94)) {
      const liftWeight = clamp(
        0.08 +
        onsetConfidence * 0.34 +
        highTempoIntent * 0.22,
        0.08,
        0.72
      );
      best = lerp(best, onsetBpm, liftWeight);
    }
    return clamp(best, 55, 190);
  }

  function stabilizeBpmEstimate(rawBpm) {
    const baseCandidate = clamp(Number(rawBpm || 0), 0, 190);
    if (!(baseCandidate > 0)) return 0;

    const previousBpm = clamp(Number(telemetry.bpm || 0), 0, 190);
    if (!(previousBpm > 0)) return baseCandidate;

    let candidateBpm = baseCandidate;
    const liveBeatConfidence = clamp(Number(telemetry.beatConfidence || 0), 0, 1);
    const stabilizerPercussiveEvidence = clamp(
      audioTransient * 0.48 +
      audioFlux * 0.32 +
      audioBandLow * 0.2,
      0,
      1
    );
    const onsetTempo = estimateOnsetTempoBpm();
    const onsetBpm = clamp(Number(onsetTempo.bpm || 0), 0, 190);
    const onsetConfidence = clamp(Number(onsetTempo.confidence || 0), 0, 1);
    const forceLowTempoInterpretation =
      onsetBpm > 0 &&
      onsetBpm <= 115 &&
      onsetConfidence >= 0.24 &&
      stabilizerPercussiveEvidence < 0.24 &&
      previousBpm >= 138;

    if (forceLowTempoInterpretation && candidateBpm > 120) {
      candidateBpm = clamp(candidateBpm * 0.5, 55, 190);
    }

    if (
      candidateBpm < (previousBpm * 0.72) &&
      liveBeatConfidence >= 0.82 &&
      candidateBpm >= 96 &&
      stabilizerPercussiveEvidence >= 0.22
    ) {
      const doubled = candidateBpm * 2;
      if (doubled <= 190 && Math.abs(doubled - previousBpm) < Math.abs(candidateBpm - previousBpm)) {
        candidateBpm = doubled;
      }
    }

    const harmonicCandidates = forceLowTempoInterpretation
      ? [candidateBpm, candidateBpm / 2, candidateBpm * (2 / 3)]
      : [candidateBpm, candidateBpm * 2, candidateBpm / 2, candidateBpm * 1.5, candidateBpm * (2 / 3)];
    const filteredCandidates = harmonicCandidates.filter(value => value >= 55 && value <= 190);

    let best = candidateBpm;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const option of filteredCandidates) {
      const continuityPenalty = Math.abs(Math.log2(option / previousBpm)) * 16;
      const onsetPenalty = onsetBpm > 0
        ? Math.abs(option - onsetBpm) * (0.18 - onsetConfidence * 0.1)
        : 0;
      const driftPenalty = Math.abs(option - candidateBpm) * 0.11;
      const score = continuityPenalty + onsetPenalty + driftPenalty;
      if (score < bestScore) {
        bestScore = score;
        best = option;
      }
    }

    const jumpRatio = Math.abs(best - previousBpm) / Math.max(1, previousBpm);
    const alpha = jumpRatio > 0.34 ? 0.24 : (jumpRatio > 0.18 ? 0.36 : 0.5);
    return clamp(lerp(previousBpm, best, alpha), 55, 190);
  }

  function registerBeat(now, options = {}) {
    const gp = getGenreAudioProfile();
    const rawGapScale = Number(options?.gapScale ?? 1);
    const gapScale = Number.isFinite(rawGapScale)
      ? clamp(rawGapScale, 0.35, 1.15)
      : 1;
    let normalizedIntervalMs = 0;
    if (lastBeatTime > 0) {
      const interval = now - lastBeatTime;
      normalizedIntervalMs = normalizeBeatIntervalForBpm(interval, gapScale);
      if (normalizedIntervalMs >= BPM_INTERVAL_MIN_MS && normalizedIntervalMs <= BPM_INTERVAL_MAX_MS) {
        beatIntervals.push(normalizedIntervalMs);
        if (beatIntervals.length > 16) beatIntervals.shift();
      }
    }

    const bpm = stabilizeBpmEstimate(estimateBpm());
    telemetry.bpm = bpm;
    telemetry.beatIntervalMs = lastBeatTime > 0 ? normalizedIntervalMs : 0;

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
      registerBeat(now, { gapScale: 1 });
      return true;
    }

    const onsetTempo = estimateOnsetTempoBpm(now);
    const onsetBpm = clamp(Number(onsetTempo.bpm || 0), 0, 190);
    const bpmHint = resolveBeatBpmHint();
    const bpmForGap = telemetry.bpm > 0
      ? telemetry.bpm
      : (onsetBpm > 0 ? onsetBpm : bpmHint);
    const beatGapScaleBase = bpmForGap >= 152
      ? 0.58
      : (bpmForGap >= 132 ? 0.5 : 0.4);
    const beatGapScale = clamp(
      beatGapScaleBase +
      (audioTransient * 0.04) -
      (audioFlux * 0.02),
      0.42,
      0.66
    );
    const predictedMs = clamp((60000 / bpmForGap) * beatGapScale, 128, 520);
    const raw = getRawMusicBody();

    const gap = now - lastBeatTime;
    if (gap < predictedMs) return false;

    const modeBase = gp.beatBaseInterpret;
    const transientLower = clamp(
      audioTransient * gp.beatTransientLower + audioFlux * gp.beatFluxLower,
      0,
      gp.beatLowerCap
    );
    const beatThresholdBias = clamp(Number(genreRef.beatThresholdBias || 0), -0.05, 0.06);
    const threshold = clamp(modeBase - transientLower + beatThresholdBias, 0.18, 0.39);

    const overdueRatio = clamp((gap - predictedMs) / Math.max(1, predictedMs), 0, 3);
    const overdueRiseLift = clamp(
      overdueRatio * (0.01 + audioTransient * 0.08 + audioFlux * 0.06),
      0,
      0.14
    );
    const effectiveThreshold = clamp(
      threshold - (overdueRatio * 0.04),
      0.16,
      0.39
    );
    const percussionSupport = clamp(
      audioBandLow * 1.15 + audioTransient * 0.6 + audioFlux * 0.45,
      0,
      1
    );
    const vocalDominance = clamp(
      audioBandMid - Math.max(audioBandLow * 0.9, audioBandHigh * 0.95),
      0,
      1
    );
    const vocalPenalty = vocalDominance * (1 - percussionSupport) * 0.02;
    const motionRiseLift = clamp(
      audioTransient * 0.2 +
      audioFlux * 0.06 +
      Math.max(0, audioBandLow - 0.22) * 0.03 -
      vocalPenalty,
      0,
      0.05
    );
    const rise = (energy - beatEnergyAtLast) + overdueRiseLift + motionRiseLift;
    const beatRiseBias = clamp(Number(genreRef.beatRiseBias || 0), -0.004, 0.006);
    const riseGate = clamp(
      gp.beatRiseBase - audioTransient * gp.beatRiseTransient - audioFlux * gp.beatRiseFlux + beatRiseBias,
      gp.beatRiseMin,
      gp.beatRiseMax + 0.004
    );
    const effectiveRiseGate = clamp(
      riseGate - (overdueRatio * 0.01),
      gp.beatRiseMin * 0.38,
      gp.beatRiseMax + 0.004
    );

    const percussiveFastHit = (
      gap >= Math.max(138, predictedMs * 0.72) &&
      raw.drums > 0.26 &&
      (audioTransient > 0.15 || audioFlux > 0.13) &&
      energy > (effectiveThreshold * 0.9)
    );
    if (percussiveFastHit) {
      registerBeat(now, { gapScale: beatGapScale });
      return true;
    }

    const pulseEvidence = clamp(
      audioTransient * 0.52 +
      audioFlux * 0.34 +
      raw.drums * 0.22 +
      audioBandLow * 0.18,
      0,
      1
    );
    const fallbackGapFactor = bpmForGap >= 145 ? 2.45 : (bpmForGap >= 120 ? 2.15 : 1.85);
    const fallbackEvidenceGate = bpmForGap >= 145 ? 0.24 : (bpmForGap >= 120 ? 0.2 : 0.15);
    const overdueFallbackHit = (
      gap >= (predictedMs * fallbackGapFactor) &&
      pulseEvidence >= fallbackEvidenceGate &&
      audioRms >= 0.01
    );
    if (overdueFallbackHit) {
      registerBeat(now, { gapScale: beatGapScale });
      return true;
    }

    if (energy > effectiveThreshold && rise > effectiveRiseGate) {
      registerBeat(now, { gapScale: beatGapScale });
      return true;
    }
    return false;
  }

  function refreshBeatTelemetryBetweenHits(now) {
    if (!(lastBeatTime > 0)) return;

    const beatAgeMs = Math.max(0, now - lastBeatTime);
    telemetry.beatIntervalMs = beatAgeMs;

    const bpm = Number(telemetry.bpm || 0);
    if (!(bpm > 0)) {
      telemetry.beatConfidence = clamp(Number(telemetry.beatConfidence || 0) * 0.985, 0, 1);
      return;
    }

    const expectedMs = clamp(60000 / bpm, 220, 2000);
    const overdueMs = Math.max(0, beatAgeMs - expectedMs);
    const staleRatio = clamp(overdueMs / (expectedMs * 1.5), 0, 1);
    const confidenceCeil = clamp(1 - staleRatio, 0, 1);
    telemetry.beatConfidence = clamp(
      Math.min(Number(telemetry.beatConfidence || 0), confidenceCeil),
      0,
      1
    );
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
    const raw = getRawMusicBody();
    const motion = Math.max(
      audioTransient,
      audioFlux,
      Number(telemetry.beatConfidence || 0),
      raw.drums * 0.88,
      raw.body * 0.72
    );

    let idleT = 0.08 - (mem.idle - 1) * 0.01;
    let flowT = 0.25 - (mem.flow - 1) * 0.015;
    idleT += Number(genreRef.idleOffset || 0);
    flowT += Number(genreRef.flowOffset || 0);
    idleT += modeBias.idleThresholdBias;
    flowT += modeBias.flowThresholdBias;
    idleT += Number(autoSwitch.idleThresholdBias || 0);
    flowT += Number(autoSwitch.flowThresholdBias || 0);
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

    const forcePulseFluxGate = clamp(
      Number(gp.forcePulseFlux || 0) + Number(autoSwitch.forcePulseFluxBias || 0),
      0.06,
      0.72
    );
    const forcePulseEnergyGate = clamp(
      Number(gp.forcePulseEnergy || 0) + Number(autoSwitch.forcePulseEnergyBias || 0),
      0.06,
      0.68
    );
    if (audioFlux > forcePulseFluxGate && energy > forcePulseEnergyGate) {
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
    const heavyPromoteScale = clamp(
      Number(autoSwitch.heavyPromoteScale || 1),
      0.72,
      1.34
    );
    const heavyEnergyGate = clamp(
      Number(genreRef.heavyPromoteEnergy ?? 0.32) * heavyPromoteScale,
      0.2,
      0.6
    );
    const heavyTransientGate = clamp(
      Number(genreRef.heavyPromoteTransient ?? 0.22) * heavyPromoteScale,
      0.1,
      0.35
    );
    const heavyFluxGate = clamp(
      Number(genreRef.heavyPromoteFlux ?? 0.2) * heavyPromoteScale,
      0.08,
      0.35
    );
    const heavyMotionGate = clamp(
      Number(genreRef.heavyPromoteMotion ?? 0.52) * heavyPromoteScale,
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

    // Keep pulse selective: if beat confidence is high but motion/body support is weak,
    // prefer FLOW to avoid over-strobing.
    if (!telemetry.drop && desired === "pulse") {
      const beatConfidence = Number(telemetry.beatConfidence || 0);
      const pulseEntryEnergyGate = clamp(
        Number(genreRef.pulseEntryEnergy ?? 0.5) + Number(autoSwitch.pulseEntryEnergyBias || 0),
        0.34,
        0.72
      );
      const pulseEntryMotionGate = clamp(
        Number(genreRef.pulseEntryMotion ?? 0.58) + Number(autoSwitch.motionGateBias || 0),
        0.34,
        0.86
      );
      const strongBuild = telemetry.phrase === "build";
      const strongBeat = beatConfidence > 0.78 && (audioTransient > 0.2 || audioFlux > 0.2);
      const strongBody = audioBandLow > 0.62 && energy > pulseEntryEnergyGate;
      if (
        !strongBuild &&
        !strongBeat &&
        !strongBody &&
        (energy < pulseEntryEnergyGate || motion < pulseEntryMotionGate)
      ) {
        desired = "flow";
      }
    }

    if (!telemetry.drop) {
      const idleFloor = overclockLevel >= 3 ? 0.16 : 0.12;
      const basePulseFloor =
        (overclockLevel >= 3 ? 0.48 : 0.42) +
        Number(genreRef.pulseFloorOffset || 0) +
        Number(autoSwitch.pulseFloorBias || 0);
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
      const quietGuardScale = clamp(
        Number(autoSwitch.quietGuardScale || 1),
        0.72,
        1.3
      );
      const quietRmsGate = clamp(Number(genreRef.quietRmsGate ?? 0.12) * quietGuardScale, 0.06, 0.24);
      const quietTransientGate = clamp(Number(genreRef.quietTransientGate ?? 0.16) * quietGuardScale, 0.08, 0.28);
      const quietFluxGate = clamp(Number(genreRef.quietFluxGate ?? 0.14) * quietGuardScale, 0.08, 0.26);
      const quietAudio =
        audio < quietRmsGate &&
        audioTransient < quietTransientGate &&
        audioFlux < quietFluxGate &&
        raw.body < (quietRmsGate * 1.28) &&
        raw.drums < (quietTransientGate * 1.34);
      if (quietAudio) {
        if (drive < 0.1) desired = "idle";
        else if (desired === "pulse") desired = "flow";
      } else if (desired === "idle") {
        // Beat trackers can briefly drop to near-zero on some mixes while body audio remains present.
        // In that case, prefer FLOW over IDLE to avoid visual "stall" states.
        const beatConfidence = Number(telemetry.beatConfidence || 0);
        const bodySignal = Math.max(
          audio,
          audioBandLow * 0.84,
          audioBandMid * 0.94,
          energy * 0.78,
          raw.body * 0.92,
          raw.drums * 0.98
        );
        const bodyPresent =
          bodySignal >= (quietRmsGate * 0.94) &&
          (
            audioBandLow >= 0.2 ||
            audioBandMid >= 0.2 ||
            raw.body >= (quietRmsGate * 1.02) ||
            raw.drums >= (quietTransientGate * 0.88) ||
            audioTransient >= (quietTransientGate * 0.72) ||
            audioFlux >= (quietFluxGate * 0.72)
          );
        if (beatConfidence < 0.16 && drive >= 0.12 && bodyPresent) {
          desired = "flow";
        }
      }
    }

    // Pulse must be justified by musical motion; otherwise stay in flow/idle.
    if (desired === "pulse" && !telemetry.drop) {
      const motionGateBias = Number(autoSwitch.motionGateBias || 0);
      const motionBeatGate = clamp(
        Number(genreRef.motionBeatConfidence ?? 0.44) + motionGateBias,
        0.24,
        0.68
      );
      const motionTransientGate = clamp(
        Number(genreRef.motionTransient ?? 0.18) + motionGateBias + 0.012,
        0.11,
        0.34
      );
      const motionFluxGate = clamp(
        Number(genreRef.motionFlux ?? 0.18) + motionGateBias + 0.018,
        0.1,
        0.32
      );
      const beatConfidence = Number(telemetry.beatConfidence || 0);
      const beatDrivenMotion =
        isFinite(beatConfidence) &&
        beatConfidence > motionBeatGate &&
        (
          audioTransient > (motionTransientGate * 0.72) ||
          audioFlux > (motionFluxGate * 0.95) ||
          (audioBandLow > 0.62 && energy > (flowT - 0.02))
        );
      const buildDrivenMotion =
        telemetry.phrase === "build" &&
        (
          audioTransient > (motionTransientGate * 0.78) ||
          audioFlux > (motionFluxGate * 0.9) ||
          audioBandLow > 0.58
        );
      const pulseMotion =
        buildDrivenMotion ||
        beatDrivenMotion ||
        raw.drums > (motionTransientGate * 0.9) ||
        audioTransient > motionTransientGate ||
        audioFlux > motionFluxGate;

      if (!pulseMotion) {
        desired = drive < 0.12 ? "idle" : "flow";
      }
    }

    const emergencyDemotePulse = !telemetry.drop &&
      stableBehavior === "pulse" &&
      desired !== "pulse" &&
      drive < (
        (overclockLevel >= 3 ? 0.38 : 0.34) +
        Number(autoSwitch.demoteDriveBias || 0)
      );

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
      (motion > 0.72 && drive > 0.44);
    const behaviorHoldBaseMs = fastBehaviorSwitch
      ? Math.round(autoSwitch.behaviorMinHoldMs * 0.4)
      : autoSwitch.behaviorMinHoldMs;
    const behaviorConfirmBaseMs = fastBehaviorSwitch
      ? Math.round(autoSwitch.behaviorConfirmMs * 0.45)
      : autoSwitch.behaviorConfirmMs;
    const behaviorHoldMs = Math.round(behaviorHoldBaseMs * modeBias.behaviorHoldScale);
    const behaviorConfirmMs = Math.round(behaviorConfirmBaseMs * modeBias.behaviorConfirmScale);

    const pulseFlowFlip =
      (stableBehavior === "pulse" && desired === "flow") ||
      (stableBehavior === "flow" && desired === "pulse");
    const pulseFlowGuardMs =
      pulseFlowFlip && !telemetry.drop && telemetry.phrase !== "build"
        ? clamp(Math.round(autoSwitch.behaviorMinHoldMs * 0.78), 1200, 4200)
        : 0;

    if (now - lastBehaviorChangeAt < Math.max(behaviorHoldMs, pulseFlowGuardMs)) {
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

    const directDesired = behavior === "flow"
      ? resolveFlowScene(now)
      : (BEHAVIOR_SCENE_DEFAULTS[behavior] || "idle_soft");
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
    const maxFutureSkew = Math.max(interval * 2, 1200);
    if ((nextHueEmitAt - now) > maxFutureSkew) {
      nextHueEmitAt = now;
    }
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
    const manualPaletteConfig = getManualPaletteConfigForBrand("hue");
    const manualPalette = buildActiveManualPaletteSequence(manualPaletteConfig);
    const manualPaletteActive = Array.isArray(manualPalette) && manualPalette.length > 0;

    let hue, bri, transition;
    const satFloor = sceneName === "idle_soft"
      ? 176
      : (sceneName.startsWith("flow_") ? 192 : 236);
    const satMotionLift = Math.round(
      clamp(audioTransient * 0.56 + audioFlux * 0.44, 0, 1) * 14
    );
    const satEventLift = (isBeat ? 5 : 0) + (telemetry.drop ? 10 : 0);
    let sat = clamp(
      Math.round(Math.max(scene.sat, satFloor) + satMotionLift + satEventLift),
      0,
      254
    );

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
      const silenceSignal = clamp(
        Math.max(
          audio * 0.9,
          audioTransient * 0.82,
          audioFlux * 0.78,
          Number(telemetry.beatConfidence || 0) * 0.7
        ),
        0,
        1
      );
      const calmHold = clamp(
        (CALM_SILENCE_THRESHOLD - silenceSignal) / CALM_SILENCE_THRESHOLD,
        0,
        1
      );
      const scaledMotion = clamp(motion * flowMotionScale * (1 - calmHold * 0.36), 0, 1);
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
        const step = stepBase * (1 + scaledMotion * 1.35) * flowHueScale * (1 - calmHold * 0.42);
        const reactiveWarp = (
          Math.sin(now / 42 + phase * 0.66) * (180 + scaledMotion * 1180) +
          Math.sin(now / 68 + audioBandLow * 6.28) * (90 + audioBandLow * 520) +
          Math.sin(now / 56 + audioBandHigh * 5.1) * (70 + audioBandHigh * 470)
        ) * flowHueScale * (1 - calmHold * 0.55);
        hue = (
          anchor +
          Math.sin(phase * 0.33) * swing +
          Math.sin(phase * 0.11 + now / 1000) * micro +
          Math.sin(now / Math.max(40, scene.hueTimeDiv) * 0.2) * drift +
          phase * step +
          reactiveWarp
        ) % 65535;
      } else {
        const step = scene.hueStep * (1 + scaledMotion * 1.35) * flowHueScale * (1 - calmHold * 0.42);
        hue = (
          (now / scene.hueTimeDiv) +
          Math.sin(phase * 0.35) * scene.hueSwing +
          phase * step +
          Math.sin(now / 44 + phase * 0.62) * (180 + scaledMotion * 1100) * flowHueScale * (1 - calmHold * 0.55)
        ) % 65535;
      }
      if (hue < 0) hue += 65535;
      const motionLift = (
        scaledMotion * (10 + (scene.beatLift || 10) * 0.85) +
        Math.max(0, drive - 0.2) * 18
      ) * flowLiftScale * (1 - calmHold * 0.25);
      const reactiveWave = Math.sin(phase * (0.38 + scaledMotion * 0.34) + audioFlux * 2.5) *
        (scene.briWave * (0.7 + scaledMotion * 0.9) * flowWaveScale);
      const dynamicBriMin = clamp(
        (scene.briMin || 110) - Math.round(calmHold * 52),
        40,
        254
      );
      const dynamicBriMax = clamp(
        (scene.briMax || 225) + Math.round(scaledMotion * 18) + (telemetry.drop ? 10 : 0),
        dynamicBriMin + 10,
        254
      );
      bri = clamp(
        scene.briBase +
        energy * scene.briScale +
        reactiveWave +
        beatLift +
        dropLift +
        motionLift,
        dynamicBriMin,
        dynamicBriMax
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
      const pulseMin = telemetry.drop ? 132 : 108;
      bri = clamp(scene.briBase + energy * scene.briScale, pulseMin, 254);

      transition = telemetry.drop
        ? 1
        : (isBeat ? scene.transitionBeat : scene.transitionFree);

      reinforce(activeGenre, "pulse", telemetry.drop ? 0.08 : 0.02);
    }

    if (manualPaletteActive) {
      const len = Math.max(1, manualPalette.length);
      const resolved = resolveManualPaletteIndexForEmit("hue", hueColorIndex, len, manualPaletteConfig, {
        sceneName,
        isBeat,
        isDrop: telemetry.drop,
        triggerHint: Boolean(isBeat || telemetry.drop)
      });
      hueColorIndex = resolved.index;
      const paletteIndex = ((resolved.emitIndex % len) + len) % len;
      const paletteColor = manualPalette[paletteIndex];
      const hsv = rgbToHsv(paletteColor);
      hue = Math.round((hsv.h / 360) * 65535) % 65535;
      if (hue < 0) hue += 65535;
      sat = clamp(Math.round(hsv.s * 254), 0, 254);
    }
    const rawSignal = getRawMusicBody();
    const drumPulse = rawSignal.drums > 0.2 || (rawSignal.drums > 0.16 && rawSignal.body > 0.24);
    const hueForceDelta = sceneName.startsWith("flow_") || drumPulse;
    const hueDeltaScale = sceneName.startsWith("flow_")
      ? clamp(0.75 - rawSignal.drums * 0.22 - rawSignal.body * 0.12, 0.4, 0.9)
      : clamp(1 - rawSignal.drums * 0.3 - rawSignal.body * 0.18, 0.45, 1);
    const hueRateMs = drumPulse
      ? Math.min(interval, rawSignal.drums > 0.3 ? 170 : 200)
      : interval;

    controls.emit({
      type: "HUE_STATE",
      phase,
      energy,
      rateMs: hueRateMs,
      forceRate: overclockLevel >= 2,
      forceDelta: hueForceDelta,
      deltaScale: hueDeltaScale,
      state: {
        on: true,
        hue,
        sat,
        bri: applyEnergyBrightnessScale(bri),
        transitiontime: transition
      }
    });
  }

  function buildWizEmitterSignal(now, isBeat, sceneName) {
    const scene = String(sceneName || "idle_soft").trim().toLowerCase() || "idle_soft";
    const flowScene = scene.startsWith("flow_");
    const pulseScene = scene === "pulse_strobe";
    const isDrop = Boolean(telemetry.drop);
    const beatConfidence = clamp(Number(telemetry.beatConfidence || 0), 0, 1);
    const raw = getRawMusicBody();
    const drive = getEnergyDrive();
    const elapsedMs = lastWizEmit > 0 ? Math.max(1, now - lastWizEmit) : 16;
    const beatHalfLifeMs = pulseScene ? 170 : (flowScene ? 210 : 190);
    wizBeatPulse *= Math.pow(0.5, elapsedMs / beatHalfLifeMs);
    if (isDrop) {
      wizBeatPulse = Math.max(wizBeatPulse, 1);
      lastWizBeatAt = now;
      wizBeatStep = (wizBeatStep + 2) % 256;
    } else if (isBeat) {
      wizBeatPulse = Math.max(wizBeatPulse, 0.72 + (beatConfidence * 0.24));
      lastWizBeatAt = now;
      wizBeatStep = (wizBeatStep + 1) % 256;
    }
    wizBeatPulse = clamp(wizBeatPulse, 0, 1);
    const pulseRecentWindowMs = isDrop ? 230 : 170;
    const pulseRecent = lastWizBeatAt > 0 && (now - lastWizBeatAt) <= pulseRecentWindowMs;
    const pulseHit = Boolean(isDrop || isBeat || (pulseRecent && wizBeatPulse > 0.42));
    const motion = clamp(
      Math.max(
        audioTransient,
        audioFlux,
        beatConfidence,
        raw.drums * 0.92,
        raw.body * 0.72,
        wizBeatPulse * 0.88
      ),
      0,
      1.4
    );
    const silenceSignal = clamp(
      Math.max(
        audio * 0.9,
        raw.baseline * 0.92,
        raw.body * 0.88,
        raw.drums * 0.94,
        audioTransient * 0.82,
        audioFlux * 0.78,
        beatConfidence * 0.7
      ),
      0,
      1
    );
    const calmHold = clamp(
      (CALM_SILENCE_THRESHOLD - silenceSignal) / CALM_SILENCE_THRESHOLD,
      0,
      1
    );
    const phrase = String(telemetry.phrase || "").trim().toLowerCase();
    const build = phrase === "build";
    const targetHue = (
      (audioBandLow * 32) +
      (audioBandMid * 82) +
      (audioBandHigh * 176) +
      (wizBeatPulse * 28) +
      (isDrop ? 20 : 0) +
      ((scene.length * 7) % 30)
    ) % 360;
    const risk = clamp(
      (drive * 0.44) +
      (motion * 0.46) +
      (raw.drums * 0.12) +
      (wizBeatPulse * 0.34) +
      (isDrop ? 0.24 : 0) +
      (isBeat ? 0.14 : 0) +
      (build ? 0.1 : 0),
      0,
      1.8
    );
    return {
      now,
      scene,
      flowScene,
      pulseScene,
      isBeat: Boolean(isBeat),
      isDrop,
      beatConfidence,
      drive,
      motion,
      silenceSignal,
      calmHold,
      pulseHit,
      phrase,
      build,
      targetHue,
      risk,
      wizBeatPulse,
      rawDrums: raw.drums,
      rawBody: raw.body,
      rawActivity: raw.activity
    };
  }

  function resolveWizPaletteForEmit(sceneName) {
    const scene = String(sceneName || "idle_soft").trim().toLowerCase() || "idle_soft";
    const pulseScene = scene === "pulse_strobe";
    const manualPaletteConfig = getManualPaletteConfigForBrand("wiz");
    const manualPalette = buildActiveManualPaletteSequence(manualPaletteConfig);
    const manualPaletteActive = Array.isArray(manualPalette) && manualPalette.length > 0;
    let palette = manualPaletteActive
      ? tuneWizManualPalette(manualPalette, { pulseScene })
      : (WIZ_PALETTES[scene] || WIZ_PALETTES.idle_soft);
    if (!manualPaletteActive && pulseScene) {
      palette = WIZ_PULSE_PALETTES.auto;
    }
    if (!manualPaletteActive) {
      const paletteLength = Math.max(1, Array.isArray(palette) ? palette.length : 3);
      palette = normalizeWizContrastPalette(palette, pulseScene
        ? {
            targetLength: paletteLength,
            minSaturation: 0.94,
            minValue: 0.42,
            maxValue: 1,
            valueSwing: 0.26
          }
        : {
            targetLength: paletteLength,
            minSaturation: 0.9,
            minValue: 0.28,
            maxValue: 0.96,
            valueSwing: 0.2
          });
      palette = reorderPaletteForContrast(palette, true);
    }
    if (!Array.isArray(palette) || !palette.length) {
      palette = WIZ_PALETTES.idle_soft;
    }
    const safePalette = palette.map(color => ({
      r: clamp255(color?.r),
      g: clamp255(color?.g),
      b: clamp255(color?.b)
    }));
    return {
      scene,
      pulseScene,
      manualPaletteActive,
      manualPaletteConfig,
      palette: safePalette
    };
  }

  /* =========================
    WIZ EMITTER
  ========================= */
  function getWizPaletteAdvanceDecision(signal, intervalMs) {
    const sinceLastAdvance = lastWizPaletteAdvanceAt > 0
      ? Math.max(0, signal.now - lastWizPaletteAdvanceAt)
      : Number.POSITIVE_INFINITY;
    const cadenceFloorMs = signal.flowScene ? 70 : (signal.pulseScene ? 92 : 130);
    const cadenceCeilMs = signal.flowScene ? 420 : (signal.pulseScene ? 640 : 1100);
    let cadenceMs = (
      (signal.pulseScene ? 180 : (signal.flowScene ? 132 : 240)) +
      (signal.calmHold * (signal.pulseScene ? 250 : (signal.flowScene ? 190 : 560))) +
      (intervalMs * (signal.flowScene ? 0.66 : 0.94)) -
      (signal.motion * (signal.pulseScene ? 120 : (signal.flowScene ? 96 : 140))) -
      (signal.drive * (signal.flowScene ? 58 : 72))
    );
    cadenceMs = clamp(cadenceMs, cadenceFloorMs, cadenceCeilMs);
    const eventAdvance = signal.isDrop ||
      signal.isBeat ||
      signal.build ||
      (signal.pulseScene
        ? signal.pulseHit
        : (signal.wizBeatPulse > (signal.flowScene ? 0.58 : 0.66) && signal.beatConfidence > 0.4));
    const dueByCadence = sinceLastAdvance >= cadenceMs;
    const keepAliveAdvance = signal.flowScene
      ? (
        signal.motion > (0.16 + signal.calmHold * 0.14) &&
        sinceLastAdvance >= Math.max(90, cadenceMs * 0.58)
      )
      : (!signal.pulseScene && sinceLastAdvance >= Math.max(760, cadenceMs * 2.4));
    const hardLivenessAdvance = sinceLastAdvance >= (
      signal.flowScene
        ? 720
        : (signal.pulseScene ? 980 : 1400)
    );
    const shouldAdvance = Boolean(
      eventAdvance ||
      dueByCadence ||
      keepAliveAdvance ||
      hardLivenessAdvance
    );
    let step = 1;
    if (signal.isDrop) step += 1;
    else if (signal.isBeat && signal.motion > 0.52) step += 1;
    if (signal.build && !signal.flowScene) step += 1;
    if (signal.risk > 1.05 && signal.isBeat) step += 1;
    return {
      sinceLastAdvance,
      cadenceMs,
      eventAdvance,
      dueByCadence,
      keepAliveAdvance,
      hardLivenessAdvance,
      shouldAdvance,
      step: clamp(Math.round(step), 1, 4)
    };
  }

  function pickWizPaletteHueTargetIndex(palette, targetHue, fallbackIndex = 0) {
    if (!Array.isArray(palette) || !palette.length) return 0;
    let bestIndex = clamp(Math.round(Number(fallbackIndex) || 0), 0, Math.max(0, palette.length - 1));
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < palette.length; i += 1) {
      const hue = rgbToHsv(palette[i]).h;
      const distance = Math.abs((((hue - targetHue + 540) % 360) - 180));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  function computeWizBrightnessForEmit(now, signal) {
    const lowEndCue = clamp(
      (audioBandLow * 0.56) +
      (signal.beatConfidence * 0.22) +
      (signal.wizBeatPulse * 0.24),
      0,
      1.4
    );
    const rawBrightness = signal.flowScene
      ? clamp(
        getWizBrightness(now) * clamp(0.96 + flowIntensity * 0.08 + signal.wizBeatPulse * 0.04, 0.84, 1.2),
        0.01,
        1
      )
      : getWizBrightness(now);
    const flowBeatAccent = signal.flowScene
      ? (
        signal.isDrop
          ? 0.06
          : (signal.isBeat ? (0.03 + signal.beatConfidence * 0.02) : 0)
      )
      : 0;
    let brightnessTarget = clamp(
      rawBrightness +
      flowBeatAccent * 0.9 +
      (signal.wizBeatPulse * 0.06) +
      (signal.isDrop ? 0.08 : 0),
      0.01,
      1
    );
    if (signal.pulseScene) {
      const beatAgeMs = lastWizBeatAt > 0 ? (now - lastWizBeatAt) : Number.POSITIVE_INFINITY;
      const strobeWindowMs = signal.isDrop ? 220 : 150;
      const strobeActive = beatAgeMs <= strobeWindowMs || signal.wizBeatPulse > 0.62;
      const strobeFreqDiv = signal.isDrop ? 28 : 38;
      const strobeWave = 0.76 + (Math.sin((now / strobeFreqDiv) + (wizBeatStep * 0.42)) * 0.24);
      const pulseFloor = clamp(0.14 + signal.wizBeatPulse * 0.22 + (signal.isDrop ? 0.12 : 0), 0.12, 0.62);
      if (strobeActive) {
        brightnessTarget = clamp(Math.max(brightnessTarget, pulseFloor * 0.92) * strobeWave, 0.08, 1);
      } else {
        const settle = 0.78 + Math.sin(now / 160 + wizPhase * 0.2) * 0.12;
        brightnessTarget = clamp(Math.max(brightnessTarget, pulseFloor * 0.9) * settle, 0.1, 1);
      }
    }
    if (!(wizBrightnessSmoothed > 0)) wizBrightnessSmoothed = brightnessTarget;
    const brightnessBlend = signal.pulseScene
      ? (
        brightnessTarget >= wizBrightnessSmoothed
          ? clamp(0.3 + lowEndCue * 0.1 + (signal.isBeat ? 0.06 : 0), 0.24, 0.56)
          : clamp(0.2 + (1 - lowEndCue) * 0.08 + signal.calmHold * 0.03, 0.16, 0.36)
      )
      : (
        brightnessTarget >= wizBrightnessSmoothed
          ? clamp(0.24 + lowEndCue * 0.1 + (signal.isBeat ? 0.05 : 0), 0.2, 0.46)
          : clamp(0.14 + (1 - lowEndCue) * 0.09 + signal.calmHold * 0.05, 0.1, 0.3)
      );
    wizBrightnessSmoothed = lerp(wizBrightnessSmoothed, brightnessTarget, brightnessBlend);
    return clamp(wizBrightnessSmoothed, 0.01, 1);
  }

  function emitWiz(now, isBeat) {
    const interval = getWizIntervalMs();
    if (!nextWizEmitAt) nextWizEmitAt = now;
    const maxFutureSkew = Math.max(interval * 2, 1200);
    if ((nextWizEmitAt - now) > maxFutureSkew) {
      nextWizEmitAt = now;
    }
    if (now < nextWizEmitAt) return;

    nextWizEmitAt += interval;
    if (nextWizEmitAt < now - interval * 2) {
      nextWizEmitAt = now + interval;
    }

    const scene = resolveWizScene(now);
    telemetry.wizScene = scene;
    const signal = buildWizEmitterSignal(now, isBeat, scene);
    const paletteState = resolveWizPaletteForEmit(signal.scene);
    const manualPaletteActive = paletteState.manualPaletteActive;
    const manualPaletteConfig = paletteState.manualPaletteConfig;
    const palette = paletteState.palette;

    if (signal.scene !== lastWizScene) {
      if (!manualPaletteActive) {
        wizColorIndex = 0;
        wizColorCursor = 0;
        wizBeatStep = 0;
      } else {
        const manualLen = Math.max(1, palette.length);
        wizColorIndex = ((wizColorIndex % manualLen) + manualLen) % manualLen;
        wizColorCursor = wizColorIndex;
      }
      lastWizScene = signal.scene;
      lastWizPaletteAdvanceAt = now;
    }

    const advanceDecision = getWizPaletteAdvanceDecision(signal, interval);
    let color = palette[0] || { r: 255, g: 255, b: 255 };
    let paletteAdvanced = false;

    if (manualPaletteActive) {
      const len = Math.max(1, palette.length);
      const manualCycleMode = normalizeManualPaletteCycleMode(
        manualPaletteConfig.cycleMode,
        DEFAULT_MANUAL_PALETTE_CONFIG.cycleMode
      );
      const resolved = resolveManualPaletteIndexForEmit("wiz", wizColorIndex, len, manualPaletteConfig, {
        sceneName: signal.scene,
        isBeat: signal.isBeat,
        isDrop: signal.isDrop,
        triggerHint: manualCycleMode === "on_trigger"
          ? advanceDecision.shouldAdvance
          : false,
        advanceStep: manualCycleMode === "on_trigger"
          ? advanceDecision.step
          : 1
      });
      wizColorIndex = resolved.index;
      paletteAdvanced = Boolean(resolved.advanced);
      if (paletteAdvanced) {
        lastWizPaletteAdvanceAt = now;
      }
      const emitIndex = ((resolved.emitIndex % len) + len) % len;
      color = palette[emitIndex] || palette[0];
    } else if (signal.flowScene) {
      const len = Math.max(1, palette.length);
      const flowEnergy = clamp(flowIntensity, FLOW_INTENSITY_MIN, FLOW_INTENSITY_MAX);
      const flowSpeedScale = 0.62 + flowEnergy * 0.58;
      const flowTextureScale = 0.68 + flowEnergy * 0.62;
      const speedBase = (0.016 + signal.drive * 0.11 + signal.motion * 0.2 + signal.risk * 0.03) * flowSpeedScale;
      const phraseBoost = signal.build ? 0.03 : 0;
      const beatBoost = signal.isBeat ? (0.05 + signal.motion * 0.08 + signal.risk * 0.03) : 0;
      const dropBoost = signal.isDrop ? 0.1 : 0;
      const intervalScale = clamp(interval / 165, 0.5, 2.1);
      let step = Math.max(0.012, (speedBase + phraseBoost + beatBoost + dropBoost) * intervalScale * 0.44);
      if (!signal.isBeat && !signal.isDrop && signal.motion < 0.24) {
        step *= 0.55;
      }
      if (signal.isBeat && !signal.isDrop) {
        step += 0.045 + signal.motion * 0.03;
      } else if (signal.isDrop) {
        step += 0.09 + signal.motion * 0.05;
      }
      const flowStepFloor = signal.isDrop
        ? 0.056
        : (
          signal.isBeat
            ? 0.038
            : (signal.calmHold > 0.72 ? 0.028 : 0.018)
        );
      step = Math.max(step, flowStepFloor);
      wizColorCursor = (wizColorCursor + step) % len;

      const baseIdx = Math.floor(wizColorCursor) % len;
      const nextIdx = (baseIdx + 1) % len;
      const mixT = wizColorCursor - Math.floor(wizColorCursor);
      const crossfadeWindow = clamp(
        0.1 + signal.motion * 0.06 + (signal.isDrop ? 0.04 : 0),
        0.08,
        0.18
      );
      const steppedMixT = mixT <= (1 - crossfadeWindow)
        ? 0
        : clamp((mixT - (1 - crossfadeWindow)) / crossfadeWindow, 0, 1);
      const paletteBlend = blendColor(palette[baseIdx], palette[nextIdx], steppedMixT);
      const spectralColor = hsvToRgb255(
        signal.targetHue,
        1,
        clamp(0.84 + (signal.drive * 0.14) + (signal.wizBeatPulse * 0.12), 0.7, 1)
      );
      const spectralMix = clamp(
        0.03 +
        (signal.motion * 0.07) +
        (signal.wizBeatPulse * 0.1) +
        (signal.isDrop ? 0.08 : 0) -
        (signal.calmHold * 0.14),
        0.02,
        0.22
      );
      const baseColor = blendColor(paletteBlend, spectralColor, spectralMix);
      const texture = (
        2 +
        signal.motion * 6 +
        Math.max(0, signal.drive - 0.16) * 3 +
        signal.risk * 2
      ) * flowTextureScale;
      const waveR =
        Math.sin(now / 260 + wizColorCursor * 1.35 + audioBandHigh * 4.2) * texture +
        Math.sin(now / 760 + audioBandLow * 3.5) * (0.8 + signal.drive * 1.2);
      const waveG =
        Math.sin(now / 300 + wizColorCursor * 1.05 + audioBandMid * 2.6) * texture +
        Math.sin(now / 820 + audioBandHigh * 3.2) * (0.8 + signal.motion * 1.2);
      const waveB =
        Math.sin(now / 240 + wizColorCursor * 1.55 + audioBandLow * 3.8) * texture +
        Math.sin(now / 700 + audioBandMid * 2.2) * (0.8 + signal.drive * 1);

      color = {
        r: clamp255(baseColor.r + waveR),
        g: clamp255(baseColor.g + waveG),
        b: clamp255(baseColor.b + waveB)
      };
      paletteAdvanced = baseIdx !== wizColorIndex;
      wizColorIndex = baseIdx;
      if (paletteAdvanced || advanceDecision.shouldAdvance) {
        lastWizPaletteAdvanceAt = now;
      }
    } else {
      const len = Math.max(1, palette.length);
      if (advanceDecision.shouldAdvance && len > 1) {
        if (signal.pulseScene) {
          const beatDrivenIndex = (
            wizBeatStep +
            Math.round(signal.targetHue / 48) +
            (signal.isDrop ? 2 : 0)
          ) % len;
          if (signal.pulseHit) {
            if (signal.isDrop) {
              wizColorIndex = (beatDrivenIndex + 1) % len;
            } else if (beatDrivenIndex !== wizColorIndex) {
              wizColorIndex = beatDrivenIndex;
            } else {
              wizColorIndex = (wizColorIndex + 1) % len;
            }
          } else {
            wizColorIndex = (wizColorIndex + 1) % len;
          }
        } else {
          const beatDrivenIndex = (
            wizBeatStep +
            Math.round(signal.targetHue / 42) +
            (signal.isDrop ? 2 : 0)
          ) % len;
          const preferredIndex =
            (signal.isBeat || signal.isDrop || signal.wizBeatPulse > 0.62)
              ? beatDrivenIndex
              : pickWizPaletteHueTargetIndex(palette, signal.targetHue, wizColorIndex);
          if (preferredIndex !== wizColorIndex) {
            wizColorIndex = preferredIndex;
          } else {
            wizColorIndex = (wizColorIndex + advanceDecision.step) % len;
          }
        }
        paletteAdvanced = true;
        lastWizPaletteAdvanceAt = now;
      } else if (advanceDecision.shouldAdvance) {
        lastWizPaletteAdvanceAt = now;
      }
      const index = ((wizColorIndex % len) + len) % len;
      color = palette[index] || palette[0];
    }

    if (!manualPaletteActive) {
      const maxCh = Math.max(color.r, color.g, color.b);
      const minCh = Math.min(color.r, color.g, color.b);
      if (maxCh > 0 && (maxCh - minCh) < 16) {
        const fallbackHue = (
          (wizPhase * 53) +
          (signal.scene.length * 31) +
          (wizColorIndex * 47)
        ) % 360;
        const fallbackValue = clamp(maxCh / 255, 0.28, 1);
        color = hsvToRgb255(fallbackHue, 1, fallbackValue);
      }
    }

    const boostedColor = manualPaletteActive
      ? tunePaletteVibrancy(color, {
          satBoost: 0.28,
          minSat: 0.66,
          minValue: 0.24,
          maxValue: 1,
          preserveNeutralBelow: 0.06
        })
      : enforceMinSaturation(
          boostColorSaturation(color, 1),
          clamp(0.95 + (signal.wizBeatPulse * 0.04) + (signal.isDrop ? 0.03 : 0), 0.94, 1),
          clamp(0.26 + (signal.wizBeatPulse * 0.14), 0.2, 0.56)
        );
    const finalBrightness = computeWizBrightnessForEmit(now, signal);
    telemetry.wizBrightnessOut = clamp(finalBrightness, 0, 1);
    lastWizEmit = now;

    controls.emit({
      type: "WIZ_PULSE",
      phase: wizPhase++,
      energy,
      rateMs: signal.pulseScene
        ? Math.max(68, Math.round(interval * (signal.isDrop ? 0.86 : 1.12)))
        : Math.min(
          interval,
          signal.rawDrums > 0.24
            ? 110
            : (signal.rawActivity > 0.32 ? 128 : interval)
        ),
      forceRate: overclockLevel >= 3,
      forceDelta: signal.pulseScene
        ? signal.pulseHit
        : (
          signal.flowScene
            ? true
            : (
              signal.motion > 0.24 ||
              signal.wizBeatPulse > 0.46 ||
              signal.rawDrums > 0.2 ||
              signal.rawActivity > 0.3 ||
              paletteAdvanced ||
              advanceDecision.shouldAdvance
            )
        ),
      deltaScale: signal.pulseScene
        ? 1
        : (
          signal.flowScene
            ? clamp(0.9 - signal.motion * 0.24 - signal.rawDrums * 0.12, 0.4, 1)
            : clamp(1 - signal.rawDrums * 0.28 - signal.rawActivity * 0.14, 0.45, 1)
        ),
      beat: signal.isDrop || signal.isBeat,
      drop: signal.isDrop,
      scene: signal.scene,
      color: boostedColor,
      brightness: finalBrightness
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
      pushOnsetTempoSample(now);

      const isBeat = detectBeat(now);
      telemetry.beat = isBeat;
      if (!isBeat) {
        refreshBeatTelemetryBetweenHits(now);
      }

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

      forcedMode = "interpret";
      forcedScene = null;
      forcedSceneInput = null;
      telemetry.mode = "interpret";
      telemetry.modeLock = "interpret";

      audio = 0;
      audioRms = 0;
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
      hueColorIndex = 0;
      wizColorIndex = 0;
      wizColorCursor = 0;
      wizBeatStep = 0;
      lastWizPaletteAdvanceAt = 0;
      hueBrightnessSmoothed = 96;
      wizBrightnessSmoothed = 0.2;
      brightnessLevelFloorEma = 0.004;
      brightnessLevelCeilEma = 0.16;
      brightnessPresenceHold = 0;
      brightnessPercentSmoothed = BRIGHTNESS_TIER_MIN;
      brightnessDriveEma = 0;
      brightnessSilentFrames = 0;
      lastWizScene = null;
      for (const brandKey of MANUAL_PALETTE_SUPPORTED_BRANDS) {
        const cycleState = getManualPaletteCycleState(brandKey);
        if (!cycleState) continue;
        cycleState.index = 0;
        cycleState.colorOffset = 0;
        cycleState.fingerprint = "";
        cycleState.length = 0;
        cycleState.lastAdvanceAt = 0;
        cycleState.waitStartAt = 0;
        cycleState.lastSignal = null;
        cycleState.lastSpectrumIndex = 0;
      }
      overclockLevel = DEFAULT_OVERCLOCK_LEVEL;
      transportPressureEma = 0;
      transportPressureRaw = 0;
      transportPressureUpdatedAt = 0;
      energyTrend = 0;
      dropCooldown = 0;
      lastEnergy = 0;
      lastBeatTime = 0;
      beatIntervals = [];
      beatEnergyAtLast = 0;
      onsetTempoHistory = [];
      onsetTempoLastAt = 0;
      onsetTempoFrameMs = 16;
      onsetTempoPrevLow = 0;
      onsetTempoCachedBpm = 0;
      onsetTempoCachedConfidence = 0;
      onsetTempoCachedAt = 0;
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
      telemetry.brightnessTier = "silent";
      telemetry.brightnessPercent = BRIGHTNESS_TIER_MIN;
      telemetry.brightnessSourceLevel = 0;
      telemetry.hueBrightnessOut = 0;
      telemetry.wizBrightnessOut = 0;
      telemetry.intensity = 0;
      telemetry.rms = 0;
      telemetry.audioSourceLevel = 0;
      telemetry.audioRms = 0;
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
      telemetry.metaAutoIntentHz = telemetry.metaAutoHz;
      telemetry.metaAutoAppliedHz = telemetry.metaAutoHz;
      telemetry.metaAutoRangeLowPct = 0;
      telemetry.metaAutoRangeHighPct = 0;
      telemetry.metaAutoDominantTracker = getPrimaryMetaAutoTempoTracker(metaAutoTempoTrackers) || "baseline";
      telemetry.metaAutoDominantSwitches = 0;
      telemetry.metaAutoTempoBaselineBlend = metaAutoTempoBaselineBlend;
      telemetry.metaAutoTempoTrackersAuto = metaAutoTempoTrackersAuto === true;
      telemetry.metaAutoTempoTrackers = { ...metaAutoTempoTrackers };
      telemetry.metaAutoTempoTrackersActive = { ...metaAutoTempoTrackers };
      telemetry.metaAutoOverclock = overclockLevel;
      telemetry.metaAutoReason = metaAutoEnabled ? "armed" : "off";
      telemetry.overclockAutoEnabled = overclockAutoEnabled;
      telemetry.overclockAutoReason = overclockAutoEnabled ? "armed" : "off";
      telemetry.overclockAutoHz = META_AUTO_HZ_BY_LEVEL[clamp(overclockLevel, 0, MAX_OVERCLOCK_LEVEL)] || 2;
      telemetry.overclockAutoOverclock = overclockLevel;
      telemetry.transportPressure = 0;
      telemetry.transportPressureRaw = 0;
      telemetry.transportPressureAt = now;

      metaAutoLastEvalAt = 0;
      metaAutoLastAppliedAt = now - META_AUTO_TIMING.holdMs;
      metaAutoCandidate = snapshotMetaPlan("start");
      metaAutoCandidateSince = now;
      metaAutoGenreCandidate = metaAutoGenreStable;
      metaAutoGenreCandidateSince = now;
      metaAutoLastDropAt = 0;
      metaAutoLastChaosAt = 0;
      metaAutoLastTargetHz = META_AUTO_HZ_BY_LEVEL[clamp(overclockLevel, 0, MAX_OVERCLOCK_LEVEL)] || 2;
      metaAutoIntentHz = metaAutoLastTargetHz;
      metaAutoAppliedHz = metaAutoLastTargetHz;
      metaAutoRangeLowAnchor = 0.2;
      metaAutoRangeHighAnchor = 0.82;
      metaAutoRangeSamples = 0;
      metaAutoRangeLowHits = 0;
      metaAutoRangeHighHits = 0;
      metaAutoDominantSwitches = 0;
      metaAutoLastDominantTracker = telemetry.metaAutoDominantTracker;
      metaAutoDriveEma = 0;
      metaAutoMotionEma = 0;
      metaAutoIntensityEma = 0;
      metaAutoDrivePeak = 0;
      metaAutoMotionPeak = 0;
      metaAutoIntensityPeak = 0;
      metaAutoHeavySince = 0;
      metaAutoTempoBpmEma = 0;
      metaAutoRangeStallSince = 0;
      metaAutoRangeStallAnchorHz = 0;
      metaAutoRangeStallAnchorTempo = 0;
      metaAutoRangeStallAnchorDrive = 0;
      metaAutoRangeStallAnchorMotion = 0;
      resetMetaAutoTempoTrackerAutoState(metaAutoTempoTrackers);
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
    setIntent: setIntent,
    setOverclock: setOverclock,
    setTransportPressure(sample) {
      return setTransportPressure(sample);
    },
    getTransportPressure() {
      return readTransportPressure(Date.now());
    },

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
        if (lockedScene.startsWith("flow_")) {
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
        autoFlowCandidateScene = autoFlowStableScene;
        autoFlowCandidateSince = now;
        autoFlowLastChangeAt = now;
        console.log("[RAVE] scene released (AUTO)");
      }

      return true;
    },

    setBehavior(mode) {
      telemetry.mode = "interpret";
      forcedMode = "interpret";
      telemetry.modeLock = "interpret";
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

    setMetaAutoTempoBaselineBlend(enabled) {
      return setMetaAutoTempoBaselineBlend(enabled);
    },

    getMetaAutoTempoBaselineBlend() {
      return getMetaAutoTempoBaselineBlend();
    },

    setMetaAutoTempoTrackers(patch) {
      return setMetaAutoTempoTrackers(patch);
    },

    getMetaAutoTempoTrackers() {
      return getMetaAutoTempoTrackers();
    },

    setMetaAutoTempoTrackersAuto(enabled) {
      return setMetaAutoTempoTrackersAuto(enabled);
    },

    getMetaAutoTempoTrackersAuto() {
      return getMetaAutoTempoTrackersAuto();
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

    setPaletteConfig(patch) {
      return setManualPaletteConfig(patch);
    },

    getPaletteConfig(brandKey = null) {
      return getManualPaletteConfig(brandKey);
    },

    getPaletteCatalog() {
      return getManualPaletteCatalog();
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


 
