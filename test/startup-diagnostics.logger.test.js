const test = require("node:test");
const assert = require("node:assert/strict");

const logStartupDiagnostics = require("../src/app/runtime/startup-diagnostics.logger");

function createServices() {
  return {
    colorLibrary: {
      getSummary: () => ({ customCount: 42 })
    },
    fixtureRegistry: {
      getFixtures: () => [{ id: "wiz-main-1" }, { id: "hue-room-1" }],
      listEngineBy: () => [{ id: "wiz-main-1" }, { id: "hue-room-1" }],
      listTwitchBy: () => [{ id: "wiz-main-1" }],
      listCustomBy: () => []
    },
    systemConfigService: {
      getConfig: () => ({
        config: {
          autoLaunchBrowser: true,
          autoLaunchDelayMs: 1200,
          hueTransportPreference: "rest",
          updateChecksEnabled: true,
          updateStartupPromptEnabled: false,
          unsafeExposeSensitiveLogs: false,
          audioCaptureBackendStrategy: "force_rust"
        }
      })
    },
    twitchColorConfig: {
      getLoadSummary: () => ({
        defaultTarget: "hue",
        autoDefaultTarget: true,
        raveOffEnabled: true,
        fixturePrefixCount: 2,
        prefixes: {
          hue: "hue",
          wiz: "wiz",
          other: ""
        }
      })
    },
    liveProfileService: {
      listProfiles: () => []
    },
    audioEngine: {
      getStatus: () => ({
        backend: "rust",
        status: "idle"
      })
    },
    midiManager: {
      getStatus: () => ({
        moduleAvailable: false,
        connected: false,
        portCount: 0,
        reason: "midi_transport_unavailable"
      })
    },
    modRuntime: {
      list: () => ({
        loaded: 1,
        total: 2
      })
    },
    engineV2: {
      getStatus: () => ({
        tickMs: 100,
        paletteMapperMode: "strict",
        hardwareLimits: {
          hueMaxHz: 16,
          wizMaxHz: 20
        }
      })
    }
  };
}

test("startup diagnostics formatter prints grouped plain-text startup snapshot", () => {
  const lines = [];
  const formatter = logStartupDiagnostics.createFormatter({
    useColor: false,
    stream: { isTTY: true }
  });

  logStartupDiagnostics({
    services: createServices(),
    log: { log: line => lines.push(String(line ?? "")) },
    formatter,
    runtimeVersion: "1.6.2-dev",
    bridgeUrl: "http://127.0.0.1:5050"
  });

  const rendered = lines.join("\n");
  assert.match(rendered, /RAVELINK BRIDGE :: STARTUP SNAPSHOT/);
  assert.match(rendered, /Version\s+1\.6\.2-dev/);
  assert.match(rendered, /Endpoint\s+http:\/\/127\.0\.0\.1:5050/);
  assert.match(rendered, /Browser Launch\s+YES/);
  assert.match(rendered, /Hue Transport\s+REST/);
  assert.match(rendered, /Capture Backend\s+Force Rust/);
  assert.match(rendered, /Rave-Off Cmds\s+YES/);
  assert.match(rendered, /MIDI transport unavailable/);
  assert.doesNotMatch(rendered, /\u001b\[/);
});

test("startup console formatter exposes readable event and metric helpers without color", () => {
  const formatter = logStartupDiagnostics.createFormatter({
    useColor: false,
    stream: { isTTY: true }
  });

  const line = formatter.line("system", [
    formatter.field("Browser Open", "Scheduled", "good"),
    formatter.field("Delay", "1200ms", "text"),
    formatter.field("Target", "http://127.0.0.1:5050", "info")
  ], { tone: "system" });
  const event = formatter.event("update", "Release check complete", "info");

  assert.match(line, /SYSTEM/);
  assert.match(line, /Browser Open\s+Scheduled/);
  assert.match(line, /Target\s+http:\/\/127\.0\.0\.1:5050/);
  assert.match(event, /UPDATE/);
  assert.match(event, /Release check complete/);
});
