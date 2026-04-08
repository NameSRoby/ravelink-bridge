// [TITLE] Module: domains/audio/audio-runtime.device-discovery.js
// [TITLE] Purpose: device discovery and desktop-output hint helpers for audio runtime
// [TITLE] Functionality Index:
// [TITLE] - enumerate FFmpeg DShow and Windows audio endpoint candidates
// [TITLE] - resolve preferred desktop output hints from rust resolver or Windows fallback
// [TITLE] - rank capture/output candidates for compatibility backend selection

const { spawnSync } = require("node:child_process");

module.exports = function createAudioRuntimeDeviceDiscovery(options = {}) {
  const normalizeString = typeof options.normalizeString === "function"
    ? options.normalizeString
    : (value => String(value || "").trim());
  const dedupeStringList = typeof options.dedupeStringList === "function"
    ? options.dedupeStringList
    : (values => [...new Set((Array.isArray(values) ? values : []).map(value => String(value || "").trim()).filter(Boolean))]);
  const runPowerShellJson = typeof options.runPowerShellJson === "function"
    ? options.runPowerShellJson
    : (() => []);
  const runPowerShellText = typeof options.runPowerShellText === "function"
    ? options.runPowerShellText
    : (() => "");
  const parseFirstJsonLine = typeof options.parseFirstJsonLine === "function"
    ? options.parseFirstJsonLine
    : (() => null);
  const detectRustCaptureRuntimeAvailability = typeof options.detectRustCaptureRuntimeAvailability === "function"
    ? options.detectRustCaptureRuntimeAvailability
    : (() => ({ resolver: false, resolverPath: "" }));
  const rootDir = String(options.rootDir || "");

  function listFfmpegDshowAudioDevices(ffmpegPath = "ffmpeg") {
    const binary = normalizeString(ffmpegPath || "ffmpeg", 260) || "ffmpeg";
    const result = spawnSync(
      binary,
      ["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"],
      { encoding: "utf8", windowsHide: true, timeout: 4500 }
    );
    const text = String(result?.stderr || result?.stdout || "").trim();
    if (!text) return [];
    const lines = text.split(/\r?\n/);
    const out = [];
    for (const rawLine of lines) {
      const line = String(rawLine || "").trim();
      if (!line) continue;
      const match = line.match(/"([^"]+)"\s+\((audio)\)\s*$/i);
      if (!match || !match[1]) continue;
      const name = normalizeString(match[1], 256);
      if (!name) continue;
      out.push(name);
    }
    return [...new Set(out.map(name => name.trim()).filter(Boolean))];
  }

  function normalizeAudioEndpointName(name = "") {
    return normalizeString(name, 256);
  }

  function isRenderEndpointName(name = "") {
    const token = normalizeAudioEndpointName(name).toLowerCase();
    if (!token) return false;
    return /^(headphones|speakers|line out|digital output|output|monitor)/i.test(token)
      || /\b(headphones|speakers|line out|digital output|render)\b/i.test(token);
  }

  function isGenericDriverAudioName(name = "") {
    const token = normalizeAudioEndpointName(name).toLowerCase();
    if (!token) return true;
    return token === "usb audio device"
      || token === "audio device"
      || token === "speakers"
      || token === "headphones";
  }

  function listWindowsAudioEndpoints() {
    const rows = runPowerShellJson("$r=Get-PnpDevice -Class AudioEndpoint -Status OK -ErrorAction SilentlyContinue | Select-Object FriendlyName,InstanceId,Class; $r | ConvertTo-Json -Compress", 5000);
    const list = Array.isArray(rows) ? rows : (rows && typeof rows === "object" ? [rows] : []);
    const out = [];
    for (const row of list) {
      const name = normalizeAudioEndpointName(row?.FriendlyName || "");
      const instanceId = normalizeString(row?.InstanceId || "", 256);
      if (!name) continue;
      out.push({
        name,
        instanceId,
        role: isRenderEndpointName(name) ? "render" : "capture"
      });
    }
    return out;
  }

  function dedupeAudioEndpointNames(values = []) {
    return dedupeStringList(
      (Array.isArray(values) ? values : [])
        .map(value => normalizeAudioEndpointName(value))
        .filter(Boolean)
    );
  }

  function deriveRenderEndpointNames(endpointRows = [], defaultName = "") {
    const rows = Array.isArray(endpointRows) ? endpointRows : [];
    const renderNames = rows
      .filter(row => String(row?.role || "").trim().toLowerCase() === "render")
      .map(row => normalizeAudioEndpointName(row?.name || ""))
      .filter(Boolean);
    const defaultToken = normalizeAudioEndpointName(defaultName || "");
    const merged = [];
    if (defaultToken) merged.push(defaultToken);
    for (const name of renderNames) merged.push(name);
    return dedupeAudioEndpointNames(merged);
  }

  function resolveDefaultOutputViaRustResolver(config = {}, extraOptions = {}) {
    const rust = detectRustCaptureRuntimeAvailability(config, {
      rootDir: String(extraOptions.rootDir || rootDir || "")
    });
    if (!rust.resolver || !rust.resolverPath) {
      return {
        name: "",
        endpoints: [],
        source: "",
        error: "resolver_unavailable"
      };
    }
    try {
      const listResult = spawnSync(
        rust.resolverPath,
        ["--list-output-endpoints", "--json"],
        {
          windowsHide: true,
          encoding: "utf8",
          timeout: 2600,
          stdio: "pipe"
        }
      );
      const stdoutRaw = String(listResult?.stdout || "").trim();
      const listParsed = parseFirstJsonLine(stdoutRaw);
      const listEndpointsRaw = Array.isArray(listParsed?.endpoints) ? listParsed.endpoints : [];
      const endpoints = dedupeStringList(
        listEndpointsRaw
          .map(value => normalizeAudioEndpointName(value))
          .filter(Boolean)
      );
      let defaultOutputName = normalizeAudioEndpointName(
        listParsed?.defaultOutputName || listParsed?.name || ""
      );

      if (!defaultOutputName) {
        const singleResult = spawnSync(
          rust.resolverPath,
          ["--default-output-endpoint", "--json"],
          {
            windowsHide: true,
            encoding: "utf8",
            timeout: 2400,
            stdio: "pipe"
          }
        );
        const singleParsed = parseFirstJsonLine(String(singleResult?.stdout || "").trim());
        defaultOutputName = normalizeAudioEndpointName(
          singleParsed?.defaultOutputName || singleParsed?.name || ""
        );
      }

      if (!defaultOutputName && endpoints.length > 0) {
        defaultOutputName = endpoints[0];
      }
      if (defaultOutputName && !endpoints.includes(defaultOutputName)) {
        endpoints.unshift(defaultOutputName);
      }
      if (!defaultOutputName) {
        return {
          name: "",
          endpoints,
          source: "rust_source_resolver",
          error: "resolver_empty_hint"
        };
      }
      return {
        name: defaultOutputName,
        endpoints,
        source: "rust_source_resolver",
        error: ""
      };
    } catch (error) {
      return {
        name: "",
        endpoints: [],
        source: "rust_source_resolver",
        error: normalizeString(error?.message || error || "resolver_probe_failed", 320)
      };
    }
  }

  function resolvePreferredOutputHintName(config = {}, extraOptions = {}) {
    const source = config && typeof config === "object" ? config : {};
    const rustDefault = resolveDefaultOutputViaRustResolver(source, extraOptions);
    const endpointRows = listWindowsAudioEndpoints();
    const rustOutputEndpoints = dedupeAudioEndpointNames(rustDefault.endpoints || []);
    if (rustDefault.name) {
      return {
        name: rustDefault.name,
        endpointRows,
        outputEndpoints: rustOutputEndpoints.length
          ? rustOutputEndpoints
          : deriveRenderEndpointNames(endpointRows, rustDefault.name),
        source: rustDefault.source || "rust_source_resolver",
        resolverError: ""
      };
    }
    let defaultPlaybackName = normalizeString(
      runPowerShellText("(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Multimedia\\Sound Mapper' -ErrorAction SilentlyContinue).Playback"),
      256
    );
    const preferredRender = endpointRows.find(row => row.role === "render");
    const preferredRenderName = normalizeAudioEndpointName(preferredRender?.name || "");
    if (!defaultPlaybackName || isGenericDriverAudioName(defaultPlaybackName)) {
      if (preferredRenderName) {
        defaultPlaybackName = preferredRenderName;
      }
    }
    return {
      name: defaultPlaybackName,
      endpointRows,
      outputEndpoints: deriveRenderEndpointNames(endpointRows, defaultPlaybackName),
      source: defaultPlaybackName ? "windows_sound_mapper" : "",
      resolverError: rustDefault.error || ""
    };
  }

  function normalizeAudioDeviceMatchTokens(value = "") {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return [];
    return raw
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/g)
      .map(token => token.trim())
      .filter(token => token.length >= 3 && !["the", "and", "device", "audio", "default", "output"].includes(token));
  }

  function scoreAudioDefaultOutputMatch(deviceName = "", defaultOutputName = "") {
    const deviceRaw = String(deviceName || "").trim().toLowerCase();
    const outputRaw = String(defaultOutputName || "").trim().toLowerCase();
    if (!deviceRaw || !outputRaw) return 0;
    const outputTokens = normalizeAudioDeviceMatchTokens(outputRaw);
    if (!outputTokens.length) return 0;
    let matched = 0;
    let score = 0;
    for (const token of outputTokens) {
      if (!token) continue;
      if (deviceRaw.includes(token)) {
        matched += 1;
        score += token.length >= 6 ? 58 : 42;
      }
    }
    if (matched >= 2) score += 190;
    if (matched >= 3) score += 120;
    if (matched > 0 && (deviceRaw.includes("loopback") || deviceRaw.includes("stereo mix") || deviceRaw.includes("monitor of"))) {
      score += 80;
    }
    return score;
  }

  function scoreDshowCaptureCandidate(name = "", preferredOutputName = "", matchHint = "") {
    const token = normalizeString(name, 256).toLowerCase();
    if (!token) return -9999;
    const preferred = normalizeString(preferredOutputName, 256).toLowerCase();
    const matchToken = normalizeString(matchHint, 256).toLowerCase();
    let score = 0;
    if (preferred && token === preferred) score += 180;
    if (preferred && token.includes(preferred)) score += 95;
    score += scoreAudioDefaultOutputMatch(token, preferred);
    if (matchToken && token.includes(matchToken)) score += 75;
    if (/(stereo mix|what u hear|loopback|wave out|monitor|cable output|line out)/i.test(token)) score += 120;
    if (/(speaker|speakers|headphone|headphones|output|render)/i.test(token)) score += 55;
    return score;
  }

  function buildPreferredDshowCaptureCandidates(config = {}) {
    const source = config && typeof config === "object" ? config : {};
    const dshowDevices = listFfmpegDshowAudioDevices(source.ffmpegPath || "ffmpeg");
    if (!dshowDevices.length) return [];
    const preferredOutputName = normalizeString(source.desktopOutputDeviceName || "", 256);
    const matchHint = normalizeString(source.deviceMatch || "", 256);
    const ranked = dshowDevices
      .map(name => ({
        name,
        score: scoreDshowCaptureCandidate(name, preferredOutputName, matchHint)
      }))
      .sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)));
    const positive = ranked.filter(row => row.score > 0).map(row => row.name);
    if (positive.length) return positive.slice(0, 6);
    const nonMic = ranked
      .filter(row => !/(microphone|mic\b|digital input|line in|input\b)/i.test(String(row.name || "")))
      .map(row => row.name);
    if (nonMic.length) return nonMic.slice(0, 6);
    return ranked.map(row => row.name).slice(0, 3);
  }

  return {
    listFfmpegDshowAudioDevices,
    normalizeAudioEndpointName,
    isRenderEndpointName,
    listWindowsAudioEndpoints,
    dedupeAudioEndpointNames,
    deriveRenderEndpointNames,
    resolveDefaultOutputViaRustResolver,
    resolvePreferredOutputHintName,
    scoreAudioDefaultOutputMatch,
    scoreDshowCaptureCandidate,
    buildPreferredDshowCaptureCandidates
  };
};
