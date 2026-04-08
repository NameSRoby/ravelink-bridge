// [TITLE] Module: public/assets/js/domains/live/live-theme-config-runtime-ui.js
// [TITLE] Purpose: LIVE shell theme config normalization and CSS variable application
// [TITLE] Functionality Index:
// [TITLE] - hex color normalization and rgba conversion
// [TITLE] - theme preset/custom config resolution
// [TITLE] - theme CSS variable application and persistence
// [DEV] Complex Flow:
// [DEV] Theme storage and CSS variable writes stay here so live-theme-shell-ui.js
// [DEV] can focus on shell gates, DEV controls, and OBS dock state.

function createLiveThemeConfigRuntimeUi(deps = {}) {
  const ui = deps.ui || {};
  const documentRef = deps.documentRef || document;
  const localStorageRef = deps.localStorageRef || localStorage;
  const windowRef = deps.windowRef || documentRef.defaultView || (typeof window === "object" ? window : null);
  const THEME_PRESETS = deps.THEME_PRESETS && typeof deps.THEME_PRESETS === "object"
    ? deps.THEME_PRESETS
    : {};
  const DEFAULT_THEME_NAME = String(deps.DEFAULT_THEME_NAME || "midnight");
  const THEME_STORAGE_KEY = String(deps.THEME_STORAGE_KEY || "ravelink_ui_theme_v1");

  function normalizeHexColor(value, fallback = "#8b001f") {
    const raw = String(value || "").trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
    return String(fallback || "#8b001f").toLowerCase();
  }

  function hexToRgba(hex, alpha = 0.67) {
    const safe = normalizeHexColor(hex, "#8b001f");
    const r = parseInt(safe.slice(1, 3), 16);
    const g = parseInt(safe.slice(3, 5), 16);
    const b = parseInt(safe.slice(5, 7), 16);
    const a = Math.max(0, Math.min(1, Number(alpha) || 0));
    return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
  }

  function normalizeThemeGlow(value, fallback = 67) {
    const parsed = Math.round(Number(value));
    if (!Number.isFinite(parsed)) return Math.max(20, Math.min(95, Math.round(Number(fallback) || 67)));
    return Math.max(20, Math.min(95, parsed));
  }

  function getThemePreset(name) {
    const key = String(name || "").trim().toLowerCase();
    if (THEME_PRESETS[key]) return { ...THEME_PRESETS[key] };
    return { ...(THEME_PRESETS[DEFAULT_THEME_NAME] || {}) };
  }

  function normalizeThemeCustomConfig(customConfig = {}, fallbackPreset = {}) {
    const custom = customConfig && typeof customConfig === "object" ? customConfig : {};
    const fallback = fallbackPreset && typeof fallbackPreset === "object"
      ? fallbackPreset
      : getThemePreset(DEFAULT_THEME_NAME);
    return {
      bg: normalizeHexColor(custom.bg, fallback.bg),
      panel: normalizeHexColor(custom.panel, fallback.panel),
      panel2: normalizeHexColor(custom.panel2, fallback.panel2),
      accent: normalizeHexColor(custom.accent, fallback.accent),
      edge: normalizeHexColor(custom.edge, fallback.edge),
      btnBg: normalizeHexColor(custom.btnBg, fallback.btnBg),
      text: normalizeHexColor(custom.text, fallback.text),
      ok: normalizeHexColor(custom.ok, fallback.ok || "#19ff6a"),
      warn: normalizeHexColor(custom.warn, fallback.warn || "#ffb000"),
      bad: normalizeHexColor(custom.bad, fallback.bad || "#ff4444"),
      glow: normalizeThemeGlow(custom.glow, fallback.glow)
    };
  }

  function applyThemeConfig(config = {}, options = {}) {
    const preset = getThemePreset(ui.themeName);
    const next = {
      ...preset,
      ...(config && typeof config === "object" ? config : {})
    };

    next.bg = normalizeHexColor(next.bg, preset.bg);
    next.panel = normalizeHexColor(next.panel, preset.panel);
    next.panel2 = normalizeHexColor(next.panel2, preset.panel2);
    next.accent = normalizeHexColor(next.accent, preset.accent);
    next.edge = normalizeHexColor(next.edge, preset.edge);
    next.btnBg = normalizeHexColor(next.btnBg, preset.btnBg);
    next.text = normalizeHexColor(next.text, preset.text);
    next.ok = normalizeHexColor(next.ok, preset.ok || "#19ff6a");
    next.warn = normalizeHexColor(next.warn, preset.warn || "#ffb000");
    next.bad = normalizeHexColor(next.bad, preset.bad || "#ff4444");
    next.glow = normalizeThemeGlow(next.glow, preset.glow);

    const root = documentRef.documentElement;
    const accentGlow = hexToRgba(next.accent, next.glow / 100);
    root.style.setProperty("--bg", next.bg);
    root.style.setProperty("--panel", next.panel);
    root.style.setProperty("--panel2", next.panel2);
    root.style.setProperty("--accent", next.accent);
    root.style.setProperty("--accentGlow", accentGlow);
    root.style.setProperty("--edge", next.edge);
    root.style.setProperty("--btn-bg", next.btnBg);
    root.style.setProperty("--text", next.text);
    root.style.setProperty("--ok", next.ok);
    root.style.setProperty("--warn", next.warn);
    root.style.setProperty("--bad", next.bad);

    ui.themeConfig = next;

    if (windowRef && typeof windowRef.dispatchEvent === "function") {
      const detail = {
        bg: next.bg,
        panel: next.panel,
        panel2: next.panel2,
        accent: next.accent,
        accentGlow,
        edge: next.edge,
        btnBg: next.btnBg,
        text: next.text,
        ok: next.ok,
        warn: next.warn,
        bad: next.bad,
        glow: next.glow,
        name: String(ui.themeName || DEFAULT_THEME_NAME)
      };
      try {
        if (typeof windowRef.CustomEvent === "function") {
          windowRef.dispatchEvent(new windowRef.CustomEvent("ravelink:themechange", { detail }));
        }
      } catch (err) {
        console.debug("[THEME][DEBUG] failed to dispatch theme bridge event:", err?.message || err);
      }
    }

    if (options.persist !== false) {
      localStorageRef.setItem(
        THEME_STORAGE_KEY,
        JSON.stringify({
          name: ui.themeName,
          custom: normalizeThemeCustomConfig(next, preset)
        })
      );
    }
  }

  return {
    applyThemeConfig,
    getThemePreset,
    hexToRgba,
    normalizeHexColor,
    normalizeThemeGlow,
    normalizeThemeCustomConfig
  };
}
