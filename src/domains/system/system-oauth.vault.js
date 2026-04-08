// [TITLE] Module: domains/system/system-oauth.vault.js
// [TITLE] Purpose: OAuth vault persistence plus profile/device-flow snapshot helpers
// [TITLE] Functionality Index:
// [TITLE] - normalize OAuth profile shapes and Helix readiness snapshots
// [TITLE] - persist DPAPI-backed OAuth vault state on Windows
// [TITLE] - shape public device-flow snapshots and activation URLs

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const OAUTH_VAULT_VERSION = 1;
const OAUTH_REFRESH_SKEW_MS = 90_000;
const OAUTH_VAULT_FIELD_MAP = Object.freeze({
  clientId: "twitchClientId",
  broadcasterId: "twitchBroadcasterId",
  userAccessToken: "twitchUserAccessToken",
  refreshToken: "twitchRefreshToken"
});

function asString(value) {
  return String(value ?? "").trim();
}

function clampInt(value, min, max, fallback = 0) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return Math.round(Number(fallback) || 0);
  return Math.min(Math.round(Number(max) || parsed), Math.max(Math.round(Number(min) || parsed), parsed));
}

function ensureDirectoryForFile(filePath = "") {
  const target = asString(filePath);
  if (!target) return;
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
}

function runPowerShellJson(script = "", timeoutMs = 8_000) {
  const command = asString(script);
  if (!command) return { ok: false, error: "powershell_script_missing" };
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8",
    timeout: Math.max(500, Number(timeoutMs) || 8_000),
    windowsHide: true
  });
  if (result.error) {
    return {
      ok: false,
      error: asString(result.error?.message || result.error)
    };
  }
  if (Number(result.status) !== 0) {
    return {
      ok: false,
      error: asString(result.stderr || result.stdout || `powershell_exit_${result.status}`)
    };
  }
  try {
    const parsed = JSON.parse(asString(result.stdout || "{}") || "{}");
    return { ok: true, data: parsed };
  } catch {
    return {
      ok: false,
      error: "powershell_json_parse_failed"
    };
  }
}

function protectTextWithWindowsDpapi(text = "") {
  const plain = asString(text);
  if (!plain) return { ok: true, cipherB64: "" };
  if (process.platform !== "win32") {
    return {
      ok: false,
      error: "windows_dpapi_unavailable"
    };
  }
  const plainB64 = Buffer.from(plain, "utf8").toString("base64");
  const script = `
$ErrorActionPreference = 'Stop'
$plain = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${plainB64}'))
$secure = ConvertTo-SecureString -String $plain -AsPlainText -Force
$cipher = ConvertFrom-SecureString -SecureString $secure
$payload = @{
  ok = $true
  cipherB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($cipher))
}
$payload | ConvertTo-Json -Compress
`;
  const result = runPowerShellJson(script, 8_000);
  if (!result.ok) {
    return {
      ok: false,
      error: asString(result.error || "dpapi_encrypt_failed")
    };
  }
  const cipherB64 = asString(result.data?.cipherB64 || "");
  if (!cipherB64) {
    return {
      ok: false,
      error: "dpapi_encrypt_empty_cipher"
    };
  }
  return {
    ok: true,
    cipherB64
  };
}

function unprotectTextWithWindowsDpapi(cipherB64 = "") {
  const encoded = asString(cipherB64);
  if (!encoded) return { ok: true, plain: "" };
  if (process.platform !== "win32") {
    return {
      ok: false,
      error: "windows_dpapi_unavailable"
    };
  }
  const script = `
$ErrorActionPreference = 'Stop'
$cipher = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))
$secure = ConvertTo-SecureString -String $cipher
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
$payload = @{
  ok = $true
  plainB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($plain))
}
$payload | ConvertTo-Json -Compress
`;
  const result = runPowerShellJson(script, 8_000);
  if (!result.ok) {
    return {
      ok: false,
      error: asString(result.error || "dpapi_decrypt_failed")
    };
  }
  const plainB64 = asString(result.data?.plainB64 || "");
  if (!plainB64) {
    return { ok: true, plain: "" };
  }
  try {
    return {
      ok: true,
      plain: Buffer.from(plainB64, "base64").toString("utf8")
    };
  } catch (error) {
    return {
      ok: false,
      error: asString(error?.message || "dpapi_decrypt_decode_failed")
    };
  }
}

function normalizeProfileShape(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return {
    twitchClientId: asString(source.twitchClientId || source.clientId || ""),
    twitchBroadcasterId: asString(source.twitchBroadcasterId || source.broadcasterId || ""),
    twitchUserAccessToken: asString(source.twitchUserAccessToken || source.userAccessToken || ""),
    twitchRefreshToken: asString(source.twitchRefreshToken || source.refreshToken || ""),
    tokenExpiresAt: clampInt(source.tokenExpiresAt, 0, 4_102_444_800_000, 0)
  };
}

