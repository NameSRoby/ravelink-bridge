// [TITLE] Module: public/assets/js/domains/system/system-widget-template-runtime-ui.js
// [TITLE] Purpose: system widget template runtime composer
// [TITLE] Functionality Index:
// [TITLE] - widget prefs read/write/restore + sensitive input reveal controls
// [TITLE] - StreamElements widget payload build/generate/copy helpers
// [TITLE] - OAuth activation/vault runtime composition
// [DEV] Complex Flow:
// [DEV] This composer preserves global helper names while delegating OAuth flow and
// [DEV] vault actions to bounded runtimes.

function createSystemWidgetTemplateRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const windowRef = deps.windowRef || window;
  const documentRef = deps.documentRef || document;
  const navigatorRef = deps.navigatorRef || navigator;
  const localStorageRef = deps.localStorageRef || localStorage;
  const setBadge = typeof deps.setBadge === "function" ? deps.setBadge : (() => {});
  const normalizeSystemWidgetBaseUrl = typeof deps.normalizeSystemWidgetBaseUrl === "function"
    ? deps.normalizeSystemWidgetBaseUrl
    : (value => String(value || "").trim());
  const clampSystemWidgetRaveAutoOffSec = typeof deps.clampSystemWidgetRaveAutoOffSec === "function"
    ? deps.clampSystemWidgetRaveAutoOffSec
    : (value => {
      const parsed = Math.round(Number(value));
      if (!Number.isFinite(parsed)) return 300;
      return Math.max(15, Math.min(1800, parsed));
    });
  const systemEndpointsAdapter = deps.systemEndpointsAdapter;
  const modsEndpointsAdapter = deps.modsEndpointsAdapter && typeof deps.modsEndpointsAdapter === "object"
    ? deps.modsEndpointsAdapter
    : null;
  const requiredAdapterMethods = [
    "startSystemOauth",
    "getSystemOauthDeviceStatus",
    "getSystemOauthStatus",
    "seedSystemOauthProfile",
    "clearSystemOauthProfile",
    "syncSystemOauthToMod",
    "generateWidgetTemplate"
  ];
  if (!systemEndpointsAdapter || typeof systemEndpointsAdapter !== "object") {
    throw new Error("system widget template runtime requires systemEndpointsAdapter");
  }
  for (const methodName of requiredAdapterMethods) {
    if (typeof systemEndpointsAdapter[methodName] !== "function") {
      throw new Error(`system widget template runtime missing adapter method: ${methodName}`);
    }
  }
  const widgetPrefsStorageKey = String(deps.widgetPrefsStorageKey || "ravelink_system_widget_template_v1");
  const widgetTemplateDefaults = deps.widgetTemplateDefaults && typeof deps.widgetTemplateDefaults === "object"
    ? deps.widgetTemplateDefaults
    : {
      colorRewardId: "",
      teachRewardId: "",
      raveRewardId: "",
      baseUrl: "http://127.0.0.1:5050",
      raveAutoOffSec: 300,
      raveAutoOffResetOnRepeat: true,
      enableStatusSync: false,
      streamElementsBotChatEnabled: false,
      streamElementsBotChannelId: "",
      streamElementsBotJwt: "",
      streamElementsBotMessagePrefix: "",
      twitchClientId: "",
      twitchUserAccessToken: "",
      twitchBroadcasterId: "",
      raveOffAnnounceEnabled: true,
      raveOffAnnounceMessage: "RAVE is now off. Change Lights redemption is active again.",
      blockedMessage: "light commands are disabled while RAVE is active (runtime: 5 minutes)"
    };

  let systemWidgetSensitiveFieldsRevealed = false;

  function setSystemWidgetTemplateStatus(text = "") {
    if (!el.systemWidgetStatus) return;
    el.systemWidgetStatus.textContent = String(text || "").trim();
  }

  function getSystemWidgetSensitiveInputNodes() {
    return [
      el.systemWidgetColorRewardId,
      el.systemWidgetTeachRewardId,
      el.systemWidgetRaveRewardId,
      el.systemWidgetSeBotChannelId,
      el.systemWidgetSeBotJwt,
      el.systemWidgetTwitchClientId,
      el.systemWidgetTwitchUserAccessToken,
      el.systemWidgetTwitchBroadcasterId
    ].filter(Boolean);
  }

  function getSystemWidgetRaveAutoOffResetOnRepeatNode() {
    return el.systemWidgetRaveAutoOffResetOnRepeat
      || documentRef.getElementById("systemWidgetRaveAutoOffResetOnRepeat");
  }

  function setSystemWidgetSensitiveFieldsReveal(enabled) {
    systemWidgetSensitiveFieldsRevealed = enabled === true;
    const targetType = systemWidgetSensitiveFieldsRevealed ? "text" : "password";
    for (const node of getSystemWidgetSensitiveInputNodes()) {
      if (!node || node.tagName !== "INPUT") continue;
      node.type = targetType;
    }
    if (el.systemWidgetSensitiveToggleBtn) {
      el.systemWidgetSensitiveToggleBtn.textContent = systemWidgetSensitiveFieldsRevealed
        ? "HIDE SENSITIVE FIELDS"
        : "REVEAL SENSITIVE FIELDS";
    }
  }

  function toggleSystemWidgetSensitiveFieldsReveal() {
    setSystemWidgetSensitiveFieldsReveal(!systemWidgetSensitiveFieldsRevealed);
  }

  function readSystemWidgetTemplatePrefsFromStorage() {
    try {
      const raw = localStorageRef.getItem(widgetPrefsStorageKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function collectSystemWidgetTemplatePrefsFromUi() {
    const raveAutoOffResetOnRepeatNode = getSystemWidgetRaveAutoOffResetOnRepeatNode();
    return {
      colorRewardId: String(el.systemWidgetColorRewardId?.value || "").trim(),
      bundleMode: String(el.systemWidgetBundleMode?.value || "separate").trim().toLowerCase() === "combined"
        ? "combined"
        : "separate",
      dockModOauth: el.systemWidgetDockModOauth?.checked === true,
      teachRewardId: String(el.systemWidgetTeachRewardId?.value || "").trim(),
      raveRewardId: String(el.systemWidgetRaveRewardId?.value || "").trim(),
      baseUrl: normalizeSystemWidgetBaseUrl(el.systemWidgetBaseUrl?.value),
      raveAutoOffSec: clampSystemWidgetRaveAutoOffSec(el.systemWidgetRaveAutoOffSec?.value),
      raveAutoOffResetOnRepeat: raveAutoOffResetOnRepeatNode
        ? raveAutoOffResetOnRepeatNode.checked !== false
        : true,
      enableStatusSync: el.systemWidgetEnableStatusSync?.checked === true,
      streamElementsBotChatEnabled: el.systemWidgetSeBotEnabled?.checked === true,
      streamElementsBotChannelId: String(el.systemWidgetSeBotChannelId?.value || "").trim(),
      streamElementsBotJwt: String(el.systemWidgetSeBotJwt?.value || "").trim(),
      streamElementsBotMessagePrefix: String(el.systemWidgetSeBotPrefix?.value || "").trim(),
      twitchClientId: String(el.systemWidgetTwitchClientId?.value || "").trim(),
      twitchUserAccessToken: String(el.systemWidgetTwitchUserAccessToken?.value || "").trim(),
      twitchBroadcasterId: String(el.systemWidgetTwitchBroadcasterId?.value || "").trim(),
      raveOffAnnounceEnabled: el.systemWidgetRaveOffAnnounceEnabled?.checked !== false,
      raveOffAnnounceMessage: String(el.systemWidgetRaveOffAnnounceMessage?.value || "").trim(),
      blockedMessage: String(el.systemWidgetBlockedMessage?.value || "").trim()
    };
  }

  function saveSystemWidgetTemplatePrefsToStorage() {
    const prefs = collectSystemWidgetTemplatePrefsFromUi();
    const safePrefs = {
      ...prefs,
      twitchClientId: "",
      twitchUserAccessToken: "",
      twitchBroadcasterId: ""
    };
    try {
      localStorageRef.setItem(widgetPrefsStorageKey, JSON.stringify(safePrefs));
    } catch {
      // ignore storage write failures
    }
  }

  function restoreSystemWidgetPrefsFromStorage() {
    const stored = readSystemWidgetTemplatePrefsFromStorage();
    const merged = {
      ...widgetTemplateDefaults,
      ...(stored && typeof stored === "object" ? stored : {})
    };

    if (el.systemWidgetColorRewardId) el.systemWidgetColorRewardId.value = String(merged.colorRewardId || "");
    if (el.systemWidgetBundleMode) {
      el.systemWidgetBundleMode.value = String(merged.bundleMode || "separate").trim().toLowerCase() === "combined"
        ? "combined"
        : "separate";
    }
    if (el.systemWidgetDockModOauth) {
      el.systemWidgetDockModOauth.checked = merged.dockModOauth === true;
    }
    if (el.systemWidgetTeachRewardId) el.systemWidgetTeachRewardId.value = String(merged.teachRewardId || "");
    if (el.systemWidgetRaveRewardId) el.systemWidgetRaveRewardId.value = String(merged.raveRewardId || "");
    if (el.systemWidgetBaseUrl) el.systemWidgetBaseUrl.value = normalizeSystemWidgetBaseUrl(merged.baseUrl);
    if (el.systemWidgetRaveAutoOffSec) {
      el.systemWidgetRaveAutoOffSec.value = String(clampSystemWidgetRaveAutoOffSec(merged.raveAutoOffSec));
    }
    const raveAutoOffResetOnRepeatNode = getSystemWidgetRaveAutoOffResetOnRepeatNode();
    if (raveAutoOffResetOnRepeatNode) {
      raveAutoOffResetOnRepeatNode.checked = merged.raveAutoOffResetOnRepeat !== false;
      if (raveAutoOffResetOnRepeatNode.dataset.ravelinkWidgetPrefsBound !== "1") {
        raveAutoOffResetOnRepeatNode.addEventListener("input", saveSystemWidgetTemplatePrefsToStorage);
        raveAutoOffResetOnRepeatNode.addEventListener("change", saveSystemWidgetTemplatePrefsToStorage);
        raveAutoOffResetOnRepeatNode.dataset.ravelinkWidgetPrefsBound = "1";
      }
    }
    if (el.systemWidgetEnableStatusSync) el.systemWidgetEnableStatusSync.checked = merged.enableStatusSync === true;
    if (el.systemWidgetSeBotEnabled) {
      el.systemWidgetSeBotEnabled.checked = merged.streamElementsBotChatEnabled === true;
    }
    if (el.systemWidgetSeBotChannelId) {
      el.systemWidgetSeBotChannelId.value = String(merged.streamElementsBotChannelId || "");
    }
    if (el.systemWidgetSeBotJwt) {
      el.systemWidgetSeBotJwt.value = String(merged.streamElementsBotJwt || "");
    }
    if (el.systemWidgetSeBotPrefix) {
      el.systemWidgetSeBotPrefix.value = String(merged.streamElementsBotMessagePrefix || "");
    }
    if (el.systemWidgetTwitchClientId) el.systemWidgetTwitchClientId.value = "";
    if (el.systemWidgetTwitchUserAccessToken) el.systemWidgetTwitchUserAccessToken.value = "";
    if (el.systemWidgetTwitchBroadcasterId) el.systemWidgetTwitchBroadcasterId.value = "";
    if (el.systemWidgetRaveOffAnnounceEnabled) {
      el.systemWidgetRaveOffAnnounceEnabled.checked = merged.raveOffAnnounceEnabled !== false;
    }
    if (el.systemWidgetRaveOffAnnounceMessage) {
      el.systemWidgetRaveOffAnnounceMessage.value = String(
        merged.raveOffAnnounceMessage || widgetTemplateDefaults.raveOffAnnounceMessage
      );
    }
    if (el.systemWidgetBlockedMessage) {
      el.systemWidgetBlockedMessage.value = String(
        merged.blockedMessage || widgetTemplateDefaults.blockedMessage
      );
    }
    saveSystemWidgetTemplatePrefsToStorage();
    setSystemWidgetSensitiveFieldsReveal(false);
    setSystemWidgetTemplateStatus("Widget generator ready.");
  }

  function buildSystemWidgetTemplatePayload() {
    const prefs = collectSystemWidgetTemplatePrefsFromUi();
    return {
      colorRewardId: prefs.colorRewardId,
      widgetBundleMode: prefs.bundleMode,
      dockModOauth: prefs.dockModOauth === true,
      teachRewardId: prefs.teachRewardId,
      raveRewardId: prefs.raveRewardId,
      baseUrl: prefs.baseUrl,
      raveAutoOffMs: clampSystemWidgetRaveAutoOffSec(prefs.raveAutoOffSec) * 1000,
      raveAutoOffResetOnRepeat: prefs.raveAutoOffResetOnRepeat !== false,
      colorRaveBlockedMessage: prefs.blockedMessage,
      streamElementsBotChatEnabled: prefs.streamElementsBotChatEnabled === true,
      streamElementsBotChannelId: String(prefs.streamElementsBotChannelId || "").trim(),
      streamElementsBotJwt: String(prefs.streamElementsBotJwt || "").trim(),
      streamElementsBotMessagePrefix: String(prefs.streamElementsBotMessagePrefix || "").trim(),
      twitchStatusSyncEnabled: prefs.enableStatusSync,
      twitchClientId: prefs.twitchClientId,
      twitchUserAccessToken: prefs.twitchUserAccessToken,
      twitchBroadcasterId: prefs.twitchBroadcasterId,
      raveOffNotifyEnabled: prefs.raveOffAnnounceEnabled,
      raveOffNotifyMessage: prefs.raveOffAnnounceMessage
    };
  }

  function readModWidgetPrefsFromStorage(modId = "") {
    const id = String(modId || "").trim();
    if (!id) return {};
    try {
      const raw = localStorageRef.getItem(`ravelink_widget_template_${id}`);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function buildModWidgetTemplatePayloadFromSavedPrefs(modId = "") {
    const prefs = readModWidgetPrefsFromStorage(modId);
    return {
      songRewardId: String(prefs.songRewardId || "").trim(),
      playlistAddRewardId: String(prefs.playlistRewardId || prefs.playlistAddRewardId || "").trim(),
      baseUrl: normalizeSystemWidgetBaseUrl(prefs.baseUrl || el.systemWidgetBaseUrl?.value),
      enableChatCommands: prefs.enableChatCommands === true,
      streamElementsBotChatEnabled: prefs.seBotChatEnabled === true || prefs.streamElementsBotChatEnabled === true,
      streamElementsBotChannelId: "",
      streamElementsBotJwt: "",
      streamElementsBotMessagePrefix: String(prefs.seBotPrefix || prefs.streamElementsBotMessagePrefix || "").trim(),
      nowPlayingChatAnnouncerEnabled: prefs.nowPlayingAnnouncerEnabled !== false,
      nowPlayingChatAnnouncerIntervalMs: Math.max(500, Math.round(Number(prefs.nowPlayingAnnouncerIntervalMs || 1400)))
    };
  }

  async function maybeGenerateDockedModWidgetScript(systemScript = "", payload = {}) {
    if (String(payload.widgetBundleMode || "").toLowerCase() !== "combined") {
      return { ok: true, script: systemScript, modId: "", appended: false };
    }
    const modId = String(ui.modUiSelectedId || "music-request-engine").trim();
    if (!modId || !modsEndpointsAdapter || typeof modsEndpointsAdapter.invokeAction !== "function") {
      return { ok: false, script: systemScript, modId, appended: false, error: "No compatible mod widget generator is selected." };
    }
    const modPayload = buildModWidgetTemplatePayloadFromSavedPrefs(modId);
    const response = await modsEndpointsAdapter.invokeAction(modId, "admin_widget_template_get", "POST", modPayload);
    const body = response?.json && typeof response.json === "object" ? response.json : {};
    if (!response?.ok || body.ok !== true || typeof body.script !== "string") {
      return {
        ok: false,
        script: systemScript,
        modId,
        appended: false,
        error: String(body.error || response?.text || "mod widget generation failed")
      };
    }
    return {
      ok: true,
      script: `${systemScript}\n\n/* --- RaveLink docked mod widget: ${modId} --- */\n${body.script}`,
      modId,
      appended: true
    };
  }

  const systemWidgetOauthFlowRuntime = (typeof createSystemWidgetOauthFlowRuntimeUi === "function"
    ? createSystemWidgetOauthFlowRuntimeUi({
      el,
      windowRef,
      documentRef,
      navigatorRef,
      systemEndpointsAdapter,
      fetchRef: windowRef.fetch,
      setBadge,
      setSystemWidgetTemplateStatus,
      saveSystemWidgetTemplatePrefsToStorage
    })
    : null);

  function buildSystemWidgetTwitchAuthorizeUrl() {
    if (!systemWidgetOauthFlowRuntime || typeof systemWidgetOauthFlowRuntime.buildSystemWidgetTwitchAuthorizeUrl !== "function") {
      return { ok: false, error: "system widget oauth runtime module missing" };
    }
    return systemWidgetOauthFlowRuntime.buildSystemWidgetTwitchAuthorizeUrl();
  }

  async function openSystemWidgetOauthAuthorizeUrl() {
    if (!systemWidgetOauthFlowRuntime || typeof systemWidgetOauthFlowRuntime.openSystemWidgetOauthAuthorizeUrl !== "function") {
      setSystemWidgetTemplateStatus("OAuth helper runtime unavailable.");
      setBadge(el.health, "warn", "TWITCH OAUTH URL UNAVAILABLE");
      return false;
    }
    return systemWidgetOauthFlowRuntime.openSystemWidgetOauthAuthorizeUrl();
  }

  async function copySystemWidgetOauthAuthorizeUrl() {
    if (!systemWidgetOauthFlowRuntime || typeof systemWidgetOauthFlowRuntime.copySystemWidgetOauthAuthorizeUrl !== "function") {
      setSystemWidgetTemplateStatus("OAuth helper runtime unavailable.");
      setBadge(el.health, "warn", "TWITCH OAUTH URL UNAVAILABLE");
      return false;
    }
    return systemWidgetOauthFlowRuntime.copySystemWidgetOauthAuthorizeUrl();
  }

  function clearSystemWidgetOauthSensitiveInputs() {
    if (el.systemWidgetTwitchClientId) el.systemWidgetTwitchClientId.value = "";
    if (el.systemWidgetTwitchUserAccessToken) el.systemWidgetTwitchUserAccessToken.value = "";
    if (el.systemWidgetTwitchBroadcasterId) el.systemWidgetTwitchBroadcasterId.value = "";
  }

  const systemWidgetOauthVaultRuntime = (typeof createSystemWidgetOauthVaultRuntimeUi === "function"
    ? createSystemWidgetOauthVaultRuntimeUi({
      el,
      ui,
      systemEndpointsAdapter,
      setBadge,
      setSystemWidgetTemplateStatus,
      collectSystemWidgetTemplatePrefsFromUi,
      saveSystemWidgetTemplatePrefsToStorage,
      clearSystemWidgetOauthSensitiveInputs,
      setSystemWidgetSensitiveFieldsReveal,
      resumeSystemOauthDeviceFlowPolling: systemWidgetOauthFlowRuntime?.resumeSystemOauthDeviceFlowPolling
    })
    : (() => {
      throw new Error("system widget oauth vault runtime module missing");
    })());
  const {
    loadSystemWidgetOauthSyncProfile,
    saveSystemOauthClientIdOverride,
    clearBundledSystemOauthClientId,
    syncSystemWidgetOauthToMod,
    seedSystemWidgetOauthDevVaultFromUi,
    clearSystemWidgetOauthDevVault
  } = systemWidgetOauthVaultRuntime;

  function describeSystemWidgetTemplateActiveParams(payload = {}) {
    const active = [];
    if (payload.twitchStatusSyncEnabled === true || payload.statusSync === true) active.push("status-sync");
    if (payload.raveOffNotifyEnabled === true || payload.raveOffNotify === true) active.push("rave-off-chat");
    if (String(payload.widgetBundleMode || "").toLowerCase() === "combined") active.push("combined-widget-requested");
    if (payload.dockModOauth === true) active.push("mod-oauth-docking");
    active.push(payload.raveAutoOffResetOnRepeat === false ? "rave-timer-ignore-repeat" : "rave-timer-reset");
    return active.length ? active.join(" | ") : "baseline-only";
  }

  async function generateSystemWidgetTemplate() {
    saveSystemWidgetTemplatePrefsToStorage();
    const payload = buildSystemWidgetTemplatePayload();
    const response = await systemEndpointsAdapter.generateWidgetTemplate(payload);
    if (response.ok && response.data?.ok === true && typeof response.data?.script === "string") {
      const bundled = await maybeGenerateDockedModWidgetScript(response.data.script, payload);
      if (el.systemWidgetOutput) {
        el.systemWidgetOutput.value = bundled.script || response.data.script;
      }
      const active = describeSystemWidgetTemplateActiveParams(response.data?.active || payload);
      if (bundled.appended) {
        setSystemWidgetTemplateStatus(`Combined widget JS generated for ${bundled.modId}. Active: ${active}`);
        setBadge(el.health, "ok", "COMBINED WIDGET GENERATED");
        return true;
      }
      if (!bundled.ok) {
        setSystemWidgetTemplateStatus(`System widget generated; mod bundle skipped: ${bundled.error}`);
        setBadge(el.health, "warn", "MOD WIDGET BUNDLE SKIPPED");
        return true;
      }
      setSystemWidgetTemplateStatus(`Widget JS generated. Active: ${active}`);
      setBadge(el.health, "ok", "SYSTEM WIDGET GENERATED");
      return true;
    }
    if (el.systemWidgetOutput) {
      el.systemWidgetOutput.value = "";
    }
    const errorText = String(response.data?.error || "widget template generation failed");
    setSystemWidgetTemplateStatus(errorText);
    setBadge(el.health, "warn", "SYSTEM WIDGET GENERATOR FAILED");
    return false;
  }

  async function copySystemWidgetTemplate() {
    const text = String(el.systemWidgetOutput?.value || "").trim();
    if (!text) {
      setSystemWidgetTemplateStatus("Generate widget JS first.");
      setBadge(el.health, "warn", "NO WIDGET SCRIPT TO COPY");
      return false;
    }
    let copied = false;
    if (navigatorRef.clipboard && typeof navigatorRef.clipboard.writeText === "function") {
      try {
        await navigatorRef.clipboard.writeText(text);
        copied = true;
      } catch {
        copied = false;
      }
    }
    if (!copied && el.systemWidgetOutput) {
      el.systemWidgetOutput.focus();
      el.systemWidgetOutput.select();
      try {
        copied = documentRef.execCommand("copy");
      } catch {
        copied = false;
      }
      windowRef.getSelection?.()?.removeAllRanges?.();
    }
    if (copied) {
      setSystemWidgetTemplateStatus("Widget JS copied.");
      setBadge(el.health, "ok", "WIDGET JS COPIED");
      return true;
    }
    setSystemWidgetTemplateStatus("Clipboard copy failed. Copy manually from output.");
    setBadge(el.health, "warn", "WIDGET COPY FAILED");
    return false;
  }

  return {
    setSystemWidgetTemplateStatus,
    toggleSystemWidgetSensitiveFieldsReveal,
    saveSystemWidgetTemplatePrefsToStorage,
    restoreSystemWidgetPrefsFromStorage,
    buildSystemWidgetTemplatePayload,
    readModWidgetPrefsFromStorage,
    buildModWidgetTemplatePayloadFromSavedPrefs,
    maybeGenerateDockedModWidgetScript,
    buildSystemWidgetTwitchAuthorizeUrl,
    openSystemWidgetOauthAuthorizeUrl,
    copySystemWidgetOauthAuthorizeUrl,
    loadSystemWidgetOauthSyncProfile,
    saveSystemOauthClientIdOverride,
    clearBundledSystemOauthClientId,
    syncSystemWidgetOauthToMod,
    seedSystemWidgetOauthDevVaultFromUi,
    clearSystemWidgetOauthDevVault,
    describeSystemWidgetTemplateActiveParams,
    generateSystemWidgetTemplate,
    copySystemWidgetTemplate
  };
}
