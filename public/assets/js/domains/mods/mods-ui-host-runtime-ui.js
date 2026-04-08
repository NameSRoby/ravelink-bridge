// [TITLE] Module: public/assets/js/domains/mods/mods-ui-host-runtime-ui.js
// [TITLE] Purpose: mods UI host runtime for dynamic tab catalog, selection, and iframe shell
// [TITLE] Functionality Index:
// [TITLE] - normalize UI catalog descriptors from snapshot/remote payloads
// [TITLE] - build/sync dynamic MOD UI tabs and selection persistence
// [TITLE] - render mod UI iframe shell state and reload URL lifecycle
// [DEV] Complex Flow:
// [DEV] UI host runtime keeps tab state and iframe URL cache deterministic while mods
// [DEV] snapshots mutate in the background. Preserve id/url memory semantics on edits.
function createModsUiHostRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const documentRef = deps.documentRef || document;
  const windowRef = deps.windowRef || documentRef.defaultView || (typeof window === "object" ? window : null);
  const localStorageRef = deps.localStorageRef || localStorage;
  const withBase = typeof deps.withBase === "function" ? deps.withBase : (value => String(value || ""));
  const modsEndpointsAdapter = deps.modsEndpointsAdapter && typeof deps.modsEndpointsAdapter === "object"
    ? deps.modsEndpointsAdapter
    : {};
  const MOD_UI_SELECTED_KEY = String(deps.MOD_UI_SELECTED_KEY || "ravelink_mod_ui_selected_v1");

function normalizeModUiId(value) {
  return String(value || "").trim();
}

