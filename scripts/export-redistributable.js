const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const APP_NAME = "RaveLink-Bridge";
const RELEASE_NAME = `${APP_NAME}-Windows-v${pkg.version}`;
const RELEASE_ROOT = path.join(ROOT, "release");
const OUT_DIR = path.join(RELEASE_ROOT, RELEASE_NAME);

const SKIP_DIRS = new Set([
  ".git",
  ".vscode",
  "node_modules",
  "backups",
  "release"
]);

const SKIP_RELATIVE_DIRS = new Set([
  ".runtime",
  "debug",
  "core/test-versions",
  "core/unstable"
]);

const SKIP_FILES = new Set([
  "boot-test.js",
  "fixtures.config.local.backup.json"
]);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeDateStamp() {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join("");
}

function prepareOutDir(baseOutDir) {
  ensureDir(path.dirname(baseOutDir));

  if (!fs.existsSync(baseOutDir)) {
    ensureDir(baseOutDir);
    return { outDir: baseOutDir, fallbackUsed: false, fallbackReason: "" };
  }

  try {
    fs.rmSync(baseOutDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
    ensureDir(baseOutDir);
    return { outDir: baseOutDir, fallbackUsed: false, fallbackReason: "" };
  } catch (err) {
    const code = String(err?.code || "");
    if (code !== "EPERM" && code !== "EBUSY" && code !== "ENOTEMPTY") {
      throw err;
    }

    const fallbackDir = `${baseOutDir}-${safeDateStamp()}`;
    ensureDir(fallbackDir);
    return { outDir: fallbackDir, fallbackUsed: true, fallbackReason: code };
  }
}

function copyRecursive(srcPath, dstPath, relPath = "") {
  const stat = fs.statSync(srcPath);
  if (stat.isDirectory()) {
    const base = path.basename(srcPath);
    const normalizedRelPath = String(relPath || "").replace(/\\/g, "/");
    if (SKIP_DIRS.has(base) && relPath !== "") return;
    if (SKIP_RELATIVE_DIRS.has(normalizedRelPath)) return;
    ensureDir(dstPath);
    for (const entry of fs.readdirSync(srcPath)) {
      const nextSrc = path.join(srcPath, entry);
      const nextDst = path.join(dstPath, entry);
      const nextRel = relPath ? path.join(relPath, entry) : entry;
      copyRecursive(nextSrc, nextDst, nextRel);
    }
    return;
  }

  const fileName = path.basename(srcPath);
  if (SKIP_FILES.has(fileName)) return;
  fs.copyFileSync(srcPath, dstPath);
}

function writeReleaseReadme(outDir) {
  const rootReadmePath = path.join(ROOT, "README.md");
  let content = "";
  try {
    content = fs.readFileSync(rootReadmePath, "utf8");
  } catch {
    content = `# ${APP_NAME}\n\nSee project README for setup and documentation.\n`;
  }
  fs.writeFileSync(path.join(outDir, "README.md"), content, "utf8");
  fs.writeFileSync(path.join(outDir, "REDISTRIBUTABLE.md"), content, "utf8");
}

function writePlatformMarker(outDir) {
  const content = [
    "RaveLink Bridge - Windows Build",
    "",
    "Official packaged target: Windows 10/11 (x64).",
    "Linux/macOS are not currently official packaged targets.",
    "",
    "Launchers:",
    "- RaveLink-Bridge.bat",
    "- RaveLink-Bridge-Stop.bat"
  ].join("\n");

  fs.writeFileSync(path.join(outDir, "PLATFORM-WINDOWS-ONLY.txt"), `${content}\n`, "utf8");
}

function createReleaseZip(outDir) {
  const zipPath = path.join(RELEASE_ROOT, `${path.basename(outDir)}.zip`);
  if (fs.existsSync(zipPath)) {
    fs.rmSync(zipPath, { force: true });
  }

  const result = process.platform === "win32"
    ? spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        [
          "$ErrorActionPreference = 'Stop'",
          "Add-Type -AssemblyName 'System.IO.Compression.FileSystem'",
          `$source = '${String(outDir).replace(/'/g, "''")}'`,
          `$destination = '${String(zipPath).replace(/'/g, "''")}'`,
          "if (Test-Path $destination) { Remove-Item -Force $destination }",
          "[System.IO.Compression.ZipFile]::CreateFromDirectory($source, $destination, [System.IO.Compression.CompressionLevel]::Optimal, $false)"
        ].join("; ")
      ],
      { encoding: "utf8" }
    )
    : spawnSync("zip", ["-r", "-q", zipPath, "."], {
      cwd: outDir,
      encoding: "utf8"
    });

  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim();
    const stdout = String(result.stdout || "").trim();
    const details = stderr || stdout || `exit=${result.status}`;
    throw new Error(`zip creation failed: ${details}`);
  }

  return zipPath;
}

function main() {
  const prep = prepareOutDir(OUT_DIR);
  const finalOutDir = prep.outDir;
  copyRecursive(ROOT, finalOutDir);

  const sanitizeScript = path.join(ROOT, "scripts", "sanitize-release.js");
  if (fs.existsSync(sanitizeScript)) {
    const sanitizeRelease = require(sanitizeScript);
    if (typeof sanitizeRelease === "function") {
      sanitizeRelease(finalOutDir);
    }
  }

  writeReleaseReadme(finalOutDir);
  writePlatformMarker(finalOutDir);
  const zipPath = createReleaseZip(finalOutDir);

  if (prep.fallbackUsed) {
    console.log(`[export-redistributable] default output locked (${prep.fallbackReason}), using fallback path`);
  }
  console.log(`[export-redistributable] zip: ${zipPath}`);
  console.log(`[export-redistributable] ready: ${finalOutDir}`);
}

main();
