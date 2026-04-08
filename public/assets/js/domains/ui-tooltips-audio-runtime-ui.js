// [TITLE] Module: public/assets/js/domains/ui-tooltips-audio-runtime-ui.js
// [TITLE] Purpose: AUDIO tab tooltip copy ownership
// [TITLE] Functionality Index:
// [TITLE] - audio capture/config tooltips
// [TITLE] - app-isolation and reactivity map tooltips

function applyAudioUiTooltips({ el, setNodeTitle }) {
  setNodeTitle(el.aResetDefaultsBtn, "Restore audio controls to defaults and apply immediately.");
  setNodeTitle(el.aOptionalToolsBanner, "Optional app-isolation tool status and install guidance.");
  setNodeTitle(el.aOptionalToolsInfoBtn, "Show simple install instructions for optional audio tools.");
  setNodeTitle(el.aOptionalToolsDismissBtn, "Hide this optional-tools banner.");
  setNodeTitle(el.aTuningModeEasyBtn, "Show everyday audio tuning controls (default).");
  setNodeTitle(el.aTuningModeAdvancedBtn, "Show advanced tuning controls for troubleshooting and limiter shaping.");
  setNodeTitle(el.aTuningModeHint, "Current audio tuning mode summary.");
  setNodeTitle(el.aIsoSimpleMode, "Hide advanced app-isolation controls for easier setup.");
  setNodeTitle(el.aAppsShowAll, "Show every running process, not just likely audio-capable apps.");
  setNodeTitle(el.aAppsFilterHint, "Current app list filtering mode and count.");
  setNodeTitle(el.reactHardwareRateLimitsEnabled, "Recommended ON: clamp Hue/WiZ send rates to hardware-safe ranges. Turn off only for controlled testing.");
  setNodeTitle(el.reactMapStatus, "Current global audio reactivity filter summary.");
}

