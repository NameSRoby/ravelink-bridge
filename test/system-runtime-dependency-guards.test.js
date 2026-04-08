const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadFactory(relativeFile, factoryName, extraContext = {}) {
  const filePath = path.resolve(__dirname, "..", relativeFile);
  const code = fs.readFileSync(filePath, "utf8");
  const context = {
    console,
    window: { location: { origin: "https://example.local" } },
    document: {},
    navigator: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    setTimeout,
    clearTimeout,
    ...extraContext
  };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: filePath });
  return context[factoryName];
}

function createSystemAdapterStub() {
  return {
    getConfig: async () => ({ ok: true, config: {} }),
    saveConfig: async () => ({ ok: true, data: { ok: true, config: {} } }),
    getRouteCatalog: async () => ({ ok: true, routes: [] }),
    requestRoute: async () => ({ ok: true, status: 200, data: {}, raw: "{}" }),
    getInternetGatewayStatus: async () => ({ ok: true }),
    getUpdateStatus: async () => ({ ok: true }),
    checkForUpdates: async () => ({ ok: true, data: { ok: true } }),
    applyUpdate: async () => ({ ok: true, data: { ok: true } }),
    getSystemOauthStatus: async () => ({ ok: true, presence: {}, hasValues: false }),
    seedSystemOauthProfile: async () => ({ ok: true, data: { ok: true } }),
    clearSystemOauthProfile: async () => ({ ok: true, data: { ok: true } }),
    startSystemOauth: async () => ({ ok: true, data: { ok: true } }),
    getSystemOauthDeviceStatus: async () => ({ ok: true, data: { ok: true } }),
    disconnectSystemOauth: async () => ({ ok: true, data: { ok: true } }),
    syncSystemOauthToMod: async () => ({ ok: true, data: { ok: true } }),
    getWidgetRedemptionReconcileStatus: async () => ({ ok: true }),
    reconcileWidgetRedemptions: async () => ({ ok: true, data: { ok: true } }),
    generateWidgetTemplate: async () => ({ ok: true, data: { ok: true, script: "" } })
  };
}

function createAudioAdapterStub() {
  return {
    getRustTransportWorkerStatus: async () => ({ ok: true }),
    getRustTransportWorkerAdapters: async () => ({ ok: true }),
    getRustTransportWorkerWatchdog: async () => ({ ok: true }),
    setRustTransportWorkerConfig: async () => ({ ok: true, data: { ok: true } }),
    startRustTransportWorker: async () => ({ ok: true, data: { ok: true } }),
    stopRustTransportWorker: async () => ({ ok: true, data: { ok: true } }),
    restartRustTransportWorker: async () => ({ ok: true, data: { ok: true } })
  };
}

test("system widget template runtime requires the system endpoints adapter", () => {
  const createSystemWidgetTemplateRuntimeUi = loadFactory(
    "public/assets/js/domains/system/system-widget-template-runtime-ui.js",
    "createSystemWidgetTemplateRuntimeUi"
  );

  assert.throws(
    () => createSystemWidgetTemplateRuntimeUi({}),
    /system widget template runtime requires systemEndpointsAdapter/
  );
});

test("system runtime requires the system endpoints adapter", () => {
  const createSystemRuntimeUi = loadFactory(
    "public/assets/js/domains/system/system-runtime-ui.js",
    "createSystemRuntimeUi"
  );

  assert.throws(
    () => createSystemRuntimeUi({}),
    /system runtime requires systemEndpointsAdapter/
  );
});

test("system runtime requires the audio endpoints adapter for rust worker controls", () => {
  const createSystemRuntimeUi = loadFactory(
    "public/assets/js/domains/system/system-runtime-ui.js",
    "createSystemRuntimeUi"
  );

  assert.throws(
    () => createSystemRuntimeUi({ systemEndpointsAdapter: createSystemAdapterStub() }),
    /system runtime requires audioEndpointsAdapter/
  );
});

