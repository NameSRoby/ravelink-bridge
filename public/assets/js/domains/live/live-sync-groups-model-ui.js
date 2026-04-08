// [TITLE] Module: public/assets/js/domains/live/live-sync-groups-model-ui.js
// [TITLE] Purpose: normalize and derive LIVE sync-group state outside control wiring
// [TITLE] Functionality Index:
// [TITLE] - sync-group/group-id/remove-behavior normalization
// [TITLE] - fixture assignment + engine control map derivation
// [TITLE] - selection/catalog helpers used by the controls runtime
// [DEV] Complex Flow:
// [DEV] This model layer intentionally centralizes sync-group normalization so
// [DEV] controls, profile persistence, and future backend convergence share one shape.

function createLiveSyncGroupsModelUi(deps = {}) {
  const ui = deps.ui || {};
  const clampNumberFn = typeof deps.clampNumber === "function" ? deps.clampNumber : null;
  const escapeHtmlFn = typeof deps.escapeHtml === "function" ? deps.escapeHtml : null;

  const LIVE_SYNC_GROUPS_DEFAULT_UI = Object.freeze({
    enabled: false,
    groups: Object.freeze([]),
    fixtureEngine: Object.freeze({}),
    updatedAt: 0
  });
  const LIVE_SYNC_GROUP_MODE_SET_UI = new Set(["sync", "reverse", "offset"]);
  const LIVE_SYNC_REMOVE_BEHAVIOR_SET_UI = new Set(["custom_state", "keep_current", "blackout"]);
  const LIVE_SYNC_REMOVE_BEHAVIOR_DEFAULT_UI = "keep_current";
  const LIVE_SYNC_CUSTOM_FALLBACK_DEFAULT_UI = Object.freeze({
    mode: "hex",
    hex: "#ffffff",
    cct: 4000,
    brightness: 100
  });
  const LIVE_SYNC_GROUP_MAX_UI = 24;
  const LIVE_SYNC_GROUP_NONE_ID_UI = "__none__";

  function clampLiveSyncNumberUi(value, min, max, fallback) {
    if (clampNumberFn) {
      return clampNumberFn(value, min, max, fallback);
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return Number(fallback);
    return Math.min(Number(max), Math.max(Number(min), parsed));
  }

  function escapeLiveSyncHtmlUi(value) {
    if (escapeHtmlFn) return escapeHtmlFn(value);
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeLiveSyncBoolUi(value, fallback = false) {
    if (typeof value === "boolean") return value;
    if (value === 1 || value === "1") return true;
    if (value === 0 || value === "0") return false;
    const token = String(value || "").trim().toLowerCase();
    if (!token) return fallback === true;
    if (token === "true" || token === "on" || token === "yes") return true;
    if (token === "false" || token === "off" || token === "no") return false;
    return fallback === true;
  }

  function normalizeLiveSyncGroupIdUi(value, fallback = "") {
    const token = String(value || "").trim().toLowerCase();
    const safe = token.replace(/[^a-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
    if (safe) return safe;
    const fb = String(fallback || "").trim().toLowerCase();
    return fb.replace(/[^a-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  }

  function normalizeLiveSyncGroupModeUi(value, fallback = "sync") {
    const token = String(value || "").trim().toLowerCase();
    if (token === "mirror") return "reverse";
    if (LIVE_SYNC_GROUP_MODE_SET_UI.has(token)) return token;
    const fallbackToken = String(fallback || "").trim().toLowerCase();
    if (fallbackToken === "mirror") return "reverse";
    return LIVE_SYNC_GROUP_MODE_SET_UI.has(fallbackToken) ? fallbackToken : "sync";
  }

  function normalizeLiveSyncGroupNameUi(value, fallback = "GROUP") {
    const raw = String(value || "").replace(/\s+/g, " ").trim();
    if (raw) return raw.slice(0, 48);
    return String(fallback || "GROUP").replace(/\s+/g, " ").trim().slice(0, 48) || "GROUP";
  }

  function normalizeLiveSyncFixtureIdsUi(value = [], fallback = []) {
    const source = Array.isArray(value) ? value : (Array.isArray(fallback) ? fallback : []);
    const out = [];
    const seen = new Set();
    for (const row of source) {
      const fixtureId = String(row || "").trim();
      if (!fixtureId) continue;
      if (seen.has(fixtureId)) continue;
      seen.add(fixtureId);
      out.push(fixtureId);
      if (out.length >= 4096) break;
    }
    return out;
  }

  function normalizeLiveSyncRemoveBehaviorUi(value, fallback = LIVE_SYNC_REMOVE_BEHAVIOR_DEFAULT_UI) {
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
    if (LIVE_SYNC_REMOVE_BEHAVIOR_SET_UI.has(token)) return token;
    const fallbackToken = String(fallback || "").trim().toLowerCase();
    if (LIVE_SYNC_REMOVE_BEHAVIOR_SET_UI.has(fallbackToken)) return fallbackToken;
    return LIVE_SYNC_REMOVE_BEHAVIOR_DEFAULT_UI;
  }

  function normalizeLiveSyncHexColorUi(value, fallback = "#ffffff") {
    const token = String(value || "").trim().toLowerCase();
    if (/^#?[0-9a-f]{6}$/i.test(token)) {
      return token.startsWith("#") ? token : `#${token}`;
    }
    const fb = String(fallback || "").trim().toLowerCase();
    if (/^#?[0-9a-f]{6}$/i.test(fb)) {
      return fb.startsWith("#") ? fb : `#${fb}`;
    }
    return "#ffffff";
  }

  function normalizeLiveSyncCustomFallbackModeUi(value, fallback = "hex") {
    const token = String(value || "").trim().toLowerCase();
    if (token === "cct" || token === "white" || token === "kelvin" || token === "temp" || token === "temperature") {
      return "cct";
    }
    if (token === "hex" || token === "rgb" || token === "color") {
      return "hex";
    }
    const fallbackToken = String(fallback || "").trim().toLowerCase();
    if (fallbackToken === "cct" || fallbackToken === "white" || fallbackToken === "kelvin" || fallbackToken === "temp") {
      return "cct";
    }
    return "hex";
  }

  function normalizeLiveSyncCustomFallbackUi(value = {}, fallback = LIVE_SYNC_CUSTOM_FALLBACK_DEFAULT_UI) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const fb = fallback && typeof fallback === "object" && !Array.isArray(fallback)
      ? fallback
      : LIVE_SYNC_CUSTOM_FALLBACK_DEFAULT_UI;
    const mode = normalizeLiveSyncCustomFallbackModeUi(
      source.mode ?? source.type,
      normalizeLiveSyncCustomFallbackModeUi(fb.mode, LIVE_SYNC_CUSTOM_FALLBACK_DEFAULT_UI.mode)
    );
    return {
      mode,
      hex: normalizeLiveSyncHexColorUi(
        source.hex ?? source.color ?? source.colorHex ?? source.value,
        normalizeLiveSyncHexColorUi(fb.hex, LIVE_SYNC_CUSTOM_FALLBACK_DEFAULT_UI.hex)
      ),
      cct: clampLiveSyncNumberUi(
        Math.round(Number(source.cct ?? source.kelvin ?? source.temp)),
        2000,
        6500,
        clampLiveSyncNumberUi(
          Math.round(Number(fb.cct)),
          2000,
          6500,
          LIVE_SYNC_CUSTOM_FALLBACK_DEFAULT_UI.cct
        )
      ),
      brightness: clampLiveSyncNumberUi(
        Math.round(Number(source.brightness ?? source.level ?? source.dimming)),
        1,
        100,
        clampLiveSyncNumberUi(
          Math.round(Number(fb.brightness)),
          1,
          100,
          LIVE_SYNC_CUSTOM_FALLBACK_DEFAULT_UI.brightness
        )
      )
    };
  }

  function normalizeLiveSyncFixtureEngineMapUi(value = {}, fallback = {}) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const fb = fallback && typeof fallback === "object" && !Array.isArray(fallback) ? fallback : {};
    const rows = [];
    for (const [rawFixtureId, row] of Object.entries(source)) {
      const sourceRow = row && typeof row === "object" && !Array.isArray(row) ? row : {};
      const fallbackRow = fb?.[rawFixtureId] && typeof fb[rawFixtureId] === "object" && !Array.isArray(fb[rawFixtureId])
        ? fb[rawFixtureId]
        : {};
      const fixtureId = String(sourceRow.fixtureId || sourceRow.id || rawFixtureId || "").trim();
      if (!fixtureId) continue;
      rows.push({
        fixtureId,
        excluded: normalizeLiveSyncBoolUi(
          sourceRow.excluded ?? sourceRow.removed ?? sourceRow.disabled,
          normalizeLiveSyncBoolUi(fallbackRow.excluded ?? fallbackRow.removed ?? fallbackRow.disabled, false)
        ),
        removeBehavior: normalizeLiveSyncRemoveBehaviorUi(
          sourceRow.removeBehavior ?? sourceRow.onRemove ?? sourceRow.behavior,
          normalizeLiveSyncRemoveBehaviorUi(
            fallbackRow.removeBehavior ?? fallbackRow.onRemove ?? fallbackRow.behavior,
            LIVE_SYNC_REMOVE_BEHAVIOR_DEFAULT_UI
          )
        ),
        customFallback: normalizeLiveSyncCustomFallbackUi(
          sourceRow.customFallback ?? sourceRow.customState ?? sourceRow.fallback,
          normalizeLiveSyncCustomFallbackUi(
            fallbackRow.customFallback ?? fallbackRow.customState ?? fallbackRow.fallback,
            LIVE_SYNC_CUSTOM_FALLBACK_DEFAULT_UI
          )
        ),
        updatedAt: Number(sourceRow.updatedAt || 0)
      });
    }
    rows.sort((a, b) => String(a.fixtureId).localeCompare(String(b.fixtureId)));
    const out = {};
    for (const row of rows.slice(0, 4096)) {
      out[row.fixtureId] = {
        excluded: row.excluded === true,
        removeBehavior: row.removeBehavior,
        customFallback: normalizeLiveSyncCustomFallbackUi(
          row.customFallback,
          LIVE_SYNC_CUSTOM_FALLBACK_DEFAULT_UI
        ),
        updatedAt: row.updatedAt
      };
    }
    return out;
  }

  function normalizeLiveSyncGroupEntryUi(value = {}, fallback = {}, index = 0) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const fb = fallback && typeof fallback === "object" && !Array.isArray(fallback) ? fallback : {};
    const id = normalizeLiveSyncGroupIdUi(
      source.id,
      normalizeLiveSyncGroupIdUi(fb.id, `group-${index + 1}`)
    ) || `group-${index + 1}`;
    return {
      id,
      name: normalizeLiveSyncGroupNameUi(
        source.name,
        normalizeLiveSyncGroupNameUi(fb.name, `GROUP ${index + 1}`)
      ),
      sequenceMode: normalizeLiveSyncGroupModeUi(
        source.sequenceMode,
        normalizeLiveSyncGroupModeUi(fb.sequenceMode, "sync")
      ),
      phaseOffset: clampLiveSyncNumberUi(
        Math.round(Number(source.phaseOffset)),
        -64,
        64,
        clampLiveSyncNumberUi(Math.round(Number(fb.phaseOffset)), -64, 64, 0)
      ),
      fixtureIds: normalizeLiveSyncFixtureIdsUi(source.fixtureIds, fb.fixtureIds),
      updatedAt: Number(source.updatedAt || 0)
    };
  }

  function normalizeLiveSyncGroupsUi(value = {}, fallback = LIVE_SYNC_GROUPS_DEFAULT_UI) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const fb = fallback && typeof fallback === "object" && !Array.isArray(fallback)
      ? fallback
      : LIVE_SYNC_GROUPS_DEFAULT_UI;
    const groupsRaw = Array.isArray(source.groups)
      ? source.groups
      : (Array.isArray(fb.groups) ? fb.groups : []);
    const groups = [];
    const seenGroupIds = new Set();
    const seenFixtureIds = new Set();
    for (let i = 0; i < groupsRaw.length && groups.length < LIVE_SYNC_GROUP_MAX_UI; i += 1) {
      const normalized = normalizeLiveSyncGroupEntryUi(groupsRaw[i], fb.groups?.[i], groups.length);
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
      groups.push({
        ...normalized,
        id,
        fixtureIds
      });
    }
    return {
      enabled: normalizeLiveSyncBoolUi(source.enabled, normalizeLiveSyncBoolUi(fb.enabled, false)),
      groups,
      fixtureEngine: normalizeLiveSyncFixtureEngineMapUi(
        Object.prototype.hasOwnProperty.call(source, "fixtureEngine")
          ? source.fixtureEngine
          : fb.fixtureEngine,
        fb.fixtureEngine
      ),
      updatedAt: Number(source.updatedAt || fb.updatedAt || 0)
    };
  }

  function cloneLiveSyncGroupsUi(value = LIVE_SYNC_GROUPS_DEFAULT_UI) {
    const normalized = normalizeLiveSyncGroupsUi(value, LIVE_SYNC_GROUPS_DEFAULT_UI);
    return {
      enabled: normalized.enabled === true,
      groups: normalized.groups.map(group => ({
        id: group.id,
        name: group.name,
        sequenceMode: group.sequenceMode,
        phaseOffset: Number(group.phaseOffset || 0),
        fixtureIds: normalizeLiveSyncFixtureIdsUi(group.fixtureIds),
        updatedAt: Number(group.updatedAt || 0)
      })),
      fixtureEngine: normalizeLiveSyncFixtureEngineMapUi(normalized.fixtureEngine, {}),
      updatedAt: Number(normalized.updatedAt || 0)
    };
  }

  function resolveLiveSyncFixtureCatalogUi() {
    const source = Array.isArray(ui.fixturesCatalog) ? ui.fixturesCatalog : [];
    return source
      .map(row => ({
        id: String(row?.id || "").trim(),
        brand: String(row?.brand || "").trim().toLowerCase(),
        zone: String(row?.zone || "").trim().toLowerCase(),
        enabled: row?.enabled !== false
      }))
      .filter(row => Boolean(row.id) && Boolean(row.brand))
      .sort((a, b) => {
        const brandCmp = String(a.brand).localeCompare(String(b.brand));
        if (brandCmp !== 0) return brandCmp;
        return String(a.id).localeCompare(String(b.id));
      });
  }

  function buildLiveSyncFixtureAssignmentMapUi(syncGroups = ui.liveSyncGroups) {
    const source = normalizeLiveSyncGroupsUi(syncGroups, LIVE_SYNC_GROUPS_DEFAULT_UI);
    const map = new Map();
    for (const group of source.groups) {
      for (const fixtureId of group.fixtureIds) {
        if (map.has(fixtureId)) continue;
        map.set(fixtureId, group.id);
      }
    }
    return map;
  }

  function buildLiveSyncFixtureEngineControlMapUi(syncGroups = ui.liveSyncGroups) {
    const source = normalizeLiveSyncGroupsUi(syncGroups, LIVE_SYNC_GROUPS_DEFAULT_UI);
    const raw = source.fixtureEngine && typeof source.fixtureEngine === "object" && !Array.isArray(source.fixtureEngine)
      ? source.fixtureEngine
      : {};
    const map = new Map();
    for (const [fixtureIdRaw, row] of Object.entries(raw)) {
      const fixtureId = String(fixtureIdRaw || "").trim();
      if (!fixtureId) continue;
      const control = row && typeof row === "object" && !Array.isArray(row) ? row : {};
      map.set(fixtureId, {
        excluded: normalizeLiveSyncBoolUi(control.excluded ?? control.removed ?? control.disabled, false),
        removeBehavior: normalizeLiveSyncRemoveBehaviorUi(
          control.removeBehavior ?? control.onRemove ?? control.behavior,
          LIVE_SYNC_REMOVE_BEHAVIOR_DEFAULT_UI
        ),
        customFallback: normalizeLiveSyncCustomFallbackUi(
          control.customFallback ?? control.customState ?? control.fallback,
          LIVE_SYNC_CUSTOM_FALLBACK_DEFAULT_UI
        ),
        updatedAt: Number(control.updatedAt || 0)
      });
    }
    return map;
  }

  function resolveLiveSyncSelectedGroupUi(syncGroups = ui.liveSyncGroups) {
    const source = normalizeLiveSyncGroupsUi(syncGroups, LIVE_SYNC_GROUPS_DEFAULT_UI);
    const selectedId = normalizeLiveSyncGroupIdUi(ui.liveSyncGroupSelectedId, "");
    const selected = source.groups.find(group => group.id === selectedId) || null;
    if (selected) return selected;
    return source.groups[0] || null;
  }

  function createLiveSyncNextGroupIdUi(existingGroups = []) {
    const existing = new Set(existingGroups.map(group => normalizeLiveSyncGroupIdUi(group?.id, "")).filter(Boolean));
    let index = Math.max(1, existingGroups.length + 1);
    let id = `group-${index}`;
    while (existing.has(id)) {
      index += 1;
      id = `group-${index}`;
    }
    return id;
  }

  return {
    LIVE_SYNC_GROUPS_DEFAULT_UI,
    LIVE_SYNC_REMOVE_BEHAVIOR_DEFAULT_UI,
    LIVE_SYNC_CUSTOM_FALLBACK_DEFAULT_UI,
    LIVE_SYNC_GROUP_MAX_UI,
    LIVE_SYNC_GROUP_NONE_ID_UI,
    clampLiveSyncNumberUi,
    escapeLiveSyncHtmlUi,
    normalizeLiveSyncBoolUi,
    normalizeLiveSyncGroupIdUi,
    normalizeLiveSyncGroupModeUi,
    normalizeLiveSyncGroupNameUi,
    normalizeLiveSyncFixtureIdsUi,
    normalizeLiveSyncRemoveBehaviorUi,
    normalizeLiveSyncHexColorUi,
    normalizeLiveSyncCustomFallbackModeUi,
    normalizeLiveSyncCustomFallbackUi,
    normalizeLiveSyncFixtureEngineMapUi,
    normalizeLiveSyncGroupEntryUi,
    normalizeLiveSyncGroupsUi,
    cloneLiveSyncGroupsUi,
    resolveLiveSyncFixtureCatalogUi,
    buildLiveSyncFixtureAssignmentMapUi,
    buildLiveSyncFixtureEngineControlMapUi,
    resolveLiveSyncSelectedGroupUi,
    createLiveSyncNextGroupIdUi
  };
}
