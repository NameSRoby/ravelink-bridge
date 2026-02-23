const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");

const ROOT = path.resolve(__dirname, "..");
const AUDIO_CONFIG_PATH = path.join(ROOT, "core", "audio.config.json");
const TEST_PORT = String(5500 + Math.floor(Math.random() * 300));
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

let serverProc = null;
let audioConfigBackup = null;
let audioConfigExisted = false;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => null);
  return { response, data };
}

async function requestJsonHttp(url, options = {}) {
  const parsed = new URL(url);
  const method = String(options.method || "GET").toUpperCase();
  const body = options.body === undefined || options.body === null
    ? null
    : String(options.body);
  const headers = { ...(options.headers || {}) };
  if (body !== null && !Object.prototype.hasOwnProperty.call(headers, "Content-Length")) {
    headers["Content-Length"] = Buffer.byteLength(body, "utf8");
  }
  const reqOptions = {
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
    path: `${parsed.pathname}${parsed.search}`,
    method,
    headers,
    localAddress: options.localAddress || undefined
  };
  return new Promise((resolve, reject) => {
    const req = http.request(reqOptions, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {}
        resolve({
          response: { status: Number(res.statusCode || 0) },
          data
        });
      });
    });
    req.on("error", reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

async function waitForServerReadyAt(baseUrl, timeoutMs = 25000) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      const r = await fetch(`${baseUrl}/audio/telemetry`, { method: "GET" });
      if (r.ok) return;
    } catch {}
    await sleep(220);
  }
  throw new Error(`server did not become ready in time (${baseUrl})`);
}

async function waitForServerReady(timeoutMs = 25000) {
  await waitForServerReadyAt(BASE_URL, timeoutMs);
}

async function stopServer() {
  if (!serverProc) return;
  const proc = serverProc;
  serverProc = null;
  await stopServerProcess(proc);
}

async function stopServerProcess(proc) {
  if (!proc || proc.exitCode !== null) return;
  proc.kill("SIGTERM");
  await new Promise(resolve => {
    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      resolve();
    }, 4000);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function nextPort(seed = 5700) {
  return String(seed + Math.floor(Math.random() * 600));
}

function isPrivateIpv4(ip) {
  const raw = String(ip || "").trim();
  const parts = raw.split(".").map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

function findPrivateLanIpv4() {
  const interfaces = os.networkInterfaces();
  for (const group of Object.values(interfaces || {})) {
    for (const entry of (group || [])) {
      if (!entry || entry.internal) continue;
      if (String(entry.family || "").toUpperCase() !== "IPV4") continue;
      const addr = String(entry.address || "").trim();
      if (isPrivateIpv4(addr)) return addr;
    }
  }
  return "";
}

async function startTempServer(extraEnv = {}, options = {}) {
  const port = nextPort(options.portSeed || 6100);
  const host = String(options.host || "127.0.0.1").trim() || "127.0.0.1";
  const probeHost = String(options.probeHost || "127.0.0.1").trim() || "127.0.0.1";
  const publicHost = String(options.publicHost || probeHost).trim() || probeHost;
  const proc = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOST: host,
      PORT: port,
      RAVELINK_NO_BROWSER: "1",
      ...extraEnv
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await waitForServerReadyAt(`http://${probeHost}:${port}`);
  return {
    proc,
    baseUrl: `http://${publicHost}:${port}`,
    port
  };
}

test("legacy /color GET can be re-enabled by env flag", { concurrency: false }, async () => {
  const tmp = await startTempServer(
    { RAVELINK_ENABLE_LEGACY_COLOR_GET: "1" },
    { host: "127.0.0.1", probeHost: "127.0.0.1", publicHost: "127.0.0.1", portSeed: 6200 }
  );
  try {
    const color = await requestJson(`${tmp.baseUrl}/color`, { method: "GET" });
    assert.equal(color.response.status, 200);
    assert.equal(Boolean(color.data?.ok), false);
    assert.equal(color.data?.error, "missing color text");
  } finally {
    await stopServerProcess(tmp.proc);
  }
});

test("remote mod write routes require explicit remote-mod flag", { concurrency: false }, async t => {
  const lanIp = findPrivateLanIpv4();
  if (!lanIp) {
    t.skip("no private LAN IPv4 interface available for non-loopback route test");
    return;
  }

  const noModWrite = await startTempServer(
    { RAVELINK_ALLOW_REMOTE_WRITE: "1" },
    { host: "0.0.0.0", probeHost: "127.0.0.1", publicHost: lanIp, portSeed: 6300 }
  );
  try {
    const blocked = await requestJsonHttp(`${noModWrite.baseUrl}/mods/debug`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
      localAddress: lanIp
    });
    assert.equal(blocked.response.status, 403);
    assert.equal(blocked.data?.error, "forbidden");
  } catch (err) {
    t.skip(`non-loopback LAN request unavailable in this environment: ${err?.message || err}`);
  } finally {
    await stopServerProcess(noModWrite.proc);
  }

  const withModWrite = await startTempServer(
    { RAVELINK_ALLOW_REMOTE_WRITE: "1", RAVELINK_ALLOW_REMOTE_MOD_WRITE: "1" },
    { host: "0.0.0.0", probeHost: "127.0.0.1", publicHost: lanIp, portSeed: 6400 }
  );
  try {
    const allowed = await requestJsonHttp(`${withModWrite.baseUrl}/mods/debug`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
      localAddress: lanIp
    });
    assert.notEqual(allowed.response.status, 403);
    assert.notEqual(allowed.data?.error, "forbidden");
  } catch (err) {
    t.skip(`non-loopback LAN request unavailable in this environment: ${err?.message || err}`);
  } finally {
    await stopServerProcess(withModWrite.proc);
  }
});

