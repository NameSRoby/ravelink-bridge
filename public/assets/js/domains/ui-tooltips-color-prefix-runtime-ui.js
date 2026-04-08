// [TITLE] Module: public/assets/js/domains/ui-tooltips-color-prefix-runtime-ui.js
// [TITLE] Purpose: Twitch color prefix tooltip copy ownership
// [TITLE] Functionality Index:
// [TITLE] - color prefix rule editor tooltips
// [TITLE] - RAVE-off color command mapping tooltips

function applyColorPrefixUiTooltips({ el, setNodeTitle }) {
  setNodeTitle(el.colorPrefixDefaultTarget, "Where unprefixed /color commands are sent.");
  setNodeTitle(el.colorPrefixRuleScope, "Choose whether this prefix rule targets a brand or one exact fixture.");
  setNodeTitle(el.colorPrefixRuleValue, "Prefix token for /color commands. Allowed: lowercase letters, numbers, underscore, dash. Leave blank to clear target prefix.");
  setNodeTitle(el.colorPrefixRuleBrand, "Apply this prefix to all fixtures of this brand route.");
  setNodeTitle(el.colorPrefixRuleFixture, "Apply this prefix to one exact fixture id.");
  setNodeTitle(el.colorPrefixRuleAddBtn, "Add a new prefix rule or update an existing one. Blank prefix clears target prefix.");
  setNodeTitle(el.colorPrefixRuleRemoveBtn, "Remove the currently selected prefix rule.");
  setNodeTitle(el.colorPrefixRuleList, "All active prefix rules. Fixture rules override brand rules.");
  setNodeTitle(el.colorRaveOffEnabled, "Enable automatic RAVE OFF end-color profile.");
  setNodeTitle(el.colorRaveOffDefault, "Default /color command for RAVE OFF when no override matches.");
  setNodeTitle(el.colorRaveOffGroupMap, "Advanced group rules. One line per rule: key=command where key is hue, wiz, hue:zone, or wiz:zone.");
  setNodeTitle(el.colorRaveOffFixtureMap, "Advanced fixture rules. One line per rule: fixtureId=command. Fixture rules override group/default.");
  setNodeTitle(el.colorPrefixSaveBtn, "Save all Twitch color routing settings on this panel.");
  setNodeTitle(el.colorPrefixResetBtn, "Reset Twitch color routing settings to defaults.");
}

