const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createClassList(initial = []) {
  const values = new Set(initial.map(value => String(value)));
  return {
    add(...tokens) {
      tokens.forEach(token => values.add(String(token)));
    },
    remove(...tokens) {
      tokens.forEach(token => values.delete(String(token)));
    },
    toggle(token, force) {
      const key = String(token);
      if (force === true) {
        values.add(key);
        return true;
      }
      if (force === false) {
        values.delete(key);
        return false;
      }
      if (values.has(key)) {
        values.delete(key);
        return false;
      }
      values.add(key);
      return true;
    },
    contains(token) {
      return values.has(String(token));
    }
  };
}

function createNode(tagName = "div") {
  return {
    tagName: String(tagName).toUpperCase(),
    className: "",
    textContent: "",
    title: "",
    disabled: false,
    type: "",
    value: "",
    dataset: {},
    style: {},
    children: [],
    classList: createClassList(),
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    replaceChildren(...children) {
      this.children = children.slice();
    }
  };
}

function loadFixturesFormRuntime() {
  const filePath = path.resolve(__dirname, "..", "public/assets/js/domains/fixtures/fixtures-form-runtime-ui.js");
  const code = fs.readFileSync(filePath, "utf8");
  const context = { console, window: {}, document: {} };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: filePath });
  return context.createFixturesFormRuntimeUi;
}

function createFixturesAdapterStub() {
  return {
    deleteFixtureDeleteQuery: async () => ({ ok: true, data: {} }),
    saveFixture: async fixture => ({ ok: true, data: { fixture } }),
    reloadFixtures: async () => ({ ok: true, data: {} })
  };
}

function createFixtureElementBag() {
  return {
    fixtureRows: createNode("tbody"),
    fxBrand: { value: "hue" },
    fxModBrandGroup: { innerHTML: "", label: "", disabled: false, children: [], appendChild(child) { this.children.push(child); } },
    fxModBrandStatus: { textContent: "", classList: createClassList() },
    fxModBrandId: { value: "" },
    fxModBrandWrap: { classList: createClassList() },
    fxHueBridgeBlock: { classList: createClassList() },
    fxHueBridgeWrap: { classList: createClassList() },
    fxHueUserWrap: { classList: createClassList() },
    fxHueLightWrap: { classList: createClassList() },
    fxHueBridgeIdWrap: { classList: createClassList() },
    fxHueClientKeyWrap: { classList: createClassList() },
    fxHueEntWrap: { classList: createClassList() },
    fxHuePairWrap: { classList: createClassList() },
    fxWizIpWrap: { classList: createClassList() },
    fxWizIpLabel: createNode("label"),
    fxCompatHint: { textContent: "", style: {} },
    fxId: { value: "" },
    fxOriginalId: { value: "" },
    fxZone: { value: "" },
    fxEnabled: { value: "true" },
    fxEngineEnabled: { value: "true" },
    fxCustomEnabled: { value: "false" },
    fxTwitchEnabled: { value: "true" },
    fxControlMode: { value: "" },
    fxEngineBinding: { value: "" },
    fxBridgeIp: { value: "", type: "password" },
    fxUsername: { value: "", type: "password" },
    fxLightId: { value: "1" },
    fxBridgeId: { value: "" },
    fxClientKey: { value: "", type: "password" },
    fxEntertainmentAreaId: { value: "" },
    fxHuePairMode: { value: "single_light" },
    fxWizIp: { value: "", type: "password" },
    fxBridgeIpShowBtn: { dataset: {}, textContent: "", title: "" },
    fxUsernameShowBtn: { dataset: {}, textContent: "", title: "" },
    fxClientKeyShowBtn: { dataset: {}, textContent: "", title: "" },
    fxWizIpShowBtn: { dataset: {}, textContent: "", title: "" },
    health: {}
  };
}

