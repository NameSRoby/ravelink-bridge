// [TITLE] Module: domains/live/live-compat.service.js
// [TITLE] Purpose: compatibility state service for LIVE/rave control contracts
// [TITLE] Functionality Index:
// [TITLE] - persist live compatibility + trigger-matrix snapshots
// [TITLE] - persist rave palette + fixture-metric compatibility snapshots
// [TITLE] - own deterministic overclock compatibility state for UI routes
// [DEV] Complex Flow:
// [DEV] This service intentionally stores compatibility projection state only.
// [DEV] It does not execute effect logic; it keeps contracts stable while engine v2
// [DEV] feature parity is rebuilt behind clean domain boundaries.

const fs = require("node:fs");
const {
  readJsonFile,
  writeJsonFile,
  cloneJsonSafe
} = require("../../shared/fs/json-file-store");
const createLiveSyncGroupNormalization = require("./live-sync-groups.normalization");
const { normalizePaletteScopeConfig } = require("../palette/palette-sequence-resolver");

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number(fallback);
  return Math.min(Number(max), Math.max(Number(min), parsed));
}

function normalizeBooleanToken(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  const token = String(value || "").trim().toLowerCase();
  if (!token) return fallback === true;
  if (token === "true" || token === "on" || token === "yes") return true;
  if (token === "false" || token === "off" || token === "no") return false;
  return fallback === true;
}

function normalizeSceneLock(value, fallback = "auto") {
  const token = String(value || "").trim().toLowerCase();
  if (!token) return fallback;
  if (token === "calm" || token === "steady" || token === "scene_idle") return "steady";
  if (token === "groove" || token === "motion" || token === "scene_flow") return "motion";
  if (token === "impact" || token === "scene_pulse") return "impact";
  if (token === "auto" || token === "meta_auto" || token === "scene_auto") return "auto";
  return fallback;
}

function normalizeSceneFilterAggressiveness(value = {}, fallback = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const fb = fallback && typeof fallback === "object" && !Array.isArray(fallback) ? fallback : {};
  return {
    calm: clampNumber(source.calm, 0.45, 2.1, clampNumber(fb.calm, 0.45, 2.1, 1)),
    groove: clampNumber(source.groove, 0.45, 2.1, clampNumber(fb.groove, 0.45, 2.1, 1)),
    impact: clampNumber(source.impact, 0.45, 2.1, clampNumber(fb.impact, 0.45, 2.1, 1))
  };
}

const LIVE_RUNTIME_TUNING_DEFAULT = Object.freeze({
  bpmSourceMode: "hybrid",
  sceneSwitchCooldownMs: 260,
  impactHoldMs: 140,
  brightnessFloor: 0.02,
  brightnessCeil: 1,
  transitionFloorMs: 32,
  transitionCeilMs: 190,
  telemetryBeatConfidenceMin: 0.34,
  derivedBeatMinIntervalMs: 120,
  derivedBeatMaxIntervalMs: 1600
});

const LIVE_SYNC_GROUPS_DEFAULT = Object.freeze({
  enabled: false,
  groups: Object.freeze([]),
  fixtureEngine: Object.freeze({}),
  updatedAt: 0
});
const LIVE_SYNC_GROUP_MAX_GROUPS = 24;
const LIVE_SYNC_GROUP_MAX_FIXTURES = 4096;
const LIVE_SYNC_GROUP_MAX_ENGINE_FIXTURES = 4096;
const LIVE_SYNC_GROUP_MAX_NAME_LENGTH = 48;
const LIVE_SYNC_GROUP_MAX_OFFSET = 64;
const {
  SYNC_GROUP_DEFAULT_REMOVE_BEHAVIOR: LIVE_SYNC_GROUP_DEFAULT_REMOVE_BEHAVIOR,
  SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT: LIVE_SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT,
  normalizeSyncGroupSequenceMode,
  normalizeSyncGroupFixtureIds: normalizeSharedSyncGroupFixtureIds,
  normalizeSyncGroupRemoveBehavior,
  normalizeSyncGroupCustomFallback
} = createLiveSyncGroupNormalization({ clampNumber });

