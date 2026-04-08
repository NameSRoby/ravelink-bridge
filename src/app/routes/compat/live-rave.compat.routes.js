// [TITLE] Module: app/routes/compat/live-rave.compat.routes.js
// [TITLE] Purpose: register live/rave compatibility routes for current UI/runtime contracts
// [TITLE] Functionality Index:
// [TITLE] - live compatibility and trigger-matrix routes
// [TITLE] - rave scene/palette/pipeline/overclock compatibility aliases
// [TITLE] - rave panic and reload passthrough routes
// [DEV] Complex Flow:
// [DEV] This slice keeps live-compat state and rave alias routes together because
// [DEV] the current UI still treats them as one operational surface.

const { parseBoolean } = require("../../../shared/validation/parse-boolean");
const { createModsCompatRuntimeHelpers } = require("./mods.compat.runtime-helpers");
const {
  buildEnginePaletteSequenceFromConfig,
  deriveEnginePaletteHoldTicksFromConfig
} = require("../../../domains/palette/palette-sequence-resolver");

function normalizeLegacySceneLockToken(value, fallback = "auto") {
  const token = String(value || "").trim().toLowerCase();
  if (!token) return fallback;
  if (token === "auto") return "auto";
  if (token === "steady" || token === "calm" || token === "idle") return "steady";
  if (token === "motion" || token === "flow" || token === "groove") return "motion";
  if (token === "impact" || token === "pulse" || token === "drop") return "impact";
  return fallback;
}

