// [TITLE] Module: domains/audio/audio-runtime.service.js
// [TITLE] Purpose: compatibility audio runtime service for Audio tab contracts
// [TITLE] Functionality Index:
// [TITLE] - persist audio config/profiles/reactivity/app-isolation locks
// [TITLE] - expose device/app discovery snapshots for UI dropdown population
// [TITLE] - mirror app-isolation status into shared audio telemetry state

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { readJsonFile, writeJsonFile, cloneJsonSafe } = require("../../shared/fs/json-file-store");
const createAudioCaptureRuntime = require("./audio-capture.runtime");
const createRustTransportWorkerRuntime = require("./rust-transport-worker.runtime");
const createAudioRuntimeCatalog = require("./audio-runtime.catalog");
const createAudioRuntimeCaptureSession = require("./audio-runtime.capture-session");
const createAudioRuntimeDeviceDiscovery = require("./audio-runtime.device-discovery");
const createAudioRuntimeSessionConfig = require("./audio-runtime.session-config");
const createAudioRuntimeTelemetry = require("./audio-runtime.telemetry");
const {
  normalizeAppName,
  normalizeAppToken,
  normalizeBrowserChannelHint,
  tokenLooksBrowserLike,
  detectBrowserChannelHint,
  formatResolvedAppLabel,
  normalizeTokenList,
  sanitizeManualLockMap,
  normalizeProcessMetadataRows,
  filterManualLockMapForApps,
  resolveAppIsolationTargetSelection,
  buildCompanionMapFromAudioTokens,
  resolveRepresentativePidForToken
} = require("./audio-runtime.app-isolation");

const INPUT_BACKENDS = new Set(["auto", "ffmpeg", "portaudio", "rustloop"]);
const AUDIO_CAPTURE_BACKEND_STRATEGIES = new Set(["auto_rust_first", "force_rust"]);
const ENGINE_BACKEND_BY_INPUT = Object.freeze({
  auto: "unwired",
  ffmpeg: "legacy",
  portaudio: "legacy",
  rustloop: "rust"
});
const ALLOW_SIBLING_REPO_TOOLS = normalizeBool(process.env.RAVELINK_ALLOW_SIBLING_REPO_TOOLS, false);

const AUDIO_CONFIG_DEFAULT = Object.freeze({
  inputBackend: "auto",
  deviceMatch: "",
  deviceId: "",
  desktopOutputDeviceName: "",
  ffmpegPath: "ffmpeg",
  ffmpegInputFormat: "dshow",
  ffmpegInputDevice: "",
  ffmpegInputDevices: [],
  ffmpegAppIsolationEnabled: false,
  ffmpegAppIsolationStrict: false,
  ffmpegAppIsolationPrimaryApp: "",
  ffmpegAppIsolationFallbackApp: "",
  ffmpegAppIsolationPrimaryDevices: [],
  ffmpegAppIsolationFallbackDevices: [],
  ffmpegAppIsolationCheckMs: 300000,
  procTapLauncher: "py",
  procTapPythonVersion: "3.13",
  rustLoopbackPath: "ravelink-rust-audio-isolator.exe",
  rustLoopbackFormat: "f32le",
  rustLoopbackAutoFallbackProcTap: true,
  sampleRate: 96000,
  framesPerBuffer: 128,
  channels: 2,
  outputGain: 1,
  limiterThreshold: 0.82,
  limiterKnee: 0.16,
  restartMs: 1500,
  logEveryTicks: 60,
  updatedAt: 0
});

// [TITLE] Audio Capture Restart Keys
// [DEV] These keys alter capture source/backend/runtime behavior and must trigger
// [DEV] a session restart when changed while capture is active.
const AUDIO_CAPTURE_RESTART_KEYS = new Set([
  "inputBackend",
  "deviceMatch",
  "deviceId",
  "desktopOutputDeviceName",
  "ffmpegPath",
  "ffmpegInputFormat",
  "ffmpegInputDevice",
  "ffmpegInputDevices",
  "ffmpegAppIsolationEnabled",
  "ffmpegAppIsolationStrict",
  "ffmpegAppIsolationPrimaryApp",
  "ffmpegAppIsolationFallbackApp",
  "ffmpegAppIsolationPrimaryDevices",
  "ffmpegAppIsolationFallbackDevices",
  "ffmpegAppIsolationCheckMs",
  "procTapLauncher",
  "procTapPythonVersion",
  "rustLoopbackPath",
  "rustLoopbackFormat",
  "rustLoopbackAutoFallbackProcTap",
  "sampleRate",
  "framesPerBuffer",
  "channels",
  "restartMs"
]);
const APP_ISOLATION_CONFIG_KEYS = new Set([
  "ffmpegAppIsolationEnabled",
  "ffmpegAppIsolationStrict",
  "ffmpegAppIsolationPrimaryApp",
  "ffmpegAppIsolationFallbackApp",
  "ffmpegAppIsolationPrimaryDevices",
  "ffmpegAppIsolationFallbackDevices",
  "ffmpegAppIsolationCheckMs"
]);

const AUDIO_REACTIVITY_DEFAULT = Object.freeze({
  version: 1,
  reactivityGainMode: "auto",
  reactivityGain: 1,
  hardwareRateLimitsEnabled: true,
  metaAutoTempoTrackersAuto: false,
  metaAutoTempoTrackers: Object.freeze({
    baseline: true,
    peaks: true,
    transients: true,
    flux: true
  }),
  targets: Object.freeze({
    hue: Object.freeze({ enabled: true, amount: 1, sources: Object.freeze(["smart", "baseline", "bass"]) }),
    wiz: Object.freeze({ enabled: true, amount: 1, sources: Object.freeze(["smart", "baseline", "bass"]) }),
    other: Object.freeze({ enabled: true, amount: 1, sources: Object.freeze(["smart", "baseline", "bass"]) })
  }),
  sourceCatalog: Object.freeze({
    smart: Object.freeze({ label: "SMART", description: "Adaptive blend" }),
    baseline: Object.freeze({ label: "BASE", description: "Steady RMS/body" }),
    bass: Object.freeze({ label: "BASS", description: "Low band" })
  })
});

function normalizeString(value, max = 256) {
  return String(value || "").trim().slice(0, Math.max(1, Number(max) || 256));
}

function normalizeBool(value, fallback = false) {
  if (value === true || value === false) return value;
  const token = String(value || "").trim().toLowerCase();
  if (!token) return fallback === true;
  if (["1", "true", "yes", "on"].includes(token)) return true;
  if (["0", "false", "no", "off"].includes(token)) return false;
  return fallback === true;
}

function clamp(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number(fallback);
  return Math.min(Number(max), Math.max(Number(min), parsed));
}

function parseJson(raw = "") {
  try {
    return JSON.parse(String(raw || "").trim());
  } catch {
    return null;
  }
}

function valuesEquivalent(prevValue, nextValue) {
  const prevArray = Array.isArray(prevValue) ? prevValue : null;
  const nextArray = Array.isArray(nextValue) ? nextValue : null;
  if (prevArray && nextArray) {
    if (prevArray.length !== nextArray.length) return false;
    for (let i = 0; i < prevArray.length; i += 1) {
      if (JSON.stringify(prevArray[i]) !== JSON.stringify(nextArray[i])) return false;
    }
    return true;
  }
  return JSON.stringify(prevValue) === JSON.stringify(nextValue);
}
function parseProcTapAudioProcessLine(lineRaw = "") {
  const line = String(lineRaw || "").trim();
  if (!line) return null;
  const match = line.match(/^(\d+)\s+(.+)$/);
  if (!match || !match[2]) return null;
  const pid = Math.max(0, Number(match[1] || 0));
  if (!(pid > 0)) return null;
  const remainder = String(match[2] || "").trim();
  if (!remainder) return null;
  const fragments = remainder.match(/"[^"]+"|\S+/g) || [];
  for (const fragmentRaw of fragments) {
    const fragment = String(fragmentRaw || "").trim().replace(/^"(.*)"$/g, "$1");
    if (!fragment) continue;
    const basename = fragment.replace(/^.*[\\/]/g, "");
    if (!basename) continue;
    if (!/^[a-z0-9._\-\s]+(?:\.exe)?$/i.test(basename)) continue;
    const token = normalizeAppToken(basename);
    if (!token) continue;
    return {
      pid,
      token,
      name: `${token}.exe`
    };
  }
  return null;
}

