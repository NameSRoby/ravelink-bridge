// [TITLE] Module: scripts/core-lock.js
// [TITLE] Purpose: core-lock

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "core", "core-lock-manifest.json");
const DEFAULT_UNLOCK = Object.freeze({
  keyFile: "core/.core-lock.key",
  envVar: "RAVELINK_CORE_UNLOCK_KEY",
  requireForUnlock: true
});

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const raw = String(value).trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return fallback;
}

function normalizeManifestPath(relPath = "") {
  const clean = String(relPath || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  const full = path.resolve(ROOT, clean);
  if (full === ROOT || full.startsWith(ROOT + path.sep)) {
    return { rel: clean, full };
  }
  throw new Error(`path escapes repository root: ${relPath}`);
}

function loadManifest() {
  const raw = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const files = Array.isArray(raw.files)
    ? raw.files
      .map(item => String(item || "").trim())
      .filter(Boolean)
    : [];
  const immutableFiles = Array.isArray(raw.immutableFiles)
    ? raw.immutableFiles
      .map(item => String(item || "").trim())
      .filter(Boolean)
    : [];

  const unlockRaw = raw.unlock && typeof raw.unlock === "object" ? raw.unlock : {};
  const keyInfo = normalizeManifestPath(unlockRaw.keyFile || DEFAULT_UNLOCK.keyFile);
  const envVar = String(unlockRaw.envVar || DEFAULT_UNLOCK.envVar).trim() || DEFAULT_UNLOCK.envVar;
  const requireForUnlock = parseBool(unlockRaw.requireForUnlock, DEFAULT_UNLOCK.requireForUnlock);

  return {
    version: Number(raw.version || 0),
    files,
    immutableFiles,
    unlock: {
      keyFile: keyInfo.rel,
      keyPath: keyInfo.full,
      envVar,
      requireForUnlock
    }
  };
}

function resolveTargets(relPaths) {
  const resolved = [];
  const seen = new Set();
  for (const rel of relPaths) {
    const info = normalizeManifestPath(rel);
    if (seen.has(info.full)) continue;
    seen.add(info.full);
    resolved.push({
      rel: info.rel,
      full: info.full
    });
  }
  return resolved;
}

function hasWindowsReadonlyAttribute(filePath) {
  if (process.platform !== "win32") return false;
  try {
    const out = execFileSync("attrib", [filePath], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"]
    }).toString("utf8");
    const line = String(out || "").trim().split(/\r?\n/).find(Boolean) || "";
    return /\bR\b/.test(line);
  } catch {
    return false;
  }
}

function isWritable(filePath) {
  if (process.platform === "win32" && hasWindowsReadonlyAttribute(filePath)) {
    return false;
  }
  try {
    fs.accessSync(filePath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function setWritableBit(filePath, writable) {
  if (process.platform === "win32") {
    try {
      execFileSync("attrib", [writable ? "-R" : "+R", filePath], {
        windowsHide: true,
        stdio: "ignore"
      });
    } catch {}
  }
  const stat = fs.statSync(filePath);
  const mode = stat.mode;
  const nextMode = writable
    ? (mode | 0o222)
    : (mode & ~0o222);
  fs.chmodSync(filePath, nextMode);
}

function parseCliArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const out = {
    key: "",
    force: false
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i] || "").trim();
    if (!token) continue;

    if (token === "--force") {
      out.force = true;
      continue;
    }
    if (token.startsWith("--key=")) {
      out.key = token.slice("--key=".length).trim();
      continue;
    }
    if (token === "--key" && i + 1 < args.length) {
      out.key = String(args[i + 1] || "").trim();
      i += 1;
    }
  }
  return out;
}

function maskKey(key) {
  const raw = String(key || "").trim();
  if (!raw) return "";
  if (raw.length <= 8) return "********";
  return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
}

function readUnlockKeyFile(keyPath) {
  try {
    const raw = fs.readFileSync(keyPath, "utf8");
    const key = String(raw || "").trim();
    return key || "";
  } catch {
    return "";
  }
}

function writeUnlockKeyFile(keyPath, keyValue) {
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, `${String(keyValue || "").trim()}\n`, { encoding: "utf8", mode: 0o600 });
}

function generateUnlockKey() {
  return crypto.randomBytes(24).toString("hex");
}

function initUnlockKey(manifest, options = {}) {
  const force = options.force === true;
  const existing = readUnlockKeyFile(manifest.unlock.keyPath);
  if (existing && !force) {
    return {
      ok: true,
      created: false,
      key: existing,
      keyPath: manifest.unlock.keyPath
    };
  }

  const nextKey = generateUnlockKey();
  writeUnlockKeyFile(manifest.unlock.keyPath, nextKey);
  return {
    ok: true,
    created: true,
    key: nextKey,
    keyPath: manifest.unlock.keyPath
  };
}

