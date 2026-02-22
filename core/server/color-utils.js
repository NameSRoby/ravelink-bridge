"use strict";

function fallbackClampNumber(value, min, max, fallback = min) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    const fallbackNum = Number(fallback);
    return Number.isFinite(fallbackNum) ? fallbackNum : min;
  }
  return Math.min(max, Math.max(min, n));
}

function fallbackHsvToRgb255(h, s = 1, v = 1) {
  const hue = ((Number(h) || 0) % 360 + 360) % 360;
  const sat = Math.max(0, Math.min(1, Number(s) || 0));
  const val = Math.max(0, Math.min(1, Number(v) || 0));
  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hue < 60) {
    r1 = c; g1 = x; b1 = 0;
  } else if (hue < 120) {
    r1 = x; g1 = c; b1 = 0;
  } else if (hue < 180) {
    r1 = 0; g1 = c; b1 = x;
  } else if (hue < 240) {
    r1 = 0; g1 = x; b1 = c;
  } else if (hue < 300) {
    r1 = x; g1 = 0; b1 = c;
  } else {
    r1 = c; g1 = 0; b1 = x;
  }
  return {
    r: Math.max(0, Math.min(255, Math.round((r1 + m) * 255))),
    g: Math.max(0, Math.min(255, Math.round((g1 + m) * 255))),
    b: Math.max(0, Math.min(255, Math.round((b1 + m) * 255)))
  };
}

