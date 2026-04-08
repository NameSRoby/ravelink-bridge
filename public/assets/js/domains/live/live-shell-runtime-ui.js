// [TITLE] Module: public/assets/js/domains/live/live-shell-runtime-ui.js
// [TITLE] Purpose: live tab shell policy, feedback wrapping, and ownership audits
// [TITLE] Functionality Index:
// [TITLE] - live mode policy baseline
// [TITLE] - shared meta-auto manual override helper
// [TITLE] - live button feedback wrapping
// [TITLE] - live ownership and wiring audits
//
// [DEV] Complex Flow:
// [DEV] This module is the structural shell for the live tab. It does not own scene/profile/
// [DEV] overclock actions themselves, but it enforces the page-level assumptions those modules
// [DEV] depend on: mode policy, audit coverage, and busy-state button semantics.

const LIVE_UI_WIRING_BUTTON_IDS = Object.freeze([
  "onBtn",
  "offBtn",
  "panicBtn",
  "ocOffBtn",
  "ocOnBtn",
  "ocTurboBtn",
  "ocUltraBtn",
  "ocExtremeBtn",
  "ocInsaneBtn",
  "ocHyperBtn",
  "ocLudicrousBtn",
  "ocAutoBtn"
]);

const LIVE_UI_WIRING_CRITICAL_IDS = Object.freeze([
  "scene",
  "mode",
  "health"
]);

const LIVE_PROFILES_ONLY_UNSUPPORTED_IDS = Object.freeze(new Set([
  "panicBtn",
  "ocOffBtn",
  "ocOnBtn",
  "ocTurboBtn",
  "ocUltraBtn",
  "ocExtremeBtn",
  "ocInsaneBtn",
  "ocHyperBtn",
  "ocLudicrousBtn",
  "ocAutoBtn",
  "ocDev20Btn",
  "ocDev30Btn",
  "ocDev40Btn",
  "ocDev50Btn",
  "ocDev60Btn",
  "sceneFilterAggResetBtn",
  "sceneFilterAggSaveBtn",
  "reactGainSaveBtn",
  "liveAudioAppSearchBtn"
]));