test.before(async () => {
  if (fs.existsSync(AUDIO_CONFIG_PATH)) {
    audioConfigExisted = true;
    audioConfigBackup = fs.readFileSync(AUDIO_CONFIG_PATH, "utf8");
  }

  serverProc = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: TEST_PORT,
      RAVELINK_NO_BROWSER: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let bootError = "";
  serverProc.stderr.on("data", chunk => {
    bootError += String(chunk || "");
  });
  serverProc.on("exit", code => {
    if (code !== 0 && !bootError) {
      bootError = `server exited with code ${code}`;
    }
  });

  await waitForServerReady();
});

test.after(async () => {
  await stopServer();
  if (audioConfigExisted) {
    fs.writeFileSync(AUDIO_CONFIG_PATH, audioConfigBackup, "utf8");
  } else {
    try { fs.unlinkSync(AUDIO_CONFIG_PATH); } catch {}
  }
});

test("palette + fixture metric routing endpoints stay consistent", { concurrency: false }, async () => {
  const palettePatch = await requestJson(`${BASE_URL}/rave/palette`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      brand: "hue",
      families: ["yellow", "green", "cyan"],
      colorsPerFamily: 3,
      familyColorCounts: {
        yellow: 5,
        green: 12,
        cyan: 8
      },
      disorder: false,
      brightnessMode: "test",
      brightnessFollowAmount: 1.4
    })
  });
  assert.equal(palettePatch.response.status, 200);
  assert.equal(Boolean(palettePatch.data?.ok), true);
  assert.equal(palettePatch.data?.config?.brands?.hue?.brightnessMode, "test");
  assert.equal(Number(palettePatch.data?.config?.brands?.hue?.brightnessFollowAmount), 1.4);
  assert.equal(Number(palettePatch.data?.config?.brands?.hue?.familyColorCounts?.yellow), 5);
  assert.equal(Number(palettePatch.data?.config?.brands?.hue?.familyColorCounts?.green), 12);
  assert.equal(Number(palettePatch.data?.config?.brands?.hue?.familyColorCounts?.cyan), 8);

  const metricPatch = await requestJson(`${BASE_URL}/rave/fixture-metrics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      brand: "hue",
      mode: "meta_auto",
      metaAutoFlip: true,
      harmonySize: 2,
      maxHz: 7.5
    })
  });
  assert.equal(metricPatch.response.status, 200);
  assert.equal(Boolean(metricPatch.data?.ok), true);
  assert.equal(Number(metricPatch.data?.brands?.hue?.maxHz), 7.5);

  const clear = await requestJson(`${BASE_URL}/rave/fixture-routing/clear`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brand: "hue" })
  });
  assert.equal(clear.response.status, 200);
  assert.equal(Boolean(clear.data?.ok), true);
  assert.equal(clear.data?.scope, "brand");
});

test("genre routes are fully removed", { concurrency: false }, async () => {
  const removed = await requestJson(`${BASE_URL}/rave/genres`, { method: "GET" });
  assert.equal(removed.response.status, 404);
  assert.equal(removed.data, null);
});

test("mutating command GET routes stay disabled (legacy /color GET disabled by default)", { concurrency: false }, async () => {
  const raveOn = await requestJson(`${BASE_URL}/rave/on`, { method: "GET" });
  assert.equal(raveOn.response.status, 405);
  assert.equal(raveOn.data?.error, "method_not_allowed");

  const teach = await requestJson(`${BASE_URL}/teach`, { method: "GET" });
  assert.equal(teach.response.status, 405);
  assert.equal(teach.data?.error, "method_not_allowed");

  const color = await requestJson(`${BASE_URL}/color`, { method: "GET" });
  assert.equal(color.response.status, 405);
  assert.equal(color.data?.error, "method_not_allowed");
});

test("/fixtures/route write endpoint is deprecated", { concurrency: false }, async () => {
  const response = await requestJson(`${BASE_URL}/fixtures/route`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent: "HUE_STATE", zone: "hue" })
  });
  assert.equal(response.response.status, 410);
  assert.equal(Boolean(response.data?.ok), false);
  assert.equal(response.data?.error, "deprecated_route_api");
});

test("color prefixes patch remains backward compatible", { concurrency: false }, async () => {
  const patch = await requestJson(`${BASE_URL}/color/prefixes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      huePrefix: "h",
      wizPrefix: "w",
      otherPrefix: "x",
      raveOffEnabled: false,
      raveOffDefaultText: "cyan"
    })
  });
  assert.equal(patch.response.status, 200);
  assert.equal(Boolean(patch.data?.ok), true);
  assert.equal(patch.data?.config?.prefixes?.hue, "h");
  assert.equal(patch.data?.config?.prefixes?.wiz, "w");
  assert.equal(patch.data?.config?.prefixes?.other, "x");
  assert.equal(Boolean(patch.data?.config?.raveOff?.enabled), false);
  assert.equal(patch.data?.config?.raveOff?.defaultText, "cyan");

  const reset = await requestJson(`${BASE_URL}/color/prefixes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reset: true })
  });
  assert.equal(reset.response.status, 200);
  assert.equal(Boolean(reset.data?.ok), true);
  assert.equal(reset.data?.config?.prefixes?.other, "");
  assert.deepEqual(reset.data?.config?.fixturePrefixes || {}, {});
  assert.equal(Boolean(reset.data?.config?.raveOff?.enabled), true);
  assert.equal(reset.data?.config?.raveOff?.defaultText, "random");
  assert.deepEqual(reset.data?.config?.raveOff?.groups || {}, {});
  assert.deepEqual(reset.data?.config?.raveOff?.fixtures || {}, {});
});

test("audio config supports strict app isolation + custom check interval", { concurrency: false }, async () => {
  const patch = await requestJson(`${BASE_URL}/audio/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inputBackend: "ffmpeg",
      ffmpegAppIsolationEnabled: true,
      ffmpegAppIsolationStrict: true,
      ffmpegAppIsolationCheckMs: 120000
    })
  });
  assert.equal(patch.response.status, 200);
  assert.equal(Boolean(patch.data?.ok), true);
  assert.equal(Boolean(patch.data?.config?.ffmpegAppIsolationStrict), true);
  assert.equal(Number(patch.data?.config?.ffmpegAppIsolationCheckMs), 120000);

  await sleep(320);

  const readBack = await requestJson(`${BASE_URL}/audio/config`, { method: "GET" });
  assert.equal(readBack.response.status, 200);
  assert.equal(Boolean(readBack.data?.ok), true);
  assert.equal(Boolean(readBack.data?.config?.ffmpegAppIsolationStrict), true);
  assert.equal(Number(readBack.data?.config?.ffmpegAppIsolationCheckMs), 120000);
});

