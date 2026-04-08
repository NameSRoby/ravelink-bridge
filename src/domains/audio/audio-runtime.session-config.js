// [TITLE] Module: domains/audio/audio-runtime.session-config.js
// [TITLE] Purpose: start-session effective capture config composition for audio runtime
// [TITLE] Functionality Index:
// [TITLE] - resolve backend-specific desktop/device fallback candidates before capture starts
// [TITLE] - apply app-isolation process-loopback selection to the effective runtime config
// [TITLE] - shape rust desktop-loopback activation without mutating top-level orchestration

module.exports = function createAudioRuntimeSessionConfig(options = {}) {
  const normalizeString = typeof options.normalizeString === "function"
    ? options.normalizeString
    : (value => String(value || "").trim());
  const normalizeAppToken = typeof options.normalizeAppToken === "function"
    ? options.normalizeAppToken
    : (value => String(value || "").trim().toLowerCase());
  const detectRustCaptureRuntimeAvailability = typeof options.detectRustCaptureRuntimeAvailability === "function"
    ? options.detectRustCaptureRuntimeAvailability
    : (() => ({ loopback: false, kernel: false, resolver: false }));
  const resolveAppIsolationTargetToken = typeof options.resolveAppIsolationTargetToken === "function"
    ? options.resolveAppIsolationTargetToken
    : (() => ({ resolvedDevices: [] }));
  const resolveRepresentativePidForToken = typeof options.resolveRepresentativePidForToken === "function"
    ? options.resolveRepresentativePidForToken
    : (() => 0);
  const deviceDiscovery = options.deviceDiscovery || {};
  const rootDir = String(options.rootDir || "");

  function buildEffectiveStartSessionConfig(input = {}) {
    const source = input && typeof input === "object" ? input : {};
    const currentConfig = source.config && typeof source.config === "object" ? source.config : {};
    const backendSelection = source.backendSelection && typeof source.backendSelection === "object"
      ? source.backendSelection
      : { selectedBackend: "auto" };
    const forcedDevicesSnapshot = source.forcedDevicesSnapshot && typeof source.forcedDevicesSnapshot === "object"
      ? source.forcedDevicesSnapshot
      : { devices: [], defaultOutputEndpointHint: { name: "" } };
    const getForcedAppsSnapshot = typeof source.getForcedAppsSnapshot === "function"
      ? source.getForcedAppsSnapshot
      : (() => ({ apps: [], processMetadata: [], audioHints: { companionMap: {} } }));
    const locks = source.locks && typeof source.locks === "object" ? source.locks : {};

    const next = { ...currentConfig };
    let startupIsolation = null;
    const rustRuntime = detectRustCaptureRuntimeAvailability(next, { rootDir });
    if (rustRuntime.loopback === true && rustRuntime.loopbackPath) {
      next.rustLoopbackPath = rustRuntime.loopbackPath;
    }
    if (rustRuntime.kernel === true && rustRuntime.kernelPath) {
      next.rustKernelPath = rustRuntime.kernelPath;
    }
    if (rustRuntime.resolver === true && rustRuntime.resolverPath) {
      next.rustSourceResolverPath = rustRuntime.resolverPath;
    }

    const resolvedDefaultOutput = normalizeString(
      next.desktopOutputDeviceName
      || forcedDevicesSnapshot?.defaultOutputEndpointHint?.name
      || "",
      320
    );
    if (resolvedDefaultOutput) {
      next.desktopOutputDeviceName = resolvedDefaultOutput;
    }
    next.processLoopbackEnabled = false;
    next.processLoopbackTargetToken = "";
    next.processLoopbackTargetPid = 0;
    next.processLoopbackSourceToken = "";
    next.processLoopbackPreferredBackend = "";
    next.processLoopbackRequireStartupData = true;
    next.appIsolationEnforceProcessLoopback = false;
    next.desktopLoopbackEnabled = false;
    next.desktopLoopbackPath = normalizeString(next.rustKernelPath || "", 512);
    next.desktopLoopbackDeviceName = normalizeString(next.desktopOutputDeviceName || "", 320);

    if (backendSelection.selectedBackend === "rustloop") {
      const seededSources = Array.isArray(next.ffmpegInputDevices) ? next.ffmpegInputDevices : [];
      let hintName = normalizeString(next.desktopOutputDeviceName || "", 320);
      if (!hintName) {
        hintName = normalizeString(forcedDevicesSnapshot?.defaultOutputEndpointHint?.name || "", 320);
      }
      if (hintName) {
        next.desktopOutputDeviceName = hintName;
      }
      const preferredDshow = typeof deviceDiscovery.buildPreferredDshowCaptureCandidates === "function"
        ? deviceDiscovery.buildPreferredDshowCaptureCandidates({
          ffmpegPath: next.ffmpegPath || "ffmpeg",
          desktopOutputDeviceName: hintName,
          deviceMatch: next.deviceMatch || ""
        })
        : [];
      const mergedSources = [...seededSources, ...preferredDshow]
        .map(value => normalizeString(value, 320))
        .filter(Boolean);
      const orderedSources = [];
      const pushUniqueSource = rawValue => {
        const token = normalizeString(rawValue, 320);
        if (!token) return;
        const key = token.toLowerCase();
        if (orderedSources.some(row => String(row || "").trim().toLowerCase() === key)) return;
        orderedSources.push(token);
      };
      if (hintName) pushUniqueSource(hintName);
      for (const sourceName of mergedSources) {
        if (String(sourceName || "").trim().toLowerCase() === "default") continue;
        pushUniqueSource(sourceName);
      }
      const seededHasDefault = seededSources.some(value => String(value || "").trim().toLowerCase() === "default");
      if (seededHasDefault || orderedSources.length === 0) {
        pushUniqueSource("default");
      }
      next.ffmpegInputDevices = orderedSources;
      if (!normalizeString(next.ffmpegInputDevice || "", 320)) {
        next.ffmpegInputDevice = orderedSources[0] || "default";
      } else {
        const configured = normalizeString(next.ffmpegInputDevice || "", 320);
        if (configured.toLowerCase() === "default") {
          next.ffmpegInputDevice = orderedSources[0] || configured;
        }
      }
    }

    const configuredDevice = normalizeString(next.ffmpegInputDevice || "", 320);
    const configuredDeviceLooksInputOnly = /(microphone|mic\b|digital input|line in|input\b)/i.test(configuredDevice);
    if (configuredDevice && configuredDeviceLooksInputOnly && next.ffmpegAppIsolationEnabled !== true) {
      const outputHintName = normalizeString(next.desktopOutputDeviceName || "", 320);
      const preferredDshow = typeof deviceDiscovery.buildPreferredDshowCaptureCandidates === "function"
        ? deviceDiscovery.buildPreferredDshowCaptureCandidates({
          ffmpegPath: next.ffmpegPath || "ffmpeg",
          desktopOutputDeviceName: next.desktopOutputDeviceName || "",
          deviceMatch: next.deviceMatch || ""
        })
        : [];
      const fallbackCandidate = (() => {
        if (
          backendSelection.selectedBackend === "rustloop" &&
          outputHintName &&
          outputHintName.toLowerCase() !== configuredDevice.toLowerCase()
        ) {
          return outputHintName;
        }
        if (preferredDshow.length && preferredDshow[0] !== configuredDevice) {
          return preferredDshow[0];
        }
        return "";
      })();
      if (fallbackCandidate) {
        next.ffmpegInputDevice = fallbackCandidate;
        const ordered = [];
        const pushUnique = value => {
          const token = normalizeString(value, 320);
          if (!token) return;
          const key = token.toLowerCase();
          if (ordered.some(row => String(row || "").trim().toLowerCase() === key)) return;
          ordered.push(token);
        };
        pushUnique(fallbackCandidate);
        for (const value of preferredDshow) pushUnique(value);
        pushUnique(configuredDevice);
        if (backendSelection.selectedBackend === "rustloop") {
          pushUnique("default");
        }
        next.ffmpegInputDevices = ordered;
      }
    }

    const hasConfiguredSource = Boolean(
      normalizeString(next.ffmpegInputDevice || "", 320)
      || (Array.isArray(next.ffmpegInputDevices) && next.ffmpegInputDevices.length > 0)
      || normalizeString(next.deviceMatch || "", 320)
    );
    if (!hasConfiguredSource) {
      const rows = Array.isArray(forcedDevicesSnapshot?.devices) ? forcedDevicesSnapshot.devices : [];
      const desktopDefault = rows.find(row => String(row?.backend || "").trim().toLowerCase() === "desktop_output" && row?.isDefaultOutput === true);
      const desktopAny = rows.find(row => String(row?.backend || "").trim().toLowerCase() === "desktop_output");
      const hintName = normalizeString(forcedDevicesSnapshot?.defaultOutputEndpointHint?.name || "", 320);
      const picked = normalizeString(hintName || desktopDefault?.name || desktopAny?.name || "", 320);
      if (picked) {
        next.desktopOutputDeviceName = picked;
      }
      if (!Array.isArray(next.ffmpegInputDevices) || next.ffmpegInputDevices.length === 0) {
        const preferredDshow = typeof deviceDiscovery.buildPreferredDshowCaptureCandidates === "function"
          ? deviceDiscovery.buildPreferredDshowCaptureCandidates({
            ffmpegPath: next.ffmpegPath || "ffmpeg",
            desktopOutputDeviceName: next.desktopOutputDeviceName || "",
            deviceMatch: next.deviceMatch || ""
          })
          : [];
        if (preferredDshow.length) {
          next.ffmpegInputDevices = preferredDshow;
          next.ffmpegInputDevice = preferredDshow[0];
        }
      }
    }

    if (next.ffmpegAppIsolationEnabled === true) {
      const appsSnapshot = getForcedAppsSnapshot();
      const isolation = resolveAppIsolationTargetToken(next, appsSnapshot, locks);
      startupIsolation = isolation;
      next.appIsolationEnforceProcessLoopback = true;
      next.processLoopbackRequireStartupData = false;
      next.processLoopbackEnabled = false;
      next.processLoopbackTargetToken = "";
      next.processLoopbackTargetPid = 0;
      next.processLoopbackSourceToken = normalizeAppToken(isolation.selectedSourceToken || "");
      next.processLoopbackPreferredBackend = "";
      if (Array.isArray(isolation.resolvedDevices) && isolation.resolvedDevices.length > 0) {
        next.ffmpegAppIsolationPrimaryDevices = isolation.resolvedDevices.slice(0, 12);
      }
      if (isolation.captureToken) {
        next.processLoopbackEnabled = true;
        next.processLoopbackTargetToken = isolation.captureToken;
        next.processLoopbackTargetPid = resolveRepresentativePidForToken(appsSnapshot, isolation.captureToken, {
          preferredChannel: isolation.captureChannelHint || isolation.selectedSourceChannelHint || ""
        });
        next.processLoopbackSourceToken = normalizeAppToken(isolation.selectedSourceToken || "");
        next.processLoopbackPreferredBackend = backendSelection.selectedBackend === "rustloop"
          ? "rustloop"
          : "proctap";
      }
      const primaryHint = normalizeString(next.desktopOutputDeviceName || next.ffmpegInputDevice || "", 320);
      if ((!Array.isArray(next.ffmpegAppIsolationPrimaryDevices) || next.ffmpegAppIsolationPrimaryDevices.length === 0) && primaryHint) {
        next.ffmpegAppIsolationPrimaryDevices = [primaryHint];
      }
      if (next.ffmpegAppIsolationStrict === true && next.processLoopbackEnabled !== true) {
        next.ffmpegInputDevices = [];
        next.ffmpegInputDevice = "";
        next.ffmpegAppIsolationPrimaryDevices = [];
      }
    }

    if (backendSelection.selectedBackend === "rustloop") {
      const strictIsolationAwaiting = next.ffmpegAppIsolationEnabled === true
        && next.ffmpegAppIsolationStrict === true
        && next.processLoopbackEnabled !== true;
      const canUseDesktopRustLoopback = strictIsolationAwaiting !== true
        && next.appIsolationEnforceProcessLoopback !== true
        && rustRuntime.kernel === true
        && Boolean(rustRuntime.kernelPath);
      if (canUseDesktopRustLoopback) {
        next.desktopLoopbackEnabled = true;
        next.desktopLoopbackPath = normalizeString(rustRuntime.kernelPath || next.desktopLoopbackPath || "", 512);
        next.desktopLoopbackDeviceName = normalizeString(next.desktopOutputDeviceName || "", 320);
      }
    }

    return {
      effectiveConfig: next,
      startupIsolation,
      rustRuntime
    };
  }

  return {
    buildEffectiveStartSessionConfig
  };
};
