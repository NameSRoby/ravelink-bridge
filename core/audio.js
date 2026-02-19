// [TITLE] Module: core/audio.js
// [TITLE] Purpose: audio

/**
 * ======================================================
 * RAVE AUDIO ENGINE v3.1
 * ======================================================
 * Compatibility:
 * - Same factory API: createAudio(onLevel)
 * - Same required methods: start(), stop()
 * - Same optional hooks: onFast/onMid/onSlow/onTransient
 *
 * Additions:
 * - Adaptive floor/ceiling normalization (less track-dependent jitter)
 * - Device fallback selection (not hard-fail on missing VB cable)
 * - Auto-restart on stream error
 * - Extended hooks: onLevel, onStats
 * - Telemetry getter for debugging/tuning
 */

let naudiodon = null;
let naudiodonLoadError = null;
try {
  naudiodon = require("naudiodon");
} catch (err) {
  naudiodonLoadError = err;
}
const fs = require("fs");
const path = require("path");
const { spawn, execFile } = require("child_process");

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const toNum = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const toBool = (value, fallback = false) => {
  if (value === true || value === false) return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  if (typeof value === "string") {
    const raw = value.trim().toLowerCase();
    if (raw === "true" || raw === "yes" || raw === "on") return true;
    if (raw === "false" || raw === "no" || raw === "off") return false;
  }
  return fallback;
};
const AUDIO_VERBOSE_LOGS = String(process.env.RAVE_AUDIO_VERBOSE_LOGS || "").trim() === "1";
const PROCESS_LOOPBACK_LOCKS_PATH = path.join(__dirname, "audio.process-locks.json");
const PROCESS_LOOPBACK_SILENCE_PROBE_MS = 2200;
const PROCESS_LOOPBACK_PROBE_COOLDOWN_MS = 60000;
const APP_ISOLATION_RECOVERY_SCAN_MS = 5000;
const APP_ISOLATION_RECOVERY_SCAN_MAX_MS = 60000;
const softLimit01 = (value, threshold, knee) => {
  const x = Math.max(0, value);
  if (x <= threshold) return x;
  const over = x - threshold;
  const shaped = 1 - Math.exp(-over / Math.max(1e-6, knee));
  return threshold + (1 - threshold) * shaped;
};

function normalizeFfmpegDeviceList(value, fallback = []) {
  const source = Array.isArray(value)
    ? value
    : String(value || "")
      .split(/[\r\n,;]+/g)
      .map(item => String(item || "").trim());
  const out = [];
  for (const item of source) {
    const text = String(item || "").trim();
    if (!text) continue;
    if (out.includes(text)) continue;
    out.push(text);
    if (out.length >= 6) break;
  }
  if (out.length) return out;
  const fallbackList = Array.isArray(fallback)
    ? fallback
    : [];
  if (!fallbackList.length) return [];
  return normalizeFfmpegDeviceList(fallbackList, []);
}

function normalizeAppToken(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  return raw.endsWith(".exe") ? raw.slice(0, -4) : raw;
}

function sanitizeProcessLoopbackLockMap(input = {}) {
  const raw = input && typeof input === "object" && !Array.isArray(input)
    ? input
    : {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const sourceToken = normalizeAppToken(key);
    const captureToken = normalizeAppToken(value);
    if (!sourceToken || !captureToken) continue;
    if (!/^[a-z0-9._-]{1,96}$/.test(sourceToken)) continue;
    if (!/^[a-z0-9._-]{1,96}$/.test(captureToken)) continue;
    out[sourceToken] = captureToken;
    if (Object.keys(out).length >= 128) break;
  }
  return out;
}

function readProcessLoopbackLocks() {
  try {
    if (!fs.existsSync(PROCESS_LOOPBACK_LOCKS_PATH)) return {};
    const parsed = JSON.parse(fs.readFileSync(PROCESS_LOOPBACK_LOCKS_PATH, "utf8"));
    return sanitizeProcessLoopbackLockMap(parsed);
  } catch {
    return {};
  }
}

function writeProcessLoopbackLocks(locks = {}) {
  try {
    const safe = sanitizeProcessLoopbackLockMap(locks);
    fs.writeFileSync(PROCESS_LOOPBACK_LOCKS_PATH, `${JSON.stringify(safe, null, 2)}\n`, "utf8");
    return safe;
  } catch {
    return sanitizeProcessLoopbackLockMap(locks);
  }
}

const PROCESS_LOOPBACK_CAPTURE_ALIASES = Object.freeze({
  applemusic: Object.freeze(["amplibraryagent"])
});

function resolvePreferredCaptureToken(appToken, runningTokenSet) {
  const token = normalizeAppToken(appToken);
  if (!token) return "";
  const running = runningTokenSet instanceof Set ? runningTokenSet : new Set();
  const aliases = PROCESS_LOOPBACK_CAPTURE_ALIASES[token] || [];
  const candidates = [...aliases, token];
  for (const candidate of candidates) {
    if (running.has(candidate)) return candidate;
  }
  return token;
}

function resolveLockedCaptureToken(appToken, lockMap = {}) {
  const token = normalizeAppToken(appToken);
  if (!token) return "";
  return normalizeAppToken(lockMap[token] || "");
}

function sanitizeAppName(value, fallback = "") {
  const raw = String(value || "").trim();
  if (!raw) return String(fallback || "").trim();
  return raw.slice(0, 128);
}