function normalizeSyncGroupId(value, fallback = "") {
  const token = String(value || "").trim().toLowerCase();
  const safe = token.replace(/[^a-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  if (safe) return safe;
  const fallbackToken = String(fallback || "").trim().toLowerCase();
  const fallbackSafe = fallbackToken.replace(/[^a-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return fallbackSafe;
}

function normalizeSyncGroupName(value, fallback = "GROUP") {
  const raw = String(value || "").replace(/\s+/g, " ").trim();
  if (!raw) return String(fallback || "GROUP").trim().slice(0, LIVE_SYNC_GROUP_MAX_NAME_LENGTH) || "GROUP";
  return raw.slice(0, LIVE_SYNC_GROUP_MAX_NAME_LENGTH);
}

function normalizeSyncGroupFixtureIds(value = [], fallback = []) {
  const source = Array.isArray(value) ? value : (Array.isArray(fallback) ? fallback : []);
  return normalizeSharedSyncGroupFixtureIds(source, {
    limit: LIVE_SYNC_GROUP_MAX_FIXTURES
  });
}

function normalizeSyncGroupFixtureEngineMap(value = {}, fallback = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const fb = fallback && typeof fallback === "object" && !Array.isArray(fallback) ? fallback : {};
  const out = {};
  const rows = Object.entries(source)
    .map(([rawFixtureId, row]) => {
      const sourceRow = row && typeof row === "object" && !Array.isArray(row) ? row : {};
      const fallbackRow = fb?.[rawFixtureId] && typeof fb[rawFixtureId] === "object" && !Array.isArray(fb[rawFixtureId])
        ? fb[rawFixtureId]
        : {};
      const fixtureId = normalizeFixtureId(sourceRow.fixtureId || sourceRow.id || rawFixtureId);
      if (!fixtureId) return null;
      return {
        fixtureId,
        excluded: normalizeBooleanToken(
          sourceRow.excluded ?? sourceRow.removed ?? sourceRow.disabled,
          normalizeBooleanToken(
            fallbackRow.excluded ?? fallbackRow.removed ?? fallbackRow.disabled,
            false
          )
        ),
        removeBehavior: normalizeSyncGroupRemoveBehavior(
          sourceRow.removeBehavior ?? sourceRow.onRemove ?? sourceRow.behavior,
          normalizeSyncGroupRemoveBehavior(
            fallbackRow.removeBehavior ?? fallbackRow.onRemove ?? fallbackRow.behavior,
            LIVE_SYNC_GROUP_DEFAULT_REMOVE_BEHAVIOR
          )
        ),
        customFallback: normalizeSyncGroupCustomFallback(
          sourceRow.customFallback ?? sourceRow.customState ?? sourceRow.fallback,
          normalizeSyncGroupCustomFallback(
            fallbackRow.customFallback ?? fallbackRow.customState ?? fallbackRow.fallback,
            LIVE_SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT
          )
        ),
        updatedAt: Number(sourceRow.updatedAt || 0)
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.fixtureId).localeCompare(String(b.fixtureId)))
    .slice(0, LIVE_SYNC_GROUP_MAX_ENGINE_FIXTURES);
  for (const row of rows) {
    out[row.fixtureId] = {
      excluded: row.excluded === true,
      removeBehavior: row.removeBehavior,
      customFallback: normalizeSyncGroupCustomFallback(
        row.customFallback,
        LIVE_SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT
      ),
      updatedAt: row.updatedAt
    };
  }
  return out;
}

function normalizeSyncGroupEntry(value = {}, fallback = {}, index = 0) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const fb = fallback && typeof fallback === "object" && !Array.isArray(fallback) ? fallback : {};
  const idBase = normalizeSyncGroupId(
    source.id,
    normalizeSyncGroupId(fb.id, `group-${index + 1}`)
  ) || `group-${index + 1}`;
  const phaseOffset = clampNumber(
    Math.round(Number(source.phaseOffset)),
    -LIVE_SYNC_GROUP_MAX_OFFSET,
    LIVE_SYNC_GROUP_MAX_OFFSET,
    clampNumber(Math.round(Number(fb.phaseOffset)), -LIVE_SYNC_GROUP_MAX_OFFSET, LIVE_SYNC_GROUP_MAX_OFFSET, 0)
  );
  return {
    id: idBase,
    name: normalizeSyncGroupName(source.name, normalizeSyncGroupName(fb.name, `GROUP ${index + 1}`)),
    sequenceMode: normalizeSyncGroupSequenceMode(source.sequenceMode, normalizeSyncGroupSequenceMode(fb.sequenceMode, "sync")),
    phaseOffset,
    fixtureIds: normalizeSyncGroupFixtureIds(source.fixtureIds, fb.fixtureIds),
    updatedAt: Number(source.updatedAt || 0)
  };
}

function normalizeSyncGroups(value = {}, fallback = LIVE_SYNC_GROUPS_DEFAULT) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const fb = fallback && typeof fallback === "object" && !Array.isArray(fallback) ? fallback : LIVE_SYNC_GROUPS_DEFAULT;
  const sourceGroups = Array.isArray(source.groups)
    ? source.groups
    : (Array.isArray(fb.groups) ? fb.groups : []);
  const out = [];
  const seenGroupIds = new Set();
  const seenFixtureIds = new Set();
  for (let i = 0; i < sourceGroups.length && out.length < LIVE_SYNC_GROUP_MAX_GROUPS; i += 1) {
    const normalized = normalizeSyncGroupEntry(sourceGroups[i], fb.groups?.[i], out.length);
    if (!normalized.id) continue;
    let id = normalized.id;
    if (seenGroupIds.has(id)) {
      let suffix = 2;
      while (seenGroupIds.has(`${id}-${suffix}`)) {
        suffix += 1;
      }
      id = `${id}-${suffix}`;
    }
    seenGroupIds.add(id);
    const fixtureIds = [];
    for (const fixtureId of normalized.fixtureIds) {
      if (seenFixtureIds.has(fixtureId)) continue;
      seenFixtureIds.add(fixtureId);
      fixtureIds.push(fixtureId);
    }
    out.push({
      ...normalized,
      id,
      fixtureIds
    });
  }
  return {
    enabled: normalizeBooleanToken(source.enabled, normalizeBooleanToken(fb.enabled, false)),
    groups: out,
    fixtureEngine: normalizeSyncGroupFixtureEngineMap(
      Object.prototype.hasOwnProperty.call(source, "fixtureEngine")
        ? source.fixtureEngine
        : fb.fixtureEngine,
      fb.fixtureEngine
    ),
    updatedAt: Number(source.updatedAt || fb.updatedAt || 0)
  };
}

function normalizeBpmSourceMode(value, fallback = LIVE_RUNTIME_TUNING_DEFAULT.bpmSourceMode) {
  const token = String(value || "").trim().toLowerCase();
  if (token === "telemetry" || token === "derived" || token === "hybrid") return token;
  return String(fallback || LIVE_RUNTIME_TUNING_DEFAULT.bpmSourceMode).trim().toLowerCase() || "hybrid";
}

function normalizeRuntimeTuning(value = {}, fallback = LIVE_RUNTIME_TUNING_DEFAULT) {
  const sourceRaw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const hasLegacyRuntimeBaseline = (
    Number(sourceRaw.sceneSwitchCooldownMs) === 650 &&
    Number(sourceRaw.impactHoldMs) === 220 &&
    Number(sourceRaw.brightnessFloor) === 0.03 &&
    Number(sourceRaw.brightnessCeil) === 1 &&
    Number(sourceRaw.transitionFloorMs) === 70 &&
    Number(sourceRaw.transitionCeilMs) === 280 &&
    Number(sourceRaw.telemetryBeatConfidenceMin) === 0.45
  );
  const hasObsoleteTransitionPair = (
    (
      Number(sourceRaw.transitionFloorMs) === 70 &&
      Number(sourceRaw.transitionCeilMs) === 280
    ) ||
    Number(sourceRaw.transitionFloorMs) === 45 &&
    Number(sourceRaw.transitionCeilMs) === 240
  );
  const source = hasLegacyRuntimeBaseline
    ? {
      ...sourceRaw,
      sceneSwitchCooldownMs: LIVE_RUNTIME_TUNING_DEFAULT.sceneSwitchCooldownMs,
      impactHoldMs: LIVE_RUNTIME_TUNING_DEFAULT.impactHoldMs,
      brightnessFloor: LIVE_RUNTIME_TUNING_DEFAULT.brightnessFloor,
      brightnessCeil: LIVE_RUNTIME_TUNING_DEFAULT.brightnessCeil,
      transitionFloorMs: LIVE_RUNTIME_TUNING_DEFAULT.transitionFloorMs,
      transitionCeilMs: LIVE_RUNTIME_TUNING_DEFAULT.transitionCeilMs,
      telemetryBeatConfidenceMin: LIVE_RUNTIME_TUNING_DEFAULT.telemetryBeatConfidenceMin
    }
    : hasObsoleteTransitionPair
    ? {
      ...sourceRaw,
      transitionFloorMs: LIVE_RUNTIME_TUNING_DEFAULT.transitionFloorMs,
      transitionCeilMs: LIVE_RUNTIME_TUNING_DEFAULT.transitionCeilMs
    }
    : sourceRaw;
  const fb = fallback && typeof fallback === "object" && !Array.isArray(fallback)
    ? fallback
    : LIVE_RUNTIME_TUNING_DEFAULT;
  const brightnessFloor = clampNumber(source.brightnessFloor, 0, 0.9, clampNumber(fb.brightnessFloor, 0, 0.9, 0.03));
  const brightnessCeil = clampNumber(source.brightnessCeil, brightnessFloor, 1, clampNumber(fb.brightnessCeil, brightnessFloor, 1, 1));
  const transitionFloorMs = clampNumber(
    source.transitionFloorMs,
    20,
    5000,
    clampNumber(fb.transitionFloorMs, 20, 5000, 32)
  );
  const transitionCeilMs = clampNumber(
    source.transitionCeilMs,
    transitionFloorMs,
    60000,
    clampNumber(fb.transitionCeilMs, transitionFloorMs, 60000, 190)
  );
  return {
    bpmSourceMode: normalizeBpmSourceMode(source.bpmSourceMode, fb.bpmSourceMode),
    sceneSwitchCooldownMs: clampNumber(source.sceneSwitchCooldownMs, 0, 10000, clampNumber(fb.sceneSwitchCooldownMs, 0, 10000, 260)),
    impactHoldMs: clampNumber(source.impactHoldMs, 0, 5000, clampNumber(fb.impactHoldMs, 0, 5000, 140)),
    brightnessFloor,
    brightnessCeil,
    transitionFloorMs,
    transitionCeilMs,
    telemetryBeatConfidenceMin: clampNumber(
      source.telemetryBeatConfidenceMin,
      0,
      1,
      clampNumber(fb.telemetryBeatConfidenceMin, 0, 1, 0.34)
    ),
    derivedBeatMinIntervalMs: clampNumber(
      source.derivedBeatMinIntervalMs,
      120,
      1200,
      clampNumber(fb.derivedBeatMinIntervalMs, 120, 1200, 120)
    ),
    derivedBeatMaxIntervalMs: clampNumber(
      source.derivedBeatMaxIntervalMs,
      300,
      5000,
      clampNumber(fb.derivedBeatMaxIntervalMs, 300, 5000, 1600)
    )
  };
}

function normalizePatchObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizePaletteContainerScopes(container = {}) {
  const source = normalizePatchObject(container);
  const normalizedConfig = normalizePaletteScopeConfig(source.config, {});
  const normalizedBrands = {};
  const brandEntries = Object.entries(normalizePatchObject(source.brands))
    .sort((a, b) => String(a[0] || "").localeCompare(String(b[0] || "")));
  for (const [brand, config] of brandEntries) {
    const normalizedBrand = normalizeBrandToken(brand || config?.brand);
    if (!normalizedBrand) continue;
    normalizedBrands[normalizedBrand] = {
      ...normalizePaletteScopeConfig(config, normalizedConfig),
      brand: normalizedBrand
    };
  }
  const normalizedFixtureOverrides = {};
  const fixtureEntries = Object.entries(normalizePatchObject(source.fixtureOverrides))
    .sort((a, b) => String(a[0] || "").localeCompare(String(b[0] || "")));
  for (const [fixtureIdRaw, config] of fixtureEntries) {
    const fixtureId = normalizeFixtureId(fixtureIdRaw || config?.fixtureId);
    if (!fixtureId) continue;
    const brand = normalizeBrandToken(config?.brand);
    const brandFallback = brand && normalizedBrands[brand]
      ? normalizedBrands[brand]
      : normalizedConfig;
    normalizedFixtureOverrides[fixtureId] = {
      ...normalizePaletteScopeConfig(config, brandFallback),
      fixtureId,
      brand
    };
  }
  return {
    config: normalizedConfig,
    brands: normalizedBrands,
    fixtureOverrides: normalizedFixtureOverrides,
    updatedAt: Number(source.updatedAt || 0)
  };
}

function normalizeBrandToken(value) {
  const token = String(value || "").trim().toLowerCase();
  if (token === "hue" || token === "wiz") return token;
  return "";
}

function normalizeFixtureId(value) {
  return String(value || "").trim();
}

function normalizeTriggerMatrixScopeLevel(value, fallback = "global") {
  const token = String(value || "").trim().toLowerCase();
  if (token === "global" || token === "brand" || token === "fixture") return token;
  const fallbackToken = String(fallback || "").trim().toLowerCase();
  return fallbackToken === "brand" || fallbackToken === "fixture" ? fallbackToken : "global";
}

function normalizeTriggerMatrixScopePatch(value = {}, defaults = {}) {
  const source = normalizePatchObject(value);
  const fallback = defaults && typeof defaults === "object" ? defaults : {};
  const level = normalizeTriggerMatrixScopeLevel(source.level, fallback.level || "global");
  const brand = normalizeBrandToken(source.brand || fallback.brand);
  const fixtureId = normalizeFixtureId(source.fixtureId || source.id || fallback.fixtureId);
  if (level === "fixture" && fixtureId && brand) {
    return { level: "fixture", brand, fixtureId };
  }
  if (level === "brand" && brand) {
    return { level: "brand", brand, fixtureId: "" };
  }
  if (fixtureId && brand) {
    return { level: "fixture", brand, fixtureId };
  }
  if (brand) {
    return { level: "brand", brand, fixtureId: "" };
  }
  return { level: "global", brand: "", fixtureId: "" };
}

function normalizeTriggerMatrixScopeEntry(value = {}, fallback = {}, options = {}) {
  const source = normalizePatchObject(value);
  const fb = fallback && typeof fallback === "object" ? fallback : {};
  const brand = normalizeBrandToken(source.brand || options.brand);
  const fixtureId = normalizeFixtureId(source.fixtureId || options.fixtureId);
  return {
    sceneFilterAggressiveness: normalizeSceneFilterAggressiveness(
      source.sceneFilterAggressiveness,
      fb.sceneFilterAggressiveness
    ),
    runtimeTuning: normalizeRuntimeTuning(
      source.runtimeTuning,
      fb.runtimeTuning
    ),
    brand,
    fixtureId,
    updatedAt: Number(source.updatedAt || 0)
  };
}

function normalizeTriggerMatrixBrandOverrides(raw = {}, globalEntry = {}) {
  const source = normalizePatchObject(raw);
  const out = {};
  for (const [rawBrand, row] of Object.entries(source)) {
    const rowMap = normalizePatchObject(row);
    const brand = normalizeBrandToken(rowMap.brand || rawBrand);
    if (!brand) continue;
    const normalized = normalizeTriggerMatrixScopeEntry(
      rowMap,
      globalEntry,
      { brand }
    );
    out[brand] = {
      brand,
      sceneFilterAggressiveness: normalized.sceneFilterAggressiveness,
      runtimeTuning: normalized.runtimeTuning,
      updatedAt: normalized.updatedAt
    };
  }
  return out;
}

function normalizeTriggerMatrixFixtureOverrides(raw = {}, brandMap = {}, globalEntry = {}) {
  const source = normalizePatchObject(raw);
  const out = {};
  for (const [rawFixtureId, row] of Object.entries(source)) {
    const rowMap = normalizePatchObject(row);
    const fixtureId = normalizeFixtureId(rowMap.fixtureId || rawFixtureId);
    if (!fixtureId) continue;
    const brand = normalizeBrandToken(rowMap.brand);
    if (!brand) continue;
    const fallback = brandMap[brand] && typeof brandMap[brand] === "object"
      ? brandMap[brand]
      : globalEntry;
    const normalized = normalizeTriggerMatrixScopeEntry(
      rowMap,
      fallback,
      { brand, fixtureId }
    );
    out[fixtureId] = {
      brand,
      fixtureId,
      sceneFilterAggressiveness: normalized.sceneFilterAggressiveness,
      runtimeTuning: normalized.runtimeTuning,
      updatedAt: normalized.updatedAt
    };
  }
  return out;
}

module.exports = function createLiveCompatService(options = {}) {
  const storePath = String(options.storePath || "").trim();
  if (!storePath) {
    throw new Error("createLiveCompatService requires storePath");
  }
  const now = typeof options.now === "function" ? options.now : Date.now;

  const defaults = {
    compatibility: {
      sceneLock: "auto",
      sceneIntent: "auto",
      updatedAt: 0
    },
    triggerMatrix: {
      global: {
        sceneFilterAggressiveness: {
          calm: 1,
          groove: 1,
          impact: 1
        },
        runtimeTuning: cloneJsonSafe(LIVE_RUNTIME_TUNING_DEFAULT, {})
      },
      manualGlobal: {
        sceneFilterAggressiveness: {
          calm: 1,
          groove: 1,
          impact: 1
        },
        runtimeTuning: cloneJsonSafe(LIVE_RUNTIME_TUNING_DEFAULT, {})
      },
      config: {
        sceneFilterAggressiveness: {
          calm: 1,
          groove: 1,
          impact: 1
        },
        runtimeTuning: cloneJsonSafe(LIVE_RUNTIME_TUNING_DEFAULT, {})
      },
      manualConfig: {
        sceneFilterAggressiveness: {
          calm: 1,
          groove: 1,
          impact: 1
        },
        runtimeTuning: cloneJsonSafe(LIVE_RUNTIME_TUNING_DEFAULT, {})
      },
      syncGroups: cloneJsonSafe(LIVE_SYNC_GROUPS_DEFAULT, {
        enabled: false,
        groups: [],
        fixtureEngine: {},
        updatedAt: 0
      }),
      brands: {},
      fixtureOverrides: {},
      updatedAt: 0
    },
    palette: {
      config: {},
      brands: {},
      fixtureOverrides: {},
      updatedAt: 0
    },
    fixtureMetrics: {
      config: {},
      brands: {},
      fixtureOverrides: {},
      updatedAt: 0
    },
    overclock: {
      autoEnabled: false,
      level: 2,
      devHz: 0,
      updatedAt: 0
    }
  };

  let state = cloneJsonSafe(defaults, defaults);

  function ensureStateShape() {
    const source = normalizePatchObject(state);
    const next = cloneJsonSafe(defaults, defaults);
    next.compatibility = {
      ...next.compatibility,
      ...normalizePatchObject(source.compatibility),
      sceneLock: normalizeSceneLock(source?.compatibility?.sceneLock, "auto"),
      sceneIntent: normalizeSceneLock(source?.compatibility?.sceneIntent, "auto")
    };
    const triggerSource = normalizePatchObject(source.triggerMatrix);
    const baseAgg = normalizeSceneFilterAggressiveness(
      triggerSource?.global?.sceneFilterAggressiveness,
      defaults.triggerMatrix.global.sceneFilterAggressiveness
    );
    const baseRuntimeTuning = normalizeRuntimeTuning(
      triggerSource?.global?.runtimeTuning,
      defaults.triggerMatrix.global.runtimeTuning
    );
    const globalEntry = {
      sceneFilterAggressiveness: baseAgg,
      runtimeTuning: baseRuntimeTuning
    };
    const brandOverrides = normalizeTriggerMatrixBrandOverrides(
      triggerSource?.brands,
      globalEntry
    );
    const fixtureOverrides = normalizeTriggerMatrixFixtureOverrides(
      triggerSource?.fixtureOverrides,
      brandOverrides,
      globalEntry
    );
    const syncGroups = normalizeSyncGroups(
      triggerSource?.syncGroups,
      defaults.triggerMatrix.syncGroups
    );
    next.triggerMatrix = {
      global: {
        sceneFilterAggressiveness: baseAgg,
        runtimeTuning: baseRuntimeTuning
      },
      manualGlobal: {
        sceneFilterAggressiveness: normalizeSceneFilterAggressiveness(
          triggerSource?.manualGlobal?.sceneFilterAggressiveness,
          baseAgg
        ),
        runtimeTuning: normalizeRuntimeTuning(
          triggerSource?.manualGlobal?.runtimeTuning,
          baseRuntimeTuning
        )
      },
      config: {
        sceneFilterAggressiveness: normalizeSceneFilterAggressiveness(
          triggerSource?.config?.sceneFilterAggressiveness,
          baseAgg
        ),
        runtimeTuning: normalizeRuntimeTuning(
          triggerSource?.config?.runtimeTuning,
          baseRuntimeTuning
        )
      },
      manualConfig: {
        sceneFilterAggressiveness: normalizeSceneFilterAggressiveness(
          triggerSource?.manualConfig?.sceneFilterAggressiveness,
          baseAgg
        ),
        runtimeTuning: normalizeRuntimeTuning(
          triggerSource?.manualConfig?.runtimeTuning,
          baseRuntimeTuning
        )
      },
      syncGroups,
      brands: brandOverrides,
      fixtureOverrides,
      updatedAt: Number(triggerSource.updatedAt || 0)
    };
    next.palette = normalizePaletteContainerScopes(source?.palette);
    next.fixtureMetrics = {
      config: cloneJsonSafe(normalizePatchObject(source?.fixtureMetrics?.config), {}),
      brands: cloneJsonSafe(normalizePatchObject(source?.fixtureMetrics?.brands), {}),
      fixtureOverrides: cloneJsonSafe(normalizePatchObject(source?.fixtureMetrics?.fixtureOverrides), {}),
      updatedAt: Number(source?.fixtureMetrics?.updatedAt || 0)
    };
    next.overclock = {
      autoEnabled: source?.overclock?.autoEnabled === true,
      level: clampNumber(Math.round(Number(source?.overclock?.level)), 0, 7, 2),
      devHz: clampNumber(Math.round(Number(source?.overclock?.devHz)), 0, 60, 0),
      updatedAt: Number(source?.overclock?.updatedAt || 0)
    };
    state = next;
  }

  function persist() {
    writeJsonFile(storePath, state);
  }

  function load() {
    if (fs.existsSync(storePath)) {
      state = readJsonFile(storePath, cloneJsonSafe(defaults, defaults));
    } else {
      state = cloneJsonSafe(defaults, defaults);
    }
    ensureStateShape();
    persist();
  }

  function patchCompatibility(patch = {}) {
    const source = normalizePatchObject(patch);
    const at = Number(now() || Date.now());
    state.compatibility = {
      ...state.compatibility,
      sceneLock: normalizeSceneLock(source.sceneLock, state.compatibility.sceneLock),
      sceneIntent: normalizeSceneLock(source.sceneIntent || source.sceneLock, state.compatibility.sceneIntent),
      updatedAt: at
    };
    persist();
    return {
      ok: true,
      applied: {
        sceneLock: state.compatibility.sceneLock,
        sceneIntent: state.compatibility.sceneIntent
      },
      snapshot: cloneJsonSafe(state.compatibility, {})
    };
  }

  function getCompatibility() {
    return {
      ok: true,
      snapshot: cloneJsonSafe(state.compatibility, {})
    };
  }

  function patchTriggerMatrix(patch = {}) {
    const source = normalizePatchObject(patch);
    const override = normalizePatchObject(source.override);
    const syncGroupsPatch = normalizePatchObject(source.syncGroups);
    const scope = normalizeTriggerMatrixScopePatch(source.scope, {
      level: "global",
      brand: "",
      fixtureId: ""
    });
    const at = Number(now() || Date.now());
    const globalEntry = {
      sceneFilterAggressiveness: state.triggerMatrix.global.sceneFilterAggressiveness,
      runtimeTuning: state.triggerMatrix.global.runtimeTuning
    };

    if (scope.level === "global") {
      const nextAgg = normalizeSceneFilterAggressiveness(
        override.sceneFilterAggressiveness,
        state.triggerMatrix.global.sceneFilterAggressiveness
      );
      const nextRuntimeTuning = normalizeRuntimeTuning(
        override.runtimeTuning,
        state.triggerMatrix.global.runtimeTuning
      );
      state.triggerMatrix.global.sceneFilterAggressiveness = nextAgg;
      state.triggerMatrix.global.runtimeTuning = nextRuntimeTuning;
      state.triggerMatrix.manualGlobal.sceneFilterAggressiveness = nextAgg;
      state.triggerMatrix.manualGlobal.runtimeTuning = nextRuntimeTuning;
      state.triggerMatrix.config.sceneFilterAggressiveness = nextAgg;
      state.triggerMatrix.config.runtimeTuning = nextRuntimeTuning;
      state.triggerMatrix.manualConfig.sceneFilterAggressiveness = nextAgg;
      state.triggerMatrix.manualConfig.runtimeTuning = nextRuntimeTuning;
      const syncGroupsOverride = Object.keys(syncGroupsPatch).length
        ? syncGroupsPatch
        : normalizePatchObject(override.syncGroups);
      if (Object.keys(syncGroupsOverride).length) {
        const nextSyncGroups = normalizeSyncGroups(
          syncGroupsOverride,
          state.triggerMatrix.syncGroups
        );
        state.triggerMatrix.syncGroups = {
          ...nextSyncGroups,
          updatedAt: at
        };
      }
    } else if (scope.level === "brand") {
      const brandKey = normalizeBrandToken(scope.brand);
      const fallback = state.triggerMatrix.brands?.[brandKey] && typeof state.triggerMatrix.brands[brandKey] === "object"
        ? state.triggerMatrix.brands[brandKey]
        : globalEntry;
      const normalized = normalizeTriggerMatrixScopeEntry(
        {
          ...override,
          brand: brandKey
        },
        fallback,
        { brand: brandKey }
      );
      state.triggerMatrix.brands[brandKey] = {
        brand: brandKey,
        sceneFilterAggressiveness: normalized.sceneFilterAggressiveness,
        runtimeTuning: normalized.runtimeTuning,
        updatedAt: at
      };
    } else if (scope.level === "fixture") {
      const fixtureId = normalizeFixtureId(scope.fixtureId);
      const explicitBrand = normalizeBrandToken(scope.brand);
      const existing = state.triggerMatrix.fixtureOverrides?.[fixtureId] || null;
      const brandKey = normalizeBrandToken(explicitBrand || existing?.brand);
      const brandFallback = state.triggerMatrix.brands?.[brandKey] && typeof state.triggerMatrix.brands[brandKey] === "object"
        ? state.triggerMatrix.brands[brandKey]
        : globalEntry;
      const fixtureFallback = existing && typeof existing === "object" && normalizeBrandToken(existing.brand) === brandKey
        ? existing
        : brandFallback;
      const normalized = normalizeTriggerMatrixScopeEntry(
        {
          ...override,
          brand: brandKey,
          fixtureId
        },
        fixtureFallback,
        { brand: brandKey, fixtureId }
      );
      state.triggerMatrix.fixtureOverrides[fixtureId] = {
        brand: brandKey,
        fixtureId,
        sceneFilterAggressiveness: normalized.sceneFilterAggressiveness,
        runtimeTuning: normalized.runtimeTuning,
        updatedAt: at
      };
    }

    state.triggerMatrix.updatedAt = at;
    persist();
    return {
      ok: true,
      appliedScope: scope,
      ...cloneJsonSafe(state.triggerMatrix, {})
    };
  }

  function getTriggerMatrix() {
    return {
      ok: true,
      ...cloneJsonSafe(state.triggerMatrix, {})
    };
  }

  function getSyncGroups() {
    return {
      ok: true,
      snapshot: cloneJsonSafe(state.triggerMatrix.syncGroups, {})
    };
  }

  function patchSyncGroups(patch = {}) {
    const source = normalizePatchObject(patch);
    const at = Number(now() || Date.now());
    const next = normalizeSyncGroups(source, state.triggerMatrix.syncGroups);
    state.triggerMatrix.syncGroups = {
      ...next,
      updatedAt: at
    };
    state.triggerMatrix.updatedAt = at;
    persist();
    return {
      ok: true,
      snapshot: cloneJsonSafe(state.triggerMatrix.syncGroups, {}),
      triggerMatrixUpdatedAt: state.triggerMatrix.updatedAt
    };
  }

  function mergeScopedPatch(container = {}, patch = {}, clearKey = false) {
    const source = normalizePatchObject(patch);
    const fixtureId = normalizeFixtureId(source.fixtureId);
    const brand = normalizeBrandToken(source.brand);

    if (fixtureId && clearKey === true) {
      delete container.fixtureOverrides[fixtureId];
      return;
    }
    if (brand && !fixtureId && clearKey === true) {
      delete container.brands[brand];
      return;
    }
    if (fixtureId) {
      container.fixtureOverrides[fixtureId] = {
        ...normalizePatchObject(container.fixtureOverrides[fixtureId]),
        ...source,
        fixtureId,
        brand: brand || normalizeBrandToken(container.fixtureOverrides[fixtureId]?.brand)
      };
      return;
    }
    if (brand) {
      container.brands[brand] = {
        ...normalizePatchObject(container.brands[brand]),
        ...source,
        brand
      };
      return;
    }
    container.config = {
      ...normalizePatchObject(container.config),
      ...source
    };
  }

  function getPaletteSnapshot() {
    return {
      ok: true,
      ...cloneJsonSafe(state.palette, {})
    };
  }

  function patchPalette(patch = {}) {
    const source = normalizePatchObject(patch);
    if (source.clearAll === true) {
      state.palette = cloneJsonSafe(defaults.palette, defaults.palette);
    } else {
      mergeScopedPatch(state.palette, source, source.clearOverride === true);
      state.palette = normalizePaletteContainerScopes(state.palette);
    }
    state.palette.updatedAt = Number(now() || Date.now());
    persist();
    return {
      ok: true,
      ...cloneJsonSafe(state.palette, {})
    };
  }

  function getFixtureMetricsSnapshot() {
    return {
      ok: true,
      ...cloneJsonSafe(state.fixtureMetrics, {})
    };
  }

  function patchFixtureMetrics(patch = {}) {
    const source = normalizePatchObject(patch);
    if (source.clearAll === true) {
      state.fixtureMetrics = cloneJsonSafe(defaults.fixtureMetrics, defaults.fixtureMetrics);
    } else {
      mergeScopedPatch(state.fixtureMetrics, source, source.clearOverride === true);
    }
    state.fixtureMetrics.updatedAt = Number(now() || Date.now());
    persist();
    return {
      ok: true,
      ...cloneJsonSafe(state.fixtureMetrics, {})
    };
  }

  function clearFixtureRouting(patch = {}) {
    const source = normalizePatchObject(patch);
    const fixtureId = normalizeFixtureId(source.fixtureId || source.id);
    const brand = normalizeBrandToken(source.brand);
    let cleared = 0;
    if (fixtureId && state.palette.fixtureOverrides[fixtureId]) {
      delete state.palette.fixtureOverrides[fixtureId];
      cleared += 1;
    }
    if (fixtureId && state.fixtureMetrics.fixtureOverrides[fixtureId]) {
      delete state.fixtureMetrics.fixtureOverrides[fixtureId];
      cleared += 1;
    }
    if (brand && state.palette.brands[brand]) {
      delete state.palette.brands[brand];
      cleared += 1;
    }
    if (brand && state.fixtureMetrics.brands[brand]) {
      delete state.fixtureMetrics.brands[brand];
      cleared += 1;
    }
    const at = Number(now() || Date.now());
    state.palette.updatedAt = at;
    state.fixtureMetrics.updatedAt = at;
    persist();
    return {
      ok: true,
      cleared
    };
  }

  function setOverclockPresetLevel(levelRaw = 2) {
    state.overclock.level = clampNumber(Math.round(Number(levelRaw)), 0, 7, state.overclock.level);
    state.overclock.autoEnabled = false;
    state.overclock.devHz = 0;
    state.overclock.updatedAt = Number(now() || Date.now());
    persist();
    return {
      ok: true,
      overclock: cloneJsonSafe(state.overclock, {})
    };
  }

  function setOverclockAuto(enabled = false) {
    state.overclock.autoEnabled = enabled === true;
    state.overclock.devHz = 0;
    state.overclock.updatedAt = Number(now() || Date.now());
    persist();
    return {
      ok: true,
      overclock: cloneJsonSafe(state.overclock, {})
    };
  }

  function setOverclockDevHz(hzRaw = 20) {
    state.overclock.devHz = clampNumber(Math.round(Number(hzRaw)), 1, 60, 20);
    state.overclock.autoEnabled = false;
    state.overclock.updatedAt = Number(now() || Date.now());
    persist();
    return {
      ok: true,
      overclock: cloneJsonSafe(state.overclock, {})
    };
  }

  function getOverclockTiers() {
    const tiers = [
      { level: 0, label: "off", hz: 0 },
      { level: 1, label: "on", hz: 8 },
      { level: 2, label: "turbo", hz: 10 },
      { level: 3, label: "ultra", hz: 12 },
      { level: 4, label: "extreme", hz: 15 },
      { level: 5, label: "insane", hz: 20 },
      { level: 6, label: "hyper", hz: 30 },
      { level: 7, label: "ludicrous", hz: 40 }
    ];
    return {
      ok: true,
      tiers,
      activeLevel: state.overclock.level,
      autoEnabled: state.overclock.autoEnabled,
      devHz: state.overclock.devHz
    };
  }

  load();

  return {
    getCompatibility,
    patchCompatibility,
    getTriggerMatrix,
    patchTriggerMatrix,
    getSyncGroups,
    patchSyncGroups,
    getPaletteSnapshot,
    patchPalette,
    getFixtureMetricsSnapshot,
    patchFixtureMetrics,
    clearFixtureRouting,
    setOverclockPresetLevel,
    setOverclockAuto,
    setOverclockDevHz,
    getOverclockTiers
  };
};
