// [TITLE] Test Module: test/audio-capture.command-builders.test.js
// [TITLE] Purpose: cover audio capture command builders without spawning external tools

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildDesktopLoopbackCommand,
  buildFfmpegCaptureCommand,
  buildProcessLoopbackBackendOrder,
  buildProcessLoopbackCommand
} = require("../src/domains/audio/audio-capture.command-builders");

test("audio capture command builders create deterministic FFmpeg capture args", () => {
  const command = buildFfmpegCaptureCommand({
    ffmpegPath: "ffmpeg-custom",
    ffmpegInputFormat: "dshow",
    channels: 6,
    sampleRate: 96000
  }, {
    source: "Stereo Mix",
    reason: "configured"
  });

  assert.equal(command.ok, true);
  assert.equal(command.command, "ffmpeg-custom");
  assert.equal(command.inputFormat, "dshow");
  assert.deepEqual(command.args, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "dshow",
    "-i",
    "audio=Stereo Mix",
    "-ac",
    "6",
    "-ar",
    "96000",
    "-f",
    "f32le",
    "pipe:1"
  ]);
});

test("audio capture command builders report empty FFmpeg sources without launcher side effects", () => {
  const command = buildFfmpegCaptureCommand({}, { source: "", reason: "empty" });

  assert.deepEqual(command, {
    ok: false,
    source: "",
    inputFormat: "dshow",
    reason: "empty",
    error: "empty_capture_source"
  });
});

test("audio capture command builders build reachable desktop loopback args", () => {
  const command = buildDesktopLoopbackCommand({
    desktopLoopbackPath: "kernel.exe",
    desktopLoopbackDeviceName: "Speakers",
    rustLoopbackFormat: "s16le"
  }, {
    commandReachable: value => value === "kernel.exe"
  });

  assert.equal(command.ok, true);
  assert.equal(command.command, "kernel.exe");
  assert.equal(command.source, "Speakers");
  assert.deepEqual(command.args, [
    "--desktop-default",
    "--stdout",
    "--format",
    "s16le",
    "--channels",
    "2",
    "--sample-rate",
    "48000",
    "--desktop-device-name",
    "Speakers"
  ]);
});

test("audio capture command builders preserve process-loopback backend ordering", () => {
  assert.deepEqual(buildProcessLoopbackBackendOrder("rustloop"), ["rustloop", "rustkernel", "proctap"]);
  assert.deepEqual(buildProcessLoopbackBackendOrder("proctap"), ["proctap"]);
  assert.deepEqual(buildProcessLoopbackBackendOrder("", { allowProcTapFallback: false }), ["rustkernel", "rustloop"]);
});

test("audio capture command builders prefer PID selectors for resolved process targets", () => {
  const command = buildProcessLoopbackCommand({
    rustKernelPath: "kernel.exe",
    rustLoopbackPath: "loop.exe",
    rustLoopbackFormat: "f32le"
  }, {
    targetToken: "Firefox Nightly.exe",
    targetPid: 4242,
    preferredBackend: "rustloop"
  }, {
    commandReachable: value => value === "loop.exe",
    procTapRuntime: { available: false, error: "not_used", pythonArgs: [] }
  });

  assert.equal(command.ok, true);
  assert.equal(command.command, "loop.exe");
  assert.equal(command.inputFormat, "rustloop");
  assert.equal(command.source, "process:firefox nightly");
  assert.equal(command.args.includes("--pid"), true);
  assert.equal(command.args.includes("4242"), true);
  assert.equal(command.args.includes("--name"), false);
});

test("audio capture command builders build procTap command with selected python args", () => {
  const command = buildProcessLoopbackCommand({
    procTapLauncher: "py"
  }, {
    targetToken: "spotify.exe",
    preferredBackend: "proctap"
  }, {
    commandReachable: () => false,
    procTapRuntime: { available: true, error: "", pythonArgs: ["-3.13"] }
  });

  assert.equal(command.ok, true);
  assert.equal(command.command, "py");
  assert.deepEqual(command.args.slice(0, 5), ["-3.13", "-m", "proctap", "--name", "spotify"]);
  assert.equal(command.args.includes("--resample-quality"), true);
});
