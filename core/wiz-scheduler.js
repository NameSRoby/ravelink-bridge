// [TITLE] Module: core/wiz-scheduler.js
// [TITLE] Purpose: wiz-scheduler

/**
 * WIZ SCHEDULER
 * - rate guard
 * - delta guard
 * - lightweight telemetry
 */
module.exports = function createWizScheduler() {
  const last = {
    r: null,
    g: null,
    b: null,
    dimming: null,
    sentAt: 0
  };

  const telemetry = {
    sent: 0,
    skippedRate: 0,
    skippedDelta: 0,
    forcedHeartbeat: 0
  };

  const MIN_INTERVAL = 90; // ms
  const MAX_SILENCE_MS = 700; // force periodic refresh to avoid long static stalls
  const DELTA = {
    r: 4,
    g: 4,
    b: 4,
    dimming: 1
  };

  function remember(state, now) {
    last.r = state.r;
    last.g = state.g;
    last.b = state.b;
    last.dimming = state.dimming;
    last.sentAt = now;
  }

  function shouldSend(state, options = {}) {
    const now = Date.now();
    const minIntervalMs = Math.max(30, Number(options.minIntervalMs || MIN_INTERVAL));
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

    if (last.r === null) {
      remember(state, now);
      telemetry.sent++;
      return true;
    }

    const rDelta = Math.abs(state.r - last.r);
    const gDelta = Math.abs(state.g - last.g);
    const bDelta = Math.abs(state.b - last.b);
    const dimmingDelta = Math.abs(state.dimming - last.dimming);

    const rLimit = DELTA.r * deltaScale;
    const gLimit = DELTA.g * deltaScale;
    const bLimit = DELTA.b * deltaScale;
    const dimmingLimit = DELTA.dimming * deltaScale;

    if (
      !forceDelta &&
      rDelta < rLimit &&
      gDelta < gLimit &&
      bDelta < bLimit &&
      dimmingDelta < dimmingLimit
    ) {
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
    last.r = null;
    last.g = null;
    last.b = null;
    last.dimming = null;
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
