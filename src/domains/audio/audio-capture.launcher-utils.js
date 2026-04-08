// [TITLE] Module: domains/audio/audio-capture.launcher-utils.js
// [TITLE] Purpose: normalize capture launcher inputs and source candidates
// [TITLE] Functionality Index:
// [TITLE] - validate external capture launcher availability
// [TITLE] - normalize FFmpeg, Rust loopback, and procTap launch options
// [TITLE] - build deterministic capture source candidate lists
// [DEV] This module is intentionally side-effect-light except for executable
// [DEV] reachability probes and process termination helpers used by the
// [DEV] capture runtime launcher lanes.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number(fallback);
  return Math.min(Number(max), Math.max(Number(min), parsed));
}

function normalizeString(value, max = 256) {
  return String(value || "").trim().slice(0, Math.max(1, Number(max) || 256));
}

function normalizeArray(values = [], max = 16) {
  const list = Array.isArray(values) ? values : [];
  return list
    .map(value => normalizeString(value, 256))
    .filter(Boolean)
    .slice(0, Math.max(1, Number(max) || 16));
}

function normalizeAppToken(value = "") {
  const token = normalizeString(value, 128).toLowerCase();
  if (!token) return "";
  const stripped = token.endsWith(".exe") ? token.slice(0, -4) : token;
  return stripped.replace(/\s+\(\d+\)\s*$/g, "").replace(/[^a-z0-9._ -]+/g, "").trim();
}

function normalizeLoopbackFormat(value = "f32le") {
  const token = normalizeString(value, 16).toLowerCase();
  if (token === "s16le" || token === "s24le" || token === "s32le" || token === "f32le") return token;
  return "f32le";
}

function hasPathSegment(value = "") {
  const token = normalizeString(value, 512);
  if (!token) return false;
  return token.includes("\\") || token.includes("/") || token.includes(":");
}

function commandReachable(command = "", args = ["--version"], timeoutMs = 1200) {
  const token = normalizeString(command, 512);
  if (!token) return false;
  if (hasPathSegment(token)) {
    const absolute = path.isAbsolute(token) ? token : path.resolve(token);
    return fs.existsSync(absolute);
  }
  try {
    const result = spawnSync(token, Array.isArray(args) ? args : ["--version"], {
      windowsHide: true,
      encoding: "utf8",
      timeout: Math.max(400, Math.round(Number(timeoutMs) || 1200)),
      stdio: "pipe"
    });
    if (result?.error && String(result.error.code || "").trim().toUpperCase() === "ENOENT") {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function terminateProcessSafely(proc = null, options = {}) {
  const target = proc && typeof proc === "object" ? proc : null;
  if (!target) return;
  const force = options.force !== false;
  const pid = Math.max(0, Number(target.pid || 0));

  try {
    target.kill("SIGTERM");
  } catch {
    // noop
  }

  if (pid <= 0) return;
  if (process.platform === "win32") {
    const args = ["/PID", String(pid), "/T"];
    if (force) args.push("/F");
    try {
      spawnSync("taskkill", args, {
        windowsHide: true,
        timeout: 1600,
        stdio: "ignore"
      });
    } catch {
      // noop
    }
    return;
  }

  if (!force) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // noop
  }
}

function resolveProcTapLauncherRuntime(launcher = "py", preferredPythonVersion = "3.13") {
  const normalizedLauncher = normalizeString(launcher, 64) || "py";
  const isPyLauncher = normalizedLauncher.toLowerCase() === "py";
  const pythonVersionCandidates = isPyLauncher
    ? [...new Set([
      normalizeString(preferredPythonVersion, 32),
      "3.14",
      "3.13",
      "3.12",
      "3.11",
      "3.10",
      ""
    ].filter(Boolean))]
    : [""];

  if (!commandReachable(
    normalizedLauncher,
    isPyLauncher ? ["-V"] : ["--version"],
    1400
  )) {
    return {
      available: false,
      launcher: normalizedLauncher,
      pythonArgs: [],
      pythonVersion: "",
      error: "launcher_unavailable"
    };
  }

  if (!isPyLauncher) {
    return {
      available: true,
      launcher: normalizedLauncher,
      pythonArgs: [],
      pythonVersion: "",
      error: ""
    };
  }

  for (const version of pythonVersionCandidates) {
    const pythonArgs = version ? [`-${version}`] : [];
    const importProbeArgs = [...pythonArgs, "-c", "import proctap, psutil"];
    if (commandReachable(normalizedLauncher, importProbeArgs, 1800)) {
      return {
        available: true,
        launcher: normalizedLauncher,
        pythonArgs,
        pythonVersion: version || "",
        error: ""
      };
    }
  }

  return {
    available: false,
    launcher: normalizedLauncher,
    pythonArgs: [],
    pythonVersion: "",
    error: "python_proctap_import_failed"
  };
}

function normalizeInputFormat(value) {
  const token = normalizeString(value, 32).toLowerCase();
  if (token === "wasapi") return "wasapi";
  return "dshow";
}

function normalizeDeviceToken(value) {
  return normalizeString(value, 320).toLowerCase();
}

function buildInputSpecifier(inputFormat, sourceName) {
  const format = normalizeInputFormat(inputFormat);
  const source = normalizeString(sourceName, 320);
  if (!source) return "";
  if (format === "dshow") {
    return source.toLowerCase().startsWith("audio=") ? source : `audio=${source}`;
  }
  return source;
}

function dedupeSourceCandidates(candidates = []) {
  const out = [];
  const seen = new Set();
  for (const row of Array.isArray(candidates) ? candidates : []) {
    const source = normalizeString(row?.source || "", 320);
    if (!source) continue;
    const key = normalizeDeviceToken(source);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      source,
      reason: normalizeString(row?.reason || "configured", 128) || "configured"
    });
  }
  return out;
}

