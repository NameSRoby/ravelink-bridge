// [TITLE] Module: core/hue-scheduler.js
// [TITLE] Purpose: hue-scheduler

/**
 * HUE SCHEDULER
 * - rate guard
 * - delta guard
 * - lightweight telemetry
 */
module.exports = function createHueScheduler() {
  const last = {
    hue: null,
    bri: null,
    sat: null,
    sentAt: 0
  };

  const telemetry = {
    sent: 0,
    skippedRate: 0,
    skippedDelta: 0,
    forcedHeartbeat: 0
  };

  const MIN_INTERVAL = 218; // ms
  const MAX_SILENCE_MS = 900; // force a refresh when delta stays tiny too long
  const DELTA = {
    hue: 300,
    bri: 5,
    sat: 5
  };

  function remember(state, now) {
    last.hue = state.hue;
    last.bri = state.bri;
    last.sat = state.sat;
    last.sentAt = now;
  }

  function shouldSend(state, options = {}) {
    const now = Date.now();
    const minIntervalMs = Math.max(58, Number(options.minIntervalMs || MIN_INTERVAL));
    const maxSilenceMs = Math.max(
      minIntervalMs,
      Number(options.maxSilenceMs || MAX_SILENCE_MS)
    );
    const forceDelta = Boolean(options.forceDelta);
    const deltaScale = Math.max(0.2, Number(options.deltaScale || 1));

    if (now - last.sentAt < minIntervalMs) {
      telemetry.skippedRate++;
      return false;
    }

    if (last.hue === null) {
      remember(state, now);
      telemetry.sent++;
      return true;
    }

    // Hue is circular (0..65535); use shortest arc distance to avoid wrap spikes.
    const hueRawDelta = Math.abs(state.hue - last.hue);
    const hueDelta = Math.min(hueRawDelta, Math.max(0, 65535 - hueRawDelta));
    const briDelta = Math.abs(state.bri - last.bri);
    const satDelta = Math.abs(state.sat - last.sat);

    // At high rates, lower delta thresholds so color motion keeps "nervous" detail.
    const rateReactiveScale = minIntervalMs <= 105
      ? 0.72
      : (minIntervalMs <= 140 ? 0.84 : (minIntervalMs <= 190 ? 0.94 : 1));
    const triggerBoost = Math.max(0, Math.min(1, Number(options.triggerBoost || 0)));
    const triggerScale = 1 - (triggerBoost * 0.22);
    const tunedDeltaScale = Math.max(0.2, deltaScale * rateReactiveScale * triggerScale);
    const hueLimit = DELTA.hue * tunedDeltaScale;
    const briLimit = DELTA.bri * tunedDeltaScale;
    const satLimit = DELTA.sat * tunedDeltaScale;

    if (!forceDelta && hueDelta < hueLimit && briDelta < briLimit && satDelta < satLimit) {
      if (now - last.sentAt >= maxSilenceMs) {
        remember(state, now);
        telemetry.sent++;
        telemetry.forcedHeartbeat++;
        return true;
      }
      telemetry.skippedDelta++;
      return false;
    }

    remember(state, now);
    telemetry.sent++;
    return true;
  }

  function reset() {
    last.hue = null;
    last.bri = null;
    last.sat = null;
    last.sentAt = 0;
  }

  function getTelemetry() {
    return telemetry;
  }

  return {
    shouldSend,
    reset,
    getTelemetry
  };
};
