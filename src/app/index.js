// [TITLE] Module: app/index.js
// [TITLE] Purpose: executable server entrypoint
// [TITLE] Functionality Index:
// [TITLE] - resolve host/port config
// [TITLE] - boot HTTP server
// [TITLE] - install graceful shutdown handlers

const createServer = require("./create-server");
const path = require("path");
const logStartupDiagnostics = require("./runtime/startup-diagnostics.logger");
const { scheduleAutoBrowserLaunch } = require("./runtime/startup.browser-launch");
const { isRecoverableLifecycleError } = require("./runtime/lifecycle-error-classifier");
const packageJson = require("../../package.json");

const PORT = Number(process.env.PORT || 5050);
const HOST = String(process.env.HOST || "127.0.0.1").trim() || "127.0.0.1";
const ROOT_DIR = path.resolve(__dirname, "../..");
let server = null;
let shutdownInFlight = false;
let serverListening = false;
const recoverableLifecycleErrorTimestamps = [];
const RECOVERABLE_ERROR_WINDOW_MS = 60000;
const RECOVERABLE_ERROR_BURST_LIMIT = 30;
const RECOVERABLE_ERROR_LOG_WINDOW_MS = 15000;
let lastRecoverableLifecycleLog = {
  key: "",
  at: 0
};

const { app, services } = createServer({
  rootDir: ROOT_DIR,
  requestSystemStop(meta = {}) {
    // [DEV] HTTP stop requests must reuse the same lifecycle path as SIGINT/SIGTERM
    // [DEV] so shutdown semantics remain deterministic and testable.
    const source = String(meta?.source || "system_stop_route").trim() || "system_stop_route";
    return requestShutdown(`HTTP:${source}`);
  }
});
const BRIDGE_URL = `http://${HOST}:${PORT}`;
const runtimeVersion = String(packageJson.version || "0.0.0").trim() || "0.0.0";
const startupConsole = typeof logStartupDiagnostics.createFormatter === "function"
  ? logStartupDiagnostics.createFormatter({ stream: process.stdout })
  : null;

logStartupDiagnostics({
  services,
  log: console,
  formatter: startupConsole,
  runtimeVersion,
  bridgeUrl: BRIDGE_URL
});