function mergeProfileWithDefaults(defaults = {}, loaded = {}) {
  const base = normalizeProfileShape(defaults);
  const source = normalizeProfileShape(loaded);
  return normalizeProfileShape({
    twitchClientId: asString(source.twitchClientId || base.twitchClientId || ""),
    twitchBroadcasterId: asString(source.twitchBroadcasterId || base.twitchBroadcasterId || ""),
    twitchUserAccessToken: asString(source.twitchUserAccessToken || base.twitchUserAccessToken || ""),
    twitchRefreshToken: asString(source.twitchRefreshToken || base.twitchRefreshToken || ""),
    tokenExpiresAt: Math.max(0, Number(source.tokenExpiresAt || base.tokenExpiresAt || 0))
  });
}

function buildProfilePresence(profile = {}) {
  const normalized = normalizeProfileShape(profile);
  return {
    twitchClientId: Boolean(normalized.twitchClientId),
    twitchBroadcasterId: Boolean(normalized.twitchBroadcasterId),
    twitchUserAccessToken: Boolean(normalized.twitchUserAccessToken),
    twitchRefreshToken: Boolean(normalized.twitchRefreshToken)
  };
}

function hasAnyProfileValue(profile = {}) {
  const presence = buildProfilePresence(profile);
  return Boolean(
    presence.twitchClientId ||
    presence.twitchBroadcasterId ||
    presence.twitchUserAccessToken ||
    presence.twitchRefreshToken ||
    Math.max(0, Number(profile.tokenExpiresAt || 0)) > 0
  );
}

function buildHelixReadiness(profile = {}, nowMs = Date.now()) {
  const snapshot = normalizeProfileShape(profile);
  const presence = buildProfilePresence(snapshot);
  const tokenExpiresAt = Math.max(0, Number(snapshot.tokenExpiresAt || 0));
  const tokenExpired = tokenExpiresAt > 0 && tokenExpiresAt <= nowMs;
  const tokenExpiringSoon = tokenExpiresAt > 0 && (tokenExpiresAt - nowMs) < OAUTH_REFRESH_SKEW_MS;
  const canRefresh = presence.twitchClientId && presence.twitchRefreshToken;
  const missing = [];
  const missingReasonTokens = [];
  if (!presence.twitchClientId) missing.push("clientId");
  if (!presence.twitchClientId) missingReasonTokens.push("client_id");
  if (!presence.twitchBroadcasterId) missing.push("broadcasterId");
  if (!presence.twitchBroadcasterId) missingReasonTokens.push("broadcaster_id");
  if (!presence.twitchUserAccessToken) missing.push("userAccessToken");
  if (!presence.twitchUserAccessToken) missingReasonTokens.push("user_access_token");
  const ready = missing.length === 0 && !tokenExpired;

  let reason = "ready";
  let detail = "Helix reward sync is ready.";
  if (missing.length > 0) {
    reason = `missing_${missingReasonTokens.join("_")}`;
    detail = `Missing ${missing.join(", ")}.`;
  } else if (tokenExpired && !canRefresh) {
    reason = "token_expired_refresh_missing";
    detail = "User access token expired and no refresh token is stored.";
  } else if (tokenExpired) {
    reason = "token_expired";
    detail = "User access token expired and must be refreshed before Helix calls can succeed.";
  } else if (tokenExpiringSoon) {
    reason = "token_expiring_soon";
    detail = "Helix reward sync is ready, but the user access token expires soon.";
  }

  return {
    ready,
    reason,
    detail,
    missing,
    tokenExpired,
    tokenExpiringSoon,
    canRefresh
  };
}

function createEmptyDeviceFlowState() {
  return {
    status: "idle",
    requestedBy: "",
    startedAt: 0,
    expiresAt: 0,
    intervalSec: 5,
    nextPollAt: 0,
    lastPolledAt: 0,
    userCode: "",
    verificationUri: "",
    verificationUriComplete: "",
    deviceCode: "",
    pollAttempts: 0,
    lastError: "",
    completedAt: 0
  };
}

function buildPublicDeviceFlowSnapshot(flow = {}) {
  const source = flow && typeof flow === "object" && !Array.isArray(flow) ? flow : {};
  return {
    status: asString(source.status || "idle").toLowerCase() || "idle",
    requestedBy: asString(source.requestedBy || ""),
    startedAt: Math.max(0, Number(source.startedAt || 0)),
    expiresAt: Math.max(0, Number(source.expiresAt || 0)),
    intervalSec: clampInt(source.intervalSec, 2, 60, 5),
    nextPollAt: Math.max(0, Number(source.nextPollAt || 0)),
    lastPolledAt: Math.max(0, Number(source.lastPolledAt || 0)),
    userCode: asString(source.userCode || ""),
    verificationUri: asString(source.verificationUri || ""),
    verificationUriComplete: asString(source.verificationUriComplete || ""),
    pollAttempts: Math.max(0, Number(source.pollAttempts || 0)),
    lastError: asString(source.lastError || ""),
    completedAt: Math.max(0, Number(source.completedAt || 0))
  };
}

