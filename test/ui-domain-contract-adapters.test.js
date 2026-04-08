const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeAudioTelemetryContract,
  normalizeAudioReactivityMapContract
} = require("../public/assets/js/domains/contracts/audio-domain.adapter.js");
const {
  createAudioUiInputAdapter
} = require("../public/assets/js/domains/contracts/audio-ui-input.adapter.js");
const {
  normalizePaletteTelemetryContract
} = require("../public/assets/js/domains/contracts/palette-domain.adapter.js");
const {
  createPaletteUiInputAdapter
} = require("../public/assets/js/domains/contracts/palette-ui-input.adapter.js");
const {
  normalizeFixturesSnapshotContract
} = require("../public/assets/js/domains/contracts/fixtures-domain.adapter.js");
const {
  createFixturesUiInputAdapter
} = require("../public/assets/js/domains/contracts/fixtures-ui-input.adapter.js");

test("audio telemetry contract normalizes fallback fields", () => {
  const normalized = normalizeAudioTelemetryContract({
    rms: 0.12,
    audioTransient: 0.3,
    audioFlux: 0.4,
    audioBandLow: 0.5,
    audioBandMid: 0.6,
    audioBandHigh: 0.7
  });
  assert.equal(normalized.level, 0.12);
  assert.equal(normalized.transient, 0.3);
  assert.equal(normalized.spectralFlux, 0.4);
  assert.equal(normalized.bandLow, 0.5);
  assert.equal(normalized.bandMid, 0.6);
  assert.equal(normalized.bandHigh, 0.7);
});

test("audio reactivity map contract normalizes targets and trackers", () => {
  const normalized = normalizeAudioReactivityMapContract({
    reactivityGainMode: "MANUAL",
    reactivityGain: "1.8",
    targets: {
      hue: { enabled: false, amount: "0.6", sources: ["bass", "flux"] }
    },
    metaAutoTempoTrackers: { baseline: true, peaks: false }
  });
  assert.equal(normalized.reactivityGainMode, "manual");
  assert.equal(normalized.reactivityGain, 1.8);
  assert.equal(normalized.targets.hue.enabled, false);
  assert.equal(normalized.targets.hue.amount, 0.6);
  assert.deepEqual(normalized.targets.hue.sources, ["bass", "flux"]);
  assert.equal(normalized.metaAutoTempoTrackers.baseline, true);
  assert.equal(normalized.metaAutoTempoTrackers.peaks, false);
  assert.equal(normalized.metaAutoTempoTrackers.transients, true);
  assert.equal(normalized.metaAutoTempoTrackers.flux, true);
});

test("palette telemetry contract normalizes status fields", () => {
  const normalized = normalizePaletteTelemetryContract({
    active: 1,
    running: 0,
    scene: "flow_motion",
    behavior: "sweep",
    phrase: "verse",
    paletteBrightnessSceneActive: "MOTION"
  });
  assert.equal(normalized.active, false);
  assert.equal(normalized.running, false);
  assert.equal(normalized.scene, "flow_motion");
  assert.equal(normalized.behavior, "sweep");
  assert.equal(normalized.phrase, "verse");
  assert.equal(normalized.paletteBrightnessSceneActive, "motion");
});

test("fixtures snapshot contract normalizes rows and recovers deterministic fallback ids", () => {
  const normalized = normalizeFixturesSnapshotContract({
    fixtures: [
      { id: "hue-kitchen", brand: "Hue", zone: "Main", enabled: true },
      { fixtureId: "wiz-desk", brand: "WIZ", zone: "Desk", engineEnabled: false },
      { brand: "hue", bridgeId: "ecb5", lightId: 2, enabled: "false", twitchEnabled: "0" },
      { brand: "hue" }
    ]
  });
  assert.equal(normalized.ok, true);
  assert.equal(normalized.total, 3);
  assert.equal(normalized.fixtures[0].id, "hue-kitchen");
  assert.equal(normalized.fixtures[0].brand, "hue");
  assert.equal(normalized.fixtures[1].id, "wiz-desk");
  assert.equal(normalized.fixtures[1].engineEnabled, false);
  assert.equal(normalized.fixtures[2].id, "hue-ecb5-2");
  assert.equal(normalized.fixtures[2].enabled, false);
  assert.equal(normalized.fixtures[2].twitchEnabled, false);
});

