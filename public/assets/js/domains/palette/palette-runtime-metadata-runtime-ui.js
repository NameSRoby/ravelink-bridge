// [TITLE] Module: public/assets/js/domains/palette/palette-runtime-metadata-runtime-ui.js
// [TITLE] Purpose: palette runtime contract metadata hydration for family aliases/defs/count options
// [TITLE] Functionality Index:
// [TITLE] - resolve runtime metadata payload from canonical contract snapshot
// [TITLE] - apply family order/aliases/defs updates with deterministic guardrails
// [TITLE] - rebuild color count options from contract or family defaults
// [DEV] Complex Flow:
// [DEV] Metadata application mutates runtime family contracts used by palette rendering.
// [DEV] Keep ordering/alias/defs fallback behavior stable across metadata refreshes.

function createPaletteRuntimeMetadataRuntimeUi(deps = {}) {
  const state = deps.state && typeof deps.state === "object" ? deps.state : {};
  const clampNumber = typeof deps.clampNumber === "function"
    ? deps.clampNumber
    : ((value, min, max, fallback) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return Number(fallback);
      return Math.min(Number(max), Math.max(Number(min), parsed));
    });
  const defaults = deps.defaults && typeof deps.defaults === "object" ? deps.defaults : {};
  const familyOrderDefault = Array.isArray(defaults.familyOrderDefault)
    ? defaults.familyOrderDefault
    : ["red", "yellow", "green", "violet", "blue", "custom"];
  const familyAliasesDefault = defaults.familyAliasesDefault && typeof defaults.familyAliasesDefault === "object"
    ? defaults.familyAliasesDefault
    : { violet: "violet", purple: "violet", custom: "custom" };
  const colorCountOptionsDefault = Array.isArray(defaults.colorCountOptionsDefault)
    ? defaults.colorCountOptionsDefault
    : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const familyDefsDefault = defaults.familyDefsDefault && typeof defaults.familyDefsDefault === "object"
    ? defaults.familyDefsDefault
    : {};

  const getFamilyOrder = () => Array.isArray(state.familyOrder) ? state.familyOrder : familyOrderDefault;
  const setFamilyOrder = next => { state.familyOrder = next; };
  const getFamilyAliases = () => state.familyAliases && typeof state.familyAliases === "object"
    ? state.familyAliases
    : familyAliasesDefault;
  const setFamilyAliases = next => { state.familyAliases = next; };
  const getFamilyDefs = () => state.familyDefs && typeof state.familyDefs === "object"
    ? state.familyDefs
    : familyDefsDefault;
  const setFamilyDefs = next => { state.familyDefs = next; };
  const setColorCountOptions = next => { state.colorCountOptions = next; };

  function resolvePaletteRuntimeMetadataPayloadUi(snapshot = {}) {
    const data = snapshot && typeof snapshot === "object" ? snapshot : {};
    const contract = data.contract && typeof data.contract === "object"
      ? data.contract
      : null;
    return {
      families: Array.isArray(contract?.families) ? contract.families : null,
      familyAliases: contract?.familyAliases && typeof contract.familyAliases === "object"
        ? contract.familyAliases
        : null,
      familyDefs: contract?.familyDefs && typeof contract.familyDefs === "object"
        ? contract.familyDefs
        : null,
      colorsPerFamily: Array.isArray(contract?.colorsPerFamily)
        ? contract.colorsPerFamily
        : null
    };
  }

  function applyPaletteRuntimeMetadataUi(snapshot = {}) {
    const data = snapshot && typeof snapshot === "object" ? snapshot : {};
    const metadata = resolvePaletteRuntimeMetadataPayloadUi(data);

    if (Array.isArray(metadata.families)) {
      const nextFamilyOrder = [];
      for (const raw of metadata.families) {
        const key = String(raw || "").trim().toLowerCase();
        if (!key) continue;
        if (nextFamilyOrder.includes(key)) continue;
        nextFamilyOrder.push(key);
      }
      if (nextFamilyOrder.length) {
        setFamilyOrder(Object.freeze(nextFamilyOrder));
      }
    }

    const familyOrder = getFamilyOrder();
    const canonicalTargets = new Set(familyOrder);
    if (metadata.familyAliases && typeof metadata.familyAliases === "object") {
      const nextAliases = {};
      for (const [aliasRaw, targetRaw] of Object.entries(familyAliasesDefault)) {
        const alias = String(aliasRaw || "").trim().toLowerCase();
        const target = String(targetRaw || "").trim().toLowerCase();
        if (!alias || !canonicalTargets.has(target)) continue;
        nextAliases[alias] = target;
      }
      for (const [aliasRaw, targetRaw] of Object.entries(metadata.familyAliases)) {
        const alias = String(aliasRaw || "").trim().toLowerCase();
        const target = String(targetRaw || "").trim().toLowerCase();
        if (!alias || !canonicalTargets.has(target)) continue;
        nextAliases[alias] = target;
      }
      setFamilyAliases(Object.freeze(nextAliases));
    } else {
      const fallbackAliases = {};
      for (const [aliasRaw, targetRaw] of Object.entries(familyAliasesDefault)) {
        const alias = String(aliasRaw || "").trim().toLowerCase();
        const target = String(targetRaw || "").trim().toLowerCase();
        if (!alias || !canonicalTargets.has(target)) continue;
        fallbackAliases[alias] = target;
      }
      setFamilyAliases(Object.freeze(fallbackAliases));
    }

    if (metadata.familyDefs && typeof metadata.familyDefs === "object") {
      const nextDefs = {};
      for (const family of familyOrder) {
        const rawDef = metadata.familyDefs[family];
        const safeDef = rawDef && typeof rawDef === "object" ? rawDef : {};
        const rawColors = Array.isArray(safeDef.colors) ? safeDef.colors : [];
        const defaultColors = Array.isArray(familyDefsDefault?.[family]?.colors)
          ? familyDefsDefault[family].colors
          : [];
        const defaultSize = Math.max(0, defaultColors.length);
        let colorSource = rawColors;
        // Guardrail: built-in family libraries are fixed-size; trim/repair stale metadata.
        if (defaultSize > 0 && rawColors.length < defaultSize) {
          colorSource = defaultColors;
        } else if (defaultSize > 0 && rawColors.length > defaultSize) {
          colorSource = rawColors.slice(0, defaultSize);
        }
        const colors = colorSource
          .map(color => ({
            r: clampNumber(Math.round(Number(color?.r) || 0), 0, 255, 0),
            g: clampNumber(Math.round(Number(color?.g) || 0), 0, 255, 0),
            b: clampNumber(Math.round(Number(color?.b) || 0), 0, 255, 0)
          }))
          .filter(color => Number.isFinite(color.r) && Number.isFinite(color.g) && Number.isFinite(color.b));
        if (!colors.length) continue;
        nextDefs[family] = Object.freeze({
          id: String(safeDef.id || family).trim().toLowerCase() || family,
          label: String(safeDef.label || family).trim().toUpperCase() || family.toUpperCase(),
          description: String(safeDef.description || "").trim(),
          colors: Object.freeze(colors.map(color => Object.freeze({ ...color })))
        });
      }
      for (const family of familyOrder) {
        if (nextDefs[family]) continue;
        if (!familyDefsDefault[family]) continue;
        nextDefs[family] = familyDefsDefault[family];
      }
      if (Object.keys(nextDefs).length) {
        setFamilyDefs(Object.freeze(nextDefs));
      }
    } else {
      const fallbackDefs = {};
      for (const family of familyOrderDefault) {
        if (!familyOrder.includes(family)) continue;
        if (!familyDefsDefault[family]) continue;
        fallbackDefs[family] = familyDefsDefault[family];
      }
      if (Object.keys(fallbackDefs).length) {
        setFamilyDefs(Object.freeze(fallbackDefs));
      }
    }

    if (Array.isArray(metadata.colorsPerFamily)) {
      const nextCounts = [];
      const familyDefs = getFamilyDefs();
      const maxFamilyColorCount = familyOrder
        .map(family => {
          const def = familyDefs[family];
          return Array.isArray(def?.colors) ? def.colors.length : 0;
        })
        .reduce((min, next) => Math.min(min, next), Number.MAX_SAFE_INTEGER);
      for (const raw of metadata.colorsPerFamily) {
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) continue;
        const count = Math.round(parsed);
        if (count < 1) continue;
        if (count > maxFamilyColorCount) continue;
        if (nextCounts.includes(count)) continue;
        nextCounts.push(count);
      }
      if (nextCounts.length) {
        setColorCountOptions(Object.freeze(nextCounts));
      }
    } else {
      const familyDefs = getFamilyDefs();
      const maxFamilyColorCount = familyOrder
        .map(family => {
          const def = familyDefs[family];
          return Array.isArray(def?.colors) ? def.colors.length : 0;
        })
        .reduce((min, next) => Math.min(min, next), Number.MAX_SAFE_INTEGER);
      if (Number.isFinite(maxFamilyColorCount) && maxFamilyColorCount > 0) {
        setColorCountOptions(Object.freeze(
          Array.from({ length: maxFamilyColorCount }, (_, idx) => idx + 1)
        ));
      } else {
        setColorCountOptions(Object.freeze(colorCountOptionsDefault.slice()));
      }
    }
  }

  return {
    resolvePaletteRuntimeMetadataPayloadUi,
    applyPaletteRuntimeMetadataUi
  };
}
