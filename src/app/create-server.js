// [TITLE] Module: app/create-server.js
// [TITLE] Purpose: compose application services and HTTP runtime
// [TITLE] Functionality Index:
// [TITLE] - initialize persistent stores + domain services
// [TITLE] - wire adapters and runtime ports
// [TITLE] - register routes and static UI hosting

const path = require("path");
const express = require("express");
const axios = require("axios");
const createColorLibraryService = require("../domains/colors/color-library.service");
const createFixtureRegistry = require("../domains/fixtures/fixture-registry");
const createTwitchColorConfigRuntime = require("../domains/twitch/twitch-color-config.runtime");
const createTwitchColorDirectiveService = require("../domains/twitch/twitch-color-directive");
const createColorCommandService = require("../domains/twitch/color-command.service");
const createHueBridgeAdapter = require("../adapters/brands/hue-bridge.adapter");
const createWizBridgeAdapter = require("../adapters/brands/wiz-bridge.adapter");
const createNoopModRuntime = require("../domains/mods/mod-loader.port");
const createNoopMidiManager = require("../domains/midi/midi-manager.port");
const createAudioEnginePort = require("../domains/audio/audio-engine.port");
const createAudioRuntimeService = require("../domains/audio/audio-runtime.service");
const createEngineV2Runtime = require("../domains/engine-v2/engine.runtime");
const createEnginePaletteService = require("../domains/engine-v2/engine.palette.service");
const createLiveProfileService = require("../domains/live/live-profile.service");
const createLiveCompatService = require("../domains/live/live-compat.service");
const createInternetGatewayRuntime = require("../domains/internet-gateway/internet-gateway.runtime");
const createSystemConfigService = require("../domains/system/system-config.service");
const createSystemUpdateService = require("../domains/system/system-update.service");
const createSystemOauthService = require("../domains/system/system-oauth.service");
const createIndexPageRenderer = require("./ui/index-page.renderer");
const createStartupReadinessService = require("./runtime/startup-readiness.service");
const createStartupLaunchDiagnosticsService = require("./runtime/startup-launch-diagnostics.service");
const { installRequestSecurityMiddleware } = require("./runtime/request-security.middleware");
const registerRoutes = require("./register-routes");
const { parseBoolean } = require("../shared/validation/parse-boolean");
const colorSeed = require("../domains/colors/color-library.seed.json");
const fixtureSeed = require("../domains/fixtures/fixtures.seed.json");
const packageJson = require("../../package.json");
const DEFAULT_ROOT_DIR = path.resolve(__dirname, "../..");

const TWITCH_COLOR_CONFIG_DEFAULT = Object.freeze({
  version: 1,
  defaultTarget: "hue",
  autoDefaultTarget: true,
  prefixes: Object.freeze({
    hue: "",
    wiz: "wiz",
    other: ""
  }),
  fixturePrefixes: Object.freeze({}),
  raveOff: Object.freeze({
    enabled: true,
    defaultText: "random",
    groups: Object.freeze({}),
    fixtures: Object.freeze({})
  })
});

function clampHzLimit(rawValue, fallback = 16) {
  const parsed = Math.round(Number(rawValue));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(60, parsed));
}

function normalizePaletteMapperMode(rawValue, fallback = "strict") {
  const token = String(rawValue || "").trim().toLowerCase();
  if (token === "literal") return "strict";
  if (token === "strict" || token === "musical") return token;
  const fallbackToken = String(fallback || "").trim().toLowerCase();
  if (fallbackToken === "literal") return "strict";
  return fallbackToken === "musical" ? "musical" : "strict";
}

