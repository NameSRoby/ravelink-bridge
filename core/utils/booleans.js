// [TITLE] Module: core/utils/booleans.js
// [TITLE] Purpose: shared loose boolean parsing

const BOOLEAN_TRUE_TOKENS = new Set(["1", "true", "on", "yes"]);
const BOOLEAN_FALSE_TOKENS = new Set(["0", "false", "off", "no"]);

function parseBooleanToken(value) {
  if (value === true || value === false) return value;
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (BOOLEAN_TRUE_TOKENS.has(raw)) return true;
  if (BOOLEAN_FALSE_TOKENS.has(raw)) return false;
  return null;
}

function parseBooleanLoose(value, fallback = false) {
  const parsed = parseBooleanToken(value);
  return parsed === null ? fallback : parsed;
}

module.exports = {
  BOOLEAN_TRUE_TOKENS,
  BOOLEAN_FALSE_TOKENS,
  parseBooleanToken,
  parseBooleanLoose
};
