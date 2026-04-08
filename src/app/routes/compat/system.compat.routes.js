// [TITLE] Module: app/routes/compat/system.compat.routes.js
// [TITLE] Purpose: register system compatibility routes for current UI/runtime contracts
// [TITLE] Functionality Index:
// [TITLE] - system config, update, gateway, and launcher diagnostics routes
// [TITLE] - system oauth and widget redemption compatibility routes
// [TITLE] - system readiness, core-status, route catalog, and shutdown routes
// [DEV] Complex Flow:
// [DEV] This slice keeps the broad system route family together while the
// [DEV] remaining helper cleanup is peeled away from the top-level registrar.

const rateLimit = require("express-rate-limit");
const { buildRouteCatalogSnapshot: buildRouteCatalogSnapshotDefault } = require("./system.compat.route-catalog");
const {
  summarizeCoreServiceChecks: summarizeCoreServiceChecksDefault,
  summarizeLaneCoreReadiness: summarizeLaneCoreReadinessDefault,
  computeCoreStatus: computeCoreStatusDefault
} = require("./system.compat.core-status");
const { createSystemCompatOauthHelpers } = require("./system.compat.oauth-helpers");

module.exports = function registerSystemCompatRoutes(app, deps = {}) {
  const systemConfigService = deps.systemConfigService;
  const audioRuntimeService = deps.audioRuntimeService;
  const systemUpdateService = deps.systemUpdateService;
  const internetGatewayRuntime = deps.internetGatewayRuntime;
  const systemOauthService = deps.systemOauthService;
  const startupReadinessService = deps.startupReadinessService;
  const startupLaunchDiagnosticsService = deps.startupLaunchDiagnosticsService;
  const requestSystemStop = typeof deps.requestSystemStop === "function"
    ? deps.requestSystemStop
    : null;
  const modRuntime = deps.modRuntime;
  const fixtureRegistry = deps.fixtureRegistry;
  const midiManager = deps.midiManager;
  const audioEngine = deps.audioEngine;
  const engineV2 = deps.engineV2;
  const liveCompatService = deps.liveCompatService;
  const hueBridge = deps.hueBridge;
  const wizBridge = deps.wizBridge;
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
  const oauthHelpers = createSystemCompatOauthHelpers({
    modRuntime,
    getRequestMap,
    normalizeToken
  });
  const normalizeOauthDevProfileInput = typeof deps.normalizeOauthDevProfileInput === "function"
    ? deps.normalizeOauthDevProfileInput
    : oauthHelpers.normalizeOauthDevProfileInput;
  const hasAnyOauthDevValue = typeof deps.hasAnyOauthDevValue === "function"
    ? deps.hasAnyOauthDevValue
    : oauthHelpers.hasAnyOauthDevValue;
  const syncOauthProfileToTargetMod = typeof deps.syncOauthProfileToTargetMod === "function"
    ? deps.syncOauthProfileToTargetMod
    : oauthHelpers.syncOauthProfileToTargetMod;
  const mergeOauthProfileIntoWidgetPayload = typeof deps.mergeOauthProfileIntoWidgetPayload === "function"
    ? deps.mergeOauthProfileIntoWidgetPayload
    : oauthHelpers.mergeOauthProfileIntoWidgetPayload;
  const readOauthProfileFromModState = typeof deps.readOauthProfileFromModState === "function"
    ? deps.readOauthProfileFromModState
    : oauthHelpers.readOauthProfileFromModState;
  const normalizeWidgetRedemptionStatusSyncInput = typeof deps.normalizeWidgetRedemptionStatusSyncInput === "function"
    ? deps.normalizeWidgetRedemptionStatusSyncInput
    : oauthHelpers.normalizeWidgetRedemptionStatusSyncInput;
  const hasAnyWidgetStatusOauthPatch = typeof deps.hasAnyWidgetStatusOauthPatch === "function"
    ? deps.hasAnyWidgetStatusOauthPatch
    : oauthHelpers.hasAnyWidgetStatusOauthPatch;
  const normalizeWidgetRedemptionReconcileInput = typeof deps.normalizeWidgetRedemptionReconcileInput === "function"
    ? deps.normalizeWidgetRedemptionReconcileInput
    : oauthHelpers.normalizeWidgetRedemptionReconcileInput;
  const buildRouteCatalogSnapshot = typeof deps.buildRouteCatalogSnapshot === "function"
    ? deps.buildRouteCatalogSnapshot
    : buildRouteCatalogSnapshotDefault;
  const summarizeLaneCoreReadiness = typeof deps.summarizeLaneCoreReadiness === "function"
    ? deps.summarizeLaneCoreReadiness
    : summarizeLaneCoreReadinessDefault;
  const summarizeCoreServiceChecks = typeof deps.summarizeCoreServiceChecks === "function"
    ? deps.summarizeCoreServiceChecks
    : summarizeCoreServiceChecksDefault;
  const computeCoreStatus = typeof deps.computeCoreStatus === "function"
    ? deps.computeCoreStatus
    : computeCoreStatusDefault;
  const createCompatWriteRateLimit = (keyPrefix, max = 20, windowMs = 60_000) => rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: req => `${keyPrefix}:${String(req?.ip || req?.socket?.remoteAddress || "local")}`,
    handler: (_req, res) => {
      toCompatError(res, 429, "rate_limited", `${keyPrefix}_requests_exceeded`);
    }
  });
  const oauthWriteRateLimit = createCompatWriteRateLimit("system_oauth", 20, 60_000);
  const widgetWriteRateLimit = createCompatWriteRateLimit("system_widget", 15, 60_000);

  app.get("/system/config", (_req, res) => {
    res.json(systemConfigService.getConfig());
  });

  app.post("/system/config", enforceWriteAccess, async (req, res) => {
    const result = systemConfigService.patchConfig(getRequestMap(req.body));
    if (!result.ok) {
      toCompatError(res, 400, String(result.error || "system_config_invalid"), result.detail);
      return;
    }
    let backendStrategy = null;
    if (
      audioRuntimeService &&
      typeof audioRuntimeService.applyCaptureBackendStrategy === "function"
    ) {
      try {
        backendStrategy = await audioRuntimeService.applyCaptureBackendStrategy(
          result?.config?.audioCaptureBackendStrategy || "auto_rust_first",
          {
            restartIfSessionActive: true,
            reason: "system_config_patch"
          }
        );
      } catch (error) {
        backendStrategy = {
          ok: false,
          error: String(error?.message || error || "audio_backend_strategy_apply_failed")
        };
      }
    }
    res.json({
      ...result,
      audioBackendStrategyApply: backendStrategy
    });
  });

  app.get("/system/update/status", (_req, res) => {
    if (!systemUpdateService || typeof systemUpdateService.getStatus !== "function") {
      toCompatError(res, 503, "system_update_service_unavailable");
      return;
    }
    res.json(systemUpdateService.getStatus());
  });

  app.get("/system/internet-gateway/status", (_req, res) => {
    if (!internetGatewayRuntime || typeof internetGatewayRuntime.getStatus !== "function") {
      toCompatError(res, 503, "internet_gateway_unavailable");
      return;
    }
    res.json({
      ok: true,
      gateway: internetGatewayRuntime.getStatus()
    });
  });

  app.post("/system/update/check", enforceWriteAccess, async (req, res) => {
    if (!systemUpdateService || typeof systemUpdateService.checkForUpdates !== "function") {
      toCompatError(res, 503, "system_update_service_unavailable");
      return;
    }
    const body = getRequestMap(req.body);
    const result = await systemUpdateService.checkForUpdates({
      mode: "manual",
      force: body.force === true
    });
    if (!result || result.ok !== true) {
      toCompatError(
        res,
        Number(result?.status || 502),
        String(result?.error || "system_update_check_failed"),
        String(result?.detail || "")
      );
      return;
    }
    res.json(result);
  });

  app.post("/system/update/apply", enforceWriteAccess, async (req, res) => {
    if (!systemUpdateService || typeof systemUpdateService.applyLatestUpdate !== "function") {
      toCompatError(res, 503, "system_update_service_unavailable");
      return;
    }
    const body = getRequestMap(req.body);
    const result = await systemUpdateService.applyLatestUpdate({
      forceCheck: body.forceCheck === true || body.force === true
    });
    if (!result || result.ok !== true) {
      toCompatError(
        res,
        Number(result?.status || 500),
        String(result?.error || "system_update_apply_failed"),
        String(result?.detail || "")
      );
      return;
    }
    res.json(result);
  });

  app.get("/system/oauth/status", enforceWriteAccess, (_req, res) => {
    if (!systemOauthService || typeof systemOauthService.getStatus !== "function") {
      toCompatError(res, 503, "system_oauth_unavailable");
      return;
    }
    res.json(systemOauthService.getStatus());
  });

  app.post("/system/oauth/seed", enforceWriteAccess, oauthWriteRateLimit, (req, res) => {
    if (!systemOauthService || typeof systemOauthService.seedProfile !== "function") {
      toCompatError(res, 503, "system_oauth_unavailable");
      return;
    }
    const normalized = normalizeOauthDevProfileInput(req.body);
    const source = getRequestMap(req.body);
    const result = systemOauthService.seedProfile(normalized.profile, {
      replace: normalized.replace === true || source.replace === true
    });
    res.json(result);
  });

  app.post("/system/oauth/clear", enforceWriteAccess, oauthWriteRateLimit, (_req, res) => {
    if (!systemOauthService || typeof systemOauthService.clearProfile !== "function") {
      toCompatError(res, 503, "system_oauth_unavailable");
      return;
    }
    res.json(systemOauthService.clearProfile());
  });

  app.post("/system/oauth/start", enforceWriteAccess, oauthWriteRateLimit, async (req, res) => {
    if (
      !systemOauthService ||
      typeof systemOauthService.startDeviceFlow !== "function" ||
      typeof systemOauthService.seedProfile !== "function"
    ) {
      toCompatError(res, 503, "system_oauth_unavailable");
      return;
    }
    const body = getRequestMap(req.body);
    const normalized = normalizeOauthDevProfileInput(body);
    if (hasAnyOauthDevValue(normalized.profile)) {
      systemOauthService.seedProfile(normalized.profile, {
        replace: normalized.replace === true
      });
    }
    const started = await systemOauthService.startDeviceFlow({
      requestedBy: normalizeToken(body.requestedBy || "system", 96)
    });
    if (!started || started.ok !== true) {
      toCompatError(res, Number(started?.status || 409), String(started?.error || "system_oauth_start_failed"), started?.detail);
      return;
    }
    res.json(started);
  });

  app.post("/system/oauth/device-status", enforceWriteAccess, oauthWriteRateLimit, async (req, res) => {
    if (!systemOauthService || typeof systemOauthService.getDeviceStatus !== "function") {
      toCompatError(res, 503, "system_oauth_unavailable");
      return;
    }
    const body = getRequestMap(req.body);
    const status = await systemOauthService.getDeviceStatus({
      poll: body.poll !== false,
      force: body.force === true
    });
    res.json(status);
  });

  app.post("/system/oauth/disconnect", enforceWriteAccess, oauthWriteRateLimit, async (req, res) => {
    if (
      !systemOauthService ||
      typeof systemOauthService.disconnect !== "function" ||
      typeof systemOauthService.getDeviceStatus !== "function"
    ) {
      toCompatError(res, 503, "system_oauth_unavailable");
      return;
    }
    const body = getRequestMap(req.body);
    const disconnected = await systemOauthService.disconnect(body);
    const status = await systemOauthService.getDeviceStatus({ poll: false });
    res.json({
      ok: true,
      ...disconnected,
      status
    });
  });

  app.post("/system/oauth/sync-to-mod", enforceWriteAccess, oauthWriteRateLimit, async (req, res) => {
    if (!systemOauthService || typeof systemOauthService.getProfileForInternal !== "function") {
      toCompatError(res, 503, "system_oauth_unavailable");
      return;
    }
    const body = getRequestMap(req.body);
    const normalized = normalizeOauthDevProfileInput(body);
    if (hasAnyOauthDevValue(normalized.profile) && typeof systemOauthService.seedProfile === "function") {
      systemOauthService.seedProfile(normalized.profile, {
        replace: normalized.replace === true
      });
    }
    const profile = systemOauthService.getProfileForInternal();
    const synced = await syncOauthProfileToTargetMod(profile, body.modId || body.targetModId);
    if (!synced.ok) {
      toCompatError(res, Number(synced.status || 502), String(synced.error || "system_oauth_mod_sync_failed"), synced.detail);
      return;
    }
    res.json({
      ok: true,
      mode: "system_oauth_independent",
      targetModId: synced.targetModId,
      status: systemOauthService.getStatus()
    });
  });

  app.post("/system/widget-template-get", enforceWriteAccess, widgetWriteRateLimit, async (req, res) => {
    const payload = getRequestMap(req.body);
    const mergedPayload = mergeOauthProfileIntoWidgetPayload({
      ...payload
    }, payload);
    if (
      systemOauthService &&
      typeof systemOauthService.getProfileForInternal === "function"
    ) {
      mergeOauthProfileIntoWidgetPayload(mergedPayload, systemOauthService.getProfileForInternal());
    }
    const needsModFallback = (
      !normalizeToken(mergedPayload.twitchClientId, 512) ||
      !normalizeToken(mergedPayload.twitchUserAccessToken, 4096) ||
      !normalizeToken(mergedPayload.twitchBroadcasterId, 256)
    );
    if (needsModFallback) {
      const modOauth = await readOauthProfileFromModState(modRuntime);
      if (modOauth.ok) {
        mergeOauthProfileIntoWidgetPayload(mergedPayload, modOauth.profile);
      }
    }
    const result = systemConfigService.generateWidgetTemplate(mergedPayload);
    res.json(result);
  });

  app.post("/system/widget-redemption-status", enforceWriteAccess, widgetWriteRateLimit, async (req, res) => {
    if (!systemOauthService || typeof systemOauthService.patchRedemptionStatus !== "function") {
      toCompatError(res, 503, "system_oauth_status_sync_unavailable");
      return;
    }
    const normalized = normalizeWidgetRedemptionStatusSyncInput(req.body);
    if (!normalized.rewardId || !normalized.redemptionId) {
      toCompatError(res, 400, "widget_status_sync_missing_reward_or_redemption");
      return;
    }
    if (!normalized.status) {
      toCompatError(res, 400, "widget_status_sync_invalid_status");
      return;
    }

    if (hasAnyWidgetStatusOauthPatch(normalized) && typeof systemOauthService.seedProfile === "function") {
      systemOauthService.seedProfile({
        twitchClientId: normalized.twitchClientId,
        twitchBroadcasterId: normalized.twitchBroadcasterId,
        twitchUserAccessToken: normalized.twitchUserAccessToken,
        twitchRefreshToken: normalized.twitchRefreshToken,
        tokenExpiresAt: normalized.tokenExpiresAt
      }, { replace: false });
    }

    const result = await systemOauthService.patchRedemptionStatus({
      rewardId: normalized.rewardId,
      redemptionId: normalized.redemptionId,
      broadcasterId: normalized.broadcasterId,
      status: normalized.status,
      reason: normalized.reason
    });
    if (!result || result.ok !== true) {
      toCompatError(
        res,
        Number(result?.status || 502),
        String(result?.error || "widget_status_sync_failed"),
        String(result?.detail || "")
      );
      return;
    }
    res.json(result);
  });

  app.post("/system/widget-redemption-reconcile", enforceWriteAccess, widgetWriteRateLimit, async (req, res) => {
    if (!systemOauthService || typeof systemOauthService.reconcilePendingRedemptions !== "function") {
      toCompatError(res, 503, "system_oauth_status_sync_unavailable");
      return;
    }
    const normalized = normalizeWidgetRedemptionReconcileInput(req.body);
    if (hasAnyWidgetStatusOauthPatch(normalized) && typeof systemOauthService.seedProfile === "function") {
      systemOauthService.seedProfile({
        twitchClientId: normalized.twitchClientId,
        twitchBroadcasterId: normalized.twitchBroadcasterId,
        twitchUserAccessToken: normalized.twitchUserAccessToken,
        twitchRefreshToken: normalized.twitchRefreshToken,
        tokenExpiresAt: normalized.tokenExpiresAt
      }, { replace: false });
    }
    const result = await systemOauthService.reconcilePendingRedemptions({
      status: normalized.status,
      reason: normalized.reason,
      rewardIds: normalized.rewardIds,
      maxRewards: normalized.maxRewards,
      maxRedemptions: normalized.maxRedemptions
    });
    if (!result || result.ok !== true) {
      toCompatError(
        res,
        Number(result?.status || 502),
        String(result?.error || "widget_status_sync_failed"),
        String(result?.detail || "")
      );
      return;
    }
    res.json(result);
  });

  app.get("/system/widget-redemption-reconcile-status", (_req, res) => {
    if (!systemOauthService || typeof systemOauthService.getAutoReconcileStatus !== "function") {
      toCompatError(res, 503, "system_oauth_status_sync_unavailable");
      return;
    }
    res.json({
      ok: true,
      reconcile: systemOauthService.getAutoReconcileStatus()
    });
  });

  app.get("/system/startup-readiness", (_req, res) => {
    if (!startupReadinessService || typeof startupReadinessService.getSnapshot !== "function") {
      toCompatError(res, 503, "startup_readiness_unavailable");
      return;
    }
    res.json(startupReadinessService.getSnapshot());
  });

  app.get("/system/launcher-diagnostics", (_req, res) => {
    if (!startupLaunchDiagnosticsService || typeof startupLaunchDiagnosticsService.getSnapshot !== "function") {
      toCompatError(res, 503, "launcher_diagnostics_unavailable");
      return;
    }
    res.json({
      ok: true,
      generatedAt: Date.now(),
      launcher: startupLaunchDiagnosticsService.getSnapshot()
    });
  });

  app.get("/system/routes/catalog", enforceWriteAccess, (_req, res) => {
    res.json(buildRouteCatalogSnapshot(process.cwd()));
  });

  app.get("/system/core-status", (_req, res) => {
    const readinessSnapshot = startupReadinessService?.getSnapshot?.() || null;
    const laneSummary = summarizeLaneCoreReadiness(readinessSnapshot || {});
    const serviceSummary = summarizeCoreServiceChecks({
      systemConfigService,
      internetGatewayRuntime,
      systemUpdateService,
      systemOauthService,
      startupReadinessService,
      fixtureRegistry,
      modRuntime,
      midiManager,
      audioEngine,
      engineV2,
      liveCompatService,
      hueBridge,
      wizBridge,
      startupLaunchDiagnosticsService
    });
    const status = computeCoreStatus(laneSummary, serviceSummary);
    const launcher = startupLaunchDiagnosticsService?.getSnapshot?.() || null;
    res.json({
      ok: true,
      generatedAt: Date.now(),
      status,
      coreReady: status === "ok",
      laneSummary,
      serviceSummary,
      launcher
    });
  });

  app.post("/system/stop", enforceWriteAccess, (req, res) => {
    if (!requestSystemStop) {
      res.json({
        ok: true,
        stopped: false,
        reason: "shutdown_not_wired"
      });
      return;
    }

    const stopResult = requestSystemStop({
      source: "system_stop_route",
      requestedBy: String(req?.ip || "").trim(),
      requestedAt: Date.now(),
      userAgent: String(req?.headers?.["user-agent"] || "").trim()
    });
    if (stopResult?.ok === false) {
      toCompatError(
        res,
        503,
        String(stopResult.error || "shutdown_request_rejected"),
        String(stopResult.detail || "")
      );
      return;
    }

    res.json({
      ok: true,
      stopped: true,
      reason: String(stopResult?.reason || "shutdown_requested")
    });
  });
};
