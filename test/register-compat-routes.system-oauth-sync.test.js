// [TITLE] Test Module: test/register-compat-routes.system-oauth-sync.test.js
// [TITLE] Purpose: verify System OAuth -> mod sync and widget fallback mod-profile wiring

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const registerCompatRoutes = require("../src/app/register-compat-routes");

function toUrl(baseUrl, routePath = "/") {
  const normalized = String(routePath || "/").startsWith("/")
    ? String(routePath || "/")
    : `/${String(routePath || "")}`;
  return `${String(baseUrl || "").replace(/\/+$/, "")}${normalized}`;
}

async function requestJson(baseUrl, method, routePath, body = null) {
  const response = await fetch(toUrl(baseUrl, routePath), {
    method,
    headers: {
      "Content-Type": "application/json",
      Connection: "close"
    },
    body: body === null ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { __raw: text };
  }
  return {
    ok: response.ok,
    status: response.status,
    data
  };
}

function createDeps(overrides = {}) {
  return {
    enforceWriteAccess(_req, _res, next) {
      next();
    },
    midiManager: {
      getStatus: () => ({ ok: true }),
      refreshStatus: () => ({ ok: true, status: { ok: true } }),
      patchConfig: () => ({ ok: true, status: { ok: true } }),
      cancelLearn: () => ({ ok: true, status: { ok: true } }),
      armLearn: () => ({ ok: true, status: { ok: true } }),
      triggerAction: () => ({ ok: true, status: { ok: true } }),
      resetBindings: () => ({ ok: true, status: { ok: true } }),
      saveBinding: () => ({ ok: true, status: { ok: true } }),
      clearBinding: () => ({ ok: true, status: { ok: true } })
    },
    modRuntime: {
      list: () => ({ ok: true, mods: [{ id: "music-request-engine", enabled: true, loaded: true }] }),
      getSupportedHooks: () => [],
      getUiCatalog: () => ({ ok: true, mods: [] }),
      reload: async () => ({ ok: true }),
      setDebugEnabled: () => ({ ok: true }),
      clearDebugBuffer: () => ({ ok: true }),
      importMods: async () => ({ ok: true }),
      updateConfig: async () => ({ ok: true }),
      invokeAction: async () => ({ status: 200, body: { ok: true } }),
      handleHttp: async () => ({ status: 200, body: { ok: true } }),
      resolveUiAsset: () => ({ ok: false, error: "mod_ui_not_found" })
    },
    fixtureRegistry: {
      getFixtures: () => [],
      getIntentRoutes: () => ({}),
      load: () => {},
      upsertFixture: fixture => ({ ok: true, fixture }),
      deleteFixture: () => ({ ok: true }),
      getConnectivitySnapshot: () => ({ ok: true, rows: [] }),
      testConnectivity: () => ({ ok: true })
    },
    liveCompatService: {
      getCompatibility: () => ({ ok: true, snapshot: {} }),
      patchCompatibility: () => ({ ok: true }),
      getTriggerMatrix: () => ({ ok: true }),
      patchTriggerMatrix: () => ({ ok: true }),
      getPaletteSnapshot: () => ({ ok: true }),
      patchPalette: () => ({ ok: true }),
      getFixtureMetricsSnapshot: () => ({ ok: true }),
      patchFixtureMetrics: () => ({ ok: true }),
      clearFixtureRouting: () => ({ ok: true }),
      getOverclockTiers: () => ({ ok: true, tiers: [] }),
      setOverclockAuto: () => ({ ok: true }),
      setOverclockPresetLevel: () => ({ ok: true }),
      setOverclockDevHz: () => ({ ok: true })
    },
    systemConfigService: {
      getConfig: () => ({ ok: true, config: {} }),
      patchConfig: () => ({ ok: true, config: {} }),
      getOauthDevStatus: () => ({ ok: true, hasValues: false, presence: {} }),
      getOauthDevProfileForInternal: () => ({ twitchClientId: "", twitchUserAccessToken: "", twitchBroadcasterId: "" }),
      generateWidgetTemplate: payload => ({ ok: true, script: "", active: payload })
    },
    systemOauthService: {
      getStatus: () => ({ ok: true, hasValues: true, presence: { twitchClientId: true, twitchBroadcasterId: true, twitchUserAccessToken: true } }),
      getProfileForInternal: () => ({
        twitchClientId: "client-from-system",
        twitchUserAccessToken: "token-from-system",
        twitchBroadcasterId: "987654"
      })
    },
    audioEngine: {
      getStatus: () => ({ backend: "unwired", telemetryUpdatedAt: 0 }),
      getRaveState: () => ({ active: false, startedAt: 0, lastStoppedAt: 0 }),
      stopRave: () => ({ ok: true })
    },
    hueBridge: {
      discoverBridges: async () => ({ ok: true, bridges: [] }),
      pairBridge: async () => ({ ok: false, error: "not_configured" })
    },
    wizBridge: {
      discoverDevices: async () => ({ ok: true, devices: [] })
    },
    startupReadinessService: {
      getSnapshot: () => ({
        ok: true,
        generatedAt: Date.now(),
        current: {
          capturedAt: Date.now(),
          summary: {
            laneCount: 6,
            readyCount: 6,
            blocking: [],
            states: {
              config: "loaded",
              profiles: "loaded",
              mods: "loaded",
              midi: "loaded",
              hue: "loaded",
              wiz: "loaded"
            }
          }
        }
      })
    },
    startupLaunchDiagnosticsService: {
      getSnapshot: () => ({
        bootedAt: 1,
        updatedAt: 2,
        lastOutcome: "launched",
        lastReason: "launch_ok"
      })
    },
    ...overrides
  };
}

async function withCompatServer(deps, run) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));
  registerCompatRoutes(app, deps);
  const listener = await new Promise(resolve => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
  const address = listener.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise(resolve => listener.close(resolve));
  }
}

