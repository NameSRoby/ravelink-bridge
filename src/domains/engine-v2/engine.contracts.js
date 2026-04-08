// [TITLE] Module: domains/engine-v2/engine.contracts.js
// [TITLE] Purpose: canonical input/output contracts for Engine v2 runtime boundaries
// [TITLE] Functionality Index:
// [TITLE] - normalize telemetry/profile/control-event input snapshots
// [TITLE] - normalize fixture-intent output packets
// [TITLE] - build stable telemetry projection payload for UI/API consumers
// [DEV] Complex Flow:
// [DEV] Engine contracts are intentionally strict and deterministic so policy/runtime
// [DEV] modules can evolve without changing route-level payload semantics.

const ENGINE_V2_TELEMETRY_VERSION = 1;
const ENGINE_V2_DEFAULT_TICK_MS = 100;
const ENGINE_V2_POLICY_ORDER = Object.freeze([
  "profile_baseline",
  "live_overrides",
  "midi_overrides",
  "mods_overlays",
  "safety_clamps",
  "twitch_overlays"
]);

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number(fallback);
  return Math.min(Number(max), Math.max(Number(min), parsed));
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  const token = String(value || "").trim().toLowerCase();
  if (!token) return Boolean(fallback);
  if (token === "true" || token === "on" || token === "yes") return true;
  if (token === "false" || token === "off" || token === "no") return false;
  return Boolean(fallback);
}

function normalizeTelemetryInput(raw = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const beats = source.beats && typeof source.beats === "object" ? source.beats : {};
  return {
    rms: clampNumber(source.rms, 0, 1, 0),
    energy: clampNumber(source.energy, 0, 1, 0),
    peak: clampNumber(source.peak, 0, 1, 0),
    flux: clampNumber(source.flux, 0, 1, 0),
    spectralFlux: clampNumber(source.spectralFlux ?? source.flux, 0, 1, 0),
    transient: clampNumber(
      source.transient ?? source.transients ?? source.peaks,
      0,
      1,
      0
    ),
    bandLow: clampNumber(source.bandLow, 0, 1, 0),
    bandMid: clampNumber(source.bandMid, 0, 1, 0),
    bandHigh: clampNumber(source.bandHigh, 0, 1, 0),
    bpm: clampNumber(source.bpm ?? beats.bpm, 0, 260, 0),
    beatConfidence: clampNumber(
      source.beatConfidence ?? beats.confidence,
      0,
      1,
      0
    ),
    beat: normalizeBoolean(source.beat, false),
    beatPulse: normalizeBoolean(source.beatPulse, false),
    updatedAt: Number(source.updatedAt || source.telemetryUpdatedAt || 0) || 0
  };
}

function normalizeControlEvent(raw = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const type = String(source.type || "").trim().toLowerCase();
  const owner = String(source.owner || source.source || "unknown")
    .trim()
    .toLowerCase() || "unknown";
  return {
    id: String(source.id || "").trim(),
    type,
    owner,
    at: Number(source.at || Date.now()) || Date.now(),
    payload: source.payload && typeof source.payload === "object" && !Array.isArray(source.payload)
      ? { ...source.payload }
      : {}
  };
}

function normalizeControlEvents(raw = []) {
  const source = Array.isArray(raw) ? raw : [];
  return source
    .map(normalizeControlEvent)
    .filter(event => Boolean(event.type));
}

function normalizeProfileState(raw = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const name = String(source.name || "default").trim() || "default";
  return {
    name,
    payload: source.payload && typeof source.payload === "object" && !Array.isArray(source.payload)
      ? { ...source.payload }
      : {}
  };
}

function normalizeFixtureCatalog(raw = []) {
  const source = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const row of source) {
    const fixture = row && typeof row === "object" && !Array.isArray(row) ? row : {};
    const fixtureId = String(fixture.id || "").trim();
    const brand = String(fixture.brand || "").trim().toLowerCase();
    if (!fixtureId || !brand) continue;
    out.push({
      id: fixtureId,
      brand,
      zone: String(fixture.zone || brand).trim().toLowerCase() || brand,
      enabled: fixture.enabled !== false
    });
  }
  return out;
}

function normalizePaletteFrameInput(raw = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const rgbSource = source.rgb && typeof source.rgb === "object" && !Array.isArray(source.rgb)
    ? source.rgb
    : null;
  return {
    index: Math.max(0, Math.round(Number(source.index || 0))),
    token: String(source.token || "").trim().toLowerCase(),
    name: String(source.name || source.token || "").trim(),
    hex: String(source.hex || "").trim().toLowerCase(),
    rgb: rgbSource ? normalizeRgbColor(rgbSource, { r: 255, g: 255, b: 255 }) : null,
    source: String(source.source || "").trim().toLowerCase(),
    count: Math.max(1, Math.round(Number(source.count || 1))),
    holdTicks: Math.max(1, Math.round(Number(source.holdTicks || 1)))
  };
}

function normalizeEngineInputSnapshot(raw = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    at: Number(source.at || Date.now()) || Date.now(),
    telemetry: normalizeTelemetryInput(source.telemetry),
    profile: normalizeProfileState(source.profile),
    controlEvents: normalizeControlEvents(source.controlEvents),
    fixtures: normalizeFixtureCatalog(source.fixtures),
    paletteFrame: normalizePaletteFrameInput(source.paletteFrame),
    transportDryRun: source.transportDryRun !== false
  };
}

function normalizeRgbColor(raw = {}, fallback = { r: 0, g: 0, b: 0 }) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    r: clampNumber(Math.round(Number(source.r)), 0, 255, fallback.r),
    g: clampNumber(Math.round(Number(source.g)), 0, 255, fallback.g),
    b: clampNumber(Math.round(Number(source.b)), 0, 255, fallback.b)
  };
}

