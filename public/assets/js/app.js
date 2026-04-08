// [TITLE] UI Functionality Index:
// [TITLE] - Theme + Layout State
// [TITLE] - Engine Controls + Telemetry Polling
// [TITLE] - Fixture Catalog + Routing Editor
// [TITLE] - Custom/Standalone Fixture Control
// [TITLE] - Audio Config + Per-Brand Reactivity Map
// [TITLE] - Hue Bridge Pairing + Entertainment Area Setup
// [TITLE] - Twitch/Color Routing + Prefixes
// [TITLE] - Mods Dashboard + Embedded Mod UI
const UI_STORAGE_RESET_KEYS = Object.freeze([
  "rave_api_base",
  THEME_STORAGE_KEY,
  DEV_DEBUG_KEY,
  DEV_DEBUG_WARN_ONCE_KEY,
  DEV_OVERCLOCK_COMICAL_ACK_KEY,
  MOD_UI_SELECTED_KEY,
  UI_STORAGE_MIGRATION_KEY,
  OBS_DOCK_COMPACT_KEY,
  UI_START_TAB_KEY,
  UI_CONFIRM_DANGER_KEY,
  UI_POLL_PAUSED_KEY,
  MIDI_TAB_FORCE_KEY,
  AUDIO_APPS_SHOW_ALL_KEY,
  AUDIO_SIMPLE_MODE_KEY,
  AUDIO_OPTIONAL_TOOLS_DISMISS_KEY,
  AUDIO_TUNING_MODE_KEY,
  LIVE_PROFILE_STORE_KEY,
  LIVE_PROFILE_LAST_KEY,
  LIVE_PROFILE_LAST_APPLIED_KEY,
  PALETTE_FIXTURE_SELECTION_KEY
]);
const UI_STORAGE_RESET_PREFIXES = Object.freeze([
  "ravelink_ui_collapsed_",
  "ravelink_ui_theme_"
]);

ui.devDebugWarned = localStorage.getItem(DEV_DEBUG_WARN_ONCE_KEY) === "1";
ui.devOverclockComicalAcked = localStorage.getItem(DEV_OVERCLOCK_COMICAL_ACK_KEY) === "1";

function removeStorageKeys(storage, keys = []) {
  if (!storage || typeof storage.removeItem !== "function") return;
  for (const key of keys) {
    try {
      storage.removeItem(String(key || ""));
    } catch (err) {
      console.debug("[UI][DEBUG] removeStorageKeys failed:", err?.message || err);
    }
  }
}

function removeStoragePrefixKeys(storage, prefixes = []) {
  if (!storage || typeof storage.key !== "function" || typeof storage.removeItem !== "function") return;
  for (let i = Number(storage.length || 0) - 1; i >= 0; i -= 1) {
    const key = String(storage.key(i) || "");
    if (!key) continue;
    if (prefixes.some(prefix => key.startsWith(prefix))) {
      try {
        storage.removeItem(key);
      } catch (err) {
        console.debug("[UI][DEBUG] removeStoragePrefixKeys failed:", err?.message || err);
      }
    }
  }
}

async function clearBrowserCacheStorage() {
  if (typeof window === "undefined" || !window.caches || typeof window.caches.keys !== "function") return;
  try {
    const cacheNames = await window.caches.keys();
    await Promise.all(
      cacheNames.map(name => window.caches.delete(name).catch(() => false))
    );
  } catch (err) {
    console.debug("[UI][DEBUG] clearBrowserCacheStorage failed:", err?.message || err);
  }
}

async function wipeUiBrowserMemory(options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const includeCacheStorage = opts.includeCacheStorage === true;
  removeStorageKeys(localStorage, UI_STORAGE_RESET_KEYS);
  removeStoragePrefixKeys(localStorage, UI_STORAGE_RESET_PREFIXES);
  removeStorageKeys(sessionStorage, UI_STORAGE_RESET_KEYS);
  removeStoragePrefixKeys(sessionStorage, UI_STORAGE_RESET_PREFIXES);
  if (includeCacheStorage) {
    await clearBrowserCacheStorage();
  }
}

async function applyUiStorageMigration() {
  const applied = String(localStorage.getItem(UI_STORAGE_MIGRATION_KEY) || "").trim();
  if (applied === UI_STORAGE_MIGRATION_TARGET) return;

  // Ensure this release starts with a clean UI cache/state baseline.
  await wipeUiBrowserMemory({ includeCacheStorage: false });
  localStorage.setItem(UI_STORAGE_MIGRATION_KEY, UI_STORAGE_MIGRATION_TARGET);
}

applyUiStorageMigration().catch(err => {
  console.debug("[UI][DEBUG] applyUiStorageMigration failed:", err?.message || err);
});

function setBadge(node, state, text) {
  if (!node) return;
  const nextState = String(state || "").trim().toLowerCase();
  const nextText = String(text || "");
  if (
    typeof el !== "undefined" &&
    node === el.health &&
    !/^FIXTURES\b/i.test(nextText) &&
    !/^ENGINE UNREACHABLE$/i.test(nextText)
  ) {
    return;
  }
  const stateChanged = !node.classList.contains(nextState);
  const textChanged = node.textContent !== nextText;
  if (!stateChanged && !textChanged) return;
  node.classList.remove("ok", "warn", "bad");
  if (nextState) node.classList.add(nextState);
  node.textContent = nextText;
}

function toFixedSafe(value, digits = 2, fallback = "0") {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return String(fallback);
  const places = Math.max(0, Math.min(6, Math.floor(Number(digits) || 0)));
  try {
    return parsed.toFixed(places);
  } catch {
    return String(fallback);
  }
}

window.addEventListener("beforeunload", () => {
  if (typeof stopTelemetryPolling === "function") {
    stopTelemetryPolling();
  }
  if (typeof flowIntensityCommitTimer !== "undefined" && flowIntensityCommitTimer) {
    clearTimeout(flowIntensityCommitTimer);
  }
  if (typeof mainScopeAnim !== "undefined" && mainScopeAnim) {
    cancelAnimationFrame(mainScopeAnim);
  }
});






