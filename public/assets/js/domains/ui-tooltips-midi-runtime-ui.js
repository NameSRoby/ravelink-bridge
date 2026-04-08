// [TITLE] Module: public/assets/js/domains/ui-tooltips-midi-runtime-ui.js
// [TITLE] Purpose: MIDI tab tooltip copy ownership
// [TITLE] Functionality Index:
// [TITLE] - MIDI runtime status tooltips
// [TITLE] - MIDI config/learn/binding tooltips

function applyMidiUiTooltips({ el, setNodeTitle }) {
  setNodeTitle(el.midiTabToggleBtn, "Show or hide MIDI tab when no MIDI device is detected.");
  setNodeTitle(el.midiCogStatus, "Current MIDI detection + tab visibility policy.");
  setNodeTitle(el.midiConnectionSummary, "Plain-language MIDI connection state.");
  setNodeTitle(el.midiActivePortSummary, "Current controller port used for MIDI input.");
  setNodeTitle(el.midiPortCount, "Number of MIDI input ports discovered by the runtime.");
  setNodeTitle(el.midiConfiguredBindings, "Number of RaveLink actions currently mapped to MIDI inputs.");
  setNodeTitle(el.midiModuleStatus, "Whether Node MIDI module is available.");
  setNodeTitle(el.midiRuntimeStatus, "MIDI runtime connection status.");
  setNodeTitle(el.midiActivePort, "Currently opened MIDI input port.");
  setNodeTitle(el.midiLearnStatus, "Current MIDI learn target and timeout status.");
  setNodeTitle(el.midiLastEvent, "Most recent MIDI packet observed by runtime.");
  setNodeTitle(el.midiLastAction, "Most recent engine action triggered from MIDI.");
  setNodeTitle(el.midiEnabled, "Enable or disable MIDI input handling.");
  setNodeTitle(el.midiVelocityThreshold, "Default threshold used when learn mode creates a new binding.");
  setNodeTitle(el.midiPortSelect, "Preferred MIDI controller port. AUTO uses the first available matching port.");
  setNodeTitle(el.midiDeviceMatch, "Optional case-insensitive port-name contains matcher.");
  setNodeTitle(el.midiRefreshBtn, "Scan for MIDI controllers and reconnect runtime.");
  setNodeTitle(el.midiSaveCfgBtn, "Save controller selection and reconnect if needed.");
  setNodeTitle(el.midiActionGroup, "Filter the action picker to the control family you want to map.");
  setNodeTitle(el.midiLearnAction, "RaveLink action that learn mode will map to the next MIDI input.");
  setNodeTitle(el.midiSelectedActionSummary, "Selected action and current binding summary.");
  setNodeTitle(el.midiLearnArmBtn, "Arm learn mode for selected action.");
  setNodeTitle(el.midiLearnCancelBtn, "Cancel active learn mode.");
  setNodeTitle(el.midiTriggerBtn, "Trigger selected action directly for testing.");
  setNodeTitle(el.midiBindingAction, "Action whose binding you want to inspect or edit.");
  setNodeTitle(el.midiBindingType, "Binding message type.");
  setNodeTitle(el.midiBindingNumber, "MIDI note/CC number (0-127).");
  setNodeTitle(el.midiBindingChannel, "Optional MIDI channel filter (1-16). Leave blank for any.");
  setNodeTitle(el.midiBindingMinValue, "Minimum value required to trigger action (0-127).");
  setNodeTitle(el.midiBindingSaveBtn, "Save/update binding for selected action.");
  setNodeTitle(el.midiBindingClearBtn, "Remove binding for selected action.");
  setNodeTitle(el.midiBindingResetBtn, "Clear all MIDI bindings.");
  setNodeTitle(el.midiBindingsDump, "Current MIDI config and action bindings snapshot.");
}
