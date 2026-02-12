const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "automation.config.json");
const BACKUP_DIR = path.join(__dirname, "backups", "automation");
const MAX_BACKUPS = 30;

const DEFAULT_CONFIG = {
  enabled: true,
  targetZone: "all",
  transitionMs: 400,
  start: {
    enabled: true,
    brightnessPercent: 80,
    delayMs: 0
  },
  stop: {
    enabled: true,
    brightnessPercent: 100,
    delayMs: 0
  }
};

const runtime = {
  config: { ...DEFAULT_CONFIG },
  version: 0,
  loadedAt: 0,
  lastBackupPath: null
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeZone(value) {
  const zone = String(value || "all").trim();
  return zone || "all";
}

function sanitizeEventConfig(input, fallback) {
  const raw = input && typeof input === "object" ? input : {};
  return {
    enabled: raw.enabled !== false,
    brightnessPercent: clamp(
      Math.round(Number(raw.brightnessPercent ?? fallback.brightnessPercent) || fallback.brightnessPercent),
      1,
      100
    ),
    delayMs: clamp(
      Math.round(Number(raw.delayMs ?? fallback.delayMs) || fallback.delayMs),
      0,
      60000
    )
  };
}

function sanitizeConfig(input) {
  const raw = input && typeof input === "object" ? input : {};
  return {
    enabled: raw.enabled !== false,
    targetZone: normalizeZone(raw.targetZone),
    transitionMs: clamp(
      Math.round(Number(raw.transitionMs ?? DEFAULT_CONFIG.transitionMs) || DEFAULT_CONFIG.transitionMs),
      0,
      10000
    ),
    start: sanitizeEventConfig(raw.start, DEFAULT_CONFIG.start),
    stop: sanitizeEventConfig(raw.stop, DEFAULT_CONFIG.stop)
  };
}

function loadConfigFile() {
  const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  return sanitizeConfig(parsed);
}

function applyConfig(config) {
  runtime.config = sanitizeConfig(config);
  runtime.version += 1;
  runtime.loadedAt = Date.now();
}

function pruneBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return;
  const entries = fs
    .readdirSync(BACKUP_DIR, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(".json"))
    .map(entry => {
      const filePath = path.join(BACKUP_DIR, entry.name);
      const stat = fs.statSync(filePath);
      return { filePath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (let i = MAX_BACKUPS; i < entries.length; i += 1) {
    try {
      fs.unlinkSync(entries[i].filePath);
    } catch {}
  }
}

function backupCurrentConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return null;

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupPath = path.join(BACKUP_DIR, `automation.config.${Date.now()}.json`);
  fs.copyFileSync(CONFIG_PATH, backupPath);
  pruneBackups();
  runtime.lastBackupPath = backupPath;
  return backupPath;
}

function persistConfig(config) {
  const safe = sanitizeConfig(config);
  backupCurrentConfig();
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(safe, null, 2)}\n`, "utf8");
  applyConfig(safe);
}

function getConfig() {
  return JSON.parse(JSON.stringify(runtime.config));
}

function getMeta() {
  return {
    version: runtime.version,
    loadedAt: runtime.loadedAt,
    configPath: CONFIG_PATH,
    backupDir: BACKUP_DIR,
    lastBackupPath: runtime.lastBackupPath
  };
}

function reload() {
  try {
    const loaded = loadConfigFile();
    applyConfig(loaded);
    console.log(`[AUTOMATION] reloaded (v${runtime.version})`);
    return true;
  } catch (err) {
    console.warn(`[AUTOMATION] reload failed (${err.message}); keeping previous config`);
    return false;
  }
}

function setConfig(patch = {}) {
  const current = getConfig();
  const next = {
    ...current,
    ...(patch && typeof patch === "object" ? patch : {}),
    start: {
      ...current.start,
      ...(patch && patch.start && typeof patch.start === "object" ? patch.start : {})
    },
    stop: {
      ...current.stop,
      ...(patch && patch.stop && typeof patch.stop === "object" ? patch.stop : {})
    }
  };

  persistConfig(next);
  return {
    ok: true,
    config: getConfig(),
    meta: getMeta()
  };
}

function init() {
  try {
    applyConfig(loadConfigFile());
    console.log(`[AUTOMATION] loaded from ${path.basename(CONFIG_PATH)} (v${runtime.version})`);
  } catch (err) {
    console.warn(`[AUTOMATION] using defaults (${err.message})`);
    applyConfig(DEFAULT_CONFIG);
  }

  fs.watchFile(CONFIG_PATH, { interval: 800 }, (curr, prev) => {
    if (curr.mtimeMs === prev.mtimeMs) return;
    reload();
  });
}

init();

module.exports = {
  getConfig,
  getMeta,
  setConfig,
  reload
};
