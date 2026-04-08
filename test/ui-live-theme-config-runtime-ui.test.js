// [TITLE] Test Module: test/ui-live-theme-config-runtime-ui.test.js
// [TITLE] Purpose: guard LIVE theme config runtime split

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadRuntimeFactory() {
  const filePath = path.resolve(__dirname, "..", "public", "assets", "js", "domains", "live", "live-theme-config-runtime-ui.js");
  const context = { console };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(filePath, "utf8"), context, { filename: filePath });
  return context.createLiveThemeConfigRuntimeUi;
}

test("LIVE theme config runtime applies CSS variables and persists normalized custom colors", () => {
  const createLiveThemeConfigRuntimeUi = loadRuntimeFactory();
  const writes = [];
  const storage = {};
  const ui = { themeName: "neon" };
  const runtime = createLiveThemeConfigRuntimeUi({
    ui,
    documentRef: {
      documentElement: {
        style: {
          setProperty(key, value) {
            writes.push([key, value]);
          }
        }
      }
    },
    localStorageRef: {
      setItem(key, value) {
        storage[key] = value;
      }
    },
    THEME_STORAGE_KEY: "theme-key",
    DEFAULT_THEME_NAME: "midnight",
    THEME_PRESETS: {
      midnight: {
        bg: "#000001",
        panel: "#000002",
        panel2: "#000003",
        accent: "#000004",
        edge: "#000005",
        btnBg: "#000006",
        text: "#000007",
        ok: "#000008",
        warn: "#000009",
        bad: "#00000a",
        glow: 67
      },
      neon: {
        bg: "#101010",
        panel: "#202020",
        panel2: "#303030",
        accent: "#ff0088",
        edge: "#404040",
        btnBg: "#505050",
        text: "#f0f0f0",
        ok: "#00ff88",
        warn: "#ffcc00",
        bad: "#ff3355",
        glow: 50
      }
    }
  });

  runtime.applyThemeConfig({ accent: "bad", btnBg: "#abcdef", glow: 42, ok: "#112233" });

  assert.equal(runtime.normalizeHexColor("nope", "#123456"), "#123456");
  assert.equal(runtime.hexToRgba("#ff0000", 0.5), "rgba(255, 0, 0, 0.500)");
  assert.deepEqual(writes, [
    ["--bg", "#101010"],
    ["--panel", "#202020"],
    ["--panel2", "#303030"],
    ["--accent", "#ff0088"],
    ["--accentGlow", "rgba(255, 0, 136, 0.420)"],
    ["--edge", "#404040"],
    ["--btn-bg", "#abcdef"],
    ["--text", "#f0f0f0"],
    ["--ok", "#112233"],
    ["--warn", "#ffcc00"],
    ["--bad", "#ff3355"]
  ]);
  assert.equal(ui.themeConfig.accent, "#ff0088");
  assert.equal(ui.themeConfig.glow, 42);
  assert.deepEqual(JSON.parse(storage["theme-key"]), {
    name: "neon",
    custom: {
      bg: "#101010",
      panel: "#202020",
      panel2: "#303030",
      accent: "#ff0088",
      edge: "#404040",
      btnBg: "#abcdef",
      text: "#f0f0f0",
      ok: "#112233",
      warn: "#ffcc00",
      bad: "#ff3355",
      glow: 42
    }
  });
});
