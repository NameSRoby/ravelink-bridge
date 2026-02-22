// [TITLE] Module: core/standalone/logic.js
// [TITLE] Purpose: standalone state normalization and animation logic

const { hsvToRgb255: convertHsvToRgb255 } = require("../utils/hsv-rgb");

module.exports = function createStandaloneLogic(options = {}) {
  const parseBoolean = typeof options.parseBoolean === "function"
    ? options.parseBoolean
    : ((value, fallback = false) => (value === undefined ? fallback : Boolean(value)));
  const getTelemetry = typeof options.getTelemetry === "function"
    ? options.getTelemetry
    : (() => ({}));
  const getAudioReactivityDrive = typeof options.getAudioReactivityDrive === "function"
    ? options.getAudioReactivityDrive
    : (() => ({ enabled: false, drive: 0, level: 0 }));

  const STANDALONE_SCENES = new Set(["sweep", "bounce", "pulse", "spark"]);
  const STANDALONE_SPEED_MODES = new Set(["fixed", "audio"]);
  const STANDALONE_COLOR_MODES = new Set(["hsv", "cct"]);

  function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function normalizeStandaloneScene(scene, fallback = "sweep") {
    const key = String(scene || "").trim().toLowerCase();
    if (STANDALONE_SCENES.has(key)) return key;
    return STANDALONE_SCENES.has(fallback) ? fallback : "sweep";
  }

  function normalizeStandaloneSpeedMode(mode, fallback = "fixed") {
    const key = String(mode || "").trim().toLowerCase();
    if (STANDALONE_SPEED_MODES.has(key)) return key;
    return STANDALONE_SPEED_MODES.has(fallback) ? fallback : "fixed";
  }

  function normalizeStandaloneColorMode(mode, fallback = "hsv") {
    const key = String(mode || "").trim().toLowerCase();
    if (STANDALONE_COLOR_MODES.has(key)) return key;
    return STANDALONE_COLOR_MODES.has(fallback) ? fallback : "hsv";
  }

  function normalizeStandaloneStateRanges(source, base, keyMin, keyMax, min, max, fallbackMin, fallbackMax) {
    const has = key => Object.prototype.hasOwnProperty.call(source, key);
    const nextMin = has(keyMin)
      ? clampNumber(source[keyMin], min, max, base[keyMin])
      : base[keyMin];
    const nextMax = has(keyMax)
      ? clampNumber(source[keyMax], min, max, base[keyMax])
      : base[keyMax];
    let low = Math.round(Number.isFinite(Number(nextMin)) ? Number(nextMin) : fallbackMin);
    let high = Math.round(Number.isFinite(Number(nextMax)) ? Number(nextMax) : fallbackMax);
    low = Math.max(min, Math.min(max, low));
    high = Math.max(min, Math.min(max, high));
    if (low > high) {
      const swap = low;
      low = high;
      high = swap;
    }
    return [low, high];
  }

  function normalizeStandaloneState(input, previous, brand = "hue") {
    const defaults = {
      on: true,
      bri: 70,
      hue: brand === "hue" ? 210 : 190,
      sat: 80,
      transitionMs: 350,
      mode: "rgb",
      scene: "sweep",
      animate: false,
      static: false,
      updateOnRaveStart: false,
      updateOnRaveStop: false,
      raveStopBri: 100,
      speedMode: "fixed",
      speedHz: 1.2,
      speedHzMin: 0.6,
      speedHzMax: 3.2,
      hueMin: 0,
      hueMax: 359,
      satMin: 45,
      satMax: 100,
      colorMode: "hsv",
      cctKelvin: 4000,
      cctMinKelvin: 2700,
      cctMaxKelvin: 6500,
      motionPhase: 0,
      motionDirection: 1
    };

    const source = input && typeof input === "object" ? input : {};
    const base = previous && typeof previous === "object"
      ? { ...defaults, ...previous }
      : { ...defaults };

    const has = key => Object.prototype.hasOwnProperty.call(source, key);
    const [hueMin, hueMax] = normalizeStandaloneStateRanges(source, base, "hueMin", "hueMax", 0, 359, 0, 359);
    const [satMin, satMax] = normalizeStandaloneStateRanges(source, base, "satMin", "satMax", 0, 100, 45, 100);
    const [cctMinKelvin, cctMaxKelvin] = normalizeStandaloneStateRanges(
      source,
      base,
      "cctMinKelvin",
      "cctMaxKelvin",
      2200,
      6500,
      2700,
      6500
    );

    const next = {
      on: has("on") ? parseBoolean(source.on, base.on) : base.on,
      mode: has("mode") ? String(source.mode || base.mode).trim().toLowerCase() : String(base.mode || "scene"),
      scene: has("scene") ? normalizeStandaloneScene(source.scene, base.scene) : normalizeStandaloneScene(base.scene, "sweep"),
      bri: has("bri")
        ? clampNumber(source.bri, 1, 100, base.bri)
        : base.bri,
      hue: has("hue")
        ? clampNumber(source.hue, 0, 359, base.hue)
        : base.hue,
      sat: has("sat")
        ? clampNumber(source.sat, 0, 100, base.sat)
        : base.sat,
      transitionMs: has("transitionMs")
        ? clampNumber(source.transitionMs, 0, 10000, base.transitionMs)
        : base.transitionMs,
      animate: has("animate")
        ? parseBoolean(source.animate, base.animate)
        : base.animate,
      static: has("static")
        ? parseBoolean(source.static, base.static)
        : base.static,
      updateOnRaveStart: has("updateOnRaveStart")
        ? parseBoolean(source.updateOnRaveStart, base.updateOnRaveStart)
        : base.updateOnRaveStart,
      updateOnRaveStop: has("updateOnRaveStop")
        ? parseBoolean(source.updateOnRaveStop, base.updateOnRaveStop)
        : base.updateOnRaveStop,
      raveStopBri: has("raveStopBri")
        ? clampNumber(source.raveStopBri, 1, 100, base.raveStopBri)
        : base.raveStopBri,
      speedMode: has("speedMode")
        ? normalizeStandaloneSpeedMode(source.speedMode, base.speedMode)
        : normalizeStandaloneSpeedMode(base.speedMode, "fixed"),
      speedHz: has("speedHz")
        ? clampNumber(source.speedHz, 0.2, 12, base.speedHz)
        : base.speedHz,
      speedHzMin: has("speedHzMin")
        ? clampNumber(source.speedHzMin, 0.2, 12, base.speedHzMin)
        : base.speedHzMin,
      speedHzMax: has("speedHzMax")
        ? clampNumber(source.speedHzMax, 0.2, 12, base.speedHzMax)
        : base.speedHzMax,
      hueMin,
      hueMax,
      satMin,
      satMax,
      colorMode: has("colorMode")
        ? normalizeStandaloneColorMode(source.colorMode, base.colorMode)
        : normalizeStandaloneColorMode(base.colorMode, "hsv"),
      cctKelvin: has("cctKelvin")
        ? clampNumber(source.cctKelvin, 2200, 6500, base.cctKelvin)
        : base.cctKelvin,
      cctMinKelvin,
      cctMaxKelvin,
      motionPhase: has("motionPhase")
        ? clampNumber(source.motionPhase, 0, 1, base.motionPhase)
        : clampNumber(base.motionPhase, 0, 1, 0),
      motionDirection: has("motionDirection")
        ? (Number(source.motionDirection) < 0 ? -1 : 1)
        : (Number(base.motionDirection) < 0 ? -1 : 1)
    };

    const modeExplicit = has("mode");
    const animateExplicit = has("animate");
    const nextMode = next.mode === "rgb" || next.mode === "scene" || next.mode === "auto"
      ? next.mode
      : (next.animate ? "scene" : "rgb");
    next.mode = nextMode;
    if (modeExplicit && (next.mode === "scene" || next.mode === "auto") && !animateExplicit) {
      next.animate = true;
    }
    if (modeExplicit && (next.mode === "scene" || next.mode === "auto") && !has("static")) {
      next.static = false;
    }
    if (next.mode === "rgb") {
      next.animate = false;
    }

    return {
      on: Boolean(next.on),
      mode: next.mode,
      scene: next.scene,
      bri: Math.round(next.bri),
      hue: Math.round(next.hue),
      sat: Math.round(next.sat),
      transitionMs: Math.round(next.transitionMs),
      animate: Boolean(next.animate),
      static: Boolean(next.static),
      updateOnRaveStart: Boolean(next.updateOnRaveStart),
      updateOnRaveStop: Boolean(next.updateOnRaveStop),
      raveStopBri: Math.round(next.raveStopBri),
      speedMode: next.speedMode,
      speedHz: Number(next.speedHz.toFixed(2)),
      speedHzMin: Number(next.speedHzMin.toFixed(2)),
      speedHzMax: Number(next.speedHzMax.toFixed(2)),
      hueMin: Math.round(next.hueMin),
      hueMax: Math.round(next.hueMax),
      satMin: Math.round(next.satMin),
      satMax: Math.round(next.satMax),
      colorMode: next.colorMode,
      cctKelvin: Math.round(next.cctKelvin),
      cctMinKelvin: Math.round(next.cctMinKelvin),
      cctMaxKelvin: Math.round(next.cctMaxKelvin),
      motionPhase: Number(next.motionPhase.toFixed(4)),
      motionDirection: next.motionDirection < 0 ? -1 : 1
    };
  }

  function getStandaloneReactiveEnergy() {
    const telemetry = getTelemetry();
    const energy = clampNumber(Number(telemetry.energy), 0, 1, 0);
    const rms = clampNumber(Number(telemetry.audioSourceLevel ?? telemetry.rms), 0, 1, 0);
    const flux = clampNumber(Number(telemetry.audioFlux ?? telemetry.flux), 0, 1, 0);
    const fallback = clampNumber(Math.max(energy, rms, flux * 0.8), 0, 1, 0.25);
    const profile = getAudioReactivityDrive(telemetry);
    if (!profile.enabled) {
      return fallback;
    }
    const mappedDrive = clampNumber((Number(profile.drive) - 0.12) / 1.08, 0, 1, fallback);
    const sourceLevel = clampNumber(Number(profile.level), 0, 1, fallback);
    return clampNumber(Math.max(mappedDrive, sourceLevel), 0, 1, fallback);
  }

  function resolveStandaloneDynamicHz(state = {}) {
    const mode = String(state.mode || "").trim().toLowerCase();
    const fixedHz = clampNumber(state.speedHz, 0.2, 12, 1.2);
    if (mode === "auto") {
      const telemetry = getTelemetry();
      const bpm = Number(telemetry.bpm);
      const bpmHz = Number.isFinite(bpm) && bpm > 0
        ? clampNumber(bpm / 96, 0.35, 12, fixedHz)
        : fixedHz;
      const rms = clampNumber(Number(telemetry.audioSourceLevel ?? telemetry.rms), 0, 1, 0);
      const beat = clampNumber(Number(telemetry.beatConfidence), 0, 1, 0);
      const transient = clampNumber(Number(telemetry.audioTransient), 0, 1, 0);
      const flux = clampNumber(Number(telemetry.audioFlux ?? telemetry.flux), 0, 1, 0);
      const energy = getStandaloneReactiveEnergy();
      const motion = clampNumber(Math.max(beat, transient, flux), 0, 1, 0);
      const drive = clampNumber((energy * 0.58) + (motion * 0.42), 0, 1, 0);
      const dynamicHz = clampNumber(
        0.55 + (drive * 8.2) + (Math.max(0, motion - 0.58) * 4.6),
        0.35,
        12,
        fixedHz
      );
      let autoHz = (bpmHz * 0.58) + (dynamicHz * 0.42);

      const calmTrack = rms < 0.09 && transient < 0.14 && flux < 0.14 && motion < 0.2;
      if (calmTrack) {
        autoHz = Math.min(autoHz, 2.4 + (drive * 1.4));
      }

      const intensePeak = drive > 0.72 || motion > 0.68;
      if (intensePeak) {
        autoHz = Math.max(autoHz, clampNumber(6.2 + (drive * 5.2), 6.2, 12, 8));
      }

      return clampNumber(autoHz, 0.35, 12, fixedHz);
    }
    if (String(state.speedMode || "").trim().toLowerCase() !== "audio") {
      return fixedHz;
    }
    const minHz = clampNumber(state.speedHzMin, 0.2, 12, 0.6);
    const maxHz = clampNumber(state.speedHzMax, minHz, 12, 3.2);
    const energy = getStandaloneReactiveEnergy();
    return minHz + ((maxHz - minHz) * energy);
  }

  function normalizeStandaloneScenePhase(phase) {
    let next = Number(phase);
    if (!Number.isFinite(next)) next = 0;
    while (next >= 1) next -= 1;
    while (next < 0) next += 1;
    return next;
  }

  function nextStandaloneAnimatedState(fixture, current, intervalMs) {
    const source = current && typeof current === "object" ? current : {};
    const scene = normalizeStandaloneScene(source.scene, "sweep");
    const colorMode = normalizeStandaloneColorMode(source.colorMode, "hsv");
    const hueLow = Math.round(Math.min(source.hueMin ?? 0, source.hueMax ?? 359));
    const hueHigh = Math.round(Math.max(source.hueMin ?? 0, source.hueMax ?? 359));
    const satLow = Math.round(Math.min(source.satMin ?? 0, source.satMax ?? 100));
    const satHigh = Math.round(Math.max(source.satMin ?? 0, source.satMax ?? 100));
    const cctLow = Math.round(Math.min(source.cctMinKelvin ?? 2700, source.cctMaxKelvin ?? 6500));
    const cctHigh = Math.round(Math.max(source.cctMinKelvin ?? 2700, source.cctMaxKelvin ?? 6500));
    const hueSpan = Math.max(1, hueHigh - hueLow);
    const satSpan = Math.max(0, satHigh - satLow);
    const cctSpan = Math.max(0, cctHigh - cctLow);
    const hz = resolveStandaloneDynamicHz(source);
    const step = clampNumber((hz * Math.max(40, Number(intervalMs) || 120)) / 1000, 0.01, 0.8, 0.08);
    const phase = normalizeStandaloneScenePhase(source.motionPhase);
    const direction = Number(source.motionDirection) < 0 ? -1 : 1;

    let nextPhase = phase;
    let nextDirection = direction;
    let hue = clampNumber(source.hue, 0, 359, hueLow);
    let sat = clampNumber(source.sat, 0, 100, satHigh);
    let bri = clampNumber(source.bri, 1, 100, 70);
    let cctKelvin = clampNumber(source.cctKelvin, 2200, 6500, cctLow);

    if (scene === "bounce") {
      let bouncePhase = phase + (step * direction);
      if (bouncePhase >= 1) {
        bouncePhase = 1 - (bouncePhase - 1);
        nextDirection = -1;
      } else if (bouncePhase <= 0) {
        bouncePhase = Math.abs(bouncePhase);
        nextDirection = 1;
      }
      nextPhase = normalizeStandaloneScenePhase(bouncePhase);
    } else {
      nextPhase = normalizeStandaloneScenePhase(phase + step);
    }

    if (scene === "pulse") {
      const wave = 0.5 + (Math.sin(nextPhase * Math.PI * 2) * 0.5);
      const briFloor = Math.max(8, Math.round(bri * 0.35));
      const briCeil = Math.max(briFloor, Math.round(source.bri || bri));
      bri = Math.round(briFloor + ((briCeil - briFloor) * wave));
      hue = Math.round(hueLow + (hueSpan * normalizeStandaloneScenePhase(nextPhase * 0.45)));
      sat = Math.round(satHigh - (satSpan * (wave * 0.45)));
      cctKelvin = Math.round(cctLow + (cctSpan * wave));
    } else if (scene === "spark") {
      const energy = getStandaloneReactiveEnergy();
      const jumpChance = clampNumber((0.18 + (energy * 0.65)) * step * 2.4, 0, 1, 0.2);
      if (Math.random() < jumpChance) {
        hue = Math.round(hueLow + (Math.random() * hueSpan));
        sat = Math.round(satLow + (Math.random() * satSpan));
        cctKelvin = Math.round(cctLow + (Math.random() * cctSpan));
      } else {
        hue = Math.round(hueLow + (hueSpan * nextPhase));
        sat = Math.round(satLow + (satSpan * nextPhase));
        cctKelvin = Math.round(cctLow + (cctSpan * nextPhase));
      }
    } else {
      hue = Math.round(hueLow + (hueSpan * nextPhase));
      sat = Math.round(satLow + (satSpan * nextPhase));
      cctKelvin = Math.round(cctLow + (cctSpan * nextPhase));
    }

    const patch = {
      hue,
      sat,
      bri,
      cctKelvin,
      speedHz: Number(hz.toFixed(2)),
      motionPhase: nextPhase,
      motionDirection: nextDirection
    };
    if (colorMode === "cct") {
      patch.sat = satLow;
    }
    return normalizeStandaloneState(patch, source, fixture?.brand);
  }

  function hsvToRgb(h, s, v = 100) {
    const sat = clampNumber(s, 0, 100, 0) / 100;
    const val = clampNumber(v, 0, 100, 100) / 100;
    return convertHsvToRgb255(h, sat, val, { sFallback: 0, vFallback: 1 });
  }

  return {
    normalizeStandaloneScene,
    normalizeStandaloneSpeedMode,
    normalizeStandaloneColorMode,
    normalizeStandaloneState,
    resolveStandaloneDynamicHz,
    nextStandaloneAnimatedState,
    hsvToRgb
  };
};
