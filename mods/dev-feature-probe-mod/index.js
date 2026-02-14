// [TITLE] Module: mods/dev-feature-probe-mod/index.js
// [TITLE] Purpose: index

module.exports = function createDevFeatureProbeMod(api) {
  const stats = {
    loadedAt: Date.now(),
    intentsSeen: 0,
    raveStarts: 0,
    raveStops: 0,
    lastAction: "none",
    lastActionAt: 0
  };

  function markAction(name) {
    stats.lastAction = String(name || "unknown");
    stats.lastActionAt = Date.now();
  }

  function getCustomFixtures() {
    const fixtures = Array.isArray(api.getStandaloneFixtures?.())
      ? api.getStandaloneFixtures()
      : [];
    return fixtures.filter(fixture =>
      fixture &&
      fixture.enabled !== false &&
      fixture.customEnabled === true &&
      (fixture.brand === "hue" || fixture.brand === "wiz")
    );
  }

  function pickTargetFixture(request) {
    const fixtures = getCustomFixtures();
    const requestedId = String(
      request?.query?.id ??
      request?.query?.fixtureId ??
      request?.body?.id ??
      request?.body?.fixtureId ??
      ""
    ).trim();

    if (!fixtures.length) {
      return {
        ok: false,
        status: 404,
        error: "no custom-enabled hue/wiz fixtures found",
        fixtures,
        requestedId
      };
    }

    if (!requestedId) {
      return { ok: true, fixtures, target: fixtures[0], requestedId: "" };
    }

    const target = fixtures.find(fixture => String(fixture?.id || "") === requestedId);
    if (!target) {
      return {
        ok: false,
        status: 404,
        error: `custom fixture not found: ${requestedId}`,
        fixtures,
        requestedId
      };
    }

    return { ok: true, fixtures, target, requestedId };
  }

  function getStatePatchFromRequest(request) {
    const body = request?.body;
    if (!body || typeof body !== "object") return {};
    const fromState = body?.state;
    if (fromState && typeof fromState === "object" && !Array.isArray(fromState)) {
      return fromState;
    }
    if (Array.isArray(body)) return {};
    return body;
  }

  async function applyToTargetFixture(request, statePatch) {
    const picked = pickTargetFixture(request);
    if (!picked.ok) return picked;
    const target = picked.target;
    if (!target) {
      return {
        ok: false,
        status: 404,
        error: "no custom-enabled hue/wiz fixtures found",
        fixtures: picked.fixtures,
        requestedId: picked.requestedId
      };
    }

    const result = await api.applyStandaloneState(target.id, statePatch);
    return {
      ok: Boolean(result?.ok),
      status: Number(result?.status) || (result?.ok ? 200 : 500),
      target: target.id,
      targetBrand: target.brand,
      requestedId: picked.requestedId,
      result
    };
  }

  return {
    onLoad() {
      api.log("dev-feature-probe-mod loaded");
    },

    onRaveStart() {
      stats.raveStarts += 1;
    },

    onRaveStop() {
      stats.raveStops += 1;
    },

    onIntent(payload) {
      if (!payload?.intent) return;
      stats.intentsSeen += 1;
    },

    async onHttp(request) {
      const action = String(request?.action || "status").trim().toLowerCase() || "status";
      markAction(action);

      if (action === "status") {
        return {
          status: 200,
          body: {
            ok: true,
            mod: "dev-feature-probe-mod",
            stats,
            customFixtures: getCustomFixtures(),
            colorConfig: api.getColorCommandConfig?.() || null,
            engine: api.getEngineTelemetry?.() || null,
            allowed: [
              "status",
              "standalone_list",
              "standalone_flash",
              "standalone_static",
              "standalone_audio",
              "standalone_apply",
              "standalone_batch",
              "prefix_get",
              "prefix_set",
              "prefix_sync",
              "prefix_reset",
              "selftest"
            ]
          }
        };
      }

      if (action === "standalone_list") {
        return {
          status: 200,
          body: {
            ok: true,
            fixtures: getCustomFixtures()
          }
        };
      }

      if (action === "standalone_flash") {
        const applied = await applyToTargetFixture(request, {
          on: true,
          mode: "scene",
          scene: "pulse",
          speedMode: "fixed",
          speedHz: 2.4,
          static: false,
          updateOnRaveStop: false,
          colorMode: "hsv",
          hueMin: 0,
          hueMax: 45,
          satMin: 70,
          satMax: 100,
          bri: 88,
          transitionMs: 120
        });
        return {
          status: applied.status,
          body: { ok: applied.ok, action, ...applied }
        };
      }

      if (action === "standalone_static") {
        const applied = await applyToTargetFixture(request, {
          on: true,
          mode: "rgb",
          static: true,
          updateOnRaveStop: true,
          colorMode: "cct",
          cctKelvin: 4200,
          bri: 65,
          transitionMs: 260
        });
        return {
          status: applied.status,
          body: { ok: applied.ok, action, ...applied }
        };
      }

      if (action === "standalone_audio") {
        const applied = await applyToTargetFixture(request, {
          on: true,
          mode: "scene",
          scene: "flow",
          speedMode: "audio",
          speedHzMin: 0.8,
          speedHzMax: 4.2,
          static: false,
          updateOnRaveStop: true,
          colorMode: "hsv",
          hueMin: 180,
          hueMax: 320,
          satMin: 45,
          satMax: 100,
          bri: 75,
          transitionMs: 200
        });
        return {
          status: applied.status,
          body: { ok: applied.ok, action, ...applied }
        };
      }

      if (action === "standalone_apply") {
        const patch = getStatePatchFromRequest(request);
        if (!patch || typeof patch !== "object" || !Object.keys(patch).length) {
          return {
            status: 400,
            body: { ok: false, action, error: "missing state patch in body.state" }
          };
        }
        const applied = await applyToTargetFixture(request, patch);
        return {
          status: applied.status,
          body: { ok: applied.ok, action, ...applied, patch }
        };
      }

      if (action === "standalone_batch") {
        const patch = getStatePatchFromRequest(request);
        if (!patch || typeof patch !== "object" || !Object.keys(patch).length) {
          return {
            status: 400,
            body: { ok: false, action, error: "missing state patch in body.state" }
          };
        }

        const fixtures = getCustomFixtures();
        const requestedIds = Array.isArray(request?.body?.ids)
          ? request.body.ids.map(id => String(id || "").trim()).filter(Boolean)
          : [];
        const targets = requestedIds.length
          ? fixtures.filter(fixture => requestedIds.includes(String(fixture?.id || "")))
          : fixtures;

        if (!targets.length) {
          return {
            status: 404,
            body: { ok: false, action, error: "no matching custom fixtures found", fixtures }
          };
        }

        const results = [];
        for (const fixture of targets) {
          const result = await api.applyStandaloneState(fixture.id, patch);
          results.push({
            id: fixture.id,
            brand: fixture.brand,
            ok: Boolean(result?.ok),
            status: Number(result?.status) || (result?.ok ? 200 : 500),
            result
          });
        }

        const failures = results.filter(item => !item.ok);
        return {
          status: failures.length ? 207 : 200,
          body: {
            ok: failures.length === 0,
            action,
            patch,
            requestedIds,
            targets: targets.map(item => item.id),
            results
          }
        };
      }

      if (action === "prefix_get") {
        return {
          status: 200,
          body: {
            ok: true,
            action,
            config: api.getColorCommandConfig?.() || null
          }
        };
      }

      if (action === "prefix_set") {
        const patch = request?.body && typeof request.body === "object"
          ? request.body
          : {};
        const config = api.setColorCommandConfig?.(patch);
        return {
          status: 200,
          body: { ok: true, action, patch, config }
        };
      }

      if (action === "prefix_sync") {
        const config = api.setColorCommandConfig?.({
          defaultTarget: "both",
          prefixes: {
            hue: "",
            wiz: "",
            other: ""
          }
        });
        return {
          status: 200,
          body: {
            ok: true,
            action,
            config
          }
        };
      }

      if (action === "prefix_reset") {
        const config = api.setColorCommandConfig?.({
          defaultTarget: "hue",
          prefixes: {
            hue: "hue",
            wiz: "wiz",
            other: ""
          }
        });
        return {
          status: 200,
          body: {
            ok: true,
            action,
            config
          }
        };
      }

      if (action === "selftest") {
        const prefix = api.setColorCommandConfig?.({
          defaultTarget: "both",
          prefixes: {
            hue: "",
            wiz: "",
            other: ""
          }
        });
        const customApply = await applyToTargetFixture(request, {
          on: true,
          mode: "scene",
          scene: "spark",
          speedMode: "audio",
          speedHzMin: 1.2,
          speedHzMax: 5.5,
          static: false,
          updateOnRaveStop: true,
          colorMode: "hsv",
          hueMin: 10,
          hueMax: 300,
          satMin: 55,
          satMax: 100,
          bri: 82,
          transitionMs: 180
        });
        return {
          status: customApply.status,
          body: {
            ok: customApply.ok,
            action,
            prefix,
            customApply
          }
        };
      }

      return {
        status: 400,
        body: {
          ok: false,
          error: "unknown action",
          action
        }
      };
    }
  };
};
