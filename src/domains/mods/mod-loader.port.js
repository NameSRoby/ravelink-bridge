// [TITLE] Module: domains/mods/mod-loader.port.js
// [TITLE] Purpose: filesystem-backed mod loader with sandboxed execution runtime
// [TITLE] Functionality Index:
// [TITLE] - discover `mods/*/mod.json` and persist `mods.config.json`
// [TITLE] - prefer untracked `mods.local.config.json` for local-only overrides
// [TITLE] - execute enabled mods inside bounded VM sandboxes
// [TITLE] - expose hooks/actions/import/config routes without monolith logic
// [DEV] Complex Flow:
// [DEV] Loader lifecycle is deterministic: discover -> merge config -> start sandboxes.
// [DEV] Hook/action execution is isolated per mod to prevent one mod failure from
// [DEV] breaking other runtime lanes.

const fs = require("node:fs");
const path = require("node:path");
const { cloneJsonSafe, readJsonFile, writeJsonFile } = require("../../shared/fs/json-file-store");
const { SUPPORTED_MOD_HOOKS } = require("./hook-contract");
const createModSandboxRuntime = require("./mod-sandbox.runtime");
// [TITLE] Mod Sandbox Compatibility Allowlist
// [DEV] Keep this list explicit so trusted local mods can run allowed logic while
// [DEV] preventing arbitrary package/module imports.
const MOD_SANDBOX_ALLOWED_BUILTINS_DEFAULT = Object.freeze([
  "path",
  "url",
  "util",
  "fs",
  "crypto",
  "child_process",
  "os"
]);
const MOD_SANDBOX_ALLOWED_PACKAGES_DEFAULT = Object.freeze([
  "axios",
  "playwright"
]);

function normalizeModId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function normalizeRelativePath(value) {
  const raw = String(value || "").replace(/\\/g, "/").trim();
  if (!raw) return "";
  const parts = raw.split("/").filter(Boolean);
  const safe = [];
  for (const part of parts) {
    if (part === "." || part === "..") continue;
    safe.push(part);
  }
  return safe.join("/");
}

