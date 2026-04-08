// [TITLE] Module: app/routes/compat/audio.compat.routes.js
// [TITLE] Purpose: register audio compatibility routes for current UI/runtime contracts
// [TITLE] Functionality Index:
// [TITLE] - audio config/devices/apps/app-isolation routes
// [TITLE] - audio profiles/reactivity compatibility routes
// [TITLE] - rust transport worker compatibility routes
// [DEV] Complex Flow:
// [DEV] This slice preserves the current app-isolation apply/restart behavior and
// [DEV] hot-probe caching while removing the route family from the compat umbrella.

const { parseBoolean } = require("../../../shared/validation/parse-boolean");

const AUDIO_ROUTE_HOT_CACHE_TTL_MS = 8000;
const AUDIO_ROUTE_HOT_CACHE_STALE_MS = 45000;
const AUDIO_APP_ISOLATION_CONFIG_KEYS = new Set([
  "ffmpegAppIsolationEnabled",
  "ffmpegAppIsolationStrict",
  "ffmpegAppIsolationPrimaryApp",
  "ffmpegAppIsolationFallbackApp",
  "ffmpegAppIsolationPrimaryDevices",
  "ffmpegAppIsolationFallbackDevices",
  "ffmpegAppIsolationCheckMs",
  "ffmpegAppIsolationMultiSource"
]);

