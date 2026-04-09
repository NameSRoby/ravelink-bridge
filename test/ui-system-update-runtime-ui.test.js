const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadFactory(relativeFile, factoryName, extraContext = {}) {
  const filePath = path.resolve(__dirname, "..", relativeFile);
  const code = fs.readFileSync(filePath, "utf8");
  const context = {
    console,
    setTimeout,
    clearTimeout,
    ...extraContext
  };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: filePath });
  const factory = context[factoryName];
  assert.equal(typeof factory, "function", `missing runtime factory: ${factoryName}`);
  return factory;
}

function createStorageStub() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(String(key || "")) ? map.get(String(key || "")) : null;
    },
    setItem(key, value) {
      map.set(String(key || ""), String(value || ""));
    }
  };
}

function createRuntime(options = {}) {
  const windowRef = {
    confirm: options.confirm || (() => false),
    openCalls: [],
    open(url, target, features) {
      this.openCalls.push({ url, target, features });
    }
  };
  const el = {
    health: {},
    systemUpdateStatus: { value: "" },
    systemUpdateApplyBtn: { disabled: false },
    systemUpdateOpenReleaseBtn: { disabled: false },
    systemUpdateChecksEnabled: { value: "true" },
    systemUpdateStartupPromptEnabled: { value: "true" }
  };
  const ui = {
    serverUpdateChecksEnabled: true,
    serverUpdateStartupPromptEnabled: true
  };
  const badges = [];
  let applyCalls = 0;
  const createSystemUpdateRuntimeUi = loadFactory(
    "public/assets/js/domains/system/system-update-runtime-ui.js",
    "createSystemUpdateRuntimeUi"
  );
  const runtime = createSystemUpdateRuntimeUi({
    el,
    ui,
    windowRef,
    sessionStorageRef: createStorageStub(),
    setBadge(node, state, text) {
      badges.push({ node, state, text });
    },
    systemEndpointsAdapter: {
      getUpdateStatus: async () => ({
        ok: true,
        currentVersion: "1.6.2",
        preferences: {
          updateChecksEnabled: true,
          updateStartupPromptEnabled: true
        },
        startup: {
          launchAt: 111,
          attempted: true,
          inFlight: false,
          completedAt: 222
        },
        lastCheck: {
          ok: true,
          mode: "startup",
          checkedAt: 333,
          updateAvailable: true,
          detail: "same_version_hotfix_available",
          latest: {
            tagName: "v1.6.2",
            version: "1.6.2",
            name: "RaveLink Bridge v1.6.2",
            releaseUrl: "https://example.invalid/release"
          }
        }
      }),
      checkForUpdates: async () => ({ ok: true, data: { ok: true } }),
      applyUpdate: async () => {
        applyCalls += 1;
        return {
          ok: true,
          data: {
            ok: true,
            currentVersion: "1.6.2",
            preferences: {
              updateChecksEnabled: true,
              updateStartupPromptEnabled: true
            },
            apply: {
              inFlight: false,
              lastResult: {
                ok: true,
                fromVersion: "1.6.2",
                toVersion: "1.6.2",
                requiresRestart: true
              }
            },
            lastCheck: {
              ok: true,
              mode: "startup",
              checkedAt: 333,
              updateAvailable: true,
              detail: "same_version_hotfix_available",
              latest: {
                tagName: "v1.6.2",
                version: "1.6.2",
                releaseUrl: "https://example.invalid/release"
              }
            }
          }
        };
      }
    }
  });
  return { runtime, el, ui, windowRef, badges, getApplyCalls: () => applyCalls };
}

test("system update runtime labels same-version updates as hotfixes", () => {
  const { runtime, el } = createRuntime();
  runtime.renderSystemUpdateStatus({
    ok: true,
    currentVersion: "1.6.2",
    lastCheck: {
      ok: true,
      checkedAt: Date.now(),
      updateAvailable: true,
      detail: "same_version_hotfix_available",
      latest: {
        version: "1.6.2",
        tagName: "v1.6.2"
      }
    }
  });
  assert.match(String(el.systemUpdateStatus.value || ""), /HOTFIX AVAILABLE/);
});

test("system update runtime startup prompt applies update when user confirms", async () => {
  const { runtime, badges, getApplyCalls } = createRuntime({
    confirm: () => true
  });
  const ok = await runtime.loadSystemUpdateStatus({
    announce: false,
    triggerStartupPrompt: true
  });

  assert.equal(ok, true);
  assert.equal(getApplyCalls(), 1);
  assert.equal(badges.some(entry => entry.text === "UPDATE APPLIED - RESTART REQUIRED"), true);
});

