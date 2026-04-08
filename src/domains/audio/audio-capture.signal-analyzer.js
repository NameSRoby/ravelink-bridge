// [TITLE] Module: domains/audio/audio-capture.signal-analyzer.js
// [TITLE] Purpose: project PCM float chunks into lightweight audio telemetry
// [TITLE] Functionality Index:
// [TITLE] - normalize unusual f32 amplitude domains into [-1..1]
// [TITLE] - compute RMS, peak, band, flux, transient, beat, and BPM metrics
// [TITLE] - smooth short dropout frames for more stable scene-driving telemetry
// [DEV] This helper stays deterministic except for Date.now-based beat timing,
// [DEV] matching the historical capture runtime behavior.

const { clampNumber } = require("./audio-capture.launcher-utils");

module.exports = function createSignalAnalyzer() {
  let lastRms = 0;
  let lastPeak = 0;
  let dropoutFrameStreak = 0;
  let fluxEma = 0;
  let transientEma = 0;
  let lastBeatAt = 0;
  let beatHoldUntil = 0;
  let bpmSmoothed = 0;
  let iirLow = 0;
  let prevSample = 0;
  let inputScale = 1;
  let metrics = {
    level: 0,
    levelRaw: 0,
    rms: 0,
    peak: 0,
    transient: 0,
    spectralFlux: 0,
    zcr: 0,
    bandLow: 0,
    bandMid: 0,
    bandHigh: 0,
    energy: 0,
    beat: false,
    beatConfidence: 0,
    bpm: 0
  };

  function pushChunk(buffer = null) {
    const data = Buffer.isBuffer(buffer) ? buffer : null;
    if (!data || data.length < 4) return metrics;
    const sampleCount = Math.floor(data.length / 4);
    if (sampleCount <= 0) return metrics;

    // [DEV] Rust/process loopback feeds can occasionally expose non-normalized
    // [DEV] float domains (e.g. int16-like amplitude encoded in f32 stream).
    // [DEV] We infer a stable per-stream scale from raw peak and normalize to
    // [DEV] the expected [-1..1] domain before computing scene-driving metrics.
    let rawPeak = 0;
    for (let i = 0; i < sampleCount; i += 1) {
      const sample = data.readFloatLE(i * 4);
      if (!Number.isFinite(sample)) continue;
      const abs = Math.abs(sample);
      if (abs > rawPeak) rawPeak = abs;
    }

    const targetScale = (() => {
      if (!(rawPeak > 1.25)) return 1;
      if (rawPeak >= 1048576) return 2147483648;
      if (rawPeak >= 128) return 32768;
      return rawPeak;
    })();
    if (targetScale > inputScale) {
      inputScale = targetScale;
    } else {
      inputScale = Math.max(1, (inputScale * 0.998));
    }
    const sampleScale = Math.max(1, inputScale);

    let sumSq = 0;
    let peak = 0;
    let zc = 0;
    let lowSq = 0;
    let highSq = 0;
    let prevSign = prevSample >= 0 ? 1 : -1;

    for (let i = 0; i < sampleCount; i += 1) {
      const sampleRaw = data.readFloatLE(i * 4);
      if (!Number.isFinite(sampleRaw)) continue;
      const sample = clampNumber(sampleRaw / sampleScale, -1, 1, 0);
      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;
      sumSq += sample * sample;
      const sign = sample >= 0 ? 1 : -1;
      if (sign !== prevSign) zc += 1;
      prevSign = sign;

      // [DEV] Lightweight low/high separation avoids FFT while still giving useful
      // [DEV] scene-state movement cues for early engine-v2 rebuild iterations.
      iirLow += 0.02 * (sample - iirLow);
      const high = sample - iirLow;
      lowSq += iirLow * iirLow;
      highSq += high * high;
      prevSample = sample;
    }

    const rmsRaw = Math.sqrt(sumSq / Math.max(1, sampleCount));
    const low = Math.sqrt(lowSq / Math.max(1, sampleCount));
    const high = Math.sqrt(highSq / Math.max(1, sampleCount));
    const hasStrongHistory = lastRms >= 0.05 || lastPeak >= 0.08;
    const likelyDropoutFrame = hasStrongHistory && rmsRaw <= 0.004 && peak <= 0.02;
    let rms = rmsRaw;
    let effectivePeak = peak;
    if (likelyDropoutFrame) {
      dropoutFrameStreak += 1;
      const continuityDecay = clampNumber(
        0.9 - (dropoutFrameStreak * 0.08),
        0.55,
        0.9,
        0.78
      );
      rms = clampNumber(lastRms * continuityDecay, 0, 1, rmsRaw);
      effectivePeak = clampNumber(Math.max(rms, lastPeak * continuityDecay), 0, 1, peak);
    } else {
      dropoutFrameStreak = 0;
    }
    const mid = Math.max(0, rms - ((low + high) / 2));
    const fluxRaw = clampNumber(Math.abs(rms - lastRms) * 5, 0, 1, 0);
    const transientRaw = clampNumber(((effectivePeak - lastPeak) * 2.6) + ((rms - lastRms) * 4.2), 0, 1, 0);
    fluxEma = clampNumber(
      fluxEma + ((fluxRaw - fluxEma) * 0.38),
      0,
      1,
      fluxRaw
    );
    transientEma = clampNumber(
      transientEma + ((transientRaw - transientEma) * 0.42),
      0,
      1,
      transientRaw
    );
    const flux = clampNumber((fluxRaw * 0.68) + (fluxEma * 0.32), 0, 1, fluxRaw);
    const transient = clampNumber((transientRaw * 0.64) + (transientEma * 0.36), 0, 1, transientRaw);

    const nowMs = Date.now();
    let beat = false;
    let beatPulse = false;
    let beatConfidence = clampNumber((transient * 0.7) + (flux * 0.3), 0, 1, 0);
    if (transient >= 0.28 && rms >= 0.02 && (nowMs - lastBeatAt) >= 250) {
      beatPulse = true;
      beat = true;
      beatConfidence = clampNumber(Math.max(beatConfidence, 0.62), 0, 1, 0.62);
      if (lastBeatAt > 0) {
        const intervalMs = nowMs - lastBeatAt;
        const bpmInstant = clampNumber(60000 / Math.max(1, intervalMs), 30, 240, 0);
        if (bpmSmoothed > 0) {
          bpmSmoothed = clampNumber((bpmSmoothed * 0.72) + (bpmInstant * 0.28), 30, 240, bpmInstant);
        } else {
          bpmSmoothed = bpmInstant;
        }
      }
      lastBeatAt = nowMs;
      beatHoldUntil = nowMs + 130;
    } else if (bpmSmoothed > 0) {
      bpmSmoothed = clampNumber(bpmSmoothed * 0.996, 0, 240, 0);
      if (bpmSmoothed < 1) bpmSmoothed = 0;
    }
    beat = beat || (beatHoldUntil > nowMs);
    if (beat) {
      beatConfidence = clampNumber(Math.max(beatConfidence, 0.18), 0, 1, 0.18);
    }

    metrics = {
      level: clampNumber(rms, 0, 1, 0),
      levelRaw: clampNumber(rms, 0, 2, 0),
      rms: clampNumber(rms, 0, 1, 0),
      peak: clampNumber(effectivePeak, 0, 1, 0),
      transient,
      spectralFlux: flux,
      zcr: clampNumber(zc / Math.max(1, sampleCount), 0, 1, 0),
      bandLow: clampNumber(low * 1.7, 0, 1, 0),
      bandMid: clampNumber(mid * 2.2, 0, 1, 0),
      bandHigh: clampNumber(high * 1.8, 0, 1, 0),
      energy: clampNumber((rms * 0.65) + (effectivePeak * 0.35), 0, 1, 0),
      beat,
      beatPulse,
      beatConfidence,
      bpm: clampNumber(Math.round(bpmSmoothed), 0, 260, 0)
    };

    lastRms = rms;
    lastPeak = effectivePeak;
    return metrics;
  }

  function getMetrics() {
    return {
      ...metrics
    };
  }

  return {
    pushChunk,
    getMetrics
  };
};
