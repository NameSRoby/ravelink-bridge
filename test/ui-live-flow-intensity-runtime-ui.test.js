// [TITLE] Test Module: test/ui-live-flow-intensity-runtime-ui.test.js
// [TITLE] Purpose: guard LIVE flow-intensity runtime split from legacy reactor.js

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadRuntimeFactory() {
  const filePath = path.resolve(__dirname, "..", "public", "assets", "js", "domains", "live", "live-flow-intensity-runtime-ui.js");
  const context = { console };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(filePath, "utf8"), context, { filename: filePath });
  return context.createLiveFlowIntensityRuntimeUi;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("LIVE flow-intensity runtime wires slider commits and reset actions", () => {
  const createLiveFlowIntensityRuntimeUi = loadRuntimeFactory();
  const ui = {};
  const el = {
    flowIntensity: { value: "175", oninput: null, onchange: null, ondblclick: null },
    flowResetBtn: { onclick: null }
  };
  const applyCalls = [];
  const commitCalls = [];
  const resetCalls = [];
  const clearedTimers = [];
  let scheduledCallback = null;
  let timer = null;

  const runtime = createLiveFlowIntensityRuntimeUi({
    el,
    ui,
    clampFlowIntensity: value => Math.max(0, Math.min(2, Number(value) || 1)),
    applyFlowIntensityUi: () => applyCalls.push(ui.flowIntensity),
    commitFlowIntensity: options => {
      commitCalls.push(options);
      return Promise.resolve(true);
    },
    resetFlowIntensity: options => {
      resetCalls.push(options);
      return Promise.resolve(true);
    },
    getFlowIntensityCommitTimer: () => timer,
    setFlowIntensityCommitTimer: value => {
      timer = value || null;
    },
    setTimeoutRef: callback => {
      scheduledCallback = callback;
      return "timer-1";
    },
    clearTimeoutRef: value => clearedTimers.push(value)
  });

  runtime.wireLiveFlowIntensityControlsUi();
  el.flowIntensity.oninput();

  assert.equal(ui.flowIntensity, 1.75);
  assert.equal(applyCalls.length, 1);
  assert.equal(timer, "timer-1");
  assert.equal(typeof scheduledCallback, "function");

  scheduledCallback();
  assert.deepEqual(plain(commitCalls), [{ silent: true }]);

  el.flowIntensity.onchange();
  assert.deepEqual(clearedTimers, ["timer-1"]);
  assert.equal(timer, null);
  assert.deepEqual(plain(commitCalls), [{ silent: true }, { silent: false }]);

  el.flowIntensity.ondblclick();
  el.flowResetBtn.onclick();
  assert.deepEqual(plain(resetCalls), [{ silent: false }, { silent: false }]);
});
