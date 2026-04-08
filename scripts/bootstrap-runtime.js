// [TITLE] Script: scripts/bootstrap-runtime.js
// [TITLE] Purpose: deterministic dependency bootstrap for local runtime startup
// [TITLE] Functionality Index:
// [TITLE] - install dependencies on first boot
// [TITLE] - reinstall when package-lock hash changes
// [TITLE] - support explicit force/skip/install-only flags
// [DEV] Complex Flow:
// [DEV] Lockfile hash is used as a lightweight cache key so normal startup avoids
// [DEV] package manager work while still auto-healing after dependency updates.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const ROOT = process.cwd();
const PACKAGE_JSON_PATH = path.join(ROOT, "package.json");
const PACKAGE_LOCK_PATH = path.join(ROOT, "package-lock.json");
const NODE_MODULES_PATH = path.join(ROOT, "node_modules");
const HASH_CACHE_PATH = path.join(ROOT, "runtime", "bootstrap", "deps-lock.sha256");

const args = new Set(process.argv.slice(2).map(item => String(item || "").trim().toLowerCase()));
const forceInstall = args.has("--force-install");
const skipInstall = args.has("--skip-install");
const installOnly = args.has("--install-only");
const allowSiblingRepoTools = ["1", "true", "yes", "on"].includes(
  String(process.env.RAVELINK_ALLOW_SIBLING_REPO_TOOLS || "").trim().toLowerCase()
);

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function sha256File(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

function readTextFileOrEmpty(filePath) {
  try {
    return String(fs.readFileSync(filePath, "utf8") || "").trim();
  } catch {
    return "";
  }
}

function writeHashCache(value) {
  fs.mkdirSync(path.dirname(HASH_CACHE_PATH), { recursive: true });
  fs.writeFileSync(HASH_CACHE_PATH, `${String(value || "").trim()}\n`, "utf8");
}

function getDependencyNames(packageJson) {
  const deps = packageJson && typeof packageJson === "object" ? packageJson.dependencies : {};
  if (!deps || typeof deps !== "object" || Array.isArray(deps)) return [];
  return Object.keys(deps).map(name => String(name || "").trim()).filter(Boolean);
}

function hasRequiredModules(dependencyNames = []) {
  if (!fs.existsSync(NODE_MODULES_PATH)) return false;
  for (const dep of dependencyNames) {
    const depPath = path.join(NODE_MODULES_PATH, dep, "package.json");
    if (!fs.existsSync(depPath)) return false;
  }
  return true;
}

function runInstall() {
  const installAttempts = process.platform === "win32"
    ? [
      { label: "npm ci", command: "cmd.exe", args: ["/d", "/s", "/c", "npm.cmd ci --no-audit --no-fund"] },
      { label: "npm install", command: "cmd.exe", args: ["/d", "/s", "/c", "npm.cmd install --no-audit --no-fund"] }
    ]
    : [
      { label: "npm ci", command: "npm", args: ["ci", "--no-audit", "--no-fund"] },
      { label: "npm install", command: "npm", args: ["install", "--no-audit", "--no-fund"] }
    ];

  const failures = [];
  for (const attempt of installAttempts) {
    console.log(`[BOOTSTRAP] attempting ${attempt.label}...`);
    const result = spawnSync(attempt.command, attempt.args, {
      cwd: ROOT,
      stdio: "inherit"
    });
    if (result.status === 0) {
      if (attempt.label !== "npm ci") {
        console.warn(`[BOOTSTRAP] recovered using ${attempt.label} fallback.`);
      }
      return;
    }
    failures.push(`${attempt.label}=exit_${Number(result.status || 1)}`);
  }

  if (failures.length) {
    throw new Error(`dependency install failed (${failures.join(", ")})`);
  }
}

function listSiblingRepoRoots() {
  const parentDir = path.dirname(ROOT);
  const currentBase = path.basename(ROOT).toLowerCase();
  try {
    return fs.readdirSync(parentDir, { withFileTypes: true })
      .filter(entry => entry && entry.isDirectory && entry.isDirectory())
      .map(entry => String(entry.name || "").trim())
      .filter(name => /^RaveLink-Bridge-Windows-v/i.test(name))
      .filter(name => name.toLowerCase() !== currentBase)
      .map(name => path.join(parentDir, name));
  } catch {
    return [];
  }
}

function copyFileIfPresent(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) return false;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  return true;
}

