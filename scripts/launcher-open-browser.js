// [TITLE] Script: scripts/launcher-open-browser.js
// [TITLE] Purpose: launcher-side browser open helper for Windows startup reliability
// [TITLE] Functionality Index:
// [TITLE] - wait for bridge readiness probe before browser open
// [TITLE] - inspect launcher diagnostics to avoid duplicate tabs
// [TITLE] - open bridge URL with OS default browser only when needed

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

function asString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || String(fallback || "").trim();
}

function asInt(value, fallback, min, max) {
  const parsed = Math.round(Number(value));
  const base = Number.isFinite(parsed) ? parsed : Math.round(Number(fallback));
  const n = Number.isFinite(base) ? base : Number(fallback || 0);
  return Math.max(Number(min), Math.min(Number(max), n));
}

function parseArgs(argv = []) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "").trim();
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).trim().toLowerCase();
    const next = String(argv[i + 1] || "").trim();
    if (!next || next.startsWith("--")) {
      out[key] = "true";
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function joinUrlPath(baseUrl, routePath) {
  const base = asString(baseUrl);
  const p = asString(routePath);
  if (!base) return "";
  if (!p) return base;
  const normalizedPath = p.startsWith("/") ? p : `/${p}`;
  return `${base.replace(/\/+$/, "")}${normalizedPath}`;
}

function writeLog(logPath, message) {
  const msg = asString(message);
  if (!logPath || !msg) return;
  const stamp = new Date().toISOString().replace("T", " ").replace("Z", "");
  const line = `[${stamp}] ${msg}\n`;
  try {
    const dir = path.dirname(logPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(logPath, line, "utf8");
  } catch {
    // swallow log failures
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(100, Number(timeoutMs) || 1000));
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    if (!response || response.ok !== true) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeOutcomeToken(value) {
  return asString(value, "idle").toLowerCase();
}

function toEpochMs(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function openBrowser(url) {
  const child = spawn("cmd", ["/c", "start", "", url], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetUrl = asString(args.url);
  const probePath = asString(args["probe-path"] || "/health");
  const diagnosticsPath = asString(args["diagnostics-path"] || "/system/launcher-diagnostics");
  const attempts = asInt(args.attempts, 80, 1, 240);
  const delayMs = asInt(args["delay-ms"], 400, 120, 5000);
  const graceDelayMs = asInt(args["grace-delay-ms"], 2200, 0, 15000);
  const recentLaunchWindowMs = asInt(args["recent-launch-window-ms"], 45000, 3000, 180000);
  const logPath = asString(args["log-path"] || "runtime/logs/launcher-browser-open.log");
  const helperStartedAtMs = Date.now();

  if (!targetUrl) {
    writeLog(logPath, "missing target URL; aborting helper");
    process.exit(2);
    return;
  }

  const probeUrl = joinUrlPath(targetUrl, probePath);
  const diagnosticsUrl = joinUrlPath(targetUrl, diagnosticsPath);
  writeLog(
    logPath,
    `helper start | target=${targetUrl} probe=${probeUrl} diagnostics=${diagnosticsUrl} attempts=${attempts} delayMs=${delayMs} graceMs=${graceDelayMs} recentWindowMs=${recentLaunchWindowMs}`
  );

  let ready = false;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const probe = await fetchJson(probeUrl, 1000);
    if (probe && typeof probe === "object") {
      ready = true;
      writeLog(logPath, `probe ready at attempt ${attempt}/${attempts}`);
      break;
    }
    if (attempt === 1 || attempt === attempts || (attempt % 10) === 0) {
      writeLog(logPath, `probe wait ${attempt}/${attempts}: not_ready`);
    }
    await sleep(delayMs);
  }

  if (!ready) {
    writeLog(logPath, "probe timed out; no browser launch attempted");
    process.exit(1);
    return;
  }

  if (graceDelayMs > 0) {
    await sleep(graceDelayMs);
  }

  let skipOpen = false;
  try {
    const diagnostics = await fetchJson(diagnosticsUrl, 2000);
    const launcher = diagnostics && typeof diagnostics === "object"
      ? (diagnostics.launcher && typeof diagnostics.launcher === "object" ? diagnostics.launcher : diagnostics)
      : {};
    const outcome = normalizeOutcomeToken(launcher.lastOutcome);
    const bootedAtMs = toEpochMs(launcher.bootedAt);
    const lastAttemptAtMs = toEpochMs(launcher.lastAttemptAt);
    const nowMs = Date.now();
    const attemptAgeMs = lastAttemptAtMs > 0 ? Math.max(0, nowMs - lastAttemptAtMs) : Number.MAX_SAFE_INTEGER;
    const sameBootWindow = bootedAtMs >= (helperStartedAtMs - 5000);
    const attemptInWindow = lastAttemptAtMs >= (helperStartedAtMs - 5000);
    const attemptRecent = attemptAgeMs <= recentLaunchWindowMs;
    if (outcome === "launched" && (sameBootWindow || attemptInWindow || attemptRecent)) {
      skipOpen = true;
      writeLog(
        logPath,
        `skip open: diagnostics reports launched via ${asString(launcher.lastLauncher, "unknown")} (bootedAt=${bootedAtMs}, lastAttemptAt=${lastAttemptAtMs}, attemptAgeMs=${attemptAgeMs})`
      );
    } else {
      writeLog(
        logPath,
        `diagnostics outcome=${outcome} not trusted for skip (bootedAt=${bootedAtMs}, lastAttemptAt=${lastAttemptAtMs}, attemptAgeMs=${attemptAgeMs}); fallback open will run`
      );
    }
  } catch (error) {
    writeLog(logPath, `diagnostics unavailable (${asString(error?.message || error, "unknown")}); fallback open will run`);
  }

  if (skipOpen) {
    process.exit(0);
    return;
  }

  try {
    openBrowser(targetUrl);
    writeLog(logPath, `fallback browser open invoked for ${targetUrl}`);
    process.exit(0);
  } catch (error) {
    writeLog(logPath, `fallback browser open failed: ${asString(error?.message || error, "unknown")}`);
    process.exit(1);
  }
}

main().catch(error => {
  const message = asString(error?.message || error, "unknown");
  try {
    writeLog("runtime/logs/launcher-browser-open.log", `fatal helper failure: ${message}`);
  } catch {
    // ignore
  }
  process.exit(1);
});