test("audio UI input adapter normalizes devices and tokens deterministically", () => {
  const adapter = createAudioUiInputAdapter();
  const devices = adapter.normalizeAudioDeviceListUi("Speaker A\nSpeaker A\nSpeaker B");
  assert.deepEqual(devices, ["Speaker A", "Speaker B"]);
  assert.equal(adapter.formatAudioDeviceListUi(devices), "Speaker A\nSpeaker B");
  assert.equal(adapter.normalizeAudioAppNameUi("spotify.exe (1234) [pid 1234]"), "spotify.exe (1234)");
  assert.equal(adapter.normalizeAudioAppTokenUi("spotify.exe"), "spotify");
  assert.equal(adapter.normalizeAudioAppTokenUi("Firefox Nightly.exe"), "firefox");
  assert.equal(adapter.normalizeAudioAppTokenUi("Mozilla Firefox"), "firefox");
  assert.equal(adapter.normalizeAudioProfileNameUi("  My* Profile !!! "), "My Profile");
});

test("palette UI input adapter normalizes timing and spectrum-map fields", () => {
  const adapter = createPaletteUiInputAdapter({
    cycleModeOrder: ["on_trigger"],
    spectrumMapModeOrder: ["auto", "manual"],
    audioFeatureKeys: ["lows", "mids", "highs", "rms", "flux"],
    defaultSpectrumFeatureMap: ["lows", "mids", "highs", "rms", "flux"],
    vividnessLevelOptions: [0, 1, 2, 3, 4],
    timedIntervalMinSec: 2,
    timedIntervalMaxSec: 60,
    beatLockGraceMinSec: 0,
    beatLockGraceMaxSec: 8,
    reactiveMarginMin: 5,
    reactiveMarginMax: 100,
    brightnessFollowAmountMin: 0,
    brightnessFollowAmountMax: 2
  });
  assert.equal(adapter.normalizePaletteDisorderAggressionUi(45), 0.45);
  assert.equal(adapter.normalizePaletteTimedIntervalSecUi(16), 15);
  assert.equal(adapter.normalizePaletteBeatLockGraceSecUi(7.6), 8);
  assert.equal(adapter.normalizePaletteReactiveMarginUi("42"), 42);
  assert.equal(adapter.normalizePaletteVividnessUi(9), 4);
  assert.deepEqual(
    adapter.normalizePaletteSpectrumFeatureMapUi(["lows", "bad", "flux"], ["lows", "mids", "highs", "rms", "flux"]),
    ["lows", "mids", "flux", "rms", "flux"]
  );
});

test("fixtures UI input adapter normalizes brand lists and config checks", () => {
  const adapter = createFixturesUiInputAdapter({
    modBrandRe: /^[a-z][a-z0-9_-]{1,31}$/
  });
  assert.equal(adapter.getCanonicalZoneForBrand("hue"), "hue");
  assert.equal(adapter.getCanonicalZoneForBrand("wiz"), "wiz");
  assert.equal(adapter.isBuiltinFixtureBrand("hue"), true);
  assert.equal(adapter.normalizeFixtureModBrandToken("HTTP-RGB"), "http-rgb");
  assert.deepEqual(
    adapter.collectFixtureModBrandsFromSnapshot(
      { modBrands: ["http-rgb"] },
      [{ brand: "my-adapter" }, { brand: "hue" }]
    ),
    ["http-rgb", "my-adapter"]
  );
  assert.equal(adapter.isFixtureConfiguredForOutput({ brand: "wiz", ip: "192.168.1.80" }), true);
  assert.equal(adapter.isFixtureConfiguredForOutput({ brand: "wiz", ip: "192.168.x.x" }), false);
});
