// [TITLE] Module: public/assets/js/domains/audio/audio-app-isolation-assist-runtime-ui.js
// [TITLE] Purpose: audio app-isolation subprocess assist ranking and UI rendering runtime
// [TITLE] Functionality Index:
// [TITLE] - manual lock/process metadata/companion map normalization
// [TITLE] - subprocess relationship scoring and ranked suggestions
// [TITLE] - app-isolation assist + manual capture helper UI rendering
// [DEV] Complex Flow:
// [DEV] Companion subprocess hints blend static API hints, process-tree lineage,
// [DEV] executable-path relationships, and manual lock state. Keep score priorities
// [DEV] stable to avoid jarring assist suggestion churn between scans.
function createAudioAppIsolationAssistRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const documentRef = deps.documentRef || document;
  const normalizeAudioAppTokenUi = typeof deps.normalizeAudioAppTokenUi === "function"
    ? deps.normalizeAudioAppTokenUi
    : (value => String(value || "").trim().toLowerCase());
  const markAudioApplyAttention = typeof deps.markAudioApplyAttention === "function"
    ? deps.markAudioApplyAttention
    : (() => {});
  const clearAudioApplyAttention = typeof deps.clearAudioApplyAttention === "function"
    ? deps.clearAudioApplyAttention
    : (() => {});
  const AUDIO_APPLY_ATTENTION_KEY_MANUAL = String(deps.AUDIO_APPLY_ATTENTION_KEY_MANUAL || "manual");
  const setTimeoutRef = typeof deps.setTimeoutRef === "function"
    ? deps.setTimeoutRef
    : setTimeout;

function normalizeAudioManualLockMapUi(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const out = {};
  for (const [rawSource, rawCapture] of Object.entries(source)) {
    const sourceToken = normalizeAudioAppTokenUi(rawSource);
    const captureToken = normalizeAudioAppTokenUi(rawCapture);
    if (!sourceToken || !captureToken) continue;
    out[sourceToken] = captureToken;
  }
  return out;
}

