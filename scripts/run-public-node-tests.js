const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const testDir = path.join(repoRoot, "test");
const localOnlyModDir = path.join(repoRoot, "mods", "song-request-mod");
const excludeWhenModMissing = new Set([
  "apple-music-se-command.integration.test.js",
  "apple-music-ui-render-hardening.test.js",
  "apple-music-widget-announcer.test.js",
  "apple-music-widget-template.test.js"
]);

function collectTests(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTests(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".test.js")) {
      files.push(fullPath);
    }
  }
  return files;
}

const modAvailable = fs.existsSync(localOnlyModDir);
const testFiles = collectTests(testDir).filter((filePath) => {
  if (modAvailable) return true;
  return !excludeWhenModMissing.has(path.basename(filePath));
});

if (!modAvailable) {
  console.log("[TEST] local-only song-request mod not present; skipping mod-coupled apple-music tests");
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  cwd: repoRoot,
  stdio: "inherit"
});

process.exit(result.status ?? 1);

