// [TITLE] Module: public/assets/js/domains/ui-tooltips-fixtures-runtime-ui.js
// [TITLE] Purpose: fixture setup tooltip copy ownership
// [TITLE] Functionality Index:
// [TITLE] - Hue sensitive-field reveal tooltips
// [TITLE] - WiZ onboarding/discovery helper tooltips

function applyFixturesUiTooltips({ el, setNodeTitle }) {
  setNodeTitle(el.fxBridgeIpShowBtn, "Reveal/hide Hue bridge IP after warning confirmation.");
  setNodeTitle(el.fxUsernameShowBtn, "Reveal/hide Hue username/app key after warning confirmation.");
  setNodeTitle(el.fxClientKeyShowBtn, "Reveal/hide Hue client key after warning confirmation.");
  setNodeTitle(el.fxWizIpShowBtn, "Reveal/hide WiZ IP after warning confirmation.");
  setNodeTitle(el.fxWizManualGuideBtn, "Show the WiZ manual-first onboarding checklist.");
  setNodeTitle(el.fxWizDiscoverBtn, "Optional helper: scan local LAN for WiZ devices.");
  setNodeTitle(el.fxWizDiscoverSelect, "Discovered WiZ devices list. Manual IP entry remains the primary path.");
  setNodeTitle(el.fxWizUseSelectedBtn, "Apply selected discovered WiZ device IP to the form.");
  setNodeTitle(el.fxWizClearDiscoveryBtn, "Clear optional WiZ discovery helper results.");
  setNodeTitle(el.fxWizOnboardingStatus, "Current WiZ onboarding helper status.");
}

