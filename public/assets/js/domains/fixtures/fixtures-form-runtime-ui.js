// [TITLE] Module: public/assets/js/domains/fixtures/fixtures-form-runtime-ui.js
// [TITLE] Purpose: fixture form/editor state, validation, and table rendering helpers
// [TITLE] Functionality Index:
// [TITLE] - fixture brand selection and form visibility sync
// [TITLE] - fixture coupling validation and form payload collection
// [TITLE] - fixture editor fill/reset and table row rendering
// [DEV] Form/runtime ownership lives here so fixtures.js can stay focused on
// [DEV] snapshot loading and domain orchestration instead of DOM-heavy editor logic.

function createFixturesFormRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const windowRef = deps.windowRef || window;
  const documentRef = deps.documentRef || document;
  const setBadge = typeof deps.setBadge === "function" ? deps.setBadge : (() => {});
  const showTab = typeof deps.showTab === "function" ? deps.showTab : (() => {});
  const fixturesEndpointsAdapter = deps.fixturesEndpointsAdapter;
  const requiredAdapterMethods = ["deleteFixtureDeleteQuery", "saveFixture", "reloadFixtures"];
  if (!fixturesEndpointsAdapter || typeof fixturesEndpointsAdapter !== "object") {
    throw new Error("fixtures form runtime requires fixturesEndpointsAdapter");
  }
  for (const methodName of requiredAdapterMethods) {
    if (typeof fixturesEndpointsAdapter[methodName] !== "function") {
      throw new Error(`fixtures form runtime missing adapter method: ${methodName}`);
    }
  }
  const syncWizOnboardingUi = typeof deps.syncWizOnboardingUi === "function" ? deps.syncWizOnboardingUi : (() => {});
  const applyFixtureCatalogToUi = typeof deps.applyFixtureCatalogToUi === "function" ? deps.applyFixtureCatalogToUi : (() => {});
  const loadFixturesSnapshot = typeof deps.loadFixturesSnapshot === "function" ? deps.loadFixturesSnapshot : (async () => null);
  const refreshFixturesFromServer = typeof deps.refreshFixturesFromServer === "function" ? deps.refreshFixturesFromServer : (async () => ({ ok: false }));
  const getKnownFixtureCatalog = typeof deps.getKnownFixtureCatalog === "function" ? deps.getKnownFixtureCatalog : (async () => []);
  const upsertFixtureCatalogEntry = typeof deps.upsertFixtureCatalogEntry === "function"
    ? deps.upsertFixtureCatalogEntry
    : ((fixture = {}, options = {}) => {
      const source = Array.isArray(options.catalogSeed) ? options.catalogSeed.slice() : [];
      return fixture?.id ? [...source, { ...fixture }] : source;
    });
  const updateFixtures = typeof deps.updateFixtures === "function" ? deps.updateFixtures : (() => {});
  const ensureHueEntertainmentAreaSelection = typeof deps.ensureHueEntertainmentAreaSelection === "function"
    ? deps.ensureHueEntertainmentAreaSelection
    : (() => ({ ok: true, areaId: "" }));
  const getCanonicalZoneForBrand = typeof deps.getCanonicalZoneForBrand === "function"
    ? deps.getCanonicalZoneForBrand
    : ((_brand, fallback = "custom") => String(fallback || "custom").trim().toLowerCase() || "custom");
  const normalizeZoneKey = typeof deps.normalizeZoneKey === "function"
    ? deps.normalizeZoneKey
    : (value => String(value || "").trim().toLowerCase() || "custom");
  const isBuiltinFixtureBrand = typeof deps.isBuiltinFixtureBrand === "function"
    ? deps.isBuiltinFixtureBrand
    : (value => {
      const token = String(value || "").trim().toLowerCase();
      return token === "hue" || token === "wiz";
    });
  const normalizeFixtureModBrandToken = typeof deps.normalizeFixtureModBrandToken === "function"
    ? deps.normalizeFixtureModBrandToken
    : (value => String(value || "").trim().toLowerCase());
  const normalizeFixtureModBrandList = typeof deps.normalizeFixtureModBrandList === "function"
    ? deps.normalizeFixtureModBrandList
    : (value => Array.isArray(value) ? value.map(item => normalizeFixtureModBrandToken(item)).filter(Boolean) : []);
  const isValidFixtureBrand = typeof deps.isValidFixtureBrand === "function"
    ? deps.isValidFixtureBrand
    : (value => isBuiltinFixtureBrand(value) || Boolean(normalizeFixtureModBrandToken(value)));
  const isFixtureEngineEnabled = typeof deps.isFixtureEngineEnabled === "function"
    ? deps.isFixtureEngineEnabled
    : (fixture => fixture?.engineEnabled !== false);
  const isFixtureTwitchEnabled = typeof deps.isFixtureTwitchEnabled === "function"
    ? deps.isFixtureTwitchEnabled
    : (fixture => fixture?.twitchEnabled !== false);
  const isFixtureCustomEnabled = typeof deps.isFixtureCustomEnabled === "function"
    ? deps.isFixtureCustomEnabled
    : (fixture => fixture?.customEnabled === true);
  const isFixtureConfiguredForOutput = typeof deps.isFixtureConfiguredForOutput === "function"
    ? deps.isFixtureConfiguredForOutput
    : (fixture => Boolean(String(fixture?.ip || fixture?.bridgeIp || "").trim()));
  const FIXTURE_MOD_CUSTOM_BRAND_VALUE = String(deps.FIXTURE_MOD_CUSTOM_BRAND_VALUE || "__fixture_mod_custom__");

  function resolveFixtureFormBrand(fallback = "") {
    const fallbackBrand = isBuiltinFixtureBrand(fallback)
      ? String(fallback).trim().toLowerCase()
      : normalizeFixtureModBrandToken(fallback);
    const selectedBrand = String(el.fxBrand?.value || "").trim().toLowerCase();
    if (selectedBrand === FIXTURE_MOD_CUSTOM_BRAND_VALUE) {
      const customBrand = normalizeFixtureModBrandToken(el.fxModBrandId?.value || "");
      return customBrand || fallbackBrand;
    }
    if (isBuiltinFixtureBrand(selectedBrand)) return selectedBrand;
    return normalizeFixtureModBrandToken(selectedBrand) || fallbackBrand;
  }

  function syncFixtureBrandOptions(options = {}) {
    if (!el.fxBrand || !el.fxModBrandGroup) return;

    const requestedSelect = String(options.selectValue || "").trim().toLowerCase();
    const requestedCustomBrand = normalizeFixtureModBrandToken(options.customBrand || "");
    const previousSelect = String(el.fxBrand.value || "").trim().toLowerCase();
    const previousCustomBrand = normalizeFixtureModBrandToken(el.fxModBrandId?.value || "");
    const modsPresent = Number(ui.modsTotal || 0) > 0;

    const knownSet = new Set(normalizeFixtureModBrandList(ui.fixtureModBrands));
    const selectedKnownBrand = normalizeFixtureModBrandToken(requestedSelect || previousSelect);
    if (selectedKnownBrand) knownSet.add(selectedKnownBrand);
    if (requestedCustomBrand) knownSet.add(requestedCustomBrand);
    if (previousSelect === FIXTURE_MOD_CUSTOM_BRAND_VALUE && previousCustomBrand) {
      knownSet.add(previousCustomBrand);
    }

    const knownBrands = [...knownSet].sort();
    ui.fixtureModBrands = knownBrands;

    const allowCustomBrand = modsPresent;
    const locked = !allowCustomBrand && knownBrands.length === 0;
    el.fxModBrandGroup.innerHTML = "";
    el.fxModBrandGroup.label = locked ? "Mod Brands (locked)" : "Mod Brands";

    if (knownBrands.length > 0) {
      knownBrands.forEach(brand => {
        const option = documentRef.createElement("option");
        option.value = brand;
        option.textContent = brand.toUpperCase();
        el.fxModBrandGroup.appendChild(option);
      });
    }

    if (allowCustomBrand) {
      const customOption = documentRef.createElement("option");
      customOption.value = FIXTURE_MOD_CUSTOM_BRAND_VALUE;
      customOption.textContent = "CUSTOM MOD BRAND...";
      el.fxModBrandGroup.appendChild(customOption);
    }

    if (!knownBrands.length && !allowCustomBrand) {
      const placeholder = documentRef.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "No mod brands detected";
      placeholder.disabled = true;
      el.fxModBrandGroup.appendChild(placeholder);
    }

    el.fxModBrandGroup.disabled = locked;

    if (el.fxModBrandStatus) {
      if (knownBrands.length > 0 && allowCustomBrand) {
        el.fxModBrandStatus.textContent = `Detected mod brands: ${knownBrands.join(", ")}.`;
        el.fxModBrandStatus.classList.remove("prefixDisabled");
      } else if (knownBrands.length > 0) {
        el.fxModBrandStatus.textContent = `Configured mod brands: ${knownBrands.join(", ")}.`;
        el.fxModBrandStatus.classList.remove("prefixDisabled");
      } else if (allowCustomBrand) {
        el.fxModBrandStatus.textContent = "Mods detected. Select CUSTOM MOD BRAND... to add fixture brand ids.";
        el.fxModBrandStatus.classList.remove("prefixDisabled");
      } else {
        el.fxModBrandStatus.textContent = "Mod fixture brands unlock when mods are discovered.";
        el.fxModBrandStatus.classList.add("prefixDisabled");
      }
    }

    let nextSelect = requestedSelect || previousSelect || "hue";
    if (!isBuiltinFixtureBrand(nextSelect) && nextSelect !== FIXTURE_MOD_CUSTOM_BRAND_VALUE) {
      nextSelect = normalizeFixtureModBrandToken(nextSelect);
    }

    if (nextSelect === FIXTURE_MOD_CUSTOM_BRAND_VALUE && !allowCustomBrand) {
      nextSelect = knownBrands[0] || "hue";
    } else if (!isBuiltinFixtureBrand(nextSelect) && nextSelect !== FIXTURE_MOD_CUSTOM_BRAND_VALUE) {
      if (!nextSelect || !knownBrands.includes(nextSelect)) {
        nextSelect = knownBrands[0] || "hue";
      }
    }

    el.fxBrand.value = nextSelect;
    if (!el.fxBrand.value) el.fxBrand.value = knownBrands[0] || "hue";

    if (el.fxModBrandId) {
      if (el.fxBrand.value === FIXTURE_MOD_CUSTOM_BRAND_VALUE && allowCustomBrand) {
        el.fxModBrandId.value = requestedCustomBrand || previousCustomBrand || "";
      } else {
        el.fxModBrandId.value = "";
      }
    }

    if (options.applyVisibility !== false) applyFixtureBrandVisibility();
  }

  function readFixtureModeFields() {
    const brand = resolveFixtureFormBrand("");
    const zone = normalizeZoneKey(el.fxZone?.value, getCanonicalZoneForBrand(brand, "custom"));
    const engineEnabled = el.fxEngineEnabled?.value === "true";
    const twitchEnabled = el.fxTwitchEnabled?.value === "true";
    let customEnabled = el.fxCustomEnabled?.value === "true";

    if (engineEnabled && customEnabled) {
      customEnabled = false;
      if (el.fxCustomEnabled) el.fxCustomEnabled.value = "false";
    }

    const engineBinding = engineEnabled ? brand : "standalone";
    const controlMode = engineEnabled ? "engine" : "standalone";
    if (el.fxEngineBinding) el.fxEngineBinding.value = engineBinding;
    if (el.fxControlMode) el.fxControlMode.value = controlMode;

    return { zone, engineEnabled, twitchEnabled, customEnabled, engineBinding, controlMode };
  }

  function validateFixtureCoupling(brand, modeState) {
    const normalizedBrand = String(brand || "").trim().toLowerCase();
    const engineEnabled = modeState?.engineEnabled === true;
    const twitchEnabled = modeState?.twitchEnabled === true;
    const customEnabled = modeState?.customEnabled === true;
    const binding = String(modeState?.engineBinding || "").trim().toLowerCase();

    if (!isValidFixtureBrand(normalizedBrand)) {
      return { ok: false, message: "Fixture brand must be hue, wiz, or a valid lowercase mod brand id." };
    }
    if (engineEnabled && customEnabled) {
      return { ok: false, message: "Custom mode cannot be enabled while Engine mode is enabled." };
    }
    if (engineEnabled && binding !== normalizedBrand) {
      return {
        ok: false,
        message: `${normalizedBrand.toUpperCase()} fixtures can only bind to ${normalizedBrand.toUpperCase()} engine path.`
      };
    }

    const active = [];
    if (engineEnabled) active.push("engine");
    if (twitchEnabled) active.push("twitch");
    if (customEnabled) active.push("custom");
    return { ok: true, message: active.length ? `Modes: ${active.join(" + ")}` : "Modes: idle (no routing)" };
  }

  function updateFixtureCompatibilityHint() {
    const modeState = readFixtureModeFields();
    const check = validateFixtureCoupling(resolveFixtureFormBrand(""), modeState);
    if (el.fxCompatHint) {
      el.fxCompatHint.textContent = check.message;
      el.fxCompatHint.style.color = check.ok ? "#90e8b3" : "#ff8b8b";
    }
    return check;
  }

  function syncFixtureCouplingDefaults(reason = "") {
    void reason;
    readFixtureModeFields();
    updateFixtureCompatibilityHint();
  }

  function setSensitiveFieldVisibility(input, button, show, label = "sensitive field") {
    if (!input || !button) return;
    input.type = show ? "text" : "password";
    button.textContent = show ? "HIDE" : "SHOW";
    button.dataset.revealed = show ? "1" : "0";
    button.title = show ? `Hide ${label}.` : `Reveal ${label}.`;
  }

  function bindSensitiveFieldToggle(input, button, label = "this sensitive field") {
    if (!input || !button) return;
    setSensitiveFieldVisibility(input, button, false, label);
    button.onclick = () => {
      const revealed = button.dataset.revealed === "1";
      if (!revealed) {
        const ok = windowRef.confirm(
          `Warning: revealing ${label} can expose sensitive data on stream/screen-share.\n\nShow now?`
        );
        if (!ok) return;
      }
      setSensitiveFieldVisibility(input, button, !revealed, label);
    };
  }

  function applyFixtureBrandVisibility() {
    const selectedBrand = String(el.fxBrand?.value || "hue").trim().toLowerCase();
    const effectiveBrand = resolveFixtureFormBrand("");
    const isHue = selectedBrand === "hue" || effectiveBrand === "hue";
    const isCustomModBrand = selectedBrand === FIXTURE_MOD_CUSTOM_BRAND_VALUE;
    if (el.fxHueBridgeBlock) el.fxHueBridgeBlock.classList.toggle("hidden", !isHue);
    if (el.fxHueBridgeWrap) el.fxHueBridgeWrap.classList.toggle("hidden", !isHue);
    if (el.fxHueUserWrap) el.fxHueUserWrap.classList.toggle("hidden", !isHue);
    if (el.fxHueLightWrap) el.fxHueLightWrap.classList.toggle("hidden", !isHue);
    if (el.fxHueBridgeIdWrap) el.fxHueBridgeIdWrap.classList.toggle("hidden", !isHue);
    if (el.fxHueClientKeyWrap) el.fxHueClientKeyWrap.classList.toggle("hidden", !isHue);
    if (el.fxHueEntWrap) el.fxHueEntWrap.classList.toggle("hidden", !isHue);
    if (el.fxHuePairWrap) el.fxHuePairWrap.classList.toggle("hidden", !isHue);
    if (el.fxWizIpWrap) el.fxWizIpWrap.classList.toggle("hidden", isHue);
    if (el.fxModBrandWrap) el.fxModBrandWrap.classList.toggle("hidden", !isCustomModBrand);
    if (el.fxWizIpLabel) {
      const infoTipTitle = effectiveBrand === "wiz"
        ? "LAN IP of the WiZ fixture. One fixture per entry in this form."
        : "Adapter-defined target value for non-Hue fixtures. Keep empty if your mod brand adapter does not need this field.";
      const infoLabelText = effectiveBrand === "wiz" ? "WIZ IP" : "MOD TARGET / IP (OPTIONAL)";
      const infoTip = documentRef.createElement("span");
      infoTip.className = "infoTip";
      infoTip.title = infoTipTitle;
      infoTip.textContent = "?";
      el.fxWizIpLabel.replaceChildren(documentRef.createTextNode(`${infoLabelText} `), infoTip);
    }
    syncWizOnboardingUi();
    syncFixtureCouplingDefaults();
  }

  function resetFixtureForm() {
    syncFixtureBrandOptions({ selectValue: "hue", customBrand: "", applyVisibility: false });
    if (el.fxBrand) el.fxBrand.value = "hue";
    if (el.fxModBrandId) el.fxModBrandId.value = "";
    if (el.fxId) el.fxId.value = "";
    if (el.fxOriginalId) el.fxOriginalId.value = "";
    if (el.fxZone) el.fxZone.value = "";
    if (el.fxEnabled) el.fxEnabled.value = "true";
    if (el.fxEngineEnabled) el.fxEngineEnabled.value = "true";
    if (el.fxCustomEnabled) el.fxCustomEnabled.value = "false";
    if (el.fxTwitchEnabled) el.fxTwitchEnabled.value = "true";
    if (el.fxControlMode) el.fxControlMode.value = "engine";
    if (el.fxEngineBinding) el.fxEngineBinding.value = "hue";
    if (el.fxBridgeIp) el.fxBridgeIp.value = "";
    if (el.fxUsername) el.fxUsername.value = "";
    if (el.fxLightId) el.fxLightId.value = "1";
    if (el.fxBridgeId) el.fxBridgeId.value = "";
    if (el.fxClientKey) el.fxClientKey.value = "";
    if (el.fxEntertainmentAreaId) el.fxEntertainmentAreaId.value = "";
    if (el.fxHuePairMode) el.fxHuePairMode.value = "single_light";
    if (el.fxWizIp) el.fxWizIp.value = "";
    setSensitiveFieldVisibility(el.fxBridgeIp, el.fxBridgeIpShowBtn, false, "HUE BRIDGE IP");
    setSensitiveFieldVisibility(el.fxUsername, el.fxUsernameShowBtn, false, "HUE USERNAME");
    setSensitiveFieldVisibility(el.fxClientKey, el.fxClientKeyShowBtn, false, "HUE CLIENT KEY");
    setSensitiveFieldVisibility(el.fxWizIp, el.fxWizIpShowBtn, false, "WIZ IP / MOD TARGET");
    applyFixtureBrandVisibility();
  }

  function normalizeHueFixtureIdBridgeToken(value = "") {
    const token = String(value || "").trim().toLowerCase();
    const compact = token.replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
    return compact || "bridge";
  }

  function buildHueFixtureIdFromFormState() {
    const lightId = Math.max(1, Number(el.fxLightId?.value || 1));
    const bridgeToken = normalizeHueFixtureIdBridgeToken(el.fxBridgeId?.value || el.fxBridgeIp?.value || "");
    return `hue-${bridgeToken}-${lightId}`;
  }

  function collectFixtureForm() {
    const brand = resolveFixtureFormBrand("");
    const modeState = readFixtureModeFields();
    const explicitId = String(el.fxId?.value || "").trim();
    const nextId = brand === "hue" && !explicitId ? buildHueFixtureIdFromFormState() : explicitId;
    const replaceIdRaw = String(el.fxOriginalId?.value || "").trim();
    const replaceId = replaceIdRaw && nextId ? replaceIdRaw : "";
    const base = {
      id: nextId || undefined,
      replaceId: replaceId || undefined,
      brand,
      zone: modeState.zone,
      enabled: el.fxEnabled?.value === "true",
      controlMode: modeState.controlMode,
      engineBinding: modeState.engineBinding,
      engineEnabled: modeState.engineEnabled,
      twitchEnabled: modeState.twitchEnabled,
      customEnabled: modeState.customEnabled
    };

    if (brand === "hue") {
      return {
        ...base,
        bridgeIp: String(el.fxBridgeIp?.value || "").trim(),
        username: String(el.fxUsername?.value || "").trim(),
        lightId: Number(el.fxLightId?.value || 1),
        bridgeId: String(el.fxBridgeId?.value || "").trim(),
        clientKey: String(el.fxClientKey?.value || "").trim(),
        entertainmentAreaId: String(el.fxEntertainmentAreaId?.value || "").trim()
      };
    }
    return { ...base, ip: String(el.fxWizIp?.value || "").trim() };
  }

  function fillFixtureForm(fixture) {
    if (!fixture) return;
    const rawBrand = String(fixture.brand || "hue").trim().toLowerCase();
    const brand = isBuiltinFixtureBrand(rawBrand) ? rawBrand : (normalizeFixtureModBrandToken(rawBrand) || "hue");
    if (!isBuiltinFixtureBrand(brand)) {
      const knownSet = new Set(normalizeFixtureModBrandList(ui.fixtureModBrands));
      knownSet.add(brand);
      ui.fixtureModBrands = [...knownSet].sort();
    }
    syncFixtureBrandOptions({ selectValue: brand, customBrand: brand, applyVisibility: false });
    const engineEnabled = isFixtureEngineEnabled(fixture);
    const twitchEnabled = isFixtureTwitchEnabled(fixture);
    const customEnabled = isFixtureCustomEnabled(fixture);
    const controlMode = engineEnabled ? "engine" : "standalone";
    const engineBinding = engineEnabled ? String(fixture.engineBinding || brand) : "standalone";

    if (el.fxBrand) el.fxBrand.value = brand;
    if (!isBuiltinFixtureBrand(brand) && el.fxBrand?.value !== brand && el.fxModBrandId) {
      el.fxBrand.value = FIXTURE_MOD_CUSTOM_BRAND_VALUE;
      el.fxModBrandId.value = brand;
    } else if (isBuiltinFixtureBrand(brand) && el.fxModBrandId) {
      el.fxModBrandId.value = "";
    }
    if (el.fxId) el.fxId.value = fixture.id || "";
    if (el.fxOriginalId) el.fxOriginalId.value = fixture.id || "";
    if (el.fxZone) el.fxZone.value = fixture.zone || getCanonicalZoneForBrand(brand, "custom");
    if (el.fxEnabled) el.fxEnabled.value = fixture.enabled === false ? "false" : "true";
    if (el.fxEngineEnabled) el.fxEngineEnabled.value = engineEnabled ? "true" : "false";
    if (el.fxCustomEnabled) el.fxCustomEnabled.value = customEnabled ? "true" : "false";
    if (el.fxTwitchEnabled) el.fxTwitchEnabled.value = twitchEnabled ? "true" : "false";
    if (el.fxControlMode) el.fxControlMode.value = controlMode;
    if (el.fxEngineBinding) el.fxEngineBinding.value = engineBinding;
    if (el.fxBridgeIp) el.fxBridgeIp.value = fixture.bridgeIp || "";
    if (el.fxUsername) el.fxUsername.value = fixture.username || "";
    if (el.fxLightId) el.fxLightId.value = String(fixture.lightId || 1);
    if (el.fxBridgeId) el.fxBridgeId.value = fixture.bridgeId || "";
    if (el.fxClientKey) el.fxClientKey.value = fixture.clientKey || "";
    if (el.fxEntertainmentAreaId) el.fxEntertainmentAreaId.value = fixture.entertainmentAreaId || "";
    if (el.fxWizIp) el.fxWizIp.value = fixture.ip || "";
    setSensitiveFieldVisibility(el.fxBridgeIp, el.fxBridgeIpShowBtn, false, "HUE BRIDGE IP");
    setSensitiveFieldVisibility(el.fxUsername, el.fxUsernameShowBtn, false, "HUE USERNAME");
    setSensitiveFieldVisibility(el.fxClientKey, el.fxClientKeyShowBtn, false, "HUE CLIENT KEY");
    setSensitiveFieldVisibility(el.fxWizIp, el.fxWizIpShowBtn, false, "WIZ IP / MOD TARGET");
    applyFixtureBrandVisibility();
    showTab("fixtures");
  }

  async function openFixtureEditor(id) {
    const fixtureId = String(id || "").trim();
    if (!fixtureId) return;
    const snapshot = await loadFixturesSnapshot(3);
    const catalog = Array.isArray(snapshot?.fixtures) ? snapshot.fixtures : (Array.isArray(ui.fixturesCatalog) ? ui.fixturesCatalog : []);
    const target = catalog.find(row => String(row?.id || "") === fixtureId);
    if (target) fillFixtureForm(target);
  }

  async function requestFixtureDelete(id) {
    const fixtureId = String(id || "").trim();
    if (!fixtureId) return { ok: false, status: 0, data: { error: "missing id" } };
    return fixturesEndpointsAdapter.deleteFixtureDeleteQuery(fixtureId);
  }

  async function deleteFixtureFromUi(id) {
    const fixtureId = String(id || "").trim();
    if (!fixtureId) return;
    if (!windowRef.confirm(`Delete fixture ${fixtureId}?`)) return;

    const result = await requestFixtureDelete(fixtureId);
    if (!result?.ok) {
      const reason = result?.data?.error || `status ${result?.status || 0}`;
      setBadge(el.health, "bad", `FIXTURE DELETE FAIL: ${reason}`);
      return;
    }

    setBadge(el.health, "ok", "FIXTURE DELETED");
    const refreshed = await refreshFixturesFromServer({ attempts: 4 });
    if (refreshed?.ok) return;

    const nextCatalog = (Array.isArray(ui.fixturesCatalog) ? ui.fixturesCatalog : []).filter(
      item => String(item?.id || "").trim() !== fixtureId
    );
    applyFixtureCatalogToUi(nextCatalog);
  }

  function renderFixtureRows(fixtures = []) {
    if (!el.fixtureRows) return;
    el.fixtureRows.innerHTML = "";
    if (!fixtures.length) {
      const tr = documentRef.createElement("tr");
      const td = documentRef.createElement("td");
      td.colSpan = 8;
      td.textContent = "No fixtures configured.";
      tr.appendChild(td);
      el.fixtureRows.appendChild(tr);
      return;
    }

    for (const fixture of fixtures) {
      const tr = documentRef.createElement("tr");
      const brandKey = String(fixture?.brand || "").trim().toLowerCase();
      const target = brandKey === "hue"
        ? `hue light ${fixture.lightId || "-"}`
        : brandKey === "wiz"
          ? (isFixtureConfiguredForOutput(fixture) ? "wiz device configured" : "wiz device pending")
          : `${String(fixture?.brand || "mod").toUpperCase()} target managed by adapter`;
      const rawId = fixture.id === undefined || fixture.id === null || fixture.id === "" ? null : String(fixture.id);
      const id = rawId || "-";
      const brand = String((fixture.brand || "-").toUpperCase());
      const zone = String(fixture.zone || "-");
      const enabled = fixture.enabled === false ? "false" : "true";
      const engineEnabled = isFixtureEngineEnabled(fixture);
      const twitchEnabled = isFixtureTwitchEnabled(fixture);
      const appliedModes = [`ENG ${engineEnabled ? "ON" : "OFF"}`, `TWITCH ${twitchEnabled ? "ON" : "OFF"}`].join(" | ");

      const routeParts = [];
      if (engineEnabled) routeParts.push(String(fixture.engineBinding || fixture.brand || "-"));
      if (twitchEnabled) routeParts.push("twitch");
      const routePath = routeParts.length ? routeParts.join(" + ") : "-";

      const tdId = documentRef.createElement("td");
      tdId.className = "mono";
      tdId.textContent = id;
      const tdBrand = documentRef.createElement("td");
      tdBrand.textContent = brand;
      const tdZone = documentRef.createElement("td");
      tdZone.className = "mono";
      tdZone.textContent = zone;
      const tdMode = documentRef.createElement("td");
      tdMode.className = "mono";
      tdMode.textContent = appliedModes;
      const tdBinding = documentRef.createElement("td");
      tdBinding.className = "mono";
      tdBinding.textContent = routePath;
      const tdTarget = documentRef.createElement("td");
      tdTarget.className = "mono";
      tdTarget.textContent = target;
      const tdEnabled = documentRef.createElement("td");
      tdEnabled.textContent = enabled;
      const tdActions = documentRef.createElement("td");
      tdActions.className = "grid2";

      const editBtn = documentRef.createElement("button");
      editBtn.type = "button";
      editBtn.textContent = "EDIT";
      editBtn.title = "Open this fixture in the editor form above.";
      if (rawId) {
        editBtn.dataset.editId = rawId;
        editBtn.onclick = () => { openFixtureEditor(rawId); };
      } else {
        editBtn.disabled = true;
      }

      const delBtn = documentRef.createElement("button");
      delBtn.type = "button";
      delBtn.className = "bad";
      delBtn.textContent = "DEL";
      delBtn.title = "Delete this fixture from fixtures.config.json.";
      if (rawId) {
        delBtn.dataset.delId = rawId;
        delBtn.onclick = () => { deleteFixtureFromUi(rawId); };
      } else {
        delBtn.disabled = true;
      }

      tdActions.appendChild(editBtn);
      tdActions.appendChild(delBtn);
      tr.appendChild(tdId);
      tr.appendChild(tdBrand);
      tr.appendChild(tdZone);
      tr.appendChild(tdMode);
      tr.appendChild(tdBinding);
      tr.appendChild(tdTarget);
      tr.appendChild(tdEnabled);
      tr.appendChild(tdActions);
      el.fixtureRows.appendChild(tr);
    }
  }

  async function saveFixtureFromForm(options = {}) {
    const resetAfter = options.resetAfter !== false;
    const areaCheck = ensureHueEntertainmentAreaSelection({
      forcePrompt: false,
      promptIfMissing: true,
      forceWhenBridgeConfigured: true
    });
    if (!areaCheck.ok) {
      return { ok: false, error: areaCheck.message || "Hue Entertainment area is required.", savedFixture: null, routeSync: null };
    }

    const fixture = collectFixtureForm();
    if (fixture?.brand === "hue" && !String(el.fxId?.value || "").trim() && fixture.id && el.fxId) {
      el.fxId.value = String(fixture.id).trim();
    }
    fixture.zone = normalizeZoneKey(fixture.zone, getCanonicalZoneForBrand(fixture.brand, "custom"));
    const coupling = validateFixtureCoupling(fixture.brand, fixture);
    if (!coupling.ok) {
      return { ok: false, error: coupling.message, savedFixture: null, routeSync: null };
    }

    const result = await fixturesEndpointsAdapter.saveFixture(fixture);
    if (!result?.ok) {
      return { ok: false, error: result?.data?.error || "fixture save failed", savedFixture: null, routeSync: null };
    }

    const savedFixture = result?.data?.fixture || fixture;
    const replaceId = String(fixture?.replaceId || "").trim();
    const catalogSeed = await getKnownFixtureCatalog();
    const localCatalog = upsertFixtureCatalogEntry(savedFixture, { replaceId, catalogSeed });
    applyFixtureCatalogToUi(localCatalog);
    let refreshOk = localCatalog.length > 0;
    if (savedFixture?.id && el.fxOriginalId && !resetAfter) {
      el.fxOriginalId.value = String(savedFixture.id).trim();
    }

    let fixtureSnapshot = await loadFixturesSnapshot(3);
    if (!fixtureSnapshot) {
      await fixturesEndpointsAdapter.reloadFixtures();
      fixtureSnapshot = await loadFixturesSnapshot(2);
    }
    if (fixtureSnapshot) {
      updateFixtures(fixtureSnapshot);
      refreshOk = true;
    }
    if (!refreshOk && localCatalog.length > 0) refreshOk = true;
    if (resetAfter) resetFixtureForm();

    return { ok: true, savedFixture, refreshOk, routeSync: { ok: true, changed: false } };
  }

  return {
    resolveFixtureFormBrand,
    syncFixtureBrandOptions,
    readFixtureModeFields,
    validateFixtureCoupling,
    updateFixtureCompatibilityHint,
    syncFixtureCouplingDefaults,
    applyFixtureBrandVisibility,
    resetFixtureForm,
    setSensitiveFieldVisibility,
    bindSensitiveFieldToggle,
    collectFixtureForm,
    fillFixtureForm,
    renderFixtureRows,
    saveFixtureFromForm
  };
}