function readVaultFromDisk(vaultPath = "") {
  const targetPath = asString(vaultPath);
  if (!targetPath || !fs.existsSync(targetPath)) {
    return {
      ok: true,
      exists: false,
      provider: process.platform === "win32" ? "windows_dpapi" : "volatile_only",
      profile: normalizeProfileShape({})
    };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(targetPath, "utf8"));
    const source = raw && typeof raw === "object" ? raw : {};
    const provider = asString(source.provider || "windows_dpapi");
    if (provider !== "windows_dpapi") {
      return {
        ok: false,
        exists: true,
        error: `unsupported_oauth_vault_provider:${provider}`
      };
    }
    const encrypted = source.encrypted && typeof source.encrypted === "object"
      ? source.encrypted
      : {};
    const out = {
      tokenExpiresAt: clampInt(source.tokenExpiresAt, 0, 4_102_444_800_000, 0)
    };
    for (const [field, mapped] of Object.entries(OAUTH_VAULT_FIELD_MAP)) {
      const cipher = asString(encrypted[field] || "");
      if (!cipher) continue;
      const decoded = unprotectTextWithWindowsDpapi(cipher);
      if (!decoded.ok) {
        return {
          ok: false,
          exists: true,
          error: asString(decoded.error || "oauth_vault_decrypt_failed"),
          field
        };
      }
      out[mapped] = asString(decoded.plain || "");
    }
    return {
      ok: true,
      exists: true,
      provider,
      profile: normalizeProfileShape(out)
    };
  } catch (error) {
    return {
      ok: false,
      exists: true,
      error: asString(error?.message || "oauth_vault_read_failed")
    };
  }
}

function writeVaultToDisk(profileInput = {}, vaultPath = "") {
  const targetPath = asString(vaultPath);
  if (!targetPath) {
    return {
      ok: false,
      error: "oauth_vault_path_missing"
    };
  }
  const profile = normalizeProfileShape(profileInput);
  const hasData = hasAnyProfileValue(profile);
  if (!hasData) {
    try {
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
      return {
        ok: true,
        cleared: true,
        path: targetPath
      };
    } catch (error) {
      return {
        ok: false,
        error: asString(error?.message || "oauth_vault_clear_failed")
      };
    }
  }
  if (process.platform !== "win32") {
    return {
      ok: true,
      provider: "volatile_only",
      volatileOnly: true,
      path: targetPath
    };
  }
  const encrypted = {};
  for (const [field, mapped] of Object.entries(OAUTH_VAULT_FIELD_MAP)) {
    const plain = asString(profile[mapped] || "");
    if (!plain) continue;
    const encoded = protectTextWithWindowsDpapi(plain);
    if (!encoded.ok) {
      return {
        ok: false,
        error: asString(encoded.error || "oauth_vault_encrypt_failed"),
        field
      };
    }
    encrypted[field] = asString(encoded.cipherB64 || "");
  }
  const payload = {
    version: OAUTH_VAULT_VERSION,
    provider: "windows_dpapi",
    tokenExpiresAt: Math.max(0, Number(profile.tokenExpiresAt || 0)),
    updatedAt: Date.now(),
    encrypted
  };
  try {
    ensureDirectoryForFile(targetPath);
    fs.writeFileSync(targetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return {
      ok: true,
      provider: "windows_dpapi",
      path: targetPath
    };
  } catch (error) {
    return {
      ok: false,
      error: asString(error?.message || "oauth_vault_write_failed")
    };
  }
}

function buildActivateUrl(verificationUriComplete = "", verificationUri = "", userCode = "") {
  const sourceUrl = asString(verificationUriComplete || verificationUri || "https://www.twitch.tv/activate");
  const code = asString(userCode);
  if (!code) return sourceUrl;
  try {
    const parsed = new URL(sourceUrl);
    if (!parsed.searchParams.has("public")) {
      parsed.searchParams.set("public", "true");
    }
    if (!parsed.searchParams.has("device-code")) {
      parsed.searchParams.set("device-code", code);
    }
    return parsed.toString();
  } catch {
    return sourceUrl;
  }
}

module.exports = {
  buildActivateUrl,
  buildHelixReadiness,
  buildProfilePresence,
  buildPublicDeviceFlowSnapshot,
  createEmptyDeviceFlowState,
  hasAnyProfileValue,
  mergeProfileWithDefaults,
  normalizeProfileShape,
  readVaultFromDisk,
  writeVaultToDisk
};
