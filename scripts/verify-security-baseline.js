#!/usr/bin/env node
/* [TITLE] Script: scripts/verify-security-baseline.js
 * [TITLE] Purpose: enforce core security baseline invariants for pre-engine readiness
 * [TITLE] Functionality Index:
 * [TITLE] - verify loopback write-guard usage on mutating routes
 * [TITLE] - verify method restrictions on legacy GET mutation routes
 * [TITLE] - verify hardening headers exist in server bootstrap
 * [TITLE] - verify third-party notice ledger exists with attribution template
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const ROUTES_ROOTS = [
  path.resolve(ROOT, "src/app/register-routes.js"),
  path.resolve(ROOT, "src/app/register-compat-routes.js"),
  path.resolve(ROOT, "src/app/routes/compat")
];
const SERVER_PATH = path.resolve(ROOT, "src/app/create-server.js");
const THIRD_PARTY_PATH = path.resolve(ROOT, "THIRD_PARTY_NOTICES.md");

function collectRouteFiles() {
  const out = [];
  for (const entryPath of ROUTES_ROOTS) {
    if (!fs.existsSync(entryPath)) continue;
    const stat = fs.statSync(entryPath);
    if (stat.isFile()) {
      out.push(entryPath);
      continue;
    }
    const stack = [entryPath];
    while (stack.length) {
      const dir = stack.pop();
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.isFile() && full.endsWith(".js")) {
          out.push(full);
        }
      }
    }
  }
  return out;
}

function readFileOrFail(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`missing required file: ${path.relative(ROOT, filePath)}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function assertIncludes(content, snippet, message) {
  if (!content.includes(snippet)) {
    throw new Error(message);
  }
}

function main() {
  const routesSource = collectRouteFiles().map(readFileOrFail).join("\n");
  const serverSource = readFileOrFail(SERVER_PATH);
  const thirdPartySource = readFileOrFail(THIRD_PARTY_PATH);

  const guardedMutations = [
    "app.post(\"/audio/telemetry\", enforceWriteAccess",
    "app.post(\"/live/profiles/save\", enforceWriteAccess",
    "app.post(\"/live/profiles/load\", enforceWriteAccess",
    "app.delete(\"/live/profiles/:name\", enforceWriteAccess",
    "app.post(\"/rave/on\", enforceWriteAccess",
    "app.post(\"/rave/off\", enforceWriteAccess",
    "app.post(\"/engine/v2/start\", enforceWriteAccess",
    "app.post(\"/engine/v2/stop\", enforceWriteAccess",
    "app.post(\"/engine/v2/tick\", enforceWriteAccess",
    "app.post(\"/engine/v2/palette/custom-color\", enforceWriteAccess",
    "app.post(\"/engine/v2/palette/sequence\", enforceWriteAccess",
    "app.post(\"/engine/v2/palette/cycle\", enforceWriteAccess",
    "app.post(\"/engine/v2/palette/advance\", enforceWriteAccess",
    "app.post(\"/teach\", enforceWriteAccess",
    "app.post(\"/color/prefixes\", enforceWriteAccess",
    "app.post(\"/color\", enforceWriteAccess",
    "app.post(\"/system/config\", enforceWriteAccess",
    "app.post(\"/system/widget-template-get\", enforceWriteAccess",
    "app.post(\"/system/stop\", enforceWriteAccess",
    "app.post(\"/midi/refresh\", enforceWriteAccess",
    "app.post(\"/midi/config\", enforceWriteAccess",
    "app.post(\"/midi/learn/cancel\", enforceWriteAccess",
    "app.post(\"/midi/learn/:action\", enforceWriteAccess",
    "app.post(\"/midi/trigger/:action\", enforceWriteAccess",
    "app.post(\"/midi/bindings/reset\", enforceWriteAccess",
    "app.post(\"/midi/bindings/:action\", enforceWriteAccess",
    "app.delete(\"/midi/bindings/:action\", enforceWriteAccess",
    "app.post(\"/mods/reload\", enforceWriteAccess",
    "app.post(\"/mods/debug\", enforceWriteAccess",
    "app.post(\"/mods/debug/clear\", enforceWriteAccess",
    "app.post(\"/mods/import\", enforceWriteAccess",
    "app.post(\"/mods/config\", enforceWriteAccess",
    "app.post(\"/mods/:modId/:action\", enforceWriteAccess",
    "app.post(\"/rave/live/compatibility\", enforceWriteAccess",
    "app.post(\"/rave/live/trigger-matrix\", enforceWriteAccess",
    "app.post(\"/rave/palette\", enforceWriteAccess",
    "app.post(\"/rave/fixture-metrics\", enforceWriteAccess",
    "app.post(\"/rave/fixture-routing/clear\", enforceWriteAccess",
    "app.post(\"/rave/overclock/auto\", enforceWriteAccess",
    "app.post(\"/rave/overclock/off\", enforceWriteAccess",
    "app.post(\"/rave/overclock/on\", enforceWriteAccess",
    "app.post(\"/rave/overclock/turbo/on\", enforceWriteAccess",
    "app.post(\"/rave/overclock/ultra/on\", enforceWriteAccess",
    "app.post(\"/rave/overclock/extreme/on\", enforceWriteAccess",
    "app.post(\"/rave/overclock/insane/on\", enforceWriteAccess",
    "app.post(\"/rave/overclock/hyper/on\", enforceWriteAccess",
    "app.post(\"/rave/overclock/ludicrous/on\", enforceWriteAccess",
    "app.post(\"/rave/overclock/dev/:hz/on\", enforceWriteAccess",
    "app.post(\"/rave/panic\", enforceWriteAccess",
    "app.post(\"/rave/reload\", enforceWriteAccess",
    "app.post(\"/hue/transport\", enforceWriteAccess",
    "app.post(\"/fixtures/reload\", enforceWriteAccess",
    "app.post(\"/fixtures/fixture\", enforceWriteAccess",
    "app.delete(\"/fixtures/fixture\", enforceWriteAccess",
    "app.post(\"/fixtures/connectivity/test\", enforceWriteAccess",
    "app.post(\"/hue/pair\", enforceWriteAccess"
  ];
  for (const routeToken of guardedMutations) {
    assertIncludes(
      routesSource,
      routeToken,
      `mutating route missing loopback write guard: ${routeToken}`
    );
  }

  assertIncludes(
    routesSource,
    "error: \"method_not_allowed\"",
    "missing deterministic method_not_allowed route response"
  );

  assertIncludes(
    serverSource,
    "res.setHeader(\"X-Content-Type-Options\", \"nosniff\")",
    "missing X-Content-Type-Options hardening header"
  );
  assertIncludes(
    serverSource,
    "res.setHeader(\"X-Frame-Options\", \"SAMEORIGIN\")",
    "missing X-Frame-Options hardening header"
  );
  assertIncludes(
    serverSource,
    "res.setHeader(\"Referrer-Policy\", \"no-referrer\")",
    "missing Referrer-Policy hardening header"
  );

  assertIncludes(
    thirdPartySource,
    "## Entry Template",
    "third-party notice file missing entry template section"
  );
  assertIncludes(
    thirdPartySource,
    "Name:",
    "third-party notice file missing required attribution template fields"
  );

  console.log("[VERIFY][SECURITY] baseline checks passed");
}

try {
  main();
} catch (error) {
  console.error(`[VERIFY][SECURITY] ${error.message}`);
  process.exit(1);
}
