// [TITLE] Module: colors/color-engine.js
// [TITLE] Purpose: color-engine

/**
 * ======================================================
 * COLOR ENGINE — FINAL RGB + SAFE MODIFIERS
 * ======================================================
 * - True RGB → XY (Hue-native)
 * - Brightness-only modifiers (safe)
 * - Stateless, absolute commands
 * - No hue/sat modifiers (by design)
 */

const fs = require("fs");
const path = require("path");

const COLORS_FILE = path.join(__dirname, "colors.json");

/* =========================
   BASE COLORS (TRUE RGB)
========================= */
const BASE_COLORS = {
    red:     [255,   0,   0],
    green:   [  0, 255,   0],
    blue:    [  0,   0, 255],
    cyan:    [  0, 255, 255],
    yellow:  [255, 255,   0],
    purple:  [128,   0, 255],
    pink:    [255,   0, 128],
    white:   null
};

/* =========================
   BRIGHTNESS MODIFIERS
========================= */
const BRIGHTNESS = {
    dark:   100,
    dim:    100,
    bright: 254,
    light:  220
};

const DEFAULT_BRI = 180;

/* =========================
   LOAD CUSTOM COLORS
========================= */
let CUSTOM_COLORS = {};
try {
    CUSTOM_COLORS = JSON.parse(fs.readFileSync(COLORS_FILE, "utf8"));
    console.log("[COLOR] loaded", Object.keys(CUSTOM_COLORS).length, "custom colors");
} catch {
    CUSTOM_COLORS = {};
}

/* =========================
   HELPERS
========================= */
function saveColors() {
    fs.writeFileSync(COLORS_FILE, JSON.stringify(CUSTOM_COLORS, null, 2));
}

function normalize(w) {
    return w.toLowerCase().replace(/[^a-z]/g, "");
}

/* =========================
   RGB → XY (Hue-native)
========================= */
function rgbToXy(r, g, b) {
    r /= 255; g /= 255; b /= 255;

    r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
    g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
    b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;

    const X = r * 0.664511 + g * 0.154324 + b * 0.162028;
    const Y = r * 0.283881 + g * 0.668433 + b * 0.047685;
    const Z = r * 0.000088 + g * 0.072310 + b * 0.986039;

    const sum = X + Y + Z;
    if (sum === 0) return [0, 0];

    return [X / sum, Y / sum];
}

/* =========================
   HEX → RGB
========================= */
function hexToRgb(hex) {
    hex = hex.replace("#", "");
    return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16)
    ];
}

/* =========================
   PARSE COLOR (SAFE)
========================= */
function parseColor(input) {
    const raw = input.toLowerCase().trim();
    if (!raw) return null;

    const words = raw.split(/\s+/);

    // ---- brightness modifier (optional) ----
    let bri = DEFAULT_BRI;
    for (const w of words) {
        if (BRIGHTNESS[w] !== undefined) {
            bri = BRIGHTNESS[w];
            break;
        }
    }

    // ---- resolve color word ----
    let rgb = null;

    // hex anywhere
    const hexWord = words.find(w => /^#[0-9a-f]{6}$/i.test(w));
    if (hexWord) {
        rgb = hexToRgb(hexWord);
    }

    // learned colors
    if (!rgb) {
        for (const w of words) {
            const key = normalize(w);
            if (CUSTOM_COLORS[key]) {
                rgb = hexToRgb(CUSTOM_COLORS[key]);
                break;
            }
        }
    }

    // base colors
    if (!rgb) {
        for (const w of words) {
            const key = normalize(w);
            if (key in BASE_COLORS) {
                rgb = BASE_COLORS[key];
                break;
            }
        }
    }

    // ---- WHITE (CT MODE) ----
    if (rgb === null) {
        return {
            on: true,
            ct: 366,
            bri,
            transitiontime: 2
        };
    }

    // ---- COLOR MODE (XY) ----
    const [x, y] = rgbToXy(rgb[0], rgb[1], rgb[2]);

    return {
        on: true,
        xy: [x, y],
        bri,
        transitiontime: 2
    };
}

/* =========================
   TEACH
========================= */
function teach(input) {
    const [name, hex] = input.split(/\s+/);
    if (!name || !/^#[0-9a-f]{6}$/i.test(hex)) return false;

    const key = normalize(name);
    if (BASE_COLORS[key] || CUSTOM_COLORS[key]) return false;

    CUSTOM_COLORS[key] = hex.toLowerCase();
    saveColors();

    console.log("[COLOR] learned:", key, hex);
    return true;
}

module.exports = {
    parseColor,
    teach
};
