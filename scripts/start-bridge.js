// [TITLE] Module: scripts/start-bridge.js
// [TITLE] Purpose: start-bridge

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const runtimeDir = path.join(rootDir, ".runtime");
const bootstrapStatePath = path.join(runtimeDir, "bootstrap-state.json");
const bootstrapSchemaVersion = 1;
if (!process.env.RAVELINK_WATCH_PARENT) {
  process.env.RAVELINK_WATCH_PARENT = "1";
}
const bootstrapDepsEnabled = String(process.env.RAVELINK_BOOTSTRAP_DEPS || "1").trim() !== "0";

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: options.stdio || "pipe",
    windowsHide: true
  });
  return result;
}

function commandExists(command, args = ["--version"]) {
  const result = runCommand(command, args, { stdio: "ignore" });
  return result && result.status === 0;
}

function resolveNpmCommand() {
  const candidates = process.platform === "win32"
    ? ["npm.cmd", "npm"]
    : ["npm"];
  for (const candidate of candidates) {
    if (commandExists(candidate)) return candidate;
  }
  return "";
}

function ensureRuntimeDir() {
  try {
    fs.mkdirSync(runtimeDir, { recursive: true });
  } catch {}
}

function readBootstrapState() {
  try {
    if (!fs.existsSync(bootstrapStatePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(bootstrapStatePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeBootstrapState(state) {
  ensureRuntimeDir();
  try {
    fs.writeFileSync(
      bootstrapStatePath,
      `${JSON.stringify(state, null, 2)}\n`,
      "utf8"
    );
  } catch (err) {
    console.warn("[BOOT] Failed to write bootstrap state:", err && err.message ? err.message : err);
  }
}

function computeDependencyFingerprint() {
  const hash = crypto.createHash("sha256");
  hash.update(`bootstrap-schema:${bootstrapSchemaVersion}\n`);

  const manifestFiles = ["package.json", "package-lock.json"];
  for (const relPath of manifestFiles) {
    const absPath = path.join(rootDir, relPath);
    hash.update(`file:${relPath}\n`);
    if (fs.existsSync(absPath)) {
      hash.update(fs.readFileSync(absPath));
    } else {
      hash.update("missing\n");
    }
  }
  return hash.digest("hex");
}

function resolveBootstrapPlan() {
  const currentFingerprint = computeDependencyFingerprint();
  const state = readBootstrapState();
  const nodeModulesExists = fs.existsSync(path.join(rootDir, "node_modules"));

  if (!state || state.schema !== bootstrapSchemaVersion) {
    return {
      reason: "first-launch-on-this-system",
      forceFullInstall: true,
      depFingerprint: currentFingerprint
    };
  }

  if (!nodeModulesExists) {
    return {
      reason: "node_modules-missing",
      forceFullInstall: true,
      depFingerprint: currentFingerprint
    };
  }

  if (state.depFingerprint !== currentFingerprint) {
    return {
      reason: "dependency-manifest-changed",
      forceFullInstall: true,
      depFingerprint: currentFingerprint
    };
  }

  return {
    reason: "up-to-date",
    forceFullInstall: false,
    depFingerprint: currentFingerprint
  };
}

function readPackageDependencies() {
  try {
    const packageJsonPath = path.join(rootDir, "package.json");
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    const deps = parsed && typeof parsed === "object" && parsed.dependencies
      ? parsed.dependencies
      : {};
    return Object.keys(deps);
  } catch {
    return [];
  }
}

function findMissingNodeDependencies() {
  const deps = readPackageDependencies();
  const missing = [];
  for (const dep of deps) {
    try {
      require.resolve(`${dep}/package.json`, { paths: [rootDir] });
    } catch {
      missing.push(dep);
    }
  }
  return missing;
}

function runNpmInstall(reason) {
  const npmCommand = resolveNpmCommand();
  if (!npmCommand) {
    console.error("[BOOT][ERROR] npm not found in PATH; cannot install Node dependencies.");
    return false;
  }

  console.log(`[BOOT] Running full Node dependency sync (${reason})...`);
  const installResult = runCommand(
    npmCommand,
    ["install", "--include=optional", "--no-audit", "--no-fund"],
    { stdio: "inherit" }
  );
  if (installResult.status !== 0) {
    console.error("[BOOT][ERROR] npm install failed.");
    return false;
  }
  return true;
}

function ensureNodeDependencies(plan) {
  if (plan && plan.forceFullInstall) {
    return runNpmInstall(plan.reason || "full-bootstrap");
  }

  const missing = findMissingNodeDependencies();
  if (!missing.length) return true;
  return runNpmInstall(`missing-node-dependencies:${missing.length}`);
}

function ensurePython313OnWindows() {
  if (process.platform !== "win32") return false;
  const check = runCommand("py", ["-3.13", "-c", "import sys; print(sys.version)"]);
  if (check.status === 0) return true;

  if (!commandExists("winget")) {
    console.warn("[BOOT] Python 3.13 not found and winget is unavailable; process-loopback bootstrap skipped.");
    return false;
  }

  console.log("[BOOT] Installing Python 3.13 (required for process-loopback capture)...");
  const install = runCommand(
    "winget",
    [
      "install",
      "--id", "Python.Python.3.13",
      "--silent",
      "--accept-package-agreements",
      "--accept-source-agreements"
    ],
    { stdio: "inherit" }
  );
  if (install.status !== 0) {
    console.warn("[BOOT] Python 3.13 install failed; process-loopback bootstrap skipped.");
    return false;
  }

  const recheck = runCommand("py", ["-3.13", "-c", "import sys; print(sys.version)"]);
  if (recheck.status !== 0) {
    console.warn("[BOOT] Python 3.13 still unavailable after install; process-loopback bootstrap skipped.");
    return false;
  }
  return true;
}

function ensureProcessLoopbackPythonDeps() {
  if (process.platform !== "win32") return true;
  if (!ensurePython313OnWindows()) return false;

  const check = runCommand("py", ["-3.13", "-c", "import proctap, psutil"]);
  if (check.status === 0) return true;

  console.log("[BOOT] Installing process-loopback Python deps (proc-tap, psutil)...");
  const install = runCommand(
    "py",
    ["-3.13", "-m", "pip", "install", "--user", "proc-tap", "psutil"],
    { stdio: "inherit" }
  );
  if (install.status !== 0) {
    console.warn("[BOOT] Python dep install failed; process-loopback capture may be unavailable.");
    return false;
  }

  const recheck = runCommand("py", ["-3.13", "-c", "import proctap, psutil"]);
  if (recheck.status !== 0) {
    console.warn("[BOOT] Python deps still unavailable after install; process-loopback capture may be unavailable.");
    return false;
  }
  return true;
}

function ensureFfmpegBinary() {
  if (commandExists("ffmpeg", ["-version"])) return true;

  if (process.platform !== "win32") {
    console.warn("[BOOT] ffmpeg is not available in PATH; install ffmpeg for app isolation capture support.");
    return false;
  }

  if (!commandExists("winget")) {
    console.warn("[BOOT] ffmpeg missing and winget is unavailable; install ffmpeg manually and add it to PATH.");
    return false;
  }

  const packageIds = ["Gyan.FFmpeg", "BtbN.FFmpeg"];
  for (const packageId of packageIds) {
    console.log(`[BOOT] Installing ffmpeg via winget (${packageId})...`);
    runCommand(
      "winget",
      [
        "install",
        "--id", packageId,
        "--exact",
        "--silent",
        "--accept-package-agreements",
        "--accept-source-agreements"
      ],
      { stdio: "inherit" }
    );
    if (commandExists("ffmpeg", ["-version"])) {
      return true;
    }
  }

  console.warn("[BOOT] ffmpeg install did not complete successfully; install ffmpeg manually and retry.");
  return false;
}

function runBootstrapPreflight() {
  if (!bootstrapDepsEnabled) {
    console.log("[BOOT] Dependency bootstrap disabled via RAVELINK_BOOTSTRAP_DEPS=0");
    return true;
  }

  const plan = resolveBootstrapPlan();
  if (plan.forceFullInstall) {
    console.log(`[BOOT] Full dependency bootstrap required (${plan.reason}).`);
  }

  if (!ensureNodeDependencies(plan)) {
    return false;
  }

  const ffmpegReady = ensureFfmpegBinary();
  const processLoopbackReady = ensureProcessLoopbackPythonDeps();
  writeBootstrapState({
    schema: bootstrapSchemaVersion,
    depFingerprint: plan.depFingerprint,
    nodeInstallReason: plan.reason,
    ffmpegReady: ffmpegReady === true,
    processLoopbackReady: processLoopbackReady === true,
    updatedAt: new Date().toISOString()
  });

  if (process.platform === "win32" && (!ffmpegReady || !processLoopbackReady)) {
    console.warn("[BOOT] Some optional Windows audio dependencies are unavailable; app isolation features may be limited.");
  }
  return true;
}

function resolveHueCaPath() {
  const candidates = [];
  if (process.env.RAVE_HUE_CA_CERT_PATH) {
    candidates.push(String(process.env.RAVE_HUE_CA_CERT_PATH));
  }

  try {
    const pkgPath = require.resolve("hue-sync/package.json", { paths: [rootDir] });
    candidates.push(path.join(path.dirname(pkgPath), "signify.pem"));
  } catch {}

  candidates.push(path.join(rootDir, "node_modules", "hue-sync", "signify.pem"));
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || "";
}

if (!runBootstrapPreflight()) {
  process.exitCode = 1;
  throw new Error("Startup bootstrap preflight failed.");
}

const certPath = resolveHueCaPath();

if (!process.env.NODE_EXTRA_CA_CERTS) {
  if (certPath) {
    process.env.NODE_EXTRA_CA_CERTS = certPath;
  } else {
    console.warn("[BOOT] hue-sync cert not found; continuing without NODE_EXTRA_CA_CERTS");
  }
}

require(path.join(rootDir, "server.js"));
