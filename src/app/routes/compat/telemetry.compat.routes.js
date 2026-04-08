// [TITLE] Module: app/routes/compat/telemetry.compat.routes.js
// [TITLE] Purpose: register telemetry compatibility routes for current UI/runtime contracts
// [TITLE] Functionality Index:
// [TITLE] - rave telemetry projection compatibility route
// [TITLE] - Hue and WiZ adapter telemetry passthrough compatibility routes
// [DEV] Complex Flow:
// [DEV] This slice keeps telemetry shaping isolated so future cleanup can move
// [DEV] payload normalization closer to engine/audio services without touching unrelated routes.

function normalizeCompatSceneTelemetryToken(value, fallback = "steady") {
  const token = String(value || "").trim().toLowerCase();
  if (!token) return fallback;
  if (token === "auto") return fallback;
  if (token === "idle" || token === "calm" || token === "scene_idle") return "steady";
  if (token === "flow" || token === "groove" || token === "scene_flow") return "motion";
  if (token === "pulse" || token === "scene_pulse") return "impact";
  if (token === "steady" || token === "motion" || token === "impact") return token;
  return fallback;
}

module.exports = function registerTelemetryCompatRoutes(app, deps = {}) {
  const audioEngine = deps.audioEngine;
  const engineV2 = deps.engineV2;
  const liveCompatService = deps.liveCompatService;
  const hueBridge = deps.hueBridge;
  const wizBridge = deps.wizBridge;
  const getRequestMap = typeof deps.getRequestMap === "function"
    ? deps.getRequestMap
    : (value => (value && typeof value === "object" && !Array.isArray(value) ? value : {}));
  const clampNumber = typeof deps.clampNumber === "function"
    ? deps.clampNumber
    : ((value, _min, _max, fallback) => Number.isFinite(Number(value)) ? Number(value) : Number(fallback));

  // [TITLE] Section: Telemetry Compatibility Routes
  app.get("/rave/telemetry", (_req, res) => {
    const nowMs = Date.now();
    const raveStatus = audioEngine?.getRaveState?.() || {};
    const audioTelemetry = audioEngine?.getTelemetry?.() || {};
    const audioStatus = audioEngine?.getStatus?.() || {};
    const engineStatus = engineV2?.getStatus?.() || {};
    const projection = engineV2?.getTelemetryProjection?.() || {};
    const sceneProjection = getRequestMap(projection.scene);
    const cadenceProjection = getRequestMap(sceneProjection.cadenceState);
    const compatibility = liveCompatService?.getCompatibility?.() || { ok: true, snapshot: {} };
    const triggerMatrix = liveCompatService?.getTriggerMatrix?.() || { ok: true };
    const tiers = liveCompatService?.getOverclockTiers?.() || { ok: true, tiers: [] };
    const sceneLock = String(compatibility?.snapshot?.sceneLock || "auto").trim().toLowerCase() || "auto";
    const scene = normalizeCompatSceneTelemetryToken(
      sceneProjection.sceneIntent ||
      sceneProjection.sceneCandidate ||
      compatibility?.snapshot?.sceneIntent ||
      sceneLock,
      "steady"
    );
    const rms = clampNumber(
      audioTelemetry.audioRms ?? audioTelemetry.rms ?? sceneProjection.rms,
      0,
      1,
      0.03
    );
    const energy = clampNumber(
      audioTelemetry.energy ?? sceneProjection.energy,
      0,
      1,
      0.05
    );
    const bpm = clampNumber(
      audioTelemetry.bpm ?? sceneProjection.bpm,
      0,
      260,
      0
    );
    const flowIntensity = clampNumber(sceneProjection.flowIntensity, 0, 4, 1);
    const sceneBrightness = clampNumber(sceneProjection.brightness, 0, 1, 0);
    const brightnessSourceNormalized = clampNumber(sceneProjection.brightnessSourceNormalized, 0, 1, 0);
    const brightnessSourceRaw = clampNumber(sceneProjection.brightnessSourceRaw, 0, 1, 0);
    const brightnessMusicalDrive = clampNumber(sceneProjection.brightnessMusicalDrive, 0, 1, 0);
    const brightnessRangeDemand = clampNumber(sceneProjection.brightnessRangeDemand, 0, 1, 0);
    const loudness = clampNumber(sceneProjection.loudness, 0, 1, 0);
    const loudnessAdaptive = clampNumber(sceneProjection.loudnessAdaptive, 0, 1, 0);
    const loudnessSection = clampNumber(sceneProjection.loudnessSection, 0, 1, 0);
    const loudnessSectionBand = String(sceneProjection.loudnessSectionBand || "normal").trim().toLowerCase() || "normal";
    const musicalProfile = String(sceneProjection.musicalProfile || "groove").trim().toLowerCase() || "groove";
    const musicalDriveNorm = clampNumber(sceneProjection.musicalDriveNorm, 0, 1, 0);
    const cadenceAutoEnabled = cadenceProjection.autoEnabled === true;
    const cadenceAutoSource = cadenceAutoEnabled ? "auto_hz" : "manual";
    const cadenceAutoRequestedHz = clampNumber(
      cadenceProjection.requestedHz,
      0,
      60,
      Number(cadenceProjection.requestedHz || 0)
    );
    const cadenceAutoAppliedHz = clampNumber(
      cadenceProjection.appliedHz,
      0,
      60,
      Number(cadenceProjection.appliedHz || 0)
    );
    const cadenceAutoGuardReason = String(
      cadenceProjection.guardReason ||
      (cadenceProjection.guarded === true ? "hardware_limit" : "none")
    ).trim().toLowerCase() || "none";
    const cadenceAutoGuarded = cadenceProjection.guarded === true;
    const overclockLevel = Number.isFinite(Number(cadenceProjection.overclockLevel))
      ? Number(cadenceProjection.overclockLevel)
      : Number(tiers.activeLevel || 0);

    res.json({
      ok: true,
      source: "engine_v2_projection",
      at: nowMs,
      active: raveStatus.active === true,
      running: engineStatus.running === true,
      scene,
      behavior: "deterministic_palette_runtime",
      phrase: scene,
      drop: false,
      energy,
      rms,
      audioRms: rms,
      audioSourceLevel: rms,
      bpm,
      flowIntensity,
      brightness: sceneBrightness,
      brightnessSourceNormalized,
      brightnessSourceRaw,
      brightnessMusicalDrive,
      brightnessRangeDemand,
      loudness,
      loudnessAdaptive,
      loudnessSection,
      loudnessSectionBand,
      musicalProfile,
      musicalDriveNorm,
      brightnessPowerMode: "b",
      paletteBrightnessSceneActive: scene,
      overclockLevel,
      cadenceAutoEnabled,
      cadenceAutoSource,
      cadenceAutoRequestedHz,
      cadenceAutoAppliedHz,
      cadenceAutoGuardReason,
      cadenceAutoGuarded,
      overclockAutoEnabled: cadenceAutoEnabled,
      overclockAutoReason: cadenceAutoEnabled ? "enabled" : "off",
      overclockAutoHz: cadenceAutoEnabled ? cadenceAutoAppliedHz : 0,
      audio: {
        backend: String(audioStatus.backend || "unwired"),
        telemetryUpdatedAt: Number(audioStatus.telemetryUpdatedAt || 0)
      },
      compatibility: compatibility.snapshot || {},
      sceneLock,
      triggerMatrix,
      overclock: {
        autoEnabled: cadenceAutoEnabled,
        level: overclockLevel,
        devHz: Number(tiers.devHz || 0)
      },
      engine: {
        running: engineStatus.running === true,
        tickMs: Number(engineStatus.tickMs || 0),
        tickCount: Number(engineStatus.tickCount || 0),
        projection
      }
    });
  });

  app.get("/hue/telemetry", (_req, res) => {
    if (hueBridge && typeof hueBridge.getTelemetry === "function") {
      res.json(hueBridge.getTelemetry());
      return;
    }
    res.json({
      ok: true,
      source: "compat_projection",
      status: "ready"
    });
  });

  app.get("/wiz/telemetry", (_req, res) => {
    if (wizBridge && typeof wizBridge.getTelemetry === "function") {
      res.json(wizBridge.getTelemetry());
      return;
    }
    res.json({
      ok: true,
      source: "compat_projection",
      status: "ready"
    });
  });
};
