"use strict";

module.exports = function registerRaveOverclockRoutes(app, deps = {}) {
  const getEngine = typeof deps.getEngine === "function"
    ? deps.getEngine
    : () => deps.engine || null;

  const UNSAFE_OVERCLOCK_TIERS = Object.freeze({
    "20": { hz: 20, tier: "turbo20", level: 8, name: "DEV 20Hz" },
    "30": { hz: 30, tier: "turbo30", level: 9, name: "DEV 30Hz" },
    "40": { hz: 40, tier: "turbo40", level: 10, name: "DEV 40Hz" },
    "50": { hz: 50, tier: "turbo50", level: 11, name: "DEV 50Hz" },
    "60": { hz: 60, tier: "turbo60", level: 12, name: "DEV 60Hz" }
  });

  const UNSAFE_OVERCLOCK_BY_TIER = Object.freeze(
    Object.values(UNSAFE_OVERCLOCK_TIERS).reduce((acc, item) => {
      acc[item.tier] = item;
      acc[`x${item.hz}`] = item;
      acc[`dev${item.hz}`] = item;
      acc[`unsafe${item.hz}`] = item;
      acc[`destructive${item.hz}`] = item;
      return acc;
    }, {})
  );

  function hasUnsafeOverclockAck(req) {
    const raw = String(
      req.query.unsafe ??
      req.query.confirm ??
      req.query.ack ??
      req.body?.unsafe ??
      req.body?.confirm ??
      req.body?.ack ??
      ""
    ).trim().toLowerCase();

    return (
      raw === "1" ||
      raw === "true" ||
      raw === "yes" ||
      raw === "on" ||
      raw === "unsafe"
    );
  }

  function unsafeOverclockRejected(res, requested = "") {
    res.status(400).json({
      ok: false,
      error: "unsafe acknowledgement required",
      requested: String(requested || ""),
      requiredQuery: "unsafe=true",
      warning: "Destructive overclock tiers can cause unstable or unpredictable behavior."
    });
  }

  function applyUnsafeOverclockHzRoute(req, res, rawHz) {
    const key = String(rawHz || "").trim();
    const spec = UNSAFE_OVERCLOCK_TIERS[key];
    if (!spec) {
      res.status(400).json({
        ok: false,
        error: "invalid dev overclock hz",
        allowedHz: Object.keys(UNSAFE_OVERCLOCK_TIERS).map(v => Number(v))
      });
      return;
    }
    if (!hasUnsafeOverclockAck(req)) {
      unsafeOverclockRejected(res, spec.tier);
      return;
    }

    const engine = getEngine();
    engine?.setOverclock?.(spec.tier);
    console.warn(`[RAVE] UNSAFE overclock ${spec.name} enabled`);
    res.json({
      ok: true,
      unsafe: true,
      tier: spec.tier,
      hz: spec.hz,
      level: spec.level
    });
  }

  const OVERCLOCK_PRESET_ROUTES = Object.freeze([
    { path: "/rave/overclock/on", value: "fast", log: "[RAVE] overclock SLOW 4Hz" },
    { path: "/rave/overclock/off", value: 0, log: "[RAVE] overclock SLOW 2Hz" },
    { path: "/rave/overclock/turbo/on", value: "turbo6", log: "[RAVE] overclock TURBO 6Hz" },
    { path: "/rave/overclock/turbo/off", value: "fast", log: "[RAVE] overclock TURBO OFF -> FAST" },
    { path: "/rave/overclock/ultra/on", value: "turbo8", log: "[RAVE] overclock ULTRA 8Hz" },
    { path: "/rave/overclock/extreme/on", value: "turbo10", log: "[RAVE] overclock EXTREME 10Hz" },
    { path: "/rave/overclock/insane/on", value: "turbo12", log: "[RAVE] overclock INSANE 12Hz" },
    { path: "/rave/overclock/hyper/on", value: "turbo14", log: "[RAVE] overclock HYPER 14Hz" },
    { path: "/rave/overclock/ludicrous/on", value: "turbo16", log: "[RAVE] overclock LUDICROUS 16Hz" }
  ]);

  for (const route of OVERCLOCK_PRESET_ROUTES) {
    app.post(route.path, (_, res) => {
      const engine = getEngine();
      engine?.setOverclock?.(route.value);
      console.log(route.log);
      res.sendStatus(200);
    });
  }

  app.post("/rave/overclock/dev/:hz/on", (req, res) => {
    applyUnsafeOverclockHzRoute(req, res, req.params.hz);
  });

  app.post("/rave/overclock/dev/hz", (req, res) => {
    const value = req.query.value ?? req.query.hz ?? req.body?.value ?? req.body?.hz;
    applyUnsafeOverclockHzRoute(req, res, value);
  });

  app.get("/rave/overclock/tiers", (_, res) => {
    const safe = [
      { level: 0, hz: 2, tier: "normal", label: "SLOW 2Hz" },
      { level: 1, hz: 4, tier: "fast", label: "SLOW 4Hz" },
      { level: 2, hz: 6, tier: "turbo6", label: "DEFAULT 6Hz" },
      { level: 3, hz: 8, tier: "turbo8", label: "ULTRA 8Hz" },
      { level: 4, hz: 10, tier: "turbo10", label: "EXTREME 10Hz" },
      { level: 5, hz: 12, tier: "turbo12", label: "INSANE 12Hz" },
      { level: 6, hz: 14, tier: "turbo14", label: "HYPER 14Hz" },
      { level: 7, hz: 16, tier: "turbo16", label: "LUDICROUS 16Hz" }
    ];
    const unsafe = Object.values(UNSAFE_OVERCLOCK_TIERS).map(item => ({
      level: item.level,
      hz: item.hz,
      tier: item.tier,
      label: item.name,
      unsafe: true,
      route: `/rave/overclock/dev/${item.hz}/on?unsafe=true`
    }));

    res.json({
      ok: true,
      safe,
      unsafe,
      warning: "Unsafe tiers are manual-only and require explicit acknowledgement."
    });
  });

  const OVERCLOCK_TIER_ALIASES = Object.freeze({
    turbo16: "turbo16",
    x16: "turbo16",
    ludicrous: "turbo16",
    turbo14: "turbo14",
    x14: "turbo14",
    hyper: "turbo14",
    turbo12: "turbo12",
    x12: "turbo12",
    insane: "turbo12",
    turbo10: "turbo10",
    x10: "turbo10",
    extreme: "turbo10",
    turbo8: "turbo8",
    x8: "turbo8",
    ultra: "turbo8",
    turbo6: "turbo6",
    turbo: "turbo6",
    x6: "turbo6",
    default: "turbo6"
  });

  function resolveOverclockTier(rawTier) {
    const tier = String(rawTier || "").toLowerCase().trim();
    if (!tier) return "fast";
    if (UNSAFE_OVERCLOCK_BY_TIER[tier]) return UNSAFE_OVERCLOCK_BY_TIER[tier].tier;
    return OVERCLOCK_TIER_ALIASES[tier] || "fast";
  }

  app.post("/rave/overclock", (req, res) => {
    const enabled = req.query.enabled === "true";
    const tier = String(req.query.tier || "").toLowerCase();
    const unsafeTier = UNSAFE_OVERCLOCK_BY_TIER[tier];
    const engine = getEngine();

    if (!enabled) {
      engine?.setOverclock?.(0);
    } else {
      if (unsafeTier && !hasUnsafeOverclockAck(req)) {
        unsafeOverclockRejected(res, tier);
        return;
      }
      engine?.setOverclock?.(resolveOverclockTier(tier));
    }

    res.sendStatus(200);
  });
};
