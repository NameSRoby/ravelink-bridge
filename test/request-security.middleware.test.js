// [TITLE] Test Module: test/request-security.middleware.test.js
// [TITLE] Purpose: security middleware CORS/private-network preflight regression coverage

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const {
  installRequestSecurityMiddleware
} = require("../src/app/runtime/request-security.middleware");

function toBaseUrl(server) {
  const address = server.address();
  return `http://127.0.0.1:${Number(address?.port || 0)}`;
}

test("security middleware allows Chromium private-network preflight to localhost bridge", async () => {
  const app = express();
  installRequestSecurityMiddleware(app, {
    express,
    allowRemoteWrite: false,
    port: 5050
  });
  app.post("/color", (_req, res) => {
    res.json({ ok: true });
  });

  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });

  try {
    const response = await fetch(`${toBaseUrl(server)}/color`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://streamelements.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
        "Access-Control-Request-Private-Network": "true",
        Connection: "close"
      }
    });

    assert.equal(response.status, 204);
    assert.equal(
      String(response.headers.get("access-control-allow-private-network") || "").toLowerCase(),
      "true"
    );
  } finally {
    if (typeof server.closeAllConnections === "function") {
      server.closeAllConnections();
    }
    await new Promise(resolve => server.close(() => resolve()));
  }
});
