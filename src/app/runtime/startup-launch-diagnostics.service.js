// [TITLE] Module: app/runtime/startup-launch-diagnostics.service.js
// [TITLE] Purpose: track startup browser auto-launch scheduling/attempt diagnostics
// [TITLE] Functionality Index:
// [TITLE] - record launch scheduling metadata from startup orchestration
// [TITLE] - record launch attempt result metadata (launcher + error)
// [TITLE] - expose deterministic snapshot for system diagnostics routes/UI
// [DEV] Complex Flow:
// [DEV] This service is in-memory by design because launcher diagnostics are
// [DEV] runtime boot signals; persisting stale launch results would be misleading.

function asObjectMap(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number(fallback);
  return Math.min(Number(max), Math.max(Number(min), parsed));
}

function normalizeToken(value, fallback = "") {
  const token = String(value || "").trim();
  return token || String(fallback || "").trim();
}

function cloneSnapshot(source = {}) {
  const input = asObjectMap(source, {});
  return {
    bootedAt: Number(input.bootedAt || 0),
    updatedAt: Number(input.updatedAt || 0),
    lastOutcome: normalizeToken(input.lastOutcome, "idle"),
    lastReason: normalizeToken(input.lastReason, "boot_pending"),
    lastUrl: normalizeToken(input.lastUrl, ""),
    lastDelayMs: clampNumber(input.lastDelayMs, 0, 30000, 0),
    lastLauncher: normalizeToken(input.lastLauncher, ""),
    lastError: normalizeToken(input.lastError, ""),
    lastScheduledAt: Number(input.lastScheduledAt || 0),
    lastAttemptAt: Number(input.lastAttemptAt || 0),
    scheduleCount: Math.max(0, Math.round(Number(input.scheduleCount || 0))),
    attemptCount: Math.max(0, Math.round(Number(input.attemptCount || 0))),
    launchSuccessCount: Math.max(0, Math.round(Number(input.launchSuccessCount || 0))),
    launchFailureCount: Math.max(0, Math.round(Number(input.launchFailureCount || 0)))
  };
}

module.exports = function createStartupLaunchDiagnosticsService(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const bootedAt = Number(now() || Date.now());
  let snapshot = cloneSnapshot({
    bootedAt,
    updatedAt: bootedAt,
    lastOutcome: "idle",
    lastReason: "boot_pending",
    lastUrl: "",
    lastDelayMs: 0,
    lastLauncher: "",
    lastError: "",
    lastScheduledAt: 0,
    lastAttemptAt: 0,
    scheduleCount: 0,
    attemptCount: 0,
    launchSuccessCount: 0,
    launchFailureCount: 0
  });

  function commit(patch = {}) {
    snapshot = cloneSnapshot({
      ...snapshot,
      ...asObjectMap(patch, {}),
      updatedAt: Number(now() || Date.now())
    });
    return getSnapshot();
  }

  function recordSchedule(event = {}) {
    const source = asObjectMap(event, {});
    const scheduled = source.scheduled === true;
    const nextScheduleCount = snapshot.scheduleCount + (scheduled ? 1 : 0);
    return commit({
      lastOutcome: scheduled ? "scheduled" : "disabled",
      lastReason: normalizeToken(source.reason, scheduled ? "scheduled" : "auto_launch_disabled"),
      lastUrl: normalizeToken(source.url, snapshot.lastUrl),
      lastDelayMs: clampNumber(source.delayMs, 0, 30000, snapshot.lastDelayMs),
      lastError: "",
      lastScheduledAt: scheduled ? Number(now() || Date.now()) : snapshot.lastScheduledAt,
      scheduleCount: nextScheduleCount
    });
  }

  function recordLaunchResult(event = {}) {
    const source = asObjectMap(event, {});
    const ok = source.ok === true;
    return commit({
      lastOutcome: ok ? "launched" : "failed",
      lastReason: ok ? "launch_ok" : normalizeToken(source.error, "launch_failed"),
      lastUrl: normalizeToken(source.url, snapshot.lastUrl),
      lastDelayMs: clampNumber(source.delayMs, 0, 30000, snapshot.lastDelayMs),
      lastLauncher: normalizeToken(source.launcher, ""),
      lastError: ok ? "" : normalizeToken(source.error, "launch_failed"),
      lastAttemptAt: Number(now() || Date.now()),
      attemptCount: snapshot.attemptCount + 1,
      launchSuccessCount: snapshot.launchSuccessCount + (ok ? 1 : 0),
      launchFailureCount: snapshot.launchFailureCount + (ok ? 0 : 1)
    });
  }

  function getSnapshot() {
    return cloneSnapshot(snapshot);
  }

  return {
    recordSchedule,
    recordLaunchResult,
    getSnapshot
  };
};
