const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const LIVE_PROFILE_SNAPSHOT_PATH = path.resolve(__dirname, "..", "public/assets/js/domains/live/live-profile-snapshot-runtime-ui.js");
const LIVE_PROFILE_STORE_PATH = path.resolve(__dirname, "..", "public/assets/js/domains/live/live-profile-store-runtime-ui.js");
const LIVE_PROFILE_SNAPSHOT_CODE = fs.readFileSync(LIVE_PROFILE_SNAPSHOT_PATH, "utf8");
const LIVE_PROFILE_STORE_CODE = fs.readFileSync(LIVE_PROFILE_STORE_PATH, "utf8");

function createLocalStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(String(key), String(value));
    },
    removeItem(key) {
      data.delete(String(key));
    }
  };
}

function loadLiveProfileStoreContext() {
  const localStorage = createLocalStorage();
  const context = {
    console,
    localStorage,
    LIVE_PROFILE_STORE_KEY: "live_profiles_test",
    LIVE_PROFILE_LAST_KEY: "live_profile_last_test",
    LIVE_PROFILE_LAST_APPLIED_KEY: "live_profile_last_applied_test",
    ui: {},
    el: {
      liveProfileName: { value: "" },
      liveProfileSelect: { value: "", innerHTML: "" },
      liveProfileDeleteBtn: { disabled: false },
      liveProfileStat: { textContent: "" }
    },
    parseBooleanUi(value, fallback = false) {
      if (value === true || value === false) return value;
      if (value === 1 || value === "1" || String(value || "").trim().toLowerCase() === "true") return true;
      if (value === 0 || value === "0" || String(value || "").trim().toLowerCase() === "false") return false;
      return fallback === true;
    },
    clampNumber(value, min, max, fallback) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.max(min, Math.min(max, parsed));
    },
    escapeHtmlUi(value) {
      return String(value || "");
    },
    setTimeout() { return 1; },
    clearTimeout() {}
  };
  vm.createContext(context);
  vm.runInContext(LIVE_PROFILE_SNAPSHOT_CODE, context, { filename: LIVE_PROFILE_SNAPSHOT_PATH });
  vm.runInContext(LIVE_PROFILE_STORE_CODE, context, { filename: LIVE_PROFILE_STORE_PATH });
  return { context, localStorage };
}

test("live profile store persists normalized entries and always keeps default profile", () => {
  const { context, localStorage } = loadLiveProfileStoreContext();

  const written = context.writeLiveProfileStore({
    profiles: {
      " Main Show ": {
        savedAt: 123,
        snapshot: {
          sceneLock: "groove",
          overclockLevel: 8
        }
      }
    }
  });

  const storedRaw = JSON.parse(localStorage.getItem("live_profiles_test"));
  const readBack = context.readLiveProfileStore();

  assert.equal(typeof written.profiles.default, "object");
  assert.equal(typeof storedRaw.profiles.default, "object");
  assert.equal(readBack.profiles["main show"].snapshot.sceneLock, "motion");
  assert.equal(readBack.profiles["main show"].snapshot.overclockLevel, 7);
});

test("live profile store syncs select options and delete-button state from saved entries", () => {
  const { context } = loadLiveProfileStoreContext();

  context.writeLiveProfileStore({
    profiles: {
      default: {
        savedAt: 100,
        snapshot: { sceneLock: "auto" }
      },
      custom: {
        savedAt: 200,
        snapshot: { sceneLock: "impact" }
      }
    }
  });
  context.setCurrentLiveProfileName("custom");
  context.syncLiveProfileSelectOptions("custom");

  assert.equal(context.el.liveProfileSelect.value, "custom");
  assert.equal(context.el.liveProfileSelect.innerHTML.includes("CUSTOM / TYPE NAME"), true);
  assert.equal(context.el.liveProfileSelect.innerHTML.includes("default [BUILT-IN]"), true);
  assert.equal(context.el.liveProfileDeleteBtn.disabled, false);
});