const LIVE_CONTROL_OWNERSHIP_MATRIX = Object.freeze({
  ids: Object.freeze({
    onBtn: Object.freeze({ owner: "live-controls:power", proof: "rave.running + #health" }),
    offBtn: Object.freeze({ owner: "live-controls:power", proof: "rave.running + #health" }),
    panicBtn: Object.freeze({ owner: "live-controls:power", proof: "rave.running + #health" }),
    liveProfileName: Object.freeze({ owner: "live-profile-runtime:store", proof: "#liveProfileStat" }),
    liveProfileSelect: Object.freeze({ owner: "live-profile-runtime:store", proof: "#liveProfileStat" }),
    liveProfileSaveBtn: Object.freeze({ owner: "live-profile-runtime:store", proof: "#liveProfileStat" }),
    liveProfileLoadBtn: Object.freeze({ owner: "live-profile-runtime:store", proof: "#liveProfileStat" }),
    liveProfileDeleteBtn: Object.freeze({ owner: "live-profile-runtime:store", proof: "#liveProfileStat" }),
    liveProfileResetBtn: Object.freeze({ owner: "live-profile-runtime:store", proof: "#liveProfileStat" }),
    ocOffBtn: Object.freeze({ owner: "live-controls:overclock", proof: "telemetry.overclock + #health" }),
    ocOnBtn: Object.freeze({ owner: "live-controls:overclock", proof: "telemetry.overclock + #health" }),
    ocTurboBtn: Object.freeze({ owner: "live-controls:overclock", proof: "telemetry.overclock + #health" }),
    ocAutoBtn: Object.freeze({ owner: "live-controls:overclock", proof: "telemetry.overclockAuto + #health" }),
    ocUltraBtn: Object.freeze({ owner: "live-controls:overclock", proof: "telemetry.overclock + #health" }),
    ocExtremeBtn: Object.freeze({ owner: "live-controls:overclock", proof: "telemetry.overclock + #health" }),
    ocInsaneBtn: Object.freeze({ owner: "live-controls:overclock", proof: "telemetry.overclock + #health" }),
    ocHyperBtn: Object.freeze({ owner: "live-controls:overclock", proof: "telemetry.overclock + #health" }),
    ocLudicrousBtn: Object.freeze({ owner: "live-controls:overclock", proof: "telemetry.overclock + #health" }),
    ocDev20Btn: Object.freeze({ owner: "live-controls:overclock-dev", proof: "telemetry.overclock + #health" }),
    ocDev30Btn: Object.freeze({ owner: "live-controls:overclock-dev", proof: "telemetry.overclock + #health" }),
    ocDev40Btn: Object.freeze({ owner: "live-controls:overclock-dev", proof: "telemetry.overclock + #health" }),
    ocDev50Btn: Object.freeze({ owner: "live-controls:overclock-dev", proof: "telemetry.overclock + #health" }),
    ocDev60Btn: Object.freeze({ owner: "live-controls:overclock-dev", proof: "telemetry.overclock + #health" }),
    reactGainMode: Object.freeze({ owner: "live-controls:audio-reactivity-gain", proof: "#reactMapStatus" }),
    reactGainManual: Object.freeze({ owner: "live-controls:audio-reactivity-gain", proof: "#reactMapStatus" }),
    reactHardwareRateLimitsEnabled: Object.freeze({ owner: "live-controls:audio-reactivity-gain", proof: "#reactMapStatus" }),
    reactGainSaveBtn: Object.freeze({ owner: "live-controls:audio-reactivity-gain", proof: "#reactMapStatus" }),
    sceneFilterAggCalm: Object.freeze({ owner: "live-controls:scene-filter", proof: "#sceneFilterAggStatus" }),
    sceneFilterAggGroove: Object.freeze({ owner: "live-controls:scene-filter", proof: "#sceneFilterAggStatus" }),
    sceneFilterAggImpact: Object.freeze({ owner: "live-controls:scene-filter", proof: "#sceneFilterAggStatus" }),
    sceneFilterAggResetBtn: Object.freeze({ owner: "live-controls:scene-filter", proof: "#sceneFilterAggStatus" }),
    sceneFilterAggSaveBtn: Object.freeze({ owner: "live-controls:scene-filter", proof: "#sceneFilterAggStatus" }),
    sceneRuntimeBpmSource: Object.freeze({ owner: "live-controls:scene-runtime", proof: "#sceneRuntimeStatus" }),
    sceneRuntimeCooldownMs: Object.freeze({ owner: "live-controls:scene-runtime", proof: "#sceneRuntimeStatus" }),
    sceneRuntimeImpactHoldMs: Object.freeze({ owner: "live-controls:scene-runtime", proof: "#sceneRuntimeStatus" }),
    sceneRuntimeBrightnessFloor: Object.freeze({ owner: "live-controls:scene-runtime", proof: "#sceneRuntimeStatus" }),
    sceneRuntimeBrightnessCeil: Object.freeze({ owner: "live-controls:scene-runtime", proof: "#sceneRuntimeStatus" }),
    sceneRuntimeBeatConfidenceMin: Object.freeze({ owner: "live-controls:scene-runtime", proof: "#sceneRuntimeStatus" }),
    sceneRuntimeTransitionFloorMs: Object.freeze({ owner: "live-controls:scene-runtime", proof: "#sceneRuntimeStatus" }),
    sceneRuntimeTransitionCeilMs: Object.freeze({ owner: "live-controls:scene-runtime", proof: "#sceneRuntimeStatus" }),
    sceneRuntimeResetBtn: Object.freeze({ owner: "live-controls:scene-runtime", proof: "#sceneRuntimeStatus" }),
    sceneRuntimeSaveBtn: Object.freeze({ owner: "live-controls:scene-runtime", proof: "#sceneRuntimeStatus" }),
    sceneAutoBtn: Object.freeze({ owner: "live-controls:scene", proof: "#scene" }),
    paletteScopeGlobalBtn: Object.freeze({ owner: "palette:scope", proof: "#paletteGlobalPanel" }),
    paletteScopeCustomBtn: Object.freeze({ owner: "palette:scope", proof: "#paletteCustomPanel" }),
    paletteVividnessResetBtn: Object.freeze({ owner: "palette:vividness", proof: "#paletteStat" }),
    paletteVividness: Object.freeze({ owner: "palette:vividness", proof: "#paletteStat" }),
    paletteDisorderAggressionResetBtn: Object.freeze({ owner: "palette:order", proof: "#paletteOrderStat" }),
    paletteDisorderAggression: Object.freeze({ owner: "palette:order", proof: "#paletteOrderStat" }),
    liveAudioAppSearchBtn: Object.freeze({ owner: "audio:app-isolation-scan", proof: "#liveAudioAppSearchStat" }),
    liveSyncGroupsEnabled: Object.freeze({ owner: "live-controls:sync-groups", proof: "#liveSyncGroupsStatus" }),
    liveSyncGroupSelect: Object.freeze({ owner: "live-controls:sync-groups", proof: "#liveSyncGroupsStatus" }),
    liveSyncGroupAddBtn: Object.freeze({ owner: "live-controls:sync-groups", proof: "#liveSyncGroupsStatus" }),
    liveSyncGroupDeleteBtn: Object.freeze({ owner: "live-controls:sync-groups", proof: "#liveSyncGroupsStatus" }),
    liveSyncGroupName: Object.freeze({ owner: "live-controls:sync-groups", proof: "#liveSyncGroupsStatus" }),
    liveSyncGroupMode: Object.freeze({ owner: "live-controls:sync-groups", proof: "#liveSyncGroupsStatus" }),
    liveSyncGroupOffset: Object.freeze({ owner: "live-controls:sync-groups", proof: "#liveSyncGroupsStatus" }),
    liveSyncGroupsReloadBtn: Object.freeze({ owner: "live-controls:sync-groups", proof: "#liveSyncGroupsStatus" }),
    liveSyncGroupsSaveBtn: Object.freeze({ owner: "live-controls:sync-groups", proof: "#liveSyncGroupsStatus" })
  }),
  selectors: Object.freeze([
    Object.freeze({ selector: "[data-scene]", minCount: 1, owner: "live-controls:scene", proof: "#scene" })
  ])
});