function createServerColorUtils(options = {}) {
  const clampNumber = typeof options.clampNumber === "function"
    ? options.clampNumber
    : fallbackClampNumber;
  const convertHsvToRgb255 = typeof options.convertHsvToRgb255 === "function"
    ? options.convertHsvToRgb255
    : fallbackHsvToRgb255;

  function clampRgb255(v) {
    return Math.max(0, Math.min(255, Math.round(Number(v) || 0)));
  }

  function miredToKelvin(mired) {
    const m = Number(mired);
    if (!Number.isFinite(m) || m <= 0) return 3200;
    return Math.max(1200, Math.min(9000, Math.round(1000000 / m)));
  }

  function kelvinToRgb(kelvin) {
    const temp = Math.max(1000, Math.min(40000, Number(kelvin) || 3200)) / 100;
    let red;
    let green;
    let blue;

    if (temp <= 66) {
      red = 255;
      green = 99.4708025861 * Math.log(temp) - 161.1195681661;
      blue = temp <= 19 ? 0 : (138.5177312231 * Math.log(temp - 10) - 305.0447927307);
    } else {
      red = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
      green = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
      blue = 255;
    }

    return {
      r: clampRgb255(red),
      g: clampRgb255(green),
      b: clampRgb255(blue)
    };
  }

  function xyBriToRgb(x, y, bri = 180) {
    const xx = Number(x);
    const yy = Number(y);
    if (!Number.isFinite(xx) || !Number.isFinite(yy) || yy <= 0.0001) {
      return { r: 255, g: 255, b: 255 };
    }

    const z = 1.0 - xx - yy;
    const Y = Math.max(0.05, Math.min(1, Number(bri) / 254));
    const X = (Y / yy) * xx;
    const Z = (Y / yy) * z;

    let r = X * 1.656492 - Y * 0.354851 - Z * 0.255038;
    let g = -X * 0.707196 + Y * 1.655397 + Z * 0.036152;
    let b = X * 0.051713 - Y * 0.121364 + Z * 1.01153;

    r = r <= 0.0031308 ? 12.92 * r : (1.055 * Math.pow(r, 1 / 2.4) - 0.055);
    g = g <= 0.0031308 ? 12.92 * g : (1.055 * Math.pow(g, 1 / 2.4) - 0.055);
    b = b <= 0.0031308 ? 12.92 * b : (1.055 * Math.pow(b, 1 / 2.4) - 0.055);

    r = Math.max(0, r);
    g = Math.max(0, g);
    b = Math.max(0, b);

    const maxChannel = Math.max(r, g, b, 1);
    if (maxChannel > 1) {
      r /= maxChannel;
      g /= maxChannel;
      b /= maxChannel;
    }

    return {
      r: clampRgb255(r * 255),
      g: clampRgb255(g * 255),
      b: clampRgb255(b * 255)
    };
  }

  function hueStateToWizState(hueState = {}) {
    const bri = Math.max(1, Math.min(100, Math.round((Number(hueState.bri || 180) / 254) * 100)));
    let rgb = { r: 255, g: 255, b: 255 };

    if (Array.isArray(hueState.xy) && hueState.xy.length >= 2) {
      rgb = xyBriToRgb(hueState.xy[0], hueState.xy[1], hueState.bri || 180);
    } else if (Number.isFinite(Number(hueState.ct))) {
      rgb = kelvinToRgb(miredToKelvin(hueState.ct));
    }

    return {
      r: rgb.r,
      g: rgb.g,
      b: rgb.b,
      dimming: bri
    };
  }

  function clamp01(value, fallback = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(1, n));
  }

  function getAudioTelemetryMotionProfile(telemetry = {}) {
    const t = telemetry && typeof telemetry === "object" ? telemetry : {};
    const rms = clamp01(t.audioSourceLevel, clamp01(t.rms, clamp01(t.level, 0)));
    const energyValue = clamp01(t.energy, rms);
    const low = clamp01(t.audioBandLow, rms);
    const mid = clamp01(t.audioBandMid, rms);
    const high = clamp01(t.audioBandHigh, rms);
    const transient = clamp01(t.audioTransient ?? t.transient, 0);
    const flux = clamp01(t.audioFlux, clamp01(t.spectralFlux, 0));
    const beat = clamp01(t.beatConfidence, t.beat ? 0.65 : 0);
    const percussionSupport = clamp01(
      (low * 0.46) +
      (transient * 0.32) +
      (beat * 0.22),
      0
    );
    const vocalBias = clamp01(
      ((mid * 0.58) + (high * 0.28) - (percussionSupport * 0.62)) * 1.35,
      0
    );
    const motion = clamp01(
      Math.max(
        energyValue,
        rms * (0.66 + (percussionSupport * 0.22)),
        transient * 0.9,
        flux * 0.82,
        beat * 0.72
      ),
      0
    );
    const quietMix = clamp01(((0.34 - motion) / 0.34) + (vocalBias * 0.2), 0);
    const hushMix = clamp01(((0.24 - motion) / 0.24) + (vocalBias * 0.26), 0);
    return {
      motion,
      quietMix,
      hushMix,
      percussionSupport,
      vocalBias
    };
  }

  function boostRgbSaturation(color = {}, amount = 0) {
    const r = clampRgb255(color?.r);
    const g = clampRgb255(color?.g);
    const b = clampRgb255(color?.b);
    const boost = clampNumber(amount, 0, 1, 0);
    const maxChannel = Math.max(r, g, b);
    const minChannel = Math.min(r, g, b);
    if (boost <= 0 || maxChannel <= 0 || maxChannel - minChannel < 1) {
      return { r, g, b };
    }

    const sat = (maxChannel - minChannel) / maxChannel;
    const targetSat = clamp01(sat + ((1 - sat) * boost), sat);
    const targetMin = maxChannel * (1 - targetSat);
    const spread = maxChannel - minChannel;
    const gain = spread > 0 ? (maxChannel - targetMin) / spread : 1;
    const boosted = {
      r: clampRgb255(maxChannel - ((maxChannel - r) * gain)),
      g: clampRgb255(maxChannel - ((maxChannel - g) * gain)),
      b: clampRgb255(maxChannel - ((maxChannel - b) * gain))
    };
    if (boost <= 0.5) return boosted;

    const vivid = clampNumber((boost - 0.5) / 0.5, 0, 1, 0);
    const luma =
      boosted.r * 0.2126 +
      boosted.g * 0.7152 +
      boosted.b * 0.0722;
    const chromaGain = 1 + (vivid * 1.28);
    const valueGain = 1 + (vivid * 0.24);

    return {
      r: clampRgb255((luma + ((boosted.r - luma) * chromaGain)) * valueGain),
      g: clampRgb255((luma + ((boosted.g - luma) * chromaGain)) * valueGain),
      b: clampRgb255((luma + ((boosted.b - luma) * chromaGain)) * valueGain)
    };
  }

  function rgbToHsv255(color = {}) {
    const r = clampRgb255(color?.r) / 255;
    const g = clampRgb255(color?.g) / 255;
    const b = clampRgb255(color?.b) / 255;
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
    return {
      h: clampNumber(h, 0, 360, 0),
      s: max <= 0 ? 0 : clampNumber(delta / max, 0, 1, 0),
      v: clampNumber(max, 0, 1, 0)
    };
  }

  function hsvToRgb255(h, s = 1, v = 1) {
    return convertHsvToRgb255(h, s, v, { sFallback: 1, vFallback: 1 });
  }

  function resolveAudioReactivitySourceLevel(source, telemetry = {}) {
    const t = telemetry && typeof telemetry === "object" ? telemetry : {};
    const rms = clamp01(t.audioSourceLevel, clamp01(t.rms, 0));
    const energyValue = clamp01(t.energy, rms);
    const low = clamp01(t.audioBandLow, rms);
    const mid = clamp01(t.audioBandMid, rms);
    const high = clamp01(t.audioBandHigh, rms);
    const transient = clamp01(Number(t.audioTransient || 0) / 1.2, 0);
    const peak = clamp01(Number(t.audioPeak || 0) / 1.5, 0);
    const flux = clamp01(t.audioFlux, 0);
    const beat = clamp01(t.beatConfidence, t.beat ? 0.65 : 0);
    const percussionSupport = clamp01(
      (low * 0.46) +
      (transient * 0.34) +
      (beat * 0.2),
      0
    );

    switch (source) {
      case "baseline":
        return rms;
      case "bass":
        return low;
      case "mids":
        return mid;
      case "highs":
        return high;
      case "peaks":
        return peak;
      case "transients":
        return transient;
      case "flux":
        return flux;
      case "drums":
        return clamp01(low * 0.42 + transient * 0.3 + flux * 0.18 + beat * 0.1, 0);
      case "vocals":
        return clamp01(
          (mid * 0.52 + high * 0.28 + flux * 0.08) *
            (0.72 + ((1 - percussionSupport) * 0.28)),
          0
        );
      case "beat":
        return beat;
      case "groove":
        return clamp01(rms * 0.34 + low * 0.34 + mid * 0.2 + beat * 0.12, 0);
      case "smart":
      default:
        return clamp01(
          energyValue * 0.34 +
          transient * 0.28 +
          flux * 0.18 +
          low * 0.16 +
          mid * 0.02 +
          beat * 0.02,
          0
        );
    }
  }

  return {
    clampRgb255,
    miredToKelvin,
    kelvinToRgb,
    xyBriToRgb,
    hueStateToWizState,
    clamp01,
    getAudioTelemetryMotionProfile,
    boostRgbSaturation,
    rgbToHsv255,
    hsvToRgb255,
    resolveAudioReactivitySourceLevel
  };
}

module.exports = {
  createServerColorUtils
};
