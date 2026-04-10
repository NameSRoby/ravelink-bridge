// [TITLE] Module: public/assets/js/domains/onboarding-tour-runtime-ui.js
// [TITLE] Purpose: shell-owned onboarding tour runtime with optional mod-contributed steps
// [TITLE] Functionality Index:
// [TITLE] - tab-scoped and full-server tour step orchestration
// [TITLE] - highlighted section/card positioning with resilient fallbacks
// [TITLE] - removable mod step registration via host-dispatched events
// [DEV] Complex Flow: mod steps are treated as ephemeral host contributions, not
// [DEV] server dependencies, so removing or hotloading a mod cannot break onboarding.
function createOnboardingTourRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const documentRef = deps.documentRef || document;
  const windowRef = deps.windowRef || documentRef.defaultView || (typeof window === "object" ? window : null);
  const localStorageRef = deps.localStorageRef || localStorage;
  const showTabRef = typeof deps.showTab === "function" ? deps.showTab : (typeof showTab === "function" ? showTab : null);
  const setBadgeRef = typeof deps.setBadge === "function" ? deps.setBadge : (typeof setBadge === "function" ? setBadge : null);
  const tabTourButtonsRef = Array.isArray(deps.tabTourButtons) && deps.tabTourButtons.length
    ? deps.tabTourButtons
    : (
      documentRef && typeof documentRef.querySelectorAll === "function"
        ? Array.from(documentRef.querySelectorAll("[data-tour-tab]"))
        : []
    );
  const TOUR_ACK_KEY = String(deps.TOUR_ACK_KEY || "ravelink_onboard_ack_v1");

  const state = {
    active: false,
    index: 0,
    steps: [],
    activeTarget: null
  };

  const serverSteps = [
    {
      tab: "live",
      target: "#onBtn",
      title: "LIVE power and safety",
      body: "This is the top-level engine switch. RAVE ON starts the lighting runtime, RAVE OFF returns control cleanly, and PANIC is the immediate kill path for output if something feels wrong."
    },
    {
      tab: "live",
      target: "#liveProfileName",
      title: "Profiles first, tuning second",
      body: "Treat profiles as your safe save point. Store a show-ready baseline here before changing scenes, cadence, palette routing, or scoped fixture overrides."
    },
    {
      tab: "live",
      target: "#liveScopeSection",
      title: "Global vs custom fixture scope",
      body: "Global scope gives you one shared LIVE behavior. Custom scope is where you override per brand or per fixture. Stay global until the main look feels right, then branch into custom targets only when you need exceptions."
    },
    {
      tab: "live",
      target: "#liveSyncGroupsSection",
      title: "Sync groups are for grouping motion, not saving profiles",
      body: "Use sync groups when you want selected fixtures to move together, reverse together, or offset together without rewriting the rest of the LIVE behavior. Think of them as choreography groups layered on top of the global engine."
    },
    {
      tab: "live",
      target: "#liveSceneSection",
      title: "Scene logic is the musical brain",
      body: "AUTO chooses the best scene from the signal. Manual scene buttons pin the emotional behavior. The runtime tuning below this section controls how quickly those choices are allowed to change."
    },
    {
      tab: "live",
      target: "#livePaletteSection",
      title: "Palette routing decides color identity",
      body: "After the scene behavior feels correct, build the color story here. Ordered palettes, vividness, and custom brand or fixture routing all feed into what the engine sends out."
    },
    {
      tab: "fixtures",
      target: "#deviceRouting",
      title: "Fixture routing comes before every other lighting decision",
      body: "This is where you decide which physical lights the server may control. If routing is wrong, every later LIVE or palette change will look wrong too, so this is always the first hardware step."
    },
    {
      tab: "audio",
      target: "#aProfileName",
      title: "Audio profiles are your capture presets",
      body: "Save desktop/app-isolation setups here before you experiment. Different browser players, desktop loopback paths, or app locks can live as separate reusable capture profiles."
    },
    {
      tab: "audio",
      target: "#aApplyBtn",
      title: "Apply plus start is the real commit point",
      body: "This button does more than save fields. It is the moment where the server shapes the effective capture config and starts or restarts the session that feeds telemetry into the engine."
    },
    {
      tab: "mods",
      target: "#modCenter",
      title: "Mods extend the server without becoming boot dependencies",
      body: "This tab is where you load, hot-reload, and open mod UIs. A good mod can dock into onboarding, theme, or widget setup, but removing it should never break the core server."
    },
    {
      tab: "system",
      target: "#systemGatewayStatusRefreshBtn",
      title: "Safe internet is the outbound trust boundary",
      body: "When Twitch integration is enabled, this lane should be the main owner of OAuth and Helix egress. Gateway health, OAuth readiness, and reconcile success all need to agree before reward completion or refund becomes trustworthy."
    },
    {
      tab: "system",
      target: "#systemWidgetBundleMode",
      title: "Widgets can stay separate or dock together",
      body: "Separate server and mod widgets are the safest default. Combined widget mode and mod OAuth docking are optional helpers for compatible mods, not the base architecture."
    },
    {
      tab: "system",
      target: "#systemWidgetDockModOauth",
      title: "Docked mod OAuth is convenience, not ownership transfer",
      body: "This option lets a compatible mod reuse the server setup surface, but System OAuth still remains the primary safe lane. If the mod disappears, the server setup still has to make sense on its own."
    }
  ];

  function toText(value, fallback = "") {
    const text = String(value || "").trim();
    return text || fallback;
  }

  function sanitizeTab(value) {
    const tab = String(value || "").trim().toLowerCase();
    return ["live", "fixtures", "audio", "midi", "mods", "system"].includes(tab) ? tab : "";
  }

  function fallbackSelectorForTab(tab) {
    const safeTab = sanitizeTab(tab);
    return safeTab ? `[data-tab="${safeTab}"]` : "#tabsBar";
  }

  function normalizeTourStep(raw = {}, fallback = {}) {
    const tab = sanitizeTab(raw.tab || fallback.tab);
    const selector = toText(raw.target || raw.selector || fallback.target || fallback.selector, fallbackSelectorForTab(tab));
    return {
      tab,
      target: selector,
      title: toText(raw.title, fallback.title || "RaveLink"),
      body: toText(raw.body || raw.text || raw.description, fallback.body || "This section helps configure RaveLink."),
      source: toText(raw.source || fallback.source, "server")
    };
  }

  function normalizeModSteps(modId = "", steps = []) {
    const safeModId = toText(modId, "mod");
    const source = `mod:${safeModId}`;
    return (Array.isArray(steps) ? steps : [])
      .map(step => normalizeTourStep({
        tab: step?.tab || "mods",
        target: step?.target || step?.hostTarget || "#modUiPanel",
        title: step?.title,
        body: step?.body || step?.text || step?.description,
        source
      }, {
        tab: "mods",
        target: "#modUiPanel",
        title: "Mod setup",
        body: "This loaded mod contributes setup guidance while it is installed.",
        source
      }))
      .filter(step => step.title && step.body);
  }

  function buildMidiTourStep() {
    const midiVisible = Boolean(ui.midiDetected || ui.midiTabForced);
    if (!midiVisible) {
      return normalizeTourStep({
        tab: "",
        target: "#themeCogBtn",
        title: "No MIDI device connected yet",
        body: "The MIDI tab appears automatically when RaveLink detects a controller. If you want to preconfigure it first, open the settings cog and use the MIDI TAB toggle to force the tab on without a device."
      });
    }
    return normalizeTourStep({
      tab: "midi",
      target: "#midiLearnAction",
      title: "MIDI turns controller gestures into LIVE actions",
      body: "Pick the RaveLink behavior you want first, then arm learn and touch the controller. Think in engine actions like drop hit, scene auto, palette order, or overclock toggle, not raw note or CC numbers."
    });
  }

  function registerOnboardingSteps(modId = "", steps = []) {
    const source = toText(modId, "mod");
    ui.onboardingModSteps = ui.onboardingModSteps && typeof ui.onboardingModSteps === "object"
      ? ui.onboardingModSteps
      : {};
    ui.onboardingModSteps[source] = normalizeModSteps(source, steps);
    return ui.onboardingModSteps[source].length;
  }

  function getModSteps() {
    const bag = ui.onboardingModSteps && typeof ui.onboardingModSteps === "object"
      ? ui.onboardingModSteps
      : {};
    return Object.values(bag).flat().filter(Boolean);
  }

  function buildSteps(options = {}) {
    const tab = sanitizeTab(options.tab);
    const allSteps = serverSteps
      .map(step => normalizeTourStep(step))
      .concat(buildMidiTourStep())
      .concat(getModSteps());
    const scoped = tab ? allSteps.filter(step => step.tab === tab) : allSteps;
    return (scoped.length ? scoped : allSteps).filter(step => step.title && step.body);
  }

  function getLayerParts() {
    return {
      layer: el.onboardingTourLayer,
      highlight: el.onboardingTourHighlight,
      card: el.onboardingTourCard,
      kicker: el.onboardingTourKicker,
      title: el.onboardingTourTitle,
      body: el.onboardingTourBody,
      progress: el.onboardingTourProgress,
      prevBtn: el.onboardingTourPrevBtn,
      nextBtn: el.onboardingTourNextBtn,
      skipBtn: el.onboardingTourSkipBtn,
      doneBtn: el.onboardingTourDoneBtn
    };
  }

  function findStepTarget(step = {}) {
    const selector = toText(step.target, fallbackSelectorForTab(step.tab));
    try {
      const node = documentRef.querySelector(selector);
      if (node) return node;
    } catch {}
    try {
      return documentRef.querySelector(fallbackSelectorForTab(step.tab));
    } catch {
      return null;
    }
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function positionTourCard(card, targetRect = null) {
    if (!card || !windowRef) return;
    const viewportWidth = Math.max(320, Number(windowRef.innerWidth || 1024));
    const viewportHeight = Math.max(320, Number(windowRef.innerHeight || 768));
    const cardRect = typeof card.getBoundingClientRect === "function"
      ? card.getBoundingClientRect()
      : { width: 420, height: 220 };
    const width = Math.min(Number(cardRect.width || 420), viewportWidth - 24);
    const height = Math.min(Number(cardRect.height || 220), viewportHeight - 24);
    let left = Math.round((viewportWidth - width) / 2);
    let top = Math.round(viewportHeight - height - 24);

    if (targetRect) {
      const margin = 16;
      const candidates = [
        { left: targetRect.right + margin, top: clamp(targetRect.top, 12, viewportHeight - height - 12) },
        { left: targetRect.left - width - margin, top: clamp(targetRect.top, 12, viewportHeight - height - 12) },
        { left: clamp(targetRect.left, 12, viewportWidth - width - 12), top: targetRect.bottom + margin },
        { left: clamp(targetRect.left, 12, viewportWidth - width - 12), top: targetRect.top - height - margin }
      ];
      const targetBox = {
        left: Number(targetRect.left || 0),
        top: Number(targetRect.top || 0),
        right: Number(targetRect.right || (Number(targetRect.left || 0) + Number(targetRect.width || 0))),
        bottom: Number(targetRect.bottom || (Number(targetRect.top || 0) + Number(targetRect.height || 0)))
      };
      const overlaps = candidate => {
        const candidateBox = {
          left: candidate.left,
          top: candidate.top,
          right: candidate.left + width,
          bottom: candidate.top + height
        };
        return !(
          candidateBox.right <= targetBox.left ||
          candidateBox.left >= targetBox.right ||
          candidateBox.bottom <= targetBox.top ||
          candidateBox.top >= targetBox.bottom
        );
      };
      const valid = candidates.find(candidate => {
        if (
          candidate.left < 12 ||
          candidate.top < 12 ||
          candidate.left + width > viewportWidth - 12 ||
          candidate.top + height > viewportHeight - 12
        ) {
          return false;
        }
        return !overlaps(candidate);
      });
      if (valid) {
        left = valid.left;
        top = valid.top;
      } else {
        const below = targetRect.bottom + margin;
        const above = targetRect.top - height - margin;
        top = below + height < viewportHeight ? below : (above > 12 ? above : top);
        left = clamp(targetRect.left, 12, viewportWidth - width - 12);
      }
    }

    card.style.left = `${left}px`;
    card.style.top = `${clamp(top, 12, viewportHeight - height - 12)}px`;
  }

  function clearActiveTourTarget() {
    if (!state.activeTarget || !state.activeTarget.classList) {
      state.activeTarget = null;
      return false;
    }
    state.activeTarget.classList.remove("onboardingTourTargetActive");
    if (typeof state.activeTarget.removeAttribute === "function") {
      state.activeTarget.removeAttribute("data-tour-active");
    }
    state.activeTarget = null;
    return true;
  }

  function setActiveTourTarget(target) {
    clearActiveTourTarget();
    if (!target || !target.classList) return false;
    target.classList.add("onboardingTourTargetActive");
    if (typeof target.setAttribute === "function") {
      target.setAttribute("data-tour-active", "true");
    }
    state.activeTarget = target;
    return true;
  }

  function renderCurrentStep() {
    const parts = getLayerParts();
    if (!parts.layer || !state.steps.length) return false;
    const step = state.steps[state.index] || state.steps[0];
    if (!step) return false;

    if (step.tab && showTabRef) {
      showTabRef(step.tab);
    }

    const doRender = () => {
      const target = findStepTarget(step);
      setActiveTourTarget(target);
      if (target && typeof target.scrollIntoView === "function") {
        try {
          target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
        } catch {
          target.scrollIntoView();
        }
      }

      const rect = target && typeof target.getBoundingClientRect === "function"
        ? target.getBoundingClientRect()
        : null;
      if (parts.highlight && rect) {
        parts.highlight.style.left = `${Math.max(8, rect.left - 8)}px`;
        parts.highlight.style.top = `${Math.max(8, rect.top - 8)}px`;
        parts.highlight.style.width = `${Math.max(48, rect.width + 16)}px`;
        parts.highlight.style.height = `${Math.max(36, rect.height + 16)}px`;
        parts.highlight.classList.remove("hidden");
      } else if (parts.highlight) {
        parts.highlight.classList.add("hidden");
      }

      if (parts.kicker) parts.kicker.textContent = step.source === "server" ? "RAVELINK TOUR" : "MOD TOUR STEP";
      if (parts.title) parts.title.textContent = step.title;
      if (parts.body) parts.body.textContent = step.body;
      if (parts.progress) parts.progress.textContent = `Step ${state.index + 1} of ${state.steps.length}`;
      if (parts.prevBtn) parts.prevBtn.disabled = state.index <= 0;
      if (parts.nextBtn) parts.nextBtn.classList.toggle("hidden", state.index >= state.steps.length - 1);
      if (parts.doneBtn) parts.doneBtn.classList.toggle("hidden", state.index < state.steps.length - 1);

      parts.layer.classList.remove("hidden");
      parts.layer.classList.add("is-active");
      parts.layer.setAttribute("aria-hidden", "false");
      positionTourCard(parts.card, rect);
      return true;
    };

    if (windowRef && typeof windowRef.setTimeout === "function") {
      windowRef.setTimeout(doRender, 80);
      return true;
    }
    return doRender();
  }

  function completeOnboardingTour(options = {}) {
    const markAck = options.markAck !== false;
    const parts = getLayerParts();
    state.active = false;
    state.index = 0;
    state.steps = [];
    if (parts.layer) {
      parts.layer.classList.add("hidden");
      parts.layer.classList.remove("is-active");
      parts.layer.setAttribute("aria-hidden", "true");
    }
    if (parts.highlight) parts.highlight.classList.add("hidden");
    clearActiveTourTarget();
    if (markAck) {
      try {
        localStorageRef.setItem(TOUR_ACK_KEY, "1");
      } catch {}
      ui.onboardingAcknowledged = true;
      if (el.onboardGate) el.onboardGate.classList.add("hidden");
    }
    return true;
  }

  function startOnboardingTour(options = {}) {
    const steps = buildSteps(options);
    if (!steps.length) return false;
    state.steps = steps;
    state.index = 0;
    state.active = true;
    if (el.onboardGate) el.onboardGate.classList.add("hidden");
    renderCurrentStep();
    if (setBadgeRef) setBadgeRef(el.health, "ok", options.tab ? `${String(options.tab).toUpperCase()} TOUR` : "ONBOARDING TOUR");
    return true;
  }

  function resetOnboardingTour(options = {}) {
    try {
      localStorageRef.removeItem(TOUR_ACK_KEY);
    } catch {}
    ui.onboardingAcknowledged = false;
    return startOnboardingTour(options);
  }

  function goTo(delta) {
    if (!state.active || !state.steps.length) return false;
    state.index = clamp(state.index + delta, 0, state.steps.length - 1);
    return renderCurrentStep();
  }

  function wireOnboardingTourControls() {
    const parts = getLayerParts();
    if (ui.onboardingTourControlsBound === true) return false;
    ui.onboardingTourControlsBound = true;

    if (parts.prevBtn) parts.prevBtn.onclick = () => goTo(-1);
    if (parts.nextBtn) parts.nextBtn.onclick = () => goTo(1);
    if (parts.skipBtn) parts.skipBtn.onclick = () => completeOnboardingTour({ markAck: true });
    if (parts.doneBtn) parts.doneBtn.onclick = () => completeOnboardingTour({ markAck: true });
    if (parts.layer) {
      parts.layer.addEventListener("click", event => {
        if (event.target === parts.layer) completeOnboardingTour({ markAck: true });
      });
    }
    if (windowRef && typeof windowRef.addEventListener === "function") {
      windowRef.addEventListener("keydown", event => {
        if (!state.active) return;
        if (event.key === "Escape") completeOnboardingTour({ markAck: true });
        if (event.key === "ArrowRight") goTo(1);
        if (event.key === "ArrowLeft") goTo(-1);
      });
      windowRef.addEventListener("resize", () => {
        if (state.active) renderCurrentStep();
      });
      windowRef.addEventListener("ravelink:mod-onboarding-steps", event => {
        const detail = event?.detail && typeof event.detail === "object" ? event.detail : {};
        registerOnboardingSteps(detail.modId || detail.id || "mod", detail.steps || []);
      });
    }
    for (const btn of tabTourButtonsRef) {
      if (!btn || typeof btn.addEventListener !== "function") continue;
      btn.addEventListener("click", event => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        const tab = sanitizeTab(btn.dataset?.tourTab);
        startOnboardingTour({ tab });
      });
    }
    return true;
  }

  return {
    serverSteps,
    normalizeTourStep,
    normalizeModSteps,
    registerOnboardingSteps,
    buildSteps,
    startOnboardingTour,
    resetOnboardingTour,
    completeOnboardingTour,
    renderCurrentStep,
    wireOnboardingTourControls
  };
}
