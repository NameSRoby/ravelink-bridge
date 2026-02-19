// [TITLE] Module: wiz/wiz-energy-strategy.js
// [TITLE] Purpose: wiz-energy-strategy

const ROLE_COLORS = Object.freeze({
  kick: Object.freeze({ rgb: [70, 146, 245] }),
  snare: Object.freeze({ rgb: [176, 34, 44] })
});

let flip = false;

module.exports = function pickWizColor(intent) {
  const e = intent.energy ?? 0;
  if (e < 0.12) return null;

  // allow engine / MIDI to force band
  let role;
  if (intent.band === "kick" || intent.band === "snare") {
    role = intent.band;
  } else {
    flip = !flip;
    role = flip ? "kick" : "snare";
  }

  const [r, g, b] = ROLE_COLORS[role].rgb;

  return {
    band: role,
    r,
    g,
    b,
    dimming:
      role === "kick"
        ? Math.round(35 + e * 30)
        : Math.round(70 + e * 20)
  };
};
