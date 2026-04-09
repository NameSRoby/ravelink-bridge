// [TITLE] Test Module: test/audio-runtime.service.test.js
// [TITLE] Purpose: guard audio runtime config patch flow against runtime exceptions

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const createAudioRuntimeService = require("../src/domains/audio/audio-runtime.service");

function makeTempAudioPaths() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-audio-runtime-"));
  const runtimeAudioDir = path.join(root, "runtime", "audio");
  fs.mkdirSync(runtimeAudioDir, { recursive: true });
  return {
    configPath: path.join(runtimeAudioDir, "audio.config.json"),
    reactivityMapPath: path.join(runtimeAudioDir, "reactivity-map.json"),
    profilesPath: path.join(runtimeAudioDir, "profiles.json"),
    appIsolationLocksPath: path.join(runtimeAudioDir, "app-isolation-locks.json")
  };
}

function createAudioEngineMock() {
  let telemetry = {};
  return {
    setTelemetry(next = {}) {
      telemetry = {
        ...telemetry,
        ...(next && typeof next === "object" ? next : {})
      };
    },
    getTelemetry() {
      return { ...telemetry };
    }
  };
}

test("audio runtime patchConfig accepts app isolation updates without throwing", async () => {
  const paths = makeTempAudioPaths();
  const service = createAudioRuntimeService({
    ...paths,
    audioEngine: createAudioEngineMock()
  });

  const first = await service.patchConfig({
    ffmpegAppIsolationEnabled: true,
    ffmpegAppIsolationPrimaryApp: "firefox.exe",
    ffmpegAppIsolationPrimaryDevices: ["Headphones (FOX)"]
  }, { restart: false });

  assert.equal(first.ok, true);
  assert.equal(Array.isArray(first.changed), true);
  assert.equal(first.changed.includes("ffmpegAppIsolationEnabled"), true);
  assert.equal(first.changed.includes("ffmpegAppIsolationPrimaryApp"), true);
  assert.equal(first.changed.includes("ffmpegAppIsolationPrimaryDevices"), true);

  const second = await service.patchConfig({
    ffmpegAppIsolationEnabled: true,
    ffmpegAppIsolationPrimaryApp: "firefox.exe",
    ffmpegAppIsolationPrimaryDevices: ["Headphones (FOX)"]
  }, { restart: false });

  assert.equal(second.ok, true);
  assert.deepEqual(second.changed, []);
});

test("audio runtime patchConfig treats restart metadata as transient", async () => {
  const paths = makeTempAudioPaths();
  const service = createAudioRuntimeService({
    ...paths,
    audioEngine: createAudioEngineMock()
  });

  const patched = await service.patchConfig({
    inputBackend: "rustloop",
    restart: true,
    reason: "ui_audio_config_apply"
  }, { restart: false });

  assert.equal(patched.ok, true);
  assert.deepEqual(patched.changed, ["inputBackend"]);
  const configSnapshot = service.getConfigSnapshot().config;
  assert.equal(configSnapshot.inputBackend, "rustloop");
  assert.equal(Object.hasOwn(configSnapshot, "restart"), false);
  assert.equal(Object.hasOwn(configSnapshot, "reason"), false);

  const saved = JSON.parse(fs.readFileSync(paths.configPath, "utf8"));
  assert.equal(Object.hasOwn(saved, "restart"), false);
  assert.equal(Object.hasOwn(saved, "reason"), false);
});

test("audio runtime loadAll removes stale transient config keys", () => {
  const paths = makeTempAudioPaths();
  fs.writeFileSync(paths.configPath, JSON.stringify({
    inputBackend: "rustloop",
    restart: true,
    apply: true,
    reason: "old_ui_apply"
  }, null, 2));
  const service = createAudioRuntimeService({
    ...paths,
    audioEngine: createAudioEngineMock()
  });

  const configSnapshot = service.getConfigSnapshot().config;
  assert.equal(configSnapshot.inputBackend, "rustloop");
  assert.equal(Object.hasOwn(configSnapshot, "restart"), false);
  assert.equal(Object.hasOwn(configSnapshot, "apply"), false);
  assert.equal(Object.hasOwn(configSnapshot, "reason"), false);

  const saved = JSON.parse(fs.readFileSync(paths.configPath, "utf8"));
  assert.equal(Object.hasOwn(saved, "restart"), false);
  assert.equal(Object.hasOwn(saved, "apply"), false);
  assert.equal(Object.hasOwn(saved, "reason"), false);
});

