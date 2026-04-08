const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const createSystemOauthService = require("../src/domains/system/system-oauth.service");

test("getStatus reports Helix incomplete when user token is missing", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-oauth-status-missing-token-"));
  const service = createSystemOauthService({
    vaultPath: path.join(tmpRoot, "oauth.vault.json"),
    profileDefaults: {
      twitchClientId: "client-a",
      twitchBroadcasterId: "12345",
      twitchUserAccessToken: ""
    }
  });

  const status = service.getStatus();
  assert.equal(status?.helix?.ready, false);
  assert.equal(status?.helix?.reason, "missing_user_access_token");
  assert.equal(status?.helix?.detail, "Missing userAccessToken.");
});

test("getStatus reports Helix incomplete when the token is expired and no refresh token exists", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-oauth-status-expired-token-"));
  const service = createSystemOauthService({
    vaultPath: path.join(tmpRoot, "oauth.vault.json"),
    profileDefaults: {
      twitchClientId: "client-a",
      twitchBroadcasterId: "12345",
      twitchUserAccessToken: "token-a",
      tokenExpiresAt: Date.now() - 60_000
    }
  });

  const status = service.getStatus();
  assert.equal(status?.helix?.ready, false);
  assert.equal(status?.helix?.reason, "token_expired_refresh_missing");
});

test("reconcilePendingRedemptions auto-discovers manageable rewards and fulfills pending redemptions", async () => {
  const getCalls = [];
  const patchCalls = [];
  const httpClient = {
    async post() {
      throw new Error("unexpected_post");
    },
    async get(url, config = {}) {
      getCalls.push({ url, params: config.params });
      if (String(url).includes("/custom_rewards/redemptions")) {
        return {
          status: 200,
          data: {
            data: [
              { id: "red-1", status: "UNFULFILLED" },
              { id: "red-2", status: "UNFULFILLED" }
            ],
            pagination: {}
          }
        };
      }
      return {
        status: 200,
        data: {
          data: [{ id: "reward-1" }],
          pagination: {}
        }
      };
    },
    async patch(url, body, config = {}) {
      patchCalls.push({ url, body, params: config.params });
      return { status: 200, data: { data: [] } };
    }
  };

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-oauth-test-"));
  const service = createSystemOauthService({
    vaultPath: path.join(tmpRoot, "oauth.vault.json"),
    profileDefaults: {
      twitchClientId: "client-a",
      twitchBroadcasterId: "12345",
      twitchUserAccessToken: "token-a"
    },
    httpClient
  });

  const result = await service.reconcilePendingRedemptions({
    status: "FULFILLED",
    maxRewards: 5,
    maxRedemptions: 10,
    twitchClientId: "client-a",
    twitchBroadcasterId: "12345",
    twitchUserAccessToken: "token-a"
  });

  assert.equal(result?.ok, true);
  assert.equal(result?.resolved, 2);
  assert.equal(result?.failed, 0);
  assert.equal(result?.statusApplied, "FULFILLED");
  assert.equal(getCalls.length >= 2, true);
  assert.equal(patchCalls.length, 2);
  assert.equal(patchCalls[0]?.params?.reward_id, "reward-1");
  assert.equal(patchCalls[0]?.body?.status, "FULFILLED");
});

