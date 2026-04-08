// [TITLE] Test Module: test/register-routes.security.test.js
// [TITLE] Purpose: verify local-machine write-access helper behavior for mutating route guardrails

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeRemoteAddress,
  isLoopbackAddress,
  isSameHostSocketAddress,
  isWriteRequestAllowed
} = require("../src/app/register-routes");

test("normalizeRemoteAddress strips IPv6 mapped prefix deterministically", () => {
  assert.equal(normalizeRemoteAddress("::ffff:127.0.0.1"), "127.0.0.1");
  assert.equal(normalizeRemoteAddress("127.0.0.1"), "127.0.0.1");
  assert.equal(normalizeRemoteAddress(""), "");
});

test("isLoopbackAddress accepts localhost forms and rejects remote ranges", () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("localhost"), true);
  assert.equal(isLoopbackAddress("192.168.0.5"), false);
  assert.equal(isLoopbackAddress("203.0.113.10"), false);
});

test("isWriteRequestAllowed enforces local-machine default with override escape hatch", () => {
  const localByIp = isWriteRequestAllowed({
    allowRemoteWrite: false,
    requestIp: "127.0.0.1",
    socketRemoteAddress: "203.0.113.10"
  });
  const localBySocket = isWriteRequestAllowed({
    allowRemoteWrite: false,
    requestIp: "203.0.113.10",
    socketRemoteAddress: "::1"
  });
  const blockedRemote = isWriteRequestAllowed({
    allowRemoteWrite: false,
    requestIp: "203.0.113.10",
    socketRemoteAddress: "198.51.100.11",
    socketLocalAddress: "192.168.1.50"
  });
  const sameHostLan = isWriteRequestAllowed({
    allowRemoteWrite: false,
    requestIp: "192.168.1.50",
    socketRemoteAddress: "192.168.1.50",
    socketLocalAddress: "192.168.1.50"
  });
  const forcedAllow = isWriteRequestAllowed({
    allowRemoteWrite: true,
    requestIp: "203.0.113.10",
    socketRemoteAddress: "198.51.100.11"
  });

  assert.equal(localByIp, true);
  assert.equal(localBySocket, true);
  assert.equal(blockedRemote, false);
  assert.equal(sameHostLan, true);
  assert.equal(forcedAllow, true);
});

test("isSameHostSocketAddress allows same-interface requests and blocks mismatched remote peers", () => {
  const sameHost = isSameHostSocketAddress({
    socketRemoteAddress: "::ffff:192.168.1.50",
    socketLocalAddress: "192.168.1.50"
  });
  const mismatch = isSameHostSocketAddress({
    socketRemoteAddress: "192.168.1.20",
    socketLocalAddress: "192.168.1.50"
  });
  const missing = isSameHostSocketAddress({
    socketRemoteAddress: "",
    socketLocalAddress: "192.168.1.50"
  });

  assert.equal(sameHost, true);
  assert.equal(mismatch, false);
  assert.equal(missing, false);
});
