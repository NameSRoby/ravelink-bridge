// [TITLE] Module: public/assets/js/domains/ui-navigation.js
// [TITLE] Purpose: primary tab navigation ownership and tab-bar click routing
// [TITLE] Functionality Index:
// [TITLE] - tab activation/render state owner (`showTab`)
// [TITLE] - tab+section navigation helper (`activateTabAndScroll`)
// [TITLE] - tabs bar click wiring (core + dynamic mod tabs) and jump-link handlers
// [DEV] Complex Flow:
// [DEV] Tab selection fans into other domain owners (fixtures/mods/telemetry).
// [DEV] Keep this module as the single owner of tab button click wiring so
// [DEV] dynamic tab behavior stays deterministic across domain extraction slices.

let tabsBarLayoutSyncQueued = false;

function syncTabsBarLayout() {
  if (!el.tabsBar) return false;
  const visibleItems = Array.from(el.tabsBar.children).filter(node =>
    node instanceof Element && !node.classList.contains("hidden")
  );
  const hasVisibleItems = visibleItems.length > 0;
  const fitsViewport = hasVisibleItems && el.tabsBar.scrollWidth <= (el.tabsBar.clientWidth + 6);
  el.tabsBar.classList.toggle("tabsBalanced", fitsViewport);
  el.tabsBar.classList.toggle("tabsOverflowing", hasVisibleItems && !fitsViewport);
  return fitsViewport;
}

function scheduleTabsBarLayoutSync() {
  if (!el.tabsBar || tabsBarLayoutSyncQueued) return;
  tabsBarLayoutSyncQueued = true;
  const windowRef = typeof window === "object" ? window : null;
  const scheduler = typeof windowRef?.requestAnimationFrame === "function"
    ? windowRef.requestAnimationFrame.bind(windowRef)
    : (callback => setTimeout(callback, 0));
  scheduler(() => {
    tabsBarLayoutSyncQueued = false;
    syncTabsBarLayout();
  });
}

function showTab(name) {
  const requested = String(name || "").trim().toLowerCase();
  const activeTabButtons = Array.from(document.querySelectorAll("[data-tab-btn]"));
  const activeTabPages = Array.from(document.querySelectorAll("[data-tab]"));
  const requestedPage = (typeof isModUiTabName === "function" && isModUiTabName(requested))
    ? "mods"
    : requested;
  const canUseRequested = activeTabButtons.some(btn =>
    btn.dataset.tabBtn === requested && !btn.classList.contains("hidden")
  ) && activeTabPages.some(page =>
    page.dataset.tab === requestedPage && !page.classList.contains("hidden")
  );
  const fallback = activeTabButtons.find(btn => !btn.classList.contains("hidden"))?.dataset?.tabBtn || "live";
  const nextTab = canUseRequested ? requested : fallback;
  const nextTabPage = (typeof isModUiTabName === "function" && isModUiTabName(nextTab))
    ? "mods"
    : nextTab;

  if (typeof isModUiTabName === "function" && isModUiTabName(nextTab) && typeof getModUiIdFromTabName === "function") {
    const selectedModId = getModUiIdFromTabName(nextTab);
    if (selectedModId) {
      ui.modUiSelectedId = selectedModId;
      if (el.modUiSelect) el.modUiSelect.value = selectedModId;
      if (typeof syncModUiSelectionToHotswapTarget === "function") {
        syncModUiSelectionToHotswapTarget({ modId: selectedModId, force: true });
      }
      localStorage.setItem(MOD_UI_SELECTED_KEY, selectedModId);
    }
  }

  ui.activeTab = nextTab;
  if (typeof syncModUiPanelViewMode === "function") {
    syncModUiPanelViewMode(nextTab);
  }
  activeTabButtons.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tabBtn === nextTab);
  });
  activeTabPages.forEach(page => {
    page.classList.toggle("active", page.dataset.tab === nextTabPage);
  });

  if (nextTabPage === "custom") {
    applyCustomFixtureSelectionFromTab({ notify: false });
  }
  if (nextTabPage === "mods") {
    renderModUiFrame({ forceReload: false });
    if (typeof loadMods === "function") {
      loadMods().catch(err => {
        console.debug("[MODS][DEBUG] tab load failed:", err?.message || err);
      });
    }
    if (typeof refreshModUiCatalog === "function") {
      refreshModUiCatalog({ preferRemote: true, forceReload: false, persist: true }).catch(err => {
        console.debug("[MODS][DEBUG] tab catalog refresh failed:", err?.message || err);
      });
    }
  }

  updateMonitorRenderingState();
  syncDynamicModUiTabButtons();
  scheduleTabsBarLayoutSync();
}

function activateTabAndScroll(tabName, sectionId) {
  showTab(tabName);
  const section = document.getElementById(sectionId);
  if (!section) return;
  if (section.classList.contains("collapsible")) {
    setCollapsibleState(section, false);
  }
  section.scrollIntoView({ behavior: "smooth", block: "start" });
}


if (el.tabsBar) {
  el.tabsBar.onclick = event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const tabBtn = target.closest("[data-tab-btn]");
    if (tabBtn && el.tabsBar.contains(tabBtn)) {
      showTab(tabBtn.dataset.tabBtn);
    }
  };

  if (typeof MutationObserver === "function") {
    const tabsBarObserver = new MutationObserver(() => {
      scheduleTabsBarLayoutSync();
    });
    tabsBarObserver.observe(el.tabsBar, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"]
    });
  }

  if (typeof ResizeObserver === "function") {
    const tabsBarResizeObserver = new ResizeObserver(() => {
      scheduleTabsBarLayoutSync();
    });
    tabsBarResizeObserver.observe(el.tabsBar);
  } else if (typeof window === "object" && typeof window.addEventListener === "function") {
    window.addEventListener("resize", scheduleTabsBarLayoutSync);
  }

  scheduleTabsBarLayoutSync();
}


if (el.jumpRoutingLink) {
  el.jumpRoutingLink.onclick = event => {
    event.preventDefault();
    activateTabAndScroll("fixtures", "deviceRouting");
  };
}

if (el.jumpModsLink) {
  el.jumpModsLink.onclick = event => {
    event.preventDefault();
    activateTabAndScroll("mods", "modCenter");
  };
}

