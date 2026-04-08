// [TITLE] Module: app/routes/compat/system.compat.route-catalog.js
// [TITLE] Purpose: build the compatibility route catalog snapshot for system routes
// [TITLE] Functionality Index:
// [TITLE] - parse route registrations from bounded server source files
// [TITLE] - build a deduplicated route catalog payload for `/system/routes`
// [DEV] Complex Flow:
// [DEV] Keep route-catalog parsing next to the owning system compat route so the
// [DEV] top-level compat composer does not retain system-only filesystem helpers.

const fs = require("node:fs");
const path = require("node:path");

const ROUTE_CATALOG_FILES = Object.freeze([
  "src/app/register-routes.js",
  "src/app/register-compat-routes.js",
  "src/app/create-server.js"
]);

function collectRouteCatalogEntriesFromSource(filePath = "", source = "") {
  const resolvedPath = path.resolve(String(filePath || "").trim());
  if (!resolvedPath || !fs.existsSync(resolvedPath)) return [];
  let text = "";
  try {
    text = fs.readFileSync(resolvedPath, "utf8");
  } catch {
    return [];
  }
  const routeEntries = [];
  const stringRouteRegex = /\b(?:app|router)\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\2/g;
  let match = null;
  while ((match = stringRouteRegex.exec(text)) !== null) {
    const method = String(match[1] || "").trim().toUpperCase();
    const routePath = String(match[3] || "").trim();
    if (!method || !routePath) continue;
    routeEntries.push({
      method,
      path: routePath,
      source
    });
  }
  return routeEntries;
}

function buildRouteCatalogSnapshot(rootDir = process.cwd()) {
  const baseDir = path.resolve(String(rootDir || process.cwd() || "").trim() || process.cwd());
  const routeEntries = [];
  for (const relativePath of ROUTE_CATALOG_FILES) {
    routeEntries.push(
      ...collectRouteCatalogEntriesFromSource(
        path.join(baseDir, relativePath),
        relativePath
      )
    );
  }
  routeEntries.push({
    method: "GET",
    path: "/mods-ui/:modId/*",
    source: "src/app/register-compat-routes.js"
  });
  const deduped = [];
  const seen = new Set();
  for (const row of routeEntries) {
    const key = `${String(row?.method || "").trim().toUpperCase()} ${String(row?.path || "").trim()}`;
    if (!key.trim() || seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      method: String(row.method || "").trim().toUpperCase(),
      path: String(row.path || "").trim(),
      source: String(row.source || "").trim()
    });
  }
  deduped.sort((a, b) => {
    const pathCmp = String(a.path || "").localeCompare(String(b.path || ""));
    if (pathCmp !== 0) return pathCmp;
    return String(a.method || "").localeCompare(String(b.method || ""));
  });
  return {
    ok: true,
    generatedAt: Date.now(),
    routeCount: deduped.length,
    routes: deduped
  };
}

module.exports = {
  buildRouteCatalogSnapshot
};