test("patchRedemptionStatus retries transient Helix failures and eventually succeeds", async () => {
  const patchCalls = [];
  const sleepCalls = [];
  const httpClient = {
    async post() {
      throw new Error("unexpected_post");
    },
    async get() {
      throw new Error("unexpected_get");
    },
    async patch(url, body, config = {}) {
      patchCalls.push({ url, body, params: config.params });
      if (patchCalls.length === 1) {
        return {
          status: 503,
          headers: {
            "retry-after": "0"
          },
          data: {
            error: "service_unavailable"
          }
        };
      }
      return {
        status: 200,
        headers: {},
        data: {
          data: []
        }
      };
    }
  };

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-oauth-retry-test-"));
  const service = createSystemOauthService({
    vaultPath: path.join(tmpRoot, "oauth.vault.json"),
    profileDefaults: {
      twitchClientId: "client-a",
      twitchBroadcasterId: "12345",
      twitchUserAccessToken: "token-a"
    },
    httpClient,
    helixSleeper: async delayMs => {
      sleepCalls.push(Number(delayMs || 0));
    },
    helixRandom: () => 0
  });

  const result = await service.patchRedemptionStatus({
    rewardId: "reward-1",
    redemptionId: "red-1",
    status: "FULFILLED",
    reason: "test_retry_path",
    twitchClientId: "client-a",
    twitchBroadcasterId: "12345",
    twitchUserAccessToken: "token-a"
  });

  assert.equal(result?.ok, true);
  assert.equal(result?.statusApplied, "FULFILLED");
  assert.equal(result?.attempts, 2);
  assert.equal(patchCalls.length, 2);
  assert.equal(sleepCalls.length, 1);
});

test("patchRedemptionStatus uses internet gateway client lane when available", async () => {
  const gatewayCalls = [];
  const httpClient = {
    async post() {
      throw new Error("unexpected_post");
    },
    async get() {
      throw new Error("unexpected_get");
    },
    async patch() {
      throw new Error("unexpected_patch");
    }
  };
  const internetGatewayClient = {
    async request(payload = {}) {
      gatewayCalls.push(payload);
      if (payload?.operation === "oauth2_device_start") {
        return {
          ok: true,
          status: 200,
          requestId: payload.requestId,
          result: {
            status: 200,
            body: {
              user_code: "ABCD-EFGH",
              device_code: "device-1",
              verification_uri: "https://www.twitch.tv/activate",
              verification_uri_complete: "https://www.twitch.tv/activate?device-code=ABCD-EFGH",
              interval: 2,
              expires_in: 600
            },
            headers: {},
            attempts: 1
          }
        };
      }
      if (payload?.operation === "oauth2_device_poll") {
        return {
          ok: true,
          status: 200,
          requestId: payload.requestId,
          result: {
            status: 200,
            body: {
              access_token: "token-device",
              refresh_token: "refresh-device",
              expires_in: 3600
            },
            headers: {},
            attempts: 1
          }
        };
      }
      return {
        ok: true,
        status: 200,
        requestId: payload.requestId,
        result: {
          status: 200,
          body: {
            ok: true
          },
          headers: {},
          attempts: 1
        }
      };
    }
  };

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-oauth-gateway-patch-"));
  const service = createSystemOauthService({
    vaultPath: path.join(tmpRoot, "oauth.vault.json"),
    profileDefaults: {
      twitchClientId: "client-a",
      twitchBroadcasterId: "12345",
      twitchUserAccessToken: "token-a"
    },
    httpClient,
    internetGatewayClient
  });

  const result = await service.patchRedemptionStatus({
    rewardId: "reward-1",
    redemptionId: "red-1",
    status: "FULFILLED",
    reason: "gateway_lane",
    twitchClientId: "client-a",
    twitchBroadcasterId: "12345",
    twitchUserAccessToken: "token-a"
  });

  assert.equal(result?.ok, true);
  assert.equal(result?.statusApplied, "FULFILLED");
  assert.equal(gatewayCalls.length, 1);
  assert.equal(gatewayCalls[0]?.target?.serviceKey, "twitch_api");
  assert.equal(gatewayCalls[0]?.target?.path, "/helix/channel_points/custom_rewards/redemptions");
});

