// [TITLE] Module: scripts/sanitize-release.js
// [TITLE] Purpose: sanitize-release

const fs = require("fs");
const path = require("path");

const DEFAULT_ROOT = path.join(__dirname, "..");
const EXTRACT_ARCHIVE_DIR_RE = /-EXTRACT-FIRST(?:\.BAK-\d{8}-\d{3,6})?$/i;

const FIXTURES_TEMPLATE = {
  intentRoutes: {
    HUE_STATE: "hue",
    WIZ_PULSE: "wiz",
    TWITCH_HUE: "hue",
    TWITCH_WIZ: "wiz"
  },
  fixtures: [
    {
      id: "hue-main-1",
      brand: "hue",
      zone: "hue",
      enabled: true,
      engineEnabled: true,
      twitchEnabled: true,
      customEnabled: false,
      bridgeIp: "192.168.x.x",
      username: "replace_with_hue_username",
      bridgeId: "replace_with_bridge_id",
      clientKey: "replace_with_client_key",
      entertainmentAreaId: "replace_with_entertainment_area",
      lightId: 1
    },
    {
      id: "wiz-main-1",
      brand: "wiz",
      zone: "wiz",
      enabled: true,
      engineEnabled: true,
      twitchEnabled: true,
      customEnabled: false,
      ip: "192.168.x.x"
    },
    {
      id: "wiz-custom-1",
      brand: "wiz",
      zone: "custom",
      enabled: true,
      engineEnabled: false,
      twitchEnabled: true,
      customEnabled: true,
      ip: "192.168.x.x"
    }
  ]
};

const TWITCH_COLOR_TEMPLATE = {
  version: 1,
  defaultTarget: "hue",
  autoDefaultTarget: true,
  prefixes: {
    hue: "",
    wiz: "wiz",
    other: ""
  },
  fixturePrefixes: {},
  raveOff: {
    enabled: true,
    defaultText: "random",
    groups: {},
    fixtures: {}
  }
};

const AUDIO_RUNTIME_TEMPLATE = {
  inputBackend: "auto",
  sampleRate: 96000,
  framesPerBuffer: 256,
  channels: 2,
  noiseFloorMin: 0.00045,
  peakDecay: 0.93,
  outputGain: 1,
  autoLevelEnabled: true,
  autoLevelTargetRms: 0.028,
  autoLevelMinGain: 0.45,
  autoLevelMaxGain: 1.55,
  autoLevelResponse: 0.015,
  autoLevelGate: 0.007,
  limiterThreshold: 0.82,
  limiterKnee: 0.16,
  restartMs: 1500,
  watchdogMs: 3000,
  logEveryTicks: 60,
  bandLowHz: 180,
  bandMidHz: 2200,
  deviceMatch: "",
  deviceId: null,
  ffmpegPath: "ffmpeg",
  ffmpegInputFormat: "dshow",
  ffmpegInputDevice: "",
  ffmpegInputDevices: [],
  ffmpegLogLevel: "error",
  ffmpegUseWallclock: true,
  ffmpegAppIsolationEnabled: false,
  ffmpegAppIsolationStrict: false,
  ffmpegAppIsolationPrimaryApp: "",
  ffmpegAppIsolationFallbackApp: "",
  ffmpegAppIsolationPrimaryDevices: [],
  ffmpegAppIsolationFallbackDevices: [],
  ffmpegAppIsolationMultiSource: false,
  ffmpegAppIsolationCheckMs: 300000
};

const AUDIO_REACTIVITY_MAP_TEMPLATE = {
  version: 1,
  dropEnabled: false,
  hardwareRateLimitsEnabled: true,
  metaAutoHueWizBaselineBlend: true,
  metaAutoTempoTrackersAuto: false,
  metaAutoTempoTrackers: {
    baseline: true,
    peaks: false,
    transients: false,
    flux: false
  },
  targets: {
    hue: { enabled: true, amount: 1, sources: ["smart"] },
    wiz: { enabled: true, amount: 1, sources: ["smart"] },
    other: { enabled: true, amount: 1, sources: ["smart"] }
  }
};

const SYSTEM_CONFIG_TEMPLATE = {
  version: 3,
  autoLaunchBrowser: true,
  browserLaunchDelayMs: 1200,
  unsafeExposeSensitiveLogs: false,
  hueTransportPreference: "auto"
};

const FIXTURE_METRIC_ROUTING_TEMPLATE = {
  version: 1,
  config: {
    mode: "manual",
    metric: "baseline",
    metaAutoFlip: false,
    harmonySize: 1,
    maxHz: null
  },
  brands: {
    hue: null,
    wiz: null
  },
  fixtures: {}
};

const PALETTE_FIXTURE_OVERRIDES_TEMPLATE = {
  version: 1,
  fixtures: {}
};

const STANDALONE_STATE_TEMPLATE = {
  version: 1,
  fixtures: {}
};

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function wipeFolder(folderPath) {
  if (!fs.existsSync(folderPath)) return;
  fs.rmSync(folderPath, { recursive: true, force: true });
}

