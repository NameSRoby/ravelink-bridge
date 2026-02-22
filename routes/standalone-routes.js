// [TITLE] Module: routes/standalone-routes.js
// [TITLE] Purpose: standalone fixture routes

module.exports = function registerStandaloneRoutes(app, deps = {}) {
  const {
    standaloneStateRateLimit,
    buildStandaloneSnapshotList,
    buildStandaloneSnapshotById,
    applyStandaloneStateById
  } = deps;

  if (typeof app?.get !== "function" || typeof app?.post !== "function") {
    throw new Error("registerStandaloneRoutes requires an express app instance");
  }
  if (typeof buildStandaloneSnapshotList !== "function") {
    throw new Error("registerStandaloneRoutes requires buildStandaloneSnapshotList()");
  }
  if (typeof buildStandaloneSnapshotById !== "function") {
    throw new Error("registerStandaloneRoutes requires buildStandaloneSnapshotById()");
  }
  if (typeof applyStandaloneStateById !== "function") {
    throw new Error("registerStandaloneRoutes requires applyStandaloneStateById()");
  }

  app.get("/fixtures/standalone", (_, res) => {
    res.json({
      ok: true,
      fixtures: buildStandaloneSnapshotList()
    });
  });

  app.get("/fixtures/standalone/custom", (_, res) => {
    const fixtures = buildStandaloneSnapshotList().filter(entry => entry?.customEnabled === true);
    res.json({
      ok: true,
      total: fixtures.length,
      fixtures
    });
  });

  app.get("/fixtures/standalone/fixture/:id", (req, res) => {
    const id = String(req.params.id || "").trim();
    if (!id) {
      res.status(400).json({ ok: false, error: "missing fixture id" });
      return;
    }
    const fixture = buildStandaloneSnapshotById(id);
    if (!fixture) {
      res.status(404).json({ ok: false, error: "standalone fixture not found", id });
      return;
    }
    res.json({ ok: true, fixture });
  });

  app.post("/fixtures/standalone/state", standaloneStateRateLimit, async (req, res) => {
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const id = String(payload.id || "").trim();
    if (!id) {
      res.status(400).json({ ok: false, error: "missing fixture id" });
      return;
    }

    const patchSource = payload.state && typeof payload.state === "object"
      ? payload.state
      : payload;
    const patch = { ...patchSource };
    delete patch.id;

    const result = await applyStandaloneStateById(id, patch);
    const status = Number(result.status) || (result.ok ? 200 : 400);
    res.status(status).json(result);
  });

  app.post("/fixtures/standalone/state/batch", standaloneStateRateLimit, async (req, res) => {
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const rawUpdates = Array.isArray(payload.updates) ? payload.updates : null;
    let updates = [];

    if (rawUpdates) {
      updates = rawUpdates
        .map(item => {
          const id = String(item?.id || "").trim();
          const statePatch = item?.state && typeof item.state === "object"
            ? item.state
            : (item && typeof item === "object" ? item : {});
          return { id, state: statePatch };
        })
        .filter(item => item.id);
    } else {
      const ids = Array.isArray(payload.ids)
        ? payload.ids.map(item => String(item || "").trim()).filter(Boolean)
        : [];
      const statePatch = payload.state && typeof payload.state === "object"
        ? payload.state
        : {};
      updates = ids.map(id => ({ id, state: statePatch }));
    }

    if (!updates.length) {
      res.status(400).json({
        ok: false,
        error: "missing updates",
        expected: {
          updates: [{ id: "fixture-id", state: {} }],
          or: { ids: ["fixture-id"], state: {} }
        }
      });
      return;
    }

    const results = await Promise.all(
      updates.map(async item => {
        const result = await applyStandaloneStateById(item.id, item.state || {});
        return { id: item.id, ...result };
      })
    );

    const failed = results.filter(result => result?.ok !== true);
    res.status(failed.length ? 207 : 200).json({
      ok: failed.length === 0,
      total: results.length,
      failed: failed.length,
      results
    });
  });
};
