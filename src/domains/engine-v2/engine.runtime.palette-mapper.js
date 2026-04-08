// [TITLE] Module: domains/engine-v2/engine.runtime.palette-mapper.js
// [TITLE] Purpose: musical palette mapping and transport-clock support for engine runtime
// [TITLE] Functionality Index:
// [TITLE] - maintain musical transport-clock phase from BPM + pulse hints
// [TITLE] - map palette sequences in strict or musical mode
// [TITLE] - smooth musical palette color motion deterministically across ticks

function stepCircularToward(current = 0, target = 0, count = 1, maxStep = 1) {
  const n = Math.max(1, Math.round(Number(count || 1)));
  if (n <= 1) return 0;
  const from = ((Math.round(Number(current || 0)) % n) + n) % n;
  const to = ((Math.round(Number(target || 0)) % n) + n) % n;
  if (from === to) return from;
  const clockwise = (to - from + n) % n;
  const counter = (from - to + n) % n;
  const step = Math.max(1, Math.round(Number(maxStep || 1)));
  if (clockwise <= counter) {
    return (from + Math.min(step, clockwise)) % n;
  }
  return (from - Math.min(step, counter) + n) % n;
}

function getCircularDistance(current = 0, target = 0, count = 1) {
  const n = Math.max(1, Math.round(Number(count || 1)));
  if (n <= 1) return 0;
  const from = ((Math.round(Number(current || 0)) % n) + n) % n;
  const to = ((Math.round(Number(target || 0)) % n) + n) % n;
  const clockwise = (to - from + n) % n;
  const counter = (from - to + n) % n;
  return Math.min(clockwise, counter);
}

