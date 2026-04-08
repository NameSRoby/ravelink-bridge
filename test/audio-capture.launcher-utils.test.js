// [TITLE] Test Module: test/audio-capture.launcher-utils.test.js
// [TITLE] Purpose: cover audio capture launcher/source normalization helpers

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildInputSpecifier,
  buildSourceCandidates,
  normalizeAppToken,
  normalizeLoopbackFormat,
  resolveProcTapLauncherRuntime
} = require("../src/domains/audio/audio-capture.launcher-utils");

test("audio capture launcher utils normalize process tokens and loopback formats", () => {
  assert.equal(normalizeAppToken("Firefox Nightly.exe"), "firefox nightly");
  assert.equal(normalizeAppToken("Spotify (12).exe"), "spotify");
  assert.equal(normalizeLoopbackFormat("s16le"), "s16le");
  assert.equal(normalizeLoopbackFormat("weird"), "f32le");
});

test("audio capture launcher utils build deterministic FFmpeg source candidates", () => {
  const candidates = buildSourceCandidates({
    ffmpegAppIsolationEnabled: true,
    ffmpegAppIsolationPrimaryDevices: ["App Loopback", "app loopback"],
    ffmpegAppIsolationFallbackDevices: ["Fallback Loopback"],
    ffmpegInputDevices: ["Configured"],
    ffmpegInputDevice: "Configured",
    desktopOutputDeviceName: "Speakers",
    deviceMatch: "Realtek"
  });

  assert.deepEqual(candidates, [
    { source: "App Loopback", reason: "app_primary_device" },
    { source: "Fallback Loopback", reason: "app_fallback_device" },
    { source: "Configured", reason: "ffmpeg_input_devices" },
    { source: "Speakers", reason: "desktop_output_device_name" },
    { source: "Realtek", reason: "device_match_hint" }
  ]);
});

test("audio capture launcher utils provide safe default capture candidates", () => {
  assert.deepEqual(buildSourceCandidates({}), [
    { source: "virtual-audio-capturer", reason: "auto_virtual_audio_capturer" },
    { source: "default", reason: "auto_default_device" }
  ]);
});

test("audio capture launcher utils preserve dshow and wasapi input specifier rules", () => {
  assert.equal(buildInputSpecifier("dshow", "Stereo Mix"), "audio=Stereo Mix");
  assert.equal(buildInputSpecifier("dshow", "audio=Stereo Mix"), "audio=Stereo Mix");
  assert.equal(buildInputSpecifier("wasapi", "Speakers"), "Speakers");
  assert.equal(buildInputSpecifier("wasapi", ""), "");
});

test("audio capture launcher utils report unavailable procTap launcher deterministically", () => {
  const runtime = resolveProcTapLauncherRuntime("definitely-missing-proctap-launcher-codex", "3.13");

  assert.equal(runtime.available, false);
  assert.equal(runtime.launcher, "definitely-missing-proctap-launcher-codex");
  assert.equal(runtime.error, "launcher_unavailable");
});
