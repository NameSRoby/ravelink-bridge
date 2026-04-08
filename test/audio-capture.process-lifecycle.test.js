// [TITLE] Test Module: test/audio-capture.process-lifecycle.test.js
// [TITLE] Purpose: cover child-process startup and exit lifecycle for audio capture launchers

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const {
  spawnPcmCaptureProcess
} = require("../src/domains/audio/audio-capture.process-lifecycle");

function createFakeProcess(pid = 101) {
  const proc = new EventEmitter();
  proc.pid = pid;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.killCalls = [];
  proc.kill = signal => {
    proc.killCalls.push(signal);
  };
  return proc;
}

test("audio capture process lifecycle resolves after first PCM chunk and forwards telemetry chunks", async () => {
  const proc = createFakeProcess(123);
  const seenChunks = [];
  const started = [];
  const resultPromise = spawnPcmCaptureProcess({
    command: "ffmpeg",
    args: ["-i", "audio=Stereo Mix"],
    sourceName: "Stereo Mix",
    inputFormat: "dshow",
    reason: "configured",
    startedReason: "capture_started",
    awaitingDataReason: "capture_awaiting_data",
    config: { restartMs: 500, captureStartupGraceMs: 500 },
    spawn: () => proc,
    onStarted: event => started.push(event),
    onPcmChunk: data => seenChunks.push(data)
  });

  proc.stdout.emit("data", Buffer.from([1, 2, 3, 4]));
  const result = await resultPromise;

  assert.equal(result.ok, true);
  assert.equal(result.started, true);
  assert.equal(result.startedByData, true);
  assert.equal(result.pid, 123);
  assert.equal(started.length, 1);
  assert.equal(started[0].reason, "capture_started");
  assert.equal(seenChunks.length, 1);
  assert.deepEqual([...seenChunks[0]], [1, 2, 3, 4]);
});

test("audio capture process lifecycle reports startup exits and keeps bounded stderr", async () => {
  const proc = createFakeProcess(456);
  const resultPromise = spawnPcmCaptureProcess({
    command: "ffmpeg",
    args: [],
    sourceName: "Broken",
    inputFormat: "dshow",
    reason: "configured",
    config: { restartMs: 500, captureStartupGraceMs: 500 },
    spawn: () => proc
  });

  proc.stderr.emit("data", "x".repeat(2100));
  proc.emit("exit", 1, null);
  const result = await resultPromise;

  assert.equal(result.ok, false);
  assert.equal(result.error, "capture_exit_1_none");
  assert.equal(result.stderr.length, 320);
  assert.equal(proc.killCalls.includes("SIGTERM"), true);
});

test("audio capture process lifecycle notifies runtime when an active process exits", async () => {
  const proc = createFakeProcess(789);
  const exits = [];
  const resultPromise = spawnPcmCaptureProcess({
    command: "loopback",
    args: [],
    sourceName: "desktop:default",
    inputFormat: "rustkernel",
    reason: "desktop_loopback",
    startedReason: "desktop_loopback_started",
    config: { restartMs: 500, captureStartupGraceMs: 500 },
    spawn: () => proc,
    onStarted: () => {},
    onExitAfterStart: event => exits.push(event)
  });

  proc.stdout.emit("data", Buffer.from([1, 2, 3, 4]));
  await resultPromise;
  proc.emit("exit", 0, "SIGTERM");

  assert.equal(exits.length, 1);
  assert.equal(exits[0].error, "capture_exit_0_SIGTERM");
  assert.equal(exits[0].proc, proc);
});