test("fixtures form runtime collects hue payloads and auto-builds ids deterministically", () => {
  const createFixturesFormRuntimeUi = loadFixturesFormRuntime();
  const el = createFixtureElementBag();
  const ui = { fixtureModBrands: [], modsTotal: 0, fixturesCatalog: [] };
  el.fxBrand.value = "hue";
  el.fxBridgeId.value = "Bridge Alpha";
  el.fxLightId.value = "3";
  el.fxZone.value = "left";
  el.fxBridgeIp.value = "192.168.1.5";
  el.fxUsername.value = "user-token";
  el.fxClientKey.value = "client-key";
  el.fxEntertainmentAreaId.value = "area-1";

  const runtime = createFixturesFormRuntimeUi({
    el,
    ui,
    windowRef: { confirm: () => true },
    documentRef: {
      createElement: tag => createNode(tag),
      createTextNode: text => ({ textContent: String(text) })
    },
    fixturesEndpointsAdapter: createFixturesAdapterStub(),
    syncWizOnboardingUi() {},
    normalizeZoneKey: value => String(value || "").trim().toLowerCase() || "custom",
    getCanonicalZoneForBrand: (_brand, fallback) => fallback,
    isBuiltinFixtureBrand: value => ["hue", "wiz"].includes(String(value || "").trim().toLowerCase()),
    normalizeFixtureModBrandToken: value => String(value || "").trim().toLowerCase(),
    normalizeFixtureModBrandList: value => Array.isArray(value) ? value : [],
    isValidFixtureBrand: value => Boolean(String(value || "").trim()),
    isFixtureEngineEnabled: fixture => fixture?.engineEnabled !== false,
    isFixtureTwitchEnabled: fixture => fixture?.twitchEnabled !== false,
    isFixtureCustomEnabled: fixture => fixture?.customEnabled === true,
    isFixtureConfiguredForOutput: fixture => Boolean(fixture?.ip || fixture?.bridgeIp),
    FIXTURE_MOD_CUSTOM_BRAND_VALUE: "__fixture_mod_custom__"
  });

  const payload = runtime.collectFixtureForm();
  assert.equal(payload.id, "hue-bridge-alpha-3");
  assert.equal(payload.brand, "hue");
  assert.equal(payload.lightId, 3);
  assert.equal(payload.bridgeIp, "192.168.1.5");
  assert.equal(payload.username, "user-token");
  assert.equal(payload.clientKey, "client-key");
  assert.equal(payload.entertainmentAreaId, "area-1");
  assert.equal(payload.engineBinding, "hue");
  assert.equal(payload.controlMode, "engine");
});

test("fixtures form runtime fills custom mod-brand fixtures into the editor state", () => {
  const createFixturesFormRuntimeUi = loadFixturesFormRuntime();
  const el = createFixtureElementBag();
  const ui = { fixtureModBrands: [], modsTotal: 1, fixturesCatalog: [] };
  let shownTab = "";
  let wizSyncCount = 0;

  const runtime = createFixturesFormRuntimeUi({
    el,
    ui,
    showTab: tab => {
      shownTab = tab;
    },
    windowRef: { confirm: () => true },
    documentRef: {
      createElement: tag => createNode(tag),
      createTextNode: text => ({ textContent: String(text) })
    },
    fixturesEndpointsAdapter: createFixturesAdapterStub(),
    syncWizOnboardingUi() {
      wizSyncCount += 1;
    },
    normalizeZoneKey: value => String(value || "").trim().toLowerCase() || "custom",
    getCanonicalZoneForBrand: (_brand, fallback) => fallback,
    isBuiltinFixtureBrand: value => ["hue", "wiz"].includes(String(value || "").trim().toLowerCase()),
    normalizeFixtureModBrandToken: value => String(value || "").trim().toLowerCase(),
    normalizeFixtureModBrandList: value => Array.isArray(value) ? value.map(item => String(item || "").trim().toLowerCase()).filter(Boolean) : [],
    isValidFixtureBrand: value => Boolean(String(value || "").trim()),
    isFixtureEngineEnabled: fixture => fixture?.engineEnabled !== false,
    isFixtureTwitchEnabled: fixture => fixture?.twitchEnabled !== false,
    isFixtureCustomEnabled: fixture => fixture?.customEnabled === true,
    isFixtureConfiguredForOutput: fixture => Boolean(fixture?.ip || fixture?.bridgeIp),
    FIXTURE_MOD_CUSTOM_BRAND_VALUE: "__fixture_mod_custom__"
  });

  runtime.fillFixtureForm({
    id: "mod-zone-1",
    brand: "laser",
    zone: "custom",
    enabled: true,
    engineEnabled: true,
    twitchEnabled: false,
    customEnabled: false,
    engineBinding: "laser",
    ip: "custom-target"
  });

  assert.equal(el.fxBrand.value, "laser");
  assert.equal(el.fxModBrandId.value, "");
  assert.equal(el.fxId.value, "mod-zone-1");
  assert.equal(el.fxEngineBinding.value, "laser");
  assert.equal(el.fxWizIp.value, "custom-target");
  assert.equal(ui.fixtureModBrands.includes("laser"), true);
  assert.equal(el.fxModBrandWrap.classList.contains("hidden"), true);
  assert.equal(shownTab, "fixtures");
  assert.equal(wizSyncCount > 0, true);
});
