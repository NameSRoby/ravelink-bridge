// [TITLE] Module: domains/audio/audio-capture.runtime.js
// [TITLE] Purpose: FFmpeg-backed audio capture runtime for live telemetry extraction
// [TITLE] Functionality Index:
// [TITLE] - start/stop capture process against configured desktop/app-isolation sources
// [TITLE] - compute lightweight signal telemetry (rms/peak/transient/flux/bands/bpm)
// [TITLE] - expose deterministic runtime status for diagnostics + route responses
// [DEV] Complex Flow:
// [DEV] Capture startup probes source candidates sequentially. The first source that
// [DEV] emits PCM frames becomes active; failed candidates are retained in startup
// [DEV] diagnostics so operators can quickly troubleshoot source selection issues.

const {
  buildSourceCandidates,
  clampNumber,
  normalizeAppToken,
  normalizeInputFormat,
  normalizeString,
  terminateProcessSafely
} = require("./audio-capture.launcher-utils");
const {
  buildDesktopLoopbackCommand,
  buildFfmpegCaptureCommand,
  buildProcessLoopbackCommand
} = require("./audio-capture.command-builders");
const {
  spawnPcmCaptureProcess
} = require("./audio-capture.process-lifecycle");
const createSignalAnalyzer = require("./audio-capture.signal-analyzer");

