// [TITLE] Test Module: test/lifecycle-error-classifier.test.js
// [TITLE] Purpose: verify recoverable lifecycle error classification

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isRecoverableLifecycleError,
  isRecoverableHueDtlsHandshakeError
} = require("../src/app/runtime/lifecycle-error-classifier");

test("classifier marks Hue DTLS handshake timeout as recoverable", () => {
  const error = new Error("The DTLS handshake timed out");
  error.stack = [
    "Error: The DTLS handshake timed out",
    "    at Socket.expectHandshake (node_modules/node-dtls-client/build/dtls.js:144:37)",
    "    at Timeout.<anonymous> (node_modules/node-dtls-client/build/dtls.js:102:61)"
  ].join("\n");

  assert.equal(isRecoverableHueDtlsHandshakeError(error), true);
  assert.equal(isRecoverableLifecycleError(error), true);
});

test("classifier keeps unrelated errors as fatal", () => {
  const error = new Error("Cannot read properties of undefined (reading 'foo')");
  error.stack = "Error: Cannot read properties of undefined (reading 'foo')\n    at app.js:10:3";

  assert.equal(isRecoverableHueDtlsHandshakeError(error), false);
  assert.equal(isRecoverableLifecycleError(error), false);
});

test("classifier detects recoverable Hue tokenized timeout forms", () => {
  const error = {
    message: "hue_entertainment_start_timeout while using hue-sync bridge transport"
  };
  assert.equal(isRecoverableLifecycleError(error), true);
});

