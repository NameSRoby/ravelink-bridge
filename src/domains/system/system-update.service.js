// [TITLE] Module: domains/system/system-update.service.js
// [TITLE] Purpose: release-check runtime + non-destructive in-place updater
// [TITLE] Functionality Index:
// [TITLE] - startup/manual GitHub release checks
// [TITLE] - persisted startup/apply status snapshots
// [TITLE] - safe whitelist-based update apply with rollback and install registry

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const axios = require("axios");
const { readJsonFile, writeJsonFile, cloneJsonSafe } = require("../../shared/fs/json-file-store");
const createSystemUpdateReleaseWorkflow = require("./system-update.release-workflow");

const DEFAULT_ALLOWED_UPDATE_PATHS = Object.freeze([
  "src",
  "public",
  "scripts",
  "RELEASE_BUILD.json",
  "package.json",
  "package-lock.json",
  "README.md",
  "LICENSE",
  "RaveLink-Bridge-Start.bat",
  "RaveLink-Bridge-Stop.bat",
  "RaveLink-Bridge-Install-Optional-Audio-Tools.bat"
]);

const DEFAULT_REQUIRED_POST_APPLY_PATHS = Object.freeze([
  "src/app/index.js",
  "src/app/create-server.js",
  "public/templates/index/sections/scripts.html",
  "package.json"
]);

const DEFAULT_RELEASE_API_BASE = "https://api.github.com";
const DEFAULT_RELEASE_CHECK_TIMEOUT_MS = 4500;
const DEFAULT_ARCHIVE_DOWNLOAD_TIMEOUT_MS = 30000;
const DEFAULT_HISTORY_LIMIT = 24;

function asString(value) {
  return String(value || "").trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : fallback;
}

function normalizeRepoToken(value, fallback) {
  const token = asString(value).replace(/[^a-z0-9._-]+/gi, "");
  return token || asString(fallback);
}

function normalizeVersionToken(value) {
  return asString(value).replace(/^v/i, "");
}

function normalizeRel(value) {
  const raw = asString(value).replace(/\\/g, "/").replace(/^\/+/, "");
  if (!raw) return "";
  const out = [];
  for (const piece of raw.split("/")) {
    const token = asString(piece);
    if (!token || token === ".") continue;
    if (token === "..") return "";
    out.push(token);
  }
  return out.join("/");
}

function normalizeRelList(value = []) {
  const rows = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const rel = normalizeRel(row);
    if (!rel) continue;
    const key = rel.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rel);
  }
  return out;
}

function toPath(rootDir, rel) {
  const safe = normalizeRel(rel);
  if (!safe) return "";
  return path.resolve(rootDir, ...safe.split("/"));
}

function isPathInside(rootDir, targetPath) {
  const root = path.resolve(rootDir);
  const target = path.resolve(targetPath);
  if (root.toLowerCase() === target.toLowerCase()) return true;
  const rootPrefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return target.toLowerCase().startsWith(rootPrefix.toLowerCase());
}

function ensureDir(dirPath) {
  fs.mkdirSync(path.resolve(dirPath), { recursive: true });
}

function safeRemove(rootDir, targetPath) {
  const root = path.resolve(rootDir);
  const target = path.resolve(targetPath);
  if (!isPathInside(root, target) || root.toLowerCase() === target.toLowerCase()) {
    throw new Error(`unsafe_remove_target:${target}`);
  }
  fs.rmSync(target, { recursive: true, force: true });
}

function copyPath(sourcePath, targetPath) {
  const source = path.resolve(sourcePath);
  const target = path.resolve(targetPath);
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.cpSync(source, target, { recursive: true, force: true });
    return;
  }
  ensureDir(path.dirname(target));
  fs.copyFileSync(source, target);
}

function cloneMap(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? cloneJsonSafe(value, fallback)
    : cloneJsonSafe(fallback, fallback);
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined) return fallback === true;
  if (typeof value === "string") {
    const token = String(value || "").trim().toLowerCase();
    if (token === "true" || token === "1" || token === "yes" || token === "on") return true;
    if (token === "false" || token === "0" || token === "no" || token === "off") return false;
  }
  return value === true;
}

