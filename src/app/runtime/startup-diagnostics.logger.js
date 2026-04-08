// [TITLE] Module: app/runtime/startup-diagnostics.logger.js
// [TITLE] Purpose: deterministic startup diagnostics for local bridge bring-up
// [TITLE] Functionality Index:
// [TITLE] - print domain load summaries for colors/fixtures/twitch/system/live
// [TITLE] - print MIDI/mods readiness snapshots using current runtime contracts
// [TITLE] - emit engine-v2 and audio status lines for fast startup triage
// [DEV] Complex Flow:
// [DEV] Diagnostics intentionally read through domain ports only so logs stay in
// [DEV] sync with route-visible contract state and avoid hidden internal coupling.

const { createStartupConsoleTheme } = require("./startup-console.theme");

function safeRead(fn, fallback) {
  try {
    const value = fn();
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

function asObjectMap(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asYesNo(value) {
  return value === true ? "yes" : "no";
}

function formatPrefixMap(prefixes = {}) {
  const map = asObjectMap(prefixes, {});
  const hue = String(map.hue || "").trim() || "(none)";
  const wiz = String(map.wiz || "").trim() || "(none)";
  const other = String(map.other || "").trim() || "(none)";
  return { hue, wiz, other };
}

function logStartupDiagnostics(input = {}) {
  const services = asObjectMap(input.services, {});
  const log = input.log && typeof input.log === "object" ? input.log : console;
  const formatter = input.formatter && typeof input.formatter === "object"
    ? input.formatter
    : createStartupConsoleTheme({ stream: process.stdout });
  const runtimeVersion = String(input.runtimeVersion || "").trim();
  const bridgeUrl = String(input.bridgeUrl || "").trim();

  log.log?.("");
  log.log?.(formatter.divider("="));
  log.log?.(formatter.banner("RAVELINK BRIDGE", "STARTUP SNAPSHOT"));
  log.log?.(
    formatter.line("bridge", [
      formatter.field("Version", runtimeVersion || "Dev build", "accent"),
      formatter.field("Endpoint", bridgeUrl || "Preparing...", bridgeUrl ? "info" : "muted")
    ], { tone: "bridge" })
  );
  log.log?.(formatter.divider("-"));

  const colorSummary = asObjectMap(safeRead(() => services.colorLibrary.getSummary(), {}), {});
  const customColorCount = Number(colorSummary.customCount || 0);

  const fixtureList = safeRead(() => services.fixtureRegistry.getFixtures(), []);
  const fixtureTotal = Array.isArray(fixtureList) ? fixtureList.length : 0;
  const fixtureEngine = safeRead(() => services.fixtureRegistry.listEngineBy("", "", { requireConfigured: false }), []);
  const fixtureTwitch = safeRead(() => services.fixtureRegistry.listTwitchBy("", "", { requireConfigured: false }), []);
  const fixtureCustom = safeRead(() => services.fixtureRegistry.listCustomBy("", "", { requireConfigured: false }), []);
  log.log?.(
    formatter.line("lighting", [
      formatter.field("Custom Colors", String(customColorCount), customColorCount > 0 ? "accent" : "muted"),
      formatter.field("Fixtures", String(fixtureTotal), fixtureTotal > 0 ? "info" : "muted"),
      formatter.field("Engine", String(Array.isArray(fixtureEngine) ? fixtureEngine.length : 0), "text"),
      formatter.field("Twitch", String(Array.isArray(fixtureTwitch) ? fixtureTwitch.length : 0), "text"),
      formatter.field("Custom", String(Array.isArray(fixtureCustom) ? fixtureCustom.length : 0), "text")
    ], { tone: "lighting" })
  );

  const systemConfig = asObjectMap(safeRead(() => services.systemConfigService.getConfig(), {}), {});
  const sys = asObjectMap(systemConfig.config, {});
  log.log?.(
    formatter.line("system", [
      formatter.field("Browser Launch", formatter.yesNo(sys.autoLaunchBrowser !== false)),
      formatter.field("Delay", `${Number(sys.autoLaunchDelayMs || 0)}ms`, "text"),
      formatter.field("Hue Transport", formatter.humanizeHueTransport(sys.hueTransportPreference || "auto"), "accent")
    ], { tone: "system" })
  );
  log.log?.(
    formatter.line("system", [
      formatter.field("Update Checks", formatter.yesNo(sys.updateChecksEnabled !== false)),
      formatter.field("Startup Prompt", formatter.yesNo(sys.updateStartupPromptEnabled !== false)),
      formatter.field("Sensitive Logs", formatter.yesNo(sys.unsafeExposeSensitiveLogs === true)),
      formatter.field("Capture Backend", formatter.humanizeAudioBackendStrategy(sys.audioCaptureBackendStrategy || "auto_rust_first"), "accent")
    ], { tone: "system" })
  );

  const twitchLoad = asObjectMap(safeRead(() => services.twitchColorConfig.getLoadSummary(), {}), {});
  const twitchPrefixes = formatPrefixMap(twitchLoad.prefixes);
  log.log?.(
    formatter.line("twitch", [
      formatter.field("Default Target", formatter.humanizeToken(twitchLoad.defaultTarget || "hue"), "accent"),
      formatter.field("Auto Route", formatter.yesNo(twitchLoad.autoDefaultTarget !== false)),
      formatter.field("Rave-Off Cmds", formatter.yesNo(twitchLoad.raveOffEnabled === true))
    ], { tone: "twitch" })
  );
  log.log?.(
    formatter.line("twitch", [
      formatter.field("Hue Prefix", twitchPrefixes.hue, "text"),
      formatter.field("WiZ Prefix", twitchPrefixes.wiz, "text"),
      formatter.field("Other Prefix", twitchPrefixes.other, twitchPrefixes.other === "(none)" ? "muted" : "text"),
      formatter.field("Fixture Prefixes", String(Number(twitchLoad.fixturePrefixCount || 0)), "text")
    ], { tone: "twitch" })
  );

  const liveProfiles = safeRead(() => services.liveProfileService.listProfiles(), []);
  const liveProfileCount = Array.isArray(liveProfiles) ? liveProfiles.length : 0;

  const audioStatus = asObjectMap(safeRead(() => services.audioEngine.getStatus(), {}), {});
  const audioBackend = String(audioStatus.backend || "unwired");
  const audioState = String(audioStatus.status || "idle");

  const midiStatus = asObjectMap(safeRead(() => services.midiManager.getStatus(), {}), {});
  log.log?.(
    formatter.line("audio", [
      formatter.field("Backend", formatter.humanizeToken(audioBackend, "Unwired"), audioBackend === "unwired" ? "warn" : "accent"),
      formatter.field("Engine State", formatter.humanizeToken(audioState, "Idle"), audioState === "idle" ? "info" : "accent"),
      formatter.field("MIDI Module", midiStatus.moduleAvailable === true ? "Available" : "Unavailable", midiStatus.moduleAvailable === true ? "good" : "warn"),
      formatter.field("Ports", String(Number(midiStatus.portCount || 0)), "text"),
      formatter.field("Reason", formatter.humanizeMidiReason(midiStatus.reason || "none"), midiStatus.moduleAvailable === true ? "muted" : "warn")
    ], { tone: "audio" })
  );

  const modsSnapshot = asObjectMap(safeRead(() => services.modRuntime.list(), {}), {});
  log.log?.(
    formatter.line("live", [
      formatter.field("Live Profiles", String(liveProfileCount), liveProfileCount > 0 ? "accent" : "muted"),
      formatter.field("Mods", formatter.formatLoadedCount(modsSnapshot.loaded, modsSnapshot.total), Number(modsSnapshot.loaded || 0) > 0 ? "good" : "muted")
    ], { tone: "live" })
  );

  const engineStatus = asObjectMap(safeRead(() => services.engineV2.getStatus(), {}), {});
  const limits = asObjectMap(engineStatus.hardwareLimits, {});
  log.log?.(
    formatter.line("engine", [
      formatter.field("Tick", `${Number(engineStatus.tickMs || 0)}ms`, "accent"),
      formatter.field("Hue Max", `${Number(limits.hueMaxHz || 0)}Hz`, "text"),
      formatter.field("WiZ Max", `${Number(limits.wizMaxHz || 0)}Hz`, "text"),
      formatter.field("Palette Mapper", formatter.humanizeToken(engineStatus.paletteMapperMode || "strict"), "info")
    ], { tone: "engine" })
  );
  log.log?.(formatter.divider("="));
};

logStartupDiagnostics.createFormatter = createStartupConsoleTheme;

module.exports = logStartupDiagnostics;
