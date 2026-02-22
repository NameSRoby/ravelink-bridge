"use strict";

module.exports = function registerRaveSceneSyncRoutes(app, deps = {}) {
  const getEngine = typeof deps.getEngine === "function"
    ? deps.getEngine
    : () => deps.engine || null;
  const parseEnabledFlagForRoute = typeof deps.parseEnabledFlagForRoute === "function"
    ? deps.parseEnabledFlagForRoute
    : null;

  function getWizSceneSyncEnabled() {
    const engine = getEngine();
    return Boolean(engine?.getWizSceneSync?.() ?? engine?.getTelemetry?.()?.wizSceneSync ?? false);
  }

  function setWizSceneSyncRoute(req, res, enabledFallback = null) {
    if (!parseEnabledFlagForRoute) {
      res.status(500).json({ ok: false, error: "enabled parser unavailable" });
      return;
    }
    const enabled = parseEnabledFlagForRoute(req, res, {
      fallback: enabledFallback,
      requireInput: true
    });
    if (enabled === null) return;

    const engine = getEngine();
    engine?.setWizSceneSync?.(enabled);
    const next = getWizSceneSyncEnabled();
    console.log(
      next
        ? "[RAVE] WiZ scene sync enabled (Hue-linked scenes)"
        : "[RAVE] WiZ standalone scene mode enabled"
    );
    res.json({
      ok: true,
      enabled: Boolean(next),
      strategy: next ? "linked" : "standalone",
      enforced: false,
      requested: Boolean(enabled)
    });
  }

  function buildSceneSyncStatusResponse(includeBrands = false) {
    const enabled = getWizSceneSyncEnabled();
    const payload = {
      ok: true,
      enabled,
      strategy: enabled ? "linked" : "standalone",
      enforced: false
    };
    if (includeBrands) payload.brands = ["hue", "wiz"];
    return payload;
  }

  const SCENE_SYNC_ROUTE_GROUPS = Object.freeze([
    { base: "/rave/wiz/sync", includeBrands: false },
    { base: "/rave/scene/sync", includeBrands: true } // Generic alias for future multi-brand scene-link expansion.
  ]);

  for (const group of SCENE_SYNC_ROUTE_GROUPS) {
    app.post(group.base, (req, res) => setWizSceneSyncRoute(req, res));
    app.post(`${group.base}/on`, (req, res) => setWizSceneSyncRoute(req, res, true));
    app.post(`${group.base}/off`, (req, res) => setWizSceneSyncRoute(req, res, false));
    app.get(group.base, (_, res) => {
      res.json(buildSceneSyncStatusResponse(group.includeBrands));
    });
  }
};