module.exports = function createAudio(onLevel) {
  let stream = null;
  let running = false;
  let restartTimer = null;
  let watchdogTimer = null;
  let lastError = null;
  let lastRestartReason = null;
  let lastDeviceId = null;
  let lastBackend = "auto";
  let lastDataAt = 0;
  let watchdogTrips = 0;
  let ffmpegProc = null;
  let ffmpegBufferCarry = Buffer.alloc(0);
  let procTapProc = null;
  let procTapBufferCarry = Buffer.alloc(0);
  let activeInputSampleRate = 96000;

  const cfg = {
    inputBackend: String(process.env.RAVE_AUDIO_INPUT_BACKEND || "auto").toLowerCase().trim(),
    sampleRate: toNum(process.env.RAVE_AUDIO_SAMPLE_RATE, 96000),
    framesPerBuffer: toNum(process.env.RAVE_AUDIO_FRAMES, 256),
    channels: toNum(process.env.RAVE_AUDIO_CHANNELS, 2),
    noiseFloorMin: toNum(process.env.RAVE_AUDIO_NOISE_FLOOR, 0.00045),
    peakDecay: toNum(process.env.RAVE_AUDIO_PEAK_DECAY, 0.93),
    outputGain: toNum(process.env.RAVE_AUDIO_GAIN, 1.0),
    autoLevelEnabled: toBool(process.env.RAVE_AUDIO_AUTO_LEVEL_ENABLED, true),
    autoLevelTargetRms: clamp(toNum(process.env.RAVE_AUDIO_AUTO_LEVEL_TARGET_RMS, 0.028), 0.005, 0.2),
    autoLevelMinGain: clamp(toNum(process.env.RAVE_AUDIO_AUTO_LEVEL_MIN_GAIN, 0.45), 0.2, 3),
    autoLevelMaxGain: clamp(toNum(process.env.RAVE_AUDIO_AUTO_LEVEL_MAX_GAIN, 1.55), 0.2, 4),
    autoLevelResponse: clamp(toNum(process.env.RAVE_AUDIO_AUTO_LEVEL_RESPONSE, 0.015), 0.001, 0.2),
    autoLevelGate: clamp(toNum(process.env.RAVE_AUDIO_AUTO_LEVEL_GATE, 0.007), 0, 0.03),
    limiterThreshold: clamp(toNum(process.env.RAVE_AUDIO_LIMITER_THRESHOLD, 0.82), 0.4, 0.99),
    limiterKnee: clamp(toNum(process.env.RAVE_AUDIO_LIMITER_KNEE, 0.16), 0.02, 0.8),
    restartMs: toNum(process.env.RAVE_AUDIO_RESTART_MS, 1500),
    watchdogMs: clamp(Math.round(toNum(process.env.RAVE_AUDIO_WATCHDOG_MS, 3000)), 800, 30000),
    logEveryTicks: Math.max(10, toNum(process.env.RAVE_AUDIO_LOG_TICKS, 60)),
    bandLowHz: clamp(toNum(process.env.RAVE_AUDIO_BAND_LOW_HZ, 180), 60, 500),
    bandMidHz: clamp(toNum(process.env.RAVE_AUDIO_BAND_MID_HZ, 2200), 700, 8000),
    deviceMatch: String(process.env.RAVE_AUDIO_DEVICE_MATCH || "").toLowerCase().trim(),
    deviceId:
      process.env.RAVE_AUDIO_DEVICE_ID === undefined
        ? null
        : toNum(process.env.RAVE_AUDIO_DEVICE_ID, null),
    ffmpegPath: String(process.env.RAVE_AUDIO_FFMPEG_PATH || "ffmpeg").trim() || "ffmpeg",
    ffmpegInputFormat: String(process.env.RAVE_AUDIO_FFMPEG_INPUT_FORMAT || "dshow").toLowerCase().trim() || "dshow",
    ffmpegInputDevice: String(process.env.RAVE_AUDIO_FFMPEG_INPUT_DEVICE || "").trim(),
    ffmpegInputDevices: normalizeFfmpegDeviceList(process.env.RAVE_AUDIO_FFMPEG_INPUT_DEVICES || "", []),
    ffmpegLogLevel: String(process.env.RAVE_AUDIO_FFMPEG_LOGLEVEL || "error").toLowerCase().trim() || "error",
    ffmpegUseWallclock: toBool(process.env.RAVE_AUDIO_FFMPEG_USE_WALLCLOCK, true),
    ffmpegAppIsolationEnabled: toBool(process.env.RAVE_AUDIO_FFMPEG_APP_ISO_ENABLED, false),
    ffmpegAppIsolationStrict: toBool(process.env.RAVE_AUDIO_FFMPEG_APP_ISO_STRICT, false),
    ffmpegAppIsolationPrimaryApp: sanitizeAppName(process.env.RAVE_AUDIO_FFMPEG_APP_ISO_PRIMARY_APP || "", ""),
    ffmpegAppIsolationFallbackApp: sanitizeAppName(process.env.RAVE_AUDIO_FFMPEG_APP_ISO_FALLBACK_APP || "", ""),
    ffmpegAppIsolationPrimaryDevices: normalizeFfmpegDeviceList(
      process.env.RAVE_AUDIO_FFMPEG_APP_ISO_PRIMARY_DEVICES || "",
      []
    ),
    ffmpegAppIsolationFallbackDevices: normalizeFfmpegDeviceList(
      process.env.RAVE_AUDIO_FFMPEG_APP_ISO_FALLBACK_DEVICES || "",
      []
    ),
    ffmpegAppIsolationMultiSource: toBool(process.env.RAVE_AUDIO_FFMPEG_APP_ISO_MULTI_SOURCE, false),
    ffmpegAppIsolationCheckMs: clamp(
      Math.round(toNum(process.env.RAVE_AUDIO_FFMPEG_APP_ISO_CHECK_MS, 300000)),
      60000,
      1800000
    ),
    procTapLauncher: String(process.env.RAVE_AUDIO_PROCTAP_LAUNCHER || "py").trim() || "py",
    procTapPythonVersion: String(process.env.RAVE_AUDIO_PROCTAP_PY_VERSION || "3.13").trim() || "3.13",
    procTapCaptureLocks: readProcessLoopbackLocks()
  };

  function normalizeFfmpegDeviceFields() {
    const list = normalizeFfmpegDeviceList(cfg.ffmpegInputDevices, []);
    const single = String(cfg.ffmpegInputDevice || "").trim();
    if (list.length) {
      cfg.ffmpegInputDevices = list;
      if (!single || !list.includes(single)) {
        cfg.ffmpegInputDevice = list[0];
      }
      return;
    }
    if (single) {
      cfg.ffmpegInputDevices = [single];
      return;
    }
    cfg.ffmpegInputDevices = [];
    cfg.ffmpegInputDevice = "";
  }

  normalizeFfmpegDeviceFields();

  const appIsolationRuntime = {
    lastScanAt: 0,
    lastError: "",
    selectedApp: "",
    selectedAppToken: "",
    captureToken: "",
    activeApp: "",
    activePid: 0,
    mode: "manual",
    resolvedDevices: [],
    selectionKey: "",
    runningApps: [],
    intervalTimer: null,
    scanPromise: null,
    recoveryTimer: null,
    recoveryDelayMs: APP_ISOLATION_RECOVERY_SCAN_MS
  };
  const processLoopbackRuntime = {
    streamStartedAt: 0,
    silenceSince: 0,
    audioSeen: false,
    probeInFlight: false,
    lastProbeAt: 0
  };

  function getConfiguredDefaultFfmpegDevices() {
    normalizeFfmpegDeviceFields();
    return normalizeFfmpegDeviceList(cfg.ffmpegInputDevices, []);
  }

  function normalizeConfiguredApp(value, fallback = "") {
    const safe = sanitizeAppName(value, fallback);
    if (!safe) return "";
    return safe;
  }

  function normalizeCfgPatch(patch = {}) {
    const next = {};

    if (patch.inputBackend !== undefined) {
      const raw = String(patch.inputBackend || "").trim().toLowerCase();
      next.inputBackend = raw === "ffmpeg" || raw === "portaudio" ? raw : "auto";
    }

    if (patch.sampleRate !== undefined) {
      next.sampleRate = clamp(Math.round(toNum(patch.sampleRate, cfg.sampleRate)), 22050, 192000);
    }

    if (patch.framesPerBuffer !== undefined) {
      next.framesPerBuffer = clamp(Math.round(toNum(patch.framesPerBuffer, cfg.framesPerBuffer)), 64, 2048);
    }

    if (patch.channels !== undefined) {
      next.channels = clamp(Math.round(toNum(patch.channels, cfg.channels)), 1, 8);
    }

    if (patch.noiseFloorMin !== undefined) {
      next.noiseFloorMin = clamp(toNum(patch.noiseFloorMin, cfg.noiseFloorMin), 0, 0.02);
    }

    if (patch.peakDecay !== undefined) {
      next.peakDecay = clamp(toNum(patch.peakDecay, cfg.peakDecay), 0.5, 0.9995);
    }

    if (patch.outputGain !== undefined) {
      next.outputGain = clamp(toNum(patch.outputGain, cfg.outputGain), 0.2, 3);
    }

    if (patch.autoLevelEnabled !== undefined) {
      next.autoLevelEnabled = toBool(patch.autoLevelEnabled, cfg.autoLevelEnabled);
    }

    if (patch.autoLevelTargetRms !== undefined) {
      next.autoLevelTargetRms = clamp(toNum(patch.autoLevelTargetRms, cfg.autoLevelTargetRms), 0.005, 0.2);
    }

    if (patch.autoLevelMinGain !== undefined) {
      next.autoLevelMinGain = clamp(toNum(patch.autoLevelMinGain, cfg.autoLevelMinGain), 0.2, 3);
    }

    if (patch.autoLevelMaxGain !== undefined) {
      next.autoLevelMaxGain = clamp(toNum(patch.autoLevelMaxGain, cfg.autoLevelMaxGain), 0.2, 4);
    }

    if (patch.autoLevelResponse !== undefined) {
      next.autoLevelResponse = clamp(toNum(patch.autoLevelResponse, cfg.autoLevelResponse), 0.001, 0.2);
    }

    if (patch.autoLevelGate !== undefined) {
      next.autoLevelGate = clamp(toNum(patch.autoLevelGate, cfg.autoLevelGate), 0, 0.03);
    }

    if (patch.limiterThreshold !== undefined) {
      next.limiterThreshold = clamp(toNum(patch.limiterThreshold, cfg.limiterThreshold), 0.4, 0.99);
    }

    if (patch.limiterKnee !== undefined) {
      next.limiterKnee = clamp(toNum(patch.limiterKnee, cfg.limiterKnee), 0.02, 0.8);
    }

    if (patch.restartMs !== undefined) {
      next.restartMs = clamp(Math.round(toNum(patch.restartMs, cfg.restartMs)), 250, 20000);
    }

    if (patch.watchdogMs !== undefined) {
      next.watchdogMs = clamp(Math.round(toNum(patch.watchdogMs, cfg.watchdogMs)), 800, 30000);
    }

    if (patch.logEveryTicks !== undefined) {
      next.logEveryTicks = clamp(Math.round(toNum(patch.logEveryTicks, cfg.logEveryTicks)), 10, 2000);
    }

    if (patch.bandLowHz !== undefined) {
      next.bandLowHz = clamp(Math.round(toNum(patch.bandLowHz, cfg.bandLowHz)), 60, 500);
    }

    if (patch.bandMidHz !== undefined) {
      next.bandMidHz = clamp(Math.round(toNum(patch.bandMidHz, cfg.bandMidHz)), 700, 8000);
    }

    if (patch.deviceMatch !== undefined) {
      next.deviceMatch = String(patch.deviceMatch || "").toLowerCase();
    }

    if (patch.deviceId !== undefined) {
      if (patch.deviceId === null || patch.deviceId === "" || String(patch.deviceId).toLowerCase() === "auto") {
        next.deviceId = null;
      } else {
        next.deviceId = Math.round(toNum(patch.deviceId, cfg.deviceId ?? 0));
      }
    }

    if (patch.ffmpegPath !== undefined) {
      next.ffmpegPath = String(patch.ffmpegPath || "").trim() || "ffmpeg";
    }

    if (patch.ffmpegInputFormat !== undefined) {
      const raw = String(patch.ffmpegInputFormat || "").trim().toLowerCase();
      next.ffmpegInputFormat = raw || "dshow";
    }

    if (patch.ffmpegInputDevice !== undefined) {
      next.ffmpegInputDevice = String(patch.ffmpegInputDevice || "").trim();
    }

    if (patch.ffmpegInputDevices !== undefined) {
      next.ffmpegInputDevices = Array.isArray(patch.ffmpegInputDevices)
        ? normalizeFfmpegDeviceList(patch.ffmpegInputDevices, [])
        : normalizeFfmpegDeviceList(patch.ffmpegInputDevices, cfg.ffmpegInputDevices);
    }

    if (patch.ffmpegLogLevel !== undefined) {
      const raw = String(patch.ffmpegLogLevel || "").trim().toLowerCase();
      next.ffmpegLogLevel = raw || "error";
    }

    if (patch.ffmpegUseWallclock !== undefined) {
      next.ffmpegUseWallclock = toBool(patch.ffmpegUseWallclock, cfg.ffmpegUseWallclock);
    }

    if (patch.ffmpegAppIsolationEnabled !== undefined) {
      next.ffmpegAppIsolationEnabled = toBool(
        patch.ffmpegAppIsolationEnabled,
        cfg.ffmpegAppIsolationEnabled
      );
    }

    if (patch.ffmpegAppIsolationStrict !== undefined) {
      next.ffmpegAppIsolationStrict = toBool(
        patch.ffmpegAppIsolationStrict,
        cfg.ffmpegAppIsolationStrict
      );
    }

    if (patch.ffmpegAppIsolationPrimaryApp !== undefined) {
      const raw = String(patch.ffmpegAppIsolationPrimaryApp || "").trim();
      next.ffmpegAppIsolationPrimaryApp = raw
        ? normalizeConfiguredApp(raw, cfg.ffmpegAppIsolationPrimaryApp)
        : "";
    }

    if (patch.ffmpegAppIsolationFallbackApp !== undefined) {
      const raw = String(patch.ffmpegAppIsolationFallbackApp || "").trim();
      next.ffmpegAppIsolationFallbackApp = raw
        ? normalizeConfiguredApp(raw, cfg.ffmpegAppIsolationFallbackApp)
        : "";
    }

    if (patch.ffmpegAppIsolationPrimaryDevices !== undefined) {
      next.ffmpegAppIsolationPrimaryDevices = Array.isArray(patch.ffmpegAppIsolationPrimaryDevices)
        ? normalizeFfmpegDeviceList(patch.ffmpegAppIsolationPrimaryDevices, [])
        : normalizeFfmpegDeviceList(
          patch.ffmpegAppIsolationPrimaryDevices,
          cfg.ffmpegAppIsolationPrimaryDevices
        );
    }

    if (patch.ffmpegAppIsolationFallbackDevices !== undefined) {
      next.ffmpegAppIsolationFallbackDevices = Array.isArray(patch.ffmpegAppIsolationFallbackDevices)
        ? normalizeFfmpegDeviceList(patch.ffmpegAppIsolationFallbackDevices, [])
        : normalizeFfmpegDeviceList(
          patch.ffmpegAppIsolationFallbackDevices,
          cfg.ffmpegAppIsolationFallbackDevices
        );
    }

    if (patch.ffmpegAppIsolationMultiSource !== undefined) {
      next.ffmpegAppIsolationMultiSource = toBool(
        patch.ffmpegAppIsolationMultiSource,
        cfg.ffmpegAppIsolationMultiSource
      );
    }

    if (patch.ffmpegAppIsolationCheckMs !== undefined) {
      next.ffmpegAppIsolationCheckMs = clamp(
        Math.round(toNum(patch.ffmpegAppIsolationCheckMs, cfg.ffmpegAppIsolationCheckMs)),
        60000,
        1800000
      );
    }

    if (patch.procTapCaptureLocks !== undefined) {
      next.procTapCaptureLocks = sanitizeProcessLoopbackLockMap(patch.procTapCaptureLocks);
    }

    const resolvedMinGain = next.autoLevelMinGain !== undefined
      ? next.autoLevelMinGain
      : cfg.autoLevelMinGain;
    const resolvedMaxGain = next.autoLevelMaxGain !== undefined
      ? next.autoLevelMaxGain
      : cfg.autoLevelMaxGain;
    if (resolvedMinGain > resolvedMaxGain) {
      if (next.autoLevelMaxGain !== undefined && next.autoLevelMinGain === undefined) {
        next.autoLevelMinGain = resolvedMaxGain;
      } else {
        next.autoLevelMaxGain = resolvedMinGain;
      }
    }

    // Conflict resolver: app-isolation requires ffmpeg capture.
    const resolvedInputBackend = next.inputBackend !== undefined
      ? next.inputBackend
      : String(cfg.inputBackend || "auto").trim().toLowerCase();
    const isolationExplicit = next.ffmpegAppIsolationEnabled !== undefined;
    const inputBackendExplicit = next.inputBackend !== undefined;
    const resolvedIsolationEnabled = isolationExplicit
      ? next.ffmpegAppIsolationEnabled === true
      : cfg.ffmpegAppIsolationEnabled === true;

    if (resolvedIsolationEnabled && resolvedInputBackend === "portaudio") {
      if (isolationExplicit && next.ffmpegAppIsolationEnabled === true) {
        // User enabled app-isolation: force backend to ffmpeg.
        next.inputBackend = "ffmpeg";
      } else if (inputBackendExplicit && next.inputBackend === "portaudio") {
        // User forced portaudio: disable incompatible app-isolation.
        next.ffmpegAppIsolationEnabled = false;
      } else {
        next.inputBackend = "ffmpeg";
      }
    }

    return next;
  }

  function getConfig() {
    normalizeFfmpegDeviceFields();
    return {
      ...cfg,
      ffmpegInputDevices: normalizeFfmpegDeviceList(cfg.ffmpegInputDevices, []),
      ffmpegAppIsolationPrimaryDevices: normalizeFfmpegDeviceList(cfg.ffmpegAppIsolationPrimaryDevices, []),
      ffmpegAppIsolationFallbackDevices: normalizeFfmpegDeviceList(cfg.ffmpegAppIsolationFallbackDevices, []),
      procTapCaptureLocks: sanitizeProcessLoopbackLockMap(cfg.procTapCaptureLocks)
    };
  }

  function getResolvedFfmpegCaptureDevices() {
    if (cfg.ffmpegAppIsolationEnabled) {
      return normalizeFfmpegDeviceList(appIsolationRuntime.resolvedDevices, []);
    }
    return getConfiguredDefaultFfmpegDevices();
  }

  function parsePowershellJson(text) {
    const raw = String(text || "").trim();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object") return [parsed];
      return [];
    } catch {
      return [];
    }
  }

