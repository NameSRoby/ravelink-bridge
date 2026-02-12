const fs = require("fs");
const path = require("path");

const DEFAULT_ROOT = path.join(__dirname, "..");

const FIXTURES_TEMPLATE = {
  intentRoutes: {
    HUE_STATE: "all",
    WIZ_PULSE: "all",
    TWITCH_HUE: "all",
    TWITCH_WIZ: "all"
  },
  fixtures: [
    {
      id: "hue-main-1",
      brand: "hue",
      zone: "hue",
      enabled: true,
      engineEnabled: true,
      twitchEnabled: true,
      customEnabled: false,
      bridgeIp: "192.168.x.x",
      username: "replace_with_hue_username",
      bridgeId: "replace_with_bridge_id",
      clientKey: "replace_with_client_key",
      lightId: 1
    },
    {
      id: "wiz-background-1",
      brand: "wiz",
      zone: "wiz",
      enabled: true,
      engineEnabled: true,
      twitchEnabled: true,
      customEnabled: false,
      ip: "192.168.x.x"
    },
    {
      id: "wiz-custom-1",
      brand: "wiz",
      zone: "custom",
      enabled: true,
      engineEnabled: false,
      twitchEnabled: true,
      customEnabled: true,
      ip: "192.168.x.x"
    }
  ]
};

const TWITCH_COLOR_TEMPLATE = {
  version: 1,
  defaultTarget: "hue",
  prefixes: {
    hue: "hue",
    wiz: "wiz",
    other: ""
  }
};

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function wipeFolderKeepReadme(folderPath) {
  if (!fs.existsSync(folderPath)) return;
  for (const entry of fs.readdirSync(folderPath, { withFileTypes: true })) {
    const fullPath = path.join(folderPath, entry.name);
    if (entry.name.toLowerCase() === "readme.md") continue;
    fs.rmSync(fullPath, { recursive: true, force: true });
  }
}

function wipeFolder(folderPath) {
  if (!fs.existsSync(folderPath)) return;
  fs.rmSync(folderPath, { recursive: true, force: true });
}

function sanitizeRelease(rootDir = DEFAULT_ROOT) {
  const root = path.resolve(String(rootDir || DEFAULT_ROOT));
  const backupsRoot = path.join(root, "backups");
  const coreBackupsRoot = path.join(root, "core", "backups");
  const runtimeRoot = path.join(root, ".runtime");
  wipeFolderKeepReadme(backupsRoot);
  wipeFolderKeepReadme(coreBackupsRoot);
  wipeFolder(runtimeRoot);

  const fixturesPath = path.join(root, "core", "fixtures.config.json");
  writeJson(fixturesPath, FIXTURES_TEMPLATE);
  const fixturesLocalBackupPath = path.join(root, "core", "fixtures.config.local.backup.json");
  writeJson(fixturesLocalBackupPath, FIXTURES_TEMPLATE);
  const twitchColorConfigPath = path.join(root, "core", "twitch.color.config.json");
  writeJson(twitchColorConfigPath, TWITCH_COLOR_TEMPLATE);

  const cleanFixtureBackup = path.join(
    root,
    "core",
    "backups",
    "fixtures",
    "fixtures.config.clean.json"
  );
  writeJson(cleanFixtureBackup, FIXTURES_TEMPLATE);

  const automationTemplatePath = path.join(root, "core", "automation.config.json");
  if (fs.existsSync(automationTemplatePath)) {
    const automation = JSON.parse(fs.readFileSync(automationTemplatePath, "utf8"));
    const cleanAutomationBackup = path.join(
      root,
      "core",
      "backups",
      "automation",
      "automation.config.clean.json"
    );
    writeJson(cleanAutomationBackup, automation);
  }

  console.log("[sanitize-release] done");
}

if (require.main === module) {
  sanitizeRelease(DEFAULT_ROOT);
}

module.exports = sanitizeRelease;
