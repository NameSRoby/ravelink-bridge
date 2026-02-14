// [TITLE] Module: core/audio.js
// [TITLE] Purpose: audio

/**
 * ======================================================
 * RAVE AUDIO ENGINE v3.1
 * ======================================================
 * Compatibility:
 * - Same factory API: createAudio(onLevel)
 * - Same required methods: start(), stop()
 * - Same optional hooks: onFast/onMid/onSlow/onTransient
 *
 * Additions:
 * - Adaptive floor/ceiling normalization (less track-dependent jitter)
 * - Device fallback selection (not hard-fail on missing VB cable)
 * - Auto-restart on stream error
 * - Extended hooks: onLevel, onStats
 * - Telemetry getter for debugging/tuning
 */

let naudiodon = null;
let naudiodonLoadError = null;
try {
  naudiodon = require("naudiodon");
} catch (err) {
  naudiodonLoadError = err;
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const toNum = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const softLimit01 = (value, threshold, knee) => {
  const x = Math.max(0, value);
  if (x <= threshold) return x;
  const over = x - threshold;
  const shaped = 1 - Math.exp(-over / Math.max(1e-6, knee));
  return threshold + (1 - threshold) * shaped;
};

module.exports = function createAudio(onLevel) {
  let stream = null;
  let running = false;
  let restartTimer = null;
  let watchdogTimer = null;
  let lastError = null;
  let lastRestartReason = null;
  let lastDeviceId = null;
  let lastDataAt = 0;
  let watchdogTrips = 0;

  const cfg = {
    sampleRate: toNum(process.env.RAVE_AUDIO_SAMPLE_RATE, 96000),
    framesPerBuffer: toNum(process.env.RAVE_AUDIO_FRAMES, 256),
    channels: toNum(process.env.RAVE_AUDIO_CHANNELS, 2),
    noiseFloorMin: toNum(process.env.RAVE_AUDIO_NOISE_FLOOR, 0.00045),
    peakDecay: toNum(process.env.RAVE_AUDIO_PEAK_DECAY, 0.93),
    outputGain: toNum(process.env.RAVE_AUDIO_GAIN, 1.0),
    limiterThreshold: clamp(toNum(process.env.RAVE_AUDIO_LIMITER_THRESHOLD, 0.82), 0.4, 0.99),
    limiterKnee: clamp(toNum(process.env.RAVE_AUDIO_LIMITER_KNEE, 0.16), 0.02, 0.8),
    restartMs: toNum(process.env.RAVE_AUDIO_RESTART_MS, 1500),
    watchdogMs: clamp(Math.round(toNum(process.env.RAVE_AUDIO_WATCHDOG_MS, 3000)), 800, 30000),
    logEveryTicks: Math.max(10, toNum(process.env.RAVE_AUDIO_LOG_TICKS, 60)),
    bandLowHz: clamp(toNum(process.env.RAVE_AUDIO_BAND_LOW_HZ, 180), 60, 500),
    bandMidHz: clamp(toNum(process.env.RAVE_AUDIO_BAND_MID_HZ, 2200), 700, 8000),
    deviceMatch: String(process.env.RAVE_AUDIO_DEVICE_MATCH || "").toLowerCase().trim(),
    deviceId:
      process.env.RAVE_AUDIO_DEVICE_ID === undefined
        ? null
        : toNum(process.env.RAVE_AUDIO_DEVICE_ID, null)
  };

  function normalizeCfgPatch(patch = {}) {
    const next = {};

    if (patch.sampleRate !== undefined) {
      next.sampleRate = clamp(Math.round(toNum(patch.sampleRate, cfg.sampleRate)), 22050, 192000);
    }

    if (patch.framesPerBuffer !== undefined) {
      next.framesPerBuffer = clamp(Math.round(toNum(patch.framesPerBuffer, cfg.framesPerBuffer)), 64, 2048);
    }

    if (patch.channels !== undefined) {
      next.channels = clamp(Math.round(toNum(patch.channels, cfg.channels)), 1, 8);
    }

    if (patch.noiseFloorMin !== undefined) {
      next.noiseFloorMin = clamp(toNum(patch.noiseFloorMin, cfg.noiseFloorMin), 0, 0.02);
    }

    if (patch.peakDecay !== undefined) {
      next.peakDecay = clamp(toNum(patch.peakDecay, cfg.peakDecay), 0.5, 0.9995);
    }

    if (patch.outputGain !== undefined) {
      next.outputGain = clamp(toNum(patch.outputGain, cfg.outputGain), 0.2, 3);
    }

    if (patch.limiterThreshold !== undefined) {
      next.limiterThreshold = clamp(toNum(patch.limiterThreshold, cfg.limiterThreshold), 0.4, 0.99);
    }

    if (patch.limiterKnee !== undefined) {
      next.limiterKnee = clamp(toNum(patch.limiterKnee, cfg.limiterKnee), 0.02, 0.8);
    }

    if (patch.restartMs !== undefined) {
      next.restartMs = clamp(Math.round(toNum(patch.restartMs, cfg.restartMs)), 250, 20000);
    }

    if (patch.watchdogMs !== undefined) {
      next.watchdogMs = clamp(Math.round(toNum(patch.watchdogMs, cfg.watchdogMs)), 800, 30000);
    }

    if (patch.logEveryTicks !== undefined) {
      next.logEveryTicks = clamp(Math.round(toNum(patch.logEveryTicks, cfg.logEveryTicks)), 10, 2000);
    }

    if (patch.bandLowHz !== undefined) {
      next.bandLowHz = clamp(Math.round(toNum(patch.bandLowHz, cfg.bandLowHz)), 60, 500);
    }

    if (patch.bandMidHz !== undefined) {
      next.bandMidHz = clamp(Math.round(toNum(patch.bandMidHz, cfg.bandMidHz)), 700, 8000);
    }

    if (patch.deviceMatch !== undefined) {
      next.deviceMatch = String(patch.deviceMatch || "").toLowerCase();
    }

    if (patch.deviceId !== undefined) {
      if (patch.deviceId === null || patch.deviceId === "" || String(patch.deviceId).toLowerCase() === "auto") {
        next.deviceId = null;
      } else {
        next.deviceId = Math.round(toNum(patch.deviceId, cfg.deviceId ?? 0));
      }
    }

    return next;
  }

  function getConfig() {
    return { ...cfg };
  }

  function listDevices() {
    const devices = naudiodon.getDevices();
    return devices
      .filter(d => d.maxInputChannels > 0)
      .map(d => ({
        id: d.id,
        name: d.name,
        hostAPIName: d.hostAPIName,
        maxInputChannels: d.maxInputChannels
      }));
  }

  /* =========================
     ENERGY STATE
  ========================= */
  let fast = 0;
  let mid = 0;
  let slow = 0;
  let transient = 0;
  let prevFast = 0;
  let peakHold = 0;
  let tick = 0;

  // Adaptive normalization state
  let adaptiveFloor = cfg.noiseFloorMin;
  let adaptiveCeil = 0.025;

  // Extra descriptors for telemetry and future logic
  let lastRms = 0;
  let lastPeak = 0;
  let lastZcr = 0;
  let lastLevelRaw = 0;
  let lastLevel = 0;
  let lastDeviceName = "";
  let lastBandLow = 0;
  let lastBandMid = 0;
  let lastBandHigh = 0;
  let lastSpectralFlux = 0;

  // Band splitting state
  let lpLow = 0;
  let lpMid = 0;
  let prevBandLowRaw = 0;
  let prevBandMidRaw = 0;
  let prevBandHighRaw = 0;

  /* =========================
     ENVELOPE SHAPING
  ========================= */
  const FAST_ATTACK = 0.68;
  const FAST_RELEASE = 0.24;

  const MID_ATTACK = 0.24;
  const MID_RELEASE = 0.11;

  const SLOW_ATTACK = 0.055;
  const SLOW_RELEASE = 0.038;

  /* =========================
     OPTIONAL HOOKS
  ========================= */
  const hooks = {
    onFast: null,
    onMid: null,
    onSlow: null,
    onTransient: null,
    onLevel: null,
    onStats: null
  };

  if (!naudiodon) {
    const missingReason = naudiodonLoadError?.message || String(naudiodonLoadError || "module not found");
    const missingDriverError = `naudiodon unavailable (${missingReason})`;
    lastError = missingDriverError;
    console.warn(`[AUDIO] ${missingDriverError}; audio reactivity disabled`);

    function setConfigFallback(patch = {}) {
      const normalized = normalizeCfgPatch(patch);
      const keys = Object.keys(normalized);
      for (const key of keys) {
        cfg[key] = normalized[key];
      }
      return {
        ok: true,
        changed: keys,
        config: getConfig(),
        restarted: false
      };
    }

    function getTelemetryFallback() {
      return {
        running,
        driverAvailable: false,
        driverError: missingDriverError,
        device: null,
        deviceId: null,
        restartPending: false,
        watchdogMs: cfg.watchdogMs,
        msSinceData: null,
        watchdogTrips: 0,
        lastRestartReason,
        lastError,
        rms: 0,
        peak: 0,
        zcr: 0,
        levelRaw: 0,
        level: 0,
        bandLow: 0,
        bandMid: 0,
        bandHigh: 0,
        spectralFlux: 0,
        fast: 0,
        mid: 0,
        slow: 0,
        transient: 0,
        adaptiveFloor: cfg.noiseFloorMin,
        adaptiveCeil: 0,
        config: getConfig()
      };
    }

    function startFallback() {
      if (running) return;
      running = true;
      onLevel(0);
      hooks.onLevel?.(0);
      hooks.onStats?.(getTelemetryFallback());
    }

    function stopFallback() {
      if (!running) return;
      running = false;
    }

    function restartFallback(reason = "manual") {
      lastRestartReason = reason;
      return { ok: true, restarted: false, reason };
    }

    return {
      start: startFallback,
      stop: stopFallback,
      onFast(fn) { hooks.onFast = fn; },
      onMid(fn) { hooks.onMid = fn; },
      onSlow(fn) { hooks.onSlow = fn; },
      onTransient(fn) { hooks.onTransient = fn; },
      onLevel(fn) { hooks.onLevel = fn; },
      onStats(fn) { hooks.onStats = fn; },
      getConfig,
      setConfig: setConfigFallback,
      listDevices() { return []; },
      restart: restartFallback,
      getTelemetry: getTelemetryFallback
    };
  }

  function resetState() {
    fast = 0;
    mid = 0;
    slow = 0;
    transient = 0;
    prevFast = 0;
    peakHold = 0;
    tick = 0;

    adaptiveFloor = cfg.noiseFloorMin;
    adaptiveCeil = 0.025;

    lastRms = 0;
    lastPeak = 0;
    lastZcr = 0;
    lastLevelRaw = 0;
    lastLevel = 0;
    lastBandLow = 0;
    lastBandMid = 0;
    lastBandHigh = 0;
    lastSpectralFlux = 0;

    lpLow = 0;
    lpMid = 0;
    prevBandLowRaw = 0;
    prevBandMidRaw = 0;
    prevBandHighRaw = 0;
    lastDataAt = 0;
    watchdogTrips = 0;
  }

  function chooseInputDevice(devices) {
    const inputDevices = devices.filter(d => d.maxInputChannels > 0);
    if (!inputDevices.length) return null;

    if (cfg.deviceId !== null) {
      const byId = inputDevices.find(d => Number(d.id) === cfg.deviceId);
      if (byId) return byId;
      console.warn(`[AUDIO] configured device id ${cfg.deviceId} not found; falling back`);
    }

    if (cfg.deviceMatch) {
      const preferred = inputDevices.find(
        d => d.name && d.name.toLowerCase().includes(cfg.deviceMatch)
      );
      if (preferred) return preferred;
      console.warn(`[AUDIO] device match "${cfg.deviceMatch}" not found; falling back to auto-select`);
    }

    const autoPriorityKeywords = [
      "loopback",
      "stereo mix",
      "what u hear",
      "cable output",
      "virtual cable",
      "monitor of",
      "mix"
    ];
    const autoPreferred = inputDevices.find(device => {
      const name = String(device.name || "").toLowerCase();
      return autoPriorityKeywords.some(keyword => name.includes(keyword));
    });

    return autoPreferred || inputDevices[0];
  }

  function closeStream() {
    if (!stream) return;
    try {
      stream.removeAllListeners?.();
    } catch {}
    try {
      stream.quit?.();
    } catch {}
    stream = null;
  }

  function stopWatchdog() {
    if (watchdogTimer) {
      clearInterval(watchdogTimer);
      watchdogTimer = null;
    }
  }

  function startWatchdog() {
    stopWatchdog();

    const intervalMs = clamp(Math.round(cfg.watchdogMs / 3), 250, 1000);
    watchdogTimer = setInterval(() => {
      if (!running || !stream || !lastDataAt) return;

      const silentMs = Date.now() - lastDataAt;
      if (silentMs < cfg.watchdogMs) return;

      watchdogTrips++;
      lastError = `stream stalled (${silentMs}ms without audio data)`;
      console.warn(`[AUDIO] watchdog: ${lastError}`);
      closeStream();
      scheduleRestart("watchdog stall");
    }, intervalMs);
  }

  function scheduleRestart(reason) {
    if (!running) return;
    if (restartTimer) return;

    lastRestartReason = reason;
    stopWatchdog();
    console.warn(`[AUDIO] restart scheduled (${reason}) in ${cfg.restartMs}ms`);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (!running) return;
      openStream();
    }, cfg.restartMs);
  }

  function processBuffer(buffer, channels) {
    let sumSq = 0;
    let peak = 0;
    let count = 0;
    let zeroCrosses = 0;
    let prevSample = 0;
    let prevSet = false;
    const stride = channels * 4;
    let lowSq = 0;
    let midSq = 0;
    let highSq = 0;
    const lowHz = clamp(cfg.bandLowHz, 60, 500);
    const midHz = Math.max(lowHz + 100, clamp(cfg.bandMidHz, 700, 8000));
    const lowAlpha = 1 - Math.exp((-2 * Math.PI * lowHz) / cfg.sampleRate);
    const midAlpha = 1 - Math.exp((-2 * Math.PI * midHz) / cfg.sampleRate);

    for (let i = 0; i + stride <= buffer.length; i += stride) {
      let s = 0;
      for (let c = 0; c < channels; c++) {
        s += buffer.readFloatLE(i + c * 4);
      }
      s /= channels;

      const a = Math.abs(s);
      if (a > peak) peak = a;
      sumSq += s * s;

      if (prevSet && ((s >= 0 && prevSample < 0) || (s < 0 && prevSample >= 0))) {
        zeroCrosses++;
      }
      prevSample = s;
      prevSet = true;
      count++;

      // Simple crossover split:
      // low = LP(lowCut), mid = LP(midCut) - LP(lowCut), high = input - LP(midCut)
      lpLow += (s - lpLow) * lowAlpha;
      lpMid += (s - lpMid) * midAlpha;

      const lowBand = lpLow;
      const midBand = lpMid - lpLow;
      const highBand = s - lpMid;

      lowSq += lowBand * lowBand;
      midSq += midBand * midBand;
      highSq += highBand * highBand;
    }

    if (!count) return;

    const rms = Math.sqrt(sumSq / count);
    const zcr = zeroCrosses / count;
    const lowRms = Math.sqrt(lowSq / count);
    const midRms = Math.sqrt(midSq / count);
    const highRms = Math.sqrt(highSq / count);
    const bandMagnitude = lowRms + midRms + highRms;
    const absoluteQuietGate = Math.max(cfg.noiseFloorMin * 8, 0.0045);
    const absoluteQuiet =
      rms < absoluteQuietGate &&
      peak < absoluteQuietGate * 3;

    const bandSum = bandMagnitude + 1e-6;
    let bandLowRaw = clamp(lowRms / bandSum, 0, 1);
    let bandMidRaw = clamp(midRms / bandSum, 0, 1);
    let bandHighRaw = clamp(highRms / bandSum, 0, 1);
    if (bandMagnitude < absoluteQuietGate * 1.4 || absoluteQuiet) {
      bandLowRaw = 0;
      bandMidRaw = 0;
      bandHighRaw = 0;
    }

    const fluxRaw =
      Math.max(0, bandLowRaw - prevBandLowRaw) +
      Math.max(0, bandMidRaw - prevBandMidRaw) +
      Math.max(0, bandHighRaw - prevBandHighRaw);
    let fluxNorm = clamp(fluxRaw * 2.4, 0, 1);
    if (absoluteQuiet) {
      fluxNorm = 0;
    }

    prevBandLowRaw = bandLowRaw;
    prevBandMidRaw = bandMidRaw;
    prevBandHighRaw = bandHighRaw;

    lastRms = rms;
    lastPeak = peak;
    lastZcr = zcr;
    lastBandLow += (bandLowRaw - lastBandLow) * (bandLowRaw > lastBandLow ? 0.45 : 0.18);
    lastBandMid += (bandMidRaw - lastBandMid) * (bandMidRaw > lastBandMid ? 0.45 : 0.18);
    lastBandHigh += (bandHighRaw - lastBandHigh) * (bandHighRaw > lastBandHigh ? 0.45 : 0.18);
    lastSpectralFlux += (fluxNorm - lastSpectralFlux) * 0.34;

    // Floor tracks quiet passages quickly and loud passages slowly.
    const floorLerp = rms < adaptiveFloor * 1.5 ? 0.03 : 0.003;
    adaptiveFloor += (rms - adaptiveFloor) * floorLerp;
    adaptiveFloor = Math.max(cfg.noiseFloorMin, adaptiveFloor);

    const gated = Math.max(0, rms - adaptiveFloor * 1.12);

    // Ceiling tracks peaks quickly and releases slowly.
    const ceilingTarget = Math.max(gated * 2.6, peak * 0.9, cfg.noiseFloorMin * 5);
    const ceilLerp = ceilingTarget > adaptiveCeil ? 0.08 : 0.004;
    adaptiveCeil += (ceilingTarget - adaptiveCeil) * ceilLerp;
    adaptiveCeil = clamp(adaptiveCeil, 0.01, 0.65);

    const normalized = clamp(gated / (adaptiveCeil + 1e-6), 0, 1);

    // Envelopes run on normalized energy for better consistency across tracks.
    if (absoluteQuiet) {
      // Collapse stale envelope memory when input is effectively silence/noise floor.
      fast *= 0.7;
      mid *= 0.78;
      slow *= 0.86;
      transient *= 0.62;
      peakHold *= 0.74;
    } else {
      fast += (normalized - fast) * (normalized > fast ? FAST_ATTACK : FAST_RELEASE);
      mid += (normalized - mid) * (normalized > mid ? MID_ATTACK : MID_RELEASE);
      slow += (normalized - slow) * (normalized > slow ? SLOW_ATTACK : SLOW_RELEASE);
    }

    const deltaFast = fast - prevFast;
    prevFast = fast;

    const transientRaw = Math.max(0, deltaFast * 2.3);
    transient += (transientRaw - transient) * 0.45;

    peakHold = Math.max(fast, peakHold * cfg.peakDecay);

    const crest = clamp(peak / (rms + 1e-6), 1, 6);
    const zcrBias = clamp(zcr * 4, 0, 1);
    const punch = clamp(transient * 1.1 + (crest - 1) * 0.08 + zcrBias * 0.06, 0, 1);

    let level =
      peakHold * 2.25 +
      transient * 1.55 +
      mid * 1.35 +
      slow * 1.1 +
      punch * 0.35;

    let levelRaw = level * cfg.outputGain;
    if (absoluteQuiet) {
      levelRaw *= 0.16;
    }
    level = clamp(
      softLimit01(levelRaw, cfg.limiterThreshold, cfg.limiterKnee),
      0,
      1
    );
    if (absoluteQuiet && level < 0.03) level = 0;
    if (level < 0.001) level = 0;
    lastLevelRaw = levelRaw;
    lastLevel = level;

    if ((tick++ % cfg.logEveryTicks) === 0) {
      console.log(
        "[AUDIO]",
        "rms:", rms.toFixed(4),
        "floor:", adaptiveFloor.toFixed(4),
        "ceil:", adaptiveCeil.toFixed(4),
        "fast:", fast.toFixed(3),
        "mid:", mid.toFixed(3),
        "slow:", slow.toFixed(3),
        "bLow:", lastBandLow.toFixed(2),
        "bMid:", lastBandMid.toFixed(2),
        "bHigh:", lastBandHigh.toFixed(2),
        "flux:", lastSpectralFlux.toFixed(2),
        "tr:", transient.toFixed(3),
        "raw:", levelRaw.toFixed(3),
        "lvl:", level.toFixed(3)
      );
    }

    // Backward compatible output
    onLevel(level);

    // Existing hooks
    hooks.onFast?.(fast);
    hooks.onMid?.(mid);
    hooks.onSlow?.(slow);
    hooks.onTransient?.(transient);

    // New hooks
    hooks.onLevel?.(level);
    hooks.onStats?.(getTelemetry());
  }

  function openStream() {
    closeStream();
    lastError = null;

    let devices;
    try {
      devices = naudiodon.getDevices();
    } catch (err) {
      lastError = err.message || String(err);
      console.error("[AUDIO] device scan failed:", err.message || err);
      scheduleRestart("device scan failure");
      return;
    }

    console.log("[AUDIO] scanning devices...");
    devices.forEach(d => {
      console.log(`- ${d.name} | API=${d.hostAPIName} | in=${d.maxInputChannels}`);
    });

    const input = chooseInputDevice(devices);
    if (!input) {
      lastError = "no input devices available";
      console.error("[AUDIO] no input devices available");
      scheduleRestart("no input devices");
      return;
    }

    const channels = Math.max(1, Math.min(cfg.channels, input.maxInputChannels));
    lastDeviceName = input.name || `device:${input.id}`;
    lastDeviceId = input.id;

    console.log(
      `[AUDIO] using: ${lastDeviceName} (${channels}ch @ ${cfg.sampleRate}Hz, fpb=${cfg.framesPerBuffer})`
    );

    try {
      stream = new naudiodon.AudioIO({
        inOptions: {
          deviceId: input.id,
          channelCount: channels,
          sampleFormat: naudiodon.SampleFormatFloat32,
          sampleRate: cfg.sampleRate,
          framesPerBuffer: cfg.framesPerBuffer,
          closeOnError: true
        }
      });
    } catch (err) {
      lastError = err.message || String(err);
      console.error("[AUDIO] stream create failed:", err.message || err);
      scheduleRestart("stream create failure");
      return;
    }

    stream.on("data", buffer => {
      try {
        lastDataAt = Date.now();
        processBuffer(buffer, channels);
      } catch (err) {
        console.error("[AUDIO] process error:", err.message || err);
      }
    });

    stream.on("error", err => {
      lastError = err.message || String(err);
      console.error("[AUDIO ERROR]", err.message || err);
      closeStream();
      scheduleRestart("stream error");
    });

    try {
      stream.start();
      lastDataAt = Date.now();
      startWatchdog();
      console.log("[AUDIO] stream started");
    } catch (err) {
      lastError = err.message || String(err);
      console.error("[AUDIO] stream start failed:", err.message || err);
      closeStream();
      scheduleRestart("stream start failure");
    }
  }

  function start() {
    if (running) return;
    running = true;
    resetState();
    openStream();
  }

  function stop() {
    if (!running) return;
    running = false;

    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }

    stopWatchdog();
    closeStream();
    resetState();

    console.log("[AUDIO] stream stopped");
  }

  function restart(reason = "manual") {
    lastRestartReason = reason;

    if (!running) {
      console.log("[AUDIO] restart skipped (stream is stopped)");
      return { ok: true, restarted: false, reason };
    }

    stopWatchdog();
    closeStream();
    openStream();
    return { ok: true, restarted: true, reason };
  }

  function setConfig(patch = {}, options = {}) {
    const normalized = normalizeCfgPatch(patch);
    const keys = Object.keys(normalized);
    if (!keys.length) {
      return { ok: true, changed: [], config: getConfig(), restarted: false };
    }

    const restartKeys = new Set([
      "sampleRate",
      "framesPerBuffer",
      "channels",
      "deviceMatch",
      "deviceId"
    ]);

    let needsRestart = false;
    for (const key of keys) {
      if (cfg[key] !== normalized[key]) {
        cfg[key] = normalized[key];
        if (restartKeys.has(key)) needsRestart = true;
      }
    }

    const shouldRestart = options.restart !== false && needsRestart && running;
    if (shouldRestart) {
      restart("config change");
    }

    return {
      ok: true,
      changed: keys,
      config: getConfig(),
      restarted: shouldRestart
    };
  }

  function getTelemetry() {
    return {
      running,
      device: lastDeviceName || null,
      deviceId: lastDeviceId,
      restartPending: Boolean(restartTimer),
      watchdogMs: cfg.watchdogMs,
      msSinceData: lastDataAt ? Math.max(0, Date.now() - lastDataAt) : null,
      watchdogTrips,
      lastRestartReason,
      lastError,
      rms: lastRms,
      peak: lastPeak,
      zcr: lastZcr,
      levelRaw: lastLevelRaw,
      level: lastLevel,
      bandLow: lastBandLow,
      bandMid: lastBandMid,
      bandHigh: lastBandHigh,
      spectralFlux: lastSpectralFlux,
      fast,
      mid,
      slow,
      transient,
      adaptiveFloor,
      adaptiveCeil,
      config: getConfig()
    };
  }

  /* =========================
     PUBLIC API (STABLE + EXTENDED)
  ========================= */
  return {
    start,
    stop,

    // Existing optional hooks
    onFast(fn) { hooks.onFast = fn; },
    onMid(fn) { hooks.onMid = fn; },
    onSlow(fn) { hooks.onSlow = fn; },
    onTransient(fn) { hooks.onTransient = fn; },

    // New optional hooks
    onLevel(fn) { hooks.onLevel = fn; },
    onStats(fn) { hooks.onStats = fn; },

    getConfig,
    setConfig,
    listDevices,
    restart,
    getTelemetry
  };
};
