// [TITLE] Module: public/assets/js/domains/color-prefix-rave-off-runtime-ui.js
// [TITLE] Purpose: RAVE-off command map normalization for color-prefix UI
// [TITLE] Functionality Index:
// [TITLE] - RAVE-off group key normalization
// [TITLE] - group/fixture map text parse and format helpers
// [TITLE] - normalized group/fixture command map shaping
// [DEV] Complex Flow:
// [DEV] This module stays parser-only so `color-prefix.js` can own UI wiring and
// [DEV] persistence without carrying RAVE-off text grammar details.

function createColorPrefixRaveOffRuntimeUi(deps = {}) {
  const normalizeColorCommandText = typeof deps.normalizeColorCommandText === "function"
    ? deps.normalizeColorCommandText
    : ((value, fallback = "") => {
      const source = String(value || "").replace(/\s+/g, " ").trim();
      if (!source) return String(fallback || "").replace(/\s+/g, " ").trim();
      return source.slice(0, 96);
    });

  function normalizeColorRaveOffGroupKey(value) {
    const source = String(value || "").trim().toLowerCase();
    if (!source) return "";
    const [brandRaw, zoneRaw = ""] = source.split(":", 2);
    const brand = brandRaw === "hue" || brandRaw === "wiz" ? brandRaw : "";
    if (!brand) return "";
    const zone = String(zoneRaw || "").trim().toLowerCase();
    if (!zone) return brand;
    if (zone === "*" || zone === "all") return `${brand}:all`;
    if (!/^[a-z0-9_-]{1,48}$/.test(zone)) return "";
    return `${brand}:${zone}`;
  }

  function normalizeColorRaveOffGroupMap(rawMap = {}) {
    const source = rawMap && typeof rawMap === "object" ? rawMap : {};
    const safe = {};
    const entries = Object.entries(source)
      .map(([groupKey, command]) => [normalizeColorRaveOffGroupKey(groupKey), normalizeColorCommandText(command, "")])
      .filter(([groupKey, command]) => groupKey && command)
      .sort((a, b) => a[0].localeCompare(b[0]));
    for (const [groupKey, command] of entries) {
      safe[groupKey] = command;
    }
    return safe;
  }

  function normalizeColorRaveOffFixtureMap(rawMap = {}) {
    const source = rawMap && typeof rawMap === "object" ? rawMap : {};
    const safe = {};
    const entries = Object.entries(source)
      .map(([fixtureId, command]) => [String(fixtureId || "").trim(), normalizeColorCommandText(command, "")])
      .filter(([fixtureId, command]) => fixtureId && command)
      .sort((a, b) => a[0].localeCompare(b[0]));
    for (const [fixtureId, command] of entries) {
      safe[fixtureId] = command;
    }
    return safe;
  }

  function parseColorRaveOffGroupMapText(value) {
    const lines = String(value || "").split(/\r?\n/);
    const map = {};
    const errors = [];

    for (let i = 0; i < lines.length; i += 1) {
      const rawLine = String(lines[i] || "").trim();
      if (!rawLine || rawLine.startsWith("#")) continue;
      const eqIndex = rawLine.indexOf("=");
      if (eqIndex <= 0 || eqIndex >= (rawLine.length - 1)) {
        errors.push(`line ${i + 1}: use group=command`);
        continue;
      }
      const groupRaw = rawLine.slice(0, eqIndex).trim();
      const groupKey = normalizeColorRaveOffGroupKey(groupRaw);
      const commandRaw = rawLine.slice(eqIndex + 1).trim();
      const command = normalizeColorCommandText(commandRaw, "");
      if (!groupKey) {
        errors.push(`line ${i + 1}: invalid group key '${groupRaw}'`);
        continue;
      }
      if (!command) {
        errors.push(`line ${i + 1}: missing command`);
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(map, groupKey)) {
        errors.push(`line ${i + 1}: duplicate group key '${groupKey}'`);
        continue;
      }
      map[groupKey] = command;
    }

    return {
      ok: errors.length === 0,
      map,
      errors
    };
  }

  function formatColorRaveOffGroupMapText(rawMap = {}) {
    const safe = normalizeColorRaveOffGroupMap(rawMap);
    return Object.entries(safe)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([groupKey, command]) => `${groupKey}=${command}`)
      .join("\n");
  }

  function parseColorRaveOffFixtureMapText(value) {
    const lines = String(value || "").split(/\r?\n/);
    const map = {};
    const errors = [];

    for (let i = 0; i < lines.length; i += 1) {
      const rawLine = String(lines[i] || "").trim();
      if (!rawLine || rawLine.startsWith("#")) continue;
      const eqIndex = rawLine.indexOf("=");
      if (eqIndex <= 0 || eqIndex >= (rawLine.length - 1)) {
        errors.push(`line ${i + 1}: use fixtureId=command`);
        continue;
      }
      const fixtureId = rawLine.slice(0, eqIndex).trim();
      const commandRaw = rawLine.slice(eqIndex + 1).trim();
      const command = normalizeColorCommandText(commandRaw, "");
      if (!fixtureId) {
        errors.push(`line ${i + 1}: missing fixture id`);
        continue;
      }
      if (!command) {
        errors.push(`line ${i + 1}: missing command`);
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(map, fixtureId)) {
        errors.push(`line ${i + 1}: duplicate fixture id '${fixtureId}'`);
        continue;
      }
      map[fixtureId] = command;
    }

    return {
      ok: errors.length === 0,
      map,
      errors
    };
  }

  function formatColorRaveOffFixtureMapText(rawMap = {}) {
    const safe = normalizeColorRaveOffFixtureMap(rawMap);
    return Object.entries(safe)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([fixtureId, command]) => `${fixtureId}=${command}`)
      .join("\n");
  }

  return {
    normalizeColorRaveOffGroupKey,
    normalizeColorRaveOffGroupMap,
    normalizeColorRaveOffFixtureMap,
    parseColorRaveOffGroupMapText,
    formatColorRaveOffGroupMapText,
    parseColorRaveOffFixtureMapText,
    formatColorRaveOffFixtureMapText
  };
}