function summarizeRunningApps(rawList = []) {
    const grouped = new Map();
    for (const item of Array.isArray(rawList) ? rawList : []) {
      const processName = sanitizeAppName(item?.ProcessName || item?.processName || "", "");
      if (!processName) continue;
      const appName = processName.toLowerCase().endsWith(".exe")
        ? processName
        : `${processName}.exe`;
      const key = normalizeAppToken(appName);
      if (!key) continue;
      const title = String(item?.MainWindowTitle || item?.mainWindowTitle || "").trim();
      const pid = Number(item?.Id || item?.id);
      if (!grouped.has(key)) {
        grouped.set(key, {
          app: appName.toLowerCase(),
          processName: processName.toLowerCase(),
          displayName: appName,
          instances: 0,
          pids: [],
          windowTitles: []
        });
      }
      const entry = grouped.get(key);
      entry.instances += 1;
      if (Number.isFinite(pid) && !entry.pids.includes(pid)) {
        entry.pids.push(pid);
      }
      if (title && !entry.windowTitles.includes(title)) {
        entry.windowTitles.push(title);
      }
    }
  return [...grouped.values()]
    .sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));
}

function summarizeRunningProcessTokens(rawList = []) {
  const tokens = new Set();
  for (const item of Array.isArray(rawList) ? rawList : []) {
    const processName = sanitizeAppName(item?.ProcessName || item?.processName || "", "");
    const token = normalizeAppToken(processName);
    if (!token) continue;
    tokens.add(token);
  }
  return [...tokens.values()];
}

  function listRunningApps(options = {}) {
    const timeoutMs = clamp(Math.round(toNum(options.timeoutMs, 2500)), 600, 10000);
    if (process.platform !== "win32") {
      return Promise.resolve({
        ok: false,
        apps: [],
        scannedAt: Date.now(),
        error: "running app scan is currently supported on Windows only"
      });
    }
    const command = "$ErrorActionPreference='Stop'; " +
      "Get-Process | " +
      "Where-Object { $_.ProcessName } | " +
      "Select-Object ProcessName,Id,MainWindowTitle,MainWindowHandle | " +
      "Sort-Object ProcessName | " +
      "ConvertTo-Json -Compress";

    return new Promise(resolve => {
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
        { windowsHide: true, timeout: timeoutMs },
        (error, stdout, stderr) => {
          if (error) {
            resolve({
              ok: false,
              apps: [],
              processTokens: [],
              scannedAt: Date.now(),
              error: String(stderr || stdout || error.message || "app scan failed").trim()
            });
            return;
          }
          const parsed = parsePowershellJson(stdout);
          const apps = summarizeRunningApps(parsed);
          const processTokens = summarizeRunningProcessTokens(parsed);
          resolve({
            ok: true,
            apps,
            processTokens,
            scannedAt: Date.now()
          });
        }
      );
    });
  }

  function resolveCaptureTokenForApp(targetToken, runningSet) {
    const token = normalizeAppToken(targetToken);
    if (!token) return "";
    const lockedToken = resolveLockedCaptureToken(token, cfg.procTapCaptureLocks);
    if (lockedToken) return lockedToken;
    return resolvePreferredCaptureToken(token, runningSet);
  }

  function setProcessLoopbackCaptureLock(sourceToken, captureToken, options = {}) {
    const source = normalizeAppToken(sourceToken);
    const capture = normalizeAppToken(captureToken);
    if (!source || !capture) return false;

    const current = resolveLockedCaptureToken(source, cfg.procTapCaptureLocks);
    if (current === capture) return false;

    const nextLocks = sanitizeProcessLoopbackLockMap({
      ...cfg.procTapCaptureLocks,
      [source]: capture
    });
    cfg.procTapCaptureLocks = nextLocks;
    if (options.persist !== false) {
      cfg.procTapCaptureLocks = writeProcessLoopbackLocks(nextLocks);
    }
    return true;
  }

  function listProcTapAudioProcesses(options = {}) {
    const timeoutMs = clamp(Math.round(toNum(options.timeoutMs, 2400)), 600, 8000);
    if (process.platform !== "win32") {
      return Promise.resolve({
        ok: false,
        scannedAt: Date.now(),
        processes: [],
        error: "process loopback probe is currently supported on Windows only"
      });
    }

    const launcher = String(cfg.procTapLauncher || "py").trim() || "py";
    const args = [];
    if (launcher.toLowerCase() === "py") {
      const pyVersion = String(cfg.procTapPythonVersion || "3.13").trim() || "3.13";
      args.push(`-${pyVersion}`);
    }
    args.push("-m", "proctap", "--list-audio-procs");

    return new Promise(resolve => {
      execFile(
        launcher,
        args,
        { windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          const rawOut = String(stdout || "");
          const rawErr = String(stderr || "");
          const lines = rawOut.split(/\r?\n/g);
          const processes = [];
          for (const line of lines) {
            const trimmed = String(line || "").trim();
            if (!trimmed) continue;
            const match = trimmed.match(/^(\d+)\s+([A-Za-z0-9._-]+(?:\.exe)?)\s+/i);
            if (!match) continue;
            const pid = Number(match[1] || 0);
            const name = sanitizeAppName(match[2] || "", "");
            const token = normalizeAppToken(name);
            if (!token) continue;
            processes.push({
              pid: Number.isFinite(pid) ? pid : 0,
              name: name.toLowerCase().endsWith(".exe") ? name : `${name}.exe`,
              token
            });
          }
          const deduped = [];
          const seen = new Set();
          for (const item of processes) {
            const key = `${item.token}:${item.pid}`;
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(item);
          }
          const errText = String(rawErr || error?.message || "").trim();
          if (error && !deduped.length) {
            resolve({
              ok: false,
              scannedAt: Date.now(),
              processes: [],
              error: errText || "process loopback probe failed"
            });
            return;
          }
          resolve({
            ok: deduped.length > 0,
            scannedAt: Date.now(),
            processes: deduped,
            error: errText
          });
        }
      );
    });
  }

  async function maybeLearnProcessLoopbackCaptureLock(reason = "silence_probe") {
    if (!cfg.ffmpegAppIsolationEnabled) return false;
    const mode = String(appIsolationRuntime.mode || "").trim().toLowerCase();
    if (mode !== "primary" && mode !== "fallback_app") return false;

    const sourceToken = normalizeAppToken(appIsolationRuntime.selectedAppToken);
    if (!sourceToken) return false;
    if (resolveLockedCaptureToken(sourceToken, cfg.procTapCaptureLocks)) return false;
    if (processLoopbackRuntime.probeInFlight) return false;

    const now = Date.now();
    if ((now - processLoopbackRuntime.lastProbeAt) < PROCESS_LOOPBACK_PROBE_COOLDOWN_MS) {
      return false;
    }
    processLoopbackRuntime.lastProbeAt = now;
    processLoopbackRuntime.probeInFlight = true;

    try {
      const probe = await listProcTapAudioProcesses({ timeoutMs: 2600 });
      if (!probe.ok || !Array.isArray(probe.processes) || !probe.processes.length) return false;
      const audioTokens = new Set(probe.processes.map(item => normalizeAppToken(item.token)).filter(Boolean));
      if (!audioTokens.size) return false;

      const preferred = resolvePreferredCaptureToken(sourceToken, audioTokens);
      const candidateToken = audioTokens.has(preferred)
        ? preferred
        : (audioTokens.has(sourceToken) ? sourceToken : "");
      if (!candidateToken) return false;

      const currentCapture = normalizeAppToken(appIsolationRuntime.captureToken || appIsolationRuntime.activeApp);
      const learned = setProcessLoopbackCaptureLock(sourceToken, candidateToken, { persist: true });
      if (!learned && candidateToken === currentCapture) return false;

      appIsolationRuntime.captureToken = candidateToken;
      appIsolationRuntime.activeApp = `${candidateToken}.exe`;
      appIsolationRuntime.activePid = 0;
      if (running) {
        restart(`process loopback lock ${reason}`);
      }
      return true;
    } catch {
      return false;
    } finally {
      processLoopbackRuntime.probeInFlight = false;
    }
  }

  function resetProcessLoopbackRuntime(options = {}) {
    const keepLastProbeAt = options.keepLastProbeAt === true;
    processLoopbackRuntime.streamStartedAt = 0;
    processLoopbackRuntime.silenceSince = 0;
    processLoopbackRuntime.audioSeen = false;
    processLoopbackRuntime.probeInFlight = false;
    if (!keepLastProbeAt) {
      processLoopbackRuntime.lastProbeAt = 0;
    }
  }

  function updateProcessLoopbackSilenceProbeState() {
    if (!shouldUseProcessLoopbackCapture()) return;

    const now = Date.now();
    const rmsGate = Math.max(cfg.noiseFloorMin * 4, 0.0012);
    const peakGate = rmsGate * 3.2;
    const hasAudibleSignal = lastRms >= rmsGate || lastPeak >= peakGate;

    if (hasAudibleSignal) {
      processLoopbackRuntime.audioSeen = true;
      processLoopbackRuntime.silenceSince = 0;
      return;
    }

    if (!processLoopbackRuntime.silenceSince) {
      processLoopbackRuntime.silenceSince = now;
      return;
    }

    const silentFor = now - processLoopbackRuntime.silenceSince;
    const streamAge = processLoopbackRuntime.streamStartedAt
      ? now - processLoopbackRuntime.streamStartedAt
      : 0;
    if (silentFor < PROCESS_LOOPBACK_SILENCE_PROBE_MS) return;
    if (streamAge < PROCESS_LOOPBACK_SILENCE_PROBE_MS) return;
    if (processLoopbackRuntime.probeInFlight) return;
    if ((now - processLoopbackRuntime.lastProbeAt) < PROCESS_LOOPBACK_PROBE_COOLDOWN_MS) return;

    processLoopbackRuntime.silenceSince = now;
    maybeLearnProcessLoopbackCaptureLock("silence_window").catch(() => {});
  }

  function resolveAppIsolationSelection(runningApps = [], options = {}) {
    const defaultDevices = getConfiguredDefaultFfmpegDevices();
    const primaryDevices = normalizeFfmpegDeviceList(cfg.ffmpegAppIsolationPrimaryDevices, defaultDevices);
    const fallbackDevices = normalizeFfmpegDeviceList(cfg.ffmpegAppIsolationFallbackDevices, []);
    const primaryAppRaw = normalizeConfiguredApp(cfg.ffmpegAppIsolationPrimaryApp, "");
    const fallbackAppRaw = normalizeConfiguredApp(cfg.ffmpegAppIsolationFallbackApp, "");
    const primaryApp = normalizeAppToken(primaryAppRaw);
    const fallbackApp = normalizeAppToken(fallbackAppRaw);
    const runningTokens = Array.isArray(options.processTokens)
      ? options.processTokens
      : [];
    const running = new Set(
      (Array.isArray(runningApps) ? runningApps : [])
        .map(app => normalizeAppToken(app?.app || app?.displayName || app?.processName || ""))
        .filter(Boolean)
    );
    const runningPidByToken = new Map();
    const runningPidCountByToken = new Map();
    for (const app of Array.isArray(runningApps) ? runningApps : []) {
      const token = normalizeAppToken(app?.app || app?.displayName || app?.processName || "");
      if (!token) continue;
      const pids = Array.isArray(app?.pids) ? app.pids : [];
      const validPids = pids
        .map(v => Number(v))
        .filter(v => Number.isFinite(v) && v > 0);
      if (!validPids.length) continue;
      if (!runningPidByToken.has(token)) {
        runningPidByToken.set(token, validPids[0]);
      }
      runningPidCountByToken.set(token, validPids.length);
    }
    for (const token of runningTokens) {
      const normalized = normalizeAppToken(token);
      if (!normalized) continue;
      running.add(normalized);
    }
    const hasConfiguredTargets = Boolean(primaryApp || fallbackApp);
    const strictIsolation = cfg.ffmpegAppIsolationStrict === true;

    let mode = "manual";
    let selectedApp = "";
    let selectedAppToken = "";
    let captureToken = "";
    let activeApp = "";
    let activePid = 0;
    let devices = defaultDevices.slice();

    if (cfg.ffmpegAppIsolationEnabled) {
      if (primaryApp && running.has(primaryApp)) {
        selectedAppToken = primaryApp;
        selectedApp = primaryAppRaw || `${primaryApp}.exe`;
        captureToken = resolveCaptureTokenForApp(primaryApp, running) || primaryApp;
        mode = "primary";
        activeApp = `${captureToken}.exe`;
        const capturePidCount = Number(runningPidCountByToken.get(captureToken) || 0);
        // For multi-process apps (e.g. Firefox/Chrome), capture by name so proctap can follow the
        // active audio process instead of pinning to a possibly silent helper/UI PID.
        activePid = capturePidCount === 1
          ? Number(runningPidByToken.get(captureToken) || 0)
          : 0;
        devices = primaryDevices.length ? primaryDevices : defaultDevices.slice();
      } else if (fallbackApp && running.has(fallbackApp)) {
        selectedAppToken = fallbackApp;
        selectedApp = fallbackAppRaw || `${fallbackApp}.exe`;
        captureToken = resolveCaptureTokenForApp(fallbackApp, running) || fallbackApp;
        mode = "fallback_app";
        activeApp = `${captureToken}.exe`;
        const capturePidCount = Number(runningPidCountByToken.get(captureToken) || 0);
        // For multi-process apps (e.g. Firefox/Chrome), capture by name so proctap can follow the
        // active audio process instead of pinning to a possibly silent helper/UI PID.
        activePid = capturePidCount === 1
          ? Number(runningPidByToken.get(captureToken) || 0)
          : 0;
        devices = fallbackDevices.length ? fallbackDevices : defaultDevices.slice();
      } else if (strictIsolation) {
        mode = hasConfiguredTargets ? "awaiting_app" : "strict_missing_target";
        devices = [];
      } else if (fallbackDevices.length) {
        mode = "fallback_devices";
        devices = fallbackDevices.slice();
      } else if (hasConfiguredTargets) {
        mode = "awaiting_app";
        devices = [];
      } else {
        mode = "manual_default";
        devices = defaultDevices.slice();
      }
    }

    if (!cfg.ffmpegAppIsolationMultiSource && devices.length > 1) {
      devices = [devices[0]];
    }
    if (
      !strictIsolation &&
      !devices.length &&
      defaultDevices.length &&
      mode !== "fallback_devices" &&
      mode !== "awaiting_app"
    ) {
      devices = cfg.ffmpegAppIsolationMultiSource
        ? defaultDevices.slice()
        : [defaultDevices[0]];
    }

    return {
      mode,
      selectedApp,
      selectedAppToken,
      captureToken,
      activeApp,
      activePid,
      devices: normalizeFfmpegDeviceList(devices, [])
    };
  }

  async function runAppIsolationScan(options = {}) {
    const reason = String(options.reason || "scan").trim().toLowerCase() || "scan";
    if (appIsolationRuntime.scanPromise && options.force !== true) {
      return appIsolationRuntime.scanPromise;
    }
    appIsolationRuntime.scanPromise = (async () => {
      const scan = Array.isArray(options.apps)
        ? { ok: true, apps: options.apps, scannedAt: Date.now() }
        : await listRunningApps({ timeoutMs: options.timeoutMs });
      appIsolationRuntime.lastScanAt = Number(scan.scannedAt || Date.now());
      if (!scan.ok) {
        appIsolationRuntime.lastError = String(scan.error || "app scan failed");
        scheduleAppIsolationRecoveryScan("scan_error");
        return {
          ok: false,
          error: appIsolationRuntime.lastError,
          scannedAt: appIsolationRuntime.lastScanAt,
          runningApps: [],
          isolation: {
            mode: appIsolationRuntime.mode,
            selectedApp: appIsolationRuntime.selectedApp,
            selectedAppToken: appIsolationRuntime.selectedAppToken,
            captureToken: appIsolationRuntime.captureToken,
            activeApp: appIsolationRuntime.activeApp,
            activePid: Math.max(0, Number(appIsolationRuntime.activePid || 0)),
            devices: appIsolationRuntime.resolvedDevices.slice(),
            strict: cfg.ffmpegAppIsolationStrict === true
          }
        };
      }

      const runningApps = Array.isArray(scan.apps) ? scan.apps : [];
      const processTokens = Array.isArray(scan.processTokens) ? scan.processTokens : [];
      appIsolationRuntime.runningApps = runningApps.slice();
      appIsolationRuntime.lastError = "";
      const resolved = resolveAppIsolationSelection(runningApps, { processTokens });
      const nextKey = [
        resolved.mode,
        normalizeAppToken(resolved.selectedAppToken),
        normalizeAppToken(resolved.captureToken),
        normalizeAppToken(resolved.activeApp),
        String(Math.max(0, Number(resolved.activePid || 0))),
        resolved.devices.join("||"),
        cfg.ffmpegInputFormat,
        cfg.ffmpegAppIsolationMultiSource ? "1" : "0"
      ].join("|");
      const changed = nextKey !== appIsolationRuntime.selectionKey;
      appIsolationRuntime.mode = resolved.mode;
      appIsolationRuntime.selectedApp = resolved.selectedApp;
      appIsolationRuntime.selectedAppToken = normalizeAppToken(resolved.selectedAppToken);
      appIsolationRuntime.captureToken = normalizeAppToken(resolved.captureToken);
      appIsolationRuntime.activeApp = resolved.activeApp;
      appIsolationRuntime.activePid = Math.max(0, Number(resolved.activePid || 0));
      appIsolationRuntime.resolvedDevices = resolved.devices.slice();
      appIsolationRuntime.selectionKey = nextKey;

      const shouldApply = options.apply !== false;
      const backend = resolveAudioBackend();
      const canRestartFfmpeg = Boolean(shouldApply && backend === "ffmpeg" && running);
      const awaitingResolvedSource = Boolean(
        canRestartFfmpeg &&
        !ffmpegProc &&
        lastDeviceId === "ffmpeg:none" &&
        resolved.devices.length > 0
      );
      const switched = Boolean(canRestartFfmpeg && (changed || awaitingResolvedSource));
      if (switched) {
        restart(`ffmpeg app isolation ${reason}`);
      }
      if (resolved.mode === "awaiting_app") {
        scheduleAppIsolationRecoveryScan("awaiting_app_recovery");
      } else {
        stopAppIsolationRecoveryTimer();
      }

      return {
        ok: true,
        scannedAt: appIsolationRuntime.lastScanAt,
        runningApps,
        processTokens,
        switched,
        reason,
        isolation: {
          mode: resolved.mode,
          selectedApp: resolved.selectedApp,
          selectedAppToken: normalizeAppToken(resolved.selectedAppToken),
          captureToken: normalizeAppToken(resolved.captureToken),
          activeApp: resolved.activeApp,
          activePid: Math.max(0, Number(resolved.activePid || 0)),
          devices: resolved.devices.slice(),
          strict: cfg.ffmpegAppIsolationStrict === true
        }
      };
    })();

    try {
      return await appIsolationRuntime.scanPromise;
    } finally {
      appIsolationRuntime.scanPromise = null;
    }
  }

  function stopAppIsolationRecoveryTimer(options = {}) {
    if (appIsolationRuntime.recoveryTimer) {
      clearTimeout(appIsolationRuntime.recoveryTimer);
      appIsolationRuntime.recoveryTimer = null;
    }
    if (options.resetBackoff !== false) {
      appIsolationRuntime.recoveryDelayMs = APP_ISOLATION_RECOVERY_SCAN_MS;
    }
  }

  function scheduleAppIsolationRecoveryScan(reason = "recovery", options = {}) {
    if (!running || !cfg.ffmpegAppIsolationEnabled) return;
    if (appIsolationRuntime.recoveryTimer) return;
    if (options.resetBackoff === true) {
      appIsolationRuntime.recoveryDelayMs = APP_ISOLATION_RECOVERY_SCAN_MS;
    }
    const delayMs = clamp(
      Math.round(toNum(options.delayMs, appIsolationRuntime.recoveryDelayMs)),
      800,
      APP_ISOLATION_RECOVERY_SCAN_MAX_MS
    );
    appIsolationRuntime.recoveryTimer = setTimeout(() => {
      appIsolationRuntime.recoveryTimer = null;
      if (!running || !cfg.ffmpegAppIsolationEnabled) return;
      runAppIsolationScan({ reason, apply: true, force: true })
        .then(result => {
          const mode = String(result?.isolation?.mode || appIsolationRuntime.mode || "").trim().toLowerCase();
          if (mode === "awaiting_app") {
            appIsolationRuntime.recoveryDelayMs = clamp(
              Math.round(delayMs * 1.4),
              APP_ISOLATION_RECOVERY_SCAN_MS,
              APP_ISOLATION_RECOVERY_SCAN_MAX_MS
            );
            scheduleAppIsolationRecoveryScan("awaiting_app_recovery");
            return;
          }
          appIsolationRuntime.recoveryDelayMs = APP_ISOLATION_RECOVERY_SCAN_MS;
        })
        .catch(() => {
          appIsolationRuntime.recoveryDelayMs = clamp(
            Math.round(delayMs * 1.5),
            APP_ISOLATION_RECOVERY_SCAN_MS,
            APP_ISOLATION_RECOVERY_SCAN_MAX_MS
          );
          scheduleAppIsolationRecoveryScan("scan_retry");
        });
    }, delayMs);
    appIsolationRuntime.recoveryTimer.unref?.();
  }

  function stopAppIsolationTimer() {
    if (appIsolationRuntime.intervalTimer) {
      clearInterval(appIsolationRuntime.intervalTimer);
      appIsolationRuntime.intervalTimer = null;
    }
    stopAppIsolationRecoveryTimer();
  }

  function startAppIsolationTimer() {
    stopAppIsolationTimer();
    if (!running || !cfg.ffmpegAppIsolationEnabled) return;
    const intervalMs = clamp(Math.round(toNum(cfg.ffmpegAppIsolationCheckMs, 300000)), 60000, 1800000);
    appIsolationRuntime.intervalTimer = setInterval(() => {
      runAppIsolationScan({ reason: "timer", apply: true }).catch(() => {});
    }, intervalMs);
    appIsolationRuntime.intervalTimer.unref?.();
  }

  function resolveAudioBackend() {
    if (cfg.ffmpegAppIsolationEnabled === true) {
      return "ffmpeg";
    }
    const preferred = String(cfg.inputBackend || "auto").trim().toLowerCase();
    const ffmpegConfigured = getResolvedFfmpegCaptureDevices().length > 0;

    if (preferred === "ffmpeg") return "ffmpeg";
    if (preferred === "portaudio") return "portaudio";
    if (ffmpegConfigured) return "ffmpeg";
    return "portaudio";
  }

  function formatFfmpegInputSpec(deviceValue = "") {
    const format = String(cfg.ffmpegInputFormat || "dshow").trim().toLowerCase();
    const rawDevice = String(deviceValue || "").trim();
    if (!rawDevice) return "";
    if (format === "dshow") {
      return rawDevice.toLowerCase().startsWith("audio=")
        ? rawDevice
        : `audio=${rawDevice}`;
    }
    return rawDevice;
  }

  function listDevices() {
    const out = [];
    if (naudiodon) {
      const devices = naudiodon.getDevices();
      out.push(
        ...devices
          .filter(d => d.maxInputChannels > 0)
          .map(d => ({
            id: d.id,
            name: d.name,
            hostAPIName: d.hostAPIName,
            maxInputChannels: d.maxInputChannels,
            backend: "portaudio"
          }))
      );
    }

    const ffmpegDevices = getResolvedFfmpegCaptureDevices();
    if (ffmpegDevices.length) {
      for (let i = ffmpegDevices.length - 1; i >= 0; i -= 1) {
        const name = ffmpegDevices[i];
        out.unshift({
          id: i === 0 ? "ffmpeg" : `ffmpeg:${i}`,
          name,
          hostAPIName: `ffmpeg:${cfg.ffmpegInputFormat || "dshow"}`,
          maxInputChannels: cfg.channels,
          backend: "ffmpeg"
        });
      }
    }

    return out;
  }

  /* =========================
     ENERGY STATE
  ========================= */
  let fast = 0;
  let mid = 0;
  let slow = 0;
  let transient = 0;
  let prevFast = 0;
  let peakHold = 0;
  let tick = 0;

  // Adaptive normalization state
  let adaptiveFloor = cfg.noiseFloorMin;
  let adaptiveCeil = 0.025;

  // Extra descriptors for telemetry and future logic
  let lastRms = 0;
  let lastPeak = 0;
  let lastZcr = 0;
  let lastLevelRaw = 0;
  let lastLevel = 0;
  let lastDeviceName = "";
  let lastBandLow = 0;
  let lastBandMid = 0;
  let lastBandHigh = 0;
  let lastSpectralFlux = 0;
  let inputLoudnessEma = 0;
  let autoLevelGain = 1;
  let effectiveOutputGain = 1;

  // Band splitting state
  let lpLow = 0;
  let lpMid = 0;
  let prevBandLowRaw = 0;
  let prevBandMidRaw = 0;
  let prevBandHighRaw = 0;

  /* =========================
     ENVELOPE SHAPING
  ========================= */
  const FAST_ATTACK = 0.68;
  const FAST_RELEASE = 0.24;

  const MID_ATTACK = 0.24;
  const MID_RELEASE = 0.11;

  const SLOW_ATTACK = 0.055;
  const SLOW_RELEASE = 0.038;

  /* =========================
     OPTIONAL HOOKS
  ========================= */
  const hooks = {
    onFast: null,
    onMid: null,
    onSlow: null,
    onTransient: null,
    onLevel: null,
    onStats: null
  };

  const requestedBackend = resolveAudioBackend();
  const ffmpegDefaultDevices = getResolvedFfmpegCaptureDevices();
  const ffmpegInputSpec = ffmpegDefaultDevices.length
    ? formatFfmpegInputSpec(ffmpegDefaultDevices[0])
    : "";
  const ffmpegCaptureReady = requestedBackend === "ffmpeg" && Boolean(ffmpegInputSpec);
  const allowRuntimeBackendSwitch = toBool(process.env.RAVE_AUDIO_ALLOW_RUNTIME_BACKEND_SWITCH, true);

  if (!allowRuntimeBackendSwitch && !naudiodon && !ffmpegCaptureReady) {
    const missingReason = naudiodonLoadError?.message || String(naudiodonLoadError || "module not found");
    const missingDriverError =
      `naudiodon unavailable (${missingReason}); ` +
      `set ffmpeg backend + input device to capture via ffmpeg`;
    lastError = missingDriverError;
    console.warn(`[AUDIO] ${missingDriverError}; audio reactivity disabled`);

    function setConfigFallback(patch = {}) {
      const normalized = normalizeCfgPatch(patch);
      const keys = Object.keys(normalized);
      for (const key of keys) {
        cfg[key] = normalized[key];
      }
      normalizeFfmpegDeviceFields();
      startAppIsolationTimer();
      if (cfg.ffmpegAppIsolationEnabled) {
        runAppIsolationScan({ reason: "config", apply: false, force: true }).catch(() => {});
      }
      return {
        ok: true,
        changed: keys,
        config: getConfig(),
        restarted: false
      };
    }

    function getTelemetryFallback() {
      return {
        running,
        driverAvailable: false,
        driverError: missingDriverError,
        backend: "none",
        device: null,
        deviceId: null,
        restartPending: false,
        processLoopbackActive: false,
        watchdogMs: cfg.watchdogMs,
        msSinceData: null,
        watchdogTrips: 0,
        lastRestartReason,
        lastError,
        rms: 0,
        peak: 0,
        zcr: 0,
        levelRaw: 0,
        level: 0,
        bandLow: 0,
        bandMid: 0,
        bandHigh: 0,
        spectralFlux: 0,
        fast: 0,
        mid: 0,
        slow: 0,
        transient: 0,
        inputLoudnessEma: 0,
        autoLevelGain: 1,
        effectiveOutputGain: cfg.outputGain,
        autoLevelEnabled: cfg.autoLevelEnabled === true,
        autoLevelTargetRms: cfg.autoLevelTargetRms,
        adaptiveFloor: cfg.noiseFloorMin,
        adaptiveCeil: 0,
        appIsolation: {
          enabled: cfg.ffmpegAppIsolationEnabled === true,
          primaryApp: cfg.ffmpegAppIsolationPrimaryApp || "",
          fallbackApp: cfg.ffmpegAppIsolationFallbackApp || "",
          selectedApp: appIsolationRuntime.selectedApp || "",
          selectedAppToken: appIsolationRuntime.selectedAppToken || "",
          captureToken: appIsolationRuntime.captureToken || "",
          mode: appIsolationRuntime.mode,
          activeApp: appIsolationRuntime.activeApp || "",
          activePid: Math.max(0, Number(appIsolationRuntime.activePid || 0)),
          resolvedDevices: normalizeFfmpegDeviceList(appIsolationRuntime.resolvedDevices, []),
          strict: cfg.ffmpegAppIsolationStrict === true,
          multiSource: cfg.ffmpegAppIsolationMultiSource === true,
          checkMs: cfg.ffmpegAppIsolationCheckMs,
          lastScanAt: appIsolationRuntime.lastScanAt || 0,
          lastError: appIsolationRuntime.lastError || "",
          runningAppsCount: Array.isArray(appIsolationRuntime.runningApps)
            ? appIsolationRuntime.runningApps.length
            : 0
        },
        config: getConfig()
      };
    }

    function startFallback() {
      if (running) return;
      running = true;
      startAppIsolationTimer();
      if (cfg.ffmpegAppIsolationEnabled) {
        runAppIsolationScan({ reason: "start", apply: false, force: true }).catch(() => {});
      }
      onLevel(0);
      hooks.onLevel?.(0);
      hooks.onStats?.(getTelemetryFallback());
    }

    function stopFallback() {
      if (!running) return;
      running = false;
      stopAppIsolationTimer();
    }

    function restartFallback(reason = "manual") {
      lastRestartReason = reason;
      return { ok: true, restarted: false, reason };
    }

    return {
      start: startFallback,
      stop: stopFallback,
      onFast(fn) { hooks.onFast = fn; },
      onMid(fn) { hooks.onMid = fn; },
      onSlow(fn) { hooks.onSlow = fn; },
      onTransient(fn) { hooks.onTransient = fn; },
      onLevel(fn) { hooks.onLevel = fn; },
      onStats(fn) { hooks.onStats = fn; },
      getConfig,
      setConfig: setConfigFallback,
      listDevices() { return []; },
      listRunningApps,
      scanFfmpegAppIsolation(options = {}) {
        return runAppIsolationScan({ ...(options || {}), apply: false, force: true });
      },
      restart: restartFallback,
      getTelemetry: getTelemetryFallback
    };
  }

  function resetState() {
    fast = 0;
    mid = 0;
    slow = 0;
    transient = 0;
    prevFast = 0;
    peakHold = 0;
    tick = 0;

    adaptiveFloor = cfg.noiseFloorMin;
    adaptiveCeil = 0.025;

    lastRms = 0;
    lastPeak = 0;
    lastZcr = 0;
    lastLevelRaw = 0;
    lastLevel = 0;
    lastBandLow = 0;
    lastBandMid = 0;
    lastBandHigh = 0;
    lastSpectralFlux = 0;
    inputLoudnessEma = 0;
    autoLevelGain = 1;
    effectiveOutputGain = cfg.outputGain;

    lpLow = 0;
    lpMid = 0;
    prevBandLowRaw = 0;
    prevBandMidRaw = 0;
    prevBandHighRaw = 0;
    ffmpegBufferCarry = Buffer.alloc(0);
    procTapBufferCarry = Buffer.alloc(0);
    activeInputSampleRate = cfg.sampleRate;
    lastDataAt = 0;
    watchdogTrips = 0;
    resetProcessLoopbackRuntime({ keepLastProbeAt: true });
  }

  function chooseInputDevice(devices) {
    const inputDevices = devices.filter(d => d.maxInputChannels > 0);
    if (!inputDevices.length) return null;

    if (cfg.deviceId !== null) {
      const byId = inputDevices.find(d => Number(d.id) === cfg.deviceId);
      if (byId) return byId;
      console.warn(`[AUDIO] configured device id ${cfg.deviceId} not found; falling back`);
    }

    if (cfg.deviceMatch) {
      const preferred = inputDevices.find(
        d => d.name && d.name.toLowerCase().includes(cfg.deviceMatch)
      );
      if (preferred) return preferred;
      console.warn(`[AUDIO] device match "${cfg.deviceMatch}" not found; falling back to auto-select`);
    }

    const autoPriorityKeywords = [
      "loopback",
      "stereo mix",
      "what u hear",
      "cable output",
      "virtual cable",
      "monitor of",
      "mix"
    ];
    const autoPreferred = inputDevices.find(device => {
      const name = String(device.name || "").toLowerCase();
      return autoPriorityKeywords.some(keyword => name.includes(keyword));
    });

    return autoPreferred || inputDevices[0];
  }

  function closeStream() {
    if (stream) {
      try {
        stream.removeAllListeners?.();
      } catch {}
      try {
        stream.quit?.();
      } catch {}
      stream = null;
    }

    if (ffmpegProc) {
      const proc = ffmpegProc;
      ffmpegProc = null;
      ffmpegBufferCarry = Buffer.alloc(0);
      try {
        proc.stdout?.removeAllListeners?.();
      } catch {}
      try {
        proc.stderr?.removeAllListeners?.();
      } catch {}
      try {
        proc.removeAllListeners?.();
      } catch {}
      try {
        proc.kill("SIGTERM");
      } catch {}
    }

    if (procTapProc) {
      const proc = procTapProc;
      procTapProc = null;
      procTapBufferCarry = Buffer.alloc(0);
      try {
        proc.stdout?.removeAllListeners?.();
      } catch {}
      try {
        proc.stderr?.removeAllListeners?.();
      } catch {}
      try {
        proc.removeAllListeners?.();
      } catch {}
      try {
        proc.kill("SIGTERM");
      } catch {}
    }
    resetProcessLoopbackRuntime({ keepLastProbeAt: true });
  }

  function stopWatchdog() {
    if (watchdogTimer) {
      clearInterval(watchdogTimer);
      watchdogTimer = null;
    }
  }

  function startWatchdog() {
    stopWatchdog();

    const intervalMs = clamp(Math.round(cfg.watchdogMs / 3), 250, 1000);
    watchdogTimer = setInterval(() => {
      if (!running || (!stream && !ffmpegProc && !procTapProc) || !lastDataAt) return;

      const silentMs = Date.now() - lastDataAt;
      if (silentMs < cfg.watchdogMs) return;

      watchdogTrips++;
      lastError = `stream stalled (${silentMs}ms without audio data)`;
      console.warn(`[AUDIO] watchdog: ${lastError}`);
      closeStream();
      scheduleRestart("watchdog stall");
    }, intervalMs);
  }

  function scheduleRestart(reason) {
    if (!running) return;
    if (restartTimer) return;

    lastRestartReason = reason;
    stopWatchdog();
    console.warn(`[AUDIO] restart scheduled (${reason}) in ${cfg.restartMs}ms`);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (!running) return;
      openStream();
    }, cfg.restartMs);
  }

  function emitSilenceSnapshot() {
    resetState();
    onLevel(0);
    hooks.onFast?.(0);
    hooks.onMid?.(0);
    hooks.onSlow?.(0);
    hooks.onTransient?.(0);
    hooks.onLevel?.(0);
    hooks.onStats?.(getTelemetry());
  }

  function processBuffer(buffer, channels) {
    let sumSq = 0;
    let peak = 0;
    let count = 0;
    let zeroCrosses = 0;
    let prevSample = 0;
    let prevSet = false;
    const stride = channels * 4;
    let lowSq = 0;
    let midSq = 0;
    let highSq = 0;
    const lowHz = clamp(cfg.bandLowHz, 60, 500);
    const midHz = Math.max(lowHz + 100, clamp(cfg.bandMidHz, 700, 8000));
    const inputSampleRate = Math.max(8000, Number(activeInputSampleRate || cfg.sampleRate || 48000));
    const lowAlpha = 1 - Math.exp((-2 * Math.PI * lowHz) / inputSampleRate);
    const midAlpha = 1 - Math.exp((-2 * Math.PI * midHz) / inputSampleRate);
    const frameCount = Math.floor(buffer.length / stride);
    if (!frameCount) return;
    const sampleCount = frameCount * channels;
    let sampleView = null;
    if ((buffer.byteOffset & 3) === 0) {
      try {
        sampleView = new Float32Array(buffer.buffer, buffer.byteOffset, sampleCount);
      } catch {
        sampleView = null;
      }
    }

    for (let frame = 0; frame < frameCount; frame++) {
      const base = frame * channels;
      let s = 0;
      if (sampleView) {
        for (let c = 0; c < channels; c++) {
          s += sampleView[base + c];
        }
      } else {
        const byteBase = frame * stride;
        for (let c = 0; c < channels; c++) {
          s += buffer.readFloatLE(byteBase + c * 4);
        }
      }
      s /= channels;

      const a = Math.abs(s);
      if (a > peak) peak = a;
      sumSq += s * s;

      if (prevSet && ((s >= 0 && prevSample < 0) || (s < 0 && prevSample >= 0))) {
        zeroCrosses++;
      }
      prevSample = s;
      prevSet = true;
      count++;

      // Simple crossover split:
      // low = LP(lowCut), mid = LP(midCut) - LP(lowCut), high = input - LP(midCut)
      lpLow += (s - lpLow) * lowAlpha;
      lpMid += (s - lpMid) * midAlpha;

      const lowBand = lpLow;
      const midBand = lpMid - lpLow;
      const highBand = s - lpMid;

      lowSq += lowBand * lowBand;
      midSq += midBand * midBand;
      highSq += highBand * highBand;
    }

    if (!count) return;

    const rms = Math.sqrt(sumSq / count);
    const zcr = zeroCrosses / count;
    const lowRms = Math.sqrt(lowSq / count);
    const midRms = Math.sqrt(midSq / count);
    const highRms = Math.sqrt(highSq / count);
    const bandMagnitude = lowRms + midRms + highRms;
    const absoluteQuietGate = Math.max(cfg.noiseFloorMin * 8, 0.0045);
    const absoluteQuiet =
      rms < absoluteQuietGate &&
      peak < absoluteQuietGate * 3;

    const bandSum = bandMagnitude + 1e-6;
    let bandLowRaw = clamp(lowRms / bandSum, 0, 1);
    let bandMidRaw = clamp(midRms / bandSum, 0, 1);
    let bandHighRaw = clamp(highRms / bandSum, 0, 1);
    if (bandMagnitude < absoluteQuietGate * 1.4 || absoluteQuiet) {
      bandLowRaw = 0;
      bandMidRaw = 0;
      bandHighRaw = 0;
    }

    const fluxRaw =
      Math.max(0, bandLowRaw - prevBandLowRaw) +
      Math.max(0, bandMidRaw - prevBandMidRaw) +
      Math.max(0, bandHighRaw - prevBandHighRaw);
    let fluxNorm = clamp(fluxRaw * 2.4, 0, 1);
    if (absoluteQuiet) {
      fluxNorm = 0;
    }

    prevBandLowRaw = bandLowRaw;
    prevBandMidRaw = bandMidRaw;
    prevBandHighRaw = bandHighRaw;

    lastRms = rms;
    lastPeak = peak;
    lastZcr = zcr;
    lastBandLow += (bandLowRaw - lastBandLow) * (bandLowRaw > lastBandLow ? 0.45 : 0.18);
    lastBandMid += (bandMidRaw - lastBandMid) * (bandMidRaw > lastBandMid ? 0.45 : 0.18);
    lastBandHigh += (bandHighRaw - lastBandHigh) * (bandHighRaw > lastBandHigh ? 0.45 : 0.18);
    lastSpectralFlux += (fluxNorm - lastSpectralFlux) * 0.34;
    const loudnessTarget = absoluteQuiet ? 0 : rms;
    const loudnessLerp = absoluteQuiet
      ? 0.002
      : (loudnessTarget > inputLoudnessEma ? 0.05 : 0.012);
    inputLoudnessEma += (loudnessTarget - inputLoudnessEma) * loudnessLerp;
    inputLoudnessEma = clamp(inputLoudnessEma, 0, 1);

    // Floor tracks quiet passages quickly and loud passages slowly.
    const floorLerp = rms < adaptiveFloor * 1.5 ? 0.03 : 0.003;
    adaptiveFloor += (rms - adaptiveFloor) * floorLerp;
    adaptiveFloor = Math.max(cfg.noiseFloorMin, adaptiveFloor);

    const gated = Math.max(0, rms - adaptiveFloor * 1.12);

    // Ceiling tracks peaks quickly and releases slowly.
    const ceilingTarget = Math.max(gated * 2.6, peak * 0.9, cfg.noiseFloorMin * 5);
    const ceilLerp = ceilingTarget > adaptiveCeil ? 0.08 : 0.004;
    adaptiveCeil += (ceilingTarget - adaptiveCeil) * ceilLerp;
    adaptiveCeil = clamp(adaptiveCeil, 0.01, 0.65);

    const normalized = clamp(gated / (adaptiveCeil + 1e-6), 0, 1);

    // Envelopes run on normalized energy for better consistency across tracks.
    if (absoluteQuiet) {
      // Collapse stale envelope memory when input is effectively silence/noise floor.
      fast *= 0.7;
      mid *= 0.78;
      slow *= 0.86;
      transient *= 0.62;
      peakHold *= 0.74;
    } else {
      fast += (normalized - fast) * (normalized > fast ? FAST_ATTACK : FAST_RELEASE);
      mid += (normalized - mid) * (normalized > mid ? MID_ATTACK : MID_RELEASE);
      slow += (normalized - slow) * (normalized > slow ? SLOW_ATTACK : SLOW_RELEASE);
    }

    const deltaFast = fast - prevFast;
    prevFast = fast;

    const transientRaw = Math.max(0, deltaFast * 2.3);
    transient += (transientRaw - transient) * 0.45;

    peakHold = Math.max(fast, peakHold * cfg.peakDecay);

    const crest = clamp(peak / (rms + 1e-6), 1, 6);
    const zcrBias = clamp(zcr * 4, 0, 1);
    const punch = clamp(transient * 1.1 + (crest - 1) * 0.08 + zcrBias * 0.06, 0, 1);

    let level =
      peakHold * 2.25 +
      transient * 1.55 +
      mid * 1.35 +
      slow * 1.1 +
      punch * 0.35;

    let autoGainTarget = 1;
    if (cfg.autoLevelEnabled) {
      const loudnessGate = Math.max(cfg.autoLevelGate, cfg.noiseFloorMin * 8, 0.001);
      if (!absoluteQuiet && inputLoudnessEma > loudnessGate) {
        autoGainTarget = clamp(
          cfg.autoLevelTargetRms / Math.max(inputLoudnessEma, 1e-6),
          cfg.autoLevelMinGain,
          cfg.autoLevelMaxGain
        );
      } else {
        autoGainTarget = 1;
      }
    }
    const autoGainLerp = cfg.autoLevelEnabled
      ? (autoGainTarget > autoLevelGain
          ? cfg.autoLevelResponse
          : Math.max(0.004, cfg.autoLevelResponse * 0.55))
      : 0.08;
    autoLevelGain += (autoGainTarget - autoLevelGain) * autoGainLerp;
    autoLevelGain = clamp(autoLevelGain, 0.2, 4);
    effectiveOutputGain = cfg.outputGain * (cfg.autoLevelEnabled ? autoLevelGain : 1);

    let levelRaw = level * effectiveOutputGain;
    if (absoluteQuiet) {
      levelRaw *= 0.16;
    }
    level = clamp(
      softLimit01(levelRaw, cfg.limiterThreshold, cfg.limiterKnee),
      0,
      1
    );
    if (absoluteQuiet && level < 0.03) level = 0;
    if (level < 0.001) level = 0;
    lastLevelRaw = levelRaw;
    lastLevel = level;

    tick += 1;
    if (AUDIO_VERBOSE_LOGS && (tick % cfg.logEveryTicks) === 0) {
      console.log(
        "[AUDIO]",
        "rms:", rms.toFixed(4),
        "floor:", adaptiveFloor.toFixed(4),
        "ceil:", adaptiveCeil.toFixed(4),
        "fast:", fast.toFixed(3),
        "mid:", mid.toFixed(3),
        "slow:", slow.toFixed(3),
        "bLow:", lastBandLow.toFixed(2),
        "bMid:", lastBandMid.toFixed(2),
        "bHigh:", lastBandHigh.toFixed(2),
        "flux:", lastSpectralFlux.toFixed(2),
        "tr:", transient.toFixed(3),
        "raw:", levelRaw.toFixed(3),
        "autoGain:", autoLevelGain.toFixed(3),
        "effGain:", effectiveOutputGain.toFixed(3),
        "lvl:", level.toFixed(3)
      );
    }

    // Primary level callback
    onLevel(level);

    // Existing hooks
    hooks.onFast?.(fast);
    hooks.onMid?.(mid);
    hooks.onSlow?.(slow);
    hooks.onTransient?.(transient);

    // New hooks
    hooks.onLevel?.(level);
    hooks.onStats?.(getTelemetry());
  }

  function shouldUseProcessLoopbackCapture() {
    if (!cfg.ffmpegAppIsolationEnabled) return false;
    const mode = String(appIsolationRuntime.mode || "").trim().toLowerCase();
    return mode === "primary" || mode === "fallback_app";
  }

  function openProcessLoopbackStream() {
    const targetPid = Math.max(0, Number(appIsolationRuntime.activePid || 0));
    const targetApp = sanitizeAppName(appIsolationRuntime.activeApp || "", "");
    if (!(targetPid > 0) && !targetApp) {
      return false;
    }

    const launcher = String(cfg.procTapLauncher || "py").trim() || "py";
    const args = [];
    if (launcher.toLowerCase() === "py") {
      const pyVersion = String(cfg.procTapPythonVersion || "3.13").trim() || "3.13";
      args.push(`-${pyVersion}`);
    }
    args.push("-m", "proctap");
    if (targetPid > 0) {
      args.push("--pid", String(targetPid));
    } else {
      args.push("--name", targetApp);
    }
    args.push("--stdout", "--format", "float32", "--resample-quality", "medium");

    let proc = null;
    try {
      proc = spawn(launcher, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (err) {
      lastError = err.message || String(err);
      console.error("[AUDIO] process loopback spawn failed:", err.message || err);
      scheduleRestart("process loopback spawn failure");
      return true;
    }

    procTapProc = proc;
    procTapBufferCarry = Buffer.alloc(0);
    resetProcessLoopbackRuntime({ keepLastProbeAt: true });
    processLoopbackRuntime.streamStartedAt = Date.now();
    activeInputSampleRate = 48000;
    lastBackend = "proctap";
    lastDeviceName = targetPid > 0
      ? `process:${targetApp || "pid"}#${targetPid}`
      : `process:${targetApp}`;
    lastDeviceId = targetPid > 0
      ? `proctap:${targetPid}`
      : `proctap:${normalizeAppToken(targetApp) || "app"}`;
    const channels = 2;
    const frameBytes = channels * 4;
    let procTapFatalMissing = false;

    console.log(
      `[AUDIO] using process loopback: ${lastDeviceName} (${channels}ch @ ${activeInputSampleRate}Hz)`
    );

    proc.stdout.on("data", chunk => {
      try {
        lastDataAt = Date.now();
        const merged = procTapBufferCarry.length
          ? Buffer.concat([procTapBufferCarry, chunk])
          : chunk;
        const usableBytes = merged.length - (merged.length % frameBytes);
        if (usableBytes <= 0) {
          procTapBufferCarry = merged;
          return;
        }
        const usable = merged.subarray(0, usableBytes);
        procTapBufferCarry = usableBytes < merged.length
          ? merged.subarray(usableBytes)
          : Buffer.alloc(0);
        processBuffer(usable, channels);
        updateProcessLoopbackSilenceProbeState();
      } catch (err) {
        console.error("[AUDIO] process loopback decode error:", err.message || err);
      }
    });

    proc.stderr.on("data", data => {
      const msg = String(data || "").trim();
      if (!msg) return;
      if (/error/i.test(msg)) {
        lastError = msg;
      }
      if (
        /No module named/i.test(msg) ||
        /could not be imported/i.test(msg) ||
        /not recognized as an internal or external command/i.test(msg)
      ) {
        procTapFatalMissing = true;
      }
      if (AUDIO_VERBOSE_LOGS) {
        console.warn(`[AUDIO][PROCTAP] ${msg}`);
      }
    });

    proc.on("error", err => {
      if (procTapProc !== proc) return;
      lastError = err.message || String(err);
      console.error("[AUDIO] process loopback runtime error:", err.message || err);
      closeStream();
      if (String(err?.code || "").trim().toUpperCase() === "ENOENT") {
        emitSilenceSnapshot();
        return;
      }
      scheduleRestart("process loopback runtime error");
    });

    proc.on("close", (code, signal) => {
      if (procTapProc !== proc) return;
      procTapProc = null;
      procTapBufferCarry = Buffer.alloc(0);
      resetProcessLoopbackRuntime({ keepLastProbeAt: true });
      lastError = `process loopback exited (code=${code}, signal=${signal || "none"})`;
      if (Number(code) !== 0 || AUDIO_VERBOSE_LOGS) {
        console.warn(`[AUDIO] ${lastError}`);
      }
      if (procTapFatalMissing) {
        emitSilenceSnapshot();
        return;
      }
      if (cfg.ffmpegAppIsolationEnabled) {
        scheduleAppIsolationRecoveryScan("process_loopback_exit", { resetBackoff: true, delayMs: 900 });
      }
      scheduleRestart("process loopback exited");
    });

    lastDataAt = Date.now();
    startWatchdog();
    console.log("[AUDIO] process loopback stream started");
    return true;
  }

  function openStream() {
    closeStream();
    lastError = null;
    const backend = resolveAudioBackend();
    lastBackend = backend;

    if (backend === "ffmpeg") {
      if (shouldUseProcessLoopbackCapture()) {
        const startedProcessLoopback = openProcessLoopbackStream();
        if (startedProcessLoopback) {
          return;
        }
      }
      const resolvedDevices = getResolvedFfmpegCaptureDevices();
      const ffmpegInputs = resolvedDevices
        .map(device => formatFfmpegInputSpec(device))
        .filter(Boolean);
      if (!ffmpegInputs.length) {
        if (cfg.ffmpegAppIsolationEnabled) {
          lastDeviceName = `${cfg.ffmpegInputFormat || "dshow"}:awaiting-app-source`;
          lastDeviceId = "ffmpeg:none";
          lastError = "ffmpeg app isolation active but no source device resolved";
          console.warn("[AUDIO] ffmpeg app isolation has no active source device; waiting for configured app/source");
          scheduleAppIsolationRecoveryScan("awaiting_source", { resetBackoff: true });
          emitSilenceSnapshot();
          return;
        }
        lastError = "ffmpeg input device missing";
        console.error("[AUDIO] ffmpeg backend selected but no ffmpegInputDevice configured");
        scheduleRestart("ffmpeg input missing");
        return;
      }

      const channels = Math.max(1, Math.min(8, Math.round(Number(cfg.channels) || 2)));
      activeInputSampleRate = cfg.sampleRate;
      const ffmpegArgs = [
        "-hide_banner",
        "-loglevel", cfg.ffmpegLogLevel || "error",
        ...(cfg.ffmpegUseWallclock ? ["-use_wallclock_as_timestamps", "1"] : [])
      ];
      const ffmpegFormat = cfg.ffmpegInputFormat || "dshow";
      for (const input of ffmpegInputs) {
        ffmpegArgs.push("-f", ffmpegFormat, "-i", input);
      }
      if (ffmpegInputs.length > 1) {
        const inputRefs = ffmpegInputs.map((_, idx) => `[${idx}:a]`).join("");
        ffmpegArgs.push(
          "-filter_complex",
          `${inputRefs}amix=inputs=${ffmpegInputs.length}:normalize=0:dropout_transition=0[aout]`,
          "-map",
          "[aout]"
        );
      }
      ffmpegArgs.push(
        "-ac", String(channels),
        "-ar", String(cfg.sampleRate),
        "-f", "f32le",
        "-"
      );

      lastDeviceName = `${ffmpegFormat}:${resolvedDevices.join(" + ")}`;
      lastDeviceId = "ffmpeg";
      console.log(
        `[AUDIO] using ffmpeg: ${lastDeviceName} (${channels}ch @ ${cfg.sampleRate}Hz, fpb=${cfg.framesPerBuffer}, sources=${ffmpegInputs.length})`
      );

      let proc = null;
      try {
        proc = spawn(cfg.ffmpegPath || "ffmpeg", ffmpegArgs, {
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"]
        });
      } catch (err) {
        lastError = err.message || String(err);
        console.error("[AUDIO] ffmpeg spawn failed:", err.message || err);
        scheduleRestart("ffmpeg spawn failure");
        return;
      }

      ffmpegProc = proc;
      ffmpegBufferCarry = Buffer.alloc(0);
      const frameBytes = channels * 4;

      proc.stdout.on("data", chunk => {
        try {
          lastDataAt = Date.now();
          const merged = ffmpegBufferCarry.length
            ? Buffer.concat([ffmpegBufferCarry, chunk])
            : chunk;
          const usableBytes = merged.length - (merged.length % frameBytes);
          if (usableBytes <= 0) {
            ffmpegBufferCarry = merged;
            return;
          }
          const usable = merged.subarray(0, usableBytes);
          ffmpegBufferCarry = usableBytes < merged.length
            ? merged.subarray(usableBytes)
            : Buffer.alloc(0);
          processBuffer(usable, channels);
        } catch (err) {
          console.error("[AUDIO] ffmpeg process error:", err.message || err);
        }
      });

      proc.stderr.on("data", data => {
        const msg = String(data || "").trim();
        if (!msg) return;
        if (AUDIO_VERBOSE_LOGS) {
          console.warn(`[AUDIO][FFMPEG] ${msg}`);
        }
      });

      proc.on("error", err => {
        if (ffmpegProc !== proc) return;
        lastError = err.message || String(err);
        console.error("[AUDIO] ffmpeg runtime error:", err.message || err);
        closeStream();
        scheduleRestart("ffmpeg runtime error");
      });

      proc.on("close", (code, signal) => {
        if (ffmpegProc !== proc) return;
        ffmpegProc = null;
        ffmpegBufferCarry = Buffer.alloc(0);
        lastError = `ffmpeg exited (code=${code}, signal=${signal || "none"})`;
        console.warn(`[AUDIO] ${lastError}`);
        if (cfg.ffmpegAppIsolationEnabled) {
          scheduleAppIsolationRecoveryScan("ffmpeg_exit", { resetBackoff: true, delayMs: 900 });
        }
        scheduleRestart("ffmpeg exited");
      });

      lastDataAt = Date.now();
      startWatchdog();
      console.log("[AUDIO] ffmpeg stream started");
      return;
    }

    if (!naudiodon) {
      const err = naudiodonLoadError?.message || "naudiodon not available";
      lastError = err;
      console.error("[AUDIO] portaudio backend unavailable:", err);
      return;
    }

    let devices;
    try {
      devices = naudiodon.getDevices();
    } catch (err) {
      lastError = err.message || String(err);
      console.error("[AUDIO] device scan failed:", err.message || err);
      scheduleRestart("device scan failure");
      return;
    }

    if (AUDIO_VERBOSE_LOGS) {
      console.log("[AUDIO] scanning devices...");
      devices.forEach(d => {
        console.log(`- ${d.name} | API=${d.hostAPIName} | in=${d.maxInputChannels}`);
      });
    }

    const input = chooseInputDevice(devices);
    if (!input) {
      lastError = "no input devices available";
      console.error("[AUDIO] no input devices available");
      scheduleRestart("no input devices");
      return;
    }

    const channels = Math.max(1, Math.min(cfg.channels, input.maxInputChannels));
    activeInputSampleRate = cfg.sampleRate;
    lastDeviceName = input.name || `device:${input.id}`;
    lastDeviceId = input.id;

    console.log(
      `[AUDIO] using: ${lastDeviceName} (${channels}ch @ ${cfg.sampleRate}Hz, fpb=${cfg.framesPerBuffer})`
    );

    try {
      stream = new naudiodon.AudioIO({
        inOptions: {
          deviceId: input.id,
          channelCount: channels,
          sampleFormat: naudiodon.SampleFormatFloat32,
          sampleRate: cfg.sampleRate,
          framesPerBuffer: cfg.framesPerBuffer,
          closeOnError: true
        }
      });
    } catch (err) {
      lastError = err.message || String(err);
      console.error("[AUDIO] stream create failed:", err.message || err);
      scheduleRestart("stream create failure");
      return;
    }

    stream.on("data", buffer => {
      try {
        lastDataAt = Date.now();
        processBuffer(buffer, channels);
      } catch (err) {
        console.error("[AUDIO] process error:", err.message || err);
      }
    });

    stream.on("error", err => {
      lastError = err.message || String(err);
      console.error("[AUDIO ERROR]", err.message || err);
      closeStream();
      scheduleRestart("stream error");
    });

    try {
      stream.start();
      lastDataAt = Date.now();
      startWatchdog();
      console.log("[AUDIO] stream started");
    } catch (err) {
      lastError = err.message || String(err);
      console.error("[AUDIO] stream start failed:", err.message || err);
      closeStream();
      scheduleRestart("stream start failure");
    }
  }

  function start() {
    if (running) return;
    running = true;
    resetState();
    startAppIsolationTimer();
    if (cfg.ffmpegAppIsolationEnabled) {
      runAppIsolationScan({ reason: "start", apply: true, force: true }).catch(() => {});
    }
    openStream();
  }

  function stop() {
    if (!running) return;
    running = false;

    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }

    stopAppIsolationTimer();
    stopWatchdog();
    closeStream();
    resetState();

    console.log("[AUDIO] stream stopped");
  }

  function restart(reason = "manual") {
    lastRestartReason = reason;

    if (!running) {
      console.log("[AUDIO] restart skipped (stream is stopped)");
      return { ok: true, restarted: false, reason };
    }

    stopWatchdog();
    closeStream();
    openStream();
    return { ok: true, restarted: true, reason };
  }

  function setConfig(patch = {}, options = {}) {
    const normalized = normalizeCfgPatch(patch);
    const keys = Object.keys(normalized);
    if (!keys.length) {
      return { ok: true, changed: [], config: getConfig(), restarted: false };
    }

    const restartKeys = new Set([
      "inputBackend",
      "sampleRate",
      "framesPerBuffer",
      "channels",
      "deviceMatch",
      "deviceId",
      "ffmpegPath",
      "ffmpegInputFormat",
      "ffmpegInputDevice",
      "ffmpegInputDevices",
      "ffmpegLogLevel",
      "ffmpegUseWallclock",
      "ffmpegAppIsolationEnabled",
      "ffmpegAppIsolationStrict",
      "ffmpegAppIsolationPrimaryApp",
      "ffmpegAppIsolationFallbackApp",
      "ffmpegAppIsolationPrimaryDevices",
      "ffmpegAppIsolationFallbackDevices",
      "ffmpegAppIsolationMultiSource",
      "ffmpegAppIsolationCheckMs"
    ]);

    let needsRestart = false;
    for (const key of keys) {
      const prevValue = cfg[key];
      const nextValue = normalized[key];
      const sameArray =
        Array.isArray(prevValue) &&
        Array.isArray(nextValue) &&
        prevValue.length === nextValue.length &&
        prevValue.every((item, idx) => item === nextValue[idx]);
      if (!sameArray && prevValue !== nextValue) {
        cfg[key] = normalized[key];
        if (restartKeys.has(key)) needsRestart = true;
      }
    }
    normalizeFfmpegDeviceFields();
    startAppIsolationTimer();
    const shouldRestart = options.restart !== false && needsRestart && running;
    if (cfg.ffmpegAppIsolationEnabled && !shouldRestart) {
      runAppIsolationScan({ reason: "config", apply: true, force: true }).catch(() => {});
    }
    if (shouldRestart) {
      restart("config change");
      if (cfg.ffmpegAppIsolationEnabled) {
        runAppIsolationScan({ reason: "config_post_restart", apply: true, force: true }).catch(() => {});
      }
    }

    return {
      ok: true,
      changed: keys,
      config: getConfig(),
      restarted: shouldRestart
    };
  }

  function getTelemetry() {
    return {
      running,
      backend: lastBackend,
      device: lastDeviceName || null,
      deviceId: lastDeviceId,
      ffmpegActive: Boolean(ffmpegProc),
      processLoopbackActive: Boolean(procTapProc),
      restartPending: Boolean(restartTimer),
      watchdogMs: cfg.watchdogMs,
      msSinceData: lastDataAt ? Math.max(0, Date.now() - lastDataAt) : null,
      watchdogTrips,
      lastRestartReason,
      lastError,
      rms: lastRms,
      peak: lastPeak,
      zcr: lastZcr,
      levelRaw: lastLevelRaw,
      level: lastLevel,
      bandLow: lastBandLow,
      bandMid: lastBandMid,
      bandHigh: lastBandHigh,
      spectralFlux: lastSpectralFlux,
      fast,
      mid,
      slow,
      transient,
      inputLoudnessEma,
      autoLevelGain,
      effectiveOutputGain,
      autoLevelEnabled: cfg.autoLevelEnabled === true,
      autoLevelTargetRms: cfg.autoLevelTargetRms,
      adaptiveFloor,
      adaptiveCeil,
      appIsolation: {
        enabled: cfg.ffmpegAppIsolationEnabled === true,
        primaryApp: cfg.ffmpegAppIsolationPrimaryApp || "",
        fallbackApp: cfg.ffmpegAppIsolationFallbackApp || "",
        selectedApp: appIsolationRuntime.selectedApp || "",
        selectedAppToken: appIsolationRuntime.selectedAppToken || "",
        captureToken: appIsolationRuntime.captureToken || "",
        mode: appIsolationRuntime.mode,
        activeApp: appIsolationRuntime.activeApp || "",
        activePid: Math.max(0, Number(appIsolationRuntime.activePid || 0)),
        resolvedDevices: normalizeFfmpegDeviceList(appIsolationRuntime.resolvedDevices, []),
        strict: cfg.ffmpegAppIsolationStrict === true,
        multiSource: cfg.ffmpegAppIsolationMultiSource === true,
        checkMs: cfg.ffmpegAppIsolationCheckMs,
        lastScanAt: appIsolationRuntime.lastScanAt || 0,
        lastError: appIsolationRuntime.lastError || "",
        runningAppsCount: Array.isArray(appIsolationRuntime.runningApps)
          ? appIsolationRuntime.runningApps.length
          : 0
      },
      config: getConfig()
    };
  }

  /* =========================
     PUBLIC API (STABLE + EXTENDED)
  ========================= */
  return {
    start,
    stop,

    // Existing optional hooks
    onFast(fn) { hooks.onFast = fn; },
    onMid(fn) { hooks.onMid = fn; },
    onSlow(fn) { hooks.onSlow = fn; },
    onTransient(fn) { hooks.onTransient = fn; },

    // New optional hooks
    onLevel(fn) { hooks.onLevel = fn; },
    onStats(fn) { hooks.onStats = fn; },

    getConfig,
    setConfig,
    listDevices,
    listRunningApps,
    scanFfmpegAppIsolation(options = {}) {
      return runAppIsolationScan({ ...(options || {}), apply: true, force: true });
    },
    restart,
    getTelemetry
  };
};
