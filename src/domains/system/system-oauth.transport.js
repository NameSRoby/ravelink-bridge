// [TITLE] Module: domains/system/system-oauth.transport.js
// [TITLE] Purpose: Twitch OAuth/Helix transport wrapper with gateway-first ownership
// [TITLE] Functionality Index:
// [TITLE] - normalize typed gateway request envelopes
// [TITLE] - map gateway responses into axios-like snapshots
// [TITLE] - provide gateway-first Twitch OAuth + Helix request helpers

const crypto = require("node:crypto");

const TWITCH_HELIX_BASE_URL = "https://api.twitch.tv/helix";
const GATEWAY_SERVICE_TWITCH_OAUTH = "twitch_oauth";
const GATEWAY_SERVICE_TWITCH_API = "twitch_api";

function asString(value) {
  return String(value ?? "").trim();
}

function clampInt(value, min, max, fallback = 0) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return Math.round(Number(fallback) || 0);
  return Math.min(Math.round(Number(max) || parsed), Math.max(Math.round(Number(min) || parsed), parsed));
}

module.exports = function createSystemOauthTransport(options = {}) {
  const httpClient = options.httpClient && typeof options.httpClient === "object" ? options.httpClient : null;
  const internetGatewayClient = (
    options.internetGatewayClient &&
    typeof options.internetGatewayClient.request === "function"
  )
    ? options.internetGatewayClient
    : null;

  function nextGatewayRequestId(operation = "") {
    const op = asString(operation || "request").toLowerCase().replace(/[^a-z0-9_:-]+/g, "_");
    return `igw_${op}_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  }

  function mapGatewayResultToHttpLikeResponse(result = {}) {
    const source = result && typeof result === "object" ? result : {};
    if (source.ok === true) {
      const body = source?.result?.body;
      return {
        status: Number(source?.result?.status || source?.status || 200),
        data: body && typeof body === "object" && !Array.isArray(body) ? body : {},
        headers: source?.result?.headers && typeof source.result.headers === "object"
          ? source.result.headers
          : {},
        __attempts: clampInt(source?.result?.attempts, 1, 12, 1),
        __viaGateway: true
      };
    }
    const errorMap = source?.error && typeof source.error === "object" ? source.error : {};
    const status = Number(errorMap.upstreamStatus || errorMap.status || source.status || 502) || 502;
    const code = asString(errorMap.code || "gateway_unavailable");
    const detail = asString(errorMap.detail || source.detail || "");
    return {
      status,
      data: {
        error: code,
        message: detail || `gateway_http_${status}`
      },
      headers: {},
      __attempts: clampInt(source?.result?.attempts, 1, 12, 1),
      __viaGateway: true,
      __gatewayErrorCode: code
    };
  }

  async function executeGatewayHttpLikeRequest(request = {}) {
    if (!internetGatewayClient) {
      return {
        handled: false,
        response: null
      };
    }
    const payload = request && typeof request === "object" && !Array.isArray(request) ? request : {};
    try {
      const result = await internetGatewayClient.request({
        requestId: asString(payload.requestId || nextGatewayRequestId(payload.operation || "gateway")),
        correlationId: asString(payload.correlationId || payload.requestId || ""),
        integrationKey: asString(payload.integrationKey || "twitch").toLowerCase() || "twitch",
        operation: asString(payload.operation || "gateway_request").toLowerCase() || "gateway_request",
        target: payload.target && typeof payload.target === "object" ? payload.target : {},
        query: payload.query && typeof payload.query === "object" ? payload.query : {},
        headers: payload.headers && typeof payload.headers === "object" ? payload.headers : {},
        body: payload.body && typeof payload.body === "object" ? payload.body : {},
        timeoutMs: clampInt(payload.timeoutMs, 250, 60_000, 8_000),
        retryBudget: clampInt(payload.retryBudget, 0, 8, 1)
      });
      return {
        handled: true,
        response: mapGatewayResultToHttpLikeResponse(result)
      };
    } catch (error) {
      return {
        handled: true,
        response: {
          status: 502,
          data: {
            error: "gateway_unavailable",
            message: asString(error?.message || "internet_gateway_request_failed")
          },
          headers: {},
          __attempts: 1,
          __viaGateway: true
        }
      };
    }
  }

  async function requestOAuthValidate(accessToken = "") {
    const token = asString(accessToken || "");
    const gatewayAttempt = await executeGatewayHttpLikeRequest({
      integrationKey: "twitch",
      operation: "oauth2_validate",
      target: {
        serviceKey: GATEWAY_SERVICE_TWITCH_OAUTH,
        method: "GET",
        path: "/oauth2/validate"
      },
      headers: {
        authorization: `OAuth ${token}`
      },
      timeoutMs: 8_000,
      retryBudget: 1
    });
    if (gatewayAttempt.handled === true) {
      return gatewayAttempt.response;
    }
    return await httpClient.get("https://id.twitch.tv/oauth2/validate", {
      headers: {
        Authorization: `OAuth ${token}`
      },
      timeout: 8_000,
      validateStatus: () => true
    });
  }

  async function postOAuthForm(operation = "", pathValue = "", form = {}, optionsInput = {}) {
    const source = optionsInput && typeof optionsInput === "object" && !Array.isArray(optionsInput) ? optionsInput : {};
    const payload = form && typeof form === "object" && !Array.isArray(form) ? form : {};
    const timeoutMs = clampInt(source.timeoutMs, 250, 60_000, 12_000);
    const retryBudget = clampInt(source.retryBudget, 0, 8, 1);
    const gatewayAttempt = await executeGatewayHttpLikeRequest({
      integrationKey: "twitch",
      operation: asString(operation || "oauth2_post_form"),
      target: {
        serviceKey: GATEWAY_SERVICE_TWITCH_OAUTH,
        method: "POST",
        path: asString(pathValue || "")
      },
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: payload,
      timeoutMs,
      retryBudget
    });
    if (gatewayAttempt.handled === true) {
      return gatewayAttempt.response;
    }
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(payload)) {
      const token = asString(key || "");
      if (!token) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          params.append(token, asString(item || ""));
        }
        continue;
      }
      params.set(token, asString(value ?? ""));
    }
    return await httpClient.post(`https://id.twitch.tv${asString(pathValue || "")}`, params.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      timeout: timeoutMs,
      validateStatus: () => true
    });
  }

  async function getHelix(context = {}, token = "", pathValue = "", query = {}, optionsInput = {}) {
    const source = optionsInput && typeof optionsInput === "object" && !Array.isArray(optionsInput) ? optionsInput : {};
    const targetPath = asString(pathValue || "");
    const requestQuery = query && typeof query === "object" && !Array.isArray(query) ? query : {};
    const timeoutMs = clampInt(source.timeoutMs, 250, 60_000, 8_000);
    const retryBudget = clampInt(source.retryBudget, 0, 8, 1);
    const operation = asString(source.operation || "helix_get").toLowerCase() || "helix_get";
    const gatewayAttempt = await executeGatewayHttpLikeRequest({
      integrationKey: "twitch",
      operation,
      target: {
        serviceKey: GATEWAY_SERVICE_TWITCH_API,
        method: "GET",
        path: targetPath
      },
      query: requestQuery,
      headers: {
        "client-id": asString(context.clientId || ""),
        authorization: `Bearer ${asString(token || "")}`,
        accept: "application/json"
      },
      timeoutMs,
      retryBudget
    });
    if (gatewayAttempt.handled === true) {
      return gatewayAttempt.response;
    }
    return await httpClient.get(`${TWITCH_HELIX_BASE_URL}${targetPath.replace(/^\/helix/, "")}`, {
      params: requestQuery,
      headers: {
        "Client-Id": context.clientId,
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      },
      timeout: timeoutMs,
      validateStatus: () => true
    });
  }

  async function patchRedemption(context = {}, patch = {}, token = "") {
    const source = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
    const gatewayAttempt = await executeGatewayHttpLikeRequest({
      integrationKey: "twitch",
      operation: "patch_redemption_status",
      target: {
        serviceKey: GATEWAY_SERVICE_TWITCH_API,
        method: "PATCH",
        path: "/helix/channel_points/custom_rewards/redemptions"
      },
      query: {
        broadcaster_id: asString(context.broadcasterId || ""),
        reward_id: asString(source.rewardId || source.reward_id || ""),
        id: asString(source.redemptionId || source.redemption_id || source.id || "")
      },
      headers: {
        "client-id": asString(context.clientId || ""),
        authorization: `Bearer ${asString(token || "")}`,
        "content-type": "application/json"
      },
      body: {
        status: asString(source.status || "").toUpperCase()
      },
      timeoutMs: 8_000,
      retryBudget: 1
    });
    if (gatewayAttempt.handled === true) {
      return gatewayAttempt.response;
    }
    return await httpClient.patch(
      `${TWITCH_HELIX_BASE_URL}/channel_points/custom_rewards/redemptions`,
      { status: asString(source.status || "").toUpperCase() },
      {
        params: {
          broadcaster_id: context.broadcasterId,
          reward_id: asString(source.rewardId || source.reward_id || ""),
          id: asString(source.redemptionId || source.redemption_id || source.id || "")
        },
        headers: {
          "Client-Id": context.clientId,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        timeout: 8_000,
        validateStatus: () => true
      }
    );
  }

  return {
    requestOAuthValidate,
    postOAuthForm,
    getHelix,
    patchRedemption
  };
};
