// [TITLE] Module: public/assets/js/domains/mods/mods-hotswap-runtime-ui.js
// [TITLE] Purpose: mods action invoke + hotswap queue/apply/discard runtime behavior
// [TITLE] Functionality Index:
// [TITLE] - invoke arbitrary mod actions via adapter routes
// [TITLE] - queue enable/disable draft config transitions from UI inputs
// [TITLE] - apply/discard queued hotswap draft config and rerender snapshots
// [DEV] Complex Flow:
// [DEV] Hotswap queueing intentionally mirrors runtime-vs-draft comparisons so queued
// [DEV] state badges and APPLY/DISCARD button enablement remain deterministic.
function createModsHotswapRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const setBadge = typeof deps.setBadge === "function" ? deps.setBadge : (() => {});
  const modsEndpointsAdapter = deps.modsEndpointsAdapter && typeof deps.modsEndpointsAdapter === "object"
    ? deps.modsEndpointsAdapter
    : {};
  const loadMods = typeof deps.loadMods === "function" ? deps.loadMods : (async () => false);
  const renderMods = typeof deps.renderMods === "function" ? deps.renderMods : (() => {});
  const cloneModConfig = typeof deps.cloneModConfig === "function"
    ? deps.cloneModConfig
    : (config => ({
      enabled: Array.isArray(config?.enabled) ? config.enabled.slice() : [],
      order: Array.isArray(config?.order) ? config.order.slice() : [],
      disabled: Array.isArray(config?.disabled) ? config.disabled.slice() : []
    }));
  const normalizeModUiId = typeof deps.normalizeModUiId === "function"
    ? deps.normalizeModUiId
    : (value => String(value || "").trim());
  const normalizeModIdList = typeof deps.normalizeModIdList === "function"
    ? deps.normalizeModIdList
    : (value => Array.isArray(value) ? value.map(item => String(item || "").trim()).filter(Boolean) : []);
  const resolveQueuedModEnabled = typeof deps.resolveQueuedModEnabled === "function"
    ? deps.resolveQueuedModEnabled
    : ((_id, runtimeEnabled) => Boolean(runtimeEnabled));

async function runModAction() {
  const modId = String(el.modActionModId.value || "").trim();
  if (!modId) {
    setBadge(el.health, "warn", "MOD ID REQUIRED");
    return;
  }

  const action = String(el.modActionName.value || "").trim();
  const method = String(el.modActionMethod.value || "GET").toUpperCase() === "POST" ? "POST" : "GET";

  try {
    const res = await modsEndpointsAdapter.invokeAction(modId, action, method);
    const pretty = res.json ? JSON.stringify(res.json, null, 2) : (res.text || `(status ${res.status})`);
    el.modActionOutput.value = pretty;

    if (!res.ok) {
      setBadge(el.health, "warn", `MOD ACTION ${res.status}`);
      return;
    }

    setBadge(el.health, "ok", "MOD ACTION OK");
  } catch (err) {
    el.modActionOutput.value = String(err?.message || err || "request failed");
    setBadge(el.health, "bad", "MOD ACTION FAIL");
  }
}

