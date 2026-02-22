"use strict";

module.exports = function registerMidiRoutes(app, deps = {}) {
  const getMidiManager = typeof deps.getMidiManager === "function"
    ? deps.getMidiManager
    : () => deps.midiManager || null;
  const getRequestMap = typeof deps.getRequestMap === "function"
    ? deps.getRequestMap
    : (value => (value && typeof value === "object" ? value : {}));

  function getMidiSnapshot() {
    const midiManager = getMidiManager();
    if (!midiManager || typeof midiManager.getStatus !== "function") {
      return {
        ok: false,
        moduleAvailable: false,
        moduleError: "midi manager unavailable",
        connected: false,
        activePortIndex: null,
        activePortName: "",
        ports: [],
        portCount: 0,
        config: {
          enabled: false,
          deviceIndex: null,
          deviceMatch: "",
          velocityThreshold: 1,
          bindings: {}
        },
        actions: [],
        learn: { target: null, startedAt: 0, expiresAt: 0 },
        lastMessage: null,
        lastAction: "",
        lastActionAt: "",
        reason: "midi manager unavailable"
      };
    }
    return midiManager.getStatus();
  }

  function withMidiMethodOr503(methodName, res, onReady) {
    const midiManager = getMidiManager();
    if (midiManager && typeof midiManager[methodName] === "function") {
      return onReady(midiManager);
    }
    return res.status(503).json(getMidiSnapshot());
  }

  function normalizeMidiAction(actionRaw) {
    return String(actionRaw || "").trim().toLowerCase();
  }

  function normalizeMidiLearnAction(actionRaw) {
    const action = normalizeMidiAction(actionRaw);
    return action === "overclock" ? "overclock_toggle" : action;
  }

  function respondMidiActionResult(res, result, error, requested) {
    if (!result || result.ok !== true) {
      return res.status(400).json({
        ...(result?.status || {}),
        ok: false,
        error,
        requested
      });
    }
    return res.json(result.status);
  }

  app.get("/midi/status", (_, res) => {
    res.json(getMidiSnapshot());
  });

  app.post("/midi/refresh", (_, res) => {
    return withMidiMethodOr503("refresh", res, manager => res.json(manager.refresh()));
  });

  app.post("/midi/config", (req, res) => {
    return withMidiMethodOr503("applyConfig", res, manager => {
      const patch = getRequestMap(req.body);
      return res.json(manager.applyConfig(patch));
    });
  });

  app.post("/midi/learn/cancel", (_, res) => {
    return withMidiMethodOr503("cancelLearn", res, manager => res.json(manager.cancelLearn()));
  });

  app.post("/midi/learn/:action", (req, res) => {
    return withMidiMethodOr503("startLearn", res, manager => {
      const action = normalizeMidiLearnAction(req.params.action);
      const result = manager.startLearn(action);
      return respondMidiActionResult(res, result, "invalid midi learn action", action);
    });
  });

  app.post("/midi/bindings/reset", (_, res) => {
    return withMidiMethodOr503("resetBindings", res, manager => res.json(manager.resetBindings()));
  });

  app.post("/midi/bindings/:action", (req, res) => {
    return withMidiMethodOr503("setBinding", res, manager => {
      const action = normalizeMidiAction(req.params.action);
      const binding = getRequestMap(req.body);
      const result = manager.setBinding(action, binding);
      return respondMidiActionResult(res, result, "invalid midi binding", action);
    });
  });

  app.delete("/midi/bindings/:action", (req, res) => {
    return withMidiMethodOr503("clearBinding", res, manager => {
      const action = normalizeMidiAction(req.params.action);
      const result = manager.clearBinding(action);
      return respondMidiActionResult(res, result, "binding not found", action);
    });
  });

  app.post("/midi/trigger/:action", (req, res) => {
    return withMidiMethodOr503("triggerAction", res, manager => {
      const action = normalizeMidiAction(req.params.action);
      const result = manager.triggerAction(action);
      return respondMidiActionResult(res, result, "invalid midi trigger action", action);
    });
  });
};
