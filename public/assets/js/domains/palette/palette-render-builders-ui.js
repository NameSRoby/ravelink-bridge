// [TITLE] Module: public/assets/js/domains/palette/palette-render-builders-ui.js
// [TITLE] Purpose: pure HTML builders for the palette global/custom editing surfaces
// [TITLE] Functionality Index:
// [TITLE] - custom family color bank editor markup
// [TITLE] - active sequence editor markup
// [TITLE] - family library editor markup
// [TITLE] - scoped family color editor markup
// [DEV] Complex Flow:
// [DEV] This module stays render-only. It accepts all normalization, color math, and
// [DEV] label/escape helpers via dependency injection so palette.js keeps ownership of
// [DEV] mutable state, DOM lifecycle, and API patch behavior.

function createPaletteRenderBuildersUi(deps = {}) {
  const clampNumber = typeof deps.clampNumber === "function"
    ? deps.clampNumber
    : ((value, min, max, fallback = min) => {
        const n = Number(value);
        if (!Number.isFinite(n)) return fallback;
        return Math.min(max, Math.max(min, n));
      });
  const escapeHtmlUi = typeof deps.escapeHtmlUi === "function"
    ? deps.escapeHtmlUi
    : (value => String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;"));
  const normalizePaletteBrandUi = typeof deps.normalizePaletteBrandUi === "function"
    ? deps.normalizePaletteBrandUi
    : (value => String(value || "").trim().toLowerCase());
  const normalizePaletteSequenceFamilyUi = typeof deps.normalizePaletteSequenceFamilyUi === "function"
    ? deps.normalizePaletteSequenceFamilyUi
    : (value => String(value || "").trim().toLowerCase());
  const normalizePaletteVividnessUi = typeof deps.normalizePaletteVividnessUi === "function"
    ? deps.normalizePaletteVividnessUi
    : (value => clampNumber(Math.round(Number(value) || 0), 0, 4, 2));
  const normalizePaletteCustomFamilyColorsUi = typeof deps.normalizePaletteCustomFamilyColorsUi === "function"
    ? deps.normalizePaletteCustomFamilyColorsUi
    : (value => Array.isArray(value) ? value : []);
  const getPaletteFamilyColorBankUi = typeof deps.getPaletteFamilyColorBankUi === "function"
    ? deps.getPaletteFamilyColorBankUi
    : (() => []);
  const parsePaletteColorSequenceEntryUi = typeof deps.parsePaletteColorSequenceEntryUi === "function"
    ? deps.parsePaletteColorSequenceEntryUi
    : (entry => entry || null);
  const buildPaletteColorSwatchStyleUi = typeof deps.buildPaletteColorSwatchStyleUi === "function"
    ? deps.buildPaletteColorSwatchStyleUi
    : (() => "");
  const applyPaletteVividnessToColorUi = typeof deps.applyPaletteVividnessToColorUi === "function"
    ? deps.applyPaletteVividnessToColorUi
    : (color => color || { r: 255, g: 255, b: 255 });
  const paletteRgbToHexUi = typeof deps.paletteRgbToHexUi === "function"
    ? deps.paletteRgbToHexUi
    : (() => "#ffffff");

  function buildPaletteCustomFamilyDefineEditorUi(options = {}) {
    const scope = String(options.scope || "global").trim().toLowerCase();
    const brand = normalizePaletteBrandUi(options.brand || "");
    const colors = Array.isArray(options.colors) ? options.colors : [];
    const makeAttr = (action, index) => {
      const safeIndex = Math.max(0, Math.round(Number(index) || 0));
      if (scope === "brand" && brand) {
        return `${action}="${brand}" data-color-index="${safeIndex}"`;
      }
      return `${action}="${safeIndex}"`;
    };
    const rows = colors.map((color, idx) => {
      const swatchStyle = buildPaletteColorSwatchStyleUi(color);
      const value = paletteRgbToHexUi(color);
      const inputAttrs = makeAttr(
        scope === "brand" ? "data-palette-brand-custom-color-value" : "data-palette-custom-color-value",
        idx
      );
      const removeAttrs = makeAttr(
        scope === "brand" ? "data-palette-brand-custom-color-remove" : "data-palette-custom-color-remove",
        idx
      );
      return (
        `<div class="paletteCustomColorControl">` +
          `<span class="paletteCustomColorSwatch" style="${swatchStyle}" title="Custom color ${idx + 1}"></span>` +
          `<input class="paletteCustomColorInput" type="color" value="${value}" ${inputAttrs} title="Set custom color ${idx + 1}.">` +
          `<button type="button" class="paletteCustomColorRemove" ${removeAttrs} ${colors.length <= 1 ? "disabled" : ""} title="Remove this custom color.">-</button>` +
        `</div>`
      );
    }).join("");
    const addAttrs = makeAttr(
      scope === "brand" ? "data-palette-brand-custom-color-add" : "data-palette-custom-color-add",
      colors.length
    );
    return (
      `<div class="paletteCustomBank">` +
        `<p class="paletteCustomBankLabel">DEFINE CUSTOM COLORS</p>` +
        `<div class="paletteCustomBankList">${rows}</div>` +
        `<button type="button" class="paletteCustomColorAdd" ${addAttrs} title="Add a new custom color.">+ ADD CUSTOM COLOR</button>` +
      `</div>`
    );
  }

  function buildPaletteGlobalActiveSequenceEditorUi(options = {}) {
    const sequence = Array.isArray(options.sequence) ? options.sequence : [];
    const vividness = normalizePaletteVividnessUi(options.vividness, 2);
    const customFamilyColors = normalizePaletteCustomFamilyColorsUi(options.customFamilyColors, []);
    const entries = sequence.map((entry, order) => {
      const family = normalizePaletteSequenceFamilyUi(entry?.family);
      if (!family) return "";
      const bank = family === "custom"
        ? customFamilyColors
        : getPaletteFamilyColorBankUi(family, { customFamilyColors });
      const colorIndex = clampNumber(Math.round(Number(entry?.index) || 0), 0, Math.max(0, bank.length - 1), 0);
      const baseColor = bank[colorIndex] || { r: 255, g: 255, b: 255 };
      const vividColor = applyPaletteVividnessToColorUi(baseColor, vividness);
      const swatchStyle = buildPaletteColorSwatchStyleUi(vividColor);
      const swatchDataAttrs =
        ` data-palette-base-r="${clampNumber(Math.round(Number(baseColor?.r) || 0), 0, 255, 0)}"` +
        ` data-palette-base-g="${clampNumber(Math.round(Number(baseColor?.g) || 0), 0, 255, 0)}"` +
        ` data-palette-base-b="${clampNumber(Math.round(Number(baseColor?.b) || 0), 0, 255, 0)}"`;
      const label = `${family.toUpperCase()} ${colorIndex + 1}`;
      return (
        `<div class="paletteColorEntry paletteSequenceEntry" draggable="true" data-palette-seq-drag-index="${order}" data-palette-seq-drop-index="${order}" data-palette-seq-entry-index="${order}" title="Drag to reorder.">` +
          `<button type="button" class="paletteColorChip paletteColorChip--selected" draggable="true" data-palette-seq-drag-index="${order}" data-palette-seq-remove="${order}"${swatchDataAttrs} style="${swatchStyle}" title="Remove ${label} from active sequence.">${order + 1}</button>` +
          `<button type="button" class="paletteSequenceTag paletteSequenceTagBtn" draggable="true" data-palette-seq-drag-index="${order}" data-palette-seq-remove="${order}" title="Remove ${label} from active sequence.">${label}</button>` +
          `<button type="button" class="paletteColorMoveBtn" data-palette-seq-shift-index="${order}" data-palette-seq-shift-dir="-1" ${order === 0 ? "disabled" : ""} title="Move this color earlier in the active sequence.">&lt;</button>` +
          `<button type="button" class="paletteColorMoveBtn" data-palette-seq-shift-index="${order}" data-palette-seq-shift-dir="1" ${order === (sequence.length - 1) ? "disabled" : ""} title="Move this color later in the active sequence.">&gt;</button>` +
        `</div>`
      );
    }).filter(Boolean).join("");
    return (
      `<div class="paletteFamilyCard paletteFamilyCard--sequence" data-palette-sequence-card>` +
        `<p class="paletteFamilyLibraryLabel">ACTIVE SEQUENCE</p>` +
        `<div class="paletteFamilyCountRow">` +
          `<span>ORDERED LIST</span>` +
          `<span class="paletteFamilyCountValue">${sequence.length}</span>` +
        `</div>` +
        `<div class="paletteColorRow paletteColorRow--selected paletteSequenceList" data-palette-sequence-list>` +
          (entries || `<span class="hint">Select colors from the family libraries below.</span>`) +
          `<div class="paletteSequenceTailDrop" data-palette-seq-drop-index="${sequence.length}" title="Drop here to place at end.">DROP END</div>` +
        `</div>` +
        `<p class="hint">Drag chips to reorder, use arrows for precise moves, and click a chip/tag to remove it.</p>` +
      `</div>`
    );
  }

  function buildPaletteGlobalFamilyLibraryEditorUi(options = {}) {
    const family = normalizePaletteSequenceFamilyUi(options.family);
    if (!family) return "";
    const vividness = normalizePaletteVividnessUi(options.vividness, 2);
    const rawLabel = String(options.familyLabel || family.toUpperCase()).trim().toUpperCase() || family.toUpperCase();
    const escapedLabel = escapeHtmlUi(rawLabel);
    const customDefineColors = Array.isArray(options.customDefineColors) ? options.customDefineColors : [];
    const baseColors = Array.isArray(options.baseColors) ? options.baseColors : [];
    const sequence = Array.isArray(options.sequence) ? options.sequence : [];
    const hidden = options.hidden === true;
    const selectedSet = new Set(
      sequence
        .map(entry => parsePaletteColorSequenceEntryUi(entry))
        .filter(entry => entry && entry.family === family)
        .map(entry => `${entry.family}:${entry.index}`)
    );
    const selectedCount = Array.from(selectedSet.values()).length;
    const bankButtons = baseColors.map((baseColor, idx) => {
      const vividColor = applyPaletteVividnessToColorUi(baseColor, vividness);
      const swatchStyle = buildPaletteColorSwatchStyleUi(vividColor);
      const swatchDataAttrs =
        ` data-palette-base-r="${clampNumber(Math.round(Number(baseColor?.r) || 0), 0, 255, 0)}"` +
        ` data-palette-base-g="${clampNumber(Math.round(Number(baseColor?.g) || 0), 0, 255, 0)}"` +
        ` data-palette-base-b="${clampNumber(Math.round(Number(baseColor?.b) || 0), 0, 255, 0)}"`;
      const key = `${family}:${idx}`;
      const selected = selectedSet.has(key);
      return (
        `<button type="button" class="paletteColorChip ${selected ? "active" : ""}" data-palette-family-color-toggle="${family}" data-color-index="${idx}"${swatchDataAttrs} style="${swatchStyle}" title="${selected ? `Remove ${escapedLabel} ${idx + 1} from active sequence.` : `Add ${escapedLabel} ${idx + 1} to active sequence.`}">${idx + 1}</button>`
      );
    }).join("");
    const customColorEditor = family === "custom"
      ? buildPaletteCustomFamilyDefineEditorUi({ scope: "global", colors: customDefineColors })
      : "";
    return (
      `<div class="paletteFamilyCard ${hidden ? "isHidden" : ""}" data-palette-family-card="${family}">` +
        `<p class="paletteFamilyLibraryLabel">${escapedLabel}</p>` +
        `<div class="paletteFamilyCountRow">` +
          `<span>SELECTED</span>` +
          `<span class="paletteFamilyCountValue">${selectedCount}/${baseColors.length}</span>` +
        `</div>` +
        `<div class="paletteColorRow paletteColorRow--bank">${bankButtons}</div>` +
        customColorEditor +
      `</div>`
    );
  }

  function buildPaletteFamilyColorEditorUi(options = {}) {
    const family = String(options.family || "").trim().toLowerCase();
    const familyLabel = String(options.familyLabel || family.toUpperCase()).trim() || family.toUpperCase();
    const escapedFamilyLabel = escapeHtmlUi(familyLabel);
    const scope = String(options.scope || "global").trim().toLowerCase();
    const brand = normalizePaletteBrandUi(options.brand || "");
    const selectedIndexes = Array.isArray(options.selectedIndexes)
      ? options.selectedIndexes.map(idx => Math.round(Number(idx))).filter(Number.isFinite)
      : [];
    const colors = Array.isArray(options.colors) ? options.colors : [];
    const baseColors = Array.isArray(options.baseColors) && options.baseColors.length
      ? options.baseColors
      : colors;
    const customDefineColors = Array.isArray(options.customDefineColors)
      ? options.customDefineColors
      : colors;

    const makeActionAttrs = (action, index, extra = "") => {
      const safeIndex = Math.max(0, Math.round(Number(index) || 0));
      if (scope === "brand" && brand) {
        return `${action}="${brand}" data-family="${family}" data-color-index="${safeIndex}"${extra}`;
      }
      return `${action}="${family}" data-color-index="${safeIndex}"${extra}`;
    };

    const selectedButtons = selectedIndexes.map((idx, order) => {
      const safeIndex = clampNumber(idx, 0, Math.max(0, colors.length - 1), 0);
      const color = colors[safeIndex] || { r: 0, g: 0, b: 0 };
      const baseColor = baseColors[safeIndex] || color;
      const swatchStyle = buildPaletteColorSwatchStyleUi(color);
      const swatchDataAttrs =
        ` data-palette-base-r="${clampNumber(Math.round(Number(baseColor?.r) || 0), 0, 255, 0)}"` +
        ` data-palette-base-g="${clampNumber(Math.round(Number(baseColor?.g) || 0), 0, 255, 0)}"` +
        ` data-palette-base-b="${clampNumber(Math.round(Number(baseColor?.b) || 0), 0, 255, 0)}"`;
      const removeAttrs = makeActionAttrs(
        scope === "brand" ? "data-palette-brand-family-color-remove" : "data-palette-family-color-remove",
        safeIndex
      );
      const moveLeftAttrs = makeActionAttrs(
        scope === "brand" ? "data-palette-brand-family-color-move" : "data-palette-family-color-move",
        safeIndex,
        ' data-dir="-1"'
      );
      const moveRightAttrs = makeActionAttrs(
        scope === "brand" ? "data-palette-brand-family-color-move" : "data-palette-family-color-move",
        safeIndex,
        ' data-dir="1"'
      );
      return (
        `<div class="paletteColorEntry">` +
          `<button type="button" class="paletteColorChip paletteColorChip--selected" ${removeAttrs}${swatchDataAttrs} style="${swatchStyle}" title="Remove ${escapedFamilyLabel} color ${safeIndex + 1} from sequence.">${order + 1}</button>` +
          `<button type="button" class="paletteColorMoveBtn" ${moveLeftAttrs} ${order === 0 ? "disabled" : ""} title="Move this color earlier in the sequence.">&lt;</button>` +
          `<button type="button" class="paletteColorMoveBtn" ${moveRightAttrs} ${order === (selectedIndexes.length - 1) ? "disabled" : ""} title="Move this color later in the sequence.">&gt;</button>` +
        `</div>`
      );
    }).join("");

    const bankButtons = colors.map((color, idx) => {
      const baseColor = baseColors[idx] || color;
      const swatchStyle = buildPaletteColorSwatchStyleUi(color);
      const swatchDataAttrs =
        ` data-palette-base-r="${clampNumber(Math.round(Number(baseColor?.r) || 0), 0, 255, 0)}"` +
        ` data-palette-base-g="${clampNumber(Math.round(Number(baseColor?.g) || 0), 0, 255, 0)}"` +
        ` data-palette-base-b="${clampNumber(Math.round(Number(baseColor?.b) || 0), 0, 255, 0)}"`;
      const selected = selectedIndexes.includes(idx);
      const addAttrs = makeActionAttrs(
        scope === "brand" ? "data-palette-brand-family-color-add" : "data-palette-family-color-add",
        idx
      );
      return (
        `<button type="button" class="paletteColorChip ${selected ? "active" : ""}" ${addAttrs}${swatchDataAttrs} style="${swatchStyle}" ${selected ? "disabled" : ""} title="${selected ? "Already selected" : `Add ${escapedFamilyLabel} color ${idx + 1} to sequence`}">${idx + 1}</button>`
      );
    }).join("");
    const customColorEditor = family === "custom"
      ? buildPaletteCustomFamilyDefineEditorUi({ scope, brand, colors: customDefineColors })
      : "";

    return (
      `<div class="paletteFamilyCountRow">` +
        `<span>SELECTED</span>` +
        `<span class="paletteFamilyCountValue">${selectedIndexes.length}/${colors.length}</span>` +
      `</div>` +
      `<div class="paletteColorRow paletteColorRow--selected">${selectedButtons || `<span class="hint">Select at least one color.</span>`}</div>` +
      `<div class="paletteColorRow paletteColorRow--bank">${bankButtons}</div>` +
      customColorEditor
    );
  }

  return {
    buildPaletteCustomFamilyDefineEditorUi,
    buildPaletteGlobalActiveSequenceEditorUi,
    buildPaletteGlobalFamilyLibraryEditorUi,
    buildPaletteFamilyColorEditorUi
  };
}