function parseSemverLike(value) {
  const normalized = normalizeVersionToken(value);
  if (!normalized) return null;
  const [coreRaw, ...preList] = normalized.split("-");
  const [majRaw, minRaw, patchRaw] = String(coreRaw || "").trim().split(".");
  const major = Number(majRaw);
  const minor = Number(minRaw);
  const patch = Number(patchRaw);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch)) return null;
  return { major, minor, patch, pre: preList.join("-").trim().toLowerCase() };
}

function compareVersionTokens(leftValue, rightValue) {
  const left = parseSemverLike(leftValue);
  const right = parseSemverLike(rightValue);
  if (!left || !right) {
    const l = normalizeVersionToken(leftValue).toLowerCase();
    const r = normalizeVersionToken(rightValue).toLowerCase();
    if (l === r) return 0;
    return l < r ? -1 : 1;
  }
  if (left.major !== right.major) return left.major < right.major ? -1 : 1;
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;
  if (!left.pre && !right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  if (left.pre === right.pre) return 0;
  return left.pre < right.pre ? -1 : 1;
}

function readPackageVersion(rootDir, fallback = "") {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.resolve(rootDir, "package.json"), "utf8"));
    return asString(parsed?.version || fallback);
  } catch {
    return asString(fallback);
  }
}

function normalizeReleaseSnapshot(payload = {}) {
  const source = asObject(payload, {});
  const tagName = asString(source.tag_name || source.tagName || source.name);
  const version = normalizeVersionToken(tagName || source.version || source.name);
  const publishedAtRaw = source.published_at || source.publishedAt || 0;
  const publishedAt = Number(new Date(String(publishedAtRaw || "").trim()).getTime() || 0);
  const assets = Array.isArray(source.assets)
    ? source.assets
      .map(item => asObject(item, {}))
      .map(item => ({
        id: Number(item.id || 0) || 0,
        name: asString(item.name || ""),
        contentType: asString(item.content_type || item.contentType || ""),
        apiUrl: asString(item.url || item.apiUrl || ""),
        downloadUrl: asString(item.browser_download_url || item.downloadUrl || ""),
        size: Number(item.size || 0) || 0
      }))
      .filter(item => item.name || item.downloadUrl || item.apiUrl)
    : [];
  return {
    id: Number(source.id || 0) || 0,
    tagName,
    version: version || normalizeVersionToken(tagName),
    name: asString(source.name || tagName),
    releaseUrl: asString(source.html_url || source.releaseUrl),
    apiUrl: asString(source.url || source.apiUrl),
    zipballUrl: asString(source.zipball_url || source.zipballUrl),
    tarballUrl: asString(source.tarball_url || source.tarballUrl),
    prerelease: source.prerelease === true,
    draft: source.draft === true,
    publishedAt: Number.isFinite(publishedAt) ? publishedAt : 0,
    body: asString(source.body || source.notes || "").slice(0, 20_000),
    assets
  };
}

function normalizeInlinePem(text = "") {
  const token = asString(text);
  if (!token) return "";
  return token.replace(/\\n/g, "\n");
}

function loadPublicKeyPem(inputPem = "", pemPath = "") {
  const inlinePem = normalizeInlinePem(inputPem);
  if (inlinePem) return inlinePem;
  const filePath = asString(pemPath);
  if (!filePath) return "";
  try {
    return asString(fs.readFileSync(path.resolve(filePath), "utf8"));
  } catch {
    return "";
  }
}

function normalizeBase64Token(value = "") {
  const token = asString(value).replace(/\s+/g, "");
  if (!token) return "";
  if (!/^[a-z0-9+/=]+$/i.test(token)) return "";
  return token;
}

function normalizeSha256Hex(value = "") {
  const token = asString(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(token)) return "";
  return token;
}

