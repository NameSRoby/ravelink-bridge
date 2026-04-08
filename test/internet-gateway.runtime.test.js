// [TITLE] Test Module: test/internet-gateway.runtime.test.js
// [TITLE] Purpose: verify internet gateway host runtime lifecycle and IPC request dispatch

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const createInternetGatewayRuntime = require("../src/domains/internet-gateway/internet-gateway.runtime");

function createFakeChild(onSend = () => {}) {
  const emitter = new EventEmitter();
  emitter.pid = 43210;
  emitter.send = message => {
    onSend(message, emitter);
  };
  emitter.kill = () => {
    emitter.emit("close", 0, "SIGTERM");
  };
  return emitter;
}

test("internet gateway runtime dispatches request/response over IPC", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-igw-runtime-"));
  const runtimeDir = path.join(tmpRoot, "runtime");
  const workerPath = path.join(tmpRoot, "worker.js");
  fs.writeFileSync(workerPath, "/* fake worker path for test */\n", "utf8");

  const fakeChild = createFakeChild((message, child) => {
    if (message?.type === "gateway.request") {
      const request = message?.payload?.request || {};
      child.emit("message", {
        schema: "ravelink.internet-gateway.ipc.v1",
        type: "gateway.audit",
        payload: {
          event: {
            requestId: request.requestId,
            operation: request.operation,
            serviceKey: request?.target?.serviceKey,
            status: 200,
            attempts: 1,
            success: true
          }
        }
      });
      child.emit("message", {
        schema: "ravelink.internet-gateway.ipc.v1",
        type: "gateway.response",
        payload: {
          response: {
            ok: true,
            requestId: request.requestId,
            correlationId: request.correlationId,
            status: 200,
            result: {
              status: 200,
              body: { ok: true },
              headers: {},
              attempts: 1
            }
          }
        }
      });
    }
  });

  const runtime = createInternetGatewayRuntime({
    rootDir: tmpRoot,
    runtimeDir,
    workerPath,
    forkFn: () => {
      setImmediate(() => {
        fakeChild.emit("message", {
          schema: "ravelink.internet-gateway.ipc.v1",
          type: "gateway.ready",
          payload: {
            ok: true,
            policyLoaded: true
          }
        });
      });
      return fakeChild;
    }
  });

  const result = await runtime.request({
    requestId: "req-1",
    correlationId: "corr-1",
    integrationKey: "twitch",
    operation: "oauth2_validate",
    target: {
      serviceKey: "twitch_oauth",
      method: "GET",
      path: "/oauth2/validate"
    },
    headers: {
      authorization: "OAuth token-a"
    }
  });
  assert.equal(result?.ok, true);
  assert.equal(result?.result?.status, 200);
  assert.equal(runtime.getStatus()?.running, true);
  assert.equal(runtime.getStatus()?.auditCount >= 1, true);
  assert.equal(runtime.getStatus()?.lastAudit?.operation, "oauth2_validate");
  runtime.shutdown();
});

test("internet gateway runtime rejects invalid requests before IPC send", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ravelink-igw-runtime-invalid-"));
  const runtime = createInternetGatewayRuntime({
    rootDir: tmpRoot,
    runtimeDir: path.join(tmpRoot, "runtime"),
    enabled: false,
    autoStart: false
  });
  const result = await runtime.request({
    requestId: "req-invalid",
    integrationKey: "twitch",
    operation: "bad_fetch",
    url: "https://api.twitch.tv/helix/users"
  });
  assert.equal(result?.ok, false);
  assert.equal(result?.error?.code, "gateway_unavailable");
});
