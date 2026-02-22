// [TITLE] Module: core/twitch-color-runtime.js
// [TITLE] Purpose: twitch color command config + prefix parsing runtime

module.exports = function createTwitchColorRuntime(deps = {}) {
  const {
    fs,
    path,
    configPath,
    configDefault,
    colorTargets,
    prefixRegex,
    parseBoolean,
    normalizeRouteZoneToken
  } = deps;

  const parseBool = typeof parseBoolean === "function"
    ? parseBoolean
    : ((value, fallback = false) => (value === undefined ? fallback : Boolean(value)));
  const normalizeZoneToken = typeof normalizeRouteZoneToken === "function"
    ? normalizeRouteZoneToken
    : ((value, fallback = "") => {
      const token = String(value || "").trim().toLowerCase();
      return token || fallback;
    });
  const targetSet = colorTargets instanceof Set
    ? colorTargets
    : new Set(["hue", "wiz", "both", "other"]);
  const prefixRe = prefixRegex instanceof RegExp
    ? prefixRegex
    : /^[a-z][a-z0-9_-]{0,31}$/;
  const fallbackDefault = configDefault && typeof configDefault === "object"
    ? configDefault
    : {
      version: 1,
      defaultTarget: "hue",
      autoDefaultTarget: true,
      prefixes: { hue: "", wiz: "wiz", other: "" },
      fixturePrefixes: {},
      raveOff: { enabled: true, defaultText: "random", groups: {}, fixtures: {} }
    };

  function sanitizeTwitchColorPrefix(value, fallback = "") {
    const token = String(value || "").trim().toLowerCase();
    if (!token) return "";
    if (prefixRe.test(token)) return token;
    return String(fallback || "").trim().toLowerCase();
  }

  function sanitizeTwitchColorTarget(value, fallback = "hue") {
    const target = String(value || "").trim().toLowerCase();
    if (targetSet.has(target)) return target;
    const safeFallback = String(fallback || "hue").trim().toLowerCase();
    return targetSet.has(safeFallback) ? safeFallback : "hue";
  }

  function sanitizeTwitchColorCommandText(value, fallback = "") {
    const source = String(value || "").replace(/\s+/g, " ").trim();
    if (!source) return String(fallback || "").replace(/\s+/g, " ").trim();
    return source.slice(0, 96);
  }

  function sanitizeTwitchRaveOffGroupKey(value) {
    const source = String(value || "").trim().toLowerCase();
    if (!source) return "";
    const [brandRaw, zoneRaw = ""] = source.split(":", 2);
    const brand = brandRaw === "hue" || brandRaw === "wiz" ? brandRaw : "";
    if (!brand) return "";
    const zone = normalizeZoneToken(zoneRaw, "");
    if (!zone) return brand;
    if (zone === "*" || zone === "all") return `${brand}:all`;
    if (!/^[a-z0-9_-]{1,48}$/.test(zone)) return "";
    return `${brand}:${zone}`;
  }

  function sanitizeTwitchRaveOffGroupMap(input = {}) {
    const rawMap =
      input && typeof input === "object" && !Array.isArray(input)
        ? input
        : {};
    const safe = {};
    const entries = Object.entries(rawMap)
      .map(([key, value]) => [sanitizeTwitchRaveOffGroupKey(key), sanitizeTwitchColorCommandText(value, "")])
      .filter(([key, value]) => key && value)
      .sort((a, b) => a[0].localeCompare(b[0]));
    for (const [key, value] of entries) safe[key] = value;
    return safe;
  }

  function sanitizeTwitchRaveOffFixtureMap(input = {}) {
    const rawMap =
      input && typeof input === "object" && !Array.isArray(input)
        ? input
        : {};
    const safe = {};
    const entries = Object.entries(rawMap)
      .map(([fixtureId, value]) => [String(fixtureId || "").trim(), sanitizeTwitchColorCommandText(value, "")])
      .filter(([fixtureId, value]) => fixtureId && value)
      .sort((a, b) => a[0].localeCompare(b[0]));
    for (const [fixtureId, value] of entries) safe[fixtureId] = value;
    return safe;
  }

  function sanitizeTwitchRaveOffConfig(input = {}, fallback = fallbackDefault.raveOff) {
    const raw =
      input && typeof input === "object" && !Array.isArray(input)
        ? input
        : {};
    const base =
      fallback && typeof fallback === "object" && !Array.isArray(fallback)
        ? fallback
        : fallbackDefault.raveOff;
    return {
      enabled: parseBool(raw.enabled, base.enabled === true),
      defaultText: sanitizeTwitchColorCommandText(raw.defaultText, base.defaultText || ""),
      groups: sanitizeTwitchRaveOffGroupMap(raw.groups || base.groups || {}),
      fixtures: sanitizeTwitchRaveOffFixtureMap(raw.fixtures || base.fixtures || {})
    };
  }

  function sanitizeTwitchFixturePrefixMap(input = {}, options = {}) {
    const rawMap = input && typeof input === "object" ? input : {};
    const reservedPrefixes = new Set(
      Array.isArray(options.reservedPrefixes)
        ? options.reservedPrefixes.map(item => String(item || "").trim().toLowerCase()).filter(Boolean)
        : []
    );
    const safeMap = {};
    const seenPrefixes = new Set();
    const entries = Object.entries(rawMap)
      .map(([fixtureId, prefix]) => [String(fixtureId || "").trim(), prefix])
      .filter(([fixtureId]) => fixtureId)
      .sort((a, b) => a[0].localeCompare(b[0]));

    for (const [fixtureId, prefix] of entries) {
      const safePrefix = sanitizeTwitchColorPrefix(prefix, "");
      if (!safePrefix) continue;
      if (reservedPrefixes.has(safePrefix)) continue;
      if (seenPrefixes.has(safePrefix)) continue;
      safeMap[fixtureId] = safePrefix;
      seenPrefixes.add(safePrefix);
    }

    return safeMap;
  }

  function sanitizeTwitchColorConfig(input = {}) {
    const raw = input && typeof input === "object" ? input : {};
    const rawPrefixes = raw.prefixes && typeof raw.prefixes === "object" ? raw.prefixes : {};
    const rawFixturePrefixes =
      raw.fixturePrefixes &&
      typeof raw.fixturePrefixes === "object" &&
      !Array.isArray(raw.fixturePrefixes)
        ? raw.fixturePrefixes
        : {};
    const rawRaveOff =
      raw.raveOff &&
      typeof raw.raveOff === "object" &&
      !Array.isArray(raw.raveOff)
        ? raw.raveOff
        : {};
    const hasHue = Object.prototype.hasOwnProperty.call(rawPrefixes, "hue");
    const hasWiz = Object.prototype.hasOwnProperty.call(rawPrefixes, "wiz");
    const hasOther = Object.prototype.hasOwnProperty.call(rawPrefixes, "other");

    const huePrefix = hasHue
      ? sanitizeTwitchColorPrefix(rawPrefixes.hue, "")
      : sanitizeTwitchColorPrefix(fallbackDefault.prefixes.hue, "hue");
    const wizPrefix = hasWiz
      ? sanitizeTwitchColorPrefix(rawPrefixes.wiz, "")
      : sanitizeTwitchColorPrefix(fallbackDefault.prefixes.wiz, "wiz");
    const otherPrefix = hasOther
      ? sanitizeTwitchColorPrefix(rawPrefixes.other, "")
      : sanitizeTwitchColorPrefix(fallbackDefault.prefixes.other, "");
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
      defaultTarget: sanitizeTwitchColorTarget(raw.defaultTarget, fallbackDefault.defaultTarget),
      autoDefaultTarget: parseBool(raw.autoDefaultTarget, parseBool(fallbackDefault.autoDefaultTarget, true)),
      prefixes: dedupedPrefixes,
      fixturePrefixes: sanitizeTwitchFixturePrefixMap(rawFixturePrefixes, {
        reservedPrefixes: [...seenBrandPrefixes]
      }),
      raveOff: sanitizeTwitchRaveOffConfig(rawRaveOff, fallbackDefault.raveOff)
    };
  }

  function readTwitchColorConfig() {
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
      return sanitizeTwitchColorConfig(parsed);
    } catch {
      return sanitizeTwitchColorConfig(fallbackDefault);
    }
  }

  function writeTwitchColorConfig(config) {
    const safe = sanitizeTwitchColorConfig(config);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(safe, null, 2)}\n`, "utf8");
    return safe;
  }

  const twitchColorConfigRuntime = readTwitchColorConfig();

  function getTwitchColorConfigSnapshot() {
    return {
      version: twitchColorConfigRuntime.version,
      defaultTarget: twitchColorConfigRuntime.defaultTarget,
      autoDefaultTarget: twitchColorConfigRuntime.autoDefaultTarget !== false,
      prefixes: { ...twitchColorConfigRuntime.prefixes },
      fixturePrefixes: { ...(twitchColorConfigRuntime.fixturePrefixes || {}) },
      raveOff: {
        ...(twitchColorConfigRuntime.raveOff || {}),
        groups: { ...(twitchColorConfigRuntime.raveOff?.groups || {}) },
        fixtures: { ...(twitchColorConfigRuntime.raveOff?.fixtures || {}) }
      }
    };
  }

  function patchTwitchColorConfig(patch = {}) {
    const rawPatch = patch && typeof patch === "object" ? patch : {};
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
      ...twitchColorConfigRuntime,
      ...rawPatch,
      autoDefaultTarget: hasAutoDefaultTarget
        ? rawPatch.autoDefaultTarget
        : hasDefaultTarget
          ? false
          : twitchColorConfigRuntime.autoDefaultTarget,
      prefixes: {
        ...twitchColorConfigRuntime.prefixes,
        ...(rawPatch.prefixes && typeof rawPatch.prefixes === "object" ? rawPatch.prefixes : {})
      },
      fixturePrefixes: hasFixturePrefixes
        ? { ...rawPatch.fixturePrefixes }
        : { ...(twitchColorConfigRuntime.fixturePrefixes || {}) },
      raveOff: hasRaveOffPatch
        ? {
          ...(twitchColorConfigRuntime.raveOff || {}),
          ...raveOffPatch,
          groups:
            raveOffPatch.groups && typeof raveOffPatch.groups === "object" && !Array.isArray(raveOffPatch.groups)
              ? { ...raveOffPatch.groups }
              : { ...(twitchColorConfigRuntime.raveOff?.groups || {}) },
          fixtures:
            raveOffPatch.fixtures && typeof raveOffPatch.fixtures === "object" && !Array.isArray(raveOffPatch.fixtures)
              ? { ...raveOffPatch.fixtures }
              : { ...(twitchColorConfigRuntime.raveOff?.fixtures || {}) }
        }
        : {
          ...(twitchColorConfigRuntime.raveOff || {}),
          groups: { ...(twitchColorConfigRuntime.raveOff?.groups || {}) },
          fixtures: { ...(twitchColorConfigRuntime.raveOff?.fixtures || {}) }
        }
    };
    const next = writeTwitchColorConfig(merged);
    twitchColorConfigRuntime.version = next.version;
    twitchColorConfigRuntime.defaultTarget = next.defaultTarget;
    twitchColorConfigRuntime.autoDefaultTarget = next.autoDefaultTarget !== false;
    twitchColorConfigRuntime.prefixes = { ...next.prefixes };
    twitchColorConfigRuntime.fixturePrefixes = { ...next.fixturePrefixes };
    twitchColorConfigRuntime.raveOff = {
      ...next.raveOff,
      groups: { ...(next.raveOff?.groups || {}) },
      fixtures: { ...(next.raveOff?.fixtures || {}) }
    };
    return getTwitchColorConfigSnapshot();
  }

  function parseColorTarget(raw, fallback = "both") {
    return sanitizeTwitchColorTarget(raw, fallback);
  }

  function splitPrefixedColorText(rawText, prefixes = {}, fixturePrefixes = {}) {
    const source = String(rawText || "").trim();
    if (!source) {
      return { target: null, prefix: "", text: "", fixtureId: "" };
    }

    const fixtureCandidates = Object.entries(fixturePrefixes && typeof fixturePrefixes === "object" ? fixturePrefixes : {})
      .map(([fixtureId, prefix]) => ({
        target: null,
        fixtureId: String(fixtureId || "").trim(),
        prefix: sanitizeTwitchColorPrefix(prefix, ""),
        scope: "fixture"
      }))
      .filter(entry => entry.fixtureId && entry.prefix);
    const brandCandidates = [
      { target: "hue", prefix: sanitizeTwitchColorPrefix(prefixes.hue, "") },
      { target: "wiz", prefix: sanitizeTwitchColorPrefix(prefixes.wiz, "") },
      { target: "other", prefix: sanitizeTwitchColorPrefix(prefixes.other, "") }
    ]
      .map(entry => ({ ...entry, fixtureId: "", scope: "brand" }))
      .filter(entry => entry.prefix);
    const candidates = [...fixtureCandidates, ...brandCandidates]
      .filter(entry => entry.prefix)
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

  function getLoadSummary() {
    return {
      defaultTarget: twitchColorConfigRuntime.defaultTarget,
      autoDefaultTarget: twitchColorConfigRuntime.autoDefaultTarget !== false,
      prefixes: { ...twitchColorConfigRuntime.prefixes },
      fixturePrefixCount: Object.keys(twitchColorConfigRuntime.fixturePrefixes || {}).length,
      raveOffEnabled: twitchColorConfigRuntime.raveOff?.enabled === true
    };
  }

  return {
    sanitizeTwitchColorPrefix,
    sanitizeTwitchColorTarget,
    sanitizeTwitchColorCommandText,
    sanitizeTwitchRaveOffGroupKey,
    sanitizeTwitchRaveOffConfig,
    getTwitchColorConfigSnapshot,
    patchTwitchColorConfig,
    parseColorTarget,
    splitPrefixedColorText,
    getLoadSummary
  };
};
