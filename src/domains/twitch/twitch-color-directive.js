// [TITLE] Module: domains/twitch/twitch-color-directive.js
// [TITLE] Purpose: parse Twitch color text into Hue/WiZ state directives
// [TITLE] Functionality Index:
// [TITLE] - parse brightness-only and color directives
// [TITLE] - resolve random and learned/fuzzy colors
// [TITLE] - output brand-compatible state payloads

const {
  hsvToRgb255,
  createHueStateFromRgb,
  createHueStateWhite,
  createWizStateFromRgb,
  createWizStateWhite
} = require("../colors/color-space");

const RANDOM_COLOR_TOKENS = new Set(["random", "rand", "rnd"]);
const TWITCH_COLOR_BRIGHTNESS = Object.freeze({
  hueBriBright: 254,
  hueBriDim: 178,
  wizDimmingBright: 100,
  wizDimmingDim: 70
});

module.exports = function createTwitchColorDirectiveService(options = {}) {
  const colorLibrary = options.colorLibrary;
  if (!colorLibrary || typeof colorLibrary.parseColorText !== "function") {
    throw new Error("createTwitchColorDirectiveService requires colorLibrary.parseColorText()");
  }
  const sanitizeText = typeof options.sanitizeText === "function"
    ? options.sanitizeText
    : (value => String(value || "").replace(/\s+/g, " ").trim());

  function parseTwitchColorDirective(rawText) {
    // [DEV] Directive parsing intentionally strips brightness tokens first
    // [DEV] so "dim blue" and "blue dim" behave the same.
    const source = sanitizeText(rawText, "");
    if (!source) return { ok: false, error: "missing color text" };

    const words = source.split(/\s+/).filter(Boolean);
    let brightnessToken = "";
    const colorWords = [];
    for (const word of words) {
      const key = String(word || "").trim().toLowerCase();
      if (key === "bright" || key === "dim") {
        brightnessToken = key;
      } else {
        colorWords.push(word);
      }
    }

    if (!colorWords.length) {
      if (!brightnessToken) return { ok: false, error: "missing color text" };
      const isDim = brightnessToken === "dim";
      return {
        ok: true,
        type: "brightness_only",
        brightness: brightnessToken,
        hueState: {
          on: true,
          bri: isDim ? TWITCH_COLOR_BRIGHTNESS.hueBriDim : TWITCH_COLOR_BRIGHTNESS.hueBriBright,
          transitiontime: 2
        },
        wizState: {
          on: true,
          dimming: isDim ? TWITCH_COLOR_BRIGHTNESS.wizDimmingDim : TWITCH_COLOR_BRIGHTNESS.wizDimmingBright
        }
      };
    }

    const colorText = colorWords.join(" ").trim();
    const normalizedColorText = colorText.toLowerCase();
    if (RANDOM_COLOR_TOKENS.has(normalizedColorText)) {
      const hueDeg = Math.floor(Math.random() * 360);
      const rgb = hsvToRgb255(hueDeg, 1, 1);
      const isDim = brightnessToken === "dim";
      return {
        ok: true,
        type: "random",
        brightness: brightnessToken || "bright",
        colorText: "random",
        hueState: createHueStateFromRgb(rgb, {
          brightness: isDim ? TWITCH_COLOR_BRIGHTNESS.hueBriDim : TWITCH_COLOR_BRIGHTNESS.hueBriBright,
          transitiontime: 2
        }),
        wizState: createWizStateFromRgb(rgb, {
          dimming: isDim ? TWITCH_COLOR_BRIGHTNESS.wizDimmingDim : TWITCH_COLOR_BRIGHTNESS.wizDimmingBright
        })
      };
    }

    const parsed = colorLibrary.parseColorText(colorText, { allowFuzzy: true });
    if (!parsed.ok) {
      return { ok: false, error: parsed.error || "invalid color text" };
    }

    const isDim = brightnessToken === "dim";
    const brightnessHue = isDim
      ? TWITCH_COLOR_BRIGHTNESS.hueBriDim
      : TWITCH_COLOR_BRIGHTNESS.hueBriBright;
    const brightnessWiz = isDim
      ? TWITCH_COLOR_BRIGHTNESS.wizDimmingDim
      : TWITCH_COLOR_BRIGHTNESS.wizDimmingBright;
    const useWhiteMode = parsed.matchedName === "white" && !/^#[0-9a-f]{6}$/i.test(colorText);

    const hueState = useWhiteMode
      ? createHueStateWhite({ brightness: brightnessHue, transitiontime: 2 })
      : createHueStateFromRgb(parsed.rgb, { brightness: brightnessHue, transitiontime: 2 });
    const wizState = useWhiteMode
      ? createWizStateWhite({ dimming: brightnessWiz })
      : createWizStateFromRgb(parsed.rgb, { dimming: brightnessWiz });

    return {
      ok: true,
      type: "color",
      brightness: brightnessToken || "",
      colorText,
      matchedName: parsed.matchedName || "",
      source: parsed.source || "",
      fuzzy: parsed.fuzzy || null,
      hueState,
      wizState
    };
  }

  function normalizeTwitchRaveOffDirective(directive) {
    // [DEV] Random directives are normalized to bright for rave-off so
    // [DEV] shutdown scene transitions remain visible and intentional.
    const source = directive && typeof directive === "object" ? directive : null;
    if (!source || source.ok !== true) return source;
    if (source.type !== "random") return source;

    return {
      ...source,
      brightness: "bright",
      hueState: {
        ...(source.hueState || {}),
        on: true,
        bri: TWITCH_COLOR_BRIGHTNESS.hueBriBright,
        transitiontime: 2
      },
      wizState: {
        ...(source.wizState || {}),
        on: true,
        dimming: TWITCH_COLOR_BRIGHTNESS.wizDimmingBright
      }
    };
  }

  return {
    TWITCH_COLOR_BRIGHTNESS,
    parseTwitchColorDirective,
    normalizeTwitchRaveOffDirective
  };
};
