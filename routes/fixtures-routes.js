// [TITLE] Module: routes/fixtures-routes.js
// [TITLE] Purpose: fixture route registration

module.exports = function registerFixturesRoutes(app, deps = {}) {
  const {
    fixturesReadRateLimit,
    fixtureRegistry,
    refreshWizAdapters,
    syncStandaloneRuntime,
    prunePaletteFixtureOverrides,
    pruneFixtureMetricRoutingOverrides,
    pruneConnectivityCache,
    queueFixtureConnectivityProbe,
    getConnectivitySnapshotForFixtures,
    summarizeConnectivityResults,
    buildStandaloneSnapshotList,
    buildFixtureModeInteroperabilityReport,
    setHueTransportMode,
    getHueTransportDesired,
    fixtureConnectivityCache,
    fixtureConnectivityInFlight
  } = deps;

  if (typeof app?.get !== "function" || typeof app?.post !== "function" || typeof app?.delete !== "function") {
    throw new Error("registerFixturesRoutes requires an express app instance");
  }
  if (!fixtureRegistry || typeof fixtureRegistry.getFixtures !== "function") {
    throw new Error("registerFixturesRoutes requires fixtureRegistry");
  }

  const applyFixtureRefresh = () => {
    refreshWizAdapters();
    syncStandaloneRuntime();
  };

  const setHueToDesiredMode = async () => {
    const desired = typeof getHueTransportDesired === "function"
      ? getHueTransportDesired()
      : undefined;
    await setHueTransportMode(desired);
  };

  app.get("/fixtures", fixturesReadRateLimit, (_, res) => {
    applyFixtureRefresh();
    const fixtures = fixtureRegistry.getFixtures();
    prunePaletteFixtureOverrides(fixtures);
    pruneFixtureMetricRoutingOverrides(fixtures);
    pruneConnectivityCache(fixtures);
    for (const fixture of fixtures) {
      queueFixtureConnectivityProbe(fixture, { force: false, logChanges: true }).catch(() => {});
    }
    const connectivity = getConnectivitySnapshotForFixtures(fixtures);
    res.json({
      fixtures,
      routes: fixtureRegistry.getIntentRoutes(),
      summary: fixtureRegistry.summary(),
      standalone: buildStandaloneSnapshotList(),
      connectivity,
      connectivitySummary: summarizeConnectivityResults(connectivity)
    });
  });

  app.get("/fixtures/config", (_, res) => {
    res.json({
      ok: true,
      config: fixtureRegistry.getConfig()
    });
  });

  app.get("/fixtures/modes/verify", (req, res) => {
    const verbose = String(req.query.verbose || "").trim() === "1";
    const report = buildFixtureModeInteroperabilityReport({ verbose });
    res.status(report.ok ? 200 : 409).json(report);
  });

  app.post("/fixtures/fixture", async (req, res) => {
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const replaceId = String(payload.replaceId ?? payload.originalId ?? "").trim();
    const fixturePayload = { ...payload };
    delete fixturePayload.replaceId;
    delete fixturePayload.originalId;
    const result = fixtureRegistry.upsertFixture(fixturePayload, { replaceId });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }

    applyFixtureRefresh();
    queueFixtureConnectivityProbe(result.fixture, { force: true, logChanges: true }).catch(() => {});
    await setHueToDesiredMode();
    res.json({
      ok: true,
      fixture: result.fixture,
      summary: fixtureRegistry.summary()
    });
  });

  const removeFixtureResponder = async (id, res) => {
    const fixtureId = String(id || "").trim();
    const result = fixtureRegistry.removeFixture(id);
    if (!result.ok) {
      res.status(404).json(result);
      return;
    }

    if (fixtureId) {
      fixtureConnectivityCache.delete(fixtureId);
      fixtureConnectivityInFlight.delete(fixtureId);
    }
    applyFixtureRefresh();
    await setHueToDesiredMode();
    res.json({
      ok: true,
      summary: fixtureRegistry.summary()
    });
  };

  app.delete("/fixtures/fixture", async (req, res) => {
    const id = req.query.id || (req.body && req.body.id);
    await removeFixtureResponder(id, res);
  });

  // Fallback for clients/environments where DELETE is blocked.
  app.post("/fixtures/fixture/delete", async (req, res) => {
    const id = (req.body && req.body.id) || req.query.id;
    await removeFixtureResponder(id, res);
  });

  app.post("/fixtures/route", async (req, res) => {
    res.status(410).json({
      ok: false,
      error: "deprecated_route_api",
      detail: "/fixtures/route is deprecated. Intent routes are now derived automatically from fixture mode flags.",
      routes: fixtureRegistry.getIntentRoutes(),
      summary: fixtureRegistry.summary()
    });
  });

  app.post("/fixtures/reload", async (_, res) => {
    const ok = fixtureRegistry.reload();
    applyFixtureRefresh();
    const fixtures = fixtureRegistry.getFixtures();
    pruneConnectivityCache(fixtures);
    for (const fixture of fixtures) {
      queueFixtureConnectivityProbe(fixture, { force: false, logChanges: true }).catch(() => {});
    }
    await setHueToDesiredMode();
    res.status(ok ? 200 : 500).json({
      ok,
      summary: fixtureRegistry.summary()
    });
  });
};
