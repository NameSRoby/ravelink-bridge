const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

test("architecture guardrail suite passes", () => {
  const scriptPath = path.resolve(__dirname, "../scripts/verify-architecture.js");
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8"
  });
  assert.equal(result.status, 0, `verify-architecture failed:\n${result.stdout}\n${result.stderr}`);
});

test("script manifest keeps audio/palette/fixtures/telemetry/mods/live runtime ordering", () => {
  const manifestPath = path.resolve(__dirname, "../public/templates/index/sections/scripts.html");
  const content = fs.readFileSync(manifestPath, "utf8");
  const domDomainRegistryIdx = content.indexOf("assets/js/core/dom-domain-registry.js");
  const domCollectionsIdx = content.indexOf("assets/js/core/dom-query-collections.js");
  const domComposerIdx = content.indexOf("assets/js/core/dom.js");
  const httpIdx = content.indexOf("assets/js/core/http.js");
  const appShellIdx = content.indexOf("assets/js/app.js");
  const audioAssistRuntimeIdx = content.indexOf("domains/audio/audio-app-isolation-assist-runtime-ui.js");
  const audioQuickTuneRuntimeIdx = content.indexOf("domains/audio/audio-quick-tune-runtime-ui.js");
  const audioRuntimeIdx = content.indexOf("domains/audio/audio-reactivity-map-runtime-ui.js");
  const audioConfigAppSelectionRuntimeIdx = content.indexOf("domains/audio/audio-config-app-selection-runtime-ui.js");
  const audioTelemetryRuntimeIdx = content.indexOf("domains/audio/audio-telemetry-runtime-ui.js");
  const audioConfigRuntimeIdx = content.indexOf("domains/audio/audio-config-runtime-ui.js");
  const audioOrchestratorIdx = content.indexOf("domains/audio.js");
  const paletteScopeRuntimeIdx = content.indexOf("domains/palette/palette-scope-config-runtime-ui.js");
  const paletteMetadataRuntimeIdx = content.indexOf("domains/palette/palette-runtime-metadata-runtime-ui.js");
  const paletteSnapshotRuntimeIdx = content.indexOf("domains/palette/palette-runtime-snapshot-runtime-ui.js");
  const paletteBrandCustomColorActionsRuntimeIdx = content.indexOf("domains/palette/palette-brand-custom-color-actions-runtime-ui.js");
  const paletteBrandActionsRuntimeIdx = content.indexOf("domains/palette/palette-brand-actions-runtime.js");
  const paletteFixtureMetricRuntimeIdx = content.indexOf("domains/palette/palette-fixture-metric-contract-runtime-ui.js");
  const paletteOrchestratorIdx = content.indexOf("domains/palette.js");
  const paletteRuntimeWiringIdx = content.indexOf("domains/palette/palette-runtime-wiring-ui.js");
  const fixturesRuntimeIdx = content.indexOf("domains/fixtures/fixtures-routing-runtime-ui.js");
  const fixturesOrchestratorIdx = content.indexOf("domains/fixtures.js");
  const telemetryRuntimeIdx = content.indexOf("telemetry/telemetry-poll-runtime-ui.js");
  const telemetrySyncIdx = content.indexOf("telemetry/telemetry-sync-runtime-ui.js");
  const telemetryOrchestratorIdx = content.indexOf("domains/telemetry.js");
  const modsUiHostRuntimeIdx = content.indexOf("domains/mods/mods-ui-host-runtime-ui.js");
  const modsRuntimeIdx = content.indexOf("domains/mods/mods-import-runtime-ui.js");
  const modsHotswapRuntimeIdx = content.indexOf("domains/mods/mods-hotswap-runtime-ui.js");
  const modsOrchestratorIdx = content.indexOf("domains/mods.js");
  const onboardingTourRuntimeIdx = content.indexOf("domains/onboarding-tour-runtime-ui.js");
  const systemRouteConsoleRuntimeIdx = content.indexOf("system/system-route-console-runtime-ui.js");
  const systemRustWorkerRuntimeIdx = content.indexOf("system/system-rust-transport-worker-runtime-ui.js");
  const systemWidgetOauthVaultRuntimeIdx = content.indexOf("system/system-widget-oauth-vault-runtime-ui.js");
  const systemWidgetTemplateRuntimeIdx = content.indexOf("system/system-widget-template-runtime-ui.js");
  const systemOpsRuntimeIdx = content.indexOf("system/system-ops-runtime-ui.js");
  const systemOrchestratorIdx = content.indexOf("domains/system-flow.js");
  const liveFlowIntensityRuntimeIdx = content.indexOf("live/live-flow-intensity-runtime-ui.js");
  const liveThemeConfigRuntimeIdx = content.indexOf("live/live-theme-config-runtime-ui.js");
  const liveThemeShellRuntimeIdx = content.indexOf("live/live-theme-shell-ui.js");
  const liveSyncGroupsTransportIdx = content.indexOf("live/live-sync-groups-transport-ui.js");
  const liveSyncGroupsControlsIdx = content.indexOf("live/live-sync-groups-controls-ui.js");
  const liveRuntimeIdx = content.indexOf("live/live-controls-runtime-ui.js");
  const liveOrchestratorIdx = content.indexOf("domains/live-controls.js");
  const uiTooltipsLiveIdx = content.indexOf("domains/ui-tooltips-live-runtime-ui.js");
  const uiTooltipsComposerIdx = content.indexOf("domains/ui-tooltips.js");
  assert.ok(domDomainRegistryIdx >= 0, "core dom-domain-registry script missing");
  assert.ok(domCollectionsIdx >= 0, "core dom-query-collections script missing");
  assert.ok(domComposerIdx >= 0, "core dom composer script missing");
  assert.ok(httpIdx >= 0, "core http script missing");
  assert.ok(appShellIdx >= 0, "app shell helper script missing");
  assert.ok(audioAssistRuntimeIdx >= 0, "audio app-isolation assist runtime script missing");
  assert.ok(audioQuickTuneRuntimeIdx >= 0, "audio quick-tune runtime script missing");
  assert.ok(audioRuntimeIdx >= 0, "audio reactivity runtime script missing");
  assert.ok(audioConfigAppSelectionRuntimeIdx >= 0, "audio config app-selection runtime script missing");
  assert.ok(audioTelemetryRuntimeIdx >= 0, "audio telemetry runtime script missing");
  assert.ok(audioConfigRuntimeIdx >= 0, "audio config runtime script missing");
  assert.ok(audioOrchestratorIdx >= 0, "audio orchestrator script missing");
  assert.ok(paletteScopeRuntimeIdx >= 0, "palette scope-config runtime script missing");
  assert.ok(paletteMetadataRuntimeIdx >= 0, "palette metadata runtime script missing");
  assert.ok(paletteSnapshotRuntimeIdx >= 0, "palette runtime snapshot script missing");
  assert.ok(paletteBrandCustomColorActionsRuntimeIdx >= 0, "palette brand custom-color actions runtime script missing");
  assert.ok(paletteBrandActionsRuntimeIdx >= 0, "palette brand actions runtime script missing");
  assert.ok(paletteFixtureMetricRuntimeIdx >= 0, "palette fixture-metric contract runtime script missing");
  assert.ok(paletteOrchestratorIdx >= 0, "palette orchestrator script missing");
  assert.ok(paletteRuntimeWiringIdx >= 0, "palette runtime wiring script missing");
  assert.ok(fixturesRuntimeIdx >= 0, "fixtures runtime script missing");
  assert.ok(fixturesOrchestratorIdx >= 0, "fixtures orchestrator script missing");
  assert.ok(telemetryRuntimeIdx >= 0, "telemetry poll runtime script missing");
  assert.ok(telemetrySyncIdx >= 0, "telemetry sync runtime script missing");
  assert.ok(telemetryOrchestratorIdx >= 0, "telemetry orchestrator script missing");
  assert.ok(modsUiHostRuntimeIdx >= 0, "mods ui-host runtime script missing");
  assert.ok(modsRuntimeIdx >= 0, "mods import runtime script missing");
  assert.ok(modsHotswapRuntimeIdx >= 0, "mods hotswap runtime script missing");
  assert.ok(modsOrchestratorIdx >= 0, "mods orchestrator script missing");
  assert.ok(onboardingTourRuntimeIdx >= 0, "onboarding tour runtime script missing");
  assert.ok(systemRouteConsoleRuntimeIdx >= 0, "system route-console runtime script missing");
  assert.ok(systemRustWorkerRuntimeIdx >= 0, "system rust worker runtime script missing");
  assert.ok(systemWidgetOauthVaultRuntimeIdx >= 0, "system widget oauth vault runtime script missing");
  assert.ok(systemWidgetTemplateRuntimeIdx >= 0, "system widget template runtime script missing");
  assert.ok(systemOpsRuntimeIdx >= 0, "system ops runtime script missing");
  assert.ok(systemOrchestratorIdx >= 0, "system-flow orchestrator script missing");
  assert.ok(liveFlowIntensityRuntimeIdx >= 0, "live flow-intensity runtime script missing");
  assert.ok(liveThemeConfigRuntimeIdx >= 0, "live theme config runtime script missing");
  assert.ok(liveThemeShellRuntimeIdx >= 0, "live theme shell runtime script missing");
  assert.ok(liveSyncGroupsTransportIdx >= 0, "live sync-groups transport runtime script missing");
  assert.ok(liveSyncGroupsControlsIdx >= 0, "live sync-groups controls runtime script missing");
  assert.ok(liveRuntimeIdx >= 0, "live-controls runtime script missing");
  assert.ok(liveOrchestratorIdx >= 0, "live-controls orchestrator script missing");
  assert.ok(uiTooltipsLiveIdx >= 0, "ui tooltip domain provider scripts missing");
  assert.ok(uiTooltipsComposerIdx >= 0, "ui tooltip composer script missing");
  assert.ok(audioAssistRuntimeIdx < audioOrchestratorIdx, "audio app-isolation assist runtime must load before audio orchestrator");
  assert.ok(audioQuickTuneRuntimeIdx < audioOrchestratorIdx, "audio quick-tune runtime must load before audio orchestrator");
  assert.ok(audioRuntimeIdx < audioOrchestratorIdx, "audio reactivity runtime must load before audio orchestrator");
  assert.ok(audioConfigAppSelectionRuntimeIdx < audioConfigRuntimeIdx, "audio config app-selection runtime must load before audio config runtime");
  assert.ok(audioConfigRuntimeIdx < audioOrchestratorIdx, "audio config runtime must load before audio orchestrator");
  assert.ok(audioTelemetryRuntimeIdx < audioOrchestratorIdx, "audio telemetry runtime must load before audio orchestrator");
  assert.ok(paletteScopeRuntimeIdx < paletteOrchestratorIdx, "palette scope-config runtime must load before palette orchestrator");
  assert.ok(paletteMetadataRuntimeIdx < paletteOrchestratorIdx, "palette metadata runtime must load before palette orchestrator");
  assert.ok(paletteSnapshotRuntimeIdx < paletteOrchestratorIdx, "palette runtime snapshot must load before palette orchestrator");
  assert.ok(paletteBrandCustomColorActionsRuntimeIdx < paletteBrandActionsRuntimeIdx, "palette brand custom-color actions runtime must load before brand actions runtime");
  assert.ok(paletteBrandActionsRuntimeIdx < paletteRuntimeWiringIdx, "palette brand actions runtime must load before palette runtime wiring");
  assert.ok(paletteFixtureMetricRuntimeIdx < paletteOrchestratorIdx, "palette fixture-metric contract runtime must load before palette orchestrator");
  assert.ok(paletteOrchestratorIdx < paletteRuntimeWiringIdx, "palette runtime wiring must load after palette orchestrator globals");
  assert.ok(fixturesRuntimeIdx < fixturesOrchestratorIdx, "fixtures runtime must load before fixtures orchestrator");
  assert.ok(telemetryRuntimeIdx < telemetryOrchestratorIdx, "telemetry poll runtime must load before telemetry orchestrator");
  assert.ok(telemetrySyncIdx < telemetryOrchestratorIdx, "telemetry sync runtime must load before telemetry orchestrator");
  assert.ok(modsUiHostRuntimeIdx < modsOrchestratorIdx, "mods ui-host runtime must load before mods orchestrator");
  assert.ok(modsRuntimeIdx < modsOrchestratorIdx, "mods import runtime must load before mods orchestrator");
  assert.ok(modsHotswapRuntimeIdx < modsOrchestratorIdx, "mods hotswap runtime must load before mods orchestrator");
  assert.ok(onboardingTourRuntimeIdx < liveThemeShellRuntimeIdx, "onboarding tour runtime must load before live theme shell");
  assert.ok(systemRouteConsoleRuntimeIdx < systemOpsRuntimeIdx, "system route-console runtime must load before system ops runtime");
  assert.ok(systemRustWorkerRuntimeIdx < systemOpsRuntimeIdx, "system rust worker runtime must load before system ops runtime");
  assert.ok(systemWidgetOauthVaultRuntimeIdx < systemWidgetTemplateRuntimeIdx, "system widget oauth vault runtime must load before widget template runtime");
  assert.ok(systemOpsRuntimeIdx < systemOrchestratorIdx, "system ops runtime must load before system-flow orchestrator");
  assert.ok(liveFlowIntensityRuntimeIdx < liveRuntimeIdx, "live flow-intensity runtime must load before live-controls runtime");
  assert.ok(liveThemeConfigRuntimeIdx < liveThemeShellRuntimeIdx, "live theme config runtime must load before live theme shell runtime");
  assert.ok(liveSyncGroupsTransportIdx < liveSyncGroupsControlsIdx, "live sync-groups transport runtime must load before controls runtime");
  assert.ok(liveSyncGroupsControlsIdx < liveRuntimeIdx, "live sync-groups controls runtime must load before live-controls runtime");
  assert.ok(liveRuntimeIdx < liveOrchestratorIdx, "live-controls runtime must load before live-controls orchestrator");
  assert.ok(uiTooltipsLiveIdx < uiTooltipsComposerIdx, "ui tooltip domain providers must load before tooltip composer");
  assert.ok(domDomainRegistryIdx < domComposerIdx, "core dom-domain registry must load before dom composer");
  assert.ok(domCollectionsIdx < domComposerIdx, "core dom query collections must load before dom composer");
  assert.ok(domComposerIdx < appShellIdx, "app shell helpers must load after DOM registry composition");
  assert.ok(httpIdx < appShellIdx, "app shell helpers must load after HTTP helpers");
  assert.ok(appShellIdx < audioOrchestratorIdx, "app shell helpers must load before domain modules use shared helpers");
  assert.ok(appShellIdx < systemOrchestratorIdx, "app shell helpers must load before system-flow");
});