test("app isolation selection ignores unrelated dedicated media companions for browser sources", () => {
  const result = createAudioRuntimeService.resolveAppIsolationTargetSelection(
    {
      ffmpegAppIsolationPrimaryApp: "firefox.exe",
      ffmpegAppIsolationPrimaryDevices: ["Headphones (FOX)"]
    },
    {
      apps: [
        { displayName: "firefox.exe" },
        { displayName: "amplibraryagent.exe" }
      ],
      audioHints: {
        audioTokens: ["amplibraryagent.exe"],
        companionMap: {
          firefox: ["amplibraryagent"]
        }
      }
    },
    {}
  );

  assert.equal(result.selectedSourceToken, "firefox");
  assert.equal(result.captureToken, "");
  assert.equal(result.captureReason, "source_running_no_audio");
  assert.equal(result.selectedMode, "awaiting_app");
  assert.equal(result.running, false);
});

test("app isolation selection does not mark running source as capture-active without audio evidence", () => {
  const result = createAudioRuntimeService.resolveAppIsolationTargetSelection(
    {
      ffmpegAppIsolationPrimaryApp: "firefox.exe",
      ffmpegAppIsolationPrimaryDevices: ["Headphones (FOX)"]
    },
    {
      apps: [{ displayName: "firefox.exe" }],
      audioHints: {
        audioTokens: [],
        companionMap: {}
      }
    },
    {}
  );

  assert.equal(result.selectedSourceToken, "firefox");
  assert.equal(result.captureToken, "");
  assert.equal(result.captureReason, "source_running_no_audio");
  assert.equal(result.selectedMode, "awaiting_app");
  assert.equal(result.running, false);
});

test("app isolation selection keeps manual lock override when lock target is active and plausible", () => {
  const result = createAudioRuntimeService.resolveAppIsolationTargetSelection(
    {
      ffmpegAppIsolationPrimaryApp: "firefox.exe",
      ffmpegAppIsolationPrimaryDevices: ["Headphones (FOX)"]
    },
    {
      apps: [
        { displayName: "firefox.exe", pids: [1101], windowTitles: ["Firefox"] },
        { displayName: "streamhostaudio.exe", pids: [1102], windowTitles: [] }
      ],
      processMetadata: [
        { token: "firefox", pid: 1101, parentPid: 9000, executablePath: "C:\\Apps\\Shared\\firefox.exe" },
        { token: "streamhostaudio", pid: 1102, parentPid: 1101, executablePath: "C:\\Apps\\Shared\\streamhostaudio.exe" }
      ],
      audioHints: {
        audioTokens: ["streamhostaudio.exe"],
        companionMap: {}
      }
    },
    {
      firefox: "streamhostaudio"
    }
  );

  assert.equal(result.selectedSourceToken, "firefox");
  assert.equal(result.captureToken, "streamhostaudio");
  assert.equal(result.captureReason, "manual_lock_active");
  assert.equal(result.selectedMode, "primary");
  assert.equal(result.running, true);
});

test("app isolation selection marks stale manual lock mismatch when process-group relation is absent", () => {
  const result = createAudioRuntimeService.resolveAppIsolationTargetSelection(
    {
      ffmpegAppIsolationPrimaryApp: "firefox.exe",
      ffmpegAppIsolationPrimaryDevices: ["Headphones (FOX)"]
    },
    {
      apps: [
        { displayName: "firefox.exe", pids: [2201], windowTitles: ["Firefox"] },
        { displayName: "amplibraryagent.exe", pids: [5101], windowTitles: [] }
      ],
      processMetadata: [
        { token: "firefox", pid: 2201, parentPid: 1000, executablePath: "C:\\Program Files\\Mozilla Firefox\\firefox.exe" },
        { token: "amplibraryagent", pid: 5101, parentPid: 5000, executablePath: "C:\\Program Files\\Apple Music\\amplibraryagent.exe" }
      ],
      audioHints: {
        audioTokens: ["amplibraryagent.exe"],
        companionMap: {}
      }
    },
    {
      firefox: "amplibraryagent"
    }
  );

  assert.equal(result.selectedSourceToken, "firefox");
  assert.equal(result.captureToken, "");
  assert.equal(result.captureReason, "source_running_no_audio");
  assert.equal(result.running, false);
});

