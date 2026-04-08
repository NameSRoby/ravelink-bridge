// [TITLE] Module: domains/system/system-oauth.device-flow.js
// [TITLE] Purpose: Twitch device-code workflow ownership for System OAuth
// [TITLE] Functionality Index:
// [TITLE] - start and poll device authorization flows
// [TITLE] - shape public device-flow status payloads
// [TITLE] - clear local OAuth runtime state on disconnect

function asString(value) {
  return String(value ?? "").trim();
}

function clampInt(value, min, max, fallback = 0) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return Math.round(Number(fallback) || 0);
  return Math.min(Math.round(Number(max) || parsed), Math.max(Math.round(Number(min) || parsed), parsed));
}

module.exports = function createSystemOauthDeviceFlow(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const buildActivateUrl = options.buildActivateUrl;
  const buildPublicDeviceFlowSnapshot = options.buildPublicDeviceFlowSnapshot;
  const createEmptyDeviceFlowState = options.createEmptyDeviceFlowState;
  const normalizeProfileShape = options.normalizeProfileShape;
  const persistProfile = options.persistProfile;
  const getStatus = options.getStatus;
  const getProfile = options.getProfile;
  const setProfile = typeof options.setProfile === "function" ? options.setProfile : (() => {});
  const getDeviceFlow = typeof options.getDeviceFlow === "function" ? options.getDeviceFlow : (() => createEmptyDeviceFlowState());
  const setDeviceFlow = typeof options.setDeviceFlow === "function" ? options.setDeviceFlow : (() => {});
  const transport = options.transport && typeof options.transport === "object" ? options.transport : {};
  const postOAuthForm = typeof transport.postOAuthForm === "function" ? transport.postOAuthForm : null;
  const requestOAuthValidate = typeof transport.requestOAuthValidate === "function" ? transport.requestOAuthValidate : null;
  const cloneJson = typeof options.cloneJson === "function"
    ? options.cloneJson
    : ((value, fallback = null) => {
      try {
        return JSON.parse(JSON.stringify(value));
      } catch {
        return fallback;
      }
    });
  const OAUTH_SCOPES = Array.isArray(options.oauthScopes) ? options.oauthScopes.slice() : [];
  const OAUTH_CLIENT_TYPE = asString(options.oauthClientType || "public") || "public";

  async function startDeviceFlow(input = {}) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const profile = normalizeProfileShape(getProfile());
    const clientId = asString(source.clientId || profile.twitchClientId || "");
    if (!clientId) {
      return {
        ok: false,
        status: 409,
        error: "twitch_client_id_missing"
      };
    }
    const deviceFlow = getDeviceFlow();
    const currentStatus = asString(deviceFlow.status || "").toLowerCase();
    const nowMs = Number(now() || Date.now());
    if (currentStatus === "pending" && Number(deviceFlow.expiresAt || 0) > nowMs) {
      return {
        ok: true,
        reused: true,
        flow: buildPublicDeviceFlowSnapshot(deviceFlow),
        authorizeUrl: buildActivateUrl(deviceFlow.verificationUriComplete, deviceFlow.verificationUri, deviceFlow.userCode)
      };
    }

    try {
      const response = await postOAuthForm("oauth2_device_start", "/oauth2/device", {
        client_id: clientId,
        scopes: OAUTH_SCOPES.join(" ")
      }, {
        timeoutMs: 12_000,
        retryBudget: 1
      });
      const body = response && typeof response.data === "object" && !Array.isArray(response.data)
        ? response.data
        : {};
      if (Number(response.status) < 200 || Number(response.status) >= 300) {
        return {
          ok: false,
          status: 409,
          error: asString(body.message || body.error || `oauth_device_start_http_${response.status}`)
        };
      }
      const userCode = asString(body.user_code || "");
      const deviceCode = asString(body.device_code || "");
      const verificationUri = asString(body.verification_uri || "");
      const verificationUriComplete = asString(body.verification_uri_complete || "");
      if (!userCode || !deviceCode || !verificationUri) {
        return {
          ok: false,
          status: 409,
          error: "oauth_device_start_missing_fields"
        };
      }
      setProfile(normalizeProfileShape({
        ...profile,
        twitchClientId: clientId
      }));
      persistProfile("device_start");
      const intervalSec = clampInt(body.interval, 2, 30, 5);
      const expiresIn = clampInt(body.expires_in, 60, 3600, 1800);
      const next = createEmptyDeviceFlowState();
      next.status = "pending";
      next.requestedBy = asString(source.requestedBy || "system");
      next.startedAt = nowMs;
      next.expiresAt = nowMs + (expiresIn * 1000);
      next.intervalSec = intervalSec;
      next.nextPollAt = nowMs + (intervalSec * 1000);
      next.lastPolledAt = 0;
      next.userCode = userCode;
      next.verificationUri = verificationUri;
      next.verificationUriComplete = verificationUriComplete;
      next.deviceCode = deviceCode;
      next.pollAttempts = 0;
      next.lastError = "";
      next.completedAt = 0;
      setDeviceFlow(next);
      return {
        ok: true,
        status: 200,
        oauthFlow: "public_device_code",
        oauthClientType: OAUTH_CLIENT_TYPE,
        authorizeUrl: buildActivateUrl(verificationUriComplete, verificationUri, userCode),
        userCode,
        verificationUri,
        verificationUriComplete,
        deviceFlow: buildPublicDeviceFlowSnapshot(next),
        requiredScopes: cloneJson(OAUTH_SCOPES, []),
        expiresAt: next.expiresAt,
        expiresIn,
        intervalSec
      };
    } catch (error) {
      return {
        ok: false,
        status: 409,
        error: asString(error?.message || "oauth_device_start_failed")
      };
    }
  }

  async function pollDeviceFlow(optionsInput = {}) {
    const source = optionsInput && typeof optionsInput === "object" && !Array.isArray(optionsInput) ? optionsInput : {};
    let deviceFlow = getDeviceFlow();
    const currentStatus = asString(deviceFlow.status || "").toLowerCase();
    if (currentStatus !== "pending") {
      return {
        ok: true,
        deviceFlow: buildPublicDeviceFlowSnapshot(deviceFlow)
      };
    }
    const nowMs = Number(now() || Date.now());
    if (Number(deviceFlow.expiresAt || 0) <= nowMs) {
      deviceFlow = {
        ...deviceFlow,
        status: "expired",
        lastError: "device_flow_expired",
        completedAt: nowMs
      };
      setDeviceFlow(deviceFlow);
      return {
        ok: true,
        deviceFlow: buildPublicDeviceFlowSnapshot(deviceFlow)
      };
    }
    if (source.force !== true && Number(deviceFlow.nextPollAt || 0) > nowMs) {
      return {
        ok: true,
        deviceFlow: buildPublicDeviceFlowSnapshot(deviceFlow)
      };
    }
    let profile = normalizeProfileShape(getProfile());
    const clientId = asString(profile.twitchClientId || "");
    const deviceCode = asString(deviceFlow.deviceCode || "");
    if (!clientId || !deviceCode) {
      deviceFlow = {
        ...deviceFlow,
        status: "error",
        lastError: "device_flow_missing_runtime_fields"
      };
      setDeviceFlow(deviceFlow);
      return {
        ok: true,
        deviceFlow: buildPublicDeviceFlowSnapshot(deviceFlow)
      };
    }

    try {
      const response = await postOAuthForm("oauth2_device_poll", "/oauth2/token", {
        client_id: clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code"
      }, {
        timeoutMs: 12_000,
        retryBudget: 1
      });
      const body = response && typeof response.data === "object" && !Array.isArray(response.data)
        ? response.data
        : {};
      deviceFlow = {
        ...deviceFlow,
        lastPolledAt: nowMs,
        pollAttempts: Math.max(0, Number(deviceFlow.pollAttempts || 0)) + 1
      };
      if (Number(response.status) >= 200 && Number(response.status) < 300 && asString(body.access_token || "")) {
        const accessToken = asString(body.access_token || "");
        const refreshToken = asString(body.refresh_token || "");
        const expiresIn = clampInt(body.expires_in, 60, 31_536_000, 14_400);
        const tokenExpiresAt = nowMs + (expiresIn * 1000);
        profile = normalizeProfileShape({
          ...profile,
          twitchUserAccessToken: accessToken,
          twitchRefreshToken: refreshToken || profile.twitchRefreshToken,
          tokenExpiresAt
        });

        if (!asString(profile.twitchBroadcasterId || "")) {
          try {
            const validation = await requestOAuthValidate(accessToken);
            const validationBody = validation && typeof validation.data === "object" && !Array.isArray(validation.data)
              ? validation.data
              : {};
            const userId = asString(validationBody.user_id || "");
            if (userId) {
              profile = normalizeProfileShape({
                ...profile,
                twitchBroadcasterId: userId
              });
            }
          } catch {
            // Keep flow success even if validation probe fails.
          }
        }

        setProfile(profile);
        persistProfile("device_poll_authorized");
        deviceFlow = {
          ...deviceFlow,
          status: "connected",
          completedAt: nowMs,
          lastError: "",
          nextPollAt: 0
        };
        setDeviceFlow(deviceFlow);
        return {
          ok: true,
          deviceFlow: buildPublicDeviceFlowSnapshot(deviceFlow)
        };
      }

      const errorToken = asString(body.error || body.message || "");
      if (errorToken === "authorization_pending") {
        const nextPoll = nowMs + (clampInt(deviceFlow.intervalSec, 2, 30, 5) * 1000);
        deviceFlow = {
          ...deviceFlow,
          status: "pending",
          nextPollAt: nextPoll,
          lastError: ""
        };
        setDeviceFlow(deviceFlow);
        return {
          ok: true,
          deviceFlow: buildPublicDeviceFlowSnapshot(deviceFlow)
        };
      }
      if (errorToken === "slow_down") {
        const intervalSec = clampInt((Number(deviceFlow.intervalSec || 5) + 5), 2, 45, 10);
        deviceFlow = {
          ...deviceFlow,
          status: "pending",
          intervalSec,
          nextPollAt: nowMs + (intervalSec * 1000),
          lastError: ""
        };
        setDeviceFlow(deviceFlow);
        return {
          ok: true,
          deviceFlow: buildPublicDeviceFlowSnapshot(deviceFlow)
        };
      }
      if (errorToken === "expired_token") {
        deviceFlow = {
          ...deviceFlow,
          status: "expired",
          completedAt: nowMs,
          lastError: "device_flow_expired_token"
        };
        setDeviceFlow(deviceFlow);
        return {
          ok: true,
          deviceFlow: buildPublicDeviceFlowSnapshot(deviceFlow)
        };
      }
      if (errorToken === "access_denied") {
        deviceFlow = {
          ...deviceFlow,
          status: "error",
          completedAt: nowMs,
          lastError: "device_flow_access_denied"
        };
        setDeviceFlow(deviceFlow);
        return {
          ok: true,
          deviceFlow: buildPublicDeviceFlowSnapshot(deviceFlow)
        };
      }
      deviceFlow = {
        ...deviceFlow,
        status: "error",
        completedAt: nowMs,
        lastError: errorToken || `device_flow_poll_http_${response.status}`
      };
      setDeviceFlow(deviceFlow);
      return {
        ok: true,
        deviceFlow: buildPublicDeviceFlowSnapshot(deviceFlow)
      };
    } catch (error) {
      deviceFlow = {
        ...deviceFlow,
        status: "pending",
        nextPollAt: nowMs + (clampInt(deviceFlow.intervalSec, 2, 30, 5) * 1000),
        lastError: asString(error?.message || "device_flow_poll_failed")
      };
      setDeviceFlow(deviceFlow);
      return {
        ok: true,
        deviceFlow: buildPublicDeviceFlowSnapshot(deviceFlow)
      };
    }
  }

  async function getDeviceStatus(optionsInput = {}) {
    const source = optionsInput && typeof optionsInput === "object" && !Array.isArray(optionsInput) ? optionsInput : {};
    if (source.poll !== false) {
      await pollDeviceFlow({ force: source.force === true });
    }
    const status = getStatus();
    const flow = status.deviceFlow || {};
    return {
      ok: true,
      oauthFlow: "public_device_code",
      oauthClientType: OAUTH_CLIENT_TYPE,
      authorizeUrl: buildActivateUrl(flow.verificationUriComplete, flow.verificationUri, flow.userCode),
      userCode: asString(flow.userCode || ""),
      verificationUri: asString(flow.verificationUri || ""),
      verificationUriComplete: asString(flow.verificationUriComplete || ""),
      deviceFlow: flow,
      profile: status.profile,
      presence: status.presence,
      hasValues: status.hasValues === true,
      tokenExpiresAt: Math.max(0, Number(status.tokenExpiresAt || 0)),
      tokenIsExpired: status.tokenIsExpired === true,
      oauthVault: cloneJson(status.oauthVault, {}),
      requiredScopes: cloneJson(OAUTH_SCOPES, [])
    };
  }

  async function disconnect(input = {}) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const profile = normalizeProfileShape(getProfile());
    const clientId = asString(source.clientId || profile.twitchClientId || "");
    const token = asString(profile.twitchUserAccessToken || "");
    let revokeError = "";
    let revokeAttempted = false;
    if (clientId && token) {
      revokeAttempted = true;
      try {
        await postOAuthForm("oauth2_revoke", "/oauth2/revoke", {
          client_id: clientId,
          token
        }, {
          timeoutMs: 8_000,
          retryBudget: 0
        });
      } catch (error) {
        revokeError = asString(error?.message || "oauth_revoke_failed");
      }
    }
    setProfile(normalizeProfileShape({
      ...profile,
      twitchUserAccessToken: "",
      twitchRefreshToken: "",
      tokenExpiresAt: 0
    }));
    setDeviceFlow(createEmptyDeviceFlowState());
    persistProfile("disconnect");
    return {
      ok: true,
      revokeAttempted,
      revokeError
    };
  }

  return {
    startDeviceFlow,
    pollDeviceFlow,
    getDeviceStatus,
    disconnect
  };
};
