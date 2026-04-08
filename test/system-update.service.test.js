// [TITLE] Test Module: test/system-update.service.test.js
// [TITLE] Purpose: verify startup/manual release-check behavior and version comparison

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");

const createSystemUpdateService = require("../src/domains/system/system-update.service");

function signReleaseMetadata(payload, privateKeyPem = "") {
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(createSystemUpdateService.buildReleaseSignaturePayload(payload));
  signer.end();
  return signer.sign(privateKeyPem).toString("base64");
}

test("system update service compares semver-like versions with prerelease ordering", () => {
  assert.equal(createSystemUpdateService.compareVersionTokens("1.6.2-dev", "1.6.2"), -1);
  assert.equal(createSystemUpdateService.compareVersionTokens("1.6.2", "1.6.2"), 0);
  assert.equal(createSystemUpdateService.compareVersionTokens("1.6.3", "1.6.2"), 1);
  assert.equal(createSystemUpdateService.compareVersionTokens("v1.7.0", "1.6.9"), 1);
});

test("system update service skips startup check when disabled in config", async () => {
  const service = createSystemUpdateService({
    currentVersion: "1.6.2-dev",
    getSystemConfig: () => ({
      updateChecksEnabled: false,
      updateStartupPromptEnabled: true
    }),
    httpClient: {
      get: async () => {
        throw new Error("should_not_call_http_when_startup_check_disabled");
      }
    }
  });

  const status = await service.runStartupCheck();
  assert.equal(status.ok, true);
  assert.equal(status.startup.attempted, true);
  assert.equal(status.lastCheck.ok, true);
  assert.equal(status.lastCheck.detail, "startup_update_check_disabled");
});

test("system update service manual check reports update available", async () => {
  const service = createSystemUpdateService({
    currentVersion: "1.6.2-dev",
    repoOwner: "NameSRoby",
    repoName: "ravelink-bridge",
    getSystemConfig: () => ({
      updateChecksEnabled: true,
      updateStartupPromptEnabled: true
    }),
    httpClient: {
      get: async () => ({
        status: 200,
        data: {
          tag_name: "v1.6.3",
          name: "v1.6.3",
          html_url: "https://github.com/NameSRoby/ravelink-bridge/releases/tag/v1.6.3",
          prerelease: false,
          draft: false,
          published_at: "2026-03-28T12:00:00.000Z"
        }
      })
    }
  });

  const status = await service.checkForUpdates({ mode: "manual", force: true });
  assert.equal(status.ok, true);
  assert.equal(status.lastCheck.ok, true);
  assert.equal(status.lastCheck.mode, "manual");
  assert.equal(status.lastCheck.updateAvailable, true);
  assert.equal(status.lastCheck.latest.version, "1.6.3");
});

test("system update service apply returns no_update_available when already up to date", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-update-none-"));
  const service = createSystemUpdateService({
    rootDir: tmpRoot,
    currentVersion: "1.6.3",
    repoOwner: "NameSRoby",
    repoName: "ravelink-bridge",
    getSystemConfig: () => ({
      updateChecksEnabled: true,
      updateStartupPromptEnabled: true
    }),
    httpClient: {
      get: async () => ({
        status: 200,
        data: {
          tag_name: "v1.6.3",
          name: "v1.6.3",
          html_url: "https://github.com/NameSRoby/ravelink-bridge/releases/tag/v1.6.3",
          prerelease: false,
          draft: false
        }
      })
    }
  });

  const result = await service.applyLatestUpdate({ forceCheck: true });
  assert.equal(result.ok, false);
  assert.equal(result.error, "no_update_available");
  assert.equal(result.status, 409);
});

