// [TITLE] Module: public/assets/js/domains/midi/midi-runtime-ui.js
// [TITLE] Purpose: MIDI state/render + control wiring runtime owner
// [TITLE] Functionality Index:
// [TITLE] - MIDI snapshot normalization and UI projection
// [TITLE] - MIDI config/binding patch collection helpers
// [TITLE] - MIDI control event wiring and endpoint actions
// [DEV] Complex Flow:
// [DEV] MIDI runtime keeps action labels, snapshot projection, and control wiring
// [DEV] in one bounded owner so telemetry polling and manual actions stay consistent.

function createMidiRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const documentRef = deps.documentRef || document;
  const localStorageRef = deps.localStorageRef || localStorage;
  const showTab = typeof deps.showTab === "function" ? deps.showTab : (() => {});
  const renderSystemSettingsStatus = typeof deps.renderSystemSettingsStatus === "function"
    ? deps.renderSystemSettingsStatus
    : (() => {});
  const normalizeStartTabPreference = typeof deps.normalizeStartTabPreference === "function"
    ? deps.normalizeStartTabPreference
    : (value => String(value || "").trim().toLowerCase() || "live");
  const setBadge = typeof deps.setBadge === "function" ? deps.setBadge : (() => {});
  const MIDI_TAB_FORCE_KEY = String(deps.MIDI_TAB_FORCE_KEY || "ravelink_midi_tab_forced_v1");
  const UI_START_TAB_KEY = String(deps.UI_START_TAB_KEY || "ravelink_ui_start_tab_v1");
  const midiEndpointsAdapter = deps.midiEndpointsAdapter;
  const requiredAdapterMethods = [
    "getStatus",
    "refreshStatus",
    "saveConfig",
    "armLearn",
    "cancelLearn",
    "triggerAction",
    "saveBinding",
    "clearBinding",
    "resetBindings"
  ];
  if (!midiEndpointsAdapter || typeof midiEndpointsAdapter !== "object") {
    throw new Error("midi runtime requires midiEndpointsAdapter");
  }
  for (const methodName of requiredAdapterMethods) {
    if (typeof midiEndpointsAdapter[methodName] !== "function") {
      throw new Error(`midi runtime missing adapter method: ${methodName}`);
    }
  }

  const MIDI_ACTION_LABELS = Object.freeze({
    drop: "DROP HIT",
    overclock_toggle: "OVERCLOCK TOGGLE",
    overclock_on: "OVERCLOCK ON",
    overclock_off: "OVERCLOCK OFF",
    overclock_up: "OVERCLOCK UP",
    overclock_down: "OVERCLOCK DOWN",
    overclock_auto_toggle: "AUTO HZ TOGGLE",
    overclock_auto_on: "AUTO HZ ON",
    overclock_auto_off: "AUTO HZ OFF",
    behavior_interpret: "MODE BPM/INTERPRET",
    scene_auto: "SCENE AUTO",
    scene_idle: "SCENE STEADY",
    scene_flow: "SCENE MOTION",
    scene_pulse: "SCENE IMPACT",
    scene_steady: "SCENE STEADY",
    scene_motion: "SCENE MOTION",
    scene_impact: "SCENE IMPACT",
    flow_intensity_up: "FLOW INTENSITY +",
    flow_intensity_down: "FLOW INTENSITY -",
    flow_intensity_reset: "FLOW INTENSITY RESET",
    palette_ordered: "PALETTE ORDERED",
    palette_disorder: "PALETTE DISORDER",
    palette_colors_1: "PALETTE 1 COLOR",
    palette_colors_3: "PALETTE 3 COLORS",
    palette_colors_5: "PALETTE 5 COLORS",
    palette_colors_8: "PALETTE 8 COLORS",
    palette_colors_12: "PALETTE 12 COLORS",
    palette_family_red: "PALETTE RED",
    palette_family_yellow: "PALETTE YELLOW",
    palette_family_green: "PALETTE GREEN",
    palette_family_cyan: "PALETTE CYAN",
    palette_family_blue: "PALETTE BLUE",
    palette_family_purple: "PALETTE RED TONE (ALIAS)",
    palette_preset_all_1: "PALETTE PRESET ALL x1",
    palette_preset_all_3: "PALETTE PRESET ALL x3",
    palette_preset_duo_cool: "PALETTE PRESET COOL BRIDGE",
    palette_preset_duo_warm: "PALETTE PRESET WARM BRIDGE"
  });
  const MIDI_FALLBACK_ACTIONS = Object.freeze(Object.keys(MIDI_ACTION_LABELS));
  const MIDI_ACTION_GROUPS = Object.freeze({
    core: Object.freeze([
      "drop",
      "scene_auto",
      "scene_impact",
      "overclock_auto_toggle",
      "overclock_toggle",
      "palette_ordered"
    ]),
    scene: Object.freeze(["behavior_interpret", "scene_auto", "scene_steady", "scene_motion", "scene_impact", "scene_idle", "scene_flow", "scene_pulse"]),
    hz: Object.freeze(MIDI_FALLBACK_ACTIONS.filter(action => action.startsWith("overclock_"))),
    palette: Object.freeze(MIDI_FALLBACK_ACTIONS.filter(action => action.startsWith("palette_"))),
    flow: Object.freeze(MIDI_FALLBACK_ACTIONS.filter(action => action.startsWith("flow_intensity_"))),
    all: Object.freeze([...MIDI_FALLBACK_ACTIONS])
  });

  function normalizeMidiAction(action) {
    return String(action || "").trim().toLowerCase();
  }

  function formatMidiActionLabel(action) {
    const key = normalizeMidiAction(action);
    return MIDI_ACTION_LABELS[key] || key.replace(/_/g, " ").toUpperCase();
  }

  function resolveMidiActionsList(snapshot = null) {
    const raw = Array.isArray(snapshot?.actions) ? snapshot.actions : [];
    const actions = raw
      .map(item => normalizeMidiAction(item))
      .filter(Boolean);
    if (actions.length) return Array.from(new Set(actions));
    return [...MIDI_FALLBACK_ACTIONS];
  }

  function getSelectedMidiActionGroup() {
    const group = String(el.midiActionGroup?.value || "core").trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(MIDI_ACTION_GROUPS, group) ? group : "core";
  }

  function resolveVisibleMidiActions(snapshot = null) {
    const actions = resolveMidiActionsList(snapshot);
    const allowed = MIDI_ACTION_GROUPS[getSelectedMidiActionGroup()] || MIDI_ACTION_GROUPS.core;
    if (getSelectedMidiActionGroup() === "all") return actions;
    const filtered = actions.filter(action => allowed.includes(action));
    return filtered.length ? filtered : actions;
  }

  function parseMidiPortIndex(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return null;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) return null;
    return parsed;
  }

  function formatMidiBinding(binding = null) {
    if (!binding || typeof binding !== "object") return "unbound";
    const type = String(binding.type || "").trim().toLowerCase() || "?";
    const number = Number(binding.number);
    const channel = Number(binding.channel);
    const minValue = Number(binding.minValue);
    const channelLabel = Number.isInteger(channel) && channel >= 0
      ? `ch${channel + 1}`
      : "any";
    const minLabel = Number.isFinite(minValue) ? `min${Math.round(minValue)}` : "min?";
    return `${type.toUpperCase()} #${Number.isFinite(number) ? Math.round(number) : "?"} ${channelLabel} ${minLabel}`;
  }

  function setMidiTabForced(next, options = {}) {
    ui.midiTabForced = Boolean(next);
    if (options.persist !== false) {
      if (ui.midiTabForced) localStorageRef.setItem(MIDI_TAB_FORCE_KEY, "1");
      else localStorageRef.removeItem(MIDI_TAB_FORCE_KEY);
    }
  }

  function applyMidiTabVisibility(options = {}) {
    const preserveTab = options.preserveTab !== false;
    const showMidiTab = Boolean(ui.midiDetected || ui.midiTabForced);

    if (el.midiTabNavItem) {
      el.midiTabNavItem.classList.toggle("hidden", !showMidiTab);
    }
    if (el.midiTabBtn) {
      el.midiTabBtn.classList.toggle("hidden", !showMidiTab);
    }
    if (el.midiTourBtn) {
      el.midiTourBtn.classList.toggle("hidden", !showMidiTab);
    }
    if (el.midiTabPage) {
      el.midiTabPage.classList.toggle("hidden", !showMidiTab);
    }
    if (el.systemStartTab) {
      const midiStartOption = el.systemStartTab.querySelector('option[value="midi"]');
      if (midiStartOption) midiStartOption.disabled = !showMidiTab;
      if (!showMidiTab && normalizeStartTabPreference(ui.startTabPreference) === "midi") {
        ui.startTabPreference = "live";
        localStorageRef.setItem(UI_START_TAB_KEY, ui.startTabPreference);
        if (el.systemStartTab.value === "midi") el.systemStartTab.value = "live";
        renderSystemSettingsStatus();
      }
    }

    if (el.midiTabToggleBtn) {
      const detected = Boolean(ui.midiDetected);
      const forced = Boolean(ui.midiTabForced);
      if (detected) {
        el.midiTabToggleBtn.textContent = "MIDI TAB AUTO (DEVICE DETECTED)";
        el.midiTabToggleBtn.disabled = true;
      } else {
        el.midiTabToggleBtn.disabled = false;
        el.midiTabToggleBtn.textContent = forced ? "MIDI TAB ON (NO DEVICE)" : "MIDI TAB OFF (NO DEVICE)";
      }
    }

    if (el.midiCogStatus) {
      if (ui.midiDetected) {
        el.midiCogStatus.value = "MIDI input detected. MIDI tab is always visible.";
      } else if (ui.midiTabForced) {
        el.midiCogStatus.value = "No MIDI input detected. MIDI tab forced ON from settings.";
      } else {
        el.midiCogStatus.value = "No MIDI input detected. MIDI tab hidden until detected.";
      }
    }

    if (!showMidiTab && ui.activeTab === "midi" && preserveTab) {
      showTab("live");
    }
  }

  function renderMidiActionsOptions(actions = []) {
    const list = Array.isArray(actions) && actions.length ? actions : [...MIDI_FALLBACK_ACTIONS];
    const normalizedList = Array.from(new Set(list.map(item => normalizeMidiAction(item)).filter(Boolean)));
    const targets = [el.midiLearnAction, el.midiBindingAction];

    targets.forEach(select => {
      if (!select) return;
      const current = normalizeMidiAction(select.value);
      select.innerHTML = "";
      normalizedList.forEach(action => {
        const option = documentRef.createElement("option");
        option.value = action;
        option.textContent = formatMidiActionLabel(action);
        select.appendChild(option);
      });
      if (current && normalizedList.includes(current)) select.value = current;
      else if (normalizedList.length) select.value = normalizedList[0];
    });
    renderMidiSelectedActionSummary(ui.midiSnapshot);
  }

  function buildMidiBindingsDump(snapshot = null) {
    if (!snapshot || typeof snapshot !== "object") return "MIDI snapshot unavailable.";
    const config = snapshot.config && typeof snapshot.config === "object" ? snapshot.config : {};
    const bindings = config.bindings && typeof config.bindings === "object" ? config.bindings : {};
    const actions = resolveMidiActionsList(snapshot);

    const lines = [];
    lines.push(`moduleAvailable: ${Boolean(snapshot.moduleAvailable)}`);
    lines.push(`connected: ${Boolean(snapshot.connected)}`);
    lines.push(`portCount: ${Number(snapshot.portCount || 0)}`);
    lines.push(`activePort: ${String(snapshot.activePortName || "none")}`);
    lines.push(`enabled: ${Boolean(config.enabled)}`);
    lines.push(`deviceIndex: ${config.deviceIndex === null || config.deviceIndex === undefined ? "auto" : config.deviceIndex}`);
    lines.push(`deviceMatch: ${String(config.deviceMatch || "") || "<empty>"}`);
    lines.push(`velocityThreshold: ${Number(config.velocityThreshold || 0)}`);
    lines.push("");
    lines.push("bindings:");
    actions.forEach(action => {
      lines.push(`- ${action}: ${formatMidiBinding(bindings[action])}`);
    });
    return lines.join("\n");
  }

  function formatMidiEvent(snapshot = null) {
    const msg = snapshot?.lastMessage;
    if (!msg || typeof msg !== "object") return "none";
    const type = String(msg.type || "?").toUpperCase();
    const channel = Number(msg.channel);
    const number = Number(msg.number);
    const value = Number(msg.value);
    const stamp = msg.at ? new Date(msg.at).toLocaleTimeString() : "";
    const channelLabel = Number.isInteger(channel) && channel >= 0 ? `ch${channel + 1}` : "any";
    return `${type} #${Number.isFinite(number) ? Math.round(number) : "?"} ${channelLabel} v${Number.isFinite(value) ? Math.round(value) : "?"}${stamp ? ` @ ${stamp}` : ""}`;
  }

  function populateMidiPorts(snapshot = null) {
    if (!el.midiPortSelect) return;
    const ports = Array.isArray(snapshot?.ports) ? snapshot.ports : [];
    const config = snapshot?.config && typeof snapshot.config === "object" ? snapshot.config : {};
    const selectedIndex = parseMidiPortIndex(config.deviceIndex);

    el.midiPortSelect.innerHTML = "";
    const autoOption = documentRef.createElement("option");
    autoOption.value = "";
    autoOption.textContent = "AUTO SELECT";
    el.midiPortSelect.appendChild(autoOption);

    ports.forEach(port => {
      const idx = parseMidiPortIndex(port?.index);
      if (idx === null) return;
      const option = documentRef.createElement("option");
      option.value = String(idx);
      option.textContent = `${idx} | ${String(port?.name || `port ${idx}`)}`;
      el.midiPortSelect.appendChild(option);
    });

    el.midiPortSelect.value = selectedIndex === null ? "" : String(selectedIndex);
  }

  function applyMidiBindingEditor(snapshot = null) {
    const config = snapshot?.config && typeof snapshot.config === "object" ? snapshot.config : {};
    const bindings = config.bindings && typeof config.bindings === "object" ? config.bindings : {};
    const action = normalizeMidiAction(el.midiBindingAction?.value || el.midiLearnAction?.value || "");
    const binding = bindings[action];
    const suggestedCc =
      action.includes("overclock") ||
      action.includes("flow_intensity");
    const fallbackType = suggestedCc ? "cc" : "note";
    const fallbackNumber = suggestedCc ? 64 : 36;
    const fallbackMin = suggestedCc ? 64 : 1;

    if (el.midiBindingType) el.midiBindingType.value = String(binding?.type || fallbackType).toLowerCase() === "cc" ? "cc" : "note";
    if (el.midiBindingNumber) el.midiBindingNumber.value = Number.isFinite(Number(binding?.number)) ? String(Number(binding.number)) : String(fallbackNumber);
    if (el.midiBindingChannel) {
      el.midiBindingChannel.value = Number.isInteger(Number(binding?.channel))
        ? String(Number(binding.channel) + 1)
        : "";
    }
    if (el.midiBindingMinValue) {
      const defaultMin = (String(el.midiBindingType?.value || fallbackType).toLowerCase() === "cc") ? 64 : fallbackMin;
      el.midiBindingMinValue.value = Number.isFinite(Number(binding?.minValue))
        ? String(Number(binding.minValue))
        : String(defaultMin);
    }
    renderMidiSelectedActionSummary(snapshot);
  }

  function renderMidiSelectedActionSummary(snapshot = null) {
    if (!el.midiSelectedActionSummary) return;
    const config = snapshot?.config && typeof snapshot.config === "object" ? snapshot.config : {};
    const bindings = config.bindings && typeof config.bindings === "object" ? config.bindings : {};
    const action = normalizeMidiAction(el.midiLearnAction?.value || el.midiBindingAction?.value || "");
    if (!action) {
      el.midiSelectedActionSummary.value = "choose an action";
      return;
    }
    el.midiSelectedActionSummary.value = `${formatMidiActionLabel(action)} | ${formatMidiBinding(bindings[action])}`;
  }

  function applyMidiSnapshot(snapshot = null) {
    if (!snapshot || typeof snapshot !== "object") return;
    ui.midiSnapshot = snapshot;
    ui.midiConfigLoaded = true;

    const hasPorts = Number(snapshot.portCount || 0) > 0;
    ui.midiDetected = Boolean(snapshot.moduleAvailable && (snapshot.connected || hasPorts));

    if (el.midiModuleStatus) {
      el.midiModuleStatus.value = snapshot.moduleAvailable
        ? "module ready"
        : `module unavailable${snapshot.moduleError ? `: ${snapshot.moduleError}` : ""}`;
    }
    if (el.midiRuntimeStatus) {
      el.midiRuntimeStatus.value = snapshot.connected
        ? "listening"
        : (snapshot.config?.enabled === false ? "disabled" : "not connected");
    }
    if (el.midiActivePort) {
      const portLabel = snapshot.connected
        ? `${snapshot.activePortIndex ?? "-"} | ${snapshot.activePortName || "unknown"}`
        : "none";
      el.midiActivePort.value = portLabel;
      if (el.midiActivePortSummary) el.midiActivePortSummary.textContent = snapshot.connected ? (snapshot.activePortName || "UNKNOWN") : "NONE";
    }
    if (el.midiConnectionSummary) {
      if (snapshot.moduleAvailable !== true) {
        el.midiConnectionSummary.textContent = "MODULE MISSING";
      } else if (snapshot.config?.enabled === false) {
        el.midiConnectionSummary.textContent = "DISABLED";
      } else if (snapshot.connected) {
        el.midiConnectionSummary.textContent = "LISTENING";
      } else if (hasPorts) {
        el.midiConnectionSummary.textContent = "PORT FOUND";
      } else {
        el.midiConnectionSummary.textContent = "NO DEVICE";
      }
    }
    if (el.midiPortCount) el.midiPortCount.textContent = String(Number(snapshot.portCount || 0));
    if (el.midiConfiguredBindings) {
      const bindings = snapshot.config?.bindings && typeof snapshot.config.bindings === "object"
        ? snapshot.config.bindings
        : {};
      el.midiConfiguredBindings.textContent = String(Object.keys(bindings).length);
    }
    if (el.midiLearnStatus) {
      const learnTarget = normalizeMidiAction(snapshot.learn?.target);
      if (learnTarget) {
        const expire = Number(snapshot.learn?.expiresAt || 0);
        const ttlSec = expire > Date.now() ? Math.max(1, Math.round((expire - Date.now()) / 1000)) : 0;
        el.midiLearnStatus.value = `learning ${formatMidiActionLabel(learnTarget)} (${ttlSec}s)`;
      } else {
        el.midiLearnStatus.value = "idle";
      }
    }
    if (el.midiLastEvent) {
      el.midiLastEvent.value = formatMidiEvent(snapshot);
    }
    if (el.midiLastAction) {
      el.midiLastAction.value = String(snapshot.lastAction || "none");
    }
    if (el.midiEnabled) {
      el.midiEnabled.value = snapshot.config?.enabled === false ? "false" : "true";
    }
    if (el.midiVelocityThreshold) {
      const threshold = Number(snapshot.config?.velocityThreshold);
      el.midiVelocityThreshold.value = Number.isFinite(threshold)
        ? String(Math.max(0, Math.min(127, Math.round(threshold))))
        : "1";
    }
    if (el.midiDeviceMatch) {
      el.midiDeviceMatch.value = String(snapshot.config?.deviceMatch || "");
    }

    populateMidiPorts(snapshot);
    renderMidiActionsOptions(resolveVisibleMidiActions(snapshot));
    applyMidiBindingEditor(snapshot);
    if (el.midiBindingsDump) {
      el.midiBindingsDump.value = buildMidiBindingsDump(snapshot);
    }
    applyMidiTabVisibility();
  }

  function collectMidiConfigPatch() {
    return {
      enabled: String(el.midiEnabled?.value || "true").toLowerCase() !== "false",
      deviceIndex: parseMidiPortIndex(el.midiPortSelect?.value),
      deviceMatch: String(el.midiDeviceMatch?.value || "").trim(),
      velocityThreshold: Math.max(0, Math.min(127, Number(el.midiVelocityThreshold?.value || 1) || 1))
    };
  }

  function collectMidiBindingPatch() {
    const type = String(el.midiBindingType?.value || "note").trim().toLowerCase() === "cc" ? "cc" : "note";
    const number = Math.max(0, Math.min(127, Math.round(Number(el.midiBindingNumber?.value || 0) || 0)));
    const channelRaw = String(el.midiBindingChannel?.value || "").trim();
    const channel = channelRaw
      ? Math.max(0, Math.min(15, Math.round(Number(channelRaw) || 1) - 1))
      : null;
    const minFallback = type === "cc" ? 64 : 1;
    const minValue = Math.max(0, Math.min(127, Math.round(Number(el.midiBindingMinValue?.value || minFallback) || minFallback)));

    return { type, number, channel, minValue };
  }

  async function loadMidiStatus(options = {}) {
    const refresh = options.refresh === true;
    if (refresh) {
      const response = await midiEndpointsAdapter.refreshStatus();
      if (!response.ok || !response.data) return false;
      applyMidiSnapshot(response.data);
      return true;
    }

    const snapshot = await midiEndpointsAdapter.getStatus();
    if (!snapshot || snapshot.ok === false) return false;
    applyMidiSnapshot(snapshot);
    return true;
  }

  function wireMidiControlsUi() {
    if (el.midiBindingAction) {
      el.midiBindingAction.onchange = () => {
        applyMidiBindingEditor(ui.midiSnapshot);
      };
    }

    if (el.midiActionGroup) {
      el.midiActionGroup.onchange = () => {
        renderMidiActionsOptions(resolveVisibleMidiActions(ui.midiSnapshot));
        applyMidiBindingEditor(ui.midiSnapshot);
      };
    }

    if (el.midiBindingType) {
      el.midiBindingType.onchange = () => {
        const type = String(el.midiBindingType.value || "note").toLowerCase();
        const defaultMin = type === "cc" ? 64 : 1;
        const current = Number(el.midiBindingMinValue?.value);
        if (!Number.isFinite(current) || current < 0 || current > 127) {
          if (el.midiBindingMinValue) el.midiBindingMinValue.value = String(defaultMin);
        }
      };
    }

    if (el.midiLearnAction) {
      el.midiLearnAction.onchange = () => {
        if (el.midiBindingAction) {
          const next = normalizeMidiAction(el.midiLearnAction.value);
          if (next) {
            el.midiBindingAction.value = next;
            applyMidiBindingEditor(ui.midiSnapshot);
          }
        }
        renderMidiSelectedActionSummary(ui.midiSnapshot);
      };
    }

    const quickLearnButtons = documentRef && typeof documentRef.querySelectorAll === "function"
      ? Array.from(documentRef.querySelectorAll("[data-midi-learn-action]"))
      : [];
    quickLearnButtons.forEach(button => {
      button.onclick = async () => {
        const action = normalizeMidiAction(button.getAttribute("data-midi-learn-action"));
        if (!action) return;
        if (el.midiActionGroup) {
          el.midiActionGroup.value = MIDI_ACTION_GROUPS.core.includes(action) ? "core" : "all";
          renderMidiActionsOptions(resolveVisibleMidiActions(ui.midiSnapshot));
        }
        if (el.midiLearnAction) el.midiLearnAction.value = action;
        if (el.midiBindingAction) el.midiBindingAction.value = action;
        applyMidiBindingEditor(ui.midiSnapshot);
        const response = await midiEndpointsAdapter.armLearn(action);
        if (!response.ok || !response.data) {
          setBadge(el.health, "bad", "MIDI LEARN ARM FAIL");
          return;
        }
        applyMidiSnapshot(response.data);
        setBadge(el.health, "ok", `MIDI LEARN ${formatMidiActionLabel(action)}`);
      };
    });

    if (el.midiRefreshBtn) {
      el.midiRefreshBtn.onclick = async () => {
        const ok = await loadMidiStatus({ refresh: true });
        setBadge(el.health, ok ? "ok" : "bad", ok ? "MIDI PORTS REFRESHED" : "MIDI REFRESH FAIL");
      };
    }

    if (el.midiSaveCfgBtn) {
      el.midiSaveCfgBtn.onclick = async () => {
        const patch = collectMidiConfigPatch();
        const response = await midiEndpointsAdapter.saveConfig(patch);
        if (!response.ok || !response.data) {
          setBadge(el.health, "bad", "MIDI CONFIG SAVE FAIL");
          return;
        }
        applyMidiSnapshot(response.data);
        setBadge(el.health, "ok", "MIDI CONFIG SAVED");
      };
    }

    if (el.midiLearnArmBtn) {
      el.midiLearnArmBtn.onclick = async () => {
        const action = normalizeMidiAction(el.midiLearnAction?.value);
        if (!action) {
          setBadge(el.health, "warn", "SELECT MIDI ACTION");
          return;
        }
        const response = await midiEndpointsAdapter.armLearn(action);
        if (!response.ok || !response.data) {
          setBadge(el.health, "bad", "MIDI LEARN ARM FAIL");
          return;
        }
        applyMidiSnapshot(response.data);
        setBadge(el.health, "ok", `MIDI LEARN ${formatMidiActionLabel(action)}`);
      };
    }

    if (el.midiLearnCancelBtn) {
      el.midiLearnCancelBtn.onclick = async () => {
        const response = await midiEndpointsAdapter.cancelLearn();
        if (!response.ok || !response.data) {
          setBadge(el.health, "bad", "MIDI LEARN CANCEL FAIL");
          return;
        }
        applyMidiSnapshot(response.data);
        setBadge(el.health, "ok", "MIDI LEARN CANCELED");
      };
    }

    if (el.midiTriggerBtn) {
      el.midiTriggerBtn.onclick = async () => {
        const action = normalizeMidiAction(el.midiLearnAction?.value);
        if (!action) {
          setBadge(el.health, "warn", "SELECT MIDI ACTION");
          return;
        }
        const response = await midiEndpointsAdapter.triggerAction(action);
        if (!response.ok || !response.data) {
          setBadge(el.health, "bad", "MIDI ACTION TRIGGER FAIL");
          return;
        }
        applyMidiSnapshot(response.data);
        setBadge(el.health, "ok", `MIDI TRIGGERED ${formatMidiActionLabel(action)}`);
      };
    }

    if (el.midiBindingSaveBtn) {
      el.midiBindingSaveBtn.onclick = async () => {
        const action = normalizeMidiAction(el.midiBindingAction?.value);
        if (!action) {
          setBadge(el.health, "warn", "SELECT BINDING ACTION");
          return;
        }
        const patch = collectMidiBindingPatch();
        const response = await midiEndpointsAdapter.saveBinding(action, patch);
        if (!response.ok || !response.data) {
          setBadge(el.health, "bad", "MIDI BINDING SAVE FAIL");
          return;
        }
        applyMidiSnapshot(response.data);
        setBadge(el.health, "ok", `MIDI BINDING SAVED ${formatMidiActionLabel(action)}`);
      };
    }

    if (el.midiBindingClearBtn) {
      el.midiBindingClearBtn.onclick = async () => {
        const action = normalizeMidiAction(el.midiBindingAction?.value);
        if (!action) {
          setBadge(el.health, "warn", "SELECT BINDING ACTION");
          return;
        }
        const response = await midiEndpointsAdapter.clearBinding(action);
        if (!response.ok || !response.data) {
          setBadge(el.health, "bad", "MIDI BINDING CLEAR FAIL");
          return;
        }
        applyMidiSnapshot(response.data);
        setBadge(el.health, "ok", `MIDI BINDING CLEARED ${formatMidiActionLabel(action)}`);
      };
    }

    if (el.midiBindingResetBtn) {
      el.midiBindingResetBtn.onclick = async () => {
        const response = await midiEndpointsAdapter.resetBindings();
        if (!response.ok || !response.data) {
          setBadge(el.health, "bad", "MIDI DEFAULT RESET FAIL");
          return;
        }
        applyMidiSnapshot(response.data);
        setBadge(el.health, "ok", "MIDI DEFAULT BINDINGS RESTORED");
      };
    }
  }

  return {
    normalizeMidiAction,
    formatMidiActionLabel,
    resolveMidiActionsList,
    parseMidiPortIndex,
    formatMidiBinding,
    setMidiTabForced,
    applyMidiTabVisibility,
    renderMidiActionsOptions,
    resolveVisibleMidiActions,
    buildMidiBindingsDump,
    formatMidiEvent,
    populateMidiPorts,
    applyMidiBindingEditor,
    renderMidiSelectedActionSummary,
    applyMidiSnapshot,
    collectMidiConfigPatch,
    collectMidiBindingPatch,
    loadMidiStatus,
    wireMidiControlsUi
  };
}
