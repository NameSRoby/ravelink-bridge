const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const jsRoot = path.join(repoRoot, "public", "assets", "js");

function walkJs(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, name);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      walkJs(fullPath, out);
    } else if (name.endsWith(".js")) {
      out.push(fullPath);
    }
  }
  return out;
}

function toRepoPath(fullPath) {
  return path.relative(repoRoot, fullPath).replace(/\\/g, "/");
}

function routeBoundaryAllowed(relativePath) {
  if (relativePath === "public/assets/js/core/http.js") return true;
  return /^public\/assets\/js\/domains\/contracts\/[^/]+\.adapter\.js$/.test(relativePath);
}

test("public runtime route calls stay inside core HTTP and endpoint adapters", () => {
  const offenders = [];
  for (const filePath of walkJs(jsRoot)) {
    const relativePath = toRepoPath(filePath);
    if (routeBoundaryAllowed(relativePath)) continue;
    const source = fs.readFileSync(filePath, "utf8");
    if (/\bfetch\s*\(/.test(source)) offenders.push(`${relativePath}: fetch(`);
    if (/\b(?:getJson|postJson|deleteJson|api)\s*\(/.test(source)) {
      offenders.push(`${relativePath}: HTTP helper call`);
    }
  }

  assert.deepEqual(offenders, []);
});

test("public LIVE writes do not target compatibility write routes", () => {
  const offenders = [];
  for (const filePath of walkJs(jsRoot)) {
    const relativePath = toRepoPath(filePath);
    const source = fs.readFileSync(filePath, "utf8");
    const forbiddenPatterns = [
      /postJson\(\s*["']\/rave\/live\/compatibility["']/,
      /postJson\(\s*["']\/rave\/live\/sync-groups["']/,
      /postJson\(\s*["']\/rave\/live\/trigger-matrix["']/,
      /patchCompatibility\s*:/,
      /patchCompatibility\s*\(/
    ];
    if (forbiddenPatterns.some(pattern => pattern.test(source))) {
      offenders.push(relativePath);
    }
  }

  assert.deepEqual(offenders, [], `compatibility LIVE write paths found:\n${offenders.join("\n")}`);
});
