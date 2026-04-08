// [TITLE] Module: public/assets/js/domains/audio/audio-config-app-selection-runtime-ui.js
// [TITLE] Purpose: audio app-selection curation and selector rendering
// [TITLE] Functionality Index:
// [TITLE] - likely-audio app heuristics and sorting
// [TITLE] - app selector option rendering
// [TITLE] - app-list filter hint synchronization
// [DEV] Complex Flow:
// [DEV] Keep app selection separate from config apply/collect so app-isolation
// [DEV] source curation can evolve without growing the audio config runtime.

function createAudioConfigAppSelectionRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const documentRef = deps.documentRef || document;
  const normalizeAudioAppNameUi = typeof deps.normalizeAudioAppNameUi === "function"
    ? deps.normalizeAudioAppNameUi
    : (value => String(value || "").trim());
  const normalizeAudioAppTokenUi = typeof deps.normalizeAudioAppTokenUi === "function"
    ? deps.normalizeAudioAppTokenUi
    : (value => String(value || "").trim().toLowerCase());

  const AUDIO_SELECTABLE_APP_TOKEN_HINT_RE = /(music|spotify|vlc|player|youtube|netflix|tidal|deezer|soundcloud|foobar|winamp|itunes|applemusic|firefox|chrome|msedge|brave|opera|vivaldi|discord|obs|steam|game|browser|media|audio|video)/i;
  const AUDIO_SELECTABLE_APP_TITLE_HINT_RE = /(youtube|spotify|soundcloud|tidal|deezer|music|audio|video|player|netflix|twitch|stream)/i;

  function isLikelyAudioSelectableAppUi(app) {
    if (!app || typeof app !== "object") return false;
    if (app.audioCapable === true) return true;
    const confidence = Math.max(0, Math.min(1, Number(app?.likelyAudioConfidence || 0)));
    if (confidence >= 0.55) return true;
    if (app.likelyAudio !== true) return false;

    const token = normalizeAudioAppTokenUi(app?.displayName || app?.app || app?.processName || "");
    if (token && AUDIO_SELECTABLE_APP_TOKEN_HINT_RE.test(token)) return true;

    const titles = Array.isArray(app?.windowTitles) ? app.windowTitles : [];
    return titles.some(title => AUDIO_SELECTABLE_APP_TITLE_HINT_RE.test(String(title || "")));
  }

  function compareAudioSelectableAppUi(a = {}, b = {}) {
    const aCapable = a?.audioCapable === true ? 1 : 0;
    const bCapable = b?.audioCapable === true ? 1 : 0;
    if (aCapable !== bCapable) return bCapable - aCapable;
    const aScore = Math.max(0, Math.min(1, Number(a?.likelyAudioConfidence || 0)));
    const bScore = Math.max(0, Math.min(1, Number(b?.likelyAudioConfidence || 0)));
    if (aScore !== bScore) return bScore - aScore;
    return String(a?.displayName || a?.app || a?.processName || "").localeCompare(
      String(b?.displayName || b?.app || b?.processName || "")
    );
  }

  function isAudioAppsShowAllUiEnabled() {
    if (el.aAppsShowAll) {
      const checked = el.aAppsShowAll.checked === true;
      if (ui.audioAppsShowAll !== checked) {
        ui.audioAppsShowAll = checked;
      }
      return checked;
    }
    return ui.audioAppsShowAll === true;
  }

  function getAudioSelectableAppsUi() {
    const apps = Array.isArray(ui.audioRunningApps) ? ui.audioRunningApps : [];
    if (isAudioAppsShowAllUiEnabled()) return apps;
    const configuredTokens = new Set([
      normalizeAudioAppTokenUi(el.aAppPrimary?.value || ""),
      normalizeAudioAppTokenUi(el.aAppFallback?.value || ""),
      normalizeAudioAppTokenUi(ui.audioConfiguredPrimaryApp || ""),
      normalizeAudioAppTokenUi(ui.audioConfiguredFallbackApp || "")
    ].filter(Boolean));
    const includeByToken = new Set();
    const ordered = [];
    const pushApp = app => {
      if (!app) return;
      const token = normalizeAudioAppTokenUi(app?.displayName || app?.app || app?.processName || "");
      const key = token || String(app?.displayName || app?.app || app?.processName || "").toLowerCase();
      if (!key || includeByToken.has(key)) return;
      includeByToken.add(key);
      ordered.push(app);
    };

    for (const app of apps) {
      if (app?.audioCapable === true) pushApp(app);
    }
    for (const app of apps) {
      if (isLikelyAudioSelectableAppUi(app)) pushApp(app);
    }
    if (configuredTokens.size > 0) {
      for (const app of apps) {
        const token = normalizeAudioAppTokenUi(app?.displayName || app?.app || app?.processName || "");
        if (configuredTokens.has(token)) pushApp(app);
      }
    }

    if (ordered.length) return ordered.slice().sort(compareAudioSelectableAppUi);
    if (configuredTokens.size > 0) {
      return apps.filter(app => configuredTokens.has(
        normalizeAudioAppTokenUi(app?.displayName || app?.app || app?.processName || "")
      )).sort(compareAudioSelectableAppUi);
    }
    const heuristicFallback = apps.filter(app => {
      const token = normalizeAudioAppTokenUi(app?.displayName || app?.app || app?.processName || "");
      return token && AUDIO_SELECTABLE_APP_TOKEN_HINT_RE.test(token);
    });
    if (heuristicFallback.length) return heuristicFallback.sort(compareAudioSelectableAppUi);
    return apps.slice(0, Math.min(24, apps.length)).sort(compareAudioSelectableAppUi);
  }

  function updateAudioAppsFilterHintUi() {
    if (!el.aAppsFilterHint) return;
    const showAllEnabled = isAudioAppsShowAllUiEnabled();
    const totalApps = Array.isArray(ui.audioRunningApps) ? ui.audioRunningApps.length : 0;
    const visibleApps = getAudioSelectableAppsUi().length;
    const source = String(ui.audioAppHintMeta?.source || "").trim().toLowerCase();
    const sourceText = source === "proctap_audio_processes" ? "audio-probe" : "window-fallback";
    const serverAudioOnly = ui.audioAppHintMeta?.audioOnly === true;
    const audioCapable = Array.isArray(ui.audioRunningApps)
      ? ui.audioRunningApps.filter(app => app?.audioCapable === true).length
      : 0;

    if (showAllEnabled) {
      el.aAppsFilterHint.textContent = `APP LIST MODE: all processes (${visibleApps})`;
      return;
    }
    if (serverAudioOnly) {
      el.aAppsFilterHint.textContent = `APP LIST MODE: curated likely-audio (${visibleApps}) via ${sourceText}`;
      return;
    }
    if (audioCapable > 0) {
      el.aAppsFilterHint.textContent = `APP LIST MODE: audio-capable (${visibleApps}/${totalApps}) via ${sourceText}`;
      return;
    }
    el.aAppsFilterHint.textContent = `APP LIST MODE: likely audio apps (${visibleApps}/${totalApps}) via ${sourceText}`;
  }

  function setAudioAppSelectOptions(selectNode, selectedValue = "") {
    if (!selectNode) return;
    const selected = normalizeAudioAppNameUi(selectedValue);
    const apps = getAudioSelectableAppsUi();
    const showAllEnabled = isAudioAppsShowAllUiEnabled();
    const options = [{ value: "", label: "NONE" }];
    for (const app of apps) {
      const appName = normalizeAudioAppNameUi(app?.displayName || app?.app || app?.processName || "");
      if (!appName) continue;
      const instances = Number(app?.instances || 0);
      const pids = Array.isArray(app?.pids) ? app.pids : [];
      const browserChannelHint = String(app?.browserChannelHint || "").trim().toLowerCase();
      const browserChannelLabel = browserChannelHint
        ? ` [${browserChannelHint}]`
        : "";
      const pidLabel = showAllEnabled === true && pids.length === 1
        ? ` [PID ${Math.max(0, Number(pids[0] || 0))}]`
        : "";
      const labelBase = instances > 1 ? `${appName} (${instances})` : `${appName}${pidLabel}`;
      const labelBaseWithChannel = `${labelBase}${browserChannelLabel}`;
      const confidence = Math.round(Math.max(0, Math.min(1, Number(app?.likelyAudioConfidence || 0))) * 100);
      const confidenceLabel = showAllEnabled === true
        ? ""
        : (confidence > 0 ? ` [${confidence}%]` : "");
      const suffix = showAllEnabled === true && app?.audioCapable !== true ? " [other]" : confidenceLabel;
      const label = `${labelBaseWithChannel}${suffix}`;
      options.push({ value: appName, label });
    }
    if (selected && !options.some(option => option.value.toLowerCase() === selected.toLowerCase())) {
      options.push({ value: selected, label: `${selected} (configured)` });
    }
    selectNode.innerHTML = "";
    for (const option of options) {
      const node = documentRef.createElement("option");
      node.value = option.value;
      node.textContent = option.label;
      if (selected && String(option.value).toLowerCase() === selected.toLowerCase()) {
        node.selected = true;
      }
      selectNode.appendChild(node);
    }
  }

  return {
    isLikelyAudioSelectableAppUi,
    compareAudioSelectableAppUi,
    isAudioAppsShowAllUiEnabled,
    getAudioSelectableAppsUi,
    updateAudioAppsFilterHintUi,
    setAudioAppSelectOptions
  };
}

