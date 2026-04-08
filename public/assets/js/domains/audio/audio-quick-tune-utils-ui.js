// [TITLE] Module: public/assets/js/domains/audio/audio-quick-tune-utils-ui.js
// [TITLE] Purpose: pure quick-tune math and profile interpolation helpers for audio UI
// [TITLE] Functionality Index:
// [TITLE] - quick-tune bounds/stage ownership
// [TITLE] - linear/log percentage conversion helpers
// [TITLE] - limiter control mapping
// [TITLE] - nearest-stage + profile interpolation helpers
// [DEV] Complex Flow:
// [DEV] Audio quick-tune sliders are a pure math layer used by multiple UI actions.
// [DEV] Keep the bounds, stage tables, and interpolation helpers here so audio.js
// [DEV] focuses on DOM state, API calls, and runtime hydration.
(function attachAudioQuickTuneUtilsUi(global) {
  "use strict";

  global.createAudioQuickTuneMathUi = function createAudioQuickTuneMathUi() {
    const AUDIO_QUICK_TUNE_BOUNDS = Object.freeze({
      gain: Object.freeze({ min: 0.35, max: 2.5 }),
      noiseFloorMin: Object.freeze({ min: 0.00005, max: 0.02 }),
      autoLevelTargetRms: Object.freeze({ min: 0.008, max: 0.12 }),
      autoLevelGate: Object.freeze({ min: 0.001, max: 0.03 }),
      limiterThreshold: Object.freeze({ min: 0.55, max: 0.96 })
    });

    const AUDIO_QUICK_TUNE_STAGES = Object.freeze({
      profile: Object.freeze([
        Object.freeze({ pct: 0, label: "QUIET SOURCE", values: Object.freeze({ gain: 26, noiseFloorMin: 18, autoLevelTargetRms: 28, autoLevelGate: 20, limiterControl: 34 }) }),
        Object.freeze({ pct: 25, label: "CALM", values: Object.freeze({ gain: 33, noiseFloorMin: 28, autoLevelTargetRms: 31, autoLevelGate: 24, limiterControl: 40 }) }),
        Object.freeze({ pct: 50, label: "BALANCED", values: Object.freeze({ gain: 40, noiseFloorMin: 36, autoLevelTargetRms: 36, autoLevelGate: 30, limiterControl: 48 }) }),
        Object.freeze({ pct: 75, label: "HOT SOURCE", values: Object.freeze({ gain: 52, noiseFloorMin: 54, autoLevelTargetRms: 42, autoLevelGate: 42, limiterControl: 62 }) }),
        Object.freeze({ pct: 100, label: "LOUD ROOM", values: Object.freeze({ gain: 64, noiseFloorMin: 72, autoLevelTargetRms: 50, autoLevelGate: 58, limiterControl: 76 }) })
      ]),
      gain: Object.freeze([
        Object.freeze({ pct: 20, label: "CALM" }),
        Object.freeze({ pct: 35, label: "BALANCED" }),
        Object.freeze({ pct: 50, label: "PUNCHY" }),
        Object.freeze({ pct: 65, label: "HOT" }),
        Object.freeze({ pct: 80, label: "AGGRESSIVE" })
      ]),
      noiseFloorMin: Object.freeze([
        Object.freeze({ pct: 12, label: "OPEN GATE" }),
        Object.freeze({ pct: 28, label: "LIGHT ROOM" }),
        Object.freeze({ pct: 42, label: "CLEAN ROOM" }),
        Object.freeze({ pct: 58, label: "NOISY ROOM" }),
        Object.freeze({ pct: 74, label: "STRICT GATE" })
      ]),
      autoLevelTargetRms: Object.freeze([
        Object.freeze({ pct: 20, label: "SOFT BOOST" }),
        Object.freeze({ pct: 34, label: "BALANCED" }),
        Object.freeze({ pct: 50, label: "STRONG BOOST" }),
        Object.freeze({ pct: 68, label: "HARD BOOST" })
      ]),
      autoLevelGate: Object.freeze([
        Object.freeze({ pct: 18, label: "ALWAYS READY" }),
        Object.freeze({ pct: 32, label: "NORMAL" }),
        Object.freeze({ pct: 46, label: "ROOM SAFE" }),
        Object.freeze({ pct: 62, label: "STRICT" })
      ]),
      limiterControl: Object.freeze([
        Object.freeze({ pct: 24, label: "SOFT LIMIT" }),
        Object.freeze({ pct: 42, label: "BALANCED" }),
        Object.freeze({ pct: 58, label: "HARD LIMIT" }),
        Object.freeze({ pct: 74, label: "MAX CONTROL" })
      ])
    });

    function clamp01Ui(value, fallback = 0) {
      const n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.max(0, Math.min(1, n));
    }

    function linearToPctUi(value, min, max, fallbackPct = 0) {
      const range = Number(max) - Number(min);
      if (!(range > 0)) return fallbackPct;
      return clamp01Ui((Number(value) - Number(min)) / range, fallbackPct);
    }

    function pctToLinearUi(pct, min, max, fallback = min) {
      const safePct = clamp01Ui(pct, 0);
      const range = Number(max) - Number(min);
      if (!(range > 0)) return Number(fallback);
      return Number(min) + (range * safePct);
    }

    function logToPctUi(value, min, max, fallbackPct = 0) {
      const safeMin = Math.max(1e-9, Number(min));
      const safeMax = Math.max(safeMin + 1e-9, Number(max));
      const safeValue = Math.max(safeMin, Math.min(safeMax, Number(value)));
      const logMin = Math.log10(safeMin);
      const logMax = Math.log10(safeMax);
      const denom = logMax - logMin;
      if (!(denom > 0)) return fallbackPct;
      return clamp01Ui((Math.log10(safeValue) - logMin) / denom, fallbackPct);
    }

    function pctToLogUi(pct, min, max, fallback = min) {
      const safeMin = Math.max(1e-9, Number(min));
      const safeMax = Math.max(safeMin + 1e-9, Number(max));
      const safePct = clamp01Ui(pct, 0);
      const logMin = Math.log10(safeMin);
      const logMax = Math.log10(safeMax);
      return 10 ** (logMin + ((logMax - logMin) * safePct));
    }

    function mapLimiterThresholdToControlPct(value = 0.82) {
      return 1 - linearToPctUi(
        value,
        AUDIO_QUICK_TUNE_BOUNDS.limiterThreshold.min,
        AUDIO_QUICK_TUNE_BOUNDS.limiterThreshold.max,
        0.34
      );
    }

    function mapControlPctToLimiterThreshold(pct = 0.34) {
      return pctToLinearUi(
        1 - clamp01Ui(pct, 0.34),
        AUDIO_QUICK_TUNE_BOUNDS.limiterThreshold.min,
        AUDIO_QUICK_TUNE_BOUNDS.limiterThreshold.max,
        0.82
      );
    }

    function getNearestAudioQuickTuneStage(key = "", pct = 0) {
      const list = Array.isArray(AUDIO_QUICK_TUNE_STAGES[key]) ? AUDIO_QUICK_TUNE_STAGES[key] : [];
      if (!list.length) return null;
      const target = clamp01Ui(pct, 0) * 100;
      let best = list[0];
      let bestDiff = Math.abs(target - Number(best.pct || 0));
      for (let i = 1; i < list.length; i += 1) {
        const stage = list[i];
        const diff = Math.abs(target - Number(stage.pct || 0));
        if (diff < bestDiff) {
          best = stage;
          bestDiff = diff;
        }
      }
      return best;
    }

    function getAudioQuickTuneProfileInterpolatedPcts(profilePct = 0.5) {
      const points = AUDIO_QUICK_TUNE_STAGES.profile;
      const target = clamp01Ui(profilePct, 0.5) * 100;
      let lower = points[0];
      let upper = points[points.length - 1];
      for (let i = 0; i < points.length; i += 1) {
        const point = points[i];
        if (Number(point.pct) <= target) lower = point;
        if (Number(point.pct) >= target) {
          upper = point;
          break;
        }
      }
      if (Number(upper.pct) <= Number(lower.pct)) return { ...lower.values };
      const t = (target - Number(lower.pct)) / (Number(upper.pct) - Number(lower.pct));
      return {
        gain: Number(lower.values.gain) + ((Number(upper.values.gain) - Number(lower.values.gain)) * t),
        noiseFloorMin: Number(lower.values.noiseFloorMin) + ((Number(upper.values.noiseFloorMin) - Number(lower.values.noiseFloorMin)) * t),
        autoLevelTargetRms: Number(lower.values.autoLevelTargetRms) + ((Number(upper.values.autoLevelTargetRms) - Number(lower.values.autoLevelTargetRms)) * t),
        autoLevelGate: Number(lower.values.autoLevelGate) + ((Number(upper.values.autoLevelGate) - Number(lower.values.autoLevelGate)) * t),
        limiterControl: Number(lower.values.limiterControl) + ((Number(upper.values.limiterControl) - Number(lower.values.limiterControl)) * t)
      };
    }

    return {
      AUDIO_QUICK_TUNE_BOUNDS,
      AUDIO_QUICK_TUNE_STAGES,
      clamp01Ui,
      linearToPctUi,
      pctToLinearUi,
      logToPctUi,
      pctToLogUi,
      mapLimiterThresholdToControlPct,
      mapControlPctToLimiterThreshold,
      getNearestAudioQuickTuneStage,
      getAudioQuickTuneProfileInterpolatedPcts
    };
  };
})(window);