test("device flow poll uses internet gateway validate lane to infer broadcaster id", async () => {
  const gatewayCalls = [];
  const httpClient = {
    async post(url) {
      if (String(url).includes("/oauth2/device")) {
        return {
          status: 200,
          data: {
            user_code: "ABCD-EFGH",
            device_code: "device-1",
            verification_uri: "https://www.twitch.tv/activate",
            verification_uri_complete: "https://www.twitch.tv/activate?device-code=ABCD-EFGH",
            interval: 2,
            expires_in: 600
          }
        };
      }
      if (String(url).includes("/oauth2/token")) {
        return {
          status: 200,
          data: {
            access_token: "token-device",
            refresh_token: "refresh-device",
            expires_in: 3600
          }
        };
      }
      throw new Error("unexpected_post_url");
    },
    async get() {
      throw new Error("unexpected_get");
    },
    async patch() {
      throw new Error("unexpected_patch");
    }
  };
  const internetGatewayClient = {
    async request(payload = {}) {
      gatewayCalls.push(payload);
      if (payload?.operation === "oauth2_device_start") {
        return {
          ok: true,
          status: 200,
          requestId: payload.requestId,
          result: {
            status: 200,
            body: {
              user_code: "ABCD-EFGH",
              device_code: "device-1",
              verification_uri: "https://www.twitch.tv/activate",
              verification_uri_complete: "https://www.twitch.tv/activate?device-code=ABCD-EFGH",
              interval: 2,
              expires_in: 600
            },
            headers: {},
            attempts: 1
          }
        };
      }
      if (payload?.operation === "oauth2_device_poll") {
        return {
          ok: true,
          status: 200,
          requestId: payload.requestId,
          result: {
            status: 200,
            body: {
              access_token: "token-device",
              refresh_token: "refresh-device",
              expires_in: 3600
            },
            headers: {},
            attempts: 1
          }
        };
      }
      return {
        ok: true,
        status: 200,
        requestId: payload.requestId,
        result: {
          status: 200,
          body: {
            user_id: "broadcaster-77"
          },
          headers: {},
          attempts: 1
        }
      };
    }
  };

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-oauth-gateway-validate-"));
  const service = createSystemOauthService({
    vaultPath: path.join(tmpRoot, "oauth.vault.json"),
    profileDefaults: {
      twitchClientId: "client-a",
      twitchBroadcasterId: "",
      twitchUserAccessToken: ""
    },
    httpClient,
    internetGatewayClient
  });

  const started = await service.startDeviceFlow({
    clientId: "client-a"
  });
  assert.equal(started?.ok, true);
  const status = await service.getDeviceStatus({
    force: true
  });
  assert.equal(status?.ok, true);
  assert.equal(status?.deviceFlow?.status, "connected");
  assert.equal(status?.presence?.twitchBroadcasterId, true);
  assert.equal(gatewayCalls.length, 3);
  assert.equal(gatewayCalls.some(call => call?.operation === "oauth2_device_start"), true);
  assert.equal(gatewayCalls.some(call => call?.operation === "oauth2_device_poll"), true);
  assert.equal(gatewayCalls.some(call => call?.operation === "oauth2_validate"), true);
});

test("startDeviceFlow uses internet gateway oauth device lane when available", async () => {
  const gatewayCalls = [];
  const httpClient = {
    async post() {
      throw new Error("unexpected_post");
    },
    async get() {
      throw new Error("unexpected_get");
    },
    async patch() {
      throw new Error("unexpected_patch");
    }
  };
  const internetGatewayClient = {
    async request(payload = {}) {
      gatewayCalls.push(payload);
      return {
        ok: true,
        status: 200,
        requestId: payload.requestId,
        result: {
          status: 200,
          body: {
            user_code: "ABCD-EFGH",
            device_code: "device-22",
            verification_uri: "https://www.twitch.tv/activate",
            verification_uri_complete: "https://www.twitch.tv/activate?device-code=ABCD-EFGH",
            interval: 2,
            expires_in: 600
          },
          headers: {},
          attempts: 1
        }
      };
    }
  };

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-oauth-gateway-device-start-"));
  const service = createSystemOauthService({
    vaultPath: path.join(tmpRoot, "oauth.vault.json"),
    profileDefaults: {
      twitchClientId: "client-a"
    },
    httpClient,
    internetGatewayClient
  });

  const started = await service.startDeviceFlow({
    clientId: "client-a"
  });
  assert.equal(started?.ok, true);
  assert.equal(started?.oauthFlow, "public_device_code");
  assert.equal(gatewayCalls.length, 1);
  assert.equal(gatewayCalls[0]?.target?.serviceKey, "twitch_oauth");
  assert.equal(gatewayCalls[0]?.target?.path, "/oauth2/device");
  assert.equal(gatewayCalls[0]?.operation, "oauth2_device_start");
});

