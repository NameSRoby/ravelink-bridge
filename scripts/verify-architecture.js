#!/usr/bin/env node
/* [TITLE] Script: scripts/verify-architecture.js
 * [TITLE] Purpose: run architecture guardrail checks as one command
 * [TITLE] Functionality Index:
 * [TITLE] - route boundary verification
 * [TITLE] - file-size budget verification
 * [TITLE] - documentation header verification
 * [TITLE] - script manifest order verification
 */

const { spawnSync } = require("child_process");
const path = require("path");

const checks = [
  "verify-domain-route-boundary.js",
  "verify-domain-file-budgets.js",
  "verify-domain-doc-comments.js",
  "verify-script-manifest-order.js"
];

function runCheck(scriptName) {
  const scriptPath = path.resolve(__dirname, scriptName);
  const result = spawnSync(process.execPath, [scriptPath], {
    stdio: "inherit"
  });
  return Number(result.status || 0);
}

function main() {
  for (const check of checks) {
    const status = runCheck(check);
    if (status !== 0) {
      process.exit(status);
    }
  }
  console.log("[VERIFY][ARCH] all checks passed");
}

main();
