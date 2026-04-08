// [TITLE] Module: domains/audio/audio-runtime.catalog.js
// [TITLE] Purpose: runtime app catalog discovery and fallback inventory helpers
// [TITLE] Functionality Index:
// [TITLE] - shape fallback output/app rows from saved config and shared telemetry
// [TITLE] - enumerate Windows process/app snapshots for audio isolation UI contracts
// [TITLE] - compose audio-hint companion maps and cache catalog payloads safely

const TITLE_HINT_RE = /(music|spotify|youtube|netflix|twitch|audio|video|player|stream)/i;

module.exports = function createAudioRuntimeCatalog(options = {}) {
  const normalizeString = typeof options.normalizeString === "function"
    ? options.normalizeString
    : (value => String(value || "").trim());
  const cloneJsonSafe = typeof options.cloneJsonSafe === "function"
    ? options.cloneJsonSafe
    : (value => JSON.parse(JSON.stringify(value)));
  const normalizeAppName = typeof options.normalizeAppName === "function"
    ? options.normalizeAppName
    : (value => String(value || "").trim());
  const normalizeAppToken = typeof options.normalizeAppToken === "function"
    ? options.normalizeAppToken
    : (value => String(value || "").trim().toLowerCase());
  const normalizeTokenList = typeof options.normalizeTokenList === "function"
    ? options.normalizeTokenList
    : (values => (Array.isArray(values) ? values : []).map(value => String(value || "").trim()).filter(Boolean));
  const tokenLooksBrowserLike = typeof options.tokenLooksBrowserLike === "function"
    ? options.tokenLooksBrowserLike
    : (() => false);
  const detectBrowserChannelHint = typeof options.detectBrowserChannelHint === "function"
    ? options.detectBrowserChannelHint
    : (() => "");
  const buildCompanionMapFromAudioTokens = typeof options.buildCompanionMapFromAudioTokens === "function"
    ? options.buildCompanionMapFromAudioTokens
    : (() => ({}));
  const runPowerShellJson = typeof options.runPowerShellJson === "function"
    ? options.runPowerShellJson
    : (() => []);
  const listProcTapAudioProcessesSync = typeof options.listProcTapAudioProcessesSync === "function"
    ? options.listProcTapAudioProcessesSync
    : (() => ({ ok: false, source: "window_activity", audioTokens: [] }));
  const now = typeof options.now === "function" ? options.now : Date.now;
  const getConfig = typeof options.getConfig === "function"
    ? options.getConfig
    : (() => ({}));
  const getCacheApps = typeof options.getCacheApps === "function"
    ? options.getCacheApps
    : (() => ({ at: 0, payload: { ok: true, apps: [], processMetadata: [], audioHints: { source: "proctap_audio_processes", audioOnly: false, audioTokens: [], companionMap: {} } } }));
  const setCacheApps = typeof options.setCacheApps === "function"
    ? options.setCacheApps
    : (() => {});
  const audioEngine = options.audioEngine || {};
  const platform = normalizeString(options.platform || process.platform, 32).toLowerCase() || process.platform;

  function resolveFallbackOutputDeviceName() {
    const config = getConfig();
    const telemetry = typeof audioEngine.getTelemetry === "function" ? (audioEngine.getTelemetry() || {}) : {};
    const candidates = [
      normalizeString(config.desktopOutputDeviceName || "", 256),
      normalizeString(config.ffmpegInputDevice || "", 256),
      normalizeString(telemetry?.device || "", 256),
      normalizeString(config.deviceMatch || "", 256)
    ].map(value => value.trim()).filter(Boolean);
    for (const value of candidates) {
      if (value === "-" || value.toLowerCase() === "none") continue;
      return value;
    }
    return "Default Audio Output";
  }

  function buildConfiguredAppFallbackRows() {
    const config = getConfig();
    const telemetry = typeof audioEngine.getTelemetry === "function" ? (audioEngine.getTelemetry() || {}) : {};
    const appIsolation = telemetry?.appIsolation && typeof telemetry.appIsolation === "object"
      ? telemetry.appIsolation
      : {};
    const candidates = [
      normalizeAppName(config.ffmpegAppIsolationPrimaryApp || ""),
      normalizeAppName(config.ffmpegAppIsolationFallbackApp || ""),
      normalizeAppName(appIsolation.selectedApp || ""),
      normalizeAppName(appIsolation.activeApp || ""),
      normalizeAppName(appIsolation.primaryApp || ""),
      normalizeAppName(appIsolation.fallbackApp || "")
    ].filter(Boolean);

    const rows = [];
    const seen = new Set();
    for (const name of candidates) {
      const token = normalizeAppToken(name);
      if (!token || seen.has(token)) continue;
      seen.add(token);
      rows.push({
        app: `${token}.exe`,
        displayName: `${token}.exe`,
        processName: token,
        instances: 1,
        pids: [],
        windowTitles: [],
        likelyAudio: true,
        likelyAudioConfidence: 0.82,
        audioCapable: true,
        configuredFallback: true
      });
    }
    return rows;
  }

  function getApps(options = {}) {
    const force = options.forceRefresh === true;
    const cacheApps = getCacheApps();
    const nowMs = Number(now() || Date.now());
    if (!force && (nowMs - Number(cacheApps.at || 0)) < 1500) {
      return cloneJsonSafe(cacheApps.payload, {});
    }
    const config = getConfig();
    let payload = {
      ok: true,
      apps: [],
      processMetadata: [],
      audioHints: {
        source: "proctap_audio_processes",
        audioOnly: false,
        audioTokens: [],
        companionMap: {}
      }
    };
    if (platform === "win32") {
      const rows = runPowerShellJson(
        "$procs = Get-Process -ErrorAction SilentlyContinue | Select-Object ProcessName,Id,MainWindowTitle,Path; " +
        "$parents = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Select-Object ProcessId,ParentProcessId; " +
        "$parentByPid = @{}; foreach ($item in $parents) { $parentByPid[[int]$item.ProcessId] = [int]$item.ParentProcessId }; " +
        "$out = foreach ($p in $procs) { " +
        "  $procId = [int]$p.Id; " +
        "  $parentId = if ($parentByPid.ContainsKey($procId)) { [int]$parentByPid[$procId] } else { 0 }; " +
        "  [pscustomobject]@{ ProcessName = $p.ProcessName; Id = $procId; ParentProcessId = $parentId; MainWindowTitle = $p.MainWindowTitle; Path = $p.Path } " +
        "}; " +
        "$out | ConvertTo-Json -Compress",
        7000
      );
      const list = Array.isArray(rows) ? rows : (rows && typeof rows === "object" ? [rows] : []);
      const grouped = new Map();
      const metadata = [];
      for (const row of list) {
        const processName = normalizeString(row?.ProcessName || "", 96);
        const pid = Math.max(0, Number(row?.Id || 0));
        const parentPid = Math.max(0, Number(row?.ParentProcessId || 0));
        const title = normalizeString(row?.MainWindowTitle || "", 256);
        const executablePath = normalizeString(row?.Path || "", 512);
        if (!processName || pid <= 0) continue;
        const token = normalizeAppToken(processName);
        metadata.push({
          token,
          processName,
          pid,
          parentPid,
          executablePath,
          hasWindow: Boolean(title),
          mainWindowTitle: title
        });
        if (!token) continue;
        if (!grouped.has(token)) {
          grouped.set(token, {
            app: `${token}.exe`,
            displayName: `${token}.exe`,
            processName: token,
            instances: 0,
            pids: [],
            windowTitles: [],
            executablePaths: []
          });
        }
        const ref = grouped.get(token);
        ref.instances += 1;
        if (!ref.pids.includes(pid)) ref.pids.push(pid);
        if (title && !ref.windowTitles.includes(title)) ref.windowTitles.push(title);
        if (executablePath && !ref.executablePaths.includes(executablePath)) ref.executablePaths.push(executablePath);
      }
      const probe = listProcTapAudioProcessesSync(config);
      const audioTokenSet = new Set(normalizeTokenList(probe.audioTokens, 256));
      let apps = [...grouped.values()].map(row => {
        const token = normalizeAppToken(row.processName || row.displayName || row.app || "");
        const titleHint = row.windowTitles.some(title => TITLE_HINT_RE.test(String(title || "")));
        const hasWindow = Array.isArray(row.windowTitles) && row.windowTitles.length > 0;
        const browserHint = tokenLooksBrowserLike(token) && hasWindow;
        const browserChannelHint = detectBrowserChannelHint(token, {
          windowTitles: row.windowTitles,
          executablePaths: row.executablePaths
        });
        const audioCapable = token ? audioTokenSet.has(token) : false;
        const likelyAudio = audioCapable || titleHint || browserHint;
        const likelyAudioConfidence = audioCapable
          ? 0.92
          : (titleHint || browserHint ? 0.58 : (hasWindow ? 0.28 : 0.16));
        return {
          ...row,
          likelyAudio,
          likelyAudioConfidence,
          audioCapable,
          browserChannelHint
        };
      }).sort((a, b) => Number(b.audioCapable) - Number(a.audioCapable) || b.instances - a.instances || String(a.displayName || "").localeCompare(String(b.displayName || "")));
      let hintSource = normalizeString(probe.source || (probe.ok ? "proctap_audio_processes" : "window_activity"), 64) || "window_activity";
      if (!apps.length) {
        apps = buildConfiguredAppFallbackRows();
        hintSource = apps.length ? "config_fallback" : hintSource;
      }
      const companionMap = buildCompanionMapFromAudioTokens(
        apps,
        [...audioTokenSet.values()],
        metadata
      );
      payload = {
        ok: true,
        apps,
        processMetadata: metadata.slice(0, 600),
        audioHints: {
          source: hintSource,
          audioOnly: false,
          audioTokens: probe.ok
            ? [...audioTokenSet.values()]
            : apps.filter(app => app.audioCapable || app.likelyAudio).map(app => normalizeAppToken(app.displayName || app.app || app.processName || "")).filter(Boolean),
          companionMap,
          probeError: normalizeString(probe.error || "", 256)
        }
      };
    }
    setCacheApps({
      at: nowMs,
      payload: cloneJsonSafe(payload, {})
    });
    return cloneJsonSafe(payload, {});
  }

  return {
    resolveFallbackOutputDeviceName,
    buildConfiguredAppFallbackRows,
    getApps
  };
};
