// [TITLE] Module: scripts/export-redistributable.js
// [TITLE] Purpose: export-redistributable

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
  ".pushrepo",
  ".github",
  ".husky",
  ".idea",
  ".vscode",
  "backup",
  "node_modules",
  "backups",
  "release"
]);

const SKIP_RELATIVE_DIRS = new Set([
  ".runtime",
  "debug",
  "core/backups",
  "core/test-versions",
  "core/unstable"
]);
const SKIP_DIR_SUFFIXES = [
  "-EXTRACT-FIRST"
];
const SKIP_DIR_SUBSTRINGS = [
  "-EXTRACT-FIRST.BAK-"
];

const SKIP_FILES = new Set([
  "boot-test.js",
  "fixtures.config.local.backup.json",
  ".core-lock.key",
  ".gitignore",
  ".gitattributes",
  ".DS_Store",
  "Thumbs.db",
  "AGENTS.md"
]);

const SKIP_FILE_PATTERNS = [
  /^RaveLink-Bridge-Windows-v[\w.\-]+\.zip$/i,
  /^RaveLink-Bridge-Windows-v[\w.\-]+-self-contained\.zip$/i,
  /^RaveLink-Bridge-(?:Windows-)?v?[\w.\-]+-setup-installer\.exe$/i,
  /^RaveLink-Bridge-Setup-v[\w.\-]+\.exe$/i
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function cleanupFallbackDirs(baseOutDir) {
  const releaseRoot = path.dirname(baseOutDir);
  const baseName = path.basename(baseOutDir);
  const fallbackPrefix = `${baseName}-`;
  if (!fs.existsSync(releaseRoot)) return;
  for (const entry of fs.readdirSync(releaseRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith(fallbackPrefix)) continue;
    fs.rmSync(path.join(releaseRoot, entry.name), { recursive: true, force: true });
  }
}

function prepareOutDir(baseOutDir) {
  ensureDir(path.dirname(baseOutDir));
  cleanupFallbackDirs(baseOutDir);

  if (!fs.existsSync(baseOutDir)) {
    ensureDir(baseOutDir);
    return baseOutDir;
  }

  try {
    fs.rmSync(baseOutDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
    ensureDir(baseOutDir);
    return baseOutDir;
  } catch (err) {
    const code = String(err?.code || "");
    throw new Error(
      `[export-redistributable] cannot replace existing output (${code || "unknown"}): ${baseOutDir}`
    );
  }
}

function copyRecursive(srcPath, dstPath, relPath = "") {
  const stat = fs.lstatSync(srcPath);
  // Never follow symlinks/junctions in release export.
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    const base = path.basename(srcPath);
    const normalizedRelPath = String(relPath || "").replace(/\\/g, "/");
    if (SKIP_DIRS.has(base) && relPath !== "") return;
    if (SKIP_DIR_SUFFIXES.some(suffix => base.endsWith(suffix)) && relPath !== "") return;
    if (SKIP_DIR_SUBSTRINGS.some(fragment => base.includes(fragment)) && relPath !== "") return;
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
  if (SKIP_FILE_PATTERNS.some(pattern => pattern.test(fileName))) return;
  // Exclude common development metadata/config dotfiles from redistributable builds.
  if (fileName.startsWith(".git")) return;
  if (fileName.startsWith(".codex")) return;
  fs.copyFileSync(srcPath, dstPath);
}

function writeReleaseReadme(outDir) {
  const rootReadmePath = path.join(ROOT, "README.md");
  const rootRedistributablePath = path.join(ROOT, "REDISTRIBUTABLE.md");
  let content = "";
  let redistributableContent = "";
  try {
    content = fs.readFileSync(rootReadmePath, "utf8");
  } catch {
    content = `# ${APP_NAME}\n\nSee project README for setup and documentation.\n`;
  }
  try {
    redistributableContent = fs.readFileSync(rootRedistributablePath, "utf8");
  } catch {
    redistributableContent = content;
  }
  fs.writeFileSync(path.join(outDir, "README.md"), content, "utf8");
  fs.writeFileSync(path.join(outDir, "REDISTRIBUTABLE.md"), redistributableContent, "utf8");
}

function writePlatformMarker(outDir) {
  const content = [
    "RaveLink Bridge - Windows Build",
    "",
    "Official packaged target: Windows 10/11 (x64).",
    "Linux/macOS are not currently official packaged targets.",
    "Source startup on Linux is available in experimental form via shell launchers.",
    "",
    "Launchers:",
    "- RaveLink-Bridge.bat",
    "- RaveLink-Bridge-Stop.bat",
    "",
    "Experimental source launchers:",
    "- RaveLink-Bridge.sh",
    "- RaveLink-Bridge-Stop.sh"
  ].join("\n");

  fs.writeFileSync(path.join(outDir, "PLATFORM-WINDOWS-ONLY.txt"), `${content}\n`, "utf8");
}

function writeDistributionManifest(outDir, options = {}) {
  const selfContained = options.selfContained === true;
  const manifest = {
    schema: 1,
    appName: APP_NAME,
    version: String(pkg.version || ""),
    targetPlatform: "windows",
    packaged: true,
    selfContained,
    bootstrapDefaults: {
      deps: selfContained ? "off" : "on",
      systemDeps: selfContained ? "off" : "on"
    },
    generatedAt: new Date().toISOString()
  };
  fs.writeFileSync(
    path.join(outDir, "distribution.manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
}

function createReleaseZip(outDir, options = {}) {
  const zipBaseName = String(options.zipBaseName || path.basename(outDir)).trim() || path.basename(outDir);
  const zipPath = path.join(RELEASE_ROOT, `${zipBaseName}.zip`);
  if (fs.existsSync(zipPath)) {
    fs.rmSync(zipPath, { force: true });
  }

  if (process.platform !== "win32") {
    throw new Error("zip creation currently requires Windows (powershell.exe)");
  }

  const source = String(outDir).replace(/'/g, "''");
  const destination = String(zipPath).replace(/'/g, "''");
  const includeBaseDirectory = options.includeBaseDirectory === true ? "$true" : "$false";
  const psScript = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName 'System.IO.Compression.FileSystem'",
    `$source = '${source}'`,
    `$destination = '${destination}'`,
    "if (Test-Path $destination) { Remove-Item -Force $destination }",
    `[System.IO.Compression.ZipFile]::CreateFromDirectory($source, $destination, [System.IO.Compression.CompressionLevel]::Optimal, ${includeBaseDirectory})`
  ].join("; ");

  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", psScript],
    { encoding: "utf8" }
  );

  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim();
    const stdout = String(result.stdout || "").trim();
    const details = stderr || stdout || `exit=${result.status}`;
    throw new Error(`zip creation failed: ${details}`);
  }

  return zipPath;
}

function main() {
  const finalOutDir = prepareOutDir(OUT_DIR);
  copyRecursive(ROOT, finalOutDir);

  const sanitizeScript = path.join(ROOT, "scripts", "sanitize-release.js");
  if (fs.existsSync(sanitizeScript)) {
    const sanitizeRelease = require(sanitizeScript);
    if (typeof sanitizeRelease === "function") {
      sanitizeRelease(finalOutDir, {
        purgeBackups: true
      });
    }
  }

  writeReleaseReadme(finalOutDir);
  writePlatformMarker(finalOutDir);
  writeDistributionManifest(finalOutDir, { selfContained: false });

  const zipPath = createReleaseZip(finalOutDir, {
    zipBaseName: path.basename(finalOutDir),
    includeBaseDirectory: true
  });

  cleanupFallbackDirs(OUT_DIR);
  console.log(`[export-redistributable] zip: ${zipPath}`);
  console.log(`[export-redistributable] ready: ${finalOutDir}`);
}

main();
