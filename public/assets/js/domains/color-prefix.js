// [TITLE] Module: public/assets/js/domains/color-prefix.js
// [TITLE] Purpose: color command prefix normalization, rule-builder state, and config persistence helpers
// [TITLE] Functionality Index:
// [TITLE] - prefix token/default target normalization
// [TITLE] - brand/fixture prefix rule-builder state + validation
// [TITLE] - fixture/group rave-off map parse + validation
// [TITLE] - snapshot apply/load/save routes for /color/prefixes
// [DEV] Complex Flow:
// [DEV] This module centralizes color-prefix config parsing so rule-builder state
// [DEV] and server payloads stay deterministic and reject invalid duplicates before write.

function normalizeColorPrefixToken(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  return /^[a-z][a-z0-9_-]{0,31}$/.test(raw) ? raw : "";
}

function escapeColorPrefixHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeColorPrefixDefaultTarget(value, fallback = "both") {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "hue" || raw === "wiz" || raw === "both") return raw;
  return String(fallback || "both").trim().toLowerCase() || "both";
}

function normalizeColorCommandText(value, fallback = "") {
  const source = String(value || "").replace(/\s+/g, " ").trim();
  if (!source) return String(fallback || "").replace(/\s+/g, " ").trim();
  return source.slice(0, 96);
}

const colorPrefixRaveOffRuntime = (typeof createColorPrefixRaveOffRuntimeUi === "function"
  ? createColorPrefixRaveOffRuntimeUi({ normalizeColorCommandText })
  : (() => {
    throw new Error("color-prefix rave-off runtime module missing");
  })());
const {
  normalizeColorRaveOffGroupMap,
  normalizeColorRaveOffFixtureMap,
  parseColorRaveOffGroupMapText,
  formatColorRaveOffGroupMapText,
  parseColorRaveOffFixtureMapText,
  formatColorRaveOffFixtureMapText
} = colorPrefixRaveOffRuntime;

function normalizeColorFixturePrefixMap(rawMap = {}) {
  const source = rawMap && typeof rawMap === "object" ? rawMap : {};
  const safe = {};
  const usedPrefixes = new Set();
  const entries = Object.entries(source)
    .map(([fixtureId, prefix]) => [String(fixtureId || "").trim(), normalizeColorPrefixToken(prefix)])
    .filter(([fixtureId, prefix]) => fixtureId && prefix)
    .sort((a, b) => a[0].localeCompare(b[0]));

  for (const [fixtureId, prefix] of entries) {
    if (usedPrefixes.has(prefix)) continue;
    safe[fixtureId] = prefix;
    usedPrefixes.add(prefix);
  }

  return safe;
}

function normalizeColorPrefixRuleScope(value, fallback = "brand") {
  const token = String(value || "").trim().toLowerCase();
  if (token === "brand" || token === "fixture") return token;
  return String(fallback || "brand").trim().toLowerCase() === "fixture" ? "fixture" : "brand";
}

function normalizeColorPrefixRuleSelectionKey(value, fallback = "") {
  const token = String(value || "").trim();
  if (!token) return String(fallback || "").trim();
  if (token.startsWith("brand:") || token.startsWith("fixture:")) return token;
  return String(fallback || "").trim();
}

function cloneColorPrefixRuleState(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return {
    prefixes: {
      hue: normalizeColorPrefixToken(source?.prefixes?.hue),
      wiz: normalizeColorPrefixToken(source?.prefixes?.wiz),
      other: normalizeColorPrefixToken(source?.prefixes?.other)
    },
    fixturePrefixes: normalizeColorFixturePrefixMap(source.fixturePrefixes),
    capabilities: {
      other: source?.capabilities?.other === true
    }
  };
}

function dedupeColorPrefixRuleState(input = {}, options = {}) {
  const source = cloneColorPrefixRuleState(input);
  const opts = options && typeof options === "object" ? options : {};
  const allowOther = opts.allowOther !== false;
  const seen = new Set();
  const next = {
    prefixes: { hue: "", wiz: "", other: "" },
    fixturePrefixes: {},
    capabilities: {
      other: source?.capabilities?.other === true
    }
  };

  for (const brand of ["hue", "wiz", "other"]) {
    if (brand === "other" && allowOther !== true) continue;
    const prefix = normalizeColorPrefixToken(source?.prefixes?.[brand]);
    if (!prefix || seen.has(prefix)) continue;
    next.prefixes[brand] = prefix;
    seen.add(prefix);
  }

  const fixtureEntries = Object.entries(source.fixturePrefixes || {})
    .map(([fixtureId, prefix]) => [String(fixtureId || "").trim(), normalizeColorPrefixToken(prefix)])
    .filter(([fixtureId, prefix]) => fixtureId && prefix)
    .sort((a, b) => a[0].localeCompare(b[0]));
  for (const [fixtureId, prefix] of fixtureEntries) {
    if (seen.has(prefix)) continue;
    next.fixturePrefixes[fixtureId] = prefix;
    seen.add(prefix);
  }
  return next;
}

