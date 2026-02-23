// [TITLE] Module: scripts/start-bridge.js
// [TITLE] Purpose: start-bridge

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const runtimeDir = path.join(rootDir, ".runtime");
const bootstrapStatePath = path.join(runtimeDir, "bootstrap-state.json");
const distributionManifestPath = path.join(rootDir, "distribution.manifest.json");
const bootstrapSchemaVersion = 1;

function readDistributionManifest() {
  try {
    if (!fs.existsSync(distributionManifestPath)) return null;
    const parsed = JSON.parse(fs.readFileSync(distributionManifestPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

const distributionManifest = readDistributionManifest();
const isSelfContainedDistro = distributionManifest?.selfContained === true;
const bootstrapDepsDefault = isSelfContainedDistro ? "0" : "1";
const bootstrapSystemDepsDefault = isSelfContainedDistro ? "0" : "1";

if (!process.env.RAVELINK_WATCH_PARENT) {
  process.env.RAVELINK_WATCH_PARENT = "1";
}
const bootstrapDepsEnabled = String(process.env.RAVELINK_BOOTSTRAP_DEPS || bootstrapDepsDefault).trim() !== "0";
const bootstrapSystemDepsEnabled = String(
  process.env.RAVELINK_BOOTSTRAP_SYSTEM_DEPS || bootstrapSystemDepsDefault
).trim() !== "0";
const bootstrapOnlyMode = String(process.env.RAVELINK_BOOTSTRAP_ONLY || "").trim() === "1";

function runCommand(command, args, options = {}) {
  const spawnOptions = {
    cwd: rootDir,
    encoding: "utf8",
    stdio: options.stdio || "pipe",
    windowsHide: true
  };

  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(String(command))) {
    const commandShell = "cmd.exe";
    return spawnSync(commandShell, [
      "/d",
      "/s",
      "/c",
      String(command),
      ...((Array.isArray(args) ? args : []).map(value => String(value)))
    ], {
      ...spawnOptions
    });
  }

  const result = spawnSync(command, args, {
    ...spawnOptions
  });
  return result;
}

function commandExists(command, args = ["--version"]) {
  const result = runCommand(command, args, { stdio: "ignore" });
  return result && result.status === 0;
}

function commandReachable(command, args = ["--version"]) {
  const result = runCommand(command, args, { stdio: "ignore" });
  return !!(result && !(result.error && result.error.code === "ENOENT"));
}

function resolveNpmInvocation() {
  const probes = [];
  const nodeDir = path.dirname(process.execPath);

  if (process.platform === "win32") {
    probes.push({ command: "npm.cmd", prefixArgs: [], label: "PATH:npm.cmd" });
    probes.push({ command: path.join(nodeDir, "npm.cmd"), prefixArgs: [], label: "node-dir:npm.cmd" });
  }
  probes.push({ command: "npm", prefixArgs: [], label: "PATH:npm" });

  const npmCliCandidates = [
    path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(rootDir, "node_modules", "npm", "bin", "npm-cli.js")
  ];
  for (const npmCliPath of npmCliCandidates) {
    if (fs.existsSync(npmCliPath)) {
      probes.push({
        command: process.execPath,
        prefixArgs: [npmCliPath],
        label: `node:${npmCliPath}`
      });
    }
  }

  probes.push({ command: "corepack", prefixArgs: ["npm"], label: "PATH:corepack npm" });

  for (const probe of probes) {
    if (commandReachable(probe.command, probe.prefixArgs.concat(["--version"]))) {
      return probe;
    }
  }
  return null;
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

function runNpmInstall(reason, options = {}) {
  const npm = resolveNpmInvocation();
  if (!npm) {
    if (options.allowSkipWhenSatisfied) {
      const missing = findMissingNodeDependencies();
      if (!missing.length) {
        console.warn("[BOOT] npm is unavailable; skipping npm install because dependencies already appear installed.");
        return true;
      }
    }
    console.error("[BOOT][ERROR] npm not found (PATH/node runtime/corepack); cannot install Node dependencies.");
    return false;
  }

  const hasLockfile = fs.existsSync(path.join(rootDir, "package-lock.json"));
  const attempts = [];
  if (hasLockfile) {
    attempts.push({
      label: "npm ci",
      args: ["ci", "--include=optional", "--no-audit", "--no-fund"]
    });
  }
  attempts.push({
    label: "npm install",
    args: ["install", "--include=optional", "--no-audit", "--no-fund"]
  });

  console.log(`[BOOT] Running full Node dependency sync (${reason}) via ${npm.label}...`);
  for (const attempt of attempts) {
    const result = runCommand(
      npm.command,
      npm.prefixArgs.concat(attempt.args),
      { stdio: "inherit" }
    );
    if (result.status === 0) {
      return true;
    }
    console.warn(`[BOOT] ${attempt.label} failed; ${attempt === attempts[attempts.length - 1] ? "no more fallbacks" : "trying fallback"}...`);
  }

  console.error("[BOOT][ERROR] npm dependency sync failed.");
  return false;
}

function ensureNodeDependencies(plan) {
  if (plan && plan.forceFullInstall) {
    const missing = findMissingNodeDependencies();
    if (!missing.length) {
      console.log(`[BOOT] Node dependencies already present; skipping npm install (${plan.reason}).`);
      return true;
    }
    const allowSkip = plan.reason === "first-launch-on-this-system";
    return runNpmInstall(`${plan.reason || "full-bootstrap"}:missing-${missing.length}`, {
      allowSkipWhenSatisfied: allowSkip
    });
  }

  const missing = findMissingNodeDependencies();
  if (!missing.length) return true;
  return runNpmInstall(`missing-node-dependencies:${missing.length}`);
}

function ensurePython313OnWindows(options = {}) {
  if (process.platform !== "win32") return false;
  const allowInstall = options.allowInstall !== false;
  const check = runCommand("py", ["-3.13", "-c", "import sys; print(sys.version)"]);
  if (check.status === 0) return true;

  if (!allowInstall) {
    console.warn("[BOOT] Python 3.13 not found; auto-install is disabled in this launch mode.");
    return false;
  }

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

function ensureProcessLoopbackPythonDeps(options = {}) {
  if (process.platform !== "win32") return true;
  const allowInstall = options.allowInstall !== false;
  if (!ensurePython313OnWindows({ allowInstall })) return false;

  const check = runCommand("py", ["-3.13", "-c", "import proctap, psutil"]);
  if (check.status === 0) return true;

  if (!allowInstall) {
    console.warn("[BOOT] Python deps (proc-tap, psutil) not found; auto-install is disabled in this launch mode.");
    return false;
  }

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

function ensureFfmpegBinary(options = {}) {
  const configuredPath = String(process.env.RAVE_AUDIO_FFMPEG_PATH || "").trim();
  if (configuredPath && commandExists(configuredPath, ["-version"])) return true;
  if (commandExists("ffmpeg", ["-version"])) return true;
  const allowInstall = options.allowInstall !== false;

  if (process.platform !== "win32") {
    console.warn("[BOOT] ffmpeg is not available in PATH; install ffmpeg for app isolation capture support.");
    return false;
  }

  if (!allowInstall) {
    console.warn("[BOOT] ffmpeg not found; auto-install is disabled in this launch mode.");
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
  const plan = resolveBootstrapPlan();
  const allowSystemDepInstall = bootstrapSystemDepsEnabled;

  if (!bootstrapDepsEnabled) {
    const missingNodeDeps = findMissingNodeDependencies();
    if (missingNodeDeps.length) {
      console.error(
        `[BOOT][ERROR] Missing Node dependencies (${missingNodeDeps.length}) while bootstrap is disabled. ` +
        "Use a self-contained package or set RAVELINK_BOOTSTRAP_DEPS=1."
      );
      return false;
    }

    const modeText = allowSystemDepInstall ? "system-tools-install-enabled" : "verify-only";
    console.log(`[BOOT] Dependency bootstrap disabled via RAVELINK_BOOTSTRAP_DEPS=0 (${modeText}).`);

    const ffmpegReady = ensureFfmpegBinary({ allowInstall: allowSystemDepInstall });
    const processLoopbackReady = ensureProcessLoopbackPythonDeps({ allowInstall: allowSystemDepInstall });
    writeBootstrapState({
      schema: bootstrapSchemaVersion,
      depFingerprint: plan.depFingerprint,
      nodeInstallReason: "verify-only",
      ffmpegReady: ffmpegReady === true,
      processLoopbackReady: processLoopbackReady === true,
      updatedAt: new Date().toISOString()
    });

    if (process.platform === "win32" && (!ffmpegReady || !processLoopbackReady)) {
      console.warn("[BOOT] Optional Windows audio tools are unavailable; app isolation features may be limited.");
    }
    return true;
  }

  if (plan.forceFullInstall) {
    console.log(`[BOOT] Full dependency bootstrap required (${plan.reason}).`);
  }

  if (!ensureNodeDependencies(plan)) {
    return false;
  }

  const ffmpegReady = ensureFfmpegBinary({ allowInstall: allowSystemDepInstall });
  const processLoopbackReady = ensureProcessLoopbackPythonDeps({ allowInstall: allowSystemDepInstall });
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

if (bootstrapOnlyMode) {
  console.log("[BOOT] Bootstrap-only mode complete.");
  process.exit(0);
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
