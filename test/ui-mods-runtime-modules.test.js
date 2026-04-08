const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadFactory(relativeFile, factoryName) {
  const filePath = path.resolve(__dirname, "..", relativeFile);
  const code = fs.readFileSync(filePath, "utf8");
  const context = {
    console,
    setTimeout,
    clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: filePath });
  const factory = context[factoryName];
  assert.equal(typeof factory, "function", `missing runtime factory: ${factoryName}`);
  return factory;
}

function createClassList(initial = []) {
  const set = new Set(initial);
  return {
    add(...tokens) {
      for (const token of tokens) set.add(String(token || "").trim());
    },
    remove(...tokens) {
      for (const token of tokens) set.delete(String(token || "").trim());
    },
    toggle(token, force) {
      const key = String(token || "").trim();
      if (!key) return false;
      if (force === true) {
        set.add(key);
        return true;
      }
      if (force === false) {
        set.delete(key);
        return false;
      }
      if (set.has(key)) {
        set.delete(key);
        return false;
      }
      set.add(key);
      return true;
    },
    contains(token) {
      return set.has(String(token || "").trim());
    }
  };
}

test("mods ui-host runtime applies catalog and renders iframe shell deterministically", () => {
  const createModsUiHostRuntimeUi = loadFactory(
    "public/assets/js/domains/mods/mods-ui-host-runtime-ui.js",
    "createModsUiHostRuntimeUi"
  );

  const dynamicTabs = [];
  const tabQuery = [];
  const tabsBar = {
    querySelectorAll(selector) {
      if (selector === ".modUiDynamicTab") return tabQuery.slice();
      return [];
    },
    appendChild(node) {
      tabQuery.push(node);
      dynamicTabs.push(node);
    }
  };
  const modUiSelect = {
    options: [],
    value: "",
    replaceChildren() {
      this.options = [];
    },
    appendChild(node) {
      this.options.push(node);
    }
  };
  const postedMessages = [];
  const frame = {
    src: "",
    style: {},
    contentWindow: {
      postMessage(message, targetOrigin) {
        postedMessages.push({ message, targetOrigin });
      }
    }
  };
  const frameWrap = { classList: createClassList(["hidden"]) };
  const empty = { classList: createClassList(), textContent: "" };
  const status = { value: "" };
  const openBtn = { disabled: true };
  const reloadBtn = { disabled: true };
  const panel = { classList: createClassList(), dataset: {} };
  const modEnableId = { value: "" };
  const localStorageMap = new Map();

  const documentRef = {
    documentElement: {
      style: {
        getPropertyValue(name) {
          const values = {
            "--accent": "#ff3355",
            "--accentGlow": "rgba(255, 51, 85, 0.67)",
            "--btn-bg": "#182440"
          };
          return values[name] || "";
        }
      }
    },
    createElement(tag) {
      return {
        tagName: String(tag || "").toUpperCase(),
        type: "",
        className: "",
        dataset: {},
        classList: createClassList(),
        textContent: "",
        title: "",
        value: "",
        appendChild() {},
        remove() {}
      };
    }
  };
  const localStorageRef = {
    setItem(key, value) {
      localStorageMap.set(String(key), String(value));
    },
    removeItem(key) {
      localStorageMap.delete(String(key));
    }
  };
  const dispatchedEvents = [];
  const windowRef = {
    CustomEvent: function CustomEvent(type, init) {
      this.type = type;
      this.detail = init?.detail || {};
    },
    addEventListener() {},
    dispatchEvent(event) {
      dispatchedEvents.push(event);
      return true;
    }
  };
  const ui = {
    activeTab: "mods",
    themeName: "custom",
    themeConfig: {
      accent: "#ff3355",
      btnBg: "#182440"
    },
    modUiCatalog: [],
    modUiSelectedId: "",
    modUiLastId: "",
    modUiLastUrl: "",
    modsSnapshot: { mods: [] }
  };

  const runtime = createModsUiHostRuntimeUi({
    el: {
      tabsBar,
      modUiSelect,
      modUiFrame: frame,
      modUiFrameWrap: frameWrap,
      modUiEmpty: empty,
      modUiStatus: status,
      modUiOpenBtn: openBtn,
      modUiReloadBtn: reloadBtn,
      modUiPanel: panel,
      modEnableId
    },
    ui,
    documentRef,
    windowRef,
    localStorageRef,
    withBase: value => `/base${value}`,
    modsEndpointsAdapter: {},
    MOD_UI_SELECTED_KEY: "mods.ui.selected"
  });

  runtime.applyModUiCatalog([
    { id: "music-mod", title: "Music Mod", loaded: true, enabled: true, url: "/mods-ui/music-mod/" },
    { id: "fx-mod", title: "FX Mod", loaded: false, enabled: false, url: "" }
  ], { persist: true, forceReload: true });

  assert.equal(ui.modUiSelectedId, "music-mod");
  assert.equal(localStorageMap.get("mods.ui.selected"), "music-mod");
  assert.equal(modUiSelect.options.length >= 3, true);
  assert.equal(dynamicTabs.length, 1);
  assert.equal(frame.src, "about:blank");
  assert.equal(frameWrap.classList.contains("hidden"), true);
  assert.equal(openBtn.disabled, false);
  assert.equal(reloadBtn.disabled, false);
  assert.equal((status.value || "").includes("ready"), true);
  assert.equal(modEnableId.value, "music-mod");

  ui.activeTab = runtime.buildModUiTabName("music-mod");
  runtime.renderModUiFrame({ forceReload: true });
  assert.equal(frame.src.includes("/base/mods-ui/music-mod/?host=modui"), true);
  assert.equal(frameWrap.classList.contains("hidden"), false);
  assert.equal(openBtn.disabled, false);
  assert.equal(reloadBtn.disabled, false);
  assert.equal((status.value || "").includes("music-mod"), true);
  assert.equal(postedMessages.length >= 1, true);
  const themePost = postedMessages.find(row => row?.message?.type === "ravelink:theme");
  assert.equal(themePost?.message?.theme?.accent, "#ff3355");

  assert.equal(runtime.setModUiFrameHeight(820), true);
  assert.equal(frame.style.height, "820px");

  assert.equal(runtime.dispatchModUiOnboardingSteps({
    modId: "music-mod",
    steps: [{ title: "Music setup", body: "Use the mod panel." }]
  }), true);
  assert.equal(dispatchedEvents[0].type, "ravelink:mod-onboarding-steps");
  assert.equal(dispatchedEvents[0].detail.modId, "music-mod");
  assert.equal(dispatchedEvents[0].detail.steps.length, 1);
});

