const fs = require("fs");
const path = require("path");

const DEFAULT_CONFIG = {
  enabled: [],
  order: [],
  disabled: []
};

const SUPPORTED_HOOKS = new Set([
  "onLoad",
  "onBoot",
  "onRaveStart",
  "onRaveStop",
  "onIntent",
  "onTelemetry",
  "onShutdown",
  "onUnload",
  "onHttp"
]);
const MOD_INFO_FILE_CANDIDATES = [
  "mod-info.txt",
  "mod-info.md",
  "description.txt",
  "about.txt",
  "README.txt",
  "README.md"
];
const MAX_MOD_INFO_FILE_BYTES = 128 * 1024;
const MAX_MOD_SUMMARY_CHARS = 320;

function cloneJsonSafe(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => String(item || "").trim())
    .filter(Boolean);
}

function normalizeConfig(raw = {}) {
  return {
    enabled: normalizeStringArray(raw.enabled),
    order: normalizeStringArray(raw.order),
    disabled: normalizeStringArray(raw.disabled)
  };
}

function asErrorMessage(err) {
  if (!err) return "unknown error";
  if (err instanceof Error) return err.message || String(err);
  return String(err);
}

function sanitizeRelativeFilePath(value) {
  const raw = String(value || "").replace(/\\/g, "/").trim();
  if (!raw) return "";
  if (raw.includes("\0")) return "";

  const normalized = path.posix.normalize(raw);
  if (!normalized || normalized === "." || normalized === "..") return "";
  if (path.posix.isAbsolute(normalized)) return "";
  if (normalized.startsWith("../") || normalized.includes("/../")) return "";
  return normalized;
}

function collapseWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateSummary(value, maxChars = MAX_MOD_SUMMARY_CHARS) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, Math.max(0, maxChars - 3)).trimEnd();
  return `${cut}...`;
}

