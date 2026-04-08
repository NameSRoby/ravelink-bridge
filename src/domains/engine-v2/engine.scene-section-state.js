// [TITLE] Module: domains/engine-v2/engine.scene-section-state.js
// [TITLE] Purpose: stateful loudness section derivation for Engine v2 scene shaping
// [TITLE] Functionality Index:
// [TITLE] - derive adaptive loudness and section-normalized loudness values
// [TITLE] - smooth quiet/normal/loud section transitions with hysteresis
// [TITLE] - expose loudness delta metadata for downstream brightness/motion shaping
// [DEV] This tracker owns section-level loudness memory only; brightness envelope
// [DEV] shaping remains in the main scene-state model until that lane is split.

const {
  clampNumber
} = require("./engine.contracts");
const {
  DEFAULT_RUNTIME_TUNING
} = require("./engine.scene-runtime-controls");

function createSceneSectionState() {
  let loudnessFloorEma = 0;
  let loudnessCeilEma = 0;
  let loudnessFastEma = 0;
  let loudnessSlowEma = 0;
  let loudnessSectionEma = 0;
  let loudnessSectionState = "normal";
  let loudnessSectionCandidate = "normal";
  let loudnessSectionStreak = 0;
  let lastLoudnessRaw = 0;

  function resolveLoudnessSectionState(sectionNorm = 0.5, loudnessAdaptive = 0.5) {
    const section = clampNumber(sectionNorm, 0, 1, 0.5);
    const adaptive = clampNumber(loudnessAdaptive, 0, 1, 0.5);
    const state = String(loudnessSectionState || "normal").trim().toLowerCase() || "normal";
    let target = state;

    if (state === "quiet") {
      if (section >= 0.52) target = "normal";
    } else if (state === "loud") {
      if (section <= 0.52) target = "normal";
    } else {
      const quietCandidate = (
        (section <= 0.4 && adaptive <= 0.62) ||
        (section <= 0.44 && adaptive <= 0.34)
      );
      if (quietCandidate) target = "quiet";
      else if (section >= 0.6 || adaptive >= 0.72) target = "loud";
    }

    if (target === loudnessSectionCandidate) {
      loudnessSectionStreak += 1;
    } else {
      loudnessSectionCandidate = target;
      loudnessSectionStreak = 1;
    }

    const strongQuiet = target === "quiet" && section <= 0.3;
    const strongLoud = target === "loud" && section >= 0.74;
    const required = strongQuiet || strongLoud ? 1 : (target === state ? 1 : 2);
    if (loudnessSectionStreak >= required) {
      loudnessSectionState = target;
    }
    return loudnessSectionState;
  }

  function update(input = {}) {
    const tuning = input.tuning && typeof input.tuning === "object" ? input.tuning : DEFAULT_RUNTIME_TUNING;
    const rms = clampNumber(input.rms, 0, 1, 0);
    const energy = clampNumber(input.energy, 0, 1, 0);
    const loudnessRaw = clampNumber((rms * 0.62) + (energy * 0.38), 0, 1, 0);

    if (loudnessFloorEma <= 0 && loudnessCeilEma <= 0) {
      const seedSpan = Math.max(
        clampNumber(tuning.loudnessAdaptiveMinSpan, 0.04, 0.5, 0.1),
        0.12
      );
      loudnessFloorEma = clampNumber(loudnessRaw - (seedSpan * 0.55), 0, 1, loudnessRaw);
      loudnessCeilEma = clampNumber(loudnessRaw + (seedSpan * 0.55), 0, 1, loudnessRaw);
    } else {
      const floorSmoothing = loudnessRaw <= loudnessFloorEma
        ? tuning.loudnessFloorAttack
        : tuning.loudnessFloorRelease;
      const ceilSmoothing = loudnessRaw >= loudnessCeilEma
        ? tuning.loudnessCeilAttack
        : tuning.loudnessCeilRelease;
      loudnessFloorEma = clampNumber(
        loudnessFloorEma + ((loudnessRaw - loudnessFloorEma) * floorSmoothing),
        0,
        1,
        loudnessRaw
      );
      loudnessCeilEma = clampNumber(
        loudnessCeilEma + ((loudnessRaw - loudnessCeilEma) * ceilSmoothing),
        0,
        1,
        loudnessRaw
      );
    }
    const loudnessAdaptiveSpan = Math.max(
      clampNumber(tuning.loudnessAdaptiveMinSpan, 0.04, 0.5, 0.1),
      loudnessCeilEma - loudnessFloorEma
    );
    const loudnessAdaptive = clampNumber(
      (loudnessRaw - loudnessFloorEma) / Math.max(0.0001, loudnessAdaptiveSpan),
      0,
      1,
      0
    );
    if (!(loudnessFastEma > 0) && !(loudnessSlowEma > 0)) {
      loudnessFastEma = loudnessRaw;
      loudnessSlowEma = loudnessRaw;
    } else {
      const fastRate = loudnessRaw >= loudnessFastEma ? 0.28 : 0.18;
      const slowRate = loudnessRaw >= loudnessSlowEma ? 0.05 : 0.03;
      loudnessFastEma = clampNumber(
        loudnessFastEma + ((loudnessRaw - loudnessFastEma) * fastRate),
        0,
        1,
        loudnessRaw
      );
      loudnessSlowEma = clampNumber(
        loudnessSlowEma + ((loudnessRaw - loudnessSlowEma) * slowRate),
        0,
        1,
        loudnessRaw
      );
    }
    const loudnessTrend = clampNumber(
      0.5 + (((loudnessFastEma - loudnessSlowEma) / 0.18) * 0.5),
      0,
      1,
      0.5
    );
    const loudnessAbsolute = clampNumber(
      (loudnessRaw * 0.66) + (loudnessAdaptive * 0.34),
      0,
      1,
      0
    );
    const loudnessSectionRaw = clampNumber(
      (loudnessAdaptive * 0.42) +
      (loudnessAbsolute * 0.48) +
      (loudnessTrend * 0.1),
      0,
      1,
      loudnessAbsolute
    );
    if (!(loudnessSectionEma > 0)) {
      loudnessSectionEma = loudnessSectionRaw;
    } else {
      const sectionRate = loudnessSectionRaw >= loudnessSectionEma ? 0.28 : 0.22;
      loudnessSectionEma = clampNumber(
        loudnessSectionEma + ((loudnessSectionRaw - loudnessSectionEma) * sectionRate),
        0,
        1,
        loudnessSectionRaw
      );
    }
    const loudnessSection = clampNumber(
      (loudnessSectionRaw * 0.54) + (loudnessSectionEma * 0.46),
      0,
      1,
      loudnessSectionRaw
    );
    const loudness = clampNumber(
      (loudnessRaw * 0.18) + (loudnessAdaptive * 0.56) + (loudnessSection * 0.26),
      0,
      1,
      0
    );
    const loudnessSectionBand = resolveLoudnessSectionState(loudnessSection, loudnessAdaptive);
    const loudnessDelta = clampNumber(Math.abs(loudnessRaw - lastLoudnessRaw), 0, 1, 0);
    const loudnessDeltaNorm = clampNumber(
      loudnessDelta / Math.max(0.0001, loudnessAdaptiveSpan),
      0,
      1,
      0
    );
    lastLoudnessRaw = loudnessRaw;

    return {
      loudness,
      loudnessAdaptive,
      loudnessAdaptiveSpan,
      loudnessRaw,
      loudnessSection,
      loudnessSectionBand,
      loudnessSectionRaw,
      loudnessDelta,
      loudnessDeltaNorm
    };
  }

  return {
    resolveLoudnessSectionState,
    update
  };
}

module.exports = {
  createSceneSectionState
};
