// [TITLE] Module: LIVE sync-group controls + fixture engine participation controls
// [TITLE] Purpose: normalize/render/save LIVE sync groups and per-fixture engine controls
// [TITLE] Functionality Index:
// [TITLE] - sync-group CRUD, fixture assignment, engine include/exclude, remove behavior
// [DEV] Complex Flow:
// [DEV] Sync groups now save through the canonical LIVE sync-group route only.
// [DEV] Keep trigger-matrix tuning ownership separate from sync-group save fallback behavior.

const {
  LIVE_SYNC_GROUPS_DEFAULT_UI,
  LIVE_SYNC_REMOVE_BEHAVIOR_DEFAULT_UI,
  LIVE_SYNC_CUSTOM_FALLBACK_DEFAULT_UI,
  LIVE_SYNC_GROUP_MAX_UI,
  LIVE_SYNC_GROUP_NONE_ID_UI,
  clampLiveSyncNumberUi,
  escapeLiveSyncHtmlUi,
  normalizeLiveSyncBoolUi,
  normalizeLiveSyncGroupIdUi,
  normalizeLiveSyncGroupModeUi,
  normalizeLiveSyncGroupNameUi,
  normalizeLiveSyncFixtureIdsUi,
  normalizeLiveSyncRemoveBehaviorUi,
  normalizeLiveSyncHexColorUi,
  normalizeLiveSyncCustomFallbackModeUi,
  normalizeLiveSyncCustomFallbackUi,
  normalizeLiveSyncFixtureEngineMapUi,
  normalizeLiveSyncGroupEntryUi,
  normalizeLiveSyncGroupsUi,
  cloneLiveSyncGroupsUi,
  resolveLiveSyncFixtureCatalogUi,
  buildLiveSyncFixtureAssignmentMapUi,
  buildLiveSyncFixtureEngineControlMapUi,
  resolveLiveSyncSelectedGroupUi,
  createLiveSyncNextGroupIdUi
} = (typeof createLiveSyncGroupsModelUi === "function"
  ? createLiveSyncGroupsModelUi({
    ui,
    clampNumber: typeof clampNumber === "function" ? clampNumber : null,
    escapeHtml: typeof escapeHtmlUi === "function" ? escapeHtmlUi : null
  })
  : (() => {
    throw new Error("live sync groups model module missing");
  })());
const LIVE_SYNC_INTERACTION_GRACE_MS_UI = 420;
let liveSyncFixtureInteractionUntilUi = 0;
let liveSyncFixtureRefreshQueuedUi = false;
function setLiveSyncGroupsStatus(text) {
  if (!el.liveSyncGroupsStatus) return;
  el.liveSyncGroupsStatus.value = String(text || "").trim() || "Sync groups idle.";
}

function markLiveSyncFixtureInteractionUi() {
  liveSyncFixtureInteractionUntilUi = Date.now() + LIVE_SYNC_INTERACTION_GRACE_MS_UI;
}

function isLiveSyncFixtureInteractionActiveUi() {
  if (!el.liveSyncFixtureRows) return false;
  if (Date.now() < Number(liveSyncFixtureInteractionUntilUi || 0)) return true;
  const active = typeof document !== "undefined" ? document.activeElement : null;
  if (!active || typeof el.liveSyncFixtureRows.contains !== "function") return false;
  return el.liveSyncFixtureRows.contains(active);
}

function refreshLiveSyncFixtureRowsWhenIdleUi() {
  if (isLiveSyncFixtureInteractionActiveUi()) {
    if (!liveSyncFixtureRefreshQueuedUi) {
      liveSyncFixtureRefreshQueuedUi = true;
      setTimeout(() => {
        liveSyncFixtureRefreshQueuedUi = false;
        if (isLiveSyncFixtureInteractionActiveUi()) return;
        applyLiveSyncGroupsUi(ui.liveSyncGroups, { sync: false });
      }, LIVE_SYNC_INTERACTION_GRACE_MS_UI + 24);
    }
    return;
  }
  applyLiveSyncGroupsUi(ui.liveSyncGroups, { sync: false });
}

