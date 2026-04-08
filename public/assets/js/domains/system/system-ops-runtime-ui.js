// [TITLE] Module: public/assets/js/domains/system/system-ops-runtime-ui.js
// [TITLE] Purpose: route-console, safe internet + Twitch redemption sync, and rust-worker runtime for System tab
// [TITLE] Functionality Index:
// [TITLE] - route catalog + route console interactions
// [TITLE] - internet gateway and Twitch Helix redemption sync status/actions
// [TITLE] - rust transport worker status, config, lifecycle, and dump helpers
// [DEV] Complex Flow:
// [DEV] These controls share the same health badge and status surfaces, so keeping them
// [DEV] in one sub-runtime avoids reimplementing request/report wiring across the System tab.

function createSystemOpsRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const windowRef = deps.windowRef || window;
  const documentRef = deps.documentRef || document;
  const navigatorRef = deps.navigatorRef || navigator;
  const setBadge = typeof deps.setBadge === "function" ? deps.setBadge : (() => {});
  const systemEndpointsAdapter = deps.systemEndpointsAdapter;
  const requiredAdapterMethods = [
    "getInternetGatewayStatus",
    "getSystemOauthStatus",
    "getWidgetRedemptionReconcileStatus",
    "reconcileWidgetRedemptions"
  ];
  if (!systemEndpointsAdapter || typeof systemEndpointsAdapter !== "object") {
    throw new Error("system ops runtime requires systemEndpointsAdapter");
  }
  for (const methodName of requiredAdapterMethods) {
    if (typeof systemEndpointsAdapter[methodName] !== "function") {
      throw new Error(`system ops runtime missing adapter method: ${methodName}`);
    }
  }

  function formatRelativeAge(timestampMs) {
    const at = Number(timestampMs || 0);
    if (!Number.isFinite(at) || at <= 0) return "-";
    const deltaMs = Math.max(0, Date.now() - at);
    const sec = Math.floor(deltaMs / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 48) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    return `${day}d ago`;
  }

  function normalizeWidgetReconcilePayloadFromUi() {
    const status = String(el.systemWidgetReconcileStatus?.value || "FULFILLED").trim().toUpperCase();
    const reason = String(el.systemWidgetReconcileReason?.value || "manual_reconcile").trim() || "manual_reconcile";
    const maxRewards = Math.max(1, Math.min(500, Math.round(Number(el.systemWidgetReconcileMaxRewards?.value || 100) || 100)));
    const maxRedemptions = Math.max(1, Math.min(500, Math.round(Number(el.systemWidgetReconcileMaxRedemptions?.value || 200) || 200)));
    const rewardIds = String(el.systemWidgetReconcileRewardIds?.value || "")
      .split(/[,\s]+/)
      .map(item => String(item || "").trim())
      .filter(Boolean);
    return {
      status: status === "CANCELED" ? "CANCELED" : "FULFILLED",
      reason,
      maxRewards,
      maxRedemptions,
      rewardIds
    };
  }

  function formatCompactPresence(label, present) {
    return `${label}:${present === true ? "yes" : "no"}`;
  }

  function formatHelixOauthPresence(oauthPayload = {}) {
    const presence = oauthPayload.presence && typeof oauthPayload.presence === "object"
      ? oauthPayload.presence
      : {};
    const parts = [
      formatCompactPresence("client", presence.twitchClientId === true),
      formatCompactPresence("broadcaster", presence.twitchBroadcasterId === true),
      formatCompactPresence("token", presence.twitchUserAccessToken === true)
    ];
    return parts.join(" | ");
  }

  function resolveHelixScopeList(oauthPayload = {}, helix = {}) {
    const candidates = [
      helix.scopes,
      helix.requiredScopes,
      oauthPayload.scopes,
      oauthPayload.oauthScopes,
      oauthPayload.requiredScopes
    ];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate
          .map(item => String(item || "").trim())
          .filter(Boolean);
      }
    }
    return [];
  }

  function formatReconcileOutcome(lastResult = null) {
    if (!lastResult || typeof lastResult !== "object") return "-";
    if (lastResult.ok === false) return String(lastResult.error || "FAILED").trim().toUpperCase();
    const resolved = Number(lastResult.resolved || lastResult.resolvedCount || 0);
    const failed = Number(lastResult.failed || lastResult.failedCount || 0);
    const scanned = Number(lastResult.scanned || lastResult.redemptionsScanned || 0);
    if (resolved || failed || scanned) return `OK ${resolved}/${failed}/${scanned}`;
    return lastResult.ok === true ? "OK" : "-";
  }

  async function copyTextToClipboard(text = "") {
    const value = String(text || "").trim();
    if (!value) return false;
    if (navigatorRef.clipboard && typeof navigatorRef.clipboard.writeText === "function") {
      try {
        await navigatorRef.clipboard.writeText(value);
        return true;
      } catch {
        // fall through to execCommand path
      }
    }
    if (!documentRef || typeof documentRef.createElement !== "function" || !documentRef.body) {
      return false;
    }
    const node = documentRef.createElement("textarea");
    node.value = value;
    node.setAttribute("readonly", "readonly");
    node.style.position = "fixed";
    node.style.opacity = "0";
    node.style.top = "-9999px";
    documentRef.body.appendChild(node);
    node.focus();
    node.select();
    let copied = false;
    try {
      copied = documentRef.execCommand("copy");
    } catch {
      copied = false;
    } finally {
      node.remove();
      windowRef.getSelection?.()?.removeAllRanges?.();
    }
    return copied;
  }

  const systemRouteConsoleRuntime = (typeof createSystemRouteConsoleRuntimeUi === "function"
    ? createSystemRouteConsoleRuntimeUi({
      el,
      ui,
      setBadge,
      systemEndpointsAdapter,
      copyTextToClipboard
    })
    : (() => {
      throw new Error("system route-console runtime module missing");
    })());
  const {
    renderSystemRouteCatalogOptions,
    loadSystemRouteCatalog,
    applySystemRouteCatalogSelection,
    runSystemRouteConsoleRequest,
    copySystemRouteConsoleResponse
  } = systemRouteConsoleRuntime;

  function renderGatewayAndReconcileStatus() {
    const gatewayPayload = ui.systemGatewayStatusSnapshot && typeof ui.systemGatewayStatusSnapshot === "object"
      ? ui.systemGatewayStatusSnapshot
      : {};
    const gateway = gatewayPayload.gateway && typeof gatewayPayload.gateway === "object"
      ? gatewayPayload.gateway
      : {};
    const reconcilePayload = ui.systemWidgetReconcileStatusSnapshot && typeof ui.systemWidgetReconcileStatusSnapshot === "object"
      ? ui.systemWidgetReconcileStatusSnapshot
      : {};
    const reconcile = reconcilePayload.reconcile && typeof reconcilePayload.reconcile === "object"
      ? reconcilePayload.reconcile
      : {};
    const oauthPayload = ui.systemOauthStatusSnapshot && typeof ui.systemOauthStatusSnapshot === "object"
      ? ui.systemOauthStatusSnapshot
      : {};
    const helix = oauthPayload.helix && typeof oauthPayload.helix === "object"
      ? oauthPayload.helix
      : {};
    const lastResult = ui.systemWidgetReconcileLastResult && typeof ui.systemWidgetReconcileLastResult === "object"
      ? ui.systemWidgetReconcileLastResult
      : (reconcile.lastResult && typeof reconcile.lastResult === "object" ? reconcile.lastResult : null);

    if (el.systemGatewayRunning) {
      if (gateway.enabled !== true) el.systemGatewayRunning.textContent = "DISABLED";
      else el.systemGatewayRunning.textContent = gateway.running === true ? "RUNNING" : "STOPPED";
    }
    if (el.systemGatewayReady) {
      el.systemGatewayReady.textContent = gateway.ready === true ? "YES" : "NO";
    }
    if (el.systemGatewayMode) {
      const mode = gateway.enabled !== true
        ? "disabled"
        : (gateway.ready === true ? "gateway-first" : "direct fallback risk");
      el.systemGatewayMode.textContent = mode.toUpperCase();
    }
    if (el.systemGatewayRequestCount) {
      el.systemGatewayRequestCount.textContent = String(Number(gateway.requestCount || 0));
    }
    if (el.systemGatewayRequestErrors) {
      el.systemGatewayRequestErrors.textContent = String(Number(gateway.requestErrors || 0));
    }
    if (el.systemGatewayPolicy) {
      if (gateway.policyLoaded === true) {
        el.systemGatewayPolicy.textContent = "LOADED";
      } else if (String(gateway.policyError || "").trim()) {
        el.systemGatewayPolicy.textContent = "ERROR";
      } else {
        el.systemGatewayPolicy.textContent = "MISSING";
      }
    }

    if (el.systemWidgetReconcileEnabled) {
      el.systemWidgetReconcileEnabled.textContent = reconcile.enabled === true ? "AUTO ON" : "AUTO OFF";
    }
    if (el.systemWidgetReconcileInFlight) {
      el.systemWidgetReconcileInFlight.textContent = reconcile.inFlight === true ? "YES" : "NO";
    }
    if (el.systemWidgetReconcileLastRun) {
      const lastAt = Number(reconcile.lastCompletedAt || reconcile.lastStartedAt || 0);
      el.systemWidgetReconcileLastRun.textContent = formatRelativeAge(lastAt);
    }
    if (el.systemHelixReady) {
      el.systemHelixReady.textContent = helix.ready === true ? "YES" : "NO";
    }
    if (el.systemHelixOAuth) {
      el.systemHelixOAuth.textContent = formatHelixOauthPresence(oauthPayload).toUpperCase();
    }
    if (el.systemHelixScope) {
      const scopes = resolveHelixScopeList(oauthPayload, helix);
      el.systemHelixScope.textContent = scopes.includes("channel:manage:redemptions")
        ? "channel:manage:redemptions"
        : (helix.ready === true ? "READY" : "MISSING");
    }
    if (el.systemWidgetReconcileLastOutcome) {
      el.systemWidgetReconcileLastOutcome.textContent = formatReconcileOutcome(lastResult);
    }

    if (el.systemGatewayStatusText) {
      const gatewayState = gateway.enabled !== true
        ? "GATEWAY DISABLED"
        : (gateway.ready === true ? "GATEWAY READY" : (gateway.running === true ? "GATEWAY STARTING" : "GATEWAY STOPPED"));
      const recState = reconcile.enabled === true ? "AUTO RECONCILE ON" : "AUTO RECONCILE OFF";
      const helixState = helix.ready === true ? "HELIX READY" : "HELIX INCOMPLETE";
      const reqErrors = Number(gateway.requestErrors || 0);
      const failureToken = reqErrors > 0 ? `REQ ERRORS ${reqErrors}` : "REQ ERRORS 0";
      el.systemGatewayStatusText.value = `${gatewayState} | ${helixState} | ${recState} | ${failureToken}`;
    }

    if (el.systemWidgetReconcileDump) {
      const dumpPayload = lastResult || {
        gateway,
        oauth: oauthPayload,
        reconcile
      };
      try {
        el.systemWidgetReconcileDump.value = JSON.stringify(dumpPayload, null, 2);
      } catch {
        el.systemWidgetReconcileDump.value = String(dumpPayload || "");
      }
    }
  }

  async function loadSystemInternetGatewayStatus(options = {}) {
    const announce = options.announce === true;
    const response = await systemEndpointsAdapter.getInternetGatewayStatus();
    if (!response || response.ok !== true || !response.gateway) {
      if (announce) {
        setBadge(el.health, "warn", "INTERNET GATEWAY STATUS FAILED");
      }
      return false;
    }
    ui.systemGatewayStatusSnapshot = response;
    await loadSystemHelixOauthStatus({ announce: false });
    renderGatewayAndReconcileStatus();
    return true;
  }

  async function loadSystemHelixOauthStatus(options = {}) {
    const announce = options.announce === true;
    const response = await systemEndpointsAdapter.getSystemOauthStatus();
    if (!response || response.ok !== true) {
      if (announce) {
        setBadge(el.health, "warn", "HELIX OAUTH STATUS FAILED");
      }
      return false;
    }
    ui.systemOauthStatusSnapshot = response;
    renderGatewayAndReconcileStatus();
    return true;
  }

  async function loadSystemWidgetReconcileStatus(options = {}) {
    const announce = options.announce === true;
    const [response] = await Promise.all([
      systemEndpointsAdapter.getWidgetRedemptionReconcileStatus(),
      loadSystemHelixOauthStatus({ announce: false })
    ]);
    if (!response || response.ok !== true || !response.reconcile) {
      if (announce) {
        setBadge(el.health, "warn", "TWITCH REDEMPTION SYNC STATUS FAILED");
      }
      return false;
    }
    ui.systemWidgetReconcileStatusSnapshot = response;
    renderGatewayAndReconcileStatus();
    return true;
  }

  async function runSystemWidgetReconcileNow(options = {}) {
    const announce = options.announce !== false;
    const payload = normalizeWidgetReconcilePayloadFromUi();
    const response = await systemEndpointsAdapter.reconcileWidgetRedemptions(payload);
    if (!response || response.ok !== true || !response.data || response.data.ok !== true) {
      const errorText = String(response?.data?.error || "widget_reconcile_failed");
      if (announce) {
        if (el.systemGatewayStatusText) el.systemGatewayStatusText.value = errorText;
        setBadge(el.health, "warn", "TWITCH REDEMPTION SYNC FAILED");
      }
      return false;
    }
    ui.systemWidgetReconcileLastResult = response.data;
    renderGatewayAndReconcileStatus();
    if (announce) {
      const resolved = Number(response.data.resolved || 0);
      const failed = Number(response.data.failed || 0);
      setBadge(el.health, failed > 0 ? "warn" : "ok", `RECONCILE DONE (resolved=${resolved}, failed=${failed})`);
    }
    await loadSystemWidgetReconcileStatus({ announce: false });
    return true;
  }

  async function copySystemWidgetReconcileResultJson() {
    const payload = ui.systemWidgetReconcileLastResult
      || (ui.systemWidgetReconcileStatusSnapshot && ui.systemWidgetReconcileStatusSnapshot.reconcile)
      || null;
    if (!payload) {
      setBadge(el.health, "warn", "NO RECONCILE JSON TO COPY");
      return false;
    }
    let text = "";
    try {
      text = JSON.stringify(payload, null, 2);
    } catch {
      text = String(payload || "");
    }
    const copied = await copyTextToClipboard(text);
    if (!copied) {
      setBadge(el.health, "warn", "RECONCILE COPY FAILED");
      return false;
    }
    setBadge(el.health, "ok", "RECONCILE JSON COPIED");
    return true;
  }

  const systemRustTransportWorkerRuntime = (typeof createSystemRustTransportWorkerRuntimeUi === "function"
    ? createSystemRustTransportWorkerRuntimeUi({
      el,
      ui,
      setBadge,
      audioEndpointsAdapter: deps.audioEndpointsAdapter || (
        typeof audioEndpointsAdapter === "object" && audioEndpointsAdapter
      ) || null,
      formatRelativeAge,
      copyTextToClipboard
    })
    : (() => {
      throw new Error("system rust transport-worker runtime module missing");
    })());
  const {
    renderSystemRustTransportWorkerStatus,
    loadSystemRustTransportWorkerStatus,
    loadSystemRustTransportWorkerAdapters,
    loadSystemRustTransportWorkerWatchdog,
    saveSystemRustTransportWorkerConfig,
    startSystemRustTransportWorker,
    stopSystemRustTransportWorker,
    restartSystemRustTransportWorker,
    copySystemRustTransportWorkerJson
  } = systemRustTransportWorkerRuntime;

  return {
    renderSystemRouteCatalogOptions,
    loadSystemRouteCatalog,
    applySystemRouteCatalogSelection,
    runSystemRouteConsoleRequest,
    copySystemRouteConsoleResponse,
    renderGatewayAndReconcileStatus,
    loadSystemInternetGatewayStatus,
    loadSystemWidgetReconcileStatus,
    runSystemWidgetReconcileNow,
    copySystemWidgetReconcileResultJson,
    renderSystemRustTransportWorkerStatus,
    loadSystemRustTransportWorkerStatus,
    loadSystemRustTransportWorkerAdapters,
    loadSystemRustTransportWorkerWatchdog,
    saveSystemRustTransportWorkerConfig,
    startSystemRustTransportWorker,
    stopSystemRustTransportWorker,
    restartSystemRustTransportWorker,
    copySystemRustTransportWorkerJson
  };
}
