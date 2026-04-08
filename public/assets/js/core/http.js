// [TITLE] Module: public/assets/js/core/http.js
// [TITLE] Purpose: API base normalization + HTTP helpers
// [TITLE] Functionality Index:
// [TITLE] - API base inference + path join
// [TITLE] - GET/POST/DELETE JSON wrappers
// [TITLE] - API base UI sync + persistence helpers

const inferredApiBase = (() => {
  if (location.protocol === "file:") return "http://127.0.0.1:5050";
  const isHttp = location.protocol === "http:" || location.protocol === "https:";
  if (isHttp) return "";
  return "";
})();

let apiBase = normalizeApiBaseInput(localStorage.getItem("rave_api_base") || inferredApiBase);
function normalizeUiRelativePath(rawPath) {
  const raw = String(rawPath || "").trim();
  if (!raw) return "/";
  if (raw.startsWith("//")) return "/";
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return "/";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

const withBase = path => {
  const safePath = normalizeUiRelativePath(path);
  return apiBase ? `${apiBase}${safePath}` : safePath;
};

async function api(path) {
  try {
    const res = await fetch(withBase(path), { method: "POST" });
    return res.ok;
  } catch (err) {
    console.debug("[HTTP][DEBUG] api POST failed:", err?.message || err);
    return false;
  }
}

async function getJson(path) {
  try {
    const res = await fetch(withBase(path), { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.debug("[HTTP][DEBUG] getJson failed:", err?.message || err);
    return null;
  }
}

async function postJson(path, body) {
  try {
    const res = await fetch(withBase(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    });

    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (err) {
      console.debug("[HTTP][DEBUG] postJson response parse failed:", err?.message || err);
    }

    return { ok: res.ok, status: res.status, data: json };
  } catch (err) {
    console.debug("[HTTP][DEBUG] postJson request failed:", err?.message || err);
    return { ok: false, status: 0, data: null };
  }
}

async function deleteJson(path) {
  try {
    const res = await fetch(withBase(path), { method: "DELETE" });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (err) {
      console.debug("[HTTP][DEBUG] deleteJson response parse failed:", err?.message || err);
    }
    return { ok: res.ok, status: res.status, data: json };
  } catch (err) {
    console.debug("[HTTP][DEBUG] deleteJson request failed:", err?.message || err);
    return { ok: false, status: 0, data: null };
  }
}

function normalizeApiBaseInput(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  let candidate = value;
  // Allow "host:port" shorthand by assuming http.
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)) {
    candidate = `http://${candidate}`;
  }
  let parsed = null;
  try {
    parsed = new URL(candidate);
  } catch {
    return "";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "";
  }
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/+$/, "");
}

function applyApiBaseUi() {
  el.apiBaseInput.value = apiBase || "";
}

function setApiBase(nextBase, options = {}) {
  const normalized = normalizeApiBaseInput(nextBase);
  apiBase = normalized;

  if (options.persist !== false) {
    if (normalized) {
      localStorage.setItem("rave_api_base", normalized);
    } else {
      localStorage.removeItem("rave_api_base");
    }
  }

  applyApiBaseUi();
}
