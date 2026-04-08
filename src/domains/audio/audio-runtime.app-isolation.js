// [TITLE] Module: domains/audio/audio-runtime.app-isolation.js
// [TITLE] Purpose: token/channel/process resolution helpers for audio app isolation
// [TITLE] Functionality Index:
// [TITLE] - normalize app tokens and browser channel hints
// [TITLE] - build process-relationship graphs for companion selection
// [TITLE] - resolve manual locks, companion maps, and representative PIDs

const TITLE_HINT_RE = /(music|spotify|youtube|netflix|twitch|audio|video|player|stream)/i;

function normalizeString(value, max = 256) {
  return String(value || "").trim().slice(0, Math.max(1, Number(max) || 256));
}

function clamp(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number(fallback);
  return Math.min(Number(max), Math.max(Number(min), parsed));
}

function normalizeAppName(value) {
  return normalizeString(value, 128).replace(/\s+\(\d+\)\s*$/g, "").replace(/\s+\[pid\s+\d+\]\s*$/gi, "").trim();
}

function canonicalizeKnownBrowserToken(token = "") {
  const raw = normalizeString(token, 128).toLowerCase();
  if (!raw) return "";
  const compact = raw.replace(/[^a-z0-9]+/g, "");
  if (!compact) return "";
  if (
    compact === "firefox"
    || compact === "mozillafirefox"
    || compact === "firefoxnightly"
    || compact === "firefoxdeveloperedition"
    || compact === "firefoxdeveloper"
    || compact === "firefoxdevedition"
  ) {
    return "firefox";
  }
  return raw;
}

function normalizeBrowserChannelHint(value = "") {
  const token = normalizeString(value, 32).toLowerCase();
  if (token === "nightly" || token === "developer" || token === "stable" || token === "mixed") {
    return token;
  }
  return "";
}

function detectExplicitBrowserChannelHint(value = "") {
  const raw = normalizeAppName(value).toLowerCase();
  if (!raw) return "";
  const compact = raw.replace(/[^a-z0-9]+/g, "");
  if (!compact) return "";
  if (compact.includes("nightly")) return "nightly";
  if (
    compact.includes("developeredition")
    || compact.includes("firefoxdeveloper")
    || compact.includes("devedition")
  ) {
    return "developer";
  }
  if (compact === "mozillafirefox") return "stable";
  return "";
}

function formatResolvedAppLabel(tokenRaw = "", options = {}) {
  const token = normalizeAppToken(tokenRaw);
  const channelHint = normalizeBrowserChannelHint(options.channelHint || "");
  if (token === "firefox") {
    if (channelHint === "nightly") return "Firefox Nightly.exe";
    if (channelHint === "developer") return "Firefox Developer Edition.exe";
    if (channelHint === "stable") return "Mozilla Firefox.exe";
  }
  return token ? `${token}.exe` : "";
}

function normalizeAppToken(value) {
  const token = normalizeAppName(value).toLowerCase();
  if (!token) return "";
  const withoutExe = token.endsWith(".exe") ? token.slice(0, -4) : token;
  return canonicalizeKnownBrowserToken(withoutExe);
}

function normalizeTokenList(values = [], max = 128) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const token = normalizeAppToken(value);
    if (!token) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= Math.max(1, Number(max) || 128)) break;
  }
  return out;
}

function normalizeCompanionMap(raw = {}, allowedTokens = null) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {};
  const allowSet = allowedTokens instanceof Set ? allowedTokens : null;
  for (const [sourceTokenRaw, candidatesRaw] of Object.entries(source)) {
    const sourceToken = normalizeAppToken(sourceTokenRaw);
    if (!sourceToken) continue;
    if (allowSet && !allowSet.has(sourceToken)) continue;
    const candidates = normalizeTokenList(candidatesRaw, 16)
      .filter(candidate => candidate !== sourceToken)
      .filter(candidate => !allowSet || allowSet.has(candidate));
    if (!candidates.length) continue;
    out[sourceToken] = candidates;
  }
  return out;
}