function sanitizeInlineMarkdown(value) {
  return collapseWhitespace(
    String(value || "")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
      .replace(/[*_~`>|]/g, "")
  );
}

function summarizeText(rawText, fallback = "") {
  const lines = String(rawText || "").replace(/\r/g, "").split("\n");
  const chunks = [];
  let inCodeFence = false;

  for (let line of lines) {
    const trimmed = String(line || "").trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    line = trimmed
      .replace(/^#{1,6}\s+/, "")
      .replace(/^[-*+]\s+/, "")
      .replace(/^\d+\.\s+/, "")
      .replace(/^>\s*/, "");

    const normalized = sanitizeInlineMarkdown(line);
    if (!normalized) continue;

    chunks.push(normalized);
    if (chunks.join(" ").length >= MAX_MOD_SUMMARY_CHARS) {
      break;
    }
  }

  const summary = truncateSummary(collapseWhitespace(chunks.join(" ")));
  if (summary) return summary;
  return truncateSummary(sanitizeInlineMarkdown(fallback));
}

function tryReadModInfoFile(baseDir, relativePath) {
  const rel = sanitizeRelativeFilePath(relativePath);
  if (!rel) return "";

  const root = path.resolve(String(baseDir || ""));
  if (!root) return "";
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) return "";

  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    return "";
  }

  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_MOD_INFO_FILE_BYTES) {
    return "";
  }

  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return "";
  }
}

function resolveModTooltip(baseDir, manifest = {}) {
  const manifestDescription = String(manifest?.description || "").trim();
  const manifestSummary = summarizeText(manifestDescription, "");
  const requestedInfoFile = String(
    manifest?.infoFile ||
    manifest?.summaryFile ||
    manifest?.tooltipFile ||
    manifest?.hoverTextFile ||
    ""
  ).trim();

  const seen = new Set();
  const candidates = [requestedInfoFile, ...MOD_INFO_FILE_CANDIDATES];
  for (const candidate of candidates) {
    const rel = sanitizeRelativeFilePath(candidate);
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);

    const fileText = tryReadModInfoFile(baseDir, rel);
    if (!fileText) continue;

    const summary = summarizeText(fileText, manifestDescription);
    if (summary) {
      return { text: summary, source: rel };
    }
  }

  return {
    text: manifestSummary,
    source: manifestSummary ? "manifest.description" : ""
  };
}

function resolveModUiDescriptor(baseDir, manifest = {}) {
  const root = path.resolve(String(baseDir || ""));
  if (!root) return null;

  const rawUi = manifest?.ui;
  let requestedEntry = "";
  let requestedTitle = "";

  if (typeof rawUi === "string") {
    requestedEntry = rawUi;
  } else if (rawUi && typeof rawUi === "object") {
    requestedEntry = String(
      rawUi.entry ?? rawUi.path ?? rawUi.file ?? ""
    ).trim();
    requestedTitle = String(rawUi.title ?? rawUi.name ?? "").trim();
  }

  const candidateSet = new Set();
  const candidates = [
    requestedEntry,
    "ui/index.html",
    "ui.html",
    "mod-ui/index.html",
    "mod-ui.html"
  ]
    .map(sanitizeRelativeFilePath)
    .filter(Boolean)
    .filter(rel => {
      if (candidateSet.has(rel)) return false;
      candidateSet.add(rel);
      return true;
    });

  for (const rel of candidates) {
    const abs = path.resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + path.sep)) continue;
    if (!fs.existsSync(abs)) continue;
    if (path.extname(abs).toLowerCase() !== ".html") continue;

    return {
      entry: path.relative(root, abs).split(path.sep).join("/"),
      entryPath: abs,
      assetRoot: path.dirname(abs),
      title:
        requestedTitle ||
        String(manifest?.name || manifest?.id || "MOD UI").trim() ||
        "MOD UI"
    };
  }

  return null;
}

function clamp(value, min, max, fallback = min) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeRgbState(input = {}, fallback = {}) {
  const base = input && typeof input === "object" ? input : {};
  const fallbackState = fallback && typeof fallback === "object" ? fallback : {};
  const r = Math.round(clamp(base.r, 0, 255, clamp(fallbackState.r, 0, 255, 0)));
  const g = Math.round(clamp(base.g, 0, 255, clamp(fallbackState.g, 0, 255, 0)));
  const b = Math.round(clamp(base.b, 0, 255, clamp(fallbackState.b, 0, 255, 0)));
  const dimming = Math.round(clamp(base.dimming, 1, 100, clamp(fallbackState.dimming, 1, 100, 100)));
  return { r, g, b, dimming };
}

function buildFixtureFilter(filters = {}) {
  const brand = String(filters.brand || "").trim().toLowerCase();
  const zone = String(filters.zone || "").trim().toLowerCase();
  const mode = String(filters.mode || "").trim().toLowerCase();
  const enabledOnly = filters.enabledOnly !== false;
  const configuredOnly = Boolean(filters.requireConfigured);

  return fixture => {
    if (!fixture || typeof fixture !== "object") return false;
    if (enabledOnly && fixture.enabled === false) return false;
    if (brand && String(fixture.brand || "").trim().toLowerCase() !== brand) return false;
    if (zone && String(fixture.zone || "").trim().toLowerCase() !== zone) return false;

    if (mode === "engine" && fixture.engineEnabled !== true) return false;
    if (mode === "twitch" && fixture.twitchEnabled !== true) return false;
    if (mode === "custom" && fixture.customEnabled !== true) return false;

    if (!configuredOnly) return true;
    if (fixture.brand === "hue") {
      return Boolean(fixture.bridgeIp) && Boolean(fixture.username) && Number(fixture.lightId) > 0;
    }
    if (fixture.brand === "wiz") {
      return Boolean(fixture.ip);
    }
    return true;
  };
}

function createStateGate(defaults = {}) {
  const lastByKey = new Map();
  const baseMinIntervalMs = Math.max(0, Math.round(Number(defaults.minIntervalMs) || 0));
  const baseMinColorDelta = Math.max(0, Math.round(Number(defaults.minColorDelta) || 0));
  const baseMinDimmingDelta = Math.max(0, Math.round(Number(defaults.minDimmingDelta) || 0));

  function reset(key = "") {
    const k = String(key || "").trim();
    if (!k) {
      lastByKey.clear();
      return;
    }
    lastByKey.delete(k);
  }

  function shouldSend(key, state, overrides = {}) {
    const k = String(key || "").trim();
    if (!k) return false;

    const nowMs = Number(overrides.nowMs || Date.now());
    const next = normalizeRgbState(state);
    const minIntervalMs = Math.max(
      0,
      Math.round(Number(overrides.minIntervalMs ?? baseMinIntervalMs) || 0)
    );
    const minColorDelta = Math.max(
      0,
      Math.round(Number(overrides.minColorDelta ?? baseMinColorDelta) || 0)
    );
    const minDimmingDelta = Math.max(
      0,
      Math.round(Number(overrides.minDimmingDelta ?? baseMinDimmingDelta) || 0)
    );

    const previous = lastByKey.get(k);
    if (previous) {
      const elapsed = nowMs - previous.at;
      if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < minIntervalMs) {
        return false;
      }

      const colorDelta = Math.max(
        Math.abs(next.r - previous.state.r),
        Math.abs(next.g - previous.state.g),
        Math.abs(next.b - previous.state.b)
      );
      const dimmingDelta = Math.abs(next.dimming - previous.state.dimming);
      if (colorDelta < minColorDelta && dimmingDelta < minDimmingDelta) {
        return false;
      }
    }

    lastByKey.set(k, {
      at: nowMs,
      state: next
    });
    return true;
  }

  function snapshot() {
    const out = {};
    for (const [key, value] of lastByKey.entries()) {
      out[key] = {
        at: value.at,
        state: { ...value.state }
      };
    }
    return out;
  }

  return {
    shouldSend,
    reset,
    snapshot
  };
}

module.exports = function createModLoader(options = {}) {
  const rootDir = path.resolve(String(options.rootDir || process.cwd()));
  const modsDir = path.resolve(String(options.modsDir || path.join(rootDir, "mods")));
  const configPath = path.resolve(String(options.configPath || path.join(modsDir, "mods.config.json")));
  const actions = options.actions && typeof options.actions === "object"
    ? options.actions
    : {};
  const logger = options.log || console;

  let activeConfig = normalizeConfig(DEFAULT_CONFIG);
  let entries = [];
  let loadedAt = 0;

  function ensureConfigFile() {
    try {
      if (!fs.existsSync(modsDir)) {
        fs.mkdirSync(modsDir, { recursive: true });
      }
      if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf8");
      }
    } catch (err) {
      logger.warn?.("[MODS] failed to prepare config file:", asErrorMessage(err));
    }
  }

  function loadConfig() {
    ensureConfigFile();
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
      activeConfig = normalizeConfig(raw);
    } catch (err) {
      logger.warn?.("[MODS] invalid config, using defaults:", asErrorMessage(err));
      activeConfig = normalizeConfig(DEFAULT_CONFIG);
    }
    return activeConfig;
  }

  function discoverEntries() {
    if (!fs.existsSync(modsDir)) return [];

    const config = activeConfig || loadConfig();
    const enabledSet = new Set(config.enabled);
    const disabledSet = new Set(config.disabled);
    const orderIndex = new Map(config.order.map((id, idx) => [id, idx]));

    const discovered = [];
    const topLevel = fs.readdirSync(modsDir, { withFileTypes: true });
    for (const dirent of topLevel) {
      if (!dirent.isDirectory()) continue;
      if (dirent.name.startsWith(".")) continue;

      const baseDir = path.join(modsDir, dirent.name);
      const manifestPath = path.join(baseDir, "mod.json");
      if (!fs.existsSync(manifestPath)) continue;

      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      } catch (err) {
        discovered.push({
          id: dirent.name,
          name: dirent.name,
          version: "0.0.0",
          description: "",
          tooltip: "",
          tooltipSource: "",
          dir: baseDir,
          manifestPath,
          enabled: false,
          loaded: false,
          instance: null,
          error: `invalid mod.json: ${asErrorMessage(err)}`,
          hooks: [],
          modulePath: "",
          ui: null
        });
        continue;
      }

      const id = String(manifest.id || dirent.name).trim() || dirent.name;
      const name = String(manifest.name || id).trim() || id;
      const version = String(manifest.version || "0.0.0").trim() || "0.0.0";
      const description = String(manifest.description || "").trim();
      const tooltip = resolveModTooltip(baseDir, manifest);
      const mainFile = String(manifest.main || "index.js").trim() || "index.js";
      const modulePath = path.join(baseDir, mainFile);
      const ui = resolveModUiDescriptor(baseDir, manifest);
      const enabledByConfig = enabledSet.size > 0 ? enabledSet.has(id) : Boolean(manifest.enabled);
      const enabled = enabledByConfig && !disabledSet.has(id);

      discovered.push({
        id,
        name,
        version,
        description,
        tooltip: tooltip.text,
        tooltipSource: tooltip.source,
        dir: baseDir,
        manifestPath,
        manifest,
        modulePath,
        enabled,
        loaded: false,
        instance: null,
        error: null,
        hooks: [],
        ui,
        order: orderIndex.has(id) ? orderIndex.get(id) : Number.MAX_SAFE_INTEGER
      });
    }

    discovered.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.id.localeCompare(b.id);
    });

    return discovered;
  }

  function makeApiFor(entry) {
    const prefix = `[MOD:${entry.id}]`;
    return {
      id: entry.id,
      manifest: cloneJsonSafe(entry.manifest || {}, {}),
      log(...args) {
        logger.log(prefix, ...args);
      },
      warn(...args) {
        logger.warn?.(prefix, ...args);
      },
      error(...args) {
        logger.error?.(prefix, ...args);
      },
      now() {
        return Date.now();
      },
      enqueueHue(state, zone = "default", options = {}) {
        return actions.enqueueHue?.(state, zone, options);
      },
      enqueueWiz(state, zone = "default", options = {}) {
        return actions.enqueueWiz?.(state, zone, options);
      },
      getEngineTelemetry() {
        return cloneJsonSafe(actions.getEngineTelemetry?.(), null);
      },
      getHueTelemetry() {
        return cloneJsonSafe(actions.getHueTelemetry?.(), null);
      },
      getWizTelemetry() {
        return cloneJsonSafe(actions.getWizTelemetry?.(), null);
      },
      getAudioTelemetry() {
        return cloneJsonSafe(actions.getAudioTelemetry?.(), null);
      },
      getFixtures() {
        return cloneJsonSafe(actions.getFixtures?.(), []);
      },
      getFixturesBy(filters = {}) {
        const safeFilters = cloneJsonSafe(filters, {});
        const fromActions = actions.getFixturesBy?.(safeFilters);
        if (Array.isArray(fromActions)) {
          return cloneJsonSafe(fromActions, []);
        }
        const fixtures = cloneJsonSafe(actions.getFixtures?.(), []);
        const filter = buildFixtureFilter(safeFilters);
        return fixtures.filter(filter);
      },
      getFixtureRoutes() {
        return cloneJsonSafe(actions.getFixtureRoutes?.(), {});
      },
      getIntentZones(intent, options = {}) {
        const zones = actions.getIntentZones?.(
          cloneJsonSafe(intent, {}),
          cloneJsonSafe(options, {})
        );
        if (Array.isArray(zones)) {
          return cloneJsonSafe(zones, []);
        }
        return [];
      },
      getStandaloneFixtures() {
        return cloneJsonSafe(actions.getStandaloneFixtures?.(), []);
      },
      async applyStandaloneState(id, statePatch = {}) {
        return cloneJsonSafe(
          await Promise.resolve(
            actions.applyStandaloneState?.(
              String(id || ""),
              cloneJsonSafe(statePatch, {})
            )
          ),
          { ok: false, error: "standalone apply unavailable" }
        );
      },
      getColorCommandConfig() {
        return cloneJsonSafe(actions.getColorCommandConfig?.(), {
          config: null,
          capabilities: null
        });
      },
      setColorCommandConfig(patch = {}) {
        return cloneJsonSafe(
          actions.setColorCommandConfig?.(cloneJsonSafe(patch, {})),
          { config: null, capabilities: null }
        );
      },
      normalizeRgbState(state, fallback = {}) {
        return normalizeRgbState(state, fallback);
      },
      createStateGate(defaults = {}) {
        return createStateGate(defaults);
      },
      getState() {
        return cloneJsonSafe(actions.getState?.(), null);
      }
    };
  }

  async function invokeSingle(entry, hookName, payload = {}) {
    if (!entry || !entry.loaded || !entry.instance) return;
    const handler = entry.instance[hookName];
    if (typeof handler !== "function") return;

    const api = makeApiFor(entry);
    const context = {
      hook: hookName,
      mod: {
        id: entry.id,
        name: entry.name,
        version: entry.version
      },
      api,
      now: Date.now()
    };

    await Promise.resolve(handler(payload, context));
  }

  async function teardown(reason = "reload") {
    for (const entry of entries) {
      if (!entry.loaded || !entry.instance) continue;
      try {
        await invokeSingle(entry, "onUnload", { reason });
      } catch (err) {
        logger.warn?.(`[MODS] ${entry.id} onUnload failed: ${asErrorMessage(err)}`);
      }
    }
  }

  async function instantiate(entry) {
    if (!entry.enabled) return entry;

    if (!entry.modulePath || !fs.existsSync(entry.modulePath)) {
      entry.loaded = false;
      entry.error = "mod entry file not found";
      return entry;
    }

    try {
      const resolved = require.resolve(entry.modulePath);
      delete require.cache[resolved];
      const loaded = require(resolved);
      const instance = typeof loaded === "function"
        ? loaded(makeApiFor(entry), cloneJsonSafe(entry.manifest || {}, {}))
        : loaded;

      if (!instance || typeof instance !== "object") {
        throw new Error("mod must export an object or factory returning an object");
      }

      entry.instance = instance;
      entry.loaded = true;
      entry.error = null;
      entry.hooks = Object.keys(instance).filter(name => SUPPORTED_HOOKS.has(name));

      await invokeSingle(entry, "onLoad", {
        loadedAt: Date.now()
      });
    } catch (err) {
      entry.loaded = false;
      entry.instance = null;
      entry.error = asErrorMessage(err);
      entry.hooks = [];
    }

    return entry;
  }

  async function load() {
    await teardown("reload");
    loadConfig();
    entries = discoverEntries();

    for (const entry of entries) {
      await instantiate(entry);
      if (entry.enabled && entry.loaded) {
        logger.log?.(`[MODS] loaded ${entry.id}@${entry.version}`);
      } else if (entry.enabled && !entry.loaded) {
        logger.warn?.(`[MODS] failed ${entry.id}: ${entry.error}`);
      }
    }

    loadedAt = Date.now();
    return list();
  }

  async function reload() {
    return load();
  }

  function list() {
    const loaded = entries.filter(entry => entry.loaded).length;
    return {
      ok: true,
      modsDir,
      configPath,
      loadedAt,
      total: entries.length,
      loaded,
      config: cloneJsonSafe(activeConfig, normalizeConfig(DEFAULT_CONFIG)),
      mods: entries.map(entry => ({
        id: entry.id,
        name: entry.name,
        version: entry.version,
        description: entry.description,
        tooltip: entry.tooltip || "",
        tooltipSource: entry.tooltipSource || "",
        dir: entry.dir,
        enabled: Boolean(entry.enabled),
        loaded: Boolean(entry.loaded),
        hooks: [...entry.hooks],
        ui: entry.ui
          ? {
              entry: entry.ui.entry,
              title: entry.ui.title
            }
          : null,
        error: entry.error
      }))
    };
  }

  function getModUi(modId) {
    const id = String(modId || "").trim();
    if (!id) return null;

    const entry = entries.find(item => item.id === id);
    if (!entry || !entry.ui) return null;

    return {
      id: entry.id,
      name: entry.name,
      version: entry.version,
      enabled: Boolean(entry.enabled),
      loaded: Boolean(entry.loaded),
      title: String(entry.ui.title || entry.name || entry.id).trim() || entry.id,
      entry: entry.ui.entry,
      entryPath: entry.ui.entryPath,
      assetRoot: entry.ui.assetRoot,
      dir: entry.dir
    };
  }

  function listModUis(options = {}) {
    const loadedOnly = options.loadedOnly !== false;
    return entries
      .filter(entry => entry.ui && (!loadedOnly || entry.loaded))
      .map(entry => ({
        id: entry.id,
        name: entry.name,
        version: entry.version,
        enabled: Boolean(entry.enabled),
        loaded: Boolean(entry.loaded),
        title: String(entry.ui.title || entry.name || entry.id).trim() || entry.id,
        entry: entry.ui.entry
      }));
  }

  async function invokeHook(hookName, payload = {}) {
    const hook = String(hookName || "").trim();
    if (!SUPPORTED_HOOKS.has(hook) || hook === "onHttp") {
      return {
        ok: false,
        hook,
        invoked: 0,
        failed: 0,
        errors: [{ modId: "*", message: "unsupported hook" }]
      };
    }

    const errors = [];
    let invoked = 0;
    for (const entry of entries) {
      if (!entry.loaded || !entry.instance) continue;
      if (typeof entry.instance[hook] !== "function") continue;
      invoked++;
      try {
        await invokeSingle(entry, hook, payload);
      } catch (err) {
        errors.push({
          modId: entry.id,
          message: asErrorMessage(err)
        });
      }
    }

    return {
      ok: errors.length === 0,
      hook,
      invoked,
      failed: errors.length,
      errors
    };
  }

  async function handleHttp(request = {}) {
    const modId = String(request.modId || "").trim();
    const action = String(request.action || "").trim();

    if (!modId) {
      return {
        handled: false,
        status: 400,
        body: { ok: false, error: "missing modId" }
      };
    }

    const entry = entries.find(item => item.id === modId);
    if (!entry || !entry.loaded || !entry.instance) {
      return {
        handled: false,
        status: 404,
        body: { ok: false, error: "mod not found or not loaded", modId }
      };
    }

    if (typeof entry.instance.onHttp !== "function") {
      return {
        handled: false,
        status: 404,
        body: { ok: false, error: "mod has no HTTP handler", modId }
      };
    }

    try {
      const payload = {
        action,
        method: String(request.method || "GET").toUpperCase(),
        path: String(request.path || ""),
        query: cloneJsonSafe(request.query || {}, {}),
        body: cloneJsonSafe(request.body || {}, {}),
        headers: cloneJsonSafe(request.headers || {}, {})
      };
      const context = {
        hook: "onHttp",
        mod: {
          id: entry.id,
          name: entry.name,
          version: entry.version
        },
        api: makeApiFor(entry),
        now: Date.now()
      };
      const result = await Promise.resolve(entry.instance.onHttp(payload, context));

      if (result && typeof result === "object") {
        return {
          handled: true,
          status: Number(result.status) || 200,
          body: result.body !== undefined ? result.body : result
        };
      }

      return {
        handled: true,
        status: 200,
        body: { ok: true, modId, action, result: result ?? null }
      };
    } catch (err) {
      return {
        handled: true,
        status: 500,
        body: {
          ok: false,
          modId,
          error: asErrorMessage(err)
        }
      };
    }
  }

  return {
    load,
    reload,
    list,
    getSupportedHooks() {
      return Array.from(SUPPORTED_HOOKS.values());
    },
    getModUi,
    listModUis,
    invokeHook,
    handleHttp
  };
};