async function queueModStateFromUi(shouldEnable = true) {
  let modId = String(el.modEnableId.value || "").trim();
  if (!modId) {
    modId = normalizeModUiId(ui.modUiSelectedId);
    if (modId && el.modEnableId) {
      el.modEnableId.value = modId;
    }
  }
  if (!modId) {
    setBadge(el.health, "warn", "MOD ID REQUIRED");
    return;
  }

  if (!ui.modsSnapshot?.ok || !Array.isArray(ui.modsSnapshot.mods)) {
    const loaded = await loadMods();
    if (!loaded) {
      setBadge(el.health, "bad", "MOD SNAPSHOT FAIL");
      return;
    }
  }

  const snapshot = ui.modsSnapshot;
  if (!snapshot?.ok || !Array.isArray(snapshot.mods)) {
    setBadge(el.health, "bad", "MOD SNAPSHOT FAIL");
    return;
  }

  let exists = snapshot.mods.some(mod => String(mod?.id || "") === modId);
  if (!exists) {
    const selectedId = normalizeModUiId(ui.modUiSelectedId);
    if (selectedId && selectedId !== modId) {
      const selectedExists = snapshot.mods.some(mod => String(mod?.id || "") === selectedId);
      if (selectedExists) {
        modId = selectedId;
        if (el.modEnableId) el.modEnableId.value = modId;
        exists = true;
      }
    }
  }
  if (!exists) {
    setBadge(el.health, "warn", "MOD ID NOT FOUND");
    return;
  }

  const nextDraft = cloneModConfig(ui.modsDraftDirty ? ui.modsDraftConfig : ui.modsRuntimeConfig);
  const enabledSet = new Set(nextDraft.enabled);
  const disabledSet = new Set(nextDraft.disabled);
  const order = Array.isArray(nextDraft.order) ? [...nextDraft.order] : [];

  if (shouldEnable) {
    enabledSet.add(modId);
    disabledSet.delete(modId);
    if (!order.includes(modId)) order.push(modId);
  } else {
    enabledSet.delete(modId);
    disabledSet.add(modId);
  }

  nextDraft.enabled = Array.from(enabledSet);
  nextDraft.disabled = Array.from(disabledSet);
  nextDraft.order = normalizeModIdList(order);

  const hasChange = Array.isArray(snapshot.mods) && snapshot.mods.some(mod => {
    const runtimeEnabled = Boolean(mod?.enabled);
    const queuedEnabled = resolveQueuedModEnabled(mod?.id, runtimeEnabled, nextDraft);
    return queuedEnabled !== runtimeEnabled;
  });
  ui.modsDraftConfig = nextDraft;
  ui.modsDraftDirty = hasChange;
  renderMods(snapshot);

  if (!hasChange) {
    setBadge(el.health, "warn", "NO MOD HOTSWAP CHANGE");
    return;
  }

  const actionWord = shouldEnable ? "ENABLE" : "DISABLE";
  setBadge(el.health, "warn", `QUEUED ${actionWord} ${modId} (APPLY HOTSWAP)`);
}

async function enableModFromUi() {
  await queueModStateFromUi(true);
}

async function disableModFromUi() {
  await queueModStateFromUi(false);
}

async function applyModHotswapFromUi() {
  if (!ui.modsDraftDirty) {
    setBadge(el.health, "warn", "NO HOTSWAP CHANGES");
    return;
  }

  const draft = cloneModConfig(ui.modsDraftConfig);
  const update = await modsEndpointsAdapter.updateConfig({
    enabled: draft.enabled,
    order: draft.order,
    disabled: draft.disabled,
    reload: true
  });

  if (!update.ok || !update.data?.ok) {
    setBadge(el.health, "bad", "HOTSWAP APPLY FAIL");
    return;
  }

  ui.modsDraftDirty = false;
  ui.modsDraftConfig = cloneModConfig(update.data?.config || draft);

  const nextSnapshot = update.data.snapshot;
  if (nextSnapshot?.ok) {
    renderMods(nextSnapshot);
  } else {
    await loadMods();
  }
  setBadge(el.health, "ok", "HOTSWAP APPLIED");
}

function discardModDraftFromUi() {
  if (!ui.modsDraftDirty) {
    setBadge(el.health, "warn", "NO HOTSWAP CHANGES");
    return;
  }
  ui.modsDraftDirty = false;
  ui.modsDraftConfig = cloneModConfig(ui.modsRuntimeConfig);
  if (ui.modsSnapshot?.ok) {
    renderMods(ui.modsSnapshot);
  }
  setBadge(el.health, "ok", "HOTSWAP CHANGES DISCARDED");
}

  return {
    runModAction,
    queueModStateFromUi,
    enableModFromUi,
    disableModFromUi,
    applyModHotswapFromUi,
    discardModDraftFromUi
  };
}
