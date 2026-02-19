// [TITLE] Module: adapters/wiz-adapter.js
// [TITLE] Purpose: wiz-adapter

/**
 * WiZ adapter (firmware-specific behavior retained):
 * - broadcast-enabled UDP socket
 * - targeted send to fixture IP
 */
const dgram = require("dgram");

module.exports = function createWizAdapter({ ip }) {
  if (!ip) {
    console.warn("[WIZ] adapter disabled (no IP)");
    const noop = () => {};
    noop.close = () => {};
    return noop;
  }

  const socket = dgram.createSocket("udp4");

  socket.on("error", err => {
    console.error("[WIZ SOCKET ERROR]", err.message);
  });

  socket.bind(() => {
    // Some WiZ firmware only responds reliably when socket has broadcast enabled.
    try {
      socket.setBroadcast(true);
    } catch {}
    console.log(`[WIZ] UDP socket ready for ${ip}`);
  });

  const setWizColor = (state, options = {}) => {
    const source = state && typeof state === "object" ? state : {};
    const on = source.on !== false;

    const payload = {
      method: "setPilot",
      params: {
        state: on
      }
    };

    if (Number.isFinite(Number(source.dimming))) {
      payload.params.dimming = Math.max(1, Math.min(100, Math.round(Number(source.dimming))));
    } else {
      payload.params.dimming = on ? 50 : 1;
    }

    if (on && Number.isFinite(Number(source.temp))) {
      payload.params.temp = Math.max(2200, Math.min(6500, Math.round(Number(source.temp))));
    } else if (
      on &&
      Number.isFinite(Number(source.r)) &&
      Number.isFinite(Number(source.g)) &&
      Number.isFinite(Number(source.b))
    ) {
      payload.params.r = Math.max(0, Math.min(255, Math.round(Number(source.r))));
      payload.params.g = Math.max(0, Math.min(255, Math.round(Number(source.g))));
      payload.params.b = Math.max(0, Math.min(255, Math.round(Number(source.b))));
    }

    const msg = Buffer.from(JSON.stringify(payload));
    const repeats = Math.max(1, Math.min(3, Math.round(options.repeats || 1)));
    const repeatDelayMs = Math.max(8, Math.min(120, Math.round(options.repeatDelayMs || 18)));

    for (let i = 0; i < repeats; i++) {
      if (i === 0) {
        socket.send(msg, 38899, ip);
      } else {
        setTimeout(() => {
          try {
            socket.send(msg, 38899, ip);
          } catch {}
        }, i * repeatDelayMs);
      }
    }
  };

  setWizColor.close = () => {
    try {
      socket.close();
    } catch {}
  };

  return setWizColor;
};
