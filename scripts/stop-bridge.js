// [TITLE] Module: scripts/stop-bridge.js
// [TITLE] Purpose: stop-bridge

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const pidFile = path.join(rootDir, ".runtime", "bridge.pid");
const repoNameLower = path.basename(rootDir).toLowerCase();
const rootDirLowerSlash = rootDir.replace(/\\/g, "/").toLowerCase();
const rootDirLowerBackslash = rootDir.replace(/\//g, "\\").toLowerCase();
const bridgePort = (() => {
  const raw = Number(process.env.RAVELINK_PORT || 5050);
  if (!Number.isInteger(raw) || raw <= 0 || raw > 65535) return 5050;
  return raw;
})();

function readPid() {
  try {
    const raw = fs.readFileSync(pidFile, "utf8").trim();
    const pid = Number(raw);
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return pid;
  } catch {
    return null;
  }
}

function removePidFile() {
  try {
    fs.unlinkSync(pidFile);
  } catch {}
}

function uniquePositivePids(values = []) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const pid = Number(value);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (pid === process.pid) continue;
    if (seen.has(pid)) continue;
    seen.add(pid);
    out.push(pid);
  }
  return out;
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function forceKillWindows(pid) {
  if (process.platform !== "win32") return false;
  try {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true
    });
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!isRunning(pid)) return true;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return !isRunning(pid);
}

function isLikelyBridgeCommandLine(commandLine, options = {}) {
  const raw = String(commandLine || "").trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  const listeningOnBridgePort = options.listeningOnBridgePort === true;

  if (lower.includes("scripts\\stop-bridge.js") || lower.includes("scripts/stop-bridge.js")) {
    return false;
  }

  if (lower.includes("scripts\\start-bridge.js") || lower.includes("scripts/start-bridge.js")) {
    if (lower.includes(rootDirLowerSlash) || lower.includes(rootDirLowerBackslash)) return true;
    if (repoNameLower && lower.includes(repoNameLower)) return true;
    return listeningOnBridgePort;
  }

  const hasServerJs = /(^|[\s"'`/\\])server\.js($|[\s"'`/\\])/i.test(lower);
  if (!hasServerJs) return false;

  if (lower.includes(rootDirLowerSlash) || lower.includes(rootDirLowerBackslash)) {
    return true;
  }
  if (repoNameLower && lower.includes(repoNameLower)) {
    return true;
  }
  if (listeningOnBridgePort) {
    return true;
  }
  return false;
}

function listListeningPidsOnPortWindows(port) {
  if (process.platform !== "win32") return new Set();
  try {
    const raw = execFileSync("netstat", ["-ano", "-p", "tcp"], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000
    });
    const out = new Set();
    for (const line of String(raw || "").split(/\r?\n/g)) {
      const match = line.match(/^\s*TCP\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s*$/i);
      if (!match) continue;
      const local = String(match[1] || "");
      const state = String(match[3] || "").toUpperCase();
      const pid = Number(match[4] || 0);
      if (state !== "LISTENING") continue;
      if (!Number.isInteger(pid) || pid <= 0) continue;
      if (
        local.endsWith(`:${port}`) ||
        local.endsWith(`.${port}`) ||
        local.endsWith(`]:${port}`)
      ) {
        out.add(pid);
      }
    }
    return out;
  } catch {
    return new Set();
  }
}

function listNodeProcessesWindows() {
  if (process.platform !== "win32") return [];
  const command = [
    "$ErrorActionPreference = 'Stop'",
    "$procs = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Select-Object ProcessId, CommandLine",
    "$procs | ConvertTo-Json -Compress"
  ].join("; ");

  try {
    const raw = execFileSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
      {
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000
      }
    ).trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list
      .map(item => ({
        pid: Number(item?.ProcessId || 0),
        commandLine: String(item?.CommandLine || "")
      }))
      .filter(item => Number.isInteger(item.pid) && item.pid > 0);
  } catch {
    return [];
  }
}

