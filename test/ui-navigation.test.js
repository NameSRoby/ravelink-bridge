const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const NAV_PATH = path.resolve(__dirname, "..", "public/assets/js/domains/ui-navigation.js");
const NAV_CODE = fs.readFileSync(NAV_PATH, "utf8");

function createClassList(initial = []) {
  const tokens = new Set(initial.map(value => String(value)));
  return {
    add(...values) {
      values.forEach(value => tokens.add(String(value)));
    },
    remove(...values) {
      values.forEach(value => tokens.delete(String(value)));
    },
    toggle(value, force) {
      const key = String(value);
      if (force === true) {
        tokens.add(key);
        return true;
      }
      if (force === false) {
        tokens.delete(key);
        return false;
      }
      if (tokens.has(key)) {
        tokens.delete(key);
        return false;
      }
      tokens.add(key);
      return true;
    },
    contains(value) {
      return tokens.has(String(value));
    }
  };
}

class ElementMock {
  constructor(initialClasses = []) {
    this.classList = createClassList(initialClasses);
    this.children = [];
  }
}

function createTabsBar({ childClasses = [], clientWidth = 800, scrollWidth = 600 } = {}) {
  const bar = new ElementMock();
  bar.clientWidth = clientWidth;
  bar.scrollWidth = scrollWidth;
  bar.contains = node => bar.children.includes(node);
  bar.querySelectorAll = () => [];
  childClasses.forEach(classes => {
    bar.children.push(new ElementMock(classes));
  });
  return bar;
}

function loadNavigation({ tabsBar } = {}) {
  const windowRef = {
    addEventListener() {},
    requestAnimationFrame(callback) {
      callback();
      return 1;
    }
  };
  const context = {
    console: { debug() {} },
    Element: ElementMock,
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
      }
      observe() {}
    },
    ResizeObserver: class {
      constructor(callback) {
        this.callback = callback;
      }
      observe() {}
    },
    document: {
      querySelectorAll() {
        return [];
      },
      getElementById() {
        return null;
      }
    },
    window: windowRef,
    localStorage: {
      setItem() {}
    },
    el: {
      tabsBar,
      jumpRoutingLink: null,
      jumpModsLink: null,
      modUiSelect: null
    },
    ui: {},
    MOD_UI_SELECTED_KEY: "mod_ui_test",
    updateMonitorRenderingState() {},
    syncDynamicModUiTabButtons() {},
    renderModUiFrame() {},
    loadMods() {
      return Promise.resolve();
    },
    refreshModUiCatalog() {
      return Promise.resolve(true);
    },
    applyCustomFixtureSelectionFromTab() {},
    setCollapsibleState() {},
    setTimeout,
    clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(
    `${NAV_CODE}\nthis.__navigationExports = { syncTabsBarLayout, scheduleTabsBarLayoutSync };`,
    context,
    { filename: NAV_PATH }
  );
  return context.__navigationExports;
}

test("ui navigation balances the tab strip when visible tabs fit", () => {
  const tabsBar = createTabsBar({
    childClasses: [[], [], [], ["hidden"]],
    clientWidth: 900,
    scrollWidth: 620
  });
  const exports = loadNavigation({ tabsBar });

  const fits = exports.syncTabsBarLayout();
  assert.equal(fits, true);
  assert.equal(tabsBar.classList.contains("tabsBalanced"), true);
  assert.equal(tabsBar.classList.contains("tabsOverflowing"), false);
});

test("ui navigation keeps scroll-strip mode when tabs overflow", () => {
  const tabsBar = createTabsBar({
    childClasses: [[], [], [], [], []],
    clientWidth: 640,
    scrollWidth: 980
  });
  const exports = loadNavigation({ tabsBar });

  const fits = exports.syncTabsBarLayout();
  assert.equal(fits, false);
  assert.equal(tabsBar.classList.contains("tabsBalanced"), false);
  assert.equal(tabsBar.classList.contains("tabsOverflowing"), true);
});
