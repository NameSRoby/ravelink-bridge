// [TITLE] Module: domains/engine-v2/engine.scene-bpm-state.js
// [TITLE] Purpose: stateful BPM derivation and hybrid telemetry blending for Engine v2 scenes
// [TITLE] Functionality Index:
// [TITLE] - capture derived musical pulse intervals from telemetry edges
// [TITLE] - fold derived BPM into a stable musical cadence window
// [TITLE] - blend telemetry and derived BPM sources with confidence metadata
// [DEV] The tracker is stateful by design. Keep it scoped per scene-state model
// [DEV] instance so smoothing and pulse memory never leak between engines.

const {
  clampNumber
} = require("./engine.contracts");
const {
  DEFAULT_RUNTIME_TUNING,
  normalizeBpmSourceMode
} = require("./engine.scene-runtime-controls");

function normalizeDerivedBpm(rawBpm = 0) {
  let bpm = clampNumber(rawBpm, 0, 260, 0);
  if (!(bpm > 0)) return 0;
  while (bpm > 180) bpm /= 2;
  while (bpm > 0 && bpm < 72) bpm *= 2;
  return clampNumber(Math.round(bpm), 40, 220, 0);
}

function getBpmSourceConfidence(input = {}) {
  const source = String(input.source || "none").trim().toLowerCase();
  const beatConfidence = clampNumber(input.beatConfidence, 0, 1, 0);
  const derivedConfidence = clampNumber(input.derivedConfidence, 0, 1, 0);
  const telemetryStrong = clampNumber((beatConfidence - 0.18) / 0.82, 0, 1, 0);
  if (source === "hybrid_blend") {
    return clampNumber((telemetryStrong * 0.58) + (derivedConfidence * 0.42), 0, 1, 0.62);
  }
  if (source === "hybrid_adaptive") {
    return clampNumber((telemetryStrong * 0.44) + (derivedConfidence * 0.56), 0, 1, 0.54);
  }
  if (source === "telemetry") {
    return clampNumber(0.46 + (telemetryStrong * 0.54), 0, 1, 0.7);
  }
  if (source === "telemetry_weak") {
    return clampNumber((telemetryStrong * 0.62), 0, 1, 0.28);
  }
  if (source === "derived") {
    return clampNumber(0.34 + (derivedConfidence * 0.66), 0, 1, 0.6);
  }
  return 0;
}

