const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

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

async function waitForServerReady(timeoutMs = 25000) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      const r = await fetch(`${BASE_URL}/audio/telemetry`, { method: "GET" });
      if (r.ok) return;
    } catch {}
    await sleep(220);
  }
  throw new Error("server did not become ready in time");
}

async function stopServer() {
  if (!serverProc) return;
  const proc = serverProc;
  serverProc = null;
  if (proc.exitCode !== null) return;
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
      families: ["blue", "purple"],
      colorsPerFamily: 3,
      disorder: false,
      brightnessMode: "test",
      brightnessFollowAmount: 1.4
    })
  });
  assert.equal(palettePatch.response.status, 200);
  assert.equal(Boolean(palettePatch.data?.ok), true);
  assert.equal(palettePatch.data?.config?.brands?.hue?.brightnessMode, "test");
  assert.equal(Number(palettePatch.data?.config?.brands?.hue?.brightnessFollowAmount), 1.4);

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

test("mutating command GET routes stay disabled (except legacy /color compatibility)", { concurrency: false }, async () => {
  const raveOn = await requestJson(`${BASE_URL}/rave/on`, { method: "GET" });
  assert.equal(raveOn.response.status, 405);
  assert.equal(raveOn.data?.error, "method_not_allowed");

  const teach = await requestJson(`${BASE_URL}/teach`, { method: "GET" });
  assert.equal(teach.response.status, 405);
  assert.equal(teach.data?.error, "method_not_allowed");

  const color = await requestJson(`${BASE_URL}/color`, { method: "GET" });
  assert.equal(color.response.status, 200);
  assert.equal(Boolean(color.data?.ok), false);
  assert.equal(color.data?.error, "missing color text");
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
});