function normalizeModUiCatalogEntries(entries = []) {
  const seen = new Set();
  const out = [];
  for (const item of (Array.isArray(entries) ? entries : [])) {
    const id = normalizeModUiId(item?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const title = String(item?.title || item?.name || id).trim() || id;
    const loaded = Boolean(item?.loaded);
    const enabled = Boolean(item?.enabled);
    const entry = String(item?.entry || "").trim();
    const url = loaded ? (String(item?.url || `/mods-ui/${encodeURIComponent(id)}/`).trim()) : "";

    out.push({
      id,
      name: String(item?.name || id).trim() || id,
      version: String(item?.version || "").trim(),
      title,
      entry,
      enabled,
      loaded,
      url
    });
  }
  return out;
}

function formatModUiTabLabel(item = {}) {
  const raw = String(item?.title || item?.name || item?.id || "MOD UI").trim();
  if (raw.length <= 20) return raw.toUpperCase();
  return `${raw.slice(0, 17).trimEnd()}...`.toUpperCase();
}

function buildModUiTabName(modId = "") {
  const id = normalizeModUiId(modId).toLowerCase();
  if (!id) return "";
  return `mods-ui:${id}`;
}

function isModUiTabName(value = "") {
  const token = String(value || "").trim().toLowerCase();
  return token.startsWith("mods-ui:");
}

function getModUiIdFromTabName(value = "") {
  if (!isModUiTabName(value)) return "";
  return normalizeModUiId(String(value).slice("mods-ui:".length));
}

function syncModUiPanelViewMode(tabName = ui.activeTab) {
  const panel = el.modUiPanel;
  if (!panel) return;
  const hostOnly = isModUiTabName(tabName);
  panel.classList.toggle("modUiNativeTabMode", hostOnly);
  panel.dataset.modUiView = hostOnly ? "native" : "workbench";
  if (hostOnly) {
    const activeModId = getModUiIdFromTabName(tabName);
    if (activeModId) {
      panel.dataset.modUiTabId = activeModId;
    } else {
      delete panel.dataset.modUiTabId;
    }
  } else {
    delete panel.dataset.modUiTabId;
  }
}

function syncDynamicModUiTabButtons() {
  if (!el.tabsBar) return;
  const selectedId = normalizeModUiId(ui.modUiSelectedId);
  const activeTab = String(ui.activeTab || "").trim().toLowerCase();
  const selectedTab = buildModUiTabName(selectedId);
  const dynamicTabs = Array.from(el.tabsBar.querySelectorAll(".modUiDynamicTab"));
  dynamicTabs.forEach(btn => {
    const id = normalizeModUiId(btn.dataset.modUiTabId);
    const tabName = String(btn.dataset.tabBtn || buildModUiTabName(id)).trim().toLowerCase();
    const shouldBeActive = activeTab === tabName || (activeTab === "mods" && selectedTab && tabName === selectedTab);
    btn.classList.toggle("active", shouldBeActive);
  });
}

function rebuildDynamicModUiTabs() {
  if (!el.tabsBar) return;
  Array.from(el.tabsBar.querySelectorAll(".modUiDynamicTab")).forEach(node => node.remove());

  for (const item of ui.modUiCatalog) {
    const id = normalizeModUiId(item?.id);
    if (!id || !item.loaded) continue;
    const btn = documentRef.createElement("button");
    btn.type = "button";
    btn.className = "tabBtn modUiDynamicTab";
    btn.dataset.modUiTabId = id;
    btn.dataset.tabBtn = buildModUiTabName(id);
    btn.textContent = formatModUiTabLabel(item);
    const route = `/mods-ui/${encodeURIComponent(id)}/`;
    btn.title = `Open ${item.title || id} UI (${route})`;
    el.tabsBar.appendChild(btn);
  }

  syncDynamicModUiTabButtons();
}

function buildModUiCatalogFromModsSnapshot(snapshot) {
  const mods = Array.isArray(snapshot?.mods) ? snapshot.mods : [];
  return normalizeModUiCatalogEntries(mods
    .filter(mod => mod && mod.ui)
    .map(mod => ({
      id: mod.id,
      name: mod.name,
      version: mod.version,
      enabled: Boolean(mod.enabled),
      loaded: Boolean(mod.loaded),
      title: mod.ui?.title || mod.name || mod.id,
      entry: mod.ui?.entry || "",
      url: mod.loaded ? `/mods-ui/${encodeURIComponent(String(mod.id || "").trim())}/` : ""
    })));
}

function getSelectedModUiDescriptor() {
  const selectedId = normalizeModUiId(ui.modUiSelectedId);
  if (!selectedId) return null;
  return ui.modUiCatalog.find(item => item.id === selectedId) || null;
}

function syncModUiSelectionToHotswapTarget(options = {}) {
  if (!el.modEnableId) return;
  const explicitId = normalizeModUiId(options.modId);
  const selectedId = explicitId || normalizeModUiId(ui.modUiSelectedId);
  if (!selectedId) return;
  const current = String(el.modEnableId.value || "").trim();
  const force = options.force === true;
  if (!current || force) {
    el.modEnableId.value = selectedId;
  }
}

function buildModUiFrameUrl(descriptor, options = {}) {
  const baseUrl = String(descriptor?.url || "").trim();
  if (!baseUrl) return "";
  const descriptorId = normalizeModUiId(descriptor?.id);
  const forceReload = options.forceReload === true;
  if (!forceReload && ui.modUiLastUrl && ui.modUiLastId === descriptorId) {
    return ui.modUiLastUrl;
  }
  const ts = Date.now();
  const joiner = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${joiner}host=modui&ts=${ts}`;
}

function readCssCustomProperty(name = "") {
  const prop = String(name || "").trim();
  if (!prop) return "";
  const root = documentRef.documentElement;
  const style = root?.style;
  const inlineValue = typeof style?.getPropertyValue === "function"
    ? String(style.getPropertyValue(prop) || "").trim()
    : "";
  if (inlineValue) return inlineValue;
  if (windowRef && typeof windowRef.getComputedStyle === "function" && root) {
    try {
      return String(windowRef.getComputedStyle(root).getPropertyValue(prop) || "").trim();
    } catch {}
  }
  return "";
}

function buildModUiThemePayload(override = null) {
  const theme = override && typeof override === "object" ? override : {};
  const accent = String(theme.accent || ui.themeConfig?.accent || readCssCustomProperty("--accent") || "#8b001f").trim();
  return {
    type: "ravelink:theme",
    version: 1,
    source: "ravelink-bridge",
    theme: {
      name: String(theme.name || ui.themeName || "custom"),
      bg: String(theme.bg || ui.themeConfig?.bg || readCssCustomProperty("--bg") || "#050507").trim(),
      panel: String(theme.panel || ui.themeConfig?.panel || readCssCustomProperty("--panel") || "#0b0e18").trim(),
      panel2: String(theme.panel2 || ui.themeConfig?.panel2 || readCssCustomProperty("--panel2") || "#121a2f").trim(),
      accent,
      accentGlow: String(theme.accentGlow || readCssCustomProperty("--accentGlow") || `${accent}aa`).trim(),
      edge: String(theme.edge || ui.themeConfig?.edge || readCssCustomProperty("--edge") || "#233055").trim(),
      btnBg: String(theme.btnBg || ui.themeConfig?.btnBg || readCssCustomProperty("--btn-bg") || "#14182c").trim(),
      text: String(theme.text || ui.themeConfig?.text || readCssCustomProperty("--text") || "#eaeaea").trim(),
      ok: String(theme.ok || ui.themeConfig?.ok || readCssCustomProperty("--ok") || "#19ff6a").trim(),
      warn: String(theme.warn || ui.themeConfig?.warn || readCssCustomProperty("--warn") || "#ffb000").trim(),
      bad: String(theme.bad || ui.themeConfig?.bad || readCssCustomProperty("--bad") || "#ff4444").trim()
    }
  };
}

function syncModUiThemeToFrame(override = null) {
  const frameWindow = el.modUiFrame?.contentWindow;
  if (!frameWindow || typeof frameWindow.postMessage !== "function") return false;
  frameWindow.postMessage(buildModUiThemePayload(override), "*");
  return true;
}

function clampModUiFrameHeight(value) {
  const raw = Math.round(Number(value || 0));
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.max(420, Math.min(16000, raw));
}

function setModUiFrameHeight(value) {
  const height = clampModUiFrameHeight(value);
  if (!height || !el.modUiFrame?.style) return false;
  el.modUiFrame.style.height = `${height}px`;
  return true;
}

function dispatchModUiOnboardingSteps(data = {}) {
  if (!windowRef || typeof windowRef.dispatchEvent !== "function") return false;
  const modId = normalizeModUiId(data.modId || data.id || ui.modUiSelectedId || "mod");
  const steps = Array.isArray(data.steps) ? data.steps : [];
  const EventCtor = typeof windowRef.CustomEvent === "function"
    ? windowRef.CustomEvent
    : (typeof CustomEvent === "function" ? CustomEvent : null);
  if (!EventCtor) return false;
  windowRef.dispatchEvent(new EventCtor("ravelink:mod-onboarding-steps", {
    detail: { modId, steps }
  }));
  return true;
}

function bindModUiHostBridge() {
  if (ui.modUiHostBridgeBound === true) return;
  ui.modUiHostBridgeBound = true;
  if (el.modUiFrame && typeof el.modUiFrame.addEventListener === "function") {
    el.modUiFrame.addEventListener("load", () => {
      syncModUiThemeToFrame();
    });
  } else if (el.modUiFrame) {
    el.modUiFrame.onload = () => {
      syncModUiThemeToFrame();
    };
  }
  if (windowRef && typeof windowRef.addEventListener === "function") {
    windowRef.addEventListener("ravelink:themechange", event => {
      syncModUiThemeToFrame(event?.detail || null);
    });
    windowRef.addEventListener("message", event => {
      const data = event?.data && typeof event.data === "object" ? event.data : null;
      if (!data) return;
      const source = event?.source || null;
      if (el.modUiFrame?.contentWindow && source && source !== el.modUiFrame.contentWindow) return;
      if (data.type === "ravelink:mod-ui-size") {
        setModUiFrameHeight(data.height || data.scrollHeight || data.bodyHeight);
        return;
      }
      if (data.type === "ravelink:mod-onboarding-steps") {
        dispatchModUiOnboardingSteps(data);
      }
    });
  }
}

function renderModUiFrame(options = {}) {
  bindModUiHostBridge();
  syncModUiPanelViewMode();

  const frame = el.modUiFrame;
  const frameWrap = el.modUiFrameWrap;
  const empty = el.modUiEmpty;
  const status = el.modUiStatus;
  const hostOnly = isModUiTabName(ui.activeTab);

  const descriptor = getSelectedModUiDescriptor();
  if (!descriptor) {
    if (frame) frame.src = "about:blank";
    if (frameWrap) frameWrap.classList.add("hidden");
    if (empty) {
      empty.classList.remove("hidden");
      empty.textContent = "No mod UI packages discovered. Add a UI HTML file in a mod folder and reload mods.";
    }
    if (status) status.value = "No mod UI packages discovered.";
    if (el.modUiOpenBtn) el.modUiOpenBtn.disabled = true;
    if (el.modUiReloadBtn) el.modUiReloadBtn.disabled = true;
    ui.modUiLastId = "";
    ui.modUiLastUrl = "";
    syncDynamicModUiTabButtons();
    return;
  }

  if (!hostOnly) {
    if (frame) frame.src = "about:blank";
    if (frameWrap) frameWrap.classList.add("hidden");
    if (empty) empty.classList.add("hidden");
    if (status) status.value = `${descriptor.title} (${descriptor.id}) ready. Open its top tab or use OPEN IN NEW TAB.`;
    if (el.modUiOpenBtn) el.modUiOpenBtn.disabled = !descriptor.loaded || !descriptor.url;
    if (el.modUiReloadBtn) el.modUiReloadBtn.disabled = !descriptor.loaded || !descriptor.url;
    ui.modUiLastId = "";
    ui.modUiLastUrl = "";
    syncDynamicModUiTabButtons();
    return;
  }

  if (!descriptor.loaded || !descriptor.url) {
    syncModUiSelectionToHotswapTarget({ modId: descriptor.id });
    if (frame) frame.src = "about:blank";
    if (frameWrap) frameWrap.classList.add("hidden");
    if (empty) {
      empty.classList.remove("hidden");
      empty.textContent = `Selected mod UI (${descriptor.id}) is offline. Enable the mod and click APPLY HOTSWAP to mount its UI.`;
    }
    if (status) status.value = `${descriptor.id} UI is offline (mod not loaded).`;
    if (el.modUiOpenBtn) el.modUiOpenBtn.disabled = true;
    if (el.modUiReloadBtn) el.modUiReloadBtn.disabled = true;
    ui.modUiLastId = "";
    ui.modUiLastUrl = "";
    syncDynamicModUiTabButtons();
    return;
  }

  const nextUrl = buildModUiFrameUrl(descriptor, options);
  if (frame && nextUrl && (
    options.forceReload === true ||
    ui.modUiLastId !== normalizeModUiId(descriptor.id) ||
    ui.modUiLastUrl !== nextUrl
  )) {
    frame.src = withBase(nextUrl);
    ui.modUiLastId = normalizeModUiId(descriptor.id);
    ui.modUiLastUrl = nextUrl;
  }

  if (frameWrap) frameWrap.classList.remove("hidden");
  if (empty) empty.classList.add("hidden");
  if (status) status.value = `${descriptor.title} (${descriptor.id}) loaded`;
  if (el.modUiOpenBtn) el.modUiOpenBtn.disabled = false;
  if (el.modUiReloadBtn) el.modUiReloadBtn.disabled = false;
  syncModUiThemeToFrame();
  syncDynamicModUiTabButtons();
}

function applyModUiCatalog(catalog = [], options = {}) {
  ui.modUiCatalog = normalizeModUiCatalogEntries(catalog);

  const previousSelectedId = normalizeModUiId(
    options.selectedId !== undefined ? options.selectedId : ui.modUiSelectedId
  );
  const hasPrevious = previousSelectedId && ui.modUiCatalog.some(item => item.id === previousSelectedId);
  const firstLoaded = ui.modUiCatalog.find(item => item.loaded);
  const nextSelectedId = hasPrevious
    ? previousSelectedId
    : normalizeModUiId(firstLoaded?.id || ui.modUiCatalog[0]?.id || "");

  ui.modUiSelectedId = nextSelectedId;
  if (options.persist !== false) {
    if (nextSelectedId) localStorageRef.setItem(MOD_UI_SELECTED_KEY, nextSelectedId);
    else localStorageRef.removeItem(MOD_UI_SELECTED_KEY);
  }

  if (el.modUiSelect) {
    el.modUiSelect.replaceChildren();
    const placeholder = documentRef.createElement("option");
    placeholder.value = "";
    placeholder.textContent = ui.modUiCatalog.length
      ? "select mod UI"
      : "no mod UI packages discovered";
    el.modUiSelect.appendChild(placeholder);

    for (const item of ui.modUiCatalog) {
      const opt = documentRef.createElement("option");
      opt.value = item.id;
      const stateWord = item.loaded ? "LIVE" : "OFFLINE";
      const enabledWord = item.enabled ? "ENABLED" : "DISABLED";
      opt.textContent = `${item.title} (${item.id}) [${stateWord} | ${enabledWord}]`;
      el.modUiSelect.appendChild(opt);
    }
    el.modUiSelect.value = nextSelectedId || "";
  }

  syncModUiSelectionToHotswapTarget();
  rebuildDynamicModUiTabs();
  renderModUiFrame({ forceReload: options.forceReload === true });
}

function syncModUiCatalogFromModsSnapshot(snapshot, options = {}) {
  const catalog = buildModUiCatalogFromModsSnapshot(snapshot);
  applyModUiCatalog(catalog, options);
}

async function refreshModUiCatalog(options = {}) {
  const preferRemote = options.preferRemote !== false;
  if (preferRemote) {
    const remote = await modsEndpointsAdapter.getUiCatalog();
    if (remote?.ok && Array.isArray(remote.mods)) {
      applyModUiCatalog(remote.mods, options);
      return true;
    }
  }
  syncModUiCatalogFromModsSnapshot(ui.modsSnapshot || {}, options);
  return Array.isArray(ui.modUiCatalog);
}

  return {
    normalizeModUiId,
    normalizeModUiCatalogEntries,
    formatModUiTabLabel,
    buildModUiTabName,
    isModUiTabName,
    getModUiIdFromTabName,
    buildModUiThemePayload,
    syncModUiThemeToFrame,
    clampModUiFrameHeight,
    setModUiFrameHeight,
    dispatchModUiOnboardingSteps,
    syncModUiPanelViewMode,
    syncDynamicModUiTabButtons,
    rebuildDynamicModUiTabs,
    buildModUiCatalogFromModsSnapshot,
    getSelectedModUiDescriptor,
    syncModUiSelectionToHotswapTarget,
    buildModUiFrameUrl,
    renderModUiFrame,
    applyModUiCatalog,
    syncModUiCatalogFromModsSnapshot,
    refreshModUiCatalog
  };
}
