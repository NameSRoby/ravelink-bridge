// [TITLE] Test Module: test/midi-manager.transport.test.js
// [TITLE] Purpose: verify MIDI manager uses transport scan/listen and real message binding flow

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const createMidiManager = require("../src/domains/midi/midi-manager.port");

function createTempMidiStorePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-midi-runtime-"));
  return {
    dir,
    file: path.join(dir, "midi.config.json")
  };
}

function createFakeMidiTransport() {
  let listening = false;
  let handler = null;
  const ports = [
    { index: 0, name: "Fake MIDI A" },
    { index: 1, name: "Fake MIDI B" }
  ];
  return {
    getCapabilities() {
      return {
        available: true,
        error: ""
      };
    },
    scanPorts() {
      return ports.map(row => ({ ...row }));
    },
    startListening(config = {}, onMessage = () => {}) {
      handler = onMessage;
      listening = true;
      const explicit = Number.isInteger(Number(config.deviceIndex)) ? Number(config.deviceIndex) : 0;
      const selected = ports.find(row => row.index === explicit) || ports[0];
      return {
        ok: true,
        connected: true,
        activePortIndex: selected.index,
        activePortName: selected.name
      };
    },
    stopListening() {
      listening = false;
      handler = null;
      return {
        ok: true,
        wasConnected: true
      };
    },
    isListening() {
      return listening;
    },
    emit(raw = []) {
      if (typeof handler !== "function") return false;
      handler({
        at: Date.now(),
        raw
      });
      return true;
    }
  };
}

test("midi manager learns from transport message stream and triggers bound action", () => {
  const temp = createTempMidiStorePath();
  const actionEvents = [];
  const fakeTransport = createFakeMidiTransport();

  const midi = createMidiManager({
    storePath: temp.file,
    transport: fakeTransport,
    actions: ["scene_auto"],
    onAction(event = {}) {
      actionEvents.push({ ...event });
    }
  });

  const initial = midi.getStatus();
  assert.equal(initial.ok, true);
  assert.equal(initial.moduleAvailable, true);
  assert.equal(initial.connected, true);
  assert.equal(initial.portCount, 2);

  const arm = midi.armLearn("scene_auto");
  assert.equal(arm.ok, true);
  assert.equal(arm.status?.learn?.target, "scene_auto");

  const emittedLearn = fakeTransport.emit([0x90, 60, 100]);
  assert.equal(emittedLearn, true);

  const afterLearn = midi.getStatus();
  assert.equal(afterLearn.learn?.target, null);
  assert.equal(afterLearn.config?.bindings?.scene_auto?.type, "note");
  assert.equal(afterLearn.config?.bindings?.scene_auto?.number, 60);

  fakeTransport.emit([0x90, 60, 120]);
  const afterTrigger = midi.getStatus();
  assert.equal(afterTrigger.lastAction, "scene_auto");
  assert.equal(actionEvents.length > 0, true);

  fs.rmSync(temp.dir, { recursive: true, force: true });
});
