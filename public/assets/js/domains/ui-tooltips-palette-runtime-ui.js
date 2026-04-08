// [TITLE] Module: public/assets/js/domains/ui-tooltips-palette-runtime-ui.js
// [TITLE] Purpose: palette tooltip copy ownership
// [TITLE] Functionality Index:
// [TITLE] - global palette vividness tooltips
// [TITLE] - palette family/disorder button tooltips

function applyPaletteUiTooltips({ el, setNodeTitle }) {
  setNodeTitle(el.paletteVividness, "Set global palette vividness. Swatch previews update live while dragging.");
  setNodeTitle(el.paletteVividnessResetBtn, "Reset vividness to HIGH.");
  getPaletteFamilyButtons().forEach(btn => {
    const key = String(btn.dataset.paletteFamilyTab || btn.dataset.paletteFamily || "").toUpperCase();
    setNodeTitle(btn, `Show ${key} library controls.`);
  });
  paletteDisorderButtons.forEach(btn => {
    const disorder = String(btn.dataset.paletteDisorder || "") === "true";
    setNodeTitle(
      btn,
      disorder
        ? "Disorder mode: play colors/families out of order."
        : "Ordered mode: play selected families in fixed sequence."
    );
  });
}

