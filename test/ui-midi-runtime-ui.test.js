// [TITLE] Test Module: test/ui-midi-runtime-ui.test.js
// [TITLE] Purpose: verify the reimagined MIDI tab control-surface behavior

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadFactory(relativeFile, factoryName) {
  const filePath = path.resolve(__dirname, "..", relativeFile);
  const code = fs.readFileSync(filePath, "utf8");
  const context = {
    console,
    window: {},
    document: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }
  };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: filePath });
  return context[factoryName];
}

function createSelect(value = "") {
  const node = {
    value,
    children: [],
    _innerHTML: "",
    appendChild(child) {
      this.children.push(child);
      if (!this.value) this.value = child.value;
      return child;
    }
  };
  Object.defineProperty(node, "innerHTML", {
    get() {
      return this._innerHTML;
    },
    set(valueNext) {
      this._innerHTML = String(valueNext || "");
      this.children = [];
      this.value = "";
    }
  });
  return node;
}

function createInput(value = "") {
  return { value: String(value || "") };
}

function createText() {
  return { textContent: "" };
}

function createButton(action = "") {
  return {
    onclick: null,
    getAttribute(name) {
      return name === "data-midi-learn-action" ? action : "";
    }
  };
}

function createRuntime({ quickButtons = [], adapterPatch = {} } = {}) {
  const createMidiRuntimeUi = loadFactory(
    "public/assets/js/domains/midi/midi-runtime-ui.js",
    "createMidiRuntimeUi"
  );
  const badgeCalls = [];
  const adapter = {
    getStatus: async () => ({ ok: true }),
    refreshStatus: async () => ({ ok: true, data: { ok: true } }),
    saveConfig: async () => ({ ok: true, data: { ok: true } }),
    armLearn: async action => ({ ok: true, data: buildSnapshot({ learnTarget: action }) }),
    cancelLearn: async () => ({ ok: true, data: buildSnapshot() }),
    triggerAction: async () => ({ ok: true, data: buildSnapshot() }),
    saveBinding: async () => ({ ok: true, data: buildSnapshot() }),
    clearBinding: async () => ({ ok: true, data: buildSnapshot() }),
    resetBindings: async () => ({ ok: true, data: buildSnapshot() }),
    ...adapterPatch
  };
  const el = {
    health: createText(),
    midiConnectionSummary: createText(),
    midiActivePortSummary: createText(),
    midiPortCount: createText(),
    midiConfiguredBindings: createText(),
    midiModuleStatus: createInput(),
    midiRuntimeStatus: createInput(),
    midiActivePort: createInput(),
    midiLearnStatus: createInput(),
    midiLastEvent: createInput(),
    midiLastAction: createInput(),
    midiEnabled: createSelect("true"),
    midiVelocityThreshold: createInput("1"),
    midiPortSelect: createSelect(""),
    midiDeviceMatch: createInput(),
    midiActionGroup: createSelect("core"),
    midiLearnAction: createSelect(),
    midiSelectedActionSummary: createInput(),
    midiBindingAction: createSelect(),
    midiBindingType: createSelect("note"),
    midiBindingNumber: createInput("36"),
    midiBindingChannel: createInput(),
    midiBindingMinValue: createInput("1")
  };
  const runtime = createMidiRuntimeUi({
    el,
    ui: {},
    documentRef: {
      createElement: tag => ({ tagName: String(tag || "").toUpperCase(), value: "", textContent: "" }),
      querySelectorAll: selector => selector === "[data-midi-learn-action]" ? quickButtons : []
    },
    localStorageRef: { getItem: () => null, setItem() {}, removeItem() {} },
    midiEndpointsAdapter: adapter,
    setBadge: (_node, state, text) => badgeCalls.push({ state, text })
  });
  return { runtime, el, badgeCalls };
}

function buildSnapshot({ learnTarget = "" } = {}) {
  return {
    ok: true,
    moduleAvailable: true,
    connected: true,
    activePortIndex: 0,
    activePortName: "Launchpad Mini",
    ports: [{ index: 0, name: "Launchpad Mini" }],
    portCount: 1,
    config: {
      enabled: true,
      velocityThreshold: 1,
      deviceIndex: 0,
      deviceMatch: "",
      bindings: {
        drop: { type: "note", number: 36, channel: 0, minValue: 1 },
        palette_family_red: { type: "cc", number: 12, channel: null, minValue: 64 }
      }
    },
    actions: ["drop", "scene_auto", "scene_impact", "overclock_auto_toggle", "palette_ordered", "palette_family_red"],
    learn: learnTarget ? { target: learnTarget, expiresAt: Date.now() + 30_000 } : { target: null },
    lastMessage: { type: "note", channel: 0, number: 36, value: 127, at: Date.now() },
    lastAction: "drop"
  };
}

test("midi runtime presents connection summaries and action-group filtered choices", () => {
  const { runtime, el } = createRuntime();
  runtime.wireMidiControlsUi();
  runtime.applyMidiSnapshot(buildSnapshot());

  assert.equal(el.midiConnectionSummary.textContent, "LISTENING");
  assert.equal(el.midiActivePortSummary.textContent, "Launchpad Mini");
  assert.equal(el.midiPortCount.textContent, "1");
  assert.equal(el.midiConfiguredBindings.textContent, "2");
  assert.deepEqual(el.midiLearnAction.children.map(row => row.value), [
    "drop",
    "scene_auto",
    "scene_impact",
    "overclock_auto_toggle",
    "palette_ordered"
  ]);
  assert.match(el.midiSelectedActionSummary.value, /DROP HIT/);

  el.midiActionGroup.value = "palette";
  el.midiActionGroup.onchange();
  assert.deepEqual(el.midiLearnAction.children.map(row => row.value), [
    "palette_ordered",
    "palette_family_red"
  ]);
});

test("midi quick-learn shortcut arms the selected action", async () => {
  const quickButton = createButton("scene_impact");
  const armCalls = [];
  const { runtime, el, badgeCalls } = createRuntime({
    quickButtons: [quickButton],
    adapterPatch: {
      armLearn: async action => {
        armCalls.push(action);
        return { ok: true, data: buildSnapshot({ learnTarget: action }) };
      }
    }
  });
  runtime.wireMidiControlsUi();
  runtime.applyMidiSnapshot(buildSnapshot());

  await quickButton.onclick();
  assert.deepEqual(armCalls, ["scene_impact"]);
  assert.equal(el.midiLearnAction.value, "scene_impact");
  assert.match(el.midiLearnStatus.value, /SCENE IMPACT/);
  assert.equal(badgeCalls.at(-1).text, "MIDI LEARN SCENE IMPACT");
});