test("script manifest entries have documented ownership tiers", () => {
  const manifestPath = path.resolve(__dirname, "../public/templates/index/sections/scripts.html");
  const content = fs.readFileSync(manifestPath, "utf8");
  const scripts = [...content.matchAll(/<script\s+src="([^"]+)"/g)]
    .map(match => match[1].split("?")[0]);
  const ownershipTiers = [
    {
      name: "core state/http primitives",
      owner: "core shell",
      reason: "must load before adapters and domain runtimes",
      matches: /^assets\/js\/core\/(state|ui-state|http)\.js$/
    },
    {
      name: "core dom registry",
      owner: "core shell",
      reason: "must load before dom.js composes shared handles",
      matches: /^assets\/js\/core\/(dom-domain-registry|dom-query-collections|dom)\.js$/
    },
    {
      name: "shared contracts",
      owner: "shared contract layer",
      reason: "must load before domain adapters and runtimes consume shared schemas",
      matches: /^assets\/js\/shared\/.*\.js$/
    },
    {
      name: "endpoint and domain adapters",
      owner: "contract adapter layer",
      reason: "must load before runtime modules call route/domain contracts",
      matches: /^assets\/js\/domains\/contracts\/.*\.js$/
    },
    {
      name: "palette runtimes",
      owner: "palette domain",
      reason: "must load before palette orchestrator or follow it for explicit wiring",
      matches: source => /^assets\/js\/domains\/palette\/.*\.js$/.test(source) || source === "assets/js/domains/palette.js"
    },
    {
      name: "fixtures runtimes",
      owner: "fixtures domain",
      reason: "must load before fixtures orchestrator",
      matches: source => /^assets\/js\/domains\/fixtures\/.*\.js$/.test(source) || source === "assets/js/domains/fixtures.js"
    },
    {
      name: "audio runtimes",
      owner: "audio domain",
      reason: "must load before audio orchestrator",
      matches: source => /^assets\/js\/domains\/audio\/.*\.js$/.test(source) || source === "assets/js/domains/audio.js"
    },
    {
      name: "telemetry runtimes",
      owner: "telemetry domain",
      reason: "must load before telemetry orchestrator",
      matches: source => /^assets\/js\/domains\/telemetry\/.*\.js$/.test(source) || source === "assets/js/domains/telemetry.js"
    },
    {
      name: "mods runtimes",
      owner: "mods domain",
      reason: "must load before mods orchestrator",
      matches: source => /^assets\/js\/domains\/mods\/.*\.js$/.test(source) || source === "assets/js/domains/mods.js"
    },
    {
      name: "system runtimes",
      owner: "system domain",
      reason: "must load before system-flow composes the System tab",
      matches: source => /^assets\/js\/domains\/system\/.*\.js$/.test(source) || source === "assets/js/domains/system-flow.js"
    },
    {
      name: "live runtimes",
      owner: "live domain",
      reason: "must load before live-controls.js composes LIVE controls",
      matches: source => /^assets\/js\/domains\/live\/.*\.js$/.test(source) || source === "assets/js/domains/live-controls.js"
    },
    {
      name: "navigation and shell utilities",
      owner: "ui shell",
      reason: "must load after domain basics and before app/bootstrap",
      matches: /^assets\/js\/domains\/(ui-collapsible-panels-runtime-ui|ui-navigation|ui-actions|ui-tooltips(?:-[a-z-]+-runtime-ui)?|onboarding-tour-runtime-ui|color-prefix|color-prefix-rave-off-runtime-ui)\.js$/
    },
    {
      name: "midi runtimes",
      owner: "midi domain",
      reason: "must load after endpoint adapters and before app/bootstrap",
      matches: source => /^assets\/js\/domains\/midi\/.*\.js$/.test(source) || source === "assets/js/domains/midi.js"
    },
    {
      name: "app bootstrap",
      owner: "browser shell",
      reason: "app.js provides shared shell helpers before domain modules, while bootstrap.js starts last after every domain global is registered",
      matches: /^assets\/js\/(app|bootstrap)\.js$/
    }
  ];

  assert.equal(scripts.length, 117, "script manifest inventory changed; update ownership tiers intentionally");

  const unowned = [];
  const duplicateOwners = [];
  for (const script of scripts) {
    const matches = ownershipTiers.filter(tier => {
      if (typeof tier.matches === "function") return tier.matches(script);
      return tier.matches.test(script);
    });
    if (matches.length === 0) unowned.push(script);
    if (matches.length > 1) duplicateOwners.push(`${script} -> ${matches.map(match => match.name).join(", ")}`);
    for (const match of matches) {
      assert.ok(match.owner, `script ownership tier missing owner for ${script}`);
      assert.ok(match.reason, `script ownership tier missing load-order reason for ${script}`);
    }
  }

  assert.deepEqual(unowned, [], `scripts without ownership tier:\n${unowned.join("\n")}`);
  assert.deepEqual(duplicateOwners, [], `scripts with duplicate ownership tiers:\n${duplicateOwners.join("\n")}`);
});