module.exports = function registerLiveRaveCompatRoutes(app, deps = {}) {
  const liveCompatService = deps.liveCompatService;
  const engineV2 = deps.engineV2;
  const audioEngine = deps.audioEngine;
  const fixtureRegistry = deps.fixtureRegistry;
  const enginePaletteService = deps.enginePaletteService;
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
  const normalizeToken = typeof deps.normalizeToken === "function"
    ? deps.normalizeToken
    : ((value, max = 96) => String(value || "").trim().slice(0, Math.max(1, Number(max) || 96)));
  const modsRuntimeHelpers = createModsCompatRuntimeHelpers({
    modRuntime: deps.modRuntime,
    getRequestMap,
    toCompatError
  });
  const handleModsRuntimeReloadRoute = typeof deps.handleModsRuntimeReloadRoute === "function"
    ? deps.handleModsRuntimeReloadRoute
    : modsRuntimeHelpers.handleModsRuntimeReloadRoute;

  // [TITLE] Section: LIVE Compatibility Routes
  app.get("/rave/live/compatibility", (_req, res) => {
    res.json(liveCompatService.getCompatibility());
  });

  app.post("/rave/live/compatibility", enforceWriteAccess, (req, res) => {
    const result = liveCompatService.patchCompatibility(getRequestMap(req.body));
    res.json(result);
  });

  app.get("/rave/live/trigger-matrix", (_req, res) => {
    res.json(liveCompatService.getTriggerMatrix());
  });

  app.post("/rave/live/trigger-matrix", enforceWriteAccess, (req, res) => {
    const result = liveCompatService.patchTriggerMatrix(getRequestMap(req.body));
    res.json(result);
  });

  // [TITLE] Section: LIVE Sync Group Routes
  // [DEV] Dedicated routes keep fixture sync/desync group contracts explicit while
  // [DEV] still persisting under trigger-matrix state ownership.
  app.get("/rave/live/sync-groups", (_req, res) => {
    res.json(liveCompatService.getSyncGroups());
  });

  app.post("/rave/live/sync-groups", enforceWriteAccess, (req, res) => {
    const result = liveCompatService.patchSyncGroups(getRequestMap(req.body));
    res.json(result);
  });

  app.post("/rave/scene/auto", enforceWriteAccess, (_req, res) => {
    const result = liveCompatService.patchCompatibility({
      sceneLock: "auto"
    });
    res.json({
      ok: result?.ok === true,
      sceneIntent: result?.applied?.sceneIntent || "auto",
      sceneLock: result?.applied?.sceneLock || "auto",
      brightnessScene: result?.applied?.sceneIntent || "auto",
      snapshot: result?.snapshot || {}
    });
  });

  app.post("/rave/scene", enforceWriteAccess, (req, res) => {
    const requested = normalizeLegacySceneLockToken(
      req?.query?.name ?? req?.body?.name ?? req?.query?.sceneLock ?? req?.body?.sceneLock,
      "auto"
    );
    const result = liveCompatService.patchCompatibility({
      sceneLock: requested
    });
    res.json({
      ok: result?.ok === true,
      sceneIntent: result?.applied?.sceneIntent || requested,
      sceneLock: result?.applied?.sceneLock || requested,
      brightnessScene: result?.applied?.sceneIntent || requested,
      snapshot: result?.snapshot || {}
    });
  });

  app.post("/rave/drop", enforceWriteAccess, (_req, res) => {
    if (engineV2 && typeof engineV2.queueControlEvent === "function") {
      engineV2.queueControlEvent({
        owner: "compat",
        type: "drop_trigger",
        at: Date.now(),
        payload: {
          reason: "compat_rave_drop_route"
        }
      });
      res.json({
        ok: true,
        dropped: true
      });
      return;
    }
    res.json({
      ok: true,
      dropped: false,
      reason: "engine_drop_trigger_unavailable"
    });
  });

  app.get("/rave/pipeline", (req, res) => {
    const telemetry = audioEngine?.getTelemetry?.() || {};
    const engineStatus = engineV2?.getStatus?.() || {};
    const projection = engineV2?.getTelemetryProjection?.() || {};
    const fixtureId = normalizeToken(req?.query?.fixtureId, 128);
    const brand = normalizeToken(req?.query?.brand, 32).toLowerCase();
    const limitRaw = req?.query?.limit;
    const parsedLimit = limitRaw === undefined ? null : Number(limitRaw);
    if (limitRaw !== undefined && (!Number.isFinite(parsedLimit) || parsedLimit <= 0)) {
      toCompatError(res, 400, "invalid_limit", "allowed range: 1..24");
      return;
    }
    const fixtures = Array.isArray(fixtureRegistry?.getFixtures?.())
      ? fixtureRegistry.getFixtures()
      : [];
    const filtered = fixtures.filter(row => {
      const rowId = String(row?.id || "").trim();
      const rowBrand = String(row?.brand || "").trim().toLowerCase();
      if (fixtureId && rowId !== fixtureId) return false;
      if (brand && rowBrand !== brand) return false;
      return true;
    });
    const limited = parsedLimit === null
      ? filtered
      : filtered.slice(0, Math.min(24, Math.max(1, Math.round(parsedLimit))));
    res.json({
      ok: true,
      at: Date.now(),
      running: engineStatus.running === true,
      fixtureCount: limited.length,
      fixtures: limited,
      audio: {
        rms: Number(telemetry.rms || telemetry.audioRms || 0),
        energy: Number(telemetry.energy || 0),
        bpm: Number(telemetry.bpm || 0)
      },
      projection
    });
  });

  app.get("/rave/fixture-behavior/profiles", (_req, res) => {
    const triggerMatrix = liveCompatService.getTriggerMatrix();
    res.json({
      ok: true,
      version: 2,
      source: "engine_v2_trigger_matrix",
      global: triggerMatrix?.global || {},
      brands: triggerMatrix?.brands || {},
      fixtureOverrides: triggerMatrix?.fixtureOverrides || {}
    });
  });

  app.get("/rave/palette", (_req, res) => {
    const snapshot = liveCompatService.getPaletteSnapshot();
    if (enginePaletteService && typeof enginePaletteService.getSnapshot === "function") {
      snapshot.engineV2 = enginePaletteService.getSnapshot();
    }
    res.json(snapshot);
  });

  app.post("/rave/palette", enforceWriteAccess, (req, res) => {
    const result = liveCompatService.patchPalette(getRequestMap(req.body));
    const config = getRequestMap(result?.config);
    const enginePaletteSync = {
      ok: false,
      skipped: true,
      reason: "engine_palette_service_unavailable"
    };

    if (enginePaletteService && typeof enginePaletteService.setSequence === "function") {
      const sequence = buildEnginePaletteSequenceFromConfig(config);
      const sequenceResult = enginePaletteService.setSequence(sequence);
      const holdTicks = deriveEnginePaletteHoldTicksFromConfig(config, { tickHz: 10 });
      const cycleResult = typeof enginePaletteService.setCycleConfig === "function"
        ? enginePaletteService.setCycleConfig({ holdTicks })
        : { ok: true, holdTicks };
      enginePaletteSync.ok = sequenceResult?.ok === true && cycleResult?.ok !== false;
      enginePaletteSync.skipped = false;
      enginePaletteSync.sequenceLength = Array.isArray(sequence) ? sequence.length : 0;
      enginePaletteSync.holdTicks = Number(cycleResult?.holdTicks || holdTicks);
      if (enginePaletteSync.ok) {
        enginePaletteSync.snapshot = enginePaletteService.getSnapshot();
      } else {
        enginePaletteSync.error = String(
          sequenceResult?.error ||
          cycleResult?.error ||
          "engine_palette_sync_failed"
        );
      }
    }

    res.json({
      ...result,
      enginePaletteSync
    });
  });

  app.get("/rave/fixture-metrics", (_req, res) => {
    res.json(liveCompatService.getFixtureMetricsSnapshot());
  });

  app.post("/rave/fixture-metrics", enforceWriteAccess, (req, res) => {
    res.json(liveCompatService.patchFixtureMetrics(getRequestMap(req.body)));
  });

  app.post("/rave/fixture-routing/clear", enforceWriteAccess, (req, res) => {
    res.json(liveCompatService.clearFixtureRouting(getRequestMap(req.body)));
  });

  app.get("/rave/overclock/tiers", (_req, res) => {
    res.json(liveCompatService.getOverclockTiers());
  });

  app.post("/rave/overclock/auto", enforceWriteAccess, (req, res) => {
    const enabled = parseBoolean(req.query?.enabled ?? req.body?.enabled, false);
    res.json(liveCompatService.setOverclockAuto(enabled));
  });
  app.post("/rave/overclock/off", enforceWriteAccess, (_req, res) => {
    res.json(liveCompatService.setOverclockPresetLevel(0));
  });
  app.post("/rave/overclock/on", enforceWriteAccess, (_req, res) => {
    res.json(liveCompatService.setOverclockPresetLevel(1));
  });
  app.post("/rave/overclock/turbo/on", enforceWriteAccess, (_req, res) => {
    res.json(liveCompatService.setOverclockPresetLevel(2));
  });
  app.post("/rave/overclock/turbo/off", enforceWriteAccess, (_req, res) => {
    res.json(liveCompatService.setOverclockPresetLevel(1));
  });
  app.post("/rave/overclock/ultra/on", enforceWriteAccess, (_req, res) => {
    res.json(liveCompatService.setOverclockPresetLevel(3));
  });
  app.post("/rave/overclock/extreme/on", enforceWriteAccess, (_req, res) => {
    res.json(liveCompatService.setOverclockPresetLevel(4));
  });
  app.post("/rave/overclock/insane/on", enforceWriteAccess, (_req, res) => {
    res.json(liveCompatService.setOverclockPresetLevel(5));
  });
  app.post("/rave/overclock/hyper/on", enforceWriteAccess, (_req, res) => {
    res.json(liveCompatService.setOverclockPresetLevel(6));
  });
  app.post("/rave/overclock/ludicrous/on", enforceWriteAccess, (_req, res) => {
    res.json(liveCompatService.setOverclockPresetLevel(7));
  });

  app.post("/rave/overclock/dev/:hz/on", enforceWriteAccess, (req, res) => {
    res.json(liveCompatService.setOverclockDevHz(req.params.hz));
  });
  app.post("/rave/overclock", enforceWriteAccess, (req, res) => {
    const enabled = parseBoolean(req?.query?.enabled ?? req?.body?.enabled, false);
    if (!enabled) {
      res.json(liveCompatService.setOverclockPresetLevel(0));
      return;
    }
    const tier = normalizeToken(req?.query?.tier ?? req?.body?.tier, 24).toLowerCase();
    const tierMap = {
      fast: 1,
      turbo6: 2,
      turbo: 2,
      ultra: 3,
      turbo8: 3,
      extreme: 4,
      turbo10: 4,
      insane: 5,
      turbo12: 5,
      hyper: 6,
      turbo14: 6,
      ludicrous: 7,
      turbo16: 7
    };
    const level = Number.isInteger(tierMap[tier]) ? tierMap[tier] : 1;
    res.json(liveCompatService.setOverclockPresetLevel(level));
  });

  app.post("/rave/panic", enforceWriteAccess, (_req, res) => {
    const stopped = audioEngine.stopRave({ reason: "rave_panic_route" });
    res.json({
      ok: true,
      panic: true,
      ...stopped
    });
  });

  app.post("/rave/reload", enforceWriteAccess, async (req, res) => {
    await handleModsRuntimeReloadRoute("/rave/reload", req, res);
  });
};