const LIVE_BEHAVIOR_OWNER_GROUPS = Object.freeze({
  palette_motion: Object.freeze({ label: "Palette + motion", ownerPrefixes: Object.freeze(["palette:"]) }),
  cadence_auto_hz: Object.freeze({ label: "Cadence + auto hz", ownerPrefixes: Object.freeze(["live-controls:overclock", "live-controls:overclock-dev"]) }),
  scene_profile: Object.freeze({ label: "Scene + profile", ownerPrefixes: Object.freeze(["live-controls:scene", "live-profile-runtime:store"]) }),
  reactivity_gain: Object.freeze({ label: "Reactivity gain", ownerPrefixes: Object.freeze(["live-controls:audio-reactivity-gain"]) }),
  sync_groups: Object.freeze({ label: "Sync groups", ownerPrefixes: Object.freeze(["live-controls:sync-groups"]) })
});

const LIVE_OWNERSHIP_AUDIT_IGNORE_IDS = Object.freeze(["liveAudioAppSearchStat"]);
const LIVE_UI_FEEDBACK_BUTTON_IDS = Object.freeze([...LIVE_UI_WIRING_BUTTON_IDS, "ocDev20Btn", "ocDev30Btn", "ocDev40Btn", "ocDev50Btn", "ocDev60Btn"]);