function extractDirectiveFromReleaseBody(bodyText = "", keys = []) {
  const text = String(bodyText || "");
  for (const key of (Array.isArray(keys) ? keys : [])) {
    const token = asString(key);
    if (!token) continue;
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*:\\s*([^\\n\\r]+)`, "i");
    const match = text.match(regex);
    if (!match) continue;
    const value = asString(match[1] || "");
    if (value) return value;
  }
  return "";
}

function buildReleaseSignaturePayload(release = {}) {
  const source = asObject(release, {});
  return JSON.stringify({
    id: Number(source.id || 0) || 0,
    tagName: asString(source.tagName || ""),
    version: asString(source.version || ""),
    name: asString(source.name || ""),
    releaseUrl: asString(source.releaseUrl || ""),
    apiUrl: asString(source.apiUrl || ""),
    zipballUrl: asString(source.zipballUrl || ""),
    tarballUrl: asString(source.tarballUrl || ""),
    prerelease: source.prerelease === true,
    draft: source.draft === true,
    publishedAt: Number(source.publishedAt || 0) || 0
  });
}

function readReleaseIntegrityHints(release = {}) {
  const source = asObject(release, {});
  const body = asString(source.body || "");
  const metadataSignatureRaw = asString(
    source.metadataSignature ||
    source.metadata_signature ||
    extractDirectiveFromReleaseBody(body, RELEASE_BODY_METADATA_SIGNATURE_KEYS)
  );
  const archiveSha256Raw = asString(
    source.archiveSha256 ||
    source.archive_sha256 ||
    extractDirectiveFromReleaseBody(body, RELEASE_BODY_ARCHIVE_SHA256_KEYS)
  );
  return {
    metadataSignature: normalizeBase64Token(metadataSignatureRaw),
    archiveSha256: normalizeSha256Hex(archiveSha256Raw)
  };
}

function verifyReleaseMetadataSignature(release = {}, publicKeyPem = "", signatureB64 = "") {
  const key = asString(publicKeyPem);
  const signatureToken = normalizeBase64Token(signatureB64);
  if (!key || !signatureToken) return false;
  try {
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(buildReleaseSignaturePayload(release));
    verifier.end();
    return verifier.verify(key, Buffer.from(signatureToken, "base64"));
  } catch {
    return false;
  }
}

function computeFileSha256(filePath = "") {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(path.resolve(filePath)));
  return hash.digest("hex").toLowerCase();
}

function equalsSha256Hex(left = "", right = "") {
  const l = normalizeSha256Hex(left);
  const r = normalizeSha256Hex(right);
  if (!l || !r) return false;
  if (l.length !== r.length) return false;
  return crypto.timingSafeEqual(Buffer.from(l, "hex"), Buffer.from(r, "hex"));
}

function ensureTarExtract(archivePath, extractDir) {
  ensureDir(extractDir);
  const result = spawnSync("tar", ["-xf", path.resolve(archivePath), "-C", path.resolve(extractDir)], {
    encoding: "utf8",
    windowsHide: true,
    shell: false
  });
  if (result.status === 0) return;
  const stderr = asString(result.stderr);
  const stdout = asString(result.stdout);
  throw new Error(
    stderr ||
    stdout ||
    `tar_extract_failed_exit_${Number(result.status || -1)}`
  );
}

async function downloadReleaseArchive({ httpClient, url, archivePath, timeoutMs }) {
  const response = await httpClient.get(url, {
    timeout: Math.max(1000, Number(timeoutMs) || DEFAULT_ARCHIVE_DOWNLOAD_TIMEOUT_MS),
    maxRedirects: 5,
    responseType: "stream",
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "ravelink-bridge-updater"
    },
    validateStatus: () => true
  });
  if (!response || Number(response.status || 0) < 200 || Number(response.status || 0) >= 300) {
    throw new Error(`archive_download_http_${Number(response?.status || 0)}`);
  }
  ensureDir(path.dirname(archivePath));
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(archivePath);
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    writer.on("error", finish);
    writer.on("finish", () => finish());
    response.data.on("error", finish);
    response.data.pipe(writer);
  });
}

function resolveExtractedSourceRoot(extractDir, requiredPaths = []) {
  const base = path.resolve(extractDir);
  const entries = fs.existsSync(base)
    ? fs.readdirSync(base, { withFileTypes: true })
    : [];
  const dirs = entries
    .filter(entry => entry && entry.isDirectory())
    .map(entry => path.join(base, entry.name));
  if (dirs.length === 1) return dirs[0];
  if (!requiredPaths.length) return base;
  for (const candidate of dirs) {
    for (const rel of requiredPaths) {
      const testPath = toPath(candidate, rel);
      if (testPath && fs.existsSync(testPath)) return candidate;
    }
  }
  return base;
}

function appendHistory(historyRows = [], entry = {}, limit = DEFAULT_HISTORY_LIMIT) {
  const source = Array.isArray(historyRows) ? historyRows : [];
  const next = [cloneMap(entry, {}), ...source]
    .filter(row => row && typeof row === "object")
    .slice(0, Math.max(1, Number(limit) || DEFAULT_HISTORY_LIMIT));
  return next;
}

module.exports = function createSystemUpdateService(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const log = options.log || console;
  const rootDir = path.resolve(asString(options.rootDir || process.cwd()) || process.cwd());
  const runtimeDir = path.resolve(asString(options.runtimeDir || path.join(rootDir, "runtime")));
  const systemRuntimeDir = path.join(runtimeDir, "system");
  const applyStatePath = path.resolve(
    asString(options.applyStatePath || path.join(systemRuntimeDir, "update-apply-state.json"))
  );
  const installRegistryPath = path.resolve(
    asString(options.installRegistryPath || path.join(systemRuntimeDir, "install-registry.json"))
  );
  const stageRootDir = path.resolve(asString(options.stageRootDir || path.join(systemRuntimeDir, "update-stage")));
  const backupRootDir = path.resolve(asString(options.backupRootDir || path.join(systemRuntimeDir, "update-backups")));

  const getSystemConfig = typeof options.getSystemConfig === "function"
    ? options.getSystemConfig
    : (() => ({}));
  const repoOwner = normalizeRepoToken(options.repoOwner, "NameSRoby");
  const repoName = normalizeRepoToken(options.repoName, "ravelink-bridge");
  const releaseApiBase = asString(options.releaseApiBase || DEFAULT_RELEASE_API_BASE).replace(/\/+$/, "");
  const requestTimeoutMs = Math.max(800, Number(options.requestTimeoutMs) || DEFAULT_RELEASE_CHECK_TIMEOUT_MS);
  const historyLimit = Math.max(1, Number(options.historyLimit) || DEFAULT_HISTORY_LIMIT);
  const allowedUpdatePaths = normalizeRelList(options.allowedUpdatePaths || DEFAULT_ALLOWED_UPDATE_PATHS);
  const requiredPostApplyPaths = normalizeRelList(options.requiredPostApplyPaths || DEFAULT_REQUIRED_POST_APPLY_PATHS);
  const releaseMetadataPublicKeyPem = loadPublicKeyPem(
    options.releaseMetadataPublicKeyPem,
    options.releaseMetadataPublicKeyPath
  );
  const enforceMetadataSignature = normalizeBoolean(options.enforceMetadataSignature, false);
  const enforceArchiveDigest = normalizeBoolean(options.enforceArchiveDigest, false);
  const archiveExtractor = typeof options.archiveExtractor === "function"
    ? options.archiveExtractor
    : ensureTarExtract;
  const prepareReleaseSource = typeof options.prepareReleaseSource === "function"
    ? options.prepareReleaseSource
    : null;
  const httpClient = options.httpClient || axios;

  let currentVersion = normalizeVersionToken(
    options.currentVersion || readPackageVersion(rootDir, "0.0.0")
  ) || "0.0.0";
  const releaseWorkflow = createSystemUpdateReleaseWorkflow({
    now,
    log,
    rootDir,
    repoOwner,
    repoName,
    releaseApiBase,
    requestTimeoutMs,
    historyLimit,
    releaseMetadataPublicKeyPem,
    enforceMetadataSignature,
    enforceArchiveDigest,
    archiveExtractor,
    prepareReleaseSource,
    httpClient,
    getSystemConfig,
    getCurrentVersion: () => currentVersion
  });

  const startup = {
    launchAt: Number(now() || Date.now()),
    attempted: false,
    inFlight: false,
    completedAt: 0
  };

  let lastCheck = {
    ok: false,
    mode: "none",
    checkedAt: 0,
    updateAvailable: false,
    error: "",
    detail: "not_checked",
    latest: {}
  };

  let applyState = {
    inFlight: false,
    lastAttemptAt: 0,
    lastCompletedAt: 0,
    lastError: "",
    lastResult: null
  };

  let installRegistry = {
    activeInstallId: "",
    currentVersion,
    updatedAt: 0,
    history: []
  };

  function loadPersistentState() {
    applyState = {
      ...applyState,
      ...cloneMap(readJsonFile(applyStatePath, applyState), applyState),
      inFlight: false
    };
    installRegistry = {
      ...installRegistry,
      ...cloneMap(readJsonFile(installRegistryPath, installRegistry), installRegistry)
    };
    if (asString(installRegistry.currentVersion)) {
      currentVersion = normalizeVersionToken(installRegistry.currentVersion) || currentVersion;
    }
    installRegistry.currentVersion = currentVersion;
  }

  function persistApplyState() {
    applyState = {
      inFlight: applyState.inFlight === true,
      lastAttemptAt: Number(applyState.lastAttemptAt || 0),
      lastCompletedAt: Number(applyState.lastCompletedAt || 0),
      lastError: asString(applyState.lastError),
      lastResult: applyState.lastResult && typeof applyState.lastResult === "object"
        ? cloneMap(applyState.lastResult, {})
        : null
    };
    writeJsonFile(applyStatePath, applyState);
  }

  function persistInstallRegistry() {
    installRegistry = {
      activeInstallId: asString(installRegistry.activeInstallId),
      currentVersion: normalizeVersionToken(installRegistry.currentVersion || currentVersion) || currentVersion,
      updatedAt: Number(installRegistry.updatedAt || 0),
      history: Array.isArray(installRegistry.history)
        ? installRegistry.history.map(row => cloneMap(row, {}))
        : []
    };
    writeJsonFile(installRegistryPath, installRegistry);
  }

  function readPreferences() {
    const source = asObject(getSystemConfig(), {});
    return {
      updateChecksEnabled: normalizeBoolean(source.updateChecksEnabled, true),
      updateStartupPromptEnabled: normalizeBoolean(source.updateStartupPromptEnabled, true)
    };
  }

  function getStatus() {
    const releaseStatus = releaseWorkflow.getStatus();
    return {
      ...releaseStatus,
      ok: true,
      apply: cloneMap(applyState, {}),
      install: {
        activeInstallId: asString(installRegistry.activeInstallId),
        currentVersion: asString(installRegistry.currentVersion || currentVersion),
        updatedAt: Number(installRegistry.updatedAt || 0),
        historyCount: Array.isArray(installRegistry.history) ? installRegistry.history.length : 0,
        history: Array.isArray(installRegistry.history)
          ? cloneJsonSafe(installRegistry.history.slice(0, 8), [])
          : []
      }
    };
  }

  function attachAndValidateReleaseIntegrity(releaseInput = {}) {
    const release = asObject(releaseInput, {});
    const hints = readReleaseIntegrityHints(release);
    const signaturePresent = Boolean(hints.metadataSignature);
    const digestPresent = Boolean(hints.archiveSha256);
    const signatureVerified = signaturePresent
      ? verifyReleaseMetadataSignature(release, releaseMetadataPublicKeyPem, hints.metadataSignature)
      : false;

    if (enforceMetadataSignature && !releaseMetadataPublicKeyPem) {
      throw new Error("release_metadata_signature_key_missing");
    }
    if (enforceMetadataSignature && !signaturePresent) {
      throw new Error("release_metadata_signature_missing");
    }
    if (signaturePresent && !releaseMetadataPublicKeyPem) {
      throw new Error("release_metadata_signature_key_missing");
    }
    if (signaturePresent && !signatureVerified) {
      throw new Error("release_metadata_signature_invalid");
    }
    if (enforceArchiveDigest && !digestPresent) {
      throw new Error("release_archive_sha256_missing");
    }

    return {
      ...release,
      integrity: {
        metadataSignaturePresent: signaturePresent,
        metadataSignatureVerified: signaturePresent ? signatureVerified : false,
        archiveSha256Present: digestPresent,
        archiveSha256: hints.archiveSha256 || "",
        enforceMetadataSignature,
        enforceArchiveDigest
      }
    };
  }

  async function fetchLatestRelease() {
    const url = `${releaseApiBase}/repos/${repoOwner}/${repoName}/releases/latest`;
    const response = await httpClient.get(url, {
      timeout: requestTimeoutMs,
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "ravelink-bridge-updater"
      },
      validateStatus: () => true
    });
    const status = Number(response?.status || 0);
    if (!response || status < 200 || status >= 300) {
      throw new Error(`release_check_http_${status || 0}`);
    }
    const release = normalizeReleaseSnapshot(response.data || {});
    if (!release.version && !release.tagName) {
      throw new Error("release_check_invalid_payload");
    }
    return attachAndValidateReleaseIntegrity(release);
  }

  function setCheckSnapshot(snapshot = {}) {
    lastCheck = {
      ok: snapshot.ok === true,
      mode: asString(snapshot.mode || "none").toLowerCase() || "none",
      checkedAt: Number(snapshot.checkedAt || now() || Date.now()),
      updateAvailable: snapshot.updateAvailable === true,
      error: asString(snapshot.error),
      detail: asString(snapshot.detail),
      latest: cloneMap(snapshot.latest, {})
    };
  }

  async function checkForUpdates(input = {}) {
    return releaseWorkflow.checkForUpdates(input);
  }

  async function runStartupCheck() {
    return releaseWorkflow.runStartupCheck();
  }

  function chooseArchiveUrl(latest = {}) {
    return releaseWorkflow.chooseArchiveUrl(latest);
  }

  async function defaultPrepareReleaseSource(params = {}) {
    return releaseWorkflow.defaultPrepareReleaseSource({
      ...params,
      requiredPostApplyPaths
    });
  }

  function collectApplyEntries(sourceRoot) {
    const out = [];
    for (const rel of allowedUpdatePaths) {
      const sourcePath = toPath(sourceRoot, rel);
      const targetPath = toPath(rootDir, rel);
      if (!sourcePath || !targetPath) continue;
      if (!isPathInside(sourceRoot, sourcePath) || !isPathInside(rootDir, targetPath)) continue;
      if (!fs.existsSync(sourcePath)) continue;
      out.push({ rel, sourcePath, targetPath });
    }
    return out;
  }

  function verifyPostApplyPaths() {
    for (const rel of requiredPostApplyPaths) {
      const targetPath = toPath(rootDir, rel);
      if (!targetPath || !fs.existsSync(targetPath)) {
        throw new Error(`post_apply_path_missing:${rel}`);
      }
    }
  }

  function rollbackFromBackup(backupDir, touchedRelPaths = []) {
    const restored = [];
    const removed = [];
    const failures = [];
    for (const rel of touchedRelPaths) {
      const targetPath = toPath(rootDir, rel);
      const backupPath = toPath(backupDir, rel);
      if (!targetPath || !backupPath) continue;
      try {
        if (fs.existsSync(backupPath)) {
          if (fs.existsSync(targetPath)) {
            safeRemove(rootDir, targetPath);
          }
          copyPath(backupPath, targetPath);
          restored.push(rel);
        } else if (fs.existsSync(targetPath)) {
          safeRemove(rootDir, targetPath);
          removed.push(rel);
        }
      } catch (error) {
        failures.push({
          rel,
          error: asString(error?.message || error)
        });
      }
    }
    return {
      ok: failures.length === 0,
      restored,
      removed,
      failures
    };
  }

  async function applyLatestUpdate(input = {}) {
    if (applyState.inFlight === true) {
      return {
        ...getStatus(),
        ok: false,
        status: 409,
        error: "update_apply_in_flight",
        detail: "An update apply operation is already in progress."
      };
    }

    const source = asObject(input, {});
    const attemptAt = Number(now() || Date.now());
    const installId = `install_${attemptAt}_${crypto.randomBytes(4).toString("hex")}`;
    const stageDir = path.join(stageRootDir, installId);
    const backupDir = path.join(backupRootDir, installId);
    const touchedRelPaths = [];
    let rollback = null;
    let prepareResult = null;

    applyState.inFlight = true;
    applyState.lastAttemptAt = attemptAt;
    applyState.lastError = "";
    applyState.lastResult = null;
    persistApplyState();

    const fromVersion = currentVersion;
    try {
      const checkResult = await checkForUpdates({
        mode: "manual",
        force: source.forceCheck === true || source.force === true
      });
      if (!checkResult || checkResult.ok !== true) {
        throw new Error(asString(checkResult?.detail || checkResult?.error || "update_check_failed"));
      }
      const statusSnapshot = getStatus();
      if (statusSnapshot.lastCheck.updateAvailable !== true) {
        applyState.inFlight = false;
        applyState.lastCompletedAt = Number(now() || Date.now());
        applyState.lastError = "no_update_available";
        applyState.lastResult = {
          ok: false,
          installId,
          reason: "no_update_available"
        };
        persistApplyState();
        return {
          ...getStatus(),
          ok: false,
          status: 409,
          error: "no_update_available",
          detail: "No newer release available."
        };
      }

      const latest = cloneMap(statusSnapshot.lastCheck.latest, {});
      const expectedArchiveSha256 = normalizeSha256Hex(
        latest?.integrity?.archiveSha256 ||
        latest?.archiveSha256 ||
        latest?.archive_sha256
      );
      ensureDir(stageDir);
      ensureDir(backupDir);
      prepareResult = prepareReleaseSource
        ? await prepareReleaseSource({
          latest,
          stageDir,
          rootDir,
          runtimeDir,
          expectedArchiveSha256,
          requiredPostApplyPaths: cloneJsonSafe(requiredPostApplyPaths, [])
        })
        : await defaultPrepareReleaseSource({
          latest,
          stageDir,
          expectedArchiveSha256,
          timeoutMs: Number(source.archiveTimeoutMs || DEFAULT_ARCHIVE_DOWNLOAD_TIMEOUT_MS)
        });

      let archiveSha256 = normalizeSha256Hex(prepareResult?.archiveSha256 || "");
      let archiveDigestVerified = prepareResult?.archiveDigestVerified === true;
      if (expectedArchiveSha256 && !archiveDigestVerified) {
        if (!archiveSha256 && asString(prepareResult?.archivePath) && fs.existsSync(path.resolve(prepareResult.archivePath))) {
          archiveSha256 = computeFileSha256(path.resolve(prepareResult.archivePath));
        }
        archiveDigestVerified = equalsSha256Hex(archiveSha256, expectedArchiveSha256);
        if (!archiveDigestVerified) {
          throw new Error("release_archive_sha256_mismatch");
        }
      }
      if (enforceArchiveDigest && !archiveDigestVerified) {
        throw new Error("release_archive_sha256_verification_missing");
      }

      const sourceRoot = path.resolve(asString(prepareResult?.sourceRoot || ""));
      if (!sourceRoot || !fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
        throw new Error("prepared_source_root_missing");
      }

      const applyEntries = collectApplyEntries(sourceRoot);
      if (!applyEntries.length) {
        throw new Error("prepared_source_missing_allowed_paths");
      }

      for (const entry of applyEntries) {
        if (fs.existsSync(entry.targetPath)) {
          copyPath(entry.targetPath, toPath(backupDir, entry.rel));
        }
        if (fs.existsSync(entry.targetPath)) {
          safeRemove(rootDir, entry.targetPath);
        }
        copyPath(entry.sourcePath, entry.targetPath);
        touchedRelPaths.push(entry.rel);
      }

      verifyPostApplyPaths();

      const targetVersion = normalizeVersionToken(latest.version || latest.tagName || fromVersion) || fromVersion;
      currentVersion = targetVersion;
      installRegistry.activeInstallId = installId;
      installRegistry.currentVersion = currentVersion;
      installRegistry.updatedAt = Number(now() || Date.now());
      installRegistry.history = appendHistory(installRegistry.history, {
        installId,
        at: installRegistry.updatedAt,
        fromVersion,
        toVersion: currentVersion,
        releaseTag: asString(latest.tagName || ""),
        releaseUrl: asString(latest.releaseUrl || ""),
        archiveUrl: asString(prepareResult?.archiveUrl || chooseArchiveUrl(latest)),
        archiveSha256: archiveSha256 || expectedArchiveSha256 || "",
        archiveDigestVerified: archiveDigestVerified === true,
        metadataSignatureVerified: latest?.integrity?.metadataSignatureVerified === true,
        appliedPaths: cloneJsonSafe(touchedRelPaths, []),
        status: "applied"
      }, historyLimit);
      persistInstallRegistry();

      setCheckSnapshot({
        ...lastCheck,
        ok: true,
        mode: "manual",
        checkedAt: Number(now() || Date.now()),
        updateAvailable: false,
        error: "",
        detail: "updated_to_latest",
        latest
      });

      applyState.inFlight = false;
      applyState.lastCompletedAt = Number(now() || Date.now());
      applyState.lastError = "";
      applyState.lastResult = {
        ok: true,
        installId,
        fromVersion,
        toVersion: currentVersion,
        requiresRestart: true,
        appliedPaths: cloneJsonSafe(touchedRelPaths, []),
        archiveSha256: archiveSha256 || expectedArchiveSha256 || "",
        archiveDigestVerified: archiveDigestVerified === true,
        metadataSignatureVerified: latest?.integrity?.metadataSignatureVerified === true,
        backupDir,
        stageDir
      };
      persistApplyState();

      if (fs.existsSync(stageDir)) {
        safeRemove(stageRootDir, stageDir);
      }

      return {
        ...getStatus(),
        ok: true,
        status: 200,
        applied: cloneMap(applyState.lastResult, {})
      };
    } catch (error) {
      const message = asString(error?.message || error || "system_update_apply_failed");
      if (fs.existsSync(backupDir) && touchedRelPaths.length) {
        rollback = rollbackFromBackup(backupDir, touchedRelPaths);
      }
      applyState.inFlight = false;
      applyState.lastCompletedAt = Number(now() || Date.now());
      applyState.lastError = message;
      applyState.lastResult = {
        ok: false,
        installId,
        fromVersion,
        reason: message,
        touchedPaths: cloneJsonSafe(touchedRelPaths, []),
        rollback: cloneMap(rollback, null),
        stageDir,
        backupDir
      };
      persistApplyState();
      log?.warn?.(`[UPDATE] apply failed: ${message}`);
      return {
        ...getStatus(),
        ok: false,
        status: 500,
        error: "system_update_apply_failed",
        detail: message,
        rollback: cloneMap(rollback, null)
      };
    } finally {
      if (applyState.inFlight) {
        applyState.inFlight = false;
        persistApplyState();
      }
      if (prepareResult?.cleanup && typeof prepareResult.cleanup === "function") {
        try {
          prepareResult.cleanup();
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }

  loadPersistentState();
  persistApplyState();
  persistInstallRegistry();

  return {
    getStatus,
    checkForUpdates,
    runStartupCheck,
    applyLatestUpdate
  };
};

module.exports.compareVersionTokens = compareVersionTokens;
module.exports.buildReleaseSignaturePayload = buildReleaseSignaturePayload;
