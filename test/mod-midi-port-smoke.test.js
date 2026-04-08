// [TITLE] Test Module: test/mod-midi-port-smoke.test.js
// [TITLE] Purpose: smoke contracts for mods and MIDI runtime ports before engine-v2 work

const test = require("node:test");
const assert = require("node:assert/strict");

const createNoopModRuntime = require("../src/domains/mods/mod-loader.port");
const createNoopMidiManager = require("../src/domains/midi/midi-manager.port");

test("mod runtime port keeps hook compatibility for migration consumers", async () => {
  const runtime = createNoopModRuntime();

  const load = await runtime.load();
  const reload = await runtime.reload();
  const list = runtime.list();
  assert.equal(load.ok, true);
  assert.equal(reload.ok, true);
  assert.equal(list.ok, true);

  const hooks = runtime.getSupportedHooks();
  assert.equal(Array.isArray(hooks), true);
  assert.equal(hooks.includes("onRaveStart"), true);
  assert.equal(hooks.includes("onRaveStop"), true);
  assert.equal(hooks.includes("onIntent"), true);
  assert.equal(hooks.includes("onTelemetry"), true);

  const invokeKnown = await runtime.invokeHook("onRaveStart", { source: "smoke" });
  assert.equal(invokeKnown.ok, true);
  assert.equal(invokeKnown.invoked, 0);

  const invokeUnknown = await runtime.invokeHook("onUnknown", {});
  assert.equal(invokeUnknown.ok, false);
});

test("midi manager port exposes deterministic unavailable status contract", () => {
  const midi = createNoopMidiManager();
  const status = midi.getStatus();

  assert.equal(status.ok, true);
  assert.equal(status.moduleAvailable, false);
  assert.equal(status.connected, false);
  assert.equal(Array.isArray(status.ports), true);
  assert.equal(typeof status.config, "object");
  assert.equal(typeof status.learn, "object");

  const saveBinding = midi.saveBinding("scene_auto", {
    type: "note",
    number: 36
  });
  assert.equal(saveBinding.ok, true);

  const trigger = midi.triggerAction("scene_auto");
  assert.equal(trigger.ok, true);

  const clearBinding = midi.clearBinding("scene_auto");
  assert.equal(clearBinding.ok, true);
});