test("/system/oauth/sync-to-mod applies system profile to mod policy patch", async () => {
  const calls = [];
  const deps = createDeps({
    modRuntime: {
      list: () => ({ ok: true, mods: [{ id: "music-request-engine", enabled: true, loaded: true }] }),
      getSupportedHooks: () => [],
      getUiCatalog: () => ({ ok: true, mods: [] }),
      reload: async () => ({ ok: true }),
      setDebugEnabled: () => ({ ok: true }),
      clearDebugBuffer: () => ({ ok: true }),
      importMods: async () => ({ ok: true }),
      updateConfig: async () => ({ ok: true }),
      invokeAction: async (modId, action, method, payload) => {
        calls.push({ modId, action, method, payload });
        return { status: 200, body: { ok: true } };
      },
      handleHttp: async () => ({ status: 200, body: { ok: true } }),
      resolveUiAsset: () => ({ ok: false, error: "mod_ui_not_found" })
    }
  });

  await withCompatServer(deps, async baseUrl => {
    const response = await requestJson(baseUrl, "POST", "/system/oauth/sync-to-mod", {});
    assert.equal(response.status, 200);
    assert.equal(response.data?.ok, true);
    assert.equal(response.data?.targetModId, "music-request-engine");
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, "admin_policy_set");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].payload?.body?.patch?.twitchRefund, {
    enabled: true,
    clientId: "client-from-system",
    userAccessToken: "token-from-system",
    broadcasterId: "987654"
  });
});

test("/system/widget-template-get can fall back to oauth profile from mod state", async () => {
  let capturedPayload = null;
  const deps = createDeps({
    systemOauthService: {
      getStatus: () => ({ ok: true, hasValues: false, presence: {} }),
      getProfileForInternal: () => ({})
    },
    systemConfigService: {
      getConfig: () => ({ ok: true, config: {} }),
      patchConfig: () => ({ ok: true, config: {} }),
      getOauthDevStatus: () => ({ ok: true, hasValues: false, presence: {} }),
      getOauthDevProfileForInternal: () => ({}),
      generateWidgetTemplate: payload => {
        capturedPayload = payload;
        return { ok: true, script: "", active: payload };
      }
    },
    modRuntime: {
      list: () => ({ ok: true, mods: [{ id: "music-request-engine", enabled: true, loaded: true }] }),
      getSupportedHooks: () => [],
      getUiCatalog: () => ({ ok: true, mods: [] }),
      reload: async () => ({ ok: true }),
      setDebugEnabled: () => ({ ok: true }),
      clearDebugBuffer: () => ({ ok: true }),
      importMods: async () => ({ ok: true }),
      updateConfig: async () => ({ ok: true }),
      invokeAction: async (_modId, action) => {
        if (action === "state") {
          return {
            status: 200,
            body: {
              ok: true,
              result: {
                config: {
                  twitchRefund: {
                    clientId: "mod-client-id",
                    userAccessToken: "mod-token",
                    broadcasterId: "445566"
                  }
                }
              }
            }
          };
        }
        return { status: 200, body: { ok: true } };
      },
      handleHttp: async () => ({ status: 200, body: { ok: true } }),
      resolveUiAsset: () => ({ ok: false, error: "mod_ui_not_found" })
    }
  });

  await withCompatServer(deps, async baseUrl => {
    const response = await requestJson(baseUrl, "POST", "/system/widget-template-get", {
      twitchStatusSyncEnabled: true
    });
    assert.equal(response.status, 200);
    assert.equal(response.data?.ok, true);
  });

  assert.equal(typeof capturedPayload, "object");
  assert.equal(capturedPayload?.twitchClientId, "mod-client-id");
  assert.equal(capturedPayload?.twitchUserAccessToken, "mod-token");
  assert.equal(capturedPayload?.twitchBroadcasterId, "445566");
});

