// [TITLE] Module: app/routes/compat/mods.compat.runtime-helpers.js
// [TITLE] Purpose: own shared mod-runtime request/reload helpers for compat routes
// [TITLE] Functionality Index:
// [TITLE] - shape mod action payloads from HTTP requests
// [TITLE] - normalize reload caller metadata and enforce reload cooldown behavior
// [TITLE] - share mod reload behavior across `/mods/*` and rave reload aliases
// [DEV] Complex Flow:
// [DEV] Mod reload is shared between Mods routes and LIVE/rave aliases, so the
// [DEV] helper lives beside compat route slices rather than in the top-level composer.

function createModsCompatRuntimeHelpers(deps = {}) {
  const modRuntime = deps.modRuntime;
  const getRequestMap = typeof deps.getRequestMap === "function"
    ? deps.getRequestMap
    : (value => (value && typeof value === "object" && !Array.isArray(value) ? value : {}));
  const toCompatError = typeof deps.toCompatError === "function"
    ? deps.toCompatError
    : ((res, status, error, detail = "") => {
      res.status(status).json({
        ok: false,
        error,
        detail: String(detail || "").trim()
      });
    });
  const RELOAD_ROUTE_COOLDOWN_MS = 15_000;
  const reloadRuntime = {
    inFlight: false,
    lastStartedAt: 0,
    lastCompletedAt: 0,
    lastRoute: "",
    lastCaller: null,
    totalCompleted: 0
  };

  function getRequestHeadersMap(headers) {
    const source = headers && typeof headers === "object" && !Array.isArray(headers) ? headers : {};
    const out = {};
    for (const [rawKey, rawValue] of Object.entries(source)) {
      const key = String(rawKey || "").trim().toLowerCase();
      if (!key) continue;
      if (Array.isArray(rawValue)) {
        out[key] = rawValue.map(item => String(item ?? ""));
        continue;
      }
      out[key] = String(rawValue ?? "");
    }
    return out;
  }

  function buildReloadCallerMeta(req = {}) {
    const headers = getRequestHeadersMap(req?.headers);
    const forwardedFor = String(headers["x-forwarded-for"] || "").split(",")[0].trim();
    const remoteAddress = String(req?.socket?.remoteAddress || req?.ip || "").trim();
    return {
      ip: forwardedFor || remoteAddress || "",
      method: String(req?.method || "").trim().toUpperCase(),
      path: String(req?.originalUrl || req?.url || "").trim(),
      userAgent: String(headers["user-agent"] || "").trim().slice(0, 240),
      origin: String(headers.origin || "").trim().slice(0, 240),
      referer: String(headers.referer || "").trim().slice(0, 240)
    };
  }

  function normalizeModActionToken(value) {
    return String(value || "").trim();
  }

  function buildModRuntimePayload(req, actionPath = "") {
    return {
      route: {
        method: String(req?.method || "").trim().toUpperCase(),
        actionPath: String(actionPath || "").trim()
      },
      params: getRequestMap(req?.params),
      query: getRequestMap(req?.query),
      body: getRequestMap(req?.body),
      headers: getRequestHeadersMap(req?.headers),
      ip: String(req?.ip || req?.socket?.remoteAddress || "").trim(),
      originalUrl: String(req?.originalUrl || req?.url || "").trim()
    };
  }

  async function handleModsRuntimeReloadRoute(routeLabel = "", req = null, res = null) {
    if (!modRuntime || typeof modRuntime.reload !== "function") {
      toCompatError(res, 503, "mods_runtime_reload_unavailable");
      return;
    }
    const caller = buildReloadCallerMeta(req || {});
    const now = Date.now();
    if (reloadRuntime.inFlight) {
      res.status(202).json({
        ok: true,
        reloaded: false,
        skipped: true,
        reason: "reload_in_flight",
        route: String(routeLabel || ""),
        caller,
        reloadRuntime: {
          inFlight: true,
          lastStartedAt: Number(reloadRuntime.lastStartedAt || 0),
          lastCompletedAt: Number(reloadRuntime.lastCompletedAt || 0),
          lastRoute: String(reloadRuntime.lastRoute || ""),
          totalCompleted: Number(reloadRuntime.totalCompleted || 0)
        }
      });
      return;
    }
    const sinceLastCompletedMs = reloadRuntime.lastCompletedAt > 0
      ? Math.max(0, now - Number(reloadRuntime.lastCompletedAt || 0))
      : Number.MAX_SAFE_INTEGER;
    if (reloadRuntime.lastCompletedAt > 0 && sinceLastCompletedMs < RELOAD_ROUTE_COOLDOWN_MS) {
      res.status(202).json({
        ok: true,
        reloaded: false,
        skipped: true,
        reason: "reload_rate_limited",
        route: String(routeLabel || ""),
        caller,
        cooldownMs: RELOAD_ROUTE_COOLDOWN_MS,
        retryAfterMs: Math.max(0, RELOAD_ROUTE_COOLDOWN_MS - sinceLastCompletedMs),
        lastReload: {
          at: Number(reloadRuntime.lastCompletedAt || 0),
          route: String(reloadRuntime.lastRoute || ""),
          caller: reloadRuntime.lastCaller || null
        }
      });
      return;
    }
    reloadRuntime.inFlight = true;
    reloadRuntime.lastStartedAt = now;
    reloadRuntime.lastRoute = String(routeLabel || "");
    reloadRuntime.lastCaller = caller;
    try {
      const mods = await modRuntime.reload();
      reloadRuntime.lastCompletedAt = Date.now();
      reloadRuntime.totalCompleted = Number(reloadRuntime.totalCompleted || 0) + 1;
      res.json({
        ok: true,
        reloaded: true,
        route: String(routeLabel || ""),
        caller,
        reloadRuntime: {
          totalCompleted: Number(reloadRuntime.totalCompleted || 0),
          lastStartedAt: Number(reloadRuntime.lastStartedAt || 0),
          lastCompletedAt: Number(reloadRuntime.lastCompletedAt || 0)
        },
        mods
      });
    } catch (error) {
      reloadRuntime.lastCompletedAt = Date.now();
      toCompatError(
        res,
        500,
        "mods_runtime_reload_failed",
        String(error?.message || error || "unknown_reload_error")
      );
    } finally {
      reloadRuntime.inFlight = false;
    }
  }

  return {
    normalizeModActionToken,
    buildModRuntimePayload,
    handleModsRuntimeReloadRoute
  };
}

module.exports = {
  createModsCompatRuntimeHelpers
};