test("app isolation selection does not trust shared-parent-only relationship for browser companion fallback", () => {
  const result = createAudioRuntimeService.resolveAppIsolationTargetSelection(
    {
      ffmpegAppIsolationPrimaryApp: "firefox.exe",
      ffmpegAppIsolationPrimaryDevices: ["Headphones (FOX)"]
    },
    {
      apps: [
        { displayName: "firefox.exe", pids: [4101], windowTitles: ["Firefox"] },
        { displayName: "amplibraryagent.exe", pids: [5101], windowTitles: [] }
      ],
      processMetadata: [
        { token: "firefox", pid: 4101, parentPid: 3000, executablePath: "C:\\Program Files\\Mozilla Firefox\\firefox.exe" },
        { token: "amplibraryagent", pid: 5101, parentPid: 3000, executablePath: "C:\\Program Files\\Apple Music\\amplibraryagent.exe" }
      ],
      audioHints: {
        audioTokens: ["amplibraryagent.exe"],
        companionMap: {
          firefox: ["amplibraryagent"]
        }
      }
    },
    {}
  );

  assert.equal(result.selectedSourceToken, "firefox");
  assert.equal(result.captureToken, "");
  assert.equal(result.captureReason, "source_running_no_audio");
  assert.equal(result.selectedMode, "awaiting_app");
  assert.equal(result.running, false);
});

test("app isolation selection applies browser-source fallback using live audio candidates without hardcoded app mapping", () => {
  const result = createAudioRuntimeService.resolveAppIsolationTargetSelection(
    {
      ffmpegAppIsolationPrimaryApp: "msedgewebview2.exe",
      ffmpegAppIsolationPrimaryDevices: ["Headphones (FOX)"]
    },
    {
      apps: [
        { displayName: "msedgewebview2.exe", windowTitles: ["OBS Browser Source"] },
        {
          displayName: "streamhostaudio.exe",
          audioCapable: true,
          likelyAudio: true,
          likelyAudioConfidence: 0.91,
          windowTitles: [],
          pids: [3402]
        }
      ],
      processMetadata: [
        { token: "msedgewebview2", pid: 3401, parentPid: 2000, executablePath: "D:\\Rave\\obs\\msedgewebview2.exe" },
        { token: "streamhostaudio", pid: 3402, parentPid: 3401, executablePath: "D:\\Rave\\obs\\streamhostaudio.exe" }
      ],
      audioHints: {
        audioTokens: ["streamhostaudio.exe"],
        companionMap: {}
      }
    },
    {}
  );

  assert.equal(result.selectedSourceToken, "msedgewebview2");
  assert.equal(result.captureToken, "streamhostaudio");
  assert.equal(result.captureReason, "browser_fallback_active");
  assert.equal(result.selectedMode, "primary");
  assert.equal(result.running, true);
});

test("app isolation selection keeps primary focus when primary is running without audio and fallback is active", () => {
  const result = createAudioRuntimeService.resolveAppIsolationTargetSelection(
    {
      ffmpegAppIsolationPrimaryApp: "applemusic.exe",
      ffmpegAppIsolationFallbackApp: "firefox.exe",
      ffmpegAppIsolationPrimaryDevices: ["Headphones (FOX)"],
      ffmpegAppIsolationFallbackDevices: ["Headphones (FOX)"]
    },
    {
      apps: [
        { displayName: "applemusic.exe" },
        { displayName: "firefox.exe" }
      ],
      audioHints: {
        audioTokens: ["firefox.exe"],
        companionMap: {}
      }
    },
    {}
  );

  assert.equal(result.selectedSourceToken, "applemusic");
  assert.equal(result.captureToken, "");
  assert.equal(result.captureReason, "source_running_no_audio");
  assert.equal(result.selectedMode, "awaiting_app");
  assert.equal(result.running, false);
});