function scoreTokenAffinity(sourceToken = "", candidateToken = "") {
  if (!sourceToken || !candidateToken || sourceToken === candidateToken) return 0;
  let score = 0;
  if (candidateToken.includes(sourceToken) || sourceToken.includes(candidateToken)) score += 110;
  const sourceParts = sourceToken.split(/[._-]+/g).filter(Boolean);
  const candidateParts = candidateToken.split(/[._-]+/g).filter(Boolean);
  const overlap = sourceParts.filter(part => part.length >= 3 && candidateParts.includes(part)).length;
  score += overlap * 42;
  return score;
}

function tokenLooksBrowserLike(token = "") {
  const key = normalizeAppToken(token);
  if (!key) return false;
  return /(browser|webview|chrome|chromium|msedge|edge|firefox|opera|brave|vivaldi|cef|safari)/i.test(key);
}

function tokenLooksCompanionLike(token = "") {
  const key = normalizeAppToken(token);
  if (!key) return false;
  if (/(crash|updater|installer|telemetry|monitor|update)/i.test(key)) return false;
  return /(audio|helper|agent|library|service|player|engine|daemon|host|renderer|broker|cef|obs)/i.test(key);
}

function tokenLooksNoisyAuxiliary(token = "") {
  const key = normalizeAppToken(token);
  if (!key) return false;
  return /(crash|updater|installer|telemetry|monitor|gpu|utility|report|update)/i.test(key);
}

function detectBrowserChannelHint(token = "", options = {}) {
  const normalizedToken = normalizeAppToken(token);
  if (!normalizedToken) return "";
  const windowTitles = Array.isArray(options.windowTitles) ? options.windowTitles : [];
  const executablePaths = Array.isArray(options.executablePaths) ? options.executablePaths : [];
  const haystack = [...windowTitles, ...executablePaths]
    .map(value => normalizeString(value, 512).toLowerCase())
    .filter(Boolean)
    .join(" ");
  if (!haystack) return "";
  if (normalizedToken === "firefox") {
    const matches = [];
    if (haystack.includes("nightly")) matches.push("nightly");
    if (haystack.includes("developer edition") || haystack.includes("devedition") || haystack.includes("dev-edition")) {
      matches.push("developer");
    }
    if (haystack.includes("mozilla firefox")) matches.push("stable");
    const uniqueMatches = [...new Set(matches)];
    if (uniqueMatches.length > 1) return "mixed";
    return uniqueMatches[0] || "";
  }
  return "";
}

function sanitizeManualLockMap(rawLocks = {}) {
  const source = rawLocks && typeof rawLocks === "object" && !Array.isArray(rawLocks) ? rawLocks : {};
  const out = {};
  for (const [rawSourceToken, rawCaptureToken] of Object.entries(source)) {
    const sourceToken = normalizeAppToken(rawSourceToken);
    const captureToken = normalizeAppToken(rawCaptureToken);
    if (!sourceToken || !captureToken) continue;
    if (!/^[a-z0-9._-]{1,96}$/.test(sourceToken) || !/^[a-z0-9._-]{1,96}$/.test(captureToken)) continue;
    out[sourceToken] = captureToken;
    if (Object.keys(out).length >= 256) break;
  }
  return out;
}