module.exports = function createAudioCaptureRuntime(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const onTelemetry = typeof options.onTelemetry === "function" ? options.onTelemetry : (() => {});
  const log = options.log || console;
  const setIntervalFn = typeof options.setInterval === "function" ? options.setInterval : setInterval;
  const clearIntervalFn = typeof options.clearInterval === "function" ? options.clearInterval : clearInterval;

  let activeProcess = null;
  let metricsTimer = null;
  let analyzer = createSignalAnalyzer();
  let status = {
    available: process.platform === "win32",
    running: false,
    source: "",
    reason: "idle",
    pid: 0,
    startedAt: 0,
    stoppedAt: 0,
    lastError: "",
    attempts: [],
    updatedAt: Number(now() || Date.now())
  };

  function setStatus(patch = {}) {
    status = {
      ...status,
      ...(patch && typeof patch === "object" ? patch : {}),
      updatedAt: Number(now() || Date.now())
    };
  }

  function getStatus() {
    return {
      ...status,
      attempts: Array.isArray(status.attempts) ? status.attempts.slice(0, 16) : []
    };
  }

  function stopMetricsTimer() {
    if (!metricsTimer) return;
    clearIntervalFn(metricsTimer);
    metricsTimer = null;
  }

  function startMetricsTimer() {
    stopMetricsTimer();
    metricsTimer = setIntervalFn(() => {
      if (!status.running) return;
      const metrics = analyzer.getMetrics();
      onTelemetry({
        ...metrics,
        running: true,
        source: status.source,
        sourceDevice: status.source
      });
    }, 100);
  }

  function stopCapture(meta = {}) {
    const hadProcess = Boolean(activeProcess);
    const reason = normalizeString(meta.reason || "capture_stop", 96) || "capture_stop";
    if (activeProcess) {
      terminateProcessSafely(activeProcess, { force: true });
      activeProcess = null;
    }
    stopMetricsTimer();
    analyzer = createSignalAnalyzer();
    setStatus({
      running: false,
      pid: 0,
      source: "",
      reason,
      stoppedAt: Number(now() || Date.now())
    });
    return {
      ok: true,
      stopped: hadProcess,
      status: getStatus()
    };
  }

  function buildLifecycleCallbacks(sourceName = "", defaultReason = "capture_started") {
    return {
      onStarted({ proc, reason }) {
        activeProcess = proc;
        analyzer = createSignalAnalyzer();
        const at = Number(now() || Date.now());
        setStatus({
          running: true,
          source: sourceName,
          reason: normalizeString(reason || defaultReason, 96) || defaultReason,
          pid: Number(proc?.pid || 0),
          startedAt: at,
          lastError: ""
        });
        startMetricsTimer();
      },
      onPcmChunk(data) {
        const metrics = analyzer.pushChunk(data);
        if (metrics) {
          onTelemetry({
            ...metrics,
            running: true,
            source: sourceName,
            sourceDevice: sourceName
          });
        }
      },
      onExitAfterStart({ proc, error }) {
        if (proc === activeProcess) {
          stopMetricsTimer();
          setStatus({
            running: false,
            pid: 0,
            source: "",
            reason: "capture_exit",
            stoppedAt: Number(now() || Date.now()),
            lastError: normalizeString(error || "capture_exit", 320)
          });
          onTelemetry({
            running: false,
            lastError: status.lastError
          });
        }
      }
    };
  }

  function spawnCandidate(config = {}, candidate = {}) {
    const commandSpec = buildFfmpegCaptureCommand(config, candidate);
    if (commandSpec.ok !== true) {
      return Promise.resolve(commandSpec);
    }
    return spawnPcmCaptureProcess({
      command: commandSpec.command,
      args: commandSpec.args,
      sourceName: commandSpec.source,
      inputFormat: commandSpec.inputFormat,
      reason: commandSpec.reason,
      startedReason: normalizeString(candidate.reason || "capture_started", 96) || "capture_started",
      awaitingDataReason: normalizeString(`${String(candidate.reason || "capture").trim()}_awaiting_data`, 96) || "capture_awaiting_data",
      config,
      ...buildLifecycleCallbacks(commandSpec.source, "capture_started")
    });
  }

  function spawnProcessLoopbackCapture(config = {}, loopback = {}) {
    const commandSpec = buildProcessLoopbackCommand(config, loopback);
    if (commandSpec.ok !== true) {
      return Promise.resolve(commandSpec);
    }
    return spawnPcmCaptureProcess({
      command: commandSpec.command,
      args: commandSpec.args,
      sourceName: commandSpec.source,
      inputFormat: commandSpec.inputFormat,
      reason: commandSpec.reason,
      startedReason: "process_loopback_started",
      awaitingDataReason: "process_loopback_awaiting_data",
      config,
      ...buildLifecycleCallbacks(commandSpec.source, "process_loopback_started")
    });
  }

  function spawnDesktopLoopbackCapture(config = {}) {
    const commandSpec = buildDesktopLoopbackCommand(config);
    if (commandSpec.ok !== true) {
      return Promise.resolve(commandSpec);
    }
    return spawnPcmCaptureProcess({
      command: commandSpec.command,
      args: commandSpec.args,
      sourceName: commandSpec.source,
      inputFormat: commandSpec.inputFormat,
      reason: commandSpec.reason,
      startedReason: "desktop_loopback_started",
      awaitingDataReason: "desktop_loopback_awaiting_data",
      config,
      ...buildLifecycleCallbacks(commandSpec.source, "desktop_loopback_started")
    });
  }

  async function startCapture(config = {}, meta = {}) {
    if (process.platform !== "win32") {
      setStatus({
        running: false,
        reason: "capture_platform_unsupported",
        lastError: "capture_platform_unsupported"
      });
      return {
        ok: false,
        error: "capture_platform_unsupported",
        status: getStatus()
      };
    }

    stopCapture({
      reason: normalizeString(meta.reason || "capture_restart", 96) || "capture_restart"
    });
    const attempts = [];

    const loopbackTargetToken = normalizeAppToken(config.processLoopbackTargetToken || "");
    const loopbackTargetPid = Math.round(clampNumber(config.processLoopbackTargetPid, 0, 1000000000, 0));
    const enforceProcessLoopback = config.appIsolationEnforceProcessLoopback === true;
    if (enforceProcessLoopback && config.processLoopbackEnabled !== true) {
      log.warn("[AUDIO][CAPTURE] app isolation requires process loopback; capture start aborted (missing enable flag).");
      setStatus({
        running: false,
        source: "",
        pid: 0,
        reason: "process_loopback_required_missing",
        attempts,
        lastError: "process_loopback_required_missing"
      });
      return {
        ok: false,
        error: "process_loopback_required_missing",
        status: getStatus()
      };
    }
    if (enforceProcessLoopback && !(loopbackTargetToken || loopbackTargetPid > 0)) {
      log.warn("[AUDIO][CAPTURE] app isolation requires process loopback; capture start aborted (missing target process).");
      setStatus({
        running: false,
        source: "",
        pid: 0,
        reason: "process_loopback_target_missing",
        attempts,
        lastError: "process_loopback_target_missing"
      });
      return {
        ok: false,
        error: "process_loopback_target_missing",
        status: getStatus()
      };
    }
    if (config.processLoopbackEnabled === true && (loopbackTargetToken || loopbackTargetPid > 0)) {
      const preferredLoopbackBackend = normalizeString(config.processLoopbackPreferredBackend || "", 32).toLowerCase();
      const loopbackBackendOrder = [];
      const pushLoopbackBackend = tokenRaw => {
        const token = normalizeString(tokenRaw || "", 32).toLowerCase();
        if (!token) return;
        if (loopbackBackendOrder.includes(token)) return;
        loopbackBackendOrder.push(token);
      };
      if (preferredLoopbackBackend === "proctap") {
        pushLoopbackBackend("proctap");
        pushLoopbackBackend("rustloop");
        pushLoopbackBackend("rustkernel");
      } else if (preferredLoopbackBackend === "rustloop") {
        pushLoopbackBackend("rustloop");
        pushLoopbackBackend("rustkernel");
        pushLoopbackBackend("proctap");
      } else {
        pushLoopbackBackend("rustkernel");
        pushLoopbackBackend("rustloop");
        pushLoopbackBackend("proctap");
      }

      for (let loopbackIdx = 0; loopbackIdx < loopbackBackendOrder.length; loopbackIdx += 1) {
        const backendToken = loopbackBackendOrder[loopbackIdx];
        const loopbackAttempt = await spawnProcessLoopbackCapture(config, {
          targetToken: loopbackTargetToken,
          targetPid: loopbackTargetPid,
          preferredBackend: backendToken
        });
        const requireStartupData = config.processLoopbackRequireStartupData !== false;
        const loopbackAwaitingData = loopbackAttempt.ok === true && loopbackAttempt.startedByData !== true;
        const treatAwaitingDataAsFailure = loopbackAwaitingData && requireStartupData;
        attempts.push({
          source: normalizeString(loopbackAttempt.source || `process:${loopbackTargetToken || String(loopbackTargetPid)}`, 320),
          inputFormat: normalizeString(loopbackAttempt.inputFormat || backendToken || "process_loopback", 64),
          reason: `process_loopback_${backendToken || "auto"}`,
          ok: loopbackAttempt.ok === true && !treatAwaitingDataAsFailure,
          error: normalizeString(
            treatAwaitingDataAsFailure
              ? "process_loopback_no_data_startup"
              : (loopbackAttempt.error || ""),
            320
          ),
          stderr: normalizeString(loopbackAttempt.stderr || "", 320)
        });
        if (treatAwaitingDataAsFailure) {
          stopCapture({
            reason: "process_loopback_no_data_startup"
          });
          const nextBackend = loopbackBackendOrder[loopbackIdx + 1] || "";
          log.warn(
            "[AUDIO][CAPTURE] process-loopback attempt yielded no startup data; falling back:",
            normalizeString(loopbackAttempt.source || "", 160),
            nextBackend ? `| retrying=${nextBackend}` : ""
          );
          continue;
        }
        if (loopbackAttempt.ok === true) {
          setStatus({
            attempts,
            lastError: ""
          });
          return {
            ok: true,
            source: normalizeString(loopbackAttempt.source || `process:${loopbackTargetToken || String(loopbackTargetPid)}`, 320),
            inputFormat: normalizeString(loopbackAttempt.inputFormat || backendToken || "process_loopback", 64),
            status: getStatus()
          };
        }
        const nextBackend = loopbackBackendOrder[loopbackIdx + 1] || "";
        log.warn(
          "[AUDIO][CAPTURE] process-loopback attempt failed:",
          normalizeString(loopbackAttempt.error || "process_loopback_failed", 320),
          normalizeString(loopbackAttempt.stderr || "", 240),
          nextBackend ? `| retrying=${nextBackend}` : ""
        );
      }
      if (enforceProcessLoopback) {
        const failure = attempts[attempts.length - 1] || {};
        const normalizedFailure = normalizeString(
          failure.error || "process_loopback_start_failed",
          320
        );
        log.warn("[AUDIO][CAPTURE] process-loopback could not start in app-isolation mode; skipping desktop fallback.");
        setStatus({
          running: false,
          source: "",
          pid: 0,
          reason: "process_loopback_start_failed",
          attempts,
          lastError: normalizedFailure
        });
        return {
          ok: false,
          error: normalizedFailure,
          status: getStatus()
        };
      }
    }

    if (config.desktopLoopbackEnabled === true) {
      const desktopAttempt = await spawnDesktopLoopbackCapture(config);
      attempts.push({
        source: normalizeString(desktopAttempt.source || "desktop:default", 320),
        inputFormat: normalizeString(desktopAttempt.inputFormat || "rustkernel", 64),
        reason: "desktop_loopback",
        ok: desktopAttempt.ok === true,
        error: normalizeString(desktopAttempt.error || "", 320),
        stderr: normalizeString(desktopAttempt.stderr || "", 320)
      });
      if (desktopAttempt.ok === true) {
        setStatus({
          attempts,
          lastError: ""
        });
        return {
          ok: true,
          source: normalizeString(desktopAttempt.source || "desktop:default", 320),
          inputFormat: normalizeString(desktopAttempt.inputFormat || "rustkernel", 64),
          status: getStatus()
        };
      }
      log.warn(
        "[AUDIO][CAPTURE] desktop loopback attempt failed:",
        normalizeString(desktopAttempt.error || "desktop_loopback_failed", 320),
        normalizeString(desktopAttempt.stderr || "", 240)
      );
    }

    const sourceCandidates = buildSourceCandidates(config);
    if (!sourceCandidates.length) {
      setStatus({
        running: false,
        reason: "capture_source_missing",
        lastError: "capture_source_missing",
        attempts
      });
      return {
        ok: false,
        error: "capture_source_missing",
        status: getStatus()
      };
    }
    const configuredFormat = normalizeInputFormat(config.ffmpegInputFormat || "dshow");
    const formatOrder = configuredFormat === "wasapi"
      ? ["wasapi", "dshow"]
      : ["dshow"];
    for (const candidate of sourceCandidates) {
      for (const inputFormat of formatOrder) {
        const attempt = await spawnCandidate({
          ...config,
          ffmpegInputFormat: inputFormat
        }, candidate);
        attempts.push({
          source: normalizeString(candidate.source || "", 320),
          inputFormat,
          reason: normalizeString(candidate.reason || "configured", 96),
          ok: attempt.ok === true,
          error: normalizeString(attempt.error || "", 320),
          stderr: normalizeString(attempt.stderr || "", 320)
        });
        if (attempt.ok === true) {
          setStatus({
            attempts,
            lastError: ""
          });
          return {
            ok: true,
            source: normalizeString(candidate.source || "", 320),
            inputFormat,
            status: getStatus()
          };
        }
      }
    }

    const failure = attempts[attempts.length - 1] || {};
    const hasWasapiMissing = attempts.some(row =>
      String(row?.stderr || "").toLowerCase().includes("unknown input format: 'wasapi'")
    );
    const hasDshowDeviceMissing = attempts.some(row =>
      String(row?.stderr || "").toLowerCase().includes("could not find audio only device with name")
    );
    const normalizedFailure = hasWasapiMissing && hasDshowDeviceMissing
      ? "capture_wasapi_unavailable_and_dshow_source_unmatched"
      : normalizeString(failure.error || "capture_start_failed", 320);
    setStatus({
      running: false,
      source: "",
      pid: 0,
      reason: "capture_start_failed",
      attempts,
      lastError: normalizedFailure
    });
    const lastAttempt = attempts[attempts.length - 1] || {};
    const lastStderr = normalizeString(lastAttempt.stderr || "", 240);
    if (lastStderr) {
      log.warn("[AUDIO][CAPTURE] failed to start capture:", status.lastError, "|", lastStderr);
    } else {
      log.warn("[AUDIO][CAPTURE] failed to start capture:", status.lastError);
    }
    return {
      ok: false,
      error: status.lastError || "capture_start_failed",
      status: getStatus()
    };
  }

  return {
    startCapture,
    stopCapture,
    getStatus
  };
};