server = app.listen(PORT, HOST, () => {
  serverListening = true;
  if (startupConsole) {
    console.log(startupConsole.event("bridge", `Listening on ${BRIDGE_URL}`, "info"));
  } else {
    console.log(`[BOOT] RaveLink Bridge v${runtimeVersion} listening on ${BRIDGE_URL}`);
  }
  const systemConfig = services?.systemConfigService?.getConfig?.()?.config || {};
  const startupLaunchDiagnosticsService = services?.startupLaunchDiagnosticsService;
  const launchPlan = scheduleAutoBrowserLaunch({
    url: BRIDGE_URL,
    config: systemConfig,
    env: process.env,
    log: console,
    onSchedule(event) {
      startupLaunchDiagnosticsService?.recordSchedule?.(event);
    },
    onLaunchResult(event) {
      startupLaunchDiagnosticsService?.recordLaunchResult?.(event);
    }
  });
  if (launchPlan?.scheduled) {
    if (startupConsole) {
      console.log(
        startupConsole.line("system", [
          startupConsole.field("Browser Open", "Scheduled", "good"),
          startupConsole.field("Delay", `${Number(launchPlan.delayMs || 0)}ms`, "text"),
          startupConsole.field("Target", BRIDGE_URL, "info")
        ], { tone: "system" })
      );
    } else {
      console.log(
        `[SYS] browser auto-launch scheduled (delayMs=${Number(launchPlan.delayMs || 0)}, ` +
        `url=${BRIDGE_URL})`
      );
    }
  }
  const systemUpdateService = services?.systemUpdateService;
  if (systemUpdateService && typeof systemUpdateService.runStartupCheck === "function") {
    systemUpdateService.runStartupCheck()
      .then(status => {
        const lastCheck = status?.lastCheck || {};
        const latest = lastCheck?.latest || {};
        if (lastCheck?.ok === true && lastCheck?.updateAvailable === true) {
          if (startupConsole) {
            console.log(
              startupConsole.line("update", [
                startupConsole.field("Release", String(latest.version || latest.tagName || "Unknown"), "warn"),
                startupConsole.field("Status", "Available", "warn"),
                startupConsole.field("URL", String(latest.releaseUrl || ""), "info")
              ], { tone: "update" })
            );
          } else {
            console.log(
              `[UPDATE] new release available (${String(latest.version || latest.tagName || "unknown")}) ` +
              `at ${String(latest.releaseUrl || "")}`
            );
          }
          return;
        }
        if (lastCheck?.ok === true) {
          console.log(startupConsole
            ? startupConsole.line("update", [
              startupConsole.field("Release Check", "Completed", "good"),
              startupConsole.field("Status", "Up to date", "good")
            ], { tone: "update" })
            : "[UPDATE] startup release check completed (up-to-date)");
          return;
        }
        if (lastCheck?.detail === "startup_update_check_disabled") {
          console.log(startupConsole
            ? startupConsole.line("update", [
              startupConsole.field("Release Check", "Skipped", "muted"),
              startupConsole.field("Reason", "Disabled by user setting", "muted")
            ], { tone: "update" })
            : "[UPDATE] startup release check skipped (disabled by user setting)");
          return;
        }
        if (lastCheck?.error) {
          console.warn(startupConsole
            ? startupConsole.line("update", [
              startupConsole.field("Release Check", "Failed", "bad"),
              startupConsole.field("Reason", String(lastCheck.error || "unknown_error"), "bad")
            ], { tone: "warn" })
            : `[UPDATE] startup release check failed: ${String(lastCheck.error || "unknown_error")}`);
        }
      })
      .catch(error => {
        console.warn(startupConsole
          ? startupConsole.line("update", [
            startupConsole.field("Release Check", "Error", "bad"),
            startupConsole.field("Reason", String(error?.message || error), "bad")
          ], { tone: "warn" })
          : `[UPDATE] startup release check error: ${error?.message || error}`);
      });
  }
});
if (server && typeof server.on === "function") {
  server.on("error", error => {
    const message = error?.message || String(error || "unknown_server_error");
    const code = String(error?.code || "").trim().toUpperCase();
    console.error(`[BOOT] HTTP server error: ${message}`);
    // [DEV] Listen-time failures (for example EADDRINUSE) otherwise default to
    // [DEV] exit code 0 when the event loop drains, which hides startup failure.
    process.exitCode = 1;
    if (!serverListening) {
      if (code === "EADDRINUSE") {
        console.error(`[BOOT] Startup failed: port ${PORT} is already in use at host ${HOST}.`);
      }
      setImmediate(() => process.exit(1));
      return;
    }
    requestShutdown(`SERVER_ERROR:${code || "UNKNOWN"}`);
  });
  server.on("close", () => {
    serverListening = false;
    console.warn("[BOOT] HTTP server closed");
  });
}

// [DEV] Mod loader startup is async by design. This deferred line confirms
// [DEV] post-discovery state once non-blocking sandbox boot settles.
const modsDeferredTimer = setTimeout(() => {
  const modsSnapshot = services?.modRuntime?.list?.() || { loaded: 0, total: 0 };
  console.log(startupConsole
    ? startupConsole.line("mods", [
      startupConsole.field("Post-load", startupConsole.formatLoadedCount(modsSnapshot.loaded, modsSnapshot.total), Number(modsSnapshot.loaded || 0) > 0 ? "good" : "muted")
    ], { tone: "mods" })
    : `[MODS] post-load snapshot (${Number(modsSnapshot.loaded || 0)}/${Number(modsSnapshot.total || 0)} loaded)`);
}, 1500);
if (typeof modsDeferredTimer?.unref === "function") {
  modsDeferredTimer.unref();
}

function requestShutdown(signal) {
  const source = String(signal || "unknown").trim() || "unknown";
  if (shutdownInFlight) {
    return {
      ok: true,
      reason: "shutdown_already_in_progress",
      source
    };
  }
  shutdownInFlight = true;

  // [DEV] Graceful close window is intentionally bounded to avoid zombie runtime.
  console.log(`[SHUTDOWN] received ${source}, closing bridge...`);
  const forceExitTimer = setTimeout(() => {
    console.warn("[SHUTDOWN] force exit timeout reached");
    process.exit(1);
  }, 2500);
  if (typeof forceExitTimer.unref === "function") {
    forceExitTimer.unref();
  }

  Promise.resolve()
    .then(async () => {
      if (typeof services?.modRuntime?.shutdown === "function") {
        await services.modRuntime.shutdown();
      }
      if (typeof services?.internetGatewayRuntime?.shutdown === "function") {
        services.internetGatewayRuntime.shutdown();
      }
    })
    .catch(error => {
      console.warn(`[SHUTDOWN] mod runtime shutdown warning: ${error?.message || error}`);
    })
    .finally(() => {
      if (!server || typeof server.close !== "function") {
        console.log("[SHUTDOWN] bridge was not listening");
        process.exit(0);
        return;
      }
      server.close(() => {
        console.log("[SHUTDOWN] bridge stopped");
        process.exit(0);
      });
    });

  return {
    ok: true,
    reason: "shutdown_requested",
    source
  };
}