test("system update service apply uses prepared source, updates files, and records install history", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-update-apply-"));
  const runtimeDir = path.join(tmpRoot, "runtime");
  const sourceRoot = path.join(tmpRoot, "source-release");

  fs.mkdirSync(path.join(tmpRoot, "src", "app"), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, "public", "templates", "index", "sections"), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, "src", "app", "index.js"), "module.exports = 'old-index';\n", "utf8");
  fs.writeFileSync(path.join(tmpRoot, "src", "app", "create-server.js"), "module.exports = 'old-server';\n", "utf8");
  fs.writeFileSync(path.join(tmpRoot, "public", "templates", "index", "sections", "scripts.html"), "<!-- old -->\n", "utf8");
  fs.writeFileSync(path.join(tmpRoot, "package.json"), "{\"name\":\"ravelink\",\"version\":\"1.6.2\"}\n", "utf8");

  fs.mkdirSync(path.join(sourceRoot, "src", "app"), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, "public", "templates", "index", "sections"), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "src", "app", "index.js"), "module.exports = 'new-index';\n", "utf8");
  fs.writeFileSync(path.join(sourceRoot, "src", "app", "create-server.js"), "module.exports = 'new-server';\n", "utf8");
  fs.writeFileSync(path.join(sourceRoot, "public", "templates", "index", "sections", "scripts.html"), "<!-- new -->\n", "utf8");
  fs.writeFileSync(path.join(sourceRoot, "package.json"), "{\"name\":\"ravelink\",\"version\":\"1.6.4\"}\n", "utf8");

  const service = createSystemUpdateService({
    rootDir: tmpRoot,
    runtimeDir,
    currentVersion: "1.6.2",
    repoOwner: "NameSRoby",
    repoName: "ravelink-bridge",
    getSystemConfig: () => ({
      updateChecksEnabled: true,
      updateStartupPromptEnabled: true
    }),
    httpClient: {
      get: async () => ({
        status: 200,
        data: {
          tag_name: "v1.6.4",
          name: "v1.6.4",
          html_url: "https://github.com/NameSRoby/ravelink-bridge/releases/tag/v1.6.4",
          zipball_url: "https://example.invalid/release.zip",
          prerelease: false,
          draft: false
        }
      })
    },
    prepareReleaseSource: async () => ({
      sourceRoot
    })
  });

  const result = await service.applyLatestUpdate({ forceCheck: true });
  assert.equal(result.ok, true);
  assert.equal(result.applied?.toVersion, "1.6.4");
  assert.equal(String(fs.readFileSync(path.join(tmpRoot, "src", "app", "index.js"), "utf8")).includes("new-index"), true);

  const registryPath = path.join(runtimeDir, "system", "install-registry.json");
  assert.equal(fs.existsSync(registryPath), true);
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  assert.equal(registry.currentVersion, "1.6.4");
  assert.equal(Array.isArray(registry.history), true);
  assert.equal(registry.history.length > 0, true);
});

test("system update service manual check validates signed release metadata when enforced", async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publishedAt = "2026-03-28T12:00:00.000Z";
  const signedPayload = {
    id: 321,
    tagName: "v1.6.5",
    version: "1.6.5",
    name: "v1.6.5",
    releaseUrl: "https://github.com/NameSRoby/ravelink-bridge/releases/tag/v1.6.5",
    apiUrl: "https://api.github.com/repos/NameSRoby/ravelink-bridge/releases/321",
    zipballUrl: "https://example.invalid/release.zip",
    tarballUrl: "",
    prerelease: false,
    draft: false,
    publishedAt: Number(new Date(publishedAt).getTime())
  };
  const signature = signReleaseMetadata(signedPayload, privateKeyPem);

  const service = createSystemUpdateService({
    currentVersion: "1.6.2",
    repoOwner: "NameSRoby",
    repoName: "ravelink-bridge",
    releaseMetadataPublicKeyPem: publicKeyPem,
    enforceMetadataSignature: true,
    getSystemConfig: () => ({
      updateChecksEnabled: true,
      updateStartupPromptEnabled: true
    }),
    httpClient: {
      get: async () => ({
        status: 200,
        data: {
          id: 321,
          tag_name: "v1.6.5",
          name: "v1.6.5",
          html_url: signedPayload.releaseUrl,
          url: signedPayload.apiUrl,
          zipball_url: signedPayload.zipballUrl,
          prerelease: false,
          draft: false,
          published_at: publishedAt,
          body: `ravelink-metadata-signature: ${signature}`
        }
      })
    }
  });

  const status = await service.checkForUpdates({ mode: "manual", force: true });
  assert.equal(status.ok, true);
  assert.equal(status.lastCheck.ok, true);
  assert.equal(status.lastCheck.latest?.integrity?.metadataSignatureVerified, true);
});

