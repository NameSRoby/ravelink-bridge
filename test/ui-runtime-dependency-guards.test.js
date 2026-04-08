const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadFactory(relativeFile, factoryName, extraContext = {}) {
  const filePath = path.resolve(__dirname, "..", relativeFile);
  const code = fs.readFileSync(filePath, "utf8");
  const context = {
    console,
    window: { confirm: () => true },
    document: { createElement: () => ({}) },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout,
    clearTimeout,
    ...extraContext
  };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: filePath });
  return context[factoryName];
}

test("midi runtime requires its endpoint adapter", () => {
  const createMidiRuntimeUi = loadFactory(
    "public/assets/js/domains/midi/midi-runtime-ui.js",
    "createMidiRuntimeUi"
  );

  assert.throws(
    () => createMidiRuntimeUi({}),
    /midi runtime requires midiEndpointsAdapter/
  );
  assert.throws(
    () => createMidiRuntimeUi({ midiEndpointsAdapter: { getStatus: async () => null } }),
    /midi runtime missing adapter method: refreshStatus/
  );
});

test("fixtures server runtime requires its endpoint adapter", () => {
  const createFixturesServerRuntimeUi = loadFactory(
    "public/assets/js/domains/fixtures/fixtures-server-runtime-ui.js",
    "createFixturesServerRuntimeUi"
  );

  assert.throws(
    () => createFixturesServerRuntimeUi({}),
    /fixtures server runtime requires fixturesEndpointsAdapter/
  );
  assert.throws(
    () => createFixturesServerRuntimeUi({
      fixturesEndpointsAdapter: { getFixturesSnapshot: async () => null }
    }),
    /fixtures server runtime missing adapter method: getFixturesConfig/
  );
});

test("fixtures form runtime requires its endpoint adapter", () => {
  const createFixturesFormRuntimeUi = loadFactory(
    "public/assets/js/domains/fixtures/fixtures-form-runtime-ui.js",
    "createFixturesFormRuntimeUi"
  );

  assert.throws(
    () => createFixturesFormRuntimeUi({}),
    /fixtures form runtime requires fixturesEndpointsAdapter/
  );
  assert.throws(
    () => createFixturesFormRuntimeUi({
      fixturesEndpointsAdapter: { deleteFixtureDeleteQuery: async () => ({ ok: true }) }
    }),
    /fixtures form runtime missing adapter method: saveFixture/
  );
});

test("fixtures routing and pairing runtimes require endpoint adapters", () => {
  const createFixturesRoutingRuntimeUi = loadFactory(
    "public/assets/js/domains/fixtures/fixtures-routing-runtime-ui.js",
    "createFixturesRoutingRuntimeUi"
  );
  const wireFixturesHuePairingRuntimeUi = loadFactory(
    "public/assets/js/domains/fixtures/fixtures-hue-pairing-runtime-ui.js",
    "wireFixturesHuePairingRuntimeUi"
  );
  const createFixturesWizOnboardingRuntimeUi = loadFactory(
    "public/assets/js/domains/fixtures/fixtures-wiz-onboarding-runtime-ui.js",
    "createFixturesWizOnboardingRuntimeUi"
  );

  assert.throws(
    () => createFixturesRoutingRuntimeUi({}),
    /fixtures routing runtime requires fixturesEndpointsAdapter/
  );
  assert.throws(
    () => createFixturesRoutingRuntimeUi({
      fixturesEndpointsAdapter: { testConnectivity: async () => ({ ok: true }) }
    }),
    /fixtures routing runtime missing adapter method: saveFixture/
  );
  assert.throws(
    () => wireFixturesHuePairingRuntimeUi({}),
    /fixtures hue pairing runtime requires fixturesEndpointsAdapter/
  );
  assert.throws(
    () => wireFixturesHuePairingRuntimeUi({
      fixturesEndpointsAdapter: { addAllHueFixtures: async () => ({ ok: true }) }
    }),
    /fixtures hue pairing runtime missing adapter method: pairHueBridge/
  );
  assert.throws(
    () => createFixturesWizOnboardingRuntimeUi({}),
    /fixtures wiz onboarding runtime requires fixturesEndpointsAdapter/
  );
});

test("telemetry poll runtime requires its endpoint adapter", () => {
  const createTelemetryPollRuntimeUi = loadFactory(
    "public/assets/js/domains/telemetry/telemetry-poll-runtime-ui.js",
    "createTelemetryPollRuntimeUi",
    {
      audioDomainAdapter: {},
      paletteDomainAdapter: {},
      fixturesDomainAdapter: {}
    }
  );

  assert.throws(
    () => createTelemetryPollRuntimeUi({}),
    /telemetry poll runtime requires telemetryEndpointsAdapter/
  );
  assert.throws(
    () => createTelemetryPollRuntimeUi({
      telemetryEndpointsAdapter: { getRaveStatus: async () => null }
    }),
    /telemetry poll runtime missing adapter method: getRaveTelemetry/
  );
});
