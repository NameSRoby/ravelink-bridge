// [TITLE] Module: public/assets/js/domains/mods.js
// [TITLE] Purpose: mods domain state normalization, UI catalog/render, hotswap queueing, and import/action workflows
// [TITLE] Functionality Index:
// [TITLE] - dynamic mod UI catalog + iframe host wiring
// [TITLE] - mod runtime snapshot render + hotswap draft queue
// [TITLE] - mod import pipeline (browse/drop -> payload -> upload)
// [DEV] Complex Flow:
// [DEV] This module keeps mod runtime and UI-host state in one owner so queued draft changes,
// [DEV] snapshot refreshes, and iframe tab state stay synchronized across apply/discard/import
// [DEV] operations. Keep route payload shapes and status/badge semantics behavior-identical.

// [TITLE] Section: Mods UI Host Runtime Composition
// [DEV] Dynamic mod-ui tab/catalog/frame ownership is delegated to a focused runtime
// [DEV] module so mods.js can stay as orchestration shell for refresh loops and event wiring.
const modsUiHostRuntime = (typeof createModsUiHostRuntimeUi === "function"
  ? createModsUiHostRuntimeUi({
    el,
    ui,
    documentRef: document,
    localStorageRef: localStorage,
    withBase,
    modsEndpointsAdapter,
    MOD_UI_SELECTED_KEY
  })
  : (() => {
    throw new Error("mods ui-host runtime module missing");
  })());
function normalizeModUiId(value) {
  return modsUiHostRuntime.normalizeModUiId(value);
}
function normalizeModUiCatalogEntries(entries = []) {
  return modsUiHostRuntime.normalizeModUiCatalogEntries(entries);
}
function formatModUiTabLabel(item = {}) {
  return modsUiHostRuntime.formatModUiTabLabel(item);
}
function buildModUiTabName(modId = "") {
  return modsUiHostRuntime.buildModUiTabName(modId);
}
function isModUiTabName(value = "") {
  return modsUiHostRuntime.isModUiTabName(value);
}
function getModUiIdFromTabName(value = "") {
  return modsUiHostRuntime.getModUiIdFromTabName(value);
}
function syncModUiPanelViewMode(tabName = ui.activeTab) {
  return modsUiHostRuntime.syncModUiPanelViewMode(tabName);
}
function syncDynamicModUiTabButtons() {
  return modsUiHostRuntime.syncDynamicModUiTabButtons();
}
function rebuildDynamicModUiTabs() {
  return modsUiHostRuntime.rebuildDynamicModUiTabs();
}
function buildModUiCatalogFromModsSnapshot(snapshot) {
  return modsUiHostRuntime.buildModUiCatalogFromModsSnapshot(snapshot);
}
function getSelectedModUiDescriptor() {
  return modsUiHostRuntime.getSelectedModUiDescriptor();
}
function syncModUiSelectionToHotswapTarget(options = {}) {
  return modsUiHostRuntime.syncModUiSelectionToHotswapTarget(options);
}
function buildModUiFrameUrl(descriptor, options = {}) {
  return modsUiHostRuntime.buildModUiFrameUrl(descriptor, options);
}
function renderModUiFrame(options = {}) {
  return modsUiHostRuntime.renderModUiFrame(options);
}
function applyModUiCatalog(catalog = [], options = {}) {
  return modsUiHostRuntime.applyModUiCatalog(catalog, options);
}
function syncModUiCatalogFromModsSnapshot(snapshot, options = {}) {
  return modsUiHostRuntime.syncModUiCatalogFromModsSnapshot(snapshot, options);
}
function refreshModUiCatalog(options = {}) {
  return modsUiHostRuntime.refreshModUiCatalog(options);
}

const MODS_AUTO_REFRESH_MS = 2800;
let modsAutoRefreshTimer = null;
let modsAutoRefreshInFlight = false;

function isModsTabActive() {
  const activeTab = String(ui.activeTab || "").trim().toLowerCase();
  return activeTab === "mods" || (typeof isModUiTabName === "function" && isModUiTabName(activeTab));
}

function shouldAutoRefreshMods() {
  if (document.hidden) return false;
  if (isModsTabActive()) return true;
  return Number(ui.modsLoadedAt || 0) <= 0;
}

