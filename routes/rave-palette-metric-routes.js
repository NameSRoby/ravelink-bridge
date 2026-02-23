"use strict";

module.exports = function registerRavePaletteMetricRoutes(app, deps = {}) {
  const {
    collectPalettePatch,
    collectFixtureMetricPatch,
    collectFixtureRoutingClearPatch,
    normalizePaletteBrandKey,
    parseBooleanLoose,
    hasPalettePatchFields,
    hasFixtureMetricPatchFields,
    PALETTE_SUPPORTED_BRANDS,
    PALETTE_PATCH_FIELDS,
    FIXTURE_METRIC_MODE_ORDER,
    FIXTURE_METRIC_KEYS,
    FIXTURE_METRIC_HARMONY_MIN,
    FIXTURE_METRIC_HARMONY_MAX,
    FIXTURE_METRIC_MAX_HZ_MIN,
    FIXTURE_METRIC_MAX_HZ_MAX,
    setFixturePaletteOverrideConfig,
    patchFixtureMetricRoutingConfig,
    clearFixtureRoutingOverridesAtomic,
    buildPaletteRuntimeSnapshot,
    buildFixtureMetricRoutingSnapshot,
    buildPaletteBrandFixtureCatalog,
    fixtureRegistry
  } = deps;
  const getEngine = typeof deps.getEngine === "function"
    ? deps.getEngine
    : () => deps.engine || null;
  const hasOwn = (source, key) => Object.prototype.hasOwnProperty.call(source, key);
  const PALETTE_PATCH_ALLOWED = Object.freeze([
    "colorsPerFamily",
    "familyColorCounts",
    "families",
    "disorder",
    "disorderAggression",
    "cycleMode",
    "timedIntervalSec",
    "beatLock",
    "beatLockGraceSec",
    "reactiveMargin",
    "brightnessMode",
    "brightnessFollowAmount",
    "vividness",
    "spectrumMapMode",
    "spectrumFeatureMap",
    "brand",
    "fixtureId",
    "clearOverride"
  ]);
  const METRIC_PATCH_ALLOWED = Object.freeze([
    "mode",
    "metric",
    "metaAutoFlip",
    "harmonySize",
    "maxHz",
    "brand",
    "fixtureId",
    "clearOverride"
  ]);

  function resolveRequestedBrand(patch) {
    const requestedBrandRaw = hasOwn(patch, "brand")
      ? String(patch.brand || "").trim().toLowerCase()
      : "";
    return {
      requestedBrandRaw,
      requestedBrand: normalizePaletteBrandKey(requestedBrandRaw)
    };
  }

  function respondInvalidMetricPatch(res, patch) {
    const invalidFieldSpecs = [
      {
        key: "__invalidMode",
        body: value => ({ ok: false, error: "invalid mode", value, allowed: FIXTURE_METRIC_MODE_ORDER })
      },
      {
        key: "__invalidMetric",
        body: value => ({ ok: false, error: "invalid metric", value, allowed: FIXTURE_METRIC_KEYS })
      },
      {
        key: "__invalidHarmonySize",
        body: value => ({
          ok: false,
          error: "invalid harmonySize",
          value,
          allowedRange: [FIXTURE_METRIC_HARMONY_MIN, FIXTURE_METRIC_HARMONY_MAX]
        })
      },
      {
        key: "__invalidMaxHz",
        body: value => ({
          ok: false,
          error: "invalid maxHz",
          value,
          allowedRange: [FIXTURE_METRIC_MAX_HZ_MIN, FIXTURE_METRIC_MAX_HZ_MAX],
          allowNull: true
        })
      }
    ];
    for (const spec of invalidFieldSpecs) {
      if (!hasOwn(patch, spec.key)) continue;
      res.status(400).json(spec.body(patch[spec.key]));
      return true;
    }
    return false;
  }

  app.get("/rave/palette", (_, res) => {
    res.json(buildPaletteRuntimeSnapshot());
  });

  app.post("/rave/palette", (req, res) => {
    const patch = collectPalettePatch(req);
    const fixtureId = String(patch.fixtureId || "").trim();
    const { requestedBrandRaw, requestedBrand } = resolveRequestedBrand(patch);
    const clearRequested = parseBooleanLoose(patch.clearOverride, false) === true;
    const hasPaletteFields = hasPalettePatchFields(patch);

    if (requestedBrandRaw && !requestedBrand) {
      res.status(400).json({
        ok: false,
        error: "invalid brand",
        allowedBrands: PALETTE_SUPPORTED_BRANDS
      });
      return;
    }

    if (!hasPaletteFields && !clearRequested) {
      res.status(400).json({
        ok: false,
        error: "no valid palette fields",
        allowed: PALETTE_PATCH_ALLOWED
      });
      return;
    }
    if (clearRequested && !fixtureId && !requestedBrand && !hasPaletteFields) {
      res.status(400).json({
        ok: false,
        error: "clearOverride requires brand or fixtureId"
      });
      return;
    }

    if (fixtureId) {
      const result = setFixturePaletteOverrideConfig({
        ...patch,
        fixtureId,
        brand: requestedBrand || requestedBrandRaw
      });
      if (!result.ok) {
        res.status(result.status || 400).json({
          ok: false,
          error: result.error || "fixture palette update failed"
        });
        return;
      }

      if (result.cleared) {
        console.log(`[RAVE] fixture palette override cleared: ${result.fixtureId} (${result.brand})`);
      } else {
        const familyLabel = Array.isArray(result.config?.families)
          ? result.config.families.join("+")
          : "none";
        console.log(
          `[RAVE] fixture palette override ${result.fixtureId} (${result.brand}) = ${familyLabel || "none"} x${result.config?.colorsPerFamily} ` +
          `disorder=${result.config?.disorder ? "on" : "off"} ${Math.round(Number(result.config?.disorderAggression || 0) * 100)}% ` +
          `mode=${result.config?.cycleMode || "on_trigger"}`
        );
      }

      res.json(buildPaletteRuntimeSnapshot());
      return;
    }

    const enginePatch = {};
    if (requestedBrand) enginePatch.brand = requestedBrand;
    for (const key of PALETTE_PATCH_FIELDS) {
      if (hasOwn(patch, key)) {
        enginePatch[key] = patch[key];
      }
    }
    if (clearRequested) {
      enginePatch.clearOverride = true;
    }

    const activeEngine = getEngine();
    const next = activeEngine?.setPaletteConfig?.(enginePatch);
    if (!next) {
      res.status(500).json({
        ok: false,
        error: "palette update failed"
      });
      return;
    }

    const scoped = requestedBrand
      ? activeEngine?.getPaletteConfig?.(requestedBrand)
      : next;
    const familyLabel = Array.isArray(scoped?.families)
      ? scoped.families.map(name => String(name || "").trim().toLowerCase()).filter(Boolean).join("+")
      : String(scoped?.families || "");
    const scopeLabel = requestedBrand ? `brand:${requestedBrand}` : "global";
    if (clearRequested && requestedBrand) {
      console.log(`[RAVE] palette override cleared (${scopeLabel})`);
    } else {
      console.log(
        `[RAVE] palette ${scopeLabel} = ${familyLabel || "none"} x${scoped?.colorsPerFamily} ` +
        `disorder=${scoped?.disorder ? "on" : "off"} ${Math.round(Number(scoped?.disorderAggression || 0) * 100)}% ` +
        `mode=${scoped?.cycleMode || "on_trigger"}`
      );
    }
    res.json(buildPaletteRuntimeSnapshot(next));
  });

  app.get("/rave/fixture-metrics", (_, res) => {
    const fixtures = fixtureRegistry.getFixtures?.() || [];
    res.json({
      ok: true,
      ...buildFixtureMetricRoutingSnapshot(fixtures),
      brandFixtures: buildPaletteBrandFixtureCatalog(fixtures)
    });
  });

  app.post("/rave/fixture-metrics", (req, res) => {
    const patch = collectFixtureMetricPatch(req);
    const fixtureId = String(patch.fixtureId || "").trim();
    const { requestedBrandRaw, requestedBrand } = resolveRequestedBrand(patch);
    const clearRequested = parseBooleanLoose(patch.clearOverride, false) === true;
    const hasMetricFields = hasFixtureMetricPatchFields(patch);

    if (respondInvalidMetricPatch(res, patch)) {
      return;
    }

    if (requestedBrandRaw && !requestedBrand) {
      res.status(400).json({
        ok: false,
        error: "invalid brand",
        allowedBrands: PALETTE_SUPPORTED_BRANDS
      });
      return;
    }

    if (!hasMetricFields && !clearRequested) {
      res.status(400).json({
        ok: false,
        error: "no valid metric fields",
        allowed: METRIC_PATCH_ALLOWED
      });
      return;
    }

    if (clearRequested && !fixtureId && !requestedBrand && !hasMetricFields) {
      res.status(400).json({
        ok: false,
        error: "clearOverride requires brand or fixtureId"
      });
      return;
    }

    const result = patchFixtureMetricRoutingConfig({
      ...patch,
      brand: requestedBrand || requestedBrandRaw
    });
    if (!result.ok) {
      res.status(result.status || 400).json({
        ok: false,
        error: result.error || "fixture metric update failed"
      });
      return;
    }

    if (result.scope === "global") {
      console.log(
        `[RAVE] fixture metrics global = ${result.config?.mode}/${result.config?.metric} ` +
        `flip=${result.config?.metaAutoFlip ? "on" : "off"} harmony=${result.config?.harmonySize} ` +
        `maxHz=${Number.isFinite(Number(result.config?.maxHz)) ? Number(result.config.maxHz) : "unclamped"}`
      );
    } else if (result.scope === "brand") {
      if (result.cleared) {
        console.log(`[RAVE] fixture metrics override cleared (brand:${result.brand})`);
      } else {
        console.log(
          `[RAVE] fixture metrics brand:${result.brand} = ${result.config?.mode}/${result.config?.metric} ` +
          `flip=${result.config?.metaAutoFlip ? "on" : "off"} harmony=${result.config?.harmonySize} ` +
          `maxHz=${Number.isFinite(Number(result.config?.maxHz)) ? Number(result.config.maxHz) : "unclamped"}`
        );
      }
    } else if (result.fixtureId) {
      if (result.cleared) {
        console.log(`[RAVE] fixture metrics override cleared: ${result.fixtureId} (${result.brand})`);
      } else {
        console.log(
          `[RAVE] fixture metrics ${result.fixtureId} (${result.brand}) = ${result.config?.mode}/${result.config?.metric} ` +
          `flip=${result.config?.metaAutoFlip ? "on" : "off"} harmony=${result.config?.harmonySize} ` +
          `maxHz=${Number.isFinite(Number(result.config?.maxHz)) ? Number(result.config.maxHz) : "unclamped"}`
        );
      }
    }

    const fixtures = fixtureRegistry.getFixtures?.() || [];
    res.json({
      ok: true,
      ...buildFixtureMetricRoutingSnapshot(fixtures),
      brandFixtures: buildPaletteBrandFixtureCatalog(fixtures)
    });
  });

  app.post("/rave/fixture-routing/clear", (req, res) => {
    const patch = collectFixtureRoutingClearPatch(req);
    const fixtureId = String(patch.fixtureId || "").trim();
    const { requestedBrandRaw, requestedBrand } = resolveRequestedBrand(patch);

    if (requestedBrandRaw && !requestedBrand) {
      res.status(400).json({
        ok: false,
        error: "invalid brand",
        allowedBrands: PALETTE_SUPPORTED_BRANDS
      });
      return;
    }

    if (!fixtureId && !requestedBrand) {
      res.status(400).json({
        ok: false,
        error: "brand or fixtureId required"
      });
      return;
    }

    const result = clearFixtureRoutingOverridesAtomic({
      fixtureId,
      brand: requestedBrand || requestedBrandRaw
    });
    if (!result.ok) {
      res.status(result.status || 400).json({
        ok: false,
        error: result.error || "fixture routing clear failed"
      });
      return;
    }

    if (result.scope === "fixture") {
      console.log(`[RAVE] fixture routing override cleared: ${result.fixtureId} (${result.brand})`);
    } else {
      console.log(`[RAVE] fixture routing overrides cleared (brand:${result.brand})`);
    }

    res.json({
      ok: true,
      scope: result.scope,
      brand: result.brand || null,
      fixtureId: result.fixtureId || null,
      ...buildPaletteRuntimeSnapshot()
    });
  });

  app.get("/rave/palettes", (_, res) => {
    const activeEngine = getEngine();
    res.json({
      ok: true,
      palettes: activeEngine?.getPaletteCatalog?.() || []
    });
  });
};
