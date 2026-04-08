// [TITLE] Module: public/assets/js/shared/ui-contract.js
// [TITLE] Purpose: early-loaded shared browser UI constants and cross-domain contracts
// [TITLE] Functionality Index:
// [TITLE] - shared storage keys used across browser domains
// [TITLE] - theme preset contract and shared UI prompt text
// [TITLE] - shared fixture/mod tokens and dev overclock level mapping
// [DEV] Complex Flow:
// [DEV] This file must load before browser domain scripts that reference shared keys
// [DEV] or constants. Keep this module data-only so later domain files can safely
// [DEV] consume these values without depending on late-loaded app.js ownership.

const THEME_STORAGE_KEY = "ravelink_ui_theme_v1";
const OBS_DOCK_COMPACT_KEY = "ravelink_obs_dock_compact_v1";
const PALETTE_FIXTURE_SELECTION_KEY = "ravelink_palette_fixture_selection_v1";
const DEFAULT_THEME_NAME = "midnight";

const THEME_PRESETS = Object.freeze({
  midnight: Object.freeze({
    bg: "#040509",
    panel: "#0a0d18",
    panel2: "#11182b",
    accent: "#980022",
    edge: "#24304f",
    btnBg: "#13192b",
    text: "#f0edf2",
    ok: "#27e37a",
    warn: "#ffbd38",
    bad: "#ff4e5e",
    glow: 64
  }),
  ember: Object.freeze({
    bg: "#110807",
    panel: "#181012",
    panel2: "#261719",
    accent: "#cf4e21",
    edge: "#5d302b",
    btnBg: "#291916",
    text: "#f5e8de",
    ok: "#73ea8c",
    warn: "#ffc46a",
    bad: "#ff645c",
    glow: 56
  }),
  ocean: Object.freeze({
    bg: "#050c14",
    panel: "#081723",
    panel2: "#0f2232",
    accent: "#1298c8",
    edge: "#27506a",
    btnBg: "#132434",
    text: "#e7f2fb",
    ok: "#41e7b3",
    warn: "#ffd36c",
    bad: "#ff6680",
    glow: 60
  }),
  matrix: Object.freeze({
    bg: "#020806",
    panel: "#07120f",
    panel2: "#0c1d19",
    accent: "#12c96c",
    edge: "#214a3a",
    btnBg: "#10201c",
    text: "#ddf6e7",
    ok: "#38f284",
    warn: "#d4ff63",
    bad: "#ff4f67",
    glow: 68
  }),
  aurora: Object.freeze({
    bg: "#050914",
    panel: "#0a1422",
    panel2: "#13233a",
    accent: "#24d6c6",
    edge: "#2a5b74",
    btnBg: "#132137",
    text: "#eef8ff",
    ok: "#67f7a5",
    warn: "#ffd36a",
    bad: "#ff5e7a",
    glow: 70
  }),
  solar: Object.freeze({
    bg: "#130c06",
    panel: "#1c120a",
    panel2: "#2c1d0f",
    accent: "#f07d22",
    edge: "#6b3d19",
    btnBg: "#281a10",
    text: "#fff0dc",
    ok: "#9be870",
    warn: "#ffd166",
    bad: "#ff6257",
    glow: 52
  }),
  glacier: Object.freeze({
    bg: "#061017",
    panel: "#0b1820",
    panel2: "#142631",
    accent: "#7dd3fc",
    edge: "#315b72",
    btnBg: "#152431",
    text: "#edf8ff",
    ok: "#6ee7b7",
    warn: "#fde68a",
    bad: "#fb7185",
    glow: 48
  })
});

const DEV_DEBUG_KEY = "ravelink_dev_debug_v1";
const DEV_DEBUG_WARN_ONCE_KEY = "ravelink_dev_debug_warn_once_v1";
const DEV_OVERCLOCK_COMICAL_ACK_KEY = "ravelink_dev_overclock_comical_ack_v1";
const MOD_UI_SELECTED_KEY = "ravelink_mod_ui_selected_v1";
const ONBOARD_ACK_KEY = "ravelink_onboard_ack_v1";
const HUE_ENT_GUIDE_ACK_KEY = "ravelink_hue_ent_guide_ack_v1";
const UI_STORAGE_MIGRATION_KEY = "ravelink_ui_storage_migration_v1";
const UI_STORAGE_MIGRATION_TARGET = "2026-02-19-v1.5-repack-pass-2";
const UI_START_TAB_KEY = "ravelink_ui_start_tab_v1";
const UI_CONFIRM_DANGER_KEY = "ravelink_ui_confirm_danger_v1";
const UI_POLL_PAUSED_KEY = "ravelink_ui_poll_paused_v1";
const MIDI_TAB_FORCE_KEY = "ravelink_midi_tab_forced_v1";
const AUDIO_APPS_SHOW_ALL_KEY = "ravelink_audio_apps_show_all_v1";
const AUDIO_SIMPLE_MODE_KEY = "ravelink_audio_simple_mode_v1";
const AUDIO_OPTIONAL_TOOLS_DISMISS_KEY = "ravelink_audio_optional_tools_dismissed_v1";
const AUDIO_TUNING_MODE_KEY = "ravelink_audio_tuning_mode_v1";
const LIVE_PROFILE_STORE_KEY = "ravelink_live_profiles_v1";
const LIVE_PROFILE_LAST_KEY = "ravelink_live_profile_last_v1";
const LIVE_PROFILE_LAST_APPLIED_KEY = "ravelink_live_profile_last_applied_v1";
const DEV_OVERCLOCK_COMICAL_TEXT = "I AM REALLY REALLY REALLY REALLY REALLY REALLY REALLY SURE";
const UNSAFE_LOG_ACK_PHRASE = "I_UNDERSTAND_SENSITIVE_LOG_RISK";
const MOD_BRAND_RE = /^[a-z][a-z0-9_-]{1,31}$/;
const FIXTURE_MOD_CUSTOM_BRAND_VALUE = "__mod_custom__";
const DEV_OVERCLOCK_LEVEL_BY_HZ = Object.freeze({
  20: 8,
  30: 9,
  40: 10,
  50: 11,
  60: 12
});
