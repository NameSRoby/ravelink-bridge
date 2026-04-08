// [TITLE] Module: domains/system/system-oauth.service.js
// [TITLE] Purpose: independent System-tab Twitch public Device OAuth runtime + secure local persistence
// [TITLE] Functionality Index:
// [TITLE] - keep System OAuth independent from mod runtime availability
// [TITLE] - persist OAuth profile in local Windows DPAPI vault when available
// [TITLE] - compose device-flow, transport, and Helix reconcile helpers
// [DEV] Complex Flow:
// [DEV] This service intentionally keeps profile storage and status snapshots centralized so
// [DEV] widget generation and status-sync contracts can work with or without mods loaded.

const axios = require("axios");
const {
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
} = require("./system-oauth.vault");
const createSystemOauthTransport = require("./system-oauth.transport");
const createSystemOauthReconcile = require("./system-oauth.reconcile");
const createSystemOauthDeviceFlow = require("./system-oauth.device-flow");

const OAUTH_SCOPES = Object.freeze(["channel:manage:redemptions"]);
const OAUTH_CLIENT_TYPE = "public";
const OAUTH_REFRESH_SKEW_MS = 90_000;

function asString(value) {
  return String(value ?? "").trim();
}

function normalizeOAuthBearerToken(value = "") {
  return asString(value).replace(/^bearer\s+/i, "");
}

function clampInt(value, min, max, fallback = 0) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return Math.round(Number(fallback) || 0);
  return Math.min(Math.round(Number(max) || parsed), Math.max(Math.round(Number(min) || parsed), parsed));
}