function isLiveProfilesOnlyModeUi() {
  return String(ui.liveShellMode || "").trim().toLowerCase() === "profiles_only";
}

async function hydrateLiveModePolicyUi(options = {}) {
  const silent = options.silent === true;
  const payload = await liveEndpointsAdapter.getLiveStatus();
  const modeToken = String(payload?.mode || "").trim().toLowerCase();
  ui.liveShellMode = modeToken === "profiles_only" ? "profiles_only" : "full";
  ui.liveShellModeHydrated = true;
  applyLiveModeUiPolicy();
  if (!silent && isLiveProfilesOnlyModeUi()) {
    setBadge(el.health, "warn", "LIVE PROFILES-ONLY MODE");
  }
  return ui.liveShellMode;
}

function applyLiveModeUiPolicy() {
  ui.mode = "interpret";
  ui.modeLock = "interpret";
  const profilesOnly = isLiveProfilesOnlyModeUi();
  const liveRoot = document.querySelector('.panel.tabPage[data-tab="live"]');
  if (liveRoot) {
    liveRoot.classList.toggle("profilesOnlyMode", profilesOnly);
  }
  for (const node of Array.from(document.querySelectorAll(".liveAdvancedSection"))) {
    node.classList.toggle("hidden", profilesOnly);
  }
  // [DEV] LIVE core-first surface keeps non-core sections hidden in full mode so
  // [DEV] operators focus on colors, scene, auto-hz, and brightness controls first.
  if (!profilesOnly) {
    for (const node of Array.from(document.querySelectorAll(".liveNonCoreSection"))) {
      node.classList.add("hidden");
    }
  }
  for (const node of Array.from(document.querySelectorAll(".systemAdvancedEngineTools"))) {
    node.classList.toggle("hidden", profilesOnly);
  }
  if (el.liveModeNotice) {
    el.liveModeNotice.classList.toggle("hidden", !profilesOnly);
  }
  for (const id of LIVE_PROFILES_ONLY_UNSUPPORTED_IDS) {
    const node = el[id];
    if (!node) continue;
    node.disabled = profilesOnly;
  }
  if (el.panicBtn) el.panicBtn.classList.toggle("hidden", profilesOnly);
}

async function disableMetaAutoForManualOverrideLiveUi(options = {}) {
  const announce = options.announce !== false;
  if (!ui.metaAutoEnabled) return true;
  ui.metaAutoEnabled = false;
  ui.metaAutoReason = "off";
  if (announce) setBadge(el.health, "warn", "MANUAL OVERRIDE ACTIVE");
  return true;
}

function resolveLiveBehaviorOwnerGroup(owner = "") {
  const normalized = String(owner || "").trim().toLowerCase();
  if (!normalized) return "";
  for (const [groupKey, groupDef] of Object.entries(LIVE_BEHAVIOR_OWNER_GROUPS)) {
    const prefixes = Array.isArray(groupDef?.ownerPrefixes) ? groupDef.ownerPrefixes : [];
    if (prefixes.some(prefix => normalized.startsWith(String(prefix || "").trim().toLowerCase()))) {
      return groupKey;
    }
  }
  return "";
}

function collectLiveOwnershipRequiredControlIds() {
  const root = document.querySelector('.panel.tabPage[data-tab="live"]');
  if (!root) return [];
  const profilesOnly = isLiveProfilesOnlyModeUi();
  const ids = [];
  for (const node of Array.from(root.querySelectorAll("button[id],input[id],select[id],textarea[id]"))) {
    const id = String(node?.id || "").trim();
    if (!id) continue;
    if (LIVE_OWNERSHIP_AUDIT_IGNORE_IDS.includes(id)) continue;
    if (profilesOnly && LIVE_PROFILES_ONLY_UNSUPPORTED_IDS.has(id)) continue;
    if (profilesOnly && node.closest(".liveAdvancedSection")) continue;
    if (node.matches(".collapseBtn")) continue;
    if (node.readOnly === true) continue;
    const type = String(node.getAttribute("type") || "").trim().toLowerCase();
    if (type === "hidden") continue;
    if (node.closest(".hidden")) continue;
    ids.push(id);
  }
  return ids;
}

