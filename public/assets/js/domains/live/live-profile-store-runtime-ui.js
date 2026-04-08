// [TITLE] Module: public/assets/js/domains/live/live-profile-store-runtime-ui.js
// [TITLE] Purpose: LIVE profile store, select-state, and status ownership
// [TITLE] Functionality Index:
// [TITLE] - localStorage-backed LIVE profile store helpers
// [TITLE] - profile name/select resolution and current-profile memory
// [TITLE] - LIVE profile status copy and reset-timer ownership
// [DEV] Complex Flow:
// [DEV] Snapshot normalization/apply now lives in live-profile-snapshot-runtime-ui.js.
// [DEV] Keep this file focused on storage/status UI ownership so profile persistence
// [DEV] stays independent from current scene runtime behavior.

const LIVE_PROFILE_SELECT_CUSTOM_VALUE = "__custom__";
let liveProfileStatusResetTimer = null;

function normalizeLiveProfileName(value, fallback = "default") {
  const raw = String(value || "").trim().toLowerCase();
  const compact = raw.replace(/\s+/g, " ");
  if (/^[a-z0-9][a-z0-9 _-]{0,31}$/.test(compact)) return compact;
  return String(fallback || "default").trim().toLowerCase() || "default";
}

function buildDefaultLiveProfileEntry(existing = null) {
  const safeExisting = existing && typeof existing === "object" ? existing : {};
  const savedAt = Number(safeExisting.savedAt);
  return {
    savedAt: Number.isFinite(savedAt) && savedAt > 0 ? savedAt : Date.now(),
    snapshot: normalizeLiveProfileSnapshot(
      safeExisting.snapshot || LIVE_PROFILE_DEFAULT,
      LIVE_PROFILE_DEFAULT
    )
  };
}

function ensureLiveProfileStoreDefault(store = null) {
  const source = store && typeof store === "object" ? store : { version: 1, profiles: {} };
  const rawProfiles = source.profiles && typeof source.profiles === "object" && !Array.isArray(source.profiles)
    ? source.profiles
    : {};
  const profiles = { ...rawProfiles };
  profiles.default = buildDefaultLiveProfileEntry(profiles.default);
  return { version: 1, profiles };
}

function readLiveProfileStore() {
  const empty = { version: 1, profiles: {} };
  try {
    const raw = String(localStorage.getItem(LIVE_PROFILE_STORE_KEY) || "").trim();
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return empty;
    const profilesRaw = parsed.profiles && typeof parsed.profiles === "object" && !Array.isArray(parsed.profiles)
      ? parsed.profiles
      : {};
    const profiles = {};
    for (const [rawName, payload] of Object.entries(profilesRaw)) {
      const name = normalizeLiveProfileName(rawName, "");
      if (!name) continue;
      const snapshotRaw = payload && typeof payload === "object" && !Array.isArray(payload)
        ? payload.snapshot
        : null;
      const snapshot = normalizeLiveProfileSnapshot(snapshotRaw || payload || {}, LIVE_PROFILE_DEFAULT);
      const savedAt = Number(payload?.savedAt);
      profiles[name] = {
        savedAt: Number.isFinite(savedAt) ? savedAt : Date.now(),
        snapshot
      };
      if (Object.keys(profiles).length >= 24) break;
    }
    return ensureLiveProfileStoreDefault({ version: 1, profiles });
  } catch {
    return ensureLiveProfileStoreDefault(empty);
  }
}

function writeLiveProfileStore(store) {
  const safeStore = store && typeof store === "object" ? store : {};
  const profilesRaw = safeStore.profiles && typeof safeStore.profiles === "object" ? safeStore.profiles : {};
  const profiles = {};
  for (const [rawName, payload] of Object.entries(profilesRaw)) {
    const name = normalizeLiveProfileName(rawName, "");
    if (!name) continue;
    const snapshot = normalizeLiveProfileSnapshot(payload?.snapshot || payload || {}, LIVE_PROFILE_DEFAULT);
    const savedAt = Number(payload?.savedAt);
    profiles[name] = {
      savedAt: Number.isFinite(savedAt) ? savedAt : Date.now(),
      snapshot
    };
    if (Object.keys(profiles).length >= 24) break;
  }
  const safe = ensureLiveProfileStoreDefault({ version: 1, profiles });
  localStorage.setItem(LIVE_PROFILE_STORE_KEY, JSON.stringify(safe));
  return safe;
}

function getLiveProfileStoreEntriesSorted(store = null) {
  const source = store && typeof store === "object" ? store : readLiveProfileStore();
  const profiles = source.profiles && typeof source.profiles === "object" ? source.profiles : {};
  return Object.entries(profiles)
    .map(([name, entry]) => {
      const safeName = normalizeLiveProfileName(name, "");
      const savedAt = Number(entry?.savedAt);
      return {
        name: safeName,
        savedAt: Number.isFinite(savedAt) ? savedAt : 0
      };
    })
    .filter(entry => Boolean(entry.name))
    .sort((a, b) => {
      const byTime = b.savedAt - a.savedAt;
      if (byTime !== 0) return byTime;
      return String(a.name).localeCompare(String(b.name));
    });
}

