// [TITLE] Module: app/runtime/startup.browser-launch.js
// [TITLE] Purpose: startup browser auto-launch orchestration for local bridge UX
// [TITLE] Functionality Index:
// [TITLE] - normalize browser auto-launch enablement and delay policy
// [TITLE] - open local bridge URL using platform launcher command + fallbacks
// [TITLE] - schedule launch after server listen callback with safe fallbacks
// [DEV] Complex Flow:
// [DEV] Launch scheduling is intentionally detached/non-blocking so server startup
// [DEV] cannot be delayed or crashed by browser process failures.

const { spawn } = require("node:child_process");
const { parseBoolean } = require("../../shared/validation/parse-boolean");

const DEFAULT_DELAY_MS = 1200;

function clampLaunchDelayMs(value, fallback = DEFAULT_DELAY_MS) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return Math.max(0, Math.round(Number(fallback) || DEFAULT_DELAY_MS));
  return Math.max(0, Math.min(30000, parsed));
}

function isAutoLaunchEnabled(config = {}, env = process.env) {
  if (parseBoolean(env.RAVELINK_DISABLE_AUTO_BROWSER, false)) return false;
  if (parseBoolean(env.RAVELINK_FORCE_AUTO_BROWSER, false)) return true;
  return config.autoLaunchBrowser !== false;
}

function shellEscapeSingleQuoted(value) {
  return String(value || "").replace(/'/g, "''");
}

function buildLaunchStrategies(url, platform) {
  const target = String(url || "").trim();
  if (!target) return [];
  if (platform === "win32") {
    return [
      {
        launcher: "explorer_url_handler",
        command: "explorer.exe",
        args: [target]
      },
      {
        launcher: "powershell_start_process",
        command: "powershell.exe",
        args: ["-NoProfile", "-NonInteractive", "-Command", `Start-Process -FilePath '${shellEscapeSingleQuoted(target)}'`]
      },
      {
        launcher: "cmd_start",
        command: "cmd.exe",
        args: ["/d", "/c", `start "" ${target}`]
      },
      {
        launcher: "rundll32_url_handler",
        command: "rundll32.exe",
        args: ["url.dll,FileProtocolHandler", target]
      }
    ];
  }
  if (platform === "darwin") {
    return [
      {
        launcher: "open",
        command: "open",
        args: [target]
      }
    ];
  }
  return [
    {
      launcher: "xdg-open",
      command: "xdg-open",
      args: [target]
    }
  ];
}

function launchBrowserUrl(url, options = {}) {
  const target = String(url || "").trim();
  if (!target) {
    return { ok: false, error: "missing_url", launcher: "" };
  }

  const platform = String(options.platform || process.platform).trim().toLowerCase();
  const spawnFn = typeof options.spawnFn === "function" ? options.spawnFn : spawn;
  const spawnOptions = {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  };
  const strategies = buildLaunchStrategies(target, platform);
  if (!strategies.length) {
    return { ok: false, error: "missing_strategy", launcher: "" };
  }

  let lastError = "browser_launch_failed";
  for (const strategy of strategies) {
    try {
      const child = spawnFn(strategy.command, strategy.args, spawnOptions);
      if (child && typeof child.unref === "function") {
        child.unref();
      }
      return { ok: true, launcher: strategy.launcher };
    } catch (error) {
      lastError = String(error?.message || error || "browser_launch_failed");
    }
  }

  const fallbackLauncher = strategies[strategies.length - 1]?.launcher || "";
  return {
    ok: false,
    error: lastError,
    launcher: fallbackLauncher
  };
}

function scheduleAutoBrowserLaunch(input = {}) {
  const url = String(input.url || "").trim();
  const config = input.config && typeof input.config === "object" ? input.config : {};
  const env = input.env && typeof input.env === "object" ? input.env : process.env;
  const log = input.log && typeof input.log === "object" ? input.log : console;
  const setTimeoutFn = typeof input.setTimeoutFn === "function" ? input.setTimeoutFn : setTimeout;
  const launchFn = typeof input.launchFn === "function" ? input.launchFn : launchBrowserUrl;
  const onSchedule = typeof input.onSchedule === "function" ? input.onSchedule : (() => {});
  const onLaunchResult = typeof input.onLaunchResult === "function" ? input.onLaunchResult : (() => {});
  const enabled = isAutoLaunchEnabled(config, env);
  const delayMs = clampLaunchDelayMs(config.autoLaunchDelayMs ?? config.delayMs, DEFAULT_DELAY_MS);

  if (!enabled) {
    onSchedule({
      ok: true,
      scheduled: false,
      launched: false,
      reason: "auto_launch_disabled",
      delayMs,
      url
    });
    log.log?.(`[SYS] browser auto-launch disabled (url=${url || "n/a"})`);
    return {
      ok: true,
      scheduled: false,
      launched: false,
      reason: "auto_launch_disabled",
      delayMs
    };
  }
  if (!url) {
    onSchedule({
      ok: false,
      scheduled: false,
      launched: false,
      reason: "missing_url",
      delayMs,
      url
    });
    return {
      ok: false,
      scheduled: false,
      launched: false,
      reason: "missing_url",
      delayMs
    };
  }

  onSchedule({
    ok: true,
    scheduled: true,
    launched: false,
    reason: "scheduled",
    delayMs,
    url
  });
  const timer = setTimeoutFn(() => {
    const launched = launchFn(url, input);
    onLaunchResult({
      at: Date.now(),
      url,
      delayMs,
      ok: launched.ok === true,
      launcher: String(launched.launcher || ""),
      error: String(launched.error || "")
    });
    if (launched.ok) {
      log.log?.(`[SYS] browser launched: ${url} (${launched.launcher})`);
    } else {
      log.warn?.(`[SYS] browser launch failed (${launched.launcher}): ${launched.error}`);
    }
  }, delayMs);
  if (timer && typeof timer.unref === "function") {
    timer.unref();
  }
  return {
    ok: true,
    scheduled: true,
    launched: false,
    reason: "scheduled",
    delayMs
  };
}

module.exports = {
  DEFAULT_DELAY_MS,
  clampLaunchDelayMs,
  isAutoLaunchEnabled,
  buildLaunchStrategies,
  launchBrowserUrl,
  scheduleAutoBrowserLaunch
};
