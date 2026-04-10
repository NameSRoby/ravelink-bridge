// [TITLE] Module: app/routes/compat/system.compat.oauth-helpers.js
// [TITLE] Purpose: own system OAuth + widget redemption helper shaping for compat routes
// [TITLE] Functionality Index:
// [TITLE] - normalize system OAuth dev-profile payloads and widget status/reconcile inputs
// [TITLE] - sync OAuth credentials into target mods and read fallback OAuth state from mods
// [TITLE] - merge OAuth credentials into widget-template payload generation
// [DEV] Complex Flow:
// [DEV] These helpers are specific to the system compat contract, so they live with
// [DEV] the system route family instead of stretching the top-level compat composer.

const OAUTH_SYNC_TARGET_MOD_IDS = Object.freeze(["music-request-engine", "song-request-mod"]);
const OAUTH_SYSTEM_SYNC_ACTION = "oauth_twitch_sync_from_system";
const OAUTH_SYSTEM_READ_ACTION = "oauth_twitch_profile_for_system";

function createSystemCompatOauthHelpers(deps = {}) {
  const modRuntime = deps.modRuntime;
  const getRequestMap = typeof deps.getRequestMap === "function"
    ? deps.getRequestMap
    : (value => (value && typeof value === "object" && !Array.isArray(value) ? value : {}));
  const normalizeToken = typeof deps.normalizeToken === "function"
    ? deps.normalizeToken
    : ((value, max = 96) => String(value || "").trim().slice(0, Math.max(1, Number(max) || 96)));
  const clampNumber = typeof deps.clampNumber === "function"
    ? deps.clampNumber
    : ((value, min, max, fallback) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return Number(fallback);
      return Math.min(Number(max), Math.max(Number(min), parsed));
    });

  function normalizeOauthDevProfileInput(input = {}) {
    const source = getRequestMap(input);
    const nested = getRequestMap(source.profile);
    const payload = Object.keys(nested).length ? nested : source;
    const profile = {
      twitchClientId: normalizeToken(payload.twitchClientId, 512),
      twitchUserAccessToken: normalizeToken(payload.twitchUserAccessToken, 4096),
      twitchBroadcasterId: normalizeToken(payload.twitchBroadcasterId, 256),
      bundledClientIdDisabled: (
        payload.bundledClientIdDisabled === true ||
        payload.clearBundledClientId === true ||
        payload.useBundledClientId === false
      )
    };
    return {
      profile,
      replace: payload.replace === true || source.replace === true
    };
  }

  function buildOauthDevPresence(profile = {}) {
    const source = getRequestMap(profile);
    return {
      twitchClientId: Boolean(source.twitchClientId),
      twitchBroadcasterId: Boolean(source.twitchBroadcasterId),
      twitchUserAccessToken: Boolean(source.twitchUserAccessToken),
      oauthRedirectUri: false,
      twitchClientSecret: false
    };
  }

  function hasAnyOauthDevValue(profile = {}) {
    const presence = buildOauthDevPresence(profile);
    return Boolean(
      presence.twitchClientId ||
      presence.twitchBroadcasterId ||
      presence.twitchUserAccessToken
    );
  }

  function resolveOauthSyncTargetModId(hint = "") {
    const hinted = normalizeToken(hint, 96);
    const snapshot = modRuntime && typeof modRuntime.list === "function"
      ? modRuntime.list()
      : { mods: [] };
    const mods = Array.isArray(snapshot?.mods) ? snapshot.mods : [];
    const ids = mods
      .map(row => normalizeToken(row?.id, 96))
      .filter(Boolean);
    if (hinted && ids.includes(hinted)) return hinted;
    for (const preferred of OAUTH_SYNC_TARGET_MOD_IDS) {
      if (ids.includes(preferred)) return preferred;
    }
    const requestLike = ids.find(id => id.includes("music-request"));
    if (requestLike) return requestLike;
    if (ids.length === 1) return ids[0];
    return hinted || OAUTH_SYNC_TARGET_MOD_IDS[0];
  }

  function buildTwitchRefundPatchFromOauthProfile(profile = {}) {
    const source = getRequestMap(profile);
    const patch = {};
    if (source.twitchClientId) patch.clientId = String(source.twitchClientId);
    if (source.twitchUserAccessToken) patch.userAccessToken = String(source.twitchUserAccessToken);
    if (source.twitchBroadcasterId) patch.broadcasterId = String(source.twitchBroadcasterId);
    if (source.twitchRefreshToken) patch.refreshToken = String(source.twitchRefreshToken);
    if (Math.max(0, Number(source.tokenExpiresAt || 0)) > 0) {
      patch.tokenExpiresAt = clampNumber(source.tokenExpiresAt, 0, 4_102_444_800_000, 0);
    }
    if (Object.keys(patch).length) {
      patch.enabled = true;
    }
    return patch;
  }

  async function invokeOauthSyncAction(targetModId = "", action = "", payload = {}) {
    const result = await modRuntime.invokeAction(targetModId, action, "POST", payload);
    const resultStatus = Number(result?.status || 0);
    const resultBody = getRequestMap(result?.body);
    return {
      ok: Boolean(result && resultStatus >= 200 && resultStatus < 300 && resultBody.ok === true),
      status: resultStatus,
      body: resultBody,
      raw: result
    };
  }

  function mergeOauthProfileIntoWidgetPayload(targetPayload = {}, profile = {}) {
    const target = getRequestMap(targetPayload);
    const source = getRequestMap(profile);
    if (!target.twitchClientId && source.twitchClientId) {
      target.twitchClientId = normalizeToken(source.twitchClientId, 512);
    }
    if (!target.twitchUserAccessToken && source.twitchUserAccessToken) {
      target.twitchUserAccessToken = normalizeToken(source.twitchUserAccessToken, 4096);
    }
    if (!target.twitchBroadcasterId && source.twitchBroadcasterId) {
      target.twitchBroadcasterId = normalizeToken(source.twitchBroadcasterId, 256);
    }
    return target;
  }

  function normalizeWidgetRedemptionStatusSyncInput(input = {}) {
    const source = getRequestMap(input);
    const rawStatus = String(source.status || "").trim().toUpperCase();
    return {
      rewardId: normalizeToken(
        source.rewardId ??
        source.reward_id ??
        source.customRewardId ??
        source.custom_reward_id,
        256
      ),
      redemptionId: normalizeToken(
        source.redemptionId ??
        source.redemption_id ??
        source.id,
        256
      ),
      broadcasterId: normalizeToken(
        source.broadcasterId ??
        source.broadcaster_id ??
        source.twitchBroadcasterId,
        256
      ),
      status: rawStatus === "FULFILLED" || rawStatus === "CANCELED" ? rawStatus : "",
      reason: normalizeToken(source.reason ?? source.detail, 512),
      twitchClientId: normalizeToken(source.twitchClientId ?? source.clientId, 512),
      twitchBroadcasterId: normalizeToken(source.twitchBroadcasterId ?? source.broadcasterId ?? source.broadcaster_id, 256),
      twitchUserAccessToken: normalizeToken(source.twitchUserAccessToken ?? source.userAccessToken, 4096),
      twitchRefreshToken: normalizeToken(source.twitchRefreshToken ?? source.refreshToken, 4096),
      tokenExpiresAt: clampNumber(source.tokenExpiresAt, 0, 4_102_444_800_000, 0)
    };
  }

  function hasAnyWidgetStatusOauthPatch(input = {}) {
    const source = getRequestMap(input);
    return Boolean(
      normalizeToken(source.twitchClientId, 512) ||
      normalizeToken(source.twitchUserAccessToken, 4096) ||
      normalizeToken(source.twitchRefreshToken, 4096) ||
      Math.max(0, Number(source.tokenExpiresAt || 0)) > 0
    );
  }

  function normalizeWidgetRedemptionReconcileInput(input = {}) {
    const source = getRequestMap(input);
    const rawStatus = normalizeToken(source.status, 32).toUpperCase();
    const rewardIdsRaw = Array.isArray(source.rewardIds)
      ? source.rewardIds
      : normalizeToken(source.rewardIds ?? source.rewardId, 4096)
        .split(/[,\s]+/)
        .filter(Boolean);
    const rewardIds = rewardIdsRaw
      .map(item => normalizeToken(item, 256))
      .filter(Boolean);
    return {
      status: rawStatus === "FULFILLED" || rawStatus === "CANCELED" ? rawStatus : "FULFILLED",
      reason: normalizeToken(source.reason ?? source.detail, 512),
      rewardIds,
      maxRewards: clampNumber(source.maxRewards, 1, 500, 100),
      maxRedemptions: clampNumber(source.maxRedemptions, 1, 500, 200),
      twitchClientId: normalizeToken(source.twitchClientId ?? source.clientId, 512),
      twitchBroadcasterId: normalizeToken(source.twitchBroadcasterId ?? source.broadcasterId ?? source.broadcaster_id, 256),
      twitchUserAccessToken: normalizeToken(source.twitchUserAccessToken ?? source.userAccessToken, 4096),
      twitchRefreshToken: normalizeToken(source.twitchRefreshToken ?? source.refreshToken, 4096),
      tokenExpiresAt: clampNumber(source.tokenExpiresAt, 0, 4_102_444_800_000, 0)
    };
  }

  async function readOauthProfileFromModState(hint = "") {
    if (!modRuntime || typeof modRuntime.invokeAction !== "function") {
      return { ok: false, error: "mods_runtime_unavailable" };
    }
    const targetModId = resolveOauthSyncTargetModId(hint);
    if (!targetModId) {
      return { ok: false, error: "mods_target_unavailable" };
    }
    try {
      let refund = {};
      let internalReadError = "";
      const internalResponse = await modRuntime.invokeAction(targetModId, OAUTH_SYSTEM_READ_ACTION, "POST", {
        body: {
          __internalSystemOauthRead: true
        }
      });
      const internalStatus = Number(internalResponse?.status || 0);
      const internalBody = getRequestMap(internalResponse?.body);
      if (internalResponse && internalStatus >= 200 && internalStatus < 300 && internalBody.ok === true) {
        refund = getRequestMap(internalBody?.profile);
      } else {
        internalReadError = String(internalBody?.error || internalResponse?.error || "").trim();
      }
      if (!Object.keys(refund).length) {
        const response = await modRuntime.invokeAction(targetModId, "state", "GET", {});
        const responseStatus = Number(response?.status || 0);
        const responseBody = getRequestMap(response?.body);
        if (!response || responseStatus < 200 || responseStatus >= 300 || responseBody.ok !== true) {
          return {
            ok: false,
            targetModId,
            error: String(responseBody?.error || response?.error || internalReadError || "mods_state_read_failed"),
            detail: String(responseBody?.detail || "").trim()
          };
        }
        refund = getRequestMap(responseBody?.result?.config?.twitchRefund);
      }
      return {
        ok: true,
        targetModId,
        profile: {
          twitchClientId: normalizeToken(refund.clientId, 512),
          twitchUserAccessToken: normalizeToken(refund.userAccessToken, 4096),
          twitchBroadcasterId: normalizeToken(refund.broadcasterId, 256),
          twitchRefreshToken: normalizeToken(refund.refreshToken, 4096),
          tokenExpiresAt: clampNumber(refund.tokenExpiresAt, 0, 4_102_444_800_000, 0)
        }
      };
    } catch (error) {
      return {
        ok: false,
        targetModId,
        error: String(error?.message || error || "mods_state_read_failed")
      };
    }
  }

  async function syncOauthProfileToTargetMod(profile = {}, hintModId = "") {
    if (!modRuntime || typeof modRuntime.invokeAction !== "function") {
      return { ok: false, status: 503, error: "mods_runtime_unavailable" };
    }
    const patch = buildTwitchRefundPatchFromOauthProfile(profile);
    if (!Object.keys(patch).length) {
      return { ok: false, status: 400, error: "system_oauth_profile_empty" };
    }
    const targetModId = resolveOauthSyncTargetModId(hintModId);
    try {
      const syncPayload = {
        body: {
          profile: {
            twitchClientId: normalizeToken(profile.twitchClientId, 512),
            twitchUserAccessToken: normalizeToken(profile.twitchUserAccessToken, 4096),
            twitchBroadcasterId: normalizeToken(profile.twitchBroadcasterId, 256),
            twitchRefreshToken: normalizeToken(profile.twitchRefreshToken, 4096),
            tokenExpiresAt: clampNumber(profile.tokenExpiresAt, 0, 4_102_444_800_000, 0)
          },
          patch: {
            twitchRefund: patch
          },
          source: "system_oauth"
        }
      };
      let result = await invokeOauthSyncAction(targetModId, OAUTH_SYSTEM_SYNC_ACTION, syncPayload);
      if (
        !result.ok &&
        (result.status === 404 || String(result.body?.error || "") === "mod_action_not_found")
      ) {
        result = await invokeOauthSyncAction(targetModId, "admin_policy_set", {
          body: {
            patch: {
              twitchRefund: patch
            }
          }
        });
      }
      if (!result.ok) {
        return {
          ok: false,
          status: result.status >= 400 ? result.status : 502,
          error: String(result.body?.error || result.raw?.error || "system_oauth_mod_sync_failed"),
          detail: String(result.body?.detail || "").trim(),
          targetModId
        };
      }
      return { ok: true, status: 200, targetModId };
    } catch (error) {
      return {
        ok: false,
        status: 502,
        error: "system_oauth_mod_sync_failed",
        detail: String(error?.message || error || "unknown_error"),
        targetModId
      };
    }
  }

  return {
    normalizeOauthDevProfileInput,
    hasAnyOauthDevValue,
    syncOauthProfileToTargetMod,
    mergeOauthProfileIntoWidgetPayload,
    readOauthProfileFromModState,
    normalizeWidgetRedemptionStatusSyncInput,
    hasAnyWidgetStatusOauthPatch,
    normalizeWidgetRedemptionReconcileInput
  };
}

module.exports = {
  createSystemCompatOauthHelpers
};