function applyLiveSyncGroupsUi(syncGroups = {}, options = {}) {
  const next = normalizeLiveSyncGroupsUi(syncGroups, ui.liveSyncGroups);
  ui.liveSyncGroups = cloneLiveSyncGroupsUi(next);
  ui.liveSyncGroupsLoaded = true;

  if (el.liveSyncGroupsEnabled) {
    el.liveSyncGroupsEnabled.checked = next.enabled === true;
  }

  const groupOptions = next.groups.map(group => (
    `<option value="${escapeLiveSyncHtmlUi(group.id)}">${escapeLiveSyncHtmlUi(group.name)} (${escapeLiveSyncHtmlUi(group.sequenceMode.toUpperCase())})</option>`
  ));
  if (el.liveSyncGroupSelect) {
    el.liveSyncGroupSelect.innerHTML = [
      `<option value="">select group...</option>`,
      ...groupOptions
    ].join("");
  }

  const selected = resolveLiveSyncSelectedGroupUi(next);
  const selectedId = selected ? selected.id : "";
  ui.liveSyncGroupSelectedId = selectedId;
  if (el.liveSyncGroupSelect) {
    el.liveSyncGroupSelect.value = selectedId || "";
  }
  if (el.liveSyncGroupName) {
    el.liveSyncGroupName.value = selected ? selected.name : "";
    el.liveSyncGroupName.disabled = !selected;
  }
  if (el.liveSyncGroupMode) {
    el.liveSyncGroupMode.value = selected ? selected.sequenceMode : "sync";
    el.liveSyncGroupMode.disabled = !selected;
  }
  if (el.liveSyncGroupOffset) {
    el.liveSyncGroupOffset.value = String(selected ? Number(selected.phaseOffset || 0) : 0);
    el.liveSyncGroupOffset.disabled = !selected || selected.sequenceMode !== "offset";
  }
  if (el.liveSyncGroupDeleteBtn) {
    el.liveSyncGroupDeleteBtn.disabled = !selected;
  }
  if (el.liveSyncGroupAddBtn) {
    el.liveSyncGroupAddBtn.disabled = next.groups.length >= LIVE_SYNC_GROUP_MAX_UI;
  }

  const fixtures = resolveLiveSyncFixtureCatalogUi();
  const assignmentMap = buildLiveSyncFixtureAssignmentMapUi(next);
  const engineControlMap = buildLiveSyncFixtureEngineControlMapUi(next);
  if (el.liveSyncFixtureRows) {
    if (!fixtures.length) {
      el.liveSyncFixtureRows.innerHTML = `<div class="hint">No fixtures loaded yet. Pair fixtures first, then assign them to groups here.</div>`;
    } else {
      const assignOptions = [
        `<option value="${LIVE_SYNC_GROUP_NONE_ID_UI}">GLOBAL SYNC (NONE)</option>`,
        ...next.groups.map(group => `<option value="${escapeLiveSyncHtmlUi(group.id)}">${escapeLiveSyncHtmlUi(group.name)}</option>`)
      ].join("");
      const removeBehaviorOptions = `<option value="keep_current">KEEP CURRENT OUTPUT</option><option value="custom_state">APPLY CUSTOM STATE</option><option value="blackout">BLACKOUT (TURN OFF)</option>`;
      const rows = fixtures.map((fixture, index) => {
        const assigned = assignmentMap.get(fixture.id) || LIVE_SYNC_GROUP_NONE_ID_UI;
        const engineControl = engineControlMap.get(fixture.id) || {
          excluded: false,
          removeBehavior: LIVE_SYNC_REMOVE_BEHAVIOR_DEFAULT_UI,
          customFallback: LIVE_SYNC_CUSTOM_FALLBACK_DEFAULT_UI
        };
        const engineIncluded = engineControl.excluded !== true;
        const engineLabel = engineIncluded ? "ENGINE ON" : "ENGINE OFF";
        const engineState = engineIncluded ? "1" : "0";
        const removeBehaviorValue = normalizeLiveSyncRemoveBehaviorUi(engineControl.removeBehavior, LIVE_SYNC_REMOVE_BEHAVIOR_DEFAULT_UI);
        const customFallbackValue = normalizeLiveSyncCustomFallbackUi(
          engineControl.customFallback,
          LIVE_SYNC_CUSTOM_FALLBACK_DEFAULT_UI
        );
        const customEnabled = removeBehaviorValue === "custom_state";
        const customMode = normalizeLiveSyncCustomFallbackModeUi(customFallbackValue.mode, "hex");
        const customHexDisabled = !customEnabled || customMode !== "hex" ? " disabled" : "";
        const customCctDisabled = !customEnabled || customMode !== "cct" ? " disabled" : "";
        const customBrightDisabled = !customEnabled ? " disabled" : "";
        const customMutedClass = customEnabled ? "" : " muted";
        return (
          `<tr>` +
            `<td>${index + 1}</td>` +
            `<td>${escapeLiveSyncHtmlUi(fixture.id)}</td>` +
            `<td>${escapeLiveSyncHtmlUi(String(fixture.brand || "").toUpperCase())}</td>` +
            `<td>${escapeLiveSyncHtmlUi(fixture.zone || fixture.brand)}</td>` +
            `<td><select data-live-sync-fixture="${escapeLiveSyncHtmlUi(fixture.id)}">` +
              assignOptions.replace(
                `value="${escapeLiveSyncHtmlUi(assigned)}"`,
                `value="${escapeLiveSyncHtmlUi(assigned)}" selected`
              ) +
            `</select></td>` +
            `<td><button type="button" class="routeChipToggle${engineIncluded ? " active" : ""}" data-live-sync-engine-toggle="${escapeLiveSyncHtmlUi(fixture.id)}" data-live-sync-engine-state="${engineState}" aria-pressed="${engineIncluded ? "true" : "false"}">${engineLabel}</button></td>` +
            `<td><select data-live-sync-remove-behavior="${escapeLiveSyncHtmlUi(fixture.id)}">` +
              removeBehaviorOptions.replace(
                `value="${escapeLiveSyncHtmlUi(removeBehaviorValue)}"`,
                `value="${escapeLiveSyncHtmlUi(removeBehaviorValue)}" selected`
              ) +
            `</select>` +
            `<div class="controlRow${customMutedClass}" style="margin-top:8px;">` +
              `<div>` +
                `<label style="font-size:11px;">MODE</label>` +
                `<select data-live-sync-custom-mode="${escapeLiveSyncHtmlUi(fixture.id)}"${customBrightDisabled}>` +
                  `<option value="hex"${customMode === "hex" ? " selected" : ""}>HEX</option>` +
                  `<option value="cct"${customMode === "cct" ? " selected" : ""}>CCT</option>` +
                `</select>` +
              `</div>` +
              `<div>` +
                `<label style="font-size:11px;">HEX</label>` +
                `<input type="text" data-live-sync-custom-hex="${escapeLiveSyncHtmlUi(fixture.id)}" value="${escapeLiveSyncHtmlUi(customFallbackValue.hex)}" maxlength="7" placeholder="#RRGGBB"${customHexDisabled}>` +
              `</div>` +
              `<div>` +
                `<label style="font-size:11px;">CCT</label>` +
                `<input type="number" data-live-sync-custom-cct="${escapeLiveSyncHtmlUi(fixture.id)}" value="${escapeLiveSyncHtmlUi(customFallbackValue.cct)}" min="2000" max="6500" step="50"${customCctDisabled}>` +
              `</div>` +
              `<div>` +
                `<label style="font-size:11px;">BRIGHT %</label>` +
                `<input type="number" data-live-sync-custom-brightness="${escapeLiveSyncHtmlUi(fixture.id)}" value="${escapeLiveSyncHtmlUi(customFallbackValue.brightness)}" min="1" max="100" step="1"${customBrightDisabled}>` +
              `</div>` +
            `</div>` +
            `</td>` +
          `</tr>`
        );
      });
      el.liveSyncFixtureRows.innerHTML = (
        `<table class="fxTable liveSyncTable">` +
          `<thead><tr><th>#</th><th>ID</th><th>BRAND</th><th>ZONE</th><th>SYNC GROUP</th><th>ENGINE</th><th>ON REMOVE</th></tr></thead>` +
          `<tbody>${rows.join("")}</tbody>` +
        `</table>`
      );
    }
  }

  if (options.statusText) {
    setLiveSyncGroupsStatus(options.statusText);
  }
  if (options.sync === true && typeof sync === "function") {
    sync();
  }
}

