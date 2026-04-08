// [TITLE] Module: domains/system/system-config.service.js
// [TITLE] Purpose: system config persistence + widget-template compatibility service
// [TITLE] Functionality Index:
// [TITLE] - persist system settings consumed by UI system tab
// [TITLE] - provide deterministic audio-backend selection projection
// [TITLE] - generate Twitch widget template script from structured payload

const fs = require("node:fs");
const { readJsonFile, writeJsonFile, cloneJsonSafe } = require("../../shared/fs/json-file-store");
const { generateWidgetTemplate } = require("./widget-template.builder");

const UNSAFE_LOG_ACK_PHRASE = "I_UNDERSTAND_SENSITIVE_LOG_RISK";
const ALLOWED_HUE_TRANSPORT = new Set(["auto", "rest", "entertainment"]);
const ALLOWED_AUDIO_CAPTURE_STRATEGY = new Set(["auto_rust_first", "force_rust"]);
const AUTO_LAUNCH_DELAY_DEFAULT_MS = 1200;
const AUTO_LAUNCH_DELAY_MIN_MS = 0;
const AUTO_LAUNCH_DELAY_MAX_MS = 30000;

function normalizeHueTransportPreference(value) {
  const token = String(value || "").trim().toLowerCase();
  return ALLOWED_HUE_TRANSPORT.has(token) ? token : "auto";
}

function normalizeAudioCaptureBackendStrategy(value) {
  const token = String(value || "").trim().toLowerCase();
  return ALLOWED_AUDIO_CAPTURE_STRATEGY.has(token) ? token : "auto_rust_first";
}

function normalizeAutoLaunchDelayMs(value, fallback = AUTO_LAUNCH_DELAY_DEFAULT_MS) {
  const parsed = Math.round(Number(value));
  const base = Number.isFinite(parsed) ? parsed : Math.round(Number(fallback));
  if (!Number.isFinite(base)) return AUTO_LAUNCH_DELAY_DEFAULT_MS;
  return Math.min(AUTO_LAUNCH_DELAY_MAX_MS, Math.max(AUTO_LAUNCH_DELAY_MIN_MS, base));
}

function normalizeBooleanSetting(value, fallback = false) {
  if (value === undefined) return fallback === true;
  if (typeof value === "string") {
    const token = String(value || "").trim().toLowerCase();
    if (token === "true" || token === "1" || token === "yes" || token === "on") return true;
    if (token === "false" || token === "0" || token === "no" || token === "off") return false;
  }
  return value === true;
}

