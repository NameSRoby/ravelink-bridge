// [TITLE] Module: public/assets/js/domains/audio/audio-config-runtime-ui.js
// [TITLE] Purpose: audio config/app-selection/capture-guidance runtime extracted from audio orchestrator
// [TITLE] Functionality Index:
// [TITLE] - audio app list curation + app selector rendering
// [TITLE] - capture mode/config apply/collect normalization
// [TITLE] - capture guidance text and toggle indicator synchronization
// [DEV] Complex Flow:
// [DEV] This runtime keeps config drafts, capture-mode affordances, and curated
// [DEV] app selector options aligned so telemetry/config reloads do not desync
// [DEV] the AUDIO tab when users bounce between desktop listen and app isolation.
function createAudioConfigRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const documentRef = deps.documentRef || document;
  const normalizeAudioDeviceListUi = typeof deps.normalizeAudioDeviceListUi === "function"
    ? deps.normalizeAudioDeviceListUi
    : ((value, fallback = []) => {
      if (Array.isArray(value)) return value.map(item => String(item || "").trim()).filter(Boolean);
      const raw = String(value || "").trim();
      return raw ? [raw] : fallback.slice();
    });
  const formatAudioDeviceListUi = typeof deps.formatAudioDeviceListUi === "function"
    ? deps.formatAudioDeviceListUi
    : (list => normalizeAudioDeviceListUi(list, []).join(", "));
  const normalizeAudioAppNameUi = typeof deps.normalizeAudioAppNameUi === "function"
    ? deps.normalizeAudioAppNameUi
    : (value => String(value || "").trim());
  const normalizeAudioOutputEndpointNameUi = typeof deps.normalizeAudioOutputEndpointNameUi === "function"
    ? deps.normalizeAudioOutputEndpointNameUi
    : (value => String(value || "").trim());
  const normalizeAudioAppTokenUi = typeof deps.normalizeAudioAppTokenUi === "function"
    ? deps.normalizeAudioAppTokenUi
    : (value => String(value || "").trim().toLowerCase());
  const detectAudioQuickProfile = typeof deps.detectAudioQuickProfile === "function"
    ? deps.detectAudioQuickProfile
    : (() => "");
  const syncAudioQuickPresetButtons = typeof deps.syncAudioQuickPresetButtons === "function"
    ? deps.syncAudioQuickPresetButtons
    : (() => {});
  const syncLimiterPresetButtons = typeof deps.syncLimiterPresetButtons === "function"
    ? deps.syncLimiterPresetButtons
    : (() => {});
  const syncAudioQuickTuningFromInputs = typeof deps.syncAudioQuickTuningFromInputs === "function"
    ? deps.syncAudioQuickTuningFromInputs
    : (() => {});
  const markAudioApplyAttention = typeof deps.markAudioApplyAttention === "function"
    ? deps.markAudioApplyAttention
    : (() => {});
  const clearAudioApplyAttention = typeof deps.clearAudioApplyAttention === "function"
    ? deps.clearAudioApplyAttention
    : (() => {});
  const updateAudioAppIsolationStatusText = typeof deps.updateAudioAppIsolationStatusText === "function"
    ? deps.updateAudioAppIsolationStatusText
    : (() => {});
  const AUDIO_APPLY_ATTENTION_KEY_CONFIG = String(deps.AUDIO_APPLY_ATTENTION_KEY_CONFIG || "config");
  const AUDIO_APPLY_ATTENTION_KEY_ISO = String(deps.AUDIO_APPLY_ATTENTION_KEY_ISO || "iso");
  const AUDIO_APPLY_ATTENTION_KEY_MANUAL = String(deps.AUDIO_APPLY_ATTENTION_KEY_MANUAL || "manual");
  const audioApplyAttentionState = deps.audioApplyAttentionState && typeof deps.audioApplyAttentionState === "object"
    ? deps.audioApplyAttentionState
    : { config: false, iso: false, manual: false };
  const LIMITER_PRESETS = deps.LIMITER_PRESETS && typeof deps.LIMITER_PRESETS === "object"
    ? deps.LIMITER_PRESETS
    : Object.freeze({
      transparent: Object.freeze({ limiterThreshold: 0.9, limiterKnee: 0.24 }),
      balanced: Object.freeze({ limiterThreshold: 0.82, limiterKnee: 0.16 }),
      hard: Object.freeze({ limiterThreshold: 0.72, limiterKnee: 0.08 })
    });

  const AUDIO_RUST_LOOPBACK_FORMAT_META = Object.freeze({
    f32le: Object.freeze({
      token: "f32le",
      hint: "f32le: best precision and analyzer compatibility, with higher throughput cost."
    }),
    s16le: Object.freeze({
      token: "s16le",
      hint: "s16le: lowest bandwidth/CPU path, but lower dynamic headroom and more quantization noise."
    }),
    s24le: Object.freeze({
      token: "s24le",
      hint: "s24le: high dynamic range with lower throughput than f32; good quality/efficiency balance."
    }),
    s32le: Object.freeze({
      token: "s32le",
      hint: "s32le: full integer precision with high throughput cost; useful for strict integer pipelines."
    })
  });
  const AUDIO_LOOPBACK_DEVICE_KEYWORDS_UI = Object.freeze(["loopback", "stereo mix", "what u hear", "monitor of"]);
  const AUDIO_VIRTUAL_CABLE_KEYWORDS_UI = Object.freeze(["vb-audio", "virtual cable", "cable output"]);
  const AUDIO_USB_DEVICE_KEYWORDS_UI = Object.freeze(["usb", "headset", "dac"]);

  let audioRuntimeConfigSignatureUi = "";

  function detectLimiterPreset(config = {}) {
    const threshold = Number(config.limiterThreshold);
    const knee = Number(config.limiterKnee);
    if (!Number.isFinite(threshold) || !Number.isFinite(knee)) return "balanced";

    let best = "balanced";
    let bestDist = Number.POSITIVE_INFINITY;
    for (const [name, preset] of Object.entries(LIMITER_PRESETS)) {
      const dist = Math.abs(threshold - preset.limiterThreshold) + Math.abs(knee - preset.limiterKnee);
      if (dist < bestDist) {
        bestDist = dist;
        best = name;
      }
    }
    return bestDist <= 0.035 ? best : "custom";
  }

  function normalizeRustLoopbackFormatUi(value, fallback = "f32le") {
    const fallbackToken = Object.prototype.hasOwnProperty.call(AUDIO_RUST_LOOPBACK_FORMAT_META, fallback)
      ? fallback
      : "f32le";
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return fallbackToken;
    if (raw === "float32" || raw === "f32") return "f32le";
    if (raw === "s16" || raw === "pcm16") return "s16le";
    if (raw === "s24" || raw === "pcm24") return "s24le";
    if (raw === "s32" || raw === "pcm32") return "s32le";
    return Object.prototype.hasOwnProperty.call(AUDIO_RUST_LOOPBACK_FORMAT_META, raw)
      ? raw
      : fallbackToken;
  }

  function syncRustLoopbackFormatHintUi(value = "") {
    if (!el.aRustLoopbackFormatHint) return;
    const token = normalizeRustLoopbackFormatUi(value, "f32le");
    const meta = AUDIO_RUST_LOOPBACK_FORMAT_META[token] || AUDIO_RUST_LOOPBACK_FORMAT_META.f32le;
    el.aRustLoopbackFormatHint.textContent = meta.hint;
  }

  const {
    isLikelyAudioSelectableAppUi,
    compareAudioSelectableAppUi,
    isAudioAppsShowAllUiEnabled,
    getAudioSelectableAppsUi,
    updateAudioAppsFilterHintUi,
    setAudioAppSelectOptions
  } = (typeof createAudioConfigAppSelectionRuntimeUi === "function"
    ? createAudioConfigAppSelectionRuntimeUi({
      el,
      ui,
      documentRef,
      normalizeAudioAppNameUi,
      normalizeAudioAppTokenUi
    })
    : (() => {
      throw new Error("audio config app-selection runtime module missing");
    })());

  function syncAudioRoutingComplexityUi() {
    const simpleMode = ui.audioSimpleRoutingMode !== false;
    if (el.aIsoSimpleMode) el.aIsoSimpleMode.checked = simpleMode;
    documentRef.querySelectorAll(".audioIsoAdvanced").forEach(node => {
      node.classList.toggle("hidden", simpleMode);
    });
    syncAudioToggleIndicatorsUi();
  }

  function isAudioCaptureModeAppIsolationUiEnabled() {
    if (el.aCaptureModeAppIso) {
      return el.aCaptureModeAppIso.checked === true;
    }
    return el.aAppIsolationEnabled ? el.aAppIsolationEnabled.checked === true : false;
  }

  function syncAudioCaptureModeUi(options = {}) {
    const appIsoEnabled = options?.appIsoEnabled === true || options?.appIsoEnabled === false
      ? options.appIsoEnabled === true
      : (el.aAppIsolationEnabled ? el.aAppIsolationEnabled.checked === true : false);
    if (el.aAppIsolationEnabled) {
      el.aAppIsolationEnabled.checked = appIsoEnabled;
    }
    if (el.aCaptureModeDesktop) {
      el.aCaptureModeDesktop.checked = !appIsoEnabled;
    }
    if (el.aCaptureModeAppIso) {
      el.aCaptureModeAppIso.checked = appIsoEnabled;
    }
    if (el.aCaptureModeHint) {
      el.aCaptureModeHint.textContent = appIsoEnabled
        ? "App Isolation: auto-switch between selected apps and capture only the resolved target process chain."
        : "Desktop Listen: capture configured desktop input source(s) with no forced app target.";
    }
    documentRef.querySelectorAll(".audioIsoOnly").forEach(node => {
      node.classList.remove("hidden");
      node.classList.toggle("audioIsoModeOff", !appIsoEnabled);
    });
    if (options?.updateStatus === true) {
      updateAudioAppIsolationStatusText(
        appIsoEnabled
          ? "APP ISOLATION MODE | PENDING APPLY+SCAN"
          : "DESKTOP LISTEN MODE | PENDING APPLY"
      );
      markAudioApplyAttention(AUDIO_APPLY_ATTENTION_KEY_ISO);
    }
    syncAudioToggleIndicatorsUi();
  }

  function buildAudioRuntimeConfigSignatureUi(config = {}) {
    const source = config && typeof config === "object" ? config : {};
    const payload = {
      inputBackend: String(source.inputBackend || "auto").trim().toLowerCase(),
      autoPreferLegacyCapture: source.autoPreferLegacyCapture === true,
      rustAudioKernelEnabled: source.rustAudioKernelEnabled !== false,
      rustSourceResolverEnabled: source.rustSourceResolverEnabled !== false,
      rustLoopbackFormat: normalizeRustLoopbackFormatUi(source.rustLoopbackFormat, "f32le"),
      ffmpegInputFormat: String(source.ffmpegInputFormat || "dshow").trim().toLowerCase(),
      ffmpegInputDevice: String(source.ffmpegInputDevice || "").trim(),
      ffmpegInputDevices: normalizeAudioDeviceListUi(source.ffmpegInputDevices, []),
      desktopOutputDeviceName: normalizeAudioOutputEndpointNameUi(source.desktopOutputDeviceName || ""),
      ffmpegAppIsolationEnabled: source.ffmpegAppIsolationEnabled === true,
      ffmpegAppIsolationStrict: source.ffmpegAppIsolationStrict === true,
      ffmpegAppIsolationPrimaryApp: normalizeAudioAppNameUi(source.ffmpegAppIsolationPrimaryApp || ""),
      ffmpegAppIsolationFallbackApp: normalizeAudioAppNameUi(source.ffmpegAppIsolationFallbackApp || ""),
      ffmpegAppIsolationPrimaryDevices: normalizeAudioDeviceListUi(source.ffmpegAppIsolationPrimaryDevices, []),
      ffmpegAppIsolationFallbackDevices: normalizeAudioDeviceListUi(source.ffmpegAppIsolationFallbackDevices, []),
      ffmpegAppIsolationMultiSource: source.ffmpegAppIsolationMultiSource === true,
      ffmpegAppIsolationCheckMs: Math.max(1000, Number(source.ffmpegAppIsolationCheckMs || 300000)),
      sampleRate: Number(source.sampleRate || 0),
      framesPerBuffer: Number(source.framesPerBuffer || 0),
      channels: Number(source.channels || 0),
      outputGain: Number(source.outputGain || 0),
      autoLevelEnabled: source.autoLevelEnabled !== false,
      autoLevelTargetRms: Number(source.autoLevelTargetRms || 0),
      autoLevelMinGain: Number(source.autoLevelMinGain || 0),
      autoLevelMaxGain: Number(source.autoLevelMaxGain || 0),
      autoLevelGate: Number(source.autoLevelGate || 0),
      noiseFloorMin: Number(source.noiseFloorMin || 0),
      peakDecay: Number(source.peakDecay || 0),
      bandLowHz: Number(source.bandLowHz || 0),
      bandMidHz: Number(source.bandMidHz || 0),
      limiterThreshold: Number(source.limiterThreshold || 0),
      limiterKnee: Number(source.limiterKnee || 0),
      restartMs: Number(source.restartMs || 0),
      logEveryTicks: Number(source.logEveryTicks || 0),
      ffmpegPath: String(source.ffmpegPath || "ffmpeg").trim()
    };
    return JSON.stringify(payload);
  }

  function hasAudioPendingApplyAttentionUi() {
    return Object.values(audioApplyAttentionState).some(value => value === true);
  }

  function syncAudioToggleIndicatorForInputUi(inputNode) {
    if (!inputNode || !inputNode.id) return;
    const explicit = typeof documentRef.querySelector === "function"
      ? documentRef.querySelector(`label[for="${inputNode.id}"]`)
      : null;
    const wrapped = typeof inputNode.closest === "function" ? inputNode.closest("label") : null;
    const label = explicit || wrapped;
    if (!label?.classList) return;
    label.classList.add("audioToggleStateLabel");
    label.classList.toggle("active", inputNode.checked === true);
  }

  function syncAudioToggleIndicatorsUi() {
    [
      el.aCaptureModeDesktop,
      el.aCaptureModeAppIso,
      el.aIsoSimpleMode,
      el.aAppsShowAll,
      el.aPreferLegacyCapture,
      el.aUseRustAudioKernel,
      el.aUseRustSourceResolver,
      el.aAppIsolationMultiSource,
      el.aAppIsolationStrict,
      el.aAutoLevelEnabled,
      el.aQuickSnapStages
    ].forEach(syncAudioToggleIndicatorForInputUi);
  }

  function syncAudioRuntimeStateIndicatorsFromConfig(config = {}, options = {}) {
    const source = config && typeof config === "object" ? config : {};
    const nextSignature = buildAudioRuntimeConfigSignatureUi(source);
    const signatureChanged = nextSignature !== audioRuntimeConfigSignatureUi;
    audioRuntimeConfigSignatureUi = nextSignature;

    const allowDraftOverride = options.allowDraftOverride === true;
    const fullApplyAllowed = allowDraftOverride || !hasAudioPendingApplyAttentionUi();
    if (signatureChanged && fullApplyAllowed) {
      applyAudioConfigToInputs(source);
      return;
    }

    syncAudioCaptureModeUi({ appIsoEnabled: source.ffmpegAppIsolationEnabled === true });
    ui.audioQuickProfile = detectAudioQuickProfile(source);
    syncAudioQuickPresetButtons();
    ui.limiterPreset = detectLimiterPreset(source);
    syncLimiterPresetButtons();
    syncAudioQuickTuningFromInputs();
    syncAudioToggleIndicatorsUi();
  }

  function formatAudioActiveConfigSummaryUi() {
    const sampleRate = Math.max(0, Number(el.aSampleRate?.value || 0));
    const framesPerBuffer = Math.max(0, Number(el.aFrames?.value || 0));
    const channels = Math.max(0, Number(el.aChannels?.value || 0));
    if (!sampleRate || !framesPerBuffer || !channels) return "";
    return `${sampleRate}Hz | ${framesPerBuffer} fpb | ${channels}ch`;
  }

  function resolveAudioCaptureBackendLabelUi() {
    const raw = String(el.aInputBackend?.value || "").trim().toLowerCase();
    if (raw === "ffmpeg" || raw === "portaudio" || raw === "rustloop") return raw;
    return "auto";
  }

  function computeAudioDeviceScanHintsUi(devices = []) {
    const rows = Array.isArray(devices) ? devices : [];
    const names = rows.map(row => String(row?.name || "").trim().toLowerCase()).filter(Boolean);
    const includesAny = (name, keywords) => keywords.some(keyword => name.includes(keyword));
    return {
      hasLoopback: names.some(name => includesAny(name, AUDIO_LOOPBACK_DEVICE_KEYWORDS_UI)),
      hasVirtualCable: names.some(name => includesAny(name, AUDIO_VIRTUAL_CABLE_KEYWORDS_UI)),
      hasUsbAudio: names.some(name => includesAny(name, AUDIO_USB_DEVICE_KEYWORDS_UI))
    };
  }

  function buildAudioCaptureGuidanceTextUi() {
    const backend = resolveAudioCaptureBackendLabelUi();
    const appIsoEnabled = isAudioCaptureModeAppIsolationUiEnabled();
    const hasLoopback = ui.audioHasLoopbackDevice === true;
    const hasVirtualCable = ui.audioHasVirtualCableDevice === true;
    const hasUsbAudio = ui.audioDetectedUsbAudio === true;
    const scannedCount = Math.max(0, Number(ui.audioLastDeviceScanCount || 0));
    const defaultEndpointName = String(ui.audioDefaultOutputEndpointName || "").trim();

    let backendText = "Auto backend selected: engine picks the best available path for this machine (rust-first).";
    if (backend === "rustloop") {
      backendText = "Rust loopback backend selected: capture usually works without virtual cable.";
    } else if (backend === "ffmpeg") {
      backendText = "FFmpeg backend selected: capture uses PRIMARY INPUT DEVICE / DEFAULT SOURCE DEVICE(S).";
    } else if (backend === "portaudio") {
      backendText = "PortAudio backend selected: capture uses AUTO SELECT / DEVICE MATCH from detected inputs.";
    }

    let deviceText = "";
    if (scannedCount <= 0) {
      deviceText = "Click SCAN DEVICES to refresh available capture sources.";
    } else if (hasLoopback) {
      deviceText = "Native loopback-style source detected; virtual cable is optional.";
    } else if (hasVirtualCable) {
      deviceText = "Virtual cable device detected. Use it only when native loopback is unavailable for your setup.";
    } else if (hasUsbAudio) {
      deviceText = "USB-style audio path detected with no loopback source; legacy capture may require VB-Audio Virtual Cable.";
    } else {
      deviceText = "No loopback-style source detected; if legacy capture has no audio, install/select VB-Audio Virtual Cable.";
    }

    const modeText = appIsoEnabled
      ? "APP ISOLATION is ON."
      : "DESKTOP LISTEN is ON.";
    const defaultText = defaultEndpointName
      ? `Windows default output detected: ${defaultEndpointName}.`
      : "";
    return `${backendText} ${deviceText} ${defaultText} ${modeText}`.replace(/\s+/g, " ").trim();
  }

  function updateAudioCaptureGuidanceUi() {
    if (!el.aCaptureGuidanceHint) return;
    el.aCaptureGuidanceHint.textContent = buildAudioCaptureGuidanceTextUi();
  }

  function applyAudioConfigToInputs(config = {}) {
    audioRuntimeConfigSignatureUi = buildAudioRuntimeConfigSignatureUi(config);
    const backendRaw = String(config.inputBackend || "auto").trim().toLowerCase();
    el.aInputBackend.value = backendRaw === "ffmpeg" || backendRaw === "portaudio" || backendRaw === "rustloop"
      ? backendRaw
      : "auto";
    if (el.aPreferLegacyCapture) {
      el.aPreferLegacyCapture.checked = config.autoPreferLegacyCapture === true;
    }
    if (el.aUseRustAudioKernel) {
      el.aUseRustAudioKernel.checked = config.rustAudioKernelEnabled !== false;
    }
    if (el.aUseRustSourceResolver) {
      el.aUseRustSourceResolver.checked = config.rustSourceResolverEnabled !== false;
    }
    const rustLoopbackFormat = normalizeRustLoopbackFormatUi(config.rustLoopbackFormat, "f32le");
    if (el.aRustLoopbackFormat) {
      el.aRustLoopbackFormat.value = rustLoopbackFormat;
    }
    syncRustLoopbackFormatHintUi(rustLoopbackFormat);
    el.aDeviceMatch.value = config.deviceMatch || "";
    el.aDeviceId.value = config.deviceId === null || config.deviceId === undefined
      ? ""
      : String(config.deviceId);
    ui.audioConfiguredDesktopOutputDeviceName = normalizeAudioOutputEndpointNameUi(config.desktopOutputDeviceName || "");
    el.aFfmpegPath.value = String(config.ffmpegPath || "ffmpeg");
    const ffmpegFormatRaw = String(config.ffmpegInputFormat || "dshow").trim().toLowerCase();
    el.aFfmpegFormat.value = ffmpegFormatRaw === "wasapi" ? "wasapi" : "dshow";
    const sourceList = normalizeAudioDeviceListUi(
      config.ffmpegInputDevices,
      String(config.ffmpegInputDevice || "").trim() ? [String(config.ffmpegInputDevice || "").trim()] : []
    );
    el.aFfmpegDevice.value = sourceList[0] || String(config.ffmpegInputDevice || "");
    if (el.aFfmpegSources) el.aFfmpegSources.value = formatAudioDeviceListUi(sourceList);
    if (el.aAppIsolationEnabled) el.aAppIsolationEnabled.checked = config.ffmpegAppIsolationEnabled === true;
    syncAudioCaptureModeUi({ appIsoEnabled: config.ffmpegAppIsolationEnabled === true });
    if (el.aAppIsolationMultiSource) el.aAppIsolationMultiSource.checked = config.ffmpegAppIsolationMultiSource === true;
    if (el.aAppIsolationStrict) el.aAppIsolationStrict.checked = config.ffmpegAppIsolationStrict === true;
    if (el.aAppIsolationCheckMs) {
      const checkMs = String(Number(config.ffmpegAppIsolationCheckMs || 300000));
      const hasOption = Array.from(el.aAppIsolationCheckMs.options || []).some(option => option.value === checkMs);
      if (!hasOption) {
        const custom = documentRef.createElement("option");
        custom.value = checkMs;
        custom.textContent = `${Math.max(1, Math.round(Number(checkMs) / 60000))} MIN (CUSTOM)`;
        el.aAppIsolationCheckMs.appendChild(custom);
      }
      el.aAppIsolationCheckMs.value = checkMs;
    }
    setAudioAppSelectOptions(el.aAppPrimary, String(config.ffmpegAppIsolationPrimaryApp || "").trim());
    setAudioAppSelectOptions(el.aAppFallback, String(config.ffmpegAppIsolationFallbackApp || "").trim());
    ui.audioConfiguredPrimaryApp = normalizeAudioAppNameUi(config.ffmpegAppIsolationPrimaryApp || "");
    ui.audioConfiguredFallbackApp = normalizeAudioAppNameUi(config.ffmpegAppIsolationFallbackApp || "");
    if (el.aAppPrimarySources) {
      el.aAppPrimarySources.value = formatAudioDeviceListUi(config.ffmpegAppIsolationPrimaryDevices);
    }
    if (el.aAppFallbackSources) {
      el.aAppFallbackSources.value = formatAudioDeviceListUi(config.ffmpegAppIsolationFallbackDevices);
    }
    el.aSampleRate.value = String(config.sampleRate ?? "96000");
    el.aFrames.value = String(config.framesPerBuffer ?? "256");
    el.aChannels.value = String(config.channels ?? "2");
    el.aGain.value = String(config.outputGain ?? "1");
    if (el.aAutoLevelEnabled) el.aAutoLevelEnabled.checked = config.autoLevelEnabled !== false;
    if (el.aAutoLevelTarget) el.aAutoLevelTarget.value = String(config.autoLevelTargetRms ?? "0.028");
    if (el.aAutoLevelMinGain) el.aAutoLevelMinGain.value = String(config.autoLevelMinGain ?? "0.45");
    if (el.aAutoLevelMaxGain) el.aAutoLevelMaxGain.value = String(config.autoLevelMaxGain ?? "1.55");
    if (el.aAutoLevelGate) el.aAutoLevelGate.value = String(config.autoLevelGate ?? "0.007");
    el.aNoise.value = String(config.noiseFloorMin ?? "0.00045");
    el.aPeakDecay.value = String(config.peakDecay ?? "0.93");
    el.aBandLowHz.value = String(config.bandLowHz ?? "180");
    el.aBandMidHz.value = String(config.bandMidHz ?? "2200");
    el.aLimiterThreshold.value = String(config.limiterThreshold ?? "0.82");
    el.aLimiterKnee.value = String(config.limiterKnee ?? "0.16");
    el.aRestartMs.value = String(config.restartMs ?? "1500");
    el.aLogTicks.value = String(config.logEveryTicks ?? "60");
    ui.limiterPreset = detectLimiterPreset(config);
    syncLimiterPresetButtons();
    ui.audioQuickProfile = detectAudioQuickProfile(config);
    syncAudioQuickPresetButtons();
    syncAudioQuickTuningFromInputs();
    clearAudioApplyAttention(AUDIO_APPLY_ATTENTION_KEY_CONFIG);
    clearAudioApplyAttention(AUDIO_APPLY_ATTENTION_KEY_ISO);
    clearAudioApplyAttention(AUDIO_APPLY_ATTENTION_KEY_MANUAL);
    updateAudioCaptureGuidanceUi();
    syncAudioToggleIndicatorsUi();
  }

  function collectAudioConfigFromInputs() {
    const selectedSourceValue = String(el.aDevices?.value || "").trim();
    const selectedDesktopOutputToken = selectedSourceValue.startsWith("desktop:")
      ? decodeURIComponent(selectedSourceValue.slice("desktop:".length))
      : "";
    const parsedIdToken = selectedSourceValue.startsWith("portaudio:")
      ? selectedSourceValue.slice("portaudio:".length)
      : (selectedDesktopOutputToken
        ? ""
        : String(el.aDeviceId?.value || "").trim());
    const parsedDeviceId = parsedIdToken === "" ? null : Number(parsedIdToken);
    const normalizedDeviceId = Number.isFinite(parsedDeviceId) ? Math.round(parsedDeviceId) : null;
    const desktopOutputDeviceName = normalizedDeviceId === null
      ? normalizeAudioOutputEndpointNameUi(selectedDesktopOutputToken)
      : "";
    const appIsolationEnabled = isAudioCaptureModeAppIsolationUiEnabled();
    if (el.aAppIsolationEnabled) {
      el.aAppIsolationEnabled.checked = appIsolationEnabled;
    }
    const ffmpegSourceList = normalizeAudioDeviceListUi(
      el.aFfmpegSources ? el.aFfmpegSources.value : el.aFfmpegDevice.value,
      String(el.aFfmpegDevice.value || "").trim() ? [String(el.aFfmpegDevice.value || "").trim()] : []
    );
    const primaryApp = normalizeAudioAppNameUi(el.aAppPrimary?.value || "");
    const fallbackApp = normalizeAudioAppNameUi(el.aAppFallback?.value || "");
    return {
      inputBackend: String(el.aInputBackend.value || "auto").trim().toLowerCase(),
      autoPreferLegacyCapture: el.aPreferLegacyCapture ? el.aPreferLegacyCapture.checked === true : false,
      rustAudioKernelEnabled: el.aUseRustAudioKernel ? el.aUseRustAudioKernel.checked === true : true,
      rustSourceResolverEnabled: el.aUseRustSourceResolver ? el.aUseRustSourceResolver.checked === true : true,
      deviceMatch: el.aDeviceMatch.value.trim().toLowerCase(),
      deviceId: normalizedDeviceId,
      desktopOutputDeviceName,
      ffmpegPath: String(el.aFfmpegPath.value || "ffmpeg").trim(),
      ffmpegInputFormat: String(el.aFfmpegFormat.value || "dshow").trim().toLowerCase(),
      ffmpegInputDevice: ffmpegSourceList[0] || String(el.aFfmpegDevice.value || "").trim(),
      ffmpegInputDevices: ffmpegSourceList,
      ffmpegAppIsolationEnabled: appIsolationEnabled,
      ffmpegAppIsolationStrict: el.aAppIsolationStrict ? el.aAppIsolationStrict.checked === true : false,
      ffmpegAppIsolationPrimaryApp: primaryApp,
      ffmpegAppIsolationFallbackApp: fallbackApp,
      ffmpegAppIsolationPrimaryDevices: normalizeAudioDeviceListUi(el.aAppPrimarySources?.value || ""),
      ffmpegAppIsolationFallbackDevices: normalizeAudioDeviceListUi(el.aAppFallbackSources?.value || ""),
      ffmpegAppIsolationMultiSource: el.aAppIsolationMultiSource ? el.aAppIsolationMultiSource.checked === true : false,
      ffmpegAppIsolationCheckMs: el.aAppIsolationCheckMs ? Number(el.aAppIsolationCheckMs.value || 300000) : 300000,
      rustLoopbackFormat: normalizeRustLoopbackFormatUi(el.aRustLoopbackFormat?.value || "f32le", "f32le"),
      sampleRate: Number(el.aSampleRate.value),
      framesPerBuffer: Number(el.aFrames.value),
      channels: Number(el.aChannels.value),
      outputGain: Number(el.aGain.value),
      autoLevelEnabled: el.aAutoLevelEnabled ? el.aAutoLevelEnabled.checked === true : true,
      autoLevelTargetRms: Number(el.aAutoLevelTarget ? el.aAutoLevelTarget.value : "0.028"),
      autoLevelMinGain: Number(el.aAutoLevelMinGain ? el.aAutoLevelMinGain.value : "0.45"),
      autoLevelMaxGain: Number(el.aAutoLevelMaxGain ? el.aAutoLevelMaxGain.value : "1.55"),
      autoLevelGate: Number(el.aAutoLevelGate ? el.aAutoLevelGate.value : "0.007"),
      noiseFloorMin: Number(el.aNoise.value),
      peakDecay: Number(el.aPeakDecay.value),
      bandLowHz: Number(el.aBandLowHz.value),
      bandMidHz: Number(el.aBandMidHz.value),
      limiterThreshold: Number(el.aLimiterThreshold.value),
      limiterKnee: Number(el.aLimiterKnee.value),
      restartMs: Number(el.aRestartMs.value),
      logEveryTicks: Number(el.aLogTicks.value)
    };
  }

  function collectAudioAppIsolationPatchFromInputs() {
    const full = collectAudioConfigFromInputs();
    return {
      inputBackend: full.inputBackend,
      autoPreferLegacyCapture: full.autoPreferLegacyCapture,
      rustAudioKernelEnabled: full.rustAudioKernelEnabled,
      rustSourceResolverEnabled: full.rustSourceResolverEnabled,
      rustLoopbackFormat: full.rustLoopbackFormat,
      ffmpegInputFormat: full.ffmpegInputFormat,
      ffmpegInputDevice: full.ffmpegInputDevice,
      ffmpegInputDevices: full.ffmpegInputDevices,
      ffmpegAppIsolationEnabled: full.ffmpegAppIsolationEnabled,
      ffmpegAppIsolationStrict: full.ffmpegAppIsolationStrict,
      ffmpegAppIsolationPrimaryApp: full.ffmpegAppIsolationPrimaryApp,
      ffmpegAppIsolationFallbackApp: full.ffmpegAppIsolationFallbackApp,
      ffmpegAppIsolationPrimaryDevices: full.ffmpegAppIsolationPrimaryDevices,
      ffmpegAppIsolationFallbackDevices: full.ffmpegAppIsolationFallbackDevices,
      ffmpegAppIsolationMultiSource: full.ffmpegAppIsolationMultiSource,
      ffmpegAppIsolationCheckMs: full.ffmpegAppIsolationCheckMs
    };
  }

  return {
    detectLimiterPreset,
    normalizeRustLoopbackFormatUi,
    syncRustLoopbackFormatHintUi,
    isLikelyAudioSelectableAppUi,
    compareAudioSelectableAppUi,
    isAudioAppsShowAllUiEnabled,
    getAudioSelectableAppsUi,
    updateAudioAppsFilterHintUi,
    syncAudioRoutingComplexityUi,
    isAudioCaptureModeAppIsolationUiEnabled,
    syncAudioCaptureModeUi,
    setAudioAppSelectOptions,
    buildAudioRuntimeConfigSignatureUi,
    hasAudioPendingApplyAttentionUi,
    syncAudioToggleIndicatorForInputUi,
    syncAudioToggleIndicatorsUi,
    syncAudioRuntimeStateIndicatorsFromConfig,
    formatAudioActiveConfigSummaryUi,
    resolveAudioCaptureBackendLabelUi,
    computeAudioDeviceScanHintsUi,
    buildAudioCaptureGuidanceTextUi,
    updateAudioCaptureGuidanceUi,
    applyAudioConfigToInputs,
    collectAudioConfigFromInputs,
    collectAudioAppIsolationPatchFromInputs
  };
}