function wipeMatchingDirs(rootPath, matcher) {
  if (!fs.existsSync(rootPath)) return;
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!matcher(entry.name)) continue;
    wipeFolder(path.join(rootPath, entry.name));
  }
}

function deleteFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
  } catch {}
}

function removeRootReleaseArtifacts(root) {
  if (!fs.existsSync(root)) return;
  const releaseArtifactPattern = /^RaveLink-Bridge-(?:Windows-)?v?[\w.\-]+(?:-self-contained)?\.zip$/i;
  const setupArtifactPattern = /^RaveLink-Bridge-(?:Windows-)?v?[\w.\-]+-setup-installer\.exe$/i;
  const legacySetupPattern = /^RaveLink-Bridge-Setup-v[\w.\-]+\.exe$/i;

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (
      releaseArtifactPattern.test(name) ||
      setupArtifactPattern.test(name) ||
      legacySetupPattern.test(name)
    ) {
      deleteFile(path.join(root, name));
    }
  }
}

function sanitizeRoot(rootDir = DEFAULT_ROOT, options = {}) {
  const root = path.resolve(String(rootDir || DEFAULT_ROOT));
  const opts = {
    purgeRuntime: options.purgeRuntime !== false,
    purgeBackups: options.purgeBackups !== false,
    purgeRelease: options.purgeRelease !== false,
    pruneRootArtifacts: options.pruneRootArtifacts !== false
  };

  if (opts.purgeRuntime) {
    wipeFolder(path.join(root, ".runtime"));
  }
  if (opts.purgeBackups) {
    wipeFolder(path.join(root, "backup"));
    wipeFolder(path.join(root, "backups"));
    wipeFolder(path.join(root, "core", "backups"));
    deleteFile(path.join(root, "core", "fixtures.config.local.backup.json"));
  }
  if (opts.purgeRelease) {
    wipeFolder(path.join(root, "release"));
  }
  wipeMatchingDirs(root, name => EXTRACT_ARCHIVE_DIR_RE.test(String(name || "")));
  if (opts.pruneRootArtifacts) {
    removeRootReleaseArtifacts(root);
  }
  deleteFile(path.join(root, "core", ".core-lock.key"));
  deleteFile(path.join(root, "core", "audio.process-locks.json"));

  const fixturesPath = path.join(root, "core", "fixtures.config.json");
  writeJson(fixturesPath, FIXTURES_TEMPLATE);
  const twitchColorConfigPath = path.join(root, "core", "twitch.color.config.json");
  writeJson(twitchColorConfigPath, TWITCH_COLOR_TEMPLATE);
  const audioRuntimeConfigPath = path.join(root, "core", "audio.config.json");
  writeJson(audioRuntimeConfigPath, AUDIO_RUNTIME_TEMPLATE);
  const audioReactivityMapPath = path.join(root, "core", "audio.reactivity.map.json");
  writeJson(audioReactivityMapPath, AUDIO_REACTIVITY_MAP_TEMPLATE);
  const systemConfigPath = path.join(root, "core", "system.config.json");
  writeJson(systemConfigPath, SYSTEM_CONFIG_TEMPLATE);
  const fixtureMetricRoutingPath = path.join(root, "core", "fixture.metric.routing.json");
  writeJson(fixtureMetricRoutingPath, FIXTURE_METRIC_ROUTING_TEMPLATE);
  const paletteFixtureOverridesPath = path.join(root, "core", "palette.fixture.overrides.json");
  writeJson(paletteFixtureOverridesPath, PALETTE_FIXTURE_OVERRIDES_TEMPLATE);
  const standaloneStatePath = path.join(root, "core", "standalone.state.json");
  writeJson(standaloneStatePath, STANDALONE_STATE_TEMPLATE);

  console.log(`[sanitize-release] sanitized root: ${root}`);
}

function sanitizeRelease(rootDir = DEFAULT_ROOT, options = {}) {
  const root = path.resolve(String(rootDir || DEFAULT_ROOT));
  sanitizeRoot(root, options);

  // Mirror repo used for publish workflows; sanitize it too if present.
  const pushMirror = path.join(root, ".pushrepo");
  if (fs.existsSync(pushMirror) && fs.statSync(pushMirror).isDirectory()) {
    sanitizeRoot(pushMirror, options);
  }

  console.log("[sanitize-release] done");
}

if (require.main === module) {
  const argSet = new Set(process.argv.slice(2).map(arg => String(arg || "").trim().toLowerCase()));
  const keepBackupsByFlag = argSet.has("--keep-backups");
  const keepBackupsByEnv = String(process.env.RAVELINK_SANITIZE_KEEP_BACKUPS || "").trim() === "1";
  sanitizeRelease(DEFAULT_ROOT, {
    purgeBackups: !(keepBackupsByFlag || keepBackupsByEnv)
  });
}

module.exports = sanitizeRelease;
