// [TITLE] Module: domains/audio/audio-capture.command-builders.js
// [TITLE] Purpose: build audio capture launcher commands for FFmpeg, Rust loopback, and procTap
// [TITLE] Functionality Index:
// [TITLE] - build FFmpeg desktop/source capture command lines
// [TITLE] - build Rust desktop loopback command lines
// [TITLE] - select and build process-loopback command lines across Rust/procTap backends
// [DEV] Keep command selection pure where possible so launcher behavior can be
// [DEV] tested without spawning external capture tools.

const {
  buildInputSpecifier,
  clampNumber,
  commandReachable,
  normalizeAppToken,
  normalizeInputFormat,
  normalizeLoopbackFormat,
  normalizeString,
  resolveProcTapLauncherRuntime
} = require("./audio-capture.launcher-utils");

function normalizeChannels(config = {}) {
  return Math.round(clampNumber(config.channels, 1, 8, 2));
}

function normalizeSampleRate(config = {}) {
  return Math.round(clampNumber(config.sampleRate, 8000, 192000, 48000));
}

function buildFfmpegCaptureCommand(config = {}, candidate = {}) {
  const ffmpegPath = normalizeString(config.ffmpegPath || "ffmpeg", 260) || "ffmpeg";
  const inputFormat = normalizeInputFormat(config.ffmpegInputFormat || "dshow");
  const sourceName = normalizeString(candidate.source || "", 320);
  const inputSpecifier = buildInputSpecifier(inputFormat, sourceName);
  const reason = normalizeString(candidate.reason || "unknown", 96);
  if (!inputSpecifier) {
    return {
      ok: false,
      source: sourceName,
      inputFormat,
      reason,
      error: "empty_capture_source"
    };
  }

  return {
    ok: true,
    command: ffmpegPath,
    args: [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      inputFormat,
      "-i",
      inputSpecifier,
      "-ac",
      String(normalizeChannels(config)),
      "-ar",
      String(normalizeSampleRate(config)),
      "-f",
      "f32le",
      "pipe:1"
    ],
    source: sourceName,
    inputFormat,
    reason
  };
}

function buildProcessLoopbackBackendOrder(preferredBackend = "", options = {}) {
  const preferred = normalizeString(preferredBackend || "", 32).toLowerCase();
  const allowProcTapFallback = options.allowProcTapFallback !== false;
  const candidateBackends = [];
  const pushBackend = value => {
    const token = normalizeString(value, 32).toLowerCase();
    if (!token || candidateBackends.includes(token)) return;
    candidateBackends.push(token);
  };

  if (preferred === "rustloop") {
    pushBackend("rustloop");
    pushBackend("rustkernel");
    if (allowProcTapFallback) pushBackend("proctap");
  } else if (preferred === "proctap") {
    pushBackend("proctap");
  } else {
    pushBackend("rustkernel");
    pushBackend("rustloop");
    if (allowProcTapFallback) pushBackend("proctap");
  }

  return candidateBackends;
}

function selectProcessLoopbackBackend(context = {}) {
  const candidateBackends = Array.isArray(context.candidateBackends) ? context.candidateBackends : [];
  const reachable = typeof context.commandReachable === "function" ? context.commandReachable : commandReachable;
  const procTapRuntime = context.procTapRuntime && typeof context.procTapRuntime === "object"
    ? context.procTapRuntime
    : { available: false };

  return candidateBackends.find(token => {
    if (token === "rustkernel") return reachable(context.rustKernelPath, ["--version"], 1400);
    if (token === "rustloop") return reachable(context.rustLoopbackPath, ["--version"], 1400);
    if (token === "proctap") return procTapRuntime.available === true;
    return false;
  }) || "";
}

