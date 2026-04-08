// [TITLE] Module: domains/system/system-oauth.reconcile.js
// [TITLE] Purpose: Helix status-sync + redemption reconcile ownership for System OAuth
// [TITLE] Functionality Index:
// [TITLE] - resolve Helix execution context and token refresh behavior
// [TITLE] - patch reward redemptions with retry/refresh handling
// [TITLE] - run manual and interval-based pending redemption reconciliation

const TWITCH_REDEMPTION_STATUS_ALLOWED = new Set(["FULFILLED", "CANCELED"]);
const TWITCH_REDEMPTION_PENDING_STATUS = "UNFULFILLED";
const HELIX_RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const HELIX_RETRYABLE_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ETIMEDOUT",
  "EPIPE"
]);

function asString(value) {
  return String(value ?? "").trim();
}

function clampInt(value, min, max, fallback = 0) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return Math.round(Number(fallback) || 0);
  return Math.min(Math.round(Number(max) || parsed), Math.max(Math.round(Number(min) || parsed), parsed));
}

function normalizeOAuthBearerToken(value = "") {
  return asString(value).replace(/^bearer\s+/i, "");
}

function isRetryableHelixStatus(status) {
  return HELIX_RETRYABLE_STATUS_CODES.has(Number(status || 0));
}

function isRetryableHelixError(error) {
  const code = asString(error?.code || "").toUpperCase();
  if (HELIX_RETRYABLE_ERROR_CODES.has(code)) return true;
  const message = asString(error?.message || "").toLowerCase();
  if (!message) return false;
  return (
    message.includes("timeout") ||
    message.includes("socket hang up") ||
    message.includes("network error")
  );
}

function parseRetryAfterMs(headers = {}) {
  const source = headers && typeof headers === "object" ? headers : {};
  const retryAfterRaw = asString(source["retry-after"] || source["Retry-After"] || "");
  if (retryAfterRaw) {
    const numeric = Number(retryAfterRaw);
    if (Number.isFinite(numeric) && numeric >= 0) {
      return clampInt(numeric * 1000, 0, 60_000, 0);
    }
    const dateMs = Number(new Date(retryAfterRaw).getTime() || 0);
    if (dateMs > 0) {
      return clampInt(dateMs - Date.now(), 0, 60_000, 0);
    }
  }

  const resetRaw = asString(
    source["ratelimit-reset"] ||
    source["Ratelimit-Reset"] ||
    source["x-ratelimit-reset"] ||
    source["X-RateLimit-Reset"] ||
    ""
  );
  const resetSeconds = Number(resetRaw);
  if (Number.isFinite(resetSeconds) && resetSeconds > 0) {
    const waitMs = (Math.round(resetSeconds) * 1000) - Date.now();
    return clampInt(waitMs, 0, 60_000, 0);
  }
  return 0;
}

function getHelixFailureDetail(response, fallback = "") {
  const body = response && typeof response.data === "object" && !Array.isArray(response.data)
    ? response.data
    : {};
  const bodyDetail = asString(body.message || body.error || "");
  if (bodyDetail) return bodyDetail;
  if (response?.__networkError) {
    return asString(response.__networkError?.message || response.__networkError || "helix_network_error");
  }
  if (fallback) return asString(fallback);
  return `helix_http_${Number(response?.status || 0)}`;
}

