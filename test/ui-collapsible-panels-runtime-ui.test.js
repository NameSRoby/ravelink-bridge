const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const COLLAPSIBLE_PATH = path.resolve(__dirname, "..", "public/assets/js/domains/ui-collapsible-panels-runtime-ui.js");
const COLLAPSIBLE_CODE = fs.readFileSync(COLLAPSIBLE_PATH, "utf8");

function createClassList(initial = []) {
  const tokens = new Set(initial.map(token => String(token)));
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

function createButton(section) {
  const listeners = new Map();
  return {
    dataset: {},
    textContent: "",
    attributes: {},
    addEventListener(type, handler) {
      listeners.set(String(type), handler);
    },
    setAttribute(name, value) {
      this.attributes[String(name)] = String(value);
    },
    closest(selector) {
      return selector === ".collapsible" ? section : null;
    },
    click() {
      const handler = listeners.get("click");
      if (typeof handler === "function") handler();
    }
  };
}

function createPanel(options = {}) {
  const panel = {
    id: String(options.id || ""),
    dataset: { ...(options.dataset || {}) },
    classList: createClassList(options.initialClasses || []),
    querySelector(selector) {
      return selector === "[data-collapse-btn]" ? this.button : null;
    }
  };
  panel.button = createButton(panel);
  return panel;
}

function createStorage(seed = {}) {
  const map = new Map(Object.entries(seed || {}).map(([key, value]) => [String(key), String(value)]));
  return {
    getItem(key) {
      return map.has(String(key)) ? map.get(String(key)) : null;
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
    removeItem(key) {
      map.delete(String(key));
    }
  };
}

function loadCollapsibleRuntime({ panels = [], buttons = [], storageSeed = {}, matchMobile = false } = {}) {
  const storage = createStorage(storageSeed);
  const context = {
    console: {
      debug() {}
    },
    window: {
      matchMedia() {
        return { matches: matchMobile };
      }
    },
    document: {
      querySelectorAll(selector) {
        if (selector === ".collapsible") return panels;
        if (selector === ".collapsible [data-collapse-btn]") return buttons;
        return [];
      }
    },
    localStorage: storage,
    CustomEvent: function CustomEvent(type, init) {
      this.type = type;
      this.detail = init?.detail || null;
    }
  };
  vm.createContext(context);
  vm.runInContext(
    `${COLLAPSIBLE_CODE}\nthis.__collapsibleExports = { initCollapsiblePanels, setCollapsibleState };`,
    context,
    { filename: COLLAPSIBLE_PATH }
  );
  return { context, storage, exports: context.__collapsibleExports };
}

test("collapsible runtime restores persisted state and persists toggle updates", () => {
  const panel = createPanel({ id: "audio" });
  const { exports, storage } = loadCollapsibleRuntime({
    panels: [panel],
    storageSeed: {
      ravelink_ui_collapsed_audio: "1"
    }
  });

  exports.initCollapsiblePanels();
  assert.equal(panel.classList.contains("collapsed"), true);
  assert.equal(panel.button.attributes["aria-expanded"], "false");
  assert.equal(panel.button.attributes["aria-label"], "Expand section");
  assert.equal(panel.button.dataset.collapseState, "collapsed");
  assert.equal(panel.button.textContent, "Expand section");

  panel.button.click();
  assert.equal(panel.classList.contains("collapsed"), false);
  assert.equal(panel.button.attributes["aria-expanded"], "true");
  assert.equal(panel.button.attributes["aria-label"], "Collapse section");
  assert.equal(panel.button.dataset.collapseState, "expanded");
  assert.equal(storage.getItem("ravelink_ui_collapsed_audio"), "0");
  assert.equal(panel.dataset.collapsibleBound, "1");
});

test("collapsible runtime no longer exports a startup fallback shim", () => {
  const panel = createPanel({ id: "live" });
  const { context, exports } = loadCollapsibleRuntime({
    buttons: [panel.button]
  });

  assert.equal(typeof exports.initCollapsiblePanels, "function");
  assert.equal(typeof exports.setCollapsibleState, "function");
  assert.equal(typeof context.runUiStartupFallbackPass, "undefined");
  assert.equal(typeof context.ensureFallbackCollapsibleBinding, "undefined");
});
