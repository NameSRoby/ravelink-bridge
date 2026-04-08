// [TITLE] Module: app/runtime/startup-console.theme.js
// [TITLE] Purpose: shared startup console styling helpers for launcher/runtime logs
// [TITLE] Functionality Index:
// [TITLE] - ANSI-safe badge/line formatter for startup surfaces
// [TITLE] - human-friendly token/value normalization helpers
// [TITLE] - plain-text fallback for terminals without color support

function asString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || String(fallback || "").trim();
}

function clampInt(value, min, max, fallback) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return Math.round(Number(fallback) || 0);
  return Math.min(Math.round(Number(max) || parsed), Math.max(Math.round(Number(min) || parsed), parsed));
}

function createStartupConsoleTheme(options = {}) {
  const source = options && typeof options === "object" && !Array.isArray(options) ? options : {};
  const env = source.env && typeof source.env === "object" ? source.env : process.env;
  const stream = source.stream && typeof source.stream === "object" ? source.stream : process.stdout;
  const useColor = source.useColor === true || (
    source.useColor !== false &&
    !env.NO_COLOR &&
    !env.RAVELINK_NO_COLOR &&
    Boolean(stream?.isTTY)
  );

  const ansi = {
    reset: "\u001b[0m",
    bold: "\u001b[1m",
    dim: "\u001b[2m",
    fg: {
      text: "\u001b[38;5;252m",
      muted: "\u001b[38;5;245m",
      accent: "\u001b[38;5;117m",
      teal: "\u001b[38;5;51m",
      blue: "\u001b[38;5;111m",
      green: "\u001b[38;5;120m",
      amber: "\u001b[38;5;221m",
      rose: "\u001b[38;5;210m",
      white: "\u001b[38;5;255m",
      slate: "\u001b[38;5;244m"
    },
    bg: {
      bridge: "\u001b[48;5;24m",
      system: "\u001b[48;5;25m",
      lighting: "\u001b[48;5;58m",
      twitch: "\u001b[48;5;53m",
      audio: "\u001b[48;5;22m",
      live: "\u001b[48;5;60m",
      mods: "\u001b[48;5;31m",
      engine: "\u001b[48;5;95m",
      update: "\u001b[48;5;94m",
      warn: "\u001b[48;5;130m",
      error: "\u001b[48;5;88m",
      default: "\u001b[48;5;238m"
    }
  };

  function paint(text, ...codes) {
    const value = String(text ?? "");
    if (!useColor || !codes.length) return value;
    return `${codes.join("")}${value}${ansi.reset}`;
  }

  function toneStyle(tone = "text") {
    const token = asString(tone, "text").toLowerCase();
    if (token === "good" || token === "ok" || token === "success") return [ansi.bold, ansi.fg.green];
    if (token === "warn" || token === "warning") return [ansi.bold, ansi.fg.amber];
    if (token === "bad" || token === "error") return [ansi.bold, ansi.fg.rose];
    if (token === "accent" || token === "brand") return [ansi.bold, ansi.fg.teal];
    if (token === "muted" || token === "subtle") return [ansi.fg.muted];
    if (token === "info" || token === "primary") return [ansi.bold, ansi.fg.blue];
    return [ansi.fg.text];
  }

  function badgeStyle(name = "default") {
    const token = asString(name, "default").toLowerCase();
    const bg = ansi.bg[token] || ansi.bg.default;
    return [ansi.bold, bg, ansi.fg.white];
  }

  function badge(label = "", tone = "default") {
    const text = ` ${asString(label, "INFO").toUpperCase()} `;
    return paint(text, ...badgeStyle(tone));
  }

  function muted(text) {
    return paint(String(text ?? ""), ansi.fg.muted);
  }

  function accent(text) {
    return paint(String(text ?? ""), ansi.bold, ansi.fg.teal);
  }

  function value(text, tone = "text") {
    return paint(String(text ?? ""), ...toneStyle(tone));
  }

  function yesNo(flag) {
    return value(flag === true ? "YES" : "NO", flag === true ? "good" : "muted");
  }

  function status(text = "", tone = "info") {
    return value(asString(text, "-").toUpperCase(), tone);
  }

  function label(text = "", width = 0) {
    const sourceText = asString(text, "-");
    const padded = width > 0 ? sourceText.padEnd(width) : sourceText;
    return paint(padded, ansi.fg.slate);
  }

  function field(name, text, tone = "text", width = 0) {
    return `${label(name, width)} ${value(text, tone)}`;
  }

  function separator() {
    return muted(" | ");
  }

  function line(sectionLabel, fields = [], options = {}) {
    const tone = asString(options.tone || sectionLabel || "default", "default").toLowerCase();
    const visibleFields = (Array.isArray(fields) ? fields : []).filter(Boolean);
    return ` ${badge(sectionLabel, tone)} ${visibleFields.join(separator())}`;
  }

  function event(sectionLabel, message = "", tone = "") {
    const nextTextTone = tone === "warn" ? "warn" : tone === "error" ? "bad" : tone || "text";
    return ` ${badge(sectionLabel, sectionLabel)} ${value(message, nextTextTone)}`;
  }

  function divider(char = "=") {
    const repeatChar = asString(char || "=", "=").charAt(0) || "=";
    return paint(repeatChar.repeat(88), ansi.fg.slate);
  }

  function banner(title = "", subtitle = "") {
    const main = accent(asString(title, "RAVELINK BRIDGE"));
    const secondary = subtitle ? ` ${muted("::")} ${value(subtitle, "muted")}` : "";
    return ` ${main}${secondary}`;
  }

  function humanizeToken(text = "", fallback = "-") {
    const raw = asString(text, fallback);
    return raw
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, ch => ch.toUpperCase());
  }

  function humanizeAudioBackendStrategy(text = "") {
    const token = asString(text, "auto_rust_first").toLowerCase();
    if (token === "force_rust") return "Force Rust";
    if (token === "force_node") return "Force Node";
    if (token === "auto_rust_first") return "Auto / Rust first";
    return humanizeToken(token, "Auto");
  }

  function humanizeHueTransport(text = "") {
    const token = asString(text, "auto").toLowerCase();
    if (token === "rest") return "REST";
    if (token === "entertainment") return "Entertainment";
    if (token === "auto") return "Auto";
    return humanizeToken(token, "Auto");
  }

  function humanizeMidiReason(text = "") {
    const token = asString(text, "none").toLowerCase();
    if (token === "none") return "No blocker";
    if (token === "midi_transport_unavailable") return "MIDI transport unavailable";
    return humanizeToken(token, "Unknown");
  }

  function formatLoadedCount(loaded, total) {
    return `${clampInt(loaded, 0, 9999, 0)}/${clampInt(total, 0, 9999, 0)} loaded`;
  }

  return {
    useColor,
    paint,
    badge,
    muted,
    accent,
    value,
    yesNo,
    status,
    label,
    field,
    line,
    event,
    divider,
    banner,
    humanizeToken,
    humanizeAudioBackendStrategy,
    humanizeHueTransport,
    humanizeMidiReason,
    formatLoadedCount
  };
}

module.exports = {
  createStartupConsoleTheme
};
