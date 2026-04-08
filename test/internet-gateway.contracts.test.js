// [TITLE] Test Module: test/internet-gateway.contracts.test.js
// [TITLE] Purpose: verify strict typed gateway IPC request/response validation

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  INTERNET_GATEWAY_CONTRACT_VERSION,
  normalizeGatewayRequest,
  validateGatewayRequest,
  normalizeGatewayResponse,
  validateGatewayResponse,
  validateGatewayOperationResultShape
} = require("../src/domains/internet-gateway/gateway.contracts");

test("gateway contracts normalize deterministic request envelope", () => {
  const request = normalizeGatewayRequest({
    requestId: "req-1",
    correlationId: "corr-1",
    integrationKey: "Twitch",
    operation: "patch_redemption",
    target: {
      serviceKey: "twitch_api",
      method: "patch",
      path: "/channel_points/custom_rewards/redemptions"
    },
    query: {
      broadcaster_id: "12345"
    },
    body: {
      status: "FULFILLED"
    },
    timeoutMs: 9000,
    retryBudget: 2
  });

  assert.equal(request.contractVersion, INTERNET_GATEWAY_CONTRACT_VERSION);
  assert.equal(request.target.method, "PATCH");
  assert.equal(request.target.path, "/channel_points/custom_rewards/redemptions");
  assert.equal(request.integrationKey, "twitch");
  assert.equal(request.retryBudget, 2);
});

test("gateway contracts reject raw URL request fields", () => {
  const result = validateGatewayRequest({
    requestId: "req-2",
    integrationKey: "twitch",
    operation: "bad_fetch",
    url: "https://api.twitch.tv/helix/users"
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "gateway_request_invalid");
});

test("gateway contracts validate response envelopes", () => {
  const response = normalizeGatewayResponse({
    ok: true,
    requestId: "req-3",
    status: 200,
    result: {
      statusApplied: "FULFILLED"
    }
  });
  const validated = validateGatewayResponse(response);
  assert.equal(validated.ok, true);
  assert.equal(validated.value.ok, true);
  assert.equal(validated.value.result.statusApplied, "FULFILLED");
});

test("gateway contracts require typed error payload for failed responses", () => {
  const result = validateGatewayResponse({
    ok: false,
    requestId: "req-4",
    status: 502
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.ok, false);
  assert.equal(result.value.error.code, "gateway_unavailable");
});

test("gateway contracts keep schema_invalid as typed error code", () => {
  const result = validateGatewayResponse({
    ok: false,
    requestId: "req-schema",
    status: 502,
    error: {
      code: "schema_invalid",
      detail: "bad body",
      status: 502
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.error.code, "schema_invalid");
});

test("gateway operation result shape validates oauth token payload", () => {
  const valid = validateGatewayOperationResultShape({
    operation: "oauth2_token_refresh"
  }, {
    status: 200,
    body: {
      access_token: "token-x"
    }
  });
  assert.equal(valid.ok, true);

  const invalid = validateGatewayOperationResultShape({
    operation: "oauth2_token_refresh"
  }, {
    status: 200,
    body: {
      refresh_token: "refresh-x"
    }
  });
  assert.equal(invalid.ok, false);
});