function listProcTapAudioProcessesSync(runtimeConfig = {}) {
  if (process.platform !== "win32") {
    return {
      ok: false,
      toolAvailable: false,
      source: "unsupported_platform",
      processes: [],
      audioTokens: [],
      error: "unsupported_platform"
    };
  }

  const launcher = normalizePathToken(runtimeConfig.procTapLauncher || "py") || "py";
  const preferredPyVersion = normalizeString(runtimeConfig.procTapPythonVersion || "3.13", 16) || "3.13";
  const pyVersionCandidates = launcher.toLowerCase() === "py"
    ? dedupeStringList([preferredPyVersion, "3.14", "3.13", "3.12", "3.11", "3.10"])
    : [""];

  const buildCommandArgs = pyVersion => {
    const args = [];
    if (launcher.toLowerCase() === "py" && pyVersion) {
      args.push(`-${pyVersion}`);
    }
    args.push("-m", "proctap", "--list-audio-procs");
    return args;
  };

  let lastError = "";
  for (const pyVersion of pyVersionCandidates) {
    const args = buildCommandArgs(pyVersion);
    try {
      const probe = spawnSync(launcher, args, {
        windowsHide: true,
        timeout: 2800,
        encoding: "utf8",
        maxBuffer: 1024 * 1024
      });
      const stderrText = normalizeString(probe?.stderr || "", 1024);
      const stdoutText = String(probe?.stdout || "");
      const lines = stdoutText.split(/\r?\n/g);
      const processes = [];
      for (const lineRaw of lines) {
        const parsed = parseProcTapAudioProcessLine(lineRaw);
        if (!parsed) continue;
        processes.push(parsed);
      }
      const deduped = [];
      const seen = new Set();
      for (const row of processes) {
        const key = `${row.token}:${Math.max(0, Number(row.pid || 0))}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(row);
      }
      const audioTokens = normalizeTokenList(deduped.map(row => row.token), 256);
      const probeStatus = Number(probe?.status);
      const probeToolAvailable = !probe?.error && (probeStatus === 0 || Number.isNaN(probeStatus));
      if (audioTokens.length > 0) {
        return {
          ok: true,
          toolAvailable: true,
          source: "proctap_audio_processes",
          processes: deduped,
          audioTokens,
          error: ""
        };
      }
      if (probeToolAvailable) {
        return {
          ok: false,
          toolAvailable: true,
          source: "proctap_audio_processes",
          processes: [],
          audioTokens: [],
          error: ""
        };
      }
      lastError = stderrText || normalizeString(probe?.error?.message || "", 256) || `probe_exit_${String(probe?.status ?? "null")}`;
    } catch (error) {
      lastError = normalizeString(error?.message || error || "proctap_probe_failed", 256);
    }
  }

  return {
    ok: false,
    toolAvailable: false,
    source: "window_activity",
    processes: [],
    audioTokens: [],
    error: lastError || "proctap_audio_probe_unavailable"
  };
}

function runPowerShellJson(command = "", timeoutMs = 4000) {
  if (process.platform !== "win32") return null;
  try {
    const stdout = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", String(command || "")],
      { encoding: "utf8", windowsHide: true, timeout: Math.max(600, Number(timeoutMs) || 4000), maxBuffer: 8 * 1024 * 1024 }
    );
    return parseJson(stdout);
  } catch {
    return null;
  }
}

function runPowerShellText(command = "", timeoutMs = 2500) {
  if (process.platform !== "win32") return "";
  try {
    const stdout = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", String(command || "")],
      { encoding: "utf8", windowsHide: true, timeout: Math.max(500, Number(timeoutMs) || 2500), maxBuffer: 2 * 1024 * 1024 }
    );
    return normalizeString(stdout, 512);
  } catch {
    return "";
  }
}

function normalizeCaptureBackendStrategy(value = "") {
  const token = normalizeString(value, 64).toLowerCase();
  return AUDIO_CAPTURE_BACKEND_STRATEGIES.has(token) ? token : "auto_rust_first";
}

function normalizePathToken(value = "") {
  return String(value || "").trim();
}

function hasPathSegment(value = "") {
  const token = normalizePathToken(value);
  if (!token) return false;
  return /[\\/]/.test(token) || token.includes(":");
}

function probeCommandToken(command = "", args = ["--version"], timeoutMs = 1800) {
  const token = normalizePathToken(command);
  if (!token) return { reached: false, ok: false };
  try {
    const result = spawnSync(token, Array.isArray(args) ? args : ["--version"], {
      windowsHide: true,
      encoding: "utf8",
      timeout: Math.max(400, Math.round(Number(timeoutMs) || 1800)),
      stdio: "pipe"
    });
    const failedBySpawn = Boolean(result?.error && String(result.error.code || "").toUpperCase() === "ENOENT");
    const reached = !failedBySpawn;
    const ok = reached && Number(result?.status) === 0;
    return { reached, ok };
  } catch {
    return { reached: false, ok: false };
  }
}

function resolveExistingCommandOrPath(candidates = [], options = {}) {
  const timeoutMs = Math.max(500, Math.round(Number(options.timeoutMs) || 1800));
  for (const rawCandidate of Array.isArray(candidates) ? candidates : []) {
    const candidate = normalizePathToken(rawCandidate);
    if (!candidate) continue;
    if (hasPathSegment(candidate)) {
      const absolutePath = path.isAbsolute(candidate)
        ? candidate
        : path.resolve(String(options.cwd || process.cwd()), candidate);
      if (fs.existsSync(absolutePath)) {
        return {
          available: true,
          path: absolutePath,
          source: "path"
        };
      }
      continue;
    }
    const probe = probeCommandToken(candidate, ["--version"], timeoutMs);
    if (probe.reached) {
      return {
        available: true,
        path: candidate,
        source: probe.ok ? "path_command_ok" : "path_command_reached"
      };
    }
  }
  return {
    available: false,
    path: "",
    source: "missing"
  };
}

function dedupeStringList(values = []) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const token = normalizePathToken(value);
    if (!token) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}

function parseFirstJsonLine(raw = "") {
  const lines = String(raw || "")
    .split(/\r?\n/g)
    .map(line => String(line || "").trim())
    .filter(Boolean);
  for (const line of lines) {
    try {
      return JSON.parse(line);
    } catch {
      // keep scanning
    }
  }
  return null;
}

function buildRustToolPathCandidates(config = {}, options = {}) {
  const source = config && typeof config === "object" ? config : {};
  const rootDir = normalizePathToken(options.rootDir || "");
  const rootParentDir = rootDir ? path.dirname(rootDir) : "";
  const siblingRepoRoots = ALLOW_SIBLING_REPO_TOOLS
    ? (() => {
      if (!rootParentDir) return [];
      try {
        const currentBase = path.basename(rootDir).toLowerCase();
        return fs.readdirSync(rootParentDir, { withFileTypes: true })
          .filter(entry => entry && entry.isDirectory && entry.isDirectory())
          .map(entry => String(entry.name || "").trim())
          .filter(name => /^RaveLink-Bridge-Windows-v/i.test(name))
          .filter(name => name.toLowerCase() !== currentBase)
          .map(name => path.join(rootParentDir, name));
      } catch {
        return [];
      }
    })()
    : [];
  const envLoop = normalizePathToken(process.env.RAVE_AUDIO_RUST_LOOPBACK_PATH || "");
  const envKernel = normalizePathToken(process.env.RAVE_AUDIO_RUST_KERNEL_PATH || "");
  const envResolver = normalizePathToken(process.env.RAVE_AUDIO_RUST_SOURCE_RESOLVER_PATH || "");
  const rootLoop = rootDir ? path.join(rootDir, "ravelink-rust-audio-isolator.exe") : "";
  const rootKernel = rootDir ? path.join(rootDir, "ravelink-audio-kernel.exe") : "";
  const rootResolver = rootDir ? path.join(rootDir, "ravelink-source-resolver.exe") : "";
  const bundledLoop = rootDir
    ? [
      path.join(rootDir, "runtime", "tools", "rust-audio-isolator", "ravelink-rust-audio-isolator.exe"),
      path.join(rootDir, "runtime", "tools", "rust-runtime", "ravelink-rust-audio-isolator.exe")
    ]
    : [];
  const bundledKernel = rootDir
    ? [
      path.join(rootDir, "runtime", "tools", "rust-runtime", "ravelink-audio-kernel.exe")
    ]
    : [];
  const bundledResolver = rootDir
    ? [
      path.join(rootDir, "runtime", "tools", "rust-runtime", "ravelink-source-resolver.exe")
    ]
    : [];
  const siblingLoop = siblingRepoRoots.map(repoRoot =>
    path.join(repoRoot, "runtime", "tools", "rust-audio-isolator", "ravelink-rust-audio-isolator.exe")
  );
  const siblingKernel = siblingRepoRoots.map(repoRoot =>
    path.join(repoRoot, "runtime", "tools", "rust-runtime", "ravelink-audio-kernel.exe")
  );
  const siblingResolver = siblingRepoRoots.map(repoRoot =>
    path.join(repoRoot, "runtime", "tools", "rust-runtime", "ravelink-source-resolver.exe")
  );
  return {
    loopback: dedupeStringList([
      envLoop,
      normalizePathToken(source.rustLoopbackPath || ""),
      ...bundledLoop,
      ...siblingLoop,
      rootLoop,
      "ravelink-rust-audio-isolator.exe"
    ]),
    kernel: dedupeStringList([
      envKernel,
      normalizePathToken(source.rustAudioKernelPath || ""),
      ...bundledKernel,
      ...siblingKernel,
      rootKernel,
      "ravelink-audio-kernel.exe"
    ]),
    resolver: dedupeStringList([
      envResolver,
      normalizePathToken(source.rustSourceResolverPath || ""),
      ...bundledResolver,
      ...siblingResolver,
      rootResolver,
      "ravelink-source-resolver.exe"
    ])
  };
}

function sanitizeReasonToken(value, fallback = "api_request") {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return fallback;
  const token = raw.replace(/[^a-z0-9_-]+/g, "_").slice(0, 64);
  return token || fallback;
}

function detectRustCaptureRuntimeAvailability(config = {}, options = {}) {
  const candidates = buildRustToolPathCandidates(config, options);
  const loop = resolveExistingCommandOrPath(candidates.loopback, options);
  const kernel = resolveExistingCommandOrPath(candidates.kernel, options);
  const resolver = resolveExistingCommandOrPath(candidates.resolver, options);
  return {
    available: loop.available || kernel.available,
    loopback: loop.available,
    loopbackPath: loop.path,
    loopbackSource: loop.source,
    kernel: kernel.available,
    kernelPath: kernel.path,
    kernelSource: kernel.source,
    resolver: resolver.available,
    resolverPath: resolver.path,
    resolverSource: resolver.source
  };
}

module.exports = function createAudioRuntimeService(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const setTimeoutFn = typeof options.setTimeout === "function" ? options.setTimeout : setTimeout;
  const clearTimeoutFn = typeof options.clearTimeout === "function" ? options.clearTimeout : clearTimeout;
  const audioEngine = options.audioEngine || {};
  const configPath = normalizeString(options.configPath, 512);
  const reactivityPath = normalizeString(options.reactivityMapPath, 512);
  const profilesPath = normalizeString(options.profilesPath, 512);
  const locksPath = normalizeString(options.appIsolationLocksPath, 512);
  if (!configPath || !reactivityPath || !profilesPath || !locksPath) {
    throw new Error("audio runtime service requires config/reactivity/profiles/locks paths");
  }
  const runtimeDir = path.dirname(path.dirname(configPath));
  const rootDir = path.dirname(runtimeDir);
  const deviceDiscovery = createAudioRuntimeDeviceDiscovery({
    normalizeString,
    dedupeStringList,
    runPowerShellJson,
    runPowerShellText,
    parseFirstJsonLine,
    detectRustCaptureRuntimeAvailability,
    rootDir
  });
  const rustTransportWorkerRuntime = createRustTransportWorkerRuntime({
    rootDir,
    now,
    log: options.log || console
  });

  let config = { ...AUDIO_CONFIG_DEFAULT };
  let reactivity = cloneJsonSafe(AUDIO_REACTIVITY_DEFAULT, {});
  let profiles = { profiles: [] };
  let locks = { locks: {} };
  let cacheApps = { at: 0, payload: { ok: true, apps: [], processMetadata: [], audioHints: { source: "proctap_audio_processes", audioOnly: false, audioTokens: [], companionMap: {} } } };
  let cacheDevices = { at: 0, payload: { ok: true, devices: [], defaultOutputEndpointHint: { name: "" } } };
  let rustTransportWorker = {
    enabled: true,
    running: false,
    autoStart: true,
    adapterPreference: "auto",
    watchdogMs: 2500,
    restartBackoffMs: 1200,
    lastReason: "boot",
    lastStartedAt: 0,
    lastStoppedAt: 0,
    lastRestartAt: 0,
    telemetry: {
      lastAdapterCatalog: null,
      lastWatchdog: null
    },
    updatedAt: Number(now() || Date.now())
  };
  let captureSession = {
    active: false,
    lastStartedAt: 0,
    lastStoppedAt: 0,
    reason: "boot",
    updatedAt: Number(now() || Date.now())
  };
  const APP_ISOLATION_RECOVERY_BASE_MS = 3000;
  const APP_ISOLATION_RECOVERY_MAX_MS = 120000;
  let appIsolationLifecycle = {
    armed: false,
    lastSelectionKey: "",
    lastScanAt: 0,
    lastError: "",
    intervalTimer: null,
    intervalInFlight: false,
    recoveryTimer: null,
    recoveryDelayMs: APP_ISOLATION_RECOVERY_BASE_MS,
    scanPromise: null
  };
  const captureRuntime = createAudioCaptureRuntime({
    now,
    log: options.log || console,
    onTelemetry(metrics = {}) {
      const metricMap = metrics && typeof metrics === "object" ? metrics : {};
      if (typeof audioEngine.setTelemetry === "function") {
        audioEngine.setTelemetry({
          running: captureSession.active === true,
          level: clamp(metricMap.level, 0, 1, 0),
          levelRaw: clamp(metricMap.levelRaw, 0, 2, 0),
          rms: clamp(metricMap.rms, 0, 1, 0),
          audioRms: clamp(metricMap.rms, 0, 1, 0),
          audioSourceLevel: clamp(metricMap.level, 0, 1, 0),
          peak: clamp(metricMap.peak, 0, 1, 0),
          transient: clamp(metricMap.transient, 0, 1, 0),
          spectralFlux: clamp(metricMap.spectralFlux, 0, 1, 0),
          flux: clamp(metricMap.spectralFlux, 0, 1, 0),
          zcr: clamp(metricMap.zcr, 0, 1, 0),
          bandLow: clamp(metricMap.bandLow, 0, 1, 0),
          bandMid: clamp(metricMap.bandMid, 0, 1, 0),
          bandHigh: clamp(metricMap.bandHigh, 0, 1, 0),
          energy: clamp(metricMap.energy, 0, 1, 0),
          beat: metricMap.beat === true,
          beatConfidence: clamp(metricMap.beatConfidence, 0, 1, 0),
          bpm: Math.round(clamp(metricMap.bpm, 0, 260, 0)),
          device: normalizeString(metricMap.sourceDevice || metricMap.source || config.desktopOutputDeviceName || "-", 256) || "-"
        });
      }
    }
  });
  const captureSessionRuntime = createAudioRuntimeCaptureSession({
    normalizeString,
    normalizePathToken,
    normalizeCaptureBackendStrategy,
    detectRustCaptureRuntimeAvailability,
    probeCommandToken,
    cloneJsonSafe,
    sanitizeReasonToken,
    now,
    inputBackends: INPUT_BACKENDS,
    getConfig: () => config,
    setConfig: next => {
      config = next && typeof next === "object" ? next : config;
    },
    persistAll,
    getCaptureSession: () => captureSession,
    setCaptureSession: next => {
      captureSession = next && typeof next === "object" ? next : captureSession;
    },
    audioEngine,
    captureRuntime,
    setAppIsolationLifecycleArmed,
    getApps: options => getApps(options),
    buildTelemetry: (...args) => buildTelemetry(...args),
    resolveInputBackendSelection,
    applyEngineBackend,
    startSession,
    rootDir
  });
  const {
    buildCaptureSessionSnapshot,
    resolveBackendSelectionForStrategy,
    stopSession,
    applyCaptureBackendStrategy
  } = captureSessionRuntime;
  const audioCatalog = createAudioRuntimeCatalog({
    normalizeString,
    cloneJsonSafe,
    normalizeAppName,
    normalizeAppToken,
    normalizeTokenList,
    tokenLooksBrowserLike,
    detectBrowserChannelHint,
    buildCompanionMapFromAudioTokens,
    runPowerShellJson,
    listProcTapAudioProcessesSync,
    now,
    getConfig: () => config,
    getCacheApps: () => cacheApps,
    setCacheApps: next => {
      cacheApps = next && typeof next === "object" ? next : cacheApps;
    },
    audioEngine
  });
  const {
    resolveFallbackOutputDeviceName,
    getApps
  } = audioCatalog;
  const audioRuntimeSessionConfig = createAudioRuntimeSessionConfig({
    normalizeString,
    normalizeAppToken,
    detectRustCaptureRuntimeAvailability,
    resolveAppIsolationTargetToken,
    resolveRepresentativePidForToken,
    deviceDiscovery,
    rootDir
  });
  const { buildEffectiveStartSessionConfig } = audioRuntimeSessionConfig;
  const audioRuntimeTelemetry = createAudioRuntimeTelemetry({
    normalizeString,
    normalizeAppName,
    normalizeAppToken,
    clamp,
    getConfig: () => config,
    buildCaptureSessionSnapshot,
    captureRuntime,
    resolveInputBackendSelection,
    resolveAppIsolationTargetToken,
    getLocks: () => locks.locks || {},
    audioEngine
  });
  const { buildTelemetry } = audioRuntimeTelemetry;

  function persistAll() {
    writeJsonFile(configPath, config);
    writeJsonFile(reactivityPath, reactivity);
    writeJsonFile(profilesPath, profiles);
    writeJsonFile(locksPath, locks);
  }

  function loadAll() {
    const rawConfig = readJsonFile(configPath, AUDIO_CONFIG_DEFAULT);
    config = {
      ...AUDIO_CONFIG_DEFAULT,
      ...(rawConfig && typeof rawConfig === "object" ? rawConfig : {}),
      inputBackend: INPUT_BACKENDS.has(String(rawConfig?.inputBackend || "auto").trim().toLowerCase())
        ? String(rawConfig.inputBackend).trim().toLowerCase()
        : "auto",
      ffmpegAppIsolationEnabled: normalizeBool(rawConfig?.ffmpegAppIsolationEnabled, false),
      ffmpegAppIsolationStrict: normalizeBool(rawConfig?.ffmpegAppIsolationStrict, false),
      ffmpegAppIsolationCheckMs: Math.round(clamp(rawConfig?.ffmpegAppIsolationCheckMs, 1000, 3600000, 300000)),
      procTapLauncher: normalizeString(rawConfig?.procTapLauncher || "py", 32) || "py",
      procTapPythonVersion: normalizeString(rawConfig?.procTapPythonVersion || "3.13", 32) || "3.13",
      rustLoopbackPath: normalizeString(rawConfig?.rustLoopbackPath || "ravelink-rust-audio-isolator.exe", 512)
        || "ravelink-rust-audio-isolator.exe",
      rustLoopbackFormat: normalizeString(rawConfig?.rustLoopbackFormat || "f32le", 16).toLowerCase() || "f32le",
      rustLoopbackAutoFallbackProcTap: normalizeBool(rawConfig?.rustLoopbackAutoFallbackProcTap, true),
      sampleRate: Math.round(clamp(rawConfig?.sampleRate, 8000, 384000, 96000)),
      framesPerBuffer: Math.round(clamp(rawConfig?.framesPerBuffer, 32, 4096, 128)),
      channels: Math.round(clamp(rawConfig?.channels, 1, 8, 2)),
      outputGain: clamp(rawConfig?.outputGain, 0, 4, 1),
      limiterThreshold: clamp(rawConfig?.limiterThreshold, 0, 1, 0.82),
      limiterKnee: clamp(rawConfig?.limiterKnee, 0, 1, 0.16),
      restartMs: Math.round(clamp(rawConfig?.restartMs, 250, 60000, 1500)),
      logEveryTicks: Math.round(clamp(rawConfig?.logEveryTicks, 1, 6000, 60)),
      updatedAt: Number(now() || Date.now())
    };
    delete config.restart;
    delete config.apply;
    delete config.reason;
    reactivity = {
      ...cloneJsonSafe(AUDIO_REACTIVITY_DEFAULT, {}),
      ...(readJsonFile(reactivityPath, AUDIO_REACTIVITY_DEFAULT) || {})
    };
    const rawProfiles = readJsonFile(profilesPath, { profiles: [] });
    profiles = { profiles: Array.isArray(rawProfiles?.profiles) ? rawProfiles.profiles : [] };
    const rawLocks = readJsonFile(locksPath, { locks: {} });
    locks = {
      locks: sanitizeManualLockMap(
        rawLocks?.locks && typeof rawLocks.locks === "object"
          ? rawLocks.locks
          : {}
      )
    };
    persistAll();
  }

  function normalizeRustTransportWorkerStatePatch(patch = {}) {
    const source = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
    return {
      enabled: source.enabled === undefined ? rustTransportWorker.enabled : normalizeBool(source.enabled, rustTransportWorker.enabled),
      autoStart: source.autoStart === undefined ? rustTransportWorker.autoStart : normalizeBool(source.autoStart, rustTransportWorker.autoStart),
      adapterPreference: normalizeString(
        source.adapterPreference === undefined ? rustTransportWorker.adapterPreference : source.adapterPreference,
        64
      ).toLowerCase() || "auto",
      watchdogMs: Math.round(clamp(source.watchdogMs, 250, 30000, rustTransportWorker.watchdogMs)),
      restartBackoffMs: Math.round(clamp(source.restartBackoffMs, 100, 60000, rustTransportWorker.restartBackoffMs))
    };
  }

  function buildRustTransportWorkerStatus() {
    if (rustTransportWorkerRuntime && typeof rustTransportWorkerRuntime.getStatus === "function") {
      return rustTransportWorkerRuntime.getStatus();
    }
    return {
      available: true,
      enabled: rustTransportWorker.enabled === true,
      running: rustTransportWorker.running === true,
      autoStart: rustTransportWorker.autoStart === true,
      adapterPreference: String(rustTransportWorker.adapterPreference || "auto"),
      watchdogMs: Math.max(250, Number(rustTransportWorker.watchdogMs || 2500)),
      restartBackoffMs: Math.max(100, Number(rustTransportWorker.restartBackoffMs || 1200)),
      lastReason: String(rustTransportWorker.lastReason || ""),
      lastStartedAt: Number(rustTransportWorker.lastStartedAt || 0),
      lastStoppedAt: Number(rustTransportWorker.lastStoppedAt || 0),
      lastRestartAt: Number(rustTransportWorker.lastRestartAt || 0),
      telemetry: cloneJsonSafe(rustTransportWorker.telemetry || {}, {
        lastAdapterCatalog: null,
        lastWatchdog: null
      }),
      updatedAt: Number(rustTransportWorker.updatedAt || 0)
    };
  }

  function requestRustTransportWorkerAdapterCatalog() {
    if (rustTransportWorkerRuntime && typeof rustTransportWorkerRuntime.requestAdapterCatalog === "function") {
      return rustTransportWorkerRuntime.requestAdapterCatalog() === true;
    }
    const devices = getDevices();
    const rows = Array.isArray(devices?.devices) ? devices.devices : [];
    const adapters = [];
    for (const row of rows.slice(0, 24)) {
      const id = normalizeString(row?.id || "", 64);
      const name = normalizeString(row?.name || "", 192);
      if (!id && !name) continue;
      adapters.push({
        id: id || name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 64),
        name: name || id,
        backend: normalizeString(row?.backend || "unknown", 64).toLowerCase() || "unknown",
        active: row?.active !== false
      });
    }
    rustTransportWorker.telemetry.lastAdapterCatalog = {
      generatedAt: Number(now() || Date.now()),
      adapters
    };
    rustTransportWorker.updatedAt = Number(now() || Date.now());
    return true;
  }

  function requestRustTransportWorkerWatchdogSnapshot() {
    if (rustTransportWorkerRuntime && typeof rustTransportWorkerRuntime.requestWatchdogSnapshot === "function") {
      return rustTransportWorkerRuntime.requestWatchdogSnapshot() === true;
    }
    const nowMs = Number(now() || Date.now());
    rustTransportWorker.telemetry.lastWatchdog = {
      generatedAt: nowMs,
      running: rustTransportWorker.running === true,
      enabled: rustTransportWorker.enabled === true,
      heartbeatOk: rustTransportWorker.running === true,
      restartBackoffMs: Math.max(100, Number(rustTransportWorker.restartBackoffMs || 1200)),
      watchdogMs: Math.max(250, Number(rustTransportWorker.watchdogMs || 2500)),
      detail: rustTransportWorker.running === true
        ? "worker_running"
        : "worker_idle"
    };
    rustTransportWorker.updatedAt = nowMs;
    return true;
  }

  function setRustTransportWorkerConfig(patch = {}, options = {}) {
    if (rustTransportWorkerRuntime && typeof rustTransportWorkerRuntime.setConfig === "function") {
      return rustTransportWorkerRuntime.setConfig(patch, options);
    }
    const next = normalizeRustTransportWorkerStatePatch(patch);
    rustTransportWorker = {
      ...rustTransportWorker,
      ...next,
      updatedAt: Number(now() || Date.now())
    };
    if (rustTransportWorker.enabled !== true) {
      rustTransportWorker.running = false;
      rustTransportWorker.lastStoppedAt = Number(now() || Date.now());
      rustTransportWorker.lastReason = "config_disabled";
    } else if (options.autoStartIfEnabled === true && rustTransportWorker.autoStart === true) {
      rustTransportWorker.running = true;
      rustTransportWorker.lastStartedAt = Number(now() || Date.now());
      rustTransportWorker.lastReason = "config_autostart";
    }
    requestRustTransportWorkerAdapterCatalog();
    requestRustTransportWorkerWatchdogSnapshot();
    return buildRustTransportWorkerStatus();
  }

  function startRustTransportWorker(meta = {}) {
    if (rustTransportWorkerRuntime && typeof rustTransportWorkerRuntime.start === "function") {
      return rustTransportWorkerRuntime.start(meta);
    }
    const at = Number(now() || Date.now());
    if (rustTransportWorker.enabled !== true) {
      rustTransportWorker.enabled = true;
    }
    rustTransportWorker.running = true;
    rustTransportWorker.lastStartedAt = at;
    rustTransportWorker.lastReason = sanitizeReasonToken(meta.reason, "api_start");
    rustTransportWorker.updatedAt = at;
    requestRustTransportWorkerWatchdogSnapshot();
    return buildRustTransportWorkerStatus();
  }

  function stopRustTransportWorker(meta = {}) {
    if (rustTransportWorkerRuntime && typeof rustTransportWorkerRuntime.stop === "function") {
      return rustTransportWorkerRuntime.stop(meta);
    }
    const at = Number(now() || Date.now());
    rustTransportWorker.running = false;
    if (normalizeBool(meta.disable, false) === true) {
      rustTransportWorker.enabled = false;
    }
    rustTransportWorker.lastStoppedAt = at;
    rustTransportWorker.lastReason = sanitizeReasonToken(meta.reason, "api_stop");
    rustTransportWorker.updatedAt = at;
    requestRustTransportWorkerWatchdogSnapshot();
    return buildRustTransportWorkerStatus();
  }

  function restartRustTransportWorker(meta = {}) {
    if (rustTransportWorkerRuntime && typeof rustTransportWorkerRuntime.restart === "function") {
      return rustTransportWorkerRuntime.restart(meta);
    }
    const at = Number(now() || Date.now());
    rustTransportWorker.running = true;
    rustTransportWorker.enabled = true;
    rustTransportWorker.lastRestartAt = at;
    rustTransportWorker.lastStartedAt = at;
    rustTransportWorker.lastReason = sanitizeReasonToken(meta.reason, "api_restart");
    rustTransportWorker.updatedAt = at;
    requestRustTransportWorkerAdapterCatalog();
    requestRustTransportWorkerWatchdogSnapshot();
    return buildRustTransportWorkerStatus();
  }

  function applyEngineBackend() {
    const selection = resolveInputBackendSelection();
    const engineBackend = ENGINE_BACKEND_BY_INPUT[selection.selectedBackend] || "unwired";
    if (typeof audioEngine.setBackend === "function") audioEngine.setBackend(engineBackend);
    return {
      configuredBackend: selection.configuredBackend,
      selectedBackend: selection.selectedBackend,
      reason: selection.reason,
      engineBackend
    };
  }

  function resolveInputBackendSelection() {
    const configuredBackend = INPUT_BACKENDS.has(String(config.inputBackend || "auto").trim().toLowerCase())
      ? String(config.inputBackend || "auto").trim().toLowerCase()
      : "auto";
    if (configuredBackend !== "auto") {
      return {
        configuredBackend,
        selectedBackend: configuredBackend,
        reason: "configured_backend"
      };
    }
    const rustRuntime = detectRustCaptureRuntimeAvailability(config, { rootDir });
    if (rustRuntime.available) {
      return {
        configuredBackend,
        selectedBackend: "rustloop",
        reason: rustRuntime.loopback ? "auto_rustloop_available" : "auto_rust_kernel_available"
      };
    }
    return {
      configuredBackend,
      selectedBackend: "ffmpeg",
      reason: "auto_rust_unavailable_fallback_ffmpeg"
    };
  }

  function resolveAppIsolationTargetToken(runtimeConfig = {}, appsPayload = {}, lockMap = {}) {
    return resolveAppIsolationTargetSelection(
      runtimeConfig,
      appsPayload,
      filterManualLockMapForApps(lockMap, appsPayload)
    );
  }

  function buildIsolationSelectionKey(selection = {}) {
    const devices = Array.isArray(selection?.resolvedDevices)
      ? selection.resolvedDevices.map(value => normalizeString(value, 256).toLowerCase()).filter(Boolean)
      : [];
    return [
      normalizeAppToken(selection?.selectedSourceToken || ""),
      normalizeAppToken(selection?.captureToken || ""),
      normalizeString(selection?.selectedMode || "", 48).toLowerCase(),
      devices.join("||"),
      selection?.running === true ? "1" : "0"
    ].join("|");
  }

  function stopAppIsolationRecoveryTimer(options = {}) {
    if (appIsolationLifecycle.recoveryTimer) {
      clearTimeoutFn(appIsolationLifecycle.recoveryTimer);
      appIsolationLifecycle.recoveryTimer = null;
    }
    if (options.resetBackoff !== false) {
      appIsolationLifecycle.recoveryDelayMs = APP_ISOLATION_RECOVERY_BASE_MS;
    }
  }

  function stopAppIsolationTimer(options = {}) {
    if (appIsolationLifecycle.intervalTimer) {
      clearTimeoutFn(appIsolationLifecycle.intervalTimer);
      appIsolationLifecycle.intervalTimer = null;
    }
    appIsolationLifecycle.intervalInFlight = false;
    stopAppIsolationRecoveryTimer({
      resetBackoff: options.resetBackoff !== false
    });
  }

  function setAppIsolationLifecycleArmed(nextArmed, options = {}) {
    const armed = nextArmed === true;
    appIsolationLifecycle.armed = armed;
    if (!armed) {
      appIsolationLifecycle.lastSelectionKey = "";
      appIsolationLifecycle.lastError = "";
      appIsolationLifecycle.lastScanAt = 0;
      stopAppIsolationTimer({
        resetBackoff: options.resetBackoff !== false
      });
    }
  }

  function scheduleAppIsolationRecoveryScan(reason = "recovery", options = {}) {
    if (config.ffmpegAppIsolationEnabled !== true || appIsolationLifecycle.armed !== true) return false;
    if (appIsolationLifecycle.recoveryTimer) return false;
    if (options.resetBackoff === true) {
      appIsolationLifecycle.recoveryDelayMs = APP_ISOLATION_RECOVERY_BASE_MS;
    }
    const delayMs = Math.round(clamp(
      options.delayMs,
      800,
      APP_ISOLATION_RECOVERY_MAX_MS,
      appIsolationLifecycle.recoveryDelayMs
    ));
    const reasonToken = sanitizeReasonToken(reason, "recovery");
    appIsolationLifecycle.recoveryTimer = setTimeoutFn(async () => {
      appIsolationLifecycle.recoveryTimer = null;
      if (config.ffmpegAppIsolationEnabled !== true || appIsolationLifecycle.armed !== true) return;
      try {
        const result = await runAppIsolationScanInternal({
          reason: `${reasonToken}_retry`,
          allowRestart: true,
          forceRefreshApps: true,
          force: true
        });
        const awaitingApp = String(result?.isolation?.selectedMode || "").trim().toLowerCase() === "awaiting_app";
        if (awaitingApp) {
          appIsolationLifecycle.recoveryDelayMs = Math.round(clamp(
            Math.round(delayMs * 1.4),
            APP_ISOLATION_RECOVERY_BASE_MS,
            APP_ISOLATION_RECOVERY_MAX_MS,
            APP_ISOLATION_RECOVERY_BASE_MS
          ));
          scheduleAppIsolationRecoveryScan(`${reasonToken}_awaiting`);
          return;
        }
        appIsolationLifecycle.recoveryDelayMs = APP_ISOLATION_RECOVERY_BASE_MS;
      } catch (error) {
        appIsolationLifecycle.lastError = normalizeString(error?.message || error || "app_iso_scan_retry_failed", 320);
        appIsolationLifecycle.recoveryDelayMs = Math.round(clamp(
          Math.round(delayMs * 1.5),
          APP_ISOLATION_RECOVERY_BASE_MS,
          APP_ISOLATION_RECOVERY_MAX_MS,
          APP_ISOLATION_RECOVERY_BASE_MS
        ));
        scheduleAppIsolationRecoveryScan(`${reasonToken}_scan_error`);
      }
    }, delayMs);
    appIsolationLifecycle.recoveryTimer.unref?.();
    return true;
  }

  async function runAppIsolationScanInternal(options = {}) {
    const reason = sanitizeReasonToken(options.reason, "scan");
    const force = options.force === true;
    if (appIsolationLifecycle.scanPromise && !force) {
      return await appIsolationLifecycle.scanPromise;
    }
    appIsolationLifecycle.scanPromise = (async () => {
      const forceRefreshApps = options.forceRefreshApps === true || force;
      const allowRestart = options.allowRestart === true;
      const forceRestart = options.forceRestart === true;
      const apps = getApps({ forceRefresh: forceRefreshApps });
      const isolation = resolveAppIsolationTargetToken(config, apps, locks.locks || {});
      const selectionKey = buildIsolationSelectionKey(isolation);
      const changed = selectionKey !== appIsolationLifecycle.lastSelectionKey;
      appIsolationLifecycle.lastSelectionKey = selectionKey;
      appIsolationLifecycle.lastScanAt = Number(now() || Date.now());
      appIsolationLifecycle.lastError = "";

      const strictAwaiting = isolation.strictMode === true && !isolation.captureToken;
      const awaitingApp = String(isolation.selectedMode || "").trim().toLowerCase() === "awaiting_app";
      const needsRecovery = config.ffmpegAppIsolationEnabled === true && (awaitingApp || strictAwaiting);

      let restartResult = null;
      const shouldRestart = (
        config.ffmpegAppIsolationEnabled === true
        && allowRestart
        && (forceRestart || changed)
        && (forceRestart === true || captureSession.active === true || appIsolationLifecycle.armed === true)
      );
      if (shouldRestart) {
        restartResult = await startSession({
          reason: `audio_app_iso_scan_${reason}`,
          forceRefreshApps: true
        });
      }

      if (needsRecovery) {
        scheduleAppIsolationRecoveryScan(`${reason}_recovery`);
      } else {
        stopAppIsolationRecoveryTimer({ resetBackoff: true });
      }

      return {
        ok: true,
        reason,
        changed,
        restarted: restartResult?.ok === true,
        runningApps: cloneJsonSafe(apps.apps || [], []),
        processMetadata: cloneJsonSafe(apps.processMetadata || [], []),
        audioHints: cloneJsonSafe(apps.audioHints || {}, {}),
        isolation: cloneJsonSafe(isolation, {}),
        telemetry: restartResult?.telemetry || buildTelemetry(apps.apps || [], { appsPayload: apps }),
        capture: restartResult?.capture || captureRuntime.getStatus(),
        session: restartResult?.session || buildCaptureSessionSnapshot(),
        config: cloneJsonSafe(config, {})
      };
    })();
    try {
      return await appIsolationLifecycle.scanPromise;
    } catch (error) {
      appIsolationLifecycle.lastError = normalizeString(error?.message || error || "app_iso_scan_failed", 320);
      scheduleAppIsolationRecoveryScan(`${reason}_error`);
      throw error;
    } finally {
      appIsolationLifecycle.scanPromise = null;
    }
  }

  function startAppIsolationTimer() {
    stopAppIsolationTimer({ resetBackoff: false });
    if (config.ffmpegAppIsolationEnabled !== true || appIsolationLifecycle.armed !== true) return false;
    const intervalMs = Math.round(clamp(config.ffmpegAppIsolationCheckMs, 60000, 1800000, 300000));
    const scheduleNext = () => {
      if (config.ffmpegAppIsolationEnabled !== true || appIsolationLifecycle.armed !== true) return;
      appIsolationLifecycle.intervalTimer = setTimeoutFn(async () => {
        appIsolationLifecycle.intervalTimer = null;
        if (config.ffmpegAppIsolationEnabled !== true || appIsolationLifecycle.armed !== true) return;
        if (appIsolationLifecycle.intervalInFlight) {
          scheduleNext();
          return;
        }
        appIsolationLifecycle.intervalInFlight = true;
        try {
          await runAppIsolationScanInternal({
            reason: "timer",
            allowRestart: true,
            forceRefreshApps: true
          });
        } catch {
          // recovery scheduling is handled inside runAppIsolationScanInternal
        }
        appIsolationLifecycle.intervalInFlight = false;
        scheduleNext();
      }, intervalMs);
      appIsolationLifecycle.intervalTimer.unref?.();
    };
    scheduleNext();
    return true;
  }

  // [TITLE] Runtime Session Lifecycle Helpers
  // [DEV] Session lifecycle is independent from config persistence so routes can
  // [DEV] deterministically arm/disarm capture behavior without forcing config edits.
  async function startSession(meta = {}) {
    const at = Number(now() || Date.now());
    const reason = sanitizeReasonToken(meta.reason, "runtime_start");
    const wasActive = captureSession.active === true;
    const backendSelection = resolveInputBackendSelection();
    const forcedDevicesSnapshot = getDevices({ forceRefresh: true });
    const getForcedAppsSnapshot = (() => {
      let memo = null;
      return () => {
        if (memo) return memo;
        memo = getApps({ forceRefresh: true });
        return memo;
      };
    })();
    let startupIsolation = null;
    const effectiveSessionConfig = buildEffectiveStartSessionConfig({
      config,
      backendSelection,
      forcedDevicesSnapshot,
      getForcedAppsSnapshot,
      locks: locks.locks || {}
    });
    const effectiveConfig = effectiveSessionConfig.effectiveConfig;
    startupIsolation = effectiveSessionConfig.startupIsolation;

    setAppIsolationLifecycleArmed(config.ffmpegAppIsolationEnabled === true, {
      resetBackoff: false
    });
    if (config.ffmpegAppIsolationEnabled === true) {
      if (!startupIsolation) {
        const appsSnapshot = getForcedAppsSnapshot();
        startupIsolation = resolveAppIsolationTargetToken(config, appsSnapshot, locks.locks || {});
      }
      appIsolationLifecycle.lastSelectionKey = buildIsolationSelectionKey(startupIsolation || {});
      startAppIsolationTimer();
    }

    const captureResult = await captureRuntime.startCapture(effectiveConfig, {
      reason,
      forceRefreshApps: meta.forceRefreshApps === true
    });
    const captureOk = captureResult?.ok === true;
    captureSession = {
      ...captureSession,
      active: captureOk,
      lastStartedAt: at,
      reason,
      updatedAt: at
    };
    if (typeof audioEngine.setTelemetry === "function") {
      audioEngine.setTelemetry({
        running: true,
        lastError: "",
        lastRestartReason: reason,
        captureSession: buildCaptureSessionSnapshot()
      });
    }
    const forceRefreshApps = meta.forceRefreshApps === true || config.ffmpegAppIsolationEnabled === true;
    const apps = forceRefreshApps
      ? getForcedAppsSnapshot()
      : getApps({ forceRefresh: false });
    const runtimeStatus = captureRuntime.getStatus();
    const errorText = captureOk ? "" : normalizeString(captureResult?.error || runtimeStatus?.lastError || "capture_start_failed", 320);
    if (typeof audioEngine.setTelemetry === "function" && errorText) {
      audioEngine.setTelemetry({
        running: false,
        lastError: errorText,
        captureSession: buildCaptureSessionSnapshot()
      });
    }
    if (config.ffmpegAppIsolationEnabled === true) {
      const strictAwaiting = startupIsolation?.strictMode === true && !startupIsolation?.captureToken;
      const awaitingApp = String(startupIsolation?.selectedMode || "").trim().toLowerCase() === "awaiting_app";
      if (strictAwaiting || awaitingApp) {
        scheduleAppIsolationRecoveryScan("session_start_awaiting", {
          resetBackoff: true
        });
      } else {
        stopAppIsolationRecoveryTimer({ resetBackoff: true });
      }
    }
    return {
      ok: captureOk,
      started: captureOk && wasActive !== true,
      restarted: captureOk,
      reason,
      error: captureOk ? "" : errorText,
      backendSelection,
      capture: runtimeStatus,
      session: buildCaptureSessionSnapshot(),
      config: cloneJsonSafe(config, {}),
      telemetry: buildTelemetry(apps.apps || [], { forceRunning: captureOk, appsPayload: apps })
    };
  }

  function getDevices(options = {}) {
    const force = options.forceRefresh === true;
    const nowMs = Number(now() || Date.now());
    if (!force && (nowMs - Number(cacheDevices.at || 0)) < 2000) return cloneJsonSafe(cacheDevices.payload, {});
    let payload = { ok: true, devices: [], defaultOutputEndpointHint: { name: "" } };
    if (process.platform === "win32") {
      const preferredOutput = deviceDiscovery.resolvePreferredOutputHintName(config, { rootDir });
      const defaultPlaybackName = deviceDiscovery.normalizeAudioEndpointName(preferredOutput.name || "");
      const defaultPlaybackKey = defaultPlaybackName.toLowerCase();
      const endpointRows = Array.isArray(preferredOutput.endpointRows) ? preferredOutput.endpointRows : [];
      const outputEndpoints = deviceDiscovery.dedupeAudioEndpointNames(
        preferredOutput.outputEndpoints && Array.isArray(preferredOutput.outputEndpoints)
          ? preferredOutput.outputEndpoints
          : deviceDiscovery.deriveRenderEndpointNames(endpointRows, defaultPlaybackName)
      );
      const isInputOnlyAudioName = (name = "") => {
        const token = normalizeString(name, 320).toLowerCase();
        if (!token) return false;
        const loopbackLike = /(loopback|stereo mix|what u hear|monitor of|cable output|line out)/i.test(token);
        if (loopbackLike) return false;
        return /(microphone|mic\b|line in|digital input|input\b|capture\b)/i.test(token);
      };
      const rankDesktopCandidate = (name = "") => {
        const token = normalizeString(name, 320);
        if (!token) return -9999;
        const lower = token.toLowerCase();
        let score = 0;
        if (defaultPlaybackKey && lower === defaultPlaybackKey) score += 520;
        score += deviceDiscovery.scoreAudioDefaultOutputMatch(token, defaultPlaybackName || preferredOutput.name || "");
        if (deviceDiscovery.isRenderEndpointName(token)) score += 260;
        if (/(headphone|speakers?|line out|output|render|monitor)/i.test(lower)) score += 90;
        if (/(loopback|stereo mix|what u hear|monitor of|cable output)/i.test(lower)) score += 120;
        if (isInputOnlyAudioName(token)) score -= 320;
        return score;
      };
      const desktop = [];
      const desktopSeen = new Set();
      const pushDesktop = nameRaw => {
        const name = normalizeString(nameRaw || "", 256);
        if (!name) return;
        const key = name.toLowerCase();
        if (desktopSeen.has(key)) return;
        desktopSeen.add(key);
        const isDefaultOutput = Boolean(defaultPlaybackName && key === defaultPlaybackName.toLowerCase());
        desktop.push({
          id: String(desktop.length + 1),
          name,
          hostAPIName: "WASAPI",
          backend: "desktop_output",
          active: true,
          isDefaultOutput
        });
      };

      // [DEV] Keep 1.6.1 parity: include endpoint-resolver outputs first, then
      // [DEV] add Win32 sound-device rows for systems where resolver output can be sparse.
      for (const endpointName of outputEndpoints) {
        if (isInputOnlyAudioName(endpointName)) continue;
        pushDesktop(endpointName);
      }
      const rows = runPowerShellJson(
        "$r=Get-CimInstance Win32_SoundDevice -ErrorAction SilentlyContinue | Select-Object Name,DeviceID,Status; $r | ConvertTo-Json -Compress",
        5000
      );
      const list = Array.isArray(rows) ? rows : (rows && typeof rows === "object" ? [rows] : []);
      const rankedSoundDeviceRows = list
        .map(row => ({
          name: normalizeString(row?.Name || "", 320),
          score: rankDesktopCandidate(row?.Name || "")
        }))
        .filter(row => row.name)
        .filter(row => row.score > 0)
        .sort((a, b) => b.score - a.score || String(a.name || "").localeCompare(String(b.name || "")));
      for (const row of rankedSoundDeviceRows) {
        if (isInputOnlyAudioName(row.name)) continue;
        pushDesktop(row.name);
      }
      if (!desktop.length && defaultPlaybackName) {
        pushDesktop(defaultPlaybackName);
      }
      if (!desktop.length) {
        const fallbackName = resolveFallbackOutputDeviceName();
        desktop.push({
          id: "fallback-1",
          name: fallbackName,
          hostAPIName: "WASAPI",
          backend: "desktop_output",
          active: true,
          isDefaultOutput: true,
          fallback: true
        });
      } else {
        if (!desktop.some(row => row.isDefaultOutput === true)) {
          const rankedDesktop = desktop
            .map(row => ({
              row,
              score: rankDesktopCandidate(row?.name || "")
            }))
            .sort((a, b) => b.score - a.score || String(a.row?.name || "").localeCompare(String(b.row?.name || "")));
          const preferredRow = rankedDesktop[0]?.row || desktop[0];
          if (preferredRow) {
            preferredRow.isDefaultOutput = true;
          }
        }
      }
      const portaudio = desktop.map(row => ({ ...row, backend: "portaudio", isDefaultOutput: row.isDefaultOutput === true }));
      const defaultRow = desktop.find(row => row.isDefaultOutput === true) || desktop[0];
      const outputHintName = deviceDiscovery.normalizeAudioEndpointName(defaultPlaybackName || defaultRow?.name || "");
      payload = {
        ok: true,
        devices: [...desktop, ...portaudio],
        defaultOutputEndpointHint: { name: outputHintName || defaultRow?.name || "" },
        captureCandidates: {
          ffmpegDshowAudio: deviceDiscovery.buildPreferredDshowCaptureCandidates({
            ffmpegPath: config.ffmpegPath || "ffmpeg",
            desktopOutputDeviceName: outputHintName || defaultRow?.name || "",
            deviceMatch: config.deviceMatch || ""
          }),
          windowsAudioEndpoints: endpointRows,
          outputEndpoints: outputEndpoints.slice(0, 24),
          outputHintSource: normalizeString(preferredOutput.source || "", 64),
          outputHintResolverError: normalizeString(preferredOutput.resolverError || "", 256)
        }
      };
    }
    if (!Array.isArray(payload.devices) || payload.devices.length === 0) {
      const fallbackName = resolveFallbackOutputDeviceName();
      payload = {
        ok: true,
        devices: [
          {
            id: "fallback-1",
            name: fallbackName,
            hostAPIName: "WASAPI",
            backend: "desktop_output",
            active: true,
            isDefaultOutput: true,
            fallback: true
          },
          {
            id: "fallback-1",
            name: fallbackName,
            hostAPIName: "WASAPI",
            backend: "portaudio",
            active: true,
            isDefaultOutput: true,
            fallback: true
          }
        ],
        defaultOutputEndpointHint: { name: fallbackName }
      };
    }
    cacheDevices = { at: nowMs, payload: cloneJsonSafe(payload, {}) };
    return cloneJsonSafe(payload, {});
  }

  loadAll();
  applyEngineBackend();
  buildTelemetry([]);
  requestRustTransportWorkerAdapterCatalog();
  requestRustTransportWorkerWatchdogSnapshot();

  return {
    getOptionalToolsStatus() {
      const ffmpegAvailable = (() => {
        try {
          execFileSync(config.ffmpegPath || "ffmpeg", ["-version"], { windowsHide: true, timeout: 1800, stdio: "ignore" });
          return true;
        } catch {
          return false;
        }
      })();
      const procTapProbe = listProcTapAudioProcessesSync(config);
      const procTapAvailable = procTapProbe.toolAvailable === true;
      const rustRuntime = detectRustCaptureRuntimeAvailability(config, { rootDir });
      return {
        ok: true,
        status: {
          platform: process.platform,
          optionalToolsReady: ffmpegAvailable || rustRuntime.kernel || rustRuntime.loopback || procTapAvailable,
          needsOptionalInstall: !(ffmpegAvailable || rustRuntime.kernel || rustRuntime.loopback || procTapAvailable),
          recommendedCaptureStrategy: rustRuntime.kernel || rustRuntime.loopback ? "force_rust" : "auto_rust_first",
          checks: {
            ffmpeg: { available: ffmpegAvailable, path: config.ffmpegPath || "ffmpeg" },
            procTap: {
              available: procTapAvailable,
              launcher: normalizeString(config.procTapLauncher || "py", 32) || "py",
              pythonVersion: normalizeString(config.procTapPythonVersion || "3.13", 16) || "3.13",
              lastError: normalizeString(procTapProbe.error || "", 256)
            },
            rustAudioKernel: { available: rustRuntime.kernel, path: rustRuntime.kernelPath || "" },
            rustLoopback: { available: rustRuntime.loopback, path: rustRuntime.loopbackPath || "" },
            rustSourceResolver: { available: rustRuntime.resolver, path: rustRuntime.resolverPath || "" }
          },
          installScript: {
            fileName: "RaveLink-Bridge-Install-Optional-Audio-Tools.bat",
            startMenuHint: "Start Menu > RaveLink Bridge > Install Optional Audio Tools"
          },
          generatedAt: Number(now() || Date.now())
        }
      };
    },
    getApps,
    resolveRepresentativePidForToken(appsPayload = {}, tokenRaw = "", options = {}) {
      return resolveRepresentativePidForToken(appsPayload, tokenRaw, options);
    },
    getDevices,
    getConfigSnapshot() {
      return {
        ok: true,
        config: cloneJsonSafe(config, {}),
        backendSelection: resolveInputBackendSelection(),
        capture: captureRuntime.getStatus(),
        session: buildCaptureSessionSnapshot()
      };
    },
    getConfig() {
      const apps = getApps();
      const backendSelection = resolveInputBackendSelection();
      return {
        ok: true,
        config: cloneJsonSafe(config, {}),
        backendSelection,
        capture: captureRuntime.getStatus(),
        session: buildCaptureSessionSnapshot(),
        telemetry: buildTelemetry(apps.apps || [], { appsPayload: apps })
      };
    },
    getCaptureBackendStrategyProjection(strategyRaw = "auto_rust_first") {
      const strategy = normalizeCaptureBackendStrategy(strategyRaw);
      return resolveBackendSelectionForStrategy(strategy);
    },
    async applyCaptureBackendStrategy(strategyRaw = "auto_rust_first", options = {}) {
      return applyCaptureBackendStrategy(strategyRaw, options);
    },
    async patchConfig(patch = {}, options = {}) {
      const source = patch && typeof patch === "object" ? patch : {};
      const persistedPatch = { ...source };
      delete persistedPatch.restart;
      delete persistedPatch.apply;
      delete persistedPatch.reason;
      const prev = cloneJsonSafe(config, {});
      config = { ...config, ...persistedPatch, updatedAt: Number(now() || Date.now()) };
      config.inputBackend = INPUT_BACKENDS.has(String(config.inputBackend || "auto").trim().toLowerCase())
        ? String(config.inputBackend).trim().toLowerCase()
        : "auto";
      persistAll();
      const backend = applyEngineBackend();
      const changed = Object.keys(persistedPatch).filter(key => !valuesEquivalent(prev[key], config[key]));
      const appIsolationConfigChanged = changed.some(key => APP_ISOLATION_CONFIG_KEYS.has(String(key || "")));
      const captureAffectingChanged = changed.some(key => AUDIO_CAPTURE_RESTART_KEYS.has(String(key || "")));
      const autoRestartAllowed = options.restart !== false;
      const shouldAutoRestart = autoRestartAllowed && captureSession.active === true && captureAffectingChanged;
      const restarted = options.restart === true || (autoRestartAllowed && normalizeBool(source.restart, false)) || shouldAutoRestart;
      if (source.rustTransportWorker && typeof source.rustTransportWorker === "object") {
        setRustTransportWorkerConfig(source.rustTransportWorker, {
          autoStartIfEnabled: source.rustTransportWorkerAutoStart !== false
        });
      }
      if (restarted) {
        const startedSession = await startSession({
          reason: normalizeString(options.reason || source.reason || "audio_config_patch", 96) || "audio_config_patch",
          forceRefreshApps: true
        });
        return {
          ok: true,
          config: cloneJsonSafe(config, {}),
          changed,
          restarted,
          audioBackendSelection: backend,
          backendSelection: resolveInputBackendSelection(),
          capture: captureRuntime.getStatus(),
          session: startedSession.session,
          telemetry: startedSession.telemetry
        };
      }
      if (config.ffmpegAppIsolationEnabled === true && (captureSession.active === true || appIsolationLifecycle.armed === true)) {
        setAppIsolationLifecycleArmed(true, {
          resetBackoff: false
        });
        startAppIsolationTimer();
        if (appIsolationConfigChanged) {
          try {
            await runAppIsolationScanInternal({
              reason: "config_patch",
              allowRestart: autoRestartAllowed,
              forceRefreshApps: true,
              force: true
            });
          } catch {
            // [DEV] Lifecycle helper tracks scan failures and schedules recovery retries.
          }
        }
      } else if (config.ffmpegAppIsolationEnabled !== true) {
        setAppIsolationLifecycleArmed(false, {
          resetBackoff: true
        });
      }
      const apps = getApps({ forceRefresh: true });
      return {
        ok: true,
        config: cloneJsonSafe(config, {}),
        changed,
        restarted,
        audioBackendSelection: backend,
        backendSelection: resolveInputBackendSelection(),
        capture: captureRuntime.getStatus(),
        session: buildCaptureSessionSnapshot(),
        telemetry: buildTelemetry(apps.apps || [], { appsPayload: apps })
      };
    },
    async restart(meta = {}) {
      const reason = normalizeString(meta.reason || "audio_restart_route", 96);
      const startedSession = await startSession({
        reason,
        forceRefreshApps: true
      });
      return {
        ok: true,
        reason,
        restarted: true,
        config: cloneJsonSafe(config, {}),
        backendSelection: resolveInputBackendSelection(),
        capture: captureRuntime.getStatus(),
        session: startedSession.session,
        telemetry: startedSession.telemetry
      };
    },
    getAppIsolationLocks() {
      const apps = getApps();
      return {
        ok: true,
        locks: cloneJsonSafe(filterManualLockMapForApps(locks.locks || {}, apps), {}),
        telemetry: buildTelemetry(apps.apps || [], { appsPayload: apps })
      };
    },
    setAppIsolationLock(payload = {}) {
      const sourceToken = normalizeAppToken(payload.sourceToken || payload.source || "");
      const captureToken = normalizeAppToken(payload.captureToken || payload.capture || "");
      if (!sourceToken || !captureToken) return { ok: false, error: "invalid_manual_lock_payload" };
      locks.locks = sanitizeManualLockMap({
        ...(locks?.locks && typeof locks.locks === "object" ? locks.locks : {}),
        [sourceToken]: captureToken
      });
      persistAll();
      return { ok: true, locks: cloneJsonSafe(locks.locks || {}, {}) };
    },
    clearAppIsolationLock(payload = {}) {
      const sourceToken = normalizeAppToken(payload.sourceToken || payload.source || "");
      if (!sourceToken) return { ok: false, error: "missing_source_token" };
      delete locks.locks[sourceToken];
      locks.locks = sanitizeManualLockMap(locks.locks || {});
      persistAll();
      return { ok: true, locks: cloneJsonSafe(locks.locks || {}, {}) };
    },
    async scanAppIsolation(payload = {}) {
      const forceRefresh = payload?.force !== false || payload?.forceRefresh === true;
      const restartRequested = normalizeBool(payload?.forceRestart, false);
      const result = await runAppIsolationScanInternal({
        reason: normalizeString(payload?.reason || "route_scan", 96) || "route_scan",
        allowRestart: restartRequested,
        forceRestart: restartRequested,
        forceRefreshApps: forceRefresh,
        force: forceRefresh
      });
      return {
        ok: true,
        runningApps: cloneJsonSafe(result.runningApps || [], []),
        processMetadata: cloneJsonSafe(result.processMetadata || [], []),
        audioHints: cloneJsonSafe(result.audioHints || {}, {}),
        isolation: cloneJsonSafe(result.isolation || {}, {}),
        telemetry: cloneJsonSafe(result.telemetry || {}, {}),
        capture: result.capture || captureRuntime.getStatus(),
        session: result.session || buildCaptureSessionSnapshot(),
        config: cloneJsonSafe(result.config || config, {}),
        restarted: result.restarted === true
      };
    },
    getReactivityMap() {
      return { ok: true, config: cloneJsonSafe(reactivity, {}) };
    },
    patchReactivityMap(payload = {}) {
      if (payload && payload.reset === true) {
        reactivity = cloneJsonSafe(AUDIO_REACTIVITY_DEFAULT, {});
      } else if (payload && typeof payload === "object") {
        reactivity = { ...reactivity, ...payload };
      }
      persistAll();
      return { ok: true, config: cloneJsonSafe(reactivity, {}) };
    },
    getProfiles() {
      return {
        ok: true,
        profiles: {
          profiles: (Array.isArray(profiles.profiles) ? profiles.profiles : []).map(row => ({
            id: normalizeString(row?.id || row?.name, 64),
            name: normalizeString(row?.name || "", 40),
            updatedAt: Number(row?.updatedAt || 0)
          })).filter(row => row.name)
        }
      };
    },
    saveProfile(nameRaw = "") {
      const name = normalizeString(nameRaw, 40).replace(/[^a-z0-9 _.-]+/gi, "").trim();
      if (!name) return { ok: false, error: "invalid_profile_name" };
      const next = Array.isArray(profiles.profiles) ? profiles.profiles.filter(row => String(row?.name || "").trim().toLowerCase() !== name.toLowerCase()) : [];
      next.push({ id: name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 64), name, updatedAt: Number(now() || Date.now()), config: cloneJsonSafe(config, {}) });
      next.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
      profiles = { profiles: next };
      persistAll();
      return { ok: true, profile: { name } };
    },
    applyProfile(nameRaw = "") {
      const name = normalizeString(nameRaw, 40).replace(/[^a-z0-9 _.-]+/gi, "").trim();
      const row = (Array.isArray(profiles.profiles) ? profiles.profiles : []).find(item => String(item?.name || "").trim().toLowerCase() === name.toLowerCase());
      if (!row) return { ok: false, error: "profile_not_found" };
      config = { ...config, ...(row.config && typeof row.config === "object" ? row.config : {}), updatedAt: Number(now() || Date.now()) };
      persistAll();
      applyEngineBackend();
      const apps = getApps({ forceRefresh: true });
      return {
        ok: true,
        applyResult: {
          name,
          config: cloneJsonSafe(config, {}),
          changed: Object.keys(config),
          restarted: false,
          telemetry: buildTelemetry(apps.apps || [], { appsPayload: apps })
        }
      };
    },
    deleteProfile(nameRaw = "") {
      const name = normalizeString(nameRaw, 40).replace(/[^a-z0-9 _.-]+/gi, "").trim().toLowerCase();
      const before = Array.isArray(profiles.profiles) ? profiles.profiles.length : 0;
      profiles = { profiles: (Array.isArray(profiles.profiles) ? profiles.profiles : []).filter(item => String(item?.name || "").trim().toLowerCase() !== name) };
      if (profiles.profiles.length === before) return { ok: false, error: "profile_not_found" };
      persistAll();
      return { ok: true, deleted: name };
    },
    getRustTransportWorkerStatus() {
      return buildRustTransportWorkerStatus();
    },
    requestRustTransportWorkerAdapterCatalog() {
      const requested = requestRustTransportWorkerAdapterCatalog();
      return {
        requested,
        status: buildRustTransportWorkerStatus()
      };
    },
    requestRustTransportWorkerWatchdogSnapshot() {
      const requested = requestRustTransportWorkerWatchdogSnapshot();
      return {
        requested,
        status: buildRustTransportWorkerStatus()
      };
    },
    setRustTransportWorkerConfig(patch = {}, options = {}) {
      return setRustTransportWorkerConfig(patch, options);
    },
    startRustTransportWorker(meta = {}) {
      return startRustTransportWorker(meta);
    },
    stopRustTransportWorker(meta = {}) {
      return stopRustTransportWorker(meta);
    },
    restartRustTransportWorker(meta = {}) {
      return restartRustTransportWorker(meta);
    },
    async startSession(meta = {}) {
      return startSession(meta);
    },
    stopSession(meta = {}) {
      return stopSession(meta);
    },
    getSessionStatus() {
      return buildCaptureSessionSnapshot();
    },
    getCaptureStatus() {
      return captureRuntime.getStatus();
    }
  };
};

module.exports.resolveAppIsolationTargetSelection = resolveAppIsolationTargetSelection;
