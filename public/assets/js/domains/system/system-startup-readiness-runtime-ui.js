// [TITLE] Module: public/assets/js/domains/system/system-startup-readiness-runtime-ui.js
// [TITLE] Purpose: startup readiness diagnostics UI runtime for SYSTEM tab card
// [TITLE] Functionality Index:
// [TITLE] - normalize startup-readiness lane snapshot payloads
// [TITLE] - render boot/current lane table + summary status fields
// [TITLE] - load readiness snapshot from /system/startup-readiness
// [TITLE] - load/render core status + launcher diagnostics from /system/core-status
// [TITLE] - copy current diagnostics snapshot JSON for support handoff
// [DEV] Complex Flow:
// [DEV] Rendering keeps boot and current states visible side-by-side so operators can
// [DEV] distinguish startup load gaps from transient runtime changes.

function createSystemStartupReadinessRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const windowRef = deps.windowRef || window;
  const documentRef = deps.documentRef || document;
  const navigatorRef = deps.navigatorRef || navigator;
  const setBadge = typeof deps.setBadge === "function" ? deps.setBadge : (() => {});
  const systemEndpointsAdapter = deps.systemEndpointsAdapter;
  const requiredAdapterMethods = [
    "getStartupReadiness",
    "getCoreStatus",
    "getLauncherDiagnostics"
  ];
  if (!systemEndpointsAdapter || typeof systemEndpointsAdapter !== "object") {
    throw new Error("system startup-readiness runtime requires systemEndpointsAdapter");
  }
  for (const methodName of requiredAdapterMethods) {
    if (typeof systemEndpointsAdapter[methodName] !== "function") {
      throw new Error(`system startup-readiness runtime missing adapter method: ${methodName}`);
    }
  }

  const LANE_KEYS = Object.freeze(["config", "profiles", "mods", "midi", "hue", "wiz"]);

  function asObjectMap(value, fallback = {}) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
  }

  function normalizeLaneState(value, fallback = "missing") {
    const token = String(value || "").trim().toLowerCase();
    if (!token) return fallback;
    if (token === "loaded") return "loaded";
    if (token === "partial") return "partial";
    if (token === "pending") return "pending";
    if (token === "failed") return "failed";
    if (token === "missing") return "missing";
    return fallback;
  }

  function formatTs(value) {
    const ms = Number(value || 0);
    if (!Number.isFinite(ms) || ms <= 0) return "-";
    try {
      return new Date(ms).toLocaleTimeString();
    } catch {
      return "-";
    }
  }

  function formatAgeMs(value) {
    const ms = Math.max(0, Number(value || 0));
    if (!Number.isFinite(ms) || ms <= 0) return "0s";
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function formatLaneStateLabel(state = "missing") {
    const token = normalizeLaneState(state, "missing");
    if (token === "loaded") return "LOADED";
    if (token === "partial") return "PARTIAL";
    if (token === "pending") return "PENDING";
    if (token === "failed") return "FAILED";
    return "MISSING";
  }

  function normalizeCoreStatusToken(value, fallback = "unknown") {
    const token = String(value || "").trim().toLowerCase();
    if (token === "ok") return "ok";
    if (token === "partial") return "partial";
    if (token === "failed") return "failed";
    return fallback;
  }

  function normalizeLaunchOutcomeToken(value, fallback = "idle") {
    const token = String(value || "").trim().toLowerCase();
    if (token === "launched") return "launched";
    if (token === "failed") return "failed";
    if (token === "scheduled") return "scheduled";
    if (token === "disabled") return "disabled";
    if (token === "idle") return "idle";
    return fallback;
  }

  function asPositiveInt(value, fallback = 0) {
    const parsed = Math.round(Number(value));
    if (!Number.isFinite(parsed)) return Math.max(0, Math.round(Number(fallback) || 0));
    return Math.max(0, parsed);
  }

  function laneStateBadgeVariant(state = "missing") {
    const token = normalizeLaneState(state, "missing");
    if (token === "loaded") return "startupReadinessStateLoaded";
    if (token === "partial") return "startupReadinessStatePartial";
    if (token === "pending") return "startupReadinessStatePending";
    if (token === "failed") return "startupReadinessStateFailed";
    return "startupReadinessStateMissing";
  }

  function createLaneStateBadge(state = "missing") {
    const badge = documentRef.createElement("span");
    badge.className = `statusPill startupReadinessStateBadge ${laneStateBadgeVariant(state)}`;
    badge.textContent = formatLaneStateLabel(state);
    return badge;
  }

  function laneIsReady(state = "missing") {
    return normalizeLaneState(state, "missing") === "loaded";
  }

  function coreStatusIsReady(snapshot = {}) {
    const source = asObjectMap(snapshot, {});
    return normalizeCoreStatusToken(source.status, "unknown") === "ok";
  }

  function renderStartupReadinessRows(snapshot = {}) {
    if (!el.systemStartupReadinessRows) return;
    const source = asObjectMap(snapshot, {});
    const bootLanes = asObjectMap(source.boot?.lanes, {});
    const currentLanes = asObjectMap(source.current?.lanes, {});
    el.systemStartupReadinessRows.innerHTML = "";

    for (const laneKey of LANE_KEYS) {
      const bootLane = asObjectMap(bootLanes[laneKey], {});
      const currentLane = asObjectMap(currentLanes[laneKey], {});
      const bootState = normalizeLaneState(bootLane.state, "missing");
      const currentState = normalizeLaneState(currentLane.state, "missing");
      const bootDetail = String(bootLane.detail || "").trim();
      const currentDetail = String(currentLane.detail || "").trim();
      const detail = currentDetail || bootDetail || "-";

      const row = documentRef.createElement("tr");
      const laneTd = documentRef.createElement("td");
      laneTd.className = "mono";
      laneTd.textContent = laneKey.toUpperCase();

      const bootTd = documentRef.createElement("td");
      bootTd.className = "mono startupReadinessStateCell";
      bootTd.appendChild(createLaneStateBadge(bootState));

      const currentTd = documentRef.createElement("td");
      currentTd.className = "mono startupReadinessStateCell";
      currentTd.appendChild(createLaneStateBadge(currentState));

      const detailTd = documentRef.createElement("td");
      detailTd.className = "mono";
      detailTd.textContent = detail;

      row.appendChild(laneTd);
      row.appendChild(bootTd);
      row.appendChild(currentTd);
      row.appendChild(detailTd);
      el.systemStartupReadinessRows.appendChild(row);
    }
  }

  function renderStartupReadinessSummary(snapshot = {}) {
    const source = asObjectMap(snapshot, {});
    const bootSummary = asObjectMap(source.boot?.summary, {});
    const currentSummary = asObjectMap(source.current?.summary, {});
    const bootReadyCount = Math.max(0, Number(bootSummary.readyCount || 0));
    const bootLaneCount = Math.max(1, Number(bootSummary.laneCount || LANE_KEYS.length));
    const currentReadyCount = Math.max(0, Number(currentSummary.readyCount || 0));
    const currentLaneCount = Math.max(1, Number(currentSummary.laneCount || LANE_KEYS.length));
    const allReady = currentReadyCount >= currentLaneCount;

    if (el.systemStartupReadinessStatus) {
      el.systemStartupReadinessStatus.value =
        `BOOT ${bootReadyCount}/${bootLaneCount} READY | CURRENT ${currentReadyCount}/${currentLaneCount} READY`;
    }
    if (el.systemStartupReadinessBootAt) {
      el.systemStartupReadinessBootAt.textContent = formatTs(source.startedAt || source.boot?.capturedAt);
    }
    if (el.systemStartupReadinessCapturedAt) {
      el.systemStartupReadinessCapturedAt.textContent = formatTs(source.generatedAt || source.current?.capturedAt);
    }
    if (el.systemStartupReadinessAge) {
      el.systemStartupReadinessAge.textContent = formatAgeMs(source.ageMs);
    }

    return {
      allReady,
      bootReadyCount,
      bootLaneCount,
      currentReadyCount,
      currentLaneCount
    };
  }

  function renderSystemStartupReadinessUi(snapshot = {}, options = {}) {
    const source = asObjectMap(snapshot, {});
    ui.systemStartupReadinessSnapshot = source;
    renderStartupReadinessRows(source);
    const summary = renderStartupReadinessSummary(source);
    if (options?.announce === true) {
      setBadge(
        el.health,
        summary.allReady ? "ok" : "warn",
        summary.allReady ? "STARTUP READINESS OK" : "STARTUP READINESS PARTIAL"
      );
    }
    return summary;
  }

  function renderCoreStatusFromSnapshot(snapshot = {}) {
    const source = asObjectMap(snapshot, {});
    const serviceSummary = asObjectMap(source.serviceSummary, {});
    const laneSummary = asObjectMap(source.laneSummary, {});
    const status = normalizeCoreStatusToken(source.status, "unknown");
    const serviceReady = asPositiveInt(serviceSummary.requiredReady, 0);
    const serviceTotal = asPositiveInt(serviceSummary.requiredTotal, 0);
    const laneReady = asPositiveInt(
      laneSummary.requiredReadyCount,
      asPositiveInt(laneSummary.readyCount, 0)
    );
    const laneTotal = asPositiveInt(
      laneSummary.requiredLaneCount,
      asPositiveInt(laneSummary.laneCount, 0)
    );
    const optionalBlockingCount = Array.isArray(laneSummary.optionalBlocking)
      ? laneSummary.optionalBlocking.length
      : 0;
    const statusLabel = status === "ok"
      ? "OK"
      : status === "partial"
        ? "PARTIAL"
        : status === "failed"
          ? "FAILED"
          : "UNKNOWN";
    if (el.systemStartupReadinessCoreStatus) {
      el.systemStartupReadinessCoreStatus.textContent =
        `${statusLabel} | SERVICES ${serviceReady}/${serviceTotal} | CORE ${laneReady}/${laneTotal} | OPTIONAL ${optionalBlockingCount} WARN`;
    }
    ui.systemCoreStatusSnapshot = source;
  }

  function renderLauncherDiagnosticsFromSnapshot(snapshot = {}) {
    const source = asObjectMap(snapshot, {});
    const launcherSource = Object.prototype.hasOwnProperty.call(source, "launcher")
      ? source.launcher
      : source;
    const launcher = asObjectMap(launcherSource, {});
    const hasLauncherShape =
      Object.prototype.hasOwnProperty.call(launcher, "lastOutcome") ||
      Object.prototype.hasOwnProperty.call(launcher, "lastLauncher") ||
      Object.prototype.hasOwnProperty.call(launcher, "lastError") ||
      Object.prototype.hasOwnProperty.call(launcher, "attemptCount");
    if (!hasLauncherShape) {
      if (el.systemStartupReadinessLaunchStatus) {
        el.systemStartupReadinessLaunchStatus.textContent = "UNAVAILABLE";
      }
      ui.systemLauncherDiagnosticsSnapshot = null;
      return;
    }
    const outcome = normalizeLaunchOutcomeToken(launcher.lastOutcome, "idle");
    const launcherToken = String(launcher.lastLauncher || "").trim();
    const delayMs = asPositiveInt(launcher.lastDelayMs, 0);
    const launchLabel = (() => {
      if (outcome === "launched") return `LAUNCHED (${launcherToken || "default"})`;
      if (outcome === "failed") return `FAILED (${launcherToken || "unknown"})`;
      if (outcome === "scheduled") return `SCHEDULED (${delayMs}ms)`;
      if (outcome === "disabled") return "DISABLED";
      return "IDLE";
    })();
    if (el.systemStartupReadinessLaunchStatus) {
      el.systemStartupReadinessLaunchStatus.textContent = launchLabel;
    }
    ui.systemLauncherDiagnosticsSnapshot = launcher;
  }

  function renderCoreStatusUnavailable() {
    if (el.systemStartupReadinessCoreStatus) {
      el.systemStartupReadinessCoreStatus.textContent = "UNAVAILABLE";
    }
    if (el.systemStartupReadinessLaunchStatus) {
      el.systemStartupReadinessLaunchStatus.textContent = "UNAVAILABLE";
    }
    ui.systemCoreStatusSnapshot = null;
    ui.systemLauncherDiagnosticsSnapshot = null;
  }

  async function loadSystemCoreStatus() {
    const coreResponse = typeof systemEndpointsAdapter.getCoreStatus === "function"
      ? await systemEndpointsAdapter.getCoreStatus()
      : null;
    if (coreResponse && coreResponse.ok === true) {
      renderCoreStatusFromSnapshot(coreResponse);
      renderLauncherDiagnosticsFromSnapshot(coreResponse.launcher || coreResponse);
      return {
        ok: true,
        coreReady: coreStatusIsReady(coreResponse)
      };
    }

    const launcherResponse = typeof systemEndpointsAdapter.getLauncherDiagnostics === "function"
      ? await systemEndpointsAdapter.getLauncherDiagnostics()
      : null;
    if (launcherResponse && launcherResponse.ok === true) {
      renderLauncherDiagnosticsFromSnapshot(launcherResponse);
      if (el.systemStartupReadinessCoreStatus) {
        el.systemStartupReadinessCoreStatus.textContent = "UNAVAILABLE";
      }
      ui.systemCoreStatusSnapshot = null;
      return {
        ok: true,
        coreReady: false
      };
    }

    renderCoreStatusUnavailable();
    return {
      ok: false,
      coreReady: false
    };
  }

  async function loadSystemStartupReadiness(options = {}) {
    const response = await systemEndpointsAdapter.getStartupReadiness();
    if (!response || response.ok !== true || response.ok === false || response?.status >= 400) {
      if (el.systemStartupReadinessStatus) {
        el.systemStartupReadinessStatus.value = "STARTUP READINESS UNAVAILABLE";
      }
      renderCoreStatusUnavailable();
      if (options?.announce !== false) {
        setBadge(el.health, "warn", "STARTUP READINESS UNAVAILABLE");
      }
      return false;
    }
    const summary = renderSystemStartupReadinessUi(response, {
      announce: false
    });
    const coreStatus = await loadSystemCoreStatus();
    if (options?.announce === true) {
      const coreReady = coreStatus.coreReady === true;
      const allLanesReady = summary?.allReady === true;
      if (coreReady && allLanesReady) {
        setBadge(el.health, "ok", "STARTUP CORE READY");
      } else if (coreReady) {
        setBadge(el.health, "ok", "STARTUP CORE READY (OPTIONAL MISSING)");
      } else {
        setBadge(el.health, "warn", "STARTUP CORE PARTIAL");
      }
    }
    return true;
  }

  function getStartupReadinessSnapshot() {
    const snapshot = asObjectMap(ui.systemStartupReadinessSnapshot, {});
    return Object.keys(snapshot).length ? snapshot : null;
  }

  function createClipboardFallbackTextarea(text = "") {
    if (!documentRef.body) return null;
    const node = documentRef.createElement("textarea");
    node.value = String(text || "");
    node.setAttribute("readonly", "readonly");
    node.style.position = "fixed";
    node.style.top = "-1000px";
    node.style.left = "-1000px";
    node.style.opacity = "0";
    documentRef.body.appendChild(node);
    return node;
  }

  async function copySystemStartupReadinessDiagnosticsJson() {
    const snapshot = getStartupReadinessSnapshot();
    if (!snapshot) {
      setBadge(el.health, "warn", "READINESS SNAPSHOT EMPTY");
      return false;
    }

    const payload = {
      exportedAt: Date.now(),
      exportedAtIso: new Date().toISOString(),
      startupReadiness: snapshot,
      coreStatus: asObjectMap(ui.systemCoreStatusSnapshot, null),
      launcherDiagnostics: asObjectMap(ui.systemLauncherDiagnosticsSnapshot, null),
      nonLiveUiWiring: asObjectMap(ui.nonLiveUiWiringSummary, null)
    };
    const text = JSON.stringify(payload, null, 2);
    let copied = false;

    if (navigatorRef.clipboard && typeof navigatorRef.clipboard.writeText === "function") {
      try {
        await navigatorRef.clipboard.writeText(text);
        copied = true;
      } catch {
        copied = false;
      }
    }

    if (!copied) {
      const fallback = createClipboardFallbackTextarea(text);
      if (fallback) {
        fallback.focus();
        fallback.select();
        try {
          copied = documentRef.execCommand("copy");
        } catch {
          copied = false;
        } finally {
          documentRef.body.removeChild(fallback);
        }
      }
      windowRef.getSelection?.()?.removeAllRanges?.();
    }

    setBadge(el.health, copied ? "ok" : "warn", copied ? "READINESS JSON COPIED" : "READINESS JSON COPY FAILED");
    return copied;
  }

  return {
    laneIsReady,
    normalizeLaneState,
    normalizeCoreStatusToken,
    renderSystemStartupReadinessUi,
    loadSystemStartupReadiness,
    copySystemStartupReadinessDiagnosticsJson
  };
}
