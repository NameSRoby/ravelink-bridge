// [TITLE] Module: app/register-routes.js
// [TITLE] Purpose: HTTP route registration and request orchestration
// [TITLE] Functionality Index:
// [TITLE] - health/live/rave control routes
// [TITLE] - Twitch teach/color config routes
// [TITLE] - request compatibility parsing and response shaping

const net = require("net");
const { parseBoolean } = require("../shared/validation/parse-boolean");
const registerCompatRoutes = require("./register-compat-routes");

function getRequestMap(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function getCompatText(req) {
  // [DEV] Compatibility extraction keeps legacy query/body key support
  // [DEV] so existing bots/widgets continue working during migration.
  return String(
    req?.query?.value1 ??
    req?.query?.text ??
    req?.query?.value ??
    req?.body?.value1 ??
    req?.body?.text ??
    req?.body?.value ??
    ""
  ).trim();
}

function getColorRequestOptions(req, parseColorTarget) {
  const query = req?.query || {};
  const body = req?.body || {};
  const rawTarget = query.target ?? query.brand ?? body.target ?? body.brand;
  const targetText = String(rawTarget ?? "").trim();
  const targetExplicit = targetText.length > 0;
  return {
    target: targetExplicit ? parseColorTarget(targetText, "both") : null,
    targetExplicit,
    zone: String(query.zone ?? body.zone ?? "").trim(),
    hueZone: String(query.hueZone ?? body.hueZone ?? "").trim(),
    wizZone: String(query.wizZone ?? body.wizZone ?? "").trim()
  };
}

function normalizeRemoteAddress(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (raw.startsWith("::ffff:")) {
    return raw.slice("::ffff:".length);
  }
  return raw;
}

function isLoopbackAddress(input) {
  const address = normalizeRemoteAddress(input);
  if (!address) return false;
  if (address === "::1") return true;
  if (address === "127.0.0.1") return true;
  if (net.isIP(address) === 0 && address.toLowerCase() === "localhost") return true;
  return false;
}

function isSameHostSocketAddress(requestMeta = {}) {
  const remoteAddress = normalizeRemoteAddress(requestMeta.socketRemoteAddress || "");
  const localAddress = normalizeRemoteAddress(requestMeta.socketLocalAddress || "");
  if (!remoteAddress || !localAddress) return false;
  if (isLoopbackAddress(remoteAddress) && isLoopbackAddress(localAddress)) return true;
  return remoteAddress === localAddress;
}

function isWriteRequestAllowed(requestMeta = {}) {
  const allowRemoteWrite = requestMeta.allowRemoteWrite === true;
  if (allowRemoteWrite) return true;
  const requestIp = requestMeta.requestIp || "";
  const socketRemoteAddress = requestMeta.socketRemoteAddress || "";
  if (isLoopbackAddress(requestIp) || isLoopbackAddress(socketRemoteAddress)) {
    return true;
  }
  return isSameHostSocketAddress(requestMeta);
}

function buildCanonicalLiveStatusPayload(deps = {}) {
  const liveProfileService = deps.liveProfileService;
  const liveCompatService = deps.liveCompatService;
  const compatibilityPayload = liveCompatService?.getCompatibility?.() || { ok: true, snapshot: {} };
  const compatibilitySnapshot = compatibilityPayload?.snapshot && typeof compatibilityPayload.snapshot === "object"
    ? compatibilityPayload.snapshot
    : {};
  const sceneLock = String(compatibilitySnapshot.sceneLock || "auto").trim().toLowerCase() || "auto";
  const sceneIntent = String(compatibilitySnapshot.sceneIntent || sceneLock || "auto").trim().toLowerCase() || sceneLock || "auto";
  return {
    ok: true,
    mode: "full",
    notes: "Engine-v2 live controls are enabled for palette, scene, cadence auto-hz, and brightness runtime tuning.",
    profileCount: liveProfileService ? liveProfileService.listProfiles().length : 0,
    compatibility: {
      ...compatibilitySnapshot,
      sceneLock,
      sceneIntent,
      updatedAt: Number(compatibilitySnapshot.updatedAt || 0)
    },
    sceneLock,
    sceneIntent,
    compatibilityUpdatedAt: Number(compatibilitySnapshot.updatedAt || 0)
  };
}

function registerRoutes(app, deps = {}) {
  const colorLibrary = deps.colorLibrary;
  const fixtureRegistry = deps.fixtureRegistry;
  const twitchColorConfig = deps.twitchColorConfig;
  const colorCommandService = deps.colorCommandService;
  const hueBridge = deps.hueBridge;
  const wizBridge = deps.wizBridge;
  const audioEngine = deps.audioEngine;
  const engineV2 = deps.engineV2;
  const enginePaletteService = deps.enginePaletteService;
  const modRuntime = deps.modRuntime;
  const midiManager = deps.midiManager;
  const liveProfileService = deps.liveProfileService;
  const liveCompatService = deps.liveCompatService;
  const audioRuntimeService = deps.audioRuntimeService;
  const systemConfigService = deps.systemConfigService;
  const internetGatewayRuntime = deps.internetGatewayRuntime;
  const systemUpdateService = deps.systemUpdateService;
  const systemOauthService = deps.systemOauthService;
  const startupReadinessService = deps.startupReadinessService;
  const startupLaunchDiagnosticsService = deps.startupLaunchDiagnosticsService;
  const requestSystemStop = deps.requestSystemStop;
  const allowRemoteWrite = parseBoolean(process.env.RAVELINK_ALLOW_REMOTE_WRITE, false);

  if (!app) throw new Error("registerRoutes requires express app");
  if (!audioEngine || typeof audioEngine.getStatus !== "function") {
    throw new Error("registerRoutes requires audioEngine.getStatus()");
  }
  if (typeof audioEngine.getRaveState !== "function") {
    throw new Error("registerRoutes requires audioEngine.getRaveState()");
  }
  if (typeof audioEngine.startRave !== "function" || typeof audioEngine.stopRave !== "function") {
    throw new Error("registerRoutes requires audioEngine.startRave()/stopRave()");
  }
  if (typeof audioEngine.getTelemetry !== "function" || typeof audioEngine.setTelemetry !== "function") {
    throw new Error("registerRoutes requires audioEngine.getTelemetry()/setTelemetry()");
  }
  if (!engineV2 || typeof engineV2.getStatus !== "function") {
    throw new Error("registerRoutes requires engineV2.getStatus()");
  }
  if (!enginePaletteService || typeof enginePaletteService.getSnapshot !== "function") {
    throw new Error("registerRoutes requires enginePaletteService.getSnapshot()");
  }
  if (!midiManager || typeof midiManager.getStatus !== "function") {
    throw new Error("registerRoutes requires midiManager.getStatus()");
  }
  if (!liveCompatService || typeof liveCompatService.getCompatibility !== "function") {
    throw new Error("registerRoutes requires liveCompatService.getCompatibility()");
  }
  if (!systemConfigService || typeof systemConfigService.getConfig !== "function") {
    throw new Error("registerRoutes requires systemConfigService.getConfig()");
  }
  if (
    !audioRuntimeService ||
    typeof audioRuntimeService.getConfig !== "function" ||
    typeof audioRuntimeService.startSession !== "function" ||
    typeof audioRuntimeService.stopSession !== "function"
  ) {
    throw new Error("registerRoutes requires audioRuntimeService.getConfig()/startSession()/stopSession()");
  }

  function enforceWriteAccess(req, res, next) {
    // [DEV] Security default is local-machine writes only (loopback or same-host
    // [DEV] interface) to reduce accidental network exposure during streamer setups.
    if (isWriteRequestAllowed({
      allowRemoteWrite,
      requestIp: req?.ip,
      socketRemoteAddress: req?.socket?.remoteAddress,
      socketLocalAddress: req?.socket?.localAddress
    })) {
      next();
      return;
    }
    res.status(403).json({
      ok: false,
      error: "remote_write_forbidden",
      detail: "This write endpoint allows loopback and same-host requests by default. Set RAVELINK_ALLOW_REMOTE_WRITE=1 to allow remote LAN writes."
    });
  }

  // [TITLE] Section: Health + Runtime Snapshot Routes
  app.get("/health", (_req, res) => {
    const rave = audioEngine.getRaveState();
    const audioStatus = audioEngine.getStatus();
    const engineStatus = engineV2.getStatus();
    const readiness = startupReadinessService?.getSnapshot?.() || null;
    const currentSummary = readiness?.current?.summary || null;
    const launcherDiagnostics = startupLaunchDiagnosticsService?.getSnapshot?.() || null;
    res.json({
      ok: true,
      rave: {
        active: rave.active === true,
        startedAt: rave.startedAt || 0,
        lastStoppedAt: rave.lastStoppedAt || 0
      },
      colors: colorLibrary.getSummary(),
      twitchColor: twitchColorConfig.getLoadSummary(),
      audio: {
        backend: String(audioStatus.backend || "unwired"),
        status: String(audioStatus.status || "idle"),
        telemetryUpdatedAt: Number(audioStatus.telemetryUpdatedAt || 0)
      },
      fixtures: {
        total: fixtureRegistry.getFixtures().length,
        twitch: fixtureRegistry.listTwitchBy("", "", { requireConfigured: false }).length,
        custom: fixtureRegistry.listCustomBy("", "", { requireConfigured: false }).length
      },
      liveTab: {
        mode: "full",
        profileCount: liveProfileService ? liveProfileService.listProfiles().length : 0
      },
      engineV2: {
        running: engineStatus.running === true,
        tickMs: Number(engineStatus.tickMs || 0),
        tickCount: Number(engineStatus.tickCount || 0),
        hardwareLimits: engineStatus.hardwareLimits || {}
      },
      startupReadiness: currentSummary ? {
        readyCount: Number(currentSummary.readyCount || 0),
        laneCount: Number(currentSummary.laneCount || 0),
        blocking: Array.isArray(currentSummary.blocking) ? currentSummary.blocking : []
      } : null,
      launcherDiagnostics
    });
  });

  // [TITLE] Section: Audio Telemetry Routes
  app.get("/audio/status", (_req, res) => {
    const captureStatus = audioRuntimeService && typeof audioRuntimeService.getCaptureStatus === "function"
      ? audioRuntimeService.getCaptureStatus()
      : null;
    res.json({
      ok: true,
      status: audioEngine.getStatus(),
      capture: captureStatus
    });
  });

  app.get("/audio/telemetry", (_req, res) => {
    const telemetry = audioEngine.getTelemetry();
    const config = typeof audioRuntimeService.getConfigSnapshot === "function"
      ? (audioRuntimeService.getConfigSnapshot()?.config || null)
      : (audioRuntimeService.getConfig()?.config || null);
    res.json({
      ok: true,
      config,
      telemetry,
      ...telemetry
    });
  });

  app.post("/audio/telemetry", enforceWriteAccess, (req, res) => {
    const body = getRequestMap(req.body);
    const result = audioEngine.setTelemetry(body);
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json({
      ok: true,
      telemetry: audioEngine.getTelemetry(),
      changed: result.changed === true
    });
  });

  // [TITLE] Section: Engine v2 Skeleton Routes
  app.get("/engine/v2/status", (_req, res) => {
    res.json({
      ok: true,
      status: engineV2.getStatus(),
      telemetry: engineV2.getTelemetryProjection(),
      palette: enginePaletteService.getSnapshot()
    });
  });

  app.get("/engine/v2/palette", (_req, res) => {
    res.json({
      ok: true,
      palette: enginePaletteService.getSnapshot()
    });
  });

  app.post("/engine/v2/palette/custom-color", enforceWriteAccess, (req, res) => {
    const body = getRequestMap(req.body);
    const result = enginePaletteService.teachCustomColor({
      text: body.text,
      name: body.name,
      hex: body.hex
    });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json({
      ok: true,
      ...result,
      palette: enginePaletteService.getSnapshot()
    });
  });

  app.post("/engine/v2/palette/sequence", enforceWriteAccess, (req, res) => {
    const body = getRequestMap(req.body);
    const result = enginePaletteService.setSequence(body.sequence);
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json({
      ok: true,
      ...result
    });
  });

  app.post("/engine/v2/palette/cycle", enforceWriteAccess, (req, res) => {
    const body = getRequestMap(req.body);
    const result = enginePaletteService.setCycleConfig({
      holdTicks: body.holdTicks
    });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json({
      ok: true,
      ...result
    });
  });

  app.post("/engine/v2/palette/advance", enforceWriteAccess, (req, res) => {
    const body = getRequestMap(req.body);
    const result = enginePaletteService.advance(body.step);
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json({
      ok: true,
      ...result
    });
  });

  app.post("/engine/v2/start", enforceWriteAccess, (req, res) => {
    const result = engineV2.start({
      requestedBy: String(req?.ip || "")
    });
    res.json({
      ok: true,
      ...result
    });
  });

  app.post("/engine/v2/stop", enforceWriteAccess, (req, res) => {
    const result = engineV2.stop({
      requestedBy: String(req?.ip || "")
    });
    res.json({
      ok: true,
      ...result
    });
  });

  app.post("/engine/v2/tick", enforceWriteAccess, (req, res) => {
    const body = getRequestMap(req.body);
    const result = engineV2.tick({
      reason: String(body.reason || "manual_http_tick")
    });
    res.json({
      ok: true,
      ...result
    });
  });

  // [TITLE] Section: Live Tab Routes
  app.get("/live/status", (_req, res) => {
    res.json(buildCanonicalLiveStatusPayload({
      liveProfileService,
      liveCompatService
    }));
  });

  app.post("/live/scene", enforceWriteAccess, (req, res) => {
    if (!liveCompatService || typeof liveCompatService.patchCompatibility !== "function") {
      res.status(503).json({ ok: false, error: "live_compat_service_unavailable" });
      return;
    }
    const body = getRequestMap(req.body);
    const result = liveCompatService.patchCompatibility({
      sceneLock: body.sceneLock ?? body.sceneIntent ?? body.scene ?? "auto",
      sceneIntent: body.sceneIntent ?? body.sceneLock ?? body.scene ?? "auto"
    });
    res.json(result);
  });

  app.get("/live/sync-groups", (_req, res) => {
    if (!liveCompatService || typeof liveCompatService.getSyncGroups !== "function") {
      res.status(503).json({ ok: false, error: "live_compat_service_unavailable" });
      return;
    }
    res.json(liveCompatService.getSyncGroups());
  });

  app.post("/live/sync-groups", enforceWriteAccess, (req, res) => {
    if (!liveCompatService || typeof liveCompatService.patchSyncGroups !== "function") {
      res.status(503).json({ ok: false, error: "live_compat_service_unavailable" });
      return;
    }
    res.json(liveCompatService.patchSyncGroups(getRequestMap(req.body)));
  });

  app.get("/live/scene-tuning", (_req, res) => {
    if (!liveCompatService || typeof liveCompatService.getTriggerMatrix !== "function") {
      res.status(503).json({ ok: false, error: "live_compat_service_unavailable" });
      return;
    }
    res.json(liveCompatService.getTriggerMatrix());
  });

  app.post("/live/scene-tuning", enforceWriteAccess, (req, res) => {
    if (!liveCompatService || typeof liveCompatService.patchTriggerMatrix !== "function") {
      res.status(503).json({ ok: false, error: "live_compat_service_unavailable" });
      return;
    }
    res.json(liveCompatService.patchTriggerMatrix(getRequestMap(req.body)));
  });

  app.get("/live/profiles", (_req, res) => {
    if (!liveProfileService) {
      res.status(503).json({ ok: false, error: "live_profile_service_unavailable" });
      return;
    }
    res.json({
      ok: true,
      profiles: liveProfileService.listProfiles()
    });
  });

  app.post("/live/profiles/save", enforceWriteAccess, (req, res) => {
    if (!liveProfileService) {
      res.status(503).json({ ok: false, error: "live_profile_service_unavailable" });
      return;
    }
    const body = getRequestMap(req.body);
    const result = liveProfileService.saveProfile(body.name, body.profile || {});
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json({
      ...result,
      profiles: liveProfileService.listProfiles()
    });
  });

  app.post("/live/profiles/load", enforceWriteAccess, (req, res) => {
    if (!liveProfileService) {
      res.status(503).json({ ok: false, error: "live_profile_service_unavailable" });
      return;
    }
    const body = getRequestMap(req.body);
    const result = liveProfileService.loadProfile(body.name);
    if (!result.ok) {
      const status = result.error === "profile_not_found" ? 404 : 400;
      res.status(status).json(result);
      return;
    }
    res.json(result);
  });

  app.delete("/live/profiles/:name", enforceWriteAccess, (req, res) => {
    if (!liveProfileService) {
      res.status(503).json({ ok: false, error: "live_profile_service_unavailable" });
      return;
    }
    const result = liveProfileService.deleteProfile(req.params.name);
    if (!result.ok) {
      const status = result.error === "profile_not_found" ? 404 : 400;
      res.status(status).json(result);
      return;
    }
    res.json({
      ...result,
      profiles: liveProfileService.listProfiles()
    });
  });

  // [TITLE] Section: Rave Runtime Control Routes
  app.get("/rave/status", (_req, res) => {
    const status = audioEngine.getRaveState();
    res.json({
      ok: true,
      active: status.active === true,
      startedAt: status.startedAt || 0,
      lastStoppedAt: status.lastStoppedAt || 0,
      source: String(status.source || "audio_telemetry_port")
    });
  });

  app.post("/rave/on", enforceWriteAccess, async (req, res) => {
    const audioRuntimeResult = await audioRuntimeService.startSession({
      reason: "rave_on_route",
      forceRefreshApps: true
    });
    const audioStartFailed = audioRuntimeResult && audioRuntimeResult.ok === false;
    if (audioStartFailed) {
      if (typeof audioEngine.setTelemetry === "function") {
        audioEngine.setTelemetry({
          running: false,
          lastError: String(audioRuntimeResult?.error || "audio_start_failed"),
          lastRestartReason: "rave_on_route_audio_start_failed"
        });
      }
      res.status(503).json({
        ok: false,
        error: "audio_start_failed",
        detail: String(audioRuntimeResult?.error || "audio capture failed to start"),
        audioRuntime: audioRuntimeResult
      });
      return;
    }
    const startResult = audioEngine.startRave({
      reason: "rave_on_route",
      requestedBy: String(req?.ip || "")
    });
    const engineStart = engineV2.start({
      requestedBy: String(req?.ip || "")
    });
    const hueTransport = (() => {
      if (!hueBridge || typeof hueBridge.syncTransportForFixtures !== "function") return null;
      const hueFixtures = typeof fixtureRegistry?.listEngineBy === "function"
        ? fixtureRegistry.listEngineBy("hue", "", { requireConfigured: false })
        : [];
      return hueBridge.syncTransportForFixtures(hueFixtures, {
        reason: "rave_on_route"
      });
    })();
    if (startResult.alreadyActive === true) {
      res.json({
        ok: true,
        ...startResult,
        engine: engineStart,
        audioRuntime: audioRuntimeResult,
        hueTransport
      });
      return;
    }
    await modRuntime.invokeHook("onRaveStart", {
      at: Number(startResult.startedAt || Date.now()),
      requestedBy: String(req?.ip || "")
    });
    res.json({
      ok: true,
      ...startResult,
      engine: engineStart,
      audioRuntime: audioRuntimeResult,
      hueTransport
    });
  });

  app.post("/rave/off", enforceWriteAccess, async (req, res) => {
    const stopResult = audioEngine.stopRave({
      reason: "rave_off_route",
      requestedBy: String(req?.ip || "")
    });
    const audioRuntimeResult = audioRuntimeService.stopSession({
      reason: "rave_off_route"
    });
    const engineStop = engineV2.stop({
      requestedBy: String(req?.ip || "")
    });
    await modRuntime.invokeHook("onRaveStop", {
      at: Number(stopResult.stoppedAt || Date.now()),
      wasActive: stopResult.wasActive === true,
      requestedBy: String(req?.ip || "")
    });
    const profileResult = await colorCommandService.applyTwitchRaveOffColorProfile();
    res.json({
      ok: true,
      ...stopResult,
      engine: engineStop,
      profile: profileResult,
      audioRuntime: audioRuntimeResult
    });
  });

  // [TITLE] Section: Teach Color Route
  app.post("/teach", enforceWriteAccess, (req, res) => {
    const text = getCompatText(req);
    const result = colorLibrary.teachColor(text);
    if (result.ok !== true) {
      let error = "teach request failed";
      let status = 400;
      if (result.reason === "invalid_format" || result.reason === "empty_input") {
        error = "invalid teach format";
      } else if (result.reason === "invalid_name") {
        error = "invalid color name";
      } else if (result.reason === "invalid_hex") {
        error = "invalid hex color";
      }
      res.status(status).json({
        ok: false,
        text,
        error,
        reason: result.reason,
        detail: "Use: <name> <#RRGGBB> or <#RRGGBB> <name> (example: toxic_green #39ff14)"
      });
      return;
    }

    res.status(200).json({
      ok: true,
      text,
      taughtName: result.name,
      taughtHex: result.hex,
      changed: result.changed === true,
      reason: result.reason,
      refundRecommended: result.refundRecommended === true,
      message: result.changed
        ? `color learned as "${result.name}" and available immediately`
        : `color already exists as "${result.name}" (no change made)`
    });
  });

  // [TITLE] Section: Twitch Color Prefix Config Routes
  app.get("/color/prefixes", (_req, res) => {
    res.json({
      ok: true,
      config: twitchColorConfig.getSnapshot(),
      capabilities: twitchColorConfig.getCapabilities(
        fixtureRegistry.listTwitchBy("", "", { requireConfigured: false })
      )
    });
  });

  app.post("/color/prefixes", enforceWriteAccess, (req, res) => {
    // [DEV] Patch alias compatibility preserves older client payload keys
    // [DEV] so existing bot/widget payloads still map cleanly to runtime config.
    const body = getRequestMap(req.body);
    const patch = {};
    const hasOwn = key => Object.prototype.hasOwnProperty.call(body, key);

    if (hasOwn("defaultTarget")) patch.defaultTarget = body.defaultTarget;
    if (hasOwn("autoDefaultTarget")) patch.autoDefaultTarget = body.autoDefaultTarget;
    if (hasOwn("autoDefault")) patch.autoDefaultTarget = body.autoDefault;

    if (body.prefixes && typeof body.prefixes === "object") {
      patch.prefixes = { ...body.prefixes };
    }
    if (body.fixturePrefixes && typeof body.fixturePrefixes === "object" && !Array.isArray(body.fixturePrefixes)) {
      patch.fixturePrefixes = { ...body.fixturePrefixes };
    }
    if (body.raveOff && typeof body.raveOff === "object" && !Array.isArray(body.raveOff)) {
      patch.raveOff = { ...body.raveOff };
    }

    const aliasMap = [
      ["huePrefix", "hue"],
      ["wizPrefix", "wiz"],
      ["otherPrefix", "other"]
    ];
    for (const [bodyKey, prefixKey] of aliasMap) {
      if (!hasOwn(bodyKey)) continue;
      patch.prefixes = patch.prefixes || {};
      patch.prefixes[prefixKey] = body[bodyKey];
    }

    if (body.clearOther === true || body.reset === true) {
      patch.prefixes = patch.prefixes || {};
      patch.prefixes.other = "";
    }
    if (body.clearFixturePrefixes === true || body.reset === true) {
      patch.fixturePrefixes = {};
    }
    if (hasOwn("raveOffEnabled")) {
      patch.raveOff = patch.raveOff || {};
      patch.raveOff.enabled = body.raveOffEnabled;
    }
    if (hasOwn("raveOffDefaultText")) {
      patch.raveOff = patch.raveOff || {};
      patch.raveOff.defaultText = body.raveOffDefaultText;
    }
    if (body.raveOffGroups && typeof body.raveOffGroups === "object" && !Array.isArray(body.raveOffGroups)) {
      patch.raveOff = patch.raveOff || {};
      patch.raveOff.groups = { ...body.raveOffGroups };
    }
    if (body.raveOffFixtures && typeof body.raveOffFixtures === "object" && !Array.isArray(body.raveOffFixtures)) {
      patch.raveOff = patch.raveOff || {};
      patch.raveOff.fixtures = { ...body.raveOffFixtures };
    }
    if (body.clearRaveOffGroups === true || body.reset === true) {
      patch.raveOff = patch.raveOff || {};
      patch.raveOff.groups = {};
    }
    if (body.clearRaveOffFixtures === true || body.reset === true) {
      patch.raveOff = patch.raveOff || {};
      patch.raveOff.fixtures = {};
    }

    const config = twitchColorConfig.patch(patch);
    res.json({
      ok: true,
      config,
      capabilities: twitchColorConfig.getCapabilities(
        fixtureRegistry.listTwitchBy("", "", { requireConfigured: false })
      )
    });
  });

  // [TITLE] Section: Color Command Routes
  async function handleColorRequest(req, res) {
    const text = getCompatText(req);
    const options = getColorRequestOptions(req, twitchColorConfig.parseColorTarget);
    const result = await colorCommandService.applyColorText(text, options);
    if (result.ok) {
      res.json({ ok: true, text, ...result });
      return;
    }
    const message = String(result.error || "").toLowerCase();
    const status = message.includes("rave active") ? 409 : 200;
    res.status(status).json({ ok: false, text, ...result });
  }

  const enableLegacyColorGet = parseBoolean(process.env.RAVELINK_ENABLE_LEGACY_COLOR_GET, false);
  if (enableLegacyColorGet) {
    app.get("/color", (req, res) => {
      handleColorRequest(req, res).catch(err => {
        res.status(500).json({ ok: false, error: err?.message || String(err) });
      });
    });
  } else {
    app.get("/color", (_req, res) => {
      res.status(405).json({
        ok: false,
        error: "method_not_allowed",
        detail: "Use POST /color. Set RAVELINK_ENABLE_LEGACY_COLOR_GET=1 to re-enable legacy GET compatibility."
      });
    });
  }

  app.post("/color", enforceWriteAccess, (req, res) => {
    handleColorRequest(req, res).catch(err => {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    });
  });

  registerCompatRoutes(app, {
    enforceWriteAccess,
    midiManager,
    modRuntime,
    fixtureRegistry,
    engineV2,
    enginePaletteService,
    liveCompatService,
    audioRuntimeService,
    systemConfigService,
    internetGatewayRuntime,
    systemUpdateService,
    systemOauthService,
    startupReadinessService,
    startupLaunchDiagnosticsService,
    audioEngine,
    hueBridge,
    wizBridge,
    requestSystemStop
  });
}

module.exports = registerRoutes;
module.exports.normalizeRemoteAddress = normalizeRemoteAddress;
module.exports.isLoopbackAddress = isLoopbackAddress;
module.exports.isSameHostSocketAddress = isSameHostSocketAddress;
module.exports.isWriteRequestAllowed = isWriteRequestAllowed;
