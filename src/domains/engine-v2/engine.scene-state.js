// [TITLE] Module: domains/engine-v2/engine.scene-state.js
// [TITLE] Purpose: deterministic scene-state model for Engine v2 scheduler compute stage
// [TITLE] Functionality Index:
// [TITLE] - normalize live compatibility + tuning payloads into stable scene controls
// [TITLE] - resolve hybrid BPM from telemetry beat confidence + derived pulse intervals
// [TITLE] - compute scene/brightness/transition outputs with cooldown-safe switching
// [DEV] Complex Flow:
// [DEV] This model is stateful by design (scene cooldown + BPM smoothing). It keeps
// [DEV] deterministic behavior while avoiding rapid scene flicker and unstable tempo jumps.

const {
  clampNumber,
  normalizeBoolean
} = require("./engine.contracts");
const {
  DEFAULT_RUNTIME_TUNING,
  extractLiveRuntimeControls,
  normalizeSceneLock
} = require("./engine.scene-runtime-controls");
const {
  resolveAutoScene,
  resolveMusicalSectionProfile
} = require("./engine.scene-auto-selection");
const {
  createSceneBpmState
} = require("./engine.scene-bpm-state");
const {
  calculateEffectiveSceneTuning,
  createSceneCooldownState
} = require("./engine.scene-cooldown-state");
const {
  createSceneSectionState
} = require("./engine.scene-section-state");
const {
  createSceneTransitionState
} = require("./engine.scene-transition-state");

