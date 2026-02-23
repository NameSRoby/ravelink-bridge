const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PALETTE_COLOR_COUNT_OPTIONS,
  PALETTE_FAMILY_ORDER,
  PALETTE_FAMILY_DEFS,
  resolvePaletteFamilyIndexSpan
} = require("../core/palette/family-spec");

function clamp255(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, Math.round(n)));
}

function rgbToHue(color = {}) {
  const r = clamp255(color.r) / 255;
  const g = clamp255(color.g) / 255;
  const b = clamp255(color.b) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (!(delta > 0)) return 0;

  let hue;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = ((b - r) / delta) + 2;
  else hue = ((r - g) / delta) + 4;
  hue *= 60;
  return hue < 0 ? hue + 360 : hue;
}

function hueDistanceCircularDeg(a, b) {
  const aa = ((Number(a) || 0) % 360 + 360) % 360;
  const bb = ((Number(b) || 0) % 360 + 360) % 360;
  const delta = Math.abs(aa - bb);
  return delta > 180 ? 360 - delta : delta;
}

function selectedFamilyHues(familyId, count) {
  const family = PALETTE_FAMILY_DEFS[familyId];
  assert.ok(family && Array.isArray(family.colors), `missing family definition for ${familyId}`);
  const span = resolvePaletteFamilyIndexSpan(familyId, count);
  return span
    .map(index => family.colors[index])
    .filter(Boolean)
    .map(rgbToHue);
}

function minCrossFamilyHueDistance(familyA, familyB, count) {
  const huesA = selectedFamilyHues(familyA, count);
  const huesB = selectedFamilyHues(familyB, count);
  let best = Number.POSITIVE_INFINITY;
  for (const a of huesA) {
    for (const b of huesB) {
      best = Math.min(best, hueDistanceCircularDeg(a, b));
    }
  }
  return best;
}

function minIntraFamilyHueDistance(familyId, count) {
  const hues = selectedFamilyHues(familyId, count);
  if (hues.length <= 1) return 180;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < hues.length; i += 1) {
    for (let j = i + 1; j < hues.length; j += 1) {
      best = Math.min(best, hueDistanceCircularDeg(hues[i], hues[j]));
    }
  }
  return best;
}

test("palette family spans return valid per-count index selections", () => {
  assert.deepEqual(PALETTE_COLOR_COUNT_OPTIONS, [1, 3, 5, 8, 12]);
  for (const familyId of PALETTE_FAMILY_ORDER) {
    const family = PALETTE_FAMILY_DEFS[familyId];
    assert.ok(family && Array.isArray(family.colors), `family ${familyId} is missing colors`);
    for (const count of PALETTE_COLOR_COUNT_OPTIONS) {
      const span = resolvePaletteFamilyIndexSpan(familyId, count);
      assert.equal(span.length, count, `${familyId} span length must match count ${count}`);
      const unique = new Set(span);
      assert.equal(unique.size, span.length, `${familyId} span must have unique indices for count ${count}`);
      for (const index of span) {
        assert.ok(Number.isInteger(index), `${familyId} span index must be integer (${count})`);
        assert.ok(index >= 0 && index < family.colors.length, `${familyId} span index out of range (${count})`);
      }
    }
  }
});

test("adjacent families stay distinct for low/medium density counts", () => {
  const adjacentPairs = [
    ["red", "yellow"],
    ["yellow", "green"],
    ["green", "cyan"],
    ["cyan", "blue"]
  ];
  for (const count of [1, 3, 5, 8]) {
    for (const [left, right] of adjacentPairs) {
      const minDistance = minCrossFamilyHueDistance(left, right, count);
      assert.ok(
        minDistance >= 20,
        `${left}/${right} collapsed too early at count ${count} (min hue distance ${minDistance.toFixed(2)} deg)`
      );
    }
  }
});

test("controlled edge merge appears only at 12-count density", () => {
  const greenCyan = minCrossFamilyHueDistance("green", "cyan", 12);
  const cyanBlue = minCrossFamilyHueDistance("cyan", "blue", 12);
  assert.ok(greenCyan <= 8, `green/cyan should approach overlap at 12 (got ${greenCyan.toFixed(2)} deg)`);
  assert.ok(cyanBlue <= 8, `cyan/blue should approach overlap at 12 (got ${cyanBlue.toFixed(2)} deg)`);
});

test("3-color mode keeps visible intra-family hue separation", () => {
  for (const familyId of PALETTE_FAMILY_ORDER) {
    const minDistance = minIntraFamilyHueDistance(familyId, 3);
    assert.ok(
      minDistance >= 17,
      `${familyId} 3-color span is too compressed (min intra hue distance ${minDistance.toFixed(2)} deg)`
    );
  }
});