async function refreshModsBackground(options = {}) {
  const force = options.force === true;
  if (!force && !shouldAutoRefreshMods()) return false;
  if (modsAutoRefreshInFlight) return false;

  modsAutoRefreshInFlight = true;
  try {
    const ok = await loadMods();
    if (ok && isModsTabActive()) {
      await refreshModUiCatalog({ preferRemote: true, forceReload: false, persist: true });
    }
    return ok;
  } catch (err) {
    console.debug("[MODS][DEBUG] background refresh failed:", err?.message || err);
    return false;
  } finally {
    modsAutoRefreshInFlight = false;
  }
}

function startModsAutoRefreshLoop() {
  if (modsAutoRefreshTimer) return;
  modsAutoRefreshTimer = setInterval(() => {
    refreshModsBackground().catch(() => {});
  }, MODS_AUTO_REFRESH_MS);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      refreshModsBackground({ force: true }).catch(() => {});
    }
  });

  window.addEventListener("focus", () => {
    refreshModsBackground({ force: true }).catch(() => {});
  });
}


function normalizeModIdList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    const id = String(raw || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function normalizeModConfig(config = {}) {
  const source = config && typeof config === "object" ? config : {};
  return {
    enabled: normalizeModIdList(source.enabled),
    order: normalizeModIdList(source.order),
    disabled: normalizeModIdList(source.disabled)
  };
}

function cloneModConfig(config = {}) {
  const normalized = normalizeModConfig(config);
  return {
    enabled: [...normalized.enabled],
    order: [...normalized.order],
    disabled: [...normalized.disabled]
  };
}

function resolveQueuedModEnabled(modId, runtimeEnabled, draftConfig) {
  const id = String(modId || "").trim();
  if (!id) return Boolean(runtimeEnabled);
  const draft = normalizeModConfig(draftConfig);
  if (draft.disabled.includes(id)) return false;
  if (draft.enabled.includes(id)) return true;
  return Boolean(runtimeEnabled);
}

function getEffectiveModConfig() {
  return ui.modsDraftDirty
    ? cloneModConfig(ui.modsDraftConfig)
    : cloneModConfig(ui.modsRuntimeConfig);
}

function updateModHotswapUi(mods = []) {
  const effective = getEffectiveModConfig();
  let pendingCount = 0;
  for (const mod of (Array.isArray(mods) ? mods : [])) {
    const runtimeEnabled = Boolean(mod?.enabled);
    const queuedEnabled = resolveQueuedModEnabled(mod?.id, runtimeEnabled, effective);
    if (queuedEnabled !== runtimeEnabled) pendingCount += 1;
  }
  ui.modsDraftDirty = pendingCount > 0;

  const runtimeStatus = `${ui.modsActive}/${ui.modsTotal} loaded`;
  const updatedAtText = ui.modsSnapshot?.loadedAt
    ? ` | updated ${new Date(ui.modsSnapshot.loadedAt).toLocaleTimeString()}`
    : "";
  const pendingText = pendingCount > 0 ? ` | ${pendingCount} pending apply` : "";
  if (el.modsStatus) {
    el.modsStatus.value = `${runtimeStatus}${updatedAtText}${pendingText}`;
  }

  if (el.modHotswapStatus) {
    if (pendingCount > 0) {
      el.modHotswapStatus.value = `${pendingCount} queued change(s). Click APPLY HOTSWAP to load/unload mods live.`;
    } else {
      el.modHotswapStatus.value = "No pending mod changes.";
    }
  }

  if (el.modApplyBtn) el.modApplyBtn.disabled = pendingCount <= 0;
  if (el.modDiscardBtn) el.modDiscardBtn.disabled = pendingCount <= 0;
}

function setModsDebugUi(debugSnapshot = null) {
  const snapshot = debugSnapshot && typeof debugSnapshot === "object"
    ? debugSnapshot
    : { enabled: false };
  const enabled = snapshot.enabled === true;
  const sampleMs = Math.max(0, Number(snapshot.telemetryDebugSampleMs) || 0);
  const noHandlerMs = Math.max(0, Number(snapshot.telemetryNoHandlerDebugMs) || 0);

  ui.modsDebugEnabled = enabled;
  ui.modsDebugLoaded = true;

  if (el.modsDebugStatus) {
    if (enabled) {
      el.modsDebugStatus.value = `MOD DEBUG ON | sampled telemetry: ${sampleMs}ms | no-handler: ${noHandlerMs}ms`;
    } else {
      el.modsDebugStatus.value = "MOD DEBUG OFF | concise logs for normal use";
    }
  }
  if (el.modsDebugToggleBtn) {
    el.modsDebugToggleBtn.textContent = enabled ? "MOD DEBUG ON" : "MOD DEBUG OFF";
    el.modsDebugToggleBtn.classList.toggle("warn", enabled);
  }
}

async function setModsDebugEnabled(enabled) {
  if (!el.modsDebugToggleBtn) return false;
  const desired = Boolean(enabled);
  el.modsDebugToggleBtn.disabled = true;
  try {
    const response = await modsEndpointsAdapter.setDebugEnabled(desired);
    if (!response.ok || !response.data?.ok || !response.data?.debug) {
      return false;
    }
    setModsDebugUi(response.data.debug);
    return true;
  } finally {
    el.modsDebugToggleBtn.disabled = false;
  }
}

async function clearModsDebugBuffer() {
  if (!el.modsDebugClearBtn) return false;
  el.modsDebugClearBtn.disabled = true;
  try {
    const response = await modsEndpointsAdapter.clearDebugBuffer();
    if (!response.ok || !response.data?.ok || !response.data?.debug) {
      return false;
    }
    setModsDebugUi(response.data.debug);
    return true;
  } finally {
    el.modsDebugClearBtn.disabled = false;
  }
}

function getModTooltipText(mod) {
  const primary = String(mod?.tooltip || "").trim();
  const fallback = String(mod?.description || "").trim();
  const combined = (primary || fallback).replace(/\s+/g, " ").trim();
  if (!combined) return "";
  if (combined.length <= 320) return combined;
  return `${combined.slice(0, 317).trimEnd()}...`;
}

function createStatusPill(className, label) {
  const pill = document.createElement("span");
  pill.className = `statusPill ${className}`;
  pill.textContent = String(label || "");
  return pill;
}

function renderMods(modSnapshot) {
  ui.modsSnapshot = modSnapshot && typeof modSnapshot === "object"
    ? modSnapshot
    : null;

  const mods = Array.isArray(modSnapshot?.mods) ? modSnapshot.mods : [];
  ui.modsTotal = Number(modSnapshot?.total || mods.length || 0);
  ui.modsActive = Number(modSnapshot?.loaded || 0);
  ui.modsLoadedAt = Date.now();
  syncFixtureBrandOptions();
  ui.modsRuntimeConfig = normalizeModConfig(modSnapshot?.config || {});
  if (modSnapshot?.debug && typeof modSnapshot.debug === "object") {
    setModsDebugUi(modSnapshot.debug);
  } else if (!ui.modsDebugLoaded) {
    setModsDebugUi({ enabled: false });
  }
  if (!ui.modsDraftDirty) {
    ui.modsDraftConfig = cloneModConfig(ui.modsRuntimeConfig);
  }

  const effectiveConfig = getEffectiveModConfig();

  if (!el.modsRows) return;
  el.modsRows.innerHTML = "";
  if (!mods.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 7;
    td.textContent = "No mods discovered. Add folders under /mods with mod.json.";
    tr.appendChild(td);
    el.modsRows.appendChild(tr);
    updateModHotswapUi(mods);
    syncModUiCatalogFromModsSnapshot(modSnapshot, { forceReload: false, persist: true });
    return;
  }

  for (const mod of mods) {
    const tr = document.createElement("tr");
    const modId = String(mod.id || "").trim();
    const runtimeEnabled = Boolean(mod.enabled);
    const queuedEnabled = resolveQueuedModEnabled(modId, runtimeEnabled, effectiveConfig);
    const hasPending = queuedEnabled !== runtimeEnabled;
    const tooltipText = getModTooltipText(mod);

    const tdId = document.createElement("td");
    tdId.className = "mono";
    tdId.textContent = String(mod.id || "-");
    if (tooltipText) {
      tdId.title = tooltipText;
      tr.title = tooltipText;
    }

    const tdVersion = document.createElement("td");
    tdVersion.className = "mono";
    tdVersion.textContent = String(mod.version || "-");

    const tdEnabled = document.createElement("td");
    tdEnabled.appendChild(
      createStatusPill(runtimeEnabled ? "ok" : "bad", runtimeEnabled ? "YES" : "NO")
    );

    const tdPending = document.createElement("td");
    if (hasPending) {
      tdPending.appendChild(
        createStatusPill("warn", queuedEnabled ? "ENABLE" : "DISABLE")
      );
    } else {
      tdPending.textContent = "-";
    }

    const tdLoaded = document.createElement("td");
    tdLoaded.appendChild(
      createStatusPill(mod.loaded ? "ok" : "bad", mod.loaded ? "LOADED" : "OFFLINE")
    );

    const tdHooks = document.createElement("td");
    tdHooks.className = "mono";
    tdHooks.textContent = Array.isArray(mod.hooks) && mod.hooks.length
      ? mod.hooks.join(", ")
      : "-";

    const tdError = document.createElement("td");
    tdError.className = "mono";
    tdError.textContent = mod.error ? String(mod.error) : "-";

    tr.appendChild(tdId);
    tr.appendChild(tdVersion);
    tr.appendChild(tdEnabled);
    tr.appendChild(tdPending);
    tr.appendChild(tdLoaded);
    tr.appendChild(tdHooks);
    tr.appendChild(tdError);
    el.modsRows.appendChild(tr);
  }

  const currentEnableDraft = String(el.modEnableId.value || "").trim();
  if (!currentEnableDraft && mods.length) {
    const firstDisabled = mods.find(mod => !resolveQueuedModEnabled(mod.id, Boolean(mod.enabled), effectiveConfig));
    if (el.modEnableId) el.modEnableId.value = String(firstDisabled?.id || mods[0]?.id || "");
  }

  updateModHotswapUi(mods);
  syncModUiCatalogFromModsSnapshot(modSnapshot, { forceReload: false, persist: true });
}

async function loadMods() {
  const snapshot = await modsEndpointsAdapter.getSnapshot();
  if (!snapshot || !snapshot.ok) {
    if (el.modsStatus) {
      const reason = String(snapshot?.error || "mods snapshot unavailable");
      el.modsStatus.value = `MOD SNAPSHOT FAIL | ${reason}`;
    }
    return false;
  }
  renderMods(snapshot);
  return true;
}

// [TITLE] Section: Mods Import Runtime Composition
// [DEV] Import pipeline (browse/drop -> descriptor normalization -> payload upload)
// [DEV] is delegated to a bounded runtime module so mods orchestrator can focus on
// [DEV] catalog/draft/apply state ownership.
const modsImportRuntime = (typeof createModsImportRuntimeUi === "function"
  ? createModsImportRuntimeUi({
    el,
    ui,
    windowRef: window,
    FileReaderRef: FileReader,
    setBadge: (node, state, text) => typeof setBadge === "function" ? setBadge(node, state, text) : undefined,
    renderMods,
    loadMods,
    cloneModConfig,
    modsEndpointsAdapter
  })
  : (() => {
    throw new Error("mods import runtime module missing");
  })());
function normalizeImportRelativePath(rawPath) {
  return modsImportRuntime.normalizeImportRelativePath(rawPath);
}
function setModImportStatus(text) {
  return modsImportRuntime.setModImportStatus(text);
}
function setModImportBusy(busy) {
  return modsImportRuntime.setModImportBusy(busy);
}
function filesToImportDescriptors(fileList) {
  return modsImportRuntime.filesToImportDescriptors(fileList);
}
function readImportFileAsBase64(file) {
  return modsImportRuntime.readImportFileAsBase64(file);
}
function buildImportPayloadFromDescriptors(descriptors) {
  return modsImportRuntime.buildImportPayloadFromDescriptors(descriptors);
}
function readDroppedEntriesRecursively(entry, prefix = "") {
  return modsImportRuntime.readDroppedEntriesRecursively(entry, prefix);
}
function descriptorsFromDropEvent(event) {
  return modsImportRuntime.descriptorsFromDropEvent(event);
}
function importModFromDescriptors(descriptors, sourceLabel = "drop") {
  return modsImportRuntime.importModFromDescriptors(descriptors, sourceLabel);
}

// [TITLE] Section: Mods Hotswap Runtime Composition
// [DEV] Mod action invoke + hotswap draft queue/apply/discard logic is delegated to a
// [DEV] bounded runtime module while mods.js remains the orchestration shell.
const modsHotswapRuntime = (typeof createModsHotswapRuntimeUi === "function"
  ? createModsHotswapRuntimeUi({
    el,
    ui,
    setBadge: (node, state, text) => typeof setBadge === "function" ? setBadge(node, state, text) : undefined,
    modsEndpointsAdapter,
    loadMods,
    renderMods,
    cloneModConfig,
    normalizeModUiId,
    normalizeModIdList,
    resolveQueuedModEnabled
  })
  : (() => {
    throw new Error("mods hotswap runtime module missing");
  })());
async function runModAction() {
  return modsHotswapRuntime.runModAction();
}
async function queueModStateFromUi(shouldEnable = true) {
  return modsHotswapRuntime.queueModStateFromUi(shouldEnable);
}
async function enableModFromUi() {
  return modsHotswapRuntime.enableModFromUi();
}
async function disableModFromUi() {
  return modsHotswapRuntime.disableModFromUi();
}
async function applyModHotswapFromUi() {
  return modsHotswapRuntime.applyModHotswapFromUi();
}
function discardModDraftFromUi() {
  return modsHotswapRuntime.discardModDraftFromUi();
}

// [TITLE] Section: Mods UI Event Wiring
// [DEV] Why: mods panel actions should remain domain-owned with mod runtime/draft state.
// [DEV] Change safety: preserve handler order, badge copy, and import drag/drop behavior.

if (el.modsRefreshBtn) {
  el.modsRefreshBtn.onclick = async () => {
    const ok = await refreshModsBackground({ force: true });
    setBadge(el.health, ok ? "ok" : "bad", ok ? "MODS REFRESHED" : "MODS REFRESH FAIL");
  };
}

if (el.modsReloadBtn) {
  el.modsReloadBtn.onclick = async () => {
    if (ui.modsDraftDirty) {
      const proceed = window.confirm(
        "You have queued mod hotswap changes that are not applied yet.\n\nContinue reload anyway?"
      );
      if (!proceed) return;
    }
    const r = await modsEndpointsAdapter.reload();
    if (!r.ok || !r.data || !r.data.ok) {
      setBadge(el.health, "bad", "MODS RELOAD FAIL");
      return;
    }
    ui.modsDraftDirty = false;
    ui.modsDraftConfig = cloneModConfig(r.data?.config || {});
    renderMods(r.data);
    setBadge(el.health, "ok", "MODS RELOADED");
  };
}

if (el.modsDebugToggleBtn) {
  el.modsDebugToggleBtn.onclick = async () => {
    const next = !ui.modsDebugEnabled;
    const ok = await setModsDebugEnabled(next);
    setBadge(
      el.health,
      ok ? "ok" : "bad",
      ok
        ? (next ? "MOD DEBUG ENABLED" : "MOD DEBUG DISABLED")
        : "MOD DEBUG TOGGLE FAIL"
    );
  };
}

if (el.modsDebugClearBtn) {
  el.modsDebugClearBtn.onclick = async () => {
    const ok = await clearModsDebugBuffer();
    setBadge(el.health, ok ? "ok" : "bad", ok ? "MOD DEBUG BUFFER CLEARED" : "MOD DEBUG CLEAR FAIL");
  };
}

if (el.modImportBrowseBtn && el.modImportPicker) {
  el.modImportBrowseBtn.onclick = () => {
    el.modImportPicker.value = "";
    el.modImportPicker.click();
  };
}

if (el.modImportPicker) {
  el.modImportPicker.onchange = async () => {
    const descriptors = filesToImportDescriptors(el.modImportPicker.files || []);
    if (!descriptors.length) {
      setModImportStatus("No files selected.");
      return;
    }
    await importModFromDescriptors(descriptors, "folder picker");
  };
}

if (el.modDropZone) {
  const stopDefault = ev => {
    ev.preventDefault();
    ev.stopPropagation();
  };

  el.modDropZone.addEventListener("dragenter", ev => {
    stopDefault(ev);
    el.modDropZone.classList.add("dragOver");
  });
  el.modDropZone.addEventListener("dragover", ev => {
    stopDefault(ev);
    el.modDropZone.classList.add("dragOver");
  });
  el.modDropZone.addEventListener("dragleave", ev => {
    stopDefault(ev);
    el.modDropZone.classList.remove("dragOver");
  });
  el.modDropZone.addEventListener("drop", async ev => {
    stopDefault(ev);
    el.modDropZone.classList.remove("dragOver");
    const descriptors = await descriptorsFromDropEvent(ev);
    await importModFromDescriptors(descriptors, "drag/drop");
  });
}

if (el.modEnableBtn) el.modEnableBtn.onclick = enableModFromUi;
if (el.modDisableBtn) el.modDisableBtn.onclick = disableModFromUi;
if (el.modApplyBtn) el.modApplyBtn.onclick = applyModHotswapFromUi;
if (el.modDiscardBtn) el.modDiscardBtn.onclick = discardModDraftFromUi;
if (el.modActionRunBtn) el.modActionRunBtn.onclick = runModAction;

startModsAutoRefreshLoop();