function listNodeProcessesPosix() {
  if (process.platform === "win32") return [];
  try {
    const raw = execFileSync("ps", ["-eo", "pid=,args="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000
    });
    const out = [];
    for (const line of String(raw || "").split(/\r?\n/g)) {
      const match = line.match(/^\s*(\d+)\s+(.+?)\s*$/);
      if (!match) continue;
      const pid = Number(match[1]);
      const commandLine = String(match[2] || "");
      if (!/\bnode(\.exe)?\b/i.test(commandLine)) continue;
      out.push({ pid, commandLine });
    }
    return out;
  } catch {
    return [];
  }
}

function discoverBridgePids() {
  const entries = process.platform === "win32"
    ? listNodeProcessesWindows()
    : listNodeProcessesPosix();
  const listeningPids = listListeningPidsOnPortWindows(bridgePort);
  const matches = [];
  for (const entry of entries) {
    if (!isLikelyBridgeCommandLine(entry.commandLine, {
      listeningOnBridgePort: listeningPids.has(entry.pid)
    })) continue;
    matches.push(entry.pid);
  }
  return uniquePositivePids(matches);
}

async function stopBridgePid(pid, sourceLabel = "") {
  if (!isRunning(pid)) {
    console.log(`[STOP] process ${pid} is not running`);
    return true;
  }

  const labelText = sourceLabel ? ` (${sourceLabel})` : "";
  console.log(`[STOP] stopping bridge process ${pid}${labelText}`);
  try {
    process.kill(pid, "SIGTERM");
  } catch (err) {
    console.error("[STOP] failed to send SIGTERM:", err.message || err);
    return false;
  }

  const exited = await waitForExit(pid, 4500);
  if (exited) {
    console.log(`[STOP] bridge process ${pid} stopped gracefully`);
    return true;
  }

  console.warn(`[STOP] graceful stop timed out for ${pid}; forcing termination`);
  let forceSent = false;
  if (process.platform === "win32") {
    forceSent = forceKillWindows(pid);
    if (!forceSent) {
      try {
        process.kill(pid, "SIGKILL");
        forceSent = true;
      } catch {}
    }
  } else {
    try {
      process.kill(pid, "SIGKILL");
      forceSent = true;
    } catch {}
  }
  if (!forceSent) {
    console.error(`[STOP] failed to force stop ${pid}`);
    return false;
  }

  const killed = await waitForExit(pid, 1800);
  if (!killed) {
    console.error(`[STOP] process ${pid} is still running after force stop`);
    return false;
  }

  console.log(`[STOP] bridge process ${pid} force-stopped`);
  return true;
}

async function main() {
  const targets = [];
  const filePid = readPid();
  if (filePid) {
    if (isRunning(filePid)) {
      targets.push({ pid: filePid, source: "pid-file" });
    } else {
      console.log(`[STOP] stale pid file found (${filePid}); removing`);
      removePidFile();
    }
  }

  const discovered = discoverBridgePids();
  for (const pid of discovered) {
    if (targets.some(entry => entry.pid === pid)) continue;
    targets.push({ pid, source: "process-scan" });
  }

  if (!targets.length) {
    console.log("[STOP] no bridge process detected; nothing to stop");
    return;
  }

  let allStopped = true;
  for (const entry of targets) {
    const ok = await stopBridgePid(entry.pid, entry.source);
    if (!ok) {
      allStopped = false;
    }
  }

  const leftovers = discoverBridgePids().filter(pid => isRunning(pid));
  if (leftovers.length) {
    console.error(`[STOP] bridge process still detected after stop: ${leftovers.join(", ")}`);
    allStopped = false;
  }

  if (allStopped) {
    removePidFile();
    console.log("[STOP] bridge stopped");
    return;
  }

  process.exitCode = 1;
}

main().catch(err => {
  console.error("[STOP] unexpected error:", err.message || err);
  process.exitCode = 1;
});