test("mods import runtime sanitizes relative paths and file descriptors", () => {
  const createModsImportRuntimeUi = loadFactory(
    "public/assets/js/domains/mods/mods-import-runtime-ui.js",
    "createModsImportRuntimeUi"
  );

  const runtime = createModsImportRuntimeUi({
    el: {},
    ui: {},
    windowRef: {},
    FileReaderRef: function FileReaderStub() {},
    modsEndpointsAdapter: {}
  });

  const normalized = runtime.normalizeImportRelativePath("..\\..\\mods\\my-mod\\./assets/../mod.json");
  assert.equal(normalized, "mods/my-mod/assets/mod.json");

  const descriptors = runtime.filesToImportDescriptors([
    { name: "mod.json", webkitRelativePath: "pack\\mod.json" },
    { name: "index.html", webkitRelativePath: "./pack\\ui\\index.html" },
    { name: "" }
  ]);
  assert.equal(descriptors.length, 2);
  assert.equal(descriptors[0].relativePath, "pack/mod.json");
  assert.equal(descriptors[1].relativePath, "pack/ui/index.html");
});

test("mods hotswap runtime queues and applies config transitions deterministically", async () => {
  const createModsHotswapRuntimeUi = loadFactory(
    "public/assets/js/domains/mods/mods-hotswap-runtime-ui.js",
    "createModsHotswapRuntimeUi"
  );

  const badges = [];
  const renderCalls = [];
  let appliedPayload = null;
  const el = {
    health: {},
    modEnableId: { value: "music-mod" },
    modActionModId: { value: "music-mod" },
    modActionName: { value: "reload" },
    modActionMethod: { value: "POST" },
    modActionOutput: { value: "" }
  };
  const ui = {
    modsSnapshot: {
      ok: true,
      mods: [
        { id: "music-mod", enabled: false },
        { id: "visualizer", enabled: true }
      ]
    },
    modsDraftDirty: false,
    modsDraftConfig: { enabled: [], order: [], disabled: [] },
    modsRuntimeConfig: { enabled: [], order: [], disabled: [] },
    modUiSelectedId: ""
  };

  const runtime = createModsHotswapRuntimeUi({
    el,
    ui,
    setBadge: (_node, state, text) => {
      badges.push({ state, text });
    },
    modsEndpointsAdapter: {
      async invokeAction(modId, action, method) {
        return {
          ok: true,
          status: 200,
          json: { ok: true, modId, action, method }
        };
      },
      async updateConfig(payload) {
        appliedPayload = payload;
        return {
          ok: true,
          data: {
            ok: true,
            config: payload,
            snapshot: {
              ok: true,
              mods: [
                { id: "music-mod", enabled: true },
                { id: "visualizer", enabled: true }
              ]
            }
          }
        };
      }
    },
    loadMods: async () => true,
    renderMods: snapshot => {
      renderCalls.push(snapshot);
    },
    cloneModConfig: config => ({
      enabled: Array.isArray(config?.enabled) ? config.enabled.slice() : [],
      order: Array.isArray(config?.order) ? config.order.slice() : [],
      disabled: Array.isArray(config?.disabled) ? config.disabled.slice() : []
    }),
    normalizeModUiId: value => String(value || "").trim(),
    normalizeModIdList: value => {
      const out = [];
      for (const raw of Array.isArray(value) ? value : []) {
        const id = String(raw || "").trim();
        if (!id || out.includes(id)) continue;
        out.push(id);
      }
      return out;
    },
    resolveQueuedModEnabled: (modId, runtimeEnabled, draftConfig) => {
      const id = String(modId || "").trim();
      if (!id) return Boolean(runtimeEnabled);
      const disabled = Array.isArray(draftConfig?.disabled) ? draftConfig.disabled : [];
      const enabled = Array.isArray(draftConfig?.enabled) ? draftConfig.enabled : [];
      if (disabled.includes(id)) return false;
      if (enabled.includes(id)) return true;
      return Boolean(runtimeEnabled);
    }
  });

  await runtime.queueModStateFromUi(true);
  assert.equal(ui.modsDraftDirty, true);
  assert.equal((ui.modsDraftConfig.enabled || []).includes("music-mod"), true);
  assert.equal((ui.modsDraftConfig.order || []).includes("music-mod"), true);
  assert.equal((badges.at(-1)?.text || "").includes("QUEUED ENABLE music-mod"), true);

  await runtime.applyModHotswapFromUi();
  assert.equal((badges.at(-1)?.text || ""), "HOTSWAP APPLIED");
  assert.equal(Boolean(appliedPayload), true);
  assert.equal((appliedPayload.enabled || []).includes("music-mod"), true);
  assert.equal(renderCalls.length >= 2, true);

  await runtime.runModAction();
  assert.equal((el.modActionOutput.value || "").includes("\"ok\": true"), true);
  assert.equal((badges.at(-1)?.text || ""), "MOD ACTION OK");
});
