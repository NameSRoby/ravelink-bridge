// [TITLE] Module: public/assets/js/domains/fixtures/fixtures-wiz-onboarding-runtime-ui.js
// [TITLE] Purpose: WiZ onboarding helper runtime with manual-IP-first guidance
// [TITLE] Functionality Index:
// [TITLE] - normalize optional WiZ discovery helper payload rows
// [TITLE] - render discovery list and onboarding status copy
// [TITLE] - wire guide/discover/apply/clear onboarding controls
// [DEV] Complex Flow:
// [DEV] Discovery must remain optional. This runtime never auto-overwrites fixture IP;
// [DEV] operators must explicitly apply a discovered device to keep manual entry primary.

function createFixturesWizOnboardingRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const setBadge = typeof deps.setBadge === "function" ? deps.setBadge : (() => {});
  const fixturesEndpointsAdapter = deps.fixturesEndpointsAdapter;
  if (!fixturesEndpointsAdapter || typeof fixturesEndpointsAdapter !== "object") {
    throw new Error("fixtures wiz onboarding runtime requires fixturesEndpointsAdapter");
  }
  const getEffectiveBrand = typeof deps.getEffectiveBrand === "function"
    ? deps.getEffectiveBrand
    : (() => "hue");
  const getCurrentIp = typeof deps.getCurrentIp === "function"
    ? deps.getCurrentIp
    : (() => "");
  const setCurrentIp = typeof deps.setCurrentIp === "function"
    ? deps.setCurrentIp
    : (() => {});

  function normalizeIpv4Host(value = "") {
    const token = String(value || "").trim();
    if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(token)) return "";
    const parts = token.split(".").map(part => Number(part));
    if (parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return "";
    return token;
  }

  function normalizeDiscoveredWizRows(rows = []) {
    const source = Array.isArray(rows) ? rows : [];
    const byIp = new Map();
    for (const row of source) {
      const ip = normalizeIpv4Host(row?.ip);
      if (!ip) continue;
      byIp.set(ip, {
        ip,
        mac: String(row?.mac || "").trim().toUpperCase(),
        moduleName: String(row?.moduleName || "").trim(),
        roomName: String(row?.roomName || "").trim(),
        roomId: Number.isFinite(Number(row?.roomId)) ? Number(row.roomId) : 0
      });
    }
    return [...byIp.values()].sort((a, b) => String(a.ip || "").localeCompare(String(b.ip || "")));
  }

  function buildWizOptionLabel(row = {}) {
    const ip = String(row?.ip || "").trim();
    const roomName = String(row?.roomName || "").trim();
    const moduleName = String(row?.moduleName || "").trim();
    const roomPart = roomName ? roomName : (moduleName || "WiZ device");
    return `${ip} | ${roomPart}`;
  }

  function setWizOnboardingStatus(text = "") {
    if (!el.fxWizOnboardingStatus) return;
    el.fxWizOnboardingStatus.value = String(text || "").trim();
  }

  function clearDiscoveredWizDevices() {
    if (!el.fxWizDiscoverSelect) return;
    el.fxWizDiscoverSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "No discovery run yet.";
    el.fxWizDiscoverSelect.appendChild(placeholder);
  }

  function renderDiscoveredWizDevices(rows = []) {
    if (!el.fxWizDiscoverSelect) return 0;
    const list = normalizeDiscoveredWizRows(rows);
    el.fxWizDiscoverSelect.innerHTML = "";
    if (!list.length) {
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "No WiZ devices discovered.";
      el.fxWizDiscoverSelect.appendChild(empty);
      return 0;
    }

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select a discovered WiZ device...";
    el.fxWizDiscoverSelect.appendChild(placeholder);
    for (const row of list) {
      const option = document.createElement("option");
      option.value = row.ip;
      option.textContent = buildWizOptionLabel(row);
      el.fxWizDiscoverSelect.appendChild(option);
    }
    return list.length;
  }

  function syncWizOnboardingUi() {
    const effectiveBrand = String(getEffectiveBrand() || "").trim().toLowerCase();
    const wizMode = effectiveBrand === "wiz";
    if (el.fxWizOnboardingWrap) {
      el.fxWizOnboardingWrap.classList.toggle("hidden", !wizMode);
    }
    if (!wizMode) return;

    const currentIp = normalizeIpv4Host(getCurrentIp());
    if (currentIp) {
      setWizOnboardingStatus(`Manual WiZ IP set: ${currentIp}. Save fixture to persist.`);
      return;
    }
    setWizOnboardingStatus("Primary step: enter WiZ IP manually, then SAVE FIXTURE.");
  }

  async function discoverWizDevices() {
    if (typeof fixturesEndpointsAdapter.discoverWizDevices !== "function") {
      setWizOnboardingStatus("WiZ discovery helper unavailable. Use manual IP entry.");
      setBadge(el.health, "warn", "WIZ DISCOVERY HELPER UNAVAILABLE");
      return false;
    }
    setWizOnboardingStatus("Scanning local LAN for WiZ devices (optional helper)...");
    const response = await fixturesEndpointsAdapter.discoverWizDevices();
    if (!response || response.ok !== true) {
      const reason = String(response?.error || "wiz_discovery_failed").trim();
      setWizOnboardingStatus(`WiZ discovery failed (${reason}). Manual IP entry remains primary.`);
      setBadge(el.health, "warn", "WIZ DISCOVERY FAILED");
      return false;
    }

    const count = renderDiscoveredWizDevices(response.devices || []);
    if (count <= 0) {
      setWizOnboardingStatus("No WiZ devices found. Keep using manual IP entry.");
      setBadge(el.health, "warn", "NO WIZ DEVICES FOUND");
      return false;
    }
    setWizOnboardingStatus(`Discovered ${count} WiZ devices. Select one and click USE SELECTED IP.`);
    setBadge(el.health, "ok", `WIZ DISCOVERY FOUND ${count}`);
    return true;
  }

  function applySelectedWizIp() {
    const selected = normalizeIpv4Host(el.fxWizDiscoverSelect?.value || "");
    if (!selected) {
      setWizOnboardingStatus("Select a discovered WiZ device first, or type IP manually.");
      setBadge(el.health, "warn", "SELECT WIZ DEVICE FIRST");
      return false;
    }
    setCurrentIp(selected);
    setWizOnboardingStatus(`Applied discovered WiZ IP ${selected}. Save fixture to persist.`);
    setBadge(el.health, "ok", "WIZ IP APPLIED");
    return true;
  }

  function showManualGuide() {
    setWizOnboardingStatus("Manual-first: 1) Select WiZ brand 2) Enter WiZ IP 3) Save fixture 4) Optional discovery only if you need help.");
    setBadge(el.health, "ok", "WIZ MANUAL IP-FIRST GUIDE");
  }

  function wireWizOnboardingControls() {
    clearDiscoveredWizDevices();
    if (el.fxWizManualGuideBtn) {
      el.fxWizManualGuideBtn.onclick = () => showManualGuide();
    }
    if (el.fxWizDiscoverBtn) {
      el.fxWizDiscoverBtn.onclick = async () => {
        await discoverWizDevices();
      };
    }
    if (el.fxWizUseSelectedBtn) {
      el.fxWizUseSelectedBtn.onclick = () => applySelectedWizIp();
    }
    if (el.fxWizClearDiscoveryBtn) {
      el.fxWizClearDiscoveryBtn.onclick = () => {
        clearDiscoveredWizDevices();
        syncWizOnboardingUi();
      };
    }
    if (el.fxWizIp) {
      el.fxWizIp.addEventListener("input", () => {
        syncWizOnboardingUi();
      });
    }
    syncWizOnboardingUi();
  }

  return {
    syncWizOnboardingUi,
    wireWizOnboardingControls,
    clearDiscoveredWizDevices,
    discoverWizDevices,
    applySelectedWizIp
  };
}