function normalizeFixtureIntent(raw = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const fixtureId = String(source.fixtureId || "").trim();
  const brand = String(source.brand || "").trim().toLowerCase();
  if (!fixtureId || !brand) return null;
  return {
    fixtureId,
    brand,
    rgb: normalizeRgbColor(source.rgb, { r: 0, g: 0, b: 0 }),
    brightness: clampNumber(source.brightness, 0, 1, 0),
    transitionMs: clampNumber(source.transitionMs, 0, 60000, 250),
    owner: String(source.owner || "engine_v2").trim() || "engine_v2",
    scope: String(source.scope || "global").trim().toLowerCase() || "global"
  };
}

function normalizeFixtureIntents(raw = []) {
  const source = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const row of source) {
    const intent = normalizeFixtureIntent(row);
    if (!intent) continue;
    out.push(intent);
  }
  return out;
}

function buildEngineTelemetryProjection(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const status = source.status && typeof source.status === "object" ? source.status : {};
  const sceneState = source.sceneState && typeof source.sceneState === "object" ? source.sceneState : {};
  const dispatch = source.dispatch && typeof source.dispatch === "object" ? source.dispatch : {};
  return {
    engineTelemetryVersion: ENGINE_V2_TELEMETRY_VERSION,
    running: status.running === true,
    startedAt: Number(status.startedAt || 0) || 0,
    stoppedAt: Number(status.stoppedAt || 0) || 0,
    tickMs: Number(status.tickMs || ENGINE_V2_DEFAULT_TICK_MS),
    tickCount: Number(status.tickCount || 0) || 0,
    tickHz: Number(status.tickHz || 0) || 0,
    lastTickAt: Number(status.lastTickAt || 0) || 0,
    loopDurationMs: Number(status.loopDurationMs || 0) || 0,
    intentsCount: Number(status.intentsCount || 0) || 0,
    scene: {
      energy: clampNumber(sceneState.energy, 0, 1, 0),
      rms: clampNumber(sceneState.rms, 0, 1, 0),
      peak: clampNumber(sceneState.peak, 0, 1, 0),
      transient: clampNumber(sceneState.transient, 0, 1, 0),
      flux: clampNumber(sceneState.flux, 0, 1, 0),
      bandLow: clampNumber(sceneState.bandLow, 0, 1, 0),
      bandMid: clampNumber(sceneState.bandMid, 0, 1, 0),
      bandHigh: clampNumber(sceneState.bandHigh, 0, 1, 0),
      bpm: clampNumber(sceneState.bpm, 0, 260, 0),
      beatConfidence: clampNumber(sceneState.beatConfidence, 0, 1, 0),
      beatPulse: normalizeBoolean(sceneState.beatPulse, false),
      motion: clampNumber(sceneState.motion, 0, 1.4, 0),
      impactSignal: clampNumber(sceneState.impactSignal, 0, 2, 0),
      loudness: clampNumber(sceneState.loudness, 0, 1, 0),
      loudnessAdaptive: clampNumber(sceneState.loudnessAdaptive, 0, 1, 0),
      loudnessSection: clampNumber(sceneState.loudnessSection, 0, 1, 0.5),
      loudnessSectionBand: String(sceneState.loudnessSectionBand || "normal").trim().toLowerCase() || "normal",
      musicalProfile: String(sceneState.musicalProfile || "groove").trim().toLowerCase() || "groove",
      musicalDriveNorm: clampNumber(sceneState.musicalDriveNorm, 0, 1, 0),
      sceneLock: String(sceneState.sceneLock || "auto").trim().toLowerCase() || "auto",
      sceneIntent: String(sceneState.sceneIntent || "idle").trim().toLowerCase() || "idle",
      sceneCandidate: String(sceneState.sceneCandidate || "").trim().toLowerCase(),
      sceneCandidateConfidence: clampNumber(sceneState.sceneCandidateConfidence, 0, 1, 0),
      flowIntensity: clampNumber(sceneState.flowIntensity, 0, 4, 1),
      brightness: clampNumber(sceneState.brightness, 0, 1, 0),
      brightnessSourceRaw: clampNumber(sceneState.brightnessSourceRaw, 0, 1, 0),
      brightnessSourceNormalized: clampNumber(sceneState.brightnessSourceNormalized, 0, 1, 0),
      brightnessMusicalDrive: clampNumber(sceneState.brightnessMusicalDrive, 0, 1, 0),
      brightnessRangeDemand: clampNumber(sceneState.brightnessRangeDemand, 0, 1, 0),
      transitionMs: clampNumber(sceneState.transitionMs, 0, 60000, 0),
      cadenceState: sceneState.cadenceState && typeof sceneState.cadenceState === "object"
        ? { ...sceneState.cadenceState }
        : {}
    },
    dispatch: {
      sent: Number(dispatch.sent || 0) || 0,
      failed: Number(dispatch.failed || 0) || 0,
      dryRun: dispatch.dryRun !== false,
      skippedHue: Number(dispatch?.skipped?.hue || 0) || 0,
      skippedWiz: Number(dispatch?.skipped?.wiz || 0) || 0
    }
  };
}

module.exports = {
  ENGINE_V2_TELEMETRY_VERSION,
  ENGINE_V2_DEFAULT_TICK_MS,
  ENGINE_V2_POLICY_ORDER,
  clampNumber,
  normalizeBoolean,
  normalizeTelemetryInput,
  normalizeControlEvent,
  normalizeControlEvents,
  normalizeProfileState,
  normalizeFixtureCatalog,
  normalizePaletteFrameInput,
  normalizeEngineInputSnapshot,
  normalizeRgbColor,
  normalizeFixtureIntent,
  normalizeFixtureIntents,
  buildEngineTelemetryProjection
};