test("startDeviceFlow does not direct-fallback when gateway lane is present but unavailable", async () => {
  let httpPostCalled = false;
  const httpClient = {
    async post() {
      httpPostCalled = true;
      throw new Error("unexpected_direct_http_post");
    },
    async get() {
      throw new Error("unexpected_get");
    },
    async patch() {
      throw new Error("unexpected_patch");
    }
  };
  const internetGatewayClient = {
    async request() {
      throw new Error("gateway_offline");
    }
  };

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-oauth-gateway-no-fallback-"));
  const service = createSystemOauthService({
    vaultPath: path.join(tmpRoot, "oauth.vault.json"),
    profileDefaults: {
      twitchClientId: "client-a"
    },
    httpClient,
    internetGatewayClient
  });

  const started = await service.startDeviceFlow({
    clientId: "client-a"
  });
  assert.equal(started?.ok, false);
  assert.equal(started?.error, "gateway_offline");
  assert.equal(httpPostCalled, false);
});

test("reconcilePendingRedemptions uses internet gateway lane for Helix list and patch calls", async () => {
  const gatewayCalls = [];
  const httpClient = {
    async post() {
      throw new Error("unexpected_post");
    },
    async get() {
      throw new Error("unexpected_get");
    },
    async patch() {
      throw new Error("unexpected_patch");
    }
  };
  const internetGatewayClient = {
    async request(payload = {}) {
      gatewayCalls.push(payload);
      const path = String(payload?.target?.path || "");
      const method = String(payload?.target?.method || "").toUpperCase();
      if (path === "/helix/channel_points/custom_rewards" && method === "GET") {
        return {
          ok: true,
          status: 200,
          requestId: payload.requestId,
          result: {
            status: 200,
            body: {
              data: [{ id: "reward-1" }],
              pagination: {}
            },
            headers: {},
            attempts: 1
          }
        };
      }
      if (path === "/helix/channel_points/custom_rewards/redemptions" && method === "GET") {
        return {
          ok: true,
          status: 200,
          requestId: payload.requestId,
          result: {
            status: 200,
            body: {
              data: [{ id: "red-1", status: "UNFULFILLED" }],
              pagination: {}
            },
            headers: {},
            attempts: 1
          }
        };
      }
      if (path === "/helix/channel_points/custom_rewards/redemptions" && method === "PATCH") {
        return {
          ok: true,
          status: 200,
          requestId: payload.requestId,
          result: {
            status: 200,
            body: {
              data: []
            },
            headers: {},
            attempts: 1
          }
        };
      }
      throw new Error(`unexpected_gateway_request:${method}:${path}`);
    }
  };

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-oauth-gateway-reconcile-"));
  const service = createSystemOauthService({
    vaultPath: path.join(tmpRoot, "oauth.vault.json"),
    profileDefaults: {
      twitchClientId: "client-a",
      twitchBroadcasterId: "12345",
      twitchUserAccessToken: "token-a"
    },
    httpClient,
    internetGatewayClient
  });

  const result = await service.reconcilePendingRedemptions({
    status: "FULFILLED",
    maxRewards: 5,
    maxRedemptions: 5
  });

  assert.equal(result?.ok, true);
  assert.equal(result?.resolved, 1);
  assert.equal(gatewayCalls.length >= 3, true);
  assert.equal(gatewayCalls.some(call => call?.operation === "helix_list_manageable_rewards"), true);
  assert.equal(gatewayCalls.some(call => call?.operation === "helix_list_pending_redemptions"), true);
  assert.equal(gatewayCalls.some(call => call?.operation === "patch_redemption_status"), true);
});
