// [TITLE] Module: public/assets/js/domains/palette/palette-global-actions-runtime.js
// [TITLE] Purpose: global palette panel interaction and mutation event wiring
// [TITLE] Functionality Index:
// [TITLE] - scope toggle bindings
// [TITLE] - vividness and disorder control bindings
// [TITLE] - family-grid selection, reorder, and custom color bindings
// [TITLE] - drag/drop sequence reorder runtime
// [DEV] Complex Flow:
// [DEV] This module owns only the global palette panel interaction layer. Shared palette
// [DEV] mutation helpers remain in palette.js and are injected so the brand/per-fixture
// [DEV] path can continue to use the same patch/apply semantics without duplication.

function createPaletteGlobalActionsRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const sync = typeof deps.sync === "function" ? deps.sync : (() => {});
  const setBadge = typeof deps.setBadge === "function" ? deps.setBadge : (() => {});
  const paletteCustomBrandButtons = Array.isArray(deps.paletteCustomBrandButtons) ? deps.paletteCustomBrandButtons : [];
  const paletteDisorderButtons = Array.isArray(deps.paletteDisorderButtons) ? deps.paletteDisorderButtons : [];
  const setPaletteControlScopeUi = typeof deps.setPaletteControlScopeUi === "function" ? deps.setPaletteControlScopeUi : (() => {});
  const setPaletteCustomBrandUi = typeof deps.setPaletteCustomBrandUi === "function" ? deps.setPaletteCustomBrandUi : (() => {});
  const markPaletteGlobalPanelInteraction = typeof deps.markPaletteGlobalPanelInteraction === "function" ? deps.markPaletteGlobalPanelInteraction : (() => {});
  const isPaletteGlobalScopeActiveUi = typeof deps.isPaletteGlobalScopeActiveUi === "function" ? deps.isPaletteGlobalScopeActiveUi : (() => true);
  const normalizePaletteVividnessUi = typeof deps.normalizePaletteVividnessUi === "function" ? deps.normalizePaletteVividnessUi : (value => Number(value) || 2);
  const syncPaletteVividnessSliderUi = typeof deps.syncPaletteVividnessSliderUi === "function" ? deps.syncPaletteVividnessSliderUi : (() => {});
  const renderPaletteFamilyButtons = typeof deps.renderPaletteFamilyButtons === "function" ? deps.renderPaletteFamilyButtons : (() => {});
  const applyPalettePatch = typeof deps.applyPalettePatch === "function" ? deps.applyPalettePatch : (async () => false);
  const formatPaletteVividnessLabelUi = typeof deps.formatPaletteVividnessLabelUi === "function" ? deps.formatPaletteVividnessLabelUi : (value => String(value || ""));
  const loadPaletteConfig = typeof deps.loadPaletteConfig === "function" ? deps.loadPaletteConfig : (async () => false);
  const getPaletteGlobalConfigUi = typeof deps.getPaletteGlobalConfigUi === "function" ? deps.getPaletteGlobalConfigUi : (() => ({}));
  const normalizePaletteColorSequenceUi = typeof deps.normalizePaletteColorSequenceUi === "function" ? deps.normalizePaletteColorSequenceUi : (value => Array.isArray(value) ? value : []);
  const normalizePaletteCustomFamilyColorsUi = typeof deps.normalizePaletteCustomFamilyColorsUi === "function" ? deps.normalizePaletteCustomFamilyColorsUi : (value => Array.isArray(value) ? value : []);
  const clampNumber = typeof deps.clampNumber === "function" ? deps.clampNumber : ((value, min, max, fallback = min) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  });
  const parsePaletteColorSequenceEntryUi = typeof deps.parsePaletteColorSequenceEntryUi === "function" ? deps.parsePaletteColorSequenceEntryUi : (entry => entry || null);
  const derivePaletteLegacySelectionFromColorSequenceUi = typeof deps.derivePaletteLegacySelectionFromColorSequenceUi === "function" ? deps.derivePaletteLegacySelectionFromColorSequenceUi : (() => ({
    colorsPerFamily: 3,
    families: [],
    familyColorCounts: {},
    familyColorIndexes: {}
  }));
  const normalizePaletteSequenceFamilyUi = typeof deps.normalizePaletteSequenceFamilyUi === "function" ? deps.normalizePaletteSequenceFamilyUi : (value => String(value || "").trim().toLowerCase());
  const PALETTE_FAMILY_ORDER = Array.isArray(deps.PALETTE_FAMILY_ORDER) ? deps.PALETTE_FAMILY_ORDER : [];
  const getPaletteGlobalFamilyTab = typeof deps.getPaletteGlobalFamilyTab === "function" ? deps.getPaletteGlobalFamilyTab : (() => "red");
  const setPaletteGlobalFamilyTab = typeof deps.setPaletteGlobalFamilyTab === "function" ? deps.setPaletteGlobalFamilyTab : (() => {});
  const parsePaletteRgbColorTokenUi = typeof deps.parsePaletteRgbColorTokenUi === "function" ? deps.parsePaletteRgbColorTokenUi : (() => null);
  const getPaletteGlobalSequenceDragIndex = typeof deps.getPaletteGlobalSequenceDragIndex === "function" ? deps.getPaletteGlobalSequenceDragIndex : (() => -1);
  const setPaletteGlobalSequenceDragIndex = typeof deps.setPaletteGlobalSequenceDragIndex === "function" ? deps.setPaletteGlobalSequenceDragIndex : (() => {});
  const normalizePaletteDisorderAggressionUi = typeof deps.normalizePaletteDisorderAggressionUi === "function" ? deps.normalizePaletteDisorderAggressionUi : (value => Number(value) || 0.35);
  const syncPaletteDisorderAggressionSliderUi = typeof deps.syncPaletteDisorderAggressionSliderUi === "function" ? deps.syncPaletteDisorderAggressionSliderUi : (() => {});

  function wirePaletteGlobalActionsUi() {
    if (el.paletteScopeGlobalBtn) {
      el.paletteScopeGlobalBtn.addEventListener("click", () => {
        setPaletteControlScopeUi("global");
      });
    }

    if (el.paletteScopeCustomBtn) {
      el.paletteScopeCustomBtn.addEventListener("click", () => {
        setPaletteControlScopeUi("custom");
      });
    }

    paletteCustomBrandButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        setPaletteCustomBrandUi(btn.dataset.paletteCustomBrand);
      });
    });

    if (el.paletteGlobalPanel) {
      const markPaletteGlobalHot = evt => {
        const type = String(evt?.type || "").trim().toLowerCase();
        if (type === "pointerdown" || type === "focusin") {
          markPaletteGlobalPanelInteraction(1800);
          return;
        }
        if (type === "change") {
          markPaletteGlobalPanelInteraction(1200);
          return;
        }
        if (type === "input") {
          markPaletteGlobalPanelInteraction(900);
          return;
        }
        markPaletteGlobalPanelInteraction(750);
      };
      ["pointerdown", "focusin", "keydown", "input", "change"].forEach(type => {
        el.paletteGlobalPanel.addEventListener(type, markPaletteGlobalHot, { capture: true });
      });
    }

    if (el.paletteVividness) {
      el.paletteVividness.addEventListener("input", () => {
        if (!isPaletteGlobalScopeActiveUi()) return;
        ui.paletteVividness = normalizePaletteVividnessUi(el.paletteVividness.value, ui.paletteVividness || 2);
        syncPaletteVividnessSliderUi();
        renderPaletteFamilyButtons(ui.paletteCatalog);
      });
      el.paletteVividness.addEventListener("change", async () => {
        if (!isPaletteGlobalScopeActiveUi()) return;
        const level = normalizePaletteVividnessUi(el.paletteVividness.value, ui.paletteVividness || 2);
        ui.paletteVividness = level;
        syncPaletteVividnessSliderUi();
        const ok = await applyPalettePatch({ vividness: level }, "PALETTE VIVIDNESS");
        if (ok) {
          setBadge(el.health, "ok", `PALETTE VIVIDNESS ${formatPaletteVividnessLabelUi(level)}`);
        } else {
          await loadPaletteConfig();
        }
      });
    }

    if (el.paletteVividnessResetBtn) {
      el.paletteVividnessResetBtn.addEventListener("click", async () => {
        if (!isPaletteGlobalScopeActiveUi()) return;
        ui.paletteVividness = 2;
        syncPaletteVividnessSliderUi();
        renderPaletteFamilyButtons(ui.paletteCatalog);
        const ok = await applyPalettePatch({ vividness: 2 }, "PALETTE VIVIDNESS");
        if (ok) {
          setBadge(el.health, "ok", "PALETTE VIVIDNESS HIGH");
        } else {
          await loadPaletteConfig();
        }
      });
    }

    if (el.paletteFamilyGrid) {
      const clearSequenceDropTargetHover = () => {
        Array.from(el.paletteFamilyGrid.querySelectorAll(".isDropTarget")).forEach(node => {
          node.classList.remove("isDropTarget");
        });
      };

      const buildGlobalSequenceConfig = () => {
        const currentConfig = getPaletteGlobalConfigUi();
        return {
          ...currentConfig,
          colorSequence: normalizePaletteColorSequenceUi(
            currentConfig.colorSequence,
            ui.paletteColorSequence,
            currentConfig
          )
        };
      };

      const remapPaletteSequenceAfterCustomRemoval = (sequence = [], removedIndex = -1) => {
        const out = [];
        for (const rawEntry of sequence) {
          const entry = parsePaletteColorSequenceEntryUi(rawEntry);
          if (!entry) continue;
          if (entry.family !== "custom") {
            out.push(entry);
            continue;
          }
          if (entry.index === removedIndex) continue;
          out.push({
            family: "custom",
            index: entry.index > removedIndex ? (entry.index - 1) : entry.index
          });
        }
        return out;
      };

      const reorderPaletteSequenceForDrop = (sequence = [], fromIndex = -1, dropIndex = -1) => {
        const list = Array.isArray(sequence) ? sequence.slice() : [];
        if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= list.length) return list;
        const boundedDrop = clampNumber(Math.round(Number(dropIndex) || 0), 0, list.length, list.length);
        const [moved] = list.splice(fromIndex, 1);
        if (!moved) return list;
        const adjustedDrop = boundedDrop > fromIndex ? (boundedDrop - 1) : boundedDrop;
        list.splice(adjustedDrop, 0, moved);
        return list;
      };

      const applyOptimisticSequencePreview = nextSequence => {
        const currentConfig = buildGlobalSequenceConfig();
        const normalizedSequence = normalizePaletteColorSequenceUi(nextSequence, currentConfig.colorSequence, currentConfig);
        const derived = derivePaletteLegacySelectionFromColorSequenceUi(
          normalizedSequence,
          {
            ...currentConfig,
            colorSequence: normalizedSequence
          }
        );
        ui.paletteColorSequence = normalizedSequence.map(entry => ({
          family: entry.family,
          index: entry.index
        }));
        ui.paletteColorsPerFamily = derived.colorsPerFamily;
        ui.paletteFamilies = derived.families.slice();
        ui.paletteFamilyColorCounts = { ...derived.familyColorCounts };
        ui.paletteFamilyColorIndexes = { ...derived.familyColorIndexes };
        renderPaletteFamilyButtons(ui.paletteCatalog);
        sync();
        return normalizedSequence;
      };

      el.paletteFamilyGrid.addEventListener("click", async e => {
        if (!isPaletteGlobalScopeActiveUi()) return;
        const familyTabBtn = e.target.closest("[data-palette-family-tab]");
        if (familyTabBtn) {
          const nextFamily = normalizePaletteSequenceFamilyUi(familyTabBtn.dataset.paletteFamilyTab);
          if (!nextFamily || nextFamily === getPaletteGlobalFamilyTab()) return;
          setPaletteGlobalFamilyTab(nextFamily);
          renderPaletteFamilyButtons(ui.paletteCatalog);
          return;
        }
        const customAddBtn = e.target.closest("[data-palette-custom-color-add]");
        if (customAddBtn) {
          markPaletteGlobalPanelInteraction(1800);
          const currentConfig = buildGlobalSequenceConfig();
          const currentColors = normalizePaletteCustomFamilyColorsUi(
            currentConfig.customFamilyColors,
            ui.paletteCustomFamilyColors
          );
          const seed = currentColors[currentColors.length - 1] || { r: 255, g: 255, b: 255 };
          const nextColors = currentColors.concat([{
            r: clampNumber(Number(seed?.r) + 8, 0, 255, 255),
            g: clampNumber(Number(seed?.g) + 8, 0, 255, 255),
            b: clampNumber(Number(seed?.b) + 8, 0, 255, 255)
          }]);
          const ok = await applyPalettePatch({ customFamilyColors: nextColors, colorSequence: currentConfig.colorSequence }, "CUSTOM COLORS");
          if (ok) setBadge(el.health, "ok", "CUSTOM COLOR ADDED");
          return;
        }
        const customRemoveBtn = e.target.closest("[data-palette-custom-color-remove]");
        if (customRemoveBtn) {
          markPaletteGlobalPanelInteraction(1800);
          const index = Math.round(Number(customRemoveBtn.dataset.paletteCustomColorRemove ?? customRemoveBtn.dataset.colorIndex));
          if (!Number.isFinite(index) || index < 0) return;
          const currentConfig = buildGlobalSequenceConfig();
          const currentColors = normalizePaletteCustomFamilyColorsUi(currentConfig.customFamilyColors, ui.paletteCustomFamilyColors);
          if (currentColors.length <= 1) {
            setBadge(el.health, "warn", "CUSTOM FAMILY REQUIRES AT LEAST 1 COLOR");
            return;
          }
          const nextColors = currentColors.filter((_, idx) => idx !== index);
          let nextSequence = remapPaletteSequenceAfterCustomRemoval(currentConfig.colorSequence, index);
          nextSequence = normalizePaletteColorSequenceUi(nextSequence, null, { ...currentConfig, customFamilyColors: nextColors });
          const ok = await applyPalettePatch({ customFamilyColors: nextColors, colorSequence: nextSequence }, "CUSTOM COLORS");
          if (ok) setBadge(el.health, "ok", "CUSTOM COLOR REMOVED");
          return;
        }
        const toggleBtn = e.target.closest("[data-palette-family-color-toggle]");
        if (toggleBtn) {
          markPaletteGlobalPanelInteraction(1800);
          const family = normalizePaletteSequenceFamilyUi(toggleBtn.dataset.paletteFamilyColorToggle);
          if (!PALETTE_FAMILY_ORDER.includes(family)) return;
          const colorIndex = Math.round(Number(toggleBtn.dataset.colorIndex));
          if (!Number.isFinite(colorIndex) || colorIndex < 0) return;
          const currentConfig = buildGlobalSequenceConfig();
          const currentSequence = normalizePaletteColorSequenceUi(currentConfig.colorSequence, ui.paletteColorSequence, currentConfig);
          const key = `${family}:${colorIndex}`;
          const exists = currentSequence.some(entry => `${entry.family}:${entry.index}` === key);
          let nextSequence = exists
            ? currentSequence.filter(entry => `${entry.family}:${entry.index}` !== key)
            : currentSequence.concat([{ family, index: colorIndex }]);
          if (!nextSequence.length) {
            setBadge(el.health, "warn", "ACTIVE SEQUENCE REQUIRES AT LEAST 1 COLOR");
            return;
          }
          nextSequence = normalizePaletteColorSequenceUi(nextSequence, null, currentConfig);
          applyOptimisticSequencePreview(nextSequence);
          const ok = await applyPalettePatch({ colorSequence: nextSequence }, exists ? "PALETTE COLOR REMOVE" : "PALETTE COLOR ADD");
          if (ok) {
            setBadge(el.health, "ok", `${family.toUpperCase()} COLOR ${colorIndex + 1} ${exists ? "REMOVED" : "ADDED"}`);
          } else {
            await loadPaletteConfig();
          }
          return;
        }
        const shiftBtn = e.target.closest("[data-palette-seq-shift-index]");
        if (shiftBtn) {
          markPaletteGlobalPanelInteraction(1800);
          const sequenceIndex = Math.round(Number(shiftBtn.dataset.paletteSeqShiftIndex));
          const dir = Math.round(Number(shiftBtn.dataset.paletteSeqShiftDir));
          if (!Number.isFinite(sequenceIndex) || sequenceIndex < 0 || !Number.isFinite(dir) || ![-1, 1].includes(dir)) return;
          const currentConfig = buildGlobalSequenceConfig();
          const currentSequence = normalizePaletteColorSequenceUi(currentConfig.colorSequence, ui.paletteColorSequence, currentConfig);
          const target = sequenceIndex + dir;
          if (target < 0 || target >= currentSequence.length) return;
          const nextSequence = currentSequence.slice();
          const temp = nextSequence[sequenceIndex];
          nextSequence[sequenceIndex] = nextSequence[target];
          nextSequence[target] = temp;
          applyOptimisticSequencePreview(nextSequence);
          const ok = await applyPalettePatch({ colorSequence: nextSequence }, "PALETTE COLOR ORDER");
          if (ok) {
            setBadge(el.health, "ok", "PALETTE ORDER UPDATED");
          } else {
            await loadPaletteConfig();
          }
          return;
        }
        const removeBtn = e.target.closest("[data-palette-seq-remove]");
        if (removeBtn) {
          markPaletteGlobalPanelInteraction(1800);
          const sequenceIndex = Math.round(Number(removeBtn.dataset.paletteSeqRemove));
          if (!Number.isFinite(sequenceIndex) || sequenceIndex < 0) return;
          const currentConfig = buildGlobalSequenceConfig();
          const currentSequence = normalizePaletteColorSequenceUi(currentConfig.colorSequence, ui.paletteColorSequence, currentConfig);
          if (currentSequence.length <= 1) {
            setBadge(el.health, "warn", "ACTIVE SEQUENCE REQUIRES AT LEAST 1 COLOR");
            return;
          }
          const nextSequence = currentSequence.filter((_, index) => index !== sequenceIndex);
          applyOptimisticSequencePreview(nextSequence);
          const ok = await applyPalettePatch({ colorSequence: nextSequence }, "PALETTE COLOR REMOVE");
          if (ok) {
            setBadge(el.health, "ok", "SEQUENCE COLOR REMOVED");
          } else {
            await loadPaletteConfig();
          }
        }
      });

      el.paletteFamilyGrid.addEventListener("change", async e => {
        if (!isPaletteGlobalScopeActiveUi()) return;
        const customColorInput = e.target.closest("input[data-palette-custom-color-value]");
        if (customColorInput) {
          markPaletteGlobalPanelInteraction(1500);
          const index = Math.round(Number(customColorInput.dataset.paletteCustomColorValue ?? customColorInput.dataset.colorIndex));
          if (!Number.isFinite(index) || index < 0) return;
          const parsed = parsePaletteRgbColorTokenUi(customColorInput.value);
          if (!parsed) return;
          const currentConfig = buildGlobalSequenceConfig();
          const currentColors = normalizePaletteCustomFamilyColorsUi(currentConfig.customFamilyColors, ui.paletteCustomFamilyColors);
          if (!Object.prototype.hasOwnProperty.call(currentColors, index)) return;
          const nextColors = currentColors.slice();
          nextColors[index] = parsed;
          const ok = await applyPalettePatch({ customFamilyColors: nextColors, colorSequence: currentConfig.colorSequence }, "CUSTOM COLORS");
          if (ok) {
            setBadge(el.health, "ok", `CUSTOM COLOR ${index + 1} UPDATED`);
          } else {
            await loadPaletteConfig();
          }
        }
      });

      el.paletteFamilyGrid.addEventListener("dragstart", e => {
        if (!isPaletteGlobalScopeActiveUi()) return;
        const dragNode = e.target.closest("[data-palette-seq-drag-index]");
        if (!dragNode) return;
        const index = Math.round(Number(dragNode.dataset.paletteSeqDragIndex));
        if (!Number.isFinite(index) || index < 0) return;
        setPaletteGlobalSequenceDragIndex(index);
        dragNode.classList.add("isDragging");
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(index));
        }
      });

      el.paletteFamilyGrid.addEventListener("dragover", e => {
        if (!isPaletteGlobalScopeActiveUi()) return;
        const dropNode = e.target.closest("[data-palette-seq-drop-index]");
        if (!dropNode) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        clearSequenceDropTargetHover();
        dropNode.classList.add("isDropTarget");
      });

      el.paletteFamilyGrid.addEventListener("dragleave", e => {
        const node = e.target.closest(".isDropTarget");
        if (node) node.classList.remove("isDropTarget");
      });

      el.paletteFamilyGrid.addEventListener("drop", async e => {
        if (!isPaletteGlobalScopeActiveUi()) return;
        const dropNode = e.target.closest("[data-palette-seq-drop-index]");
        if (!dropNode) return;
        e.preventDefault();
        markPaletteGlobalPanelInteraction(1800);
        const fromIndex = Number.isFinite(getPaletteGlobalSequenceDragIndex())
          ? getPaletteGlobalSequenceDragIndex()
          : Math.round(Number(e.dataTransfer?.getData("text/plain")));
        const dropIndex = Math.round(Number(dropNode.dataset.paletteSeqDropIndex));
        clearSequenceDropTargetHover();
        setPaletteGlobalSequenceDragIndex(-1);
        if (!Number.isFinite(fromIndex) || fromIndex < 0 || !Number.isFinite(dropIndex) || dropIndex < 0) return;
        const currentConfig = buildGlobalSequenceConfig();
        const currentSequence = normalizePaletteColorSequenceUi(currentConfig.colorSequence, ui.paletteColorSequence, currentConfig);
        const nextSequence = reorderPaletteSequenceForDrop(currentSequence, fromIndex, dropIndex);
        const unchanged = nextSequence.length === currentSequence.length &&
          nextSequence.every((entry, index) => {
            const currentEntry = currentSequence[index];
            return currentEntry && entry.family === currentEntry.family && entry.index === currentEntry.index;
          });
        if (unchanged) return;
        applyOptimisticSequencePreview(nextSequence);
        const ok = await applyPalettePatch({ colorSequence: nextSequence }, "PALETTE COLOR ORDER");
        if (ok) {
          setBadge(el.health, "ok", "PALETTE ORDER UPDATED");
        } else {
          await loadPaletteConfig();
        }
      });

      el.paletteFamilyGrid.addEventListener("dragend", () => {
        setPaletteGlobalSequenceDragIndex(-1);
        clearSequenceDropTargetHover();
        Array.from(el.paletteFamilyGrid.querySelectorAll(".isDragging")).forEach(node => {
          node.classList.remove("isDragging");
        });
      });
    }

    paletteDisorderButtons.forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!isPaletteGlobalScopeActiveUi()) return;
        const disorder = String(btn.dataset.paletteDisorder || "").toLowerCase() === "true";
        ui.paletteDisorder = disorder;
        sync();
        const ok = await applyPalettePatch({ disorder }, "PALETTE ORDER");
        if (ok) {
          setBadge(el.health, "ok", disorder ? "PALETTE ORDER DISORDER" : "PALETTE ORDER ORDERED");
        } else {
          await loadPaletteConfig();
        }
      });
    });

    if (el.paletteDisorderAggression) {
      el.paletteDisorderAggression.addEventListener("input", () => {
        ui.paletteDisorderAggression = normalizePaletteDisorderAggressionUi(el.paletteDisorderAggression.value, 0.35);
        syncPaletteDisorderAggressionSliderUi();
      });
      el.paletteDisorderAggression.addEventListener("change", async () => {
        if (!isPaletteGlobalScopeActiveUi()) return;
        const aggression = normalizePaletteDisorderAggressionUi(el.paletteDisorderAggression.value, ui.paletteDisorderAggression || 0.35);
        ui.paletteDisorderAggression = aggression;
        syncPaletteDisorderAggressionSliderUi();
        const ok = await applyPalettePatch({ disorderAggression: aggression }, "PALETTE CHAOS");
        if (ok) {
          setBadge(el.health, "ok", `PALETTE CHAOS ${Math.round(aggression * 100)}%`);
        } else {
          await loadPaletteConfig();
        }
      });
    }

    if (el.paletteDisorderAggressionResetBtn) {
      el.paletteDisorderAggressionResetBtn.addEventListener("click", async () => {
        if (!isPaletteGlobalScopeActiveUi()) return;
        ui.paletteDisorderAggression = 0.35;
        syncPaletteDisorderAggressionSliderUi();
        const ok = await applyPalettePatch({ disorderAggression: 0.35 }, "PALETTE CHAOS");
        if (ok) {
          setBadge(el.health, "ok", "PALETTE CHAOS RESET");
        } else {
          await loadPaletteConfig();
        }
      });
    }
  }

  return {
    wirePaletteGlobalActionsUi
  };
}