test("app isolation selection activates fallback app when primary is closed", () => {
  const result = createAudioRuntimeService.resolveAppIsolationTargetSelection(
    {
      ffmpegAppIsolationPrimaryApp: "applemusic.exe",
      ffmpegAppIsolationFallbackApp: "firefox.exe",
      ffmpegAppIsolationPrimaryDevices: ["Headphones (FOX)"],
      ffmpegAppIsolationFallbackDevices: ["Headphones (FOX)"]
    },
    {
      apps: [{ displayName: "firefox.exe" }],
      audioHints: {
        audioTokens: ["firefox.exe"],
        companionMap: {}
      }
    },
    {}
  );

  assert.equal(result.selectedSourceToken, "firefox");
  assert.equal(result.captureToken, "firefox");
  assert.equal(result.captureReason, "source_active");
  assert.equal(result.selectedMode, "fallback_app");
  assert.equal(result.running, true);
});

test("app isolation selection maps Firefox Nightly aliases to firefox token", () => {
  const result = createAudioRuntimeService.resolveAppIsolationTargetSelection(
    {
      ffmpegAppIsolationPrimaryApp: "Firefox Nightly.exe",
      ffmpegAppIsolationPrimaryDevices: ["Headphones (FOX)"]
    },
    {
      apps: [{ displayName: "firefox.exe" }],
      audioHints: {
        audioTokens: ["firefox.exe"],
        companionMap: {}
      }
    },
    {}
  );

  assert.equal(result.selectedSourceToken, "firefox");
  assert.equal(result.selectedSourceChannelHint, "nightly");
  assert.equal(result.captureToken, "firefox");
  assert.equal(result.captureChannelHint, "nightly");
  assert.equal(result.captureReason, "source_active");
  assert.equal(result.running, true);
});

test("app isolation selection accepts bare nightly token as Firefox Nightly", () => {
  const result = createAudioRuntimeService.resolveAppIsolationTargetSelection(
    {
      ffmpegAppIsolationPrimaryApp: "nightly",
      ffmpegAppIsolationPrimaryDevices: ["Headphones (FOX)"]
    },
    {
      apps: [{ displayName: "firefox.exe" }],
      audioHints: {
        audioTokens: ["firefox.exe"],
        companionMap: {}
      }
    },
    {}
  );

  assert.equal(result.selectedSourceToken, "firefox");
  assert.equal(result.selectedSourceChannelHint, "nightly");
  assert.equal(result.captureToken, "firefox");
  assert.equal(result.captureChannelHint, "nightly");
  assert.equal(result.captureReason, "source_active");
  assert.equal(result.running, true);
});

test("representative pid selection prefers Firefox Nightly window when channel hint is nightly", () => {
  const paths = makeTempAudioPaths();
  const service = createAudioRuntimeService({
    ...paths,
    audioEngine: createAudioEngineMock()
  });

  const pid = service.resolveRepresentativePidForToken(
    {
      apps: [
        {
          displayName: "firefox.exe",
          pids: [1101, 2202],
          windowTitles: ["Mozilla Firefox", "Firefox Nightly"],
          executablePaths: [
            "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
            "C:\\Program Files\\Firefox Nightly\\firefox.exe"
          ]
        }
      ],
      processMetadata: [
        {
          token: "firefox",
          pid: 1101,
          parentPid: 100,
          executablePath: "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
          mainWindowTitle: "Mozilla Firefox",
          hasWindow: true
        },
        {
          token: "firefox",
          pid: 2202,
          parentPid: 100,
          executablePath: "C:\\Program Files\\Firefox Nightly\\firefox.exe",
          mainWindowTitle: "Firefox Nightly",
          hasWindow: true
        }
      ]
    },
    "firefox.exe",
    { preferredChannel: "nightly" }
  );

  assert.equal(pid, 2202);
});
