// [TITLE] Module: domains/mods/mod-sandbox.runtime.js
// [TITLE] Purpose: bounded VM sandbox runtime for executing trusted local mods
// [TITLE] Functionality Index:
// [TITLE] - evaluate mod entry modules in a restricted VM context
// [TITLE] - expose hook/action invocation with timeout/error isolation
// [TITLE] - enforce path and require boundaries to keep execution contained
// [DEV] Complex Flow:
// [DEV] We intentionally compile CommonJS-like modules inside VM contexts with a
// [DEV] restricted require implementation to prevent mods from importing arbitrary
// [DEV] packages or escaping their mod root directory.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const HOOK_TIMEOUT_MS = 1200;
const ACTION_TIMEOUT_MS = 15000;
const DEFAULT_ALLOWED_BUILTINS = Object.freeze([
  "path",
  "url",
  "util",
  "fs",
  "crypto",
  "child_process",
  "os"
]);
const DEFAULT_ALLOWED_PACKAGES = Object.freeze([
  "axios",
  "playwright"
]);
// [DEV] Require token normalization accepts both `node:fs` and `fs` while still
// [DEV] enforcing a strict allowlist.

function normalizeBuiltinToken(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.startsWith("node:") ? raw.slice("node:".length) : raw;
}

function normalizePackageToken(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("@")) {
    const parts = raw.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : raw;
  }
  return raw.split("/")[0];
}

function sanitizeScriptPath(rootPath, requestPath) {
  const absolute = path.resolve(rootPath, requestPath);
  const root = path.resolve(rootPath);
  const rel = path.relative(root, absolute);
  if (!(rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)))) {
    throw new Error("mod require path escaped mod root");
  }
  return absolute;
}

function resolveScriptFile(rootPath, requestPath) {
  const safeBase = sanitizeScriptPath(rootPath, requestPath);
  const candidates = [
    safeBase,
    `${safeBase}.js`,
    `${safeBase}.json`,
    path.join(safeBase, "index.js")
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  throw new Error(`cannot resolve module path: ${requestPath}`);
}

function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    Promise.resolve(promise)
      .then(value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
  });
}

function normalizeActionToken(value) {
  return String(value || "").trim().toLowerCase();
}

