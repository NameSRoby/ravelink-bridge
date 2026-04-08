// [TITLE] Module: domains/engine-v2/engine.runtime.sync-groups.js
// [TITLE] Purpose: sync-group compatibility normalization and palette-frame helpers for engine runtime
// [TITLE] Functionality Index:
// [TITLE] - normalize LIVE sync-group compatibility payloads for runtime use
// [TITLE] - build fixture/group lookup maps for dispatch and policy stages
// [TITLE] - resolve group palette indices and palette frames deterministically

const { clampNumber } = require("./engine.contracts");
const createLiveSyncGroupNormalization = require("../live/live-sync-groups.normalization");
const {
  SYNC_GROUP_DEFAULT_REMOVE_BEHAVIOR,
  SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT,
  normalizeSyncGroupSequenceMode,
  normalizeSyncGroupFixtureIds,
  normalizeSyncGroupRemoveBehavior,
  normalizeSyncGroupCustomFallback
} = createLiveSyncGroupNormalization({ clampNumber });

function normalizeBooleanRuntime(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  const token = String(value || "").trim().toLowerCase();
  if (!token) return fallback === true;
  if (token === "true" || token === "on" || token === "yes") return true;
  if (token === "false" || token === "off" || token === "no") return false;
  return fallback === true;
}

