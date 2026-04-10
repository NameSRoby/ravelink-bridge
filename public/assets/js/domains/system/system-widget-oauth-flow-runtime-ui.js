// [TITLE] Module: public/assets/js/domains/system/system-widget-oauth-flow-runtime-ui.js
// [TITLE] Purpose: shared Twitch OAuth/device-code activation flow for System widget runtimes
// [TITLE] Functionality Index:
// [TITLE] - build Twitch activation URLs with device-code hints
// [TITLE] - resolve active device-code state from System or mod endpoints
// [TITLE] - open/copy the active activation URL with deterministic UI status feedback
// [DEV] This helper is intentionally shared by the System widget template and OAuth runtimes
// [DEV] so their activation flows stay in one place instead of drifting apart.

function createSystemWidgetOauthFlowRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const windowRef = deps.windowRef || window;
  const documentRef = deps.documentRef || document;
  const navigatorRef = deps.navigatorRef || navigator;
  const setIntervalRef = typeof deps.setIntervalRef === "function"
    ? deps.setIntervalRef
    : (typeof windowRef.setInterval === "function"
      ? windowRef.setInterval.bind(windowRef)
      : (typeof setInterval === "function" ? setInterval : null));
  const clearIntervalRef = typeof deps.clearIntervalRef === "function"
    ? deps.clearIntervalRef
    : (typeof windowRef.clearInterval === "function"
      ? windowRef.clearInterval.bind(windowRef)
      : (typeof clearInterval === "function" ? clearInterval : null));
  const setBadge = typeof deps.setBadge === "function" ? deps.setBadge : (() => {});
  const setSystemWidgetTemplateStatus = typeof deps.setSystemWidgetTemplateStatus === "function"
    ? deps.setSystemWidgetTemplateStatus
    : (() => {});
  const saveSystemWidgetTemplatePrefsToStorage = typeof deps.saveSystemWidgetTemplatePrefsToStorage === "function"
    ? deps.saveSystemWidgetTemplatePrefsToStorage
    : (() => {});
  const systemEndpointsAdapter = deps.systemEndpointsAdapter;
  const fetchRef = typeof deps.fetchRef === "function"
    ? deps.fetchRef.bind(windowRef)
    : (typeof windowRef.fetch === "function" ? windowRef.fetch.bind(windowRef) : null);
  const oauthActivationModIds = Array.isArray(deps.oauthActivationModIds) && deps.oauthActivationModIds.length
    ? deps.oauthActivationModIds.map(value => String(value || "").trim()).filter(Boolean)
    : ["music-request-engine", "song-request-mod", "apple-music-request-mod"];
  const oauthFallbackUrl = String(deps.oauthFallbackUrl || "https://www.twitch.tv/activate").trim() || "https://www.twitch.tv/activate";
  const requiredAdapterMethods = [
    "startSystemOauth",
    "getSystemOauthDeviceStatus"
  ];
  if (!systemEndpointsAdapter || typeof systemEndpointsAdapter !== "object") {
    throw new Error("system widget oauth flow runtime requires systemEndpointsAdapter");
  }
  for (const methodName of requiredAdapterMethods) {
    if (typeof systemEndpointsAdapter[methodName] !== "function") {
      throw new Error(`system widget oauth flow runtime missing adapter method: ${methodName}`);
    }
  }
  let systemOauthPollingTimer = null;
  let systemOauthPollingInFlight = false;

  function buildSystemWidgetTwitchAuthorizeUrl() {
    return {
      ok: true,
      url: oauthFallbackUrl
    };
  }

  function buildTwitchActivateUrlWithUserCode(urlInput, userCodeInput) {
    const baseUrl = String(urlInput || oauthFallbackUrl).trim() || oauthFallbackUrl;
    const userCode = String(userCodeInput || "").trim();
    if (!userCode) return baseUrl;
    try {
      const parsed = new URL(baseUrl);
      if (!parsed.searchParams.has("public")) {
        parsed.searchParams.set("public", "true");
      }
      if (!parsed.searchParams.get("device-code")) {
        parsed.searchParams.set("device-code", userCode);
      }
      return parsed.toString();
    } catch {
      return baseUrl;
    }
  }

  function extractTwitchDeviceFlowSnapshot(payloadInput, sourceInput) {
    const payload = payloadInput && typeof payloadInput === "object" ? payloadInput : {};
    const flow = payload.deviceFlow && typeof payload.deviceFlow === "object" ? payload.deviceFlow : {};
    const userCode = String(flow.userCode || payload.userCode || "").trim();
    const statusRaw = String(flow.status || payload.status || "").trim().toLowerCase();
    const status = statusRaw || (userCode ? "pending" : "missing");
    const verificationUrl = String(
      flow.verificationUriComplete ||
      payload.verificationUriComplete ||
      flow.verificationUri ||
      payload.verificationUri ||
      payload.authorizeUrl ||
      ""
    ).trim();
    return {
      ok: true,
      userCode,
      status,
      url: buildTwitchActivateUrlWithUserCode(verificationUrl || oauthFallbackUrl, userCode),
      source: String(sourceInput || "unknown"),
      intervalSec: Math.max(2, Math.round(Number(flow.intervalSec || payload.intervalSec || 5) || 5)),
      expiresAt: Math.max(0, Number(flow.expiresAt || payload.expiresAt || 0)),
      lastError: String(flow.lastError || payload.lastError || "").trim()
    };
  }

  function stopSystemOauthDeviceFlowPolling() {
    if (systemOauthPollingTimer && clearIntervalRef) {
      clearIntervalRef(systemOauthPollingTimer);
    }
    systemOauthPollingTimer = null;
    systemOauthPollingInFlight = false;
  }

  function isSystemOauthReady(payloadInput = {}) {
    const payload = payloadInput && typeof payloadInput === "object" ? payloadInput : {};
    const presence = payload.presence && typeof payload.presence === "object" ? payload.presence : {};
    const helix = payload.helix && typeof payload.helix === "object" ? payload.helix : {};
    return helix.ready === true || (
      presence.twitchClientId === true &&
      presence.twitchBroadcasterId === true &&
      presence.twitchUserAccessToken === true
    );
  }

  async function resumeSystemOauthDeviceFlowPolling(flowInput = {}) {
    const source = flowInput && typeof flowInput === "object" ? flowInput : {};
    const snapshot = extractTwitchDeviceFlowSnapshot(source, source.source || "system:status");
    if (!snapshot.userCode || !String(snapshot.source || "").startsWith("system:")) {
      stopSystemOauthDeviceFlowPolling();
      return false;
    }
    if (isSystemOauthReady(source)) {
      stopSystemOauthDeviceFlowPolling();
      setSystemWidgetTemplateStatus("System OAuth connected. Widget status-sync credentials are ready.");
      setBadge(el.health, "ok", "SYSTEM OAUTH READY");
      return true;
    }
    if (!setIntervalRef || !clearIntervalRef) {
      return false;
    }
    if (systemOauthPollingTimer) {
      return true;
    }
    const pollIntervalMs = Math.max(1500, snapshot.intervalSec * 1000);
    const remainingMs = snapshot.expiresAt > Date.now()
      ? snapshot.expiresAt - Date.now()
      : 300_000;
    const maxAttempts = Math.max(60, Math.ceil(remainingMs / pollIntervalMs) + 4);
    let attempts = 0;
    systemOauthPollingTimer = setIntervalRef(async () => {
      if (systemOauthPollingInFlight) return;
      systemOauthPollingInFlight = true;
      try {
        attempts += 1;
        const response = await systemEndpointsAdapter.getSystemOauthDeviceStatus({
          poll: true
        }).catch(() => null);
        if (!response || response.ok !== true || response.data?.ok !== true) {
          if (attempts >= maxAttempts) {
            stopSystemOauthDeviceFlowPolling();
            setSystemWidgetTemplateStatus("System OAuth approval timed out.");
            setBadge(el.health, "warn", "SYSTEM OAUTH TIMED OUT");
          }
          return;
        }
        if (isSystemOauthReady(response.data)) {
          stopSystemOauthDeviceFlowPolling();
          setSystemWidgetTemplateStatus("System OAuth connected. Widget status-sync credentials are ready.");
          setBadge(el.health, "ok", "SYSTEM OAUTH READY");
          return;
        }
        const deviceFlowStatus = String(response.data?.deviceFlow?.status || "").trim().toLowerCase();
        const deviceFlowError = String(response.data?.deviceFlow?.lastError || "").trim();
        if (deviceFlowStatus === "expired" || deviceFlowStatus === "error") {
          stopSystemOauthDeviceFlowPolling();
          setSystemWidgetTemplateStatus(deviceFlowError || "System OAuth device flow expired. Start the activation flow again.");
          setBadge(el.health, "warn", "SYSTEM OAUTH EXPIRED");
          return;
        }
        if (attempts >= maxAttempts) {
          stopSystemOauthDeviceFlowPolling();
          setSystemWidgetTemplateStatus("System OAuth approval timed out.");
          setBadge(el.health, "warn", "SYSTEM OAUTH TIMED OUT");
        }
      } finally {
        systemOauthPollingInFlight = false;
      }
    }, pollIntervalMs);
    return true;
  }

  function buildInlineSystemOauthSeedPayload() {
    const payload = {};
    const clientId = String(el.systemWidgetTwitchClientId?.value || "").trim();
    const userAccessToken = String(el.systemWidgetTwitchUserAccessToken?.value || "").trim();
    const broadcasterId = String(el.systemWidgetTwitchBroadcasterId?.value || "").trim();
    if (clientId) payload.twitchClientId = clientId;
    if (userAccessToken) payload.twitchUserAccessToken = userAccessToken;
    if (broadcasterId) payload.twitchBroadcasterId = broadcasterId;
    return payload;
  }

  async function fetchActiveTwitchDeviceCodeFromMod() {
    if (!fetchRef) {
      return { ok: false, error: "fetch_unavailable" };
    }
    const activeStatuses = new Set(["pending", "connected", "ready", "authorized"]);
    for (const modId of oauthActivationModIds) {
      try {
        const response = await fetchRef(`/mods/${encodeURIComponent(modId)}/oauth_twitch_status`, {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: "{}"
        });
        if (!response || !response.ok) continue;
        const payload = await response.json().catch(() => ({}));
        if (!payload || payload.ok !== true) continue;
        const snapshot = extractTwitchDeviceFlowSnapshot(payload, `mod:${modId}:status`);
        if (snapshot.userCode && activeStatuses.has(snapshot.status)) {
          return snapshot;
        }
        if (snapshot.userCode && !activeStatuses.has(snapshot.status) && snapshot.status !== "expired" && snapshot.status !== "error") {
          return {
            ...snapshot,
            status: "pending"
          };
        }
      } catch {
        // Continue probing remaining mod ids.
      }
    }
    return {
      ok: true,
      userCode: "",
      status: "missing",
      url: buildTwitchActivateUrlWithUserCode(oauthFallbackUrl, ""),
      source: "fallback"
    };
  }

  async function fetchActiveTwitchDeviceCodeFromSystem() {
    try {
      const response = await systemEndpointsAdapter.getSystemOauthDeviceStatus({
        poll: true
      });
      if (!response || response.ok !== true || response.data?.ok !== true) {
        return { ok: false, error: "system_oauth_status_http_failed" };
      }
      const payload = response.data;
      const snapshot = extractTwitchDeviceFlowSnapshot(payload, "system:status");
      if (snapshot.userCode && (snapshot.status === "pending" || snapshot.status === "connected" || snapshot.status === "ready")) {
        return snapshot;
      }
      if (snapshot.userCode && snapshot.status !== "expired" && snapshot.status !== "error") {
        return {
          ...snapshot,
          status: "pending"
        };
      }
      return snapshot;
    } catch {
      return { ok: false, error: "system_oauth_status_failed" };
    }
  }

  async function startTwitchDeviceCodeFromMod() {
    if (!fetchRef) {
      return { ok: false, error: "fetch_unavailable" };
    }
    for (const modId of oauthActivationModIds) {
      try {
        const response = await fetchRef(`/mods/${encodeURIComponent(modId)}/oauth_twitch_start`, {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            publicBaseUrl: String(windowRef.location?.origin || "")
          })
        });
        if (!response || !response.ok) continue;
        const payload = await response.json().catch(() => ({}));
        if (!payload || payload.ok !== true) continue;
        const snapshot = extractTwitchDeviceFlowSnapshot(payload, `mod:${modId}:start`);
        if (snapshot.userCode) return snapshot;
      } catch {
        // Keep probing remaining mod ids.
      }
    }
    return { ok: false, error: "device_flow_start_unavailable" };
  }

  async function startTwitchDeviceCodeFromSystem() {
    try {
      const response = await systemEndpointsAdapter.startSystemOauth({
        requestedBy: "system_widget",
        ...buildInlineSystemOauthSeedPayload()
      });
      if (!response || response.ok !== true || response.data?.ok !== true) {
        return { ok: false, error: "system_oauth_start_http_failed" };
      }
      const payload = response.data;
      const snapshot = extractTwitchDeviceFlowSnapshot(payload, "system:start");
      if (snapshot.userCode) return snapshot;
      return { ok: false, error: "system_oauth_start_missing_user_code" };
    } catch {
      return { ok: false, error: "system_oauth_start_failed" };
    }
  }

  async function resolveSystemWidgetActivationTarget() {
    const activeSystemSnapshot = await fetchActiveTwitchDeviceCodeFromSystem();
    if (activeSystemSnapshot?.ok && String(activeSystemSnapshot.userCode || "").trim()) {
      return activeSystemSnapshot;
    }
    const startedSystemSnapshot = await startTwitchDeviceCodeFromSystem();
    if (startedSystemSnapshot?.ok && String(startedSystemSnapshot.userCode || "").trim()) {
      return startedSystemSnapshot;
    }
    const activeModSnapshot = await fetchActiveTwitchDeviceCodeFromMod();
    if (activeModSnapshot?.ok && String(activeModSnapshot.userCode || "").trim()) {
      return activeModSnapshot;
    }
    const startedModSnapshot = await startTwitchDeviceCodeFromMod();
    if (startedModSnapshot?.ok && String(startedModSnapshot.userCode || "").trim()) {
      return startedModSnapshot;
    }
    if (activeSystemSnapshot?.ok) return activeSystemSnapshot;
    if (activeModSnapshot?.ok) return activeModSnapshot;
    return {
      ok: true,
      userCode: "",
      status: "missing",
      url: buildTwitchActivateUrlWithUserCode(oauthFallbackUrl, ""),
      source: "fallback"
    };
  }

  function copyTextToClipboard(text) {
    return (async () => {
      let copied = false;
      const value = String(text || "").trim();
      if (!value) return false;

      if (navigatorRef.clipboard && typeof navigatorRef.clipboard.writeText === "function") {
        try {
          await navigatorRef.clipboard.writeText(value);
          copied = true;
        } catch {
          copied = false;
        }
      }
      if (!copied && documentRef && documentRef.body && typeof documentRef.createElement === "function") {
        const scratch = documentRef.createElement("textarea");
        scratch.value = value;
        scratch.setAttribute("readonly", "readonly");
        scratch.style.position = "fixed";
        scratch.style.top = "-9999px";
        scratch.style.opacity = "0";
        documentRef.body.appendChild(scratch);
        scratch.focus();
        scratch.select();
        try {
          copied = documentRef.execCommand("copy");
        } catch {
          copied = false;
        } finally {
          scratch.remove();
          windowRef.getSelection?.()?.removeAllRanges?.();
        }
      }
      return copied;
    })();
  }

  async function openSystemWidgetOauthAuthorizeUrl() {
    saveSystemWidgetTemplatePrefsToStorage();
    const built = buildSystemWidgetTwitchAuthorizeUrl();
    if (!built.ok) {
      setSystemWidgetTemplateStatus(String(built.error || "Activation link generation failed."));
      setBadge(el.health, "warn", "TWITCH OAUTH URL UNAVAILABLE");
      return false;
    }
    const modFlow = await resolveSystemWidgetActivationTarget();
    const targetUrl = String(modFlow?.url || built.url || "").trim();
    const popup = windowRef.open?.(targetUrl, "_blank", "noopener,noreferrer");
    if (!popup) {
      setSystemWidgetTemplateStatus("Popup blocked. Use COPY TWITCH ACTIVATE LINK instead.");
      setBadge(el.health, "warn", "OAUTH POPUP BLOCKED");
      return false;
    }
    const userCode = String(modFlow?.userCode || "").trim();
    if (userCode) {
      setSystemWidgetTemplateStatus(`Opened Twitch activation page with code ${userCode}.`);
      resumeSystemOauthDeviceFlowPolling(modFlow);
    } else {
      setSystemWidgetTemplateStatus("Opened Twitch activation page without an active code. Seed System OAuth client ID first (or run mod Connect OAuth), then retry.");
    }
    setBadge(el.health, "ok", "TWITCH OAUTH URL OPENED");
    return true;
  }

  async function copySystemWidgetOauthAuthorizeUrl() {
    saveSystemWidgetTemplatePrefsToStorage();
    const built = buildSystemWidgetTwitchAuthorizeUrl();
    if (!built.ok) {
      setSystemWidgetTemplateStatus(String(built.error || "Activation link generation failed."));
      setBadge(el.health, "warn", "TWITCH OAUTH URL UNAVAILABLE");
      return false;
    }

    const modFlow = await resolveSystemWidgetActivationTarget();
    const targetUrl = String(modFlow?.url || built.url || "").trim();
    const copied = await copyTextToClipboard(targetUrl);
    if (!copied) {
      setSystemWidgetTemplateStatus("Activation link copy failed. Open page and copy manually.");
      setBadge(el.health, "warn", "TWITCH OAUTH URL COPY FAILED");
      return false;
    }
    const userCode = String(modFlow?.userCode || "").trim();
    if (userCode) {
      setSystemWidgetTemplateStatus(`Twitch activation link copied with active code ${userCode}.`);
      resumeSystemOauthDeviceFlowPolling(modFlow);
    } else {
      setSystemWidgetTemplateStatus("Twitch activation link copied without active code. Seed System OAuth client ID first (or run mod Connect OAuth), then retry.");
    }
    setBadge(el.health, "ok", "TWITCH OAUTH URL COPIED");
    return true;
  }

  return {
    buildSystemWidgetTwitchAuthorizeUrl,
    buildTwitchActivateUrlWithUserCode,
    extractTwitchDeviceFlowSnapshot,
    fetchActiveTwitchDeviceCodeFromMod,
    fetchActiveTwitchDeviceCodeFromSystem,
    startTwitchDeviceCodeFromMod,
    startTwitchDeviceCodeFromSystem,
    resolveSystemWidgetActivationTarget,
    copyTextToClipboard,
    stopSystemOauthDeviceFlowPolling,
    resumeSystemOauthDeviceFlowPolling,
    openSystemWidgetOauthAuthorizeUrl,
    copySystemWidgetOauthAuthorizeUrl
  };
}