test("system update service manual check fails on invalid metadata signature in enforce mode", async () => {
  const { publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const service = createSystemUpdateService({
    currentVersion: "1.6.2",
    repoOwner: "NameSRoby",
    repoName: "ravelink-bridge",
    releaseMetadataPublicKeyPem: publicKeyPem,
    enforceMetadataSignature: true,
    getSystemConfig: () => ({
      updateChecksEnabled: true,
      updateStartupPromptEnabled: true
    }),
    httpClient: {
      get: async () => ({
        status: 200,
        data: {
          id: 322,
          tag_name: "v1.6.5",
          name: "v1.6.5",
          html_url: "https://github.com/NameSRoby/ravelink-bridge/releases/tag/v1.6.5",
          url: "https://api.github.com/repos/NameSRoby/ravelink-bridge/releases/322",
          zipball_url: "https://example.invalid/release.zip",
          prerelease: false,
          draft: false,
          published_at: "2026-03-28T12:00:00.000Z",
          body: "ravelink-metadata-signature: d3JvbmdzaWduYXR1cmU="
        }
      })
    }
  });

  const status = await service.checkForUpdates({ mode: "manual", force: true });
  assert.equal(status.ok, false);
  assert.equal(status.error, "system_update_check_failed");
  assert.equal(String(status.detail || "").includes("release_metadata_signature_invalid"), true);
});

test("system update service apply rejects archive digest mismatch when digest enforcement is enabled", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-update-digest-mismatch-"));
  const runtimeDir = path.join(tmpRoot, "runtime");
  fs.mkdirSync(path.join(tmpRoot, "src", "app"), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, "public", "templates", "index", "sections"), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, "src", "app", "index.js"), "module.exports = 'old-index';\n", "utf8");
  fs.writeFileSync(path.join(tmpRoot, "src", "app", "create-server.js"), "module.exports = 'old-server';\n", "utf8");
  fs.writeFileSync(path.join(tmpRoot, "public", "templates", "index", "sections", "scripts.html"), "<!-- old -->\n", "utf8");
  fs.writeFileSync(path.join(tmpRoot, "package.json"), "{\"name\":\"ravelink\",\"version\":\"1.6.2\"}\n", "utf8");

  const archiveBytes = Buffer.from("not-a-real-zip", "utf8");
  const wrongDigest = "a".repeat(64);
  const httpClient = {
    get: async (url, config = {}) => {
      if (String(url).includes("/releases/latest")) {
        return {
          status: 200,
          data: {
            id: 500,
            tag_name: "v1.6.4",
            name: "v1.6.4",
            html_url: "https://github.com/NameSRoby/ravelink-bridge/releases/tag/v1.6.4",
            url: "https://api.github.com/repos/NameSRoby/ravelink-bridge/releases/500",
            zipball_url: "https://example.invalid/release.zip",
            prerelease: false,
            draft: false,
            published_at: "2026-03-28T12:00:00.000Z",
            body: `ravelink-archive-sha256: ${wrongDigest}`
          }
        };
      }
      if (String(url).includes("release.zip")) {
        return {
          status: 200,
          data: Readable.from(archiveBytes),
          headers: {}
        };
      }
      return {
        status: 404,
        data: {}
      };
    }
  };

  const service = createSystemUpdateService({
    rootDir: tmpRoot,
    runtimeDir,
    currentVersion: "1.6.2",
    repoOwner: "NameSRoby",
    repoName: "ravelink-bridge",
    enforceArchiveDigest: true,
    getSystemConfig: () => ({
      updateChecksEnabled: true,
      updateStartupPromptEnabled: true
    }),
    httpClient,
    archiveExtractor: (_archivePath, extractDir) => {
      const sourceRoot = path.join(extractDir, "source");
      fs.mkdirSync(path.join(sourceRoot, "src", "app"), { recursive: true });
      fs.mkdirSync(path.join(sourceRoot, "public", "templates", "index", "sections"), { recursive: true });
      fs.writeFileSync(path.join(sourceRoot, "src", "app", "index.js"), "module.exports = 'new-index';\n", "utf8");
      fs.writeFileSync(path.join(sourceRoot, "src", "app", "create-server.js"), "module.exports = 'new-server';\n", "utf8");
      fs.writeFileSync(path.join(sourceRoot, "public", "templates", "index", "sections", "scripts.html"), "<!-- new -->\n", "utf8");
      fs.writeFileSync(path.join(sourceRoot, "package.json"), "{\"name\":\"ravelink\",\"version\":\"1.6.4\"}\n", "utf8");
    }
  });

  const result = await service.applyLatestUpdate({ forceCheck: true });
  assert.equal(result.ok, false);
  assert.equal(result.error, "system_update_apply_failed");
  assert.equal(String(result.detail || "").includes("release_archive_sha256_mismatch"), true);
});
