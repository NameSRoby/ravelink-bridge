// [TITLE] Module: domains/engine-v2/engine.runtime.cadence.js
// [TITLE] Purpose: auto-Hz cadence state machine for engine runtime dispatch pacing
// [TITLE] Functionality Index:
// [TITLE] - compute hardware-aware cadence targets from scene movement/tempo state
// [TITLE] - preserve envelope/hold state across ticks for deterministic pacing
// [TITLE] - expose per-brand cadence application metadata for runtime dispatch

module.exports = function createEngineRuntimeCadence(options = {}) {
  const clampNumber = typeof options.clampNumber === "function"
    ? options.clampNumber
    : (value => Number(value) || 0);
  const hardwareLimits = options.hardwareLimits && typeof options.hardwareLimits === "object"
    ? options.hardwareLimits
    : { hueMaxHz: 16, wizMaxHz: 16 };
  const OVERCLOCK_HZ_BY_LEVEL = options.OVERCLOCK_HZ_BY_LEVEL && typeof options.OVERCLOCK_HZ_BY_LEVEL === "object"
    ? options.OVERCLOCK_HZ_BY_LEVEL
    : {};

  let autoHzEnvelope = 0;
  let autoHzTempoEma = 120;
  let autoHzMovementEma = 0;
  let autoHzLoudnessEma = 0;
  let autoHzPulseHoldTicks = 0;
  let autoHzStallTicks = 0;
  let autoHzHighEnergyTicks = 0;
  let autoHzQuietTicks = 0;
  let autoHzMode = "normal";

  function computeCadenceState(input = {}) {
    const overclockSource = input.overclock && typeof input.overclock === "object"
      ? input.overclock
      : {};
    const sceneState = input.sceneState && typeof input.sceneState === "object"
      ? input.sceneState
      : {};
    const hasHueTargets = input.hasHueTargets === true;
    const hasWizTargets = input.hasWizTargets === true;

    const overclockLevel = clampNumber(
      Math.round(Number(overclockSource.activeLevel)),
      0,
      7,
      2
    );
    const overclockAutoEnabled = overclockSource.autoEnabled === true;
    const overclockDevHz = clampNumber(
      Math.round(Number(overclockSource.devHz)),
      0,
      60,
      0
    );
    const flowNorm = clampNumber(
      (clampNumber(sceneState.flowIntensity, 0, 2.8, 1) - 0.65) / 1.85,
      0,
      1,
      0
    );
    const movementRawFallback = clampNumber(
      (
        (clampNumber(sceneState.transient, 0, 1, 0) * 1.35) +
        (clampNumber(sceneState.flux, 0, 1, 0) * 1.2) +
        (clampNumber(sceneState.transientRise, 0, 1, 0) * 0.95) +
        (clampNumber(sceneState.fluxRise, 0, 1, 0) * 0.85) +
        (clampNumber(sceneState.kickAccent, 0, 1.4, 0) * 0.7) +
        (clampNumber(sceneState.beatConfidence, 0, 1, 0) * 0.9)
      ) / 3.55,
      0,
      1,
      0
    );
    const movementFromScene = clampNumber(
      (clampNumber(sceneState.motion, 0, 1.35, 0) - 0.02) / 1.05,
      0,
      1,
      movementRawFallback
    );
    const impactNorm = clampNumber(
      clampNumber(sceneState.impactSignal, 0, 2, 0) / 1.45,
      0,
      1,
      0
    );
    const movementRaw = clampNumber(
      (movementRawFallback * 0.32) +
      (movementFromScene * 0.54) +
      (impactNorm * 0.14),
      0,
      1,
      movementRawFallback
    );
    const movementRiseRate = movementRaw >= autoHzMovementEma ? 0.26 : 0.3;
    autoHzMovementEma = clampNumber(
      autoHzMovementEma + ((movementRaw - autoHzMovementEma) * movementRiseRate),
      0,
      1,
      movementRaw
    );
    const movementNorm = clampNumber(autoHzMovementEma, 0, 1, movementRaw);
    const bpm = clampNumber(sceneState.bpm, 0, 220, 120);
    autoHzTempoEma = clampNumber(
      autoHzTempoEma + ((bpm - autoHzTempoEma) * 0.18),
      60,
      220,
      bpm
    );
    const tempoNorm = clampNumber(
      (autoHzTempoEma - 70) / 95,
      0,
      1,
      0
    );
    const paceConfidence = clampNumber(
      sceneState?.cadenceState?.paceConfidence,
      0,
      1,
      clampNumber(sceneState.beatConfidence, 0, 1, 0)
    );
    const loudnessNorm = clampNumber(
      (clampNumber(sceneState.rms, 0, 1, 0) * 0.34) +
      (clampNumber(sceneState.energy, 0, 1, 0) * 0.24) +
      (clampNumber(sceneState.loudness, 0, 1, 0) * 0.42),
      0,
      1,
      0
    );
    const loudnessSectionBand = String(sceneState?.loudnessSectionBand || "normal").trim().toLowerCase() || "normal";
    const musicalProfile = String(sceneState?.musicalProfile || "groove").trim().toLowerCase() || "groove";
    const beatPulseActive = sceneState.beatPulse === true;
    const musicalDriveNorm = clampNumber(
      Number(sceneState?.musicalDriveNorm),
      0,
      1,
      clampNumber(
        (movementNorm * 0.38) +
        (impactNorm * 0.28) +
        (loudnessNorm * 0.22) +
        (loudnessSectionBand === "loud" ? 0.12 : (loudnessSectionBand === "quiet" ? -0.08 : 0)),
        0,
        1,
        0.46
      )
    );
    autoHzLoudnessEma = clampNumber(
      autoHzLoudnessEma + ((loudnessNorm - autoHzLoudnessEma) * 0.16),
      0,
      1,
      loudnessNorm
    );
    const autoCapacityNorm = clampNumber(
      (musicalDriveNorm * 0.22) +
      (movementNorm * 0.2) +
      (impactNorm * 0.14) +
      (flowNorm * 0.08) +
      (autoHzLoudnessEma * 0.1) +
      (beatPulseActive ? 0.06 : 0) +
      (loudnessSectionBand === "loud" ? 0.05 : (loudnessSectionBand === "quiet" ? -0.16 : 0)),
      0,
      1,
      0.22
    );
    const highEnergyNorm = clampNumber(
      (impactNorm * 0.3) +
      (movementNorm * 0.22) +
      (flowNorm * 0.12) +
      (autoHzLoudnessEma * 0.18) +
      (clampNumber(sceneState.transient, 0, 1, 0) * 0.1) +
      (clampNumber(sceneState.flux, 0, 1, 0) * 0.08) +
      (beatPulseActive ? 0.16 : 0) +
      (loudnessSectionBand === "loud" ? 0.1 : 0),
      0,
      1,
      0
    );
    const loudDriveHighCandidate = (
      loudnessSectionBand === "loud" &&
      (clampNumber(sceneState.energy, 0, 1, 0) >= 0.62 || clampNumber(sceneState.rms, 0, 1, 0) >= 0.5) &&
      (
        clampNumber(sceneState.transient, 0, 1, 0) >= 0.15 ||
        clampNumber(sceneState.flux, 0, 1, 0) >= 0.2 ||
        impactNorm >= 0.48
      )
    );
    const quietCandidate = (
      loudnessSectionBand === "quiet" &&
      movementNorm <= 0.3 &&
      impactNorm <= 0.26 &&
      highEnergyNorm <= 0.34 &&
      !beatPulseActive
    );
    if (quietCandidate) {
      autoHzQuietTicks = Math.min(24, autoHzQuietTicks + 1);
    } else {
      autoHzQuietTicks = Math.max(0, autoHzQuietTicks - 1);
    }
    const highEnergyActive = (
      highEnergyNorm >= 0.6 ||
      (beatPulseActive && highEnergyNorm >= 0.52) ||
      (impactNorm >= 0.74 && movementNorm >= 0.5) ||
      loudDriveHighCandidate
    );
    if (highEnergyActive) {
      autoHzHighEnergyTicks = Math.min(28, autoHzHighEnergyTicks + (beatPulseActive ? 2 : 1));
    } else {
      autoHzHighEnergyTicks = Math.max(0, autoHzHighEnergyTicks - 1);
    }
    const highEnergySustainNorm = clampNumber(
      (autoHzHighEnergyTicks - 2) / 8,
      0,
      1,
      0
    );
    if (
      beatPulseActive ||
      movementNorm > 0.74 ||
      impactNorm >= 0.62 ||
      (musicalProfile === "aggressive" && musicalDriveNorm >= 0.58)
    ) {
      autoHzPulseHoldTicks = 2;
    } else if (autoHzPulseHoldTicks > 0) {
      autoHzPulseHoldTicks -= 1;
    }
    const dynamicsBias = (
      (musicalProfile === "aggressive" ? 0.08 : (musicalProfile === "calm" ? -0.08 : 0)) +
      (loudnessSectionBand === "loud" ? 0.05 : (loudnessSectionBand === "quiet" ? -0.12 : 0))
    );
    const activeAutoCeilHz = hasHueTargets && hasWizTargets
      ? Math.min(hardwareLimits.hueMaxHz, hardwareLimits.wizMaxHz)
      : (hasHueTargets
        ? hardwareLimits.hueMaxHz
        : (hasWizTargets ? hardwareLimits.wizMaxHz : Math.min(hardwareLimits.hueMaxHz, hardwareLimits.wizMaxHz)));
    const hardwareAutoCeilHz = clampNumber(
      activeAutoCeilHz,
      1,
      60,
      10
    );
    const hardwareAutoFloorHz = clampNumber(hardwareAutoCeilHz >= 8 ? 2 : 1, 1, 5, 2);
    const tunedAutoFloorHz = clampNumber(hardwareAutoCeilHz >= 12 ? 2 : hardwareAutoFloorHz, 1, 6, hardwareAutoFloorHz);
    const sceneDriveNorm = clampNumber(
      (movementNorm * 0.36) +
      (impactNorm * 0.24) +
      (flowNorm * 0.14) +
      (autoHzLoudnessEma * 0.08) +
      (musicalDriveNorm * 0.18) +
      (autoCapacityNorm * 0.2),
      0,
      1,
      0
    );
    const tempoEnergyGate = clampNumber(
      (movementNorm * 0.46) +
      (impactNorm * 0.26) +
      (autoHzLoudnessEma * 0.2) +
      (beatPulseActive ? 0.08 : 0),
      0,
      1,
      0.32
    );
    const tempoTargetNorm = clampNumber(
      (tempoNorm * 0.34) + (tempoEnergyGate * 0.66),
      0,
      1,
      0.34
    );
    const tempoDrivenHz = tunedAutoFloorHz + (tempoTargetNorm * (hardwareAutoCeilHz - tunedAutoFloorHz));
    const dynamicsNorm = clampNumber(
      (sceneDriveNorm * 0.54) +
      (autoCapacityNorm * 0.34) +
      (tempoNorm * 0.12) +
      dynamicsBias,
      0,
      1,
      0
    );
    const dynamicsHz = tunedAutoFloorHz + (dynamicsNorm * (hardwareAutoCeilHz - tunedAutoFloorHz));
    const pulseBoostHz = autoHzPulseHoldTicks > 0
      ? clampNumber(0.4 + (movementNorm * 0.68) + (impactNorm * 0.54) + (autoCapacityNorm * 0.3), 0.2, 1.8, 0.5)
      : 0;
    const burstNorm = clampNumber(
      (impactNorm * 0.58) +
      (movementNorm * 0.22) +
      (flowNorm * 0.12) +
      (autoHzPulseHoldTicks > 0 ? 0.22 : 0) +
      (musicalProfile === "aggressive" ? 0.12 : 0) +
      (autoCapacityNorm * 0.2),
      0,
      1,
      0
    );
    if (autoHzMode === "high") {
      if (highEnergySustainNorm < 0.16 && !beatPulseActive && burstNorm < 0.5) {
        autoHzMode = autoHzQuietTicks >= 6 ? "quiet" : "normal";
      }
    } else if (autoHzMode === "quiet") {
      if (autoHzQuietTicks <= 1) {
        autoHzMode = highEnergySustainNorm >= 0.42 ? "high" : "normal";
      }
    } else if (highEnergySustainNorm >= 0.42 || burstNorm >= 0.8 || loudDriveHighCandidate || (loudnessSectionBand === "loud" && highEnergyNorm >= 0.56)) {
      autoHzMode = "high";
    } else if (autoHzQuietTicks >= 6) {
      autoHzMode = "quiet";
    }
    const tempoWeight = clampNumber(
      0.22 +
      (paceConfidence * 0.38) +
      (musicalProfile === "calm" ? -0.09 : (musicalProfile === "aggressive" ? 0.06 : 0)),
      0.2,
      0.76,
      0.42
    );
    const dynamicsWeight = clampNumber(1 - tempoWeight, 0.24, 0.76, 0.58);
    let targetAutoHz = clampNumber(
      (tempoDrivenHz * tempoWeight) + (dynamicsHz * dynamicsWeight) + pulseBoostHz,
      tunedAutoFloorHz,
      hardwareAutoCeilHz,
      tunedAutoFloorHz
    );
    if (hardwareAutoCeilHz >= 12 && highEnergySustainNorm > 0) {
      const highEnergyFloorNorm = clampNumber(
        0.54 +
        (highEnergySustainNorm * 0.26) +
        (beatPulseActive ? 0.06 : 0) +
        (impactNorm >= 0.82 ? 0.06 : 0),
        0.5,
        0.92,
        0.58
      );
      const highEnergyFloorHz = tunedAutoFloorHz + ((hardwareAutoCeilHz - tunedAutoFloorHz) * highEnergyFloorNorm);
      targetAutoHz = Math.max(targetAutoHz, highEnergyFloorHz);
    }
    if (autoHzMode === "quiet") {
      const quietCeilHz = clampNumber(
        tunedAutoFloorHz + 3.8 + (loudnessNorm * 0.8),
        tunedAutoFloorHz + 2.4,
        Math.max(tunedAutoFloorHz + 4.8, hardwareAutoCeilHz * 0.56),
        tunedAutoFloorHz + 4
      );
      targetAutoHz = Math.min(targetAutoHz, quietCeilHz);
    } else if (autoHzMode === "high") {
      const highModeFloorHz = tunedAutoFloorHz + ((hardwareAutoCeilHz - tunedAutoFloorHz) * clampNumber(
        0.8 + (highEnergySustainNorm * 0.14) + (beatPulseActive ? 0.04 : 0),
        0.78,
        0.96,
        0.84
      ));
      targetAutoHz = Math.max(targetAutoHz, highModeFloorHz);
    }
    const capacityFloorBaseNorm = musicalProfile === "calm"
      ? 0.1
      : (musicalProfile === "aggressive" ? 0.3 : 0.2);
    const capacityFloorNorm = clampNumber(
      capacityFloorBaseNorm +
      (autoCapacityNorm * 0.14) +
      (beatPulseActive ? 0.04 : 0),
      0.1,
      0.84,
      capacityFloorBaseNorm
    );
    const capacityFloorHz = tunedAutoFloorHz + ((hardwareAutoCeilHz - tunedAutoFloorHz) * capacityFloorNorm);
    if (
      (loudnessSectionBand !== "quiet" || beatPulseActive) &&
      (beatPulseActive || impactNorm >= 0.72 || burstNorm >= 0.8) &&
      autoCapacityNorm >= 0.7 &&
      movementNorm >= 0.48
    ) {
      targetAutoHz = Math.max(targetAutoHz, capacityFloorHz);
    }
    const profileBaseNorm = musicalProfile === "calm"
      ? 0.05
      : (musicalProfile === "aggressive" ? 0.38 : 0.26);
    const profileTargetNorm = clampNumber(
      profileBaseNorm +
      (musicalDriveNorm * 0.14) +
      (autoCapacityNorm * 0.1) +
      (beatPulseActive ? 0.06 : 0),
      0,
      1,
      profileBaseNorm
    );
    const profileTargetHz = tunedAutoFloorHz + (profileTargetNorm * (hardwareAutoCeilHz - tunedAutoFloorHz));
    const profileBlend = musicalProfile === "calm"
      ? 0.26
      : (musicalProfile === "aggressive" ? 0.16 : 0.14);
    targetAutoHz = clampNumber(
      (targetAutoHz * (1 - profileBlend)) + (profileTargetHz * profileBlend),
      tunedAutoFloorHz,
      hardwareAutoCeilHz,
      tunedAutoFloorHz
    );
    if (musicalProfile === "calm" && !beatPulseActive && movementNorm < 0.34 && impactNorm < 0.28) {
      targetAutoHz = Math.min(
        targetAutoHz,
        tunedAutoFloorHz + 1.2 + (loudnessNorm * 0.45) + (autoCapacityNorm * 0.3)
      );
    } else if (
      musicalProfile === "aggressive" &&
      (beatPulseActive || impactNorm >= 0.78 || (loudnessSectionBand === "loud" && movementNorm >= 0.58))
    ) {
      const aggressiveFloorNorm = clampNumber(
        0.38 + (musicalDriveNorm * 0.16) + (autoCapacityNorm * 0.1),
        0.38,
        0.82,
        0.46
      );
      const aggressiveFloorHz = tunedAutoFloorHz + ((hardwareAutoCeilHz - tunedAutoFloorHz) * aggressiveFloorNorm);
      targetAutoHz = Math.max(targetAutoHz, aggressiveFloorHz);
    }
    if (burstNorm > 0.82) {
      const burstFloorNorm = clampNumber(
        0.46 + ((burstNorm - 0.82) * 0.9),
        0.46,
        0.82,
        0.5
      );
      const burstFloorHz = tunedAutoFloorHz + ((hardwareAutoCeilHz - tunedAutoFloorHz) * burstFloorNorm);
      targetAutoHz = Math.max(targetAutoHz, burstFloorHz);
    }
    const autoRangeDemand = clampNumber(
      (autoCapacityNorm * 0.42) +
      (musicalDriveNorm * 0.16) +
      (beatPulseActive ? 0.08 : 0) +
      (loudnessSectionBand === "loud" ? 0.05 : (loudnessSectionBand === "quiet" ? -0.12 : 0)),
      0,
      1,
      0.32
    );
    const autoRangeLiftNorm = clampNumber(
      (autoRangeDemand - 0.76) * 0.12,
      0,
      0.04,
      0
    );
    if (autoRangeLiftNorm > 0) {
      targetAutoHz = targetAutoHz + ((hardwareAutoCeilHz - targetAutoHz) * autoRangeLiftNorm);
    }
    targetAutoHz = clampNumber(targetAutoHz, tunedAutoFloorHz, hardwareAutoCeilHz, tunedAutoFloorHz);
    if (!(autoHzEnvelope > 0)) {
      autoHzEnvelope = targetAutoHz;
    } else {
      if (Math.abs(targetAutoHz - autoHzEnvelope) < 0.28) {
        targetAutoHz = autoHzEnvelope;
      }
      const riseRate = clampNumber(
        0.14 +
        (movementNorm * 0.24) +
        (autoHzPulseHoldTicks > 0 ? 0.06 : 0) +
        (highEnergySustainNorm * 0.18),
        0.1,
        0.72,
        0.22
      );
      const fallRate = autoHzMode === "high"
        ? clampNumber(
          0.1 + (movementNorm * 0.16),
          0.08,
          0.32,
          0.16
        )
        : clampNumber(
          0.2 + (movementNorm * 0.28),
          0.16,
          0.66,
          0.28
        );
      const rate = targetAutoHz >= autoHzEnvelope ? riseRate : fallRate;
      const deltaRaw = (targetAutoHz - autoHzEnvelope) * rate;
      const deltaCap = clampNumber(
        0.24 +
        (movementNorm * 0.56) +
        (autoHzPulseHoldTicks > 0 ? 0.28 : 0) +
        (highEnergySustainNorm * 0.32),
        0.12,
        1.2,
        0.5
      );
      autoHzEnvelope = clampNumber(
        autoHzEnvelope + clampNumber(deltaRaw, -deltaCap, deltaCap, deltaRaw),
        tunedAutoFloorHz,
        hardwareAutoCeilHz,
        targetAutoHz
      );
    }
    const targetGap = Math.abs(targetAutoHz - autoHzEnvelope);
    if (targetGap < 0.08) {
      autoHzStallTicks += 1;
    } else {
      autoHzStallTicks = 0;
    }
    if (
      autoHzStallTicks >= 10 &&
      (movementNorm >= 0.7 || impactNorm >= 0.68 || autoCapacityNorm >= 0.78 || (musicalProfile === "aggressive" && beatPulseActive))
    ) {
      const nudge = clampNumber(
        0.08 + (movementNorm * 0.14) + (impactNorm * 0.1) + (autoCapacityNorm * 0.08),
        0.06,
        0.28,
        0.14
      );
      const direction = targetAutoHz >= autoHzEnvelope ? 1 : -1;
      autoHzEnvelope = clampNumber(
        autoHzEnvelope + (direction * nudge),
        tunedAutoFloorHz,
        hardwareAutoCeilHz,
        targetAutoHz
      );
      autoHzStallTicks = 0;
    }
    let autoRequestedHz = clampNumber(autoHzEnvelope, tunedAutoFloorHz, hardwareAutoCeilHz, tunedAutoFloorHz);
    if (overclockAutoEnabled && hardwareAutoCeilHz >= 12 && highEnergySustainNorm >= 0.45) {
      const sustainedFloorNorm = clampNumber(
        0.78 +
        (highEnergySustainNorm * 0.14) +
        (beatPulseActive ? 0.04 : 0),
        0.76,
        0.94,
        0.82
      );
      const sustainedFloorHz = tunedAutoFloorHz + ((hardwareAutoCeilHz - tunedAutoFloorHz) * sustainedFloorNorm);
      autoRequestedHz = Math.max(autoRequestedHz, sustainedFloorHz);
    }
    autoRequestedHz = Math.round(autoRequestedHz);
    const manualRequestedHz = overclockDevHz > 0
      ? overclockDevHz
      : clampNumber(Number(OVERCLOCK_HZ_BY_LEVEL[overclockLevel]), 2, 16, 6);
    const autoProfileScale = musicalProfile === "calm"
      ? 0.9
      : (musicalProfile === "aggressive" ? 1.05 : 1);
    const requestedHz = overclockAutoEnabled
      ? clampNumber(
        autoRequestedHz * autoProfileScale,
        tunedAutoFloorHz,
        hardwareAutoCeilHz,
        autoRequestedHz
      )
      : manualRequestedHz;
    let boostedRequestedHz = requestedHz;
    if (overclockAutoEnabled && musicalProfile === "aggressive") {
      const aggressiveDrive = clampNumber(
        (movementNorm * 0.42) +
        (impactNorm * 0.38) +
        (beatPulseActive ? 0.2 : 0) +
        (loudnessSectionBand === "loud" ? 0.08 : 0),
        0,
        1,
        0
      );
      if (aggressiveDrive >= 0.46) {
        const aggressiveBoost = clampNumber(
          0.6 + ((aggressiveDrive - 0.46) * 2.2),
          0.4,
          2.2,
          0.8
        );
        boostedRequestedHz = clampNumber(
          requestedHz + aggressiveBoost,
          tunedAutoFloorHz,
          hardwareAutoCeilHz,
          requestedHz
        );
      }
    }
    const finalRequestedHz = boostedRequestedHz;
    const appliedHueHz = clampNumber(finalRequestedHz, 1, hardwareLimits.hueMaxHz, hardwareLimits.hueMaxHz);
    const appliedWizHz = clampNumber(finalRequestedHz, 1, hardwareLimits.wizMaxHz, hardwareLimits.wizMaxHz);
    const appliedHz = hasHueTargets && hasWizTargets
      ? Math.min(appliedHueHz, appliedWizHz)
      : (hasHueTargets ? appliedHueHz : (hasWizTargets ? appliedWizHz : Math.min(appliedHueHz, appliedWizHz)));
    const guarded = appliedHz < (finalRequestedHz - 0.05);
    return {
      autoEnabled: overclockAutoEnabled,
      source: overclockAutoEnabled ? "auto_hz" : (overclockDevHz > 0 ? "dev_manual" : "manual"),
      requestedHz: Math.round(finalRequestedHz * 10) / 10,
      appliedHz: Math.round(appliedHz * 10) / 10,
      appliedByBrand: {
        hue: Math.round(appliedHueHz * 10) / 10,
        wiz: Math.round(appliedWizHz * 10) / 10
      },
      guardReason: guarded ? "hardware_limit" : "none",
      guarded,
      overclockLevel,
      paceConfidence: Math.round(paceConfidence * 1000) / 1000,
      targetBrands: {
        hue: hasHueTargets,
        wiz: hasWizTargets
      },
      autoDebug: {
        movementNorm: Math.round(movementNorm * 1000) / 1000,
        impactNorm: Math.round(impactNorm * 1000) / 1000,
        loudnessNorm: Math.round(loudnessNorm * 1000) / 1000,
        tempoNorm: Math.round(tempoNorm * 1000) / 1000,
        capacityNorm: Math.round(autoCapacityNorm * 1000) / 1000,
        highEnergyNorm: Math.round(highEnergyNorm * 1000) / 1000,
        highEnergyTicks: autoHzHighEnergyTicks,
        mode: autoHzMode,
        quietTicks: autoHzQuietTicks,
        profile: musicalProfile,
        targetHz: Math.round(targetAutoHz * 10) / 10,
        envelopeHz: Math.round(autoHzEnvelope * 10) / 10
      }
    };
  }

  return {
    computeCadenceState
  };
};
