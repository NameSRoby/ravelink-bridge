// [TITLE] Module: public/assets/js/domains/midi.js
// [TITLE] Purpose: MIDI runtime orchestrator (delegates to midi-runtime-ui module)
// [TITLE] Functionality Index:
// [TITLE] - instantiate MIDI runtime with app dependencies
// [TITLE] - expose global MIDI helpers used by telemetry/theme/bootstrap
// [TITLE] - wire MIDI control handlers
// [DEV] Complex Flow:
// [DEV] This orchestrator preserves existing global function names while moving
// [DEV] state/render and event wiring logic into a bounded runtime module.

const {
  normalizeMidiAction,
  formatMidiActionLabel,
  resolveMidiActionsList,
  parseMidiPortIndex,
  formatMidiBinding,
  setMidiTabForced,
  applyMidiTabVisibility,
  renderMidiActionsOptions,
  buildMidiBindingsDump,
  formatMidiEvent,
  populateMidiPorts,
  applyMidiBindingEditor,
  applyMidiSnapshot,
  collectMidiConfigPatch,
  collectMidiBindingPatch,
  loadMidiStatus,
  wireMidiControlsUi
} = (typeof createMidiRuntimeUi === "function"
  ? createMidiRuntimeUi({
    el,
    ui,
    documentRef: document,
    localStorageRef: localStorage,
    showTab: (typeof showTab === "function") ? showTab : (() => {}),
    renderSystemSettingsStatus: (typeof renderSystemSettingsStatus === "function")
      ? renderSystemSettingsStatus
      : (() => {}),
    normalizeStartTabPreference: (typeof normalizeStartTabPreference === "function")
      ? normalizeStartTabPreference
      : (value => String(value || "live").trim().toLowerCase() || "live"),
    setBadge: (node, state, text) => typeof setBadge === "function" ? setBadge(node, state, text) : undefined,
    MIDI_TAB_FORCE_KEY: (typeof MIDI_TAB_FORCE_KEY === "string" && MIDI_TAB_FORCE_KEY.trim())
      ? MIDI_TAB_FORCE_KEY
      : "ravelink_midi_tab_forced_v1",
    UI_START_TAB_KEY: (typeof UI_START_TAB_KEY === "string" && UI_START_TAB_KEY.trim())
      ? UI_START_TAB_KEY
      : "ravelink_ui_start_tab_v1",
    midiEndpointsAdapter: (
      typeof midiEndpointsAdapter === "object" &&
      midiEndpointsAdapter
    )
      ? midiEndpointsAdapter
      : null
  })
  : (() => {
    throw new Error("midi runtime module missing");
  })());

wireMidiControlsUi();
