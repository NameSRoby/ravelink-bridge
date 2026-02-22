"use strict";

module.exports = function registerSystemRoutes(app, deps = {}) {
  const isLoopbackRequest = deps.isLoopbackRequest;
  const getRequestMap = typeof deps.getRequestMap === "function"
    ? deps.getRequestMap
    : (value => (value && typeof value === "object" ? value : {}));
  const patchSystemConfig = deps.patchSystemConfig;
  const getSystemConfigSnapshot = deps.getSystemConfigSnapshot;
  const getHueTransport = typeof deps.getHueTransport === "function"
    ? deps.getHueTransport
    : () => ({ desired: "", active: "", fallbackReason: "" });
  const getPreferredHueTransportMode = deps.getPreferredHueTransportMode;
  const setHueTransportMode = deps.setHueTransportMode;
  const settleWithTimeout = deps.settleWithTimeout;
  const HUE_TRANSPORT = deps.HUE_TRANSPORT || {};
  const HUE_ENT_MODE_SWITCH_TIMEOUT_MS = Number(deps.HUE_ENT_MODE_SWITCH_TIMEOUT_MS || 0);
  const HUE_REST_MODE_SWITCH_TIMEOUT_MS = Number(deps.HUE_REST_MODE_SWITCH_TIMEOUT_MS || 0);
  const scheduleHueEntertainmentRecovery = deps.scheduleHueEntertainmentRecovery;
  const shutdown = deps.shutdown;

  app.get("/system/config", (_, res) => {
    res.json({
      ok: true,
      config: getSystemConfigSnapshot()
    });
  });

  app.post("/system/config", async (req, res) => {
    if (typeof isLoopbackRequest === "function" && !isLoopbackRequest(req)) {
      res.status(403).json({
        ok: false,
        error: "forbidden",
        detail: "system config updates are allowed only from local loopback requests"
      });
      return;
    }

    const payload = getRequestMap(req.body);
    const patched = patchSystemConfig(payload);
    if (!patched.ok) {
      res.status(Number(patched.status) || 400).json({
        ok: false,
        error: patched.error || "invalid_system_config_patch",
        detail: patched.detail || "invalid system config update"
      });
      return;
    }

    const hueTransport = getHueTransport();
    let transport = {
      desired: hueTransport.desired,
      active: hueTransport.active,
      fallbackReason: hueTransport.fallbackReason
    };

    try {
      const preferredHueMode = getPreferredHueTransportMode();
      transport = await settleWithTimeout(
        setHueTransportMode(preferredHueMode),
        preferredHueMode === HUE_TRANSPORT.ENTERTAINMENT
          ? HUE_ENT_MODE_SWITCH_TIMEOUT_MS
          : HUE_REST_MODE_SWITCH_TIMEOUT_MS,
        () => {
          const latest = getHueTransport();
          return {
            desired: latest.desired,
            active: latest.active,
            fallbackReason: preferredHueMode === HUE_TRANSPORT.ENTERTAINMENT
              ? "entertainment switch timeout"
              : "rest switch timeout"
          };
        }
      );
      if (
        preferredHueMode === HUE_TRANSPORT.ENTERTAINMENT &&
        transport.active !== HUE_TRANSPORT.ENTERTAINMENT
      ) {
        scheduleHueEntertainmentRecovery("system_config");
      }
    } catch (err) {
      console.warn("[SYSTEM] hue transport preference apply failed:", err?.message || err);
    }

    res.json({
      ok: true,
      config: patched.config,
      transport
    });
  });

  app.post("/system/stop", (req, res) => {
    if (typeof isLoopbackRequest === "function" && !isLoopbackRequest(req)) {
      res.status(403).json({
        ok: false,
        error: "forbidden",
        detail: "system stop is allowed only from local loopback requests"
      });
      return;
    }

    res.json({
      ok: true,
      message: "shutdown requested"
    });

    setTimeout(() => {
      shutdown("api_stop", 0).catch(err => {
        console.error("[SYS] api stop failed:", err.message || err);
        process.exit(1);
      });
    }, 120);
  });
};
