const test = require("node:test");
const assert = require("node:assert/strict");

const createStandaloneLogic = require("../core/standalone/logic");
const { parseBooleanLoose } = require("../core/utils/booleans");

function createTestLogic() {
  return createStandaloneLogic({
    parseBoolean: parseBooleanLoose,
    getTelemetry: () => ({
      bpm: 128,
      energy: 0.42,
      audioSourceLevel: 0.3,
      beatConfidence: 0.5,
      audioTransient: 0.24,
      audioFlux: 0.22
    }),
    getAudioReactivityDrive: () => ({ enabled: true, drive: 0.58, level: 0.44 })
  });
}

test("standalone logic normalizes state ranges and mode flags", () => {
  const logic = createTestLogic();
  const next = logic.normalizeStandaloneState({
    mode: "scene",
    hueMin: 320,
    hueMax: 20,
    satMin: 90,
    satMax: 20
  }, null, "hue");

  assert.equal(next.mode, "scene");
  assert.equal(next.animate, true);
  assert.equal(next.hueMin <= next.hueMax, true);
  assert.equal(next.satMin <= next.satMax, true);
});

test("standalone logic computes animated state and hsv conversion", () => {
  const logic = createTestLogic();
  const current = logic.normalizeStandaloneState({
    scene: "sweep",
    animate: true,
    speedMode: "audio"
  }, null, "wiz");

  const animated = logic.nextStandaloneAnimatedState(
    { id: "wiz-1", brand: "wiz" },
    current,
    120
  );
  assert.equal(animated.hue >= 0 && animated.hue <= 359, true);
  assert.equal(animated.bri >= 1 && animated.bri <= 100, true);
  assert.equal(animated.speedHz >= 0.2 && animated.speedHz <= 12, true);

  const rgb = logic.hsvToRgb(210, 70, 80);
  assert.equal(rgb.r >= 0 && rgb.r <= 255, true);
  assert.equal(rgb.g >= 0 && rgb.g <= 255, true);
  assert.equal(rgb.b >= 0 && rgb.b <= 255, true);
});
