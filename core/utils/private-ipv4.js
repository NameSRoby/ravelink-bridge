// [TITLE] Module: core/utils/private-ipv4.js
// [TITLE] Purpose: shared private/loopback IPv4 helpers

const net = require("net");
const PRIVATE_OR_LOOPBACK_IPV4_RANGES = Object.freeze([
  Object.freeze({ aMin: 10, aMax: 10, bMin: 0, bMax: 255 }),
  Object.freeze({ aMin: 172, aMax: 172, bMin: 16, bMax: 31 }),
  Object.freeze({ aMin: 192, aMax: 192, bMin: 168, bMax: 168 }),
  Object.freeze({ aMin: 169, aMax: 169, bMin: 254, bMax: 254 }),
  Object.freeze({ aMin: 127, aMax: 127, bMin: 0, bMax: 255 })
]);

function parseIpv4Parts(value) {
  const text = String(value || "").trim();
  if (net.isIP(text) !== 4) return null;
  const parts = text.split(".").map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return parts;
}

function isPrivateOrLoopbackIpv4(value) {
  const parts = parseIpv4Parts(value);
  if (!parts) return false;
  const [a, b] = parts;
  return PRIVATE_OR_LOOPBACK_IPV4_RANGES.some(range =>
    a >= range.aMin &&
    a <= range.aMax &&
    b >= range.bMin &&
    b <= range.bMax
  );
}

function normalizePrivateOrLoopbackIpv4(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return isPrivateOrLoopbackIpv4(text) ? text : "";
}

module.exports = {
  parseIpv4Parts,
  isPrivateOrLoopbackIpv4,
  normalizePrivateOrLoopbackIpv4
};
