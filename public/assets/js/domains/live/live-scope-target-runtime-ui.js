// [TITLE] Module: public/assets/js/domains/live/live-scope-target-runtime-ui.js
// [TITLE] Purpose: shared LIVE scope target runtime for global/brand/fixture scene tuning flows
// [TITLE] Functionality Index:
// [TITLE] - resolve active scope target from UI state
// [TITLE] - resolve scoped trigger-matrix entries with fallback precedence
// [TITLE] - render top-level custom target selector and persist fixture memory
// [DEV] Complex Flow:
// [DEV] Scope runtime is extracted so scene/runtime control modules can stay under
// [DEV] budget while reusing one deterministic scope contract.

function createLiveScopeTargetRuntimeUi(deps = {}) {
  const ui = deps.ui || {};
  const el = deps.el || {};
  const normalizeLiveSceneFilterAggressivenessUi = typeof deps.normalizeLiveSceneFilterAggressivenessUi === "function"
    ? deps.normalizeLiveSceneFilterAggressivenessUi
    : (value => value && typeof value === "object" ? { ...value } : { calm: 1, groove: 1, impact: 1 });
  const normalizeLiveSceneRuntimeTuningUi = typeof deps.normalizeLiveSceneRuntimeTuningUi === "function"
    ? deps.normalizeLiveSceneRuntimeTuningUi
    : (value => value && typeof value === "object" ? { ...value } : {});
  const brands = Array.isArray(deps.brands) && deps.brands.length ? deps.brands : ["hue", "wiz"];
  const allFixturesValue = String(deps.allFixturesValue || "__all__");
  const storageKey = String(deps.storageKey || "ravelink_palette_fixture_selection_v1");

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;")
      .replaceAll("'", "&#39;");
  }

  function normalizeBrand(value, fallback = "hue") {
    const token = String(value || "").trim().toLowerCase();
    if (brands.includes(token)) return token;
    const fallbackToken = String(fallback || "").trim().toLowerCase();
    return brands.includes(fallbackToken) ? fallbackToken : "hue";
  }

  function normalizeScopeLevel(value, fallback = "global") {
    const token = String(value || "").trim().toLowerCase();
    if (token === "fixture" || token === "brand" || token === "custom") return token;
    if (token === "global") return "global";
    const fallbackToken = String(fallback || "").trim().toLowerCase();
    return fallbackToken === "custom" ? "custom" : "global";
  }

  function normalizeFixtureId(value) {
    return String(value || "").trim();
  }

  function getFixtureCandidates(brand = "hue") {
    const brandKey = normalizeBrand(brand, "hue");
    const routed = Array.isArray(ui.paletteBrandFixtures?.[brandKey])
      ? ui.paletteBrandFixtures[brandKey]
      : [];
    if (routed.length) {
      return routed
        .map(entry => {
          const id = String(entry?.id || "").trim();
          const zone = String(entry?.zone || brandKey).trim().toLowerCase() || brandKey;
          return { id, label: `${id} | ${zone.toUpperCase()}` };
        })
        .filter(entry => Boolean(entry.id))
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    }
    const catalog = Array.isArray(ui.fixturesCatalog) ? ui.fixturesCatalog : [];
    return catalog
      .filter(row => {
        if (!row || typeof row !== "object") return false;
        if (String(row.brand || "").trim().toLowerCase() !== brandKey) return false;
        if (row.enabled === false) return false;
        return row.engineEnabled !== false;
      })
      .map(row => {
        const id = String(row.id || "").trim();
        const zone = String(row.zone || brandKey).trim().toLowerCase() || brandKey;
        return { id, label: `${id} | ${zone.toUpperCase()}` };
      })
      .filter(entry => Boolean(entry.id))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  function persistFixtureSelection() {
    try {
      const hue = String(ui.paletteFixtureSelectionByBrand?.hue || allFixturesValue).trim() || allFixturesValue;
      const wiz = String(ui.paletteFixtureSelectionByBrand?.wiz || allFixturesValue).trim() || allFixturesValue;
      localStorage.setItem(storageKey, JSON.stringify({ hue, wiz }));
    } catch (err) {
      console.debug("[LIVE][DEBUG] failed to persist scene scope fixture selection:", err?.message || err);
    }
  }

  function resolveScopeFromUi() {
    const scopeMode = normalizeScopeLevel(ui.paletteControlScope, "global");
    if (scopeMode === "global") {
      return {
        level: "global",
        scopePayload: { level: "global" },
        label: "GLOBAL SETTINGS",
        brand: "",
        fixtureId: ""
      };
    }
    const brand = normalizeBrand(ui.paletteCustomBrand, "hue");
    const fixtures = getFixtureCandidates(brand);
    const ids = new Set(fixtures.map(entry => String(entry.id || "").trim()).filter(Boolean));
    const requested = normalizeFixtureId(ui.paletteFixtureSelectionByBrand?.[brand] || allFixturesValue);
    const fixtureId = requested !== allFixturesValue && ids.has(requested)
      ? requested
      : allFixturesValue;
    if (!ui.paletteFixtureSelectionByBrand || typeof ui.paletteFixtureSelectionByBrand !== "object") {
      ui.paletteFixtureSelectionByBrand = { hue: allFixturesValue, wiz: allFixturesValue };
    }
    if (ui.paletteFixtureSelectionByBrand[brand] !== fixtureId) {
      ui.paletteFixtureSelectionByBrand[brand] = fixtureId;
      persistFixtureSelection();
    }
    if (fixtureId !== allFixturesValue) {
      return {
        level: "fixture",
        scopePayload: { level: "fixture", brand, fixtureId },
        label: `${brand.toUpperCase()} FIXTURE ${fixtureId}`,
        brand,
        fixtureId
      };
    }
    return {
      level: "brand",
      scopePayload: { level: "brand", brand },
      label: `${brand.toUpperCase()} ALL FIXTURES`,
      brand,
      fixtureId: ""
    };
  }

  function resolveScopeSnapshotEntry(snapshot = null, scope = resolveScopeFromUi()) {
    const source = snapshot && typeof snapshot === "object" ? snapshot : {};
    const globalAgg = normalizeLiveSceneFilterAggressivenessUi(
      source.manualGlobal?.sceneFilterAggressiveness ||
        source.global?.sceneFilterAggressiveness ||
        source.manualConfig?.sceneFilterAggressiveness ||
        source.config?.sceneFilterAggressiveness ||
        {},
      ui.sceneFilterAggressiveness
    );
    const globalRuntime = normalizeLiveSceneRuntimeTuningUi(
      source.manualGlobal?.runtimeTuning ||
        source.global?.runtimeTuning ||
        source.manualConfig?.runtimeTuning ||
        source.config?.runtimeTuning ||
        {},
      ui.sceneRuntimeTuning
    );
    if (scope.level === "global") {
      return {
        sceneFilterAggressiveness: globalAgg,
        runtimeTuning: globalRuntime
      };
    }
    const brandKey = normalizeBrand(scope.brand, ui.paletteCustomBrand || "hue");
    const brandEntry = source.brands?.[brandKey] && typeof source.brands[brandKey] === "object"
      ? source.brands[brandKey]
      : {};
    const brandAgg = normalizeLiveSceneFilterAggressivenessUi(
      brandEntry.sceneFilterAggressiveness || {},
      globalAgg
    );
    const brandRuntime = normalizeLiveSceneRuntimeTuningUi(
      brandEntry.runtimeTuning || {},
      globalRuntime
    );
    if (scope.level === "brand") {
      return {
        sceneFilterAggressiveness: brandAgg,
        runtimeTuning: brandRuntime
      };
    }
    const fixtureId = normalizeFixtureId(scope.fixtureId);
    const fixtureEntry = source.fixtureOverrides?.[fixtureId] && typeof source.fixtureOverrides[fixtureId] === "object"
      ? source.fixtureOverrides[fixtureId]
      : {};
    const fixtureBrand = normalizeBrand(fixtureEntry.brand, brandKey);
    if (fixtureBrand !== brandKey) {
      return {
        sceneFilterAggressiveness: brandAgg,
        runtimeTuning: brandRuntime
      };
    }
    return {
      sceneFilterAggressiveness: normalizeLiveSceneFilterAggressivenessUi(
        fixtureEntry.sceneFilterAggressiveness || {},
        brandAgg
      ),
      runtimeTuning: normalizeLiveSceneRuntimeTuningUi(
        fixtureEntry.runtimeTuning || {},
        brandRuntime
      )
    };
  }

  function renderScopeSelectorUi() {
    const scope = resolveScopeFromUi();
    if (el.liveScopeStatus) {
      el.liveScopeStatus.textContent = `Current target: ${scope.label}`;
    }
    if (!el.liveScopeFixtureSelect) return scope;
    const customActive = scope.level !== "global";
    el.liveScopeFixtureSelect.disabled = !customActive;
    if (!customActive) {
      el.liveScopeFixtureSelect.innerHTML = `<option value="${allFixturesValue}">ALL FIXTURES</option>`;
      el.liveScopeFixtureSelect.value = allFixturesValue;
      return scope;
    }
    const fixtureRows = getFixtureCandidates(scope.brand);
    const options = [
      `<option value="${allFixturesValue}">ALL ${scope.brand.toUpperCase()} FIXTURES</option>`,
      ...fixtureRows.map(row => (
        `<option value="${escapeHtml(String(row.id || ""))}">${escapeHtml(String(row.label || row.id || ""))}</option>`
      ))
    ];
    el.liveScopeFixtureSelect.innerHTML = options.join("");
    const selected = normalizeFixtureId(ui.paletteFixtureSelectionByBrand?.[scope.brand] || allFixturesValue);
    if (selected !== allFixturesValue && !fixtureRows.some(row => String(row.id || "").trim() === selected)) {
      ui.paletteFixtureSelectionByBrand[scope.brand] = allFixturesValue;
      persistFixtureSelection();
    }
    el.liveScopeFixtureSelect.value = String(
      ui.paletteFixtureSelectionByBrand?.[scope.brand] || allFixturesValue
    ).trim() || allFixturesValue;
    return scope;
  }

  function emitScopeChanged(reason = "live_scope_changed") {
    if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
    const scope = resolveScopeFromUi();
    try {
      window.dispatchEvent(new CustomEvent("ravelink:live-scope-changed", {
        detail: {
          reason: String(reason || "live_scope_changed"),
          scope: ui.paletteControlScope,
          customBrand: scope.brand || "",
          fixtureId: scope.fixtureId || ""
        }
      }));
    } catch (err) {
      console.debug("[LIVE][DEBUG] scene scope event dispatch failed:", err?.message || err);
    }
  }

  return {
    allFixturesValue,
    resolveScopeFromUi,
    resolveScopeSnapshotEntry,
    renderScopeSelectorUi,
    persistFixtureSelection,
    emitScopeChanged,
    normalizeBrand,
    normalizeFixtureId
  };
}
