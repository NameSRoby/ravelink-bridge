// [TITLE] Module: public/assets/js/domains/live/live-profile-sync-groups-runtime-ui.js
// [TITLE] Purpose: LIVE profile sync-group snapshot normalization + runtime fetch helpers
// [TITLE] Functionality Index:
// [TITLE] - normalize profile sync-group payloads
// [TITLE] - fetch sync-group snapshots from dedicated LIVE endpoint
//
// [DEV] Complex Flow:
// [DEV] These helpers are intentionally separated from live-profile-store runtime so
// [DEV] profile storage logic stays under file budget while sync-group behavior remains
// [DEV] domain-specific and testable in one bounded module.

function cloneLiveProfileSyncGroupsData(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function normalizeLiveProfileSyncGroupsSnapshot(raw = null, fallback = null) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw
    : (fallback && typeof fallback === "object" && !Array.isArray(fallback) ? fallback : null);
  if (!source) return null;

  if (typeof normalizeLiveSyncGroupsUi === "function") {
    return cloneLiveProfileSyncGroupsData(normalizeLiveSyncGroupsUi(source, source), null);
  }

  const groupsRaw = Array.isArray(source.groups) ? source.groups : [];
  const groups = groupsRaw
    .map((row, index) => {
      const sourceRow = row && typeof row === "object" && !Array.isArray(row) ? row : {};
      const id = String(sourceRow.id || `group-${index + 1}`).trim();
      if (!id) return null;
      const name = String(sourceRow.name || `GROUP ${index + 1}`).trim().slice(0, 48) || `GROUP ${index + 1}`;
      const sequenceMode = String(sourceRow.sequenceMode || "sync").trim().toLowerCase();
      const phaseOffset = Math.max(-64, Math.min(64, Math.round(Number(sourceRow.phaseOffset) || 0)));
      const fixtureIds = Array.isArray(sourceRow.fixtureIds)
        ? sourceRow.fixtureIds.map(value => String(value || "").trim()).filter(Boolean)
        : [];
      return {
        id,
        name,
        sequenceMode: sequenceMode === "reverse" || sequenceMode === "offset" ? sequenceMode : "sync",
        phaseOffset,
        fixtureIds,
        updatedAt: Number(sourceRow.updatedAt || 0)
      };
    })
    .filter(Boolean);

  const normalizeRemoveBehavior = value => {
    const token = String(value || "").trim().toLowerCase();
    if (token === "restore" || token === "pre_engine" || token === "pre-engine" || token === "preengine" || token === "previous") {
      return "keep_current";
    }
    if (token === "keep" || token === "current" || token === "hold" || token === "hold_last" || token === "hold-last") {
      return "keep_current";
    }
    if (token === "custom" || token === "custom_state" || token === "custom-state" || token === "custom_fallback" || token === "custom-fallback") {
      return "custom_state";
    }
    if (token === "off" || token === "black" || token === "blackout") {
      return "blackout";
    }
    if (token === "keep_current" || token === "blackout" || token === "custom_state") return token;
    return "keep_current";
  };
  const normalizeHex = value => {
    const token = String(value || "").trim().toLowerCase();
    if (/^#?[0-9a-f]{6}$/i.test(token)) {
      return token.startsWith("#") ? token : `#${token}`;
    }
    return "#ffffff";
  };
  const normalizeCustomMode = value => {
    const token = String(value || "").trim().toLowerCase();
    if (token === "cct" || token === "white" || token === "kelvin" || token === "temp" || token === "temperature") {
      return "cct";
    }
    return "hex";
  };
  const normalizeCustomFallback = value => {
    const sourceRow = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return {
      mode: normalizeCustomMode(sourceRow.mode ?? sourceRow.type),
      hex: normalizeHex(sourceRow.hex ?? sourceRow.color ?? sourceRow.colorHex ?? sourceRow.value),
      cct: Math.max(2000, Math.min(6500, Math.round(Number(sourceRow.cct ?? sourceRow.kelvin ?? sourceRow.temp) || 4000))),
      brightness: Math.max(1, Math.min(100, Math.round(Number(sourceRow.brightness ?? sourceRow.level ?? sourceRow.dimming) || 100)))
    };
  };
  const fixtureEngineRaw = source.fixtureEngine && typeof source.fixtureEngine === "object" && !Array.isArray(source.fixtureEngine)
    ? source.fixtureEngine
    : {};
  const fixtureEngine = Object.entries(fixtureEngineRaw)
    .map(([rawFixtureId, row]) => {
      const sourceRow = row && typeof row === "object" && !Array.isArray(row) ? row : {};
      const fixtureId = String(sourceRow.fixtureId || sourceRow.id || rawFixtureId || "").trim();
      if (!fixtureId) return null;
      return {
        fixtureId,
        excluded: parseBooleanUi(
          sourceRow.excluded ?? sourceRow.removed ?? sourceRow.disabled,
          false
        ) === true,
        removeBehavior: normalizeRemoveBehavior(
          sourceRow.removeBehavior ?? sourceRow.onRemove ?? sourceRow.behavior
        ),
        customFallback: normalizeCustomFallback(
          sourceRow.customFallback ?? sourceRow.customState ?? sourceRow.fallback
        ),
        updatedAt: Number(sourceRow.updatedAt || 0)
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.fixtureId).localeCompare(String(b.fixtureId)))
    .slice(0, 4096)
    .reduce((map, row) => {
      map[row.fixtureId] = {
        excluded: row.excluded === true,
        removeBehavior: row.removeBehavior,
        customFallback: row.customFallback,
        updatedAt: row.updatedAt
      };
      return map;
    }, {});

  return {
    enabled: parseBooleanUi(source.enabled, false) === true,
    groups,
    fixtureEngine,
    updatedAt: Number(source.updatedAt || 0)
  };
}

async function buildLiveProfileSyncGroupsSnapshotFromRuntime() {
  const runtime = await liveEndpointsAdapter.getSyncGroups();
  if (runtime && runtime.ok && runtime.snapshot && typeof runtime.snapshot === "object") {
    return normalizeLiveProfileSyncGroupsSnapshot(
      runtime.snapshot,
      ui.liveSyncGroups || null
    );
  }
  return normalizeLiveProfileSyncGroupsSnapshot(ui.liveSyncGroups || null, null);
}