function normalizeUniqueIdList(value = []) {
  const rows = Array.isArray(value) ? value : [];
  const seen = new Set();
  const out = [];
  for (const raw of rows) {
    const id = normalizeModId(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function normalizeConfigShape(raw = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const normalized = {
    enabled: normalizeUniqueIdList(source.enabled),
    order: normalizeUniqueIdList(source.order),
    disabled: normalizeUniqueIdList(source.disabled)
  };
  normalized.enabled = normalized.enabled.filter(id => !normalized.disabled.includes(id));
  return normalized;
}

function decodeBase64ToBuffer(raw = "") {
  return Buffer.from(String(raw || ""), "base64");
}

function parseJsonFile(filePath, fallback = null) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function readFileIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return "";
    return String(fs.readFileSync(filePath, "utf8") || "").trim();
  } catch {
    return "";
  }
}

function normalizeHttpMap(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? cloneJsonSafe(value, {})
    : {};
}

function normalizeActionHttpEnvelope(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  if (!source) return null;
  const statusRaw = Number(source.status);
  const hasBody = Object.prototype.hasOwnProperty.call(source, "body");
  if (!Number.isFinite(statusRaw) && !hasBody) return null;
  const status = Number.isFinite(statusRaw)
    ? Math.max(100, Math.min(599, Math.round(statusRaw)))
    : 200;
  const bodySource = hasBody ? source.body : source;
  const body = bodySource && typeof bodySource === "object" && !Array.isArray(bodySource)
    ? cloneJsonSafe(bodySource, { ok: true })
    : { ok: true, result: cloneJsonSafe(bodySource, null) };
  return { status, body };
}

module.exports = function createModRuntime(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const log = options.log && typeof options.log === "object" ? options.log : console;
  const projectRoot = path.resolve(String(options.rootDir || process.cwd()));
  const modsRoot = path.resolve(String(options.modsRoot || path.join(projectRoot, "mods")));
  const configPath = path.resolve(String(options.configPath || path.join(modsRoot, "mods.config.json")));
  const localConfigPath = path.resolve(String(options.localConfigPath || path.join(path.dirname(configPath), "mods.local.config.json")));
  const modSandboxAllowedBuiltins = Array.isArray(options.modSandboxAllowedBuiltins) && options.modSandboxAllowedBuiltins.length
    ? options.modSandboxAllowedBuiltins.map(item => String(item || "").trim()).filter(Boolean)
    : [...MOD_SANDBOX_ALLOWED_BUILTINS_DEFAULT];
  const modSandboxAllowedPackages = Array.isArray(options.modSandboxAllowedPackages) && options.modSandboxAllowedPackages.length
    ? options.modSandboxAllowedPackages.map(item => String(item || "").trim()).filter(Boolean)
    : [...MOD_SANDBOX_ALLOWED_PACKAGES_DEFAULT];
  const internetGatewayClient = (
    options.internetGatewayClient &&
    typeof options.internetGatewayClient.request === "function"
  )
    ? options.internetGatewayClient
    : null;
  const sharedState = {
    counters: {}
  };

  let debug = {
    enabled: false,
    telemetryDebugSampleMs: 0,
    telemetryNoHandlerDebugMs: 0
  };
  let config = normalizeConfigShape({});
  let loadedAt = 0;
  let activeConfigPath = configPath;
  const catalogById = new Map();
  const runtimeById = new Map();

  function debugLog(...args) {
    if (debug.enabled !== true) return;
    log.debug?.("[MOD][DEBUG]", ...args);
  }

  function ensureModsDirectory() {
    fs.mkdirSync(modsRoot, { recursive: true });
  }

  function persistConfig() {
    writeJsonFile(activeConfigPath, config);
  }

  function readConfig() {
    const baseConfig = readJsonFile(configPath, {});
    const hasLocalOverride = fs.existsSync(localConfigPath);
    activeConfigPath = hasLocalOverride ? localConfigPath : configPath;
    config = normalizeConfigShape(hasLocalOverride ? readJsonFile(localConfigPath, {}) : baseConfig);
  }

  function incrementCounter(name = "", amount = 1) {
    const key = String(name || "").trim().toLowerCase() || "default";
    const step = Number.isFinite(Number(amount)) ? Number(amount) : 1;
    const current = Number(sharedState.counters[key] || 0);
    const next = current + step;
    sharedState.counters[key] = next;
    return next;
  }

  function sortCatalogRows(rows = []) {
    const list = Array.isArray(rows) ? rows : [];
    return [...list].sort((a, b) => {
      const idxA = config.order.indexOf(a.id);
      const idxB = config.order.indexOf(b.id);
      if (idxA >= 0 || idxB >= 0) {
        if (idxA < 0) return 1;
        if (idxB < 0) return -1;
        if (idxA !== idxB) return idxA - idxB;
      }
      return String(a.id || "").localeCompare(String(b.id || ""));
    });
  }

  function buildSnapshot() {
    const rows = sortCatalogRows([...catalogById.values()]).map(row => cloneJsonSafe(row, {}));
    const loaded = rows.filter(row => row.loaded === true).length;
    return {
      ok: true,
      total: rows.length,
      loaded,
      mods: rows,
      config: cloneJsonSafe(config, { enabled: [], order: [], disabled: [] }),
      debug: cloneJsonSafe(debug, {}),
      loadedAt
    };
  }

  function buildDescriptorFromFolder(folderPath) {
    const modJsonPath = path.join(folderPath, "mod.json");
    const modJson = parseJsonFile(modJsonPath, null);
    if (!modJson || typeof modJson !== "object" || Array.isArray(modJson)) return null;

    const folderName = path.basename(folderPath);
    const id = normalizeModId(modJson.id || folderName);
    if (!id) return null;

    const entry = normalizeRelativePath(modJson.entry || modJson.main || "index.js") || "index.js";
    const hooks = Array.isArray(modJson.hooks)
      ? modJson.hooks
          .map(item => String(item || "").trim())
          .filter(item => SUPPORTED_MOD_HOOKS.includes(item))
      : [];
    const readme = readFileIfExists(path.join(folderPath, "README.md"));
    const modInfo = readFileIfExists(path.join(folderPath, "mod-info.txt"));
    const uiConfig = modJson.ui && typeof modJson.ui === "object" && !Array.isArray(modJson.ui)
      ? modJson.ui
      : null;
    const uiEntry = normalizeRelativePath(uiConfig?.entry || "");
    const fallbackUiEntry = fs.existsSync(path.join(folderPath, "ui", "index.html"))
      ? "ui/index.html"
      : "";
    const finalUiEntry = uiEntry || fallbackUiEntry;
    const ui = finalUiEntry
      ? {
        title: String(uiConfig?.title || modJson.name || id).trim() || id,
        entry: finalUiEntry,
        mountDir: path.dirname(finalUiEntry) === "." ? "" : path.dirname(finalUiEntry),
        entryFile: path.basename(finalUiEntry)
      }
      : null;

    return {
      id,
      name: String(modJson.name || id).trim() || id,
      version: String(modJson.version || "0.0.0-local").trim() || "0.0.0-local",
      enabled: false,
      loaded: false,
      hooks,
      error: "",
      description: String(modJson.description || "").trim(),
      tooltip: String(modInfo || readme || modJson.description || "").trim(),
      ui,
      rootPath: folderPath,
      entry
    };
  }

  function discoverModDescriptors() {
    ensureModsDirectory();
    const entries = fs.readdirSync(modsRoot, { withFileTypes: true });
    const next = new Map();
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const folderPath = path.join(modsRoot, entry.name);
      const descriptor = buildDescriptorFromFolder(folderPath);
      if (!descriptor) continue;
      if (next.has(descriptor.id)) {
        debugLog(`duplicate mod id "${descriptor.id}" ignored at ${folderPath}`);
        continue;
      }
      next.set(descriptor.id, descriptor);
    }
    return next;
  }

  function applyConfigToCatalog() {
    const enabledSet = new Set(config.enabled);
    const disabledSet = new Set(config.disabled);
    for (const mod of catalogById.values()) {
      const enabled = enabledSet.has(mod.id) && !disabledSet.has(mod.id);
      mod.enabled = enabled;
      mod.loaded = false;
      mod.error = "";
    }
  }

  async function stopAllSandboxes() {
    for (const [id, runtime] of runtimeById.entries()) {
      const mod = catalogById.get(id);
      if (mod) mod.loaded = false;
      try {
        await runtime.invokeHook("onUnload", {
          at: Date.now()
        });
      } catch {}
      try {
        await runtime.shutdown();
      } catch {}
    }
    runtimeById.clear();
  }

  async function startEnabledSandboxes() {
    const ordered = sortCatalogRows([...catalogById.values()]);
    for (const mod of ordered) {
      if (mod.enabled !== true) {
        mod.loaded = false;
        continue;
      }
      try {
        const runtime = createModSandboxRuntime({
          modId: mod.id,
          modRoot: mod.rootPath,
          entryFile: mod.entry,
          projectRoot,
          allowedBuiltins: modSandboxAllowedBuiltins,
          allowedPackages: modSandboxAllowedPackages,
          hostApi: {
            sharedState,
            incrementCounter,
            internetGateway: internetGatewayClient
              ? {
                request: payload => internetGatewayClient.request(payload),
                getStatus: () => (
                  typeof internetGatewayClient.getStatus === "function"
                    ? internetGatewayClient.getStatus()
                    : null
                )
              }
              : null
          },
          log
        });
        runtimeById.set(mod.id, runtime);
        mod.loaded = true;
        mod.error = "";
        await runtime.invokeHook("onLoad", {
          at: Date.now()
        });
        await runtime.invokeHook("onBoot", {
          at: Date.now()
        });
      } catch (error) {
        runtimeById.delete(mod.id);
        mod.loaded = false;
        mod.error = error?.message || String(error);
      }
    }
  }

  async function refreshCatalogAndRuntimes() {
    const discovered = discoverModDescriptors();
    await stopAllSandboxes();
    catalogById.clear();
    for (const [id, descriptor] of discovered.entries()) {
      catalogById.set(id, descriptor);
    }
    applyConfigToCatalog();
    await startEnabledSandboxes();
    loadedAt = Number(now() || Date.now());
  }

  async function load() {
    readConfig();
    await refreshCatalogAndRuntimes();
    return buildSnapshot();
  }

  async function reload() {
    readConfig();
    await refreshCatalogAndRuntimes();
    return buildSnapshot();
  }

  function list() {
    return buildSnapshot();
  }

  function getSupportedHooks() {
    return [...SUPPORTED_MOD_HOOKS];
  }

  async function invokeHook(hook, payload = {}) {
    const hookName = String(hook || "").trim();
    const safePayload = payload && typeof payload === "object" ? cloneJsonSafe(payload, {}) : {};
    if (!SUPPORTED_MOD_HOOKS.includes(hookName)) {
      return {
        ok: false,
        hook: hookName,
        invoked: 0,
        failed: 0,
        errors: [],
        payloadEcho: safePayload
      };
    }

    let invoked = 0;
    let failed = 0;
    const errors = [];
    const ordered = sortCatalogRows([...catalogById.values()]);
    for (const mod of ordered) {
      if (mod.loaded !== true) continue;
      if (mod.hooks.length && !mod.hooks.includes(hookName)) continue;
      const runtime = runtimeById.get(mod.id);
      if (!runtime) continue;
      try {
        const result = await runtime.invokeHook(hookName, safePayload);
        if (result?.skipped === true) continue;
        invoked += 1;
      } catch (error) {
        failed += 1;
        errors.push({
          modId: mod.id,
          error: error?.message || String(error)
        });
      }
    }

    return {
      ok: failed === 0,
      hook: hookName,
      invoked,
      failed,
      errors,
      payloadEcho: safePayload
    };
  }

  function setDebugEnabled(enabled) {
    debug.enabled = enabled === true;
    debug.telemetryDebugSampleMs = debug.enabled ? 250 : 0;
    debug.telemetryNoHandlerDebugMs = debug.enabled ? 1000 : 0;
    return {
      ok: true,
      debug: cloneJsonSafe(debug, {})
    };
  }

  function clearDebugBuffer() {
    debug.telemetryDebugSampleMs = debug.enabled ? 250 : 0;
    debug.telemetryNoHandlerDebugMs = debug.enabled ? 1000 : 0;
    return {
      ok: true,
      debug: cloneJsonSafe(debug, {})
    };
  }

  async function updateConfig(patch = {}) {
    const source = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
    config = normalizeConfigShape({
      enabled: source.enabled === undefined ? config.enabled : source.enabled,
      order: source.order === undefined ? config.order : source.order,
      disabled: source.disabled === undefined ? config.disabled : source.disabled
    });
    persistConfig();
    if (source.reload !== false) {
      await refreshCatalogAndRuntimes();
    } else {
      applyConfigToCatalog();
      loadedAt = Number(now() || Date.now());
    }
    return {
      ok: true,
      config: cloneJsonSafe(config, {}),
      snapshot: buildSnapshot()
    };
  }

  function getUiCatalog() {
    const mods = sortCatalogRows([...catalogById.values()])
      .filter(mod => mod.ui && typeof mod.ui === "object")
      .map(mod => ({
        id: mod.id,
        name: mod.name,
        version: mod.version,
        enabled: mod.enabled === true,
        loaded: mod.loaded === true,
        title: String(mod.ui.title || mod.name || mod.id).trim(),
        entry: String(mod.ui.entry || "").trim(),
        url: mod.loaded === true ? `/mods-ui/${encodeURIComponent(mod.id)}/` : ""
      }));
    return {
      ok: true,
      mods
    };
  }

  function ensurePathWithin(rootPath, absolutePath) {
    const root = path.resolve(rootPath);
    const target = path.resolve(absolutePath);
    const rel = path.relative(root, target);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  }

  async function importMods(payload = {}) {
    const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
    const files = Array.isArray(source.files) ? source.files : [];
    if (!files.length) {
      return {
        ok: false,
        error: "missing_import_files"
      };
    }

    const normalizedRows = files.map(row => ({
      path: normalizeRelativePath(row?.path || ""),
      data: String(row?.data || "")
    })).filter(row => row.path && row.data);
    if (!normalizedRows.length) {
      return {
        ok: false,
        error: "invalid_import_files"
      };
    }

    const rootSegments = normalizedRows.map(row => row.path.split("/")[0]).filter(Boolean);
    const importFolder = normalizeModId(rootSegments[0] || `mod-${Date.now()}`) || `mod-${Date.now()}`;
    const targetRoot = path.join(modsRoot, importFolder);
    const overwrite = source.overwrite === true;
    if (fs.existsSync(targetRoot) && !overwrite) {
      return {
        ok: false,
        error: "mod_exists",
        modId: importFolder
      };
    }
    if (fs.existsSync(targetRoot) && overwrite) {
      fs.rmSync(targetRoot, { recursive: true, force: true });
    }

    for (const row of normalizedRows) {
      const parts = row.path.split("/").filter(Boolean);
      const relative = parts.length > 1 ? parts.slice(1).join("/") : parts[0];
      const safeRelative = normalizeRelativePath(relative);
      if (!safeRelative) continue;
      const target = path.resolve(targetRoot, safeRelative);
      if (!ensurePathWithin(targetRoot, target)) {
        return {
          ok: false,
          error: "invalid_import_path",
          detail: safeRelative
        };
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      try {
        fs.writeFileSync(target, decodeBase64ToBuffer(row.data));
      } catch {
        return {
          ok: false,
          error: "invalid_import_payload",
          detail: safeRelative
        };
      }
    }

    const descriptor = buildDescriptorFromFolder(targetRoot);
    if (!descriptor) {
      return {
        ok: false,
        error: "invalid_mod_json"
      };
    }

    const enabledSet = new Set(config.enabled);
    const disabledSet = new Set(config.disabled);
    if (source.enableAfterImport !== false) {
      enabledSet.add(descriptor.id);
      disabledSet.delete(descriptor.id);
    } else {
      enabledSet.delete(descriptor.id);
      disabledSet.add(descriptor.id);
    }
    if (!config.order.includes(descriptor.id)) config.order.push(descriptor.id);
    config.enabled = normalizeUniqueIdList([...enabledSet]);
    config.disabled = normalizeUniqueIdList([...disabledSet]);
    config.order = normalizeUniqueIdList(config.order);
    persistConfig();

    await refreshCatalogAndRuntimes();
    return {
      ok: true,
      modId: descriptor.id,
      importedFiles: normalizedRows.length,
      snapshot: buildSnapshot()
    };
  }

  async function invokeAction(modIdRaw = "", actionRaw = "", methodRaw = "GET", payloadRaw = {}) {
    const modId = normalizeModId(modIdRaw);
    const action = String(actionRaw || "").trim();
    const method = String(methodRaw || "GET").trim().toUpperCase() || "GET";
    const payload = normalizeHttpMap(payloadRaw);
    const mod = catalogById.get(modId);
    if (!mod) {
      return {
        status: 404,
        body: {
          ok: false,
          error: "mod_not_found",
          modId
        }
      };
    }
    if (!action) {
      return {
        status: 200,
        body: {
          ok: true,
          modId,
          loaded: mod.loaded === true,
          enabled: mod.enabled === true,
          hooks: mod.hooks
        }
      };
    }
    if (mod.loaded !== true) {
      return {
        status: 409,
        body: {
          ok: false,
          error: "mod_not_loaded",
          modId,
          action,
          method
        }
      };
    }

    const runtime = runtimeById.get(mod.id);
    if (!runtime) {
      return {
        status: 409,
        body: {
          ok: false,
          error: "mod_runtime_missing",
          modId
        }
      };
    }
    try {
      const result = await runtime.invokeAction(action, {
        at: Date.now(),
        method,
        ...payload
      });
      if (result?.skipped === true) {
        return {
          status: 404,
          body: {
            ok: false,
            error: "mod_action_not_found",
            modId,
            action
          }
        };
      }

      const envelope = normalizeActionHttpEnvelope(result?.result);
      if (envelope) {
        return envelope;
      }

      return {
        status: 200,
        body: {
          ok: true,
          modId,
          action,
          method,
          result: cloneJsonSafe(result?.result, null)
        }
      };
    } catch (error) {
      return {
        status: 500,
        body: {
          ok: false,
          error: "mod_action_failed",
          detail: error?.message || String(error),
          modId,
          action
        }
      };
    }
  }

  async function handleHttp(request = {}) {
    const source = request && typeof request === "object" && !Array.isArray(request) ? request : {};
    const modId = normalizeModId(source.modId || source.id || "");
    const actionPath = String(source.actionPath || source.action || "").trim();
    const method = String(source.method || "GET").trim().toUpperCase() || "GET";
    if (!modId || !actionPath) {
      return {
        handled: false,
        status: 404,
        body: {
          ok: false,
          error: "mod_action_not_found"
        }
      };
    }
    const response = await invokeAction(modId, actionPath, method, source);
    return {
      handled: true,
      status: Number(response?.status || 200),
      body: response?.body && typeof response.body === "object"
        ? cloneJsonSafe(response.body, { ok: true })
        : { ok: true }
    };
  }

  function resolveUiAsset(modIdRaw = "", requestedPath = "") {
    const modId = normalizeModId(modIdRaw);
    const mod = catalogById.get(modId);
    if (!mod || !mod.ui) {
      return {
        ok: false,
        error: "mod_ui_not_found"
      };
    }
    const mountDir = normalizeRelativePath(mod.ui.mountDir || "");
    const relative = normalizeRelativePath(requestedPath || "");
    const candidate = relative || normalizeRelativePath(mod.ui.entryFile || "index.html");
    const baseDir = path.resolve(mod.rootPath, mountDir || ".");
    const targetFile = path.resolve(baseDir, candidate);
    if (!ensurePathWithin(baseDir, targetFile)) {
      return {
        ok: false,
        error: "invalid_mod_ui_path"
      };
    }
    if (!fs.existsSync(targetFile) || !fs.statSync(targetFile).isFile()) {
      return {
        ok: false,
        error: "mod_ui_asset_not_found"
      };
    }
    return {
      ok: true,
      filePath: targetFile
    };
  }

  async function shutdown() {
    await stopAllSandboxes();
    return {
      ok: true,
      stoppedAt: Date.now()
    };
  }

  ensureModsDirectory();
  if (!fs.existsSync(configPath)) {
    persistConfig();
  }

  return {
    load,
    reload,
    list,
    getSupportedHooks,
    invokeHook,
    setDebugEnabled,
    clearDebugBuffer,
    updateConfig,
    getUiCatalog,
    importMods,
    invokeAction,
    handleHttp,
    resolveUiAsset,
    shutdown
  };
};
