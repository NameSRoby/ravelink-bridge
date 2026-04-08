// [TITLE] Module: domains/internet-gateway/gateway.policy.defaults.js
// [TITLE] Purpose: default allowlist policy template for internet gateway startup bootstrapping

function createDefaultGatewayPolicy() {
  return {
    schemaVersion: 1,
    defaultDeny: true,
    rules: [
      {
        id: "twitch_oauth",
        serviceKey: "twitch_oauth",
        scheme: "https",
        hosts: ["id.twitch.tv"],
        methods: ["GET", "POST"],
        pathPrefixes: [
          "/oauth2/validate",
          "/oauth2/token",
          "/oauth2/device",
          "/oauth2/revoke"
        ],
        timeoutMs: 8_000,
        retryBudget: 1,
        concurrencyCap: 20,
        circuitBreakerFailureThreshold: 4,
        circuitBreakerCooldownMs: 15_000,
        tlsMinVersion: "TLSv1.2",
        allowRedirects: false
      },
      {
        id: "twitch_api",
        serviceKey: "twitch_api",
        scheme: "https",
        hosts: ["api.twitch.tv"],
        methods: ["GET", "PATCH"],
        pathPrefixes: [
          "/helix/channel_points/custom_rewards",
          "/helix/users"
        ],
        timeoutMs: 8_000,
        retryBudget: 1,
        concurrencyCap: 20,
        circuitBreakerFailureThreshold: 4,
        circuitBreakerCooldownMs: 15_000,
        tlsMinVersion: "TLSv1.2",
        allowRedirects: false
      }
    ]
  };
}

module.exports = {
  createDefaultGatewayPolicy
};
