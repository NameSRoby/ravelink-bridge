// [TITLE] Module: public/assets/js/domains/system/system-rust-transport-worker-runtime-ui.js
// [TITLE] Purpose: System tab rust transport-worker controls runtime
// [TITLE] Functionality Index:
// [TITLE] - rust worker status/adapters/watchdog projection
// [TITLE] - rust worker config patch collection and save flow
// [TITLE] - rust worker lifecycle actions and diagnostics copy
// [DEV] Complex Flow:
// [DEV] The controls live on the System tab, but the endpoint contract is audio-owned.
// [DEV] Keep that boundary explicit by requiring an injected audio endpoint adapter.

function createSystemRustTransportWorkerRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const setBadge = typeof deps.setBadge === "function" ? deps.setBadge : (() => {});
  const formatRelativeAge = typeof deps.formatRelativeAge === "function"
    ? deps.formatRelativeAge
    : (() => "-");
  const copyTextToClipboard = typeof deps.copyTextToClipboard === "function"
    ? deps.copyTextToClipboard
    : (async () => false);
  const audioEndpointsAdapter = deps.audioEndpointsAdapter;
  const requiredAdapterMethods = [
    "getRustTransportWorkerStatus",
    "getRustTransportWorkerAdapters",
    "getRustTransportWorkerWatchdog",
    "setRustTransportWorkerConfig",
    "startRustTransportWorker",
    "stopRustTransportWorker",
    "restartRustTransportWorker"
  ];
  if (!audioEndpointsAdapter || typeof audioEndpointsAdapter !== "object") {
    throw new Error("system rust transport-worker runtime requires audioEndpointsAdapter");
  }
  for (const methodName of requiredAdapterMethods) {
    if (typeof audioEndpointsAdapter[methodName] !== "function") {
      throw new Error(`system rust transport-worker runtime missing audio adapter method: ${methodName}`);
    }
  }

  function normalizeRustWorkerBoolSelectValue(value, fallback = true) {
    const token = String(value || "").trim().toLowerCase();
    if (!token) return fallback === true;
    if (token === "true" || token === "1" || token === "yes" || token === "on") return true;
    if (token === "false" || token === "0" || token === "no" || token === "off") return false;
    return fallback === true;
  }

  function clampRustWorkerNumber(value, min, max, fallback) {
    const parsed = Math.round(Number(value));
    if (!Number.isFinite(parsed)) return Number(fallback);
    return Math.min(Number(max), Math.max(Number(min), parsed));
  }

  function getRustTransportWorkerStatusFromSnapshot(snapshot = {}) {
    const source = snapshot && typeof snapshot === "object" ? snapshot : {};
    const status = source.status && typeof source.status === "object"
      ? source.status
      : (source.ok === true && source.running !== undefined ? source : null);
    return status && typeof status === "object" ? status : null;
  }

  function buildRustTransportWorkerDumpPayload() {
    const statusSnapshot = ui.systemRustTransportWorkerStatusSnapshot && typeof ui.systemRustTransportWorkerStatusSnapshot === "object"
      ? ui.systemRustTransportWorkerStatusSnapshot
      : null;
    const status = getRustTransportWorkerStatusFromSnapshot(statusSnapshot);
    const adaptersSnapshot = ui.systemRustTransportWorkerAdaptersSnapshot && typeof ui.systemRustTransportWorkerAdaptersSnapshot === "object"
      ? ui.systemRustTransportWorkerAdaptersSnapshot
      : null;
    const watchdogSnapshot = ui.systemRustTransportWorkerWatchdogSnapshot && typeof ui.systemRustTransportWorkerWatchdogSnapshot === "object"
      ? ui.systemRustTransportWorkerWatchdogSnapshot
      : null;
    return {
      status,
      adapterCatalog: adaptersSnapshot?.catalog || status?.telemetry?.lastAdapterCatalog || null,
      watchdog: watchdogSnapshot?.watchdog || status?.telemetry?.lastWatchdog || null,
      snapshots: {
        status: statusSnapshot,
        adapters: adaptersSnapshot,
        watchdog: watchdogSnapshot
      },
      capturedAt: Date.now()
    };
  }

  function renderSystemRustTransportWorkerStatus() {
    const status = getRustTransportWorkerStatusFromSnapshot(ui.systemRustTransportWorkerStatusSnapshot);
    if (status) {
      if (el.systemRustWorkerEnabled) el.systemRustWorkerEnabled.value = status.enabled === true ? "true" : "false";
      if (el.systemRustWorkerAutoStart) el.systemRustWorkerAutoStart.value = status.autoStart === true ? "true" : "false";
      if (el.systemRustWorkerAdapterPreference) el.systemRustWorkerAdapterPreference.value = String(status.adapterPreference || "auto");
      if (el.systemRustWorkerWatchdogMs) {
        el.systemRustWorkerWatchdogMs.value = String(clampRustWorkerNumber(status.watchdogMs, 250, 30000, 2500));
      }
      if (el.systemRustWorkerRestartBackoffMs) {
        el.systemRustWorkerRestartBackoffMs.value = String(clampRustWorkerNumber(status.restartBackoffMs, 100, 60000, 1200));
      }
      if (el.systemRustWorkerCommandPath) {
        const command = String(status.command || "").trim();
        el.systemRustWorkerCommandPath.value = command;
      }
    }

    if (el.systemRustWorkerAvailable) {
      el.systemRustWorkerAvailable.textContent = status ? (status.available === true ? "YES" : "NO") : "-";
    }
    if (el.systemRustWorkerRunning) {
      if (!status) el.systemRustWorkerRunning.textContent = "-";
      else if (status.enabled !== true) el.systemRustWorkerRunning.textContent = "DISABLED";
      else el.systemRustWorkerRunning.textContent = status.running === true ? "RUNNING" : "STOPPED";
    }
    if (el.systemRustWorkerPid) {
      el.systemRustWorkerPid.textContent = status ? String(Number(status?.runtime?.pid || 0) || "-") : "-";
    }
    if (el.systemRustWorkerStarts) {
      el.systemRustWorkerStarts.textContent = status ? String(Number(status?.runtime?.starts || 0)) : "0";
    }
    if (el.systemRustWorkerRestarts) {
      el.systemRustWorkerRestarts.textContent = status ? String(Number(status?.runtime?.restarts || 0)) : "0";
    }
    if (el.systemRustWorkerErrors) {
      el.systemRustWorkerErrors.textContent = status ? String(Number(status?.runtime?.errors || 0)) : "0";
    }
    if (el.systemRustWorkerLastEvent) {
      const eventType = String(status?.runtime?.lastEventType || "").trim();
      const eventAge = formatRelativeAge(status?.runtime?.lastEventAt || 0);
      el.systemRustWorkerLastEvent.textContent = eventType ? `${eventType} (${eventAge})` : "-";
    }
    if (el.systemRustWorkerLastReason) {
      el.systemRustWorkerLastReason.textContent = status ? (String(status.lastReason || "").trim() || "-") : "-";
    }
    if (el.systemRustWorkerStatusText) {
      if (!status) {
        el.systemRustWorkerStatusText.value = "Rust transport worker idle.";
      } else {
        const lifecycle = status.enabled !== true
          ? "DISABLED"
          : (status.running === true ? "RUNNING" : "STOPPED");
        const commandSource = String(status.commandSource || "missing").trim().toUpperCase();
        const errorCount = Number(status?.runtime?.errors || 0);
        el.systemRustWorkerStatusText.value = `${lifecycle} | COMMAND=${commandSource} | ERRORS=${errorCount}`;
      }
    }

    if (el.systemRustWorkerDump) {
      const dumpPayload = buildRustTransportWorkerDumpPayload();
      try {
        el.systemRustWorkerDump.value = JSON.stringify(dumpPayload, null, 2);
      } catch {
        el.systemRustWorkerDump.value = String(dumpPayload || "");
      }
    }
  }

  async function loadSystemRustTransportWorkerStatus(options = {}) {
    const announce = options.announce === true;
    const response = await audioEndpointsAdapter.getRustTransportWorkerStatus();
    if (!response || response.ok !== true || !response.status) {
      if (announce) {
        if (el.systemRustWorkerStatusText) el.systemRustWorkerStatusText.value = "Rust transport worker status unavailable.";
        setBadge(el.health, "warn", "RUST WORKER STATUS FAILED");
      }
      return false;
    }
    ui.systemRustTransportWorkerStatusSnapshot = response;
    renderSystemRustTransportWorkerStatus();
    return true;
  }

  async function loadSystemRustTransportWorkerAdapters(options = {}) {
    const announce = options.announce === true;
    const refresh = options.refresh !== false;
    const response = await audioEndpointsAdapter.getRustTransportWorkerAdapters(refresh);
    if (!response || response.ok !== true) {
      if (announce) {
        if (el.systemRustWorkerStatusText) el.systemRustWorkerStatusText.value = "Rust transport adapters unavailable.";
        setBadge(el.health, "warn", "RUST ADAPTER CATALOG FAILED");
      }
      return false;
    }
    ui.systemRustTransportWorkerAdaptersSnapshot = response;
    if (response.status && typeof response.status === "object") {
      ui.systemRustTransportWorkerStatusSnapshot = {
        ok: true,
        status: response.status
      };
    }
    renderSystemRustTransportWorkerStatus();
    if (announce) {
      const adapterCount = Array.isArray(response?.catalog?.adapters) ? response.catalog.adapters.length : 0;
      setBadge(el.health, "ok", `RUST ADAPTERS REFRESHED (${adapterCount})`);
    }
    return true;
  }

  async function loadSystemRustTransportWorkerWatchdog(options = {}) {
    const announce = options.announce === true;
    const refresh = options.refresh !== false;
    const response = await audioEndpointsAdapter.getRustTransportWorkerWatchdog(refresh);
    if (!response || response.ok !== true) {
      if (announce) {
        if (el.systemRustWorkerStatusText) el.systemRustWorkerStatusText.value = "Rust transport watchdog unavailable.";
        setBadge(el.health, "warn", "RUST WATCHDOG FAILED");
      }
      return false;
    }
    ui.systemRustTransportWorkerWatchdogSnapshot = response;
    if (response.status && typeof response.status === "object") {
      ui.systemRustTransportWorkerStatusSnapshot = {
        ok: true,
        status: response.status
      };
    }
    renderSystemRustTransportWorkerStatus();
    if (announce) {
      setBadge(el.health, "ok", "RUST WATCHDOG REFRESHED");
    }
    return true;
  }

  function buildRustTransportWorkerConfigPatchFromUi() {
    return {
      enabled: normalizeRustWorkerBoolSelectValue(el.systemRustWorkerEnabled?.value, true),
      autoStart: normalizeRustWorkerBoolSelectValue(el.systemRustWorkerAutoStart?.value, true),
      adapterPreference: String(el.systemRustWorkerAdapterPreference?.value || "auto").trim() || "auto",
      watchdogMs: clampRustWorkerNumber(el.systemRustWorkerWatchdogMs?.value, 250, 30000, 2500),
      restartBackoffMs: clampRustWorkerNumber(el.systemRustWorkerRestartBackoffMs?.value, 100, 60000, 1200),
      commandPath: String(el.systemRustWorkerCommandPath?.value || "").trim()
    };
  }

  async function saveSystemRustTransportWorkerConfig(options = {}) {
    const announce = options.announce !== false;
    const patch = buildRustTransportWorkerConfigPatchFromUi();
    const response = await audioEndpointsAdapter.setRustTransportWorkerConfig(patch);
    if (!response || response.ok !== true || response.data?.ok !== true || !response.data?.status) {
      const errorText = String(response?.data?.error || "rust_transport_worker_config_failed").trim();
      if (announce) {
        if (el.systemRustWorkerStatusText) el.systemRustWorkerStatusText.value = errorText;
        setBadge(el.health, "warn", "RUST WORKER CONFIG FAILED");
      }
      return false;
    }
    ui.systemRustTransportWorkerStatusSnapshot = {
      ok: true,
      status: response.data.status
    };
    renderSystemRustTransportWorkerStatus();
    if (announce) {
      setBadge(el.health, "ok", "RUST WORKER CONFIG APPLIED");
    }
    return true;
  }

  async function runSystemRustTransportWorkerLifecycle(action = "", payload = {}, options = {}) {
    const token = String(action || "").trim().toLowerCase();
    const announce = options.announce !== false;
    let response = null;
    if (token === "start") {
      response = await audioEndpointsAdapter.startRustTransportWorker(payload || {});
    } else if (token === "stop") {
      response = await audioEndpointsAdapter.stopRustTransportWorker(payload || {});
    } else if (token === "restart") {
      response = await audioEndpointsAdapter.restartRustTransportWorker(payload || {});
    } else {
      return false;
    }
    if (!response || response.ok !== true || response.data?.ok !== true || !response.data?.status) {
      const errorText = String(response?.data?.error || `rust_transport_worker_${token}_failed`).trim();
      if (announce) {
        if (el.systemRustWorkerStatusText) el.systemRustWorkerStatusText.value = errorText;
        setBadge(el.health, "warn", `RUST WORKER ${token.toUpperCase()} FAILED`);
      }
      return false;
    }
    ui.systemRustTransportWorkerStatusSnapshot = {
      ok: true,
      status: response.data.status
    };
    renderSystemRustTransportWorkerStatus();
    if (announce) {
      setBadge(el.health, "ok", `RUST WORKER ${token.toUpperCase()} OK`);
    }
    return true;
  }

  async function startSystemRustTransportWorker(options = {}) {
    return runSystemRustTransportWorkerLifecycle("start", { reason: "system_ui_start" }, options);
  }

  async function stopSystemRustTransportWorker(options = {}) {
    return runSystemRustTransportWorkerLifecycle("stop", { disable: false }, options);
  }

  async function restartSystemRustTransportWorker(options = {}) {
    return runSystemRustTransportWorkerLifecycle("restart", { reason: "system_ui_restart" }, options);
  }

  async function copySystemRustTransportWorkerJson() {
    const payload = buildRustTransportWorkerDumpPayload();
    let text = "";
    try {
      text = JSON.stringify(payload, null, 2);
    } catch {
      text = String(payload || "");
    }
    const copied = await copyTextToClipboard(text);
    if (!copied) {
      if (el.systemRustWorkerStatusText) el.systemRustWorkerStatusText.value = "Rust worker copy failed.";
      setBadge(el.health, "warn", "RUST WORKER COPY FAILED");
      return false;
    }
    if (el.systemRustWorkerStatusText) el.systemRustWorkerStatusText.value = "Rust worker diagnostics copied.";
    setBadge(el.health, "ok", "RUST WORKER JSON COPIED");
    return true;
  }

  return {
    normalizeRustWorkerBoolSelectValue,
    clampRustWorkerNumber,
    getRustTransportWorkerStatusFromSnapshot,
    buildRustTransportWorkerDumpPayload,
    renderSystemRustTransportWorkerStatus,
    loadSystemRustTransportWorkerStatus,
    loadSystemRustTransportWorkerAdapters,
    loadSystemRustTransportWorkerWatchdog,
    saveSystemRustTransportWorkerConfig,
    startSystemRustTransportWorker,
    stopSystemRustTransportWorker,
    restartSystemRustTransportWorker,
    copySystemRustTransportWorkerJson
  };
}