module.exports = function createServer(options = {}) {
  // [DEV] All path ownership is centralized here so downstream modules
  // [DEV] never hardcode filesystem locations.
  const rootDir = String(options.rootDir || DEFAULT_ROOT_DIR);
  const runtimeDir = path.join(rootDir, "runtime");
  const publicDir = path.join(rootDir, "public");
  const paths = {
    runtimeDir,
    publicDir,
    uiTemplateDir: path.join(publicDir, "templates", "index"),
    colorsStorePath: path.join(runtimeDir, "colors", "colors.custom.json"),
    fixturesStorePath: path.join(runtimeDir, "fixtures", "fixtures.json"),
    modsRootPath: path.join(rootDir, "mods"),
    modsConfigPath: path.join(rootDir, "mods", "mods.config.json"),
    twitchConfigPath: path.join(runtimeDir, "twitch", "twitch.color.config.json"),
    liveProfilesStorePath: path.join(runtimeDir, "live", "profiles.json"),
    liveCompatStorePath: path.join(runtimeDir, "live", "compat.state.json"),
    systemConfigStorePath: path.join(runtimeDir, "system", "config.json"),
    systemOauthVaultPath: path.join(runtimeDir, "system", "oauth.vault.json"),
    midiConfigStorePath: path.join(runtimeDir, "midi", "midi.config.json"),
    engineV2PalettePath: path.join(runtimeDir, "engine-v2", "palette.config.json"),
    audioConfigStorePath: path.join(runtimeDir, "audio", "audio.config.json"),
    audioReactivityStorePath: path.join(runtimeDir, "audio", "reactivity-map.json"),
    audioProfilesStorePath: path.join(runtimeDir, "audio", "profiles.json"),
    audioAppIsolationLocksStorePath: path.join(runtimeDir, "audio", "app-isolation-locks.json")
  };

  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  installRequestSecurityMiddleware(app, {
    express,
    allowRemoteWrite: parseBoolean(process.env.RAVELINK_ALLOW_REMOTE_WRITE, false),
    port: Number(process.env.PORT || 5050)
  });

  const colorLibrary = createColorLibraryService({
    storePath: paths.colorsStorePath,
    legacyStorePath: path.join(rootDir, "colors", "colors.json"),
    seedCustomColors: colorSeed,
    fuzzyMinScore: 180
  });
  const fixtureRegistry = createFixtureRegistry({
    storePath: paths.fixturesStorePath,
    seedConfig: fixtureSeed
  });
  const twitchColorConfig = createTwitchColorConfigRuntime({
    configPath: paths.twitchConfigPath,
    configDefault: TWITCH_COLOR_CONFIG_DEFAULT
  });
  const directiveService = createTwitchColorDirectiveService({
    colorLibrary,
    sanitizeText: twitchColorConfig.sanitizeCommandText
  });

  const dryRunTransport = parseBoolean(process.env.RAVELINK_DRY_RUN_TRANSPORT, false);
  // [DEV] Dry-run defaults to false so local launches use real hardware paths.
  // [DEV] Set RAVELINK_DRY_RUN_TRANSPORT=1 when running safe/no-hardware tests.
  const hueBridge = createHueBridgeAdapter({
    axios,
    dryRun: dryRunTransport,
    rootDir
  });
  const wizBridge = createWizBridgeAdapter({
    dryRun: dryRunTransport
  });

  let engineV2 = null;
  let modRuntime = null;
  const midiManager = createNoopMidiManager({
    storePath: paths.midiConfigStorePath,
    onAction(event = {}) {
      if (!engineV2 || typeof engineV2.queueControlEvent !== "function") return;
      engineV2.queueControlEvent({
        owner: "midi",
        type: "trigger_action",
        at: Number(event.at || Date.now()),
        payload: {
          action: String(event.action || "").trim().toLowerCase(),
          source: String(event.source || "").trim().toLowerCase(),
          message: event.message || null
        }
      });
    },
    log: console
  });
  const audioEngine = createAudioEnginePort();
  const audioRuntimeService = createAudioRuntimeService({
    configPath: paths.audioConfigStorePath,
    reactivityMapPath: paths.audioReactivityStorePath,
    profilesPath: paths.audioProfilesStorePath,
    appIsolationLocksPath: paths.audioAppIsolationLocksStorePath,
    audioEngine,
    log: console
  });
  const liveProfileService = createLiveProfileService({
    storePath: paths.liveProfilesStorePath
  });
  const liveCompatService = createLiveCompatService({
    storePath: paths.liveCompatStorePath
  });
  const systemConfigService = createSystemConfigService({
    storePath: paths.systemConfigStorePath,
    resolveAudioBackend: () => String(audioEngine.getStatus()?.backend || "unwired")
  });
  const internetGatewayRuntime = createInternetGatewayRuntime({
    rootDir,
    runtimeDir,
    policyPath: process.env.RAVELINK_INTERNET_GATEWAY_POLICY_PATH || path.join(runtimeDir, "system", "internet-gateway.policy.json"),
    enabled: parseBoolean(process.env.RAVELINK_INTERNET_GATEWAY_ENABLED, true),
    autoStart: parseBoolean(process.env.RAVELINK_INTERNET_GATEWAY_AUTOSTART, true),
    requestTimeoutMs: Number(process.env.RAVELINK_INTERNET_GATEWAY_REQUEST_TIMEOUT_MS || 8000),
    log: console
  });
  modRuntime = createNoopModRuntime({
    rootDir,
    modsRoot: paths.modsRootPath,
    configPath: paths.modsConfigPath,
    internetGatewayClient: internetGatewayRuntime,
    log: console
  });
  const systemUpdateService = createSystemUpdateService({
    rootDir,
    runtimeDir,
    getSystemConfig: () => systemConfigService.getConfig()?.config || {},
    currentVersion: String(options.currentVersion || packageJson.version || "0.0.0").trim(),
    repoOwner: process.env.RAVELINK_UPDATE_REPO_OWNER || "NameSRoby",
    repoName: process.env.RAVELINK_UPDATE_REPO_NAME || "ravelink-bridge",
    requestTimeoutMs: Number(process.env.RAVELINK_UPDATE_CHECK_TIMEOUT_MS || 4500),
    releaseMetadataPublicKeyPem: String(process.env.RAVELINK_UPDATE_METADATA_PUBLIC_KEY_PEM || ""),
    releaseMetadataPublicKeyPath: String(process.env.RAVELINK_UPDATE_METADATA_PUBLIC_KEY_PATH || ""),
    enforceMetadataSignature: parseBoolean(process.env.RAVELINK_UPDATE_ENFORCE_METADATA_SIGNATURE, false),
    enforceArchiveDigest: parseBoolean(process.env.RAVELINK_UPDATE_ENFORCE_ARCHIVE_DIGEST, false),
    log: console
  });
  const systemOauthService = createSystemOauthService({
    vaultPath: paths.systemOauthVaultPath,
    profileDefaults: {
      twitchClientId: String(process.env.RAVELINK_TWITCH_CLIENT_ID || "").trim(),
      twitchBroadcasterId: String(process.env.RAVELINK_TWITCH_BROADCASTER_ID || "").trim(),
      twitchUserAccessToken: String(process.env.RAVELINK_TWITCH_USER_ACCESS_TOKEN || "").trim(),
      twitchRefreshToken: String(process.env.RAVELINK_TWITCH_REFRESH_TOKEN || "").trim()
    },
    internetGatewayClient: internetGatewayRuntime,
    log: console
  });
  if (systemOauthService && typeof systemOauthService.startAutoReconcile === "function") {
    systemOauthService.startAutoReconcile({
      enabled: parseBoolean(process.env.RAVELINK_TWITCH_RECONCILE_ENABLED, true),
      status: String(process.env.RAVELINK_TWITCH_RECONCILE_STATUS || "FULFILLED").trim().toUpperCase(),
      intervalMs: Number(process.env.RAVELINK_TWITCH_RECONCILE_INTERVAL_MS || 45_000),
      maxRewards: Number(process.env.RAVELINK_TWITCH_RECONCILE_MAX_REWARDS || 100),
      maxRedemptions: Number(process.env.RAVELINK_TWITCH_RECONCILE_MAX_REDEMPTIONS || 200)
    });
  }
  const initialSystemConfig = systemConfigService.getConfig()?.config || {};
  const engineHardwareLimits = {
    hueMaxHz: clampHzLimit(
      initialSystemConfig.engineHueMaxHz ?? process.env.RAVELINK_ENGINE_HUE_MAX_HZ,
      16
    ),
    wizMaxHz: clampHzLimit(
      initialSystemConfig.engineWizMaxHz ?? process.env.RAVELINK_ENGINE_WIZ_MAX_HZ,
      16
    )
  };
  const enginePaletteMapperMode = normalizePaletteMapperMode(
    initialSystemConfig.enginePaletteMappingMode ?? process.env.RAVELINK_ENGINE_PALETTE_MAPPING_MODE,
    "strict"
  );
  if (audioRuntimeService && typeof audioRuntimeService.applyCaptureBackendStrategy === "function") {
    audioRuntimeService.applyCaptureBackendStrategy(
      initialSystemConfig.audioCaptureBackendStrategy || "auto_rust_first",
      {
        restartIfSessionActive: false,
        reason: "startup_system_config"
      }
    ).catch(error => {
      console.warn("[AUDIO] backend strategy apply failed:", error?.message || error);
    });
  }
  if (typeof hueBridge.setTransportMode === "function") {
    hueBridge.setTransportMode(initialSystemConfig.hueTransportPreference || "auto");
  }
  const startupReadinessService = createStartupReadinessService({
    services: {
      systemConfigService,
      liveProfileService,
      midiManager,
      fixtureRegistry,
      modRuntime
    }
  });
  const startupLaunchDiagnosticsService = createStartupLaunchDiagnosticsService();
  const enginePaletteService = createEnginePaletteService({
    storePath: paths.engineV2PalettePath
  });
  engineV2 = createEngineV2Runtime({
    audioEngine,
    fixtureRegistry,
    liveProfileService,
    liveCompatService,
    paletteService: enginePaletteService,
    hueBridge,
    wizBridge,
    hardwareLimits: engineHardwareLimits,
    paletteMapperMode: enginePaletteMapperMode,
    dryRunTransport: dryRunTransport !== false
  });
  const indexPageRenderer = createIndexPageRenderer({
    templateRoot: paths.uiTemplateDir
  });

  const colorCommandService = createColorCommandService({
    twitchColorConfig,
    fixtureRegistry,
    directiveService,
    hueBridge,
    wizBridge,
    // [DEV] Rave lock state is now telemetry-port owned instead of engine-owned.
    isRaveLocked: () => {
      const status = audioEngine.getRaveState();
      return status.active === true;
    },
    log: console
  });

  registerRoutes(app, {
    colorLibrary,
    fixtureRegistry,
    twitchColorConfig,
    colorCommandService,
    hueBridge,
    wizBridge,
    audioEngine,
    engineV2,
    enginePaletteService,
    midiManager,
    modRuntime,
    liveCompatService,
    audioRuntimeService,
    systemConfigService,
    internetGatewayRuntime,
    systemUpdateService,
    systemOauthService,
    liveProfileService,
    startupReadinessService,
    startupLaunchDiagnosticsService,
    requestSystemStop: options.requestSystemStop
  });

  // [DEV] Mod discovery is async because sandbox hook boot can be async; startup
  // [DEV] remains non-blocking and failures are surfaced in mods snapshot/error fields.
  modRuntime.load()
    .then(snapshot => {
      startupReadinessService.recordModsBootLoaded(snapshot);
    })
    .catch(error => {
      startupReadinessService.recordModsBootFailed(error);
      console.warn("[MOD] initial load failed:", error?.message || error);
    });

  // [DEV] Static file serving keeps index disabled so "/" and "/index.html"
  // [DEV] always return section-composed UI HTML, not a monolithic static page.
  app.get("/", (_req, res) => {
    res.type("html").send(indexPageRenderer.render());
  });

  app.get("/index.html", (_req, res) => {
    res.type("html").send(indexPageRenderer.render());
  });

  app.use(express.static(publicDir, { index: false }));

  return {
    app,
    paths,
    services: {
      colorLibrary,
      fixtureRegistry,
      twitchColorConfig,
      directiveService,
      colorCommandService,
      modRuntime,
      midiManager,
      audioEngine,
      engineV2,
      enginePaletteService,
      liveCompatService,
      audioRuntimeService,
      systemConfigService,
      internetGatewayRuntime,
      systemUpdateService,
      systemOauthService,
      liveProfileService,
      startupReadinessService,
      startupLaunchDiagnosticsService,
      indexPageRenderer
    },
    state: {
      // [DEV] Telemetry port owns rave session state while engine rebuild is pending.
      getRaveState() {
        const status = audioEngine.getRaveState();
        return {
          active: status.active === true,
          startedAt: Number(status.startedAt || 0),
          lastStoppedAt: Number(status.lastStoppedAt || 0)
        };
      }
    }
  };
};
