/**
 * ======================================================
 * WiZ COLOR STRATEGY — PURE & DETERMINISTIC
 * ======================================================
 * - NO sockets
 * - NO timers
 * - NO randomness
 * - Maps energy → RGB via palettes
 */

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/* =========================
   PALETTES (RGB888)
========================= */

const PALETTES = {
    neon: [
        [255, 0, 80],
        [0, 120, 255],
        [180, 0, 255],
        [0, 255, 200]
    ],

    cyber: [
        [0, 255, 150],
        [0, 180, 255],
        [120, 255, 0],
        [255, 0, 120]
    ],

    warm: [
        [255, 60, 0],
        [255, 120, 20],
        [255, 180, 60],
        [255, 220, 120]
    ],

    cool: [
        [0, 80, 255],
        [0, 160, 255],
        [0, 220, 200],
        [80, 255, 220]
    ]
};

/* =========================
   STATE (LOCAL ONLY)
========================= */

let currentPalette = "neon";
let lastIndex = -1;

/* =========================
   API
========================= */

function setPalette(name) {
    if (PALETTES[name]) {
        currentPalette = name;
        lastIndex = -1;
        console.log("[WIZ][PALETTE]", name);
    }
}

function pickColor(energy = 0) {
    const palette = PALETTES[currentPalette];
    if (!palette) return null;

    const idx = clamp(
        Math.floor(energy * palette.length),
        0,
        palette.length - 1
    );

    // prevent same color spam
    const index = idx === lastIndex
        ? (idx + 1) % palette.length
        : idx;

    lastIndex = index;

    const [r, g, b] = palette[index];

    return { r, g, b };
}

module.exports = {
    pickColor,
    setPalette,
    listPalettes: () => Object.keys(PALETTES),
    getPalette: () => currentPalette
};
