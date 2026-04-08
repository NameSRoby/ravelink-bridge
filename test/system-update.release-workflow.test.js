// [TITLE] Test Module: test/system-update.release-workflow.test.js
// [TITLE] Purpose: verify system update release workflow helpers

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");

const createSystemUpdateReleaseWorkflow = require("../src/domains/system/system-update.release-workflow");

function makeWorkflow(overrides = {}) {
  let currentVersion = overrides.currentVersion || "1.6.2-dev";
  let config = overrides.config || {
    updateChecksEnabled: true,
    updateStartupPromptEnabled: true
  };
  return createSystemUpdateReleaseWorkflow({
    now: overrides.now || (() => 1700000000000),
    rootDir: overrides.rootDir || path.join(os.tmpdir(), "ravelink-update-workflow-root"),
    repoOwner: "NameSRoby",
    repoName: "ravelink-bridge",
    releaseApiBase: "https://api.github.com",
    requestTimeoutMs: 1000,
    historyLimit: 8,
    releaseMetadataPublicKeyPem: overrides.releaseMetadataPublicKeyPem || "",
    enforceMetadataSignature: overrides.enforceMetadataSignature === true,
    enforceArchiveDigest: overrides.enforceArchiveDigest === true,
    archiveExtractor: overrides.archiveExtractor || ((_archivePath, extractDir) => {
      fs.mkdirSync(path.join(extractDir, "source", "src", "app"), { recursive: true });
      fs.writeFileSync(path.join(extractDir, "source", "src", "app", "index.js"), "module.exports = 'new';\n", "utf8");
      fs.writeFileSync(path.join(extractDir, "source", "package.json"), "{\"name\":\"ravelink\",\"version\":\"1.6.3\"}", "utf8");
    }),
    httpClient: overrides.httpClient || {
      get: async () => ({
        status: 200,
        data: {
          tag_name: "v1.6.3",
          name: "v1.6.3",
          html_url: "https://github.com/NameSRoby/ravelink-bridge/releases/tag/v1.6.3",
          zipball_url: "https://example.invalid/release.zip",
          prerelease: false,
          draft: false,
          published_at: "2026-03-28T12:00:00.000Z"
        }
      })
    },
    getSystemConfig: overrides.getSystemConfig || (() => config),
    getCurrentVersion: () => currentVersion
  });
}

test("release workflow skips startup check when disabled in config", async () => {
  const workflow = makeWorkflow({
    getSystemConfig: () => ({
      updateChecksEnabled: false,
      updateStartupPromptEnabled: true
    }),
    httpClient: {
      get: async () => {
        throw new Error("should_not_fetch_latest_release");
      }
    }
  });

  const status = await workflow.runStartupCheck();
  assert.equal(status.ok, true);
  assert.equal(status.startup.attempted, true);
  assert.equal(status.lastCheck.ok, true);
  assert.equal(status.lastCheck.detail, "startup_update_check_disabled");
});

test("release workflow manual check reports update available", async () => {
  const workflow = makeWorkflow();

  const status = await workflow.checkForUpdates({ mode: "manual", force: true });
  assert.equal(status.ok, true);
  assert.equal(status.lastCheck.ok, true);
  assert.equal(status.lastCheck.mode, "manual");
  assert.equal(status.lastCheck.updateAvailable, true);
  assert.equal(status.lastCheck.latest.version, "1.6.3");
});

test("release workflow prepares verified source root from downloaded archive", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-update-workflow-"));
  const archiveBytes = Buffer.from("archive-bytes");
  const expectedSha = crypto.createHash("sha256").update(archiveBytes).digest("hex");
  const workflow = makeWorkflow({
    rootDir: tmpRoot,
    httpClient: {
      get: async url => {
        if (String(url).includes("release.zip")) {
          return {
            status: 200,
            data: Readable.from(archiveBytes)
          };
        }
        return {
          status: 200,
          data: {
            tag_name: "v1.6.3",
            name: "v1.6.3",
            html_url: "https://github.com/NameSRoby/ravelink-bridge/releases/tag/v1.6.3",
            zipball_url: "https://example.invalid/release.zip",
            prerelease: false,
            draft: false,
            published_at: "2026-03-28T12:00:00.000Z"
          }
        };
      }
    },
    archiveExtractor: (_archivePath, extractDir) => {
      const sourceRoot = path.join(extractDir, "source");
      fs.mkdirSync(path.join(sourceRoot, "src", "app"), { recursive: true });
      fs.writeFileSync(path.join(sourceRoot, "src", "app", "index.js"), "module.exports = 'new';\n", "utf8");
      fs.writeFileSync(path.join(sourceRoot, "package.json"), "{\"name\":\"ravelink\",\"version\":\"1.6.3\"}", "utf8");
    }
  });

  const prep = await workflow.defaultPrepareReleaseSource({
    stageDir: path.join(tmpRoot, "stage"),
    latest: {
      zipballUrl: "https://example.invalid/release.zip"
    },
    expectedArchiveSha256: expectedSha,
    requiredPostApplyPaths: ["src/app/index.js"]
  });

  assert.equal(prep.archiveDigestVerified, true);
  assert.equal(fs.existsSync(path.join(prep.sourceRoot, "src", "app", "index.js")), true);
});