module.exports = function createModSandboxRuntime(options = {}) {
  const modId = String(options.modId || "").trim();
  const modRoot = path.resolve(String(options.modRoot || ""));
  const entryFile = resolveScriptFile(modRoot, String(options.entryFile || "index.js"));
  const log = options.log && typeof options.log === "object" ? options.log : console;
  const projectRoot = path.resolve(String(options.projectRoot || modRoot));
  const manifest = options.manifest && typeof options.manifest === "object" && !Array.isArray(options.manifest)
    ? { ...options.manifest }
    : {};
  const allowedBuiltins = new Set(
    Array.isArray(options.allowedBuiltins) && options.allowedBuiltins.length
      ? options.allowedBuiltins.map(item => normalizeBuiltinToken(item)).filter(Boolean)
      : DEFAULT_ALLOWED_BUILTINS
  );
  const allowedPackages = new Set(
    Array.isArray(options.allowedPackages) && options.allowedPackages.length
      ? options.allowedPackages.map(item => normalizePackageToken(item)).filter(Boolean)
      : DEFAULT_ALLOWED_PACKAGES
  );
  const hostApi = options.hostApi && typeof options.hostApi === "object" ? options.hostApi : {};
  const moduleCache = new Map();
  let closed = false;

  function logger(level, message, ...rest) {
    const fn = typeof log[level] === "function" ? log[level] : log.log;
    fn(`[MOD:${modId}] ${String(message || "")}`, ...rest);
  }

  function buildModApi(meta = {}) {
    const internetGateway = (
      hostApi.internetGateway &&
      typeof hostApi.internetGateway.request === "function"
    )
      ? {
        request: payload => hostApi.internetGateway.request(payload),
        getStatus: () => (
          typeof hostApi.internetGateway.getStatus === "function"
            ? hostApi.internetGateway.getStatus()
            : null
        )
      }
      : null;
    return Object.freeze({
      modId,
      id: modId,
      rootDir: modRoot,
      manifest: Object.freeze({ ...manifest }),
      now: Date.now,
      log: (...args) => logger("log", ...args),
      info: (...args) => logger("info", ...args),
      warn: (...args) => logger("warn", ...args),
      error: (...args) => logger("error", ...args),
      debug: (...args) => logger("debug", ...args),
      meta: Object.freeze({ ...meta }),
      sharedState: hostApi.sharedState || {},
      internetGateway,
      incrementCounter(name = "", amount = 1) {
        if (typeof hostApi.incrementCounter !== "function") return 0;
        return hostApi.incrementCounter(String(name || "").trim(), Number(amount || 1));
      }
    });
  }

  function evaluateModule(filePath) {
    const normalizedPath = path.resolve(filePath);
    if (moduleCache.has(normalizedPath)) {
      return moduleCache.get(normalizedPath).exports;
    }

    const source = fs.readFileSync(normalizedPath, "utf8");
    const isJson = normalizedPath.toLowerCase().endsWith(".json");
    const moduleRecord = {
      exports: {},
      loaded: false,
      filename: normalizedPath
    };
    moduleCache.set(normalizedPath, moduleRecord);

    if (isJson) {
      moduleRecord.exports = JSON.parse(source);
      moduleRecord.loaded = true;
      return moduleRecord.exports;
    }

    const sandboxGlobal = {
      console: Object.freeze({
        log: (...args) => logger("log", ...args),
        info: (...args) => logger("info", ...args),
        warn: (...args) => logger("warn", ...args),
        error: (...args) => logger("error", ...args),
        debug: (...args) => logger("debug", ...args)
      }),
      Buffer,
      TextEncoder,
      TextDecoder,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      queueMicrotask,
      URL,
      URLSearchParams,
      process: Object.freeze({
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        cwd: () => projectRoot,
        env: Object.freeze({ ...process.env }),
        versions: Object.freeze({
          node: process.versions?.node || ""
        })
      })
    };
    sandboxGlobal.globalThis = sandboxGlobal;

    const context = vm.createContext(sandboxGlobal, {
      codeGeneration: { strings: false, wasm: false },
      name: `mod-sandbox:${modId}`
    });
    const wrapper = `(function (exports, module, require, __filename, __dirname, api) {\n${source}\n})`;
    const script = new vm.Script(wrapper, {
      filename: normalizedPath,
      displayErrors: true
    });
    const compiled = script.runInContext(context, {
      timeout: 1000
    });

    function restrictedRequire(request) {
      const token = String(request || "").trim();
      if (!token) throw new Error("empty require token");
      const builtinToken = normalizeBuiltinToken(token);
      if (builtinToken && allowedBuiltins.has(builtinToken)) {
        return require(`node:${builtinToken}`);
      }
      if (token.startsWith("./") || token.startsWith("../")) {
        const resolved = resolveScriptFile(path.dirname(normalizedPath), token);
        const safe = sanitizeScriptPath(modRoot, path.relative(modRoot, resolved));
        return evaluateModule(safe);
      }
      const packageToken = normalizePackageToken(token);
      if (packageToken && allowedPackages.has(packageToken)) {
        return require(token);
      }
      throw new Error(`require("${token}") is not allowed in sandbox`);
    }

    compiled(
      moduleRecord.exports,
      moduleRecord,
      restrictedRequire,
      normalizedPath,
      path.dirname(normalizedPath),
      buildModApi({ phase: "module_load" })
    );
    moduleRecord.loaded = true;
    return moduleRecord.exports;
  }

  const exportsObject = evaluateModule(entryFile);
  if (typeof exportsObject === "function") {
    throw new Error(
      "legacy_factory_export_unsupported: mod entry must export an object (for example { hooks, actions })."
    );
  }
  const resolvedModule = exportsObject;

  function getHookHandler(hookName = "") {
    const hook = String(hookName || "").trim();
    if (!hook) return null;
    const hooks = resolvedModule && typeof resolvedModule.hooks === "object" ? resolvedModule.hooks : null;
    if (hooks && typeof hooks[hook] === "function") return hooks[hook];
    if (typeof resolvedModule?.[hook] === "function") return resolvedModule[hook];
    return null;
  }

  function getActionHandler(actionName = "") {
    const action = normalizeActionToken(actionName);
    if (!action) return null;
    const actions = resolvedModule && typeof resolvedModule.actions === "object" ? resolvedModule.actions : null;
    if (actions) {
      const direct = actions[action];
      if (typeof direct === "function") return direct;
      for (const [rawKey, fn] of Object.entries(actions)) {
        if (normalizeActionToken(rawKey) === action && typeof fn === "function") return fn;
      }
    }
    if (typeof resolvedModule?.[action] === "function") return resolvedModule[action];
    return null;
  }

  async function invokeHook(hookName, payload = {}) {
    if (closed) throw new Error("sandbox runtime is closed");
    const handler = getHookHandler(hookName);
    if (!handler) {
      return {
        ok: false,
        skipped: true,
        reason: "hook_not_implemented"
      };
    }
    const safePayload = payload && typeof payload === "object" ? { ...payload } : {};
    const hookApi = buildModApi({ phase: "hook", hook: String(hookName || "") });
    const hookCall = Promise.resolve(handler({
      payload: safePayload,
      api: hookApi
    }));
    const result = await withTimeout(
      hookCall,
      HOOK_TIMEOUT_MS,
      `hook:${String(hookName || "")}`
    );
    return {
      ok: true,
      skipped: false,
      result
    };
  }

  async function invokeAction(actionName, payload = {}) {
    if (closed) throw new Error("sandbox runtime is closed");
    const handler = getActionHandler(actionName);
    if (!handler) {
      return {
        ok: false,
        skipped: true,
        reason: "action_not_implemented"
      };
    }
    const safePayload = payload && typeof payload === "object" ? { ...payload } : {};
    const actionApi = buildModApi({ phase: "action", action: normalizeActionToken(actionName) });
    const actionCall = Promise.resolve(handler({
      payload: safePayload,
      api: actionApi
    }));
    const result = await withTimeout(
      actionCall,
      ACTION_TIMEOUT_MS,
      `action:${normalizeActionToken(actionName)}`
    );
    return {
      ok: true,
      skipped: false,
      result
    };
  }

  async function shutdown() {
    closed = true;
    const shutdownHook = getHookHandler("onShutdown");
    if (!shutdownHook) return { ok: true, called: false };
    const shutdownApi = buildModApi({ phase: "shutdown" });
    const shutdownCall = Promise.resolve(shutdownHook({
      payload: {},
      api: shutdownApi
    }));
    try {
      await withTimeout(
        shutdownCall,
        HOOK_TIMEOUT_MS,
        "hook:onShutdown"
      );
      return { ok: true, called: true };
    } catch (error) {
      return { ok: false, called: true, error: error?.message || String(error) };
    }
  }

  return {
    entryFile,
    exportsObject: resolvedModule,
    invokeHook,
    invokeAction,
    shutdown
  };
};
