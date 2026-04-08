#!/usr/bin/env node
/* [TITLE] Script: scripts/verify-domain-route-boundary.js
 * [TITLE] Purpose: enforce route-call boundary to domain contract adapters
 * [TITLE] Functionality Index:
 * [TITLE] - scan domain JS files (excluding contracts folder)
 * [TITLE] - fail on direct getJson/postJson/deleteJson/fetch usage
 */

const fs = require("fs");
const path = require("path");

const DOMAINS_ROOT = path.resolve(process.cwd(), "public/assets/js/domains");
const FORBIDDEN_RE = /\b(getJson|postJson|deleteJson|fetch)\s*\(/g;
const CONTRACTS_SEGMENT = `${path.sep}contracts${path.sep}`;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    if (entry.isFile() && full.endsWith(".js")) out.push(full);
  }
  return out;
}

function toPosixRelative(file) {
  return path.relative(DOMAINS_ROOT, file).split(path.sep).join("/");
}

function collectViolations(file) {
  const source = fs.readFileSync(file, "utf8");
  const lines = source.split(/\r?\n/);
  const violations = [];
  lines.forEach((line, index) => {
    if (!FORBIDDEN_RE.test(line)) return;
    FORBIDDEN_RE.lastIndex = 0;
    const match = line.match(FORBIDDEN_RE);
    violations.push({
      line: index + 1,
      token: String(match?.[0] || "").trim(),
      text: line.trim().slice(0, 180)
    });
  });
  return violations;
}

function main() {
  if (!fs.existsSync(DOMAINS_ROOT)) {
    console.error(`[VERIFY][ROUTES] domains root missing: ${DOMAINS_ROOT}`);
    process.exit(1);
  }

  const files = walk(DOMAINS_ROOT).filter(file => !file.includes(CONTRACTS_SEGMENT));
  const violations = [];
  for (const file of files) {
    const rows = collectViolations(file);
    if (!rows.length) continue;
    for (const row of rows) {
      violations.push({
        file: toPosixRelative(file),
        ...row
      });
    }
  }

  if (violations.length) {
    console.error("[VERIFY][ROUTES] direct route calls found outside domains/contracts:");
    for (const row of violations) {
      console.error(` - ${row.file}:${row.line} ${row.token} :: ${row.text}`);
    }
    process.exit(1);
  }

  console.log(`[VERIFY][ROUTES] ok (${files.length} files checked)`);
}

main();
