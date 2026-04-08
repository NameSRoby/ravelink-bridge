// [TITLE] Module: public/assets/js/domains/ui-tooltips.js
// [TITLE] Purpose: tooltip composer for domain-owned tooltip providers
// [TITLE] Functionality Index:
// [TITLE] - tooltip helper (`setNodeTitle`)
// [TITLE] - full tooltip hydration pass (`applyUiTooltips`)
// [DEV] Complex Flow:
// [DEV] Tooltip copy is owned by domain-specific provider scripts. Keep this file
// [DEV] composition-only so it does not become a hidden UI knowledge dump again.

function setNodeTitle(node, text) {
  if (!node) return;
  node.title = text;
}

function applyUiTooltips() {
  const providers = [
    typeof applyLiveUiTooltips === "function" ? applyLiveUiTooltips : null,
    typeof applyAudioUiTooltips === "function" ? applyAudioUiTooltips : null,
    typeof applyPaletteUiTooltips === "function" ? applyPaletteUiTooltips : null,
    typeof applyColorPrefixUiTooltips === "function" ? applyColorPrefixUiTooltips : null,
    typeof applyModsUiTooltips === "function" ? applyModsUiTooltips : null,
    typeof applySystemUiTooltips === "function" ? applySystemUiTooltips : null,
    typeof applyFixturesUiTooltips === "function" ? applyFixturesUiTooltips : null,
    typeof applyMidiUiTooltips === "function" ? applyMidiUiTooltips : null
  ].filter(Boolean);

  for (const provider of providers) {
    provider({ el, setNodeTitle });
  }
}