function cloneJson(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

module.exports = function createSystemOauthService(options = {}) {
  const vaultPath = asString(options.vaultPath || "");
  if (!vaultPath) {
    throw new Error("createSystemOauthService requires vaultPath");
  }

  const now = typeof options.now === "function" ? options.now : Date.now;
  const log = options.log && typeof options.log === "object" ? options.log : console;
  const httpClient = options.httpClient && typeof options.httpClient === "object" ? options.httpClient : axios;
  const internetGatewayClient = (
    options.internetGatewayClient &&
    typeof options.internetGatewayClient.request === "function"
  )
    ? options.internetGatewayClient
    : null;
  const profileDefaults = normalizeProfileShape(options.profileDefaults || {});
  const helixRetryMaxAttempts = clampInt(options.helixRetryMaxAttempts, 1, 6, 3);
  const helixRetryBaseDelayMs = clampInt(options.helixRetryBaseDelayMs, 50, 5_000, 300);
  const helixRetryMaxDelayMs = clampInt(options.helixRetryMaxDelayMs, helixRetryBaseDelayMs, 15_000, 1_800);
  const helixSleeper = typeof options.helixSleeper === "function"
    ? options.helixSleeper
    : (ms => new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0))));
  const helixRandom = typeof options.helixRandom === "function" ? options.helixRandom : Math.random;

  let profile = normalizeProfileShape(profileDefaults);
  let deviceFlow = createEmptyDeviceFlowState();
  let refreshInFlight = null;
  let vaultRuntime = {
    provider: process.platform === "win32" ? "windows_dpapi" : "volatile_only",
    loaded: false,
    loadError: "",
    lastPersistAt: 0,
    persistError: "",
    persistCleared: false
  };

  const loadedVault = readVaultFromDisk(vaultPath);
  if (loadedVault.ok) {
    profile = mergeProfileWithDefaults(profileDefaults, loadedVault.profile || {});
    vaultRuntime = {
      ...vaultRuntime,
      provider: asString(loadedVault.provider || vaultRuntime.provider),
      loaded: true,
      loadError: ""
    };
  } else {
    vaultRuntime = {
      ...vaultRuntime,
      loaded: false,
      loadError: asString(loadedVault.error || "oauth_vault_load_failed")
    };
    if (vaultRuntime.loadError) {
      log.warn?.("[SYSTEM][OAUTH] vault load failed:", vaultRuntime.loadError);
    }
  }

  function persistProfile(reason = "") {
    const stored = writeVaultToDisk(profile, vaultPath);
    vaultRuntime.lastPersistAt = Number(now() || Date.now());
    vaultRuntime.persistCleared = stored.cleared === true;
    vaultRuntime.persistError = stored.ok ? "" : asString(stored.error || "oauth_vault_persist_failed");
    if (!stored.ok) {
      log.warn?.("[SYSTEM][OAUTH] vault persist failed:", {
        reason: asString(reason || ""),
        error: vaultRuntime.persistError
      });
      return false;
    }
    return true;
  }

  function getProfileForInternal() {
    return cloneJson(profile, {});
  }

  function getStatus() {
    const snapshot = normalizeProfileShape(profile);
    const presence = buildProfilePresence(snapshot);
    const tokenExpiresAt = Math.max(0, Number(snapshot.tokenExpiresAt || 0));
    const helix = buildHelixReadiness(snapshot, Date.now());
    return {
      ok: true,
      oauthFlow: "public_device_code",
      oauthClientType: OAUTH_CLIENT_TYPE,
      mode: process.platform === "win32" ? "persistent_write_only_dpapi" : "volatile_write_only_non_windows",
      profile: {
        twitchClientId: "",
        twitchClientSecret: "",
        twitchUserAccessToken: "",
        twitchBroadcasterId: "",
        oauthRedirectUri: "",
        hasTwitchClientId: presence.twitchClientId,
        hasTwitchUserAccessToken: presence.twitchUserAccessToken,
        hasTwitchBroadcasterId: presence.twitchBroadcasterId,
        hasTwitchClientSecret: false,
        hasOauthRedirectUri: false
      },
      hasValues: hasAnyProfileValue(snapshot),
      presence: {
        twitchClientId: presence.twitchClientId,
        twitchBroadcasterId: presence.twitchBroadcasterId,
        twitchUserAccessToken: presence.twitchUserAccessToken,
        twitchRefreshToken: presence.twitchRefreshToken,
        oauthRedirectUri: false,
        twitchClientSecret: false
      },
      helix,
      tokenExpiresAt,
      tokenIsExpired: tokenExpiresAt > 0 ? tokenExpiresAt <= Date.now() : false,
      oauthVault: {
        enabled: process.platform === "win32",
        provider: asString(vaultRuntime.provider || "windows_dpapi"),
        loaded: vaultRuntime.loaded === true,
        hasError: Boolean(asString(vaultRuntime.loadError || "") || asString(vaultRuntime.persistError || "")),
        lastError: asString(vaultRuntime.persistError || vaultRuntime.loadError || ""),
        lastPersistAt: Math.max(0, Number(vaultRuntime.lastPersistAt || 0)),
        persistCleared: vaultRuntime.persistCleared === true
      },
      internetGateway: internetGatewayClient && typeof internetGatewayClient.getStatus === "function"
        ? cloneJson(internetGatewayClient.getStatus(), {})
        : {
          available: false
        },
      deviceFlow: buildPublicDeviceFlowSnapshot(deviceFlow),
      requiredScopes: cloneJson(OAUTH_SCOPES, [])
    };
  }

  function seedProfile(input = {}, optionsInput = {}) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const optionsShape = optionsInput && typeof optionsInput === "object" && !Array.isArray(optionsInput)
      ? optionsInput
      : {};
    const replace = optionsShape.replace === true || source.replace === true;
    const patch = normalizeProfileShape(source);
    const next = replace
      ? normalizeProfileShape(profileDefaults)
      : normalizeProfileShape(profile);
    if (Object.prototype.hasOwnProperty.call(source, "twitchClientId") || Object.prototype.hasOwnProperty.call(source, "clientId")) {
      next.twitchClientId = patch.twitchClientId;
    }
    if (Object.prototype.hasOwnProperty.call(source, "twitchBroadcasterId") || Object.prototype.hasOwnProperty.call(source, "broadcasterId")) {
      next.twitchBroadcasterId = patch.twitchBroadcasterId;
    }
    if (Object.prototype.hasOwnProperty.call(source, "twitchUserAccessToken") || Object.prototype.hasOwnProperty.call(source, "userAccessToken")) {
      next.twitchUserAccessToken = patch.twitchUserAccessToken;
    }
    if (Object.prototype.hasOwnProperty.call(source, "twitchRefreshToken") || Object.prototype.hasOwnProperty.call(source, "refreshToken")) {
      next.twitchRefreshToken = patch.twitchRefreshToken;
    }
    if (Object.prototype.hasOwnProperty.call(source, "tokenExpiresAt")) {
      next.tokenExpiresAt = patch.tokenExpiresAt;
    }
    profile = normalizeProfileShape(next);
    persistProfile("seed_profile");
    return getStatus();
  }

  function clearProfile() {
    profile = normalizeProfileShape(profileDefaults);
    deviceFlow = createEmptyDeviceFlowState();
    persistProfile("clear_profile");
    return getStatus();
  }

  function seedProfilePatchFromInput(input = {}, reason = "widget_status_sync_seed") {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const profilePatch = {};
    if (Object.prototype.hasOwnProperty.call(source, "twitchClientId") || Object.prototype.hasOwnProperty.call(source, "clientId")) {
      profilePatch.twitchClientId = asString(source.twitchClientId || source.clientId || "");
    }
    if (
      Object.prototype.hasOwnProperty.call(source, "twitchBroadcasterId") ||
      Object.prototype.hasOwnProperty.call(source, "broadcasterId") ||
      Object.prototype.hasOwnProperty.call(source, "broadcaster_id")
    ) {
      profilePatch.twitchBroadcasterId = asString(source.twitchBroadcasterId || source.broadcasterId || source.broadcaster_id || "");
    }
    if (Object.prototype.hasOwnProperty.call(source, "twitchUserAccessToken") || Object.prototype.hasOwnProperty.call(source, "userAccessToken")) {
      profilePatch.twitchUserAccessToken = normalizeOAuthBearerToken(source.twitchUserAccessToken || source.userAccessToken || "");
    }
    if (Object.prototype.hasOwnProperty.call(source, "twitchRefreshToken") || Object.prototype.hasOwnProperty.call(source, "refreshToken")) {
      profilePatch.twitchRefreshToken = asString(source.twitchRefreshToken || source.refreshToken || "");
    }
    if (Object.prototype.hasOwnProperty.call(source, "tokenExpiresAt")) {
      profilePatch.tokenExpiresAt = clampInt(source.tokenExpiresAt, 0, 4_102_444_800_000, 0);
    }
    if (!Object.keys(profilePatch).length) {
      return false;
    }
    profile = normalizeProfileShape({
      ...profile,
      ...profilePatch
    });
    persistProfile(reason);
    return true;
  }

  const transport = createSystemOauthTransport({
    httpClient,
    internetGatewayClient
  });

  async function refreshAccessTokenIfNeeded(optionsInput = {}) {
    const source = optionsInput && typeof optionsInput === "object" && !Array.isArray(optionsInput) ? optionsInput : {};
    const force = source.force === true;
    const snapshot = normalizeProfileShape({
      ...profile,
      twitchClientId: asString(source.clientId || profile.twitchClientId || ""),
      twitchUserAccessToken: normalizeOAuthBearerToken(source.accessToken || profile.twitchUserAccessToken || ""),
      twitchRefreshToken: asString(source.refreshToken || profile.twitchRefreshToken || ""),
      tokenExpiresAt: source.tokenExpiresAt === undefined
        ? profile.tokenExpiresAt
        : clampInt(source.tokenExpiresAt, 0, 4_102_444_800_000, 0)
    });
    const nowMs = Number(now() || Date.now());
    const accessToken = normalizeOAuthBearerToken(snapshot.twitchUserAccessToken || "");
    const refreshToken = asString(snapshot.twitchRefreshToken || "");
    const clientId = asString(snapshot.twitchClientId || "");
    const tokenExpiresAt = Math.max(0, Number(snapshot.tokenExpiresAt || 0));
    const expiringSoon = tokenExpiresAt > 0 && (tokenExpiresAt - nowMs) < OAUTH_REFRESH_SKEW_MS;

    if (!force && accessToken && (!tokenExpiresAt || !expiringSoon)) {
      return {
        ok: true,
        accessToken,
        refreshed: false
      };
    }
    if (!refreshToken || !clientId) {
      return {
        ok: Boolean(accessToken),
        accessToken,
        refreshed: false,
        error: accessToken ? "" : "twitch_refresh_credentials_missing"
      };
    }
    if (refreshInFlight) {
      return refreshInFlight;
    }

    refreshInFlight = (async () => {
      try {
        const response = await transport.postOAuthForm("oauth2_token_refresh", "/oauth2/token", {
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: clientId
        }, {
          timeoutMs: 12_000,
          retryBudget: 1
        });
        const body = response && typeof response.data === "object" && !Array.isArray(response.data)
          ? response.data
          : {};
        if (Number(response.status) < 200 || Number(response.status) >= 300) {
          const message = asString(body.message || body.error || `oauth_refresh_http_${response.status}`);
          return {
            ok: Boolean(accessToken),
            accessToken,
            refreshed: false,
            error: message
          };
        }
        const nextAccessToken = normalizeOAuthBearerToken(body.access_token || "");
        const nextRefreshToken = asString(body.refresh_token || refreshToken);
        const expiresIn = clampInt(body.expires_in, 0, 31_536_000, 14_400);
        const nextExpiresAt = expiresIn > 0 ? (Number(now() || Date.now()) + (expiresIn * 1000)) : 0;
        if (!nextAccessToken) {
          return {
            ok: Boolean(accessToken),
            accessToken,
            refreshed: false,
            error: "oauth_refresh_missing_access_token"
          };
        }
        if (source.persist !== false) {
          profile = normalizeProfileShape({
            ...profile,
            twitchClientId: clientId || profile.twitchClientId,
            twitchUserAccessToken: nextAccessToken,
            twitchRefreshToken: nextRefreshToken || profile.twitchRefreshToken,
            tokenExpiresAt: nextExpiresAt
          });
          persistProfile("oauth_refresh");
        }
        return {
          ok: true,
          accessToken: nextAccessToken,
          refreshed: true,
          tokenExpiresAt: nextExpiresAt
        };
      } catch (error) {
        return {
          ok: Boolean(accessToken),
          accessToken,
          refreshed: false,
          error: asString(error?.message || "oauth_refresh_failed")
        };
      } finally {
        refreshInFlight = null;
      }
    })();

    return refreshInFlight;
  }

  const systemOauthReconcile = createSystemOauthReconcile({
    normalizeProfileShape,
    seedProfilePatchFromInput,
    refreshAccessTokenIfNeeded,
    getProfile: () => getProfileForInternal(),
    transport,
    cloneJson,
    helixRetryMaxAttempts,
    helixRetryBaseDelayMs,
    helixRetryMaxDelayMs,
    helixSleeper,
    helixRandom
  });

  const systemOauthDeviceFlow = createSystemOauthDeviceFlow({
    now,
    buildActivateUrl,
    buildPublicDeviceFlowSnapshot,
    createEmptyDeviceFlowState,
    normalizeProfileShape,
    persistProfile,
    getStatus,
    getProfile: () => getProfileForInternal(),
    setProfile(nextProfile) {
      profile = normalizeProfileShape(nextProfile);
    },
    getDeviceFlow: () => cloneJson(deviceFlow, createEmptyDeviceFlowState()),
    setDeviceFlow(nextDeviceFlow) {
      deviceFlow = nextDeviceFlow && typeof nextDeviceFlow === "object"
        ? { ...createEmptyDeviceFlowState(), ...nextDeviceFlow }
        : createEmptyDeviceFlowState();
    },
    transport,
    cloneJson,
    oauthScopes: OAUTH_SCOPES,
    oauthClientType: OAUTH_CLIENT_TYPE
  });

  return {
    getStatus,
    getProfileForInternal,
    seedProfile,
    clearProfile,
    refreshAccessTokenIfNeeded,
    patchRedemptionStatus: systemOauthReconcile.patchRedemptionStatus,
    reconcilePendingRedemptions: systemOauthReconcile.reconcilePendingRedemptions,
    startAutoReconcile: systemOauthReconcile.startAutoReconcile,
    stopAutoReconcile: systemOauthReconcile.stopAutoReconcile,
    getAutoReconcileStatus: systemOauthReconcile.getAutoReconcileStatus,
    startDeviceFlow: systemOauthDeviceFlow.startDeviceFlow,
    getDeviceStatus: systemOauthDeviceFlow.getDeviceStatus,
    disconnect: systemOauthDeviceFlow.disconnect
  };
};
