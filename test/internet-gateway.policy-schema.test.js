// [TITLE] Test Module: test/internet-gateway.policy-schema.test.js
// [TITLE] Purpose: verify internet gateway allowlist policy normalization + deny rules

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  INTERNET_GATEWAY_POLICY_SCHEMA_VERSION,
  normalizeGatewayPolicy,
  validateGatewayPolicy,
  doesPolicyAllowRequest
} = require("../src/domains/internet-gateway/gateway.policy.schema");

test("gateway policy schema normalizes allowlist rules", () => {
  const normalized = normalizeGatewayPolicy({
    schemaVersion: 1,
    defaultDeny: true,
    rules: [
      {
        id: "twitch_api_rule",
        serviceKey: "twitch_api",
        scheme: "https",
        hosts: ["api.twitch.tv"],
        methods: ["get", "patch"],
        pathPrefixes: ["/helix/channel_points/custom_rewards", "/helix/users"],
        timeoutMs: 9000,
        retryBudget: 2
      }
    ]
  });

  assert.equal(normalized.schemaVersion, INTERNET_GATEWAY_POLICY_SCHEMA_VERSION);
  assert.equal(normalized.rules.length, 1);
  assert.equal(normalized.rules[0].methods.includes("PATCH"), true);
  assert.equal(normalized.rules[0].circuitBreakerFailureThreshold, 4);
  assert.equal(normalized.rules[0].circuitBreakerCooldownMs, 15000);
});

test("gateway policy schema validates required rule fields", () => {
  const invalid = validateGatewayPolicy({
    defaultDeny: true,
    rules: [{ serviceKey: "twitch_api", methods: ["GET"], pathPrefixes: ["/helix"] }]
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error, "gateway_policy_invalid");
});

test("gateway policy allow check accepts valid typed request", () => {
  const policy = {
    defaultDeny: true,
    rules: [
      {
        serviceKey: "twitch_api",
        hosts: ["api.twitch.tv"],
        methods: ["GET", "PATCH"],
        pathPrefixes: ["/helix/channel_points/custom_rewards/redemptions"]
      }
    ]
  };
  const decision = doesPolicyAllowRequest(policy, {
    target: {
      serviceKey: "twitch_api",
      method: "PATCH",
      path: "/helix/channel_points/custom_rewards/redemptions"
    }
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.serviceKey, "twitch_api");
});

test("gateway policy allow check denies path outside allowlist", () => {
  const policy = {
    defaultDeny: true,
    rules: [
      {
        serviceKey: "twitch_api",
        hosts: ["api.twitch.tv"],
        methods: ["GET", "PATCH"],
        pathPrefixes: ["/helix/channel_points/custom_rewards/redemptions"]
      }
    ]
  };
  const decision = doesPolicyAllowRequest(policy, {
    target: {
      serviceKey: "twitch_api",
      method: "PATCH",
      path: "/helix/moderation/banned"
    }
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.error, "policy_denied");
});
