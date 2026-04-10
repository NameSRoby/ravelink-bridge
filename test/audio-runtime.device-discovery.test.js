// [TITLE] Purpose: verify audio runtime device-discovery helper keeps output hints and candidate ranking deterministic

const test = require("node:test");
const assert = require("node:assert/strict");

const createAudioRuntimeDeviceDiscovery = require("../src/domains/audio/audio-runtime.device-discovery");

function normalizeString(value, max = 256) {
  return String(value || "").trim().slice(0, Math.max(1, Number(max) || 256));
}

function dedupeStringList(values = []) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const token = String(value || "").trim();
    if (!token) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}

function createDeviceDiscovery(overrides = {}) {
  return createAudioRuntimeDeviceDiscovery({
    normalizeString,
    dedupeStringList,
    runPowerShellJson: overrides.runPowerShellJson || (() => []),
    runPowerShellText: overrides.runPowerShellText || (() => ""),
    parseFirstJsonLine: overrides.parseFirstJsonLine || (() => null),
    detectRustCaptureRuntimeAvailability: overrides.detectRustCaptureRuntimeAvailability || (() => ({
      resolver: false,
      resolverPath: ""
    })),
    rootDir: "D:\\RaveLink-Bridge"
  });
}

test("audio device discovery prefers concrete render endpoint names over generic Windows mapper hints", () => {
  const discovery = createDeviceDiscovery({
    runPowerShellJson: () => ([
      { FriendlyName: "Headphones (USB DAC)", InstanceId: "render-1" },
      { FriendlyName: "Microphone (USB DAC)", InstanceId: "capture-1" }
    ]),
    runPowerShellText: () => "Speakers",
    detectRustCaptureRuntimeAvailability: () => ({
      resolver: false,
      resolverPath: ""
    })
  });

  const result = discovery.resolvePreferredOutputHintName({}, {});

  assert.equal(result.name, "Headphones (USB DAC)");
  assert.deepEqual(result.outputEndpoints, ["Headphones (USB DAC)"]);
  assert.equal(result.source, "windows_sound_mapper");
});

test("audio device discovery output matching rewards loopback candidates over unrelated names", () => {
  const discovery = createDeviceDiscovery();

  const loopback = discovery.scoreAudioDefaultOutputMatch(
    "Stereo Mix (USB DAC Loopback)",
    "Headphones (USB DAC)"
  );
  const unrelated = discovery.scoreAudioDefaultOutputMatch(
    "Microphone (Webcam)",
    "Headphones (USB DAC)"
  );

  assert.equal(loopback > 0, true);
  assert.equal(loopback > unrelated, true);
});

test("audio device discovery DShow candidate scoring favors loopback/output devices over microphone inputs", () => {
  const discovery = createDeviceDiscovery();

  const loopbackScore = discovery.scoreDshowCaptureCandidate(
    "Stereo Mix (USB DAC Loopback)",
    "Headphones (USB DAC)",
    "USB DAC"
  );
  const micScore = discovery.scoreDshowCaptureCandidate(
    "Microphone (USB DAC)",
    "Headphones (USB DAC)",
    "USB DAC"
  );

  assert.equal(loopbackScore > micScore, true);
  assert.equal(loopbackScore > 0, true);
});