function normalizeAudioProcessMetadataRowsUi(value = []) {
  const rows = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const pid = Math.max(0, Math.round(Number(row.pid || 0)));
    const token = normalizeAudioAppTokenUi(row.token || row.processName || row.app || "");
    if (!(pid > 0) || !token) continue;
    const parentPid = Math.max(0, Math.round(Number(row.parentPid || 0)));
    const executablePath = String(row.executablePath || "").trim();
    const hasWindow = row.hasWindow === true;
    const key = `${token}:${pid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      pid,
      token,
      parentPid,
      executablePath,
      hasWindow
    });
  }
  return out;
}

function normalizeAudioCompanionMapUi(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const out = {};
  for (const [rawSourceToken, rawCandidates] of Object.entries(source)) {
    const sourceToken = normalizeAudioAppTokenUi(rawSourceToken);
    if (!sourceToken) continue;
    const rows = Array.isArray(rawCandidates) ? rawCandidates : [rawCandidates];
    const picked = [];
    for (const rawCandidate of rows) {
      const candidateToken = normalizeAudioAppTokenUi(rawCandidate);
      if (!candidateToken || candidateToken === sourceToken) continue;
      if (picked.includes(candidateToken)) continue;
      picked.push(candidateToken);
      if (picked.length >= 12) break;
    }
    if (picked.length) {
      out[sourceToken] = picked;
    }
  }
  return out;
}

function getAudioSelectedPrimaryAppTokenUi() {
  return normalizeAudioAppTokenUi(
    el.aAppPrimary?.value ||
    ui.audioConfiguredPrimaryApp ||
    ""
  );
}

function syncAudioManualCaptureInputUi(options = {}) {
  if (!el.aAppIsoManualCaptureToken) {
    renderAudioManualCaptureAssistUi(options);
    clearAudioApplyAttention(AUDIO_APPLY_ATTENTION_KEY_MANUAL);
    return;
  }
  const sourceToken = getAudioSelectedPrimaryAppTokenUi();
  if (!sourceToken) {
    if (options?.clearWhenNoSource === true) {
      el.aAppIsoManualCaptureToken.value = "";
    }
    renderAudioManualCaptureAssistUi(options);
    clearAudioApplyAttention(AUDIO_APPLY_ATTENTION_KEY_MANUAL);
    return;
  }
  const locks = normalizeAudioManualLockMapUi(ui.audioAppIsoManualLocks || {});
  const captureToken = normalizeAudioAppTokenUi(locks[sourceToken] || "");
  const hasTypedValue = String(el.aAppIsoManualCaptureToken.value || "").trim().length > 0;
  if (!captureToken) {
    if (options?.clearWhenMissing === true) {
      el.aAppIsoManualCaptureToken.value = "";
    }
    renderAudioManualCaptureAssistUi(options);
    if (String(el.aAppIsoManualCaptureToken.value || "").trim()) {
      markAudioApplyAttention(AUDIO_APPLY_ATTENTION_KEY_MANUAL);
    } else {
      clearAudioApplyAttention(AUDIO_APPLY_ATTENTION_KEY_MANUAL);
    }
    return;
  }
  const populateFromLock = options?.populateFromLock === true;
  if (!populateFromLock) {
    renderAudioManualCaptureAssistUi(options);
    if (hasTypedValue) {
      markAudioApplyAttention(AUDIO_APPLY_ATTENTION_KEY_MANUAL);
    } else {
      clearAudioApplyAttention(AUDIO_APPLY_ATTENTION_KEY_MANUAL);
    }
    return;
  }
  const shouldForce = options?.force === true;
  if (!shouldForce && hasTypedValue) {
    renderAudioManualCaptureAssistUi(options);
    markAudioApplyAttention(AUDIO_APPLY_ATTENTION_KEY_MANUAL);
    return;
  }
  el.aAppIsoManualCaptureToken.value = `${captureToken}.exe`;
  renderAudioManualCaptureAssistUi(options);
  clearAudioApplyAttention(AUDIO_APPLY_ATTENTION_KEY_MANUAL);
}

function resolveAudioTokenSimilarityUi(aRaw, bRaw) {
  const a = normalizeAudioAppTokenUi(aRaw);
  const b = normalizeAudioAppTokenUi(bRaw);
  if (!a || !b) return 0;
  if (a === b) return 220;
  let score = 0;
  if (a.startsWith(b) || b.startsWith(a)) score += 90;
  if (a.includes(b) || b.includes(a)) score += 45;
  const aParts = a.split(/[^a-z0-9]+/g).filter(Boolean);
  const bParts = new Set(b.split(/[^a-z0-9]+/g).filter(Boolean));
  for (const part of aParts) {
    if (part.length >= 4 && bParts.has(part)) score += 30;
  }
  return score;
}

function collectAudioLineageCompanionTokensUi(sourceToken = "") {
  const source = normalizeAudioAppTokenUi(sourceToken);
  if (!source) return [];
  const graph = buildAudioProcessGraphUi(ui.audioRunningProcessMetadata || []);
  const sourcePids = graph.tokenToPids instanceof Map ? graph.tokenToPids.get(source) : null;
  if (!(sourcePids instanceof Set) || !sourcePids.size) return [];
  const pidToParentPid = graph.pidToParentPid instanceof Map ? graph.pidToParentPid : new Map();
  const pidToToken = graph.pidToToken instanceof Map ? graph.pidToToken : new Map();
  const tokenToPids = graph.tokenToPids instanceof Map ? graph.tokenToPids : new Map();
  const ranked = new Map();

  const push = (tokenRaw, score = 0) => {
    const token = normalizeAudioAppTokenUi(tokenRaw);
    if (!token || token === source) return;
    const current = Number(ranked.get(token) || Number.NEGATIVE_INFINITY);
    if (score > current) ranked.set(token, score);
  };

  for (const sourcePid of sourcePids) {
    const parentPid = Math.max(0, Math.round(Number(pidToParentPid.get(sourcePid) || 0)));
    if (parentPid > 0) {
      for (const [candidateToken, candidatePids] of tokenToPids.entries()) {
        if (!candidateToken || candidateToken === source) continue;
        const pids = candidatePids instanceof Set ? candidatePids : new Set();
        for (const pid of pids) {
          const candidateParent = Math.max(0, Math.round(Number(pidToParentPid.get(pid) || 0)));
          if (candidateParent === sourcePid) {
            push(candidateToken, 420);
          } else if (candidateParent > 0 && candidateParent === parentPid) {
            push(candidateToken, 300);
          }
        }
      }
    }
  }

  for (const sourcePid of sourcePids) {
    let currentPid = Math.max(0, Math.round(Number(sourcePid || 0)));
    for (let i = 0; i < 3; i += 1) {
      const parentPid = Math.max(0, Math.round(Number(pidToParentPid.get(currentPid) || 0)));
      if (!(parentPid > 0)) break;
      const parentToken = normalizeAudioAppTokenUi(pidToToken.get(parentPid) || "");
      if (parentToken && parentToken !== source) {
        push(parentToken, 210);
      }
      currentPid = parentPid;
    }
  }

  return [...ranked.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([token]) => token);
}

function getAudioCompanionTokensForSelectedAppUi() {
  const sourceToken = getAudioSelectedPrimaryAppTokenUi();
  const companionMap = ui.audioCompanionMap && typeof ui.audioCompanionMap === "object"
    ? ui.audioCompanionMap
    : {};
  if (!sourceToken) return [];
  const mapTokens = Array.isArray(companionMap[sourceToken])
    ? companionMap[sourceToken]
    : [];
  const lineageTokens = collectAudioLineageCompanionTokensUi(sourceToken);
  const manualRankedTokens = collectAudioManualCaptureSuggestionsUi()
    .map(item => normalizeAudioAppTokenUi(item?.token || ""))
    .filter(Boolean);
  const merged = [...mapTokens, ...lineageTokens, ...manualRankedTokens];
  const deduped = [];
  for (const token of merged) {
    const normalized = normalizeAudioAppTokenUi(token);
    if (!normalized || normalized === sourceToken) continue;
    if (deduped.includes(normalized)) continue;
    deduped.push(normalized);
  }
  return deduped
    .map(token => normalizeAudioAppTokenUi(token))
    .filter(Boolean);
}

function renderAudioCompanionAssistUi(options = {}) {
  if (!el.aAppIsoCompanionAssist || !el.aAppIsoCompanionSelect) return;
  const sourceToken = getAudioSelectedPrimaryAppTokenUi();
  const currentManualToken = normalizeAudioAppTokenUi(el.aAppIsoManualCaptureToken?.value || "");
  const companions = getAudioCompanionTokensForSelectedAppUi();
  const manualSuggestions = collectAudioManualCaptureSuggestionsUi();
  const manualVisible = sourceToken
    ? manualSuggestions.filter(item => item.token !== sourceToken || item.reason === "locked")
    : [];
  const reasonByToken = new Map();
  for (const item of manualVisible) {
    const token = normalizeAudioAppTokenUi(item?.token || "");
    if (!token) continue;
    reasonByToken.set(token, String(item?.reason || "").trim());
  }
  const mergedTokens = [];
  const pushMerged = (rawToken) => {
    const token = normalizeAudioAppTokenUi(rawToken);
    if (!token || token === sourceToken) return;
    if (mergedTokens.includes(token)) return;
    mergedTokens.push(token);
  };
  for (const token of companions) pushMerged(token);
  for (const item of manualVisible) pushMerged(item?.token || "");
  const formatReasonLabel = (rawReason = "") => {
    const key = String(rawReason || "").trim().toLowerCase();
    if (!key) return "";
    if (key === "process_tree_audio") return "same app process tree";
    if (key === "same_install_dir_audio") return "same install folder";
    if (key === "audio_active") return "active audio";
    if (key === "locked") return "manual lock";
    if (key === "audio_capable") return "audio-capable";
    return key.replace(/_/g, " ");
  };

  if (!sourceToken || !mergedTokens.length) {
    el.aAppIsoCompanionAssist.classList.add("hidden");
    el.aAppIsoCompanionAssist.classList.remove("active");
    el.aAppIsoCompanionSelect.innerHTML = "";
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "select suggested subprocess...";
    el.aAppIsoCompanionSelect.appendChild(defaultOption);
    if (el.aAppIsoCompanionAssistHint) {
      el.aAppIsoCompanionAssistHint.textContent = "Some apps output audio from helper/agent subprocesses. Pick one suggestion, then click SET MANUAL CAPTURE.";
    }
    return;
  }

  el.aAppIsoCompanionAssist.classList.remove("hidden");
  el.aAppIsoCompanionSelect.innerHTML = "";
  const baseOption = document.createElement("option");
  baseOption.value = "";
  baseOption.textContent = "select suggested subprocess...";
  el.aAppIsoCompanionSelect.appendChild(baseOption);

  for (const token of mergedTokens.slice(0, 32)) {
    const option = document.createElement("option");
    option.value = `${token}.exe`;
    const reasonLabel = formatReasonLabel(reasonByToken.get(token) || "");
    option.textContent = reasonLabel ? `${token}.exe - ${reasonLabel}` : `${token}.exe`;
    if (token === currentManualToken) {
      option.selected = true;
    }
    el.aAppIsoCompanionSelect.appendChild(option);
  }
  if (el.aAppIsoCompanionAssistHint) {
    el.aAppIsoCompanionAssistHint.textContent =
      `This app may output audio from subprocesses (${mergedTokens.length} candidate${mergedTokens.length === 1 ? "" : "s"}). Choose one, then click SET MANUAL CAPTURE.`;
  }
  if (options?.flash === true) {
    el.aAppIsoCompanionAssist.classList.remove("active");
    setTimeoutRef(() => {
      el.aAppIsoCompanionAssist.classList.add("active");
      setTimeoutRef(() => {
        el.aAppIsoCompanionAssist.classList.remove("active");
      }, 1500);
    }, 20);
  }
}

function renderAudioManualCaptureAssistUi(options = {}) {
  renderAudioCompanionAssistUi(options);
  renderAudioManualCaptureSuggestionsUi();
}

function normalizeAudioExecutableDirUi(value = "") {
  const raw = String(value || "").trim().toLowerCase().replace(/\//g, "\\");
  if (!raw) return "";
  const idx = raw.lastIndexOf("\\");
  return idx > 0 ? raw.slice(0, idx) : "";
}

function hasAudioCompanionTokenHintUi(token = "") {
  const key = normalizeAudioAppTokenUi(token);
  if (!key) return false;
  if (/(updater|crash|gpu|renderer|broker|telemetry|monitor|installer|overlay)/i.test(key)) return false;
  return /(audio|agent|helper|service|library|player|engine|daemon|mixer|output|sink|host)/i.test(key);
}

function buildAudioProcessGraphUi(rows = []) {
  const metaRows = normalizeAudioProcessMetadataRowsUi(rows);
  const pidToToken = new Map();
  const pidToParentPid = new Map();
  const pidToExecutableDir = new Map();
  const tokenToPids = new Map();
  for (const row of metaRows) {
    const pid = Math.max(0, Math.round(Number(row.pid || 0)));
    const token = normalizeAudioAppTokenUi(row.token || "");
    if (!(pid > 0) || !token) continue;
    const parentPid = Math.max(0, Math.round(Number(row.parentPid || 0)));
    const executableDir = normalizeAudioExecutableDirUi(row.executablePath || "");
    pidToToken.set(pid, token);
    pidToParentPid.set(pid, parentPid);
    if (executableDir) {
      pidToExecutableDir.set(pid, executableDir);
    }
    if (!tokenToPids.has(token)) tokenToPids.set(token, new Set());
    tokenToPids.get(token).add(pid);
  }
  return {
    pidToToken,
    pidToParentPid,
    pidToExecutableDir,
    tokenToPids
  };
}

function hasAudioProcessTreeRelationshipUi(sourceToken = "", candidateToken = "", graph = null) {
  const source = normalizeAudioAppTokenUi(sourceToken);
  const candidate = normalizeAudioAppTokenUi(candidateToken);
  if (!source || !candidate || source === candidate || !graph) return false;
  const sourcePids = graph.tokenToPids instanceof Map ? graph.tokenToPids.get(source) : null;
  const candidatePids = graph.tokenToPids instanceof Map ? graph.tokenToPids.get(candidate) : null;
  if (!(sourcePids instanceof Set) || !(candidatePids instanceof Set) || !sourcePids.size || !candidatePids.size) {
    return false;
  }
  const pidToParentPid = graph.pidToParentPid instanceof Map ? graph.pidToParentPid : new Map();
  const isAncestor = (ancestorPid, startPid) => {
    let current = Math.max(0, Math.round(Number(startPid || 0)));
    const target = Math.max(0, Math.round(Number(ancestorPid || 0)));
    if (!(current > 0) || !(target > 0)) return false;
    const seen = new Set();
    for (let i = 0; i < 64; i += 1) {
      if (current === target) return true;
      if (seen.has(current)) return false;
      seen.add(current);
      current = Math.max(0, Math.round(Number(pidToParentPid.get(current) || 0)));
      if (!(current > 0)) return false;
    }
    return false;
  };
  for (const candidatePid of candidatePids) {
    for (const sourcePid of sourcePids) {
      if (isAncestor(sourcePid, candidatePid) || isAncestor(candidatePid, sourcePid)) return true;
    }
  }
  return false;
}

function hasAudioExecutableDirRelationshipUi(sourceToken = "", candidateToken = "", graph = null) {
  const source = normalizeAudioAppTokenUi(sourceToken);
  const candidate = normalizeAudioAppTokenUi(candidateToken);
  if (!source || !candidate || source === candidate || !graph) return false;
  const sourcePids = graph.tokenToPids instanceof Map ? graph.tokenToPids.get(source) : null;
  const candidatePids = graph.tokenToPids instanceof Map ? graph.tokenToPids.get(candidate) : null;
  if (!(sourcePids instanceof Set) || !(candidatePids instanceof Set) || !sourcePids.size || !candidatePids.size) {
    return false;
  }
  const pidToExecutableDir = graph.pidToExecutableDir instanceof Map ? graph.pidToExecutableDir : new Map();
  const dirs = new Set();
  for (const pid of sourcePids) {
    const dir = String(pidToExecutableDir.get(pid) || "").trim().toLowerCase();
    if (dir) dirs.add(dir);
  }
  if (!dirs.size) return false;
  for (const pid of candidatePids) {
    const dir = String(pidToExecutableDir.get(pid) || "").trim().toLowerCase();
    if (dir && dirs.has(dir)) return true;
  }
  return false;
}

function collectAudioManualCaptureSuggestionsUi() {
  const sourceToken = getAudioSelectedPrimaryAppTokenUi();
  const lockMap = normalizeAudioManualLockMapUi(ui.audioAppIsoManualLocks || {});
  const lockedToken = normalizeAudioAppTokenUi(lockMap[sourceToken] || "");
  const processGraph = buildAudioProcessGraphUi(ui.audioRunningProcessMetadata || []);
  const ranked = new Map();

  const push = (rawToken, score, reason = "") => {
    const token = normalizeAudioAppTokenUi(rawToken);
    if (!token) return;
    if (token === "none") return;
    const current = ranked.get(token) || { token, score: Number.NEGATIVE_INFINITY, reason: "" };
    if (score > current.score) {
      ranked.set(token, { token, score, reason });
    }
  };

  if (sourceToken) push(sourceToken, 150, "selected");
  if (lockedToken) push(lockedToken, 280, "locked");

  for (const token of Array.isArray(ui.audioAudioCapableTokens) ? ui.audioAudioCapableTokens : []) {
    const similarity = sourceToken ? resolveAudioTokenSimilarityUi(sourceToken, token) : 0;
    const treeRelated = sourceToken && hasAudioProcessTreeRelationshipUi(sourceToken, token, processGraph);
    const dirRelated = sourceToken && hasAudioExecutableDirRelationshipUi(sourceToken, token, processGraph);
    const relatedBoost = treeRelated ? 260 : dirRelated ? 170 : 0;
    const relatedReason = treeRelated ? "process_tree_audio" : dirRelated ? "same_install_dir_audio" : "audio_active";
    push(token, 120 + similarity + relatedBoost, relatedReason);
  }

  for (const app of Array.isArray(ui.audioRunningApps) ? ui.audioRunningApps : []) {
    const token = normalizeAudioAppTokenUi(app?.displayName || app?.app || app?.processName || "");
    if (!token) continue;
    let score = 0;
    let reason = app?.audioCapable === true ? "audio_capable" : "running";
    if (app?.audioCapable === true) score += 110;
    if (app?.likelyAudio === true) score += 35;
    if (app?.hasWindow !== true) score += 18;
    if (hasAudioCompanionTokenHintUi(token)) score += 26;
    if (sourceToken) score += resolveAudioTokenSimilarityUi(sourceToken, token);
    if (token === sourceToken) score += 40;
    if (sourceToken && token !== sourceToken) {
      const treeRelated = hasAudioProcessTreeRelationshipUi(sourceToken, token, processGraph);
      const dirRelated = hasAudioExecutableDirRelationshipUi(sourceToken, token, processGraph);
      if (treeRelated) {
        score += 280;
        reason = app?.audioCapable === true ? "process_tree_audio" : "process_tree";
      } else if (dirRelated && hasAudioCompanionTokenHintUi(token)) {
        score += 180;
        reason = app?.audioCapable === true ? "same_install_dir_audio" : "same_install_dir";
      } else if (sourceToken && app?.audioCapable !== true && !hasAudioCompanionTokenHintUi(token)) {
        score -= 75;
      }
    }
    push(token, score, reason);
  }

  return [...ranked.values()]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.token.localeCompare(b.token);
    })
    .slice(0, 24);
}

function renderAudioManualCaptureSuggestionsUi() {
  if (el.aAppIsoManualSuggestions) {
    el.aAppIsoManualSuggestions.innerHTML = "";
  }
  if (el.aAppIsoManualSuggestionHint) {
    el.aAppIsoManualSuggestionHint.textContent =
      "Likely audio subprocesses are listed in the dropdown above. Pick one, then click SET MANUAL CAPTURE.";
  }
}

  return {
    normalizeAudioManualLockMapUi,
    normalizeAudioProcessMetadataRowsUi,
    normalizeAudioCompanionMapUi,
    getAudioSelectedPrimaryAppTokenUi,
    syncAudioManualCaptureInputUi,
    resolveAudioTokenSimilarityUi,
    collectAudioLineageCompanionTokensUi,
    getAudioCompanionTokensForSelectedAppUi,
    renderAudioCompanionAssistUi,
    renderAudioManualCaptureAssistUi,
    normalizeAudioExecutableDirUi,
    hasAudioCompanionTokenHintUi,
    buildAudioProcessGraphUi,
    hasAudioProcessTreeRelationshipUi,
    hasAudioExecutableDirRelationshipUi,
    collectAudioManualCaptureSuggestionsUi,
    renderAudioManualCaptureSuggestionsUi
  };
}