function runLiveOwnershipAudit() {
  const idRows = LIVE_CONTROL_OWNERSHIP_MATRIX?.ids || {};
  const profilesOnly = isLiveProfilesOnlyModeUi();
  const selectorRows = (Array.isArray(LIVE_CONTROL_OWNERSHIP_MATRIX?.selectors) ? LIVE_CONTROL_OWNERSHIP_MATRIX.selectors : []).filter(row => {
    if (!profilesOnly) return true;
    const selector = String(row?.selector || "").trim();
    return selector !== "[data-scene]";
  });
  const requiredControlIds = collectLiveOwnershipRequiredControlIds();
  const filteredIdRows = profilesOnly
    ? Object.fromEntries(Object.entries(idRows).filter(([id]) => !LIVE_PROFILES_ONLY_UNSUPPORTED_IDS.has(id)))
    : idRows;
  const missingControlMap = requiredControlIds.filter(id => !filteredIdRows[id]);
  const malformedIdRows = [];
  const missingBehaviorGroupRows = [];
  const behaviorGroupCounts = Object.fromEntries(Object.keys(LIVE_BEHAVIOR_OWNER_GROUPS).map(key => [key, 0]));
  for (const [id, row] of Object.entries(filteredIdRows)) {
    const owner = String(row?.owner || "").trim();
    const proof = String(row?.proof || "").trim();
    if (!owner || !proof) {
      malformedIdRows.push(id);
      continue;
    }
    const groupKey = resolveLiveBehaviorOwnerGroup(owner);
    if (groupKey) {
      behaviorGroupCounts[groupKey] = Math.max(0, Number(behaviorGroupCounts[groupKey] || 0)) + 1;
    } else if (
      owner.startsWith("palette:") ||
      owner.startsWith("live-controls:audio-reactivity-gain") ||
      owner.startsWith("live-controls:overclock") ||
      owner.startsWith("live-controls:overclock-dev") ||
      owner.startsWith("live-controls:scene") ||
      owner.startsWith("live-controls:scene-filter") ||
      owner.startsWith("live-controls:scene-runtime") ||
      owner.startsWith("live-profile-runtime:store") ||
      owner.startsWith("live-controls:sync-groups")
    ) {
      missingBehaviorGroupRows.push(id);
    }
  }
  const missingBehaviorGroups = Object.entries(behaviorGroupCounts).filter(([, count]) => Number(count || 0) <= 0).map(([key]) => key);
  const effectiveMissingBehaviorGroups = profilesOnly ? [] : missingBehaviorGroups;
  const selectorFailures = [];
  for (const row of selectorRows) {
    const selector = String(row?.selector || "").trim();
    const owner = String(row?.owner || "").trim();
    const proof = String(row?.proof || "").trim();
    const minCount = Math.max(0, Number(row?.minCount || 0));
    if (!selector || !owner || !proof) {
      selectorFailures.push({ selector: selector || "(missing)", reason: "malformed" });
      continue;
    }
    const nodes = Array.from(document.querySelectorAll(selector));
    if (nodes.length < minCount) {
      selectorFailures.push({ selector, reason: `expected>=${minCount}, actual=${nodes.length}` });
    }
  }
  const ok = missingControlMap.length === 0 && malformedIdRows.length === 0 && selectorFailures.length === 0 && missingBehaviorGroupRows.length === 0 && effectiveMissingBehaviorGroups.length === 0;
  const summary = { ok, mode: profilesOnly ? "profiles_only" : "full", requiredControlCount: requiredControlIds.length, mappedControlCount: Object.keys(filteredIdRows).length, missingControlMap, malformedIdRows, behaviorGroupCounts, missingBehaviorGroupRows, missingBehaviorGroups: effectiveMissingBehaviorGroups, selectorFailures };
  window.__ravelinkLiveOwnership = summary;
  if (!ok) {
    console.error("[LIVE][OWNERSHIP] audit failed:", summary);
    return;
  }
  console.log("[LIVE][OWNERSHIP] audit ok:", summary);
}

