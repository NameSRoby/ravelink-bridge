// [TITLE] Module: domains/engine-v2/engine.runtime.fixture-exclusions.js
// [TITLE] Purpose: fixture engine-state snapshots and exclusion/remove-action support for engine runtime
// [TITLE] Functionality Index:
// [TITLE] - remember last/baseline engine states per fixture
// [TITLE] - resolve exclusion remove-action payloads for Hue and WiZ
// [TITLE] - reconcile excluded fixture controls and dispatch one-shot removal effects

module.exports = function createEngineRuntimeFixtureExclusions(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const clampNumber = typeof options.clampNumber === "function"
    ? options.clampNumber
    : (value => Number(value) || 0);
  const WIZ_DIMMING_MIN = Number(options.WIZ_DIMMING_MIN || 10);
  const WIZ_DIMMING_MAX = Number(options.WIZ_DIMMING_MAX || 100);
  const SYNC_GROUP_DEFAULT_REMOVE_BEHAVIOR = String(options.SYNC_GROUP_DEFAULT_REMOVE_BEHAVIOR || "keep_current");
  const SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT = options.SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT || {
    mode: "hex",
    hex: "#ffffff",
    cct: 4000,
    brightness: 100
  };
  const normalizeSyncGroupRemoveBehaviorRuntime = typeof options.normalizeSyncGroupRemoveBehaviorRuntime === "function"
    ? options.normalizeSyncGroupRemoveBehaviorRuntime
    : (value => String(value || SYNC_GROUP_DEFAULT_REMOVE_BEHAVIOR));
  const normalizeSyncGroupCustomFallbackRuntime = typeof options.normalizeSyncGroupCustomFallbackRuntime === "function"
    ? options.normalizeSyncGroupCustomFallbackRuntime
    : (value => value || SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT);
  const mapEngineBrightnessToHueBri = typeof options.mapEngineBrightnessToHueBri === "function"
    ? options.mapEngineBrightnessToHueBri
    : (value => Math.round(Number(value) || 254));
  const createHueStateFromRgb = typeof options.createHueStateFromRgb === "function"
    ? options.createHueStateFromRgb
    : (() => null);
  const createWizStateFromRgb = typeof options.createWizStateFromRgb === "function"
    ? options.createWizStateFromRgb
    : (() => null);
  const hexToRgb = typeof options.hexToRgb === "function"
    ? options.hexToRgb
    : (() => null);
  const buildHueDispatchStateKey = typeof options.buildHueDispatchStateKey === "function"
    ? options.buildHueDispatchStateKey
    : (state => JSON.stringify(state || {}));
  const buildWizDispatchStateKey = typeof options.buildWizDispatchStateKey === "function"
    ? options.buildWizDispatchStateKey
    : (state => JSON.stringify(state || {}));
  const hueBridge = options.hueBridge;
  const wizBridge = options.wizBridge;
  const fixtureIntentSmoothingState = options.fixtureIntentSmoothingState instanceof Map
    ? options.fixtureIntentSmoothingState
    : new Map();
  const fixtureLastEngineStateById = options.fixtureLastEngineStateById instanceof Map
    ? options.fixtureLastEngineStateById
    : new Map();
  const fixtureBaselineStateById = options.fixtureBaselineStateById instanceof Map
    ? options.fixtureBaselineStateById
    : new Map();
  const consoleRef = options.consoleRef || console;

  let excludedFixtureControlsById = options.excludedFixtureControlsById instanceof Map
    ? options.excludedFixtureControlsById
    : new Map();

  function cloneFixtureEngineStateSnapshotRuntime(value = {}) {
    const source = value && typeof value === "object" ? value : {};
    const state = source.state && typeof source.state === "object" ? source.state : {};
    return {
      brand: String(source.brand || "").trim().toLowerCase(),
      state: {
        ...state,
        xy: Array.isArray(state.xy) ? [...state.xy] : undefined,
        __rgb: state.__rgb && typeof state.__rgb === "object" ? { ...state.__rgb } : undefined
      },
      capturedAt: Number(source.capturedAt || 0)
    };
  }

  function createFixtureEngineStateSnapshotRuntime(fixtureIdRaw = "", brandRaw = "", rawState = {}) {
    const fixtureId = String(fixtureIdRaw || "").trim();
    const brand = String(brandRaw || "").trim().toLowerCase();
    const state = rawState && typeof rawState === "object" ? rawState : {};
    if (!fixtureId || !brand) return null;
    if (brand === "hue") {
      const xySource = Array.isArray(state.xy) ? state.xy : [];
      const snapshot = {
        on: state.on !== false,
        bri: clampNumber(Math.round(Number(state.bri)), 1, 254, 254),
        transitiontime: clampNumber(Math.round(Number(state.transitiontime)), 0, 30, 1),
        xy: [
          clampNumber(Number(xySource[0]), 0, 1, 0),
          clampNumber(Number(xySource[1]), 0, 1, 0)
        ],
        __rgb: state.__rgb && typeof state.__rgb === "object"
          ? {
            r: clampNumber(Math.round(Number(state.__rgb.r)), 0, 255, 0),
            g: clampNumber(Math.round(Number(state.__rgb.g)), 0, 255, 0),
            b: clampNumber(Math.round(Number(state.__rgb.b)), 0, 255, 0)
          }
          : undefined
      };
      return {
        fixtureId,
        brand,
        state: snapshot,
        capturedAt: Number(now() || Date.now())
      };
    }
    if (brand === "wiz") {
      return {
        fixtureId,
        brand,
        state: {
          on: state.on !== false,
          dimming: clampNumber(Math.round(Number(state.dimming)), WIZ_DIMMING_MIN, WIZ_DIMMING_MAX, WIZ_DIMMING_MAX),
          r: clampNumber(Math.round(Number(state.r)), 0, 255, 0),
          g: clampNumber(Math.round(Number(state.g)), 0, 255, 0),
          b: clampNumber(Math.round(Number(state.b)), 0, 255, 0),
          temp: Number.isFinite(Number(state.temp))
            ? clampNumber(Math.round(Number(state.temp)), 2200, 6500, 3500)
            : undefined,
          speed: Number.isFinite(Number(state.speed))
            ? clampNumber(Math.round(Number(state.speed)), 20, 200, 80)
            : undefined
        },
        capturedAt: Number(now() || Date.now())
      };
    }
    return null;
  }

  function rememberFixtureEngineStateRuntime(fixtureId = "", brand = "", state = {}) {
    const snapshot = createFixtureEngineStateSnapshotRuntime(fixtureId, brand, state);
    if (!snapshot) return;
    fixtureLastEngineStateById.set(snapshot.fixtureId, cloneFixtureEngineStateSnapshotRuntime(snapshot));
    if (!fixtureBaselineStateById.has(snapshot.fixtureId)) {
      fixtureBaselineStateById.set(snapshot.fixtureId, cloneFixtureEngineStateSnapshotRuntime(snapshot));
    }
  }

  function convertKelvinToHueCtRuntime(kelvinRaw = 4000) {
    const kelvin = clampNumber(Math.round(Number(kelvinRaw)), 2000, 6500, 4000);
    const ct = Math.round(1000000 / Math.max(1, kelvin));
    return clampNumber(ct, 153, 500, 250);
  }

  function resolveFixtureRemovalStateRuntime(
    fixtureIdRaw = "",
    fixture = {},
    behaviorRaw = SYNC_GROUP_DEFAULT_REMOVE_BEHAVIOR,
    customFallbackRaw = SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT
  ) {
    const fixtureId = String(fixtureIdRaw || "").trim();
    const brand = String(fixture?.brand || "").trim().toLowerCase();
    if (!fixtureId || !brand) return null;
    const behavior = normalizeSyncGroupRemoveBehaviorRuntime(behaviorRaw, SYNC_GROUP_DEFAULT_REMOVE_BEHAVIOR);
    if (behavior === "keep_current") return null;
    if (behavior === "blackout") {
      if (brand === "hue") {
        return { on: false, bri: 1, transitiontime: 1 };
      }
      if (brand === "wiz") {
        return { on: false, dimming: WIZ_DIMMING_MIN };
      }
      return null;
    }
    if (behavior !== "custom_state") return null;
    const customFallback = normalizeSyncGroupCustomFallbackRuntime(
      customFallbackRaw,
      SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT
    );
    const brightnessNorm = clampNumber(Number(customFallback.brightness) / 100, 0, 1, 1);
    if (brand === "hue") {
      const bri = mapEngineBrightnessToHueBri(brightnessNorm);
      if (customFallback.mode === "cct") {
        return {
          on: true,
          ct: convertKelvinToHueCtRuntime(customFallback.cct),
          bri,
          transitiontime: 1
        };
      }
      const rgb = hexToRgb(customFallback.hex) || { r: 255, g: 255, b: 255 };
      const state = createHueStateFromRgb(rgb, {
        brightness: bri,
        transitiontime: 1
      });
      state.__rgb = { ...rgb };
      return state;
    }
    if (brand === "wiz") {
      const dimming = clampNumber(
        Math.round(Number(customFallback.brightness)),
        WIZ_DIMMING_MIN,
        WIZ_DIMMING_MAX,
        WIZ_DIMMING_MAX
      );
      if (customFallback.mode === "cct") {
        return {
          on: true,
          temp: clampNumber(Math.round(Number(customFallback.cct)), 2200, 6500, 4000),
          dimming
        };
      }
      const rgb = hexToRgb(customFallback.hex) || { r: 255, g: 255, b: 255 };
      return createWizStateFromRgb(rgb, { dimming });
    }
    return null;
  }

  function applyFixtureExclusionEffectsRuntime(newlyExcluded = []) {
    const rows = Array.isArray(newlyExcluded) ? newlyExcluded : [];
    if (!rows.length) return;
    const hueBatches = new Map();
    const wizBatches = new Map();
    for (const row of rows) {
      const fixture = row?.fixture && typeof row.fixture === "object" ? row.fixture : null;
      const fixtureId = String(fixture?.id || "").trim();
      const brand = String(fixture?.brand || "").trim().toLowerCase();
      if (!fixture || !fixtureId || !brand) continue;
      const removeState = resolveFixtureRemovalStateRuntime(
        fixtureId,
        fixture,
        row?.removeBehavior || SYNC_GROUP_DEFAULT_REMOVE_BEHAVIOR,
        row?.customFallback || SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT
      );
      if (!removeState || typeof removeState !== "object") continue;
      if (brand === "hue") {
        const key = buildHueDispatchStateKey(removeState);
        if (!hueBatches.has(key)) {
          hueBatches.set(key, { fixtures: [], state: removeState });
        }
        hueBatches.get(key).fixtures.push(fixture);
      } else if (brand === "wiz") {
        const key = buildWizDispatchStateKey(removeState);
        if (!wizBatches.has(key)) {
          wizBatches.set(key, { fixtures: [], state: removeState });
        }
        wizBatches.get(key).fixtures.push(fixture);
      }
    }
    if (hueBatches.size > 0 && hueBridge && typeof hueBridge.sendState === "function") {
      for (const batch of hueBatches.values()) {
        if (!batch.fixtures.length) continue;
        Promise.resolve(hueBridge.sendState(batch.fixtures, batch.state)).catch(error => {
          consoleRef.warn("[ENGINE_V2] fixture exclusion hue remove-action failed:", error?.message || error || "dispatch_failed");
        });
      }
    }
    if (wizBatches.size > 0 && wizBridge && typeof wizBridge.sendState === "function") {
      for (const batch of wizBatches.values()) {
        if (!batch.fixtures.length) continue;
        try {
          wizBridge.sendState(batch.fixtures, batch.state);
        } catch (error) {
          consoleRef.warn("[ENGINE_V2] fixture exclusion wiz remove-action failed:", error?.message || error || "dispatch_failed");
        }
      }
    }
  }

  function reconcileExcludedFixtureControlsRuntime(nextControlsById = new Map()) {
    const next = nextControlsById instanceof Map ? nextControlsById : new Map();
    const newlyExcluded = [];
    for (const [fixtureId, row] of next.entries()) {
      if (excludedFixtureControlsById.has(fixtureId)) continue;
      newlyExcluded.push({
        fixtureId,
        fixture: row?.fixture && typeof row.fixture === "object" ? row.fixture : null,
        removeBehavior: row?.removeBehavior || SYNC_GROUP_DEFAULT_REMOVE_BEHAVIOR,
        customFallback: row?.customFallback || SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT
      });
    }
    excludedFixtureControlsById = next;
    for (const fixtureId of fixtureIntentSmoothingState.keys()) {
      if (next.has(fixtureId)) {
        fixtureIntentSmoothingState.delete(fixtureId);
      }
    }
    if (newlyExcluded.length > 0) {
      applyFixtureExclusionEffectsRuntime(newlyExcluded);
    }
  }

  return {
    rememberFixtureEngineStateRuntime,
    reconcileExcludedFixtureControlsRuntime,
    resolveFixtureRemovalStateRuntime,
    convertKelvinToHueCtRuntime,
    cloneFixtureEngineStateSnapshotRuntime,
    createFixtureEngineStateSnapshotRuntime
  };
};
