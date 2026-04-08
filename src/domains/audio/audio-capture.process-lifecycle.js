// [TITLE] Module: domains/audio/audio-capture.process-lifecycle.js
// [TITLE] Purpose: monitor PCM-emitting child process startup, telemetry, and exit lifecycle
// [TITLE] Functionality Index:
// [TITLE] - spawn capture commands with bounded startup timers
// [TITLE] - promote a process to running after PCM data or startup grace
// [TITLE] - collect bounded stderr diagnostics and stop failed launches safely
// [DEV] This helper intentionally owns child-process mechanics only. Capture
// [DEV] command choice and runtime status semantics stay with their callers.

const { spawn } = require("node:child_process");

const {
  clampNumber,
  normalizeString,
  terminateProcessSafely
} = require("./audio-capture.launcher-utils");

function spawnPcmCaptureProcess(options = {}) {
  return new Promise(resolve => {
    const command = normalizeString(options.command || "", 512);
    const args = Array.isArray(options.args) ? options.args : [];
    const sourceName = normalizeString(options.sourceName || "", 320);
    const inputFormat = normalizeString(options.inputFormat || "", 96);
    const reason = normalizeString(options.reason || "capture", 96) || "capture";
    const startedReason = normalizeString(options.startedReason || `${reason}_started`, 96) || "capture_started";
    const awaitingDataReason = normalizeString(options.awaitingDataReason || `${reason}_awaiting_data`, 96) || "capture_awaiting_data";
    const config = options.config && typeof options.config === "object" ? options.config : {};
    const spawnFn = typeof options.spawn === "function" ? options.spawn : spawn;
    const terminate = typeof options.terminateProcessSafely === "function" ? options.terminateProcessSafely : terminateProcessSafely;
    const onStarted = typeof options.onStarted === "function" ? options.onStarted : (() => {});
    const onPcmChunk = typeof options.onPcmChunk === "function" ? options.onPcmChunk : (() => {});
    const onExitAfterStart = typeof options.onExitAfterStart === "function" ? options.onExitAfterStart : (() => {});

    let settled = false;
    let started = false;
    let stderrLog = "";
    let startupTimer = null;
    let startupGraceTimer = null;
    let proc = null;
    const startupDeadlineMs = Math.round(clampNumber(config.restartMs, 500, 12000, 2500));
    const startupGraceMs = Math.round(clampNumber(config.captureStartupGraceMs, 300, 2200, 900));

    function clearStartupTimers() {
      if (startupTimer) {
        clearTimeout(startupTimer);
        startupTimer = null;
      }
      if (startupGraceTimer) {
        clearTimeout(startupGraceTimer);
        startupGraceTimer = null;
      }
    }

    function settle(result = {}) {
      if (settled) return;
      settled = true;
      clearStartupTimers();
      if (!started && proc) {
        terminate(proc, { force: true });
      }
      resolve({
        source: sourceName,
        inputFormat,
        reason,
        stderr: normalizeString(stderrLog, 320),
        ...result
      });
    }

    function markStarted(startReason = startedReason, startedByData = true) {
      if (started || !proc) return;
      started = true;
      onStarted({
        proc,
        sourceName,
        reason: normalizeString(startReason, 96) || startedReason
      });
      settle({
        ok: true,
        started: true,
        pid: Number(proc.pid || 0),
        startedByData: startedByData === true
      });
    }

    if (!command) {
      settle({
        ok: false,
        error: "capture_command_missing"
      });
      return;
    }

    try {
      proc = spawnFn(command, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      settle({
        ok: false,
        error: normalizeString(error?.message || error || "spawn_failed", 320)
      });
      return;
    }

    startupTimer = setTimeout(() => {
      settle({
        ok: false,
        error: "capture_start_timeout"
      });
    }, startupDeadlineMs);
    startupGraceTimer = setTimeout(() => {
      markStarted(awaitingDataReason, false);
    }, Math.min(startupGraceMs, Math.max(250, startupDeadlineMs - 120)));

    if (typeof proc.on === "function") {
      proc.on("error", error => {
        settle({
          ok: false,
          error: normalizeString(error?.message || error || "capture_process_error", 320)
        });
      });

      proc.on("exit", (code, signal) => {
        if (!started) {
          settle({
            ok: false,
            error: `capture_exit_${String(code ?? "null")}_${String(signal || "none")}`
          });
          return;
        }
        onExitAfterStart({
          proc,
          code,
          signal,
          error: `capture_exit_${String(code ?? "null")}_${String(signal || "none")}`
        });
      });
    }

    if (proc.stderr && typeof proc.stderr.on === "function") {
      proc.stderr.on("data", chunk => {
        stderrLog += String(chunk || "");
        if (stderrLog.length > 2000) {
          stderrLog = stderrLog.slice(-2000);
        }
      });
    }

    if (!proc.stdout || typeof proc.stdout.on !== "function") {
      settle({
        ok: false,
        error: "capture_stdout_unavailable"
      });
      return;
    }

    proc.stdout.on("data", chunk => {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk || "");
      if (!started && data.length > 0) {
        markStarted(startedReason, true);
      }
      if (started && data.length > 0) {
        onPcmChunk(data);
      }
    });
  });
}

module.exports = {
  spawnPcmCaptureProcess
};
