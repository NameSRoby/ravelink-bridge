const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildActivateUrl,
  buildHelixReadiness,
  buildProfilePresence,
  buildPublicDeviceFlowSnapshot,
  hasAnyProfileValue,
  mergeProfileWithDefaults,
  normalizeProfileShape,
  readVaultFromDisk,
  writeVaultToDisk
} = require("../src/domains/system/system-oauth.vault");

test("oauth vault helper normalizes legacy profile fields and defaults", () => {
  const merged = mergeProfileWithDefaults(
    {
      twitchClientId: "default-client",
      twitchBroadcasterId: "default-broadcaster",
      twitchRefreshToken: "default-refresh"
    },
    {
      clientId: "loaded-client",
      userAccessToken: "loaded-token"
    }
  );

  assert.deepEqual(merged, {
    twitchClientId: "loaded-client",
    twitchBroadcasterId: "default-broadcaster",
    twitchUserAccessToken: "loaded-token",
    twitchRefreshToken: "default-refresh",
    tokenExpiresAt: 0
  });

  const normalized = normalizeProfileShape({
    broadcasterId: "b-123",
    refreshToken: "r-456",
    tokenExpiresAt: "1234"
  });
  assert.equal(normalized.twitchBroadcasterId, "b-123");
  assert.equal(normalized.twitchRefreshToken, "r-456");
  assert.equal(normalized.tokenExpiresAt, 1234);
});

test("oauth vault helper reports Helix readiness and profile presence correctly", () => {
  const snapshot = normalizeProfileShape({
    twitchClientId: "client-a",
    twitchBroadcasterId: "12345",
    twitchUserAccessToken: "token-a",
    twitchRefreshToken: "refresh-a",
    tokenExpiresAt: Date.now() + 60_000
  });

  assert.equal(hasAnyProfileValue(snapshot), true);
  assert.deepEqual(buildProfilePresence(snapshot), {
    twitchClientId: true,
    twitchBroadcasterId: true,
    twitchUserAccessToken: true,
    twitchRefreshToken: true
  });
  assert.equal(buildHelixReadiness(snapshot, Date.now()).ready, true);
  assert.equal(buildHelixReadiness({}, Date.now()).reason, "missing_client_id_broadcaster_id_user_access_token");

  const expired = buildHelixReadiness({
    twitchClientId: "client-a",
    twitchBroadcasterId: "12345",
    twitchUserAccessToken: "token-a",
    tokenExpiresAt: Date.now() - 5_000
  }, Date.now());
  assert.equal(expired.ready, false);
  assert.equal(expired.reason, "token_expired_refresh_missing");
});

test("oauth vault helper shapes device flow snapshots and activation URLs", () => {
  const snapshot = buildPublicDeviceFlowSnapshot({
    status: "PENDING",
    requestedBy: "system",
    startedAt: 10,
    expiresAt: 20,
    intervalSec: 1,
    nextPollAt: 30,
    lastPolledAt: 40,
    userCode: "ABCD-EFGH",
    verificationUri: "https://www.twitch.tv/activate",
    verificationUriComplete: "https://www.twitch.tv/activate?foo=bar",
    pollAttempts: 2,
    lastError: "slow_down",
    completedAt: 50
  });

  assert.equal(snapshot.status, "pending");
  assert.equal(snapshot.intervalSec, 2);
  assert.equal(snapshot.userCode, "ABCD-EFGH");
  assert.equal(snapshot.lastError, "slow_down");
  assert.equal(buildActivateUrl(snapshot.verificationUriComplete, snapshot.verificationUri, snapshot.userCode).includes("device-code=ABCD-EFGH"), true);
});

test("oauth vault helper reads missing vaults and clears empty state", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-oauth-vault-"));
  const vaultPath = path.join(tmpRoot, "oauth.vault.json");

  const missing = readVaultFromDisk(vaultPath);
  assert.equal(missing.ok, true);
  assert.equal(missing.exists, false);

  fs.writeFileSync(vaultPath, "placeholder", "utf8");
  const cleared = writeVaultToDisk({}, vaultPath);
  assert.equal(cleared.ok, true);
  assert.equal(cleared.cleared, true);
  assert.equal(fs.existsSync(vaultPath), false);
});

test("oauth vault helper roundtrips encrypted data on Windows", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-oauth-vault-roundtrip-"));
  const vaultPath = path.join(tmpRoot, "oauth.vault.json");
  const profile = {
    twitchClientId: "client-a",
    twitchBroadcasterId: "12345",
    twitchUserAccessToken: "token-a",
    twitchRefreshToken: "refresh-a",
    tokenExpiresAt: Date.now() + 3_600_000
  };

  const written = writeVaultToDisk(profile, vaultPath);
  if (process.platform !== "win32") {
    assert.equal(written.ok, true);
    assert.equal(written.volatileOnly, true);
    assert.equal(written.provider, "volatile_only");
    assert.equal(fs.existsSync(vaultPath), false);
    return;
  }

  assert.equal(written.ok, true);
  assert.equal(fs.existsSync(vaultPath), true);
  const readBack = readVaultFromDisk(vaultPath);
  assert.equal(readBack.ok, true);
  assert.equal(readBack.exists, true);
  assert.equal(readBack.profile.twitchClientId, "client-a");
  assert.equal(readBack.profile.twitchBroadcasterId, "12345");
  assert.equal(readBack.profile.twitchUserAccessToken, "token-a");
  assert.equal(readBack.profile.twitchRefreshToken, "refresh-a");
});
