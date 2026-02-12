const GENRES = require("../colors/genre-palettes");
const genreState = require("../core/genre-state");

let flip = false; // 🔑 MUST be module-level (do not redeclare inside function)

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

  const genre = GENRES[genreState.get()] || GENRES.edm;
  const [r, g, b] = genre[role].rgb;

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
