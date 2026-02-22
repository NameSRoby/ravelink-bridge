const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseIpv4Parts,
  isPrivateOrLoopbackIpv4,
  normalizePrivateOrLoopbackIpv4
} = require("../core/utils/private-ipv4");
const {
  redactSensitiveLogValue,
  sanitizeLogValue
} = require("../core/utils/log-redaction");
const {
  parseBooleanToken,
  parseBooleanLoose
} = require("../core/utils/booleans");
const {
  hsvToRgbUnit,
  hsvToRgb255
} = require("../core/utils/hsv-rgb");

test("private-ipv4 utils classify and normalize private IPv4 correctly", () => {
  assert.deepEqual(parseIpv4Parts("192.168.1.42"), [192, 168, 1, 42]);
  assert.equal(parseIpv4Parts("999.1.1.1"), null);
  assert.equal(isPrivateOrLoopbackIpv4("10.0.0.4"), true);
  assert.equal(isPrivateOrLoopbackIpv4("8.8.8.8"), false);
  assert.equal(normalizePrivateOrLoopbackIpv4("127.0.0.1"), "127.0.0.1");
  assert.equal(normalizePrivateOrLoopbackIpv4("8.8.8.8"), "");
});

test("log-redaction utils redact sensitive content and object keys", () => {
  const redacted = redactSensitiveLogValue("token=abc1234567890123456789");
  assert.match(redacted, /token=\[redacted\]/i);

  const short = redactSensitiveLogValue("authorization=bearer secretvalue", {
    maxLength: 12,
    fallback: "unknown"
  });
  assert.equal(short.endsWith("..."), true);

  const sanitized = sanitizeLogValue({
    username: "my-user",
    nested: {
      token: "secret-token",
      safe: "ok"
    }
  });
  assert.equal(sanitized.username, "[redacted]");
  assert.equal(sanitized.nested.token, "[redacted]");
  assert.equal(sanitized.nested.safe, "ok");
});

test("boolean utils parse loose tokens consistently", () => {
  assert.equal(parseBooleanToken(true), true);
  assert.equal(parseBooleanToken("YES"), true);
  assert.equal(parseBooleanToken("off"), false);
  assert.equal(parseBooleanToken(""), null);
  assert.equal(parseBooleanToken("maybe"), null);
  assert.equal(parseBooleanLoose("maybe", true), true);
  assert.equal(parseBooleanLoose("0", true), false);
});

test("hsv-rgb utils convert and clamp predictably", () => {
  assert.deepEqual(hsvToRgb255(0, 1, 1), { r: 255, g: 0, b: 0 });
  assert.deepEqual(hsvToRgb255(120, 1, 1), { r: 0, g: 255, b: 0 });
  assert.deepEqual(hsvToRgb255(240, 1, 1), { r: 0, g: 0, b: 255 });
  assert.deepEqual(hsvToRgb255(-120, 1, 1), { r: 0, g: 0, b: 255 });
  assert.deepEqual(hsvToRgb255("bad", "bad", "bad"), { r: 0, g: 0, b: 0 });
  assert.deepEqual(
    hsvToRgb255("bad", "bad", "bad", { sFallback: 1, vFallback: 1 }),
    { r: 255, g: 0, b: 0 }
  );

  const yellow = hsvToRgbUnit(60, 1, 1);
  assert.equal(yellow.r, 1);
  assert.equal(yellow.g, 1);
  assert.equal(yellow.b, 0);
});
