// [TITLE] Module: scripts/build-windows-setup.js
// [TITLE] Purpose: Build self-contained Windows setup payload + optional installer EXE

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const RELEASE_ROOT = path.join(ROOT, "release");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const RELEASE_NAME = `RaveLink-Bridge-Windows-v${pkg.version}`;
const RELEASE_DIR = path.join(RELEASE_ROOT, RELEASE_NAME);
const INSTALLER_DIR = path.join(RELEASE_ROOT, "installer");
const OUTPUT_BASE_FILENAME = `RaveLink-Bridge-Windows-v${pkg.version}-setup-installer`;
const ISS_PATH = path.join(INSTALLER_DIR, `${OUTPUT_BASE_FILENAME}.iss`);
const SELF_CONTAINED_ZIP = path.join(RELEASE_ROOT, `${RELEASE_NAME}-self-contained.zip`);
const sanitizeRelease = require("./sanitize-release");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    stdio: options.stdio || "inherit",
    encoding: "utf8",
    windowsHide: true
  });

  if (result.status !== 0) {
    const suffix = options.failureMessage ? ` ${options.failureMessage}` : "";
    throw new Error(`${command} exited with code ${result.status}.${suffix}`);
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyDir(sourceDir, destinationDir) {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Required directory missing: ${sourceDir}`);
  }

  fs.rmSync(destinationDir, { recursive: true, force: true });
  fs.cpSync(sourceDir, destinationDir, {
    recursive: true,
    force: true
  });
}

function copyFileIfExists(sourceFile, destinationFile) {
  if (!fs.existsSync(sourceFile)) return false;
  ensureDir(path.dirname(destinationFile));
  fs.copyFileSync(sourceFile, destinationFile);
  return true;
}

function resolveCommandPathWindows(commandName) {
  const result = spawnSync("where.exe", [String(commandName || "").trim()], {
    cwd: ROOT,
    stdio: "pipe",
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) return "";
  const lines = String(result.stdout || "")
    .split(/\r?\n/g)
    .map(line => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (fs.existsSync(line)) return line;
  }
  return "";
}

function copyBundledRuntime() {
  const runtimeDir = path.join(RELEASE_DIR, "runtime");
  const nodeDir = path.dirname(process.execPath);
  const nodeExeSource = process.execPath;
  const nodeExeTarget = path.join(runtimeDir, "node.exe");

  ensureDir(runtimeDir);
  fs.copyFileSync(nodeExeSource, nodeExeTarget);

  const npmDirSource = path.join(nodeDir, "node_modules", "npm");
  const npmDirTarget = path.join(runtimeDir, "node_modules", "npm");
  if (fs.existsSync(npmDirSource)) {
    copyDir(npmDirSource, npmDirTarget);
  } else {
    console.warn("[build-windows-setup] npm directory not found beside node.exe; runtime npm fallback may be unavailable.");
  }

  copyFileIfExists(path.join(nodeDir, "npm.cmd"), path.join(runtimeDir, "npm.cmd"));
  copyFileIfExists(path.join(nodeDir, "npx.cmd"), path.join(runtimeDir, "npx.cmd"));
}

function stageNodeModules() {
  const source = path.join(ROOT, "node_modules");
  const target = path.join(RELEASE_DIR, "node_modules");
  copyDir(source, target);
}

function stageBundledFfmpegRuntime() {
  const ffmpegPath = resolveCommandPathWindows("ffmpeg.exe") || resolveCommandPathWindows("ffmpeg");
  if (!ffmpegPath) return false;

  const sourceDir = path.dirname(ffmpegPath);
  const targetDir = path.join(RELEASE_DIR, "runtime", "tools", "ffmpeg");
  ensureDir(targetDir);
  fs.copyFileSync(ffmpegPath, path.join(targetDir, "ffmpeg.exe"));

  const ffprobeSource = path.join(sourceDir, "ffprobe.exe");
  if (fs.existsSync(ffprobeSource)) {
    fs.copyFileSync(ffprobeSource, path.join(targetDir, "ffprobe.exe"));
  }

  const dllFiles = fs.readdirSync(sourceDir)
    .filter(name => /\.dll$/i.test(name));
  for (const name of dllFiles) {
    copyFileIfExists(path.join(sourceDir, name), path.join(targetDir, name));
  }
  return true;
}

function sanitizePayloadForDistribution() {
  // Re-apply sanitize pass at payload root to guarantee no local-sensitive runtime
  // config slips into installer artifacts after staging runtime/tooling content.
  sanitizeRelease(RELEASE_DIR, {
    purgeRuntime: false,
    purgeRelease: false,
    pruneRootArtifacts: false,
    purgeBackups: true
  });
}

function writeDistributionManifestPatch(patch = {}) {
  const manifestPath = path.join(RELEASE_DIR, "distribution.manifest.json");
  let current = {};
  try {
    if (fs.existsSync(manifestPath)) {
      const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        current = parsed;
      }
    }
  } catch {}

  const next = {
    ...current,
    ...patch,
    generatedAt: new Date().toISOString()
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function findIsccPath() {
  const programFiles = process.env["ProgramFiles"] || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const localAppData = process.env.LOCALAPPDATA || "";
  const candidates = [
    process.env.ISCC_PATH,
    localAppData ? path.join(localAppData, "Programs", "Inno Setup 6", "ISCC.exe") : "",
    path.join(programFilesX86, "Inno Setup 6", "ISCC.exe"),
    path.join(programFiles, "Inno Setup 6", "ISCC.exe")
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "";
}

function innoString(text) {
  return String(text).replace(/\\/g, "\\\\");
}

function writeInstallerScript() {
  ensureDir(INSTALLER_DIR);

  const sourceDir = innoString(RELEASE_DIR);
  const outputDir = innoString(RELEASE_ROOT);
  const appVersion = innoString(pkg.version);
  const outputBaseFilename = innoString(OUTPUT_BASE_FILENAME);

  const content = [
    "; Generated by scripts/build-windows-setup.js",
    "#define AppName \"RaveLink Bridge\"",
    `#define AppVersion \"${appVersion}\"`,
    `#define SourceDir \"${sourceDir}\"`,
    `#define OutputDir \"${outputDir}\"`,
    `#define OutputBaseFilename \"${outputBaseFilename}\"`,
    "",
    "[Setup]",
    "AppId={{CF817F37-5F04-4C18-A2B0-8A1EAA2674C5}",
    "AppName={#AppName}",
    "AppVersion={#AppVersion}",
    "AppPublisher=NameSRoby",
    "DefaultDirName={localappdata}\\Programs\\RaveLink Bridge",
    "DefaultGroupName=RaveLink Bridge",
    "PrivilegesRequired=lowest",
    "PrivilegesRequiredOverridesAllowed=dialog",
    "DisableDirPage=no",
    "UsePreviousAppDir=no",
    "DisableProgramGroupPage=yes",
    "OutputDir={#OutputDir}",
    "OutputBaseFilename={#OutputBaseFilename}",
    "Compression=lzma2",
    "SolidCompression=yes",
    "WizardStyle=modern",
    "ArchitecturesAllowed=x64compatible",
    "ArchitecturesInstallIn64BitMode=x64compatible",
    "",
    "[Languages]",
    "Name: \"english\"; MessagesFile: \"compiler:Default.isl\"",
    "",
    "[Tasks]",
    "Name: \"desktopicon\"; Description: \"Create a desktop shortcut\"; GroupDescription: \"Additional icons:\"; Flags: unchecked",
    "Name: \"desktopuiicon\"; Description: \"Create a desktop shortcut for the browser UI\"; GroupDescription: \"Additional icons:\"; Flags: unchecked",
    "",
    "[Files]",
    "Source: \"{#SourceDir}\\*\"; DestDir: \"{app}\"; Flags: ignoreversion recursesubdirs createallsubdirs",
    "",
    "[Icons]",
    "Name: \"{group}\\RaveLink Bridge (Start)\"; Filename: \"{app}\\RaveLink-Bridge.bat\"",
    "Name: \"{group}\\RaveLink Bridge (Stop)\"; Filename: \"{app}\\RaveLink-Bridge-Stop.bat\"",
    "Name: \"{group}\\RaveLink Bridge (Open UI)\"; Filename: \"http://127.0.0.1:5050\"",
    "Name: \"{group}\\RaveLink Bridge (Install Optional Audio Tools)\"; Filename: \"{app}\\RaveLink-Bridge-Install-Optional-Audio-Tools.bat\"",
    "Name: \"{group}\\Uninstall RaveLink Bridge\"; Filename: \"{uninstallexe}\"",
    "Name: \"{autodesktop}\\RaveLink Bridge\"; Filename: \"{app}\\RaveLink-Bridge.bat\"; Tasks: desktopicon",
    "Name: \"{autodesktop}\\RaveLink Bridge UI\"; Filename: \"http://127.0.0.1:5050\"; Tasks: desktopuiicon",
    "",
    "[Run]",
    "Filename: \"{app}\\RaveLink-Bridge.bat\"; Description: \"Launch RaveLink Bridge\"; Flags: nowait postinstall skipifsilent"
  ].join("\n");

  fs.writeFileSync(ISS_PATH, `${content}\n`, "utf8");
}