function syncBundledRustAudioTools() {
  if (!allowSiblingRepoTools) return;

  const toolSpecs = [
    {
      label: "rust-audio-isolator",
      target: path.join(ROOT, "runtime", "tools", "rust-audio-isolator", "ravelink-rust-audio-isolator.exe"),
      relCandidates: [
        path.join("runtime", "tools", "rust-audio-isolator", "ravelink-rust-audio-isolator.exe"),
        path.join("runtime", "tools", "rust-runtime", "ravelink-rust-audio-isolator.exe")
      ]
    },
    {
      label: "rust-audio-kernel",
      target: path.join(ROOT, "runtime", "tools", "rust-runtime", "ravelink-audio-kernel.exe"),
      relCandidates: [
        path.join("runtime", "tools", "rust-runtime", "ravelink-audio-kernel.exe")
      ]
    },
    {
      label: "rust-source-resolver",
      target: path.join(ROOT, "runtime", "tools", "rust-runtime", "ravelink-source-resolver.exe"),
      relCandidates: [
        path.join("runtime", "tools", "rust-runtime", "ravelink-source-resolver.exe")
      ]
    },
    {
      label: "rust-transport-worker",
      target: path.join(ROOT, "runtime", "tools", "rust-runtime", "ravelink-transport-worker.exe"),
      relCandidates: [
        path.join("runtime", "tools", "rust-runtime", "ravelink-transport-worker.exe")
      ]
    }
  ];

  const siblingRoots = listSiblingRepoRoots();
  if (!siblingRoots.length) return;

  for (const tool of toolSpecs) {
    if (fs.existsSync(tool.target)) continue;
    let copied = false;
    for (const repoRoot of siblingRoots) {
      for (const relCandidate of tool.relCandidates) {
        const sourcePath = path.join(repoRoot, relCandidate);
        if (!fs.existsSync(sourcePath)) continue;
        copied = copyFileIfPresent(sourcePath, tool.target);
        if (copied) {
          console.log(`[BOOTSTRAP] synced ${tool.label} from ${path.basename(repoRoot)}.`);
          break;
        }
      }
      if (copied) break;
    }
    if (!copied) {
      console.warn(`[BOOTSTRAP] ${tool.label} not found in sibling repos; continuing without local bundled copy.`);
    }
  }
}

function main() {
  if (!fs.existsSync(PACKAGE_JSON_PATH) || !fs.existsSync(PACKAGE_LOCK_PATH)) {
    throw new Error("package.json or package-lock.json is missing");
  }

  const packageJson = readJsonFile(PACKAGE_JSON_PATH);
  const deps = getDependencyNames(packageJson);
  const lockHash = sha256File(PACKAGE_LOCK_PATH);
  const cachedHash = readTextFileOrEmpty(HASH_CACHE_PATH);
  const modulesPresent = hasRequiredModules(deps);

  const needsInstall =
    forceInstall ||
    !modulesPresent ||
    !cachedHash ||
    cachedHash !== lockHash;

  if (skipInstall) {
    console.log("[BOOTSTRAP] --skip-install set, dependency check/install skipped.");
    return;
  }

  if (needsInstall) {
    const reason = forceInstall
      ? "forced"
      : !modulesPresent
        ? "node_modules_missing_or_incomplete"
        : !cachedHash
          ? "hash_cache_missing"
          : "lock_hash_changed";
    console.log(`[BOOTSTRAP] installing dependencies (${reason})...`);
    runInstall();
    writeHashCache(lockHash);
    console.log("[BOOTSTRAP] dependencies ready.");
  } else {
    console.log("[BOOTSTRAP] dependencies up to date (fast path).");
  }

  // [DEV] Keep runtime audio/mod binaries local to this repo so launcher behavior
  // [DEV] is deterministic and does not depend on sibling repo execution paths.
  syncBundledRustAudioTools();

  if (installOnly) {
    console.log("[BOOTSTRAP] --install-only completed.");
  }
}

try {
  main();
} catch (error) {
  console.error(`[BOOTSTRAP] ${error.message}`);
  process.exit(1);
}
