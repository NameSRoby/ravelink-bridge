// [TITLE] Test Module: test/http-preengine-smoke.test.js
// [TITLE] Purpose: end-to-end HTTP smoke coverage for pre-engine baseline

const test = require("node:test");
const assert = require("node:assert/strict");

const { bootHttpTestServer } = require("../scripts/test-support/http-test-server");

function withEnv(overrides, run) {
  const previous = {};
  for (const [key, value] of Object.entries(overrides || {})) {
    previous[key] = process.env[key];
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }
  const restore = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
  try {
    return run();
  } finally {
    restore();
  }
}

test("pre-engine HTTP smoke keeps UI/live/twitch/audio/rave routes operational", async (t) => {
  await withEnv({
    RAVELINK_ALLOW_REMOTE_WRITE: "1",
    RAVELINK_ENABLE_LEGACY_COLOR_GET: "0",
    RAVELINK_DRY_RUN_TRANSPORT: "1"
  }, async () => {
    const server = await bootHttpTestServer();
    t.after(async () => {
      await server.close();
    });

    const health = await server.requestJson("GET", "/health");
    assert.equal(health.status, 200);
    assert.equal(health.data?.ok, true);
    assert.equal(health.data?.liveTab?.mode, "full");

    const index = await server.requestText("GET", "/");
    assert.equal(index.status, 200);
    assert.equal(index.text.includes("RAVELINK"), true);
    assert.equal(index.text.includes("data-tab=\"live\""), true);
    assert.equal(index.text.includes("data-tab=\"fixtures\""), true);
    assert.equal(index.text.includes("data-tab=\"audio\""), true);
    assert.equal(index.text.includes("data-tab=\"midi\""), true);
    assert.equal(index.text.includes("data-tab=\"mods\""), true);
    assert.equal(index.text.includes("data-tab=\"system\""), true);

    const staticScript = await fetch(`${server.baseUrl}/assets/js/core/state.js`);
    assert.equal(staticScript.status, 200);
    assert.match(String(staticScript.headers.get("content-type") || ""), /javascript|ecmascript/i);
    assert.match(await staticScript.text(), /pollIntervalMs/);

    const staticCss = await fetch(`${server.baseUrl}/assets/css/app.css`);
    assert.equal(staticCss.status, 200);
    assert.match(String(staticCss.headers.get("content-type") || ""), /css/i);
    assert.match(await staticCss.text(), /RAVELINK|:root|body/i);

    const liveStatus = await server.requestJson("GET", "/live/status");
    assert.equal(liveStatus.status, 200);
    assert.equal(liveStatus.data?.mode, "full");
    assert.equal(liveStatus.data?.compatibility?.sceneLock, "auto");
    assert.equal(liveStatus.data?.sceneIntent, "auto");

    const systemConfig = await server.requestJson("GET", "/system/config");
    assert.equal(systemConfig.status, 200);
    assert.equal(systemConfig.data?.ok, true);
    assert.equal(typeof systemConfig.data?.config, "object");
    assert.equal(systemConfig.data?.config?.oauthSyncProfile, undefined);
    assert.equal(typeof systemConfig.data?.config?.updateChecksEnabled, "boolean");
    assert.equal(typeof systemConfig.data?.config?.updateStartupPromptEnabled, "boolean");

    const updateStatus = await server.requestJson("GET", "/system/update/status");
    assert.equal(updateStatus.status, 200);
    assert.equal(updateStatus.data?.ok, true);
    assert.equal(typeof updateStatus.data?.currentVersion, "string");
    assert.equal(typeof updateStatus.data?.preferences?.updateChecksEnabled, "boolean");

    const systemConfigPatch = await server.requestJson("POST", "/system/config", {
      autoLaunchBrowser: false,
      hueTransportPreference: "rest",
      updateChecksEnabled: false,
      updateStartupPromptEnabled: false
    });
    assert.equal(systemConfigPatch.status, 200);
    assert.equal(systemConfigPatch.data?.ok, true);
    assert.equal(systemConfigPatch.data?.config?.autoLaunchBrowser, false);
    assert.equal(systemConfigPatch.data?.config?.hueTransportPreference, "rest");
    assert.equal(systemConfigPatch.data?.config?.updateChecksEnabled, false);
    assert.equal(systemConfigPatch.data?.config?.updateStartupPromptEnabled, false);

    const oauthInitial = await server.requestJson("GET", "/system/oauth/status");
    assert.equal(oauthInitial.status, 200);
    assert.equal(oauthInitial.data?.ok, true);
    assert.equal(typeof oauthInitial.data?.hasValues, "boolean");

    const oauthSeed = await server.requestJson("POST", "/system/oauth/seed", {
      profile: {
        twitchClientId: "client-id",
        twitchUserAccessToken: "token-value",
        twitchBroadcasterId: "1234567"
      }
    });
    assert.equal(oauthSeed.status, 200);
    assert.equal(oauthSeed.data?.ok, true);
    assert.equal(oauthSeed.data?.hasValues, true);
    assert.equal(oauthSeed.data?.presence?.twitchUserAccessToken, true);

    const widgetTemplate = await server.requestJson("POST", "/system/widget-template-get", {
      baseUrl: "http://127.0.0.1:5050",
      raveActivateText: "on",
      twitchStatusSyncEnabled: true
    });
    assert.equal(widgetTemplate.status, 200);
    assert.equal(widgetTemplate.data?.ok, true);
    assert.equal(String(widgetTemplate.data?.script || "").includes("RAVELINK_WIDGET_CONFIG"), true);
    assert.equal(String(widgetTemplate.data?.script || "").includes("onEventReceived"), true);
    assert.equal(String(widgetTemplate.data?.script || "").includes("/system/widget-redemption-status"), true);
    assert.equal(String(widgetTemplate.data?.script || "").includes("buildTwitchAuthorizeUrl"), true);
    assert.equal(String(widgetTemplate.data?.script || "").includes("client-id"), true);
    assert.equal(String(widgetTemplate.data?.script || "").includes("client-secret"), false);

    const midiStatus = await server.requestJson("GET", "/midi/status");
    assert.equal(midiStatus.status, 200);
    assert.equal(midiStatus.data?.ok, true);
    assert.equal(Array.isArray(midiStatus.data?.actions), true);

    const midiConfig = await server.requestJson("POST", "/midi/config", {
      enabled: true,
      velocityThreshold: 12
    });
    assert.equal(midiConfig.status, 200);
    assert.equal(midiConfig.data?.config?.velocityThreshold, 12);

    const midiBind = await server.requestJson("POST", "/midi/bindings/scene_auto", {
      type: "note",
      number: 36
    });
    assert.equal(midiBind.status, 200);
    assert.equal(typeof midiBind.data?.config?.bindings?.scene_auto, "object");

    const midiTrigger = await server.requestJson("POST", "/midi/trigger/scene_auto");
    assert.equal(midiTrigger.status, 200);
    assert.equal(midiTrigger.data?.lastAction, "scene_auto");

    const midiClear = await server.requestJson("DELETE", "/midi/bindings/scene_auto");
    assert.equal(midiClear.status, 200);
    assert.equal(midiClear.data?.config?.bindings?.scene_auto, undefined);

    const modsSnapshot = await server.requestJson("GET", "/mods");
    assert.equal(modsSnapshot.status, 200);
    assert.equal(modsSnapshot.data?.ok, true);

    const modsUiCatalog = await server.requestJson("GET", "/mods/ui/catalog");
    assert.equal(modsUiCatalog.status, 200);
    assert.equal(modsUiCatalog.data?.ok, true);
    assert.equal(Array.isArray(modsUiCatalog.data?.mods), true);

    const importedMod = await server.requestJson("POST", "/mods/import", {
      files: [
        {
          path: "http-mod/mod.json",
          data: Buffer.from(JSON.stringify({
            id: "http-mod",
            name: "HTTP Mod",
            version: "1.0.0",
            entry: "index.js"
          }), "utf8").toString("base64")
        },
        {
          path: "http-mod/index.js",
          data: Buffer.from(
            "module.exports = { actions: { ping: ({ payload }) => ({ lane: 'ping', payload }), 'api/status': ({ payload }) => ({ lane: 'api/status', payload }) } };",
            "utf8"
          ).toString("base64")
        }
      ],
      overwrite: true,
      enableAfterImport: true,
      reload: true
    });
    assert.equal(importedMod.status, 200);
    assert.equal(importedMod.data?.ok, true);
    assert.equal(importedMod.data?.modId, "http-mod");

    const modActionPost = await server.requestJson("POST", "/mods/http-mod/ping", {
      value: 123,
      source: "smoke"
    });
    assert.equal(modActionPost.status, 200);
    assert.equal(modActionPost.data?.ok, true);
    assert.equal(modActionPost.data?.result?.lane, "ping");
    assert.equal(modActionPost.data?.result?.payload?.body?.value, 123);
    assert.equal(modActionPost.data?.result?.payload?.route?.method, "POST");

    const modNestedAction = await server.requestJson("GET", "/mods/http-mod/api/status?scope=smoke");
    assert.equal(modNestedAction.status, 200);
    assert.equal(modNestedAction.data?.ok, true);
    assert.equal(modNestedAction.data?.result?.lane, "api/status");
    assert.equal(modNestedAction.data?.result?.payload?.query?.scope, "smoke");
    assert.equal(modNestedAction.data?.result?.payload?.route?.actionPath, "api/status");

    const liveCompat = await server.requestJson("GET", "/rave/live/compatibility");
    assert.equal(liveCompat.status, 200);
    assert.equal(liveCompat.data?.ok, true);
    assert.equal(liveCompat.data?.snapshot?.sceneLock, "auto");

    const liveCompatPatch = await server.requestJson("POST", "/rave/live/compatibility", {
      sceneLock: "motion"
    });
    assert.equal(liveCompatPatch.status, 200);
    assert.equal(liveCompatPatch.data?.ok, true);
    assert.equal(liveCompatPatch.data?.applied?.sceneLock, "motion");

    const liveScenePatch = await server.requestJson("POST", "/live/scene", {
      sceneLock: "impact"
    });
    assert.equal(liveScenePatch.status, 200);
    assert.equal(liveScenePatch.data?.ok, true);
    assert.equal(liveScenePatch.data?.applied?.sceneLock, "impact");

    const liveSyncGroupsPatch = await server.requestJson("POST", "/live/sync-groups", {
      enabled: true,
      groups: [
        { id: "smoke-group", name: "Smoke Group", sequenceMode: "sync", fixtureIds: ["hue-main-1"] }
      ]
    });
    assert.equal(liveSyncGroupsPatch.status, 200);
    assert.equal(liveSyncGroupsPatch.data?.ok, true);
    assert.equal(liveSyncGroupsPatch.data?.snapshot?.enabled, true);
    const liveSyncGroups = await server.requestJson("GET", "/live/sync-groups");
    assert.equal(liveSyncGroups.status, 200);
    assert.equal(liveSyncGroups.data?.ok, true);
    assert.equal(liveSyncGroups.data?.snapshot?.groups?.[0]?.id, "smoke-group");

    const triggerMatrix = await server.requestJson("GET", "/rave/live/trigger-matrix");
    assert.equal(triggerMatrix.status, 200);
    assert.equal(triggerMatrix.data?.ok, true);

    const liveSceneTuning = await server.requestJson("GET", "/live/scene-tuning");
    assert.equal(liveSceneTuning.status, 200);
    assert.equal(liveSceneTuning.data?.ok, true);

    const triggerMatrixPatch = await server.requestJson("POST", "/live/scene-tuning", {
      override: {
        sceneFilterAggressiveness: {
          calm: 1.1,
          groove: 1.2,
          impact: 1.3
        },
        runtimeTuning: {
          bpmSourceMode: "hybrid",
          sceneSwitchCooldownMs: 320,
          impactHoldMs: 140,
          brightnessFloor: 0.04,
          brightnessCeil: 0.95,
          transitionFloorMs: 80,
          transitionCeilMs: 250,
          telemetryBeatConfidenceMin: 0.5
        }
      }
    });
    assert.equal(triggerMatrixPatch.status, 200);
    assert.equal(triggerMatrixPatch.data?.ok, true);
    assert.equal(triggerMatrixPatch.data?.global?.sceneFilterAggressiveness?.groove, 1.2);
    assert.equal(triggerMatrixPatch.data?.global?.runtimeTuning?.sceneSwitchCooldownMs, 320);

    const ravePalette = await server.requestJson("POST", "/rave/palette", {
      brand: "hue",
      hueVividness: 1.2
    });
    assert.equal(ravePalette.status, 200);
    assert.equal(ravePalette.data?.ok, true);
    assert.equal(typeof ravePalette.data?.brands?.hue, "object");
    assert.equal(ravePalette.data?.enginePaletteSync?.ok, true);
    assert.equal(ravePalette.data?.enginePaletteSync?.sequenceLength > 0, true);

    const fixtureMetrics = await server.requestJson("POST", "/rave/fixture-metrics", {
      fixtureId: "wiz-main-1",
      brand: "wiz",
      beatScale: 1.4
    });
    assert.equal(fixtureMetrics.status, 200);
    assert.equal(fixtureMetrics.data?.ok, true);
    assert.equal(typeof fixtureMetrics.data?.fixtureOverrides?.["wiz-main-1"], "object");

    const overclockTiers = await server.requestJson("GET", "/rave/overclock/tiers");
    assert.equal(overclockTiers.status, 200);
    assert.equal(overclockTiers.data?.ok, true);
    assert.equal(Array.isArray(overclockTiers.data?.tiers), true);

    const overclockPreset = await server.requestJson("POST", "/rave/overclock/turbo/on");
    assert.equal(overclockPreset.status, 200);
    assert.equal(overclockPreset.data?.ok, true);
    assert.equal(overclockPreset.data?.overclock?.level, 2);

    const overclockAuto = await server.requestJson("POST", "/rave/overclock/auto?enabled=true", {});
    assert.equal(overclockAuto.status, 200);
    assert.equal(overclockAuto.data?.ok, true);
    assert.equal(overclockAuto.data?.overclock?.autoEnabled, true);

    const fixturesSnapshot = await server.requestJson("GET", "/fixtures");
    assert.equal(fixturesSnapshot.status, 200);
    assert.equal(fixturesSnapshot.data?.ok, true);
    assert.equal(Array.isArray(fixturesSnapshot.data?.fixtures), true);

    const fixturesConnectivity = await server.requestJson("GET", "/fixtures/connectivity");
    assert.equal(fixturesConnectivity.status, 200);
    assert.equal(fixturesConnectivity.data?.ok, true);
    assert.equal(Array.isArray(fixturesConnectivity.data?.rows), true);

    const saveProfile = await server.requestJson("POST", "/live/profiles/save", {
      name: "smoke-a",
      profile: { palette: "blue", gain: 1.1 }
    });
    assert.equal(saveProfile.status, 200);
    assert.equal(saveProfile.data?.ok, true);
    assert.equal(Array.isArray(saveProfile.data?.profiles), true);

    const loadProfile = await server.requestJson("POST", "/live/profiles/load", {
      name: "smoke-a"
    });
    assert.equal(loadProfile.status, 200);
    assert.equal(loadProfile.data?.ok, true);
    assert.equal(loadProfile.data?.profile?.payload?.palette, "blue");

    const deleteProfile = await server.requestJson("DELETE", "/live/profiles/smoke-a");
    assert.equal(deleteProfile.status, 200);
    assert.equal(deleteProfile.data?.ok, true);

    const fixturesSave = await server.requestJson("POST", "/fixtures/fixture", {
      id: "smoke-hue-1",
      brand: "hue",
      zone: "hue",
      bridgeIp: "192.168.1.2",
      username: "user",
      lightId: 1
    });
    assert.equal(fixturesSave.status, 200);
    assert.equal(fixturesSave.data?.ok, true);

    const fixturesDelete = await server.requestJson("DELETE", "/fixtures/fixture?id=smoke-hue-1");
    assert.equal(fixturesDelete.status, 200);
    assert.equal(fixturesDelete.data?.ok, true);

    const teachNew = await server.requestJson("POST", "/teach", { text: "streamcyan #00ffaa" });
    assert.equal(teachNew.status, 200);
    assert.equal(teachNew.data?.ok, true);
    assert.equal(teachNew.data?.changed, true);

    const teachDuplicate = await server.requestJson("POST", "/teach", { text: "streamcyan #00ffaa" });
    assert.equal(teachDuplicate.status, 200);
    assert.equal(teachDuplicate.data?.ok, true);
    assert.equal(teachDuplicate.data?.changed, false);
    assert.equal(teachDuplicate.data?.refundRecommended, true);

    const patchPrefixes = await server.requestJson("POST", "/color/prefixes", {
      huePrefix: "h",
      wizPrefix: "w",
      fixturePrefixes: {
        "wiz-main-1": "desk"
      }
    });
    assert.equal(patchPrefixes.status, 200);
    assert.equal(patchPrefixes.data?.ok, true);
    assert.equal(patchPrefixes.data?.config?.prefixes?.hue, "h");
    assert.equal(patchPrefixes.data?.config?.fixturePrefixes?.["wiz-main-1"], "desk");

    const hueFixtureSave = await server.requestJson("POST", "/fixtures/fixture", {
      id: "hue-main-1",
      brand: "hue",
      zone: "hue",
      bridgeIp: "192.168.1.2",
      username: "user",
      lightId: 1
    });
    assert.equal(hueFixtureSave.status, 200);
    assert.equal(hueFixtureSave.data?.ok, true);

    const wizFixtureSave = await server.requestJson("POST", "/fixtures/fixture", {
      id: "wiz-main-1",
      brand: "wiz",
      zone: "wiz",
      ip: "192.168.1.25"
    });
    assert.equal(wizFixtureSave.status, 200);
    assert.equal(wizFixtureSave.data?.ok, true);

    const colorOk = await server.requestJson("POST", "/color", { text: "h streamcyan" });
    assert.equal(colorOk.status, 200);
    assert.equal(colorOk.data?.ok, true);
    assert.equal(colorOk.data?.target, "hue");

    const raveOn = await server.requestJson("POST", "/rave/on");
    assert.equal(raveOn.status, 200);
    assert.equal(raveOn.data?.ok, true);
    assert.equal(raveOn.data?.active, true);
    assert.equal(raveOn.data?.audioRuntime?.ok, true);

    const audioConfigAfterRaveOn = await server.requestJson("GET", "/audio/config");
    assert.equal(audioConfigAfterRaveOn.status, 200);
    assert.equal(audioConfigAfterRaveOn.data?.ok, true);
    assert.equal(typeof audioConfigAfterRaveOn.data?.telemetry?.running, "boolean");

    const colorBlocked = await server.requestJson("POST", "/color", { text: "w red" });
    assert.equal(colorBlocked.status, 409);
    assert.equal(colorBlocked.data?.ok, false);
    assert.equal(String(colorBlocked.data?.error || "").toLowerCase().includes("rave active"), true);

    const telemetryWrite = await server.requestJson("POST", "/audio/telemetry", {
      rms: 0.42,
      energy: 0.88,
      beat: true
    });
    assert.equal(telemetryWrite.status, 200);
    assert.equal(telemetryWrite.data?.ok, true);
    assert.equal(telemetryWrite.data?.changed, true);

    const telemetryRead = await server.requestJson("GET", "/audio/telemetry");
    assert.equal(telemetryRead.status, 200);
    assert.equal(telemetryRead.data?.ok, true);
    assert.equal(telemetryRead.data?.telemetry?.rms, 0.42);
    assert.equal(telemetryRead.data?.telemetry?.energy, 0.88);

    const raveTelemetry = await server.requestJson("GET", "/rave/telemetry");
    assert.equal(raveTelemetry.status, 200);
    assert.equal(raveTelemetry.data?.ok, true);
    assert.equal(typeof raveTelemetry.data?.cadenceAutoEnabled, "boolean");
    assert.equal(typeof raveTelemetry.data?.cadenceAutoSource, "string");
    assert.equal(Number.isFinite(Number(raveTelemetry.data?.cadenceAutoRequestedHz)), true);
    assert.equal(Number.isFinite(Number(raveTelemetry.data?.cadenceAutoAppliedHz)), true);

    const engineStatusBefore = await server.requestJson("GET", "/engine/v2/status");
    assert.equal(engineStatusBefore.status, 200);
    assert.equal(engineStatusBefore.data?.ok, true);
    assert.equal(engineStatusBefore.data?.status?.running, true);
    assert.equal(typeof engineStatusBefore.data?.status?.hardwareLimits, "object");

    const paletteSnapshotBefore = await server.requestJson("GET", "/engine/v2/palette");
    assert.equal(paletteSnapshotBefore.status, 200);
    assert.equal(paletteSnapshotBefore.data?.ok, true);

    const paletteTeach = await server.requestJson("POST", "/engine/v2/palette/custom-color", {
      text: "neonmint #19ffb0"
    });
    assert.equal(paletteTeach.status, 200);
    assert.equal(paletteTeach.data?.ok, true);
    assert.equal(paletteTeach.data?.changed, true);

    const paletteSequence = await server.requestJson("POST", "/engine/v2/palette/sequence", {
      sequence: ["neonmint", "blue", "#ff5500"]
    });
    assert.equal(paletteSequence.status, 200);
    assert.equal(paletteSequence.data?.ok, true);

    const paletteCycle = await server.requestJson("POST", "/engine/v2/palette/cycle", {
      holdTicks: 2
    });
    assert.equal(paletteCycle.status, 200);
    assert.equal(paletteCycle.data?.ok, true);

    const paletteAdvance = await server.requestJson("POST", "/engine/v2/palette/advance", {
      step: 1
    });
    assert.equal(paletteAdvance.status, 200);
    assert.equal(paletteAdvance.data?.ok, true);

    const engineStart = await server.requestJson("POST", "/engine/v2/start");
    assert.equal(engineStart.status, 200);
    assert.equal(engineStart.data?.ok, true);
    assert.equal(engineStart.data?.running, true);

    const engineTick = await server.requestJson("POST", "/engine/v2/tick", { reason: "smoke_test_tick" });
    assert.equal(engineTick.status, 200);
    assert.equal(engineTick.data?.ok, true);
    assert.equal(engineTick.data?.tickCount > 0, true);

    const engineStop = await server.requestJson("POST", "/engine/v2/stop");
    assert.equal(engineStop.status, 200);
    assert.equal(engineStop.data?.ok, true);
    assert.equal(engineStop.data?.running, false);

    const raveOff = await server.requestJson("POST", "/rave/off");
    assert.equal(raveOff.status, 200);
    assert.equal(raveOff.data?.ok, true);
    assert.equal(raveOff.data?.active, false);
    assert.equal(raveOff.data?.profile?.ok, true);
    assert.equal(raveOff.data?.audioRuntime?.ok, true);

    const audioConfigAfterRaveOff = await server.requestJson("GET", "/audio/config");
    assert.equal(audioConfigAfterRaveOff.status, 200);
    assert.equal(audioConfigAfterRaveOff.data?.ok, true);
    assert.equal(audioConfigAfterRaveOff.data?.telemetry?.running, false);
  });
});