test("system rust transport-worker runtime requires the audio endpoints adapter", () => {
  const createSystemRustTransportWorkerRuntimeUi = loadFactory(
    "public/assets/js/domains/system/system-rust-transport-worker-runtime-ui.js",
    "createSystemRustTransportWorkerRuntimeUi"
  );

  assert.throws(
    () => createSystemRustTransportWorkerRuntimeUi({}),
    /system rust transport-worker runtime requires audioEndpointsAdapter/
  );
  assert.throws(
    () => createSystemRustTransportWorkerRuntimeUi({
      audioEndpointsAdapter: { getRustTransportWorkerStatus: async () => ({ ok: true }) }
    }),
    /system rust transport-worker runtime missing audio adapter method: getRustTransportWorkerAdapters/
  );
});

test("system route-console runtime requires the system endpoints adapter", () => {
  const createSystemRouteConsoleRuntimeUi = loadFactory(
    "public/assets/js/domains/system/system-route-console-runtime-ui.js",
    "createSystemRouteConsoleRuntimeUi"
  );

  assert.throws(
    () => createSystemRouteConsoleRuntimeUi({}),
    /system route-console runtime requires systemEndpointsAdapter/
  );
  assert.throws(
    () => createSystemRouteConsoleRuntimeUi({
      systemEndpointsAdapter: { getRouteCatalog: async () => ({ ok: true, routes: [] }) }
    }),
    /system route-console runtime missing adapter method: requestRoute/
  );
});

test("system ops runtime renders safe gateway and Helix redemption readiness", async () => {
  const createSystemOpsRuntimeUi = loadFactory(
    "public/assets/js/domains/system/system-ops-runtime-ui.js",
    "createSystemOpsRuntimeUi",
    {
      createSystemRouteConsoleRuntimeUi() {
        return {
          renderSystemRouteCatalogOptions: () => {},
          loadSystemRouteCatalog: async () => true,
          applySystemRouteCatalogSelection: () => true,
          runSystemRouteConsoleRequest: async () => true,
          copySystemRouteConsoleResponse: async () => true
        };
      },
      createSystemRustTransportWorkerRuntimeUi() {
        return {
          renderSystemRustTransportWorkerStatus: () => {},
          loadSystemRustTransportWorkerStatus: async () => true,
          loadSystemRustTransportWorkerAdapters: async () => true,
          loadSystemRustTransportWorkerWatchdog: async () => true,
          saveSystemRustTransportWorkerConfig: async () => true,
          startSystemRustTransportWorker: async () => true,
          stopSystemRustTransportWorker: async () => true,
          restartSystemRustTransportWorker: async () => true,
          copySystemRustTransportWorkerJson: async () => true
        };
      }
    }
  );
  const textNode = () => ({ textContent: "" });
  const inputNode = () => ({ value: "" });
  const el = {
    health: textNode(),
    systemGatewayRunning: textNode(),
    systemGatewayReady: textNode(),
    systemGatewayMode: textNode(),
    systemGatewayRequestCount: textNode(),
    systemGatewayRequestErrors: textNode(),
    systemGatewayPolicy: textNode(),
    systemHelixReady: textNode(),
    systemHelixOAuth: textNode(),
    systemHelixScope: textNode(),
    systemWidgetReconcileEnabled: textNode(),
    systemWidgetReconcileInFlight: textNode(),
    systemWidgetReconcileLastRun: textNode(),
    systemWidgetReconcileLastOutcome: textNode(),
    systemGatewayStatusText: inputNode(),
    systemWidgetReconcileDump: inputNode()
  };
  const runtime = createSystemOpsRuntimeUi({
    el,
    ui: {},
    windowRef: { getSelection: () => ({ removeAllRanges() {} }) },
    documentRef: {},
    navigatorRef: {},
    setBadge() {},
    systemEndpointsAdapter: {
      getInternetGatewayStatus: async () => ({
        ok: true,
        gateway: {
          enabled: true,
          running: true,
          ready: true,
          requestCount: 7,
          requestErrors: 0,
          policyLoaded: true
        }
      }),
      getSystemOauthStatus: async () => ({
        ok: true,
        hasValues: true,
        presence: {
          twitchClientId: true,
          twitchBroadcasterId: true,
          twitchUserAccessToken: true
        },
        helix: {
          ready: true,
          detail: "Helix reward sync is ready."
        },
        requiredScopes: ["channel:manage:redemptions"]
      }),
      getWidgetRedemptionReconcileStatus: async () => ({
        ok: true,
        reconcile: {
          enabled: true,
          inFlight: false,
          lastCompletedAt: Date.now(),
          lastResult: {
            ok: true,
            resolved: 3,
            failed: 0,
            redemptionsScanned: 5
          }
        }
      }),
      reconcileWidgetRedemptions: async () => ({ ok: true, data: { ok: true } })
    }
  });

  assert.equal(await runtime.loadSystemInternetGatewayStatus(), true);
  assert.equal(await runtime.loadSystemWidgetReconcileStatus(), true);
  assert.equal(el.systemGatewayMode.textContent, "GATEWAY-FIRST");
  assert.equal(el.systemHelixReady.textContent, "YES");
  assert.equal(el.systemHelixOAuth.textContent, "CLIENT:YES | BROADCASTER:YES | TOKEN:YES");
  assert.equal(el.systemHelixScope.textContent, "channel:manage:redemptions");
  assert.equal(el.systemWidgetReconcileEnabled.textContent, "AUTO ON");
  assert.equal(el.systemWidgetReconcileLastOutcome.textContent, "OK 3/0/5");
  assert.match(el.systemGatewayStatusText.value, /GATEWAY READY/);
  assert.match(el.systemGatewayStatusText.value, /HELIX READY/);
});