function updateLiveSyncSelectedGroupUi(mutator) {
  const current = normalizeLiveSyncGroupsUi(ui.liveSyncGroups, LIVE_SYNC_GROUPS_DEFAULT_UI);
  const selected = resolveLiveSyncSelectedGroupUi(current);
  if (!selected) return false;
  const groups = current.groups.map(group => ({ ...group, fixtureIds: normalizeLiveSyncFixtureIdsUi(group.fixtureIds) }));
  const idx = groups.findIndex(group => group.id === selected.id);
  if (idx < 0) return false;
  const nextGroup = mutator({ ...groups[idx], fixtureIds: normalizeLiveSyncFixtureIdsUi(groups[idx].fixtureIds) });
  if (!nextGroup || typeof nextGroup !== "object") return false;
  groups[idx] = normalizeLiveSyncGroupEntryUi(nextGroup, groups[idx], idx);
  applyLiveSyncGroupsUi({
    ...current,
    groups
  }, {
    statusText: "Unsaved sync-group changes.",
    sync: true
  });
  return true;
}

function assignFixtureToLiveSyncGroupUi(fixtureIdRaw, groupIdRaw) {
  const fixtureId = String(fixtureIdRaw || "").trim();
  if (!fixtureId) return false;
  const targetGroupId = normalizeLiveSyncGroupIdUi(groupIdRaw, "");
  const current = normalizeLiveSyncGroupsUi(ui.liveSyncGroups, LIVE_SYNC_GROUPS_DEFAULT_UI);
  const groups = current.groups.map(group => ({
    ...group,
    fixtureIds: normalizeLiveSyncFixtureIdsUi(group.fixtureIds).filter(id => id !== fixtureId)
  }));
  if (targetGroupId) {
    const idx = groups.findIndex(group => group.id === targetGroupId);
    if (idx >= 0) {
      groups[idx].fixtureIds = normalizeLiveSyncFixtureIdsUi([
        ...groups[idx].fixtureIds,
        fixtureId
      ]);
    }
  }
  applyLiveSyncGroupsUi({
    ...current,
    groups
  }, {
    statusText: "Unsaved fixture assignment changes.",
    sync: true
  });
  return true;
}