function buildSyncGroupFixtureMapRuntime(syncGroups = {}) {
  const source = syncGroups && typeof syncGroups === "object" && !Array.isArray(syncGroups)
    ? syncGroups
    : {};
  const groupsRaw = Array.isArray(source.groups) ? source.groups : [];
  const fixtureEngineRaw = source.fixtureEngine && typeof source.fixtureEngine === "object" && !Array.isArray(source.fixtureEngine)
    ? source.fixtureEngine
    : {};
  const enabled = normalizeBooleanRuntime(source.enabled, false);
  const groups = [];
  const fixtureGroupById = new Map();
  const fixtureEngineById = new Map();
  const seenGroups = new Set();
  for (let i = 0; i < groupsRaw.length && groups.length < 24; i += 1) {
    const row = groupsRaw[i] && typeof groupsRaw[i] === "object" && !Array.isArray(groupsRaw[i])
      ? groupsRaw[i]
      : {};
    const id = String(row.id || "").trim();
    if (!id || seenGroups.has(id)) continue;
    seenGroups.add(id);
    const group = {
      id,
      sequenceMode: normalizeSyncGroupSequenceMode(row.sequenceMode, "sync"),
      phaseOffset: clampNumber(Math.round(Number(row.phaseOffset)), -64, 64, 0),
      fixtureIds: normalizeSyncGroupFixtureIds(row.fixtureIds, { limit: 4096 })
    };
    groups.push(group);
    for (const fixtureId of group.fixtureIds) {
      if (fixtureGroupById.has(fixtureId)) continue;
      fixtureGroupById.set(fixtureId, group);
    }
  }
  const fixtureEngineRows = Object.entries(fixtureEngineRaw)
    .map(([rawFixtureId, row]) => {
      const sourceRow = row && typeof row === "object" && !Array.isArray(row) ? row : {};
      const fixtureId = String(sourceRow.fixtureId || sourceRow.id || rawFixtureId || "").trim();
      if (!fixtureId) return null;
      return {
        fixtureId,
        excluded: normalizeBooleanRuntime(
          sourceRow.excluded ?? sourceRow.removed ?? sourceRow.disabled,
          false
        ),
        removeBehavior: normalizeSyncGroupRemoveBehavior(
          sourceRow.removeBehavior ?? sourceRow.onRemove ?? sourceRow.behavior,
          SYNC_GROUP_DEFAULT_REMOVE_BEHAVIOR
        ),
        customFallback: normalizeSyncGroupCustomFallback(
          sourceRow.customFallback ?? sourceRow.customState ?? sourceRow.fallback,
          SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT
        )
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.fixtureId).localeCompare(String(b.fixtureId)))
    .slice(0, 4096);
  for (const row of fixtureEngineRows) {
      fixtureEngineById.set(row.fixtureId, {
        excluded: row.excluded === true,
        removeBehavior: row.removeBehavior,
        customFallback: normalizeSyncGroupCustomFallback(
          row.customFallback,
          SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT
        )
    });
  }
  return {
    enabled,
    groups,
    fixtureGroupById,
    fixtureEngineById
  };
}

function resolveSyncGroupPaletteIndexRuntime(baseIndex = 0, sequenceCount = 1, group = {}) {
  const count = Math.max(1, Math.round(Number(sequenceCount || 1)));
  const safeBase = ((Math.round(Number(baseIndex || 0)) % count) + count) % count;
  if (count <= 1) return 0;
  const mode = normalizeSyncGroupSequenceMode(group.sequenceMode, "sync");
  if (mode === "reverse") {
    return ((count - 1) - safeBase + count) % count;
  }
  if (mode === "offset") {
    const offset = clampNumber(Math.round(Number(group.phaseOffset)), -64, 64, 0);
    return ((safeBase + offset) % count + count) % count;
  }
  return safeBase;
}

function resolvePaletteFrameByIndexRuntime(options = {}) {
  const source = options && typeof options === "object" ? options : {};
  const paletteSnapshot = source.paletteSnapshot && typeof source.paletteSnapshot === "object"
    ? source.paletteSnapshot
    : null;
  const base = source.basePaletteFrame && typeof source.basePaletteFrame === "object"
    ? source.basePaletteFrame
    : {};
  const resolvedSequence = Array.isArray(paletteSnapshot?.resolvedSequence)
    ? paletteSnapshot.resolvedSequence
    : [];
  const sequenceCount = Math.max(
    1,
    Math.round(Number(resolvedSequence.length || paletteSnapshot?.colorCount || base.count || 1))
  );
  const safeIndex = ((Math.round(Number(source.index || 0)) % sequenceCount) + sequenceCount) % sequenceCount;
  if (!resolvedSequence.length) {
    const baseRgb = base.rgb && typeof base.rgb === "object"
      ? base.rgb
      : { r: 255, g: 255, b: 255 };
    return {
      ...base,
      index: safeIndex,
      count: sequenceCount,
      rgb: {
        r: clampNumber(Math.round(Number(baseRgb.r)), 0, 255, 255),
        g: clampNumber(Math.round(Number(baseRgb.g)), 0, 255, 255),
        b: clampNumber(Math.round(Number(baseRgb.b)), 0, 255, 255)
      }
    };
  }
  const row = resolvedSequence[safeIndex] && typeof resolvedSequence[safeIndex] === "object"
    ? resolvedSequence[safeIndex]
    : {};
  const rgbSource = row.rgb && typeof row.rgb === "object"
    ? row.rgb
    : (base.rgb && typeof base.rgb === "object" ? base.rgb : { r: 255, g: 255, b: 255 });
  return {
    index: safeIndex,
    token: String(row.token || row.name || base.token || `group_${safeIndex + 1}`).trim().toLowerCase(),
    name: String(row.name || row.token || base.name || base.token || `Group ${safeIndex + 1}`).trim(),
    hex: String(row.hex || base.hex || "").trim().toLowerCase(),
    rgb: {
      r: clampNumber(Math.round(Number(rgbSource.r)), 0, 255, 255),
      g: clampNumber(Math.round(Number(rgbSource.g)), 0, 255, 255),
      b: clampNumber(Math.round(Number(rgbSource.b)), 0, 255, 255)
    },
    source: String(row.source || base.source || "palette_sync_group").trim() || "palette_sync_group",
    count: sequenceCount,
    holdTicks: Math.max(1, Math.round(Number(base.holdTicks || 1)))
  };
}

module.exports = {
  SYNC_GROUP_DEFAULT_REMOVE_BEHAVIOR,
  SYNC_GROUP_CUSTOM_FALLBACK_DEFAULT,
  normalizeSyncGroupModeRuntime: normalizeSyncGroupSequenceMode,
  normalizeSyncGroupRemoveBehaviorRuntime: normalizeSyncGroupRemoveBehavior,
  normalizeSyncGroupCustomFallbackRuntime: normalizeSyncGroupCustomFallback,
  buildSyncGroupFixtureMapRuntime,
  resolveSyncGroupPaletteIndexRuntime,
  resolvePaletteFrameByIndexRuntime
};
