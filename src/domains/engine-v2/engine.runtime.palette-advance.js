// [TITLE] Module: domains/engine-v2/engine.runtime.palette-advance.js
// [TITLE] Purpose: palette sequence advance gating for engine runtime ticks
// [TITLE] Functionality Index:
// [TITLE] - own stale/pulse/transport advance timing state
// [TITLE] - compute strict versus musical advance cadence deterministically
// [TITLE] - return palette advance weights without exposing internal timers

module.exports = function createEngineRuntimePaletteAdvance(options = {}) {
  const clampNumber = typeof options.clampNumber === "function"
    ? options.clampNumber
    : (value => Number(value) || 0);
  const paletteMapperMode = String(options.paletteMapperMode || "strict").trim().toLowerCase() || "strict";

  let lastPaletteAdvanceAt = 0;
  let lastPalettePulseAt = 0;

  function computePaletteAdvance(input = {}) {
    const tickAt = Number(input.tickAt || Date.now());
    const transportClock = input.transportClock && typeof input.transportClock === "object"
      ? input.transportClock
      : {};
    const audioTelemetry = input.audioTelemetry && typeof input.audioTelemetry === "object"
      ? input.audioTelemetry
      : {};
    const beatPulse = input.beatPulse === true;
    const cadenceHz = clampNumber(Number(input.cadenceHz), 0.5, 60, 6);
    const profileHint = String(input.profileHint || "groove").trim().toLowerCase() || "groove";
    const sectionBandHint = String(input.sectionBandHint || "normal").trim().toLowerCase() || "normal";
    const profileDriveHint = clampNumber(Number(input.profileDriveHint), 0, 1, 0.42);
    const transient = clampNumber(Number(audioTelemetry.transient), 0, 1, 0);
    const flux = clampNumber(Number(audioTelemetry.flux), 0, 1, 0);
    const beatConfidence = clampNumber(Number(audioTelemetry.beatConfidence), 0, 1, 0);

    const paletteStepIntervalMs = Math.max(1, Math.round(1000 / cadenceHz));
    const staleCeilMs = profileHint === "calm"
      ? 2200
      : (profileHint === "aggressive" ? 900 : 1350);
    const staleAdvance = lastPaletteAdvanceAt <= 0
      || (tickAt - lastPaletteAdvanceAt) >= Math.max(paletteStepIntervalMs, staleCeilMs);
    let pulseAdvance = false;
    let shouldAdvancePalette = false;
    let paletteAdvanceWeight = 1;

    if (paletteMapperMode === "strict") {
      const beatMs = 60000 / Math.max(1, Number(transportClock.bpm || 120));
      const transportSubdivision = Math.max(1, Math.round(Number(transportClock.subdivision || 1)));
      const transportIntervalMs = clampNumber(
        Math.round(beatMs / transportSubdivision),
        110,
        640,
        320
      );
      const strictPulseCandidate = (
        beatPulse ||
        (transient >= 0.5 && flux >= 0.32 && beatConfidence >= 0.2) ||
        (transient >= 0.64 && beatConfidence >= 0.18)
      );
      const strictPulseIntervalMs = clampNumber(
        Math.round(
          (transportIntervalMs * 0.9) -
          (profileDriveHint * 42) +
          (profileHint === "aggressive" ? -18 : (profileHint === "calm" ? 24 : 0))
        ),
        140,
        360,
        transportIntervalMs
      );
      const strictPulseGate = (
        beatPulse ||
        (
          (sectionBandHint === "loud" || profileHint === "aggressive") &&
          profileDriveHint >= 0.6 &&
          transient >= 0.52 &&
          flux >= 0.32
        ) ||
        (
          profileHint === "aggressive" &&
          profileDriveHint >= 0.68 &&
          transient >= 0.58 &&
          flux >= 0.4
        )
      );
      pulseAdvance = strictPulseCandidate
        && strictPulseGate
        && ((tickAt - lastPalettePulseAt) >= strictPulseIntervalMs);
      if (pulseAdvance) {
        lastPalettePulseAt = tickAt;
      }
      const calmTransportGate = profileHint === "calm"
        ? (profileDriveHint >= 0.34 || beatPulse || sectionBandHint === "loud")
        : true;
      if (
        pulseAdvance &&
        !transportClock.advance &&
        !staleAdvance &&
        !beatPulse &&
        sectionBandHint !== "loud" &&
        profileDriveHint < 0.42
      ) {
        pulseAdvance = false;
      }
      const strictMinAdvanceIntervalMs = clampNumber(
        Math.round(
          transportIntervalMs *
          (profileHint === "calm" ? 1.22 : (profileHint === "aggressive" ? 1.02 : 1.12))
        ),
        140,
        760,
        320
      );
      const intervalGate = (tickAt - lastPaletteAdvanceAt) >= strictMinAdvanceIntervalMs;
      const transportAdvance = intervalGate && transportClock.advance && calmTransportGate;
      const pulseFallbackAdvance = (
        intervalGate &&
        pulseAdvance &&
        !transportClock.advance &&
        (beatPulse || transient >= 0.72 || flux >= 0.56)
      );
      shouldAdvancePalette = staleAdvance || transportAdvance || pulseFallbackAdvance;
      const canHeavyStep = (
        beatPulse &&
        profileHint === "aggressive" &&
        profileDriveHint >= 0.8 &&
        transient >= 0.84 &&
        flux >= 0.68
      );
      paletteAdvanceWeight = canHeavyStep ? 2 : 1;
    } else {
      const pulseActive = beatPulse || transient >= 0.2 || flux >= 0.16;
      const minPulseIntervalMs = 160;
      pulseAdvance = pulseActive && ((tickAt - lastPalettePulseAt) >= minPulseIntervalMs);
      if (pulseAdvance) {
        lastPalettePulseAt = tickAt;
      }
      const calmTransportGate = profileHint === "calm"
        ? (profileDriveHint >= 0.34 || beatPulse || sectionBandHint === "loud")
        : true;
      const musicalMinAdvanceIntervalMs = profileHint === "calm" ? 380 : (profileHint === "aggressive" ? 240 : 300);
      const intervalGate = (tickAt - lastPaletteAdvanceAt) >= musicalMinAdvanceIntervalMs;
      shouldAdvancePalette = staleAdvance || (intervalGate && ((transportClock.advance && calmTransportGate) || pulseAdvance));
      const motionDrive = clampNumber(
        (transient * 1.8) + (flux * 1.35) + (beatPulse ? 0.9 : 0),
        0,
        3.8,
        0
      );
      const loudnessDrive = clampNumber(
        (clampNumber(audioTelemetry.rms, 0, 1, 0) * 0.95) +
        (clampNumber(audioTelemetry.energy, 0, 1, 0) * 0.72),
        0,
        1.9,
        0
      );
      const cadenceDrive = clampNumber(cadenceHz / 4.5, 0.5, 3.5, 1);
      const heavyStep = beatPulse && (motionDrive >= 1.4 || loudnessDrive >= 1.1 || cadenceDrive >= 2.2);
      paletteAdvanceWeight = heavyStep ? 2 : 1;
    }

    if (shouldAdvancePalette) {
      lastPaletteAdvanceAt = tickAt;
    }

    return {
      advance: shouldAdvancePalette,
      advanceWeight: paletteAdvanceWeight
    };
  }

  return {
    computePaletteAdvance
  };
};
