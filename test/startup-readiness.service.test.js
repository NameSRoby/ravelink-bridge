// [TITLE] Test Module: test/startup-readiness.service.test.js
// [TITLE] Purpose: verify startup readiness diagnostics service lane + summary behavior

const test = require("node:test");
const assert = require("node:assert/strict");

const createStartupReadinessService = require("../src/app/runtime/startup-readiness.service");

test("startup readiness service captures boot and current lane snapshots", () => {
  const services = {
    systemConfigService: {
      getConfig: () => ({
        ok: true,
        config: {
          autoLaunchBrowser: true,
          autoLaunchDelayMs: 1200,
          hueTransportPreference: "auto",
          audioCaptureBackendStrategy: "auto_rust_first"
        }
      })
    },
    liveProfileService: {
      listProfiles: () => ([{ name: "default" }])
    },
    midiManager: {
      getStatus: () => ({
        moduleAvailable: false,
        connected: false,
        portCount: 0,
        reason: "midi_transport_unavailable"
      })
    },
    fixtureRegistry: {
      getFixtures: () => ([
        { id: "hue-main", brand: "hue", bridgeIp: "192.168.1.2", username: "abc", lightId: 1, engineEnabled: true, twitchEnabled: true },
        { id: "wiz-desk", brand: "wiz", ip: "", engineEnabled: true, twitchEnabled: true }
      ])
    },
    modRuntime: {
      list: () => ({ total: 2, loaded: 1 })
    }
  };
  const service = createStartupReadinessService({
    services,
    now: () => 1000
  });

  const snapshot = service.getSnapshot();
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.boot.summary.laneCount, 6);
  assert.equal(snapshot.current.summary.laneCount, 6);
  assert.equal(snapshot.current.lanes.config.state, "loaded");
  assert.equal(snapshot.current.lanes.profiles.state, "loaded");
  assert.equal(snapshot.current.lanes.hue.state, "loaded");
  assert.equal(snapshot.current.lanes.wiz.state, "missing");
  assert.equal(snapshot.current.lanes.midi.state, "missing");
});

test("startup readiness service tracks mods boot load failure and loaded transitions", () => {
  let modsSnapshot = { total: 1, loaded: 0 };
  const service = createStartupReadinessService({
    services: {
      systemConfigService: { getConfig: () => ({ ok: true, config: { autoLaunchBrowser: true } }) },
      liveProfileService: { listProfiles: () => [] },
      midiManager: { getStatus: () => ({ moduleAvailable: true, connected: true, portCount: 1, reason: "midi_listening" }) },
      fixtureRegistry: { getFixtures: () => [] },
      modRuntime: { list: () => modsSnapshot }
    },
    now: () => 2000
  });

  service.recordModsBootFailed(new Error("mods boot exploded"));
  let snapshot = service.getSnapshot();
  assert.equal(snapshot.boot.lanes.mods.state, "failed");

  modsSnapshot = { total: 1, loaded: 1 };
  service.recordModsBootLoaded({ total: 1, loaded: 1 });
  snapshot = service.getSnapshot();
  assert.equal(snapshot.boot.lanes.mods.state, "loaded");
  assert.equal(snapshot.current.lanes.mods.state, "loaded");
});

test("startup readiness service treats empty mods catalog as loaded baseline", () => {
  const service = createStartupReadinessService({
    services: {
      systemConfigService: { getConfig: () => ({ ok: true, config: { autoLaunchBrowser: true } }) },
      liveProfileService: { listProfiles: () => [] },
      midiManager: { getStatus: () => ({ moduleAvailable: true, connected: false, portCount: 0, reason: "midi_ready" }) },
      fixtureRegistry: { getFixtures: () => [] },
      modRuntime: { list: () => ({ total: 0, loaded: 0 }) }
    },
    now: () => 3000
  });

  const snapshot = service.getSnapshot();
  assert.equal(snapshot.current.lanes.mods.state, "loaded");
  assert.equal(snapshot.current.lanes.mods.ready, true);
});
