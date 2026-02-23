// [TITLE] Module: core/midi/action-normalizer.js
// [TITLE] Purpose: shared MIDI action alias normalization

const ACTION_ALIAS_MAP = Object.freeze({
  overclock: "overclock_toggle",
  oc: "overclock_toggle",
  behavior_auto: "behavior_interpret",
  behavior_clamp: "behavior_interpret",
  flow_up: "flow_intensity_up",
  flow_down: "flow_intensity_down",
  flow_reset: "flow_intensity_reset",
  palette_all_1: "palette_preset_all_1",
  palette_all_3: "palette_preset_all_3",
  palette_duo_cool: "palette_preset_duo_cool",
  palette_duo_warm: "palette_preset_duo_warm",
  palette_family_amber: "palette_family_yellow",
  palette_family_lime: "palette_family_yellow",
  palette_family_aqua: "palette_family_cyan",
  palette_family_teal: "palette_family_cyan",
  palette_family_purple: "palette_family_red",
  palette_family_magenta: "palette_family_red",
  palette_family_pink: "palette_family_red"
});

function normalizeMidiActionAlias(action) {
  const raw = String(action || "").trim().toLowerCase();
  if (!raw) return "";
  return ACTION_ALIAS_MAP[raw] || raw;
}

module.exports = {
  ACTION_ALIAS_MAP,
  normalizeMidiActionAlias
};