function createSceneBpmState() {
  let bpmSmoothed = 0;
  let pulseDriveFloorEma = 0;
  let pulseDriveCeilEma = 0;
  let pulseDrivePrevNorm = 0;
  let lastPulseAt = 0;
  const pulseIntervals = [];

  function rememberPulse(nowMs, intervalMs, maxSamples = 24) {
    if (!Number.isFinite(intervalMs)) return;
    pulseIntervals.push(intervalMs);
    while (pulseIntervals.length > maxSamples) {
      pulseIntervals.shift();
    }
    lastPulseAt = nowMs;
  }

  function maybeCaptureDerivedPulse(telemetry = {}, tuning = DEFAULT_RUNTIME_TUNING, nowMs = Date.now()) {
    const beatPulse = telemetry.beatPulse === true;
    const transient = clampNumber(Number(telemetry.transient || 0), 0, 1, 0);
    const flux = clampNumber(Number(telemetry.flux || 0), 0, 1, 0);
    const bandLow = clampNumber(Number(telemetry.bandLow || 0), 0, 1, 0);
    const beatConfidence = clampNumber(Number(telemetry.beatConfidence || 0), 0, 1, 0);
    const structuralPulse = (
      transient >= 0.11 ||
      flux >= 0.09 ||
      bandLow >= 0.2
    );
    const pulseDrive = clampNumber(
      (transient * 0.74) +
      (flux * 0.56) +
      (bandLow * 0.22) +
      (beatConfidence * 0.22) +
      (beatPulse ? 0.2 : 0),
      0,
      2,
      0
    );
    if (!(pulseDriveFloorEma > 0) && !(pulseDriveCeilEma > 0)) {
      pulseDriveFloorEma = pulseDrive;
      pulseDriveCeilEma = pulseDrive;
    } else {
      const floorRate = pulseDrive <= pulseDriveFloorEma ? 0.34 : 0.02;
      const ceilRate = pulseDrive >= pulseDriveCeilEma ? 0.28 : 0.018;
      pulseDriveFloorEma = clampNumber(
        pulseDriveFloorEma + ((pulseDrive - pulseDriveFloorEma) * floorRate),
        0,
        2,
        pulseDrive
      );
      pulseDriveCeilEma = clampNumber(
        pulseDriveCeilEma + ((pulseDrive - pulseDriveCeilEma) * ceilRate),
        0,
        2,
        pulseDrive
      );
    }
    const pulseSpan = Math.max(0.09, pulseDriveCeilEma - pulseDriveFloorEma);
    const pulseNorm = clampNumber(
      (pulseDrive - pulseDriveFloorEma) / Math.max(0.0001, pulseSpan),
      0,
      1,
      0
    );
    const pulseEdgeRaw = pulseNorm >= 0.62 && pulseDrivePrevNorm < 0.48;
    const pulseEdge = pulseEdgeRaw && (
      transient >= 0.08 ||
      flux >= 0.06 ||
      bandLow >= 0.12 ||
      beatConfidence >= 0.16
    );
    pulseDrivePrevNorm = pulseNorm;
    const impactPulseRaw = (
      (transient >= 0.72 && flux >= 0.22) ||
      (transient >= 0.9) ||
      (bandLow >= 0.46 && transient >= 0.2 && flux >= 0.14) ||
      (flux >= 0.95 && transient >= 0.12)
    );
    const impactPulse = (
      impactPulseRaw ||
      pulseEdge ||
      (pulseNorm >= 0.72 && (transient >= 0.16 || flux >= 0.14))
    );
    if (!beatPulse && !impactPulse) return false;
    if (!beatPulse && !impactPulseRaw && !structuralPulse && beatConfidence < 0.18) return false;
    if (lastPulseAt > 0) {
      const interval = nowMs - lastPulseAt;
      if (interval >= tuning.derivedBeatMinIntervalMs && interval <= tuning.derivedBeatMaxIntervalMs) {
        if (pulseIntervals.length >= 3) {
          const avgInterval = pulseIntervals.reduce((sum, row) => sum + Number(row || 0), 0) / pulseIntervals.length;
          const intervalDrift = avgInterval > 0
            ? Math.abs(interval - avgInterval) / avgInterval
            : 0;
          const weakEvidence = beatConfidence < 0.22 && transient < 0.2 && flux < 0.16;
          if (intervalDrift > 0.42 && weakEvidence) {
            return false;
          }
        }
        rememberPulse(nowMs, interval);
        return true;
      }
      if (interval < tuning.derivedBeatMinIntervalMs) {
        return false;
      }
    }
    lastPulseAt = nowMs;
    return true;
  }

  function getDerivedBpm(nowMs = Date.now(), tuning = DEFAULT_RUNTIME_TUNING) {
    const silenceWindowMs = Math.max(
      600,
      Math.round(Number(tuning.derivedBeatMaxIntervalMs || DEFAULT_RUNTIME_TUNING.derivedBeatMaxIntervalMs) * 2)
    );
    if (lastPulseAt > 0 && (Number(nowMs) - Number(lastPulseAt)) > silenceWindowMs) {
      pulseIntervals.length = 0;
      return 0;
    }
    if (pulseIntervals.length < 2) return 0;
    const total = pulseIntervals.reduce((sum, row) => sum + Number(row || 0), 0);
    const avgInterval = total > 0 ? total / pulseIntervals.length : 0;
    if (!(avgInterval > 0)) return 0;
    return clampNumber(Math.round(60000 / avgInterval), 40, 220, 0);
  }

  function getDerivedBpmConfidence(nowMs = Date.now(), tuning = DEFAULT_RUNTIME_TUNING) {
    const derivedBpm = getDerivedBpm(nowMs, tuning);
    if (!(derivedBpm > 0)) return 0;
    const maxIntervalMs = clampNumber(
      Number(tuning.derivedBeatMaxIntervalMs || DEFAULT_RUNTIME_TUNING.derivedBeatMaxIntervalMs),
      300,
      5000,
      DEFAULT_RUNTIME_TUNING.derivedBeatMaxIntervalMs
    );
    const ageMs = Math.max(0, Number(nowMs) - Number(lastPulseAt || 0));
    const recencyConfidence = clampNumber(
      1 - (ageMs / Math.max(1, maxIntervalMs * 1.5)),
      0,
      1,
      0
    );
    const sampleConfidence = clampNumber(
      (pulseIntervals.length - 1) / 8,
      0,
      1,
      0
    );
    return clampNumber(
      (sampleConfidence * 0.68) + (recencyConfidence * 0.32),
      0,
      1,
      0
    );
  }

  function resolveBpm(telemetry = {}, tuning = DEFAULT_RUNTIME_TUNING, nowMs = Date.now()) {
    const telemetryBpm = clampNumber(telemetry.bpm, 0, 260, 0);
    const beatConfidence = clampNumber(telemetry.beatConfidence, 0, 1, 0);
    const derivedBpm = normalizeDerivedBpm(getDerivedBpm(nowMs, tuning));
    const derivedConfidence = getDerivedBpmConfidence(nowMs, tuning);
    const mode = normalizeBpmSourceMode(tuning.bpmSourceMode, DEFAULT_RUNTIME_TUNING.bpmSourceMode);

    let raw = 0;
    let source = "none";
    if (mode === "telemetry") {
      raw = telemetryBpm;
      source = telemetryBpm > 0 ? "telemetry" : "none";
    } else if (mode === "derived") {
      raw = derivedBpm;
      source = derivedBpm > 0 ? "derived" : "none";
    } else {
      const telemetryTrusted = telemetryBpm > 0 && beatConfidence >= tuning.telemetryBeatConfidenceMin;
      if (telemetryBpm > 0 && derivedBpm > 0) {
        const distance = Math.abs(telemetryBpm - derivedBpm);
        let telemetryWeight = clampNumber(0.35 + (beatConfidence * 0.5), 0.2, 0.86, 0.48);
        if (distance >= 40) {
          telemetryWeight += telemetryTrusted ? 0.08 : -0.12;
        }
        if (distance >= 70) {
          telemetryWeight += telemetryTrusted ? 0.08 : -0.16;
        }
        telemetryWeight = clampNumber(telemetryWeight, 0.12, 0.9, telemetryWeight);
        raw = Math.round((telemetryBpm * telemetryWeight) + (derivedBpm * (1 - telemetryWeight)));
        source = telemetryTrusted ? "hybrid_blend" : "hybrid_adaptive";
      } else if (telemetryTrusted) {
        raw = telemetryBpm;
        source = "telemetry";
      } else if (telemetryBpm > 0) {
        raw = telemetryBpm;
        source = "telemetry_weak";
      } else if (derivedBpm > 0) {
        raw = derivedBpm;
        source = "derived";
      }
    }

    const clamped = clampNumber(raw, 0, 260, 0);
    if (clamped > 0 && bpmSmoothed > 0) {
      bpmSmoothed = Math.round((bpmSmoothed * 0.7) + (clamped * 0.3));
    } else if (clamped > 0) {
      bpmSmoothed = clamped;
    } else {
      bpmSmoothed = clampNumber(bpmSmoothed * 0.92, 0, 260, 0);
      if (bpmSmoothed < 1) bpmSmoothed = 0;
    }
    return {
      bpm: clampNumber(bpmSmoothed, 0, 260, 0),
      source,
      telemetryBpm,
      derivedBpm,
      confidence: getBpmSourceConfidence({
        source,
        beatConfidence,
        derivedConfidence
      })
    };
  }

  return {
    getDerivedBpm,
    getDerivedBpmConfidence,
    maybeCaptureDerivedPulse,
    resolveBpm
  };
}

module.exports = {
  createSceneBpmState,
  getBpmSourceConfidence,
  normalizeDerivedBpm
};
