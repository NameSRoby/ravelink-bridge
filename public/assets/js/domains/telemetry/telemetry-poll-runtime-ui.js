// [TITLE] Module: public/assets/js/domains/telemetry/telemetry-poll-runtime-ui.js
// [TITLE] Purpose: telemetry poll + poll-loop lifecycle runtime
// [TITLE] Functionality Index:
// [TITLE] - profiles-only telemetry synthesis
// [TITLE] - poll fan-out/fan-in pipeline
// [TITLE] - in-flight guarded poll loop scheduler
// [TITLE] - poll shutdown helper
// [DEV] Complex Flow:
// [DEV] Poll runtime is isolated so cadence/error fallback behavior can evolve without
// [DEV] mixing rendering logic or broader UI sync orchestration details.

function createTelemetryPollRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const telemetryEndpointsAdapter = deps.telemetryEndpointsAdapter;
  const requiredAdapterMethods = [
    "getRaveStatus",
    "getRaveTelemetry",
    "getHueTelemetry",
    "getWizTelemetry",
    "getAudioTelemetry",
    "getFixturesSnapshot",
    "getModsSnapshot",
    "getColorPrefixes",
    "getMidiStatus",
    "getAudioReactivityMap"
  ];
  if (!telemetryEndpointsAdapter || typeof telemetryEndpointsAdapter !== "object") {
    throw new Error("telemetry poll runtime requires telemetryEndpointsAdapter");
  }
  for (const methodName of requiredAdapterMethods) {
    if (typeof telemetryEndpointsAdapter[methodName] !== "function") {
      throw new Error(`telemetry poll runtime missing adapter method: ${methodName}`);
    }
  }
  const audioDomainAdapterRef = deps.audioDomainAdapter || (typeof audioDomainAdapter === "object" ? audioDomainAdapter : null);
  const paletteDomainAdapterRef = deps.paletteDomainAdapter || (typeof paletteDomainAdapter === "object" ? paletteDomainAdapter : null);
  const fixturesDomainAdapterRef = deps.fixturesDomainAdapter || (typeof fixturesDomainAdapter === "object" ? fixturesDomainAdapter : null);
  const nextPollTick = typeof deps.nextPollTick === "function" ? deps.nextPollTick : (() => 0);
  const pollIntervalMs = Math.max(100, Number(deps.pollIntervalMs) || 220);
  const setBadge = typeof deps.setBadge === "function" ? deps.setBadge : (() => {});
  const isLiveProfilesOnlyModeUi = typeof deps.isLiveProfilesOnlyModeUi === "function"
    ? deps.isLiveProfilesOnlyModeUi
    : (() => false);
  const updateFixtures = typeof deps.updateFixtures === "function" ? deps.updateFixtures : (() => {});
  const renderMods = typeof deps.renderMods === "function" ? deps.renderMods : (() => {});
  const applyColorPrefixSnapshot = typeof deps.applyColorPrefixSnapshot === "function"
    ? deps.applyColorPrefixSnapshot
    : (() => {});
  const applyMidiSnapshot = typeof deps.applyMidiSnapshot === "function" ? deps.applyMidiSnapshot : (() => {});
  const applyMetaAutoTempoTrackersState = typeof deps.applyMetaAutoTempoTrackersState === "function"
    ? deps.applyMetaAutoTempoTrackersState
    : (() => {});
  const applyAudioReactivityMapToUi = typeof deps.applyAudioReactivityMapToUi === "function"
    ? deps.applyAudioReactivityMapToUi
    : (() => {});
  const setAudioReactivitySourceCatalogRuntime = typeof deps.setAudioReactivitySourceCatalogRuntime === "function"
    ? deps.setAudioReactivitySourceCatalogRuntime
    : (() => {});
  const AUDIO_REACTIVITY_SOURCE_CATALOG_DEFAULT = deps.AUDIO_REACTIVITY_SOURCE_CATALOG_DEFAULT || {};
  const clampFlowIntensity = typeof deps.clampFlowIntensity === "function" ? deps.clampFlowIntensity : (value => Number(value) || 1);
  const applyFlowIntensityUi = typeof deps.applyFlowIntensityUi === "function" ? deps.applyFlowIntensityUi : (() => {});
  const normalizeLiveSceneTokenUi = typeof deps.normalizeLiveSceneTokenUi === "function"
    ? deps.normalizeLiveSceneTokenUi
    : (value => String(value || "").trim().toLowerCase());
  const isKnownLiveSceneTokenUi = typeof deps.isKnownLiveSceneTokenUi === "function"
    ? deps.isKnownLiveSceneTokenUi
    : (() => false);
  const applyPaletteTelemetrySnapshotToUi = typeof deps.applyPaletteTelemetrySnapshotToUi === "function"
    ? deps.applyPaletteTelemetrySnapshotToUi
    : (() => {});
  const maybeRetuneSmartMatchFromTelemetry = typeof deps.maybeRetuneSmartMatchFromTelemetry === "function"
    ? deps.maybeRetuneSmartMatchFromTelemetry
    : (() => {});
  const setEngineHealthBadgeFromTelemetry = typeof deps.setEngineHealthBadgeFromTelemetry === "function"
    ? deps.setEngineHealthBadgeFromTelemetry
    : (() => {});
  const updateMainScopeInput = typeof deps.updateMainScopeInput === "function" ? deps.updateMainScopeInput : (() => {});
  const updateScopeHud = typeof deps.updateScopeHud === "function" ? deps.updateScopeHud : (() => {});
  const pushScopeSample = typeof deps.pushScopeSample === "function" ? deps.pushScopeSample : (() => {});
  const drawTelemetryScope = typeof deps.drawTelemetryScope === "function" ? deps.drawTelemetryScope : (() => {});
  const monitorsActive = typeof deps.monitorsActive === "function" ? deps.monitorsActive : (() => false);
  const processLiveControlAuditTelemetry = typeof deps.processLiveControlAuditTelemetry === "function"
    ? deps.processLiveControlAuditTelemetry
    : (() => {});
  const sync = typeof deps.sync === "function" ? deps.sync : (() => {});
  const updateAudioTelemetry = typeof deps.updateAudioTelemetry === "function" ? deps.updateAudioTelemetry : (() => {});
  const syncAudioRuntimeStateIndicatorsFromConfig = typeof deps.syncAudioRuntimeStateIndicatorsFromConfig === "function"
    ? deps.syncAudioRuntimeStateIndicatorsFromConfig
    : (() => {});
  const getPaletteFamiliesLabelUi = typeof deps.getPaletteFamiliesLabelUi === "function"
    ? deps.getPaletteFamiliesLabelUi
    : (() => "");
  const formatPaletteCountSummaryUi = typeof deps.formatPaletteCountSummaryUi === "function"
    ? deps.formatPaletteCountSummaryUi
    : (() => "");
  const getPaletteGlobalConfigUi = typeof deps.getPaletteGlobalConfigUi === "function"
    ? deps.getPaletteGlobalConfigUi
    : (() => ({}));
  const formatPaletteVividnessLabelUi = typeof deps.formatPaletteVividnessLabelUi === "function"
    ? deps.formatPaletteVividnessLabelUi
    : (() => "");
  const toFixedSafe = typeof deps.toFixedSafe === "function" ? deps.toFixedSafe : (value => String(value || "0"));
  const normalizeAudioTelemetryContract = typeof audioDomainAdapterRef?.normalizeAudioTelemetryContract === "function"
    ? audioDomainAdapterRef.normalizeAudioTelemetryContract
    : (payload => payload && typeof payload === "object" ? payload : {});
  const normalizeAudioReactivityMapContract = typeof audioDomainAdapterRef?.normalizeAudioReactivityMapContract === "function"
    ? audioDomainAdapterRef.normalizeAudioReactivityMapContract
    : (payload => payload && typeof payload === "object" ? payload : {});
  const normalizePaletteTelemetryContract = typeof paletteDomainAdapterRef?.normalizePaletteTelemetryContract === "function"
    ? paletteDomainAdapterRef.normalizePaletteTelemetryContract
    : (payload => payload && typeof payload === "object" ? payload : payload);
  const normalizeFixturesSnapshotContract = typeof fixturesDomainAdapterRef?.normalizeFixturesSnapshotContract === "function"
    ? fixturesDomainAdapterRef.normalizeFixturesSnapshotContract
    : (payload => payload && typeof payload === "object" ? payload : null);

  function setNodeText(node, value) {
    if (!node) return;
    node.textContent = String(value ?? "");
  }

  let pollInFlight = false;
  let pollTimer = null;

  function createProfilesOnlyRaveTelemetrySnapshot(raveStatus = null, audioTelemetry = null) {
    const rave = raveStatus && typeof raveStatus === "object" ? raveStatus : {};
    const audio = audioTelemetry && typeof audioTelemetry === "object" ? audioTelemetry : {};
    const audioLevel = Number(
      audio.audioSourceLevel ??
      audio.audioRms ??
      audio.rms ??
      audio.level ??
      0.03
    );
    return {
      ok: true,
      active: Boolean(rave.active === true),
      running: Boolean(rave.active === true),
      scene: "-",
      behavior: "profiles_only",
      phrase: "profiles_only",
      drop: false,
      energy: Number(audio.energy ?? 0.05),
      rms: audioLevel,
      audioRms: audioLevel,
      audioSourceLevel: audioLevel,
      bpm: Number(audio.bpm ?? 0),
      flowIntensity: Number(ui.flowIntensity || 1),
      brightnessPowerMode: "b",
      overclockLevel: Number(ui.overclockLevel || 2),
      paletteBrightnessSceneActive: ""
    };
  }

  async function poll(options = {}) {
    const force = options.force === true;
    const profilesOnlyLiveMode = isLiveProfilesOnlyModeUi();
    if (ui.pollPaused && !force) {
      const pausedTick = nextPollTick();
      if (el.netBadge && (pausedTick % 16) === 0) {
        setBadge(el.netBadge, "warn", "POLL PAUSED");
      }
      return;
    }

    let raveStatusRaw = null;
    let t = null;
    let hRaw = null;
    let wRaw = null;
    let aRaw = null;
    if (profilesOnlyLiveMode) {
      const [raveStatus, audioTelemetry] = await Promise.all([
        telemetryEndpointsAdapter.getRaveStatus(),
        telemetryEndpointsAdapter.getAudioTelemetry()
      ]);
      raveStatusRaw = raveStatus;
      t = createProfilesOnlyRaveTelemetrySnapshot(raveStatus, audioTelemetry);
      aRaw = audioTelemetry;
    } else {
      [raveStatusRaw, t, hRaw, wRaw, aRaw] = await Promise.all([
        telemetryEndpointsAdapter.getRaveStatus(),
        telemetryEndpointsAdapter.getRaveTelemetry(),
        telemetryEndpointsAdapter.getHueTelemetry(),
        telemetryEndpointsAdapter.getWizTelemetry(),
        telemetryEndpointsAdapter.getAudioTelemetry()
      ]);
    }
    t = t ? normalizePaletteTelemetryContract(t) : t;
    const raveStatus = raveStatusRaw && typeof raveStatusRaw === "object" ? raveStatusRaw : null;
    if (t && raveStatus && typeof raveStatus.active === "boolean") {
      t = {
        ...t,
        active: raveStatus.active === true,
        running: raveStatus.active === true,
        startedAt: Number(raveStatus.startedAt || t.startedAt || 0),
        lastStoppedAt: Number(raveStatus.lastStoppedAt || t.lastStoppedAt || 0)
      };
    }
    const h = hRaw && typeof hRaw === "object" ? hRaw : {};
    const w = wRaw && typeof wRaw === "object" ? wRaw : {};
    const a = normalizeAudioTelemetryContract(aRaw);

    const tick = nextPollTick();
    const shouldPollFixtures = (tick % 8) === 0 || !ui.fixturesSnapshotLoaded;
    const modsTabActive = ui.activeTab === "mods" || (typeof isModUiTabName === "function" && isModUiTabName(ui.activeTab));
    const shouldPollMods = (
      ui.modsLoadedAt === 0 ||
      (modsTabActive && (tick % 10) === 0) ||
      ((tick % 75) === 0)
    );
    const shouldPollColorPrefixes = (tick % 30) === 0 || !ui.colorPrefixConfigLoaded;
    const shouldPollMidi = (ui.activeTab === "midi") || (tick % 20) === 0 || !ui.midiConfigLoaded;
    const shouldPollReactMap = (tick % 40) === 0 || !ui.audioReactivityMapLoaded;
    const [fRaw, modsSnapshot, colorPrefixSnapshot, midiSnapshot, reactMapSnapshotRaw] = await Promise.all([
      shouldPollFixtures ? telemetryEndpointsAdapter.getFixturesSnapshot() : Promise.resolve(null),
      shouldPollMods ? telemetryEndpointsAdapter.getModsSnapshot() : Promise.resolve(null),
      shouldPollColorPrefixes ? telemetryEndpointsAdapter.getColorPrefixes() : Promise.resolve(null),
      shouldPollMidi ? telemetryEndpointsAdapter.getMidiStatus() : Promise.resolve(null),
      shouldPollReactMap ? telemetryEndpointsAdapter.getAudioReactivityMap() : Promise.resolve(null)
    ]);
    const f = normalizeFixturesSnapshotContract(fRaw);
    const reactMapSnapshot = reactMapSnapshotRaw && typeof reactMapSnapshotRaw === "object" && reactMapSnapshotRaw.ok
      ? {
        ...reactMapSnapshotRaw,
        config: normalizeAudioReactivityMapContract(reactMapSnapshotRaw.config)
      }
      : reactMapSnapshotRaw;

    if (!t) {
      if (f) updateFixtures(f);
      if (modsSnapshot?.ok) {
        renderMods(modsSnapshot);
      }
      if (colorPrefixSnapshot?.ok) {
        applyColorPrefixSnapshot(colorPrefixSnapshot);
        ui.colorPrefixConfigLoaded = true;
      }
      if (midiSnapshot?.ok !== false && midiSnapshot) {
        applyMidiSnapshot(midiSnapshot);
      }
      if (reactMapSnapshot?.ok && reactMapSnapshot?.config) {
        applyMetaAutoTempoTrackersState(
          reactMapSnapshot.config.metaAutoTempoTrackers || {
            baseline: reactMapSnapshot.config.metaAutoHueWizBaselineBlend === true
          }
        );
        if (reactMapSnapshot.config.sourceCatalog && typeof reactMapSnapshot.config.sourceCatalog === "object") {
          setAudioReactivitySourceCatalogRuntime({
            ...AUDIO_REACTIVITY_SOURCE_CATALOG_DEFAULT,
            ...reactMapSnapshot.config.sourceCatalog
          });
        }
        if (!ui.audioReactivityMapDirty) {
          applyAudioReactivityMapToUi(reactMapSnapshot.config, { markDirty: false });
        }
        ui.audioReactivityMapLoaded = true;
      }

      ui.pollErrors += 1;
      setBadge(el.netBadge, "bad", "NET DOWN");
      if (ui.pollErrors > 2) {
        setBadge(el.health, profilesOnlyLiveMode ? "warn" : "bad", profilesOnlyLiveMode ? "LIVE STATUS DELAYED" : "ENGINE UNREACHABLE");
      }
      const fallbackT = { energy: 0.05, rms: 0.03, audioRms: 0.03, audioSourceLevel: 0.03, drop: false, scene: "-", behavior: "-" };
      const fallbackA = { level: 0.03, transient: 0, spectralFlux: 0, bandLow: 0, bandMid: 0, bandHigh: 0 };
      ui.lastRaveTelemetry = fallbackT;
      ui.lastAudioTelemetry = a;
      updateMainScopeInput(fallbackT, fallbackA);
      updateScopeHud(fallbackT, fallbackA);
      pushScopeSample(null, null, null, null);
      drawTelemetryScope();
      return;
    }

    ui.pollErrors = 0;
    setBadge(el.netBadge, "ok", "NET OK");
    if (raveStatus && typeof raveStatus.active === "boolean") {
      ui.raveOn = raveStatus.active === true;
    } else if (typeof t.active === "boolean") {
      ui.raveOn = t.active === true;
    } else if (typeof t.running === "boolean") {
      ui.raveOn = t.running === true;
    }
    ui.lastRaveTelemetry = t && typeof t === "object" ? t : null;
    ui.lastAudioTelemetry = a;

    setNodeText(el.rms, toFixedSafe(t.audioRms ?? t.rms ?? t.audioSourceLevel, 2, "0.00"));
    setNodeText(el.eng, toFixedSafe(t.energy, 2, "0.00"));
    setNodeText(el.mode, "interpret");
    setNodeText(el.scene, t.scene || "-");
    setNodeText(el.behavior, t.behavior || "-");
    setNodeText(el.phrase, t.phrase || "-");
    setNodeText(el.dropStat, t.drop ? "YES" : "NO");
    if (el.bpmStat) {
      el.bpmStat.textContent = Number.isFinite(Number(t.bpm)) && Number(t.bpm) > 0
        ? String(Math.round(Number(t.bpm)))
        : (Number.isFinite(Number(ui.lastBpm)) && Number(ui.lastBpm) > 0 ? String(Math.round(Number(ui.lastBpm))) : "-");
    }
    if (el.paletteStat) {
      el.paletteStat.textContent = `${getPaletteFamiliesLabelUi(ui.paletteFamilies)} ${formatPaletteCountSummaryUi(getPaletteGlobalConfigUi(), ui.paletteFamilies)} | ${formatPaletteVividnessLabelUi(ui.paletteVividness)}`;
    }
    if (el.paletteOrderStat) {
      el.paletteOrderStat.textContent = ui.paletteDisorder
        ? `DISORDER ${Math.round((ui.paletteDisorderAggression || 0) * 100)}%`
        : "ORDERED";
    }
    if (Number.isFinite(Number(t.bpm)) && Number(t.bpm) > 0) {
      ui.lastBpm = Number(t.bpm);
    }
    if (Number.isFinite(Number(t.flowIntensity))) {
      const nextFlowIntensity = clampFlowIntensity(Number(t.flowIntensity));
      if (Date.now() > Number(ui.flowIntensityInputUntil || 0)) {
        ui.flowIntensity = nextFlowIntensity;
        applyFlowIntensityUi();
      }
    }
    if (typeof t.brightnessPowerMode === "string" && t.brightnessPowerMode) {
      const mode = String(t.brightnessPowerMode || "").trim().toLowerCase();
      ui.brightnessPowerMode = mode === "a" ? "a" : "b";
    }

    ui.mode = "interpret";
    ui.modeLock = "interpret";
    if (Number.isFinite(Number(t.overclockLevel))) {
      ui.overclockLevel = Number(t.overclockLevel);
      ui.overclock = ui.overclockLevel > 0;
    }
    const plannerRecommendedSceneToken = normalizeLiveSceneTokenUi(
      t?.metaAutoPlanner?.recommended?.sceneLock,
      ""
    );
    const plannerDesiredSceneToken = normalizeLiveSceneTokenUi(
      t?.metaAutoPlanner?.actions?.scene?.desiredScene,
      ""
    );
    const liveSceneToken = normalizeLiveSceneTokenUi(
      t.paletteBrightnessSceneActive || "",
      ""
    );
    const activeSceneCandidate = normalizeLiveSceneTokenUi(
      liveSceneToken ||
        plannerDesiredSceneToken ||
        plannerRecommendedSceneToken ||
        t.scene ||
        t.activeScene ||
        "",
      ""
    );
    if (isKnownLiveSceneTokenUi(activeSceneCandidate) && activeSceneCandidate !== "auto") {
      ui.activeSceneToken = activeSceneCandidate;
    } else if (!isKnownLiveSceneTokenUi(ui.activeSceneToken)) {
      ui.activeSceneToken = "";
    }
    if (isKnownLiveSceneTokenUi(plannerDesiredSceneToken) && plannerDesiredSceneToken !== "auto") {
      ui.activeSceneCandidateToken = plannerDesiredSceneToken;
    } else if (isKnownLiveSceneTokenUi(plannerRecommendedSceneToken) && plannerRecommendedSceneToken !== "auto") {
      ui.activeSceneCandidateToken = plannerRecommendedSceneToken;
    } else if (isKnownLiveSceneTokenUi(activeSceneCandidate) && activeSceneCandidate !== "auto") {
      ui.activeSceneCandidateToken = activeSceneCandidate;
    } else {
      ui.activeSceneCandidateToken = "";
    }
    applyPaletteTelemetrySnapshotToUi(t, { force });
    if (typeof t.metaAutoEnabled === "boolean") ui.metaAutoEnabled = t.metaAutoEnabled;
    if (typeof t.metaAutoReason === "string" && t.metaAutoReason) ui.metaAutoReason = t.metaAutoReason;
    if (typeof t.metaAutoGenre === "string" && t.metaAutoGenre) ui.metaAutoGenre = t.metaAutoGenre;
    if (Number.isFinite(Number(t.metaAutoHz))) ui.metaAutoHz = Number(t.metaAutoHz);
    if (typeof t.cadenceAutoEnabled === "boolean") ui.cadenceAutoEnabled = t.cadenceAutoEnabled;
    if (typeof t.cadenceAutoSource === "string" && t.cadenceAutoSource) ui.cadenceAutoSource = t.cadenceAutoSource;
    if (Number.isFinite(Number(t.cadenceAutoRequestedHz))) ui.cadenceAutoRequestedHz = Number(t.cadenceAutoRequestedHz);
    if (Number.isFinite(Number(t.cadenceAutoAppliedHz))) ui.cadenceAutoAppliedHz = Number(t.cadenceAutoAppliedHz);
    if (typeof t.cadenceAutoGuardReason === "string") ui.cadenceAutoGuardReason = t.cadenceAutoGuardReason || "none";
    if (typeof t.cadenceAutoGuarded === "boolean") ui.cadenceAutoGuarded = t.cadenceAutoGuarded;
    if (t.metaAutoTempoTrackersActive && typeof t.metaAutoTempoTrackersActive === "object") {
      ui.metaAutoTempoTrackersActive = normalizeMetaAutoTempoTrackersUi(
        t.metaAutoTempoTrackersActive,
        ui.metaAutoTempoTrackersActive
      );
    } else if (t.metaAutoTempoTrackers && typeof t.metaAutoTempoTrackers === "object") {
      ui.metaAutoTempoTrackersActive = normalizeMetaAutoTempoTrackersUi(
        t.metaAutoTempoTrackers,
        ui.metaAutoTempoTrackersActive
      );
    }
    const cadenceOwnerPresent = (
      typeof t.cadenceAutoEnabled === "boolean" ||
      (typeof t.cadenceAutoSource === "string" && t.cadenceAutoSource) ||
      Number.isFinite(Number(t.cadenceAutoAppliedHz)) ||
      Number.isFinite(Number(t.cadenceAutoRequestedHz))
    );
    if (cadenceOwnerPresent) {
      const cadenceSource = String(ui.cadenceAutoSource || "manual").trim().toLowerCase();
      ui.overclockAutoEnabled = Boolean(ui.cadenceAutoEnabled === true && cadenceSource === "auto_hz");
      if (ui.overclockAutoEnabled && Number.isFinite(Number(ui.cadenceAutoAppliedHz))) {
        ui.overclockAutoHz = Number(ui.cadenceAutoAppliedHz);
      } else if (!ui.overclockAutoEnabled) {
        ui.overclockAutoHz = null;
      }
      ui.overclockAutoReason = ui.overclockAutoEnabled ? "enabled" : "off";
    } else {
      if (typeof t.overclockAutoEnabled === "boolean") ui.overclockAutoEnabled = t.overclockAutoEnabled;
      if (typeof t.overclockAutoReason === "string" && t.overclockAutoReason) ui.overclockAutoReason = t.overclockAutoReason;
      if (Number.isFinite(Number(t.overclockAutoHz))) ui.overclockAutoHz = Number(t.overclockAutoHz);
    }
    if (typeof t.wizSceneSync === "boolean") {
      ui.wizSceneSync = t.wizSceneSync;
      ui.sceneSyncStrategy = ui.wizSceneSync ? "linked" : "independent";
    } else if (typeof t.sceneSync === "boolean") {
      ui.wizSceneSync = t.sceneSync;
      ui.sceneSyncStrategy = ui.wizSceneSync ? "linked" : "independent";
    }

    setNodeText(el.hSent, h.sent ?? 0);
    setNodeText(el.hSkip, h.skipped ?? 0);
    setNodeText(el.hLat, h.lastDurationMs ?? 0);
    const desiredEnt = h.transportDesired === "entertainment";
    const activeEnt = h.transportActive === "entertainment" || h?.entertainment?.active === true;
    let hueStateText = "REST";
    if (activeEnt) {
      hueStateText = "ENT ON";
    } else if (desiredEnt) {
      hueStateText = h.transportFallbackReason ? "ENT RETRY" : "ENT WAIT";
    } else if (h.transportFallbackReason) {
      hueStateText = "REST FB";
    }
    setNodeText(el.hState, hueStateText);

    setNodeText(el.wSent, w?.sent ?? 0);
    setNodeText(el.wSkip, w?.skipped ?? 0);
    setNodeText(el.wLat, w?.lastDurationMs ?? 0);
    setNodeText(el.wState, (w && (w.sendErrors || 0) > 0) ? "WARN" : "OK");

    if (a) {
      updateAudioTelemetry(a);
      if (a.config) {
        syncAudioRuntimeStateIndicatorsFromConfig(a.config, { allowDraftOverride: false });
        ui.audioConfigLoaded = true;
      }
    }

    if (f) updateFixtures(f);
    if (modsSnapshot?.ok) {
      renderMods(modsSnapshot);
    }
    if (colorPrefixSnapshot?.ok) {
      applyColorPrefixSnapshot(colorPrefixSnapshot);
      ui.colorPrefixConfigLoaded = true;
    }
    if (midiSnapshot?.ok !== false && midiSnapshot) {
      applyMidiSnapshot(midiSnapshot);
    }
    if (reactMapSnapshot?.ok && reactMapSnapshot?.config) {
      applyMetaAutoTempoTrackersState(
        reactMapSnapshot.config.metaAutoTempoTrackers || {
          baseline: reactMapSnapshot.config.metaAutoHueWizBaselineBlend === true
        }
      );
      if (reactMapSnapshot.config.sourceCatalog && typeof reactMapSnapshot.config.sourceCatalog === "object") {
        setAudioReactivitySourceCatalogRuntime({
          ...AUDIO_REACTIVITY_SOURCE_CATALOG_DEFAULT,
          ...reactMapSnapshot.config.sourceCatalog
        });
      }
      if (!ui.audioReactivityMapDirty) {
        applyAudioReactivityMapToUi(reactMapSnapshot.config, { markDirty: false });
      }
      ui.audioReactivityMapLoaded = true;
    }
    maybeRetuneSmartMatchFromTelemetry();

    setEngineHealthBadgeFromTelemetry(h);

    if (el.dropOverlay) {
      el.dropOverlay.style.display = t.drop ? "flex" : "none";
    }
    updateMainScopeInput(t, a);
    updateScopeHud(t, a);
    pushScopeSample(t, h, w, a);
    if (monitorsActive()) drawTelemetryScope();
    processLiveControlAuditTelemetry(t);

    sync();
  }

  async function pollLoop() {
    if (pollInFlight) {
      pollTimer = setTimeout(pollLoop, pollIntervalMs);
      return;
    }

    pollInFlight = true;
    try {
      await poll();
    } catch (err) {
      console.debug("[TELEMETRY][DEBUG] pollLoop iteration failed:", err?.message || err);
      setBadge(el.netBadge, "warn", "NET RETRY");
      try {
        sync();
      } catch (syncErr) {
        console.debug("[TELEMETRY][DEBUG] sync after poll failure failed:", syncErr?.message || syncErr);
      }
    } finally {
      pollInFlight = false;
      pollTimer = setTimeout(pollLoop, pollIntervalMs);
    }
  }

  function stopTelemetryPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  return {
    poll,
    pollLoop,
    stopTelemetryPolling
  };
}