test("overclock routing supports safe tiers and enforces unsafe ack", { concurrency: false }, async () => {
  const safeTier = await requestJson(`${BASE_URL}/rave/overclock?enabled=true&tier=turbo8`, {
    method: "POST"
  });
  assert.equal(safeTier.response.status, 200);

  const unsafeNoAck = await requestJson(`${BASE_URL}/rave/overclock?enabled=true&tier=dev20`, {
    method: "POST"
  });
  assert.equal(unsafeNoAck.response.status, 400);
  assert.equal(unsafeNoAck.data?.error, "unsafe acknowledgement required");

  const unsafeAck = await requestJson(`${BASE_URL}/rave/overclock?enabled=true&tier=dev20&unsafe=true`, {
    method: "POST"
  });
  assert.equal(unsafeAck.response.status, 200);
});

test("enabled-flag control routes keep consistent validation", { concurrency: false }, async () => {
  const metaOn = await requestJson(`${BASE_URL}/rave/meta/auto?enabled=true`, {
    method: "POST"
  });
  assert.equal(metaOn.response.status, 200);
  assert.equal(Boolean(metaOn.data?.ok), true);

  const wizSyncMissing = await requestJson(`${BASE_URL}/rave/wiz/sync`, {
    method: "POST"
  });
  assert.equal(wizSyncMissing.response.status, 400);
  assert.equal(wizSyncMissing.data?.error, "missing enabled flag");

  const wizSyncOn = await requestJson(`${BASE_URL}/rave/wiz/sync/on`, {
    method: "POST"
  });
  assert.equal(wizSyncOn.response.status, 200);
  assert.equal(Boolean(wizSyncOn.data?.ok), true);
  assert.equal(Boolean(wizSyncOn.data?.enabled), false);
  assert.equal(String(wizSyncOn.data?.strategy || ""), "standalone");
  assert.equal(Boolean(wizSyncOn.data?.enforced), true);
});