module.exports = function createEngineRuntimePaletteMapper(options = {}) {
  const clampNumber = typeof options.clampNumber === "function"
    ? options.clampNumber
    : (value => Number(value) || 0);
  const paletteService = options.paletteService;
  const paletteMapperMode = String(options.paletteMapperMode || "strict").trim().toLowerCase() || "strict";
  const getAppliedCadenceHz = typeof options.getAppliedCadenceHz === "function"
    ? options.getAppliedCadenceHz
    : (() => 6);

  let musicalPaletteCursor = 0;
  let musicalPaletteLastKickAt = 0;
  let musicalPaletteSmoothedRgb = null;
  let musicalPaletteSmoothedCount = 0;
  let musicalPaletteCentroidEma = 0.5;
  let musicalPaletteLastTargetIndex = 0;
  let musicalTransportPhase = 0;
  let musicalTransportBpm = 120;
  let musicalTransportLastAt = 0;
  let musicalTransportSubIndex = -1;

  function resolveMusicalPaletteFrame(baseFrame = {}, audioTelemetry = {}, tickAt = Date.now(), context = {}) {
    const base = baseFrame && typeof baseFrame === "object" ? baseFrame : {};
    const contextMap = context && typeof context === "object" ? context : {};
    const sceneHint = String(contextMap.sceneHint || "steady").trim().toLowerCase() || "steady";
    const profileHint = String(contextMap.profileHint || "groove").trim().toLowerCase() || "groove";
    const driveNorm = clampNumber(Number(contextMap.driveNorm), 0, 1, 0.46);
    const transportClock = contextMap.transportClock && typeof contextMap.transportClock === "object"
      ? contextMap.transportClock
      : {};
    const snapshot = typeof paletteService?.getSnapshot === "function"
      ? paletteService.getSnapshot()
      : null;
    const resolvedSequence = Array.isArray(snapshot?.resolvedSequence)
      ? snapshot.resolvedSequence
      : [];
    const count = Math.max(
      1,
      Math.round(Number(resolvedSequence.length || base.count || 1))
    );
    if (count <= 1 || resolvedSequence.length < 2) {
      musicalPaletteCursor = Math.max(
        0,
        Math.min(count - 1, Math.round(Number(base.index || 0)))
      );
      musicalPaletteLastTargetIndex = musicalPaletteCursor;
      musicalPaletteCentroidEma = 0.5;
      return {
        ...base,
        count
      };
    }

    const baseIndex = ((Math.round(Number(base.index || 0)) % count) + count) % count;
    if (!(musicalPaletteCursor >= 0 && musicalPaletteCursor < count)) {
      musicalPaletteCursor = baseIndex;
    }

    const bandLow = clampNumber(Number(audioTelemetry?.bandLow), 0, 1, 0);
    const bandMid = clampNumber(Number(audioTelemetry?.bandMid), 0, 1, 0);
    const bandHigh = clampNumber(Number(audioTelemetry?.bandHigh), 0, 1, 0);
    const transient = clampNumber(Number(audioTelemetry?.transient), 0, 1, 0);
    const flux = clampNumber(Number(audioTelemetry?.flux), 0, 1, 0);
    const beatConfidence = clampNumber(Number(audioTelemetry?.beatConfidence), 0, 1, 0);
    const beatPulse = audioTelemetry?.beatPulse === true;
    const spectralSpread = clampNumber(Math.abs(bandHigh - bandLow), 0, 1, 0);
    const movement = clampNumber(
      (transient * 0.72) + (flux * 0.58) + (beatConfidence * 0.35) + (spectralSpread * 0.22),
      0,
      2,
      0
    );

    const bandTotal = bandLow + bandMid + bandHigh;
    const centroidRaw = bandTotal > 0.0001
      ? clampNumber(
        ((bandLow * 0.14) + (bandMid * 0.52) + (bandHigh * 0.88)) / bandTotal,
        0,
        1,
        0.5
      )
      : 0.5;
    const centroidAlpha = clampNumber(
      0.1 + (movement * 0.12) + (beatPulse ? 0.08 : 0),
      0.08,
      0.48,
      0.2
    );
    if (!(musicalPaletteCentroidEma >= 0 && musicalPaletteCentroidEma <= 1)) {
      musicalPaletteCentroidEma = centroidRaw;
    } else {
      musicalPaletteCentroidEma = clampNumber(
        musicalPaletteCentroidEma + ((centroidRaw - musicalPaletteCentroidEma) * centroidAlpha),
        0,
        1,
        centroidRaw
      );
    }
    const centroidTargetIndex = clampNumber(
      Math.round(musicalPaletteCentroidEma * Math.max(0, count - 1)),
      0,
      Math.max(0, count - 1),
      0
    );
    const subdivision = clampNumber(
      Math.round(Number(transportClock.subdivision || 1)),
      1,
      8,
      1
    );
    const transportSubIndex = clampNumber(
      Math.round(Number(transportClock.subIndex || 0)),
      0,
      Math.max(0, subdivision - 1),
      0
    );
    const direction = bandLow > Math.max(bandMid, bandHigh) ? -1 : 1;
    const sceneStyle = sceneHint === "impact"
      ? "impact"
      : (sceneHint === "motion" ? "motion" : "steady");
    const subSpan = Math.max(1, subdivision - 1);
    const normalizedSubPhase = subSpan > 0
      ? (((transportSubIndex / subSpan) * 2) - 1)
      : 0;
    let phaseOffset = 0;
    if (sceneStyle === "motion") {
      phaseOffset = direction * transportSubIndex;
    } else if (sceneStyle === "impact") {
      const impactAmplitude = clampNumber(
        Math.round(1 + (driveNorm * 2)),
        1,
        3,
        2
      );
      phaseOffset = Math.round(normalizedSubPhase * impactAmplitude);
      if (beatPulse) {
        phaseOffset += direction * Math.max(1, impactAmplitude - 1);
      }
    }
    let targetIndex = (centroidTargetIndex + phaseOffset + count) % count;
    if (!(musicalPaletteLastTargetIndex >= 0 && musicalPaletteLastTargetIndex < count)) {
      musicalPaletteLastTargetIndex = targetIndex;
    }
    const targetDrift = getCircularDistance(musicalPaletteLastTargetIndex, targetIndex, count);
    if (movement < 0.12 && !beatPulse && targetDrift <= 1) {
      targetIndex = musicalPaletteLastTargetIndex;
    } else {
      musicalPaletteLastTargetIndex = targetIndex;
    }

    const profileStepBias = profileHint === "calm"
      ? -1
      : (profileHint === "aggressive" ? 1 : 0);
    const driveStepBase = driveNorm >= 0.82
      ? 4
      : (driveNorm >= 0.58 ? 3 : (driveNorm >= 0.3 ? 2 : 1));
    const movementStepBias = movement >= 1.02 ? 1 : 0;
    const maxStepBase = clampNumber(
      driveStepBase + profileStepBias + movementStepBias,
      1,
      4,
      2
    );
    const maxStep = beatPulse ? Math.min(4, maxStepBase + 1) : maxStepBase;
    const targetDistance = getCircularDistance(musicalPaletteCursor, targetIndex, count);
    const shouldStep = !(movement < 0.06 && !beatPulse && targetDistance <= 1);
    if (shouldStep) {
      musicalPaletteCursor = stepCircularToward(
        musicalPaletteCursor,
        targetIndex,
        count,
        maxStep
      );
    }

    const kickMovement = clampNumber(
      movement + (beatConfidence * 0.22),
      0,
      1.8,
      0
    );

    const kickIntervalBaseMs = profileHint === "calm"
      ? 136
      : (profileHint === "aggressive" ? 88 : 108);
    const kickMinIntervalMs = clampNumber(
      Math.round(kickIntervalBaseMs + ((0.5 - driveNorm) * 34)),
      72,
      172,
      kickIntervalBaseMs
    );
    if (beatPulse === true && ((tickAt - musicalPaletteLastKickAt) >= kickMinIntervalMs)) {
      const kickDirection = sceneStyle === "steady"
        ? (bandMid >= Math.max(bandLow, bandHigh) ? 1 : direction)
        : direction;
      const kickStepBase = driveNorm >= 0.78
        ? 3
        : (driveNorm >= 0.48 ? 2 : 1);
      const kickStep = kickMovement >= 0.86
        ? Math.min(4, kickStepBase + 1)
        : kickStepBase;
      if (kickStep > 0) {
        musicalPaletteCursor = (
          musicalPaletteCursor + (kickDirection * kickStep) + count
        ) % count;
        musicalPaletteLastKickAt = tickAt;
      }
    }

    const resolved = resolvedSequence[musicalPaletteCursor] || resolvedSequence[baseIndex] || null;
    if (!resolved) {
      return {
        ...base,
        count
      };
    }
    return {
      ...base,
      index: musicalPaletteCursor,
      token: String(resolved.token || base.token || ""),
      name: String(resolved.name || base.name || ""),
      hex: String(resolved.hex || base.hex || ""),
      rgb: resolved.rgb && typeof resolved.rgb === "object"
        ? {
          r: clampNumber(Math.round(Number(resolved.rgb.r)), 0, 255, 0),
          g: clampNumber(Math.round(Number(resolved.rgb.g)), 0, 255, 0),
          b: clampNumber(Math.round(Number(resolved.rgb.b)), 0, 255, 0)
        }
        : { ...base.rgb },
      source: "musical_palette_mapper_v2",
      count
    };
  }

  function smoothMusicalPaletteFrame(frame = {}, audioTelemetry = {}, context = {}) {
    const source = frame && typeof frame === "object" ? frame : {};
    const contextMap = context && typeof context === "object" ? context : {};
    const profileHint = String(contextMap.profileHint || "groove").trim().toLowerCase() || "groove";
    const driveNorm = clampNumber(Number(contextMap.driveNorm), 0, 1, 0.46);
    const count = Math.max(1, Math.round(Number(source.count || 1)));
    const rgb = source.rgb && typeof source.rgb === "object"
      ? {
        r: clampNumber(Math.round(Number(source.rgb.r)), 0, 255, 0),
        g: clampNumber(Math.round(Number(source.rgb.g)), 0, 255, 0),
        b: clampNumber(Math.round(Number(source.rgb.b)), 0, 255, 0)
      }
      : null;
    if (!rgb) return { ...source };

    if (!musicalPaletteSmoothedRgb || musicalPaletteSmoothedCount !== count) {
      musicalPaletteSmoothedRgb = { ...rgb };
      musicalPaletteSmoothedCount = count;
      return {
        ...source,
        rgb: { ...musicalPaletteSmoothedRgb },
        source: `${String(source.source || "palette").trim() || "palette"}:smoothed`
      };
    }

    const transient = clampNumber(Number(audioTelemetry?.transient), 0, 1, 0);
    const flux = clampNumber(Number(audioTelemetry?.flux), 0, 1, 0);
    const beatConfidence = clampNumber(Number(audioTelemetry?.beatConfidence), 0, 1, 0);
    const beatPulse = contextMap.beatPulse === true || audioTelemetry?.beatPulse === true;
    const cadenceHz = clampNumber(
      Number(getAppliedCadenceHz()),
      1,
      20,
      6
    );
    const cadenceNorm = clampNumber((cadenceHz - 2) / 10, 0, 1, 0.4);
    const movement = clampNumber(
      (transient * 0.72) + (flux * 0.58) + (beatConfidence * 0.35),
      0,
      1.8,
      0
    );
    let alpha = clampNumber(
      0.12 + (movement * 0.2) + (cadenceNorm * 0.08) + (driveNorm * 0.1) + (beatPulse ? 0.16 : 0),
      0.1,
      0.72,
      0.24
    );
    if (profileHint === "aggressive") {
      alpha = Math.max(alpha, beatPulse ? 0.68 : 0.38);
    } else if (profileHint === "calm") {
      alpha = Math.min(alpha, beatPulse ? 0.46 : 0.32);
    }
    const colorDistance = clampNumber(
      (
        Math.abs(Number(rgb.r) - Number(musicalPaletteSmoothedRgb.r)) +
        Math.abs(Number(rgb.g) - Number(musicalPaletteSmoothedRgb.g)) +
        Math.abs(Number(rgb.b) - Number(musicalPaletteSmoothedRgb.b))
      ) / 765,
      0,
      1,
      0
    );
    if (colorDistance >= 0.42 && movement >= 0.42) {
      alpha = Math.max(alpha, 0.42 + (beatPulse ? 0.2 : 0));
    }
    alpha = clampNumber(alpha, 0.1, 0.92, 0.24);
    const next = {
      r: musicalPaletteSmoothedRgb.r + ((rgb.r - musicalPaletteSmoothedRgb.r) * alpha),
      g: musicalPaletteSmoothedRgb.g + ((rgb.g - musicalPaletteSmoothedRgb.g) * alpha),
      b: musicalPaletteSmoothedRgb.b + ((rgb.b - musicalPaletteSmoothedRgb.b) * alpha)
    };
    const quantized = {
      r: clampNumber(Math.round(next.r), 0, 255, rgb.r),
      g: clampNumber(Math.round(next.g), 0, 255, rgb.g),
      b: clampNumber(Math.round(next.b), 0, 255, rgb.b)
    };
    if (Math.abs(quantized.r - rgb.r) <= 1) quantized.r = rgb.r;
    if (Math.abs(quantized.g - rgb.g) <= 1) quantized.g = rgb.g;
    if (Math.abs(quantized.b - rgb.b) <= 1) quantized.b = rgb.b;
    musicalPaletteSmoothedRgb = quantized;
    return {
      ...source,
      rgb: { ...musicalPaletteSmoothedRgb },
      source: `${String(source.source || "palette").trim() || "palette"}:smoothed`
    };
  }

  function resolvePaletteFrameForTick(basePaletteFrame = {}, audioTelemetry = {}, tickAt = Date.now(), context = {}) {
    if (paletteMapperMode === "musical") {
      const mappedPaletteFrame = resolveMusicalPaletteFrame(
        basePaletteFrame,
        audioTelemetry,
        tickAt,
        context
      );
      return smoothMusicalPaletteFrame(
        mappedPaletteFrame,
        audioTelemetry,
        {
          profileHint: context?.profileHint,
          driveNorm: context?.driveNorm,
          beatPulse: context?.beatPulse === true
        }
      );
    }

    const base = basePaletteFrame && typeof basePaletteFrame === "object" ? basePaletteFrame : {};
    const count = Math.max(1, Math.round(Number(base.count || 1)));
    const baseIndex = ((Math.round(Number(base.index || 0)) % count) + count) % count;
    musicalPaletteCursor = baseIndex;
    musicalPaletteLastTargetIndex = baseIndex;
    musicalPaletteCentroidEma = 0.5;
    musicalPaletteLastKickAt = tickAt;
    musicalPaletteSmoothedRgb = null;
    musicalPaletteSmoothedCount = 0;
    return {
      ...base,
      count
    };
  }

  function updateMusicalTransportClock(input = {}) {
    const tickAt = Number(input.tickAt || Date.now());
    const beatPulse = input.beatPulse === true;
    const profileHint = String(input.profileHint || "groove").trim().toLowerCase() || "groove";
    const driveNorm = clampNumber(Number(input.driveNorm), 0, 1, 0.46);
    const bpmRaw = clampNumber(Number(input.bpm), 60, 220, musicalTransportBpm || 120);
    if (!(musicalTransportBpm > 0)) musicalTransportBpm = bpmRaw;
    musicalTransportBpm = clampNumber(
      musicalTransportBpm + ((bpmRaw - musicalTransportBpm) * 0.22),
      60,
      220,
      bpmRaw
    );
    if (!(musicalTransportLastAt > 0)) {
      musicalTransportLastAt = tickAt;
      musicalTransportPhase = 0;
      musicalTransportSubIndex = 0;
      return {
        advance: beatPulse,
        phase: musicalTransportPhase,
        bpm: musicalTransportBpm,
        subdivision: 1,
        subIndex: 0
      };
    }
    const dtMs = Math.max(0, tickAt - musicalTransportLastAt);
    musicalTransportLastAt = tickAt;
    const beatMs = 60000 / Math.max(1, musicalTransportBpm);
    const beatsElapsed = dtMs / Math.max(1, beatMs);
    musicalTransportPhase = clampNumber(
      (musicalTransportPhase + beatsElapsed) % 1,
      0,
      1,
      0
    );
    if (beatPulse) {
      musicalTransportPhase = 0;
    }
    const subdivision = profileHint === "aggressive"
      ? (driveNorm >= 0.62 ? 2 : 1)
      : (profileHint === "calm"
        ? 1
        : (driveNorm >= 0.72 ? 2 : 1));
    const subIndex = clampNumber(
      Math.floor(musicalTransportPhase * subdivision),
      0,
      Math.max(0, subdivision - 1),
      0
    );
    let advance = false;
    if (musicalTransportSubIndex < 0) {
      musicalTransportSubIndex = subIndex;
    } else if (subIndex !== musicalTransportSubIndex) {
      advance = true;
      musicalTransportSubIndex = subIndex;
    }
    if (beatPulse) {
      advance = true;
      musicalTransportSubIndex = 0;
    }
    return {
      advance,
      phase: musicalTransportPhase,
      bpm: musicalTransportBpm,
      subdivision,
      subIndex
    };
  }

  return {
    resolvePaletteFrameForTick,
    updateMusicalTransportClock
  };
};
