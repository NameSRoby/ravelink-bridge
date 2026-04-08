// [TITLE] Module: domains/system/system-update.release-workflow.js
// [TITLE] Purpose: release-check and release-preparation workflow for system updates
// [TITLE] Functionality Index:
// [TITLE] - normalize GitHub release snapshots and integrity hints
// [TITLE] - run startup/manual update checks with persisted snapshot state
// [TITLE] - prepare verified release source archives for apply orchestration

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const DEFAULT_RELEASE_API_BASE = "https://api.github.com";
const DEFAULT_RELEASE_CHECK_TIMEOUT_MS = 4500;
const DEFAULT_ARCHIVE_DOWNLOAD_TIMEOUT_MS = 30000;
const DEFAULT_HISTORY_LIMIT = 24;
const RELEASE_BODY_METADATA_SIGNATURE_KEYS = Object.freeze([
  "ravelink-metadata-signature",
  "metadata-signature"
]);
const RELEASE_BODY_ARCHIVE_SHA256_KEYS = Object.freeze([
  "ravelink-archive-sha256",
  "archive-sha256",
  "archive_sha256"
]);

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

function ensureDir(dirPath) {
  fs.mkdirSync(path.resolve(dirPath), { recursive: true });
}

function cloneMap(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? JSON.parse(JSON.stringify(value))
    : JSON.parse(JSON.stringify(fallback));
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

function createSystemUpdateReleaseWorkflow(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const log = options.log || console;
  const rootDir = path.resolve(asString(options.rootDir || process.cwd()) || process.cwd());
  const releaseApiBase = asString(options.releaseApiBase || DEFAULT_RELEASE_API_BASE).replace(/\/+$/, "");
  const requestTimeoutMs = Math.max(800, Number(options.requestTimeoutMs) || DEFAULT_RELEASE_CHECK_TIMEOUT_MS);
  const historyLimit = Math.max(1, Number(options.historyLimit) || DEFAULT_HISTORY_LIMIT);
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
  const httpClient = options.httpClient || require("axios");
  const getSystemConfig = typeof options.getSystemConfig === "function"
    ? options.getSystemConfig
    : (() => ({}));
  const getCurrentVersion = typeof options.getCurrentVersion === "function"
    ? options.getCurrentVersion
    : (() => normalizeVersionToken(options.currentVersion || readPackageVersion(rootDir, "0.0.0")) || "0.0.0");

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

  function getPreferences() {
    const source = asObject(getSystemConfig(), {});
    return {
      updateChecksEnabled: normalizeBoolean(source.updateChecksEnabled, true),
      updateStartupPromptEnabled: normalizeBoolean(source.updateStartupPromptEnabled, true)
    };
  }

  function getStatus() {
    return {
      ok: true,
      repoOwner: normalizeRepoToken(options.repoOwner, "NameSRoby"),
      repoName: normalizeRepoToken(options.repoName, "ravelink-bridge"),
      currentVersion: getCurrentVersion(),
      preferences: getPreferences(),
      startup: cloneMap(startup, {}),
      lastCheck: cloneMap(lastCheck, {})
    };
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
    const repoOwner = normalizeRepoToken(options.repoOwner, "NameSRoby");
    const repoName = normalizeRepoToken(options.repoName, "ravelink-bridge");
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

  async function checkForUpdates(input = {}) {
    const source = asObject(input, {});
    const mode = asString(source.mode || "manual").toLowerCase() === "startup" ? "startup" : "manual";
    const force = source.force === true;
    const timestamp = Number(now() || Date.now());
    const preferences = getPreferences();

    if (mode === "startup") {
      startup.attempted = true;
      startup.inFlight = true;
    }

    if (mode === "startup" && preferences.updateChecksEnabled !== true) {
      setCheckSnapshot({
        ok: true,
        mode,
        checkedAt: timestamp,
        updateAvailable: false,
        error: "",
        detail: "startup_update_check_disabled",
        latest: {}
      });
      startup.inFlight = false;
      startup.completedAt = timestamp;
      return getStatus();
    }

    if (
      mode === "startup" &&
      !force &&
      Number(lastCheck.checkedAt || 0) > 0 &&
      asString(lastCheck.mode).toLowerCase() === "startup"
    ) {
      startup.inFlight = false;
      startup.completedAt = timestamp;
      return getStatus();
    }

    try {
      const release = await fetchLatestRelease();
      const latestVersion = release.version || normalizeVersionToken(release.tagName);
      const updateAvailable = release.draft === true
        ? false
        : compareVersionTokens(latestVersion, getCurrentVersion()) > 0;
      setCheckSnapshot({
        ok: true,
        mode,
        checkedAt: timestamp,
        updateAvailable,
        error: "",
        detail: updateAvailable ? "update_available" : "up_to_date",
        latest: release
      });
      if (mode === "startup") {
        startup.completedAt = timestamp;
      }
      return getStatus();
    } catch (error) {
      const message = asString(error?.message || error || "update_check_failed");
      setCheckSnapshot({
        ok: false,
        mode,
        checkedAt: timestamp,
        updateAvailable: false,
        error: "update_check_failed",
        detail: message,
        latest: {}
      });
      if (mode === "startup") {
        startup.completedAt = timestamp;
        return getStatus();
      }
      return {
        ...getStatus(),
        ok: false,
        status: 502,
        error: "system_update_check_failed",
        detail: message
      };
    } finally {
      if (mode === "startup") {
        startup.inFlight = false;
      }
    }
  }

  async function runStartupCheck() {
    if (startup.inFlight === true) return getStatus();
    if (startup.attempted === true && Number(startup.completedAt || 0) > 0) return getStatus();
    const result = await checkForUpdates({ mode: "startup", force: false });
    if (!result || result.ok !== true) {
      return getStatus();
    }
    return result;
  }

  function chooseArchiveUrl(latest = {}) {
    const source = asObject(latest, {});
    return (
      asString(source.zipballUrl) ||
      asString(source.zipball_url) ||
      asString(source.tarballUrl) ||
      asString(source.tarball_url) ||
      ""
    );
  }

  async function defaultPrepareReleaseSource(params = {}) {
    const stageDir = path.resolve(asString(params.stageDir || ""));
    const latest = asObject(params.latest, {});
    const archiveUrl = chooseArchiveUrl(latest);
    if (!archiveUrl) {
      throw new Error("release_archive_url_missing");
    }
    ensureDir(stageDir);
    const useTarball = archiveUrl.toLowerCase().includes("tarball");
    const archivePath = path.join(stageDir, useTarball ? "release.tar.gz" : "release.zip");
    await downloadReleaseArchive({
      httpClient,
      url: archiveUrl,
      archivePath,
      timeoutMs: Number(params.timeoutMs || DEFAULT_ARCHIVE_DOWNLOAD_TIMEOUT_MS)
    });
    const expectedArchiveSha256 = normalizeSha256Hex(
      params.expectedArchiveSha256 ||
      latest?.integrity?.archiveSha256 ||
      latest?.archiveSha256 ||
      latest?.archive_sha256
    );
    const archiveSha256 = computeFileSha256(archivePath);
    if (expectedArchiveSha256 && !equalsSha256Hex(archiveSha256, expectedArchiveSha256)) {
      throw new Error("release_archive_sha256_mismatch");
    }
    if (enforceArchiveDigest && !expectedArchiveSha256) {
      throw new Error("release_archive_sha256_missing");
    }
    const extractDir = path.join(stageDir, "extract");
    archiveExtractor(archivePath, extractDir);
    const sourceRoot = path.resolve(
      asString(params.sourceRoot || resolveExtractedSourceRoot(extractDir, params.requiredPostApplyPaths || []))
    );
    if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
      throw new Error("release_archive_extract_missing_source_root");
    }
    return {
      sourceRoot,
      archiveUrl,
      archivePath,
      extractDir,
      archiveSha256,
      expectedArchiveSha256,
      archiveDigestVerified: Boolean(expectedArchiveSha256)
    };
  }

  return {
    getStatus,
    checkForUpdates,
    runStartupCheck,
    chooseArchiveUrl,
    defaultPrepareReleaseSource,
    attachAndValidateReleaseIntegrity,
    normalizeReleaseSnapshot,
    readReleaseIntegrityHints,
    verifyReleaseMetadataSignature,
    buildReleaseSignaturePayload
  };
}

module.exports = createSystemUpdateReleaseWorkflow;
module.exports.compareVersionTokens = compareVersionTokens;
module.exports.buildReleaseSignaturePayload = buildReleaseSignaturePayload;
