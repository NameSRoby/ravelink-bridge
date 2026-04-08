// [TITLE] Module: domains/engine-v2/engine.runtime.js
// [TITLE] Purpose: Engine v2 runtime lifecycle + palette/policy/dispatch orchestration
// [TITLE] Functionality Index:
// [TITLE] - own start/stop/tick lifecycle and status projection
// [TITLE] - apply palette baseline and twitch-highest override policy ordering
// [TITLE] - dispatch intents with hardware-cap-aware Hue/WiZ pacing
// [DEV] Complex Flow:
// [DEV] Twitch policy executes last and may override routing globally. Dispatchers then
// [DEV] apply brand pacing caps so hardware limits are respected while maximizing update rate.

const createEnginePolicyRegistry = require("./engine.policy-registry");
const createEngineIntentMapper = require("./engine.intent-mapper");
const createEngineScheduler = require("./engine.scheduler");
const createEngineSceneStateModel = require("./engine.scene-state");
const {
  ENGINE_V2_DEFAULT_TICK_MS,
  clampNumber,
  buildEngineTelemetryProjection
} = require("./engine.contracts");
const {
  SYNC_GROUP_DEFAULT_REMOVE_BEHAVIOR,
  SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT,
  normalizeSyncGroupRemoveBehaviorRuntime,
  normalizeSyncGroupCustomFallbackRuntime,
  buildSyncGroupFixtureMapRuntime,
  resolveSyncGroupPaletteIndexRuntime,
  resolvePaletteFrameByIndexRuntime
} = require("./engine.runtime.sync-groups");
const {
  buildEngineRuntimeProfileSnapshot
} = require("./engine.runtime.profile");
const createEngineRuntimeFixtureCatalog = require("./engine.runtime.fixture-catalog");
const createEngineRuntimeFixtureExclusions = require("./engine.runtime.fixture-exclusions");
const createEngineRuntimeCadence = require("./engine.runtime.cadence");
const createEngineRuntimePaletteAdvance = require("./engine.runtime.palette-advance");
const createEngineRuntimePaletteMapper = require("./engine.runtime.palette-mapper");
const {
  createHueStateFromRgb,
  createWizStateFromRgb,
  hexToRgb
} = require("../colors/color-space");

const OVERCLOCK_HZ_BY_LEVEL = Object.freeze({
  0: 2,
  1: 4,
  2: 6,
  3: 8,
  4: 10,
  5: 12,
  6: 14,
  7: 16
});

const PALETTE_MAPPER_MODES = new Set(["strict", "musical"]);
const WIZ_DIMMING_MIN = 10;
const WIZ_DIMMING_MAX = 100;
const WIZ_BRIGHTNESS_BASELINE_FLOOR = 0.02;
const ENGINE_BRIGHTNESS_BASELINE_FLOOR = 0.02;

function normalizePaletteMapperMode(value, fallback = "strict") {
  const token = String(value || "").trim().toLowerCase();
  if (token === "literal") return "strict";
  if (PALETTE_MAPPER_MODES.has(token)) return token;
  const fallbackToken = String(fallback || "").trim().toLowerCase();
  if (fallbackToken === "literal") return "strict";
  return PALETTE_MAPPER_MODES.has(fallbackToken) ? fallbackToken : "strict";
}

function buildHueDispatchStateKey(state = {}) {
  const xy = Array.isArray(state.xy) ? state.xy : [];
  const x = clampNumber(Number(xy[0]), 0, 1, 0);
  const y = clampNumber(Number(xy[1]), 0, 1, 0);
  const bri = clampNumber(Math.round(Number(state.bri)), 1, 254, 254);
  const transitiontime = clampNumber(Math.round(Number(state.transitiontime)), 0, 30, 1);
  const on = state.on !== false ? 1 : 0;
  return `${on}|${bri}|${transitiontime}|${Math.round(x * 10000)}|${Math.round(y * 10000)}`;
}

function buildWizDispatchStateKey(state = {}) {
  const on = state.on !== false ? 1 : 0;
  const dimming = clampNumber(Math.round(Number(state.dimming)), WIZ_DIMMING_MIN, WIZ_DIMMING_MAX, WIZ_DIMMING_MAX);
  const r = clampNumber(Math.round(Number(state.r)), 0, 255, 0);
  const g = clampNumber(Math.round(Number(state.g)), 0, 255, 0);
  const b = clampNumber(Math.round(Number(state.b)), 0, 255, 0);
  const temp = Number.isFinite(Number(state.temp))
    ? clampNumber(Math.round(Number(state.temp)), 2200, 6500, 3500)
    : 0;
  const speed = Number.isFinite(Number(state.speed))
    ? clampNumber(Math.round(Number(state.speed)), 20, 200, 80)
    : 0;
  return `${on}|${dimming}|${r}|${g}|${b}|${temp}|${speed}`;
}

function mapEngineBrightnessToWizDimming(brightness = 1) {
  // [DEV] WiZ local API dimming is 10..100 (official local-control docs). Engine
  // [DEV] brightness is 0..1, so normalize against our baseline floor first to avoid
  // [DEV] low/mid values collapsing at dimming=10 and losing musical contrast.
  const safeBrightness = clampNumber(Number(brightness), 0, 1, 1);
  if (safeBrightness >= 0.985) return WIZ_DIMMING_MAX;
  const normalized = clampNumber(
    (safeBrightness - WIZ_BRIGHTNESS_BASELINE_FLOOR) / Math.max(0.0001, 1 - WIZ_BRIGHTNESS_BASELINE_FLOOR),
    0,
    1,
    safeBrightness
  );
  // [DEV] Keep brightness-only dynamics visible on WiZ without mutating RGB hue.
  const perceptual = Math.pow(normalized, 1.22);
  const dimming = Math.round(
    WIZ_DIMMING_MIN + ((WIZ_DIMMING_MAX - WIZ_DIMMING_MIN) * perceptual)
  );
  return clampNumber(dimming, WIZ_DIMMING_MIN, WIZ_DIMMING_MAX, WIZ_DIMMING_MAX);
}