module.exports = function createSystemOauthReconcile(options = {}) {
  const normalizeProfileShape = options.normalizeProfileShape;
  const seedProfilePatchFromInput = options.seedProfilePatchFromInput;
  const refreshAccessTokenIfNeeded = options.refreshAccessTokenIfNeeded;
  const getProfile = options.getProfile;
  const transport = options.transport && typeof options.transport === "object" ? options.transport : {};
  const getHelix = typeof transport.getHelix === "function" ? transport.getHelix : null;
  const patchRedemption = typeof transport.patchRedemption === "function" ? transport.patchRedemption : null;
  const cloneJson = typeof options.cloneJson === "function"
    ? options.cloneJson
    : ((value, fallback = null) => {
      try {
        return JSON.parse(JSON.stringify(value));
      } catch {
        return fallback;
      }
    });
  const helixRetryMaxAttempts = clampInt(options.helixRetryMaxAttempts, 1, 6, 3);
  const helixRetryBaseDelayMs = clampInt(options.helixRetryBaseDelayMs, 50, 5_000, 300);
  const helixRetryMaxDelayMs = clampInt(options.helixRetryMaxDelayMs, helixRetryBaseDelayMs, 15_000, 1_800);
  const helixSleeper = typeof options.helixSleeper === "function"
    ? options.helixSleeper
    : (ms => new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0))));
  const helixRandom = typeof options.helixRandom === "function" ? options.helixRandom : Math.random;

  const reconcileRuntime = {
    enabled: false,
    intervalMs: 0,
    status: "FULFILLED",
    maxRewards: 100,
    maxRedemptions: 200,
    timer: null,
    inFlight: false,
    lastStartedAt: 0,
    lastCompletedAt: 0,
    lastResult: null
  };

  async function resolveHelixContext(input = {}) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    seedProfilePatchFromInput(source);
    const activeProfile = normalizeProfileShape(getProfile());
    const clientId = asString(activeProfile.twitchClientId || "");
    const broadcasterId = asString(
      source.broadcasterId ||
      source.broadcaster_id ||
      source.twitchBroadcasterId ||
      activeProfile.twitchBroadcasterId ||
      ""
    );
    if (!clientId || !broadcasterId) {
      return {
        ok: false,
        status: 409,
        error: "widget_status_sync_missing_oauth_credentials"
      };
    }
    const tokenState = await refreshAccessTokenIfNeeded({ force: false });
    const accessToken = normalizeOAuthBearerToken(tokenState?.accessToken || activeProfile.twitchUserAccessToken || "");
    if (!accessToken) {
      return {
        ok: false,
        status: 409,
        error: "widget_status_sync_missing_user_token",
        detail: asString(tokenState?.error || "")
      };
    }
    return {
      ok: true,
      status: 200,
      clientId,
      broadcasterId,
      accessToken,
      tokenState
    };
  }

  async function executeHelixWith401Refresh(context = {}, execute = async () => null) {
    let attempt = 0;
    let refreshedAfter401 = false;
    let lastResponse = null;

    while (attempt < helixRetryMaxAttempts) {
      attempt += 1;
      let response;
      try {
        response = await execute(context.accessToken);
      } catch (error) {
        response = {
          status: 0,
          data: {},
          headers: {},
          __networkError: error
        };
      }

      const status = Number(response?.status || 0);
      if (status === 401 && refreshedAfter401 !== true) {
        const tokenState = await refreshAccessTokenIfNeeded({ force: true });
        const refreshedToken = normalizeOAuthBearerToken(tokenState?.accessToken || "");
        if (refreshedToken && refreshedToken !== context.accessToken) {
          context.accessToken = refreshedToken;
          context.tokenState = tokenState;
          refreshedAfter401 = true;
          attempt -= 1;
          continue;
        }
      }

      const retryableStatus = isRetryableHelixStatus(status);
      const retryableError = response?.__networkError
        ? isRetryableHelixError(response.__networkError)
        : false;
      const shouldRetry = (retryableStatus || retryableError) && attempt < helixRetryMaxAttempts;
      if (!shouldRetry) {
        response.__attempts = attempt;
        return response;
      }

      const retryAfterMs = parseRetryAfterMs(response?.headers);
      const expBackoffMs = Math.min(
        helixRetryMaxDelayMs,
        helixRetryBaseDelayMs * Math.pow(2, Math.max(0, attempt - 1))
      );
      const jitterMs = Math.floor(helixRandom() * Math.max(0, Math.min(300, helixRetryBaseDelayMs)));
      const delayMs = Math.max(retryAfterMs, expBackoffMs + jitterMs);
      await helixSleeper(delayMs);
      lastResponse = response;
    }

    if (lastResponse && typeof lastResponse === "object") {
      lastResponse.__attempts = Math.max(1, Number(lastResponse.__attempts || helixRetryMaxAttempts));
    }
    return lastResponse;
  }

  async function patchRedemptionStatusViaContext(context = {}, input = {}) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const rewardId = asString(source.rewardId || source.reward_id || source.customRewardId || source.custom_reward_id || "");
    const redemptionId = asString(source.redemptionId || source.redemption_id || source.id || "");
    const targetStatus = asString(source.status || "").toUpperCase();
    const reason = asString(source.reason || source.detail || "");
    const response = await executeHelixWith401Refresh(context, async token => {
      return await patchRedemption(context, { rewardId, redemptionId, status: targetStatus }, token);
    });
    if (Number(response?.status) < 200 || Number(response?.status) >= 300) {
      return {
        ok: false,
        status: Number(response?.status || 502),
        error: "widget_status_sync_helix_patch_failed",
        detail: getHelixFailureDetail(response, reason)
      };
    }
    return {
      ok: true,
      status: 200,
      synced: true,
      rewardId,
      redemptionId,
      broadcasterId: context.broadcasterId,
      statusApplied: targetStatus,
      reason,
      refreshed: context.tokenState?.refreshed === true,
      attempts: Math.max(1, Number(response?.__attempts || 1))
    };
  }

  async function patchRedemptionStatus(input = {}) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const rewardId = asString(
      source.rewardId ??
      source.reward_id ??
      source.customRewardId ??
      source.custom_reward_id ??
      source?.reward?.id
    );
    const redemptionId = asString(
      source.redemptionId ??
      source.redemption_id ??
      source.id ??
      source?.redemption?.id
    );
    const targetStatus = asString(source.status || "").toUpperCase();
    const reason = asString(source.reason || source.detail || "");
    if (!rewardId || !redemptionId) {
      return {
        ok: false,
        status: 400,
        error: "widget_status_sync_missing_reward_or_redemption"
      };
    }
    if (!TWITCH_REDEMPTION_STATUS_ALLOWED.has(targetStatus)) {
      return {
        ok: false,
        status: 400,
        error: "widget_status_sync_invalid_status"
      };
    }
    const context = await resolveHelixContext(source);
    if (!context.ok) return context;
    return await patchRedemptionStatusViaContext(context, {
      rewardId,
      redemptionId,
      status: targetStatus,
      reason
    });
  }

  async function fetchManagedRewardIdsViaContext(context = {}, optionsInput = {}) {
    const source = optionsInput && typeof optionsInput === "object" && !Array.isArray(optionsInput) ? optionsInput : {};
    const maxRewards = clampInt(source.maxRewards, 1, 500, 100);
    const rewardIds = [];
    let cursor = "";
    while (rewardIds.length < maxRewards) {
      const first = Math.min(50, Math.max(1, maxRewards - rewardIds.length));
      const response = await executeHelixWith401Refresh(context, async token => {
        return await getHelix(context, token, "/helix/channel_points/custom_rewards", {
          broadcaster_id: context.broadcasterId,
          only_manageable_rewards: true,
          first,
          ...(cursor ? { after: cursor } : {})
        }, {
          operation: "helix_list_manageable_rewards",
          timeoutMs: 8_000,
          retryBudget: 1
        });
      });
      const body = response && typeof response.data === "object" && !Array.isArray(response.data)
        ? response.data
        : {};
      if (Number(response?.status) < 200 || Number(response?.status) >= 300) {
        return {
          ok: false,
          status: Number(response?.status || 502),
          error: "widget_status_sync_helix_rewards_list_failed",
          detail: getHelixFailureDetail(response),
          rewardIds
        };
      }
      const rows = Array.isArray(body.data) ? body.data : [];
      for (const row of rows) {
        const rewardId = asString(row?.id || "");
        if (!rewardId || rewardIds.includes(rewardId)) continue;
        rewardIds.push(rewardId);
        if (rewardIds.length >= maxRewards) break;
      }
      cursor = asString(body?.pagination?.cursor || "");
      if (!cursor || rows.length === 0) break;
    }
    return {
      ok: true,
      status: 200,
      rewardIds
    };
  }

  async function fetchPendingRedemptionsForRewardViaContext(context = {}, rewardId = "", optionsInput = {}) {
    const source = optionsInput && typeof optionsInput === "object" && !Array.isArray(optionsInput) ? optionsInput : {};
    const targetRewardId = asString(rewardId || "");
    const maxRedemptions = clampInt(source.maxRedemptions, 1, 500, 200);
    const redemptions = [];
    let cursor = "";
    while (redemptions.length < maxRedemptions) {
      const first = Math.min(50, Math.max(1, maxRedemptions - redemptions.length));
      const response = await executeHelixWith401Refresh(context, async token => {
        return await getHelix(context, token, "/helix/channel_points/custom_rewards/redemptions", {
          broadcaster_id: context.broadcasterId,
          reward_id: targetRewardId,
          status: TWITCH_REDEMPTION_PENDING_STATUS,
          sort: "OLDEST",
          first,
          ...(cursor ? { after: cursor } : {})
        }, {
          operation: "helix_list_pending_redemptions",
          timeoutMs: 8_000,
          retryBudget: 1
        });
      });
      const body = response && typeof response.data === "object" && !Array.isArray(response.data)
        ? response.data
        : {};
      if (Number(response?.status) < 200 || Number(response?.status) >= 300) {
        return {
          ok: false,
          status: Number(response?.status || 502),
          error: "widget_status_sync_helix_pending_list_failed",
          detail: getHelixFailureDetail(response),
          rewardId: targetRewardId,
          redemptions
        };
      }
      const rows = Array.isArray(body.data) ? body.data : [];
      for (const row of rows) {
        const redemptionId = asString(row?.id || "");
        if (!redemptionId) continue;
        redemptions.push({
          id: redemptionId,
          rewardId: targetRewardId,
          status: asString(row?.status || ""),
          redeemedAt: asString(row?.redeemed_at || "")
        });
      }
      cursor = asString(body?.pagination?.cursor || "");
      if (!cursor || rows.length === 0) break;
    }
    return {
      ok: true,
      status: 200,
      rewardId: targetRewardId,
      redemptions
    };
  }

  async function reconcilePendingRedemptions(input = {}) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const targetStatus = asString(source.status || "FULFILLED").toUpperCase();
    if (!TWITCH_REDEMPTION_STATUS_ALLOWED.has(targetStatus)) {
      return {
        ok: false,
        status: 400,
        error: "widget_status_sync_invalid_status"
      };
    }
    const context = await resolveHelixContext(source);
    if (!context.ok) return context;
    const maxRewards = clampInt(source.maxRewards, 1, 500, 100);
    const maxRedemptions = clampInt(source.maxRedemptions, 1, 500, 200);
    const requestedRewardIds = Array.isArray(source.rewardIds)
      ? source.rewardIds.map(item => asString(item || "")).filter(Boolean)
      : asString(source.rewardIds || source.rewardId || "")
        .split(/[,\s]+/)
        .map(item => asString(item || ""))
        .filter(Boolean);
    let rewardIds = [...new Set(requestedRewardIds)];
    if (!rewardIds.length) {
      const rewardLookup = await fetchManagedRewardIdsViaContext(context, { maxRewards });
      if (!rewardLookup.ok) return rewardLookup;
      rewardIds = rewardLookup.rewardIds || [];
    }

    const failures = [];
    let pendingFound = 0;
    let resolved = 0;
    let rewardScanned = 0;
    let redemptionsScanned = 0;
    let truncated = false;
    for (const rewardId of rewardIds) {
      rewardScanned += 1;
      const pendingLookup = await fetchPendingRedemptionsForRewardViaContext(context, rewardId, { maxRedemptions });
      if (!pendingLookup.ok) {
        failures.push({
          rewardId,
          redemptionId: "",
          error: pendingLookup.error,
          detail: pendingLookup.detail || ""
        });
        continue;
      }
      const pendingRows = Array.isArray(pendingLookup.redemptions) ? pendingLookup.redemptions : [];
      pendingFound += pendingRows.length;
      redemptionsScanned += pendingRows.length;
      for (const pendingRow of pendingRows) {
        const patchResult = await patchRedemptionStatusViaContext(context, {
          rewardId,
          redemptionId: asString(pendingRow?.id || ""),
          status: targetStatus,
          reason: asString(source.reason || "pending_reconcile")
        });
        if (patchResult.ok) {
          resolved += 1;
          continue;
        }
        failures.push({
          rewardId,
          redemptionId: asString(pendingRow?.id || ""),
          error: asString(patchResult.error || "widget_status_sync_failed"),
          detail: asString(patchResult.detail || "")
        });
      }
      if (redemptionsScanned >= maxRedemptions) {
        truncated = true;
        break;
      }
    }

    return {
      ok: true,
      status: 200,
      synced: true,
      reconcile: true,
      broadcasterId: context.broadcasterId,
      statusApplied: targetStatus,
      rewardScanned,
      rewardCount: rewardIds.length,
      pendingFound,
      resolved,
      failed: failures.length,
      failures,
      truncated,
      maxRewards,
      maxRedemptions
    };
  }

  function getAutoReconcileStatus() {
    return {
      enabled: reconcileRuntime.enabled === true,
      inFlight: reconcileRuntime.inFlight === true,
      intervalMs: Math.max(0, Number(reconcileRuntime.intervalMs || 0)),
      status: asString(reconcileRuntime.status || "FULFILLED"),
      maxRewards: clampInt(reconcileRuntime.maxRewards, 1, 500, 100),
      maxRedemptions: clampInt(reconcileRuntime.maxRedemptions, 1, 500, 200),
      lastStartedAt: Math.max(0, Number(reconcileRuntime.lastStartedAt || 0)),
      lastCompletedAt: Math.max(0, Number(reconcileRuntime.lastCompletedAt || 0)),
      lastResult: cloneJson(reconcileRuntime.lastResult, null)
    };
  }

  function stopAutoReconcile() {
    if (reconcileRuntime.timer) {
      clearInterval(reconcileRuntime.timer);
      reconcileRuntime.timer = null;
    }
    reconcileRuntime.enabled = false;
    return getAutoReconcileStatus();
  }

  function startAutoReconcile(input = {}) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const enabled = source.enabled !== false;
    const status = asString(source.status || "FULFILLED").toUpperCase();
    const intervalMs = clampInt(source.intervalMs, 10_000, 600_000, 45_000);
    const maxRewards = clampInt(source.maxRewards, 1, 500, 100);
    const maxRedemptions = clampInt(source.maxRedemptions, 1, 500, 200);
    if (!enabled) return stopAutoReconcile();
    reconcileRuntime.status = TWITCH_REDEMPTION_STATUS_ALLOWED.has(status) ? status : "FULFILLED";
    reconcileRuntime.intervalMs = intervalMs;
    reconcileRuntime.maxRewards = maxRewards;
    reconcileRuntime.maxRedemptions = maxRedemptions;
    if (reconcileRuntime.timer) {
      clearInterval(reconcileRuntime.timer);
      reconcileRuntime.timer = null;
    }
    reconcileRuntime.enabled = true;
    const tick = async () => {
      if (reconcileRuntime.inFlight) return;
      const snapshot = normalizeProfileShape(getProfile());
      if (!snapshot.twitchClientId || !snapshot.twitchBroadcasterId || !snapshot.twitchUserAccessToken) {
        return;
      }
      reconcileRuntime.inFlight = true;
      reconcileRuntime.lastStartedAt = Date.now();
      try {
        const result = await reconcilePendingRedemptions({
          status: reconcileRuntime.status,
          reason: "auto_reconcile",
          maxRewards: reconcileRuntime.maxRewards,
          maxRedemptions: reconcileRuntime.maxRedemptions
        });
        reconcileRuntime.lastResult = result;
      } catch (error) {
        reconcileRuntime.lastResult = {
          ok: false,
          status: 500,
          error: asString(error?.message || "auto_reconcile_failed")
        };
      } finally {
        reconcileRuntime.lastCompletedAt = Date.now();
        reconcileRuntime.inFlight = false;
      }
    };
    tick().catch(() => {});
    reconcileRuntime.timer = setInterval(() => {
      tick().catch(() => {});
    }, intervalMs);
    reconcileRuntime.timer.unref?.();
    return getAutoReconcileStatus();
  }

  return {
    patchRedemptionStatus,
    reconcilePendingRedemptions,
    getAutoReconcileStatus,
    stopAutoReconcile,
    startAutoReconcile
  };
};
