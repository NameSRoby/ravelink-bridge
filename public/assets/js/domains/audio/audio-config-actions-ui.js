// [TITLE] Module: public/assets/js/domains/audio/audio-config-actions-ui.js
// [TITLE] Purpose: audio config, quick-tuning, preset, and restart action wiring
// [TITLE] Functionality Index:
// [TITLE] - device/sample/frame sync wiring
// [TITLE] - quick tuning slider + preset action wiring
// [TITLE] - audio config apply/refresh/restart/reset action wiring
// [DEV] Complex Flow:
// [DEV] This module owns the interactive config layer for the Audio tab. Pure quick-tune
// [DEV] math/helpers stay in audio.js or shared modules, while this file binds DOM events
// [DEV] to those helpers and preserves the existing audio route/status contracts.

function createAudioConfigActionsUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const windowRef = deps.windowRef || window;
  const documentRef = deps.documentRef || document;
  const syncAudioQuickPresetButtons = typeof deps.syncAudioQuickPresetButtons === "function" ? deps.syncAudioQuickPresetButtons : (() => {});
  const applyAudioQuickTuningSlidersToInputs = typeof deps.applyAudioQuickTuningSlidersToInputs === "function" ? deps.applyAudioQuickTuningSlidersToInputs : (() => {});
  const applyAudioQuickProfileMixSliderToSliders = typeof deps.applyAudioQuickProfileMixSliderToSliders === "function" ? deps.applyAudioQuickProfileMixSliderToSliders : (() => {});
  const syncAudioQuickTuningFromInputs = typeof deps.syncAudioQuickTuningFromInputs === "function" ? deps.syncAudioQuickTuningFromInputs : (() => {});
  const detectLimiterPreset = typeof deps.detectLimiterPreset === "function" ? deps.detectLimiterPreset : (() => "balanced");
  const syncLimiterPresetButtons = typeof deps.syncLimiterPresetButtons === "function" ? deps.syncLimiterPresetButtons : (() => {});
  const runAudioButtonActionWithResult = typeof deps.runAudioButtonActionWithResult === "function" ? deps.runAudioButtonActionWithResult : (async (_btn, _pending, action) => action());
  const resetAudioQuickTuningToDefaults = typeof deps.resetAudioQuickTuningToDefaults === "function" ? deps.resetAudioQuickTuningToDefaults : (() => {});
  const setBadge = typeof deps.setBadge === "function" ? deps.setBadge : (() => {});
  const markAudioApplyAttention = typeof deps.markAudioApplyAttention === "function" ? deps.markAudioApplyAttention : (() => {});
  const AUDIO_APPLY_ATTENTION_KEY_CONFIG = String(deps.AUDIO_APPLY_ATTENTION_KEY_CONFIG || "config");
  const announceAudioActionStatus = typeof deps.announceAudioActionStatus === "function" ? deps.announceAudioActionStatus : (() => {});
  const saveAudioConfig = typeof deps.saveAudioConfig === "function"
    ? deps.saveAudioConfig
    : (async () => ({ ok: false, data: null }));
  const restartAudioEngine = typeof deps.restartAudioEngine === "function"
    ? deps.restartAudioEngine
    : (async () => ({ ok: false, data: null }));
  const formatAudioApiErrorWithHint = typeof deps.formatAudioApiErrorWithHint === "function" ? deps.formatAudioApiErrorWithHint : ((_r, fallback) => String(fallback || "request failed"));
  const applyAudioConfigToInputs = typeof deps.applyAudioConfigToInputs === "function" ? deps.applyAudioConfigToInputs : (() => {});
  const clearAudioApplyAttention = typeof deps.clearAudioApplyAttention === "function" ? deps.clearAudioApplyAttention : (() => {});
  const formatAudioActiveConfigSummaryUi = typeof deps.formatAudioActiveConfigSummaryUi === "function" ? deps.formatAudioActiveConfigSummaryUi : (() => "");
  const applyAudioQuickProfile = typeof deps.applyAudioQuickProfile === "function" ? deps.applyAudioQuickProfile : (() => false);
  const collectAudioConfigFromInputs = typeof deps.collectAudioConfigFromInputs === "function" ? deps.collectAudioConfigFromInputs : (() => ({}));
  const loadAudioApps = typeof deps.loadAudioApps === "function" ? deps.loadAudioApps : (async () => false);
  const loadAudioConfig = typeof deps.loadAudioConfig === "function" ? deps.loadAudioConfig : (async () => false);
  const sync = typeof deps.sync === "function" ? deps.sync : (() => {});
  const LIMITER_PRESETS = deps.LIMITER_PRESETS || {};
  const AUDIO_CONFIG_DEFAULTS = deps.AUDIO_CONFIG_DEFAULTS || {};

  async function applyAudioConfigNow() {
    announceAudioActionStatus("AUDIO CONFIG APPLY | WORKING...", 1300);
    const patch = {
      ...collectAudioConfigFromInputs(),
      restart: true,
      reason: "ui_audio_config_apply"
    };
    const r = await saveAudioConfig(patch);
    if (!r.ok) {
      setBadge(el.health, "bad", "AUDIO APPLY FAIL");
      announceAudioActionStatus(`AUDIO CONFIG APPLY FAILED | ${formatAudioApiErrorWithHint(r, "save failed")}`, 3400);
      return {
        ok: false,
        labelFail: "APPLY FAIL"
      };
    }

    if (r.data && r.data.config) {
      applyAudioConfigToInputs(r.data.config);
    }
    await loadAudioApps({ forceRefresh: true });
    clearAudioApplyAttention(AUDIO_APPLY_ATTENTION_KEY_CONFIG);

    const changedFields = Array.isArray(r.data?.changed)
      ? r.data.changed.map(item => String(item || "").trim()).filter(Boolean)
      : [];
    const changedCount = changedFields.length;
    const changedPreview = changedCount ? changedFields.slice(0, 5).join(", ") : "";

    setBadge(
      el.health,
      changedCount > 0 ? "ok" : "warn",
      r.data && r.data.restarted
        ? (changedCount > 0 ? "AUDIO CFG APPLIED + RESTART" : "AUDIO CFG NO CHANGE + RESTART")
        : (changedCount > 0 ? "AUDIO CFG APPLIED" : "AUDIO CFG NO CHANGE")
    );
    announceAudioActionStatus(
      r.data && r.data.restarted
        ? (changedCount > 0
          ? `AUDIO CONFIG APPLIED + RESTART | CHANGED ${changedCount}${changedPreview ? ` | ${changedPreview}` : ""}`
          : "AUDIO CONFIG APPLIED + RESTART | NO FIELD CHANGES")
        : (changedCount > 0
          ? `AUDIO CONFIG APPLIED | CHANGED ${changedCount}${changedPreview ? ` | ${changedPreview}` : ""}`
          : "AUDIO CONFIG APPLIED | NO FIELD CHANGES"),
      3400
    );
    return {
      ok: true,
      labelOk: changedCount > 0
        ? (r.data && r.data.restarted ? "APPLIED+RESTART" : "APPLIED")
        : "NO CHANGE"
    };
  }

  function wireAudioConfigActionsUi() {
    if (el.aDevices && el.aDeviceId) {
      el.aDevices.onchange = () => {
        const rawSelection = String(el.aDevices.value || "").trim();
        if (rawSelection.startsWith("portaudio:")) {
          el.aDeviceId.value = rawSelection.slice("portaudio:".length);
        } else if (rawSelection.startsWith("desktop:")) {
          el.aDeviceId.value = "";
        } else {
          el.aDeviceId.value = rawSelection === "" ? "" : rawSelection;
        }
        announceAudioActionStatus("AUDIO SOURCE CHANGED | CLICK APPLY + START AUDIO", 2600);
        markAudioApplyAttention(AUDIO_APPLY_ATTENTION_KEY_CONFIG);
      };
    }

    if (el.aSampleRate) {
      el.aSampleRate.onchange = () => {
        syncAudioQuickPresetButtons();
      };
    }

    if (el.aFrames) {
      el.aFrames.onchange = () => {
        syncAudioQuickPresetButtons();
      };
    }

    const audioQuickTuningSliderNodes = [
      el.aQuickGain,
      el.aQuickNoiseGate,
      el.aQuickAutoTarget,
      el.aQuickAutoGate,
      el.aQuickLimiter
    ];
    for (const node of audioQuickTuningSliderNodes) {
      if (!node) continue;
      node.addEventListener("input", () => {
        applyAudioQuickTuningSlidersToInputs();
      });
      node.addEventListener("change", () => {
        applyAudioQuickTuningSlidersToInputs();
      });
    }

    if (el.aQuickProfileMix) {
      el.aQuickProfileMix.addEventListener("input", () => {
        applyAudioQuickProfileMixSliderToSliders();
      });
      el.aQuickProfileMix.addEventListener("change", () => {
        applyAudioQuickProfileMixSliderToSliders();
      });
    }

    if (el.aQuickSnapStages) {
      el.aQuickSnapStages.addEventListener("change", () => {
        applyAudioQuickTuningSlidersToInputs();
      });
    }

    if (el.aQuickTuneResetBtn) {
      el.aQuickTuneResetBtn.onclick = async () => {
        await runAudioButtonActionWithResult(el.aQuickTuneResetBtn, "RESETTING...", async () => {
          resetAudioQuickTuningToDefaults();
          setBadge(el.health, "ok", "QUICK TUNING RESET");
          markAudioApplyAttention(AUDIO_APPLY_ATTENTION_KEY_CONFIG);
          announceAudioActionStatus("QUICK TUNING RESET | CLICK APPLY + START AUDIO", 2600);
          return { ok: true, labelOk: "RESET" };
        });
      };
    }

    const audioQuickTuningNumericNodes = [
      el.aGain,
      el.aNoise,
      el.aAutoLevelTarget,
      el.aAutoLevelGate,
      el.aLimiterThreshold
    ];
    for (const node of audioQuickTuningNumericNodes) {
      if (!node) continue;
      const onQuickNumericChange = () => {
        syncAudioQuickTuningFromInputs();
        ui.limiterPreset = detectLimiterPreset({
          limiterThreshold: Number(el.aLimiterThreshold?.value),
          limiterKnee: Number(el.aLimiterKnee?.value)
        });
        syncLimiterPresetButtons();
      };
      node.addEventListener("input", onQuickNumericChange);
      node.addEventListener("change", onQuickNumericChange);
    }

    if (el.aLimiterKnee) {
      const onLimiterKneeChanged = () => {
        ui.limiterPreset = detectLimiterPreset({
          limiterThreshold: Number(el.aLimiterThreshold?.value),
          limiterKnee: Number(el.aLimiterKnee?.value)
        });
        syncLimiterPresetButtons();
      };
      el.aLimiterKnee.addEventListener("input", onLimiterKneeChanged);
      el.aLimiterKnee.addEventListener("change", onLimiterKneeChanged);
    }

    if (el.aQuickTuneApplyBtn) {
      el.aQuickTuneApplyBtn.onclick = async () => {
        await runAudioButtonActionWithResult(el.aQuickTuneApplyBtn, "APPLYING...", async () => {
          announceAudioActionStatus("QUICK TUNING APPLY | WORKING...", 1200);
          applyAudioQuickTuningSlidersToInputs();
          const patch = {
            outputGain: Number(el.aGain?.value || "1"),
            noiseFloorMin: Number(el.aNoise?.value || "0.00045"),
            autoLevelTargetRms: Number(el.aAutoLevelTarget?.value || "0.028"),
            autoLevelGate: Number(el.aAutoLevelGate?.value || "0.007"),
            limiterThreshold: Number(el.aLimiterThreshold?.value || "0.82")
          };
          const r = await saveAudioConfig(patch);
          if (!r.ok) {
            setBadge(el.health, "bad", "QUICK TUNE APPLY FAIL");
            announceAudioActionStatus(`QUICK TUNING APPLY FAILED | ${formatAudioApiErrorWithHint(r, "save failed")}`, 3200);
            return { ok: false, labelFail: "APPLY FAIL" };
          }
          if (r.data?.config) {
            applyAudioConfigToInputs(r.data.config);
          } else {
            syncAudioQuickTuningFromInputs();
          }
          clearAudioApplyAttention(AUDIO_APPLY_ATTENTION_KEY_CONFIG);
          const restarted = r.data?.restarted === true;
          setBadge(el.health, "ok", restarted ? "QUICK TUNING APPLIED + RESTART" : "QUICK TUNING APPLIED");
          announceAudioActionStatus(restarted ? "QUICK TUNING APPLIED + RESTART" : "QUICK TUNING APPLIED", 2800);
          return { ok: true, labelOk: restarted ? "APPLIED+RESTART" : "APPLIED" };
        });
      };
    }

    for (const btn of Array.from(documentRef.querySelectorAll("[data-audio-quick]"))) {
      btn.onclick = async () => {
        await runAudioButtonActionWithResult(btn, "APPLYING...", async () => {
          const name = String(btn.dataset.audioQuick || "").trim().toLowerCase();
          const beforeSummary = formatAudioActiveConfigSummaryUi();
          const ok = applyAudioQuickProfile(name);
          if (!ok) {
            return { ok: false, labelFail: "INVALID" };
          }
          const afterSummary = formatAudioActiveConfigSummaryUi();
          const changed = beforeSummary !== afterSummary;
          if (!changed) {
            setBadge(el.health, "warn", `AUDIO PROFILE ${name.toUpperCase()} UNCHANGED`);
            announceAudioActionStatus(`AUDIO PROFILE ${name.toUpperCase()} ALREADY MATCHES CURRENT SETTINGS`, 2600);
            return { ok: true, labelOk: "UNCHANGED" };
          }
          const applyResult = await applyAudioConfigNow();
          if (applyResult?.ok) {
            announceAudioActionStatus(`AUDIO PROFILE ${name.toUpperCase()} APPLIED${afterSummary ? ` | ${afterSummary}` : ""}`, 3000);
          }
          sync();
          return {
            ...applyResult,
            labelOk: applyResult?.ok ? "APPLIED" : (applyResult?.labelOk || "APPLIED")
          };
        });
      };
    }

    const audioConfigApplyHintNodes = [
      el.aDeviceMatch,
      el.aDeviceId,
      el.aSampleRate,
      el.aFrames,
      el.aChannels,
      el.aGain,
      el.aAutoLevelEnabled,
      el.aAutoLevelTarget,
      el.aAutoLevelMinGain,
      el.aAutoLevelMaxGain,
      el.aAutoLevelGate,
      el.aNoise,
      el.aPeakDecay,
      el.aBandLowHz,
      el.aBandMidHz,
      el.aLimiterThreshold,
      el.aLimiterKnee,
      el.aRestartMs,
      el.aLogTicks,
      el.aFfmpegPath
    ];
    for (const node of audioConfigApplyHintNodes) {
      if (!node) continue;
      node.addEventListener("change", () => {
        announceAudioActionStatus("AUDIO CONFIG CHANGED | CLICK APPLY + START AUDIO", 2600);
        markAudioApplyAttention(AUDIO_APPLY_ATTENTION_KEY_CONFIG);
      });
    }

    if (el.aApplyBtn) {
      el.aApplyBtn.onclick = async () => {
        await runAudioButtonActionWithResult(el.aApplyBtn, "APPLYING...", async () => applyAudioConfigNow());
      };
    }

    if (el.aRefreshAdvancedBtn) {
      el.aRefreshAdvancedBtn.onclick = async () => {
        await runAudioButtonActionWithResult(el.aRefreshAdvancedBtn, "REFRESHING...", async () => {
          const ok = await loadAudioConfig();
          if (!ok) {
            setBadge(el.health, "bad", "ADVANCED REFRESH FAIL");
            announceAudioActionStatus("ADVANCED TUNING REFRESH FAILED", 3200);
            return { ok: false, labelFail: "REFRESH FAIL" };
          }
          setBadge(el.health, "ok", "ADVANCED TUNING REFRESHED");
          announceAudioActionStatus("ADVANCED TUNING REFRESHED", 2600);
          return { ok: true, labelOk: "REFRESHED" };
        });
      };
    }

    if (el.aRestartBtn) {
      el.aRestartBtn.onclick = async () => {
        await runAudioButtonActionWithResult(el.aRestartBtn, "RESTARTING...", async () => {
          announceAudioActionStatus("AUDIO RESTART | WORKING...", 1200);
          const r = await restartAudioEngine();
          const ok = r.ok && r.data?.ok !== false;
          setBadge(el.health, ok ? "ok" : "bad", ok ? "AUDIO RESTART" : "AUDIO RESTART FAIL");
          announceAudioActionStatus(
            ok
              ? `AUDIO RESTARTED | REASON=${String(r.data?.reason || "api").toUpperCase()}`
              : `AUDIO RESTART FAILED | ${formatAudioApiErrorWithHint(r, "restart failed")}`,
            3400
          );
          return { ok, labelOk: "RESTARTED", labelFail: "RESTART FAIL" };
        });
      };
    }

    if (el.aResetDefaultsBtn) {
      el.aResetDefaultsBtn.onclick = async () => {
        if (!windowRef.confirm("Reset audio settings to defaults and apply now?")) return;
        await runAudioButtonActionWithResult(el.aResetDefaultsBtn, "RESETTING...", async () => {
          announceAudioActionStatus("AUDIO RESET DEFAULTS | WORKING...", 1200);
          const r = await saveAudioConfig(AUDIO_CONFIG_DEFAULTS);
          if (!r.ok) {
            setBadge(el.health, "bad", "AUDIO RESET FAIL");
            announceAudioActionStatus(`AUDIO RESET FAILED | ${formatAudioApiErrorWithHint(r, "save failed")}`, 3400);
            return { ok: false, labelFail: "RESET FAIL" };
          }
          applyAudioConfigToInputs(r.data?.config || AUDIO_CONFIG_DEFAULTS);
          const changedFields = Array.isArray(r.data?.changed)
            ? r.data.changed.map(item => String(item || "").trim()).filter(Boolean)
            : [];
          const changedCount = changedFields.length;
          setBadge(
            el.health,
            changedCount > 0 ? "ok" : "warn",
            r.data && r.data.restarted
              ? (changedCount > 0 ? "AUDIO DEFAULTS APPLIED + RESTART" : "AUDIO DEFAULTS ALREADY ACTIVE")
              : (changedCount > 0 ? "AUDIO DEFAULTS APPLIED" : "AUDIO DEFAULTS ALREADY ACTIVE")
          );
          announceAudioActionStatus(
            r.data && r.data.restarted
              ? (changedCount > 0 ? `AUDIO DEFAULTS APPLIED + RESTART | CHANGED ${changedCount}` : "AUDIO DEFAULTS ALREADY ACTIVE")
              : (changedCount > 0 ? `AUDIO DEFAULTS APPLIED | CHANGED ${changedCount}` : "AUDIO DEFAULTS ALREADY ACTIVE"),
            3200
          );
          sync();
          return {
            ok: true,
            labelOk: changedCount > 0
              ? (r.data && r.data.restarted ? "RESET+RESTART" : "RESET")
              : "NO CHANGE"
          };
        });
      };
    }

    for (const btn of Array.from(documentRef.querySelectorAll("[data-limiter-preset]"))) {
      btn.onclick = async () => {
        await runAudioButtonActionWithResult(btn, "APPLYING...", async () => {
          const presetName = btn.dataset.limiterPreset;
          const preset = LIMITER_PRESETS[presetName];
          if (!preset) {
            return { ok: false, labelFail: "INVALID" };
          }
          const r = await saveAudioConfig(preset);
          if (!r.ok) {
            setBadge(el.health, "bad", "LIMITER PRESET FAIL");
            announceAudioActionStatus(`LIMITER PRESET FAILED | ${formatAudioApiErrorWithHint(r, "save failed")}`, 3400);
            return { ok: false, labelFail: "PRESET FAIL" };
          }
          el.aLimiterThreshold.value = String(preset.limiterThreshold);
          el.aLimiterKnee.value = String(preset.limiterKnee);
          ui.limiterPreset = presetName;
          syncLimiterPresetButtons();
          if (r.data && r.data.config) {
            applyAudioConfigToInputs(r.data.config);
          }
          setBadge(el.health, "ok", `LIMITER ${presetName.toUpperCase()}`);
          announceAudioActionStatus(`LIMITER ${presetName.toUpperCase()} APPLIED`, 2200);
          sync();
          return { ok: true, labelOk: "APPLIED" };
        });
      };
    }
  }

  return { wireAudioConfigActionsUi };
}
