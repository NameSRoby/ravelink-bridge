#!/usr/bin/env node
/* [TITLE] Script: scripts/verify-release-readiness.js
 * [TITLE] Purpose: run full pre-engine readiness gates before Engine v2 development
 * [TITLE] Functionality Index:
 * [TITLE] - architecture guardrails
 * [TITLE] - security baseline checks
 * [TITLE] - full automated test suite
 * [TITLE] - dependency high-severity audit
 */

const path = require("node:path");
const { spawnSync } = require("node:child_process");

function runNodeScript(relativePath) {
  const scriptPath = path.resolve(__dirname, relativePath);
  const result = spawnSync(process.execPath, [scriptPath], { stdio: "inherit" });
  return Number(result.status || 0);
}

function runNodeTests() {
  const result = spawnSync(process.execPath, ["--test"], { stdio: "inherit" });
  return Number(result.status || 0);
}

const stages = [
  { label: "architecture", run: () => runNodeScript("./verify-architecture.js") },
  { label: "security", run: () => runNodeScript("./verify-security-baseline.js") },
  { label: "tests", run: runNodeTests },
  { label: "dependency_audit", run: () => runNodeScript("./verify-dependency-audit.js") }
];

for (const stage of stages) {
  const status = stage.run();
  if (status !== 0) {
    console.error(`[VERIFY][READINESS] stage failed: ${stage.label}`);
    process.exit(status);
  }
}

console.log("[VERIFY][READINESS] all pre-engine gates passed");
