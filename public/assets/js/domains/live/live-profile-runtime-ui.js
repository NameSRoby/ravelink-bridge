// [TITLE] Module: public/assets/js/domains/live/live-profile-runtime-ui.js
// [TITLE] Purpose: LIVE profile control wiring ownership
// [TITLE] Functionality Index:
// [TITLE] - LIVE profile startup hydration
// [TITLE] - LIVE profile save/load/delete/reset button wiring
// [TITLE] - LIVE profile name/select input wiring
// [DEV] Complex Flow:
// [DEV] This module is intentionally thin and depends on the shared LIVE profile store/snapshot
// [DEV] runtime loaded earlier. Keep load order stable in public/index.html when editing.

function initLiveProfileControls() {
  const startupStore = writeLiveProfileStore(readLiveProfileStore());
  const initialName = setCurrentLiveProfileName(resolveStartupLiveProfileName(startupStore));
  syncLiveProfileSelectOptions(initialName);
  refreshLiveProfileStatus(initialName);

  const startupEntry = startupStore.profiles?.[initialName] || startupStore.profiles?.default;
  if (startupEntry?.snapshot) {
    const startupSnapshot = normalizeLiveProfileSnapshot(startupEntry.snapshot, LIVE_PROFILE_DEFAULT);
    void applyLiveProfileSnapshot(startupSnapshot, { announce: false, forcePoll: false, pulse: false })
      .then(ok => {
        setLastAppliedLiveProfileName(initialName);
        const summary = formatLiveProfileSnapshotSummary(startupSnapshot);
        refreshLiveProfileStatus(initialName, ok
          ? `LIVE PROFILE: ${initialName} auto-loaded | ${summary}`
          : `LIVE PROFILE: ${initialName} auto-loaded (partial) | ${summary}`);
        scheduleLiveProfileStatusReset(initialName, 2400);
      })
      .catch(() => {
        refreshLiveProfileStatus(initialName, `LIVE PROFILE: ${initialName} auto-load failed`);
        scheduleLiveProfileStatusReset(initialName, 2400);
      });
  }

  if (el.liveProfileName) {
    el.liveProfileName.addEventListener("change", () => {
      const name = setCurrentLiveProfileName(el.liveProfileName.value);
      syncLiveProfileSelectOptions(name);
      refreshLiveProfileStatus(name);
    });
    el.liveProfileName.addEventListener("blur", () => {
      const name = setCurrentLiveProfileName(el.liveProfileName.value);
      syncLiveProfileSelectOptions(name);
      refreshLiveProfileStatus(name);
    });
  }

  if (el.liveProfileSelect) {
    el.liveProfileSelect.addEventListener("change", () => {
      const selectedName = resolveLiveProfileSelectedName();
      if (!selectedName) {
        const typed = normalizeLiveProfileName(el.liveProfileName?.value, "");
        const store = readLiveProfileStore();
        if (el.liveProfileDeleteBtn) {
          el.liveProfileDeleteBtn.disabled = !typed || typed === "default" || !store.profiles[typed];
        }
        refreshLiveProfileStatus(resolveCurrentLiveProfileName());
        return;
      }
      const name = setCurrentLiveProfileName(selectedName);
      syncLiveProfileSelectOptions(name);
      refreshLiveProfileStatus(name);
    });
  }

  if (el.liveProfileSaveBtn) {
    el.liveProfileSaveBtn.onclick = async () => {
      const name = setCurrentLiveProfileName(resolveCurrentLiveProfileName());
      const store = readLiveProfileStore();
      const snapshot = buildLiveProfileSnapshotFromUi();
      const [runtimePaletteSnapshot, runtimeFixtureMetricSnapshot, runtimeSyncGroupsSnapshot] = await Promise.all([
        buildLiveProfilePaletteSnapshotFromRuntime(),
        buildLiveProfileFixtureMetricSnapshotFromRuntime(),
        typeof buildLiveProfileSyncGroupsSnapshotFromRuntime === "function"
          ? buildLiveProfileSyncGroupsSnapshotFromRuntime()
          : Promise.resolve(null)
      ]);
      if (runtimePaletteSnapshot) snapshot.paletteSnapshot = runtimePaletteSnapshot;
      if (runtimeFixtureMetricSnapshot) snapshot.fixtureMetricSnapshot = runtimeFixtureMetricSnapshot;
      if (runtimeSyncGroupsSnapshot) snapshot.syncGroups = runtimeSyncGroupsSnapshot;
      store.profiles[name] = {
        savedAt: Date.now(),
        snapshot
      };
      writeLiveProfileStore(store);
      syncLiveProfileSelectOptions(name);
      refreshLiveProfileStatus(name, `LIVE PROFILE: ${name} saved | ${formatLiveProfileSnapshotSummary(snapshot)}`);
      scheduleLiveProfileStatusReset(name);
      setBadge(el.health, "ok", `LIVE PROFILE SAVED (${name.toUpperCase()})`);
    };
  }

  if (el.liveProfileLoadBtn) {
    el.liveProfileLoadBtn.onclick = async () => {
      const store = readLiveProfileStore();
      const name = setCurrentLiveProfileName(resolveLiveProfileActionName());
      const entry = store.profiles[name];
      if (!entry?.snapshot) {
        syncLiveProfileSelectOptions(name);
        refreshLiveProfileStatus(name, `LIVE PROFILE: ${name} not found`);
        scheduleLiveProfileStatusReset(name);
        setBadge(el.health, "warn", `LIVE PROFILE MISSING (${name.toUpperCase()})`);
        return;
      }
      const snapshot = normalizeLiveProfileSnapshot(entry.snapshot, LIVE_PROFILE_DEFAULT);
      const ok = await applyLiveProfileSnapshot(snapshot, { announce: false, forcePoll: true, pulse: true });
      setLastAppliedLiveProfileName(name);
      syncLiveProfileSelectOptions(name);
      const summary = formatLiveProfileSnapshotSummary(snapshot);
      refreshLiveProfileStatus(name, ok
        ? `LIVE PROFILE: ${name} loaded | ${summary}`
        : `LIVE PROFILE: ${name} loaded (partial) | ${summary}`);
      scheduleLiveProfileStatusReset(name);
      setBadge(el.health, ok ? "ok" : "warn", ok ? `LIVE PROFILE LOADED (${name.toUpperCase()})` : `LIVE PROFILE PARTIAL (${name.toUpperCase()})`);
    };
  }

  if (el.liveProfileDeleteBtn) {
    el.liveProfileDeleteBtn.onclick = () => {
      const store = readLiveProfileStore();
      const selected = resolveLiveProfileSelectedName();
      const typed = normalizeLiveProfileName(resolveCurrentLiveProfileName(), "");
      const target = store.profiles[selected]
        ? selected
        : (store.profiles[typed] ? typed : "");
      if (!target) {
        const name = resolveCurrentLiveProfileName();
        syncLiveProfileSelectOptions(name);
        refreshLiveProfileStatus(name, `LIVE PROFILE: ${name} not saved`);
        scheduleLiveProfileStatusReset(name);
        setBadge(el.health, "warn", "NO SAVED PROFILE TO DELETE");
        return;
      }
      if (target === "default") {
        const name = resolveCurrentLiveProfileName();
        syncLiveProfileSelectOptions(name);
        refreshLiveProfileStatus(name, "LIVE PROFILE: default is protected");
        scheduleLiveProfileStatusReset(name);
        setBadge(el.health, "warn", "DEFAULT PROFILE CANNOT BE DELETED");
        return;
      }
      const confirmDelete = window.confirm(`Delete LIVE profile "${target}" from local storage?`);
      if (!confirmDelete) return;
      delete store.profiles[target];
      const written = writeLiveProfileStore(store);
      const current = resolveCurrentLiveProfileName();
      const entries = getLiveProfileStoreEntriesSorted(written);
      const nextName = current === target
        ? (entries[0]?.name || "default")
        : current;
      setCurrentLiveProfileName(nextName);
      syncLiveProfileSelectOptions(nextName);
      refreshLiveProfileStatus(nextName, `LIVE PROFILE: ${target} deleted`);
      scheduleLiveProfileStatusReset(nextName);
      setBadge(el.health, "ok", `LIVE PROFILE DELETED (${target.toUpperCase()})`);
    };
  }

  if (el.liveProfileResetBtn) {
    el.liveProfileResetBtn.onclick = async () => {
      const ok = await applyLiveProfileSnapshot(LIVE_PROFILE_DEFAULT, { announce: false, forcePoll: true, pulse: true });
      setLastAppliedLiveProfileName("default");
      const name = resolveCurrentLiveProfileName();
      const summary = formatLiveProfileSnapshotSummary(LIVE_PROFILE_DEFAULT);
      syncLiveProfileSelectOptions(name);
      refreshLiveProfileStatus(resolveCurrentLiveProfileName(), ok
        ? `LIVE PROFILE: defaults loaded | ${summary}`
        : `LIVE PROFILE: defaults loaded (partial) | ${summary}`);
      scheduleLiveProfileStatusReset(name);
      setBadge(el.health, ok ? "ok" : "warn", ok ? "LIVE PROFILE DEFAULTS APPLIED" : "LIVE PROFILE DEFAULTS PARTIAL");
    };
  }
}
