// [TITLE] Module: public/assets/js/domains/contracts/audio-ui-input.adapter.js
// [TITLE] Purpose: typed audio UI input adapter for shared text/token normalization
// [TITLE] Functionality Index:
// [TITLE] - normalize device list text payloads
// [TITLE] - normalize app/process display tokens
// [TITLE] - normalize profile naming tokens

function createAudioUiInputAdapter() {
  function normalizeAudioDeviceListUi(value, fallback = []) {
    const source = Array.isArray(value)
      ? value
      : String(value || "")
        .split(/[\r\n,;]+/g)
        .map(item => String(item || "").trim());
    const out = [];
    for (const item of source) {
      const text = String(item || "").trim();
      if (!text) continue;
      if (out.includes(text)) continue;
      out.push(text);
      if (out.length >= 6) break;
    }
    if (out.length) return out;
    const fallbackList = Array.isArray(fallback) ? fallback : [];
    if (!fallbackList.length) return [];
    return normalizeAudioDeviceListUi(fallbackList, []);
  }

  function formatAudioDeviceListUi(list = []) {
    return normalizeAudioDeviceListUi(list, []).join("\n");
  }

  function normalizeAudioAppNameUi(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const cleaned = raw
      .replace(/\s+\(\d+\)\s*$/g, "")
      .replace(/\s+\[pid\s+\d+\]\s*$/gi, "")
      .trim();
    return cleaned.slice(0, 128);
  }

  function canonicalizeKnownBrowserTokenUi(token = "") {
    const raw = String(token || "").trim().toLowerCase();
    if (!raw) return "";
    const compact = raw.replace(/[^a-z0-9]+/g, "");
    if (!compact) return "";
    if (
      compact === "firefox"
      || compact === "mozillafirefox"
      || compact === "nightly"
      || compact === "developer"
      || compact === "developeredition"
      || compact === "devedition"
      || compact === "firefoxnightly"
      || compact === "firefoxdeveloperedition"
      || compact === "firefoxdeveloper"
      || compact === "firefoxdevedition"
    ) {
      return "firefox";
    }
    return raw;
  }

  function normalizeAudioOutputEndpointNameUi(value) {
    const raw = String(value || "").replace(/\s+/g, " ").trim();
    if (!raw) return "";
    return raw.slice(0, 256);
  }

  function normalizeAudioAppTokenUi(value) {
    const appName = normalizeAudioAppNameUi(value).toLowerCase();
    if (!appName) return "";
    const token = appName.endsWith(".exe") ? appName.slice(0, -4) : appName;
    return canonicalizeKnownBrowserTokenUi(token);
  }

  function normalizeAudioProfileNameUi(value) {
    const raw = String(value || "").trim().replace(/\s+/g, " ");
    if (!raw) return "";
    const cleaned = raw.replace(/[^a-z0-9 _.-]+/gi, "").trim();
    if (!cleaned) return "";
    return cleaned.slice(0, 40);
  }

  return Object.freeze({
    normalizeAudioDeviceListUi,
    formatAudioDeviceListUi,
    normalizeAudioAppNameUi,
    normalizeAudioOutputEndpointNameUi,
    normalizeAudioAppTokenUi,
    normalizeAudioProfileNameUi
  });
}

if (typeof module !== "undefined" && module.exports) {
  const audioUiInputAdapter = createAudioUiInputAdapter();
  module.exports = {
    createAudioUiInputAdapter,
    audioUiInputAdapter
  };
}
