// [TITLE] Module: public/assets/js/domains/system/system-widget-oauth-vault-runtime-ui.js
// [TITLE] Purpose: System widget OAuth vault sync runtime
// [TITLE] Functionality Index:
// [TITLE] - System OAuth vault/profile presence normalization
// [TITLE] - System OAuth status load + Helix readiness copy
// [TITLE] - DEV-gated OAuth seed, clear, and mod sync actions
// [DEV] Complex Flow:
// [DEV] Widget OAuth vault actions are DEV-gated and sensitive. Keep credential
// [DEV] collection/wipe behavior isolated from widget template generation.

function createSystemWidgetOauthVaultRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const setBadge = typeof deps.setBadge === "function" ? deps.setBadge : (() => {});
  const setSystemWidgetTemplateStatus = typeof deps.setSystemWidgetTemplateStatus === "function"
    ? deps.setSystemWidgetTemplateStatus
    : (() => {});
  const collectSystemWidgetTemplatePrefsFromUi = typeof deps.collectSystemWidgetTemplatePrefsFromUi === "function"
    ? deps.collectSystemWidgetTemplatePrefsFromUi
    : (() => ({}));
  const saveSystemWidgetTemplatePrefsToStorage = typeof deps.saveSystemWidgetTemplatePrefsToStorage === "function"
    ? deps.saveSystemWidgetTemplatePrefsToStorage
    : (() => {});
  const clearSystemWidgetOauthSensitiveInputs = typeof deps.clearSystemWidgetOauthSensitiveInputs === "function"
    ? deps.clearSystemWidgetOauthSensitiveInputs
    : (() => {});
  const setSystemWidgetSensitiveFieldsReveal = typeof deps.setSystemWidgetSensitiveFieldsReveal === "function"
    ? deps.setSystemWidgetSensitiveFieldsReveal
    : (() => {});
  const systemEndpointsAdapter = deps.systemEndpointsAdapter;
  const requiredAdapterMethods = [
    "getSystemOauthStatus",
    "seedSystemOauthProfile",
    "clearSystemOauthProfile",
    "syncSystemOauthToMod"
  ];
  if (!systemEndpointsAdapter || typeof systemEndpointsAdapter !== "object") {
    throw new Error("system widget oauth vault runtime requires systemEndpointsAdapter");
  }
  for (const methodName of requiredAdapterMethods) {
    if (typeof systemEndpointsAdapter[methodName] !== "function") {
      throw new Error(`system widget oauth vault runtime missing adapter method: ${methodName}`);
    }
  }

  function normalizeOauthSyncProfileShape(input = {}) {
    const source = input && typeof input === "object" ? input : {};
    const profile = {
      twitchClientId: String(source.twitchClientId || "").trim(),
      twitchUserAccessToken: String(source.twitchUserAccessToken || "").trim(),
      twitchBroadcasterId: String(source.twitchBroadcasterId || "").trim()
    };
    profile.hasTwitchUserAccessToken = source.hasTwitchUserAccessToken === true || Boolean(profile.twitchUserAccessToken);
    return profile;
  }

  function getOauthSyncProfilePresence(profileInput = {}) {
    const profile = normalizeOauthSyncProfileShape(profileInput);
    return {
      twitchClientId: Boolean(profile.twitchClientId),
      twitchBroadcasterId: Boolean(profile.twitchBroadcasterId),
      twitchUserAccessToken: Boolean(profile.twitchUserAccessToken || profile.hasTwitchUserAccessToken)
    };
  }

  function formatOauthSyncPresence(label, presence = {}) {
    const fields = [];
    if (presence.twitchClientId) fields.push("clientId");
    if (presence.twitchBroadcasterId) fields.push("broadcasterId");
    if (presence.twitchUserAccessToken) fields.push("token");
    return `${label}[${fields.length ? fields.join(",") : "none"}]`;
  }

  function formatHelixReadinessSummary(helix = {}) {
    const source = helix && typeof helix === "object" ? helix : {};
    const detail = String(source.detail || "").trim();
    if (detail) return detail;
    if (source.ready === true) return "Helix reward sync is ready.";
    return "Helix reward sync is not ready yet.";
  }

  function hasAnyOauthSyncData(profileInput = {}) {
    const presence = getOauthSyncProfilePresence(profileInput);
    return Boolean(
      presence.twitchClientId ||
      presence.twitchBroadcasterId ||
      presence.twitchUserAccessToken
    );
  }

  function isOauthDevDebugEnabled() {
    return ui.devDebugMode === true;
  }

  function buildSystemWidgetOauthSyncProfilePayload() {
    const prefs = collectSystemWidgetTemplatePrefsFromUi();
    return {
      twitchClientId: String(prefs.twitchClientId || "").trim(),
      twitchUserAccessToken: String(prefs.twitchUserAccessToken || "").trim(),
      twitchBroadcasterId: String(prefs.twitchBroadcasterId || "").trim(),
      hasTwitchUserAccessToken: Boolean(String(prefs.twitchUserAccessToken || "").trim())
    };
  }

  async function fetchSystemStoredOauthSyncProfile() {
    const response = await systemEndpointsAdapter.getSystemOauthStatus();
    if (!response || response.ok !== true || response.presence == null) {
      return { ok: false, error: "system_oauth_status_load_failed" };
    }
    return {
      ok: true,
      mode: String(response.mode || "volatile_write_only"),
      hasValues: response.hasValues === true,
      presence: response.presence && typeof response.presence === "object"
        ? response.presence
        : {},
      helix: response.helix && typeof response.helix === "object"
        ? response.helix
        : {},
      updatedAt: Number(response.updatedAt || 0),
      lastSyncedAt: Number(response.lastSyncedAt || 0),
      lastSyncTarget: String(response.lastSyncTarget || "").trim()
    };
  }

  async function loadSystemWidgetOauthSyncProfile(options = {}) {
    const announce = options.announce === true;
    const status = await fetchSystemStoredOauthSyncProfile();
    if (!status.ok) {
      if (announce) {
        setSystemWidgetTemplateStatus("System OAuth status is unavailable.");
        setBadge(el.health, "warn", "SYSTEM OAUTH UNAVAILABLE");
      }
      return false;
    }
    if (announce) {
      const summary = formatOauthSyncPresence("VAULT", status.presence);
      const helixSummary = formatHelixReadinessSummary(status.helix);
      if (status.helix?.ready === true) {
        setSystemWidgetTemplateStatus(`System OAuth profile ready (${summary}). ${helixSummary}`);
        setBadge(el.health, "ok", "SYSTEM OAUTH READY");
      } else if (status.hasValues) {
        setSystemWidgetTemplateStatus(`System OAuth profile incomplete (${summary}). ${helixSummary}`);
        setBadge(el.health, "warn", "SYSTEM OAUTH INCOMPLETE");
      } else {
        setSystemWidgetTemplateStatus(`System OAuth profile empty (${summary}).`);
        setBadge(el.health, "warn", "SYSTEM OAUTH EMPTY");
      }
    }
    return true;
  }

  async function seedSystemWidgetOauthDevVaultFromUi(options = {}) {
    if (!isOauthDevDebugEnabled()) {
      setSystemWidgetTemplateStatus("Enable DEV DEBUG first to seed OAuth credentials.");
      setBadge(el.health, "warn", "DEV DEBUG REQUIRED");
      return false;
    }

    const announce = options.announce !== false;
    const payload = normalizeOauthSyncProfileShape(buildSystemWidgetOauthSyncProfilePayload());
    if (!hasAnyOauthSyncData(payload)) {
      if (announce) {
        setSystemWidgetTemplateStatus("No OAuth values entered. Provide at least one field before seeding.");
        setBadge(el.health, "warn", "DEV OAUTH INPUT EMPTY");
      }
      return false;
    }

    saveSystemWidgetTemplatePrefsToStorage();
    const response = await systemEndpointsAdapter.seedSystemOauthProfile({
      profile: payload,
      replace: false
    });
    clearSystemWidgetOauthSensitiveInputs();
    setSystemWidgetSensitiveFieldsReveal(false);
    saveSystemWidgetTemplatePrefsToStorage();

    if (!response.ok || response.data?.ok !== true) {
      const errorText = String(response.data?.error || "system_oauth_seed_failed");
      if (announce) {
        setSystemWidgetTemplateStatus(errorText);
        setBadge(el.health, "warn", "SYSTEM OAUTH SEED FAILED");
      }
      return false;
    }

    const presence = response.data?.presence && typeof response.data.presence === "object"
      ? response.data.presence
      : {};
    if (announce) {
      setSystemWidgetTemplateStatus(`System OAuth profile seeded (${formatOauthSyncPresence("PROFILE", presence)}). Inputs wiped.`);
      setBadge(el.health, "ok", "SYSTEM OAUTH SEEDED");
    }
    return true;
  }

  async function clearSystemWidgetOauthDevVault(options = {}) {
    if (!isOauthDevDebugEnabled()) {
      setSystemWidgetTemplateStatus("Enable DEV DEBUG first to clear OAuth credentials.");
      setBadge(el.health, "warn", "DEV DEBUG REQUIRED");
      return false;
    }
    const response = await systemEndpointsAdapter.clearSystemOauthProfile();
    clearSystemWidgetOauthSensitiveInputs();
    setSystemWidgetSensitiveFieldsReveal(false);
    saveSystemWidgetTemplatePrefsToStorage();
    if (!response.ok || response.data?.ok !== true) {
      const errorText = String(response.data?.error || "system_oauth_clear_failed");
      if (options.announce !== false) {
        setSystemWidgetTemplateStatus(errorText);
        setBadge(el.health, "warn", "SYSTEM OAUTH CLEAR FAILED");
      }
      return false;
    }
    if (options.announce !== false) {
      setSystemWidgetTemplateStatus("System OAuth profile cleared. Inputs wiped.");
      setBadge(el.health, "ok", "SYSTEM OAUTH CLEARED");
    }
    return true;
  }

  async function syncSystemWidgetOauthToMod() {
    if (!isOauthDevDebugEnabled()) {
      setSystemWidgetTemplateStatus("Enable DEV DEBUG first to run OAuth sync.");
      setBadge(el.health, "warn", "DEV DEBUG REQUIRED");
      return false;
    }

    const seeded = await seedSystemWidgetOauthDevVaultFromUi({ announce: false });
    if (!seeded) {
      const stored = await fetchSystemStoredOauthSyncProfile();
      if (!stored.ok || stored.hasValues !== true) {
        setSystemWidgetTemplateStatus("No OAuth values are available. Seed DEV OAuth credentials first.");
        setBadge(el.health, "warn", "DEV OAUTH VAULT EMPTY");
        return false;
      }
    }

    saveSystemWidgetTemplatePrefsToStorage();
    const response = await systemEndpointsAdapter.syncSystemOauthToMod({});
    if (!response.ok || response.data?.ok !== true) {
      const errorText = String(response.data?.error || "system_oauth_mod_sync_failed");
      setSystemWidgetTemplateStatus(errorText);
      setBadge(el.health, "warn", "SYSTEM OAUTH MOD SYNC FAILED");
      return false;
    }
    const target = String(response.data?.targetModId || "").trim();
    const status = response.data?.status && typeof response.data.status === "object"
      ? response.data.status
      : null;
    const summary = formatOauthSyncPresence("VAULT", status?.presence || {});
    setSystemWidgetTemplateStatus(
      `System OAuth sync complete. ${summary}${target ? ` -> MOD:${target}` : ""}. Credentials are now persisted in mod encrypted vault.`
    );
    setBadge(el.health, "ok", "SYSTEM OAUTH SYNCED TO MOD");
    return true;
  }

  return {
    normalizeOauthSyncProfileShape,
    getOauthSyncProfilePresence,
    formatOauthSyncPresence,
    formatHelixReadinessSummary,
    hasAnyOauthSyncData,
    isOauthDevDebugEnabled,
    buildSystemWidgetOauthSyncProfilePayload,
    fetchSystemStoredOauthSyncProfile,
    loadSystemWidgetOauthSyncProfile,
    syncSystemWidgetOauthToMod,
    seedSystemWidgetOauthDevVaultFromUi,
    clearSystemWidgetOauthDevVault
  };
}
