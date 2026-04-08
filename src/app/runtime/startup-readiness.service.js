// [TITLE] Module: app/runtime/startup-readiness.service.js
// [TITLE] Purpose: startup readiness diagnostics snapshot service for system UI + HTTP routes
// [TITLE] Functionality Index:
// [TITLE] - capture boot-time lane snapshots for config/profiles/mods/midi/hue/wiz
// [TITLE] - compute current lane snapshots from live domain ports
// [TITLE] - expose deterministic summary counts and blocking lane hints
// [DEV] Complex Flow:
// [DEV] Boot and current snapshots are intentionally separated so operators can inspect
// [DEV] what loaded at startup versus current runtime state after retries/reloads.

function asObjectMap(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function safeRead(fn, fallback) {
  try {
    const value = fn();
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number(fallback);
  return Math.min(Number(max), Math.max(Number(min), parsed));
}

function normalizeFixtureBrand(value) {
  return String(value || "").trim().toLowerCase();
}

function getLaneStateFromCounts(loadedCount, totalCount) {
  const total = Math.max(0, Number(totalCount || 0));
  const loaded = Math.max(0, Number(loadedCount || 0));
  if (total <= 0) return "missing";
  if (loaded >= total) return "loaded";
  if (loaded > 0) return "partial";
  return "missing";
}

function isFixtureTransportConfigured(fixture = {}) {
  const brand = normalizeFixtureBrand(fixture?.brand);
  if (brand === "hue") {
    const bridgeIp = String(fixture?.bridgeIp || "").trim();
    const username = String(fixture?.username || "").trim();
    const lightId = Number(fixture?.lightId || 0);
    return Boolean(bridgeIp && username && Number.isFinite(lightId) && lightId > 0);
  }
  if (brand === "wiz") {
    return Boolean(String(fixture?.ip || "").trim());
  }
  return false;
}

function summarizeFixtureBrandLane(brand, fixturesRaw = []) {
  const brandKey = normalizeFixtureBrand(brand);
  const fixtures = Array.isArray(fixturesRaw) ? fixturesRaw : [];
  const scoped = fixtures.filter(row => normalizeFixtureBrand(row?.brand) === brandKey);
  const configured = scoped.filter(isFixtureTransportConfigured);
  const engineEnabled = scoped.filter(row => row?.engineEnabled !== false);
  const twitchEnabled = scoped.filter(row => row?.twitchEnabled !== false);
  const state = getLaneStateFromCounts(configured.length, scoped.length);
  const ready = configured.length > 0;
  const title = brandKey === "hue" ? "hue" : "wiz";
  return {
    state,
    ready,
    loaded: true,
    detail: `${configured.length}/${scoped.length} configured`,
    metrics: {
      title,
      total: scoped.length,
      configured: configured.length,
      engineEnabled: engineEnabled.length,
      twitchEnabled: twitchEnabled.length
    }
  };
}

function summarizeConfigLane(configResult = null) {
  const source = asObjectMap(configResult, {});
  const config = asObjectMap(source.config, {});
  const hasConfig = Object.keys(config).length > 0;
  return {
    state: hasConfig ? "loaded" : "missing",
    ready: hasConfig,
    loaded: source.ok === true || hasConfig,
    detail: hasConfig
      ? `autoLaunchBrowser=${config.autoLaunchBrowser !== false}, hueTransport=${String(config.hueTransportPreference || "auto")}`
      : "config unavailable",
    metrics: {
      hasConfig,
      autoLaunchBrowser: config.autoLaunchBrowser !== false,
      autoLaunchDelayMs: clampNumber(config.autoLaunchDelayMs, 0, 30000, 1200),
      hueTransportPreference: String(config.hueTransportPreference || "auto"),
      audioCaptureBackendStrategy: String(config.audioCaptureBackendStrategy || "auto_rust_first")
    }
  };
}

function summarizeProfilesLane(profilesRaw = []) {
  const profiles = Array.isArray(profilesRaw) ? profilesRaw : [];
  return {
    state: "loaded",
    ready: true,
    loaded: true,
    detail: `${profiles.length} profiles loaded`,
    metrics: {
      count: profiles.length
    }
  };
}

function summarizeMidiLane(statusRaw = null) {
  const status = asObjectMap(statusRaw, {});
  const moduleAvailable = status.moduleAvailable === true;
  const connected = status.connected === true;
  const ports = Math.max(0, Number(status.portCount || 0));
  const state = moduleAvailable ? "loaded" : "missing";
  const reason = String(status.reason || (moduleAvailable ? "midi_ready" : "midi_unavailable"));
  return {
    state,
    ready: moduleAvailable,
    loaded: true,
    detail: `module=${moduleAvailable ? "available" : "unavailable"}, connected=${connected}, ports=${ports}, reason=${reason}`,
    metrics: {
      moduleAvailable,
      connected,
      portCount: ports,
      reason
    }
  };
}

function summarizeModsLane(snapshotRaw = null, bootMeta = {}) {
  const snapshot = asObjectMap(snapshotRaw, {});
  const loaded = Math.max(0, Number(snapshot.loaded || 0));
  const total = Math.max(0, Number(snapshot.total || 0));
  const phase = String(bootMeta.phase || "").trim().toLowerCase();
  const error = String(bootMeta.error || "").trim();
  if (phase === "failed") {
    return {
      state: "failed",
      ready: false,
      loaded: true,
      detail: error || "mods boot load failed",
      metrics: {
        total,
        loaded,
        phase,
        error
      }
    };
  }
  if (phase === "pending") {
    return {
      state: "pending",
      ready: false,
      loaded: true,
      detail: `mods boot loading pending (${loaded}/${total})`,
      metrics: {
        total,
        loaded,
        phase
      }
    };
  }

  if (total === 0) {
    return {
      state: "loaded",
      ready: true,
      loaded: true,
      detail: "0/0 mods loaded (none enabled)",
      metrics: {
        total,
        loaded,
        phase: phase || "loaded"
      }
    };
  }

  const state = getLaneStateFromCounts(loaded, total);
  return {
    state,
    ready: loaded > 0,
    loaded: true,
    detail: `${loaded}/${total} mods loaded`,
    metrics: {
      total,
      loaded,
      phase: phase || "loaded"
    }
  };
}

function summarizeLanes(lanes = {}) {
  const source = asObjectMap(lanes, {});
  const keys = ["config", "profiles", "mods", "midi", "hue", "wiz"];
  let readyCount = 0;
  const blocking = [];
  const states = {};
  for (const key of keys) {
    const lane = asObjectMap(source[key], {});
    if (lane.ready === true) readyCount += 1;
    const state = String(lane.state || "missing").trim().toLowerCase() || "missing";
    states[key] = state;
    if (state !== "loaded") {
      blocking.push(key);
    }
  }
  return {
    laneCount: keys.length,
    readyCount,
    blocking,
    states
  };
}

module.exports = function createStartupReadinessService(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const services = asObjectMap(options.services, {});
  const startedAt = Number(now() || Date.now());

  const bootSnapshot = {
    config: safeRead(() => services.systemConfigService?.getConfig?.(), {}),
    profiles: safeRead(() => services.liveProfileService?.listProfiles?.(), []),
    midi: safeRead(() => services.midiManager?.getStatus?.(), {}),
    fixtures: safeRead(() => services.fixtureRegistry?.getFixtures?.(), []),
    mods: safeRead(() => services.modRuntime?.list?.(), {})
  };

  let modsBootMeta = {
    phase: "pending",
    error: "",
    updatedAt: 0
  };
  let modsBootSnapshot = asObjectMap(bootSnapshot.mods, {});

  function buildLaneSetFromSnapshot(snapshot = {}, mode = "current") {
    const source = asObjectMap(snapshot, {});
    const fixtures = Array.isArray(source.fixtures) ? source.fixtures : [];
    return {
      config: summarizeConfigLane(source.config),
      profiles: summarizeProfilesLane(source.profiles),
      mods: summarizeModsLane(source.mods, mode === "boot" ? modsBootMeta : { phase: "loaded" }),
      midi: summarizeMidiLane(source.midi),
      hue: summarizeFixtureBrandLane("hue", fixtures),
      wiz: summarizeFixtureBrandLane("wiz", fixtures)
    };
  }

  function buildCurrentSnapshot() {
    return {
      config: safeRead(() => services.systemConfigService?.getConfig?.(), {}),
      profiles: safeRead(() => services.liveProfileService?.listProfiles?.(), []),
      midi: safeRead(() => services.midiManager?.getStatus?.(), {}),
      fixtures: safeRead(() => services.fixtureRegistry?.getFixtures?.(), []),
      mods: safeRead(() => services.modRuntime?.list?.(), {})
    };
  }

  function recordModsBootLoaded(snapshot = {}) {
    modsBootMeta = {
      phase: "loaded",
      error: "",
      updatedAt: Number(now() || Date.now())
    };
    modsBootSnapshot = asObjectMap(snapshot, {});
  }

  function recordModsBootFailed(error) {
    modsBootMeta = {
      phase: "failed",
      error: String(error?.message || error || "mods_boot_load_failed"),
      updatedAt: Number(now() || Date.now())
    };
  }

  function getSnapshot() {
    const generatedAt = Number(now() || Date.now());
    const currentSnapshot = buildCurrentSnapshot();
    const bootLanes = buildLaneSetFromSnapshot({
      ...bootSnapshot,
      mods: modsBootSnapshot
    }, "boot");
    const currentLanes = buildLaneSetFromSnapshot(currentSnapshot, "current");
    return {
      ok: true,
      generatedAt,
      startedAt,
      ageMs: Math.max(0, generatedAt - startedAt),
      boot: {
        capturedAt: startedAt,
        lanes: bootLanes,
        summary: summarizeLanes(bootLanes),
        modsBootMeta: {
          phase: modsBootMeta.phase,
          error: modsBootMeta.error,
          updatedAt: Number(modsBootMeta.updatedAt || 0)
        }
      },
      current: {
        capturedAt: generatedAt,
        lanes: currentLanes,
        summary: summarizeLanes(currentLanes)
      }
    };
  }

  return {
    getSnapshot,
    recordModsBootLoaded,
    recordModsBootFailed
  };
};
