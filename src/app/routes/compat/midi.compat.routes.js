// [TITLE] Module: app/routes/compat/midi.compat.routes.js
// [TITLE] Purpose: register MIDI compatibility routes for current UI contracts
// [TITLE] Functionality Index:
// [TITLE] - MIDI status/readback compatibility endpoints
// [TITLE] - MIDI learn/trigger/binding mutation routes
// [DEV] Complex Flow:
// [DEV] This slice keeps MIDI compatibility routing isolated so the top-level
// [DEV] compat registrar can compose route families without re-growing.

module.exports = function registerMidiCompatRoutes(app, deps = {}) {
  const midiManager = deps.midiManager;
  const enforceWriteAccess = typeof deps.enforceWriteAccess === "function"
    ? deps.enforceWriteAccess
    : ((_req, _res, next) => next());
  const getRequestMap = typeof deps.getRequestMap === "function"
    ? deps.getRequestMap
    : (value => (value && typeof value === "object" && !Array.isArray(value) ? value : {}));
  const toCompatError = typeof deps.toCompatError === "function"
    ? deps.toCompatError
    : ((res, status, error, detail = "") => {
      res.status(status).json({
        ok: false,
        error,
        detail: String(detail || "").trim()
      });
    });

  // [TITLE] Section: MIDI Compatibility Routes
  app.get("/midi/status", (_req, res) => {
    res.json(midiManager.getStatus());
  });

  app.post("/midi/refresh", enforceWriteAccess, (_req, res) => {
    const result = midiManager.refreshStatus();
    res.json(result.status || midiManager.getStatus());
  });

  app.post("/midi/config", enforceWriteAccess, (req, res) => {
    const result = midiManager.patchConfig(getRequestMap(req.body));
    if (!result.ok) {
      toCompatError(res, 400, String(result.error || "invalid_midi_config"));
      return;
    }
    res.json(result.status || midiManager.getStatus());
  });

  app.post("/midi/learn/cancel", enforceWriteAccess, (_req, res) => {
    const result = midiManager.cancelLearn();
    res.json(result.status || midiManager.getStatus());
  });

  app.post("/midi/learn/:action", enforceWriteAccess, (req, res) => {
    const result = midiManager.armLearn(req.params.action);
    if (!result.ok) {
      toCompatError(res, 400, String(result.error || "invalid_midi_action"), String(result.action || ""));
      return;
    }
    res.json(result.status || midiManager.getStatus());
  });

  app.post("/midi/trigger/:action", enforceWriteAccess, (req, res) => {
    const result = midiManager.triggerAction(req.params.action);
    if (!result.ok) {
      toCompatError(res, 400, String(result.error || "invalid_midi_action"), String(result.action || ""));
      return;
    }
    res.json(result.status || midiManager.getStatus());
  });

  app.post("/midi/bindings/reset", enforceWriteAccess, (_req, res) => {
    const result = midiManager.resetBindings();
    res.json(result.status || midiManager.getStatus());
  });

  app.post("/midi/bindings/:action", enforceWriteAccess, (req, res) => {
    const result = midiManager.saveBinding(req.params.action, getRequestMap(req.body));
    if (!result.ok) {
      toCompatError(res, 400, String(result.error || "invalid_midi_action"), String(result.action || ""));
      return;
    }
    res.json(result.status || midiManager.getStatus());
  });

  app.delete("/midi/bindings/:action", enforceWriteAccess, (req, res) => {
    const result = midiManager.clearBinding(req.params.action);
    if (!result.ok) {
      toCompatError(res, 400, String(result.error || "invalid_midi_action"), String(result.action || ""));
      return;
    }
    res.json(result.status || midiManager.getStatus());
  });
};
