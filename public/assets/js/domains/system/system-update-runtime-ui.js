// [TITLE] Module: public/assets/js/domains/system/system-update-runtime-ui.js
// [TITLE] Purpose: startup/manual release-check UI runtime lane for System tab
// [TITLE] Functionality Index:
// [TITLE] - normalize release-check snapshot payloads
// [TITLE] - render update status + release-link availability
// [TITLE] - startup prompt-once behavior and manual check actions
// [DEV] Complex Flow:
// [DEV] Startup checks, prompt gating, and manual refreshes all share the same
// [DEV] normalized snapshot path so the System tab does not fork update state.

function createSystemUpdateRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const windowRef = deps.windowRef || window;
  const setBadge = typeof deps.setBadge === "function" ? deps.setBadge : (() => {});
  const systemEndpointsAdapter = deps.systemEndpointsAdapter;
  const requiredAdapterMethods = [
    "getUpdateStatus",
    "checkForUpdates",
    "applyUpdate"
  ];
  if (!systemEndpointsAdapter || typeof systemEndpointsAdapter !== "object") {
    throw new Error("system update runtime requires systemEndpointsAdapter");
  }
  for (const methodName of requiredAdapterMethods) {
    if (typeof systemEndpointsAdapter[methodName] !== "function") {
      throw new Error(`system update runtime missing adapter method: ${methodName}`);
    }
  }
  const sessionStorageFallback = (() => {
    const map = new Map();
    return {
      getItem(key) {
        const token = String(key || "");
        return map.has(token) ? map.get(token) : null;
      },
      setItem(key, value) {
        map.set(String(key || ""), String(value || ""));
      }
    };
  })();
  const sessionStorageRef = (
    deps.sessionStorageRef &&
    typeof deps.sessionStorageRef.getItem === "function" &&
    typeof deps.sessionStorageRef.setItem === "function"
  )
    ? deps.sessionStorageRef
    : sessionStorageFallback;

  let startupUpdatePromptHandled = false;
  let startupPromptRetryTimer = null;
  let startupPromptRetryCount = 0;

  function normalizeBooleanSelectValue(value, fallback = true) {
    const token = String(value || "").trim().toLowerCase();
    if (!token) return fallback === true;
    if (token === "true" || token === "1" || token === "yes" || token === "on") return true;
    if (token === "false" || token === "0" || token === "no" || token === "off") return false;
    return fallback === true;
  }

  function normalizeSystemUpdateSnapshot(input = {}) {
    const source = input && typeof input === "object" ? input : {};
    const startup = source.startup && typeof source.startup === "object" ? source.startup : {};
    const lastCheck = source.lastCheck && typeof source.lastCheck === "object" ? source.lastCheck : {};
    const latest = lastCheck.latest && typeof lastCheck.latest === "object" ? lastCheck.latest : {};
    return {
      ok: source.ok === true,
      currentVersion: String(source.currentVersion || "").trim(),
      preferences: source.preferences && typeof source.preferences === "object"
        ? {
          updateChecksEnabled: source.preferences.updateChecksEnabled !== false,
          updateStartupPromptEnabled: source.preferences.updateStartupPromptEnabled !== false
        }
        : null,
      startup: {
        launchAt: Number(startup.launchAt || 0),
        attempted: startup.attempted === true,
        inFlight: startup.inFlight === true,
        completedAt: Number(startup.completedAt || 0)
      },
      apply: source.apply && typeof source.apply === "object"
        ? {
          inFlight: source.apply.inFlight === true,
          lastAttemptAt: Number(source.apply.lastAttemptAt || 0),
          lastCompletedAt: Number(source.apply.lastCompletedAt || 0),
          lastError: String(source.apply.lastError || "").trim(),
          lastResult: source.apply.lastResult && typeof source.apply.lastResult === "object"
            ? {
              ok: source.apply.lastResult.ok === true,
              installId: String(source.apply.lastResult.installId || "").trim(),
              fromVersion: String(source.apply.lastResult.fromVersion || "").trim(),
              toVersion: String(source.apply.lastResult.toVersion || "").trim(),
              requiresRestart: source.apply.lastResult.requiresRestart !== false
            }
            : null
        }
        : {
          inFlight: false,
          lastAttemptAt: 0,
          lastCompletedAt: 0,
          lastError: "",
          lastResult: null
        },
      lastCheck: {
        ok: lastCheck.ok === true,
        mode: String(lastCheck.mode || "none").trim().toLowerCase() || "none",
        checkedAt: Number(lastCheck.checkedAt || 0),
        updateAvailable: lastCheck.updateAvailable === true,
        error: String(lastCheck.error || "").trim(),
        detail: String(lastCheck.detail || "").trim(),
        latest: {
          tagName: String(latest.tagName || "").trim(),
          version: String(latest.version || "").trim(),
          name: String(latest.name || "").trim(),
          releaseUrl: String(latest.releaseUrl || "").trim(),
          prerelease: latest.prerelease === true,
          draft: latest.draft === true,
          publishedAt: Number(latest.publishedAt || 0)
        }
      }
    };
  }

  function applyUpdatePreferenceUi() {
    if (el.systemUpdateChecksEnabled) {
      el.systemUpdateChecksEnabled.value = ui.serverUpdateChecksEnabled ? "true" : "false";
    }
    if (el.systemUpdateStartupPromptEnabled) {
      el.systemUpdateStartupPromptEnabled.value = ui.serverUpdateStartupPromptEnabled ? "true" : "false";
    }
  }

  function getSystemUpdateReleaseUrlFromSnapshot(snapshot = {}) {
    return String(snapshot?.lastCheck?.latest?.releaseUrl || "").trim();
  }

  function isSameVersionHotfixSnapshot(snapshot = {}) {
    const current = String(snapshot?.currentVersion || "").trim();
    const latest = String(snapshot?.lastCheck?.latest?.version || snapshot?.lastCheck?.latest?.tagName || "").trim();
    const detail = String(snapshot?.lastCheck?.detail || "").trim().toLowerCase();
    return detail === "same_version_hotfix_available" && !!current && current === latest;
  }

  function renderSystemUpdateStatus(snapshot = null) {
    const normalized = normalizeSystemUpdateSnapshot(snapshot || ui.systemUpdateStatusSnapshot || {});
    ui.systemUpdateStatusSnapshot = normalized;
    const checkedAtLabel = Number(normalized.lastCheck.checkedAt || 0) > 0
      ? new Date(Number(normalized.lastCheck.checkedAt || 0)).toLocaleTimeString()
      : "-";

    let text = "UPDATE CHECK READY";
    if (normalized.startup.inFlight) {
      text = "CHECKING RELEASES...";
    } else if (normalized.apply.inFlight) {
      text = "APPLYING UPDATE...";
    } else if (normalized.lastCheck.ok !== true && normalized.lastCheck.error) {
      text = `UPDATE CHECK FAILED | ${String(normalized.lastCheck.error || "").toUpperCase()}`;
    } else if (normalized.apply.lastResult && normalized.apply.lastResult.ok === true) {
      const fromVersion = normalized.apply.lastResult.fromVersion || normalized.currentVersion || "unknown";
      const toVersion = normalized.apply.lastResult.toVersion || normalized.currentVersion || "unknown";
      text = `UPDATE APPLIED | ${fromVersion} -> ${toVersion} | RESTART SERVER TO COMPLETE`;
    } else if (normalized.apply.lastError) {
      text = `UPDATE APPLY FAILED | ${String(normalized.apply.lastError || "").toUpperCase()}`;
    } else if (normalized.lastCheck.ok === true && normalized.lastCheck.updateAvailable === true) {
      const current = normalized.currentVersion || "unknown";
      const latest = normalized.lastCheck.latest.version || normalized.lastCheck.latest.tagName || "unknown";
      text = isSameVersionHotfixSnapshot(normalized)
        ? `HOTFIX AVAILABLE | ${current} | CHECKED ${checkedAtLabel}`
        : `UPDATE AVAILABLE | ${current} -> ${latest} | CHECKED ${checkedAtLabel}`;
    } else if (normalized.lastCheck.ok === true) {
      const current = normalized.currentVersion || "unknown";
      text = `UP TO DATE (${current}) | CHECKED ${checkedAtLabel}`;
    }

    if (el.systemUpdateStatus) {
      el.systemUpdateStatus.value = text;
    }
    if (el.systemUpdateOpenReleaseBtn) {
      el.systemUpdateOpenReleaseBtn.disabled = !getSystemUpdateReleaseUrlFromSnapshot(normalized);
    }
    if (el.systemUpdateApplyBtn) {
      el.systemUpdateApplyBtn.disabled = (
        normalized.apply.inFlight === true ||
        normalized.lastCheck.ok !== true ||
        normalized.lastCheck.updateAvailable !== true
      );
    }
  }

  function getStartupUpdatePromptSessionKey(snapshot = {}) {
    const launchAt = Number(snapshot?.startup?.launchAt || 0);
    const checkedAt = Number(snapshot?.lastCheck?.checkedAt || 0);
    if (launchAt <= 0 || checkedAt <= 0) return "";
    return `ravelink_update_prompt_v1_${launchAt}_${checkedAt}`;
  }

  function shouldShowStartupUpdatePrompt(snapshot = {}) {
    if (startupUpdatePromptHandled) return false;
    if (ui.serverUpdateChecksEnabled !== true) return false;
    if (ui.serverUpdateStartupPromptEnabled !== true) return false;
    const lastCheck = snapshot.lastCheck && typeof snapshot.lastCheck === "object"
      ? snapshot.lastCheck
      : {};
    if (lastCheck.ok !== true || lastCheck.updateAvailable !== true) return false;
    if (String(lastCheck.mode || "").trim().toLowerCase() !== "startup") return false;
    const promptKey = getStartupUpdatePromptSessionKey(snapshot);
    if (!promptKey) return false;
    try {
      if (sessionStorageRef.getItem(promptKey) === "1") return false;
    } catch {
      // ignore session storage read failures
    }
    return true;
  }

  function markStartupUpdatePromptShown(snapshot = {}) {
    startupUpdatePromptHandled = true;
    const promptKey = getStartupUpdatePromptSessionKey(snapshot);
    if (!promptKey) return;
    try {
      sessionStorageRef.setItem(promptKey, "1");
    } catch {
      // ignore session storage write failures
    }
  }

  async function maybePromptForStartupUpdate(snapshot = {}) {
    if (!shouldShowStartupUpdatePrompt(snapshot)) return false;
    markStartupUpdatePromptShown(snapshot);
    const current = String(snapshot.currentVersion || "unknown");
    const latest = String(snapshot?.lastCheck?.latest?.version || snapshot?.lastCheck?.latest?.tagName || "unknown");
    const releaseUrl = String(snapshot?.lastCheck?.latest?.releaseUrl || "").trim();
    const hotfixLabel = isSameVersionHotfixSnapshot(snapshot)
      ? `${latest} hotfix`
      : latest;
    const message =
      `New RaveLink update detected (${current} -> ${hotfixLabel}).\n\n` +
      `Apply the update now?\n\n` +
      `RaveLink will stage the update in place and ask for a restart when complete.\n\n` +
      `Tip: set STARTUP UPDATE PROMPTS to disabled in System settings if you don't want startup prompts.`;
    const applyNow = windowRef.confirm(message);
    if (applyNow) {
      return applySystemUpdate({ announce: true, forceCheck: false });
    }
    if (releaseUrl) {
      const openReleaseNotes = windowRef.confirm(
        "Open the release page instead so you can review the update before applying it?"
      );
      if (openReleaseNotes) {
        windowRef.open(releaseUrl, "_blank", "noopener");
        setBadge(el.health, "ok", "UPDATE PAGE OPENED");
        return true;
      }
    }
    return false;
  }

  async function loadSystemUpdateStatus(options = {}) {
    const response = await systemEndpointsAdapter.getUpdateStatus();
    if (!response || response.ok !== true) {
      renderSystemUpdateStatus({});
      if (options.announce === true) {
        setBadge(el.health, "warn", "UPDATE STATUS UNAVAILABLE");
      }
      return false;
    }
    const snapshot = normalizeSystemUpdateSnapshot(response);
    if (snapshot.preferences) {
      ui.serverUpdateChecksEnabled = snapshot.preferences.updateChecksEnabled !== false;
      ui.serverUpdateStartupPromptEnabled = snapshot.preferences.updateStartupPromptEnabled !== false;
    }
    applyUpdatePreferenceUi();
    renderSystemUpdateStatus(snapshot);
    if (options.triggerStartupPrompt === true) {
      if (snapshot.startup.inFlight === true) {
        if (startupPromptRetryCount < 8) {
          startupPromptRetryCount += 1;
          if (startupPromptRetryTimer) {
            clearTimeout(startupPromptRetryTimer);
            startupPromptRetryTimer = null;
          }
          startupPromptRetryTimer = setTimeout(() => {
            loadSystemUpdateStatus({
              announce: false,
              triggerStartupPrompt: true
            }).catch(() => {});
          }, 1200);
        }
      } else {
        startupPromptRetryCount = 0;
        if (startupPromptRetryTimer) {
          clearTimeout(startupPromptRetryTimer);
          startupPromptRetryTimer = null;
        }
      }
    }
    if (options.triggerStartupPrompt === true) {
      await maybePromptForStartupUpdate(snapshot);
    }
    if (options.announce === true) {
      if (snapshot.lastCheck.ok === true && snapshot.lastCheck.updateAvailable === true) {
        setBadge(el.health, "warn", "UPDATE AVAILABLE");
      } else if (snapshot.lastCheck.ok === true) {
        setBadge(el.health, "ok", "UPDATES CHECKED");
      } else {
        setBadge(el.health, "warn", "UPDATE CHECK FAILED");
      }
    }
    return true;
  }

  async function runSystemUpdateCheck(options = {}) {
    const response = await systemEndpointsAdapter.checkForUpdates({
      force: options.force === true
    });
    if (!response.ok || response.data?.ok !== true) {
      const errorText = String(response.data?.error || "update_check_failed");
      renderSystemUpdateStatus({
        ok: false,
        lastCheck: {
          ok: false,
          error: errorText
        }
      });
      if (options.announce !== false) {
        setBadge(el.health, "warn", "UPDATE CHECK FAILED");
      }
      return false;
    }
    const snapshot = normalizeSystemUpdateSnapshot(response.data);
    if (snapshot.preferences) {
      ui.serverUpdateChecksEnabled = snapshot.preferences.updateChecksEnabled !== false;
      ui.serverUpdateStartupPromptEnabled = snapshot.preferences.updateStartupPromptEnabled !== false;
    }
    applyUpdatePreferenceUi();
    renderSystemUpdateStatus(snapshot);
    if (options.announce !== false) {
      if (snapshot.lastCheck.updateAvailable === true) {
        setBadge(el.health, "warn", "UPDATE AVAILABLE");
      } else {
        setBadge(el.health, "ok", "UP TO DATE");
      }
    }
    return true;
  }

  async function applySystemUpdate(options = {}) {
    const response = await systemEndpointsAdapter.applyUpdate({
      forceCheck: options.forceCheck === true
    });
    if (!response.ok || response.data?.ok !== true) {
      const errorText = String(response.data?.error || "update_apply_failed");
      const detailText = String(response.data?.detail || "").trim();
      renderSystemUpdateStatus({
        ok: false,
        apply: {
          inFlight: false,
          lastError: detailText || errorText
        },
        lastCheck: ui.systemUpdateStatusSnapshot?.lastCheck || {}
      });
      if (options.announce !== false) {
        setBadge(el.health, "warn", "UPDATE APPLY FAILED");
      }
      return false;
    }
    const snapshot = normalizeSystemUpdateSnapshot(response.data);
    if (snapshot.preferences) {
      ui.serverUpdateChecksEnabled = snapshot.preferences.updateChecksEnabled !== false;
      ui.serverUpdateStartupPromptEnabled = snapshot.preferences.updateStartupPromptEnabled !== false;
    }
    applyUpdatePreferenceUi();
    renderSystemUpdateStatus(snapshot);
    if (options.announce !== false) {
      setBadge(el.health, "warn", "UPDATE APPLIED - RESTART REQUIRED");
    }
    return true;
  }

  function openSystemUpdateReleasePage() {
    const releaseUrl = getSystemUpdateReleaseUrlFromSnapshot(ui.systemUpdateStatusSnapshot || {});
    if (!releaseUrl) return false;
    windowRef.open(releaseUrl, "_blank", "noopener");
    return true;
  }

  return {
    normalizeBooleanSelectValue,
    renderSystemUpdateStatus,
    loadSystemUpdateStatus,
    runSystemUpdateCheck,
    applySystemUpdate,
    openSystemUpdateReleasePage
  };
}
