const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "core", "core-lock-manifest.json");

function loadManifest() {
  const raw = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const files = Array.isArray(raw.files)
    ? raw.files
      .map(item => String(item || "").trim())
      .filter(Boolean)
    : [];
  return {
    version: Number(raw.version || 0),
    files
  };
}

function resolveTargets(relPaths) {
  const resolved = [];
  const seen = new Set();
  for (const rel of relPaths) {
    const full = path.resolve(ROOT, rel);
    if (!full.startsWith(ROOT)) continue;
    if (seen.has(full)) continue;
    seen.add(full);
    resolved.push({
      rel: rel.replace(/\\/g, "/"),
      full
    });
  }
  return resolved;
}

function isWritable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function setWritableBit(filePath, writable) {
  const stat = fs.statSync(filePath);
  const mode = stat.mode;
  const nextMode = writable
    ? (mode | 0o222)
    : (mode & ~0o222);
  fs.chmodSync(filePath, nextMode);
}

function runMode(mode) {
  const manifest = loadManifest();
  const targets = resolveTargets(manifest.files);
  const writable = mode === "unlock";

  let ok = 0;
  let missing = 0;
  let failed = 0;

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

      if (mode !== "status") {
        setWritableBit(target.full, writable);
      }

      const nowWritable = isWritable(target.full);
      const state = nowWritable ? "writable" : "read-only";
      console.log(`[core-lock] ${target.rel} -> ${state}`);
      ok += 1;
    } catch (err) {
      failed += 1;
      console.log(`[core-lock] failed: ${target.rel} (${err.message || err})`);
    }
  }

  console.log(
    `[core-lock] mode=${mode} manifest=v${manifest.version} ok=${ok} missing=${missing} failed=${failed}`
  );

  if (failed > 0) {
    process.exitCode = 1;
  }
}

function usage() {
  console.log("Usage: node scripts/core-lock.js <lock|unlock|status>");
}

function main() {
  const mode = String(process.argv[2] || "status").trim().toLowerCase();
  if (mode !== "lock" && mode !== "unlock" && mode !== "status") {
    usage();
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(MANIFEST_PATH)) {
    console.log(`[core-lock] manifest missing: ${MANIFEST_PATH}`);
    process.exitCode = 1;
    return;
  }

  runMode(mode);
}

main();
