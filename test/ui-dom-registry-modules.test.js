const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadFactory(relativeFile, factoryName) {
  const filePath = path.resolve(__dirname, "..", relativeFile);
  const code = fs.readFileSync(filePath, "utf8");
  const context = { console };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: filePath });
  const factory = context[factoryName];
  assert.equal(typeof factory, "function", `missing runtime factory: ${factoryName}`);
  return factory;
}

test("core domain DOM registry resolves domain-heavy handles deterministically", () => {
  const createCoreDomainDomRegistry = loadFactory(
    "public/assets/js/core/dom-domain-registry.js",
    "createCoreDomainDomRegistry"
  );

  const requestedIds = [];
  const documentRef = {
    getElementById(id) {
      requestedIds.push(id);
      return { id };
    }
  };

  const registry = createCoreDomainDomRegistry(documentRef);
  assert.equal(registry.aInputBackend.id, "aInputBackend");
  assert.equal(registry.fxBrand.id, "fxBrand");
  assert.equal(registry.modUiFrame.id, "modUiFrame");
  assert.equal(registry.paletteBrandMenus.id, "paletteBrandMenus");
  assert.equal(requestedIds.includes("aInputBackend"), true);
  assert.equal(requestedIds.includes("paletteBrandMenus"), true);
});

test("core DOM query collections bind shared selector groups off document and el", () => {
  const createCoreDomQueryCollections = loadFactory(
    "public/assets/js/core/dom-query-collections.js",
    "createCoreDomQueryCollections"
  );

  const familyGrid = {
    querySelectorAll(selector) {
      if (selector === "[data-palette-family-tab]") {
        return [{ id: "family-red" }, { id: "family-blue" }];
      }
      if (selector === "[data-palette-family-count]") {
        return [{ id: "count-red" }];
      }
      return [];
    }
  };
  const documentRef = {
    querySelectorAll(selector) {
      if (selector === "[data-tab-btn]") return [{ id: "tab-live" }];
      if (selector === "[data-audio-quick]") return [{ id: "quick-safe" }, { id: "quick-fast" }];
      if (selector === "[data-limiter-preset]") return [{ id: "limit-balanced" }];
      if (selector === "[data-theme-preset]") return [{ id: "theme-sunrise" }];
      if (selector === "[data-theme-custom]") return [{ id: "theme-accent" }];
      if (selector === "[data-tour-tab]") return [{ id: "tour-live" }];
      return [];
    }
  };

  const collections = createCoreDomQueryCollections({
    documentRef,
    el: { paletteFamilyGrid: familyGrid }
  });

  assert.deepEqual(Array.from(collections.tabButtons, node => node.id), ["tab-live"]);
  assert.deepEqual(Array.from(collections.audioQuickPresetButtons, node => node.id), ["quick-safe", "quick-fast"]);
  assert.deepEqual(Array.from(collections.limiterPresetButtons, node => node.id), ["limit-balanced"]);
  assert.deepEqual(Array.from(collections.themePresetButtons, node => node.id), ["theme-sunrise"]);
  assert.deepEqual(Array.from(collections.themeCustomInputs, node => node.id), ["theme-accent"]);
  assert.deepEqual(Array.from(collections.tabTourButtons, node => node.id), ["tour-live"]);
  assert.deepEqual(Array.from(collections.getPaletteFamilyButtons(), node => node.id), ["family-red", "family-blue"]);
  assert.deepEqual(Array.from(collections.getPaletteFamilyCountSelectors(), node => node.id), ["count-red"]);
});