function installLiveUiFeedbackWrappers() {
  const profilesOnly = isLiveProfilesOnlyModeUi();
  for (const id of LIVE_UI_FEEDBACK_BUTTON_IDS) {
    if (profilesOnly && LIVE_PROFILES_ONLY_UNSUPPORTED_IDS.has(id)) continue;
    const button = el[id];
    if (!button) continue;
    installLiveButtonFeedback(button, "WORKING...");
  }
  if (!profilesOnly) {
    for (const button of sceneButtons) installLiveButtonFeedback(button, "APPLYING...");
  }
}

function wireLiveCoreQuickNavUi() {
  const buttons = Array.from(document.querySelectorAll("[data-live-jump-target]"));
  for (const button of buttons) {
    if (!button || button.dataset.liveJumpBound === "1") continue;
    button.dataset.liveJumpBound = "1";
    button.onclick = () => {
      const targetId = String(button.dataset.liveJumpTarget || "").trim();
      if (!targetId) return;
      const target = document.getElementById(targetId);
      if (!target) return;
      for (const btn of buttons) {
        btn.classList.toggle("active", btn === button);
      }
      if (target.classList.contains("collapsible")) {
        setCollapsibleState(target, false);
      }
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    };
  }
}

function runLiveUiWiringAudit() {
  const profilesOnly = isLiveProfilesOnlyModeUi();
  const missingButtons = [];
  const unwiredButtons = [];
  const missingCritical = [];
  for (const id of LIVE_UI_WIRING_BUTTON_IDS) {
    if (profilesOnly && LIVE_PROFILES_ONLY_UNSUPPORTED_IDS.has(id)) continue;
    const node = el[id];
    if (!node) {
      missingButtons.push(id);
      continue;
    }
    if (typeof node.onclick !== "function") {
      unwiredButtons.push(id);
    }
  }
  for (const id of LIVE_UI_WIRING_CRITICAL_IDS) {
    if (!el[id]) missingCritical.push(id);
  }
  const sceneNodes = profilesOnly ? [] : Array.from(document.querySelectorAll("[data-scene]"));
  const sceneUnwired = sceneNodes.filter(btn => typeof btn.onclick !== "function");
  const ok = missingButtons.length === 0 && unwiredButtons.length === 0 && missingCritical.length === 0 && sceneUnwired.length === 0;
  const summary = { ok, mode: profilesOnly ? "profiles_only" : "full", missingButtons, unwiredButtons, missingCritical, sceneButtons: sceneNodes.length, sceneUnwired: sceneUnwired.length };
  window.__ravelinkLiveUiWiring = summary;
  if (!ok) {
    const parts = [];
    if (missingButtons.length) parts.push(`missing buttons=${missingButtons.join(",")}`);
    if (unwiredButtons.length) parts.push(`unwired buttons=${unwiredButtons.join(",")}`);
    if (missingCritical.length) parts.push(`missing controls=${missingCritical.join(",")}`);
    if (sceneUnwired.length) parts.push(`unwired scene=${sceneUnwired.length}`);
    const detail = parts.join(" | ").slice(0, 460);
    if (typeof setBadge === "function") setBadge(el.health, "bad", "LIVE UI WIRING FAIL");
    console.error("[LIVE][UI] wiring audit failed:", summary);
    if (el.health) el.health.title = detail || "Live wiring audit failed";
    return;
  }
  console.log("[LIVE][UI] wiring audit ok:", summary);
}

function startLiveShellUiRuntime() {
  wireLiveCoreQuickNavUi();
  installLiveUiFeedbackWrappers();
  runLiveOwnershipAudit();
  runLiveUiWiringAudit();
}
