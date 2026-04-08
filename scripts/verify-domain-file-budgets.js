#!/usr/bin/env node
/* [TITLE] Script: scripts/verify-domain-file-budgets.js
 * [TITLE] Purpose: enforce line-count budgets for domain runtime files
 * [TITLE] Functionality Index:
 * [TITLE] - apply default + per-file budget limits
 * [TITLE] - lock current monolith files from growing
 */

const fs = require("fs");
const path = require("path");

const DOMAINS_ROOT = path.resolve(process.cwd(), "public/assets/js/domains");
const BUDGET_FILE = path.resolve(process.cwd(), "scripts/config/domain-file-budgets.json");

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && full.endsWith(".js")) out.push(full);
  }
  return out;
}

function countLines(file) {
  const text = fs.readFileSync(file, "utf8");
  return text.split(/\r?\n/).length;
}

function toRel(file) {
  return path.relative(DOMAINS_ROOT, file).split(path.sep).join("/");
}

function getBudget(config, relPath) {
  if (config.lockedFiles && Object.prototype.hasOwnProperty.call(config.lockedFiles, relPath)) {
    return Number(config.lockedFiles[relPath]);
  }
  if (config.overrides && Object.prototype.hasOwnProperty.call(config.overrides, relPath)) {
    return Number(config.overrides[relPath]);
  }
  return Number(config.defaultMaxLines);
}

function main() {
  if (!fs.existsSync(DOMAINS_ROOT)) {
    console.error(`[VERIFY][BUDGETS] domains root missing: ${DOMAINS_ROOT}`);
    process.exit(1);
  }
  if (!fs.existsSync(BUDGET_FILE)) {
    console.error(`[VERIFY][BUDGETS] budget file missing: ${BUDGET_FILE}`);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(BUDGET_FILE, "utf8"));
  const files = walk(DOMAINS_ROOT);
  const failures = [];
  const rows = [];

  for (const file of files) {
    const rel = toRel(file);
    const lines = countLines(file);
    const budget = getBudget(config, rel);
    rows.push({ rel, lines, budget });
    if (lines > budget) {
      failures.push({ rel, lines, budget });
    }
  }

  if (failures.length) {
    console.error("[VERIFY][BUDGETS] file-size budget violations:");
    for (const row of failures.sort((a, b) => b.lines - a.lines)) {
      console.error(` - ${row.rel}: ${row.lines} lines (budget ${row.budget})`);
    }
    process.exit(1);
  }

  const top = rows.sort((a, b) => b.lines - a.lines).slice(0, 8);
  console.log(`[VERIFY][BUDGETS] ok (${rows.length} files checked)`);
  for (const row of top) {
    console.log(` - ${row.rel}: ${row.lines}/${row.budget}`);
  }
}

main();
