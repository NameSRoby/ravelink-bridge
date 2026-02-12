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
    skippedDelta: 0
  };

  const MIN_INTERVAL = 260; // ms
  const DELTA = {
    hue: 420,
    bri: 6,
    sat: 6
  };

  function remember(state, now) {
    last.hue = state.hue;
    last.bri = state.bri;
    last.sat = state.sat;
    last.sentAt = now;
  }

  function shouldSend(state, options = {}) {
    const now = Date.now();
    const minIntervalMs = Math.max(60, Number(options.minIntervalMs || MIN_INTERVAL));
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

    const hueDelta = Math.abs(state.hue - last.hue);
    const briDelta = Math.abs(state.bri - last.bri);
    const satDelta = Math.abs(state.sat - last.sat);

    const hueLimit = DELTA.hue * deltaScale;
    const briLimit = DELTA.bri * deltaScale;
    const satLimit = DELTA.sat * deltaScale;

    if (!forceDelta && hueDelta < hueLimit && briDelta < briLimit && satDelta < satLimit) {
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