function createSelfContainedZip() {
  const source = RELEASE_DIR.replace(/'/g, "''");
  const destination = SELF_CONTAINED_ZIP.replace(/'/g, "''");
  const psScript = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName 'System.IO.Compression.FileSystem'",
    `$source = '${source}'`,
    `$destination = '${destination}'`,
    "if (Test-Path $destination) { Remove-Item -Force $destination }",
    "[System.IO.Compression.ZipFile]::CreateFromDirectory($source, $destination, [System.IO.Compression.CompressionLevel]::Optimal, $true)"
  ].join("; ");

  run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    psScript
  ], {
    failureMessage: "Failed creating self-contained zip"
  });
}

function main() {
  if (process.platform !== "win32") {
    throw new Error("Windows setup build is only supported on Windows.");
  }

  console.log("[build-windows-setup] Exporting redistributable...");
  run(process.execPath, [path.join(ROOT, "scripts", "export-redistributable.js")], {
    failureMessage: "Failed while exporting redistributable payload"
  });

  console.log("[build-windows-setup] Staging node_modules into release payload...");
  stageNodeModules();

  console.log("[build-windows-setup] Bundling local Node runtime...");
  copyBundledRuntime();

  console.log("[build-windows-setup] Bundling ffmpeg runtime when available...");
  const ffmpegBundled = stageBundledFfmpegRuntime();
  if (ffmpegBundled) {
    console.log("[build-windows-setup] Bundled ffmpeg runtime detected and copied.");
  } else {
    console.log("[build-windows-setup] ffmpeg not detected on build machine; installer will run without bundled ffmpeg.");
  }

  writeDistributionManifestPatch({
    selfContained: true,
    bundledRuntime: true,
    bundledNodeModules: true,
    bundledFfmpeg: ffmpegBundled === true,
    bootstrapDefaults: {
      deps: "off",
      systemDeps: "off"
    }
  });

  console.log("[build-windows-setup] Sanitizing staged payload...");
  sanitizePayloadForDistribution();

  console.log("[build-windows-setup] Creating self-contained zip...");
  createSelfContainedZip();
  console.log(`[build-windows-setup] Self-contained zip ready: ${SELF_CONTAINED_ZIP}`);

  console.log("[build-windows-setup] Writing Inno Setup script...");
  writeInstallerScript();
  console.log(`[build-windows-setup] Inno script ready: ${ISS_PATH}`);

  const isccPath = findIsccPath();
  if (!isccPath) {
    console.log("[build-windows-setup] ISCC.exe not found; skipping installer compile.");
    console.log("[build-windows-setup] Install Inno Setup 6 or set ISCC_PATH, then compile:");
    console.log(`  \"C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe\" \"${ISS_PATH}\"`);
    return;
  }

  console.log(`[build-windows-setup] Compiling installer with ${isccPath}...`);
  run(isccPath, [ISS_PATH], {
    failureMessage: "Inno Setup compile failed"
  });

  const installerPath = path.join(RELEASE_ROOT, `${OUTPUT_BASE_FILENAME}.exe`);
  console.log(`[build-windows-setup] Installer ready: ${installerPath}`);
}

try {
  main();
} catch (err) {
  const message = err && err.message ? err.message : String(err);
  console.error(`[build-windows-setup][ERROR] ${message}`);
  process.exitCode = 1;
}
