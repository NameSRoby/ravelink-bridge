// [TITLE] Module: routes/fixtures-connectivity-routes.js
// [TITLE] Purpose: fixture connectivity route registration

module.exports = function registerFixturesConnectivityRoutes(app, deps = {}) {
  const {
    fixturesConnectivityRateLimit,
    fixtureRegistry,
    pruneConnectivityCache,
    queueFixtureConnectivityProbe,
    getConnectivitySnapshotForFixtures,
    summarizeConnectivityResults
  } = deps;

  if (typeof app?.get !== "function" || typeof app?.post !== "function") {
    throw new Error("registerFixturesConnectivityRoutes requires an express app instance");
  }
  if (!fixtureRegistry || typeof fixtureRegistry.getFixtures !== "function") {
    throw new Error("registerFixturesConnectivityRoutes requires fixtureRegistry.getFixtures()");
  }
  if (typeof pruneConnectivityCache !== "function") {
    throw new Error("registerFixturesConnectivityRoutes requires pruneConnectivityCache()");
  }
  if (typeof queueFixtureConnectivityProbe !== "function") {
    throw new Error("registerFixturesConnectivityRoutes requires queueFixtureConnectivityProbe()");
  }
  if (typeof getConnectivitySnapshotForFixtures !== "function") {
    throw new Error("registerFixturesConnectivityRoutes requires getConnectivitySnapshotForFixtures()");
  }
  if (typeof summarizeConnectivityResults !== "function") {
    throw new Error("registerFixturesConnectivityRoutes requires summarizeConnectivityResults()");
  }

  const filterFixtures = ({ fixtureId = "", brand = "" } = {}) => {
    const allFixtures = fixtureRegistry.getFixtures();
    pruneConnectivityCache(allFixtures);
    return allFixtures.filter(fixture => {
      if (fixtureId && String(fixture?.id || "").trim() !== fixtureId) return false;
      if (brand && String(fixture?.brand || "").trim().toLowerCase() !== brand) return false;
      return true;
    });
  };

  app.get("/fixtures/connectivity", fixturesConnectivityRateLimit, (req, res) => {
    const fixtureId = String(req.query.id || "").trim();
    const brand = String(req.query.brand || "").trim().toLowerCase();
    const force = String(req.query.force || "").trim() === "1";
    const timeoutMs = Math.max(300, Math.min(5000, Number(req.query.timeoutMs) || 1200));
    const fixtures = filterFixtures({ fixtureId, brand });

    if (!fixtures.length) {
      res.status(404).json({ ok: false, error: "no fixtures matched" });
      return;
    }

    const task = force
      ? Promise.all(fixtures.map(fixture => queueFixtureConnectivityProbe(fixture, { force: true, timeoutMs, logChanges: true })))
      : Promise.resolve(getConnectivitySnapshotForFixtures(fixtures));

    task
      .then(results => {
        const normalized = (results || []).filter(Boolean);
        res.json({
          ok: true,
          results: normalized,
          summary: summarizeConnectivityResults(normalized)
        });
      })
      .catch(err => {
        res.status(500).json({
          ok: false,
          error: err.message || String(err)
        });
      });
  });

  app.post("/fixtures/connectivity/test", fixturesConnectivityRateLimit, async (req, res) => {
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const fixtureId = String(payload.id || "").trim();
    const brand = String(payload.brand || "").trim().toLowerCase();
    const timeoutMs = Math.max(300, Math.min(5000, Number(payload.timeoutMs) || 1200));
    const fixtures = filterFixtures({ fixtureId, brand });

    if (!fixtures.length) {
      res.status(404).json({ ok: false, error: "no fixtures matched" });
      return;
    }

    const results = await Promise.all(
      fixtures.map(fixture => queueFixtureConnectivityProbe(fixture, { force: true, timeoutMs, logChanges: true }))
    );

    const normalized = results.filter(Boolean);
    res.json({
      ok: true,
      results: normalized,
      summary: summarizeConnectivityResults(normalized)
    });
  });
};
