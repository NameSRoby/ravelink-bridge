// [TITLE] Module: public/assets/js/domains/system/system-route-console-runtime-ui.js
// [TITLE] Purpose: System tab route catalog and route-console runtime
// [TITLE] Functionality Index:
// [TITLE] - route catalog option rendering and selection
// [TITLE] - route-console request body normalization and execution
// [TITLE] - route-console response rendering and clipboard copy
// [DEV] Complex Flow:
// [DEV] Route-console intentionally uses the System adapter's route bridge so
// [DEV] arbitrary diagnostics requests still respect one typed boundary.

function createSystemRouteConsoleRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const setBadge = typeof deps.setBadge === "function" ? deps.setBadge : (() => {});
  const copyTextToClipboard = typeof deps.copyTextToClipboard === "function"
    ? deps.copyTextToClipboard
    : (async () => false);
  const systemEndpointsAdapter = deps.systemEndpointsAdapter;
  const requiredAdapterMethods = ["getRouteCatalog", "requestRoute"];
  if (!systemEndpointsAdapter || typeof systemEndpointsAdapter !== "object") {
    throw new Error("system route-console runtime requires systemEndpointsAdapter");
  }
  for (const methodName of requiredAdapterMethods) {
    if (typeof systemEndpointsAdapter[methodName] !== "function") {
      throw new Error(`system route-console runtime missing adapter method: ${methodName}`);
    }
  }

  function normalizeRouteConsolePath(value = "") {
    const raw = String(value || "").trim();
    if (!raw) return "/";
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return "/";
    if (raw.startsWith("//")) return "/";
    return raw.startsWith("/") ? raw : `/${raw}`;
  }

  function setSystemRouteConsoleStatus(text = "") {
    if (!el.systemRouteConsoleStatus) return;
    el.systemRouteConsoleStatus.value = String(text || "").trim();
  }

  function renderSystemRouteConsoleOutput(payload = null) {
    if (!el.systemRouteConsoleOutput) return;
    if (payload == null) {
      el.systemRouteConsoleOutput.value = "";
      return;
    }
    try {
      el.systemRouteConsoleOutput.value = JSON.stringify(payload, null, 2);
    } catch {
      el.systemRouteConsoleOutput.value = String(payload || "");
    }
  }

  function renderSystemRouteCatalogOptions() {
    if (!el.systemRouteCatalogSelect) return;
    const currentValue = String(el.systemRouteCatalogSelect.value || "").trim();
    const routes = Array.isArray(ui.systemRouteCatalog) ? ui.systemRouteCatalog : [];
    const nextOptions = [
      `<option value="">${routes.length ? "select route..." : "load route catalog..."}</option>`
    ];
    for (const row of routes) {
      const method = String(row?.method || "").trim().toUpperCase();
      const routePath = String(row?.path || "").trim();
      if (!method || !routePath) continue;
      const source = String(row?.source || "").trim();
      const label = `${method} ${routePath}${source ? `  [${source}]` : ""}`;
      const value = `${method} ${routePath}`;
      nextOptions.push(`<option value="${value.replace(/"/g, "&quot;")}">${label.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</option>`);
    }
    el.systemRouteCatalogSelect.innerHTML = nextOptions.join("");
    if (currentValue && routes.some(row => `${String(row?.method || "").trim().toUpperCase()} ${String(row?.path || "").trim()}` === currentValue)) {
      el.systemRouteCatalogSelect.value = currentValue;
    } else if (currentValue && currentValue.includes(" ")) {
      el.systemRouteCatalogSelect.value = currentValue;
    }
  }

  async function loadSystemRouteCatalog(options = {}) {
    const announce = options.announce === true;
    const response = await systemEndpointsAdapter.getRouteCatalog();
    if (!response || response.ok !== true || !Array.isArray(response.routes)) {
      if (announce) {
        setSystemRouteConsoleStatus("Route catalog unavailable.");
        setBadge(el.health, "warn", "ROUTE CATALOG FAILED");
      }
      return false;
    }
    ui.systemRouteCatalog = response.routes;
    renderSystemRouteCatalogOptions();
    if (announce) {
      setSystemRouteConsoleStatus(`Route catalog loaded (${Number(response.routeCount || response.routes.length || 0)} routes).`);
      setBadge(el.health, "ok", "ROUTE CATALOG LOADED");
    }
    return true;
  }

  function applySystemRouteCatalogSelection() {
    const token = String(el.systemRouteCatalogSelect?.value || "").trim();
    if (!token || !token.includes(" ")) {
      setSystemRouteConsoleStatus("Select a route from catalog first.");
      return false;
    }
    const firstSpace = token.indexOf(" ");
    const method = token.slice(0, firstSpace).trim().toUpperCase() || "GET";
    const routePath = normalizeRouteConsolePath(token.slice(firstSpace + 1).trim());
    if (el.systemRouteConsoleMethod) el.systemRouteConsoleMethod.value = method;
    if (el.systemRouteConsolePath) el.systemRouteConsolePath.value = routePath;
    if ((method === "GET" || method === "DELETE") && el.systemRouteConsoleBody && !String(el.systemRouteConsoleBody.value || "").trim()) {
      el.systemRouteConsoleBody.value = "{}";
    }
    setSystemRouteConsoleStatus(`Selected ${method} ${routePath}`);
    return true;
  }

  function readSystemRouteConsoleBody() {
    const raw = String(el.systemRouteConsoleBody?.value || "").trim();
    if (!raw) return { ok: true, value: null };
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch (error) {
      return {
        ok: false,
        error: String(error?.message || "invalid_json")
      };
    }
  }

  async function runSystemRouteConsoleRequest(options = {}) {
    const announce = options.announce !== false;
    const method = String(el.systemRouteConsoleMethod?.value || "GET").trim().toUpperCase();
    const routePath = normalizeRouteConsolePath(el.systemRouteConsolePath?.value || "/");
    const bodyInfo = readSystemRouteConsoleBody();
    if (!bodyInfo.ok) {
      if (announce) {
        setSystemRouteConsoleStatus(`Invalid JSON body: ${bodyInfo.error}`);
        setBadge(el.health, "warn", "ROUTE CONSOLE INVALID JSON");
      }
      return false;
    }

    const init = {
      method,
      cache: "no-store"
    };
    const sendBody = method !== "GET" && method !== "DELETE";
    if (sendBody) {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(bodyInfo.value || {});
    }

    let response = null;
    let payload = null;
    try {
      const result = await systemEndpointsAdapter.requestRoute(routePath, init);
      response = {
        ok: result?.ok === true,
        status: Number(result?.status || 0)
      };
      payload = result?.data ?? null;
    } catch (error) {
      payload = {
        ok: false,
        error: String(error?.message || "request_failed")
      };
      response = { ok: false, status: 0 };
    }

    const snapshot = {
      ok: response?.ok === true,
      status: Number(response?.status || 0),
      method,
      path: routePath,
      body: sendBody ? (bodyInfo.value || {}) : null,
      response: payload
    };
    ui.systemRouteConsoleLastResponse = snapshot;
    renderSystemRouteConsoleOutput(snapshot);
    if (announce) {
      setSystemRouteConsoleStatus(`${method} ${routePath} -> HTTP ${snapshot.status}`);
      setBadge(el.health, snapshot.ok ? "ok" : "warn", snapshot.ok ? "ROUTE REQUEST OK" : "ROUTE REQUEST FAILED");
    }
    return snapshot.ok === true;
  }

  async function copySystemRouteConsoleResponse() {
    const payload = ui.systemRouteConsoleLastResponse;
    if (!payload) {
      setSystemRouteConsoleStatus("No route response to copy yet.");
      setBadge(el.health, "warn", "NO ROUTE RESPONSE");
      return false;
    }
    let text = "";
    try {
      text = JSON.stringify(payload, null, 2);
    } catch {
      text = String(payload || "");
    }
    const copied = await copyTextToClipboard(text);
    if (!copied) {
      setSystemRouteConsoleStatus("Clipboard copy failed.");
      setBadge(el.health, "warn", "ROUTE COPY FAILED");
      return false;
    }
    setSystemRouteConsoleStatus("Route response copied.");
    setBadge(el.health, "ok", "ROUTE RESPONSE COPIED");
    return true;
  }

  return {
    normalizeRouteConsolePath,
    setSystemRouteConsoleStatus,
    renderSystemRouteConsoleOutput,
    renderSystemRouteCatalogOptions,
    loadSystemRouteCatalog,
    applySystemRouteCatalogSelection,
    readSystemRouteConsoleBody,
    runSystemRouteConsoleRequest,
    copySystemRouteConsoleResponse
  };
}