function logRecoverableLifecycleError(kind, error) {
  const message = String(error?.message || error || "unknown_recoverable_error").trim() || "unknown_recoverable_error";
  const key = `${String(kind || "recoverable").trim().toLowerCase()}|${message.toLowerCase()}`;
  const at = Date.now();
  const sameLog = key === String(lastRecoverableLifecycleLog.key || "");
  const withinWindow = (at - Number(lastRecoverableLifecycleLog.at || 0)) < RECOVERABLE_ERROR_LOG_WINDOW_MS;
  if (sameLog && withinWindow) return;
  lastRecoverableLifecycleLog = { key, at };
  console.warn(`[LIFECYCLE] recoverable ${kind} suppressed: ${message}`);
}

process.on("SIGINT", () => requestShutdown("SIGINT"));
process.on("SIGTERM", () => requestShutdown("SIGTERM"));
process.on("beforeExit", code => {
  console.warn(
    `[LIFECYCLE] beforeExit code=${Number(code || 0)} ` +
    `(listening=${serverListening ? "true" : "false"}, shutdownInFlight=${shutdownInFlight ? "true" : "false"})`
  );
});
process.on("exit", code => {
  console.warn(
    `[LIFECYCLE] exit code=${Number(code || 0)} ` +
    `(listening=${serverListening ? "true" : "false"}, shutdownInFlight=${shutdownInFlight ? "true" : "false"})`
  );
});
process.on("uncaughtException", error => {
  if (isRecoverableLifecycleError(error)) {
    // [DEV] Guardrail: suppress known recoverable Hue DTLS handshake faults so
    // [DEV] Entertainment fallback can continue without killing the bridge process.
    const at = Date.now();
    recoverableLifecycleErrorTimestamps.push(at);
    while (
      recoverableLifecycleErrorTimestamps.length &&
      (at - Number(recoverableLifecycleErrorTimestamps[0] || 0)) > RECOVERABLE_ERROR_WINDOW_MS
    ) {
      recoverableLifecycleErrorTimestamps.shift();
    }
    logRecoverableLifecycleError("uncaughtException", error);
    if (recoverableLifecycleErrorTimestamps.length > RECOVERABLE_ERROR_BURST_LIMIT) {
      console.error(
        `[LIFECYCLE] recoverable error burst exceeded ${RECOVERABLE_ERROR_BURST_LIMIT}/` +
        `${Math.round(RECOVERABLE_ERROR_WINDOW_MS / 1000)}s; exiting for safety.`
      );
      process.exit(1);
    }
    return;
  }
  console.error(`[LIFECYCLE] uncaughtException: ${error?.stack || error?.message || error}`);
  process.exit(1);
});
process.on("unhandledRejection", reason => {
  if (isRecoverableLifecycleError(reason)) {
    const at = Date.now();
    recoverableLifecycleErrorTimestamps.push(at);
    while (
      recoverableLifecycleErrorTimestamps.length &&
      (at - Number(recoverableLifecycleErrorTimestamps[0] || 0)) > RECOVERABLE_ERROR_WINDOW_MS
    ) {
      recoverableLifecycleErrorTimestamps.shift();
    }
    logRecoverableLifecycleError("unhandledRejection", reason);
    if (recoverableLifecycleErrorTimestamps.length > RECOVERABLE_ERROR_BURST_LIMIT) {
      console.error(
        `[LIFECYCLE] recoverable rejection burst exceeded ${RECOVERABLE_ERROR_BURST_LIMIT}/` +
        `${Math.round(RECOVERABLE_ERROR_WINDOW_MS / 1000)}s; exiting for safety.`
      );
      process.exit(1);
    }
    return;
  }
  console.error(`[LIFECYCLE] unhandledRejection: ${reason?.stack || reason?.message || reason}`);
  process.exit(1);
});