function updateLiveSyncFixtureEngineControlUi(fixtureIdRaw, patch = {}, statusText = "Unsaved engine control changes.") {
  const fixtureId = String(fixtureIdRaw || "").trim();
  if (!fixtureId) return false;
  const patchMap = patch && typeof patch === "object" ? patch : {};
  const current = normalizeLiveSyncGroupsUi(ui.liveSyncGroups, LIVE_SYNC_GROUPS_DEFAULT_UI);
  const fixtureEngine = normalizeLiveSyncFixtureEngineMapUi(current.fixtureEngine, {});
  const existing = fixtureEngine[fixtureId] && typeof fixtureEngine[fixtureId] === "object"
    ? fixtureEngine[fixtureId]
    : {
      excluded: false,
      removeBehavior: LIVE_SYNC_REMOVE_BEHAVIOR_DEFAULT_UI,
      customFallback: LIVE_SYNC_CUSTOM_FALLBACK_DEFAULT_UI,
      updatedAt: 0
    };
  fixtureEngine[fixtureId] = {
    ...existing,
    excluded: Object.prototype.hasOwnProperty.call(patchMap, "excluded")
      ? normalizeLiveSyncBoolUi(patchMap.excluded, existing.excluded)
      : normalizeLiveSyncBoolUi(existing.excluded, false),
    removeBehavior: Object.prototype.hasOwnProperty.call(patchMap, "removeBehavior")
      ? normalizeLiveSyncRemoveBehaviorUi(patchMap.removeBehavior, existing.removeBehavior || LIVE_SYNC_REMOVE_BEHAVIOR_DEFAULT_UI)
      : normalizeLiveSyncRemoveBehaviorUi(existing.removeBehavior, LIVE_SYNC_REMOVE_BEHAVIOR_DEFAULT_UI),
    customFallback: Object.prototype.hasOwnProperty.call(patchMap, "customFallback")
      ? normalizeLiveSyncCustomFallbackUi(
        patchMap.customFallback,
        normalizeLiveSyncCustomFallbackUi(existing.customFallback, LIVE_SYNC_CUSTOM_FALLBACK_DEFAULT_UI)
      )
      : normalizeLiveSyncCustomFallbackUi(existing.customFallback, LIVE_SYNC_CUSTOM_FALLBACK_DEFAULT_UI)
  };
  applyLiveSyncGroupsUi({
    ...current,
    fixtureEngine
  }, {
    statusText,
    sync: true
  });
  return true;
}