test("system widget oauth vault runtime requires the system endpoints adapter", () => {
  const createSystemWidgetOauthVaultRuntimeUi = loadFactory(
    "public/assets/js/domains/system/system-widget-oauth-vault-runtime-ui.js",
    "createSystemWidgetOauthVaultRuntimeUi"
  );

  assert.throws(
    () => createSystemWidgetOauthVaultRuntimeUi({}),
    /system widget oauth vault runtime requires systemEndpointsAdapter/
  );
  assert.throws(
    () => createSystemWidgetOauthVaultRuntimeUi({
      systemEndpointsAdapter: { getSystemOauthStatus: async () => ({ ok: true, presence: {} }) }
    }),
    /system widget oauth vault runtime missing adapter method: seedSystemOauthProfile/
  );
});

test("system runtime fails when a composed sub-runtime module is missing", () => {
  const createSystemRuntimeUi = loadFactory(
    "public/assets/js/domains/system/system-runtime-ui.js",
    "createSystemRuntimeUi",
    {
      createSystemStartupReadinessRuntimeUi() {
        return {
          renderSystemStartupReadinessUi: () => ({}),
          loadSystemStartupReadiness: async () => true,
          copySystemStartupReadinessDiagnosticsJson: async () => true
        };
      }
    }
  );

  assert.throws(
    () => createSystemRuntimeUi({
      el: {},
      ui: {},
      windowRef: { location: { origin: "https://example.local" } },
      documentRef: {},
      navigatorRef: {},
      localStorageRef: { getItem: () => null, setItem() {}, removeItem() {} },
      sessionStorageRef: { getItem: () => null, setItem() {} },
      setBadge() {},
      applyLiveModeUiPolicy() {},
      normalizeApiBaseInput: value => String(value || "").trim(),
      confirmUnsafeSensitiveLogEnable: () => ({ ok: true, ack: "ACK" }),
      wipeUiBrowserMemory: async () => {},
      systemEndpointsAdapter: createSystemAdapterStub(),
      audioEndpointsAdapter: createAudioAdapterStub()
    }),
    /system ops runtime module missing/
  );
});
