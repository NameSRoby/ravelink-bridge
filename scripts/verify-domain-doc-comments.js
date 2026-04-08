#!/usr/bin/env node
/* [TITLE] Script: scripts/verify-domain-doc-comments.js
 * [TITLE] Purpose: enforce domain header/dev-comment documentation standard
 * [TITLE] Functionality Index:
 * [TITLE] - require [TITLE] module headers on all domain JS files
 * [TITLE] - require [DEV] guidance for complex files (line-count threshold)
 */

const fs = require("fs");
const path = require("path");

const DOMAINS_ROOT = path.resolve(process.cwd(), "public/assets/js/domains");
const COMPLEXITY_LINE_THRESHOLD = 120;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && full.endsWith(".js")) out.push(full);
  }
  return out;
}

function toRel(file) {
  return path.relative(DOMAINS_ROOT, file).split(path.sep).join("/");
}

function main() {
  if (!fs.existsSync(DOMAINS_ROOT)) {
    console.error(`[VERIFY][DOCS] domains root missing: ${DOMAINS_ROOT}`);
    process.exit(1);
  }

  const files = walk(DOMAINS_ROOT);
  const failures = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/);
    const head = lines.slice(0, 80).join("\n");
    const hasModule = head.includes("[TITLE] Module:");
    const hasPurpose = head.includes("[TITLE] Purpose:");
    const hasIndex = head.includes("[TITLE] Functionality Index:");
    const hasDev = text.includes("[DEV]");
    const lineCount = lines.length;
    if (!hasModule || !hasPurpose || !hasIndex || (lineCount > COMPLEXITY_LINE_THRESHOLD && !hasDev)) {
      failures.push({
        file: toRel(file),
        lineCount,
        hasModule,
        hasPurpose,
        hasIndex,
        hasDev
      });
    }
  }

  if (failures.length) {
    console.error("[VERIFY][DOCS] documentation header violations:");
    for (const row of failures) {
      console.error(` - ${row.file}: module=${row.hasModule} purpose=${row.hasPurpose} index=${row.hasIndex} dev=${row.hasDev} lines=${row.lineCount}`);
    }
    process.exit(1);
  }

  console.log(`[VERIFY][DOCS] ok (${files.length} files checked)`);
}

main();