function formatLiveProfileSavedAt(savedAt) {
  const ms = Number(savedAt);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  try {
    return new Date(ms).toLocaleTimeString();
  } catch {
    return "";
  }
}

function resolveCurrentLiveProfileName() {
  return normalizeLiveProfileName(
    el.liveProfileName?.value ||
      localStorage.getItem(LIVE_PROFILE_LAST_KEY) ||
      "default",
    "default"
  );
}

function resolveLastAppliedLiveProfileName() {
  return normalizeLiveProfileName(localStorage.getItem(LIVE_PROFILE_LAST_APPLIED_KEY) || "", "");
}

function setLastAppliedLiveProfileName(name) {
  const safe = normalizeLiveProfileName(name, "default");
  localStorage.setItem(LIVE_PROFILE_LAST_APPLIED_KEY, safe);
  return safe;
}

function resolveStartupLiveProfileName(store = null) {
  const source = store && typeof store === "object" ? store : readLiveProfileStore();
  const preferred = normalizeLiveProfileName(
    resolveLastAppliedLiveProfileName() || localStorage.getItem(LIVE_PROFILE_LAST_KEY) || "default",
    "default"
  );
  return source.profiles && source.profiles[preferred]
    ? preferred
    : "default";
}

function setCurrentLiveProfileName(name) {
  const safe = normalizeLiveProfileName(name, "default");
  if (el.liveProfileName) el.liveProfileName.value = safe;
  localStorage.setItem(LIVE_PROFILE_LAST_KEY, safe);
  return safe;
}

function syncLiveProfileSelectOptions(nameHint = null) {
  if (!el.liveProfileSelect) return;
  const currentName = normalizeLiveProfileName(nameHint || resolveCurrentLiveProfileName(), "default");
  const store = writeLiveProfileStore(readLiveProfileStore());
  const entries = getLiveProfileStoreEntriesSorted(store);

  const options = [
    { value: LIVE_PROFILE_SELECT_CUSTOM_VALUE, label: "CUSTOM / TYPE NAME" },
    ...entries.map(entry => {
      const timeText = formatLiveProfileSavedAt(entry.savedAt);
      const suffix = timeText ? ` (${timeText})` : "";
      const protectedLabel = entry.name === "default" ? " [BUILT-IN]" : "";
      return {
        value: entry.name,
        label: `${entry.name}${protectedLabel}${suffix}`
      };
    })
  ];

  el.liveProfileSelect.innerHTML = options
    .map(opt => `<option value="${escapeHtmlUi(opt.value)}">${escapeHtmlUi(opt.label)}</option>`)
    .join("");

  const hasCurrent = entries.some(entry => entry.name === currentName);
  el.liveProfileSelect.value = hasCurrent ? currentName : LIVE_PROFILE_SELECT_CUSTOM_VALUE;
  if (el.liveProfileDeleteBtn) {
    const selectedName = normalizeLiveProfileName(el.liveProfileSelect.value, "");
    const canDeleteSelected = entries.some(entry => entry.name === selectedName && entry.name !== "default");
    const canDeleteCurrent = entries.some(entry => entry.name === currentName && entry.name !== "default");
    el.liveProfileDeleteBtn.disabled = !(canDeleteSelected || canDeleteCurrent);
  }
}

function resolveLiveProfileSelectedName() {
  if (!el.liveProfileSelect) return "";
  return normalizeLiveProfileName(el.liveProfileSelect.value, "");
}

function resolveLiveProfileActionName() {
  const selected = resolveLiveProfileSelectedName();
  if (selected) return selected;
  return resolveCurrentLiveProfileName();
}

function clearLiveProfileStatusResetTimer() {
  if (!liveProfileStatusResetTimer) return;
  clearTimeout(liveProfileStatusResetTimer);
  liveProfileStatusResetTimer = null;
}

function scheduleLiveProfileStatusReset(name, delayMs = 3600) {
  clearLiveProfileStatusResetTimer();
  const waitMs = Math.max(1200, Number(delayMs) || 3600);
  liveProfileStatusResetTimer = setTimeout(() => {
    refreshLiveProfileStatus(name);
  }, waitMs);
}

function refreshLiveProfileStatus(name = null, overrideText = "") {
  if (!el.liveProfileStat) return;
  const custom = String(overrideText || "").trim();
  if (custom) {
    el.liveProfileStat.textContent = custom;
    return;
  }
  const profileName = normalizeLiveProfileName(name || resolveCurrentLiveProfileName(), "default");
  const store = readLiveProfileStore();
  const entry = store.profiles[profileName];
  if (!entry) {
    el.liveProfileStat.textContent = `LIVE PROFILE: ${profileName} (unsaved)`;
    return;
  }
  const timeText = formatLiveProfileSavedAt(entry.savedAt);
  el.liveProfileStat.textContent = timeText
    ? `LIVE PROFILE: ${profileName} (saved ${timeText})`
    : `LIVE PROFILE: ${profileName} (saved)`;
}
