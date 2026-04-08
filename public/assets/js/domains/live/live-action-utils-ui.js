// [TITLE] Module: public/assets/js/domains/live/live-action-utils-ui.js
// [TITLE] Purpose: shared live-tab action feedback and group-lock helpers
// [TITLE] Functionality Index:
// [TITLE] - grouped button collection
// [TITLE] - async busy-state button wrapper
// [TITLE] - grouped UI lock runner
//
// [DEV] Complex Flow:
// [DEV] Live controls use grouped lock semantics so mutually-exclusive buttons cannot race
// [DEV] each other or leave stale busy text behind. Keep lock-key behavior and minimum busy
// [DEV] timing stable because the live tab depends on those visual semantics for user trust.

const uiActionLocks = Object.create(null);
const LIVE_BUTTON_MIN_BUSY_MS = 260;
const LIVE_CONTROL_AUDIT_HISTORY_MAX = 160;

function getLiveControlAuditRuntime() {
  if (typeof window === "undefined") return null;
  if (!window.__ravelinkLiveControlAudit || typeof window.__ravelinkLiveControlAudit !== "object") {
    window.__ravelinkLiveControlAudit = {
      enabled: true,
      seq: 0,
      activeAction: null,
      lastCompletedAction: null,
      history: []
    };
  }
  const runtime = window.__ravelinkLiveControlAudit;
  if (!window.__ravelinkLiveControlAuditApi || typeof window.__ravelinkLiveControlAuditApi !== "object") {
    window.__ravelinkLiveControlAuditApi = {
      getRuntime: () => runtime,
      getHistory: () => Array.isArray(runtime.history) ? runtime.history.slice() : [],
      clearHistory: () => {
        runtime.history = [];
      },
      setEnabled: enabled => {
        runtime.enabled = enabled !== false;
      }
    };
  }
  return runtime;
}

function recordLiveControlAuditAction(entry = null) {
  const runtime = getLiveControlAuditRuntime();
  if (!runtime || runtime.enabled === false || !entry || typeof entry !== "object") return null;
  runtime.history.push(entry);
  if (runtime.history.length > LIVE_CONTROL_AUDIT_HISTORY_MAX) {
    runtime.history.splice(0, runtime.history.length - LIVE_CONTROL_AUDIT_HISTORY_MAX);
  }
  return runtime;
}

function collectUiGroupButtons(nodes = []) {
  return Array.isArray(nodes) ? nodes.filter(Boolean) : [];
}

async function runLiveButtonAction(button, busyLabel, action) {
  if (!button || typeof action !== "function") {
    return typeof action === "function" ? action() : null;
  }
  if (button.dataset.liveBusy === "1") return null;

  const idleLabel = String(button.dataset.liveIdleLabel || button.textContent || "").trim();
  const nextBusyLabel = String(busyLabel || "WORKING...").trim() || "WORKING...";
  if (!button.dataset.liveIdleLabel) {
    button.dataset.liveIdleLabel = idleLabel;
  }

  const startedAt = Date.now();
  const liveAuditRuntime = getLiveControlAuditRuntime();
  const actionSeq = liveAuditRuntime
    ? (Math.max(0, Number(liveAuditRuntime.seq || 0)) + 1)
    : 0;
  if (liveAuditRuntime && actionSeq > 0) {
    liveAuditRuntime.seq = actionSeq;
    liveAuditRuntime.activeAction = {
      seq: actionSeq,
      buttonId: String(button?.id || "").trim(),
      buttonLabel: String(button?.dataset?.liveIdleLabel || button?.textContent || "").trim(),
      busyLabel: String(nextBusyLabel || "").trim(),
      startedAt
    };
    recordLiveControlAuditAction({
      ...liveAuditRuntime.activeAction,
      phase: "start"
    });
  }
  button.dataset.liveBusy = "1";
  button.classList.add("busy");
  button.classList.add("audioActionPressed");
  if (nextBusyLabel) {
    button.textContent = nextBusyLabel;
  }
  setTimeout(() => {
    button.classList.remove("audioActionPressed");
  }, 140);

  let actionError = null;
  try {
    return await action();
  } catch (err) {
    actionError = err;
    throw err;
  } finally {
    const elapsed = Date.now() - startedAt;
    if (elapsed < LIVE_BUTTON_MIN_BUSY_MS) {
      await new Promise(resolve => setTimeout(resolve, LIVE_BUTTON_MIN_BUSY_MS - elapsed));
    }
    button.classList.remove("busy");
    if (idleLabel) {
      button.textContent = idleLabel;
    }
    button.dataset.liveBusy = "0";
    const endedAt = Date.now();
    if (liveAuditRuntime && actionSeq > 0) {
      const completedAction = {
        seq: actionSeq,
        buttonId: String(button?.id || "").trim(),
        buttonLabel: String(button?.dataset?.liveIdleLabel || button?.textContent || "").trim(),
        busyLabel: String(nextBusyLabel || "").trim(),
        startedAt,
        endedAt,
        durationMs: Math.max(0, endedAt - startedAt),
        status: actionError ? "error" : "ok",
        error: actionError ? String(actionError?.message || actionError || "error") : ""
      };
      liveAuditRuntime.activeAction = null;
      liveAuditRuntime.lastCompletedAction = completedAction;
      recordLiveControlAuditAction({
        ...completedAction,
        phase: "end"
      });
    }
  }
}

function installLiveButtonFeedback(button, busyLabel = "WORKING...") {
  if (!button || typeof button.onclick !== "function") return false;
  if (button.dataset.liveFeedbackWrapped === "1") return true;

  const baseHandler = button.onclick;
  button.dataset.liveIdleLabel = String(button.textContent || "").trim();
  button.onclick = event => runLiveButtonAction(button, busyLabel, () => baseHandler.call(button, event));
  button.dataset.liveFeedbackWrapped = "1";
  return true;
}

async function runUiActionWithGroupLock(lockKey, nodes, action) {
  const key = String(lockKey || "").trim();
  const run = typeof action === "function" ? action : async () => null;
  if (!key) return run();
  if (uiActionLocks[key]) return null;

  uiActionLocks[key] = true;
  const buttons = collectUiGroupButtons(nodes);
  const priorDisabled = buttons.map(btn => Boolean(btn.disabled));
  buttons.forEach(btn => {
    btn.disabled = true;
  });

  try {
    return await run();
  } finally {
    buttons.forEach((btn, idx) => {
      btn.disabled = priorDisabled[idx];
    });
    uiActionLocks[key] = false;
  }
}