function buildSourceCandidates(config = {}) {
  const source = config && typeof config === "object" ? config : {};
  const appIsolationEnabled = source.ffmpegAppIsolationEnabled === true;
  const primaryAppDevices = normalizeArray(source.ffmpegAppIsolationPrimaryDevices, 12);
  const fallbackAppDevices = normalizeArray(source.ffmpegAppIsolationFallbackDevices, 12);
  const configuredDevices = normalizeArray(source.ffmpegInputDevices, 12);
  const configuredSingle = normalizeString(source.ffmpegInputDevice || "", 320);
  const desktopOutput = normalizeString(source.desktopOutputDeviceName || "", 320);
  const matchToken = normalizeString(source.deviceMatch || "", 320);

  const candidates = [];
  if (appIsolationEnabled) {
    for (const sourceName of primaryAppDevices) {
      candidates.push({ source: sourceName, reason: "app_primary_device" });
    }
    for (const sourceName of fallbackAppDevices) {
      candidates.push({ source: sourceName, reason: "app_fallback_device" });
    }
  }
  for (const sourceName of configuredDevices) {
    candidates.push({ source: sourceName, reason: "ffmpeg_input_devices" });
  }
  if (configuredSingle) {
    candidates.push({ source: configuredSingle, reason: "ffmpeg_input_device" });
  }
  if (desktopOutput) {
    candidates.push({ source: desktopOutput, reason: "desktop_output_device_name" });
  }
  if (matchToken) {
    candidates.push({ source: matchToken, reason: "device_match_hint" });
  }
  if (!candidates.length) {
    candidates.push({ source: "virtual-audio-capturer", reason: "auto_virtual_audio_capturer" });
    candidates.push({ source: "default", reason: "auto_default_device" });
  }
  return dedupeSourceCandidates(candidates);
}

module.exports = {
  buildInputSpecifier,
  buildSourceCandidates,
  clampNumber,
  commandReachable,
  normalizeAppToken,
  normalizeInputFormat,
  normalizeLoopbackFormat,
  normalizeString,
  resolveProcTapLauncherRuntime,
  terminateProcessSafely
};