function mapEngineBrightnessToHueBri(brightness = 1) {
  const safeBrightness = clampNumber(Number(brightness), 0, 1, 1);
  if (safeBrightness >= 0.985) return 254;
  const normalized = clampNumber(
    (safeBrightness - ENGINE_BRIGHTNESS_BASELINE_FLOOR) / Math.max(0.0001, 1 - ENGINE_BRIGHTNESS_BASELINE_FLOOR),
    0,
    1,
    safeBrightness
  );
  const perceptual = Math.pow(normalized, 1.08);
  const bri = Math.round(1 + (253 * perceptual));
  return clampNumber(bri, 1, 254, 254);
}

function easeOutFactor(alpha = 0.3, power = 1.25) {
  const t = clampNumber(Number(alpha), 0, 1, 0.3);
  const p = clampNumber(Number(power), 1, 3, 1.25);
  return clampNumber(1 - Math.pow(1 - t, p), 0, 1, t);
}

function createFallbackPaletteService() {
  return {
    consumeTickFrame() {
      return {
        index: 0,
        token: "white",
        name: "white",
        hex: "#ffffff",
        rgb: { r: 255, g: 255, b: 255 },
        source: "fallback",
        count: 1,
        holdTicks: 1
      };
    },
    getSnapshot() {
      return {
        version: 0,
        customColors: {},
        sequence: ["white"],
        resolvedSequence: [{
          index: 0,
          token: "white",
          name: "white",
          hex: "#ffffff",
          rgb: { r: 255, g: 255, b: 255 },
          source: "fallback"
        }],
        activeIndex: 0,
        holdTicks: 1,
        current: {
          index: 0,
          token: "white",
          name: "white",
          hex: "#ffffff",
          rgb: { r: 255, g: 255, b: 255 },
          source: "fallback"
        },
        colorCount: 1
      };
    },
    teachCustomColor() {
      return { ok: false, error: "palette_service_unavailable" };
    },
    setSequence() {
      return { ok: false, error: "palette_service_unavailable" };
    },
    setCycleConfig() {
      return { ok: false, error: "palette_service_unavailable" };
    },
    advance() {
      return { ok: false, error: "palette_service_unavailable" };
    }
  };
}

function normalizeTwitchOverrideColor(event = {}) {
  const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
  const rgb = payload.rgb && typeof payload.rgb === "object"
    ? {
      r: clampNumber(Math.round(Number(payload.rgb.r)), 0, 255, 255),
      g: clampNumber(Math.round(Number(payload.rgb.g)), 0, 255, 255),
      b: clampNumber(Math.round(Number(payload.rgb.b)), 0, 255, 255)
    }
    : null;
  const hex = String(payload.hex || payload.colorHex || "").trim().toLowerCase();
  if (rgb) {
    return {
      rgb,
      brightness: clampNumber(Number(payload.brightness), 0, 1, 1),
      transitionMs: clampNumber(Number(payload.transitionMs), 0, 60000, 120),
      owner: "twitch_override_rgb"
    };
  }
  const hexMatch = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!hexMatch) return null;
  const safe = hexMatch[1];
  return {
    rgb: {
      r: parseInt(safe.slice(0, 2), 16),
      g: parseInt(safe.slice(2, 4), 16),
      b: parseInt(safe.slice(4, 6), 16)
    },
    brightness: clampNumber(Number(payload.brightness), 0, 1, 1),
    transitionMs: clampNumber(Number(payload.transitionMs), 0, 60000, 120),
    owner: "twitch_override_hex"
  };
}

function normalizeScopedRuntimeBrandToken(value) {
  const token = String(value || "").trim().toLowerCase();
  if (token === "hue" || token === "wiz") return token;
  return "";
}

function normalizeScopedRuntimeFixtureId(value) {
  return String(value || "").trim();
}

function applyScopedRuntimeClampToLayer(layer = {}, runtimeTuning = {}, ownerSuffix = "scope") {
  const source = layer && typeof layer === "object" ? layer : {};
  const tuning = runtimeTuning && typeof runtimeTuning === "object" ? runtimeTuning : {};
  const brightnessFloor = clampNumber(tuning.brightnessFloor, 0, 0.9, 0.02);
  const brightnessCeil = clampNumber(tuning.brightnessCeil, brightnessFloor, 1, 1);
  const transitionFloorMs = clampNumber(tuning.transitionFloorMs, 20, 5000, 32);
  const transitionCeilMs = clampNumber(tuning.transitionCeilMs, transitionFloorMs, 60000, 190);
  return {
    ...source,
    brightness: clampNumber(source.brightness, brightnessFloor, brightnessCeil, source.brightness ?? brightnessCeil),
    transitionMs: clampNumber(source.transitionMs, transitionFloorMs, transitionCeilMs, source.transitionMs ?? transitionFloorMs),
    owner: `${String(source.owner || "engine_v2").trim() || "engine_v2"}:runtime_scope:${String(ownerSuffix || "scope").trim()}`
  };
}

