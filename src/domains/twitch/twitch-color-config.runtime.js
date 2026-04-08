// [TITLE] Module: domains/twitch/twitch-color-config.runtime.js
// [TITLE] Purpose: Twitch color command config runtime and prefix parsing
// [TITLE] Functionality Index:
// [TITLE] - sanitize/read/write twitch color command config
// [TITLE] - support brand and fixture-scoped prefixes
// [TITLE] - normalize rave-off profile command maps

const fs = require("fs");
const path = require("path");
const { parseBoolean } = require("../../shared/validation/parse-boolean");

const DEFAULT_TARGETS = new Set(["hue", "wiz", "both", "other"]);
const DEFAULT_PREFIX_RE = /^[a-z][a-z0-9_-]{0,31}$/;

module.exports = function createTwitchColorConfigRuntime(options = {}) {
  const configPath = String(options.configPath || "").trim();
  if (!configPath) {
    throw new Error("createTwitchColorConfigRuntime requires configPath");
  }

  const configDefault = options.configDefault && typeof options.configDefault === "object"
    ? options.configDefault
    : {
      version: 1,
      defaultTarget: "hue",
      autoDefaultTarget: true,
      prefixes: { hue: "", wiz: "wiz", other: "" },
      fixturePrefixes: {},
      raveOff: { enabled: true, defaultText: "random", groups: {}, fixtures: {} }
    };
  const colorTargets = options.colorTargets instanceof Set ? options.colorTargets : DEFAULT_TARGETS;
  const prefixRegex = options.prefixRegex instanceof RegExp ? options.prefixRegex : DEFAULT_PREFIX_RE;
  const normalizeRouteZoneToken = typeof options.normalizeRouteZoneToken === "function"
    ? options.normalizeRouteZoneToken
    : ((value, fallback = "") => String(value || fallback || "").trim().toLowerCase());

  function sanitizePrefix(value, fallback = "") {
    const token = String(value || "").trim().toLowerCase();
    if (!token) return "";
    if (prefixRegex.test(token)) return token;
    return String(fallback || "").trim().toLowerCase();
  }

  function sanitizeTarget(value, fallback = "hue") {
    const token = String(value || "").trim().toLowerCase();
    if (colorTargets.has(token)) return token;
    const fallbackToken = String(fallback || "hue").trim().toLowerCase();
    return colorTargets.has(fallbackToken) ? fallbackToken : "hue";
  }

  function sanitizeCommandText(value, fallback = "") {
    const source = String(value || "").replace(/\s+/g, " ").trim();
    if (!source) return String(fallback || "").replace(/\s+/g, " ").trim();
    return source.slice(0, 96);
  }

  function sanitizeRaveOffGroupKey(value) {
    const source = String(value || "").trim().toLowerCase();
    if (!source) return "";
    const [brandRaw, zoneRaw = ""] = source.split(":", 2);
    const brand = brandRaw === "hue" || brandRaw === "wiz" ? brandRaw : "";
    if (!brand) return "";
    const zone = normalizeRouteZoneToken(zoneRaw, "");
    if (!zone) return brand;
    if (zone === "*" || zone === "all") return `${brand}:all`;
    if (!/^[a-z0-9_-]{1,48}$/.test(zone)) return "";
    return `${brand}:${zone}`;
  }

  function sanitizeRaveOffGroupMap(input = {}) {
    const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const out = {};
    const entries = Object.entries(raw)
      .map(([key, value]) => [sanitizeRaveOffGroupKey(key), sanitizeCommandText(value, "")])
      .filter(([key, value]) => key && value)
      .sort((a, b) => a[0].localeCompare(b[0]));
    for (const [key, value] of entries) out[key] = value;
    return out;
  }

  function sanitizeRaveOffFixtureMap(input = {}) {
    const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const out = {};
    const entries = Object.entries(raw)
      .map(([fixtureId, value]) => [String(fixtureId || "").trim(), sanitizeCommandText(value, "")])
      .filter(([fixtureId, value]) => fixtureId && value)
      .sort((a, b) => a[0].localeCompare(b[0]));
    for (const [key, value] of entries) out[key] = value;
    return out;
  }

  function sanitizeRaveOffConfig(input = {}, fallback = configDefault.raveOff) {
    const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const base = fallback && typeof fallback === "object" ? fallback : configDefault.raveOff;
    return {
      enabled: parseBoolean(raw.enabled, base.enabled === true),
      defaultText: sanitizeCommandText(raw.defaultText, base.defaultText || ""),
      groups: sanitizeRaveOffGroupMap(raw.groups || base.groups || {}),
      fixtures: sanitizeRaveOffFixtureMap(raw.fixtures || base.fixtures || {})
    };
  }

  function sanitizeFixturePrefixMap(input = {}, optionsOverride = {}) {
    const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const reservedPrefixes = new Set(
      Array.isArray(optionsOverride.reservedPrefixes)
        ? optionsOverride.reservedPrefixes.map(item => String(item || "").trim().toLowerCase()).filter(Boolean)
        : []
    );
    const out = {};
    const seen = new Set();
    const entries = Object.entries(raw)
      .map(([fixtureId, prefix]) => [String(fixtureId || "").trim(), prefix])
      .filter(([fixtureId]) => fixtureId)
      .sort((a, b) => a[0].localeCompare(b[0]));

    for (const [fixtureId, prefix] of entries) {
      const safePrefix = sanitizePrefix(prefix, "");
      if (!safePrefix) continue;
      if (reservedPrefixes.has(safePrefix)) continue;
      if (seen.has(safePrefix)) continue;
      out[fixtureId] = safePrefix;
      seen.add(safePrefix);
    }
    return out;
  }

  function sanitizeConfig(input = {}) {
    // [DEV] Prefix deduping is deliberate:
    // [DEV] duplicate tokens are removed to keep command parsing deterministic.
    const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const rawPrefixes = raw.prefixes && typeof raw.prefixes === "object" ? raw.prefixes : {};
    const rawFixturePrefixes =
      raw.fixturePrefixes && typeof raw.fixturePrefixes === "object" && !Array.isArray(raw.fixturePrefixes)
        ? raw.fixturePrefixes
        : {};
    const hasHue = Object.prototype.hasOwnProperty.call(rawPrefixes, "hue");
    const hasWiz = Object.prototype.hasOwnProperty.call(rawPrefixes, "wiz");
    const hasOther = Object.prototype.hasOwnProperty.call(rawPrefixes, "other");
    const huePrefix = hasHue
      ? sanitizePrefix(rawPrefixes.hue, "")
      : sanitizePrefix(configDefault.prefixes.hue, "");
    const wizPrefix = hasWiz
      ? sanitizePrefix(rawPrefixes.wiz, "")
      : sanitizePrefix(configDefault.prefixes.wiz, "wiz");
    const otherPrefix = hasOther
      ? sanitizePrefix(rawPrefixes.other, "")
      : sanitizePrefix(configDefault.prefixes.other, "");

    const dedupedPrefixes = {
      hue: "",
      wiz: "",
      other: ""
    };
    const seenBrandPrefixes = new Set();
    for (const [brand, prefix] of [["hue", huePrefix], ["wiz", wizPrefix], ["other", otherPrefix]]) {
      if (!prefix) continue;
      if (seenBrandPrefixes.has(prefix)) continue;
      dedupedPrefixes[brand] = prefix;
      seenBrandPrefixes.add(prefix);
    }

    return {
      version: 1,
      defaultTarget: sanitizeTarget(raw.defaultTarget, configDefault.defaultTarget),
      autoDefaultTarget: parseBoolean(raw.autoDefaultTarget, parseBoolean(configDefault.autoDefaultTarget, true)),
      prefixes: dedupedPrefixes,
      fixturePrefixes: sanitizeFixturePrefixMap(rawFixturePrefixes, {
        reservedPrefixes: [...seenBrandPrefixes]
      }),
      raveOff: sanitizeRaveOffConfig(raw.raveOff, configDefault.raveOff)
    };
  }

  function readConfig() {
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
      return sanitizeConfig(parsed);
    } catch {
      return sanitizeConfig(configDefault);
    }
  }

  function writeConfig(config) {
    const safe = sanitizeConfig(config);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(safe, null, 2)}\n`, "utf8");
    return safe;
  }

  const runtime = writeConfig(readConfig());

  function getSnapshot() {
    return {
      version: runtime.version,
      defaultTarget: runtime.defaultTarget,
      autoDefaultTarget: runtime.autoDefaultTarget !== false,
      prefixes: { ...runtime.prefixes },
      fixturePrefixes: { ...(runtime.fixturePrefixes || {}) },
      raveOff: {
        ...(runtime.raveOff || {}),
        groups: { ...(runtime.raveOff?.groups || {}) },
        fixtures: { ...(runtime.raveOff?.fixtures || {}) }
      }
    };
  }

  function patch(patchInput = {}) {
    // [DEV] Patch merge keeps compat behavior:
    // [DEV] setting defaultTarget implicitly disables auto default unless caller
    // [DEV] explicitly provides autoDefaultTarget.
    const rawPatch = patchInput && typeof patchInput === "object" ? patchInput : {};
    const hasDefaultTarget = Object.prototype.hasOwnProperty.call(rawPatch, "defaultTarget");
    const hasAutoDefaultTarget = Object.prototype.hasOwnProperty.call(rawPatch, "autoDefaultTarget");
    const hasFixturePrefixes =
      rawPatch.fixturePrefixes &&
      typeof rawPatch.fixturePrefixes === "object" &&
      !Array.isArray(rawPatch.fixturePrefixes);
    const hasRaveOffPatch =
      rawPatch.raveOff &&
      typeof rawPatch.raveOff === "object" &&
      !Array.isArray(rawPatch.raveOff);
    const raveOffPatch = hasRaveOffPatch ? rawPatch.raveOff : {};
    const merged = {
      ...runtime,
      ...rawPatch,
      autoDefaultTarget: hasAutoDefaultTarget
        ? rawPatch.autoDefaultTarget
        : hasDefaultTarget
          ? false
          : runtime.autoDefaultTarget,
      prefixes: {
        ...runtime.prefixes,
        ...(rawPatch.prefixes && typeof rawPatch.prefixes === "object" ? rawPatch.prefixes : {})
      },
      fixturePrefixes: hasFixturePrefixes
        ? { ...rawPatch.fixturePrefixes }
        : { ...(runtime.fixturePrefixes || {}) },
      raveOff: hasRaveOffPatch
        ? {
          ...(runtime.raveOff || {}),
          ...raveOffPatch,
          groups:
            raveOffPatch.groups && typeof raveOffPatch.groups === "object" && !Array.isArray(raveOffPatch.groups)
              ? { ...raveOffPatch.groups }
              : { ...(runtime.raveOff?.groups || {}) },
          fixtures:
            raveOffPatch.fixtures && typeof raveOffPatch.fixtures === "object" && !Array.isArray(raveOffPatch.fixtures)
              ? { ...raveOffPatch.fixtures }
              : { ...(runtime.raveOff?.fixtures || {}) }
        }
        : {
          ...(runtime.raveOff || {}),
          groups: { ...(runtime.raveOff?.groups || {}) },
          fixtures: { ...(runtime.raveOff?.fixtures || {}) }
        }
    };
    const next = writeConfig(merged);
    runtime.version = next.version;
    runtime.defaultTarget = next.defaultTarget;
    runtime.autoDefaultTarget = next.autoDefaultTarget !== false;
    runtime.prefixes = { ...next.prefixes };
    runtime.fixturePrefixes = { ...next.fixturePrefixes };
    runtime.raveOff = {
      ...next.raveOff,
      groups: { ...(next.raveOff?.groups || {}) },
      fixtures: { ...(next.raveOff?.fixtures || {}) }
    };
    return getSnapshot();
  }

  function parseColorTarget(raw, fallback = "both") {
    return sanitizeTarget(raw, fallback);
  }

  function splitPrefixedColorText(rawText, prefixes = {}, fixturePrefixes = {}) {
    // [DEV] Candidate sorting prioritizes:
    // [DEV] 1) longer prefix, 2) fixture prefix over brand prefix.
    // [DEV] This avoids short generic brand tokens hijacking fixture-scoped intent.
    const source = String(rawText || "").trim();
    if (!source) return { target: null, prefix: "", text: "", fixtureId: "" };

    const fixtureCandidates = Object.entries(fixturePrefixes && typeof fixturePrefixes === "object" ? fixturePrefixes : {})
      .map(([fixtureId, prefix]) => ({
        target: null,
        fixtureId: String(fixtureId || "").trim(),
        prefix: sanitizePrefix(prefix, ""),
        scope: "fixture"
      }))
      .filter(entry => entry.fixtureId && entry.prefix);
    const brandCandidates = [
      { target: "hue", prefix: sanitizePrefix(prefixes.hue, "") },
      { target: "wiz", prefix: sanitizePrefix(prefixes.wiz, "") },
      { target: "other", prefix: sanitizePrefix(prefixes.other, "") }
    ]
      .map(entry => ({ ...entry, fixtureId: "", scope: "brand" }))
      .filter(entry => entry.prefix);
    const candidates = [...fixtureCandidates, ...brandCandidates]
      .sort((a, b) => {
        const byPrefixLength = b.prefix.length - a.prefix.length;
        if (byPrefixLength !== 0) return byPrefixLength;
        if (a.scope !== b.scope) return a.scope === "fixture" ? -1 : 1;
        return a.scope === "fixture"
          ? String(a.fixtureId).localeCompare(String(b.fixtureId))
          : String(a.target).localeCompare(String(b.target));
      });

    const lower = source.toLowerCase();
    for (const entry of candidates) {
      const token = entry.prefix;
      if (
        lower === token ||
        lower.startsWith(`${token} `) ||
        lower.startsWith(`${token}:`) ||
        lower.startsWith(`${token}=`) ||
        lower.startsWith(`${token}-`)
      ) {
        let rest = source.slice(token.length).trim();
        rest = rest.replace(/^[:=\-]+/, "").trim();
        return {
          target: entry.target,
          prefix: token,
          text: rest,
          fixtureId: entry.fixtureId || ""
        };
      }
    }

    return {
      target: null,
      prefix: "",
      text: source,
      fixtureId: ""
    };
  }

  function getCapabilities(fixtures = []) {
    const hasOther = (Array.isArray(fixtures) ? fixtures : []).some(fixture => {
      const brand = String(fixture?.brand || "").trim().toLowerCase();
      return Boolean(brand && brand !== "hue" && brand !== "wiz");
    });
    return {
      hue: true,
      wiz: true,
      other: hasOther
    };
  }

  function getLoadSummary() {
    return {
      defaultTarget: runtime.defaultTarget,
      autoDefaultTarget: runtime.autoDefaultTarget !== false,
      prefixes: { ...runtime.prefixes },
      fixturePrefixCount: Object.keys(runtime.fixturePrefixes || {}).length,
      raveOffEnabled: runtime.raveOff?.enabled === true
    };
  }

  return {
    sanitizeCommandText,
    sanitizeRaveOffGroupKey,
    sanitizeRaveOffConfig,
    getSnapshot,
    patch,
    parseColorTarget,
    splitPrefixedColorText,
    getCapabilities,
    getLoadSummary
  };
};
