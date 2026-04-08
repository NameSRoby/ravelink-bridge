// [TITLE] Module: shared/fs/json-file-store.js
// [TITLE] Purpose: safe JSON disk IO helpers
// [TITLE] Functionality Index:
// [TITLE] - clone JSON-safe values
// [TITLE] - read JSON with deterministic fallback handling
// [TITLE] - write JSON with directory creation and canonical formatting

const fs = require("fs");
const path = require("path");

function cloneJsonSafe(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function readJsonFile(filePath, fallback = {}) {
  // [DEV] Any parse/read failure returns fallback clone to avoid partial-state crashes.
  try {
    const raw = fs.readFileSync(String(filePath || ""), "utf8");
    return JSON.parse(raw);
  } catch {
    return cloneJsonSafe(fallback, fallback);
  }
}

function writeJsonFile(filePath, value) {
  // [DEV] Write path is guarded so callers cannot silently write to empty path tokens.
  const target = String(filePath || "").trim();
  if (!target) {
    throw new Error("writeJsonFile requires a valid file path");
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return value;
}

module.exports = {
  cloneJsonSafe,
  readJsonFile,
  writeJsonFile
};
