// [TITLE] Test Module: test/wiz-bridge.adapter.test.js
// [TITLE] Purpose: verify WiZ adapter send and optional discovery contracts

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const createWizBridgeAdapter = require("../src/adapters/brands/wiz-bridge.adapter");

test("wiz adapter sendState reports dry-run and send counts", () => {
  const adapter = createWizBridgeAdapter({
    dryRun: true
  });
  const result = adapter.sendState([{ id: "wiz-1" }, { id: "wiz-2" }], { r: 10, g: 20, b: 30 });
  assert.equal(result.sent, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.dryRun, true);
});

test("wiz adapter sendState emits UDP setPilot payload when dry-run is disabled", () => {
  class FakeSocket extends EventEmitter {
    bind(_port, handler) {
      this.bound = true;
      handler();
    }
    setBroadcast(flag) {
      this.broadcast = Boolean(flag);
    }
    send(payload, port, host) {
      this.sends = this.sends || [];
      this.sends.push({
        payload: String(payload || ""),
        port: Number(port || 0),
        host: String(host || "")
      });
    }
  }

  const fakeSocket = new FakeSocket();
  const adapter = createWizBridgeAdapter({
    dryRun: false,
    dgramRef: {
      createSocket() {
        return fakeSocket;
      }
    },
    setTimeout(handler) {
      handler();
      return { unref() {} };
    }
  });

  const result = adapter.sendState([
    { id: "wiz-1", ip: "192.168.1.77" }
  ], {
    on: true,
    r: 12,
    g: 34,
    b: 56,
    dimming: 45
  });

  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.dryRun, false);
  assert.equal(Array.isArray(fakeSocket.sends), true);
  assert.equal(fakeSocket.sends.length >= 1, true);
  assert.equal(fakeSocket.sends[0].host, "192.168.1.77");
  assert.equal(fakeSocket.sends[0].port, 38899);

  const payload = JSON.parse(fakeSocket.sends[0].payload);
  assert.equal(payload.method, "setPilot");
  assert.equal(payload.params.state, true);
  assert.equal(payload.params.dimming, 45);
  assert.equal(payload.params.r, 12);
  assert.equal(payload.params.g, 34);
  assert.equal(payload.params.b, 56);

  const telemetry = adapter.getTelemetry();
  assert.equal(telemetry.ok, true);
  assert.equal(telemetry.sent, 1);
  assert.equal(telemetry.failed, 0);
  assert.equal(telemetry.socket.created, true);
  assert.equal(telemetry.lastState.dimming, 45);
  assert.equal(telemetry.lastState.r, 12);
  assert.equal(telemetry.lastState.g, 34);
  assert.equal(telemetry.lastState.b, 56);
});

test("wiz adapter sendState reports failure for invalid target ip", () => {
  let createSocketCalls = 0;
  const adapter = createWizBridgeAdapter({
    dryRun: false,
    dgramRef: {
      createSocket() {
        createSocketCalls += 1;
        return new EventEmitter();
      }
    }
  });

  const result = adapter.sendState([
    { id: "wiz-1", ip: "not-an-ip" }
  ], {
    on: true,
    r: 1,
    g: 2,
    b: 3,
    dimming: 40
  });

  assert.equal(result.sent, 0);
  assert.equal(result.failed, 1);
  assert.equal(result.dryRun, false);
  assert.equal(createSocketCalls, 0);
});

test("wiz adapter cancels stale repeat packets per fixture IP", () => {
  class FakeSocket extends EventEmitter {
    bind(_port, handler) {
      handler();
    }
    setBroadcast(_flag) {}
    send(payload, _port, host) {
      this.sends = this.sends || [];
      this.sends.push({
        payload: String(payload || ""),
        host: String(host || "")
      });
    }
  }

  const fakeSocket = new FakeSocket();
  const timers = [];
  const canceled = new Set();
  let timerSeq = 0;
  const adapter = createWizBridgeAdapter({
    dryRun: false,
    dgramRef: {
      createSocket() {
        return fakeSocket;
      }
    },
    setTimeout(handler) {
      const token = {
        id: ++timerSeq,
        run: handler,
        unref() {}
      };
      timers.push(token);
      return token;
    },
    clearTimeout(token) {
      if (token && typeof token.id === "number") {
        canceled.add(token.id);
      }
    }
  });

  adapter.sendState([{ id: "wiz-1", ip: "192.168.1.50" }], {
    on: true,
    r: 10,
    g: 20,
    b: 30,
    dimming: 25
  });
  adapter.sendState([{ id: "wiz-1", ip: "192.168.1.50" }], {
    on: true,
    r: 40,
    g: 50,
    b: 60,
    dimming: 65
  });

  for (const timer of timers) {
    if (canceled.has(timer.id)) continue;
    timer.run();
  }

  const sends = Array.isArray(fakeSocket.sends) ? fakeSocket.sends : [];
  assert.equal(sends.length, 3);
  const payloads = sends.map(item => JSON.parse(item.payload));
  const firstStateCount = payloads.filter(item => item.params.r === 10 && item.params.dimming === 25).length;
  const secondStateCount = payloads.filter(item => item.params.r === 40 && item.params.dimming === 65).length;
  assert.equal(firstStateCount, 1);
  assert.equal(secondStateCount, 2);
});

test("wiz adapter discoverDevices collects unique device rows from UDP responses", async () => {
  class FakeSocket extends EventEmitter {
    bind(_port, handler) {
      this.bound = true;
      handler();
    }
    setBroadcast(flag) {
      this.broadcast = Boolean(flag);
    }
    send(_payload, _port, _host) {
      this.emit("message", Buffer.from(JSON.stringify({
        result: { mac: "aa:bb", moduleName: "wiz-bulb", roomId: 3, roomName: "Desk" }
      })), { address: "192.168.1.90" });
      this.emit("message", Buffer.from(JSON.stringify({
        result: { mac: "aa:bb", moduleName: "wiz-bulb", roomId: 3, roomName: "Desk" }
      })), { address: "192.168.1.90" });
      this.emit("message", Buffer.from(JSON.stringify({
        result: { mac: "cc:dd", moduleName: "wiz-strip", roomId: 5, roomName: "Wall" }
      })), { address: "192.168.1.91" });
    }
    close() {
      this.closed = true;
    }
  }

  const fakeSocket = new FakeSocket();
  const adapter = createWizBridgeAdapter({
    dgramRef: {
      createSocket() {
        return fakeSocket;
      }
    },
    osRef: {
      networkInterfaces() {
        return {};
      }
    },
    setTimeout(handler) {
      handler();
      return { unref() {} };
    }
  });

  const discovered = await adapter.discoverDevices({
    timeoutMs: 10
  });
  assert.equal(discovered.ok, true);
  assert.equal(Array.isArray(discovered.devices), true);
  assert.equal(discovered.devices.length, 2);
  assert.equal(discovered.devices[0].ip, "192.168.1.90");
  assert.equal(discovered.devices[1].ip, "192.168.1.91");
});

test("wiz adapter discoverDevices returns transport-unavailable when UDP factory missing", async () => {
  const adapter = createWizBridgeAdapter({
    dgramRef: {}
  });
  const discovered = await adapter.discoverDevices();
  assert.equal(discovered.ok, false);
  assert.equal(discovered.error, "wiz_discovery_transport_unavailable");
});
