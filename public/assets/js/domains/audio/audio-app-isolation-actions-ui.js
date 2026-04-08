// [TITLE] Module: public/assets/js/domains/audio/audio-app-isolation-actions-ui.js
// [TITLE] Purpose: audio app-isolation interaction and mutation event wiring
// [TITLE] Functionality Index:
// [TITLE] - capture mode, app-list mode, and app target wiring
// [TITLE] - app isolation scan/apply/manual lock actions
// [TITLE] - companion subprocess suggestion + auto-apply triggers
// [DEV] Complex Flow:
// [DEV] This module owns only the audio app-isolation interaction layer. Audio config
// [DEV] loaders, mutation helpers, and status formatting remain injected from audio.js so
// [DEV] the same backend contracts are reused without duplicating runtime rules.

function createAudioAppIsolationActionsUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const windowRef = deps.windowRef || window;
  const localStorageRef = deps.localStorageRef || localStorage;
  const AUDIO_SIMPLE_MODE_KEY = String(deps.AUDIO_SIMPLE_MODE_KEY || 'ravelink_audio_simple_mode_v1');
  const AUDIO_APPS_SHOW_ALL_KEY = String(deps.AUDIO_APPS_SHOW_ALL_KEY || 'ravelink_audio_apps_show_all_v1');
  const AUDIO_OPTIONAL_TOOLS_DISMISS_KEY = String(deps.AUDIO_OPTIONAL_TOOLS_DISMISS_KEY || 'ravelink_audio_optional_tools_dismissed_v1');
  const isAudioCaptureModeAppIsolationUiEnabled = typeof deps.isAudioCaptureModeAppIsolationUiEnabled === 'function' ? deps.isAudioCaptureModeAppIsolationUiEnabled : (() => false);
  const syncAudioCaptureModeUi = typeof deps.syncAudioCaptureModeUi === 'function' ? deps.syncAudioCaptureModeUi : (() => {});
  const updateAudioCaptureGuidanceUi = typeof deps.updateAudioCaptureGuidanceUi === 'function' ? deps.updateAudioCaptureGuidanceUi : (() => {});
  const cancelQueuedAudioAppIsolationAutoApply = typeof deps.cancelQueuedAudioAppIsolationAutoApply === 'function' ? deps.cancelQueuedAudioAppIsolationAutoApply : (() => {});
  const applyAudioAppIsolationPatch = typeof deps.applyAudioAppIsolationPatch === 'function' ? deps.applyAudioAppIsolationPatch : (async () => false);
  const setBadge = typeof deps.setBadge === 'function' ? deps.setBadge : (() => {});
  const announceAudioActionStatus = typeof deps.announceAudioActionStatus === 'function' ? deps.announceAudioActionStatus : (() => {});
  const syncAudioRoutingComplexityUi = typeof deps.syncAudioRoutingComplexityUi === 'function' ? deps.syncAudioRoutingComplexityUi : (() => {});
  const setAudioAppSelectOptions = typeof deps.setAudioAppSelectOptions === 'function' ? deps.setAudioAppSelectOptions : (() => {});
  const updateAudioAppsFilterHintUi = typeof deps.updateAudioAppsFilterHintUi === 'function' ? deps.updateAudioAppsFilterHintUi : (() => {});
  const isAudioAppsShowAllUiEnabled = typeof deps.isAudioAppsShowAllUiEnabled === 'function' ? deps.isAudioAppsShowAllUiEnabled : (() => false);
  const loadAudioApps = typeof deps.loadAudioApps === 'function' ? deps.loadAudioApps : (async () => false);
  const getAudioSelectableAppsUi = typeof deps.getAudioSelectableAppsUi === 'function' ? deps.getAudioSelectableAppsUi : (() => []);
  const openAudioOptionalToolsHelp = typeof deps.openAudioOptionalToolsHelp === 'function' ? deps.openAudioOptionalToolsHelp : (() => {});
  const renderAudioOptionalToolsBanner = typeof deps.renderAudioOptionalToolsBanner === 'function' ? deps.renderAudioOptionalToolsBanner : (() => {});
  const runAudioButtonActionWithResult = typeof deps.runAudioButtonActionWithResult === 'function' ? deps.runAudioButtonActionWithResult : (async (_btn, _pending, action) => action());
  const loadAudioConfig = typeof deps.loadAudioConfig === 'function' ? deps.loadAudioConfig : (async () => false);
  const loadAudioReactivityMap = typeof deps.loadAudioReactivityMap === 'function' ? deps.loadAudioReactivityMap : (async () => false);
  const loadAudioOptionalToolsStatus = typeof deps.loadAudioOptionalToolsStatus === 'function' ? deps.loadAudioOptionalToolsStatus : (async () => false);
  const loadAudioDevices = typeof deps.loadAudioDevices === 'function' ? deps.loadAudioDevices : (async () => false);
  const loadAudioProfiles = typeof deps.loadAudioProfiles === 'function' ? deps.loadAudioProfiles : (async () => false);
  const formatAudioActiveConfigSummaryUi = typeof deps.formatAudioActiveConfigSummaryUi === 'function' ? deps.formatAudioActiveConfigSummaryUi : (() => '');
  const forceAudioAppIsolationScan = typeof deps.forceAudioAppIsolationScan === 'function' ? deps.forceAudioAppIsolationScan : (async () => ({ ok: false }));
  const formatAudioAppIsoScanSummary = typeof deps.formatAudioAppIsoScanSummary === 'function' ? deps.formatAudioAppIsoScanSummary : (() => '');
  const setAppIsolationLock = typeof deps.setAppIsolationLock === "function"
    ? deps.setAppIsolationLock
    : (async () => ({ ok: false, data: null }));
  const clearAppIsolationLock = typeof deps.clearAppIsolationLock === "function"
    ? deps.clearAppIsolationLock
    : (async () => ({ ok: false, data: null }));
  const getAudioSelectedPrimaryAppTokenUi = typeof deps.getAudioSelectedPrimaryAppTokenUi === 'function' ? deps.getAudioSelectedPrimaryAppTokenUi : (() => '');
  const normalizeAudioAppTokenUi = typeof deps.normalizeAudioAppTokenUi === 'function' ? deps.normalizeAudioAppTokenUi : (value => String(value || '').trim().toLowerCase());
  const formatAudioApiErrorWithHint = typeof deps.formatAudioApiErrorWithHint === 'function' ? deps.formatAudioApiErrorWithHint : ((_r, fallback) => String(fallback || 'request failed'));
  const normalizeAudioManualLockMapUi = typeof deps.normalizeAudioManualLockMapUi === 'function' ? deps.normalizeAudioManualLockMapUi : (value => value && typeof value === 'object' ? value : {});
  const syncAudioManualCaptureInputUi = typeof deps.syncAudioManualCaptureInputUi === 'function' ? deps.syncAudioManualCaptureInputUi : (() => {});
  const clearAudioApplyAttention = typeof deps.clearAudioApplyAttention === 'function' ? deps.clearAudioApplyAttention : (() => {});
  const AUDIO_APPLY_ATTENTION_KEY_MANUAL = String(deps.AUDIO_APPLY_ATTENTION_KEY_MANUAL || 'manual');
  const renderAudioManualCaptureAssistUi = typeof deps.renderAudioManualCaptureAssistUi === 'function' ? deps.renderAudioManualCaptureAssistUi : (() => {});
  const markAudioApplyAttention = typeof deps.markAudioApplyAttention === 'function' ? deps.markAudioApplyAttention : (() => {});
  const queueAudioAppIsolationAutoApply = typeof deps.queueAudioAppIsolationAutoApply === 'function' ? deps.queueAudioAppIsolationAutoApply : (() => {});
  const syncRustLoopbackFormatHintUi = typeof deps.syncRustLoopbackFormatHintUi === 'function' ? deps.syncRustLoopbackFormatHintUi : (() => {});
  const normalizeRustLoopbackFormatUi = typeof deps.normalizeRustLoopbackFormatUi === 'function' ? deps.normalizeRustLoopbackFormatUi : (value => String(value || '').trim().toLowerCase());
  const updateAudioAppIsolationStatusText = typeof deps.updateAudioAppIsolationStatusText === 'function' ? deps.updateAudioAppIsolationStatusText : (() => {});
  const sync = typeof deps.sync === 'function' ? deps.sync : (() => {});

  function wireAudioAppIsolationActionsUi() {
    if (el.aCaptureModeDesktop || el.aCaptureModeAppIso) {
      let audioCaptureModeApplyInFlight = false;
      const onCaptureModeChanged = async () => {
        if (audioCaptureModeApplyInFlight) return;
        const appIsoEnabled = isAudioCaptureModeAppIsolationUiEnabled();
        if (el.aAppIsolationEnabled) {
          el.aAppIsolationEnabled.checked = appIsoEnabled;
        }
        syncAudioCaptureModeUi({ appIsoEnabled, updateStatus: true });
        updateAudioCaptureGuidanceUi();
        cancelQueuedAudioAppIsolationAutoApply();
        audioCaptureModeApplyInFlight = true;
        const reason = appIsoEnabled ? "APP ISOLATION MODE" : "DESKTOP LISTEN MODE";
        try {
          const ok = await applyAudioAppIsolationPatch(reason, { forceScan: appIsoEnabled });
          if (ok) {
            setBadge(el.health, "ok", appIsoEnabled ? "APP ISOLATION MODE ACTIVE" : "DESKTOP LISTEN MODE ACTIVE");
            announceAudioActionStatus(
              appIsoEnabled ? "APP ISOLATION MODE APPLIED" : "DESKTOP LISTEN MODE APPLIED",
              2200
            );
          } else {
            setBadge(el.health, "bad", `${reason} APPLY FAIL`);
            announceAudioActionStatus(`${reason} APPLY FAILED`, 2800);
          }
        } finally {
          audioCaptureModeApplyInFlight = false;
        }
      };
      if (el.aCaptureModeDesktop) {
        el.aCaptureModeDesktop.addEventListener("change", onCaptureModeChanged);
      }
      if (el.aCaptureModeAppIso) {
        el.aCaptureModeAppIso.addEventListener("change", onCaptureModeChanged);
      }
    }
    
    if (el.aIsoSimpleMode) {
      el.aIsoSimpleMode.checked = ui.audioSimpleRoutingMode !== false;
      el.aIsoSimpleMode.onchange = () => {
        ui.audioSimpleRoutingMode = el.aIsoSimpleMode.checked === true;
        localStorageRef.setItem(AUDIO_SIMPLE_MODE_KEY, ui.audioSimpleRoutingMode ? "1" : "0");
        syncAudioRoutingComplexityUi();
      };
    }
    
    let audioAppsShowAllToggleInFlight = false;
    if (el.aAppsShowAll) {
      el.aAppsShowAll.checked = ui.audioAppsShowAll === true;
      const onAppsShowAllChanged = async () => {
        if (audioAppsShowAllToggleInFlight) return;
        audioAppsShowAllToggleInFlight = true;
        try {
          const nextShowAll = el.aAppsShowAll.checked === true;
          ui.audioAppsShowAll = nextShowAll;
          localStorageRef.setItem(AUDIO_APPS_SHOW_ALL_KEY, ui.audioAppsShowAll ? "1" : "0");
          setAudioAppSelectOptions(el.aAppPrimary, el.aAppPrimary?.value || "");
          setAudioAppSelectOptions(el.aAppFallback, el.aAppFallback?.value || "");
          updateAudioAppsFilterHintUi();
          const refreshed = await loadAudioApps({
            applyTelemetry: false,
            showAllOverride: nextShowAll,
            forceRefresh: true
          });
          if (!refreshed) {
            setAudioAppSelectOptions(el.aAppPrimary, el.aAppPrimary?.value || "");
            setAudioAppSelectOptions(el.aAppFallback, el.aAppFallback?.value || "");
            updateAudioAppsFilterHintUi();
            setBadge(el.health, "warn", "APP LIST MODE CHANGED (REFRESH FAIL)");
            announceAudioActionStatus("APP LIST MODE UPDATED | REFRESH FAILED", 2600);
          } else {
            const totalApps = Array.isArray(ui.audioRunningApps) ? ui.audioRunningApps.length : 0;
            const visibleApps = getAudioSelectableAppsUi().length;
            setBadge(el.health, "ok", nextShowAll ? "APP LIST MODE: SHOW ALL" : "APP LIST MODE: CURATED");
            announceAudioActionStatus(
              nextShowAll
                ? `APP LIST MODE: SHOW ALL | ${visibleApps}/${totalApps}`
                : `APP LIST MODE: CURATED LIKELY-AUDIO | ${visibleApps}/${totalApps}`,
              2200
            );
          }
        } finally {
          audioAppsShowAllToggleInFlight = false;
        }
      };
      el.aAppsShowAll.addEventListener("change", onAppsShowAllChanged);
    }
    
    if (el.aOptionalToolsInfoBtn) {
      el.aOptionalToolsInfoBtn.onclick = () => {
        openAudioOptionalToolsHelp();
      };
    }
    
    if (el.aOptionalToolsDismissBtn) {
      el.aOptionalToolsDismissBtn.onclick = () => {
        ui.audioOptionalToolsDismissed = true;
        localStorageRef.setItem(AUDIO_OPTIONAL_TOOLS_DISMISS_KEY, "1");
        renderAudioOptionalToolsBanner();
      };
    }
    
    
    if (el.aRefreshBtn) {
      el.aRefreshBtn.onclick = async () => {
        await runAudioButtonActionWithResult(el.aRefreshBtn, "REFRESHING...", async () => {
          announceAudioActionStatus("AUDIO REFRESH | WORKING...", 1200);
          const [cfgOk, reactOk, appsOk, optionalOk, devicesOk, profilesOk] = await Promise.all([
            loadAudioConfig(),
            loadAudioReactivityMap(),
            loadAudioApps(),
            loadAudioOptionalToolsStatus(),
            loadAudioDevices(),
            loadAudioProfiles({ silent: true, syncNameInput: false })
          ]);
          const ok = cfgOk && reactOk && appsOk && optionalOk && devicesOk && profilesOk;
          setBadge(el.health, ok ? "ok" : "bad", ok ? "AUDIO CFG+REACT+DEV REFRESH" : "AUDIO REFRESH FAIL");
          const summary = formatAudioActiveConfigSummaryUi();
          const scannedCount = Math.max(0, Number(ui.audioLastDeviceScanCount || 0));
          announceAudioActionStatus(
            ok
              ? `AUDIO REFRESHED${summary ? ` | ${summary}` : ""} | DEVICES ${scannedCount}`
              : "AUDIO REFRESH FAILED",
            2800
          );
          return {
            ok,
            labelOk: "REFRESHED",
            labelFail: "REFRESH FAIL"
          };
        });
      };
    }
    
    if (el.aScanBtn) {
      el.aScanBtn.onclick = async () => {
        await runAudioButtonActionWithResult(el.aScanBtn, "SCANNING...", async () => {
          announceAudioActionStatus("AUDIO DEVICE SCAN | WORKING...", 1200);
          const ok = await loadAudioDevices();
          setBadge(el.health, ok ? "ok" : "bad", ok ? "AUDIO DEVICES SCANNED" : "AUDIO SCAN FAIL");
          const scannedCount = Math.max(0, Number(ui.audioLastDeviceScanCount || 0));
          announceAudioActionStatus(
            ok
              ? `AUDIO DEVICES SCANNED | ${scannedCount} DEVICE${scannedCount === 1 ? "" : "S"}`
              : "AUDIO DEVICE SCAN FAILED",
            2800
          );
          return {
            ok,
            labelOk: "SCANNED",
            labelFail: "SCAN FAIL"
          };
        });
      };
    }
    
    if (el.aAppsRefreshBtn) {
      el.aAppsRefreshBtn.onclick = async () => {
        await runAudioButtonActionWithResult(el.aAppsRefreshBtn, "REFRESHING...", async () => {
          announceAudioActionStatus("APP LIST REFRESHING...", 1400);
          const showAllEnabled = isAudioAppsShowAllUiEnabled();
          const listOk = await loadAudioApps({
            forceRefresh: true,
            showAllOverride: showAllEnabled
          });
          if (!listOk) {
            setBadge(el.health, "bad", "APP LIST REFRESH FAIL");
            announceAudioActionStatus("APP LIST REFRESH FAILED", 3200);
            return {
              ok: false,
              labelFail: "REFRESH FAIL"
            };
          }
          if (!isAudioCaptureModeAppIsolationUiEnabled()) {
            const totalApps = Array.isArray(ui.audioRunningApps) ? ui.audioRunningApps.length : 0;
            const visibleApps = getAudioSelectableAppsUi().length;
            setBadge(el.health, "ok", "APP LIST REFRESHED");
            announceAudioActionStatus(
              showAllEnabled
                ? `APP LIST REFRESHED | MODE SHOW ALL | ${visibleApps}/${totalApps}`
                : `APP LIST REFRESHED | MODE CURATED LIKELY-AUDIO | ${visibleApps}/${totalApps}`,
              3000
            );
            return {
              ok: true,
              labelOk: "REFRESHED"
            };
          }
          const scanResult = await forceAudioAppIsolationScan({
            reason: "ui_refresh_status",
            apply: false,
            force: true,
            reloadApps: false
          });
          if (scanResult?.ok) {
            setBadge(el.health, "ok", "APP LIST REFRESHED");
            announceAudioActionStatus(formatAudioAppIsoScanSummary("APP LIST REFRESHED", scanResult), 3000);
            return {
              ok: true,
              labelOk: "REFRESHED"
            };
          }
          const reason = String(scanResult?.error || "scan unavailable");
          setBadge(el.health, "warn", "APP LIST REFRESHED (ISO STATUS FAIL)");
          announceAudioActionStatus(`APP LIST REFRESHED | ISO STATUS FAIL | ${reason}`, 3200);
          return {
            ok: false,
            labelFail: "STATUS FAIL"
          };
        });
      };
    }
    
    if (el.liveAudioAppSearchBtn) {
      el.liveAudioAppSearchBtn.onclick = async () => {
        await runAudioButtonActionWithResult(el.liveAudioAppSearchBtn, "SEARCHING...", async () => {
          announceAudioActionStatus("APP ISOLATION SEARCH | WORKING...", 1300);
          const result = await forceAudioAppIsolationScan({ reason: "ui_live_search" });
          const ok = result?.ok === true;
          setBadge(
            el.health,
            ok ? "ok" : "bad",
            ok ? "APP ISOLATION SEARCH APPLIED" : "APP ISOLATION SEARCH FAIL"
          );
          announceAudioActionStatus(
            ok
              ? formatAudioAppIsoScanSummary("APP ISOLATION SEARCH APPLIED", result)
              : `APP ISOLATION SEARCH FAILED | ${String(result?.error || "scan unavailable")}`,
            3000
          );
          return {
            ok,
            labelOk: "SEARCHED",
            labelFail: "SEARCH FAIL"
          };
        });
      };
    }
    
    if (el.aAppIsoManualSetBtn) {
      el.aAppIsoManualSetBtn.onclick = async () => {
        await runAudioButtonActionWithResult(el.aAppIsoManualSetBtn, "LOCKING...", async () => {
          const sourceToken = getAudioSelectedPrimaryAppTokenUi();
          const captureToken = normalizeAudioAppTokenUi(el.aAppIsoManualCaptureToken?.value || "");
          if (!sourceToken) {
            setBadge(el.health, "warn", "MANUAL CAPTURE NEEDS MAIN APP");
            announceAudioActionStatus("MANUAL CAPTURE FAILED | SELECT MAIN APP FIRST", 3200);
            return {
              ok: false,
              labelFail: "NEED APP"
            };
          }
          if (!captureToken) {
            setBadge(el.health, "warn", "MANUAL CAPTURE NEEDS PROCESS");
            announceAudioActionStatus("MANUAL CAPTURE FAILED | ENTER CAPTURE PROCESS TOKEN", 3200);
            return {
              ok: false,
              labelFail: "NEED TOKEN"
            };
          }
    
          const r = await setAppIsolationLock({
            sourceToken,
            captureToken,
            restart: true
          });
          if (!r.ok || r.data?.ok === false) {
            setBadge(el.health, "bad", "MANUAL CAPTURE LOCK FAIL");
            announceAudioActionStatus(
              `MANUAL CAPTURE LOCK FAILED | ${formatAudioApiErrorWithHint(r, "manual lock rejected")}`,
              3600
            );
            return {
              ok: false,
              labelFail: "LOCK FAIL"
            };
          }
    
          ui.audioAppIsoManualLocks = normalizeAudioManualLockMapUi(r.data?.locks || {});
          if (el.aAppIsoManualCaptureToken) {
            el.aAppIsoManualCaptureToken.value = `${captureToken}.exe`;
          }
          clearAudioApplyAttention(AUDIO_APPLY_ATTENTION_KEY_MANUAL);
          setBadge(el.health, "ok", "MANUAL CAPTURE LOCKED");
    
          if (isAudioCaptureModeAppIsolationUiEnabled()) {
            const scanResult = await forceAudioAppIsolationScan({
              reason: "ui_manual_lock",
              reloadApps: false
            });
            if (scanResult?.ok) {
              announceAudioActionStatus(formatAudioAppIsoScanSummary("MANUAL LOCK APPLIED", scanResult), 3400);
              return {
                ok: true,
                labelOk: "LOCKED"
              };
            }
            setBadge(el.health, "warn", "MANUAL LOCK STORED | RESCAN FAIL");
            announceAudioActionStatus(
              `MANUAL LOCK STORED | ${sourceToken}.exe -> ${captureToken}.exe | RESCAN FAILED | ${String(scanResult?.error || "scan unavailable")}`,
              3400
            );
            return {
              ok: true,
              labelOk: "LOCKED"
            };
          }
    
          announceAudioActionStatus(
            `MANUAL LOCK STORED | ${sourceToken}.exe -> ${captureToken}.exe | APP ISO OFF`,
            3200
          );
          return {
            ok: true,
            labelOk: "LOCKED"
          };
        });
      };
    }
    
    if (el.aAppIsoManualClearBtn) {
      el.aAppIsoManualClearBtn.onclick = async () => {
        await runAudioButtonActionWithResult(el.aAppIsoManualClearBtn, "CLEARING...", async () => {
          const sourceToken = getAudioSelectedPrimaryAppTokenUi();
          if (!sourceToken) {
            setBadge(el.health, "warn", "MANUAL CLEAR NEEDS MAIN APP");
            announceAudioActionStatus("MANUAL CLEAR FAILED | SELECT MAIN APP FIRST", 3200);
            return {
              ok: false,
              labelFail: "NEED APP"
            };
          }
    
          const r = await clearAppIsolationLock({
            sourceToken,
            restart: true
          });
          if (!r.ok || r.data?.ok === false) {
            setBadge(el.health, "bad", "MANUAL CAPTURE CLEAR FAIL");
            announceAudioActionStatus(
              `MANUAL CAPTURE CLEAR FAILED | ${formatAudioApiErrorWithHint(r, "manual clear rejected")}`,
              3600
            );
            return {
              ok: false,
              labelFail: "CLEAR FAIL"
            };
          }
    
          ui.audioAppIsoManualLocks = normalizeAudioManualLockMapUi(r.data?.locks || {});
          syncAudioManualCaptureInputUi({ force: true, clearWhenMissing: true });
          clearAudioApplyAttention(AUDIO_APPLY_ATTENTION_KEY_MANUAL);
          setBadge(el.health, "ok", "MANUAL CAPTURE CLEARED");
    
          if (isAudioCaptureModeAppIsolationUiEnabled()) {
            const scanResult = await forceAudioAppIsolationScan({
              reason: "ui_manual_lock_clear",
              reloadApps: false
            });
            if (scanResult?.ok) {
              announceAudioActionStatus(formatAudioAppIsoScanSummary("MANUAL LOCK CLEARED", scanResult), 3400);
              return {
                ok: true,
                labelOk: "CLEARED"
              };
            }
            setBadge(el.health, "warn", "MANUAL CLEAR STORED | RESCAN FAIL");
            announceAudioActionStatus(
              `MANUAL LOCK CLEARED | ${sourceToken}.exe | RESCAN FAILED | ${String(scanResult?.error || "scan unavailable")}`,
              3400
            );
            return {
              ok: true,
              labelOk: "CLEARED"
            };
          }
    
          announceAudioActionStatus(`MANUAL LOCK CLEARED | ${sourceToken}.exe`, 3000);
          return {
            ok: true,
            labelOk: "CLEARED"
          };
        });
      };
    }
    
    if (el.aAppIsoManualCaptureToken) {
      el.aAppIsoManualCaptureToken.addEventListener("keydown", event => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        el.aAppIsoManualSetBtn?.click();
      });
      el.aAppIsoManualCaptureToken.addEventListener("input", () => {
        renderAudioManualCaptureAssistUi();
        if (String(el.aAppIsoManualCaptureToken.value || "").trim()) {
          markAudioApplyAttention(AUDIO_APPLY_ATTENTION_KEY_MANUAL);
        } else {
          clearAudioApplyAttention(AUDIO_APPLY_ATTENTION_KEY_MANUAL);
        }
      });
    }
    
    if (el.aAppIsoCompanionSelect) {
      el.aAppIsoCompanionSelect.addEventListener("change", () => {
        const selectedValue = String(el.aAppIsoCompanionSelect.value || "").trim();
        const selectedToken = normalizeAudioAppTokenUi(selectedValue);
        if (!selectedToken) return;
        if (el.aAppIsoManualCaptureToken) {
          el.aAppIsoManualCaptureToken.value = `${selectedToken}.exe`;
        }
        renderAudioManualCaptureAssistUi();
        markAudioApplyAttention(AUDIO_APPLY_ATTENTION_KEY_MANUAL);
        announceAudioActionStatus(
          `SUBPROCESS SUGGESTION SELECTED | ${selectedToken}.exe | CLICK SET MANUAL CAPTURE`,
          3000
        );
      });
    }
    
    const audioAppIsolationAutoApplyNodes = [
      el.aInputBackend,
      el.aPreferLegacyCapture,
      el.aUseRustAudioKernel,
      el.aUseRustSourceResolver,
      el.aRustLoopbackFormat,
      el.aFfmpegFormat,
      el.aFfmpegDevice,
      el.aFfmpegSources,
      el.aAppIsolationEnabled,
      el.aAppIsolationMultiSource,
      el.aAppIsolationStrict,
      el.aAppIsolationCheckMs,
      el.aAppPrimarySources,
      el.aAppFallbackSources
    ];
    for (const node of audioAppIsolationAutoApplyNodes) {
      if (!node) continue;
      node.addEventListener("change", () => {
        if (node === el.aRustLoopbackFormat) {
          syncRustLoopbackFormatHintUi(el.aRustLoopbackFormat.value);
        }
        updateAudioCaptureGuidanceUi();
        queueAudioAppIsolationAutoApply("APP ISO");
      });
    }
    if (el.aAppPrimary) {
      let audioPrimarySelectionToken = normalizeAudioAppTokenUi(el.aAppPrimary.value || "");
      const onAppPrimaryTargetChanged = async () => {
        const prevSourceToken = normalizeAudioAppTokenUi(ui.audioConfiguredPrimaryApp || audioPrimarySelectionToken || "");
        const nextSourceToken = getAudioSelectedPrimaryAppTokenUi();
        const lockMap = normalizeAudioManualLockMapUi(ui.audioAppIsoManualLocks || {});
        const prevCaptureToken = normalizeAudioAppTokenUi(lockMap[prevSourceToken] || "");
        if (prevSourceToken && nextSourceToken && prevSourceToken !== nextSourceToken && prevCaptureToken) {
          const keepExistingLock = windowRef.confirm(
            `Manual capture lock is set for ${prevSourceToken}.exe -> ${prevCaptureToken}.exe.\n\n` +
            "Click OK to keep that lock.\n" +
            "Click Cancel to choose clear/cancel switch."
          );
          if (!keepExistingLock) {
            const clearAndContinue = windowRef.confirm(
              `Clear manual lock for ${prevSourceToken}.exe and continue switching MAIN APP?\n\n` +
              "Click OK to clear + continue.\n" +
              "Click Cancel to keep the previous MAIN APP."
            );
            if (!clearAndContinue) {
              if (prevSourceToken) {
                el.aAppPrimary.value = `${prevSourceToken}.exe`;
              }
              updateAudioAppIsolationStatusText("APP TARGET CHANGE CANCELED");
              return;
            }
            const clearResult = await clearAppIsolationLock({
              sourceToken: `${prevSourceToken}.exe`,
              restart: false
            });
            if (!clearResult.ok || clearResult.data?.ok === false) {
              if (prevSourceToken) {
                el.aAppPrimary.value = `${prevSourceToken}.exe`;
              }
              setBadge(el.health, "bad", "MANUAL LOCK CLEAR FAIL");
              announceAudioActionStatus(
                `MANUAL LOCK CLEAR FAILED | ${formatAudioApiErrorWithHint(clearResult, "manual clear rejected")}`,
                3600
              );
              return;
            }
            ui.audioAppIsoManualLocks = normalizeAudioManualLockMapUi(clearResult.data?.locks || {});
            announceAudioActionStatus(`MANUAL LOCK CLEARED | ${prevSourceToken}.exe`, 2600);
          }
        }
        audioPrimarySelectionToken = nextSourceToken;
        syncAudioManualCaptureInputUi({ force: true, clearWhenNoSource: true, clearWhenMissing: true, flash: true });
        updateAudioAppIsolationStatusText("APP TARGET CHANGED | PENDING APPLY+SCAN");
        queueAudioAppIsolationAutoApply("APP TARGET", { forceScan: true, delayMs: 140 });
      };
      el.aAppPrimary.addEventListener("change", onAppPrimaryTargetChanged);
    }
    if (el.aAppFallback) {
      const onAppFallbackTargetChanged = () => {
        updateAudioAppIsolationStatusText("APP TARGET CHANGED | PENDING APPLY+SCAN");
        queueAudioAppIsolationAutoApply("APP TARGET", { forceScan: true, delayMs: 140 });
      };
      el.aAppFallback.addEventListener("change", onAppFallbackTargetChanged);
    }
  }

  return { wireAudioAppIsolationActionsUi };
}