module.exports = function registerAudioCompatRoutes(app, deps = {}) {
  const audioRuntimeService = deps.audioRuntimeService;
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
  const audioHotProbeCache = {
    optionalTools: { at: 0, payload: null, refreshing: false },
    apps: { at: 0, payload: null, refreshing: false },
    devices: { at: 0, payload: null, refreshing: false }
  };

  function primeAudioHotProbeCache(cacheKey, loadFn) {
    const entry = audioHotProbeCache[cacheKey];
    if (!entry || entry.refreshing) return;
    entry.refreshing = true;
    setImmediate(() => {
      try {
        const payload = loadFn();
        entry.payload = payload;
        entry.at = Date.now();
      } catch {
        // noop: keep serving last known-good payload
      } finally {
        entry.refreshing = false;
      }
    });
  }

  function readAudioHotProbe(cacheKey, loadFn, options = {}) {
    const entry = audioHotProbeCache[cacheKey];
    const nowMs = Date.now();
    const forceRefresh = options.forceRefresh === true;
    if (!entry) {
      return loadFn();
    }
    if (forceRefresh || !entry.payload) {
      const payload = loadFn();
      entry.payload = payload;
      entry.at = nowMs;
      return payload;
    }
    const ageMs = Math.max(0, nowMs - Number(entry.at || 0));
    if (ageMs > AUDIO_ROUTE_HOT_CACHE_TTL_MS) {
      if (ageMs <= AUDIO_ROUTE_HOT_CACHE_STALE_MS) {
        primeAudioHotProbeCache(cacheKey, loadFn);
        return entry.payload;
      }
      const payload = loadFn();
      entry.payload = payload;
      entry.at = nowMs;
      return payload;
    }
    if (ageMs > Math.round(AUDIO_ROUTE_HOT_CACHE_TTL_MS / 2)) {
      primeAudioHotProbeCache(cacheKey, loadFn);
    }
    return entry.payload;
  }

  // [TITLE] Section: Audio Compatibility Routes
  app.get("/audio/optional-tools/status", (_req, res) => {
    if (!audioRuntimeService || typeof audioRuntimeService.getOptionalToolsStatus !== "function") {
      toCompatError(res, 503, "audio_runtime_unavailable");
      return;
    }
    res.json(readAudioHotProbe(
      "optionalTools",
      () => audioRuntimeService.getOptionalToolsStatus(),
      { forceRefresh: false }
    ));
  });

  app.get("/audio/apps", (req, res) => {
    if (!audioRuntimeService || typeof audioRuntimeService.getApps !== "function") {
      toCompatError(res, 503, "audio_runtime_unavailable");
      return;
    }
    const forceRefresh = req?.query?._ !== undefined;
    res.json(readAudioHotProbe(
      "apps",
      () => audioRuntimeService.getApps({ forceRefresh: true }),
      { forceRefresh }
    ));
  });

  app.get("/audio/ffmpeg/app-isolation/locks", (_req, res) => {
    if (!audioRuntimeService || typeof audioRuntimeService.getAppIsolationLocks !== "function") {
      toCompatError(res, 503, "audio_runtime_unavailable");
      return;
    }
    res.json(audioRuntimeService.getAppIsolationLocks());
  });

  app.post("/audio/ffmpeg/app-isolation/locks/set", enforceWriteAccess, async (req, res) => {
    if (!audioRuntimeService || typeof audioRuntimeService.setAppIsolationLock !== "function") {
      toCompatError(res, 503, "audio_runtime_unavailable");
      return;
    }
    const body = getRequestMap(req.body);
    const result = audioRuntimeService.setAppIsolationLock(body);
    if (!result.ok) {
      toCompatError(res, 400, String(result.error || "invalid_manual_lock_payload"));
      return;
    }
    const applyIntent = parseBoolean(body.apply, true) || parseBoolean(body.restart, false);
    if (!applyIntent || !audioRuntimeService || typeof audioRuntimeService.scanAppIsolation !== "function") {
      res.json(result);
      return;
    }
    const sessionActive = audioRuntimeService && typeof audioRuntimeService.getSessionStatus === "function"
      ? audioRuntimeService.getSessionStatus()?.active === true
      : false;
    const restartIntent = parseBoolean(body.restart, false) || parseBoolean(body.forceRestart, false);
    const scanPayload = {
      reason: normalizeToken(body.reason || "manual_lock_set_route", 96),
      force: true,
      apply: true
    };
    if (restartIntent || sessionActive) {
      scanPayload.forceRestart = true;
    }
    try {
      const scanResult = await audioRuntimeService.scanAppIsolation(scanPayload);
      res.json({
        ...result,
        apply: {
          ok: scanResult?.ok === true,
          restarted: scanResult?.restarted === true,
          error: scanResult?.ok === true ? "" : String(scanResult?.error || "app_iso_scan_failed")
        },
        telemetry: scanResult?.telemetry || result?.telemetry || null,
        capture: scanResult?.capture || null,
        session: scanResult?.session || null
      });
    } catch (error) {
      res.json({
        ...result,
        apply: {
          ok: false,
          restarted: false,
          error: String(error?.message || error || "app_iso_scan_failed")
        }
      });
    }
  });

  app.post("/audio/ffmpeg/app-isolation/locks/clear", enforceWriteAccess, async (req, res) => {
    if (!audioRuntimeService || typeof audioRuntimeService.clearAppIsolationLock !== "function") {
      toCompatError(res, 503, "audio_runtime_unavailable");
      return;
    }
    const body = getRequestMap(req.body);
    const result = audioRuntimeService.clearAppIsolationLock(body);
    if (!result.ok) {
      toCompatError(res, 400, String(result.error || "missing_source_token"));
      return;
    }
    const applyIntent = parseBoolean(body.apply, true) || parseBoolean(body.restart, false);
    if (!applyIntent || !audioRuntimeService || typeof audioRuntimeService.scanAppIsolation !== "function") {
      res.json(result);
      return;
    }
    const sessionActive = audioRuntimeService && typeof audioRuntimeService.getSessionStatus === "function"
      ? audioRuntimeService.getSessionStatus()?.active === true
      : false;
    const restartIntent = parseBoolean(body.restart, false) || parseBoolean(body.forceRestart, false);
    const scanPayload = {
      reason: normalizeToken(body.reason || "manual_lock_clear_route", 96),
      force: true,
      apply: true
    };
    if (restartIntent || sessionActive) {
      scanPayload.forceRestart = true;
    }
    try {
      const scanResult = await audioRuntimeService.scanAppIsolation(scanPayload);
      res.json({
        ...result,
        apply: {
          ok: scanResult?.ok === true,
          restarted: scanResult?.restarted === true,
          error: scanResult?.ok === true ? "" : String(scanResult?.error || "app_iso_scan_failed")
        },
        telemetry: scanResult?.telemetry || result?.telemetry || null,
        capture: scanResult?.capture || null,
        session: scanResult?.session || null
      });
    } catch (error) {
      res.json({
        ...result,
        apply: {
          ok: false,
          restarted: false,
          error: String(error?.message || error || "app_iso_scan_failed")
        }
      });
    }
  });

  app.post("/audio/ffmpeg/app-isolation/scan", enforceWriteAccess, async (req, res) => {
    if (!audioRuntimeService || typeof audioRuntimeService.scanAppIsolation !== "function") {
      toCompatError(res, 503, "audio_runtime_unavailable");
      return;
    }
    res.json(await audioRuntimeService.scanAppIsolation(getRequestMap(req.body)));
  });

  app.get("/audio/config", (_req, res) => {
    if (!audioRuntimeService || typeof audioRuntimeService.getConfig !== "function") {
      toCompatError(res, 503, "audio_runtime_unavailable");
      return;
    }
    res.json(audioRuntimeService.getConfig());
  });

  app.post("/audio/config", enforceWriteAccess, async (req, res) => {
    if (!audioRuntimeService || typeof audioRuntimeService.patchConfig !== "function") {
      toCompatError(res, 503, "audio_runtime_unavailable");
      return;
    }
    const body = getRequestMap(req.body);
    const hasRestartIntent = Object.prototype.hasOwnProperty.call(body, "restart");
    const explicitRestartIntent = hasRestartIntent ? parseBoolean(body.restart, false) : null;
    const appIsolationPatchRequested = Object.keys(body).some(key => AUDIO_APP_ISOLATION_CONFIG_KEYS.has(String(key || "")));
    const sessionActive = audioRuntimeService && typeof audioRuntimeService.getSessionStatus === "function"
      ? audioRuntimeService.getSessionStatus()?.active === true
      : false;
    const patchBody = { ...body };
    delete patchBody.restart;
    delete patchBody.apply;
    delete patchBody.reason;
    const patchOptions = {
      reason: normalizeToken(body.reason || "audio_config_patch", 96)
    };
    if (explicitRestartIntent !== null) {
      patchOptions.restart = explicitRestartIntent;
    } else if (appIsolationPatchRequested && sessionActive) {
      patchOptions.restart = true;
    }
    res.json(await audioRuntimeService.patchConfig(patchBody, patchOptions));
  });

  app.post("/audio/restart", enforceWriteAccess, async (_req, res) => {
    if (!audioRuntimeService || typeof audioRuntimeService.restart !== "function") {
      toCompatError(res, 503, "audio_runtime_unavailable");
      return;
    }
    res.json(await audioRuntimeService.restart({
      reason: "audio_restart_route"
    }));
  });

  app.get("/audio/devices", (req, res) => {
    if (!audioRuntimeService || typeof audioRuntimeService.getDevices !== "function") {
      toCompatError(res, 503, "audio_runtime_unavailable");
      return;
    }
    const forceRefresh = req?.query?._ !== undefined;
    res.json(readAudioHotProbe(
      "devices",
      () => audioRuntimeService.getDevices({ forceRefresh: true }),
      { forceRefresh }
    ));
  });

  app.get("/audio/reactivity-map", (_req, res) => {
    if (!audioRuntimeService || typeof audioRuntimeService.getReactivityMap !== "function") {
      toCompatError(res, 503, "audio_runtime_unavailable");
      return;
    }
    res.json(audioRuntimeService.getReactivityMap());
  });

  app.post("/audio/reactivity-map", enforceWriteAccess, (req, res) => {
    if (!audioRuntimeService || typeof audioRuntimeService.patchReactivityMap !== "function") {
      toCompatError(res, 503, "audio_runtime_unavailable");
      return;
    }
    res.json(audioRuntimeService.patchReactivityMap(getRequestMap(req.body)));
  });

  app.get("/audio/profiles", (_req, res) => {
    if (!audioRuntimeService || typeof audioRuntimeService.getProfiles !== "function") {
      toCompatError(res, 503, "audio_runtime_unavailable");
      return;
    }
    res.json(audioRuntimeService.getProfiles());
  });

  app.post("/audio/profiles/save", enforceWriteAccess, (req, res) => {
    if (!audioRuntimeService || typeof audioRuntimeService.saveProfile !== "function") {
      toCompatError(res, 503, "audio_runtime_unavailable");
      return;
    }
    const body = getRequestMap(req.body);
    const result = audioRuntimeService.saveProfile(body.name);
    if (!result.ok) {
      toCompatError(res, 400, String(result.error || "invalid_profile_name"));
      return;
    }
    res.json(result);
  });

  app.post("/audio/profiles/apply", enforceWriteAccess, (req, res) => {
    if (!audioRuntimeService || typeof audioRuntimeService.applyProfile !== "function") {
      toCompatError(res, 503, "audio_runtime_unavailable");
      return;
    }
    const body = getRequestMap(req.body);
    const result = audioRuntimeService.applyProfile(body.name);
    if (!result.ok) {
      const status = result.error === "profile_not_found" ? 404 : 400;
      toCompatError(res, status, String(result.error || "profile_apply_failed"));
      return;
    }
    res.json(result);
  });

  app.post("/audio/profiles/delete", enforceWriteAccess, (req, res) => {
    if (!audioRuntimeService || typeof audioRuntimeService.deleteProfile !== "function") {
      toCompatError(res, 503, "audio_runtime_unavailable");
      return;
    }
    const body = getRequestMap(req.body);
    const result = audioRuntimeService.deleteProfile(body.name);
    if (!result.ok) {
      const status = result.error === "profile_not_found" ? 404 : 400;
      toCompatError(res, status, String(result.error || "profile_delete_failed"));
      return;
    }
    res.json(result);
  });

  app.get("/audio/profiles/schema", (_req, res) => {
    res.json({
      ok: true,
      schema: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 40 }
        }
      }
    });
  });

  app.get("/audio/rust/transport-worker/status", (_req, res) => {
    if (!audioRuntimeService || typeof audioRuntimeService.getRustTransportWorkerStatus !== "function") {
      toCompatError(res, 503, "rust_transport_worker_unavailable");
      return;
    }
    res.json({
      ok: true,
      status: audioRuntimeService.getRustTransportWorkerStatus()
    });
  });

  app.get("/audio/rust/transport-worker/adapters", (req, res) => {
    if (!audioRuntimeService || typeof audioRuntimeService.getRustTransportWorkerStatus !== "function") {
      toCompatError(res, 503, "rust_transport_worker_unavailable");
      return;
    }
    const refresh = parseBoolean(req?.query?.refresh, false);
    let refreshRequested = false;
    if (refresh === true && typeof audioRuntimeService.requestRustTransportWorkerAdapterCatalog === "function") {
      const result = audioRuntimeService.requestRustTransportWorkerAdapterCatalog();
      refreshRequested = result?.requested === true;
    }
    const status = audioRuntimeService.getRustTransportWorkerStatus();
    res.json({
      ok: true,
      refresh,
      refreshRequested,
      catalog: status?.telemetry?.lastAdapterCatalog || null,
      status
    });
  });

  app.get("/audio/rust/transport-worker/watchdog", (req, res) => {
    if (!audioRuntimeService || typeof audioRuntimeService.getRustTransportWorkerStatus !== "function") {
      toCompatError(res, 503, "rust_transport_worker_unavailable");
      return;
    }
    const refresh = parseBoolean(req?.query?.refresh, false);
    let refreshRequested = false;
    if (refresh === true && typeof audioRuntimeService.requestRustTransportWorkerWatchdogSnapshot === "function") {
      const result = audioRuntimeService.requestRustTransportWorkerWatchdogSnapshot();
      refreshRequested = result?.requested === true;
    }
    const status = audioRuntimeService.getRustTransportWorkerStatus();
    res.json({
      ok: true,
      refresh,
      refreshRequested,
      watchdog: status?.telemetry?.lastWatchdog || null,
      status
    });
  });

  app.post("/audio/rust/transport-worker/config", enforceWriteAccess, (req, res) => {
    if (!audioRuntimeService || typeof audioRuntimeService.setRustTransportWorkerConfig !== "function") {
      toCompatError(res, 503, "rust_transport_worker_unavailable");
      return;
    }
    const patch = getRequestMap(req.body);
    const status = audioRuntimeService.setRustTransportWorkerConfig(patch, {
      autoStartIfEnabled: true
    });
    res.json({
      ok: true,
      status
    });
  });

  app.post("/audio/rust/transport-worker/start", enforceWriteAccess, (req, res) => {
    if (!audioRuntimeService || typeof audioRuntimeService.startRustTransportWorker !== "function") {
      toCompatError(res, 503, "rust_transport_worker_unavailable");
      return;
    }
    const reason = normalizeToken(req?.body?.reason || "api_start", 64).toLowerCase();
    const status = audioRuntimeService.startRustTransportWorker({
      reason
    });
    res.json({
      ok: true,
      status
    });
  });

  app.post("/audio/rust/transport-worker/stop", enforceWriteAccess, (req, res) => {
    if (!audioRuntimeService || typeof audioRuntimeService.stopRustTransportWorker !== "function") {
      toCompatError(res, 503, "rust_transport_worker_unavailable");
      return;
    }
    const disable = parseBoolean(req?.body?.disable, false);
    const status = audioRuntimeService.stopRustTransportWorker({
      reason: "api_stop",
      disable
    });
    res.json({
      ok: true,
      status
    });
  });

  app.post("/audio/rust/transport-worker/restart", enforceWriteAccess, (req, res) => {
    if (!audioRuntimeService || typeof audioRuntimeService.restartRustTransportWorker !== "function") {
      toCompatError(res, 503, "rust_transport_worker_unavailable");
      return;
    }
    const reason = normalizeToken(req?.body?.reason || "api_restart", 64).toLowerCase();
    const status = audioRuntimeService.restartRustTransportWorker({
      reason
    });
    res.json({
      ok: true,
      status
    });
  });
};
