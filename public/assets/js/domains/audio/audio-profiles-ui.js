// [TITLE] Module: public/assets/js/domains/audio/audio-profiles-ui.js
// [TITLE] Purpose: audio profile loading, rendering, and CRUD button ownership
// [TITLE] Functionality Index:
// [TITLE] - profile status surface
// [TITLE] - saved profile select rendering
// [TITLE] - remote profile load/save/apply/delete flows
// [DEV] Complex Flow:
// [DEV] This module keeps the profile surface cohesive by owning only the named audio
// [DEV] profile UI. It does not own broader audio config rendering or telemetry; those
// [DEV] remain in audio.js and are injected into the profile handlers as dependencies.

function createAudioProfilesUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const normalizeAudioProfileNameUi = typeof deps.normalizeAudioProfileNameUi === "function"
    ? deps.normalizeAudioProfileNameUi
    : (value => String(value || "").trim());
  const getAudioProfiles = typeof deps.getAudioProfiles === "function"
    ? deps.getAudioProfiles
    : (async () => null);
  const saveAudioProfile = typeof deps.saveAudioProfile === "function"
    ? deps.saveAudioProfile
    : (async () => ({ ok: false }));
  const applyAudioProfile = typeof deps.applyAudioProfile === "function"
    ? deps.applyAudioProfile
    : (async () => ({ ok: false }));
  const deleteAudioProfile = typeof deps.deleteAudioProfile === "function"
    ? deps.deleteAudioProfile
    : (async () => ({ ok: false }));
  const formatAudioApiErrorWithHint = typeof deps.formatAudioApiErrorWithHint === "function"
    ? deps.formatAudioApiErrorWithHint
    : ((r, fallback = "request failed") => String(r?.error || fallback));
  const runAudioButtonActionWithResult = typeof deps.runAudioButtonActionWithResult === "function"
    ? deps.runAudioButtonActionWithResult
    : (async (_button, _workingLabel, action) => action());
  const announceAudioActionStatus = typeof deps.announceAudioActionStatus === "function"
    ? deps.announceAudioActionStatus
    : (() => {});
  const applyAudioConfigToInputs = typeof deps.applyAudioConfigToInputs === "function"
    ? deps.applyAudioConfigToInputs
    : (() => {});
  const confirmDelete = typeof deps.confirmDelete === "function"
    ? deps.confirmDelete
    : (name => window.confirm(`Delete audio profile "${name}"?`));

  function setAudioProfileStatusUi(text = "Audio profiles idle.") {
    if (!el.aProfileStatus) return;
    el.aProfileStatus.value = String(text || "Audio profiles idle.");
  }

  function renderAudioProfilesUi(selectedName = "") {
    if (!el.aProfileSelect) return;
    const selected = normalizeAudioProfileNameUi(selectedName || el.aProfileSelect.value || "");
    const profiles = Array.isArray(ui.audioProfiles) ? ui.audioProfiles : [];
    el.aProfileSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "select saved profile...";
    el.aProfileSelect.appendChild(placeholder);
    for (const profile of profiles) {
      const profileName = normalizeAudioProfileNameUi(profile?.name || "");
      if (!profileName) continue;
      const option = document.createElement("option");
      option.value = profileName;
      option.textContent = profileName;
      el.aProfileSelect.appendChild(option);
    }
    const effectiveSelected = selected && profiles.some(profile => normalizeAudioProfileNameUi(profile?.name || "") === selected)
      ? selected
      : "";
    el.aProfileSelect.value = effectiveSelected;
  }

  async function loadAudioProfiles(options = {}) {
    const selectedName = normalizeAudioProfileNameUi(options.selectedName || "");
    const r = await getAudioProfiles();
    if (!r || !r.ok || !r.profiles || !Array.isArray(r.profiles.profiles)) {
      ui.audioProfiles = [];
      renderAudioProfilesUi("");
      return false;
    }
    ui.audioProfiles = r.profiles.profiles
      .map(profile => ({
        name: normalizeAudioProfileNameUi(profile?.name || ""),
        id: String(profile?.id || "").trim(),
        updatedAt: Number(profile?.updatedAt || 0)
      }))
      .filter(profile => profile.name);
    renderAudioProfilesUi(selectedName);
    if (options.syncNameInput !== false && el.aProfileName) {
      const selected = normalizeAudioProfileNameUi(el.aProfileSelect?.value || selectedName || "");
      if (selected) el.aProfileName.value = selected;
    }
    if (options.silent !== true) {
      setAudioProfileStatusUi(
        ui.audioProfiles.length
          ? `Loaded ${ui.audioProfiles.length} audio profile${ui.audioProfiles.length === 1 ? "" : "s"}.`
          : "No saved audio profiles yet."
      );
    }
    return true;
  }

  function wireAudioProfileControlsUi() {
    if (el.aProfileSelect && el.aProfileName) {
      el.aProfileSelect.onchange = () => {
        const selected = normalizeAudioProfileNameUi(el.aProfileSelect.value || "");
        if (selected) {
          el.aProfileName.value = selected;
          setAudioProfileStatusUi(`Selected profile: ${selected}`);
        }
      };
    }

    if (el.aProfileSaveBtn) {
      el.aProfileSaveBtn.onclick = async () => {
        await runAudioButtonActionWithResult(el.aProfileSaveBtn, "SAVING...", async () => {
          const name = normalizeAudioProfileNameUi(el.aProfileName?.value || el.aProfileSelect?.value || "");
          if (!name) {
            setAudioProfileStatusUi("Profile save failed: name required.");
            return { ok: false, labelFail: "NAME REQUIRED" };
          }
          const r = await saveAudioProfile(name);
          if (!r.ok) {
            setAudioProfileStatusUi(`Profile save failed: ${formatAudioApiErrorWithHint(r, "save failed")}`);
            return { ok: false, labelFail: "SAVE FAIL" };
          }
          if (el.aProfileName) el.aProfileName.value = name;
          await loadAudioProfiles({ selectedName: name, silent: true });
          setAudioProfileStatusUi(`Profile saved: ${name}`);
          announceAudioActionStatus(`AUDIO PROFILE SAVED | ${name}`, 2800);
          return { ok: true, labelOk: "SAVED" };
        });
      };
    }

    if (el.aProfileLoadBtn) {
      el.aProfileLoadBtn.onclick = async () => {
        await runAudioButtonActionWithResult(el.aProfileLoadBtn, "APPLYING...", async () => {
          const name = normalizeAudioProfileNameUi(el.aProfileSelect?.value || el.aProfileName?.value || "");
          if (!name) {
            setAudioProfileStatusUi("Profile apply failed: select a profile first.");
            return { ok: false, labelFail: "SELECT PROFILE" };
          }
          const r = await applyAudioProfile(name);
          if (!r.ok) {
            setAudioProfileStatusUi(`Profile apply failed: ${formatAudioApiErrorWithHint(r, "apply failed")}`);
            return { ok: false, labelFail: "APPLY FAIL" };
          }
          if (r.data?.applyResult?.config) {
            applyAudioConfigToInputs(r.data.applyResult.config);
          }
          await loadAudioProfiles({ selectedName: name, silent: true });
          setAudioProfileStatusUi(`Profile applied: ${name}`);
          announceAudioActionStatus(`AUDIO PROFILE APPLIED | ${name}`, 2800);
          return { ok: true, labelOk: "APPLIED" };
        });
      };
    }

    if (el.aProfileDeleteBtn) {
      el.aProfileDeleteBtn.onclick = async () => {
        const name = normalizeAudioProfileNameUi(el.aProfileSelect?.value || el.aProfileName?.value || "");
        if (!name) {
          setAudioProfileStatusUi("Profile delete failed: select a profile first.");
          return;
        }
        if (!confirmDelete(name)) return;
        await runAudioButtonActionWithResult(el.aProfileDeleteBtn, "DELETING...", async () => {
          const r = await deleteAudioProfile(name);
          if (!r.ok) {
            setAudioProfileStatusUi(`Profile delete failed: ${formatAudioApiErrorWithHint(r, "delete failed")}`);
            return { ok: false, labelFail: "DELETE FAIL" };
          }
          if (el.aProfileName) el.aProfileName.value = "";
          await loadAudioProfiles({ selectedName: "", silent: true });
          setAudioProfileStatusUi(`Profile deleted: ${name}`);
          announceAudioActionStatus(`AUDIO PROFILE DELETED | ${name}`, 2800);
          return { ok: true, labelOk: "DELETED" };
        });
      };
    }
  }

  return {
    setAudioProfileStatusUi,
    renderAudioProfilesUi,
    loadAudioProfiles,
    wireAudioProfileControlsUi
  };
}
