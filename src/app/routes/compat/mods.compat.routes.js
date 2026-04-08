// [TITLE] Module: app/routes/compat/mods.compat.routes.js
// [TITLE] Purpose: register Mods compatibility routes for current UI/runtime contracts
// [TITLE] Functionality Index:
// [TITLE] - mods list/config/runtime/debug compatibility endpoints
// [TITLE] - mod hook/action passthrough routes and UI asset serving
// [DEV] Complex Flow:
// [DEV] This slice preserves current mod route behavior while shrinking the
// [DEV] top-level compat registrar toward composition-only ownership.

const fs = require("node:fs");
const { parseBoolean } = require("../../../shared/validation/parse-boolean");
const { createModsCompatRuntimeHelpers } = require("./mods.compat.runtime-helpers");

module.exports = function registerModsCompatRoutes(app, deps = {}) {
  const modRuntime = deps.modRuntime;
  const enforceWriteAccess = typeof deps.enforceWriteAccess === "function"
    ? deps.enforceWriteAccess
    : ((_req, _res, next) => next());
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
  const runtimeHelpers = createModsCompatRuntimeHelpers({
    modRuntime,
    getRequestMap,
    toCompatError
  });
  const handleModsRuntimeReloadRoute = typeof deps.handleModsRuntimeReloadRoute === "function"
    ? deps.handleModsRuntimeReloadRoute
    : runtimeHelpers.handleModsRuntimeReloadRoute;
  const normalizeModActionToken = typeof deps.normalizeModActionToken === "function"
    ? deps.normalizeModActionToken
    : runtimeHelpers.normalizeModActionToken;
  const buildModRuntimePayload = typeof deps.buildModRuntimePayload === "function"
    ? deps.buildModRuntimePayload
    : runtimeHelpers.buildModRuntimePayload;

  async function respondModAction(req, res, modId, action = "", method = "GET") {
    const normalizedAction = normalizeModActionToken(action);
    const normalizedMethod = String(method || req?.method || "GET").trim().toUpperCase() || "GET";
    const result = await modRuntime.invokeAction(
      String(modId || "").trim(),
      normalizedAction,
      normalizedMethod,
      buildModRuntimePayload(req, normalizedAction)
    );
    res.status(Number(result?.status || 200)).json(result?.body || { ok: false, error: "mod_action_failed" });
  }

  function handleModUiAssetRequest(modIdRaw = "", assetPathRaw = "", res) {
    const modId = String(modIdRaw || "").trim();
    const assetPath = String(assetPathRaw || "").trim();
    const resolved = modRuntime.resolveUiAsset(modId, assetPath);
    if (!resolved?.ok) {
      toCompatError(res, 404, String(resolved?.error || "mod_ui_asset_not_found"), modId);
      return;
    }
    if (!fs.existsSync(resolved.filePath)) {
      toCompatError(res, 404, "mod_ui_asset_not_found", modId);
      return;
    }
    res.sendFile(resolved.filePath);
  }

  // [TITLE] Section: Mods Compatibility Routes
  app.get("/mods", (_req, res) => {
    res.json(modRuntime.list());
  });

  app.get("/mods/config", (_req, res) => {
    const snapshot = modRuntime.list();
    res.json({
      ok: true,
      config: snapshot?.config || { enabled: [], order: [], disabled: [] }
    });
  });

  app.get("/mods/runtime", (_req, res) => {
    res.json({
      ok: true,
      runtime: modRuntime.list(),
      supportedHooks: modRuntime.getSupportedHooks()
    });
  });

  app.get("/mods/hooks", (_req, res) => {
    const snapshot = modRuntime.list();
    const hooks = snapshot.mods.reduce((map, mod) => {
      map[String(mod.id || "")] = Array.isArray(mod.hooks) ? mod.hooks : [];
      return map;
    }, {});
    res.json({
      ok: true,
      supportedHooks: modRuntime.getSupportedHooks(),
      hooks
    });
  });

  app.post("/mods/hooks/:hook", enforceWriteAccess, async (req, res) => {
    const hook = String(req.params.hook || "").trim();
    if (!hook) {
      toCompatError(res, 400, "missing_hook_name");
      return;
    }
    const body = getRequestMap(req.body);
    const payload = body.payload !== undefined ? body.payload : body;
    const result = await modRuntime.invokeHook(hook, payload);
    res.status(result?.ok === false ? 400 : 200).json(result);
  });

  app.get("/mods/debug", (req, res) => {
    const body = getRequestMap(req.query);
    const enabled = parseBoolean(body.enabled, false);
    const snapshot = modRuntime.list();
    const debug = snapshot?.debug || {
      enabled,
      telemetryDebugSampleMs: enabled ? 250 : 0,
      telemetryNoHandlerDebugMs: enabled ? 1000 : 0
    };
    res.json({
      ok: true,
      debug
    });
  });

  app.get("/mods/ui/catalog", (_req, res) => {
    res.json(modRuntime.getUiCatalog());
  });

  app.get("/docs/mods/readme", (_req, res) => {
    const guide = [
      "# RaveLink Mods Quick Guide",
      "",
      "1. Add or import mod folders into `mods/`.",
      "2. Ensure each mod has `mod.json` with id/name/version/entry.",
      "3. Enable mods with `/mods/config` (enabled/order/disabled arrays).",
      "4. Reload runtime with `/mods/reload`.",
      "5. Use `/mods/runtime` and `/mods/hooks` to inspect runtime state."
    ].join("\n");
    res.type("text/markdown").send(guide);
  });

  app.post("/mods/reload", enforceWriteAccess, async (req, res) => {
    await handleModsRuntimeReloadRoute("/mods/reload", req, res);
  });

  app.post("/mods/debug", enforceWriteAccess, (req, res) => {
    const body = getRequestMap(req.body);
    const result = modRuntime.setDebugEnabled(body.enabled === true);
    res.json(result);
  });

  app.post("/mods/debug/clear", enforceWriteAccess, (_req, res) => {
    res.json(modRuntime.clearDebugBuffer());
  });

  app.post("/mods/import", enforceWriteAccess, async (req, res) => {
    const result = await modRuntime.importMods(getRequestMap(req.body));
    if (!result.ok) {
      toCompatError(res, 400, String(result.error || "mod_import_failed"), String(result.modId || ""));
      return;
    }
    res.json(result);
  });

  app.post("/mods/config", enforceWriteAccess, async (req, res) => {
    const result = await modRuntime.updateConfig(getRequestMap(req.body));
    if (!result.ok) {
      toCompatError(res, 400, String(result.error || "mod_config_update_failed"));
      return;
    }
    res.json(result);
  });

  app.post("/mods/:modId/:action", enforceWriteAccess, async (req, res) => {
    await respondModAction(req, res, req.params.modId, req.params.action, "POST");
  });

  app.get("/mods/:modId/:action", async (req, res) => {
    await respondModAction(req, res, req.params.modId, req.params.action, "GET");
  });

  app.get("/mods/:modId", async (req, res) => {
    const modId = String(req.params.modId || "").trim();
    const result = await modRuntime.invokeAction(
      modId,
      "",
      "GET",
      buildModRuntimePayload(req, "")
    );
    res.status(Number(result?.status || 200)).json(result?.body || { ok: false, error: "mod_not_found" });
  });

  app.all(/^\/mods\/([^/]+)\/(.+)$/, async (req, res, next) => {
    const rawModId = String(req.params?.[0] || "").trim();
    const rawActionPath = String(req.params?.[1] || "").trim();
    const actionPath = rawActionPath.replace(/^\/+/, "");
    if (!rawModId || !actionPath || !actionPath.includes("/")) {
      next();
      return;
    }
    const method = String(req.method || "").trim().toUpperCase() || "GET";
    if (method !== "GET") {
      enforceWriteAccess(req, res, async () => {
        await respondModAction(req, res, rawModId, actionPath, method);
      });
      return;
    }
    await respondModAction(req, res, rawModId, actionPath, method);
  });

  // [DEV] Canonical mods-ui compatibility route:
  // [DEV] supports /mods-ui/:modId, /mods-ui/:modId/, and nested assets.
  app.get(/^\/mods-ui\/([^/]+)\/?(.*)$/, (req, res) => {
    handleModUiAssetRequest(req.params?.[0], req.params?.[1], res);
  });
};
