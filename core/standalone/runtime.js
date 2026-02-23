// [TITLE] Module: core/standalone/runtime.js
// [TITLE] Purpose: standalone runtime orchestration (state/timers/adapters/send)

module.exports = function createStandaloneRuntime(deps = {}) {
  const {
    fixtureRegistry,
    createWizAdapter,
    axios,
    getHueHttpsAgentForFixture,
    parseBoolean,
    normalizeStandaloneState,
    nextStandaloneAnimatedState,
    toHueTransitionTime,
    toHueBrightness,
    hsvToRgb,
    listStandaloneFixtures,
    getStandaloneFixtureById,
    getStandalonePersistedState,
    hasStandalonePersistedState,
    persistStandaloneStateForFixture,
    wait,
    log = console
  } = deps;

  const standaloneStates = new Map();
  const standaloneTimers = new Map();
  const standaloneInFlight = new Set();
  const standaloneWizAdapters = new Map();

  function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function getStandaloneWizAdapter(fixture) {
    if (!fixture || fixture.brand !== "wiz") return null;
    if (
      typeof fixtureRegistry.isWizFixtureConfigured === "function" &&
      !fixtureRegistry.isWizFixtureConfigured(fixture)
    ) {
      return null;
    }
    const id = String(fixture.id || "").trim();
    if (!id) return null;

    const existing = standaloneWizAdapters.get(id);
    if (existing && existing.ip === fixture.ip) {
      return existing.send;
    }

    if (existing) {
      try {
        existing.send.close?.();
      } catch {}
      standaloneWizAdapters.delete(id);
    }

    const send = createWizAdapter({ ip: fixture.ip });
    standaloneWizAdapters.set(id, { id, ip: fixture.ip, send });
    return send;
  }

  function closeStandaloneWizAdapter(id) {
    const key = String(id || "").trim();
    const existing = standaloneWizAdapters.get(key);
    if (!existing) return;
    try {
      existing.send.close?.();
    } catch {}
    standaloneWizAdapters.delete(key);
  }

  function stopStandaloneTimer(id) {
    const key = String(id || "").trim();
    const current = standaloneTimers.get(key);
    if (current) {
      clearInterval(current.handle);
      standaloneTimers.delete(key);
    }
  }

  function startStandaloneTimer(fixture, state) {
    const id = String(fixture?.id || "").trim();
    if (!id) return;
    const engineEnabled = parseBoolean(fixture?.engineEnabled, false);
    if (engineEnabled) {
      stopStandaloneTimer(id);
      return;
    }
    if (!state?.animate || state?.static || fixture.enabled === false) {
      stopStandaloneTimer(id);
      return;
    }

    const mode = String(state?.mode || "").trim().toLowerCase();
    const intervalSeedHz = mode === "auto"
      ? 8
      : (
        String(state?.speedMode || "").trim().toLowerCase() === "audio"
          ? clampNumber(state?.speedHzMax, 0.2, 12, 3.2)
          : clampNumber(state?.speedHz, 0.2, 12, 1.2)
      );
    const intervalMs = Math.round(
      clampNumber(1000 / Math.max(0.2, Number(intervalSeedHz) || 1), 80, 2000, 833)
    );
    const existing = standaloneTimers.get(id);
    if (existing && existing.intervalMs === intervalMs) {
      return;
    }
    if (existing) {
      clearInterval(existing.handle);
      standaloneTimers.delete(id);
    }

    const handle = setInterval(async () => {
      if (standaloneInFlight.has(id)) return;

      const liveFixture = getStandaloneFixtureById(id);
      if (!liveFixture || liveFixture.enabled === false) {
        stopStandaloneTimer(id);
        return;
      }
      const liveEngineEnabled = parseBoolean(liveFixture.engineEnabled, false);
      if (liveEngineEnabled) {
        stopStandaloneTimer(id);
        return;
      }

      const current = standaloneStates.get(id);
      if (!current || !current.animate || current.static) {
        stopStandaloneTimer(id);
        return;
      }

      const nextState = nextStandaloneAnimatedState(liveFixture, current, intervalMs);
      standaloneStates.set(id, nextState);

      standaloneInFlight.add(id);
      try {
        await sendStandaloneState(liveFixture, nextState);
      } catch {}
      standaloneInFlight.delete(id);
    }, intervalMs);

    standaloneTimers.set(id, { handle, intervalMs });
  }

  function buildStandaloneSnapshot(fixture) {
    const id = String(fixture?.id || "").trim();
    const current = standaloneStates.get(id) || normalizeStandaloneState({}, null, fixture?.brand);
    const target = fixture?.brand === "hue"
      ? `${fixture.bridgeIp || "-"} / light ${fixture.lightId || "-"}`
      : (fixture?.ip || "-");
    const engineEnabled = parseBoolean(fixture?.engineEnabled, false);
    const twitchEnabled = parseBoolean(fixture?.twitchEnabled, false);
    const customEnabled = parseBoolean(fixture?.customEnabled, false);

    return {
      id,
      brand: fixture.brand,
      zone: fixture.zone || "",
      enabled: fixture.enabled !== false,
      controlMode: engineEnabled ? "engine" : "standalone",
      engineBinding: fixture.engineBinding || (engineEnabled ? fixture.brand : "standalone"),
      engineEnabled,
      twitchEnabled,
      customEnabled,
      target,
      supportsCct: fixture?.brand === "wiz" || fixture?.brand === "hue",
      animating: standaloneTimers.has(id),
      state: { ...current }
    };
  }

  function syncStandaloneRuntime() {
    const fixtures = listStandaloneFixtures();
    const nextIds = new Set(fixtures.map(f => String(f.id || "").trim()).filter(Boolean));

    for (const id of standaloneStates.keys()) {
      if (!nextIds.has(id)) {
        standaloneStates.delete(id);
      }
    }

    for (const id of standaloneTimers.keys()) {
      if (!nextIds.has(id)) {
        stopStandaloneTimer(id);
      }
    }

    for (const id of standaloneWizAdapters.keys()) {
      if (!nextIds.has(id)) {
        closeStandaloneWizAdapter(id);
      }
    }

    for (const fixture of fixtures) {
      const id = String(fixture.id || "").trim();
      if (!id) continue;
      const current = standaloneStates.get(id);
      const persisted = current ? null : getStandalonePersistedState(id);
      const next = normalizeStandaloneState({}, current || persisted, fixture.brand);
      standaloneStates.set(id, next);

      if (fixture.brand === "wiz" && fixture.enabled !== false) {
        getStandaloneWizAdapter(fixture);
      } else {
        closeStandaloneWizAdapter(id);
      }

      if (fixture.enabled === false || !next.animate) {
        stopStandaloneTimer(id);
      } else {
        startStandaloneTimer(fixture, next);
      }
    }
  }

  function buildStandaloneSnapshotList() {
    syncStandaloneRuntime();
    return listStandaloneFixtures().map(buildStandaloneSnapshot);
  }

  function buildStandaloneSnapshotById(id) {
    const fixtureId = String(id || "").trim();
    if (!fixtureId) return null;
    syncStandaloneRuntime();
    const fixture = getStandaloneFixtureById(fixtureId);
    if (!fixture) return null;
    return buildStandaloneSnapshot(fixture);
  }

  function kelvinToHueCt(kelvin) {
    const tempK = clampNumber(kelvin, 1200, 9000, 3200);
    const mired = Math.round(1000000 / Math.max(1, tempK));
    return Math.max(153, Math.min(500, mired));
  }

  async function sendStandaloneState(fixture, state) {
    if (!fixture || !state) {
      return { ok: false, error: "invalid fixture/state" };
    }

    if (fixture.brand === "hue") {
      const isReady =
        typeof fixtureRegistry.isHueFixtureConfigured === "function"
          ? fixtureRegistry.isHueFixtureConfigured(fixture)
          : Boolean(fixture.bridgeIp && fixture.username && fixture.lightId);
      if (!isReady) {
        return { ok: false, error: "missing hue bridgeIp/username/lightId" };
      }

      const hue360 = ((state.hue % 360) + 360) % 360;
      const payload = {
        on: Boolean(state.on),
        transitiontime: toHueTransitionTime(state.transitionMs)
      };

      if (payload.on) {
        payload.bri = toHueBrightness(state.bri);
        if (String(state.colorMode || "").trim().toLowerCase() === "cct") {
          payload.ct = kelvinToHueCt(state.cctKelvin);
        } else {
          payload.hue = Math.round((hue360 / 360) * 65535);
          payload.sat = clampNumber(Math.round((state.sat / 100) * 254), 0, 254, 203);
        }
      }

      try {
        const requestOptions = {
          timeout: 1800
        };
        if (typeof getHueHttpsAgentForFixture === "function") {
          const httpsAgent = getHueHttpsAgentForFixture(fixture);
          if (httpsAgent) {
            requestOptions.httpsAgent = httpsAgent;
          }
        }
        await axios.put(
          `https://${fixture.bridgeIp}/api/${fixture.username}/lights/${fixture.lightId}/state`,
          payload,
          requestOptions
        );
        return { ok: true, transport: "hue-rest" };
      } catch (err) {
        return { ok: false, error: err.message || String(err) };
      }
    }

    if (fixture.brand === "wiz") {
      const isReady =
        typeof fixtureRegistry.isWizFixtureConfigured === "function"
          ? fixtureRegistry.isWizFixtureConfigured(fixture)
          : Boolean(fixture.ip);
      if (!isReady) {
        return { ok: false, error: "missing wiz ip" };
      }

      const send = getStandaloneWizAdapter(fixture);
      if (!send) {
        return { ok: false, error: "wiz fixture adapter unavailable" };
      }
      const colorMode = String(state.colorMode || "").trim().toLowerCase();
      const wizState = {
        on: Boolean(state.on),
        dimming: state.on ? clampNumber(Math.round(state.bri), 1, 100, 70) : 1
      };

      if (state.on && colorMode === "cct") {
        wizState.temp = clampNumber(Math.round(state.cctKelvin), 2200, 6500, 4000);
      } else if (state.on) {
        const rgb = hsvToRgb(state.hue, state.sat, 100);
        wizState.r = rgb.r;
        wizState.g = rgb.g;
        wizState.b = rgb.b;
      }
      try {
        send(wizState, { repeats: 1, repeatDelayMs: 16 });
        return { ok: true, transport: "wiz-udp" };
      } catch (err) {
        return { ok: false, error: err.message || String(err) };
      }
    }

    return { ok: false, error: "unsupported fixture brand" };
  }

  async function sendStandaloneStateWithRetry(fixture, state, options = {}) {
    const attempts = Math.max(1, Math.min(3, Math.round(Number(options.attempts) || 1)));
    const delayMs = Math.max(0, Math.round(Number(options.delayMs) || 0));
    let last = { ok: false, error: "standalone send failed" };
    for (let i = 0; i < attempts; i += 1) {
      last = await sendStandaloneState(fixture, state);
      if (last?.ok) {
        return last;
      }
      if (i + 1 < attempts && delayMs > 0) {
        await wait(delayMs);
      }
    }
    return last;
  }

  async function applyStandaloneStateById(id, patch = {}) {
    syncStandaloneRuntime();

    const fixture = getStandaloneFixtureById(id);
    if (!fixture) {
      return { ok: false, status: 404, error: "standalone fixture not found" };
    }
    if (fixture.enabled === false) {
      return { ok: false, status: 409, error: "fixture is disabled", fixture: buildStandaloneSnapshot(fixture) };
    }

    const fixtureId = String(fixture.id || "").trim();
    const current = standaloneStates.get(fixtureId);
    const next = normalizeStandaloneState(patch, current, fixture.brand);
    standaloneStates.set(fixtureId, next);

    const sent = await sendStandaloneState(fixture, next);
    if (!sent.ok) {
      return { ok: false, status: 502, error: sent.error || "standalone send failed" };
    }

    persistStandaloneStateForFixture(fixtureId, next);

    if (next.animate && !next.static) startStandaloneTimer(fixture, next);
    else stopStandaloneTimer(fixtureId);

    return {
      ok: true,
      fixture: buildStandaloneSnapshot(fixture),
      transport: sent.transport
    };
  }

  async function applyStandaloneRaveStopUpdates() {
    syncStandaloneRuntime();
    const fixtures = listStandaloneFixtures().filter(f => f && f.enabled !== false);
    for (const fixture of fixtures) {
      const fixtureId = String(fixture.id || "").trim();
      if (!fixtureId) continue;
      const current = standaloneStates.get(fixtureId);
      if (!current || !current.updateOnRaveStop) continue;
      const stopBrightness = clampNumber(current.raveStopBri, 1, 100, current.bri);
      const sent = await sendStandaloneStateWithRetry(
        fixture,
        { ...current, bri: Math.round(stopBrightness) },
        { attempts: 2, delayMs: 60 }
      );
      if (!sent.ok) {
        log.warn?.(`[STANDALONE] rave-stop update skipped for ${fixtureId}: ${sent.error || "send failed"}`);
      }
    }
  }

  async function applyStandaloneStartupUpdates() {
    syncStandaloneRuntime();
    const fixtures = listStandaloneFixtures().filter(f => f && f.enabled !== false);
    for (const fixture of fixtures) {
      const fixtureId = String(fixture.id || "").trim();
      if (!fixtureId || !hasStandalonePersistedState(fixtureId)) continue;
      const current = standaloneStates.get(fixtureId);
      if (!current) continue;
      const sent = await sendStandaloneStateWithRetry(
        fixture,
        current,
        { attempts: 2, delayMs: 60 }
      );
      if (!sent.ok) {
        log.warn?.(`[STANDALONE] startup reapply skipped for ${fixtureId}: ${sent.error || "send failed"}`);
      }
    }
  }

  async function applyStandaloneRaveStartUpdates() {
    syncStandaloneRuntime();
    const fixtures = listStandaloneFixtures().filter(f => f && f.enabled !== false);
    for (const fixture of fixtures) {
      const fixtureId = String(fixture.id || "").trim();
      if (!fixtureId) continue;
      const current = standaloneStates.get(fixtureId);
      if (!current || !current.updateOnRaveStart) continue;
      const sent = await sendStandaloneStateWithRetry(
        fixture,
        current,
        { attempts: 2, delayMs: 60 }
      );
      if (!sent.ok) {
        log.warn?.(`[STANDALONE] rave-start update skipped for ${fixtureId}: ${sent.error || "send failed"}`);
      }
    }
  }

  function getStateById(id) {
    const fixtureId = String(id || "").trim();
    if (!fixtureId) return null;
    return standaloneStates.get(fixtureId) || null;
  }

  function shutdown() {
    for (const id of standaloneTimers.keys()) {
      stopStandaloneTimer(id);
    }
    for (const id of standaloneWizAdapters.keys()) {
      closeStandaloneWizAdapter(id);
    }
  }

  return {
    getStandaloneWizAdapter,
    closeStandaloneWizAdapter,
    stopStandaloneTimer,
    startStandaloneTimer,
    buildStandaloneSnapshot,
    buildStandaloneSnapshotList,
    buildStandaloneSnapshotById,
    syncStandaloneRuntime,
    sendStandaloneState,
    sendStandaloneStateWithRetry,
    applyStandaloneStateById,
    applyStandaloneRaveStopUpdates,
    applyStandaloneStartupUpdates,
    applyStandaloneRaveStartUpdates,
    getStateById,
    shutdown
  };
};
