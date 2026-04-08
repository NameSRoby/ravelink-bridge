// [TITLE] Module: public/assets/js/domains/ui-collapsible-panels-runtime-ui.js
// [TITLE] Purpose: collapsible panel state ownership and navigation helpers
// [TITLE] Functionality Index:
// [TITLE] - initialize persisted collapsible panel state
// [TITLE] - toggle/open specific collapsible sections
// [DEV] Complex Flow:
// [DEV] Collapsible state is shared by bootstrap initialization and navigation jumps,
// [DEV] so it lives in its own UI runtime instead of being stranded inside app.js.

const COLLAPSE_KEY_PREFIX = "ravelink_ui_collapsed_";
const COLLAPSE_LABEL_COLLAPSED = "Expand section";
const COLLAPSE_LABEL_EXPANDED = "Collapse section";

function applyCollapseButtonState(btn, collapsed) {
  if (!btn) return;
  const isCollapsed = collapsed === true;
  const label = isCollapsed ? COLLAPSE_LABEL_COLLAPSED : COLLAPSE_LABEL_EXPANDED;
  btn.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
  btn.setAttribute("aria-label", label);
  btn.dataset.collapseState = isCollapsed ? "collapsed" : "expanded";
  btn.textContent = label;
}

function initCollapsiblePanels() {
  const isMobileViewport = () => {
    try {
      return window.matchMedia && window.matchMedia("(max-width: 900px)").matches;
    } catch {
      return false;
    }
  };
  const parseCollapsedDefault = node => {
    if (!node || !node.dataset) return false;
    const mobileDefault = String(node.dataset.collapsedDefaultMobile || "").trim().toLowerCase();
    const desktopDefault = String(node.dataset.collapsedDefault || "").trim().toLowerCase();
    const token = isMobileViewport() && mobileDefault ? mobileDefault : desktopDefault;
    return token === "1" || token === "true" || token === "yes";
  };
  const resolvePanelKey = (node, index) => {
    const explicit = String(node?.dataset?.collapsibleKey || "").trim();
    if (explicit) return explicit;
    const id = String(node?.id || "").trim();
    if (id) return id;
    return `panel_${Math.max(0, Number(index || 0))}`;
  };
  const applyState = (node, btn, collapsed) => {
    if (!node) return;
    node.classList.toggle("collapsed", collapsed === true);
    applyCollapseButtonState(btn, collapsed);
  };

  const panels = Array.from(document.querySelectorAll(".collapsible"));
  panels.forEach((node, index) => {
    if (!node || node.dataset.collapsibleBound === "1") return;
    const btn = node.querySelector("[data-collapse-btn]");
    if (!btn) return;
    const key = resolvePanelKey(node, index);
    const storageKey = `${COLLAPSE_KEY_PREFIX}${key}`;
    let collapsed = parseCollapsedDefault(node);
    try {
      const stored = String(localStorage.getItem(storageKey) || "").trim();
      if (stored === "1" || stored === "0") {
        collapsed = stored === "1";
      }
    } catch {
      // ignore storage read failures
    }
    applyState(node, btn, collapsed);
    btn.addEventListener("click", () => {
      const nextCollapsed = !node.classList.contains("collapsed");
      applyState(node, btn, nextCollapsed);
      try {
        localStorage.setItem(storageKey, nextCollapsed ? "1" : "0");
      } catch {
        // ignore storage write failures
      }
    });
    node.dataset.collapsibleBound = "1";
  });
}

function setCollapsibleState(node, collapsed, options = {}) {
  if (!node) return;
  const btn = node.querySelector("[data-collapse-btn]");
  const nextCollapsed = collapsed === undefined
    ? !node.classList.contains("collapsed")
    : collapsed === true;
  node.classList.toggle("collapsed", nextCollapsed);
  applyCollapseButtonState(btn, nextCollapsed);
  if (options.persist !== false) {
    const panelKey = String(node?.dataset?.collapsibleKey || node?.id || "").trim();
    if (!panelKey) return;
    try {
      localStorage.setItem(`${COLLAPSE_KEY_PREFIX}${panelKey}`, nextCollapsed ? "1" : "0");
    } catch {
      // ignore storage write failures
    }
  }
}