test("/system/widget-redemption-status forwards payload to system oauth service", async () => {
  const seedCalls = [];
  const patchCalls = [];
  const deps = createDeps({
    systemOauthService: {
      seedProfile: (input, options) => {
        seedCalls.push({ input, options });
        return { ok: true };
      },
      patchRedemptionStatus: async payload => {
        patchCalls.push(payload);
        return {
          ok: true,
          status: 200,
          synced: true,
          rewardId: String(payload.rewardId || ""),
          redemptionId: String(payload.redemptionId || ""),
          broadcasterId: String(payload.broadcasterId || ""),
          statusApplied: String(payload.status || "")
        };
      }
    }
  });

  await withCompatServer(deps, async baseUrl => {
    const response = await requestJson(baseUrl, "POST", "/system/widget-redemption-status", {
      rewardId: "reward-color",
      redemptionId: "redemption-100",
      status: "FULFILLED",
      reason: "ok",
      twitchClientId: "client-a",
      twitchBroadcasterId: "12345",
      twitchUserAccessToken: "token-a"
    });
    assert.equal(response.status, 200);
    assert.equal(response.data?.ok, true);
    assert.equal(response.data?.statusApplied, "FULFILLED");
  });

  assert.equal(seedCalls.length, 1);
  assert.equal(seedCalls[0]?.input?.twitchClientId, "client-a");
  assert.equal(seedCalls[0]?.input?.twitchBroadcasterId, "12345");
  assert.equal(seedCalls[0]?.input?.twitchUserAccessToken, "token-a");
  assert.equal(patchCalls.length, 1);
  assert.deepEqual(patchCalls[0], {
    rewardId: "reward-color",
    redemptionId: "redemption-100",
    broadcasterId: "12345",
    status: "FULFILLED",
    reason: "ok"
  });
});

test("/system/widget-redemption-status rejects invalid status", async () => {
  const deps = createDeps({
    systemOauthService: {
      patchRedemptionStatus: async () => ({ ok: true, status: 200, synced: true })
    }
  });

  await withCompatServer(deps, async baseUrl => {
    const response = await requestJson(baseUrl, "POST", "/system/widget-redemption-status", {
      rewardId: "reward-color",
      redemptionId: "redemption-100",
      status: "pending"
    });
    assert.equal(response.status, 400);
    assert.equal(response.data?.ok, false);
    assert.equal(response.data?.error, "widget_status_sync_invalid_status");
  });
});

test("/system/widget-redemption-reconcile forwards payload to system oauth service", async () => {
  const seedCalls = [];
  const reconcileCalls = [];
  const deps = createDeps({
    systemOauthService: {
      seedProfile: (input, options) => {
        seedCalls.push({ input, options });
        return { ok: true };
      },
      reconcilePendingRedemptions: async payload => {
        reconcileCalls.push(payload);
        return {
          ok: true,
          status: 200,
          synced: true,
          reconcile: true,
          statusApplied: payload.status,
          resolved: 3,
          failed: 0
        };
      }
    }
  });

  await withCompatServer(deps, async baseUrl => {
    const response = await requestJson(baseUrl, "POST", "/system/widget-redemption-reconcile", {
      status: "canceled",
      reason: "auto_refund",
      rewardIds: ["rw-1", "rw-2"],
      maxRewards: 10,
      maxRedemptions: 20,
      twitchClientId: "client-a",
      twitchBroadcasterId: "12345",
      twitchUserAccessToken: "token-a"
    });
    assert.equal(response.status, 200);
    assert.equal(response.data?.ok, true);
    assert.equal(response.data?.statusApplied, "CANCELED");
  });

  assert.equal(seedCalls.length, 1);
  assert.equal(seedCalls[0]?.input?.twitchClientId, "client-a");
  assert.equal(seedCalls[0]?.input?.twitchBroadcasterId, "12345");
  assert.equal(seedCalls[0]?.input?.twitchUserAccessToken, "token-a");
  assert.equal(reconcileCalls.length, 1);
  assert.deepEqual(reconcileCalls[0], {
    status: "CANCELED",
    reason: "auto_refund",
    rewardIds: ["rw-1", "rw-2"],
    maxRewards: 10,
    maxRedemptions: 20
  });
});

test("/system/widget-redemption-reconcile returns 503 when oauth service is unavailable", async () => {
  const deps = createDeps({
    systemOauthService: {
      patchRedemptionStatus: async () => ({ ok: true })
    }
  });

  await withCompatServer(deps, async baseUrl => {
    const response = await requestJson(baseUrl, "POST", "/system/widget-redemption-reconcile", {
      status: "FULFILLED"
    });
    assert.equal(response.status, 503);
    assert.equal(response.data?.ok, false);
    assert.equal(response.data?.error, "system_oauth_status_sync_unavailable");
  });
});

test("/system/widget-redemption-reconcile-status returns runtime snapshot", async () => {
  const deps = createDeps({
    systemOauthService: {
      getAutoReconcileStatus: () => ({
        enabled: true,
        inFlight: false,
        intervalMs: 45000
      })
    }
  });

  await withCompatServer(deps, async baseUrl => {
    const response = await requestJson(baseUrl, "GET", "/system/widget-redemption-reconcile-status");
    assert.equal(response.status, 200);
    assert.equal(response.data?.ok, true);
    assert.equal(response.data?.reconcile?.enabled, true);
    assert.equal(response.data?.reconcile?.intervalMs, 45000);
  });
});
