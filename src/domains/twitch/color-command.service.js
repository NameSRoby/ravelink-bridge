// [TITLE] Module: domains/twitch/color-command.service.js
// [TITLE] Purpose: execute Twitch /color and rave-off profile routing logic
// [TITLE] Functionality Index:
// [TITLE] - resolve targets from explicit target, brand prefix, or fixture prefix
// [TITLE] - route directives to matching fixture zones
// [TITLE] - apply rave-off profile assignments per fixture/group/default

module.exports = function createColorCommandService(options = {}) {
  const twitchColorConfig = options.twitchColorConfig;
  const fixtureRegistry = options.fixtureRegistry;
  const directiveService = options.directiveService;
  const hueBridge = options.hueBridge;
  const wizBridge = options.wizBridge;
  const isRaveLocked = typeof options.isRaveLocked === "function"
    ? options.isRaveLocked
    : (() => false);
  const log = options.log || console;

  if (!twitchColorConfig) {
    throw new Error("createColorCommandService requires twitchColorConfig");
  }
  if (!fixtureRegistry) {
    throw new Error("createColorCommandService requires fixtureRegistry");
  }
  if (!directiveService || typeof directiveService.parseTwitchColorDirective !== "function") {
    throw new Error("createColorCommandService requires directiveService.parseTwitchColorDirective()");
  }

  function listColorCommandFixtures(brand = "", zone = "") {
    return fixtureRegistry.listTwitchBy(brand, zone);
  }

  function resolveTwitchFixtureById(fixtureId) {
    const targetId = String(fixtureId || "").trim();
    if (!targetId) return null;
    const fixtures = listColorCommandFixtures("", "");
    for (const fixture of fixtures) {
      if (String(fixture?.id || "").trim() === targetId) return fixture;
    }
    return null;
  }

  function resolveAutoDefaultColorTarget(commandConfig = {}) {
    const fallback = twitchColorConfig.parseColorTarget(
      commandConfig.defaultTarget,
      "hue"
    );
    if (commandConfig.autoDefaultTarget === false) return fallback;
    if (fallback !== "hue" && fallback !== "wiz") return fallback;

    const fixtures = listColorCommandFixtures("", "");
    const hasHue = fixtures.some(fixture => String(fixture?.brand || "").toLowerCase() === "hue");
    const hasWiz = fixtures.some(fixture => String(fixture?.brand || "").toLowerCase() === "wiz");

    if (fallback === "hue") {
      if (hasHue) return "hue";
      if (hasWiz) return "wiz";
      return "hue";
    }
    if (hasWiz) return "wiz";
    if (hasHue) return "hue";
    return "wiz";
  }

  function collectFixturesByZones(brand, zones = []) {
    const deduped = new Map();
    for (const zone of zones) {
      for (const fixture of listColorCommandFixtures(brand, zone)) {
        const key = String(fixture.id || "");
        deduped.set(key, fixture);
      }
    }
    return [...deduped.values()];
  }

  function resolveZones(rawZone, brand, fallback) {
    const parsed = fixtureRegistry.parseZoneList(rawZone, fallback);
    const hasAll = parsed.some(token => token === "*" || token === "all");
    if (!hasAll) return parsed;
    const fixtures = listColorCommandFixtures(brand, "");
    const zones = [...new Set(fixtures.map(fixture => String(fixture.zone || fallback).trim()).filter(Boolean))];
    return zones.length ? zones : [fallback];
  }

  async function applyColorText(rawText, requestOptions = {}) {
    // [DEV] Resolution order is intentionally strict and stable:
    // [DEV] explicit target > fixture prefix target > brand prefix/default target.
    // [DEV] Changing this order can break existing channel point command behavior.
    if (isRaveLocked()) {
      return {
        ok: false,
        target: null,
        usedPrefix: null,
        fixtureTargetId: null,
        error: "rave active; /color is disabled while RAVE is on"
      };
    }

    const optionsSafe = requestOptions && typeof requestOptions === "object" ? requestOptions : {};
    const commandConfig = twitchColorConfig.getSnapshot();
    const prefixed = twitchColorConfig.splitPrefixedColorText(
      rawText,
      commandConfig.prefixes,
      commandConfig.fixturePrefixes
    );
    const fixtureScopedTarget = !optionsSafe.targetExplicit && prefixed.fixtureId
      ? resolveTwitchFixtureById(prefixed.fixtureId)
      : null;
    const implicitDefaultTarget = resolveAutoDefaultColorTarget(commandConfig);
    const target = optionsSafe.targetExplicit
      ? twitchColorConfig.parseColorTarget(optionsSafe.target, implicitDefaultTarget)
      : fixtureScopedTarget
        ? twitchColorConfig.parseColorTarget(fixtureScopedTarget.brand, implicitDefaultTarget)
        : twitchColorConfig.parseColorTarget(prefixed.target || implicitDefaultTarget, implicitDefaultTarget);
    const colorText = String(prefixed.text || "").trim();

    if (!colorText) {
      return {
        ok: false,
        target,
        usedPrefix: prefixed.prefix || null,
        fixtureTargetId: prefixed.fixtureId || null,
        error: prefixed.target
          ? `missing color after ${prefixed.target} prefix`
          : prefixed.fixtureId
            ? "missing color after fixture prefix"
            : "missing color text"
      };
    }

    if (!optionsSafe.targetExplicit && prefixed.fixtureId && !fixtureScopedTarget) {
      return {
        ok: false,
        target: null,
        usedPrefix: prefixed.prefix || null,
        fixtureTargetId: prefixed.fixtureId,
        error: `fixture prefix target not found or not twitch-enabled: ${prefixed.fixtureId}`
      };
    }

    if (target === "other") {
      return {
        ok: false,
        target,
        usedPrefix: prefixed.prefix || null,
        fixtureTargetId: prefixed.fixtureId || null,
        error: "other target requires mod-brand color adapter support"
      };
    }

    const directive = directiveService.parseTwitchColorDirective(colorText);
    if (!directive.ok) {
      return {
        ok: false,
        target,
        usedPrefix: prefixed.prefix || null,
        fixtureTargetId: prefixed.fixtureId || null,
        error: directive.error || "invalid color text"
      };
    }

    const fixedFixture = fixtureScopedTarget || null;
    const response = {
      ok: true,
      target,
      usedPrefix: prefixed.prefix || null,
      fixtureTargetId: fixedFixture ? String(fixedFixture.id || "") : null,
      hueZones: [],
      wizZones: [],
      hueTargets: 0,
      wizTargets: 0,
      directiveType: directive.type,
      colorMatch: directive.matchedName || "",
      fuzzy: directive.fuzzy || null
    };

    if (target === "hue" || target === "both") {
      const hueZones = fixedFixture
        ? [String(fixedFixture.zone || "hue").trim() || "hue"]
        : resolveZones(
          optionsSafe.hueZone || optionsSafe.zone || fixtureRegistry.resolveZone("TWITCH_HUE") || "hue",
          "hue",
          "hue"
        );
      response.hueZones = hueZones;
      const hueFixtures = fixedFixture
        ? (String(fixedFixture.brand || "").toLowerCase() === "hue" ? [fixedFixture] : [])
        : collectFixturesByZones("hue", hueZones);
      response.hueTargets = hueFixtures.length;
      if (hueFixtures.length && hueBridge && typeof hueBridge.sendState === "function") {
        await hueBridge.sendState(hueFixtures, directive.hueState);
      }
    }

    if (target === "wiz" || target === "both") {
      const wizZones = fixedFixture
        ? [String(fixedFixture.zone || "wiz").trim() || "wiz"]
        : resolveZones(
          optionsSafe.wizZone || optionsSafe.zone || fixtureRegistry.resolveZone("TWITCH_WIZ") || "wiz",
          "wiz",
          "wiz"
        );
      response.wizZones = wizZones;
      const wizFixtures = fixedFixture
        ? (String(fixedFixture.brand || "").toLowerCase() === "wiz" ? [fixedFixture] : [])
        : collectFixturesByZones("wiz", wizZones);
      response.wizTargets = wizFixtures.length;
      if (wizFixtures.length && wizBridge && typeof wizBridge.sendState === "function") {
        wizBridge.sendState(wizFixtures, directive.wizState);
      }
    }

    if ((response.hueTargets + response.wizTargets) <= 0) {
      response.ok = false;
      response.error = "no routed fixtures matched";
    }

    return response;
  }

  function resolveRaveOffCommandForFixture(fixture, raveOffConfig = {}) {
    const fixtureId = String(fixture?.id || "").trim();
    const brand = String(fixture?.brand || "").trim().toLowerCase();
    const zone = String(fixture?.zone || "").trim().toLowerCase() || brand;
    const fixtureMap = raveOffConfig.fixtures && typeof raveOffConfig.fixtures === "object"
      ? raveOffConfig.fixtures
      : {};
    const groupMap = raveOffConfig.groups && typeof raveOffConfig.groups === "object"
      ? raveOffConfig.groups
      : {};

    if (fixtureId && fixtureMap[fixtureId]) {
      return twitchColorConfig.sanitizeCommandText(fixtureMap[fixtureId], "");
    }
    const zoneKey = twitchColorConfig.sanitizeRaveOffGroupKey(`${brand}:${zone}`);
    if (zoneKey && groupMap[zoneKey]) {
      return twitchColorConfig.sanitizeCommandText(groupMap[zoneKey], "");
    }
    if (brand && groupMap[brand]) {
      return twitchColorConfig.sanitizeCommandText(groupMap[brand], "");
    }
    return twitchColorConfig.sanitizeCommandText(raveOffConfig.defaultText, "");
  }

  async function applyTwitchRaveOffColorProfile() {
    // [DEV] Batching by serialized state minimizes network fanout while preserving
    // [DEV] exact per-fixture directive intent.
    const colorConfigSnapshot = twitchColorConfig.getSnapshot();
    const config = twitchColorConfig.sanitizeRaveOffConfig(colorConfigSnapshot?.raveOff, {
      enabled: true,
      defaultText: "random",
      groups: {},
      fixtures: {}
    });
    if (config.enabled !== true) {
      return { ok: true, applied: false, reason: "disabled", targets: 0 };
    }

    const fixturesById = new Map();
    for (const fixture of fixtureRegistry.listEngineBy("hue")) {
      fixturesById.set(String(fixture.id || ""), fixture);
    }
    for (const fixture of fixtureRegistry.listEngineBy("wiz")) {
      fixturesById.set(String(fixture.id || ""), fixture);
    }
    const fixtures = [...fixturesById.values()];
    if (!fixtures.length) {
      return { ok: true, applied: false, reason: "no_engine_targets", targets: 0 };
    }

    const assignments = [];
    const warnings = [];
    for (const fixture of fixtures) {
      const commandText = resolveRaveOffCommandForFixture(fixture, config);
      if (!commandText) continue;
      const directive = directiveService.parseTwitchColorDirective(commandText);
      if (!directive.ok) {
        warnings.push({
          fixtureId: String(fixture.id || ""),
          commandText,
          error: directive.error || "invalid color text"
        });
        continue;
      }
      assignments.push({
        fixture,
        directive: directiveService.normalizeTwitchRaveOffDirective(directive),
        commandText
      });
    }

    if (!assignments.length) {
      return {
        ok: true,
        applied: false,
        reason: warnings.length ? "invalid_commands" : "empty_profile",
        targets: fixtures.length,
        warnings
      };
    }

    const hueBatches = new Map();
    const wizBatches = new Map();
    for (const item of assignments) {
      const brand = String(item.fixture?.brand || "").trim().toLowerCase();
      if (brand === "hue") {
        const key = JSON.stringify(item.directive.hueState);
        const batch = hueBatches.get(key) || { state: item.directive.hueState, fixtures: [] };
        batch.fixtures.push(item.fixture);
        hueBatches.set(key, batch);
      } else if (brand === "wiz") {
        const key = JSON.stringify(item.directive.wizState);
        const batch = wizBatches.get(key) || { state: item.directive.wizState, fixtures: [] };
        batch.fixtures.push(item.fixture);
        wizBatches.set(key, batch);
      }
    }

    let appliedHue = 0;
    let appliedWiz = 0;
    for (const batch of hueBatches.values()) {
      if (hueBridge && typeof hueBridge.sendState === "function") {
        await hueBridge.sendState(batch.fixtures, batch.state);
      }
      appliedHue += batch.fixtures.length;
    }
    for (const batch of wizBatches.values()) {
      if (wizBridge && typeof wizBridge.sendState === "function") {
        wizBridge.sendState(batch.fixtures, batch.state);
      }
      appliedWiz += batch.fixtures.length;
    }

    log.log?.(`[COLOR][RAVE_OFF] applied profile to ${appliedHue + appliedWiz} fixtures`);
    return {
      ok: true,
      applied: true,
      targets: appliedHue + appliedWiz,
      hueTargets: appliedHue,
      wizTargets: appliedWiz,
      warnings
    };
  }

  return {
    listColorCommandFixtures,
    resolveTwitchFixtureById,
    resolveAutoDefaultColorTarget,
    applyColorText,
    resolveRaveOffCommandForFixture,
    applyTwitchRaveOffColorProfile
  };
};