function setLiveSyncFixtureEngineParticipationUi(fixtureIdRaw, excludedRaw) {
  return updateLiveSyncFixtureEngineControlUi(fixtureIdRaw, { excluded: excludedRaw }, "Unsaved engine participation changes.");
}

function setLiveSyncFixtureRemoveBehaviorUi(fixtureIdRaw, removeBehaviorRaw) {
  return updateLiveSyncFixtureEngineControlUi(fixtureIdRaw, { removeBehavior: removeBehaviorRaw }, "Unsaved remove-behavior changes.");
}

function setLiveSyncFixtureCustomFallbackUi(fixtureIdRaw, patch = {}) {
  const fixtureId = String(fixtureIdRaw || "").trim();
  if (!fixtureId) return false;
  const current = normalizeLiveSyncGroupsUi(ui.liveSyncGroups, LIVE_SYNC_GROUPS_DEFAULT_UI);
  const fixtureEngine = normalizeLiveSyncFixtureEngineMapUi(current.fixtureEngine, {});
  const existing = fixtureEngine[fixtureId] && typeof fixtureEngine[fixtureId] === "object"
    ? fixtureEngine[fixtureId]
    : {
      excluded: false,
      removeBehavior: LIVE_SYNC_REMOVE_BEHAVIOR_DEFAULT_UI,
      customFallback: LIVE_SYNC_CUSTOM_FALLBACK_DEFAULT_UI,
      updatedAt: 0
    };
  const existingCustom = normalizeLiveSyncCustomFallbackUi(
    existing.customFallback,
    LIVE_SYNC_CUSTOM_FALLBACK_DEFAULT_UI
  );
  const patchMap = patch && typeof patch === "object" ? patch : {};
  const mergedCustom = normalizeLiveSyncCustomFallbackUi(
    {
      ...existingCustom,
      ...patchMap
    },
    existingCustom
  );
  return updateLiveSyncFixtureEngineControlUi(
    fixtureId,
    {
      customFallback: mergedCustom
    },
    "Unsaved custom remove-state changes."
  );
}

const {
  applyLiveSyncGroupsSnapshot,
  loadLiveSyncGroupsUi,
  saveLiveSyncGroupsUi
} = (typeof createLiveSyncGroupsTransportUi === "function"
  ? createLiveSyncGroupsTransportUi({
    ui,
    el,
    liveEndpointsAdapter,
    setBadge,
    setLiveSyncGroupsStatus,
    applyLiveSyncGroupsUi,
    normalizeLiveSyncGroupsUi
  })
  : (() => {
    throw new Error("live sync groups transport module missing");
  })());