function resolveColorPrefixRuleFixtureCatalogUi() {
  const rows = Array.isArray(ui.fixturesCatalog) ? ui.fixturesCatalog : [];
  return rows
    .map(row => ({
      id: String(row?.id || "").trim(),
      brand: String(row?.brand || "").trim().toLowerCase(),
      zone: String(row?.zone || "").trim().toLowerCase(),
      twitchEnabled: row?.twitchEnabled !== false
    }))
    .filter(row => row.id)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function resolveColorPrefixRuleBrandCatalogUi(ruleState = {}) {
  const capabilities = ruleState?.capabilities && typeof ruleState.capabilities === "object"
    ? ruleState.capabilities
    : {};
  const out = [
    { id: "hue", label: "hue" },
    { id: "wiz", label: "wiz" }
  ];
  if (capabilities.other === true || normalizeColorPrefixToken(ruleState?.prefixes?.other)) {
    out.push({ id: "other", label: "mod-brand (all custom brands)" });
  }
  return out;
}

function buildColorPrefixRuleRows(ruleState = {}) {
  const state = cloneColorPrefixRuleState(ruleState);
  const fixtureCatalog = resolveColorPrefixRuleFixtureCatalogUi();
  const fixtureById = new Map(fixtureCatalog.map(row => [row.id, row]));
  const rows = [];

  for (const brand of ["hue", "wiz", "other"]) {
    const prefix = normalizeColorPrefixToken(state?.prefixes?.[brand]);
    if (!prefix) continue;
    rows.push({
      key: `brand:${brand}`,
      scope: "brand",
      targetId: brand,
      targetLabel: brand === "other" ? "mod-brand (all custom brands)" : brand,
      prefix
    });
  }

  for (const [fixtureId, prefixRaw] of Object.entries(state.fixturePrefixes || {}).sort((a, b) => a[0].localeCompare(b[0]))) {
    const prefix = normalizeColorPrefixToken(prefixRaw);
    if (!prefix) continue;
    const fixture = fixtureById.get(fixtureId);
    const detail = fixture
      ? `${fixture.brand || "unknown"}${fixture.zone ? `/${fixture.zone}` : ""}`
      : "not-loaded";
    rows.push({
      key: `fixture:${fixtureId}`,
      scope: "fixture",
      targetId: fixtureId,
      targetLabel: `${fixtureId} (${detail})`,
      prefix
    });
  }

  return rows;
}

function findColorPrefixRuleDuplicate(state = {}, candidatePrefix = "", ignoreKey = "") {
  const prefix = normalizeColorPrefixToken(candidatePrefix);
  if (!prefix) return null;
  const rows = buildColorPrefixRuleRows(state);
  const ignored = normalizeColorPrefixRuleSelectionKey(ignoreKey, "");
  return rows.find(row => row.prefix === prefix && row.key !== ignored) || null;
}

function setColorPrefixRuleEditorVisibility(scopeRaw = "brand") {
  const scope = normalizeColorPrefixRuleScope(scopeRaw, "brand");
  if (el.colorPrefixRuleBrandWrap) {
    el.colorPrefixRuleBrandWrap.classList.toggle("hidden", scope !== "brand");
  }
  if (el.colorPrefixRuleFixtureWrap) {
    el.colorPrefixRuleFixtureWrap.classList.toggle("hidden", scope !== "fixture");
  }
}

function updateColorPrefixStatusText(options = {}) {
  if (!el.colorPrefixStatus) return;
  const opts = options && typeof options === "object" ? options : {};
  const ruleState = cloneColorPrefixRuleState(ui.colorPrefixRuleState || {});
  const ruleRows = buildColorPrefixRuleRows(ruleState);
  const defaultTarget = normalizeColorPrefixDefaultTarget(ui.colorPrefixDefaultTarget, "both");
  const raveOffEnabled = ui.colorRaveOffEnabled !== false;
  const brandRuleCount = ruleRows.filter(row => row.scope === "brand").length;
  const fixtureRuleCount = ruleRows.filter(row => row.scope === "fixture").length;
  const suffix = String(opts.suffix || "").trim();
  el.colorPrefixStatus.textContent =
    `Unprefixed /color -> ${defaultTarget.toUpperCase()}. Prefix rules: ${ruleRows.length} ` +
    `(brand ${brandRuleCount}, fixture ${fixtureRuleCount}). RAVE OFF profile: ${raveOffEnabled ? "ON" : "OFF"}.` +
    (suffix ? ` ${suffix}` : "");
}

function syncColorPrefixRuleEditorFromSelection(options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const selectedKey = normalizeColorPrefixRuleSelectionKey(
    el.colorPrefixRuleList?.value || ui.colorPrefixRuleSelectedKey || "",
    ""
  );
  if (!selectedKey) {
    if (opts.clearWhenMissing === true && el.colorPrefixRuleValue) {
      el.colorPrefixRuleValue.value = "";
    }
    ui.colorPrefixRuleSelectedKey = "";
    return false;
  }
  const [scopeRaw, targetRaw] = selectedKey.split(":", 2);
  const scope = normalizeColorPrefixRuleScope(scopeRaw, "brand");
  const target = String(targetRaw || "").trim();
  const state = cloneColorPrefixRuleState(ui.colorPrefixRuleState || {});
  const prefix = scope === "brand"
    ? normalizeColorPrefixToken(state?.prefixes?.[target])
    : normalizeColorPrefixToken(state?.fixturePrefixes?.[target]);

  ui.colorPrefixRuleSelectedKey = selectedKey;
  if (el.colorPrefixRuleScope) el.colorPrefixRuleScope.value = scope;
  setColorPrefixRuleEditorVisibility(scope);
  if (scope === "brand" && el.colorPrefixRuleBrand) {
    el.colorPrefixRuleBrand.value = target;
  }
  if (scope === "fixture" && el.colorPrefixRuleFixture) {
    el.colorPrefixRuleFixture.value = target;
  }
  if (el.colorPrefixRuleValue) {
    el.colorPrefixRuleValue.value = prefix;
  }
  return true;
}

function renderColorPrefixRuleEditor(options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const baseState = opts.ruleState
    ? cloneColorPrefixRuleState(opts.ruleState)
    : cloneColorPrefixRuleState(ui.colorPrefixRuleState || {});
  const allowOther = baseState?.capabilities?.other === true;
  const nextState = dedupeColorPrefixRuleState(baseState, { allowOther });
  ui.colorPrefixRuleState = nextState;

  const brandOptions = resolveColorPrefixRuleBrandCatalogUi(nextState);
  const fixtureCatalog = resolveColorPrefixRuleFixtureCatalogUi();
  const fixtureOptions = fixtureCatalog.filter(row => row.twitchEnabled !== false);

  if (el.colorPrefixRuleBrand) {
    const current = String(el.colorPrefixRuleBrand.value || "").trim();
    el.colorPrefixRuleBrand.innerHTML = brandOptions
      .map(row => `<option value="${escapeColorPrefixHtml(row.id)}">${escapeColorPrefixHtml(row.label)}</option>`)
      .join("");
    const fallback = brandOptions[0]?.id || "hue";
    el.colorPrefixRuleBrand.value = brandOptions.some(row => row.id === current) ? current : fallback;
  }

  if (el.colorPrefixRuleFixture) {
    const current = String(el.colorPrefixRuleFixture.value || "").trim();
    const optionsHtml = fixtureOptions.length
      ? fixtureOptions
        .map(row =>
          `<option value="${escapeColorPrefixHtml(row.id)}">` +
          `${escapeColorPrefixHtml(row.id)} (${escapeColorPrefixHtml(row.brand || "unknown")})` +
          `</option>`
        )
        .join("")
      : `<option value="">no twitch fixtures loaded</option>`;
    el.colorPrefixRuleFixture.innerHTML = optionsHtml;
    const fallback = fixtureOptions[0]?.id || "";
    el.colorPrefixRuleFixture.value = fixtureOptions.some(row => row.id === current) ? current : fallback;
  }

  const scope = normalizeColorPrefixRuleScope(el.colorPrefixRuleScope?.value || "brand", "brand");
  if (el.colorPrefixRuleScope) {
    el.colorPrefixRuleScope.value = scope;
  }
  setColorPrefixRuleEditorVisibility(scope);

  const rows = buildColorPrefixRuleRows(nextState);
  if (el.colorPrefixRuleList) {
    const currentSelection = normalizeColorPrefixRuleSelectionKey(
      opts.preferSelectedKey || ui.colorPrefixRuleSelectedKey || el.colorPrefixRuleList.value || "",
      ""
    );
    el.colorPrefixRuleList.innerHTML = rows.length
      ? rows
        .map(row =>
          `<option value="${escapeColorPrefixHtml(row.key)}">` +
          `${escapeColorPrefixHtml(row.scope.toUpperCase())} | ` +
          `${escapeColorPrefixHtml(row.targetLabel)} = ${escapeColorPrefixHtml(row.prefix)}` +
          `</option>`
        )
        .join("")
      : `<option value="">no prefix rules yet</option>`;
    const hasSelection = rows.some(row => row.key === currentSelection);
    el.colorPrefixRuleList.value = hasSelection ? currentSelection : (rows[0]?.key || "");
    ui.colorPrefixRuleSelectedKey = normalizeColorPrefixRuleSelectionKey(el.colorPrefixRuleList.value, "");
  }
  if (el.colorPrefixRuleRemoveBtn) {
    el.colorPrefixRuleRemoveBtn.disabled = !ui.colorPrefixRuleSelectedKey;
  }

  if (opts.syncEditor !== false) {
    syncColorPrefixRuleEditorFromSelection({ clearWhenMissing: true });
  }
}

function applyColorPrefixSnapshot(snapshot = {}) {
  const config = snapshot?.config && typeof snapshot.config === "object"
    ? snapshot.config
    : snapshot;
  const raveOffRaw = config?.raveOff && typeof config.raveOff === "object"
    ? config.raveOff
    : {};
  const raveOffEnabled = raveOffRaw.enabled !== false;
  const raveOffDefaultText = normalizeColorCommandText(raveOffRaw.defaultText, "random");
  const raveOffGroups = normalizeColorRaveOffGroupMap(raveOffRaw.groups);
  const raveOffFixtures = normalizeColorRaveOffFixtureMap(raveOffRaw.fixtures);
  const capabilities = snapshot?.capabilities && typeof snapshot.capabilities === "object"
    ? snapshot.capabilities
    : {};

  ui.colorRaveOffEnabled = raveOffEnabled;
  ui.colorPrefixDefaultTarget = normalizeColorPrefixDefaultTarget(config?.defaultTarget, "both");
  ui.colorPrefixOtherEnabled = capabilities.other === true;
  ui.colorPrefixRuleState = dedupeColorPrefixRuleState({
    prefixes: config?.prefixes && typeof config.prefixes === "object" ? config.prefixes : {},
    fixturePrefixes: config?.fixturePrefixes && typeof config.fixturePrefixes === "object" ? config.fixturePrefixes : {},
    capabilities: {
      other: capabilities.other === true
    }
  }, {
    allowOther: true
  });

  if (el.colorPrefixDefaultTarget) el.colorPrefixDefaultTarget.value = ui.colorPrefixDefaultTarget;
  if (el.colorRaveOffEnabled) el.colorRaveOffEnabled.value = raveOffEnabled ? "1" : "0";
  if (el.colorRaveOffDefault) el.colorRaveOffDefault.value = raveOffDefaultText;
  if (el.colorRaveOffGroupMap) el.colorRaveOffGroupMap.value = formatColorRaveOffGroupMapText(raveOffGroups);
  if (el.colorRaveOffFixtureMap) el.colorRaveOffFixtureMap.value = formatColorRaveOffFixtureMapText(raveOffFixtures);
  if (el.colorPrefixSaveBtn) el.colorPrefixSaveBtn.disabled = false;
  if (el.colorPrefixResetBtn) el.colorPrefixResetBtn.disabled = false;
  renderColorPrefixRuleEditor({ syncEditor: true });
  updateColorPrefixStatusText();
}

async function loadColorPrefixConfig() {
  const snapshot = await colorPrefixEndpointsAdapter.getConfig();
  if (!snapshot || !snapshot.ok) return false;
  applyColorPrefixSnapshot(snapshot);
  ui.colorPrefixConfigLoaded = true;
  return true;
}

async function saveColorPrefixConfigFromUi(options = {}) {
  const reset = options.reset === true;

  let defaultTarget = normalizeColorPrefixDefaultTarget(el.colorPrefixDefaultTarget?.value || "both", "both");
  let ruleState = dedupeColorPrefixRuleState(ui.colorPrefixRuleState || {}, {
    allowOther: true
  });
  let raveOffEnabled = String(el.colorRaveOffEnabled?.value || "1") !== "0";
  let raveOffDefaultText = normalizeColorCommandText(el.colorRaveOffDefault?.value || "", "random");
  let raveOffGroupMap = parseColorRaveOffGroupMapText(el.colorRaveOffGroupMap?.value || "");
  let raveOffFixtureMap = parseColorRaveOffFixtureMapText(el.colorRaveOffFixtureMap?.value || "");

  if (reset) {
    ruleState = dedupeColorPrefixRuleState({
      prefixes: {
        hue: "hue",
        wiz: "wiz",
        other: ""
      },
      fixturePrefixes: {},
      capabilities: {
        other: ui.colorPrefixOtherEnabled === true
      }
    }, {
      allowOther: true
    });
    defaultTarget = "hue";
    raveOffEnabled = true;
    raveOffDefaultText = "random";
    raveOffGroupMap = { ok: true, map: {}, errors: [] };
    raveOffFixtureMap = { ok: true, map: {}, errors: [] };
  }

  if (!reset && !raveOffGroupMap.ok) {
    const firstError = raveOffGroupMap.errors[0] || "invalid rave-off group map";
    setBadge(el.health, "bad", `INVALID RAVE-OFF GROUP MAP (${firstError})`);
    return false;
  }
  if (!reset && !raveOffFixtureMap.ok) {
    const firstError = raveOffFixtureMap.errors[0] || "invalid rave-off fixture map";
    setBadge(el.health, "bad", `INVALID RAVE-OFF FIXTURE MAP (${firstError})`);
    return false;
  }

  const payload = {
    defaultTarget,
    prefixes: {
      hue: normalizeColorPrefixToken(ruleState?.prefixes?.hue),
      wiz: normalizeColorPrefixToken(ruleState?.prefixes?.wiz),
      other: normalizeColorPrefixToken(ruleState?.prefixes?.other)
    },
    fixturePrefixes: reset ? {} : normalizeColorFixturePrefixMap(ruleState.fixturePrefixes),
    raveOff: {
      enabled: raveOffEnabled,
      defaultText: raveOffDefaultText,
      groups: reset ? {} : raveOffGroupMap.map,
      fixtures: reset ? {} : raveOffFixtureMap.map
    }
  };

  if (!ui.colorPrefixOtherEnabled) {
    payload.prefixes.other = "";
  }

  const r = await colorPrefixEndpointsAdapter.saveConfig(payload);
  if (!r.ok || !r.data?.ok) {
    setBadge(el.health, "bad", "PREFIX CONFIG SAVE FAIL");
    return false;
  }

  applyColorPrefixSnapshot(r.data);
  setBadge(el.health, "ok", reset ? "PREFIXES RESET TO DEFAULTS" : "PREFIX CONFIG SAVED");
  return true;
}

// [TITLE] Section: Color Prefix Control Wiring
// [DEV] Prefix actions are FIXTURES-domain controls and must not depend on LIVE
// [DEV] runtime wiring. Keeping handlers here avoids hidden cross-tab coupling.
if (el.colorPrefixSaveBtn) {
  el.colorPrefixSaveBtn.onclick = async () => {
    await saveColorPrefixConfigFromUi({ reset: false });
  };
}

if (el.colorPrefixResetBtn) {
  el.colorPrefixResetBtn.onclick = async () => {
    await saveColorPrefixConfigFromUi({ reset: true });
  };
}

function resolveColorPrefixRuleDraftFromUi() {
  const scope = normalizeColorPrefixRuleScope(el.colorPrefixRuleScope?.value || "brand", "brand");
  const target = scope === "brand"
    ? String(el.colorPrefixRuleBrand?.value || "").trim().toLowerCase()
    : String(el.colorPrefixRuleFixture?.value || "").trim();
  const rawPrefix = String(el.colorPrefixRuleValue?.value || "").trim().toLowerCase();
  const prefix = normalizeColorPrefixToken(rawPrefix);
  const prefixInputState = !rawPrefix ? "empty" : (prefix ? "valid" : "invalid");
  return { scope, target, prefix, rawPrefix, prefixInputState };
}

function addOrUpdateColorPrefixRuleFromUi() {
  const draft = resolveColorPrefixRuleDraftFromUi();
  if (draft.scope === "brand" && !(draft.target === "hue" || draft.target === "wiz" || draft.target === "other")) {
    setBadge(el.health, "bad", "SELECT A BRAND TARGET");
    return false;
  }
  if (draft.scope === "fixture" && !draft.target) {
    setBadge(el.health, "bad", "SELECT A FIXTURE TARGET");
    return false;
  }
  if (draft.prefixInputState === "invalid") {
    setBadge(el.health, "bad", "INVALID PREFIX TOKEN (USE a-z 0-9 _ -)");
    return false;
  }

  const ruleKey = `${draft.scope}:${draft.target}`;
  const current = dedupeColorPrefixRuleState(ui.colorPrefixRuleState || {}, { allowOther: true });
  if (!draft.prefix) {
    if (draft.scope === "brand") {
      current.prefixes[draft.target] = "";
    } else {
      delete current.fixturePrefixes[draft.target];
    }
    ui.colorPrefixRuleState = dedupeColorPrefixRuleState(current, { allowOther: true });
    ui.colorPrefixRuleSelectedKey = "";
    renderColorPrefixRuleEditor({ syncEditor: true });
    updateColorPrefixStatusText({ suffix: "Unsaved prefix rule changes." });
    setBadge(el.health, "ok", "PREFIX CLEARED (UNPREFIXED)");
    return true;
  }

  const duplicate = findColorPrefixRuleDuplicate(current, draft.prefix, ruleKey);
  if (duplicate) {
    setBadge(el.health, "bad", `PREFIX '${draft.prefix}' ALREADY USED`);
    return false;
  }

  if (draft.scope === "brand") {
    current.prefixes[draft.target] = draft.prefix;
  } else {
    current.fixturePrefixes[draft.target] = draft.prefix;
  }
  ui.colorPrefixRuleState = dedupeColorPrefixRuleState(current, { allowOther: true });
  ui.colorPrefixRuleSelectedKey = ruleKey;
  renderColorPrefixRuleEditor({ preferSelectedKey: ruleKey, syncEditor: true });
  updateColorPrefixStatusText({ suffix: "Unsaved prefix rule changes." });
  setBadge(el.health, "ok", "PREFIX RULE STAGED");
  return true;
}

function removeSelectedColorPrefixRuleFromUi() {
  const selectedKey = normalizeColorPrefixRuleSelectionKey(
    el.colorPrefixRuleList?.value || ui.colorPrefixRuleSelectedKey || "",
    ""
  );
  if (!selectedKey) {
    setBadge(el.health, "warn", "SELECT A PREFIX RULE TO REMOVE");
    return false;
  }
  const [scopeRaw, targetRaw] = selectedKey.split(":", 2);
  const scope = normalizeColorPrefixRuleScope(scopeRaw, "brand");
  const target = String(targetRaw || "").trim();
  const current = dedupeColorPrefixRuleState(ui.colorPrefixRuleState || {}, { allowOther: true });
  if (scope === "brand") {
    if (target === "hue" || target === "wiz" || target === "other") {
      current.prefixes[target] = "";
    }
  } else if (scope === "fixture" && target) {
    delete current.fixturePrefixes[target];
  }
  ui.colorPrefixRuleState = dedupeColorPrefixRuleState(current, { allowOther: true });
  ui.colorPrefixRuleSelectedKey = "";
  renderColorPrefixRuleEditor({ syncEditor: true });
  updateColorPrefixStatusText({ suffix: "Unsaved prefix rule changes." });
  setBadge(el.health, "ok", "PREFIX RULE REMOVED");
  return true;
}

if (el.colorPrefixRuleScope) {
  el.colorPrefixRuleScope.onchange = () => {
    setColorPrefixRuleEditorVisibility(el.colorPrefixRuleScope.value);
  };
}

if (el.colorPrefixRuleList) {
  el.colorPrefixRuleList.onchange = () => {
    syncColorPrefixRuleEditorFromSelection({ clearWhenMissing: true });
  };
}

if (el.colorPrefixRuleAddBtn) {
  el.colorPrefixRuleAddBtn.onclick = () => {
    addOrUpdateColorPrefixRuleFromUi();
  };
}

if (el.colorPrefixRuleRemoveBtn) {
  el.colorPrefixRuleRemoveBtn.onclick = () => {
    removeSelectedColorPrefixRuleFromUi();
  };
}

if (el.colorPrefixRuleValue) {
  el.colorPrefixRuleValue.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addOrUpdateColorPrefixRuleFromUi();
  });
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("ravelink:live-scope-targets-updated", () => {
    renderColorPrefixRuleEditor({
      preferSelectedKey: ui.colorPrefixRuleSelectedKey || "",
      syncEditor: false
    });
  });
}

