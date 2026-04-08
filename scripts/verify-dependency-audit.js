#!/usr/bin/env node
/* [TITLE] Script: scripts/verify-dependency-audit.js
 * [TITLE] Purpose: enforce high-severity dependency audit gate for release readiness
 * [TITLE] Functionality Index:
 * [TITLE] - execute npm audit (prod deps only, high severity and above)
 * [TITLE] - support optional skip flag for offline environments
 */

const { spawnSync } = require("node:child_process");

function runDependencyAudit() {
  if (String(process.env.RAVELINK_SKIP_AUDIT || "").trim() === "1") {
    console.log("[VERIFY][AUDIT] skipped via RAVELINK_SKIP_AUDIT=1");
    return 0;
  }

  const result = process.platform === "win32"
    ? spawnSync(
      "cmd.exe",
      ["/d", "/s", "/c", "npm audit --omit=dev --audit-level=high"],
      { stdio: "inherit" }
    )
    : spawnSync(
      "npm",
      ["audit", "--omit=dev", "--audit-level=high"],
      { stdio: "inherit" }
    );

  if (typeof result.status !== "number") {
    console.error("[VERIFY][AUDIT] failed to execute npm audit");
    return 1;
  }
  if (result.status !== 0) {
    console.error("[VERIFY][AUDIT] dependency audit reported high-severity issues");
    return result.status;
  }

  console.log("[VERIFY][AUDIT] no high-severity vulnerabilities found");
  return 0;
}

const status = runDependencyAudit();
process.exit(status);