function validateUnlockKey(manifest, cli) {
  if (!manifest.unlock.requireForUnlock) {
    return { ok: true, method: "not-required" };
  }

  const expected = readUnlockKeyFile(manifest.unlock.keyPath);
  if (!expected) {
    return {
      ok: false,
      error: `unlock key file missing or empty: ${manifest.unlock.keyFile}`,
      hint: "run: npm run core:unlock:key:init"
    };
  }

  const fromCli = String(cli.key || "").trim();
  const fromEnv = String(process.env[manifest.unlock.envVar] || "").trim();
  const provided = fromCli || fromEnv;
  if (!provided) {
    return {
      ok: false,
      error: `unlock key required (provide --key=... or set ${manifest.unlock.envVar})`,
      hint: "run: npm run core:unlock:key:init"
    };
  }
  if (provided !== expected) {
    return {
      ok: false,
      error: "unlock key mismatch",
      hint: `expected key in ${manifest.unlock.keyFile}`
    };
  }

  return {
    ok: true,
    method: fromCli ? "cli" : "env"
  };
}

function showKeyStatus(manifest) {
  const value = readUnlockKeyFile(manifest.unlock.keyPath);
  const exists = Boolean(value);
  console.log(`[core-lock] keyFile=${manifest.unlock.keyFile}`);
  console.log(`[core-lock] requireForUnlock=${manifest.unlock.requireForUnlock ? "true" : "false"}`);
  console.log(`[core-lock] envVar=${manifest.unlock.envVar}`);
  if (exists) {
    console.log(`[core-lock] key=present (${maskKey(value)})`);
  } else {
    console.log("[core-lock] key=missing");
  }
}

function runMode(mode, manifest) {
  const mutableTargets = resolveTargets(manifest.files);
  const immutableTargets = resolveTargets(manifest.immutableFiles);
  const targets = [...mutableTargets, ...immutableTargets];
  const immutableSet = new Set(immutableTargets.map(item => item.full));
  const writable = mode === "unlock";

  let ok = 0;
  let missing = 0;
  let failed = 0;
  let immutableLocked = 0;

  for (const target of targets) {
    if (!fs.existsSync(target.full)) {
      missing += 1;
      console.log(`[core-lock] missing: ${target.rel}`);
      continue;
    }

    try {
      const stat = fs.statSync(target.full);
      if (!stat.isFile()) {
        console.log(`[core-lock] skip non-file: ${target.rel}`);
        continue;
      }

      const immutable = immutableSet.has(target.full);
      if (mode !== "status") {
        if (immutable && mode === "unlock") {
          setWritableBit(target.full, false);
          immutableLocked += 1;
        } else {
          setWritableBit(target.full, writable);
        }
      }

      const nowWritable = isWritable(target.full);
      const state = nowWritable ? "writable" : "read-only";
      if (immutable) {
        console.log(`[core-lock] ${target.rel} -> ${state} (immutable)`);
      } else {
        console.log(`[core-lock] ${target.rel} -> ${state}`);
      }
      ok += 1;
    } catch (err) {
      failed += 1;
      console.log(`[core-lock] failed: ${target.rel} (${err.message || err})`);
    }
  }

  console.log(
    `[core-lock] mode=${mode} manifest=v${manifest.version} ok=${ok} missing=${missing} failed=${failed} immutableLocked=${immutableLocked}`
  );

  if (failed > 0) {
    process.exitCode = 1;
  }
}

function usage() {
  console.log("Usage: node scripts/core-lock.js <lock|unlock|status|init-key|key-status> [--key=<unlockKey>] [--force]");
}

function main() {
  const mode = String(process.argv[2] || "status").trim().toLowerCase();
  const cli = parseCliArgs(process.argv.slice(3));
  if (
    mode !== "lock" &&
    mode !== "unlock" &&
    mode !== "status" &&
    mode !== "init-key" &&
    mode !== "key-status"
  ) {
    usage();
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(MANIFEST_PATH)) {
    console.log(`[core-lock] manifest missing: ${MANIFEST_PATH}`);
    process.exitCode = 1;
    return;
  }

  let manifest;
  try {
    manifest = loadManifest();
  } catch (err) {
    console.log(`[core-lock] manifest invalid: ${err.message || err}`);
    process.exitCode = 1;
    return;
  }

  if (mode === "init-key") {
    const result = initUnlockKey(manifest, { force: cli.force });
    console.log(
      `[core-lock] unlock key ${result.created ? "written" : "already exists"}: ${manifest.unlock.keyFile}`
    );
    console.log(`[core-lock] unlock key value: ${result.key}`);
    console.log(`[core-lock] export ${manifest.unlock.envVar}=<key> then run npm run core:unlock`);
    return;
  }

  if (mode === "key-status") {
    showKeyStatus(manifest);
    return;
  }

  if (mode === "unlock") {
    const check = validateUnlockKey(manifest, cli);
    if (!check.ok) {
      console.log(`[core-lock] unlock denied: ${check.error}`);
      if (check.hint) {
        console.log(`[core-lock] hint: ${check.hint}`);
      }
      process.exitCode = 1;
      return;
    }
    console.log(`[core-lock] unlock key accepted via ${check.method}`);
  }

  runMode(mode, manifest);
}

main();