module.exports = function createSystemConfigService(options = {}) {
  const storePath = String(options.storePath || "").trim();
  if (!storePath) {
    throw new Error("createSystemConfigService requires storePath");
  }
  const resolveAudioBackend = typeof options.resolveAudioBackend === "function"
    ? options.resolveAudioBackend
    : (() => "unwired");
  const now = typeof options.now === "function" ? options.now : Date.now;

  const defaults = {
    autoLaunchBrowser: true,
    autoLaunchDelayMs: AUTO_LAUNCH_DELAY_DEFAULT_MS,
    hueTransportPreference: "auto",
    audioCaptureBackendStrategy: "auto_rust_first",
    updateChecksEnabled: true,
    updateStartupPromptEnabled: true,
    unsafeExposeSensitiveLogs: false,
    updatedAt: 0
  };

  let config = cloneJsonSafe(defaults, defaults);

  function load() {
    if (fs.existsSync(storePath)) {
      const parsed = readJsonFile(storePath, cloneJsonSafe(defaults, defaults));
      config = {
        autoLaunchBrowser: parsed.autoLaunchBrowser !== false,
        autoLaunchDelayMs: normalizeAutoLaunchDelayMs(
          parsed.autoLaunchDelayMs ?? parsed.delayMs,
          AUTO_LAUNCH_DELAY_DEFAULT_MS
        ),
        hueTransportPreference: normalizeHueTransportPreference(parsed.hueTransportPreference),
        audioCaptureBackendStrategy: normalizeAudioCaptureBackendStrategy(parsed.audioCaptureBackendStrategy),
        updateChecksEnabled: normalizeBooleanSetting(parsed.updateChecksEnabled, true),
        updateStartupPromptEnabled: normalizeBooleanSetting(parsed.updateStartupPromptEnabled, true),
        unsafeExposeSensitiveLogs: parsed.unsafeExposeSensitiveLogs === true,
        updatedAt: Number(parsed.updatedAt || 0)
      };
    } else {
      config = cloneJsonSafe(defaults, defaults);
    }
    persist();
  }

  function persist() {
    writeJsonFile(storePath, config);
  }

  function resolveAudioBackendSelection() {
    const backend = String(resolveAudioBackend() || "unwired").trim().toLowerCase() || "unwired";
    if (config.audioCaptureBackendStrategy === "force_rust") {
      return {
        selectedBackend: "rust",
        reason: backend === "rust" ? "forced_runtime_match" : "forced_runtime_pending"
      };
    }
    if (backend === "rust") {
      return { selectedBackend: "rust", reason: "auto_runtime_rust" };
    }
    if (backend === "legacy") {
      return { selectedBackend: "auto", reason: "auto_runtime_legacy_deprecated" };
    }
    return { selectedBackend: "auto", reason: "auto_runtime_unwired" };
  }

  function getConfig() {
    return {
      ok: true,
      config: cloneJsonSafe(config, {}),
      audioBackendSelection: resolveAudioBackendSelection()
    };
  }

  function patchConfig(patch = {}) {
    const source = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
    const nextUnsafe = source.unsafeExposeSensitiveLogs === true;
    if (nextUnsafe && config.unsafeExposeSensitiveLogs !== true) {
      const ack = String(source.unsafeExposeSensitiveLogsAck || "").trim();
      if (ack !== UNSAFE_LOG_ACK_PHRASE) {
        return {
          ok: false,
          error: "unsafe_sensitive_log_ack_required",
          detail: `Provide unsafeExposeSensitiveLogsAck=${UNSAFE_LOG_ACK_PHRASE} to enable this mode.`
        };
      }
    }

    config = {
      ...config,
      autoLaunchBrowser: source.autoLaunchBrowser === undefined
        ? config.autoLaunchBrowser
        : source.autoLaunchBrowser !== false,
      autoLaunchDelayMs: source.autoLaunchDelayMs === undefined && source.delayMs === undefined
        ? config.autoLaunchDelayMs
        : normalizeAutoLaunchDelayMs(
          source.autoLaunchDelayMs === undefined ? source.delayMs : source.autoLaunchDelayMs,
          config.autoLaunchDelayMs
        ),
      hueTransportPreference: source.hueTransportPreference === undefined
        ? config.hueTransportPreference
        : normalizeHueTransportPreference(source.hueTransportPreference),
      audioCaptureBackendStrategy: source.audioCaptureBackendStrategy === undefined
        ? config.audioCaptureBackendStrategy
        : normalizeAudioCaptureBackendStrategy(source.audioCaptureBackendStrategy),
      updateChecksEnabled: source.updateChecksEnabled === undefined
        ? config.updateChecksEnabled
        : normalizeBooleanSetting(source.updateChecksEnabled, config.updateChecksEnabled),
      updateStartupPromptEnabled: source.updateStartupPromptEnabled === undefined
        ? config.updateStartupPromptEnabled
        : normalizeBooleanSetting(source.updateStartupPromptEnabled, config.updateStartupPromptEnabled),
      unsafeExposeSensitiveLogs: source.unsafeExposeSensitiveLogs === undefined
        ? config.unsafeExposeSensitiveLogs
        : source.unsafeExposeSensitiveLogs === true,
      updatedAt: Number(now() || Date.now())
    };
    persist();
    return getConfig();
  }

  load();

  return {
    getConfig,
    patchConfig,
    generateWidgetTemplate
  };
};
