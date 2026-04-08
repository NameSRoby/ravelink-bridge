#!/usr/bin/env node
/* [TITLE] Script: scripts/verify-script-manifest-order.js
 * [TITLE] Purpose: enforce critical runtime script load order contracts
 * [TITLE] Functionality Index:
 * [TITLE] - audio app-isolation assist runtime module before audio orchestrator
 * [TITLE] - audio quick-tune runtime module before audio orchestrator
 * [TITLE] - audio reactivity runtime module before audio orchestrator
 * [TITLE] - palette scope-config runtime module before palette orchestrator
 * [TITLE] - palette metadata runtime module before palette orchestrator
 * [TITLE] - palette fixture-metric contract runtime module before palette orchestrator
 * [TITLE] - palette UI input adapter before palette orchestrator
 * [TITLE] - palette runtime-wiring module after palette orchestrator globals
 * [TITLE] - fixtures runtime module before fixtures orchestrator
 * [TITLE] - fixtures UI input adapter + WiZ onboarding runtime before fixtures orchestrator
 * [TITLE] - audio UI input adapter before audio orchestrator
 * [TITLE] - telemetry runtime modules before telemetry orchestrator
 * [TITLE] - system startup-readiness runtime before system runtime module
 * [TITLE] - mods ui-host runtime module before mods orchestrator
 * [TITLE] - mods import runtime module before mods orchestrator
 * [TITLE] - mods hotswap runtime module before mods orchestrator
 * [TITLE] - live-controls runtime module before live-controls orchestrator
 */

const fs = require("fs");
const path = require("path");

const MANIFEST_PATH = path.resolve(process.cwd(), "public/templates/index/sections/scripts.html");

function findIndexOrFail(content, needle) {
  const idx = content.indexOf(needle);
  if (idx < 0) {
    throw new Error(`missing script token: ${needle}`);
  }
  return idx;
}

function assertBefore(content, first, second) {
  const a = findIndexOrFail(content, first);
  const b = findIndexOrFail(content, second);
  if (a >= b) {
    throw new Error(`script order invalid: "${first}" must come before "${second}"`);
  }
}

function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`[VERIFY][MANIFEST] script manifest missing: ${MANIFEST_PATH}`);
    process.exit(1);
  }
  const content = fs.readFileSync(MANIFEST_PATH, "utf8");
  try {
    assertBefore(content, "contracts/audio-domain.adapter.js", "domains/telemetry/telemetry-poll-runtime-ui.js");
    assertBefore(content, "contracts/palette-domain.adapter.js", "domains/telemetry/telemetry-poll-runtime-ui.js");
    assertBefore(content, "contracts/fixtures-domain.adapter.js", "domains/telemetry/telemetry-poll-runtime-ui.js");
    assertBefore(content, "contracts/audio-ui-input.adapter.js", "domains/audio.js");
    assertBefore(content, "domains/audio/audio-app-isolation-assist-runtime-ui.js", "domains/audio.js");
    assertBefore(content, "domains/audio/audio-quick-tune-runtime-ui.js", "domains/audio.js");
    assertBefore(content, "domains/audio/audio-reactivity-map-runtime-ui.js", "domains/audio.js");
    assertBefore(content, "contracts/palette-ui-input.adapter.js", "domains/palette.js");
    assertBefore(content, "domains/palette/palette-scope-config-runtime-ui.js", "domains/palette.js");
    assertBefore(content, "domains/palette/palette-runtime-metadata-runtime-ui.js", "domains/palette.js");
    assertBefore(content, "domains/palette/palette-fixture-metric-contract-runtime-ui.js", "domains/palette.js");
    assertBefore(content, "domains/palette.js", "domains/palette/palette-runtime-wiring-ui.js");
    assertBefore(content, "contracts/fixtures-ui-input.adapter.js", "domains/fixtures.js");
    assertBefore(content, "domains/fixtures/fixtures-wiz-onboarding-runtime-ui.js", "domains/fixtures.js");
    assertBefore(content, "domains/fixtures/fixtures-hue-pairing-runtime-ui.js", "domains/fixtures.js");
    assertBefore(content, "domains/fixtures/fixtures-routing-runtime-ui.js", "domains/fixtures.js");
    assertBefore(content, "domains/telemetry/telemetry-live-audit-runtime-ui.js", "domains/telemetry.js");
    assertBefore(content, "domains/telemetry/telemetry-monitor-runtime-ui.js", "domains/telemetry.js");
    assertBefore(content, "domains/telemetry/telemetry-poll-runtime-ui.js", "domains/telemetry.js");
    assertBefore(content, "domains/telemetry/telemetry-sync-runtime-ui.js", "domains/telemetry.js");
    assertBefore(content, "domains/system/system-startup-readiness-runtime-ui.js", "domains/system/system-runtime-ui.js");
    assertBefore(content, "domains/mods/mods-ui-host-runtime-ui.js", "domains/mods.js");
    assertBefore(content, "domains/mods/mods-import-runtime-ui.js", "domains/mods.js");
    assertBefore(content, "domains/mods/mods-hotswap-runtime-ui.js", "domains/mods.js");
    assertBefore(content, "domains/live/live-controls-runtime-ui.js", "domains/live-controls.js");
  } catch (error) {
    console.error(`[VERIFY][MANIFEST] ${error.message}`);
    process.exit(1);
  }
  console.log("[VERIFY][MANIFEST] ok");
}

main();