function normalizeExecutableDir(pathValue = "") {
  const raw = String(pathValue || "").trim().toLowerCase().replace(/\//g, "\\");
  if (!raw) return "";
  const idx = raw.lastIndexOf("\\");
  return idx > 0 ? raw.slice(0, idx) : "";
}

function normalizeProcessMetadataRows(rows = [], apps = []) {
  const merged = [];
  if (Array.isArray(rows)) merged.push(...rows);
  if (Array.isArray(apps)) {
    for (const app of apps) {
      const token = normalizeAppToken(app?.displayName || app?.app || app?.processName || "");
      const pids = Array.isArray(app?.pids) ? app.pids : [];
      const executablePath = normalizeString(app?.executablePath || app?.path || "", 512);
      for (const pidRaw of pids) {
        const pid = Math.max(0, Math.round(Number(pidRaw || 0)));
        if (!(pid > 0) || !token) continue;
        merged.push({
          token,
          pid,
          parentPid: 0,
          executablePath,
          hasWindow: Array.isArray(app?.windowTitles) && app.windowTitles.length > 0
        });
      }
    }
  }
  const out = [];
  const seen = new Set();
  for (const row of merged) {
    if (!row || typeof row !== "object") continue;
    const token = normalizeAppToken(
      row?.token
      || row?.processName
      || row?.app
      || row?.displayName
      || row?.name
      || row?.ProcessName
      || ""
    );
    const pid = Math.max(0, Math.round(Number(
      row?.pid
      || row?.id
      || row?.ProcessId
      || row?.Id
      || 0
    )));
    if (!(pid > 0) || !token) continue;
    const parentPid = Math.max(0, Math.round(Number(
      row?.parentPid
      || row?.parentProcessId
      || row?.ParentProcessId
      || 0
    )));
    const executablePath = normalizeString(
      row?.executablePath
      || row?.path
      || row?.ExecutablePath
      || row?.Path
      || "",
      512
    );
    const mainWindowTitle = normalizeString(row?.mainWindowTitle || row?.MainWindowTitle || "", 256);
    const hasWindow = row?.hasWindow === true || Boolean(mainWindowTitle);
    const key = `${token}:${pid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      token,
      pid,
      parentPid,
      executablePath,
      hasWindow,
      mainWindowTitle
    });
    if (out.length >= 2000) break;
  }
  return out;
}

function buildProcessGraph(rows = [], apps = []) {
  const normalizedRows = normalizeProcessMetadataRows(rows, apps);
  const pidToToken = new Map();
  const pidToParentPid = new Map();
  const pidToExecutableDir = new Map();
  const tokenToPids = new Map();
  for (const row of normalizedRows) {
    const pid = Math.max(0, Number(row?.pid || 0));
    const token = normalizeAppToken(row?.token || "");
    if (!(pid > 0) || !token) continue;
    const parentPid = Math.max(0, Number(row?.parentPid || 0));
    const executableDir = normalizeExecutableDir(row?.executablePath || "");
    pidToToken.set(pid, token);
    pidToParentPid.set(pid, parentPid);
    if (executableDir) pidToExecutableDir.set(pid, executableDir);
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

function hasProcessTreeRelationship(sourceToken = "", candidateToken = "", graph = null) {
  const source = normalizeAppToken(sourceToken);
  const candidate = normalizeAppToken(candidateToken);
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

function hasSharedParentRelationship(sourceToken = "", candidateToken = "", graph = null) {
  const source = normalizeAppToken(sourceToken);
  const candidate = normalizeAppToken(candidateToken);
  if (!source || !candidate || source === candidate || !graph) return false;
  const sourcePids = graph.tokenToPids instanceof Map ? graph.tokenToPids.get(source) : null;
  const candidatePids = graph.tokenToPids instanceof Map ? graph.tokenToPids.get(candidate) : null;
  if (!(sourcePids instanceof Set) || !(candidatePids instanceof Set) || !sourcePids.size || !candidatePids.size) {
    return false;
  }
  const pidToParentPid = graph.pidToParentPid instanceof Map ? graph.pidToParentPid : new Map();
  const sourceParents = new Set();
  for (const pid of sourcePids) {
    const parentPid = Math.max(0, Math.round(Number(pidToParentPid.get(pid) || 0)));
    if (parentPid > 0) sourceParents.add(parentPid);
  }
  if (!sourceParents.size) return false;
  for (const pid of candidatePids) {
    const parentPid = Math.max(0, Math.round(Number(pidToParentPid.get(pid) || 0)));
    if (parentPid > 0 && sourceParents.has(parentPid)) return true;
  }
  return false;
}

function hasExecutableDirRelationship(sourceToken = "", candidateToken = "", graph = null) {
  const source = normalizeAppToken(sourceToken);
  const candidate = normalizeAppToken(candidateToken);
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

function getProcessRelationship(sourceToken = "", candidateToken = "", graph = null) {
  const treeRelated = hasProcessTreeRelationship(sourceToken, candidateToken, graph);
  const sharedParent = treeRelated ? false : hasSharedParentRelationship(sourceToken, candidateToken, graph);
  const dirRelated = treeRelated || sharedParent ? false : hasExecutableDirRelationship(sourceToken, candidateToken, graph);
  return {
    treeRelated,
    sharedParent,
    dirRelated,
    related: treeRelated || dirRelated
  };
}

function isCompanionCandidateAllowed(sourceToken = "", candidateToken = "", options = {}) {
  const source = normalizeAppToken(sourceToken);
  const candidate = normalizeAppToken(candidateToken);
  if (!source || !candidate || source === candidate) return false;
  if (tokenLooksNoisyAuxiliary(candidate)) return false;
  const sourceLooksBrowser = options?.sourceLooksBrowser === true;
  const graph = options?.processGraph || null;
  const affinity = scoreTokenAffinity(source, candidate);
  const relation = getProcessRelationship(source, candidate, graph);
  if (relation.treeRelated || relation.dirRelated) return true;
  if (relation.sharedParent) return affinity >= (sourceLooksBrowser ? 96 : 68);
  if (sourceLooksBrowser) return affinity >= 88;
  if (affinity >= 44) return true;
  return tokenLooksCompanionLike(candidate) && affinity >= 12;
}

function isManualLockCandidateAllowed(sourceToken = "", candidateToken = "", options = {}) {
  const source = normalizeAppToken(sourceToken);
  const candidate = normalizeAppToken(candidateToken);
  if (!source || !candidate) return false;
  if (source === candidate) return true;
  if (tokenLooksNoisyAuxiliary(candidate)) return false;
  const sourceLooksBrowser = options?.sourceLooksBrowser === true;
  const graph = options?.processGraph || null;
  const affinity = scoreTokenAffinity(source, candidate);
  const relation = getProcessRelationship(source, candidate, graph);
  if (relation.treeRelated || relation.dirRelated) return true;
  if (relation.sharedParent) return affinity >= (sourceLooksBrowser ? 104 : 74);
  if (sourceLooksBrowser) return affinity >= 92;
  if (affinity >= 30) return true;
  return tokenLooksCompanionLike(candidate) && affinity >= 14;
}

function filterManualLockMapForApps(lockMap = {}, appsPayload = {}) {
  const sanitized = sanitizeManualLockMap(lockMap);
  const apps = Array.isArray(appsPayload?.apps) ? appsPayload.apps : [];
  const processMetadata = Array.isArray(appsPayload?.processMetadata) ? appsPayload.processMetadata : [];
  const processGraph = buildProcessGraph(processMetadata, apps);
  const runningTokens = new Set(normalizeTokenList(
    apps.map(item => item?.displayName || item?.app || item?.processName || ""),
    512
  ));
  const audioTokens = new Set(normalizeTokenList(appsPayload?.audioHints?.audioTokens, 512));
  const runningOrAudio = new Set([...runningTokens, ...audioTokens]);
  const out = {};
  for (const [rawSourceToken, rawCaptureToken] of Object.entries(sanitized)) {
    const sourceToken = normalizeAppToken(rawSourceToken);
    const captureToken = normalizeAppToken(rawCaptureToken);
    if (!sourceToken || !captureToken) continue;
    const sourceVisible = runningOrAudio.has(sourceToken);
    const captureVisible = runningOrAudio.has(captureToken);
    if (!sourceVisible || !captureVisible) {
      out[sourceToken] = captureToken;
      continue;
    }
    const sourceLooksBrowser = tokenLooksBrowserLike(sourceToken);
    if (isManualLockCandidateAllowed(sourceToken, captureToken, { sourceLooksBrowser, processGraph })) {
      out[sourceToken] = captureToken;
    }
  }
  return out;
}

function resolveAppIsolationTargetSelection(runtimeConfig = {}, appsPayload = {}, lockMap = {}) {
  const source = runtimeConfig && typeof runtimeConfig === "object" ? runtimeConfig : {};
  const apps = Array.isArray(appsPayload?.apps) ? appsPayload.apps : [];
  const processMetadata = Array.isArray(appsPayload?.processMetadata) ? appsPayload.processMetadata : [];
  const audioHints = appsPayload?.audioHints && typeof appsPayload.audioHints === "object"
    ? appsPayload.audioHints
    : {};
  const runningTokens = new Set(normalizeTokenList(
    apps.map(item => item?.displayName || item?.app || item?.processName || ""),
    512
  ));
  const audioTokens = new Set(normalizeTokenList(audioHints.audioTokens, 512));
  const processGraph = buildProcessGraph(processMetadata, apps);
  const runningOrAudioTokens = new Set([...runningTokens, ...audioTokens]);
  const companionMap = normalizeCompanionMap(audioHints.companionMap, runningOrAudioTokens);
  const primaryToken = normalizeAppToken(source.ffmpegAppIsolationPrimaryApp || "");
  const fallbackToken = normalizeAppToken(source.ffmpegAppIsolationFallbackApp || "");
  const primaryChannelHint = detectExplicitBrowserChannelHint(source.ffmpegAppIsolationPrimaryApp || "");
  const fallbackChannelHint = detectExplicitBrowserChannelHint(source.ffmpegAppIsolationFallbackApp || "");
  const strictMode = source.ffmpegAppIsolationStrict === true;
  const primaryDevices = [...new Set((Array.isArray(source.ffmpegAppIsolationPrimaryDevices) ? source.ffmpegAppIsolationPrimaryDevices : []).map(value => normalizeString(value, 256)).filter(Boolean))];
  const fallbackDevices = [...new Set((Array.isArray(source.ffmpegAppIsolationFallbackDevices) ? source.ffmpegAppIsolationFallbackDevices : []).map(value => normalizeString(value, 256)).filter(Boolean))];
  const appByToken = new Map();
  for (const app of apps) {
    const token = normalizeAppToken(app?.displayName || app?.app || app?.processName || "");
    if (!token || appByToken.has(token)) continue;
    appByToken.set(token, app);
  }

  const selectFallbackAudioCompanion = (normalizedSource = "", companionCandidates = [], sourceLooksBrowser = false) => {
    if (!normalizedSource) return "";
    const sourceApp = appByToken.get(normalizedSource) || {};
    const sourceTitles = Array.isArray(sourceApp.windowTitles) ? sourceApp.windowTitles : [];
    const sourceHasMediaTitle = sourceTitles.some(title => TITLE_HINT_RE.test(String(title || "")));
    const ranked = [];
    for (const candidateToken of audioTokens) {
      const normalizedCandidate = normalizeAppToken(candidateToken);
      if (!normalizedCandidate || normalizedCandidate === normalizedSource) continue;
      if (!runningOrAudioTokens.has(normalizedCandidate)) continue;
      const relation = getProcessRelationship(normalizedSource, normalizedCandidate, processGraph);
      if (!isCompanionCandidateAllowed(normalizedSource, normalizedCandidate, { sourceLooksBrowser, processGraph })) continue;
      const candidateApp = appByToken.get(normalizedCandidate) || {};
      const candidateTitles = Array.isArray(candidateApp.windowTitles) ? candidateApp.windowTitles : [];
      const candidateHasMediaTitle = candidateTitles.some(title => TITLE_HINT_RE.test(String(title || "")));
      const candidateLikelyAudio = candidateApp.audioCapable === true || candidateApp.likelyAudio === true || audioTokens.has(normalizedCandidate);
      const candidateConfidence = clamp(candidateApp.likelyAudioConfidence, 0, 1, candidateLikelyAudio ? 0.72 : 0);
      const candidateHasWindow = candidateTitles.length > 0;
      let score = scoreTokenAffinity(normalizedSource, normalizedCandidate);
      if (companionCandidates.includes(normalizedCandidate)) score += 220;
      if (candidateLikelyAudio) score += 36;
      score += Math.round(candidateConfidence * 44);
      if (relation.treeRelated) score += 320;
      else if (relation.sharedParent) score += 72;
      else if (relation.dirRelated) score += 170;
      else if (sourceLooksBrowser) score -= 120;
      if (sourceLooksBrowser && tokenLooksCompanionLike(normalizedCandidate)) score += 28;
      if (sourceLooksBrowser && !candidateHasWindow) score += 24;
      if (sourceHasMediaTitle && candidateHasMediaTitle) score += 18;
      if (tokenLooksNoisyAuxiliary(normalizedCandidate)) score -= 92;
      if (score <= 0) continue;
      ranked.push({ token: normalizedCandidate, score });
    }
    ranked.sort((a, b) => b.score - a.score || String(a.token || "").localeCompare(String(b.token || "")));
    const best = ranked[0];
    if (!best || !best.token) return "";
    return best.score >= (sourceLooksBrowser ? 70 : 120) ? best.token : "";
  };

  const resolveCaptureStateForSource = (sourceToken, options = {}) => {
    const normalizedSource = normalizeAppToken(sourceToken);
    const preferredChannel = normalizeBrowserChannelHint(options.preferredChannel || "");
    if (!normalizedSource) {
      return { sourceToken: "", captureToken: "", sourceChannelHint: preferredChannel, captureChannelHint: "", running: false, reason: "missing_source" };
    }
    const sourceLooksBrowser = tokenLooksBrowserLike(normalizedSource);
    const lockCaptureRaw = normalizeAppToken(lockMap && typeof lockMap === "object" ? lockMap[normalizedSource] : "");
    const lockCaptureAllowed = isManualLockCandidateAllowed(normalizedSource, lockCaptureRaw, { sourceLooksBrowser, processGraph });
    const lockCapture = lockCaptureAllowed ? lockCaptureRaw : "";
    const companionCandidates = Array.isArray(companionMap[normalizedSource])
      ? companionMap[normalizedSource].map(value => normalizeAppToken(value)).filter(candidate => isCompanionCandidateAllowed(normalizedSource, candidate, { sourceLooksBrowser, processGraph }))
      : [];
    const sourceAudioActive = audioTokens.has(normalizedSource);
    const sourceRunning = runningTokens.has(normalizedSource);
    const activeCompanionAudio = companionCandidates.find(candidate => audioTokens.has(candidate) && isCompanionCandidateAllowed(normalizedSource, candidate, { sourceLooksBrowser, processGraph })) || "";
    if (sourceAudioActive) return { sourceToken: normalizedSource, captureToken: normalizedSource, sourceChannelHint: preferredChannel, captureChannelHint: preferredChannel, running: true, reason: "source_active" };
    if (lockCapture && runningOrAudioTokens.has(lockCapture)) return { sourceToken: normalizedSource, captureToken: lockCapture, sourceChannelHint: preferredChannel, captureChannelHint: "", running: true, reason: "manual_lock_active" };
    if (activeCompanionAudio) return { sourceToken: normalizedSource, captureToken: activeCompanionAudio, sourceChannelHint: preferredChannel, captureChannelHint: "", running: true, reason: "companion_active" };
    const fallbackCompanionAudio = selectFallbackAudioCompanion(normalizedSource, companionCandidates, sourceLooksBrowser);
    if (fallbackCompanionAudio) {
      return { sourceToken: normalizedSource, captureToken: fallbackCompanionAudio, sourceChannelHint: preferredChannel, captureChannelHint: "", running: true, reason: sourceLooksBrowser ? "browser_fallback_active" : "dynamic_fallback_active" };
    }
    if (sourceRunning) return { sourceToken: normalizedSource, captureToken: "", sourceChannelHint: preferredChannel, captureChannelHint: "", running: false, reason: "source_running_no_audio" };
    if (lockCaptureRaw) return { sourceToken: normalizedSource, captureToken: lockCaptureRaw, sourceChannelHint: preferredChannel, captureChannelHint: "", running: false, reason: lockCaptureAllowed ? "manual_lock_inactive" : "manual_lock_mismatch" };
    return { sourceToken: normalizedSource, captureToken: "", sourceChannelHint: preferredChannel, captureChannelHint: "", running: false, reason: "source_inactive" };
  };

  const primaryState = resolveCaptureStateForSource(primaryToken, { preferredChannel: primaryChannelHint });
  const fallbackState = resolveCaptureStateForSource(fallbackToken, { preferredChannel: fallbackChannelHint });
  const primaryAllowsFallback = !primaryToken || primaryState.reason === "source_inactive" || primaryState.reason === "missing_source";
  const selectedState = primaryToken && primaryState.running
    ? { ...primaryState, selectedBy: "primary_active" }
    : (fallbackToken && fallbackState.running && primaryAllowsFallback)
      ? { ...fallbackState, selectedBy: "fallback_active" }
      : primaryToken
        ? { ...primaryState, selectedBy: "primary_configured" }
        : fallbackToken
          ? { ...fallbackState, selectedBy: "fallback_configured" }
          : { sourceToken: "", captureToken: "", sourceChannelHint: "", captureChannelHint: "", running: false, reason: "no_configured_targets", selectedBy: "none" };
  const selectedSourceToken = normalizeAppToken(selectedState.sourceToken || "");
  const selectedSourceChannelHint = normalizeBrowserChannelHint(selectedState.sourceChannelHint || "");
  const captureToken = selectedState.running ? normalizeAppToken(selectedState.captureToken || selectedSourceToken) : "";
  const captureChannelHint = normalizeBrowserChannelHint(selectedState.captureChannelHint || (captureToken && captureToken === selectedSourceToken ? selectedSourceChannelHint : ""));
  const selectedMode = !selectedSourceToken
    ? (strictMode ? "strict_missing_target" : "manual_default")
    : (selectedState.selectedBy === "primary_active" ? "primary" : (selectedState.selectedBy === "fallback_active" ? "fallback_app" : "awaiting_app"));
  const selectedModeIsFallback = selectedMode === "fallback_app";
  const resolvedDevices = selectedModeIsFallback && fallbackDevices.length ? fallbackDevices : (primaryDevices.length ? primaryDevices : fallbackDevices);
  return {
    selectedSourceToken,
    selectedSourceChannelHint,
    captureToken,
    captureChannelHint,
    running: selectedState.running === true,
    selectedMode,
    selectedBy: selectedState.selectedBy,
    captureReason: selectedState.reason,
    strictMode,
    selectedApp: formatResolvedAppLabel(selectedSourceToken, { channelHint: selectedSourceChannelHint }),
    activeApp: formatResolvedAppLabel(captureToken, { channelHint: captureChannelHint }),
    resolvedDevices
  };
}

function buildCompanionMapFromAudioTokens(apps = [], audioTokens = [], processMetadata = []) {
  const audioSet = new Set(normalizeTokenList(audioTokens, 256));
  const processGraph = buildProcessGraph(processMetadata, apps);
  const appByToken = new Map();
  for (const app of (Array.isArray(apps) ? apps : [])) {
    const token = normalizeAppToken(app?.displayName || app?.app || app?.processName || "");
    if (!token || appByToken.has(token)) continue;
    appByToken.set(token, app);
  }
  const appTokens = normalizeTokenList(
    (Array.isArray(apps) ? apps : []).map(item => (item?.displayName || item?.app || item?.processName || "")),
    256
  );
  const out = {};
  for (const sourceToken of appTokens) {
    const sourceLooksBrowser = tokenLooksBrowserLike(sourceToken);
    const ranked = [];
    for (const candidateToken of audioSet) {
      if (candidateToken === sourceToken) continue;
      const relation = getProcessRelationship(sourceToken, candidateToken, processGraph);
      if (!isCompanionCandidateAllowed(sourceToken, candidateToken, { sourceLooksBrowser, processGraph })) continue;
      const candidateRow = appByToken.get(candidateToken) || {};
      const candidateLikelyAudio = candidateRow.audioCapable === true || candidateRow.likelyAudio === true || audioSet.has(candidateToken);
      const candidateConfidence = clamp(candidateRow.likelyAudioConfidence, 0, 1, candidateLikelyAudio ? 0.7 : 0);
      let score = scoreTokenAffinity(sourceToken, candidateToken);
      if (candidateLikelyAudio) score += 22;
      score += Math.round(candidateConfidence * 24);
      if (relation.treeRelated) score += 260;
      else if (relation.sharedParent) score += 64;
      else if (relation.dirRelated) score += 140;
      else if (sourceLooksBrowser) score -= 100;
      if (sourceLooksBrowser && tokenLooksCompanionLike(candidateToken)) score += 28;
      if (sourceLooksBrowser && tokenLooksNoisyAuxiliary(candidateToken)) score -= 70;
      if (score <= 0) continue;
      ranked.push({ token: candidateToken, score });
    }
    ranked.sort((a, b) => b.score - a.score || String(a.token || "").localeCompare(String(b.token || "")));
    const picks = ranked.slice(0, 8).map(row => row.token);
    if (picks.length) out[sourceToken] = picks;
  }
  return out;
}

function resolveRepresentativePidForToken(appsPayload = {}, tokenRaw = "", options = {}) {
  const token = normalizeAppToken(tokenRaw);
  const preferredChannel = normalizeBrowserChannelHint(options.preferredChannel || "");
  if (!token) return 0;
  const processMetadata = Array.isArray(appsPayload?.processMetadata) ? appsPayload.processMetadata : [];
  const rows = normalizeProcessMetadataRows(processMetadata, []).filter(row => normalizeAppToken(row?.token || "") === token);
  if (rows.length) {
    const rankedRows = rows
      .map(row => {
        const browserChannelHint = detectBrowserChannelHint(token, {
          windowTitles: [row?.mainWindowTitle || ""],
          executablePaths: [row?.executablePath || ""]
        });
        return {
          ...row,
          channelMatched: preferredChannel && browserChannelHint === preferredChannel,
          channelMismatched: preferredChannel && browserChannelHint && browserChannelHint !== preferredChannel
        };
      })
      .filter(row => !row.channelMismatched)
      .sort((a, b) => (
        Number(b.channelMatched) - Number(a.channelMatched)
        || Number(b.hasWindow) - Number(a.hasWindow)
        || Number(Boolean(b.mainWindowTitle)) - Number(Boolean(a.mainWindowTitle))
        || Number(Boolean(b.executablePath)) - Number(Boolean(a.executablePath))
        || Number(a.pid || 0) - Number(b.pid || 0)
      ));
    const preferredRow = rankedRows.find(row => Number(row?.pid || 0) > 0);
    if (preferredRow) return Math.round(Number(preferredRow.pid || 0));
  }
  const apps = Array.isArray(appsPayload?.apps) ? appsPayload.apps : [];
  for (const app of apps) {
    const appToken = normalizeAppToken(app?.displayName || app?.app || app?.processName || "");
    if (!appToken || appToken !== token) continue;
    const pid = (Array.isArray(app?.pids) ? app.pids : [])
      .map(value => Math.round(Number(value || 0)))
      .find(value => Number.isFinite(value) && value > 0);
    if (pid > 0) return pid;
  }
  return 0;
}

module.exports = {
  normalizeAppName,
  normalizeAppToken,
  normalizeBrowserChannelHint,
  tokenLooksBrowserLike,
  detectBrowserChannelHint,
  formatResolvedAppLabel,
  normalizeTokenList,
  sanitizeManualLockMap,
  normalizeProcessMetadataRows,
  filterManualLockMapForApps,
  resolveAppIsolationTargetSelection,
  buildCompanionMapFromAudioTokens,
  resolveRepresentativePidForToken
};
