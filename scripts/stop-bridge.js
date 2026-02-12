const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const pidFile = path.join(rootDir, ".runtime", "bridge.pid");

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

async function main() {
  const pid = readPid();
  if (!pid) {
    console.log("[STOP] no bridge pid file found; nothing to stop");
    return;
  }

  if (!isRunning(pid)) {
    console.log(`[STOP] stale pid file found (${pid}); removing`);
    removePidFile();
    return;
  }

  console.log(`[STOP] stopping bridge process ${pid}`);
  try {
    process.kill(pid, "SIGTERM");
  } catch (err) {
    console.error("[STOP] failed to send SIGTERM:", err.message || err);
    process.exitCode = 1;
    return;
  }

  const exited = await waitForExit(pid, 4500);
  if (exited) {
    console.log("[STOP] bridge stopped gracefully");
    removePidFile();
    return;
  }

  console.warn("[STOP] graceful stop timed out; forcing termination");
  let forceSent = false;
  try {
    process.kill(pid, "SIGKILL");
    forceSent = true;
  } catch {}
  if (!forceSent) {
    forceSent = forceKillWindows(pid);
  }
  if (!forceSent) {
    console.error("[STOP] failed to force stop");
    process.exitCode = 1;
    return;
  }

  const killed = await waitForExit(pid, 1500);
  if (!killed) {
    console.error("[STOP] process is still running after force stop");
    process.exitCode = 1;
    return;
  }

  removePidFile();
  console.log("[STOP] bridge force-stopped");
}

main().catch(err => {
  console.error("[STOP] unexpected error:", err.message || err);
  process.exitCode = 1;
});