module.exports = function createEngineSceneStateModel(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;

  let brightnessEnvelope = 0;
  let brightnessDriverEma = 0;
  let brightnessPresenceEma = 0;
  let brightnessOutputEma = 0;
  let brightnessDriverFloor = 0;
  let brightnessDriverCeil = 0;
  let musicalDriveEma = 0;
  let movementFloorEma = 0;
  let movementCeilEma = 0;
  let loudnessDeltaEma = 0;
  let brightnessSilentFrames = 0;
  let transientEma = 0;
  let fluxEma = 0;
  let bandLowEma = 0;
  let bandMidEma = 0;
  let bandHighEma = 0;
  let sceneMotionEma = 0;
  let sceneImpactEma = 0;
  let scenePaceEma = 0;
  let sceneCandidateConfidenceEma = 0;
  let lastStableSignalAt = 0;
  let signalDropoutTicks = 0;
  let stableSignalSnapshot = {
    rms: 0,
    energy: 0,
    peak: 0,
    transient: 0,
    flux: 0,
    bandLow: 0,
    bandMid: 0,
    bandHigh: 0,
    beatConfidence: 0
  };
  const bpmStateTracker = createSceneBpmState();
  const cooldownStateTracker = createSceneCooldownState();
  const sectionStateTracker = createSceneSectionState();
  const transitionStateTracker = createSceneTransitionState();

  function computeSceneState(input = {}) {
    const telemetry = input?.telemetry && typeof input.telemetry === "object" ? input.telemetry : {};
    const controls = extractLiveRuntimeControls(input);
    const tuning = controls.runtimeTuning;
    const sceneAggressiveness = controls.sceneAggressiveness;
    const sceneLock = controls.sceneLock;
    const nowMs = Number(now() || Date.now());

    const rawEnergy = clampNumber(telemetry.energy, 0, 1, 0);
    const rawRms = clampNumber(telemetry.rms, 0, 1, 0);
    const rawFlux = clampNumber(telemetry.flux, 0, 1, 0);
    const rawTransient = clampNumber(telemetry.transient, 0, 1, 0);
    const rawPeak = clampNumber(telemetry.peak, 0, 1, 0);
    const rawBandLow = clampNumber(telemetry.bandLow, 0, 1, 0);
    const rawBandMid = clampNumber(telemetry.bandMid, 0, 1, 0);
    const rawBandHigh = clampNumber(telemetry.bandHigh, 0, 1, 0);
    const rawBeatConfidence = clampNumber(telemetry.beatConfidence, 0, 1, 0);
    const rawBeat = normalizeBoolean(telemetry.beat, false);
    const rawBeatPulse = normalizeBoolean(telemetry.beatPulse, false);

    const hasRecentStableSignal = lastStableSignalAt > 0 && (nowMs - lastStableSignalAt) <= 360;
    const likelyCaptureDropout = (
      rawRms <= 0.004 &&
      rawEnergy <= 0.005 &&
      rawPeak <= 0.015 &&
      (
        rawFlux >= 0.72 ||
        rawBeatPulse === true ||
        (rawBeat === true && rawBeatConfidence >= 0.16) ||
        hasRecentStableSignal
      )
    );
    const likelyStableSignal = (
      rawRms >= 0.01 ||
      rawEnergy >= 0.012 ||
      rawPeak >= 0.03
    );

    let energy = rawEnergy;
    let rms = rawRms;
    let flux = rawFlux;
    let transient = rawTransient;
    let peak = rawPeak;
    let bandLow = rawBandLow;
    let bandMid = rawBandMid;
    let bandHigh = rawBandHigh;
    let beatConfidence = rawBeatConfidence;
    let beat = rawBeat;
    let telemetryBeatPulse = rawBeatPulse;
    let pulseTransient = rawTransient;
    let pulseFlux = rawFlux;
    let pulseBandLow = rawBandLow;
    let pulseBeatConfidence = rawBeatConfidence;

    if (likelyCaptureDropout && hasRecentStableSignal) {
      signalDropoutTicks += 1;
      const dropoutDecay = clampNumber(0.9 - (signalDropoutTicks * 0.08), 0.55, 0.9, 0.82);
      rms = clampNumber(stableSignalSnapshot.rms * dropoutDecay, 0, 1, rawRms);
      energy = clampNumber(stableSignalSnapshot.energy * dropoutDecay, 0, 1, rawEnergy);
      peak = clampNumber(Math.max(rms, stableSignalSnapshot.peak * dropoutDecay), 0, 1, rawPeak);
      transient = clampNumber(Math.min(rawTransient * 0.35, stableSignalSnapshot.transient * 0.7), 0, 1, rawTransient);
      flux = clampNumber(Math.min(rawFlux * 0.36, 0.32), 0, 1, rawFlux);
      bandLow = clampNumber(stableSignalSnapshot.bandLow * dropoutDecay, 0, 1, rawBandLow);
      bandMid = clampNumber(stableSignalSnapshot.bandMid * dropoutDecay, 0, 1, rawBandMid);
      bandHigh = clampNumber(stableSignalSnapshot.bandHigh * dropoutDecay, 0, 1, rawBandHigh);
      beatConfidence = clampNumber(Math.min(rawBeatConfidence, stableSignalSnapshot.beatConfidence * 0.72), 0, 1, rawBeatConfidence);
      beat = false;
      telemetryBeatPulse = false;
    } else {
      signalDropoutTicks = 0;
      if (likelyStableSignal) {
        lastStableSignalAt = nowMs;
        stableSignalSnapshot = {
          rms: rawRms,
          energy: rawEnergy,
          peak: rawPeak,
          transient: rawTransient,
          flux: rawFlux,
          bandLow: rawBandLow,
          bandMid: rawBandMid,
          bandHigh: rawBandHigh,
          beatConfidence: rawBeatConfidence
        };
      }
    }
    pulseTransient = transient;
    pulseFlux = flux;
    pulseBandLow = bandLow;
    pulseBeatConfidence = beatConfidence;

    // [DEV] Robust telemetry continuity guard: audio transports can emit occasional
    // [DEV] transient/flux outlier spikes (or instant drops) even while RMS/energy are
    // [DEV] stable. Clamp one-tick jumps against rolling EMA so brightness does not
    // [DEV] flicker at floor/edge states from non-musical artifacts.
    const transientRiseCap = clampNumber(
      0.22 + (telemetryBeatPulse ? 0.38 : 0.14) + (beatConfidence * 0.22),
      0.14,
      0.72,
      0.3
    );
    const fluxRiseCap = clampNumber(
      0.2 + (telemetryBeatPulse ? 0.34 : 0.12) + (beatConfidence * 0.2),
      0.12,
      0.68,
      0.28
    );
    const transientUpper = clampNumber(transientEma + transientRiseCap, 0, 1, transient);
    const fluxUpper = clampNumber(fluxEma + fluxRiseCap, 0, 1, flux);
    transient = clampNumber(Math.min(transient, transientUpper), 0, 1, transient);
    flux = clampNumber(Math.min(flux, fluxUpper), 0, 1, flux);
    if (telemetryBeatPulse !== true && rms >= 0.42 && energy >= 0.5) {
      const transientLower = clampNumber(transientEma - 0.18, 0, 1, 0);
      const fluxLower = clampNumber(fluxEma - 0.16, 0, 1, 0);
      transient = clampNumber(Math.max(transient, transientLower), 0, 1, transient);
      flux = clampNumber(Math.max(flux, fluxLower), 0, 1, flux);
    }

    const derivedPulse = bpmStateTracker.maybeCaptureDerivedPulse(
      {
        beatPulse: telemetryBeatPulse,
        transient: pulseTransient,
        flux: pulseFlux,
        bandLow: pulseBandLow,
        beatConfidence: pulseBeatConfidence
      },
      tuning,
      nowMs
    );
    const beatPulse = telemetryBeatPulse || derivedPulse;
    const beatStrong = beatPulse || (beat && beatConfidence >= 0.34);
    const bpmState = bpmStateTracker.resolveBpm(
      {
        bpm: telemetry.bpm,
        beatConfidence
      },
      tuning,
      nowMs
    );

    const sectionState = sectionStateTracker.update({
      energy,
      rms,
      tuning
    });
    const {
      loudness,
      loudnessAdaptive,
      loudnessRaw,
      loudnessSection,
      loudnessSectionBand,
      loudnessDeltaNorm
    } = sectionState;
    loudnessDeltaEma = clampNumber(
      loudnessDeltaEma + ((loudnessDeltaNorm - loudnessDeltaEma) * 0.32),
      0,
      1,
      loudnessDeltaNorm
    );
    transientEma = clampNumber(
      transientEma + ((transient - transientEma) * 0.22),
      0,
      1,
      transient
    );
    fluxEma = clampNumber(
      fluxEma + ((flux - fluxEma) * 0.22),
      0,
      1,
      flux
    );
    bandLowEma = clampNumber(
      bandLowEma + ((bandLow - bandLowEma) * 0.2),
      0,
      1,
      bandLow
    );
    bandMidEma = clampNumber(
      bandMidEma + ((bandMid - bandMidEma) * 0.2),
      0,
      1,
      bandMid
    );
    bandHighEma = clampNumber(
      bandHighEma + ((bandHigh - bandHighEma) * 0.2),
      0,
      1,
      bandHigh
    );
    const transientRise = clampNumber(transient - transientEma, 0, 1, 0);
    const fluxRise = clampNumber(flux - fluxEma, 0, 1, 0);
    const lowBandRise = clampNumber(bandLow - bandLowEma, 0, 1, 0);
    const highBandRise = clampNumber(bandHigh - bandHighEma, 0, 1, 0);
    const kickAccent = clampNumber(
      (bandLow * 0.8) +
      (lowBandRise * 1.18) -
      (bandMid * 0.3) -
      (bandHigh * 0.18),
      0,
      1.4,
      0
    );
    const sparkleAccent = clampNumber(
      (bandHigh * 0.68) +
      (highBandRise * 0.95) -
      (bandLow * 0.22),
      0,
      1.4,
      0
    );
    const motion = clampNumber(
      (transient * 0.5) +
      (flux * 0.42) +
      (transientRise * 0.56) +
      (fluxRise * 0.48) +
      (loudnessDeltaEma * 0.12) +
      (kickAccent * 0.22) +
      (sparkleAccent * 0.12) +
      (beatStrong ? 0.16 : 0),
      0,
      1.35,
      0
    );
    const impactSignal = clampNumber(
      (transient * 0.62) +
      (flux * 0.24) +
      (transientRise * 0.82) +
      (fluxRise * 0.54) +
      (kickAccent * 0.34) +
      (beatStrong ? 0.2 : 0) +
      (beatPulse ? 0.24 : 0),
      0,
      2,
      0
    );
    const motionSceneRate = motion >= sceneMotionEma ? 0.28 : 0.12;
    sceneMotionEma = clampNumber(
      sceneMotionEma + ((motion - sceneMotionEma) * motionSceneRate),
      0,
      1.35,
      motion
    );
    const impactSceneRate = impactSignal >= sceneImpactEma ? 0.34 : 0.46;
    sceneImpactEma = clampNumber(
      sceneImpactEma + ((impactSignal - sceneImpactEma) * impactSceneRate),
      0,
      2,
      impactSignal
    );
    const paceRaw = clampNumber((bpmState.bpm - 70) / 95, 0, 1, 0);
    scenePaceEma = clampNumber(
      scenePaceEma + ((paceRaw - scenePaceEma) * 0.2),
      0,
      1,
      paceRaw
    );
    const sceneMotion = clampNumber((motion * 0.42) + (sceneMotionEma * 0.58), 0, 1.35, motion);
    const sceneImpact = clampNumber((impactSignal * 0.56) + (sceneImpactEma * 0.44), 0, 2, impactSignal);
    const scenePace = clampNumber((paceRaw * 0.34) + (scenePaceEma * 0.66), 0, 1, paceRaw);
    const motionStability = clampNumber(1 - Math.abs(sceneMotionEma - motion), 0, 1, 0);
    const impactBurst = (
      beatPulse ||
      (transientRise >= 0.26 && fluxRise >= 0.16) ||
      (kickAccent >= 0.75 && transient >= 0.22) ||
      (sceneImpactEma >= 1 && impactSignal >= 0.72 && transient >= 0.38)
    );
    const sceneAutoResolution = sceneLock === "auto"
      ? resolveAutoScene({
        loudness,
        loudnessSectionBand,
        motion: sceneMotion,
        impactSignal: sceneImpact,
        beatPulse,
        pace: scenePace,
        paceConfidence: bpmState.confidence,
        impactBurst,
        motionStability,
        transientRise,
        fluxRise,
        kickAccent,
        sparkleAccent,
        beatConfidence,
        loudnessSection,
        aggressiveness: sceneAggressiveness,
        previousScene: cooldownStateTracker.getLastScene()
      })
      : {
        scene: sceneLock,
        confidence: 1,
        scores: {}
      };
    const sceneCandidate = normalizeSceneLock(sceneAutoResolution.scene, "steady");
    const sceneCandidateConfidence = clampNumber(sceneAutoResolution.confidence, 0, 1, 1);
    if (!(sceneCandidateConfidenceEma > 0)) {
      sceneCandidateConfidenceEma = sceneCandidateConfidence;
    } else {
      const confidenceRate = sceneCandidateConfidence >= sceneCandidateConfidenceEma ? 0.34 : 0.18;
      sceneCandidateConfidenceEma = clampNumber(
        sceneCandidateConfidenceEma + ((sceneCandidateConfidence - sceneCandidateConfidenceEma) * confidenceRate),
        0,
        1,
        sceneCandidateConfidence
      );
    }
    const sceneSwitchPenalty = sceneCandidate !== cooldownStateTracker.getLastScene() ? 0.08 : 0;
    const sceneSwitchConfidence = clampNumber(
      ((sceneCandidateConfidence * 0.58) + (sceneCandidateConfidenceEma * 0.42)) - sceneSwitchPenalty,
      0,
      1,
      sceneCandidateConfidence
    );
    const effectiveTuning = calculateEffectiveSceneTuning({
      beatPulse,
      sceneCandidate,
      sceneImpact,
      sceneMotion,
      tuning
    });
    const sceneIntent = cooldownStateTracker.applySceneCooldown(
      sceneCandidate,
      nowMs,
      effectiveTuning,
      sceneSwitchConfidence
    );
    const musicalSectionProfile = resolveMusicalSectionProfile({
      sceneIntent,
      loudness,
      loudnessSection,
      loudnessSectionBand,
      motion: sceneMotion,
      impactSignal: sceneImpact,
      beatPulse
    });

    const movementRawForBrightness = clampNumber(
      (motion * 0.72) +
      (impactSignal * 0.28) +
      (loudnessDeltaEma * 0.1),
      0,
      1.8,
      0
    );
    if (!(movementFloorEma > 0) && !(movementCeilEma > 0)) {
      const seedSpan = 0.16;
      movementFloorEma = clampNumber(
        movementRawForBrightness - (seedSpan * 0.55),
        0,
        1.8,
        movementRawForBrightness
      );
      movementCeilEma = clampNumber(
        movementRawForBrightness + (seedSpan * 0.55),
        0,
        1.8,
        movementRawForBrightness
      );
    } else {
      const floorRate = movementRawForBrightness <= movementFloorEma ? 0.34 : 0.018;
      const ceilRate = movementRawForBrightness >= movementCeilEma ? 0.28 : 0.014;
      movementFloorEma = clampNumber(
        movementFloorEma + ((movementRawForBrightness - movementFloorEma) * floorRate),
        0,
        1.8,
        movementRawForBrightness
      );
      movementCeilEma = clampNumber(
        movementCeilEma + ((movementRawForBrightness - movementCeilEma) * ceilRate),
        0,
        1.8,
        movementRawForBrightness
      );
    }
    const movementAdaptiveSpan = Math.max(0.12, movementCeilEma - movementFloorEma);
    const movementAdaptive = clampNumber(
      (movementRawForBrightness - movementFloorEma) / Math.max(0.0001, movementAdaptiveSpan),
      0,
      1,
      0
    );
    const movementPresence = clampNumber(
      (movementAdaptive * 0.72) +
      (clampNumber(movementRawForBrightness / 1.2, 0, 1, 0) * 0.28),
      0,
      1,
      movementAdaptive
    );
    const musicalDriveRaw = clampNumber(
      (musicalSectionProfile.driveNorm * 0.62) +
      (movementPresence * 0.22) +
      (loudnessDeltaEma * 0.1) +
      (beatPulse ? 0.1 : 0) +
      (loudnessSectionBand === "loud" ? 0.06 : 0),
      0,
      1,
      musicalSectionProfile.driveNorm
    );
    if (!(musicalDriveEma > 0)) {
      musicalDriveEma = musicalDriveRaw;
    } else {
      const driveRate = musicalDriveRaw >= musicalDriveEma ? 0.34 : 0.16;
      musicalDriveEma = clampNumber(
        musicalDriveEma + ((musicalDriveRaw - musicalDriveEma) * driveRate),
        0,
        1,
        musicalDriveRaw
      );
    }
    const musicalDriveEnvelope = clampNumber(
      (musicalDriveEma * 0.72) + (musicalDriveRaw * 0.28),
      0,
      1,
      musicalDriveRaw
    );
    const sectionGain = loudnessSectionBand === "loud"
      ? 1.24
      : (loudnessSectionBand === "quiet" ? 0.78 : 1);
    const motionWeighted = clampNumber(
      (loudness * 0.34) +
      (loudnessSection * 0.26) +
      (movementPresence * 0.86),
      0,
      1.2,
      0
    );
    const crest = clampNumber((peak - rms) * 1.35, 0, 1, 0);
    const loudnessDeltaAccent = clampNumber(
      (loudnessDeltaEma * 0.66) +
      (transientRise * 0.22) +
      (fluxRise * 0.12),
      0,
      1,
      0
    );
    const brightnessDriverRaw = clampNumber(
      (loudnessAdaptive * 0.19) +
      (loudnessRaw * 0.07) +
      (loudnessSection * 0.24) +
      (movementPresence * 0.54) +
      (musicalDriveEnvelope * 0.28) +
      (impactSignal * 0.3) +
      (crest * 0.18) +
      (kickAccent * 0.2) +
      (sparkleAccent * 0.1) +
      (loudnessDeltaAccent * 0.2) +
      (loudnessDeltaEma * clampNumber(tuning.brightnessDynamicsBoost, 0, 1.5, 0.42)) +
      (transient * tuning.brightnessTransientBoost) +
      (flux * tuning.brightnessFluxBoost) +
      (beatStrong ? (tuning.brightnessBeatBoost * 0.64) : 0) +
      (beatPulse ? 0.12 : 0),
      0,
      2.2,
      0
    );
    const brightnessDriverAbsolute = clampNumber(
      (loudnessAdaptive * 0.24) +
      (loudnessRaw * 0.1) +
      (loudnessSection * 0.24) +
      (movementPresence * 0.44) +
      (musicalDriveEnvelope * 0.24) +
      (impactSignal * 0.28) +
      (crest * 0.1) +
      (kickAccent * 0.12) +
      (sparkleAccent * 0.08) +
      (beatPulse ? 0.1 : 0),
      0,
      1.4,
      0
    );
    if (!(brightnessDriverFloor > 0) && !(brightnessDriverCeil > 0)) {
      const seedSpan = Math.max(
        clampNumber(tuning.brightnessDynamicMinSpan, 0.04, 0.6, 0.09),
        0.16
      );
      brightnessDriverFloor = clampNumber(brightnessDriverRaw - (seedSpan * 0.55), 0, 2.2, brightnessDriverRaw);
      brightnessDriverCeil = clampNumber(brightnessDriverRaw + (seedSpan * 0.55), 0, 2.2, brightnessDriverRaw);
    } else {
      const floorSmoothing = brightnessDriverRaw <= brightnessDriverFloor
        ? tuning.brightnessDriverFloorAttack
        : tuning.brightnessDriverFloorRelease;
      const ceilSmoothing = brightnessDriverRaw >= brightnessDriverCeil
        ? tuning.brightnessDriverCeilAttack
        : tuning.brightnessDriverCeilRelease;
      brightnessDriverFloor = clampNumber(
        brightnessDriverFloor + ((brightnessDriverRaw - brightnessDriverFloor) * floorSmoothing),
        0,
        2.2,
        brightnessDriverRaw
      );
      brightnessDriverCeil = clampNumber(
        brightnessDriverCeil + ((brightnessDriverRaw - brightnessDriverCeil) * ceilSmoothing),
        0,
        2.2,
        brightnessDriverRaw
      );
    }
    const brightnessDynamicSpan = Math.max(
      clampNumber(tuning.brightnessDynamicMinSpan, 0.04, 0.6, 0.09),
      brightnessDriverCeil - brightnessDriverFloor
    );
    let brightnessDriver = clampNumber(
      (brightnessDriverRaw - brightnessDriverFloor) / Math.max(0.0001, brightnessDynamicSpan),
      0,
      1,
      0
    );
    brightnessDriver = clampNumber(
      (brightnessDriver * 0.62) + (brightnessDriverAbsolute * 0.38),
      0,
      1,
      brightnessDriver
    );
    brightnessDriver = clampNumber(
      brightnessDriver * sectionGain,
      0,
      1,
      brightnessDriver
    );
    const baseSilenceCutoff = clampNumber(tuning.brightnessSilenceCutoff, 0.01, 0.5, 0.12);
    const adaptiveSilenceCutoff = clampNumber(
      baseSilenceCutoff * (1 - (movementPresence * 0.55) - (loudnessAdaptive * 0.35) - (loudnessSection * 0.24)),
      0.02,
      baseSilenceCutoff,
      baseSilenceCutoff
    );
    const silenceCandidate = (
      rms <= 0.015 &&
      energy <= 0.022 &&
      transient <= 0.05 &&
      flux <= 0.05 &&
      movementPresence < 0.12 &&
      loudnessSection < 0.45
    );
    brightnessSilentFrames = silenceCandidate ? (brightnessSilentFrames + 1) : 0;
    const sustainedSilence = brightnessSilentFrames >= 6;
    if (brightnessDriver < adaptiveSilenceCutoff && sustainedSilence) {
      const silenceDepth = clampNumber(
        (adaptiveSilenceCutoff - brightnessDriver) / Math.max(0.0001, adaptiveSilenceCutoff),
        0,
        1,
        0
      );
      const configuredSuppress = clampNumber(tuning.brightnessSilenceSuppress, 0, 1, 0.28);
      const adaptiveSuppressFloor = clampNumber(
        0.18 + (movementPresence * 0.16) + (impactSignal * 0.1) + (beatPulse ? 0.14 : 0),
        configuredSuppress,
        0.9,
        0.32
      );
      const suppress = Math.max(configuredSuppress, adaptiveSuppressFloor);
      const suppressMix = clampNumber((1 - silenceDepth) + (silenceDepth * suppress), suppress, 1, suppress);
      brightnessDriver *= suppressMix;
    } else if (!sustainedSilence) {
      const lowVolumeActivityBoost = clampNumber(
        (movementPresence * 0.12) +
        (loudnessSection * 0.08) +
        (loudnessDeltaAccent * 0.04),
        0,
        0.08,
        0
      );
      brightnessDriver = Math.max(brightnessDriver, lowVolumeActivityBoost);
    }
    if (!(brightnessDriverEma > 0)) {
      brightnessDriverEma = brightnessDriver;
    } else {
      const driverRate = brightnessDriver >= brightnessDriverEma ? 0.36 : 0.2;
      brightnessDriverEma = clampNumber(
        brightnessDriverEma + ((brightnessDriver - brightnessDriverEma) * driverRate),
        0,
        1,
        brightnessDriver
      );
    }
    const brightnessActivityFloor = clampNumber(
      (loudnessAdaptive * 0.065) +
      (loudnessRaw * 0.024) +
      (loudnessSection * 0.058) +
      (movementPresence * 0.12) +
      (musicalDriveEnvelope * 0.072) +
      (impactSignal * 0.086) +
      (loudnessDeltaAccent * 0.05) +
      (beatStrong ? 0.04 : 0) +
      (beatPulse ? 0.03 : 0) +
      (
        musicalSectionProfile.profile === "aggressive"
          ? 0.03
          : (musicalSectionProfile.profile === "calm" ? -0.022 : 0.008)
      ),
      0,
      0.13,
      0
    );
    const brightnessDriverStable = clampNumber(
      (brightnessDriverEma * 0.8) + (brightnessActivityFloor * 0.2),
      0,
      1,
      brightnessDriverEma
    );
    const brightnessShapedRaw = clampNumber(
      Math.pow(clampNumber(brightnessDriverStable, 0, 1, 0), tuning.brightnessContrast),
      0,
      1,
      0
    );
    const brightnessShaped = clampNumber(
      (brightnessShapedRaw * 0.62) + (brightnessDriverStable * 0.38),
      0,
      1,
      brightnessShapedRaw
    );
    const attackBase = clampNumber(tuning.brightnessAttack, 0.05, 0.95, 0.44);
    const releaseBase = clampNumber(tuning.brightnessRelease, 0.05, 0.95, 0.2);
    const attack = clampNumber(
      attackBase * (0.58 + (motion * 0.34) + (beatPulse ? 0.15 : 0)),
      0.05,
      0.9,
      attackBase
    );
    const release = clampNumber(
      releaseBase * (0.68 + (motion * 0.24)),
      0.05,
      0.8,
      releaseBase
    );
    const smoothing = brightnessShaped >= brightnessEnvelope ? attack : release;
    const brightnessDeltaRaw = (brightnessShaped - brightnessEnvelope) * smoothing;
    const brightnessDeltaCap = clampNumber(
      tuning.brightnessDeltaFloorStep +
      (motion * tuning.brightnessDeltaMotionStep) +
      (beatPulse ? tuning.brightnessDeltaBeatBoost : 0),
      0.01,
      0.16,
      0.07
    );
    brightnessEnvelope = clampNumber(
      brightnessEnvelope + clampNumber(
        brightnessDeltaRaw,
        -brightnessDeltaCap,
        brightnessDeltaCap,
        brightnessDeltaRaw
      ),
      0,
      1,
      0
    );
    const brightnessPresenceLiftRaw = clampNumber(
      (movementAdaptive * 0.07) +
      (loudnessDeltaEma * 0.06) +
      (loudnessDeltaAccent * 0.042) +
      (beatPulse ? 0.032 : 0),
      0,
      0.22,
      0
    );
    if (!(brightnessPresenceEma > 0)) {
      brightnessPresenceEma = brightnessPresenceLiftRaw;
    } else {
      const presenceRate = brightnessPresenceLiftRaw >= brightnessPresenceEma ? 0.42 : 0.2;
      brightnessPresenceEma = clampNumber(
        brightnessPresenceEma + ((brightnessPresenceLiftRaw - brightnessPresenceEma) * presenceRate),
        0,
        0.2,
        brightnessPresenceLiftRaw
      );
    }
    let dynamicBrightnessFloor = clampNumber(
      tuning.brightnessFloor + (
        (tuning.brightnessCeil - tuning.brightnessFloor) *
        brightnessActivityFloor *
        0.045
      ),
      tuning.brightnessFloor,
      Math.max(tuning.brightnessFloor, tuning.brightnessCeil - 0.02),
      tuning.brightnessFloor
    );
    const brightnessSpan = Math.max(0, tuning.brightnessCeil - tuning.brightnessFloor);
    if (loudnessSectionBand === "quiet") {
      dynamicBrightnessFloor = Math.max(
        tuning.brightnessFloor,
        dynamicBrightnessFloor - (brightnessSpan * 0.12)
      );
    } else if (loudnessSectionBand === "loud") {
      dynamicBrightnessFloor = clampNumber(
        dynamicBrightnessFloor + (brightnessSpan * 0.022),
        tuning.brightnessFloor,
        Math.max(tuning.brightnessFloor, tuning.brightnessCeil - 0.02),
        dynamicBrightnessFloor
      );
    }
    const sustainedSignalActive = rms >= 0.018 || energy >= 0.024;
    if (sustainedSignalActive) {
      const quietFloorScale = loudnessSectionBand === "quiet" ? 0.58 : 1;
      const antiFlickerFloor = clampNumber(
        tuning.brightnessFloor +
        ((movementPresence * 0.02) * quietFloorScale) +
        ((loudnessAdaptive * 0.008) * quietFloorScale) +
        ((loudnessSection * 0.008) * quietFloorScale) +
        ((beatPulse ? 0.006 : 0) * quietFloorScale),
        tuning.brightnessFloor,
        Math.max(tuning.brightnessFloor, tuning.brightnessCeil - 0.02),
        tuning.brightnessFloor
      );
      const antiFlickerCap = clampNumber(
        tuning.brightnessFloor + (
          brightnessSpan * (
            loudnessSectionBand === "loud"
              ? 0.16
              : (loudnessSectionBand === "quiet" ? 0.012 : 0.08)
          )
        ),
        tuning.brightnessFloor,
        Math.max(tuning.brightnessFloor, tuning.brightnessCeil - 0.02),
        tuning.brightnessFloor
      );
      dynamicBrightnessFloor = clampNumber(
        Math.max(dynamicBrightnessFloor, antiFlickerFloor),
        tuning.brightnessFloor,
        antiFlickerCap,
        dynamicBrightnessFloor
      );
    }
    // [DEV] Loud/quiet section shaping drives full-span brightness behavior while preserving
    // [DEV] deterministic smoothing: loud passages push into ceiling, quiet passages release floor.
    const loudSectionNorm = clampNumber((loudnessSection - 0.56) / 0.44, 0, 1, 0);
    const quietSectionNorm = clampNumber((0.44 - loudnessSection) / 0.44, 0, 1, 0);
    const loudnessCeilingDrive = clampNumber(
      loudSectionNorm * (
        (loudnessAdaptive * 0.22) +
        (loudnessRaw * 0.16) +
        (musicalDriveEnvelope * 0.14) +
        (impactSignal * 0.12) +
        (beatStrong ? 0.09 : 0) +
        (beatPulse ? 0.1 : 0)
      ),
      0,
      0.52,
      0
    );
    const quietSectionPull = clampNumber(
      quietSectionNorm * (
        (sustainedSilence ? 0.14 : 0.07) +
        ((1 - movementPresence) * 0.04) +
        ((1 - musicalDriveEnvelope) * 0.03)
      ),
      0,
      0.24,
      0
    );
    const sectionBrightnessScale = clampNumber(
      0.12 + (loudnessSection * 0.84) + (loudnessAdaptive * 0.32),
      0.12,
      1.24,
      0.72
    );
    const quietSectionDamping = clampNumber(
      quietSectionNorm * (0.64 + ((1 - loudnessAdaptive) * 0.38)),
      0,
      0.88,
      0
    );
    const baseBrightnessDrive = clampNumber(
      (
        (brightnessEnvelope + brightnessPresenceEma + loudnessCeilingDrive) *
        sectionBrightnessScale
      ) -
      (quietSectionPull * clampNumber(1 - (musicalDriveEnvelope * 0.34), 0.62, 1, 0.82)) -
      quietSectionDamping,
      0,
      1,
      brightnessEnvelope
    );
    const loudnessSpanDrive = clampNumber((loudness - 0.08) / 0.82, 0, 1, 0);
    const loudnessSpanLift = clampNumber(loudnessSpanDrive * 0.44, 0, 0.44, 0);
    const loudnessSpanPull = clampNumber((1 - loudnessSpanDrive) * 0.15, 0, 0.15, 0);
    const brightnessDrive = clampNumber(
      (baseBrightnessDrive * (1 + loudnessSpanLift + (musicalDriveEnvelope * 0.18))) - loudnessSpanPull,
      0,
      1,
      baseBrightnessDrive
    );
    const brightnessRangeDemand = clampNumber(
      (musicalDriveEnvelope * 0.46) +
      (loudnessSection * 0.28) +
      (impactSignal * 0.2) +
      (transientRise * 0.08) +
      (fluxRise * 0.05) +
      (beatPulse ? 0.12 : 0) +
      (loudnessSectionBand === "loud" ? 0.09 : (loudnessSectionBand === "quiet" ? -0.12 : 0)),
      0,
      1,
      0.46
    );
    const brightnessRangeLift = clampNumber(
      (brightnessRangeDemand - 0.38) * 0.7,
      0,
      0.42,
      0
    );
    const brightnessDriveExpanded = clampNumber(
      brightnessDrive + ((1 - brightnessDrive) * brightnessRangeLift),
      0,
      1,
      brightnessDrive
    );
    const brightnessDriveShaped = brightnessDriveExpanded;
    let brightness = clampNumber(
      dynamicBrightnessFloor + (
        brightnessDriveShaped *
        (tuning.brightnessCeil - dynamicBrightnessFloor)
      ),
      dynamicBrightnessFloor,
      tuning.brightnessCeil,
      dynamicBrightnessFloor
    );
    const brightnessPeakLift = clampNumber(
      (impactSignal * 0.03) +
      (musicalDriveEnvelope * 0.024) +
      (kickAccent * 0.026) +
      (beatPulse ? 0.07 : 0) +
      (loudnessCeilingDrive * 0.06),
      0,
      0.18,
      0
    );
    brightness = clampNumber(
      brightness + brightnessPeakLift,
      dynamicBrightnessFloor,
      tuning.brightnessCeil,
      brightness
    );
    const loudHeadroomPush = clampNumber(
      clampNumber((loudnessSection - 0.52) / 0.48, 0, 1, 0) * (
        (impactSignal * 0.52) +
        (motion * 0.24) +
        (musicalDriveEnvelope * 0.34) +
        (loudnessAdaptive * 0.1) +
        (beatPulse ? 0.76 : (beatStrong ? 0.27 : 0.1))
      ),
      0,
      1,
      0
    );
    if (loudHeadroomPush > 0) {
      brightness = clampNumber(
        brightness + ((tuning.brightnessCeil - brightness) * loudHeadroomPush),
        dynamicBrightnessFloor,
        tuning.brightnessCeil,
        brightness
      );
    }
    const loudActivationTrigger = (
      beatPulse ||
      impactSignal >= 0.22 ||
      transientRise >= 0.08 ||
      fluxRise >= 0.08
    );
    const loudActivationLift = loudActivationTrigger
      ? clampNumber(
        loudSectionNorm * (
          (impactSignal * 0.12) +
          (transient * 0.08) +
          (flux * 0.07) +
          (musicalDriveEnvelope * 0.1) +
          (beatPulse ? 0.14 : 0)
        ),
        0,
        0.16,
        0
      )
      : 0;
    if (loudActivationLift > 0) {
      brightness = clampNumber(
        brightness + ((tuning.brightnessCeil - brightness) * loudActivationLift),
        dynamicBrightnessFloor,
        tuning.brightnessCeil,
        brightness
      );
    }
    const saturationBurst = (
      (loudnessAdaptive >= 0.9 || musicalDriveEnvelope >= 0.84) &&
      (
        impactSignal >= 0.72 ||
        (beatPulse && motion >= 0.46) ||
        (musicalDriveEnvelope >= 0.9 && motion >= 0.4)
      )
    );
    if (saturationBurst) {
      const saturationTarget = clampNumber(
        0.92 +
        ((loudnessAdaptive - 0.92) * 0.9) +
        (beatPulse ? 0.04 : 0) +
        (impactSignal >= 0.9 ? 0.04 : 0),
        0.9,
        tuning.brightnessCeil,
        tuning.brightnessCeil
      );
      brightness = Math.max(brightness, saturationTarget);
    }
    if (sustainedSilence && loudnessSection < 0.4 && movementPresence < 0.16 && !beatPulse) {
      const quietCap = clampNumber(
        dynamicBrightnessFloor + ((tuning.brightnessCeil - dynamicBrightnessFloor) * 0.03),
        dynamicBrightnessFloor,
        tuning.brightnessCeil,
        dynamicBrightnessFloor
      );
      brightness = Math.min(brightness, quietCap);
    }
    const sectionSustainDemand = clampNumber(
      (loudnessRaw * 0.22) +
      (loudnessSection * 0.22) +
      (movementPresence * 0.12) +
      (musicalDriveEnvelope * 0.16) +
      (impactSignal * 0.07) +
      (beatPulse ? 0.06 : 0),
      0,
      1,
      0
    );
    const sectionSustainFloorNorm = loudnessSectionBand === "loud"
      ? clampNumber(0.22 + (sectionSustainDemand * 0.62), 0, 0.66, 0.34)
      : (loudnessSectionBand === "quiet"
        ? clampNumber(0.015 + (sectionSustainDemand * 0.18), 0, 0.16, 0.04)
        : clampNumber(0.08 + (sectionSustainDemand * 0.55), 0, 0.44, 0.2));
    if (sustainedSignalActive && !sustainedSilence) {
      const sectionSustainFloor = clampNumber(
        dynamicBrightnessFloor + (brightnessSpan * sectionSustainFloorNorm),
        dynamicBrightnessFloor,
        tuning.brightnessCeil,
        dynamicBrightnessFloor
      );
      brightness = Math.max(brightness, sectionSustainFloor);
    }
    if (!(brightnessOutputEma > 0)) {
      brightnessOutputEma = brightness;
    } else {
      const deltaRaw = brightness - brightnessOutputEma;
      const lowRange = brightnessOutputEma <= (tuning.brightnessFloor + 0.14);
      const microJitterGate = lowRange ? 0.014 : 0.01;
      const microJitterQuiet = (
        !beatPulse &&
        Math.abs(deltaRaw) <= microJitterGate &&
        movementPresence <= (lowRange ? 0.2 : 0.24) &&
        loudnessSectionBand !== "loud"
      );
      const outputRate = deltaRaw >= 0
        ? (
          beatPulse
            ? 0.42
            : (
              (lowRange ? 0.28 : 0.34) *
              (loudnessSectionBand === "quiet" ? 0.74 : 1)
            )
        )
        : clampNumber(
          (lowRange ? 0.2 : 0.24) +
          (quietSectionNorm * 0.1) +
          (loudnessSectionBand === "quiet" ? 0.06 : 0),
          0.16,
          0.56,
          lowRange ? 0.2 : 0.24
        );
      const jumpAttack = (
        beatPulse ||
        impactSignal >= 0.72 ||
        transient >= 0.58 ||
        flux >= 0.52
      );
      const boostedOutputRate = deltaRaw >= 0 && jumpAttack
        ? Math.max(outputRate, 0.5)
        : outputRate;
      const outputStepCap = deltaRaw >= 0
        ? (beatPulse ? 0.047 : (lowRange ? 0.03 : 0.04))
        : clampNumber(
          (lowRange ? 0.034 : 0.046) +
          (quietSectionNorm * 0.04) +
          (loudnessSectionBand === "quiet" ? 0.025 : 0),
          0.026,
          0.14,
          lowRange ? 0.034 : 0.046
        );
      const boostedStepCap = deltaRaw >= 0 && jumpAttack
        ? Math.max(outputStepCap, 0.054)
        : outputStepCap;
      const boundedStep = microJitterQuiet
        ? 0
        : clampNumber(
          deltaRaw * boostedOutputRate,
          -boostedStepCap,
          boostedStepCap,
          deltaRaw * boostedOutputRate
        );
      brightnessOutputEma = clampNumber(
        brightnessOutputEma + boundedStep,
        dynamicBrightnessFloor,
        tuning.brightnessCeil,
        brightness
      );
      const deadband = brightnessOutputEma <= (tuning.brightnessFloor + 0.12) ? 0.013 : 0.008;
      if (Math.abs(brightness - brightnessOutputEma) < deadband && !beatPulse) {
        brightness = brightnessOutputEma;
      } else {
        const directMix = jumpAttack ? 0.2 : (deltaRaw >= 0 ? 0.32 : 0.26);
        brightness = clampNumber(
          (brightness * directMix) + (brightnessOutputEma * (1 - directMix)),
          dynamicBrightnessFloor,
          tuning.brightnessCeil,
          brightness
        );
      }
    }

    const transitionMs = transitionStateTracker.resolveTransitionMs({
      beatPulse,
      bpmState,
      impactSignal,
      loudnessDeltaEma,
      loudnessSectionBand,
      sceneMotion,
      scenePace,
      transientRise,
      tuning
    });

    const spectralFlow = clampNumber(
      (lowBandRise * 0.44) +
      (highBandRise * 0.32) +
      (kickAccent * 0.2),
      0,
      1.6,
      0
    );
    const flowSectionGain = loudnessSectionBand === "quiet"
      ? 0.84
      : (loudnessSectionBand === "loud" ? 1.12 : 1);
    const flowIntensity = clampNumber(
      (0.62 + (motionWeighted * 1.95) + (spectralFlow * 0.48)) * flowSectionGain,
      0.38,
      3,
      1
    );

    return {
      energy,
      rms,
      peak,
      transient,
      flux,
      bandLow,
      bandMid,
      bandHigh,
      bpm: bpmState.bpm,
      beatConfidence,
      beat: beatStrong,
      beatPulse,
      sceneLock,
      sceneIntent,
      sceneCandidate,
      sceneCandidateConfidence,
      motion,
      impactSignal,
      loudness,
      loudnessAdaptive,
      loudnessSection,
      loudnessSectionBand,
      musicalProfile: musicalSectionProfile.profile,
      musicalDriveNorm: musicalSectionProfile.driveNorm,
      kickAccent,
      transientRise,
      fluxRise,
      flowIntensity,
      brightness,
      brightnessSourceRaw: clampNumber(brightnessDriverRaw / 1.4, 0, 1, 0),
      brightnessSourceNormalized: clampNumber(brightnessDriver, 0, 1, 0),
      brightnessMusicalDrive: musicalDriveEnvelope,
      brightnessRangeDemand,
      transitionMs,
      scopedRuntimeTuning: controls.scopedRuntimeTuning,
      cadenceState: {
        bpmSource: bpmState.source,
        paceConfidence: bpmState.confidence,
        telemetryBpm: bpmState.telemetryBpm,
        derivedBpm: bpmState.derivedBpm,
        sceneSwitchCooldownMs: effectiveTuning.sceneSwitchCooldownMs
      }
    };
  }

  return {
    computeSceneState,
    extractLiveRuntimeControls
  };
};
