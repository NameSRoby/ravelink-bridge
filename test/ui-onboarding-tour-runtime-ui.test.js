const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RUNTIME_PATH = path.resolve(__dirname, "..", "public/assets/js/domains/onboarding-tour-runtime-ui.js");
const RUNTIME_CODE = fs.readFileSync(RUNTIME_PATH, "utf8");

function createClassList(initial = []) {
  const tokens = new Set(initial);
  return {
    add(...values) {
      for (const value of values) tokens.add(String(value));
    },
    remove(...values) {
      for (const value of values) tokens.delete(String(value));
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

function createNode(id, rect = {}) {
  return {
    id,
    textContent: "",
    disabled: false,
    dataset: {},
    style: {},
    classList: createClassList(["hidden"]),
    attributes: {},
    setAttribute(name, value) {
      this.attributes[String(name)] = String(value);
    },
    addEventListener(type, handler) {
      this[`on${type}`] = handler;
    },
    scrollIntoView() {
      this.scrolled = true;
    },
    getBoundingClientRect() {
      return {
        left: rect.left || 40,
        top: rect.top || 80,
        right: rect.right || 240,
        bottom: rect.bottom || 140,
        width: rect.width || 200,
        height: rect.height || 60
      };
    }
  };
}

function loadRuntime() {
  const context = {
    console,
    document: {
      querySelector() {
        return null;
      }
    },
    window: {},
    localStorage: {}
  };
  vm.createContext(context);
  vm.runInContext(`${RUNTIME_CODE}\nthis.factory = createOnboardingTourRuntimeUi;`, context, { filename: RUNTIME_PATH });
  return context.factory;
}

test("onboarding tour filters by tab and accepts removable mod steps", () => {
  const createOnboardingTourRuntimeUi = loadRuntime();
  const runtime = createOnboardingTourRuntimeUi({
    el: {},
    ui: {},
    documentRef: { querySelector: () => null },
    windowRef: {},
    localStorageRef: {},
    showTab() {},
    setBadge() {}
  });

  assert.ok(runtime.buildSteps({ tab: "audio" }).every(step => step.tab === "audio"));
  assert.equal(runtime.registerOnboardingSteps("music-request-engine", [
    { title: "Requests", body: "Local broadcaster controls" }
  ]), 1);
  const modSteps = runtime.buildSteps({ tab: "mods" }).filter(step => step.source === "mod:music-request-engine");
  assert.equal(modSteps.length, 1);
  assert.equal(modSteps[0].target, "#modUiPanel");
});

test("onboarding tour uses alternate MIDI messaging when no device is available", () => {
  const createOnboardingTourRuntimeUi = loadRuntime();
  const runtime = createOnboardingTourRuntimeUi({
    el: {},
    ui: { midiDetected: false, midiTabForced: false },
    documentRef: { querySelector: () => null },
    windowRef: {},
    localStorageRef: {},
    showTab() {},
    setBadge() {}
  });

  const fullTourSteps = runtime.buildSteps({});
  const midiStep = fullTourSteps.find(step => /midi device connected/i.test(step.title));
  assert.ok(midiStep, "full tour should include a no-device MIDI onboarding step");
  assert.equal(midiStep.target, "#themeCogBtn");
  assert.match(midiStep.body, /MIDI TAB toggle/i);
});

test("onboarding tour uses the MIDI action-learning step when MIDI is visible", () => {
  const createOnboardingTourRuntimeUi = loadRuntime();
  const runtime = createOnboardingTourRuntimeUi({
    el: {},
    ui: { midiDetected: true, midiTabForced: false },
    documentRef: { querySelector: () => null },
    windowRef: {},
    localStorageRef: {},
    showTab() {},
    setBadge() {}
  });

  const midiSteps = runtime.buildSteps({ tab: "midi" });
  assert.equal(midiSteps.length, 1);
  assert.equal(midiSteps[0].target, "#midiLearnAction");
  assert.match(midiSteps[0].title, /MIDI turns controller gestures into LIVE actions/i);
});

test("onboarding tour starts, renders controls, and marks completion", () => {
  const createOnboardingTourRuntimeUi = loadRuntime();
  const layer = createNode("onboardingTourLayer");
  const highlight = createNode("onboardingTourHighlight");
  const card = createNode("onboardingTourCard");
  const target = createNode("aApplyBtn");
  const storage = new Map();
  const tabs = [];
  const badges = [];
  const runtime = createOnboardingTourRuntimeUi({
    el: {
      onboardingTourLayer: layer,
      onboardingTourHighlight: highlight,
      onboardingTourCard: card,
      onboardingTourKicker: createNode("onboardingTourKicker"),
      onboardingTourTitle: createNode("onboardingTourTitle"),
      onboardingTourBody: createNode("onboardingTourBody"),
      onboardingTourProgress: createNode("onboardingTourProgress"),
      onboardingTourPrevBtn: createNode("onboardingTourPrevBtn"),
      onboardingTourNextBtn: createNode("onboardingTourNextBtn"),
      onboardingTourSkipBtn: createNode("onboardingTourSkipBtn"),
      onboardingTourDoneBtn: createNode("onboardingTourDoneBtn"),
      onboardGate: createNode("onboardGate"),
      health: {}
    },
    ui: {},
    documentRef: {
      querySelector(selector) {
        return selector === "#aApplyBtn" || selector === '[data-tab="audio"]' ? target : null;
      }
    },
    windowRef: {
      innerWidth: 1024,
      innerHeight: 768,
      setTimeout(fn) {
        fn();
      },
      addEventListener() {}
    },
    localStorageRef: {
      setItem(key, value) {
        storage.set(String(key), String(value));
      },
      removeItem(key) {
        storage.delete(String(key));
      }
    },
    showTab(tab) {
      tabs.push(tab);
    },
    setBadge(_node, kind, text) {
      badges.push({ kind, text });
    }
  });

  assert.equal(runtime.startOnboardingTour({ tab: "audio" }), true);
  assert.equal(layer.classList.contains("hidden"), false);
  assert.equal(layer.attributes["aria-hidden"], "false");
  assert.equal(target.scrolled, true);
  assert.deepEqual(tabs, ["audio"]);
  assert.equal(badges[0].text, "AUDIO TOUR");

  runtime.completeOnboardingTour();
  assert.equal(layer.classList.contains("hidden"), true);
  assert.equal(storage.get("ravelink_onboard_ack_v1"), "1");
});