module.exports = function createEngineV2Runtime(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const setIntervalFn = typeof options.setInterval === "function" ? options.setInterval : setInterval;
  const clearIntervalFn = typeof options.clearInterval === "function" ? options.clearInterval : clearInterval;
  const audioEngine = options.audioEngine;
  const fixtureRegistry = options.fixtureRegistry;
  const liveProfileService = options.liveProfileService;
  const liveCompatService = options.liveCompatService;
  const paletteService = options.paletteService && typeof options.paletteService.consumeTickFrame === "function"
    ? options.paletteService
    : createFallbackPaletteService();
  const hueBridge = options.hueBridge;
  const wizBridge = options.wizBridge;
  const dryRunTransport = options.dryRunTransport !== false;
  const paletteMapperMode = normalizePaletteMapperMode(options.paletteMapperMode, "strict");

  if (!audioEngine || typeof audioEngine.getTelemetry !== "function") {
    throw new Error("createEngineV2Runtime requires audioEngine.getTelemetry()");
  }
  if (!fixtureRegistry || typeof fixtureRegistry.listEngineBy !== "function") {
    throw new Error("createEngineV2Runtime requires fixtureRegistry.listEngineBy()");
  }

  const tickMs = clampNumber(
    Math.round(Number(options.tickMs || ENGINE_V2_DEFAULT_TICK_MS)),
    20,
    5000,
    ENGINE_V2_DEFAULT_TICK_MS
  );
  const hardwareLimits = {
    hueMaxHz: clampNumber(Number(options.hardwareLimits?.hueMaxHz ?? options.hueMaxHz), 1, 60, 16),
    wizMaxHz: clampNumber(Number(options.hardwareLimits?.wizMaxHz ?? options.wizMaxHz), 1, 60, 16)
  };
  const lastBrandDispatchAt = {
    hue: 0,
    wiz: 0
  };
  // [DEV] Fixture transport rows are captured once per tick and reused by both
  // [DEV] mapper input and dispatch. This avoids a second registry scan that
  // [DEV] would grow linearly with large fixture catalogs.
  const fixtureIntentSmoothingState = new Map();
  const fixtureLastEngineStateById = new Map();
  const fixtureBaselineStateById = new Map();
  const sceneStateModel = createEngineSceneStateModel({ now });
  const paletteMapper = createEngineRuntimePaletteMapper({
    clampNumber,
    paletteService,
    paletteMapperMode,
    getAppliedCadenceHz: () => Number(lastDispatch?.cadence?.appliedHz || lastDispatch?.cadence?.requestedHz || 6)
  });
  const cadenceRuntime = createEngineRuntimeCadence({
    clampNumber,
    hardwareLimits,
    OVERCLOCK_HZ_BY_LEVEL
  });
  const paletteAdvanceRuntime = createEngineRuntimePaletteAdvance({
    clampNumber,
    paletteMapperMode
  });
  const fixtureCatalogRuntime = createEngineRuntimeFixtureCatalog({
    fixtureRegistry,
    buildSyncGroupFixtureMapRuntime,
    normalizeSyncGroupRemoveBehaviorRuntime,
    normalizeSyncGroupCustomFallbackRuntime,
    fixtureIntentSmoothingState,
    SYNC_GROUP_DEFAULT_REMOVE_BEHAVIOR,
    SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT
  });
  const fixtureExclusions = createEngineRuntimeFixtureExclusions({
    now,
    clampNumber,
    WIZ_DIMMING_MIN,
    WIZ_DIMMING_MAX,
    SYNC_GROUP_DEFAULT_REMOVE_BEHAVIOR,
    SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT,
    normalizeSyncGroupRemoveBehaviorRuntime,
    normalizeSyncGroupCustomFallbackRuntime,
    mapEngineBrightnessToHueBri,
    createHueStateFromRgb,
    createWizStateFromRgb,
    hexToRgb,
    buildHueDispatchStateKey,
    buildWizDispatchStateKey,
    hueBridge,
    wizBridge,
    fixtureIntentSmoothingState,
    fixtureLastEngineStateById,
    fixtureBaselineStateById,
    consoleRef: console
  });
  const asyncBrandDispatchState = {
    hue: {
      inFlight: false,
      pending: null
    },
    wiz: {
      inFlight: false,
      pending: null
    }
  };

  // [TITLE] Async Dispatch Queue (Per Brand)
  // [DEV] Some transport adapters return promises and may take longer than one
  // [DEV] engine tick. We coalesce overlapping dispatches per brand so stale
  // [DEV] frames do not pile up and create visible lag/chop.
  function queueBrandDispatch(brand = "", payload = null, executeAsync = async () => {}) {
    const token = String(brand || "").trim().toLowerCase();
    if (!token || !asyncBrandDispatchState[token] || !payload) return "noop";
    const state = asyncBrandDispatchState[token];
    if (state.inFlight) {
      state.pending = payload;
      return "queued";
    }
    state.inFlight = true;
    state.pending = null;

    const runQueue = async initialPayload => {
      let current = initialPayload;
      while (current) {
        try {
          await Promise.resolve(executeAsync(current));
        } catch (error) {
          console.warn(
            `[ENGINE_V2] ${token} async dispatch failed:`,
            error?.message || error || "dispatch_failed"
          );
        }
        current = state.pending;
        state.pending = null;
      }
      state.inFlight = false;
    };

    void runQueue(payload);
    return "started";
  }

  // [TITLE] Dispatch Intent Easing
  // [DEV] Smooth brightness/transition only. RGB must remain literal so palette
  // [DEV] colors are never washed/shifted by easing.
  function easeFixtureIntent(intent = {}, sceneState = {}, cadenceState = {}) {
    const source = intent && typeof intent === "object" ? intent : {};
    const fixtureId = String(source.fixtureId || "").trim();
    const rgb = source.rgb && typeof source.rgb === "object"
      ? {
        r: clampNumber(Math.round(Number(source.rgb.r)), 0, 255, 0),
        g: clampNumber(Math.round(Number(source.rgb.g)), 0, 255, 0),
        b: clampNumber(Math.round(Number(source.rgb.b)), 0, 255, 0)
      }
      : null;
    if (!fixtureId || !rgb) return source;

    const brightnessTarget = clampNumber(Number(source.brightness), 0, 1, 1);
    const transitionTargetMs = clampNumber(Number(source.transitionMs), 0, 60000, 120);
    const profile = String(sceneState?.musicalProfile || "groove").trim().toLowerCase() || "groove";
    const driveNorm = clampNumber(Number(sceneState?.musicalDriveNorm), 0, 1, 0.46);
    const beatPulse = sceneState?.beatPulse === true;
    const cadenceHz = clampNumber(
      Number(cadenceState?.appliedHz || cadenceState?.requestedHz),
      1,
      20,
      6
    );
    const cadenceNorm = clampNumber((cadenceHz - 2) / 14, 0, 1, 0.3);
    const prev = fixtureIntentSmoothingState.get(fixtureId);
    if (!prev) {
      const seeded = {
        rgb: { ...rgb },
        brightness: brightnessTarget,
        transitionMs: transitionTargetMs
      };
      fixtureIntentSmoothingState.set(fixtureId, seeded);
      return {
        ...source,
        rgb: { ...seeded.rgb },
        brightness: seeded.brightness,
        transitionMs: seeded.transitionMs
      };
    }

    const brightnessAlphaBase = profile === "calm"
      ? 0.22
      : (profile === "aggressive" ? 0.3 : 0.25);
    const brightnessAlpha = clampNumber(
      brightnessAlphaBase + (driveNorm * 0.14) + (cadenceNorm * 0.07) + (beatPulse ? 0.06 : 0),
      0.14,
      0.62,
      brightnessAlphaBase
    );
    const transitionAlpha = beatPulse ? 0.44 : 0.34;
    const brightnessEaseAlpha = easeOutFactor(brightnessAlpha, 1.16);
    const transitionEaseAlpha = easeOutFactor(transitionAlpha, 1.12);
    const prevBrightness = clampNumber(Number(prev.brightness), 0, 1, brightnessTarget);
    const brightnessDelta = Math.abs(brightnessTarget - prevBrightness);
    const snapBrightness = brightnessDelta >= (beatPulse ? 0.26 : 0.3);
    const prevTransitionMs = clampNumber(Number(prev.transitionMs), 0, 60000, transitionTargetMs);
    const transitionDelta = Math.abs(transitionTargetMs - prevTransitionMs);
    const snapTransition = transitionDelta >= (beatPulse ? 110 : 140);
    const holdBrightness = !beatPulse && brightnessDelta <= 0.012;
    const holdTransition = !beatPulse && transitionDelta <= 22;
    const next = {
      rgb: { ...rgb },
      brightness: holdBrightness
        ? prevBrightness
        : (snapBrightness
        ? brightnessTarget
        : clampNumber(
          prevBrightness + ((brightnessTarget - prevBrightness) * brightnessEaseAlpha),
          0,
          1,
          brightnessTarget
        )),
      transitionMs: holdTransition
        ? prevTransitionMs
        : (snapTransition
        ? transitionTargetMs
        : clampNumber(
          Math.round(prevTransitionMs + ((transitionTargetMs - prevTransitionMs) * transitionEaseAlpha)),
          0,
          60000,
          transitionTargetMs
        ))
    };
    fixtureIntentSmoothingState.set(fixtureId, next);
    return {
      ...source,
      rgb: { ...next.rgb },
      brightness: next.brightness,
      transitionMs: next.transitionMs
    };
  }

  const policyRegistry = createEnginePolicyRegistry();
  // [DEV] Twitch policy intentionally stays last/highest to satisfy hard priority requirement.
  policyRegistry.registerPolicy({
    id: "profile_baseline",
    priority: 100,
    apply(state = {}, context = {}) {
      const paletteFrame = context?.input?.paletteFrame;
      if (!paletteFrame?.rgb) return { ...state };
      const routing = state.routing && typeof state.routing === "object" ? state.routing : {};
      const sceneIntent = String(state.sceneIntent || "steady").trim().toLowerCase() || "steady";
      const brightness = clampNumber(state.brightness, 0, 1, 1);
      const transitionMs = clampNumber(
        state.transitionMs,
        0,
        60000,
        clampNumber(context?.tickMeta?.tickMs, 0, 60000, tickMs)
      );
      return {
        ...state,
        palette: {
          index: Number(paletteFrame.index || 0),
          token: String(paletteFrame.token || ""),
          name: String(paletteFrame.name || ""),
          hex: String(paletteFrame.hex || ""),
          source: String(paletteFrame.source || "")
        },
        routing: {
          ...routing,
          global: {
            rgb: { ...paletteFrame.rgb },
            brightness,
            transitionMs,
            owner: `palette:${String(paletteFrame.name || paletteFrame.token || "sequence").trim() || "sequence"}:${sceneIntent}`
          }
        }
      };
    }
  });
  policyRegistry.registerPolicy({
    id: "live_overrides",
    priority: 200,
    apply(state = {}) {
      return { ...state };
    }
  });
  policyRegistry.registerPolicy({
    id: "live_sync_groups",
    priority: 210,
    apply(state = {}, context = {}) {
      const routing = state.routing && typeof state.routing === "object" ? state.routing : {};
      const globalLayer = routing.global && typeof routing.global === "object" ? routing.global : null;
      if (!globalLayer?.rgb) return { ...state };

      const triggerMatrix = context?.input?.profile?.payload?.triggerMatrix;
      const syncGroups = buildSyncGroupFixtureMapRuntime(triggerMatrix?.syncGroups);
      if (syncGroups.enabled !== true || syncGroups.groups.length <= 0) return { ...state };

      const fixtures = Array.isArray(context?.input?.fixtures) ? context.input.fixtures : [];
      if (!fixtures.length) return { ...state };

      const paletteFrame = context?.input?.paletteFrame && typeof context.input.paletteFrame === "object"
        ? context.input.paletteFrame
        : {};
      const paletteSnapshot = typeof paletteService.getSnapshot === "function"
        ? paletteService.getSnapshot()
        : null;
      const sequenceCount = Math.max(
        1,
        Math.round(Number(
          (Array.isArray(paletteSnapshot?.resolvedSequence) ? paletteSnapshot.resolvedSequence.length : 0) ||
          paletteSnapshot?.colorCount ||
          paletteFrame.count ||
          1
        ))
      );
      const baseIndex = ((Math.round(Number(paletteFrame.index || 0)) % sequenceCount) + sequenceCount) % sequenceCount;

      const nextRouting = { ...routing };
      const nextFixtures = { ...(routing.fixtures && typeof routing.fixtures === "object" ? routing.fixtures : {}) };
      const paletteByGroup = new Map();
      let appliedFixtures = 0;

      for (const fixture of fixtures) {
        const fixtureId = String(fixture?.id || "").trim();
        if (!fixtureId) continue;
        const group = syncGroups.fixtureGroupById.get(fixtureId);
        if (!group) continue;
        if (!paletteByGroup.has(group.id)) {
          const groupIndex = resolveSyncGroupPaletteIndexRuntime(baseIndex, sequenceCount, group);
          paletteByGroup.set(
            group.id,
            resolvePaletteFrameByIndexRuntime({
              paletteSnapshot,
              basePaletteFrame: paletteFrame,
              index: groupIndex
            })
          );
        }
        const groupPalette = paletteByGroup.get(group.id);
        if (!groupPalette?.rgb || typeof groupPalette.rgb !== "object") continue;
        const fixtureLayer = nextFixtures[fixtureId] && typeof nextFixtures[fixtureId] === "object"
          ? nextFixtures[fixtureId]
          : {};
        nextFixtures[fixtureId] = {
          ...fixtureLayer,
          rgb: {
            r: clampNumber(Math.round(Number(groupPalette.rgb.r)), 0, 255, 0),
            g: clampNumber(Math.round(Number(groupPalette.rgb.g)), 0, 255, 0),
            b: clampNumber(Math.round(Number(groupPalette.rgb.b)), 0, 255, 0)
          },
          owner: `palette_sync_group:${group.id}:${group.sequenceMode}`
        };
        appliedFixtures += 1;
      }

      if (appliedFixtures <= 0) return { ...state };
      nextRouting.fixtures = nextFixtures;
      return {
        ...state,
        routing: nextRouting,
        syncGroups: {
          enabled: true,
          activeGroups: syncGroups.groups.length,
          appliedFixtures
        }
      };
    }
  });
  policyRegistry.registerPolicy({
    id: "live_runtime_scope_overrides",
    priority: 220,
    apply(state = {}, context = {}) {
      const routing = state.routing && typeof state.routing === "object" ? state.routing : {};
      const globalLayer = routing.global && typeof routing.global === "object" ? routing.global : null;
      if (!globalLayer?.rgb) return { ...state };
      const scopedRuntime = state.scopedRuntimeTuning && typeof state.scopedRuntimeTuning === "object"
        ? state.scopedRuntimeTuning
        : {};
      const brandOverrides = scopedRuntime.brands && typeof scopedRuntime.brands === "object"
        ? scopedRuntime.brands
        : {};
      const fixtureOverrides = scopedRuntime.fixtureOverrides && typeof scopedRuntime.fixtureOverrides === "object"
        ? scopedRuntime.fixtureOverrides
        : {};

      let anyApplied = false;
      const nextRouting = { ...routing };
      const nextBrands = { ...(routing.brands && typeof routing.brands === "object" ? routing.brands : {}) };
      for (const [rawBrand, row] of Object.entries(brandOverrides)) {
        const rowMap = row && typeof row === "object" ? row : {};
        const brand = normalizeScopedRuntimeBrandToken(rowMap.brand || rawBrand);
        if (!brand) continue;
        nextBrands[brand] = applyScopedRuntimeClampToLayer(
          { ...globalLayer, ...(nextBrands[brand] && typeof nextBrands[brand] === "object" ? nextBrands[brand] : {}) },
          rowMap.runtimeTuning,
          `brand:${brand}`
        );
        anyApplied = true;
      }
      if (anyApplied) {
        nextRouting.brands = nextBrands;
      }

      const nextFixtures = { ...(routing.fixtures && typeof routing.fixtures === "object" ? routing.fixtures : {}) };
      for (const [rawFixtureId, row] of Object.entries(fixtureOverrides)) {
        const rowMap = row && typeof row === "object" ? row : {};
        const fixtureId = normalizeScopedRuntimeFixtureId(rowMap.fixtureId || rawFixtureId);
        if (!fixtureId) continue;
        const brand = normalizeScopedRuntimeBrandToken(rowMap.brand);
        if (!brand) continue;
        const baseLayer = nextBrands[brand] && typeof nextBrands[brand] === "object"
          ? nextBrands[brand]
          : globalLayer;
        nextFixtures[fixtureId] = applyScopedRuntimeClampToLayer(
          { ...baseLayer, ...(nextFixtures[fixtureId] && typeof nextFixtures[fixtureId] === "object" ? nextFixtures[fixtureId] : {}) },
          rowMap.runtimeTuning,
          `fixture:${brand}:${fixtureId}`
        );
        anyApplied = true;
      }
      if (anyApplied) {
        nextRouting.fixtures = nextFixtures;
      }

      if (!anyApplied) return { ...state };
      return {
        ...state,
        routing: nextRouting
      };
    }
  });
  policyRegistry.registerPolicy({
    id: "midi_overrides",
    priority: 300,
    apply(state = {}) {
      return { ...state };
    }
  });
  policyRegistry.registerPolicy({
    id: "mods_overlays",
    priority: 400,
    apply(state = {}) {
      return { ...state };
    }
  });
  policyRegistry.registerPolicy({
    id: "safety_clamps",
    priority: 500,
    apply(state = {}) {
      const routing = state.routing && typeof state.routing === "object" ? state.routing : {};
      const global = routing.global && typeof routing.global === "object" ? routing.global : null;
      if (!global) return { ...state };
      return {
        ...state,
        routing: {
          ...routing,
          global: {
            ...global,
            brightness: clampNumber(global.brightness, 0, 1, 1),
            transitionMs: clampNumber(global.transitionMs, 0, 60000, tickMs)
          }
        }
      };
    }
  });
  policyRegistry.registerPolicy({
    id: "twitch_overlays",
    priority: 600,
    apply(state = {}, context = {}) {
      const events = Array.isArray(context?.input?.controlEvents) ? context.input.controlEvents : [];
      const twitchEvents = events.filter(event => String(event.owner || "").toLowerCase() === "twitch");
      if (!twitchEvents.length) return { ...state };
      const latest = twitchEvents[twitchEvents.length - 1];
      const override = normalizeTwitchOverrideColor(latest);
      if (!override) return { ...state };
      const routing = state.routing && typeof state.routing === "object" ? state.routing : {};
      return {
        ...state,
        routing: {
          ...routing,
          global: {
            rgb: override.rgb,
            brightness: override.brightness,
            transitionMs: override.transitionMs,
            owner: override.owner
          }
        },
        twitch: {
          overrideApplied: true,
          at: Number(latest.at || Date.now()),
          type: String(latest.type || "")
        }
      };
    }
  });

  const intentMapper = createEngineIntentMapper({
    defaultIntent: {
      rgb: { r: 0, g: 0, b: 0 },
      brightness: 0,
      transitionMs: 200,
      owner: "engine_v2_safe_idle"
    }
  });

  const scheduler = createEngineScheduler({
    now,
    computeSceneState: input => sceneStateModel.computeSceneState(input),
    applyPolicies: policyRegistry.applyPolicies,
    mapIntents: ({ fixtures = [], routing = {} }) => intentMapper.mapIntents({ fixtures, routing }),
    dispatchByBrand: (intents = [], context = {}) => {
      const sceneState = context?.sceneState && typeof context.sceneState === "object"
        ? context.sceneState
        : {};
      const grouped = {
        hue: [],
        wiz: []
      };
      for (const intent of intents) {
        if (!grouped[intent.brand]) continue;
        grouped[intent.brand].push(intent);
      }
      const hasHueTargets = grouped.hue.length > 0;
      const hasWizTargets = grouped.wiz.length > 0;
      const musicalProfile = String(sceneState?.musicalProfile || "groove").trim().toLowerCase() || "groove";
      const cadenceState = cadenceRuntime.computeCadenceState({
        overclock: context?.input?.profile?.payload?.overclock,
        sceneState,
        hasHueTargets,
        hasWizTargets
      });
      const easedIntentsByBrand = {
        hue: grouped.hue.map(intent => easeFixtureIntent(intent, sceneState, cadenceState)),
        wiz: grouped.wiz.map(intent => easeFixtureIntent(intent, sceneState, cadenceState))
      };

      const nowMs = Number(now() || Date.now());
      let sent = 0;
      let failed = 0;
      const skipped = { hue: 0, wiz: 0 };

      const canDispatchBrand = brand => {
        const elapsed = nowMs - Number(lastBrandDispatchAt[brand] || 0);
        const appliedHzForBrand = brand === "hue"
          ? cadenceState.appliedByBrand.hue
          : cadenceState.appliedByBrand.wiz;
        const minIntervalMs = Math.max(
          1,
          Math.round((1000 / Math.max(0.5, Number(appliedHzForBrand || 1))) * 0.9)
        );
        return elapsed >= minIntervalMs;
      };
      const markDispatched = brand => {
        lastBrandDispatchAt[brand] = nowMs;
      };

      if (easedIntentsByBrand.hue.length) {
        if (!canDispatchBrand("hue")) {
          skipped.hue += easedIntentsByBrand.hue.length;
        } else {
          const profileTransitionFloorMs = musicalProfile === "calm"
            ? 110
            : (musicalProfile === "aggressive" ? 68 : 86);
          const hueMinTransitionMs = Math.max(
            profileTransitionFloorMs,
            Math.round((1000 / Math.max(0.5, Number(cadenceState.appliedByBrand.hue || 1))) * 0.92)
          );
          const cadenceIntervalMs = Math.round(
            1000 / Math.max(0.5, Number(cadenceState.appliedByBrand.hue || 1))
          );
          const cadenceTransitionCeilMs = clampNumber(
            Math.round(
              cadenceIntervalMs * (
                musicalProfile === "calm"
                  ? 2.1
                  : (musicalProfile === "aggressive" ? 1.2 : 1.5)
              )
            ),
            hueMinTransitionMs + 20,
            340,
            180
          );
          const hueBatches = new Map();
          const dispatchFixtureById = fixtureCatalogRuntime.getDispatchFixtureById();
          for (const intent of easedIntentsByBrand.hue) {
            const fixture = dispatchFixtureById.get(intent.fixtureId);
            if (!fixture) continue;
            const intentTransitionMs = Math.round(clampNumber(intent.transitionMs, 0, 60000, 120));
            // [DEV] Respect scoped runtime transition ceilings; cadence floor can only
            // [DEV] nudge up within a bounded window to preserve user tuning intent.
            const transitionMs = clampNumber(
              Math.max(hueMinTransitionMs, Math.min(intentTransitionMs, cadenceTransitionCeilMs)),
              hueMinTransitionMs,
              cadenceTransitionCeilMs,
              intentTransitionMs
            );
            const state = createHueStateFromRgb(intent.rgb, {
              brightness: mapEngineBrightnessToHueBri(intent.brightness),
              transitiontime: Math.max(1, Math.round(transitionMs / 100))
            });
            // [DEV] Brightness is transport intensity only; palette RGB identity stays in intent.rgb.
            // [DEV] `state.__rgb` preserves unscaled color for Hue Entertainment chroma fidelity.
            // [DEV] Keep RGB alongside Hue XY payload so entertainment transport can use
            // [DEV] true RGB tuples without lossy reverse conversion from XY.
            state.__rgb = {
              r: clampNumber(Math.round(Number(intent?.rgb?.r)), 0, 255, 0),
              g: clampNumber(Math.round(Number(intent?.rgb?.g)), 0, 255, 0),
              b: clampNumber(Math.round(Number(intent?.rgb?.b)), 0, 255, 0)
            };
            fixtureExclusions.rememberFixtureEngineStateRuntime(String(fixture?.id || ""), "hue", state);
            const key = buildHueDispatchStateKey(state);
            if (!hueBatches.has(key)) {
              hueBatches.set(key, {
                fixtures: [],
                state
              });
            }
            hueBatches.get(key).fixtures.push(fixture);
          }
          const hueBatchRows = Array.from(hueBatches.values());
          if (hueBatchRows.length && hueBridge && typeof hueBridge.sendState === "function") {
            const dispatchMode = queueBrandDispatch(
              "hue",
              { batches: hueBatchRows },
              async queued => {
                const rows = Array.isArray(queued?.batches) ? queued.batches : [];
                for (const batch of rows) {
                  await Promise.resolve(hueBridge.sendState(batch.fixtures, batch.state));
                }
              }
            );
            if (dispatchMode === "queued") {
              skipped.hue += easedIntentsByBrand.hue.length;
            } else {
              sent += easedIntentsByBrand.hue.length;
            }
          }
          markDispatched("hue");
        }
      }

      if (easedIntentsByBrand.wiz.length) {
        if (!canDispatchBrand("wiz")) {
          skipped.wiz += easedIntentsByBrand.wiz.length;
        } else {
          const wizBatches = new Map();
          const dispatchFixtureById = fixtureCatalogRuntime.getDispatchFixtureById();
          for (const intent of easedIntentsByBrand.wiz) {
            const fixture = dispatchFixtureById.get(intent.fixtureId);
            if (!fixture) continue;
            const state = createWizStateFromRgb(intent.rgb, {
              dimming: mapEngineBrightnessToWizDimming(intent.brightness)
            });
            fixtureExclusions.rememberFixtureEngineStateRuntime(String(fixture?.id || ""), "wiz", state);
            const key = buildWizDispatchStateKey(state);
            if (!wizBatches.has(key)) {
              wizBatches.set(key, {
                fixtures: [],
                state
              });
            }
            wizBatches.get(key).fixtures.push(fixture);
          }
          if (wizBatches.size && wizBridge && typeof wizBridge.sendState === "function") {
            for (const batch of wizBatches.values()) {
              if (!batch.fixtures.length) continue;
              const result = wizBridge.sendState(batch.fixtures, batch.state);
              sent += Number(result?.sent || 0);
              failed += Number(result?.failed || 0);
            }
          }
          markDispatched("wiz");
        }
      }

      return {
        sent,
        failed,
        skipped,
        dryRun: context?.input?.transportDryRun !== false,
        cadence: cadenceState
      };
    }
  });

  let running = false;
  let startedAt = 0;
  let stoppedAt = 0;
  let lastTickAt = 0;
  let loopDurationMs = 0;
  let tickCount = 0;
  let timer = null;
  let lastProjection = buildEngineTelemetryProjection({});
  let lastDispatch = {
    sent: 0,
    failed: 0,
    skipped: { hue: 0, wiz: 0 },
    dryRun: true,
    cadence: {
      autoEnabled: false,
      source: "manual",
      requestedHz: 6,
      appliedHz: 6,
      appliedByBrand: { hue: 6, wiz: 6 },
      guardReason: "none",
      guarded: false,
      overclockLevel: 2
    }
  };
  const controlEventQueue = [];

  function drainControlEvents(limit = 64) {
    const max = clampNumber(Math.round(Number(limit || 64)), 1, 512, 64);
    const out = [];
    while (controlEventQueue.length && out.length < max) {
      out.push(controlEventQueue.shift());
    }
    return out;
  }

  function queueControlEvent(event = {}) {
    if (!event || typeof event !== "object") return false;
    controlEventQueue.push({ ...event });
    if (controlEventQueue.length > 512) {
      controlEventQueue.splice(0, controlEventQueue.length - 512);
    }
    return true;
  }

  function runSingleTick(reason = "manual_tick") {
    const tickAt = Number(now() || Date.now());
    const audioTelemetry = audioEngine.getTelemetry();
    const rms = clampNumber(Number(audioTelemetry?.rms), 0, 1, 0);
    const energy = clampNumber(Number(audioTelemetry?.energy), 0, 1, 0);
    const transient = clampNumber(Number(audioTelemetry?.transient), 0, 1, 0);
    const flux = clampNumber(Number(audioTelemetry?.flux), 0, 1, 0);
    const beatConfidence = clampNumber(Number(audioTelemetry?.beatConfidence), 0, 1, 0);
    const pulseHint = (
      (transient >= 0.48 && flux >= 0.3 && beatConfidence >= 0.2) ||
      (transient >= 0.62 && beatConfidence >= 0.18)
    );
    const beatPulse = audioTelemetry?.beatPulse === true
      || (audioTelemetry?.beat === true && beatConfidence >= 0.42)
      || pulseHint;
    const sectionBandHint = String(lastProjection?.scene?.loudnessSectionBand || "normal").trim().toLowerCase() || "normal";
    const profileHint = String(lastProjection?.scene?.musicalProfile || "groove").trim().toLowerCase() || "groove";
    const profileDriveHint = clampNumber(
      Number(lastProjection?.scene?.musicalDriveNorm),
      0,
      1,
      clampNumber(
        (transient * 0.38) +
        (flux * 0.32) +
        (rms * 0.2) +
        (energy * 0.1),
        0,
        1,
        0.42
      )
    );
    const tempoHint = clampNumber(
      Number(audioTelemetry?.bpm || lastProjection?.scene?.bpm),
      0,
      220,
      120
    );
    const transportClock = paletteMapper.updateMusicalTransportClock({
      tickAt,
      beatPulse,
      bpm: tempoHint > 0 ? tempoHint : 120,
      profileHint,
      driveNorm: profileDriveHint
    });
    const cadenceHz = clampNumber(
      Number(lastDispatch?.cadence?.appliedHz || 0),
      0.5,
      60,
      6
    );
    const paletteAdvance = paletteAdvanceRuntime.computePaletteAdvance({
      tickAt,
      transportClock,
      audioTelemetry,
      beatPulse,
      cadenceHz,
      profileHint,
      sectionBandHint,
      profileDriveHint
    });

    const basePaletteFrame = paletteService.consumeTickFrame({
      advance: paletteAdvance.advance,
      advanceWeight: paletteAdvance.advanceWeight
    });
    const paletteFrame = paletteMapper.resolvePaletteFrameForTick(
      basePaletteFrame,
      audioTelemetry,
      tickAt,
      {
        sceneHint: String(lastProjection?.scene?.sceneIntent || "steady").trim().toLowerCase() || "steady",
        profileHint,
        driveNorm: profileDriveHint,
        transportClock,
        beatPulse
      }
    );

    const tickMeta = {
      tickMs,
      tickCount: tickCount + 1,
      reason: String(reason || "manual_tick")
    };
    const profileSnapshot = buildEngineRuntimeProfileSnapshot({
      liveProfileService,
      liveCompatService
    });
    const fixtureCatalogSnapshot = fixtureCatalogRuntime.getFixtureCatalogSnapshot(profileSnapshot);
    fixtureExclusions.reconcileExcludedFixtureControlsRuntime(fixtureCatalogSnapshot.excludedControlsById);
    const tick = scheduler.runTick({
      at: tickAt,
      telemetry: audioTelemetry,
      profile: profileSnapshot,
      fixtures: fixtureCatalogSnapshot.catalog,
      controlEvents: drainControlEvents(),
      paletteFrame,
      transportDryRun: dryRunTransport
    }, tickMeta);
    tickCount += 1;
    lastTickAt = Number(tick.timing?.endedAt || now() || Date.now());
    loopDurationMs = Number(tick.timing?.loopDurationMs || 0);
    lastDispatch = tick.dispatch && typeof tick.dispatch === "object"
      ? tick.dispatch
      : {
        sent: 0,
        failed: 0,
        skipped: { hue: 0, wiz: 0 },
        dryRun: true,
        cadence: {
          autoEnabled: false,
          source: "manual",
          requestedHz: 6,
          appliedHz: 6,
          appliedByBrand: { hue: 6, wiz: 6 },
          guardReason: "none",
          guarded: false,
          overclockLevel: 2
        }
      };
    const sceneState = tick.sceneState && typeof tick.sceneState === "object"
      ? tick.sceneState
      : {};
    const cadenceState = lastDispatch?.cadence && typeof lastDispatch.cadence === "object"
      ? lastDispatch.cadence
      : {};
    const sceneStateWithCadence = {
      ...sceneState,
      cadenceState: {
        ...(sceneState.cadenceState && typeof sceneState.cadenceState === "object" ? sceneState.cadenceState : {}),
        autoEnabled: cadenceState.autoEnabled === true,
        source: String(cadenceState.source || "manual"),
        requestedHz: Number(cadenceState.requestedHz || 0),
        appliedHz: Number(cadenceState.appliedHz || 0),
        appliedByBrand: {
          hue: Number(cadenceState?.appliedByBrand?.hue || 0),
          wiz: Number(cadenceState?.appliedByBrand?.wiz || 0)
        },
        guardReason: String(cadenceState.guardReason || "none"),
        guarded: cadenceState.guarded === true,
        overclockLevel: Number(cadenceState.overclockLevel || 0),
        paceConfidence: Number(cadenceState.paceConfidence || sceneState?.cadenceState?.paceConfidence || 0),
        targetBrands: {
          hue: cadenceState?.targetBrands?.hue === true,
          wiz: cadenceState?.targetBrands?.wiz === true
        },
        autoDebug: cadenceState?.autoDebug && typeof cadenceState.autoDebug === "object"
          ? {
            movementNorm: Number(cadenceState.autoDebug.movementNorm || 0),
            impactNorm: Number(cadenceState.autoDebug.impactNorm || 0),
            loudnessNorm: Number(cadenceState.autoDebug.loudnessNorm || 0),
            tempoNorm: Number(cadenceState.autoDebug.tempoNorm || 0),
            capacityNorm: Number(cadenceState.autoDebug.capacityNorm || 0),
            highEnergyNorm: Number(cadenceState.autoDebug.highEnergyNorm || 0),
            highEnergyTicks: Number(cadenceState.autoDebug.highEnergyTicks || 0),
            mode: String(cadenceState.autoDebug.mode || ""),
            quietTicks: Number(cadenceState.autoDebug.quietTicks || 0),
            profile: String(cadenceState.autoDebug.profile || ""),
            targetHz: Number(cadenceState.autoDebug.targetHz || 0),
            envelopeHz: Number(cadenceState.autoDebug.envelopeHz || 0)
          }
          : undefined
      }
    };
    lastProjection = buildEngineTelemetryProjection({
      status: {
        running,
        startedAt,
        stoppedAt,
        tickMs,
        tickCount,
        tickHz: tickMs > 0 ? Math.round((1000 / tickMs) * 100) / 100 : 0,
        lastTickAt,
        loopDurationMs,
        intentsCount: Array.isArray(tick.intents) ? tick.intents.length : 0
      },
      sceneState: sceneStateWithCadence,
      dispatch: lastDispatch
    });
    return {
      ok: tick.ok !== false,
      reason: tickMeta.reason,
      tickCount,
      lastTickAt,
      projection: lastProjection
    };
  }

  function start(meta = {}) {
    if (running) {
      return {
        ok: true,
        alreadyRunning: true,
        ...getStatus()
      };
    }
    running = true;
    startedAt = Number(now() || Date.now());
    stoppedAt = 0;
    timer = setIntervalFn(() => {
      try {
        runSingleTick("interval");
      } catch (error) {
        console.warn("[ENGINE_V2] tick error:", error?.message || error);
      }
    }, tickMs);
    return {
      ok: true,
      alreadyRunning: false,
      requestedBy: String(meta.requestedBy || "").trim(),
      ...getStatus()
    };
  }

  function stop(meta = {}) {
    const wasRunning = running;
    running = false;
    if (timer) {
      clearIntervalFn(timer);
      timer = null;
    }
    stoppedAt = Number(now() || Date.now());
    return {
      ok: true,
      wasRunning,
      requestedBy: String(meta.requestedBy || "").trim(),
      ...getStatus()
    };
  }

  function getStatus() {
    return {
      running,
      startedAt,
      stoppedAt,
      tickMs,
      tickHz: tickMs > 0 ? Math.round((1000 / tickMs) * 100) / 100 : 0,
      tickCount,
      lastTickAt,
      loopDurationMs,
      hardwareLimits: { ...hardwareLimits },
      paletteMapperMode,
      dispatch: cloneDispatch(lastDispatch),
      policyOrder: policyRegistry.listPolicies(),
      queueDepth: controlEventQueue.length
    };
  }

  function cloneDispatch(dispatch = {}) {
    return {
      sent: Number(dispatch.sent || 0),
      failed: Number(dispatch.failed || 0),
      skipped: {
        hue: Number(dispatch?.skipped?.hue || 0),
        wiz: Number(dispatch?.skipped?.wiz || 0)
      },
      dryRun: dispatch.dryRun !== false
    };
  }

  function getTelemetryProjection() {
    return { ...lastProjection };
  }

  function getPaletteSnapshot() {
    return paletteService.getSnapshot();
  }

  function tick(options = {}) {
    const opts = options && typeof options === "object" ? options : {};
    return runSingleTick(String(opts.reason || "manual_tick"));
  }

  return {
    start,
    stop,
    tick,
    getStatus,
    getTelemetryProjection,
    getPaletteSnapshot,
    queueControlEvent,
    listPolicies: policyRegistry.listPolicies,
    registerPolicy: policyRegistry.registerPolicy,
    unregisterPolicy: policyRegistry.unregisterPolicy
  };
};