function wireLiveSyncGroupsControlsUi() {
  if (el.liveSyncGroupsEnabled) {
    el.liveSyncGroupsEnabled.onchange = () => {
      const next = normalizeLiveSyncGroupsUi({
        ...(ui.liveSyncGroups || {}),
        enabled: el.liveSyncGroupsEnabled.checked === true
      }, ui.liveSyncGroups);
      applyLiveSyncGroupsUi(next, {
        statusText: "Unsaved sync-group changes.",
        sync: true
      });
    };
  }

  if (el.liveSyncGroupSelect) {
    el.liveSyncGroupSelect.onchange = () => {
      ui.liveSyncGroupSelectedId = normalizeLiveSyncGroupIdUi(el.liveSyncGroupSelect.value || "", "");
      applyLiveSyncGroupsUi(ui.liveSyncGroups, { sync: true });
    };
  }

  if (el.liveSyncGroupAddBtn) {
    el.liveSyncGroupAddBtn.onclick = () => {
      const current = normalizeLiveSyncGroupsUi(ui.liveSyncGroups, LIVE_SYNC_GROUPS_DEFAULT_UI);
      if (current.groups.length >= LIVE_SYNC_GROUP_MAX_UI) {
        setLiveSyncGroupsStatus("Maximum group count reached.");
        return;
      }
      const id = createLiveSyncNextGroupIdUi(current.groups);
      const mode = current.groups.length ? "reverse" : "sync";
      const groups = [
        ...current.groups,
        normalizeLiveSyncGroupEntryUi({
          id,
          name: `GROUP ${current.groups.length + 1}`,
          sequenceMode: mode,
          phaseOffset: 0,
          fixtureIds: []
        }, {}, current.groups.length)
      ];
      ui.liveSyncGroupSelectedId = id;
      applyLiveSyncGroupsUi({
        ...current,
        groups
      }, {
        statusText: "Unsaved sync-group changes.",
        sync: true
      });
    };
  }

  if (el.liveSyncGroupDeleteBtn) {
    el.liveSyncGroupDeleteBtn.onclick = () => {
      const current = normalizeLiveSyncGroupsUi(ui.liveSyncGroups, LIVE_SYNC_GROUPS_DEFAULT_UI);
      const selected = resolveLiveSyncSelectedGroupUi(current);
      if (!selected) return;
      const groups = current.groups.filter(group => group.id !== selected.id);
      ui.liveSyncGroupSelectedId = groups[0]?.id || "";
      applyLiveSyncGroupsUi({
        ...current,
        groups
      }, {
        statusText: "Unsaved sync-group changes.",
        sync: true
      });
    };
  }

  if (el.liveSyncGroupName) {
    el.liveSyncGroupName.oninput = () => {
      updateLiveSyncSelectedGroupUi(group => ({
        ...group,
        name: normalizeLiveSyncGroupNameUi(el.liveSyncGroupName.value, group.name)
      }));
    };
  }

  if (el.liveSyncGroupMode) {
    el.liveSyncGroupMode.onchange = () => {
      updateLiveSyncSelectedGroupUi(group => ({
        ...group,
        sequenceMode: normalizeLiveSyncGroupModeUi(el.liveSyncGroupMode.value, group.sequenceMode)
      }));
    };
  }

  if (el.liveSyncGroupOffset) {
    const applyOffset = () => {
      updateLiveSyncSelectedGroupUi(group => ({
        ...group,
        phaseOffset: clampLiveSyncNumberUi(
          Math.round(Number(el.liveSyncGroupOffset.value)),
          -64,
          64,
          Number(group.phaseOffset || 0)
        )
      }));
    };
    el.liveSyncGroupOffset.oninput = applyOffset;
    el.liveSyncGroupOffset.onchange = applyOffset;
  }

  if (el.liveSyncFixtureRows && !el.liveSyncFixtureRows.dataset.liveSyncBound) {
    el.liveSyncFixtureRows.addEventListener("pointerdown", () => {
      markLiveSyncFixtureInteractionUi();
    }, true);
    el.liveSyncFixtureRows.addEventListener("focusin", () => {
      markLiveSyncFixtureInteractionUi();
    });
    el.liveSyncFixtureRows.addEventListener("mouseover", () => {
      markLiveSyncFixtureInteractionUi();
    });
    el.liveSyncFixtureRows.addEventListener("focusout", () => {
      setTimeout(() => {
        if (isLiveSyncFixtureInteractionActiveUi()) return;
        if (!liveSyncFixtureRefreshQueuedUi) return;
        refreshLiveSyncFixtureRowsWhenIdleUi();
      }, LIVE_SYNC_INTERACTION_GRACE_MS_UI + 24);
    });
    el.liveSyncFixtureRows.addEventListener("click", event => {
      const target = event?.target;
      if (!target || typeof target.closest !== "function") return;
      const engineToggle = target.closest("[data-live-sync-engine-toggle]");
      if (!engineToggle) return;
      markLiveSyncFixtureInteractionUi();
      const fixtureId = String(engineToggle.getAttribute("data-live-sync-engine-toggle") || "").trim();
      const currentState = String(engineToggle.getAttribute("data-live-sync-engine-state") || "1").trim();
      const included = currentState !== "0";
      setLiveSyncFixtureEngineParticipationUi(fixtureId, included === true);
    });
    el.liveSyncFixtureRows.addEventListener("change", event => {
      const target = event?.target;
      if (!target || typeof target.closest !== "function") return;
      markLiveSyncFixtureInteractionUi();
      const groupSelect = target.closest("[data-live-sync-fixture]");
      if (groupSelect) {
        const fixtureId = String(groupSelect.getAttribute("data-live-sync-fixture") || "").trim();
        const value = String(groupSelect.value || "").trim();
        assignFixtureToLiveSyncGroupUi(
          fixtureId,
          value === LIVE_SYNC_GROUP_NONE_ID_UI ? "" : value
        );
        return;
      }
      const removeBehaviorSelect = target.closest("[data-live-sync-remove-behavior]");
      if (removeBehaviorSelect) {
        const fixtureId = String(removeBehaviorSelect.getAttribute("data-live-sync-remove-behavior") || "").trim();
        const value = String(removeBehaviorSelect.value || "").trim();
        setLiveSyncFixtureRemoveBehaviorUi(fixtureId, value);
        return;
      }
      const customModeSelect = target.closest("[data-live-sync-custom-mode]");
      if (customModeSelect) {
        const fixtureId = String(customModeSelect.getAttribute("data-live-sync-custom-mode") || "").trim();
        const value = String(customModeSelect.value || "").trim();
        setLiveSyncFixtureCustomFallbackUi(fixtureId, { mode: value });
        return;
      }
      const customHexInput = target.closest("[data-live-sync-custom-hex]");
      if (customHexInput) {
        const fixtureId = String(customHexInput.getAttribute("data-live-sync-custom-hex") || "").trim();
        const value = String(customHexInput.value || "").trim();
        setLiveSyncFixtureCustomFallbackUi(fixtureId, { hex: value });
        return;
      }
      const customCctInput = target.closest("[data-live-sync-custom-cct]");
      if (customCctInput) {
        const fixtureId = String(customCctInput.getAttribute("data-live-sync-custom-cct") || "").trim();
        const value = Number(customCctInput.value);
        setLiveSyncFixtureCustomFallbackUi(fixtureId, { cct: value });
        return;
      }
      const customBrightnessInput = target.closest("[data-live-sync-custom-brightness]");
      if (customBrightnessInput) {
        const fixtureId = String(customBrightnessInput.getAttribute("data-live-sync-custom-brightness") || "").trim();
        const value = Number(customBrightnessInput.value);
        setLiveSyncFixtureCustomFallbackUi(fixtureId, { brightness: value });
      }
    });
    el.liveSyncFixtureRows.dataset.liveSyncBound = "1";
  }

  if (el.liveSyncGroupsReloadBtn) {
    el.liveSyncGroupsReloadBtn.onclick = () => runLiveButtonAction(
      el.liveSyncGroupsReloadBtn,
      "LOADING...",
      async () => {
        await loadLiveSyncGroupsUi({ silent: false });
      }
    );
  }

  if (el.liveSyncGroupsSaveBtn) {
    el.liveSyncGroupsSaveBtn.onclick = () => runLiveButtonAction(
      el.liveSyncGroupsSaveBtn,
      "SAVING...",
      async () => {
        const ok = await saveLiveSyncGroupsUi({ announce: true });
        if (ok && typeof sync === "function") {
          sync();
        }
      }
    );
  }

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    const refreshRows = () => refreshLiveSyncFixtureRowsWhenIdleUi();
    window.addEventListener("ravelink:live-scope-targets-updated", refreshRows);
  }

  loadLiveSyncGroupsUi({ silent: true }).catch(() => {});

  return {
    loadLiveSyncGroupsUi,
    saveLiveSyncGroupsUi,
    applyLiveSyncGroupsSnapshot,
    normalizeLiveSyncGroupsUi
  };
}