function buildProcessLoopbackCommand(config = {}, loopback = {}, dependencies = {}) {
  const targetToken = normalizeAppToken(loopback?.targetToken || "");
  const targetPid = Math.round(clampNumber(loopback?.targetPid, 0, 1000000000, 0));
  const preferredBackend = normalizeString(loopback?.preferredBackend || "", 32).toLowerCase();
  if (!targetToken && targetPid <= 0) {
    return {
      ok: false,
      source: "",
      reason: "process_loopback_target_missing",
      error: "process_loopback_target_missing"
    };
  }

  const rustKernelPath = normalizeString(
    config.rustKernelPath || process.env.RAVE_AUDIO_RUST_KERNEL_PATH || "ravelink-audio-kernel.exe",
    512
  ) || "ravelink-audio-kernel.exe";
  const rustLoopbackPath = normalizeString(
    config.rustLoopbackPath || process.env.RAVE_AUDIO_RUST_LOOPBACK_PATH || "ravelink-rust-audio-isolator.exe",
    512
  ) || "ravelink-rust-audio-isolator.exe";
  const procTapLauncher = normalizeString(config.procTapLauncher || "py", 64) || "py";
  const procTapPyVersion = normalizeString(config.procTapPythonVersion || "3.13", 32) || "3.13";
  const procTapRuntime = dependencies.procTapRuntime || resolveProcTapLauncherRuntime(procTapLauncher, procTapPyVersion);
  const allowProcTapFallback = config.rustLoopbackAutoFallbackProcTap !== false;
  const candidateBackends = buildProcessLoopbackBackendOrder(preferredBackend, { allowProcTapFallback });
  const selectedBackend = selectProcessLoopbackBackend({
    candidateBackends,
    rustKernelPath,
    rustLoopbackPath,
    procTapRuntime,
    commandReachable: dependencies.commandReachable
  });
  const sourceName = `process:${targetToken || String(targetPid || "unknown")}`;

  if (!selectedBackend) {
    return {
      ok: false,
      source: sourceName,
      reason: "process_loopback_tool_unavailable",
      error: `process_loopback_tool_unavailable:${normalizeString(procTapRuntime.error || "", 96) || "none"}`
    };
  }

  const command = selectedBackend === "rustkernel"
    ? rustKernelPath
    : (selectedBackend === "rustloop" ? rustLoopbackPath : procTapLauncher);
  const usePidSelector = targetPid > 0;
  const rustLoopbackFormat = normalizeLoopbackFormat(config.rustLoopbackFormat || "f32le");
  const args = (selectedBackend === "rustkernel" || selectedBackend === "rustloop")
    ? [
      ...(usePidSelector ? ["--pid", String(targetPid)] : []),
      ...(!usePidSelector && targetToken ? ["--name", targetToken] : []),
      "--stdout",
      "--format",
      rustLoopbackFormat,
      "--channels",
      String(normalizeChannels(config)),
      "--sample-rate",
      String(normalizeSampleRate(config)),
      "--include-process-tree"
    ]
    : [
      ...procTapRuntime.pythonArgs,
      "-m",
      "proctap",
      ...(usePidSelector ? ["--pid", String(targetPid)] : (targetToken ? ["--name", targetToken] : [])),
      "--stdout",
      "--format",
      "float32",
      "--resample-quality",
      "medium"
    ];

  return {
    ok: true,
    command,
    args,
    source: sourceName,
    inputFormat: selectedBackend,
    reason: "process_loopback"
  };
}

function buildDesktopLoopbackCommand(config = {}, dependencies = {}) {
  const reachable = typeof dependencies.commandReachable === "function" ? dependencies.commandReachable : commandReachable;
  const rustKernelPath = normalizeString(
    config.desktopLoopbackPath || config.rustKernelPath || process.env.RAVE_AUDIO_RUST_KERNEL_PATH || "ravelink-audio-kernel.exe",
    512
  ) || "ravelink-audio-kernel.exe";
  if (!reachable(rustKernelPath, ["--version"], 1400)) {
    return {
      ok: false,
      source: "desktop:default",
      inputFormat: "rustkernel",
      reason: "desktop_loopback_tool_unavailable",
      error: "desktop_loopback_tool_unavailable"
    };
  }

  const rustLoopbackFormat = normalizeLoopbackFormat(config.rustLoopbackFormat || "f32le");
  const desktopDeviceName = normalizeString(config.desktopLoopbackDeviceName || config.desktopOutputDeviceName || "", 320);
  const args = [
    "--desktop-default",
    "--stdout",
    "--format",
    rustLoopbackFormat,
    "--channels",
    String(normalizeChannels(config)),
    "--sample-rate",
    String(normalizeSampleRate(config))
  ];
  if (desktopDeviceName) {
    args.push("--desktop-device-name", desktopDeviceName);
  }

  return {
    ok: true,
    command: rustKernelPath,
    args,
    source: desktopDeviceName || "desktop:default",
    inputFormat: "rustkernel",
    reason: "desktop_loopback"
  };
}

module.exports = {
  buildDesktopLoopbackCommand,
  buildFfmpegCaptureCommand,
  buildProcessLoopbackBackendOrder,
  buildProcessLoopbackCommand,
  selectProcessLoopbackBackend
};
